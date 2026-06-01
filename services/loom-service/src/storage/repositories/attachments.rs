#![allow(dead_code)]

use crate::{config::OcrSection, error::ServiceError, storage::db::Database};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use zip::ZipArchive;

pub const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_ATTACHMENT_SIZE_LABEL: &str = "25 MB";
const ATTACHMENT_CHUNK_CHAR_LIMIT: usize = 2_400;
const ATTACHMENT_CONTEXT_CHAR_BUDGET: usize = 8_000;
const COMPRESS_AT_REST_THRESHOLD_BYTES: usize = 4_096;
const DOCX_MAX_EXTRACTED_CHARS: usize = 200_000;
const XLSX_MAX_SHEETS: usize = 8;
const XLSX_MAX_ROWS_PER_SHEET: usize = 200;
const XLSX_MAX_CELLS_PER_ROW: usize = 50;
const XLSX_MAX_EXTRACTED_CHARS: usize = 200_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentRecord {
    pub attachment_id: String,
    pub loom_id: String,
    pub blob_id: Option<String>,
    pub sha256: Option<String>,
    pub parse_artifact_id: Option<String>,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
    pub size_bytes: i64,
    pub kind: String,
    pub parse_status: String,
    pub parser: Option<String>,
    pub error: Option<String>,
    pub thumbnail_data_url: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub parsed_content: Option<AttachmentParsedContentRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentParsedContentRecord {
    pub attachment_id: String,
    pub content_text: String,
    pub content_kind: String,
    pub char_count: i64,
    pub parser: String,
    pub compression_kind: String,
    pub original_byte_count: i64,
    pub stored_byte_count: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentParsedChunkRecord {
    pub chunk_id: String,
    pub attachment_id: String,
    pub parse_artifact_id: Option<String>,
    pub chunk_index: i64,
    pub content_text: String,
    pub char_start: i64,
    pub char_end: i64,
    pub char_count: i64,
    pub token_estimate: i64,
    pub page_number: Option<i64>,
    pub sheet_name: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewAttachment {
    pub attachment_id: String,
    pub loom_id: String,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub bytes: Vec<u8>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedAttachment {
    pub kind: String,
    pub parse_status: String,
    pub parser: Option<String>,
    pub error: Option<String>,
    pub thumbnail_data_url: Option<String>,
    pub metadata_json: Option<String>,
    pub content: Option<NewAttachmentParsedContent>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAttachmentParsedContent {
    pub content_text: String,
    pub content_kind: String,
    pub char_count: i64,
    pub parser: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OcrProviderStatus {
    pub status: String,
    pub provider: String,
    pub enabled: bool,
    pub command_path: Option<String>,
    pub rasterizer_command_path: Option<String>,
    pub language: String,
    pub dpi: u32,
    pub message: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParseArtifactRecord {
    parse_artifact_id: String,
    kind: String,
    parser: String,
    metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AttachmentRepository {
    pool: SqlitePool,
}

impl AttachmentRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_attachment(
        &self,
        attachment: &NewAttachment,
    ) -> Result<AttachmentRecord, ServiceError> {
        if attachment.bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(ServiceError::storage(format!(
                "attachment exceeds {} byte limit",
                MAX_ATTACHMENT_BYTES
            )));
        }
        let extension = file_extension(&attachment.file_name);
        let initial = initial_parse_state(
            &attachment.file_name,
            attachment.mime_type.as_deref(),
            &extension,
        );
        let size_bytes = attachment.bytes.len() as i64;
        let sha256 = sha256_hex(&attachment.bytes);

        let mut transaction = self.pool.begin().await.map_err(|error| {
            ServiceError::storage(format!("failed to start attachment transaction: {error}"))
        })?;

        let existing_blob_id = sqlx::query_scalar::<_, String>(
            "SELECT blob_id FROM attachment_blob_objects WHERE sha256 = ?1",
        )
        .bind(&sha256)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to find Attachment blob object: {error}"))
        })?;
        let blob_id =
            existing_blob_id.unwrap_or_else(|| format!("blob-{}", attachment.attachment_id));
        sqlx::query(
            "INSERT OR IGNORE INTO attachment_blob_objects (
                blob_id, sha256, size_bytes, bytes, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&blob_id)
        .bind(&sha256)
        .bind(size_bytes)
        .bind(&attachment.bytes)
        .bind(&attachment.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert Attachment blob object: {error}"))
        })?;

        sqlx::query(
            "INSERT INTO attachments (
                attachment_id, loom_id, blob_id, sha256, file_name, mime_type, extension, size_bytes,
                kind, parse_status, parser, error, thumbnail_data_url, metadata_json,
                created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        )
        .bind(&attachment.attachment_id)
        .bind(&attachment.loom_id)
        .bind(&blob_id)
        .bind(&sha256)
        .bind(&attachment.file_name)
        .bind(&attachment.mime_type)
        .bind(&extension)
        .bind(size_bytes)
        .bind(&initial.kind)
        .bind(&initial.parse_status)
        .bind(&initial.parser)
        .bind(&initial.error)
        .bind(&initial.thumbnail_data_url)
        .bind(Option::<String>::None)
        .bind(&attachment.created_at)
        .bind(&attachment.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to insert Attachment: {error}")))?;

        if initial.parse_status == "queued" {
            sqlx::query(
                "INSERT INTO attachment_parse_jobs (
                    job_id, attachment_id, status, parser, progress, error, created_at, updated_at
                ) VALUES (?1, ?2, 'queued', ?3, 0, NULL, ?4, ?4)",
            )
            .bind(format!("parse-{}", attachment.attachment_id))
            .bind(&attachment.attachment_id)
            .bind(&initial.parser)
            .bind(&attachment.created_at)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to insert Attachment parse job: {error}"))
            })?;
        }

        transaction.commit().await.map_err(|error| {
            ServiceError::storage(format!("failed to commit attachment transaction: {error}"))
        })?;

        self.get_attachment(&attachment.attachment_id)
            .await?
            .ok_or_else(|| ServiceError::storage("inserted Attachment was not found"))
    }

    pub async fn list_attachments_for_loom(
        &self,
        loom_id: &str,
    ) -> Result<Vec<AttachmentRecord>, ServiceError> {
        sqlx::query(
            "SELECT a.*,
                    COALESCE(pa.content_text, p.content_text) AS content_text,
                    COALESCE(pa.content_kind, p.content_kind) AS content_kind,
                    COALESCE(pa.char_count, p.char_count) AS char_count,
                    COALESCE(pa.parser_kind || '_' || pa.parser_version, p.parser) AS parsed_parser,
                    COALESCE(pa.compressed_text, p.compressed_text) AS compressed_text,
                    COALESCE(pa.compression_kind, p.compression_kind) AS compression_kind,
                    COALESCE(pa.original_byte_count, p.original_byte_count) AS original_byte_count,
                    COALESCE(pa.stored_byte_count, p.stored_byte_count) AS stored_byte_count,
                    COALESCE(pa.created_at, p.created_at) AS parsed_created_at
             FROM attachments a
             LEFT JOIN attachment_parse_artifacts pa ON pa.parse_artifact_id = a.parse_artifact_id
             LEFT JOIN attachment_parsed_content p ON p.attachment_id = a.attachment_id
             WHERE a.loom_id = ?1
             ORDER BY a.created_at DESC, a.attachment_id ASC",
        )
        .bind(loom_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(attachment_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list Attachments for Loom: {error}"))
        })
    }

    pub async fn get_attachment(
        &self,
        attachment_id: &str,
    ) -> Result<Option<AttachmentRecord>, ServiceError> {
        sqlx::query(
            "SELECT a.*,
                    COALESCE(pa.content_text, p.content_text) AS content_text,
                    COALESCE(pa.content_kind, p.content_kind) AS content_kind,
                    COALESCE(pa.char_count, p.char_count) AS char_count,
                    COALESCE(pa.parser_kind || '_' || pa.parser_version, p.parser) AS parsed_parser,
                    COALESCE(pa.compressed_text, p.compressed_text) AS compressed_text,
                    COALESCE(pa.compression_kind, p.compression_kind) AS compression_kind,
                    COALESCE(pa.original_byte_count, p.original_byte_count) AS original_byte_count,
                    COALESCE(pa.stored_byte_count, p.stored_byte_count) AS stored_byte_count,
                    COALESCE(pa.created_at, p.created_at) AS parsed_created_at
             FROM attachments a
             LEFT JOIN attachment_parse_artifacts pa ON pa.parse_artifact_id = a.parse_artifact_id
             LEFT JOIN attachment_parsed_content p ON p.attachment_id = a.attachment_id
             WHERE a.attachment_id = ?1",
        )
        .bind(attachment_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(attachment_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to get Attachment: {error}")))
    }

    pub async fn reassign_attachment_loom(
        &self,
        attachment_id: &str,
        from_loom_id: &str,
        to_loom_id: &str,
        updated_at: &str,
    ) -> Result<Option<AttachmentRecord>, ServiceError> {
        let Some(existing) = self.get_attachment(attachment_id).await? else {
            return Ok(None);
        };
        if existing.loom_id == to_loom_id {
            return Ok(Some(existing));
        }
        if existing.loom_id != from_loom_id {
            return Ok(None);
        }
        let changed = sqlx::query(
            "UPDATE attachments
             SET loom_id = ?3,
                 updated_at = ?4
             WHERE attachment_id = ?1 AND loom_id = ?2",
        )
        .bind(attachment_id)
        .bind(from_loom_id)
        .bind(to_loom_id)
        .bind(updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to reassign Attachment Loom: {error}"))
        })?
        .rows_affected();
        if changed == 0 {
            return Ok(None);
        }
        self.get_attachment(attachment_id).await
    }

    /// Returns the raw blob bytes and file name for an attachment.
    /// Verifies that the attachment belongs to `loom_id` before returning bytes —
    /// if the attachment exists but belongs to a different loom, `None` is returned
    /// (same as "not found") to prevent cross-loom data access.
    ///
    /// Returns a controlled `ServiceError` (not a panic) when the blob bytes are
    /// NULL in both blob tables, which can happen due to data inconsistency.
    pub async fn get_attachment_blob(
        &self,
        attachment_id: &str,
        loom_id: &str,
    ) -> Result<Option<(String, Vec<u8>)>, ServiceError> {
        let row = sqlx::query(
            "SELECT a.file_name,
                    COALESCE(o.bytes, b.bytes) AS bytes
             FROM attachments a
             LEFT JOIN attachment_blob_objects o ON o.blob_id = a.blob_id
             LEFT JOIN attachment_blobs b ON b.attachment_id = a.attachment_id
             WHERE a.attachment_id = ?1 AND a.loom_id = ?2",
        )
        .bind(attachment_id)
        .bind(loom_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to get Attachment blob: {error}"))
        })?;

        let Some(row) = row else {
            return Ok(None);
        };

        let file_name: String = row.get("file_name");
        // Decode as Option to avoid a panic when COALESCE returns NULL (both
        // blob tables have no matching row, e.g. data inconsistency).
        let bytes: Option<Vec<u8>> = row.get("bytes");
        match bytes {
            Some(bytes) => Ok(Some((file_name, bytes))),
            None => Err(ServiceError::storage(
                "attachment blob data is missing — the file content could not be retrieved",
            )),
        }
    }

    pub async fn delete_attachment(&self, attachment_id: &str) -> Result<bool, ServiceError> {
        let result = sqlx::query("DELETE FROM attachments WHERE attachment_id = ?1")
            .bind(attachment_id)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to delete Attachment: {error}"))
            })?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn get_referenced_attachment_content(
        &self,
        loom_id: &str,
        attachment_id: &str,
        query: &str,
    ) -> Result<Option<AttachmentRecord>, ServiceError> {
        let mut attachment = match self.get_attachment(attachment_id).await? {
            Some(record) if record.loom_id == loom_id => record,
            _ => return Ok(None),
        };
        if attachment.parse_status == "ready" {
            let chunks = self
                .select_relevant_chunks(attachment_id, query, ATTACHMENT_CONTEXT_CHAR_BUDGET)
                .await?;
            if !chunks.is_empty() {
                let content_text = chunks
                    .iter()
                    .map(|chunk| {
                        format!(
                            "[chunk {} chars {}-{}]\n{}",
                            chunk.chunk_index + 1,
                            chunk.char_start,
                            chunk.char_end,
                            chunk.content_text
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                if let Some(content) = &mut attachment.parsed_content {
                    content.content_text = content_text;
                    content.char_count = chunks.iter().map(|chunk| chunk.char_count).sum();
                }
            }
        }
        Ok(Some(attachment))
    }

    pub async fn parse_attachment_now(
        &self,
        attachment_id: &str,
        updated_at: &str,
    ) -> Result<Option<AttachmentRecord>, ServiceError> {
        self.parse_attachment_now_with_ocr(attachment_id, updated_at, &OcrSection::default())
            .await
    }

    pub async fn parse_attachment_now_with_ocr(
        &self,
        attachment_id: &str,
        updated_at: &str,
        ocr_config: &OcrSection,
    ) -> Result<Option<AttachmentRecord>, ServiceError> {
        let row = sqlx::query(
            "SELECT a.attachment_id, a.file_name, a.mime_type, a.extension, a.sha256,
                    COALESCE(o.bytes, b.bytes) AS bytes
             FROM attachments a
             LEFT JOIN attachment_blob_objects o ON o.blob_id = a.blob_id
             LEFT JOIN attachment_blobs b ON b.attachment_id = a.attachment_id
             WHERE a.attachment_id = ?1",
        )
        .bind(attachment_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to fetch Attachment blob: {error}"))
        })?;

        let Some(row) = row else {
            return Ok(None);
        };

        let file_name: String = row.get("file_name");
        let mime_type: Option<String> = row.get("mime_type");
        let extension: Option<String> = row.get("extension");
        let sha256: Option<String> = row.get("sha256");
        // Decode as Option to avoid panicking when COALESCE returns NULL
        // (both blob tables have no matching row, e.g. data inconsistency).
        let bytes: Option<Vec<u8>> = row.get("bytes");
        let Some(bytes) = bytes else {
            return Ok(None);
        };
        let sha256 = sha256.unwrap_or_else(|| sha256_hex(&bytes));
        sqlx::query(
            "UPDATE attachments SET sha256 = ?2 WHERE attachment_id = ?1 AND sha256 IS NULL",
        )
        .bind(attachment_id)
        .bind(&sha256)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to backfill Attachment checksum: {error}"))
        })?;

        self.update_parse_job(attachment_id, "parsing", None, 10, None, updated_at)
            .await?;
        let parser_stage = parser_stage_for(extension.as_deref(), mime_type.as_deref());
        self.update_parse_job(attachment_id, parser_stage, None, 35, None, updated_at)
            .await?;

        let parser = initial_parse_state(&file_name, mime_type.as_deref(), &extension).parser;
        if let Some(parser) = parser.as_deref() {
            let pdf_ocr_may_apply = parser == "pdf_text_density_v1" && ocr_config.enabled;
            if pdf_ocr_may_apply {
                if let Some(artifact) = self
                    .find_parse_artifact(&sha256, "pdf_ocr_tesseract_v1")
                    .await?
                {
                    self.attach_parse_artifact(attachment_id, &artifact, updated_at)
                        .await?;
                    return self.get_attachment(attachment_id).await;
                }
            }
            if !pdf_ocr_may_apply {
                if let Some(artifact) = self.find_parse_artifact(&sha256, parser).await? {
                    self.attach_parse_artifact(attachment_id, &artifact, updated_at)
                        .await?;
                    return self.get_attachment(attachment_id).await;
                }
            }
        }

        let mut parsed = parse_attachment(&file_name, mime_type.as_deref(), &extension, &bytes);
        if should_attempt_pdf_ocr(
            &parsed,
            extension.as_deref(),
            mime_type.as_deref(),
            ocr_config,
        ) {
            self.update_parse_job(
                attachment_id,
                "ocr_running",
                Some("pdf_ocr_tesseract_v1"),
                60,
                None,
                updated_at,
            )
            .await?;
            parsed = run_pdf_ocr_pipeline(attachment_id, &bytes, parsed, ocr_config, updated_at);
        }
        self.store_parse_result(attachment_id, parsed, updated_at)
            .await?;
        self.get_attachment(attachment_id).await
    }

    async fn update_parse_job(
        &self,
        attachment_id: &str,
        status: &str,
        parser: Option<&str>,
        progress: i64,
        error: Option<&str>,
        updated_at: &str,
    ) -> Result<(), ServiceError> {
        sqlx::query(
            "UPDATE attachment_parse_jobs
             SET status = ?2,
                 parser = COALESCE(?3, parser),
                 progress = ?4,
                 error = ?5,
                 updated_at = ?6
             WHERE attachment_id = ?1",
        )
        .bind(attachment_id)
        .bind(status)
        .bind(parser)
        .bind(progress)
        .bind(error)
        .bind(updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to update parse job: {error}")))?;
        Ok(())
    }

    async fn find_parse_artifact(
        &self,
        sha256: &str,
        parser: &str,
    ) -> Result<Option<ParseArtifactRecord>, ServiceError> {
        let (parser_kind, parser_version) = parser_cache_key(parser);
        sqlx::query(
            "SELECT parse_artifact_id, kind, parser_kind, parser_version, metadata_json
             FROM attachment_parse_artifacts
             WHERE sha256 = ?1 AND parser_kind = ?2 AND parser_version = ?3",
        )
        .bind(sha256)
        .bind(&parser_kind)
        .bind(&parser_version)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(parse_artifact_from_row))
        .map_err(|error| {
            ServiceError::storage(format!("failed to find Attachment parse artifact: {error}"))
        })
    }

    async fn attach_parse_artifact(
        &self,
        attachment_id: &str,
        artifact: &ParseArtifactRecord,
        updated_at: &str,
    ) -> Result<(), ServiceError> {
        let mut transaction = self.pool.begin().await.map_err(|error| {
            ServiceError::storage(format!(
                "failed to start parse artifact transaction: {error}"
            ))
        })?;
        sqlx::query(
            "UPDATE attachments
             SET kind = ?2,
                 parse_status = 'ready',
                 parser = ?3,
                 error = NULL,
                 metadata_json = ?4,
                 parse_artifact_id = ?5,
                 updated_at = ?6
             WHERE attachment_id = ?1",
        )
        .bind(attachment_id)
        .bind(&artifact.kind)
        .bind(&artifact.parser)
        .bind(&artifact.metadata_json)
        .bind(&artifact.parse_artifact_id)
        .bind(updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to attach parse artifact: {error}"))
        })?;
        sqlx::query(
            "UPDATE attachment_parse_jobs
             SET status = 'ready',
                 parser = ?2,
                 progress = 100,
                 error = NULL,
                 updated_at = ?3
             WHERE attachment_id = ?1",
        )
        .bind(attachment_id)
        .bind(&artifact.parser)
        .bind(updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to finalize cached parse job: {error}"))
        })?;
        transaction.commit().await.map_err(|error| {
            ServiceError::storage(format!(
                "failed to commit parse artifact transaction: {error}"
            ))
        })?;
        Ok(())
    }

    async fn store_parse_result(
        &self,
        attachment_id: &str,
        parsed: ParsedAttachment,
        updated_at: &str,
    ) -> Result<(), ServiceError> {
        let mut transaction = self.pool.begin().await.map_err(|error| {
            ServiceError::storage(format!("failed to start parse result transaction: {error}"))
        })?;

        sqlx::query(
            "UPDATE attachments
             SET kind = ?2,
                 parse_status = ?3,
                 parser = ?4,
                 error = ?5,
                 thumbnail_data_url = ?6,
                 metadata_json = ?7,
                 updated_at = ?8
             WHERE attachment_id = ?1",
        )
        .bind(attachment_id)
        .bind(&parsed.kind)
        .bind(&parsed.parse_status)
        .bind(&parsed.parser)
        .bind(&parsed.error)
        .bind(&parsed.thumbnail_data_url)
        .bind(&parsed.metadata_json)
        .bind(updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to update Attachment parse result: {error}"))
        })?;

        sqlx::query("DELETE FROM attachment_parsed_content WHERE attachment_id = ?1")
            .bind(attachment_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to clear parsed content: {error}"))
            })?;
        sqlx::query("DELETE FROM attachment_parsed_chunks WHERE attachment_id = ?1")
            .bind(attachment_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to clear parsed chunks: {error}"))
            })?;
        sqlx::query("DELETE FROM attachment_summaries WHERE attachment_id = ?1")
            .bind(attachment_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to clear summaries: {error}"))
            })?;

        if parsed.content.is_none() {
            sqlx::query(
                "UPDATE attachments
                 SET parse_artifact_id = NULL
                 WHERE attachment_id = ?1",
            )
            .bind(attachment_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to clear parse artifact link: {error}"))
            })?;
        }

        if let Some(content) = &parsed.content {
            let attachment_sha = sqlx::query_scalar::<_, String>(
                "SELECT sha256 FROM attachments WHERE attachment_id = ?1",
            )
            .bind(attachment_id)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to read Attachment checksum: {error}"))
            })?;
            let stored = prepare_content_storage(&content.content_text);
            let (parser_kind, parser_version) = parser_cache_key(&content.parser);
            let parse_artifact_id =
                parse_artifact_id(&attachment_sha, &parser_kind, &parser_version);
            sqlx::query(
                "INSERT OR IGNORE INTO attachment_parse_artifacts (
                    parse_artifact_id, sha256, parser_kind, parser_version, kind, content_kind,
                    content_text, compressed_text, compression_kind, char_count,
                    original_byte_count, stored_byte_count, metadata_json, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            )
            .bind(&parse_artifact_id)
            .bind(&attachment_sha)
            .bind(&parser_kind)
            .bind(&parser_version)
            .bind(&parsed.kind)
            .bind(&content.content_kind)
            .bind(&stored.content_text)
            .bind(&stored.compressed_text)
            .bind(&stored.compression_kind)
            .bind(content.char_count)
            .bind(stored.original_byte_count)
            .bind(stored.stored_byte_count)
            .bind(&parsed.metadata_json)
            .bind(updated_at)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to insert parse artifact: {error}"))
            })?;

            for chunk in chunk_text(&content.content_text) {
                sqlx::query(
                    "INSERT OR IGNORE INTO attachment_parse_artifact_chunks (
                        chunk_id, parse_artifact_id, chunk_index, content_text, char_start, char_end,
                        char_count, token_estimate, page_number, sheet_name, metadata_json, created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, ?9)",
                )
                .bind(format!("{}-chunk-{}", parse_artifact_id, chunk.chunk_index))
                .bind(&parse_artifact_id)
                .bind(chunk.chunk_index)
                .bind(&chunk.content_text)
                .bind(chunk.char_start)
                .bind(chunk.char_end)
                .bind(chunk.char_count)
                .bind(chunk.token_estimate)
                .bind(updated_at)
                .execute(&mut *transaction)
                .await
                .map_err(|error| ServiceError::storage(format!("failed to insert parse artifact chunk: {error}")))?;
            }

            let summary = summarize_text(&content.content_text);
            sqlx::query(
                "INSERT OR IGNORE INTO attachment_parse_artifact_summaries (
                    parse_artifact_id, summary_text, summary_kind, parser, created_at, updated_at
                ) VALUES (?1, ?2, 'extractive_head_v1', ?3, ?4, ?4)",
            )
            .bind(&parse_artifact_id)
            .bind(summary)
            .bind(&content.parser)
            .bind(updated_at)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to insert parse artifact summary: {error}"))
            })?;

            sqlx::query(
                "UPDATE attachments
                 SET parse_artifact_id = ?2
                 WHERE attachment_id = ?1",
            )
            .bind(attachment_id)
            .bind(&parse_artifact_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to link parse artifact: {error}"))
            })?;
        }

        let job_status = if parsed.parse_status == "ready" {
            "ready"
        } else {
            parsed.parse_status.as_str()
        };
        sqlx::query(
            "UPDATE attachment_parse_jobs
             SET status = ?2,
                 parser = ?3,
                 progress = CASE WHEN ?2 = 'ready' THEN 100 ELSE progress END,
                 error = ?4,
                 updated_at = ?5
             WHERE attachment_id = ?1",
        )
        .bind(attachment_id)
        .bind(job_status)
        .bind(&parsed.parser)
        .bind(&parsed.error)
        .bind(updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to finalize parse job: {error}")))?;

        transaction.commit().await.map_err(|error| {
            ServiceError::storage(format!(
                "failed to commit parse result transaction: {error}"
            ))
        })?;
        Ok(())
    }

    async fn select_relevant_chunks(
        &self,
        attachment_id: &str,
        query: &str,
        char_budget: usize,
    ) -> Result<Vec<AttachmentParsedChunkRecord>, ServiceError> {
        let attachment_row = sqlx::query(
            "SELECT parse_artifact_id, file_name, extension
             FROM attachments
             WHERE attachment_id = ?1",
        )
        .bind(attachment_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to fetch Attachment parse artifact link: {error}"
            ))
        })?;
        let Some(attachment_row) = attachment_row else {
            return Ok(Vec::new());
        };
        let parse_artifact_id: Option<String> = attachment_row.get("parse_artifact_id");
        let file_name: String = attachment_row.get("file_name");
        let extension: Option<String> = attachment_row.get("extension");

        let rows = if let Some(parse_artifact_id) = parse_artifact_id {
            sqlx::query(
                "SELECT chunk_id, NULL AS attachment_id, parse_artifact_id, chunk_index, content_text,
                        char_start, char_end, char_count, token_estimate, page_number, sheet_name,
                        metadata_json
                 FROM attachment_parse_artifact_chunks
                 WHERE parse_artifact_id = ?1
                 ORDER BY chunk_index ASC",
            )
            .bind(parse_artifact_id)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query(
                "SELECT chunk_id, attachment_id, NULL AS parse_artifact_id, chunk_index, content_text,
                        char_start, char_end, char_count, token_estimate, page_number, sheet_name,
                        metadata_json
                 FROM attachment_parsed_chunks
                 WHERE attachment_id = ?1
                 ORDER BY chunk_index ASC",
            )
            .bind(attachment_id)
            .fetch_all(&self.pool)
            .await
        }
        .map_err(|error| {
            ServiceError::storage(format!("failed to fetch parsed chunks: {error}"))
        })?;

        let mut chunks = rows.into_iter().map(chunk_from_row).collect::<Vec<_>>();
        if chunks.is_empty() {
            return Ok(chunks);
        }
        let query_terms = query_terms(query);
        if !query_terms.is_empty() {
            let ranking_context = AttachmentRankingContext::new(
                query,
                &query_terms,
                &file_name,
                extension.as_deref(),
            );
            chunks.sort_by(|a, b| {
                rank_attachment_chunk(b, &ranking_context)
                    .score
                    .cmp(&rank_attachment_chunk(a, &ranking_context).score)
                    .then_with(|| a.chunk_index.cmp(&b.chunk_index))
            });
            for chunk in &mut chunks {
                let ranking = rank_attachment_chunk(chunk, &ranking_context);
                if ranking.score <= 0 {
                    continue;
                }
                let metadata = serde_json::json!({
                    "rankingScore": ranking.score,
                    "rankingReasons": ranking.reasons,
                });
                chunk.metadata_json = Some(match chunk.metadata_json.as_deref() {
                    Some(existing) if !existing.trim().is_empty() => {
                        merge_metadata_json(existing, metadata)
                    }
                    _ => metadata.to_string(),
                });
            }
        }
        let mut selected = Vec::new();
        let mut used = 0usize;
        for chunk in chunks {
            let next = chunk.content_text.chars().count();
            if !selected.is_empty() && used + next > char_budget {
                continue;
            }
            used += next;
            selected.push(chunk);
            if used >= char_budget {
                break;
            }
        }
        selected.sort_by(|a, b| a.chunk_index.cmp(&b.chunk_index));
        Ok(selected)
    }
}

