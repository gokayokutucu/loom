#[cfg(test)]
use crate::providers::types::{sanitize_provider_text, OllamaStreamChunk, OllamaWireChunk};
use crate::{
    capabilities::repository::NewModelRuntimeBenchmark,
    config::LoomServiceConfig,
    context::{
        manager::ContextManager,
        readiness::{ContextReadinessGate, ContextReadinessInput},
        types::{
            AttachedReferenceInput, AttachmentContext, BuildContextInput, ContextMessage,
            ContextMessageRole, ContextSource, ReferenceContext,
            ResponseMode as ContextResponseMode,
        },
    },
    events::types::{service_event, LoomServiceEvent},
    orchestration::{
        answer_plan::{AnswerPlan, PlannerInput, PlannerReference, ResponseMode},
        deep_synthesis::{
            contains_forbidden_raw_thinking, plan_deep_synthesis, strategy_input_from_request,
            DeepSynthesisDraft, DeepSynthesisRequest, DeepSynthesisStepStatus,
            DeepSynthesisWorkerRole,
        },
        planner::DeterministicPlanner,
        progress::OrchestrationProgressEvent,
        workflow::{RepositoryWorkflowRunner, WorkflowRun, WorkflowRunner},
    },
    providers::{
        contract::{
            ProviderContractEvent, ProviderContractMessage, ProviderContractMessageRole,
            ProviderContractOptions, ProviderContractRequest, ProviderUsageMetadata,
        },
        ollama::OllamaRuntime,
        pipeline::ProviderPipeline,
        types::{
            done_reason_is_length, OllamaChatRequest, OllamaMessage, OllamaOptions,
            OllamaRuntimeError, OllamaRuntimeErrorKind, ProviderError, ProviderErrorKind,
        },
    },
    runtime::OperationKind,
    storage::repositories::{
        attachments::AttachmentRepository,
        looms::{LoomMetadataUpdate, LoomRepository},
        memory::MemoryRepository,
        responses::{NewResponse, ResponseRecord, ResponseRepository},
    },
};
use async_stream::stream;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    Json,
};
use futures_util::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    convert::Infallible,
    time::{Duration, Instant},
};
use tokio::time::sleep;

#[cfg(test)]
const DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES: usize = 24;
const DEFAULT_MAX_RECENT_CONTEXT_PAIRS: usize = 20;
const MAX_MEMORY_CONTEXT_MESSAGES: usize = 8;
const MAX_MEMORY_CONTEXT_CHARS: usize = 1_200;
const FORBIDDEN_CONTEXT_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];
const AUTO_ROUTER_NUM_CTX: u32 = 1_024;
const AUTO_ROUTER_NUM_PREDICT: u32 = 128;

pub async fn plan(Json(input): Json<PlannerInput>) -> Json<AnswerPlan> {
    Json(DeterministicPlanner::plan(input))
}

pub async fn dry_run(
    State(state): State<crate::api::state::AppState>,
    Json(input): Json<OrchestrationDryRunInput>,
) -> Result<Json<OrchestrationDryRunResponse>, (StatusCode, Json<OrchestrationApiError>)> {
    let planner_input = input.planner_input;
    let plan = DeterministicPlanner::plan(planner_input.clone());
    if input.persist {
        let runner = RepositoryWorkflowRunner::new(&state.database);
        let metadata_json = serde_json::to_string(&plan).map_err(api_error)?;
        let run = runner
            .create_run(planner_input.loom_id, None, Some(metadata_json))
            .await
            .map_err(api_error)?;
        let run = runner
            .mark_stage_running(&run.run_id, "orchestrate")
            .await
            .map_err(api_error)?;
        let progress = OrchestrationProgressEvent::from_run(&run);
        return Ok(Json(OrchestrationDryRunResponse {
            answer_plan: plan,
            workflow_run: run,
            progress,
        }));
    }

    let mut runner = WorkflowRunner::default();
    let run = runner.create_run(planner_input.loom_id, None);
    runner.mark_stage_running("orchestrate");
    let run = runner.current_progress().unwrap_or(run);
    let progress = OrchestrationProgressEvent::from_run(&run);

    Ok(Json(OrchestrationDryRunResponse {
        answer_plan: plan,
        workflow_run: run,
        progress,
    }))
}

pub async fn execute(
    State(state): State<crate::api::state::AppState>,
    Json(input): Json<OrchestrationExecuteInput>,
) -> Response {
    if state.restart.is_draining() {
        return runtime_draining_response();
    }
    Sse::new(execute_stream(state, input))
        .keep_alive(KeepAlive::default())
        .into_response()
}

pub async fn regenerate_response(
    State(state): State<crate::api::state::AppState>,
    Path(response_id): Path<String>,
    Json(input): Json<RegenerateResponseInput>,
) -> Response {
    if state.restart.is_draining() {
        return runtime_draining_response();
    }
    Sse::new(regenerate_response_stream(state, response_id, input))
        .keep_alive(KeepAlive::default())
        .into_response()
}

pub async fn retry_response(
    State(state): State<crate::api::state::AppState>,
    Path(response_id): Path<String>,
    Json(input): Json<RetryResponseInput>,
) -> Response {
    if state.restart.is_draining() {
        return runtime_draining_response();
    }
    Sse::new(retry_response_stream(state, response_id, input))
        .keep_alive(KeepAlive::default())
        .into_response()
}

pub async fn cancel(
    State(state): State<crate::api::state::AppState>,
    Path(run_id): Path<String>,
) -> Json<OrchestrationCancelResponse> {
    let cancelled = ProviderPipeline::new(state.ollama.clone()).cancel_generation(&run_id);

    // Persist the cancelled status to the database immediately so that if the
    // app is closed before the streaming workflow finalises, the response is not
    // seen as "streaming" on the next app open (which would trigger the reload
    // recovery path and show the Stop button permanently).
    let runner = RepositoryWorkflowRunner::new(&state.database);
    if let Ok(_run) = runner.current_progress(&run_id).await {
        // Mark the workflow run itself as cancelled so generation_status()
        // falls back to WorkflowStageStatus::Cancelled → "cancelled".
        let _ = runner.mark_stage_cancelled(&run_id, "orchestrate").await;

        // Also write "cancelled" into the response metadata so the terminal-
        // state fast-path in generation_status() fires before the run status.
        let assistant_id = format!("response-{}-assistant", run_id);
        let response_repo = ResponseRepository::new(&state.database);
        // Only update if the response exists and is not already in a terminal state.
        if let Ok(Some(existing)) = response_repo.get_response(&assistant_id).await {
            let current_status = response_metadata(&existing)
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !matches!(
                current_status.as_str(),
                "completed" | "cancelled" | "truncated" | "error"
            ) {
                let _ = response_repo
                    .update_response_status(&assistant_id, "cancelled", None, None, None)
                    .await;
            }
        }
    }

    Json(OrchestrationCancelResponse {
        run_id: run_id.clone(),
        cancelled,
    })
}

pub async fn deep_synthesis(
    State(state): State<crate::api::state::AppState>,
    Json(input): Json<DeepSynthesisRequest>,
) -> Response {
    if state.restart.is_draining() {
        return runtime_draining_response();
    }
    Sse::new(deep_synthesis_stream(state, input))
        .keep_alive(KeepAlive::default())
        .into_response()
}

pub async fn deep_synthesis_eval(
    State(state): State<crate::api::state::AppState>,
    Json(input): Json<DeepSynthesisEvalRequest>,
) -> Result<Json<DeepSynthesisEvalSummary>, (StatusCode, Json<OrchestrationApiError>)> {
    if state.restart.is_draining() {
        return Err(runtime_draining_error());
    }
    let started = Instant::now();
    let prompt = eval_prompt(&input.prompt).to_string();
    let requested_mode = if matches!(
        input.requested_strategy,
        crate::capabilities::strategy::ExecutionStrategy::SectionedSequential
    ) {
        crate::capabilities::strategy::RequestedMode::Long
    } else {
        crate::capabilities::strategy::RequestedMode::Deep
    };
    let request = DeepSynthesisRequest {
        loom_id: None,
        prompt,
        references: Vec::new(),
        requested_mode,
        model_name: input.model.clone(),
        strategy_decision_id: None,
        strategy: None,
        max_parallelism: input.max_parallelism,
        section_count: input.section_count,
    };
    ensure_deep_synthesis_model_ready(&state.ollama, &input.model)
        .await
        .map_err(|error| api_error(error.message))?;
    let base_decision =
        resolve_service_execution_strategy(&state.database, strategy_input_from_request(&request))
            .await
            .map_err(api_error)?;
    let (decision, downgrade_reason) =
        eval_strategy_decision(input.requested_strategy, base_decision);
    let plan = plan_deep_synthesis(&request, &decision)
        .map_err(|error| api_error(format!("{}: {}", error.kind, error.message)))?;
    let run_id = format!("deep-eval-{}", unix_timestamp_millis());
    let (_cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    let draft_result = run_live_deep_synthesis_drafts(
        &state.ollama,
        &run_id,
        &request,
        &plan,
        &mut cancel_rx,
        |event_type, payload| to_sse_event(service_event(run_id.clone(), event_type, payload)),
    )
    .await;

    let (drafts, successful_draft_count, failed) = match draft_result {
        LiveDeepSynthesisDraftResult::Completed { drafts, .. } => {
            let count = drafts.len();
            (drafts, count, None)
        }
        LiveDeepSynthesisDraftResult::Failed { message, .. } => (Vec::new(), 0, Some(message)),
        LiveDeepSynthesisDraftResult::Cancelled { .. } => {
            (Vec::new(), 0, Some("cancelled".to_string()))
        }
    };

    let mut success = failed.is_none();
    let mut error_kind = failed.clone();
    let mut final_output_tokens_estimate = 0;
    if success {
        match run_live_deep_synthesis_synthesis(
            &state.ollama,
            &run_id,
            &request,
            &plan,
            &drafts,
            &mut cancel_rx,
        )
        .await
        {
            LiveSynthesisResult::Completed(answer) => {
                final_output_tokens_estimate = estimate_output_tokens(&answer);
            }
            LiveSynthesisResult::Fallback { answer, warning } => {
                final_output_tokens_estimate = estimate_output_tokens(&answer);
                error_kind = Some(warning);
            }
            LiveSynthesisResult::Failed(message) => {
                success = false;
                error_kind = Some(message);
            }
            LiveSynthesisResult::Cancelled => {
                success = false;
                error_kind = Some("cancelled".to_string());
            }
        }
    }

    let total_latency_ms = started.elapsed().as_millis() as i64;
    let tokens_per_second = if success && total_latency_ms > 0 && final_output_tokens_estimate > 0 {
        Some(final_output_tokens_estimate as f64 / (total_latency_ms as f64 / 1000.0))
    } else {
        None
    };
    let summary = DeepSynthesisEvalSummary {
        model: input.model.clone(),
        prompt_label: input.prompt,
        strategy_requested: input.requested_strategy,
        strategy_used: plan.strategy,
        downgrade_reason,
        max_parallelism: plan.max_parallelism,
        draft_count: plan.draft_workers.len().max(plan.sections.len()),
        successful_draft_count,
        first_delta_latency_ms: None,
        total_latency_ms,
        token_estimate: if final_output_tokens_estimate > 0 {
            Some(final_output_tokens_estimate)
        } else {
            None
        },
        done_reason: if success {
            Some("stop".to_string())
        } else {
            None
        },
        success,
        error_kind: error_kind.clone(),
        benchmark_recorded: input.record_benchmark.unwrap_or(true),
    };

    if summary.benchmark_recorded {
        let repo = crate::capabilities::CapabilityRepository::new(&state.database);
        let model_id = decision
            .model_id
            .clone()
            .unwrap_or_else(|| format!("ollama:{}", input.model));
        repo.insert_benchmark(&NewModelRuntimeBenchmark {
            benchmark_id: crate::capabilities::repository::new_id("deep-bench"),
            model_id,
            provider: "ollama".to_string(),
            model_name: input.model,
            prompt_kind: format!("deep_synthesis:{}", summary.strategy_used.as_str()),
            num_ctx: Some(4096),
            num_predict: Some(plan.estimated_budget),
            parallelism: plan.max_parallelism,
            first_token_latency_ms: None,
            total_latency_ms: Some(total_latency_ms),
            eval_count: summary.token_estimate,
            eval_duration_ms: Some(total_latency_ms),
            tokens_per_second,
            success,
            error_kind,
            created_at: crate::capabilities::repository::timestamp(),
        })
        .await
        .map_err(api_error)?;
    }

    Ok(Json(summary))
}

pub async fn get_run(
    State(state): State<crate::api::state::AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<WorkflowRunResponse>, (StatusCode, Json<OrchestrationApiError>)> {
    let runner = RepositoryWorkflowRunner::new(&state.database);
    let run = runner.current_progress(&run_id).await.map_err(api_error)?;
    let progress = OrchestrationProgressEvent::from_run(&run);

    Ok(Json(WorkflowRunResponse { run, progress }))
}

pub async fn get_run_status(
    State(state): State<crate::api::state::AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<GenerationRunStatusResponse>, (StatusCode, Json<OrchestrationApiError>)> {
    build_generation_status(&state.database, &run_id)
        .await
        .map(Json)
}

pub async fn get_run_events(
    State(state): State<crate::api::state::AppState>,
    Path(run_id): Path<String>,
    Query(query): Query<GenerationEventsQuery>,
) -> Result<Json<GenerationRunEventsResponse>, (StatusCode, Json<OrchestrationApiError>)> {
    build_generation_events(&state.database, &run_id, query.after.as_deref())
        .await
        .map(Json)
}

pub async fn get_run_response_state(
    State(state): State<crate::api::state::AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<GenerationResponseStateResponse>, (StatusCode, Json<OrchestrationApiError>)> {
    build_generation_response_state(&state.database, &run_id)
        .await
        .map(Json)
}

async fn build_generation_status(
    database: &crate::storage::db::Database,
    run_id: &str,
) -> Result<GenerationRunStatusResponse, (StatusCode, Json<OrchestrationApiError>)> {
    let runner = RepositoryWorkflowRunner::new(database);
    let run = runner
        .current_progress(run_id)
        .await
        .map_err(|_| not_found_error("workflow run not found"))?;
    let events_repo =
        crate::storage::repositories::orchestration::OrchestrationEventRepository::new(database);
    let events = events_repo
        .list_events_for_run(run_id)
        .await
        .map_err(api_error)?;
    let (user_response, assistant_response) = generation_responses(database, &run).await?;
    let status = generation_status(&run, assistant_response.as_ref());
    let error = generation_error_summary(&run, assistant_response.as_ref());
    let last_event = events.last();
    let updated_at = last_event
        .map(|event| event.created_at.clone())
        .or_else(|| run.finished_at.clone())
        .unwrap_or_else(|| run.started_at.clone());

    Ok(GenerationRunStatusResponse {
        run_id: run.run_id,
        status: status.clone(),
        loom_id: run.loom_id,
        user_response_id: user_response
            .as_ref()
            .map(|response| response.response_id.clone()),
        assistant_response_id: assistant_response
            .as_ref()
            .map(|response| response.response_id.clone()),
        started_at: run.started_at,
        updated_at,
        completed_at: run.finished_at,
        last_event_id: last_event.map(|event| event.event_id.clone()),
        can_resume: true,
        can_cancel: matches!(status.as_str(), "pending" | "running"),
        error,
    })
}

async fn build_generation_events(
    database: &crate::storage::db::Database,
    run_id: &str,
    after_event_id: Option<&str>,
) -> Result<GenerationRunEventsResponse, (StatusCode, Json<OrchestrationApiError>)> {
    let runner = RepositoryWorkflowRunner::new(database);
    runner
        .current_progress(run_id)
        .await
        .map_err(|_| not_found_error("workflow run not found"))?;
    let events_repo =
        crate::storage::repositories::orchestration::OrchestrationEventRepository::new(database);
    let events = events_repo
        .list_events_for_run_after(run_id, after_event_id)
        .await
        .map_err(api_error)?;
    let replay_events = events
        .into_iter()
        .map(|event| GenerationReplayEvent {
            event_id: event.event_id,
            created_at: event.created_at,
            event_kind: event.event_type,
            stage_id: event.stage_id,
            payload: event
                .payload_json
                .and_then(|payload| safe_json_payload(&payload)),
        })
        .collect::<Vec<_>>();
    let last_event_id = replay_events.last().map(|event| event.event_id.clone());

    Ok(GenerationRunEventsResponse {
        run_id: run_id.to_string(),
        events: replay_events,
        last_event_id,
        can_resume: true,
        live_tail_supported: false,
    })
}

async fn build_generation_response_state(
    database: &crate::storage::db::Database,
    run_id: &str,
) -> Result<GenerationResponseStateResponse, (StatusCode, Json<OrchestrationApiError>)> {
    let runner = RepositoryWorkflowRunner::new(database);
    let run = runner
        .current_progress(run_id)
        .await
        .map_err(|_| not_found_error("workflow run not found"))?;
    let (user_response, assistant_response) = generation_responses(database, &run).await?;
    let status = generation_status(&run, assistant_response.as_ref());

    Ok(GenerationResponseStateResponse {
        run_id: run.run_id,
        loom_id: run.loom_id,
        user_response: user_response.as_ref().map(generation_response_summary),
        assistant_response: assistant_response.as_ref().map(generation_response_summary),
        status,
        can_resume: true,
        live_tail_supported: false,
    })
}

async fn generation_responses(
    database: &crate::storage::db::Database,
    run: &WorkflowRun,
) -> Result<
    (Option<ResponseRecord>, Option<ResponseRecord>),
    (StatusCode, Json<OrchestrationApiError>),
> {
    let repository = ResponseRepository::new(database);
    let assistant_id = format!("response-{}-assistant", run.run_id);
    let assistant_response = repository
        .get_response(&assistant_id)
        .await
        .map_err(api_error)?;
    let user_response_id = assistant_response
        .as_ref()
        .and_then(|response| {
            response_metadata(response)
                .get("regeneratedFromUserResponseId")
                .cloned()
        })
        .and_then(|value| value.as_str().map(str::to_string))
        .or_else(|| Some(format!("response-{}-user", run.run_id)))
        .or_else(|| run.response_id.clone());
    let user_response = match user_response_id {
        Some(response_id) => repository
            .get_response(&response_id)
            .await
            .map_err(api_error)?,
        None => None,
    };

    Ok((user_response, assistant_response))
}

fn generation_response_summary(response: &ResponseRecord) -> GenerationResponseSummary {
    let metadata = response_metadata(response);
    GenerationResponseSummary {
        response_id: response.response_id.clone(),
        loom_id: response.loom_id.clone(),
        role: response.role.clone(),
        content: response.content.clone(),
        sequence_index: response.sequence_index,
        status: metadata
            .get("status")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        metadata: Some(Value::Object(metadata)),
        updated_at: response.updated_at.clone(),
    }
}

fn generation_status(run: &WorkflowRun, assistant_response: Option<&ResponseRecord>) -> String {
    if let Some(status) = assistant_response
        .and_then(|response| response_metadata(response).get("status").cloned())
        .and_then(|value| value.as_str().map(str::to_string))
        .filter(|status| {
            matches!(
                status.as_str(),
                "completed" | "error" | "cancelled" | "truncated"
            )
        })
    {
        return match status.as_str() {
            "error" => "failed".to_string(),
            _ => status,
        };
    }
    match run.status {
        crate::orchestration::workflow::WorkflowStageStatus::Pending => "pending",
        crate::orchestration::workflow::WorkflowStageStatus::Running => "running",
        crate::orchestration::workflow::WorkflowStageStatus::Done => "completed",
        crate::orchestration::workflow::WorkflowStageStatus::Failed => "failed",
        crate::orchestration::workflow::WorkflowStageStatus::Cancelled => "cancelled",
        crate::orchestration::workflow::WorkflowStageStatus::Skipped => "completed",
    }
    .to_string()
}

fn generation_error_summary(
    run: &WorkflowRun,
    assistant_response: Option<&ResponseRecord>,
) -> Option<GenerationErrorSummary> {
    let metadata = assistant_response
        .map(response_metadata)
        .unwrap_or_default();
    if let Some(error) = metadata.get("error").and_then(|value| value.as_object()) {
        let kind = error
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("provider_error")
            .to_string();
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        return Some(GenerationErrorSummary { kind, message });
    }
    run.stages
        .iter()
        .find(|stage| {
            matches!(
                stage.status,
                crate::orchestration::workflow::WorkflowStageStatus::Failed
            )
        })
        .map(|stage| GenerationErrorSummary {
            kind: "provider_error".to_string(),
            message: Some(format!("{} failed", stage.id)),
        })
}

fn response_metadata(response: &ResponseRecord) -> serde_json::Map<String, Value> {
    response
        .metadata_json
        .as_deref()
        .and_then(safe_json_payload)
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn safe_json_payload(payload: &str) -> Option<Value> {
    serde_json::from_str::<Value>(payload)
        .ok()
        .map(sanitize_generation_value)
}

fn sanitize_generation_value(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .filter_map(|(key, value)| {
                    if FORBIDDEN_CONTEXT_KEYS
                        .iter()
                        .any(|forbidden| key.eq_ignore_ascii_case(forbidden))
                    {
                        None
                    } else {
                        Some((key, sanitize_generation_value(value)))
                    }
                })
                .collect(),
        ),
        Value::Array(values) => {
            Value::Array(values.into_iter().map(sanitize_generation_value).collect())
        }
        other => other,
    }
}

fn api_error(error: impl ToString) -> (StatusCode, Json<OrchestrationApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(OrchestrationApiError {
            code: "ORCHESTRATION_FAILED".to_string(),
            message: error.to_string(),
        }),
    )
}

fn not_found_error(message: impl Into<String>) -> (StatusCode, Json<OrchestrationApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(OrchestrationApiError {
            code: "ORCHESTRATION_NOT_FOUND".to_string(),
            message: message.into(),
        }),
    )
}

fn runtime_draining_error() -> (StatusCode, Json<OrchestrationApiError>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(OrchestrationApiError {
            code: "runtime_draining".to_string(),
            message: "loom-service is draining and is not accepting new generation requests."
                .to_string(),
        }),
    )
}

