use crate::{
    display_code::{display_code, DisplayCodeKind},
    error::ServiceError,
    storage::repositories::responses::{ResponseRecord, ResponseRepository},
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

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
pub struct PatchResponseRequest {
    pub content: Option<String>,
    pub metadata: Option<Value>,
    pub edit_reason: Option<String>,
    pub mark_downstream_stale: Option<bool>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PatchResponseResponse {
    pub response: ResponseDto,
    pub stale_responses: Vec<StaleResponseDto>,
    pub deleted_responses: Vec<DeletedResponseDto>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResponseDto {
    pub response_id: String,
    pub loom_id: String,
    pub role: String,
    pub content: String,
    pub display_code: String,
    pub updated_at: String,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StaleResponseDto {
    pub response_id: String,
    pub role: String,
    pub stale: bool,
    pub stale_reason: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeletedResponseDto {
    pub response_id: String,
    pub role: String,
    pub deleted: bool,
    pub deleted_reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseApiError {
    pub code: String,
    pub message: String,
}

pub async fn patch_response(
    State(state): State<crate::api::state::AppState>,
    Path(response_id): Path<String>,
    Json(input): Json<PatchResponseRequest>,
) -> Result<Json<PatchResponseResponse>, (StatusCode, Json<ResponseApiError>)> {
    validate_metadata(input.metadata.as_ref())?;
    if let Some(content) = input.content.as_deref() {
        if contains_forbidden_text(content) {
            return Err(bad_request(
                "RAW_THINKING_REJECTED",
                "Response content contains forbidden raw thinking fields.",
            ));
        }
        if content.trim().is_empty() {
            return Err(bad_request(
                "INVALID_RESPONSE",
                "Response content cannot be empty.",
            ));
        }
    }

    let repository = ResponseRepository::new(&state.database);
    let existing = repository
        .get_response(&response_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| not_found("RESPONSE_NOT_FOUND", "Response was not found."))?;
    if existing.role != "user" {
        return Err(bad_request(
            "UNSUPPORTED_RESPONSE_EDIT",
            "Only user prompt Responses can be edited.",
        ));
    }

    let now = timestamp();
    let metadata_json = edited_metadata_json(
        existing.metadata_json.as_deref(),
        input.metadata,
        input.edit_reason.as_deref().unwrap_or("user_prompt_edit"),
        &now,
    )?;
    repository
        .update_response_content_and_metadata(
            &response_id,
            input.content.as_deref().map(str::trim),
            &metadata_json,
            &now,
        )
        .await
        .map_err(storage_error)?;

    let stale_responses = Vec::new();
    let mut deleted_responses = Vec::new();
    if input.mark_downstream_stale.unwrap_or(true) {
        deleted_responses = repository
            .soft_delete_responses_after(
                &existing.loom_id,
                existing.sequence_index,
                "prompt_edited",
                &response_id,
            )
            .await
            .map_err(storage_error)?
            .into_iter()
            .map(|response| DeletedResponseDto {
                response_id: response.response_id,
                role: response.role,
                deleted: true,
                deleted_reason: "prompt_edited".to_string(),
            })
            .collect();
    }

    let updated = repository
        .get_response(&response_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| storage_error(ServiceError::storage("updated Response was not found")))?;

    Ok(Json(PatchResponseResponse {
        response: response_to_dto(updated),
        stale_responses,
        deleted_responses,
    }))
}

fn response_to_dto(response: ResponseRecord) -> ResponseDto {
    let display_code = display_code(DisplayCodeKind::Response, &response.response_id);
    ResponseDto {
        response_id: response.response_id,
        loom_id: response.loom_id,
        role: response.role,
        content: response.content,
        display_code,
        updated_at: response.updated_at,
        metadata: response
            .metadata_json
            .as_deref()
            .and_then(|metadata| serde_json::from_str(metadata).ok()),
    }
}

fn edited_metadata_json(
    existing_metadata_json: Option<&str>,
    patch: Option<Value>,
    edit_reason: &str,
    edited_at: &str,
) -> Result<String, (StatusCode, Json<ResponseApiError>)> {
    let mut object = metadata_object(existing_metadata_json)?;
    if let Some(patch) = patch {
        let patch = patch_object(patch)?;
        for (key, value) in patch {
            object.insert(key, value);
        }
    }
    let edit_count = object.get("editCount").and_then(Value::as_u64).unwrap_or(0) + 1;
    object.insert("edited".to_string(), Value::Bool(true));
    object.insert("editedAt".to_string(), Value::String(edited_at.to_string()));
    object.insert("editCount".to_string(), Value::from(edit_count));
    object.insert(
        "editReason".to_string(),
        Value::String(edit_reason.to_string()),
    );
    serialize_metadata(object)
}

fn metadata_object(
    existing_metadata_json: Option<&str>,
) -> Result<Map<String, Value>, (StatusCode, Json<ResponseApiError>)> {
    let Some(existing) = existing_metadata_json else {
        return Ok(Map::new());
    };
    let value = serde_json::from_str::<Value>(existing).map_err(|error| {
        bad_request(
            "INVALID_METADATA",
            &format!("Existing Response metadata is invalid JSON: {error}"),
        )
    })?;
    patch_object(value)
}

fn patch_object(value: Value) -> Result<Map<String, Value>, (StatusCode, Json<ResponseApiError>)> {
    validate_metadata(Some(&value))?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(bad_request(
            "INVALID_METADATA",
            "Response metadata must be a JSON object.",
        )),
    }
}

fn serialize_metadata(
    object: Map<String, Value>,
) -> Result<String, (StatusCode, Json<ResponseApiError>)> {
    let value = Value::Object(object);
    validate_metadata(Some(&value))?;
    serde_json::to_string(&value).map_err(|error| {
        bad_request(
            "INVALID_METADATA",
            &format!("Response metadata must be JSON serializable: {error}"),
        )
    })
}

fn validate_metadata(metadata: Option<&Value>) -> Result<(), (StatusCode, Json<ResponseApiError>)> {
    let Some(metadata) = metadata else {
        return Ok(());
    };
    if contains_forbidden_key(metadata) {
        return Err(bad_request(
            "RAW_THINKING_REJECTED",
            "Response metadata contains forbidden raw thinking fields.",
        ));
    }
    Ok(())
}

fn contains_forbidden_key(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, value)| {
            FORBIDDEN_THINKING_KEYS.contains(&key.as_str()) || contains_forbidden_key(value)
        }),
        Value::Array(values) => values.iter().any(contains_forbidden_key),
        Value::String(value) => contains_forbidden_text(value),
        _ => false,
    }
}

fn contains_forbidden_text(value: &str) -> bool {
    FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| value.contains(key))
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<ResponseApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ResponseApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn not_found(code: &str, message: &str) -> (StatusCode, Json<ResponseApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(ResponseApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn storage_error(error: ServiceError) -> (StatusCode, Json<ResponseApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ResponseApiError {
            code: "RESPONSE_STORAGE_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::{patch_response, PatchResponseRequest};
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::{
            db::test_database,
            repositories::{
                looms::{LoomRepository, NewLoom},
                responses::{NewResponse, ResponseRepository},
            },
        },
    };
    use axum::{
        extract::{Path, State},
        http::StatusCode,
        Json,
    };
    use serde_json::json;
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn patch_user_response_updates_content_and_soft_deletes_downstream() {
        let state = seeded_state().await;
        let response = patch_response(
            State(state.clone()),
            Path("user-1".to_string()),
            Json(PatchResponseRequest {
                content: Some("Edited prompt".to_string()),
                metadata: None,
                edit_reason: Some("user_prompt_edit".to_string()),
                mark_downstream_stale: Some(true),
            }),
        )
        .await
        .expect("patch response")
        .0;

        assert_eq!(response.response.content, "Edited prompt");
        assert!(response.stale_responses.is_empty());
        assert_eq!(response.deleted_responses.len(), 1);
        assert_eq!(response.deleted_responses[0].response_id, "assistant-1");
        assert_eq!(
            response.deleted_responses[0].deleted_reason,
            "prompt_edited"
        );

        let repository = ResponseRepository::new(&state.database);
        let user = repository
            .get_response("user-1")
            .await
            .expect("get user")
            .expect("user exists");
        assert_eq!(user.sequence_index, 0);
        let user_metadata: serde_json::Value =
            serde_json::from_str(user.metadata_json.as_deref().expect("metadata"))
                .expect("metadata json");
        assert_eq!(user_metadata["edited"], json!(true));
        assert_eq!(user_metadata["editCount"], json!(1));
        assert_eq!(user_metadata["questionReferences"][0]["id"], json!("ref-1"));

        let assistant = repository
            .get_response("assistant-1")
            .await
            .expect("get assistant")
            .expect("assistant exists");
        assert_eq!(assistant.content, "Original answer");
        assert!(repository
            .is_response_deleted("assistant-1")
            .await
            .expect("assistant deletion state"));
        let active = repository
            .list_responses_for_loom("loom-1")
            .await
            .expect("active responses");
        assert_eq!(
            active
                .iter()
                .map(|response| response.response_id.as_str())
                .collect::<Vec<_>>(),
            vec!["user-1"]
        );
    }

    #[tokio::test]
    async fn patch_assistant_response_is_rejected() {
        let state = seeded_state().await;
        let error = patch_response(
            State(state),
            Path("assistant-1".to_string()),
            Json(PatchResponseRequest {
                content: Some("Edited answer".to_string()),
                metadata: None,
                edit_reason: Some("user_prompt_edit".to_string()),
                mark_downstream_stale: Some(true),
            }),
        )
        .await
        .expect_err("assistant edit should fail");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "UNSUPPORTED_RESPONSE_EDIT");
    }

    #[tokio::test]
    async fn patch_response_rejects_forbidden_raw_thinking_metadata() {
        let state = seeded_state().await;
        let error = patch_response(
            State(state),
            Path("user-1".to_string()),
            Json(PatchResponseRequest {
                content: Some("Edited prompt".to_string()),
                metadata: Some(json!({ "raw_thinking": "hidden" })),
                edit_reason: Some("user_prompt_edit".to_string()),
                mark_downstream_stale: Some(true),
            }),
        )
        .await
        .expect_err("raw thinking should fail");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "RAW_THINKING_REJECTED");
    }

    #[tokio::test]
    async fn patch_missing_response_returns_not_found() {
        let state = seeded_state().await;
        let error = patch_response(
            State(state),
            Path("missing".to_string()),
            Json(PatchResponseRequest {
                content: Some("Edited prompt".to_string()),
                metadata: None,
                edit_reason: Some("user_prompt_edit".to_string()),
                mark_downstream_stale: Some(true),
            }),
        )
        .await
        .expect_err("missing should fail");

        assert_eq!(error.0, StatusCode::NOT_FOUND);
        assert_eq!(error.1 .0.code, "RESPONSE_NOT_FOUND");
    }

    async fn seeded_state() -> AppState {
        let state = AppState {
            database: test_database().await,
            ollama: OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            }),
            config: ConfigManager::new(
                PathBuf::from("/tmp/loom-service-response-test.toml"),
                LoomServiceConfig::default(),
            ),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        };
        LoomRepository::new(&state.database)
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Test Loom".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");
        let repository = ResponseRepository::new(&state.database);
        repository
            .insert_response(&NewResponse {
                response_id: "user-1".to_string(),
                loom_id: "loom-1".to_string(),
                role: "user".to_string(),
                content: "Original prompt".to_string(),
                title: Some("Prompt".to_string()),
                code: None,
                canonical_uri: None,
                created_at: "2026-05-08T00:00:01Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
                sequence_index: 0,
                metadata_json: Some(
                    json!({
                        "questionReferences": [
                            { "id": "ref-1", "selectedText": "fragment" }
                        ]
                    })
                    .to_string(),
                ),
            })
            .await
            .expect("insert user");
        repository
            .insert_response(&NewResponse {
                response_id: "assistant-1".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Original answer".to_string(),
                title: Some("Answer".to_string()),
                code: None,
                canonical_uri: None,
                created_at: "2026-05-08T00:00:02Z".to_string(),
                updated_at: "2026-05-08T00:00:02Z".to_string(),
                sequence_index: 1,
                metadata_json: Some(json!({ "status": "completed" }).to_string()),
            })
            .await
            .expect("insert assistant");
        state
    }
}
