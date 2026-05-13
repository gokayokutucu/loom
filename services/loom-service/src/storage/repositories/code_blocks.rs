#![allow(dead_code)]

use crate::{error::ServiceError, storage::db::Database};
use sqlx::{Row, SqlitePool};

const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResponseCodeBlockRecord {
    pub code_block_id: String,
    pub response_id: String,
    pub loom_id: String,
    pub block_index: i64,
    pub language: Option<String>,
    pub code: String,
    pub exact_hash: String,
    pub fence: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedCodeBlock {
    pub block_index: i64,
    pub language: Option<String>,
    pub code: String,
    pub exact_hash: String,
    pub fence: String,
}

#[derive(Debug, Clone)]
pub struct ResponseCodeBlockRepository {
    pool: SqlitePool,
}

impl ResponseCodeBlockRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn sync_for_response(
        &self,
        response_id: &str,
        loom_id: &str,
        markdown: &str,
    ) -> Result<Vec<ResponseCodeBlockRecord>, ServiceError> {
        sync_code_blocks_for_response(&self.pool, response_id, loom_id, markdown).await
    }

    pub async fn list_by_response(
        &self,
        response_id: &str,
    ) -> Result<Vec<ResponseCodeBlockRecord>, ServiceError> {
        list_code_blocks_by_response(&self.pool, response_id).await
    }
}

pub async fn sync_code_blocks_for_response(
    pool: &SqlitePool,
    response_id: &str,
    loom_id: &str,
    markdown: &str,
) -> Result<Vec<ResponseCodeBlockRecord>, ServiceError> {
    reject_forbidden_payload(Some(markdown))?;
    let blocks = extract_fenced_code_blocks(markdown)?;
    let now = timestamp();
    let mut transaction = pool.begin().await.map_err(|error| {
        ServiceError::storage(format!("failed to start code block transaction: {error}"))
    })?;

    sqlx::query("DELETE FROM response_code_blocks WHERE response_id = ?1")
        .bind(response_id)
        .execute(&mut transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to clear Response code blocks: {error}"))
        })?;

    for block in &blocks {
        reject_forbidden_payload(Some(&block.code))?;
        let code_block_id = code_block_id(response_id, block.block_index, &block.exact_hash);
        sqlx::query(
            "INSERT INTO response_code_blocks (
                code_block_id, response_id, loom_id, block_index, language, code, exact_hash,
                fence, metadata_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)",
        )
        .bind(code_block_id)
        .bind(response_id)
        .bind(loom_id)
        .bind(block.block_index)
        .bind(&block.language)
        .bind(&block.code)
        .bind(&block.exact_hash)
        .bind(&block.fence)
        .bind(&now)
        .bind(&now)
        .execute(&mut transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert Response code block: {error}"))
        })?;
    }

    transaction.commit().await.map_err(|error| {
        ServiceError::storage(format!("failed to commit code block transaction: {error}"))
    })?;

    list_code_blocks_by_response(pool, response_id).await
}

pub fn extract_fenced_code_blocks(markdown: &str) -> Result<Vec<ExtractedCodeBlock>, ServiceError> {
    reject_forbidden_payload(Some(markdown))?;
    let mut blocks = Vec::new();
    let mut cursor = 0usize;
    while let Some(line) = next_line(markdown, cursor) {
        let Some(opening) = parse_opening_fence(line.body) else {
            cursor = line.next_start;
            continue;
        };
        let code_start = line.next_start;
        let mut search = line.next_start;
        let mut closing_start = None;
        while let Some(candidate) = next_line(markdown, search) {
            if is_closing_fence(candidate.body, opening.marker, opening.length) {
                closing_start = Some(candidate.start);
                cursor = candidate.next_start;
                break;
            }
            search = candidate.next_start;
        }
        let Some(code_end) = closing_start else {
            break;
        };
        let code = markdown[code_start..code_end].to_string();
        let exact_hash = stable_hash(&code);
        blocks.push(ExtractedCodeBlock {
            block_index: blocks.len() as i64,
            language: opening.language,
            code,
            exact_hash,
            fence: opening.fence,
        });
    }

    Ok(blocks)
}

pub(crate) async fn list_code_blocks_by_response(
    pool: &SqlitePool,
    response_id: &str,
) -> Result<Vec<ResponseCodeBlockRecord>, ServiceError> {
    sqlx::query(
        "SELECT * FROM response_code_blocks
         WHERE response_id = ?1
         ORDER BY block_index ASC",
    )
    .bind(response_id)
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(code_block_from_row).collect())
    .map_err(|error| ServiceError::storage(format!("failed to list Response code blocks: {error}")))
}

