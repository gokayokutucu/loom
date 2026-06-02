use crate::{
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
}
