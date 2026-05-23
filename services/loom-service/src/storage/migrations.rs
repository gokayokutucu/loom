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
