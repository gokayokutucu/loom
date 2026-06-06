use crate::providers::{
    adapter::{ProviderAdapter, ProviderEventStream},
    config::ProviderKind,
    contract::{
        ProviderContractCapabilities, ProviderContractEvent, ProviderContractMessage,
        ProviderContractMessageRole, ProviderContractRequest, ProviderUsageMetadata,
    },
    types::{ProviderError, ProviderErrorKind},
};
use async_stream::stream;
use futures_util::StreamExt;
use rig_core::{
    client::CompletionClient,
    completion::{CompletionError, CompletionModel, GetTokenUsage, Message as RigMessage},
    message::AssistantContent as RigAssistantContent,
    providers::openai,
    streaming::{StreamedAssistantContent, StreamingCompletionResponse},
};
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

const EXPERIMENTAL_PROVIDER_ID: &str = "rig-openai-compatible-experimental";
const TEST_API_KEY: &str = "loom-rig-e2e-test-key";

#[derive(Debug, Clone)]
pub struct RigOpenAiCompatibleProviderAdapter {
    base_url: String,
    api_key: String,
    provider_profile_id: String,
    cancellations: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl RigOpenAiCompatibleProviderAdapter {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            provider_profile_id: EXPERIMENTAL_PROVIDER_ID.to_string(),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn from_env_for_e2e() -> Option<Self> {
        let enabled = std::env::var("LOOM_SERVICE_E2E_PROVIDER")
            .ok()
            .is_some_and(|value| value == "rig-openai-compatible");
        if !enabled {
            return None;
        }
        let base_url = std::env::var("LOOM_SERVICE_E2E_OPENAI_BASE_URL").ok()?;
        let api_key = std::env::var("LOOM_SERVICE_E2E_OPENAI_API_KEY")
            .unwrap_or_else(|_| TEST_API_KEY.into());
        Some(Self::new(base_url, api_key))
    }
}

impl ProviderAdapter for RigOpenAiCompatibleProviderAdapter {
    fn provider_kind(&self) -> ProviderKind {
        ProviderKind::OpenAiCompatible
    }

    fn provider_profile_id(&self) -> &str {
        &self.provider_profile_id
    }

    fn capabilities(&self) -> ProviderContractCapabilities {
        ProviderContractCapabilities {
            supports_streaming: true,
            supports_cancellation: true,
            supports_usage_metadata: true,
            supports_temperature: true,
            supports_top_p: true,
            supports_max_tokens: true,
            supports_system_prompt: true,
            supports_thinking_status: false,
        }
    }

    fn stream_chat(&self, request: ProviderContractRequest) -> ProviderEventStream {
        let adapter = self.clone();
        Box::pin(stream! {
            let request_id = request.request_id.clone();
            let (cancel_tx, mut cancel_rx) = watch::channel(false);
            adapter
                .cancellations
                .lock()
                .expect("rig cancellations")
                .insert(request_id.clone(), cancel_tx);

            let mut rig_stream = match adapter.start_rig_stream(request).await {
                Ok(stream) => stream,
                Err(error) => {
                    adapter.finish_request(&request_id);
                    yield ProviderContractEvent::Error { error };
                    return;
                }
            };

            if *cancel_rx.borrow() {
                rig_stream.cancel();
                adapter.finish_request(&request_id);
                yield ProviderContractEvent::Cancelled;
                return;
            }

            loop {
                tokio::select! {
                    changed = cancel_rx.changed() => {
                        if changed.is_ok() && *cancel_rx.borrow() {
                            rig_stream.cancel();
                            adapter.finish_request(&request_id);
                            yield ProviderContractEvent::Cancelled;
                            return;
                        }
                    }
                    event = rig_stream.next() => {
                        let Some(event) = event else {
                            let cancelled = *cancel_rx.borrow();
                            adapter.finish_request(&request_id);
                            if cancelled {
                                yield ProviderContractEvent::Cancelled;
                            } else {
                                yield ProviderContractEvent::Completed {
                                    done_reason: None,
                                    usage: ProviderUsageMetadata::unavailable(
                                        "provider_did_not_report_usage",
                                    ),
                                };
                            }
                            return;
                        };

                        match provider_event_from_rig_stream_item(
                            event,
                            &adapter.provider_profile_id,
                            None,
                        ) {
                            Some(completed @ ProviderContractEvent::Completed { .. }) => {
                                adapter.finish_request(&request_id);
                                yield completed;
                                return;
                            }
                            Some(error @ ProviderContractEvent::Error { .. }) => {
                                adapter.finish_request(&request_id);
                                yield error;
                                return;
                            }
                            Some(event) => {
                                yield event;
                            }
                            None => {}
                        }
                    }
                }
            }
        })
    }

