use crate::{
    api::state::AppState,
    providers::secret_store::{
        default_provider_secret_ref, validate_secret_ref, SecretStatus, SecretStore,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetProviderSecretRequest {
    pub secret_ref: Option<String>,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecretStatusRequest {
    pub secret_ref: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecretResponse {
    pub provider_profile_id: String,
    pub secret_ref: String,
    pub present: bool,
    pub status: crate::providers::secret_store::SecretStatusKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecretApiError {
    pub code: String,
    pub message: String,
}

pub async fn set_provider_secret(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(input): Json<SetProviderSecretRequest>,
) -> Result<Json<ProviderSecretResponse>, (StatusCode, Json<ProviderSecretApiError>)> {
    let secret_ref = resolve_secret_ref(&state, &profile_id, input.secret_ref.as_deref())?;
    let status = state
        .secret_store
        .set_secret(&secret_ref, &input.value)
        .map_err(api_error)?;
    Ok(Json(response(profile_id, status)))
}

pub async fn delete_provider_secret(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
) -> Result<Json<ProviderSecretResponse>, (StatusCode, Json<ProviderSecretApiError>)> {
    let secret_ref = resolve_secret_ref(&state, &profile_id, None)?;
    let status = state
        .secret_store
        .delete_secret(&secret_ref)
        .map_err(api_error)?;
    Ok(Json(response(profile_id, status)))
}

pub async fn provider_secret_status(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
) -> Result<Json<ProviderSecretResponse>, (StatusCode, Json<ProviderSecretApiError>)> {
    let secret_ref = resolve_secret_ref(&state, &profile_id, None)?;
    let status = state.secret_store.status(&secret_ref).map_err(api_error)?;
    Ok(Json(response(profile_id, status)))
}

pub async fn test_provider_secret(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    Json(input): Json<ProviderSecretStatusRequest>,
) -> Result<Json<ProviderSecretResponse>, (StatusCode, Json<ProviderSecretApiError>)> {
    let secret_ref = resolve_secret_ref(&state, &profile_id, input.secret_ref.as_deref())?;
    let status = state.secret_store.status(&secret_ref).map_err(api_error)?;
    Ok(Json(response(profile_id, status)))
}

fn resolve_secret_ref(
    state: &AppState,
    profile_id: &str,
    explicit: Option<&str>,
) -> Result<String, (StatusCode, Json<ProviderSecretApiError>)> {
    if let Some(secret_ref) = explicit {
        validate_secret_ref(secret_ref).map_err(api_error)?;
        if let Some(secret_profile_id) = secret_ref
            .strip_prefix("provider:")
            .and_then(|value| value.strip_suffix(":apiKey"))
        {
            if secret_profile_id != profile_id {
                return Err(api_error(crate::error::ServiceError::config(
                    "provider secretRef profile id must match request profile id",
                )));
            }
        }
        return Ok(secret_ref.to_string());
    }
    let config = state.config.current();
    let secret_ref = config
        .providers
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .and_then(|profile| profile.secret_ref.clone())
        .unwrap_or_else(|| default_provider_secret_ref(profile_id));
    validate_secret_ref(&secret_ref).map_err(api_error)?;
    Ok(secret_ref)
}

fn response(profile_id: String, status: SecretStatus) -> ProviderSecretResponse {
    ProviderSecretResponse {
        provider_profile_id: profile_id,
        secret_ref: status.secret_ref,
        present: status.present,
        status: status.status,
    }
}

fn api_error(error: crate::error::ServiceError) -> (StatusCode, Json<ProviderSecretApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ProviderSecretApiError {
            code: "PROVIDER_SECRET_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::{ollama::OllamaRuntime, secret_store::ProviderSecretStore},
        runtime::{OperationTracker, RestartState},
        storage::db::test_database,
    };
    use axum::extract::{Path, State};
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn status_api_never_returns_raw_secret_value() {
        let state = test_state().await;
        let profile_id = "openai-local".to_string();
        let set = set_provider_secret(
            State(state.clone()),
            Path(profile_id.clone()),
            Json(SetProviderSecretRequest {
                secret_ref: None,
                value: "sk-secret-provider".to_string(),
            }),
        )
        .await
        .expect("set secret")
        .0;
        let status = provider_secret_status(State(state), Path(profile_id))
            .await
            .expect("status")
            .0;
        let serialized = serde_json::to_string(&status).expect("status json");

        assert!(set.present);
        assert!(status.present);
        assert!(!serialized.contains("sk-secret-provider"));
        assert!(!serialized.contains("Authorization"));
    }

    #[tokio::test]
    async fn missing_env_ref_status_is_safe() {
        std::env::remove_var("LOOM_TEST_PROVIDER_SECRET_API_MISSING");
        let state = test_state().await;
        let status = test_provider_secret(
            State(state),
            Path("openai-local".to_string()),
            Json(ProviderSecretStatusRequest {
                secret_ref: Some("env:LOOM_TEST_PROVIDER_SECRET_API_MISSING".to_string()),
            }),
        )
        .await
        .expect("status")
        .0;

        assert!(!status.present);
        assert_eq!(
            status.status,
            crate::providers::secret_store::SecretStatusKind::Missing
        );
    }

    async fn test_state() -> AppState {
        let database = test_database().await;
        let mut config = LoomServiceConfig::default();
        config.providers.profiles[0].id = "openai-local".to_string();
        config.providers.profiles[0].secret_ref = Some(default_provider_secret_ref("openai-local"));
        AppState {
            database,
            ollama: OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            }),
            config: ConfigManager::new(PathBuf::from("/tmp/loom-service-test.toml"), config),
            secret_store: ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
            agent_runs: Default::default(),
        }
    }
}
