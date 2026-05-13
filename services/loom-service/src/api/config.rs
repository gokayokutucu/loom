use crate::{
    api::state::AppState,
    config::{ConfigPatch, LoomServiceConfig},
    runtime::{RestartRequestResponse, RestartStatus},
};
use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;

pub async fn get_config(State(state): State<AppState>) -> Json<LoomServiceConfig> {
    Json(state.config.current())
}

pub async fn patch_config(
    State(state): State<AppState>,
    Json(patch): Json<ConfigPatch>,
) -> Result<Json<ConfigPatchResponse>, (StatusCode, Json<ConfigApiError>)> {
    let result = state.config.patch(patch).map_err(config_error)?;
    let restart_status = if result.restart.restart_required {
        state
            .restart
            .mark_required(result.restart.reason.clone(), &state.operations)
    } else {
        state.restart.status(&state.operations)
    };

    Ok(Json(ConfigPatchResponse {
        config: result.config,
        restart_classification: result.restart,
        restart_status,
    }))
}

pub async fn restart_status(State(state): State<AppState>) -> Json<RestartStatus> {
    Json(state.restart.status(&state.operations))
}

pub async fn request_restart(State(state): State<AppState>) -> Json<RestartRequestResponse> {
    Json(state.restart.request_restart(&state.operations))
}

fn config_error(error: crate::error::ServiceError) -> (StatusCode, Json<ConfigApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ConfigApiError {
            code: "CONFIG_VALIDATION_FAILED".to_string(),
            message: error.to_string(),
        }),
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPatchResponse {
    pub config: LoomServiceConfig,
    pub restart_classification: ConfigUpdateResultRestart,
    pub restart_status: RestartStatus,
}

type ConfigUpdateResultRestart = crate::config::RestartClassification;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigApiError {
    pub code: String,
    pub message: String,
}
