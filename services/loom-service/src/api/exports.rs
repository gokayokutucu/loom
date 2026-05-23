use crate::{
    api::{graph, state::AppState},
    error::ServiceError,
    storage::{
        db::Database,
        repositories::{
            bookmarks::{BookmarkRecord, BookmarkRepository},
            looms::{LoomRecord, LoomRepository},
            references::{ReferenceRecord, ReferenceRepository},
            responses::{ResponseRecord, ResponseRepository},
        },
    },
};
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLoomRequest {
    pub loom_id: String,
    pub format: ExportFormat,
    #[serde(default)]
    pub include_metadata: bool,
    #[serde(default)]
    pub include_references: bool,
    #[serde(default)]
    pub include_bookmarks: bool,
    #[serde(default)]
    pub include_graph: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResponseRequest {
    pub response_id: String,
    pub format: ExportFormat,
    #[serde(default)]
    pub include_metadata: bool,
    #[serde(default)]
    pub include_references: bool,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Markdown,
    Csv,
    Json,
    Zip,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportResponse {
    pub file_name: String,
    pub mime_type: String,
    pub content_base64: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportApiError {
    pub code: String,
    pub message: String,
}

#[derive(Debug)]
pub(crate) enum ExportError {
    NotFound(&'static str),
    Unsupported(&'static str),
    Storage(ServiceError),
    Serialization(String),
}

struct LoomExportData {
    loom: LoomRecord,
    responses: Vec<ResponseRecord>,
    references: Vec<ReferenceRecord>,
    bookmarks: Vec<BookmarkRecord>,
}

struct ResponseExportData {
    response: ResponseRecord,
    loom: LoomRecord,
    references: Vec<ReferenceRecord>,
}

pub async fn export_loom(
    State(state): State<AppState>,
    Json(input): Json<ExportLoomRequest>,
) -> Result<Json<ExportResponse>, (StatusCode, Json<ExportApiError>)> {
    export_loom_impl(&state.database, input)
        .await
        .map(Json)
        .map_err(export_error)
}

pub async fn export_response(
    State(state): State<AppState>,
    Json(input): Json<ExportResponseRequest>,
) -> Result<Json<ExportResponse>, (StatusCode, Json<ExportApiError>)> {
    export_response_impl(&state.database, input)
        .await
        .map(Json)
        .map_err(export_error)
}

pub(crate) async fn export_loom_impl(
    database: &Database,
    input: ExportLoomRequest,
) -> Result<ExportResponse, ExportError> {
    let data = load_loom_export_data(database, &input.loom_id).await?;
    match input.format {
        ExportFormat::Markdown => {
            let mut warnings = Vec::new();
            let markdown = loom_markdown(&data, &input, &mut warnings);
            Ok(text_export(
                markdown_filename("loom", &data.loom.loom_id, &data.loom.title, "md"),
                "text/markdown; charset=utf-8",
                markdown,
                warnings,
            ))
        }
        ExportFormat::Csv => {
            let csv = loom_csv(&data.responses);
            Ok(text_export(
                markdown_filename("loom", &data.loom.loom_id, &data.loom.title, "csv"),
                "text/csv; charset=utf-8",
                csv,
                Vec::new(),
            ))
        }
        ExportFormat::Json => {
            let mut warnings = Vec::new();
            let json = loom_json(database, &data, &input, &mut warnings).await?;
            Ok(text_export(
                markdown_filename("loom", &data.loom.loom_id, &data.loom.title, "json"),
                "application/json; charset=utf-8",
                json,
                warnings,
            ))
        }
        ExportFormat::Zip => loom_zip(database, &data, &input).await,
    }
}

async fn export_response_impl(
    database: &Database,
    input: ExportResponseRequest,
) -> Result<ExportResponse, ExportError> {
    let data = load_response_export_data(database, &input.response_id).await?;
    match input.format {
        ExportFormat::Markdown => {
            let mut warnings = Vec::new();
            let markdown = response_markdown(&data, &input, &mut warnings);
            Ok(text_export(
                markdown_filename(
                    "response",
                    &data.response.response_id,
                    data.response
                        .title
                        .as_deref()
                        .unwrap_or(&data.response.role),
                    "md",
                ),
                "text/markdown; charset=utf-8",
                markdown,
                warnings,
            ))
        }
        ExportFormat::Json => {
            let mut warnings = Vec::new();
            let json = response_json(&data, &input, &mut warnings)?;
            Ok(text_export(
                markdown_filename(
                    "response",
                    &data.response.response_id,
                    data.response
                        .title
                        .as_deref()
                        .unwrap_or(&data.response.role),
                    "json",
                ),
                "application/json; charset=utf-8",
                json,
                warnings,
            ))
        }
        ExportFormat::Csv | ExportFormat::Zip => Err(ExportError::Unsupported(
            "Response exports support markdown and json formats",
        )),
    }
}

async fn load_loom_export_data(
    database: &Database,
    loom_id: &str,
) -> Result<LoomExportData, ExportError> {
    let looms = LoomRepository::new(database);
    let responses = ResponseRepository::new(database);
    let references = ReferenceRepository::new(database);
    let bookmarks = BookmarkRepository::new(database);
    let loom = looms
        .get_loom(loom_id)
        .await
        .map_err(ExportError::Storage)?
        .ok_or(ExportError::NotFound("Loom"))?;
    let responses = responses
        .list_responses_for_loom(loom_id)
        .await
        .map_err(ExportError::Storage)?;
    let references = references
        .list_references_for_loom(loom_id)
        .await
        .map_err(ExportError::Storage)?;
    let bookmarks = bookmarks
        .list_bookmarks()
        .await
        .map_err(ExportError::Storage)?
        .into_iter()
        .filter(|bookmark| bookmark_belongs_to_loom(bookmark, &loom, &responses))
        .collect();

    Ok(LoomExportData {
        loom,
        responses,
        references,
        bookmarks,
    })
}

async fn load_response_export_data(
    database: &Database,
    response_id: &str,
) -> Result<ResponseExportData, ExportError> {
    let looms = LoomRepository::new(database);
    let responses = ResponseRepository::new(database);
    let references = ReferenceRepository::new(database);
    let response = responses
        .get_response(response_id)
        .await
        .map_err(ExportError::Storage)?
        .ok_or(ExportError::NotFound("Response"))?;
    let loom = looms
        .get_loom(&response.loom_id)
        .await
        .map_err(ExportError::Storage)?
        .ok_or(ExportError::NotFound("Parent Loom"))?;
    let references = references
        .list_references_for_loom(&response.loom_id)
        .await
        .map_err(ExportError::Storage)?
        .into_iter()
        .filter(|reference| reference_mentions_response(reference, response_id))
        .collect();

    Ok(ResponseExportData {
        response,
        loom,
        references,
    })
}

fn loom_markdown(
    data: &LoomExportData,
    input: &ExportLoomRequest,
    warnings: &mut Vec<String>,
) -> String {
    let mut output = String::new();
    output.push_str(&format!("# {}\n\n", safe_text(&data.loom.title)));
    if let Some(summary) = data.loom.summary.as_deref().and_then(safe_text_option) {
        output.push_str(&format!("{summary}\n\n"));
    }
    output.push_str("## Metadata\n\n");
    output.push_str(&format!("- Loom ID: {}\n", data.loom.loom_id));
    if let Some(code) = &data.loom.code {
        output.push_str(&format!("- Code: {}\n", safe_text(code)));
    }
    if let Some(uri) = &data.loom.canonical_uri {
        output.push_str(&format!("- URI: {}\n", safe_text(uri)));
    }
    output.push_str(&format!("- Created: {}\n", data.loom.created_at));
    output.push_str(&format!("- Updated: {}\n\n", data.loom.updated_at));

    output.push_str("## Conversation\n\n");
    for response in &data.responses {
        output.push_str(&format!("### {}\n\n", title_case(&response.role)));
        if let Some(title) = response.title.as_deref().and_then(safe_text_option) {
            output.push_str(&format!("**{}**\n\n", title));
        }
        output.push_str(&safe_text(&response.content));
        output.push_str("\n\n");
    }

    if input.include_references {
        append_references_markdown(&mut output, &data.references, warnings);
    }
    if input.include_bookmarks {
        append_bookmarks_markdown(&mut output, &data.bookmarks, warnings);
    }
    if input.include_graph {
        output.push_str("## Graph Summary\n\n");
        output.push_str(&format!("- Responses: {}\n", data.responses.len()));
        output.push_str("- Graph JSON is available in metadata/ZIP exports when requested.\n\n");
    }
    if input.include_metadata {
        output.push_str("## Export Metadata\n\n");
        output.push_str("- Format: markdown\n");
        output.push_str("- Raw model thinking: excluded\n\n");
    }

    output
}

fn response_markdown(
    data: &ResponseExportData,
    input: &ExportResponseRequest,
    warnings: &mut Vec<String>,
) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "# {}\n\n",
        data.response
            .title
            .as_deref()
            .map(safe_text)
            .unwrap_or_else(|| format!("{} Response", title_case(&data.response.role)))
    ));
    output.push_str("## Metadata\n\n");
    output.push_str(&format!("- Response ID: {}\n", data.response.response_id));
    output.push_str(&format!("- Parent Loom: {}\n", safe_text(&data.loom.title)));
    output.push_str(&format!("- Parent Loom ID: {}\n", data.loom.loom_id));
    output.push_str(&format!("- Role: {}\n", data.response.role));
    if let Some(code) = &data.response.code {
        output.push_str(&format!("- Code: {}\n", safe_text(code)));
    }
    if let Some(uri) = &data.response.canonical_uri {
        output.push_str(&format!("- URI: {}\n", safe_text(uri)));
    }
    output.push('\n');
    output.push_str("## Content\n\n");
    output.push_str(&safe_text(&data.response.content));
    output.push_str("\n\n");

    if input.include_references {
        append_references_markdown(&mut output, &data.references, warnings);
    }
    if input.include_metadata {
        output.push_str("## Export Metadata\n\n");
        output.push_str("- Format: markdown\n");
        output.push_str("- Raw model thinking: excluded\n\n");
    }

    output
}

fn append_references_markdown(
    output: &mut String,
    references: &[ReferenceRecord],
    warnings: &mut Vec<String>,
) {
    if references.is_empty() {
        return;
    }
    output.push_str("## References\n\n");
    for reference in references {
        if contains_forbidden_payload(reference.metadata_json.as_deref()) {
            push_unique_warning(warnings, "raw_thinking_metadata_sanitized");
        }
        output.push_str(&format!("- Reference ID: {}", reference.reference_id));
        if let Some(label) = reference.label.as_deref().and_then(safe_text_option) {
            output.push_str(&format!(" - {label}"));
        }
        if let Some(selected_text) = reference
            .selected_text
            .as_deref()
            .and_then(safe_text_option)
        {
            output.push_str(&format!(" - \"{}\"", truncate_chars(&selected_text, 160)));
        }
        output.push('\n');
    }
    output.push('\n');
}

fn append_bookmarks_markdown(
    output: &mut String,
    bookmarks: &[BookmarkRecord],
    warnings: &mut Vec<String>,
) {
    if bookmarks.is_empty() {
        return;
    }
    output.push_str("## Bookmarks\n\n");
    for bookmark in bookmarks {
        if contains_forbidden_payload(bookmark.metadata_json.as_deref()) {
            push_unique_warning(warnings, "raw_thinking_metadata_sanitized");
        }
        output.push_str(&format!(
            "- {} ({})\n",
            safe_text(&bookmark.title),
            bookmark.bookmark_id
        ));
    }
    output.push('\n');
}

fn loom_csv(responses: &[ResponseRecord]) -> String {
    let mut output =
        "sequence_index,response_id,role,title,code,canonical_uri,created_at,updated_at,content\n"
            .to_string();
    for response in responses {
        let row = [
            response.sequence_index.to_string(),
            response.response_id.clone(),
            response.role.clone(),
            response.title.clone().unwrap_or_default(),
            response.code.clone().unwrap_or_default(),
            response.canonical_uri.clone().unwrap_or_default(),
            response.created_at.clone(),
            response.updated_at.clone(),
            safe_text(&response.content),
        ];
        output.push_str(
            &row.iter()
                .map(|value| csv_escape(value))
                .collect::<Vec<_>>()
                .join(","),
        );
        output.push('\n');
    }
    output
}

async fn loom_json(
    database: &Database,
    data: &LoomExportData,
    input: &ExportLoomRequest,
    warnings: &mut Vec<String>,
) -> Result<String, ExportError> {
    let mut root = Map::new();
    root.insert("loom".to_string(), loom_value(&data.loom));
    root.insert(
        "responses".to_string(),
        Value::Array(
            data.responses
                .iter()
                .map(|response| response_value(response, input.include_metadata, warnings))
                .collect(),
        ),
    );
    if input.include_references {
        root.insert(
            "references".to_string(),
            Value::Array(
                data.references
                    .iter()
                    .map(|reference| reference_value(reference, warnings))
                    .collect(),
            ),
        );
    }
    if input.include_bookmarks {
        root.insert(
            "bookmarks".to_string(),
            Value::Array(
                data.bookmarks
                    .iter()
                    .map(|bookmark| bookmark_value(bookmark, warnings))
                    .collect(),
            ),
        );
    }
    if input.include_graph {
        let graph = graph::graph_projection_for_export(
            database,
            &data.loom.loom_id,
            input.include_references,
            input.include_bookmarks,
        )
        .await
        .map_err(ExportError::Storage)?;
        if let Some(graph) = graph {
            root.insert(
                "graph".to_string(),
                serde_json::to_value(graph)
                    .map_err(|error| ExportError::Serialization(error.to_string()))?,
            );
        }
    }
    root.insert(
        "export".to_string(),
        serde_json::json!({
            "format": "json",
            "rawThinking": "excluded"
        }),
    );
    root.insert(
        "warnings".to_string(),
        Value::Array(
            warnings
                .iter()
                .map(|warning| Value::String(warning.clone()))
                .collect(),
        ),
    );

    serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|error| ExportError::Serialization(error.to_string()))
}

fn response_json(
    data: &ResponseExportData,
    input: &ExportResponseRequest,
    warnings: &mut Vec<String>,
) -> Result<String, ExportError> {
    let mut root = Map::new();
    root.insert("loom".to_string(), loom_value(&data.loom));
    root.insert(
        "response".to_string(),
        response_value(&data.response, input.include_metadata, warnings),
    );
    if input.include_references {
        root.insert(
            "references".to_string(),
            Value::Array(
                data.references
                    .iter()
                    .map(|reference| reference_value(reference, warnings))
                    .collect(),
            ),
        );
    }
    root.insert(
        "export".to_string(),
        serde_json::json!({
            "format": "json",
            "rawThinking": "excluded"
        }),
    );
    root.insert(
        "warnings".to_string(),
        Value::Array(
            warnings
                .iter()
                .map(|warning| Value::String(warning.clone()))
                .collect(),
        ),
    );
    serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|error| ExportError::Serialization(error.to_string()))
}

