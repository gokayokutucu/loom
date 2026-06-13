use std::sync::Arc;

use futures_util::Stream;

use crate::agent_runtime::events::AgentEvent;
use crate::agent_runtime::runtime::{AgentCancellationOutcome, AgentRunStore, AgentRuntime};
use crate::agent_runtime::types::{AgentRunId, AgentRuntimeRequest};
use crate::providers::adapter::ProviderRegistry;
use crate::providers::ollama::OllamaRuntime;
use crate::providers::pipeline::{ProviderPipeline, ProviderPipelineRegistry};

/// Internal service boundary for the Loom-native Agent Runtime.
///
/// This is the only intended entry point for service-internal callers. It is
/// not exposed through HTTP, Electron/Tauri, or the frontend engine client —
/// AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001 gates any route exposure.
#[derive(Debug, Clone)]
pub struct AgentRuntimeService<R = ProviderRegistry> {
    runtime: Arc<AgentRuntime<R>>,
}

impl AgentRuntimeService<ProviderRegistry> {
    /// Production construction from the service's Ollama runtime, mirroring
    /// how product paths build `ProviderPipeline::new(state.ollama.clone())`.
    pub fn from_ollama(ollama: OllamaRuntime) -> Self {
        Self::new(ProviderPipeline::new(ollama))
    }

    /// Production construction sharing a process-lifetime run store owned by
    /// app state, so runs remain inspectable across service instances.
    pub fn from_ollama_with_store(ollama: OllamaRuntime, run_store: AgentRunStore) -> Self {
        Self::with_run_store(ProviderPipeline::new(ollama), run_store)
    }

    pub fn from_ollama_with_store_and_registry(
        ollama: OllamaRuntime,
        run_store: AgentRunStore,
        tool_registry: Arc<std::sync::RwLock<crate::agent_runtime::tool_registry::ToolRegistry>>,
    ) -> Self {
        Self::with_run_store_and_registry(ProviderPipeline::new(ollama), run_store, tool_registry)
    }
}

