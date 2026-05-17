use crate::{
    context::refinement::{
        validate_loom_checkpoint_refinement, validate_response_capsule_refinement,
        ArtifactRefinementError, ArtifactRefinementProvider, LoomCheckpointRefinement,
        LoomCheckpointRefinementInput, ResponseCapsuleRefinement, ResponseCapsuleRefinementInput,
    },
    error::ServiceError,
    storage::{
        db::Database,
        repositories::{
            code_blocks::{ResponseCodeBlockRecord, ResponseCodeBlockRepository},
            context_artifacts::{
                ContextArtifactsRepository, ContextBuildJobRecord, NewContextArtifactEvent,
                NewContextBuildJob, UpsertLoomCheckpoint, UpsertResponseCapsule,
                UpsertWeftOriginContext,
            },
            looms::LoomRepository,
            parts::{ResponsePartRecord, ResponsePartRepository},
            responses::{ResponseRecord, ResponseRepository},
            tags_graph::{ResponseTagRecord, ResponseTagRepository, TopicIndexRepository},
        },
    },
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    hash::{Hash, Hasher},
    sync::Arc,
};

const CHECKPOINT_ASSISTANT_RESPONSE_INTERVAL: usize = 4;

#[derive(Clone)]
pub struct ContextArtifactWorker {
    database: Database,
    refinement_provider: Option<Arc<dyn ArtifactRefinementProvider>>,
}