fn runtime_draining_response() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({
            "error": "runtime_draining",
            "kind": "runtime_draining",
            "message": "loom-service is draining and is not accepting new generation requests."
        })),
    )
        .into_response()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationDryRunResponse {
    pub answer_plan: AnswerPlan,
    pub workflow_run: WorkflowRun,
    pub progress: OrchestrationProgressEvent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationDryRunInput {
    #[serde(flatten)]
    pub planner_input: PlannerInput,
    #[serde(default)]
    pub persist: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationExecuteInput {
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub references: Vec<PlannerReference>,
    /// Full LoomLink array sent by the frontend.  Stored verbatim in
    /// metadata.questionReferences so that badge and presentationMode
    /// survive app restart.  The renderer reads this path first; the
    /// planner-format `references` field is kept as a fallback.
    #[serde(default)]
    pub question_references: Option<serde_json::Value>,
    pub response_mode: ResponseMode,
    pub model: String,
    #[serde(default)]
    pub provider_profile_id: Option<String>,
    pub options: Option<OrchestrationExecuteOptions>,
    #[serde(default)]
    pub persist_workflow: bool,
    #[serde(default)]
    pub regenerate_from_response_id: Option<String>,
    #[serde(default)]
    pub stale_assistant_response_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationExecuteOptions {
    pub num_ctx: Option<u32>,
    pub num_predict: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegenerateResponseInput {
    pub response_mode: ResponseMode,
    #[serde(default)]
    pub replace_stale: bool,
    #[serde(default = "default_regenerate_source")]
    pub source: String,
    pub model: Option<String>,
    #[serde(default)]
    pub provider_profile_id: Option<String>,
    pub options: Option<OrchestrationExecuteOptions>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryResponseInput {
    pub response_mode: ResponseMode,
    #[serde(default)]
    pub soft_delete_downstream: bool,
    #[serde(default = "default_retry_reason")]
    pub reason: String,
    pub model: Option<String>,
    #[serde(default)]
    pub provider_profile_id: Option<String>,
    pub options: Option<OrchestrationExecuteOptions>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationCancelResponse {
    pub run_id: String,
    pub cancelled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunResponse {
    pub run: WorkflowRun,
    pub progress: OrchestrationProgressEvent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationEventsQuery {
    #[serde(default)]
    pub after: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRunStatusResponse {
    pub run_id: String,
    pub status: String,
    pub loom_id: Option<String>,
    pub user_response_id: Option<String>,
    pub assistant_response_id: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub last_event_id: Option<String>,
    pub can_resume: bool,
    pub can_cancel: bool,
    pub error: Option<GenerationErrorSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRunEventsResponse {
    pub run_id: String,
    pub events: Vec<GenerationReplayEvent>,
    pub last_event_id: Option<String>,
    pub can_resume: bool,
    pub live_tail_supported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationReplayEvent {
    pub event_id: String,
    pub created_at: String,
    pub event_kind: String,
    pub stage_id: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResponseStateResponse {
    pub run_id: String,
    pub loom_id: Option<String>,
    pub user_response: Option<GenerationResponseSummary>,
    pub assistant_response: Option<GenerationResponseSummary>,
    pub status: String,
    pub can_resume: bool,
    pub live_tail_supported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResponseSummary {
    pub response_id: String,
    pub loom_id: String,
    pub role: String,
    pub content: String,
    pub sequence_index: i64,
    pub status: Option<String>,
    pub metadata: Option<Value>,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationErrorSummary {
    pub kind: String,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationApiError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSynthesisEvalRequest {
    pub model: String,
    pub prompt: DeepSynthesisEvalPrompt,
    pub requested_strategy: crate::capabilities::strategy::ExecutionStrategy,
    pub max_parallelism: Option<i64>,
    pub section_count: Option<usize>,
    pub record_benchmark: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeepSynthesisEvalPrompt {
    ShortFactual,
    LongForm,
    Synthesis,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSynthesisEvalSummary {
    pub model: String,
    pub prompt_label: DeepSynthesisEvalPrompt,
    pub strategy_requested: crate::capabilities::strategy::ExecutionStrategy,
    pub strategy_used: crate::capabilities::strategy::ExecutionStrategy,
    pub downgrade_reason: Option<String>,
    pub max_parallelism: i64,
    pub draft_count: usize,
    pub successful_draft_count: usize,
    pub first_delta_latency_ms: Option<i64>,
    pub total_latency_ms: i64,
    pub token_estimate: Option<i64>,
    pub done_reason: Option<String>,
    pub success: bool,
    pub error_kind: Option<String>,
    pub benchmark_recorded: bool,
}

#[cfg(test)]
fn parse_ndjson_bytes(
    buffer: &mut String,
    bytes: &[u8],
) -> Result<Vec<OllamaStreamChunk>, OllamaRuntimeError> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::StreamParseError,
            "Ollama returned non-UTF8 stream data.",
            true,
        )
    })?;
    buffer.push_str(text);

    let mut chunks = Vec::new();
    while let Some(newline_index) = buffer.find('\n') {
        let line = buffer[..newline_index].trim().to_string();
        buffer.replace_range(..=newline_index, "");
        if line.is_empty() {
            continue;
        }
        chunks.push(parse_ollama_line(&line)?);
    }

    Ok(chunks)
}

#[cfg(test)]
fn parse_ollama_line(line: &str) -> Result<OllamaStreamChunk, OllamaRuntimeError> {
    let wire = serde_json::from_str::<OllamaWireChunk>(line).map_err(|_| {
        OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::StreamParseError,
            "Ollama returned malformed NDJSON.",
            true,
        )
    })?;
    // Ollama sends {"error":"..."} when generation fails (e.g. context too large,
    // model error). Surface this as a provider error rather than silently swallowing it.
    if let Some(ref error_text) = wire.error {
        let safe_message = sanitize_provider_text(error_text);
        return Err(OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::Unknown,
            format!("Ollama returned an error: {safe_message}"),
            false,
        ));
    }
    Ok(OllamaStreamChunk::from(wire))
}

fn to_sse_event(event: LoomServiceEvent) -> Event {
    Event::default()
        .event(event.event_type.clone())
        .json_data(event)
        .unwrap_or_else(|_| {
            Event::default()
                .event("response.error")
                .data("{\"message\":\"failed to serialize event\"}")
        })
}

fn progress_event(run_id: &str, run: &WorkflowRun) -> Event {
    to_sse_event(service_event(
        run_id.to_string(),
        "orchestration.progress",
        serde_json::to_value(OrchestrationProgressEvent::from_run(run))
            .unwrap_or_else(|_| json!({ "runId": run_id })),
    ))
}

fn workflow_error_event(run_id: &str, stage: &str, message: String) -> Event {
    to_sse_event(service_event(
        run_id.to_string(),
        "response.error",
        json!({
            "runId": run_id,
            "stage": stage,
            "kind": "workflow_error",
            "message": message
        }),
    ))
}

#[derive(Debug, Clone)]
struct PersistedResponseLifecycle {
    loom_id: String,
    user_response_id: String,
    assistant_response_id: String,
    assistant_content: String,
    updated_loom_title: Option<String>,
}

impl PersistedResponseLifecycle {
    fn event_payload(&self) -> Value {
        json!({
            "loomId": self.loom_id,
            "userResponseId": self.user_response_id,
            "assistantResponseId": self.assistant_response_id,
            "loomTitle": self.updated_loom_title,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
struct AutoRouterDecision {
    thinking_required: bool,
    reason: String,
    confidence: Option<f64>,
    fallback_used: bool,
    error_kind: Option<String>,
    provider: String,
    model: String,
}

impl AutoRouterDecision {
    fn resolved_mode(&self) -> ResponseMode {
        if self.thinking_required {
            ResponseMode::Thinking
        } else {
            ResponseMode::Instant
        }
    }
}

#[derive(Debug, Clone)]
struct ResponseModeResolution {
    requested_response_mode: ResponseMode,
    resolved_response_mode: ResponseMode,
    auto_router: Option<AutoRouterDecision>,
    capability_downgrade_reason: Option<String>,
}

impl ResponseModeResolution {
    fn passthrough(mode: ResponseMode) -> Self {
        Self {
            requested_response_mode: mode.clone(),
            resolved_response_mode: mode,
            auto_router: None,
            capability_downgrade_reason: None,
        }
    }
}

async fn create_persisted_response_lifecycle(
    database: &crate::storage::db::Database,
    input: &OrchestrationExecuteInput,
    run_id: &str,
    answer_plan: &AnswerPlan,
    mode_resolution: &ResponseModeResolution,
) -> Result<Option<PersistedResponseLifecycle>, crate::error::ServiceError> {
    let Some(loom_id) = input.loom_id.clone() else {
        return Ok(None);
    };

    let repository = ResponseRepository::new(database);
    let now = timestamp();
    let assistant_response_id = format!("response-{run_id}-assistant");
    if let Some(regenerate_from_response_id) = input.regenerate_from_response_id.as_deref() {
        let user = repository
            .get_response(regenerate_from_response_id)
            .await?
            .ok_or_else(|| {
                crate::error::ServiceError::storage("regenerate user Response not found")
            })?;
        if user.role != "user" {
            return Err(crate::error::ServiceError::storage(
                "regeneration requires a user Response",
            ));
        }
        if user.loom_id != loom_id {
            return Err(crate::error::ServiceError::storage(
                "regenerate user Response does not belong to the target Loom",
            ));
        }
        let assistant_metadata = json!({
            "source": input.source.as_deref().unwrap_or("prompt_edit_regenerate"),
            "status": "streaming",
            "workflowRunId": run_id,
            "model": input.model,
            "responseMode": mode_resolution.resolved_response_mode,
            "requestedResponseMode": mode_resolution.requested_response_mode,
            "resolvedResponseMode": mode_resolution.resolved_response_mode,
            "autoRouter": auto_router_metadata(mode_resolution),
            "capabilityDowngradeReason": mode_resolution.capability_downgrade_reason,
            "options": input.options,
            "regeneratedFromUserResponseId": user.response_id,
            "replacesStaleResponseId": input.stale_assistant_response_id,
            "answerPlan": answer_plan_summary(answer_plan),
        })
        .to_string();

        repository
            .insert_responses_if_missing_at_next_sequence(vec![NewResponse {
                response_id: assistant_response_id.clone(),
                loom_id: loom_id.clone(),
                role: "assistant".to_string(),
                content: String::new(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: now.clone(),
                updated_at: now,
                sequence_index: 0,
                metadata_json: Some(assistant_metadata),
            }])
            .await?;

        return Ok(Some(PersistedResponseLifecycle {
            loom_id,
            user_response_id: user.response_id,
            assistant_response_id,
            assistant_content: String::new(),
            updated_loom_title: None,
        }));
    }

    let user_response_id = format!("response-{run_id}-user");
    let source = input.source.as_deref().unwrap_or("orchestration_execute");
    let user_metadata = json!({
        "source": source,
        "workflowRunId": run_id,
        "answerPlan": answer_plan_summary(answer_plan),
        "references": input.references,
        // Full LoomLink array from the frontend.  The reload path reads
        // metadata.questionReferences first (via questionReferencesFromRow)
        // and preserves badge + presentationMode so attached-card vs
        // inline-chip rendering survives app restart.
        "questionReferences": input.question_references,
    })
    .to_string();
    let assistant_metadata = json!({
        "source": source,
        "status": "streaming",
        "workflowRunId": run_id,
        "model": input.model,
        "responseMode": mode_resolution.resolved_response_mode,
        "requestedResponseMode": mode_resolution.requested_response_mode,
        "resolvedResponseMode": mode_resolution.resolved_response_mode,
        "autoRouter": auto_router_metadata(mode_resolution),
        "capabilityDowngradeReason": mode_resolution.capability_downgrade_reason,
        "options": input.options,
    })
    .to_string();

    let existing_responses = repository.list_responses_for_loom(&loom_id).await?;
    repository
        .insert_response_pair_at_next_sequence(
            NewResponse {
                response_id: user_response_id.clone(),
                loom_id: loom_id.clone(),
                role: "user".to_string(),
                content: input.prompt.clone(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: now.clone(),
                updated_at: now.clone(),
                sequence_index: 0,
                metadata_json: Some(user_metadata),
            },
            NewResponse {
                response_id: assistant_response_id.clone(),
                loom_id: loom_id.clone(),
                role: "assistant".to_string(),
                content: String::new(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: now.clone(),
                updated_at: now.clone(),
                sequence_index: 0,
                metadata_json: Some(assistant_metadata),
            },
        )
        .await?;
    let updated_loom_title = maybe_title_weft_from_first_prompt(
        database,
        &loom_id,
        &input.prompt,
        existing_responses.is_empty(),
        &now,
    )
    .await?;

    Ok(Some(PersistedResponseLifecycle {
        loom_id,
        user_response_id,
        assistant_response_id,
        assistant_content: String::new(),
        updated_loom_title,
    }))
}

async fn maybe_title_weft_from_first_prompt(
    database: &crate::storage::db::Database,
    loom_id: &str,
    prompt: &str,
    is_first_visible_turn: bool,
    now: &str,
) -> Result<Option<String>, crate::error::ServiceError> {
    if !is_first_visible_turn {
        return Ok(None);
    }
    let loom_repository = LoomRepository::new(database);
    let Some(loom) = loom_repository.get_loom(loom_id).await? else {
        return Ok(None);
    };
    if loom.kind != "weft" {
        return Ok(None);
    }
    let title = weft_title_from_first_prompt(&loom.metadata_json, prompt);
    let updated = loom_repository
        .update_loom_metadata(
            loom_id,
            &LoomMetadataUpdate {
                title: Some(title.clone()),
                updated_at: now.to_string(),
                ..LoomMetadataUpdate::default()
            },
        )
        .await?;
    Ok(updated.map(|record| record.title))
}

fn weft_title_from_first_prompt(metadata_json: &Option<String>, prompt: &str) -> String {
    let is_revision = metadata_json
        .as_deref()
        .and_then(|metadata| serde_json::from_str::<Value>(metadata).ok())
        .and_then(|metadata| {
            metadata
                .get("weftKind")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .as_deref()
        == Some("revision");
    let prefix = if is_revision { "Revision: " } else { "Loom: " };
    format!("{prefix}{}", compact_prompt_title(prompt))
}

fn compact_prompt_title(prompt: &str) -> String {
    let normalized = prompt
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '*' | '#' | '-' | '•' | '|'))
        .trim()
        .to_string();
    if normalized.is_empty() {
        return "Untitled".to_string();
    }
    truncate_at_word_boundary(&normalized, 72)
}

fn truncate_at_word_boundary(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut last_boundary = 0;
    let mut end_byte = value.len();
    for (char_index, (byte_index, ch)) in value.char_indices().enumerate() {
        if char_index >= max_chars {
            end_byte = byte_index;
            break;
        }
        if ch.is_whitespace() || matches!(ch, ',' | ';' | ':' | '.' | '?' | '!') {
            last_boundary = byte_index;
        }
    }
    let cut = if last_boundary >= max_chars / 2 {
        last_boundary
    } else {
        end_byte
    };
    value[..cut]
        .trim_end_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, ',' | ';' | ':' | '.' | '-' | '—' | '–')
        })
        .to_string()
}

fn answer_plan_summary(answer_plan: &AnswerPlan) -> Value {
    json!({
        "intent": answer_plan.intent,
        "responseMode": answer_plan.response_mode,
        "useThinking": answer_plan.use_thinking,
        "modelProfile": answer_plan.model_profile,
        "contextStrategy": answer_plan.context_strategy,
        "answerStyle": answer_plan.answer_style,
        "estimatedComplexity": answer_plan.estimated_complexity,
    })
}

fn auto_router_metadata(mode_resolution: &ResponseModeResolution) -> Option<Value> {
    let decision = mode_resolution.auto_router.as_ref()?;
    Some(json!({
        "provider": decision.provider,
        "model": decision.model,
        "decision": if decision.thinking_required { "thinking" } else { "instant" },
        "reason": decision.reason,
        "confidence": decision.confidence,
        "fallbackUsed": decision.fallback_used,
        "errorKind": decision.error_kind,
    }))
}

async fn resolve_response_mode_for_execute(
    state: &crate::api::state::AppState,
    input: &OrchestrationExecuteInput,
) -> Result<ResponseModeResolution, OrchestrationApiError> {
    let config = state.config.current();
    ensure_main_model_configured(&config, input)?;
    match input.response_mode {
        ResponseMode::Instant => Ok(ResponseModeResolution::passthrough(ResponseMode::Instant)),
        ResponseMode::Thinking => Ok(apply_thinking_capability(
            ResponseModeResolution::passthrough(ResponseMode::Thinking),
            &config,
            &input.model,
        )),
        ResponseMode::Auto => {
            let quick_model = configured_quick_model(&config)?;
            let decision = match run_auto_router(state, input, &quick_model).await {
                Ok(decision) => decision,
                Err(error_kind) => {
                    fallback_auto_router_decision(input, &quick_model, Some(error_kind))
                }
            };
            Ok(apply_thinking_capability(
                ResponseModeResolution {
                    requested_response_mode: ResponseMode::Auto,
                    resolved_response_mode: decision.resolved_mode(),
                    auto_router: Some(decision),
                    capability_downgrade_reason: None,
                },
                &config,
                &input.model,
            ))
        }
    }
}

fn ensure_main_model_configured(
    config: &LoomServiceConfig,
    input: &OrchestrationExecuteInput,
) -> Result<(), OrchestrationApiError> {
    if config.providers.default_main_model.trim().is_empty() || input.model.trim().is_empty() {
        return Err(OrchestrationApiError {
            code: "main_model_required".to_string(),
            message: "Answer generation requires a configured main model.".to_string(),
        });
    }
    Ok(())
}

fn configured_quick_model(config: &LoomServiceConfig) -> Result<String, OrchestrationApiError> {
    let model = config.providers.default_quick_model.trim();
    if model.is_empty() {
        return Err(OrchestrationApiError {
            code: "quick_model_required".to_string(),
            message: "Auto mode requires a configured quick model.".to_string(),
        });
    }
    Ok(model.to_string())
}

fn apply_thinking_capability(
    mut resolution: ResponseModeResolution,
    config: &LoomServiceConfig,
    model: &str,
) -> ResponseModeResolution {
    if resolution.resolved_response_mode != ResponseMode::Thinking {
        return resolution;
    }
    if !ollama_profile_supports_thinking(config, model) {
        resolution.resolved_response_mode = ResponseMode::Instant;
        resolution.capability_downgrade_reason = Some("provider_thinking_unsupported".to_string());
    }
    resolution
}

fn ollama_profile_supports_thinking(config: &LoomServiceConfig, model: &str) -> bool {
    let mut ollama_profiles = config.providers.profiles.iter().filter(|profile| {
        profile.enabled
            && matches!(
                profile.provider_kind,
                crate::providers::config::ProviderKind::Ollama
            )
    });
    if let Some(profile) = ollama_profiles
        .clone()
        .find(|profile| profile.default_model.as_deref() == Some(model))
    {
        return profile.capabilities.supports_thinking;
    }
    ollama_profiles
        .next()
        .map(|profile| profile.capabilities.supports_thinking)
        .unwrap_or(true)
}

async fn run_auto_router(
    state: &crate::api::state::AppState,
    input: &OrchestrationExecuteInput,
    quick_model: &str,
) -> Result<AutoRouterDecision, String> {
    if std::env::var("LOOM_SERVICE_E2E_PROVIDER").ok().as_deref() == Some("event-sourcing") {
        return Ok(fallback_auto_router_decision(input, quick_model, None));
    }
    let request_id = format!("auto-router-{}", unix_timestamp_millis());
    let request = OllamaChatRequest {
        model: quick_model.to_string(),
        messages: auto_router_messages(input),
        stream: Some(false),
        think: Some(false),
        options: Some(OllamaOptions {
            num_ctx: Some(AUTO_ROUTER_NUM_CTX),
            num_predict: Some(AUTO_ROUTER_NUM_PREDICT),
            temperature: Some(0.0),
        }),
        request_id: Some(request_id),
    };
    let pipeline = ProviderPipeline::new(state.ollama.clone());
    let provider_request = provider_request_from_ollama_request(
        &pipeline,
        &request,
        json!({
            "source": "orchestration.auto_router",
            "responseMode": input.response_mode,
        }),
        json!({
            "contextBuilt": false,
            "router": "auto",
        }),
    );
    let visible = collect_provider_pipeline_text(&pipeline, provider_request)
        .await
        .map_err(|error| format!("{:?}", error.kind))?;
    let visible = visible.trim();
    if visible.is_empty() {
        return Err("router_missing_visible_content".to_string());
    }
    parse_auto_router_decision(&visible, quick_model)
        .ok_or_else(|| "router_invalid_contract".to_string())
}

fn auto_router_messages(input: &OrchestrationExecuteInput) -> Vec<OllamaMessage> {
    vec![
        OllamaMessage {
            role: "system".to_string(),
            content: [
                "You are Loom's response mode router.",
                "Return strict JSON only.",
                "Decide whether the final answer requires thinking.",
                "Do not answer the user.",
                "Do not reveal reasoning.",
                "Allowed reason labels: short_direct_prompt, translation_or_rewrite, grammar_or_phrase_help, simple_factual, multi_step_reasoning, code_or_architecture, debugging_or_diagnosis, long_context, document_or_file_analysis, planning_or_spec, ambiguous_low_confidence, fallback_heuristic.",
            ]
            .join(" "),
        },
        OllamaMessage {
            role: "user".to_string(),
            content: auto_router_user_prompt(input),
        },
    ]
}

fn auto_router_user_prompt(input: &OrchestrationExecuteInput) -> String {
    let prompt = compact(&input.prompt, 1_200);
    let reference_labels = input
        .references
        .iter()
        .take(6)
        .filter_map(|reference| reference.label.as_deref())
        .map(|label| compact(label, 80))
        .collect::<Vec<_>>();
    let has_code_block = input.prompt.contains("```");
    let language = if input.prompt.chars().any(|character| {
        matches!(
            character,
            'ı' | 'İ' | 'ğ' | 'Ğ' | 'ü' | 'Ü' | 'ş' | 'Ş' | 'ö' | 'Ö' | 'ç' | 'Ç'
        )
    }) {
        "tr"
    } else {
        "unknown"
    };
    format!(
        concat!(
            "Prompt:\n{prompt}\n\n",
            "Safe metadata:\n",
            "- promptLength: {prompt_length}\n",
            "- referenceCount: {reference_count}\n",
            "- referenceLabels: {reference_labels}\n",
            "- hasCodeBlock: {has_code_block}\n",
            "- language: {language}\n\n",
            "Return JSON: {{\"thinking_required\":true|false,\"reason\":\"allowed_label\",\"confidence\":0.0-1.0}}"
        ),
        prompt = prompt,
        prompt_length = input.prompt.chars().count(),
        reference_count = input.references.len(),
        reference_labels = reference_labels.join(", "),
        has_code_block = has_code_block,
        language = language,
    )
}

fn parse_auto_router_decision(content: &str, quick_model: &str) -> Option<AutoRouterDecision> {
    let json_text = strip_json_code_fence(content);
    let value = serde_json::from_str::<Value>(&json_text).ok()?;
    let thinking_required = value.get("thinking_required")?.as_bool()?;
    let reason = value
        .get("reason")
        .and_then(Value::as_str)
        .filter(|reason| allowed_auto_router_reason(reason))
        .unwrap_or("ambiguous_low_confidence")
        .to_string();
    let confidence = value
        .get("confidence")
        .and_then(Value::as_f64)
        .map(|confidence| confidence.clamp(0.0, 1.0));
    Some(AutoRouterDecision {
        thinking_required,
        reason,
        confidence,
        fallback_used: false,
        error_kind: None,
        provider: "ollama".to_string(),
        model: quick_model.to_string(),
    })
}

fn strip_json_code_fence(content: &str) -> String {
    let trimmed = content.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }
    trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string()
}

fn fallback_auto_router_decision(
    input: &OrchestrationExecuteInput,
    quick_model: &str,
    error_kind: Option<String>,
) -> AutoRouterDecision {
    let prompt = input.prompt.to_lowercase();
    let thinking_required = input.references.len() >= 3
        || input.prompt.chars().count() > 1_200
        || input.prompt.contains("```")
        || contains_any_text(
            &prompt,
            &[
                "debug",
                "diagnos",
                "architecture",
                "mimari",
                "tasarım",
                "design",
                "plan",
                "spec",
                "kod",
                "code",
                "implement",
                "refactor",
                "analyze",
                "analiz",
                "root cause",
                "kök neden",
            ],
        );
    let instant_direct = contains_any_text(
        &prompt,
        &[
            "translate",
            "çevir",
            "grammar",
            "dilbilgisi",
            "rewrite",
            "yeniden yaz",
            "nedir",
            "what is",
        ],
    ) && input.prompt.chars().count() < 180
        && input.references.is_empty();
    AutoRouterDecision {
        thinking_required: if instant_direct {
            false
        } else {
            thinking_required
        },
        reason: "fallback_heuristic".to_string(),
        confidence: Some(if error_kind.is_some() { 0.45 } else { 0.65 }),
        fallback_used: true,
        error_kind,
        provider: "ollama".to_string(),
        model: quick_model.to_string(),
    }
}

fn allowed_auto_router_reason(reason: &str) -> bool {
    matches!(
        reason,
        "short_direct_prompt"
            | "translation_or_rewrite"
            | "grammar_or_phrase_help"
            | "simple_factual"
            | "multi_step_reasoning"
            | "code_or_architecture"
            | "debugging_or_diagnosis"
            | "long_context"
            | "document_or_file_analysis"
            | "planning_or_spec"
            | "ambiguous_low_confidence"
            | "fallback_heuristic"
    )
}

fn contains_any_text(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn compact(value: &str, max_length: usize) -> String {
    let mut chars = value.chars();
    let clipped = chars.by_ref().take(max_length).collect::<String>();
    if chars.next().is_some() {
        format!("{clipped}...")
    } else {
        clipped
    }
}

fn normalize_assistant_markdown_source(source: &str) -> String {
    let lines: Vec<&str> = source.split('\n').collect();
    let mut normalized = Vec::new();
    let mut in_code_block = false;
    let mut index = 0;

    while index < lines.len() {
        let line = lines[index];
        let trimmed = line.trim();
        if line.trim_start().starts_with("```") {
            in_code_block = !in_code_block;
            normalized.push(line.to_string());
            index += 1;
            continue;
        }
        if in_code_block {
            normalized.push(line.to_string());
            index += 1;
            continue;
        }

        if is_orphan_heading_marker(trimmed) {
            if let Some(next_text_index) = next_non_empty_line_index(&lines, index + 1) {
                if is_plain_heading_text_line(lines[next_text_index]) {
                    normalized.push(format!("{trimmed} {}", lines[next_text_index].trim()));
                    index = next_text_index + 1;
                    continue;
                }
            }
            index += 1;
            continue;
        }

        normalized.push(line.to_string());
        index += 1;
    }

    normalized.join("\n")
}

fn next_non_empty_line_index(lines: &[&str], start_index: usize) -> Option<usize> {
    (start_index..lines.len()).find(|index| !lines[*index].trim().is_empty())
}

fn is_orphan_heading_marker(value: &str) -> bool {
    let marker_length = value.chars().count();
    (1..=6).contains(&marker_length) && value.chars().all(|character| character == '#')
}

fn is_plain_heading_text_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("```") {
        return false;
    }
    if let Some((marker, _)) = trimmed.split_once(' ') {
        if is_orphan_heading_marker(marker) {
            return false;
        }
    }
    if is_orphan_heading_marker(trimmed)
        || matches!(trimmed, "---" | "***" | "___")
        || trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
    {
        return false;
    }
    if trimmed
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_digit())
        && trimmed.contains(". ")
    {
        return false;
    }
    if trimmed.starts_with('|') && trimmed.ends_with('|') {
        return false;
    }
    true
}

async fn update_persisted_assistant_content(
    database: &crate::storage::db::Database,
    lifecycle: &PersistedResponseLifecycle,
) -> Result<(), crate::error::ServiceError> {
    let content = normalize_assistant_markdown_source(&lifecycle.assistant_content);
    ResponseRepository::new(database)
        .update_response_content(&lifecycle.assistant_response_id, &content)
        .await
}

async fn update_persisted_assistant_status(
    database: &crate::storage::db::Database,
    lifecycle: &PersistedResponseLifecycle,
    status: &str,
    done_reason: Option<&str>,
    error_kind: Option<&str>,
    error_message: Option<&str>,
) -> Result<(), crate::error::ServiceError> {
    ResponseRepository::new(database)
        .update_response_status(
            &lifecycle.assistant_response_id,
            status,
            done_reason,
            error_kind,
            error_message,
        )
        .await
}

async fn schedule_context_artifact_job(
    database: &crate::storage::db::Database,
    lifecycle: Option<&PersistedResponseLifecycle>,
) {
    let Some(lifecycle) = lifecycle else {
        return;
    };
    let _ = crate::context::worker::ContextArtifactWorker::new(database)
        .schedule_response_capsule_job(&lifecycle.assistant_response_id)
        .await;
}

fn merge_response_ids(payload: Value, lifecycle: Option<&PersistedResponseLifecycle>) -> Value {
    let Some(lifecycle) = lifecycle else {
        return payload;
    };
    let mut payload_object = payload.as_object().cloned().unwrap_or_default();
    if let Some(ids) = lifecycle.event_payload().as_object() {
        for (key, value) in ids {
            payload_object.insert(key.clone(), value.clone());
        }
    }
    Value::Object(payload_object)
}

async fn complete_successful_execution_stages(
    runner: &RepositoryWorkflowRunner,
    run_id: &str,
) -> Result<WorkflowRun, crate::error::ServiceError> {
    let _ = runner.mark_stage_skipped(run_id, "review_optional").await?;
    let _ = runner
        .mark_stage_skipped(run_id, "compress_checkpoint")
        .await?;
    let _ = runner.mark_stage_done(run_id, "persist").await?;
    runner.mark_stage_done(run_id, "emit_events").await
}

fn provider_error_event(
    run_id: &str,
    model: &str,
    error: &ProviderError,
    elapsed_ms: u128,
    lifecycle: Option<&PersistedResponseLifecycle>,
) -> Event {
    to_sse_event(service_event(
        run_id.to_string(),
        "response.error",
        merge_response_ids(
            json!({
                "runId": run_id,
                "stage": "generate",
                "model": model,
                "kind": error.kind,
                "message": error.technical_message.as_deref().unwrap_or(&error.user_message),
                "elapsedMs": elapsed_ms,
                "provider": {
                    "kind": error.provider_kind,
                    "id": error.provider_id,
                    "statusCode": error.status_code,
                    "retryable": error.retryable,
                    "details": error.safe_metadata
                }
            }),
            lifecycle,
        ),
    ))
}

async fn attached_references_for_sources(
    database: &crate::storage::db::Database,
    prompt: &str,
    references: &[AttachmentReferenceCandidate],
) -> Result<Vec<AttachedReferenceInput>, crate::error::ServiceError> {
    let attachment_repository = AttachmentRepository::new(database);
    let mut attached_references = Vec::with_capacity(references.len());
    for candidate in references {
        let reference = &candidate.reference;
        let attachment = if reference.target_kind == "attachment" {
            match reference.target_id.as_deref() {
                Some(attachment_id) => attachment_repository
                    .get_referenced_attachment_content(
                        &candidate.source_loom_id,
                        attachment_id,
                        prompt,
                    )
                    .await?
                    .map(attachment_context_from_record),
                None => None,
            }
        } else {
            None
        };
        attached_references.push(AttachedReferenceInput {
            reference: ReferenceContext {
                reference_id: reference.reference_id.clone(),
                target_kind: reference.target_kind.clone(),
                target_id: reference.target_id.clone(),
                target_uri: None,
                label: reference.label.clone(),
                selected_text: reference.selected_text_preview.clone(),
                capsule_summary: None,
            },
            response_capsule: None,
            attachment,
        });
    }
    Ok(attached_references)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AttachmentReferenceCandidate {
    reference: PlannerReference,
    source_loom_id: String,
}

fn attachment_context_from_record(
    record: crate::storage::repositories::attachments::AttachmentRecord,
) -> AttachmentContext {
    let parsed = record.parsed_content;
    AttachmentContext {
        attachment_id: record.attachment_id,
        loom_id: record.loom_id,
        file_name: record.file_name,
        mime_type: record.mime_type,
        kind: record.kind,
        parse_status: record.parse_status,
        parser: record.parser,
        content_text: parsed.as_ref().map(|content| content.content_text.clone()),
        content_kind: parsed.as_ref().map(|content| content.content_kind.clone()),
        char_count: parsed.map(|content| content.char_count),
    }
}

fn default_regenerate_source() -> String {
    "prompt_edit_regenerate".to_string()
}

fn default_retry_reason() -> String {
    "retry_from_user_message".to_string()
}

fn regenerate_response_stream(
    state: crate::api::state::AppState,
    response_id: String,
    input: RegenerateResponseInput,
) -> impl Stream<Item = Result<Event, Infallible>> {
    stream! {
        let _replace_stale_requested = input.replace_stale;
        let repository = ResponseRepository::new(&state.database);
        let user = match repository.get_response(&response_id).await {
            Ok(Some(response)) => response,
            Ok(None) => {
                yield Ok(to_sse_event(service_event(response_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "regenerate",
                    "kind": "not_found",
                    "message": "Response was not found."
                }))));
                return;
            }
            Err(error) => {
                yield Ok(to_sse_event(service_event(response_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "regenerate",
                    "kind": "response_lookup_error",
                    "message": error.to_string()
                }))));
                return;
            }
        };
        if user.role != "user" {
            yield Ok(to_sse_event(service_event(response_id.clone(), "response.error", json!({
                "runId": Value::Null,
                "stage": "regenerate",
                "kind": "unsupported_response_regenerate",
                "message": "Regeneration requires a user Response."
            }))));
            return;
        }
        let stale_assistant = match repository
            .next_assistant_after(&user.loom_id, user.sequence_index)
            .await
        {
            Ok(value) => value.map(|response| response.response_id),
            Err(_) => None,
        };
        let execute_input = OrchestrationExecuteInput {
            loom_id: Some(user.loom_id.clone()),
            response_id: Some(user.response_id.clone()),
            prompt: user.content.clone(),
            references: references_from_response_metadata(user.metadata_json.as_deref()),
            question_references: None,
            response_mode: input.response_mode,
            model: input.model.unwrap_or_else(|| "qwen3:latest".to_string()),
            provider_profile_id: input.provider_profile_id,
            options: input.options,
            persist_workflow: true,
            regenerate_from_response_id: Some(user.response_id),
            stale_assistant_response_id: stale_assistant,
            source: Some(input.source),
        };
        let inner = execute_stream(state, execute_input);
        futures_util::pin_mut!(inner);
        while let Some(event) = inner.next().await {
            yield event;
        }
    }
}

fn retry_response_stream(
    state: crate::api::state::AppState,
    response_id: String,
    input: RetryResponseInput,
) -> impl Stream<Item = Result<Event, Infallible>> {
    stream! {
        let repository = ResponseRepository::new(&state.database);
        let user = match repository.get_response(&response_id).await {
            Ok(Some(response)) => response,
            Ok(None) => {
                yield Ok(to_sse_event(service_event(response_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "retry",
                    "kind": "not_found",
                    "message": "Response was not found."
                }))));
                return;
            }
            Err(error) => {
                yield Ok(to_sse_event(service_event(response_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "retry",
                    "kind": "response_lookup_error",
                    "message": error.to_string()
                }))));
                return;
            }
        };
        if user.role != "user" {
            yield Ok(to_sse_event(service_event(response_id.clone(), "response.error", json!({
                "runId": Value::Null,
                "stage": "retry",
                "kind": "unsupported_response_retry",
                "message": "Retry requires a user Response."
            }))));
            return;
        }
        let stale_assistant = match repository
            .next_assistant_after(&user.loom_id, user.sequence_index)
            .await
        {
            Ok(value) => value.map(|response| response.response_id),
            Err(_) => None,
        };
        if input.soft_delete_downstream {
            if let Err(error) = repository
                .soft_delete_responses_after(
                    &user.loom_id,
                    user.sequence_index,
                    &input.reason,
                    &user.response_id,
                )
                .await
            {
                yield Ok(to_sse_event(service_event(user.response_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "retry",
                    "kind": "downstream_soft_delete_failed",
                    "message": error.to_string()
                }))));
                return;
            }
        }
        let execute_input = OrchestrationExecuteInput {
            loom_id: Some(user.loom_id.clone()),
            response_id: Some(user.response_id.clone()),
            prompt: user.content.clone(),
            references: references_from_response_metadata(user.metadata_json.as_deref()),
            question_references: None,
            response_mode: input.response_mode,
            model: input.model.unwrap_or_else(|| "qwen3:latest".to_string()),
            provider_profile_id: input.provider_profile_id,
            options: input.options,
            persist_workflow: true,
            regenerate_from_response_id: Some(user.response_id),
            stale_assistant_response_id: stale_assistant,
            source: Some(input.reason),
        };
        let inner = execute_stream(state, execute_input);
        futures_util::pin_mut!(inner);
        while let Some(event) = inner.next().await {
            yield event;
        }
    }
}

fn references_from_response_metadata(metadata_json: Option<&str>) -> Vec<PlannerReference> {
    let Some(metadata_json) = metadata_json else {
        return Vec::new();
    };
    let Ok(metadata) = serde_json::from_str::<Value>(metadata_json) else {
        return Vec::new();
    };
    let references = metadata
        .get("references")
        .and_then(Value::as_array)
        .map(|references| {
            references
                .iter()
                .filter_map(|reference| {
                    serde_json::from_value::<PlannerReference>(reference.clone()).ok()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    merge_context_references(
        references,
        planner_references_from_question_references(metadata.get("questionReferences")),
    )
}

fn context_references_for_execute(input: &OrchestrationExecuteInput) -> Vec<PlannerReference> {
    merge_context_references(
        input.references.clone(),
        planner_references_from_question_references(input.question_references.as_ref()),
    )
}

fn planner_references_from_question_references(value: Option<&Value>) -> Vec<PlannerReference> {
    value
        .and_then(Value::as_array)
        .map(|references| {
            references
                .iter()
                .filter_map(planner_reference_from_question_reference)
                .collect()
        })
        .unwrap_or_default()
}

fn merge_context_references(
    references: Vec<PlannerReference>,
    question_references: Vec<PlannerReference>,
) -> Vec<PlannerReference> {
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::with_capacity(references.len() + question_references.len());
    for reference in references.into_iter().chain(question_references) {
        let key = reference_dedup_key(&reference);
        if seen.insert(key) {
            merged.push(reference);
        }
    }
    merged
}

fn reference_dedup_key(reference: &PlannerReference) -> String {
    if reference.target_kind == "attachment" {
        return reference
            .target_id
            .as_deref()
            .unwrap_or(reference.reference_id.as_str())
            .to_string();
    }
    if let Some(target_id) = reference.target_id.as_deref() {
        return format!("{}:{target_id}", reference.target_kind);
    }
    format!("reference:{}", reference.reference_id)
}

fn merge_attachment_reference_candidates(
    explicit_references: &[PlannerReference],
    explicit_loom_id: &str,
    window_references: Vec<AttachmentReferenceCandidate>,
) -> Vec<AttachmentReferenceCandidate> {
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::with_capacity(explicit_references.len() + window_references.len());
    for reference in explicit_references {
        let key = format!("{explicit_loom_id}:{}", reference_dedup_key(reference));
        if seen.insert(key) {
            merged.push(AttachmentReferenceCandidate {
                reference: reference.clone(),
                source_loom_id: explicit_loom_id.to_string(),
            });
        }
    }
    for candidate in window_references {
        let key = format!(
            "{}:{}",
            candidate.source_loom_id,
            reference_dedup_key(&candidate.reference)
        );
        if seen.insert(key) {
            merged.push(candidate);
        }
    }
    merged
}

fn planner_reference_from_question_reference(value: &Value) -> Option<PlannerReference> {
    let object = value.as_object()?;
    let reference_id = object
        .get("referenceMentionId")
        .or_else(|| object.get("id"))
        .and_then(Value::as_str)?
        .to_string();
    Some(PlannerReference {
        reference_id,
        label: object
            .get("referenceCustomLabel")
            .or_else(|| object.get("title"))
            .and_then(Value::as_str)
            .map(str::to_string),
        selected_text_preview: object
            .get("selectedText")
            .and_then(Value::as_str)
            .map(str::to_string),
        target_kind: object
            .get("targetKind")
            .or_else(|| object.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("response")
            .to_string(),
        target_id: object
            .get("targetObjectId")
            .or_else(|| object.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string),
        source_response_code: object
            .get("sourceResponseCode")
            .and_then(Value::as_str)
            .map(str::to_string),
        source_title: object
            .get("sourceResponseTitle")
            .or_else(|| object.get("title"))
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

#[cfg(test)]
async fn recent_messages_before_response(
    database: &crate::storage::db::Database,
    loom_id: &str,
    response_id: Option<&str>,
    max_candidate_responses: usize,
) -> Result<Vec<ContextMessage>, crate::error::ServiceError> {
    let Some(response_id) = response_id else {
        return Ok(Vec::new());
    };
    let repository = ResponseRepository::new(database);
    let Some(head) = repository.get_response(response_id).await? else {
        return Ok(Vec::new());
    };
    let responses = repository.list_responses_for_loom(loom_id).await?;
    Ok(limit_recent_candidate_responses(
        responses
            .into_iter()
            .filter(|response| response.sequence_index < head.sequence_index)
            .filter_map(response_to_recent_context_message)
            .collect(),
        max_candidate_responses,
    ))
}

async fn context_window_before_response(
    database: &crate::storage::db::Database,
    loom_id: &str,
    response_id: Option<&str>,
    max_pairs: usize,
) -> Result<AssembledContextWindow, crate::error::ServiceError> {
    let Some(response_id) = response_id else {
        return Ok(AssembledContextWindow::default());
    };
    let repository = ResponseRepository::new(database);
    let Some(head) = repository.get_response(response_id).await? else {
        return Ok(AssembledContextWindow::default());
    };
    let responses = repository.list_responses_for_loom(loom_id).await?;
    let current_pairs = select_recent_context_pairs(
        responses
            .into_iter()
            .filter(|response| response.sequence_index < head.sequence_index),
        max_pairs,
        ContextWindowSource::CurrentLoom,
    );
    Ok(AssembledContextWindow::from_pairs(current_pairs))
}

#[cfg(test)]
async fn recent_messages_for_execution(
    database: &crate::storage::db::Database,
    loom_id: &str,
    input: &OrchestrationExecuteInput,
    lifecycle: Option<&PersistedResponseLifecycle>,
    max_candidate_responses: usize,
) -> Result<Vec<ContextMessage>, crate::error::ServiceError> {
    if input.regenerate_from_response_id.is_some() {
        return recent_messages_before_response(
            database,
            loom_id,
            input.response_id.as_deref(),
            max_candidate_responses,
        )
        .await;
    }

    let Some(lifecycle) = lifecycle else {
        return Ok(Vec::new());
    };
    recent_messages_before_response(
        database,
        loom_id,
        Some(&lifecycle.user_response_id),
        max_candidate_responses,
    )
    .await
}

async fn context_window_for_execution(
    database: &crate::storage::db::Database,
    loom_id: &str,
    input: &OrchestrationExecuteInput,
    lifecycle: Option<&PersistedResponseLifecycle>,
    is_weft: bool,
    origin_loom_id: Option<&str>,
    origin_response_id: Option<&str>,
    max_pairs: usize,
) -> Result<AssembledContextWindow, crate::error::ServiceError> {
    let current_head_response_id = if input.regenerate_from_response_id.is_some() {
        input.response_id.as_deref()
    } else {
        lifecycle
            .map(|lifecycle| lifecycle.user_response_id.as_str())
            .or(input.response_id.as_deref())
    };
    let mut window =
        context_window_before_response(database, loom_id, current_head_response_id, max_pairs)
            .await?;
    if is_weft && window.pair_count < max_pairs {
        if let (Some(origin_loom_id), Some(origin_response_id)) =
            (origin_loom_id, origin_response_id)
        {
            let remaining_pairs = max_pairs - window.pair_count;
            let mut origin_window = origin_context_window_through_response(
                database,
                origin_loom_id,
                origin_response_id,
                remaining_pairs,
            )
            .await?;
            window.pairs.append(&mut origin_window.pairs);
            window.pair_count += origin_window.pair_count;
        }
    }
    Ok(window)
}

async fn origin_context_window_through_response(
    database: &crate::storage::db::Database,
    origin_loom_id: &str,
    origin_response_id: &str,
    max_pairs: usize,
) -> Result<AssembledContextWindow, crate::error::ServiceError> {
    let repository = ResponseRepository::new(database);
    let Some(head) = repository.get_response(origin_response_id).await? else {
        return Ok(AssembledContextWindow::default());
    };
    if head.loom_id != origin_loom_id {
        return Ok(AssembledContextWindow::default());
    }
    let responses = repository.list_responses_for_loom(origin_loom_id).await?;
    let pairs = select_recent_context_pairs(
        responses
            .into_iter()
            .filter(|response| response.sequence_index <= head.sequence_index),
        max_pairs,
        ContextWindowSource::OriginLoom,
    );
    Ok(AssembledContextWindow::from_pairs(pairs))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContextWindowSource {
    CurrentLoom,
    OriginLoom,
}

#[derive(Debug, Clone)]
struct ContextWindowTurn {
    message: ContextMessage,
    loom_id: String,
    metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
struct ContextWindowPair {
    user: ContextWindowTurn,
    assistant: Option<ContextWindowTurn>,
}

#[derive(Debug, Clone, Default)]
struct AssembledContextWindow {
    pairs: Vec<ContextWindowPair>,
    pair_count: usize,
}

impl AssembledContextWindow {
    fn from_pairs(pairs: Vec<ContextWindowPair>) -> Self {
        let pair_count = pairs.len();
        Self { pairs, pair_count }
    }

    fn messages(&self) -> Vec<ContextMessage> {
        self.pairs
            .iter()
            .flat_map(|pair| {
                std::iter::once(pair.user.message.clone())
                    .chain(pair.assistant.iter().map(|turn| turn.message.clone()))
            })
            .collect()
    }

    fn attachment_reference_candidates(&self) -> Vec<AttachmentReferenceCandidate> {
        let mut candidates = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for pair in &self.pairs {
            for reference in references_from_response_metadata(pair.user.metadata_json.as_deref()) {
                if reference.target_kind != "attachment" {
                    continue;
                }
                let Some(attachment_id) = reference.target_id.as_deref() else {
                    continue;
                };
                if !seen.insert(format!("{}:{attachment_id}", pair.user.loom_id)) {
                    continue;
                }
                candidates.push(AttachmentReferenceCandidate {
                    reference,
                    source_loom_id: pair.user.loom_id.clone(),
                });
            }
        }
        candidates
    }
}

fn select_recent_context_pairs(
    responses: impl IntoIterator<Item = ResponseRecord>,
    max_pairs: usize,
    source: ContextWindowSource,
) -> Vec<ContextWindowPair> {
    let max_pairs = max_pairs.max(1);
    let mut pairs = Vec::new();
    let mut pending_user: Option<ContextWindowTurn> = None;
    for response in responses {
        if response.role == "user" {
            if let Some(user) = pending_user.take() {
                pairs.push(ContextWindowPair {
                    user,
                    assistant: None,
                });
            }
            pending_user = context_window_turn_from_response(response, source);
            continue;
        }
        if response.role == "assistant" {
            let Some(user) = pending_user.take() else {
                continue;
            };
            let assistant = context_window_turn_from_response(response, source);
            pairs.push(ContextWindowPair { user, assistant });
        }
    }
    if let Some(user) = pending_user {
        pairs.push(ContextWindowPair {
            user,
            assistant: None,
        });
    }
    if pairs.len() > max_pairs {
        pairs.drain(0..pairs.len() - max_pairs);
    }
    pairs
}

fn context_window_turn_from_response(
    response: ResponseRecord,
    _source: ContextWindowSource,
) -> Option<ContextWindowTurn> {
    let message = response_to_recent_context_message(response.clone())?;
    Some(ContextWindowTurn {
        message,
        loom_id: response.loom_id,
        metadata_json: response.metadata_json,
    })
}

async fn memory_messages_for_execution(
    database: &crate::storage::db::Database,
    config: &LoomServiceConfig,
) -> Result<Vec<ContextMessage>, crate::error::ServiceError> {
    if !config.memory.enabled {
        return Ok(Vec::new());
    }

    let mut messages = Vec::new();
    let mut profile_lines = Vec::new();
    push_profile_line(&mut profile_lines, "Nickname", &config.memory.nickname);
    push_profile_line(&mut profile_lines, "Occupation", &config.memory.occupation);
    push_profile_line(
        &mut profile_lines,
        "Answer preferences",
        &config.memory.style_preferences,
    );
    push_profile_line(
        &mut profile_lines,
        "About the user",
        &config.memory.more_about_you,
    );
    if !profile_lines.is_empty() {
        messages.push(ContextMessage::new(
            ContextMessageRole::System,
            format!(
                "Use this explicit local user profile only when it is relevant. Do not mention it unless it helps answer the user's question.\n{}",
                profile_lines.join("\n")
            ),
            Some(crate::context::types::ContextSourceKind::RetrievedMemory),
            Some("local-profile-settings".to_string()),
        ));
    }

    if config.memory.reference_saved_memories {
        let repository = MemoryRepository::new(database);
        for memory in repository.list_memories(None).await? {
            if !memory.user_confirmed || contains_forbidden_context_key(&memory.content) {
                continue;
            }
            if !matches!(
                memory.memory_type.as_str(),
                "explicit_user_memory" | "profile_preference"
            ) {
                continue;
            }
            messages.push(ContextMessage::new(
                ContextMessageRole::System,
                format!(
                    "Saved Memory ({}): {}",
                    memory.memory_type,
                    truncate_context_text(&memory.content, MAX_MEMORY_CONTEXT_CHARS)
                ),
                Some(crate::context::types::ContextSourceKind::RetrievedMemory),
                Some(memory.memory_id),
            ));
            if messages.len() >= MAX_MEMORY_CONTEXT_MESSAGES {
                break;
            }
        }
    }

    Ok(messages)
}

fn push_profile_line(lines: &mut Vec<String>, label: &str, value: &str) {
    let value = value.trim();
    if value.is_empty() || contains_forbidden_context_key(value) {
        return;
    }
    lines.push(format!(
        "{label}: {}",
        truncate_context_text(value, MAX_MEMORY_CONTEXT_CHARS)
    ));
}

fn truncate_context_text(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for character in value.chars().take(max_chars) {
        output.push(character);
    }
    if value.chars().count() > max_chars {
        output.push_str("...");
    }
    output
}

#[cfg(test)]
fn limit_recent_candidate_responses(
    mut messages: Vec<ContextMessage>,
    max_candidate_responses: usize,
) -> Vec<ContextMessage> {
    let max_candidate_responses = max_candidate_responses.max(2);
    if messages.len() > max_candidate_responses {
        messages.drain(0..messages.len() - max_candidate_responses);
    }
    messages
}

fn response_to_recent_context_message(response: ResponseRecord) -> Option<ContextMessage> {
    if response.content.trim().is_empty() || contains_forbidden_context_key(&response.content) {
        return None;
    }
    if response
        .metadata_json
        .as_deref()
        .is_some_and(contains_forbidden_context_key)
    {
        return None;
    }
    if response.role == "assistant" && response_is_stale(&response) {
        return None;
    }
    let role = match response.role.as_str() {
        "assistant" => ContextMessageRole::Assistant,
        "user" => ContextMessageRole::User,
        _ => return None,
    };
    Some(ContextMessage::new(
        role,
        response.content,
        Some(crate::context::types::ContextSourceKind::RecentTurn),
        Some(response.response_id),
    ))
}

fn response_is_stale(response: &ResponseRecord) -> bool {
    response
        .metadata_json
        .as_deref()
        .and_then(|metadata| serde_json::from_str::<Value>(metadata).ok())
        .is_some_and(|value| {
            value.get("stale").and_then(Value::as_bool).unwrap_or(false)
                || value
                    .get("staleReason")
                    .and_then(Value::as_str)
                    .is_some_and(|reason| !reason.trim().is_empty())
        })
}

fn built_context_size_hint(input: &BuildContextInput) -> i64 {
    input
        .recent_messages
        .iter()
        .map(|message| crate::context::estimate_tokens(&message.content) as i64)
        .sum::<i64>()
        + crate::context::estimate_tokens(&input.user_prompt) as i64
}

fn strategy_input_from_execute(
    input: &OrchestrationExecuteInput,
    context_size_tokens: &i64,
) -> crate::capabilities::strategy::ResolveExecutionStrategyInput {
    crate::capabilities::strategy::ResolveExecutionStrategyInput {
        model_id: None,
        provider: Some("ollama".to_string()),
        model_name: Some(input.model.clone()),
        requested_mode: match &input.response_mode {
            ResponseMode::Thinking => crate::capabilities::strategy::RequestedMode::Deep,
            ResponseMode::Auto => {
                if prompt_looks_long_form(&input.prompt) {
                    crate::capabilities::strategy::RequestedMode::Long
                } else {
                    crate::capabilities::strategy::RequestedMode::Normal
                }
            }
            ResponseMode::Instant => crate::capabilities::strategy::RequestedMode::Normal,
        },
        prompt_kind: infer_strategy_prompt_kind(&input.prompt),
        context_size_tokens: *context_size_tokens,
        reference_count: input.references.len() as i64,
        user_requested_parallelism: None,
    }
}

fn infer_strategy_prompt_kind(prompt: &str) -> crate::capabilities::strategy::PromptKind {
    let normalized = prompt.to_lowercase();
    if [
        "code",
        "kod",
        "debug",
        "hata",
        "implement",
        "refactor",
        "typescript",
        "rust",
        "sql",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
    {
        return crate::capabilities::strategy::PromptKind::Code;
    }
    if prompt_looks_long_form(prompt) {
        return crate::capabilities::strategy::PromptKind::LongForm;
    }
    if normalized.contains("sentez")
        || normalized.contains("karşılaştır")
        || normalized.contains("compare")
        || normalized.contains("synthesize")
    {
        return crate::capabilities::strategy::PromptKind::Synthesis;
    }
    if prompt.chars().count() < 80
        && ["nedir", "ne demek", "kaç", "what is", "how many"]
            .iter()
            .any(|needle| normalized.contains(needle))
    {
        return crate::capabilities::strategy::PromptKind::Factual;
    }
    crate::capabilities::strategy::PromptKind::Explanation
}

fn prompt_looks_long_form(prompt: &str) -> bool {
    let normalized = prompt.to_lowercase();
    prompt.chars().count() > 240
        || [
            "detaylı",
            "detayland",
            "kapsamlı",
            "uzun",
            "deep dive",
            "detailed",
            "comprehensive",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
}

fn contains_forbidden_context_key(value: &str) -> bool {
    FORBIDDEN_CONTEXT_KEYS.iter().any(|key| value.contains(key))
}

fn context_response_mode(mode: &ResponseMode) -> ContextResponseMode {
    match mode {
        ResponseMode::Instant => ContextResponseMode::Instant,
        ResponseMode::Thinking => ContextResponseMode::Thinking,
        ResponseMode::Auto => ContextResponseMode::Auto,
    }
}

fn context_strategy_for_readiness(
    strategy: &crate::orchestration::answer_plan::ContextStrategy,
) -> crate::context::types::ContextStrategy {
    match strategy {
        crate::orchestration::answer_plan::ContextStrategy::LoomCheckpoint => {
            crate::context::types::ContextStrategy::CheckpointAndRecent
        }
        crate::orchestration::answer_plan::ContextStrategy::ReferenceCapsules => {
            crate::context::types::ContextStrategy::ReferenceCapsules
        }
        crate::orchestration::answer_plan::ContextStrategy::WeftOrigin => {
            crate::context::types::ContextStrategy::WeftOriginAndRecent
        }
        crate::orchestration::answer_plan::ContextStrategy::Minimal => {
            crate::context::types::ContextStrategy::Minimal
        }
        _ => crate::context::types::ContextStrategy::RecentTurns,
    }
}

fn context_built_event_payload(
    run_id: &str,
    message_count: usize,
    warnings: Vec<String>,
    built_context: &crate::context::types::BuiltContext,
) -> serde_json::Value {
    json!({
        "runId": run_id,
        "messageCount": message_count,
        "warnings": warnings,
        "budgetPlan": built_context.budget_plan.clone(),
        "budgetDiagnostics": built_context.budget_diagnostics.clone()
    })
}

fn deterministic_e2e_answer(
    input: &OrchestrationExecuteInput,
    built_context: &crate::context::types::BuiltContext,
) -> Option<String> {
    if std::env::var("LOOM_SERVICE_E2E_PROVIDER").ok().as_deref() != Some("event-sourcing") {
        return None;
    }

    let prompt = input.prompt.to_lowercase();
    let context_text = built_context
        .messages
        .iter()
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n")
        .to_lowercase();
    let has_event_context = context_text.contains("event sourcing")
        && (context_text.contains("event store") || context_text.contains("cqrs"));
    let attachment_sentinel = "loom_attachment_context_sentinel_123";
    let first_turn_attachment_sentinel = "loom_first_turn_attachment_sentinel_789";
    let window_attachment_sentinel = "loom_window_attachment_sentinel_456";

    if deterministic_e2e_response_mode().as_deref() == Some("long-streaming-scroll")
        || prompt.contains("long streaming scroll fixture")
    {
        return Some(long_streaming_scroll_e2e_answer());
    }

    if (prompt.contains("attached")
        || prompt.contains("uploaded document")
        || prompt.contains("document")
        || prompt.contains("file"))
        && context_text.contains(attachment_sentinel)
    {
        return Some(
            "The attached document includes LOOM_ATTACHMENT_CONTEXT_SENTINEL_123.".to_string(),
        );
    }
    if (prompt.contains("attached")
        || prompt.contains("uploaded document")
        || prompt.contains("document")
        || prompt.contains("file"))
        && context_text.contains(first_turn_attachment_sentinel)
    {
        return Some(
            "The attached file includes LOOM_FIRST_TURN_ATTACHMENT_SENTINEL_789.".to_string(),
        );
    }
    if prompt.contains("window sentinel") && context_text.contains(window_attachment_sentinel) {
        return Some("Window attachment content is visible.".to_string());
    }

    if prompt.contains("blue otter") && prompt.contains("event sourcing") {
        return Some("Blue Otter is the project codename. In the Event Sourcing explanation, Blue Otter uses an Event Store as the source of truth and can replay events to rebuild projections.".to_string());
    }
    if prompt.contains("teknik geçmişime") || prompt.contains("technical background") {
        if context_text.contains("software architect")
            && context_text.contains(".net engineer")
            && context_text.contains("turkish answers")
        {
            return Some("Teknik geçmişine göre bunu bir Software architect / .NET engineer bakışıyla değerlendirmelisin: domain boundaries, local-first runtime, service ownership ve long-term architecture trade-off'larına odaklan. Loom ve local-first AI runtime ilgini dikkate alarak, kararlarını privacy, operability ve maintainability üzerinden tart.".to_string());
        }
    }
    if prompt.contains("project codename") || prompt.contains("codename") {
        return Some(
            if context_text.contains("blue otter") && context_text.contains("event sourcing") {
                "The project codename is Blue Otter. It relates to the previous Event Sourcing explanation because Blue Otter is the example system whose state is rebuilt from stored events and projections.".to_string()
            } else {
                "Konu bağlamı bulunamadı.".to_string()
            },
        );
    }
    if prompt.contains("mcp") && prompt.contains("cqrs") {
        return Some(mcp_cqrs_quick_ask_e2e_answer());
    }
    if prompt.contains("error tracking") && prompt.contains("event sourcing") {
        return Some(error_tracking_event_sourcing_e2e_answer());
    }
    if prompt.contains("compaction") && prompt.contains("event sourcing") {
        return Some(compaction_event_sourcing_e2e_answer());
    }
    if prompt.contains("audit trail") && prompt.contains("event sourcing") {
        return Some(audit_trail_event_sourcing_e2e_answer());
    }
    if prompt.contains("time travel") && prompt.contains("event sourcing") {
        return Some(time_travel_event_sourcing_e2e_answer());
    }
    if prompt.contains("event logging") && prompt.contains("event sourcing") {
        return Some(event_logging_event_sourcing_e2e_answer());
    }
    if prompt.contains("event sourcing") && prompt.contains("detay") {
        return Some(event_sourcing_detailed_e2e_answer());
    }
    if prompt.contains("event store") && prompt.contains("detay") {
        return Some(event_store_detailed_e2e_answer());
    }
    if prompt.contains("event sourcing") && prompt.contains("avantaj") {
        return Some(event_sourcing_detailed_e2e_answer());
    }
    if prompt.contains("tablo") && prompt.contains("avantaj") && prompt.contains("dezavantaj") {
        return Some(if has_event_context {
            event_sourcing_table_e2e_answer()
        } else {
            "Konu bağlamı bulunamadı.".to_string()
        });
    }
    if prompt.contains("biraz daha") && prompt.contains("avantaj") && prompt.contains("dezavantaj")
    {
        return Some(if has_event_context {
            event_sourcing_expanded_e2e_answer()
        } else {
            "Konu bağlamı bulunamadı.".to_string()
        });
    }
    if prompt.contains("cqrs") {
        return Some(if has_event_context {
            "CQRS, Event Sourcing ile birlikte okuma ve yazma modellerini ayırmak için kullanılır. Event Store yazma tarafında olayları saklar; Replay ile okuma projeksiyonları yeniden kurulabilir.".to_string()
        } else {
            "CQRS için önce ilgili Loom bağlamı gerekir.".to_string()
        });
    }

    Some("Deterministic E2E provider only answers the Event Sourcing proof scenario.".to_string())
}

fn should_fail_initial_e2e_prompt(input: &OrchestrationExecuteInput) -> bool {
    let Ok(marker) = std::env::var("LOOM_SERVICE_E2E_FAIL_INITIAL_PROMPT") else {
        return false;
    };
    let marker = marker.trim().to_lowercase();
    if marker.is_empty() {
        return false;
    }
    let is_retry = input
        .source
        .as_deref()
        .map(|source| source == "retry_from_user_message")
        .unwrap_or(false);
    !is_retry && input.prompt.to_lowercase().contains(&marker)
}

fn deterministic_e2e_thinking_delay_ms() -> u64 {
    std::env::var("LOOM_SERVICE_E2E_THINKING_DELAY_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
}

fn deterministic_e2e_stream_chunk_delay_ms() -> u64 {
    std::env::var("LOOM_SERVICE_E2E_STREAM_CHUNK_DELAY_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
}

fn deterministic_e2e_response_mode() -> Option<String> {
    std::env::var("LOOM_SERVICE_E2E_RESPONSE_MODE")
        .ok()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
}

fn deterministic_e2e_chunk_mode() -> String {
    std::env::var("LOOM_SERVICE_E2E_CHUNK_MODE")
        .ok()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| value == "phrase" || value == "word")
        .unwrap_or_else(|| "word".to_string())
}

fn deterministic_e2e_answer_chunks(answer: &str, chunk_delay_ms: u64) -> Vec<String> {
    if chunk_delay_ms == 0 {
        return vec![answer.to_string()];
    }

    let word_chunks = answer
        .split_inclusive(char::is_whitespace)
        .filter(|chunk| !chunk.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if word_chunks.is_empty() {
        vec![answer.to_string()]
    } else if deterministic_e2e_chunk_mode() == "phrase" {
        word_chunks
            .chunks(8)
            .map(|chunk| chunk.concat())
            .collect::<Vec<_>>()
    } else {
        word_chunks
    }
}

fn long_streaming_scroll_e2e_answer() -> String {
    [
        "# Long Streaming Scroll Fixture",
        "",
        "This deterministic response is intentionally long enough to exercise Loom transcript scrolling while the service streams content in small chunks. It gives scroll tests real rendered content instead of relying on one-line answers or artificial bottom padding.",
        "",
        "## Fixture setup",
        "",
        "The first section appears after the configured thinking delay, then the remaining words arrive progressively. The response includes several paragraphs, headings, and bullets so the transcript crosses the composer-safe boundary in a predictable way.",
        "",
        "## Anchor behavior",
        "",
        "When the user submits a prompt, the latest user turn should stay near the top of the visible Loom surface. Early assistant text should grow underneath that prompt without forcing the viewport down while there is still empty space above the composer.",
        "",
        "## Composer boundary",
        "",
        "The follow threshold should be based on real assistant content reaching the composer boundary. This fixture contains enough body text to move from the anchored hold state into the follow state without counting spacer elements, bottom padding, or scrollHeight distance.",
        "",
        "- The stream starts with a visible title.",
        "- The content grows over multiple chunks.",
        "- The answer becomes taller than a compact browser viewport.",
        "- The final marker is unique and stable for assertions.",
        "",
        "## Manual scroll readiness",
        "",
        "A small user wheel gesture during generation should pause live auto-follow. The stream then continues long enough for tests to verify that the viewport is not pulled down immediately while new words are still arriving.",
        "",
        "## Long body",
        "",
        "The fixture keeps adding ordinary readable text after the early sections so geometry assertions can observe real overflow. Each paragraph is plain Markdown content that belongs to the assistant answer, which means the transcript height changes because rendered response text grows, not because a spacer or CSS padding expanded below it.",
        "",
        "Loom scroll behavior is sensitive to the difference between content and chrome. This paragraph gives the viewport more real words to lay out, making it easier to check that the latest user prompt remains useful context while the answer grows beneath it.",
        "",
        "When the viewport is compact, these paragraphs should push the response tail toward the composer boundary. Tests can then verify that auto-follow starts for the right reason: the actual response tail is about to be hidden, not because scrollHeight includes empty generation space.",
        "",
        "## Boundary proof",
        "",
        "The following lines are intentionally repetitive in structure but not in content. They keep the fixture deterministic while still looking like a normal generated answer with sections, prose, and a stable ending marker.",
        "",
        "- Real response text should be measured with DOM geometry.",
        "- Composer-safe visibility should use the composer top boundary.",
        "- Manual scroll should pause live follow during streaming.",
        "- Completion should still reveal the final real content end.",
        "- The final marker should be visible after the response completes.",
        "",
        "A final descriptive paragraph gives the scroll system one more block of real content. It is long enough to wrap across several lines at narrow desktop widths and short enough that the product-mode tests still complete quickly with word or phrase chunking.",
        "",
        "## Completion snap",
        "",
        "After completion, Loom should make the real response end visible above the composer. The final line below is deliberately short and unique so product-mode E2E tests can assert that completion reached the actual response tail.",
        "",
        "END_OF_LONG_STREAMING_FIXTURE",
    ]
    .join("\n")
}

fn event_sourcing_detailed_e2e_answer() -> String {
    [
        "# Event Sourcing",
        "",
        "Event Sourcing, uygulama durumunu yalnızca son tablo hali olarak değil, gerçekleşen olayların sıralı kaydı olarak saklayan bir mimari yaklaşımdır. Event Store kayıt kaynağıdır; Replay geçmiş eventlerden durumu yeniden kurar; CQRS okuma ve yazma modellerini ayırabilir.",
        "",
        "## Nerelerde kullanılır?",
        "",
        "- Audit izi ve geçmişin tam korunması gereken finans, sipariş, envanter ve iş akışı sistemlerinde.",
        "- Event Store üzerinden yeni projeksiyonlar üretmek veya hatalı projeksiyonları Replay ile yeniden kurmak gerektiğinde.",
        "- DDD aggregate sınırları net olduğunda ve Snapshot stratejisiyle uzun geçmişler yönetilebildiğinde.",
        "",
        "## Avantajlar ve dezavantajlar",
        "",
        "Avantajları audit edilebilirlik, tam geçmiş ve yeniden oynatma; dezavantajları şema evrimi, operasyonel karmaşıklık ve eventual consistency yönetimidir.",
        "",
        "```ts",
        "const stream = eventStore.load(aggregateId);",
        "const state = replay(stream);",
        "```",
    ]
    .join("\n")
}

fn time_travel_event_sourcing_e2e_answer() -> String {
    [
        "# Time Travel in Event Sourcing",
        "",
        "Time Travel, Event Sourcing bağlamında Event Store'daki geçmiş olayları belirli bir ana kadar Replay ederek sistem durumunu o zamanki haliyle yeniden kurma yaklaşımıdır.",
        "",
        "- Bir siparişin, hesabın veya aggregate'in geçmiş tarihteki durumunu denetlemek için kullanılır.",
        "- Audit, hata araştırması, müşteri destek incelemesi ve projection doğrulama senaryolarında işe yarar.",
        "- Snapshot ve Replay stratejileriyle maliyet kontrol edilir; audit gereksinimleri korunmadan olay geçmişi budanmamalıdır.",
    ]
    .join("\n")
}

fn event_logging_event_sourcing_e2e_answer() -> String {
    [
        "# Event Logging in Event Sourcing",
        "",
        "event logging), Event Sourcing bağlamında domain eventleri append-only bir event log içinde saklama yaklaşımıdır.",
        "",
        "- Her anlamlı state change bir event olarak Event Store'a yazılır.",
        "- event logging audit, replay, projection ve hata ayıklama için kaynak oluşturur.",
        "- Örnek eventler: `OrderCreated`, `PaymentFailed`, `StockReserved`.",
    ]
    .join("\n")
}

fn event_store_detailed_e2e_answer() -> String {
    [
        "# Event Store",
        "",
        "Event Store, domain değişikliklerini sıralı event stream olarak saklayan kalıcı kayıt kaynağıdır. Write Side komutları işler, aggregate kurallarını çalıştırır ve başarılı değişiklikleri Event Store'a append eder.",
        "",
        "## Temel parçalar",
        "",
        "- Write Side: command handling, aggregate validation ve event append akışını yönetir.",
        "- Read Side: Event Store'daki olaylardan projection/read model üretir.",
        "- Replay: kayıtlı event stream'i yeniden oynatarak state veya projection kurar.",
        "- Audit Trail: kimin neyi ne zaman değiştirdiğini olaylardan izlemeyi sağlar.",
    ]
    .join("\n")
}

fn event_sourcing_table_e2e_answer() -> String {
    [
        "Event Sourcing için avantajlar ve dezavantajlar:",
        "",
        "| Avantaj | Dezavantaj |",
        "| :--- | :--- |",
        "| Tam geçmiş ve audit izi sağlar. | Event şeması evrimi dikkat ister. |",
        "| Replay ile yeni projeksiyonlar üretilebilir. | Eventual consistency kullanıcı deneyimini karmaşıklaştırabilir. |",
        "| CQRS ile okuma/yazma modelleri ayrılabilir. | Event Store işletimi ve izleme ek yük getirir. |",
    ]
    .join("\n")
}

fn event_sourcing_expanded_e2e_answer() -> String {
    "Event Sourcing avantajları audit, Replay ve CQRS projeksiyonları tarafında güçlenir. Dezavantajları Event Store işletimi, Snapshot stratejisi, şema evrimi ve eventual consistency yönetiminde ortaya çıkar.".to_string()
}

fn mcp_cqrs_quick_ask_e2e_answer() -> String {
    [
        "# MCP, CQRS ve Event Sourcing",
        "",
        "MCP, Model Context Protocol anlamına gelir ve plugin integration, tool execution, session state ve context paylaşımı için kullanılır.",
        "",
        "CQRS, Command Query Responsibility Segregation anlamına gelir. Event Sourcing ile birlikte kullanıldığında yazma tarafı Event Store'a olayları kaydeder, okuma tarafı Replay ile projeksiyonları yeniden kurabilir.",
        "",
        "Bu Loom'da MCP kaynak bağlamı plugin/session/tool context tarafını, CQRS ise Event Sourcing mimari tarafını açıklar.",
    ]
    .join("\n")
}

fn error_tracking_event_sourcing_e2e_answer() -> String {
    [
        "# Error Tracking with Event Sourcing",
        "",
        "Error Tracking, Event Sourcing içinde başarısız komutlar ve hata olayları üzerinden izlenebilir.",
        "",
        "- CommandFailed, ErrorOccurred, RetryScheduled gibi olaylar Event Store'a yazılır.",
        "- correlationId, causationId, command id, aggregate id ve timestamp hata zincirini bağlar.",
        "- Error Tracking projection/read model dashboard ve alerting için kullanılır.",
        "- Retry, dead-letter ve outbox akışları projection üzerinden takip edilebilir.",
    ]
    .join("\n")
}

fn compaction_event_sourcing_e2e_answer() -> String {
    [
        "# Compaction in Event Sourcing",
        "",
        "Compaction, Event Sourcing'de uzun event log geçmişini yönetilebilir tutmak için eski olayların snapshot, özet projection veya arşiv stratejisiyle küçültülmesidir.",
        "",
        "- Event Store geçmiş olayları saklar; Compaction Replay maliyetini azaltır.",
        "- Snapshot aggregate durumunu belli bir noktada temsil eder.",
        "- Eski eventler budanacaksa audit, yasal saklama ve yeniden kurma garantileri korunmalıdır.",
        "- Projection/read model tarafında kompakt özetler kullanılabilir ama kaynak olayların anlamı kaybolmamalıdır.",
    ]
    .join("\n")
}

fn audit_trail_event_sourcing_e2e_answer() -> String {
    [
        "# Audit Trail in Event Sourcing",
        "",
        "Audit Trail, Event Sourcing'de sistemde kimin, neyi, ne zaman ve neden yaptığını olay akışı üzerinden izlemeyi sağlar.",
        "",
        "- Event Store her domain değişikliğini olay olarak kaydeder.",
        "- correlationId, causationId, userId, aggregateId ve timestamp ile iz sürülebilirlik kurulur.",
        "- Finansal sistemler, sipariş yaşam döngüsü, güvenlik incelemeleri, hata araştırması ve uyumluluk raporları için kullanılır.",
    ]
    .join("\n")
}

async fn resolve_context_scope(
    database: &crate::storage::db::Database,
    loom_id: &str,
) -> Result<(bool, Option<String>, Option<String>), crate::error::ServiceError> {
    let loom = LoomRepository::new(database).get_loom(loom_id).await?;
    let is_weft = loom.as_ref().is_some_and(|loom| loom.kind == "weft");
    let origin_loom_id = loom.as_ref().and_then(|loom| loom.origin_loom_id.clone());
    let origin_response_id = loom
        .as_ref()
        .and_then(|loom| loom.origin_response_id.clone());
    Ok((is_weft, origin_loom_id, origin_response_id))
}

fn unix_timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn create_provider_pipeline_for_request(
    ollama: OllamaRuntime,
    config: &crate::config::LoomServiceConfig,
    secret_store: &crate::providers::secret_store::ProviderSecretStore,
    provider_profile_id: Option<&str>,
) -> Result<ProviderPipeline, String> {
    match provider_profile_id {
        Some(profile_id) => {
            let registry = crate::providers::adapter::ProviderRegistry::new_for_profile(
                ollama,
                config,
                secret_store,
                profile_id,
            )?;
            Ok(ProviderPipeline::from_registry(registry))
        }
        None => {
            let registry = crate::providers::adapter::ProviderRegistry::new_for_main_generation(
                ollama,
                config,
                secret_store,
            );
            Ok(ProviderPipeline::from_registry(registry))
        }
    }
}

fn execute_stream(
    state: crate::api::state::AppState,
    input: OrchestrationExecuteInput,
) -> impl Stream<Item = Result<Event, Infallible>> {
    stream! {
        let request_id = format!("orch-{}", unix_timestamp_millis());
        let workflow_loom_id = input.loom_id.clone().unwrap_or_else(|| "prototype-loom".to_string());
        let persist_workflow_requested = input.persist_workflow;
        let _operation_guard = state.operations.start(request_id.clone(), OperationKind::ModelGeneration);
        let started = Instant::now();
        let runner = RepositoryWorkflowRunner::new(&state.database);

        let mode_resolution = match resolve_response_mode_for_execute(&state, &input).await {
            Ok(resolution) => resolution,
            Err(error) => {
                yield Ok(to_sse_event(service_event(request_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "orchestrate",
                    "kind": error.code,
                    "message": error.message
                }))));
                return;
            }
        };
        let mut execution_input = input.clone();
        execution_input.response_mode = mode_resolution.resolved_response_mode.clone();

        let context_references = context_references_for_execute(&execution_input);
        let planner_input = PlannerInput {
            clean_user_prompt: execution_input.prompt.clone(),
            prompt_lines: execution_input.prompt.lines().map(str::to_string).collect(),
            attached_references: context_references.clone(),
            selected_response_mode: execution_input.response_mode.clone(),
            loom_id: execution_input.loom_id.clone(),
            source: Some("orchestration_execute".to_string()),
        };
        let answer_plan = DeterministicPlanner::plan(planner_input);
        let plan_json = match serde_json::to_string(&answer_plan) {
            Ok(value) => value,
            Err(error) => {
                yield Ok(to_sse_event(service_event(request_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "orchestrate",
                    "kind": "serialization_error",
                    "message": error.to_string()
                }))));
                return;
            }
        };
        let run = match runner.create_run(Some(workflow_loom_id.clone()), execution_input.response_id.clone(), Some(plan_json)).await {
            Ok(run) => run,
            Err(error) => {
                yield Ok(to_sse_event(service_event(request_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "orchestrate",
                    "kind": "workflow_persistence_error",
                    "message": error.to_string()
                }))));
                return;
            }
        };
        let run_id = run.run_id.clone();
        let mut persisted_lifecycle = match create_persisted_response_lifecycle(&state.database, &execution_input, &run_id, &answer_plan, &mode_resolution).await {
            Ok(lifecycle) => lifecycle,
            Err(error) => {
                let _ = runner.mark_stage_failed(&run_id, "persist", &error.to_string()).await;
                yield Ok(to_sse_event(service_event(run_id.clone(), "response.error", json!({
                    "runId": run_id,
                    "stage": "persist",
                    "kind": "response_persistence_error",
                    "message": error.to_string()
                }))));
                return;
            }
        };

        let placeholder_payload = merge_response_ids(json!({
            "runId": run_id,
            "requestId": request_id,
            "persistWorkflow": persist_workflow_requested
        }), persisted_lifecycle.as_ref());
        let _ = runner
            .persist_event(
                run_id.clone(),
                "response.placeholder_created".to_string(),
                Some("persist".to_string()),
                placeholder_payload.to_string(),
            )
            .await;
        yield Ok(to_sse_event(service_event(run_id.clone(), "response.placeholder_created", placeholder_payload)));
        yield Ok(to_sse_event(service_event(run_id.clone(), "answer_plan.ready", json!({
            "runId": run_id,
            "answerPlan": answer_plan.clone()
        }))));
        let _ = runner.persist_event(run_id.clone(), "answer_plan.ready".to_string(), Some("orchestrate".to_string()), json!({
            "runId": run_id,
            "answerPlan": answer_plan.clone()
        }).to_string()).await;

        match runner.mark_stage_running(&run_id, "orchestrate").await {
            Ok(run) => yield Ok(progress_event(&run_id, &run)),
            Err(error) => {
                yield Ok(workflow_error_event(&run_id, "orchestrate", error.to_string()));
                return;
            }
        }
        let _ = runner.mark_stage_done(&run_id, "orchestrate").await;

        match runner.mark_stage_running(&run_id, "prepare_context").await {
            Ok(run) => yield Ok(progress_event(&run_id, &run)),
            Err(error) => {
                yield Ok(workflow_error_event(&run_id, "prepare_context", error.to_string()));
                return;
            }
        }

        let (is_weft, origin_loom_id, origin_response_id) = match resolve_context_scope(
            &state.database,
            &workflow_loom_id,
        )
        .await
        {
            Ok(scope) => scope,
            Err(error) => {
                let _ = runner.mark_stage_failed(&run_id, "prepare_context", &error.to_string()).await;
                yield Ok(workflow_error_event(&run_id, "prepare_context", error.to_string()));
                return;
            }
        };
        let service_config = state.config.current();
        let context_window = match context_window_for_execution(
            &state.database,
            &workflow_loom_id,
            &execution_input,
            persisted_lifecycle.as_ref(),
            is_weft,
            origin_loom_id.as_deref(),
            origin_response_id.as_deref(),
            DEFAULT_MAX_RECENT_CONTEXT_PAIRS,
        )
        .await
        {
            Ok(window) => window,
            Err(error) => {
                let _ = runner.mark_stage_failed(&run_id, "prepare_context", &error.to_string()).await;
                yield Ok(workflow_error_event(&run_id, "prepare_context", error.to_string()));
                return;
            }
        };
        let attachment_reference_candidates = merge_attachment_reference_candidates(
            &context_references,
            &workflow_loom_id,
            context_window.attachment_reference_candidates(),
        );
        let attached_references = match attached_references_for_sources(
            &state.database,
            &execution_input.prompt,
            &attachment_reference_candidates,
        )
        .await
        {
            Ok(references) => references,
            Err(error) => {
                let _ = runner.mark_stage_failed(&run_id, "prepare_context", &error.to_string()).await;
                yield Ok(workflow_error_event(&run_id, "prepare_context", error.to_string()));
                return;
            }
        };
        let readiness_input = ContextReadinessInput {
            loom_id: workflow_loom_id.clone(),
            current_head_response_id: persisted_lifecycle
                .as_ref()
                .map(|lifecycle| lifecycle.user_response_id.clone())
                .or_else(|| execution_input.response_id.clone()),
            attached_references: attached_references.clone(),
            is_weft,
            origin_loom_id: origin_loom_id.clone(),
            origin_response_id: origin_response_id.clone(),
            context_strategy: context_strategy_for_readiness(&answer_plan.context_strategy),
            response_mode: context_response_mode(&execution_input.response_mode),
            resolved_num_ctx: execution_input.options.as_ref().and_then(|options| options.num_ctx).unwrap_or(2_048),
        };
        let gate = ContextReadinessGate::new(&state.database);
        let readiness = match gate.prepare(readiness_input).await {
            Ok(readiness) => readiness,
            Err(error) => {
                let _ = runner.mark_stage_failed(&run_id, "prepare_context", &error.to_string()).await;
                if let Some(lifecycle) = persisted_lifecycle.as_ref() {
                    let _ = update_persisted_assistant_status(
                        &state.database,
                        lifecycle,
                        "error",
                        None,
                        Some("context_readiness_error"),
                        Some(&error.to_string()),
                    )
                    .await;
                }
                yield Ok(workflow_error_event(&run_id, "prepare_context", error.to_string()));
                return;
            }
        };
        let readiness_value = serde_json::to_value(&readiness).unwrap_or_else(|_| json!({ "status": "unknown" }));
        let _ = runner.persist_event(run_id.clone(), "context.ready".to_string(), Some("prepare_context".to_string()), readiness_value.to_string()).await;
        yield Ok(to_sse_event(service_event(run_id.clone(), "context.ready", json!({
            "runId": run_id,
            "readiness": readiness
        }))));

        let recent_messages = context_window.messages();
        let memory_messages = match memory_messages_for_execution(&state.database, &service_config).await {
            Ok(messages) => messages,
            Err(error) => {
                yield Ok(to_sse_event(service_event(run_id.clone(), "context.ready", json!({
                    "runId": run_id,
                    "warning": "memory_context_unavailable",
                    "message": error.to_string()
                }))));
                Vec::new()
            }
        };
        let context_input = BuildContextInput {
            loom_id: workflow_loom_id.clone(),
            current_head_response_id: persisted_lifecycle
                .as_ref()
                .map(|lifecycle| lifecycle.user_response_id.clone())
                .or_else(|| execution_input.response_id.clone()),
            // Use the planner's rewritten_prompt so that fragment-anchored
            // rewrites (e.g. `explain: "The Process of Trilateration"`) reach
            // the context manager and the model.  The original prompt is
            // preserved in execution_input for diagnostics/logging.
            user_prompt: answer_plan.rewritten_prompt.clone(),
            attached_references,
            response_mode: context_response_mode(&execution_input.response_mode),
            resolved_num_ctx: execution_input.options.as_ref().and_then(|options| options.num_ctx).unwrap_or(2_048),
            answer_plan: None,
            source: if is_weft { ContextSource::Weft } else { ContextSource::Composer },
            weft_origin: None,
            checkpoint: None,
            memory_messages,
            recent_messages,
        };
        let strategy_decision = match resolve_service_execution_strategy(
            &state.database,
            strategy_input_from_execute(&execution_input, &built_context_size_hint(&context_input)),
        )
        .await
        {
            Ok(decision) => Some(decision),
            Err(error) => {
                yield Ok(to_sse_event(service_event(run_id.clone(), "context.ready", json!({
                    "runId": run_id,
                    "warning": "context_budget_strategy_unavailable",
                    "message": error.to_string()
                }))));
                None
            }
        };
        let context_repository = crate::storage::repositories::context_artifacts::ContextArtifactsRepository::new(&state.database);
        let context_manager = ContextManager::with_repository(Some(service_config.context.clone()), context_repository);
        let built_context = match context_manager
            .build_context_with_repositories_and_strategy(context_input, strategy_decision.as_ref())
            .await
        {
            Ok(context) => context,
            Err(error) => {
                let _ = runner.mark_stage_failed(&run_id, "prepare_context", &error.to_string()).await;
                if let Some(lifecycle) = persisted_lifecycle.as_ref() {
                    let _ = update_persisted_assistant_status(
                        &state.database,
                        lifecycle,
                        "error",
                        None,
                        Some("context_build_error"),
                        Some(&error.to_string()),
                    )
                    .await;
                }
                yield Ok(workflow_error_event(&run_id, "prepare_context", error.to_string()));
                return;
            }
        };
        let message_count = built_context.messages.len();
        let warnings = built_context.warnings.clone();
        let _ = runner.persist_event(run_id.clone(), "context.built".to_string(), Some("prepare_context".to_string()), context_built_event_payload(
            &run_id,
            message_count,
            warnings,
            &built_context,
        ).to_string()).await;
        let _ = runner.mark_stage_done(&run_id, "prepare_context").await;

        match runner.mark_stage_running(&run_id, "generate").await {
            Ok(run) => yield Ok(progress_event(&run_id, &run)),
            Err(error) => {
                yield Ok(workflow_error_event(&run_id, "generate", error.to_string()));
                return;
            }
        }

        if should_fail_initial_e2e_prompt(&execution_input) {
            let message = "Deterministic E2E failed placeholder requested.";
            let _ = runner.mark_stage_failed(&run_id, "generate", "e2e_failed_placeholder").await;
            if let Some(lifecycle) = persisted_lifecycle.as_ref() {
                let _ = update_persisted_assistant_status(
                    &state.database,
                    lifecycle,
                    "error",
                    Some("error"),
                    Some("e2e_failed_placeholder"),
                    Some(message),
                )
                .await;
            }
            schedule_context_artifact_job(&state.database, persisted_lifecycle.as_ref()).await;
            let payload = merge_response_ids(json!({
                "runId": run_id,
                "stage": "generate",
                "kind": "e2e_failed_placeholder",
                "message": message,
                "elapsedMs": started.elapsed().as_millis()
            }), persisted_lifecycle.as_ref());
            let _ = runner
                .persist_event(
                    run_id.clone(),
                    "response.error".to_string(),
                    Some("generate".to_string()),
                    payload.to_string(),
                )
                .await;
            yield Ok(to_sse_event(service_event(run_id.clone(), "response.error", payload)));
            return;
        }

        if let Some(answer) = deterministic_e2e_answer(&execution_input, &built_context) {
            let e2e_thinking_delay_ms = deterministic_e2e_thinking_delay_ms();
            if answer_plan.use_thinking && e2e_thinking_delay_ms > 0 {
                let thinking_started_at = Instant::now();
                let first_thinking_delta = [
                    "**Plan:**",
                    "- Reviewing the prompt and `Loom` context.",
                    "Checking selected references and recent visible turns.",
                    "Separating source context from the latest user request.",
                    "Estimating the response shape and useful detail level.",
                    "Keeping hidden provider reasoning out of persisted artifacts.",
                    "Preparing a concise response plan before visible answer tokens.",
                    "Confirming the final answer should stay grounded in the Loom.",
                    "Checking that transient notes stay attached only to this active run.",
                    "Comparing the response outline with the requested Loom surface.",
                    "Prioritizing source-backed claims over speculative filler.",
                    "Keeping the eventual assistant response free of private planning text.",
                    "Verifying that the visible answer can start from stable context.",
                    "Holding the remaining reasoning in the live panel only.",
                    "Preparing the final response shape and section order.",
                    "Reviewing whether a short answer would miss important nuance.",
                    "Separating durable response content from temporary provider notes.",
                    "Making sure reload will reconstruct only the visible answer.",
                    "Leaving copy/export/persistence paths with answer text only.",
                    "Using the live panel as a temporary progress window.",
                    "Ready to start the visible answer stream.",
                    "",
                ]
                .join("\n");
                yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                    "runId": run_id,
                    "thinkingDelta": first_thinking_delta,
                    "transient": true
                }))));
                yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                    "runId": run_id,
                    "thinking": {
                        "status": "active",
                        "durationMs": thinking_started_at.elapsed().as_millis()
                    }
                }))));
                sleep(Duration::from_millis(e2e_thinking_delay_ms)).await;
                let second_thinking_delta = [
                    "Rechecking answer outline against the requested response mode.",
                    "",
                ]
                .join("\n");
                yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                    "runId": run_id,
                    "thinkingDelta": second_thinking_delta,
                    "transient": true
                }))));
                yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                    "runId": run_id,
                    "thinking": {
                        "status": "active",
                        "durationMs": thinking_started_at.elapsed().as_millis()
                    }
                }))));
                sleep(Duration::from_millis(e2e_thinking_delay_ms)).await;
                let third_thinking_delta = [
                    "Discarding transient reasoning before persistence.",
                    "",
                ]
                .join("\n");
                yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                    "runId": run_id,
                    "thinkingDelta": third_thinking_delta,
                    "transient": true
                }))));
                yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                    "runId": run_id,
                    "thinking": {
                        "status": "active",
                        "durationMs": thinking_started_at.elapsed().as_millis()
                    }
                }))));
                sleep(Duration::from_millis(e2e_thinking_delay_ms)).await;
                let fourth_thinking_delta = [
                    "Starting the visible answer now.",
                    "",
                ]
                .join("\n");
                yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                    "runId": run_id,
                    "thinkingDelta": fourth_thinking_delta,
                    "transient": true
                }))));
                yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                    "runId": run_id,
                    "thinking": {
                        "status": "active",
                        "durationMs": thinking_started_at.elapsed().as_millis()
                    }
                }))));
                sleep(Duration::from_millis(e2e_thinking_delay_ms)).await;
            }
            let chunk_delay_ms = deterministic_e2e_stream_chunk_delay_ms();
            for chunk in deterministic_e2e_answer_chunks(&answer, chunk_delay_ms) {
                if chunk_delay_ms > 0 {
                    sleep(Duration::from_millis(chunk_delay_ms)).await;
                }
                if let Some(lifecycle) = persisted_lifecycle.as_mut() {
                    lifecycle.assistant_content.push_str(&chunk);
                    let _ = update_persisted_assistant_content(&state.database, lifecycle).await;
                }
                let payload = merge_response_ids(json!({
                    "runId": run_id,
                    "delta": chunk,
                    "content": chunk
                }), persisted_lifecycle.as_ref());
                let _ = runner
                    .persist_event(
                        run_id.clone(),
                        "response.delta".to_string(),
                        Some("generate".to_string()),
                        payload.to_string(),
                    )
                    .await;
                yield Ok(to_sse_event(service_event(run_id.clone(), "response.delta", payload)));
            }
            let _ = runner.mark_stage_done(&run_id, "generate").await;
            if let Some(lifecycle) = persisted_lifecycle.as_ref() {
                let _ = update_persisted_assistant_status(
                    &state.database,
                    lifecycle,
                    "completed",
                    Some("stop"),
                    None,
                    None,
                )
                .await;
            }
            schedule_context_artifact_job(&state.database, persisted_lifecycle.as_ref()).await;
            if let Ok(run) = complete_successful_execution_stages(&runner, &run_id).await {
                yield Ok(progress_event(&run_id, &run));
            }
            let payload = merge_response_ids(json!({
                "runId": run_id,
                "elapsedMs": started.elapsed().as_millis(),
                "doneReason": "stop"
            }), persisted_lifecycle.as_ref());
            let _ = runner
                .persist_event(
                    run_id.clone(),
                    "response.completed".to_string(),
                    Some("generate".to_string()),
                    payload.to_string(),
                )
                .await;
            yield Ok(to_sse_event(service_event(
                run_id.clone(),
                "response.completed",
                payload,
            )));
            return;
        }

        let provider_pipeline = match create_provider_pipeline_for_request(
            state.ollama.clone(),
            &service_config,
            &state.secret_store,
            execution_input.provider_profile_id.as_deref(),
        ) {
            Ok(pipeline) => pipeline,
            Err(error_msg) => {
                let message = error_msg;
                let _ = runner.mark_stage_failed(&run_id, "generate", "provider_resolution_error").await;
                if let Some(lifecycle) = persisted_lifecycle.as_ref() {
                    let _ = update_persisted_assistant_status(
                        &state.database,
                        lifecycle,
                        "error",
                        Some("error"),
                        Some("provider_resolution_error"),
                        Some(&message),
                    )
                    .await;
                }
                schedule_context_artifact_job(&state.database, persisted_lifecycle.as_ref()).await;
                let payload = merge_response_ids(json!({
                    "runId": run_id,
                    "stage": "generate",
                    "kind": "provider_resolution_error",
                    "message": message,
                    "elapsedMs": started.elapsed().as_millis()
                }), persisted_lifecycle.as_ref());
                let _ = runner
                    .persist_event(
                        run_id.clone(),
                        "response.error".to_string(),
                        Some("generate".to_string()),
                        payload.to_string(),
                    )
                    .await;
                yield Ok(to_sse_event(service_event(run_id.clone(), "response.error", payload)));
                return;
            }
        };
        let provider_profile = provider_pipeline.default_generation_profile();
        let provider_capabilities = provider_pipeline.default_generation_capabilities();
        let provider_model_id = if execution_input.provider_profile_id.is_some() {
            execution_input.model.clone()
        } else {
            provider_profile
                .provider_profile_id
                .eq(service_config.providers.main_provider_profile_id.as_deref().unwrap_or(""))
                .then(|| service_config.providers.main_model_id.clone())
                .flatten()
                .or(provider_profile.default_model.clone())
                .unwrap_or_else(|| execution_input.model.clone())
        };
        let provider_request = ProviderContractRequest {
            provider_kind: provider_profile.provider_kind,
            provider_profile_id: provider_profile.provider_profile_id,
            model_id: provider_model_id,
            messages: built_context
                .messages
                .into_iter()
                .map(|message| ProviderContractMessage {
                    role: match message.role {
                        crate::context::types::ContextMessageRole::System => {
                            ProviderContractMessageRole::System
                        }
                        crate::context::types::ContextMessageRole::User => {
                            ProviderContractMessageRole::User
                        }
                        crate::context::types::ContextMessageRole::Assistant => {
                            ProviderContractMessageRole::Assistant
                        }
                    },
                    content: message.content,
                })
                .collect(),
            options: ProviderContractOptions {
                temperature: execution_input
                    .options
                    .as_ref()
                    .and_then(|options| options.temperature),
                top_p: None,
                max_tokens: execution_input
                    .options
                    .as_ref()
                    .and_then(|options| options.num_predict),
                context_tokens: execution_input
                    .options
                    .as_ref()
                    .and_then(|options| options.num_ctx),
                thinking: Some(answer_plan.use_thinking),
            },
            stream: true,
            request_id: run_id.clone(),
            runtime_metadata: json!({
                "source": "orchestration.execute_stream",
                "responseMode": execution_input.response_mode,
                "capabilities": provider_capabilities,
            }),
            loom_context_metadata: json!({
                "contextBuilt": true,
            }),
        };

        let mut provider_stream = provider_pipeline.stream_chat(provider_request);
        while let Some(provider_event) = provider_stream.next().await {
            match provider_event {
                ProviderContractEvent::ThinkingDelta { text } => {
                    yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                        "runId": run_id,
                        "thinkingDelta": text,
                        "transient": true
                    }))));
                }
                ProviderContractEvent::ThinkingStatus {
                    status,
                    duration_ms,
                    token_estimate,
                } => {
                    yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
                        "runId": run_id,
                        "thinking": {
                            "status": status,
                            "durationMs": duration_ms,
                            "tokenEstimate": token_estimate
                        }
                    }))));
                }
                ProviderContractEvent::Delta { text } => {
                    if let Some(lifecycle) = persisted_lifecycle.as_mut() {
                        lifecycle.assistant_content.push_str(&text);
                        let _ = update_persisted_assistant_content(&state.database, lifecycle).await;
                    }
                    let payload = merge_response_ids(json!({
                        "runId": run_id,
                        "delta": text,
                        "content": text
                    }), persisted_lifecycle.as_ref());
                    let _ = runner
                        .persist_event(
                            run_id.clone(),
                            "response.delta".to_string(),
                            Some("generate".to_string()),
                            payload.to_string(),
                        )
                        .await;
                    yield Ok(to_sse_event(service_event(run_id.clone(), "response.delta", payload)));
                }
                ProviderContractEvent::Completed { done_reason, usage } => {
                    let event_type = if done_reason.as_deref().is_some_and(done_reason_is_length) {
                        "response.truncated"
                    } else {
                        "response.completed"
                    };
                    let (prompt_token_count, eval_token_count) = match usage {
                        ProviderUsageMetadata::Available {
                            prompt_tokens,
                            completion_tokens,
                            total_tokens: _,
                        } => (prompt_tokens, completion_tokens),
                        ProviderUsageMetadata::Unavailable { .. } => (None, None),
                    };
                    let _ = runner.mark_stage_done(&run_id, "generate").await;
                    if let Some(lifecycle) = persisted_lifecycle.as_ref() {
                        let _ = update_persisted_assistant_status(
                            &state.database,
                            lifecycle,
                            if event_type == "response.truncated" { "truncated" } else { "completed" },
                            done_reason.as_deref(),
                            None,
                            None,
                        )
                        .await;
                        let elapsed_ms = started.elapsed().as_millis() as u64;
                        let _ = crate::storage::repositories::responses::ResponseRepository::new(&state.database)
                            .update_response_inference_metadata(
                                &lifecycle.assistant_response_id,
                                Some(elapsed_ms),
                                eval_token_count,
                            )
                            .await;
                    }
                    schedule_context_artifact_job(&state.database, persisted_lifecycle.as_ref()).await;
                    if let Ok(run) = complete_successful_execution_stages(&runner, &run_id).await {
                        yield Ok(progress_event(&run_id, &run));
                    }
                    let payload = merge_response_ids(json!({
                        "runId": run_id,
                        "elapsedMs": started.elapsed().as_millis(),
                        "doneReason": done_reason,
                        "evalTokenCount": eval_token_count,
                        "promptTokenCount": prompt_token_count
                    }), persisted_lifecycle.as_ref());
                    let _ = runner.persist_event(run_id.clone(), event_type.to_string(), Some("generate".to_string()), payload.to_string()).await;
                    yield Ok(to_sse_event(service_event(run_id.clone(), event_type, payload)));
                    return;
                }
                ProviderContractEvent::Truncated { done_reason, usage } => {
                    let event_type = "response.truncated";
                    let (prompt_token_count, eval_token_count) = match usage {
                        ProviderUsageMetadata::Available {
                            prompt_tokens,
                            completion_tokens,
                            total_tokens: _,
                        } => (prompt_tokens, completion_tokens),
                        ProviderUsageMetadata::Unavailable { .. } => (None, None),
                    };
                    let _ = runner.mark_stage_done(&run_id, "generate").await;
                    if let Some(lifecycle) = persisted_lifecycle.as_ref() {
                        let _ = update_persisted_assistant_status(
                            &state.database,
                            lifecycle,
                            if event_type == "response.truncated" { "truncated" } else { "completed" },
                            done_reason.as_deref(),
                            None,
                            None,
                        )
                        .await;
                        let elapsed_ms = started.elapsed().as_millis() as u64;
                        let _ = crate::storage::repositories::responses::ResponseRepository::new(&state.database)
                            .update_response_inference_metadata(
                                &lifecycle.assistant_response_id,
                                Some(elapsed_ms),
                                eval_token_count,
                            )
                            .await;
                    }
                    schedule_context_artifact_job(&state.database, persisted_lifecycle.as_ref()).await;
                    if let Ok(run) = complete_successful_execution_stages(&runner, &run_id).await {
                        yield Ok(progress_event(&run_id, &run));
                    }
                    let payload = merge_response_ids(json!({
                        "runId": run_id,
                        "elapsedMs": started.elapsed().as_millis(),
                        "doneReason": done_reason,
                        "evalTokenCount": eval_token_count,
                        "promptTokenCount": prompt_token_count
                    }), persisted_lifecycle.as_ref());
                    let _ = runner.persist_event(run_id.clone(), event_type.to_string(), Some("generate".to_string()), payload.to_string()).await;
                    yield Ok(to_sse_event(service_event(run_id.clone(), event_type, payload)));
                    return;
                }
                ProviderContractEvent::Cancelled => {
                    let _ = runner.mark_stage_failed(&run_id, "generate", "cancelled").await;
                    if let Some(lifecycle) = persisted_lifecycle.as_ref() {
                        let _ = update_persisted_assistant_status(
                            &state.database,
                            lifecycle,
                            "cancelled",
                            None,
                            None,
                            None,
                        )
                        .await;
                    }
                    schedule_context_artifact_job(&state.database, persisted_lifecycle.as_ref()).await;
                    let payload = merge_response_ids(json!({
                        "runId": run_id,
                        "elapsedMs": started.elapsed().as_millis()
                    }), persisted_lifecycle.as_ref());
                    let _ = runner
                        .persist_event(
                            run_id.clone(),
                            "response.cancelled".to_string(),
                            Some("generate".to_string()),
                            payload.to_string(),
                        )
                        .await;
                    yield Ok(to_sse_event(service_event(run_id.clone(), "response.cancelled", payload)));
                    return;
                }
                ProviderContractEvent::Error { error } => {
                    let _ = runner.mark_stage_failed(&run_id, "generate", &format!("{:?}", error.kind)).await;
                    if let Some(lifecycle) = persisted_lifecycle.as_ref() {
                        let message = error
                            .technical_message
                            .as_deref()
                            .unwrap_or(&error.user_message);
                        let _ = update_persisted_assistant_status(
                            &state.database,
                            lifecycle,
                            "error",
                            None,
                            Some(&format!("{:?}", error.kind)),
                            Some(message),
                        )
                        .await;
                    }
                    schedule_context_artifact_job(&state.database, persisted_lifecycle.as_ref()).await;
                    yield Ok(provider_error_event(
                        &run_id,
                        &execution_input.model,
                        &error,
                        started.elapsed().as_millis(),
                        persisted_lifecycle.as_ref(),
                    ));
                    return;
                }
            }
        }
    }
}

