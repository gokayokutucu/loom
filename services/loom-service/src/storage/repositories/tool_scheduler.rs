#![allow(dead_code)]

//! Durable Tool Scheduler storage foundation.
//! (TOOL-SCHEDULER-SCHEMA-001)
//!
//! This repository stores only safe scheduler metadata: definitions,
//! invocation lifecycle state, artifact references, and permission grants. It
//! deliberately does not store raw tool payloads, raw stdout/stderr, file
//! contents, prompts, provider payloads, secrets, or raw thinking.

use crate::error::ServiceError;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

const FORBIDDEN_PERSISTED_MARKERS: [&str; 24] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "raw_output",
    "raw_stdout",
    "raw_stderr",
    "stdout",
    "stderr",
    "\"stdout\"",
    "\"stderr\"",
    "file_contents",
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
    "provider_payload",
    "provider_request",
];

fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}

fn validate_safe_persisted_text(label: &str, text: &str) -> Result<(), ServiceError> {
    let lower = text.to_ascii_lowercase();
    for forbidden in FORBIDDEN_PERSISTED_MARKERS {
        if lower.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "{label} contains forbidden persisted marker: {forbidden}"
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolInvocationStatus {
    Requested,
    PermissionRequired,
    PermissionDenied,
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    TimedOut,
}

impl ToolInvocationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::PermissionRequired => "permission_required",
            Self::PermissionDenied => "permission_denied",
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolInvocationPermissionStatus {
    NotRequired,
    Pending,
    Granted,
    Denied,
    Revoked,
}

impl ToolInvocationPermissionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotRequired => "not_required",
            Self::Pending => "pending",
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Revoked => "revoked",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolGrantStatus {
    Pending,
    Granted,
    Denied,
    Revoked,
    Expired,
}

impl ToolGrantStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Revoked => "revoked",
            Self::Expired => "expired",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolPermissionScope {
    OneTime,
    Run,
    RootRun,
    Session,
    Workspace,
}

impl ToolPermissionScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OneTime => "one_time",
            Self::Run => "run",
            Self::RootRun => "root_run",
            Self::Session => "session",
            Self::Workspace => "workspace",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolArtifactKind {
    TextSummary,
    FileRef,
    ImageRef,
    JsonSummary,
    BinaryRef,
    LogSummary,
}

impl ToolArtifactKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TextSummary => "text_summary",
            Self::FileRef => "file_ref",
            Self::ImageRef => "image_ref",
            Self::JsonSummary => "json_summary",
            Self::BinaryRef => "binary_ref",
            Self::LogSummary => "log_summary",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolArtifactVisibility {
    Private,
    Run,
    RootRun,
    UserVisible,
}

impl ToolArtifactVisibility {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Private => "private",
            Self::Run => "run",
            Self::RootRun => "root_run",
            Self::UserVisible => "user_visible",
        }
    }
}

fn is_supported_permission_scope(scope: &str) -> bool {
    matches!(
        scope,
        "one_time" | "run" | "root_run" | "session" | "workspace"
    )
}

fn is_supported_artifact_kind(kind: &str) -> bool {
    matches!(
        kind,
        "text_summary" | "file_ref" | "image_ref" | "json_summary" | "binary_ref" | "log_summary"
    )
}

fn storage_visibility_for_artifact(visibility: &str) -> Option<&'static str> {
    match visibility {
        "private" | "run" | "agent_internal" => Some("agent_internal"),
        "root_run" | "exportable" => Some("exportable"),
        "user_visible" => Some("user_visible"),
        _ => None,
    }
}

