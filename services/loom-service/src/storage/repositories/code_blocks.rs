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

    pub async fn list_by_loom(
        &self,
        loom_id: &str,
    ) -> Result<Vec<ResponseCodeBlockRecord>, ServiceError> {
        list_code_blocks_by_loom(&self.pool, loom_id).await
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
    let mut source_block_index = 0i64;
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
        let block_index = source_block_index;
        source_block_index += 1;
        if !is_reusable_code_artifact(opening.language.as_deref(), &code) {
            continue;
        }
        let exact_hash = stable_hash(&code);
        blocks.push(ExtractedCodeBlock {
            block_index,
            language: opening.language,
            code,
            exact_hash,
            fence: opening.fence,
        });
    }

    Ok(blocks)
}

pub fn is_reusable_code_artifact(language: Option<&str>, code: &str) -> bool {
    let language = normalized_language(language);
    if is_markdown_table_code_block(Some(&language), code)
        || contains_nested_fence(code)
        || looks_like_ascii_diagram(code)
        || looks_like_fake_artifact_metadata(code)
    {
        return false;
    }

    if is_strong_code_language(&language) {
        return contains_code_signal(code) || code.lines().any(|line| !line.trim().is_empty());
    }

    if is_data_language(&language) {
        return data_language_is_valid(&language, code);
    }

    if matches!(language.as_str(), "" | "text" | "txt" | "md" | "markdown") {
        return contains_code_signal(code) && !looks_like_explanatory_transcript(code);
    }

    contains_code_signal(code) && !looks_like_explanatory_transcript(code)
}

pub fn is_markdown_table_code_block(language: Option<&str>, code: &str) -> bool {
    let language = normalized_language(language);
    if !matches!(language.as_str(), "" | "text" | "txt" | "md" | "markdown") {
        return false;
    }
    let meaningful_lines = code
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if meaningful_lines.len() < 2 {
        return false;
    }
    let separator_index = meaningful_lines
        .iter()
        .position(|line| is_markdown_table_separator(line));
    let Some(index) = separator_index else {
        return false;
    };
    let header_before_separator = index > 0 && looks_like_table_row(meaningful_lines[index - 1]);
    let row_after_separator = meaningful_lines
        .get(index + 1)
        .is_some_and(|line| looks_like_table_row(line));
    header_before_separator && row_after_separator
}

fn normalized_language(language: Option<&str>) -> String {
    language.unwrap_or("").trim().to_ascii_lowercase()
}

fn is_strong_code_language(language: &str) -> bool {
    matches!(
        language,
        "bash"
            | "c"
            | "cpp"
            | "c++"
            | "csharp"
            | "c#"
            | "css"
            | "go"
            | "html"
            | "java"
            | "javascript"
            | "js"
            | "jsx"
            | "kotlin"
            | "php"
            | "python"
            | "py"
            | "ruby"
            | "rust"
            | "rs"
            | "sh"
            | "shell"
            | "sql"
            | "swift"
            | "tsx"
            | "ts"
            | "typescript"
            | "xml"
    )
}

fn is_data_language(language: &str) -> bool {
    matches!(language, "json" | "jsonc" | "toml" | "yaml" | "yml")
}

fn data_language_is_valid(language: &str, code: &str) -> bool {
    match language {
        "json" | "jsonc" => serde_json::from_str::<serde_json::Value>(code).is_ok(),
        "toml" | "yaml" | "yml" => code
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .any(|line| line.contains(':') || line.contains('=')),
        _ => false,
    }
}

fn contains_nested_fence(code: &str) -> bool {
    code.lines()
        .map(str::trim_start)
        .any(|line| line.starts_with("```") || line.starts_with("~~~"))
}

