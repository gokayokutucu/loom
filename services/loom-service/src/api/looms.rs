use crate::{
    api::state::AppState,
    display_code::{display_code, DisplayCodeKind},
    error::ServiceError,
    storage::repositories::{
        addresses::{AddressRepository, NewAddress, NewAddressAlias},
        code_blocks::{ResponseCodeBlockRecord, ResponseCodeBlockRepository},
        looms::{LoomMetadataUpdate, LoomRecord, LoomRepository, NewLoom},
        responses::{ResponseOutlineRecord, ResponseRecord, ResponseRepository},
    },
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

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
pub struct CreateLoomRequest {
    pub loom_id: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub kind: Option<String>,
    pub origin_loom_id: Option<String>,
    pub origin_response_id: Option<String>,
    pub canonical_uri: Option<String>,
    pub code: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLoomRequest {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub canonical_uri: Option<String>,
    pub code: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListLoomsQuery {
    pub archived: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptQuery {
    pub cursor: Option<i64>,
    pub direction: Option<String>,
    pub limit: Option<i64>,
    pub target_response_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoomResponse {
    pub loom: LoomDto,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoomListResponse {
    pub looms: Vec<LoomDto>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoomDto {
    pub loom_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub kind: String,
    pub origin_loom_id: Option<String>,
    pub origin_response_id: Option<String>,
    pub canonical_uri: Option<String>,
    pub code: Option<String>,
    pub display_code: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub metadata: Option<Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub responses: Vec<ResponseDto>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResponseDto {
    pub response_id: String,
    pub loom_id: String,
    pub role: String,
    pub content: String,
    pub title: Option<String>,
    pub code: Option<String>,
    pub display_code: String,
    pub canonical_uri: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub sequence_index: i64,
    pub metadata: Option<Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub code_blocks: Vec<ResponseCodeBlockDto>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResponseCodeBlockDto {
    pub code_block_id: String,
    pub block_index: i64,
    pub language: Option<String>,
    pub code: String,
    pub exact_hash: String,
    pub fence: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoomTranscriptPageResponse {
    pub loom_id: String,
    pub items: Vec<ResponseDto>,
    pub has_older: bool,
    pub has_newer: bool,
    pub oldest_cursor: Option<i64>,
    pub newest_cursor: Option<i64>,
    pub total_known_count: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoomTranscriptOutlineResponse {
    pub loom_id: String,
    pub items: Vec<ResponseOutlineDto>,
    pub total_known_count: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResponseOutlineDto {
    pub response_id: String,
    pub loom_id: String,
    pub role: String,
    pub title: Option<String>,
    pub preview: String,
    pub canonical_uri: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub sequence_index: i64,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomApiError {
    pub code: String,
    pub message: String,
}

pub async fn list_looms(
    State(state): State<AppState>,
    Query(query): Query<ListLoomsQuery>,
) -> Result<Json<LoomListResponse>, (StatusCode, Json<LoomApiError>)> {
    let repository = LoomRepository::new(&state.database);
    let looms = if query.archived.unwrap_or(false) {
        repository.list_archived_looms().await
    } else {
        repository.list_looms().await
    }
    .map_err(storage_error)?;
    Ok(Json(LoomListResponse {
        looms: looms
            .into_iter()
            .map(|loom| loom_to_dto(loom, Vec::new()))
            .collect(),
    }))
}

pub async fn get_loom(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<Json<LoomResponse>, (StatusCode, Json<LoomApiError>)> {
    let looms = LoomRepository::new(&state.database);
    let Some(loom) = looms.get_loom(&loom_id).await.map_err(storage_error)? else {
        return Err(not_found());
    };
    if loom.is_deleted {
        return Err(not_found());
    }
    let response_records = ResponseRepository::new(&state.database)
        .list_responses_for_loom(&loom_id)
        .await
        .map_err(storage_error)?;
    let code_blocks = ResponseCodeBlockRepository::new(&state.database)
        .list_by_loom(&loom_id)
        .await
        .map_err(storage_error)?;
    let responses = responses_to_dtos(response_records, code_blocks);

    Ok(Json(LoomResponse {
        loom: loom_to_dto(loom, responses),
    }))
}

pub async fn get_loom_transcript_page(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
    Query(query): Query<TranscriptQuery>,
) -> Result<Json<LoomTranscriptPageResponse>, (StatusCode, Json<LoomApiError>)> {
    ensure_active_loom(&state, &loom_id).await?;
    let responses = ResponseRepository::new(&state.database);
    let limit_pairs = query.limit.unwrap_or(20).clamp(1, 100);
    let row_limit = limit_pairs.saturating_mul(2);
    let direction = query.direction.as_deref().unwrap_or("latest");
    let response_records = match direction {
        "latest" => responses
            .list_latest_responses_for_loom(&loom_id, row_limit)
            .await
            .map_err(storage_error)?,
        "older" => responses
            .list_responses_before_sequence(
                &loom_id,
                query.cursor.ok_or_else(|| {
                    bad_request(
                        "INVALID_TRANSCRIPT_CURSOR",
                        "Older transcript pages require a cursor.",
                    )
                })?,
                row_limit,
            )
            .await
            .map_err(storage_error)?,
        "newer" => responses
            .list_responses_after_sequence(
                &loom_id,
                query.cursor.ok_or_else(|| {
                    bad_request(
                        "INVALID_TRANSCRIPT_CURSOR",
                        "Newer transcript pages require a cursor.",
                    )
                })?,
                row_limit,
            )
            .await
            .map_err(storage_error)?,
        "around" => responses
            .list_responses_around_response(
                &loom_id,
                query.target_response_id.as_deref().ok_or_else(|| {
                    bad_request(
                        "INVALID_TRANSCRIPT_TARGET",
                        "Around transcript pages require targetResponseId.",
                    )
                })?,
                row_limit,
            )
            .await
            .map_err(storage_error)?,
        _ => {
            return Err(bad_request(
                "INVALID_TRANSCRIPT_DIRECTION",
                "Transcript direction must be latest, older, newer, or around.",
            ));
        }
    };

    let oldest_cursor = response_records
        .first()
        .map(|response| response.sequence_index);
    let newest_cursor = response_records
        .last()
        .map(|response| response.sequence_index);
    let has_older = match oldest_cursor {
        Some(cursor) => responses
            .has_active_response_before(&loom_id, cursor)
            .await
            .map_err(storage_error)?,
        None => false,
    };
    let has_newer = match newest_cursor {
        Some(cursor) => responses
            .has_active_response_after(&loom_id, cursor)
            .await
            .map_err(storage_error)?,
        None => false,
    };
    let total_known_count = responses
        .count_active_assistant_responses_for_loom(&loom_id)
        .await
        .map_err(storage_error)?;
    let code_blocks = ResponseCodeBlockRepository::new(&state.database)
        .list_by_loom(&loom_id)
        .await
        .map_err(storage_error)?;
    Ok(Json(LoomTranscriptPageResponse {
        loom_id,
        items: responses_to_dtos(response_records, code_blocks),
        has_older,
        has_newer,
        oldest_cursor,
        newest_cursor,
        total_known_count,
    }))
}

pub async fn get_loom_transcript_outline(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<Json<LoomTranscriptOutlineResponse>, (StatusCode, Json<LoomApiError>)> {
    ensure_active_loom(&state, &loom_id).await?;
    let responses = ResponseRepository::new(&state.database);
    let outline = responses
        .list_response_outline_for_loom(&loom_id)
        .await
        .map_err(storage_error)?;
    let total_known_count = responses
        .count_active_assistant_responses_for_loom(&loom_id)
        .await
        .map_err(storage_error)?;
    Ok(Json(LoomTranscriptOutlineResponse {
        loom_id,
        items: outline.into_iter().map(response_outline_to_dto).collect(),
        total_known_count,
    }))
}

pub async fn create_loom(
    State(state): State<AppState>,
    Json(input): Json<CreateLoomRequest>,
) -> Result<(StatusCode, Json<LoomResponse>), (StatusCode, Json<LoomApiError>)> {
    validate_metadata(input.metadata.as_ref())?;
    let title = required_trimmed("title", &input.title)?;
    let kind = input.kind.unwrap_or_else(|| "loom".to_string());
    validate_kind(&kind)?;
    if kind == "weft" && (input.origin_loom_id.is_none() || input.origin_response_id.is_none()) {
        return Err(bad_request(
            "INVALID_WEFT_ORIGIN",
            "Weft Loom creation requires originLoomId and originResponseId.",
        ));
    }

    let loom_id = input.loom_id.unwrap_or_else(generate_loom_id);
    let now = timestamp();
    let metadata_json = metadata_json(input.metadata)?;
    let looms = LoomRepository::new(&state.database);
    let inserted = looms
        .insert_loom_if_missing(&NewLoom {
            loom_id: loom_id.clone(),
            title,
            summary: input.summary,
            code: input.code,
            canonical_uri: input.canonical_uri.clone(),
            kind: kind.clone(),
            origin_loom_id: input.origin_loom_id,
            origin_response_id: input.origin_response_id,
            created_at: now.clone(),
            updated_at: now.clone(),
            metadata_json,
        })
        .await
        .map_err(storage_error)?;

    let Some(loom) = looms.get_loom(&loom_id).await.map_err(storage_error)? else {
        return Err(storage_error(ServiceError::storage(
            "created Loom was not found",
        )));
    };

    if inserted {
        if let Some(canonical_uri) = loom.canonical_uri.as_deref() {
            insert_canonical_address(&state.database, &loom, canonical_uri, &now).await?;
        }
    }

    let status = if inserted {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((
        status,
        Json(LoomResponse {
            loom: loom_to_dto(loom, Vec::new()),
        }),
    ))
}

pub async fn patch_loom(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
    Json(input): Json<UpdateLoomRequest>,
) -> Result<Json<LoomResponse>, (StatusCode, Json<LoomApiError>)> {
    validate_metadata(input.metadata.as_ref())?;
    let looms = LoomRepository::new(&state.database);
    let Some(existing) = looms.get_loom(&loom_id).await.map_err(storage_error)? else {
        return Err(not_found());
    };
    if existing.is_deleted {
        return Err(not_found());
    }
    let canonical_uri = input.canonical_uri.clone();
    let now = timestamp();

    if let Some(canonical_uri) = canonical_uri.as_deref() {
        validate_canonical_address_available(&state.database, &existing, canonical_uri).await?;
    }

    let Some(updated) = looms
        .update_loom_metadata(
            &loom_id,
            &LoomMetadataUpdate {
                title: input.title,
                summary: input.summary,
                code: input.code,
                canonical_uri: input.canonical_uri,
                metadata_json: metadata_json(input.metadata)?,
                updated_at: now.clone(),
            },
        )
        .await
        .map_err(storage_error)?
    else {
        return Err(not_found());
    };

    if let Some(canonical_uri) = canonical_uri.as_deref() {
        insert_canonical_address(&state.database, &updated, canonical_uri, &now).await?;
        if existing.canonical_uri.as_deref() != Some(canonical_uri) {
            if let Some(old_canonical_uri) = existing.canonical_uri.as_deref() {
                insert_stale_alias(
                    &state.database,
                    &updated,
                    old_canonical_uri,
                    canonical_uri,
                    &now,
                )
                .await?;
            }
        }
    }

    Ok(Json(LoomResponse {
        loom: loom_to_dto(updated, Vec::new()),
    }))
}

pub async fn archive_loom(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<Json<LoomResponse>, (StatusCode, Json<LoomApiError>)> {
    let Some(loom) = LoomRepository::new(&state.database)
        .archive_loom(&loom_id, &timestamp())
        .await
        .map_err(storage_error)?
    else {
        return Err(not_found());
    };
    if loom.is_deleted {
        return Err(not_found());
    }

    Ok(Json(LoomResponse {
        loom: loom_to_dto(loom, Vec::new()),
    }))
}

pub async fn restore_loom(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<Json<LoomResponse>, (StatusCode, Json<LoomApiError>)> {
    let Some(loom) = LoomRepository::new(&state.database)
        .restore_loom(&loom_id, &timestamp())
        .await
        .map_err(storage_error)?
    else {
        return Err(not_found());
    };
    if loom.is_deleted {
        return Err(not_found());
    }

    Ok(Json(LoomResponse {
        loom: loom_to_dto(loom, Vec::new()),
    }))
}

pub async fn delete_loom(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<LoomApiError>)> {
    let deleted = LoomRepository::new(&state.database)
        .soft_delete_loom_tree(&loom_id, "permanent_delete", &timestamp())
        .await
        .map_err(storage_error)?;
    if deleted.is_empty() {
        return Err(not_found());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn validate_canonical_address_available(
    database: &crate::storage::db::Database,
    loom: &LoomRecord,
    canonical_uri: &str,
) -> Result<(), (StatusCode, Json<LoomApiError>)> {
    let addresses = AddressRepository::new(database);
    if let Some(existing) = addresses
        .resolve_address(canonical_uri)
        .await
        .map_err(storage_error)?
    {
        if existing.object_kind != loom.kind && existing.object_kind != "loom" {
            return Err(conflict(
                "CANONICAL_URI_IN_USE",
                "Canonical URI already belongs to another object.",
            ));
        }
        if existing.object_id != loom.loom_id {
            return Err(conflict(
                "CANONICAL_URI_IN_USE",
                "Canonical URI already belongs to another Loom.",
            ));
        }
    }
    Ok(())
}

async fn insert_canonical_address(
    database: &crate::storage::db::Database,
    loom: &LoomRecord,
    canonical_uri: &str,
    now: &str,
) -> Result<(), (StatusCode, Json<LoomApiError>)> {
    validate_canonical_address_available(database, loom, canonical_uri).await?;
    AddressRepository::new(database)
        .insert_address_if_missing(&NewAddress {
            address_id: format!(
                "address-loom-{}-{}",
                loom.loom_id,
                stable_suffix(canonical_uri)
            ),
            object_kind: loom.kind.clone(),
            object_id: loom.loom_id.clone(),
            canonical_uri: canonical_uri.to_string(),
            created_at: now.to_string(),
        })
        .await
        .map_err(storage_error)?;
    Ok(())
}

async fn insert_stale_alias(
    database: &crate::storage::db::Database,
    loom: &LoomRecord,
    old_canonical_uri: &str,
    canonical_uri: &str,
    now: &str,
) -> Result<(), (StatusCode, Json<LoomApiError>)> {
    AddressRepository::new(database)
        .insert_alias_if_missing(&NewAddressAlias {
            alias_id: format!(
                "alias-loom-{}-{}",
                loom.loom_id,
                stable_suffix(old_canonical_uri)
            ),
            canonical_uri: canonical_uri.to_string(),
            alias_uri: old_canonical_uri.to_string(),
            status: "stale".to_string(),
            created_at: now.to_string(),
        })
        .await
        .map_err(storage_error)?;
    Ok(())
}

fn loom_to_dto(loom: LoomRecord, responses: Vec<ResponseDto>) -> LoomDto {
    let display_code = display_code(
        if loom.kind == "weft" {
            DisplayCodeKind::Weft
        } else {
            DisplayCodeKind::Loom
        },
        &loom.loom_id,
    );
    LoomDto {
        loom_id: loom.loom_id,
        title: loom.title,
        summary: loom.summary,
        kind: loom.kind,
        origin_loom_id: loom.origin_loom_id,
        origin_response_id: loom.origin_response_id,
        canonical_uri: loom.canonical_uri,
        code: loom.code,
        display_code,
        created_at: loom.created_at,
        updated_at: loom.updated_at,
        archived_at: loom.archived_at,
        metadata: loom
            .metadata_json
            .as_deref()
            .and_then(|metadata| serde_json::from_str(metadata).ok()),
        responses,
    }
}

fn responses_to_dtos(
    responses: Vec<ResponseRecord>,
    code_blocks: Vec<ResponseCodeBlockRecord>,
) -> Vec<ResponseDto> {
    let mut code_blocks_by_response: HashMap<String, Vec<ResponseCodeBlockDto>> = HashMap::new();
    for code_block in code_blocks {
        code_blocks_by_response
            .entry(code_block.response_id.clone())
            .or_default()
            .push(code_block_to_dto(code_block));
    }
    responses
        .into_iter()
        .map(|response| {
            let code_blocks = code_blocks_by_response
                .remove(&response.response_id)
                .unwrap_or_default();
            response_to_dto(response, code_blocks)
        })
        .collect()
}

fn response_to_dto(
    response: ResponseRecord,
    code_blocks: Vec<ResponseCodeBlockDto>,
) -> ResponseDto {
    let display_code = display_code(DisplayCodeKind::Response, &response.response_id);
    ResponseDto {
        response_id: response.response_id,
        loom_id: response.loom_id,
        role: response.role,
        content: response.content,
        title: response.title,
        code: response.code,
        display_code,
        canonical_uri: response.canonical_uri,
        created_at: response.created_at,
        updated_at: response.updated_at,
        sequence_index: response.sequence_index,
        metadata: response
            .metadata_json
            .as_deref()
            .and_then(|metadata| serde_json::from_str(metadata).ok()),
        code_blocks,
    }
}

fn response_outline_to_dto(response: ResponseOutlineRecord) -> ResponseOutlineDto {
    ResponseOutlineDto {
        response_id: response.response_id,
        loom_id: response.loom_id,
        role: response.role,
        title: response.title,
        preview: response.content_preview,
        canonical_uri: response.canonical_uri,
        created_at: response.created_at,
        updated_at: response.updated_at,
        sequence_index: response.sequence_index,
        metadata: response
            .metadata_json
            .as_deref()
            .and_then(|metadata| serde_json::from_str(metadata).ok()),
    }
}

fn code_block_to_dto(code_block: ResponseCodeBlockRecord) -> ResponseCodeBlockDto {
    ResponseCodeBlockDto {
        code_block_id: code_block.code_block_id,
        block_index: code_block.block_index,
        language: code_block.language,
        code: code_block.code,
        exact_hash: code_block.exact_hash,
        fence: code_block.fence,
    }
}

async fn ensure_active_loom(
    state: &AppState,
    loom_id: &str,
) -> Result<LoomRecord, (StatusCode, Json<LoomApiError>)> {
    let Some(loom) = LoomRepository::new(&state.database)
        .get_loom(loom_id)
        .await
        .map_err(storage_error)?
    else {
        return Err(not_found());
    };
    if loom.is_deleted {
        return Err(not_found());
    }
    Ok(loom)
}

fn required_trimmed(
    field: &'static str,
    value: &str,
) -> Result<String, (StatusCode, Json<LoomApiError>)> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(bad_request(
            "INVALID_LOOM",
            &format!("{field} is required."),
        ));
    }
    Ok(trimmed.to_string())
}

fn validate_kind(kind: &str) -> Result<(), (StatusCode, Json<LoomApiError>)> {
    if kind == "loom" || kind == "weft" {
        return Ok(());
    }
    Err(bad_request(
        "INVALID_LOOM_KIND",
        "Loom kind must be either loom or weft.",
    ))
}

fn validate_metadata(metadata: Option<&Value>) -> Result<(), (StatusCode, Json<LoomApiError>)> {
    let Some(metadata) = metadata else {
        return Ok(());
    };
    if contains_forbidden_key(metadata) {
        return Err(bad_request(
            "RAW_THINKING_REJECTED",
            "Loom metadata contains forbidden raw thinking fields.",
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
        _ => false,
    }
}

fn metadata_json(
    metadata: Option<Value>,
) -> Result<Option<String>, (StatusCode, Json<LoomApiError>)> {
    metadata
        .map(|metadata| {
            serde_json::to_string(&metadata).map_err(|error| {
                bad_request(
                    "INVALID_METADATA",
                    &format!("Loom metadata must be JSON serializable: {error}"),
                )
            })
        })
        .transpose()
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<LoomApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(LoomApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn conflict(code: &str, message: &str) -> (StatusCode, Json<LoomApiError>) {
    (
        StatusCode::CONFLICT,
        Json(LoomApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn not_found() -> (StatusCode, Json<LoomApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(LoomApiError {
            code: "LOOM_NOT_FOUND".to_string(),
            message: "Loom was not found.".to_string(),
        }),
    )
}

fn storage_error(error: ServiceError) -> (StatusCode, Json<LoomApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(LoomApiError {
            code: "LOOM_STORAGE_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}

fn generate_loom_id() -> String {
    format!("loom-{}", timestamp())
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn stable_suffix(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(64)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        archive_loom, create_loom, delete_loom, get_loom, get_loom_transcript_outline,
        get_loom_transcript_page, list_looms, patch_loom, restore_loom, CreateLoomRequest,
        ListLoomsQuery, TranscriptQuery, UpdateLoomRequest,
    };
    use crate::{
        api::{resolve::resolve_address, state::AppState},
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::db::test_database,
        storage::repositories::responses::{NewResponse, ResponseRepository},
    };
    use axum::{
        extract::{Path, Query, State},
        http::StatusCode,
        Json,
    };
    use serde_json::json;
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn post_looms_creates_loom_and_is_idempotent() {
        let state = test_state().await;
        let input = create_request("loom-1");

        let first = create_loom(State(state.clone()), Json(input))
            .await
            .expect("create Loom");
        assert_eq!(first.0, StatusCode::CREATED);
        assert_eq!(first.1 .0.loom.loom_id, "loom-1");

        let second = create_loom(State(state), Json(create_request("loom-1")))
            .await
            .expect("create existing Loom");
        assert_eq!(second.0, StatusCode::OK);
        assert_eq!(second.1 .0.loom.title, "Service Loom");
    }

    #[tokio::test]
    async fn patch_looms_updates_title_and_summary() {
        let state = test_state().await;
        let _ = create_loom(State(state.clone()), Json(create_request("loom-1")))
            .await
            .expect("create Loom");

        let updated = patch_loom(
            State(state),
            Path("loom-1".to_string()),
            Json(UpdateLoomRequest {
                title: Some("Renamed Loom".to_string()),
                summary: Some("Updated summary".to_string()),
                canonical_uri: None,
                code: None,
                metadata: Some(json!({ "color": "green" })),
            }),
        )
        .await
        .expect("patch Loom")
        .0;

        assert_eq!(updated.loom.title, "Renamed Loom");
        assert_eq!(updated.loom.summary.as_deref(), Some("Updated summary"));
        assert_eq!(updated.loom.metadata, Some(json!({ "color": "green" })));
    }

    #[tokio::test]
    async fn get_looms_returns_detail_and_list() {
        let state = test_state().await;
        let _ = create_loom(State(state.clone()), Json(create_request("loom-1")))
            .await
            .expect("create Loom");

        let detail = get_loom(State(state.clone()), Path("loom-1".to_string()))
            .await
            .expect("get Loom")
            .0;
        assert_eq!(detail.loom.loom_id, "loom-1");
        assert!(detail.loom.display_code.starts_with("L-"));

        let list = list_looms(State(state), Query(ListLoomsQuery::default()))
            .await
            .expect("list Looms")
            .0;
        assert_eq!(list.looms.len(), 1);
        assert_eq!(list.looms[0].loom_id, "loom-1");
        assert_eq!(list.looms[0].display_code, detail.loom.display_code);
    }

    #[tokio::test]
    async fn archive_and_restore_loom_moves_between_active_and_archived_lists() {
        let state = test_state().await;
        let _ = create_loom(State(state.clone()), Json(create_request("loom-1")))
            .await
            .expect("create Loom");

        let archived = archive_loom(State(state.clone()), Path("loom-1".to_string()))
            .await
            .expect("archive Loom")
            .0;
        assert_eq!(archived.loom.loom_id, "loom-1");
        assert!(archived.loom.archived_at.is_some());

        let active_list = list_looms(State(state.clone()), Query(ListLoomsQuery::default()))
            .await
            .expect("list active Looms")
            .0;
        assert!(active_list.looms.is_empty());

        let archived_list = list_looms(
            State(state.clone()),
            Query(ListLoomsQuery {
                archived: Some(true),
            }),
        )
        .await
        .expect("list archived Looms")
        .0;
        assert_eq!(archived_list.looms.len(), 1);
        assert_eq!(archived_list.looms[0].loom_id, "loom-1");

        let restored = restore_loom(State(state.clone()), Path("loom-1".to_string()))
            .await
            .expect("restore Loom")
            .0;
        assert_eq!(restored.loom.loom_id, "loom-1");
        assert!(restored.loom.archived_at.is_none());

        let active_list = list_looms(State(state), Query(ListLoomsQuery::default()))
            .await
            .expect("list active Looms after restore")
            .0;
        assert_eq!(active_list.looms.len(), 1);
    }

    #[tokio::test]
    async fn create_loom_with_canonical_uri_inserts_address() {
        let state = test_state().await;
        let _ = create_loom(State(state.clone()), Json(create_request("loom-1")))
            .await
            .expect("create Loom");

        let resolved = resolve_address(&state.database, "loom://service/loom-1")
            .await
            .expect("resolve address");
        assert_eq!(resolved.object_id.as_deref(), Some("loom-1"));
    }

    #[tokio::test]
    async fn delete_loom_tombstones_loom_and_child_wefts() {
        let state = test_state().await;
        let _ = create_loom(State(state.clone()), Json(create_request("loom-1")))
            .await
            .expect("create Loom");
        let _ = create_loom(
            State(state.clone()),
            Json(CreateLoomRequest {
                loom_id: Some("weft-1".to_string()),
                title: "Child Weft".to_string(),
                summary: None,
                kind: Some("weft".to_string()),
                origin_loom_id: Some("loom-1".to_string()),
                origin_response_id: Some("response-1".to_string()),
                canonical_uri: Some("loom://service/weft-1".to_string()),
                code: None,
                metadata: None,
            }),
        )
        .await
        .expect("create child Weft");

        let status = delete_loom(State(state.clone()), Path("loom-1".to_string()))
            .await
            .expect("delete Loom");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let list = list_looms(State(state.clone()), Query(ListLoomsQuery::default()))
            .await
            .expect("list Looms")
            .0;
        assert!(list.looms.is_empty());
        assert!(get_loom(State(state.clone()), Path("loom-1".to_string()))
            .await
            .is_err());

        let resolved = resolve_address(&state.database, "loom://service/loom-1")
            .await
            .expect("resolve deleted Loom");
        assert_eq!(
            resolved.status,
            crate::api::resolve::ResolveAddressStatus::Deleted
        );

        let wefts = crate::storage::repositories::looms::LoomRepository::new(&state.database)
            .list_child_wefts_by_origin_loom("loom-1")
            .await
            .expect("list child Wefts");
        assert!(wefts.is_empty());
    }

    #[tokio::test]
    async fn create_weft_stores_origin_metadata() {
        let state = test_state().await;
        let response = create_loom(
            State(state),
            Json(CreateLoomRequest {
                loom_id: Some("weft-1".to_string()),
                title: "Weft Loom".to_string(),
                summary: None,
                kind: Some("weft".to_string()),
                origin_loom_id: Some("origin-loom".to_string()),
                origin_response_id: Some("origin-response".to_string()),
                canonical_uri: Some("loom://service/weft-1".to_string()),
                code: None,
                metadata: None,
            }),
        )
        .await
        .expect("create Weft")
        .1
         .0;

        assert_eq!(response.loom.kind, "weft");
        assert_eq!(response.loom.origin_loom_id.as_deref(), Some("origin-loom"));
        assert_eq!(
            response.loom.origin_response_id.as_deref(),
            Some("origin-response")
        );
    }

    #[tokio::test]
    async fn forbidden_raw_thinking_metadata_is_rejected() {
        let state = test_state().await;
        let error = create_loom(
            State(state),
            Json(CreateLoomRequest {
                metadata: Some(json!({ "raw_thinking": "hidden" })),
                ..create_request("loom-1")
            }),
        )
        .await
        .expect_err("raw thinking metadata should fail");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "RAW_THINKING_REJECTED");
    }

    #[tokio::test]
    async fn transcript_latest_and_older_pages_use_sequence_cursors() {
        let state = test_state().await;
        let _ = create_loom(State(state.clone()), Json(create_request("loom-1")))
            .await
            .expect("create Loom");
        seed_response_pairs(&state, 25).await;

        let latest = get_loom_transcript_page(
            State(state.clone()),
            Path("loom-1".to_string()),
            Query(TranscriptQuery {
                direction: Some("latest".to_string()),
                limit: Some(20),
                ..Default::default()
            }),
        )
        .await
        .expect("latest page")
        .0;

        assert_eq!(latest.items.len(), 40);
        assert_eq!(latest.oldest_cursor, Some(10));
        assert_eq!(latest.newest_cursor, Some(49));
        assert!(latest.has_older);
        assert!(!latest.has_newer);
        assert_eq!(latest.total_known_count, 25);

        let older = get_loom_transcript_page(
            State(state),
            Path("loom-1".to_string()),
            Query(TranscriptQuery {
                direction: Some("older".to_string()),
                cursor: latest.oldest_cursor,
                limit: Some(20),
                ..Default::default()
            }),
        )
        .await
        .expect("older page")
        .0;

        assert_eq!(older.items.len(), 10);
        assert_eq!(older.oldest_cursor, Some(0));
        assert_eq!(older.newest_cursor, Some(9));
        assert!(!older.has_older);
        assert!(older.has_newer);
    }

    #[tokio::test]
    async fn transcript_around_page_includes_target_response() {
        let state = test_state().await;
        let _ = create_loom(State(state.clone()), Json(create_request("loom-1")))
            .await
            .expect("create Loom");
        seed_response_pairs(&state, 12).await;

        let page = get_loom_transcript_page(
            State(state),
            Path("loom-1".to_string()),
            Query(TranscriptQuery {
                direction: Some("around".to_string()),
                target_response_id: Some("assistant-08".to_string()),
                limit: Some(4),
                ..Default::default()
            }),
        )
        .await
        .expect("around page")
        .0;

        assert!(page
            .items
            .iter()
            .any(|response| response.response_id == "assistant-08"));
        assert!(page.has_older);
        assert!(page.has_newer);
    }

    #[tokio::test]
    async fn transcript_outline_omits_full_response_body() {
        let state = test_state().await;
        let _ = create_loom(State(state.clone()), Json(create_request("loom-1")))
            .await
            .expect("create Loom");
        let long_answer = "Answer body ".repeat(80);
        let responses = ResponseRepository::new(&state.database);
        responses
            .insert_response_pair(
                &NewResponse {
                    response_id: "user-01".to_string(),
                    loom_id: "loom-1".to_string(),
                    role: "user".to_string(),
                    content: "Prompt body should be previewed".to_string(),
                    title: Some("Prompt title".to_string()),
                    code: None,
                    canonical_uri: None,
                    created_at: "2026-05-08T00:00:00Z".to_string(),
                    updated_at: "2026-05-08T00:00:00Z".to_string(),
                    sequence_index: 0,
                    metadata_json: Some("{}".to_string()),
                },
                &NewResponse {
                    response_id: "assistant-01".to_string(),
                    loom_id: "loom-1".to_string(),
                    role: "assistant".to_string(),
                    content: long_answer.clone(),
                    title: Some("Assistant title".to_string()),
                    code: None,
                    canonical_uri: None,
                    created_at: "2026-05-08T00:00:01Z".to_string(),
                    updated_at: "2026-05-08T00:00:01Z".to_string(),
                    sequence_index: 1,
                    metadata_json: Some("{\"status\":\"completed\"}".to_string()),
                },
            )
            .await
            .expect("insert pair");

        let outline = get_loom_transcript_outline(State(state), Path("loom-1".to_string()))
            .await
            .expect("outline")
            .0;

        assert_eq!(outline.items.len(), 2);
        let assistant = outline
            .items
            .iter()
            .find(|item| item.response_id == "assistant-01")
            .expect("assistant outline");
        assert_eq!(assistant.title.as_deref(), Some("Assistant title"));
        assert!(assistant.preview.len() < long_answer.len());
        assert!(!serde_json::to_string(&outline)
            .expect("outline json")
            .contains("raw_thinking"));
    }

    fn create_request(loom_id: &str) -> CreateLoomRequest {
        CreateLoomRequest {
            loom_id: Some(loom_id.to_string()),
            title: "Service Loom".to_string(),
            summary: Some("Created in loom-service".to_string()),
            kind: Some("loom".to_string()),
            origin_loom_id: None,
            origin_response_id: None,
            canonical_uri: Some(format!("loom://service/{loom_id}")),
            code: Some("L-SERVICE".to_string()),
            metadata: Some(json!({ "color": "blue" })),
        }
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
                PathBuf::from("/tmp/loom-service-test.toml"),
                LoomServiceConfig::default(),
            ),
            secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
            agent_runs: Default::default(),
        }
    }

    async fn seed_response_pairs(state: &AppState, count: i64) {
        let responses = ResponseRepository::new(&state.database);
        for index in 0..count {
            responses
                .insert_response_pair(
                    &NewResponse {
                        response_id: format!("user-{index:02}"),
                        loom_id: "loom-1".to_string(),
                        role: "user".to_string(),
                        content: format!("Prompt {index}"),
                        title: Some(format!("Prompt {index}")),
                        code: None,
                        canonical_uri: None,
                        created_at: format!("2026-05-08T00:00:{index:02}Z"),
                        updated_at: format!("2026-05-08T00:00:{index:02}Z"),
                        sequence_index: index * 2,
                        metadata_json: Some("{}".to_string()),
                    },
                    &NewResponse {
                        response_id: format!("assistant-{index:02}"),
                        loom_id: "loom-1".to_string(),
                        role: "assistant".to_string(),
                        content: format!("Answer {index}"),
                        title: Some(format!("Answer {index}")),
                        code: None,
                        canonical_uri: None,
                        created_at: format!("2026-05-08T00:01:{index:02}Z"),
                        updated_at: format!("2026-05-08T00:01:{index:02}Z"),
                        sequence_index: index * 2 + 1,
                        metadata_json: Some("{\"status\":\"completed\"}".to_string()),
                    },
                )
                .await
                .expect("insert response pair");
        }
    }
}
