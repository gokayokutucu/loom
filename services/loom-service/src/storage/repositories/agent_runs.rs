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
    agent_runtime::types::{
        AgentRunMode, AgentRunStatus, AgentStepKind, AgentStepStatus, AgentUsage,
    },
    error::ServiceError,
    providers::types::sanitize_provider_text,
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

fn validate_persisted_payload(payload: &str) -> Result<(), ServiceError> {
    let lower = payload.to_ascii_lowercase();
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if lower.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "agent event payload contains forbidden thinking key: {forbidden}"
            )));
        }
    }
    for forbidden in [
        "\"authorization\"",
        "\"bearer\"",
        "\"apikey\"",
        "\"api_key\"",
        "\"password\"",
        "\"credential\"",
        "\"secret\"",
        "\"prompt\"",
        "bearer ",
        "sk-",
    ] {
        if lower.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "agent event payload contains forbidden credential content: {forbidden}"
            )));
        }
    }
    Ok(())
}

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
        AgentRunStatus::Created => "created",
        AgentRunStatus::Queued => "queued",
        AgentRunStatus::Pending => "pending",
        AgentRunStatus::Running => "running",
        AgentRunStatus::WaitingTool => "waiting_tool",
        AgentRunStatus::WaitingSubagent => "waiting_subagent",
        AgentRunStatus::Completed => "completed",
        AgentRunStatus::Failed => "failed",
        AgentRunStatus::Cancelled => "cancelled",
        AgentRunStatus::Interrupted => "interrupted",
    }
}

