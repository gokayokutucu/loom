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
pub struct ResponseRecord {
    pub response_id: String,
    pub loom_id: String,
    pub role: String,
    pub content: String,
    pub title: Option<String>,
    pub code: Option<String>,
    pub canonical_uri: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub sequence_index: i64,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewResponse {
    pub response_id: String,
    pub loom_id: String,
    pub role: String,
    pub content: String,
    pub title: Option<String>,
    pub code: Option<String>,
    pub canonical_uri: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub sequence_index: i64,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResponseRepository {
    pool: SqlitePool,
}

impl ResponseRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_response(&self, response: &NewResponse) -> Result<(), ServiceError> {
        reject_forbidden_payload(response.metadata_json.as_deref())?;
        reject_forbidden_payload(Some(&response.content))?;
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, code, canonical_uri,
                created_at, updated_at, sequence_index, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind(&response.response_id)
        .bind(&response.loom_id)
        .bind(&response.role)
        .bind(&response.content)
        .bind(&response.title)
        .bind(&response.code)
        .bind(&response.canonical_uri)
        .bind(&response.created_at)
        .bind(&response.updated_at)
        .bind(response.sequence_index)
        .bind(&response.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to insert Response: {error}")))?;

        sync_derived_artifacts_for_response(&self.pool, response).await?;

        Ok(())
    }

    pub async fn insert_response_if_missing(
        &self,
        response: &NewResponse,
    ) -> Result<bool, ServiceError> {
        reject_forbidden_payload(response.metadata_json.as_deref())?;
        reject_forbidden_payload(Some(&response.content))?;
        let result = sqlx::query(
            "INSERT OR IGNORE INTO responses (
                response_id, loom_id, role, content, title, code, canonical_uri,
                created_at, updated_at, sequence_index, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind(&response.response_id)
        .bind(&response.loom_id)
        .bind(&response.role)
        .bind(&response.content)
        .bind(&response.title)
        .bind(&response.code)
        .bind(&response.canonical_uri)
        .bind(&response.created_at)
        .bind(&response.updated_at)
        .bind(response.sequence_index)
        .bind(&response.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to seed Response: {error}")))?;

        let inserted = result.rows_affected() > 0;
        if inserted {
            sync_derived_artifacts_for_response(&self.pool, response).await?;
        }

        Ok(inserted)
    }

    pub async fn insert_response_pair(
        &self,
        user_response: &NewResponse,
        assistant_response: &NewResponse,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(user_response.metadata_json.as_deref())?;
        reject_forbidden_payload(assistant_response.metadata_json.as_deref())?;
        reject_forbidden_payload(Some(&user_response.content))?;
        reject_forbidden_payload(Some(&assistant_response.content))?;

        let mut transaction = self.pool.begin().await.map_err(|error| {
            ServiceError::storage(format!("failed to start response transaction: {error}"))
        })?;

        insert_response_with_executor(&mut transaction, user_response).await?;
        insert_response_with_executor(&mut transaction, assistant_response).await?;

        transaction.commit().await.map_err(|error| {
            ServiceError::storage(format!("failed to commit response transaction: {error}"))
        })?;

        sync_derived_artifacts_for_response(&self.pool, user_response).await?;
        sync_derived_artifacts_for_response(&self.pool, assistant_response).await?;

        Ok(())
    }

    pub async fn insert_response_pair_at_next_sequence(
        &self,
        mut user_response: NewResponse,
        mut assistant_response: NewResponse,
    ) -> Result<(i64, i64), ServiceError> {
        reject_forbidden_payload(user_response.metadata_json.as_deref())?;
        reject_forbidden_payload(assistant_response.metadata_json.as_deref())?;
        reject_forbidden_payload(Some(&user_response.content))?;
        reject_forbidden_payload(Some(&assistant_response.content))?;
        if user_response.loom_id != assistant_response.loom_id {
            return Err(ServiceError::storage(
                "Response pair must target the same Loom",
            ));
        }

        let mut transaction = self.pool.begin().await.map_err(|error| {
            ServiceError::storage(format!("failed to start response transaction: {error}"))
        })?;
        let next_sequence_index: i64 = sqlx::query(
            "SELECT COALESCE(MAX(sequence_index), -1) + 1 AS next_index
             FROM responses
             WHERE loom_id = ?1",
        )
        .bind(&user_response.loom_id)
        .fetch_one(&mut transaction)
        .await
        .map(|row| row.get("next_index"))
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to get next Response sequence index: {error}"
            ))
        })?;

        user_response.sequence_index = next_sequence_index;
        assistant_response.sequence_index = next_sequence_index + 1;
        insert_response_with_executor(&mut transaction, &user_response).await?;
        insert_response_with_executor(&mut transaction, &assistant_response).await?;

        transaction.commit().await.map_err(|error| {
            ServiceError::storage(format!("failed to commit response transaction: {error}"))
        })?;

        sync_derived_artifacts_for_response(&self.pool, &user_response).await?;
        sync_derived_artifacts_for_response(&self.pool, &assistant_response).await?;

        Ok((next_sequence_index, next_sequence_index + 1))
    }

