use crate::{
    api::state::AppState,
    capabilities::repository::{new_id, timestamp},
    error::ServiceError,
    storage::repositories::navigation_history::{
        NavigationHistoryRecord, NavigationHistoryRepository, NewNavigationHistoryEntry,
    },
};
use axum::{
    extract::{Query, State},
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
pub struct HistoryQuery {
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordHistoryRequest {
    pub entry: HistoryInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryInput {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub object_type: String,
    pub title: String,
    pub path: String,
    pub badge: Option<String>,
    pub target_object_id: Option<String>,
    pub canonical_uri: Option<String>,
    pub reference_code: Option<String>,
    pub visited_at: Option<String>,
    pub navigation_destination: Option<Value>,
    pub meta: Option<Value>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDto {
    pub id: String,
    #[serde(rename = "type")]
    pub object_type: String,
    pub title: String,
    pub path: String,
    pub badge: Option<String>,
    pub target_object_id: Option<String>,
    pub canonical_uri: Option<String>,
    pub reference_code: Option<String>,
    pub visited_at: String,
    pub navigation_destination: Option<Value>,
    pub meta: Option<Value>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEnvelope {
    pub entry: HistoryDto,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListResponse {
    pub history: Vec<HistoryDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryApiError {
    pub code: String,
    pub message: String,
}

pub async fn list_history(
    State(state): State<AppState>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<HistoryListResponse>, (StatusCode, Json<HistoryApiError>)> {
    let repository = NavigationHistoryRepository::new(&state.database);
    let entries = repository
        .list_entries(query.limit.unwrap_or(100))
        .await
        .map_err(storage_error)?;
    Ok(Json(HistoryListResponse {
        history: entries.into_iter().map(history_to_dto).collect(),
    }))
}

pub async fn record_history(
    State(state): State<AppState>,
    Json(input): Json<RecordHistoryRequest>,
) -> Result<(StatusCode, Json<HistoryEnvelope>), (StatusCode, Json<HistoryApiError>)> {
    reject_forbidden_text(Some(&input.entry.title))?;
    reject_forbidden_value(input.entry.navigation_destination.as_ref())?;
    reject_forbidden_value(input.entry.meta.as_ref())?;
    let title = required_trimmed("title", &input.entry.title)?;
    let path = required_trimmed("path", &input.entry.path)?;
    let object_type = required_trimmed("type", &input.entry.object_type)?;
    let now = timestamp();
    let entry = NewNavigationHistoryEntry {
        history_id: input.entry.id.unwrap_or_else(|| new_id("history")),
        title,
        path,
        object_type,
        badge: input.entry.badge,
        target_object_id: input.entry.target_object_id,
        canonical_uri: input.entry.canonical_uri,
        reference_code: input.entry.reference_code,
        navigation_destination_json: value_json(input.entry.navigation_destination)?,
        metadata_json: value_json(input.entry.meta)?,
        visited_at: input.entry.visited_at.unwrap_or_else(|| now.clone()),
        created_at: now,
    };

    let repository = NavigationHistoryRepository::new(&state.database);
    repository
        .insert_entry(&entry)
        .await
        .map_err(storage_error)?;
    Ok((
        StatusCode::CREATED,
        Json(HistoryEnvelope {
            entry: new_to_dto(entry),
        }),
    ))
}

fn history_to_dto(entry: NavigationHistoryRecord) -> HistoryDto {
    HistoryDto {
        id: entry.history_id,
        object_type: entry.object_type,
        title: entry.title,
        path: entry.path,
        badge: entry.badge,
        target_object_id: entry.target_object_id,
        canonical_uri: entry.canonical_uri,
        reference_code: entry.reference_code,
        visited_at: entry.visited_at,
        navigation_destination: entry
            .navigation_destination_json
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
        meta: entry
            .metadata_json
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
    }
}

fn new_to_dto(entry: NewNavigationHistoryEntry) -> HistoryDto {
    HistoryDto {
        id: entry.history_id,
        object_type: entry.object_type,
        title: entry.title,
        path: entry.path,
        badge: entry.badge,
        target_object_id: entry.target_object_id,
        canonical_uri: entry.canonical_uri,
        reference_code: entry.reference_code,
        visited_at: entry.visited_at,
        navigation_destination: entry
            .navigation_destination_json
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
        meta: entry
            .metadata_json
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
    }
}

fn required_trimmed(
    field: &'static str,
    value: &str,
) -> Result<String, (StatusCode, Json<HistoryApiError>)> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(bad_request(
            "INVALID_HISTORY",
            &format!("{field} is required."),
        ));
    }
    Ok(trimmed.to_string())
}

fn value_json(value: Option<Value>) -> Result<Option<String>, (StatusCode, Json<HistoryApiError>)> {
    value
        .map(|value| {
            serde_json::to_string(&value)
                .map_err(|_| bad_request("INVALID_HISTORY", "History metadata is invalid JSON."))
        })
        .transpose()
}

fn reject_forbidden_text(value: Option<&str>) -> Result<(), (StatusCode, Json<HistoryApiError>)> {
    let Some(value) = value else {
        return Ok(());
    };
    let lower = value.to_ascii_lowercase();
    if FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| lower.contains(key))
    {
        return Err(bad_request(
            "FORBIDDEN_THINKING_PAYLOAD",
            "History must not contain raw model thinking fields.",
        ));
    }
    Ok(())
}

fn reject_forbidden_value(
    value: Option<&Value>,
) -> Result<(), (StatusCode, Json<HistoryApiError>)> {
    let Some(value) = value else {
        return Ok(());
    };
    match value {
        Value::Object(map) => {
            for (key, entry) in map {
                if FORBIDDEN_THINKING_KEYS
                    .iter()
                    .any(|forbidden| forbidden == key)
                {
                    return Err(bad_request(
                        "FORBIDDEN_THINKING_PAYLOAD",
                        "History must not contain raw model thinking fields.",
                    ));
                }
                reject_forbidden_value(Some(entry))?;
            }
        }
        Value::Array(entries) => {
            for entry in entries {
                reject_forbidden_value(Some(entry))?;
            }
        }
        Value::String(text) => reject_forbidden_text(Some(text))?,
        _ => {}
    }
    Ok(())
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<HistoryApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(HistoryApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn storage_error(error: ServiceError) -> (StatusCode, Json<HistoryApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(HistoryApiError {
            code: "STORAGE_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}
