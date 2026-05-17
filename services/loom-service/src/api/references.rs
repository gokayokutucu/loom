use crate::{
    api::state::AppState,
    capabilities::repository::{new_id, timestamp},
    error::ServiceError,
    storage::repositories::{
        context_artifacts::{ContextArtifactsRepository, ResponseCapsuleRecord},
        references::{NewReference, ReferenceRecord, ReferenceRepository},
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReferenceRequest {
    pub source_loom_id: String,
    pub source_response_id: Option<String>,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub label: Option<String>,
    pub selected_text: Option<String>,
    pub fragment_hash: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestReferencesRequest {
    pub loom_id: String,
    pub response_id: Option<String>,
    pub draft_text: Option<String>,
    pub selected_text: Option<String>,
    pub attached_reference_ids: Option<Vec<String>>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceDto {
    pub reference_id: String,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub label: Option<String>,
    pub selected_text: Option<String>,
    pub fragment_hash: Option<String>,
    pub created_at: String,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceEnvelope {
    pub reference: ReferenceDto,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub reused: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceListResponse {
    pub references: Vec<ReferenceDto>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSuggestion {
    pub reference: ReferenceDto,
    pub score: i64,
    pub reasons: Vec<String>,
    pub reason: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSuggestionsResponse {
    pub suggestions: Vec<ReferenceSuggestion>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceApiError {
    pub code: String,
    pub message: String,
}

pub async fn create_reference(
    State(state): State<AppState>,
    Json(input): Json<CreateReferenceRequest>,
) -> Result<(StatusCode, Json<ReferenceEnvelope>), (StatusCode, Json<ReferenceApiError>)> {
    validate_target_kind(&input.target_kind)?;
    reject_forbidden_value(input.metadata.as_ref())?;
    reject_forbidden_text(input.selected_text.as_deref())?;
    reject_forbidden_text(input.label.as_deref())?;

    let repository = ReferenceRepository::new(&state.database);
    if input.target_kind == "fragment" {
        if let Some(existing) = repository
            .find_duplicate_fragment_reference(
                &input.source_loom_id,
                input.source_response_id.as_deref().unwrap_or_default(),
                input.selected_text.as_deref(),
                input.target_uri.as_deref(),
            )
            .await
            .map_err(storage_error)?
        {
            return Ok((
                StatusCode::OK,
                Json(ReferenceEnvelope {
                    reference: reference_to_dto(existing),
                    reused: true,
                }),
            ));
        }
    }

    let created_at = timestamp();
    let reference = NewReference {
        reference_id: new_id("reference"),
        source_loom_id: Some(input.source_loom_id),
        source_response_id: input.source_response_id,
        target_kind: input.target_kind,
        target_id: input.target_id,
        target_uri: input.target_uri,
        selected_text: input.selected_text,
        label: input.label,
        metadata_json: reference_metadata_json(input.metadata, input.fragment_hash)?,
        created_at,
    };
    repository
        .insert_reference(&reference)
        .await
        .map_err(storage_error)?;
    let stored = repository
        .get_reference(&reference.reference_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(|| storage_error(ServiceError::storage("created Reference was not found")))?;

    Ok((
        StatusCode::CREATED,
        Json(ReferenceEnvelope {
            reference: reference_to_dto(stored),
            reused: false,
        }),
    ))
}

pub async fn delete_reference(
    State(state): State<AppState>,
    Path(reference_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ReferenceApiError>)> {
    let deleted = ReferenceRepository::new(&state.database)
        .delete_reference(&reference_id)
        .await
        .map_err(storage_error)?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(not_found())
    }
}

pub async fn get_reference(
    State(state): State<AppState>,
    Path(reference_id): Path<String>,
) -> Result<Json<ReferenceEnvelope>, (StatusCode, Json<ReferenceApiError>)> {
    let reference = ReferenceRepository::new(&state.database)
        .get_reference(&reference_id)
        .await
        .map_err(storage_error)?
        .ok_or_else(not_found)?;
    Ok(Json(ReferenceEnvelope {
        reference: reference_to_dto(reference),
        reused: false,
    }))
}

pub async fn list_loom_references(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<Json<ReferenceListResponse>, (StatusCode, Json<ReferenceApiError>)> {
    let references = ReferenceRepository::new(&state.database)
        .list_references_for_loom(&loom_id)
        .await
        .map_err(storage_error)?;
    Ok(Json(ReferenceListResponse {
        references: references.into_iter().map(reference_to_dto).collect(),
    }))
}

pub async fn list_response_references(
    State(state): State<AppState>,
    Path(response_id): Path<String>,
) -> Result<Json<ReferenceListResponse>, (StatusCode, Json<ReferenceApiError>)> {
    let references = ReferenceRepository::new(&state.database)
        .list_references_for_response(&response_id)
        .await
        .map_err(storage_error)?;
    Ok(Json(ReferenceListResponse {
        references: references.into_iter().map(reference_to_dto).collect(),
    }))
}

pub async fn suggest_references(
    State(state): State<AppState>,
    Json(input): Json<SuggestReferencesRequest>,
) -> Result<Json<ReferenceSuggestionsResponse>, (StatusCode, Json<ReferenceApiError>)> {
    reject_forbidden_text(input.draft_text.as_deref())?;
    reject_forbidden_text(input.selected_text.as_deref())?;
    let limit = input.limit.unwrap_or(10).clamp(1, 50);
    let query = ReferenceQuery::new(input.draft_text.as_deref(), input.selected_text.as_deref());
    let attached_reference_ids = input
        .attached_reference_ids
        .unwrap_or_default()
        .into_iter()
        .collect::<HashSet<_>>();
    let references_repository = ReferenceRepository::new(&state.database);
    let references = if let Some(response_id) = input.response_id.as_deref() {
        references_repository
            .list_references_for_response(response_id)
            .await
            .map_err(storage_error)?
    } else {
        references_repository
            .list_references_for_loom(&input.loom_id)
            .await
            .map_err(storage_error)?
    };
    let context_artifacts = ContextArtifactsRepository::new(&state.database);
    let mut suggestion_by_key: HashMap<String, ReferenceSuggestion> = HashMap::new();
    for reference in references {
        if attached_reference_ids.contains(&reference.reference_id) {
            continue;
        }
        if let Some(suggestion) =
            score_reference(reference, &query, &input.loom_id, &context_artifacts)
                .await
                .map_err(storage_error)?
        {
            let key = suggestion_dedupe_key(&suggestion.reference);
            match suggestion_by_key.get(&key) {
                Some(existing) if existing.score >= suggestion.score => {}
                _ => {
                    suggestion_by_key.insert(key, suggestion);
                }
            }
        }
    }
    let mut suggestions = suggestion_by_key.into_values().collect::<Vec<_>>();
    suggestions.sort_by(|a, b| {
        b.score.cmp(&a.score).then_with(|| {
            b.reference
                .created_at
                .cmp(&a.reference.created_at)
                .then_with(|| a.reference.reference_id.cmp(&b.reference.reference_id))
        })
    });
    suggestions.truncate(limit);
    Ok(Json(ReferenceSuggestionsResponse { suggestions }))
}

async fn score_reference(
    reference: ReferenceRecord,
    query: &ReferenceQuery,
    active_loom_id: &str,
    context_artifacts: &ContextArtifactsRepository,
) -> Result<Option<ReferenceSuggestion>, ServiceError> {
    let dto = reference_to_dto(reference.clone());
    let mut score = 0;
    let mut reasons = Vec::<String>::new();
    let mut candidates = reference_candidate_texts(&dto);

    if let Some(capsule_response_id) = capsule_response_id(&dto) {
        if let Some(capsule) = context_artifacts
            .get_response_capsule(&capsule_response_id)
            .await?
        {
            let before_len = candidates.len();
            candidates.extend(capsule_candidate_texts(&capsule));
            if candidates.len() > before_len && query.has_keyword_overlap(&candidates[before_len..])
            {
                score += 25;
                reasons.push("capsule_keyword".to_string());
            }
        }
    }

    if query.is_empty() {
        score += 10;
        reasons.push("recent_reference".to_string());
    }

    if reference.source_loom_id.as_deref() == Some(active_loom_id) {
        score += 15;
        reasons.push("same_loom".to_string());
    }

    if query.exact_match(&candidates) {
        score += 120;
        reasons.push("exact_label_match".to_string());
    }

    if query.code_or_acronym_match(&candidates) {
        score += 90;
        reasons.push("code_match".to_string());
    }

    let overlap_count = query.keyword_overlap_count(&candidates);
    if overlap_count > 0 {
        score += (overlap_count as i64 * 18).min(90);
        reasons.push("keyword_match".to_string());
    }

    if query.selected_keyword_overlap(&candidates) {
        score += 30;
        reasons.push("selected_text_match".to_string());
    }

    if reasons.is_empty() || score <= 0 {
        return Ok(None);
    }

    reasons.sort();
    reasons.dedup();
    let reason = reasons
        .first()
        .cloned()
        .unwrap_or_else(|| "keyword_match".to_string());
    Ok(Some(ReferenceSuggestion {
        reference: dto,
        score,
        reasons,
        reason,
    }))
}

fn reference_metadata_json(
    metadata: Option<Value>,
    fragment_hash: Option<String>,
) -> Result<Option<String>, (StatusCode, Json<ReferenceApiError>)> {
    let mut metadata = metadata.unwrap_or_else(|| json!({}));
    let Value::Object(ref mut object) = metadata else {
        return Err(bad_request(
            "INVALID_METADATA",
            "Reference metadata must be a JSON object.",
        ));
    };
    if let Some(fragment_hash) = fragment_hash {
        object.insert("fragmentHash".to_string(), Value::String(fragment_hash));
    }
    reject_forbidden_value(Some(&metadata))?;
    serde_json::to_string(&metadata)
        .map(Some)
        .map_err(|error| bad_request("INVALID_METADATA", &format!("Invalid metadata: {error}")))
}

struct ReferenceQuery {
    raw_terms: Vec<String>,
    draft_keywords: HashSet<String>,
    selected_keywords: HashSet<String>,
}

impl ReferenceQuery {
    fn new(draft_text: Option<&str>, selected_text: Option<&str>) -> Self {
        let raw_terms = [draft_text, selected_text]
            .into_iter()
            .flatten()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(normalize_phrase)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>();
        Self {
            raw_terms,
            draft_keywords: extract_keywords(draft_text.unwrap_or_default()),
            selected_keywords: extract_keywords(selected_text.unwrap_or_default()),
        }
    }

    fn is_empty(&self) -> bool {
        self.raw_terms.is_empty()
            && self.draft_keywords.is_empty()
            && self.selected_keywords.is_empty()
    }

    fn exact_match(&self, candidates: &[String]) -> bool {
        self.raw_terms.iter().any(|term| {
            candidates
                .iter()
                .any(|candidate| normalize_phrase(candidate) == *term)
        })
    }

    fn code_or_acronym_match(&self, candidates: &[String]) -> bool {
        let query_keywords = self.all_keywords();
        candidates.iter().any(|candidate| {
            extract_keywords(candidate)
                .into_iter()
                .any(|keyword| query_keywords.contains(&keyword) && looks_like_code_token(&keyword))
        })
    }

    fn keyword_overlap_count(&self, candidates: &[String]) -> usize {
        let query_keywords = self.all_keywords();
        if query_keywords.is_empty() {
            return 0;
        }
        candidates
            .iter()
            .flat_map(|candidate| extract_keywords(candidate).into_iter())
            .collect::<HashSet<_>>()
            .intersection(&query_keywords)
            .count()
    }

    fn has_keyword_overlap(&self, candidates: &[String]) -> bool {
        self.keyword_overlap_count(candidates) > 0
    }

    fn selected_keyword_overlap(&self, candidates: &[String]) -> bool {
        if self.selected_keywords.is_empty() {
            return false;
        }
        let candidate_keywords = candidates
            .iter()
            .flat_map(|candidate| extract_keywords(candidate).into_iter())
            .collect::<HashSet<_>>();
        self.selected_keywords
            .iter()
            .any(|keyword| candidate_keywords.contains(keyword))
    }

    fn all_keywords(&self) -> HashSet<String> {
        self.draft_keywords
            .union(&self.selected_keywords)
            .cloned()
            .collect()
    }
}

fn reference_candidate_texts(reference: &ReferenceDto) -> Vec<String> {
    let mut candidates = [
        reference.label.as_deref(),
        reference.target_uri.as_deref(),
        reference.target_id.as_deref(),
        reference.selected_text.as_deref(),
        reference.fragment_hash.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter(|text| !contains_forbidden_text(text))
    .map(str::to_string)
    .collect::<Vec<_>>();

    if let Some(metadata) = reference.metadata.as_ref() {
        collect_json_strings(metadata, &mut candidates);
    }
    candidates
}

fn capsule_candidate_texts(capsule: &ResponseCapsuleRecord) -> Vec<String> {
    [
        capsule.response_code.as_deref(),
        capsule.title.as_deref(),
        capsule.summary.as_deref(),
        capsule.key_points_json.as_deref(),
        capsule.keywords_json.as_deref(),
        capsule.entities_json.as_deref(),
        capsule.code_blocks_json.as_deref(),
        capsule.canonical_uri.as_deref(),
    ]
    .into_iter()
    .flatten()
    .filter(|text| !contains_forbidden_text(text))
    .map(str::to_string)
    .collect()
}

fn collect_json_strings(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::String(text) if !contains_forbidden_text(text) => output.push(text.clone()),
        Value::Array(items) => {
            for item in items {
                collect_json_strings(item, output);
            }
        }
        Value::Object(object) => {
            for (key, value) in object {
                if contains_forbidden_text(key) {
                    continue;
                }
                collect_json_strings(value, output);
            }
        }
        _ => {}
    }
}

fn capsule_response_id(reference: &ReferenceDto) -> Option<String> {
    match reference.target_kind.as_str() {
        "response" | "fragment" => reference
            .target_id
            .clone()
            .or_else(|| reference.source_response_id.clone()),
        _ => reference.source_response_id.clone(),
    }
}

fn suggestion_dedupe_key(reference: &ReferenceDto) -> String {
    [
        reference.target_kind.as_str(),
        reference.target_id.as_deref().unwrap_or(""),
        reference.target_uri.as_deref().unwrap_or(""),
        reference.selected_text.as_deref().unwrap_or(""),
        reference.fragment_hash.as_deref().unwrap_or(""),
    ]
    .join("|")
}

fn extract_keywords(text: &str) -> HashSet<String> {
    let mut keywords = HashSet::new();
    let mut token = String::new();
    for character in text.chars() {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            token.push(character);
        } else {
            push_keyword(&mut keywords, &token);
            token.clear();
        }
    }
    push_keyword(&mut keywords, &token);
    keywords
}

fn push_keyword(keywords: &mut HashSet<String>, token: &str) {
    let keyword = normalize_phrase(token);
    if keyword.len() < 2 || is_stop_word(&keyword) {
        return;
    }
    keywords.insert(keyword);
}

fn normalize_phrase(text: &str) -> String {
    text.trim_matches(|character: char| {
        !(character.is_alphanumeric() || character == '_' || character == '-')
    })
    .to_lowercase()
}

fn looks_like_code_token(token: &str) -> bool {
    token.len() <= 8
        && token
            .chars()
            .any(|character| character.is_ascii_alphabetic())
}

fn is_stop_word(word: &str) -> bool {
    matches!(
        word,
        "a" | "an"
            | "and"
            | "are"
            | "as"
            | "at"
            | "bu"
            | "çok"
            | "da"
            | "de"
            | "daha"
            | "for"
            | "gibi"
            | "how"
            | "in"
            | "is"
            | "it"
            | "ile"
            | "için"
            | "mi"
            | "mu"
            | "mı"
            | "mü"
            | "nasıl"
            | "nedir"
            | "ne"
            | "of"
            | "on"
            | "or"
            | "olarak"
            | "şu"
            | "that"
            | "the"
            | "this"
            | "to"
            | "ve"
            | "veya"
            | "what"
            | "why"
    )
}

fn reference_to_dto(reference: ReferenceRecord) -> ReferenceDto {
    let metadata = parse_metadata(reference.metadata_json.as_deref());
    let fragment_hash = metadata
        .as_ref()
        .and_then(|value| value.get("fragmentHash"))
        .and_then(Value::as_str)
        .map(str::to_string);
    ReferenceDto {
        reference_id: reference.reference_id,
        source_loom_id: reference.source_loom_id,
        source_response_id: reference.source_response_id,
        target_kind: reference.target_kind,
        target_id: reference.target_id,
        target_uri: reference.target_uri,
        label: reference.label,
        selected_text: reference.selected_text,
        fragment_hash,
        created_at: reference.created_at,
        metadata,
    }
}

fn parse_metadata(metadata_json: Option<&str>) -> Option<Value> {
    let metadata_json = metadata_json?;
    if contains_forbidden_text(metadata_json) {
        return None;
    }
    serde_json::from_str(metadata_json).ok()
}

fn validate_target_kind(kind: &str) -> Result<(), (StatusCode, Json<ReferenceApiError>)> {
    match kind {
        "loom" | "response" | "weft" | "fragment" | "external" => Ok(()),
        _ => Err(bad_request(
            "INVALID_TARGET_KIND",
            "Reference targetKind must be loom, response, weft, fragment, or external.",
        )),
    }
}

fn reject_forbidden_value(
    value: Option<&Value>,
) -> Result<(), (StatusCode, Json<ReferenceApiError>)> {
    let Some(value) = value else {
        return Ok(());
    };
    if contains_forbidden_text(&value.to_string()) {
        return Err(bad_request(
            "RAW_THINKING_REJECTED",
            "Reference payload contains forbidden raw-thinking metadata.",
        ));
    }
    Ok(())
}

fn reject_forbidden_text(value: Option<&str>) -> Result<(), (StatusCode, Json<ReferenceApiError>)> {
    if value.map(contains_forbidden_text).unwrap_or(false) {
        return Err(bad_request(
            "RAW_THINKING_REJECTED",
            "Reference payload contains forbidden raw-thinking metadata.",
        ));
    }
    Ok(())
}

fn contains_forbidden_text(value: &str) -> bool {
    FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| value.contains(key))
}

fn bad_request(code: &str, message: &str) -> (StatusCode, Json<ReferenceApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ReferenceApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn not_found() -> (StatusCode, Json<ReferenceApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(ReferenceApiError {
            code: "REFERENCE_NOT_FOUND".to_string(),
            message: "Reference was not found.".to_string(),
        }),
    )
}

fn storage_error(error: ServiceError) -> (StatusCode, Json<ReferenceApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ReferenceApiError {
            code: "REFERENCE_STORAGE_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        create_reference, delete_reference, get_reference, list_loom_references,
        list_response_references, suggest_references, CreateReferenceRequest,
        SuggestReferencesRequest,
    };
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::{
            db::test_database,
            repositories::{
                context_artifacts::{ContextArtifactsRepository, UpsertResponseCapsule},
                looms::{LoomRepository, NewLoom},
                references::{NewReference, ReferenceRepository},
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
    async fn post_references_creates_response_reference() {
        let state = test_state().await;
        seed_loom_and_response(&state).await;

        let created = create_reference(State(state.clone()), Json(response_reference_request()))
            .await
            .expect("create Reference");

        assert_eq!(created.0, StatusCode::CREATED);
        assert_eq!(created.1 .0.reference.target_kind, "response");
        assert_eq!(
            created.1 .0.reference.source_response_id.as_deref(),
            Some("response-1")
        );

        let listed = list_loom_references(State(state), Path("loom-1".to_string()))
            .await
            .expect("list References")
            .0;
        assert_eq!(listed.references.len(), 1);
    }

    #[tokio::test]
    async fn post_references_creates_and_reuses_fragment_reference() {
        let state = test_state().await;
        seed_loom_and_response(&state).await;
        let input = fragment_reference_request();

        let first = create_reference(State(state.clone()), Json(input))
            .await
            .expect("create Fragment Reference");
        let second = create_reference(State(state), Json(fragment_reference_request()))
            .await
            .expect("reuse Fragment Reference");

        assert_eq!(first.0, StatusCode::CREATED);
        assert_eq!(second.0, StatusCode::OK);
        assert!(second.1 .0.reused);
        assert_eq!(
            first.1 .0.reference.reference_id,
            second.1 .0.reference.reference_id
        );
        assert_eq!(
            second.1 .0.reference.fragment_hash.as_deref(),
            Some("fragment-a")
        );
    }

    #[tokio::test]
    async fn get_delete_and_list_by_response_work() {
        let state = test_state().await;
        seed_loom_and_response(&state).await;
        let created = create_reference(State(state.clone()), Json(response_reference_request()))
            .await
            .expect("create Reference")
            .1
             .0
            .reference;

        let fetched = get_reference(State(state.clone()), Path(created.reference_id.clone()))
            .await
            .expect("get Reference")
            .0;
        assert_eq!(fetched.reference.reference_id, created.reference_id);

        let by_response =
            list_response_references(State(state.clone()), Path("response-1".to_string()))
                .await
                .expect("list by Response")
                .0;
        assert_eq!(by_response.references.len(), 1);

        let deleted = delete_reference(State(state), Path(created.reference_id))
            .await
            .expect("delete Reference");
        assert_eq!(deleted, StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn forbidden_raw_thinking_metadata_is_rejected() {
        let state = test_state().await;
        let error = create_reference(
            State(state),
            Json(CreateReferenceRequest {
                metadata: Some(json!({ "raw_thinking": "hidden" })),
                ..response_reference_request()
            }),
        )
        .await
        .expect_err("raw thinking rejected");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "RAW_THINKING_REJECTED");
    }

    #[tokio::test]
    async fn suggestion_endpoint_returns_deterministic_matches() {
        let state = test_state().await;
        seed_loom_and_response(&state).await;
        let _ = create_reference(State(state.clone()), Json(response_reference_request()))
            .await
            .expect("create Reference");

        let suggestions = suggest_references(
            State(state),
            Json(SuggestReferencesRequest {
                loom_id: "loom-1".to_string(),
                response_id: None,
                draft_text: Some("target".to_string()),
                selected_text: None,
                attached_reference_ids: None,
                limit: Some(10),
            }),
        )
        .await
        .expect("suggest")
        .0;

        assert_eq!(suggestions.suggestions.len(), 1);
        assert_eq!(
            suggestions.suggestions[0].reference.label.as_deref(),
            Some("Target")
        );
        assert!(suggestions.suggestions[0]
            .reasons
            .contains(&"keyword_match".to_string()));
    }

    #[tokio::test]
    async fn suggestion_endpoint_ranks_exact_label_and_acronym_matches() {
        let state = test_state().await;
        seed_loom_and_response(&state).await;
        let _ = create_reference(
            State(state.clone()),
            Json(CreateReferenceRequest {
                label: Some("Model Context Protocol".to_string()),
                metadata: Some(json!({ "code": "MCP", "sourceTitle": "Plugin session tools" })),
                ..response_reference_request()
            }),
        )
        .await
        .expect("create MCP Reference");
        let _ = create_reference(
            State(state.clone()),
            Json(CreateReferenceRequest {
                label: Some("Unrelated Note".to_string()),
                target_id: Some("response-unrelated".to_string()),
                target_uri: Some("loom://service/response-unrelated".to_string()),
                metadata: Some(json!({ "code": "ABC" })),
                ..response_reference_request()
            }),
        )
        .await
        .expect("create unrelated Reference");

        let suggestions = suggest_references(
            State(state),
            Json(SuggestReferencesRequest {
                loom_id: "loom-1".to_string(),
                response_id: None,
                draft_text: Some("MCP açılımı nedir?".to_string()),
                selected_text: None,
                attached_reference_ids: None,
                limit: Some(10),
            }),
        )
        .await
        .expect("suggest")
        .0;

        assert_eq!(
            suggestions.suggestions[0].reference.label.as_deref(),
            Some("Model Context Protocol")
        );
        assert!(suggestions.suggestions[0]
            .reasons
            .contains(&"code_match".to_string()));
    }

    #[tokio::test]
    async fn suggestion_endpoint_uses_selected_text_same_loom_and_capsule_keywords() {
        let state = test_state().await;
        seed_loom_and_response(&state).await;
        ContextArtifactsRepository::new(&state.database)
            .upsert_response_capsule(&UpsertResponseCapsule {
                capsule_id: "capsule-response-1".to_string(),
                response_id: "response-1".to_string(),
                loom_id: "loom-1".to_string(),
                response_code: Some("R1".to_string()),
                title: Some("Event Sourcing capsule".to_string()),
                summary: Some("CQRS and append-only event logs".to_string()),
                key_points_json: Some("[\"aggregate replay\"]".to_string()),
                keywords_json: Some("[\"event sourcing\",\"cqrs\",\"aggregate\"]".to_string()),
                entities_json: None,
                code_blocks_json: None,
                canonical_uri: Some("loom://service/response-1".to_string()),
                source_hash: Some("hash".to_string()),
                generator: Some("heuristic".to_string()),
                status: "ready".to_string(),
                created_at: "2026-05-10T00:00:02Z".to_string(),
                updated_at: "2026-05-10T00:00:02Z".to_string(),
            })
            .await
            .expect("upsert capsule");
        let _ = create_reference(State(state.clone()), Json(response_reference_request()))
            .await
            .expect("create Reference");

        let suggestions = suggest_references(
            State(state),
            Json(SuggestReferencesRequest {
                loom_id: "loom-1".to_string(),
                response_id: None,
                draft_text: Some("aggregate replay nasıl çalışır?".to_string()),
                selected_text: Some("Event Sourcing".to_string()),
                attached_reference_ids: None,
                limit: Some(10),
            }),
        )
        .await
        .expect("suggest")
        .0;

        assert_eq!(suggestions.suggestions.len(), 1);
        assert!(suggestions.suggestions[0]
            .reasons
            .contains(&"capsule_keyword".to_string()));
        assert!(suggestions.suggestions[0]
            .reasons
            .contains(&"same_loom".to_string()));
        assert!(suggestions.suggestions[0]
            .reasons
            .contains(&"selected_text_match".to_string()));
    }

    #[tokio::test]
    async fn suggestion_endpoint_dedupes_attached_and_respects_limit() {
        let state = test_state().await;
        seed_loom_and_response(&state).await;
        let references = ReferenceRepository::new(&state.database);
        for (reference_id, label, target_uri, created_at) in [
            (
                "reference-a",
                "Event Sourcing",
                "loom://service/response-1",
                "2026-05-10T00:00:01Z",
            ),
            (
                "reference-b",
                "Event Sourcing duplicate",
                "loom://service/response-1",
                "2026-05-10T00:00:02Z",
            ),
            (
                "reference-c",
                "CQRS",
                "loom://service/response-1#cqrs",
                "2026-05-10T00:00:03Z",
            ),
        ] {
            references
                .insert_reference(&NewReference {
                    reference_id: reference_id.to_string(),
                    source_loom_id: Some("loom-1".to_string()),
                    source_response_id: Some("response-1".to_string()),
                    target_kind: "response".to_string(),
                    target_id: Some("response-1".to_string()),
                    target_uri: Some(target_uri.to_string()),
                    selected_text: None,
                    label: Some(label.to_string()),
                    metadata_json: Some("{}".to_string()),
                    created_at: created_at.to_string(),
                })
                .await
                .expect("insert Reference");
        }

        let suggestions = suggest_references(
            State(state),
            Json(SuggestReferencesRequest {
                loom_id: "loom-1".to_string(),
                response_id: None,
                draft_text: Some("event cqrs".to_string()),
                selected_text: None,
                attached_reference_ids: Some(vec!["reference-c".to_string()]),
                limit: Some(5),
            }),
        )
        .await
        .expect("suggest")
        .0;

        assert_eq!(suggestions.suggestions.len(), 1);
        assert_ne!(
            suggestions.suggestions[0].reference.reference_id,
            "reference-c"
        );
        assert_eq!(
            suggestions.suggestions[0].reference.target_uri.as_deref(),
            Some("loom://service/response-1")
        );
    }

    #[tokio::test]
    async fn suggestion_endpoint_rejects_raw_thinking_query_payloads() {
        let state = test_state().await;
        let error = suggest_references(
            State(state),
            Json(SuggestReferencesRequest {
                loom_id: "loom-1".to_string(),
                response_id: None,
                draft_text: Some("raw_thinking".to_string()),
                selected_text: None,
                attached_reference_ids: None,
                limit: Some(10),
            }),
        )
        .await
        .expect_err("raw thinking rejected");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.code, "RAW_THINKING_REJECTED");
    }

    fn response_reference_request() -> CreateReferenceRequest {
        CreateReferenceRequest {
            source_loom_id: "loom-1".to_string(),
            source_response_id: Some("response-1".to_string()),
            target_kind: "response".to_string(),
            target_id: Some("response-1".to_string()),
            target_uri: Some("loom://service/response-1".to_string()),
            label: Some("Target".to_string()),
            selected_text: None,
            fragment_hash: None,
            metadata: Some(json!({ "sourceResponseCode": "R1" })),
        }
    }

    fn fragment_reference_request() -> CreateReferenceRequest {
        CreateReferenceRequest {
            source_loom_id: "loom-1".to_string(),
            source_response_id: Some("response-1".to_string()),
            target_kind: "fragment".to_string(),
            target_id: Some("response-1".to_string()),
            target_uri: Some("loom://service/response-1#fragment=fragment-a".to_string()),
            label: Some("Selected Fragment".to_string()),
            selected_text: Some("Selected text".to_string()),
            fragment_hash: Some("fragment-a".to_string()),
            metadata: None,
        }
    }

    async fn seed_loom_and_response(state: &AppState) {
        LoomRepository::new(&state.database)
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Reference Loom".to_string(),
                summary: None,
                code: Some("L1".to_string()),
                canonical_uri: Some("loom://service/loom-1".to_string()),
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "2026-05-10T00:00:00Z".to_string(),
                updated_at: "2026-05-10T00:00:00Z".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");
        ResponseRepository::new(&state.database)
            .insert_response(&NewResponse {
                response_id: "response-1".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                title: Some("Target Response".to_string()),
                content: "Reference target".to_string(),
                code: Some("R1".to_string()),
                canonical_uri: Some("loom://service/response-1".to_string()),
                created_at: "2026-05-10T00:00:01Z".to_string(),
                updated_at: "2026-05-10T00:00:01Z".to_string(),
                sequence_index: 0,
                metadata_json: None,
            })
            .await
            .expect("insert Response");
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
                PathBuf::from("/tmp/loom-service-test.toml"),
                LoomServiceConfig::default(),
            ),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }
}
