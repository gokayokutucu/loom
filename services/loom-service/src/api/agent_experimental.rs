//! Gated experimental Agent Runtime route (AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001).
//!
//! Service-level stream proof only: not a production generation path, not used
//! by the frontend, and only mounted when `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API`
//! is enabled. Streams safe `AgentEvent` values as NDJSON.

use std::convert::Infallible;

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::{Stream, StreamExt};
use serde::{Deserialize, Serialize};

use crate::agent_runtime::events::AgentEvent;
use crate::agent_runtime::runtime::AgentCancellationOutcome;
use crate::agent_runtime::types::{
    AgentRunId, AgentRunMode, AgentRunStatus, AgentRuntimeProviderOptions, AgentRuntimeRequest,
};
use crate::api::state::AppState;
use crate::storage::repositories::agent_runs::{AgentEventRecord, AgentRunRecord, AgentStepRecord};

pub const EXPERIMENTAL_AGENT_RUN_PATH: &str = "/experimental/agent/run";
pub const EXPERIMENTAL_AGENT_CANCEL_PATH: &str = "/experimental/agent/runs/:run_id/cancel";
pub const EXPERIMENTAL_AGENT_TOOLS_PATH: &str = "/experimental/agent/tools";
pub const EXPERIMENTAL_AGENT_RUNS_PATH: &str = "/experimental/agent/runs";
pub const EXPERIMENTAL_AGENT_RUN_GET_PATH: &str = "/experimental/agent/runs/:run_id";
pub const EXPERIMENTAL_AGENT_RUN_STEPS_PATH: &str = "/experimental/agent/runs/:run_id/steps";
pub const EXPERIMENTAL_AGENT_RUN_EVENTS_PATH: &str = "/experimental/agent/runs/:run_id/events";
pub const EXPERIMENTAL_AGENT_RUNTIME_ENV: &str = "LOOM_EXPERIMENTAL_AGENT_RUNTIME_API";

const NDJSON_CONTENT_TYPE: &str = "application/x-ndjson";
const MAX_PROMPT_CHARS: usize = 32_768;
const MIN_TEMPERATURE: f64 = 0.0;
const MAX_TEMPERATURE: f64 = 2.0;
const MAX_OUTPUT_TOKENS_CAP: u64 = 8_192;
const DEFAULT_RUNS_LIMIT: i64 = 50;
const MAX_RUNS_LIMIT: i64 = 100;
const DEFAULT_EVENTS_LIMIT: i64 = 100;
const MAX_EVENTS_LIMIT: i64 = 200;

