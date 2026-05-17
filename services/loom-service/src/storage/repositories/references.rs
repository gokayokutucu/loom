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
pub struct ReferenceRecord {
    pub reference_id: String,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub selected_text: Option<String>,
    pub label: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewReference {
    pub reference_id: String,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub selected_text: Option<String>,
    pub label: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct ReferenceRepository {
    pool: SqlitePool,
}

impl ReferenceRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_reference(&self, reference: &NewReference) -> Result<(), ServiceError> {
        reject_forbidden_payload(reference.metadata_json.as_deref())?;
        sqlx::query(
            "INSERT INTO \"references\" (
                reference_id, source_loom_id, source_response_id, target_kind,
                target_id, target_uri, selected_text, label, metadata_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&reference.reference_id)
        .bind(&reference.source_loom_id)
        .bind(&reference.source_response_id)
        .bind(&reference.target_kind)
        .bind(&reference.target_id)
        .bind(&reference.target_uri)
        .bind(&reference.selected_text)
        .bind(&reference.label)
        .bind(&reference.metadata_json)
        .bind(&reference.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to insert Reference: {error}")))?;

        Ok(())
    }

    pub async fn insert_reference_if_missing(
        &self,
        reference: &NewReference,
    ) -> Result<bool, ServiceError> {
        reject_forbidden_payload(reference.metadata_json.as_deref())?;
        let result = sqlx::query(
            "INSERT OR IGNORE INTO \"references\" (
                reference_id, source_loom_id, source_response_id, target_kind,
                target_id, target_uri, selected_text, label, metadata_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&reference.reference_id)
        .bind(&reference.source_loom_id)
        .bind(&reference.source_response_id)
        .bind(&reference.target_kind)
        .bind(&reference.target_id)
        .bind(&reference.target_uri)
        .bind(&reference.selected_text)
        .bind(&reference.label)
        .bind(&reference.metadata_json)
        .bind(&reference.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to seed Reference: {error}")))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn list_references_for_loom(
        &self,
        loom_id: &str,
    ) -> Result<Vec<ReferenceRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM \"references\"
             WHERE source_loom_id = ?1
                OR source_response_id IN (
                    SELECT response_id FROM responses
                    WHERE loom_id = ?1 AND is_deleted = 0
                )
             ORDER BY created_at ASC, reference_id ASC",
        )
        .bind(loom_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(reference_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list References for Loom: {error}"))
        })
    }

    pub async fn get_reference(
        &self,
        reference_id: &str,
    ) -> Result<Option<ReferenceRecord>, ServiceError> {
        sqlx::query("SELECT * FROM \"references\" WHERE reference_id = ?1")
            .bind(reference_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(reference_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get Reference: {error}")))
    }

    pub async fn delete_reference(&self, reference_id: &str) -> Result<bool, ServiceError> {
        let result = sqlx::query("DELETE FROM \"references\" WHERE reference_id = ?1")
            .bind(reference_id)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to delete Reference: {error}"))
            })?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn list_references_for_response(
        &self,
        response_id: &str,
    ) -> Result<Vec<ReferenceRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM \"references\"
             WHERE source_response_id = ?1 OR target_id = ?1
             ORDER BY created_at ASC, reference_id ASC",
        )
        .bind(response_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(reference_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list References for Response: {error}"))
        })
    }

    pub async fn find_duplicate_fragment_reference(
        &self,
        source_loom_id: &str,
        source_response_id: &str,
        selected_text: Option<&str>,
        target_uri: Option<&str>,
    ) -> Result<Option<ReferenceRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM \"references\"
             WHERE source_loom_id = ?1
               AND source_response_id = ?2
               AND target_kind = 'fragment'
               AND (?3 IS NULL OR selected_text = ?3)
               AND (?4 IS NULL OR target_uri = ?4)
             ORDER BY created_at ASC, reference_id ASC
             LIMIT 1",
        )
        .bind(source_loom_id)
        .bind(source_response_id)
        .bind(selected_text)
        .bind(target_uri)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(reference_from_row))
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to find duplicate Fragment Reference: {error}"
            ))
        })
    }
}

fn reference_from_row(row: sqlx::sqlite::SqliteRow) -> ReferenceRecord {
    ReferenceRecord {
        reference_id: row.get("reference_id"),
        source_loom_id: row.get("source_loom_id"),
        source_response_id: row.get("source_response_id"),
        target_kind: row.get("target_kind"),
        target_id: row.get("target_id"),
        target_uri: row.get("target_uri"),
        selected_text: row.get("selected_text"),
        label: row.get("label"),
        metadata_json: row.get("metadata_json"),
        created_at: row.get("created_at"),
    }
}

