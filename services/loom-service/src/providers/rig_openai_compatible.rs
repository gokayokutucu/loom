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