fn status_from_str(s: &str) -> AgentRunStatus {
    match s {
        "created" => AgentRunStatus::Created,
        "queued" => AgentRunStatus::Queued,
        "pending" => AgentRunStatus::Pending,
        "running" => AgentRunStatus::Running,
        "waiting_tool" => AgentRunStatus::WaitingTool,
        "waiting_subagent" => AgentRunStatus::WaitingSubagent,
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

fn step_status_str(status: AgentStepStatus) -> &'static str {
    match status {
        AgentStepStatus::Pending => "pending",
        AgentStepStatus::Running => "running",
        AgentStepStatus::Completed => "completed",
        AgentStepStatus::Failed => "failed",
        AgentStepStatus::Cancelled => "cancelled",
        AgentStepStatus::Skipped => "skipped",
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
    pub run_mode: String,
    pub agent_id: Option<String>,
    pub agent_revision: Option<String>,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub parent_response_id: Option<String>,
    pub correlation_id: String,
    pub causation_id: Option<String>,
    pub root_run_id: Option<String>,
    pub parent_run_id: Option<String>,
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

/// Immutable Agent definition metadata. Instruction bodies and executable
/// behavior are deliberately referenced, not stored here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinitionRecord {
    pub agent_id: String,
    pub revision: String,
    pub name: String,
    pub role: String,
    pub instruction_set_ref: Option<String>,
    pub capability_profile_ref: Option<String>,
    pub context_policy_ref: Option<String>,
    pub tool_policy_ref: Option<String>,
    pub provider_policy_ref: Option<String>,
    pub enabled: bool,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

pub struct NewAgentRun<'a> {
    pub agent_run_id: &'a str,
    pub run_mode: AgentRunMode,
    pub agent_id: Option<&'a str>,
    pub agent_revision: Option<&'a str>,
    pub loom_id: Option<&'a str>,
    pub response_id: Option<&'a str>,
    pub parent_response_id: Option<&'a str>,
    pub correlation_id: &'a str,
    pub causation_id: Option<&'a str>,
    pub root_run_id: Option<&'a str>,
    pub parent_run_id: Option<&'a str>,
    pub context_snapshot_id: Option<&'a str>,
    pub provider_profile_id: Option<&'a str>,
    pub model_id: Option<&'a str>,
    pub started_at: &'a str,
}

pub struct NewAgentDefinition<'a> {
    pub agent_id: &'a str,
    pub revision: &'a str,
    pub name: &'a str,
    pub role: &'a str,
    pub instruction_set_ref: Option<&'a str>,
    pub capability_profile_ref: Option<&'a str>,
    pub context_policy_ref: Option<&'a str>,
    pub tool_policy_ref: Option<&'a str>,
    pub provider_policy_ref: Option<&'a str>,
    pub enabled: bool,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentRunTransition {
    Queue,
    Start,
    WaitTool,
    ResumeFromTool,
    WaitSubagent,
    ResumeFromSubagent,
    Complete,
    Fail,
}

impl AgentRunTransition {
    fn event_type(self) -> &'static str {
        match self {
            AgentRunTransition::Queue => "run_queued",
            AgentRunTransition::Start => "run_started",
            AgentRunTransition::WaitTool => "run_waiting_tool",
            AgentRunTransition::ResumeFromTool => "run_started",
            AgentRunTransition::WaitSubagent => "run_waiting_subagent",
            AgentRunTransition::ResumeFromSubagent => "run_started",
            AgentRunTransition::Complete => "run_completed",
            AgentRunTransition::Fail => "run_failed",
        }
    }

    fn from_state(self) -> &'static str {
        match self {
            AgentRunTransition::Queue => "created",
            AgentRunTransition::Start => "queued",
            AgentRunTransition::WaitTool => "running",
            AgentRunTransition::ResumeFromTool => "waiting_tool",
            AgentRunTransition::WaitSubagent => "running",
            AgentRunTransition::ResumeFromSubagent => "waiting_subagent",
            AgentRunTransition::Complete => "running",
            AgentRunTransition::Fail => "running",
        }
    }

    fn to_state(self) -> &'static str {
        match self {
            AgentRunTransition::Queue => "queued",
            AgentRunTransition::Start => "running",
            AgentRunTransition::WaitTool => "waiting_tool",
            AgentRunTransition::ResumeFromTool => "running",
            AgentRunTransition::WaitSubagent => "waiting_subagent",
            AgentRunTransition::ResumeFromSubagent => "running",
            AgentRunTransition::Complete => "completed",
            AgentRunTransition::Fail => "failed",
        }
    }

    fn is_terminal(self) -> bool {
        matches!(
            self,
            AgentRunTransition::Complete | AgentRunTransition::Fail
        )
    }
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

    pub async fn insert_agent_definition(
        &self,
        definition: &NewAgentDefinition<'_>,
    ) -> Result<(), ServiceError> {
        if let Some(payload) = &definition.metadata_json {
            validate_persisted_payload(payload)?;
        }
        let enabled = if definition.enabled { 1 } else { 0 };
        sqlx::query(
            "INSERT INTO agent_definitions
             (agent_id, revision, name, role, instruction_set_ref,
              capability_profile_ref, context_policy_ref, tool_policy_ref,
              provider_policy_ref, enabled, metadata_json, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
             ON CONFLICT(agent_id, revision) DO NOTHING",
        )
        .bind(definition.agent_id)
        .bind(definition.revision)
        .bind(definition.name)
        .bind(definition.role)
        .bind(definition.instruction_set_ref)
        .bind(definition.capability_profile_ref)
        .bind(definition.context_policy_ref)
        .bind(definition.tool_policy_ref)
        .bind(definition.provider_policy_ref)
        .bind(enabled)
        .bind(definition.metadata_json.as_deref())
        .execute(&self.pool)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to insert agent definition: {e}")))?;
        Ok(())
    }

    pub async fn insert_run(&self, run: &NewAgentRun<'_>) -> Result<(), ServiceError> {
        let root_run_id = run.root_run_id.unwrap_or(run.agent_run_id);
        sqlx::query(
            "INSERT OR IGNORE INTO agent_runs
             (agent_run_id, run_mode, agent_id, agent_revision, loom_id, response_id, parent_response_id,
              correlation_id, causation_id, root_run_id, parent_run_id, context_snapshot_id,
              provider_profile_id, model_id, status, cancel_requested,
              started_at, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'running',0,?15,?15)",
        )
        .bind(run.agent_run_id)
        .bind(run.run_mode.as_str())
        .bind(run.agent_id)
        .bind(run.agent_revision)
        .bind(run.loom_id)
        .bind(run.response_id)
        .bind(run.parent_response_id)
        .bind(run.correlation_id)
        .bind(run.causation_id)
        .bind(root_run_id)
        .bind(run.parent_run_id)
        .bind(run.context_snapshot_id)
        .bind(run.provider_profile_id)
        .bind(run.model_id)
        .bind(run.started_at)
        .execute(&self.pool)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to insert agent run: {e}")))?;
        Ok(())
    }

    pub async fn create_run(&self, run: &NewAgentRun<'_>) -> Result<AgentRunRecord, ServiceError> {
        let root_run_id = run.root_run_id.unwrap_or(run.agent_run_id);
        let mut tx = self.pool.begin().await.map_err(|e| {
            ServiceError::storage(format!("failed to begin agent run create transaction: {e}"))
        })?;

        if let Some(parent_run_id) = run.parent_run_id {
            let parent =
                sqlx::query("SELECT root_run_id, status FROM agent_runs WHERE agent_run_id = ?1")
                    .bind(parent_run_id)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|e| {
                        ServiceError::storage(format!("failed to inspect parent agent run: {e}"))
                    })?
                    .ok_or_else(|| ServiceError::storage("parent Agent Run not found"))?;
            use sqlx::Row;
            let parent_root_run_id: String = parent.get("root_run_id");
            let parent_status: String = parent.get("status");
            if parent_root_run_id != root_run_id {
                return Err(ServiceError::storage(
                    "child Agent Run root_run_id must match parent root_run_id",
                ));
            }
            if is_terminal_status(&parent_status) || parent_status == "cancelled" {
                return Err(ServiceError::storage(
                    "child Agent Run cannot be created under a terminal parent",
                ));
            }
        } else if root_run_id != run.agent_run_id {
            return Err(ServiceError::storage(
                "root Agent Run must use its own agent_run_id as root_run_id",
            ));
        }

        sqlx::query(
            "INSERT INTO agent_runs
             (agent_run_id, run_mode, agent_id, agent_revision, loom_id, response_id, parent_response_id,
              correlation_id, causation_id, root_run_id, parent_run_id, context_snapshot_id,
              provider_profile_id, model_id, status, cancel_requested, started_at, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'created',0,?15,?15)",
        )
        .bind(run.agent_run_id)
        .bind(run.run_mode.as_str())
        .bind(run.agent_id)
        .bind(run.agent_revision)
        .bind(run.loom_id)
        .bind(run.response_id)
        .bind(run.parent_response_id)
        .bind(run.correlation_id)
        .bind(run.causation_id)
        .bind(root_run_id)
        .bind(run.parent_run_id)
        .bind(run.context_snapshot_id)
        .bind(run.provider_profile_id)
        .bind(run.model_id)
        .bind(run.started_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to create agent run: {e}")))?;

        append_lifecycle_event_tx(
            &mut tx,
            run.agent_run_id,
            None,
            "run_created",
            serde_json::json!({
                "runId": run.agent_run_id,
                "rootRunId": root_run_id,
                "parentRunId": run.parent_run_id,
                "runMode": run.run_mode.as_str(),
                "state": "created"
            }),
        )
        .await?;

        tx.commit().await.map_err(|e| {
            ServiceError::storage(format!("failed to commit agent run create: {e}"))
        })?;

        self.get_run(run.agent_run_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created Agent Run not found"))
    }

    pub async fn create_lightweight_quick_ask_run(
        &self,
        run: &NewAgentRun<'_>,
    ) -> Result<AgentRunRecord, ServiceError> {
        if run.run_mode != AgentRunMode::LightweightQuickAsk {
            return Err(ServiceError::storage(
                "lightweight Quick Ask run must use lightweight_quick_ask mode",
            ));
        }
        if run.context_snapshot_id.is_some() {
            return Err(ServiceError::storage(
                "lightweight Quick Ask run cannot link context snapshots",
            ));
        }
        let root_run_id = run.root_run_id.unwrap_or(run.agent_run_id);
        let mut tx = self.pool.begin().await.map_err(|e| {
            ServiceError::storage(format!(
                "failed to begin lightweight agent run create transaction: {e}"
            ))
        })?;

        if let Some(parent_run_id) = run.parent_run_id {
            let parent =
                sqlx::query("SELECT root_run_id, status FROM agent_runs WHERE agent_run_id = ?1")
                    .bind(parent_run_id)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|e| {
                        ServiceError::storage(format!("failed to inspect parent agent run: {e}"))
                    })?
                    .ok_or_else(|| ServiceError::storage("parent Agent Run not found"))?;
            use sqlx::Row;
            let parent_root_run_id: String = parent.get("root_run_id");
            let parent_status: String = parent.get("status");
            if parent_root_run_id != root_run_id {
                return Err(ServiceError::storage(
                    "child Agent Run root_run_id must match parent root_run_id",
                ));
            }
            if is_terminal_status(&parent_status) || parent_status == "cancelled" {
                return Err(ServiceError::storage(
                    "child Agent Run cannot be created under a terminal parent",
                ));
            }
        } else if root_run_id != run.agent_run_id {
            return Err(ServiceError::storage(
                "root Agent Run must use its own agent_run_id as root_run_id",
            ));
        }

        sqlx::query(
            "INSERT INTO agent_runs
             (agent_run_id, run_mode, agent_id, agent_revision, loom_id, response_id, parent_response_id,
              correlation_id, causation_id, root_run_id, parent_run_id, context_snapshot_id,
              provider_profile_id, model_id, status, cancel_requested, started_at, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL,?12,?13,'running',0,?14,?14)",
        )
        .bind(run.agent_run_id)
        .bind(run.run_mode.as_str())
        .bind(run.agent_id)
        .bind(run.agent_revision)
        .bind(run.loom_id)
        .bind(run.response_id)
        .bind(run.parent_response_id)
        .bind(run.correlation_id)
        .bind(run.causation_id)
        .bind(root_run_id)
        .bind(run.parent_run_id)
        .bind(run.provider_profile_id)
        .bind(run.model_id)
        .bind(run.started_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to create lightweight agent run: {e}")))?;

        append_lifecycle_event_tx(
            &mut tx,
            run.agent_run_id,
            None,
            "run_created",
            serde_json::json!({
                "runId": run.agent_run_id,
                "rootRunId": root_run_id,
                "parentRunId": run.parent_run_id,
                "runMode": run.run_mode.as_str(),
                "state": "created"
            }),
        )
        .await?;
        append_lifecycle_event_tx(
            &mut tx,
            run.agent_run_id,
            None,
            "run_started",
            serde_json::json!({
                "runId": run.agent_run_id,
                "from": "created",
                "to": "running",
                "runMode": run.run_mode.as_str()
            }),
        )
        .await?;

        tx.commit().await.map_err(|e| {
            ServiceError::storage(format!(
                "failed to commit lightweight agent run create: {e}"
            ))
        })?;

        self.get_run(run.agent_run_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created lightweight Agent Run not found"))
    }

    pub async fn transition_run(
        &self,
        run_id: &str,
        transition: AgentRunTransition,
    ) -> Result<bool, ServiceError> {
        let now = now_iso();
        let mut tx = self.pool.begin().await.map_err(|e| {
            ServiceError::storage(format!("failed to begin agent run transition: {e}"))
        })?;
        let update = sqlx::query(
            "UPDATE agent_runs
             SET status = ?1,
                 completed_at = CASE WHEN ?2 = 1 THEN COALESCE(completed_at, ?3) ELSE completed_at END
             WHERE agent_run_id = ?4 AND status = ?5",
        )
        .bind(transition.to_state())
        .bind(if transition.is_terminal() { 1 } else { 0 })
        .bind(&now)
        .bind(run_id)
        .bind(transition.from_state())
        .execute(&mut *tx)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to transition agent run: {e}")))?;

        if update.rows_affected() == 0 {
            let exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM agent_runs WHERE agent_run_id = ?1",
            )
            .bind(run_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ServiceError::storage(format!("failed to inspect agent run: {e}")))?;
            tx.rollback().await.map_err(|e| {
                ServiceError::storage(format!("failed to rollback agent run transition: {e}"))
            })?;
            if exists == 0 {
                return Err(ServiceError::storage("Agent Run not found for transition"));
            }
            return Ok(false);
        }

        append_lifecycle_event_tx(
            &mut tx,
            run_id,
            None,
            transition.event_type(),
            serde_json::json!({
                "runId": run_id,
                "from": transition.from_state(),
                "to": transition.to_state()
            }),
        )
        .await?;

        tx.commit().await.map_err(|e| {
            ServiceError::storage(format!("failed to commit agent run transition: {e}"))
        })?;
        Ok(true)
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

    pub async fn finish_step(
        &self,
        step_id: &str,
        status: AgentStepStatus,
        error: Option<&str>,
    ) -> Result<(), ServiceError> {
        let safe_error = error.map(sanitize_provider_text);
        sqlx::query(
            "UPDATE agent_steps
             SET status = ?1, completed_at = COALESCE(completed_at, ?2), error = ?3
             WHERE agent_step_id = ?4 AND status IN ('pending','running')",
        )
        .bind(step_status_str(status))
        .bind(now_iso())
        .bind(safe_error.as_deref())
        .bind(step_id)
        .execute(&self.pool)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to finish agent step: {e}")))?;
        Ok(())
    }

    pub async fn append_event(&self, event: &NewAgentEvent<'_>) -> Result<(), ServiceError> {
        if let Some(payload) = &event.payload_json {
            validate_persisted_payload(payload)?;
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
    ) -> Result<bool, ServiceError> {
        debug_assert!(matches!(
            status,
            AgentRunStatus::Completed | AgentRunStatus::Failed | AgentRunStatus::Cancelled
        ));
        let status_str = status_str(status);
        let expected_event_type = match status {
            AgentRunStatus::Completed => "run_completed",
            AgentRunStatus::Failed => "run_failed",
            AgentRunStatus::Cancelled => "run_cancelled",
            _ => unreachable!("terminal status checked above"),
        };
        if terminal_event_type != expected_event_type {
            return Err(ServiceError::storage(format!(
                "terminal event type {terminal_event_type} does not match status {status_str}"
            )));
        }
        let now = now_iso();
        let input_tokens = usage.and_then(|u| u.input_tokens).map(|v| v as i64);
        let output_tokens = usage.and_then(|u| u.output_tokens).map(|v| v as i64);
        let total_tokens = usage.and_then(|u| u.total_tokens).map(|v| v as i64);
        let safe_error_message = error_message.map(sanitize_provider_text);

        let mut tx = self.pool.begin().await.map_err(|e| {
            ServiceError::storage(format!("failed to begin terminal transaction: {e}"))
        })?;

        let update = sqlx::query(
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
        .bind(safe_error_message.as_deref())
        .bind(run_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to update terminal run status: {e}")))?;

        if update.rows_affected() == 0 {
            tx.rollback().await.map_err(|e| {
                ServiceError::storage(format!("failed to rollback preserved terminal run: {e}"))
            })?;
            return Ok(false);
        }

        if let Some(payload) = &terminal_payload_json {
            validate_persisted_payload(payload)?;
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
        Ok(true)
    }

    pub async fn cancel_run(&self, run_id: &str) -> Result<(), ServiceError> {
        let now = now_iso();
        let mut tx = self.pool.begin().await.map_err(|e| {
            ServiceError::storage(format!("failed to begin agent run cancellation: {e}"))
        })?;

        let exists =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM agent_runs WHERE agent_run_id = ?1")
                .bind(run_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| ServiceError::storage(format!("failed to inspect agent run: {e}")))?;
        if exists == 0 {
            tx.rollback().await.map_err(|e| {
                ServiceError::storage(format!("failed to rollback missing cancellation: {e}"))
            })?;
            return Err(ServiceError::storage(
                "Agent Run not found for cancellation",
            ));
        }

        let rows = sqlx::query(
            "WITH RECURSIVE descendants(agent_run_id, depth) AS (
                SELECT agent_run_id, 0 FROM agent_runs WHERE agent_run_id = ?1
                UNION ALL
                SELECT child.agent_run_id, descendants.depth + 1
                FROM agent_runs child
                JOIN descendants ON child.parent_run_id = descendants.agent_run_id
             )
             SELECT agent_runs.agent_run_id, agent_runs.status
             FROM agent_runs
             JOIN descendants ON descendants.agent_run_id = agent_runs.agent_run_id
             ORDER BY descendants.depth ASC, agent_runs.created_at ASC",
        )
        .bind(run_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to list cancellation subtree: {e}")))?;

        for row in rows {
            use sqlx::Row;
            let descendant_run_id: String = row.get("agent_run_id");
            let status: String = row.get("status");
            if is_terminal_status(&status) {
                continue;
            }

            let update = sqlx::query(
                "UPDATE agent_runs
                 SET status = 'cancelled', cancel_requested = 1,
                     completed_at = COALESCE(completed_at, ?1)
                 WHERE agent_run_id = ?2
                   AND status NOT IN ('completed','failed','cancelled','interrupted')",
            )
            .bind(&now)
            .bind(&descendant_run_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                ServiceError::storage(format!(
                    "failed to cancel agent run {descendant_run_id}: {e}"
                ))
            })?;

            if update.rows_affected() == 1 {
                append_lifecycle_event_tx(
                    &mut tx,
                    &descendant_run_id,
                    None,
                    "run_cancelled",
                    serde_json::json!({
                        "runId": descendant_run_id,
                        "requestedRunId": run_id,
                        "scope": "run_and_descendants"
                    }),
                )
                .await?;
            }
        }

        tx.commit().await.map_err(|e| {
            ServiceError::storage(format!("failed to commit agent run cancellation: {e}"))
        })?;
        Ok(())
    }

    /// Links an existing Context Snapshot to an existing Agent Run.
    ///
    /// This mutation updates only `agent_runs.context_snapshot_id`. Snapshot
    /// creation and runtime integration remain separate responsibilities.
    pub async fn link_context_snapshot(
        &self,
        run_id: &str,
        snapshot_id: &str,
    ) -> Result<(), ServiceError> {
        let mut tx = self.pool.begin().await.map_err(|error| {
            ServiceError::storage(format!(
                "failed to begin context snapshot link transaction: {error}"
            ))
        })?;

        let current_snapshot_id = sqlx::query_scalar::<_, Option<String>>(
            "SELECT context_snapshot_id FROM agent_runs WHERE agent_run_id = ?1",
        )
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to inspect Agent Run snapshot link: {error}"
            ))
        })?
        .ok_or_else(|| ServiceError::storage("Agent Run not found for context snapshot link"))?;

        let snapshot_owner = sqlx::query_scalar::<_, Option<String>>(
            "SELECT agent_run_id FROM context_snapshots WHERE snapshot_id = ?1",
        )
        .bind(snapshot_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect Context Snapshot link: {error}"))
        })?
        .ok_or_else(|| ServiceError::storage("Context Snapshot not found for Agent Run link"))?;

        if snapshot_owner
            .as_deref()
            .is_some_and(|owner_run_id| owner_run_id != run_id)
        {
            return Err(ServiceError::storage(
                "Context Snapshot belongs to a different Agent Run",
            ));
        }
        if let Some(current_snapshot_id) = current_snapshot_id {
            if current_snapshot_id == snapshot_id {
                tx.commit().await.map_err(|error| {
                    ServiceError::storage(format!(
                        "failed to commit idempotent context snapshot link: {error}"
                    ))
                })?;
                return Ok(());
            }
            return Err(ServiceError::storage(
                "Agent Run is already linked to a different Context Snapshot",
            ));
        }

        sqlx::query("UPDATE agent_runs SET context_snapshot_id = ?1 WHERE agent_run_id = ?2")
            .bind(snapshot_id)
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                ServiceError::storage(format!(
                    "failed to link Context Snapshot to Agent Run: {error}"
                ))
            })?;

        tx.commit().await.map_err(|error| {
            ServiceError::storage(format!(
                "failed to commit Context Snapshot Agent Run link: {error}"
            ))
        })
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

    pub async fn get_agent_definition(
        &self,
        agent_id: &str,
        revision: &str,
    ) -> Result<Option<AgentDefinitionRecord>, ServiceError> {
        let row = sqlx::query(
            "SELECT agent_id, revision, name, role, instruction_set_ref,
                    capability_profile_ref, context_policy_ref, tool_policy_ref,
                    provider_policy_ref, enabled, metadata_json, created_at, updated_at
             FROM agent_definitions
             WHERE agent_id = ?1 AND revision = ?2",
        )
        .bind(agent_id)
        .bind(revision)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| ServiceError::storage(format!("failed to get agent definition: {e}")))?;

        Ok(row.map(agent_definition_record_from_row))
    }

    pub async fn get_run(&self, run_id: &str) -> Result<Option<AgentRunRecord>, ServiceError> {
        let row = sqlx::query(
            "SELECT agent_run_id, run_mode, agent_id, agent_revision, loom_id, response_id, parent_response_id,
                    correlation_id, causation_id, root_run_id, parent_run_id, context_snapshot_id,
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
            "SELECT agent_run_id, run_mode, agent_id, agent_revision, loom_id, response_id, parent_response_id,
                    correlation_id, causation_id, root_run_id, parent_run_id, context_snapshot_id,
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

fn is_terminal_status(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled" | "interrupted")
}

async fn append_lifecycle_event_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: &str,
    step_id: Option<&str>,
    event_type: &str,
    payload: serde_json::Value,
) -> Result<(), ServiceError> {
    let payload_json = payload.to_string();
    validate_persisted_payload(&payload_json)?;
    let sequence_number = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(sequence_number) + 1, 0)
         FROM agent_events WHERE agent_run_id = ?1",
    )
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| ServiceError::storage(format!("failed to allocate agent event sequence: {e}")))?;
    let event_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO agent_events
         (agent_event_id, agent_run_id, agent_step_id, sequence_number,
          event_type, payload_json, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,CURRENT_TIMESTAMP)",
    )
    .bind(event_id)
    .bind(run_id)
    .bind(step_id)
    .bind(sequence_number)
    .bind(event_type)
    .bind(payload_json)
    .execute(&mut **tx)
    .await
    .map_err(|e| ServiceError::storage(format!("failed to append lifecycle event: {e}")))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

