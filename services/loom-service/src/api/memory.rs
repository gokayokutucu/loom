use crate::{
    api::state::AppState,
    capabilities::repository::{new_id, timestamp},
    error::ServiceError,
    storage::repositories::memory::{
        normalize_content, ExplicitMemoryCreateResult, ForgetMemoryResult, MemoryRecord,
        MemoryRepository, MemoryUpdate, NewMemory, NewMemoryEvent,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const FORBIDDEN_CONTENT_MARKERS: [&str; 19] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "rawThinking",
    "thinkingText",
    "chainOfThought",
    "hiddenReasoning",
    "provider_payload",
    "provider_delta",
    "prompt_envelope",
    "promptEnvelope",
    "authorization",
    "bearer ",
    "api_key",
    "apiKey",
    "credential",
    "secret",
    "raw_tool_output",
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
    pub memory_type: Option<String>,
    pub content: String,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub user_confirmed: Option<bool>,
    pub metadata: Option<Value>,
    pub supersedes_id: Option<String>,
    pub always_include: Option<bool>,
    pub origin_response_id: Option<String>,
    pub extraction_method: Option<String>,
    pub confidence: Option<f64>,
    pub topic_key: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryRequest {
    pub memory_type: Option<String>,
    pub content: Option<String>,
    pub source_loom_id: Option<Option<String>>,
    pub source_response_id: Option<Option<String>>,
    pub user_confirmed: Option<bool>,
    pub metadata: Option<Option<Value>>,
    pub supersedes_id: Option<Option<String>>,
    pub always_include: Option<bool>,
    pub origin_response_id: Option<Option<String>>,
    pub extraction_method: Option<Option<String>>,
    pub confidence: Option<Option<f64>>,
    pub topic_key: Option<Option<String>>,
}

#[derive(Debug, Serialize, PartialEq)]
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
    pub supersedes_id: Option<String>,
    pub always_include: bool,
    pub origin_response_id: Option<String>,
    pub extraction_method: Option<String>,
    pub confidence: Option<f64>,
    pub topic_key: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEnvelope {
    pub memory: MemoryDto,
    pub reused: bool,
}

#[derive(Debug, Serialize, PartialEq)]
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
        reused: false,
    }))
}

