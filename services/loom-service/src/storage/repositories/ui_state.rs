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
pub struct UiStateRecord {
    pub state_key: String,
    pub value_json: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct UiStateRepository {
    pool: SqlitePool,
}

impl UiStateRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn get_state(&self, key: &str) -> Result<Option<UiStateRecord>, ServiceError> {
        sqlx::query("SELECT state_key, value_json, updated_at FROM ui_state WHERE state_key = ?1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(ui_state_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get UI state: {error}")))
    }

    pub async fn upsert_state(
        &self,
        key: &str,
        value_json: &str,
    ) -> Result<UiStateRecord, ServiceError> {
        reject_forbidden_payload(Some(value_json))?;
        sqlx::query(
            "INSERT INTO ui_state (state_key, value_json, updated_at)
             VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(state_key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = CURRENT_TIMESTAMP",
        )
        .bind(key)
        .bind(value_json)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to persist UI state: {error}")))?;

        self.get_state(key)
            .await?
            .ok_or_else(|| ServiceError::storage("failed to read UI state after persistence"))
    }
}

fn ui_state_from_row(row: sqlx::sqlite::SqliteRow) -> UiStateRecord {
    UiStateRecord {
        state_key: row.get("state_key"),
        value_json: row.get("value_json"),
        updated_at: row.get("updated_at"),
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
            "UI state payload contains forbidden raw thinking fields",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn ui_state_persists_and_replaces_keyed_payload() {
        let database = test_database().await;
        let repository = UiStateRepository::new(&database);

        repository
            .upsert_state("sidebar-layout-v1", r#"{"collapsed":false}"#)
            .await
            .expect("insert UI state");
        let updated = repository
            .upsert_state("sidebar-layout-v1", r#"{"collapsed":true}"#)
            .await
            .expect("update UI state");

        assert_eq!(updated.state_key, "sidebar-layout-v1");
        assert_eq!(updated.value_json, r#"{"collapsed":true}"#);
        let loaded = repository
            .get_state("sidebar-layout-v1")
            .await
            .expect("get UI state")
            .expect("state exists");
        assert_eq!(loaded.value_json, r#"{"collapsed":true}"#);
    }

    #[tokio::test]
    async fn ui_state_rejects_raw_thinking_payloads() {
        let database = test_database().await;
        let repository = UiStateRepository::new(&database);

        let error = repository
            .upsert_state("sidebar-layout-v1", r#"{"raw_thinking":"never"}"#)
            .await
            .expect_err("raw thinking rejected");

        assert!(error.to_string().contains("forbidden raw thinking"));
    }
}