pub fn parse_attachment(
    file_name: &str,
    mime_type: Option<&str>,
    extension: &Option<String>,
    bytes: &[u8],
) -> ParsedAttachment {
    let normalized_mime = mime_type.unwrap_or("").to_ascii_lowercase();
    let ext = extension.as_deref().unwrap_or("").to_ascii_lowercase();
    if is_text_like(&normalized_mime, &ext) {
        return match String::from_utf8(bytes.to_vec()) {
            Ok(text) => {
                let content_kind = match ext.as_str() {
                    "md" => "markdown",
                    "json" => "json",
                    "xml" => "xml",
                    "csv" => "csv",
                    _ => "text",
                }
                .to_string();
                ParsedAttachment {
                    kind: content_kind.clone(),
                    parse_status: "ready".to_string(),
                    parser: Some("utf8_text_v1".to_string()),
                    error: None,
                    thumbnail_data_url: None,
                    metadata_json: None,
                    content: Some(NewAttachmentParsedContent {
                        char_count: text.chars().count() as i64,
                        content_text: text,
                        content_kind,
                        parser: "utf8_text_v1".to_string(),
                    }),
                }
            }
            Err(_) => pending_or_failed("text", "failed", "File is not valid UTF-8 text."),
        };
    }

    if normalized_mime.starts_with("image/")
        || matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp")
    {
        return pending_or_failed(
            "image",
            "unsupported",
            &format!(
                "Image attachment '{file_name}' is visible but unsupported until a vision-capable runtime is configured."
            ),
        );
    }

    match ext.as_str() {
        "pdf" => parse_pdf_native_text(bytes),
        "docx" => parse_docx_text(bytes),
        "doc" => pending_or_failed(
            "document",
            "unsupported",
            "Legacy .doc files are unsupported. Convert the file to .docx.",
        ),
        "xlsx" => parse_xlsx_text(bytes),
        "xls" => pending_or_failed(
            "spreadsheet",
            "unsupported",
            "Legacy .xls files are unsupported. Convert the file to .xlsx.",
        ),
        _ => pending_or_failed(
            "unsupported",
            "unsupported",
            "This file type is visible but unsupported for parsing.",
        ),
    }
}

