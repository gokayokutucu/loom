use crate::{
    agent_runtime::{runtime::AgentRunStore, service::AgentRuntimeService},
    config::ConfigManager,
    providers::{ollama::OllamaRuntime, secret_store::ProviderSecretStore},
    runtime::{OperationTracker, RestartState},
    storage::db::Database,
};

#[derive(Debug, Clone)]
pub struct AppState {
    pub database: Database,
    pub ollama: OllamaRuntime,
    pub config: ConfigManager,
    pub secret_store: ProviderSecretStore,
    pub operations: OperationTracker,
    pub restart: RestartState,
    /// Process-lifetime in-memory agent run state. It is reachable only through
    /// the gated experimental Agent Runtime routes.
    pub agent_runs: AgentRunStore,
}

impl AppState {
    /// Internal Agent Runtime boundary. Mirrors the per-call
    /// `ProviderPipeline::new(state.ollama.clone())` idiom used by product
    /// paths while sharing the process-lifetime run store. HTTP exposure is
    /// restricted to the explicitly gated experimental route module.
    pub fn agent_runtime(&self) -> AgentRuntimeService {
        AgentRuntimeService::from_ollama_with_store(self.ollama.clone(), self.agent_runs.clone())
    }
}
