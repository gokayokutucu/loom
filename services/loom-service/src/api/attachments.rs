use crate::{
    api::state::AppState,
    capabilities::repository::{new_id, timestamp},
    storage::repositories::attachments::{
        AttachmentRecord, AttachmentRepository, NewAttachment, MAX_ATTACHMENT_BYTES,
        MAX_ATTACHMENT_SIZE_LABEL,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAttachmentRequest {
    pub file_name: String,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub content_base64: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDto {
    pub attachment_id: String,
    pub loom_id: String,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
    pub size_bytes: i64,
    pub kind: String,
    pub parse_status: String,
    pub parser: Option<String>,
    pub error: Option<String>,
    pub thumbnail_data_url: Option<String>,
    pub parsed_char_count: Option<i64>,
    pub metadata_json: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentEnvelope {
    pub attachment: AttachmentDto,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentListResponse {
    pub attachments: Vec<AttachmentDto>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentApiError {
    pub code: String,
    pub message: String,
}

pub async fn create_attachment(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
    Json(input): Json<CreateAttachmentRequest>,
) -> Result<(StatusCode, Json<AttachmentEnvelope>), (StatusCode, Json<AttachmentApiError>)> {
    if input.file_name.trim().is_empty() {
        return Err(bad_request(
            "INVALID_FILE_NAME",
            "Attachment fileName is required.",
        ));
    }
    if let Some(size_bytes) = input.size_bytes {
        if size_bytes < 0 || size_bytes as usize > MAX_ATTACHMENT_BYTES {
            return Err(payload_too_large());
        }
    }
    let bytes = decode_base64(&input.content_base64).map_err(|_| {
        bad_request(
            "INVALID_ATTACHMENT_BODY",
            "Attachment contentBase64 must be valid base64.",
        )
    })?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(payload_too_large());
    }
    let repo = AttachmentRepository::new(&state.database);
    let record = repo
        .insert_attachment(&NewAttachment {
            attachment_id: new_id("att"),
            loom_id,
            file_name: input.file_name.trim().to_string(),
            mime_type: input.mime_type.filter(|value| !value.trim().is_empty()),
            bytes,
            created_at: timestamp(),
        })
        .await
        .map_err(storage_error)?;
    if record.parse_status == "queued" {
        let database = state.database.clone();
        let attachment_id = record.attachment_id.clone();
        tokio::spawn(async move {
            let repo = AttachmentRepository::new(&database);
            let config = state.config.current().ocr;
            if let Err(error) = repo
                .parse_attachment_now_with_ocr(&attachment_id, &timestamp(), &config)
                .await
            {
                tracing::warn!(
                    attachment_id = %attachment_id,
                    error = %error,
                    "attachment parse job failed"
                );
            }
        });
    }
    Ok((
        StatusCode::CREATED,
        Json(AttachmentEnvelope {
            attachment: attachment_to_dto(record),
        }),
    ))
}

pub async fn list_attachments(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<Json<AttachmentListResponse>, (StatusCode, Json<AttachmentApiError>)> {
    let repo = AttachmentRepository::new(&state.database);
    let attachments = repo
        .list_attachments_for_loom(&loom_id)
        .await
        .map_err(storage_error)?;
    Ok(Json(AttachmentListResponse {
        attachments: attachments.into_iter().map(attachment_to_dto).collect(),
    }))
}

pub async fn get_attachment(
    State(state): State<AppState>,
    Path(attachment_id): Path<String>,
) -> Result<Json<AttachmentEnvelope>, (StatusCode, Json<AttachmentApiError>)> {
    let repo = AttachmentRepository::new(&state.database);
    let record = repo
        .get_attachment(&attachment_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;
    Ok(Json(AttachmentEnvelope {
        attachment: attachment_to_dto(record),
    }))
}

/// Writes the attachment blob to an OS temp file and returns the path.
/// Filename is sanitized to prevent directory traversal.
pub async fn materialize_attachment(
    State(state): State<AppState>,
    Path(attachment_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<AttachmentApiError>)> {
    let repo = AttachmentRepository::new(&state.database);
    let (file_name, bytes) = repo
        .get_attachment_blob(&attachment_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;

    let safe_name = sanitize_file_name(&file_name);
    let temp_path = write_to_temp_file(&safe_name, &bytes).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(AttachmentApiError {
                code: "MATERIALIZE_FAILED".to_string(),
                message: error,
            }),
        )
    })?;

    Ok(Json(serde_json::json!({
        "path": temp_path.display().to_string(),
        "fileName": safe_name,
    })))
}

/// Sanitizes a filename for safe use in the OS temp directory.
/// Strips directory separators and limits length, preserving extension.
fn sanitize_file_name(name: &str) -> String {
    // Strip any directory components.
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .trim()
        .to_string();
    // Reject or replace dangerous characters; allow alphanumerics, dash, underscore, dot.
    let safe: String = base
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    // Limit to 128 chars total while preserving extension.
    const MAX_LEN: usize = 128;
    if safe.len() <= MAX_LEN {
        if safe.is_empty() {
            "attachment".to_string()
        } else {
            safe
        }
    } else {
        let ext = safe.rfind('.').map(|i| &safe[i..]).unwrap_or("");
        let stem_limit = MAX_LEN - ext.len();
        format!("{}{}", &safe[..stem_limit], ext)
    }
}

fn write_to_temp_file(safe_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("loom-attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create temp directory: {e}"))?;
    let path = dir.join(safe_name);
    std::fs::write(&path, bytes).map_err(|e| format!("failed to write temp file: {e}"))?;
    Ok(path)
}

pub async fn delete_attachment(
    State(state): State<AppState>,
    Path(attachment_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<AttachmentApiError>)> {
    let repo = AttachmentRepository::new(&state.database);
    let deleted = repo
        .delete_attachment(&attachment_id)
        .await
        .map_err(storage_error)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(not_found())
    }
}

fn attachment_to_dto(record: AttachmentRecord) -> AttachmentDto {
    AttachmentDto {
        attachment_id: record.attachment_id,
        loom_id: record.loom_id,
        file_name: record.file_name,
        mime_type: record.mime_type,
        extension: record.extension,
        size_bytes: record.size_bytes,
        kind: record.kind,
        parse_status: record.parse_status,
        parser: record.parser,
        error: record.error,
        thumbnail_data_url: record.thumbnail_data_url,
        parsed_char_count: record.parsed_content.map(|content| content.char_count),
        metadata_json: record
            .metadata_json
            .and_then(|metadata| serde_json::from_str(&metadata).ok()),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn decode_base64(value: &str) -> Result<Vec<u8>, ()> {
    let mut output = Vec::with_capacity(value.len() * 3 / 4);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for byte in value.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            break;
        }
        let Some(value) = base64_value(byte) else {
            return Err(());
        };
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Ok(output)
}

fn base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<AttachmentApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(AttachmentApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn payload_too_large() -> (StatusCode, Json<AttachmentApiError>) {
    (
        StatusCode::PAYLOAD_TOO_LARGE,
        Json(AttachmentApiError {
            code: "ATTACHMENT_TOO_LARGE".to_string(),
            message: format!("File is too large. Files can be up to {MAX_ATTACHMENT_SIZE_LABEL}."),
        }),
    )
}

fn not_found() -> (StatusCode, Json<AttachmentApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(AttachmentApiError {
            code: "ATTACHMENT_NOT_FOUND".to_string(),
            message: "Attachment was not found.".to_string(),
        }),
    )
}

fn storage_error(error: crate::error::ServiceError) -> (StatusCode, Json<AttachmentApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(AttachmentApiError {
            code: "ATTACHMENT_STORAGE_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::db::test_database,
    };
    use axum::extract::{Path, State};
    use std::{path::PathBuf, time::Duration};

    #[test]
    fn base64_decoder_handles_padding() {
        assert_eq!(decode_base64("T0s=").expect("decode"), b"OK");
        assert_eq!(decode_base64("eWVz").expect("decode"), b"yes");
    }

    #[tokio::test]
    async fn api_accepts_attachment_below_twenty_five_mb_limit() {
        let state = test_state().await;
        insert_loom(&state, "loom-a").await;
        let bytes = vec![b'a'; MAX_ATTACHMENT_BYTES - 1];

        let (status, Json(payload)) = create_attachment(
            State(state),
            Path("loom-a".to_string()),
            Json(CreateAttachmentRequest {
                file_name: "below-limit.bin".to_string(),
                mime_type: Some("application/octet-stream".to_string()),
                size_bytes: Some(bytes.len() as i64),
                content_base64: base64_encode_for_test(&bytes),
            }),
        )
        .await
        .expect("below-limit attachment should be accepted");

        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(payload.attachment.file_name, "below-limit.bin");
        assert_eq!(
            payload.attachment.size_bytes,
            (MAX_ATTACHMENT_BYTES - 1) as i64
        );
        assert_eq!(payload.attachment.parse_status, "unsupported");
    }

    #[tokio::test]
    async fn api_rejects_attachment_above_twenty_five_mb_limit() {
        let state = test_state().await;
        insert_loom(&state, "loom-a").await;

        let (status, Json(payload)) = create_attachment(
            State(state),
            Path("loom-a".to_string()),
            Json(CreateAttachmentRequest {
                file_name: "above-limit.bin".to_string(),
                mime_type: Some("application/octet-stream".to_string()),
                size_bytes: Some((MAX_ATTACHMENT_BYTES + 1) as i64),
                content_base64: "T0s=".to_string(),
            }),
        )
        .await
        .expect_err("above-limit attachment should be rejected");

        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(payload.code, "ATTACHMENT_TOO_LARGE");
        assert_eq!(
            payload.message,
            "File is too large. Files can be up to 25 MB."
        );
    }

    async fn insert_loom(state: &AppState, loom_id: &str) {
        sqlx::query(
            "INSERT INTO looms (loom_id, title, created_at, updated_at)
             VALUES (?1, ?1, '1', '1')",
        )
        .bind(loom_id)
        .execute(state.database.pool())
        .await
        .expect("loom insert");
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
                PathBuf::from("/tmp/loom-service-attachment-test.toml"),
                LoomServiceConfig::default(),
            ),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }

    fn base64_encode_for_test(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0];
            let b1 = *chunk.get(1).unwrap_or(&0);
            let b2 = *chunk.get(2).unwrap_or(&0);
            output.push(TABLE[(b0 >> 2) as usize] as char);
            output.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
            if chunk.len() > 1 {
                output.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
            } else {
                output.push('=');
            }
            if chunk.len() > 2 {
                output.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
            } else {
                output.push('=');
            }
        }
        output
    }
}
