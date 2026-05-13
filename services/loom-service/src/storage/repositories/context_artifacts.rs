#![allow(dead_code)]

use crate::{error::ServiceError, storage::db::Database};
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResponseCapsuleRecord {
    pub capsule_id: String,
    pub response_id: String,
    pub loom_id: String,
    pub response_code: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub key_points_json: Option<String>,
    pub keywords_json: Option<String>,
    pub entities_json: Option<String>,
    pub code_blocks_json: Option<String>,
    pub canonical_uri: Option<String>,
    pub source_hash: Option<String>,
    pub generator: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct UpsertResponseCapsule {
    pub capsule_id: String,
    pub response_id: String,
    pub loom_id: String,
    pub response_code: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub key_points_json: Option<String>,
    pub keywords_json: Option<String>,
    pub entities_json: Option<String>,
    pub code_blocks_json: Option<String>,
    pub canonical_uri: Option<String>,
    pub source_hash: Option<String>,
    pub generator: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoomCheckpointRecord {
    pub checkpoint_id: String,
    pub loom_id: String,
    pub up_to_response_id: Option<String>,
    pub summary: String,
    pub decisions_json: Option<String>,
    pub constraints_json: Option<String>,
    pub open_questions_json: Option<String>,
    pub entities_json: Option<String>,
    pub wefts_json: Option<String>,
    pub references_json: Option<String>,
    pub source_hash: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WeftOriginContextRecord {
    pub context_id: String,
    pub weft_loom_id: String,
    pub origin_loom_id: String,
    pub origin_response_id: String,
    pub origin_capsule_id: Option<String>,
    pub origin_summary: Option<String>,
    pub source_hash: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct UpsertWeftOriginContext {
    pub context_id: String,
    pub weft_loom_id: String,
    pub origin_loom_id: String,
    pub origin_response_id: String,
    pub origin_capsule_id: Option<String>,
    pub origin_summary: Option<String>,
    pub source_hash: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBuildJobRecord {
    pub job_id: String,
    pub job_type: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub status: String,
    pub priority: i64,
    pub error: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewContextBuildJob {
    pub job_id: String,
    pub job_type: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub status: String,
    pub priority: i64,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextArtifactEventRecord {
    pub event_id: String,
    pub artifact_type: String,
    pub artifact_id: String,
    pub event_type: String,
    pub payload_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewContextArtifactEvent {
    pub event_id: String,
    pub artifact_type: String,
    pub artifact_id: String,
    pub event_type: String,
    pub payload_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct UpsertLoomCheckpoint {
    pub checkpoint_id: String,
    pub loom_id: String,
    pub up_to_response_id: Option<String>,
    pub summary: String,
    pub decisions_json: Option<String>,
    pub constraints_json: Option<String>,
    pub open_questions_json: Option<String>,
    pub entities_json: Option<String>,
    pub wefts_json: Option<String>,
    pub references_json: Option<String>,
    pub source_hash: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ContextArtifactsRepository {
    pool: SqlitePool,
}

impl ContextArtifactsRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub(crate) fn pool(&self) -> SqlitePool {
        self.pool.clone()
    }

    pub async fn upsert_response_capsule(
        &self,
        capsule: &UpsertResponseCapsule,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(
            &serde_json::to_string(&serde_json::json!({
                "title": capsule.title,
                "summary": capsule.summary,
                "keyPoints": capsule.key_points_json,
                "keywords": capsule.keywords_json,
                "entities": capsule.entities_json,
                "codeBlocks": capsule.code_blocks_json,
                "generator": capsule.generator,
            }))
            .map_err(|error| {
                ServiceError::storage(format!("failed to inspect capsule payload: {error}"))
            })?,
        )?;
        sqlx::query(
            "INSERT INTO response_context_capsules (
                capsule_id, response_id, loom_id, response_code, title, summary,
                key_points_json, keywords_json, entities_json, code_blocks_json,
                canonical_uri, source_hash, generator, status, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ON CONFLICT(capsule_id) DO UPDATE SET
                response_id = excluded.response_id,
                loom_id = excluded.loom_id,
                response_code = excluded.response_code,
                title = excluded.title,
                summary = excluded.summary,
                key_points_json = excluded.key_points_json,
                keywords_json = excluded.keywords_json,
                entities_json = excluded.entities_json,
                code_blocks_json = excluded.code_blocks_json,
                canonical_uri = excluded.canonical_uri,
                source_hash = excluded.source_hash,
                generator = excluded.generator,
                status = excluded.status,
                updated_at = excluded.updated_at",
        )
        .bind(&capsule.capsule_id)
        .bind(&capsule.response_id)
        .bind(&capsule.loom_id)
        .bind(&capsule.response_code)
        .bind(&capsule.title)
        .bind(&capsule.summary)
        .bind(&capsule.key_points_json)
        .bind(&capsule.keywords_json)
        .bind(&capsule.entities_json)
        .bind(&capsule.code_blocks_json)
        .bind(&capsule.canonical_uri)
        .bind(&capsule.source_hash)
        .bind(&capsule.generator)
        .bind(&capsule.status)
        .bind(&capsule.created_at)
        .bind(&capsule.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to upsert Response capsule: {error}"))
        })?;

        Ok(())
    }

    pub async fn get_response_capsule(
        &self,
        response_id: &str,
    ) -> Result<Option<ResponseCapsuleRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM response_context_capsules WHERE response_id = ?1 ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(response_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(response_capsule_from_row))
        .map_err(|error| {
            ServiceError::storage(format!("failed to get Response capsule: {error}"))
        })
    }

    pub async fn upsert_loom_checkpoint(
        &self,
        checkpoint: &UpsertLoomCheckpoint,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(
            &serde_json::to_string(&serde_json::json!({
                "summary": checkpoint.summary,
                "decisions": checkpoint.decisions_json,
                "constraints": checkpoint.constraints_json,
                "openQuestions": checkpoint.open_questions_json,
                "entities": checkpoint.entities_json,
                "wefts": checkpoint.wefts_json,
                "references": checkpoint.references_json,
            }))
            .map_err(|error| {
                ServiceError::storage(format!("failed to inspect checkpoint payload: {error}"))
            })?,
        )?;
        sqlx::query(
            "INSERT INTO loom_checkpoint_summaries (
                checkpoint_id, loom_id, up_to_response_id, summary, decisions_json,
                constraints_json, open_questions_json, entities_json, wefts_json,
                references_json, source_hash, status, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(checkpoint_id) DO UPDATE SET
                loom_id = excluded.loom_id,
                up_to_response_id = excluded.up_to_response_id,
                summary = excluded.summary,
                decisions_json = excluded.decisions_json,
                constraints_json = excluded.constraints_json,
                open_questions_json = excluded.open_questions_json,
                entities_json = excluded.entities_json,
                wefts_json = excluded.wefts_json,
                references_json = excluded.references_json,
                source_hash = excluded.source_hash,
                status = excluded.status,
                updated_at = excluded.updated_at",
        )
        .bind(&checkpoint.checkpoint_id)
        .bind(&checkpoint.loom_id)
        .bind(&checkpoint.up_to_response_id)
        .bind(&checkpoint.summary)
        .bind(&checkpoint.decisions_json)
        .bind(&checkpoint.constraints_json)
        .bind(&checkpoint.open_questions_json)
        .bind(&checkpoint.entities_json)
        .bind(&checkpoint.wefts_json)
        .bind(&checkpoint.references_json)
        .bind(&checkpoint.source_hash)
        .bind(&checkpoint.status)
        .bind(&checkpoint.created_at)
        .bind(&checkpoint.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to upsert Loom checkpoint: {error}"))
        })?;

        Ok(())
    }

    pub async fn get_latest_checkpoint_for_loom(
        &self,
        loom_id: &str,
    ) -> Result<Option<LoomCheckpointRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM loom_checkpoint_summaries
             WHERE loom_id = ?1
             ORDER BY updated_at DESC, created_at DESC
             LIMIT 1",
        )
        .bind(loom_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(loom_checkpoint_from_row))
        .map_err(|error| {
            ServiceError::storage(format!("failed to get latest Loom checkpoint: {error}"))
        })
    }

    pub async fn upsert_weft_origin_context(
        &self,
        context: &UpsertWeftOriginContext,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(
            &serde_json::to_string(&serde_json::json!({
                "originSummary": context.origin_summary,
            }))
            .map_err(|error| {
                ServiceError::storage(format!("failed to inspect Weft origin payload: {error}"))
            })?,
        )?;
        sqlx::query(
            "INSERT INTO weft_origin_contexts (
                context_id, weft_loom_id, origin_loom_id, origin_response_id,
                origin_capsule_id, origin_summary, source_hash, status, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(context_id) DO UPDATE SET
                weft_loom_id = excluded.weft_loom_id,
                origin_loom_id = excluded.origin_loom_id,
                origin_response_id = excluded.origin_response_id,
                origin_capsule_id = excluded.origin_capsule_id,
                origin_summary = excluded.origin_summary,
                source_hash = excluded.source_hash,
                status = excluded.status,
                updated_at = excluded.updated_at",
        )
        .bind(&context.context_id)
        .bind(&context.weft_loom_id)
        .bind(&context.origin_loom_id)
        .bind(&context.origin_response_id)
        .bind(&context.origin_capsule_id)
        .bind(&context.origin_summary)
        .bind(&context.source_hash)
        .bind(&context.status)
        .bind(&context.created_at)
        .bind(&context.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to upsert Weft origin context: {error}"))
        })?;

        Ok(())
    }

    pub async fn get_weft_origin_context(
        &self,
        weft_loom_id: &str,
    ) -> Result<Option<WeftOriginContextRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM weft_origin_contexts
             WHERE weft_loom_id = ?1
             ORDER BY updated_at DESC, created_at DESC
             LIMIT 1",
        )
        .bind(weft_loom_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(weft_origin_context_from_row))
        .map_err(|error| {
            ServiceError::storage(format!("failed to get Weft origin context: {error}"))
        })
    }

    pub async fn insert_job(&self, job: &NewContextBuildJob) -> Result<(), ServiceError> {
        sqlx::query(
            "INSERT INTO context_build_jobs (
                job_id, job_type, loom_id, response_id, status, priority, error, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&job.job_id)
        .bind(&job.job_type)
        .bind(&job.loom_id)
        .bind(&job.response_id)
        .bind(&job.status)
        .bind(job.priority)
        .bind(&job.error)
        .bind(&job.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to insert context job: {error}")))?;

        Ok(())
    }

    pub async fn get_job(
        &self,
        job_id: &str,
    ) -> Result<Option<ContextBuildJobRecord>, ServiceError> {
        sqlx::query("SELECT * FROM context_build_jobs WHERE job_id = ?1 LIMIT 1")
            .bind(job_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(context_build_job_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get context job: {error}")))
    }

    pub async fn find_pending_job(
        &self,
        job_type: &str,
        loom_id: Option<&str>,
        response_id: Option<&str>,
    ) -> Result<Option<ContextBuildJobRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM context_build_jobs
             WHERE job_type = ?1
               AND status IN ('pending', 'running')
               AND (?2 IS NULL OR loom_id = ?2)
               AND (?3 IS NULL OR response_id = ?3)
             ORDER BY priority DESC, created_at ASC
             LIMIT 1",
        )
        .bind(job_type)
        .bind(loom_id)
        .bind(response_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(context_build_job_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to find context job: {error}")))
    }

    pub async fn update_job_status(
        &self,
        job_id: &str,
        status: &str,
        error: Option<&str>,
        timestamp: &str,
    ) -> Result<(), ServiceError> {
        let (started_at, finished_at) = match status {
            "running" => (Some(timestamp), None),
            "completed" | "failed" | "cancelled" => (None, Some(timestamp)),
            _ => (None, None),
        };

        sqlx::query(
            "UPDATE context_build_jobs
             SET status = ?2,
                 error = ?3,
                 started_at = COALESCE(?4, started_at),
                 finished_at = COALESCE(?5, finished_at)
             WHERE job_id = ?1",
        )
        .bind(job_id)
        .bind(status)
        .bind(error)
        .bind(started_at)
        .bind(finished_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to update context job status: {error}"))
        })?;

        Ok(())
    }

    pub async fn list_jobs_by_status(
        &self,
        status: &str,
    ) -> Result<Vec<ContextBuildJobRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM context_build_jobs
             WHERE status = ?1
             ORDER BY priority DESC, created_at ASC",
        )
        .bind(status)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(context_build_job_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list context jobs: {error}")))
    }

    pub async fn list_jobs(
        &self,
        status: Option<&str>,
    ) -> Result<Vec<ContextBuildJobRecord>, ServiceError> {
        let query = match status {
            Some(_) => {
                "SELECT * FROM context_build_jobs
                 WHERE status = ?1
                 ORDER BY priority DESC, created_at ASC"
            }
            None => {
                "SELECT * FROM context_build_jobs
                 ORDER BY created_at ASC"
            }
        };
        let mut sql = sqlx::query(query);
        if let Some(status) = status {
            sql = sql.bind(status);
        }
        sql.fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(context_build_job_from_row).collect())
            .map_err(|error| ServiceError::storage(format!("failed to list context jobs: {error}")))
    }

    pub async fn find_next_pending_job(
        &self,
    ) -> Result<Option<ContextBuildJobRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM context_build_jobs
             WHERE status = 'pending'
             ORDER BY priority DESC, created_at ASC
             LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(context_build_job_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to find next context job: {error}")))
    }

    pub async fn insert_event(&self, event: &NewContextArtifactEvent) -> Result<(), ServiceError> {
        if let Some(payload) = &event.payload_json {
            reject_forbidden_payload(payload)?;
        }

        sqlx::query(
            "INSERT INTO context_artifact_events (
                event_id, artifact_type, artifact_id, event_type, payload_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&event.event_id)
        .bind(&event.artifact_type)
        .bind(&event.artifact_id)
        .bind(&event.event_type)
        .bind(&event.payload_json)
        .bind(&event.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert context artifact event: {error}"))
        })?;

        Ok(())
    }

    pub async fn list_events_for_artifact(
        &self,
        artifact_type: &str,
        artifact_id: &str,
    ) -> Result<Vec<ContextArtifactEventRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM context_artifact_events
             WHERE artifact_type = ?1 AND artifact_id = ?2
             ORDER BY created_at ASC",
        )
        .bind(artifact_type)
        .bind(artifact_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(context_artifact_event_from_row)
                .collect()
        })
        .map_err(|error| {
            ServiceError::storage(format!("failed to list context artifact events: {error}"))
        })
    }
}

