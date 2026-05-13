use crate::{
    config::ConfigManager,
    providers::ollama::OllamaRuntime,
    runtime::{OperationTracker, RestartState},
    storage::db::Database,
};

#[derive(Debug, Clone)]
pub struct AppState {
    pub database: Database,
    pub ollama: OllamaRuntime,
    pub config: ConfigManager,
    pub operations: OperationTracker,
    pub restart: RestartState,
}