async fn loom_zip(
    database: &Database,
    data: &LoomExportData,
    input: &ExportLoomRequest,
) -> Result<ExportResponse, ExportError> {
    let mut warnings = Vec::new();
    let markdown = loom_markdown(data, input, &mut warnings);
    let csv = loom_csv(&data.responses);
    let metadata = loom_json(database, data, input, &mut warnings).await?;

    let mut files = vec![
        ("loom.md".to_string(), markdown.into_bytes()),
        ("responses.csv".to_string(), csv.into_bytes()),
        ("metadata.json".to_string(), metadata.into_bytes()),
    ];
    if input.include_graph {
        let graph = graph::graph_projection_for_export(
            database,
            &data.loom.loom_id,
            input.include_references,
            input.include_bookmarks,
        )
        .await
        .map_err(ExportError::Storage)?;
        if let Some(graph) = graph {
            let graph_json = serde_json::to_string_pretty(&graph)
                .map_err(|error| ExportError::Serialization(error.to_string()))?;
            files.push(("graph.json".to_string(), graph_json.into_bytes()));
        }
    }

    let bytes = zip_store(files);
    Ok(ExportResponse {
        file_name: markdown_filename("loom", &data.loom.loom_id, &data.loom.title, "zip"),
        mime_type: "application/zip".to_string(),
        content_base64: base64_encode(&bytes),
        warnings,
    })
}

