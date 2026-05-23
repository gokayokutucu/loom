#![allow(dead_code)]

use crate::{error::ServiceError, storage::db::Database};
use serde_json::json;
use sqlx::{Row, SqlitePool};

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

#[derive(Debug, Clone, PartialEq)]
pub struct SearchDocument {
    pub doc_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub attachment_id: Option<String>,
    pub parse_artifact_id: Option<String>,
    pub title: Option<String>,
    pub body: String,
    pub tags: Option<String>,
    pub source_rank: f64,
    pub is_deleted: bool,
    pub updated_at: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SearchIndexRepository {
    pool: SqlitePool,
}

impl SearchIndexRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn upsert_response_docs(&self, response_id: &str) -> Result<(), ServiceError> {
        let Some(row) = sqlx::query(
            "SELECT response_id, loom_id, role, content, title, code, canonical_uri,
                    updated_at, is_deleted
             FROM responses
             WHERE response_id = ?1
             LIMIT 1",
        )
        .bind(response_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to fetch Response for search index: {error}"
            ))
        })?
        else {
            return Ok(());
        };

        let is_deleted = row.get::<i64, _>("is_deleted") != 0;
        if is_deleted {
            return self.mark_response_deleted(response_id).await;
        }

        let content: String = row.get("content");
        let code: Option<String> = row.get("code");
        reject_forbidden_payload(Some(&content))?;
        reject_forbidden_payload(code.as_deref())?;

        let canonical_uri: Option<String> = row.get("canonical_uri");
        let body = [Some(content), code, canonical_uri.clone()]
            .into_iter()
            .flatten()
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        if body.trim().is_empty() {
            return Ok(());
        }

        let role: String = row.get("role");
        let title: Option<String> = row.get("title");
        let loom_id: String = row.get("loom_id");
        let updated_at: String = row.get("updated_at");
        let metadata_json = json!({
            "role": role,
            "canonicalUri": canonical_uri,
        })
        .to_string();

        self.upsert_document(&SearchDocument {
            doc_id: format!("response:{response_id}"),
            source_kind: "response".to_string(),
            source_id: response_id.to_string(),
            loom_id: Some(loom_id),
            response_id: Some(response_id.to_string()),
            attachment_id: None,
            parse_artifact_id: None,
            title,
            body,
            tags: Some(role),
            source_rank: 1.0,
            is_deleted: false,
            updated_at,
            metadata_json: Some(metadata_json),
        })
        .await
    }

    pub async fn mark_response_deleted(&self, response_id: &str) -> Result<(), ServiceError> {
        sqlx::query(
            "UPDATE search_documents
             SET is_deleted = 1,
                 updated_at = ?2
             WHERE response_id = ?1",
        )
        .bind(response_id)
        .bind(timestamp())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to mark Response search docs deleted: {error}"
            ))
        })?;
        self.rebuild_fts().await
    }

    pub async fn upsert_memory_doc(&self, memory_id: &str) -> Result<(), ServiceError> {
        let Some(row) = sqlx::query(
            "SELECT memory_id, memory_type, content, normalized_content, updated_at,
                    source_loom_id, source_response_id, user_confirmed, deleted_at, metadata_json
             FROM memories
             WHERE memory_id = ?1
             LIMIT 1",
        )
        .bind(memory_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to fetch Memory for search index: {error}"))
        })?
        else {
            return Ok(());
        };

        let deleted_at: Option<String> = row.get("deleted_at");
        let user_confirmed = row.get::<i64, _>("user_confirmed") != 0;
        if deleted_at.is_some() || !user_confirmed {
            return self.mark_memory_deleted(memory_id).await;
        }

        let content: String = row.get("content");
        let normalized_content: String = row.get("normalized_content");
        let metadata_json: Option<String> = row.get("metadata_json");
        reject_forbidden_payload(Some(&content))?;
        reject_forbidden_payload(Some(&normalized_content))?;
        reject_forbidden_payload(metadata_json.as_deref())?;

        let memory_type: String = row.get("memory_type");
        let source_loom_id: Option<String> = row.get("source_loom_id");
        let source_response_id: Option<String> = row.get("source_response_id");
        let updated_at: String = row.get("updated_at");

        self.upsert_document(&SearchDocument {
            doc_id: format!("memory:{memory_id}"),
            source_kind: "memory".to_string(),
            source_id: memory_id.to_string(),
            loom_id: source_loom_id,
            response_id: source_response_id,
            attachment_id: None,
            parse_artifact_id: None,
            title: Some(memory_type.clone()),
            body: content,
            tags: Some(memory_type),
            source_rank: 1.2,
            is_deleted: false,
            updated_at,
            metadata_json,
        })
        .await
    }

    pub async fn mark_memory_deleted(&self, memory_id: &str) -> Result<(), ServiceError> {
        sqlx::query(
            "UPDATE search_documents
             SET is_deleted = 1,
                 updated_at = ?2
             WHERE source_kind = 'memory' AND source_id = ?1",
        )
        .bind(memory_id)
        .bind(timestamp())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to mark Memory search doc deleted: {error}"))
        })?;
        self.rebuild_fts().await
    }

    pub async fn upsert_attachment_artifact_docs(
        &self,
        parse_artifact_id: &str,
    ) -> Result<(), ServiceError> {
        let attachments = sqlx::query(
            "SELECT attachment_id, loom_id, file_name, kind, extension, parse_status, updated_at
             FROM attachments
             WHERE parse_artifact_id = ?1",
        )
        .bind(parse_artifact_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to fetch Attachment scopes for search index: {error}"
            ))
        })?;

        for attachment in attachments {
            let attachment_id: String = attachment.get("attachment_id");
            let parse_status: String = attachment.get("parse_status");
            if parse_status != "ready" {
                self.remove_attachment_scope_docs(&attachment_id).await?;
                continue;
            }

            let loom_id: String = attachment.get("loom_id");
            let file_name: String = attachment.get("file_name");
            let kind: String = attachment.get("kind");
            let extension: Option<String> = attachment.get("extension");
            let updated_at: String = attachment.get("updated_at");
            let tags = [Some(kind), extension]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");

            let chunks = sqlx::query(
                "SELECT chunk_id, chunk_index, content_text, page_number, sheet_name, metadata_json
                 FROM attachment_parse_artifact_chunks
                 WHERE parse_artifact_id = ?1
                 ORDER BY chunk_index ASC",
            )
            .bind(parse_artifact_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!(
                    "failed to fetch Attachment chunks for search index: {error}"
                ))
            })?;

            for chunk in chunks {
                let chunk_id: String = chunk.get("chunk_id");
                let chunk_index: i64 = chunk.get("chunk_index");
                let content_text: String = chunk.get("content_text");
                let metadata_json: Option<String> = chunk.get("metadata_json");
                reject_forbidden_payload(Some(&content_text))?;
                reject_forbidden_payload(metadata_json.as_deref())?;
                let page_number: Option<i64> = chunk.get("page_number");
                let sheet_name: Option<String> = chunk.get("sheet_name");
                let metadata = json!({
                    "chunkId": chunk_id,
                    "chunkIndex": chunk_index,
                    "pageNumber": page_number,
                    "sheetName": sheet_name,
                    "metadata": metadata_json,
                })
                .to_string();

                self.upsert_document(&SearchDocument {
                    doc_id: format!("attachment:{attachment_id}:chunk:{chunk_index}"),
                    source_kind: "attachment_chunk".to_string(),
                    source_id: chunk_id,
                    loom_id: Some(loom_id.clone()),
                    response_id: None,
                    attachment_id: Some(attachment_id.clone()),
                    parse_artifact_id: Some(parse_artifact_id.to_string()),
                    title: Some(file_name.clone()),
                    body: content_text,
                    tags: Some(tags.clone()),
                    source_rank: 1.1,
                    is_deleted: false,
                    updated_at: updated_at.clone(),
                    metadata_json: Some(metadata),
                })
                .await?;
            }

            let summaries = sqlx::query(
                "SELECT summary_text, summary_kind, parser, updated_at
                 FROM attachment_parse_artifact_summaries
                 WHERE parse_artifact_id = ?1",
            )
            .bind(parse_artifact_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!(
                    "failed to fetch Attachment summaries for search index: {error}"
                ))
            })?;

            for summary in summaries {
                let summary_text: String = summary.get("summary_text");
                reject_forbidden_payload(Some(&summary_text))?;
                let summary_kind: String = summary.get("summary_kind");
                let parser: String = summary.get("parser");
                let summary_updated_at: String = summary.get("updated_at");
                let metadata = json!({
                    "summaryKind": summary_kind,
                    "parser": parser,
                })
                .to_string();

                self.upsert_document(&SearchDocument {
                    doc_id: format!("attachment:{attachment_id}:summary"),
                    source_kind: "attachment_summary".to_string(),
                    source_id: attachment_id.clone(),
                    loom_id: Some(loom_id.clone()),
                    response_id: None,
                    attachment_id: Some(attachment_id.clone()),
                    parse_artifact_id: Some(parse_artifact_id.to_string()),
                    title: Some(file_name.clone()),
                    body: summary_text,
                    tags: Some(tags.clone()),
                    source_rank: 0.9,
                    is_deleted: false,
                    updated_at: summary_updated_at,
                    metadata_json: Some(metadata),
                })
                .await?;
            }
        }

        Ok(())
    }

    pub async fn remove_attachment_scope_docs(
        &self,
        attachment_id: &str,
    ) -> Result<(), ServiceError> {
        sqlx::query("DELETE FROM search_documents WHERE attachment_id = ?1")
            .bind(attachment_id)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to remove Attachment search docs: {error}"))
            })?;
        self.rebuild_fts().await
    }

    pub async fn rebuild_all(&self) -> Result<(), ServiceError> {
        sqlx::query("DELETE FROM search_documents")
            .execute(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to clear search documents: {error}"))
            })?;
        self.rebuild_fts().await?;

        let response_ids = sqlx::query_scalar::<_, String>("SELECT response_id FROM responses")
            .fetch_all(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!(
                    "failed to list Responses for search rebuild: {error}"
                ))
            })?;
        for response_id in response_ids {
            self.upsert_response_docs(&response_id).await?;
        }

        let memory_ids = sqlx::query_scalar::<_, String>("SELECT memory_id FROM memories")
            .fetch_all(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!(
                    "failed to list Memories for search rebuild: {error}"
                ))
            })?;
        for memory_id in memory_ids {
            self.upsert_memory_doc(&memory_id).await?;
        }

        let artifact_ids = sqlx::query_scalar::<_, String>(
            "SELECT parse_artifact_id FROM attachment_parse_artifacts",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to list Attachment artifacts for search rebuild: {error}"
            ))
        })?;
        for artifact_id in artifact_ids {
            self.upsert_attachment_artifact_docs(&artifact_id).await?;
        }

        sqlx::query(
            "INSERT OR REPLACE INTO search_index_state (key, value, updated_at)
             VALUES ('last_rebuild_all', 'completed', ?1)",
        )
        .bind(timestamp())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to update search index state: {error}"))
        })?;

        Ok(())
    }

    pub async fn search(
        &self,
        loom_id: Option<&str>,
        query: &str,
    ) -> Result<Vec<SearchDocument>, ServiceError> {
        let fts_query = fts_query(query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }

        let rows = if let Some(loom_id) = loom_id {
            sqlx::query(
                "SELECT d.*
                 FROM search_documents_fts
                 JOIN search_documents d ON d.rowid = search_documents_fts.rowid
                 WHERE search_documents_fts MATCH ?1
                   AND d.is_deleted = 0
                   AND d.loom_id = ?2
                 ORDER BY d.source_rank DESC, bm25(search_documents_fts), d.updated_at DESC",
            )
            .bind(fts_query)
            .bind(loom_id)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query(
                "SELECT d.*
                 FROM search_documents_fts
                 JOIN search_documents d ON d.rowid = search_documents_fts.rowid
                 WHERE search_documents_fts MATCH ?1
                   AND d.is_deleted = 0
                 ORDER BY d.source_rank DESC, bm25(search_documents_fts), d.updated_at DESC",
            )
            .bind(fts_query)
            .fetch_all(&self.pool)
            .await
        }
        .map_err(|error| ServiceError::storage(format!("failed to search FTS index: {error}")))?;

        Ok(rows.into_iter().map(search_document_from_row).collect())
    }

    async fn upsert_document(&self, document: &SearchDocument) -> Result<(), ServiceError> {
        reject_forbidden_payload(document.title.as_deref())?;
        reject_forbidden_payload(Some(&document.body))?;
        reject_forbidden_payload(document.tags.as_deref())?;
        reject_forbidden_payload(document.metadata_json.as_deref())?;

        sqlx::query(
            "INSERT INTO search_documents (
                doc_id, source_kind, source_id, loom_id, response_id, attachment_id,
                parse_artifact_id, title, body, tags, source_rank, is_deleted,
                updated_at, metadata_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(doc_id) DO UPDATE SET
                source_kind = excluded.source_kind,
                source_id = excluded.source_id,
                loom_id = excluded.loom_id,
                response_id = excluded.response_id,
                attachment_id = excluded.attachment_id,
                parse_artifact_id = excluded.parse_artifact_id,
                title = excluded.title,
                body = excluded.body,
                tags = excluded.tags,
                source_rank = excluded.source_rank,
                is_deleted = excluded.is_deleted,
                updated_at = excluded.updated_at,
                metadata_json = excluded.metadata_json",
        )
        .bind(&document.doc_id)
        .bind(&document.source_kind)
        .bind(&document.source_id)
        .bind(&document.loom_id)
        .bind(&document.response_id)
        .bind(&document.attachment_id)
        .bind(&document.parse_artifact_id)
        .bind(&document.title)
        .bind(&document.body)
        .bind(&document.tags)
        .bind(document.source_rank)
        .bind(if document.is_deleted { 1 } else { 0 })
        .bind(&document.updated_at)
        .bind(&document.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to upsert search document: {error}"))
        })?;

        self.rebuild_fts().await
    }

    async fn rebuild_fts(&self) -> Result<(), ServiceError> {
        sqlx::query("INSERT INTO search_documents_fts(search_documents_fts) VALUES ('rebuild')")
            .execute(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to rebuild FTS index: {error}"))
            })?;
        Ok(())
    }
}