impl fmt::Debug for ContextArtifactWorker {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ContextArtifactWorker")
            .field("database", &self.database)
            .field("refinement_provider", &self.refinement_provider.is_some())
            .finish()
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ContextWorkerRunOptions {
    pub refine_with_llm: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextWorkerRunResult {
    pub job_id: Option<String>,
    pub status: String,
    pub artifact_ids: Vec<String>,
    pub warnings: Vec<String>,
}

impl ContextArtifactWorker {
    pub fn new(database: &Database) -> Self {
        Self {
            database: database.clone(),
            refinement_provider: None,
        }
    }

    pub fn with_refinement_provider(
        database: &Database,
        refinement_provider: Arc<dyn ArtifactRefinementProvider>,
    ) -> Self {
        Self {
            database: database.clone(),
            refinement_provider: Some(refinement_provider),
        }
    }

    pub async fn schedule_response_capsule_job(
        &self,
        response_id: &str,
    ) -> Result<Option<ContextBuildJobRecord>, ServiceError> {
        let responses = ResponseRepository::new(&self.database);
        let artifacts = ContextArtifactsRepository::new(&self.database);
        let Some(response) = responses.get_response(response_id).await? else {
            return Ok(None);
        };
        if response.role != "assistant" {
            return Ok(None);
        }

        let status = response_status(&response);
        let has_content = !response.content.trim().is_empty();
        let should_schedule = matches!(status.as_deref(), Some("completed") | Some("truncated"))
            || (has_content && matches!(status.as_deref(), Some("error") | Some("cancelled")));
        if !should_schedule || !has_content {
            return Ok(None);
        }

        if artifacts.get_response_capsule(response_id).await?.is_some() {
            return Ok(None);
        }
        if let Some(existing) = artifacts
            .find_pending_job(
                "response_capsule",
                Some(&response.loom_id),
                Some(response_id),
            )
            .await?
        {
            return Ok(Some(existing));
        }

        let job = NewContextBuildJob {
            job_id: format!("job-response-capsule-{response_id}"),
            job_type: "response_capsule".to_string(),
            loom_id: Some(response.loom_id.clone()),
            response_id: Some(response.response_id.clone()),
            status: "pending".to_string(),
            priority: 50,
            error: None,
            created_at: timestamp(),
        };
        artifacts.insert_job(&job).await?;
        artifacts
            .insert_event(&artifact_event(
                "response_capsule",
                response_id,
                "artifact.required",
                serde_json::json!({
                    "jobId": job.job_id,
                    "loomId": response.loom_id,
                    "responseId": response.response_id,
                    "status": status,
                }),
            ))
            .await?;
        artifacts.get_job(&job.job_id).await
    }

    pub async fn run_next_pending_job(
        &self,
    ) -> Result<Option<ContextWorkerRunResult>, ServiceError> {
        self.run_next_pending_job_with_options(ContextWorkerRunOptions::default())
            .await
    }

    pub async fn run_next_pending_job_with_options(
        &self,
        options: ContextWorkerRunOptions,
    ) -> Result<Option<ContextWorkerRunResult>, ServiceError> {
        let artifacts = ContextArtifactsRepository::new(&self.database);
        let Some(job) = artifacts.find_next_pending_job().await? else {
            return Ok(None);
        };
        self.run_job_with_options(&job.job_id, options)
            .await
            .map(Some)
    }

    pub async fn run_job(&self, job_id: &str) -> Result<ContextWorkerRunResult, ServiceError> {
        self.run_job_with_options(job_id, ContextWorkerRunOptions::default())
            .await
    }

    pub async fn run_job_with_options(
        &self,
        job_id: &str,
        options: ContextWorkerRunOptions,
    ) -> Result<ContextWorkerRunResult, ServiceError> {
        let artifacts = ContextArtifactsRepository::new(&self.database);
        let job = artifacts
            .get_job(job_id)
            .await?
            .ok_or_else(|| ServiceError::storage("context job not found"))?;
        if job.status != "pending" {
            return Ok(ContextWorkerRunResult {
                job_id: Some(job.job_id),
                status: job.status,
                artifact_ids: Vec::new(),
                warnings: vec!["job_not_pending".to_string()],
            });
        }

        artifacts
            .update_job_status(&job.job_id, "running", None, &timestamp())
            .await?;
        let result = match job.job_type.as_str() {
            "response_capsule" => self.run_response_capsule_job(&job, options).await,
            _ => Err(ServiceError::storage(format!(
                "unsupported context job type {}",
                job.job_type
            ))),
        };

        match result {
            Ok(result) => {
                artifacts
                    .update_job_status(&job.job_id, "completed", None, &timestamp())
                    .await?;
                Ok(result)
            }
            Err(error) => {
                let message = error.to_string();
                artifacts
                    .update_job_status(&job.job_id, "failed", Some(&message), &timestamp())
                    .await?;
                if let Some(response_id) = &job.response_id {
                    let _ = artifacts
                        .insert_event(&artifact_event(
                            "response_capsule",
                            response_id,
                            "artifact.failed",
                            serde_json::json!({
                                "jobId": job.job_id,
                                "error": message,
                            }),
                        ))
                        .await;
                }
                Err(error)
            }
        }
    }

    pub async fn list_jobs(
        &self,
        status: Option<&str>,
    ) -> Result<Vec<ContextBuildJobRecord>, ServiceError> {
        ContextArtifactsRepository::new(&self.database)
            .list_jobs(status)
            .await
    }

    async fn run_response_capsule_job(
        &self,
        job: &ContextBuildJobRecord,
        options: ContextWorkerRunOptions,
    ) -> Result<ContextWorkerRunResult, ServiceError> {
        let response_id = job
            .response_id
            .as_deref()
            .ok_or_else(|| ServiceError::storage("response capsule job missing response_id"))?;
        let responses = ResponseRepository::new(&self.database);
        let artifacts = ContextArtifactsRepository::new(&self.database);
        let response = responses
            .get_response(response_id)
            .await?
            .ok_or_else(|| ServiceError::storage("response not found for context job"))?;
        if response.content.trim().is_empty() {
            return Err(ServiceError::storage(
                "cannot build response capsule from empty response",
            ));
        }

        let capsule = self
            .build_response_capsule_with_artifacts(&response)
            .await?;
        artifacts.upsert_response_capsule(&capsule).await?;
        artifacts
            .insert_event(&artifact_event(
                "response_capsule",
                &capsule.capsule_id,
                "artifact.ready",
                serde_json::json!({
                    "jobId": job.job_id,
                    "responseId": response.response_id,
                    "loomId": response.loom_id,
                    "truncated": response_status(&response).as_deref() == Some("truncated"),
                }),
            ))
            .await?;

        let mut artifact_ids = vec![capsule.capsule_id.clone()];
        let mut warnings = Vec::new();
        if let Some(warning) = self
            .maybe_refine_response_capsule(job, &response, &capsule, options)
            .await?
        {
            warnings.push(warning);
        }
        let (checkpoint_id, checkpoint_warnings) =
            self.maybe_create_checkpoint(&response, options).await?;
        warnings.extend(checkpoint_warnings);
        if let Some(checkpoint_id) = checkpoint_id {
            artifact_ids.push(checkpoint_id);
        }
        if let Some(origin_id) = self.ensure_weft_origin_context(&response).await? {
            artifact_ids.push(origin_id);
        } else {
            warnings.push("weft_origin_not_applicable_or_missing".to_string());
        }

        Ok(ContextWorkerRunResult {
            job_id: Some(job.job_id.clone()),
            status: "completed".to_string(),
            artifact_ids,
            warnings,
        })
    }

    async fn maybe_create_checkpoint(
        &self,
        response: &ResponseRecord,
        options: ContextWorkerRunOptions,
    ) -> Result<(Option<String>, Vec<String>), ServiceError> {
        let responses = ResponseRepository::new(&self.database)
            .list_responses_for_loom(&response.loom_id)
            .await?;
        let assistant_responses: Vec<_> = responses
            .into_iter()
            .filter(|record| record.role == "assistant")
            .collect();
        if assistant_responses.len() < CHECKPOINT_ASSISTANT_RESPONSE_INTERVAL {
            return Ok((None, Vec::new()));
        }
        let artifacts = ContextArtifactsRepository::new(&self.database);
        let latest_checkpoint = artifacts
            .get_latest_checkpoint_for_loom(&response.loom_id)
            .await?;
        let should_checkpoint = assistant_responses.len() % CHECKPOINT_ASSISTANT_RESPONSE_INTERVAL
            == 0
            || latest_checkpoint.is_none();
        if !should_checkpoint {
            return Ok((None, Vec::new()));
        }

        let capsule_summaries = self
            .capsule_summaries_for_responses(&assistant_responses)
            .await?;
        let topics = TopicIndexRepository::new(&self.database)
            .list_topics_for_loom(&response.loom_id)
            .await?;
        let top_topics = top_topics(&topics);
        let covered_start = assistant_responses
            .first()
            .map(|record| record.response_id.as_str())
            .unwrap_or(response.response_id.as_str());
        let covered_end = assistant_responses
            .last()
            .map(|record| record.response_id.as_str())
            .unwrap_or(response.response_id.as_str());
        let decisions =
            extract_labeled_items_from_responses(&assistant_responses, ItemKind::Decision);
        let constraints =
            extract_labeled_items_from_responses(&assistant_responses, ItemKind::Constraint);
        let risks = extract_labeled_items_from_responses(&assistant_responses, ItemKind::Risk);
        let mut open_questions =
            extract_labeled_items_from_responses(&assistant_responses, ItemKind::OpenQuestion);
        for risk in &risks {
            push_unique(&mut open_questions, format!("Risk unresolved: {risk}"), 8);
        }
        let code_refs = self
            .code_block_refs_for_responses(&assistant_responses)
            .await?;
        let merged_summary = checkpoint_summary(
            covered_start,
            covered_end,
            &capsule_summaries,
            &top_topics,
            &decisions,
            &constraints,
            &open_questions,
            &code_refs,
        );
        let mut entities = merged_terms_from_capsules(&capsule_summaries);
        for topic in &top_topics {
            push_unique(&mut entities, topic.clone(), 20);
        }
        let checkpoint_id = format!("checkpoint-{}-{}", response.loom_id, response.response_id);
        let now = timestamp();
        let checkpoint = UpsertLoomCheckpoint {
            checkpoint_id: checkpoint_id.clone(),
            loom_id: response.loom_id.clone(),
            up_to_response_id: Some(response.response_id.clone()),
            summary: merged_summary,
            decisions_json: Some(serde_json::to_string(&decisions).map_err(json_error)?),
            constraints_json: Some(serde_json::to_string(&constraints).map_err(json_error)?),
            open_questions_json: Some(serde_json::to_string(&open_questions).map_err(json_error)?),
            entities_json: Some(serde_json::to_string(&entities).map_err(json_error)?),
            wefts_json: Some("[]".to_string()),
            references_json: Some(serde_json::to_string(&code_refs).map_err(json_error)?),
            source_hash: Some(source_hash(&response.content)),
            status: "ready".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        artifacts.upsert_loom_checkpoint(&checkpoint).await?;
        artifacts
            .insert_event(&artifact_event(
                "loom_checkpoint",
                &checkpoint_id,
                "artifact.ready",
                serde_json::json!({
                    "loomId": response.loom_id,
                    "upToResponseId": response.response_id,
                }),
            ))
            .await?;
        let mut warnings = Vec::new();
        if let Some(warning) = self
            .maybe_refine_loom_checkpoint(response, &checkpoint, &capsule_summaries, options)
            .await?
        {
            warnings.push(warning);
        }
        Ok((Some(checkpoint_id), warnings))
    }

    async fn build_response_capsule_with_artifacts(
        &self,
        response: &ResponseRecord,
    ) -> Result<UpsertResponseCapsule, ServiceError> {
        reject_forbidden_text(&response.content)?;
        reject_forbidden_text(response.metadata_json.as_deref().unwrap_or(""))?;
        let parts = ResponsePartRepository::new(&self.database)
            .list_by_response(&response.response_id)
            .await?;
        let tags = ResponseTagRepository::new(&self.database)
            .list_by_response(&response.response_id)
            .await?;
        let code_blocks = ResponseCodeBlockRepository::new(&self.database)
            .list_by_response(&response.response_id)
            .await?;
        build_response_capsule_from_artifacts(response, &parts, &tags, &code_blocks)
    }

    async fn maybe_refine_response_capsule(
        &self,
        job: &ContextBuildJobRecord,
        response: &ResponseRecord,
        heuristic: &UpsertResponseCapsule,
        options: ContextWorkerRunOptions,
    ) -> Result<Option<String>, ServiceError> {
        if !options.refine_with_llm {
            return Ok(None);
        }
        let artifacts = ContextArtifactsRepository::new(&self.database);
        artifacts
            .insert_event(&artifact_event(
                "response_capsule",
                &heuristic.capsule_id,
                "artifact.refinement_started",
                serde_json::json!({
                    "jobId": job.job_id,
                    "responseId": response.response_id,
                    "loomId": response.loom_id,
                    "provider": self.refinement_provider.is_some(),
                }),
            ))
            .await?;

        let Some(provider) = &self.refinement_provider else {
            self.record_refinement_problem(
                &artifacts,
                "response_capsule",
                &heuristic.capsule_id,
                "artifact.refinement_failed",
                ArtifactRefinementError::ProviderUnavailable(
                    "artifact refinement provider is unavailable".to_string(),
                ),
            )
            .await?;
            return Ok(Some("refinement_provider_unavailable".to_string()));
        };

        let input = ResponseCapsuleRefinementInput {
            response_id: response.response_id.clone(),
            loom_id: response.loom_id.clone(),
            response_code: response.code.clone(),
            title: response.title.clone(),
            content: response.content.clone(),
            heuristic_summary: heuristic.summary.clone(),
            heuristic_key_points_json: heuristic.key_points_json.clone(),
            heuristic_keywords_json: heuristic.keywords_json.clone(),
            heuristic_entities_json: heuristic.entities_json.clone(),
            heuristic_code_blocks_json: heuristic.code_blocks_json.clone(),
        };

        match provider.refine_response_capsule(input).await {
            Ok(refinement) => {
                if let Err(error) = validate_response_capsule_refinement(&refinement) {
                    self.record_refinement_problem(
                        &artifacts,
                        "response_capsule",
                        &heuristic.capsule_id,
                        "artifact.refinement_rejected",
                        ArtifactRefinementError::Rejected(error.to_string()),
                    )
                    .await?;
                    return Ok(Some("refinement_rejected".to_string()));
                }
                let refined = refined_response_capsule(heuristic, refinement)?;
                artifacts.upsert_response_capsule(&refined).await?;
                artifacts
                    .insert_event(&artifact_event(
                        "response_capsule",
                        &refined.capsule_id,
                        "artifact.refinement_ready",
                        serde_json::json!({
                            "jobId": job.job_id,
                            "responseId": response.response_id,
                            "loomId": response.loom_id,
                            "generator": "llm_refined",
                        }),
                    ))
                    .await?;
                Ok(None)
            }
            Err(error) => {
                let kind = error.kind().to_string();
                self.record_refinement_problem(
                    &artifacts,
                    "response_capsule",
                    &heuristic.capsule_id,
                    if matches!(error, ArtifactRefinementError::Rejected(_)) {
                        "artifact.refinement_rejected"
                    } else {
                        "artifact.refinement_failed"
                    },
                    error,
                )
                .await?;
                Ok(Some(kind))
            }
        }
    }

    async fn maybe_refine_loom_checkpoint(
        &self,
        response: &ResponseRecord,
        heuristic: &UpsertLoomCheckpoint,
        capsule_summaries: &[String],
        options: ContextWorkerRunOptions,
    ) -> Result<Option<String>, ServiceError> {
        if !options.refine_with_llm {
            return Ok(None);
        }
        let artifacts = ContextArtifactsRepository::new(&self.database);
        artifacts
            .insert_event(&artifact_event(
                "loom_checkpoint",
                &heuristic.checkpoint_id,
                "artifact.refinement_started",
                serde_json::json!({
                    "loomId": response.loom_id,
                    "upToResponseId": response.response_id,
                    "provider": self.refinement_provider.is_some(),
                }),
            ))
            .await?;

        let Some(provider) = &self.refinement_provider else {
            self.record_refinement_problem(
                &artifacts,
                "loom_checkpoint",
                &heuristic.checkpoint_id,
                "artifact.refinement_failed",
                ArtifactRefinementError::ProviderUnavailable(
                    "artifact refinement provider is unavailable".to_string(),
                ),
            )
            .await?;
            return Ok(Some("refinement_provider_unavailable".to_string()));
        };

        let looms = LoomRepository::new(&self.database);
        let loom_title = looms
            .get_loom(&response.loom_id)
            .await?
            .map(|loom| loom.title);
        let previous_checkpoint = artifacts
            .get_latest_checkpoint_for_loom(&response.loom_id)
            .await?
            .and_then(|checkpoint| {
                (checkpoint.checkpoint_id != heuristic.checkpoint_id).then_some(checkpoint.summary)
            });

        let input = LoomCheckpointRefinementInput {
            checkpoint_id: heuristic.checkpoint_id.clone(),
            loom_id: response.loom_id.clone(),
            up_to_response_id: heuristic.up_to_response_id.clone(),
            loom_title,
            heuristic_summary: heuristic.summary.clone(),
            recent_capsule_summaries: capsule_summaries.to_vec(),
            previous_checkpoint_summary: previous_checkpoint,
        };

        match provider.refine_loom_checkpoint(input).await {
            Ok(refinement) => {
                if let Err(error) = validate_loom_checkpoint_refinement(&refinement) {
                    self.record_refinement_problem(
                        &artifacts,
                        "loom_checkpoint",
                        &heuristic.checkpoint_id,
                        "artifact.refinement_rejected",
                        ArtifactRefinementError::Rejected(error.to_string()),
                    )
                    .await?;
                    return Ok(Some("refinement_rejected".to_string()));
                }
                let refined = refined_loom_checkpoint(heuristic, refinement)?;
                artifacts.upsert_loom_checkpoint(&refined).await?;
                artifacts
                    .insert_event(&artifact_event(
                        "loom_checkpoint",
                        &refined.checkpoint_id,
                        "artifact.refinement_ready",
                        serde_json::json!({
                            "loomId": response.loom_id,
                            "upToResponseId": response.response_id,
                            "generator": "llm_refined",
                        }),
                    ))
                    .await?;
                Ok(None)
            }
            Err(error) => {
                let kind = error.kind().to_string();
                self.record_refinement_problem(
                    &artifacts,
                    "loom_checkpoint",
                    &heuristic.checkpoint_id,
                    if matches!(error, ArtifactRefinementError::Rejected(_)) {
                        "artifact.refinement_rejected"
                    } else {
                        "artifact.refinement_failed"
                    },
                    error,
                )
                .await?;
                Ok(Some(kind))
            }
        }
    }

    async fn record_refinement_problem(
        &self,
        artifacts: &ContextArtifactsRepository,
        artifact_type: &str,
        artifact_id: &str,
        event_type: &str,
        error: ArtifactRefinementError,
    ) -> Result<(), ServiceError> {
        artifacts
            .insert_event(&artifact_event(
                artifact_type,
                artifact_id,
                event_type,
                serde_json::json!({
                    "errorKind": error.kind(),
                    "message": error.safe_message(),
                }),
            ))
            .await
    }

    async fn capsule_summaries_for_responses(
        &self,
        responses: &[ResponseRecord],
    ) -> Result<Vec<String>, ServiceError> {
        let artifacts = ContextArtifactsRepository::new(&self.database);
        let mut summaries = Vec::new();
        for response in responses
            .iter()
            .rev()
            .take(CHECKPOINT_ASSISTANT_RESPONSE_INTERVAL)
        {
            if let Some(capsule) = artifacts
                .get_response_capsule(&response.response_id)
                .await?
            {
                if let Some(summary) = capsule.summary {
                    summaries.push(summary);
                }
            }
        }
        summaries.reverse();
        Ok(summaries)
    }

    async fn code_block_refs_for_responses(
        &self,
        responses: &[ResponseRecord],
    ) -> Result<Vec<String>, ServiceError> {
        let repository = ResponseCodeBlockRepository::new(&self.database);
        let mut refs = Vec::new();
        for response in responses
            .iter()
            .rev()
            .take(CHECKPOINT_ASSISTANT_RESPONSE_INTERVAL)
        {
            for block in repository.list_by_response(&response.response_id).await? {
                push_unique(&mut refs, code_block_ref(&block), 12);
            }
        }
        refs.reverse();
        Ok(refs)
    }

    async fn ensure_weft_origin_context(
        &self,
        response: &ResponseRecord,
    ) -> Result<Option<String>, ServiceError> {
        let looms = LoomRepository::new(&self.database);
        let Some(loom) = looms.get_loom(&response.loom_id).await? else {
            return Ok(None);
        };
        let (Some(origin_loom_id), Some(origin_response_id)) =
            (loom.origin_loom_id.clone(), loom.origin_response_id.clone())
        else {
            return Ok(None);
        };
        if loom.kind != "weft" {
            return Ok(None);
        }

        let artifacts = ContextArtifactsRepository::new(&self.database);
        if let Some(existing) = artifacts.get_weft_origin_context(&loom.loom_id).await? {
            return Ok(Some(existing.context_id));
        }
        let origin_capsule = artifacts.get_response_capsule(&origin_response_id).await?;
        let origin_summary = origin_capsule
            .as_ref()
            .and_then(|capsule| capsule.summary.clone())
            .unwrap_or_else(|| "Origin response context unavailable.".to_string());
        let context_id = format!("weft-origin-{}", loom.loom_id);
        let now = timestamp();
        artifacts
            .upsert_weft_origin_context(&UpsertWeftOriginContext {
                context_id: context_id.clone(),
                weft_loom_id: loom.loom_id.clone(),
                origin_loom_id,
                origin_response_id,
                origin_capsule_id: origin_capsule.map(|capsule| capsule.capsule_id),
                origin_summary: Some(origin_summary),
                source_hash: Some(source_hash(&response.content)),
                status: "ready".to_string(),
                created_at: now.clone(),
                updated_at: now,
            })
            .await?;
        artifacts
            .insert_event(&artifact_event(
                "weft_origin_context",
                &context_id,
                "artifact.ready",
                serde_json::json!({
                    "weftLoomId": loom.loom_id,
                }),
            ))
            .await?;
        Ok(Some(context_id))
    }
}

pub fn build_response_capsule(
    response: &ResponseRecord,
) -> Result<UpsertResponseCapsule, ServiceError> {
    reject_forbidden_text(&response.content)?;
    reject_forbidden_text(response.metadata_json.as_deref().unwrap_or(""))?;
    let title = response
        .title
        .clone()
        .or_else(|| first_meaningful_phrase(&response.content));
    let summary =
        first_sentence(&response.content).unwrap_or_else(|| truncate(response.content.trim(), 280));
    let key_points = key_points(&response.content);
    let keywords = keywords(&response.content);
    let entities = entities(&response.content);
    let code_blocks = code_blocks(&response.content);
    let now = timestamp();

    Ok(UpsertResponseCapsule {
        capsule_id: format!("capsule-{}", response.response_id),
        response_id: response.response_id.clone(),
        loom_id: response.loom_id.clone(),
        response_code: response.code.clone(),
        title,
        summary: Some(summary),
        key_points_json: Some(serde_json::to_string(&key_points).map_err(json_error)?),
        keywords_json: Some(serde_json::to_string(&keywords).map_err(json_error)?),
        entities_json: Some(serde_json::to_string(&entities).map_err(json_error)?),
        code_blocks_json: Some(serde_json::to_string(&code_blocks).map_err(json_error)?),
        canonical_uri: response.canonical_uri.clone(),
        source_hash: Some(source_hash(&response.content)),
        generator: Some("heuristic".to_string()),
        status: "ready".to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

fn build_response_capsule_from_artifacts(
    response: &ResponseRecord,
    parts: &[ResponsePartRecord],
    tags: &[ResponseTagRecord],
    code_blocks: &[ResponseCodeBlockRecord],
) -> Result<UpsertResponseCapsule, ServiceError> {
    reject_forbidden_text(&response.content)?;
    reject_forbidden_text(response.metadata_json.as_deref().unwrap_or(""))?;
    let title = response
        .title
        .clone()
        .or_else(|| {
            parts
                .iter()
                .find(|part| part.part_kind == "heading")
                .and_then(|part| part.content.clone())
        })
        .or_else(|| first_meaningful_phrase(&response.content));
    let summary = capsule_summary_from_parts(parts)
        .or_else(|| first_sentence(&response.content))
        .unwrap_or_else(|| truncate(response.content.trim(), 280));
    let mut capsule_key_points = key_points_from_parts(parts);
    for item in extract_labeled_items_from_text(&response.content, ItemKind::Decision) {
        push_unique(&mut capsule_key_points, format!("Decision: {item}"), 10);
    }
    for item in extract_labeled_items_from_text(&response.content, ItemKind::Constraint) {
        push_unique(&mut capsule_key_points, format!("Constraint: {item}"), 10);
    }
    for item in extract_labeled_items_from_text(&response.content, ItemKind::Risk) {
        push_unique(&mut capsule_key_points, format!("Risk: {item}"), 10);
    }
    for item in extract_labeled_items_from_text(&response.content, ItemKind::OpenQuestion) {
        push_unique(
            &mut capsule_key_points,
            format!("Open question: {item}"),
            10,
        );
    }
    if capsule_key_points.is_empty() {
        capsule_key_points = key_points(&response.content);
    }

    let mut keywords = keywords(&response.content);
    for tag in tags {
        push_unique(&mut keywords, tag.normalized_tag.clone(), 16);
    }
    let mut entities = entities(&response.content);
    for tag in tags.iter().filter(|tag| {
        matches!(
            tag.tag_kind.as_str(),
            "topic" | "entity" | "technology" | "architecture" | "domain" | "acronym" | "pattern"
        )
    }) {
        push_unique(&mut entities, tag.tag.clone(), 16);
    }
    let code_refs = code_blocks.iter().map(code_block_ref).collect::<Vec<_>>();
    let now = timestamp();

    Ok(UpsertResponseCapsule {
        capsule_id: format!("capsule-{}", response.response_id),
        response_id: response.response_id.clone(),
        loom_id: response.loom_id.clone(),
        response_code: response.code.clone(),
        title,
        summary: Some(summary),
        key_points_json: Some(serde_json::to_string(&capsule_key_points).map_err(json_error)?),
        keywords_json: Some(serde_json::to_string(&keywords).map_err(json_error)?),
        entities_json: Some(serde_json::to_string(&entities).map_err(json_error)?),
        code_blocks_json: Some(serde_json::to_string(&code_refs).map_err(json_error)?),
        canonical_uri: response.canonical_uri.clone(),
        source_hash: Some(source_hash(&response.content)),
        generator: Some("heuristic_parts_tags".to_string()),
        status: "ready".to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

fn refined_response_capsule(
    heuristic: &UpsertResponseCapsule,
    refinement: ResponseCapsuleRefinement,
) -> Result<UpsertResponseCapsule, ServiceError> {
    Ok(UpsertResponseCapsule {
        capsule_id: heuristic.capsule_id.clone(),
        response_id: heuristic.response_id.clone(),
        loom_id: heuristic.loom_id.clone(),
        response_code: heuristic.response_code.clone(),
        title: Some(refinement.title),
        summary: Some(refinement.summary),
        key_points_json: Some(serde_json::to_string(&refinement.key_points).map_err(json_error)?),
        keywords_json: Some(serde_json::to_string(&refinement.keywords).map_err(json_error)?),
        entities_json: Some(serde_json::to_string(&refinement.entities).map_err(json_error)?),
        code_blocks_json: Some(serde_json::to_string(&refinement.code_blocks).map_err(json_error)?),
        canonical_uri: heuristic.canonical_uri.clone(),
        source_hash: heuristic.source_hash.clone(),
        generator: Some("llm_refined".to_string()),
        status: "ready".to_string(),
        created_at: heuristic.created_at.clone(),
        updated_at: timestamp(),
    })
}

fn refined_loom_checkpoint(
    heuristic: &UpsertLoomCheckpoint,
    refinement: LoomCheckpointRefinement,
) -> Result<UpsertLoomCheckpoint, ServiceError> {
    Ok(UpsertLoomCheckpoint {
        checkpoint_id: heuristic.checkpoint_id.clone(),
        loom_id: heuristic.loom_id.clone(),
        up_to_response_id: heuristic.up_to_response_id.clone(),
        summary: refinement.summary,
        decisions_json: Some(serde_json::to_string(&refinement.decisions).map_err(json_error)?),
        constraints_json: Some(serde_json::to_string(&refinement.constraints).map_err(json_error)?),
        open_questions_json: Some(
            serde_json::to_string(&refinement.open_questions).map_err(json_error)?,
        ),
        entities_json: Some(serde_json::to_string(&refinement.entities).map_err(json_error)?),
        wefts_json: Some(serde_json::to_string(&refinement.wefts).map_err(json_error)?),
        references_json: Some(serde_json::to_string(&refinement.references).map_err(json_error)?),
        source_hash: heuristic.source_hash.clone(),
        status: "ready".to_string(),
        created_at: heuristic.created_at.clone(),
        updated_at: timestamp(),
    })
}

#[derive(Debug, Clone, Copy)]
enum ItemKind {
    Decision,
    Constraint,
    Risk,
    OpenQuestion,
}

fn capsule_summary_from_parts(parts: &[ResponsePartRecord]) -> Option<String> {
    let heading = parts
        .iter()
        .find(|part| part.part_kind == "heading")
        .and_then(|part| part.content.as_deref());
    let first_paragraph = parts
        .iter()
        .find(|part| part.part_kind == "paragraph")
        .and_then(|part| part.content.as_deref());
    match (heading, first_paragraph) {
        (Some(heading), Some(paragraph)) => Some(truncate(
            &format!("{heading}: {}", truncate(paragraph, 260)),
            360,
        )),
        (Some(heading), None) => Some(truncate(heading, 260)),
        (None, Some(paragraph)) => Some(truncate(paragraph, 320)),
        (None, None) => None,
    }
}

fn key_points_from_parts(parts: &[ResponsePartRecord]) -> Vec<String> {
    let mut values = Vec::new();
    for part in parts {
        match part.part_kind.as_str() {
            "heading" => {
                if let Some(content) = &part.content {
                    push_unique(&mut values, format!("Topic: {}", truncate(content, 160)), 8);
                }
            }
            "list" | "table" | "quote" => {
                if let Some(content) = part.content.as_deref().or(part.markdown.as_deref()) {
                    push_unique(&mut values, truncate(content, 180), 8);
                }
            }
            "code_block" => {
                if let Some(code_block_id) = &part.code_block_id {
                    push_unique(
                        &mut values,
                        format!("Code block reference: {code_block_id}"),
                        8,
                    );
                }
            }
            _ => {}
        }
    }
    values
}

fn code_block_ref(block: &ResponseCodeBlockRecord) -> String {
    let language = block.language.as_deref().unwrap_or("unknown");
    let line_count = block.code.lines().count();
    format!(
        "{} ({language}, {line_count} lines, hash {})",
        block.code_block_id, block.exact_hash
    )
}

fn top_topics(topics: &[crate::storage::repositories::tags_graph::LoomTopicRecord]) -> Vec<String> {
    let mut topics = topics.to_vec();
    topics.sort_by(|left, right| {
        right
            .weight
            .partial_cmp(&left.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| left.topic.cmp(&right.topic))
    });
    topics
        .into_iter()
        .take(8)
        .map(|topic| topic.topic)
        .collect()
}

fn checkpoint_summary(
    covered_start: &str,
    covered_end: &str,
    capsule_summaries: &[String],
    top_topics: &[String],
    decisions: &[String],
    constraints: &[String],
    open_questions: &[String],
    code_refs: &[String],
) -> String {
    let mut sections = vec![format!(
        "Covered response range: {covered_start}..{covered_end}"
    )];
    if !top_topics.is_empty() {
        sections.push(format!("Top topics: {}", top_topics.join(", ")));
    }
    if !capsule_summaries.is_empty() {
        sections.push(format!(
            "Summary: {}",
            truncate(&capsule_summaries.join(" "), 700)
        ));
    }
    if !decisions.is_empty() {
        sections.push(format!("Decisions: {}", decisions.join("; ")));
    }
    if !constraints.is_empty() {
        sections.push(format!("Constraints: {}", constraints.join("; ")));
    }
    if !open_questions.is_empty() {
        sections.push(format!(
            "Open questions / risks: {}",
            open_questions.join("; ")
        ));
    }
    if !code_refs.is_empty() {
        sections.push(format!("Code block refs: {}", code_refs.join("; ")));
    }
    truncate(&sections.join("\n"), 1400)
}

fn extract_labeled_items_from_responses(
    responses: &[ResponseRecord],
    kind: ItemKind,
) -> Vec<String> {
    let mut values = Vec::new();
    for response in responses {
        for item in extract_labeled_items_from_text(&response.content, kind) {
            push_unique(&mut values, item, 8);
        }
    }
    values
}

fn extract_labeled_items_from_text(text: &str, kind: ItemKind) -> Vec<String> {
    let needles = match kind {
        ItemKind::Decision => &["decision", "decided", "karar"][..],
        ItemKind::Constraint => &["constraint", "must", "do not", "kısıt", "zorunlu"][..],
        ItemKind::Risk => &[
            "risk",
            "warning",
            "trade-off",
            "limitation",
            "uyarı",
            "risk",
        ][..],
        ItemKind::OpenQuestion => &["open question", "question", "todo", "unknown", "?"][..],
    };
    let mut values = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let lower = line.to_lowercase();
        if needles.iter().any(|needle| lower.contains(needle)) {
            let cleaned = line
                .trim_start_matches(['-', '*', '#', ' '])
                .trim_start_matches(|character: char| {
                    character.is_ascii_digit() || character == '.'
                })
                .trim();
            push_unique(&mut values, truncate(cleaned, 180), 8);
        }
    }
    values
}

fn push_unique(values: &mut Vec<String>, value: String, limit: usize) {
    if values.len() >= limit || value.trim().is_empty() {
        return;
    }
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn artifact_event(
    artifact_type: &str,
    artifact_id: &str,
    event_type: &str,
    payload: serde_json::Value,
) -> NewContextArtifactEvent {
    NewContextArtifactEvent {
        event_id: format!("event-{artifact_type}-{artifact_id}-{}", timestamp()),
        artifact_type: artifact_type.to_string(),
        artifact_id: artifact_id.to_string(),
        event_type: event_type.to_string(),
        payload_json: Some(payload.to_string()),
        created_at: timestamp(),
    }
}

fn response_status(response: &ResponseRecord) -> Option<String> {
    response
        .metadata_json
        .as_deref()
        .and_then(|metadata| serde_json::from_str::<serde_json::Value>(metadata).ok())
        .and_then(|metadata| {
            metadata
                .get("status")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
}

fn first_meaningful_phrase(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| truncate(line.trim_matches(&['#', '-', '*', ' '] as &[_]), 80))
        .filter(|line| !line.is_empty())
}

fn first_sentence(text: &str) -> Option<String> {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    compact
        .split_terminator(['.', '!', '?'])
        .map(str::trim)
        .find(|sentence| !sentence.is_empty())
        .map(|sentence| truncate(sentence, 320))
}

fn key_points(text: &str) -> Vec<String> {
    let mut points = Vec::new();
    for line in text.lines().map(str::trim) {
        let cleaned = line
            .trim_start_matches(|character: char| {
                character == '-'
                    || character == '*'
                    || character.is_ascii_digit()
                    || character == '.'
            })
            .trim();
        if cleaned.len() > 12
            && (line.starts_with('-')
                || line.starts_with('*')
                || line.chars().next().is_some_and(|c| c.is_ascii_digit()))
        {
            points.push(truncate(cleaned, 180));
        }
        if points.len() >= 6 {
            return points;
        }
    }
    if points.is_empty() {
        points.extend(
            text.split_terminator(['.', '!', '?'])
                .map(str::trim)
                .filter(|sentence| sentence.len() > 24)
                .take(4)
                .map(|sentence| truncate(sentence, 180)),
        );
    }
    points
}

fn keywords(text: &str) -> Vec<String> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for token in normalized_tokens(text) {
        if token.len() < 4 || STOP_WORDS.contains(&token.as_str()) {
            continue;
        }
        *counts.entry(token).or_default() += 1;
    }
    let mut sorted: Vec<_> = counts.into_iter().collect();
    sorted.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    sorted
        .into_iter()
        .take(10)
        .map(|(token, _)| token)
        .collect()
}

fn entities(text: &str) -> Vec<String> {
    let mut entities = BTreeSet::new();
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|character: char| !character.is_alphanumeric());
        if cleaned.len() > 2 && cleaned.chars().next().is_some_and(char::is_uppercase) {
            entities.insert(cleaned.to_string());
        }
    }
    entities.into_iter().take(10).collect()
}

fn code_blocks(text: &str) -> Vec<serde_json::Value> {
    let mut blocks = Vec::new();
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        if let Some(language) = line.trim().strip_prefix("```") {
            let mut code_lines = 0usize;
            for code_line in lines.by_ref() {
                if code_line.trim().starts_with("```") {
                    break;
                }
                code_lines += 1;
            }
            blocks.push(serde_json::json!({
                "language": language.trim(),
                "summary": format!("{code_lines} lines of code")
            }));
        }
        if blocks.len() >= 6 {
            break;
        }
    }
    blocks
}

fn merged_terms_from_capsules(summaries: &[String]) -> Vec<String> {
    let mut values = BTreeSet::new();
    for summary in summaries {
        for keyword in keywords(summary) {
            values.insert(keyword);
        }
    }
    values.into_iter().take(20).collect()
}

fn normalized_tokens(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|token| {
            token
                .trim_matches(|character: char| !character.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect()
}

fn source_hash(text: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn truncate(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    text.chars().take(max_chars).collect::<String>()
}

fn reject_forbidden_text(text: &str) -> Result<(), ServiceError> {
    for forbidden in [
        "raw_thinking",
        "thinking_text",
        "chain_of_thought",
        "hidden_reasoning",
    ] {
        if text.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "context worker payload contains forbidden key {forbidden}"
            )));
        }
    }
    Ok(())
}

fn json_error(error: serde_json::Error) -> ServiceError {
    ServiceError::storage(format!(
        "failed to serialize context worker payload: {error}"
    ))
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

const STOP_WORDS: &[&str] = &[
    "about", "after", "also", "and", "are", "but", "for", "from", "into", "that", "the", "this",
    "with", "your", "bir", "bu", "icin", "ile", "olan", "olarak", "ve", "veya",
];

#[cfg(test)]
mod tests {
    use super::{build_response_capsule, ContextArtifactWorker, ContextWorkerRunOptions};
    use crate::context::refinement::{
        ArtifactRefinementError, ArtifactRefinementFuture, ArtifactRefinementProvider,
        CodeBlockRefinement, LoomCheckpointRefinement, LoomCheckpointRefinementInput,
        ResponseCapsuleRefinement, ResponseCapsuleRefinementInput,
    };
    use crate::storage::{
        db::test_database,
        repositories::{
            context_artifacts::{ContextArtifactsRepository, NewContextBuildJob},
            looms::{LoomRepository, NewLoom},
            responses::{NewResponse, ResponseRepository},
        },
    };
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[tokio::test]
    async fn completed_response_creates_pending_capsule_job() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "Completed answer.",
            0,
            "completed",
        )
        .await;

        let job = ContextArtifactWorker::new(&database)
            .schedule_response_capsule_job("response-1")
            .await
            .expect("schedule")
            .expect("job");

        assert_eq!(job.job_type, "response_capsule");
        assert_eq!(job.status, "pending");
    }

    #[tokio::test]
    async fn run_job_creates_response_capsule() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "A completed answer. It has a second point.",
            0,
            "completed",
        )
        .await;
        let worker = ContextArtifactWorker::new(&database);
        let job = worker
            .schedule_response_capsule_job("response-1")
            .await
            .expect("schedule")
            .expect("job");

        let result = worker.run_job(&job.job_id).await.expect("run job");
        assert_eq!(result.status, "completed");

        let capsule = ContextArtifactsRepository::new(&database)
            .get_response_capsule("response-1")
            .await
            .expect("get capsule")
            .expect("capsule");
        assert_eq!(capsule.status, "ready");
        assert_eq!(capsule.generator.as_deref(), Some("heuristic_parts_tags"));
    }

    #[tokio::test]
    async fn response_capsule_uses_parts_tags_and_code_block_references() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        let content = [
            "# Event Sourcing",
            "",
            "Event Sourcing uses an Event Store, Replay, CQRS, and Snapshot strategies.",
            "",
            "- Decision: Keep the Event Store as the source of truth.",
            "- Constraint: Projections must be rebuildable by Replay.",
            "- Risk: Event schema evolution needs migration discipline.",
            "- Open question: How often should snapshots be created?",
            "",
            "```ts",
            "const stream = eventStore.load(aggregateId);",
            "const state = replay(stream);",
            "```",
        ]
        .join("\n");
        insert_response(
            &database,
            "event-response",
            "loom-1",
            "assistant",
            &content,
            0,
            "completed",
        )
        .await;
        let worker = ContextArtifactWorker::new(&database);
        let job = worker
            .schedule_response_capsule_job("event-response")
            .await
            .unwrap()
            .unwrap();

        worker.run_job(&job.job_id).await.expect("run job");

        let capsule = ContextArtifactsRepository::new(&database)
            .get_response_capsule("event-response")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(capsule.generator.as_deref(), Some("heuristic_parts_tags"));
        assert!(capsule
            .summary
            .as_deref()
            .unwrap_or_default()
            .contains("Event Sourcing"));
        let keywords = json_array(capsule.keywords_json.as_deref());
        assert!(keywords.contains(&"event sourcing".to_string()));
        assert!(keywords.contains(&"cqrs".to_string()));
        assert!(keywords.contains(&"event store".to_string()));
        assert!(keywords.contains(&"replay".to_string()));
        let key_points = json_array(capsule.key_points_json.as_deref());
        assert!(key_points.iter().any(|point| point.contains("Decision:")));
        assert!(key_points.iter().any(|point| point.contains("Constraint:")));
        assert!(key_points.iter().any(|point| point.contains("Risk:")));
        assert!(key_points
            .iter()
            .any(|point| point.contains("Open question:")));
        let code_refs = json_array(capsule.code_blocks_json.as_deref());
        assert_eq!(code_refs.len(), 1);
        assert!(code_refs[0].contains("codeblock-event-response-0"));
        assert!(!code_refs[0].contains("eventStore.load"));
    }

    #[tokio::test]
    async fn refinement_disabled_keeps_heuristic_artifact() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "A completed answer. It has a second point.",
            0,
            "completed",
        )
        .await;
        let provider = Arc::new(MockRefinementProvider::success());
        let worker = ContextArtifactWorker::with_refinement_provider(&database, provider.clone());
        let job = worker
            .schedule_response_capsule_job("response-1")
            .await
            .unwrap()
            .unwrap();

