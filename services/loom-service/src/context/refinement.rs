use crate::error::ServiceError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{future::Future, pin::Pin};

const MAX_TITLE_CHARS: usize = 120;
const MAX_SUMMARY_CHARS: usize = 900;
const MAX_ARRAY_ITEMS: usize = 10;
const MAX_ITEM_CHARS: usize = 240;
const FORBIDDEN_KEYS: &[&str] = &[
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

pub type ArtifactRefinementFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, ArtifactRefinementError>> + Send + 'a>>;

pub trait ArtifactRefinementProvider: Send + Sync {
    fn refine_response_capsule<'a>(
        &'a self,
        input: ResponseCapsuleRefinementInput,
    ) -> ArtifactRefinementFuture<'a, ResponseCapsuleRefinement>;

    fn refine_loom_checkpoint<'a>(
        &'a self,
        input: LoomCheckpointRefinementInput,
    ) -> ArtifactRefinementFuture<'a, LoomCheckpointRefinement>;
}

#[derive(Debug, Clone)]
pub struct ResponseCapsuleRefinementInput {
    pub response_id: String,
    pub loom_id: String,
    pub response_code: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub heuristic_summary: Option<String>,
    pub heuristic_key_points_json: Option<String>,
    pub heuristic_keywords_json: Option<String>,
    pub heuristic_entities_json: Option<String>,
    pub heuristic_code_blocks_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LoomCheckpointRefinementInput {
    pub checkpoint_id: String,
    pub loom_id: String,
    pub up_to_response_id: Option<String>,
    pub loom_title: Option<String>,
    pub heuristic_summary: String,
    pub recent_capsule_summaries: Vec<String>,
    pub previous_checkpoint_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResponseCapsuleRefinement {
    pub title: String,
    pub summary: String,
    pub key_points: Vec<String>,
    pub keywords: Vec<String>,
    pub entities: Vec<String>,
    pub code_blocks: Vec<CodeBlockRefinement>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodeBlockRefinement {
    pub language: Option<String>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoomCheckpointRefinement {
    pub summary: String,
    pub decisions: Vec<String>,
    pub constraints: Vec<String>,
    pub open_questions: Vec<String>,
    pub entities: Vec<String>,
    pub wefts: Vec<String>,
    pub references: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArtifactRefinementError {
    ProviderUnavailable(String),
    ProviderFailed(String),
    Rejected(String),
}

impl ArtifactRefinementError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::ProviderUnavailable(_) => "provider_unavailable",
            Self::ProviderFailed(_) => "provider_failed",
            Self::Rejected(_) => "refinement_rejected",
        }
    }

    pub fn safe_message(&self) -> String {
        let message = match self {
            Self::ProviderUnavailable(message)
            | Self::ProviderFailed(message)
            | Self::Rejected(message) => message,
        };
        sanitize_forbidden_text(message)
    }
}

impl std::fmt::Display for ArtifactRefinementError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.kind(), self.safe_message())
    }
}

impl std::error::Error for ArtifactRefinementError {}

pub fn parse_response_capsule_refinement_json(
    raw_json: &str,
) -> Result<ResponseCapsuleRefinement, ArtifactRefinementError> {
    let value = parse_and_reject_forbidden(raw_json)?;
    let refinement = ResponseCapsuleRefinement {
        title: required_string(&value, "title", MAX_TITLE_CHARS)?,
        summary: required_string(&value, "summary", MAX_SUMMARY_CHARS)?,
        key_points: string_array(&value, "keyPoints")?,
        keywords: string_array(&value, "keywords")?,
        entities: string_array(&value, "entities")?,
        code_blocks: code_blocks(&value)?,
    };
    if refinement.summary.trim().is_empty() {
        return Err(ArtifactRefinementError::Rejected(
            "response capsule refinement summary is empty".to_string(),
        ));
    }
    Ok(refinement)
}

pub fn parse_loom_checkpoint_refinement_json(
    raw_json: &str,
) -> Result<LoomCheckpointRefinement, ArtifactRefinementError> {
    let value = parse_and_reject_forbidden(raw_json)?;
    let refinement = LoomCheckpointRefinement {
        summary: required_string(&value, "summary", MAX_SUMMARY_CHARS)?,
        decisions: string_array(&value, "decisions")?,
        constraints: string_array(&value, "constraints")?,
        open_questions: string_array(&value, "openQuestions")?,
        entities: string_array(&value, "entities")?,
        wefts: string_array(&value, "wefts")?,
        references: string_array(&value, "references")?,
    };
    if refinement.summary.trim().is_empty() {
        return Err(ArtifactRefinementError::Rejected(
            "Loom checkpoint refinement summary is empty".to_string(),
        ));
    }
    Ok(refinement)
}

pub fn validate_response_capsule_refinement(
    refinement: &ResponseCapsuleRefinement,
) -> Result<(), ServiceError> {
    let value = serde_json::to_value(refinement).map_err(json_error)?;
    reject_forbidden_value(&value).map_err(refinement_error)
}

pub fn validate_loom_checkpoint_refinement(
    refinement: &LoomCheckpointRefinement,
) -> Result<(), ServiceError> {
    let value = serde_json::to_value(refinement).map_err(json_error)?;
    reject_forbidden_value(&value).map_err(refinement_error)
}

pub fn sanitize_forbidden_text(text: &str) -> String {
    let mut safe = text.to_string();
    for forbidden in FORBIDDEN_KEYS {
        safe = safe.replace(forbidden, "[redacted]");
    }
    safe
}

