use crate::{
    context::types::{
        ArtifactStatus, AttachedReferenceInput, ContextSource, ContextStrategy, ResponseMode,
    },
    error::ServiceError,
    storage::{
        db::Database,
        repositories::{
            context_artifacts::{
                ContextArtifactsRepository, ContextBuildJobRecord, NewContextArtifactEvent,
                NewContextBuildJob, UpsertResponseCapsule,
            },
            responses::ResponseRepository,
        },
    },
};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextReadinessInput {
    pub loom_id: String,
    pub current_head_response_id: Option<String>,
    pub attached_references: Vec<AttachedReferenceInput>,
    pub is_weft: bool,
    pub origin_loom_id: Option<String>,
    pub origin_response_id: Option<String>,
    pub context_strategy: ContextStrategy,
    pub response_mode: ResponseMode,
    pub resolved_num_ctx: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequiredContextArtifactType {
    ResponseCapsule,
    LoomCheckpoint,
    WeftOriginContext,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequiredContextArtifact {
    pub artifact_type: RequiredContextArtifactType,
    pub artifact_id: Option<String>,
    pub response_id: Option<String>,
    pub loom_id: Option<String>,
    pub required: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextReadinessStatus {
    Ready,
    ReadyWithFallbacks,
    Degraded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextBuildJob {
    pub job_id: String,
    pub job_type: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub status: String,
    pub priority: i64,
    pub error: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextReadinessResult {
    pub status: ContextReadinessStatus,
    pub required_artifacts: Vec<RequiredContextArtifact>,
    pub ready_artifacts: Vec<RequiredContextArtifact>,
    pub fallback_artifacts: Vec<RequiredContextArtifact>,
    pub jobs_created: Vec<ContextBuildJob>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ContextReadinessGate {
    context_repository: ContextArtifactsRepository,
    response_repository: ResponseRepository,
}

impl ContextReadinessGate {
    pub fn new(database: &Database) -> Self {
        Self {
            context_repository: ContextArtifactsRepository::new(database),
            response_repository: ResponseRepository::new(database),
        }
    }

    pub async fn prepare(
        &self,
        input: ContextReadinessInput,
    ) -> Result<ContextReadinessResult, ServiceError> {
        let mut result = ContextReadinessResult {
            status: ContextReadinessStatus::Ready,
            required_artifacts: required_artifacts(&input),
            ready_artifacts: Vec::new(),
            fallback_artifacts: Vec::new(),
            jobs_created: Vec::new(),
            warnings: Vec::new(),
        };

        for attached in &input.attached_references {
            self.prepare_response_capsule(&input, attached, &mut result)
                .await?;
        }

        if input.context_strategy == ContextStrategy::CheckpointAndRecent {
            self.prepare_checkpoint(&input, &mut result).await?;
        }

        if input.is_weft {
            self.prepare_weft_origin(&input, &mut result).await?;
        }

        result.status = classify_status(&result);
        Ok(result)
    }

    async fn prepare_response_capsule(
        &self,
        input: &ContextReadinessInput,
        attached: &AttachedReferenceInput,
        result: &mut ContextReadinessResult,
    ) -> Result<(), ServiceError> {
        let Some(response_id) = attached.reference.target_id.as_deref() else {
            result.warnings.push("reference_uri_only".to_string());
            return Ok(());
        };

        if let Some(capsule) = self
            .context_repository
            .get_response_capsule(response_id)
            .await?
        {
            match capsule.status.as_str() {
                "ready" => {
                    result.ready_artifacts.push(required_response_capsule(
                        input,
                        response_id,
                        Some(capsule.capsule_id),
                        true,
                    ));
                    return Ok(());
                }
                "pending" => {
                    result.warnings.push("pending_response_capsule".to_string());
                    self.ensure_job(
                        "response_capsule",
                        Some(&input.loom_id),
                        Some(response_id),
                        100,
                        &mut result.jobs_created,
                    )
                    .await?;
                    return Ok(());
                }
                "failed" => {
                    result.warnings.push("artifact_failed_status".to_string());
                }
                "stale" => {
                    result.warnings.push("artifact_stale".to_string());
                    result.ready_artifacts.push(required_response_capsule(
                        input,
                        response_id,
                        Some(capsule.capsule_id),
                        false,
                    ));
                    return Ok(());
                }
                _ => result.warnings.push("artifact_failed_status".to_string()),
            }
        }

        if self
            .create_response_fallback(input, response_id, result)
            .await?
        {
            self.ensure_job(
                "response_capsule",
                Some(&input.loom_id),
                Some(response_id),
                100,
                &mut result.jobs_created,
            )
            .await?;
            return Ok(());
        }

        result.warnings.push("missing_response_capsule".to_string());
        self.ensure_job(
            "response_capsule",
            Some(&input.loom_id),
            Some(response_id),
            100,
            &mut result.jobs_created,
        )
        .await?;
        Ok(())
    }

    async fn create_response_fallback(
        &self,
        input: &ContextReadinessInput,
        response_id: &str,
        result: &mut ContextReadinessResult,
    ) -> Result<bool, ServiceError> {
        let Some(response) = self.response_repository.get_response(response_id).await? else {
            return Ok(false);
        };

        let summary = heuristic_summary(&response.content);
        let capsule_id = format!("fallback-capsule-{response_id}");
        let timestamp = timestamp();
        self.context_repository
            .upsert_response_capsule(&UpsertResponseCapsule {
                capsule_id: capsule_id.clone(),
                response_id: response_id.to_string(),
                loom_id: response.loom_id.clone(),
                response_code: response.code.clone(),
                title: response.title.clone().or(response.code.clone()),
                summary: Some(summary),
                key_points_json: Some("[]".to_string()),
                keywords_json: Some("[]".to_string()),
                entities_json: Some("[]".to_string()),
                code_blocks_json: Some("[]".to_string()),
                canonical_uri: response.canonical_uri.clone(),
                source_hash: None,
                generator: Some("heuristic_fallback".to_string()),
                status: "ready".to_string(),
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
            })
            .await?;
        self.insert_event(
            "response_capsule",
            &capsule_id,
            "artifact.fallback_created",
            Some(format!("{{\"responseId\":\"{response_id}\"}}")),
        )
        .await?;

        result
            .warnings
            .push("fallback_response_capsule_created".to_string());
        result.fallback_artifacts.push(required_response_capsule(
            input,
            response_id,
            Some(capsule_id),
            true,
        ));
        Ok(true)
    }

    async fn prepare_checkpoint(
        &self,
        input: &ContextReadinessInput,
        result: &mut ContextReadinessResult,
    ) -> Result<(), ServiceError> {
        match self
            .context_repository
            .get_latest_checkpoint_for_loom(&input.loom_id)
            .await?
        {
            Some(checkpoint) if checkpoint.status == "ready" => {
                result.ready_artifacts.push(RequiredContextArtifact {
                    artifact_type: RequiredContextArtifactType::LoomCheckpoint,
                    artifact_id: Some(checkpoint.checkpoint_id),
                    response_id: checkpoint.up_to_response_id,
                    loom_id: Some(input.loom_id.clone()),
                    required: false,
                    reason: "Checkpoint strategy can use latest Loom summary.".to_string(),
                });
            }
            Some(checkpoint) if checkpoint.status == "pending" => {
                result.warnings.push("pending_checkpoint".to_string());
                self.ensure_job(
                    "loom_checkpoint",
                    Some(&input.loom_id),
                    None,
                    60,
                    &mut result.jobs_created,
                )
                .await?;
            }
            Some(_) => {
                result.warnings.push("artifact_failed_status".to_string());
                self.ensure_job(
                    "loom_checkpoint",
                    Some(&input.loom_id),
                    None,
                    60,
                    &mut result.jobs_created,
                )
                .await?;
            }
            None => {
                result.warnings.push("missing_checkpoint".to_string());
                self.ensure_job(
                    "loom_checkpoint",
                    Some(&input.loom_id),
                    None,
                    60,
                    &mut result.jobs_created,
                )
                .await?;
            }
        }
        Ok(())
    }

    async fn prepare_weft_origin(
        &self,
        input: &ContextReadinessInput,
        result: &mut ContextReadinessResult,
    ) -> Result<(), ServiceError> {
        match self
            .context_repository
            .get_weft_origin_context(&input.loom_id)
            .await?
        {
            Some(origin) if origin.status == "ready" || origin.status == "stale" => {
                if origin.status == "stale" {
                    result.warnings.push("artifact_stale".to_string());
                }
                result.ready_artifacts.push(RequiredContextArtifact {
                    artifact_type: RequiredContextArtifactType::WeftOriginContext,
                    artifact_id: Some(origin.context_id),
                    response_id: Some(origin.origin_response_id),
                    loom_id: Some(input.loom_id.clone()),
                    required: true,
                    reason: "Weft context needs immediate origin only.".to_string(),
                });
            }
            Some(_) => {
                result
                    .warnings
                    .push("missing_weft_origin_context".to_string());
                self.ensure_job(
                    "weft_origin_context",
                    Some(&input.loom_id),
                    input.origin_response_id.as_deref(),
                    90,
                    &mut result.jobs_created,
                )
                .await?;
            }
            None => {
                result
                    .warnings
                    .push("missing_weft_origin_context".to_string());
                self.ensure_job(
                    "weft_origin_context",
                    Some(&input.loom_id),
                    input.origin_response_id.as_deref(),
                    90,
                    &mut result.jobs_created,
                )
                .await?;
            }
        }
        Ok(())
    }

    async fn ensure_job(
        &self,
        job_type: &str,
        loom_id: Option<&str>,
        response_id: Option<&str>,
        priority: i64,
        jobs_created: &mut Vec<ContextBuildJob>,
    ) -> Result<(), ServiceError> {
        if let Some(existing) = self
            .context_repository
            .find_pending_job(job_type, loom_id, response_id)
            .await?
        {
            jobs_created.push(existing.into());
            return Ok(());
        }

        let timestamp = timestamp();
        let job_id = format!(
            "job-{job_type}-{}-{}-{timestamp}",
            loom_id.unwrap_or("none"),
            response_id.unwrap_or("none")
        );
        let job = NewContextBuildJob {
            job_id: job_id.clone(),
            job_type: job_type.to_string(),
            loom_id: loom_id.map(ToString::to_string),
            response_id: response_id.map(ToString::to_string),
            status: "pending".to_string(),
            priority,
            error: None,
            created_at: timestamp,
        };
        self.context_repository.insert_job(&job).await?;
        self.insert_event(
            job_type,
            response_id.or(loom_id).unwrap_or(&job_id),
            "artifact.job_created",
            Some(format!("{{\"jobId\":\"{}\"}}", job.job_id)),
        )
        .await?;
        jobs_created.push(ContextBuildJob {
            job_id: job.job_id,
            job_type: job.job_type,
            loom_id: job.loom_id,
            response_id: job.response_id,
            status: job.status,
            priority: job.priority,
            error: job.error,
            created_at: job.created_at,
            started_at: None,
            finished_at: None,
        });
        Ok(())
    }

    async fn insert_event(
        &self,
        artifact_type: &str,
        artifact_id: &str,
        event_type: &str,
        payload_json: Option<String>,
    ) -> Result<(), ServiceError> {
        self.context_repository
            .insert_event(&NewContextArtifactEvent {
                event_id: format!("event-{artifact_type}-{artifact_id}-{}", timestamp()),
                artifact_type: artifact_type.to_string(),
                artifact_id: artifact_id.to_string(),
                event_type: event_type.to_string(),
                payload_json,
                created_at: timestamp(),
            })
            .await
    }
}

impl From<ContextBuildJobRecord> for ContextBuildJob {
    fn from(record: ContextBuildJobRecord) -> Self {
        Self {
            job_id: record.job_id,
            job_type: record.job_type,
            loom_id: record.loom_id,
            response_id: record.response_id,
            status: record.status,
            priority: record.priority,
            error: record.error,
            created_at: record.created_at,
            started_at: record.started_at,
            finished_at: record.finished_at,
        }
    }
}

fn required_artifacts(input: &ContextReadinessInput) -> Vec<RequiredContextArtifact> {
    let mut artifacts: Vec<RequiredContextArtifact> = input
        .attached_references
        .iter()
        .filter_map(|attached| {
            attached
                .reference
                .target_id
                .as_ref()
                .map(|response_id| required_response_capsule(input, response_id, None, true))
        })
        .collect();

    if input.context_strategy == ContextStrategy::CheckpointAndRecent {
        artifacts.push(RequiredContextArtifact {
            artifact_type: RequiredContextArtifactType::LoomCheckpoint,
            artifact_id: None,
            response_id: input.current_head_response_id.clone(),
            loom_id: Some(input.loom_id.clone()),
            required: false,
            reason: "Checkpoint strategy requested for this Loom.".to_string(),
        });
    }

    if input.is_weft {
        artifacts.push(RequiredContextArtifact {
            artifact_type: RequiredContextArtifactType::WeftOriginContext,
            artifact_id: None,
            response_id: input.origin_response_id.clone(),
            loom_id: Some(input.loom_id.clone()),
            required: true,
            reason: "Weft context needs immediate origin only.".to_string(),
        });
    }

    artifacts
}

fn required_response_capsule(
    input: &ContextReadinessInput,
    response_id: &str,
    artifact_id: Option<String>,
    required: bool,
) -> RequiredContextArtifact {
    RequiredContextArtifact {
        artifact_type: RequiredContextArtifactType::ResponseCapsule,
        artifact_id,
        response_id: Some(response_id.to_string()),
        loom_id: Some(input.loom_id.clone()),
        required,
        reason: "Attached local Response Reference needs compact capsule context.".to_string(),
    }
}

fn classify_status(result: &ContextReadinessResult) -> ContextReadinessStatus {
    if result
        .warnings
        .iter()
        .any(|warning| warning == "artifact_failed_status")
        && result.fallback_artifacts.is_empty()
        && result.ready_artifacts.is_empty()
    {
        return ContextReadinessStatus::Degraded;
    }

    if !result.fallback_artifacts.is_empty() {
        return ContextReadinessStatus::ReadyWithFallbacks;
    }

    if !result.jobs_created.is_empty() || !result.warnings.is_empty() {
        return ContextReadinessStatus::Degraded;
    }

    ContextReadinessStatus::Ready
}

fn heuristic_summary(content: &str) -> String {
    let first_sentence = content
        .split(['.', '!', '?'])
        .next()
        .unwrap_or(content)
        .trim();
    let source = if first_sentence.is_empty() {
        content.trim()
    } else {
        first_sentence
    };

    let mut summary: String = source.chars().take(320).collect();
    if source.chars().count() > 320 {
        summary.push('…');
    }
    summary
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

impl Default for ContextReadinessInput {
    fn default() -> Self {
        Self {
            loom_id: "loom-1".to_string(),
            current_head_response_id: None,
            attached_references: Vec::new(),
            is_weft: false,
            origin_loom_id: None,
            origin_response_id: None,
            context_strategy: ContextStrategy::Minimal,
            response_mode: ResponseMode::Auto,
            resolved_num_ctx: 2_048,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ContextReadinessGate, ContextReadinessInput, ContextReadinessStatus,
        RequiredContextArtifactType,
    };
    use crate::{
        context::types::{AttachedReferenceInput, ContextStrategy, ReferenceContext, ResponseMode},
        storage::{
            db::test_database,
            repositories::{
                context_artifacts::{
                    ContextArtifactsRepository, NewContextBuildJob, UpsertResponseCapsule,
                },
                looms::{LoomRepository, NewLoom},
                responses::{NewResponse, ResponseRepository},
            },
        },
    };

    #[tokio::test]
    async fn missing_response_capsule_creates_fallback_and_job() {
        let database = test_database().await;
        insert_loom_and_response(&database).await;
        let gate = ContextReadinessGate::new(&database);

        let result = gate
            .prepare(ContextReadinessInput {
                attached_references: vec![reference("response-1")],
                ..ContextReadinessInput::default()
            })
            .await
            .expect("prepare");

        assert_eq!(result.status, ContextReadinessStatus::ReadyWithFallbacks);
        assert_eq!(result.fallback_artifacts.len(), 1);
        assert_eq!(result.jobs_created.len(), 1);
        assert!(result
            .warnings
            .contains(&"fallback_response_capsule_created".to_string()));
    }

    #[tokio::test]
    async fn existing_ready_response_capsule_returns_ready() {
        let database = test_database().await;
        let repository = ContextArtifactsRepository::new(&database);
        insert_capsule(&repository, "ready").await;
        let gate = ContextReadinessGate::new(&database);

        let result = gate
            .prepare(ContextReadinessInput {
                attached_references: vec![reference("response-1")],
                ..ContextReadinessInput::default()
            })
            .await
            .expect("prepare");

        assert_eq!(result.status, ContextReadinessStatus::Ready);
        assert_eq!(result.ready_artifacts.len(), 1);
        assert!(result.jobs_created.is_empty());
    }

    #[tokio::test]
    async fn pending_job_is_reused_not_duplicated() {
        let database = test_database().await;
        let repository = ContextArtifactsRepository::new(&database);
        repository
            .insert_job(&NewContextBuildJob {
                job_id: "job-existing".to_string(),
                job_type: "response_capsule".to_string(),
                loom_id: Some("loom-1".to_string()),
                response_id: Some("response-1".to_string()),
                status: "pending".to_string(),
                priority: 100,
                error: None,
                created_at: "2026-05-08T00:00:00Z".to_string(),
            })
            .await
            .expect("insert job");
        let gate = ContextReadinessGate::new(&database);

        let result = gate
            .prepare(ContextReadinessInput {
                attached_references: vec![reference("response-1")],
                ..ContextReadinessInput::default()
            })
            .await
            .expect("prepare");

        assert_eq!(result.jobs_created[0].job_id, "job-existing");
        let pending = repository
            .list_jobs_by_status("pending")
            .await
            .expect("list pending");
        assert_eq!(pending.len(), 1);
    }

    #[tokio::test]
    async fn failed_artifact_does_not_block_forever() {
        let database = test_database().await;
        let repository = ContextArtifactsRepository::new(&database);
        insert_capsule(&repository, "failed").await;
        let gate = ContextReadinessGate::new(&database);

        let result = gate
            .prepare(ContextReadinessInput {
                attached_references: vec![reference("response-1")],
                ..ContextReadinessInput::default()
            })
            .await
            .expect("prepare");

        assert_eq!(result.status, ContextReadinessStatus::Degraded);
        assert!(result
            .warnings
            .contains(&"artifact_failed_status".to_string()));
        assert_eq!(result.jobs_created.len(), 1);
    }

    #[tokio::test]
    async fn missing_checkpoint_creates_job_and_degrades() {
        let database = test_database().await;
        let gate = ContextReadinessGate::new(&database);

        let result = gate
            .prepare(ContextReadinessInput {
                context_strategy: ContextStrategy::CheckpointAndRecent,
                ..ContextReadinessInput::default()
            })
            .await
            .expect("prepare");

        assert_eq!(result.status, ContextReadinessStatus::Degraded);
        assert!(result.warnings.contains(&"missing_checkpoint".to_string()));
        assert_eq!(result.jobs_created[0].job_type, "loom_checkpoint");
    }

    #[tokio::test]
    async fn missing_weft_origin_creates_warning_and_job() {
        let database = test_database().await;
        let gate = ContextReadinessGate::new(&database);

        let result = gate
            .prepare(ContextReadinessInput {
                is_weft: true,
                origin_response_id: Some("origin-response".to_string()),
                ..ContextReadinessInput::default()
            })
            .await
            .expect("prepare");

        assert_eq!(result.status, ContextReadinessStatus::Degraded);
        assert!(result
            .warnings
            .contains(&"missing_weft_origin_context".to_string()));
        assert_eq!(result.jobs_created[0].job_type, "weft_origin_context");
    }

    #[tokio::test]
    async fn context_artifact_events_are_inserted() {
        let database = test_database().await;
        insert_loom_and_response(&database).await;
        let gate = ContextReadinessGate::new(&database);
        let repository = ContextArtifactsRepository::new(&database);

        let result = gate
            .prepare(ContextReadinessInput {
                attached_references: vec![reference("response-1")],
                ..ContextReadinessInput::default()
            })
            .await
            .expect("prepare");
        let fallback = result.fallback_artifacts[0].artifact_id.as_ref().unwrap();
        let events = repository
            .list_events_for_artifact("response_capsule", fallback)
            .await
            .expect("list events");

        assert!(events
            .iter()
            .any(|event| event.event_type == "artifact.fallback_created"));
    }

    #[tokio::test]
    async fn required_artifacts_identified() {
        let database = test_database().await;
        let gate = ContextReadinessGate::new(&database);

        let result = gate
            .prepare(ContextReadinessInput {
                attached_references: vec![reference("response-1")],
                is_weft: true,
                context_strategy: ContextStrategy::CheckpointAndRecent,
                ..ContextReadinessInput::default()
            })
            .await
            .expect("prepare");

        assert!(
            result
                .required_artifacts
                .iter()
                .any(|artifact| artifact.artifact_type
                    == RequiredContextArtifactType::ResponseCapsule)
        );
        assert!(result
            .required_artifacts
            .iter()
            .any(|artifact| artifact.artifact_type == RequiredContextArtifactType::LoomCheckpoint));
        assert!(result.required_artifacts.iter().any(
            |artifact| artifact.artifact_type == RequiredContextArtifactType::WeftOriginContext
        ));
    }

    async fn insert_loom_and_response(database: &crate::storage::db::Database) {
        let looms = LoomRepository::new(database);
        looms
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Test Loom".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert loom");
        let responses = ResponseRepository::new(database);
        responses
            .insert_response(&NewResponse {
                response_id: "response-1".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Event sourcing stores each state transition as an immutable event. More detail follows.".to_string(),
                title: Some("Event sourcing".to_string()),
                code: Some("R-TEST".to_string()),
                canonical_uri: None,
                created_at: "2026-05-08T00:00:01Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
                sequence_index: 1,
                metadata_json: None,
            })
            .await
            .expect("insert response");
    }

    async fn insert_capsule(repository: &ContextArtifactsRepository, status: &str) {
        repository
            .upsert_response_capsule(&UpsertResponseCapsule {
                capsule_id: "capsule-1".to_string(),
                response_id: "response-1".to_string(),
                loom_id: "loom-1".to_string(),
                response_code: Some("R-TEST".to_string()),
                title: Some("Capsule".to_string()),
                summary: Some("Ready capsule".to_string()),
                key_points_json: Some("[]".to_string()),
                keywords_json: None,
                entities_json: None,
                code_blocks_json: None,
                canonical_uri: None,
                source_hash: None,
                generator: Some("test".to_string()),
                status: status.to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
            })
            .await
            .expect("insert capsule");
    }

    fn reference(response_id: &str) -> AttachedReferenceInput {
        AttachedReferenceInput {
            reference: ReferenceContext {
                reference_id: "ref-1".to_string(),
                target_kind: "response".to_string(),
                target_id: Some(response_id.to_string()),
                target_uri: None,
                label: Some("Reference".to_string()),
                selected_text: None,
                capsule_summary: None,
            },
            response_capsule: None,
        }
    }
}
