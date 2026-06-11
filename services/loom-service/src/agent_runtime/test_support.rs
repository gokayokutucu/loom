//! Shared fake provider/pipeline harness for agent runtime tests.

use std::sync::{Arc, Mutex};

use async_stream::stream;

use crate::agent_runtime::runtime::AgentRuntime;
use crate::agent_runtime::service::AgentRuntimeService;
use crate::providers::adapter::ProviderAdapter;
use crate::providers::config::ProviderKind;
use crate::providers::contract::{
    ProviderContractCapabilities, ProviderContractEvent, ProviderContractRequest,
};
use crate::providers::pipeline::{ProviderPipeline, ProviderPipelineRegistry};

#[derive(Debug, Clone, Default)]
pub struct FakeAdapterState {
    pub cancel_called_with: Option<String>,
    pub last_request: Option<ProviderContractRequest>,
}

#[derive(Debug, Clone)]
pub struct FakeProviderAdapter {
    pub state: Arc<Mutex<FakeAdapterState>>,
    pub events: Vec<ProviderContractEvent>,
    pub hold_open_after_events: bool,
}

impl ProviderAdapter for FakeProviderAdapter {
    fn provider_kind(&self) -> ProviderKind {
        ProviderKind::Ollama
    }

    fn provider_profile_id(&self) -> &str {
        "fake-agent-provider"
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

    fn stream_chat(
        &self,
        request: ProviderContractRequest,
    ) -> crate::providers::adapter::ProviderEventStream {
        self.state.lock().unwrap().last_request = Some(request);
        let events = self.events.clone();
        let hold_open_after_events = self.hold_open_after_events;
        Box::pin(stream! {
            for event in events {
                yield event;
            }
            if hold_open_after_events {
                std::future::pending::<()>().await;
            }
        })
    }

    fn cancel(&self, request_id: &str) -> bool {
        self.state.lock().unwrap().cancel_called_with = Some(request_id.to_string());
        true
    }
}

#[derive(Debug, Clone)]
pub struct FakeRegistry {
    pub adapter: FakeProviderAdapter,
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

pub fn make_test_pipeline(
    events: Vec<ProviderContractEvent>,
) -> (ProviderPipeline<FakeRegistry>, Arc<Mutex<FakeAdapterState>>) {
    let state = Arc::new(Mutex::new(FakeAdapterState::default()));
    let adapter = FakeProviderAdapter {
        state: state.clone(),
        events,
        hold_open_after_events: false,
    };
    let registry = FakeRegistry { adapter };
    (ProviderPipeline::from_registry(registry), state)
}

pub fn make_pending_test_service(
    events: Vec<ProviderContractEvent>,
) -> (
    AgentRuntimeService<FakeRegistry>,
    Arc<Mutex<FakeAdapterState>>,
) {
    let state = Arc::new(Mutex::new(FakeAdapterState::default()));
    let adapter = FakeProviderAdapter {
        state: state.clone(),
        events,
        hold_open_after_events: true,
    };
    let registry = FakeRegistry { adapter };
    (
        AgentRuntimeService::new(ProviderPipeline::from_registry(registry)),
        state,
    )
}

pub fn make_test_runtime(
    events: Vec<ProviderContractEvent>,
) -> (AgentRuntime<FakeRegistry>, Arc<Mutex<FakeAdapterState>>) {
    let (pipeline, state) = make_test_pipeline(events);
    (AgentRuntime::new(pipeline), state)
}

pub fn make_test_service(
    events: Vec<ProviderContractEvent>,
) -> (
    AgentRuntimeService<FakeRegistry>,
    Arc<Mutex<FakeAdapterState>>,
) {
    let (pipeline, state) = make_test_pipeline(events);
    (AgentRuntimeService::new(pipeline), state)
}
