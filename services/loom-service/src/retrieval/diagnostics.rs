#![allow(dead_code)]

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Instant,
};

use crate::{
    error::ServiceError,
    retrieval::{
        hybrid_service::{DegradationReason, RetrievalResult, RetrievalSourceId, SourceStatus},
        lancedb_adapter::{LanceDbIndexDiagnostics, LanceDbRetrievalAdapter},
        tantivy_adapter::{TantivyIndexDiagnostics, TantivyRetrievalAdapter},
    },
    storage::{
        db::Database,
        repositories::retrieval_projection::{
            RetrievalProjectionRepository, RetrievalProjectionStoredChunk,
            RETRIEVAL_PROJECTION_VERSION,
        },
    },
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalHealthReport {
    pub projection: ProjectionHealth,
    pub sources: Vec<RetrievalIndexHealth>,
    pub hybrid: Option<HybridDiagnosticsSummary>,
    pub total_latency_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionHealth {
    pub projection_version: String,
    pub projection_source_count: usize,
    pub projection_chunk_count: usize,
    pub stored_chunk_count: usize,
    pub tombstoned_chunk_count: usize,
    pub stale_projection_detected: bool,
    pub stale_chunk_count: usize,
    pub digest_mismatch_count: usize,
    pub version_mismatch_count: usize,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalIndexHealth {
    pub source_id: RetrievalSourceId,
    pub status: SourceStatus,
    pub document_count: usize,
    pub chunk_count: usize,
    pub index_version: Option<String>,
    pub projection_version: Option<String>,
    pub last_rebuild: Option<String>,
    pub degradation_reason: Option<DegradationReason>,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HybridDiagnosticsSummary {
    pub total_candidates_before_fusion: usize,
    pub total_candidates_after_fusion: usize,
    pub digest_mismatch_count: usize,
    pub digest_mismatch_source_kinds: Vec<String>,
    pub source_count: usize,
    pub degraded_source_count: usize,
    pub unavailable_source_count: usize,
    pub total_latency_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalIndexSnapshot {
    pub document_count: usize,
    pub chunk_count: usize,
    pub index_version: String,
    pub projection_version: String,
    pub last_rebuild: Option<String>,
}

pub trait RetrievalDiagnosticsSource: Send + Sync {
    fn inspect(&self) -> Result<RetrievalIndexSnapshot, ServiceError>;
}

#[derive(Clone)]
pub struct RetrievalDiagnosticsService {
    projection: RetrievalProjectionRepository,
    tantivy: Option<Arc<dyn RetrievalDiagnosticsSource>>,
    lancedb: Option<Arc<dyn RetrievalDiagnosticsSource>>,
}

impl RetrievalDiagnosticsService {
    pub fn new(database: &Database) -> Self {
        Self {
            projection: RetrievalProjectionRepository::new(database),
            tantivy: None,
            lancedb: None,
        }
    }

    pub fn with_sources(
        projection: RetrievalProjectionRepository,
        tantivy: Option<Arc<dyn RetrievalDiagnosticsSource>>,
        lancedb: Option<Arc<dyn RetrievalDiagnosticsSource>>,
    ) -> Self {
        Self {
            projection,
            tantivy,
            lancedb,
        }
    }

    pub async fn inspect(
        &self,
        hybrid_result: Option<&RetrievalResult>,
    ) -> Result<RetrievalHealthReport, ServiceError> {
        let started = Instant::now();
        let projection = inspect_projection(&self.projection).await?;
        let sources = vec![
            inspect_source(
                RetrievalSourceId::Tantivy,
                self.tantivy.as_deref(),
                &projection,
            ),
            inspect_source(
                RetrievalSourceId::LanceDb,
                self.lancedb.as_deref(),
                &projection,
            ),
        ];
        Ok(RetrievalHealthReport {
            projection,
            sources,
            hybrid: hybrid_result.map(summarize_hybrid_diagnostics),
            total_latency_ms: elapsed_ms(started),
        })
    }
}

#[derive(Clone)]
pub struct TantivyRetrievalDiagnosticsSource {
    adapter: Arc<TantivyRetrievalAdapter>,
}

impl TantivyRetrievalDiagnosticsSource {
    pub fn new(adapter: Arc<TantivyRetrievalAdapter>) -> Self {
        Self { adapter }
    }
}

impl RetrievalDiagnosticsSource for TantivyRetrievalDiagnosticsSource {
    fn inspect(&self) -> Result<RetrievalIndexSnapshot, ServiceError> {
        Ok(snapshot_from_tantivy(self.adapter.diagnostics()?))
    }
}

#[derive(Clone)]
pub struct LanceDbRetrievalDiagnosticsSource {
    adapter: Arc<LanceDbRetrievalAdapter>,
}

impl LanceDbRetrievalDiagnosticsSource {
    pub fn new(adapter: Arc<LanceDbRetrievalAdapter>) -> Self {
        Self { adapter }
    }
}

impl RetrievalDiagnosticsSource for LanceDbRetrievalDiagnosticsSource {
    fn inspect(&self) -> Result<RetrievalIndexSnapshot, ServiceError> {
        Ok(snapshot_from_lancedb(self.adapter.diagnostics()?))
    }
}

async fn inspect_projection(
    projection: &RetrievalProjectionRepository,
) -> Result<ProjectionHealth, ServiceError> {
    let started = Instant::now();
    let active = projection.enumerate_active_chunks().await?;
    let stored = projection.list_stored_chunks().await?;
    let mut active_by_key = HashMap::new();
    let mut source_keys = HashSet::new();
    for candidate in &active {
        source_keys.insert((
            candidate.identity.source_kind.clone(),
            candidate.identity.source_id.clone(),
            candidate.identity.projection_version.clone(),
        ));
        active_by_key.insert(
            (
                candidate.identity.source_kind.clone(),
                candidate.identity.source_id.clone(),
                candidate.identity.chunk_ref.clone(),
                candidate.identity.projection_version.clone(),
            ),
            candidate.identity.content_digest.clone(),
        );
    }

    let mut stored_by_key = HashMap::new();
    let mut tombstoned_chunk_count = 0usize;
    let mut version_mismatch_count = 0usize;
    for chunk in &stored {
        if chunk.projection_version != RETRIEVAL_PROJECTION_VERSION {
            version_mismatch_count += 1;
            continue;
        }
        if chunk.is_deleted {
            tombstoned_chunk_count += 1;
        }
        stored_by_key.insert(stored_key(chunk), chunk);
    }

    let mut stale_chunk_count = 0usize;
    let mut digest_mismatch_count = 0usize;
    for (key, active_digest) in &active_by_key {
        match stored_by_key.get(key) {
            Some(stored) if stored.is_deleted => stale_chunk_count += 1,
            Some(stored) if stored.content_digest != *active_digest => {
                stale_chunk_count += 1;
                digest_mismatch_count += 1;
            }
            Some(_) => {}
            None => stale_chunk_count += 1,
        }
    }
    for (key, stored) in &stored_by_key {
        if !stored.is_deleted && !active_by_key.contains_key(key) {
            stale_chunk_count += 1;
        }
    }

    Ok(ProjectionHealth {
        projection_version: RETRIEVAL_PROJECTION_VERSION.to_string(),
        projection_source_count: source_keys.len(),
        projection_chunk_count: active.len(),
        stored_chunk_count: stored.len(),
        tombstoned_chunk_count,
        stale_projection_detected: stale_chunk_count > 0 || version_mismatch_count > 0,
        stale_chunk_count,
        digest_mismatch_count,
        version_mismatch_count,
        latency_ms: elapsed_ms(started),
    })
}

fn inspect_source(
    source_id: RetrievalSourceId,
    source: Option<&dyn RetrievalDiagnosticsSource>,
    projection: &ProjectionHealth,
) -> RetrievalIndexHealth {
    let Some(source) = source else {
        return RetrievalIndexHealth {
            source_id,
            status: SourceStatus::Unavailable,
            document_count: 0,
            chunk_count: 0,
            index_version: None,
            projection_version: None,
            last_rebuild: None,
            degradation_reason: Some(DegradationReason::MissingIndex),
            latency_ms: 0,
        };
    };
    let started = Instant::now();
    match source.inspect() {
        Ok(snapshot) => {
            let (status, degradation_reason) = classify_snapshot(&snapshot, projection);
            RetrievalIndexHealth {
                source_id,
                status,
                document_count: snapshot.document_count,
                chunk_count: snapshot.chunk_count,
                index_version: Some(snapshot.index_version),
                projection_version: Some(snapshot.projection_version),
                last_rebuild: snapshot.last_rebuild,
                degradation_reason,
                latency_ms: elapsed_ms(started),
            }
        }
        Err(_) => RetrievalIndexHealth {
            source_id,
            status: SourceStatus::Degraded,
            document_count: 0,
            chunk_count: 0,
            index_version: None,
            projection_version: None,
            last_rebuild: None,
            degradation_reason: Some(DegradationReason::CorruptIndex),
            latency_ms: elapsed_ms(started),
        },
    }
}

fn classify_snapshot(
    snapshot: &RetrievalIndexSnapshot,
    projection: &ProjectionHealth,
) -> (SourceStatus, Option<DegradationReason>) {
    if snapshot.projection_version != projection.projection_version {
        return (
            SourceStatus::Degraded,
            Some(DegradationReason::VersionMismatch),
        );
    }
    if snapshot.last_rebuild.is_none() && projection.projection_chunk_count > 0 {
        return (
            SourceStatus::Unavailable,
            Some(DegradationReason::MissingIndex),
        );
    }
    if projection.stale_projection_detected
        || snapshot.chunk_count != projection.projection_chunk_count
    {
        return (
            SourceStatus::Degraded,
            Some(DegradationReason::StaleProjection),
        );
    }
    (SourceStatus::Ready, None)
}

fn summarize_hybrid_diagnostics(result: &RetrievalResult) -> HybridDiagnosticsSummary {
    let degraded_source_count = result
        .diagnostics
        .sources
        .iter()
        .filter(|source| source.status == SourceStatus::Degraded)
        .count();
    let unavailable_source_count = result
        .diagnostics
        .sources
        .iter()
        .filter(|source| source.status == SourceStatus::Unavailable)
        .count();
    HybridDiagnosticsSummary {
        total_candidates_before_fusion: result.diagnostics.total_candidates_before_fusion,
        total_candidates_after_fusion: result.diagnostics.total_candidates_after_fusion,
        digest_mismatch_count: result.diagnostics.digest_mismatch_count,
        digest_mismatch_source_kinds: result.diagnostics.digest_mismatch_source_kinds.clone(),
        source_count: result.diagnostics.sources.len(),
        degraded_source_count,
        unavailable_source_count,
        total_latency_ms: result.diagnostics.total_latency_ms,
    }
}

fn snapshot_from_tantivy(diagnostics: TantivyIndexDiagnostics) -> RetrievalIndexSnapshot {
    RetrievalIndexSnapshot {
        document_count: diagnostics.document_count,
        chunk_count: diagnostics.chunk_count,
        index_version: diagnostics.index_version,
        projection_version: diagnostics.projection_version,
        last_rebuild: diagnostics.last_rebuild,
    }
}

fn snapshot_from_lancedb(diagnostics: LanceDbIndexDiagnostics) -> RetrievalIndexSnapshot {
    RetrievalIndexSnapshot {
        document_count: diagnostics.document_count,
        chunk_count: diagnostics.chunk_count,
        index_version: diagnostics.index_version,
        projection_version: diagnostics.projection_version,
        last_rebuild: diagnostics.last_rebuild,
    }
}

fn stored_key(chunk: &RetrievalProjectionStoredChunk) -> (String, String, String, String) {
    (
        chunk.source_kind.clone(),
        chunk.source_id.clone(),
        chunk.chunk_ref.clone(),
        chunk.projection_version.clone(),
    )
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        retrieval::hybrid_service::{
            FusionMethod, RetrievalDiagnostics, RetrievalSourceDiagnostic,
        },
        storage::db::{test_database, Database},
    };
    use sqlx::Row;

    #[tokio::test]
    async fn healthy_diagnostics_reports_projection_and_indexes() {
        let database = seed_response_fixture().await;
        let projection = RetrievalProjectionRepository::new(&database);
        projection.plan_full_rebuild().await.expect("plan");
        let service = diagnostics_service(
            &database,
            Some(snapshot_source(snapshot(
                1,
                "tantivy-lexical-v1",
                Some("1"),
            ))),
            Some(snapshot_source(snapshot(1, "lancedb-vector-v1", Some("1")))),
        );
        let report = service.inspect(None).await.expect("inspect");
        assert_eq!(report.projection.projection_source_count, 1);
        assert_eq!(report.projection.projection_chunk_count, 1);
        assert_eq!(report.projection.tombstoned_chunk_count, 0);
        assert!(!report.projection.stale_projection_detected);
        assert!(report
            .sources
            .iter()
            .all(|source| source.status == SourceStatus::Ready));
    }

    #[tokio::test]
    async fn missing_tantivy_index_reports_unavailable_without_path() {
        let database = seed_response_fixture().await;
        let service = diagnostics_service(
            &database,
            None,
            Some(snapshot_source(snapshot(1, "lancedb-vector-v1", Some("1")))),
        );
        let report = service.inspect(None).await.expect("inspect");
        let tantivy = source(&report, RetrievalSourceId::Tantivy);
        assert_eq!(tantivy.status, SourceStatus::Unavailable);
        assert_eq!(
            tantivy.degradation_reason,
            Some(DegradationReason::MissingIndex)
        );
        assert_no_forbidden_diagnostics(&format!("{report:?}"));
    }

    #[tokio::test]
    async fn missing_lancedb_index_reports_unavailable_without_path() {
        let database = seed_response_fixture().await;
        let service = diagnostics_service(
            &database,
            Some(snapshot_source(snapshot(
                1,
                "tantivy-lexical-v1",
                Some("1"),
            ))),
            None,
        );
        let report = service.inspect(None).await.expect("inspect");
        let lancedb = source(&report, RetrievalSourceId::LanceDb);
        assert_eq!(lancedb.status, SourceStatus::Unavailable);
        assert_eq!(
            lancedb.degradation_reason,
            Some(DegradationReason::MissingIndex)
        );
        assert_no_forbidden_diagnostics(&format!("{report:?}"));
    }

    #[tokio::test]
    async fn stale_projection_detects_changed_content_and_degrades_indexes() {
        let database = seed_response_fixture().await;
        let projection = RetrievalProjectionRepository::new(&database);
        projection.plan_full_rebuild().await.expect("plan");
        sqlx::query(
            "UPDATE responses SET content = 'updated diagnostic content', updated_at = '2'",
        )
        .execute(database.pool())
        .await
        .expect("update");
        let service = diagnostics_service(
            &database,
            Some(snapshot_source(snapshot(
                1,
                "tantivy-lexical-v1",
                Some("1"),
            ))),
            Some(snapshot_source(snapshot(1, "lancedb-vector-v1", Some("1")))),
        );
        let report = service.inspect(None).await.expect("inspect");
        assert!(report.projection.stale_projection_detected);
        assert_eq!(report.projection.digest_mismatch_count, 1);
        assert!(report
            .sources
            .iter()
            .all(|source| source.status == SourceStatus::Degraded));
    }

    #[tokio::test]
    async fn tombstone_count_is_reported_without_identifiers() {
        let database = seed_response_fixture().await;
        let projection = RetrievalProjectionRepository::new(&database);
        projection.plan_full_rebuild().await.expect("plan");
        sqlx::query("UPDATE responses SET is_deleted = 1 WHERE response_id = 'resp-a'")
            .execute(database.pool())
            .await
            .expect("delete");
        projection.plan_full_rebuild().await.expect("tombstone");
        let report = diagnostics_service(&database, None, None)
            .inspect(None)
            .await
            .expect("inspect");
        assert_eq!(report.projection.projection_chunk_count, 0);
        assert_eq!(report.projection.tombstoned_chunk_count, 1);
        assert_no_forbidden_diagnostics(&format!("{report:?}"));
    }

    #[tokio::test]
    async fn corrupt_index_reports_safe_degraded_state() {
        let database = seed_response_fixture().await;
        let report = diagnostics_service(
            &database,
            Some(Arc::new(FakeDiagnosticsSource::corrupt())),
            None,
        )
        .inspect(None)
        .await
        .expect("inspect");
        let tantivy = source(&report, RetrievalSourceId::Tantivy);
        assert_eq!(tantivy.status, SourceStatus::Degraded);
        assert_eq!(
            tantivy.degradation_reason,
            Some(DegradationReason::CorruptIndex)
        );
        assert_no_forbidden_diagnostics(&format!("{report:?}"));
    }

    #[tokio::test]
    async fn version_mismatch_reports_safe_degraded_state() {
        let database = seed_response_fixture().await;
        let report = diagnostics_service(
            &database,
            Some(snapshot_source(RetrievalIndexSnapshot {
                projection_version: "old-projection".to_string(),
                ..snapshot(1, "tantivy-lexical-v1", Some("1"))
            })),
            None,
        )
        .inspect(None)
        .await
        .expect("inspect");
        let tantivy = source(&report, RetrievalSourceId::Tantivy);
        assert_eq!(tantivy.status, SourceStatus::Degraded);
        assert_eq!(
            tantivy.degradation_reason,
            Some(DegradationReason::VersionMismatch)
        );
    }

    #[tokio::test]
    async fn hybrid_retrieval_diagnostics_summary_remains_safe() {
        let database = seed_response_fixture().await;
        let hybrid = RetrievalResult {
            candidates: Vec::new(),
            diagnostics: RetrievalDiagnostics {
                fusion_method: FusionMethod::ReciprocalRankFusion,
                fusion_k: 60.0,
                domain_rank_shift_applied: true,
                domain_rank_version: "domain-rank-shift-v1".to_string(),
                total_candidates_before_fusion: 2,
                total_candidates_after_fusion: 1,
                digest_mismatch_count: 1,
                digest_mismatch_source_kinds: vec!["response".to_string()],
                sources: vec![
                    RetrievalSourceDiagnostic {
                        source_id: RetrievalSourceId::Tantivy,
                        status: SourceStatus::Ready,
                        candidate_count: 1,
                        latency_ms: 2,
                        index_version: Some("tantivy-lexical-v1".to_string()),
                        projection_version: Some(RETRIEVAL_PROJECTION_VERSION.to_string()),
                        last_rebuild: Some("1".to_string()),
                        degradation_reason: None,
                    },
                    RetrievalSourceDiagnostic {
                        source_id: RetrievalSourceId::LanceDb,
                        status: SourceStatus::Unavailable,
                        candidate_count: 0,
                        latency_ms: 1,
                        index_version: None,
                        projection_version: None,
                        last_rebuild: None,
                        degradation_reason: Some(DegradationReason::MissingIndex),
                    },
                ],
                total_latency_ms: 3,
            },
        };
        let report = diagnostics_service(&database, None, None)
            .inspect(Some(&hybrid))
            .await
            .expect("inspect");
        let summary = report.hybrid.expect("hybrid summary");
        assert_eq!(summary.digest_mismatch_count, 1);
        assert_eq!(summary.unavailable_source_count, 1);
        assert_no_forbidden_diagnostics(&format!("{summary:?}"));
    }

    #[tokio::test]
    async fn privacy_exclusion_rejects_raw_thinking_before_diagnostics() {
        let database = test_database().await;
        seed_loom(&database).await;
        seed_response(&database, "raw_thinking must not enter diagnostics").await;
        let error = diagnostics_service(&database, None, None)
            .inspect(None)
            .await
            .expect_err("raw thinking rejected");
        assert!(error.to_string().contains("raw_thinking"));
    }

    fn diagnostics_service(
        database: &Database,
        tantivy: Option<Arc<dyn RetrievalDiagnosticsSource>>,
        lancedb: Option<Arc<dyn RetrievalDiagnosticsSource>>,
    ) -> RetrievalDiagnosticsService {
        RetrievalDiagnosticsService::with_sources(
            RetrievalProjectionRepository::new(database),
            tantivy,
            lancedb,
        )
    }

    fn snapshot_source(snapshot: RetrievalIndexSnapshot) -> Arc<dyn RetrievalDiagnosticsSource> {
        Arc::new(FakeDiagnosticsSource {
            snapshot: Some(snapshot),
            corrupt: false,
        })
    }

    fn snapshot(
        chunk_count: usize,
        index_version: &str,
        last_rebuild: Option<&str>,
    ) -> RetrievalIndexSnapshot {
        RetrievalIndexSnapshot {
            document_count: chunk_count,
            chunk_count,
            index_version: index_version.to_string(),
            projection_version: RETRIEVAL_PROJECTION_VERSION.to_string(),
            last_rebuild: last_rebuild.map(ToString::to_string),
        }
    }

    fn source(
        report: &RetrievalHealthReport,
        source_id: RetrievalSourceId,
    ) -> &RetrievalIndexHealth {
        report
            .sources
            .iter()
            .find(|source| source.source_id == source_id)
            .expect("source diagnostic")
    }

    fn assert_no_forbidden_diagnostics(payload: &str) {
        for forbidden in [
            "diagnostic content",
            "updated diagnostic content",
            "resp-a",
            "response:resp-a:content",
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "provider_delta",
            "provider_payload",
            "Authorization",
            "Bearer ",
            "api_key",
            "password",
            "credential",
            "secret",
            "sk-",
            "/tmp/",
            "/var/",
            "/Users/",
        ] {
            assert!(
                !payload.contains(forbidden),
                "diagnostics leaked forbidden marker {forbidden}: {payload}"
            );
        }
    }

    async fn seed_response_fixture() -> Database {
        let database = test_database().await;
        seed_loom(&database).await;
        seed_response(&database, "diagnostic content").await;
        database
    }

    async fn seed_loom(database: &Database) {
        sqlx::query(
            "INSERT INTO looms (loom_id, title, created_at, updated_at)
             VALUES ('loom-a', 'Loom A', '1', '1')",
        )
        .execute(database.pool())
        .await
        .expect("seed loom");
    }

    async fn seed_response(database: &Database, content: &str) {
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, created_at, updated_at,
                sequence_index, is_deleted
             ) VALUES ('resp-a', 'loom-a', 'assistant', ?1, 'Diagnostic response', '1', '1', 0, 0)",
        )
        .bind(content)
        .execute(database.pool())
        .await
        .expect("seed response");
    }

    struct FakeDiagnosticsSource {
        snapshot: Option<RetrievalIndexSnapshot>,
        corrupt: bool,
    }

    impl FakeDiagnosticsSource {
        fn corrupt() -> Self {
            Self {
                snapshot: None,
                corrupt: true,
            }
        }
    }

    impl RetrievalDiagnosticsSource for FakeDiagnosticsSource {
        fn inspect(&self) -> Result<RetrievalIndexSnapshot, ServiceError> {
            if self.corrupt {
                return Err(ServiceError::storage(
                    "corrupt index at /Users/private/path with secret",
                ));
            }
            self.snapshot
                .clone()
                .ok_or_else(|| ServiceError::storage("missing test snapshot"))
        }
    }

    #[tokio::test]
    async fn projection_source_count_counts_distinct_sources_not_chunks() {
        let database = test_database().await;
        seed_loom(&database).await;
        seed_response(&database, "first diagnostic content").await;
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, created_at, updated_at,
                sequence_index, is_deleted
             ) VALUES ('resp-b', 'loom-a', 'assistant', 'second diagnostic content', 'Diagnostic response', '1', '1', 1, 0)",
        )
        .execute(database.pool())
        .await
        .expect("seed second response");
        let report = diagnostics_service(&database, None, None)
            .inspect(None)
            .await
            .expect("inspect");
        assert_eq!(report.projection.projection_source_count, 2);
        assert_eq!(report.projection.projection_chunk_count, 2);
        let count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM agent_events")
            .fetch_one(database.pool())
            .await
            .expect("agent events count")
            .get("count");
        assert_eq!(count, 0);
    }
}
