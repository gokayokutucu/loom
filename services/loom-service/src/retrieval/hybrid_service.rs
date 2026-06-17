#![allow(dead_code)]

use std::{
    cmp::Ordering,
    collections::{BTreeSet, HashMap},
    future::Future,
    pin::Pin,
    sync::Arc,
    time::Instant,
};

use crate::{
    error::ServiceError,
    retrieval::{
        lancedb_adapter::{LanceDbIndexDiagnostics, LanceDbRetrievalAdapter, LanceDbSearchRequest},
        tantivy_adapter::{TantivyIndexDiagnostics, TantivyRetrievalAdapter, TantivySearchRequest},
    },
};

const DEFAULT_RRF_K: f32 = 60.0;
const DOMAIN_RANK_VERSION: &str = "domain-rank-shift-v1";
const MAX_TEXT_PREVIEW_CHARS: usize = 240;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalQuery {
    pub query: String,
    pub mode: RetrievalMode,
    pub max_candidates: usize,
    pub source_kinds: Vec<String>,
}

impl RetrievalQuery {
    pub fn hybrid(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            mode: RetrievalMode::Hybrid,
            max_candidates: 10,
            source_kinds: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetrievalMode {
    Hybrid,
    KeywordOnly,
    SemanticOnly,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RetrievalResult {
    pub candidates: Vec<RetrievalCandidate>,
    pub diagnostics: RetrievalDiagnostics,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RetrievalCandidate {
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: String,
    pub projection_version: String,
    pub content_digest: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub relevance_score: f32,
    pub rank_signals: RankSignals,
    pub text_preview: Option<String>,
    pub contributing_sources: Vec<RetrievalSourceId>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RankSignals {
    pub bm25_rank: Option<usize>,
    pub bm25_score: Option<f32>,
    pub vector_rank: Option<usize>,
    pub vector_score: Option<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RetrievalDiagnostics {
    pub fusion_method: FusionMethod,
    pub fusion_k: f32,
    pub domain_rank_shift_applied: bool,
    pub domain_rank_version: String,
    pub total_candidates_before_fusion: usize,
    pub total_candidates_after_fusion: usize,
    pub digest_mismatch_count: usize,
    pub digest_mismatch_source_kinds: Vec<String>,
    pub sources: Vec<RetrievalSourceDiagnostic>,
    pub total_latency_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalSourceDiagnostic {
    pub source_id: RetrievalSourceId,
    pub status: SourceStatus,
    pub candidate_count: usize,
    pub latency_ms: u64,
    pub index_version: Option<String>,
    pub projection_version: Option<String>,
    pub last_rebuild: Option<String>,
    pub degradation_reason: Option<DegradationReason>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HybridFusionConfig {
    pub fusion_method: FusionMethod,
    pub rrf_k: f32,
    pub domain_weights: HashMap<String, f32>,
    pub domain_rank_version: String,
}

impl Default for HybridFusionConfig {
    fn default() -> Self {
        Self {
            fusion_method: FusionMethod::ReciprocalRankFusion,
            rrf_k: DEFAULT_RRF_K,
            domain_weights: default_domain_weights(),
            domain_rank_version: DOMAIN_RANK_VERSION.to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FusionMethod {
    ReciprocalRankFusion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RetrievalSourceId {
    Tantivy,
    LanceDb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceStatus {
    Ready,
    Unavailable,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DegradationReason {
    SourceUnavailable,
    SearchFailed,
    MissingIndex,
    StaleProjection,
    CorruptIndex,
    VersionMismatch,
}

#[derive(Clone)]
pub struct HybridRetrievalService {
    keyword_source: Option<Arc<dyn HybridRetrievalSource>>,
    semantic_source: Option<Arc<dyn HybridRetrievalSource>>,
    config: HybridFusionConfig,
}

impl HybridRetrievalService {
    pub fn new(
        keyword_source: Option<Arc<dyn HybridRetrievalSource>>,
        semantic_source: Option<Arc<dyn HybridRetrievalSource>>,
    ) -> Self {
        Self {
            keyword_source,
            semantic_source,
            config: HybridFusionConfig::default(),
        }
    }

    pub fn with_config(mut self, config: HybridFusionConfig) -> Self {
        self.config = config;
        self
    }

    pub async fn retrieve(&self, query: &RetrievalQuery) -> RetrievalResult {
        let started = Instant::now();
        let mut source_outputs = Vec::new();
        let mut diagnostics = Vec::new();

        if matches!(
            query.mode,
            RetrievalMode::Hybrid | RetrievalMode::KeywordOnly
        ) {
            self.collect_source(
                RetrievalSourceId::Tantivy,
                self.keyword_source.as_ref(),
                query,
                &mut source_outputs,
                &mut diagnostics,
            )
            .await;
        }

        if matches!(
            query.mode,
            RetrievalMode::Hybrid | RetrievalMode::SemanticOnly
        ) {
            self.collect_source(
                RetrievalSourceId::LanceDb,
                self.semantic_source.as_ref(),
                query,
                &mut source_outputs,
                &mut diagnostics,
            )
            .await;
        }

        let total_candidates_before_fusion = source_outputs
            .iter()
            .map(|output| output.candidates.len())
            .sum();
        let FusionOutcome {
            candidates,
            digest_mismatch_count,
            digest_mismatch_source_kinds,
        } = fuse_sources(&source_outputs, &self.config, query.max_candidates);

        RetrievalResult {
            diagnostics: RetrievalDiagnostics {
                fusion_method: self.config.fusion_method,
                fusion_k: self.config.rrf_k,
                domain_rank_shift_applied: true,
                domain_rank_version: self.config.domain_rank_version.clone(),
                total_candidates_before_fusion,
                total_candidates_after_fusion: candidates.len(),
                digest_mismatch_count,
                digest_mismatch_source_kinds,
                sources: diagnostics,
                total_latency_ms: elapsed_ms(started),
            },
            candidates,
        }
    }

    async fn collect_source(
        &self,
        source_id: RetrievalSourceId,
        source: Option<&Arc<dyn HybridRetrievalSource>>,
        query: &RetrievalQuery,
        source_outputs: &mut Vec<SourceSearchOutcome>,
        diagnostics: &mut Vec<RetrievalSourceDiagnostic>,
    ) {
        let Some(source) = source else {
            diagnostics.push(unavailable_diagnostic(source_id));
            return;
        };
        let started = Instant::now();
        match source.search(query).await {
            Ok(mut outcome) => {
                outcome.diagnostic.latency_ms = elapsed_ms(started);
                diagnostics.push(outcome.diagnostic.clone());
                source_outputs.push(outcome);
            }
            Err(_) => diagnostics.push(RetrievalSourceDiagnostic {
                source_id,
                status: SourceStatus::Degraded,
                candidate_count: 0,
                latency_ms: elapsed_ms(started),
                index_version: None,
                projection_version: None,
                last_rebuild: None,
                degradation_reason: Some(DegradationReason::SearchFailed),
            }),
        }
    }
}

pub trait HybridRetrievalSource: Send + Sync {
    fn search<'a>(
        &'a self,
        query: &'a RetrievalQuery,
    ) -> Pin<Box<dyn Future<Output = Result<SourceSearchOutcome, ServiceError>> + Send + 'a>>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct SourceSearchOutcome {
    pub source_id: RetrievalSourceId,
    pub candidates: Vec<SourceCandidate>,
    pub diagnostic: RetrievalSourceDiagnostic,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SourceCandidate {
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: String,
    pub projection_version: String,
    pub content_digest: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub native_score: f32,
    pub text_preview: Option<String>,
}

impl SourceCandidate {
    fn dedupe_key(&self) -> DedupeKey {
        DedupeKey {
            source_kind: self.source_kind.clone(),
            source_id: self.source_id.clone(),
            chunk_ref: self.chunk_ref.clone(),
            projection_version: self.projection_version.clone(),
        }
    }
}

#[derive(Clone)]
pub struct TantivyHybridSource {
    adapter: Arc<TantivyRetrievalAdapter>,
}

impl TantivyHybridSource {
    pub fn new(adapter: Arc<TantivyRetrievalAdapter>) -> Self {
        Self { adapter }
    }
}

impl HybridRetrievalSource for TantivyHybridSource {
    fn search<'a>(
        &'a self,
        query: &'a RetrievalQuery,
    ) -> Pin<Box<dyn Future<Output = Result<SourceSearchOutcome, ServiceError>> + Send + 'a>> {
        Box::pin(async move {
            let request = TantivySearchRequest {
                query: query.query.clone(),
                limit: query.max_candidates,
                source_kinds: query.source_kinds.clone(),
                exact: false,
            };
            let result = self.adapter.search(&request)?;
            let diagnostics = self.adapter.diagnostics()?;
            let candidate_count = result.candidates.len();
            Ok(SourceSearchOutcome {
                source_id: RetrievalSourceId::Tantivy,
                candidates: result
                    .candidates
                    .into_iter()
                    .map(|candidate| SourceCandidate {
                        source_kind: candidate.source_kind,
                        source_id: candidate.source_id,
                        chunk_ref: candidate.chunk_ref,
                        projection_version: candidate.projection_version,
                        content_digest: candidate.content_digest,
                        loom_id: None,
                        response_id: None,
                        native_score: candidate.bm25_score,
                        text_preview: None,
                    })
                    .collect(),
                diagnostic: diagnostic_for_tantivy(candidate_count, diagnostics),
            })
        })
    }
}

#[derive(Clone)]
pub struct LanceDbHybridSource {
    adapter: Arc<LanceDbRetrievalAdapter>,
}

impl LanceDbHybridSource {
    pub fn new(adapter: Arc<LanceDbRetrievalAdapter>) -> Self {
        Self { adapter }
    }
}

impl HybridRetrievalSource for LanceDbHybridSource {
    fn search<'a>(
        &'a self,
        query: &'a RetrievalQuery,
    ) -> Pin<Box<dyn Future<Output = Result<SourceSearchOutcome, ServiceError>> + Send + 'a>> {
        Box::pin(async move {
            let request = LanceDbSearchRequest {
                query: query.query.clone(),
                limit: query.max_candidates,
                source_kinds: query.source_kinds.clone(),
            };
            let result = self.adapter.search(&request).await?;
            let diagnostics = self.adapter.diagnostics()?;
            let candidate_count = result.candidates.len();
            Ok(SourceSearchOutcome {
                source_id: RetrievalSourceId::LanceDb,
                candidates: result
                    .candidates
                    .into_iter()
                    .map(|candidate| SourceCandidate {
                        source_kind: candidate.source_kind,
                        source_id: candidate.source_id,
                        chunk_ref: candidate.chunk_ref,
                        projection_version: candidate.projection_version,
                        content_digest: candidate.content_digest,
                        loom_id: None,
                        response_id: None,
                        native_score: candidate.vector_score,
                        text_preview: None,
                    })
                    .collect(),
                diagnostic: diagnostic_for_lancedb(candidate_count, diagnostics),
            })
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct DedupeKey {
    source_kind: String,
    source_id: String,
    chunk_ref: String,
    projection_version: String,
}

#[derive(Debug)]
struct FusionCandidate {
    key: DedupeKey,
    content_digest: String,
    loom_id: Option<String>,
    response_id: Option<String>,
    text_preview: Option<String>,
    score: f32,
    contributing_sources: BTreeSet<RetrievalSourceId>,
    rank_signals: RankSignals,
    digest_values: BTreeSet<String>,
}

#[derive(Debug)]
struct FusionOutcome {
    candidates: Vec<RetrievalCandidate>,
    digest_mismatch_count: usize,
    digest_mismatch_source_kinds: Vec<String>,
}

fn fuse_sources(
    sources: &[SourceSearchOutcome],
    config: &HybridFusionConfig,
    max_candidates: usize,
) -> FusionOutcome {
    if max_candidates == 0 {
        return FusionOutcome {
            candidates: Vec::new(),
            digest_mismatch_count: 0,
            digest_mismatch_source_kinds: Vec::new(),
        };
    }

    let mut fused: HashMap<DedupeKey, FusionCandidate> = HashMap::new();
    for source in sources {
        let ranked = adjusted_ranked_candidates(source, config);
        for (adjusted_rank, candidate) in ranked.into_iter().enumerate() {
            let rank = adjusted_rank + 1;
            let rrf_score = 1.0 / (config.rrf_k + rank as f32);
            let key = candidate.dedupe_key();
            let entry = fused.entry(key.clone()).or_insert_with(|| FusionCandidate {
                key,
                content_digest: candidate.content_digest.clone(),
                loom_id: candidate.loom_id.clone(),
                response_id: candidate.response_id.clone(),
                text_preview: bounded_preview(candidate.text_preview.as_deref()),
                score: 0.0,
                contributing_sources: BTreeSet::new(),
                rank_signals: RankSignals::default(),
                digest_values: BTreeSet::new(),
            });
            entry.score += rrf_score;
            entry.contributing_sources.insert(source.source_id);
            entry.digest_values.insert(candidate.content_digest.clone());
            if entry.loom_id.is_none() {
                entry.loom_id = candidate.loom_id.clone();
            }
            if entry.response_id.is_none() {
                entry.response_id = candidate.response_id.clone();
            }
            if entry.text_preview.is_none() {
                entry.text_preview = bounded_preview(candidate.text_preview.as_deref());
            }
            match source.source_id {
                RetrievalSourceId::Tantivy => {
                    entry.rank_signals.bm25_rank = Some(rank);
                    entry.rank_signals.bm25_score = Some(candidate.native_score);
                }
                RetrievalSourceId::LanceDb => {
                    entry.rank_signals.vector_rank = Some(rank);
                    entry.rank_signals.vector_score = Some(candidate.native_score);
                }
            }
        }
    }

    let mut digest_mismatch_source_kinds = BTreeSet::new();
    let digest_mismatch_count = fused
        .values()
        .filter(|candidate| {
            let mismatched = candidate.digest_values.len() > 1;
            if mismatched {
                digest_mismatch_source_kinds.insert(candidate.key.source_kind.clone());
            }
            mismatched
        })
        .count();

    let mut candidates = fused
        .into_values()
        .map(|candidate| RetrievalCandidate {
            source_kind: candidate.key.source_kind,
            source_id: candidate.key.source_id,
            chunk_ref: candidate.key.chunk_ref,
            projection_version: candidate.key.projection_version,
            content_digest: candidate.content_digest,
            loom_id: candidate.loom_id,
            response_id: candidate.response_id,
            relevance_score: candidate.score,
            rank_signals: candidate.rank_signals,
            text_preview: candidate.text_preview,
            contributing_sources: candidate.contributing_sources.into_iter().collect(),
        })
        .collect::<Vec<_>>();

    candidates.sort_by(compare_candidates);
    candidates.truncate(max_candidates);
    FusionOutcome {
        candidates,
        digest_mismatch_count,
        digest_mismatch_source_kinds: digest_mismatch_source_kinds.into_iter().collect(),
    }
}

fn adjusted_ranked_candidates<'a>(
    source: &'a SourceSearchOutcome,
    config: &HybridFusionConfig,
) -> Vec<&'a SourceCandidate> {
    let mut candidates = source
        .candidates
        .iter()
        .filter(|candidate| allowed_source_kind(&candidate.source_kind))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        adjusted_score(right, config)
            .partial_cmp(&adjusted_score(left, config))
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.source_kind.cmp(&right.source_kind))
            .then_with(|| left.source_id.cmp(&right.source_id))
            .then_with(|| left.chunk_ref.cmp(&right.chunk_ref))
            .then_with(|| left.projection_version.cmp(&right.projection_version))
    });
    candidates
}

fn adjusted_score(candidate: &SourceCandidate, config: &HybridFusionConfig) -> f32 {
    let weight = config
        .domain_weights
        .get(candidate.source_kind.as_str())
        .copied()
        .unwrap_or(1.0);
    candidate.native_score * weight
}

fn compare_candidates(left: &RetrievalCandidate, right: &RetrievalCandidate) -> Ordering {
    right
        .relevance_score
        .partial_cmp(&left.relevance_score)
        .unwrap_or(Ordering::Equal)
        .then_with(|| left.source_kind.cmp(&right.source_kind))
        .then_with(|| left.source_id.cmp(&right.source_id))
        .then_with(|| left.chunk_ref.cmp(&right.chunk_ref))
        .then_with(|| left.projection_version.cmp(&right.projection_version))
}

fn bounded_preview(preview: Option<&str>) -> Option<String> {
    let preview = preview?.trim();
    if preview.is_empty() || contains_forbidden_marker(preview) {
        return None;
    }
    Some(preview.chars().take(MAX_TEXT_PREVIEW_CHARS).collect())
}

fn allowed_source_kind(source_kind: &str) -> bool {
    matches!(
        source_kind,
        "memory"
            | "attachment_chunk"
            | "response"
            | "reference"
            | "response_capsule"
            | "checkpoint"
            | "unknown"
    )
}

fn contains_forbidden_marker(value: &str) -> bool {
    const FORBIDDEN: [&str; 20] = [
        "raw_thinking",
        "thinking_text",
        "chain_of_thought",
        "hidden_reasoning",
        "rawThinking",
        "thinkingText",
        "chainOfThought",
        "hiddenReasoning",
        "provider_delta",
        "providerDelta",
        "provider_payload",
        "providerPayload",
        "Authorization",
        "Bearer ",
        "apiKey",
        "api_key",
        "password",
        "credential",
        "secret",
        "sk-",
    ];
    FORBIDDEN.iter().any(|forbidden| value.contains(forbidden))
}

fn unavailable_diagnostic(source_id: RetrievalSourceId) -> RetrievalSourceDiagnostic {
    RetrievalSourceDiagnostic {
        source_id,
        status: SourceStatus::Unavailable,
        candidate_count: 0,
        latency_ms: 0,
        index_version: None,
        projection_version: None,
        last_rebuild: None,
        degradation_reason: Some(DegradationReason::SourceUnavailable),
    }
}

fn diagnostic_for_tantivy(
    candidate_count: usize,
    diagnostics: TantivyIndexDiagnostics,
) -> RetrievalSourceDiagnostic {
    RetrievalSourceDiagnostic {
        source_id: RetrievalSourceId::Tantivy,
        status: SourceStatus::Ready,
        candidate_count,
        latency_ms: 0,
        index_version: Some(diagnostics.index_version),
        projection_version: Some(diagnostics.projection_version),
        last_rebuild: diagnostics.last_rebuild,
        degradation_reason: None,
    }
}

fn diagnostic_for_lancedb(
    candidate_count: usize,
    diagnostics: LanceDbIndexDiagnostics,
) -> RetrievalSourceDiagnostic {
    RetrievalSourceDiagnostic {
        source_id: RetrievalSourceId::LanceDb,
        status: SourceStatus::Ready,
        candidate_count,
        latency_ms: 0,
        index_version: Some(diagnostics.index_version),
        projection_version: Some(diagnostics.projection_version),
        last_rebuild: diagnostics.last_rebuild,
        degradation_reason: None,
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

fn default_domain_weights() -> HashMap<String, f32> {
    [
        ("memory", 1.2),
        ("attachment_chunk", 1.1),
        ("response", 1.0),
        ("reference", 1.0),
        ("response_capsule", 1.0),
        ("checkpoint", 1.0),
        ("unknown", 1.0),
    ]
    .into_iter()
    .map(|(kind, weight)| (kind.to_string(), weight))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pure_rrf_fuses_two_sources() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![candidate("response", "a", 9.0)],
            )),
            Some(fake_source(
                RetrievalSourceId::LanceDb,
                vec![candidate("response", "b", 9.0)],
            )),
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        assert_eq!(result.candidates.len(), 2);
        assert_eq!(
            result.diagnostics.fusion_method,
            FusionMethod::ReciprocalRankFusion
        );
        assert_eq!(result.diagnostics.fusion_k, 60.0);
    }

    #[tokio::test]
    async fn domain_rank_pre_shift_changes_source_rank_order() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![
                    candidate("response", "response-a", 1.0),
                    candidate("memory", "memory-a", 0.9),
                ],
            )),
            None,
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        assert_eq!(result.candidates[0].source_kind, "memory");
        assert_eq!(result.candidates[0].rank_signals.bm25_rank, Some(1));
    }

    #[tokio::test]
    async fn dedupe_merges_tantivy_and_lancedb_candidates() {
        let left = candidate("response", "shared", 10.0);
        let right = candidate("response", "shared", 8.0);
        let service = service_with(
            Some(fake_source(RetrievalSourceId::Tantivy, vec![left])),
            Some(fake_source(RetrievalSourceId::LanceDb, vec![right])),
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(
            result.candidates[0].contributing_sources,
            vec![RetrievalSourceId::Tantivy, RetrievalSourceId::LanceDb]
        );
        assert!(result.candidates[0].rank_signals.bm25_score.is_some());
        assert!(result.candidates[0].rank_signals.vector_score.is_some());
    }

    #[tokio::test]
    async fn digest_mismatch_is_diagnostic_not_rejection() {
        let mut left = candidate("response", "shared", 10.0);
        let mut right = candidate("response", "shared", 8.0);
        left.content_digest = "digest-a".to_string();
        right.content_digest = "digest-b".to_string();
        let service = service_with(
            Some(fake_source(RetrievalSourceId::Tantivy, vec![left])),
            Some(fake_source(RetrievalSourceId::LanceDb, vec![right])),
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.diagnostics.digest_mismatch_count, 1);
        assert_eq!(
            result.diagnostics.digest_mismatch_source_kinds,
            vec!["response".to_string()]
        );
    }

    #[tokio::test]
    async fn keyword_only_queries_tantivy_only() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![candidate("response", "a", 1.0)],
            )),
            Some(fake_source(
                RetrievalSourceId::LanceDb,
                vec![candidate("response", "b", 1.0)],
            )),
        );
        let mut query = RetrievalQuery::hybrid("query");
        query.mode = RetrievalMode::KeywordOnly;
        let result = service.retrieve(&query).await;
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].source_id, "a");
        assert_eq!(result.diagnostics.sources.len(), 1);
    }