fn contains_code_signal(code: &str) -> bool {
    code.lines().any(|line| {
        let line = line.trim();
        if line.is_empty() {
            return false;
        }
        line.starts_with("fn ")
            || line.starts_with("def ")
            || line.starts_with("class ")
            || line.starts_with("interface ")
            || line.starts_with("type ")
            || line.starts_with("enum ")
            || line.starts_with("struct ")
            || line.starts_with("impl ")
            || line.starts_with("func ")
            || line.starts_with("function ")
            || line.starts_with("const ")
            || line.starts_with("let ")
            || line.starts_with("var ")
            || line.starts_with("export ")
            || line.starts_with("import ")
            || line.starts_with("SELECT ")
            || line.starts_with("select ")
            || line.starts_with("INSERT ")
            || line.starts_with("insert ")
            || line.starts_with("UPDATE ")
            || line.starts_with("update ")
            || line.starts_with("DELETE ")
            || line.starts_with("delete ")
            || line.starts_with("#!")
            || line.contains("=>")
            || line.contains("->")
            || line.contains("();")
            || line.contains(") {")
            || line.contains(" = ")
            || line.contains(":=")
    })
}

fn looks_like_ascii_diagram(code: &str) -> bool {
    let mut meaningful = 0usize;
    let mut diagram_like = 0usize;
    for line in code.lines().map(str::trim).filter(|line| !line.is_empty()) {
        meaningful += 1;
        let box_chars = line
            .chars()
            .filter(|character| {
                matches!(
                    character,
                    '┌' | '┐'
                        | '└'
                        | '┘'
                        | '─'
                        | '│'
                        | '├'
                        | '┤'
                        | '┬'
                        | '┴'
                        | '┼'
                        | '═'
                        | '║'
                        | '╔'
                        | '╗'
                        | '╚'
                        | '╝'
                        | '╠'
                        | '╣'
                        | '╦'
                        | '╩'
                        | '╬'
                )
            })
            .count();
        let arrow_chars = line.matches("->").count()
            + line.matches("=>").count()
            + line.matches("←").count()
            + line.matches("→").count()
            + line.matches("▼").count();
        if box_chars >= 2
            || arrow_chars > 0
            || line
                .chars()
                .all(|character| matches!(character, '-' | '+' | '|' | ' '))
        {
            diagram_like += 1;
        }
    }

    meaningful >= 3 && diagram_like * 2 >= meaningful
}

fn looks_like_fake_artifact_metadata(code: &str) -> bool {
    let lower = code.to_ascii_lowercase();
    let markers = [
        "hash:",
        "hash generation",
        "type classification",
        "storage reference",
        "storage reference assignment",
        "provenance:",
        "provenance chain",
        "provenance metadata",
        "[timestamp, user, tool]",
        "code-001",
        "artifact referans id",
        "artifact reference id",
        "unique code id",
        "metadata population",
        "artifact creation",
        "runtime-generated",
    ];
    let marker_count = markers
        .iter()
        .filter(|marker| lower.contains(**marker))
        .count();
    let placeholder_id = lower
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '-')
        .any(|token| {
            let Some(rest) = token.strip_prefix("code-") else {
                return false;
            };
            rest.len() >= 3 && rest.chars().all(|character| character.is_ascii_digit())
        });

    marker_count >= 2 || (marker_count >= 1 && placeholder_id)
}

fn looks_like_explanatory_transcript(code: &str) -> bool {
    let lower = code.to_ascii_lowercase();
    lower.contains("user:") && lower.contains("assistant:")
}

fn looks_like_table_row(line: &str) -> bool {
    line.matches('|').count() >= 2
}

fn is_markdown_table_separator(line: &str) -> bool {
    let trimmed = line.trim().trim_matches('|').trim();
    if trimmed.is_empty() || !trimmed.contains('|') {
        return false;
    }
    trimmed.split('|').all(|cell| {
        let cell = cell.trim();
        let dash_count = cell.chars().filter(|character| *character == '-').count();
        dash_count >= 3
            && cell
                .chars()
                .all(|character| matches!(character, '-' | ':' | ' '))
    })
}