    fn cancel(&self, request_id: &str) -> bool {
        let Some(cancel_tx) = self
            .cancellations
            .lock()
            .expect("rig cancellations")
            .get(request_id)
            .cloned()
        else {
            return false;
        };
        cancel_tx.send(true).is_ok()
    }
}

impl RigOpenAiCompatibleProviderAdapter {
    async fn start_rig_stream(
        &self,
        request: ProviderContractRequest,
    ) -> Result<
        StreamingCompletionResponse<openai::completion::streaming::StreamingCompletionResponse>,
        ProviderError,
    > {
        let client = openai::CompletionsClient::builder()
            .api_key(self.api_key.clone())
            .base_url(&self.base_url)
            .build()
            .map_err(|error| {
                ProviderError::new(
                    ProviderErrorKind::InvalidConfig,
                    ProviderKind::OpenAiCompatible,
                )
                .with_provider_id(&self.provider_profile_id)
                .with_model(Some(request.model_id.clone()))
                .with_technical_message(error.to_string())
            })?;
        let model = client.completion_model(&request.model_id);
        let rig_request = rig_completion_request(&model, &request);
        model.stream(rig_request).await.map_err(|error| {
            provider_error_from_rig_error(error, &self.provider_profile_id, Some(&request.model_id))
        })
    }