        worker
            .run_job_with_options(&job.job_id, ContextWorkerRunOptions::default())
            .await
            .expect("run job");

        let capsule = ContextArtifactsRepository::new(&database)
            .get_response_capsule("response-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(capsule.generator.as_deref(), Some("heuristic_parts_tags"));
        assert_eq!(provider.response_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn mock_refinement_provider_updates_response_capsule() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "A completed answer. It has a second point.",
            0,
            "completed",
        )
        .await;
        let worker = ContextArtifactWorker::with_refinement_provider(
            &database,
            Arc::new(MockRefinementProvider::success()),
        );
        let job = worker
            .schedule_response_capsule_job("response-1")
            .await
            .unwrap()
            .unwrap();

        let result = worker
            .run_job_with_options(&job.job_id, refine_options())
            .await
            .expect("run job");

        assert_eq!(result.status, "completed");
        let repository = ContextArtifactsRepository::new(&database);
        let capsule = repository
            .get_response_capsule("response-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(capsule.generator.as_deref(), Some("llm_refined"));
        assert_eq!(
            capsule.summary.as_deref(),
            Some("Refined response summary.")
        );
        let events = repository
            .list_events_for_artifact("response_capsule", "capsule-response-1")
            .await
            .unwrap();
        assert!(events
            .iter()
            .any(|event| event.event_type == "artifact.refinement_ready"));
    }

    #[tokio::test]
    async fn forbidden_refinement_field_is_rejected_and_heuristic_stays() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "A completed answer.",
            0,
            "completed",
        )
        .await;
        let provider = MockRefinementProvider::with_response(Ok(ResponseCapsuleRefinement {
            title: "Unsafe".to_string(),
            summary: "raw_thinking should be rejected".to_string(),
            key_points: Vec::new(),
            keywords: Vec::new(),
            entities: Vec::new(),
            code_blocks: Vec::new(),
        }));
        let worker = ContextArtifactWorker::with_refinement_provider(&database, Arc::new(provider));
        let job = worker
            .schedule_response_capsule_job("response-1")
            .await
            .unwrap()
            .unwrap();

