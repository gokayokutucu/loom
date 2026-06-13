// POST /hard-reset
//
// Physically deletes every row of user-created data from the SQLite database
// in a single transaction.  System/capability tables (schema_migrations,
// model_catalog, community_model_benchmarks, runtime_model_assets, …) are
// intentionally left untouched so the service does not need to re-seed or
// re-download models after the reset.
//
// Tables cleared (FK-safe order, most-dependent first):
//   search_documents_fts (virtual – rebuild after delete)
//   search_index_state, search_documents
//   attachment_parse_artifact_summaries, attachment_parse_artifact_chunks,
//   attachment_parse_artifacts, attachment_blob_objects,
//   attachment_summaries, attachment_parsed_chunks, attachment_parse_jobs,
//   attachment_parsed_content, attachment_blobs, attachments
//   memory_events, memories
//   ui_state, navigation_history
//   context_graph_links, loom_topic_index, response_tags
//   response_parts, response_code_blocks
//   orchestration_events, workflow_stages, workflow_runs
//   service_events, context_artifact_events, context_build_jobs
//   weft_origin_contexts, loom_checkpoint_summaries,
//   response_context_capsules
//   addresses, address_aliases
//   bookmarks, "references", responses, looms

use crate::api::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardResetResponse {
    pub ok: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardResetError {
    pub code: String,
    pub message: String,
}

pub async fn hard_reset(
    State(state): State<AppState>,
) -> Result<Json<HardResetResponse>, (StatusCode, Json<HardResetError>)> {
    let pool = state.database.pool();

    let mut tx = pool.begin().await.map_err(reset_error)?;

    // ── Attachment pipeline ────────────────────────────────────────────────
    sqlx::query("DELETE FROM attachment_parse_artifact_summaries")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM attachment_parse_artifact_chunks")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM attachment_parse_artifacts")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM attachment_blob_objects")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM attachment_summaries")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM attachment_parsed_chunks")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM attachment_parse_jobs")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM attachment_parsed_content")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM attachment_blobs")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM attachments")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── Memory ────────────────────────────────────────────────────────────
    sqlx::query("DELETE FROM memory_events")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM memories")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── UI / navigation ───────────────────────────────────────────────────
    sqlx::query("DELETE FROM ui_state")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM navigation_history")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── Context graph ─────────────────────────────────────────────────────
    sqlx::query("DELETE FROM context_graph_links")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM loom_topic_index")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM response_tags")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── Response derived data ─────────────────────────────────────────────
    sqlx::query("DELETE FROM response_parts")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM response_code_blocks")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── Orchestration ─────────────────────────────────────────────────────
    sqlx::query("DELETE FROM orchestration_events")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM workflow_stages")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM workflow_runs")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── Event / job queues ────────────────────────────────────────────────
    sqlx::query("DELETE FROM service_events")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM context_artifact_events")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM context_build_jobs")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── Context summaries / wefts ─────────────────────────────────────────
    sqlx::query("DELETE FROM weft_origin_contexts")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM loom_checkpoint_summaries")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM response_context_capsules")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── Address registry ──────────────────────────────────────────────────
    sqlx::query("DELETE FROM addresses")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM address_aliases")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── Core user data ────────────────────────────────────────────────────
    sqlx::query("DELETE FROM bookmarks")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query(r#"DELETE FROM "references""#)
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM responses")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM looms")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    // ── Search index ──────────────────────────────────────────────────────
    sqlx::query("DELETE FROM search_documents")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;
    sqlx::query("DELETE FROM search_index_state")
        .execute(&mut *tx)
        .await
        .map_err(reset_error)?;

    tx.commit().await.map_err(reset_error)?;

    // Rebuild the FTS index outside the transaction (FTS5 auxiliary writes
    // cannot always run inside a user transaction on older SQLite builds).
    sqlx::query("INSERT INTO search_documents_fts(search_documents_fts) VALUES('rebuild')")
        .execute(pool)
        .await
        .map_err(reset_error)?;

    Ok(Json(HardResetResponse { ok: true }))
}

