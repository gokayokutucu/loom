#![allow(dead_code)]

//! Privacy-safe Context Snapshot persistence.
//!
//! Snapshot records contain source references, selection decisions, budget
//! metadata, and diagnostics. They never contain source content or prompts.

use crate::{error::ServiceError, storage::db::Database};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, Sqlite, SqlitePool};

const FORBIDDEN_JSON_MARKERS: [&str; 17] = [
    "rawthinking",
    "thinkingtext",
    "chainofthought",
    "hiddenreasoning",
    "content",
    "prompt",
    "messages",
    "providerpayload",
    "providerdelta",
    "authorization",
    "bearer",
    "apikey",
    "password",
    "credential",
    "secret",
    "vector",
    "rawtooloutput",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshotRecord {
    pub snapshot_id: String,
    pub agent_run_id: Option<String>,
    pub loom_id: String,
    pub response_id: Option<String>,
    pub scope_context_id: Option<String>,
    pub created_at: String,
    pub policy_version: String,
    pub selection_version: String,
    pub budget_json: String,
    pub diagnostics_json: String,
    pub candidate_count: i64,
    pub selected_count: i64,
    pub rejected_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshotCandidateRecord {
    pub snapshot_candidate_id: String,
    pub snapshot_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: String,
    pub tier: String,
    pub include_mode_hint: String,
    pub estimated_tokens: i64,
    pub retrieval_score: Option<f64>,
    pub final_rank: i64,
    pub is_mandatory: bool,
    pub is_hidden_background: bool,
    pub is_selected: bool,
    pub rejection_reason: Option<String>,
    pub metadata_json: String,
}

#[derive(Debug, Clone)]
pub struct ContextSnapshotCreateRequest {
    pub snapshot_id: String,
    pub agent_run_id: Option<String>,
    pub loom_id: String,
    pub response_id: Option<String>,
    pub scope_context_id: Option<String>,
    pub created_at: String,
    pub policy_version: String,
    pub selection_version: String,
    pub budget_json: String,
    pub diagnostics_json: String,
    pub candidate_count: i64,
    pub selected_count: i64,
    pub rejected_count: i64,
}

#[derive(Debug, Clone)]
pub struct ContextSnapshotCandidateCreateRequest {
    pub snapshot_candidate_id: String,
    pub snapshot_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: String,
    pub tier: String,
    pub include_mode_hint: String,
    pub estimated_tokens: i64,
    pub retrieval_score: Option<f64>,
    pub final_rank: i64,
    pub is_mandatory: bool,
    pub is_hidden_background: bool,
    pub is_selected: bool,
    pub rejection_reason: Option<String>,
    pub metadata_json: String,
}

#[derive(Debug, Clone)]
pub struct ContextSnapshotRepository {
    pool: SqlitePool,
}

impl ContextSnapshotRepository {
    pub fn new(database: &Database) -> Self {
        Self::from_pool(database.pool())
    }

    pub fn from_pool(pool: &SqlitePool) -> Self {
        Self { pool: pool.clone() }
    }

    pub async fn insert_snapshot(
        &self,
        snapshot: &ContextSnapshotCreateRequest,
    ) -> Result<(), ServiceError> {
        validate_snapshot(snapshot)?;
        insert_snapshot_on(&self.pool, snapshot).await
    }

    pub async fn insert_candidate(
        &self,
        candidate: &ContextSnapshotCandidateCreateRequest,
    ) -> Result<(), ServiceError> {
        validate_candidate(candidate)?;
        insert_candidate_on(&self.pool, candidate).await
    }

    pub async fn create_snapshot_with_candidates(
        &self,
        snapshot: &ContextSnapshotCreateRequest,
        candidates: &[ContextSnapshotCandidateCreateRequest],
    ) -> Result<(), ServiceError> {
        validate_snapshot(snapshot)?;
        validate_snapshot_counts(snapshot, candidates)?;
        for candidate in candidates {
            validate_candidate(candidate)?;
            if candidate.snapshot_id != snapshot.snapshot_id {
                return Err(ServiceError::storage(
                    "context snapshot candidate belongs to a different snapshot",
                ));
            }
        }

        let mut transaction = self.pool.begin().await.map_err(|error| {
            ServiceError::storage(format!(
                "failed to begin context snapshot transaction: {error}"
            ))
        })?;
        insert_snapshot_on(&mut transaction, snapshot).await?;
        for candidate in candidates {
            insert_candidate_on(&mut transaction, candidate).await?;
        }
        transaction.commit().await.map_err(|error| {
            ServiceError::storage(format!(
                "failed to commit context snapshot transaction: {error}"
            ))
        })
    }

    pub async fn get_snapshot(
        &self,
        snapshot_id: &str,
    ) -> Result<Option<ContextSnapshotRecord>, ServiceError> {
        sqlx::query(
            "SELECT snapshot_id, agent_run_id, loom_id, response_id, scope_context_id,
                    created_at, policy_version, selection_version, budget_json,
                    diagnostics_json, candidate_count, selected_count, rejected_count
             FROM context_snapshots WHERE snapshot_id = ?1",
        )
        .bind(snapshot_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(snapshot_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to get context snapshot: {error}")))
    }

    pub async fn get_snapshot_for_agent_run(
        &self,
        agent_run_id: &str,
    ) -> Result<Option<ContextSnapshotRecord>, ServiceError> {
        sqlx::query(
            "SELECT snapshot_id, agent_run_id, loom_id, response_id, scope_context_id,
                    created_at, policy_version, selection_version, budget_json,
                    diagnostics_json, candidate_count, selected_count, rejected_count
             FROM context_snapshots WHERE agent_run_id = ?1",
        )
        .bind(agent_run_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(snapshot_from_row))
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to get context snapshot for agent run: {error}"
            ))
        })
    }

    pub async fn list_candidates(
        &self,
        snapshot_id: &str,
    ) -> Result<Vec<ContextSnapshotCandidateRecord>, ServiceError> {
        sqlx::query(
            "SELECT snapshot_candidate_id, snapshot_id, source_kind, source_id,
                    chunk_ref, tier, include_mode_hint, estimated_tokens,
                    retrieval_score, final_rank, is_mandatory, is_hidden_background,
                    is_selected, rejection_reason, metadata_json
             FROM context_snapshot_candidates
             WHERE snapshot_id = ?1
             ORDER BY final_rank ASC, snapshot_candidate_id ASC",
        )
        .bind(snapshot_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(candidate_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to list context snapshot candidates: {error}"
            ))
        })
    }
}

