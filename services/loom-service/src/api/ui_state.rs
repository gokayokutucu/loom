use crate::{
    api::state::AppState,
    error::ServiceError,
    storage::repositories::ui_state::{UiStateRecord, UiStateRepository},
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const FORBIDDEN_THINKING_KEYS: [&str; 8] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "rawThinking",
    "thinkingText",
    "chainOfThought",
    "hiddenReasoning",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertUiStateRequest {
    pub value: Value,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UiStateDto {
    pub key: String,
    pub value: Value,
    pub updated_at: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UiStateEnvelope {
    pub state: Option<UiStateDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiStateApiError {
    pub code: String,
    pub message: String,
}

pub async fn get_ui_state(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<UiStateEnvelope>, (StatusCode, Json<UiStateApiError>)> {
    validate_state_key(&key)?;
    let repository = UiStateRepository::new(&state.database);
    let record = repository.get_state(&key).await.map_err(storage_error)?;
    Ok(Json(UiStateEnvelope {
        state: record.map(record_to_dto).transpose()?,
    }))
}

pub async fn put_ui_state(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(input): Json<UpsertUiStateRequest>,
) -> Result<Json<UiStateEnvelope>, (StatusCode, Json<UiStateApiError>)> {
    validate_state_key(&key)?;
    reject_forbidden_value(&input.value)?;
    let value_json = serde_json::to_string(&input.value).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            Json(UiStateApiError {
                code: "invalid_ui_state".to_string(),
                message: format!("UI state payload is not serializable: {error}"),
            }),
        )
    })?;
    let repository = UiStateRepository::new(&state.database);
    let record = repository
        .upsert_state(&key, &value_json)
        .await
        .map_err(storage_error)?;
    Ok(Json(UiStateEnvelope {
        state: Some(record_to_dto(record)?),
    }))
}

fn record_to_dto(record: UiStateRecord) -> Result<UiStateDto, (StatusCode, Json<UiStateApiError>)> {
    let value = serde_json::from_str::<Value>(&record.value_json).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(UiStateApiError {
                code: "invalid_stored_ui_state".to_string(),
                message: format!("Stored UI state is invalid JSON: {error}"),
            }),
        )
    })?;
    reject_forbidden_value(&value)?;
    Ok(UiStateDto {
        key: record.state_key,
        value,
        updated_at: record.updated_at,
    })
}

fn validate_state_key(key: &str) -> Result<(), (StatusCode, Json<UiStateApiError>)> {
    let valid = !key.is_empty()
        && key.len() <= 80
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if valid {
        return Ok(());
    }
    Err((
        StatusCode::BAD_REQUEST,
        Json(UiStateApiError {
            code: "invalid_ui_state_key".to_string(),
            message: "UI state key must use only letters, numbers, dash, underscore, or dot."
                .to_string(),
        }),
    ))
}

fn reject_forbidden_value(value: &Value) -> Result<(), (StatusCode, Json<UiStateApiError>)> {
    let text = value.to_string().to_ascii_lowercase();
    if FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| text.contains(&key.to_ascii_lowercase()))
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(UiStateApiError {
                code: "forbidden_ui_state_payload".to_string(),
                message: "UI state payload contains forbidden raw thinking fields.".to_string(),
            }),
        ));
    }
    Ok(())
}

fn storage_error(error: ServiceError) -> (StatusCode, Json<UiStateApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(UiStateApiError {
            code: "ui_state_storage_error".to_string(),
            message: error.to_string(),
        }),
    )
}
