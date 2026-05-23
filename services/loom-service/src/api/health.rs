use crate::api::state::AppState;
use axum::extract::State;
use axum::Json;
use serde::Serialize;

const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
    pub runtime: &'static str,
    pub version: &'static str,
    pub lifecycle_state: crate::runtime::RuntimeLifecycleState,
    pub runtime_owner_kind: crate::runtime::RuntimeOwnerKind,
    pub active_run_count: usize,
    pub shutdown_requested: bool,
    pub local_only: bool,
    pub database: DatabaseHealthResponse,
    pub config: crate::config::ConfigStatus,
    pub providers: ProvidersHealthResponse,
}

#[derive(Debug, Serialize)]
pub struct DatabaseHealthResponse {
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct ProvidersHealthResponse {
    pub ollama: crate::providers::types::OllamaHealthResponse,
}

#[derive(Debug, Serialize)]
pub struct VersionResponse {
    pub name: &'static str,
    pub version: &'static str,
    pub build: &'static str,
}

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let database_ready = state.database.health_check().await;
    let ollama = state.ollama.health().await;
    let providers_ready = ollama.status == "ready";
    let runtime_status = state.restart.runtime_status(&state.operations);

    Json(HealthResponse {
        status: if database_ready && providers_ready {
            runtime_status.lifecycle_state.as_str()
        } else {
            "degraded"
        }
        .to_string(),
        runtime: "loom-service",
        version: PACKAGE_VERSION,
        lifecycle_state: runtime_status.lifecycle_state,
        runtime_owner_kind: runtime_status.runtime_owner_kind,
        active_run_count: runtime_status.active_run_count,
        shutdown_requested: runtime_status.shutdown_requested,
        local_only: true,
        database: DatabaseHealthResponse {
            status: if database_ready {
                "ready"
            } else {
                "unavailable"
            }
            .to_string(),
        },
        config: state.config.status(),
        providers: ProvidersHealthResponse { ollama },
    })
}

pub async fn version() -> Json<VersionResponse> {
    Json(VersionResponse {
        name: "loom-service",
        version: PACKAGE_VERSION,
        build: "dev",
    })
}

#[cfg(test)]
mod tests {
    use super::health;
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::db::test_database,
    };
    use axum::extract::State;
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn service_health_degrades_but_stays_available_when_ollama_unreachable() {
        let state = test_state("http://127.0.0.1:9").await;

        let response = health(State(state)).await.0;

        assert_eq!(response.runtime, "loom-service");
        assert_eq!(response.status, "degraded");
        assert_eq!(response.database.status, "ready");
        assert_eq!(response.config.status, "ready");
        assert_eq!(response.providers.ollama.status, "unavailable");
        assert_eq!(
            response.providers.ollama.reason.as_deref(),
            Some("runtime_unavailable")
        );
    }

    async fn test_state(ollama_base_url: &str) -> AppState {
        let database = test_database().await;
        let config_file = LoomServiceConfig::default();
        let ollama = OllamaRuntime::new(OllamaConfig {
            base_url: ollama_base_url.to_string(),
            request_timeout: Duration::from_millis(200),
            first_chunk_timeout: Duration::from_millis(200),
            stream_idle_timeout: Duration::from_millis(200),
            security: Default::default(),
        });

        AppState {
            database,
            ollama,
            config: ConfigManager::new(PathBuf::from("/tmp/loom-service-test.toml"), config_file),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }
}