fn search_document_from_row(row: sqlx::sqlite::SqliteRow) -> SearchDocument {
    SearchDocument {
        doc_id: row.get("doc_id"),
        source_kind: row.get("source_kind"),
        source_id: row.get("source_id"),
        loom_id: row.get("loom_id"),
        response_id: row.get("response_id"),
        attachment_id: row.get("attachment_id"),
        parse_artifact_id: row.get("parse_artifact_id"),
        title: row.get("title"),
        body: row.get("body"),
        tags: row.get("tags"),
        source_rank: row.get("source_rank"),
        is_deleted: row.get::<i64, _>("is_deleted") != 0,
        updated_at: row.get("updated_at"),
        metadata_json: row.get("metadata_json"),
    }
}

fn reject_forbidden_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "Search index payload contains forbidden key {forbidden}"
            )));
        }
    }
    Ok(())
}

fn fts_query(query: &str) -> String {
    let mut terms = query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 2)
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    terms.sort();
    terms.dedup();
    terms.join(" OR ")
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::SearchIndexRepository;
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn response_doc_can_be_inserted_and_searched() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_response(
            &database,
            "resp-a",
            "loom-a",
            "assistant",
            "Blue Otter launch notes",
            "Blue Otter",
            0,
            0,
        )
        .await;

        let search = SearchIndexRepository::new(&database);
        search.upsert_response_docs("resp-a").await.expect("upsert");

        let docs = search
            .search(Some("loom-a"), "Blue Otter")
            .await
            .expect("search");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].response_id.as_deref(), Some("resp-a"));
    }

    #[tokio::test]
    async fn deleted_response_is_marked_deleted_and_excluded() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_response(
            &database,
            "resp-a",
            "loom-a",
            "assistant",
            "Deleted Blue Otter note",
            "Blue Otter",
            0,
            0,
        )
        .await;
        let search = SearchIndexRepository::new(&database);
        search.upsert_response_docs("resp-a").await.expect("upsert");

        sqlx::query("UPDATE responses SET is_deleted = 1 WHERE response_id = 'resp-a'")
            .execute(database.pool())
            .await
            .expect("delete response");
        search
            .upsert_response_docs("resp-a")
            .await
            .expect("mark deleted");

        let docs = search
            .search(Some("loom-a"), "Blue Otter")
            .await
            .expect("search");
        assert!(docs.is_empty());
        let deleted = sqlx::query_scalar::<_, i64>(
            "SELECT is_deleted FROM search_documents WHERE doc_id = 'response:resp-a'",
        )
        .fetch_one(database.pool())
        .await
        .expect("deleted flag");
        assert_eq!(deleted, 1);
    }

    #[tokio::test]
    async fn memory_doc_can_be_inserted_and_searched() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_memory(
            &database,
            "memory-a",
            "Blue Otter is the internal project codename.",
            Some("loom-a"),
            1,
            None,
        )
        .await;

        let search = SearchIndexRepository::new(&database);
        search.upsert_memory_doc("memory-a").await.expect("upsert");

        let docs = search
            .search(Some("loom-a"), "codename")
            .await
            .expect("search");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].source_kind, "memory");
    }

    #[tokio::test]
    async fn attachment_chunk_is_indexed_only_through_loom_scoped_attachment() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_attachment_artifact(
            &database,
            "artifact-a",
            &[("att-a", "loom-a", "notes.md")],
            "Blue Otter attachment content",
        )
        .await;

        let search = SearchIndexRepository::new(&database);
        search
            .upsert_attachment_artifact_docs("artifact-a")
            .await
            .expect("upsert artifact");

        let docs = search
            .search(Some("loom-a"), "Otter")
            .await
            .expect("search");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].attachment_id.as_deref(), Some("att-a"));
        let other = search
            .search(Some("loom-b"), "Otter")
            .await
            .expect("search");
        assert!(other.is_empty());
    }

    #[tokio::test]
    async fn same_deduped_parse_artifact_does_not_leak_across_looms() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_loom(&database, "loom-b").await;
        seed_attachment_artifact(
            &database,
            "artifact-a",
            &[
                ("att-a", "loom-a", "notes.md"),
                ("att-b", "loom-b", "notes.md"),
            ],
            "Shared Blue Otter artifact content",
        )
        .await;

        let search = SearchIndexRepository::new(&database);
        search
            .upsert_attachment_artifact_docs("artifact-a")
            .await
            .expect("upsert artifact");

        let loom_a = search
            .search(Some("loom-a"), "Shared")
            .await
            .expect("search");
        let loom_b = search
            .search(Some("loom-b"), "Shared")
            .await
            .expect("search");
        assert_eq!(loom_a.len(), 1);
        assert_eq!(loom_b.len(), 1);
        assert_eq!(loom_a[0].attachment_id.as_deref(), Some("att-a"));
        assert_eq!(loom_b[0].attachment_id.as_deref(), Some("att-b"));
    }

    #[tokio::test]
    async fn rebuild_all_matches_incremental_search_docs() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_response(
            &database,
            "resp-a",
            "loom-a",
            "assistant",
            "Blue Otter response",
            "Blue Otter",
            0,
            0,
        )
        .await;
        seed_memory(
            &database,
            "memory-a",
            "Blue Otter memory",
            Some("loom-a"),
            1,
            None,
        )
        .await;
        seed_attachment_artifact(
            &database,
            "artifact-a",
            &[("att-a", "loom-a", "notes.md")],
            "Blue Otter attachment",
        )
        .await;
        let search = SearchIndexRepository::new(&database);
        search
            .upsert_response_docs("resp-a")
            .await
            .expect("response");
        search.upsert_memory_doc("memory-a").await.expect("memory");
        search
            .upsert_attachment_artifact_docs("artifact-a")
            .await
            .expect("attachment");
        let incremental_count = table_count(&database, "search_documents").await;

        search.rebuild_all().await.expect("rebuild");
        let rebuilt_count = table_count(&database, "search_documents").await;
        assert_eq!(rebuilt_count, incremental_count);

        let docs = search
            .search(Some("loom-a"), "Otter")
            .await
            .expect("search");
        assert_eq!(docs.len(), incremental_count as usize);
    }

    #[tokio::test]
    async fn raw_thinking_payload_is_rejected_and_not_indexed() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_response(
            &database,
            "resp-a",
            "loom-a",
            "assistant",
            r#"{"raw_thinking":"secret"}"#,
            "Unsafe",
            0,
            0,
        )
        .await;
        let search = SearchIndexRepository::new(&database);
        let error = search
            .upsert_response_docs("resp-a")
            .await
            .expect_err("raw thinking should be rejected");
        assert!(error.to_string().contains("forbidden key raw_thinking"));
        assert_eq!(table_count(&database, "search_documents").await, 0);
    }

    async fn seed_loom(database: &crate::storage::db::Database, loom_id: &str) {
        sqlx::query(
            "INSERT INTO looms (loom_id, title, summary, code, canonical_uri, kind, created_at, updated_at)
             VALUES (?1, ?2, NULL, NULL, NULL, 'loom', '1', '1')",
        )
        .bind(loom_id)
        .bind(loom_id)
        .execute(database.pool())
        .await
        .expect("seed loom");
    }

    async fn seed_response(
        database: &crate::storage::db::Database,
        response_id: &str,
        loom_id: &str,
        role: &str,
        content: &str,
        title: &str,
        sequence_index: i64,
        is_deleted: i64,
    ) {
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, code, canonical_uri,
                created_at, updated_at, sequence_index, metadata_json, is_deleted
             ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, '1', '1', ?6, NULL, ?7)",
        )
        .bind(response_id)
        .bind(loom_id)
        .bind(role)
        .bind(content)
        .bind(title)
        .bind(sequence_index)
        .bind(is_deleted)
        .execute(database.pool())
        .await
        .expect("seed response");
    }

    async fn seed_memory(
        database: &crate::storage::db::Database,
        memory_id: &str,
        content: &str,
        source_loom_id: Option<&str>,
        user_confirmed: i64,
        deleted_at: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO memories (
                memory_id, memory_type, content, normalized_content, created_at, updated_at,
                source_loom_id, source_response_id, user_confirmed, deleted_at, metadata_json
             ) VALUES (?1, 'explicit_user_memory', ?2, ?3, '1', '1', ?4, NULL, ?5, ?6, NULL)",
        )
        .bind(memory_id)
        .bind(content)
        .bind(content.to_ascii_lowercase())
        .bind(source_loom_id)
        .bind(user_confirmed)
        .bind(deleted_at)
        .execute(database.pool())
        .await
        .expect("seed memory");
    }

    async fn seed_attachment_artifact(
        database: &crate::storage::db::Database,
        artifact_id: &str,
        attachments: &[(&str, &str, &str)],
        chunk_text: &str,
    ) {
        sqlx::query(
            "INSERT INTO attachment_parse_artifacts (
                parse_artifact_id, sha256, parser_kind, parser_version, kind, content_kind,
                content_text, compression_kind, char_count, original_byte_count, stored_byte_count,
                metadata_json, created_at
             ) VALUES (?1, ?2, 'utf8_text', 'v1', 'text', 'text', ?3, 'none', ?4, ?4, ?4, NULL, '1')",
        )
        .bind(artifact_id)
        .bind(format!("sha-{artifact_id}"))
        .bind(chunk_text)
        .bind(chunk_text.chars().count() as i64)
        .execute(database.pool())
        .await
        .expect("seed artifact");

        sqlx::query(
            "INSERT INTO attachment_parse_artifact_chunks (
                chunk_id, parse_artifact_id, chunk_index, content_text, char_start, char_end,
                char_count, token_estimate, page_number, sheet_name, metadata_json, created_at
             ) VALUES (?1, ?2, 0, ?3, 0, ?4, ?4, 1, NULL, NULL, NULL, '1')",
        )
        .bind(format!("{artifact_id}-chunk-0"))
        .bind(artifact_id)
        .bind(chunk_text)
        .bind(chunk_text.chars().count() as i64)
        .execute(database.pool())
        .await
        .expect("seed chunk");

        for (attachment_id, loom_id, file_name) in attachments {
            sqlx::query(
                "INSERT INTO attachments (
                    attachment_id, loom_id, blob_id, sha256, parse_artifact_id, file_name,
                    mime_type, extension, size_bytes, kind, parse_status, parser,
                    error, thumbnail_data_url, metadata_json, created_at, updated_at
                 ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, 'text/markdown', 'md', ?6, 'text',
                    'ready', 'utf8_text_v1', NULL, NULL, NULL, '1', '1')",
            )
            .bind(attachment_id)
            .bind(loom_id)
            .bind(format!("sha-{artifact_id}"))
            .bind(artifact_id)
            .bind(file_name)
            .bind(chunk_text.len() as i64)
            .execute(database.pool())
            .await
            .expect("seed attachment");
        }
    }

    async fn table_count(database: &crate::storage::db::Database, table: &str) -> i64 {
        sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(database.pool())
            .await
            .expect("count table")
    }
}
