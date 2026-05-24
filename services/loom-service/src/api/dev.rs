use crate::{
    api::state::AppState,
    storage::{
        repositories::{
            code_blocks::is_reusable_code_artifact,
            parts::ResponsePartRepository,
            responses::ResponseRepository,
            tags_graph::{ContextGraphLinkRepository, ResponseTagRepository, TopicIndexRepository},
        },
        seed_fixtures,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedFixturesRequest {
    pub fixture: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevApiError {
    pub code: String,
    pub message: String,
}

pub async fn seed_fixtures(
    State(state): State<AppState>,
    Json(input): Json<SeedFixturesRequest>,
) -> Result<Json<seed_fixtures::SeedFixturesResult>, (StatusCode, Json<DevApiError>)> {
    if !state.config.current().service.local_only {
        return Err((
            StatusCode::FORBIDDEN,
            Json(DevApiError {
                code: "DEV_ENDPOINT_DISABLED".to_string(),
                message: "Dev fixture seeding is available only when service.localOnly is true."
                    .to_string(),
            }),
        ));
    }

    seed_fixtures::seed_fixture(&state.database, &input.fixture)
        .await
        .map(Json)
        .map_err(|error| {
            (
                StatusCode::BAD_REQUEST,
                Json(DevApiError {
                    code: "SEED_FIXTURES_FAILED".to_string(),
                    message: error.to_string(),
                }),
            )
        })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eProofResponse {
    pub loom_id: String,
    pub response_count: usize,
    pub response_ids: Vec<String>,
    pub part_kinds: Vec<String>,
    pub table_part_count: usize,
    pub code_blocks: Vec<E2eCodeBlockProof>,
    pub tags: Vec<String>,
    pub topics: Vec<String>,
    pub graph_link_kinds: Vec<String>,
    pub raw_thinking_present: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eCodeBlockProof {
    pub code_block_id: String,
    pub response_id: String,
    pub language: Option<String>,
    pub exact_hash: String,
    pub code: String,
}

pub async fn e2e_proof(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<Json<E2eProofResponse>, (StatusCode, Json<DevApiError>)> {
    if !state.config.current().service.local_only {
        return Err(dev_endpoint_disabled());
    }

    let responses = ResponseRepository::new(&state.database)
        .list_responses_for_loom(&loom_id)
        .await
        .map_err(dev_error)?;
    let parts = ResponsePartRepository::new(&state.database)
        .list_by_loom(&loom_id)
        .await
        .map_err(dev_error)?;
    let tags = ResponseTagRepository::new(&state.database)
        .list_by_loom(&loom_id)
        .await
        .map_err(dev_error)?;
    let topics = TopicIndexRepository::new(&state.database)
        .list_topics_for_loom(&loom_id)
        .await
        .map_err(dev_error)?;
    let links = ContextGraphLinkRepository::new(&state.database)
        .list_links_for_loom(&loom_id)
        .await
        .map_err(dev_error)?;
    let code_blocks = list_code_blocks_for_loom(&state, &loom_id)
        .await
        .map_err(dev_error)?;

    let raw_thinking_present = responses
        .iter()
        .flat_map(|response| {
            [
                response.content.as_str(),
                response.metadata_json.as_deref().unwrap_or_default(),
            ]
        })
        .chain(parts.iter().flat_map(|part| {
            [
                part.content.as_deref().unwrap_or_default(),
                part.markdown.as_deref().unwrap_or_default(),
                part.metadata_json.as_deref().unwrap_or_default(),
            ]
        }))
        .chain(
            tags.iter()
                .map(|tag| tag.metadata_json.as_deref().unwrap_or_default()),
        )
        .chain(
            topics
                .iter()
                .map(|topic| topic.metadata_json.as_deref().unwrap_or_default()),
        )
        .chain(
            links
                .iter()
                .map(|link| link.metadata_json.as_deref().unwrap_or_default()),
        )
        .chain(code_blocks.iter().map(|block| block.code.as_str()))
        .any(contains_forbidden_key);

    let response_count = responses.len();
    Ok(Json(E2eProofResponse {
        loom_id,
        response_count,
        response_ids: responses
            .into_iter()
            .map(|response| response.response_id)
            .collect(),
        part_kinds: parts.iter().map(|part| part.part_kind.clone()).collect(),
        table_part_count: parts
            .iter()
            .filter(|part| part.part_kind == "table")
            .count(),
        code_blocks,
        tags: tags.into_iter().map(|tag| tag.normalized_tag).collect(),
        topics: topics
            .into_iter()
            .map(|topic| topic.normalized_topic)
            .collect(),
        graph_link_kinds: links.into_iter().map(|link| link.link_kind).collect(),
        raw_thinking_present,
    }))
}

async fn list_code_blocks_for_loom(
    state: &AppState,
    loom_id: &str,
) -> Result<Vec<E2eCodeBlockProof>, crate::error::ServiceError> {
    sqlx::query(
        "SELECT code_block_id, response_id, language, exact_hash, code
         FROM response_code_blocks
         WHERE loom_id = ?1
         ORDER BY response_id ASC, block_index ASC",
    )
    .bind(loom_id)
    .fetch_all(state.database.pool())
    .await
    .map(|rows| {
        rows.into_iter()
            .filter_map(|row| {
                let language: Option<String> = row.get("language");
                let code: String = row.get("code");
                if !is_reusable_code_artifact(language.as_deref(), &code) {
                    return None;
                }
                Some(E2eCodeBlockProof {
                    code_block_id: row.get("code_block_id"),
                    response_id: row.get("response_id"),
                    language,
                    exact_hash: row.get("exact_hash"),
                    code,
                })
            })
            .collect()
    })
    .map_err(|error| {
        crate::error::ServiceError::storage(format!("failed to list E2E code blocks: {error}"))
    })
}

fn contains_forbidden_key(value: &str) -> bool {
    [
        "raw_thinking",
        "thinking_text",
        "chain_of_thought",
        "hidden_reasoning",
    ]
    .iter()
    .any(|key| value.contains(key))
}

fn dev_endpoint_disabled() -> (StatusCode, Json<DevApiError>) {
    (
        StatusCode::FORBIDDEN,
        Json(DevApiError {
            code: "DEV_ENDPOINT_DISABLED".to_string(),
            message: "Dev endpoints are available only when service.localOnly is true.".to_string(),
        }),
    )
}

fn dev_error(error: impl ToString) -> (StatusCode, Json<DevApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(DevApiError {
            code: "E2E_PROOF_FAILED".to_string(),
            message: error.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::{e2e_proof, seed_fixtures, SeedFixturesRequest};
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::{
            db::test_database,
            repositories::{
                looms::NewLoom,
                responses::{NewResponse, ResponseRepository},
            },
        },
    };
    use axum::{
        extract::{Path, State},
        Json,
    };
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn seed_fixtures_runs_when_ollama_is_unavailable() {
        let state = test_state("http://127.0.0.1:9").await;

        let response = seed_fixtures(
            State(state),
            Json(SeedFixturesRequest {
                fixture: "default".to_string(),
            }),
        )
        .await
        .expect("seed succeeds without Ollama")
        .0;

        assert!(response.inserted.looms > 0);
        assert!(response.inserted.responses > 0);
    }

    #[tokio::test]
    async fn e2e_proof_reports_service_created_derived_artifacts() {
        let state = test_state("http://127.0.0.1:9").await;
        seed_loom_and_responses(&state).await;

        let response = e2e_proof(State(state), Path("loom-e2e".to_string()))
            .await
            .expect("proof succeeds")
            .0;

        assert_eq!(response.response_count, 2);
        assert!(response.part_kinds.iter().any(|kind| kind == "table"));
        assert!(response.tags.iter().any(|tag| tag == "event sourcing"));
        assert!(response
            .topics
            .iter()
            .any(|topic| topic == "event sourcing"));
        assert!(response
            .graph_link_kinds
            .iter()
            .any(|kind| kind == "answers"));
        assert_eq!(response.code_blocks.len(), 1);
        assert!(!response.raw_thinking_present);
    }

    async fn test_state(ollama_base_url: &str) -> AppState {
        let database = test_database().await;
        let config_file = LoomServiceConfig::default();
        let ollama = OllamaRuntime::new(OllamaConfig {
            base_url: ollama_base_url.to_string(),
            request_timeout: Duration::from_millis(200),
            first_chunk_timeout: Duration::from_millis(200),
            stream_idle_timeout: Duration::from_millis(200),
            security: Default::default(),
        });

        AppState {
            database,
            ollama,
            config: ConfigManager::new(PathBuf::from("/tmp/loom-service-test.toml"), config_file),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }

    async fn seed_loom_and_responses(state: &AppState) {
        crate::storage::repositories::looms::LoomRepository::new(&state.database)
            .insert_loom(&NewLoom {
                loom_id: "loom-e2e".to_string(),
                title: "Event Sourcing".to_string(),
                summary: None,
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                canonical_uri: Some("loom://service/loom-e2e".to_string()),
                code: Some("event-e2e".to_string()),
                metadata_json: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
            })
            .await
            .expect("insert loom");
        ResponseRepository::new(&state.database)
            .insert_response_pair(
                &NewResponse {
                    response_id: "user-e2e".to_string(),
                    loom_id: "loom-e2e".to_string(),
                    role: "user".to_string(),
                    content: "Event Sourcing nedir?".to_string(),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    sequence_index: 0,
                    metadata_json: None,
                    created_at: "1".to_string(),
                    updated_at: "1".to_string(),
                },
                &NewResponse {
                    response_id: "assistant-e2e".to_string(),
                    loom_id: "loom-e2e".to_string(),
                    role: "assistant".to_string(),
                    content: [
                        "# Event Sourcing",
                        "",
                        "Event Store, Replay ve CQRS kullanılır.",
                        "",
                        "| A | B |",
                        "| :--- | :--- |",
                        "| x | y |",
                        "",
                        "```ts",
                        "const state = replay(stream);",
                        "```",
                    ]
                    .join("\n"),
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
    }
}