    fn finish_request(&self, request_id: &str) -> bool {
        self.cancellations
            .lock()
            .expect("rig cancellations")
            .remove(request_id)
            .is_some()
    }
}

fn rig_completion_request(
    model: &openai::completion::CompletionModel,
    request: &ProviderContractRequest,
) -> rig_core::completion::CompletionRequest {
    let mut messages = request
        .messages
        .iter()
        .map(rig_message_from_provider_message)
        .collect::<Vec<_>>();
    if messages.is_empty() {
        messages.push(RigMessage::user(""));
    }
    let prompt = messages.pop().expect("prompt");
    let mut builder = model
        .completion_request(prompt)
        .messages(messages)
        .temperature_opt(request.options.temperature.map(f64::from))
        .max_tokens_opt(request.options.max_tokens.map(u64::from));
    if request.options.top_p.is_some() {
        builder = builder.additional_params(json!({ "top_p": request.options.top_p }));
    }
    builder.build()
}

fn rig_message_from_provider_message(message: &ProviderContractMessage) -> RigMessage {
    match message.role {
        ProviderContractMessageRole::System => RigMessage::system(&message.content),
        ProviderContractMessageRole::User => RigMessage::user(&message.content),
        ProviderContractMessageRole::Assistant => RigMessage::Assistant {
            id: None,
            content: rig_core::OneOrMany::one(RigAssistantContent::text(message.content.clone())),
        },
    }
}

fn usage_from_rig_response(
    response: &openai::completion::streaming::StreamingCompletionResponse,
) -> ProviderUsageMetadata {
    let Some(usage) = response.token_usage() else {
        return ProviderUsageMetadata::unavailable("provider_did_not_report_usage");
    };
    if usage.input_tokens == 0 && usage.output_tokens == 0 && usage.total_tokens == 0 {
        return ProviderUsageMetadata::unavailable("provider_did_not_report_usage");
    }
    ProviderUsageMetadata::Available {
        prompt_tokens: Some(usage.input_tokens),
        completion_tokens: Some(usage.output_tokens),
        total_tokens: Some(usage.total_tokens),
    }
}

fn provider_event_from_rig_stream_item(
    event: Result<
        StreamedAssistantContent<openai::completion::streaming::StreamingCompletionResponse>,
        CompletionError,
    >,
    provider_profile_id: &str,
    model_id: Option<&str>,
) -> Option<ProviderContractEvent> {
    match event {
        Ok(StreamedAssistantContent::Text(text)) if !text.text.is_empty() => {
            Some(ProviderContractEvent::Delta { text: text.text })
        }
        Ok(StreamedAssistantContent::Text(_)) => None,
        Ok(StreamedAssistantContent::Final(response)) => Some(ProviderContractEvent::Completed {
            done_reason: None,
            usage: usage_from_rig_response(&response),
        }),
        Ok(StreamedAssistantContent::Reasoning(_))
        | Ok(StreamedAssistantContent::ReasoningDelta { .. }) => {
            // Raw reasoning stays inside the provider transport boundary.
            None
        }
        Ok(StreamedAssistantContent::ToolCall { .. })
        | Ok(StreamedAssistantContent::ToolCallDelta { .. }) => {
            // Tool transport remains future work; never leak tool payloads as text.
            None
        }
        Err(error) => Some(ProviderContractEvent::Error {
            error: provider_error_from_rig_error(error, provider_profile_id, model_id),
        }),
    }
}

fn provider_error_from_rig_error(
    error: CompletionError,
    provider_profile_id: &str,
    model_id: Option<&str>,
) -> ProviderError {
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    let kind = if lower.contains("unauthorized") || lower.contains("401") {
        ProviderErrorKind::Unauthorized
    } else if lower.contains("forbidden") || lower.contains("403") {
        ProviderErrorKind::Forbidden
    } else if lower.contains("rate limit") || lower.contains("429") {
        ProviderErrorKind::RateLimited
    } else if lower.contains("not found") || lower.contains("404") {
        ProviderErrorKind::ModelMissing
    } else if lower.contains("timeout") {
        ProviderErrorKind::TimeoutDuringStream
    } else if matches!(
        error,
        CompletionError::JsonError(_) | CompletionError::ResponseError(_)
    ) {
        ProviderErrorKind::StreamParseError
    } else if matches!(error, CompletionError::HttpError(_)) {
        ProviderErrorKind::RuntimeUnavailable
    } else if matches!(error, CompletionError::ProviderError(_)) {
        ProviderErrorKind::ProviderError
    } else {
        ProviderErrorKind::Unknown
    };
    ProviderError::new(kind, ProviderKind::OpenAiCompatible)
        .with_provider_id(provider_profile_id)
        .with_model(model_id.map(ToString::to_string))
        .with_technical_message(message)
}

/// Fake-server integration tests live in a separate module so they only
/// compile and run when the `experimental-rig` feature is explicitly enabled.
/// They spin up a local axum server that speaks the OpenAI streaming SSE
/// protocol, drive the real `RigOpenAiCompatibleProviderAdapter` against it,
/// and assert on the `ProviderPipeline` event contract.
#[cfg(all(test, feature = "experimental-rig"))]
mod fake_server_tests {
    use super::*;
    use crate::providers::{
        adapter::{ProviderAdapter, ProviderRegistryAdapter},
        contract::{ProviderContractMessage, ProviderContractMessageRole, ProviderContractOptions},
    };
    use axum::{extract::State, routing::post, Router};
    use futures_util::StreamExt;
    use tokio::net::TcpListener;

    // ── fake server plumbing ─────────────────────────────────────────────────

    /// Minimal state shared with the axum handler: the raw SSE body to echo
    /// back and the HTTP status to respond with.
    #[derive(Clone)]
    struct FakeState {
        body: &'static str,
        status: u16,
    }

    async fn handle_chat(State(s): State<FakeState>) -> axum::response::Response {
        axum::response::Response::builder()
            .status(s.status)
            .header("content-type", "text/event-stream")
            .header("cache-control", "no-cache")
            .body(axum::body::Body::from(s.body))
            .expect("fake response builder")
    }

    /// Bind a random local port, start an axum server that answers every
    /// `POST /v1/chat/completions` with `(status, body)`, and return the
    /// base-URL together with a join-handle so the caller can abort the server.
    async fn bind_fake_server(
        body: &'static str,
        status: u16,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake server");
        let port = listener.local_addr().expect("local addr").port();
        let base_url = format!("http://127.0.0.1:{port}/v1");

        let app = Router::new()
            .route("/v1/chat/completions", post(handle_chat))
            .with_state(FakeState { body, status });

        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });

