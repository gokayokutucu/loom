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
pub struct NavigationHistoryRecord {
    pub history_id: String,
    pub title: String,
    pub path: String,
    pub object_type: String,
    pub badge: Option<String>,
    pub target_object_id: Option<String>,
    pub canonical_uri: Option<String>,
    pub reference_code: Option<String>,
    pub navigation_destination_json: Option<String>,
    pub metadata_json: Option<String>,
    pub visited_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewNavigationHistoryEntry {
    pub history_id: String,
    pub title: String,
    pub path: String,
    pub object_type: String,
    pub badge: Option<String>,
    pub target_object_id: Option<String>,
    pub canonical_uri: Option<String>,
    pub reference_code: Option<String>,
    pub navigation_destination_json: Option<String>,
    pub metadata_json: Option<String>,
    pub visited_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NavigationHistoryRepository {
    pool: SqlitePool,
}

impl NavigationHistoryRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_entry(
        &self,
        entry: &NewNavigationHistoryEntry,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(entry.navigation_destination_json.as_deref())?;
        reject_forbidden_payload(entry.metadata_json.as_deref())?;
        reject_forbidden_payload(Some(&entry.title))?;

        sqlx::query(
            "DELETE FROM navigation_history
             WHERE path = ?1
               AND COALESCE(navigation_destination_json, '') = COALESCE(?2, '')",
        )
        .bind(&entry.path)
        .bind(&entry.navigation_destination_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to dedupe navigation History: {error}"))
        })?;

        sqlx::query(
            "INSERT INTO navigation_history (
                history_id, title, path, object_type, badge, target_object_id,
                canonical_uri, reference_code, navigation_destination_json,
                metadata_json, visited_at, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )
        .bind(&entry.history_id)
        .bind(&entry.title)
        .bind(&entry.path)
        .bind(&entry.object_type)
        .bind(&entry.badge)
        .bind(&entry.target_object_id)
        .bind(&entry.canonical_uri)
        .bind(&entry.reference_code)
        .bind(&entry.navigation_destination_json)
        .bind(&entry.metadata_json)
        .bind(&entry.visited_at)
        .bind(&entry.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert navigation History: {error}"))
        })?;

        sqlx::query(
            "DELETE FROM navigation_history
             WHERE history_id NOT IN (
                SELECT history_id FROM navigation_history
                ORDER BY created_at DESC, visited_at DESC
                LIMIT 200
             )",
        )
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to trim navigation History: {error}"))
        })?;

        Ok(())
    }

    pub async fn list_entries(
        &self,
        limit: i64,
    ) -> Result<Vec<NavigationHistoryRecord>, ServiceError> {
        let limit = limit.clamp(1, 200);
        sqlx::query(
            "SELECT * FROM navigation_history
             ORDER BY created_at DESC, visited_at DESC
             LIMIT ?1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(history_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list navigation History: {error}"))
        })
    }
}

fn history_from_row(row: sqlx::sqlite::SqliteRow) -> NavigationHistoryRecord {
    NavigationHistoryRecord {
        history_id: row.get("history_id"),
        title: row.get("title"),
        path: row.get("path"),
        object_type: row.get("object_type"),
        badge: row.get("badge"),
        target_object_id: row.get("target_object_id"),
        canonical_uri: row.get("canonical_uri"),
        reference_code: row.get("reference_code"),
        navigation_destination_json: row.get("navigation_destination_json"),
        metadata_json: row.get("metadata_json"),
        visited_at: row.get("visited_at"),
        created_at: row.get("created_at"),
    }
}

fn reject_forbidden_payload(value: Option<&str>) -> Result<(), ServiceError> {
    let Some(value) = value else {
        return Ok(());
    };
    let lower = value.to_ascii_lowercase();
    if FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| lower.contains(key))
    {
        return Err(ServiceError::storage(
            "navigation History payload contains forbidden raw thinking fields",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn navigation_history_persists_and_dedupes_entries() {
        let database = test_database().await;
        let repository = NavigationHistoryRepository::new(&database);
        let entry = NewNavigationHistoryEntry {
            history_id: "history-1".to_string(),
            title: "Persistent Loom".to_string(),
            path: "loom://loom/persistent".to_string(),
            object_type: "conversation".to_string(),
            badge: Some("Loom".to_string()),
            target_object_id: Some("loom-1".to_string()),
            canonical_uri: Some("loom://loom/persistent".to_string()),
            reference_code: Some("L-ABCDE".to_string()),
            navigation_destination_json: Some(
                r#"{"loomId":"loom-1","mode":"full","source":"userNavigation"}"#.to_string(),
            ),
            metadata_json: Some(r#"{"summary":"Stored in SQLite"}"#.to_string()),
            visited_at: "2026-05-15T12:00:00Z".to_string(),
            created_at: "2026-05-15T12:00:00Z".to_string(),
        };
        repository
            .insert_entry(&entry)
            .await
            .expect("insert history");

        let newer = NewNavigationHistoryEntry {
            history_id: "history-2".to_string(),
            visited_at: "2026-05-15T12:01:00Z".to_string(),
            created_at: "2026-05-15T12:01:00Z".to_string(),
            ..entry
        };
        repository
            .insert_entry(&newer)
            .await
            .expect("dedupe history");

        let entries = repository.list_entries(10).await.expect("list history");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].history_id, "history-2");
        assert_eq!(entries[0].title, "Persistent Loom");
    }
}
