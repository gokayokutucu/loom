use crate::{
    api::state::AppState,
    capabilities::repository::{new_id, timestamp},
    error::ServiceError,
    storage::repositories::memory::{
        normalize_content, MemoryRecord, MemoryRepository, MemoryUpdate, NewMemory, NewMemoryEvent,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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

const SUPPORTED_MEMORY_TYPES: [&str; 2] = ["explicit_user_memory", "profile_preference"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMemoryQuery {
    pub query: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoryRequest {
    pub memory_type: String,
    pub content: String,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub user_confirmed: Option<bool>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryRequest {
    pub memory_type: Option<String>,
    pub content: Option<String>,
    pub source_loom_id: Option<Option<String>>,
    pub source_response_id: Option<Option<String>>,
    pub user_confirmed: Option<bool>,
    pub metadata: Option<Option<Value>>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDto {
    pub memory_id: String,
    pub memory_type: String,
    pub content: String,
    pub normalized_content: String,
    pub created_at: String,
    pub updated_at: String,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub user_confirmed: bool,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEnvelope {
    pub memory: MemoryDto,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryListResponse {
    pub memories: Vec<MemoryDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryApiError {
    pub code: String,
    pub message: String,
}

pub async fn list_memory(
    State(state): State<AppState>,
    Query(query): Query<ListMemoryQuery>,
) -> Result<Json<MemoryListResponse>, (StatusCode, Json<MemoryApiError>)> {
    reject_forbidden_text(query.query.as_deref())?;
    let repository = MemoryRepository::new(&state.database);
    let memories = repository
        .list_memories(query.query.as_deref())
        .await
        .map_err(storage_error)?;
    Ok(Json(MemoryListResponse {
        memories: memories.into_iter().map(memory_to_dto).collect(),
    }))
}

pub async fn get_memory(
    State(state): State<AppState>,
    Path(memory_id): Path<String>,
) -> Result<Json<MemoryEnvelope>, (StatusCode, Json<MemoryApiError>)> {
    let memory = MemoryRepository::new(&state.database)
        .get_memory(&memory_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;
    Ok(Json(MemoryEnvelope {
        memory: memory_to_dto(memory),
    }))
}

pub async fn create_memory(
    State(state): State<AppState>,
    Json(input): Json<CreateMemoryRequest>,
) -> Result<(StatusCode, Json<MemoryEnvelope>), (StatusCode, Json<MemoryApiError>)> {
    validate_memory_type(&input.memory_type)?;
    validate_content(&input.content)?;
    reject_forbidden_value(input.metadata.as_ref())?;
    reject_forbidden_text(input.source_loom_id.as_deref())?;
    reject_forbidden_text(input.source_response_id.as_deref())?;
    let metadata_json = metadata_json(input.metadata)?;
    let now = timestamp();
    let memory_id = new_id("memory");
    let repository = MemoryRepository::new(&state.database);
    repository
        .insert_memory(&NewMemory {
            memory_id: memory_id.clone(),
            memory_type: input.memory_type,
            normalized_content: normalize_content(&input.content),
            content: input.content,
            created_at: now.clone(),
            updated_at: now.clone(),
            source_loom_id: empty_string_to_none(input.source_loom_id),
            source_response_id: empty_string_to_none(input.source_response_id),
            user_confirmed: input.user_confirmed.unwrap_or(true),
            metadata_json,
        })
        .await
        .map_err(storage_error)?;
    insert_event(
        &repository,
        &memory_id,
        "created",
        json!({ "source": "memory_api" }),
    )
    .await?;
    let memory = repository
        .get_memory(&memory_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| storage_error(ServiceError::storage("created Memory was not found")))?;

    Ok((
        StatusCode::CREATED,
        Json(MemoryEnvelope {
            memory: memory_to_dto(memory),
        }),
    ))
}

pub async fn patch_memory(
    State(state): State<AppState>,
    Path(memory_id): Path<String>,
    Json(input): Json<UpdateMemoryRequest>,
) -> Result<Json<MemoryEnvelope>, (StatusCode, Json<MemoryApiError>)> {
    if let Some(memory_type) = &input.memory_type {
        validate_memory_type(memory_type)?;
    }
    if let Some(content) = &input.content {
        validate_content(content)?;
    }
    reject_forbidden_text(
        input
            .source_loom_id
            .as_ref()
            .and_then(|value| value.as_deref()),
    )?;
    reject_forbidden_text(
        input
            .source_response_id
            .as_ref()
            .and_then(|value| value.as_deref()),
    )?;
    if let Some(metadata) = &input.metadata {
        reject_forbidden_value(metadata.as_ref())?;
    }
    let content = input.content;
    let normalized_content = content.as_deref().map(normalize_content);
    let metadata_json = input
        .metadata
        .map(|metadata| metadata_json(metadata))
        .transpose()?;

    let repository = MemoryRepository::new(&state.database);
    let memory = repository
        .update_memory(
            &memory_id,
            MemoryUpdate {
                memory_type: input.memory_type,
                content,
                normalized_content,
                source_loom_id: input.source_loom_id.map(empty_string_to_none),
                source_response_id: input.source_response_id.map(empty_string_to_none),
                user_confirmed: input.user_confirmed,
                metadata_json,
            },
        )
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;
    insert_event(
        &repository,
        &memory_id,
        "updated",
        json!({ "source": "memory_api" }),
    )
    .await?;

    Ok(Json(MemoryEnvelope {
        memory: memory_to_dto(memory),
    }))
}

pub async fn delete_memory(
    State(state): State<AppState>,
    Path(memory_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<MemoryApiError>)> {
    let repository = MemoryRepository::new(&state.database);
    let deleted = repository
        .soft_delete_memory(&memory_id)
        .await
        .map_err(storage_error)?;
    if !deleted {
        return Err(not_found());
    }
    insert_event(
        &repository,
        &memory_id,
        "deleted",
        json!({ "source": "memory_api" }),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn memory_to_dto(memory: MemoryRecord) -> MemoryDto {
    MemoryDto {
        memory_id: memory.memory_id,
        memory_type: memory.memory_type,
        content: memory.content,
        normalized_content: memory.normalized_content,
        created_at: memory.created_at,
        updated_at: memory.updated_at,
        source_loom_id: memory.source_loom_id,
        source_response_id: memory.source_response_id,
        user_confirmed: memory.user_confirmed,
        metadata: parse_metadata(memory.metadata_json.as_deref()),
    }
}

async fn insert_event(
    repository: &MemoryRepository,
    memory_id: &str,
    event_type: &str,
    payload: Value,
) -> Result<(), (StatusCode, Json<MemoryApiError>)> {
    reject_forbidden_value(Some(&payload))?;
    repository
        .insert_event(&NewMemoryEvent {
            event_id: new_id("memory-event"),
            memory_id: memory_id.to_string(),
            event_type: event_type.to_string(),
            payload_json: serde_json::to_string(&payload).map_err(|error| {
                bad_request(
                    "INVALID_MEMORY_EVENT",
                    &format!("Invalid event payload: {error}"),
                )
            })?,
            created_at: timestamp(),
        })
        .await
        .map_err(storage_error)
}

fn metadata_json(
    metadata: Option<Value>,
) -> Result<Option<String>, (StatusCode, Json<MemoryApiError>)> {
    let Some(metadata) = metadata else {
        return Ok(None);
    };
    reject_forbidden_value(Some(&metadata))?;
    serde_json::to_string(&metadata)
        .map(Some)
        .map_err(|error| bad_request("INVALID_METADATA", &format!("Invalid metadata: {error}")))
}

fn parse_metadata(metadata_json: Option<&str>) -> Option<Value> {
    let metadata_json = metadata_json?;
    if contains_forbidden_text(metadata_json) {
        return None;
    }
    serde_json::from_str(metadata_json).ok()
}

fn validate_memory_type(memory_type: &str) -> Result<(), (StatusCode, Json<MemoryApiError>)> {
    if SUPPORTED_MEMORY_TYPES.contains(&memory_type) {
        return Ok(());
    }
    Err(bad_request(
        "INVALID_MEMORY_TYPE",
        "memoryType must be explicit_user_memory or profile_preference.",
    ))
}

fn validate_content(content: &str) -> Result<(), (StatusCode, Json<MemoryApiError>)> {
    if content.trim().is_empty() {
        return Err(bad_request(
            "EMPTY_MEMORY_CONTENT",
            "Memory content must not be empty.",
        ));
    }
    if content.chars().count() > 4_000 {
        return Err(bad_request(
            "MEMORY_CONTENT_TOO_LARGE",
            "Memory content must be 4000 characters or fewer.",
        ));
    }
    reject_forbidden_text(Some(content))
}

fn empty_string_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn reject_forbidden_value(value: Option<&Value>) -> Result<(), (StatusCode, Json<MemoryApiError>)> {
    let Some(value) = value else {
        return Ok(());
    };
    reject_forbidden_text(Some(&value.to_string()))
}

fn reject_forbidden_text(value: Option<&str>) -> Result<(), (StatusCode, Json<MemoryApiError>)> {
    let Some(value) = value else {
        return Ok(());
    };
    if contains_forbidden_text(value) {
        return Err(bad_request(
            "RAW_THINKING_REJECTED",
            "Memory payload contains forbidden raw thinking fields.",
        ));
    }
    Ok(())
}

fn contains_forbidden_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| lower.contains(&key.to_ascii_lowercase()))
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<MemoryApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(MemoryApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn not_found() -> (StatusCode, Json<MemoryApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(MemoryApiError {
            code: "MEMORY_NOT_FOUND".to_string(),
            message: "Memory was not found.".to_string(),
        }),
    )
}

fn storage_error(error: ServiceError) -> (StatusCode, Json<MemoryApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(MemoryApiError {
            code: "MEMORY_STORAGE_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        create_memory, delete_memory, get_memory, list_memory, patch_memory, CreateMemoryRequest,
        ListMemoryQuery, UpdateMemoryRequest,
    };
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::{db::test_database, repositories::memory::MemoryRepository},
    };
    use axum::{
        extract::{Path, Query, State},
        http::StatusCode,
        Json,
    };
    use serde_json::json;
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn memory_api_crud_preserves_provenance() {
        let state = test_state().await;
        insert_origin(&state.database).await;
        let created = create_memory(
            State(state.clone()),
            Json(CreateMemoryRequest {
                memory_type: "explicit_user_memory".to_string(),
                content: "The project codename is Blue Otter.".to_string(),
                source_loom_id: Some("loom-1".to_string()),
                source_response_id: Some("response-1".to_string()),
                user_confirmed: Some(true),
                metadata: Some(json!({ "savedFrom": "Loom X" })),
            }),
        )
        .await
        .expect("create memory");
        assert_eq!(created.0, StatusCode::CREATED);
        let memory_id = created.1 .0.memory.memory_id.clone();
        assert_eq!(
            created.1 .0.memory.source_response_id.as_deref(),
            Some("response-1")
        );
        assert!(created.1 .0.memory.user_confirmed);

        let listed = list_memory(
            State(state.clone()),
            Query(ListMemoryQuery {
                query: Some("blue otter".to_string()),
            }),
        )
        .await
        .expect("list memory")
        .0;
        assert_eq!(listed.memories.len(), 1);

        let patched = patch_memory(
            State(state.clone()),
            Path(memory_id.clone()),
            Json(UpdateMemoryRequest {
                memory_type: Some("profile_preference".to_string()),
                content: Some("Prefer concise Turkish answers.".to_string()),
                source_loom_id: None,
                source_response_id: None,
                user_confirmed: Some(true),
                metadata: None,
            }),
        )
        .await
        .expect("patch memory")
        .0;
        assert_eq!(patched.memory.memory_type, "profile_preference");
        assert_eq!(
            patched.memory.normalized_content,
            "prefer concise turkish answers."
        );

        let events = MemoryRepository::new(&state.database)
            .list_events(&memory_id)
            .await
            .expect("events");
        assert_eq!(events.len(), 2);

        let status = delete_memory(State(state.clone()), Path(memory_id.clone()))
            .await
            .expect("delete memory");
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(get_memory(State(state), Path(memory_id)).await.is_err());
    }

    #[tokio::test]
    async fn memory_api_rejects_raw_thinking_payloads() {
        let state = test_state().await;
        let error = create_memory(
            State(state),
            Json(CreateMemoryRequest {
                memory_type: "explicit_user_memory".to_string(),
                content: "chain_of_thought should never be stored".to_string(),
                source_loom_id: None,
                source_response_id: None,
                user_confirmed: Some(true),
                metadata: None,
            }),
        )
        .await
        .expect_err("raw thinking rejected");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "RAW_THINKING_REJECTED");
    }

    async fn test_state() -> AppState {
        AppState {
            database: test_database().await,
            ollama: OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            }),
            config: ConfigManager::new(
                PathBuf::from("/tmp/loom-service-memory-test.toml"),
                LoomServiceConfig::default(),
            ),
            secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
            agent_runs: Default::default(),
            tool_registry: std::sync::Arc::new(std::sync::RwLock::new(
                crate::agent_runtime::tool_registry::ToolRegistry::new(),
            )),
        }
    }

    async fn insert_origin(database: &crate::storage::db::Database) {
        sqlx::query(
            "INSERT INTO looms (
                loom_id, title, summary, code, canonical_uri, kind, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'loom', ?6, ?6)",
        )
        .bind("loom-1")
        .bind("Origin Loom")
        .bind("Origin summary")
        .bind("L-ORIGIN")
        .bind("loom://service/origin")
        .bind("2026-05-20T00:00:00Z")
        .execute(database.pool())
        .await
        .expect("insert origin Loom");

        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, code, canonical_uri,
                created_at, updated_at, sequence_index, metadata_json
            ) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7, ?7, 1, '{}')",
        )
        .bind("response-1")
        .bind("loom-1")
        .bind("Origin answer")
        .bind("Origin response")
        .bind("R-ORIGIN")
        .bind("loom://service/origin#response-1")
        .bind("2026-05-20T00:00:00Z")
        .execute(database.pool())
        .await
        .expect("insert origin Response");
    }
}
