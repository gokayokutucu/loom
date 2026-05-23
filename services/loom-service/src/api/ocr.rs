use crate::{
    api::state::AppState,
    storage::repositories::attachments::{ocr_provider_status, OcrProviderStatus},
};
use axum::{extract::State, Json};
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrProviderHealthResponse {
    pub status: String,
    pub provider: String,
    pub enabled: bool,
    pub command_path: Option<String>,
    pub rasterizer_command_path: Option<String>,
    pub language: String,
    pub dpi: u32,
    pub message: String,
    pub warnings: Vec<String>,
}

pub async fn provider_health(State(state): State<AppState>) -> Json<OcrProviderHealthResponse> {
    Json(ocr_status_to_response(ocr_provider_status(
        &state.config.current().ocr,
    )))
}

fn ocr_status_to_response(status: OcrProviderStatus) -> OcrProviderHealthResponse {
    OcrProviderHealthResponse {
        status: status.status,
        provider: status.provider,
        enabled: status.enabled,
        command_path: status.command_path,
        rasterizer_command_path: status.rasterizer_command_path,
        language: status.language,
        dpi: status.dpi,
        message: status.message,
        warnings: status.warnings,
    }
}