    pub async fn get_next_sequence_index(&self, loom_id: &str) -> Result<i64, ServiceError> {
        sqlx::query("SELECT COALESCE(MAX(sequence_index), -1) + 1 AS next_index FROM responses WHERE loom_id = ?1")
            .bind(loom_id)
            .fetch_one(&self.pool)
            .await
            .map(|row| row.get("next_index"))
            .map_err(|error| {
                ServiceError::storage(format!("failed to get next Response sequence index: {error}"))
            })
    }

    pub async fn update_response_content(
        &self,
        response_id: &str,
        content: &str,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(Some(content))?;
        sqlx::query(
            "UPDATE responses
             SET content = ?2,
                 updated_at = ?3
             WHERE response_id = ?1",
        )
        .bind(response_id)
        .bind(content)
        .bind(timestamp())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to update Response content: {error}"))
        })?;

        if let Some(response) = self.get_response(response_id).await? {
            sync_derived_artifacts_for_record(
                &self.pool,
                &response.response_id,
                &response.loom_id,
                &response.content,
            )
            .await?;
        }

        Ok(())
    }

    pub async fn update_response_content_and_metadata(
        &self,
        response_id: &str,
        content: Option<&str>,
        metadata_json: &str,
        updated_at: &str,
    ) -> Result<(), ServiceError> {
        if let Some(content) = content {
            reject_forbidden_payload(Some(content))?;
        }
        reject_forbidden_payload(Some(metadata_json))?;
        sqlx::query(
            "UPDATE responses
             SET content = COALESCE(?2, content),
                 metadata_json = ?3,
                 updated_at = ?4
             WHERE response_id = ?1",
        )
        .bind(response_id)
        .bind(content)
        .bind(metadata_json)
        .bind(updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to update Response: {error}")))?;

        if content.is_some() {
            if let Some(response) = self.get_response(response_id).await? {
                sync_derived_artifacts_for_record(
                    &self.pool,
                    &response.response_id,
                    &response.loom_id,
                    &response.content,
                )
                .await?;
            }
        }

        Ok(())
    }

    pub async fn update_response_metadata(
        &self,
        response_id: &str,
        metadata_json: &str,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(Some(metadata_json))?;
        sqlx::query(
            "UPDATE responses
             SET metadata_json = ?2,
                 updated_at = ?3
             WHERE response_id = ?1",
        )
        .bind(response_id)
        .bind(metadata_json)
        .bind(timestamp())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to update Response metadata: {error}"))
        })?;

        if let Some(response) = self.get_response(response_id).await? {
            sync_derived_artifacts_for_record(
                &self.pool,
                &response.response_id,
                &response.loom_id,
                &response.content,
            )
            .await?;
        }

        Ok(())
    }

    pub async fn update_response_status(
        &self,
        response_id: &str,
        status: &str,
        done_reason: Option<&str>,
        error_kind: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<(), ServiceError> {
        let response = self
            .get_response(response_id)
            .await?
            .ok_or_else(|| ServiceError::storage("Response not found"))?;
        let metadata = response_status_metadata(
            response.metadata_json.as_deref(),
            status,
            done_reason,
            error_kind,
            error_message,
        )?;
        self.update_response_metadata(response_id, &metadata).await
    }

    pub async fn list_responses_for_loom(
        &self,
        loom_id: &str,
    ) -> Result<Vec<ResponseRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM responses
             WHERE loom_id = ?1 AND is_deleted = 0
             ORDER BY sequence_index ASC",
        )
        .bind(loom_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(response_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list Responses for Loom: {error}"))
        })
    }

    pub async fn get_response(
        &self,
        response_id: &str,
    ) -> Result<Option<ResponseRecord>, ServiceError> {
        sqlx::query("SELECT * FROM responses WHERE response_id = ?1 LIMIT 1")
            .bind(response_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(response_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get Response: {error}")))
    }

    pub async fn next_assistant_after(
        &self,
        loom_id: &str,
        sequence_index: i64,
    ) -> Result<Option<ResponseRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM responses
             WHERE loom_id = ?1
               AND role = 'assistant'
               AND is_deleted = 0
               AND sequence_index > ?2
             ORDER BY sequence_index ASC
             LIMIT 1",
        )
        .bind(loom_id)
        .bind(sequence_index)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(response_from_row))
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to get downstream assistant Response: {error}"
            ))
        })
    }

    pub async fn is_response_deleted(&self, response_id: &str) -> Result<bool, ServiceError> {
        sqlx::query("SELECT is_deleted FROM responses WHERE response_id = ?1 LIMIT 1")
            .bind(response_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| {
                row.map(|row| row.get::<i64, _>("is_deleted") != 0)
                    .unwrap_or(false)
            })
            .map_err(|error| {
                ServiceError::storage(format!(
                    "failed to inspect Response deletion state: {error}"
                ))
            })
    }

    pub async fn soft_delete_responses_after(
        &self,
        loom_id: &str,
        sequence_index: i64,
        reason: &str,
        deleted_by_response_id: &str,
    ) -> Result<Vec<ResponseRecord>, ServiceError> {
        let deleted_at = timestamp();
        let rows = sqlx::query(
            "SELECT * FROM responses
             WHERE loom_id = ?1
               AND sequence_index > ?2
               AND is_deleted = 0
             ORDER BY sequence_index ASC",
        )
        .bind(loom_id)
        .bind(sequence_index)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to list downstream Responses: {error}"))
        })?;
        let deleted = rows.into_iter().map(response_from_row).collect::<Vec<_>>();
        if deleted.is_empty() {
            return Ok(deleted);
        }

        sqlx::query(
            "UPDATE responses
             SET is_deleted = 1,
                 deleted_at = ?3,
                 deleted_reason = ?4,
                 deleted_by_response_id = ?5,
                 updated_at = ?3
             WHERE loom_id = ?1
               AND sequence_index > ?2
               AND is_deleted = 0",
        )
        .bind(loom_id)
        .bind(sequence_index)
        .bind(deleted_at)
        .bind(reason)
        .bind(deleted_by_response_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to soft-delete downstream Responses: {error}"
            ))
        })?;

        Ok(deleted)
    }

    pub async fn insert_response_pairs_if_missing_at_next_sequence(
        &self,
        pairs: Vec<(NewResponse, NewResponse)>,
    ) -> Result<Vec<(ResponseRecord, ResponseRecord)>, ServiceError> {
        for (user_response, assistant_response) in &pairs {
            reject_forbidden_payload(user_response.metadata_json.as_deref())?;
            reject_forbidden_payload(assistant_response.metadata_json.as_deref())?;
            reject_forbidden_payload(Some(&user_response.content))?;
            reject_forbidden_payload(Some(&assistant_response.content))?;
            if user_response.loom_id != assistant_response.loom_id {
                return Err(ServiceError::storage(
                    "Response pair must target the same Loom",
                ));
            }
        }

        let mut transaction = self.pool.begin().await.map_err(|error| {
            ServiceError::storage(format!("failed to start response transaction: {error}"))
        })?;
        let mut persisted = Vec::with_capacity(pairs.len());

        for (mut user_response, mut assistant_response) in pairs {
            let existing_user =
                response_by_id_with_executor(&mut transaction, &user_response.response_id).await?;
            let existing_assistant =
                response_by_id_with_executor(&mut transaction, &assistant_response.response_id)
                    .await?;
            match (existing_user, existing_assistant) {
                (Some(user), Some(assistant)) => {
                    persisted.push((user, assistant));
                    continue;
                }
                (None, None) => {}
                _ => {
                    return Err(ServiceError::storage(
                        "partial existing Response pair found for idempotency key",
                    ));
                }
            }

            let next_sequence_index: i64 = sqlx::query(
                "SELECT COALESCE(MAX(sequence_index), -1) + 1 AS next_index
                 FROM responses
                 WHERE loom_id = ?1",
            )
            .bind(&user_response.loom_id)
            .fetch_one(&mut transaction)
            .await
            .map(|row| row.get("next_index"))
            .map_err(|error| {
                ServiceError::storage(format!(
                    "failed to get next Response sequence index: {error}"
                ))
            })?;

            user_response.sequence_index = next_sequence_index;
            assistant_response.sequence_index = next_sequence_index + 1;
            insert_response_with_executor(&mut transaction, &user_response).await?;
            insert_response_with_executor(&mut transaction, &assistant_response).await?;

            let user = response_by_id_with_executor(&mut transaction, &user_response.response_id)
                .await?
                .ok_or_else(|| ServiceError::storage("inserted user Response was not found"))?;
            let assistant =
                response_by_id_with_executor(&mut transaction, &assistant_response.response_id)
                    .await?
                    .ok_or_else(|| {
                        ServiceError::storage("inserted assistant Response was not found")
                    })?;
            persisted.push((user, assistant));
        }

        transaction.commit().await.map_err(|error| {
            ServiceError::storage(format!("failed to commit response transaction: {error}"))
        })?;

        for (user, assistant) in &persisted {
            sync_derived_artifacts_for_record(
                &self.pool,
                &user.response_id,
                &user.loom_id,
                &user.content,
            )
            .await?;
            sync_derived_artifacts_for_record(
                &self.pool,
                &assistant.response_id,
                &assistant.loom_id,
                &assistant.content,
            )
            .await?;
        }

        Ok(persisted)
    }

    pub async fn insert_responses_if_missing_at_next_sequence(
        &self,
        responses: Vec<NewResponse>,
    ) -> Result<Vec<ResponseRecord>, ServiceError> {
        for response in &responses {
            reject_forbidden_payload(response.metadata_json.as_deref())?;
            reject_forbidden_payload(Some(&response.content))?;
        }

        let mut transaction = self.pool.begin().await.map_err(|error| {
            ServiceError::storage(format!("failed to start response transaction: {error}"))
        })?;
        let mut persisted = Vec::with_capacity(responses.len());

        for mut response in responses {
            if let Some(existing) =
                response_by_id_with_executor(&mut transaction, &response.response_id).await?
            {
                persisted.push(existing);
                continue;
            }

            let next_sequence_index: i64 = sqlx::query(
                "SELECT COALESCE(MAX(sequence_index), -1) + 1 AS next_index
                 FROM responses
                 WHERE loom_id = ?1",
            )
            .bind(&response.loom_id)
            .fetch_one(&mut transaction)
            .await
            .map(|row| row.get("next_index"))
            .map_err(|error| {
                ServiceError::storage(format!(
                    "failed to get next Response sequence index: {error}"
                ))
            })?;

            response.sequence_index = next_sequence_index;
            insert_response_with_executor(&mut transaction, &response).await?;
            let inserted = response_by_id_with_executor(&mut transaction, &response.response_id)
                .await?
                .ok_or_else(|| ServiceError::storage("inserted Response was not found"))?;
            persisted.push(inserted);
        }

        transaction.commit().await.map_err(|error| {
            ServiceError::storage(format!("failed to commit response transaction: {error}"))
        })?;

        for response in &persisted {
            sync_derived_artifacts_for_record(
                &self.pool,
                &response.response_id,
                &response.loom_id,
                &response.content,
            )
            .await?;
        }

        Ok(persisted)
    }
}

