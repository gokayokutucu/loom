#![allow(dead_code)]

use crate::providers::{
    config::ProviderKind,
    types::{sanitize_provider_metadata, sanitize_provider_text, ProviderError, ProviderErrorKind},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderContractMessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderContractMessage {
    pub role: ProviderContractMessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderContractOptions {
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_tokens: Option<u32>,
    pub context_tokens: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderUsageMetadata {
    Available {
        prompt_tokens: Option<u64>,
        completion_tokens: Option<u64>,
        total_tokens: Option<u64>,
    },
    Unavailable {
        reason: String,
    },
}

impl ProviderUsageMetadata {
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self::Unavailable {
            reason: reason.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderContractCapabilities {
    pub supports_streaming: bool,
    pub supports_cancellation: bool,
    pub supports_usage_metadata: bool,
    pub supports_temperature: bool,
    pub supports_top_p: bool,
    pub supports_max_tokens: bool,
    pub supports_system_prompt: bool,
    pub supports_thinking_status: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderContractRequest {
    pub provider_kind: ProviderKind,
    pub provider_profile_id: String,
    pub model_id: String,
    pub messages: Vec<ProviderContractMessage>,
    pub options: ProviderContractOptions,
    pub stream: bool,
    pub request_id: String,
    pub runtime_metadata: Value,
    pub loom_context_metadata: Value,
}

impl ProviderContractRequest {
    pub fn sanitized_diagnostics(&self) -> Value {
        sanitize_provider_metadata(&json!({
            "providerKind": self.provider_kind,
            "providerProfileId": self.provider_profile_id,
            "modelId": self.model_id,
            "stream": self.stream,
            "runtimeMetadata": self.runtime_metadata,
            "loomContextMetadata": self.loom_context_metadata,
        }))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ProviderContractEvent {
    Delta {
        text: String,
    },
    ThinkingStatus {
        status: String,
        duration_ms: Option<u64>,
        token_estimate: Option<u64>,
    },
    Completed {
        done_reason: Option<String>,
        usage: ProviderUsageMetadata,
    },
    Error {
        error: ProviderError,
    },
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderContractStreamResult {
    pub events: Vec<ProviderContractEvent>,
    pub closed: bool,
}

pub fn provider_contract_error(
    provider_kind: ProviderKind,
    provider_profile_id: &str,
    model_id: &str,
    kind: ProviderErrorKind,
    message: impl Into<String>,
    metadata: Value,
) -> ProviderError {
    ProviderError::new(kind, provider_kind)
        .with_provider_id(provider_profile_id)
        .with_model(Some(model_id.to_string()))
        .with_technical_message(message)
        .with_safe_metadata(metadata)
}

pub fn safe_provider_runtime_profile(
    provider_kind: ProviderKind,
    provider_profile_id: &str,
    model_id: &str,
    runtime_metadata: Value,
) -> Value {
    sanitize_provider_metadata(&json!({
        "providerKind": provider_kind.as_config_str(),
        "providerProfileId": provider_profile_id,
        "modelId": model_id,
        "runtimeMetadata": runtime_metadata,
    }))
}

pub fn safe_provider_text(value: &str) -> String {
    sanitize_provider_text(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum FakeProviderScenario {
        NormalStreaming,
        DelayedStreaming,
        MalformedStream,
        ProviderError(ProviderErrorKind),
        Timeout,
        UsageMetadata,
        MissingUsageMetadata,
        CancellationAfterFirstDelta,
    }

    #[derive(Debug, Clone)]
    struct FakeProviderAdapter {
        provider_kind: ProviderKind,
        provider_profile_id: String,
        scenario: FakeProviderScenario,
        capabilities: ProviderContractCapabilities,
        last_request: Option<ProviderContractRequest>,
        orphan_generation_active: bool,
    }

    impl FakeProviderAdapter {
        fn new(scenario: FakeProviderScenario) -> Self {
            Self {
                provider_kind: ProviderKind::OpenAiCompatible,
                provider_profile_id: "fake-contract-provider".to_string(),
                scenario,
                capabilities: ProviderContractCapabilities {
                    supports_streaming: true,
                    supports_cancellation: true,
                    supports_usage_metadata: true,
                    supports_temperature: true,
                    supports_top_p: true,
                    supports_max_tokens: true,
                    supports_system_prompt: true,
                    supports_thinking_status: true,
                },
                last_request: None,
                orphan_generation_active: false,
            }
        }

        fn execute(
            &mut self,
            request: ProviderContractRequest,
            cancel_after_first_delta: bool,
        ) -> ProviderContractStreamResult {
            assert_eq!(request.provider_kind, self.provider_kind);
            assert_eq!(request.provider_profile_id, self.provider_profile_id);
            self.last_request = Some(request.clone());
            self.orphan_generation_active = true;

            let result = match self.scenario.clone() {
                FakeProviderScenario::NormalStreaming => self.normal_result(None),
                FakeProviderScenario::DelayedStreaming => ProviderContractStreamResult {
                    events: vec![
                        ProviderContractEvent::ThinkingStatus {
                            status: "active".to_string(),
                            duration_ms: Some(25),
                            token_estimate: Some(4),
                        },
                        ProviderContractEvent::Delta {
                            text: "delayed ".to_string(),
                        },
                        ProviderContractEvent::Delta {
                            text: "answer".to_string(),
                        },
                        ProviderContractEvent::Completed {
                            done_reason: Some("stop".to_string()),
                            usage: ProviderUsageMetadata::unavailable(
                                "provider_did_not_report_usage",
                            ),
                        },
                    ],
                    closed: true,
                },
                FakeProviderScenario::MalformedStream => self.error_result(
                    ProviderErrorKind::StreamParseError,
                    "provider stream was malformed",
                ),
                FakeProviderScenario::ProviderError(kind) => {
                    self.error_result(kind, format!("provider returned {kind:?}"))
                }
                FakeProviderScenario::Timeout => self.error_result(
                    ProviderErrorKind::TimeoutDuringStream,
                    "provider stream timed out",
                ),
                FakeProviderScenario::UsageMetadata => {
                    self.normal_result(Some(ProviderUsageMetadata::Available {
                        prompt_tokens: Some(12),
                        completion_tokens: Some(8),
                        total_tokens: Some(20),
                    }))
                }
                FakeProviderScenario::MissingUsageMetadata => self.normal_result(Some(
                    ProviderUsageMetadata::unavailable("provider_did_not_report_usage"),
                )),
                FakeProviderScenario::CancellationAfterFirstDelta if cancel_after_first_delta => {
                    ProviderContractStreamResult {
                        events: vec![
                            ProviderContractEvent::Delta {
                                text: "partial".to_string(),
                            },
                            ProviderContractEvent::Cancelled,
                        ],
                        closed: true,
                    }
                }
                FakeProviderScenario::CancellationAfterFirstDelta => self.normal_result(None),
            };

            self.orphan_generation_active = false;
            result
        }

        fn normal_result(
            &self,
            usage: Option<ProviderUsageMetadata>,
        ) -> ProviderContractStreamResult {
            ProviderContractStreamResult {
                events: vec![
                    ProviderContractEvent::Delta {
                        text: "hello ".to_string(),
                    },
                    ProviderContractEvent::Delta {
                        text: "loom".to_string(),
                    },
                    ProviderContractEvent::Completed {
                        done_reason: Some("stop".to_string()),
                        usage: usage.unwrap_or_else(|| {
                            ProviderUsageMetadata::unavailable("provider_did_not_report_usage")
                        }),
                    },
                ],
                closed: true,
            }
        }

        fn error_result(
            &self,
            kind: ProviderErrorKind,
            message: impl Into<String>,
        ) -> ProviderContractStreamResult {
            ProviderContractStreamResult {
                events: vec![ProviderContractEvent::Error {
                    error: provider_contract_error(
                        self.provider_kind.clone(),
                        &self.provider_profile_id,
                        "fake-main-model",
                        kind,
                        message,
                        json!({
                            "apiKey": "sk-secret-test",
                            "safeStage": "generate",
                            "nested": { "hidden_reasoning": "private" }
                        }),
                    ),
                }],
                closed: true,
            }
        }
    }

    fn contract_request() -> ProviderContractRequest {
        ProviderContractRequest {
            provider_kind: ProviderKind::OpenAiCompatible,
            provider_profile_id: "fake-contract-provider".to_string(),
            model_id: "fake-main-model".to_string(),
            messages: vec![
                ProviderContractMessage {
                    role: ProviderContractMessageRole::System,
                    content: "Loom-built context. Reference REF-42. Attachment ATTACHMENT_SENTINEL. Weft origin ORIGIN-7.".to_string(),
                },
                ProviderContractMessage {
                    role: ProviderContractMessageRole::User,
                    content: "Use the attached Reference and origin context.".to_string(),
                },
                ProviderContractMessage {
                    role: ProviderContractMessageRole::Assistant,
                    content: "Prior visible assistant turn.".to_string(),
                },
            ],
            options: ProviderContractOptions {
                temperature: Some(0.2),
                top_p: Some(0.9),
                max_tokens: Some(512),
                context_tokens: Some(4096),
            },
            stream: true,
            request_id: "run-contract-1".to_string(),
            runtime_metadata: json!({
                "runtimeProfile": "local-first-test",
                "providerAdapter": "fake"
            }),
            loom_context_metadata: json!({
                "contextManager": "loom-service",
                "references": [{"referenceId": "REF-42", "targetKind": "response"}],
                "attachments": [{"attachmentId": "ATTACHMENT_SENTINEL"}],
                "weftOrigin": {"loomId": "loom-origin", "responseId": "ORIGIN-7"}
            }),
        }
    }

    fn assert_completed_once(events: &[ProviderContractEvent]) {
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, ProviderContractEvent::Completed { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn request_mapping_preserves_provider_contract_fields() {
        let mut adapter = FakeProviderAdapter::new(FakeProviderScenario::NormalStreaming);
        let request = contract_request();
        let result = adapter.execute(request.clone(), false);
        let captured = adapter.last_request.expect("captured provider request");

        assert!(result.closed);
        assert_eq!(captured.model_id, "fake-main-model");
        assert!(captured.stream);
        assert_eq!(captured.options.temperature, Some(0.2));
        assert_eq!(captured.options.top_p, Some(0.9));
        assert_eq!(captured.options.max_tokens, Some(512));
        assert_eq!(captured.options.context_tokens, Some(4096));
        assert_eq!(captured.messages, request.messages);
        assert_eq!(
            captured.runtime_metadata["runtimeProfile"],
            "local-first-test"
        );
        assert_eq!(captured.provider_kind, ProviderKind::OpenAiCompatible);
        assert_completed_once(&result.events);
    }

    #[test]
    fn context_preservation_keeps_loom_built_context_references_attachments_and_weft_origin() {
        let mut adapter = FakeProviderAdapter::new(FakeProviderScenario::NormalStreaming);
        let request = contract_request();
        let expected_messages = request.messages.clone();
        let expected_context_metadata = request.loom_context_metadata.clone();

        adapter.execute(request, false);
        let captured = adapter.last_request.expect("captured provider request");
        let context_text = captured
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        assert_eq!(captured.messages, expected_messages);
        assert_eq!(captured.loom_context_metadata, expected_context_metadata);
        assert!(context_text.contains("REF-42"));
        assert!(context_text.contains("ATTACHMENT_SENTINEL"));
        assert!(context_text.contains("ORIGIN-7"));
        assert_eq!(
            captured.loom_context_metadata["contextManager"],
            "loom-service"
        );
    }

    #[test]
    fn streaming_contract_covers_thinking_delta_completion_and_close() {
        let mut adapter = FakeProviderAdapter::new(FakeProviderScenario::DelayedStreaming);
        let result = adapter.execute(contract_request(), false);

        assert!(matches!(
            result.events.first(),
            Some(ProviderContractEvent::ThinkingStatus { status, .. }) if status == "active"
        ));
        assert!(result.events.iter().any(
            |event| matches!(event, ProviderContractEvent::Delta { text } if text == "delayed ")
        ));
        assert_completed_once(&result.events);
        assert!(result.closed);
    }

    #[test]
    fn malformed_stream_maps_to_parse_error_without_completion() {
        let mut adapter = FakeProviderAdapter::new(FakeProviderScenario::MalformedStream);
        let result = adapter.execute(contract_request(), false);

        assert!(result.closed);
        assert!(result
            .events
            .iter()
            .any(|event| matches!(event, ProviderContractEvent::Error { error } if error.kind == ProviderErrorKind::StreamParseError)));
        assert!(!result
            .events
            .iter()
            .any(|event| matches!(event, ProviderContractEvent::Completed { .. })));
    }

    #[test]
    fn cancellation_closes_stream_and_leaves_partial_state_safe() {
        let mut adapter =
            FakeProviderAdapter::new(FakeProviderScenario::CancellationAfterFirstDelta);
        let result = adapter.execute(contract_request(), true);

        assert_eq!(
            result.events,
            vec![
                ProviderContractEvent::Delta {
                    text: "partial".to_string()
                },
                ProviderContractEvent::Cancelled
            ]
        );
        assert!(result.closed);
        assert!(!adapter.orphan_generation_active);
    }

    #[test]
    fn retry_uses_same_provider_contract_and_preserves_original_references() {
        let original = contract_request();
        let mut retry = original.clone();
        retry.request_id = "run-contract-retry".to_string();
        retry.runtime_metadata = json!({
            "runtimeProfile": "local-first-test",
            "providerAdapter": "fake",
            "retryOfUserResponseId": "response-user-1"
        });

        let mut adapter = FakeProviderAdapter::new(FakeProviderScenario::NormalStreaming);
        let result = adapter.execute(retry, false);
        let captured = adapter.last_request.expect("captured retry request");

        assert_completed_once(&result.events);
        assert_eq!(captured.messages, original.messages);
        assert_eq!(
            captured.loom_context_metadata,
            original.loom_context_metadata
        );
        assert_eq!(
            captured.runtime_metadata["retryOfUserResponseId"],
            "response-user-1"
        );
    }

    #[test]
    fn usage_metadata_is_mapped_or_marked_unavailable_explicitly() {
        let mut with_usage = FakeProviderAdapter::new(FakeProviderScenario::UsageMetadata);
        let usage_result = with_usage.execute(contract_request(), false);
        assert!(usage_result.events.iter().any(|event| matches!(
            event,
            ProviderContractEvent::Completed {
                usage: ProviderUsageMetadata::Available {
                    prompt_tokens: Some(12),
                    completion_tokens: Some(8),
                    total_tokens: Some(20)
                },
                ..
            }
        )));

        let mut without_usage =
            FakeProviderAdapter::new(FakeProviderScenario::MissingUsageMetadata);
        let missing_result = without_usage.execute(contract_request(), false);
        assert!(missing_result.events.iter().any(|event| matches!(
            event,
            ProviderContractEvent::Completed {
                usage: ProviderUsageMetadata::Unavailable { reason },
                ..
            } if reason == "provider_did_not_report_usage"
        )));
    }

    #[test]
    fn error_mapping_covers_auth_rate_limit_timeout_unavailable_model_and_unsupported_capability() {
        for (scenario, expected) in [
            (
                FakeProviderScenario::ProviderError(ProviderErrorKind::Unauthorized),
                ProviderErrorKind::Unauthorized,
            ),
            (
                FakeProviderScenario::ProviderError(ProviderErrorKind::RateLimited),
                ProviderErrorKind::RateLimited,
            ),
            (
                FakeProviderScenario::Timeout,
                ProviderErrorKind::TimeoutDuringStream,
            ),
            (
                FakeProviderScenario::ProviderError(ProviderErrorKind::ServiceUnavailable),
                ProviderErrorKind::ServiceUnavailable,
            ),
            (
                FakeProviderScenario::ProviderError(ProviderErrorKind::ModelMissing),
                ProviderErrorKind::ModelMissing,
            ),
            (
                FakeProviderScenario::ProviderError(ProviderErrorKind::UnsupportedFeature),
                ProviderErrorKind::UnsupportedFeature,
            ),
        ] {
            let mut adapter = FakeProviderAdapter::new(scenario);
            let result = adapter.execute(contract_request(), false);

            assert!(result.events.iter().any(|event| matches!(
                event,
                ProviderContractEvent::Error { error } if error.kind == expected
            )));
        }
    }

    #[test]
    fn diagnostics_and_errors_redact_api_keys_prompts_and_raw_thinking() {
        let mut adapter = FakeProviderAdapter::new(FakeProviderScenario::ProviderError(
            ProviderErrorKind::Unauthorized,
        ));
        let mut request = contract_request();
        request.runtime_metadata = json!({
            "api_key": "sk-contract-secret",
            "safeRuntime": "openai-compatible",
            "prompt": "private prompt",
            "nested": { "raw_thinking": "private chain" }
        });

        let diagnostics = request.sanitized_diagnostics();
        let result = adapter.execute(request, false);
        let result_json = serde_json::to_string(&result).expect("result json");
        let diagnostics_json = serde_json::to_string(&diagnostics).expect("diagnostics json");

        assert!(diagnostics_json.contains("safeRuntime"));
        for forbidden in [
            "sk-contract-secret",
            "sk-secret-test",
            "api_key",
            "apiKey",
            "private prompt",
            "raw_thinking",
            "hidden_reasoning",
            "private chain",
        ] {
            assert!(!diagnostics_json.contains(forbidden), "{forbidden}");
            assert!(!result_json.contains(forbidden), "{forbidden}");
        }
    }

    #[test]
    fn provider_runtime_profile_reports_safe_provider_and_model_identity() {
        let profile = safe_provider_runtime_profile(
            ProviderKind::OpenAiCompatible,
            "remote-profile",
            "model-a",
            json!({
                "endpoint": "https://provider.example.test/v1",
                "bearer_token": "secret-token"
            }),
        );
        let serialized = serde_json::to_string(&profile).expect("profile json");

        assert_eq!(profile["providerKind"], "openai_compatible");
        assert_eq!(profile["providerProfileId"], "remote-profile");
        assert_eq!(profile["modelId"], "model-a");
        assert!(serialized.contains("provider.example.test"));
        assert!(!serialized.contains("secret-token"));
        assert!(!serialized.contains("bearer_token"));
    }
}