fn parse_and_reject_forbidden(raw_json: &str) -> Result<Value, ArtifactRefinementError> {
    let value = serde_json::from_str::<Value>(raw_json).map_err(|error| {
        ArtifactRefinementError::Rejected(format!("refinement output is not valid JSON: {error}"))
    })?;
    reject_forbidden_value(&value)?;
    Ok(value)
}

fn reject_forbidden_value(value: &Value) -> Result<(), ArtifactRefinementError> {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if FORBIDDEN_KEYS.contains(&key.as_str()) {
                    return Err(ArtifactRefinementError::Rejected(format!(
                        "refinement output contains forbidden key {key}"
                    )));
                }
                reject_forbidden_value(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_forbidden_value(value)?;
            }
        }
        Value::String(text) => {
            for forbidden in FORBIDDEN_KEYS {
                if text.contains(forbidden) {
                    return Err(ArtifactRefinementError::Rejected(format!(
                        "refinement output contains forbidden key {forbidden}"
                    )));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn required_string(
    value: &Value,
    field: &str,
    max_chars: usize,
) -> Result<String, ArtifactRefinementError> {
    let text = value.get(field).and_then(Value::as_str).ok_or_else(|| {
        ArtifactRefinementError::Rejected(format!("refinement output missing {field}"))
    })?;
    let text = truncate(text, max_chars);
    if text.trim().is_empty() {
        return Err(ArtifactRefinementError::Rejected(format!(
            "refinement output has empty {field}"
        )));
    }
    Ok(text)
}

fn string_array(value: &Value, field: &str) -> Result<Vec<String>, ArtifactRefinementError> {
    let Some(values) = value.get(field) else {
        return Ok(Vec::new());
    };
    let Some(values) = values.as_array() else {
        return Err(ArtifactRefinementError::Rejected(format!(
            "refinement output {field} must be an array"
        )));
    };

    Ok(values
        .iter()
        .filter_map(Value::as_str)
        .map(|value| truncate(value, MAX_ITEM_CHARS))
        .filter(|value| !value.trim().is_empty())
        .take(MAX_ARRAY_ITEMS)
        .collect())
}

fn code_blocks(value: &Value) -> Result<Vec<CodeBlockRefinement>, ArtifactRefinementError> {
    let Some(values) = value.get("codeBlocks") else {
        return Ok(Vec::new());
    };
    let Some(values) = values.as_array() else {
        return Err(ArtifactRefinementError::Rejected(
            "refinement output codeBlocks must be an array".to_string(),
        ));
    };

    let mut blocks = Vec::new();
    for value in values.iter().take(MAX_ARRAY_ITEMS) {
        let Some(object) = value.as_object() else {
            return Err(ArtifactRefinementError::Rejected(
                "refinement output codeBlocks entries must be objects".to_string(),
            ));
        };
        let summary = object
            .get("summary")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ArtifactRefinementError::Rejected(
                    "refinement output codeBlocks entry missing summary".to_string(),
                )
            })?;
        let language = object
            .get("language")
            .and_then(Value::as_str)
            .map(|value| truncate(value, 40))
            .filter(|value| !value.trim().is_empty());
        blocks.push(CodeBlockRefinement {
            language,
            summary: truncate(summary, MAX_ITEM_CHARS),
        });
    }
    Ok(blocks)
}

fn truncate(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    text.chars().take(max_chars).collect()
}

fn json_error(error: serde_json::Error) -> ServiceError {
    ServiceError::storage(format!("failed to inspect refinement payload: {error}"))
}

fn refinement_error(error: ArtifactRefinementError) -> ServiceError {
    ServiceError::storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        parse_loom_checkpoint_refinement_json, parse_response_capsule_refinement_json,
        ArtifactRefinementError,
    };

    #[test]
    fn parses_response_capsule_refinement() {
        let refinement = parse_response_capsule_refinement_json(
            r#"{
                "title":"Trip planning",
                "summary":"A concise Greece itinerary.",
                "keyPoints":["Athens first"],
                "keywords":["Greece"],
                "entities":["Athens"],
                "codeBlocks":[]
            }"#,
        )
        .expect("parse refinement");

        assert_eq!(refinement.title, "Trip planning");
        assert_eq!(refinement.key_points, vec!["Athens first"]);
    }

    #[test]
    fn malformed_refinement_json_is_rejected() {
        let error =
            parse_response_capsule_refinement_json("{nope").expect_err("malformed JSON rejected");
        assert!(matches!(error, ArtifactRefinementError::Rejected(_)));
    }

    #[test]
    fn forbidden_refinement_key_is_rejected() {
        let error = parse_response_capsule_refinement_json(
            r#"{
                "title":"Unsafe",
                "summary":"Unsafe",
                "keyPoints":[],
                "keywords":[],
                "entities":[],
                "codeBlocks":[],
                "raw_thinking":"private"
            }"#,
        )
        .expect_err("forbidden key rejected");
        assert!(error.to_string().contains("[redacted]"));
    }

    #[test]
    fn parses_checkpoint_refinement() {
        let refinement = parse_loom_checkpoint_refinement_json(
            r#"{
                "summary":"The Loom covered itinerary constraints.",
                "decisions":["Keep the plan short"],
                "constraints":[],
                "openQuestions":[],
                "entities":["Greece"],
                "wefts":[],
                "references":[]
            }"#,
        )
        .expect("parse checkpoint");

        assert_eq!(refinement.entities, vec!["Greece"]);
    }
}
