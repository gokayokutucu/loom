use crate::{
    api::state::AppState, error::ServiceError,
    storage::repositories::code_blocks::is_reusable_code_artifact,
};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCodeSnippetsQuery {
    pub loom_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeSnippetDto {
    pub code_block_id: String,
    pub response_id: String,
    pub loom_id: String,
    pub loom_title: Option<String>,
    pub source_response_title: Option<String>,
    pub source_response_code: Option<String>,
    pub source_canonical_uri: Option<String>,
    pub block_index: i64,
    pub language: Option<String>,
    pub code: String,
    pub exact_hash: String,
    pub fence: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeSnippetListResponse {
    pub code_snippets: Vec<CodeSnippetDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSnippetApiError {
    pub code: String,
    pub message: String,
}

pub async fn list_code_snippets(
    State(state): State<AppState>,
    Query(query): Query<ListCodeSnippetsQuery>,
) -> Result<Json<CodeSnippetListResponse>, (StatusCode, Json<CodeSnippetApiError>)> {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let rows = sqlx::query(
        "SELECT
            cb.code_block_id,
            cb.response_id,
            cb.loom_id,
            cb.block_index,
            cb.language,
            cb.code,
            cb.exact_hash,
            cb.fence,
            cb.created_at,
            cb.updated_at,
            l.title AS loom_title,
            r.title AS source_response_title,
            r.code AS source_response_code,
            r.canonical_uri AS source_canonical_uri
         FROM response_code_blocks cb
         JOIN responses r ON r.response_id = cb.response_id
         JOIN looms l ON l.loom_id = cb.loom_id
         WHERE COALESCE(r.is_deleted, 0) = 0
           AND COALESCE(l.is_deleted, 0) = 0
         ORDER BY
           CASE WHEN ?1 IS NOT NULL AND cb.loom_id = ?1 THEN 0 ELSE 1 END,
           r.created_at DESC,
           cb.block_index ASC
         LIMIT ?2",
    )
    .bind(query.loom_id.as_deref())
    .bind(limit)
    .fetch_all(state.database.pool())
    .await
    .map_err(storage_error)?;

    let code_snippets = rows
        .into_iter()
        .map(|row| CodeSnippetDto {
            code_block_id: row.get("code_block_id"),
            response_id: row.get("response_id"),
            loom_id: row.get("loom_id"),
            loom_title: row.get("loom_title"),
            source_response_title: row.get("source_response_title"),
            source_response_code: row.get("source_response_code"),
            source_canonical_uri: row.get("source_canonical_uri"),
            block_index: row.get("block_index"),
            language: row.get("language"),
            code: row.get("code"),
            exact_hash: row.get("exact_hash"),
            fence: row.get("fence"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .filter(|snippet| is_reusable_code_artifact(snippet.language.as_deref(), &snippet.code))
        .collect();

    Ok(Json(CodeSnippetListResponse { code_snippets }))
}

fn storage_error(error: sqlx::Error) -> (StatusCode, Json<CodeSnippetApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(CodeSnippetApiError {
            code: "STORAGE_ERROR".to_string(),
            message: ServiceError::storage(format!("failed to list Code Snippets: {error}"))
                .to_string(),
        }),
    )
}
