mod api;
mod capabilities;
mod config;
mod context;
mod display_code;
mod domain;
mod error;
mod events;
mod exports;
mod graph;
mod orchestration;
mod providers;
mod runtime;
mod speech;
mod storage;

use storage::repositories::code_blocks::cleanup_pseudo_artifact_blocks;
use storage::repositories::tags_graph::cleanup_orphaned_code_language_tags;

use config::{ConfigManager, ServiceConfig};
use providers::ollama::OllamaRuntime;
use runtime::{OperationTracker, RestartState};
use storage::db::{Database, DatabaseConfig};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = ServiceConfig::from_env()?;

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new(config.log_filter.clone()))
        .init();

    let address = config.address();
    tracing::info!(
        host = %config.host,
        port = config.port,
        local_only = config.local_only(),
        log_filter = %config.log_filter,
        db_path = %config.db_path.display(),
        ollama_base_url = %config.ollama.base_url,
        ollama_request_timeout_ms = config.ollama.request_timeout.as_millis(),
        ollama_first_chunk_timeout_ms = config.ollama.first_chunk_timeout.as_millis(),
        ollama_stream_idle_timeout_ms = config.ollama.stream_idle_timeout.as_millis(),
        "loom-service config loaded"
    );

    let database_config = DatabaseConfig::from_service_config(&config)?;
    tracing::info!(db_path = %database_config.display_path, "loom-service SQLite config loaded");
    let database = Database::connect_and_migrate(&database_config).await?;
    tracing::info!("loom-service SQLite migrations ready");

    match cleanup_pseudo_artifact_blocks(database.pool()).await {
        Ok(0) => {}
        Ok(count) => tracing::info!(
            count,
            "loom-service removed historical pseudo-artifact code blocks"
        ),
        Err(error) => {
            tracing::warn!(%error, "loom-service pseudo-artifact cleanup failed; continuing")
        }
    }

    match cleanup_orphaned_code_language_tags(database.pool()).await {
        Ok(0) => {}
        Ok(count) => tracing::info!(
            count,
            "loom-service removed orphaned code-language tags from deleted pseudo-artifact blocks"
        ),
        Err(error) => tracing::warn!(
            %error,
            "loom-service orphaned code-language tag cleanup failed; continuing"
        ),
    }

    let ollama = OllamaRuntime::new(config.ollama.clone());
    let config_manager = ConfigManager::new(config.config_path.clone(), config.config_file.clone());
    let operations = OperationTracker::default();
    let restart_state = RestartState::default();
    restart_state.spawn_owner_reaper(operations.clone());
    let shutdown_state = restart_state.clone();
    let app = api::router(database, ollama, config_manager, operations, restart_state);
    let listener = TcpListener::bind(address).await?;
    tracing::info!(%address, "loom-service started; health endpoint ready at /health");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(shutdown_state))
        .await?;

    Ok(())
}

async fn shutdown_signal(restart_state: RestartState) {
    tokio::select! {
        result = tokio::signal::ctrl_c() => {
            if let Err(error) = result {
                tracing::warn!(%error, "failed to listen for shutdown signal");
            }
        }
        _ = restart_state.wait_for_shutdown() => {
            tracing::info!("loom-service graceful drain shutdown requested");
        }
    }
}