pub async fn cleanup_pseudo_artifact_blocks(pool: &SqlitePool) -> Result<usize, ServiceError> {
    let rows = sqlx::query("SELECT code_block_id, language, code FROM response_code_blocks")
        .fetch_all(pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to fetch code blocks for cleanup: {error}"))
        })?;

    let pseudo_artifact_ids: Vec<String> = rows
        .into_iter()
        .filter_map(|row| {
            let code_block_id: String = row.get("code_block_id");
            let language: Option<String> = row.get("language");
            let code: String = row.get("code");
            if is_reusable_code_artifact(language.as_deref(), &code) {
                None
            } else {
                Some(code_block_id)
            }
        })
        .collect();

    if pseudo_artifact_ids.is_empty() {
        return Ok(0);
    }

    let count = pseudo_artifact_ids.len();
    let mut transaction = pool.begin().await.map_err(|error| {
        ServiceError::storage(format!("failed to start cleanup transaction: {error}"))
    })?;

    for id in &pseudo_artifact_ids {
        sqlx::query("UPDATE response_parts SET code_block_id = NULL WHERE code_block_id = ?1")
            .bind(id)
            .execute(&mut transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to detach response_part for {id}: {error}"))
            })?;

        sqlx::query("DELETE FROM context_graph_links WHERE source_id = ?1")
            .bind(id)
            .execute(&mut transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to remove graph links for {id}: {error}"))
            })?;

        sqlx::query("DELETE FROM response_code_blocks WHERE code_block_id = ?1")
            .bind(id)
            .execute(&mut transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to delete pseudo-artifact {id}: {error}"))
            })?;
    }

    transaction.commit().await.map_err(|error| {
        ServiceError::storage(format!("failed to commit pseudo-artifact cleanup: {error}"))
    })?;

    Ok(count)
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
    .map(|rows| {
        rows.into_iter()
            .map(code_block_from_row)
            .filter(|block| is_reusable_code_artifact(block.language.as_deref(), &block.code))
            .collect()
    })
    .map_err(|error| ServiceError::storage(format!("failed to list Response code blocks: {error}")))
}