fn deep_synthesis_stream(
    state: crate::api::state::AppState,
    input: DeepSynthesisRequest,
) -> impl Stream<Item = Result<Event, Infallible>> {
    stream! {
        let started = Instant::now();
        let request_id = format!("deep-{}", unix_timestamp_millis());
        let _operation_guard = state.operations.start(request_id.clone(), OperationKind::ModelGeneration);
        let runner = RepositoryWorkflowRunner::new(&state.database);
        let workflow_loom_id = input.loom_id.clone().unwrap_or_else(|| "prototype-loom".to_string());
        let strategy_input = strategy_input_from_request(&input);

        let decision = match input.strategy.clone() {
            Some(decision) => decision,
            None => {
                match resolve_service_execution_strategy(&state.database, strategy_input).await {
                    Ok(decision) => decision,
                    Err(error) => {
                        yield Ok(to_sse_event(service_event(request_id.clone(), "response.error", json!({
                            "runId": Value::Null,
                            "stage": "planning_synthesis",
                            "kind": "strategy_resolution_error",
                            "message": error.to_string()
                        }))));
                        return;
                    }
                }
            }
        };

        let plan = match plan_deep_synthesis(&input, &decision) {
            Ok(plan) => plan,
            Err(error) => {
                yield Ok(to_sse_event(service_event(request_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "planning_synthesis",
                    "kind": error.kind,
                    "message": error.message
                }))));
                return;
            }
        };

        if let Err(error) = ensure_deep_synthesis_model_ready(&state.ollama, &input.model_name).await {
            yield Ok(to_sse_event(service_event(request_id.clone(), "response.error", json!({
                "runId": Value::Null,
                "stage": "planning_synthesis",
                "kind": format!("{:?}", error.kind),
                "message": error.message
            }))));
            return;
        }

        let metadata_json = match serde_json::to_string(&json!({
            "source": "deep_synthesis",
            "strategy": &decision,
            "plan": &plan,
        })) {
            Ok(value) => value,
            Err(error) => {
                yield Ok(to_sse_event(service_event(request_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "planning_synthesis",
                    "kind": "serialization_error",
                    "message": error.to_string()
                }))));
                return;
            }
        };
        if contains_forbidden_raw_thinking(&serde_json::json!({ "metadata": metadata_json })) {
            yield Ok(to_sse_event(service_event(request_id.clone(), "response.error", json!({
                "runId": Value::Null,
                "stage": "planning_synthesis",
                "kind": "raw_thinking_rejected",
                "message": "Deep Synthesis metadata contains forbidden raw thinking fields."
            }))));
            return;
        }

        let run = match runner.create_run(Some(workflow_loom_id), None, Some(metadata_json)).await {
            Ok(run) => run,
            Err(error) => {
                yield Ok(to_sse_event(service_event(request_id.clone(), "response.error", json!({
                    "runId": Value::Null,
                    "stage": "planning_synthesis",
                    "kind": "workflow_persistence_error",
                    "message": error.to_string()
                }))));
                return;
            }
        };
        let run_id = run.run_id.clone();
        let mut cancel_rx = state.ollama.register_cancellation(&run_id);

        yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
            "runId": run_id,
            "statusText": "Planning synthesis",
            "strategy": &plan.strategy,
            "maxParallelism": plan.max_parallelism
        }))));
        yield Ok(to_sse_event(service_event(run_id.clone(), "answer_plan.ready", json!({
            "runId": run_id,
            "deepSynthesisPlan": &plan
        }))));

        match runner.mark_stage_running(&run_id, "orchestrate").await {
            Ok(run) => yield Ok(progress_event(&run_id, &run)),
            Err(error) => {
                yield Ok(workflow_error_event(&run_id, "orchestrate", error.to_string()));
                state.ollama.finish_request(&run_id);
                return;
            }
        }
        let _ = runner.persist_event(run_id.clone(), "deep_synthesis.plan_ready".to_string(), Some("orchestrate".to_string()), json!({
            "runId": run_id,
            "plan": &plan,
        }).to_string()).await;
        let _ = runner.mark_stage_done(&run_id, "orchestrate").await;

        match runner.mark_stage_running(&run_id, "generate").await {
            Ok(run) => yield Ok(progress_event(&run_id, &run)),
            Err(error) => {
                yield Ok(workflow_error_event(&run_id, "generate", error.to_string()));
                state.ollama.finish_request(&run_id);
                return;
            }
        }

        yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
            "runId": run_id,
            "statusText": "Writing drafts"
        }))));

        let draft_result = run_live_deep_synthesis_drafts(&state.ollama, &run_id, &input, &plan, &mut cancel_rx, |event_type, payload| {
            to_sse_event(service_event(run_id.clone(), event_type, payload))
        }).await;
        let drafts = match draft_result {
            LiveDeepSynthesisDraftResult::Completed { drafts, events } => {
                for event in events {
                    yield Ok(event);
                }
                drafts
            }
            LiveDeepSynthesisDraftResult::Cancelled { events } => {
                for event in events {
                    yield Ok(event);
                }
                let _ = runner.mark_stage_cancelled(&run_id, "generate").await;
                yield Ok(to_sse_event(service_event(run_id.clone(), "response.cancelled", json!({
                    "runId": run_id,
                    "elapsedMs": started.elapsed().as_millis()
                }))));
                state.ollama.finish_request(&run_id);
                return;
            }
            LiveDeepSynthesisDraftResult::Failed { message, events } => {
                for event in events {
                    yield Ok(event);
                }
                let _ = runner.mark_stage_failed(&run_id, "generate", &message).await;
                yield Ok(to_sse_event(service_event(run_id.clone(), "response.error", json!({
                    "runId": run_id,
                    "stage": "generate",
                    "kind": "deep_synthesis_drafts_failed",
                    "message": message
                }))));
                state.ollama.finish_request(&run_id);
                return;
            }
        };

        yield Ok(to_sse_event(service_event(run_id.clone(), "deep_synthesis.synthesis_started", json!({
            "runId": run_id,
            "draftCount": drafts.len()
        }))));
        yield Ok(to_sse_event(service_event(run_id.clone(), "orchestration.progress", json!({
            "runId": run_id,
            "statusText": "Synthesizing final answer"
        }))));
        let final_answer = match run_live_deep_synthesis_synthesis(&state.ollama, &run_id, &input, &plan, &drafts, &mut cancel_rx).await {
            LiveSynthesisResult::Completed(answer) => answer,
            LiveSynthesisResult::Fallback { answer, warning } => {
                yield Ok(to_sse_event(service_event(run_id.clone(), "deep_synthesis.synthesis_failed", json!({
                    "runId": run_id,
                    "warning": warning,
                    "fallback": true
                }))));
                answer
            }
            LiveSynthesisResult::Cancelled => {
                let _ = runner.mark_stage_cancelled(&run_id, "generate").await;
                yield Ok(to_sse_event(service_event(run_id.clone(), "response.cancelled", json!({
                    "runId": run_id,
                    "elapsedMs": started.elapsed().as_millis()
                }))));
                state.ollama.finish_request(&run_id);
                return;
            }
            LiveSynthesisResult::Failed(message) => {
                let _ = runner.mark_stage_failed(&run_id, "generate", &message).await;
                yield Ok(to_sse_event(service_event(run_id.clone(), "response.error", json!({
                    "runId": run_id,
                    "stage": "generate",
                    "kind": "deep_synthesis_failed",
                    "message": message
                }))));
                state.ollama.finish_request(&run_id);
                return;
            }
        };
        if contains_forbidden_raw_thinking(&json!({ "finalAnswer": final_answer })) {
            let _ = runner.mark_stage_failed(&run_id, "generate", "raw thinking rejected").await;
            yield Ok(to_sse_event(service_event(run_id.clone(), "response.error", json!({
                "runId": run_id,
                "stage": "generate",
                "kind": "raw_thinking_rejected",
                "message": "Deep Synthesis output contained forbidden raw thinking fields."
            }))));
            state.ollama.finish_request(&run_id);
            return;
        }
        let _ = runner.persist_event(run_id.clone(), "deep_synthesis.drafts_ready".to_string(), Some("generate".to_string()), json!({
            "runId": run_id,
            "draftCount": drafts.len(),
            "strategy": &plan.strategy,
        }).to_string()).await;
        let _ = runner.mark_stage_done(&run_id, "generate").await;

        yield Ok(to_sse_event(service_event(run_id.clone(), "response.delta", json!({
            "runId": run_id,
            "delta": final_answer,
            "content": final_answer
        }))));
        if let Ok(run) = complete_successful_execution_stages(&runner, &run_id).await {
            yield Ok(progress_event(&run_id, &run));
        }
        let payload = json!({
            "runId": run_id,
            "elapsedMs": started.elapsed().as_millis(),
            "strategy": &plan.strategy,
            "draftCount": drafts.len(),
            "doneReason": "stop"
        });
        let _ = runner.persist_event(run_id.clone(), "response.completed".to_string(), Some("generate".to_string()), payload.to_string()).await;
        yield Ok(to_sse_event(service_event(run_id.clone(), "response.completed", payload)));
        state.ollama.finish_request(&run_id);
    }
}