pub async fn create_memory(
    State(state): State<AppState>,
    Json(input): Json<CreateMemoryRequest>,
) -> Result<(StatusCode, Json<MemoryEnvelope>), (StatusCode, Json<MemoryApiError>)> {
    let memory_type = input
        .memory_type
        .unwrap_or_else(|| "explicit_user_memory".to_string());
    if input.user_confirmed == Some(false)
        || input
            .extraction_method
            .as_deref()
            .is_some_and(|method| method != "explicit")
        || input.confidence.is_some_and(|confidence| confidence != 1.0)
        || input
            .supersedes_id
            .as_deref()
            .is_some_and(|id| !id.trim().is_empty())
    {
        return Err(bad_request(
            "INVALID_EXPLICIT_MEMORY_FIELDS",
            "Explicit saves require user confirmation, explicit extraction, confidence 1.0, and no supersession.",
        ));
    }
    if input.always_include == Some(true) && memory_type == "inferred_preference" {
        return Err(bad_request(
            "INVALID_ALWAYS_INCLUDE",
            "alwaysInclude is allowed only for explicit user memory or profile preference.",
        ));
    }
    validate_memory_type(&memory_type)?;
    validate_content(&input.content)?;
    let normalized_content = normalize_content(&input.content);
    validate_content(&normalized_content)?;
    reject_forbidden_value(input.metadata.as_ref())?;
    reject_forbidden_text(input.source_loom_id.as_deref())?;
    reject_forbidden_text(input.source_response_id.as_deref())?;
    reject_forbidden_text(input.origin_response_id.as_deref())?;
    reject_forbidden_text(input.topic_key.as_deref())?;
    validate_topic_key(input.topic_key.as_deref())?;
    let metadata_json = metadata_json(input.metadata)?;
    let now = timestamp();
    let memory_id = new_id("memory");
    let source_response_id = empty_string_to_none(input.source_response_id);
    let origin_response_id =
        empty_string_to_none(input.origin_response_id).or_else(|| source_response_id.clone());
    let memory = NewMemory {
        memory_id: memory_id.clone(),
        memory_type,
        normalized_content,
        content: input.content,
        created_at: now.clone(),
        updated_at: now.clone(),
        source_loom_id: empty_string_to_none(input.source_loom_id),
        source_response_id,
        user_confirmed: true,
        metadata_json,
        supersedes_id: None,
        always_include: input.always_include.unwrap_or(false),
        origin_response_id,
        extraction_method: Some("explicit".to_string()),
        confidence: Some(1.0),
        topic_key: empty_string_to_none(input.topic_key),
    };
    let repository = MemoryRepository::new(&state.database);
    let result = repository
        .create_explicit_memory(
            &memory,
            &NewMemoryEvent {
                event_id: new_id("memory-event"),
                memory_id: memory_id.clone(),
                event_type: "explicit_created".to_string(),
                payload_json: json!({ "source": "memory_api", "operation": "explicit_save" })
                    .to_string(),
                created_at: now.clone(),
            },
            &NewMemoryEvent {
                event_id: new_id("memory-event"),
                memory_id: memory_id,
                event_type: "duplicate_skipped".to_string(),
                payload_json: json!({ "source": "memory_api", "operation": "exact_duplicate" })
                    .to_string(),
                created_at: now,
            },
            &NewMemoryEvent {
                event_id: new_id("memory-event"),
                memory_id: String::new(),
                event_type: "superseded".to_string(),
                payload_json: json!({
                    "source": "memory_api",
                    "operation": "topic_key_supersession"
                })
                .to_string(),
                created_at: timestamp(),
            },
        )
        .await
        .map_err(storage_error)?;
    let (memory, reused, status) = match result {
        ExplicitMemoryCreateResult::Created(memory) => (memory, false, StatusCode::CREATED),
        ExplicitMemoryCreateResult::Duplicate(memory) => (memory, true, StatusCode::OK),
    };

    Ok((
        status,
        Json(MemoryEnvelope {
            memory: memory_to_dto(memory),
            reused,
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
    if let Some(topic_key) = input.topic_key.as_ref().and_then(|value| value.as_deref()) {
        validate_topic_key(Some(topic_key))?;
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
    let current = repository
        .get_memory(&memory_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;
    let final_memory_type = input.memory_type.as_deref().unwrap_or(&current.memory_type);
    let final_user_confirmed = input.user_confirmed.unwrap_or(current.user_confirmed);
    let final_always_include = input.always_include.unwrap_or(current.always_include);
    validate_always_include(
        final_memory_type,
        final_user_confirmed,
        final_always_include,
    )?;
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
                supersedes_id: input.supersedes_id.map(empty_string_to_none),
                always_include: input.always_include,
                origin_response_id: input.origin_response_id.map(empty_string_to_none),
                extraction_method: input.extraction_method.map(empty_string_to_none),
                confidence: input.confidence,
                topic_key: input.topic_key.map(empty_string_to_none),
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
        reused: false,
    }))
}

pub async fn delete_memory(
    State(state): State<AppState>,
    Path(memory_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<MemoryApiError>)> {
    let repository = MemoryRepository::new(&state.database);
    let result = repository
        .forget_memory(
            &memory_id,
            &NewMemoryEvent {
                event_id: new_id("memory-event"),
                memory_id: memory_id.clone(),
                event_type: "explicit_forget".to_string(),
                payload_json: json!({
                    "source": "memory_api",
                    "operation": "explicit_forget",
                    "memoryId": memory_id
                })
                .to_string(),
                created_at: timestamp(),
            },
        )
        .await
        .map_err(storage_error)?;
    if result == ForgetMemoryResult::NotFound {
        return Err(not_found());
    }
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
        supersedes_id: memory.supersedes_id,
        always_include: memory.always_include,
        origin_response_id: memory.origin_response_id,
        extraction_method: memory.extraction_method,
        confidence: memory.confidence,
        topic_key: memory.topic_key,
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

fn validate_always_include(
    memory_type: &str,
    user_confirmed: bool,
    always_include: bool,
) -> Result<(), (StatusCode, Json<MemoryApiError>)> {
    if always_include
        && (!user_confirmed
            || !matches!(memory_type, "explicit_user_memory" | "profile_preference"))
    {
        return Err(bad_request(
            "INVALID_ALWAYS_INCLUDE",
            "alwaysInclude requires a confirmed explicit user Memory or profile preference.",
        ));
    }
    Ok(())
}

fn validate_topic_key(topic_key: Option<&str>) -> Result<(), (StatusCode, Json<MemoryApiError>)> {
    let Some(topic_key) = topic_key else {
        return Ok(());
    };
    if topic_key.is_empty()
        || !topic_key.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'.'
        })
        || topic_key.split('.').any(str::is_empty)
    {
        return Err(bad_request(
            "INVALID_TOPIC_KEY",
            "topicKey must contain lowercase dot-separated tokens using [a-z0-9_].",
        ));
    }
    Ok(())
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
            "MEMORY_SANITIZATION_REJECTED",
            "Memory payload contains forbidden private fields.",
        ));
    }
    Ok(())
}

