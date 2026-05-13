use crate::{
    api::state::AppState,
    providers::types::{
        LoomServiceErrorPayload, OllamaChatRequest, OllamaMessage, OllamaOptions,
        OllamaRuntimeError, OllamaRuntimeErrorKind, OllamaWireChunk,
    },
};
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

const MAX_QUICK_NUM_CTX: u32 = 2_048;
const MAX_QUICK_NUM_PREDICT: u32 = 1_536;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskSourceContext {
    pub title: Option<String>,
    pub response_code: Option<String>,
    pub canonical_uri: Option<String>,
    pub summary: Option<String>,
    #[serde(default)]
    pub key_points: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub entities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskTurn {
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskOptions {
    pub model: Option<String>,
    pub num_ctx: Option<u32>,
    pub num_predict: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuickAskIntent {
    AcronymExpansion,
    Definition,
    Translation,
    ExplainThis,
    RelationToSource,
    HowItWorks,
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskRequest {
    pub session_id: String,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub selected_text: Option<String>,
    pub source_context: Option<QuickAskSourceContext>,
    #[serde(default)]
    pub turns: Vec<QuickAskTurn>,
    pub question: String,
    pub intent: QuickAskIntent,
    #[serde(default)]
    pub options: QuickAskOptions,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskResponse {
    pub answer: String,
    pub model: String,
    pub warnings: Vec<String>,
}

pub async fn quick(
    State(state): State<AppState>,
    Json(input): Json<QuickAskRequest>,
) -> impl IntoResponse {
    let config = state.config.current();
    let model = input
        .options
        .model
        .clone()
        .unwrap_or(config.providers.default_quick_model);
    if let Some(answer) = deterministic_e2e_quick_answer(&input) {
        return Json(QuickAskResponse {
            answer,
            model,
            warnings: Vec::new(),
        })
        .into_response();
    }
    let request_id = format!("quick-{}", input.session_id);
    let request = quick_ollama_request(&input, model.clone(), request_id.clone());

    let response = match state.ollama.post_chat(&request).await {
        Ok(response) => response,
        Err(error) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(error_payload(
                    &request_id,
                    &error,
                    &state.ollama.config().base_url,
                )),
            )
                .into_response();
        }
    };

    let status = response.status();
    if !status.is_success() {
        let error = OllamaRuntimeError::new(
            if status.as_u16() == 404 {
                OllamaRuntimeErrorKind::ModelMissing
            } else {
                OllamaRuntimeErrorKind::UnexpectedResponse
            },
            "Ollama rejected the quick Ask request.",
            true,
        )
        .with_status(status.as_u16());
        return (
            StatusCode::BAD_GATEWAY,
            Json(error_payload(
                &request_id,
                &error,
                &state.ollama.config().base_url,
            )),
        )
            .into_response();
    }

    let chunk = match response.json::<OllamaWireChunk>().await {
        Ok(chunk) => chunk,
        Err(_) => {
            let error = OllamaRuntimeError::new(
                OllamaRuntimeErrorKind::UnexpectedResponse,
                "Ollama returned malformed quick Ask JSON.",
                true,
            );
            return (
                StatusCode::BAD_GATEWAY,
                Json(error_payload(
                    &request_id,
                    &error,
                    &state.ollama.config().base_url,
                )),
            )
                .into_response();
        }
    };
    let answer = chunk
        .message
        .and_then(|message| message.content)
        .or(chunk.response)
        .unwrap_or_default();
    Json(QuickAskResponse {
        answer,
        model,
        warnings: Vec::new(),
    })
    .into_response()
}

fn deterministic_e2e_quick_answer(input: &QuickAskRequest) -> Option<String> {
    if std::env::var("LOOM_SERVICE_E2E_PROVIDER").ok().as_deref() != Some("event-sourcing") {
        return None;
    }

    let selected = input.selected_text.as_deref().unwrap_or("").trim();
    let selected_lower = selected.to_lowercase();
    let question_lower = input.question.to_lowercase();
    let source_text = input
        .source_context
        .as_ref()
        .map(|source| {
            [
                source.title.clone().unwrap_or_default(),
                source.summary.clone().unwrap_or_default(),
                source.key_points.join(" "),
                source.keywords.join(" "),
                source.entities.join(" "),
            ]
            .join(" ")
            .to_lowercase()
        })
        .unwrap_or_default();
    let has_previous_turn = !input.turns.is_empty();

    if selected_lower == "mcp" && question_lower.contains("açılım") {
        return Some(
            "MCP = Model Context Protocol. Bu kaynakta MCP, plugin entegrasyonu, tool çağrıları, session ve context bilgisini modelle güvenli biçimde paylaşan protokol anlamında kullanılıyor. Microsoft Component Platform gibi ilgisiz açılımlara gitmez; seçili fragment ve kaynak ipuçları Model Context Protocol anlamını veriyor."
                .to_string(),
        );
    }
    if selected_lower == "cqrs" && question_lower.contains("açılım") {
        return Some(
            "CQRS = Command Query Responsibility Segregation. Event Sourcing bağlamında komut/yazma modeli ile okuma modelini ayırır; Event Store olayları saklar, Replay ise okuma projeksiyonlarını yeniden kurabilir."
                .to_string(),
        );
    }
    if question_lower.contains("event sourcing") {
        let continuity = if has_previous_turn {
            "Önceki Quick Ask turundaki açılımı koruyarak: "
        } else {
            ""
        };
        let selected_label = if selected.is_empty() {
            "seçili fragment"
        } else {
            selected
        };
        return Some(format!(
            "{continuity}{selected_label} seçili fragment olarak birincil kalır. Event Sourcing tarafında ilişki, modelin tool/session/context gibi dış sistem bağlamını doğru anlaması ve CQRS/Event Store/Replay açıklamasını bu bağlamla karıştırmaması üzerinden kurulur. Kaynak ipuçları: {source_hint}.",
            source_hint = if source_text.contains("event sourcing") {
                "Event Sourcing, CQRS ve plugin context aynı yanıtta geçti"
            } else {
                "kaynak metin seçili fragmenti disambiguate etmek için kullanıldı"
            }
        ));
    }

    Some(format!(
        "Selected fragment {selected} için servis destekli Quick Ask yanıtı. Bu yanıt seçili fragmenti birincil, kaynak bağlamını ise arka plan olarak kullanır; önceki geçici Ask turları varsa sessizce devamlılık sağlar."
    ))
}

fn quick_messages(input: &QuickAskRequest) -> Vec<OllamaMessage> {
    vec![
        OllamaMessage {
            role: "system".to_string(),
            content: quick_system_prompt(),
        },
        OllamaMessage {
            role: "user".to_string(),
            content: quick_user_prompt(input),
        },
    ]
}

fn quick_ollama_request(
    input: &QuickAskRequest,
    model: String,
    request_id: String,
) -> OllamaChatRequest {
    OllamaChatRequest {
        model,
        messages: quick_messages(input),
        stream: Some(false),
        think: Some(false),
        options: Some(OllamaOptions {
            num_ctx: Some(
                input
                    .options
                    .num_ctx
                    .unwrap_or(1_024)
                    .min(MAX_QUICK_NUM_CTX),
            ),
            num_predict: Some(
                input
                    .options
                    .num_predict
                    .unwrap_or(MAX_QUICK_NUM_PREDICT)
                    .min(MAX_QUICK_NUM_PREDICT),
            ),
            temperature: Some(0.2),
        }),
        request_id: Some(request_id),
    }
}

fn quick_system_prompt() -> String {
    [
        "Answer as Loom Quick Ask.",
        "Use instant, concise behavior. Do not use thinking or deep synthesis.",
        "Use the selected fragment as primary context when present.",
        "Use source context and previous temporary Ask turns only as background.",
        "Be concise but useful. Do not force the answer into one sentence.",
        "Use 2-5 sentences, 1-3 short paragraphs, or brief bullets when that is clearer.",
        "Do not write a long essay.",
        "Answer directly. Do not mention context blocks, capsules, wrapper labels, or artifact names.",
        "Never output raw thinking, chain-of-thought, or hidden reasoning.",
    ]
    .join(" ")
}

fn quick_user_prompt(input: &QuickAskRequest) -> String {
    let selected = input.selected_text.as_deref().unwrap_or("").trim();
    let source = input.source_context.as_ref();
    let previous_turns = input
        .turns
        .iter()
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|turn| {
            format!(
                "User: {}\nAssistant: {}",
                compact(&turn.question, 220),
                compact(&turn.answer, 420)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let source_context = source
        .map(|source| {
            [
                source.title.as_ref().map(|value| format!("Title: {value}")),
                source
                    .response_code
                    .as_ref()
                    .map(|value| format!("Response code: {value}")),
                source
                    .canonical_uri
                    .as_ref()
                    .map(|value| format!("Canonical URI: {value}")),
                source
                    .summary
                    .as_ref()
                    .map(|value| format!("Summary: {value}")),
                (!source.key_points.is_empty())
                    .then(|| format!("Key points: {}", source.key_points.join("; "))),
                (!source.keywords.is_empty())
                    .then(|| format!("Keywords: {}", source.keywords.join(", "))),
                (!source.entities.is_empty())
                    .then(|| format!("Entities: {}", source.entities.join(", "))),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("\n")
        })
        .unwrap_or_default();
    [
        format!("Session: {}", input.session_id),
        input
            .source_loom_id
            .as_ref()
            .map(|value| format!("Source Loom: {value}"))
            .unwrap_or_default(),
        input
            .source_response_id
            .as_ref()
            .map(|value| format!("Source Response: {value}"))
            .unwrap_or_default(),
        format!("Intent: {:?}", input.intent),
        if selected.is_empty() {
            String::new()
        } else {
            format!("Selected fragment:\n\"{}\"", compact(selected, 1_800))
        },
        if source_context.is_empty() {
            String::new()
        } else {
            format!("Source context clues:\n{source_context}")
        },
        if previous_turns.is_empty() {
            String::new()
        } else {
            format!("Previous temporary Ask turns:\n{previous_turns}")
        },
        "Current question:".to_string(),
        compact(&input.question, 700),
        "Answer style: answer directly; be concise but useful; do not force a one-sentence answer; use a short paragraph or bullets if clearer; do not write a long essay.".to_string(),
        acronym_instruction(input),
    ]
    .into_iter()
    .filter(|part| !part.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n\n")
}

fn acronym_instruction(input: &QuickAskRequest) -> String {
    if !matches!(input.intent, QuickAskIntent::AcronymExpansion) {
        return String::new();
    }
    let selected = input.selected_text.as_deref().unwrap_or("").trim();
    format!(
        "Acronym rule: answer should start with \"{} = <expansion>\". Use source context clues to disambiguate before generic acronym knowledge. If the source does not explicitly define it, answer cautiously.",
        selected
    )
}

fn compact(value: &str, max_length: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.len() <= max_length {
        return normalized;
    }
    normalized
        .chars()
        .take(max_length.saturating_sub(1))
        .collect::<String>()
        .trim()
        .to_string()
        + "…"
}

fn error_payload(
    correlation_id: &str,
    error: &OllamaRuntimeError,
    base_url: &str,
) -> LoomServiceErrorPayload {
    LoomServiceErrorPayload {
        code: format!("{:?}", error.kind).to_ascii_uppercase(),
        message: error.message.clone(),
        kind: error.kind,
        retryable: error.retryable,
        correlation_id: correlation_id.to_string(),
        details: json!({
            "endpoint": "/ask/quick",
            "baseUrl": base_url,
            "httpStatus": error.status,
            "doneReason": error.done_reason
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_prompt_forces_fast_non_thinking_behavior() {
        let prompt = quick_system_prompt();
        assert!(prompt.contains("Do not use thinking"));
        assert!(prompt.contains("deep synthesis"));
        assert!(prompt.contains("Do not force the answer into one sentence"));
        assert!(!prompt.contains("raw_thinking"));
    }

    #[test]
    fn selected_fragment_is_primary_and_acronym_instruction_is_source_aware() {
        let request = QuickAskRequest {
            session_id: "ask-1".to_string(),
            source_loom_id: Some("loom-1".to_string()),
            source_response_id: Some("response-1".to_string()),
            selected_text: Some("MCP".to_string()),
            source_context: Some(QuickAskSourceContext {
                title: Some("Plugin sessions".to_string()),
                response_code: None,
                canonical_uri: None,
                summary: Some("MCP connects models to tools and plugin sessions.".to_string()),
                key_points: vec!["Model Context Protocol is used for tool context.".to_string()],
                keywords: vec!["plugin".to_string(), "session".to_string()],
                entities: vec!["Model Context Protocol".to_string()],
            }),
            turns: vec![QuickAskTurn {
                question: "önceki soru".to_string(),
                answer: "önceki cevap".to_string(),
            }],
            question: "açılımı nedir?".to_string(),
            intent: QuickAskIntent::AcronymExpansion,
            options: QuickAskOptions::default(),
        };
        let prompt = quick_user_prompt(&request);
        assert!(prompt.contains("Selected fragment"));
        assert!(prompt.contains("MCP = <expansion>"));
        assert!(prompt.contains("Model Context Protocol"));
        assert!(prompt.contains("Previous temporary Ask turns"));
        assert!(prompt.contains("Answer style"));
    }

    #[test]
    fn current_question_and_selected_fragment_are_before_background_turns() {
        let request = quick_request_with_turns();
        let prompt = quick_user_prompt(&request);

        let selected_index = prompt.find("Selected fragment").expect("selected block");
        let source_index = prompt.find("Source context clues").expect("source block");
        let turns_index = prompt
            .find("Previous temporary Ask turns")
            .expect("previous turns block");
        let question_index = prompt.find("Current question").expect("current question");

        assert!(selected_index < source_index);
        assert!(source_index < turns_index);
        assert!(turns_index < question_index);
        assert!(prompt.contains("Current question:\n\nşimdi açıkla"));
        assert!(prompt.contains("User: önceki soru"));
        assert!(prompt.contains("Assistant: önceki cevap"));
    }

    #[test]
    fn quick_ollama_request_forces_no_thinking_fast_budget_and_no_streaming() {
        let mut request = quick_request_with_turns();
        request.options.num_ctx = Some(99_999);
        request.options.num_predict = Some(99_999);
        let ollama =
            quick_ollama_request(&request, "quick-model".to_string(), "quick-1".to_string());

        assert_eq!(ollama.model, "quick-model");
        assert_eq!(ollama.stream, Some(false));
        assert_eq!(ollama.think, Some(false));
        let options = ollama.options.expect("quick options");
        assert_eq!(options.num_ctx, Some(MAX_QUICK_NUM_CTX));
        assert_eq!(options.num_predict, Some(MAX_QUICK_NUM_PREDICT));
        assert_eq!(options.temperature, Some(0.2));
        let serialized = serde_json::to_string(&ollama.messages).expect("serialize messages");
        assert!(serialized.contains("deep synthesis"));
        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("chain_of_thought"));
    }

    fn quick_request_with_turns() -> QuickAskRequest {
        QuickAskRequest {
            session_id: "ask-1".to_string(),
            source_loom_id: Some("loom-1".to_string()),
            source_response_id: Some("response-1".to_string()),
            selected_text: Some("MCP".to_string()),
            source_context: Some(QuickAskSourceContext {
                title: Some("Parent title should not answer for the user".to_string()),
                response_code: Some("R1".to_string()),
                canonical_uri: Some("loom://response/response-1".to_string()),
                summary: Some("Model Context Protocol appears in a plugin session.".to_string()),
                key_points: vec!["MCP means Model Context Protocol here.".to_string()],
                keywords: vec!["plugin".to_string()],
                entities: vec!["Model Context Protocol".to_string()],
            }),
            turns: vec![QuickAskTurn {
                question: "önceki soru".to_string(),
                answer: "önceki cevap".to_string(),
            }],
            question: "şimdi açıkla".to_string(),
            intent: QuickAskIntent::ExplainThis,
            options: QuickAskOptions::default(),
        }
    }
}