fn loom_value(loom: &LoomRecord) -> Value {
    serde_json::json!({
        "loomId": loom.loom_id,
        "title": safe_text(&loom.title),
        "summary": loom.summary.as_deref().and_then(safe_text_option),
        "code": loom.code,
        "canonicalUri": loom.canonical_uri,
        "kind": loom.kind,
        "originLoomId": loom.origin_loom_id,
        "originResponseId": loom.origin_response_id,
        "createdAt": loom.created_at,
        "updatedAt": loom.updated_at,
    })
}

fn response_value(
    response: &ResponseRecord,
    include_metadata: bool,
    warnings: &mut Vec<String>,
) -> Value {
    let mut value = serde_json::json!({
        "responseId": response.response_id,
        "loomId": response.loom_id,
        "role": response.role,
        "content": safe_text(&response.content),
        "title": response.title.as_deref().and_then(safe_text_option),
        "code": response.code,
        "canonicalUri": response.canonical_uri,
        "createdAt": response.created_at,
        "updatedAt": response.updated_at,
        "sequenceIndex": response.sequence_index,
    });
    if include_metadata {
        if let Some(metadata) = sanitized_metadata(response.metadata_json.as_deref(), warnings) {
            value["metadata"] = metadata;
        }
    }
    value
}

fn reference_value(reference: &ReferenceRecord, warnings: &mut Vec<String>) -> Value {
    let mut value = serde_json::json!({
        "referenceId": reference.reference_id,
        "sourceLoomId": reference.source_loom_id,
        "sourceResponseId": reference.source_response_id,
        "targetKind": reference.target_kind,
        "targetId": reference.target_id,
        "targetUri": reference.target_uri,
        "selectedText": reference.selected_text.as_deref().and_then(safe_text_option),
        "label": reference.label.as_deref().and_then(safe_text_option),
        "createdAt": reference.created_at,
    });
    if let Some(metadata) = sanitized_metadata(reference.metadata_json.as_deref(), warnings) {
        value["metadata"] = metadata;
    }
    value
}