async fn sync_derived_artifacts_for_response(
    pool: &SqlitePool,
    response: &NewResponse,
) -> Result<(), ServiceError> {
    sync_derived_artifacts_for_record(
        pool,
        &response.response_id,
        &response.loom_id,
        &response.content,
    )
    .await
}

async fn sync_derived_artifacts_for_record(
    pool: &SqlitePool,
    response_id: &str,
    loom_id: &str,
    content: &str,
) -> Result<(), ServiceError> {
    crate::storage::repositories::parts::clear_parts_for_response(pool, response_id).await?;
    crate::storage::repositories::code_blocks::sync_code_blocks_for_response(
        pool,
        response_id,
        loom_id,
        content,
    )
    .await?;
    crate::storage::repositories::parts::replace_parts_for_response(
        pool,
        response_id,
        loom_id,
        content,
    )
    .await?;
    crate::storage::repositories::tags_graph::sync_response_tags_topics_and_links(
        pool,
        response_id,
    )
    .await?;
    Ok(())
}

async fn insert_response_with_executor<'a>(
    transaction: &mut sqlx::Transaction<'a, sqlx::Sqlite>,
    response: &NewResponse,
) -> Result<(), ServiceError> {
    sqlx::query(
        "INSERT INTO responses (
            response_id, loom_id, role, content, title, code, canonical_uri,
            created_at, updated_at, sequence_index, metadata_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )
    .bind(&response.response_id)
    .bind(&response.loom_id)
    .bind(&response.role)
    .bind(&response.content)
    .bind(&response.title)
    .bind(&response.code)
    .bind(&response.canonical_uri)
    .bind(&response.created_at)
    .bind(&response.updated_at)
    .bind(response.sequence_index)
    .bind(&response.metadata_json)
    .execute(&mut *transaction)
    .await
    .map_err(|error| ServiceError::storage(format!("failed to insert Response: {error}")))?;

    Ok(())
}

