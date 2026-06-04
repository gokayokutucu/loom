use crate::providers::{
    adapter::{ProviderAdapter, ProviderEventStream, ProviderRegistry},
    config::ProviderKind,
    contract::{ProviderContractCapabilities, ProviderContractEvent, ProviderContractRequest},
    ollama::OllamaRuntime,
};
use async_stream::stream;
use futures_util::StreamExt;

pub trait ProviderPipelineRegistry: Clone + Send + Sync + 'static {
    type Adapter: ProviderAdapter;

    fn default_generation_adapter(&self) -> &Self::Adapter;
    fn cancel_generation(&self, request_id: &str) -> bool;
}

impl ProviderPipelineRegistry for ProviderRegistry {
    type Adapter = crate::providers::adapter::ProviderRegistryAdapter;

    fn default_generation_adapter(&self) -> &Self::Adapter {
        ProviderRegistry::default_generation_adapter(self)
    }

    fn cancel_generation(&self, request_id: &str) -> bool {
        ProviderRegistry::cancel_generation(self, request_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderPipelineProfile {
    pub provider_kind: ProviderKind,
    pub provider_profile_id: String,
    pub default_model: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderPipeline<R = ProviderRegistry> {
    registry: R,
}

impl ProviderPipeline<ProviderRegistry> {
    pub fn new(ollama: OllamaRuntime) -> Self {
        Self::from_registry(ProviderRegistry::new(ollama))
    }

    pub fn new_for_main_generation(
        ollama: OllamaRuntime,
        config: &crate::config::LoomServiceConfig,
        secret_store: &crate::providers::secret_store::ProviderSecretStore,
    ) -> Self {
        Self::from_registry(ProviderRegistry::new_for_main_generation(
            ollama,
            config,
            secret_store,
        ))
    }
}

impl<R> ProviderPipeline<R>
where
    R: ProviderPipelineRegistry,
{
    pub fn from_registry(registry: R) -> Self {
        Self { registry }
    }

    pub fn default_generation_profile(&self) -> ProviderPipelineProfile {
        let adapter = self.registry.default_generation_adapter();
        ProviderPipelineProfile {
            provider_kind: adapter.provider_kind(),
            provider_profile_id: adapter.provider_profile_id().to_string(),
            default_model: adapter.default_model().map(ToString::to_string),
        }
    }

    pub fn default_generation_capabilities(&self) -> ProviderContractCapabilities {
        self.registry.default_generation_adapter().capabilities()
    }

    pub fn stream_chat(&self, request: ProviderContractRequest) -> ProviderEventStream {
        let adapter = self.registry.default_generation_adapter().clone();
        Box::pin(stream! {
            let mut events = adapter.stream_chat(request);
            while let Some(event) = events.next().await {
                yield normalize_provider_event(event);
            }
        })
    }

    pub fn cancel_generation(&self, request_id: &str) -> bool {
        self.registry.cancel_generation(request_id)
    }
}

fn normalize_provider_event(event: ProviderContractEvent) -> ProviderContractEvent {
    event
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{
        config::ProviderKind,
        contract::{
            ProviderContractMessage, ProviderContractMessageRole, ProviderContractOptions,
            ProviderUsageMetadata,
        },
    };
    use futures_util::StreamExt;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone, Default)]
    struct FakeAdapterState {
        request: Option<ProviderContractRequest>,
        cancel_request_id: Option<String>,
    }

    #[derive(Debug, Clone)]
    struct FakeProviderAdapter {
        state: Arc<Mutex<FakeAdapterState>>,
        events: Vec<ProviderContractEvent>,
    }

    impl ProviderAdapter for FakeProviderAdapter {
        fn provider_kind(&self) -> ProviderKind {
            ProviderKind::Ollama
        }

        fn provider_profile_id(&self) -> &str {
            "fake-ollama"
        }

        fn capabilities(&self) -> ProviderContractCapabilities {
            ProviderContractCapabilities {
                supports_streaming: true,
                supports_cancellation: true,
                supports_usage_metadata: true,
                supports_temperature: true,
                supports_top_p: false,
                supports_max_tokens: true,
                supports_system_prompt: true,
                supports_thinking_status: true,
            }
        }

        fn stream_chat(&self, request: ProviderContractRequest) -> ProviderEventStream {
            self.state.lock().expect("state").request = Some(request);
            let events = self.events.clone();
            Box::pin(stream! {
                for event in events {
                    yield event;
                }
            })
        }

        fn cancel(&self, request_id: &str) -> bool {
            self.state.lock().expect("state").cancel_request_id = Some(request_id.to_string());
            true
        }
    }

    #[derive(Debug, Clone)]
    struct FakeRegistry {
        adapter: FakeProviderAdapter,
    }

    impl ProviderPipelineRegistry for FakeRegistry {
        type Adapter = FakeProviderAdapter;

        fn default_generation_adapter(&self) -> &Self::Adapter {
            &self.adapter
        }

        fn cancel_generation(&self, request_id: &str) -> bool {
            self.adapter.cancel(request_id)
        }
    }

    fn provider_request() -> ProviderContractRequest {
        ProviderContractRequest {
            provider_kind: ProviderKind::Ollama,
            provider_profile_id: "fake-ollama".to_string(),
            model_id: "test-model".to_string(),
            messages: vec![ProviderContractMessage {
                role: ProviderContractMessageRole::User,
                content: "hello".to_string(),
            }],
            options: ProviderContractOptions {
                temperature: Some(0.2),
                top_p: None,
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

    fn fake_pipeline(
        events: Vec<ProviderContractEvent>,
    ) -> (ProviderPipeline<FakeRegistry>, Arc<Mutex<FakeAdapterState>>) {
        let state = Arc::new(Mutex::new(FakeAdapterState::default()));
        let adapter = FakeProviderAdapter {
            state: state.clone(),
            events,
        };
        (
            ProviderPipeline::from_registry(FakeRegistry { adapter }),
            state,
        )
    }

    #[test]
    fn pipeline_resolves_default_adapter_profile() {
        let (pipeline, _) = fake_pipeline(Vec::new());

        let profile = pipeline.default_generation_profile();

        assert_eq!(profile.provider_kind, ProviderKind::Ollama);
        assert_eq!(profile.provider_profile_id, "fake-ollama");
    }

    #[tokio::test]
    async fn pipeline_forwards_request_and_events_unchanged() {
        let events = vec![
            ProviderContractEvent::Delta {
                text: "hello".to_string(),
            },
            ProviderContractEvent::ThinkingStatus {
                status: "active".to_string(),
                duration_ms: Some(12),
                token_estimate: Some(3),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: ProviderUsageMetadata::unavailable("test"),
            },
        ];
        let (pipeline, state) = fake_pipeline(events.clone());
        let request = provider_request();

        let forwarded = pipeline
            .stream_chat(request.clone())
            .collect::<Vec<_>>()
            .await;

        assert_eq!(forwarded, events);
        assert_eq!(state.lock().expect("state").request, Some(request));
    }

    #[test]
    fn pipeline_forwards_cancellation_to_registry() {
        let (pipeline, state) = fake_pipeline(Vec::new());

        assert!(pipeline.cancel_generation("request-1"));
        assert_eq!(
            state.lock().expect("state").cancel_request_id.as_deref(),
            Some("request-1")
        );
    }

    #[tokio::test]
    async fn pipeline_thinking_status_does_not_expose_raw_thinking_text() {
        let (pipeline, _) = fake_pipeline(vec![ProviderContractEvent::ThinkingStatus {
            status: "active".to_string(),
            duration_ms: Some(10),
            token_estimate: Some(4),
        }]);

        let events = pipeline
            .stream_chat(provider_request())
            .collect::<Vec<_>>()
            .await;
        let serialized = serde_json::to_string(&events).expect("serialize events");

        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("thinking_text"));
        assert!(!serialized.contains("chain_of_thought"));
        assert!(!serialized.contains("hidden_reasoning"));
    }
}