fn bookmark_value(bookmark: &BookmarkRecord, warnings: &mut Vec<String>) -> Value {
    let mut value = serde_json::json!({
        "bookmarkId": bookmark.bookmark_id,
        "targetKind": bookmark.target_kind,
        "targetId": bookmark.target_id,
        "targetUri": bookmark.target_uri,
        "title": safe_text(&bookmark.title),
        "createdAt": bookmark.created_at,
    });
    if let Some(metadata) = sanitized_metadata(bookmark.metadata_json.as_deref(), warnings) {
        value["metadata"] = metadata;
    }
    value
}

fn sanitized_metadata(payload: Option<&str>, warnings: &mut Vec<String>) -> Option<Value> {
    let payload = payload?;
    let Ok(mut value) = serde_json::from_str::<Value>(payload) else {
        return None;
    };
    if sanitize_value(&mut value) {
        push_unique_warning(warnings, "raw_thinking_metadata_sanitized");
    }
    Some(value)
}

fn sanitize_value(value: &mut Value) -> bool {
    match value {
        Value::Object(map) => {
            let mut removed = false;
            let keys = map.keys().cloned().collect::<Vec<_>>();
            for key in keys {
                if FORBIDDEN_THINKING_KEYS.contains(&key.as_str()) {
                    map.remove(&key);
                    removed = true;
                } else if let Some(child) = map.get_mut(&key) {
                    removed |= sanitize_value(child);
                }
            }
            removed
        }
        Value::Array(items) => items.iter_mut().any(sanitize_value),
        _ => false,
    }
}

