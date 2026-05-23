use crate::{
    api::{looms::LoomDto, state::AppState},
    display_code::{display_code, DisplayCodeKind},
    error::ServiceError,
    storage::repositories::{
        addresses::{AddressRepository, NewAddress},
        context_artifacts::{ContextArtifactsRepository, UpsertWeftOriginContext},
        looms::{LoomRecord, LoomRepository, NewLoom},
        responses::{NewResponse, ResponseRecord, ResponseRepository},
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const FORBIDDEN_THINKING_KEYS: [&str; 8] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "rawThinking",
    "thinkingText",
    "chainOfThought",
    "hiddenReasoning",
];
const ORIGIN_SNAPSHOT_CONTENT_LIMIT: usize = 8_000;
const ORIGIN_SNAPSHOT_TITLE_LIMIT: usize = 240;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWeftRequest {
    pub origin_loom_id: String,
    pub origin_response_id: Option<String>,
    pub weft_kind: Option<WeftKind>,
    pub title: Option<String>,
    pub initial_prompt: Option<String>,
    pub summary: Option<String>,
    pub reuse_existing: Option<bool>,
    pub source: Option<WeftSource>,
    pub seed_mode: Option<WeftSeedMode>,
    pub create_origin_context_snapshot: Option<bool>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WeftSource {
    ResponseAction,
    QuickAskConvert,
    GraphNode,
    Reference,
}

impl WeftSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::ResponseAction => "response_action",
            Self::QuickAskConvert => "quick_ask_convert",
            Self::GraphNode => "graph_node",
            Self::Reference => "reference",
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WeftKind {
    Exploration,
    Revision,
}

impl WeftKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Exploration => "exploration",
            Self::Revision => "revision",
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WeftSeedMode {
    None,
    OriginQaPair,
    QuickAskTurns,
    RevisionLineage,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeftResponse {
    pub weft: LoomDto,
    pub created: bool,
    pub reused: bool,
    pub visible_seed_responses: Vec<VisibleWeftSeedResponse>,
    pub origin_context_snapshot_id: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeftListResponse {
    pub wefts: Vec<LoomDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistWeftTurnsRequest {
    pub source: Option<WeftSource>,
    pub origin_loom_id: String,
    pub origin_response_id: String,
    pub selected_text: Option<String>,
    pub fragment_hash: Option<String>,
    pub source_metadata: Option<Value>,
    pub turns: Vec<PersistWeftTurn>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistWeftTurn {
    pub id: Option<String>,
    pub question: String,
    pub answer: String,
    pub title: Option<String>,
    pub created_at: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistWeftTurnsResponse {
    pub weft_loom_id: String,
    pub responses: Vec<PersistedWeftTurnResponse>,
    pub origin_context_snapshot_id: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWeftTurnResponse {
    pub user_response_id: String,
    pub assistant_response_id: String,
    pub question: String,
    pub answer: String,
    pub title: Option<String>,
    pub sequence_index: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisibleWeftSeedResponse {
    pub response_id: String,
    pub role: String,
    pub content: String,
    pub title: Option<String>,
    pub sequence_index: i64,
    pub copied_from_response_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeftApiError {
    pub code: String,
    pub message: String,
}

pub async fn create_weft(
    State(state): State<AppState>,
    Json(input): Json<CreateWeftRequest>,
) -> Result<(StatusCode, Json<WeftResponse>), (StatusCode, Json<WeftApiError>)> {
    let origin_loom_id = required_trimmed("originLoomId", &input.origin_loom_id)?;
    let weft_kind = input.weft_kind.unwrap_or(WeftKind::Exploration);
    let origin_response_id = input
        .origin_response_id
        .as_deref()
        .map(|value| required_trimmed("originResponseId", value))
        .transpose()?;
    if origin_response_id.is_none() && weft_kind != WeftKind::Revision {
        return Err(bad_request(
            "INVALID_WEFT_ORIGIN",
            "Exploration Wefts require originResponseId.",
        ));
    }
    validate_metadata(input.metadata.as_ref())?;
    validate_revision_prompt_change(weft_kind, input.metadata.as_ref())?;

    let loom_repository = LoomRepository::new(&state.database);
    let origin_loom = loom_repository
        .get_loom(&origin_loom_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| not_found("ORIGIN_LOOM_NOT_FOUND", "Origin Loom was not found."))?;
    let origin_response = if let Some(origin_response_id) = origin_response_id.as_deref() {
        Some(
            ResponseRepository::new(&state.database)
                .get_response(origin_response_id)
                .await
                .map_err(storage_error)?
                .ok_or_else(|| {
                    not_found(
                        "ORIGIN_RESPONSE_NOT_FOUND",
                        "Origin Response was not found.",
                    )
                })?,
        )
    } else {
        None
    };
    if origin_response
        .as_ref()
        .is_some_and(|response| response.loom_id != origin_loom.loom_id)
    {
        return Err(bad_request(
            "ORIGIN_MISMATCH",
            "Origin Response must belong to the origin Loom.",
        ));
    }

    let source = input.source.unwrap_or(WeftSource::ResponseAction);
    let seed_mode = input
        .seed_mode
        .unwrap_or_else(|| default_seed_mode(source, weft_kind));
    let create_origin_context_snapshot = input.create_origin_context_snapshot.unwrap_or(true);
    let reuse_existing = input
        .reuse_existing
        .unwrap_or(weft_kind == WeftKind::Exploration);
    if reuse_existing {
        if let Some(existing) = matching_existing_weft(
            &loom_repository,
            &origin_loom_id,
            origin_response_id.as_deref(),
            weft_kind,
        )
        .await
        .map_err(storage_error)?
        {
            let (visible_seed_responses, mut warnings) = ensure_visible_weft_seed(
                &state.database,
                &existing.loom_id,
                &origin_loom_id,
                origin_response.as_ref(),
                seed_mode,
                &timestamp(),
            )
            .await?;
            let origin_context_snapshot_id = if create_origin_context_snapshot {
                if let Some(origin_response) = origin_response.as_ref() {
                    upsert_origin_context_snapshot(
                        &state.database,
                        &existing.loom_id,
                        &origin_loom,
                        origin_response,
                        None,
                        None,
                        input.metadata.as_ref(),
                        &timestamp(),
                    )
                    .await?
                } else {
                    None
                }
            } else {
                None
            };
            if seed_mode == WeftSeedMode::QuickAskTurns {
                warnings.push(
                    "Quick Ask visible seeds are persisted through /wefts/:id/responses."
                        .to_string(),
                );
            }
            return Ok((
                StatusCode::OK,
                Json(WeftResponse {
                    weft: loom_to_dto(existing),
                    created: false,
                    reused: true,
                    visible_seed_responses,
                    origin_context_snapshot_id,
                    warnings,
                }),
            ));
        }
    }

    let now = timestamp();
    let loom_id = generate_weft_id(
        origin_response_id
            .as_deref()
            .unwrap_or(origin_loom_id.as_str()),
    );
    let code = format!("W-{}", stable_suffix(&loom_id).to_ascii_uppercase());
    let canonical_uri = format!("loom://wefts/{loom_id}");
    let title = input
        .title
        .as_deref()
        .and_then(non_empty_trimmed)
        .or_else(|| {
            input
                .initial_prompt
                .as_deref()
                .and_then(non_empty_trimmed)
                .map(|prompt| weft_title_from_initial_prompt(weft_kind, &prompt))
        })
        .unwrap_or_else(|| {
            origin_response
                .as_ref()
                .map(derived_title)
                .unwrap_or_else(|| "Revision Weft".to_string())
        });
    let metadata_json = metadata_json(input.metadata, source, weft_kind)?;
    let new_weft = NewLoom {
        loom_id: loom_id.clone(),
        title,
        summary: input
            .summary
            .and_then(|summary| non_empty_trimmed(&summary)),
        code: Some(code),
        canonical_uri: Some(canonical_uri.clone()),
        kind: "weft".to_string(),
        origin_loom_id: Some(origin_loom_id.clone()),
        origin_response_id: origin_response_id.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
        metadata_json,
    };

    loom_repository
        .insert_loom(&new_weft)
        .await
        .map_err(storage_error)?;
    let created = loom_repository
        .get_loom(&loom_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| {
            storage_error(ServiceError::storage("created Weft could not be read back"))
        })?;
    insert_canonical_address(&state.database, &created, &canonical_uri, &now).await?;
    let (visible_seed_responses, mut warnings) = ensure_visible_weft_seed(
        &state.database,
        &created.loom_id,
        &origin_loom_id,
        origin_response.as_ref(),
        seed_mode,
        &now,
    )
    .await?;
    let origin_context_snapshot_id = if create_origin_context_snapshot {
        if let Some(origin_response) = origin_response.as_ref() {
            upsert_origin_context_snapshot(
                &state.database,
                &created.loom_id,
                &origin_loom,
                origin_response,
                None,
                None,
                None,
                &now,
            )
            .await?
        } else {
            None
        }
    } else {
        None
    };
    if seed_mode == WeftSeedMode::QuickAskTurns {
        warnings.push(
            "Quick Ask visible seeds are persisted through /wefts/:id/responses.".to_string(),
        );
    }

    Ok((
        StatusCode::CREATED,
        Json(WeftResponse {
            weft: loom_to_dto(created),
            created: true,
            reused: false,
            visible_seed_responses,
            origin_context_snapshot_id,
            warnings,
        }),
    ))
}

pub async fn list_wefts_for_loom(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<Json<WeftListResponse>, (StatusCode, Json<WeftApiError>)> {
    let repository = LoomRepository::new(&state.database);
    let wefts = repository
        .list_child_wefts_by_origin_loom(&loom_id)
        .await
        .map_err(storage_error)?;
    Ok(Json(WeftListResponse {
        wefts: wefts.into_iter().map(loom_to_dto).collect(),
    }))
}

pub async fn list_wefts_for_response(
    State(state): State<AppState>,
    Path(response_id): Path<String>,
) -> Result<Json<WeftListResponse>, (StatusCode, Json<WeftApiError>)> {
    let repository = LoomRepository::new(&state.database);
    let wefts = repository
        .list_wefts_by_origin_response(&response_id)
        .await
        .map_err(storage_error)?;
    Ok(Json(WeftListResponse {
        wefts: wefts.into_iter().map(loom_to_dto).collect(),
    }))
}

pub async fn persist_weft_responses(
    State(state): State<AppState>,
    Path(weft_loom_id): Path<String>,
    Json(input): Json<PersistWeftTurnsRequest>,
) -> Result<Json<PersistWeftTurnsResponse>, (StatusCode, Json<WeftApiError>)> {
    let origin_loom_id = required_trimmed("originLoomId", &input.origin_loom_id)?;
    let origin_response_id = required_trimmed("originResponseId", &input.origin_response_id)?;
    validate_metadata(input.source_metadata.as_ref())?;
    for turn in &input.turns {
        validate_metadata(turn.metadata.as_ref())?;
        required_trimmed("turn.question", &turn.question)?;
        required_trimmed("turn.answer", &turn.answer)?;
    }

    let loom_repository = LoomRepository::new(&state.database);
    let weft = loom_repository
        .get_loom(&weft_loom_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| not_found("WEFT_NOT_FOUND", "Weft Loom was not found."))?;
    if weft.kind != "weft" {
        return Err(bad_request(
            "INVALID_WEFT",
            "Responses can only be persisted into a Weft Loom.",
        ));
    }
    if weft.origin_loom_id.as_deref() != Some(origin_loom_id.as_str())
        || weft.origin_response_id.as_deref() != Some(origin_response_id.as_str())
    {
        return Err(bad_request(
            "ORIGIN_MISMATCH",
            "Weft origin metadata does not match the requested origin.",
        ));
    }

    let now = timestamp();
    let source = input.source.unwrap_or(WeftSource::QuickAskConvert);
    let mut pairs = Vec::with_capacity(input.turns.len());
    for (index, turn) in input.turns.iter().enumerate() {
        let question = required_trimmed("turn.question", &turn.question)?;
        let answer = required_trimmed("turn.answer", &turn.answer)?;
        let title = turn
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| quick_ask_turn_title(&question, &answer));
        let turn_key = turn.id.clone().unwrap_or_else(|| {
            format!(
                "{}-{}-{}-{}",
                origin_response_id,
                index,
                stable_hash(&question),
                stable_hash(&answer)
            )
        });
        let response_id_prefix = format!(
            "weft-turn-{}-{}",
            stable_suffix(&weft_loom_id),
            stable_hash(&turn_key)
        );
        let metadata = response_metadata_json(
            source,
            &origin_loom_id,
            &origin_response_id,
            input.selected_text.as_deref(),
            input.fragment_hash.as_deref(),
            input.source_metadata.clone(),
            turn.metadata.clone(),
            Some(&turn_key),
            index,
        )?;
        let created_at = turn.created_at.clone().unwrap_or_else(|| now.clone());
        pairs.push((
            NewResponse {
                response_id: format!("{response_id_prefix}-user"),
                loom_id: weft_loom_id.clone(),
                role: "user".to_string(),
                content: question,
                title: Some(title.clone()),
                code: None,
                canonical_uri: None,
                created_at: created_at.clone(),
                updated_at: now.clone(),
                sequence_index: 0,
                metadata_json: metadata.clone(),
            },
            NewResponse {
                response_id: format!("{response_id_prefix}-assistant"),
                loom_id: weft_loom_id.clone(),
                role: "assistant".to_string(),
                content: answer,
                title: Some(title),
                code: None,
                canonical_uri: None,
                created_at,
                updated_at: now.clone(),
                sequence_index: 0,
                metadata_json: metadata,
            },
        ));
    }

    let persisted = ResponseRepository::new(&state.database)
        .insert_response_pairs_if_missing_at_next_sequence(pairs)
        .await
        .map_err(storage_error)?;
    let origin_response = ResponseRepository::new(&state.database)
        .get_response(&origin_response_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| {
            not_found(
                "ORIGIN_RESPONSE_NOT_FOUND",
                "Origin Response was not found.",
            )
        })?;
    let origin_loom = LoomRepository::new(&state.database)
        .get_loom(&origin_loom_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| not_found("ORIGIN_LOOM_NOT_FOUND", "Origin Loom was not found."))?;
    let origin_context_snapshot_id = upsert_origin_context_snapshot(
        &state.database,
        &weft_loom_id,
        &origin_loom,
        &origin_response,
        input.selected_text.as_deref(),
        input.fragment_hash.as_deref(),
        input.source_metadata.as_ref(),
        &now,
    )
    .await?;
    Ok(Json(PersistWeftTurnsResponse {
        weft_loom_id,
        responses: persisted
            .into_iter()
            .map(|(user, assistant)| PersistedWeftTurnResponse {
                user_response_id: user.response_id,
                assistant_response_id: assistant.response_id,
                question: user.content,
                answer: assistant.content,
                title: assistant.title,
                sequence_index: user.sequence_index,
            })
            .collect(),
        origin_context_snapshot_id,
        warnings: Vec::new(),
    }))
}

async fn matching_existing_weft(
    repository: &LoomRepository,
    origin_loom_id: &str,
    origin_response_id: Option<&str>,
    weft_kind: WeftKind,
) -> Result<Option<LoomRecord>, ServiceError> {
    let Some(origin_response_id) = origin_response_id else {
        return Ok(None);
    };
    let wefts = repository
        .list_wefts_by_origin_response(origin_response_id)
        .await?;
    Ok(wefts.into_iter().find(|weft| {
        weft.origin_loom_id.as_deref() == Some(origin_loom_id)
            && persisted_weft_kind(weft) == weft_kind
    }))
}

fn persisted_weft_kind(loom: &LoomRecord) -> WeftKind {
    loom.metadata_json
        .as_deref()
        .and_then(|metadata| serde_json::from_str::<Value>(metadata).ok())
        .and_then(|metadata| {
            metadata
                .get("weftKind")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .as_deref()
        .map(|kind| {
            if kind == WeftKind::Revision.as_str() {
                WeftKind::Revision
            } else {
                WeftKind::Exploration
            }
        })
        .unwrap_or(WeftKind::Exploration)
}

fn default_seed_mode(source: WeftSource, _weft_kind: WeftKind) -> WeftSeedMode {
    match source {
        WeftSource::QuickAskConvert
        | WeftSource::ResponseAction
        | WeftSource::GraphNode
        | WeftSource::Reference => WeftSeedMode::None,
    }
}

fn weft_title_from_initial_prompt(weft_kind: WeftKind, prompt: &str) -> String {
    let prefix = if weft_kind == WeftKind::Revision {
        "Revision: "
    } else {
        "Loom: "
    };
    format!("{prefix}{}", compact_prompt_title(prompt))
}

fn compact_prompt_title(prompt: &str) -> String {
    let normalized = prompt
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '*' | '#' | '-' | '•' | '|'))
        .trim()
        .to_string();
    if normalized.is_empty() {
        return "Untitled".to_string();
    }
    truncate_at_word_boundary(&normalized, 72)
}

fn truncate_at_word_boundary(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut last_boundary = 0;
    let mut end_byte = value.len();
    for (char_index, (byte_index, ch)) in value.char_indices().enumerate() {
        if char_index >= max_chars {
            end_byte = byte_index;
            break;
        }
        if ch.is_whitespace() || matches!(ch, ',' | ';' | ':' | '.' | '?' | '!') {
            last_boundary = byte_index;
        }
    }
    let cut = if last_boundary >= max_chars / 2 {
        last_boundary
    } else {
        end_byte
    };
    value[..cut]
        .trim_end_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, ',' | ';' | ':' | '.' | '-' | '—' | '–')
        })
        .to_string()
}

async fn ensure_visible_weft_seed(
    database: &crate::storage::db::Database,
    weft_loom_id: &str,
    origin_loom_id: &str,
    origin_response: Option<&ResponseRecord>,
    seed_mode: WeftSeedMode,
    now: &str,
) -> Result<(Vec<VisibleWeftSeedResponse>, Vec<String>), (StatusCode, Json<WeftApiError>)> {
    match seed_mode {
        WeftSeedMode::None | WeftSeedMode::QuickAskTurns => Ok((Vec::new(), Vec::new())),
        WeftSeedMode::OriginQaPair | WeftSeedMode::RevisionLineage => {
            let Some(origin_response) = origin_response else {
                return Ok((
                    Vec::new(),
                    vec!["Revision Weft root origin has no previous Response seed.".to_string()],
                ));
            };
            let response_repository = ResponseRepository::new(database);
            let origin_responses = response_repository
                .list_responses_for_loom(origin_loom_id)
                .await
                .map_err(storage_error)?;
            let mut warnings = Vec::new();
            let mut seed_responses = Vec::new();
            if seed_mode == WeftSeedMode::RevisionLineage {
                for copied_response in origin_responses
                    .iter()
                    .filter(|response| response.sequence_index <= origin_response.sequence_index)
                {
                    seed_responses.push(visible_seed_response_from_origin(
                        weft_loom_id,
                        origin_loom_id,
                        origin_response,
                        copied_response,
                        "revision_lineage",
                        now,
                    )?);
                }
            } else {
                let origin_user_response = origin_responses
                    .iter()
                    .filter(|response| {
                        response.role == "user"
                            && response.sequence_index < origin_response.sequence_index
                    })
                    .max_by_key(|response| response.sequence_index)
                    .cloned();
                if let Some(user_response) = origin_user_response {
                    seed_responses.push(visible_seed_response_from_origin(
                        weft_loom_id,
                        origin_loom_id,
                        origin_response,
                        &user_response,
                        "origin_qa_pair",
                        now,
                    )?);
                } else {
                    warnings.push(
                        "Origin user Response was unavailable; visible seed contains only the assistant Response."
                            .to_string(),
                    );
                }
                seed_responses.push(visible_seed_response_from_origin(
                    weft_loom_id,
                    origin_loom_id,
                    origin_response,
                    origin_response,
                    "origin_qa_pair",
                    now,
                )?);
            }
            let persisted = response_repository
                .insert_responses_if_missing_at_next_sequence(seed_responses)
                .await
                .map_err(storage_error)?;
            Ok((
                persisted
                    .into_iter()
                    .map(visible_seed_response_to_dto)
                    .collect(),
                warnings,
            ))
        }
    }
}

fn visible_seed_response_from_origin(
    weft_loom_id: &str,
    origin_loom_id: &str,
    origin_response: &ResponseRecord,
    copied_response: &ResponseRecord,
    seed_kind: &str,
    now: &str,
) -> Result<NewResponse, (StatusCode, Json<WeftApiError>)> {
    let role_suffix = if copied_response.role == "user" {
        "user"
    } else {
        "assistant"
    };
    Ok(NewResponse {
        response_id: format!(
            "weft-seed-{}-{}-{role_suffix}",
            stable_suffix(weft_loom_id),
            stable_hash(&copied_response.response_id)
        ),
        loom_id: weft_loom_id.to_string(),
        role: copied_response.role.clone(),
        content: copied_response.content.clone(),
        title: copied_response.title.clone(),
        code: None,
        canonical_uri: None,
        created_at: now.to_string(),
        updated_at: now.to_string(),
        sequence_index: 0,
        metadata_json: visible_seed_metadata_json(
            origin_loom_id,
            &origin_response.response_id,
            &copied_response.response_id,
            seed_kind,
        )?,
    })
}

fn visible_seed_metadata_json(
    origin_loom_id: &str,
    origin_response_id: &str,
    copied_from_response_id: &str,
    seed_kind: &str,
) -> Result<Option<String>, (StatusCode, Json<WeftApiError>)> {
    let value = serde_json::json!({
        "source": "weft_visible_seed",
        "seedKind": seed_kind,
        "originLoomId": origin_loom_id,
        "originResponseId": origin_response_id,
        "copiedFromResponseId": copied_from_response_id,
    });
    validate_metadata(Some(&value))?;
    serde_json::to_string(&value).map(Some).map_err(|error| {
        bad_request(
            "INVALID_METADATA",
            &format!("Visible Weft seed metadata must be JSON serializable: {error}"),
        )
    })
}

fn visible_seed_response_to_dto(response: ResponseRecord) -> VisibleWeftSeedResponse {
    let copied_from_response_id = response
        .metadata_json
        .as_deref()
        .and_then(|metadata| serde_json::from_str::<Value>(metadata).ok())
        .and_then(|metadata| {
            metadata
                .get("copiedFromResponseId")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        });
    VisibleWeftSeedResponse {
        response_id: response.response_id,
        role: response.role,
        content: response.content,
        title: response.title,
        sequence_index: response.sequence_index,
        copied_from_response_id,
    }
}

async fn upsert_origin_context_snapshot(
    database: &crate::storage::db::Database,
    weft_loom_id: &str,
    origin_loom: &LoomRecord,
    origin_response: &ResponseRecord,
    selected_text: Option<&str>,
    fragment_hash: Option<&str>,
    source_metadata: Option<&Value>,
    now: &str,
) -> Result<Option<String>, (StatusCode, Json<WeftApiError>)> {
    let repository = ContextArtifactsRepository::new(database);
    let origin_loom_id = origin_loom.loom_id.as_str();
    let capsule = repository
        .get_response_capsule(&origin_response.response_id)
        .await
        .map_err(storage_error)?;
    let previous_user_response =
        immediate_previous_user_response(database, origin_loom_id, origin_response).await?;
    let mut snapshot = Map::new();
    snapshot.insert(
        "kind".to_string(),
        Value::String("weft_origin_context_snapshot".to_string()),
    );
    snapshot.insert(
        "originLoomId".to_string(),
        Value::String(origin_loom_id.to_string()),
    );
    snapshot.insert(
        "originResponseId".to_string(),
        Value::String(origin_response.response_id.clone()),
    );
    snapshot.insert("originLoom".to_string(), loom_snapshot_json(origin_loom));
    snapshot.insert(
        "originResponse".to_string(),
        response_snapshot_json(origin_response),
    );
    if let Some(previous_user_response) = previous_user_response.as_ref() {
        snapshot.insert(
            "previousUserResponse".to_string(),
            response_snapshot_json(previous_user_response),
        );
    }
    if let Some(selected_text) = selected_text.and_then(non_empty_trimmed) {
        snapshot.insert("selectedText".to_string(), Value::String(selected_text));
    }
    if let Some(fragment_hash) = fragment_hash.and_then(non_empty_trimmed) {
        snapshot.insert("fragmentHash".to_string(), Value::String(fragment_hash));
    }
    if let Some(capsule) = capsule.as_ref() {
        snapshot.insert(
            "originCapsuleId".to_string(),
            Value::String(capsule.capsule_id.clone()),
        );
        if let Some(summary) = capsule.summary.as_deref().and_then(non_empty_trimmed) {
            snapshot.insert("originCapsuleSummary".to_string(), Value::String(summary));
        }
    }
    if let Some(source_metadata) = source_metadata {
        validate_metadata(Some(source_metadata))?;
        snapshot.insert("sourceMetadata".to_string(), source_metadata.clone());
    }
    let origin_summary = serde_json::to_string(&Value::Object(snapshot)).map_err(|error| {
        bad_request(
            "INVALID_METADATA",
            &format!("Weft origin context snapshot must be JSON serializable: {error}"),
        )
    })?;
    validate_metadata(Some(
        &serde_json::from_str::<Value>(&origin_summary).map_err(|error| {
            bad_request(
                "INVALID_METADATA",
                &format!("Weft origin context snapshot must be valid JSON: {error}"),
            )
        })?,
    ))?;
    let context_id = format!(
        "weft-origin-context-{}-{}",
        stable_suffix(weft_loom_id),
        stable_hash(&origin_response.response_id)
    );
    repository
        .upsert_weft_origin_context(&UpsertWeftOriginContext {
            context_id: context_id.clone(),
            weft_loom_id: weft_loom_id.to_string(),
            origin_loom_id: origin_loom_id.to_string(),
            origin_response_id: origin_response.response_id.clone(),
            origin_capsule_id: capsule.map(|capsule| capsule.capsule_id),
            origin_summary: Some(origin_summary.clone()),
            source_hash: Some(stable_hash(&origin_summary)),
            status: "ready".to_string(),
            created_at: now.to_string(),
            updated_at: now.to_string(),
        })
        .await
        .map_err(storage_error)?;
    Ok(Some(context_id))
}

async fn immediate_previous_user_response(
    database: &crate::storage::db::Database,
    origin_loom_id: &str,
    origin_response: &ResponseRecord,
) -> Result<Option<ResponseRecord>, (StatusCode, Json<WeftApiError>)> {
    if origin_response.role != "assistant" {
        return Ok(None);
    }
    let responses = ResponseRepository::new(database)
        .list_responses_for_loom(origin_loom_id)
        .await
        .map_err(storage_error)?;
    Ok(responses
        .into_iter()
        .filter(|response| {
            response.role == "user" && response.sequence_index < origin_response.sequence_index
        })
        .max_by_key(|response| response.sequence_index))
}

fn loom_snapshot_json(loom: &LoomRecord) -> Value {
    let mut value = Map::new();
    value.insert("loomId".to_string(), Value::String(loom.loom_id.clone()));
    value.insert(
        "title".to_string(),
        bounded_safe_string_value(&loom.title, ORIGIN_SNAPSHOT_TITLE_LIMIT),
    );
    if let Some(code) = loom.code.as_deref().and_then(non_empty_trimmed) {
        value.insert("code".to_string(), Value::String(code));
    }
    if let Some(canonical_uri) = loom.canonical_uri.as_deref().and_then(non_empty_trimmed) {
        value.insert("canonicalUri".to_string(), Value::String(canonical_uri));
    }
    Value::Object(value)
}

fn response_snapshot_json(response: &ResponseRecord) -> Value {
    let mut value = Map::new();
    value.insert(
        "responseId".to_string(),
        Value::String(response.response_id.clone()),
    );
    value.insert("role".to_string(), Value::String(response.role.clone()));
    value.insert(
        "sequenceIndex".to_string(),
        Value::Number(response.sequence_index.into()),
    );
    if let Some(title) = response.title.as_deref().and_then(non_empty_trimmed) {
        value.insert(
            "title".to_string(),
            bounded_safe_string_value(&title, ORIGIN_SNAPSHOT_TITLE_LIMIT),
        );
    }
    if let Some(code) = response.code.as_deref().and_then(non_empty_trimmed) {
        value.insert("code".to_string(), Value::String(code));
    }
    if let Some(canonical_uri) = response
        .canonical_uri
        .as_deref()
        .and_then(non_empty_trimmed)
    {
        value.insert("canonicalUri".to_string(), Value::String(canonical_uri));
    }
    if let Some(content) = bounded_safe_content_value(&response.content) {
        value.insert("content".to_string(), content);
    } else {
        value.insert(
            "contentOmittedReason".to_string(),
            Value::String("raw_thinking_marker".to_string()),
        );
    }
    Value::Object(value)
}

fn bounded_safe_string_value(value: &str, max_chars: usize) -> Value {
    Value::String(truncate_at_word_boundary(value, max_chars))
}

fn bounded_safe_content_value(value: &str) -> Option<Value> {
    if contains_forbidden_thinking_marker(value) {
        return None;
    }
    Some(Value::String(truncate_at_word_boundary(
        value,
        ORIGIN_SNAPSHOT_CONTENT_LIMIT,
    )))
}

fn contains_forbidden_thinking_marker(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| lowered.contains(&key.to_ascii_lowercase()))
}

async fn insert_canonical_address(
    database: &crate::storage::db::Database,
    loom: &LoomRecord,
    canonical_uri: &str,
    now: &str,
) -> Result<(), (StatusCode, Json<WeftApiError>)> {
    if let Some(existing) = AddressRepository::new(database)
        .resolve_address(canonical_uri)
        .await
        .map_err(storage_error)?
    {
        if existing.object_id != loom.loom_id {
            return Err(conflict(
                "CANONICAL_URI_IN_USE",
                "Canonical URI already belongs to another object.",
            ));
        }
    }
    AddressRepository::new(database)
        .insert_address_if_missing(&NewAddress {
            address_id: format!(
                "address-weft-{}-{}",
                loom.loom_id,
                stable_suffix(canonical_uri)
            ),
            object_kind: "loom".to_string(),
            object_id: loom.loom_id.clone(),
            canonical_uri: canonical_uri.to_string(),
            created_at: now.to_string(),
        })
        .await
        .map_err(storage_error)?;
    Ok(())
}

fn loom_to_dto(loom: LoomRecord) -> LoomDto {
    let display_code = display_code(DisplayCodeKind::Weft, &loom.loom_id);
    LoomDto {
        loom_id: loom.loom_id,
        title: loom.title,
        summary: loom.summary,
        kind: loom.kind,
        origin_loom_id: loom.origin_loom_id,
        origin_response_id: loom.origin_response_id,
        canonical_uri: loom.canonical_uri,
        code: loom.code,
        display_code,
        created_at: loom.created_at,
        updated_at: loom.updated_at,
        metadata: loom
            .metadata_json
            .as_deref()
            .and_then(|metadata| serde_json::from_str(metadata).ok()),
        responses: Vec::new(),
    }
}

fn derived_title(response: &ResponseRecord) -> String {
    response
        .title
        .as_deref()
        .and_then(non_empty_trimmed)
        .or_else(|| response.code.as_deref().and_then(non_empty_trimmed))
        .map(|label| format!("Weft from {label}"))
        .unwrap_or_else(|| format!("Weft from {}", response.response_id))
}

fn quick_ask_turn_title(question: &str, answer: &str) -> String {
    let source = answer
        .split(['.', '!', '?'])
        .find(|part| !part.trim().is_empty())
        .unwrap_or(question);
    let normalized = source.split_whitespace().collect::<Vec<_>>().join(" ");
    let title = normalized
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '*' | '#' | '-' | '•'))
        .trim();
    if title.is_empty() {
        return "Quick Ask".to_string();
    }
    title.chars().take(72).collect()
}

fn required_trimmed(
    field: &'static str,
    value: &str,
) -> Result<String, (StatusCode, Json<WeftApiError>)> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(bad_request(
            "INVALID_WEFT",
            &format!("{field} is required."),
        ));
    }
    Ok(trimmed.to_string())
}

fn non_empty_trimmed(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn validate_metadata(metadata: Option<&Value>) -> Result<(), (StatusCode, Json<WeftApiError>)> {
    let Some(metadata) = metadata else {
        return Ok(());
    };
    if contains_forbidden_key(metadata) {
        return Err(bad_request(
            "RAW_THINKING_REJECTED",
            "Weft metadata contains forbidden raw thinking fields.",
        ));
    }
    Ok(())
}

fn validate_revision_prompt_change(
    weft_kind: WeftKind,
    metadata: Option<&Value>,
) -> Result<(), (StatusCode, Json<WeftApiError>)> {
    if weft_kind != WeftKind::Revision {
        return Ok(());
    }
    let Some(metadata) = metadata else {
        return Ok(());
    };
    let Some(original_prompt) = metadata_string(metadata, "originalPrompt") else {
        return Ok(());
    };
    let Some(revision_prompt) = metadata_string(metadata, "revisionPrompt") else {
        return Ok(());
    };
    if normalize_prompt_edit_text(original_prompt) == normalize_prompt_edit_text(revision_prompt) {
        return Err(conflict(
            "PROMPT_REVISION_UNCHANGED",
            "Revision Weft requires a changed prompt.",
        ));
    }
    Ok(())
}

fn metadata_string<'a>(metadata: &'a Value, key: &str) -> Option<&'a str> {
    metadata.as_object()?.get(key)?.as_str()
}

fn normalize_prompt_edit_text(value: &str) -> String {
    let without_nbsp = value.replace('\u{00a0}', " ");
    let mut normalized = without_nbsp
        .lines()
        .map(|line| line.trim_matches(|character| character == ' ' || character == '\t'))
        .collect::<Vec<_>>()
        .join("\n");
    while normalized.contains("\n\n\n") {
        normalized = normalized.replace("\n\n\n", "\n\n");
    }
    normalized.trim().to_string()
}

fn contains_forbidden_key(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, value)| {
            FORBIDDEN_THINKING_KEYS.contains(&key.as_str()) || contains_forbidden_key(value)
        }),
        Value::Array(values) => values.iter().any(contains_forbidden_key),
        _ => false,
    }
}

