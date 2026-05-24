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
pub struct LoomRecord {
    pub loom_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub code: Option<String>,
    pub canonical_uri: Option<String>,
    pub kind: String,
    pub origin_loom_id: Option<String>,
    pub origin_response_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub is_deleted: bool,
    pub deleted_at: Option<String>,
    pub deleted_reason: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewLoom {
    pub loom_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub code: Option<String>,
    pub canonical_uri: Option<String>,
    pub kind: String,
    pub origin_loom_id: Option<String>,
    pub origin_response_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct LoomMetadataUpdate {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub code: Option<String>,
    pub canonical_uri: Option<String>,
    pub metadata_json: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct LoomRepository {
    pool: SqlitePool,
}

impl LoomRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_loom(&self, loom: &NewLoom) -> Result<(), ServiceError> {
        reject_forbidden_payload(loom.metadata_json.as_deref())?;
        sqlx::query(
            "INSERT INTO looms (
                loom_id, title, summary, code, canonical_uri, kind,
                origin_loom_id, origin_response_id, created_at, updated_at, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind(&loom.loom_id)
        .bind(&loom.title)
        .bind(&loom.summary)
        .bind(&loom.code)
        .bind(&loom.canonical_uri)
        .bind(&loom.kind)
        .bind(&loom.origin_loom_id)
        .bind(&loom.origin_response_id)
        .bind(&loom.created_at)
        .bind(&loom.updated_at)
        .bind(&loom.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to insert Loom: {error}")))?;

        Ok(())
    }

    pub async fn insert_loom_if_missing(&self, loom: &NewLoom) -> Result<bool, ServiceError> {
        reject_forbidden_payload(loom.metadata_json.as_deref())?;
        let result = sqlx::query(
            "INSERT OR IGNORE INTO looms (
                loom_id, title, summary, code, canonical_uri, kind,
                origin_loom_id, origin_response_id, created_at, updated_at, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind(&loom.loom_id)
        .bind(&loom.title)
        .bind(&loom.summary)
        .bind(&loom.code)
        .bind(&loom.canonical_uri)
        .bind(&loom.kind)
        .bind(&loom.origin_loom_id)
        .bind(&loom.origin_response_id)
        .bind(&loom.created_at)
        .bind(&loom.updated_at)
        .bind(&loom.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to seed Loom: {error}")))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn update_loom_metadata(
        &self,
        loom_id: &str,
        update: &LoomMetadataUpdate,
    ) -> Result<Option<LoomRecord>, ServiceError> {
        reject_forbidden_payload(update.metadata_json.as_deref())?;
        sqlx::query(
            "UPDATE looms
             SET title = COALESCE(?2, title),
                 summary = COALESCE(?3, summary),
                 code = COALESCE(?4, code),
                 canonical_uri = COALESCE(?5, canonical_uri),
                 metadata_json = COALESCE(?6, metadata_json),
                 updated_at = ?7
             WHERE loom_id = ?1 AND archived_at IS NULL AND is_deleted = 0",
        )
        .bind(loom_id)
        .bind(&update.title)
        .bind(&update.summary)
        .bind(&update.code)
        .bind(&update.canonical_uri)
        .bind(&update.metadata_json)
        .bind(&update.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to update Loom: {error}")))?;

        self.get_loom(loom_id).await
    }

    pub async fn get_loom(&self, loom_id: &str) -> Result<Option<LoomRecord>, ServiceError> {
        sqlx::query("SELECT * FROM looms WHERE loom_id = ?1")
            .bind(loom_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(loom_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get Loom: {error}")))
    }

    pub async fn list_looms(&self) -> Result<Vec<LoomRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM looms
             WHERE archived_at IS NULL AND is_deleted = 0
             ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(loom_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list Looms: {error}")))
    }

    pub async fn list_archived_looms(&self) -> Result<Vec<LoomRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM looms
             WHERE archived_at IS NOT NULL AND is_deleted = 0
             ORDER BY archived_at DESC, updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(loom_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list archived Looms: {error}")))
    }

    pub async fn archive_loom(
        &self,
        loom_id: &str,
        archived_at: &str,
    ) -> Result<Option<LoomRecord>, ServiceError> {
        sqlx::query(
            "UPDATE looms
             SET archived_at = COALESCE(archived_at, ?2),
                 updated_at = ?2
             WHERE loom_id = ?1 AND is_deleted = 0",
        )
        .bind(loom_id)
        .bind(archived_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to archive Loom: {error}")))?;

        self.get_loom(loom_id).await
    }

    pub async fn restore_loom(
        &self,
        loom_id: &str,
        restored_at: &str,
    ) -> Result<Option<LoomRecord>, ServiceError> {
        sqlx::query(
            "UPDATE looms
             SET archived_at = NULL,
                 updated_at = ?2
             WHERE loom_id = ?1 AND is_deleted = 0",
        )
        .bind(loom_id)
        .bind(restored_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to restore Loom: {error}")))?;

        self.get_loom(loom_id).await
    }

    pub async fn soft_delete_loom_tree(
        &self,
        loom_id: &str,
        deleted_reason: &str,
        deleted_at: &str,
    ) -> Result<Vec<String>, ServiceError> {
        let rows = sqlx::query(
            "WITH RECURSIVE target_looms(loom_id) AS (
                 SELECT loom_id FROM looms WHERE loom_id = ?1
                 UNION
                 SELECT child.loom_id
                   FROM looms child
                   JOIN target_looms target ON child.origin_loom_id = target.loom_id
             )
             SELECT loom_id
               FROM looms
              WHERE loom_id IN (SELECT loom_id FROM target_looms)
                AND is_deleted = 0",
        )
        .bind(loom_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect Loom delete targets: {error}"))
        })?;

        let deleted_loom_ids = rows
            .into_iter()
            .map(|row| row.get::<String, _>("loom_id"))
            .collect::<Vec<_>>();
        if deleted_loom_ids.is_empty() {
            return Ok(deleted_loom_ids);
        }

        sqlx::query(
            "WITH RECURSIVE target_looms(loom_id) AS (
                 SELECT loom_id FROM looms WHERE loom_id = ?1
                 UNION
                 SELECT child.loom_id
                   FROM looms child
                   JOIN target_looms target ON child.origin_loom_id = target.loom_id
             )
             UPDATE looms
                SET is_deleted = 1,
                    deleted_at = ?2,
                    deleted_reason = ?3,
                    updated_at = ?2
              WHERE loom_id IN (SELECT loom_id FROM target_looms)
                AND is_deleted = 0",
        )
        .bind(loom_id)
        .bind(deleted_at)
        .bind(deleted_reason)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to delete Loom: {error}")))?;

        Ok(deleted_loom_ids)
    }

    pub async fn list_child_wefts_by_origin_loom(
        &self,
        origin_loom_id: &str,
    ) -> Result<Vec<LoomRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM looms
             WHERE kind = 'weft'
               AND origin_loom_id = ?1
               AND archived_at IS NULL
               AND is_deleted = 0
             ORDER BY created_at ASC, loom_id ASC",
        )
        .bind(origin_loom_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(loom_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list child Wefts for Loom: {error}"))
        })
    }

    pub async fn find_weft_by_origin(
        &self,
        origin_loom_id: &str,
        origin_response_id: &str,
    ) -> Result<Option<LoomRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM looms
             WHERE kind = 'weft'
               AND origin_loom_id = ?1
               AND origin_response_id = ?2
               AND archived_at IS NULL
               AND is_deleted = 0
             ORDER BY created_at ASC, loom_id ASC
             LIMIT 1",
        )
        .bind(origin_loom_id)
        .bind(origin_response_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(loom_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to find Weft by origin: {error}")))
    }

    pub async fn list_wefts_by_origin_response(
        &self,
        origin_response_id: &str,
    ) -> Result<Vec<LoomRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM looms
             WHERE kind = 'weft'
               AND origin_response_id = ?1
               AND archived_at IS NULL
               AND is_deleted = 0
             ORDER BY created_at ASC, loom_id ASC",
        )
        .bind(origin_response_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(loom_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list child Wefts for Response: {error}"))
        })
    }
}

fn loom_from_row(row: sqlx::sqlite::SqliteRow) -> LoomRecord {
    LoomRecord {
        loom_id: row.get("loom_id"),
        title: row.get("title"),
        summary: row.get("summary"),
        code: row.get("code"),
        canonical_uri: row.get("canonical_uri"),
        kind: row.get("kind"),
        origin_loom_id: row.get("origin_loom_id"),
        origin_response_id: row.get("origin_response_id"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        archived_at: row.get("archived_at"),
        is_deleted: row.get::<i64, _>("is_deleted") != 0,
        deleted_at: row.get("deleted_at"),
        deleted_reason: row.get("deleted_reason"),
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
                "Loom metadata contains forbidden key {forbidden}"
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{LoomRepository, NewLoom};
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn insert_get_and_list_loom() {
        let database = test_database().await;
        let repository = LoomRepository::new(&database);
        let loom = NewLoom {
            loom_id: "loom-1".to_string(),
            title: "Test Loom".to_string(),
            summary: Some("A test Loom".to_string()),
            code: Some("L-TEST".to_string()),
            canonical_uri: Some("loom://test".to_string()),
            kind: "loom".to_string(),
            origin_loom_id: None,
            origin_response_id: None,
            created_at: "2026-05-08T00:00:00Z".to_string(),
            updated_at: "2026-05-08T00:00:00Z".to_string(),
            metadata_json: Some("{\"color\":\"blue\"}".to_string()),
        };

        repository.insert_loom(&loom).await.expect("insert Loom");

        let found = repository
            .get_loom("loom-1")
            .await
            .expect("get Loom")
            .expect("Loom exists");
        assert_eq!(found.title, "Test Loom");

        let looms = repository.list_looms().await.expect("list Looms");
        assert_eq!(looms.len(), 1);
    }

    #[tokio::test]
    async fn update_loom_metadata_changes_title_and_summary() {
        let database = test_database().await;
        let repository = LoomRepository::new(&database);
        repository
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Old".to_string(),
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

        let updated = repository
            .update_loom_metadata(
                "loom-1",
                &super::LoomMetadataUpdate {
                    title: Some("New".to_string()),
                    summary: Some("Updated summary".to_string()),
                    updated_at: "2026-05-08T00:00:01Z".to_string(),
                    ..super::LoomMetadataUpdate::default()
                },
            )
            .await
            .expect("update Loom")
            .expect("Loom exists");

        assert_eq!(updated.title, "New");
        assert_eq!(updated.summary.as_deref(), Some("Updated summary"));
    }

    #[tokio::test]
    async fn raw_thinking_metadata_is_rejected() {
        let database = test_database().await;
        let repository = LoomRepository::new(&database);
        let error = repository
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
                metadata_json: Some("{\"raw_thinking\":\"hidden\"}".to_string()),
            })
            .await
            .expect_err("raw thinking metadata should be rejected");

        assert!(error.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn finds_and_lists_wefts_by_origin() {
        let database = test_database().await;
        let repository = LoomRepository::new(&database);
        repository
            .insert_loom(&NewLoom {
                loom_id: "weft-1".to_string(),
                title: "Origin Weft".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "weft".to_string(),
                origin_loom_id: Some("loom-origin".to_string()),
                origin_response_id: Some("response-origin".to_string()),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Weft");

        let found = repository
            .find_weft_by_origin("loom-origin", "response-origin")
            .await
            .expect("find Weft")
            .expect("Weft exists");
        assert_eq!(found.loom_id, "weft-1");

        let by_loom = repository
            .list_child_wefts_by_origin_loom("loom-origin")
            .await
            .expect("list by Loom");
        assert_eq!(by_loom.len(), 1);

        let by_response = repository
            .list_wefts_by_origin_response("response-origin")
            .await
            .expect("list by Response");
        assert_eq!(by_response.len(), 1);
    }

    #[tokio::test]
    async fn soft_delete_loom_tree_hides_loom_and_descendant_wefts() {
        let database = test_database().await;
        let repository = LoomRepository::new(&database);
        repository
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Origin".to_string(),
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
        repository
            .insert_loom(&NewLoom {
                loom_id: "weft-1".to_string(),
                title: "Child Weft".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "weft".to_string(),
                origin_loom_id: Some("loom-1".to_string()),
                origin_response_id: Some("response-1".to_string()),
                created_at: "2026-05-08T00:00:01Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Weft");

        let deleted = repository
            .soft_delete_loom_tree("loom-1", "permanent_delete", "2026-05-08T00:00:02Z")
            .await
            .expect("soft-delete Loom");
        assert_eq!(deleted.len(), 2);

        let looms = repository.list_looms().await.expect("list Looms");
        assert!(looms.is_empty());
        let wefts = repository
            .list_child_wefts_by_origin_loom("loom-1")
            .await
            .expect("list Wefts");
        assert!(wefts.is_empty());
        let tombstone = repository
            .get_loom("loom-1")
            .await
            .expect("get tombstone")
            .expect("tombstone exists");
        assert!(tombstone.is_deleted);
    }

    #[tokio::test]
    async fn archive_and_restore_hide_and_restore_active_loom() {
        let database = test_database().await;
        let repository = LoomRepository::new(&database);
        repository
            .insert_loom(&NewLoom {
                loom_id: "loom-archive".to_string(),
                title: "Archive Target".to_string(),
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

        let archived = repository
            .archive_loom("loom-archive", "2026-05-08T00:00:01Z")
            .await
            .expect("archive Loom")
            .expect("archived Loom");
        assert_eq!(
            archived.archived_at.as_deref(),
            Some("2026-05-08T00:00:01Z")
        );
        assert!(repository
            .list_looms()
            .await
            .expect("active list")
            .is_empty());
        assert_eq!(
            repository
                .list_archived_looms()
                .await
                .expect("archived list")
                .len(),
            1
        );

        let restored = repository
            .restore_loom("loom-archive", "2026-05-08T00:00:02Z")
            .await
            .expect("restore Loom")
            .expect("restored Loom");
        assert!(restored.archived_at.is_none());
        assert_eq!(repository.list_looms().await.expect("active list").len(), 1);
        assert!(repository
            .list_archived_looms()
            .await
            .expect("archived list")
            .is_empty());
    }
}