fn bookmark_belongs_to_loom(
    bookmark: &BookmarkRecord,
    loom: &LoomRecord,
    responses: &[ResponseRecord],
) -> bool {
    (match bookmark.target_kind.as_str() {
        "loom" | "weft" => bookmark
            .target_id
            .as_deref()
            .map(|target_id| target_id == loom.loom_id)
            .unwrap_or(false),
        "response" => bookmark
            .target_id
            .as_deref()
            .map(|target_id| {
                responses
                    .iter()
                    .any(|response| response.response_id == target_id)
            })
            .unwrap_or(false),
        _ => false,
    }) || {
        bookmark
            .target_uri
            .as_deref()
            .map(|target_uri| {
                loom.canonical_uri.as_deref() == Some(target_uri)
                    || responses
                        .iter()
                        .any(|response| response.canonical_uri.as_deref() == Some(target_uri))
            })
            .unwrap_or(false)
    }
}

fn reference_mentions_response(reference: &ReferenceRecord, response_id: &str) -> bool {
    reference.source_response_id.as_deref() == Some(response_id)
        || reference.target_id.as_deref() == Some(response_id)
}

fn text_export(
    file_name: String,
    mime_type: &str,
    content: String,
    warnings: Vec<String>,
) -> ExportResponse {
    ExportResponse {
        file_name,
        mime_type: mime_type.to_string(),
        content_base64: base64_encode(content.as_bytes()),
        warnings,
    }
}

fn safe_text(input: &str) -> String {
    if contains_forbidden_payload(Some(input)) {
        "[redacted private reasoning]".to_string()
    } else {
        input.to_string()
    }
}

fn safe_text_option(input: &str) -> Option<String> {
    let value = safe_text(input);
    (!value.trim().is_empty()).then_some(value)
}

fn contains_forbidden_payload(payload: Option<&str>) -> bool {
    payload
        .map(|payload| {
            FORBIDDEN_THINKING_KEYS
                .iter()
                .any(|forbidden| payload.contains(forbidden))
        })
        .unwrap_or(false)
}

fn push_unique_warning(warnings: &mut Vec<String>, warning: &str) {
    if !warnings.iter().any(|existing| existing == warning) {
        warnings.push(warning.to_string());
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn markdown_filename(prefix: &str, id: &str, title: &str, extension: &str) -> String {
    let slug = safe_filename(title);
    if slug.is_empty() {
        format!("{prefix}-{id}.{extension}")
    } else {
        format!("{prefix}-{slug}-{id}.{extension}")
    }
}

fn safe_filename(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
        } else if matches!(character, ' ' | '-' | '_') && !output.ends_with('-') {
            output.push('-');
        }
        if output.len() >= 48 {
            break;
        }
    }
    output.trim_matches('-').to_string()
}

fn truncate_chars(input: &str, limit: usize) -> String {
    let mut output = String::new();
    for (index, character) in input.chars().enumerate() {
        if index >= limit {
            output.push_str("...");
            return output;
        }
        output.push(character);
    }
    output
}

fn title_case(input: &str) -> String {
    let mut characters = input.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => "Unknown".to_string(),
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::new();
    let mut index = 0;
    while index < bytes.len() {
        let b0 = bytes[index];
        let b1 = bytes.get(index + 1).copied().unwrap_or(0);
        let b2 = bytes.get(index + 2).copied().unwrap_or(0);
        output.push(TABLE[(b0 >> 2) as usize] as char);
        output.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if index + 1 < bytes.len() {
            output.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            output.push('=');
        }
        if index + 2 < bytes.len() {
            output.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            output.push('=');
        }
        index += 3;
    }
    output
}

struct ZipEntry {
    name: String,
    data: Vec<u8>,
    crc32: u32,
    local_header_offset: u32,
}