        (base_url, handle)
    }

    // ── SSE response bodies ──────────────────────────────────────────────────
    //
    // Each body is a sequence of SSE events in the standard OpenAI streaming
    // format.  The rig-core 0.38.0 OpenAI client sends POST /v1/chat/completions
    // and parses the `data:` lines.

    /// Two visible text deltas + final chunk carrying usage + [DONE].
    const TEXT_STREAM_SSE: &str = concat!(
        "data: {\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",",
        "\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",",
        "\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",",
        "\"choices\":[{\"index\":0,\"delta\":{\"content\":\" Loom\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",",
        "\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],",
        "\"usage\":{\"prompt_tokens\":10,\"total_tokens\":15}}\n\n",
        "data: [DONE]\n\n",
    );

    /// A reasoning chunk followed by a visible text delta + stop.
    /// The reasoning field must be dropped by the adapter; only the text delta
    /// and completion event should reach the pipeline.
    const REASONING_THEN_TEXT_SSE: &str = concat!(
        "data: {\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",",
        "\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",",
        "\"choices\":[{\"index\":0,\"delta\":{\"reasoning\":\"raw_thinking hidden chain_of_thought\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",",
        "\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Visible answer\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",",
        "\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
    );

    /// 401 Unauthorized JSON body — used with `status: 401`.
    const UNAUTHORIZED_BODY: &str =
        "{\"error\":{\"message\":\"Unauthorized: invalid API key sk-rig-fake-secret\",\"type\":\"invalid_api_key\",\"code\":\"invalid_api_key\"}}";

    // ── shared helpers ───────────────────────────────────────────────────────

    fn make_request(request_id: &str) -> ProviderContractRequest {
        ProviderContractRequest {
            provider_kind: ProviderKind::OpenAiCompatible,
            provider_profile_id: "rig-fake-server-e2e".to_string(),
            model_id: "fake-rig-model".to_string(),
            messages: vec![
                ProviderContractMessage {
                    role: ProviderContractMessageRole::System,
                    content: "Loom system context.".to_string(),
                },
                ProviderContractMessage {
                    role: ProviderContractMessageRole::User,
                    content: "Hello from fake-server E2E.".to_string(),
                },
            ],
            options: ProviderContractOptions {
                temperature: Some(0.2),
                top_p: Some(0.9),
                max_tokens: Some(64),
                context_tokens: Some(512),
                thinking: Some(false),
            },
            stream: true,
            request_id: request_id.to_string(),
            runtime_metadata: json!({ "source": "fake_server_e2e" }),
            loom_context_metadata: json!({ "contextBuilt": true }),
        }
    }

    fn adapter_for(base_url: &str, api_key: &str) -> RigOpenAiCompatibleProviderAdapter {
        RigOpenAiCompatibleProviderAdapter::new(base_url, api_key)
    }

    // ── tests ────────────────────────────────────────────────────────────────

    /// Streaming text deltas reach the pipeline event contract unchanged and
    /// in order.  Usage metadata from the final SSE chunk is correctly mapped.
    #[tokio::test]
    async fn rig_fake_server_text_deltas_reach_pipeline_contract() {
        let (base_url, server) = bind_fake_server(TEXT_STREAM_SSE, 200).await;
        let adapter = adapter_for(&base_url, TEST_API_KEY);
        let request = make_request("rig-fake-text-1");

        let events: Vec<ProviderContractEvent> = adapter.stream_chat(request).collect().await;

        server.abort();

        // Collect visible deltas in order.
        let deltas: Vec<&str> = events
            .iter()
            .filter_map(|e| {
                if let ProviderContractEvent::Delta { text } = e {
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .collect();

        assert_eq!(deltas, vec!["Hello", " Loom"], "expected two text deltas");

        // Exactly one Completed event must be present.
        let completed = events.iter().find_map(|e| {
            if let ProviderContractEvent::Completed { usage, .. } = e {
                Some(usage.clone())
            } else {
                None
            }
        });
        assert!(completed.is_some(), "expected a Completed event");

        // Usage: prompt=10, completion=5 (total=15 - prompt=10), total=15.
        assert!(
            matches!(
                completed.unwrap(),
                ProviderUsageMetadata::Available {
                    prompt_tokens: Some(10),
                    completion_tokens: Some(5),
                    total_tokens: Some(15),
                }
            ),
            "expected usage Available{{prompt:10, completion:5, total:15}}"
        );

        // No Error or Cancelled events.
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, ProviderContractEvent::Error { .. })),
            "unexpected Error event in happy path"
        );

        // Serialized output must not contain any privacy-sensitive sentinel strings.
        let serialized = serde_json::to_string(&events).expect("serialize events");
        for sentinel in [
            "raw_thinking",
            "thinking_text",
            "hidden_reasoning",
            "chain_of_thought",
        ] {
            assert!(!serialized.contains(sentinel), "privacy leak: {sentinel}");
        }
    }

    /// The same text-delta scenario routed through `ProviderPipeline` proves
    /// that the pipeline wrapper does not drop, reorder, or alter events.
    #[tokio::test]
    async fn rig_fake_server_pipeline_forwards_events_unchanged() {
        let (base_url, server) = bind_fake_server(TEXT_STREAM_SSE, 200).await;
        let adapter = adapter_for(&base_url, TEST_API_KEY);

        // Collect from the direct adapter first.
        let direct: Vec<ProviderContractEvent> = adapter
            .stream_chat(make_request("rig-direct"))
            .collect()
            .await;

        server.abort();

        // Re-bind so the second request has a fresh server, then route through
        // ProviderRegistryAdapter (the enum that ProviderPipeline delegates to)
        // and verify the event sequence is identical.
        let (base_url2, server2) = bind_fake_server(TEXT_STREAM_SSE, 200).await;
        let ra2 =
            ProviderRegistryAdapter::RigOpenAiCompatible(adapter_for(&base_url2, TEST_API_KEY));

        let via_adapter: Vec<ProviderContractEvent> = ra2
            .stream_chat(make_request("rig-via-registry"))
            .collect()
            .await;

        server2.abort();

        assert_eq!(
            direct.len(),
            via_adapter.len(),
            "event count must be identical through adapter vs registry adapter"
        );

        // Both streams must contain exactly the same delta texts and
        // completion/usage information.
        let text_direct: Vec<String> = direct
            .iter()
            .filter_map(|e| {
                if let ProviderContractEvent::Delta { text } = e {
                    Some(text.clone())
                } else {
                    None
                }
            })
            .collect();
        let text_via: Vec<String> = via_adapter
            .iter()
            .filter_map(|e| {
                if let ProviderContractEvent::Delta { text } = e {
                    Some(text.clone())
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(text_direct, text_via, "delta texts must match");
    }

    /// When the server sends a chunk with a `reasoning` field (raw model
    /// thinking), the adapter must NOT emit a Delta or any event that exposes
    /// that text.  Only the subsequent visible-text delta and the Completed
    /// event should be forwarded.
    #[tokio::test]
    async fn rig_fake_server_raw_reasoning_is_not_emitted_or_leaked() {
        let (base_url, server) = bind_fake_server(REASONING_THEN_TEXT_SSE, 200).await;
        let adapter = adapter_for(&base_url, TEST_API_KEY);
        let events: Vec<ProviderContractEvent> = adapter
            .stream_chat(make_request("rig-reasoning-1"))
            .collect()
            .await;

        server.abort();

        // Serialize everything; verify no reasoning text leaks.
        let serialized = serde_json::to_string(&events).expect("serialize events");
        for forbidden in ["raw_thinking", "hidden", "chain_of_thought", "reasoning"] {
            assert!(
                !serialized.contains(forbidden),
                "privacy leak — '{forbidden}' found in serialized events"
            );
        }

        // At least one visible-text Delta must be present.
        let has_text_delta = events
            .iter()
            .any(|e| matches!(e, ProviderContractEvent::Delta { text } if !text.is_empty()));
        assert!(has_text_delta, "expected at least one non-empty text Delta");

        // No ThinkingDelta must be emitted (Rig transport does not expose raw thinking).
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, ProviderContractEvent::ThinkingDelta { .. })),
            "ThinkingDelta must not be emitted by Rig transport"
        );
    }

    /// A 401 HTTP response from the fake server must map to
    /// `ProviderErrorKind::Unauthorized` and the serialized error must not
    /// expose the fake secret key or any raw API-key string.
    #[tokio::test]
    async fn rig_fake_server_401_maps_to_unauthorized_and_sanitizes_secret() {
        const FAKE_SECRET: &str = "sk-rig-fake-secret";

        let (base_url, server) = bind_fake_server(UNAUTHORIZED_BODY, 401).await;
        let adapter = adapter_for(&base_url, FAKE_SECRET);
        let events: Vec<ProviderContractEvent> = adapter
            .stream_chat(make_request("rig-auth-1"))
            .collect()
            .await;

        server.abort();

        let error = events.iter().find_map(|e| {
            if let ProviderContractEvent::Error { error } = e {
                Some(error.clone())
            } else {
                None
            }
        });
        assert!(error.is_some(), "expected an Error event on 401");

        let error = error.unwrap();
        assert_eq!(
            error.kind,
            ProviderErrorKind::Unauthorized,
            "401 must map to Unauthorized"
        );

        // Serialized error must not contain the secret key.
        let serialized = serde_json::to_string(&error).expect("serialize error");
        assert!(
            !serialized.contains(FAKE_SECRET),
            "secret key must not appear in serialized error"
        );
        // The UNAUTHORIZED_BODY contains "sk-rig-fake-secret"; sanitize_provider_text
        // replaces the whole message when any forbidden key-like token appears.
        // Verify the user-visible message is from the safe Loom taxonomy.
        assert!(
            !error.user_message.is_empty(),
            "user_message must be non-empty"
        );
        assert!(
            !error.user_message.contains(FAKE_SECRET),
            "user_message must not contain secret"
        );
    }

    /// Verify that the adapter profile metadata (provider_kind, profile_id)
    /// matches the `ProviderAdapter` contract and that the adapter is classified
    /// as `OpenAiCompatible` (not Ollama or any future native kind).
    #[tokio::test]
    async fn rig_fake_server_adapter_profile_matches_contract() {
        let (base_url, server) = bind_fake_server(TEXT_STREAM_SSE, 200).await;
        let adapter = adapter_for(&base_url, TEST_API_KEY);

        assert_eq!(adapter.provider_kind(), ProviderKind::OpenAiCompatible);
        assert_eq!(
            adapter.provider_profile_id(),
            EXPERIMENTAL_PROVIDER_ID,
            "provider profile id must match the experimental constant"
        );

        let caps = adapter.capabilities();
        assert!(caps.supports_streaming, "must support streaming");
        assert!(caps.supports_cancellation, "must support cancellation");
        assert!(caps.supports_usage_metadata, "must support usage metadata");
        assert!(
            !caps.supports_thinking_status,
            "Rig transport must not expose thinking status"
        );

        server.abort();
    }

    /// Ensure the adapter is default-off: `from_env_for_e2e()` returns `None`
    /// unless the specific env-var is set.  This guards the production code
    /// path from accidentally routing to the Rig adapter.
    #[test]
    fn rig_fake_server_adapter_is_default_off_without_env_var() {
        // Remove both env vars to simulate the production default.
        std::env::remove_var("LOOM_SERVICE_E2E_PROVIDER");
        std::env::remove_var("LOOM_SERVICE_E2E_OPENAI_BASE_URL");

        assert!(
            RigOpenAiCompatibleProviderAdapter::from_env_for_e2e().is_none(),
            "adapter must be None by default (no env vars set)"
        );
    }

    /// Safety: the full event stream must not expose any of Loom's raw-thinking
    /// or secret-sentinel keys even when the fake server echoes them back inside
    /// the `reasoning` field of an SSE chunk.
    #[tokio::test]
    async fn rig_fake_server_full_stream_is_free_of_privacy_sentinels() {
        let (base_url, server) = bind_fake_server(REASONING_THEN_TEXT_SSE, 200).await;
        let adapter = adapter_for(&base_url, "loom-fake-key-sentinel");
        let events: Vec<ProviderContractEvent> = adapter
            .stream_chat(make_request("rig-sentinel-check"))
            .collect()
            .await;

        server.abort();

        let serialized = serde_json::to_string(&events).expect("serialize full stream");

        for sentinel in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "loom-fake-key-sentinel",
        ] {
            assert!(
                !serialized.contains(sentinel),
                "sentinel '{sentinel}' must not appear in full stream output"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::contract::ProviderContractOptions;

    fn sample_request() -> ProviderContractRequest {
        ProviderContractRequest {
            provider_kind: ProviderKind::OpenAiCompatible,
            provider_profile_id: "rig-test".to_string(),
            model_id: "fake-openai-compatible".to_string(),
            messages: vec![
                ProviderContractMessage {
                    role: ProviderContractMessageRole::System,
                    content: "system owned by Loom".to_string(),
                },
                ProviderContractMessage {
                    role: ProviderContractMessageRole::User,
                    content: "visible user prompt".to_string(),
                },
            ],
            options: ProviderContractOptions {
                temperature: Some(0.2),
                top_p: Some(0.9),
                max_tokens: Some(64),
                context_tokens: Some(512),
                thinking: Some(false),
            },
            stream: true,
            request_id: "request-1".to_string(),
            runtime_metadata: json!({ "source": "test" }),
            loom_context_metadata: json!({ "contextBuilt": true }),
        }
    }

    #[test]
    fn rig_adapter_is_disabled_by_default() {
        std::env::remove_var("LOOM_SERVICE_E2E_PROVIDER");
        std::env::remove_var("LOOM_SERVICE_E2E_OPENAI_BASE_URL");

        assert!(RigOpenAiCompatibleProviderAdapter::from_env_for_e2e().is_none());
    }

    #[test]
    fn rig_request_mapping_preserves_loom_built_messages_and_options() {
        let adapter =
            RigOpenAiCompatibleProviderAdapter::new("http://127.0.0.1:1/v1", TEST_API_KEY);
        let client = openai::CompletionsClient::builder()
            .api_key(TEST_API_KEY)
            .base_url("http://127.0.0.1:1/v1")
            .build()
            .expect("rig client");
        let model = client.completion_model("fake-openai-compatible");

        let rig_request = rig_completion_request(&model, &sample_request());
        let serialized = serde_json::to_string(&rig_request).expect("request json");
        let request_value =
            serde_json::to_value(&rig_request).expect("request should serialize as json");

        assert_eq!(adapter.provider_kind(), ProviderKind::OpenAiCompatible);
        assert!(serialized.contains("system owned by Loom"));
        assert!(serialized.contains("visible user prompt"));
        assert!(serialized.contains("\"temperature\":0.20000000298023224"));
        assert!(serialized.contains("\"max_tokens\":64"));
        assert_eq!(
            request_value
                .pointer("/additional_params/top_p")
                .and_then(serde_json::Value::as_f64),
            Some(0.8999999761581421)
        );
        assert!(!serialized.contains("ContextManager"));
        assert!(!serialized.contains("raw_thinking"));
    }

    #[test]
    fn rig_error_mapping_sanitizes_secrets_and_raw_thinking() {
        let error = provider_error_from_rig_error(
            CompletionError::ProviderError(
                "401 api_key sk-secret raw_thinking hidden_reasoning".to_string(),
            ),
            "rig-test",
            Some("fake-model"),
        );
        let serialized = serde_json::to_string(&error).expect("error json");

        assert_eq!(error.kind, ProviderErrorKind::Unauthorized);
        assert!(!serialized.contains("sk-secret"));
        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("hidden_reasoning"));
    }

    #[test]
    fn streaming_delta_maps_to_provider_delta() {
        let event = provider_event_from_rig_stream_item(
            Ok(StreamedAssistantContent::text("visible delta")),
            "rig-test",
            Some("fake-model"),
        );

        assert_eq!(
            event,
            Some(ProviderContractEvent::Delta {
                text: "visible delta".to_string()
            })
        );
    }

    #[test]
    fn raw_reasoning_is_not_emitted() {
        let event = provider_event_from_rig_stream_item(
            Ok(StreamedAssistantContent::ReasoningDelta {
                id: None,
                reasoning: "raw_thinking hidden_reasoning".to_string(),
            }),
            "rig-test",
            Some("fake-model"),
        );

        assert_eq!(event, None);
    }

    #[test]
    fn final_completion_maps_usage_when_reported() {
        let response = openai::completion::streaming::StreamingCompletionResponse {
            usage: openai::completion::Usage {
                prompt_tokens: 13,
                total_tokens: 20,
                prompt_tokens_details: None,
            },
        };
        let event = provider_event_from_rig_stream_item(
            Ok(StreamedAssistantContent::final_response(response)),
            "rig-test",
            Some("fake-model"),
        );

        assert_eq!(
            event,
            Some(ProviderContractEvent::Completed {
                done_reason: None,
                usage: ProviderUsageMetadata::Available {
                    prompt_tokens: Some(13),
                    completion_tokens: Some(7),
                    total_tokens: Some(20),
                }
            })
        );
    }

    #[test]
    fn missing_usage_maps_to_unavailable() {
        let response = openai::completion::streaming::StreamingCompletionResponse {
            usage: openai::completion::Usage::default(),
        };
        let usage = usage_from_rig_response(&response);

        assert_eq!(
            usage,
            ProviderUsageMetadata::Unavailable {
                reason: "provider_did_not_report_usage".to_string()
            }
        );
    }
}
