//! Gated experimental Agent Runtime route (AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001).
//!
//! Service-level stream proof only: not a production generation path, not used
//! by the frontend, and only mounted when `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API`
//! is enabled. Streams safe `AgentEvent` values as NDJSON.

use std::convert::Infallible;

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::{Stream, StreamExt};
use serde::{Deserialize, Serialize};

use crate::agent_runtime::events::AgentEvent;
use crate::agent_runtime::runtime::AgentCancellationOutcome;
use crate::agent_runtime::types::{
    AgentRunId, AgentRunStatus, AgentRuntimeProviderOptions, AgentRuntimeRequest,
};
use crate::api::state::AppState;

pub const EXPERIMENTAL_AGENT_RUN_PATH: &str = "/experimental/agent/run";
pub const EXPERIMENTAL_AGENT_CANCEL_PATH: &str = "/experimental/agent/runs/:run_id/cancel";
pub const EXPERIMENTAL_AGENT_RUNTIME_ENV: &str = "LOOM_EXPERIMENTAL_AGENT_RUNTIME_API";

const NDJSON_CONTENT_TYPE: &str = "application/x-ndjson";
const MAX_PROMPT_CHARS: usize = 32_768;
const MIN_TEMPERATURE: f64 = 0.0;
const MAX_TEMPERATURE: f64 = 2.0;
const MAX_OUTPUT_TOKENS_CAP: u64 = 8_192;

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
        loom_id: request.loom_id,
        response_id: request.response_id,
        parent_response_id: request.parent_response_id,
        provider_profile_id: request.provider_profile_id,
        model_id: request.model,
        context_snapshot_id: request.context_snapshot_id,
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
        AgentRunStatus::Pending => "pending",
        AgentRunStatus::Running => "running",
        AgentRunStatus::Completed => "completed",
        AgentRunStatus::Failed => "failed",
        AgentRunStatus::Cancelled => "cancelled",
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
        let run = service
            .run_store()
            .get(&AgentRunId::from("resp-1"))
            .expect("run recorded");
        let run_serialized = serde_json::to_string(&run).expect("serialize run");
        assert!(!run_serialized.contains("route privacy prompt"));
    }

    mod router_gate {
        use super::super::{
            EXPERIMENTAL_AGENT_CANCEL_PATH, EXPERIMENTAL_AGENT_RUN_PATH, NDJSON_CONTENT_TYPE,
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
            let run_id = AgentRunId::from("route-cancel-active");
            tokio::time::timeout(Duration::from_secs(2), async {
                while service.run_store().get(&run_id).is_none() {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("run registered");

            for _ in 0..2 {
                let cancel_response = router
                    .clone()
                    .oneshot(cancel_request("route-cancel-active"))
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
                assert_eq!(payload["runId"], "route-cancel-active");
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