fn zip_store(files: Vec<(String, Vec<u8>)>) -> Vec<u8> {
    let mut output = Vec::new();
    let mut entries = Vec::new();
    for (name, data) in files {
        let crc32 = crc32(&data);
        let local_header_offset = output.len() as u32;
        write_u32(&mut output, 0x0403_4b50);
        write_u16(&mut output, 20);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u32(&mut output, crc32);
        write_u32(&mut output, data.len() as u32);
        write_u32(&mut output, data.len() as u32);
        write_u16(&mut output, name.len() as u16);
        write_u16(&mut output, 0);
        output.extend_from_slice(name.as_bytes());
        output.extend_from_slice(&data);
        entries.push(ZipEntry {
            name,
            data,
            crc32,
            local_header_offset,
        });
    }

    let central_directory_offset = output.len() as u32;
    for entry in &entries {
        write_u32(&mut output, 0x0201_4b50);
        write_u16(&mut output, 20);
        write_u16(&mut output, 20);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u32(&mut output, entry.crc32);
        write_u32(&mut output, entry.data.len() as u32);
        write_u32(&mut output, entry.data.len() as u32);
        write_u16(&mut output, entry.name.len() as u16);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u32(&mut output, 0);
        write_u32(&mut output, entry.local_header_offset);
        output.extend_from_slice(entry.name.as_bytes());
    }
    let central_directory_size = output.len() as u32 - central_directory_offset;

    write_u32(&mut output, 0x0605_4b50);
    write_u16(&mut output, 0);
    write_u16(&mut output, 0);
    write_u16(&mut output, entries.len() as u16);
    write_u16(&mut output, entries.len() as u16);
    write_u32(&mut output, central_directory_size);
    write_u32(&mut output, central_directory_offset);
    write_u16(&mut output, 0);
    output
}