fn grant_is_active(grant: &ToolPermissionGrantRecord, now: &str) -> bool {
    grant.permission_status == "granted"
        && grant.revoked_at.is_none()
        && grant
            .expires_at
            .as_deref()
            .map(|expires_at| expires_at > now)
            .unwrap_or(true)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinitionRecord {
    pub tool_id: String,
    pub tool_name: String,
    pub tool_kind: String,
    pub trust_level: String,
    pub requires_permission: bool,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvocationRecord {
    pub invocation_id: String,
    pub root_run_id: String,
    pub agent_run_id: String,
    pub parent_invocation_id: Option<String>,
    pub tool_id: String,
    pub status: String,
    pub permission_status: String,
    pub requested_at: String,
    pub queued_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub cancelled_at: Option<String>,
    pub failed_at: Option<String>,
    pub timeout_ms: Option<i64>,
    pub sanitized_summary: Option<String>,
    pub diagnostics_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolArtifactRecord {
    pub artifact_id: String,
    pub invocation_id: String,
    pub root_run_id: String,
    pub agent_run_id: String,
    pub artifact_kind: String,
    pub storage_ref: String,
    pub visibility: String,
    pub content_digest: Option<String>,
    pub size_bytes: Option<i64>,
    pub created_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionGrantRecord {
    pub grant_id: String,
    pub root_run_id: String,
    pub agent_run_id: Option<String>,
    pub tool_id: Option<String>,
    pub permission_scope: String,
    pub permission_status: String,
    pub granted_by: String,
    pub granted_at: Option<String>,
    pub revoked_at: Option<String>,
    pub expires_at: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionDiagnostics {
    pub candidate_grant_count: i64,
    pub active_grant_count: i64,
    pub matching_active_grant_count: i64,
    pub denied_grant_count: i64,
    pub revoked_grant_count: i64,
    pub expired_grant_count: i64,
    pub pending_grant_count: i64,
    pub one_time_consumption_deferred: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionEvaluation {
    pub authorized: bool,
    pub permission_required: bool,
    pub decision_status: String,
    pub reason_code: String,
    pub matching_grant_id: Option<String>,
    pub matching_scope: Option<String>,
    pub diagnostics: ToolPermissionDiagnostics,
}

pub struct NewToolDefinition<'a> {
    pub tool_id: &'a str,
    pub tool_name: &'a str,
    pub tool_kind: &'a str,
    pub trust_level: &'a str,
    pub requires_permission: bool,
    pub is_enabled: bool,
}

pub struct NewToolInvocation<'a> {
    pub invocation_id: &'a str,
    pub root_run_id: &'a str,
    pub agent_run_id: &'a str,
    pub parent_invocation_id: Option<&'a str>,
    pub tool_id: &'a str,
    pub permission_status: ToolInvocationPermissionStatus,
    pub requested_at: &'a str,
    pub timeout_ms: Option<i64>,
    pub sanitized_summary: Option<&'a str>,
    pub diagnostics_json: Option<&'a str>,
}

pub struct NewToolArtifact<'a> {
    pub artifact_id: &'a str,
    pub invocation_id: &'a str,
    pub root_run_id: &'a str,
    pub agent_run_id: &'a str,
    pub artifact_kind: &'a str,
    pub storage_ref: &'a str,
    pub visibility: &'a str,
    pub content_digest: Option<&'a str>,
    pub size_bytes: Option<i64>,
}

pub struct NewToolPermissionGrant<'a> {
    pub grant_id: &'a str,
    pub root_run_id: &'a str,
    pub agent_run_id: Option<&'a str>,
    pub tool_id: Option<&'a str>,
    pub permission_scope: &'a str,
    pub permission_status: ToolGrantStatus,
    pub granted_by: &'a str,
    pub granted_at: Option<&'a str>,
    pub expires_at: Option<&'a str>,
    pub metadata_json: Option<&'a str>,
}

pub struct ToolPermissionLookup<'a> {
    pub root_run_id: &'a str,
    pub agent_run_id: &'a str,
    pub tool_id: &'a str,
    pub now: &'a str,
}

#[derive(Debug, Clone)]
pub struct ToolSchedulerRepository {
    pool: SqlitePool,
}

impl ToolSchedulerRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_pool(pool: &SqlitePool) -> Self {
        Self::new(pool.clone())
    }

    pub async fn create_tool_definition(
        &self,
        definition: &NewToolDefinition<'_>,
    ) -> Result<ToolDefinitionRecord, ServiceError> {
        sqlx::query(
            "INSERT INTO tool_definitions
             (tool_id, tool_name, tool_kind, trust_level, requires_permission, is_enabled,
              created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .bind(definition.tool_id)
        .bind(definition.tool_name)
        .bind(definition.tool_kind)
        .bind(definition.trust_level)
        .bind(if definition.requires_permission { 1 } else { 0 })
        .bind(if definition.is_enabled { 1 } else { 0 })
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create tool definition: {error}"))
        })?;

        self.get_tool_definition(definition.tool_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created tool definition not found"))
    }

    pub async fn get_tool_definition(
        &self,
        tool_id: &str,
    ) -> Result<Option<ToolDefinitionRecord>, ServiceError> {
        sqlx::query("SELECT * FROM tool_definitions WHERE tool_id = ?1")
            .bind(tool_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(tool_definition_from_row))
            .map_err(|error| {
                ServiceError::storage(format!("failed to get tool definition: {error}"))
            })
    }

    pub async fn list_tool_definitions(&self) -> Result<Vec<ToolDefinitionRecord>, ServiceError> {
        sqlx::query("SELECT * FROM tool_definitions ORDER BY tool_name, tool_id")
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(tool_definition_from_row).collect())
            .map_err(|error| {
                ServiceError::storage(format!("failed to list tool definitions: {error}"))
            })
    }

    pub async fn create_invocation(
        &self,
        invocation: &NewToolInvocation<'_>,
    ) -> Result<ToolInvocationRecord, ServiceError> {
        if let Some(summary) = invocation.sanitized_summary {
            validate_safe_persisted_text("tool invocation sanitized_summary", summary)?;
        }
        if let Some(diagnostics) = invocation.diagnostics_json {
            validate_safe_persisted_text("tool invocation diagnostics_json", diagnostics)?;
        }
        self.ensure_agent_run_under_root(invocation.agent_run_id, invocation.root_run_id)
            .await?;

        sqlx::query(
            "INSERT INTO tool_invocations
             (invocation_id, root_run_id, agent_run_id, parent_invocation_id, tool_id,
              status, permission_status, requested_at, timeout_ms, sanitized_summary,
              diagnostics_json)
             VALUES (?1,?2,?3,?4,?5,'requested',?6,?7,?8,?9,?10)",
        )
        .bind(invocation.invocation_id)
        .bind(invocation.root_run_id)
        .bind(invocation.agent_run_id)
        .bind(invocation.parent_invocation_id)
        .bind(invocation.tool_id)
        .bind(invocation.permission_status.as_str())
        .bind(invocation.requested_at)
        .bind(invocation.timeout_ms)
        .bind(invocation.sanitized_summary)
        .bind(invocation.diagnostics_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create tool invocation: {error}"))
        })?;

        self.get_invocation(invocation.invocation_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created tool invocation not found"))
    }

    pub async fn get_invocation(
        &self,
        invocation_id: &str,
    ) -> Result<Option<ToolInvocationRecord>, ServiceError> {
        sqlx::query("SELECT * FROM tool_invocations WHERE invocation_id = ?1")
            .bind(invocation_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(tool_invocation_from_row))
            .map_err(|error| {
                ServiceError::storage(format!("failed to get tool invocation: {error}"))
            })
    }

    pub async fn transition_invocation_status(
        &self,
        invocation_id: &str,
        status: ToolInvocationStatus,
    ) -> Result<bool, ServiceError> {
        let now = now_iso();
        let update = sqlx::query(
            "UPDATE tool_invocations
             SET status = ?1,
                 queued_at = CASE WHEN ?1 = 'queued' THEN COALESCE(queued_at, ?2) ELSE queued_at END,
                 started_at = CASE WHEN ?1 = 'running' THEN COALESCE(started_at, ?2) ELSE started_at END,
                 completed_at = CASE WHEN ?1 = 'completed' THEN COALESCE(completed_at, ?2) ELSE completed_at END,
                 cancelled_at = CASE WHEN ?1 = 'cancelled' THEN COALESCE(cancelled_at, ?2) ELSE cancelled_at END,
                 failed_at = CASE WHEN ?1 IN ('failed','timed_out') THEN COALESCE(failed_at, ?2) ELSE failed_at END
             WHERE invocation_id = ?3
               AND status NOT IN ('completed','failed','cancelled','timed_out')",
        )
        .bind(status.as_str())
        .bind(&now)
        .bind(invocation_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to transition tool invocation: {error}"))
        })?;

        if update.rows_affected() > 0 {
            return Ok(true);
        }

        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM tool_invocations WHERE invocation_id = ?1",
        )
        .bind(invocation_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect tool invocation: {error}"))
        })?;
        if exists == 0 {
            return Err(ServiceError::storage("tool invocation not found"));
        }
        Ok(false)
    }

    pub async fn create_artifact_ref(
        &self,
        artifact: &NewToolArtifact<'_>,
    ) -> Result<ToolArtifactRecord, ServiceError> {
        if !is_supported_artifact_kind(artifact.artifact_kind) {
            return Err(ServiceError::storage(format!(
                "unsupported tool artifact kind: {}",
                artifact.artifact_kind
            )));
        }
        let storage_visibility =
            storage_visibility_for_artifact(artifact.visibility).ok_or_else(|| {
                ServiceError::storage(format!(
                    "unsupported tool artifact visibility: {}",
                    artifact.visibility
                ))
            })?;
        validate_safe_persisted_text("tool artifact storage_ref", artifact.storage_ref)?;
        if let Some(content_digest) = artifact.content_digest {
            validate_safe_persisted_text("tool artifact content_digest", content_digest)?;
        }
        self.ensure_agent_run_under_root(artifact.agent_run_id, artifact.root_run_id)
            .await?;
        self.ensure_invocation_under_run(
            artifact.invocation_id,
            artifact.agent_run_id,
            artifact.root_run_id,
        )
        .await?;

        sqlx::query(
            "INSERT INTO tool_artifacts
             (artifact_id, invocation_id, root_run_id, agent_run_id, artifact_kind, storage_ref,
              visibility, content_digest, size_bytes, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,CURRENT_TIMESTAMP)",
        )
        .bind(artifact.artifact_id)
        .bind(artifact.invocation_id)
        .bind(artifact.root_run_id)
        .bind(artifact.agent_run_id)
        .bind(artifact.artifact_kind)
        .bind(artifact.storage_ref)
        .bind(storage_visibility)
        .bind(artifact.content_digest)
        .bind(artifact.size_bytes)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create artifact ref: {error}"))
        })?;

        self.get_artifact(artifact.artifact_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created tool artifact not found"))
    }

    pub async fn get_artifact(
        &self,
        artifact_id: &str,
    ) -> Result<Option<ToolArtifactRecord>, ServiceError> {
        self.get_artifact_with_deleted(artifact_id, false).await
    }

    pub async fn get_artifact_with_deleted(
        &self,
        artifact_id: &str,
        include_deleted: bool,
    ) -> Result<Option<ToolArtifactRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM tool_artifacts
             WHERE artifact_id = ?1
               AND (?2 OR deleted_at IS NULL)",
        )
        .bind(artifact_id)
        .bind(if include_deleted { 1 } else { 0 })
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(tool_artifact_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to get artifact ref: {error}")))
    }

    pub async fn list_artifacts_by_invocation(
        &self,
        invocation_id: &str,
    ) -> Result<Vec<ToolArtifactRecord>, ServiceError> {
        self.list_artifacts_by_invocation_with_deleted(invocation_id, false)
            .await
    }

    pub async fn list_artifacts_by_invocation_with_deleted(
        &self,
        invocation_id: &str,
        include_deleted: bool,
    ) -> Result<Vec<ToolArtifactRecord>, ServiceError> {
        self.list_artifacts_by("invocation_id", invocation_id, include_deleted)
            .await
    }

    pub async fn list_artifacts_by_agent_run(
        &self,
        agent_run_id: &str,
    ) -> Result<Vec<ToolArtifactRecord>, ServiceError> {
        self.list_artifacts_by_agent_run_with_deleted(agent_run_id, false)
            .await
    }

    pub async fn list_artifacts_by_agent_run_with_deleted(
        &self,
        agent_run_id: &str,
        include_deleted: bool,
    ) -> Result<Vec<ToolArtifactRecord>, ServiceError> {
        self.list_artifacts_by("agent_run_id", agent_run_id, include_deleted)
            .await
    }

    pub async fn list_artifacts_by_root_run(
        &self,
        root_run_id: &str,
    ) -> Result<Vec<ToolArtifactRecord>, ServiceError> {
        self.list_artifacts_by_root_run_with_deleted(root_run_id, false)
            .await
    }

    pub async fn list_artifacts_by_root_run_with_deleted(
        &self,
        root_run_id: &str,
        include_deleted: bool,
    ) -> Result<Vec<ToolArtifactRecord>, ServiceError> {
        self.list_artifacts_by("root_run_id", root_run_id, include_deleted)
            .await
    }

    pub async fn soft_delete_artifact_ref(&self, artifact_id: &str) -> Result<bool, ServiceError> {
        let update = sqlx::query(
            "UPDATE tool_artifacts
             SET deleted_at = COALESCE(deleted_at, ?1)
             WHERE artifact_id = ?2
               AND deleted_at IS NULL",
        )
        .bind(now_iso())
        .bind(artifact_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to soft delete artifact ref: {error}"))
        })?;

        if update.rows_affected() > 0 {
            return Ok(true);
        }

        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM tool_artifacts WHERE artifact_id = ?1",
        )
        .bind(artifact_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect artifact ref: {error}"))
        })?;
        if exists == 0 {
            return Err(ServiceError::storage("tool artifact not found"));
        }
        Ok(false)
    }

    pub async fn create_permission_grant(
        &self,
        grant: &NewToolPermissionGrant<'_>,
    ) -> Result<ToolPermissionGrantRecord, ServiceError> {
        if !is_supported_permission_scope(grant.permission_scope) {
            return Err(ServiceError::storage(format!(
                "unsupported tool permission scope: {}",
                grant.permission_scope
            )));
        }
        if let Some(metadata) = grant.metadata_json {
            validate_safe_persisted_text("tool permission metadata_json", metadata)?;
        }
        if let Some(agent_run_id) = grant.agent_run_id {
            self.ensure_agent_run_under_root(agent_run_id, grant.root_run_id)
                .await?;
        }

        sqlx::query(
            "INSERT INTO tool_permission_grants
             (grant_id, root_run_id, agent_run_id, tool_id, permission_scope,
              permission_status, granted_by, granted_at, expires_at, metadata_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        )
        .bind(grant.grant_id)
        .bind(grant.root_run_id)
        .bind(grant.agent_run_id)
        .bind(grant.tool_id)
        .bind(grant.permission_scope)
        .bind(grant.permission_status.as_str())
        .bind(grant.granted_by)
        .bind(grant.granted_at)
        .bind(grant.expires_at)
        .bind(grant.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create permission grant: {error}"))
        })?;

        self.get_permission_grant(grant.grant_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created tool permission grant not found"))
    }

    pub async fn create_permission_request(
        &self,
        request: &NewToolPermissionGrant<'_>,
    ) -> Result<ToolPermissionGrantRecord, ServiceError> {
        if request.permission_status != ToolGrantStatus::Pending {
            return Err(ServiceError::storage(
                "permission request must be created with pending status",
            ));
        }
        self.create_permission_grant(request).await
    }

    pub async fn get_permission_grant(
        &self,
        grant_id: &str,
    ) -> Result<Option<ToolPermissionGrantRecord>, ServiceError> {
        sqlx::query("SELECT * FROM tool_permission_grants WHERE grant_id = ?1")
            .bind(grant_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(tool_permission_grant_from_row))
            .map_err(|error| {
                ServiceError::storage(format!("failed to get permission grant: {error}"))
            })
    }

    pub async fn revoke_permission_grant(&self, grant_id: &str) -> Result<bool, ServiceError> {
        let update = sqlx::query(
            "UPDATE tool_permission_grants
             SET permission_status = 'revoked',
                 revoked_at = COALESCE(revoked_at, ?1)
             WHERE grant_id = ?2
               AND permission_status != 'revoked'",
        )
        .bind(now_iso())
        .bind(grant_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to revoke permission grant: {error}"))
        })?;

        if update.rows_affected() > 0 {
            return Ok(true);
        }

        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM tool_permission_grants WHERE grant_id = ?1",
        )
        .bind(grant_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect permission grant: {error}"))
        })?;
        if exists == 0 {
            return Err(ServiceError::storage("tool permission grant not found"));
        }
        Ok(false)
    }

    pub async fn evaluate_permission(
        &self,
        lookup: &ToolPermissionLookup<'_>,
    ) -> Result<ToolPermissionEvaluation, ServiceError> {
        let tool_exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM tool_definitions WHERE tool_id = ?1",
        )
        .bind(lookup.tool_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect tool definition: {error}"))
        })?;
        if tool_exists == 0 {
            return Ok(permission_denied("unknown_tool"));
        }

        let run = sqlx::query(
            "SELECT root_run_id, parent_run_id FROM agent_runs WHERE agent_run_id = ?1",
        )
        .bind(lookup.agent_run_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to inspect agent run: {error}")))?;
        let Some(run) = run else {
            return Ok(permission_denied("unknown_run"));
        };
        let stored_root_run_id: String = run.get("root_run_id");
        if stored_root_run_id != lookup.root_run_id {
            return Ok(permission_denied("root_run_mismatch"));
        }

        let grants = sqlx::query(
            "SELECT * FROM tool_permission_grants
             WHERE root_run_id = ?1
               AND (tool_id = ?2 OR tool_id IS NULL)",
        )
        .bind(lookup.root_run_id)
        .bind(lookup.tool_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to list permission grants: {error}"))
        })?
        .into_iter()
        .map(tool_permission_grant_from_row)
        .collect::<Vec<_>>();

        let candidate_grant_count = grants.len() as i64;
        let mut active_grant_count = 0;
        let mut matching_active_grant_count = 0;
        let mut denied_grant_count = 0;
        let mut revoked_grant_count = 0;
        let mut expired_grant_count = 0;
        let mut pending_grant_count = 0;
        let mut first_match: Option<ToolPermissionGrantRecord> = None;

        for grant in &grants {
            match grant.permission_status.as_str() {
                "pending" => pending_grant_count += 1,
                "denied" => denied_grant_count += 1,
                "revoked" => revoked_grant_count += 1,
                "expired" => expired_grant_count += 1,
                _ => {}
            }

            if grant.permission_status == "granted"
                && grant
                    .expires_at
                    .as_deref()
                    .map(|expires_at| expires_at <= lookup.now)
                    .unwrap_or(false)
            {
                expired_grant_count += 1;
            }

            if !grant_is_active(grant, lookup.now) {
                continue;
            }
            active_grant_count += 1;
            if grant_matches_lookup(grant, lookup) {
                matching_active_grant_count += 1;
                if first_match.is_none() {
                    first_match = Some(grant.clone());
                }
            }
        }

        let one_time_consumption_deferred = first_match
            .as_ref()
            .map(|grant| grant.permission_scope == ToolPermissionScope::OneTime.as_str())
            .unwrap_or(false);
        let diagnostics = ToolPermissionDiagnostics {
            candidate_grant_count,
            active_grant_count,
            matching_active_grant_count,
            denied_grant_count,
            revoked_grant_count,
            expired_grant_count,
            pending_grant_count,
            one_time_consumption_deferred,
        };

        if let Some(grant) = first_match {
            return Ok(ToolPermissionEvaluation {
                authorized: true,
                permission_required: false,
                decision_status: "granted".to_string(),
                reason_code: "matching_active_grant".to_string(),
                matching_grant_id: Some(grant.grant_id),
                matching_scope: Some(grant.permission_scope),
                diagnostics,
            });
        }

        Ok(ToolPermissionEvaluation {
            authorized: false,
            permission_required: true,
            decision_status: "permission_required".to_string(),
            reason_code: "no_matching_active_grant".to_string(),
            matching_grant_id: None,
            matching_scope: None,
            diagnostics,
        })
    }

    async fn list_artifacts_by(
        &self,
        column: &str,
        value: &str,
        include_deleted: bool,
    ) -> Result<Vec<ToolArtifactRecord>, ServiceError> {
        let sql = match column {
            "invocation_id" => {
                "SELECT * FROM tool_artifacts
                 WHERE invocation_id = ?1
                   AND (?2 OR deleted_at IS NULL)
                 ORDER BY created_at, artifact_id"
            }
            "agent_run_id" => {
                "SELECT * FROM tool_artifacts
                 WHERE agent_run_id = ?1
                   AND (?2 OR deleted_at IS NULL)
                 ORDER BY created_at, artifact_id"
            }
            "root_run_id" => {
                "SELECT * FROM tool_artifacts
                 WHERE root_run_id = ?1
                   AND (?2 OR deleted_at IS NULL)
                 ORDER BY created_at, artifact_id"
            }
            _ => return Err(ServiceError::storage("unsupported artifact list column")),
        };

        sqlx::query(sql)
            .bind(value)
            .bind(if include_deleted { 1 } else { 0 })
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(tool_artifact_from_row).collect())
            .map_err(|error| {
                ServiceError::storage(format!("failed to list artifact refs: {error}"))
            })
    }

    async fn ensure_invocation_under_run(
        &self,
        invocation_id: &str,
        agent_run_id: &str,
        root_run_id: &str,
    ) -> Result<(), ServiceError> {
        let row = sqlx::query(
            "SELECT agent_run_id, root_run_id FROM tool_invocations WHERE invocation_id = ?1",
        )
        .bind(invocation_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect tool invocation: {error}"))
        })?;
        let Some(row) = row else {
            return Err(ServiceError::storage(
                "tool invocation not found for artifact ref",
            ));
        };

        let stored_agent_run_id: String = row.get("agent_run_id");
        let stored_root_run_id: String = row.get("root_run_id");
        if stored_agent_run_id != agent_run_id || stored_root_run_id != root_run_id {
            return Err(ServiceError::storage(
                "tool artifact ownership must match invocation run ownership",
            ));
        }
        Ok(())
    }

    async fn ensure_agent_run_under_root(
        &self,
        agent_run_id: &str,
        root_run_id: &str,
    ) -> Result<(), ServiceError> {
        let stored_root = sqlx::query_scalar::<_, Option<String>>(
            "SELECT root_run_id FROM agent_runs WHERE agent_run_id = ?1",
        )
        .bind(agent_run_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to inspect agent run: {error}")))?;

        let stored_root = stored_root.flatten().ok_or_else(|| {
            ServiceError::storage("agent run not found for tool scheduler record")
        })?;
        if stored_root != root_run_id {
            return Err(ServiceError::storage(
                "tool scheduler record root_run_id must match agent run root_run_id",
            ));
        }
        Ok(())
    }
}

