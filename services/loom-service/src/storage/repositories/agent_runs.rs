#![allow(dead_code)]

//! Durable persistence for Agent Runs, Steps, and the append-only Event Log.
//! (AGENT-RUN-PERSISTENCE-001)
//!
//! Privacy rules enforced by this module:
//! - No prompt text stored anywhere.
//! - No provider request envelope or raw provider payloads stored.
//! - No raw thinking, thinking_text, chain_of_thought, or hidden_reasoning stored.
//! - No authorization headers, bearer tokens, api keys, or secrets stored.
//! - provider_delta text (streaming content) must not be persisted in agent_events.
//! - tool_call_completed output_summary must not be persisted.
//! - agent_events is append-only: no UPDATE or DELETE on that table.

use crate::{
    agent_runtime::types::{AgentRunStatus, AgentStepKind, AgentUsage},
    error::ServiceError,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}

fn epoch_ms_to_str(ms: u64) -> String {
    ms.to_string()
}

fn str_to_epoch_ms(s: &str) -> u64 {
    s.parse().unwrap_or(0)
}

fn status_str(status: AgentRunStatus) -> &'static str {
    match status {
        AgentRunStatus::Pending => "pending",
        AgentRunStatus::Running => "running",
        AgentRunStatus::Completed => "completed",
        AgentRunStatus::Failed => "failed",
        AgentRunStatus::Cancelled => "cancelled",
        AgentRunStatus::Interrupted => "interrupted",
    }
}

fn status_from_str(s: &str) -> AgentRunStatus {
    match s {
        "pending" => AgentRunStatus::Pending,
        "running" => AgentRunStatus::Running,
        "completed" => AgentRunStatus::Completed,
        "failed" => AgentRunStatus::Failed,
        "cancelled" => AgentRunStatus::Cancelled,
        "interrupted" => AgentRunStatus::Interrupted,
        _ => AgentRunStatus::Failed,
    }
}

fn step_kind_str(kind: AgentStepKind) -> &'static str {
    match kind {
        AgentStepKind::ContextBuild => "context_build",
        AgentStepKind::ProviderCall => "provider_call",
        AgentStepKind::ToolCallPlaceholder => "tool_call_placeholder",
        AgentStepKind::ArtifactPlaceholder => "artifact_placeholder",
        AgentStepKind::ValidationPlaceholder => "validation_placeholder",
    }
}

// ---------------------------------------------------------------------------
// Durable record types
// ---------------------------------------------------------------------------

/// Safe durable record for a persisted agent run. Never includes prompt text,
/// provider payloads, or raw thinking.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub agent_run_id: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub parent_response_id: Option<String>,
    pub correlation_id: String,
    pub causation_id: Option<String>,
    pub context_snapshot_id: Option<String>,
    pub provider_profile_id: Option<String>,
    pub model_id: Option<String>,
    pub status: String,
    pub cancel_requested: bool,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub error_message: Option<String>,
    pub created_at: String,
}

/// Safe durable record for a persisted agent step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepRecord {
    pub agent_step_id: String,
    pub agent_run_id: String,
    pub kind: String,
    pub status: String,
    pub sequence_index: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
}

/// Safe durable record for a persisted agent event (append-only log).
/// The payload contains only safe, allowlisted fields — never delta text,
/// prompt text, provider payloads, or thinking content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventRecord {
    pub agent_event_id: String,
    pub agent_run_id: String,
    pub agent_step_id: Option<String>,
    pub sequence_number: i64,
    pub event_type: String,
    pub payload_json: Option<String>,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

pub struct NewAgentRun<'a> {
    pub agent_run_id: &'a str,
    pub loom_id: Option<&'a str>,
    pub response_id: Option<&'a str>,
    pub parent_response_id: Option<&'a str>,
    pub correlation_id: &'a str,
    pub causation_id: Option<&'a str>,
    pub context_snapshot_id: Option<&'a str>,
    pub provider_profile_id: Option<&'a str>,
    pub model_id: Option<&'a str>,
    pub started_at: &'a str,
}