/// Route DTO, deliberately separate from the internal `AgentRuntimeRequest`.
/// `deny_unknown_fields` rejects raw provider payloads, API keys, or
/// Authorization-style fields smuggled into the request body.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentalAgentRunRequest {
    pub prompt: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub parent_response_id: Option<String>,
    pub provider_profile_id: Option<String>,
    pub model: Option<String>,
    pub provider_options: Option<ExperimentalAgentProviderOptions>,
    pub context_snapshot_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentalAgentProviderOptions {
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExperimentalApiError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentalAgentCancelResponse {
    pub run_id: String,
    pub status: String,
    pub cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRunsQuery {
    pub loom_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsQuery {
    pub since_sequence: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunsListResponse {
    pub runs: Vec<AgentRunRecord>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepsListResponse {
    pub steps: Vec<AgentStepRecord>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventsListResponse {
    pub events: Vec<AgentEventRecord>,
    pub count: usize,
    pub has_more: bool,
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<AgentExperimentalApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(AgentExperimentalApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

/// Validates the route DTO and maps it into the internal runtime request.
/// Provider options pass through as-is: defaults are owned by the runtime
/// (`AgentRuntimeProviderOptions::default()`), not re-hard-coded here.
fn validate_run_request(
    request: ExperimentalAgentRunRequest,
) -> Result<AgentRuntimeRequest, (StatusCode, Json<AgentExperimentalApiError>)> {
    let prompt = request.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err(bad_request("PROMPT_EMPTY", "prompt must not be empty"));
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(bad_request(
            "PROMPT_TOO_LONG",
            "prompt exceeds the maximum supported length",
        ));
    }

    let provider_options = match request.provider_options {
        None => None,
        Some(options) => {
            if let Some(temperature) = options.temperature {
                if !temperature.is_finite()
                    || !(MIN_TEMPERATURE..=MAX_TEMPERATURE).contains(&temperature)
                {
                    return Err(bad_request(
                        "TEMPERATURE_OUT_OF_RANGE",
                        "temperature must be finite and between 0.0 and 2.0",
                    ));
                }
            }
            if let Some(max_output_tokens) = options.max_output_tokens {
                if max_output_tokens == 0 || max_output_tokens > MAX_OUTPUT_TOKENS_CAP {
                    return Err(bad_request(
                        "MAX_OUTPUT_TOKENS_OUT_OF_RANGE",
                        "maxOutputTokens must be greater than 0 and within the supported cap",
                    ));
                }
            }
            Some(AgentRuntimeProviderOptions {
                temperature: options.temperature.map(|t| t as f32),
                max_output_tokens: options.max_output_tokens.map(|t| t as u32),
            })
        }
    };

    Ok(AgentRuntimeRequest {
        prompt,
        run_mode: AgentRunMode::FullConversation,
        loom_id: request.loom_id,
        response_id: request.response_id,
        parent_response_id: request.parent_response_id,
        provider_profile_id: request.provider_profile_id,
        model_id: request.model,
        context_snapshot_id: request.context_snapshot_id,
        legacy_context: None,
        provider_options,
    })
}

/// Maps a safe `AgentEvent` stream into NDJSON lines (one event per line).
fn ndjson_event_stream(
    events: impl Stream<Item = AgentEvent>,
) -> impl Stream<Item = Result<String, Infallible>> {
    events.map(|event| {
        let line = serde_json::to_string(&event).unwrap_or_else(|error| {
            tracing::error!(%error, "failed to serialize agent event for NDJSON stream");
            "{\"type\":\"warning\",\"run_id\":\"\",\"message\":\"event serialization failed\"}"
                .to_string()
        });
        Ok(format!("{line}\n"))
    })
}

fn ndjson_response(events: impl Stream<Item = AgentEvent> + Send + 'static) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, NDJSON_CONTENT_TYPE)
        .body(axum::body::Body::from_stream(ndjson_event_stream(events)))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

pub async fn run(
    State(state): State<AppState>,
    Json(request): Json<ExperimentalAgentRunRequest>,
) -> Response {
    let runtime_request = match validate_run_request(request) {
        Ok(runtime_request) => runtime_request,
        Err(error) => return error.into_response(),
    };

    let service = state.agent_runtime();
    ndjson_response(service.execute(runtime_request))
}

fn status_label(status: AgentRunStatus) -> &'static str {
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

pub async fn cancel(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    let run_id = AgentRunId::from(run_id);
    cancel_response(&run_id, state.agent_runtime().cancel(&run_id))
}

fn cancel_response(
    run_id: &AgentRunId,
    outcome: AgentCancellationOutcome,
) -> (StatusCode, Json<ExperimentalAgentCancelResponse>) {
    match outcome {
        AgentCancellationOutcome::NotFound => (
            StatusCode::NOT_FOUND,
            Json(ExperimentalAgentCancelResponse {
                run_id: run_id.to_string(),
                status: "not_found".to_string(),
                cancelled: false,
                message: Some("agent run was not found".to_string()),
            }),
        ),
        AgentCancellationOutcome::Cancelled { run, .. } => (
            StatusCode::OK,
            Json(ExperimentalAgentCancelResponse {
                run_id: run.run_id.to_string(),
                status: status_label(run.status).to_string(),
                cancelled: true,
                message: None,
            }),
        ),
        AgentCancellationOutcome::Terminal { run } => (
            StatusCode::OK,
            Json(ExperimentalAgentCancelResponse {
                run_id: run.run_id.to_string(),
                status: status_label(run.status).to_string(),
                cancelled: false,
                message: Some("agent run is already terminal".to_string()),
            }),
        ),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentalToolRegistryResponse {
    pub tools: Vec<crate::agent_runtime::tool_registry::RegisteredTool>,
    pub count: usize,
    pub registry_status: String,
    pub execution_enabled: bool,
}

pub async fn list_tools(State(state): State<AppState>) -> impl IntoResponse {
    let tools = state.tool_registry.read().unwrap().list();
    let count = tools.len();
    let registry_status = if count > 0 { "available" } else { "empty" }.to_string();

    (
        StatusCode::OK,
        Json(ExperimentalToolRegistryResponse {
            tools,
            count,
            registry_status,
            execution_enabled: false,
        }),
    )
}

pub async fn list_runs(
    State(state): State<AppState>,
    Query(query): Query<ListRunsQuery>,
) -> Response {
    let loom_id = match query.loom_id {
        Some(ref id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => {
            return bad_request("LOOM_ID_REQUIRED", "loomId query parameter is required")
                .into_response()
        }
    };
    let limit = query
        .limit
        .unwrap_or(DEFAULT_RUNS_LIMIT)
        .clamp(1, MAX_RUNS_LIMIT);
    match state
        .agent_run_repository
        .list_runs_for_loom(&loom_id, limit)
        .await
    {
        Ok(runs) => {
            let count = runs.len();
            (StatusCode::OK, Json(AgentRunsListResponse { runs, count })).into_response()
        }
        Err(error) => {
            tracing::error!(%error, "failed to list agent runs for loom");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

pub async fn get_run_history(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Response {
    match state.agent_run_repository.get_run(&run_id).await {
        Ok(Some(run)) => (StatusCode::OK, Json(run)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => {
            tracing::error!(%error, "failed to get agent run");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

pub async fn list_steps(State(state): State<AppState>, Path(run_id): Path<String>) -> Response {
    match state.agent_run_repository.list_steps_for_run(&run_id).await {
        Ok(steps) => {
            let count = steps.len();
            (
                StatusCode::OK,
                Json(AgentStepsListResponse { steps, count }),
            )
                .into_response()
        }
        Err(error) => {
            tracing::error!(%error, "failed to list agent steps for run");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

pub async fn list_events(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Query(query): Query<ListEventsQuery>,
) -> Response {
    let since = query.since_sequence.unwrap_or(0).max(0);
    let limit = query
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    match state
        .agent_run_repository
        .list_events_for_run(&run_id, since, limit)
        .await
    {
        Ok(events) => {
            let count = events.len();
            let has_more = count == limit as usize;
            (
                StatusCode::OK,
                Json(AgentEventsListResponse {
                    events,
                    count,
                    has_more,
                }),
            )
                .into_response()
        }
        Err(error) => {
            tracing::error!(%error, "failed to list agent events for run");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime::test_support::make_test_service;
    use crate::agent_runtime::types::AgentRunId;
    use crate::providers::contract::{ProviderContractEvent, ProviderUsageMetadata};
    use futures_util::StreamExt;

    fn base_request(prompt: &str) -> ExperimentalAgentRunRequest {
        ExperimentalAgentRunRequest {
            prompt: prompt.to_string(),
            loom_id: Some("loom-1".to_string()),
            response_id: Some("resp-1".to_string()),
            parent_response_id: None,
            provider_profile_id: None,
            model: Some("test-model".to_string()),
            provider_options: None,
            context_snapshot_id: None,
        }
    }

    #[test]
    fn rejects_empty_and_oversized_prompts() {
        let error = validate_run_request(base_request("   ")).expect_err("empty rejected");
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "PROMPT_EMPTY");

        let oversized = "x".repeat(MAX_PROMPT_CHARS + 1);
        let error = validate_run_request(base_request(&oversized)).expect_err("too long rejected");
        assert_eq!(error.1 .0.code, "PROMPT_TOO_LONG");
    }

    #[test]
    fn rejects_unsafe_provider_options() {
        let mut request = base_request("hello");
        request.provider_options = Some(ExperimentalAgentProviderOptions {
            temperature: Some(f64::NAN),
            max_output_tokens: None,
        });
        let error = validate_run_request(request).expect_err("NaN rejected");
        assert_eq!(error.1 .0.code, "TEMPERATURE_OUT_OF_RANGE");

        let mut request = base_request("hello");
        request.provider_options = Some(ExperimentalAgentProviderOptions {
            temperature: Some(3.5),
            max_output_tokens: None,
        });
        assert!(validate_run_request(request).is_err());

        let mut request = base_request("hello");
        request.provider_options = Some(ExperimentalAgentProviderOptions {
            temperature: None,
            max_output_tokens: Some(0),
        });
        let error = validate_run_request(request).expect_err("zero tokens rejected");
        assert_eq!(error.1 .0.code, "MAX_OUTPUT_TOKENS_OUT_OF_RANGE");

        let mut request = base_request("hello");
        request.provider_options = Some(ExperimentalAgentProviderOptions {
            temperature: None,
            max_output_tokens: Some(MAX_OUTPUT_TOKENS_CAP + 1),
        });
        assert!(validate_run_request(request).is_err());
    }

    #[test]
    fn default_options_pass_through_without_route_literals() {
        // No provider options on the request: the route forwards `None` so the
        // runtime's own defaults apply — the route hard-codes nothing.
        let runtime_request = validate_run_request(base_request("hello")).expect("valid");
        assert!(runtime_request.provider_options.is_none());
        assert_eq!(runtime_request.prompt, "hello");
        assert_eq!(runtime_request.model_id.as_deref(), Some("test-model"));
    }

    #[test]
    fn custom_options_map_through() {
        let mut request = base_request("hello");
        request.provider_options = Some(ExperimentalAgentProviderOptions {
            temperature: Some(0.3),
            max_output_tokens: Some(256),
        });
        let runtime_request = validate_run_request(request).expect("valid");
        let options = runtime_request.provider_options.expect("options mapped");
        assert_eq!(options.temperature, Some(0.3));
        assert_eq!(options.max_output_tokens, Some(256));
    }

    #[test]
    fn request_dto_rejects_unknown_fields() {
        // Raw provider payloads / credential fields must not deserialize.
        for payload in [
            r#"{"prompt":"hi","authorization":"Bearer abc"}"#,
            r#"{"prompt":"hi","apiKey":"sk-123"}"#,
            r#"{"prompt":"hi","providerPayload":{"messages":[]}}"#,
        ] {
            let parsed = serde_json::from_str::<ExperimentalAgentRunRequest>(payload);
            assert!(parsed.is_err(), "payload unexpectedly accepted: {payload}");
        }
    }

    #[tokio::test]
    async fn ndjson_stream_serializes_safe_events_only() {
        let provider_events = vec![
            ProviderContractEvent::ThinkingStatus {
                status: "active".to_string(),
                duration_ms: Some(5),
                token_estimate: Some(2),
            },
            ProviderContractEvent::ThinkingDelta {
                text: "secret reasoning chain_of_thought".to_string(),
            },
            ProviderContractEvent::Delta {
                text: "visible answer".to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: ProviderUsageMetadata::Available {
                    prompt_tokens: Some(3),
                    completion_tokens: Some(4),
                    total_tokens: Some(7),
                },
            },
        ];
        let (service, _) = make_test_service(provider_events);
        let runtime_request =
            validate_run_request(base_request("route privacy prompt")).expect("valid");

        let lines = ndjson_event_stream(service.execute(runtime_request))
            .collect::<Vec<_>>()
            .await;
        let body = lines
            .into_iter()
            .map(|line| line.expect("infallible"))
            .collect::<String>();

        // One JSON object per line, parseable, ending with run_completed.
        let parsed: Vec<serde_json::Value> = body
            .lines()
            .map(|line| serde_json::from_str(line).expect("valid NDJSON line"))
            .collect();
        assert_eq!(parsed.first().unwrap()["type"], "run_started");
        assert_eq!(parsed.last().unwrap()["type"], "run_completed");
        assert!(parsed.iter().any(|v| v["type"] == "provider_delta"));

        for forbidden in [
            "secret reasoning",
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "authorization",
            "bearer",
        ] {
            assert!(
                !body.to_ascii_lowercase().contains(forbidden),
                "found forbidden text in route stream: {forbidden}"
            );
        }

        // The run store keeps metadata only — never the prompt text.
        let actual_run_id = parsed[0]["run_id"]
            .as_str()
            .expect("run_id in run_started event")
            .to_string();
        let run = service
            .run_store()
            .get(&AgentRunId::from(actual_run_id))
            .expect("run recorded");
        let run_serialized = serde_json::to_string(&run).expect("serialize run");
        assert!(!run_serialized.contains("route privacy prompt"));
    }

    mod router_gate {
        use super::super::{
            EXPERIMENTAL_AGENT_CANCEL_PATH, EXPERIMENTAL_AGENT_RUN_PATH,
            EXPERIMENTAL_AGENT_TOOLS_PATH, NDJSON_CONTENT_TYPE,
        };
        use crate::{
            agent_runtime::runtime::AgentCancellationOutcome,
            agent_runtime::service::AgentRuntimeService,
            agent_runtime::test_support::{make_pending_test_service, FakeRegistry},
            agent_runtime::types::AgentRunId,
            api::{router_with_experimental, ExperimentalApiConfig},
            config::{ConfigManager, LoomServiceConfig, OllamaConfig},
            providers::contract::ProviderContractEvent,
            providers::ollama::OllamaRuntime,
            runtime::{OperationTracker, RestartState},
            storage::db::test_database,
        };
        use axum::{
            body::Body,
            extract::{Path, State},
            http::{header, Request, StatusCode},
            response::{IntoResponse, Response},
            routing::post,
            Json, Router,
        };
        use http_body_util::BodyExt;
        use std::{path::PathBuf, time::Duration};
        use tower::ServiceExt;

        async fn test_router(experimental: ExperimentalApiConfig) -> Router {
            let database = test_database().await;
            // Unreachable Ollama: provider calls fail fast and safely.
            let ollama = OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            });
            let config = ConfigManager::new(
                PathBuf::from("/tmp/loom-agent-route-test.toml"),
                LoomServiceConfig::default(),
            );
            router_with_experimental(
                database,
                ollama,
                config,
                OperationTracker::default(),
                RestartState::default(),
                experimental,
            )
        }

        fn run_request(body: &str) -> Request<Body> {
            Request::builder()
                .method("POST")
                .uri(EXPERIMENTAL_AGENT_RUN_PATH)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .expect("request")
        }

        fn cancel_request(run_id: &str) -> Request<Body> {
            Request::builder()
                .method("POST")
                .uri(EXPERIMENTAL_AGENT_CANCEL_PATH.replace(":run_id", run_id))
                .body(Body::empty())
                .expect("request")
        }

        #[derive(Clone)]
        struct TestAgentState {
            service: AgentRuntimeService<FakeRegistry>,
        }

        async fn test_run(
            State(state): State<TestAgentState>,
            Json(request): Json<super::super::ExperimentalAgentRunRequest>,
        ) -> Response {
            let runtime_request = match super::super::validate_run_request(request) {
                Ok(request) => request,
                Err(error) => return error.into_response(),
            };
            super::super::ndjson_response(state.service.execute(runtime_request))
        }

        async fn test_cancel(
            State(state): State<TestAgentState>,
            Path(run_id): Path<String>,
        ) -> impl IntoResponse {
            let run_id = AgentRunId::from(run_id);
            let outcome: AgentCancellationOutcome = state.service.cancel(&run_id);
            super::super::cancel_response(&run_id, outcome)
        }

        fn active_run_router() -> (Router, AgentRuntimeService<FakeRegistry>) {
            let (service, _) = make_pending_test_service(vec![ProviderContractEvent::Delta {
                text: "partial".to_string(),
            }]);
            let router = Router::new()
                .route(EXPERIMENTAL_AGENT_RUN_PATH, post(test_run))
                .route(EXPERIMENTAL_AGENT_CANCEL_PATH, post(test_cancel))
                .with_state(TestAgentState {
                    service: service.clone(),
                });
            (router, service)
        }

        #[tokio::test]
        async fn route_is_not_mounted_by_default() {
            let router = test_router(ExperimentalApiConfig::default()).await;
            let response = router
                .clone()
                .oneshot(run_request(r#"{"prompt":"hello"}"#))
                .await
                .expect("response");
            // Not mounted: axum returns 404 without running any handler, so
            // the disabled route can never execute AgentRuntimeService.
            assert_eq!(response.status(), StatusCode::NOT_FOUND);

            let response = router
                .oneshot(cancel_request("missing"))
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }

        #[tokio::test]
        async fn enabled_cancel_route_returns_stable_not_found() {
            let router = test_router(ExperimentalApiConfig {
                agent_runtime_api: true,
            })
            .await;
            let response = router
                .oneshot(cancel_request("unknown-agent-run"))
                .await
                .expect("response");

            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            let body = response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let payload: serde_json::Value = serde_json::from_slice(&body).expect("json");
            assert_eq!(payload["runId"], "unknown-agent-run");
            assert_eq!(payload["status"], "not_found");
            assert_eq!(payload["cancelled"], false);
        }

        #[tokio::test]
        async fn active_run_cancel_is_idempotent_and_terminates_stream_safely() {
            let (router, service) = active_run_router();
            let response = router
                .clone()
                .oneshot(run_request(
                    r#"{"prompt":"PRIVATE_PROMPT_SENTINEL","responseId":"route-cancel-active"}"#,
                ))
                .await
                .expect("run response");
            assert_eq!(response.status(), StatusCode::OK);

            let body_task = tokio::spawn(async move {
                response
                    .into_body()
                    .collect()
                    .await
                    .expect("stream body")
                    .to_bytes()
            });
            // run_id is a UUID — wait for any run to appear in the store
            let actual_run_id_str = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    let ids = service.run_store().all_run_ids();
                    if let Some(id) = ids.into_iter().next() {
                        return id.0;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("run registered");
            let run_id = AgentRunId::from(actual_run_id_str.clone());

            for _ in 0..2 {
                let cancel_response = router
                    .clone()
                    .oneshot(cancel_request(&actual_run_id_str))
                    .await
                    .expect("cancel response");
                assert_eq!(cancel_response.status(), StatusCode::OK);
                let body = cancel_response
                    .into_body()
                    .collect()
                    .await
                    .expect("cancel body")
                    .to_bytes();
                let payload: serde_json::Value =
                    serde_json::from_slice(&body).expect("cancel json");
                assert_eq!(payload["runId"], actual_run_id_str);
                assert_eq!(payload["status"], "cancelled");
                assert_eq!(payload["cancelled"], true);

                let serialized = String::from_utf8_lossy(&body).to_ascii_lowercase();
                for forbidden in [
                    "private_prompt_sentinel",
                    "raw_thinking",
                    "thinking_text",
                    "chain_of_thought",
                    "hidden_reasoning",
                    "authorization",
                    "bearer",
                    "api_key",
                    "providerpayload",
                ] {
                    assert!(!serialized.contains(forbidden), "leaked {forbidden}");
                }
            }

            let stream_body = tokio::time::timeout(Duration::from_secs(2), body_task)
                .await
                .expect("stream terminates")
                .expect("body task");
            let stream_body = String::from_utf8(stream_body.to_vec()).expect("utf8 stream");
            let events: Vec<serde_json::Value> = stream_body
                .lines()
                .map(|line| serde_json::from_str(line).expect("NDJSON event"))
                .collect();
            assert_eq!(
                events.last().expect("terminal event")["type"],
                "run_cancelled"
            );
            assert_eq!(
                service.run_store().get(&run_id).expect("stored run").status,
                crate::agent_runtime::types::AgentRunStatus::Cancelled
            );
            assert!(!stream_body.contains("PRIVATE_PROMPT_SENTINEL"));
        }

        #[tokio::test]
        async fn enabled_route_validates_requests() {
            let router = test_router(ExperimentalApiConfig {
                agent_runtime_api: true,
            })
            .await;
            let response = router
                .oneshot(run_request(r#"{"prompt":"   "}"#))
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }

        #[tokio::test]
        async fn enabled_route_streams_safe_ndjson() {
            let router = test_router(ExperimentalApiConfig {
                agent_runtime_api: true,
            })
            .await;
            let response = router
                .oneshot(run_request(
                    r#"{"prompt":"route stream proof","responseId":"route-proof"}"#,
                ))
                .await
                .expect("response");

            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok()),
                Some(NDJSON_CONTENT_TYPE)
            );

            let body = response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let body = String::from_utf8(body.to_vec()).expect("utf8 body");

            let parsed: Vec<serde_json::Value> = body
                .lines()
                .map(|line| serde_json::from_str(line).expect("valid NDJSON line"))
                .collect();
            assert_eq!(parsed.first().unwrap()["type"], "run_started");
            // Ollama is unreachable, so the run terminates with run_failed —
            // proving the stream ends on a terminal event and maps errors safely.
            assert_eq!(parsed.last().unwrap()["type"], "run_failed");

            for forbidden in [
                "raw_thinking",
                "thinking_text",
                "chain_of_thought",
                "hidden_reasoning",
                "authorization",
                "bearer",
            ] {
                assert!(
                    !body.to_ascii_lowercase().contains(forbidden),
                    "found forbidden text in route body: {forbidden}"
                );
            }
        }

        fn tools_request() -> Request<Body> {
            Request::builder()
                .method("GET")
                .uri(EXPERIMENTAL_AGENT_TOOLS_PATH)
                .body(Body::empty())
                .expect("request")
        }

        #[tokio::test]
        async fn tools_route_is_gated_by_default() {
            let router = test_router(ExperimentalApiConfig::default()).await;
            let response = router.oneshot(tools_request()).await.expect("response");
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }

        #[tokio::test]
        async fn tools_route_returns_seeded_catalog_deterministically() {
            let router = test_router(ExperimentalApiConfig {
                agent_runtime_api: true,
            })
            .await;
            let first_response = router
                .clone()
                .oneshot(tools_request())
                .await
                .expect("first response");
            let second_response = router
                .oneshot(tools_request())
                .await
                .expect("second response");

            assert_eq!(first_response.status(), StatusCode::OK);
            assert_eq!(second_response.status(), StatusCode::OK);
            let body = first_response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let second_body = second_response
                .into_body()
                .collect()
                .await
                .expect("second body")
                .to_bytes();
            assert_eq!(body, second_body);
            let payload: serde_json::Value = serde_json::from_slice(&body).expect("json");

            assert_eq!(payload["executionEnabled"], false);
            assert_eq!(payload["registryStatus"], "available");
            assert_eq!(payload["count"], 4);

            let tools = payload["tools"].as_array().expect("tools array");
            assert_eq!(tools.len(), 4);
            assert_eq!(
                tools
                    .iter()
                    .map(|tool| tool["name"].as_str().expect("tool name"))
                    .collect::<Vec<_>>(),
                vec![
                    "loom.loom.inspect",
                    "loom.response.read",
                    "loom.runtime.status",
                    "loom.weft.inspect",
                ]
            );
            assert!(tools.iter().all(|tool| tool["enabled"] == true));
            assert!(tools
                .iter()
                .all(|tool| tool["availability"] == "not_available"));
            assert!(tools
                .iter()
                .all(|tool| tool["permissionRequirement"] == "always_allowed"));

            // Assert no forbidden strings in the raw body
            let body_str = String::from_utf8(body.to_vec()).expect("utf8");
            let serialized_lower = body_str.to_ascii_lowercase();
            for forbidden in [
                "raw_thinking",
                "thinking_text",
                "chain_of_thought",
                "hidden_reasoning",
                "authorization",
                "bearer",
                "apikey",
                "api_key",
                "secret",
            ] {
                assert!(
                    !serialized_lower.contains(forbidden),
                    "found forbidden key/value: {forbidden}"
                );
            }
        }

        #[tokio::test]
        async fn test_shared_registry_visibility_and_identity() {
            use crate::agent_runtime::events::AgentEvent;
            use crate::agent_runtime::tool_registry::{
                RegisteredTool, ToolAvailability, ToolPermissionRequirement,
            };
            use crate::agent_runtime::tools::{ToolName, ToolPermissionStatus};
            use crate::agent_runtime::types::{AgentRunMode, AgentRunStatus, AgentRuntimeRequest};
            use crate::api::state::AppState;
            use crate::config::{ConfigManager, LoomServiceConfig, OllamaConfig};
            use crate::providers::ollama::OllamaRuntime;
            use crate::runtime::{OperationTracker, RestartState};
            use crate::storage::db::test_database;
            use futures_util::StreamExt;
            use std::path::PathBuf;
            use std::time::Duration;
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            use tokio::net::TcpListener;

            let database = test_database().await;
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind test Ollama server");
            let address = listener.local_addr().expect("test server address");
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.expect("accept request");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                loop {
                    let read = socket.read(&mut buffer).await.expect("read request");
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let body = concat!(
                    "{\"message\":{\"role\":\"assistant\",\"content\":\"visible\"},\"done\":false}\n",
                    "{\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true,\"done_reason\":\"stop\",\"prompt_eval_count\":1,\"eval_count\":1}\n"
                );
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                socket
                    .write_all(response.as_bytes())
                    .await
                    .expect("write response");
            });
            let ollama = OllamaRuntime::new(OllamaConfig {
                base_url: format!("http://{address}"),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            });
            let config = ConfigManager::new(
                PathBuf::from("/tmp/loom-agent-shared-test.toml"),
                LoomServiceConfig::default(),
            );

            let mut seeded_registry = crate::agent_runtime::tool_registry::ToolRegistry::new();
            crate::agent_runtime::catalog::seed_builtin_tools(&mut seeded_registry);
            assert_eq!(seeded_registry.list().len(), 4);
            let tool_registry = std::sync::Arc::new(std::sync::RwLock::new(seeded_registry));

            let agent_run_repository =
                crate::storage::repositories::agent_runs::AgentRunRepository::from_pool(
                    database.pool(),
                );
            let state = AppState {
                database,
                ollama,
                config,
                secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
                operations: OperationTracker::default(),
                restart: RestartState::default(),
                agent_runs: crate::agent_runtime::runtime::AgentRunStore::new(),
                agent_run_repository,
                tool_registry: tool_registry.clone(),
            };

            // 1. Confirm the compatibility registry remains process-shared for
            // introspection even though AgentRuntime scheduling is SQLite-backed.
            let service1 = state.agent_runtime();
            let _service2 = state.agent_runtime();

            let test_tool = RegisteredTool {
                name: ToolName::from("dummy_placeholder_tool"),
                display_name: "Test Shared Visibility Tool".to_string(),
                description: "Proves shared registry identity".to_string(),
                category: "test".to_string(),
                availability: ToolAvailability::Available,
                permission_requirement: ToolPermissionRequirement::AlwaysAllowed,
                argument_schema: None,
                output_schema: None,
                enabled: true,
            };

            tool_registry.write().unwrap().register(test_tool.clone());

            // 2. Execute through AppState -> AgentRuntimeService -> AgentRuntime
            // -> ToolSchedulerRuntime. The compatibility registry must not
            // control this canonical scheduling path.
            let events = service1
                .execute(AgentRuntimeRequest {
                    prompt: "shared registry proof".to_string(),
                    run_mode: AgentRunMode::FullConversation,
                    loom_id: Some("shared-registry-loom".to_string()),
                    response_id: Some("shared-registry-run".to_string()),
                    parent_response_id: None,
                    provider_profile_id: None,
                    model_id: Some("test-model".to_string()),
                    context_snapshot_id: None,
                    legacy_context: None,
                    provider_options: None,
                })
                .collect::<Vec<_>>()
                .await;
            server.await.expect("test Ollama server");

            assert!(events.iter().any(|event| matches!(
                event,
                AgentEvent::ToolPermissionEvaluated {
                    tool_name,
                    status: ToolPermissionStatus::Allowed,
                    reason: Some(reason),
                    ..
                } if tool_name == crate::tool_scheduler_runtime::AGENT_RUNTIME_PLACEHOLDER_TOOL_NAME
                    && reason.contains("tool scheduler")
            )));
            assert!(events.iter().any(|event| matches!(
                event,
                AgentEvent::ToolCallSkipped {
                    tool_name,
                    reason,
                    ..
                } if tool_name == crate::tool_scheduler_runtime::AGENT_RUNTIME_PLACEHOLDER_TOOL_NAME
                    && reason == crate::tool_scheduler_runtime::ADAPTER_NOT_IMPLEMENTED_SAFE_CODE
            )));
            assert!(!events
                .iter()
                .any(|event| matches!(event, AgentEvent::ToolCallCompleted { .. })));
            assert!(matches!(
                events.last(),
                Some(AgentEvent::RunCompleted { .. })
            ));
            let actual_run_id = match events.first() {
                Some(AgentEvent::RunStarted { run_id, .. }) => run_id.clone(),
                _ => panic!("expected RunStarted as first event"),
            };
            assert_eq!(
                service1
                    .run_store()
                    .get(&crate::agent_runtime::types::AgentRunId::from(
                        actual_run_id.clone(),
                    ))
                    .expect("stored run")
                    .status,
                AgentRunStatus::Completed
            );
            let tool_repo =
                crate::storage::repositories::tool_scheduler::ToolSchedulerRepository::from_pool(
                    state.database.pool(),
                );
            let invocation = tool_repo
                .get_invocation(&format!("{actual_run_id}-tool-call-invocation"))
                .await
                .unwrap()
                .expect("scheduler-backed invocation");
            assert_eq!(
                invocation.tool_id,
                crate::tool_scheduler_runtime::AGENT_RUNTIME_PLACEHOLDER_TOOL_ID
            );
            assert_eq!(invocation.status, "failed");
            assert!(invocation.started_at.is_none());

            // 3. Confirm the compatibility listing route still extracts the
            // exact registered metadata.
            let response = super::super::list_tools(State(state.clone()))
                .await
                .into_response();
            assert_eq!(response.status(), StatusCode::OK);

            // Read response body
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();

            // Confirm the dynamic tool is listed
            let tools = payload["tools"].as_array().expect("tools array");
            assert_eq!(tools.len(), 5);
            let found_tool = tools.iter().find(|t| t["name"] == "dummy_placeholder_tool");
            assert!(
                found_tool.is_some(),
                "dynamic tool not found in list_tools response"
            );
            let found_tool_val = found_tool.unwrap();
            assert_eq!(found_tool_val["displayName"], "Test Shared Visibility Tool");

            // 4. Confirm serialized response contains no forbidden fields.
            let body_str = String::from_utf8(body.to_vec()).unwrap();
            let serialized_lower = body_str.to_ascii_lowercase();
            for forbidden in [
                "raw_thinking",
                "thinking_text",
                "chain_of_thought",
                "hidden_reasoning",
                "authorization",
                "bearer",
                "apikey",
                "api_key",
                "secret",
            ] {
                assert!(
                    !serialized_lower.contains(forbidden),
                    "found forbidden key/value: {forbidden}"
                );
            }
        }
    }

    mod history_routes {
        use super::super::{
            EXPERIMENTAL_AGENT_RUNS_PATH, EXPERIMENTAL_AGENT_RUN_EVENTS_PATH,
            EXPERIMENTAL_AGENT_RUN_GET_PATH, EXPERIMENTAL_AGENT_RUN_STEPS_PATH,
        };
        use crate::api::{router_with_experimental, ExperimentalApiConfig};
        use crate::config::{ConfigManager, LoomServiceConfig, OllamaConfig};
        use crate::providers::ollama::OllamaRuntime;
        use crate::runtime::{OperationTracker, RestartState};
        use crate::storage::db::test_database;
        use axum::{
            body::Body,
            http::{Request, StatusCode},
        };
        use http_body_util::BodyExt;
        use std::{path::PathBuf, time::Duration};
        use tower::ServiceExt;

        async fn history_router() -> axum::Router {
            let database = test_database().await;
            let ollama = OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            });
            let config = ConfigManager::new(
                PathBuf::from("/tmp/loom-history-route-test.toml"),
                LoomServiceConfig::default(),
            );
            router_with_experimental(
                database,
                ollama,
                config,
                OperationTracker::default(),
                RestartState::default(),
                ExperimentalApiConfig {
                    agent_runtime_api: true,
                },
            )
        }

        fn get_request(uri: &str) -> Request<Body> {
            Request::builder()
                .method("GET")
                .uri(uri)
                .body(Body::empty())
                .expect("request")
        }

        #[tokio::test]
        async fn history_routes_gated_by_default() {
            let database = test_database().await;
            let ollama = OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            });
            let config = ConfigManager::new(
                PathBuf::from("/tmp/loom-history-gate-test.toml"),
                LoomServiceConfig::default(),
            );
            let router = router_with_experimental(
                database,
                ollama,
                config,
                OperationTracker::default(),
                RestartState::default(),
                ExperimentalApiConfig::default(),
            );
            for uri in [
                "/experimental/agent/runs?loomId=loom-1",
                "/experimental/agent/runs/some-id",
                "/experimental/agent/runs/some-id/steps",
                "/experimental/agent/runs/some-id/events",
            ] {
                let response = router
                    .clone()
                    .oneshot(get_request(uri))
                    .await
                    .expect("response");
                assert_eq!(
                    response.status(),
                    StatusCode::NOT_FOUND,
                    "expected 404 for gated route: {uri}"
                );
            }
        }

        #[tokio::test]
        async fn list_runs_requires_loom_id() {
            let router = history_router().await;
            let response = router
                .oneshot(get_request(EXPERIMENTAL_AGENT_RUNS_PATH))
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let body = response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let payload: serde_json::Value = serde_json::from_slice(&body).expect("json");
            assert_eq!(payload["code"], "LOOM_ID_REQUIRED");
        }

        #[tokio::test]
        async fn list_runs_returns_empty_for_unknown_loom() {
            let router = history_router().await;
            let response = router
                .oneshot(get_request(&format!(
                    "{EXPERIMENTAL_AGENT_RUNS_PATH}?loomId=no-such-loom"
                )))
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::OK);
            let body = response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let payload: serde_json::Value = serde_json::from_slice(&body).expect("json");
            assert_eq!(payload["count"], 0);
            assert_eq!(payload["runs"].as_array().unwrap().len(), 0);
        }

        #[tokio::test]
        async fn get_run_returns_404_for_unknown_id() {
            let router = history_router().await;
            let uri = EXPERIMENTAL_AGENT_RUN_GET_PATH.replace(":run_id", "no-such-run");
            let response = router.oneshot(get_request(&uri)).await.expect("response");
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }

        #[tokio::test]
        async fn list_steps_returns_empty_for_unknown_run() {
            let router = history_router().await;
            let uri = EXPERIMENTAL_AGENT_RUN_STEPS_PATH.replace(":run_id", "no-such-run");
            let response = router.oneshot(get_request(&uri)).await.expect("response");
            assert_eq!(response.status(), StatusCode::OK);
            let body = response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let payload: serde_json::Value = serde_json::from_slice(&body).expect("json");
            assert_eq!(payload["count"], 0);
            assert_eq!(payload["steps"].as_array().unwrap().len(), 0);
        }

        #[tokio::test]
        async fn list_events_returns_empty_for_unknown_run() {
            let router = history_router().await;
            let uri = EXPERIMENTAL_AGENT_RUN_EVENTS_PATH.replace(":run_id", "no-such-run");
            let response = router.oneshot(get_request(&uri)).await.expect("response");
            assert_eq!(response.status(), StatusCode::OK);
            let body = response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let payload: serde_json::Value = serde_json::from_slice(&body).expect("json");
            assert_eq!(payload["count"], 0);
            assert_eq!(payload["hasMore"], false);
            assert_eq!(payload["events"].as_array().unwrap().len(), 0);
        }

        #[tokio::test]
        async fn list_events_supports_since_sequence_and_limit_params() {
            let router = history_router().await;
            let uri = format!(
                "{}?sinceSequence=5&limit=10",
                EXPERIMENTAL_AGENT_RUN_EVENTS_PATH.replace(":run_id", "no-such-run")
            );
            let response = router.oneshot(get_request(&uri)).await.expect("response");
            assert_eq!(response.status(), StatusCode::OK);
            let body = response
                .into_body()
                .collect()
                .await
                .expect("body")
                .to_bytes();
            let payload: serde_json::Value = serde_json::from_slice(&body).expect("json");
            assert_eq!(payload["count"], 0);
            assert_eq!(payload["hasMore"], false);
        }

        #[tokio::test]
        async fn history_responses_contain_no_forbidden_fields() {
            let router = history_router().await;
            let endpoints = [
                format!("{EXPERIMENTAL_AGENT_RUNS_PATH}?loomId=loom-x"),
                EXPERIMENTAL_AGENT_RUN_GET_PATH.replace(":run_id", "run-x"),
                EXPERIMENTAL_AGENT_RUN_STEPS_PATH.replace(":run_id", "run-x"),
                EXPERIMENTAL_AGENT_RUN_EVENTS_PATH.replace(":run_id", "run-x"),
            ];
            for uri in &endpoints {
                let response = router
                    .clone()
                    .oneshot(get_request(uri))
                    .await
                    .expect("response");
                let body = response
                    .into_body()
                    .collect()
                    .await
                    .expect("body")
                    .to_bytes();
                let body_str = String::from_utf8(body.to_vec()).expect("utf8");
                let lower = body_str.to_ascii_lowercase();
                for forbidden in [
                    "raw_thinking",
                    "thinking_text",
                    "chain_of_thought",
                    "hidden_reasoning",
                    "bearer",
                    "apikey",
                    "api_key",
                ] {
                    assert!(
                        !lower.contains(forbidden),
                        "found forbidden field '{forbidden}' in response for {uri}: {body_str}"
                    );
                }
            }
        }
    }

    #[test]
    fn production_api_modules_do_not_use_agent_runtime() {
        // Static guard: only this experimental module may call
        // `state.agent_runtime()` / AgentRuntimeService within src/api.
        let api_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/api");
        let allowed = ["agent_experimental.rs", "state.rs"];
        for entry in std::fs::read_dir(&api_dir).expect("read src/api") {
            let path = entry.expect("dir entry").path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if path.is_dir() || allowed.contains(&name) {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("read api source");
            for forbidden in ["agent_runtime()", "AgentRuntimeService", "execute_run"] {
                // mod.rs mounts the gated route but must not call the runtime.
                assert!(
                    !source.contains(forbidden),
                    "{name} references agent runtime: {forbidden}"
                );
            }
        }
    }
}