async fn insert_snapshot_on<'e, E>(
    executor: E,
    snapshot: &ContextSnapshotCreateRequest,
) -> Result<(), ServiceError>
where
    E: sqlx::Executor<'e, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO context_snapshots (
            snapshot_id, agent_run_id, loom_id, response_id, scope_context_id,
            created_at, policy_version, selection_version, budget_json,
            diagnostics_json, candidate_count, selected_count, rejected_count
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
    )
    .bind(&snapshot.snapshot_id)
    .bind(&snapshot.agent_run_id)
    .bind(&snapshot.loom_id)
    .bind(&snapshot.response_id)
    .bind(&snapshot.scope_context_id)
    .bind(&snapshot.created_at)
    .bind(&snapshot.policy_version)
    .bind(&snapshot.selection_version)
    .bind(&snapshot.budget_json)
    .bind(&snapshot.diagnostics_json)
    .bind(snapshot.candidate_count)
    .bind(snapshot.selected_count)
    .bind(snapshot.rejected_count)
    .execute(executor)
    .await
    .map(|_| ())
    .map_err(|error| ServiceError::storage(format!("failed to insert context snapshot: {error}")))
}

async fn insert_candidate_on<'e, E>(
    executor: E,
    candidate: &ContextSnapshotCandidateCreateRequest,
) -> Result<(), ServiceError>
where
    E: sqlx::Executor<'e, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO context_snapshot_candidates (
            snapshot_candidate_id, snapshot_id, source_kind, source_id, chunk_ref,
            tier, include_mode_hint, estimated_tokens, retrieval_score, final_rank,
            is_mandatory, is_hidden_background, is_selected, rejection_reason, metadata_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
    )
    .bind(&candidate.snapshot_candidate_id)
    .bind(&candidate.snapshot_id)
    .bind(&candidate.source_kind)
    .bind(&candidate.source_id)
    .bind(&candidate.chunk_ref)
    .bind(&candidate.tier)
    .bind(&candidate.include_mode_hint)
    .bind(candidate.estimated_tokens)
    .bind(candidate.retrieval_score)
    .bind(candidate.final_rank)
    .bind(i64::from(candidate.is_mandatory))
    .bind(i64::from(candidate.is_hidden_background))
    .bind(i64::from(candidate.is_selected))
    .bind(&candidate.rejection_reason)
    .bind(&candidate.metadata_json)
    .execute(executor)
    .await
    .map(|_| ())
    .map_err(|error| {
        ServiceError::storage(format!(
            "failed to insert context snapshot candidate: {error}"
        ))
    })
}