pub fn ocr_provider_status(config: &OcrSection) -> OcrProviderStatus {
    let provider = config.provider.clone();
    let command_path = detect_command(config.command_path.as_deref(), TESSERACT_COMMAND_CANDIDATES);
    let rasterizer_path = detect_command(
        config.pdf_rasterizer_command_path.as_deref(),
        PDF_RASTERIZER_COMMAND_CANDIDATES,
    );
    let mut warnings = Vec::new();
    if config.provider != "tesseract" {
        warnings.push("unsupported_ocr_provider".to_string());
    }
    if config.enabled && command_path.is_none() {
        warnings.push("tesseract_not_found".to_string());
    }
    if config.enabled && rasterizer_path.is_none() {
        warnings.push("pdf_rasterizer_not_found".to_string());
    }
    let status = if !config.enabled {
        "disabled"
    } else if config.provider != "tesseract" || command_path.is_none() || rasterizer_path.is_none()
    {
        "unavailable"
    } else {
        "configured"
    }
    .to_string();
    let message = match status.as_str() {
        "disabled" => "OCR is disabled. Scanned PDFs remain OCR needed.".to_string(),
        "configured" => "Tesseract OCR and PDF rasterizer are configured.".to_string(),
        _ => {
            "OCR is enabled but Tesseract or the PDF rasterizer is unavailable. Scanned PDFs remain OCR needed."
                .to_string()
        }
    };
    OcrProviderStatus {
        status,
        provider,
        enabled: config.enabled,
        command_path: command_path.map(|path| path.display().to_string()),
        rasterizer_command_path: rasterizer_path.map(|path| path.display().to_string()),
        language: config.language.clone(),
        dpi: config.dpi,
        message,
        warnings,
    }
}

fn initial_parse_state(
    file_name: &str,
    mime_type: Option<&str>,
    extension: &Option<String>,
) -> ParsedAttachment {
    let normalized_mime = mime_type.unwrap_or("").to_ascii_lowercase();
    let ext = extension.as_deref().unwrap_or("").to_ascii_lowercase();
    if normalized_mime.starts_with("image/")
        || matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp")
    {
        return pending_or_failed(
            "image",
            "unsupported",
            &format!(
                "Image attachment '{file_name}' is visible but unsupported until a vision-capable runtime is configured."
            ),
        );
    }
    if is_text_like(&normalized_mime, &ext) {
        return queued("text", "utf8_text_v1");
    }
    match ext.as_str() {
        "pdf" => queued("pdf", "pdf_text_density_v1"),
        "docx" => queued("document", "docx_text_v1"),
        "doc" => pending_or_failed(
            "document",
            "unsupported",
            "Legacy .doc files are unsupported. Convert the file to .docx.",
        ),
        "xlsx" => queued("spreadsheet", "xlsx_sheet_text_v1"),
        "xls" => pending_or_failed(
            "spreadsheet",
            "unsupported",
            "Legacy .xls files are unsupported. Convert the file to .xlsx.",
        ),
        _ => pending_or_failed(
            "unsupported",
            "unsupported",
            "This file type is visible but unsupported for parsing.",
        ),
    }
}

fn queued(kind: &str, parser: &str) -> ParsedAttachment {
    ParsedAttachment {
        kind: kind.to_string(),
        parse_status: "queued".to_string(),
        parser: Some(parser.to_string()),
        error: None,
        thumbnail_data_url: None,
        metadata_json: None,
        content: None,
    }
}

fn parser_stage_for(extension: Option<&str>, mime_type: Option<&str>) -> &'static str {
    let ext = extension.unwrap_or_default();
    let mime = mime_type.unwrap_or_default();
    if matches!(ext, "pdf" | "docx" | "xlsx") || mime.eq_ignore_ascii_case("application/pdf") {
        "extracting_text"
    } else {
        "parsing"
    }
}

const TESSERACT_COMMAND_CANDIDATES: &[&str] = &[
    "/opt/homebrew/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/usr/bin/tesseract",
];
const PDF_RASTERIZER_COMMAND_CANDIDATES: &[&str] = &[
    "/opt/homebrew/bin/pdftoppm",
    "/usr/local/bin/pdftoppm",
    "/usr/bin/pdftoppm",
];

fn should_attempt_pdf_ocr(
    parsed: &ParsedAttachment,
    extension: Option<&str>,
    mime_type: Option<&str>,
    config: &OcrSection,
) -> bool {
    if !config.enabled || config.provider != "tesseract" {
        return false;
    }
    let ext = extension.unwrap_or_default();
    let mime = mime_type.unwrap_or_default();
    if ext != "pdf" && !mime.eq_ignore_ascii_case("application/pdf") {
        return false;
    }
    let pages = ocr_needed_pages_from_metadata(parsed.metadata_json.as_deref());
    !pages.is_empty()
}

fn run_pdf_ocr_pipeline(
    attachment_id: &str,
    bytes: &[u8],
    parsed: ParsedAttachment,
    config: &OcrSection,
    updated_at: &str,
) -> ParsedAttachment {
    let pages = ocr_needed_pages_from_metadata(parsed.metadata_json.as_deref());
    if pages.is_empty() {
        return parsed;
    }
    let Some(tesseract_path) =
        detect_command(config.command_path.as_deref(), TESSERACT_COMMAND_CANDIDATES)
    else {
        return annotate_ocr_unavailable(parsed, "tesseract_not_found");
    };
    let Some(rasterizer_path) = detect_command(
        config.pdf_rasterizer_command_path.as_deref(),
        PDF_RASTERIZER_COMMAND_CANDIDATES,
    ) else {
        return annotate_ocr_unavailable(parsed, "pdf_rasterizer_not_found");
    };
    if pages.len() > config.max_pages_per_file as usize {
        return annotate_ocr_unavailable(parsed, "ocr_page_limit_exceeded");
    }

    match run_pdf_ocr_pages(
        attachment_id,
        bytes,
        &pages,
        &tesseract_path,
        &rasterizer_path,
        config,
    ) {
        Ok(result) => merge_ocr_result(parsed, result, config, updated_at),
        Err(error) => annotate_ocr_failure(parsed, &error),
    }
}

#[derive(Debug, Clone)]
struct PdfOcrResult {
    pages: Vec<PdfOcrPageResult>,
    temp_files_removed: bool,
}

#[derive(Debug, Clone)]
struct PdfOcrPageResult {
    page_number: i64,
    text: String,
}

