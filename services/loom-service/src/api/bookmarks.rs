use crate::{
    api::state::AppState,
    capabilities::repository::{new_id, timestamp},
    error::ServiceError,
    storage::repositories::bookmarks::{BookmarkRecord, BookmarkRepository, NewBookmark},
};
use axum::{
    extract::{Path, Query, State},
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
pub struct CreateBookmarkRequest {
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub title: String,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkTargetQuery {
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkDto {
    pub bookmark_id: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub title: String,
    pub created_at: String,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkEnvelope {
    pub bookmark: BookmarkDto,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub reused: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkListResponse {
    pub bookmarks: Vec<BookmarkDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkApiError {
    pub code: String,
    pub message: String,
}

pub async fn create_bookmark(
    State(state): State<AppState>,
    Json(input): Json<CreateBookmarkRequest>,
) -> Result<(StatusCode, Json<BookmarkEnvelope>), (StatusCode, Json<BookmarkApiError>)> {
    validate_target(
        &input.target_kind,
        input.target_id.as_deref(),
        input.target_uri.as_deref(),
    )?;
    reject_forbidden_text(Some(&input.title))?;
    reject_forbidden_value(input.metadata.as_ref())?;

    let repository = BookmarkRepository::new(&state.database);
    if let Some(existing) = repository
        .find_by_target(
            &input.target_kind,
            input.target_id.as_deref(),
            input.target_uri.as_deref(),
        )
        .await
        .map_err(storage_error)?
    {
        return Ok((
            StatusCode::OK,
            Json(BookmarkEnvelope {
                bookmark: bookmark_to_dto(existing),
                reused: true,
            }),
        ));
    }

    let bookmark = NewBookmark {
        bookmark_id: new_id("bookmark"),
        target_kind: input.target_kind,
        target_id: input.target_id,
        target_uri: input.target_uri,
        title: input.title,
        metadata_json: metadata_json(input.metadata)?,
        created_at: timestamp(),
    };
    repository
        .insert_bookmark(&bookmark)
        .await
        .map_err(storage_error)?;
    let stored = repository
        .get_bookmark(&bookmark.bookmark_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| storage_error(ServiceError::storage("created Bookmark was not found")))?;

    Ok((
        StatusCode::CREATED,
        Json(BookmarkEnvelope {
            bookmark: bookmark_to_dto(stored),
            reused: false,
        }),
    ))
}

pub async fn delete_bookmark(
    State(state): State<AppState>,
    Path(bookmark_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<BookmarkApiError>)> {
    let deleted = BookmarkRepository::new(&state.database)
        .delete_bookmark(&bookmark_id)
        .await
        .map_err(storage_error)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(not_found())
    }
}

pub async fn get_bookmark(
    State(state): State<AppState>,
    Path(bookmark_id): Path<String>,
) -> Result<Json<BookmarkEnvelope>, (StatusCode, Json<BookmarkApiError>)> {
    let bookmark = BookmarkRepository::new(&state.database)
        .get_bookmark(&bookmark_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;
    Ok(Json(BookmarkEnvelope {
        bookmark: bookmark_to_dto(bookmark),
        reused: false,
    }))
}

pub async fn list_bookmarks(
    State(state): State<AppState>,
) -> Result<Json<BookmarkListResponse>, (StatusCode, Json<BookmarkApiError>)> {
    let bookmarks = BookmarkRepository::new(&state.database)
        .list_bookmarks()
        .await
        .map_err(storage_error)?;
    Ok(Json(BookmarkListResponse {
        bookmarks: bookmarks.into_iter().map(bookmark_to_dto).collect(),
    }))
}

pub async fn get_bookmark_for_target(
    State(state): State<AppState>,
    Query(query): Query<BookmarkTargetQuery>,
) -> Result<Json<BookmarkEnvelope>, (StatusCode, Json<BookmarkApiError>)> {
    validate_target(
        &query.target_kind,
        query.target_id.as_deref(),
        query.target_uri.as_deref(),
    )?;
    let bookmark = BookmarkRepository::new(&state.database)
        .find_by_target(
            &query.target_kind,
            query.target_id.as_deref(),
            query.target_uri.as_deref(),
        )
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;
    Ok(Json(BookmarkEnvelope {
        bookmark: bookmark_to_dto(bookmark),
        reused: true,
    }))
}

fn bookmark_to_dto(bookmark: BookmarkRecord) -> BookmarkDto {
    BookmarkDto {
        bookmark_id: bookmark.bookmark_id,
        target_kind: bookmark.target_kind,
        target_id: bookmark.target_id,
        target_uri: bookmark.target_uri,
        title: bookmark.title,
        created_at: bookmark.created_at,
        metadata: parse_metadata(bookmark.metadata_json.as_deref()),
    }
}

fn metadata_json(
    metadata: Option<Value>,
) -> Result<Option<String>, (StatusCode, Json<BookmarkApiError>)> {
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

fn validate_target(
    kind: &str,
    target_id: Option<&str>,
    target_uri: Option<&str>,
) -> Result<(), (StatusCode, Json<BookmarkApiError>)> {
    match kind {
        "loom" | "response" | "weft" | "fragment" => {
            if target_id.is_none() && target_uri.is_none() {
                return Err(bad_request(
                    "MISSING_TARGET",
                    "Bookmark target requires targetId or targetUri.",
                ));
            }
            Ok(())
        }
        "external" => {
            if target_uri.is_none() {
                return Err(bad_request(
                    "MISSING_TARGET_URI",
                    "External Bookmark target requires targetUri.",
                ));
            }
            Ok(())
        }
        _ => Err(bad_request(
            "INVALID_TARGET_KIND",
            "Bookmark targetKind must be loom, response, weft, fragment, or external.",
        )),
    }
}

fn reject_forbidden_value(
    value: Option<&Value>,
) -> Result<(), (StatusCode, Json<BookmarkApiError>)> {
    let Some(value) = value else {
        return Ok(());
    };
    if contains_forbidden_text(&value.to_string()) {
        return Err(bad_request(
            "RAW_THINKING_REJECTED",
            "Bookmark payload contains forbidden raw-thinking metadata.",
        ));
    }
    Ok(())
}

fn reject_forbidden_text(value: Option<&str>) -> Result<(), (StatusCode, Json<BookmarkApiError>)> {
    if value.map(contains_forbidden_text).unwrap_or(false) {
        return Err(bad_request(
            "RAW_THINKING_REJECTED",
            "Bookmark payload contains forbidden raw-thinking metadata.",
        ));
    }
    Ok(())
}

fn contains_forbidden_text(value: &str) -> bool {
    FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| value.contains(key))
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<BookmarkApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(BookmarkApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn not_found() -> (StatusCode, Json<BookmarkApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(BookmarkApiError {
            code: "BOOKMARK_NOT_FOUND".to_string(),
            message: "Bookmark was not found.".to_string(),
        }),
    )
}

fn storage_error(error: ServiceError) -> (StatusCode, Json<BookmarkApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(BookmarkApiError {
            code: "BOOKMARK_STORAGE_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        create_bookmark, delete_bookmark, get_bookmark, get_bookmark_for_target, list_bookmarks,
        BookmarkTargetQuery, CreateBookmarkRequest,
    };
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::db::test_database,
    };
    use axum::{
        extract::{Path, Query, State},
        http::StatusCode,
        Json,
    };
    use serde_json::json;
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn post_bookmarks_creates_loom_and_response_bookmarks() {
        let state = test_state().await;
        let loom = create_bookmark(State(state.clone()), Json(loom_bookmark_request()))
            .await
            .expect("create Loom Bookmark");
        let response = create_bookmark(State(state), Json(response_bookmark_request()))
            .await
            .expect("create Response Bookmark");

        assert_eq!(loom.0, StatusCode::CREATED);
        assert_eq!(loom.1 .0.bookmark.target_kind, "loom");
        assert_eq!(response.1 .0.bookmark.target_kind, "response");
    }

    #[tokio::test]
    async fn duplicate_bookmark_reuses_existing_record() {
        let state = test_state().await;
        let first = create_bookmark(State(state.clone()), Json(response_bookmark_request()))
            .await
            .expect("create Bookmark");
        let second = create_bookmark(State(state), Json(response_bookmark_request()))
            .await
            .expect("reuse Bookmark");

        assert_eq!(first.0, StatusCode::CREATED);
        assert_eq!(second.0, StatusCode::OK);
        assert!(second.1 .0.reused);
        assert_eq!(
            first.1 .0.bookmark.bookmark_id,
            second.1 .0.bookmark.bookmark_id
        );
    }

    #[tokio::test]
    async fn get_list_delete_and_target_lookup_work() {
        let state = test_state().await;
        let created = create_bookmark(State(state.clone()), Json(response_bookmark_request()))
            .await
            .expect("create Bookmark")
            .1
             .0
            .bookmark;

        let fetched = get_bookmark(State(state.clone()), Path(created.bookmark_id.clone()))
            .await
            .expect("get Bookmark")
            .0;
        assert_eq!(fetched.bookmark.bookmark_id, created.bookmark_id);

        let listed = list_bookmarks(State(state.clone()))
            .await
            .expect("list Bookmarks")
            .0;
        assert_eq!(listed.bookmarks.len(), 1);

        let by_target = get_bookmark_for_target(
            State(state.clone()),
            Query(BookmarkTargetQuery {
                target_kind: "response".to_string(),
                target_id: Some("response-1".to_string()),
                target_uri: None,
            }),
        )
        .await
        .expect("get Bookmark for target")
        .0;
        assert_eq!(by_target.bookmark.bookmark_id, created.bookmark_id);

        let deleted = delete_bookmark(State(state), Path(created.bookmark_id))
            .await
            .expect("delete Bookmark");
        assert_eq!(deleted, StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn get_bookmark_for_target_works_by_uri() {
        let state = test_state().await;
        let _ = create_bookmark(
            State(state.clone()),
            Json(CreateBookmarkRequest {
                target_id: None,
                ..external_bookmark_request()
            }),
        )
        .await
        .expect("create external Bookmark");

        let by_uri = get_bookmark_for_target(
            State(state),
            Query(BookmarkTargetQuery {
                target_kind: "external".to_string(),
                target_id: None,
                target_uri: Some("https://example.test/article".to_string()),
            }),
        )
        .await
        .expect("get by URI")
        .0;

        assert_eq!(
            by_uri.bookmark.target_uri.as_deref(),
            Some("https://example.test/article")
        );
    }

    #[tokio::test]
    async fn forbidden_raw_thinking_metadata_is_rejected() {
        let state = test_state().await;
        let error = create_bookmark(
            State(state),
            Json(CreateBookmarkRequest {
                metadata: Some(json!({ "raw_thinking": "hidden" })),
                ..response_bookmark_request()
            }),
        )
        .await
        .expect_err("raw thinking rejected");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "RAW_THINKING_REJECTED");
    }

    fn loom_bookmark_request() -> CreateBookmarkRequest {
        CreateBookmarkRequest {
            target_kind: "loom".to_string(),
            target_id: Some("loom-1".to_string()),
            target_uri: Some("loom://service/loom-1".to_string()),
            title: "Saved Loom".to_string(),
            metadata: Some(json!({ "code": "L1" })),
        }
    }

    fn response_bookmark_request() -> CreateBookmarkRequest {
        CreateBookmarkRequest {
            target_kind: "response".to_string(),
            target_id: Some("response-1".to_string()),
            target_uri: Some("loom://service/response-1".to_string()),
            title: "Saved Response".to_string(),
            metadata: Some(json!({ "code": "R1" })),
        }
    }

    fn external_bookmark_request() -> CreateBookmarkRequest {
        CreateBookmarkRequest {
            target_kind: "external".to_string(),
            target_id: None,
            target_uri: Some("https://example.test/article".to_string()),
            title: "External Article".to_string(),
            metadata: None,
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
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }
}