fn validate_snapshot(snapshot: &ContextSnapshotCreateRequest) -> Result<(), ServiceError> {
    if snapshot.candidate_count < 0
        || snapshot.selected_count < 0
        || snapshot.rejected_count < 0
        || snapshot.candidate_count != snapshot.selected_count + snapshot.rejected_count
    {
        return Err(ServiceError::storage(
            "context snapshot candidate counts are inconsistent",
        ));
    }
    validate_safe_json("budget_json", &snapshot.budget_json)?;
    validate_safe_json("diagnostics_json", &snapshot.diagnostics_json)
}

fn validate_candidate(
    candidate: &ContextSnapshotCandidateCreateRequest,
) -> Result<(), ServiceError> {
    if candidate.estimated_tokens < 0 || candidate.final_rank < 1 {
        return Err(ServiceError::storage(
            "context snapshot candidate has invalid token count or rank",
        ));
    }
    if let Some(reason) = &candidate.rejection_reason {
        reject_marker("rejection_reason", reason)?;
    }
    validate_safe_json("metadata_json", &candidate.metadata_json)
}

fn validate_snapshot_counts(
    snapshot: &ContextSnapshotCreateRequest,
    candidates: &[ContextSnapshotCandidateCreateRequest],
) -> Result<(), ServiceError> {
    let selected = candidates
        .iter()
        .filter(|candidate| candidate.is_selected)
        .count() as i64;
    let rejected = candidates.len() as i64 - selected;
    if snapshot.candidate_count != candidates.len() as i64
        || snapshot.selected_count != selected
        || snapshot.rejected_count != rejected
    {
        return Err(ServiceError::storage(
            "context snapshot counts do not match supplied candidates",
        ));
    }
    Ok(())
}

fn validate_safe_json(field: &str, raw: &str) -> Result<(), ServiceError> {
    let value: Value = serde_json::from_str(raw).map_err(|error| {
        ServiceError::storage(format!(
            "context snapshot {field} is not valid JSON: {error}"
        ))
    })?;
    inspect_json_value(field, &value)
}

fn inspect_json_value(field: &str, value: &Value) -> Result<(), ServiceError> {
    match value {
        Value::Object(entries) => {
            for (key, child) in entries {
                reject_marker(field, key)?;
                inspect_json_value(field, child)?;
            }
        }
        Value::Array(entries) => {
            for child in entries {
                inspect_json_value(field, child)?;
            }
        }
        Value::String(text) => reject_marker(field, text)?,
        _ => {}
    }
    Ok(())
}

fn reject_marker(field: &str, text: &str) -> Result<(), ServiceError> {
    let normalized = text
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    if let Some(marker) = FORBIDDEN_JSON_MARKERS
        .iter()
        .find(|marker| normalized.contains(**marker))
    {
        return Err(ServiceError::storage(format!(
            "context snapshot {field} contains forbidden privacy marker: {marker}"
        )));
    }
    Ok(())
}