pub(crate) async fn list_code_blocks_by_loom(
    pool: &SqlitePool,
    loom_id: &str,
) -> Result<Vec<ResponseCodeBlockRecord>, ServiceError> {
    sqlx::query(
        "SELECT * FROM response_code_blocks
         WHERE loom_id = ?1
         ORDER BY response_id ASC, block_index ASC",
    )
    .bind(loom_id)
    .fetch_all(pool)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(code_block_from_row)
            .filter(|block| is_reusable_code_artifact(block.language.as_deref(), &block.code))
            .collect()
    })
    .map_err(|error| ServiceError::storage(format!("failed to list Loom code blocks: {error}")))
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
    use super::{
        extract_fenced_code_blocks, is_markdown_table_code_block, is_reusable_code_artifact,
        ResponseCodeBlockRepository,
    };
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

    #[test]
    fn markdown_table_fences_are_not_code_block_artifacts() {
        let markdown =
            "Table\n```text\n| Metric | Value |\n| --- | --- |\n| Latency | 10ms |\n```\n";

        let blocks = extract_fenced_code_blocks(markdown).expect("extract blocks");

        assert!(blocks.is_empty());
        assert!(is_markdown_table_code_block(
            Some("markdown"),
            "| A | B |\n| --- | --- |\n| 1 | 2 |\n"
        ));
    }

    #[test]
    fn pipe_heavy_real_code_is_still_indexed_as_code() {
        let markdown = "```ts\nconst label = value === \"a\" ? \"A\" : \"B\";\nconst match = left | right;\n```\n";

        let blocks = extract_fenced_code_blocks(markdown).expect("extract blocks");

        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].language.as_deref(), Some("ts"));
    }

    #[test]
    fn illustrative_ascii_box_diagrams_are_not_code_artifacts() {
        let markdown = "```text\n┌──────────────┐\n│ Artifact Box │\n└──────────────┘\n```\n";

        let blocks = extract_fenced_code_blocks(markdown).expect("extract blocks");

        assert!(blocks.is_empty());
        assert!(!is_reusable_code_artifact(
            None,
            "┌──────────────┐\n│ Artifact Box │\n└──────────────┘\n"
        ));
    }

    #[test]
    fn fake_hash_provenance_and_code_ids_are_not_code_artifacts() {
        let markdown = "```text\nAssistant: Kod review artifact'ı oluşturulur\n- Hash: abc123def456\n- Type: Security Analysis\n- Provenance: [timestamp, user, tool]\n```\n\n```text\nAssistant: Evet, artifact referans ID: CODE-001\nYerel storage'da erişilebilir.\n```\n";

        let blocks = extract_fenced_code_blocks(markdown).expect("extract blocks");

        assert!(blocks.is_empty());
        assert!(!is_reusable_code_artifact(
            Some("text"),
            "Assistant: Kod review artifact'ı oluşturulur\n- Hash: abc123def456\n- Type: Security Analysis\n- Provenance: [timestamp, user, tool]\n"
        ));
        assert!(!is_reusable_code_artifact(
            Some("text"),
            "Assistant: Evet, artifact referans ID: CODE-001\nYerel storage'da erişilebilir.\n"
        ));
    }

    #[test]
    fn nested_fences_are_not_promoted_as_single_code_artifact() {
        let markdown = "```\nUser: \"Bu fonksiyon nasıl optimize ediliyor?\"\nAssistant:\n```python\ndef optimize_query(query):\n    return query.optimized\n```\n";

        let blocks = extract_fenced_code_blocks(markdown).expect("extract blocks");

        assert!(blocks.is_empty());
    }

    #[test]
    fn skipped_illustrative_blocks_do_not_shift_real_code_block_indexes() {
        let markdown =
            "```text\n┌────┐\n│ UI │\n└────┘\n```\n\n```rust\nfn replay_events() {\n    apply();\n}\n```\n";

        let blocks = extract_fenced_code_blocks(markdown).expect("extract blocks");

        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].block_index, 1);
        assert_eq!(blocks[0].language.as_deref(), Some("rust"));
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

    // ──────────────────────────────────────────────────────────────────────────
    // cleanup_pseudo_artifact_blocks
    // ──────────────────────────────────────────────────────────────────────────

    /// Insert a pseudo-artifact code block directly into the DB (bypassing the
    /// repository's `is_reusable_code_artifact` gate, which simulates the
    /// pre-authority-boundary state), then verify cleanup removes it and its
    /// associated context_graph_link.
    #[tokio::test]
    async fn cleanup_pseudo_artifact_blocks_removes_stale_blocks_and_links() {
        use super::cleanup_pseudo_artifact_blocks;

        let database = test_database().await;
        insert_test_loom(&database).await;

        // Insert a minimal response so the FK constraint is satisfied.
        ResponseRepository::new(&database)
            .insert_response(&NewResponse {
                response_id: "resp-pseudo".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Illustrative block follows.".to_string(),
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

        // Directly insert a pseudo-artifact code block (ASCII box-drawing diagram).
        // This bypasses extract_fenced_code_blocks and simulates legacy data.
        let pseudo_block_id = "codeblock-resp-pseudo-0-fnv1a64:0000000000000000";
        sqlx::query(
            "INSERT INTO response_code_blocks (
                code_block_id, response_id, loom_id, block_index, language, code,
                exact_hash, fence, metadata_json, created_at, updated_at
            ) VALUES (?1, 'resp-pseudo', 'loom-1', 0, 'text',
                      '┌────────┐\n│ Pseudo │\n└────────┘\n',
                      'fnv1a64:0000000000000000', '```', NULL, '1', '1')",
        )
        .bind(pseudo_block_id)
        .execute(database.pool())
        .await
        .expect("insert pseudo-artifact code block");

        // Insert a context_graph_link that references this pseudo-artifact block.
        sqlx::query(
            "INSERT INTO context_graph_links (
                link_id, loom_id, source_kind, source_id, target_kind, target_id,
                link_kind, weight, metadata_json, created_at
            ) VALUES ('link-pseudo-1', 'loom-1', 'code_block', ?1, 'response',
                      'resp-pseudo', 'code_for', 0.86, NULL, '1')",
        )
        .bind(pseudo_block_id)
        .execute(database.pool())
        .await
        .expect("insert pseudo graph link");

        // Run cleanup.
        let removed = cleanup_pseudo_artifact_blocks(database.pool())
            .await
            .expect("cleanup_pseudo_artifact_blocks");
        assert_eq!(removed, 1, "one pseudo-artifact block should be removed");

        // Verify the code block is gone.
        let block_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM response_code_blocks WHERE code_block_id = ?1",
        )
        .bind(pseudo_block_id)
        .fetch_one(database.pool())
        .await
        .expect("count code blocks");
        assert_eq!(block_count, 0, "pseudo-artifact code block must be deleted");

        // Verify the graph link is gone.
        let link_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM context_graph_links WHERE source_id = ?1",
        )
        .bind(pseudo_block_id)
        .fetch_one(database.pool())
        .await
        .expect("count graph links");
        assert_eq!(link_count, 0, "graph link for pseudo-artifact must be deleted");
    }

    /// A real code block must survive `cleanup_pseudo_artifact_blocks`.
    #[tokio::test]
    async fn cleanup_pseudo_artifact_blocks_preserves_real_code_blocks() {
        use super::cleanup_pseudo_artifact_blocks;

        let database = test_database().await;
        insert_test_loom(&database).await;

        ResponseRepository::new(&database)
            .insert_response(&NewResponse {
                response_id: "resp-real".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "```rust\nfn replay() -> Vec<Event> {\n    vec![]\n}\n```".to_string(),
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

        let removed = cleanup_pseudo_artifact_blocks(database.pool())
            .await
            .expect("cleanup");
        assert_eq!(removed, 0, "real code blocks must not be removed");

        let block_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM response_code_blocks WHERE response_id = 'resp-real'",
        )
        .fetch_one(database.pool())
        .await
        .expect("count blocks");
        assert_eq!(block_count, 1, "real code block must survive cleanup");
    }

    /// Running `cleanup_pseudo_artifact_blocks` twice must return 0 on the
    /// second call — confirms idempotency.
    #[tokio::test]
    async fn cleanup_pseudo_artifact_blocks_is_idempotent() {
        use super::cleanup_pseudo_artifact_blocks;

        let database = test_database().await;
        insert_test_loom(&database).await;

        ResponseRepository::new(&database)
            .insert_response(&NewResponse {
                response_id: "resp-idem".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "No code.".to_string(),
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

        // Plant a pseudo-artifact block directly.
        sqlx::query(
            "INSERT INTO response_code_blocks (
                code_block_id, response_id, loom_id, block_index, language, code,
                exact_hash, fence, metadata_json, created_at, updated_at
            ) VALUES ('codeblock-idem', 'resp-idem', 'loom-1', 0, 'text',
                      'Hash: abc123\nProvenance: [timestamp, user, tool]\n',
                      'fnv1a64:aaaaaaaaaaaaaaaa', '```', NULL, '1', '1')",
        )
        .execute(database.pool())
        .await
        .expect("insert pseudo block");

        let first = cleanup_pseudo_artifact_blocks(database.pool())
            .await
            .expect("first cleanup");
        assert_eq!(first, 1);

        let second = cleanup_pseudo_artifact_blocks(database.pool())
            .await
            .expect("second cleanup");
        assert_eq!(second, 0, "idempotent: nothing to remove on second call");
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
