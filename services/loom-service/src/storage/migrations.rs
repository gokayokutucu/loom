use crate::error::ServiceError;
use sqlx::{Executor, SqlitePool};

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "initial_schema",
        sql: include_str!("../../migrations/0001_initial_schema.sql"),
    },
    Migration {
        version: 2,
        name: "orchestration_workflow",
        sql: include_str!("../../migrations/0002_orchestration_workflow.sql"),
    },
    Migration {
        version: 3,
        name: "capabilities",
        sql: include_str!("../../migrations/0003_capabilities.sql"),
    },
    Migration {
        version: 4,
        name: "community_model_benchmarks",
        sql: include_str!("../../migrations/0004_community_model_benchmarks.sql"),
    },
    Migration {
        version: 5,
        name: "loom_metadata",
        sql: include_str!("../../migrations/0005_loom_metadata.sql"),
    },
    Migration {
        version: 6,
        name: "response_code_blocks",
        sql: include_str!("../../migrations/0006_response_code_blocks.sql"),
    },
    Migration {
        version: 7,
        name: "response_parts",
        sql: include_str!("../../migrations/0007_response_parts.sql"),
    },
    Migration {
        version: 8,
        name: "response_tags_graph",
        sql: include_str!("../../migrations/0008_response_tags_graph.sql"),
    },
    Migration {
        version: 9,
        name: "navigation_history",
        sql: include_str!("../../migrations/0009_navigation_history.sql"),
    },
    Migration {
        version: 10,
        name: "response_soft_delete",
        sql: include_str!("../../migrations/0010_response_soft_delete.sql"),
    },
    Migration {
        version: 11,
        name: "loom_soft_delete",
        sql: include_str!("../../migrations/0011_loom_soft_delete.sql"),
    },
    Migration {
        version: 12,
        name: "ui_state",
        sql: include_str!("../../migrations/0012_ui_state.sql"),
    },
    Migration {
        version: 13,
        name: "memory",
        sql: include_str!("../../migrations/0013_memory.sql"),
    },
    Migration {
        version: 14,
        name: "model_runtime",
        sql: include_str!("../../migrations/0014_model_runtime.sql"),
    },
    Migration {
        version: 15,
        name: "attachments",
        sql: include_str!("../../migrations/0015_attachments.sql"),
    },
    Migration {
        version: 16,
        name: "attachment_parse_pipeline",
        sql: include_str!("../../migrations/0016_attachment_parse_pipeline.sql"),
    },
    Migration {
        version: 17,
        name: "attachment_checksum_dedupe",
        sql: include_str!("../../migrations/0017_attachment_checksum_dedupe.sql"),
    },
    Migration {
        version: 18,
        name: "search_fts",
        sql: include_str!("../../migrations/0018_search_fts.sql"),
    },
    Migration {
        version: 19,
        name: "cleanup_pseudo_artifact_code_blocks",
        sql: include_str!("../../migrations/0019_cleanup_pseudo_artifact_code_blocks.sql"),
    },
    Migration {
        version: 20,
        name: "response_attachment_references",
        sql: include_str!("../../migrations/0020_response_attachment_references.sql"),
    },
    Migration {
        version: 21,
        name: "cleanup_orphaned_code_language_tags",
        sql: include_str!("../../migrations/0021_cleanup_orphaned_code_language_tags.sql"),
    },
];

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), ServiceError> {
    ensure_fts5_available(pool).await?;

    pool.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .await
    .map_err(|error| ServiceError::storage(format!("failed to initialize migrations: {error}")))?;

    for migration in MIGRATIONS {
        let already_applied = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
        )
        .bind(migration.version)
        .fetch_one(pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect migration state: {error}"))
        })?;

        if already_applied > 0 {
            continue;
        }

        let mut transaction = pool.begin().await.map_err(|error| {
            ServiceError::storage(format!("failed to start migration transaction: {error}"))
        })?;

        transaction.execute(migration.sql).await.map_err(|error| {
            ServiceError::storage(format!(
                "failed to apply migration {} {}: {error}",
                migration.version, migration.name
            ))
        })?;

        sqlx::query("INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)")
            .bind(migration.version)
            .bind(migration.name)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to record migration: {error}"))
            })?;

        transaction.commit().await.map_err(|error| {
            ServiceError::storage(format!("failed to commit migration transaction: {error}"))
        })?;
    }

    Ok(())
}

