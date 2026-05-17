#![allow(dead_code)]

use crate::{
    error::ServiceError,
    storage::{
        db::Database,
        repositories::code_blocks::{list_code_blocks_by_response, ResponseCodeBlockRecord},
    },
};
use sqlx::{Row, SqlitePool};

const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResponsePartRecord {
    pub part_id: String,
    pub response_id: String,
    pub loom_id: String,
    pub sequence_index: i64,
    pub part_kind: String,
    pub content: Option<String>,
    pub markdown: Option<String>,
    pub code_block_id: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewResponsePart {
    pub sequence_index: i64,
    pub part_kind: String,
    pub content: Option<String>,
    pub markdown: Option<String>,
    pub code_block_id: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResponsePartRepository {
    pool: SqlitePool,
}

impl ResponsePartRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn replace_for_response(
        &self,
        response_id: &str,
        loom_id: &str,
        markdown: &str,
    ) -> Result<Vec<ResponsePartRecord>, ServiceError> {
        replace_parts_for_response(&self.pool, response_id, loom_id, markdown).await
    }

    pub async fn list_by_response(
        &self,
        response_id: &str,
    ) -> Result<Vec<ResponsePartRecord>, ServiceError> {
        list_parts_by_response(&self.pool, response_id).await
    }

    pub async fn list_by_loom(
        &self,
        loom_id: &str,
    ) -> Result<Vec<ResponsePartRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM response_parts
             WHERE loom_id = ?1
             ORDER BY response_id ASC, sequence_index ASC",
        )
        .bind(loom_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(part_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list Response parts for Loom: {error}"))
        })
    }

    pub async fn list_by_kind(
        &self,
        loom_id: &str,
        part_kind: &str,
    ) -> Result<Vec<ResponsePartRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM response_parts
             WHERE loom_id = ?1 AND part_kind = ?2
             ORDER BY response_id ASC, sequence_index ASC",
        )
        .bind(loom_id)
        .bind(part_kind)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(part_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list Response parts by kind: {error}"))
        })
    }
}

pub async fn replace_parts_for_response(
    pool: &SqlitePool,
    response_id: &str,
    loom_id: &str,
    markdown: &str,
) -> Result<Vec<ResponsePartRecord>, ServiceError> {
    reject_forbidden_payload(Some(markdown))?;
    let code_blocks = list_code_blocks_by_response(pool, response_id).await?;
    let parts = extract_response_parts(markdown, &code_blocks)?;
    replace_parts(pool, response_id, loom_id, parts).await?;
    list_parts_by_response(pool, response_id).await
}

pub(crate) async fn clear_parts_for_response(
    pool: &SqlitePool,
    response_id: &str,
) -> Result<(), ServiceError> {
    sqlx::query("DELETE FROM response_parts WHERE response_id = ?1")
        .bind(response_id)
        .execute(pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to clear Response parts: {error}"))
        })?;
    Ok(())
}