fn contains_forbidden_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    FORBIDDEN_CONTENT_MARKERS
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
                memory_type: Some("explicit_user_memory".to_string()),
                content: "The project codename is Blue Otter.".to_string(),
                source_loom_id: Some("loom-1".to_string()),
                source_response_id: Some("response-1".to_string()),
                user_confirmed: Some(true),
                metadata: Some(json!({ "savedFrom": "Loom X" })),
                supersedes_id: None,
                always_include: None,
                origin_response_id: None,
                extraction_method: None,
                confidence: None,
                topic_key: None,
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
                supersedes_id: None,
                always_include: None,
                origin_response_id: None,
                extraction_method: None,
                confidence: None,
                topic_key: None,
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
        let second_status = delete_memory(State(state.clone()), Path(memory_id.clone()))
            .await
            .expect("idempotent delete memory");
        assert_eq!(second_status, StatusCode::NO_CONTENT);
        assert!(get_memory(State(state.clone()), Path(memory_id.clone()))
            .await
            .is_err());
        let stored = MemoryRepository::new(&state.database)
            .get_memory_any_status(&memory_id)
            .await
            .unwrap()
            .unwrap();
        assert!(stored.deleted_at.is_some());
        let events = MemoryRepository::new(&state.database)
            .list_events(&memory_id)
            .await
            .unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|event| event.event_type == "explicit_forget")
                .count(),
            1
        );
        let forget_event = events
            .iter()
            .find(|event| event.event_type == "explicit_forget")
            .unwrap();
        for forbidden in [
            "Prefer concise Turkish answers",
            "raw_thinking",
            "provider_payload",
            "secret",
        ] {
            assert!(!forget_event.payload_json.contains(forbidden));
        }
        assert!(
            list_memory(State(state), Query(ListMemoryQuery { query: None }))
                .await
                .unwrap()
                .0
                .memories
                .is_empty()
        );
    }

    #[tokio::test]
    async fn memory_api_rejects_raw_thinking_payloads() {
        let state = test_state().await;
        let error = create_memory(
            State(state),
            Json(CreateMemoryRequest {
                memory_type: Some("explicit_user_memory".to_string()),
                content: "chain_of_thought should never be stored".to_string(),
                source_loom_id: None,
                source_response_id: None,
                user_confirmed: Some(true),
                metadata: None,
                supersedes_id: None,
                always_include: None,
                origin_response_id: None,
                extraction_method: None,
                confidence: None,
                topic_key: None,
            }),
        )
        .await
        .expect_err("raw thinking rejected");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "MEMORY_SANITIZATION_REJECTED");
    }

    #[tokio::test]
    async fn explicit_save_applies_defaults_and_appends_safe_event() {
        let state = test_state().await;
        let created = create_memory(
            State(state.clone()),
            Json(explicit_request("Remember deterministic SQLite state.")),
        )
        .await
        .unwrap();
        assert_eq!(created.0, StatusCode::CREATED);
        assert!(!created.1 .0.reused);
        let memory = created.1 .0.memory;
        assert_eq!(memory.memory_type, "explicit_user_memory");
        assert!(memory.user_confirmed);
        assert!(!memory.always_include);
        assert_eq!(memory.extraction_method.as_deref(), Some("explicit"));
        assert_eq!(memory.confidence, Some(1.0));

        let events = MemoryRepository::new(&state.database)
            .list_events(&memory.memory_id)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "explicit_created");
        for forbidden in [
            "deterministic SQLite state",
            "raw_thinking",
            "provider_payload",
            "secret",
        ] {
            assert!(!events[0].payload_json.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn exact_duplicate_reuses_active_memory_in_same_scope() {
        let state = test_state().await;
        let first = create_memory(
            State(state.clone()),
            Json(explicit_request("Use compact response summaries.")),
        )
        .await
        .unwrap();
        let second = create_memory(
            State(state.clone()),
            Json(explicit_request("  Use   compact response summaries.  ")),
        )
        .await
        .unwrap();
        assert_eq!(second.0, StatusCode::OK);
        assert!(second.1 .0.reused);
        assert_eq!(second.1 .0.memory.memory_id, first.1 .0.memory.memory_id);
        assert_eq!(
            MemoryRepository::new(&state.database)
                .list_memories(None)
                .await
                .unwrap()
                .len(),
            1
        );
        let events = MemoryRepository::new(&state.database)
            .list_events(&first.1 .0.memory.memory_id)
            .await
            .unwrap();
        assert_eq!(events[1].event_type, "duplicate_skipped");
    }

    #[tokio::test]
    async fn explicit_save_accepts_allowed_always_include_and_caller_topic_key() {
        let state = test_state().await;
        for (memory_type, content) in [
            ("explicit_user_memory", "Always use SQLite authority."),
            ("profile_preference", "Always answer concisely."),
        ] {
            let mut request = explicit_request(content);
            request.memory_type = Some(memory_type.to_string());
            request.always_include = Some(true);
            request.topic_key = Some("response.style".to_string());
            let created = create_memory(State(state.clone()), Json(request))
                .await
                .unwrap();
            assert!(created.1 .0.memory.always_include);
            assert_eq!(
                created.1 .0.memory.topic_key.as_deref(),
                Some("response.style")
            );
        }

        let mut inferred = explicit_request("Do not promote inferred state.");
        inferred.memory_type = Some("inferred_preference".to_string());
        inferred.always_include = Some(true);
        let error = create_memory(State(state), Json(inferred))
            .await
            .unwrap_err();
        assert_eq!(error.1 .0.code, "INVALID_ALWAYS_INCLUDE");

        let state = test_state().await;
        let mut unconfirmed = explicit_request("Do not include unconfirmed state.");
        unconfirmed.always_include = Some(true);
        unconfirmed.user_confirmed = Some(false);
        let error = create_memory(State(state.clone()), Json(unconfirmed))
            .await
            .unwrap_err();
        assert_eq!(error.1 .0.code, "INVALID_EXPLICIT_MEMORY_FIELDS");

        let mut system_note = explicit_request("Do not include unsupported state.");
        system_note.memory_type = Some("system_note".to_string());
        system_note.always_include = Some(true);
        let error = create_memory(State(state), Json(system_note))
            .await
            .unwrap_err();
        assert_eq!(error.1 .0.code, "INVALID_MEMORY_TYPE");
    }

    #[tokio::test]
    async fn patch_validates_always_include_final_state() {
        let state = test_state().await;
        let created = create_memory(
            State(state.clone()),
            Json(explicit_request(
                "Keep this confirmed preference available.",
            )),
        )
        .await
        .unwrap();
        let memory_id = created.1 .0.memory.memory_id;
        let enabled = patch_memory(
            State(state.clone()),
            Path(memory_id.clone()),
            Json(UpdateMemoryRequest {
                always_include: Some(true),
                ..UpdateMemoryRequest::default()
            }),
        )
        .await
        .unwrap();
        assert!(enabled.0.memory.always_include);

        let error = patch_memory(
            State(state.clone()),
            Path(memory_id.clone()),
            Json(UpdateMemoryRequest {
                user_confirmed: Some(false),
                ..UpdateMemoryRequest::default()
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(error.1 .0.code, "INVALID_ALWAYS_INCLUDE");

        let events = MemoryRepository::new(&state.database)
            .list_events(&memory_id)
            .await
            .unwrap();
        let persisted = events
            .iter()
            .map(|event| event.payload_json.as_str())
            .collect::<Vec<_>>()
            .join("");
        for forbidden in [
            "Keep this confirmed preference available",
            "raw_thinking",
            "provider_payload",
            "secret",
        ] {
            assert!(!persisted.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn explicit_save_rejects_private_marker_categories_without_writes() {
        let state = test_state().await;
        for content in [
            "raw_thinking must not persist",
            "provider_payload must not persist",
            "Authorization Bearer credential secret must not persist",
            "raw_tool_output must not persist",
        ] {
            let error = create_memory(State(state.clone()), Json(explicit_request(content)))
                .await
                .unwrap_err();
            assert_eq!(error.1 .0.code, "MEMORY_SANITIZATION_REJECTED");
        }
        assert!(MemoryRepository::new(&state.database)
            .list_memories(None)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn forget_unknown_memory_returns_not_found() {
        let state = test_state().await;
        let error = delete_memory(State(state), Path("memory-missing".to_string()))
            .await
            .unwrap_err();
        assert_eq!(error.0, StatusCode::NOT_FOUND);
        assert_eq!(error.1 .0.code, "MEMORY_NOT_FOUND");
    }

    #[tokio::test]
    async fn exact_duplicate_can_be_created_again_after_forget() {
        let state = test_state().await;
        let first = create_memory(
            State(state.clone()),
            Json(explicit_request("Remember replaceable exact text.")),
        )
        .await
        .unwrap();
        delete_memory(
            State(state.clone()),
            Path(first.1 .0.memory.memory_id.clone()),
        )
        .await
        .unwrap();
        let replacement = create_memory(
            State(state.clone()),
            Json(explicit_request("Remember replaceable exact text.")),
        )
        .await
        .unwrap();
        assert_eq!(replacement.0, StatusCode::CREATED);
        assert!(!replacement.1 .0.reused);
        assert_ne!(
            replacement.1 .0.memory.memory_id,
            first.1 .0.memory.memory_id
        );
        assert_eq!(
            MemoryRepository::new(&state.database)
                .list_memories(None)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn topic_key_validation_accepts_only_lowercase_dot_separated_tokens() {
        let state = test_state().await;
        let mut valid = explicit_request("Prefer deterministic conflict handling.");
        valid.topic_key = Some("user.preference_style.v1".to_string());
        let created = create_memory(State(state.clone()), Json(valid))
            .await
            .unwrap();
        assert_eq!(
            created.1 .0.memory.topic_key.as_deref(),
            Some("user.preference_style.v1")
        );

        for topic_key in [
            "",
            "User.preference",
            "user preference",
            "user/preference",
            ".user.preference",
            "user.preference.",
            "user..preference",
        ] {
            let mut invalid = explicit_request("Reject invalid topic syntax.");
            invalid.topic_key = Some(topic_key.to_string());
            let error = create_memory(State(state.clone()), Json(invalid))
                .await
                .unwrap_err();
            assert_eq!(error.1 .0.code, "INVALID_TOPIC_KEY");
        }
    }

    #[tokio::test]
    async fn exact_duplicate_precedes_topic_key_supersession() {
        let state = test_state().await;
        let mut first = explicit_request("Use deterministic conflict ordering.");
        first.topic_key = Some("memory.conflict.order".to_string());
        let first = create_memory(State(state.clone()), Json(first))
            .await
            .unwrap();

        let mut duplicate = explicit_request("  Use deterministic conflict ordering.  ");
        duplicate.topic_key = Some("memory.conflict.replacement".to_string());
        let duplicate = create_memory(State(state.clone()), Json(duplicate))
            .await
            .unwrap();
        assert_eq!(duplicate.0, StatusCode::OK);
        assert!(duplicate.1 .0.reused);
        assert_eq!(duplicate.1 .0.memory.memory_id, first.1 .0.memory.memory_id);
        assert!(MemoryRepository::new(&state.database)
            .get_memory(&first.1 .0.memory.memory_id)
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn same_scope_topic_conflict_supersedes_atomically_without_inheriting_pin() {
        let state = test_state().await;
        let mut original = explicit_request("Prefer expanded explanations.");
        original.topic_key = Some("user.response.detail".to_string());
        original.always_include = Some(true);
        let original = create_memory(State(state.clone()), Json(original))
            .await
            .unwrap()
            .1
             .0
            .memory;
        insert_loom(&state.database, "loom-memory-conflict").await;
        sqlx::query(
            "INSERT INTO context_snapshots (
                snapshot_id, loom_id, created_at, policy_version, selection_version,
                budget_json, diagnostics_json, candidate_count, selected_count, rejected_count
             ) VALUES ('snapshot-memory-conflict', 'loom-memory-conflict', '1',
                       'policy-v1', 'selection-v1', '{}', '{}', 1, 1, 0)",
        )
        .execute(state.database.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO context_snapshot_candidates (
                snapshot_candidate_id, snapshot_id, source_kind, source_id, chunk_ref,
                tier, include_mode_hint, estimated_tokens, final_rank, is_mandatory,
                is_hidden_background, is_selected, metadata_json
             ) VALUES ('snapshot-memory-candidate', 'snapshot-memory-conflict', 'memory', ?1,
                       '', 'policy_always_include', 'full', 8, 1, 1, 0, 1, '{}')",
        )
        .bind(&original.memory_id)
        .execute(state.database.pool())
        .await
        .unwrap();

        let mut replacement = explicit_request("Prefer concise explanations.");
        replacement.memory_type = Some("profile_preference".to_string());
        replacement.topic_key = Some("user.response.detail".to_string());
        let replacement = create_memory(State(state.clone()), Json(replacement))
            .await
            .unwrap()
            .1
             .0
            .memory;
        assert_eq!(
            replacement.supersedes_id.as_deref(),
            Some(original.memory_id.as_str())
        );
        assert!(!replacement.always_include);
        let stored_old = MemoryRepository::new(&state.database)
            .get_memory_any_status(&original.memory_id)
            .await
            .unwrap()
            .unwrap();
        assert!(stored_old.deleted_at.is_some());
        assert!(MemoryRepository::new(&state.database)
            .get_memory(&replacement.memory_id)
            .await
            .unwrap()
            .is_some());
        let active = list_memory(State(state.clone()), Query(ListMemoryQuery { query: None }))
            .await
            .unwrap()
            .0;
        assert_eq!(active.memories.len(), 1);
        assert_eq!(active.memories[0].memory_id, replacement.memory_id);
        let snapshot_source = sqlx::query_scalar::<_, String>(
            "SELECT source_id FROM context_snapshot_candidates
             WHERE snapshot_candidate_id = 'snapshot-memory-candidate'",
        )
        .fetch_one(state.database.pool())
        .await
        .unwrap();
        assert_eq!(snapshot_source, original.memory_id);

        let events = MemoryRepository::new(&state.database)
            .list_events(&original.memory_id)
            .await
            .unwrap();
        let superseded = events
            .iter()
            .find(|event| event.event_type == "superseded")
            .unwrap();
        for forbidden in [
            "expanded explanations",
            "concise explanations",
            "raw_thinking",
            "provider_payload",
            "secret",
        ] {
            assert!(!superseded.payload_json.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn topic_conflicts_are_isolated_by_exact_scope_including_global() {
        let state = test_state().await;
        insert_loom(&state.database, "loom-scope-a").await;
        insert_loom(&state.database, "loom-scope-b").await;
        for (content, loom_id) in [
            ("Global response preference.", None),
            ("Loom A response preference.", Some("loom-scope-a")),
            ("Loom B response preference.", Some("loom-scope-b")),
        ] {
            let mut request = explicit_request(content);
            request.topic_key = Some("user.response.scope".to_string());
            request.source_loom_id = loom_id.map(str::to_string);
            let _ = create_memory(State(state.clone()), Json(request))
                .await
                .unwrap();
        }
        let active = MemoryRepository::new(&state.database)
            .list_memories(None)
            .await
            .unwrap();
        assert_eq!(active.len(), 3);
        assert!(active.iter().all(|memory| memory.supersedes_id.is_none()));
    }

    #[tokio::test]
    async fn forgotten_topic_key_does_not_block_new_explicit_save() {
        let state = test_state().await;
        let mut original = explicit_request("Remember the first scoped preference.");
        original.topic_key = Some("user.preference.reusable".to_string());
        let original = create_memory(State(state.clone()), Json(original))
            .await
            .unwrap()
            .1
             .0
            .memory;
        delete_memory(State(state.clone()), Path(original.memory_id.clone()))
            .await
            .unwrap();

        let mut replacement = explicit_request("Remember the replacement scoped preference.");
        replacement.topic_key = Some("user.preference.reusable".to_string());
        let replacement = create_memory(State(state), Json(replacement))
            .await
            .unwrap()
            .1
             .0
            .memory;
        assert!(replacement.supersedes_id.is_none());
    }

    #[test]
    fn explicit_pipeline_does_not_depend_on_generation_or_quick_ask() {
        let source = include_str!("memory.rs");
        assert!(!source.contains(&["api", "::orchestration"].concat()));
        assert!(!source.contains(&["api", "::ask"].concat()));
    }

    fn explicit_request(content: &str) -> CreateMemoryRequest {
        CreateMemoryRequest {
            memory_type: None,
            content: content.to_string(),
            source_loom_id: None,
            source_response_id: None,
            user_confirmed: None,
            metadata: None,
            supersedes_id: None,
            always_include: None,
            origin_response_id: None,
            extraction_method: None,
            confidence: None,
            topic_key: None,
        }
    }

    async fn test_state() -> AppState {
        let database = test_database().await;
        let agent_run_repository =
            crate::storage::repositories::agent_runs::AgentRunRepository::from_pool(
                database.pool(),
            );
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
                PathBuf::from("/tmp/loom-service-memory-test.toml"),
                LoomServiceConfig::default(),
            ),
            secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
            agent_runs: Default::default(),
            agent_run_repository,
            tool_registry: std::sync::Arc::new(std::sync::RwLock::new(
                crate::agent_runtime::tool_registry::ToolRegistry::new(),
            )),
        }
    }

    async fn insert_loom(database: &crate::storage::db::Database, loom_id: &str) {
        sqlx::query(
            "INSERT INTO looms (loom_id, title, canonical_uri, kind, created_at, updated_at)
             VALUES (?1, ?1, ?2, 'loom', '1', '1')",
        )
        .bind(loom_id)
        .bind(format!("/loom/{loom_id}"))
        .execute(database.pool())
        .await
        .unwrap();
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