fn agent_definition_record_from_row(row: sqlx::sqlite::SqliteRow) -> AgentDefinitionRecord {
    use sqlx::Row;
    let enabled: i64 = row.get("enabled");
    AgentDefinitionRecord {
        agent_id: row.get("agent_id"),
        revision: row.get("revision"),
        name: row.get("name"),
        role: row.get("role"),
        instruction_set_ref: row.get("instruction_set_ref"),
        capability_profile_ref: row.get("capability_profile_ref"),
        context_policy_ref: row.get("context_policy_ref"),
        tool_policy_ref: row.get("tool_policy_ref"),
        provider_policy_ref: row.get("provider_policy_ref"),
        enabled: enabled != 0,
        metadata_json: row.get("metadata_json"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn agent_run_record_from_row(row: sqlx::sqlite::SqliteRow) -> AgentRunRecord {
    use sqlx::Row;
    let cancel_requested: i64 = row.get("cancel_requested");
    AgentRunRecord {
        agent_run_id: row.get("agent_run_id"),
        run_mode: row.get("run_mode"),
        agent_id: row.get("agent_id"),
        agent_revision: row.get("agent_revision"),
        loom_id: row.get("loom_id"),
        response_id: row.get("response_id"),
        parent_response_id: row.get("parent_response_id"),
        correlation_id: row.get("correlation_id"),
        causation_id: row.get("causation_id"),
        root_run_id: row.get("root_run_id"),
        parent_run_id: row.get("parent_run_id"),
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

    fn run_input(run_id: &str) -> NewAgentRun<'_> {
        NewAgentRun {
            agent_run_id: run_id,
            run_mode: AgentRunMode::FullConversation,
            agent_id: None,
            agent_revision: None,
            loom_id: Some("loom-test"),
            response_id: Some("resp-assistant"),
            parent_response_id: Some("resp-user"),
            correlation_id: run_id,
            causation_id: Some("resp-user"),
            root_run_id: None,
            parent_run_id: None,
            context_snapshot_id: None,
            provider_profile_id: Some("ollama"),
            model_id: Some("test-model"),
            started_at: "1718000000000",
        }
    }

    async fn seed_snapshot(
        repo: &AgentRunRepository,
        snapshot_id: &str,
        owner_run_id: Option<&str>,
    ) {
        sqlx::query(
            "INSERT OR IGNORE INTO looms (
                loom_id, title, summary, code, canonical_uri, kind, created_at, updated_at
             ) VALUES ('loom-test', 'Test Loom', NULL, NULL, '/loom/test', 'loom', '1', '1')",
        )
        .execute(&repo.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO context_snapshots (
                snapshot_id, agent_run_id, loom_id, response_id, scope_context_id,
                created_at, policy_version, selection_version, budget_json,
                diagnostics_json, candidate_count, selected_count, rejected_count
             ) VALUES (?1, ?2, 'loom-test', NULL, NULL, '1', 'policy-v1',
                       'selection-v1', '{}', '{}', 0, 0, 0)",
        )
        .bind(snapshot_id)
        .bind(owner_run_id)
        .execute(&repo.pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn insert_run_is_retrievable_by_run_id() {
        let repo = make_repo().await;
        let mut input = run_input("run-retrieve-001");
        input.context_snapshot_id = Some("context-snapshot-001");
        repo.insert_run(&input).await.unwrap();
        let record = repo
            .get_run("run-retrieve-001")
            .await
            .unwrap()
            .expect("run must exist");
        assert_eq!(record.agent_run_id, "run-retrieve-001");
        assert_eq!(record.loom_id.as_deref(), Some("loom-test"));
        assert_eq!(record.response_id.as_deref(), Some("resp-assistant"));
        assert_eq!(record.correlation_id, "run-retrieve-001");
        assert_eq!(
            record.context_snapshot_id.as_deref(),
            Some("context-snapshot-001")
        );
        assert_eq!(record.status, "running");
        assert_eq!(record.run_mode, AgentRunMode::FullConversation.as_str());
        assert!(!record.cancel_requested);
    }

    #[tokio::test]
    async fn lightweight_quick_ask_run_combines_create_start_and_creates_no_steps() {
        let repo = make_repo().await;
        let mut input = run_input("lightweight-run-001");
        input.run_mode = AgentRunMode::LightweightQuickAsk;
        input.context_snapshot_id = None;

        let record = repo.create_lightweight_quick_ask_run(&input).await.unwrap();
        assert_eq!(record.agent_run_id, "lightweight-run-001");
        assert_eq!(record.run_mode, AgentRunMode::LightweightQuickAsk.as_str());
        assert_eq!(record.status, "running");
        assert_eq!(record.context_snapshot_id, None);

        let steps = repo
            .list_steps_for_run("lightweight-run-001")
            .await
            .unwrap();
        assert!(steps.is_empty());

        let events = repo
            .list_events_for_run("lightweight-run-001", 0, 10)
            .await
            .unwrap();
        let event_types: Vec<_> = events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect();
        assert_eq!(event_types, vec!["run_created", "run_started"]);

        let finished = repo
            .finish_run(
                "lightweight-run-001",
                AgentRunStatus::Completed,
                None,
                None,
                "lightweight-run-001-completed",
                "run_completed",
                2,
                Some(
                    serde_json::json!({
                        "runId": "lightweight-run-001",
                        "runMode": AgentRunMode::LightweightQuickAsk.as_str(),
                        "summary": "quick_ask_completed"
                    })
                    .to_string(),
                ),
            )
            .await
            .unwrap();
        assert!(finished);

        let steps = repo
            .list_steps_for_run("lightweight-run-001")
            .await
            .unwrap();
        assert!(steps.is_empty());
        let completed = repo
            .get_run("lightweight-run-001")
            .await
            .unwrap()
            .expect("run");
        assert_eq!(completed.status, "completed");
    }

    #[tokio::test]
    async fn lightweight_quick_ask_run_rejects_context_snapshot_links() {
        let repo = make_repo().await;
        let mut input = run_input("lightweight-run-context-reject");
        input.run_mode = AgentRunMode::LightweightQuickAsk;
        input.context_snapshot_id = Some("context-snapshot-not-allowed");

        let error = repo
            .create_lightweight_quick_ask_run(&input)
            .await
            .expect_err("context snapshots are not allowed");
        assert!(error
            .to_string()
            .contains("lightweight Quick Ask run cannot link context snapshots"));
    }

    #[tokio::test]
    async fn agent_definition_is_persisted_without_instruction_body() {
        let repo = make_repo().await;
        repo.insert_agent_definition(&NewAgentDefinition {
            agent_id: "agent-foundation",
            revision: "rev-1",
            name: "Foundation Agent",
            role: "runtime_foundation",
            instruction_set_ref: Some("instructions://agent-foundation/rev-1"),
            capability_profile_ref: Some("capability://basic"),
            context_policy_ref: Some("context://none"),
            tool_policy_ref: Some("tools://none"),
            provider_policy_ref: Some("provider://unset"),
            enabled: true,
            metadata_json: Some(r#"{"safe":"metadata"}"#.to_string()),
        })
        .await
        .unwrap();

        let record = repo
            .get_agent_definition("agent-foundation", "rev-1")
            .await
            .unwrap()
            .expect("definition");
        assert_eq!(record.agent_id, "agent-foundation");
        assert_eq!(record.revision, "rev-1");
        assert_eq!(
            record.instruction_set_ref.as_deref(),
            Some("instructions://agent-foundation/rev-1")
        );
        assert!(record.enabled);

        let serialized = serde_json::to_string(&record).unwrap();
        for forbidden in ["prompt", "raw_thinking", "provider_payload", "secret"] {
            assert!(
                !serialized.to_ascii_lowercase().contains(forbidden),
                "forbidden content '{forbidden}' found in definition"
            );
        }
    }

    #[tokio::test]
    async fn agent_definition_rejects_private_metadata() {
        let repo = make_repo().await;
        let result = repo
            .insert_agent_definition(&NewAgentDefinition {
                agent_id: "agent-private",
                revision: "rev-1",
                name: "Private Agent",
                role: "runtime_foundation",
                instruction_set_ref: None,
                capability_profile_ref: None,
                context_policy_ref: None,
                tool_policy_ref: None,
                provider_policy_ref: None,
                enabled: true,
                metadata_json: Some(r#"{"prompt":"do not store prompt bodies"}"#.to_string()),
            })
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn create_run_records_root_identity_and_run_created_event() {
        let repo = make_repo().await;
        let input = run_input("run-created-root");
        let record = repo.create_run(&input).await.unwrap();

        assert_eq!(record.status, "created");
        assert_eq!(record.root_run_id.as_deref(), Some("run-created-root"));
        assert_eq!(record.parent_run_id, None);

        let events = repo
            .list_events_for_run("run-created-root", 0, 10)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].sequence_number, 0);
        assert_eq!(events[0].event_type, "run_created");
    }

    #[tokio::test]
    async fn create_child_run_inherits_root_and_records_parent() {
        let repo = make_repo().await;
        repo.create_run(&run_input("run-root-tree")).await.unwrap();
        repo.transition_run("run-root-tree", AgentRunTransition::Queue)
            .await
            .unwrap();
        repo.transition_run("run-root-tree", AgentRunTransition::Start)
            .await
            .unwrap();

        let mut child = run_input("run-child-tree");
        child.root_run_id = Some("run-root-tree");
        child.parent_run_id = Some("run-root-tree");
        child.correlation_id = "run-root-tree";
        child.causation_id = Some("run-root-tree");
        let record = repo.create_run(&child).await.unwrap();

        assert_eq!(record.status, "created");
        assert_eq!(record.root_run_id.as_deref(), Some("run-root-tree"));
        assert_eq!(record.parent_run_id.as_deref(), Some("run-root-tree"));
    }

    #[tokio::test]
    async fn create_child_run_rejects_wrong_root_and_terminal_parent() {
        let repo = make_repo().await;
        repo.create_run(&run_input("run-root-parent"))
            .await
            .unwrap();
        repo.transition_run("run-root-parent", AgentRunTransition::Queue)
            .await
            .unwrap();
        repo.transition_run("run-root-parent", AgentRunTransition::Start)
            .await
            .unwrap();

        let mut wrong_root = run_input("run-child-wrong-root");
        wrong_root.root_run_id = Some("wrong-root");
        wrong_root.parent_run_id = Some("run-root-parent");
        let wrong_root_error = repo.create_run(&wrong_root).await.unwrap_err();
        assert!(wrong_root_error.to_string().contains("root_run_id"));

        repo.transition_run("run-root-parent", AgentRunTransition::Complete)
            .await
            .unwrap();
        let mut late_child = run_input("run-child-late");
        late_child.root_run_id = Some("run-root-parent");
        late_child.parent_run_id = Some("run-root-parent");
        let late_child_error = repo.create_run(&late_child).await.unwrap_err();
        assert!(late_child_error.to_string().contains("terminal parent"));
    }

    #[tokio::test]
    async fn required_state_machine_transitions_emit_ordered_events() {
        let repo = make_repo().await;
        repo.create_run(&run_input("run-transition-order"))
            .await
            .unwrap();

        for transition in [
            AgentRunTransition::Queue,
            AgentRunTransition::Start,
            AgentRunTransition::WaitTool,
            AgentRunTransition::ResumeFromTool,
            AgentRunTransition::WaitSubagent,
            AgentRunTransition::ResumeFromSubagent,
            AgentRunTransition::Complete,
        ] {
            assert!(repo
                .transition_run("run-transition-order", transition)
                .await
                .unwrap());
        }

        let record = repo
            .get_run("run-transition-order")
            .await
            .unwrap()
            .expect("run");
        assert_eq!(record.status, "completed");
        let events = repo
            .list_events_for_run("run-transition-order", 0, 20)
            .await
            .unwrap();
        let types: Vec<&str> = events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect();
        assert_eq!(
            types,
            vec![
                "run_created",
                "run_queued",
                "run_started",
                "run_waiting_tool",
                "run_started",
                "run_waiting_subagent",
                "run_started",
                "run_completed",
            ]
        );
        assert!(events
            .iter()
            .enumerate()
            .all(|(index, event)| event.sequence_number == index as i64));
    }

    #[tokio::test]
    async fn invalid_state_machine_transition_is_rejected_without_event() {
        let repo = make_repo().await;
        repo.create_run(&run_input("run-invalid-transition"))
            .await
            .unwrap();

        assert!(!repo
            .transition_run("run-invalid-transition", AgentRunTransition::Start)
            .await
            .unwrap());
        let record = repo
            .get_run("run-invalid-transition")
            .await
            .unwrap()
            .expect("run");
        assert_eq!(record.status, "created");
        let events = repo
            .list_events_for_run("run-invalid-transition", 0, 10)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "run_created");
    }

    #[tokio::test]
    async fn failure_transition_from_running_emits_failed_terminal_event() {
        let repo = make_repo().await;
        repo.create_run(&run_input("run-fails-from-running"))
            .await
            .unwrap();
        repo.transition_run("run-fails-from-running", AgentRunTransition::Queue)
            .await
            .unwrap();
        repo.transition_run("run-fails-from-running", AgentRunTransition::Start)
            .await
            .unwrap();
        assert!(repo
            .transition_run("run-fails-from-running", AgentRunTransition::Fail)
            .await
            .unwrap());

        let record = repo
            .get_run("run-fails-from-running")
            .await
            .unwrap()
            .expect("run");
        assert_eq!(record.status, "failed");
        let events = repo
            .list_events_for_run("run-fails-from-running", 0, 10)
            .await
            .unwrap();
        assert_eq!(events.last().unwrap().event_type, "run_failed");
    }

    #[tokio::test]
    async fn link_context_snapshot_is_idempotent_and_preserves_run_state() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-link-snapshot"))
            .await
            .unwrap();
        seed_snapshot(&repo, "snapshot-link", Some("run-link-snapshot")).await;
        let before = repo.get_run("run-link-snapshot").await.unwrap().unwrap();

        repo.link_context_snapshot("run-link-snapshot", "snapshot-link")
            .await
            .unwrap();
        repo.link_context_snapshot("run-link-snapshot", "snapshot-link")
            .await
            .unwrap();

        let after = repo.get_run("run-link-snapshot").await.unwrap().unwrap();
        assert_eq!(after.context_snapshot_id.as_deref(), Some("snapshot-link"));
        assert_eq!(after.status, before.status);
        assert_eq!(after.cancel_requested, before.cancel_requested);
        assert_eq!(after.completed_at, before.completed_at);
        assert_eq!(after.provider_profile_id, before.provider_profile_id);
        assert_eq!(after.model_id, before.model_id);
        let serialized = serde_json::to_string(&after).unwrap();
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "provider_payload",
            "prompt",
            "content",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn link_context_snapshot_rejects_unknown_run_and_snapshot() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-known-snapshot-link"))
            .await
            .unwrap();
        seed_snapshot(&repo, "snapshot-known-link", None).await;

        let unknown_run = repo
            .link_context_snapshot("run-missing", "snapshot-known-link")
            .await
            .unwrap_err();
        assert!(unknown_run.to_string().contains("Agent Run not found"));

        let unknown_snapshot = repo
            .link_context_snapshot("run-known-snapshot-link", "snapshot-missing")
            .await
            .unwrap_err();
        assert!(unknown_snapshot
            .to_string()
            .contains("Context Snapshot not found"));
        let run = repo
            .get_run("run-known-snapshot-link")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.context_snapshot_id, None);
        assert_eq!(run.status, "running");
    }

    #[tokio::test]
    async fn link_context_snapshot_rejects_conflicting_owner_and_replacement() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-link-owner")).await.unwrap();
        repo.insert_run(&run_input("run-link-other")).await.unwrap();
        seed_snapshot(&repo, "snapshot-other-owner", Some("run-link-other")).await;

        let owner_error = repo
            .link_context_snapshot("run-link-owner", "snapshot-other-owner")
            .await
            .unwrap_err();
        assert!(owner_error.to_string().contains("different Agent Run"));

        seed_snapshot(&repo, "snapshot-first", None).await;
        seed_snapshot(&repo, "snapshot-second", None).await;
        repo.link_context_snapshot("run-link-owner", "snapshot-first")
            .await
            .unwrap();
        let replacement_error = repo
            .link_context_snapshot("run-link-owner", "snapshot-second")
            .await
            .unwrap_err();
        assert!(replacement_error
            .to_string()
            .contains("already linked to a different Context Snapshot"));
        let run = repo.get_run("run-link-owner").await.unwrap().unwrap();
        assert_eq!(run.context_snapshot_id.as_deref(), Some("snapshot-first"));
        assert_eq!(run.status, "running");
    }

    #[tokio::test]
    async fn context_snapshot_forward_link_is_repository_validated_not_database_fk() {
        let repo = make_repo().await;
        let foreign_tables = sqlx::query_scalar::<_, String>(
            "SELECT \"table\" FROM pragma_foreign_key_list('agent_runs')",
        )
        .fetch_all(&repo.pool)
        .await
        .unwrap();
        assert!(!foreign_tables
            .iter()
            .any(|table| table == "context_snapshots"));
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
    async fn append_event_rejects_credentials_in_payload() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-credential-guard"))
            .await
            .unwrap();

        for (event_id, payload) in [
            ("evt-bearer", r#"{"message":"Bearer sk-live-secret"}"#),
            ("evt-api-key", r#"{"api_key":"sk-live-secret"}"#),
            ("evt-secret", r#"{"secret":"private"}"#),
        ] {
            let result = repo
                .append_event(&NewAgentEvent {
                    agent_event_id: event_id,
                    agent_run_id: "run-credential-guard",
                    agent_step_id: None,
                    sequence_number: 0,
                    event_type: "warning",
                    payload_json: Some(payload.to_string()),
                })
                .await;
            assert!(result.is_err(), "credential payload must be rejected");
        }
    }

    #[tokio::test]
    async fn finish_run_atomically_updates_status_and_inserts_terminal_event() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-finish-001")).await.unwrap();

        assert!(repo
            .finish_run(
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
            .unwrap());

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

        assert!(repo
            .finish_run(
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
            .unwrap());

        // Second finish call — must not change status or insert duplicate event
        assert!(!repo
            .finish_run(
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
            .unwrap());

        let record = repo.get_run("run-idempotent").await.unwrap().expect("run");
        assert_eq!(
            record.status, "completed",
            "terminal status must not change"
        );
        let events = repo
            .list_events_for_run("run-idempotent", 0, 10)
            .await
            .unwrap();
        assert_eq!(events.len(), 1, "exactly one terminal event must exist");
        assert_eq!(events[0].event_type, "run_completed");
    }

    #[tokio::test]
    async fn finish_run_rejects_terminal_event_type_mismatch() {
        let repo = make_repo().await;
        repo.insert_run(&run_input("run-terminal-mismatch"))
            .await
            .unwrap();

        let result = repo
            .finish_run(
                "run-terminal-mismatch",
                AgentRunStatus::Completed,
                None,
                None,
                "evt-terminal-mismatch",
                "run_failed",
                0,
                None,
            )
            .await;
        assert!(result.is_err());
        assert_eq!(
            repo.get_run("run-terminal-mismatch")
                .await
                .unwrap()
                .unwrap()
                .status,
            "running"
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
    async fn parent_cancellation_cascades_to_descendants_once() {
        let repo = make_repo().await;
        repo.create_run(&run_input("run-cascade-root"))
            .await
            .unwrap();
        repo.transition_run("run-cascade-root", AgentRunTransition::Queue)
            .await
            .unwrap();
        repo.transition_run("run-cascade-root", AgentRunTransition::Start)
            .await
            .unwrap();

        let mut child = run_input("run-cascade-child");
        child.root_run_id = Some("run-cascade-root");
        child.parent_run_id = Some("run-cascade-root");
        child.correlation_id = "run-cascade-root";
        repo.create_run(&child).await.unwrap();
        repo.transition_run("run-cascade-child", AgentRunTransition::Queue)
            .await
            .unwrap();
        repo.transition_run("run-cascade-child", AgentRunTransition::Start)
            .await
            .unwrap();

        let mut grandchild = run_input("run-cascade-grandchild");
        grandchild.root_run_id = Some("run-cascade-root");
        grandchild.parent_run_id = Some("run-cascade-child");
        grandchild.correlation_id = "run-cascade-root";
        repo.create_run(&grandchild).await.unwrap();
        repo.transition_run("run-cascade-grandchild", AgentRunTransition::Queue)
            .await
            .unwrap();

        repo.cancel_run("run-cascade-root").await.unwrap();
        repo.cancel_run("run-cascade-root").await.unwrap();

        for run_id in [
            "run-cascade-root",
            "run-cascade-child",
            "run-cascade-grandchild",
        ] {
            let record = repo.get_run(run_id).await.unwrap().expect("run");
            assert_eq!(record.status, "cancelled");
            assert!(record.cancel_requested);

            let events = repo.list_events_for_run(run_id, 0, 20).await.unwrap();
            assert_eq!(
                events
                    .iter()
                    .filter(|event| event.event_type == "run_cancelled")
                    .count(),
                1,
                "cancellation event must be emitted exactly once for {run_id}"
            );
        }
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
        let input = run_input("run-privacy-001");
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