fn extract_response_parts(
    markdown: &str,
    code_blocks: &[ResponseCodeBlockRecord],
) -> Result<Vec<NewResponsePart>, ServiceError> {
    reject_forbidden_payload(Some(markdown))?;
    let mut parts = Vec::new();
    let mut cursor = 0usize;
    let mut code_block_index = 0i64;

    while let Some(line) = next_line(markdown, cursor) {
        if line.body.trim().is_empty() {
            cursor = line.next_start;
            continue;
        }

        if let Some(opening) = parse_opening_fence(line.body) {
            let block_start = line.start;
            let mut search = line.next_start;
            let mut block_end = None;
            while let Some(candidate) = next_line(markdown, search) {
                if is_closing_fence(candidate.body, opening.marker, opening.length) {
                    block_end = Some(candidate.next_start);
                    cursor = candidate.next_start;
                    break;
                }
                search = candidate.next_start;
            }
            let Some(block_end) = block_end else {
                break;
            };
            let code_block = code_blocks
                .iter()
                .find(|block| block.block_index == code_block_index);
            let metadata_json = if code_block.is_some() {
                None
            } else {
                Some(serde_json::json!({ "warning": "missing_code_block_artifact" }).to_string())
            };
            parts.push(NewResponsePart {
                sequence_index: parts.len() as i64,
                part_kind: "code_block".to_string(),
                content: None,
                markdown: Some(markdown[block_start..block_end].to_string()),
                code_block_id: code_block.map(|block| block.code_block_id.clone()),
                metadata_json,
            });
            code_block_index += 1;
            continue;
        }

        if is_heading(line.body) {
            let block = markdown[line.start..line.next_start].to_string();
            parts.push(part(
                parts.len() as i64,
                "heading",
                Some(strip_heading(line.body)),
                Some(block),
            ));
            cursor = line.next_start;
            continue;
        }

        if is_table_start(markdown, line.start) {
            let block_start = line.start;
            let mut end = line.start;
            let mut search = line.start;
            while let Some(candidate) = next_line(markdown, search) {
                if !is_markdown_table_line(candidate.body) {
                    break;
                }
                end = candidate.next_start;
                search = candidate.next_start;
            }
            parts.push(part(
                parts.len() as i64,
                "table",
                Some(
                    markdown[block_start..end]
                        .trim_end_matches('\n')
                        .to_string(),
                ),
                Some(markdown[block_start..end].to_string()),
            ));
            cursor = end;
            continue;
        }

        if is_list_item(line.body) {
            let block_start = line.start;
            let mut end = line.next_start;
            let mut search = line.next_start;
            while let Some(candidate) = next_line(markdown, search) {
                if !is_list_item(candidate.body) {
                    break;
                }
                end = candidate.next_start;
                search = candidate.next_start;
            }
            parts.push(part(
                parts.len() as i64,
                "list",
                Some(
                    markdown[block_start..end]
                        .trim_end_matches('\n')
                        .to_string(),
                ),
                Some(markdown[block_start..end].to_string()),
            ));
            cursor = end;
            continue;
        }

        if is_quote(line.body) {
            let block_start = line.start;
            let mut end = line.next_start;
            let mut search = line.next_start;
            while let Some(candidate) = next_line(markdown, search) {
                if !is_quote(candidate.body) {
                    break;
                }
                end = candidate.next_start;
                search = candidate.next_start;
            }
            parts.push(part(
                parts.len() as i64,
                "quote",
                Some(
                    markdown[block_start..end]
                        .trim_end_matches('\n')
                        .to_string(),
                ),
                Some(markdown[block_start..end].to_string()),
            ));
            cursor = end;
            continue;
        }

        let block_start = line.start;
        let mut end = line.next_start;
        let mut search = line.next_start;
        while let Some(candidate) = next_line(markdown, search) {
            if candidate.body.trim().is_empty()
                || parse_opening_fence(candidate.body).is_some()
                || is_heading(candidate.body)
                || is_table_start(markdown, candidate.start)
                || is_list_item(candidate.body)
                || is_quote(candidate.body)
            {
                break;
            }
            end = candidate.next_start;
            search = candidate.next_start;
        }
        let markdown_block = markdown[block_start..end].to_string();
        let content = markdown_block.trim_end_matches('\n').to_string();
        let kind = classify_text_part(&content);
        parts.push(part(
            parts.len() as i64,
            kind,
            Some(content),
            Some(markdown_block),
        ));
        cursor = end;
    }

    Ok(parts)
}

async fn replace_parts(
    pool: &SqlitePool,
    response_id: &str,
    loom_id: &str,
    parts: Vec<NewResponsePart>,
) -> Result<(), ServiceError> {
    let now = timestamp();
    let mut transaction = pool.begin().await.map_err(|error| {
        ServiceError::storage(format!(
            "failed to start Response part transaction: {error}"
        ))
    })?;
    sqlx::query("DELETE FROM response_parts WHERE response_id = ?1")
        .bind(response_id)
        .execute(&mut transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to clear Response parts: {error}"))
        })?;

    for response_part in parts {
        reject_forbidden_payload(response_part.content.as_deref())?;
        reject_forbidden_payload(response_part.markdown.as_deref())?;
        reject_forbidden_payload(response_part.metadata_json.as_deref())?;
        let part_id = format!(
            "part-{response_id}-{}-{}",
            response_part.sequence_index, response_part.part_kind
        );
        sqlx::query(
            "INSERT INTO response_parts (
                part_id, response_id, loom_id, sequence_index, part_kind, content, markdown,
                code_block_id, metadata_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind(part_id)
        .bind(response_id)
        .bind(loom_id)
        .bind(response_part.sequence_index)
        .bind(&response_part.part_kind)
        .bind(&response_part.content)
        .bind(&response_part.markdown)
        .bind(&response_part.code_block_id)
        .bind(&response_part.metadata_json)
        .bind(&now)
        .bind(&now)
        .execute(&mut transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert Response part: {error}"))
        })?;
    }

    transaction.commit().await.map_err(|error| {
        ServiceError::storage(format!(
            "failed to commit Response part transaction: {error}"
        ))
    })?;
    Ok(())
}