fn permission_denied(reason_code: &str) -> ToolPermissionEvaluation {
    ToolPermissionEvaluation {
        authorized: false,
        permission_required: true,
        decision_status: "permission_required".to_string(),
        reason_code: reason_code.to_string(),
        matching_grant_id: None,
        matching_scope: None,
        diagnostics: ToolPermissionDiagnostics {
            candidate_grant_count: 0,
            active_grant_count: 0,
            matching_active_grant_count: 0,
            denied_grant_count: 0,
            revoked_grant_count: 0,
            expired_grant_count: 0,
            pending_grant_count: 0,
            one_time_consumption_deferred: false,
        },
    }
}

fn grant_matches_lookup(
    grant: &ToolPermissionGrantRecord,
    lookup: &ToolPermissionLookup<'_>,
) -> bool {
    if let Some(tool_id) = grant.tool_id.as_deref() {
        if tool_id != lookup.tool_id {
            return false;
        }
    }

    match grant.permission_scope.as_str() {
        "one_time" | "run" => grant.agent_run_id.as_deref() == Some(lookup.agent_run_id),
        "root_run" => grant.root_run_id == lookup.root_run_id,
        "session" | "workspace" => {
            grant.root_run_id == lookup.root_run_id
                && grant
                    .agent_run_id
                    .as_deref()
                    .map(|agent_run_id| agent_run_id == lookup.agent_run_id)
                    .unwrap_or(true)
        }
        _ => false,
    }
}

