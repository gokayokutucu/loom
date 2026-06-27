use crate::{
    agent_runtime::{runtime::AgentRunStore, service::AgentRuntimeService},
    config::ConfigManager,
    providers::{ollama::OllamaRuntime, secret_store::ProviderSecretStore},
    runtime::{OperationTracker, RestartState},
    storage::{db::Database, repositories::agent_runs::AgentRunRepository},
    tool_scheduler_runtime::ToolSchedulerRuntime,
};

#[derive(Debug, Clone)]
pub struct AppState {
    pub database: Database,
    pub ollama: OllamaRuntime,
    pub config: ConfigManager,
    pub secret_store: ProviderSecretStore,
    pub operations: OperationTracker,
    pub restart: RestartState,
    /// Process-lifetime in-memory agent run state (cancellation authority).
    pub agent_runs: AgentRunStore,
    /// Durable agent run history repository (SQLite source of truth).
    pub agent_run_repository: AgentRunRepository,
    pub tool_registry:
        std::sync::Arc<std::sync::RwLock<crate::agent_runtime::tool_registry::ToolRegistry>>,
}

impl AppState {
    /// Internal Agent Runtime boundary. Each HTTP request constructs a new
    /// service instance; cancellation still reaches active provider requests
    /// because `OllamaRuntime` clones share one Arc-backed `CancellationRegistry`.
    pub fn agent_runtime(&self) -> AgentRuntimeService {
        AgentRuntimeService::from_ollama_with_store_registry_and_repo(
            self.ollama.clone(),
            self.agent_runs.clone(),
            self.tool_registry.clone(),
            self.agent_run_repository.clone(),
            ToolSchedulerRuntime::new(
                crate::storage::repositories::tool_scheduler::ToolSchedulerRepository::from_pool(
                    self.database.pool(),
                ),
            ),
        )
    }
}
