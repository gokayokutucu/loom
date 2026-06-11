use crate::{
    api::state::AppState,
    runtime::{RuntimeShutdownRequest, RuntimeShutdownResponse, RuntimeStatus},
};
use axum::{extract::State, Json};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeApiStatus {
    #[serde(flatten)]
    pub runtime: RuntimeStatus,
    pub database: RuntimeReadinessStatus,
    pub config: crate::config::ConfigStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadinessStatus {
    pub status: String,
}

pub async fn status(State(state): State<AppState>) -> Json<RuntimeApiStatus> {
    let database_ready = state.database.health_check().await;
    Json(RuntimeApiStatus {
        runtime: state.restart.runtime_status(&state.operations),
        database: RuntimeReadinessStatus {
            status: if database_ready {
                "ready"
            } else {
                "unavailable"
            }
            .to_string(),
        },
        config: state.config.status(),
    })
}

pub async fn shutdown(
    State(state): State<AppState>,
    Json(input): Json<RuntimeShutdownRequest>,
) -> Json<RuntimeShutdownResponse> {
    Json(
        state
            .restart
            .request_shutdown(state.operations.clone(), input),
    )
}

#[cfg(test)]
mod tests {
    use super::{shutdown, status};
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationKind, OperationTracker, RestartState, RuntimeLifecycleState},
        storage::db::test_database,
    };
    use axum::extract::State;
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn runtime_status_reports_ready_state() {
        let state = test_state().await;

        let response = status(State(state)).await.0;

        assert_eq!(response.runtime.runtime, "loom-service");
        assert_eq!(
            response.runtime.lifecycle_state,
            RuntimeLifecycleState::Ready
        );
        assert_eq!(response.runtime.active_run_count, 0);
        assert_eq!(response.database.status, "ready");
    }

    #[tokio::test]
    async fn runtime_shutdown_reports_draining_state_with_active_run() {
        let state = test_state().await;
        let _guard = state
            .operations
            .start("run-1", OperationKind::ModelGeneration);

        let response = shutdown(
            State(state.clone()),
            axum::Json(crate::runtime::RuntimeShutdownRequest {
                mode: Some("drain".to_string()),
                reason: Some("electron_quit".to_string()),
                timeout_ms: Some(100),
            }),
        )
        .await
        .0;

        assert!(response.accepted);
        assert_eq!(response.lifecycle_state, RuntimeLifecycleState::Draining);
        assert_eq!(response.active_run_count, 1);
        assert!(status(State(state)).await.0.runtime.shutdown_requested);
    }

    async fn test_state() -> AppState {
        let database = test_database().await;
        let config_file = LoomServiceConfig::default();
        AppState {
            database,
            ollama: OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            }),
            config: ConfigManager::new(
                PathBuf::from("/tmp/loom-service-runtime-test.toml"),
                config_file,
            ),
            secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
            agent_runs: Default::default(),
        }
    }
}