async fn list_parts_by_response(
    pool: &SqlitePool,
    response_id: &str,
) -> Result<Vec<ResponsePartRecord>, ServiceError> {
    sqlx::query(
        "SELECT * FROM response_parts
         WHERE response_id = ?1
         ORDER BY sequence_index ASC",
    )
    .bind(response_id)
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(part_from_row).collect())
    .map_err(|error| ServiceError::storage(format!("failed to list Response parts: {error}")))
}

fn part_from_row(row: sqlx::sqlite::SqliteRow) -> ResponsePartRecord {
    ResponsePartRecord {
        part_id: row.get("part_id"),
        response_id: row.get("response_id"),
        loom_id: row.get("loom_id"),
        sequence_index: row.get("sequence_index"),
        part_kind: row.get("part_kind"),
        content: row.get("content"),
        markdown: row.get("markdown"),
        code_block_id: row.get("code_block_id"),
        metadata_json: row.get("metadata_json"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn part(
    sequence_index: i64,
    part_kind: &str,
    content: Option<String>,
    markdown: Option<String>,
) -> NewResponsePart {
    NewResponsePart {
        sequence_index,
        part_kind: part_kind.to_string(),
        content,
        markdown,
        code_block_id: None,
        metadata_json: None,
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
    Some(OpeningFence { marker, length })
}

fn is_closing_fence(line: &str, marker: char, min_length: usize) -> bool {
    let trimmed = line.trim();
    let length = trimmed
        .chars()
        .take_while(|character| *character == marker)
        .count();
    length >= min_length && trimmed[length..].trim().is_empty()
}

fn is_heading(line: &str) -> bool {
    let trimmed = line.trim_start();
    let hashes = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    (1..=6).contains(&hashes) && trimmed[hashes..].starts_with(' ')
}

fn strip_heading(line: &str) -> String {
    line.trim_start().trim_start_matches('#').trim().to_string()
}

fn is_table_start(markdown: &str, start: usize) -> bool {
    let Some(first) = next_line(markdown, start) else {
        return false;
    };
    let Some(second) = next_line(markdown, first.next_start) else {
        return false;
    };
    is_markdown_table_line(first.body) && is_table_alignment_line(second.body)
}

fn is_markdown_table_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with('|') && trimmed.ends_with('|') && table_cells(trimmed).len() >= 2
}

fn is_table_alignment_line(line: &str) -> bool {
    let cells = table_cells(line);
    cells.len() >= 2
        && cells.iter().all(|cell| {
            let value = cell.trim();
            let stripped = value.trim_matches(':');
            stripped.len() >= 3 && stripped.chars().all(|character| character == '-')
        })
}

fn table_cells(line: &str) -> Vec<&str> {
    line.trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(str::trim)
        .collect()
}

fn is_list_item(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
        return true;
    }
    let digits = trimmed
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count();
    digits > 0 && trimmed[digits..].starts_with(". ")
}

fn is_quote(line: &str) -> bool {
    line.trim_start().starts_with('>')
}

fn classify_text_part(content: &str) -> &'static str {
    let lower = content.trim_start().to_lowercase();
    if lower.starts_with("warning:")
        || lower.starts_with("uyarı:")
        || lower.starts_with("dikkat:")
        || lower.starts_with("caution:")
    {
        "warning"
    } else if lower.starts_with("decision:") || lower.starts_with("karar:") {
        "decision"
    } else if lower.starts_with("example:")
        || lower.starts_with("örnek:")
        || lower.starts_with("ornek:")
    {
        "example"
    } else if lower.starts_with("answer:")
        || lower.starts_with("cevap:")
        || lower.starts_with("yanıt:")
    {
        "answer"
    } else if content.trim_end().ends_with('?') {
        "question"
    } else {
        "paragraph"
    }
}

fn reject_forbidden_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "Response part payload contains forbidden key {forbidden}"
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
    use super::{extract_response_parts, ResponsePartRepository};
    use crate::storage::{
        db::test_database,
        repositories::{
            code_blocks::ResponseCodeBlockRepository,
            looms::{LoomRepository, NewLoom},
            responses::{NewResponse, ResponseRepository},
        },
    };

    #[test]
    fn extracts_ordered_markdown_part_kinds() {
        let markdown = [
            "# Heading",
            "",
            "Paragraph one.",
            "",
            "- item a",
            "- item b",
            "",
            "1. first",
            "2. second",
            "",
            "| A | B |",
            "| :--- | :--- |",
            "| x | y |",
            "",
            "> quote",
            "",
            "```rust",
            "fn main() {}",
            "```",
        ]
        .join("\n");
        let parts = extract_response_parts(&markdown, &[]).expect("extract parts");
        let kinds = parts
            .iter()
            .map(|part| part.part_kind.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            kinds,
            vec![
                "heading",
                "paragraph",
                "list",
                "list",
                "table",
                "quote",
                "code_block"
            ]
        );
        assert_eq!(parts[0].content.as_deref(), Some("Heading"));
        assert_eq!(
            parts[4].markdown.as_deref(),
            Some("| A | B |\n| :--- | :--- |\n| x | y |\n")
        );
    }

    #[test]
    fn code_block_part_links_by_block_index_when_artifact_exists() {
        let code_blocks = vec![
            crate::storage::repositories::code_blocks::ResponseCodeBlockRecord {
                code_block_id: "codeblock-response-0-hash".to_string(),
                response_id: "response-1".to_string(),
                loom_id: "loom-1".to_string(),
                block_index: 0,
                language: Some("ts".to_string()),
                code: "const value = 1;\n".to_string(),
                exact_hash: "hash".to_string(),
                fence: Some("```".to_string()),
                metadata_json: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
            },
        ];
        let parts = extract_response_parts("```ts\nconst value = 1;\n```\n", &code_blocks)
            .expect("extract parts");

        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].part_kind, "code_block");
        assert_eq!(
            parts[0].code_block_id.as_deref(),
            Some("codeblock-response-0-hash")
        );
        assert!(parts[0].content.is_none());
        assert_eq!(
            parts[0].markdown.as_deref(),
            Some("```ts\nconst value = 1;\n```\n")
        );
    }

    #[test]
    fn raw_thinking_payloads_are_rejected() {
        let error = extract_response_parts("raw_thinking: private", &[])
            .expect_err("raw thinking rejected");

        assert!(error.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn response_insert_persists_parts_and_keeps_raw_markdown() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let markdown = "# Title\n\nParagraph.\n\n```ts\nconst value = 1;\n```\n";
        let responses = ResponseRepository::new(&database);
        responses
            .insert_response(&NewResponse {
                response_id: "response-parts".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: markdown.to_string(),
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

        let response = responses
            .get_response("response-parts")
            .await
            .expect("get response")
            .expect("response exists");
        let parts = ResponsePartRepository::new(&database)
            .list_by_response("response-parts")
            .await
            .expect("list parts");
        let code_blocks = ResponseCodeBlockRepository::new(&database)
            .list_by_response("response-parts")
            .await
            .expect("list code blocks");

        assert_eq!(response.content, markdown);
        assert_eq!(code_blocks.len(), 1);
        assert_eq!(
            parts
                .iter()
                .map(|part| part.part_kind.as_str())
                .collect::<Vec<_>>(),
            vec!["heading", "paragraph", "code_block"]
        );
        assert_eq!(
            parts[2].code_block_id.as_deref(),
            Some(code_blocks[0].code_block_id.as_str())
        );
    }

    #[tokio::test]
    async fn response_update_refreshes_parts_without_duplicates() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let responses = ResponseRepository::new(&database);
        responses
            .insert_response(&NewResponse {
                response_id: "response-update-parts".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "# Old\n\nOld paragraph.".to_string(),
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
            .update_response_content(
                "response-update-parts",
                "| A | B |\n| :--- | :--- |\n| x | y |\n",
            )
            .await
            .expect("update response");
        responses
            .update_response_content(
                "response-update-parts",
                "| A | B |\n| :--- | :--- |\n| x | y |\n",
            )
            .await
            .expect("repeat update");

        let parts = ResponsePartRepository::new(&database)
            .list_by_response("response-update-parts")
            .await
            .expect("list parts");

        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].part_kind, "table");
        assert_eq!(
            parts[0].markdown.as_deref(),
            Some("| A | B |\n| :--- | :--- |\n| x | y |\n")
        );
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