fn write_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= *byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn export_error(error: ExportError) -> (StatusCode, Json<ExportApiError>) {
    match error {
        ExportError::NotFound(kind) => (
            StatusCode::NOT_FOUND,
            Json(ExportApiError {
                code: "not_found".to_string(),
                message: format!("{kind} not found"),
            }),
        ),
        ExportError::Unsupported(message) => (
            StatusCode::BAD_REQUEST,
            Json(ExportApiError {
                code: "unsupported_format".to_string(),
                message: message.to_string(),
            }),
        ),
        ExportError::Storage(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ExportApiError {
                code: "export_failed".to_string(),
                message: error.to_string(),
            }),
        ),
        ExportError::Serialization(message) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ExportApiError {
                code: "export_serialization_failed".to_string(),
                message,
            }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{export_loom_impl, export_response_impl, ExportFormat};
    use crate::{
        api::exports::{base64_encode, ExportLoomRequest, ExportResponseRequest},
        storage::{
            db::test_database,
            repositories::{
                bookmarks::{BookmarkRepository, NewBookmark},
                looms::{LoomRepository, NewLoom},
                references::{NewReference, ReferenceRepository},
                responses::{NewResponse, ResponseRepository},
            },
        },
    };

    #[tokio::test]
    async fn loom_markdown_export_includes_ordered_conversation() {
        let database = test_database().await;
        seed_loom(&database).await;

        let export = export_loom_impl(
            &database,
            ExportLoomRequest {
                loom_id: "loom-1".to_string(),
                format: ExportFormat::Markdown,
                include_metadata: true,
                include_references: false,
                include_bookmarks: false,
                include_graph: false,
            },
        )
        .await
        .expect("export Loom markdown");
        let markdown = decode_known_base64(&export.content_base64);

        assert!(markdown.contains("# Trip Loom"));
        assert!(markdown.find("Plan Greece").unwrap() < markdown.find("Visit Athens").unwrap());
    }

    #[tokio::test]
    async fn response_markdown_export_includes_content_and_parent_loom() {
        let database = test_database().await;
        seed_loom(&database).await;

        let export = export_response_impl(
            &database,
            ExportResponseRequest {
                response_id: "response-2".to_string(),
                format: ExportFormat::Markdown,
                include_metadata: true,
                include_references: false,
            },
        )
        .await
        .expect("export Response markdown");
        let markdown = decode_known_base64(&export.content_base64);

        assert!(markdown.contains("Parent Loom: Trip Loom"));
        assert!(markdown.contains("Visit Athens, Santorini, and Crete."));
    }

    #[tokio::test]
    async fn response_json_export_includes_parent_loom_metadata_and_sanitizes_response_metadata() {
        let database = test_database().await;
        seed_loom(&database).await;
        sqlx::query("UPDATE responses SET metadata_json = ?2 WHERE response_id = ?1")
            .bind("response-2")
            .bind("{\"safe\":\"yes\",\"hidden_reasoning\":\"never export\"}")
            .execute(database.pool())
            .await
            .expect("insert raw metadata");

        let export = export_response_impl(
            &database,
            ExportResponseRequest {
                response_id: "response-2".to_string(),
                format: ExportFormat::Json,
                include_metadata: true,
                include_references: false,
            },
        )
        .await
        .expect("export Response JSON");
        let json = decode_known_base64(&export.content_base64);

        assert!(json.contains("\"loom\""));
        assert!(json.contains("\"title\": \"Trip Loom\""));
        assert!(json.contains("\"response\""));
        assert!(json.contains("\"safe\": \"yes\""));
        assert!(export
            .warnings
            .iter()
            .any(|warning| warning == "raw_thinking_metadata_sanitized"));
        assert!(!json.contains("hidden_reasoning"));
        assert!(!json.contains("never export"));
    }

    #[tokio::test]
    async fn csv_export_escapes_commas_newlines_and_quotes() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(
            &database,
            "response-csv",
            "assistant",
            "Comma, newline\nand \"quote\"",
            2,
        )
        .await;

        let export = export_loom_impl(
            &database,
            ExportLoomRequest {
                loom_id: "loom-1".to_string(),
                format: ExportFormat::Csv,
                include_metadata: false,
                include_references: false,
                include_bookmarks: false,
                include_graph: false,
            },
        )
        .await
        .expect("export CSV");
        let csv = decode_known_base64(&export.content_base64);

        assert!(csv.contains("\"Comma, newline\nand \"\"quote\"\"\""));
    }

    #[tokio::test]
    async fn json_export_includes_requested_metadata() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_reference(
            &database,
            "reference-1",
            Some("response-1"),
            Some("response-2"),
        )
        .await;
        insert_bookmark(
            &database,
            "bookmark-1",
            "response",
            Some("response-2"),
            None,
        )
        .await;

        let export = export_loom_impl(
            &database,
            ExportLoomRequest {
                loom_id: "loom-1".to_string(),
                format: ExportFormat::Json,
                include_metadata: true,
                include_references: true,
                include_bookmarks: true,
                include_graph: true,
            },
        )
        .await
        .expect("export JSON");
        let json = decode_known_base64(&export.content_base64);

        assert!(json.contains("\"references\""));
        assert!(json.contains("\"bookmarks\""));
        assert!(json.contains("\"graph\""));
    }

    #[tokio::test]
    async fn zip_export_contains_expected_files() {
        let database = test_database().await;
        seed_loom(&database).await;

        let export = export_loom_impl(
            &database,
            ExportLoomRequest {
                loom_id: "loom-1".to_string(),
                format: ExportFormat::Zip,
                include_metadata: true,
                include_references: false,
                include_bookmarks: false,
                include_graph: true,
            },
        )
        .await
        .expect("export ZIP");
        let bytes = decode_known_base64_bytes(&export.content_base64);
        let zip_text = String::from_utf8_lossy(&bytes);

        assert_eq!(export.mime_type, "application/zip");
        assert!(zip_text.contains("loom.md"));
        assert!(zip_text.contains("responses.csv"));
        assert!(zip_text.contains("metadata.json"));
        assert!(zip_text.contains("graph.json"));
        assert!(zip_text.contains("loom.md"));
        assert!(zip_text.contains("Trip Loom"));
    }

    #[tokio::test]
    async fn export_sanitizes_forbidden_raw_thinking_keys() {
        let database = test_database().await;
        seed_loom(&database).await;
        sqlx::query("UPDATE responses SET metadata_json = ?2 WHERE response_id = ?1")
            .bind("response-2")
            .bind("{\"safe\":\"yes\",\"raw_thinking\":\"hidden\"}")
            .execute(database.pool())
            .await
            .expect("insert raw metadata");

        let export = export_loom_impl(
            &database,
            ExportLoomRequest {
                loom_id: "loom-1".to_string(),
                format: ExportFormat::Json,
                include_metadata: true,
                include_references: false,
                include_bookmarks: false,
                include_graph: false,
            },
        )
        .await
        .expect("export JSON");
        let json = decode_known_base64(&export.content_base64);

        assert!(export
            .warnings
            .iter()
            .any(|warning| warning == "raw_thinking_metadata_sanitized"));
        assert!(!json.contains("\"raw_thinking\""));
        assert!(!json.contains("hidden"));
    }

    #[tokio::test]
    async fn missing_loom_returns_not_found() {
        let database = test_database().await;
        let error = export_loom_impl(
            &database,
            ExportLoomRequest {
                loom_id: "missing".to_string(),
                format: ExportFormat::Markdown,
                include_metadata: false,
                include_references: false,
                include_bookmarks: false,
                include_graph: false,
            },
        )
        .await
        .expect_err("missing Loom");

        assert!(format!("{error:?}").contains("NotFound"));
    }

    #[tokio::test]
    async fn missing_response_returns_not_found() {
        let database = test_database().await;
        let error = export_response_impl(
            &database,
            ExportResponseRequest {
                response_id: "missing".to_string(),
                format: ExportFormat::Markdown,
                include_metadata: false,
                include_references: false,
            },
        )
        .await
        .expect_err("missing Response");

        assert!(format!("{error:?}").contains("NotFound"));
    }

    #[tokio::test]
    async fn include_references_false_omits_references() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_reference(
            &database,
            "reference-1",
            Some("response-1"),
            Some("response-2"),
        )
        .await;

        let export = export_loom_impl(
            &database,
            ExportLoomRequest {
                loom_id: "loom-1".to_string(),
                format: ExportFormat::Markdown,
                include_metadata: false,
                include_references: false,
                include_bookmarks: false,
                include_graph: false,
            },
        )
        .await
        .expect("export markdown");
        let markdown = decode_known_base64(&export.content_base64);

        assert!(!markdown.contains("## References"));
    }

    #[tokio::test]
    async fn include_bookmarks_false_omits_bookmarks() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_bookmark(
            &database,
            "bookmark-1",
            "response",
            Some("response-2"),
            None,
        )
        .await;

        let export = export_loom_impl(
            &database,
            ExportLoomRequest {
                loom_id: "loom-1".to_string(),
                format: ExportFormat::Markdown,
                include_metadata: false,
                include_references: false,
                include_bookmarks: false,
                include_graph: false,
            },
        )
        .await
        .expect("export markdown");
        let markdown = decode_known_base64(&export.content_base64);

        assert!(!markdown.contains("## Bookmarks"));
    }

    async fn seed_loom(database: &crate::storage::db::Database) {
        LoomRepository::new(database)
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Trip Loom".to_string(),
                summary: Some("Travel planning".to_string()),
                code: Some("L-TRIP".to_string()),
                canonical_uri: Some("loom://loom-1".to_string()),
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "2026-05-10T00:00:00Z".to_string(),
                updated_at: "2026-05-10T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");
        insert_response(database, "response-1", "user", "Plan Greece", 0).await;
        insert_response(
            database,
            "response-2",
            "assistant",
            "Visit Athens, Santorini, and Crete.",
            1,
        )
        .await;
    }

    async fn insert_response(
        database: &crate::storage::db::Database,
        response_id: &str,
        role: &str,
        content: &str,
        sequence_index: i64,
    ) {
        ResponseRepository::new(database)
            .insert_response(&NewResponse {
                response_id: response_id.to_string(),
                loom_id: "loom-1".to_string(),
                role: role.to_string(),
                content: content.to_string(),
                title: None,
                code: Some(format!("R-{response_id}")),
                canonical_uri: Some(format!("loom://loom-1/responses/{response_id}")),
                created_at: "2026-05-10T00:00:00Z".to_string(),
                updated_at: "2026-05-10T00:00:00Z".to_string(),
                sequence_index,
                metadata_json: Some("{\"safe\":\"yes\"}".to_string()),
            })
            .await
            .expect("insert Response");
    }

    async fn insert_reference(
        database: &crate::storage::db::Database,
        reference_id: &str,
        source_response_id: Option<&str>,
        target_id: Option<&str>,
    ) {
        ReferenceRepository::new(database)
            .insert_reference(&NewReference {
                reference_id: reference_id.to_string(),
                source_loom_id: Some("loom-1".to_string()),
                source_response_id: source_response_id.map(str::to_string),
                target_kind: "response".to_string(),
                target_id: target_id.map(str::to_string),
                target_uri: None,
                selected_text: Some("Santorini".to_string()),
                label: Some("Selected place".to_string()),
                metadata_json: Some("{}".to_string()),
                created_at: "2026-05-10T00:00:01Z".to_string(),
            })
            .await
            .expect("insert Reference");
    }

    async fn insert_bookmark(
        database: &crate::storage::db::Database,
        bookmark_id: &str,
        target_kind: &str,
        target_id: Option<&str>,
        target_uri: Option<&str>,
    ) {
        BookmarkRepository::new(database)
            .insert_bookmark(&NewBookmark {
                bookmark_id: bookmark_id.to_string(),
                target_kind: target_kind.to_string(),
                target_id: target_id.map(str::to_string),
                target_uri: target_uri.map(str::to_string),
                title: "Saved target".to_string(),
                metadata_json: Some("{}".to_string()),
                created_at: "2026-05-10T00:00:01Z".to_string(),
            })
            .await
            .expect("insert Bookmark");
    }

    fn decode_known_base64(value: &str) -> String {
        String::from_utf8(decode_known_base64_bytes(value)).expect("utf8")
    }

    fn decode_known_base64_bytes(value: &str) -> Vec<u8> {
        // Test-only decoder for bytes produced by this module's encoder.
        let mut bytes = Vec::new();
        let mut chunk = [0_u8; 4];
        let mut index = 0;
        for character in value.bytes().filter(|byte| *byte != b'=') {
            chunk[index] = match character {
                b'A'..=b'Z' => character - b'A',
                b'a'..=b'z' => character - b'a' + 26,
                b'0'..=b'9' => character - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                _ => continue,
            };
            index += 1;
            if index == 4 {
                bytes.push((chunk[0] << 2) | (chunk[1] >> 4));
                bytes.push((chunk[1] << 4) | (chunk[2] >> 2));
                bytes.push((chunk[2] << 6) | chunk[3]);
                index = 0;
            }
        }
        if index == 2 {
            bytes.push((chunk[0] << 2) | (chunk[1] >> 4));
        } else if index == 3 {
            bytes.push((chunk[0] << 2) | (chunk[1] >> 4));
            bytes.push((chunk[1] << 4) | (chunk[2] >> 2));
        }
        bytes
    }

    #[test]
    fn base64_encoder_handles_padding() {
        assert_eq!(base64_encode(b"OK"), "T0s=");
        assert_eq!(base64_encode(b"yes"), "eWVz");
    }
}