fn response_capsule_from_row(row: sqlx::sqlite::SqliteRow) -> ResponseCapsuleRecord {
    ResponseCapsuleRecord {
        capsule_id: row.get("capsule_id"),
        response_id: row.get("response_id"),
        loom_id: row.get("loom_id"),
        response_code: row.get("response_code"),
        title: row.get("title"),
        summary: row.get("summary"),
        key_points_json: row.get("key_points_json"),
        keywords_json: row.get("keywords_json"),
        entities_json: row.get("entities_json"),
        code_blocks_json: row.get("code_blocks_json"),
        canonical_uri: row.get("canonical_uri"),
        source_hash: row.get("source_hash"),
        generator: row.get("generator"),
        status: row.get("status"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn loom_checkpoint_from_row(row: sqlx::sqlite::SqliteRow) -> LoomCheckpointRecord {
    LoomCheckpointRecord {
        checkpoint_id: row.get("checkpoint_id"),
        loom_id: row.get("loom_id"),
        up_to_response_id: row.get("up_to_response_id"),
        summary: row.get("summary"),
        decisions_json: row.get("decisions_json"),
        constraints_json: row.get("constraints_json"),
        open_questions_json: row.get("open_questions_json"),
        entities_json: row.get("entities_json"),
        wefts_json: row.get("wefts_json"),
        references_json: row.get("references_json"),
        source_hash: row.get("source_hash"),
        status: row.get("status"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn weft_origin_context_from_row(row: sqlx::sqlite::SqliteRow) -> WeftOriginContextRecord {
    WeftOriginContextRecord {
        context_id: row.get("context_id"),
        weft_loom_id: row.get("weft_loom_id"),
        origin_loom_id: row.get("origin_loom_id"),
        origin_response_id: row.get("origin_response_id"),
        origin_capsule_id: row.get("origin_capsule_id"),
        origin_summary: row.get("origin_summary"),
        source_hash: row.get("source_hash"),
        status: row.get("status"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn context_build_job_from_row(row: sqlx::sqlite::SqliteRow) -> ContextBuildJobRecord {
    ContextBuildJobRecord {
        job_id: row.get("job_id"),
        job_type: row.get("job_type"),
        loom_id: row.get("loom_id"),
        response_id: row.get("response_id"),
        status: row.get("status"),
        priority: row.get("priority"),
        error: row.get("error"),
        created_at: row.get("created_at"),
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
    }
}

fn context_artifact_event_from_row(row: sqlx::sqlite::SqliteRow) -> ContextArtifactEventRecord {
    ContextArtifactEventRecord {
        event_id: row.get("event_id"),
        artifact_type: row.get("artifact_type"),
        artifact_id: row.get("artifact_id"),
        event_type: row.get("event_type"),
        payload_json: row.get("payload_json"),
        created_at: row.get("created_at"),
    }
}

fn reject_forbidden_payload(payload: &str) -> Result<(), ServiceError> {
    for forbidden in [
        "raw_thinking",
        "thinking_text",
        "chain_of_thought",
        "hidden_reasoning",
    ] {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "context artifact event payload contains forbidden key {forbidden}"
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ContextArtifactsRepository, UpsertLoomCheckpoint, UpsertResponseCapsule,
        UpsertWeftOriginContext,
    };
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn upsert_and_get_response_capsule() {
        let database = test_database().await;
        let repository = ContextArtifactsRepository::new(&database);

        repository
            .upsert_response_capsule(&UpsertResponseCapsule {
                capsule_id: "capsule-1".to_string(),
                response_id: "response-1".to_string(),
                loom_id: "loom-1".to_string(),
                response_code: Some("R-TEST".to_string()),
                title: Some("Capsule title".to_string()),
                summary: Some("Capsule summary".to_string()),
                key_points_json: Some("[\"point\"]".to_string()),
                keywords_json: None,
                entities_json: None,
                code_blocks_json: None,
                canonical_uri: None,
                source_hash: Some("hash".to_string()),
                generator: Some("heuristic".to_string()),
                status: "ready".to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:00Z".to_string(),
            })
            .await
            .expect("upsert capsule");

        let found = repository
            .get_response_capsule("response-1")
            .await
            .expect("get capsule")
            .expect("capsule exists");
        assert_eq!(found.status, "ready");
        assert_eq!(found.summary.as_deref(), Some("Capsule summary"));
    }

    #[tokio::test]
    async fn upsert_and_get_latest_loom_checkpoint() {
        let database = test_database().await;
        let repository = ContextArtifactsRepository::new(&database);

        repository
            .upsert_loom_checkpoint(&UpsertLoomCheckpoint {
                checkpoint_id: "checkpoint-1".to_string(),
                loom_id: "loom-1".to_string(),
                up_to_response_id: Some("response-1".to_string()),
                summary: "Checkpoint summary".to_string(),
                decisions_json: Some("[]".to_string()),
                constraints_json: None,
                open_questions_json: None,
                entities_json: None,
                wefts_json: None,
                references_json: None,
                source_hash: Some("hash".to_string()),
                status: "ready".to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
            })
            .await
            .expect("upsert checkpoint");

        let found = repository
            .get_latest_checkpoint_for_loom("loom-1")
            .await
            .expect("get latest checkpoint")
            .expect("checkpoint exists");
        assert_eq!(found.summary, "Checkpoint summary");
        assert_eq!(found.status, "ready");
    }

    #[tokio::test]
    async fn upsert_and_get_weft_origin_context() {
        let database = test_database().await;
        let repository = ContextArtifactsRepository::new(&database);

        repository
            .upsert_weft_origin_context(&UpsertWeftOriginContext {
                context_id: "origin-1".to_string(),
                weft_loom_id: "weft-1".to_string(),
                origin_loom_id: "loom-1".to_string(),
                origin_response_id: "response-1".to_string(),
                origin_capsule_id: Some("capsule-1".to_string()),
                origin_summary: Some("Origin summary".to_string()),
                source_hash: Some("hash".to_string()),
                status: "ready".to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
            })
            .await
            .expect("upsert origin");

        let found = repository
            .get_weft_origin_context("weft-1")
            .await
            .expect("get origin")
            .expect("origin exists");
        assert_eq!(found.origin_summary.as_deref(), Some("Origin summary"));
    }

    #[tokio::test]
    async fn context_build_job_lifecycle() {
        let database = test_database().await;
        let repository = ContextArtifactsRepository::new(&database);

        repository
            .insert_job(&super::NewContextBuildJob {
                job_id: "job-1".to_string(),
                job_type: "response_capsule".to_string(),
                loom_id: Some("loom-1".to_string()),
                response_id: Some("response-1".to_string()),
                status: "pending".to_string(),
                priority: 100,
                error: None,
                created_at: "2026-05-08T00:00:00Z".to_string(),
            })
            .await
            .expect("insert job");

        let pending = repository
            .find_pending_job("response_capsule", Some("loom-1"), Some("response-1"))
            .await
            .expect("find job")
            .expect("pending exists");
        assert_eq!(pending.job_id, "job-1");

        repository
            .update_job_status("job-1", "completed", None, "2026-05-08T00:00:01Z")
            .await
            .expect("complete job");
        let found = repository
            .get_job("job-1")
            .await
            .expect("get job")
            .expect("job exists");
        assert_eq!(found.status, "completed");
    }

    #[tokio::test]
    async fn context_artifact_events_reject_raw_thinking_payload() {
        let database = test_database().await;
        let repository = ContextArtifactsRepository::new(&database);

        let error = repository
            .insert_event(&super::NewContextArtifactEvent {
                event_id: "event-1".to_string(),
                artifact_type: "response_capsule".to_string(),
                artifact_id: "capsule-1".to_string(),
                event_type: "artifact.required".to_string(),
                payload_json: Some("{\"raw_thinking\":\"secret\"}".to_string()),
                created_at: "2026-05-08T00:00:00Z".to_string(),
            })
            .await
            .expect_err("payload should be rejected");

        assert!(error.to_string().contains("forbidden key"));
    }
}