fn snapshot_from_row(row: sqlx::sqlite::SqliteRow) -> ContextSnapshotRecord {
    ContextSnapshotRecord {
        snapshot_id: row.get("snapshot_id"),
        agent_run_id: row.get("agent_run_id"),
        loom_id: row.get("loom_id"),
        response_id: row.get("response_id"),
        scope_context_id: row.get("scope_context_id"),
        created_at: row.get("created_at"),
        policy_version: row.get("policy_version"),
        selection_version: row.get("selection_version"),
        budget_json: row.get("budget_json"),
        diagnostics_json: row.get("diagnostics_json"),
        candidate_count: row.get("candidate_count"),
        selected_count: row.get("selected_count"),
        rejected_count: row.get("rejected_count"),
    }
}

fn candidate_from_row(row: sqlx::sqlite::SqliteRow) -> ContextSnapshotCandidateRecord {
    ContextSnapshotCandidateRecord {
        snapshot_candidate_id: row.get("snapshot_candidate_id"),
        snapshot_id: row.get("snapshot_id"),
        source_kind: row.get("source_kind"),
        source_id: row.get("source_id"),
        chunk_ref: row.get("chunk_ref"),
        tier: row.get("tier"),
        include_mode_hint: row.get("include_mode_hint"),
        estimated_tokens: row.get("estimated_tokens"),
        retrieval_score: row.get("retrieval_score"),
        final_rank: row.get("final_rank"),
        is_mandatory: row.get::<i64, _>("is_mandatory") != 0,
        is_hidden_background: row.get::<i64, _>("is_hidden_background") != 0,
        is_selected: row.get::<i64, _>("is_selected") != 0,
        rejection_reason: row.get("rejection_reason"),
        metadata_json: row.get("metadata_json"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db::test_database;

    async fn setup() -> (Database, ContextSnapshotRepository) {
        let database = test_database().await;
        sqlx::query(
            "INSERT INTO looms (
                loom_id, title, summary, code, canonical_uri, kind, created_at, updated_at
             ) VALUES ('loom-snapshot', 'Snapshot Loom', NULL, NULL,
                       '/loom/snapshot', 'loom', '1', '1')",
        )
        .execute(database.pool())
        .await
        .expect("seed loom");
        let repository = ContextSnapshotRepository::new(&database);
        (database, repository)
    }

    fn snapshot(
        id: &str,
        candidate_count: i64,
        selected_count: i64,
    ) -> ContextSnapshotCreateRequest {
        ContextSnapshotCreateRequest {
            snapshot_id: id.to_string(),
            agent_run_id: None,
            loom_id: "loom-snapshot".to_string(),
            response_id: None,
            scope_context_id: Some("scope-context-1".to_string()),
            created_at: "2026-06-18T10:00:00Z".to_string(),
            policy_version: "context-policy-v1".to_string(),
            selection_version: "context-selection-v1".to_string(),
            budget_json: serde_json::json!({
                "estimatedTokensBefore": 180,
                "estimatedTokensAfter": 120,
                "budgetLimit": 256,
                "candidatesPresented": candidate_count,
                "candidatesIncluded": selected_count,
                "candidatesRejected": candidate_count - selected_count,
                "rejectionReasons": {"budgetExceeded": candidate_count - selected_count}
            })
            .to_string(),
            diagnostics_json: serde_json::json!({
                "scopeCount": 2,
                "retrievalLatencyMs": 7,
                "fallbackUsed": false
            })
            .to_string(),
            candidate_count,
            selected_count,
            rejected_count: candidate_count - selected_count,
        }
    }

    fn candidate(
        snapshot_id: &str,
        candidate_id: &str,
        rank: i64,
        selected: bool,
    ) -> ContextSnapshotCandidateCreateRequest {
        ContextSnapshotCandidateCreateRequest {
            snapshot_candidate_id: candidate_id.to_string(),
            snapshot_id: snapshot_id.to_string(),
            source_kind: "response".to_string(),
            source_id: format!("response-{rank}"),
            chunk_ref: format!("response-{rank}:full"),
            tier: "relevant".to_string(),
            include_mode_hint: "verbatim_reference".to_string(),
            estimated_tokens: 60,
            retrieval_score: Some(0.5 / rank as f64),
            final_rank: rank,
            is_mandatory: rank == 1,
            is_hidden_background: rank == 2,
            is_selected: selected,
            rejection_reason: (!selected).then(|| "budget_exceeded".to_string()),
            metadata_json: serde_json::json!({
                "projectionVersion": "sqlite-retrieval-projection-v1",
                "digestMatched": true
            })
            .to_string(),
        }
    }

    #[tokio::test]
    async fn creates_and_reads_snapshot_with_safe_json_roundtrip() {
        let (_database, repository) = setup().await;
        let request = snapshot("snapshot-roundtrip", 0, 0);
        repository.insert_snapshot(&request).await.unwrap();

        let record = repository
            .get_snapshot("snapshot-roundtrip")
            .await
            .unwrap()
            .expect("snapshot");
        assert_eq!(record.loom_id, "loom-snapshot");
        assert_eq!(record.scope_context_id.as_deref(), Some("scope-context-1"));
        assert_eq!(record.budget_json, request.budget_json);
        assert_eq!(record.diagnostics_json, request.diagnostics_json);
        assert_eq!(record.candidate_count, 0);
    }

    #[tokio::test]
    async fn creates_snapshot_and_candidates_transactionally_in_rank_order() {
        let (_database, repository) = setup().await;
        let request = snapshot("snapshot-ranked", 2, 1);
        let candidates = vec![
            candidate("snapshot-ranked", "candidate-2", 2, false),
            candidate("snapshot-ranked", "candidate-1", 1, true),
        ];
        repository
            .create_snapshot_with_candidates(&request, &candidates)
            .await
            .unwrap();

        let stored = repository.list_candidates("snapshot-ranked").await.unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].final_rank, 1);
        assert!(stored[0].is_selected);
        assert!(stored[0].is_mandatory);
        assert_eq!(stored[0].source_id, "response-1");
        assert_eq!(stored[0].chunk_ref, "response-1:full");
        assert_eq!(stored[0].retrieval_score, Some(0.5));
        assert_eq!(stored[1].final_rank, 2);
        assert!(!stored[1].is_selected);
        assert!(stored[1].is_hidden_background);
        assert_eq!(
            stored[1].rejection_reason.as_deref(),
            Some("budget_exceeded")
        );

        let parent = repository
            .get_snapshot("snapshot-ranked")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (
                parent.candidate_count,
                parent.selected_count,
                parent.rejected_count
            ),
            (2, 1, 1)
        );
    }

    #[tokio::test]
    async fn transaction_rolls_back_parent_when_candidate_insert_fails() {
        let (_database, repository) = setup().await;
        let request = snapshot("snapshot-rollback", 2, 2);
        let candidates = vec![
            candidate("snapshot-rollback", "duplicate-id", 1, true),
            candidate("snapshot-rollback", "duplicate-id", 2, true),
        ];
        assert!(repository
            .create_snapshot_with_candidates(&request, &candidates)
            .await
            .is_err());
        assert!(repository
            .get_snapshot("snapshot-rollback")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn optional_agent_run_lookup_uses_snapshot_owned_link_without_mutating_run() {
        let (database, repository) = setup().await;
        sqlx::query(
            "INSERT INTO agent_runs (
                agent_run_id, correlation_id, status, started_at, cancel_requested, created_at
             ) VALUES ('run-snapshot', 'run-snapshot', 'running', '1', 0, '1')",
        )
        .execute(database.pool())
        .await
        .unwrap();
        let mut request = snapshot("snapshot-run", 0, 0);
        request.agent_run_id = Some("run-snapshot".to_string());
        repository.insert_snapshot(&request).await.unwrap();

        let record = repository
            .get_snapshot_for_agent_run("run-snapshot")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(record.snapshot_id, "snapshot-run");
        let run_snapshot_id = sqlx::query_scalar::<_, Option<String>>(
            "SELECT context_snapshot_id FROM agent_runs WHERE agent_run_id = 'run-snapshot'",
        )
        .fetch_one(database.pool())
        .await
        .unwrap();
        assert_eq!(run_snapshot_id, None);
    }

    #[tokio::test]
    async fn repository_inserts_reject_private_snapshot_and_candidate_json() {
        let (_database, repository) = setup().await;
        let mut private_snapshot = snapshot("snapshot-private", 0, 0);
        private_snapshot.diagnostics_json = r#"{"raw_thinking":"never"}"#.to_string();
        assert!(repository.insert_snapshot(&private_snapshot).await.is_err());
        assert!(repository
            .get_snapshot("snapshot-private")
            .await
            .unwrap()
            .is_none());

        let parent = snapshot("snapshot-safe-parent", 0, 0);
        repository.insert_snapshot(&parent).await.unwrap();
        let mut private_candidate = candidate("snapshot-safe-parent", "candidate-private", 1, true);
        private_candidate.metadata_json = r#"{"providerPayload":"never"}"#.to_string();
        assert!(repository
            .insert_candidate(&private_candidate)
            .await
            .is_err());
        assert!(repository
            .list_candidates("snapshot-safe-parent")
            .await
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rejects_private_or_content_bearing_json_fields() {
        for (field, value) in [
            ("metadata_json", r#"{"raw_thinking":"never"}"#),
            ("metadata_json", r#"{"credential":"never"}"#),
            ("metadata_json", r#"{"candidateContent":"never"}"#),
            ("metadata_json", r#"{"provider_payload":{"body":"never"}}"#),
            ("metadata_json", r#"{"vector":[0.1]}"#),
            ("metadata_json", r#"{"rawToolOutput":"never"}"#),
            ("budget_json", r#"{"password":"never"}"#),
            ("diagnostics_json", r#"{"prompt":"never"}"#),
        ] {
            let error = validate_safe_json(field, value).expect_err("private JSON must fail");
            assert!(error.to_string().contains("forbidden privacy marker"));
        }
    }

    #[test]
    fn safe_budget_diagnostics_and_reference_metadata_are_accepted() {
        validate_safe_json(
            "budget_json",
            r#"{"budgetLimit":4096,"estimatedTokensAfter":512}"#,
        )
        .unwrap();
        validate_safe_json(
            "diagnostics_json",
            r#"{"scopeCount":3,"latencyMs":12,"degraded":false}"#,
        )
        .unwrap();
        validate_safe_json(
            "metadata_json",
            r#"{"projectionVersion":"v1","digestMatched":true}"#,
        )
        .unwrap();
    }

    #[test]
    fn snapshot_contract_has_no_full_content_field() {
        let serialized = serde_json::to_value(ContextSnapshotCandidateRecord {
            snapshot_candidate_id: "candidate".to_string(),
            snapshot_id: "snapshot".to_string(),
            source_kind: "response".to_string(),
            source_id: "response-1".to_string(),
            chunk_ref: "response-1:full".to_string(),
            tier: "relevant".to_string(),
            include_mode_hint: "reference".to_string(),
            estimated_tokens: 12,
            retrieval_score: None,
            final_rank: 1,
            is_mandatory: false,
            is_hidden_background: false,
            is_selected: true,
            rejection_reason: None,
            metadata_json: "{}".to_string(),
        })
        .unwrap();
        let object = serialized.as_object().unwrap();
        for forbidden in [
            "content",
            "prompt",
            "providerPayload",
            "rawThinking",
            "vector",
            "rawToolOutput",
        ] {
            assert!(!object.contains_key(forbidden));
        }
    }
}