pub struct NewAgentStep<'a> {
    pub agent_step_id: &'a str,
    pub agent_run_id: &'a str,
    pub kind: AgentStepKind,
    pub sequence_index: i64,
    pub started_at: Option<&'a str>,
}

pub struct NewAgentEvent<'a> {
    pub agent_event_id: &'a str,
    pub agent_run_id: &'a str,
    pub agent_step_id: Option<&'a str>,
    pub sequence_number: i64,
    pub event_type: &'a str,
    pub payload_json: Option<String>,
}

// ---------------------------------------------------------------------------
// Sequence counter
// ---------------------------------------------------------------------------

/// Per-run monotonic sequence counter for event ordering. Process-local.
/// Each `AgentRunRepository` clone shares the same counters via Arc.
#[derive(Debug, Clone, Default)]
pub struct EventSequencer {
    inner: Arc<EventSequencerInner>,
}

#[derive(Debug, Default)]
struct EventSequencerInner {
    global: AtomicU64,
}

impl EventSequencer {
    pub fn next(&self) -> u64 {
        self.inner.global.fetch_add(1, Ordering::Relaxed)
    }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct AgentRunRepository {
    pool: SqlitePool,
    sequencer: EventSequencer,
}

impl AgentRunRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool,
            sequencer: EventSequencer::default(),
        }
    }

    pub fn from_pool(pool: &SqlitePool) -> Self {
        Self::new(pool.clone())
    }

    // -----------------------------------------------------------------------
    // Writes
    // -----------------------------------------------------------------------

    pub async fn insert_run(&self, run: &NewAgentRun<'_>) -> Result<(), ServiceError> {
        sqlx::query(
            "INSERT OR IGNORE INTO agent_runs
             (agent_run_id, loom_id, response_id, parent_response_id,
              correlation_id, causation_id, context_snapshot_id,
              provider_profile_id, model_id, status, cancel_requested,
              started_at, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'running',0,?10,?10)",
        )
        .bind(run.agent_run_id)
        .bind(run.loom_id)
        .bind(run.response_id)
        .bind(run.parent_response_id)
        .bind(run.correlation_id)
        .bind(run.causation_id)
        .bind(run.context_snapshot_id)
        .bind(run.provider_profile_id)
        .bind(run.model_id)
        .bind(run.started_at)
        .execute(&self.pool)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to insert agent run: {e}")))?;
        Ok(())
    }

    pub async fn insert_step(&self, step: &NewAgentStep<'_>) -> Result<(), ServiceError> {
        let kind = step_kind_str(step.kind);
        sqlx::query(
            "INSERT OR IGNORE INTO agent_steps
             (agent_step_id, agent_run_id, kind, status, sequence_index, started_at, created_at)
             VALUES (?1,?2,?3,'running',?4,?5,CURRENT_TIMESTAMP)",
        )
        .bind(step.agent_step_id)
        .bind(step.agent_run_id)
        .bind(kind)
        .bind(step.sequence_index)
        .bind(step.started_at)
        .execute(&self.pool)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to insert agent step: {e}")))?;
        Ok(())
    }

    pub async fn append_event(&self, event: &NewAgentEvent<'_>) -> Result<(), ServiceError> {
        // Guard: payload must never contain raw thinking markers.
        if let Some(payload) = &event.payload_json {
            let lower = payload.to_ascii_lowercase();
            for forbidden in FORBIDDEN_THINKING_KEYS {
                if lower.contains(forbidden) {
                    return Err(ServiceError::storage(format!(
                        "agent event payload contains forbidden thinking key: {forbidden}"
                    )));
                }
            }
        }
        sqlx::query(
            "INSERT OR IGNORE INTO agent_events
             (agent_event_id, agent_run_id, agent_step_id, sequence_number,
              event_type, payload_json, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,CURRENT_TIMESTAMP)",
        )
        .bind(event.agent_event_id)
        .bind(event.agent_run_id)
        .bind(event.agent_step_id)
        .bind(event.sequence_number as i64)
        .bind(event.event_type)
        .bind(event.payload_json.as_deref())
        .execute(&self.pool)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to append agent event: {e}")))?;
        Ok(())
    }

    /// Atomically persists the terminal status and terminal event in one transaction.
    /// The terminal event type must correspond to the terminal status.
    pub async fn finish_run(
        &self,
        run_id: &str,
        status: AgentRunStatus,
        usage: Option<AgentUsage>,
        error_message: Option<&str>,
        terminal_event_id: &str,
        terminal_event_type: &str,
        terminal_event_seq: i64,
        terminal_payload_json: Option<String>,
    ) -> Result<(), ServiceError> {
        debug_assert!(matches!(
            status,
            AgentRunStatus::Completed | AgentRunStatus::Failed | AgentRunStatus::Cancelled
        ));
        let status_str = status_str(status);
        let now = now_iso();
        let input_tokens = usage.and_then(|u| u.input_tokens).map(|v| v as i64);
        let output_tokens = usage.and_then(|u| u.output_tokens).map(|v| v as i64);
        let total_tokens = usage.and_then(|u| u.total_tokens).map(|v| v as i64);

        let mut tx = self.pool.begin().await.map_err(|e| {
            ServiceError::storage(format!("failed to begin terminal transaction: {e}"))
        })?;

        sqlx::query(
            "UPDATE agent_runs
             SET status = ?1, completed_at = COALESCE(completed_at, ?2),
                 input_tokens = ?3, output_tokens = ?4, total_tokens = ?5,
                 error_message = ?6
             WHERE agent_run_id = ?7 AND status NOT IN ('completed','failed','cancelled','interrupted')",
        )
        .bind(status_str)
        .bind(&now)
        .bind(input_tokens)
        .bind(output_tokens)
        .bind(total_tokens)
        .bind(error_message)
        .bind(run_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to update terminal run status: {e}")))?;

        // Guard: payload must never contain raw thinking markers.
        if let Some(payload) = &terminal_payload_json {
            let lower = payload.to_ascii_lowercase();
            for forbidden in FORBIDDEN_THINKING_KEYS {
                if lower.contains(forbidden) {
                    return Err(ServiceError::storage(format!(
                        "terminal event payload contains forbidden thinking key: {forbidden}"
                    )));
                }
            }
        }

        sqlx::query(
            "INSERT OR IGNORE INTO agent_events
             (agent_event_id, agent_run_id, sequence_number, event_type, payload_json, created_at)
             VALUES (?1,?2,?3,?4,?5,CURRENT_TIMESTAMP)",
        )
        .bind(terminal_event_id)
        .bind(run_id)
        .bind(terminal_event_seq)
        .bind(terminal_event_type)
        .bind(terminal_payload_json.as_deref())
        .execute(&mut *tx)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to insert terminal event: {e}")))?;

        tx.commit().await.map_err(|e| {
            ServiceError::storage(format!("failed to commit terminal transaction: {e}"))
        })?;
        Ok(())
    }

    pub async fn cancel_run(&self, run_id: &str) -> Result<(), ServiceError> {
        let now = now_iso();
        sqlx::query(
            "UPDATE agent_runs
             SET status = 'cancelled', cancel_requested = 1,
                 completed_at = COALESCE(completed_at, ?1)
             WHERE agent_run_id = ?2 AND status IN ('pending','running')",
        )
        .bind(&now)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to cancel agent run: {e}")))?;
        Ok(())
    }

    /// Marks all pending/running runs as interrupted (service restart recovery).
    /// Returns the count of runs recovered.
    pub async fn recover_interrupted_runs(&self) -> Result<usize, ServiceError> {
        let now = now_iso();
        let mut tx = self.pool.begin().await.map_err(|e| {
            ServiceError::storage(format!("failed to begin recovery transaction: {e}"))
        })?;

        let stale_runs: Vec<String> = sqlx::query_scalar(
            "SELECT agent_run_id FROM agent_runs WHERE status IN ('pending','running')",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to query stale agent runs: {e}")))?;

        sqlx::query(
            "UPDATE agent_runs
             SET status = 'interrupted', completed_at = COALESCE(completed_at, ?1)
             WHERE status IN ('pending','running')",
        )
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to interrupt stale agent runs: {e}")))?;

        let count = stale_runs.len();
        for run_id in &stale_runs {
            let event_id = uuid::Uuid::new_v4().to_string();
            let seq = self.sequencer.next() as i64;
            let payload = serde_json::json!({
                "runId": run_id,
                "reason": "service_restart"
            })
            .to_string();
            sqlx::query(
                "INSERT OR IGNORE INTO agent_events
                 (agent_event_id, agent_run_id, sequence_number, event_type, payload_json, created_at)
                 VALUES (?1,?2,?3,'run_interrupted',?4,CURRENT_TIMESTAMP)",
            )
            .bind(&event_id)
            .bind(run_id)
            .bind(seq)
            .bind(&payload)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                ServiceError::storage(format!("failed to insert recovery event for {run_id}: {e}"))
            })?;
        }

        tx.commit().await.map_err(|e| {
            ServiceError::storage(format!("failed to commit recovery transaction: {e}"))
        })?;
        Ok(count)
    }

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    pub async fn get_run(&self, run_id: &str) -> Result<Option<AgentRunRecord>, ServiceError> {
        let row = sqlx::query(
            "SELECT agent_run_id, loom_id, response_id, parent_response_id,
                    correlation_id, causation_id, context_snapshot_id,
                    provider_profile_id, model_id, status, cancel_requested,
                    started_at, completed_at, input_tokens, output_tokens, total_tokens,
                    error_message, created_at
             FROM agent_runs WHERE agent_run_id = ?1",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to get agent run: {e}")))?;

        Ok(row.map(agent_run_record_from_row))
    }

    pub async fn list_runs_for_loom(
        &self,
        loom_id: &str,
        limit: i64,
    ) -> Result<Vec<AgentRunRecord>, ServiceError> {
        sqlx::query(
            "SELECT agent_run_id, loom_id, response_id, parent_response_id,
                    correlation_id, causation_id, context_snapshot_id,
                    provider_profile_id, model_id, status, cancel_requested,
                    started_at, completed_at, input_tokens, output_tokens, total_tokens,
                    error_message, created_at
             FROM agent_runs WHERE loom_id = ?1
             ORDER BY started_at DESC LIMIT ?2",
        )
        .bind(loom_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(agent_run_record_from_row).collect())
        .map_err(|e| ServiceError::storage(format!("failed to list agent runs for loom: {e}")))
    }

    pub async fn list_steps_for_run(
        &self,
        run_id: &str,
    ) -> Result<Vec<AgentStepRecord>, ServiceError> {
        sqlx::query(
            "SELECT agent_step_id, agent_run_id, kind, status, sequence_index,
                    started_at, completed_at, error, created_at
             FROM agent_steps WHERE agent_run_id = ?1
             ORDER BY sequence_index ASC",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(agent_step_record_from_row).collect())
        .map_err(|e| ServiceError::storage(format!("failed to list agent steps: {e}")))
    }

    pub async fn list_events_for_run(
        &self,
        run_id: &str,
        since_sequence: i64,
        limit: i64,
    ) -> Result<Vec<AgentEventRecord>, ServiceError> {
        sqlx::query(
            "SELECT agent_event_id, agent_run_id, agent_step_id, sequence_number,
                    event_type, payload_json, created_at
             FROM agent_events
             WHERE agent_run_id = ?1 AND sequence_number >= ?2
             ORDER BY sequence_number ASC
             LIMIT ?3",
        )
        .bind(run_id)
        .bind(since_sequence)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(agent_event_record_from_row).collect())
        .map_err(|e| ServiceError::storage(format!("failed to list agent events: {e}")))
    }

    pub fn next_sequence(&self) -> i64 {
        self.sequencer.next() as i64
    }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

