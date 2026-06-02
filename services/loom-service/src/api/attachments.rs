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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptAttachmentRequest {
    pub from_loom_id: String,
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

pub async fn adopt_attachment(
    State(state): State<AppState>,
    Path((loom_id, attachment_id)): Path<(String, String)>,
    Json(input): Json<AdoptAttachmentRequest>,
) -> Result<Json<AttachmentEnvelope>, (StatusCode, Json<AttachmentApiError>)> {
    if input.from_loom_id.trim().is_empty() {
        return Err(bad_request(
            "INVALID_SOURCE_LOOM",
            "fromLoomId is required.",
        ));
    }
    let repo = AttachmentRepository::new(&state.database);
    let record = repo
        .reassign_attachment_loom(
            &attachment_id,
            input.from_loom_id.trim(),
            &loom_id,
            &timestamp(),
        )
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;
    Ok(Json(AttachmentEnvelope {
        attachment: attachment_to_dto(record),
    }))
}

/// Writes the attachment blob to an OS temp file and returns the path.
///
/// Security: `loom_id` is verified against the attachment's stored loom before
/// returning any bytes. A request with the wrong loom receives a 404 (not 403)
/// to avoid confirming that the attachment ID exists in another loom.
///
/// Filename is sanitized to prevent directory traversal.
/// The temp file is placed in an attachment-ID-scoped sub-directory so that
/// concurrent requests for different attachments with the same filename do not
/// overwrite each other.
pub async fn materialize_attachment(
    State(state): State<AppState>,
    Path((loom_id, attachment_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<AttachmentApiError>)> {
    let repo = AttachmentRepository::new(&state.database);
    let (file_name, bytes) = repo
        .get_attachment_blob(&attachment_id, &loom_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;

    let safe_name = sanitize_file_name(&file_name);
    let temp_path = write_to_temp_file(&attachment_id, &safe_name, &bytes).map_err(|error| {
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

/// Writes the attachment blob to a temp file isolated in a per-attachment-ID
/// sub-directory: `<tmpdir>/loom-attachments/<safe_attachment_id>/<safe_name>`.
///
/// Using the attachment ID as the sub-directory prevents filename collisions
/// across concurrent requests for different attachments with the same filename.
/// The Electron IPC handler already validates that returned paths remain under
/// `os.tmpdir()`, so the extra sub-directory is safe.
///
/// Limitation: temp files are not proactively cleaned up. OS temp directory
/// management handles eventual cleanup. Each open of the same attachment
/// overwrites the previous copy in its sub-directory.
fn write_to_temp_file(
    attachment_id: &str,
    safe_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let base_dir = std::env::temp_dir().join("loom-attachments");
    // Sanitize attachment_id for use as a directory name (keep alphanumerics and common separators).
    let safe_id: String = attachment_id
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect();
    let dir = base_dir.join(if safe_id.is_empty() {
        "unknown".to_string()
    } else {
        safe_id
    });
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
            "INSERT OR IGNORE INTO looms (loom_id, title, created_at, updated_at)
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
            secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }

    // ── materialize_attachment tests ──────────────────────────────────────

    /// Creates a small text attachment in loom-mat-1 and returns (state, attachment_id).
    async fn create_text_attachment_for_materialize(
        state: &AppState,
        loom_id: &str,
        file_name: &str,
        content: &str,
    ) -> String {
        insert_loom(state, loom_id).await;
        let (status, Json(payload)) = create_attachment(
            State(state.clone()),
            Path(loom_id.to_string()),
            Json(CreateAttachmentRequest {
                file_name: file_name.to_string(),
                mime_type: Some("text/plain".to_string()),
                size_bytes: Some(content.len() as i64),
                content_base64: base64_encode_for_test(content.as_bytes()),
            }),
        )
        .await
        .expect("create_attachment should succeed");
        assert_eq!(status, StatusCode::CREATED, "expected 201 for create");
        payload.attachment.attachment_id
    }

    #[tokio::test]
    async fn materialize_attachment_succeeds_for_correct_loom() {
        let state = test_state().await;
        let attachment_id =
            create_text_attachment_for_materialize(&state, "loom-mat-1", "hello.txt", "hello")
                .await;

        let result = materialize_attachment(
            State(state),
            Path(("loom-mat-1".to_string(), attachment_id)),
        )
        .await;

        let Json(payload) = result.expect("materialize should succeed for correct loom");
        assert!(
            !payload["path"].as_str().unwrap_or("").is_empty(),
            "path should be non-empty"
        );
        assert_eq!(payload["fileName"], "hello.txt");
        // Verify file was actually written with the expected content.
        let path = std::path::Path::new(payload["path"].as_str().unwrap());
        assert!(path.exists(), "materialized file should exist on disk");
        let written = std::fs::read_to_string(path).expect("read written file");
        assert_eq!(written, "hello");
    }

    #[tokio::test]
    async fn materialize_attachment_returns_404_for_wrong_loom() {
        let state = test_state().await;
        let attachment_id =
            create_text_attachment_for_materialize(&state, "loom-mat-2", "secret.txt", "data")
                .await;

        // Request using a different loom's ID
        let result = materialize_attachment(
            State(state),
            Path(("loom-wrong".to_string(), attachment_id)),
        )
        .await;

        let (status, Json(error)) = result.expect_err("wrong loom should return error");
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "wrong loom must return 404, not a data response"
        );
        assert_eq!(error.code, "ATTACHMENT_NOT_FOUND");
    }

    #[tokio::test]
    async fn adopt_attachment_reassigns_from_draft_to_materialized_loom() {
        let state = test_state().await;
        let attachment_id = create_text_attachment_for_materialize(
            &state,
            "draft-new-conversation",
            "first.md",
            "sentinel",
        )
        .await;
        insert_loom(&state, "loom-first-turn").await;

        let Json(payload) = adopt_attachment(
            State(state.clone()),
            Path(("loom-first-turn".to_string(), attachment_id.clone())),
            Json(AdoptAttachmentRequest {
                from_loom_id: "draft-new-conversation".to_string(),
            }),
        )
        .await
        .expect("adopt attachment");

        assert_eq!(payload.attachment.loom_id, "loom-first-turn");
        let old_owner_result = materialize_attachment(
            State(state.clone()),
            Path(("draft-new-conversation".to_string(), attachment_id.clone())),
        )
        .await;
        assert!(old_owner_result.is_err());
        let new_owner_result = materialize_attachment(
            State(state),
            Path(("loom-first-turn".to_string(), attachment_id)),
        )
        .await;
        assert!(new_owner_result.is_ok());
    }

    #[tokio::test]
    async fn materialize_attachment_returns_404_for_unknown_attachment() {
        let state = test_state().await;
        insert_loom(&state, "loom-mat-3").await;

        let result = materialize_attachment(
            State(state),
            Path(("loom-mat-3".to_string(), "att-does-not-exist".to_string())),
        )
        .await;

        let (status, Json(error)) = result.expect_err("unknown attachment should return error");
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(error.code, "ATTACHMENT_NOT_FOUND");
    }

    #[tokio::test]
    async fn materialize_attachment_unique_paths_for_same_filename_different_attachments() {
        let state = test_state().await;
        let id_a =
            create_text_attachment_for_materialize(&state, "loom-mat-4", "report.txt", "content-a")
                .await;
        let id_b =
            create_text_attachment_for_materialize(&state, "loom-mat-4", "report.txt", "content-b")
                .await;

        let Json(a) = materialize_attachment(
            State(state.clone()),
            Path(("loom-mat-4".to_string(), id_a.clone())),
        )
        .await
        .expect("materialize a");
        let Json(b) =
            materialize_attachment(State(state), Path(("loom-mat-4".to_string(), id_b.clone())))
                .await
                .expect("materialize b");

        assert_ne!(
            a["path"], b["path"],
            "same filename in different attachments must produce distinct temp paths"
        );
        // Both files should have the correct content
        let content_a = std::fs::read_to_string(a["path"].as_str().unwrap()).expect("read a");
        let content_b = std::fs::read_to_string(b["path"].as_str().unwrap()).expect("read b");
        assert_eq!(content_a, "content-a");
        assert_eq!(content_b, "content-b");
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