pub async fn ensure_fts5_available(pool: &SqlitePool) -> Result<(), ServiceError> {
    let enabled = sqlx::query_scalar::<_, i64>("SELECT sqlite_compileoption_used('ENABLE_FTS5')")
        .fetch_one(pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect SQLite FTS5 support: {error}"))
        })?;

    ensure_fts5_compileoption_enabled(enabled)
}

fn ensure_fts5_compileoption_enabled(enabled: i64) -> Result<(), ServiceError> {
    if enabled == 1 {
        return Ok(());
    }

    Err(ServiceError::storage(
        "SQLite FTS5 is not available in this runtime.",
    ))
}

#[cfg(test)]
mod tests {
    use crate::storage::{
        db::test_database,
        migrations::{ensure_fts5_available, ensure_fts5_compileoption_enabled},
    };

    #[tokio::test]
    async fn migrations_run_on_in_memory_sqlite() {
        let database = test_database().await;
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'looms'",
        )
        .fetch_one(database.pool())
        .await
        .expect("table query should work");

        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn fts5_preflight_detects_enabled_runtime() {
        let database = test_database().await;
        ensure_fts5_available(database.pool())
            .await
            .expect("bundled SQLite must have FTS5");
    }

    #[test]
    fn fts5_preflight_fails_clearly_when_compile_option_is_unavailable() {
        let error = ensure_fts5_compileoption_enabled(0).expect_err("FTS5 must be required");
        assert!(error
            .to_string()
            .contains("SQLite FTS5 is not available in this runtime."));
    }

    #[tokio::test]
    async fn migrations_create_search_fts_tables() {
        let database = test_database().await;
        for table in [
            "search_documents",
            "search_documents_fts",
            "search_index_state",
        ] {
            let count =
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE name = ?1")
                    .bind(table)
                    .fetch_one(database.pool())
                    .await
                    .expect("table query should work");
            assert_eq!(count, 1, "{table} should exist");
        }
    }

