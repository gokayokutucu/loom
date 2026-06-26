use crate::error::ServiceError;
use sqlx::{Executor, SqlitePool};

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
    transactional: bool,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "initial_schema",
        sql: include_str!("../../migrations/0001_initial_schema.sql"),
        transactional: true,
    },
    Migration {
        version: 2,
        name: "orchestration_workflow",
        sql: include_str!("../../migrations/0002_orchestration_workflow.sql"),
        transactional: true,
    },
    Migration {
        version: 3,
        name: "capabilities",
        sql: include_str!("../../migrations/0003_capabilities.sql"),
        transactional: true,
    },
    Migration {
        version: 4,
        name: "community_model_benchmarks",
        sql: include_str!("../../migrations/0004_community_model_benchmarks.sql"),
        transactional: true,
    },
    Migration {
        version: 5,
        name: "loom_metadata",
        sql: include_str!("../../migrations/0005_loom_metadata.sql"),
        transactional: true,
    },
    Migration {
        version: 6,
        name: "response_code_blocks",
        sql: include_str!("../../migrations/0006_response_code_blocks.sql"),
        transactional: true,
    },
    Migration {
        version: 7,
        name: "response_parts",
        sql: include_str!("../../migrations/0007_response_parts.sql"),
        transactional: true,
    },
    Migration {
        version: 8,
        name: "response_tags_graph",
        sql: include_str!("../../migrations/0008_response_tags_graph.sql"),
        transactional: true,
    },
    Migration {
        version: 9,
        name: "navigation_history",
        sql: include_str!("../../migrations/0009_navigation_history.sql"),
        transactional: true,
    },
    Migration {
        version: 10,
        name: "response_soft_delete",
        sql: include_str!("../../migrations/0010_response_soft_delete.sql"),
        transactional: true,
    },
    Migration {
        version: 11,
        name: "loom_soft_delete",
        sql: include_str!("../../migrations/0011_loom_soft_delete.sql"),
        transactional: true,
    },
    Migration {
        version: 12,
        name: "ui_state",
        sql: include_str!("../../migrations/0012_ui_state.sql"),
        transactional: true,
    },
    Migration {
        version: 13,
        name: "memory",
        sql: include_str!("../../migrations/0013_memory.sql"),
        transactional: true,
    },
    Migration {
        version: 14,
        name: "model_runtime",
        sql: include_str!("../../migrations/0014_model_runtime.sql"),
        transactional: true,
    },
    Migration {
        version: 15,
        name: "attachments",
        sql: include_str!("../../migrations/0015_attachments.sql"),
        transactional: true,
    },
    Migration {
        version: 16,
        name: "attachment_parse_pipeline",
        sql: include_str!("../../migrations/0016_attachment_parse_pipeline.sql"),
        transactional: true,
    },
    Migration {
        version: 17,
        name: "attachment_checksum_dedupe",
        sql: include_str!("../../migrations/0017_attachment_checksum_dedupe.sql"),
        transactional: true,
    },
    Migration {
        version: 18,
        name: "search_fts",
        sql: include_str!("../../migrations/0018_search_fts.sql"),
        transactional: true,
    },
    Migration {
        version: 19,
        name: "cleanup_pseudo_artifact_code_blocks",
        sql: include_str!("../../migrations/0019_cleanup_pseudo_artifact_code_blocks.sql"),
        transactional: true,
    },
    Migration {
        version: 20,
        name: "response_attachment_references",
        sql: include_str!("../../migrations/0020_response_attachment_references.sql"),
        transactional: true,
    },
    Migration {
        version: 21,
        name: "cleanup_orphaned_code_language_tags",
        sql: include_str!("../../migrations/0021_cleanup_orphaned_code_language_tags.sql"),
        transactional: true,
    },
    Migration {
        version: 22,
        name: "agent_run_persistence",
        sql: include_str!("../../migrations/0022_agent_run_persistence.sql"),
        transactional: true,
    },
    Migration {
        version: 23,
        name: "retrieval_projection_contracts",
        sql: include_str!("../../migrations/0023_retrieval_projection_contracts.sql"),
        transactional: true,
    },
    Migration {
        version: 24,
        name: "context_snapshots",
        sql: include_str!("../../migrations/0024_context_snapshots.sql"),
        transactional: true,
    },
    Migration {
        version: 25,
        name: "memory_policy_foundation",
        sql: include_str!("../../migrations/0025_memory_policy_foundation.sql"),
        transactional: true,
    },
    Migration {
        version: 26,
        name: "memory_projection_invalidation",
        sql: include_str!("../../migrations/0026_memory_projection_invalidation.sql"),
        transactional: true,
    },
    Migration {
        version: 27,
        name: "agent_behavior_foundation",
        sql: include_str!("../../migrations/0027_agent_behavior_foundation.sql"),
        transactional: false,
    },
    Migration {
        version: 28,
        name: "tool_scheduler_foundation",
        sql: include_str!("../../migrations/0028_tool_scheduler_foundation.sql"),
        transactional: true,
    },
    Migration {
        version: 29,
        name: "agent_run_mode",
        sql: include_str!("../../migrations/0029_agent_run_mode.sql"),
        transactional: true,
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

        if migration.transactional {
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
        } else {
            pool.execute(migration.sql).await.map_err(|error| {
                ServiceError::storage(format!(
                    "failed to apply migration {} {}: {error}",
                    migration.version, migration.name
                ))
            })?;

            sqlx::query("INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)")
                .bind(migration.version)
                .bind(migration.name)
                .execute(pool)
                .await
                .map_err(|error| {
                    ServiceError::storage(format!("failed to record migration: {error}"))
                })?;
        }
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
    use sqlx::Row;

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
    async fn migration_0025_extends_existing_memories_with_policy_constraints() {
        let database = test_database().await;
        let pool = database.pool();
        let columns = sqlx::query_scalar::<_, String>(
            "SELECT name FROM pragma_table_info('memories') ORDER BY cid",
        )
        .fetch_all(pool)
        .await
        .unwrap();
        for expected in [
            "supersedes_id",
            "always_include",
            "origin_response_id",
            "extraction_method",
            "confidence",
            "topic_key",
        ] {
            assert!(columns.iter().any(|column| column == expected));
        }
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "prompt",
            "provider_payload",
            "provider_response",
        ] {
            assert!(!columns.iter().any(|column| column == forbidden));
        }

        sqlx::query(
            "INSERT INTO memories
             (memory_id, memory_type, content, normalized_content)
             VALUES ('memory-policy-base', 'explicit_user_memory', 'safe', 'safe')",
        )
        .execute(pool)
        .await
        .unwrap();
        let default_always = sqlx::query_scalar::<_, i64>(
            "SELECT always_include FROM memories WHERE memory_id = 'memory-policy-base'",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(default_always, 0);

        for (index, method, confidence) in [
            (0, Some("explicit"), Some(0.0)),
            (1, Some("llm_extraction"), Some(1.0)),
            (2, Some("system"), None),
            (3, None, Some(0.5)),
        ] {
            sqlx::query(
                "INSERT INTO memories
                 (memory_id, memory_type, content, normalized_content, supersedes_id,
                  always_include, origin_response_id, extraction_method, confidence, topic_key)
                 VALUES (?1, 'explicit_user_memory', 'safe', 'safe',
                         'memory-policy-base', 1, 'origin-response', ?2, ?3, 'topic-a')",
            )
            .bind(format!("memory-policy-{index}"))
            .bind(method)
            .bind(confidence)
            .execute(pool)
            .await
            .unwrap();
        }
        let stored = sqlx::query(
            "SELECT supersedes_id, origin_response_id, topic_key
             FROM memories WHERE memory_id = 'memory-policy-0'",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(
            stored.get::<String, _>("supersedes_id"),
            "memory-policy-base"
        );
        assert_eq!(
            stored.get::<String, _>("origin_response_id"),
            "origin-response"
        );
        assert_eq!(stored.get::<String, _>("topic_key"), "topic-a");

        for (id, method, confidence) in [
            ("memory-policy-confidence-low", Some("explicit"), Some(-0.1)),
            ("memory-policy-confidence-high", Some("explicit"), Some(1.1)),
            ("memory-policy-method-invalid", Some("unknown"), None),
        ] {
            let result = sqlx::query(
                "INSERT INTO memories
                 (memory_id, memory_type, content, normalized_content,
                  extraction_method, confidence)
                 VALUES (?1, 'explicit_user_memory', 'safe', 'safe', ?2, ?3)",
            )
            .bind(id)
            .bind(method)
            .bind(confidence)
            .execute(pool)
            .await;
            assert!(
                result.is_err(),
                "invalid policy value should be rejected: {id}"
            );
        }

        let provenance_tables = sqlx::query_scalar::<_, String>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_provenance'",
        )
        .fetch_all(pool)
        .await
        .unwrap();
        assert!(provenance_tables.is_empty());
    }

    #[tokio::test]
    async fn migration_0026_adds_metadata_only_projection_invalidation_state() {
        let database = test_database().await;
        for table in [
            "retrieval_projection_sources",
            "retrieval_projection_chunks",
        ] {
            let columns = sqlx::query_scalar::<_, String>(&format!(
                "SELECT name FROM pragma_table_info('{table}') ORDER BY cid"
            ))
            .fetch_all(database.pool())
            .await
            .unwrap();
            assert!(columns.iter().any(|column| column == "invalidation_state"));
            assert!(columns.iter().any(|column| column == "invalidated_at"));
            for forbidden in [
                "content",
                "prompt",
                "provider_payload",
                "raw_thinking",
                "thinking_text",
                "secret",
                "vector",
            ] {
                assert!(!columns.iter().any(|column| column == forbidden));
            }
        }

        let source_error = sqlx::query(
            "INSERT INTO retrieval_projection_sources (
                source_kind, source_id, projection_version, source_digest,
                source_updated_at, indexed_at, invalidation_state
             ) VALUES ('memory', 'invalid-state', 'v1', 'pending', '1', '', 'unknown')",
        )
        .execute(database.pool())
        .await
        .unwrap_err();
        assert!(source_error.to_string().contains("CHECK constraint failed"));
    }

    #[tokio::test]
    async fn migration_0028_creates_tool_scheduler_tables() {
        let database = test_database().await;
        for table in [
            "tool_definitions",
            "tool_invocations",
            "tool_artifacts",
            "tool_permission_grants",
        ] {
            let count =
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE name = ?1")
                    .bind(table)
                    .fetch_one(database.pool())
                    .await
                    .expect("table query should work");
            assert_eq!(count, 1, "{table} should exist");
        }

        let applied = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 28 AND name = 'tool_scheduler_foundation'",
        )
        .fetch_one(database.pool())
        .await
        .expect("schema migration query should work");
        assert_eq!(applied, 1, "migration 0028 must be recorded");
    }

    #[tokio::test]
    async fn migration_0028_tool_scheduler_schema_has_no_raw_payload_columns() {
        let database = test_database().await;
        for table in [
            "tool_definitions",
            "tool_invocations",
            "tool_artifacts",
            "tool_permission_grants",
        ] {
            let columns = sqlx::query_scalar::<_, String>(&format!(
                "SELECT name FROM pragma_table_info('{table}') ORDER BY cid"
            ))
            .fetch_all(database.pool())
            .await
            .expect("column query should work");
            for forbidden in [
                "raw_payload",
                "payload",
                "raw_stdout",
                "stdout",
                "raw_stderr",
                "stderr",
                "content",
                "file_contents",
                "prompt",
                "provider_payload",
                "provider_request",
                "provider_response",
                "raw_thinking",
                "thinking_text",
                "chain_of_thought",
                "hidden_reasoning",
            ] {
                assert!(
                    !columns.iter().any(|column| column == forbidden),
                    "{table} must not contain forbidden column {forbidden}"
                );
            }
        }
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
        assert_eq!(
            ts_tag_count, 1,
            "valid 'ts' tag backed by code block must survive"
        );
    }

    #[tokio::test]
    async fn migration_0022_creates_agent_run_persistence_tables() {
        let database = test_database().await;
        for table in ["agent_runs", "agent_steps", "agent_events"] {
            let count = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            )
            .bind(table)
            .fetch_one(database.pool())
            .await
            .expect("table query");
            assert_eq!(count, 1, "{table} should exist after migration 0022");
        }
    }

    #[tokio::test]
    async fn migration_0024_creates_context_snapshot_tables() {
        let database = test_database().await;
        for table in ["context_snapshots", "context_snapshot_candidates"] {
            let count = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            )
            .bind(table)
            .fetch_one(database.pool())
            .await
            .expect("table query");
            assert_eq!(count, 1, "{table} should exist after migration 0024");
        }

        let mut columns = Vec::new();
        for table in ["context_snapshots", "context_snapshot_candidates"] {
            columns.extend(
                sqlx::query_scalar::<_, String>(&format!(
                    "SELECT lower(name) FROM pragma_table_info('{table}')"
                ))
                .fetch_all(database.pool())
                .await
                .expect("column query"),
            );
        }
        for forbidden in [
            "content",
            "full_content",
            "prompt",
            "provider_payload",
            "provider_delta",
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "secret",
            "credential",
            "vector",
            "raw_tool_output",
        ] {
            assert!(
                !columns.iter().any(|column| column == forbidden),
                "forbidden column '{forbidden}' found in context snapshot schema"
            );
        }
    }

    #[tokio::test]
    async fn agent_runs_status_check_accepts_all_valid_statuses() {
        let database = test_database().await;
        let now = "2026-01-01T00:00:00Z";
        for status in [
            "created",
            "queued",
            "running",
            "waiting_tool",
            "waiting_subagent",
            "completed",
            "failed",
            "cancelled",
            // Recovery compatibility state from the frozen canonical contract.
            "interrupted",
        ] {
            let run_id = format!("test-status-{status}");
            sqlx::query(
                "INSERT INTO agent_runs
                 (agent_run_id, correlation_id, status, started_at, cancel_requested, created_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?4)",
            )
            .bind(&run_id)
            .bind(&run_id)
            .bind(status)
            .bind(now)
            .execute(database.pool())
            .await
            .unwrap_or_else(|e| panic!("status '{status}' should be valid: {e}"));
        }
    }

    #[tokio::test]
    async fn agent_runs_status_check_rejects_invalid_status() {
        let database = test_database().await;
        let result = sqlx::query(
            "INSERT INTO agent_runs
             (agent_run_id, correlation_id, status, started_at, cancel_requested, created_at)
             VALUES ('bad', 'bad', 'thinking', '2026-01-01T00:00:00Z', 0, '2026-01-01T00:00:00Z')",
        )
        .execute(database.pool())
        .await;
        assert!(
            result.is_err(),
            "invalid status 'thinking' must be rejected"
        );
    }

    #[tokio::test]
    async fn migration_0029_agent_run_mode_defaults_and_rejects_invalid_values() {
        let database = test_database().await;
        let now = "2026-01-01T00:00:00Z";
        sqlx::query(
            "INSERT INTO agent_runs
             (agent_run_id, correlation_id, status, started_at, cancel_requested, created_at)
             VALUES ('mode-default-run', 'mode-default-run', 'running', ?1, 0, ?1)",
        )
        .bind(now)
        .execute(database.pool())
        .await
        .expect("insert default mode run");

        let mode = sqlx::query_scalar::<_, String>(
            "SELECT run_mode FROM agent_runs WHERE agent_run_id = 'mode-default-run'",
        )
        .fetch_one(database.pool())
        .await
        .expect("select mode");
        assert_eq!(mode, "full_conversation");

        sqlx::query(
            "INSERT INTO agent_runs
             (agent_run_id, run_mode, correlation_id, status, started_at, cancel_requested, created_at)
             VALUES ('mode-quick-ask-run', 'lightweight_quick_ask', 'mode-quick-ask-run', 'running', ?1, 0, ?1)",
        )
        .bind(now)
        .execute(database.pool())
        .await
        .expect("insert lightweight mode run");

        let result = sqlx::query(
            "INSERT INTO agent_runs
             (agent_run_id, run_mode, correlation_id, status, started_at, cancel_requested, created_at)
             VALUES ('mode-invalid-run', 'quick_ask_with_context', 'mode-invalid-run', 'running', ?1, 0, ?1)",
        )
        .bind(now)
        .execute(database.pool())
        .await;
        assert!(result.is_err(), "invalid AgentRun mode must be rejected");
    }

    #[tokio::test]
    async fn agent_events_is_append_only_by_convention_no_raw_thinking() {
        let database = test_database().await;
        let now = "2026-01-01T00:00:00Z";
        sqlx::query(
            "INSERT INTO agent_runs
             (agent_run_id, correlation_id, status, started_at, cancel_requested, created_at)
             VALUES ('run-evt-test', 'run-evt-test', 'completed', ?1, 0, ?1)",
        )
        .bind(now)
        .execute(database.pool())
        .await
        .expect("insert run");

        sqlx::query(
            "INSERT INTO agent_events
             (agent_event_id, agent_run_id, sequence_number, event_type, payload_json, created_at)
             VALUES ('evt-1', 'run-evt-test', 0, 'run_started', '{\"runId\":\"run-evt-test\"}', ?1)",
        )
        .bind(now)
        .execute(database.pool())
        .await
        .expect("insert event");

        // Verify no thinking columns exist on agent_events
        let columns = sqlx::query_scalar::<_, String>(
            "SELECT lower(name) FROM pragma_table_info('agent_events')",
        )
        .fetch_all(database.pool())
        .await
        .expect("column query");
        for forbidden in [
            "thinking_text",
            "raw_thinking",
            "chain_of_thought",
            "hidden_reasoning",
            "prompt",
            "messages",
            "authorization",
            "bearer",
            "api_key",
        ] {
            assert!(
                !columns.iter().any(|c| c == forbidden),
                "forbidden column '{forbidden}' found in agent_events"
            );
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
            "agent_runs",
            "agent_steps",
            "agent_events",
            "context_snapshots",
            "context_snapshot_candidates",
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