fn run_pdf_ocr_pages(
    attachment_id: &str,
    bytes: &[u8],
    pages: &[i64],
    tesseract_path: &Path,
    rasterizer_path: &Path,
    config: &OcrSection,
) -> Result<PdfOcrResult, String> {
    let temp_root = ocr_temp_root(config);
    fs::create_dir_all(&temp_root)
        .map_err(|error| format!("OCR temp directory could not be created: {error}"))?;
    let work_dir = temp_root.join(format!(
        "loom-ocr-{attachment_id}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&work_dir)
        .map_err(|error| format!("OCR work directory could not be created: {error}"))?;
    let pdf_path = work_dir.join("input.pdf");
    fs::write(&pdf_path, bytes).map_err(|error| format!("OCR input PDF write failed: {error}"))?;

    let mut page_results = Vec::new();
    for page in pages {
        let image_path = render_pdf_page(
            rasterizer_path,
            &pdf_path,
            &work_dir,
            *page,
            config.dpi,
            Duration::from_secs(config.timeout_seconds),
        )?;
        let output = run_ocr_command(
            tesseract_path,
            &image_path,
            &config.language,
            Duration::from_secs(config.timeout_seconds),
        )?;
        let text = output.trim().to_string();
        if !text.is_empty() {
            page_results.push(PdfOcrPageResult {
                page_number: *page,
                text,
            });
        }
    }
    let temp_files_removed = fs::remove_dir_all(&work_dir).is_ok();
    Ok(PdfOcrResult {
        pages: page_results,
        temp_files_removed,
    })
}

fn render_pdf_page(
    rasterizer_path: &Path,
    pdf_path: &Path,
    work_dir: &Path,
    page_number: i64,
    dpi: u32,
    timeout: Duration,
) -> Result<PathBuf, String> {
    let output_prefix = work_dir.join(format!("page-{page_number}"));
    let args = vec![
        "-f".to_string(),
        page_number.to_string(),
        "-l".to_string(),
        page_number.to_string(),
        "-r".to_string(),
        dpi.to_string(),
        "-png".to_string(),
        pdf_path.display().to_string(),
        output_prefix.display().to_string(),
    ];
    let output = run_command_with_timeout(rasterizer_path, &args, timeout)?;
    if !output.status_success {
        return Err(format!(
            "PDF rasterizer failed for page {page_number}: {}",
            bounded_stderr(&output.stderr)
        ));
    }
    find_rendered_page_image(work_dir, &format!("page-{page_number}"))
        .ok_or_else(|| format!("PDF rasterizer did not produce an image for page {page_number}"))
}

fn run_ocr_command(
    tesseract_path: &Path,
    image_path: &Path,
    language: &str,
    timeout: Duration,
) -> Result<String, String> {
    let args = vec![
        image_path.display().to_string(),
        "stdout".to_string(),
        "-l".to_string(),
        language.to_string(),
        "--psm".to_string(),
        "3".to_string(),
    ];
    let output = run_command_with_timeout(tesseract_path, &args, timeout)?;
    if !output.status_success {
        return Err(format!(
            "Tesseract OCR failed: {}",
            bounded_stderr(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

struct CommandOutput {
    status_success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn run_command_with_timeout(
    command_path: &Path,
    args: &[String],
    timeout: Duration,
) -> Result<CommandOutput, String> {
    let mut child = Command::new(command_path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start {}: {error}", command_path.display()))?;
    let start = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| format!("failed to poll {}: {error}", command_path.display()))?
            .is_some()
        {
            let output = child.wait_with_output().map_err(|error| {
                format!(
                    "failed to collect {} output: {error}",
                    command_path.display()
                )
            })?;
            return Ok(CommandOutput {
                status_success: output.status.success(),
                stdout: output.stdout,
                stderr: output.stderr,
            });
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{} timed out", command_path.display()));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn merge_ocr_result(
    mut parsed: ParsedAttachment,
    result: PdfOcrResult,
    config: &OcrSection,
    updated_at: &str,
) -> ParsedAttachment {
    if result.pages.is_empty() {
        return annotate_ocr_failure(
            parsed,
            "Tesseract OCR produced no text for OCR-needed pages.",
        );
    }
    let native_text = parsed
        .content
        .as_ref()
        .map(|content| content.content_text.trim().to_string())
        .filter(|text| !text.is_empty());
    let ocr_text = result
        .pages
        .iter()
        .map(|page| format!("[OCR page {}]\n{}", page.page_number, page.text))
        .collect::<Vec<_>>()
        .join("\n\n");
    let content_text = match native_text {
        Some(native) => format!("{native}\n\n{ocr_text}"),
        None => ocr_text,
    };
    let metadata = merge_pdf_ocr_metadata(
        parsed.metadata_json.as_deref(),
        serde_json::json!({
            "status": "ready",
            "provider": "tesseract",
            "parserKind": "pdf_ocr_tesseract_v1",
            "language": config.language,
            "dpi": config.dpi,
            "pagesSucceeded": result.pages.iter().map(|page| page.page_number).collect::<Vec<_>>(),
            "tempFilesRemoved": result.temp_files_removed,
            "updatedAt": updated_at,
        }),
    );
    parsed.parse_status = "ready".to_string();
    parsed.parser = Some("pdf_ocr_tesseract_v1".to_string());
    parsed.error = None;
    parsed.metadata_json = Some(metadata);
    parsed.content = Some(NewAttachmentParsedContent {
        char_count: content_text.chars().count() as i64,
        content_text,
        content_kind: "pdf_ocr_text".to_string(),
        parser: "pdf_ocr_tesseract_v1".to_string(),
    });
    parsed
}

fn annotate_ocr_unavailable(parsed: ParsedAttachment, reason: &str) -> ParsedAttachment {
    annotate_ocr_metadata(parsed, "unavailable", reason)
}

fn annotate_ocr_failure(parsed: ParsedAttachment, reason: &str) -> ParsedAttachment {
    annotate_ocr_metadata(parsed, "failed", reason)
}

fn annotate_ocr_metadata(
    mut parsed: ParsedAttachment,
    status: &str,
    reason: &str,
) -> ParsedAttachment {
    parsed.metadata_json = Some(merge_pdf_ocr_metadata(
        parsed.metadata_json.as_deref(),
        serde_json::json!({
            "status": status,
            "provider": "tesseract",
            "reason": reason,
        }),
    ));
    if parsed.content.is_none() && status == "failed" {
        parsed.parse_status = "failed".to_string();
        parsed.error = Some(reason.to_string());
    }
    parsed
}

fn merge_pdf_ocr_metadata(existing: Option<&str>, ocr: serde_json::Value) -> String {
    let mut value = existing
        .and_then(|metadata| serde_json::from_str::<serde_json::Value>(metadata).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert("ocr".to_string(), ocr);
        value.to_string()
    } else {
        serde_json::json!({ "ocr": ocr }).to_string()
    }
}

fn ocr_needed_pages_from_metadata(metadata_json: Option<&str>) -> Vec<i64> {
    metadata_json
        .and_then(|metadata| serde_json::from_str::<serde_json::Value>(metadata).ok())
        .and_then(|value| value.get("ocrNeededPages").cloned())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_i64())
        .collect()
}

fn detect_command(configured: Option<&str>, candidates: &[&str]) -> Option<PathBuf> {
    configured
        .map(PathBuf::from)
        .filter(|path| executable_file(path))
        .or_else(|| {
            candidates
                .iter()
                .map(PathBuf::from)
                .find(|path| executable_file(path))
        })
}

fn executable_file(path: &Path) -> bool {
    path.is_file()
}

fn ocr_temp_root(config: &OcrSection) -> PathBuf {
    config
        .temp_dir
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

fn find_rendered_page_image(work_dir: &Path, prefix: &str) -> Option<PathBuf> {
    fs::read_dir(work_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.starts_with(prefix)
                        && matches!(
                            path.extension().and_then(|extension| extension.to_str()),
                            Some("png" | "ppm" | "pgm" | "pbm" | "tif" | "tiff")
                        )
                })
        })
}

fn bounded_stderr(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let trimmed = text.trim();
    if trimmed.chars().count() <= 400 {
        trimmed.to_string()
    } else {
        trimmed.chars().take(400).collect()
    }
}

fn parse_pdf_native_text(bytes: &[u8]) -> ParsedAttachment {
    let lossy = String::from_utf8_lossy(bytes);
    let analysis = analyze_pdf_pages(&lossy);
    let metadata_json = Some(pdf_analysis_metadata_json(&analysis));
    let extracted = analysis
        .pages
        .iter()
        .filter(|page| page.has_context_text())
        .map(|page| page.extracted_text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let ocr_pages = analysis.ocr_needed_pages();
    let error = if ocr_pages.is_empty() {
        None
    } else {
        Some(format!(
            "OCR needed for {} page{}: {}. OCR is not configured.",
            ocr_pages.len(),
            if ocr_pages.len() == 1 { "" } else { "s" },
            ocr_pages
                .iter()
                .map(i64::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ))
    };

    if extracted.trim().is_empty() {
        let parse_status = if analysis.document_classification == "scanned_pdf" {
            "ocr_needed"
        } else {
            "unsupported"
        };
        let error = error.or_else(|| {
            Some(
                "Selectable PDF text was not detected. OCR is needed, but no local OCR engine is enabled."
                    .to_string(),
            )
        });
        return ParsedAttachment {
            kind: analysis.document_classification,
            parse_status: parse_status.to_string(),
            parser: Some("pdf_text_density_v1".to_string()),
            error,
            thumbnail_data_url: None,
            metadata_json,
            content: None,
        };
    }

    ParsedAttachment {
        kind: analysis.document_classification,
        parse_status: "ready".to_string(),
        parser: Some("pdf_text_density_v1".to_string()),
        error,
        thumbnail_data_url: None,
        metadata_json,
        content: Some(NewAttachmentParsedContent {
            char_count: extracted.chars().count() as i64,
            content_text: extracted,
            content_kind: "pdf_text".to_string(),
            parser: "pdf_text_density_v1".to_string(),
        }),
    }
}

fn parse_docx_text(bytes: &[u8]) -> ParsedAttachment {
    let mut archive = match open_office_archive(bytes) {
        Ok(archive) => archive,
        Err(error) => {
            return parser_failed(
                "document",
                "docx_text_v1",
                &format!("DOCX parse failed: {error}"),
            )
        }
    };
    if office_archive_is_encrypted(&mut archive) {
        return parser_failed(
            "document",
            "docx_text_v1",
            "DOCX files that are encrypted or password-protected are unsupported.",
        );
    }
    let document = match read_zip_text(&mut archive, "word/document.xml") {
        Ok(document) => document,
        Err(error) => {
            return parser_failed(
                "document",
                "docx_text_v1",
                &format!("DOCX parse failed: {error}"),
            )
        }
    };
    let paragraphs = extract_docx_paragraphs(&document);
    let mut truncated = false;
    let mut output = String::new();
    for paragraph in &paragraphs {
        append_limited_line(
            &mut output,
            paragraph,
            DOCX_MAX_EXTRACTED_CHARS,
            &mut truncated,
        );
        if truncated {
            break;
        }
    }
    let extracted_chars = output.chars().count();
    if output.trim().is_empty() {
        return parser_failed(
            "document",
            "docx_text_v1",
            "DOCX text was not found or the file is unsupported.",
        );
    }
    let mut warnings = Vec::new();
    if truncated {
        warnings.push("DOCX text was truncated at the parser character limit.");
    }
    let metadata_json = serde_json::json!({
        "parserKind": "docx_text_v1",
        "paragraphCount": paragraphs.len(),
        "extractedChars": extracted_chars,
        "truncated": truncated,
        "warnings": warnings,
    })
    .to_string();
    ParsedAttachment {
        kind: "document".to_string(),
        parse_status: "ready".to_string(),
        parser: Some("docx_text_v1".to_string()),
        error: None,
        thumbnail_data_url: None,
        metadata_json: Some(metadata_json),
        content: Some(NewAttachmentParsedContent {
            char_count: extracted_chars as i64,
            content_text: output,
            content_kind: "document_text".to_string(),
            parser: "docx_text_v1".to_string(),
        }),
    }
}

fn parse_xlsx_text(bytes: &[u8]) -> ParsedAttachment {
    let mut archive = match open_office_archive(bytes) {
        Ok(archive) => archive,
        Err(error) => {
            return parser_failed(
                "spreadsheet",
                "xlsx_sheet_text_v1",
                &format!("XLSX parse failed: {error}"),
            )
        }
    };
    if office_archive_is_encrypted(&mut archive) {
        return parser_failed(
            "spreadsheet",
            "xlsx_sheet_text_v1",
            "XLSX files that are encrypted or password-protected are unsupported.",
        );
    }
    let shared_strings = read_zip_text(&mut archive, "xl/sharedStrings.xml")
        .map(|xml| extract_xlsx_shared_strings(&xml))
        .unwrap_or_default();
    let workbook = match read_zip_text(&mut archive, "xl/workbook.xml") {
        Ok(workbook) => workbook,
        Err(error) => {
            return parser_failed(
                "spreadsheet",
                "xlsx_sheet_text_v1",
                &format!("XLSX parse failed: {error}"),
            )
        }
    };
    let sheets = extract_xlsx_sheets(&workbook);
    if sheets.is_empty() {
        return parser_failed(
            "spreadsheet",
            "xlsx_sheet_text_v1",
            "XLSX workbook has no readable worksheets.",
        );
    }
    let mut truncated = false;
    let mut warnings = Vec::<String>::new();
    let mut output = String::new();
    let mut sheets_processed = 0usize;
    let mut rows_processed = 0usize;
    let mut cells_processed = 0usize;
    for sheet in sheets.iter().take(XLSX_MAX_SHEETS) {
        let path = format!("xl/worksheets/sheet{}.xml", sheet.sheet_id);
        let sheet_xml = match read_zip_text(&mut archive, &path) {
            Ok(xml) => xml,
            Err(_) => {
                warnings.push(format!("Worksheet '{}' could not be read.", sheet.name));
                continue;
            }
        };
        sheets_processed += 1;
        append_limited_line(
            &mut output,
            &format!("# Sheet: {}", sheet.name),
            XLSX_MAX_EXTRACTED_CHARS,
            &mut truncated,
        );
        let rows = extract_xlsx_rows(&sheet_xml, &shared_strings);
        if rows.len() > XLSX_MAX_ROWS_PER_SHEET {
            truncated = true;
            warnings.push(format!(
                "Sheet '{}' was limited to the first {XLSX_MAX_ROWS_PER_SHEET} rows.",
                sheet.name
            ));
        }
        for row in rows.into_iter().take(XLSX_MAX_ROWS_PER_SHEET) {
            if row.cells.len() > XLSX_MAX_CELLS_PER_ROW {
                truncated = true;
                warnings.push(format!(
                    "A row in sheet '{}' was limited to the first {XLSX_MAX_CELLS_PER_ROW} cells.",
                    sheet.name
                ));
            }
            let cells = row
                .cells
                .into_iter()
                .take(XLSX_MAX_CELLS_PER_ROW)
                .collect::<Vec<_>>();
            if cells.is_empty() {
                continue;
            }
            rows_processed += 1;
            cells_processed += cells.len();
            let line = cells
                .into_iter()
                .map(|cell| format!("{}={}", cell.reference, cell.value))
                .collect::<Vec<_>>()
                .join(", ");
            append_limited_line(&mut output, &line, XLSX_MAX_EXTRACTED_CHARS, &mut truncated);
            if output.chars().count() >= XLSX_MAX_EXTRACTED_CHARS {
                break;
            }
        }
        if output.chars().count() >= XLSX_MAX_EXTRACTED_CHARS {
            break;
        }
        output.push('\n');
    }
    if sheets.len() > XLSX_MAX_SHEETS {
        truncated = true;
        warnings.push(format!(
            "Only the first {XLSX_MAX_SHEETS} sheets were extracted."
        ));
    }
    if truncated {
        warnings.push("XLSX text was truncated at parser limits.".to_string());
    }
    let extracted_chars = output.chars().count();
    if output.trim().is_empty() {
        return parser_failed(
            "spreadsheet",
            "xlsx_sheet_text_v1",
            "XLSX text was not found or the file is unsupported.",
        );
    }
    let metadata_json = serde_json::json!({
        "parserKind": "xlsx_sheet_text_v1",
        "sheetCount": sheets.len(),
        "sheetsProcessed": sheets_processed,
        "rowsProcessed": rows_processed,
        "cellsProcessed": cells_processed,
        "extractedChars": extracted_chars,
        "truncated": truncated,
        "limits": {
            "maxSheets": XLSX_MAX_SHEETS,
            "maxRowsPerSheet": XLSX_MAX_ROWS_PER_SHEET,
            "maxCellsPerRow": XLSX_MAX_CELLS_PER_ROW,
            "maxExtractedChars": XLSX_MAX_EXTRACTED_CHARS,
        },
        "warnings": warnings,
    })
    .to_string();
    ParsedAttachment {
        kind: "spreadsheet".to_string(),
        parse_status: "ready".to_string(),
        parser: Some("xlsx_sheet_text_v1".to_string()),
        error: None,
        thumbnail_data_url: None,
        metadata_json: Some(metadata_json),
        content: Some(NewAttachmentParsedContent {
            char_count: extracted_chars as i64,
            content_text: output,
            content_kind: "spreadsheet_text".to_string(),
            parser: "xlsx_sheet_text_v1".to_string(),
        }),
    }
}

#[derive(Debug, Clone, PartialEq)]
struct PdfPageAnalysis {
    page_number: i64,
    extracted_text: String,
    extracted_text_chars: i64,
    word_count: i64,
    text_blocks_count: i64,
    text_coverage_ratio: Option<f64>,
    image_coverage_ratio: Option<f64>,
    scanned_candidate: bool,
    classification: String,
}

impl PdfPageAnalysis {
    fn has_context_text(&self) -> bool {
        self.classification == "text_ready" || self.classification == "mixed"
    }
}

#[derive(Debug, Clone, PartialEq)]
struct PdfAnalysis {
    document_classification: String,
    pages: Vec<PdfPageAnalysis>,
}

impl PdfAnalysis {
    fn ocr_needed_pages(&self) -> Vec<i64> {
        self.pages
            .iter()
            .filter(|page| page.classification == "ocr_needed" || page.classification == "mixed")
            .map(|page| page.page_number)
            .collect()
    }
}

fn analyze_pdf_pages(input: &str) -> PdfAnalysis {
    let pages = split_pdf_pages(input)
        .into_iter()
        .enumerate()
        .map(|(index, page)| analyze_pdf_page(index as i64 + 1, page))
        .collect::<Vec<_>>();
    let total = pages.len().max(1) as f64;
    let text_pages = pages
        .iter()
        .filter(|page| page.classification == "text_ready" || page.classification == "mixed")
        .count() as f64;
    let ocr_pages = pages
        .iter()
        .filter(|page| page.classification == "ocr_needed" || page.classification == "mixed")
        .count() as f64;
    let has_text = text_pages > 0.0;
    let has_ocr = ocr_pages > 0.0;
    let document_classification = if text_pages / total >= 0.8 {
        "text_pdf"
    } else if ocr_pages / total >= 0.8 {
        "scanned_pdf"
    } else if has_text && has_ocr {
        "mixed_pdf"
    } else {
        "empty_or_unsupported"
    }
    .to_string();
    PdfAnalysis {
        document_classification,
        pages,
    }
}

fn split_pdf_pages(input: &str) -> Vec<&str> {
    let markers = ["\n%%Page:", "\n/Page ", "\n/Type /Page"];
    let mut positions = markers
        .iter()
        .flat_map(|marker| input.match_indices(marker).map(|(index, _)| index + 1))
        .collect::<Vec<_>>();
    positions.sort_unstable();
    positions.dedup();
    if positions.is_empty() {
        return vec![input];
    }
    let mut pages = Vec::new();
    for (index, start) in positions.iter().enumerate() {
        let end = positions.get(index + 1).copied().unwrap_or(input.len());
        pages.push(&input[*start..end]);
    }
    pages
}

fn analyze_pdf_page(page_number: i64, page: &str) -> PdfPageAnalysis {
    let text_blocks = extract_pdf_literal_text_blocks(page);
    let extracted_text = text_blocks
        .join(" ")
        .replace("\\r", "\n")
        .replace("\\n", "\n");
    let extracted_text_chars = extracted_text.trim().chars().count() as i64;
    let word_count = word_count(&extracted_text);
    let text_blocks_count = text_blocks.len() as i64;
    let image_coverage_ratio = estimate_pdf_image_coverage_ratio(page);
    let text_coverage_ratio = estimate_pdf_text_coverage_ratio(extracted_text_chars, word_count);
    let large_raster = image_coverage_ratio.unwrap_or(0.0) >= 0.25;
    let scanned_candidate = extracted_text_chars < 50 && large_raster;
    let text_ready = word_count >= 30
        || extracted_text_chars >= 200
        || text_coverage_ratio.unwrap_or(0.0) >= 0.03;
    let classification = if text_ready && scanned_candidate {
        "mixed"
    } else if text_ready {
        "text_ready"
    } else if scanned_candidate {
        "ocr_needed"
    } else if extracted_text_chars < 20 {
        "empty"
    } else {
        "empty"
    }
    .to_string();
    PdfPageAnalysis {
        page_number,
        extracted_text,
        extracted_text_chars,
        word_count,
        text_blocks_count,
        text_coverage_ratio,
        image_coverage_ratio,
        scanned_candidate,
        classification,
    }
}

fn extract_pdf_literal_text_blocks(input: &str) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current = String::new();
    let mut in_literal = false;
    let mut escaped = false;
    for character in input.chars() {
        if in_literal {
            if escaped {
                current.push(match character {
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    other => other,
                });
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == ')' {
                let trimmed = current.trim();
                if meaningful_pdf_text(trimmed) {
                    strings.push(trimmed.to_string());
                }
                current.clear();
                in_literal = false;
            } else {
                current.push(character);
            }
        } else if character == '(' {
            in_literal = true;
            current.clear();
        }
    }
    strings
}

fn estimate_pdf_text_coverage_ratio(extracted_text_chars: i64, word_count: i64) -> Option<f64> {
    if extracted_text_chars <= 0 {
        return Some(0.0);
    }
    Some(((extracted_text_chars as f64 / 6_000.0) + (word_count as f64 / 1_200.0)).min(1.0))
}

fn estimate_pdf_image_coverage_ratio(page: &str) -> Option<f64> {
    let lower = page.to_ascii_lowercase();
    if lower.contains("/subtype /image")
        || lower.contains("/xobject")
        || lower.contains("image-only")
        || lower.contains("scanned")
    {
        return Some(0.85);
    }
    if lower.contains("/image") {
        return Some(0.35);
    }
    Some(0.0)
}

fn word_count(value: &str) -> i64 {
    value
        .split_whitespace()
        .filter(|word| word.chars().any(char::is_alphanumeric))
        .count() as i64
}

fn pdf_analysis_metadata_json(analysis: &PdfAnalysis) -> String {
    serde_json::json!({
        "documentClassification": analysis.document_classification,
        "ocrNeededPages": analysis.ocr_needed_pages(),
        "pages": analysis.pages.iter().map(|page| serde_json::json!({
            "pageNumber": page.page_number,
            "extractedTextChars": page.extracted_text_chars,
            "wordCount": page.word_count,
            "textBlocksCount": page.text_blocks_count,
            "textCoverageRatio": page.text_coverage_ratio,
            "imageCoverageRatio": page.image_coverage_ratio,
            "scannedCandidate": page.scanned_candidate,
            "classification": page.classification,
        })).collect::<Vec<_>>()
    })
    .to_string()
}

fn extract_pdf_literal_strings(input: &str) -> String {
    extract_pdf_literal_text_blocks(input)
        .join(" ")
        .replace("\\r", "\n")
        .replace("\\n", "\n")
}

fn meaningful_pdf_text(value: &str) -> bool {
    let letters = value
        .chars()
        .filter(|character| character.is_alphabetic())
        .count();
    letters >= 2 && !value.starts_with('/') && !value.contains('\0')
}

fn open_office_archive(bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>, String> {
    ZipArchive::new(Cursor::new(bytes)).map_err(|error| error.to_string())
}

fn office_archive_is_encrypted(archive: &mut ZipArchive<Cursor<&[u8]>>) -> bool {
    (0..archive.len()).any(|index| {
        archive
            .by_index(index)
            .map(|file| {
                matches!(file.name(), "EncryptionInfo" | "EncryptedPackage")
                    || file.name().ends_with("/EncryptionInfo")
                    || file.name().ends_with("/EncryptedPackage")
            })
            .unwrap_or(false)
    })
}

fn read_zip_text(archive: &mut ZipArchive<Cursor<&[u8]>>, path: &str) -> Result<String, String> {
    let mut file = archive.by_name(path).map_err(|error| error.to_string())?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    Ok(text)
}

fn extract_docx_paragraphs(document_xml: &str) -> Vec<String> {
    extract_xml_blocks(document_xml, "w:p")
        .into_iter()
        .filter_map(|paragraph| {
            let text = extract_tag_texts(paragraph, "w:t")
                .into_iter()
                .map(|value| xml_unescape(&value))
                .collect::<Vec<_>>()
                .join("");
            let text = text.trim();
            if text.is_empty() {
                return None;
            }
            let styled = if paragraph.contains("Heading1") || paragraph.contains("heading 1") {
                format!("# {text}")
            } else if paragraph.contains("Heading2") || paragraph.contains("heading 2") {
                format!("## {text}")
            } else if paragraph.contains("Heading3") || paragraph.contains("heading 3") {
                format!("### {text}")
            } else {
                text.to_string()
            };
            Some(styled)
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct XlsxSheet {
    name: String,
    sheet_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct XlsxRow {
    cells: Vec<XlsxCell>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct XlsxCell {
    reference: String,
    value: String,
}

fn extract_xlsx_sheets(workbook_xml: &str) -> Vec<XlsxSheet> {
    find_xml_start_tags(workbook_xml, "sheet")
        .into_iter()
        .filter_map(|tag| {
            let name = xml_attr(tag, "name")?;
            let sheet_id = xml_attr(tag, "sheetId")?;
            Some(XlsxSheet {
                name: xml_unescape(&name),
                sheet_id,
            })
        })
        .collect()
}

fn extract_xlsx_shared_strings(shared_strings_xml: &str) -> Vec<String> {
    extract_xml_blocks(shared_strings_xml, "si")
        .into_iter()
        .map(|block| {
            extract_tag_texts(block, "t")
                .into_iter()
                .map(|value| xml_unescape(&value))
                .collect::<Vec<_>>()
                .join("")
        })
        .collect()
}

fn extract_xlsx_rows(sheet_xml: &str, shared_strings: &[String]) -> Vec<XlsxRow> {
    extract_xml_blocks(sheet_xml, "row")
        .into_iter()
        .map(|row| {
            let cells = extract_xml_blocks(row, "c")
                .into_iter()
                .filter_map(|cell| {
                    let start_tag = xml_start_tag(cell)?;
                    let reference = xml_attr(start_tag, "r").unwrap_or_default();
                    let cell_type = xml_attr(start_tag, "t").unwrap_or_default();
                    let value = if cell_type == "inlineStr" {
                        extract_tag_texts(cell, "t")
                            .into_iter()
                            .map(|value| xml_unescape(&value))
                            .collect::<Vec<_>>()
                            .join("")
                    } else {
                        extract_tag_texts(cell, "v")
                            .into_iter()
                            .next()
                            .map(|value| {
                                let value = xml_unescape(&value);
                                if cell_type == "s" {
                                    value
                                        .parse::<usize>()
                                        .ok()
                                        .and_then(|index| shared_strings.get(index).cloned())
                                        .unwrap_or(value)
                                } else {
                                    value
                                }
                            })
                            .unwrap_or_default()
                    };
                    let value = value.trim();
                    if value.is_empty() {
                        return None;
                    }
                    Some(XlsxCell {
                        reference,
                        value: value.to_string(),
                    })
                })
                .collect::<Vec<_>>();
            XlsxRow { cells }
        })
        .filter(|row| !row.cells.is_empty())
        .collect()
}

fn extract_xml_blocks<'a>(input: &'a str, tag: &str) -> Vec<&'a str> {
    let start_pattern = format!("<{tag}");
    let end_pattern = format!("</{tag}>");
    let mut blocks = Vec::new();
    let mut search_start = 0usize;
    while let Some(start_offset) = input[search_start..].find(&start_pattern) {
        let start = search_start + start_offset;
        let Some(open_end_offset) = input[start..].find('>') else {
            break;
        };
        let open_end = start + open_end_offset + 1;
        if input[start..open_end].ends_with("/>") {
            blocks.push(&input[start..open_end]);
            search_start = open_end;
            continue;
        }
        let Some(end_offset) = input[open_end..].find(&end_pattern) else {
            break;
        };
        let end = open_end + end_offset + end_pattern.len();
        blocks.push(&input[start..end]);
        search_start = end;
    }
    blocks
}

fn find_xml_start_tags<'a>(input: &'a str, tag: &str) -> Vec<&'a str> {
    let pattern = format!("<{tag}");
    let mut tags = Vec::new();
    let mut search_start = 0usize;
    while let Some(start_offset) = input[search_start..].find(&pattern) {
        let start = search_start + start_offset;
        let Some(end_offset) = input[start..].find('>') else {
            break;
        };
        let end = start + end_offset + 1;
        tags.push(&input[start..end]);
        search_start = end;
    }
    tags
}

fn extract_tag_texts(input: &str, tag: &str) -> Vec<String> {
    extract_xml_blocks(input, tag)
        .into_iter()
        .filter_map(|block| {
            let start = block.find('>')? + 1;
            let end = block.rfind("</")?;
            Some(block[start..end].to_string())
        })
        .collect()
}

fn xml_start_tag(input: &str) -> Option<&str> {
    let end = input.find('>')? + 1;
    Some(&input[..end])
}

fn xml_attr(tag: &str, attr: &str) -> Option<String> {
    let quoted = format!("{attr}=\"");
    let start = tag.find(&quoted)? + quoted.len();
    let end = tag[start..].find('"')? + start;
    Some(tag[start..end].to_string())
}

fn xml_unescape(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn append_limited_line(output: &mut String, line: &str, limit: usize, truncated: &mut bool) {
    if *truncated {
        return;
    }
    let separator = if output.is_empty() { 0 } else { 1 };
    let remaining = limit.saturating_sub(output.chars().count());
    if remaining <= separator {
        *truncated = true;
        return;
    }
    if separator == 1 {
        output.push('\n');
    }
    let available = remaining - separator;
    let line_chars = line.chars().count();
    if line_chars <= available {
        output.push_str(line);
    } else {
        output.extend(line.chars().take(available));
        *truncated = true;
    }
}

fn parser_failed(kind: &str, parser: &str, message: &str) -> ParsedAttachment {
    ParsedAttachment {
        kind: kind.to_string(),
        parse_status: "failed".to_string(),
        parser: Some(parser.to_string()),
        error: Some(message.to_string()),
        thumbnail_data_url: None,
        metadata_json: None,
        content: None,
    }
}

fn pending_or_failed(kind: &str, status: &str, message: &str) -> ParsedAttachment {
    ParsedAttachment {
        kind: kind.to_string(),
        parse_status: status.to_string(),
        parser: None,
        error: Some(message.to_string()),
        thumbnail_data_url: None,
        metadata_json: None,
        content: None,
    }
}

fn is_text_like(mime_type: &str, extension: &str) -> bool {
    mime_type.starts_with("text/")
        || matches!(
            mime_type,
            "application/json" | "application/xml" | "text/csv" | "application/csv"
        )
        || matches!(extension, "txt" | "md" | "csv" | "xml" | "json")
}

struct StoredParsedContent {
    content_text: String,
    compressed_text: Option<Vec<u8>>,
    compression_kind: String,
    original_byte_count: i64,
    stored_byte_count: i64,
}

fn prepare_content_storage(content_text: &str) -> StoredParsedContent {
    let plain = content_text.as_bytes();
    if plain.len() >= COMPRESS_AT_REST_THRESHOLD_BYTES {
        let compressed = rle_compress(plain);
        if compressed.len() + 16 < plain.len() {
            return StoredParsedContent {
                content_text: String::new(),
                stored_byte_count: compressed.len() as i64,
                compressed_text: Some(compressed),
                compression_kind: "rle_v1".to_string(),
                original_byte_count: plain.len() as i64,
            };
        }
    }
    StoredParsedContent {
        content_text: content_text.to_string(),
        compressed_text: None,
        compression_kind: "none".to_string(),
        original_byte_count: plain.len() as i64,
        stored_byte_count: plain.len() as i64,
    }
}

fn restore_content_text(
    content_text: String,
    compression_kind: &str,
    compressed_text: Option<Vec<u8>>,
) -> String {
    if compression_kind == "rle_v1" {
        if let Some(compressed) = compressed_text {
            if let Ok(bytes) = rle_decompress(&compressed) {
                return String::from_utf8_lossy(&bytes).to_string();
            }
        }
    }
    content_text
}

fn rle_compress(bytes: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        let mut run = 1usize;
        while index + run < bytes.len() && bytes[index + run] == byte && run < u8::MAX as usize {
            run += 1;
        }
        output.push(run as u8);
        output.push(byte);
        index += run;
    }
    output
}

fn rle_decompress(bytes: &[u8]) -> Result<Vec<u8>, ()> {
    if bytes.len() % 2 != 0 {
        return Err(());
    }
    let mut output = Vec::new();
    for pair in bytes.chunks_exact(2) {
        output.extend(std::iter::repeat(pair[1]).take(pair[0] as usize));
    }
    Ok(output)
}

struct ParsedChunkDraft {
    chunk_index: i64,
    content_text: String,
    char_start: i64,
    char_end: i64,
    char_count: i64,
    token_estimate: i64,
}

fn chunk_text(content_text: &str) -> Vec<ParsedChunkDraft> {
    let chars = content_text.chars().collect::<Vec<_>>();
    if chars.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let mut end = (start + ATTACHMENT_CHUNK_CHAR_LIMIT).min(chars.len());
        if end < chars.len() {
            let window_start = start + ATTACHMENT_CHUNK_CHAR_LIMIT.saturating_sub(400);
            if let Some(split) = (window_start..end)
                .rev()
                .find(|index| chars[*index] == '\n' || chars[*index] == '.' || chars[*index] == ' ')
            {
                if split > start + 200 {
                    end = split + 1;
                }
            }
        }
        let content = chars[start..end].iter().collect::<String>();
        let char_count = content.chars().count() as i64;
        chunks.push(ParsedChunkDraft {
            chunk_index: chunks.len() as i64,
            content_text: content,
            char_start: start as i64,
            char_end: end as i64,
            char_count,
            token_estimate: (char_count / 4).max(1),
        });
        start = end;
    }
    chunks
}

fn summarize_text(content_text: &str) -> String {
    content_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("\n")
}

fn query_terms(query: &str) -> Vec<String> {
    query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 3)
        .map(str::to_ascii_lowercase)
        .collect()
}

fn chunk_score(content_text: &str, terms: &[String]) -> i64 {
    let content = content_text.to_ascii_lowercase();
    terms
        .iter()
        .map(|term| content.matches(term).count() as i64)
        .sum()
}

#[derive(Debug, Clone)]
struct AttachmentRankingContext {
    normalized_query: String,
    query_terms: Vec<String>,
    normalized_file_name: String,
    normalized_extension: Option<String>,
}

impl AttachmentRankingContext {
    fn new(query: &str, query_terms: &[String], file_name: &str, extension: Option<&str>) -> Self {
        Self {
            normalized_query: query.trim().to_ascii_lowercase(),
            query_terms: query_terms.to_vec(),
            normalized_file_name: file_name.to_ascii_lowercase(),
            normalized_extension: extension.map(str::to_ascii_lowercase),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AttachmentChunkRanking {
    score: i64,
    reasons: Vec<String>,
}

fn rank_attachment_chunk(
    chunk: &AttachmentParsedChunkRecord,
    context: &AttachmentRankingContext,
) -> AttachmentChunkRanking {
    let mut score = chunk_score(&chunk.content_text, &context.query_terms) * 10;
    let mut reasons = Vec::new();
    if score > 0 {
        reasons.push("term_frequency".to_string());
    }
    let content = chunk.content_text.to_ascii_lowercase();
    if context.normalized_query.chars().count() >= 8 && content.contains(&context.normalized_query)
    {
        score += 40;
        reasons.push("exact_phrase_match".to_string());
    }
    let file_matches = context.query_terms.iter().filter(|term| {
        context.normalized_file_name.contains(term.as_str())
            || context
                .normalized_extension
                .as_deref()
                .is_some_and(|extension| extension == term.as_str())
    });
    let file_match_count = file_matches.count() as i64;
    if file_match_count > 0 {
        score += file_match_count * 15;
        reasons.push("filename_or_type_match".to_string());
    }
    if let Some(page_number) = chunk.page_number {
        let page_patterns = [
            format!("page {page_number}"),
            format!("p{page_number}"),
            format!("sayfa {page_number}"),
        ];
        if page_patterns
            .iter()
            .any(|pattern| context.normalized_query.contains(pattern))
        {
            score += 20;
            reasons.push("page_match".to_string());
        }
    }
    if let Some(sheet_name) = chunk.sheet_name.as_deref() {
        let normalized_sheet = sheet_name.to_ascii_lowercase();
        if context.query_terms.iter().any(|term| {
            normalized_sheet.contains(term.as_str()) || term.contains(&normalized_sheet)
        }) {
            score += 20;
            reasons.push("sheet_match".to_string());
        }
    }
    AttachmentChunkRanking { score, reasons }
}

fn merge_metadata_json(existing: &str, ranking: serde_json::Value) -> String {
    match serde_json::from_str::<serde_json::Value>(existing) {
        Ok(mut value) => {
            if let Some(object) = value.as_object_mut() {
                if let Some(ranking_object) = ranking.as_object() {
                    for (key, value) in ranking_object {
                        object.insert(key.clone(), value.clone());
                    }
                }
                value.to_string()
            } else {
                ranking.to_string()
            }
        }
        Err(_) => ranking.to_string(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parser_cache_key(parser: &str) -> (String, String) {
    if let Some((kind, version)) = parser.rsplit_once("_v") {
        return (kind.to_string(), format!("v{version}"));
    }
    (parser.to_string(), "v1".to_string())
}

fn parse_artifact_id(sha256: &str, parser_kind: &str, parser_version: &str) -> String {
    format!("artifact-{sha256}-{parser_kind}-{parser_version}")
}

fn file_extension(file_name: &str) -> Option<String> {
    file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.trim().to_ascii_lowercase())
        .filter(|extension| !extension.is_empty())
}

fn attachment_from_row(row: sqlx::sqlite::SqliteRow) -> AttachmentRecord {
    let parsed_content = row
        .try_get::<Option<String>, _>("content_text")
        .ok()
        .flatten()
        .map(|content_text| {
            let compression_kind = row
                .try_get::<String, _>("compression_kind")
                .unwrap_or_else(|_| "none".to_string());
            let compressed_text = row.try_get::<Vec<u8>, _>("compressed_text").ok();
            AttachmentParsedContentRecord {
                attachment_id: row.get("attachment_id"),
                content_text: restore_content_text(
                    content_text,
                    &compression_kind,
                    compressed_text,
                ),
                content_kind: row.get("content_kind"),
                char_count: row.get("char_count"),
                parser: row.get("parsed_parser"),
                compression_kind,
                original_byte_count: row.try_get("original_byte_count").unwrap_or(0),
                stored_byte_count: row.try_get("stored_byte_count").unwrap_or(0),
                created_at: row.get("parsed_created_at"),
            }
        });
    AttachmentRecord {
        attachment_id: row.get("attachment_id"),
        loom_id: row.get("loom_id"),
        blob_id: row.try_get("blob_id").ok(),
        sha256: row.try_get("sha256").ok(),
        parse_artifact_id: row.try_get("parse_artifact_id").ok(),
        file_name: row.get("file_name"),
        mime_type: row.get("mime_type"),
        extension: row.get("extension"),
        size_bytes: row.get("size_bytes"),
        kind: row.get("kind"),
        parse_status: row.get("parse_status"),
        parser: row.get("parser"),
        error: row.get("error"),
        thumbnail_data_url: row.get("thumbnail_data_url"),
        metadata_json: row.get("metadata_json"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        parsed_content,
    }
}

fn parse_artifact_from_row(row: sqlx::sqlite::SqliteRow) -> ParseArtifactRecord {
    let parser_kind: String = row.get("parser_kind");
    let parser_version: String = row.get("parser_version");
    ParseArtifactRecord {
        parse_artifact_id: row.get("parse_artifact_id"),
        kind: row.get("kind"),
        parser: format!("{parser_kind}_{parser_version}"),
        metadata_json: row.get("metadata_json"),
    }
}

fn chunk_from_row(row: sqlx::sqlite::SqliteRow) -> AttachmentParsedChunkRecord {
    AttachmentParsedChunkRecord {
        chunk_id: row.get("chunk_id"),
        attachment_id: row.try_get("attachment_id").unwrap_or_default(),
        parse_artifact_id: row.try_get("parse_artifact_id").ok(),
        chunk_index: row.get("chunk_index"),
        content_text: row.get("content_text"),
        char_start: row.get("char_start"),
        char_end: row.get("char_end"),
        char_count: row.get("char_count"),
        token_estimate: row.get("token_estimate"),
        page_number: row.get("page_number"),
        sheet_name: row.get("sheet_name"),
        metadata_json: row.get("metadata_json"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{capabilities::repository::timestamp, storage::db::test_database};
    use std::{io::Write, os::unix::fs::PermissionsExt};
    use zip::{write::FileOptions, ZipWriter};

    #[tokio::test]
    async fn text_attachment_stores_blob_and_parsed_content_separately() {
        let database = test_database().await;
        sqlx::query(
            "INSERT INTO looms (loom_id, title, created_at, updated_at)
             VALUES ('loom-a', 'Loom A', '1', '1')",
        )
        .execute(database.pool())
        .await
        .expect("loom insert");
        let repo = AttachmentRepository::new(&database);
        let record = repo
            .insert_attachment(&NewAttachment {
                attachment_id: "att-1".to_string(),
                loom_id: "loom-a".to_string(),
                file_name: "notes.md".to_string(),
                mime_type: Some("text/markdown".to_string()),
                bytes: b"# Notes\nLoom scoped context.".to_vec(),
                created_at: timestamp(),
            })
            .await
            .expect("attachment insert");

        assert_eq!(record.parse_status, "queued");
        let record = repo
            .parse_attachment_now(&record.attachment_id, &timestamp())
            .await
            .expect("parse attachment")
            .expect("parsed record");
        assert_eq!(record.parse_status, "ready");
        assert_eq!(record.kind, "markdown");
        assert!(record.parsed_content.is_some());
        let blob_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM attachment_blob_objects WHERE sha256 = ?1",
        )
        .bind(record.sha256.as_deref().expect("sha256"))
        .fetch_one(database.pool())
        .await
        .expect("blob count");
        assert_eq!(blob_count, 1);
        let chunk_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM attachment_parse_artifact_chunks WHERE parse_artifact_id = ?1",
        )
        .bind(record.parse_artifact_id.as_deref().expect("artifact id"))
        .fetch_one(database.pool())
        .await
        .expect("chunk count");
        assert_eq!(chunk_count, 1);
    }

    #[tokio::test]
    async fn same_file_same_loom_reuses_blob_and_parse_artifact() {
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        let repo = AttachmentRepository::new(&database);
        for attachment_id in ["att-1", "att-2"] {
            repo.insert_attachment(&NewAttachment {
                attachment_id: attachment_id.to_string(),
                loom_id: "loom-a".to_string(),
                file_name: format!("{attachment_id}.txt"),
                mime_type: Some("text/plain".to_string()),
                bytes: b"same reusable attachment body".to_vec(),
                created_at: timestamp(),
            })
            .await
            .expect("attachment insert");
            repo.parse_attachment_now(attachment_id, &timestamp())
                .await
                .expect("parse attachment");
        }

        let attachment_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM attachments WHERE loom_id = 'loom-a'",
        )
        .fetch_one(database.pool())
        .await
        .expect("attachment count");
        assert_eq!(attachment_count, 2);
        assert_eq!(table_count(&database, "attachment_blob_objects").await, 1);
        assert_eq!(
            table_count(&database, "attachment_parse_artifacts").await,
            1
        );
        let rows = sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT parse_artifact_id FROM attachments WHERE loom_id = 'loom-a'",
        )
        .fetch_all(database.pool())
        .await
        .expect("artifact ids");
        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn same_file_across_looms_reuses_blob_and_parse_artifact_without_scope_leak() {
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        insert_test_loom(&database, "loom-b").await;
        let repo = AttachmentRepository::new(&database);
        for (attachment_id, loom_id) in [("att-a", "loom-a"), ("att-b", "loom-b")] {
            repo.insert_attachment(&NewAttachment {
                attachment_id: attachment_id.to_string(),
                loom_id: loom_id.to_string(),
                file_name: "shared.md".to_string(),
                mime_type: Some("text/markdown".to_string()),
                bytes: b"# Shared\nBlue Otter is scoped by Loom attachment rows.".to_vec(),
                created_at: timestamp(),
            })
            .await
            .expect("attachment insert");
            repo.parse_attachment_now(attachment_id, &timestamp())
                .await
                .expect("parse attachment");
        }

        assert_eq!(table_count(&database, "attachment_blob_objects").await, 1);
        assert_eq!(
            table_count(&database, "attachment_parse_artifacts").await,
            1
        );
        assert!(repo
            .get_referenced_attachment_content("loom-a", "att-b", "Blue Otter")
            .await
            .expect("cross loom lookup")
            .is_none());
    }

    #[tokio::test]
    async fn referenced_reused_parse_artifact_enters_context() {
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        let repo = AttachmentRepository::new(&database);
        let body = b"Reusable context contains Event Store and Replay details.".to_vec();
        for attachment_id in ["att-1", "att-2"] {
            repo.insert_attachment(&NewAttachment {
                attachment_id: attachment_id.to_string(),
                loom_id: "loom-a".to_string(),
                file_name: format!("{attachment_id}.txt"),
                mime_type: Some("text/plain".to_string()),
                bytes: body.clone(),
                created_at: timestamp(),
            })
            .await
            .expect("attachment insert");
            repo.parse_attachment_now(attachment_id, &timestamp())
                .await
                .expect("parse attachment");
        }

        let record = repo
            .get_referenced_attachment_content("loom-a", "att-2", "Replay")
            .await
            .expect("context lookup")
            .expect("attachment context");
        assert!(record
            .parsed_content
            .expect("parsed content")
            .content_text
            .contains("Replay"));
    }

    #[test]
    fn attachment_chunk_ranking_uses_exact_phrase_page_and_sheet_metadata() {
        let context = AttachmentRankingContext::new(
            "budget forecast page 2",
            &query_terms("budget forecast page 2"),
            "annual-budget.xlsx",
            Some("xlsx"),
        );
        let generic = AttachmentParsedChunkRecord {
            chunk_id: "chunk-1".to_string(),
            attachment_id: "att-1".to_string(),
            parse_artifact_id: Some("artifact-1".to_string()),
            chunk_index: 0,
            content_text: "Budget notes mention costs and forecast separately.".to_string(),
            char_start: 0,
            char_end: 52,
            char_count: 52,
            token_estimate: 13,
            page_number: Some(1),
            sheet_name: Some("Notes".to_string()),
            metadata_json: None,
        };
        let targeted = AttachmentParsedChunkRecord {
            chunk_id: "chunk-2".to_string(),
            attachment_id: "att-1".to_string(),
            parse_artifact_id: Some("artifact-1".to_string()),
            chunk_index: 1,
            content_text: "The budget forecast page 2 is approved for the launch plan.".to_string(),
            char_start: 53,
            char_end: 108,
            char_count: 55,
            token_estimate: 14,
            page_number: Some(2),
            sheet_name: Some("Budget Forecast".to_string()),
            metadata_json: None,
        };

        let generic_rank = rank_attachment_chunk(&generic, &context);
        let targeted_rank = rank_attachment_chunk(&targeted, &context);

        assert!(targeted_rank.score > generic_rank.score);
        assert!(targeted_rank
            .reasons
            .contains(&"exact_phrase_match".to_string()));
        assert!(targeted_rank.reasons.contains(&"page_match".to_string()));
        assert!(targeted_rank.reasons.contains(&"sheet_match".to_string()));
        assert!(targeted_rank
            .reasons
            .contains(&"filename_or_type_match".to_string()));
    }

    #[tokio::test]
    async fn parser_version_bump_does_not_reuse_old_artifact() {
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        let repo = AttachmentRepository::new(&database);
        let bytes = b"versioned parser cache".to_vec();
        let record = repo
            .insert_attachment(&NewAttachment {
                attachment_id: "att-version".to_string(),
                loom_id: "loom-a".to_string(),
                file_name: "version.txt".to_string(),
                mime_type: Some("text/plain".to_string()),
                bytes: bytes.clone(),
                created_at: timestamp(),
            })
            .await
            .expect("attachment insert");
        let sha256 = record.sha256.expect("sha");
        sqlx::query(
            "INSERT INTO attachment_parse_artifacts (
                parse_artifact_id, sha256, parser_kind, parser_version, kind, content_kind,
                content_text, compression_kind, char_count, original_byte_count, stored_byte_count,
                created_at
             ) VALUES ('old-artifact', ?1, 'utf8_text', 'v0', 'text', 'text', 'old cache',
                       'none', 9, 9, 9, '1')",
        )
        .bind(&sha256)
        .execute(database.pool())
        .await
        .expect("insert old artifact");

        repo.parse_attachment_now("att-version", &timestamp())
            .await
            .expect("parse attachment");

        let artifact_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM attachment_parse_artifacts WHERE sha256 = ?1",
        )
        .bind(&sha256)
        .fetch_one(database.pool())
        .await
        .expect("artifact count");
        assert_eq!(artifact_count, 2);
    }

    #[tokio::test]
    async fn failed_and_unsupported_parses_are_not_cached_as_artifacts() {
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        let repo = AttachmentRepository::new(&database);
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-failed".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "bad.txt".to_string(),
            mime_type: Some("text/plain".to_string()),
            bytes: vec![0xff, 0xfe, 0xfd],
            created_at: timestamp(),
        })
        .await
        .expect("failed attachment insert");
        let failed = repo
            .parse_attachment_now("att-failed", &timestamp())
            .await
            .expect("parse failed")
            .expect("failed record");
        assert_eq!(failed.parse_status, "failed");

        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-unsupported".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "image.png".to_string(),
            mime_type: Some("image/png".to_string()),
            bytes: vec![137, 80, 78, 71],
            created_at: timestamp(),
        })
        .await
        .expect("unsupported attachment insert");
        let unsupported = repo
            .parse_attachment_now("att-unsupported", &timestamp())
            .await
            .expect("parse unsupported")
            .expect("unsupported record");
        assert_eq!(unsupported.parse_status, "unsupported");
        assert_eq!(
            table_count(&database, "attachment_parse_artifacts").await,
            0
        );
    }

    #[tokio::test]
    async fn deleting_one_attachment_keeps_shared_blob_for_other_references() {
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        let repo = AttachmentRepository::new(&database);
        for attachment_id in ["att-1", "att-2"] {
            repo.insert_attachment(&NewAttachment {
                attachment_id: attachment_id.to_string(),
                loom_id: "loom-a".to_string(),
                file_name: format!("{attachment_id}.txt"),
                mime_type: Some("text/plain".to_string()),
                bytes: b"shared blob still exists".to_vec(),
                created_at: timestamp(),
            })
            .await
            .expect("attachment insert");
        }
        assert!(repo.delete_attachment("att-1").await.expect("delete"));
        assert_eq!(table_count(&database, "attachment_blob_objects").await, 1);
        assert!(repo.get_attachment("att-2").await.expect("get").is_some());
    }

    #[tokio::test]
    async fn attachment_context_is_loom_scoped() {
        let database = test_database().await;
        for loom_id in ["loom-a", "loom-b"] {
            sqlx::query(
                "INSERT INTO looms (loom_id, title, created_at, updated_at)
                 VALUES (?1, ?1, '1', '1')",
            )
            .bind(loom_id)
            .execute(database.pool())
            .await
            .expect("loom insert");
        }
        let repo = AttachmentRepository::new(&database);
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-1".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "notes.txt".to_string(),
            mime_type: Some("text/plain".to_string()),
            bytes: b"private loom a notes".to_vec(),
            created_at: timestamp(),
        })
        .await
        .expect("attachment insert");
        repo.parse_attachment_now("att-1", &timestamp())
            .await
            .expect("parse attachment");

        assert!(repo
            .get_referenced_attachment_content("loom-a", "att-1", "private")
            .await
            .expect("same loom")
            .is_some());
        assert!(repo
            .get_referenced_attachment_content("loom-b", "att-1", "private")
            .await
            .expect("other loom")
            .is_none());
    }

    #[tokio::test]
    async fn parsed_content_can_be_compressed_and_restored() {
        let database = test_database().await;
        sqlx::query(
            "INSERT INTO looms (loom_id, title, created_at, updated_at)
             VALUES ('loom-a', 'Loom A', '1', '1')",
        )
        .execute(database.pool())
        .await
        .expect("loom insert");
        let repo = AttachmentRepository::new(&database);
        let text = "A".repeat(8_192);
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-compress".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "large.txt".to_string(),
            mime_type: Some("text/plain".to_string()),
            bytes: text.as_bytes().to_vec(),
            created_at: timestamp(),
        })
        .await
        .expect("attachment insert");
        let record = repo
            .parse_attachment_now("att-compress", &timestamp())
            .await
            .expect("parse attachment")
            .expect("record");

        let parsed = record.parsed_content.expect("parsed content");
        assert_eq!(parsed.content_text, text);
        assert_eq!(parsed.compression_kind, "rle_v1");
        assert!(parsed.stored_byte_count < parsed.original_byte_count);
    }

    #[tokio::test]
    async fn referenced_mixed_pdf_context_includes_only_extracted_text_pages() {
        let database = test_database().await;
        sqlx::query(
            "INSERT INTO looms (loom_id, title, created_at, updated_at)
             VALUES ('loom-a', 'Loom A', '1', '1')",
        )
        .execute(database.pool())
        .await
        .expect("loom insert");
        let repo = AttachmentRepository::new(&database);
        let text = "The first PDF page contains meaningful selectable text about Event Sourcing, projections, replay, commands, queries, consistency, audits, and operational tradeoffs for Loom context retrieval.";
        let pdf = format!(
            "%PDF-1.4\n%%Page: 1 1\nBT ({text}) Tj ET\n%%Page: 2 2\n/Subtype /Image\n/image-only\n%%EOF"
        );
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-mixed-pdf".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "mixed.pdf".to_string(),
            mime_type: Some("application/pdf".to_string()),
            bytes: pdf.into_bytes(),
            created_at: timestamp(),
        })
        .await
        .expect("attachment insert");
        repo.parse_attachment_now("att-mixed-pdf", &timestamp())
            .await
            .expect("parse attachment");

        let record = repo
            .get_referenced_attachment_content("loom-a", "att-mixed-pdf", "Event Sourcing")
            .await
            .expect("context lookup")
            .expect("attachment context");
        assert_eq!(record.kind, "mixed_pdf");
        assert_eq!(record.parse_status, "ready");
        let content = record.parsed_content.expect("parsed content").content_text;
        assert!(content.contains("Event Sourcing"));
        assert!(!content.contains("image-only"));
        assert!(record
            .metadata_json
            .as_deref()
            .unwrap_or_default()
            .contains("\"ocrNeededPages\":[2]"));
    }

    #[test]
    fn selectable_pdf_text_is_extracted_without_ocr() {
        let text = "Selectable PDF attachment text explains Event Sourcing with enough words for density classification and native text extraction before OCR fallback is considered by the attachment parser.";
        let pdf = format!(
            "%PDF-1.4\n%%Page: 1 1\n1 0 obj <<>> stream\nBT ({text}) Tj ET\nendstream\nendobj\n%%EOF"
        );
        let parsed = parse_attachment(
            "selectable.pdf",
            Some("application/pdf"),
            &Some("pdf".to_string()),
            pdf.as_bytes(),
        );
        assert_eq!(parsed.parse_status, "ready");
        assert_eq!(parsed.kind, "text_pdf");
        assert!(parsed
            .content
            .expect("pdf content")
            .content_text
            .contains("Event Sourcing"));
        let metadata = parsed.metadata_json.expect("metadata");
        assert!(metadata.contains("\"documentClassification\":\"text_pdf\""));
        assert!(metadata.contains("\"classification\":\"text_ready\""));
    }

    #[test]
    fn empty_pdf_reports_ocr_needed_without_running_cloud_ocr() {
        let parsed = parse_attachment(
            "scan.pdf",
            Some("application/pdf"),
            &Some("pdf".to_string()),
            b"%PDF-1.4\n%%Page: 1 1\n/Subtype /Image\n/image-only\n%%EOF",
        );
        assert_eq!(parsed.parse_status, "ocr_needed");
        assert_eq!(parsed.kind, "scanned_pdf");
        assert!(parsed.content.is_none());
        let metadata = parsed.metadata_json.expect("metadata");
        assert!(metadata.contains("\"documentClassification\":\"scanned_pdf\""));
        assert!(metadata.contains("\"ocrNeededPages\":[1]"));
    }

    #[test]
    fn ocr_provider_health_reports_unavailable_when_tesseract_missing() {
        let config = OcrSection {
            enabled: true,
            command_path: Some("/definitely/missing/tesseract".to_string()),
            pdf_rasterizer_command_path: Some("/definitely/missing/pdftoppm".to_string()),
            ..OcrSection::default()
        };

        let status = ocr_provider_status(&config);

        assert_eq!(status.status, "unavailable");
        assert!(status.warnings.contains(&"tesseract_not_found".to_string()));
        assert!(status
            .warnings
            .contains(&"pdf_rasterizer_not_found".to_string()));
    }

    #[tokio::test]
    async fn scanned_pdf_with_ocr_disabled_remains_ocr_needed() {
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        let repo = AttachmentRepository::new(&database);
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-scan-disabled".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "scan.pdf".to_string(),
            mime_type: Some("application/pdf".to_string()),
            bytes: b"%PDF-1.4\n%%Page: 1 1\n/Subtype /Image\n/image-only\n%%Disabled OCR fixture\n%%EOF".to_vec(),
            created_at: timestamp(),
        })
        .await
        .expect("attachment insert");

        let record = repo
            .parse_attachment_now_with_ocr(
                "att-scan-disabled",
                &timestamp(),
                &OcrSection::default(),
            )
            .await
            .expect("parse attachment")
            .expect("record");

        assert_eq!(record.parse_status, "ocr_needed");
        assert_eq!(record.kind, "scanned_pdf");
        assert!(record.parsed_content.is_none());
    }

    #[tokio::test]
    async fn fake_tesseract_ocr_makes_scanned_pdf_ready_and_cleans_temp_files() {
        let harness = FakeOcrHarness::new("scanned-ready");
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        let repo = AttachmentRepository::new(&database);
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-scan".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "scan.pdf".to_string(),
            mime_type: Some("application/pdf".to_string()),
            bytes: b"%PDF-1.4\n%%Page: 1 1\n/Subtype /Image\n/image-only\n%%EOF".to_vec(),
            created_at: timestamp(),
        })
        .await
        .expect("attachment insert");

        let record = repo
            .parse_attachment_now_with_ocr("att-scan", &timestamp(), &harness.config())
            .await
            .expect("parse attachment")
            .expect("record");

        assert_eq!(record.parse_status, "ready");
        assert_eq!(record.parser.as_deref(), Some("pdf_ocr_tesseract_v1"));
        let parsed = record.parsed_content.expect("parsed content");
        assert!(parsed.content_text.contains("[OCR page 1]"));
        assert!(parsed
            .content_text
            .contains("Blue Otter OCR text from page 1"));
        let metadata = record.metadata_json.expect("metadata");
        assert!(metadata.contains("\"parserKind\":\"pdf_ocr_tesseract_v1\""));
        assert!(metadata.contains("\"tempFilesRemoved\":true"));
        assert!(metadata.contains("\"pagesSucceeded\":[1]"));
    }

    #[tokio::test]
    async fn mixed_pdf_ocr_processes_only_ocr_needed_pages() {
        let harness = FakeOcrHarness::new("mixed-pages");
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        let repo = AttachmentRepository::new(&database);
        let text = "The first PDF page contains meaningful selectable text about Event Sourcing, projections, replay, commands, queries, consistency, audits, and operational tradeoffs for Loom context retrieval.";
        let pdf = format!(
            "%PDF-1.4\n%%Page: 1 1\nBT ({text}) Tj ET\n%%Page: 2 2\n/Subtype /Image\n/image-only\n%%Page: 3 3\n/Subtype /Image\n/image-only\n%%EOF"
        );
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-mixed-ocr".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "mixed.pdf".to_string(),
            mime_type: Some("application/pdf".to_string()),
            bytes: pdf.into_bytes(),
            created_at: timestamp(),
        })
        .await
        .expect("attachment insert");

        let record = repo
            .parse_attachment_now_with_ocr("att-mixed-ocr", &timestamp(), &harness.config())
            .await
            .expect("parse attachment")
            .expect("record");

        assert_eq!(record.parse_status, "ready");
        let content = record.parsed_content.expect("parsed content").content_text;
        assert!(content.contains("Event Sourcing"));
        assert!(content.contains("[OCR page 2]"));
        assert!(content.contains("[OCR page 3]"));
        let log = std::fs::read_to_string(&harness.log_path).expect("read fake renderer log");
        assert!(!log.lines().any(|line| line == "1"));
        assert!(log.lines().any(|line| line == "2"));
        assert!(log.lines().any(|line| line == "3"));
    }

    #[tokio::test]
    async fn selectable_pdf_does_not_run_ocr_when_configured() {
        let harness = FakeOcrHarness::new("selectable-no-ocr");
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        let repo = AttachmentRepository::new(&database);
        let text = "Selectable PDF attachment text explains Event Sourcing with enough words for density classification and native text extraction before OCR fallback is considered by the attachment parser.";
        let pdf = format!("%PDF-1.4\n%%Page: 1 1\nBT ({text}) Tj ET\n%%EOF");
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-selectable".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "selectable.pdf".to_string(),
            mime_type: Some("application/pdf".to_string()),
            bytes: pdf.into_bytes(),
            created_at: timestamp(),
        })
        .await
        .expect("attachment insert");

        let record = repo
            .parse_attachment_now_with_ocr("att-selectable", &timestamp(), &harness.config())
            .await
            .expect("parse attachment")
            .expect("record");

        assert_eq!(record.parse_status, "ready");
        assert_eq!(record.parser.as_deref(), Some("pdf_text_density_v1"));
        assert!(!harness.log_path.exists());
    }

    #[tokio::test]
    async fn referenced_ocr_result_is_loom_scoped_context() {
        let harness = FakeOcrHarness::new("context");
        let database = test_database().await;
        insert_test_loom(&database, "loom-a").await;
        insert_test_loom(&database, "loom-b").await;
        let repo = AttachmentRepository::new(&database);
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-ocr-context".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "scan.pdf".to_string(),
            mime_type: Some("application/pdf".to_string()),
            bytes: b"%PDF-1.4\n%%Page: 1 1\n/Subtype /Image\n/image-only\n%%EOF".to_vec(),
            created_at: timestamp(),
        })
        .await
        .expect("attachment insert");
        repo.parse_attachment_now_with_ocr("att-ocr-context", &timestamp(), &harness.config())
            .await
            .expect("parse attachment");

        let same_loom = repo
            .get_referenced_attachment_content("loom-a", "att-ocr-context", "Blue Otter")
            .await
            .expect("same loom")
            .expect("attachment");
        assert!(same_loom
            .parsed_content
            .expect("parsed")
            .content_text
            .contains("Blue Otter OCR text"));
        assert!(repo
            .get_referenced_attachment_content("loom-b", "att-ocr-context", "Blue Otter")
            .await
            .expect("other loom")
            .is_none());
    }

    #[test]
    fn mixed_pdf_returns_partial_text_and_ocr_needed_page_metadata() {
        let text = "The first PDF page contains meaningful selectable text about Event Sourcing, projections, replay, commands, queries, consistency, audits, and operational tradeoffs for Loom context retrieval.";
        let pdf = format!(
            "%PDF-1.4\n%%Page: 1 1\nBT ({text}) Tj ET\n%%Page: 2 2\n/Subtype /Image\n/image-only\n%%EOF"
        );
        let parsed = parse_attachment(
            "mixed.pdf",
            Some("application/pdf"),
            &Some("pdf".to_string()),
            pdf.as_bytes(),
        );
        assert_eq!(parsed.parse_status, "ready");
        assert_eq!(parsed.kind, "mixed_pdf");
        assert!(parsed
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("OCR needed for 1 page: 2"));
        let content = parsed.content.expect("partial content").content_text;
        assert!(content.contains("Event Sourcing"));
        assert!(!content.contains("image-only"));
        let metadata = parsed.metadata_json.expect("metadata");
        assert!(metadata.contains("\"documentClassification\":\"mixed_pdf\""));
        assert!(metadata.contains("\"ocrNeededPages\":[2]"));
    }

    #[test]
    fn low_header_footer_text_does_not_make_pdf_ready() {
        let pdf = b"%PDF-1.4\n%%Page: 1 1\nBT (Page 1 Confidential) Tj ET\n%%EOF";
        let parsed = parse_attachment(
            "header-footer.pdf",
            Some("application/pdf"),
            &Some("pdf".to_string()),
            pdf,
        );
        assert_eq!(parsed.parse_status, "unsupported");
        assert_eq!(parsed.kind, "empty_or_unsupported");
        assert!(parsed.content.is_none());
        let metadata = parsed.metadata_json.expect("metadata");
        assert!(metadata.contains("\"classification\":\"empty\""));
    }

    #[test]
    fn docx_fixture_parses_ordered_text() {
        let docx = docx_fixture(&[
            ("Heading One", Some("Heading1")),
            ("The project codename is Blue Otter.", None),
            ("Follow up paragraph.", None),
        ]);
        let parsed = parse_attachment(
            "notes.docx",
            Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            &Some("docx".to_string()),
            &docx,
        );
        assert_eq!(parsed.parse_status, "ready");
        assert_eq!(parsed.kind, "document");
        assert_eq!(parsed.parser.as_deref(), Some("docx_text_v1"));
        let content = parsed.content.expect("docx content");
        assert_eq!(content.parser, "docx_text_v1");
        assert!(content.content_text.contains("# Heading One"));
        assert!(content.content_text.contains("Blue Otter"));
        let metadata = parsed.metadata_json.expect("metadata");
        assert!(metadata.contains("\"parserKind\":\"docx_text_v1\""));
        assert!(metadata.contains("\"paragraphCount\":3"));
    }

    #[tokio::test]
    async fn referenced_docx_context_is_available_only_for_same_loom() {
        let database = test_database().await;
        for loom_id in ["loom-a", "loom-b"] {
            sqlx::query(
                "INSERT INTO looms (loom_id, title, created_at, updated_at)
                 VALUES (?1, ?1, '1', '1')",
            )
            .bind(loom_id)
            .execute(database.pool())
            .await
            .expect("loom insert");
        }
        let repo = AttachmentRepository::new(&database);
        repo.insert_attachment(&NewAttachment {
            attachment_id: "att-docx".to_string(),
            loom_id: "loom-a".to_string(),
            file_name: "notes.docx".to_string(),
            mime_type: Some(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    .to_string(),
            ),
            bytes: docx_fixture(&[("Docx context includes Blue Otter.", None)]),
            created_at: timestamp(),
        })
        .await
        .expect("attachment insert");
        repo.parse_attachment_now("att-docx", &timestamp())
            .await
            .expect("parse attachment");

        let same_loom = repo
            .get_referenced_attachment_content("loom-a", "att-docx", "Blue Otter")
            .await
            .expect("same loom")
            .expect("attachment");
        assert!(same_loom
            .parsed_content
            .expect("parsed")
            .content_text
            .contains("Blue Otter"));
        assert!(repo
            .get_referenced_attachment_content("loom-b", "att-docx", "Blue Otter")
            .await
            .expect("other loom")
            .is_none());
    }

    #[test]
    fn xlsx_fixture_parses_sheet_names_and_cells() {
        let xlsx = xlsx_fixture(&[(
            "Budget",
            vec![
                vec!["Item", "Cost"],
                vec!["Research", "1200"],
                vec!["Build", "3400"],
            ],
        )]);
        let parsed = parse_attachment(
            "budget.xlsx",
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            &Some("xlsx".to_string()),
            &xlsx,
        );
        assert_eq!(parsed.parse_status, "ready");
        assert_eq!(parsed.kind, "spreadsheet");
        assert_eq!(parsed.parser.as_deref(), Some("xlsx_sheet_text_v1"));
        let content = parsed.content.expect("xlsx content");
        assert!(content.content_text.contains("# Sheet: Budget"));
        assert!(content.content_text.contains("A1=Item"));
        assert!(content.content_text.contains("B3=3400"));
        let metadata = parsed.metadata_json.expect("metadata");
        assert!(metadata.contains("\"parserKind\":\"xlsx_sheet_text_v1\""));
        assert!(metadata.contains("\"sheetCount\":1"));
        assert!(metadata.contains("\"rowsProcessed\":3"));
    }

    #[test]
    fn oversized_xlsx_truncates_with_metadata_warning() {
        let rows = (0..(XLSX_MAX_ROWS_PER_SHEET + 25))
            .map(|index| vec![format!("Row {index}"), "value".to_string()])
            .collect::<Vec<_>>();
        let sheet_rows = rows
            .iter()
            .map(|row| row.iter().map(String::as_str).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        let xlsx = xlsx_fixture(&[("Large", sheet_rows)]);
        let parsed = parse_attachment(
            "large.xlsx",
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            &Some("xlsx".to_string()),
            &xlsx,
        );
        assert_eq!(parsed.parse_status, "ready");
        let metadata = parsed.metadata_json.expect("metadata");
        assert!(metadata.contains("\"truncated\":true"));
        assert!(metadata.contains("XLSX text was truncated at parser limits"));
    }

    #[test]
    fn legacy_office_formats_are_unsupported() {
        let doc = parse_attachment(
            "legacy.doc",
            Some("application/msword"),
            &Some("doc".to_string()),
            b"doc",
        );
        assert_eq!(doc.parse_status, "unsupported");
        assert!(doc
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("Convert the file to .docx"));

        let xls = parse_attachment(
            "legacy.xls",
            Some("application/vnd.ms-excel"),
            &Some("xls".to_string()),
            b"xls",
        );
        assert_eq!(xls.parse_status, "unsupported");
        assert!(xls
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("Convert the file to .xlsx"));
    }

    #[test]
    fn corrupt_or_encrypted_office_files_fail_clearly() {
        let corrupt = parse_attachment(
            "broken.docx",
            Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            &Some("docx".to_string()),
            b"not a zip",
        );
        assert_eq!(corrupt.parse_status, "failed");
        assert_eq!(corrupt.parser.as_deref(), Some("docx_text_v1"));
        assert!(corrupt
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("DOCX parse failed"));

        let encrypted = parse_attachment(
            "locked.xlsx",
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            &Some("xlsx".to_string()),
            &zip_fixture(&[("EncryptedPackage", "encrypted")]),
        );
        assert_eq!(encrypted.parse_status, "failed");
        assert_eq!(encrypted.parser.as_deref(), Some("xlsx_sheet_text_v1"));
        assert!(encrypted
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("password-protected"));
    }

    #[test]
    fn unsupported_files_remain_visible_without_parsed_content() {
        let parsed = parse_attachment(
            "archive.zip",
            Some("application/zip"),
            &Some("zip".to_string()),
            b"zip",
        );
        assert_eq!(parsed.parse_status, "unsupported");
        assert_eq!(parsed.kind, "unsupported");
        assert!(parsed.content.is_none());
    }

    #[test]
    fn image_files_remain_visible_but_unsupported_without_parsed_content() {
        let parsed = parse_attachment(
            "pixel.png",
            Some("image/png"),
            &Some("png".to_string()),
            &[137, 80, 78, 71],
        );
        assert_eq!(parsed.parse_status, "unsupported");
        assert_eq!(parsed.kind, "image");
        assert!(parsed.thumbnail_data_url.is_none());
        assert!(parsed.content.is_none());
        assert!(parsed
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("vision-capable runtime"));
    }

    async fn insert_test_loom(database: &Database, loom_id: &str) {
        sqlx::query(
            "INSERT INTO looms (loom_id, title, created_at, updated_at)
             VALUES (?1, ?1, '1', '1')",
        )
        .bind(loom_id)
        .execute(database.pool())
        .await
        .expect("loom insert");
    }

    async fn table_count(database: &Database, table: &str) -> i64 {
        sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(database.pool())
            .await
            .expect("table count")
    }

    struct FakeOcrHarness {
        root: PathBuf,
        tesseract_path: PathBuf,
        rasterizer_path: PathBuf,
        log_path: PathBuf,
    }

    impl FakeOcrHarness {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "loom-fake-ocr-{name}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_nanos())
                    .unwrap_or(0)
            ));
            std::fs::create_dir_all(&root).expect("create fake ocr root");
            let tesseract_path = root.join("tesseract");
            let rasterizer_path = root.join("pdftoppm");
            let log_path = root.join("pages.log");
            write_executable(
                &rasterizer_path,
                &format!(
                    r#"#!/bin/sh
page=""
prefix=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -f) shift; page="$1" ;;
    *) prefix="$1" ;;
  esac
  shift