async fn resolve_service_execution_strategy(
    database: &crate::storage::db::Database,
    input: crate::capabilities::strategy::ResolveExecutionStrategyInput,
) -> Result<crate::capabilities::ExecutionStrategyDecision, crate::error::ServiceError> {
    let repo = crate::capabilities::CapabilityRepository::new(database);
    repo.seed_model_catalog(&crate::capabilities::default_model_catalog_entries())
        .await?;
    let snapshot = match repo.latest_system_snapshot().await? {
        Some(snapshot) => snapshot,
        None => {
            let snapshot = crate::capabilities::detect_system_resources();
            repo.insert_system_snapshot(&snapshot).await?;
            snapshot
        }
    };
    let model = repo
        .find_model(
            input.model_id.as_deref(),
            input.provider.as_deref(),
            input.model_name.as_deref(),
        )
        .await?;
    let benchmark = match model.as_ref() {
        Some(model) => repo.latest_benchmark_for_model(&model.model_id).await?,
        None => None,
    };
    let provider = input
        .provider
        .as_deref()
        .or_else(|| model.as_ref().map(|value| value.provider.as_str()));
    let model_name = input
        .model_name
        .as_deref()
        .or_else(|| model.as_ref().map(|value| value.model_name.as_str()));
    let community_entries = match (provider, model_name) {
        (Some(provider), Some(model_name)) => {
            repo.community_baselines(
                provider,
                model_name,
                crate::capabilities::strategy::prompt_kind_name(&input.prompt_kind),
            )
            .await?
        }
        _ => Vec::new(),
    };
    let decision = if community_entries.is_empty() {
        crate::capabilities::resolve_execution_strategy(
            &input,
            Some(&snapshot),
            model.as_ref(),
            benchmark.as_ref(),
        )
    } else {
        crate::capabilities::resolve_execution_strategy_with_community_entries(
            &input,
            Some(&snapshot),
            model.as_ref(),
            benchmark.as_ref(),
            &community_entries,
        )
    };
    repo.insert_strategy_decision(&decision).await?;
    Ok(decision)
}

