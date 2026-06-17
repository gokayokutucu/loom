#![allow(dead_code)]

use std::collections::{HashMap, HashSet};

use crate::{error::ServiceError, storage::db::Database};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};

pub const RETRIEVAL_PROJECTION_VERSION: &str = "sqlite-retrieval-projection-v1";

const FORBIDDEN_PROJECTION_TEXT: [&str; 19] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "rawThinking",
    "thinkingText",
    "chainOfThought",
    "hiddenReasoning",
    "provider_delta",
    "providerDelta",
    "provider_payload",
    "providerPayload",
    "Authorization",
    "Bearer ",
    "apiKey",
    "api_key",
    "password",
    "credential",
    "secret",
];

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RetrievalProjectionIdentity {
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: String,
    pub content_digest: String,
    pub projection_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalProjectionCandidate {
    pub identity: RetrievalProjectionIdentity,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub source_updated_at: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalProjectionStoredChunk {
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: String,
    pub projection_version: String,
    pub content_digest: String,
    pub is_deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalProjectionChunkScopeMetadata {
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalProjectionRebuildPlan {
    pub active_chunks: usize,
    pub changed_chunks: usize,
    pub tombstoned_chunks: usize,
}

#[derive(Debug, Clone)]
pub struct RetrievalProjectionRepository {
    pool: SqlitePool,
}

impl RetrievalProjectionRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    /// Enumerates safe SQLite-owned projection candidates in deterministic order.
    ///
    /// Future Tantivy and LanceDB adapters must consume this identity model
    /// instead of minting independent canonical document IDs.
    pub async fn enumerate_active_chunks(
        &self,
    ) -> Result<Vec<RetrievalProjectionCandidate>, ServiceError> {
        let mut candidates = Vec::new();
        candidates.extend(self.enumerate_response_chunks().await?);
        candidates.extend(self.enumerate_reference_chunks().await?);
        candidates.extend(self.enumerate_attachment_chunks().await?);
        candidates.extend(self.enumerate_memory_chunks().await?);
        candidates.extend(self.enumerate_response_capsule_chunks().await?);
        candidates.extend(self.enumerate_checkpoint_chunks().await?);
        candidates.sort_by(|left, right| {
            (
                left.identity.source_kind.as_str(),
                left.loom_id.as_deref().unwrap_or(""),
                left.identity.source_id.as_str(),
                left.identity.chunk_ref.as_str(),
            )
                .cmp(&(
                    right.identity.source_kind.as_str(),
                    right.loom_id.as_deref().unwrap_or(""),
                    right.identity.source_id.as_str(),
                    right.identity.chunk_ref.as_str(),
                ))
        });
        Ok(candidates)
    }

    pub async fn plan_full_rebuild(&self) -> Result<RetrievalProjectionRebuildPlan, ServiceError> {
        let candidates = self.enumerate_active_chunks().await?;
        let existing = self.list_stored_chunks().await?;
        let mut existing_by_key = existing
            .into_iter()
            .map(|chunk| {
                (
                    (
                        chunk.source_kind.clone(),
                        chunk.source_id.clone(),
                        chunk.chunk_ref.clone(),
                        chunk.projection_version.clone(),
                    ),
                    chunk,
                )
            })
            .collect::<HashMap<_, _>>();
        let mut seen = HashSet::new();
        let now = timestamp();
        let mut changed_chunks = 0usize;

        for candidate in &candidates {
            let key = (
                candidate.identity.source_kind.clone(),
                candidate.identity.source_id.clone(),
                candidate.identity.chunk_ref.clone(),
                candidate.identity.projection_version.clone(),
            );
            seen.insert(key.clone());
            let changed = existing_by_key
                .remove(&key)
                .map(|stored| {
                    stored.content_digest != candidate.identity.content_digest || stored.is_deleted
                })
                .unwrap_or(true);
            if changed {
                changed_chunks += 1;
            }
            self.upsert_candidate(candidate, &now).await?;
        }

        let mut tombstoned_chunks = 0usize;
        for (key, stored) in existing_by_key {
            if key.3 != RETRIEVAL_PROJECTION_VERSION || seen.contains(&key) || stored.is_deleted {
                continue;
            }
            self.tombstone_chunk(&key.0, &key.1, &key.2, &key.3, &now)
                .await?;
            tombstoned_chunks += 1;
        }

        Ok(RetrievalProjectionRebuildPlan {
            active_chunks: candidates.len(),
            changed_chunks,
            tombstoned_chunks,
        })
    }

    pub async fn list_stored_chunks(
        &self,
    ) -> Result<Vec<RetrievalProjectionStoredChunk>, ServiceError> {
        sqlx::query(
            "SELECT source_kind, source_id, chunk_ref, projection_version,
                    content_digest, is_deleted
             FROM retrieval_projection_chunks
             ORDER BY source_kind ASC, source_id ASC, chunk_ref ASC, projection_version ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to list retrieval projection chunks: {error}"
            ))
        })
        .map(|rows| {
            rows.into_iter()
                .map(|row| RetrievalProjectionStoredChunk {
                    source_kind: row.get("source_kind"),
                    source_id: row.get("source_id"),
                    chunk_ref: row.get("chunk_ref"),
                    projection_version: row.get("projection_version"),
                    content_digest: row.get("content_digest"),
                    is_deleted: row.get::<i64, _>("is_deleted") != 0,
                })
                .collect()
        })
    }

    pub async fn get_chunk_scope_metadata(
        &self,
        source_kind: &str,
        source_id: &str,
        chunk_ref: &str,
        projection_version: &str,
    ) -> Result<Option<RetrievalProjectionChunkScopeMetadata>, ServiceError> {
        sqlx::query(
            "SELECT loom_id, response_id
             FROM retrieval_projection_chunks
             WHERE source_kind = ?1 AND source_id = ?2
               AND chunk_ref = ?3 AND projection_version = ?4
               AND is_deleted = 0",
        )
        .bind(source_kind)
        .bind(source_id)
        .bind(chunk_ref)
        .bind(projection_version)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to read retrieval projection chunk scope metadata: {error}"
            ))
        })
        .map(|row| {
            row.map(|row| RetrievalProjectionChunkScopeMetadata {
                loom_id: row.get("loom_id"),
                response_id: row.get("response_id"),
            })
        })
    }

    async fn enumerate_response_chunks(
        &self,
    ) -> Result<Vec<RetrievalProjectionCandidate>, ServiceError> {
        let rows = sqlx::query(
            "SELECT response_id, loom_id, role, content, title, code, canonical_uri, updated_at
             FROM responses
             WHERE is_deleted = 0
             ORDER BY loom_id ASC, sequence_index ASC, response_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to enumerate response projections: {error}"))
        })?;
        rows.into_iter()
            .map(|row| {
                let response_id: String = row.get("response_id");
                let content: String = row.get("content");
                let code: Option<String> = row.get("code");
                let canonical_uri: Option<String> = row.get("canonical_uri");
                let body = [Some(content), code, canonical_uri.clone()]
                    .into_iter()
                    .flatten()
                    .filter(|value| !value.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join("\n\n");
                candidate(
                    "response",
                    &response_id,
                    format!("response:{response_id}:content"),
                    row.get("loom_id"),
                    Some(response_id.clone()),
                    row.get("title"),
                    body,
                    row.get("updated_at"),
                    Some(
                        json!({
                            "role": row.get::<String, _>("role"),
                            "canonicalUri": canonical_uri,
                        })
                        .to_string(),
                    ),
                )
            })
            .collect()
    }

    async fn enumerate_reference_chunks(
        &self,
    ) -> Result<Vec<RetrievalProjectionCandidate>, ServiceError> {
        let rows = sqlx::query(
            "SELECT reference_id, source_loom_id, source_response_id, target_kind,
                    target_id, target_uri, selected_text, label, created_at
             FROM \"references\"
             ORDER BY source_loom_id ASC, source_response_id ASC, reference_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to enumerate reference projections: {error}"
            ))
        })?;
        rows.into_iter()
            .filter_map(|row| {
                let reference_id: String = row.get("reference_id");
                let selected_text: Option<String> = row.get("selected_text");
                let label: Option<String> = row.get("label");
                let target_uri: Option<String> = row.get("target_uri");
                let body = [selected_text, label.clone(), target_uri.clone()]
                    .into_iter()
                    .flatten()
                    .filter(|value| !value.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join("\n");
                if body.trim().is_empty() {
                    return None;
                }
                Some(candidate(
                    "reference",
                    &reference_id,
                    format!("reference:{reference_id}:selected_text"),
                    row.get("source_loom_id"),
                    row.get("source_response_id"),
                    label,
                    body,
                    row.get("created_at"),
                    Some(
                        json!({
                            "targetKind": row.get::<String, _>("target_kind"),
                            "targetId": row.get::<Option<String>, _>("target_id"),
                            "targetUri": target_uri,
                        })
                        .to_string(),
                    ),
                ))
            })
            .collect()
    }

    async fn enumerate_attachment_chunks(
        &self,
    ) -> Result<Vec<RetrievalProjectionCandidate>, ServiceError> {
        let rows = sqlx::query(
            "SELECT c.chunk_id, c.parse_artifact_id, c.chunk_index, c.content_text,
                    c.page_number, c.sheet_name, c.metadata_json,
                    a.attachment_id, a.loom_id, a.file_name, a.updated_at
             FROM attachment_parse_artifact_chunks c
             JOIN attachments a ON a.parse_artifact_id = c.parse_artifact_id
             WHERE a.parse_status = 'ready'
             ORDER BY a.loom_id ASC, a.attachment_id ASC, c.chunk_index ASC, c.chunk_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to enumerate attachment chunk projections: {error}"
            ))
        })?;
        rows.into_iter()
            .map(|row| {
                let chunk_id: String = row.get("chunk_id");
                candidate(
                    "attachment_chunk",
                    &chunk_id,
                    format!("attachment_chunk:{chunk_id}"),
                    row.get("loom_id"),
                    None,
                    row.get("file_name"),
                    row.get("content_text"),
                    row.get("updated_at"),
                    Some(
                        json!({
                            "attachmentId": row.get::<String, _>("attachment_id"),
                            "parseArtifactId": row.get::<String, _>("parse_artifact_id"),
                            "chunkIndex": row.get::<i64, _>("chunk_index"),
                            "pageNumber": row.get::<Option<i64>, _>("page_number"),
                            "sheetName": row.get::<Option<String>, _>("sheet_name"),
                            "metadata": row.get::<Option<String>, _>("metadata_json"),
                        })
                        .to_string(),
                    ),
                )
            })
            .collect()
    }

    async fn enumerate_memory_chunks(
        &self,
    ) -> Result<Vec<RetrievalProjectionCandidate>, ServiceError> {
        let rows = sqlx::query(
            "SELECT memory_id, memory_type, content, source_loom_id,
                    source_response_id, updated_at, metadata_json
             FROM memories
             WHERE deleted_at IS NULL AND user_confirmed = 1
             ORDER BY source_loom_id ASC, updated_at ASC, memory_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to enumerate memory projections: {error}"))
        })?;
        rows.into_iter()
            .map(|row| {
                let memory_id: String = row.get("memory_id");
                candidate(
                    "memory",
                    &memory_id,
                    format!("memory:{memory_id}:content"),
                    row.get("source_loom_id"),
                    row.get("source_response_id"),
                    Some(row.get("memory_type")),
                    row.get("content"),
                    row.get("updated_at"),
                    Some(
                        json!({
                            "memoryType": row.get::<String, _>("memory_type"),
                            "metadata": row.get::<Option<String>, _>("metadata_json"),
                        })
                        .to_string(),
                    ),
                )
            })
            .collect()
    }

    async fn enumerate_response_capsule_chunks(
        &self,
    ) -> Result<Vec<RetrievalProjectionCandidate>, ServiceError> {
        let rows = sqlx::query(
            "SELECT capsule_id, response_id, loom_id, title, summary, key_points_json,
                    keywords_json, entities_json, canonical_uri, source_hash, updated_at
             FROM response_context_capsules
             WHERE status = 'ready'
             ORDER BY loom_id ASC, response_id ASC, capsule_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to enumerate response capsule projections: {error}"
            ))
        })?;
        rows.into_iter()
            .filter_map(|row| {
                let capsule_id: String = row.get("capsule_id");
                let body = [
                    row.get::<Option<String>, _>("summary"),
                    row.get::<Option<String>, _>("key_points_json"),
                    row.get::<Option<String>, _>("keywords_json"),
                    row.get::<Option<String>, _>("entities_json"),
                    row.get::<Option<String>, _>("canonical_uri"),
                ]
                .into_iter()
                .flatten()
                .filter(|value| !value.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
                if body.trim().is_empty() {
                    return None;
                }
                Some(candidate(
                    "response_capsule",
                    &capsule_id,
                    format!("response_capsule:{capsule_id}:summary"),
                    row.get("loom_id"),
                    row.get("response_id"),
                    row.get("title"),
                    body,
                    row.get("updated_at"),
                    Some(
                        json!({"sourceHash": row.get::<Option<String>, _>("source_hash")})
                            .to_string(),
                    ),
                ))
            })
            .collect()
    }

    async fn enumerate_checkpoint_chunks(
        &self,
    ) -> Result<Vec<RetrievalProjectionCandidate>, ServiceError> {
        let rows = sqlx::query(
            "SELECT checkpoint_id, loom_id, up_to_response_id, summary,
                    decisions_json, constraints_json, open_questions_json,
                    entities_json, wefts_json, references_json, source_hash, updated_at
             FROM loom_checkpoint_summaries
             WHERE status = 'ready'
             ORDER BY loom_id ASC, updated_at ASC, checkpoint_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to enumerate checkpoint projections: {error}"
            ))
        })?;
        rows.into_iter()
            .map(|row| {
                let checkpoint_id: String = row.get("checkpoint_id");
                let body = [
                    Some(row.get::<String, _>("summary")),
                    row.get::<Option<String>, _>("decisions_json"),
                    row.get::<Option<String>, _>("constraints_json"),
                    row.get::<Option<String>, _>("open_questions_json"),
                    row.get::<Option<String>, _>("entities_json"),
                    row.get::<Option<String>, _>("wefts_json"),
                    row.get::<Option<String>, _>("references_json"),
                ]
                .into_iter()
                .flatten()
                .filter(|value| !value.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
                candidate(
                    "checkpoint",
                    &checkpoint_id,
                    format!("checkpoint:{checkpoint_id}:summary"),
                    row.get("loom_id"),
                    row.get("up_to_response_id"),
                    Some("Loom checkpoint".to_string()),
                    body,
                    row.get("updated_at"),
                    Some(
                        json!({"sourceHash": row.get::<Option<String>, _>("source_hash")})
                            .to_string(),
                    ),
                )
            })
            .collect()
    }

    async fn upsert_candidate(
        &self,
        candidate: &RetrievalProjectionCandidate,
        indexed_at: &str,
    ) -> Result<(), ServiceError> {
        sqlx::query(
            "INSERT INTO retrieval_projection_sources (
                source_kind, source_id, projection_version, loom_id, response_id,
                source_digest, is_deleted, source_updated_at, indexed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)
             ON CONFLICT(source_kind, source_id, projection_version) DO UPDATE SET
                loom_id = excluded.loom_id,
                response_id = excluded.response_id,
                source_digest = excluded.source_digest,
                is_deleted = 0,
                source_updated_at = excluded.source_updated_at,
                indexed_at = excluded.indexed_at",
        )
        .bind(&candidate.identity.source_kind)
        .bind(&candidate.identity.source_id)
        .bind(&candidate.identity.projection_version)
        .bind(&candidate.loom_id)
        .bind(&candidate.response_id)
        .bind(&candidate.identity.content_digest)
        .bind(&candidate.source_updated_at)
        .bind(indexed_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to upsert retrieval projection source: {error}"
            ))
        })?;

        sqlx::query(
            "INSERT INTO retrieval_projection_chunks (
                source_kind, source_id, chunk_ref, projection_version, loom_id,
                response_id, content_digest, is_deleted, source_updated_at,
                indexed_at, metadata_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10)
             ON CONFLICT(source_kind, source_id, chunk_ref, projection_version) DO UPDATE SET
                loom_id = excluded.loom_id,
                response_id = excluded.response_id,
                content_digest = excluded.content_digest,
                is_deleted = 0,
                source_updated_at = excluded.source_updated_at,
                indexed_at = excluded.indexed_at,
                metadata_json = excluded.metadata_json",
        )
        .bind(&candidate.identity.source_kind)
        .bind(&candidate.identity.source_id)
        .bind(&candidate.identity.chunk_ref)
        .bind(&candidate.identity.projection_version)
        .bind(&candidate.loom_id)
        .bind(&candidate.response_id)
        .bind(&candidate.identity.content_digest)
        .bind(&candidate.source_updated_at)
        .bind(indexed_at)
        .bind(&candidate.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to upsert retrieval projection chunk: {error}"
            ))
        })?;
        Ok(())
    }

    async fn tombstone_chunk(
        &self,
        source_kind: &str,
        source_id: &str,
        chunk_ref: &str,
        projection_version: &str,
        indexed_at: &str,
    ) -> Result<(), ServiceError> {
        sqlx::query(
            "UPDATE retrieval_projection_chunks
             SET is_deleted = 1, indexed_at = ?5
             WHERE source_kind = ?1 AND source_id = ?2
               AND chunk_ref = ?3 AND projection_version = ?4",
        )
        .bind(source_kind)
        .bind(source_id)
        .bind(chunk_ref)
        .bind(projection_version)
        .bind(indexed_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to tombstone retrieval projection chunk: {error}"
            ))
        })?;
        sqlx::query(
            "UPDATE retrieval_projection_sources
             SET is_deleted = 1, indexed_at = ?4
             WHERE source_kind = ?1 AND source_id = ?2 AND projection_version = ?3
               AND NOT EXISTS (
                 SELECT 1 FROM retrieval_projection_chunks
                 WHERE source_kind = ?1 AND source_id = ?2 AND projection_version = ?3
                   AND is_deleted = 0
               )",
        )
        .bind(source_kind)
        .bind(source_id)
        .bind(projection_version)
        .bind(indexed_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to tombstone retrieval projection source: {error}"
            ))
        })?;
        Ok(())
    }
}