fn code_block_from_row(row: sqlx::sqlite::SqliteRow) -> ResponseCodeBlockRecord {
    ResponseCodeBlockRecord {
        code_block_id: row.get("code_block_id"),
        response_id: row.get("response_id"),
        loom_id: row.get("loom_id"),
        block_index: row.get("block_index"),
        language: row.get("language"),
        code: row.get("code"),
        exact_hash: row.get("exact_hash"),
        fence: row.get("fence"),
        metadata_json: row.get("metadata_json"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

#[derive(Debug, Clone, Copy)]
struct Line<'a> {
    start: usize,
    body: &'a str,
    next_start: usize,
}

#[derive(Debug, Clone)]
struct OpeningFence {
    marker: char,
    length: usize,
    language: Option<String>,
    fence: String,
}

fn next_line(text: &str, start: usize) -> Option<Line<'_>> {
    if start >= text.len() {
        return None;
    }
    let bytes = text.as_bytes();
    let mut end = start;
    while end < bytes.len() && bytes[end] != b'\n' {
        end += 1;
    }
    let next_start = if end < bytes.len() { end + 1 } else { end };
    let body_end = if end > start && bytes[end - 1] == b'\r' {
        end - 1
    } else {
        end
    };
    Some(Line {
        start,
        body: &text[start..body_end],
        next_start,
    })
}

fn parse_opening_fence(line: &str) -> Option<OpeningFence> {
    let trimmed = line.trim_start();
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let length = trimmed
        .chars()
        .take_while(|character| *character == marker)
        .count();
    if length < 3 {
        return None;
    }
    let rest = trimmed[length..].trim();
    let language = rest
        .split_whitespace()
        .next()
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Some(OpeningFence {
        marker,
        length,
        language,
        fence: marker.to_string().repeat(length),
    })
}

fn is_closing_fence(line: &str, marker: char, min_length: usize) -> bool {
    let trimmed = line.trim();
    let length = trimmed
        .chars()
        .take_while(|character| *character == marker)
        .count();
    length >= min_length && trimmed[length..].trim().is_empty()
}

fn code_block_id(response_id: &str, block_index: i64, exact_hash: &str) -> String {
    format!("codeblock-{response_id}-{block_index}-{exact_hash}")
}

fn stable_hash(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}

fn reject_forbidden_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "Response code block payload contains forbidden key {forbidden}"
            )));
        }
    }

    Ok(())
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::{extract_fenced_code_blocks, ResponseCodeBlockRepository};
    use crate::storage::{
        db::test_database,
        repositories::{
            looms::{LoomRepository, NewLoom},
            responses::{NewResponse, ResponseRepository},
        },
    };

    #[test]
    fn extracts_fenced_code_blocks_exactly_without_touching_markdown() {
        let markdown = "Intro\n```rust\nfn main() {\n    println!(\"hi\");\n}\n```\nOutro";

        let blocks = extract_fenced_code_blocks(markdown).expect("extract blocks");

        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].language.as_deref(), Some("rust"));
        assert_eq!(blocks[0].code, "fn main() {\n    println!(\"hi\");\n}\n");
        assert_eq!(
            markdown,
            "Intro\n```rust\nfn main() {\n    println!(\"hi\");\n}\n```\nOutro"
        );
    }

    #[test]
    fn extracts_tilde_blocks_and_ignores_unclosed_fences() {
        let markdown = "~~~ts\nconst value = 1;\n~~~\n```rust\nunclosed";

        let blocks = extract_fenced_code_blocks(markdown).expect("extract blocks");

        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].language.as_deref(), Some("ts"));
        assert_eq!(blocks[0].fence, "~~~");
        assert_eq!(blocks[0].code, "const value = 1;\n");
    }

    #[test]
    fn rejects_raw_thinking_in_code_block_source() {
        let error = extract_fenced_code_blocks("```text\nraw_thinking\n```")
            .expect_err("raw thinking rejected");

        assert!(error.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn repository_syncs_inserted_response_code_blocks() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let responses = ResponseRepository::new(&database);
        responses
            .insert_response(&NewResponse {
                response_id: "response-code".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Answer\n```ts\nconst value = 1;\n```\n".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                sequence_index: 0,
                metadata_json: None,
            })
            .await
            .expect("insert response");

        let blocks = ResponseCodeBlockRepository::new(&database)
            .list_by_response("response-code")
            .await
            .expect("list code blocks");
        let response = responses
            .get_response("response-code")
            .await
            .expect("get response")
            .expect("response exists");

        assert_eq!(response.content, "Answer\n```ts\nconst value = 1;\n```\n");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].language.as_deref(), Some("ts"));
        assert_eq!(blocks[0].code, "const value = 1;\n");
        assert!(blocks[0].exact_hash.starts_with("fnv1a64:"));
    }

    #[tokio::test]
    async fn repository_resyncs_code_blocks_on_content_update() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let responses = ResponseRepository::new(&database);
        responses
            .insert_response(&NewResponse {
                response_id: "response-update".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "```js\nold();\n```\n".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                sequence_index: 0,
                metadata_json: None,
            })
            .await
            .expect("insert response");

        responses
            .update_response_content("response-update", "```js\nnewValue();\n```\n")
            .await
            .expect("update response");

        let blocks = ResponseCodeBlockRepository::new(&database)
            .list_by_response("response-update")
            .await
            .expect("list code blocks");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].code, "newValue();\n");
        assert!(!blocks[0].code.contains("old"));
    }

    async fn insert_test_loom(database: &crate::storage::db::Database) {
        LoomRepository::new(database)
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Test Loom".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");
    }
}