enum LiveDeepSynthesisDraftResult {
    Completed {
        drafts: Vec<DeepSynthesisDraft>,
        events: Vec<Event>,
    },
    Failed {
        message: String,
        events: Vec<Event>,
    },
    Cancelled {
        events: Vec<Event>,
    },
}

enum LiveSynthesisResult {
    Completed(String),
    Fallback { answer: String, warning: String },
    Failed(String),
    Cancelled,
}

async fn ensure_deep_synthesis_model_ready(
    ollama: &OllamaRuntime,
    model_name: &str,
) -> Result<(), OllamaRuntimeError> {
    let models = ollama.models().await?;
    if models.models.iter().any(|model| model == model_name) {
        Ok(())
    } else {
        Err(OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::ModelMissing,
            "Selected model is not installed in Ollama.",
            true,
        ))
    }
}

async fn run_live_deep_synthesis_drafts(
    ollama: &OllamaRuntime,
    run_id: &str,
    input: &DeepSynthesisRequest,
    plan: &crate::orchestration::deep_synthesis::DeepSynthesisPlan,
    cancel_rx: &mut tokio::sync::watch::Receiver<bool>,
    event: impl Fn(&str, Value) -> Event,
) -> LiveDeepSynthesisDraftResult {
    let mut events = Vec::new();
    match plan.strategy {
        crate::capabilities::strategy::ExecutionStrategy::SectionedSequential => {
            let mut drafts = Vec::new();
            for section in &plan.sections {
                if *cancel_rx.borrow() {
                    return LiveDeepSynthesisDraftResult::Cancelled { events };
                }
                events.push(event(
                    "deep_synthesis.draft_started",
                    json!({
                        "runId": run_id,
                        "draftId": format!("draft-{}", section.section_id),
                        "workerRole": "section_writer",
                        "sectionId": section.section_id
                    }),
                ));
                let prompt = section_prompt(input, &section.title);
                let draft = tokio::select! {
                    _ = cancel_rx.changed() => {
                        return LiveDeepSynthesisDraftResult::Cancelled { events };
                    }
                    result = collect_provider_text(ollama.clone(), run_id, input.model_name.clone(), prompt, draft_options(plan), false, "deep_synthesis.draft") => result
                };
                match draft {
                    Ok(content) => {
                        let draft = DeepSynthesisDraft {
                            draft_id: format!("draft-{}", section.section_id),
                            worker_role: DeepSynthesisWorkerRole::SectionWriter,
                            content,
                            status: DeepSynthesisStepStatus::Done,
                        };
                        events.push(event(
                            "deep_synthesis.draft_completed",
                            json!({
                                "runId": run_id,
                                "draftId": draft.draft_id,
                                "workerRole": draft.worker_role
                            }),
                        ));
                        drafts.push(draft);
                    }
                    Err(error) => {
                        events.push(event(
                            "deep_synthesis.draft_failed",
                            json!({
                                "runId": run_id,
                                "workerRole": "section_writer",
                                "kind": format!("{:?}", error.kind),
                                "message": error.message
                            }),
                        ));
                    }
                }
            }
            if drafts.is_empty() {
                LiveDeepSynthesisDraftResult::Failed {
                    message: "All section workers failed.".to_string(),
                    events,
                }
            } else {
                LiveDeepSynthesisDraftResult::Completed { drafts, events }
            }
        }
        _ => {
            let mut futures = futures_util::stream::FuturesUnordered::new();
            for role in &plan.draft_workers {
                events.push(event(
                    "deep_synthesis.draft_started",
                    json!({
                        "runId": run_id,
                        "draftId": format!("draft-{:?}", role).to_ascii_lowercase(),
                        "workerRole": role
                    }),
                ));
                let ollama = ollama.clone();
                let model = input.model_name.clone();
                let prompt = role_prompt(input, role);
                let options = draft_options(plan);
                let role = role.clone();
                let run_id = run_id.to_string();
                futures.push(async move {
                    let result = collect_provider_text(
                        ollama,
                        &run_id,
                        model,
                        prompt,
                        options,
                        false,
                        "deep_synthesis.draft",
                    )
                    .await;
                    (role, result)
                });
            }

            let mut drafts = Vec::new();
            while let Some((role, result)) = tokio::select! {
                _ = cancel_rx.changed() => {
                    return LiveDeepSynthesisDraftResult::Cancelled { events };
                }
                result = futures.next() => result
            } {
                match result {
                    Ok(content) => {
                        let draft = DeepSynthesisDraft {
                            draft_id: format!("draft-{:?}", role).to_ascii_lowercase(),
                            worker_role: role,
                            content,
                            status: DeepSynthesisStepStatus::Done,
                        };
                        events.push(event(
                            "deep_synthesis.draft_completed",
                            json!({
                                "runId": run_id,
                                "draftId": draft.draft_id,
                                "workerRole": draft.worker_role
                            }),
                        ));
                        drafts.push(draft);
                    }
                    Err(error) => {
                        events.push(event(
                            "deep_synthesis.draft_failed",
                            json!({
                                "runId": run_id,
                                "workerRole": role,
                                "kind": format!("{:?}", error.kind),
                                "message": error.message
                            }),
                        ));
                    }
                }
            }

            let minimum = minimum_successful_drafts(plan);
            if drafts.len() < minimum {
                LiveDeepSynthesisDraftResult::Failed {
                    message: format!(
                        "Deep Synthesis requires at least {minimum} successful drafts for this strategy."
                    ),
                    events,
                }
            } else {
                LiveDeepSynthesisDraftResult::Completed { drafts, events }
            }
        }
    }
}

async fn run_live_deep_synthesis_synthesis(
    ollama: &OllamaRuntime,
    run_id: &str,
    input: &DeepSynthesisRequest,
    plan: &crate::orchestration::deep_synthesis::DeepSynthesisPlan,
    drafts: &[DeepSynthesisDraft],
    cancel_rx: &mut tokio::sync::watch::Receiver<bool>,
) -> LiveSynthesisResult {
    let prompt = synthesis_prompt(input, drafts);
    let result = tokio::select! {
        _ = cancel_rx.changed() => LiveSynthesisResult::Cancelled,
        result = collect_provider_text(ollama.clone(), run_id, input.model_name.clone(), prompt, synthesis_options(plan), false, "deep_synthesis.synthesis") => {
            match result {
                Ok(answer) if !answer.trim().is_empty() => LiveSynthesisResult::Completed(answer),
                Ok(_) => best_available_draft(drafts)
                    .map(|answer| LiveSynthesisResult::Fallback {
                        answer,
                        warning: "Synthesis returned empty output; using best available draft.".to_string(),
                    })
                    .unwrap_or_else(|| LiveSynthesisResult::Failed("Synthesis returned empty output.".to_string())),
                Err(error) => best_available_draft(drafts)
                    .map(|answer| LiveSynthesisResult::Fallback {
                        answer,
                        warning: format!("Synthesis failed with {:?}; using best available draft.", error.kind),
                    })
                    .unwrap_or_else(|| LiveSynthesisResult::Failed(error.message)),
            }
        }
    };
    result
}

async fn collect_provider_text(
    ollama: OllamaRuntime,
    run_id: &str,
    model: String,
    prompt: String,
    options: OllamaOptions,
    think: bool,
    source: &str,
) -> Result<String, OllamaRuntimeError> {
    let request = OllamaChatRequest {
        model,
        messages: vec![
            OllamaMessage {
                role: "system".to_string(),
                content: "You are a Deep Synthesis worker. Return only explicit draft or final answer text. Do not reveal hidden reasoning.".to_string(),
            },
            OllamaMessage {
                role: "user".to_string(),
                content: prompt,
            },
        ],
        stream: Some(true),
        think: Some(think),
        options: Some(options),
        request_id: Some(run_id.to_string()),
    };
    let pipeline = ProviderPipeline::new(ollama);
    let provider_request = provider_request_from_ollama_request(
        &pipeline,
        &request,
        json!({ "source": source }),
        json!({ "contextBuilt": false, "deepSynthesis": true }),
    );
    collect_provider_pipeline_text(&pipeline, provider_request).await
}

fn provider_request_from_ollama_request(
    pipeline: &ProviderPipeline,
    request: &OllamaChatRequest,
    runtime_metadata: Value,
    loom_context_metadata: Value,
) -> ProviderContractRequest {
    let provider_profile = pipeline.default_generation_profile();
    ProviderContractRequest {
        provider_kind: provider_profile.provider_kind,
        provider_profile_id: provider_profile.provider_profile_id,
        model_id: request.model.clone(),
        messages: request
            .messages
            .iter()
            .map(|message| ProviderContractMessage {
                role: match message.role.as_str() {
                    "system" => ProviderContractMessageRole::System,
                    "assistant" => ProviderContractMessageRole::Assistant,
                    _ => ProviderContractMessageRole::User,
                },
                content: message.content.clone(),
            })
            .collect(),
        options: ProviderContractOptions {
            temperature: request
                .options
                .as_ref()
                .and_then(|options| options.temperature),
            top_p: None,
            max_tokens: request
                .options
                .as_ref()
                .and_then(|options| options.num_predict),
            context_tokens: request.options.as_ref().and_then(|options| options.num_ctx),
            thinking: request.think,
        },
        stream: request.stream.unwrap_or(true),
        request_id: request
            .request_id
            .clone()
            .unwrap_or_else(|| "provider-pipeline-request".to_string()),
        runtime_metadata,
        loom_context_metadata,
    }
}

async fn collect_provider_pipeline_text(
    pipeline: &ProviderPipeline,
    provider_request: ProviderContractRequest,
) -> Result<String, OllamaRuntimeError> {
    let mut events = Vec::new();
    let mut provider_stream = pipeline.stream_chat(provider_request);
    while let Some(event) = provider_stream.next().await {
        events.push(event);
    }
    collect_provider_events_text(events)
}

fn collect_provider_events_text(
    events: impl IntoIterator<Item = ProviderContractEvent>,
) -> Result<String, OllamaRuntimeError> {
    let mut output = String::new();
    for event in events {
        match event {
            ProviderContractEvent::Delta { text } => output.push_str(&text),
            ProviderContractEvent::ThinkingDelta { .. } => {}
            ProviderContractEvent::ThinkingStatus { .. } => {}
            ProviderContractEvent::Completed { .. } | ProviderContractEvent::Truncated { .. } => {
                return Ok(output);
            }
            ProviderContractEvent::Cancelled => {
                return Err(OllamaRuntimeError::new(
                    OllamaRuntimeErrorKind::Aborted,
                    "Provider pipeline request was cancelled.",
                    true,
                ));
            }
            ProviderContractEvent::Error { error } => {
                return Err(ollama_error_from_provider_error(error));
            }
        }
    }
    Ok(output)
}

fn ollama_error_from_provider_error(error: ProviderError) -> OllamaRuntimeError {
    let kind = match error.kind {
        ProviderErrorKind::InvalidConfig
        | ProviderErrorKind::UnsafeEndpoint
        | ProviderErrorKind::RemoteEndpointBlocked
        | ProviderErrorKind::InsecureRemoteHttpBlocked
        | ProviderErrorKind::MissingSecret
        | ProviderErrorKind::SecretUnavailable => OllamaRuntimeErrorKind::InvalidConfig,
        ProviderErrorKind::RuntimeUnavailable
        | ProviderErrorKind::ConnectionRefused
        | ProviderErrorKind::DnsFailed
        | ProviderErrorKind::ServiceUnavailable => OllamaRuntimeErrorKind::RuntimeUnavailable,
        ProviderErrorKind::ModelMissing | ProviderErrorKind::ModelUnavailable => {
            OllamaRuntimeErrorKind::ModelMissing
        }
        ProviderErrorKind::TimeoutBeforeFirstChunk | ProviderErrorKind::RequestTimeout => {
            OllamaRuntimeErrorKind::TimeoutBeforeFirstChunk
        }
        ProviderErrorKind::TimeoutDuringStream => OllamaRuntimeErrorKind::TimeoutDuringStream,
        ProviderErrorKind::Cancelled => OllamaRuntimeErrorKind::Aborted,
        ProviderErrorKind::DoneReasonLength | ProviderErrorKind::OutputLimitReached => {
            OllamaRuntimeErrorKind::DoneReasonLength
        }
        ProviderErrorKind::ProviderRejectedThink => OllamaRuntimeErrorKind::ProviderRejectedThink,
        ProviderErrorKind::StreamParseError => OllamaRuntimeErrorKind::StreamParseError,
        _ => OllamaRuntimeErrorKind::UnexpectedResponse,
    };
    let message = error
        .technical_message
        .or(error.raw_provider_message)
        .unwrap_or(error.user_message);
    let mut runtime_error = OllamaRuntimeError::new(kind, message, error.retryable);
    if let Some(status) = error.status_code {
        runtime_error = runtime_error.with_status(status);
    }
    runtime_error
}

fn minimum_successful_drafts(
    plan: &crate::orchestration::deep_synthesis::DeepSynthesisPlan,
) -> usize {
    match plan.strategy {
        crate::capabilities::strategy::ExecutionStrategy::Parallel3DraftSynthesize => 2,
        _ => 1,
    }
}

fn best_available_draft(drafts: &[DeepSynthesisDraft]) -> Option<String> {
    drafts
        .iter()
        .max_by_key(|draft| draft.content.len())
        .map(|draft| draft.content.clone())
}

fn draft_options(plan: &crate::orchestration::deep_synthesis::DeepSynthesisPlan) -> OllamaOptions {
    let worker_count = plan.draft_workers.len().max(1) as u32;
    OllamaOptions {
        num_ctx: Some(4096),
        num_predict: Some(((plan.estimated_budget as u32) / worker_count).clamp(512, 2048)),
        temperature: Some(0.3),
    }
}