fn tool_definition_from_row(row: SqliteRow) -> ToolDefinitionRecord {
    ToolDefinitionRecord {
        tool_id: row.get("tool_id"),
        tool_name: row.get("tool_name"),
        tool_kind: row.get("tool_kind"),
        trust_level: row.get("trust_level"),
        requires_permission: row.get::<i64, _>("requires_permission") != 0,
        is_enabled: row.get::<i64, _>("is_enabled") != 0,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn tool_invocation_from_row(row: SqliteRow) -> ToolInvocationRecord {
    ToolInvocationRecord {
        invocation_id: row.get("invocation_id"),
        root_run_id: row.get("root_run_id"),
        agent_run_id: row.get("agent_run_id"),
        parent_invocation_id: row.get("parent_invocation_id"),
        tool_id: row.get("tool_id"),
        status: row.get("status"),
        permission_status: row.get("permission_status"),
        requested_at: row.get("requested_at"),
        queued_at: row.get("queued_at"),
        started_at: row.get("started_at"),
        completed_at: row.get("completed_at"),
        cancelled_at: row.get("cancelled_at"),
        failed_at: row.get("failed_at"),
        timeout_ms: row.get("timeout_ms"),
        sanitized_summary: row.get("sanitized_summary"),
        diagnostics_json: row.get("diagnostics_json"),
    }
}

fn tool_artifact_from_row(row: SqliteRow) -> ToolArtifactRecord {
    ToolArtifactRecord {
        artifact_id: row.get("artifact_id"),
        invocation_id: row.get("invocation_id"),
        root_run_id: row.get("root_run_id"),
        agent_run_id: row.get("agent_run_id"),
        artifact_kind: row.get("artifact_kind"),
        storage_ref: row.get("storage_ref"),
        visibility: row.get("visibility"),
        content_digest: row.get("content_digest"),
        size_bytes: row.get("size_bytes"),
        created_at: row.get("created_at"),
        deleted_at: row.get("deleted_at"),
    }
}

fn tool_permission_grant_from_row(row: SqliteRow) -> ToolPermissionGrantRecord {
    ToolPermissionGrantRecord {
        grant_id: row.get("grant_id"),
        root_run_id: row.get("root_run_id"),
        agent_run_id: row.get("agent_run_id"),
        tool_id: row.get("tool_id"),
        permission_scope: row.get("permission_scope"),
        permission_status: row.get("permission_status"),
        granted_by: row.get("granted_by"),
        granted_at: row.get("granted_at"),
        revoked_at: row.get("revoked_at"),
        expires_at: row.get("expires_at"),
        metadata_json: row.get("metadata_json"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{
        db::test_database,
        repositories::agent_runs::{AgentRunRepository, NewAgentRun},
    };

    fn timestamp() -> &'static str {
        "1700000000000"
    }

    async fn seeded_repo() -> (ToolSchedulerRepository, sqlx::SqlitePool) {
        let database = test_database().await;
        let pool = database.pool().clone();
        let agent_runs = AgentRunRepository::from_pool(&pool);
        agent_runs
            .create_run(&NewAgentRun {
                agent_run_id: "run-root",
                agent_id: None,
                agent_revision: None,
                loom_id: None,
                response_id: None,
                parent_response_id: None,
                correlation_id: "corr-tool",
                causation_id: None,
                root_run_id: None,
                parent_run_id: None,
                context_snapshot_id: None,
                provider_profile_id: None,
                model_id: None,
                started_at: timestamp(),
            })
            .await
            .unwrap();

        agent_runs
            .create_run(&NewAgentRun {
                agent_run_id: "run-child",
                agent_id: None,
                agent_revision: None,
                loom_id: None,
                response_id: None,
                parent_response_id: None,
                correlation_id: "corr-tool-child",
                causation_id: None,
                root_run_id: Some("run-root"),
                parent_run_id: Some("run-root"),
                context_snapshot_id: None,
                provider_profile_id: None,
                model_id: None,
                started_at: timestamp(),
            })
            .await
            .unwrap();

        let repo = ToolSchedulerRepository::from_pool(&pool);
        repo.create_tool_definition(&NewToolDefinition {
            tool_id: "tool-readonly",
            tool_name: "readonly.lookup",
            tool_kind: "loom_native",
            trust_level: "trusted",
            requires_permission: false,
            is_enabled: true,
        })
        .await
        .unwrap();
        (repo, pool)
    }

    fn lookup<'a>(agent_run_id: &'a str) -> ToolPermissionLookup<'a> {
        ToolPermissionLookup {
            root_run_id: "run-root",
            agent_run_id,
            tool_id: "tool-readonly",
            now: timestamp(),
        }
    }

    async fn create_test_invocation(repo: &ToolSchedulerRepository, invocation_id: &str) {
        repo.create_invocation(&NewToolInvocation {
            invocation_id,
            root_run_id: "run-root",
            agent_run_id: "run-root",
            parent_invocation_id: None,
            tool_id: "tool-readonly",
            permission_status: ToolInvocationPermissionStatus::Granted,
            requested_at: timestamp(),
            timeout_ms: None,
            sanitized_summary: None,
            diagnostics_json: None,
        })
        .await
        .unwrap();
    }

    async fn create_test_artifact(
        repo: &ToolSchedulerRepository,
        artifact_id: &str,
        invocation_id: &str,
        kind: ToolArtifactKind,
        visibility: ToolArtifactVisibility,
    ) -> ToolArtifactRecord {
        repo.create_artifact_ref(&NewToolArtifact {
            artifact_id,
            invocation_id,
            root_run_id: "run-root",
            agent_run_id: "run-root",
            artifact_kind: kind.as_str(),
            storage_ref: "artifact://safe-ref",
            visibility: visibility.as_str(),
            content_digest: Some("sha256:abc123"),
            size_bytes: Some(42),
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn tool_definition_can_be_created_read_and_listed() {
        let (repo, _) = seeded_repo().await;
        let record = repo
            .get_tool_definition("tool-readonly")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(record.tool_name, "readonly.lookup");
        assert_eq!(record.tool_kind, "loom_native");
        assert!(!record.requires_permission);
        assert!(record.is_enabled);

        let list = repo.list_tool_definitions().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].tool_id, "tool-readonly");
    }

    #[tokio::test]
    async fn invocation_can_be_created_for_existing_agent_run() {
        let (repo, _) = seeded_repo().await;
        let invocation = repo
            .create_invocation(&NewToolInvocation {
                invocation_id: "inv-1",
                root_run_id: "run-root",
                agent_run_id: "run-root",
                parent_invocation_id: None,
                tool_id: "tool-readonly",
                permission_status: ToolInvocationPermissionStatus::NotRequired,
                requested_at: timestamp(),
                timeout_ms: Some(5000),
                sanitized_summary: Some("safe summary"),
                diagnostics_json: Some(r#"{"code":"queued"}"#),
            })
            .await
            .unwrap();

        assert_eq!(invocation.status, "requested");
        assert_eq!(invocation.permission_status, "not_required");
        assert_eq!(invocation.timeout_ms, Some(5000));
        assert_eq!(
            invocation.sanitized_summary.as_deref(),
            Some("safe summary")
        );
    }

    #[tokio::test]
    async fn invalid_agent_run_fk_fails_for_invocation() {
        let (repo, _) = seeded_repo().await;
        let error = repo
            .create_invocation(&NewToolInvocation {
                invocation_id: "inv-invalid-run",
                root_run_id: "missing-run",
                agent_run_id: "missing-run",
                parent_invocation_id: None,
                tool_id: "tool-readonly",
                permission_status: ToolInvocationPermissionStatus::NotRequired,
                requested_at: timestamp(),
                timeout_ms: None,
                sanitized_summary: None,
                diagnostics_json: None,
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("agent run not found"));
    }

    #[tokio::test]
    async fn invocation_status_transitions_persist() {
        let (repo, _) = seeded_repo().await;
        repo.create_invocation(&NewToolInvocation {
            invocation_id: "inv-transition",
            root_run_id: "run-root",
            agent_run_id: "run-root",
            parent_invocation_id: None,
            tool_id: "tool-readonly",
            permission_status: ToolInvocationPermissionStatus::Granted,
            requested_at: timestamp(),
            timeout_ms: None,
            sanitized_summary: None,
            diagnostics_json: None,
        })
        .await
        .unwrap();

        assert!(repo
            .transition_invocation_status("inv-transition", ToolInvocationStatus::Queued)
            .await
            .unwrap());
        assert!(repo
            .transition_invocation_status("inv-transition", ToolInvocationStatus::Running)
            .await
            .unwrap());
        assert!(repo
            .transition_invocation_status("inv-transition", ToolInvocationStatus::Completed)
            .await
            .unwrap());
        assert!(!repo
            .transition_invocation_status("inv-transition", ToolInvocationStatus::Failed)
            .await
            .unwrap());

        let stored = repo
            .get_invocation("inv-transition")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.status, "completed");
        assert!(stored.queued_at.is_some());
        assert!(stored.started_at.is_some());
        assert!(stored.completed_at.is_some());
    }

    #[tokio::test]
    async fn artifact_ref_persists_without_content() {
        let (repo, pool) = seeded_repo().await;
        create_test_invocation(&repo, "inv-artifact").await;
        let artifact = create_test_artifact(
            &repo,
            "artifact-1",
            "inv-artifact",
            ToolArtifactKind::FileRef,
            ToolArtifactVisibility::Private,
        )
        .await;

        assert_eq!(artifact.storage_ref, "artifact://safe-ref");
        assert_eq!(artifact.visibility, "agent_internal");
        assert_eq!(artifact.content_digest.as_deref(), Some("sha256:abc123"));
        assert_eq!(artifact.size_bytes, Some(42));

        let columns = sqlx::query_scalar::<_, String>(
            "SELECT name FROM pragma_table_info('tool_artifacts') ORDER BY cid",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(!columns.iter().any(|column| column == "content"));
    }

    #[tokio::test]
    async fn artifact_ref_can_be_read_and_listed_by_invocation_agent_and_root() {
        let (repo, _) = seeded_repo().await;
        create_test_invocation(&repo, "inv-artifact-list").await;
        let artifact = create_test_artifact(
            &repo,
            "artifact-list-1",
            "inv-artifact-list",
            ToolArtifactKind::JsonSummary,
            ToolArtifactVisibility::UserVisible,
        )
        .await;

        let fetched = repo.get_artifact("artifact-list-1").await.unwrap().unwrap();
        assert_eq!(fetched, artifact);
        assert_eq!(fetched.artifact_kind, "json_summary");
        assert_eq!(fetched.visibility, "user_visible");

        let by_invocation = repo
            .list_artifacts_by_invocation("inv-artifact-list")
            .await
            .unwrap();
        let by_agent = repo.list_artifacts_by_agent_run("run-root").await.unwrap();
        let by_root = repo.list_artifacts_by_root_run("run-root").await.unwrap();
        assert_eq!(by_invocation.len(), 1);
        assert!(by_agent
            .iter()
            .any(|item| item.artifact_id == "artifact-list-1"));
        assert!(by_root
            .iter()
            .any(|item| item.artifact_id == "artifact-list-1"));
    }

    #[tokio::test]
    async fn artifact_visibility_semantics_map_to_locked_schema_values() {
        let (repo, _) = seeded_repo().await;
        create_test_invocation(&repo, "inv-visibility").await;
        for (artifact_id, visibility, stored_visibility) in [
            (
                "artifact-private",
                ToolArtifactVisibility::Private,
                "agent_internal",
            ),
            (
                "artifact-run",
                ToolArtifactVisibility::Run,
                "agent_internal",
            ),
            (
                "artifact-root-run",
                ToolArtifactVisibility::RootRun,
                "exportable",
            ),
            (
                "artifact-user-visible",
                ToolArtifactVisibility::UserVisible,
                "user_visible",
            ),
        ] {
            let artifact = create_test_artifact(
                &repo,
                artifact_id,
                "inv-visibility",
                ToolArtifactKind::TextSummary,
                visibility,
            )
            .await;
            assert_eq!(artifact.visibility, stored_visibility);
        }
    }

    #[tokio::test]
    async fn soft_delete_hides_artifact_from_default_get_and_lists() {
        let (repo, _) = seeded_repo().await;
        create_test_invocation(&repo, "inv-artifact-delete").await;
        create_test_artifact(
            &repo,
            "artifact-delete",
            "inv-artifact-delete",
            ToolArtifactKind::LogSummary,
            ToolArtifactVisibility::Run,
        )
        .await;

        assert!(repo
            .soft_delete_artifact_ref("artifact-delete")
            .await
            .unwrap());
        assert!(!repo
            .soft_delete_artifact_ref("artifact-delete")
            .await
            .unwrap());

        assert!(repo
            .get_artifact("artifact-delete")
            .await
            .unwrap()
            .is_none());
        assert!(repo
            .list_artifacts_by_invocation("inv-artifact-delete")
            .await
            .unwrap()
            .is_empty());
        assert!(repo
            .list_artifacts_by_agent_run("run-root")
            .await
            .unwrap()
            .is_empty());
        assert!(repo
            .list_artifacts_by_root_run("run-root")
            .await
            .unwrap()
            .is_empty());

        let deleted = repo
            .get_artifact_with_deleted("artifact-delete", true)
            .await
            .unwrap()
            .unwrap();
        assert!(deleted.deleted_at.is_some());
        assert_eq!(
            repo.list_artifacts_by_invocation_with_deleted("inv-artifact-delete", true)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn invalid_invocation_fk_fails_for_artifact() {
        let (repo, _) = seeded_repo().await;
        let error = repo
            .create_artifact_ref(&NewToolArtifact {
                artifact_id: "artifact-missing-invocation",
                invocation_id: "missing-invocation",
                root_run_id: "run-root",
                agent_run_id: "run-root",
                artifact_kind: ToolArtifactKind::FileRef.as_str(),
                storage_ref: "artifact://safe-ref",
                visibility: ToolArtifactVisibility::Private.as_str(),
                content_digest: None,
                size_bytes: None,
            })
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("tool invocation not found for artifact ref"));
    }

    #[tokio::test]
    async fn artifact_ref_rejects_forbidden_metadata_markers() {
        let (repo, _) = seeded_repo().await;
        create_test_invocation(&repo, "inv-artifact-forbidden").await;
        for (artifact_id, storage_ref, content_digest, expected) in [
            (
                "artifact-forbidden-storage",
                "artifact://stdout/raw",
                None,
                "stdout",
            ),
            (
                "artifact-forbidden-digest",
                "artifact://safe-ref",
                Some("provider_payload:abc"),
                "provider_payload",
            ),
        ] {
            let error = repo
                .create_artifact_ref(&NewToolArtifact {
                    artifact_id,
                    invocation_id: "inv-artifact-forbidden",
                    root_run_id: "run-root",
                    agent_run_id: "run-root",
                    artifact_kind: ToolArtifactKind::BinaryRef.as_str(),
                    storage_ref,
                    visibility: ToolArtifactVisibility::Private.as_str(),
                    content_digest,
                    size_bytes: None,
                })
                .await
                .unwrap_err();
            assert!(error.to_string().contains(expected));
        }
    }

    #[tokio::test]
    async fn unsupported_artifact_kind_and_visibility_are_rejected() {
        let (repo, _) = seeded_repo().await;
        create_test_invocation(&repo, "inv-artifact-unsupported").await;
        let bad_kind = repo
            .create_artifact_ref(&NewToolArtifact {
                artifact_id: "artifact-bad-kind",
                invocation_id: "inv-artifact-unsupported",
                root_run_id: "run-root",
                agent_run_id: "run-root",
                artifact_kind: "raw_output",
                storage_ref: "artifact://safe-ref",
                visibility: ToolArtifactVisibility::Private.as_str(),
                content_digest: None,
                size_bytes: None,
            })
            .await
            .unwrap_err();
        assert!(bad_kind
            .to_string()
            .contains("unsupported tool artifact kind"));

        let bad_visibility = repo
            .create_artifact_ref(&NewToolArtifact {
                artifact_id: "artifact-bad-visibility",
                invocation_id: "inv-artifact-unsupported",
                root_run_id: "run-root",
                agent_run_id: "run-root",
                artifact_kind: ToolArtifactKind::ImageRef.as_str(),
                storage_ref: "artifact://safe-ref",
                visibility: "world_readable",
                content_digest: None,
                size_bytes: None,
            })
            .await
            .unwrap_err();
        assert!(bad_visibility
            .to_string()
            .contains("unsupported tool artifact visibility"));
    }

    #[tokio::test]
    async fn permission_grant_persists_and_revokes() {
        let (repo, _) = seeded_repo().await;
        let grant = repo
            .create_permission_grant(&NewToolPermissionGrant {
                grant_id: "grant-1",
                root_run_id: "run-root",
                agent_run_id: Some("run-root"),
                tool_id: Some("tool-readonly"),
                permission_scope: "one_time",
                permission_status: ToolGrantStatus::Granted,
                granted_by: "user",
                granted_at: Some(timestamp()),
                expires_at: None,
                metadata_json: Some(r#"{"reason":"test"}"#),
            })
            .await
            .unwrap();

        assert_eq!(grant.permission_status, "granted");
        assert!(repo.revoke_permission_grant("grant-1").await.unwrap());
        assert!(!repo.revoke_permission_grant("grant-1").await.unwrap());

        let revoked = repo.get_permission_grant("grant-1").await.unwrap().unwrap();
        assert_eq!(revoked.permission_status, "revoked");
        assert!(revoked.revoked_at.is_some());
    }

    #[tokio::test]
    async fn permission_request_is_created_as_pending_and_does_not_authorize() {
        let (repo, _) = seeded_repo().await;
        let request = repo
            .create_permission_request(&NewToolPermissionGrant {
                grant_id: "grant-request",
                root_run_id: "run-root",
                agent_run_id: Some("run-root"),
                tool_id: Some("tool-readonly"),
                permission_scope: ToolPermissionScope::Run.as_str(),
                permission_status: ToolGrantStatus::Pending,
                granted_by: "runtime",
                granted_at: None,
                expires_at: None,
                metadata_json: Some(r#"{"requestCode":"needs_approval"}"#),
            })
            .await
            .unwrap();
        assert_eq!(request.permission_status, "pending");

        let decision = repo.evaluate_permission(&lookup("run-root")).await.unwrap();
        assert!(!decision.authorized);
        assert!(decision.permission_required);
        assert_eq!(decision.reason_code, "no_matching_active_grant");
        assert_eq!(decision.diagnostics.pending_grant_count, 1);
    }

    #[tokio::test]
    async fn granted_one_time_authorizes_with_consumption_deferred() {
        let (repo, _) = seeded_repo().await;
        repo.create_permission_grant(&NewToolPermissionGrant {
            grant_id: "grant-one-time",
            root_run_id: "run-root",
            agent_run_id: Some("run-root"),
            tool_id: Some("tool-readonly"),
            permission_scope: ToolPermissionScope::OneTime.as_str(),
            permission_status: ToolGrantStatus::Granted,
            granted_by: "user",
            granted_at: Some(timestamp()),
            expires_at: None,
            metadata_json: None,
        })
        .await
        .unwrap();

        let first = repo.evaluate_permission(&lookup("run-root")).await.unwrap();
        let second = repo.evaluate_permission(&lookup("run-root")).await.unwrap();
        assert!(first.authorized);
        assert!(second.authorized);
        assert_eq!(first.matching_scope.as_deref(), Some("one_time"));
        assert!(
            first.diagnostics.one_time_consumption_deferred,
            "schema has no consumed_at/consumed_by_invocation_id field yet"
        );
    }

    #[tokio::test]
    async fn granted_run_scope_authorizes_same_run_only() {
        let (repo, _) = seeded_repo().await;
        repo.create_permission_grant(&NewToolPermissionGrant {
            grant_id: "grant-run",
            root_run_id: "run-root",
            agent_run_id: Some("run-root"),
            tool_id: Some("tool-readonly"),
            permission_scope: ToolPermissionScope::Run.as_str(),
            permission_status: ToolGrantStatus::Granted,
            granted_by: "user",
            granted_at: Some(timestamp()),
            expires_at: None,
            metadata_json: None,
        })
        .await
        .unwrap();

        let parent_decision = repo.evaluate_permission(&lookup("run-root")).await.unwrap();
        let child_decision = repo
            .evaluate_permission(&lookup("run-child"))
            .await
            .unwrap();
        assert!(parent_decision.authorized);
        assert!(!child_decision.authorized);
        assert_eq!(child_decision.reason_code, "no_matching_active_grant");
    }

    #[tokio::test]
    async fn root_run_scope_authorizes_child_when_explicitly_delegated() {
        let (repo, _) = seeded_repo().await;
        repo.create_permission_grant(&NewToolPermissionGrant {
            grant_id: "grant-root-run",
            root_run_id: "run-root",
            agent_run_id: None,
            tool_id: Some("tool-readonly"),
            permission_scope: ToolPermissionScope::RootRun.as_str(),
            permission_status: ToolGrantStatus::Granted,
            granted_by: "parent",
            granted_at: Some(timestamp()),
            expires_at: None,
            metadata_json: Some(r#"{"delegated":true}"#),
        })
        .await
        .unwrap();

        let child_decision = repo
            .evaluate_permission(&lookup("run-child"))
            .await
            .unwrap();
        assert!(child_decision.authorized);
        assert_eq!(
            child_decision.matching_grant_id.as_deref(),
            Some("grant-root-run")
        );
        assert_eq!(child_decision.matching_scope.as_deref(), Some("root_run"));
    }

    #[tokio::test]
    async fn session_and_workspace_scopes_authorize_within_schema_root_boundary() {
        let (repo, _) = seeded_repo().await;
        for (grant_id, scope) in [
            ("grant-session", ToolPermissionScope::Session),
            ("grant-workspace", ToolPermissionScope::Workspace),
        ] {
            repo.create_permission_grant(&NewToolPermissionGrant {
                grant_id,
                root_run_id: "run-root",
                agent_run_id: None,
                tool_id: Some("tool-readonly"),
                permission_scope: scope.as_str(),
                permission_status: ToolGrantStatus::Granted,
                granted_by: "user",
                granted_at: Some(timestamp()),
                expires_at: None,
                metadata_json: None,
            })
            .await
            .unwrap();
        }

        let child_decision = repo
            .evaluate_permission(&lookup("run-child"))
            .await
            .unwrap();
        assert!(child_decision.authorized);
        assert_eq!(child_decision.diagnostics.matching_active_grant_count, 2);
    }

    #[tokio::test]
    async fn denied_revoked_and_expired_grants_do_not_authorize() {
        let (repo, _) = seeded_repo().await;
        for (grant_id, status, revoked, expires_at) in [
            ("grant-denied", ToolGrantStatus::Denied, false, None),
            ("grant-revoked", ToolGrantStatus::Revoked, true, None),
            (
                "grant-expired-status",
                ToolGrantStatus::Expired,
                false,
                Some("1800000000000"),
            ),
            (
                "grant-expired-time",
                ToolGrantStatus::Granted,
                false,
                Some("1600000000000"),
            ),
        ] {
            repo.create_permission_grant(&NewToolPermissionGrant {
                grant_id,
                root_run_id: "run-root",
                agent_run_id: Some("run-root"),
                tool_id: Some("tool-readonly"),
                permission_scope: ToolPermissionScope::Run.as_str(),
                permission_status: status,
                granted_by: "user",
                granted_at: Some(timestamp()),
                expires_at,
                metadata_json: None,
            })
            .await
            .unwrap();
            if revoked {
                repo.revoke_permission_grant(grant_id).await.unwrap();
            }
        }

        let decision = repo.evaluate_permission(&lookup("run-root")).await.unwrap();
        assert!(!decision.authorized);
        assert!(decision.permission_required);
        assert_eq!(decision.diagnostics.denied_grant_count, 1);
        assert_eq!(decision.diagnostics.revoked_grant_count, 1);
        assert_eq!(decision.diagnostics.expired_grant_count, 2);
    }

    #[tokio::test]
    async fn unknown_tool_or_run_does_not_authorize() {
        let (repo, _) = seeded_repo().await;
        let unknown_tool = repo
            .evaluate_permission(&ToolPermissionLookup {
                root_run_id: "run-root",
                agent_run_id: "run-root",
                tool_id: "unknown-tool",
                now: timestamp(),
            })
            .await
            .unwrap();
        assert!(!unknown_tool.authorized);
        assert_eq!(unknown_tool.reason_code, "unknown_tool");

        let unknown_run = repo
            .evaluate_permission(&ToolPermissionLookup {
                root_run_id: "run-root",
                agent_run_id: "unknown-run",
                tool_id: "tool-readonly",
                now: timestamp(),
            })
            .await
            .unwrap();
        assert!(!unknown_run.authorized);
        assert_eq!(unknown_run.reason_code, "unknown_run");
    }

    #[tokio::test]
    async fn permission_metadata_rejects_forbidden_markers() {
        let (repo, _) = seeded_repo().await;
        let error = repo
            .create_permission_grant(&NewToolPermissionGrant {
                grant_id: "grant-forbidden",
                root_run_id: "run-root",
                agent_run_id: Some("run-root"),
                tool_id: Some("tool-readonly"),
                permission_scope: ToolPermissionScope::Run.as_str(),
                permission_status: ToolGrantStatus::Granted,
                granted_by: "user",
                granted_at: Some(timestamp()),
                expires_at: None,
                metadata_json: Some(r#"{"prompt":"not allowed"}"#),
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("\"prompt\""));
    }

    #[tokio::test]
    async fn unsupported_permission_scope_is_rejected() {
        let (repo, _) = seeded_repo().await;
        let error = repo
            .create_permission_grant(&NewToolPermissionGrant {
                grant_id: "grant-bad-scope",
                root_run_id: "run-root",
                agent_run_id: Some("run-root"),
                tool_id: Some("tool-readonly"),
                permission_scope: "global_forever",
                permission_status: ToolGrantStatus::Granted,
                granted_by: "user",
                granted_at: Some(timestamp()),
                expires_at: None,
                metadata_json: None,
            })
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("unsupported tool permission scope"));
    }

    #[tokio::test]
    async fn diagnostics_json_rejects_forbidden_markers() {
        let (repo, _) = seeded_repo().await;
        let error = repo
            .create_invocation(&NewToolInvocation {
                invocation_id: "inv-forbidden",
                root_run_id: "run-root",
                agent_run_id: "run-root",
                parent_invocation_id: None,
                tool_id: "tool-readonly",
                permission_status: ToolInvocationPermissionStatus::Pending,
                requested_at: timestamp(),
                timeout_ms: None,
                sanitized_summary: None,
                diagnostics_json: Some(r#"{"raw_thinking":"not allowed"}"#),
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn tool_scheduler_tables_do_not_store_raw_payload_columns() {
        let (_, pool) = seeded_repo().await;
        for table in [
            "tool_definitions",
            "tool_invocations",
            "tool_artifacts",
            "tool_permission_grants",
        ] {
            let columns = sqlx::query_scalar::<_, String>(&format!(
                "SELECT name FROM pragma_table_info('{table}') ORDER BY cid"
            ))
            .fetch_all(&pool)
            .await
            .unwrap();
            for forbidden in [
                "raw_payload",
                "payload",
                "raw_stdout",
                "stdout",
                "raw_stderr",
                "stderr",
                "content",
                "file_contents",
                "prompt",
                "provider_payload",
                "provider_request",
                "provider_response",
                "raw_thinking",
                "thinking_text",
                "chain_of_thought",
                "hidden_reasoning",
            ] {
                assert!(
                    !columns.iter().any(|column| column == forbidden),
                    "{table} must not contain forbidden column {forbidden}"
                );
            }
        }
    }
}