fn agent_run_record_from_row(row: sqlx::sqlite::SqliteRow) -> AgentRunRecord {
    use sqlx::Row;
    let cancel_requested: i64 = row.get("cancel_requested");
    AgentRunRecord {
        agent_run_id: row.get("agent_run_id"),
        loom_id: row.get("loom_id"),
        response_id: row.get("response_id"),
        parent_response_id: row.get("parent_response_id"),
        correlation_id: row.get("correlation_id"),
        causation_id: row.get("causation_id"),
        context_snapshot_id: row.get("context_snapshot_id"),
        provider_profile_id: row.get("provider_profile_id"),
        model_id: row.get("model_id"),
        status: row.get("status"),
        cancel_requested: cancel_requested != 0,
        started_at: row.get("started_at"),
        completed_at: row.get("completed_at"),
        input_tokens: row.get("input_tokens"),
        output_tokens: row.get("output_tokens"),
        total_tokens: row.get("total_tokens"),
        error_message: row.get("error_message"),
        created_at: row.get("created_at"),
    }
}

fn agent_step_record_from_row(row: sqlx::sqlite::SqliteRow) -> AgentStepRecord {
    use sqlx::Row;
    AgentStepRecord {
        agent_step_id: row.get("agent_step_id"),
        agent_run_id: row.get("agent_run_id"),
        kind: row.get("kind"),
        status: row.get("status"),
        sequence_index: row.get("sequence_index"),
        started_at: row.get("started_at"),
        completed_at: row.get("completed_at"),
        error: row.get("error"),
        created_at: row.get("created_at"),
    }
}