    #[tokio::test]
    async fn semantic_only_queries_lancedb_only() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![candidate("response", "a", 1.0)],
            )),
            Some(fake_source(
                RetrievalSourceId::LanceDb,
                vec![candidate("response", "b", 1.0)],
            )),
        );
        let mut query = RetrievalQuery::hybrid("query");
        query.mode = RetrievalMode::SemanticOnly;
        let result = service.retrieve(&query).await;
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].source_id, "b");
        assert_eq!(result.diagnostics.sources.len(), 1);
    }

    #[tokio::test]
    async fn hybrid_partial_source_unavailable_degrades() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![candidate("response", "a", 1.0)],
            )),
            None,
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        assert_eq!(result.candidates.len(), 1);
        assert!(result.diagnostics.sources.iter().any(|diagnostic| {
            diagnostic.source_id == RetrievalSourceId::LanceDb
                && diagnostic.status == SourceStatus::Unavailable
                && diagnostic.degradation_reason == Some(DegradationReason::SourceUnavailable)
        }));
    }

    #[tokio::test]
    async fn both_sources_unavailable_returns_empty_diagnostics() {
        let service = service_with(None, None);
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        assert!(result.candidates.is_empty());
        assert_eq!(result.diagnostics.sources.len(), 2);
        assert!(result
            .diagnostics
            .sources
            .iter()
            .all(|diagnostic| diagnostic.status == SourceStatus::Unavailable));
    }

    #[tokio::test]
    async fn source_search_failure_returns_partial_result() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![candidate("response", "a", 1.0)],
            )),
            Some(failing_source()),
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        assert_eq!(result.candidates.len(), 1);
        assert!(result.diagnostics.sources.iter().any(|diagnostic| {
            diagnostic.source_id == RetrievalSourceId::LanceDb
                && diagnostic.status == SourceStatus::Degraded
                && diagnostic.degradation_reason == Some(DegradationReason::SearchFailed)
        }));
    }

    #[tokio::test]
    async fn max_candidates_trims_fused_results() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![
                    candidate("response", "a", 5.0),
                    candidate("response", "b", 4.0),
                    candidate("response", "c", 3.0),
                ],
            )),
            None,
        );
        let mut query = RetrievalQuery::hybrid("query");
        query.max_candidates = 2;
        let result = service.retrieve(&query).await;
        assert_eq!(result.candidates.len(), 2);
        assert_eq!(result.diagnostics.total_candidates_after_fusion, 2);
    }

    #[tokio::test]
    async fn rank_signals_are_preserved() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![candidate("response", "a", 5.0)],
            )),
            Some(fake_source(
                RetrievalSourceId::LanceDb,
                vec![candidate("response", "a", 0.7)],
            )),
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        let signals = &result.candidates[0].rank_signals;
        assert_eq!(signals.bm25_rank, Some(1));
        assert_eq!(signals.bm25_score, Some(5.0));
        assert_eq!(signals.vector_rank, Some(1));
        assert_eq!(signals.vector_score, Some(0.7));
    }

    #[tokio::test]
    async fn previews_are_bounded_and_forbidden_payloads_are_not_returned() {
        let mut safe = candidate("response", "safe", 3.0);
        safe.text_preview = Some("x".repeat(MAX_TEXT_PREVIEW_CHARS + 50));
        let mut unsafe_candidate = candidate("response", "unsafe", 2.0);
        unsafe_candidate.text_preview = Some("raw_thinking should never leave retrieval".into());
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![safe, unsafe_candidate],
            )),
            None,
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        let safe_preview = result
            .candidates
            .iter()
            .find(|candidate| candidate.source_id == "safe")
            .and_then(|candidate| candidate.text_preview.as_ref())
            .expect("safe preview");
        assert_eq!(safe_preview.chars().count(), MAX_TEXT_PREVIEW_CHARS);
        assert!(result
            .candidates
            .iter()
            .find(|candidate| candidate.source_id == "unsafe")
            .and_then(|candidate| candidate.text_preview.as_ref())
            .is_none());
    }

    #[tokio::test]
    async fn source_filtering_applies_across_sources() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![
                    candidate("response", "a", 5.0),
                    candidate("memory", "b", 4.0),
                ],
            )),
            Some(fake_source(
                RetrievalSourceId::LanceDb,
                vec![
                    candidate("response", "c", 5.0),
                    candidate("memory", "d", 4.0),
                ],
            )),
        );
        let mut query = RetrievalQuery::hybrid("query");
        query.source_kinds = vec!["memory".to_string()];
        let result = service.retrieve(&query).await;
        assert_eq!(result.candidates.len(), 2);
        assert!(result
            .candidates
            .iter()
            .all(|candidate| candidate.source_kind == "memory"));
    }

    #[tokio::test]
    async fn deterministic_ordering_for_ties() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![
                    candidate("response", "b", 1.0),
                    candidate("response", "a", 1.0),
                ],
            )),
            None,
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        assert_eq!(result.candidates[0].source_id, "a");
        assert_eq!(result.candidates[1].source_id, "b");
    }

    #[tokio::test]
    async fn agent_event_source_exclusion_remains_preserved() {
        let service = service_with(
            Some(fake_source(
                RetrievalSourceId::Tantivy,
                vec![
                    candidate("response", "a", 1.0),
                    candidate("agent_event", "audit-a", 99.0),
                    candidate("agent_step", "step-a", 98.0),
                ],
            )),
            None,
        );
        let result = service.retrieve(&RetrievalQuery::hybrid("query")).await;
        assert!(!result
            .candidates
            .iter()
            .any(|candidate| candidate.source_kind.starts_with("agent_")));
    }

    fn service_with(
        keyword: Option<Arc<dyn HybridRetrievalSource>>,
        semantic: Option<Arc<dyn HybridRetrievalSource>>,
    ) -> HybridRetrievalService {
        HybridRetrievalService::new(keyword, semantic)
    }

    fn fake_source(
        source_id: RetrievalSourceId,
        candidates: Vec<SourceCandidate>,
    ) -> Arc<dyn HybridRetrievalSource> {
        Arc::new(FakeSource {
            source_id,
            candidates,
            fail: false,
        })
    }

    fn failing_source() -> Arc<dyn HybridRetrievalSource> {
        Arc::new(FakeSource {
            source_id: RetrievalSourceId::LanceDb,
            candidates: Vec::new(),
            fail: true,
        })
    }

    fn candidate(source_kind: &str, source_id: &str, native_score: f32) -> SourceCandidate {
        SourceCandidate {
            source_kind: source_kind.to_string(),
            source_id: source_id.to_string(),
            chunk_ref: format!("{source_kind}:{source_id}:chunk"),
            projection_version: "sqlite-retrieval-projection-v1".to_string(),
            content_digest: format!("digest-{source_kind}-{source_id}"),
            loom_id: Some("loom-a".to_string()),
            response_id: Some("resp-a".to_string()),
            native_score,
            text_preview: Some(format!("preview for {source_kind} {source_id}")),
        }
    }

    struct FakeSource {
        source_id: RetrievalSourceId,
        candidates: Vec<SourceCandidate>,
        fail: bool,
    }

    impl HybridRetrievalSource for FakeSource {
        fn search<'a>(
            &'a self,
            query: &'a RetrievalQuery,
        ) -> Pin<Box<dyn Future<Output = Result<SourceSearchOutcome, ServiceError>> + Send + 'a>>
        {
            Box::pin(async move {
                if self.fail {
                    return Err(ServiceError::storage("synthetic search failure"));
                }
                let source_filter = query.source_kinds.iter().collect::<BTreeSet<_>>();
                let candidates = self
                    .candidates
                    .iter()
                    .filter(|candidate| {
                        source_filter.is_empty() || source_filter.contains(&candidate.source_kind)
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                Ok(SourceSearchOutcome {
                    source_id: self.source_id,
                    diagnostic: RetrievalSourceDiagnostic {
                        source_id: self.source_id,
                        status: SourceStatus::Ready,
                        candidate_count: candidates.len(),
                        latency_ms: 0,
                        index_version: Some(format!("{:?}-test-index", self.source_id)),
                        projection_version: Some("sqlite-retrieval-projection-v1".to_string()),
                        last_rebuild: Some("1".to_string()),
                        degradation_reason: None,
                    },
                    candidates,
                })
            })
        }
    }
}
