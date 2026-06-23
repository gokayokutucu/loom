#![allow(dead_code)]

//! Tool Scheduler runtime seam.
//!
//! This module coordinates tool invocation metadata, permission evaluation,
//! lifecycle transitions, and the built-in no-I/O noop executor used for tests.
//! It intentionally does not execute shell, filesystem, network, MCP, provider,
//! or arbitrary tool logic.

use crate::{
    error::ServiceError,
    storage::repositories::tool_scheduler::{
        validate_safe_persisted_text, NewToolArtifact, NewToolInvocation, NewToolPermissionGrant,
        ToolArtifactKind, ToolArtifactRecord, ToolArtifactVisibility, ToolGrantStatus,
        ToolInvocationPermissionStatus, ToolInvocationRecord, ToolInvocationStatus,
        ToolPermissionLookup, ToolSchedulerRepository,
    },
};
use serde::{Deserialize, Serialize};

const NOOP_TOOL_NAME: &str = "runtime.noop";
const NOOP_SUMMARY: &str = "Noop tool completed without external execution.";

fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}

#[derive(Debug, Clone)]
pub struct ToolInvocationRequest {
    pub invocation_id: String,
    pub root_run_id: String,
    pub agent_run_id: String,
    pub parent_invocation_id: Option<String>,
    pub tool_id: String,
    pub requested_at: Option<String>,
    pub timeout_ms: Option<i64>,
    pub diagnostics_json: Option<String>,
    pub auto_complete_noop: bool,
    pub create_noop_artifact: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolRuntimeOutcomeKind {
    PendingPermission,
    PermissionDenied,
    Queued,
    Running,
    Completed,
    Cancelled,
    TimedOut,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRuntimeResult {
    pub outcome: ToolRuntimeOutcomeKind,
    pub invocation: ToolInvocationRecord,
    pub permission_grant_id: Option<String>,
    pub artifact: Option<ToolArtifactRecord>,
    pub safe_summary: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ToolSchedulerRuntime {
    repository: ToolSchedulerRepository,
}

impl ToolSchedulerRuntime {
    pub fn new(repository: ToolSchedulerRepository) -> Self {
        Self { repository }
    }

    pub async fn submit_invocation(
        &self,
        request: ToolInvocationRequest,
    ) -> Result<ToolRuntimeResult, ServiceError> {
        self.validate_request(&request)?;
        let tool = self
            .repository
            .get_tool_definition(&request.tool_id)
            .await?
            .ok_or_else(|| ServiceError::storage("tool definition not found"))?;
        let requested_at = request.requested_at.as_deref().unwrap_or("0");

        let permission = self
            .repository
            .evaluate_permission(&ToolPermissionLookup {
                root_run_id: &request.root_run_id,
                agent_run_id: &request.agent_run_id,
                tool_id: &request.tool_id,
                now: requested_at,
            })
            .await?;

        let permission_status = if !tool.requires_permission {
            ToolInvocationPermissionStatus::NotRequired
        } else if permission.authorized {
            ToolInvocationPermissionStatus::Granted
        } else if permission.diagnostics.denied_grant_count > 0 {
            ToolInvocationPermissionStatus::Denied
        } else {
            ToolInvocationPermissionStatus::Pending
        };

        let invocation = self
            .repository
            .create_invocation(&NewToolInvocation {
                invocation_id: &request.invocation_id,
                root_run_id: &request.root_run_id,
                agent_run_id: &request.agent_run_id,
                parent_invocation_id: request.parent_invocation_id.as_deref(),
                tool_id: &request.tool_id,
                permission_status,
                requested_at,
                timeout_ms: request.timeout_ms,
                sanitized_summary: None,
                diagnostics_json: request.diagnostics_json.as_deref(),
            })
            .await?;

        if tool.requires_permission && permission_status == ToolInvocationPermissionStatus::Denied {
            self.repository
                .transition_invocation_status(
                    &request.invocation_id,
                    ToolInvocationStatus::PermissionDenied,
                )
                .await?;
            let invocation = self
                .repository
                .get_invocation(&request.invocation_id)
                .await?
                .ok_or_else(|| ServiceError::storage("tool invocation not found"))?;
            return Ok(ToolRuntimeResult {
                outcome: ToolRuntimeOutcomeKind::PermissionDenied,
                invocation,
                permission_grant_id: None,
                artifact: None,
                safe_summary: None,
            });
        }

        if tool.requires_permission && !permission.authorized {
            self.repository
                .transition_invocation_status(
                    &request.invocation_id,
                    ToolInvocationStatus::PermissionRequired,
                )
                .await?;
            let grant_id = format!("{}:permission-request", request.invocation_id);
            let grant = self
                .repository
                .create_permission_request(&NewToolPermissionGrant {
                    grant_id: &grant_id,
                    root_run_id: &request.root_run_id,
                    agent_run_id: Some(&request.agent_run_id),
                    tool_id: Some(&request.tool_id),
                    permission_scope: "one_time",
                    permission_status: ToolGrantStatus::Pending,
                    granted_by: "tool_scheduler_runtime",
                    granted_at: None,
                    expires_at: None,
                    metadata_json: Some(r#"{"reasonCode":"permission_required"}"#),
                })
                .await?;
            let invocation = self
                .repository
                .get_invocation(&request.invocation_id)
                .await?
                .ok_or_else(|| ServiceError::storage("tool invocation not found"))?;
            return Ok(ToolRuntimeResult {
                outcome: ToolRuntimeOutcomeKind::PendingPermission,
                invocation,
                permission_grant_id: Some(grant.grant_id),
                artifact: None,
                safe_summary: None,
            });
        }

        self.repository
            .transition_invocation_status(&request.invocation_id, ToolInvocationStatus::Queued)
            .await?;

        if !request.auto_complete_noop {
            let invocation = self
                .repository
                .get_invocation(&request.invocation_id)
                .await?
                .unwrap_or(invocation);
            return Ok(ToolRuntimeResult {
                outcome: ToolRuntimeOutcomeKind::Queued,
                invocation,
                permission_grant_id: permission.matching_grant_id,
                artifact: None,
                safe_summary: None,
            });
        }

        self.start_invocation(&request.invocation_id).await?;
        if tool.tool_name != NOOP_TOOL_NAME {
            return Err(ServiceError::storage(
                "only built-in noop tool execution is implemented",
            ));
        }
        self.complete_noop(
            &request.invocation_id,
            &request.root_run_id,
            &request.agent_run_id,
            request.create_noop_artifact,
        )
        .await
    }

    pub async fn start_invocation(&self, invocation_id: &str) -> Result<bool, ServiceError> {
        self.repository
            .transition_invocation_status(invocation_id, ToolInvocationStatus::Running)
            .await
    }

    pub async fn cancel_invocation(
        &self,
        invocation_id: &str,
    ) -> Result<ToolRuntimeResult, ServiceError> {
        self.repository
            .transition_invocation_status(invocation_id, ToolInvocationStatus::Cancelled)
            .await?;
        let invocation = self
            .repository
            .get_invocation(invocation_id)
            .await?
            .ok_or_else(|| ServiceError::storage("tool invocation not found"))?;
        Ok(ToolRuntimeResult {
            outcome: ToolRuntimeOutcomeKind::Cancelled,
            invocation,
            permission_grant_id: None,
            artifact: None,
            safe_summary: None,
        })
    }

    pub async fn timeout_invocation(
        &self,
        invocation_id: &str,
    ) -> Result<ToolRuntimeResult, ServiceError> {
        self.repository
            .transition_invocation_status(invocation_id, ToolInvocationStatus::TimedOut)
            .await?;
        let invocation = self
            .repository
            .get_invocation(invocation_id)
            .await?
            .ok_or_else(|| ServiceError::storage("tool invocation not found"))?;
        Ok(ToolRuntimeResult {
            outcome: ToolRuntimeOutcomeKind::TimedOut,
            invocation,
            permission_grant_id: None,
            artifact: None,
            safe_summary: None,
        })
    }

    async fn complete_noop(
        &self,
        invocation_id: &str,
        root_run_id: &str,
        agent_run_id: &str,
        create_artifact: bool,
    ) -> Result<ToolRuntimeResult, ServiceError> {
        self.repository
            .complete_invocation_with_summary(invocation_id, NOOP_SUMMARY)
            .await?;
        let artifact = if create_artifact {
            let artifact_id = format!("{invocation_id}:noop-summary");
            let storage_ref = format!("loom://tool-artifacts/{invocation_id}/noop-summary");
            Some(
                self.repository
                    .create_artifact_ref(&NewToolArtifact {
                        artifact_id: &artifact_id,
                        invocation_id,
                        root_run_id,
                        agent_run_id,
                        artifact_kind: ToolArtifactKind::TextSummary.as_str(),
                        storage_ref: &storage_ref,
                        visibility: ToolArtifactVisibility::Run.as_str(),
                        content_digest: None,
                        size_bytes: Some(NOOP_SUMMARY.len() as i64),
                    })
                    .await?,
            )
        } else {
            None
        };
        let invocation = self
            .repository
            .get_invocation(invocation_id)
            .await?
            .ok_or_else(|| ServiceError::storage("tool invocation not found"))?;
        Ok(ToolRuntimeResult {
            outcome: ToolRuntimeOutcomeKind::Completed,
            invocation,
            permission_grant_id: None,
            artifact,
            safe_summary: Some(NOOP_SUMMARY.to_string()),
        })
    }

    fn validate_request(&self, request: &ToolInvocationRequest) -> Result<(), ServiceError> {
        validate_safe_persisted_text("tool invocation root_run_id", &request.root_run_id)?;
        validate_safe_persisted_text("tool invocation agent_run_id", &request.agent_run_id)?;
        validate_safe_persisted_text("tool invocation tool_id", &request.tool_id)?;
        if let Some(parent_invocation_id) = request.parent_invocation_id.as_deref() {
            validate_safe_persisted_text(
                "tool invocation parent_invocation_id",
                parent_invocation_id,
            )?;
        }
        if let Some(diagnostics) = request.diagnostics_json.as_deref() {
            validate_safe_persisted_text("tool invocation diagnostics_json", diagnostics)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{
        db::test_database,
        repositories::{
            agent_runs::{AgentRunRepository, NewAgentRun},
            tool_scheduler::{NewToolDefinition, ToolPermissionScope, ToolSchedulerRepository},
        },
    };

    fn timestamp() -> &'static str {
        "1700000000000"
    }

    async fn seeded_runtime(
        requires_permission: bool,
    ) -> (ToolSchedulerRuntime, ToolSchedulerRepository) {
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
                correlation_id: "corr-tool-runtime",
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

        let repo = ToolSchedulerRepository::from_pool(&pool);
        repo.create_tool_definition(&NewToolDefinition {
            tool_id: "tool-noop",
            tool_name: NOOP_TOOL_NAME,
            tool_kind: "loom_native",
            trust_level: "trusted",
            requires_permission,
            is_enabled: true,
        })
        .await
        .unwrap();
        let runtime = ToolSchedulerRuntime::new(repo.clone());
        (runtime, repo)
    }

    fn request(invocation_id: &str) -> ToolInvocationRequest {
        ToolInvocationRequest {
            invocation_id: invocation_id.to_string(),
            root_run_id: "run-root".to_string(),
            agent_run_id: "run-root".to_string(),
            parent_invocation_id: None,
            tool_id: "tool-noop".to_string(),
            requested_at: Some(timestamp().to_string()),
            timeout_ms: Some(1000),
            diagnostics_json: Some(r#"{"runtime":"noop"}"#.to_string()),
            auto_complete_noop: true,
            create_noop_artifact: true,
        }
    }

    async fn grant(repo: &ToolSchedulerRepository, status: ToolGrantStatus) {
        repo.create_permission_grant(&NewToolPermissionGrant {
            grant_id: "grant-noop",
            root_run_id: "run-root",
            agent_run_id: Some("run-root"),
            tool_id: Some("tool-noop"),
            permission_scope: ToolPermissionScope::Run.as_str(),
            permission_status: status,
            granted_by: "user",
            granted_at: Some(timestamp()),
            expires_at: None,
            metadata_json: None,
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn permission_missing_returns_pending_without_execution() {
        let (runtime, repo) = seeded_runtime(true).await;
        let result = runtime
            .submit_invocation(request("inv-permission"))
            .await
            .unwrap();
        assert_eq!(result.outcome, ToolRuntimeOutcomeKind::PendingPermission);
        assert_eq!(result.invocation.status, "permission_required");
        assert_eq!(result.invocation.permission_status, "pending");
        assert!(result.permission_grant_id.is_some());
        assert!(result.artifact.is_none());

        let stored = repo
            .get_invocation("inv-permission")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.status, "permission_required");
        assert!(stored.queued_at.is_none());
        assert!(stored.started_at.is_none());
        assert!(stored.completed_at.is_none());
    }

    #[tokio::test]
    async fn granted_permission_runs_noop_to_completed_with_artifact_ref() {
        let (runtime, repo) = seeded_runtime(true).await;
        grant(&repo, ToolGrantStatus::Granted).await;
        let result = runtime
            .submit_invocation(request("inv-complete"))
            .await
            .unwrap();
        assert_eq!(result.outcome, ToolRuntimeOutcomeKind::Completed);
        assert_eq!(result.invocation.status, "completed");
        assert_eq!(result.invocation.permission_status, "granted");
        assert_eq!(result.safe_summary.as_deref(), Some(NOOP_SUMMARY));
        assert_eq!(
            result.invocation.sanitized_summary.as_deref(),
            Some(NOOP_SUMMARY)
        );
        assert!(result.invocation.queued_at.is_some());
        assert!(result.invocation.started_at.is_some());
        assert!(result.invocation.completed_at.is_some());

        let artifact = result.artifact.unwrap();
        assert_eq!(artifact.artifact_kind, "text_summary");
        assert_eq!(
            artifact.storage_ref,
            "loom://tool-artifacts/inv-complete/noop-summary"
        );
        assert_eq!(
            repo.list_artifacts_by_invocation("inv-complete")
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn denied_permission_does_not_execute() {
        let (runtime, repo) = seeded_runtime(true).await;
        grant(&repo, ToolGrantStatus::Denied).await;
        let result = runtime
            .submit_invocation(request("inv-denied"))
            .await
            .unwrap();
        assert_eq!(result.outcome, ToolRuntimeOutcomeKind::PermissionDenied);
        assert_eq!(result.invocation.status, "permission_denied");
        assert_eq!(result.invocation.permission_status, "denied");
        assert!(result.invocation.started_at.is_none());
        assert!(result.artifact.is_none());
    }

    #[tokio::test]
    async fn queued_cancellation_works() {
        let (runtime, repo) = seeded_runtime(false).await;
        let mut queued = request("inv-cancel-queued");
        queued.auto_complete_noop = false;
        queued.create_noop_artifact = false;
        let result = runtime.submit_invocation(queued).await.unwrap();
        assert_eq!(result.outcome, ToolRuntimeOutcomeKind::Queued);
        assert_eq!(result.invocation.status, "queued");

        let cancelled = runtime
            .cancel_invocation("inv-cancel-queued")
            .await
            .unwrap();
        assert_eq!(cancelled.outcome, ToolRuntimeOutcomeKind::Cancelled);
        assert_eq!(cancelled.invocation.status, "cancelled");
        assert!(cancelled.invocation.cancelled_at.is_some());
        assert!(repo
            .list_artifacts_by_invocation("inv-cancel-queued")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn running_timeout_works() {
        let (runtime, _) = seeded_runtime(false).await;
        let mut queued = request("inv-timeout");
        queued.auto_complete_noop = false;
        queued.create_noop_artifact = false;
        runtime.submit_invocation(queued).await.unwrap();
        assert!(runtime.start_invocation("inv-timeout").await.unwrap());

        let timed_out = runtime.timeout_invocation("inv-timeout").await.unwrap();
        assert_eq!(timed_out.outcome, ToolRuntimeOutcomeKind::TimedOut);
        assert_eq!(timed_out.invocation.status, "timed_out");
        assert!(timed_out.invocation.failed_at.is_some());
    }

    #[tokio::test]
    async fn forbidden_request_metadata_is_rejected_before_persistence() {
        let (runtime, repo) = seeded_runtime(false).await;
        let mut bad = request("inv-forbidden");
        bad.diagnostics_json = Some(r#"{"raw_output":"not allowed"}"#.to_string());
        let error = runtime.submit_invocation(bad).await.unwrap_err();
        assert!(error.to_string().contains("raw_output"));
        assert!(repo
            .get_invocation("inv-forbidden")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn raw_output_is_never_stored_for_noop() {
        let (runtime, repo) = seeded_runtime(false).await;
        let result = runtime
            .submit_invocation(request("inv-privacy"))
            .await
            .unwrap();
        assert_eq!(result.outcome, ToolRuntimeOutcomeKind::Completed);
        let stored = repo.get_invocation("inv-privacy").await.unwrap().unwrap();
        let serialized = serde_json::to_string(&stored).unwrap();
        assert!(!serialized.contains("raw_output"));
        assert!(!serialized.contains("stdout"));
        assert!(!serialized.contains("stderr"));
        assert!(!serialized.contains("prompt"));
        assert!(!serialized.contains("provider_payload"));
        assert!(!serialized.contains("raw_thinking"));
    }
}
