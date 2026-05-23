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
pub struct BookmarkRecord {
    pub bookmark_id: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub title: String,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewBookmark {
    pub bookmark_id: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub title: String,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct BookmarkRepository {
    pool: SqlitePool,
}

impl BookmarkRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_bookmark(&self, bookmark: &NewBookmark) -> Result<(), ServiceError> {
        reject_forbidden_payload(bookmark.metadata_json.as_deref())?;
        sqlx::query(
            "INSERT INTO bookmarks (
                bookmark_id, target_kind, target_id, target_uri, title, metadata_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&bookmark.bookmark_id)
        .bind(&bookmark.target_kind)
        .bind(&bookmark.target_id)
        .bind(&bookmark.target_uri)
        .bind(&bookmark.title)
        .bind(&bookmark.metadata_json)
        .bind(&bookmark.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to insert Bookmark: {error}")))?;

        Ok(())
    }

    pub async fn insert_bookmark_if_missing(
        &self,
        bookmark: &NewBookmark,
    ) -> Result<bool, ServiceError> {
        reject_forbidden_payload(bookmark.metadata_json.as_deref())?;
        let result = sqlx::query(
            "INSERT OR IGNORE INTO bookmarks (
                bookmark_id, target_kind, target_id, target_uri, title, metadata_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&bookmark.bookmark_id)
        .bind(&bookmark.target_kind)
        .bind(&bookmark.target_id)
        .bind(&bookmark.target_uri)
        .bind(&bookmark.title)
        .bind(&bookmark.metadata_json)
        .bind(&bookmark.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to seed Bookmark: {error}")))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn list_bookmarks(&self) -> Result<Vec<BookmarkRecord>, ServiceError> {
        sqlx::query("SELECT * FROM bookmarks ORDER BY created_at DESC, bookmark_id ASC")
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(bookmark_from_row).collect())
            .map_err(|error| ServiceError::storage(format!("failed to list Bookmarks: {error}")))
    }

    pub async fn get_bookmark(
        &self,
        bookmark_id: &str,
    ) -> Result<Option<BookmarkRecord>, ServiceError> {
        sqlx::query("SELECT * FROM bookmarks WHERE bookmark_id = ?1")
            .bind(bookmark_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(bookmark_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get Bookmark: {error}")))
    }

    pub async fn delete_bookmark(&self, bookmark_id: &str) -> Result<bool, ServiceError> {
        let result = sqlx::query("DELETE FROM bookmarks WHERE bookmark_id = ?1")
            .bind(bookmark_id)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to delete Bookmark: {error}"))
            })?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn find_by_target(
        &self,
        target_kind: &str,
        target_id: Option<&str>,
        target_uri: Option<&str>,
    ) -> Result<Option<BookmarkRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM bookmarks
             WHERE target_kind = ?1
               AND (
                 (?2 IS NOT NULL AND target_id = ?2)
                 OR (?2 IS NULL AND ?3 IS NOT NULL AND target_uri = ?3)
               )
             ORDER BY created_at ASC, bookmark_id ASC
             LIMIT 1",
        )
        .bind(target_kind)
        .bind(target_id)
        .bind(target_uri)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(bookmark_from_row))
        .map_err(|error| {
            ServiceError::storage(format!("failed to find Bookmark by target: {error}"))
        })
    }
}

fn bookmark_from_row(row: sqlx::sqlite::SqliteRow) -> BookmarkRecord {
    BookmarkRecord {
        bookmark_id: row.get("bookmark_id"),
        target_kind: row.get("target_kind"),
        target_id: row.get("target_id"),
        target_uri: row.get("target_uri"),
        title: row.get("title"),
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
                "Bookmark payload contains forbidden key {forbidden}"
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{BookmarkRepository, NewBookmark};
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn insert_and_list_bookmarks() {
        let database = test_database().await;
        let bookmarks = BookmarkRepository::new(&database);
        bookmarks
            .insert_bookmark(&NewBookmark {
                bookmark_id: "bookmark-1".to_string(),
                target_kind: "response".to_string(),
                target_id: Some("response-1".to_string()),
                target_uri: None,
                title: "Saved Response".to_string(),
                metadata_json: Some("{}".to_string()),
                created_at: "2026-05-10T00:00:00Z".to_string(),
            })
            .await
            .expect("insert Bookmark");

        let listed = bookmarks.list_bookmarks().await.expect("list Bookmarks");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].bookmark_id, "bookmark-1");
    }

    #[tokio::test]
    async fn raw_thinking_metadata_is_rejected() {
        let database = test_database().await;
        let bookmarks = BookmarkRepository::new(&database);
        let error = bookmarks
            .insert_bookmark(&NewBookmark {
                bookmark_id: "bookmark-raw".to_string(),
                target_kind: "response".to_string(),
                target_id: Some("response-1".to_string()),
                target_uri: None,
                title: "Saved Response".to_string(),
                metadata_json: Some("{\"raw_thinking\":\"hidden\"}".to_string()),
                created_at: "2026-05-10T00:00:00Z".to_string(),
            })
            .await
            .expect_err("raw thinking rejected");

        assert!(error.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn get_delete_and_find_by_target_work() {
        let database = test_database().await;
        let bookmarks = BookmarkRepository::new(&database);
        bookmarks
            .insert_bookmark(&NewBookmark {
                bookmark_id: "bookmark-1".to_string(),
                target_kind: "response".to_string(),
                target_id: Some("response-1".to_string()),
                target_uri: Some("loom://service/response-1".to_string()),
                title: "Saved Response".to_string(),
                metadata_json: Some("{}".to_string()),
                created_at: "2026-05-10T00:00:00Z".to_string(),
            })
            .await
            .expect("insert Bookmark");

        let fetched = bookmarks
            .get_bookmark("bookmark-1")
            .await
            .expect("get Bookmark")
            .expect("Bookmark exists");
        assert_eq!(fetched.target_id.as_deref(), Some("response-1"));

        let by_target = bookmarks
            .find_by_target("response", Some("response-1"), None)
            .await
            .expect("find by target")
            .expect("Bookmark target exists");
        assert_eq!(by_target.bookmark_id, "bookmark-1");

        assert!(bookmarks
            .delete_bookmark("bookmark-1")
            .await
            .expect("delete Bookmark"));
        assert!(bookmarks
            .get_bookmark("bookmark-1")
            .await
            .expect("get deleted Bookmark")
            .is_none());
    }
}