fn reject_forbidden_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "Reference payload contains forbidden key {forbidden}"
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{NewReference, ReferenceRepository};
    use crate::storage::{
        db::test_database,
        repositories::looms::{LoomRepository, NewLoom},
    };

    #[tokio::test]
    async fn insert_and_list_references_for_loom() {
        let database = test_database().await;
        LoomRepository::new(&database)
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Test Loom".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "2026-05-10T00:00:00Z".to_string(),
                updated_at: "2026-05-10T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");
        let references = ReferenceRepository::new(&database);
        references
            .insert_reference(&NewReference {
                reference_id: "reference-1".to_string(),
                source_loom_id: Some("loom-1".to_string()),
                source_response_id: None,
                target_kind: "loom".to_string(),
                target_id: Some("loom-1".to_string()),
                target_uri: None,
                selected_text: None,
                label: Some("Self".to_string()),
                metadata_json: Some("{}".to_string()),
                created_at: "2026-05-10T00:00:01Z".to_string(),
            })
            .await
            .expect("insert Reference");

        let listed = references
            .list_references_for_loom("loom-1")
            .await
            .expect("list References");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].reference_id, "reference-1");
    }

    #[tokio::test]
    async fn raw_thinking_metadata_is_rejected() {
        let database = test_database().await;
        let references = ReferenceRepository::new(&database);
        let error = references
            .insert_reference(&NewReference {
                reference_id: "reference-raw".to_string(),
                source_loom_id: Some("loom-1".to_string()),
                source_response_id: None,
                target_kind: "loom".to_string(),
                target_id: Some("loom-1".to_string()),
                target_uri: None,
                selected_text: None,
                label: None,
                metadata_json: Some("{\"raw_thinking\":\"hidden\"}".to_string()),
                created_at: "2026-05-10T00:00:01Z".to_string(),
            })
            .await
            .expect_err("raw thinking rejected");

        assert!(error.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn get_delete_and_list_references_for_response() {
        let database = test_database().await;
        let references = ReferenceRepository::new(&database);
        references
            .insert_reference(&NewReference {
                reference_id: "reference-response".to_string(),
                source_loom_id: Some("loom-1".to_string()),
                source_response_id: Some("response-1".to_string()),
                target_kind: "response".to_string(),
                target_id: Some("response-2".to_string()),
                target_uri: None,
                selected_text: None,
                label: Some("Response".to_string()),
                metadata_json: Some("{}".to_string()),
                created_at: "2026-05-10T00:00:01Z".to_string(),
            })
            .await
            .expect("insert Reference");

        let fetched = references
            .get_reference("reference-response")
            .await
            .expect("get Reference")
            .expect("Reference exists");
        assert_eq!(fetched.source_response_id.as_deref(), Some("response-1"));

        let listed = references
            .list_references_for_response("response-1")
            .await
            .expect("list by Response");
        assert_eq!(listed.len(), 1);

        assert!(references
            .delete_reference("reference-response")
            .await
            .expect("delete Reference"));
        assert!(references
            .get_reference("reference-response")
            .await
            .expect("get deleted")
            .is_none());
    }

    #[tokio::test]
    async fn duplicate_fragment_reference_can_be_found() {
        let database = test_database().await;
        let references = ReferenceRepository::new(&database);
        references
            .insert_reference(&NewReference {
                reference_id: "reference-fragment".to_string(),
                source_loom_id: Some("loom-1".to_string()),
                source_response_id: Some("response-1".to_string()),
                target_kind: "fragment".to_string(),
                target_id: Some("response-1".to_string()),
                target_uri: Some("loom://response/R1#fragment=abc".to_string()),
                selected_text: Some("Selected fragment".to_string()),
                label: Some("Selected fragment".to_string()),
                metadata_json: Some("{\"fragmentHash\":\"abc\"}".to_string()),
                created_at: "2026-05-10T00:00:01Z".to_string(),
            })
            .await
            .expect("insert Fragment Reference");

        let duplicate = references
            .find_duplicate_fragment_reference(
                "loom-1",
                "response-1",
                Some("Selected fragment"),
                Some("loom://response/R1#fragment=abc"),
            )
            .await
            .expect("find duplicate")
            .expect("duplicate exists");

        assert_eq!(duplicate.reference_id, "reference-fragment");
    }
}