done
printf '%s\n' "$page" >> "{}"
printf 'fake-image-page-%s' "$page" > "${{prefix}}-${{page}}.png"
"#,
                    log_path.display()
                ),
            );
            write_executable(
                &tesseract_path,
                r#"#!/bin/sh
image="$1"
case "$image" in
  *page-1*) printf 'Blue Otter OCR text from page 1.' ;;
  *page-2*) printf 'Blue Otter OCR text from page 2.' ;;
  *page-3*) printf 'Blue Otter OCR text from page 3.' ;;
  *) printf 'Blue Otter OCR text from unknown page.' ;;
esac
"#,
            );
            Self {
                root,
                tesseract_path,
                rasterizer_path,
                log_path,
            }
        }

        fn config(&self) -> OcrSection {
            OcrSection {
                enabled: true,
                command_path: Some(self.tesseract_path.display().to_string()),
                pdf_rasterizer_command_path: Some(self.rasterizer_path.display().to_string()),
                temp_dir: Some(self.root.display().to_string()),
                timeout_seconds: 5,
                ..OcrSection::default()
            }
        }
    }

    impl Drop for FakeOcrHarness {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn write_executable(path: &Path, body: &str) {
        std::fs::write(path, body).expect("write fake executable");
        let mut permissions = std::fs::metadata(path)
            .expect("fake executable metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).expect("fake executable permissions");
    }

    fn zip_fixture(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut buffer);
            let options = FileOptions::default().compression_method(zip::CompressionMethod::Stored);
            for (path, content) in entries {
                zip.start_file(*path, options).expect("start zip file");
                zip.write_all(content.as_bytes()).expect("write zip file");
            }
            zip.finish().expect("finish zip");
        }
        buffer.into_inner()
    }

    fn docx_fixture(paragraphs: &[(&str, Option<&str>)]) -> Vec<u8> {
        let body = paragraphs
            .iter()
            .map(|(text, style)| {
                let style = style
                    .map(|value| format!(r#"<w:pPr><w:pStyle w:val="{value}"/></w:pPr>"#))
                    .unwrap_or_default();
                format!(
                    r#"<w:p>{style}<w:r><w:t>{}</w:t></w:r></w:p>"#,
                    xml_escape(text)
                )
            })
            .collect::<Vec<_>>()
            .join("");
        zip_fixture(&[
            (
                "[Content_Types].xml",
                r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#,
            ),
            (
                "_rels/.rels",
                r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#,
            ),
            (
                "word/document.xml",
                &format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>"#
                ),
            ),
        ])
    }

    fn xlsx_fixture(sheets: &[(&str, Vec<Vec<&str>>)]) -> Vec<u8> {
        let workbook_sheets = sheets
            .iter()
            .enumerate()
            .map(|(index, (name, _))| {
                format!(
                    r#"<sheet name="{}" sheetId="{}" r:id="rId{}"/>"#,
                    xml_escape(name),
                    index + 1,
                    index + 1
                )
            })
            .collect::<Vec<_>>()
            .join("");
        let mut entries = vec![
            (
                "[Content_Types].xml".to_string(),
                r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#.to_string(),
            ),
            (
                "_rels/.rels".to_string(),
                r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#.to_string(),
            ),
            (
                "xl/workbook.xml".to_string(),
                format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{workbook_sheets}</sheets></workbook>"#
                ),
            ),
        ];
        for (sheet_index, (_, rows)) in sheets.iter().enumerate() {
            let rows_xml = rows
                .iter()
                .enumerate()
                .map(|(row_index, row)| {
                    let row_number = row_index + 1;
                    let cells = row
                        .iter()
                        .enumerate()
                        .map(|(column_index, value)| {
                            let reference = format!("{}{}", column_name(column_index), row_number);
                            format!(
                                r#"<c r="{reference}" t="inlineStr"><is><t>{}</t></is></c>"#,
                                xml_escape(value)
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("");
                    format!(r#"<row r="{row_number}">{cells}</row>"#)
                })
                .collect::<Vec<_>>()
                .join("");
            entries.push((
                format!("xl/worksheets/sheet{}.xml", sheet_index + 1),
                format!(r#"<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>{rows_xml}</sheetData></worksheet>"#),
            ));
        }
        let entry_refs = entries
            .iter()
            .map(|(path, content)| (path.as_str(), content.as_str()))
            .collect::<Vec<_>>();
        zip_fixture(&entry_refs)
    }

    fn column_name(mut index: usize) -> String {
        let mut name = String::new();
        loop {
            let remainder = index % 26;
            name.insert(0, (b'A' + remainder as u8) as char);
            if index < 26 {
                break;
            }
            index = index / 26 - 1;
        }
        name
    }

    fn xml_escape(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
}