fn metadata_json(
    metadata: Option<Value>,
    source: WeftSource,
    weft_kind: WeftKind,
) -> Result<Option<String>, (StatusCode, Json<WeftApiError>)> {
    let mut object = match metadata {
        Some(Value::Object(map)) => map,
        Some(_) => {
            return Err(bad_request(
                "INVALID_METADATA",
                "Weft metadata must be a JSON object.",
            ))
        }
        None => Map::new(),
    };
    object.insert(
        "source".to_string(),
        Value::String(source.as_str().to_string()),
    );
    object.insert(
        "weftKind".to_string(),
        Value::String(weft_kind.as_str().to_string()),
    );
    serde_json::to_string(&Value::Object(object))
        .map(Some)
        .map_err(|error| {
            bad_request(
                "INVALID_METADATA",
                &format!("Weft metadata must be JSON serializable: {error}"),
            )
        })
}

fn response_metadata_json(
    source: WeftSource,
    origin_loom_id: &str,
    origin_response_id: &str,
    selected_text: Option<&str>,
    fragment_hash: Option<&str>,
    source_metadata: Option<Value>,
    turn_metadata: Option<Value>,
    ask_session_turn_id: Option<&str>,
    turn_index: usize,
) -> Result<Option<String>, (StatusCode, Json<WeftApiError>)> {
    let mut object = Map::new();
    object.insert(
        "source".to_string(),
        Value::String(source.as_str().to_string()),
    );
    object.insert(
        "seedKind".to_string(),
        Value::String("quick_ask_turn".to_string()),
    );
    object.insert(
        "originLoomId".to_string(),
        Value::String(origin_loom_id.to_string()),
    );
    object.insert(
        "originResponseId".to_string(),
        Value::String(origin_response_id.to_string()),
    );
    object.insert("turnIndex".to_string(), Value::from(turn_index as u64));
    if let Some(selected_text) = selected_text.and_then(non_empty_trimmed) {
        object.insert("selectedText".to_string(), Value::String(selected_text));
    }
    if let Some(fragment_hash) = fragment_hash.and_then(non_empty_trimmed) {
        object.insert("fragmentHash".to_string(), Value::String(fragment_hash));
    }
    if let Some(ask_session_turn_id) = ask_session_turn_id.and_then(non_empty_trimmed) {
        object.insert(
            "askTurnId".to_string(),
            Value::String(ask_session_turn_id.clone()),
        );
        object.insert(
            "askSessionTurnId".to_string(),
            Value::String(ask_session_turn_id),
        );
    }
    if let Some(source_metadata) = source_metadata {
        object.insert("sourceMetadata".to_string(), source_metadata);
    }
    if let Some(turn_metadata) = turn_metadata {
        object.insert("turnMetadata".to_string(), turn_metadata);
    }
    validate_metadata(Some(&Value::Object(object.clone())))?;
    serde_json::to_string(&Value::Object(object))
        .map(Some)
        .map_err(|error| {
            bad_request(
                "INVALID_METADATA",
                &format!("Weft Response metadata must be JSON serializable: {error}"),
            )
        })
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<WeftApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(WeftApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn conflict(code: &str, message: &str) -> (StatusCode, Json<WeftApiError>) {
    (
        StatusCode::CONFLICT,
        Json(WeftApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn not_found(code: &str, message: &str) -> (StatusCode, Json<WeftApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(WeftApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn storage_error(error: ServiceError) -> (StatusCode, Json<WeftApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(WeftApiError {
            code: "WEFT_STORAGE_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}

fn generate_weft_id(origin_response_id: &str) -> String {
    format!("weft-{}-{}", stable_suffix(origin_response_id), timestamp())
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn stable_suffix(value: &str) -> String {
    let suffix = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(48)
        .collect::<String>();
    if suffix.is_empty() {
        "origin".to_string()
    } else {
        suffix
    }
}

fn stable_hash(value: &str) -> String {
    let mut hash = 0x811c9dc5_u32;
    for byte in value.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

#[cfg(test)]
mod tests {
    use super::{
        create_weft, list_wefts_for_loom, list_wefts_for_response, persist_weft_responses,
        CreateWeftRequest, PersistWeftTurn, PersistWeftTurnsRequest, WeftKind, WeftSource,
        ORIGIN_SNAPSHOT_CONTENT_LIMIT,
    };
    use crate::{
        api::{graph::build_graph_projection, resolve::resolve_address, state::AppState},
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::{
            db::test_database,
            repositories::{
                context_artifacts::ContextArtifactsRepository,
                looms::{LoomRepository, NewLoom},
                responses::{NewResponse, ResponseRepository},
            },
        },
    };
    use axum::{
        extract::{Path, State},
        http::StatusCode,
        Json,
    };
    use serde_json::json;
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn post_wefts_creates_new_weft_loom() {
        let state = seeded_state().await;
        let response = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft");

        assert_eq!(response.0, StatusCode::CREATED);
        assert!(response.1 .0.created);
        assert!(!response.1 .0.reused);
        assert_eq!(response.1 .0.weft.kind, "weft");
        assert_eq!(
            response.1 .0.weft.origin_loom_id.as_deref(),
            Some("origin-loom")
        );
        assert_eq!(
            response.1 .0.weft.origin_response_id.as_deref(),
            Some("origin-response")
        );
    }

    #[tokio::test]
    async fn post_wefts_can_title_from_initial_prompt() {
        let state = seeded_state().await;
        let mut request = response_action_request(false);
        request.title = None;
        request.initial_prompt = Some("Bunu maliyet açısından değerlendir.".to_string());

        let response = create_weft(State(state.clone()), Json(request))
            .await
            .expect("create Weft")
            .1
             .0;

        assert_eq!(
            response.weft.title,
            "Loom: Bunu maliyet açısından değerlendir."
        );
    }

    #[tokio::test]
    async fn normal_response_weft_keeps_visible_seed_empty_by_default() {
        let state = seeded_state().await;
        let response = create_weft(State(state.clone()), Json(response_action_request(true)))
            .await
            .expect("create Weft")
            .1
             .0;

        assert!(response.visible_seed_responses.is_empty());

        let persisted = ResponseRepository::new(&state.database)
            .list_responses_for_loom(&response.weft.loom_id)
            .await
            .expect("list seed responses");
        assert!(persisted.is_empty());
    }

    #[tokio::test]
    async fn normal_response_weft_seed_is_idempotent_on_repeated_call() {
        let state = seeded_state().await;
        let first = create_weft(State(state.clone()), Json(response_action_request(true)))
            .await
            .expect("create Weft")
            .1
             .0;
        let second = create_weft(State(state.clone()), Json(response_action_request(true)))
            .await
            .expect("reuse Weft")
            .1
             .0;

        assert_eq!(second.weft.loom_id, first.weft.loom_id);
        assert!(second.reused);
        assert!(second.visible_seed_responses.is_empty());
        let persisted = ResponseRepository::new(&state.database)
            .list_responses_for_loom(&first.weft.loom_id)
            .await
            .expect("list seed responses");
        assert!(persisted.is_empty());
    }

    #[tokio::test]
    async fn normal_response_weft_creates_hidden_origin_context_snapshot() {
        let state = seeded_state().await;
        let response = create_weft(State(state.clone()), Json(response_action_request(true)))
            .await
            .expect("create Weft")
            .1
             .0;

        let context_id = response
            .origin_context_snapshot_id
            .expect("origin context snapshot id");
        let context = ContextArtifactsRepository::new(&state.database)
            .get_weft_origin_context(&response.weft.loom_id)
            .await
            .expect("get context")
            .expect("context exists");
        assert_eq!(context.context_id, context_id);
        assert_eq!(context.origin_response_id, "origin-response");
        let summary = context.origin_summary.expect("origin summary");
        assert!(summary.contains("weft_origin_context_snapshot"));
        assert!(summary.contains("Origin Loom"));
        assert!(summary.contains("Origin question"));
        assert!(summary.contains("Origin content"));
        assert!(summary.contains("previousUserResponse"));
        assert!(summary.contains("originResponse"));
        assert!(!summary.contains("raw_thinking"));
    }

    #[tokio::test]
    async fn hidden_origin_context_snapshot_does_not_require_response_capsule() {
        let state = seeded_state().await;
        let response = create_weft(State(state.clone()), Json(response_action_request(false)))
            .await
            .expect("create Weft")
            .1
             .0;

        let context = ContextArtifactsRepository::new(&state.database)
            .get_weft_origin_context(&response.weft.loom_id)
            .await
            .expect("get context")
            .expect("context exists");
        let summary = context.origin_summary.expect("origin summary");
        let value: serde_json::Value = serde_json::from_str(&summary).expect("summary json");

        assert_eq!(value["originLoomId"], json!("origin-loom"));
        assert_eq!(value["originResponseId"], json!("origin-response"));
        assert_eq!(value["originLoom"]["title"], json!("Origin Loom"));
        assert_eq!(value["originLoom"]["code"], json!("L-ORIGIN"));
        assert_eq!(value["originResponse"]["role"], json!("assistant"));
        assert_eq!(value["originResponse"]["sequenceIndex"], json!(1));
        assert_eq!(value["originResponse"]["content"], json!("Origin content"));
        assert_eq!(value["previousUserResponse"]["role"], json!("user"));
        assert_eq!(
            value["previousUserResponse"]["content"],
            json!("Origin question")
        );
    }

    #[tokio::test]
    async fn hidden_origin_context_snapshot_excludes_raw_thinking_keys() {
        let state = seeded_state().await;
        let response = create_weft(State(state.clone()), Json(response_action_request(false)))
            .await
            .expect("create Weft")
            .1
             .0;
        let context = ContextArtifactsRepository::new(&state.database)
            .get_weft_origin_context(&response.weft.loom_id)
            .await
            .expect("get context")
            .expect("context exists");
        let summary = context.origin_summary.expect("origin summary");
        let value: serde_json::Value = serde_json::from_str(&summary).expect("summary json");

        assert_eq!(value["originResponse"]["content"], json!("Origin content"));
        assert!(!summary.contains("raw_thinking"));
        assert!(!summary.contains("thinking_text"));
        assert!(!summary.contains("chain_of_thought"));
        assert!(!summary.contains("hidden_reasoning"));
    }

    #[tokio::test]
    async fn hidden_origin_context_snapshot_truncates_large_content() {
        let state = seeded_state().await;
        let long_content = format!("{} final boundary", "context ".repeat(2_000));
        ResponseRepository::new(&state.database)
            .insert_response(&NewResponse {
                response_id: "long-origin-response".to_string(),
                loom_id: "origin-loom".to_string(),
                role: "assistant".to_string(),
                content: long_content,
                title: Some("Long Origin Response".to_string()),
                code: Some("R-LONG".to_string()),
                canonical_uri: None,
                created_at: "2026-05-08T00:00:04Z".to_string(),
                updated_at: "2026-05-08T00:00:04Z".to_string(),
                sequence_index: 2,
                metadata_json: None,
            })
            .await
            .expect("insert long response");
        let request = CreateWeftRequest {
            origin_response_id: Some("long-origin-response".to_string()),
            reuse_existing: Some(false),
            ..response_action_request(false)
        };

        let response = create_weft(State(state.clone()), Json(request))
            .await
            .expect("create Weft")
            .1
             .0;
        let context = ContextArtifactsRepository::new(&state.database)
            .get_weft_origin_context(&response.weft.loom_id)
            .await
            .expect("get context")
            .expect("context exists");
        let summary = context.origin_summary.expect("origin summary");
        let value: serde_json::Value = serde_json::from_str(&summary).expect("summary json");
        let content = value["originResponse"]["content"]
            .as_str()
            .expect("origin content");

        assert!(content.len() <= ORIGIN_SNAPSHOT_CONTENT_LIMIT);
        assert!(!content.contains("final boundary"));
    }

    #[tokio::test]
    async fn revision_weft_persists_kind_without_visible_lineage_or_deleting_origin() {
        let state = seeded_state().await;
        let response_repository = ResponseRepository::new(&state.database);
        response_repository
            .insert_response(&NewResponse {
                response_id: "prompt-b".to_string(),
                loom_id: "origin-loom".to_string(),
                role: "user".to_string(),
                content: "Prompt B".to_string(),
                title: Some("Prompt B".to_string()),
                code: None,
                canonical_uri: None,
                created_at: "2026-05-08T00:00:03Z".to_string(),
                updated_at: "2026-05-08T00:00:03Z".to_string(),
                sequence_index: 2,
                metadata_json: None,
            })
            .await
            .expect("insert prompt b");
        response_repository
            .insert_response(&NewResponse {
                response_id: "response-b".to_string(),
                loom_id: "origin-loom".to_string(),
                role: "assistant".to_string(),
                content: "Response B".to_string(),
                title: Some("Response B".to_string()),
                code: None,
                canonical_uri: None,
                created_at: "2026-05-08T00:00:04Z".to_string(),
                updated_at: "2026-05-08T00:00:04Z".to_string(),
                sequence_index: 3,
                metadata_json: None,
            })
            .await
            .expect("insert response b");

        let mut request = response_action_request(false);
        request.weft_kind = Some(WeftKind::Revision);
        request.title = Some("Revision Weft".to_string());
        let response = create_weft(State(state.clone()), Json(request))
            .await
            .expect("create revision Weft")
            .1
             .0;

        assert_eq!(
            response.weft.origin_response_id.as_deref(),
            Some("origin-response")
        );
        assert_eq!(
            response
                .weft
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("weftKind")),
            Some(&json!("revision"))
        );
        assert!(response.visible_seed_responses.is_empty());
        let revision_responses = response_repository
            .list_responses_for_loom(&response.weft.loom_id)
            .await
            .expect("list revision responses");
        assert!(revision_responses.is_empty());
        let origin_responses = response_repository
            .list_responses_for_loom("origin-loom")
            .await
            .expect("list origin responses");
        assert_eq!(
            origin_responses
                .iter()
                .map(|response| response.content.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Origin question",
                "Origin content",
                "Prompt B",
                "Response B"
            ]
        );
    }

    #[tokio::test]
    async fn revision_weft_rejects_unchanged_prompt_metadata() {
        let state = seeded_state().await;
        let mut request = response_action_request(false);
        request.weft_kind = Some(WeftKind::Revision);
        request.metadata = Some(json!({
            "editSource": "prompt_edit",
            "editedResponseId": "origin-response",
            "originalPrompt": "Prompt B\n\nDetail",
            "revisionPrompt": " Prompt B \n\n\n Detail ",
        }));

        let error = create_weft(State(state.clone()), Json(request))
            .await
            .expect_err("unchanged prompt revision should fail");

        assert_eq!(error.0, StatusCode::CONFLICT);
        assert_eq!(error.1 .0.code, "PROMPT_REVISION_UNCHANGED");
        let wefts = LoomRepository::new(&state.database)
            .list_child_wefts_by_origin_loom("origin-loom")
            .await
            .expect("list child Wefts");
        assert!(wefts.is_empty());
    }

    #[tokio::test]
    async fn post_wefts_reuses_existing_when_requested() {
        let state = seeded_state().await;
        let first = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft")
            .1
             .0;
        let second = create_weft(State(state), Json(create_request(true)))
            .await
            .expect("reuse Weft");

        assert_eq!(second.0, StatusCode::OK);
        assert!(!second.1 .0.created);
        assert!(second.1 .0.reused);
        assert_eq!(second.1 .0.weft.loom_id, first.weft.loom_id);
    }

    #[tokio::test]
    async fn post_wefts_can_create_another_for_same_origin() {
        let state = seeded_state().await;
        let first = create_weft(State(state.clone()), Json(create_request(false)))
            .await
            .expect("create first")
            .1
             .0;
        let second = create_weft(State(state), Json(create_request(false)))
            .await
            .expect("create second")
            .1
             .0;

        assert_ne!(first.weft.loom_id, second.weft.loom_id);
        assert!(second.created);
        assert!(!second.reused);
    }

    #[tokio::test]
    async fn list_wefts_by_origin_loom_and_response() {
        let state = seeded_state().await;
        let _ = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft");

        let by_loom = list_wefts_for_loom(State(state.clone()), Path("origin-loom".to_string()))
            .await
            .expect("list by Loom")
            .0;
        assert_eq!(by_loom.wefts.len(), 1);

        let by_response =
            list_wefts_for_response(State(state), Path("origin-response".to_string()))
                .await
                .expect("list by Response")
                .0;
        assert_eq!(by_response.wefts.len(), 1);
    }

    #[tokio::test]
    async fn created_weft_inserts_resolvable_address() {
        let state = seeded_state().await;
        let response = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft")
            .1
             .0;
        let canonical_uri = response.weft.canonical_uri.expect("canonical URI");

        let resolved = resolve_address(&state.database, &canonical_uri)
            .await
            .expect("resolve Weft address");
        assert_eq!(
            resolved.object_id.as_deref(),
            Some(response.weft.loom_id.as_str())
        );
        assert_eq!(resolved.object_kind.as_deref(), Some("weft"));
    }

    #[tokio::test]
    async fn graph_projection_includes_created_weft_origin_edge() {
        let state = seeded_state().await;
        let response = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft")
            .1
             .0;

        let graph = build_graph_projection(&state.database, "origin-loom", Default::default())
            .await
            .expect("build graph");
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == format!("loom:{}", response.weft.loom_id)));
        assert!(graph.edges.iter().any(|edge| edge.kind == "weft_origin"));
    }

    #[tokio::test]
    async fn raw_thinking_metadata_is_rejected() {
        let state = seeded_state().await;
        let error = create_weft(
            State(state),
            Json(CreateWeftRequest {
                metadata: Some(json!({ "raw_thinking": "hidden" })),
                ..create_request(true)
            }),
        )
        .await
        .expect_err("raw thinking metadata should fail");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "RAW_THINKING_REJECTED");
    }

    #[tokio::test]
    async fn persist_weft_responses_inserts_user_and_assistant_turns() {
        let state = seeded_state().await;
        let weft = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft")
            .1
             .0
            .weft;

        let response = persist_weft_responses(
            State(state.clone()),
            Path(weft.loom_id.clone()),
            Json(persist_request(vec![(
                "turn-1",
                "What is MCP?",
                "Model Context Protocol.",
            )])),
        )
        .await
        .expect("persist turns")
        .0;

        assert_eq!(response.weft_loom_id, weft.loom_id);
        assert_eq!(response.responses.len(), 1);
        assert_eq!(response.responses[0].sequence_index, 0);

        let persisted = ResponseRepository::new(&state.database)
            .list_responses_for_loom(&weft.loom_id)
            .await
            .expect("list persisted responses");
        assert_eq!(persisted.len(), 2);
        assert_eq!(persisted[0].role, "user");
        assert_eq!(persisted[0].content, "What is MCP?");
        assert_eq!(
            persisted[0].title.as_deref(),
            Some("Model Context Protocol")
        );
        assert_eq!(persisted[1].role, "assistant");
        assert_eq!(persisted[1].content, "Model Context Protocol.");
        assert_eq!(
            persisted[1].title.as_deref(),
            Some("Model Context Protocol")
        );
        assert_eq!(
            response.responses[0].title.as_deref(),
            Some("Model Context Protocol")
        );
        let metadata: serde_json::Value =
            serde_json::from_str(persisted[0].metadata_json.as_deref().expect("metadata"))
                .expect("metadata json");
        assert_eq!(metadata["seedKind"], json!("quick_ask_turn"));
        assert_eq!(metadata["askTurnId"], json!("turn-1"));
    }

    #[tokio::test]
    async fn quick_ask_weft_starts_with_ask_turns_not_parent_origin_pair() {
        let state = seeded_state().await;
        let weft = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft")
            .1
             .0;
        assert!(weft.visible_seed_responses.is_empty());

        let _ = persist_weft_responses(
            State(state.clone()),
            Path(weft.weft.loom_id.clone()),
            Json(persist_request(vec![(
                "turn-1",
                "What is MCP?",
                "Model Context Protocol.",
            )])),
        )
        .await
        .expect("persist turns");

        let persisted = ResponseRepository::new(&state.database)
            .list_responses_for_loom(&weft.weft.loom_id)
            .await
            .expect("list persisted responses");
        assert_eq!(
            persisted
                .iter()
                .map(|response| response.content.as_str())
                .collect::<Vec<_>>(),
            vec!["What is MCP?", "Model Context Protocol."]
        );
        assert!(!persisted
            .iter()
            .any(|response| response.content == "Origin question"));
        assert_eq!(persisted[0].sequence_index, 0);
        assert_eq!(persisted[1].sequence_index, 1);
    }

    #[tokio::test]
    async fn quick_ask_weft_creates_hidden_origin_context_snapshot_with_fragment_metadata() {
        let state = seeded_state().await;
        let weft = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft")
            .1
             .0
            .weft;
        let response = persist_weft_responses(
            State(state.clone()),
            Path(weft.loom_id.clone()),
            Json(persist_request(vec![("turn-1", "Question", "Answer")])),
        )
        .await
        .expect("persist turns")
        .0;

        assert!(response.origin_context_snapshot_id.is_some());
        let context = ContextArtifactsRepository::new(&state.database)
            .get_weft_origin_context(&weft.loom_id)
            .await
            .expect("get context")
            .expect("context exists");
        let summary = context.origin_summary.expect("origin summary");
        assert!(summary.contains("\"selectedText\":\"MCP\""));
        assert!(summary.contains("\"fragmentHash\":\"frag-1\""));
        assert!(!summary.contains("hidden_reasoning"));
    }

    #[tokio::test]
    async fn persist_weft_responses_preserves_multi_turn_order_and_appends() {
        let state = seeded_state().await;
        let weft = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft")
            .1
             .0
            .weft;
        ResponseRepository::new(&state.database)
            .insert_response(&NewResponse {
                response_id: "existing-weft-response".to_string(),
                loom_id: weft.loom_id.clone(),
                role: "assistant".to_string(),
                content: "Existing content".to_string(),
                title: Some("Existing".to_string()),
                code: None,
                canonical_uri: None,
                created_at: "2026-05-08T00:00:02Z".to_string(),
                updated_at: "2026-05-08T00:00:02Z".to_string(),
                sequence_index: 0,
                metadata_json: None,
            })
            .await
            .expect("insert existing response");

        let response = persist_weft_responses(
            State(state.clone()),
            Path(weft.loom_id.clone()),
            Json(persist_request(vec![
                ("turn-1", "Question 1", "Answer 1"),
                ("turn-2", "Question 2", "Answer 2"),
            ])),
        )
        .await
        .expect("persist turns")
        .0;

        assert_eq!(response.responses[0].sequence_index, 1);
        assert_eq!(response.responses[1].sequence_index, 3);
        let persisted = ResponseRepository::new(&state.database)
            .list_responses_for_loom(&weft.loom_id)
            .await
            .expect("list persisted responses");
        assert_eq!(
            persisted
                .iter()
                .map(|response| response.content.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Existing content",
                "Question 1",
                "Answer 1",
                "Question 2",
                "Answer 2"
            ]
        );
    }

    #[tokio::test]
    async fn persist_weft_responses_is_idempotent_for_same_turns() {
        let state = seeded_state().await;
        let weft = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft")
            .1
             .0
            .weft;
        let request = persist_request(vec![("turn-1", "Question", "Answer")]);

        let first = persist_weft_responses(
            State(state.clone()),
            Path(weft.loom_id.clone()),
            Json(request.clone()),
        )
        .await
        .expect("persist first")
        .0;
        let second = persist_weft_responses(
            State(state.clone()),
            Path(weft.loom_id.clone()),
            Json(request),
        )
        .await
        .expect("persist retry")
        .0;

        assert_eq!(
            first.responses[0].assistant_response_id,
            second.responses[0].assistant_response_id
        );
        let persisted = ResponseRepository::new(&state.database)
            .list_responses_for_loom(&weft.loom_id)
            .await
            .expect("list persisted responses");
        assert_eq!(persisted.len(), 2);
    }

    #[tokio::test]
    async fn persist_weft_responses_keeps_source_metadata_and_rejects_raw_thinking() {
        let state = seeded_state().await;
        let weft = create_weft(State(state.clone()), Json(create_request(true)))
            .await
            .expect("create Weft")
            .1
             .0
            .weft;
        let error = persist_weft_responses(
            State(state.clone()),
            Path(weft.loom_id.clone()),
            Json(PersistWeftTurnsRequest {
                turns: vec![PersistWeftTurn {
                    metadata: Some(json!({ "raw_thinking": "hidden" })),
                    ..persist_turn("turn-1", "Question", "Answer")
                }],
                ..persist_request(Vec::new())
            }),
        )
        .await
        .expect_err("raw thinking metadata should fail");
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "RAW_THINKING_REJECTED");

        let response = persist_weft_responses(
            State(state.clone()),
            Path(weft.loom_id.clone()),
            Json(persist_request(vec![("turn-1", "Question", "Answer")])),
        )
        .await
        .expect("persist turn")
        .0;
        let user = ResponseRepository::new(&state.database)
            .get_response(&response.responses[0].user_response_id)
            .await
            .expect("get user response")
            .expect("user response exists");
        let metadata: serde_json::Value =
            serde_json::from_str(user.metadata_json.as_deref().expect("metadata"))
                .expect("metadata json");
        assert_eq!(metadata["selectedText"], json!("MCP"));
        assert_eq!(metadata["fragmentHash"], json!("frag-1"));
        assert_eq!(
            metadata["sourceMetadata"]["sourceResponseCode"],
            json!("R-ORIGIN")
        );
    }

    fn create_request(reuse_existing: bool) -> CreateWeftRequest {
        CreateWeftRequest {
            origin_loom_id: "origin-loom".to_string(),
            origin_response_id: Some("origin-response".to_string()),
            weft_kind: None,
            title: Some("Service Weft".to_string()),
            initial_prompt: None,
            summary: Some("Created through service Weft endpoint".to_string()),
            reuse_existing: Some(reuse_existing),
            source: Some(WeftSource::QuickAskConvert),
            seed_mode: None,
            create_origin_context_snapshot: None,
            metadata: Some(json!({ "askSessionId": "ask-1" })),
        }
    }

    fn response_action_request(reuse_existing: bool) -> CreateWeftRequest {
        CreateWeftRequest {
            source: Some(WeftSource::ResponseAction),
            metadata: Some(json!({ "source": "response_action" })),
            ..create_request(reuse_existing)
        }
    }

    fn persist_request(turns: Vec<(&str, &str, &str)>) -> PersistWeftTurnsRequest {
        PersistWeftTurnsRequest {
            source: Some(WeftSource::QuickAskConvert),
            origin_loom_id: "origin-loom".to_string(),
            origin_response_id: "origin-response".to_string(),
            selected_text: Some("MCP".to_string()),
            fragment_hash: Some("frag-1".to_string()),
            source_metadata: Some(json!({
                "sourceResponseCode": "R-ORIGIN",
                "sourceTitle": "Origin Response",
                "sourceCanonicalUri": "loom://origin/response"
            })),
            turns: turns
                .into_iter()
                .map(|(id, question, answer)| persist_turn(id, question, answer))
                .collect(),
        }
    }

    fn persist_turn(id: &str, question: &str, answer: &str) -> PersistWeftTurn {
        PersistWeftTurn {
            id: Some(id.to_string()),
            question: question.to_string(),
            answer: answer.to_string(),
            title: None,
            created_at: Some("2026-05-08T00:00:03Z".to_string()),
            metadata: Some(json!({ "askSessionTurnId": id })),
        }
    }

    async fn seeded_state() -> AppState {
        let state = test_state().await;
        let loom_repository = LoomRepository::new(&state.database);
        loom_repository
            .insert_loom(&NewLoom {
                loom_id: "origin-loom".to_string(),
                title: "Origin Loom".to_string(),
                summary: None,
                code: Some("L-ORIGIN".to_string()),
                canonical_uri: Some("loom://origin".to_string()),
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert origin Loom");
        let response_repository = ResponseRepository::new(&state.database);
        response_repository
            .insert_response(&NewResponse {
                response_id: "origin-question".to_string(),
                loom_id: "origin-loom".to_string(),
                role: "user".to_string(),
                content: "Origin question".to_string(),
                title: Some("Origin Question".to_string()),
                code: Some("Q-ORIGIN".to_string()),
                canonical_uri: Some("loom://origin/question".to_string()),
                created_at: "2026-05-08T00:00:01Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
                sequence_index: 0,
                metadata_json: None,
            })
            .await
            .expect("insert origin question");
        response_repository
            .insert_response(&NewResponse {
                response_id: "origin-response".to_string(),
                loom_id: "origin-loom".to_string(),
                role: "assistant".to_string(),
                content: "Origin content".to_string(),
                title: Some("Origin Response".to_string()),
                code: Some("R-ORIGIN".to_string()),
                canonical_uri: Some("loom://origin/response".to_string()),
                created_at: "2026-05-08T00:00:02Z".to_string(),
                updated_at: "2026-05-08T00:00:02Z".to_string(),
                sequence_index: 1,
                metadata_json: None,
            })
            .await
            .expect("insert origin Response");
        state
    }

    async fn test_state() -> AppState {
        AppState {
            database: test_database().await,
            ollama: OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: Duration::from_millis(200),
                first_chunk_timeout: Duration::from_millis(200),
                stream_idle_timeout: Duration::from_millis(200),
                security: Default::default(),
            }),
            config: ConfigManager::new(
                PathBuf::from("/tmp/loom-service-weft-test.toml"),
                LoomServiceConfig::default(),
            ),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }
}