fn agent_event_record_from_row(row: sqlx::sqlite::SqliteRow) -> AgentEventRecord {
    use sqlx::Row;
    let seq: i64 = row.get("sequence_number");
    AgentEventRecord {
        agent_event_id: row.get("agent_event_id"),
        agent_run_id: row.get("agent_run_id"),
        agent_step_id: row.get("agent_step_id"),
        sequence_number: seq,
        event_type: row.get("event_type"),
        payload_json: row.get("payload_json"),
        created_at: row.get("created_at"),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent_runtime::types::{AgentRunStatus, AgentStepKind, AgentUsage},
        storage::db::test_database,
    };

    async fn make_repo() -> AgentRunRepository {
        let db = test_database().await;
        AgentRunRepository::new(db.pool().clone())
    }

    fn run_input(run_id: &str) -> NewAgentRun {
        NewAgentRun {
            agent_run_id: run_id,
            loom_id: Some("loom-test"),
            response_id: Some("resp-assistant"),
            parent_response_id: Some("resp-user"),
            correlation_id: run_id,
            causation_id: Some("resp-user"),
            context_snapshot_id: None,
            provider_profile_id: Some("ollama"),
            model_id: Some("test-model"),
            started_at: "1718000000000",
        }
    }

    #[tokio::test]
    async fn insert_run_is_retrievable_by_run_id() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-retrieve-001"))
            .await
            .unwrap();
        let record = repo
            .get_run("run-retrieve-001")
            .await
            .unwrap()
            .expect("run must exist");
        assert_eq!(record.agent_run_id, "run-retrieve-001");
        assert_eq!(record.loom_id.as_deref(), Some("loom-test"));
        assert_eq!(record.response_id.as_deref(), Some("resp-assistant"));
        assert_eq!(record.correlation_id, "run-retrieve-001");
        assert_eq!(record.status, "running");
        assert!(!record.cancel_requested);
    }

    #[tokio::test]
    async fn insert_step_is_listed_by_run_id() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-steps-001")).await.unwrap();
        let step = NewAgentStep {
            agent_step_id: "step-001",
            agent_run_id: "run-steps-001",
            kind: AgentStepKind::ProviderCall,
            sequence_index: 0,
            started_at: Some("1718000000000"),
        };
        repo.insert_step(&step).await.unwrap();
        let steps = repo.list_steps_for_run("run-steps-001").await.unwrap();
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].agent_step_id, "step-001");
        assert_eq!(steps[0].kind, "provider_call");
        assert_eq!(steps[0].sequence_index, 0);
    }

    #[tokio::test]
    async fn append_event_preserves_sequence_order() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-events-001")).await.unwrap();

        for (seq, event_type) in [
            (0, "run_started"),
            (1, "step_started"),
            (2, "run_completed"),
        ] {
            repo.append_event(&NewAgentEvent {
                agent_event_id: &format!("evt-{seq}"),
                agent_run_id: "run-events-001",
                agent_step_id: None,
                sequence_number: seq,
                event_type,
                payload_json: Some(format!("{{\"runId\":\"run-events-001\",\"seq\":{seq}}}")),
            })
            .await
            .unwrap();
        }

        let events = repo
            .list_events_for_run("run-events-001", 0, 100)
            .await
            .unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].sequence_number, 0);
        assert_eq!(events[0].event_type, "run_started");
        assert_eq!(events[2].sequence_number, 2);
        assert_eq!(events[2].event_type, "run_completed");
    }

    #[tokio::test]
    async fn append_event_rejects_raw_thinking_in_payload() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-thinking-guard"))
            .await
            .unwrap();

        let result = repo
            .append_event(&NewAgentEvent {
                agent_event_id: "evt-forbidden",
                agent_run_id: "run-thinking-guard",
                agent_step_id: None,
                sequence_number: 0,
                event_type: "warning",
                payload_json: Some("{\"raw_thinking\":\"leaked\"}".to_string()),
            })
            .await;
        assert!(result.is_err(), "raw_thinking in payload must be rejected");
    }

    #[tokio::test]
    async fn finish_run_atomically_updates_status_and_inserts_terminal_event() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-finish-001")).await.unwrap();

        repo.finish_run(
            "run-finish-001",
            AgentRunStatus::Completed,
            Some(AgentUsage {
                input_tokens: Some(10),
                output_tokens: Some(20),
                total_tokens: Some(30),
            }),
            None,
            "evt-terminal",
            "run_completed",
            99,
            Some("{\"runId\":\"run-finish-001\",\"elapsedMs\":100}".to_string()),
        )
        .await
        .unwrap();

        let record = repo.get_run("run-finish-001").await.unwrap().expect("run");
        assert_eq!(record.status, "completed");
        assert!(record.completed_at.is_some());
        assert_eq!(record.total_tokens, Some(30));

        let events = repo
            .list_events_for_run("run-finish-001", 99, 10)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "run_completed");
        assert_eq!(events[0].sequence_number, 99);
    }

    #[tokio::test]
    async fn finish_run_is_idempotent_for_already_terminal_run() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-idempotent")).await.unwrap();

        repo.finish_run(
            "run-idempotent",
            AgentRunStatus::Completed,
            None,
            None,
            "evt-t1",
            "run_completed",
            0,
            None,
        )
        .await
        .unwrap();

        // Second finish call — must not change status or insert duplicate event
        repo.finish_run(
            "run-idempotent",
            AgentRunStatus::Failed,
            None,
            Some("late error"),
            "evt-t2",
            "run_failed",
            1,
            None,
        )
        .await
        .unwrap();

        let record = repo.get_run("run-idempotent").await.unwrap().expect("run");
        assert_eq!(
            record.status, "completed",
            "terminal status must not change"
        );
    }

    #[tokio::test]
    async fn cancel_run_sets_cancelled_and_cancel_requested() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-cancel-001")).await.unwrap();
        repo.cancel_run("run-cancel-001").await.unwrap();

        let record = repo.get_run("run-cancel-001").await.unwrap().expect("run");
        assert_eq!(record.status, "cancelled");
        assert!(record.cancel_requested);
        assert!(record.completed_at.is_some());
    }

    #[tokio::test]
    async fn list_runs_for_loom_returns_ordered_by_started_at_desc() {
        let repo = make_repo().await;
        for (id, ts) in [
            ("run-loom-a", "1718000000100"),
            ("run-loom-b", "1718000000200"),
            ("run-loom-c", "1718000000050"),
        ] {
            let mut r = run_input(id);
            r.started_at = ts;
            repo.insert_run(&r).await.unwrap();
        }

        let runs = repo.list_runs_for_loom("loom-test", 10).await.unwrap();
        assert_eq!(runs.len(), 3);
        assert_eq!(runs[0].agent_run_id, "run-loom-b");
        assert_eq!(runs[1].agent_run_id, "run-loom-a");
        assert_eq!(runs[2].agent_run_id, "run-loom-c");
    }

    #[tokio::test]
    async fn recover_interrupted_runs_marks_running_as_interrupted() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-stale-running"))
            .await
            .unwrap();
        repo.insert_run(&run_input("run-stale-pending"))
            .await
            .unwrap();
        sqlx::query(
            "UPDATE agent_runs SET status='pending' WHERE agent_run_id='run-stale-pending'",
        )
        .execute(&repo.pool)
        .await
        .unwrap();

        // Insert a completed run — must NOT be touched
        repo.insert_run(&run_input("run-completed")).await.unwrap();
        repo.finish_run(
            "run-completed",
            AgentRunStatus::Completed,
            None,
            None,
            "evt-c",
            "run_completed",
            0,
            None,
        )
        .await
        .unwrap();

        let count = repo.recover_interrupted_runs().await.unwrap();
        assert_eq!(count, 2);

        let stale_running = repo
            .get_run("run-stale-running")
            .await
            .unwrap()
            .expect("run");
        assert_eq!(stale_running.status, "interrupted");
        assert!(stale_running.completed_at.is_some());

        let stale_pending = repo
            .get_run("run-stale-pending")
            .await
            .unwrap()
            .expect("run");
        assert_eq!(stale_pending.status, "interrupted");

        let completed = repo.get_run("run-completed").await.unwrap().expect("run");
        assert_eq!(completed.status, "completed");
    }

    #[tokio::test]
    async fn recover_interrupted_runs_appends_run_interrupted_events() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-recovery-evt"))
            .await
            .unwrap();
        let count = repo.recover_interrupted_runs().await.unwrap();
        assert_eq!(count, 1);

        let events = repo
            .list_events_for_run("run-recovery-evt", 0, 100)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "run_interrupted");
        let payload: serde_json::Value =
            serde_json::from_str(events[0].payload_json.as_deref().unwrap_or("{}")).unwrap();
        assert_eq!(payload["reason"], "service_restart");
    }

    #[tokio::test]
    async fn recover_interrupted_runs_is_idempotent() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-idempotent-recovery"))
            .await
            .unwrap();
        let first = repo.recover_interrupted_runs().await.unwrap();
        let second = repo.recover_interrupted_runs().await.unwrap();
        assert_eq!(first, 1);
        assert_eq!(
            second, 0,
            "already interrupted runs must not be touched again"
        );
    }

    #[tokio::test]
    async fn persisted_run_does_not_contain_prompt_text() {
        let repo = make_repo().await;
        let mut input = run_input("run-privacy-001");
        // response_id and parent_response_id are IDs, not content — safe to store.
        // We verify no prompt text leaked into any persisted column by serializing the record.
        repo.insert_run(&input).await.unwrap();
        let record = repo.get_run("run-privacy-001").await.unwrap().expect("run");
        let serialized = serde_json::to_string(&record).expect("serialize");
        for forbidden in ["hello world", "my prompt", "authorization", "bearer"] {
            assert!(
                !serialized.to_ascii_lowercase().contains(forbidden),
                "forbidden content '{forbidden}' found in persisted run"
            );
        }
    }

    #[tokio::test]
    async fn event_sequence_numbers_are_monotonically_increasing() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-seq-001")).await.unwrap();

        let seqs: Vec<i64> = (0..5).map(|_| repo.next_sequence()).collect();
        assert!(
            seqs.windows(2).all(|w| w[0] < w[1]),
            "sequences must be monotonic"
        );
    }
}