fn synthesis_options(
    plan: &crate::orchestration::deep_synthesis::DeepSynthesisPlan,
) -> OllamaOptions {
    OllamaOptions {
        num_ctx: Some(4096),
        num_predict: Some((plan.estimated_budget as u32).clamp(1024, 4096)),
        temperature: Some(0.2),
    }
}

fn role_prompt(input: &DeepSynthesisRequest, role: &DeepSynthesisWorkerRole) -> String {
    let role_instruction = match role {
        DeepSynthesisWorkerRole::ConciseDraft => "Write a concise direct draft.",
        DeepSynthesisWorkerRole::DetailedDraft => "Write a detailed structured draft.",
        DeepSynthesisWorkerRole::CriticalDraft => {
            "Write a critical draft that checks assumptions and gaps."
        }
        DeepSynthesisWorkerRole::SectionWriter => "Write a section draft.",
        DeepSynthesisWorkerRole::Synthesizer => "Synthesize final answer.",
    };
    format!(
        "{role_instruction}\n\nPrompt:\n{}\n\nReferences:\n{}",
        input.prompt,
        safe_references(&input.references)
    )
}

fn section_prompt(input: &DeepSynthesisRequest, section_title: &str) -> String {
    format!(
        "Write {section_title} for this Deep Synthesis request.\n\nPrompt:\n{}\n\nReferences:\n{}",
        input.prompt,
        safe_references(&input.references)
    )
}

fn synthesis_prompt(input: &DeepSynthesisRequest, drafts: &[DeepSynthesisDraft]) -> String {
    let drafts_text = drafts
        .iter()
        .map(|draft| format!("Draft {:?}:\n{}", draft.worker_role, draft.content))
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "Produce one final synthesized answer for the prompt below. Use only the explicit draft outputs. Do not reveal hidden reasoning.\n\nPrompt:\n{}\n\nDraft outputs:\n{}",
        input.prompt,
        drafts_text
    )
}