async fn response_by_id_with_executor<'a>(
    transaction: &mut sqlx::Transaction<'a, sqlx::Sqlite>,
    response_id: &str,
) -> Result<Option<ResponseRecord>, ServiceError> {
    sqlx::query("SELECT * FROM responses WHERE response_id = ?1 LIMIT 1")
        .bind(response_id)
        .fetch_optional(&mut *transaction)
        .await
        .map(|row| row.map(response_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to get Response: {error}")))
}

fn response_status_metadata(
    existing_metadata_json: Option<&str>,
    status: &str,
    done_reason: Option<&str>,
    error_kind: Option<&str>,
    error_message: Option<&str>,
) -> Result<String, ServiceError> {
    let mut metadata = existing_metadata_json
        .and_then(|metadata| serde_json::from_str::<serde_json::Value>(metadata).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    metadata.insert(
        "status".to_string(),
        serde_json::Value::String(status.to_string()),
    );
    metadata.insert(
        "updatedAt".to_string(),
        serde_json::Value::String(timestamp()),
    );
    if let Some(done_reason) = done_reason {
        metadata.insert(
            "doneReason".to_string(),
            serde_json::Value::String(done_reason.to_string()),
        );
    }
    if error_kind.is_some() || error_message.is_some() {
        metadata.insert(
            "error".to_string(),
            serde_json::json!({
                "kind": error_kind,
                "message": error_message
            }),
        );
    }

    let metadata_json = serde_json::to_string(&metadata).map_err(|error| {
        ServiceError::storage(format!("failed to serialize Response metadata: {error}"))
    })?;
    reject_forbidden_payload(Some(&metadata_json))?;
    Ok(metadata_json)
}

fn response_from_row(row: sqlx::sqlite::SqliteRow) -> ResponseRecord {
    ResponseRecord {
        response_id: row.get("response_id"),
        loom_id: row.get("loom_id"),
        role: row.get("role"),
        content: row.get("content"),
        title: row.get("title"),
        code: row.get("code"),
        canonical_uri: row.get("canonical_uri"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        sequence_index: row.get("sequence_index"),
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
                "Response payload contains forbidden key {forbidden}"
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
    use super::{NewResponse, ResponseRepository};
    use crate::storage::{
        db::test_database,
        repositories::looms::{LoomRepository, NewLoom},
    };

    #[tokio::test]
    async fn insert_and_list_responses_for_loom() {
        let database = test_database().await;
        let looms = LoomRepository::new(&database);
        looms
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Test Loom".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");

        let responses = ResponseRepository::new(&database);
        responses
            .insert_response(&NewResponse {
                response_id: "response-1".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Final answer only.".to_string(),
                title: None,
                code: Some("R-TEST".to_string()),
                canonical_uri: None,
                created_at: "2026-05-08T00:00:01Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
                sequence_index: 1,
                metadata_json: Some("{\"thinkingDurationMs\":1200}".to_string()),
            })
            .await
            .expect("insert Response");

        let listed = responses
            .list_responses_for_loom("loom-1")
            .await
            .expect("list Responses");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].content, "Final answer only.");

        let found = responses
            .get_response("response-1")
            .await
            .expect("get Response")
            .expect("Response exists");
        assert_eq!(found.code.as_deref(), Some("R-TEST"));
    }

    #[tokio::test]
    async fn response_lifecycle_helpers_track_sequence_content_and_status() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let responses = ResponseRepository::new(&database);

        assert_eq!(
            responses
                .get_next_sequence_index("loom-1")
                .await
                .expect("next index"),
            0
        );

        let user = sample_response("response-user", "user", "Prompt", 0, "{}");
        let assistant = sample_response(
            "response-assistant",
            "assistant",
            "",
            1,
            "{\"status\":\"streaming\",\"workflowRunId\":\"run-1\"}",
        );
        responses
            .insert_response_pair(&user, &assistant)
            .await
            .expect("insert pair");

        responses
            .update_response_content("response-assistant", "partial answer")
            .await
            .expect("update content");
        responses
            .update_response_status("response-assistant", "completed", Some("stop"), None, None)
            .await
            .expect("update status");

        let listed = responses
            .list_responses_for_loom("loom-1")
            .await
            .expect("list responses");
        assert_eq!(listed[0].sequence_index, 0);
        assert_eq!(listed[1].sequence_index, 1);
        assert_eq!(listed[1].content, "partial answer");
        assert_eq!(
            responses
                .get_next_sequence_index("loom-1")
                .await
                .expect("next index"),
            2
        );

        let metadata: serde_json::Value =
            serde_json::from_str(listed[1].metadata_json.as_deref().unwrap())
                .expect("metadata json");
        assert_eq!(metadata["status"], "completed");
        assert_eq!(metadata["doneReason"], "stop");
        assert_eq!(metadata["workflowRunId"], "run-1");
    }

    #[tokio::test]
    async fn response_lifecycle_rejects_raw_thinking_payloads() {
        let database = test_database().await;
        insert_test_loom(&database).await;
        let responses = ResponseRepository::new(&database);
        let response = sample_response(
            "response-raw",
            "assistant",
            "",
            0,
            "{\"raw_thinking\":\"must not persist\"}",
        );

        let error = responses
            .insert_response(&response)
            .await
            .expect_err("raw thinking rejected");

        assert!(error.to_string().contains("raw_thinking"));
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
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");
    }

    fn sample_response(
        response_id: &str,
        role: &str,
        content: &str,
        sequence_index: i64,
        metadata_json: &str,
    ) -> NewResponse {
        NewResponse {
            response_id: response_id.to_string(),
            loom_id: "loom-1".to_string(),
            role: role.to_string(),
            content: content.to_string(),
            title: None,
            code: None,
            canonical_uri: None,
            created_at: "2026-05-08T00:00:01Z".to_string(),
            updated_at: "2026-05-08T00:00:01Z".to_string(),
            sequence_index,
            metadata_json: Some(metadata_json.to_string()),
        }
    }
}