fn reset_error(error: impl ToString) -> (StatusCode, Json<HardResetError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(HardResetError {
            code: "HARD_RESET_FAILED".to_string(),
            message: error.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::hard_reset;
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::{
            db::test_database,
            repositories::{
                bookmarks::{BookmarkRepository, NewBookmark},
                looms::{LoomRepository, NewLoom},
                responses::{NewResponse, ResponseRepository},
            },
        },
    };
    use axum::extract::State;
    use std::{path::PathBuf, time::Duration};

    async fn test_state() -> AppState {
        let database = test_database().await;
        AppState {
            database,
            ollama: OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            }),
            config: ConfigManager::new(
                PathBuf::from("/tmp/loom-hard-reset-test.toml"),
                LoomServiceConfig::default(),
            ),
            secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
            agent_runs: Default::default(),
            tool_registry: std::sync::Arc::new(std::sync::RwLock::new(
                crate::agent_runtime::tool_registry::ToolRegistry::new(),
            )),
        }
    }

    async fn seed_data(state: &AppState) {
        let loom_repo = LoomRepository::new(&state.database);
        loom_repo
            .insert_loom(&NewLoom {
                loom_id: "loom-reset-1".to_string(),
                title: "Test Loom".to_string(),
                summary: None,
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                canonical_uri: Some("loom://test/loom-reset-1".to_string()),
                code: Some("reset-1".to_string()),
                metadata_json: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
            })
            .await
            .expect("insert loom");

        ResponseRepository::new(&state.database)
            .insert_response_pair(
                &NewResponse {
                    response_id: "user-reset-1".to_string(),
                    loom_id: "loom-reset-1".to_string(),
                    role: "user".to_string(),
                    content: "hello".to_string(),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    sequence_index: 0,
                    metadata_json: None,
                    created_at: "1".to_string(),
                    updated_at: "1".to_string(),
                },
                &NewResponse {
                    response_id: "assistant-reset-1".to_string(),
                    loom_id: "loom-reset-1".to_string(),
                    role: "assistant".to_string(),
                    content: "world".to_string(),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    sequence_index: 1,
                    metadata_json: None,
                    created_at: "1".to_string(),
                    updated_at: "1".to_string(),
                },
            )
            .await
            .expect("insert responses");

        BookmarkRepository::new(&state.database)
            .insert_bookmark(&NewBookmark {
                bookmark_id: "bm-reset-1".to_string(),
                target_kind: "loom".to_string(),
                target_id: Some("loom-reset-1".to_string()),
                target_uri: Some("loom://test/loom-reset-1".to_string()),
                title: "Test Bookmark".to_string(),
                metadata_json: None,
                created_at: "1".to_string(),
            })
            .await
            .expect("insert bookmark");
    }

    #[tokio::test]
    async fn hard_reset_deletes_looms_responses_and_bookmarks() {
        let state = test_state().await;
        seed_data(&state).await;

        // Verify data exists before reset
        let loom_count_before = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM looms")
            .fetch_one(state.database.pool())
            .await
            .expect("count looms");
        assert_eq!(loom_count_before, 1);

        let bm_count_before = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM bookmarks")
            .fetch_one(state.database.pool())
            .await
            .expect("count bookmarks");
        assert_eq!(bm_count_before, 1);

        // Execute reset
        let result = hard_reset(State(state.clone()))
            .await
            .expect("hard reset succeeds");
        assert!(result.0.ok);

        // Verify all user data is gone
        let loom_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM looms")
            .fetch_one(state.database.pool())
            .await
            .expect("count looms after reset");
        assert_eq!(loom_count, 0, "looms must be physically deleted");

        let response_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM responses")
            .fetch_one(state.database.pool())
            .await
            .expect("count responses after reset");
        assert_eq!(response_count, 0, "responses must be physically deleted");

        let bm_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM bookmarks")
            .fetch_one(state.database.pool())
            .await
            .expect("count bookmarks after reset");
        assert_eq!(bm_count, 0, "bookmarks must be physically deleted");
    }

    #[tokio::test]
    async fn hard_reset_is_idempotent_on_empty_database() {
        let state = test_state().await;

        // Should not error on an already-empty database
        let result = hard_reset(State(state)).await;
        assert!(result.is_ok(), "hard reset on empty DB should succeed");
    }
}