fn candidate(
    source_kind: &str,
    source_id: &str,
    chunk_ref: String,
    loom_id: Option<String>,
    response_id: Option<String>,
    title: Option<String>,
    content: String,
    source_updated_at: String,
    metadata_json: Option<String>,
) -> Result<RetrievalProjectionCandidate, ServiceError> {
    reject_projection_payload(Some(&content))?;
    reject_projection_payload(title.as_deref())?;
    reject_projection_payload(metadata_json.as_deref())?;
    Ok(RetrievalProjectionCandidate {
        identity: RetrievalProjectionIdentity {
            source_kind: source_kind.to_string(),
            source_id: source_id.to_string(),
            chunk_ref,
            content_digest: digest_text(&content),
            projection_version: RETRIEVAL_PROJECTION_VERSION.to_string(),
        },
        loom_id,
        response_id,
        title,
        content,
        source_updated_at,
        metadata_json,
    })
}

fn digest_text(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn reject_projection_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    for forbidden in FORBIDDEN_PROJECTION_TEXT {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "Retrieval projection payload contains forbidden marker {forbidden}"
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
    use super::{RetrievalProjectionRepository, RETRIEVAL_PROJECTION_VERSION};
    use crate::storage::db::{test_database, Database};
    use sqlx::Row;

    #[tokio::test]
    async fn stable_source_identity_and_chunk_refs_are_deterministic() {
        let database = test_database().await;
        seed_projection_sources(&database).await;
        let repository = RetrievalProjectionRepository::new(&database);
        let first = repository
            .enumerate_active_chunks()
            .await
            .expect("first enumeration");
        let second = repository
            .enumerate_active_chunks()
            .await
            .expect("second enumeration");
        assert_eq!(
            first
                .iter()
                .map(|candidate| candidate.identity.clone())
                .collect::<Vec<_>>(),
            second
                .iter()
                .map(|candidate| candidate.identity.clone())
                .collect::<Vec<_>>()
        );
        assert!(first.iter().any(|candidate| {
            candidate.identity.source_kind == "response"
                && candidate.identity.source_id == "resp-a"
                && candidate.identity.chunk_ref == "response:resp-a:content"
                && candidate.identity.projection_version == RETRIEVAL_PROJECTION_VERSION
        }));
        assert!(first.iter().any(|candidate| {
            candidate.identity.source_kind == "attachment_chunk"
                && candidate.identity.chunk_ref == "attachment_chunk:artifact-chunk-a"
        }));
    }

    #[tokio::test]
    async fn deterministic_projection_enumeration_includes_only_eligible_sources() {
        let database = test_database().await;
        seed_projection_sources(&database).await;
        seed_agent_audit_noise(&database).await;
        let repository = RetrievalProjectionRepository::new(&database);
        let candidates = repository
            .enumerate_active_chunks()
            .await
            .expect("enumerate");
        let kinds = candidates
            .iter()
            .map(|candidate| candidate.identity.source_kind.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            kinds,
            vec![
                "attachment_chunk",
                "checkpoint",
                "memory",
                "reference",
                "response",
                "response_capsule"
            ]
        );
        assert!(!kinds.contains(&"agent_event"));
    }

    #[tokio::test]
    async fn content_digest_changes_when_source_content_changes() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_response(&database, "resp-a", "loom-a", "first text", 0, 0).await;
        let repository = RetrievalProjectionRepository::new(&database);
        let first_digest = response_digest(&repository).await;
        sqlx::query(
            "UPDATE responses SET content = 'second text', updated_at = '2'
             WHERE response_id = 'resp-a'",
        )
        .execute(database.pool())
        .await
        .expect("update response");
        let second_digest = response_digest(&repository).await;
        assert_ne!(first_digest, second_digest);
    }

    #[tokio::test]
    async fn full_rebuild_plan_tracks_changed_and_tombstoned_chunks() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_response(&database, "resp-a", "loom-a", "projection text", 0, 0).await;
        let repository = RetrievalProjectionRepository::new(&database);
        let first = repository.plan_full_rebuild().await.expect("first plan");
        assert_eq!(first.active_chunks, 1);
        assert_eq!(first.changed_chunks, 1);
        assert_eq!(first.tombstoned_chunks, 0);
        let second = repository.plan_full_rebuild().await.expect("second plan");
        assert_eq!(second.changed_chunks, 0);
        sqlx::query("UPDATE responses SET is_deleted = 1 WHERE response_id = 'resp-a'")
            .execute(database.pool())
            .await
            .expect("soft delete");
        let third = repository.plan_full_rebuild().await.expect("third plan");
        assert_eq!(third.active_chunks, 0);
        assert_eq!(third.tombstoned_chunks, 1);
        let stored = repository
            .list_stored_chunks()
            .await
            .expect("stored chunks");
        assert_eq!(stored.len(), 1);
        assert!(stored[0].is_deleted);
    }

    #[tokio::test]
    async fn forbidden_projection_payloads_are_rejected() {
        let database = test_database().await;
        seed_loom(&database, "loom-a").await;
        seed_response(
            &database,
            "resp-a",
            "loom-a",
            "raw_thinking should never project",
            0,
            0,
        )
        .await;
        let repository = RetrievalProjectionRepository::new(&database);
        let error = repository
            .enumerate_active_chunks()
            .await
            .expect_err("forbidden payload rejected");
        assert!(error.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn migration_creates_projection_contract_tables() {
        let database = test_database().await;
        for table in [
            "retrieval_projection_sources",
            "retrieval_projection_chunks",
        ] {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            )
            .bind(table)
            .fetch_one(database.pool())
            .await
            .expect("table query");
            assert_eq!(count, 1, "{table} should exist");
        }
    }

    #[tokio::test]
    async fn no_embedding_provider_dependencies_are_introduced() {
        let cargo_lock = include_str!("../../../Cargo.lock");
        assert!(cargo_lock.contains("name = \"lancedb\""));
        assert!(!cargo_lock.contains("name = \"fastembed\""));
        assert!(!cargo_lock.contains("name = \"ollama-rs\""));
    }

    async fn response_digest(repository: &RetrievalProjectionRepository) -> String {
        repository
            .enumerate_active_chunks()
            .await
            .expect("enumerate")
            .into_iter()
            .find(|candidate| candidate.identity.source_id == "resp-a")
            .expect("response")
            .identity
            .content_digest
    }

    async fn seed_projection_sources(database: &Database) {
        seed_loom(database, "loom-a").await;
        seed_response(
            database,
            "resp-a",
            "loom-a",
            "Response projection content",
            0,
            0,
        )
        .await;
        seed_reference(database).await;
        seed_memory(database).await;
        seed_attachment_chunk(database).await;
        seed_response_capsule(database).await;
        seed_checkpoint(database).await;
        seed_response(database, "resp-deleted", "loom-a", "deleted content", 1, 9).await;
    }

    async fn seed_loom(database: &Database, loom_id: &str) {
        sqlx::query(
            "INSERT INTO looms (loom_id, title, created_at, updated_at)
             VALUES (?1, ?2, '1', '1')",
        )
        .bind(loom_id)
        .bind(loom_id)
        .execute(database.pool())
        .await
        .expect("seed loom");
    }

    async fn seed_response(
        database: &Database,
        response_id: &str,
        loom_id: &str,
        content: &str,
        is_deleted: i64,
        sequence_index: i64,
    ) {
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, created_at, updated_at,
                sequence_index, is_deleted
             ) VALUES (?1, ?2, 'assistant', ?3, 'Projection response', '1', '1', ?4, ?5)",
        )
        .bind(response_id)
        .bind(loom_id)
        .bind(content)
        .bind(sequence_index)
        .bind(is_deleted)
        .execute(database.pool())
        .await
        .expect("seed response");
    }

    async fn seed_reference(database: &Database) {
        sqlx::query(
            "INSERT INTO \"references\" (
                reference_id, source_loom_id, source_response_id, target_kind,
                target_id, selected_text, label, created_at
             ) VALUES (
                'ref-a', 'loom-a', 'resp-a', 'response',
                'resp-a', 'Selected reference content', 'Reference label', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed reference");
    }

    async fn seed_memory(database: &Database) {
        sqlx::query(
            "INSERT INTO memories (
                memory_id, memory_type, content, normalized_content, source_loom_id,
                source_response_id, user_confirmed, updated_at
             ) VALUES (
                'mem-a', 'explicit_user_memory', 'Memory projection content',
                'memory projection content', 'loom-a', 'resp-a', 1, '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed memory");
    }

    async fn seed_attachment_chunk(database: &Database) {
        sqlx::query(
            "INSERT INTO attachments (
                attachment_id, loom_id, file_name, mime_type, size_bytes, kind,
                parse_status, created_at, updated_at, parse_artifact_id
             ) VALUES (
                'att-a', 'loom-a', 'notes.txt', 'text/plain', 10, 'text',
                'ready', '1', '1', 'artifact-a'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed attachment");
        sqlx::query(
            "INSERT INTO attachment_parse_artifacts (
                parse_artifact_id, sha256, parser_kind, parser_version, kind,
                content_kind, content_text, char_count, created_at
             ) VALUES (
                'artifact-a', 'sha-a', 'test', '1', 'text',
                'text', 'Attachment projection content', 29, '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed parse artifact");
        sqlx::query(
            "INSERT INTO attachment_parse_artifact_chunks (
                chunk_id, parse_artifact_id, chunk_index, content_text,
                char_start, char_end, char_count, token_estimate, created_at
             ) VALUES (
                'artifact-chunk-a', 'artifact-a', 0, 'Attachment chunk projection content',
                0, 35, 35, 8, '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed artifact chunk");
    }

    async fn seed_response_capsule(database: &Database) {
        sqlx::query(
            "INSERT INTO response_context_capsules (
                capsule_id, response_id, loom_id, title, summary, status, created_at, updated_at
             ) VALUES (
                'capsule-a', 'resp-a', 'loom-a', 'Capsule title',
                'Response capsule projection content', 'ready', '1', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed capsule");
    }

    async fn seed_checkpoint(database: &Database) {
        sqlx::query(
            "INSERT INTO loom_checkpoint_summaries (
                checkpoint_id, loom_id, up_to_response_id, summary, status, created_at, updated_at
             ) VALUES (
                'checkpoint-a', 'loom-a', 'resp-a',
                'Checkpoint projection content', 'ready', '1', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed checkpoint");
    }

    async fn seed_agent_audit_noise(database: &Database) {
        sqlx::query(
            "INSERT INTO agent_runs (
                agent_run_id, loom_id, response_id, correlation_id, status, started_at, created_at
             ) VALUES (
                'agent-run-a', 'loom-a', 'resp-a', 'corr-a', 'completed', '1', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed agent run");
        sqlx::query(
            "INSERT INTO agent_events (
                agent_event_id, agent_run_id, sequence_number, event_type, payload_json, created_at
             ) VALUES (
                'agent-event-a', 'agent-run-a', 1, 'provider_delta',
                '{\"delta\":\"agent event text must not become knowledge\"}', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed agent event");
        let count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM agent_events")
            .fetch_one(database.pool())
            .await
            .expect("agent events count")
            .get("count");
        assert_eq!(count, 1);
    }
}