fn safe_references(
    references: &[crate::orchestration::deep_synthesis::DeepSynthesisReference],
) -> String {
    if references.is_empty() {
        return "None".to_string();
    }
    references
        .iter()
        .map(|reference| {
            format!(
                "- {}{}{}",
                reference
                    .label
                    .clone()
                    .unwrap_or_else(|| reference.reference_id.clone()),
                reference
                    .target_kind
                    .as_ref()
                    .map(|kind| format!(" ({kind})"))
                    .unwrap_or_default(),
                reference
                    .selected_text
                    .as_ref()
                    .map(|text| format!(": {}", text.chars().take(500).collect::<String>()))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn eval_prompt(prompt: &DeepSynthesisEvalPrompt) -> &'static str {
    match prompt {
        DeepSynthesisEvalPrompt::ShortFactual => "Yunanistan için 3 günlük kısa gezi planı yap.",
        DeepSynthesisEvalPrompt::LongForm => {
            "Event sourcing nedir, avantajlarını ve dezavantajlarını detaylı anlat."
        }
        DeepSynthesisEvalPrompt::Synthesis => {
            "SQLite, PostgreSQL ve Qdrant kullanımını Loom için karşılaştır."
        }
    }
}

fn eval_strategy_decision(
    requested: crate::capabilities::strategy::ExecutionStrategy,
    mut decision: crate::capabilities::ExecutionStrategyDecision,
) -> (
    crate::capabilities::ExecutionStrategyDecision,
    Option<String>,
) {
    use crate::capabilities::strategy::ExecutionStrategy;

    let mut downgrade_reason = None;
    let strategy = match requested {
        ExecutionStrategy::Parallel3DraftSynthesize => {
            if decision.allow_parallel_drafts && decision.max_parallelism >= 3 {
                requested
            } else if decision.allow_parallel_drafts && decision.max_parallelism >= 2 {
                downgrade_reason = Some(
                    "parallel_3 not allowed by capability policy; downgraded to parallel_2."
                        .to_string(),
                );
                ExecutionStrategy::Parallel2DraftSynthesize
            } else {
                downgrade_reason = Some(
                    "parallel drafts not allowed by capability policy; downgraded to sectioned_sequential."
                        .to_string(),
                );
                ExecutionStrategy::SectionedSequential
            }
        }
        ExecutionStrategy::Parallel2DraftSynthesize => {
            if decision.allow_parallel_drafts && decision.max_parallelism >= 2 {
                requested
            } else {
                downgrade_reason = Some(
                    "parallel_2 not allowed by capability policy; downgraded to sectioned_sequential."
                        .to_string(),
                );
                ExecutionStrategy::SectionedSequential
            }
        }
        ExecutionStrategy::DeepSynthesis => {
            if decision.allow_deep_synthesis {
                requested
            } else if decision.allow_parallel_drafts && decision.max_parallelism >= 2 {
                downgrade_reason =
                    Some("deep_synthesis not allowed; downgraded to parallel_2.".to_string());
                ExecutionStrategy::Parallel2DraftSynthesize
            } else {
                downgrade_reason = Some(
                    "deep_synthesis not allowed; downgraded to sectioned_sequential.".to_string(),
                );
                ExecutionStrategy::SectionedSequential
            }
        }
        ExecutionStrategy::SectionedSequential => ExecutionStrategy::SectionedSequential,
        _ => {
            downgrade_reason =
                Some("requested strategy is not a Deep Synthesis eval strategy.".to_string());
            ExecutionStrategy::SectionedSequential
        }
    };

    decision.strategy = strategy;
    decision.max_parallelism = match strategy {
        ExecutionStrategy::Parallel3DraftSynthesize => decision.max_parallelism.min(3).max(3),
        ExecutionStrategy::Parallel2DraftSynthesize => decision.max_parallelism.min(2).max(2),
        _ => 1,
    };
    decision.allow_parallel_drafts = decision.max_parallelism > 1;
    decision.allow_deep_synthesis = matches!(
        strategy,
        ExecutionStrategy::Parallel2DraftSynthesize
            | ExecutionStrategy::Parallel3DraftSynthesize
            | ExecutionStrategy::DeepSynthesis
    );

    (decision, downgrade_reason)
}

fn estimate_output_tokens(text: &str) -> i64 {
    (text.chars().count() as i64 / 4).max(1)
}
#[cfg(test)]
mod tests {
    use super::{
        apply_thinking_capability, attached_references_for_sources, auto_router_messages,
        best_available_draft, build_generation_events, build_generation_response_state,
        build_generation_status, collect_provider_events_text, configured_quick_model,
        context_built_event_payload, context_references_for_execute, context_window_for_execution,
        create_persisted_response_lifecycle, create_provider_pipeline_for_request,
        ensure_main_model_configured, eval_prompt,
        eval_strategy_decision, fallback_auto_router_decision, memory_messages_for_execution,
        minimum_successful_drafts, parse_auto_router_decision, parse_ndjson_bytes, plan,
        provider_request_from_ollama_request, recent_messages_before_response,
        recent_messages_for_execution, references_from_response_metadata, resolve_context_scope,
        sanitize_generation_value, synthesis_prompt, update_persisted_assistant_content,
        update_persisted_assistant_status, DeepSynthesisEvalPrompt, OrchestrationExecuteInput,
        ResponseModeResolution, AUTO_ROUTER_NUM_CTX, AUTO_ROUTER_NUM_PREDICT,
        DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES, DEFAULT_MAX_RECENT_CONTEXT_PAIRS,
    };
    use crate::{
        api::state::AppState,
        providers::secret_store::ProviderSecretStore,
        capabilities::strategy::{ExecutionStrategy, ExecutionStrategyDecision, RequestedMode},
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        context::{
            manager::ContextManager,
            types::{
                BuildContextInput, ContextMessageRole, ContextSource,
                ResponseMode as ContextResponseMode,
            },
        },
        orchestration::{
            answer_plan::{ContextStrategy, PlannerInput, PlannerReference, ResponseMode},
            deep_synthesis::{
                DeepSynthesisDraft, DeepSynthesisPlan, DeepSynthesisRequest,
                DeepSynthesisStepStatus, DeepSynthesisWorkerRole,
            },
            planner::DeterministicPlanner,
        },
        providers::{
            config::ProviderKind,
            contract::{ProviderContractEvent, ProviderContractMessageRole, ProviderUsageMetadata},
            ollama::OllamaRuntime,
            pipeline::ProviderPipeline,
            types::{
                OllamaChatRequest, OllamaMessage, OllamaOptions, OllamaRuntimeErrorKind,
                ProviderError, ProviderErrorKind,
            },
        },
        runtime::{OperationTracker, RestartState, RuntimeShutdownRequest},
        storage::{
            db::test_database,
            repositories::{
                attachments::{AttachmentRepository, NewAttachment},
                code_blocks::ResponseCodeBlockRepository,
                looms::{LoomRepository, NewLoom},
                memory::{MemoryRepository, NewMemory},
                orchestration::{
                    NewOrchestrationEvent, NewWorkflowRun, NewWorkflowStage,
                    OrchestrationEventRepository, WorkflowRunRepository, WorkflowStageRepository,
                },
                parts::ResponsePartRepository,
                responses::{NewResponse, ResponseRepository},
                tags_graph::{
                    ContextGraphLinkRepository, ResponseTagRepository, TopicIndexRepository,
                },
            },
        },
    };
    use axum::{extract::State, http::StatusCode, Json};
    use serde_json::json;
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn plan_endpoint_returns_answer_plan() {
        let Json(answer_plan) = plan(Json(PlannerInput {
            clean_user_prompt: "ahtapot kaç kolludur".to_string(),
            selected_response_mode: ResponseMode::Auto,
            ..PlannerInput::default()
        }))
        .await;

        assert!(!answer_plan.use_thinking);
    }

    #[tokio::test]
    async fn execute_rejects_new_generation_while_draining() {
        let state = orchestration_test_state().await;
        state.restart.request_shutdown(
            state.operations.clone(),
            RuntimeShutdownRequest {
                mode: Some("drain".to_string()),
                reason: Some("test".to_string()),
                timeout_ms: Some(1_000),
            },
        );

        let response = super::execute(
            State(state),
            Json(OrchestrationExecuteInput {
                loom_id: None,
                response_id: None,
                prompt: "hello".to_string(),
                references: Vec::new(),
                question_references: None,
                response_mode: ResponseMode::Instant,
                model: "test-model".to_string(),
                provider_profile_id: None,
                options: None,
                persist_workflow: false,
                regenerate_from_response_id: None,
                stale_assistant_response_id: None,
                source: None,
            }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    async fn orchestration_test_state() -> AppState {
        AppState {
            database: test_database().await,
            ollama: OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            }),
            config: ConfigManager::new(
                PathBuf::from("/tmp/loom-orchestration-runtime-test.toml"),
                LoomServiceConfig::default(),
            ),
            secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }

    #[tokio::test]
    async fn generation_status_reports_response_ids_and_terminal_state() {
        let database = test_database().await;
        seed_generation_resume_run(&database, "run-status", "completed").await;

        let status = build_generation_status(&database, "run-status")
            .await
            .expect("status");

        assert_eq!(status.run_id, "run-status");
        assert_eq!(status.status, "completed");
        assert_eq!(status.loom_id.as_deref(), Some("loom-resume"));
        assert_eq!(
            status.user_response_id.as_deref(),
            Some("response-run-status-user")
        );
        assert_eq!(
            status.assistant_response_id.as_deref(),
            Some("response-run-status-assistant")
        );
        assert_eq!(status.last_event_id.as_deref(), Some("event-run-status-2"));
        assert!(status.can_resume);
        assert!(!status.can_cancel);
        assert!(status.error.is_none());
    }

    #[tokio::test]
    async fn generation_events_replay_after_offset_and_sanitize_payloads() {
        let database = test_database().await;
        seed_generation_resume_run(&database, "run-events", "completed").await;

        let replay = build_generation_events(&database, "run-events", Some("event-run-events-1"))
            .await
            .expect("events");

        assert_eq!(replay.events.len(), 1);
        assert_eq!(replay.events[0].event_id, "event-run-events-2");
        assert_eq!(replay.events[0].event_kind, "response.completed");
        assert!(!replay.live_tail_supported);
        assert!(replay.can_resume);

        let sanitized = sanitize_generation_value(serde_json::json!({
            "safe": true,
            "nested": { "raw_thinking": "secret", "visible": "ok" },
            "items": [{ "chain_of_thought": "secret" }, { "label": "ok" }]
        }));
        let serialized = sanitized.to_string();
        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("chain_of_thought"));
        assert!(serialized.contains("visible"));
    }

    #[tokio::test]
    async fn generation_response_state_reconstructs_current_assistant_content() {
        let database = test_database().await;
        seed_generation_resume_run(&database, "run-state", "running").await;
        let repository = ResponseRepository::new(&database);
        repository
            .update_response_content("response-run-state-assistant", "partial answer")
            .await
            .expect("update partial content");

        let state = build_generation_response_state(&database, "run-state")
            .await
            .expect("response state");

        assert_eq!(state.status, "running");
        assert!(!state.live_tail_supported);
        assert_eq!(
            state
                .assistant_response
                .as_ref()
                .map(|response| response.content.as_str()),
            Some("partial answer")
        );
        let serialized = serde_json::to_string(&state).unwrap();
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn generation_cancelled_and_failed_statuses_are_safe() {
        let database = test_database().await;
        seed_generation_resume_run(&database, "run-cancelled", "cancelled").await;
        seed_generation_resume_run(&database, "run-failed", "error").await;

        let cancelled = build_generation_status(&database, "run-cancelled")
            .await
            .expect("cancelled status");
        assert_eq!(cancelled.status, "cancelled");
        assert!(!cancelled.can_cancel);

        let failed = build_generation_status(&database, "run-failed")
            .await
            .expect("failed status");
        assert_eq!(failed.status, "failed");
        assert!(!failed.can_cancel);
        assert_eq!(
            failed.error.as_ref().map(|error| error.kind.as_str()),
            Some("runtime_unavailable")
        );

        let missing = build_generation_status(&database, "missing-run")
            .await
            .expect_err("missing run should return not found");
        assert_eq!(missing.0, axum::http::StatusCode::NOT_FOUND);
    }

    #[test]
    fn context_built_metadata_includes_safe_budget_diagnostics() {
        let built_context = ContextManager::default().build_context(BuildContextInput {
            resolved_num_ctx: 2_048,
            ..context_input("Explain Event Sourcing.")
        });

        let payload = context_built_event_payload(
            "run-1",
            built_context.messages.len(),
            built_context.warnings.clone(),
            &built_context,
        );

        assert!(payload.get("budgetDiagnostics").is_some());
        assert_eq!(
            payload["budgetDiagnostics"]["reservedOutputTokens"],
            built_context.budget_plan.reserved_output_tokens
        );
        assert_eq!(
            payload["budgetDiagnostics"]["hardTrimThreshold"],
            built_context.budget_plan.hard_trim_threshold
        );
        assert_eq!(
            payload["budgetDiagnostics"]["recentResponseLimit"],
            built_context.budget_plan.recent_full_response_limit
        );
        assert_eq!(
            payload["budgetDiagnostics"]["recentSelectedResponses"],
            built_context.budget_diagnostics.recent_selected_responses
        );
        let serialized = payload.to_string();
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "Explain Event Sourcing.",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn execute_parser_discards_raw_thinking_text() {
        let mut buffer = String::new();
        let chunks = parse_ndjson_bytes(
            &mut buffer,
            br#"{"message":{"thinking":"private hidden text"},"done":false}
"#,
        )
        .expect("chunk parses");

        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].thinking_seen);
        assert!(chunks[0].content.is_none());
        let debug = format!("{:?}", chunks[0]);
        assert!(!debug.contains("private hidden text"));
    }

    #[test]
    fn execute_parser_detects_length_done_reason() {
        let mut buffer = String::new();
        let chunks = parse_ndjson_bytes(
            &mut buffer,
            br#"{"done":true,"done_reason":"length"}
"#,
        )
        .expect("chunk parses");

        assert!(chunks[0].done);
        assert_eq!(chunks[0].done_reason.as_deref(), Some("length"));
        assert!(crate::providers::types::done_reason_is_length("length"));
    }

    #[test]
    fn execute_input_accepts_camel_case_request() {
        let input: OrchestrationExecuteInput = serde_json::from_value(serde_json::json!({
            "loomId": "loom-1",
            "responseId": "response-1",
            "prompt": "ahtapot kaç kolludur",
            "references": [],
            "responseMode": "auto",
            "model": "qwen3.5:9b",
            "options": {
                "numCtx": 2048,
                "numPredict": 768,
                "temperature": 0.3
            },
            "persistWorkflow": true
        }))
        .expect("input deserializes");

        assert_eq!(input.loom_id.as_deref(), Some("loom-1"));
        assert!(input.persist_workflow);
        assert_eq!(
            input.options.and_then(|options| options.num_predict),
            Some(768)
        );
        assert_eq!(input.provider_profile_id, None);
    }

    #[test]
    fn execute_input_accepts_provider_profile_id() {
        let input: OrchestrationExecuteInput = serde_json::from_value(serde_json::json!({
            "loomId": "loom-1",
            "prompt": "hello",
            "responseMode": "auto",
            "model": "qwen3.5:9b",
            "providerProfileId": "litellm-sandbox"
        }))
        .expect("input deserializes");

        assert_eq!(input.loom_id.as_deref(), Some("loom-1"));
        assert_eq!(
            input.provider_profile_id.as_deref(),
            Some("litellm-sandbox")
        );
    }

    #[test]
    fn test_create_provider_pipeline_for_request_legacy() {
        let ollama = OllamaRuntime::new(OllamaConfig {
            base_url: "http://127.0.0.1:9".to_string(),
            request_timeout: Duration::from_millis(200),
            first_chunk_timeout: Duration::from_millis(200),
            stream_idle_timeout: Duration::from_millis(200),
            security: Default::default(),
        });
        let config = LoomServiceConfig::default();
        let secret_store = ProviderSecretStore::default();

        let pipeline = create_provider_pipeline_for_request(ollama, &config, &secret_store, None)
            .expect("legacy pipeline creation succeeds");

        let profile = pipeline.default_generation_profile();
        assert_eq!(profile.provider_profile_id, "ollama-local");
        assert_eq!(profile.provider_kind, ProviderKind::Ollama);
    }

    #[test]
    fn test_create_provider_pipeline_for_request_ollama_local() {
        let ollama = OllamaRuntime::new(OllamaConfig {
            base_url: "http://127.0.0.1:9".to_string(),
            request_timeout: Duration::from_millis(200),
            first_chunk_timeout: Duration::from_millis(200),
            stream_idle_timeout: Duration::from_millis(200),
            security: Default::default(),
        });
        let config = LoomServiceConfig::default();
        let secret_store = ProviderSecretStore::default();

        let pipeline = create_provider_pipeline_for_request(
            ollama,
            &config,
            &secret_store,
            Some("ollama-local"),
        )
        .expect("ollama-local pipeline creation succeeds");

        let profile = pipeline.default_generation_profile();
        assert_eq!(profile.provider_profile_id, "ollama-local");
        assert_eq!(profile.provider_kind, ProviderKind::Ollama);
    }

    #[test]
    fn test_create_provider_pipeline_for_request_unknown_profile_fails() {
        let ollama = OllamaRuntime::new(OllamaConfig {
            base_url: "http://127.0.0.1:9".to_string(),
            request_timeout: Duration::from_millis(200),
            first_chunk_timeout: Duration::from_millis(200),
            stream_idle_timeout: Duration::from_millis(200),
            security: Default::default(),
        });
        let config = LoomServiceConfig::default();
        let secret_store = ProviderSecretStore::default();

        let err = create_provider_pipeline_for_request(
            ollama,
            &config,
            &secret_store,
            Some("unknown-profile"),
        )
        .expect_err("unknown profile should fail");

        assert!(err.contains("Provider profile 'unknown-profile' not found"));
    }

    #[test]
    fn test_create_provider_pipeline_for_request_disabled_profile_fails() {
        let ollama = OllamaRuntime::new(OllamaConfig {
            base_url: "http://127.0.0.1:9".to_string(),
            request_timeout: Duration::from_millis(200),
            first_chunk_timeout: Duration::from_millis(200),
            stream_idle_timeout: Duration::from_millis(200),
            security: Default::default(),
        });
        let mut config = LoomServiceConfig::default();
        let mut profile =
            crate::providers::config::ProviderProfileConfig::nvidia_openai_compatible_example();
        profile.id = "nvidia-disabled".to_string();
        profile.enabled = false;
        config.providers.profiles.push(profile);
        let secret_store = ProviderSecretStore::default();

        let err = create_provider_pipeline_for_request(
            ollama,
            &config,
            &secret_store,
            Some("nvidia-disabled"),
        )
        .expect_err("disabled profile should fail");

        assert!(err.contains("Provider profile 'nvidia-disabled' is disabled"));
    }

    #[test]
    fn test_create_provider_pipeline_for_request_litellm_sandbox() {
        let ollama = OllamaRuntime::new(OllamaConfig {
            base_url: "http://127.0.0.1:9".to_string(),
            request_timeout: Duration::from_millis(200),
            first_chunk_timeout: Duration::from_millis(200),
            stream_idle_timeout: Duration::from_millis(200),
            security: Default::default(),
        });
        let mut config = LoomServiceConfig::default();
        let mut profile =
            crate::providers::config::ProviderProfileConfig::nvidia_openai_compatible_example();
        profile.id = "litellm-sandbox".to_string();
        profile.enabled = true;
        profile.provider_kind = ProviderKind::OpenAiCompatible;
        profile.transport_kind =
            crate::providers::config::ProviderTransportKind::NativeOpenAiCompatible;
        config.providers.profiles.push(profile);
        let secret_store = ProviderSecretStore::default();

        let pipeline = create_provider_pipeline_for_request(
            ollama,
            &config,
            &secret_store,
            Some("litellm-sandbox"),
        )
        .expect("litellm-sandbox pipeline creation succeeds");

        let profile = pipeline.default_generation_profile();
        assert_eq!(profile.provider_profile_id, "litellm-sandbox");
        assert_eq!(profile.provider_kind, ProviderKind::OpenAiCompatible);
    }

    #[test]
    fn auto_router_parses_strict_json_decision_without_raw_completion() {
        let decision = parse_auto_router_decision(
            r#"{"thinking_required":true,"reason":"code_or_architecture","confidence":0.82}"#,
            "quick-model",
        )
        .expect("router decision parses");

        assert!(decision.thinking_required);
        assert_eq!(decision.reason, "code_or_architecture");
        assert_eq!(decision.confidence, Some(0.82));
        assert!(!decision.fallback_used);
        assert_eq!(decision.model, "quick-model");
    }

    #[test]
    fn auto_router_invalid_json_uses_fallback_heuristic() {
        let mut input = execute_input(Some("loom-1"));
        input.prompt = "Bu mimari hatasını debug edip kök nedeni açıkla".to_string();

        assert!(parse_auto_router_decision("not json", "quick-model").is_none());
        let decision = fallback_auto_router_decision(
            &input,
            "quick-model",
            Some("router_invalid_contract".to_string()),
        );

        assert!(decision.thinking_required);
        assert!(decision.fallback_used);
        assert_eq!(decision.reason, "fallback_heuristic");
        assert_eq!(
            decision.error_kind.as_deref(),
            Some("router_invalid_contract")
        );
    }

    #[test]
    fn auto_router_fallback_prefers_instant_for_short_factual_prompt() {
        let mut input = execute_input(Some("loom-1"));
        input.prompt = "Event sourcing nedir?".to_string();

        let decision = fallback_auto_router_decision(&input, "quick-model", None);

        assert!(!decision.thinking_required);
        assert_eq!(decision.resolved_mode(), ResponseMode::Instant);
    }

    #[tokio::test]
    async fn auto_router_provider_request_uses_pipeline_contract() {
        let state = orchestration_test_state().await;
        let pipeline = ProviderPipeline::new(state.ollama.clone());
        let request = OllamaChatRequest {
            model: "quick-model".to_string(),
            messages: auto_router_messages(&execute_input(Some("loom-1"))),
            stream: Some(false),
            think: Some(false),
            options: Some(OllamaOptions {
                num_ctx: Some(AUTO_ROUTER_NUM_CTX),
                num_predict: Some(AUTO_ROUTER_NUM_PREDICT),
                temperature: Some(0.0),
            }),
            request_id: Some("auto-router-test".to_string()),
        };

        let provider_request = provider_request_from_ollama_request(
            &pipeline,
            &request,
            json!({ "source": "orchestration.auto_router" }),
            json!({ "contextBuilt": false, "router": "auto" }),
        );

        assert_eq!(provider_request.provider_kind, ProviderKind::Ollama);
        assert_eq!(provider_request.provider_profile_id, "ollama-local");
        assert_eq!(provider_request.model_id, "quick-model");
        assert!(!provider_request.stream);
        assert_eq!(provider_request.options.thinking, Some(false));
        assert_eq!(
            provider_request.options.context_tokens,
            Some(AUTO_ROUTER_NUM_CTX)
        );
        assert_eq!(
            provider_request.options.max_tokens,
            Some(AUTO_ROUTER_NUM_PREDICT)
        );
        assert_eq!(
            provider_request.runtime_metadata["source"],
            "orchestration.auto_router"
        );
        assert_eq!(provider_request.loom_context_metadata["router"], "auto");
    }

    #[test]
    fn provider_event_collection_ignores_thinking_status_and_collects_visible_text() {
        let answer = collect_provider_events_text(vec![
            ProviderContractEvent::ThinkingStatus {
                status: "active".to_string(),
                duration_ms: Some(11),
                token_estimate: Some(4),
            },
            ProviderContractEvent::Delta {
                text: "visible ".to_string(),
            },
            ProviderContractEvent::Delta {
                text: "answer".to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: ProviderUsageMetadata::unavailable("test"),
            },
        ])
        .expect("visible answer");

        assert_eq!(answer, "visible answer");
    }

    #[test]
    fn provider_event_collection_maps_errors_safely() {
        let error = collect_provider_events_text(vec![ProviderContractEvent::Error {
            error: ProviderError::new(ProviderErrorKind::ModelMissing, ProviderKind::Ollama)
                .with_provider_id("ollama-local")
                .with_model(Some("missing-model".to_string()))
                .with_technical_message("Selected model is not installed."),
        }])
        .expect_err("provider error");

        assert_eq!(error.kind, OllamaRuntimeErrorKind::ModelMissing);
        assert!(!error.message.contains("api_key"));
        assert!(!error.message.contains("raw_thinking"));
    }

    #[test]
    fn provider_event_collection_does_not_include_raw_thinking_status_text() {
        let answer = collect_provider_events_text(vec![
            ProviderContractEvent::ThinkingStatus {
                status: "active".to_string(),
                duration_ms: Some(10),
                token_estimate: Some(3),
            },
            ProviderContractEvent::Delta {
                text: "visible".to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: None,
                usage: ProviderUsageMetadata::unavailable("test"),
            },
        ])
        .expect("visible answer");

        assert_eq!(answer, "visible");
        assert!(!answer.contains("raw_thinking"));
        assert!(!answer.contains("thinking_text"));
        assert!(!answer.contains("chain_of_thought"));
        assert!(!answer.contains("hidden_reasoning"));
    }

    #[test]
    fn missing_model_roles_return_typed_configuration_errors() {
        let mut config = LoomServiceConfig::default();
        let input = execute_input(Some("loom-1"));

        config.providers.default_quick_model = String::new();
        let quick_error = configured_quick_model(&config).expect_err("quick model required");
        assert_eq!(quick_error.code, "quick_model_required");

        config.providers.default_main_model = String::new();
        let main_error =
            ensure_main_model_configured(&config, &input).expect_err("main model required");
        assert_eq!(main_error.code, "main_model_required");
    }

    #[test]
    fn unsupported_thinking_capability_downgrades_to_instant_with_reason() {
        let mut config = LoomServiceConfig::default();
        config.providers.profiles[0].capabilities.supports_thinking = false;
        let resolution = apply_thinking_capability(
            ResponseModeResolution::passthrough(ResponseMode::Thinking),
            &config,
            "qwen3.5:9b",
        );

        assert_eq!(resolution.resolved_response_mode, ResponseMode::Instant);
        assert_eq!(
            resolution.capability_downgrade_reason.as_deref(),
            Some("provider_thinking_unsupported")
        );
    }

    #[test]
    fn deep_synthesis_parallel_3_requires_two_successful_drafts() {
        let plan = deep_plan(ExecutionStrategy::Parallel3DraftSynthesize, 3);
        assert_eq!(minimum_successful_drafts(&plan), 2);
    }

    #[tokio::test]
    async fn deep_synthesis_draft_provider_request_uses_pipeline_contract() {
        let state = orchestration_test_state().await;
        let pipeline = ProviderPipeline::new(state.ollama.clone());
        let request = OllamaChatRequest {
            model: "main-model".to_string(),
            messages: vec![
                OllamaMessage {
                    role: "system".to_string(),
                    content: "You are a Deep Synthesis worker.".to_string(),
                },
                OllamaMessage {
                    role: "user".to_string(),
                    content: "Draft section".to_string(),
                },
            ],
            stream: Some(true),
            think: Some(false),
            options: Some(OllamaOptions {
                num_ctx: Some(2048),
                num_predict: Some(512),
                temperature: Some(0.2),
            }),
            request_id: Some("deep-draft".to_string()),
        };

        let provider_request = provider_request_from_ollama_request(
            &pipeline,
            &request,
            json!({ "source": "deep_synthesis.draft" }),
            json!({ "contextBuilt": false, "deepSynthesis": true }),
        );

        assert!(provider_request.stream);
        assert_eq!(
            provider_request.runtime_metadata["source"],
            "deep_synthesis.draft"
        );
        assert_eq!(
            provider_request.loom_context_metadata["deepSynthesis"],
            true
        );
        assert_eq!(
            provider_request.messages[0].role,
            ProviderContractMessageRole::System
        );
        assert_eq!(
            provider_request.messages[1].role,
            ProviderContractMessageRole::User
        );
    }

    #[tokio::test]
    async fn deep_synthesis_final_provider_request_uses_pipeline_contract() {
        let state = orchestration_test_state().await;
        let pipeline = ProviderPipeline::new(state.ollama.clone());
        let request = OllamaChatRequest {
            model: "main-model".to_string(),
            messages: vec![
                OllamaMessage {
                    role: "system".to_string(),
                    content: "You are a Deep Synthesis worker.".to_string(),
                },
                OllamaMessage {
                    role: "user".to_string(),
                    content: "Synthesize final".to_string(),
                },
            ],
            stream: Some(true),
            think: Some(false),
            options: Some(OllamaOptions {
                num_ctx: Some(2048),
                num_predict: Some(512),
                temperature: Some(0.2),
            }),
            request_id: Some("deep-final".to_string()),
        };

        let provider_request = provider_request_from_ollama_request(
            &pipeline,
            &request,
            json!({ "source": "deep_synthesis.synthesis" }),
            json!({ "contextBuilt": false, "deepSynthesis": true }),
        );

        assert!(provider_request.stream);
        assert_eq!(
            provider_request.runtime_metadata["source"],
            "deep_synthesis.synthesis"
        );
        assert_eq!(
            provider_request.loom_context_metadata["deepSynthesis"],
            true
        );
    }

    #[test]
    fn synthesis_prompt_receives_draft_outputs_not_raw_thinking() {
        let request = deep_request();
        let drafts = vec![DeepSynthesisDraft {
            draft_id: "draft-1".to_string(),
            worker_role: DeepSynthesisWorkerRole::ConciseDraft,
            content: "Explicit draft answer".to_string(),
            status: DeepSynthesisStepStatus::Done,
        }];

        let prompt = synthesis_prompt(&request, &drafts);

        assert!(prompt.contains("Explicit draft answer"));
        assert!(!prompt.contains("raw_thinking"));
        assert!(!prompt.contains("chain_of_thought"));
        assert!(!prompt.contains("hidden_reasoning"));
    }

    #[test]
    fn best_available_draft_uses_longest_safe_output() {
        let drafts = vec![
            DeepSynthesisDraft {
                draft_id: "draft-short".to_string(),
                worker_role: DeepSynthesisWorkerRole::ConciseDraft,
                content: "short".to_string(),
                status: DeepSynthesisStepStatus::Done,
            },
            DeepSynthesisDraft {
                draft_id: "draft-long".to_string(),
                worker_role: DeepSynthesisWorkerRole::DetailedDraft,
                content: "longer safe draft".to_string(),
                status: DeepSynthesisStepStatus::Done,
            },
        ];

        assert_eq!(
            best_available_draft(&drafts).as_deref(),
            Some("longer safe draft")
        );
    }

    #[test]
    fn eval_strategy_downgrades_parallel_3_when_not_allowed() {
        let decision = strategy_decision(ExecutionStrategy::SectionedSequential, 1, false);
        let (decision, reason) =
            eval_strategy_decision(ExecutionStrategy::Parallel3DraftSynthesize, decision);

        assert_eq!(decision.strategy, ExecutionStrategy::SectionedSequential);
        assert_eq!(decision.max_parallelism, 1);
        assert!(reason.unwrap().contains("downgraded"));
    }

    #[test]
    fn eval_prompt_uses_synthetic_prompts_only() {
        assert!(eval_prompt(&DeepSynthesisEvalPrompt::ShortFactual).contains("Yunanistan"));
        assert!(eval_prompt(&DeepSynthesisEvalPrompt::LongForm).contains("Event sourcing"));
        assert!(eval_prompt(&DeepSynthesisEvalPrompt::Synthesis).contains("SQLite"));
    }

    #[tokio::test]
    async fn create_lifecycle_persists_user_and_assistant_responses() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let input = execute_input(Some("loom-1"));
        let answer_plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: input.prompt.clone(),
            selected_response_mode: input.response_mode.clone(),
            ..PlannerInput::default()
        });

        let lifecycle = create_persisted_response_lifecycle(
            &database,
            &input,
            "workflow-1",
            &answer_plan,
            &ResponseModeResolution::passthrough(input.response_mode.clone()),
        )
        .await
        .expect("lifecycle persists")
        .expect("lifecycle exists");

        let responses = ResponseRepository::new(&database)
            .list_responses_for_loom("loom-1")
            .await
            .expect("list responses");
        assert_eq!(responses.len(), 2);
        assert_eq!(responses[0].role, "user");
        assert_eq!(responses[0].sequence_index, 0);
        assert_eq!(responses[1].role, "assistant");
        assert_eq!(responses[1].sequence_index, 1);
        assert_eq!(responses[1].content, "");
        assert_eq!(lifecycle.assistant_response_id, responses[1].response_id);

        let metadata: serde_json::Value =
            serde_json::from_str(responses[1].metadata_json.as_deref().unwrap())
                .expect("metadata json");
        assert_eq!(metadata["status"], "streaming");
        assert_eq!(metadata["workflowRunId"], "workflow-1");
    }

    #[tokio::test]
    async fn first_weft_prompt_updates_weft_title() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        LoomRepository::new(&database)
            .insert_loom(&NewLoom {
                loom_id: "weft-1".to_string(),
                title: "Loom: .NET mi Java mı?".to_string(),
                summary: Some("Branched from Event sourcing nedir.".to_string()),
                code: Some("W-TEST".to_string()),
                canonical_uri: Some("loom://wefts/weft-1".to_string()),
                kind: "weft".to_string(),
                origin_loom_id: Some("loom-1".to_string()),
                origin_response_id: Some("origin-response".to_string()),
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                metadata_json: Some(r#"{"weftKind":"exploration"}"#.to_string()),
            })
            .await
            .expect("insert weft");
        let input = OrchestrationExecuteInput {
            loom_id: Some("weft-1".to_string()),
            response_id: None,
            prompt: "o zaman .net bildiğin için onunla devam etmem daha doğru olur?".to_string(),
            references: Vec::new(),
            question_references: None,
            response_mode: ResponseMode::Instant,
            model: "qwen3.5:9b".to_string(),
            provider_profile_id: None,
            options: None,
            persist_workflow: true,
            regenerate_from_response_id: None,
            stale_assistant_response_id: None,
            source: Some("composer".to_string()),
        };
        let answer_plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: input.prompt.clone(),
            selected_response_mode: input.response_mode.clone(),
            ..PlannerInput::default()
        });

        let lifecycle = create_persisted_response_lifecycle(
            &database,
            &input,
            "workflow-weft-title",
            &answer_plan,
            &ResponseModeResolution::passthrough(input.response_mode.clone()),
        )
        .await
        .expect("lifecycle persists")
        .expect("lifecycle exists");

        assert_eq!(
            lifecycle.updated_loom_title.as_deref(),
            Some("Loom: o zaman .net bildiğin için onunla devam etmem daha doğru olur?")
        );
        let weft = LoomRepository::new(&database)
            .get_loom("weft-1")
            .await
            .expect("get weft")
            .expect("weft exists");
        assert_eq!(
            weft.title,
            "Loom: o zaman .net bildiğin için onunla devam etmem daha doğru olur?"
        );
    }

    #[test]
    fn compact_prompt_title_does_not_leave_half_word_suffix() {
        let title = super::weft_title_from_first_prompt(
            &Some(r#"{"weftKind":"revision"}"#.to_string()),
            "rust ve go ile ayrı bir service yapsam .net uygulamama olur mu sence? bu cümle uzarsa kırp",
        );

        assert_eq!(
            title,
            "Revision: rust ve go ile ayrı bir service yapsam .net uygulamama olur mu sence?"
        );
    }

    #[tokio::test]
    async fn lifecycle_updates_streaming_content_and_completion_status() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let input = execute_input(Some("loom-1"));
        let answer_plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: input.prompt.clone(),
            selected_response_mode: input.response_mode.clone(),
            ..PlannerInput::default()
        });
        let mut lifecycle = create_persisted_response_lifecycle(
            &database,
            &input,
            "workflow-2",
            &answer_plan,
            &ResponseModeResolution::passthrough(input.response_mode.clone()),
        )
        .await
        .expect("lifecycle persists")
        .expect("lifecycle exists");

        lifecycle.assistant_content.push_str("Merhaba");
        update_persisted_assistant_content(&database, &lifecycle)
            .await
            .expect("content updates");
        update_persisted_assistant_status(
            &database,
            &lifecycle,
            "completed",
            Some("stop"),
            None,
            None,
        )
        .await
        .expect("status updates");

        let response = ResponseRepository::new(&database)
            .get_response(&lifecycle.assistant_response_id)
            .await
            .expect("get response")
            .expect("response exists");
        assert_eq!(response.content, "Merhaba");
        let metadata: serde_json::Value =
            serde_json::from_str(response.metadata_json.as_deref().unwrap())
                .expect("metadata json");
        assert_eq!(metadata["status"], "completed");
        assert_eq!(metadata["doneReason"], "stop");
    }

    #[tokio::test]
    async fn lifecycle_normalizes_orphan_heading_markers_before_persistence() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let input = execute_input(Some("loom-1"));
        let answer_plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: input.prompt.clone(),
            selected_response_mode: input.response_mode.clone(),
            ..PlannerInput::default()
        });
        let mut lifecycle = create_persisted_response_lifecycle(
            &database,
            &input,
            "workflow-heading-markers",
            &answer_plan,
            &ResponseModeResolution::passthrough(input.response_mode.clone()),
        )
        .await
        .expect("lifecycle persists")
        .expect("lifecycle exists");

        lifecycle.assistant_content.push_str(
            "Intro\n\n####\n\nSatellite Requirements\n\n```markdown\n####\nCode stays raw\n```\n\n######\n",
        );
        update_persisted_assistant_content(&database, &lifecycle)
            .await
            .expect("content updates");

        let response = ResponseRepository::new(&database)
            .get_response(&lifecycle.assistant_response_id)
            .await
            .expect("get response")
            .expect("response exists");

        assert!(response.content.contains("#### Satellite Requirements"));
        assert!(!response
            .content
            .split("```markdown")
            .next()
            .unwrap_or_default()
            .contains("\n####\n"));
        assert!(response
            .content
            .contains("```markdown\n####\nCode stays raw\n```"));
        assert!(!response.content.ends_with("######\n"));
    }

    #[tokio::test]
    async fn execute_without_loom_id_does_not_persist_domain_responses() {
        let database = test_database().await;
        let input = execute_input(None);
        let answer_plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: input.prompt.clone(),
            selected_response_mode: input.response_mode.clone(),
            ..PlannerInput::default()
        });

        let lifecycle = create_persisted_response_lifecycle(
            &database,
            &input,
            "workflow-3",
            &answer_plan,
            &ResponseModeResolution::passthrough(input.response_mode.clone()),
        )
        .await
        .expect("no lifecycle error");

        assert!(lifecycle.is_none());
    }

    #[tokio::test]
    async fn regenerate_lifecycle_creates_assistant_only_from_user_response() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let repository = ResponseRepository::new(&database);
        repository
            .insert_response(&NewResponse {
                response_id: "edited-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Edited prompt".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                sequence_index: 0,
                metadata_json: Some(
                    serde_json::json!({
                        "references": [{
                            "referenceId": "ref-1",
                            "label": "Fragment",
                            "selectedTextPreview": "MCP",
                            "targetKind": "fragment",
                            "targetId": "fragment-1"
                        }]
                    })
                    .to_string(),
                ),
            })
            .await
            .expect("insert user");
        repository
            .insert_response(&NewResponse {
                response_id: "stale-assistant".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Old stale answer".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "2".to_string(),
                updated_at: "2".to_string(),
                sequence_index: 1,
                metadata_json: Some(
                    serde_json::json!({
                        "stale": true,
                        "staleReason": "prompt_edited"
                    })
                    .to_string(),
                ),
            })
            .await
            .expect("insert assistant");
        let mut input = execute_input(Some("loom-1"));
        input.response_id = Some("edited-user".to_string());
        input.prompt = "Edited prompt".to_string();
        input.regenerate_from_response_id = Some("edited-user".to_string());
        input.stale_assistant_response_id = Some("stale-assistant".to_string());
        input.source = Some("prompt_edit_regenerate".to_string());
        input.references = references_from_response_metadata(
            repository
                .get_response("edited-user")
                .await
                .expect("get user")
                .expect("user exists")
                .metadata_json
                .as_deref(),
        );
        let answer_plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: input.prompt.clone(),
            attached_references: input.references.clone(),
            selected_response_mode: input.response_mode.clone(),
            ..PlannerInput::default()
        });

        let lifecycle = create_persisted_response_lifecycle(
            &database,
            &input,
            "workflow-regen",
            &answer_plan,
            &ResponseModeResolution::passthrough(input.response_mode.clone()),
        )
        .await
        .expect("lifecycle persists")
        .expect("lifecycle exists");

        assert_eq!(lifecycle.user_response_id, "edited-user");
        let responses = repository
            .list_responses_for_loom("loom-1")
            .await
            .expect("list responses");
        assert_eq!(responses.len(), 3);
        assert_eq!(responses[0].response_id, "edited-user");
        assert_eq!(responses[1].response_id, "stale-assistant");
        assert_eq!(responses[1].content, "Old stale answer");
        assert_eq!(responses[2].role, "assistant");
        assert_eq!(responses[2].sequence_index, 2);
        let metadata: serde_json::Value =
            serde_json::from_str(responses[2].metadata_json.as_deref().unwrap())
                .expect("metadata json");
        assert_eq!(metadata["source"], "prompt_edit_regenerate");
        assert_eq!(metadata["regeneratedFromUserResponseId"], "edited-user");
        assert_eq!(metadata["replacesStaleResponseId"], "stale-assistant");
        assert!(!metadata.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn regenerate_context_uses_history_before_user_not_stale_assistant() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let repository = ResponseRepository::new(&database);
        for response in [
            NewResponse {
                response_id: "previous-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Previous question".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                sequence_index: 0,
                metadata_json: None,
            },
            NewResponse {
                response_id: "previous-assistant".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Previous answer".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "2".to_string(),
                updated_at: "2".to_string(),
                sequence_index: 1,
                metadata_json: None,
            },
            NewResponse {
                response_id: "edited-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Edited prompt".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "3".to_string(),
                updated_at: "3".to_string(),
                sequence_index: 2,
                metadata_json: None,
            },
            NewResponse {
                response_id: "stale-assistant".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Do not use this stale answer as truth".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "4".to_string(),
                updated_at: "4".to_string(),
                sequence_index: 3,
                metadata_json: Some(serde_json::json!({ "stale": true }).to_string()),
            },
        ] {
            repository
                .insert_response(&response)
                .await
                .expect("insert response");
        }

        let recent = recent_messages_before_response(
            &database,
            "loom-1",
            Some("edited-user"),
            DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES,
        )
        .await
        .expect("recent messages");
        let joined = recent
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("Previous question"));
        assert!(joined.contains("Previous answer"));
        assert!(!joined.contains("Edited prompt"));
        assert!(!joined.contains("stale answer"));
    }

    #[tokio::test]
    async fn execute_context_includes_recent_event_sourcing_turns_for_follow_up() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        insert_event_sourcing_seed(&database).await;

        let mut input = execute_input(Some("loom-1"));
        input.prompt = "Avantaj ve dezavantajları tablo şeklinde verebilir misin?".to_string();
        let answer_plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: input.prompt.clone(),
            selected_response_mode: input.response_mode.clone(),
            loom_id: input.loom_id.clone(),
            ..PlannerInput::default()
        });
        assert_eq!(answer_plan.context_strategy, ContextStrategy::RecentTurns);

        let lifecycle = create_persisted_response_lifecycle(
            &database,
            &input,
            "workflow-followup",
            &answer_plan,
            &ResponseModeResolution::passthrough(input.response_mode.clone()),
        )
        .await
        .expect("lifecycle persists")
        .expect("lifecycle exists");
        let recent = recent_messages_for_execution(
            &database,
            "loom-1",
            &input,
            Some(&lifecycle),
            DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES,
        )
        .await
        .expect("recent messages");

        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].role, ContextMessageRole::User);
        assert_eq!(recent[1].role, ContextMessageRole::Assistant);
        let joined = recent
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("Event sourcing nedir"));
        assert!(joined.contains("Event Sourcing"));
        assert!(!joined.contains("Avantaj ve dezavantajları"));

        let built = ContextManager::default().build_context(BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: Some(lifecycle.user_response_id),
            user_prompt: input.prompt,
            attached_references: Vec::new(),
            response_mode: ContextResponseMode::Auto,
            resolved_num_ctx: 2_048,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            memory_messages: Vec::new(),
            recent_messages: recent,
        });
        let context_text = built
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(context_text.contains("Recent conversation"));
        assert!(context_text.contains("User: Event sourcing nedir"));
        assert!(context_text.contains("Assistant: Event Sourcing"));
        assert!(context_text.contains("Event Store"));
        assert!(context_text.contains("Replay"));
        assert!(context_text.contains("CQRS"));
        assert!(context_text.contains("Avantaj ve dezavantajları tablo"));
        assert!(context_text.contains("infer it from the recent conversation"));
        assert!(!context_text.contains("raw_thinking"));
    }

    #[tokio::test]
    async fn recent_candidate_pool_exceeds_final_budget_plan_selection() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let repository = ResponseRepository::new(&database);
        for index in 0..30 {
            let content = format!("Valid recent response {index}");
            let mut metadata_json = None;
            if index == 3 {
                sqlx::query(
                    "INSERT INTO responses (
                        response_id, loom_id, role, content, created_at, updated_at,
                        sequence_index, metadata_json
                    ) VALUES (?1, 'loom-1', 'user', ?2, ?3, ?3, ?4, NULL)",
                )
                .bind(format!("recent-{index}"))
                .bind("raw_thinking must never enter recent context")
                .bind(index.to_string())
                .bind(index)
                .execute(database.pool())
                .await
                .expect("insert raw-thinking fixture directly");
                continue;
            }
            if index == 4 {
                metadata_json = Some(serde_json::json!({ "stale": true }).to_string());
            }
            repository
                .insert_response(&NewResponse {
                    response_id: format!("recent-{index}"),
                    loom_id: "loom-1".to_string(),
                    role: if index % 2 == 0 {
                        "assistant".to_string()
                    } else {
                        "user".to_string()
                    },
                    content,
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: index.to_string(),
                    updated_at: index.to_string(),
                    sequence_index: index,
                    metadata_json,
                })
                .await
                .expect("insert recent response");
        }
        sqlx::query("UPDATE responses SET is_deleted = 1 WHERE response_id = 'recent-5'")
            .execute(database.pool())
            .await
            .expect("mark deleted");
        repository
            .insert_response(&NewResponse {
                response_id: "current-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Use recent context".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "31".to_string(),
                updated_at: "31".to_string(),
                sequence_index: 31,
                metadata_json: None,
            })
            .await
            .expect("insert current response");

        let recent = recent_messages_before_response(
            &database,
            "loom-1",
            Some("current-user"),
            DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES,
        )
        .await
        .expect("recent candidates");
        let joined = recent
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(recent.len(), 24);
        assert!(!joined.contains("raw_thinking"));
        assert!(!joined.contains("stale"));
        assert!(!joined.contains("recent response 5"));

        let built = ContextManager::default().build_context_with_contributors_and_strategy(
            BuildContextInput {
                loom_id: "loom-1".to_string(),
                current_head_response_id: Some("current-user".to_string()),
                user_prompt: "Use recent context".to_string(),
                attached_references: Vec::new(),
                response_mode: ContextResponseMode::Auto,
                resolved_num_ctx: 16_384,
                answer_plan: None,
                source: ContextSource::Composer,
                weft_origin: None,
                checkpoint: None,
                memory_messages: Vec::new(),
                recent_messages: recent,
            },
            vec![Box::new(
                crate::context::contributors::RecentTurnsContributor,
            )],
            Some(&strategy_decision(
                ExecutionStrategy::Parallel2DraftSynthesize,
                2,
                true,
            )),
        );

        assert_eq!(built.budget_diagnostics.recent_candidate_responses, 24);
        assert_eq!(built.budget_diagnostics.recent_response_limit, 20);
        assert_eq!(built.budget_diagnostics.recent_selected_responses, 20);
        assert_eq!(
            built.budget_diagnostics.recent_selected_response_ids.len(),
            20
        );
    }

    #[tokio::test]
    async fn execute_context_keeps_event_sourcing_topic_for_expand_follow_up() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        insert_event_sourcing_seed(&database).await;

        let mut input = execute_input(Some("loom-1"));
        input.prompt = "Dezavantajları ve avantajları biraz daha açar mısın".to_string();
        let answer_plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: input.prompt.clone(),
            selected_response_mode: input.response_mode.clone(),
            loom_id: input.loom_id.clone(),
            ..PlannerInput::default()
        });
        assert_eq!(answer_plan.context_strategy, ContextStrategy::RecentTurns);

        let lifecycle = create_persisted_response_lifecycle(
            &database,
            &input,
            "workflow-expand-followup",
            &answer_plan,
            &ResponseModeResolution::passthrough(input.response_mode.clone()),
        )
        .await
        .expect("lifecycle persists")
        .expect("lifecycle exists");
        let recent = recent_messages_for_execution(
            &database,
            "loom-1",
            &input,
            Some(&lifecycle),
            DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES,
        )
        .await
        .expect("recent messages");
        let built = ContextManager::default().build_context(BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: Some(lifecycle.user_response_id),
            user_prompt: input.prompt,
            attached_references: Vec::new(),
            response_mode: ContextResponseMode::Auto,
            resolved_num_ctx: 2_048,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            memory_messages: Vec::new(),
            recent_messages: recent,
        });
        let context_text = built
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(context_text.contains("Event Sourcing"));
        assert!(context_text.contains("Event Store"));
        assert!(context_text.contains("Replay"));
        assert!(context_text.contains("CQRS"));
        assert!(context_text.contains("Dezavantajları ve avantajları biraz daha"));
        assert!(!context_text.contains("LoomDB"));
        assert!(!context_text.contains("raw_thinking"));
    }

    #[tokio::test]
    async fn event_sourcing_three_turn_pipeline_proves_context_artifacts_and_links() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        insert_event_sourcing_proof_turns(&database).await;

        let turn_two_context = recent_messages_before_response(
            &database,
            "loom-1",
            Some("event-user-2"),
            DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES,
        )
        .await
        .expect("turn two recent context");
        let turn_two_built = ContextManager::default().build_context(BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: Some("event-user-2".to_string()),
            user_prompt: "Avantajları ve dezavantajları tablo şeklinde verebilir misin?"
                .to_string(),
            attached_references: Vec::new(),
            response_mode: ContextResponseMode::Auto,
            resolved_num_ctx: 4_096,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            memory_messages: Vec::new(),
            recent_messages: turn_two_context,
        });
        let turn_two_text = context_text(&turn_two_built);
        assert!(turn_two_text.contains("Event Sourcing nedir? nasıl kullanılır?"));
        assert!(turn_two_text.contains("Event Store"));
        assert!(turn_two_text.contains("Replay"));
        assert!(turn_two_text.contains("CQRS"));
        assert!(turn_two_text.contains("infer it from the recent conversation"));
        assert!(!turn_two_text.contains("LoomDB"));
        assert_no_forbidden_context_keys(&turn_two_text);

        let turn_three_context = recent_messages_before_response(
            &database,
            "loom-1",
            Some("event-user-3"),
            DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES,
        )
        .await
        .expect("turn three recent context");
        let turn_three_built = ContextManager::default().build_context(BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: Some("event-user-3".to_string()),
            user_prompt: "Dezavantajları ve avantajları biraz daha açar mısın".to_string(),
            attached_references: Vec::new(),
            response_mode: ContextResponseMode::Auto,
            resolved_num_ctx: 4_096,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            memory_messages: Vec::new(),
            recent_messages: turn_three_context,
        });
        let turn_three_text = context_text(&turn_three_built);
        assert!(turn_three_text.contains("Event Sourcing"));
        assert!(turn_three_text.contains("Avantajları ve dezavantajları"));
        assert!(turn_three_text.contains("| Avantaj | Dezavantaj |"));
        assert!(!turn_three_text.contains("LoomDB"));
        assert_no_forbidden_context_keys(&turn_three_text);

        let repository = ResponseRepository::new(&database);
        let table_response = repository
            .get_response("event-assistant-2")
            .await
            .expect("get table response")
            .expect("table response");
        assert_eq!(table_response.content, event_sourcing_table_answer());
        let parts = ResponsePartRepository::new(&database)
            .list_by_response("event-assistant-2")
            .await
            .expect("parts");
        assert!(parts.iter().any(|part| part.part_kind == "table"
            && part
                .markdown
                .as_deref()
                .is_some_and(|markdown| markdown.contains("| Avantaj | Dezavantaj |"))));

        let code_blocks = ResponseCodeBlockRepository::new(&database)
            .list_by_response("event-assistant-1")
            .await
            .expect("code blocks");
        assert_eq!(code_blocks.len(), 1);
        assert_eq!(
            code_blocks[0].code,
            "const stream = eventStore.load(aggregateId);\nconst state = replay(stream);\n"
        );

        let tags = ResponseTagRepository::new(&database)
            .list_by_response("event-assistant-1")
            .await
            .expect("tags");
        let normalized_tags = tags
            .iter()
            .map(|tag| tag.normalized_tag.as_str())
            .collect::<Vec<_>>();
        assert!(normalized_tags.contains(&"event sourcing"));
        assert!(normalized_tags.contains(&"event store"));
        assert!(normalized_tags.contains(&"cqrs"));
        assert!(normalized_tags.contains(&"replay"));

        let topic = TopicIndexRepository::new(&database)
            .get_topic("loom-1", "event sourcing")
            .await
            .expect("topic lookup")
            .expect("event sourcing topic");
        assert_eq!(topic.first_response_id.as_deref(), Some("event-user-1"));
        assert_eq!(
            topic.latest_response_id.as_deref(),
            Some("event-assistant-3")
        );

        let links = ContextGraphLinkRepository::new(&database)
            .list_links_for_loom("loom-1")
            .await
            .expect("links");
        assert!(links.iter().any(|link| link.link_kind == "answers"
            && link.source_id == "event-user-1"
            && link.target_id == "event-assistant-1"));
        assert!(links.iter().any(|link| link.link_kind == "follows"
            && link.source_id == "event-assistant-1"
            && link.target_id == "event-user-2"));
        assert!(links.iter().any(|link| link.link_kind == "same_topic"
            && link.source_id == "event-assistant-2"
            && link.target_id == "event-assistant-1"));
        assert!(links
            .iter()
            .any(|link| link.link_kind == "code_for" && link.target_id == "event-assistant-1"));

        let artifact_debug = format!("{parts:?}{tags:?}{topic:?}{links:?}");
        assert_no_forbidden_context_keys(&artifact_debug);
    }

    #[tokio::test]
    async fn recent_context_retains_immediate_previous_pair_when_window_is_capped() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let repository = ResponseRepository::new(&database);
        for index in 0..13 {
            repository
                .insert_response(&NewResponse {
                    response_id: format!("user-{index}"),
                    loom_id: "loom-1".to_string(),
                    role: "user".to_string(),
                    content: format!("Older question {index}"),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: index.to_string(),
                    updated_at: index.to_string(),
                    sequence_index: index * 2,
                    metadata_json: None,
                })
                .await
                .expect("insert user");
            repository
                .insert_response(&NewResponse {
                    response_id: format!("assistant-{index}"),
                    loom_id: "loom-1".to_string(),
                    role: "assistant".to_string(),
                    content: format!("Older answer {index}"),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: index.to_string(),
                    updated_at: index.to_string(),
                    sequence_index: index * 2 + 1,
                    metadata_json: None,
                })
                .await
                .expect("insert assistant");
        }
        repository
            .insert_response(&NewResponse {
                response_id: "current-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Bunu tablo yapar mısın?".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "26".to_string(),
                updated_at: "26".to_string(),
                sequence_index: 26,
                metadata_json: None,
            })
            .await
            .expect("insert current user");

        let recent = recent_messages_before_response(
            &database,
            "loom-1",
            Some("current-user"),
            DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES,
        )
        .await
        .expect("recent messages");

        assert_eq!(recent.len(), DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES);
        assert_eq!(recent[recent.len() - 2].content, "Older question 12");
        assert_eq!(recent[recent.len() - 1].content, "Older answer 12");
        assert!(!recent
            .iter()
            .any(|message| message.content == "Older question 0"));
    }

    #[tokio::test]
    async fn context_window_counts_twenty_pairs_not_twenty_messages() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let repository = ResponseRepository::new(&database);
        for index in 0..21 {
            insert_test_response_pair(&repository, "loom-1", index, None).await;
        }
        repository
            .insert_response(&NewResponse {
                response_id: "current-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Use recent context".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "100".to_string(),
                updated_at: "100".to_string(),
                sequence_index: 100,
                metadata_json: None,
            })
            .await
            .expect("insert current user");

        let mut input = execute_input(Some("loom-1"));
        input.response_id = Some("current-user".to_string());
        let window = context_window_for_execution(
            &database,
            "loom-1",
            &input,
            None,
            false,
            None,
            None,
            DEFAULT_MAX_RECENT_CONTEXT_PAIRS,
        )
        .await
        .expect("context window");

        let messages = window.messages();
        assert_eq!(window.pair_count, 20);
        assert_eq!(messages.len(), 40);
        assert!(!messages
            .iter()
            .any(|message| message.content == "Question 0"));
        assert!(messages
            .iter()
            .any(|message| message.content == "Question 1"));
        assert!(messages
            .iter()
            .any(|message| message.content == "Answer 20"));
    }

    #[tokio::test]
    async fn normal_loom_loads_attachment_from_included_prior_turn_only() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let repository = ResponseRepository::new(&database);
        insert_ready_text_attachment(
            &database,
            "loom-1",
            "att-old",
            "old.md",
            "OLD_ATTACHMENT_SENTINEL",
        )
        .await;
        insert_ready_text_attachment(
            &database,
            "loom-1",
            "att-recent",
            "recent.md",
            "RECENT_ATTACHMENT_SENTINEL",
        )
        .await;
        for index in 0..22 {
            let attachment_id = match index {
                0 => Some("att-old"),
                21 => Some("att-recent"),
                _ => None,
            };
            insert_test_response_pair(&repository, "loom-1", index, attachment_id).await;
        }
        repository
            .insert_response(&NewResponse {
                response_id: "current-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Summarize recent files".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "200".to_string(),
                updated_at: "200".to_string(),
                sequence_index: 200,
                metadata_json: None,
            })
            .await
            .expect("insert current user");

        let mut input = execute_input(Some("loom-1"));
        input.response_id = Some("current-user".to_string());
        input.prompt = "Summarize recent files".to_string();
        let window = context_window_for_execution(
            &database,
            "loom-1",
            &input,
            None,
            false,
            None,
            None,
            DEFAULT_MAX_RECENT_CONTEXT_PAIRS,
        )
        .await
        .expect("context window");

        let attachments = attached_references_for_sources(
            &database,
            &input.prompt,
            &window.attachment_reference_candidates(),
        )
        .await
        .expect("attached references");
        let joined = attachments
            .iter()
            .filter_map(|reference| reference.attachment.as_ref())
            .filter_map(|attachment| attachment.content_text.as_deref())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("RECENT_ATTACHMENT_SENTINEL"));
        assert!(!joined.contains("OLD_ATTACHMENT_SENTINEL"));
    }

    #[tokio::test]
    async fn weft_window_fills_from_origin_and_authorizes_origin_attachments() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        LoomRepository::new(&database)
            .insert_loom(&NewLoom {
                loom_id: "weft-1".to_string(),
                title: "Weft".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "weft".to_string(),
                origin_loom_id: Some("loom-1".to_string()),
                origin_response_id: Some("origin-assistant-21".to_string()),
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Weft");
        let repository = ResponseRepository::new(&database);
        insert_ready_text_attachment(
            &database,
            "loom-1",
            "att-origin-old",
            "origin-old.md",
            "ORIGIN_OLD_ATTACHMENT_SENTINEL",
        )
        .await;
        insert_ready_text_attachment(
            &database,
            "loom-1",
            "att-origin-recent",
            "origin-recent.md",
            "ORIGIN_RECENT_ATTACHMENT_SENTINEL",
        )
        .await;
        for index in 0..22 {
            let attachment_id = match index {
                0 => Some("att-origin-old"),
                21 => Some("att-origin-recent"),
                _ => None,
            };
            insert_origin_response_pair(&repository, index, attachment_id).await;
        }
        repository
            .insert_response(&NewResponse {
                response_id: "weft-current-user".to_string(),
                loom_id: "weft-1".to_string(),
                role: "user".to_string(),
                content: "Use origin context".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "300".to_string(),
                updated_at: "300".to_string(),
                sequence_index: 0,
                metadata_json: None,
            })
            .await
            .expect("insert current user");

        let mut input = execute_input(Some("weft-1"));
        input.response_id = Some("weft-current-user".to_string());
        input.prompt = "Use origin context".to_string();
        let window = context_window_for_execution(
            &database,
            "weft-1",
            &input,
            None,
            true,
            Some("loom-1"),
            Some("origin-assistant-21"),
            DEFAULT_MAX_RECENT_CONTEXT_PAIRS,
        )
        .await
        .expect("context window");

        let attachments = attached_references_for_sources(
            &database,
            &input.prompt,
            &window.attachment_reference_candidates(),
        )
        .await
        .expect("attached references");
        let joined = attachments
            .iter()
            .filter_map(|reference| reference.attachment.as_ref())
            .filter_map(|attachment| attachment.content_text.as_deref())
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(window.pair_count, 20);
        assert!(joined.contains("ORIGIN_RECENT_ATTACHMENT_SENTINEL"));
        assert!(!joined.contains("ORIGIN_OLD_ATTACHMENT_SENTINEL"));
    }

    #[tokio::test]
    async fn recent_context_skips_stale_and_raw_thinking_responses() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let repository = ResponseRepository::new(&database);
        for response in [
            NewResponse {
                response_id: "safe-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Event sourcing nedir?".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                sequence_index: 0,
                metadata_json: None,
            },
            NewResponse {
                response_id: "safe-assistant".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Event Sourcing güvenli bağlamdır.".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "2".to_string(),
                updated_at: "2".to_string(),
                sequence_index: 1,
                metadata_json: None,
            },
            NewResponse {
                response_id: "stale-assistant".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Do not use stale answer.".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "3".to_string(),
                updated_at: "3".to_string(),
                sequence_index: 2,
                metadata_json: Some(serde_json::json!({ "stale": true }).to_string()),
            },
            NewResponse {
                response_id: "current-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Avantajları?".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "5".to_string(),
                updated_at: "5".to_string(),
                sequence_index: 4,
                metadata_json: None,
            },
        ] {
            repository
                .insert_response(&response)
                .await
                .expect("insert response");
        }
        sqlx::query(
            r#"INSERT INTO responses (
                response_id, loom_id, role, content, title, code, canonical_uri,
                created_at, updated_at, sequence_index, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, ?6, ?7, NULL)"#,
        )
        .bind("legacy-raw-user")
        .bind("loom-1")
        .bind("user")
        .bind("raw_thinking must not enter context")
        .bind("4")
        .bind("4")
        .bind(3_i64)
        .execute(database.pool())
        .await
        .expect("insert legacy raw response");

        let recent = recent_messages_before_response(
            &database,
            "loom-1",
            Some("current-user"),
            DEFAULT_MAX_RECENT_CANDIDATE_RESPONSES,
        )
        .await
        .expect("recent messages");
        let joined = recent
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("Event Sourcing güvenli bağlamdır"));
        assert!(!joined.contains("stale answer"));
        assert!(!joined.contains("raw_thinking"));
    }

    #[tokio::test]
    async fn memory_context_includes_profile_and_confirmed_saved_memories() {
        let database = test_database().await;
        let mut config = LoomServiceConfig::default();
        config.memory.enabled = true;
        config.memory.reference_saved_memories = true;
        config.memory.occupation = "Software architect / .NET engineer".to_string();
        config.memory.style_preferences = "Turkish answers, English technical terms".to_string();
        config.memory.more_about_you =
            "Interests: local-first AI runtime, Loom, architecture".to_string();

        MemoryRepository::new(&database)
            .insert_memory(&NewMemory {
                memory_id: "memory-explicit-1".to_string(),
                memory_type: "explicit_user_memory".to_string(),
                content: "The user is evaluating local-first AI runtime architecture.".to_string(),
                normalized_content: "the user is evaluating local-first ai runtime architecture."
                    .to_string(),
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                source_loom_id: None,
                source_response_id: None,
                user_confirmed: true,
                metadata_json: None,
            })
            .await
            .expect("insert memory");

        let messages = memory_messages_for_execution(&database, &config)
            .await
            .expect("memory context");
        let joined = messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("Software architect / .NET engineer"));
        assert!(joined.contains("Turkish answers, English technical terms"));
        assert!(joined.contains("local-first AI runtime"));
        assert!(!joined.contains("raw_thinking"));
    }

    #[tokio::test]
    async fn memory_context_respects_reference_saved_memories_toggle() {
        let database = test_database().await;
        let mut config = LoomServiceConfig::default();
        config.memory.enabled = true;
        config.memory.reference_saved_memories = false;
        config.memory.occupation = "Software architect".to_string();

        MemoryRepository::new(&database)
            .insert_memory(&NewMemory {
                memory_id: "memory-hidden-1".to_string(),
                memory_type: "explicit_user_memory".to_string(),
                content: "Saved Memory should be hidden when the toggle is off.".to_string(),
                normalized_content: "saved memory should be hidden when the toggle is off."
                    .to_string(),
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                source_loom_id: None,
                source_response_id: None,
                user_confirmed: true,
                metadata_json: None,
            })
            .await
            .expect("insert memory");

        let messages = memory_messages_for_execution(&database, &config)
            .await
            .expect("memory context");
        let joined = messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(joined.contains("Software architect"));
        assert!(!joined.contains("Saved Memory should be hidden"));
    }

    #[test]
    fn regenerate_references_parse_question_references_metadata() {
        let metadata = serde_json::json!({
            "questionReferences": [{
                "id": "ref-local",
                "title": "Source title",
                "type": "fragment",
                "targetObjectId": "target-1",
                "selectedText": "MCP",
                "sourceResponseCode": "R1",
                "sourceResponseTitle": "Source response"
            }]
        })
        .to_string();

        let references = references_from_response_metadata(Some(&metadata));

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].reference_id, "ref-local");
        assert_eq!(references[0].selected_text_preview.as_deref(), Some("MCP"));
        assert_eq!(references[0].source_response_code.as_deref(), Some("R1"));
    }

    #[test]
    fn execute_context_references_include_tray_attachment_question_references() {
        let mut input = execute_input(Some("loom-1"));
        input.references = vec![PlannerReference {
            reference_id: "response-ref".to_string(),
            label: Some("Inline response".to_string()),
            selected_text_preview: Some("selected text".to_string()),
            target_kind: "response".to_string(),
            target_id: Some("resp-1".to_string()),
            source_response_code: None,
            source_title: None,
        }];
        input.question_references = Some(serde_json::json!([
            {
                "id": "att-ready",
                "title": "tray-note.md",
                "type": "attachment",
                "targetKind": "attachment",
                "targetObjectId": "att-ready"
            },
            {
                "id": "resp-duplicate",
                "title": "Inline response duplicate",
                "type": "response",
                "targetObjectId": "resp-1"
            }
        ]));

        let references = context_references_for_execute(&input);

        assert_eq!(references.len(), 2);
        assert!(references.iter().any(|reference| {
            reference.target_kind == "response" && reference.target_id.as_deref() == Some("resp-1")
        }));
        let attachment = references
            .iter()
            .find(|reference| reference.target_kind == "attachment")
            .expect("tray attachment reference");
        assert_eq!(attachment.reference_id, "att-ready");
        assert_eq!(attachment.target_id.as_deref(), Some("att-ready"));
        assert_eq!(attachment.label.as_deref(), Some("tray-note.md"));
    }

    #[test]
    fn response_metadata_references_merge_question_attachment_references() {
        let metadata = serde_json::json!({
            "references": [{
                "referenceId": "att-ready",
                "label": "from planner",
                "targetKind": "attachment",
                "targetId": "att-ready"
            }],
            "questionReferences": [
                {
                    "id": "att-ready",
                    "title": "duplicate.md",
                    "type": "attachment",
                    "targetKind": "attachment",
                    "targetObjectId": "att-ready"
                },
                {
                    "id": "att-second",
                    "title": "second.md",
                    "type": "loom",
                    "targetKind": "attachment",
                    "targetObjectId": "att-second"
                }
            ]
        })
        .to_string();

        let references = references_from_response_metadata(Some(&metadata));

        assert_eq!(references.len(), 2);
        assert_eq!(references[0].reference_id, "att-ready");
        let second = references
            .iter()
            .find(|reference| reference.target_id.as_deref() == Some("att-second"))
            .expect("second attachment");
        assert_eq!(second.target_kind, "attachment");
        assert_eq!(second.label.as_deref(), Some("second.md"));
    }

    #[tokio::test]
    async fn orchestration_context_scope_detects_weft_origin_metadata() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        LoomRepository::new(&database)
            .insert_loom(&NewLoom {
                loom_id: "weft-loom".to_string(),
                title: "Weft Loom".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "weft".to_string(),
                origin_loom_id: Some("loom-1".to_string()),
                origin_response_id: Some("origin-response".to_string()),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Weft");

        let (is_weft, origin_loom_id, origin_response_id) =
            resolve_context_scope(&database, "weft-loom")
                .await
                .expect("resolve context scope");

        assert!(is_weft);
        assert_eq!(origin_loom_id.as_deref(), Some("loom-1"));
        assert_eq!(origin_response_id.as_deref(), Some("origin-response"));
    }

    async fn insert_test_loom(database: &crate::storage::db::Database) {
        LoomRepository::new(database)
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
            .expect("insert Loom");
    }

    async fn insert_event_sourcing_seed(database: &crate::storage::db::Database) {
        let repository = ResponseRepository::new(database);
        for response in [
            NewResponse {
                response_id: "event-user".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Event sourcing nedir? Nerelerde kullanılır? Detaylı anlat".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                sequence_index: 0,
                metadata_json: None,
            },
            NewResponse {
                response_id: "event-assistant".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Event Sourcing, uygulama durumunu immutable event dizisi olarak saklama yaklaşımıdır. Event Store kayıt kaynağıdır; Replay geçmiş eventlerden durumu yeniden kurar; CQRS okuma ve yazma modellerini ayırır. Avantajları audit, tam geçmiş ve yeniden oynatma; dezavantajları şema evrimi, operasyonel karmaşıklık ve eventual consistency yönetimidir.".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "2".to_string(),
                updated_at: "2".to_string(),
                sequence_index: 1,
                metadata_json: Some(serde_json::json!({ "status": "completed" }).to_string()),
            },
        ] {
            repository
                .insert_response(&response)
                .await
                .expect("insert Event Sourcing response");
        }
    }

    async fn insert_ready_text_attachment(
        database: &crate::storage::db::Database,
        loom_id: &str,
        attachment_id: &str,
        file_name: &str,
        content: &str,
    ) {
        let repository = AttachmentRepository::new(database);
        repository
            .insert_attachment(&NewAttachment {
                attachment_id: attachment_id.to_string(),
                loom_id: loom_id.to_string(),
                file_name: file_name.to_string(),
                mime_type: Some("text/markdown".to_string()),
                bytes: content.as_bytes().to_vec(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
            })
            .await
            .expect("insert Attachment");
        repository
            .parse_attachment_now(attachment_id, "2026-05-08T00:00:01Z")
            .await
            .expect("parse Attachment")
            .expect("Attachment exists");
    }

    async fn insert_test_response_pair(
        repository: &ResponseRepository,
        loom_id: &str,
        index: i64,
        attachment_id: Option<&str>,
    ) {
        let metadata_json = attachment_id.map(attachment_metadata_json);
        repository
            .insert_response_pair(
                &NewResponse {
                    response_id: format!("user-{index}"),
                    loom_id: loom_id.to_string(),
                    role: "user".to_string(),
                    content: format!("Question {index}"),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: index.to_string(),
                    updated_at: index.to_string(),
                    sequence_index: index * 2,
                    metadata_json,
                },
                &NewResponse {
                    response_id: format!("assistant-{index}"),
                    loom_id: loom_id.to_string(),
                    role: "assistant".to_string(),
                    content: format!("Answer {index}"),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: index.to_string(),
                    updated_at: index.to_string(),
                    sequence_index: index * 2 + 1,
                    metadata_json: Some(serde_json::json!({ "status": "completed" }).to_string()),
                },
            )
            .await
            .expect("insert pair");
    }

    async fn insert_origin_response_pair(
        repository: &ResponseRepository,
        index: i64,
        attachment_id: Option<&str>,
    ) {
        let metadata_json = attachment_id.map(attachment_metadata_json);
        repository
            .insert_response_pair(
                &NewResponse {
                    response_id: format!("origin-user-{index}"),
                    loom_id: "loom-1".to_string(),
                    role: "user".to_string(),
                    content: format!("Origin question {index}"),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: index.to_string(),
                    updated_at: index.to_string(),
                    sequence_index: index * 2,
                    metadata_json,
                },
                &NewResponse {
                    response_id: format!("origin-assistant-{index}"),
                    loom_id: "loom-1".to_string(),
                    role: "assistant".to_string(),
                    content: format!("Origin answer {index}"),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: index.to_string(),
                    updated_at: index.to_string(),
                    sequence_index: index * 2 + 1,
                    metadata_json: Some(serde_json::json!({ "status": "completed" }).to_string()),
                },
            )
            .await
            .expect("insert origin pair");
    }

    fn attachment_metadata_json(attachment_id: &str) -> String {
        serde_json::json!({
            "references": [{
                "referenceId": attachment_id,
                "label": attachment_id,
                "targetKind": "attachment",
                "targetId": attachment_id
            }],
            "questionReferences": [{
                "id": attachment_id,
                "referenceMentionId": attachment_id,
                "title": attachment_id,
                "targetKind": "attachment",
                "targetObjectId": attachment_id
            }]
        })
        .to_string()
    }

    async fn insert_event_sourcing_proof_turns(database: &crate::storage::db::Database) {
        let repository = ResponseRepository::new(database);
        for response in [
            NewResponse {
                response_id: "event-user-1".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                sequence_index: 0,
                metadata_json: None,
            },
            NewResponse {
                response_id: "event-assistant-1".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: event_sourcing_detailed_answer(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "2".to_string(),
                updated_at: "2".to_string(),
                sequence_index: 1,
                metadata_json: Some(serde_json::json!({ "status": "completed" }).to_string()),
            },
            NewResponse {
                response_id: "event-user-2".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Avantajları ve dezavantajları tablo şeklinde verebilir misin?"
                    .to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "3".to_string(),
                updated_at: "3".to_string(),
                sequence_index: 2,
                metadata_json: None,
            },
            NewResponse {
                response_id: "event-assistant-2".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: event_sourcing_table_answer(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "4".to_string(),
                updated_at: "4".to_string(),
                sequence_index: 3,
                metadata_json: Some(serde_json::json!({ "status": "completed" }).to_string()),
            },
            NewResponse {
                response_id: "event-user-3".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Dezavantajları ve avantajları biraz daha açar mısın".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "5".to_string(),
                updated_at: "5".to_string(),
                sequence_index: 4,
                metadata_json: None,
            },
            NewResponse {
                response_id: "event-assistant-3".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: event_sourcing_expanded_answer(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "6".to_string(),
                updated_at: "6".to_string(),
                sequence_index: 5,
                metadata_json: Some(serde_json::json!({ "status": "completed" }).to_string()),
            },
        ] {
            repository
                .insert_response(&response)
                .await
                .expect("insert proof response");
        }
    }

    fn event_sourcing_detailed_answer() -> String {
        [
            "# Event Sourcing",
            "",
            "Event Sourcing, uygulama durumunu son tablo hali yerine gerçekleşen olayların sıralı kaydı olarak saklayan bir mimari yaklaşımdır. Event Store sistemin kayıt kaynağıdır; Replay geçmiş eventlerden durumu yeniden kurar; CQRS okuma ve yazma modellerini ayırabilir.",
            "",
            "Avantajları audit edilebilirlik, tam geçmiş ve yeniden oynatma; dezavantajları şema evrimi, operasyonel karmaşıklık ve eventual consistency yönetimidir.",
            "",
            "```ts",
            "const stream = eventStore.load(aggregateId);",
            "const state = replay(stream);",
            "```",
        ]
        .join("\n")
    }

    fn event_sourcing_table_answer() -> String {
        [
            "Event Sourcing için avantajlar ve dezavantajlar:",
            "",
            "| Avantaj | Dezavantaj |",
            "| :--- | :--- |",
            "| Tam geçmiş ve audit izi sağlar. | Event şeması evrimi dikkat ister. |",
            "| Replay ile yeni projeksiyonlar üretilebilir. | Eventual consistency kullanıcı deneyimini karmaşıklaştırabilir. |",
            "| CQRS ile okuma/yazma modelleri ayrılabilir. | Event Store işletimi ve izleme ek yük getirir. |",
        ]
        .join("\n")
    }

    fn event_sourcing_expanded_answer() -> String {
        "Event Sourcing avantajları özellikle audit, geçmişi yeniden oynatma ve CQRS projeksiyonları üzerinden yeni okuma modelleri üretme tarafında güçlenir. Dezavantajları ise Event Store işletimi, Replay maliyeti, Snapshot stratejisi, şema evrimi ve eventual consistency yönetiminde ortaya çıkar.".to_string()
    }

    fn context_text(context: &crate::context::types::BuiltContext) -> String {
        context
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn assert_no_forbidden_context_keys(value: &str) {
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(
                !value.contains(forbidden),
                "forbidden context key leaked: {forbidden}"
            );
        }
    }

    fn execute_input(loom_id: Option<&str>) -> OrchestrationExecuteInput {
        OrchestrationExecuteInput {
            loom_id: loom_id.map(str::to_string),
            response_id: None,
            prompt: "Event sourcing nedir?".to_string(),
            references: Vec::new(),
            question_references: None,
            response_mode: ResponseMode::Auto,
            model: "qwen3.5:9b".to_string(),
            provider_profile_id: None,
            options: None,
            persist_workflow: true,
            regenerate_from_response_id: None,
            stale_assistant_response_id: None,
            source: None,
        }
    }

    async fn seed_generation_resume_run(
        database: &crate::storage::db::Database,
        run_id: &str,
        assistant_status: &str,
    ) {
        let _ = LoomRepository::new(database)
            .insert_loom(&NewLoom {
                loom_id: "loom-resume".to_string(),
                title: "Resume proof".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                metadata_json: None,
            })
            .await;
        WorkflowRunRepository::new(database)
            .insert_run(&NewWorkflowRun {
                run_id: run_id.to_string(),
                loom_id: Some("loom-resume".to_string()),
                response_id: None,
                status: match assistant_status {
                    "running" => "running",
                    "cancelled" => "cancelled",
                    "error" => "failed",
                    _ => "done",
                }
                .to_string(),
                started_at: "1".to_string(),
                finished_at: if assistant_status == "running" {
                    None
                } else {
                    Some("3".to_string())
                },
                metadata_json: None,
            })
            .await
            .expect("insert run");
        WorkflowStageRepository::new(database)
            .insert_stages(&[NewWorkflowStage {
                stage_id: format!("{run_id}:generate"),
                run_id: run_id.to_string(),
                stage_kind: "generate".to_string(),
                title: "Generating".to_string(),
                status: match assistant_status {
                    "running" => "running",
                    "cancelled" => "cancelled",
                    "error" => "failed",
                    _ => "done",
                }
                .to_string(),
                sequence_index: 0,
                started_at: Some("1".to_string()),
                finished_at: if assistant_status == "running" {
                    None
                } else {
                    Some("3".to_string())
                },
                error: if assistant_status == "error" {
                    Some("runtime_unavailable".to_string())
                } else {
                    None
                },
                metadata_json: None,
            }])
            .await
            .expect("insert stage");
        ResponseRepository::new(database)
            .insert_response_pair_at_next_sequence(
                NewResponse {
                    response_id: format!("response-{run_id}-user"),
                    loom_id: "loom-resume".to_string(),
                    role: "user".to_string(),
                    content: "visible user prompt".to_string(),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: "1".to_string(),
                    updated_at: "1".to_string(),
                    sequence_index: 0,
                    metadata_json: Some(format!("{{\"workflowRunId\":\"{run_id}\"}}")),
                },
                NewResponse {
                    response_id: format!("response-{run_id}-assistant"),
                    loom_id: "loom-resume".to_string(),
                    role: "assistant".to_string(),
                    content: "visible assistant answer".to_string(),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: "2".to_string(),
                    updated_at: "2".to_string(),
                    sequence_index: 0,
                    metadata_json: Some(if assistant_status == "error" {
                        format!(
                            "{{\"workflowRunId\":\"{run_id}\",\"status\":\"error\",\"error\":{{\"kind\":\"runtime_unavailable\",\"message\":\"Provider unavailable\"}}}}"
                        )
                    } else {
                        format!(
                            "{{\"workflowRunId\":\"{run_id}\",\"status\":\"{assistant_status}\"}}"
                        )
                    }),
                },
            )
            .await
            .expect("insert responses");
        let events = OrchestrationEventRepository::new(database);
        events
            .insert_event(&NewOrchestrationEvent {
                event_id: format!("event-{run_id}-1"),
                run_id: run_id.to_string(),
                event_type: "response.delta".to_string(),
                stage_id: Some("generate".to_string()),
                payload_json: Some(format!(
                    "{{\"runId\":\"{run_id}\",\"delta\":\"visible assistant answer\"}}"
                )),
                created_at: "1".to_string(),
            })
            .await
            .expect("insert event 1");
        events
            .insert_event(&NewOrchestrationEvent {
                event_id: format!("event-{run_id}-2"),
                run_id: run_id.to_string(),
                event_type: if assistant_status == "running" {
                    "orchestration.progress"
                } else if assistant_status == "cancelled" {
                    "response.cancelled"
                } else if assistant_status == "error" {
                    "response.error"
                } else {
                    "response.completed"
                }
                .to_string(),
                stage_id: Some("generate".to_string()),
                payload_json: Some(format!("{{\"runId\":\"{run_id}\"}}")),
                created_at: "2".to_string(),
            })
            .await
            .expect("insert event 2");
    }

    fn context_input(prompt: &str) -> BuildContextInput {
        BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: Some("response-current".to_string()),
            user_prompt: prompt.to_string(),
            attached_references: Vec::new(),
            response_mode: ContextResponseMode::Auto,
            resolved_num_ctx: 8_192,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            memory_messages: Vec::new(),
            recent_messages: Vec::new(),
        }
    }

    fn deep_request() -> DeepSynthesisRequest {
        DeepSynthesisRequest {
            loom_id: None,
            prompt: "Build a deep synthesis of local model routing.".to_string(),
            references: Vec::new(),
            requested_mode: RequestedMode::Deep,
            model_name: "qwen3.5:9b".to_string(),
            strategy_decision_id: None,
            strategy: None,
            max_parallelism: Some(3),
            section_count: None,
        }
    }

    fn deep_plan(strategy: ExecutionStrategy, max_parallelism: i64) -> DeepSynthesisPlan {
        DeepSynthesisPlan {
            strategy,
            sections: Vec::new(),
            draft_workers: vec![
                DeepSynthesisWorkerRole::ConciseDraft,
                DeepSynthesisWorkerRole::DetailedDraft,
                DeepSynthesisWorkerRole::CriticalDraft,
            ],
            synthesis_step: DeepSynthesisWorkerRole::Synthesizer,
            max_parallelism,
            estimated_budget: 8192,
            warnings: Vec::new(),
        }
    }

    fn strategy_decision(
        strategy: ExecutionStrategy,
        max_parallelism: i64,
        allow_deep_synthesis: bool,
    ) -> ExecutionStrategyDecision {
        ExecutionStrategyDecision {
            decision_id: "decision-test".to_string(),
            snapshot_id: Some("snapshot-test".to_string()),
            model_id: Some("ollama:qwen3.5:9b".to_string()),
            requested_mode: "deep".to_string(),
            prompt_kind: "synthesis".to_string(),
            context_size_tokens: 1200,
            strategy,
            max_output_tokens: 4096,
            max_parallelism,
            allow_deep_synthesis,
            allow_parallel_drafts: max_parallelism > 1,
            reason: Vec::new(),
            warnings: Vec::new(),
            created_at: "1".to_string(),
        }
    }

    // ------------------------------------------------------------------
    // Ollama stream parser — contract coverage (orchestration path)
    // ------------------------------------------------------------------

    #[test]
    fn orchestration_parser_handles_generate_format() {
        let mut buffer = String::new();
        let chunks = parse_ndjson_bytes(&mut buffer, b"{\"response\":\"Hello\",\"done\":false}\n")
            .expect("parse generate chunk");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].content.as_deref(), Some("Hello"));
        assert!(!chunks[0].done);
    }

    #[test]
    fn orchestration_parser_handles_chat_format() {
        let mut buffer = String::new();
        let chunks = parse_ndjson_bytes(
            &mut buffer,
            b"{\"message\":{\"content\":\"World\"},\"done\":false}\n",
        )
        .expect("parse chat chunk");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].content.as_deref(), Some("World"));
    }

    #[test]
    fn orchestration_parser_handles_final_done_chunk() {
        let mut buffer = String::new();
        let chunks = parse_ndjson_bytes(&mut buffer, b"{\"done\":true,\"total_duration\":999}\n")
            .expect("parse final done chunk");
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].done);
        assert!(chunks[0].content.is_none());
    }

    #[test]
    fn orchestration_parser_ignores_empty_lines() {
        let mut buffer = String::new();
        let chunks = parse_ndjson_bytes(
            &mut buffer,
            b"\n\n{\"message\":{\"content\":\"Hi\"},\"done\":false}\n",
        )
        .expect("parse with empty lines");
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn orchestration_parser_surfaces_ollama_error_chunk() {
        let mut buffer = String::new();
        let result = parse_ndjson_bytes(&mut buffer, b"{\"error\":\"context window exceeded\"}\n");
        assert!(
            result.is_err(),
            "error chunk must not be silently swallowed"
        );
        let err = result.unwrap_err();
        assert!(err.message.contains("Ollama returned an error"));
        assert!(err.message.contains("context window exceeded"));
    }

    #[test]
    fn orchestration_parser_error_chunk_sanitizes_sensitive_content() {
        // An error chunk containing a forbidden key should be sanitized, not exposed raw
        let mut buffer = String::new();
        let result = parse_ndjson_bytes(&mut buffer, b"{\"error\":\"api_key is invalid\"}\n");
        assert!(result.is_err());
        let err = result.unwrap_err();
        // "api_key" is a forbidden term — sanitize_provider_text replaces the whole message
        assert!(!err.message.contains("api_key is invalid"));
    }

    #[test]
    fn orchestration_parser_malformed_line_yields_stream_parse_error() {
        use crate::providers::types::OllamaRuntimeErrorKind;
        let mut buffer = String::new();
        let result = parse_ndjson_bytes(&mut buffer, b"not_json\n");
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().kind,
            OllamaRuntimeErrorKind::StreamParseError
        );
    }

    #[test]
    fn orchestration_parser_accumulates_partial_lines() {
        let mut buffer = String::new();
        let first = parse_ndjson_bytes(&mut buffer, b"{\"message\":{\"content\":\"par")
            .expect("first partial");
        assert!(first.is_empty());
        let second = parse_ndjson_bytes(&mut buffer, b"tial\"},\"done\":false}\n")
            .expect("completing chunk");
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].content.as_deref(), Some("partial"));
    }
}