impl<R> AgentRuntimeService<R>
where
    R: ProviderPipelineRegistry,
{
    pub fn new(pipeline: ProviderPipeline<R>) -> Self {
        Self {
            runtime: Arc::new(AgentRuntime::new(pipeline)),
        }
    }

    pub fn with_run_store(pipeline: ProviderPipeline<R>, run_store: AgentRunStore) -> Self {
        Self {
            runtime: Arc::new(AgentRuntime::with_run_store(pipeline, run_store)),
        }
    }

    pub fn with_run_store_and_registry(
        pipeline: ProviderPipeline<R>,
        run_store: AgentRunStore,
        tool_registry: Arc<std::sync::RwLock<crate::agent_runtime::tool_registry::ToolRegistry>>,
    ) -> Self {
        Self {
            runtime: Arc::new(AgentRuntime::with_run_store_and_registry(
                pipeline,
                run_store,
                tool_registry,
            )),
        }
    }

    /// Executes an agent run, yielding safe `AgentEvent`s only.
    pub fn execute(&self, request: AgentRuntimeRequest) -> impl Stream<Item = AgentEvent> {
        self.runtime.execute_run(request)
    }

    pub fn run_store(&self) -> &AgentRunStore {
        self.runtime.run_store()
    }

    pub fn cancel(&self, run_id: &AgentRunId) -> AgentCancellationOutcome {
        self.runtime.cancel_run(run_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime::test_support::{
        make_pending_test_service, make_test_service, FakeRegistry,
    };
    use crate::agent_runtime::types::{
        AgentRunStatus, AgentRuntimeProviderOptions, AgentRuntimeRequest,
    };
    use crate::providers::config::ProviderKind;
    use crate::providers::contract::{ProviderContractEvent, ProviderUsageMetadata};
    use crate::providers::types::{ProviderError, ProviderErrorKind};
    use futures_util::StreamExt;

    fn make_request(response_id: &str) -> AgentRuntimeRequest {
        AgentRuntimeRequest {
            prompt: "ping".to_string(),
            loom_id: Some("test-loom".to_string()),
            response_id: Some(response_id.to_string()),
            parent_response_id: None,
            provider_profile_id: None,
            model_id: None,
            context_snapshot_id: None,
            provider_options: None,
        }
    }

    fn completed_events() -> Vec<ProviderContractEvent> {
        vec![
            ProviderContractEvent::Delta {
                text: "hello".to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: ProviderUsageMetadata::Available {
                    prompt_tokens: Some(10),
                    completion_tokens: Some(20),
                    total_tokens: Some(30),
                },
            },
        ]
    }

    #[tokio::test]
    async fn test_service_executes_run_and_shares_store() {
        let (service, _) = make_test_service(completed_events());
        let request = make_request("service-run");

        let events = service.execute(request).collect::<Vec<_>>().await;

        assert!(matches!(
            events.first(),
            Some(AgentEvent::RunStarted { .. })
        ));
        assert!(matches!(
            events.last(),
            Some(AgentEvent::RunCompleted { .. })
        ));

        // The same store instance the service exposes observed the run.
        let run = service
            .run_store()
            .get(&AgentRunId::from("service-run"))
            .expect("run recorded through service boundary");
        assert_eq!(run.status, AgentRunStatus::Completed);
        assert_eq!(run.usage.and_then(|u| u.total_tokens), Some(30));
    }

    #[tokio::test]
    async fn test_service_shares_external_run_store() {
        let run_store = AgentRunStore::new();
        let (pipeline, _) =
            crate::agent_runtime::test_support::make_test_pipeline(completed_events());
        let service =
            AgentRuntimeService::<FakeRegistry>::with_run_store(pipeline, run_store.clone());

        let _ = service
            .execute(make_request("external-store-run"))
            .collect::<Vec<_>>()
            .await;

        // The externally owned store (app-state pattern) sees the run.
        assert_eq!(run_store.len(), 1);
        assert!(run_store
            .get(&AgentRunId::from("external-store-run"))
            .is_some());
    }

    #[tokio::test]
    async fn test_service_events_are_safe_when_provider_emits_thinking() {
        let events = vec![
            ProviderContractEvent::ThinkingDelta {
                text: "secret reasoning".to_string(),
            },
            ProviderContractEvent::Delta {
                text: "visible".to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: ProviderUsageMetadata::unavailable("no-usage"),
            },
        ];
        let (service, _) = make_test_service(events);

        let stream_events = service
            .execute(make_request("service-privacy"))
            .collect::<Vec<_>>()
            .await;
        let serialized = serde_json::to_string(&stream_events).expect("serialize");

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
                !serialized.to_ascii_lowercase().contains(forbidden),
                "found forbidden text: {forbidden}"
            );
        }

        // The store keeps metadata only — no prompt, payloads, or headers.
        let run = service
            .run_store()
            .get(&AgentRunId::from("service-privacy"))
            .expect("run recorded");
        let run_serialized = serde_json::to_string(&run).expect("serialize run");
        assert!(!run_serialized.contains("ping"), "prompt leaked into store");
        assert!(!run_serialized
            .to_ascii_lowercase()
            .contains("authorization"));
    }

    #[tokio::test]
    async fn test_service_cancel_flags_run_and_calls_pipeline() {
        let (service, state) = make_pending_test_service(vec![ProviderContractEvent::Delta {
            text: "partial".to_string(),
        }]);
        let run_id = AgentRunId::from("service-cancel");

        let collect = service
            .execute(make_request("service-cancel"))
            .collect::<Vec<_>>();
        let cancel = async {
            while service.run_store().get(&run_id).is_none() {
                tokio::task::yield_now().await;
            }
            service.cancel(&run_id)
        };
        let (events, outcome) = tokio::join!(collect, cancel);

        assert!(matches!(
            outcome,
            AgentCancellationOutcome::Cancelled {
                newly_requested: true,
                ..
            }
        ));
        assert_eq!(
            state.lock().unwrap().cancel_called_with.as_deref(),
            Some("service-cancel")
        );
        let run = service.run_store().get(&run_id).expect("run recorded");
        assert!(run.cancel_requested);
        assert_eq!(run.status, AgentRunStatus::Cancelled);
        assert!(matches!(
            events.last(),
            Some(AgentEvent::RunCancelled { run_id }) if run_id == "service-cancel"
        ));

        let repeated = service.cancel(&run_id);
        assert!(matches!(
            repeated,
            AgentCancellationOutcome::Cancelled {
                newly_requested: false,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn test_service_cancel_preserves_completed_run() {
        let (service, state) = make_test_service(completed_events());
        let run_id = AgentRunId::from("service-completed");
        let _ = service
            .execute(make_request("service-completed"))
            .collect::<Vec<_>>()
            .await;

        let outcome = service.cancel(&run_id);

        assert!(matches!(
            outcome,
            AgentCancellationOutcome::Terminal { ref run }
                if run.status == AgentRunStatus::Completed
        ));
        assert!(state.lock().unwrap().cancel_called_with.is_none());
    }

    #[tokio::test]
    async fn test_service_cancel_preserves_failed_run() {
        let error = ProviderError::new(ProviderErrorKind::RuntimeUnavailable, ProviderKind::Ollama);
        let (service, state) = make_test_service(vec![ProviderContractEvent::Error { error }]);
        let run_id = AgentRunId::from("service-failed");
        let _ = service
            .execute(make_request("service-failed"))
            .collect::<Vec<_>>()
            .await;

        let outcome = service.cancel(&run_id);

        assert!(matches!(
            outcome,
            AgentCancellationOutcome::Terminal { ref run }
                if run.status == AgentRunStatus::Failed
        ));
        assert!(state.lock().unwrap().cancel_called_with.is_none());
    }

    #[tokio::test]
    async fn test_service_provider_options_flow_through() {
        // Defaults flow through the service boundary unchanged.
        let (service, state) = make_test_service(completed_events());
        let _ = service
            .execute(make_request("service-default-opts"))
            .collect::<Vec<_>>()
            .await;
        let captured = state.lock().unwrap().last_request.clone().unwrap();
        assert_eq!(captured.options.temperature, Some(0.7));
        assert_eq!(captured.options.max_tokens, Some(1024));

        // Custom options flow through as well.
        let (service, state) = make_test_service(completed_events());
        let mut request = make_request("service-custom-opts");
        request.provider_options = Some(AgentRuntimeProviderOptions {
            temperature: Some(0.2),
            max_output_tokens: Some(256),
        });
        let _ = service.execute(request).collect::<Vec<_>>().await;
        let captured = state.lock().unwrap().last_request.clone().unwrap();
        assert_eq!(captured.options.temperature, Some(0.2));
        assert_eq!(captured.options.max_tokens, Some(256));
    }

    #[test]
    fn test_product_paths_do_not_call_agent_runtime() {
        // Static guard: Main generation and Quick Ask sources must not invoke
        // the agent runtime. (The AppState `agent_runs` store field is allowed;
        // calling the runtime is not.)
        let orchestration = include_str!("../api/orchestration.rs");
        let ask = include_str!("../api/ask.rs");
        for source in [orchestration, ask] {
            for forbidden in ["AgentRuntimeService", "execute_run", "agent_runtime()"] {
                assert!(
                    !source.contains(forbidden),
                    "product path references agent runtime: {forbidden}"
                );
            }
        }
    }
}
