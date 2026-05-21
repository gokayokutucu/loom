#![allow(dead_code)]

use crate::{error::ServiceError, storage::db::Database};
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryRecord {
    pub memory_id: String,
    pub memory_type: String,
    pub content: String,
    pub normalized_content: String,
    pub created_at: String,
    pub updated_at: String,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub user_confirmed: bool,
    pub deleted_at: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryEventRecord {
    pub event_id: String,
    pub memory_id: String,
    pub event_type: String,
    pub payload_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewMemory {
    pub memory_id: String,
    pub memory_type: String,
    pub content: String,
    pub normalized_content: String,
    pub created_at: String,
    pub updated_at: String,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub user_confirmed: bool,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct MemoryUpdate {
    pub memory_type: Option<String>,
    pub content: Option<String>,
    pub normalized_content: Option<String>,
    pub source_loom_id: Option<Option<String>>,
    pub source_response_id: Option<Option<String>>,
    pub user_confirmed: Option<bool>,
    pub metadata_json: Option<Option<String>>,
}

#[derive(Debug, Clone)]
pub struct NewMemoryEvent {
    pub event_id: String,
    pub memory_id: String,
    pub event_type: String,
    pub payload_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct MemoryRepository {
    pool: SqlitePool,
}

impl MemoryRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_memory(&self, memory: &NewMemory) -> Result<(), ServiceError> {
        reject_forbidden_payload(Some(&memory.content))?;
        reject_forbidden_payload(Some(&memory.normalized_content))?;
        reject_forbidden_payload(memory.metadata_json.as_deref())?;
        sqlx::query(
            "INSERT INTO memories (
                memory_id,
                memory_type,
                content,
                normalized_content,
                created_at,
                updated_at,
                source_loom_id,
                source_response_id,
                user_confirmed,
                metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&memory.memory_id)
        .bind(&memory.memory_type)
        .bind(&memory.content)
        .bind(&memory.normalized_content)
        .bind(&memory.created_at)
        .bind(&memory.updated_at)
        .bind(&memory.source_loom_id)
        .bind(&memory.source_response_id)
        .bind(memory.user_confirmed)
        .bind(&memory.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to insert Memory: {error}")))?;

        Ok(())
    }

    pub async fn list_memories(
        &self,
        query: Option<&str>,
    ) -> Result<Vec<MemoryRecord>, ServiceError> {
        if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            let pattern = format!("%{}%", normalize_content(query));
            return sqlx::query(
                "SELECT * FROM memories
                 WHERE deleted_at IS NULL AND normalized_content LIKE ?1
                 ORDER BY updated_at DESC, created_at DESC, memory_id ASC",
            )
            .bind(pattern)
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(memory_from_row).collect())
            .map_err(|error| ServiceError::storage(format!("failed to search Memories: {error}")));
        }

        sqlx::query(
            "SELECT * FROM memories
             WHERE deleted_at IS NULL
             ORDER BY updated_at DESC, created_at DESC, memory_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(memory_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list Memories: {error}")))
    }

    pub async fn get_memory(&self, memory_id: &str) -> Result<Option<MemoryRecord>, ServiceError> {
        sqlx::query("SELECT * FROM memories WHERE memory_id = ?1 AND deleted_at IS NULL")
            .bind(memory_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(memory_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get Memory: {error}")))
    }

    pub async fn update_memory(
        &self,
        memory_id: &str,
        update: MemoryUpdate,
    ) -> Result<Option<MemoryRecord>, ServiceError> {
        let Some(mut current) = self.get_memory(memory_id).await? else {
            return Ok(None);
        };
        if let Some(memory_type) = update.memory_type {
            current.memory_type = memory_type;
        }
        if let Some(content) = update.content {
            current.content = content;
        }
        if let Some(normalized_content) = update.normalized_content {
            current.normalized_content = normalized_content;
        }
        if let Some(source_loom_id) = update.source_loom_id {
            current.source_loom_id = source_loom_id;
        }
        if let Some(source_response_id) = update.source_response_id {
            current.source_response_id = source_response_id;
        }
        if let Some(user_confirmed) = update.user_confirmed {
            current.user_confirmed = user_confirmed;
        }
        if let Some(metadata_json) = update.metadata_json {
            current.metadata_json = metadata_json;
        }
        reject_forbidden_payload(Some(&current.content))?;
        reject_forbidden_payload(Some(&current.normalized_content))?;
        reject_forbidden_payload(current.metadata_json.as_deref())?;

        sqlx::query(
            "UPDATE memories SET
                memory_type = ?2,
                content = ?3,
                normalized_content = ?4,
                updated_at = CURRENT_TIMESTAMP,
                source_loom_id = ?5,
                source_response_id = ?6,
                user_confirmed = ?7,
                metadata_json = ?8
             WHERE memory_id = ?1 AND deleted_at IS NULL",
        )
        .bind(memory_id)
        .bind(&current.memory_type)
        .bind(&current.content)
        .bind(&current.normalized_content)
        .bind(&current.source_loom_id)
        .bind(&current.source_response_id)
        .bind(current.user_confirmed)
        .bind(&current.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to update Memory: {error}")))?;

        self.get_memory(memory_id).await
    }

    pub async fn soft_delete_memory(&self, memory_id: &str) -> Result<bool, ServiceError> {
        let result = sqlx::query(
            "UPDATE memories
             SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE memory_id = ?1 AND deleted_at IS NULL",
        )
        .bind(memory_id)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to delete Memory: {error}")))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn insert_event(&self, event: &NewMemoryEvent) -> Result<(), ServiceError> {
        reject_forbidden_payload(Some(&event.payload_json))?;
        sqlx::query(
            "INSERT INTO memory_events (event_id, memory_id, event_type, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&event.event_id)
        .bind(&event.memory_id)
        .bind(&event.event_type)
        .bind(&event.payload_json)
        .bind(&event.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert Memory event: {error}"))
        })?;
        Ok(())
    }

    pub async fn list_events(
        &self,
        memory_id: &str,
    ) -> Result<Vec<MemoryEventRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM memory_events
             WHERE memory_id = ?1
             ORDER BY created_at ASC, event_id ASC",
        )
        .bind(memory_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(memory_event_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list Memory events: {error}")))
    }
}

pub fn normalize_content(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_lowercase()
}

fn memory_from_row(row: sqlx::sqlite::SqliteRow) -> MemoryRecord {
    MemoryRecord {
        memory_id: row.get("memory_id"),
        memory_type: row.get("memory_type"),
        content: row.get("content"),
        normalized_content: row.get("normalized_content"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        source_loom_id: row.get("source_loom_id"),
        source_response_id: row.get("source_response_id"),
        user_confirmed: row.get::<bool, _>("user_confirmed"),
        deleted_at: row.get("deleted_at"),
        metadata_json: row.get("metadata_json"),
    }
}

fn memory_event_from_row(row: sqlx::sqlite::SqliteRow) -> MemoryEventRecord {
    MemoryEventRecord {
        event_id: row.get("event_id"),
        memory_id: row.get("memory_id"),
        event_type: row.get("event_type"),
        payload_json: row.get("payload_json"),
        created_at: row.get("created_at"),
    }
}

fn reject_forbidden_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    let lower = payload.to_ascii_lowercase();
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if lower.contains(&forbidden.to_ascii_lowercase()) {
            return Err(ServiceError::storage(format!(
                "Memory payload contains forbidden raw thinking key {forbidden}"
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{normalize_content, MemoryRepository, MemoryUpdate, NewMemory, NewMemoryEvent};
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn memory_crud_and_events_work() {
        let database = test_database().await;
        insert_origin(&database).await;
        let memories = MemoryRepository::new(&database);
        memories
            .insert_memory(&NewMemory {
                memory_id: "memory-1".to_string(),
                memory_type: "explicit_user_memory".to_string(),
                content: "The user's project codename is Blue Otter.".to_string(),
                normalized_content: normalize_content("The user's project codename is Blue Otter."),
                created_at: "2026-05-20T00:00:00Z".to_string(),
                updated_at: "2026-05-20T00:00:00Z".to_string(),
                source_loom_id: Some("loom-1".to_string()),
                source_response_id: Some("response-1".to_string()),
                user_confirmed: true,
                metadata_json: Some(r#"{"origin":"test"}"#.to_string()),
            })
            .await
            .expect("insert memory");
        memories
            .insert_event(&NewMemoryEvent {
                event_id: "event-1".to_string(),
                memory_id: "memory-1".to_string(),
                event_type: "created".to_string(),
                payload_json: r#"{"source":"test"}"#.to_string(),
                created_at: "2026-05-20T00:00:00Z".to_string(),
            })
            .await
            .expect("insert event");

        let listed = memories
            .list_memories(Some("blue otter"))
            .await
            .expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].source_loom_id.as_deref(), Some("loom-1"));
        assert!(listed[0].user_confirmed);

        let updated = memories
            .update_memory(
                "memory-1",
                MemoryUpdate {
                    content: Some("Prefer concise Turkish answers.".to_string()),
                    normalized_content: Some(normalize_content("Prefer concise Turkish answers.")),
                    memory_type: Some("profile_preference".to_string()),
                    ..MemoryUpdate::default()
                },
            )
            .await
            .expect("update")
            .expect("memory exists");
        assert_eq!(updated.memory_type, "profile_preference");
        assert_eq!(
            updated.normalized_content,
            "prefer concise turkish answers."
        );

        let events = memories.list_events("memory-1").await.expect("events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "created");

        assert!(memories
            .soft_delete_memory("memory-1")
            .await
            .expect("delete"));
        assert!(memories
            .get_memory("memory-1")
            .await
            .expect("get deleted")
            .is_none());
    }

    #[tokio::test]
    async fn memory_rejects_raw_thinking_payloads() {
        let database = test_database().await;
        let memories = MemoryRepository::new(&database);
        let error = memories
            .insert_memory(&NewMemory {
                memory_id: "memory-raw".to_string(),
                memory_type: "explicit_user_memory".to_string(),
                content: "raw_thinking must not persist".to_string(),
                normalized_content: "raw_thinking must not persist".to_string(),
                created_at: "2026-05-20T00:00:00Z".to_string(),
                updated_at: "2026-05-20T00:00:00Z".to_string(),
                source_loom_id: None,
                source_response_id: None,
                user_confirmed: true,
                metadata_json: None,
            })
            .await
            .expect_err("raw thinking rejected");

        assert!(error.to_string().contains("raw_thinking"));
    }

    async fn insert_origin(database: &crate::storage::db::Database) {
        sqlx::query(
            "INSERT INTO looms (
                loom_id, title, summary, code, canonical_uri, kind, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'loom', ?6, ?6)",
        )
        .bind("loom-1")
        .bind("Origin Loom")
        .bind("Origin summary")
        .bind("L-ORIGIN")
        .bind("loom://service/origin")
        .bind("2026-05-20T00:00:00Z")
        .execute(database.pool())
        .await
        .expect("insert origin Loom");

        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, code, canonical_uri,
                created_at, updated_at, sequence_index, metadata_json
            ) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7, ?7, 1, '{}')",
        )
        .bind("response-1")
        .bind("loom-1")
        .bind("Origin answer")
        .bind("Origin response")
        .bind("R-ORIGIN")
        .bind("loom://service/origin#response-1")
        .bind("2026-05-20T00:00:00Z")
        .execute(database.pool())
        .await
        .expect("insert origin Response");
    }
}