    #[tokio::test]
    async fn migration_0020_response_attachment_references_table_does_not_exist() {
        // Migration 0020 was voided: the table was descoped because attachment
        // references are already persisted via metadata_json.references on the
        // user response row. The migration SQL now issues a DROP TABLE IF EXISTS
        // to clean up any DB that ran the original DDL.
        let database = test_database().await;
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'response_attachment_references'",
        )
        .fetch_one(database.pool())
        .await
        .expect("table query should work");
        assert_eq!(
            count, 0,
            "response_attachment_references table must not exist after migration 0020"
        );
    }

    /// Migration 0021 cleans up stale response_tags with tag_kind='code' that
    /// have no matching code block.  After all migrations run on a fresh DB
    /// (which has no data at all), the migration is a no-op and must not error.
    #[tokio::test]
    async fn migration_0021_cleanup_orphaned_code_language_tags_runs_on_empty_database() {
        let database = test_database().await;
        // If migration 0021 errored, test_database() would have panicked.
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 21",
        )
        .fetch_one(database.pool())
        .await
        .expect("schema_migrations query should work");
        assert_eq!(count, 1, "migration 0021 must be recorded as applied");
    }

    /// After migration 0021 runs, orphaned 'code' kind tags (no backing code
    /// block) are removed; valid tags backed by real code blocks are preserved.
    #[tokio::test]
    async fn migration_0021_removes_orphaned_code_language_tags_preserves_valid() {
        let database = test_database().await;

        // Seed a loom and response.
        sqlx::query(
            "INSERT INTO looms (loom_id, title, summary, code, canonical_uri, kind, created_at, updated_at)
             VALUES ('loom-mig21', 'Mig 21 Test', NULL, NULL, '/loom/mig21', 'loom', '1', '1')",
        )
        .execute(database.pool())
        .await
        .expect("insert loom");

        sqlx::query(
            "INSERT INTO responses (response_id, loom_id, role, content, title, code, canonical_uri,
             sequence_index, metadata_json, created_at, updated_at)
             VALUES ('resp-mig21', 'loom-mig21', 'assistant', 'answer', NULL, NULL, NULL, 0, NULL, '1', '1')",
        )
        .execute(database.pool())
        .await
        .expect("insert response");

        // Insert a real code block for 'ts'.
        sqlx::query(
            "INSERT INTO response_code_blocks (
                code_block_id, response_id, loom_id, block_index, language, code,
                exact_hash, fence, metadata_json, created_at, updated_at
            ) VALUES ('cb-ts-mig21', 'resp-mig21', 'loom-mig21', 0, 'ts',
                      'const value = 1;\n', 'fnv1a64:ts_test', '```', NULL, '1', '1')",
        )
        .execute(database.pool())
        .await
        .expect("insert real code block");

        // Plant a stale 'text' code tag (no matching code block with language='text').
        sqlx::query(
            "INSERT INTO response_tags (
                tag_id, response_id, loom_id, tag, normalized_tag, tag_kind,
                confidence, source, metadata_json, created_at
            ) VALUES ('stale-mig21', 'resp-mig21', 'loom-mig21', 'text', 'text', 'code',
                      0.94, 'heuristic', NULL, '1')",
        )
        .execute(database.pool())
        .await
        .expect("insert stale code tag");

        // Plant a valid 'ts' code tag (backed by the real code block above).
        sqlx::query(
            "INSERT INTO response_tags (
                tag_id, response_id, loom_id, tag, normalized_tag, tag_kind,
                confidence, source, metadata_json, created_at
            ) VALUES ('valid-mig21', 'resp-mig21', 'loom-mig21', 'ts', 'ts', 'code',
                      0.94, 'heuristic', NULL, '1')",
        )
        .execute(database.pool())
        .await
        .expect("insert valid code tag");

        // Running migration 0021 again is a no-op (already applied), but we can
        // test the same SQL predicate by calling cleanup_orphaned_code_language_tags.
        use crate::storage::repositories::tags_graph::cleanup_orphaned_code_language_tags;
        let removed = cleanup_orphaned_code_language_tags(database.pool())
            .await
            .expect("cleanup");
        assert_eq!(removed, 1, "stale 'text' tag should be removed");

        let ts_tag_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM response_tags WHERE tag_id = 'valid-mig21'",
        )
        .fetch_one(database.pool())
        .await
        .expect("count valid tag");
        assert_eq!(ts_tag_count, 1, "valid 'ts' tag backed by code block must survive");
    }

    #[tokio::test]
    async fn schema_has_no_raw_thinking_columns() {
        let database = test_database().await;
        let mut columns = Vec::new();
        for table in [
            "responses",
            "workflow_runs",
            "workflow_stages",
            "orchestration_events",
            "system_resource_snapshots",
            "model_catalog",
            "model_runtime_benchmarks",
            "execution_strategy_decisions",
            "community_model_benchmarks",
            "response_code_blocks",
            "response_parts",
            "response_tags",
            "loom_topic_index",
            "context_graph_links",
            "navigation_history",
            "ui_state",
            "memories",
            "memory_events",
            "runtime_model_assets",
            "runtime_model_download_jobs",
            "runtime_model_download_events",
            "attachments",
            "attachment_blobs",
            "attachment_parsed_content",
            "attachment_blob_objects",
            "attachment_parse_artifacts",
            "attachment_parse_artifact_chunks",
            "attachment_parse_artifact_summaries",
            "search_documents",
            "search_index_state",
        ] {
            columns.extend(
                sqlx::query_scalar::<_, String>(&format!(
                    "SELECT lower(name) FROM pragma_table_info('{table}')"
                ))
                .fetch_all(database.pool())
                .await
                .expect("schema query should work"),
            );
        }

        assert!(!columns.iter().any(|column| {
            matches!(
                column.as_str(),
                "thinking_text" | "raw_thinking" | "chain_of_thought" | "hidden_reasoning"
            )
        }));
    }
}