        let result = worker
            .run_job_with_options(&job.job_id, refine_options())
            .await
            .expect("run job");

        assert!(result.warnings.contains(&"refinement_rejected".to_string()));
        let repository = ContextArtifactsRepository::new(&database);
        let capsule = repository
            .get_response_capsule("response-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(capsule.generator.as_deref(), Some("heuristic_parts_tags"));
        let events = repository
            .list_events_for_artifact("response_capsule", "capsule-response-1")
            .await
            .unwrap();
        let payloads = events
            .iter()
            .filter_map(|event| event.payload_json.as_deref())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!payloads.contains("raw_thinking"));
        assert!(events
            .iter()
            .any(|event| event.event_type == "artifact.refinement_rejected"));
    }

    #[tokio::test]
    async fn provider_failure_keeps_heuristic_artifact() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "A completed answer.",
            0,
            "completed",
        )
        .await;
        let provider = MockRefinementProvider::with_response(Err(
            ArtifactRefinementError::ProviderFailed("provider unavailable".to_string()),
        ));
        let worker = ContextArtifactWorker::with_refinement_provider(&database, Arc::new(provider));
        let job = worker
            .schedule_response_capsule_job("response-1")
            .await
            .unwrap()
            .unwrap();

        let result = worker
            .run_job_with_options(&job.job_id, refine_options())
            .await
            .expect("run job");

        assert!(result.warnings.contains(&"provider_failed".to_string()));
        let capsule = ContextArtifactsRepository::new(&database)
            .get_response_capsule("response-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(capsule.generator.as_deref(), Some("heuristic_parts_tags"));
    }

    #[tokio::test]
    async fn duplicate_pending_job_is_not_created() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "Completed answer.",
            0,
            "completed",
        )
        .await;
        let worker = ContextArtifactWorker::new(&database);
        let first = worker
            .schedule_response_capsule_job("response-1")
            .await
            .expect("schedule")
            .expect("job");
        let second = worker
            .schedule_response_capsule_job("response-1")
            .await
            .expect("schedule")
            .expect("job");

        assert_eq!(first.job_id, second.job_id);
        let jobs = worker.list_jobs(Some("pending")).await.expect("list jobs");
        assert_eq!(jobs.len(), 1);
    }

    #[tokio::test]
    async fn truncated_response_can_produce_capsule() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "Partial but useful answer.",
            0,
            "truncated",
        )
        .await;

        let worker = ContextArtifactWorker::new(&database);
        let job = worker
            .schedule_response_capsule_job("response-1")
            .await
            .unwrap()
            .unwrap();
        worker.run_job(&job.job_id).await.expect("run job");

        assert!(ContextArtifactsRepository::new(&database)
            .get_response_capsule("response-1")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn failed_empty_response_does_not_create_capsule_job() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "",
            0,
            "error",
        )
        .await;

        let job = ContextArtifactWorker::new(&database)
            .schedule_response_capsule_job("response-1")
            .await
            .expect("schedule");

        assert!(job.is_none());
    }

    #[tokio::test]
    async fn checkpoint_created_after_four_assistant_responses() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        for index in 0..4 {
            let response_id = format!("response-{index}");
            insert_response(
                &database,
                &response_id,
                "loom-1",
                "assistant",
                &format!("Answer {index}. Useful detail."),
                index,
                "completed",
            )
            .await;
            let worker = ContextArtifactWorker::new(&database);
            let job = worker
                .schedule_response_capsule_job(&response_id)
                .await
                .unwrap()
                .unwrap();
            worker.run_job(&job.job_id).await.expect("run job");
        }

        let checkpoint = ContextArtifactsRepository::new(&database)
            .get_latest_checkpoint_for_loom("loom-1")
            .await
            .expect("get checkpoint");
        assert!(checkpoint.is_some());
    }

    #[tokio::test]
    async fn rolling_checkpoint_includes_topics_decisions_constraints_and_code_refs() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        let responses = [
            "# Event Sourcing\nEvent Sourcing uses Event Store and Replay.\n- Decision: Store events as the source of truth.",
            "CQRS separates command and query models.\n- Constraint: Read models must be rebuildable.",
            "Snapshot support can reduce Replay cost.\n- Risk: Snapshot cadence can hide event evolution issues.",
            "Event Store implementation note.\n```rs\nfn replay(events: &[Event]) {}\n```\n- Open question: Which projection lag is acceptable?",
        ];
        let worker = ContextArtifactWorker::new(&database);
        for (index, content) in responses.iter().enumerate() {
            let response_id = format!("event-response-{index}");
            insert_response(
                &database,
                &response_id,
                "loom-1",
                "assistant",
                content,
                index as i64,
                "completed",
            )
            .await;
            let job = worker
                .schedule_response_capsule_job(&response_id)
                .await
                .unwrap()
                .unwrap();
            worker.run_job(&job.job_id).await.expect("run job");
        }

        let checkpoint = ContextArtifactsRepository::new(&database)
            .get_latest_checkpoint_for_loom("loom-1")
            .await
            .unwrap()
            .unwrap();
        assert!(checkpoint
            .summary
            .contains("Covered response range: event-response-0..event-response-3"));
        assert!(checkpoint.summary.contains("Top topics:"));
        assert!(checkpoint.summary.contains("Event Sourcing"));
        assert!(checkpoint.summary.contains("Code block refs:"));
        assert!(json_array(checkpoint.decisions_json.as_deref())
            .iter()
            .any(|item| item.contains("source of truth")));
        assert!(json_array(checkpoint.constraints_json.as_deref())
            .iter()
            .any(|item| item.contains("rebuildable")));
        assert!(json_array(checkpoint.open_questions_json.as_deref())
            .iter()
            .any(|item| item.contains("Risk unresolved") || item.contains("projection lag")));
        assert!(json_array(checkpoint.references_json.as_deref())
            .iter()
            .any(|item| item.contains("codeblock-event-response-3-0")));
    }

    #[tokio::test]
    async fn checkpoint_refinement_updates_checkpoint_safely() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        let worker = ContextArtifactWorker::with_refinement_provider(
            &database,
            Arc::new(MockRefinementProvider::success()),
        );
        for index in 0..4 {
            let response_id = format!("response-{index}");
            insert_response(
                &database,
                &response_id,
                "loom-1",
                "assistant",
                &format!("Answer {index}. Useful detail."),
                index,
                "completed",
            )
            .await;
            let job = worker
                .schedule_response_capsule_job(&response_id)
                .await
                .unwrap()
                .unwrap();
            worker
                .run_job_with_options(&job.job_id, refine_options())
                .await
                .expect("run job");
        }

        let checkpoint = ContextArtifactsRepository::new(&database)
            .get_latest_checkpoint_for_loom("loom-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(checkpoint.summary, "Refined checkpoint summary.");
        assert!(checkpoint
            .decisions_json
            .as_deref()
            .unwrap_or_default()
            .contains("Decision"));
    }

    #[tokio::test]
    async fn checkpoint_not_created_for_tiny_loom() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "Answer.",
            0,
            "completed",
        )
        .await;
        let worker = ContextArtifactWorker::new(&database);
        let job = worker
            .schedule_response_capsule_job("response-1")
            .await
            .unwrap()
            .unwrap();
        worker.run_job(&job.job_id).await.expect("run job");

        let checkpoint = ContextArtifactsRepository::new(&database)
            .get_latest_checkpoint_for_loom("loom-1")
            .await
            .expect("get checkpoint");
        assert!(checkpoint.is_none());
    }

    #[tokio::test]
    async fn weft_origin_context_created_when_origin_metadata_exists() {
        let database = test_database().await;
        seed_loom(&database, "origin-loom", "loom", None, None).await;
        insert_response(
            &database,
            "origin-response",
            "origin-loom",
            "assistant",
            "Origin answer.",
            0,
            "completed",
        )
        .await;
        let origin_capsule = build_response_capsule(
            &ResponseRepository::new(&database)
                .get_response("origin-response")
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        ContextArtifactsRepository::new(&database)
            .upsert_response_capsule(&origin_capsule)
            .await
            .unwrap();
        seed_loom(
            &database,
            "weft-loom",
            "weft",
            Some("origin-loom"),
            Some("origin-response"),
        )
        .await;
        insert_response(
            &database,
            "weft-response",
            "weft-loom",
            "assistant",
            "Weft answer.",
            0,
            "completed",
        )
        .await;

        let worker = ContextArtifactWorker::new(&database);
        let job = worker
            .schedule_response_capsule_job("weft-response")
            .await
            .unwrap()
            .unwrap();
        worker.run_job(&job.job_id).await.expect("run job");

        let origin_context = ContextArtifactsRepository::new(&database)
            .get_weft_origin_context("weft-loom")
            .await
            .unwrap()
            .expect("origin context");
        assert_eq!(origin_context.origin_response_id, "origin-response");
        assert!(origin_context.origin_capsule_id.is_some());
        assert!(origin_context
            .origin_summary
            .as_deref()
            .unwrap_or_default()
            .contains("Origin answer"));
    }

    #[tokio::test]
    async fn raw_thinking_keys_rejected_from_worker_artifacts() {
        let response = crate::storage::repositories::responses::ResponseRecord {
            response_id: "response-raw".to_string(),
            loom_id: "loom-1".to_string(),
            role: "assistant".to_string(),
            content: "raw_thinking must not persist".to_string(),
            title: None,
            code: None,
            canonical_uri: None,
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
            sequence_index: 0,
            metadata_json: Some(serde_json::json!({ "status": "completed" }).to_string()),
        };
        let error = build_response_capsule(&response).expect_err("raw thinking rejected");

        assert!(error.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn run_next_processes_one_pending_job() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "Answer one.",
            0,
            "completed",
        )
        .await;
        insert_response(
            &database,
            "response-2",
            "loom-1",
            "assistant",
            "Answer two.",
            1,
            "completed",
        )
        .await;
        let worker = ContextArtifactWorker::new(&database);
        worker
            .schedule_response_capsule_job("response-1")
            .await
            .unwrap();
        worker
            .schedule_response_capsule_job("response-2")
            .await
            .unwrap();

        let result = worker
            .run_next_pending_job()
            .await
            .unwrap()
            .expect("run next");
        assert_eq!(result.status, "completed");
        let pending = worker.list_jobs(Some("pending")).await.unwrap();
        assert_eq!(pending.len(), 1);
    }

    #[tokio::test]
    async fn run_next_false_does_not_call_refinement_provider() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "Answer one.",
            0,
            "completed",
        )
        .await;
        let provider = Arc::new(MockRefinementProvider::success());
        let worker = ContextArtifactWorker::with_refinement_provider(&database, provider.clone());
        worker
            .schedule_response_capsule_job("response-1")
            .await
            .unwrap();

        worker
            .run_next_pending_job_with_options(ContextWorkerRunOptions {
                refine_with_llm: false,
            })
            .await
            .unwrap()
            .expect("run next");

        assert_eq!(provider.response_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn run_next_true_calls_refinement_provider() {
        let database = test_database().await;
        seed_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(
            &database,
            "response-1",
            "loom-1",
            "assistant",
            "Answer one.",
            0,
            "completed",
        )
        .await;
        let provider = Arc::new(MockRefinementProvider::success());
        let worker = ContextArtifactWorker::with_refinement_provider(&database, provider.clone());
        worker
            .schedule_response_capsule_job("response-1")
            .await
            .unwrap();

        worker
            .run_next_pending_job_with_options(refine_options())
            .await
            .unwrap()
            .expect("run next");

        assert_eq!(provider.response_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn explicit_job_runner_processes_existing_job() {
        let database = test_database().await;
        let repository = ContextArtifactsRepository::new(&database);
        repository
            .insert_job(&NewContextBuildJob {
                job_id: "job-unsupported".to_string(),
                job_type: "unknown".to_string(),
                loom_id: None,
                response_id: None,
                status: "pending".to_string(),
                priority: 0,
                error: None,
                created_at: "1".to_string(),
            })
            .await
            .unwrap();
        let error = ContextArtifactWorker::new(&database)
            .run_job("job-unsupported")
            .await
            .expect_err("unsupported job fails");
        assert!(error.to_string().contains("unsupported context job type"));
    }

    async fn seed_loom(
        database: &crate::storage::db::Database,
        loom_id: &str,
        kind: &str,
        origin_loom_id: Option<&str>,
        origin_response_id: Option<&str>,
    ) {
        LoomRepository::new(database)
            .insert_loom(&NewLoom {
                loom_id: loom_id.to_string(),
                title: "Test Loom".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: kind.to_string(),
                origin_loom_id: origin_loom_id.map(str::to_string),
                origin_response_id: origin_response_id.map(str::to_string),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");
    }

    async fn insert_response(
        database: &crate::storage::db::Database,
        response_id: &str,
        loom_id: &str,
        role: &str,
        content: &str,
        sequence_index: i64,
        status: &str,
    ) {
        ResponseRepository::new(database)
            .insert_response(&NewResponse {
                response_id: response_id.to_string(),
                loom_id: loom_id.to_string(),
                role: role.to_string(),
                content: content.to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "2026-05-08T00:00:01Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
                sequence_index,
                metadata_json: Some(serde_json::json!({ "status": status }).to_string()),
            })
            .await
            .expect("insert response");
    }

    fn refine_options() -> ContextWorkerRunOptions {
        ContextWorkerRunOptions {
            refine_with_llm: true,
        }
    }

    fn json_array(value: Option<&str>) -> Vec<String> {
        value
            .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
            .unwrap_or_default()
    }

    struct MockRefinementProvider {
        response_result: Result<ResponseCapsuleRefinement, ArtifactRefinementError>,
        checkpoint_result: Result<LoomCheckpointRefinement, ArtifactRefinementError>,
        response_calls: AtomicUsize,
        checkpoint_calls: AtomicUsize,
    }

    impl MockRefinementProvider {
        fn success() -> Self {
            Self {
                response_result: Ok(ResponseCapsuleRefinement {
                    title: "Refined response".to_string(),
                    summary: "Refined response summary.".to_string(),
                    key_points: vec!["Refined point".to_string()],
                    keywords: vec!["refined".to_string()],
                    entities: vec!["Loom".to_string()],
                    code_blocks: vec![CodeBlockRefinement {
                        language: Some("rust".to_string()),
                        summary: "No code block output.".to_string(),
                    }],
                }),
                checkpoint_result: Ok(LoomCheckpointRefinement {
                    summary: "Refined checkpoint summary.".to_string(),
                    decisions: vec!["Decision".to_string()],
                    constraints: vec!["Constraint".to_string()],
                    open_questions: vec!["Open question".to_string()],
                    entities: vec!["Loom".to_string()],
                    wefts: Vec::new(),
                    references: Vec::new(),
                }),
                response_calls: AtomicUsize::new(0),
                checkpoint_calls: AtomicUsize::new(0),
            }
        }

        fn with_response(
            response_result: Result<ResponseCapsuleRefinement, ArtifactRefinementError>,
        ) -> Self {
            Self {
                response_result,
                ..Self::success()
            }
        }
    }

    impl ArtifactRefinementProvider for MockRefinementProvider {
        fn refine_response_capsule<'a>(
            &'a self,
            input: ResponseCapsuleRefinementInput,
        ) -> ArtifactRefinementFuture<'a, ResponseCapsuleRefinement> {
            self.response_calls.fetch_add(1, Ordering::SeqCst);
            assert!(!input.content.contains("raw_thinking"));
            let result = self.response_result.clone();
            Box::pin(async move { result })
        }

        fn refine_loom_checkpoint<'a>(
            &'a self,
            input: LoomCheckpointRefinementInput,
        ) -> ArtifactRefinementFuture<'a, LoomCheckpointRefinement> {
            self.checkpoint_calls.fetch_add(1, Ordering::SeqCst);
            assert!(!input.heuristic_summary.contains("raw_thinking"));
            let result = self.checkpoint_result.clone();
            Box::pin(async move { result })
        }
    }
}
