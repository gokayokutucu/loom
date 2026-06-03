use crate::{
    api::state::AppState,
    providers::{
        contract::{
            ProviderContractEvent, ProviderContractMessage, ProviderContractMessageRole,
            ProviderContractOptions, ProviderContractRequest,
        },
        pipeline::ProviderPipeline,
        types::{
            LoomServiceErrorPayload, OllamaChatRequest, OllamaMessage, OllamaOptions,
            OllamaRuntimeError, OllamaRuntimeErrorKind, ProviderError, ProviderErrorKind,
        },
    },
};
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use futures_util::StreamExt;
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
pub struct QuickAskActiveReference {
    pub reference_id: Option<String>,
    pub label: String,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub selected_text: Option<String>,
    pub preview: Option<String>,
    pub source_response_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskTurn {
    pub question: String,
    pub answer: String,
    pub title: Option<String>,
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
    RelationToReference,
    ImplementationInTopic,
    HowItWorksWithReference,
    RelationToSource,
    HowItWorks,
    Usage,
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskRequest {
    pub session_id: String,
    pub quick_ask_trace_id: Option<String>,
    pub source_loom_id: Option<String>,
    pub source_response_id: Option<String>,
    pub selected_text: Option<String>,
    pub source_context: Option<QuickAskSourceContext>,
    #[serde(default)]
    pub active_references: Vec<QuickAskActiveReference>,
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
    pub title: String,
    pub model: String,
    pub warnings: Vec<String>,
    pub focus_subject: Option<String>,
    pub focus_subject_source: String,
    pub resolved_intent: String,
    pub requested_topic: Option<String>,
    pub diagnostics: QuickAskDiagnostics,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskDiagnostics {
    pub trace_id: Option<String>,
    pub selected_text: Option<String>,
    pub source_response_id: Option<String>,
    pub source_loom_id: Option<String>,
    pub input_active_reference_labels: Vec<String>,
    pub service_active_reference_labels: Vec<String>,
    pub active_reference_labels: Vec<String>,
    pub previous_ask_turn_count: usize,
    pub turn_index: usize,
    pub original_focus_subject: Option<String>,
    pub normalized_focus_subject: Option<String>,
    pub focus_subject: Option<String>,
    pub focus_subject_source: String,
    pub previous_answer_term_matched: Option<String>,
    pub active_chip_used_as_primary: bool,
    pub active_chip_used_as_background: bool,
    pub seed_context_labels: Vec<String>,
    pub seed_context_mode: String,
    pub current_turn_primary_context: String,
    pub follow_up_intent: Option<String>,
    pub resolved_intent: String,
    pub requested_topic: Option<String>,
    pub composed_task: Option<String>,
    pub normalized_composed_question: Option<String>,
    pub language: Option<String>,
    pub language_contamination_detected: bool,
    pub stale_chip_override_detected: bool,
    pub prompt_section_order: Vec<String>,
    pub provider_request_summary: QuickAskProviderRequestSummary,
    pub answer_validation: QuickAskAnswerValidation,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskProviderRequestSummary {
    pub message_count: usize,
    pub focus_subject: Option<String>,
    pub active_reference_labels: Vec<String>,
    pub selected_text: Option<String>,
    pub requested_topic: Option<String>,
    pub composed_task_preview: Option<String>,
    pub contains_focus_subject: bool,
    pub focus_subject_before_source: bool,
    pub active_reference_count: usize,
    pub previous_turn_count: usize,
    pub selected_fragment_present: bool,
    pub source_context_present: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAskAnswerValidation {
    pub includes_focus_subject: bool,
    pub includes_requested_topic: bool,
    pub generic_source_only_detected: bool,
    pub starts_with_focus_subject_or_definition: bool,
    pub language_contamination_detected: bool,
    pub stale_chip_override_detected: bool,
    pub repeats_previous_answer: bool,
    pub follows_up_on_previous_turn: bool,
    pub seed_chip_rendered_as_current_turn: bool,
    pub answer_adds_new_information: bool,
    pub validation_passed: bool,
    pub failure_reasons: Vec<String>,
    pub validation_failed_first_attempt: bool,
    pub retry_attempted: bool,
    pub retry_succeeded: bool,
    pub final_answer_source: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
enum QuickAskFocusSubjectSource {
    SelectedFragment,
    ActiveReference,
    SourceResponse,
    CurrentQuestion,
    PreviousTurn,
    PreviousAssistantAnswer,
    Unknown,
}

impl QuickAskFocusSubjectSource {
    fn as_str(&self) -> &'static str {
        match self {
            Self::SelectedFragment => "selected_fragment",
            Self::ActiveReference => "active_reference",
            Self::SourceResponse => "source_response",
            Self::CurrentQuestion => "current_question",
            Self::PreviousTurn => "previous_turn",
            Self::PreviousAssistantAnswer => "previous_assistant_answer",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum QuickAskResolvedIntent {
    Definition,
    AcronymExpansion,
    ImplementationInTopic,
    RelationToReference,
    Usage,
    ExplainThis,
    HowItWorks,
    Translation,
    Unknown,
}

impl QuickAskResolvedIntent {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Definition => "definition",
            Self::AcronymExpansion => "acronym_expansion",
            Self::ImplementationInTopic => "implementation_in_topic",
            Self::RelationToReference => "relation_to_reference",
            Self::Usage => "usage",
            Self::ExplainThis => "explain_this",
            Self::HowItWorks => "how_it_works",
            Self::Translation => "translation",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone)]
struct QuickAskFocus {
    original_focus_subject: Option<String>,
    focus_subject: Option<String>,
    focus_subject_source: QuickAskFocusSubjectSource,
    intent: QuickAskResolvedIntent,
    requested_topic: Option<String>,
    warnings: Vec<String>,
}

pub async fn quick(
    State(state): State<AppState>,
    Json(input): Json<QuickAskRequest>,
) -> impl IntoResponse {
    if state.restart.is_draining() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "runtime_draining",
                "kind": "runtime_draining",
                "message": "loom-service is draining and is not accepting new quick Ask requests."
            })),
        )
            .into_response();
    }
    let config = state.config.current();
    let model = input
        .options
        .model
        .clone()
        .unwrap_or(config.providers.default_quick_model);
    let focus = resolve_quick_ask_focus(&input);
    let mut warnings = quick_reference_warnings(&input);
    warnings.extend(focus.warnings.clone());
    if let Some(answer) = deterministic_e2e_quick_answer(&input) {
        return quick_validated_response(answer, model, warnings, &input, &focus).into_response();
    }
    let request_id = format!("quick-{}", input.session_id);
    let request = quick_ollama_request(&input, model.clone(), request_id.clone());

    let answer = match quick_answer_from_provider_adapter(&state, request).await {
        Ok(Some(answer)) => answer,
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
        Ok(None) => {
            let error = OllamaRuntimeError::new(
                OllamaRuntimeErrorKind::UnexpectedResponse,
                "Ollama quick Ask response did not include visible answer content.",
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
    let first_attempt_validation = quick_answer_validation(&answer, &focus, &input);
    if quick_answer_contract_required(&focus) && !first_attempt_validation.validation_passed {
        let repair_request = quick_repair_ollama_request(
            &input,
            &focus,
            &answer,
            model.clone(),
            format!("{request_id}-repair"),
        );
        let retry_answer = quick_answer_from_provider_adapter(&state, repair_request)
            .await
            .ok()
            .flatten();

        if let Some(retry_answer) = retry_answer {
            let retry_validation = quick_answer_validation(&retry_answer, &focus, &input)
                .with_attempt_metadata(true, true, true, "retry");
            if retry_validation.validation_passed {
                let title =
                    quick_title_from_model(&state, &input, &retry_answer, &model, &mut warnings)
                        .await;
                return Json(quick_response_with_validation(
                    retry_answer,
                    model,
                    warnings,
                    &input,
                    &focus,
                    Some(title),
                    retry_validation,
                ))
                .into_response();
            }
        }

        let failed_validation =
            first_attempt_validation.with_attempt_metadata(true, true, false, "validation_error");
        return Json(quick_validation_error_response(
            model,
            warnings,
            &input,
            &focus,
            failed_validation,
        ))
        .into_response();
    }

    let title = quick_title_from_model(&state, &input, &answer, &model, &mut warnings).await;
    Json(quick_response_with_validation(
        answer,
        model,
        warnings,
        &input,
        &focus,
        Some(title),
        first_attempt_validation.with_attempt_metadata(false, false, false, "first_attempt"),
    ))
    .into_response()
}

fn quick_validated_response(
    answer: String,
    model: String,
    warnings: Vec<String>,
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
) -> Json<QuickAskResponse> {
    let validation = quick_answer_validation(&answer, focus, input).with_attempt_metadata(
        false,
        false,
        false,
        "first_attempt",
    );
    if quick_answer_contract_required(focus) && !validation.validation_passed {
        return Json(quick_validation_error_response(
            model,
            warnings,
            input,
            focus,
            validation.with_attempt_metadata(true, false, false, "validation_error"),
        ));
    }
    Json(quick_response_with_validation(
        answer, model, warnings, input, focus, None, validation,
    ))
}

fn quick_response_with_validation(
    answer: String,
    model: String,
    warnings: Vec<String>,
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
    title: Option<String>,
    answer_validation: QuickAskAnswerValidation,
) -> QuickAskResponse {
    let answer = clean_quick_visible_answer(&answer, focus);
    let title = title.unwrap_or_else(|| quick_fallback_title(input, &answer));
    QuickAskResponse {
        diagnostics: quick_diagnostics(input, focus, &answer, Some(answer_validation)),
        answer,
        title,
        model,
        warnings,
        focus_subject: focus.focus_subject.clone(),
        focus_subject_source: focus.focus_subject_source.as_str().to_string(),
        resolved_intent: focus.intent.as_str().to_string(),
        requested_topic: focus.requested_topic.clone(),
    }
}

fn quick_validation_error_response(
    model: String,
    mut warnings: Vec<String>,
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
    answer_validation: QuickAskAnswerValidation,
) -> QuickAskResponse {
    warnings.push("quick_ask_focus_validation_failed".to_string());
    let subject = focus
        .focus_subject
        .as_deref()
        .unwrap_or("the selected context");
    QuickAskResponse {
        answer: format!(
            "Quick Ask could not produce an answer focused on {subject}. Please retry."
        ),
        title: format!("Ask: {subject}"),
        model,
        warnings,
        focus_subject: focus.focus_subject.clone(),
        focus_subject_source: focus.focus_subject_source.as_str().to_string(),
        resolved_intent: focus.intent.as_str().to_string(),
        requested_topic: focus.requested_topic.clone(),
        diagnostics: quick_diagnostics(input, focus, "", Some(answer_validation)),
    }
}

#[cfg(test)]
fn quick_answer_from_ollama_body(body: &serde_json::Value) -> Option<String> {
    body.get("message")
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| body.get("response").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|answer| !answer.is_empty())
        .map(ToString::to_string)
}

async fn quick_answer_from_provider_adapter(
    state: &AppState,
    request: OllamaChatRequest,
) -> Result<Option<String>, OllamaRuntimeError> {
    let provider_pipeline = ProviderPipeline::new(state.ollama.clone());
    let provider_profile = provider_pipeline.default_generation_profile();
    let provider_request = quick_provider_request_from_ollama_request(
        &request,
        provider_profile.provider_kind,
        &provider_profile.provider_profile_id,
    );
    let mut provider_stream = provider_pipeline.stream_chat(provider_request);
    let mut events = Vec::new();
    while let Some(event) = provider_stream.next().await {
        events.push(event);
    }
    collect_quick_answer_from_provider_events(events)
}

fn quick_provider_request_from_ollama_request(
    request: &OllamaChatRequest,
    provider_kind: crate::providers::config::ProviderKind,
    provider_profile_id: &str,
) -> ProviderContractRequest {
    ProviderContractRequest {
        provider_kind,
        provider_profile_id: provider_profile_id.to_string(),
        model_id: request.model.clone(),
        messages: request
            .messages
            .iter()
            .map(|message| ProviderContractMessage {
                role: match message.role.as_str() {
                    "system" => ProviderContractMessageRole::System,
                    "assistant" => ProviderContractMessageRole::Assistant,
                    _ => ProviderContractMessageRole::User,
                },
                content: message.content.clone(),
            })
            .collect(),
        options: ProviderContractOptions {
            temperature: request
                .options
                .as_ref()
                .and_then(|options| options.temperature),
            top_p: None,
            max_tokens: request
                .options
                .as_ref()
                .and_then(|options| options.num_predict),
            context_tokens: request.options.as_ref().and_then(|options| options.num_ctx),
            thinking: request.think,
        },
        stream: request.stream.unwrap_or(false),
        request_id: request
            .request_id
            .clone()
            .unwrap_or_else(|| "quick-ask".to_string()),
        runtime_metadata: json!({
            "source": "ask.quick",
            "quickAsk": true,
        }),
        loom_context_metadata: json!({
            "contextOwnedBy": "quick_ask_prompt_builder",
        }),
    }
}

fn collect_quick_answer_from_provider_events(
    events: impl IntoIterator<Item = ProviderContractEvent>,
) -> Result<Option<String>, OllamaRuntimeError> {
    let mut answer = String::new();
    for event in events {
        match event {
            ProviderContractEvent::Delta { text } => answer.push_str(&text),
            ProviderContractEvent::ThinkingDelta { .. } => {}
            ProviderContractEvent::ThinkingStatus { .. } => {}
            ProviderContractEvent::Completed { .. } | ProviderContractEvent::Truncated { .. } => {
                let visible = answer.trim();
                return Ok((!visible.is_empty()).then(|| visible.to_string()));
            }
            ProviderContractEvent::Cancelled => {
                return Err(OllamaRuntimeError::new(
                    OllamaRuntimeErrorKind::Aborted,
                    "Quick Ask provider request was cancelled.",
                    true,
                ));
            }
            ProviderContractEvent::Error { error } => {
                return Err(quick_ollama_error_from_provider_error(error));
            }
        }
    }
    let visible = answer.trim();
    Ok((!visible.is_empty()).then(|| visible.to_string()))
}

fn quick_ollama_error_from_provider_error(error: ProviderError) -> OllamaRuntimeError {
    let kind = match error.kind {
        ProviderErrorKind::InvalidConfig
        | ProviderErrorKind::UnsafeEndpoint
        | ProviderErrorKind::RemoteEndpointBlocked
        | ProviderErrorKind::InsecureRemoteHttpBlocked
        | ProviderErrorKind::MissingSecret
        | ProviderErrorKind::SecretUnavailable => OllamaRuntimeErrorKind::InvalidConfig,
        ProviderErrorKind::RuntimeUnavailable
        | ProviderErrorKind::ConnectionRefused
        | ProviderErrorKind::DnsFailed
        | ProviderErrorKind::ServiceUnavailable => OllamaRuntimeErrorKind::RuntimeUnavailable,
        ProviderErrorKind::ModelMissing | ProviderErrorKind::ModelUnavailable => {
            OllamaRuntimeErrorKind::ModelMissing
        }
        ProviderErrorKind::TimeoutBeforeFirstChunk | ProviderErrorKind::RequestTimeout => {
            OllamaRuntimeErrorKind::TimeoutBeforeFirstChunk
        }
        ProviderErrorKind::TimeoutDuringStream => OllamaRuntimeErrorKind::TimeoutDuringStream,
        ProviderErrorKind::Cancelled => OllamaRuntimeErrorKind::Aborted,
        ProviderErrorKind::DoneReasonLength | ProviderErrorKind::OutputLimitReached => {
            OllamaRuntimeErrorKind::DoneReasonLength
        }
        ProviderErrorKind::ProviderRejectedThink => OllamaRuntimeErrorKind::ProviderRejectedThink,
        ProviderErrorKind::StreamParseError => OllamaRuntimeErrorKind::StreamParseError,
        _ => OllamaRuntimeErrorKind::UnexpectedResponse,
    };
    let message = error
        .technical_message
        .or(error.raw_provider_message)
        .unwrap_or(error.user_message);
    let mut runtime_error = OllamaRuntimeError::new(kind, message, error.retryable);
    if let Some(status) = error.status_code {
        runtime_error = runtime_error.with_status(status);
    }
    runtime_error
}

async fn quick_title_from_model(
    state: &AppState,
    input: &QuickAskRequest,
    answer: &str,
    model: &str,
    warnings: &mut Vec<String>,
) -> String {
    let request = quick_title_ollama_request(
        input,
        answer,
        model.to_string(),
        format!("quick-title-{}", input.session_id),
    );
    let title = quick_answer_from_provider_adapter(state, request)
        .await
        .ok()
        .flatten()
        .and_then(|answer| clean_quick_title(&answer));
    match title {
        Some(title) => title,
        None => {
            warnings.push("quick_ask_title_fallback".to_string());
            quick_fallback_title(input, answer)
        }
    }
}

fn quick_title_ollama_request(
    input: &QuickAskRequest,
    answer: &str,
    model: String,
    request_id: String,
) -> OllamaChatRequest {
    let previous_titles = input
        .turns
        .iter()
        .filter_map(|turn| turn.title.as_deref())
        .take(4)
        .collect::<Vec<_>>()
        .join(", ");
    OllamaChatRequest {
        model,
        messages: vec![
            OllamaMessage {
                role: "system".to_string(),
                content: [
                    "Create a short visible title for a Loom Quick Ask answer.",
                    "Use the same language as the user's question.",
                    "Return only the title text, not JSON, markdown, bullets, quotes, or explanation.",
                    "Never output raw thinking, chain-of-thought, or hidden reasoning.",
                    "Keep it under 7 words.",
                ]
                .join(" "),
            },
            OllamaMessage {
                role: "user".to_string(),
                content: [
                    format!("Question: {}", input.question.trim()),
                    format!("Answer: {}", answer.trim()),
                    format!(
                        "Selected text: {}",
                        input.selected_text.as_deref().unwrap_or("").trim()
                    ),
                    format!(
                        "Source title: {}",
                        input
                            .source_context
                            .as_ref()
                            .and_then(|source| source.title.as_deref())
                            .unwrap_or("")
                    ),
                    format!("Previous titles: {previous_titles}"),
                ]
                .join("\n"),
            },
        ],
        stream: Some(false),
        think: Some(false),
        options: Some(OllamaOptions {
            num_ctx: Some(768),
            num_predict: Some(32),
            temperature: Some(0.1),
        }),
        request_id: Some(request_id),
    }
}

fn clean_quick_title(value: &str) -> Option<String> {
    let title = value
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '*' | '#' | '-' | '•'))
        .trim()
        .replace(['\n', '\r', '\t'], " ");
    let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.chars().take(72).collect())
}

fn quick_fallback_title(input: &QuickAskRequest, answer: &str) -> String {
    let source = answer
        .split(['.', '!', '?'])
        .find(|part| !part.trim().is_empty())
        .unwrap_or_else(|| input.question.trim());
    clean_quick_title(source).unwrap_or_else(|| "Quick Ask".to_string())
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
    let focus = resolve_quick_ask_focus(input);
    let composed_task = quick_composed_task(input, &focus).unwrap_or_default();
    let composed_has_focus = focus
        .focus_subject
        .as_deref()
        .map(|subject| contains_case_insensitive(&composed_task, subject))
        .unwrap_or(true);
    let force_generic_first_attempt = std::env::var("LOOM_SERVICE_E2E_QUICK_GENERIC_FIRST")
        .ok()
        .as_deref()
        == Some("true");
    if force_generic_first_attempt && focus.focus_subject.is_some() {
        return Some(
            "Event Sourcing, geçmişte oluşan olayları kaydederek sistem durumunu yeniden kurmayı sağlar. Finans, sipariş yönetimi, audit ve hata ayıklama gibi alanlarda kullanılır."
                .to_string(),
        );
    }
    if matches!(
        focus.focus_subject_source,
        QuickAskFocusSubjectSource::PreviousAssistantAnswer
    ) && focus
        .focus_subject
        .as_deref()
        .map(|label| label.eq_ignore_ascii_case("resultado"))
        .unwrap_or(false)
    {
        return Some(
            "Resultado, önceki Quick Ask yanıtında geçen bir kelime olarak İspanyolca/Portekizce \"sonuç\" anlamına gelir. Burada teknik konu Event Sourcing değil, önceki yanıttaki bu kelimenin anlamıdır; Türkçede \"sonuç\" veya \"çıktı\" diye düşünmelisin."
                .to_string(),
        );
    }
    if focus
        .focus_subject
        .as_deref()
        .map(|label| label.eq_ignore_ascii_case("event logging"))
        .unwrap_or(false)
    {
        if matches!(focus.intent, QuickAskResolvedIntent::Usage) && has_previous_turn {
            if !composed_has_focus || !composed_task.contains("nasıl kullanıldığını") {
                return Some(
                    "Debug failure: follow-up composed task did not ask event logging usage."
                        .to_string(),
                );
            }
            return Some(
                "event logging, Event Sourcing'de domain event oluştuğu anda olayın append-only Event Store'a yazılmasıyla kullanılır. Örneğin `OrderCreated`, `PaymentFailed` veya `StockReserved` gibi eventler event log'a eklenir; sonra bu log replay, projection/read model üretimi, audit trail ve hata ayıklama için kullanılır. Pratik akışta komut işlenir, domain event üretilir, Event Store'a append edilir ve ilgili projection'lar bu eventlerden güncellenir."
                    .to_string(),
            );
        }
        if matches!(
            focus.intent,
            QuickAskResolvedIntent::Definition | QuickAskResolvedIntent::ExplainThis
        ) {
            return Some(
                "event logging, Event Sourcing bağlamında sistemdeki anlamlı durum değişikliklerini event olarak kaydedip bir event log içinde saklama yaklaşımıdır. Bu kayıt, daha sonra sistemi yeniden kurmak, audit yapmak ve geçmişte ne olduğunu izlemek için kullanılır."
                    .to_string(),
            );
        }
    }
    if focus
        .focus_subject
        .as_deref()
        .map(|label| label.eq_ignore_ascii_case("event"))
        .unwrap_or(false)
        && matches!(focus.intent, QuickAskResolvedIntent::Definition)
    {
        if !composed_has_focus || composed_task.contains("olarak ne demek") {
            return Some(
                "Debug failure: composed task did not normalize event question.".to_string(),
            );
        }
        return Some(
            "event, Event Sourcing bağlamında sistemde gerçekleşen ve kaydedilmesi gereken anlamlı bir durum değişikliğidir. Örneğin `OrderPlaced` veya `PaymentCaptured` gibi olaylar Event Store'a yazılır ve daha sonra sistem durumunu yeniden kurmak, audit yapmak veya projection üretmek için kullanılır."
                .to_string(),
        );
    }
    if focus
        .focus_subject
        .as_deref()
        .map(|label| label.eq_ignore_ascii_case("error tracking"))
        .unwrap_or(false)
        && focus.requested_topic.as_deref() == Some("Event Sourcing")
        && (question_lower.contains("nasıl")
            || question_lower.contains("nasil")
            || question_lower.contains("uygulan"))
    {
        if !composed_has_focus || !contains_case_insensitive(&composed_task, "Event Sourcing") {
            return Some(
                "Debug failure: composed task is missing Error Tracking or Event Sourcing."
                    .to_string(),
            );
        }
        return Some(
            "Error Tracking, Event Sourcing'de hataları da olay akışına bağlayarak yapılır: `CommandFailed`, `ErrorOccurred`, `RetryScheduled` gibi olayları correlationId, causationId, commandId, aggregateId ve timestamp ile Event Store'a yazarsınız. Sonra bu olaylardan bir Error Tracking projection/read model üretip dashboard, alarm, retry/dead-letter veya outbox süreçlerini beslersiniz. Her teknik exception domain event olmamalı; iş açısından izlenmesi gereken hata ve başarısız komutları olaylaştırmak daha sağlıklıdır."
                .to_string(),
        );
    }
    if focus
        .focus_subject
        .as_deref()
        .map(|label| label.eq_ignore_ascii_case("write side"))
        .unwrap_or(false)
        && matches!(
            focus.intent,
            QuickAskResolvedIntent::Definition | QuickAskResolvedIntent::ExplainThis
        )
    {
        if !composed_has_focus || !contains_case_insensitive(&composed_task, "Event Store") {
            return Some(
                "Debug failure: composed task is missing Write Side or Event Store.".to_string(),
            );
        }
        return Some(
            "Write Side, Event Store bağlamında komutları doğrulayan ve domain eventleri üreten yazma tarafıdır. Kullanıcı komutu önce aggregate/business rules üzerinden işlenir; geçerliyse `OrderPlaced` gibi olaylar Event Store'a append edilir. Read Side bu olaylardan projection üretir, bu yüzden Write Side'ın görevi sorgu cevabı döndürmek değil doğru olay akışını güvenli biçimde kaydetmektir."
                .to_string(),
        );
    }
    if focus
        .focus_subject
        .as_deref()
        .map(|label| label.eq_ignore_ascii_case("compaction"))
        .unwrap_or(false)
        && matches!(
            focus.intent,
            QuickAskResolvedIntent::Definition | QuickAskResolvedIntent::ExplainThis
        )
    {
        if !composed_has_focus {
            return Some("Debug failure: composed task is missing Compaction.".to_string());
        }
        return Some(
            "Compaction, Event Sourcing bağlamında uzun event log'un maliyetini azaltmak için eski olayları snapshot, özet projection veya güvenli arşivleme ile daha kompakt hale getirme yaklaşımıdır. Amaç Replay ve okuma projeksiyonlarını hızlandırırken audit gereksinimlerini bozmamaktır; bu yüzden hangi eski eventlerin budanabileceği, hangilerinin arşivde korunacağı ve snapshot'ın hangi aggregate durumunu temsil ettiği açıkça tanımlanır."
                .to_string(),
        );
    }
    if focus
        .focus_subject
        .as_deref()
        .map(|label| label.eq_ignore_ascii_case("audit trail"))
        .unwrap_or(false)
        && matches!(focus.intent, QuickAskResolvedIntent::Usage)
    {
        if !composed_has_focus {
            return Some("Debug failure: composed task is missing Audit Trail.".to_string());
        }
        return Some(
            "Audit Trail, Event Sourcing bağlamında kimin, neyi, ne zaman ve neden yaptığını olay akışı üzerinden izlemek için kullanılır. Finansal işlemler, sipariş yaşam döngüsü, güvenlik incelemeleri, uyumluluk/audit raporları, hata araştırması ve müşteri destek senaryolarında işe yarar; çünkü her karar ve değişiklik Event Store'daki olaylardan geriye doğru takip edilebilir."
                .to_string(),
        );
    }
    if focus
        .focus_subject
        .as_deref()
        .map(|label| label.eq_ignore_ascii_case("time travel"))
        .unwrap_or(false)
        && matches!(
            focus.intent,
            QuickAskResolvedIntent::Usage
                | QuickAskResolvedIntent::Definition
                | QuickAskResolvedIntent::ExplainThis
                | QuickAskResolvedIntent::HowItWorks
        )
    {
        if !composed_has_focus || !contains_case_insensitive(&composed_task, "Event Sourcing") {
            return Some(
                "Debug failure: composed task is missing Time Travel or Event Sourcing."
                    .to_string(),
            );
        }
        return Some(
            "Time Travel, Event Sourcing bağlamında Event Store'daki olayları belirli bir ana kadar Replay ederek sistemin o zamanki durumunu yeniden kurmaktır. Audit, hata araştırması, müşteri destek incelemesi, finansal mutabakat ve projection doğrulama gibi işlerde kullanılır. Snapshot stratejisi bu işlemi hızlandırabilir; ama geçmiş olayların audit değeri korunmadan silinmemelidir."
                .to_string(),
        );
    }

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

fn quick_reference_warnings(input: &QuickAskRequest) -> Vec<String> {
    input
        .active_references
        .iter()
        .filter(|reference| {
            !reference.label.trim().is_empty()
                && reference
                    .target_id
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
                && reference
                    .target_uri
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
                && reference
                    .preview
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
                && reference
                    .selected_text
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
        })
        .map(|_| "reference_context_unresolved".to_string())
        .collect()
}

fn resolve_quick_ask_focus(input: &QuickAskRequest) -> QuickAskFocus {
    let selected = input.selected_text.as_deref().unwrap_or("").trim();
    let primary_reference = input
        .active_references
        .iter()
        .find(|reference| !reference.label.trim().is_empty());
    let primary_reference_label = primary_reference.map(|reference| reference.label.trim());
    let requested_topic = requested_topic_from_question(&input.question)
        .map(ToString::to_string)
        .or_else(|| {
            background_topic_from_source(input.source_context.as_ref()).map(ToString::to_string)
        });
    let question_lower = input.question.to_lowercase();
    let is_meaning_question = asks_for_meaning_or_definition(&question_lower, &input.question);
    let is_previous_answer_term_meaning_question =
        is_meaning_question || question_lower.split_whitespace().any(|word| word == "ne");
    let is_short_subjectless = is_short_subjectless_question(&question_lower, &input.question);
    let mentions_implementation = mentions_implementation(&question_lower, &input.question);
    let mentions_relation = mentions_relation(&question_lower, &input.question);
    let asks_usage = asks_usage(&question_lower, &input.question);
    let mentions_topic = requested_topic_from_question(&input.question).is_some();
    let is_translation = matches!(input.intent, QuickAskIntent::Translation);
    let selected_is_acronym = is_acronym_like(selected);
    let previous_answer_subject = previous_answer_focus_from_question(input)
        .or_else(|| previous_answer_seed_focus_for_follow_up(input));

    let (original_focus_subject, focus_subject_source) =
        if let Some(previous_answer_subject) = previous_answer_subject {
            (
                Some(previous_answer_subject),
                QuickAskFocusSubjectSource::PreviousAssistantAnswer,
            )
        } else if !selected.is_empty()
            && (is_meaning_question
                || is_translation
                || selected_is_acronym
                || is_short_subjectless
                || asks_usage)
        {
            (
                Some(selected.to_string()),
                QuickAskFocusSubjectSource::SelectedFragment,
            )
        } else if let Some(label) = primary_reference_label {
            let question_mentions_reference = question_lower.contains(&label.to_lowercase());
            if is_short_subjectless
                || question_mentions_reference
                || mentions_implementation
                || mentions_relation
                || asks_usage
            {
                (
                    Some(label.to_string()),
                    QuickAskFocusSubjectSource::ActiveReference,
                )
            } else {
                (None, QuickAskFocusSubjectSource::Unknown)
            }
        } else if let Some(source) = input
            .source_context
            .as_ref()
            .and_then(|source| source.title.as_deref())
        {
            if is_meaning_question || is_short_subjectless {
                (
                    Some(source.trim().to_string()),
                    QuickAskFocusSubjectSource::SourceResponse,
                )
            } else {
                (None, QuickAskFocusSubjectSource::Unknown)
            }
        } else {
            (None, QuickAskFocusSubjectSource::Unknown)
        };
    let focus_subject = original_focus_subject
        .as_deref()
        .and_then(normalize_quick_focus_label);

    let intent = if matches!(
        &focus_subject_source,
        QuickAskFocusSubjectSource::PreviousAssistantAnswer
    ) && asks_usage
    {
        QuickAskResolvedIntent::Usage
    } else if matches!(
        &focus_subject_source,
        QuickAskFocusSubjectSource::PreviousAssistantAnswer
    ) && is_previous_answer_term_meaning_question
    {
        QuickAskResolvedIntent::Definition
    } else if is_translation {
        QuickAskResolvedIntent::Translation
    } else if selected_is_acronym && is_meaning_question {
        QuickAskResolvedIntent::AcronymExpansion
    } else if focus_subject.is_some()
        && mentions_implementation
        && (mentions_topic || requested_topic.is_some())
    {
        QuickAskResolvedIntent::ImplementationInTopic
    } else if focus_subject.is_some() && mentions_relation {
        QuickAskResolvedIntent::RelationToReference
    } else if focus_subject.is_some() && asks_usage {
        QuickAskResolvedIntent::Usage
    } else if is_meaning_question {
        QuickAskResolvedIntent::Definition
    } else if question_lower.contains("açıkla")
        || question_lower.contains("acikla")
        || question_lower.contains("anlat")
        || input.question.to_lowercase().contains("explain")
    {
        QuickAskResolvedIntent::ExplainThis
    } else if question_lower.contains("nasıl")
        || question_lower.contains("nasil")
        || input.question.to_lowercase().contains("how")
    {
        QuickAskResolvedIntent::HowItWorks
    } else {
        QuickAskResolvedIntent::Unknown
    };

    let mut warnings = Vec::new();
    if primary_reference_label.is_some()
        && focus_subject.is_none()
        && (is_short_subjectless || is_meaning_question)
    {
        warnings.push("active_reference_focus_unresolved".to_string());
    }

    QuickAskFocus {
        original_focus_subject,
        focus_subject,
        focus_subject_source,
        intent,
        requested_topic,
        warnings,
    }
}

fn quick_diagnostics(
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
    answer: &str,
    answer_validation: Option<QuickAskAnswerValidation>,
) -> QuickAskDiagnostics {
    let prompt = quick_user_prompt(input);
    let active_reference_labels = active_reference_labels(input);
    let seed_context_labels = seed_context_labels(input);
    let composed_task = quick_composed_task(input, focus);
    let answer_validation =
        answer_validation.unwrap_or_else(|| quick_answer_validation(answer, focus, input));
    let seed_context_mode = quick_seed_context_mode(input, focus, &seed_context_labels);
    QuickAskDiagnostics {
        trace_id: input.quick_ask_trace_id.clone(),
        selected_text: input
            .selected_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        source_response_id: input.source_response_id.clone(),
        source_loom_id: input.source_loom_id.clone(),
        input_active_reference_labels: active_reference_labels.clone(),
        service_active_reference_labels: active_reference_labels.clone(),
        active_reference_labels: active_reference_labels.clone(),
        previous_ask_turn_count: input.turns.len(),
        turn_index: input.turns.len() + 1,
        original_focus_subject: focus.original_focus_subject.clone(),
        normalized_focus_subject: focus.focus_subject.clone(),
        focus_subject: focus.focus_subject.clone(),
        focus_subject_source: focus.focus_subject_source.as_str().to_string(),
        previous_answer_term_matched: matches!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::PreviousAssistantAnswer
        )
        .then(|| focus.focus_subject.clone())
        .flatten(),
        active_chip_used_as_primary: matches!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::SelectedFragment
                | QuickAskFocusSubjectSource::ActiveReference
        ),
        active_chip_used_as_background: matches!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::PreviousAssistantAnswer
        ) && (!input.active_references.is_empty()
            || input
                .selected_text
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty())),
        seed_context_labels,
        seed_context_mode: seed_context_mode.to_string(),
        current_turn_primary_context: quick_current_turn_primary_context(input, focus).to_string(),
        follow_up_intent: quick_follow_up_intent(input, focus).map(ToString::to_string),
        resolved_intent: focus.intent.as_str().to_string(),
        requested_topic: focus.requested_topic.clone(),
        composed_task: composed_task.clone(),
        normalized_composed_question: composed_task.clone(),
        language: infer_quick_answer_language(&input.question).map(ToString::to_string),
        language_contamination_detected: answer_validation.language_contamination_detected,
        stale_chip_override_detected: answer_validation.stale_chip_override_detected,
        prompt_section_order: quick_prompt_section_order(&prompt),
        provider_request_summary: quick_provider_request_summary(
            input,
            focus,
            &prompt,
            active_reference_labels,
            composed_task.as_deref(),
        ),
        answer_validation,
        warnings: focus
            .warnings
            .iter()
            .cloned()
            .chain(quick_reference_warnings(input))
            .collect(),
    }
}

fn active_reference_labels(input: &QuickAskRequest) -> Vec<String> {
    input
        .active_references
        .iter()
        .filter_map(|reference| {
            let label = reference.label.trim();
            (!label.is_empty()).then(|| label.to_string())
        })
        .collect()
}

fn seed_context_labels(input: &QuickAskRequest) -> Vec<String> {
    std::iter::once(input.selected_text.as_deref())
        .chain(
            input
                .active_references
                .iter()
                .map(|reference| Some(reference.label.as_str())),
        )
        .flatten()
        .filter_map(normalize_quick_focus_label)
        .fold(Vec::<String>::new(), |mut labels, label| {
            if !labels
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&label))
            {
                labels.push(label);
            }
            labels
        })
}

fn previous_answer_focus_from_question(input: &QuickAskRequest) -> Option<String> {
    let latest_answer = input.turns.iter().rev().find_map(|turn| {
        let answer = turn.answer.trim();
        (!answer.is_empty()).then_some(answer)
    })?;
    let answer_lower = latest_answer.to_lowercase();
    current_question_terms(&input.question)
        .into_iter()
        .find(|term| {
            let term_lower = term.to_lowercase();
            term_lower.chars().count() >= 3 && answer_lower.contains(&term_lower)
        })
}

fn previous_answer_seed_focus_for_follow_up(input: &QuickAskRequest) -> Option<String> {
    if input.turns.is_empty() {
        return None;
    }
    let question_lower = input.question.to_lowercase();
    let is_follow_up = asks_usage(&question_lower, &input.question)
        || asks_for_meaning_or_definition(&question_lower, &input.question)
        || question_lower.contains("aç")
        || question_lower.contains("ac")
        || question_lower.contains("anlat")
        || question_lower.contains("örnek")
        || question_lower.contains("ornek")
        || input.question.to_lowercase().contains("explain")
        || input.question.to_lowercase().contains("example");
    if !is_follow_up {
        return None;
    }
    let latest_answer = input.turns.iter().rev().find_map(|turn| {
        let answer = turn.answer.trim();
        (!answer.is_empty()).then_some(answer)
    })?;
    let latest_answer_lower = latest_answer.to_lowercase();
    seed_context_labels(input)
        .into_iter()
        .find(|label| latest_answer_lower.contains(&label.to_lowercase()))
}

fn quick_seed_context_mode(
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
    labels: &[String],
) -> &'static str {
    if labels.is_empty() {
        return "none";
    }
    if input.turns.is_empty()
        && matches!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::SelectedFragment
                | QuickAskFocusSubjectSource::ActiveReference
        )
    {
        "primary"
    } else {
        "background"
    }
}

fn quick_current_turn_primary_context(
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
) -> &'static str {
    if input.turns.is_empty() {
        return match focus.focus_subject_source {
            QuickAskFocusSubjectSource::SelectedFragment => "selected_fragment",
            QuickAskFocusSubjectSource::ActiveReference => "active_chip",
            QuickAskFocusSubjectSource::SourceResponse => "source_context",
            _ => "current_question",
        };
    }
    match focus.focus_subject_source {
        QuickAskFocusSubjectSource::PreviousAssistantAnswer => "previous_answer + current_question",
        QuickAskFocusSubjectSource::SelectedFragment
        | QuickAskFocusSubjectSource::ActiveReference => "current_question + seed_context",
        _ => "previous_answer + current_question",
    }
}

fn quick_follow_up_intent(input: &QuickAskRequest, focus: &QuickAskFocus) -> Option<&'static str> {
    if input.turns.is_empty() {
        return None;
    }
    let question_lower = input.question.to_lowercase();
    if asks_usage(&question_lower, &input.question) {
        Some("usage")
    } else if asks_for_meaning_or_definition(&question_lower, &input.question) {
        Some("definition")
    } else if mentions_implementation(&question_lower, &input.question) {
        Some("implementation")
    } else if matches!(focus.intent, QuickAskResolvedIntent::ExplainThis) {
        Some("explain")
    } else {
        Some("follow_up")
    }
}

fn current_question_terms(question: &str) -> Vec<String> {
    let quoted_terms = quoted_terms(question);
    let token_terms = question
        .split(|ch: char| {
            ch.is_whitespace()
                || matches!(
                    ch,
                    '?' | '!' | '.' | ',' | ':' | ';' | '(' | ')' | '[' | ']' | '{' | '}'
                )
        })
        .filter_map(normalize_quick_focus_label)
        .filter(|term| {
            let lower = term.to_lowercase();
            !quick_question_stopword(&lower)
        });
    quoted_terms
        .into_iter()
        .chain(token_terms)
        .fold(Vec::<String>::new(), |mut terms, term| {
            if !terms
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&term))
            {
                terms.push(term);
            }
            terms
        })
}

fn quoted_terms(question: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut buffer = String::new();
    let mut quote: Option<char> = None;
    for ch in question.chars() {
        if matches!(ch, '"' | '\'' | '“' | '”' | '‘' | '’' | '`') {
            if quote.is_some() {
                if let Some(term) = normalize_quick_focus_label(&buffer) {
                    terms.push(term);
                }
                buffer.clear();
                quote = None;
            } else {
                quote = Some(ch);
            }
        } else if quote.is_some() {
            buffer.push(ch);
        }
    }
    terms
}

fn quick_question_stopword(value: &str) -> bool {
    matches!(
        value,
        "ne" | "be"
            | "bu"
            | "bunu"
            | "bunun"
            | "şu"
            | "su"
            | "şunu"
            | "sunu"
            | "demek"
            | "nedir"
            | "anlama"
            | "anlamı"
            | "anlami"
            | "geliyor"
            | "nasıl"
            | "nasil"
            | "kullanılıyor"
            | "kullaniliyor"
            | "kullanılır"
            | "kullanilir"
            | "biraz"
            | "daha"
            | "anlat"
            | "aç"
            | "ac"
            | "örnek"
            | "ornek"
            | "ver"
            | "what"
            | "does"
            | "this"
            | "that"
            | "mean"
            | "explain"
            | "give"
            | "example"
            | "the"
            | "a"
            | "an"
            | "is"
            | "it"
    )
}

fn normalize_quick_focus_label(value: &str) -> Option<String> {
    let mut normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized = normalized
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '“' | '”' | '‘' | '’'))
        .trim()
        .to_string();

    loop {
        let before = normalized.clone();
        normalized = normalized.trim().to_string();
        if normalized.starts_with('(')
            && normalized.ends_with(')')
            && balanced_outer_parens(&normalized)
        {
            normalized = normalized[1..normalized.len().saturating_sub(1)]
                .trim()
                .to_string();
        }
        if normalized.starts_with('(') && !normalized[1..].contains(')') {
            normalized = normalized[1..].trim().to_string();
        }
        if normalized.ends_with(')')
            && !normalized[..normalized.len().saturating_sub(1)].contains('(')
        {
            normalized.pop();
            normalized = normalized.trim().to_string();
        }
        normalized = normalized
            .trim_end_matches(|ch| {
                matches!(ch, ':' | ';' | ',' | '.' | '!' | '?' | '-' | '–' | '—')
            })
            .trim()
            .to_string();
        normalized = normalized
            .trim_matches(|ch| matches!(ch, '"' | '\'' | '`' | '“' | '”' | '‘' | '’'))
            .trim()
            .to_string();
        if normalized == before {
            break;
        }
    }

    (!normalized.is_empty()).then_some(normalized)
}

fn balanced_outer_parens(value: &str) -> bool {
    let mut depth = 0_i32;
    for (index, ch) in value.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 && index < value.len().saturating_sub(1) {
                    return false;
                }
                if depth < 0 {
                    return false;
                }
            }
            _ => {}
        }
    }
    depth == 0
}

fn quick_composed_task(input: &QuickAskRequest, focus: &QuickAskFocus) -> Option<String> {
    let subject = focus.focus_subject.as_deref()?.trim();
    if subject.is_empty() {
        return None;
    }
    let topic = focus
        .requested_topic
        .as_deref()
        .or_else(|| background_topic_from_source(input.source_context.as_ref()))
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let prefix = topic
        .map(|topic| format!("{topic} bağlamında "))
        .unwrap_or_default();
    let question_lower = input.question.to_lowercase();
    let task = match focus.intent {
        _ if matches!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::PreviousAssistantAnswer
        ) && asks_usage(&question_lower, &input.question) =>
        {
            if let Some(topic) = topic {
                format!(
                    "Önceki yanıtta açıklanan \"{subject}\" teriminin {topic} bağlamında nasıl kullanıldığını açıkla."
                )
            } else {
                format!(
                    "Önceki yanıtta açıklanan \"{subject}\" teriminin nasıl kullanıldığını açıkla."
                )
            }
        }
        _ if matches!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::PreviousAssistantAnswer
        ) && (asks_for_meaning_or_definition(&question_lower, &input.question)
            || question_lower.split_whitespace().any(|word| word == "ne")) =>
        {
            format!("Önceki yanıtta geçen \"{subject}\" ne anlama gelir?")
        }
        QuickAskResolvedIntent::Usage => {
            if asks_for_meaning_or_definition(&question_lower, &input.question) {
                format!("{prefix}{subject} ne anlama gelir ve nasıl kullanılır?")
            } else {
                format!("{prefix}{subject} hangi işlerde kullanılır?")
            }
        }
        QuickAskResolvedIntent::ImplementationInTopic => {
            format!("{prefix}{subject} nasıl yapılır?")
        }
        QuickAskResolvedIntent::Definition
            if question_lower.contains("anlama")
                || question_lower.contains("nedir")
                || question_lower.contains("ne demek") =>
        {
            format!("{prefix}{subject} ne anlama gelir?")
        }
        QuickAskResolvedIntent::ExplainThis => {
            format!("{prefix}{subject} açıkla.")
        }
        QuickAskResolvedIntent::RelationToReference => {
            format!("{prefix}{subject} ile ilişkiyi açıkla.")
        }
        QuickAskResolvedIntent::HowItWorks => {
            format!("{prefix}{subject} nasıl çalışır?")
        }
        _ => {
            let question = input.question.trim().trim_end_matches('?');
            if question.is_empty() {
                format!("{prefix}{subject} hakkında yanıt ver.")
            } else if question.to_lowercase().contains(&subject.to_lowercase()) {
                format!("{prefix}{question}?")
            } else {
                format!("{prefix}{subject}: {question}?")
            }
        }
    };
    Some(task)
}

fn quick_answer_validation(
    answer: &str,
    focus: &QuickAskFocus,
    input: &QuickAskRequest,
) -> QuickAskAnswerValidation {
    let includes_focus_subject = focus
        .focus_subject
        .as_deref()
        .map(|subject| contains_case_insensitive(answer, subject))
        .unwrap_or(true);
    let requested_topic_required = !matches!(
        focus.intent,
        QuickAskResolvedIntent::AcronymExpansion | QuickAskResolvedIntent::Translation
    ) && !matches!(
        focus.focus_subject_source,
        QuickAskFocusSubjectSource::PreviousAssistantAnswer
    );
    let includes_requested_topic = if requested_topic_required {
        focus
            .requested_topic
            .as_deref()
            .map(|topic| answer_mentions_requested_topic(answer, topic))
            .unwrap_or(true)
    } else {
        true
    };
    let generic_source_only_detected =
        focus.focus_subject.is_some() && !includes_focus_subject && includes_requested_topic;
    let starts_with_focus_subject_or_definition = focus
        .focus_subject
        .as_deref()
        .map(|subject| starts_with_focus_or_definition(answer, subject))
        .unwrap_or(true);
    let language_contamination_detected =
        quick_language_contamination_detected(answer, input, focus);
    let stale_chip_override_detected = quick_stale_chip_override_detected(answer, input, focus);
    let follows_up_on_previous_turn = !input.turns.is_empty();
    let repeats_previous_answer = quick_repeats_previous_answer(answer, input);
    let answer_adds_new_information = quick_answer_adds_new_information(answer, input, focus);
    let seed_chip_rendered_as_current_turn = false;
    let mut failure_reasons = Vec::new();
    if focus.focus_subject.is_some() && !includes_focus_subject {
        failure_reasons.push("validation_missing_focus".to_string());
    }
    if !includes_requested_topic {
        failure_reasons.push("validation_missing_requested_topic".to_string());
    }
    if generic_source_only_detected {
        failure_reasons.push("provider_ignored_focus".to_string());
    }
    if focus.focus_subject.is_some() && !starts_with_focus_subject_or_definition {
        failure_reasons.push("answer_does_not_start_with_focus".to_string());
    }
    if language_contamination_detected {
        failure_reasons.push("language_contamination_detected".to_string());
    }
    if stale_chip_override_detected {
        failure_reasons.push("stale_chip_override_detected".to_string());
    }
    if repeats_previous_answer {
        failure_reasons.push("repeats_previous_answer".to_string());
    }
    if follows_up_on_previous_turn && !answer_adds_new_information {
        failure_reasons.push("answer_does_not_add_new_information".to_string());
    }
    let validation_passed = includes_focus_subject
        && includes_requested_topic
        && !generic_source_only_detected
        && starts_with_focus_subject_or_definition
        && !language_contamination_detected
        && !stale_chip_override_detected
        && !repeats_previous_answer
        && answer_adds_new_information;
    QuickAskAnswerValidation {
        includes_focus_subject,
        includes_requested_topic,
        generic_source_only_detected,
        starts_with_focus_subject_or_definition,
        language_contamination_detected,
        stale_chip_override_detected,
        repeats_previous_answer,
        follows_up_on_previous_turn,
        seed_chip_rendered_as_current_turn,
        answer_adds_new_information,
        validation_passed,
        failure_reasons,
        validation_failed_first_attempt: false,
        retry_attempted: false,
        retry_succeeded: false,
        final_answer_source: "first_attempt".to_string(),
    }
}

impl QuickAskAnswerValidation {
    fn with_attempt_metadata(
        mut self,
        validation_failed_first_attempt: bool,
        retry_attempted: bool,
        retry_succeeded: bool,
        final_answer_source: &str,
    ) -> Self {
        self.validation_failed_first_attempt = validation_failed_first_attempt;
        self.retry_attempted = retry_attempted;
        self.retry_succeeded = retry_succeeded;
        self.final_answer_source = final_answer_source.to_string();
        self
    }
}

fn quick_answer_contract_required(focus: &QuickAskFocus) -> bool {
    matches!(
        focus.focus_subject_source,
        QuickAskFocusSubjectSource::SelectedFragment
            | QuickAskFocusSubjectSource::ActiveReference
            | QuickAskFocusSubjectSource::PreviousAssistantAnswer
    ) && focus.focus_subject.is_some()
}

fn starts_with_focus_or_definition(answer: &str, subject: &str) -> bool {
    let trimmed = answer.trim_start();
    let lower = trimmed.to_lowercase();
    let subject_lower = subject.to_lowercase();
    lower.starts_with(&subject_lower)
        || lower.starts_with(&format!("{subject_lower},"))
        || lower.starts_with(&format!("{subject_lower} "))
        || lower.starts_with(&format!("**{subject_lower}"))
        || lower.contains(&format!("{subject_lower},"))
        || lower.contains(&format!("{subject_lower} "))
}

fn answer_mentions_requested_topic(answer: &str, topic: &str) -> bool {
    if contains_case_insensitive(answer, topic) {
        return true;
    }
    let answer_lower = answer.to_lowercase();
    match topic.to_lowercase().as_str() {
        "plugin context" => answer_lower.contains("plugin") || answer_lower.contains("context"),
        _ => false,
    }
}

fn quick_language_contamination_detected(
    answer: &str,
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
) -> bool {
    if infer_quick_answer_language(&input.question) != Some("tr") {
        return false;
    }
    if answer.chars().any(|ch| {
        ('\u{0600}'..='\u{06FF}').contains(&ch) || ('\u{0400}'..='\u{04FF}').contains(&ch)
    }) {
        return true;
    }
    let answer_lower = answer.to_lowercase();
    for foreign in ["itselfe", "بلکه"] {
        if answer_lower.contains(foreign) {
            return true;
        }
    }
    for foreign in ["resultado", "separate", "place"] {
        if answer_contains_unexpected_foreign_term(&answer_lower, foreign, input, focus) {
            return true;
        }
    }
    false
}

fn answer_contains_unexpected_foreign_term(
    answer_lower: &str,
    term: &str,
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
) -> bool {
    if !answer_lower
        .split(|ch: char| !ch.is_alphanumeric())
        .any(|token| token == term)
    {
        return false;
    }
    if input.question.to_lowercase().contains(term) {
        return false;
    }
    if focus
        .focus_subject
        .as_deref()
        .map(|subject| subject.to_lowercase().contains(term))
        .unwrap_or(false)
    {
        return false;
    }
    true
}

fn quick_stale_chip_override_detected(
    answer: &str,
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
) -> bool {
    if !matches!(
        focus.focus_subject_source,
        QuickAskFocusSubjectSource::PreviousAssistantAnswer
    ) {
        return false;
    }
    let answer_start = answer.chars().take(160).collect::<String>();
    let stale_labels = std::iter::once(input.selected_text.as_deref())
        .chain(
            input
                .active_references
                .iter()
                .map(|reference| Some(reference.label.as_str())),
        )
        .flatten()
        .filter_map(normalize_quick_focus_label)
        .filter(|label| {
            focus
                .focus_subject
                .as_deref()
                .map(|subject| !label.eq_ignore_ascii_case(subject))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    stale_labels.iter().any(|label| {
        starts_with_case_insensitive(&answer_start, label)
            || (!focus
                .focus_subject
                .as_deref()
                .map(|subject| contains_case_insensitive(answer, subject))
                .unwrap_or(true)
                && contains_case_insensitive(&answer_start, label))
    })
}

fn quick_repeats_previous_answer(answer: &str, input: &QuickAskRequest) -> bool {
    let Some(previous_answer) = latest_previous_answer(input) else {
        return false;
    };
    let answer_norm = compact(answer, 1_200).to_lowercase();
    let previous_norm = compact(previous_answer, 1_200).to_lowercase();
    if answer_norm.is_empty() || previous_norm.is_empty() {
        return false;
    }
    let answer_first = answer_norm.split('.').next().unwrap_or("").trim();
    let previous_first = previous_norm.split('.').next().unwrap_or("").trim();
    if answer_first.chars().count() >= 48 && answer_first == previous_first {
        return true;
    }
    let answer_terms = significant_answer_terms(&answer_norm);
    let previous_terms = significant_answer_terms(&previous_norm);
    if answer_terms.len() < 8 || previous_terms.len() < 8 {
        return false;
    }
    let shared = answer_terms
        .iter()
        .filter(|term| previous_terms.contains(*term))
        .count();
    let smaller = answer_terms.len().min(previous_terms.len());
    shared * 100 / smaller >= 82
}

fn quick_answer_adds_new_information(
    answer: &str,
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
) -> bool {
    if input.turns.is_empty() {
        return true;
    }
    if quick_repeats_previous_answer(answer, input) {
        return false;
    }
    let question_lower = input.question.to_lowercase();
    if asks_usage(&question_lower, &input.question) {
        let answer_lower = answer.to_lowercase();
        return [
            "event store",
            "event log",
            "append",
            "replay",
            "projection",
            "audit",
            "debug",
            "örnek",
            "ornek",
            "ordercreated",
            "paymentfailed",
            "stockreserved",
            "akış",
            "akis",
            "uygula",
            "pratik",
            "senaryo",
            "read model",
        ]
        .iter()
        .any(|term| answer_lower.contains(term));
    }
    focus.focus_subject.is_none()
        || focus
            .focus_subject
            .as_deref()
            .map(|subject| contains_case_insensitive(answer, subject))
            .unwrap_or(true)
}

fn latest_previous_answer(input: &QuickAskRequest) -> Option<&str> {
    input.turns.iter().rev().find_map(|turn| {
        let answer = turn.answer.trim();
        (!answer.is_empty()).then_some(answer)
    })
}

fn significant_answer_terms(value: &str) -> std::collections::BTreeSet<String> {
    value
        .split(|ch: char| !ch.is_alphanumeric())
        .filter_map(|token| {
            let token = token.trim().to_lowercase();
            (token.chars().count() >= 4 && !quick_repetition_stopword(&token)).then_some(token)
        })
        .collect()
}

fn quick_repetition_stopword(value: &str) -> bool {
    matches!(
        value,
        "olarak"
            | "bağlamında"
            | "baglaminda"
            | "kullanılır"
            | "kullanilir"
            | "kullanılıyor"
            | "kullaniliyor"
            | "sistemde"
            | "sistem"
            | "şekilde"
            | "sekilde"
            | "event"
            | "sourcing"
            | "için"
            | "icin"
            | "olan"
            | "bunu"
            | "daha"
            | "answer"
            | "with"
            | "that"
            | "this"
    )
}

fn infer_quick_answer_language(question: &str) -> Option<&'static str> {
    let lower = question.to_lowercase();
    if lower.contains('ı')
        || lower.contains('ğ')
        || lower.contains('ş')
        || lower.contains('ç')
        || lower.contains('ö')
        || lower.contains('ü')
        || lower.split_whitespace().any(|word| {
            matches!(
                word.trim_matches(|ch: char| !ch.is_alphanumeric()),
                "ne" | "bu"
                    | "bunu"
                    | "demek"
                    | "nedir"
                    | "nasıl"
                    | "nasil"
                    | "kullanılır"
                    | "kullanilir"
                    | "anlat"
                    | "örnek"
                    | "ornek"
            )
        })
    {
        return Some("tr");
    }
    None
}

fn contains_case_insensitive(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

fn quick_prompt_section_order(prompt: &str) -> Vec<String> {
    [
        ("Task focus", "current_task"),
        ("Clean composed user question:", "composed_task"),
        ("Answer focus:", "focus_subject"),
        ("Active reference/context chips:", "active_references"),
        ("Selected fragment:", "selected_fragment"),
        ("Previous temporary Ask turns:", "previous_ask_turns"),
        ("Background source context.", "background_source_context"),
        ("Current question:", "current_question"),
        ("Answer style:", "answer_style"),
    ]
    .into_iter()
    .filter_map(|(needle, label)| prompt.find(needle).map(|index| (index, label.to_string())))
    .collect::<std::collections::BTreeMap<_, _>>()
    .into_values()
    .collect()
}

fn quick_provider_request_summary(
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
    prompt: &str,
    active_reference_labels: Vec<String>,
    composed_task: Option<&str>,
) -> QuickAskProviderRequestSummary {
    let focus_subject = focus.focus_subject.clone();
    let contains_focus_subject = focus_subject
        .as_deref()
        .map(|subject| prompt.contains(subject))
        .unwrap_or(false);
    let focus_index = prompt.find("Answer focus:");
    let source_index = prompt.find("Background source context.");
    QuickAskProviderRequestSummary {
        message_count: quick_messages(input).len(),
        focus_subject,
        active_reference_labels,
        selected_text: input
            .selected_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        requested_topic: focus.requested_topic.clone(),
        composed_task_preview: composed_task.map(|value| compact(value, 260)),
        contains_focus_subject,
        focus_subject_before_source: match (focus_index, source_index) {
            (Some(focus_index), Some(source_index)) => focus_index < source_index,
            (Some(_), None) => true,
            _ => false,
        },
        active_reference_count: input.active_references.len(),
        previous_turn_count: input.turns.len(),
        selected_fragment_present: input
            .selected_text
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty()),
        source_context_present: input.source_context.is_some(),
    }
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

fn quick_repair_ollama_request(
    input: &QuickAskRequest,
    focus: &QuickAskFocus,
    previous_answer: &str,
    model: String,
    request_id: String,
) -> OllamaChatRequest {
    let subject = focus
        .focus_subject
        .as_deref()
        .unwrap_or("the focus subject");
    let topic = focus
        .requested_topic
        .as_deref()
        .or_else(|| background_topic_from_source(input.source_context.as_ref()))
        .unwrap_or("the background topic");
    let composed_task = quick_composed_task(input, focus)
        .unwrap_or_else(|| format!("{topic} bağlamında {subject} hakkında yanıt ver."));
    let repair_prompt = [
        "The previous answer ignored the focus subject.".to_string(),
        "Rewrite the answer.".to_string(),
        format!("It must be about {subject} in the context of {topic}."),
        format!("Start with {subject}."),
        format!("Use this clean user-facing task: {composed_task}"),
        "Do not answer only about the background topic.".to_string(),
        if input.turns.is_empty() {
            String::new()
        } else {
            "This is a follow-up turn. Do not repeat the previous Quick Ask answer; answer only the new question and add new usage/examples/implementation details when asked.".to_string()
        },
        if infer_quick_answer_language(&input.question) == Some("tr") {
            "Answer in Turkish. English technical terms are allowed, but avoid unrelated foreign-language filler or non-Latin scripts.".to_string()
        } else {
            String::new()
        },
        format!(
            "Previous answer to repair:\n{}",
            compact(previous_answer, 900)
        ),
        "Original Quick Ask request follows for background only:".to_string(),
        quick_user_prompt(input),
    ]
    .join("\n\n");
    OllamaChatRequest {
        model,
        messages: vec![
            OllamaMessage {
                role: "system".to_string(),
                content: quick_system_prompt(),
            },
            OllamaMessage {
                role: "user".to_string(),
                content: repair_prompt,
            },
        ],
        stream: Some(false),
        think: Some(false),
        options: Some(OllamaOptions {
            num_ctx: Some(MAX_QUICK_NUM_CTX),
            num_predict: Some(MAX_QUICK_NUM_PREDICT),
            temperature: Some(0.1),
        }),
        request_id: Some(request_id),
    }
}

fn clean_quick_visible_answer(answer: &str, focus: &QuickAskFocus) -> String {
    let mut cleaned = answer.trim_start().to_string();
    for prefix in [
        "focus subject:",
        "answer focus:",
        "current task:",
        "composed task:",
        "answer requirements:",
    ] {
        if starts_with_case_insensitive(&cleaned, prefix) {
            cleaned = cleaned[prefix.len()..].trim_start().to_string();
        }
    }

    let Some(normalized_subject) = focus.focus_subject.as_deref() else {
        return cleaned;
    };
    let original_subject = focus
        .original_focus_subject
        .as_deref()
        .unwrap_or(normalized_subject);
    if original_subject != normalized_subject
        && starts_with_case_insensitive(&cleaned, original_subject)
    {
        let rest = cleaned[original_subject.len()..].trim_start();
        cleaned = format!("{normalized_subject}{rest}");
    }
    if starts_with_case_insensitive(&cleaned, normalized_subject) {
        let rest = cleaned[normalized_subject.len()..].trim_start();
        if starts_with_case_insensitive(rest, original_subject) {
            let rest = rest[original_subject.len()..].trim_start();
            cleaned = format!("{normalized_subject} {rest}").trim().to_string();
        } else if starts_with_case_insensitive(rest, normalized_subject) {
            let rest = rest[normalized_subject.len()..].trim_start();
            cleaned = format!("{normalized_subject} {rest}").trim().to_string();
        }
    }
    cleaned
}

fn starts_with_case_insensitive(value: &str, prefix: &str) -> bool {
    value
        .get(..prefix.len())
        .map(|head| head.eq_ignore_ascii_case(prefix))
        .unwrap_or(false)
}

fn quick_system_prompt() -> String {
    [
        "Answer as Loom Quick Ask.",
        "Use instant, concise behavior. Do not use thinking or deep synthesis.",
        "Use the selected fragment as primary context when present.",
        "Use source context and previous temporary Ask turns only as background.",
        "For translation requests, translate only the selected fragment unless the user explicitly asks for more.",
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
    let focus = resolve_quick_ask_focus(input);
    let selected_for_prompt = if matches!(
        focus.focus_subject_source,
        QuickAskFocusSubjectSource::SelectedFragment
    ) {
        focus.focus_subject.as_deref().unwrap_or(selected)
    } else {
        selected
    };
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
    let active_reference_context = active_reference_prompt(input);
    let focus_prompt = quick_focus_prompt(&focus, input);
    let focus_details = quick_focus_details_prompt(&focus, input);
    let composed_task = quick_composed_task(input, &focus)
        .map(|task| format!("Clean composed user question:\n{}", compact(&task, 700)))
        .unwrap_or_default();
    let current_question = format!("Current question:\n{}", compact(&input.question, 700));
    let previous_turns_block = if previous_turns.is_empty() {
        String::new()
    } else {
        format!("Previous temporary Ask turns:\n{previous_turns}")
    };
    let selected_fragment_block = if selected_for_prompt.is_empty() {
        String::new()
    } else {
        format!(
            "Selected fragment:\n\"{}\"",
            compact(selected_for_prompt, 1_800)
        )
    };
    let background_source_block = if source_context.is_empty() {
        String::new()
    } else {
        format!("Background source context. Use only if needed:\n{source_context}")
    };
    let mut parts = vec![
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
        focus_prompt,
        composed_task,
        current_question,
        focus_details,
    ];
    if matches!(
        focus.focus_subject_source,
        QuickAskFocusSubjectSource::PreviousAssistantAnswer
    ) {
        parts.extend([
            previous_turns_block,
            if active_reference_context.is_empty() {
                String::new()
            } else {
                format!("{active_reference_context}\nDecay rule: this old selected chip is background unless the current question explicitly asks about it.")
            },
            selected_fragment_block,
        ]);
    } else {
        parts.extend([
            if active_reference_context.is_empty() {
                String::new()
            } else {
                active_reference_context
            },
            selected_fragment_block,
            previous_turns_block,
        ]);
    }
    parts.extend([
        background_source_block,
        "Answer style: answer directly; be concise but useful; do not force a one-sentence answer; use a short paragraph or bullets if clearer; do not write a long essay.".to_string(),
        acronym_instruction(input),
        translation_instruction(input),
    ]);
    parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn quick_focus_prompt(focus: &QuickAskFocus, _input: &QuickAskRequest) -> String {
    if focus.focus_subject.is_none() {
        return String::new();
    }
    let task = match focus.focus_subject_source {
        QuickAskFocusSubjectSource::SelectedFragment => {
            "Answer the user's question about the selected fragment."
        }
        QuickAskFocusSubjectSource::ActiveReference => {
            "Answer the user's question about the active context chip."
        }
        QuickAskFocusSubjectSource::SourceResponse => {
            "Answer the user's question about the source response."
        }
        QuickAskFocusSubjectSource::CurrentQuestion => "Answer the current user question directly.",
        QuickAskFocusSubjectSource::PreviousTurn => {
            "Use previous Quick Ask turns only as background continuity."
        }
        QuickAskFocusSubjectSource::PreviousAssistantAnswer => {
            "Answer the user's latest follow-up about the previous Quick Ask answer."
        }
        QuickAskFocusSubjectSource::Unknown => "Answer the current user question directly.",
    };
    [
        "Task focus".to_string(),
        "Focus contract".to_string(),
        task.to_string(),
        "Your answer must be about the named subject below. Start naturally with that subject. Use the background topic only as context. Do not answer only about the background topic.".to_string(),
    ]
    .join("\n")
}

fn quick_focus_details_prompt(focus: &QuickAskFocus, input: &QuickAskRequest) -> String {
    let Some(subject) = focus.focus_subject.as_deref() else {
        return String::new();
    };
    let topic = focus
        .requested_topic
        .as_deref()
        .or_else(|| background_topic_from_source(input.source_context.as_ref()))
        .unwrap_or("the source context");
    [
        format!("Answer focus: {}", compact(subject, 260)),
        format!("Focus source: {}", focus.focus_subject_source.as_str()),
        format!("Resolved intent: {}", focus.intent.as_str()),
        format!("Requested/background topic: {topic}"),
        "Write the answer under these constraints:".to_string(),
        format!("- The answer must be about {subject}."),
        format!(
            "- Explain {subject} in the {topic} context when the question is short or subjectless."
        ),
        if matches!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::PreviousAssistantAnswer
        ) {
            format!(
                "- Treat previous Quick Ask answer plus the latest question as primary. Do not return to the old selected chip unless needed as background."
            )
        } else {
            String::new()
        },
        if !input.turns.is_empty() {
            "- Do not repeat the previous Quick Ask answer. Answer only the new follow-up; add usage, examples, implementation detail, or clarification according to the latest question.".to_string()
        } else {
            String::new()
        },
        if infer_quick_answer_language(&input.question) == Some("tr") {
            "- Answer in Turkish. English technical terms are allowed, but do not mix unrelated foreign-language fragments or non-Latin scripts.".to_string()
        } else {
            String::new()
        },
        "- Do not answer only \"What is Event Sourcing?\" or generic source-topic basics."
            .to_string(),
        "- Use the source response only as background.".to_string(),
    ]
    .into_iter()
    .filter(|part| !part.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

fn active_reference_prompt(input: &QuickAskRequest) -> String {
    if input.active_references.is_empty() {
        return String::new();
    }
    let entries = input
        .active_references
        .iter()
        .filter(|reference| !reference.label.trim().is_empty())
        .map(|reference| {
            let normalized_label = normalize_quick_focus_label(&reference.label)
                .unwrap_or_else(|| reference.label.trim().to_string());
            let selected_text = reference
                .selected_text
                .as_deref()
                .and_then(normalize_quick_focus_label)
                .unwrap_or_else(|| {
                    reference
                        .selected_text
                        .as_deref()
                        .map(str::trim)
                        .unwrap_or("")
                        .to_string()
                });
            [
                format!("- {}", compact(&normalized_label, 180)),
                reference
                    .reference_id
                    .as_ref()
                    .map(|value| format!("  reference id: {}", compact(value, 120)))
                    .unwrap_or_default(),
                reference
                    .target_kind
                    .as_ref()
                    .map(|value| format!("  target kind: {}", compact(value, 80)))
                    .unwrap_or_default(),
                reference
                    .target_id
                    .as_ref()
                    .map(|value| format!("  target id: {}", compact(value, 120)))
                    .unwrap_or_default(),
                reference
                    .target_uri
                    .as_ref()
                    .map(|value| format!("  target URI: {}", compact(value, 180)))
                    .unwrap_or_default(),
                reference
                    .selected_text
                    .as_ref()
                    .map(|_| format!("  selected text: {}", compact(&selected_text, 260)))
                    .unwrap_or_default(),
                reference
                    .preview
                    .as_ref()
                    .map(|value| format!("  preview: {}", compact(value, 320)))
                    .unwrap_or_default(),
                reference
                    .source_response_id
                    .as_ref()
                    .map(|value| format!("  source response id: {}", compact(value, 120)))
                    .unwrap_or_default(),
                if reference.target_id.is_none()
                    && reference.target_uri.is_none()
                    && reference.preview.is_none()
                    && reference.selected_text.is_none()
                {
                    "  warning: unresolved target; use this label as active context.".to_string()
                } else {
                    String::new()
                },
            ]
            .into_iter()
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n");
    if entries.is_empty() {
        return String::new();
    }
    [
        "Active reference/context chips:".to_string(),
        entries,
        "Priority rule: active reference/context chips are above source context and previous Ask turns.".to_string(),
    ]
    .join("\n")
}

fn requested_topic_from_question(question: &str) -> Option<&'static str> {
    let lower = question.to_lowercase();
    if lower.contains("event store") || lower.contains("event store'da") {
        return Some("Event Store");
    }
    if lower.contains("event sourcing") || lower.contains("sourcingde") {
        return Some("Event Sourcing");
    }
    if lower.contains("cqrs") {
        return Some("CQRS");
    }
    if lower.contains("plugin") {
        return Some("plugin context");
    }
    None
}

fn background_topic_from_source(source: Option<&QuickAskSourceContext>) -> Option<&'static str> {
    let title = source
        .and_then(|source| source.title.as_deref())
        .unwrap_or_default()
        .to_lowercase();
    if title.contains("event sourcing") {
        return Some("Event Sourcing");
    }
    if title.contains("event store") {
        return Some("Event Store");
    }
    let source_text = source
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
    if source_text.contains("event store") {
        return Some("Event Store");
    }
    if source_text.contains("event sourcing") {
        return Some("Event Sourcing");
    }
    if source_text.contains("cqrs") {
        return Some("CQRS");
    }
    if source_text.contains("plugin") {
        return Some("plugin context");
    }
    None
}

fn asks_for_meaning_or_definition(question_lower: &str, original_question: &str) -> bool {
    question_lower.contains("ne anlama geliyor")
        || question_lower.contains("ne demek")
        || question_lower.contains("nedir")
        || question_lower.contains("bu ne")
        || original_question
            .to_lowercase()
            .contains("what does it mean")
        || original_question.to_lowercase().contains("what is it")
        || original_question.to_lowercase().contains("what is this")
        || original_question.to_lowercase().contains("define")
        || original_question.to_lowercase().contains("definition")
        || original_question.to_lowercase().contains("meaning")
}

fn is_short_subjectless_question(question_lower: &str, original_question: &str) -> bool {
    let word_count = question_lower.split_whitespace().count();
    word_count <= 5
        && (asks_for_meaning_or_definition(question_lower, original_question)
            || question_lower.contains("açıklar mısın")
            || question_lower.contains("aciklar misin")
            || question_lower.contains("nasıl yapılır")
            || question_lower.contains("nasil yapilir")
            || question_lower.contains("nasıl olur")
            || question_lower.contains("nasil olur")
            || question_lower.contains("nerede kullanılır")
            || question_lower.contains("bununla ilişkisi")
            || original_question.to_lowercase().contains("explain this")
            || original_question
                .to_lowercase()
                .contains("how does it work")
            || original_question.to_lowercase().contains("how is it done")
            || original_question
                .to_lowercase()
                .contains("how does it relate"))
}

fn mentions_implementation(question_lower: &str, original_question: &str) -> bool {
    question_lower.contains("nasıl yapılır")
        || question_lower.contains("nasil yapilir")
        || question_lower.contains("nasıl uygulanır")
        || question_lower.contains("nasil uygulanir")
        || question_lower.contains("nasıl olur")
        || question_lower.contains("nasil olur")
        || question_lower.contains("nerede kullanılır")
        || original_question
            .to_lowercase()
            .contains("how is this done")
        || original_question
            .to_lowercase()
            .contains("how would you implement")
        || original_question
            .to_lowercase()
            .contains("how does it work")
        || original_question
            .to_lowercase()
            .contains("where is it used")
}

fn asks_usage(question_lower: &str, original_question: &str) -> bool {
    question_lower.contains("hangi işlerde")
        || question_lower.contains("hangi islerde")
        || question_lower.contains("nasıl kullanılır")
        || question_lower.contains("nasil kullanilir")
        || question_lower.contains("nasıl kullanılıyor")
        || question_lower.contains("nasil kullaniliyor")
        || question_lower.contains("nerede kullanılır")
        || question_lower.contains("nerelerde kullanılır")
        || question_lower.contains("nerelerde kullaniliyor")
        || question_lower.contains("ne için kullanılır")
        || question_lower.contains("ne icin kullanilir")
        || question_lower.contains("hangi durumlarda")
        || original_question
            .to_lowercase()
            .contains("where is it used")
        || original_question
            .to_lowercase()
            .contains("what is it used for")
        || original_question.to_lowercase().contains("use cases")
}

fn mentions_relation(question_lower: &str, original_question: &str) -> bool {
    question_lower.contains("ilişkisi")
        || question_lower.contains("ilişkili")
        || question_lower.contains("bağlantısı")
        || question_lower.contains("bağlarız")
        || original_question.to_lowercase().contains("relation")
        || original_question.to_lowercase().contains("relationship")
        || original_question.to_lowercase().contains("relate")
        || original_question.to_lowercase().contains("related")
        || original_question.to_lowercase().contains("connect")
}

fn is_acronym_like(value: &str) -> bool {
    let trimmed = value.trim();
    let len = trimmed.chars().count();
    (2..=10).contains(&len)
        && trimmed.chars().all(|ch| {
            ch.is_ascii_uppercase() || ch.is_ascii_digit() || matches!(ch, '.' | '+' | '#' | '-')
        })
}

fn translation_instruction(input: &QuickAskRequest) -> String {
    if !matches!(input.intent, QuickAskIntent::Translation) {
        return String::new();
    }
    let selected = input.selected_text.as_deref().unwrap_or("").trim();
    if selected.is_empty() {
        return "Translation rule: answer the user's translation request directly and keep the source context as background only.".to_string();
    }
    format!(
        "Translation rule: translate only this selected fragment first: \"{}\". If the user asks for English, answer with the English translation first. Do not explain the whole source response unless the user asks for explanation.",
        compact(selected, 700)
    )
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
    fn quick_title_cleaning_removes_markup_and_limits_length() {
        assert_eq!(
            clean_quick_title("  **Event Sourcing kısa özeti**  ").as_deref(),
            Some("Event Sourcing kısa özeti")
        );
        assert_eq!(clean_quick_title(" \n\t ").as_deref(), None);
        let long_title = clean_quick_title(
            "Bu başlık küçük modelden gelse bile kullanıcı arayüzünde taşmayacak kadar kısaltılır",
        )
        .expect("title");
        assert_eq!(long_title.chars().count(), 72);
    }

    #[test]
    fn quick_fallback_title_uses_answer_before_question() {
        let request = QuickAskRequest {
            session_id: "quick-title-test".to_string(),
            quick_ask_trace_id: None,
            source_loom_id: None,
            source_response_id: None,
            selected_text: None,
            source_context: None,
            active_references: vec![],
            turns: vec![],
            question: "crud ne demek?".to_string(),
            intent: QuickAskIntent::Definition,
            options: QuickAskOptions::default(),
        };
        assert_eq!(
            quick_fallback_title(&request, "CRUD = Kaydet, Okuma, Güncelleme, Silme."),
            "CRUD = Kaydet, Okuma, Güncelleme, Silme"
        );
    }

    #[test]
    fn quick_focus_label_normalization_removes_boundary_noise() {
        assert_eq!(
            normalize_quick_focus_label("Audit Trail)").as_deref(),
            Some("Audit Trail")
        );
        assert_eq!(
            normalize_quick_focus_label("(Compaction)").as_deref(),
            Some("Compaction")
        );
        assert_eq!(
            normalize_quick_focus_label("\"Time Travel\"").as_deref(),
            Some("Time Travel")
        );
        assert_eq!(
            normalize_quick_focus_label("CQRS:").as_deref(),
            Some("CQRS")
        );
        assert_eq!(
            normalize_quick_focus_label("Error Tracking -").as_deref(),
            Some("Error Tracking")
        );
    }

    #[test]
    fn quick_composed_task_uses_normalized_focus_subject() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("Audit Trail)".to_string());
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "Audit Trail)".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: Some("response-audit-trail".to_string()),
            target_uri: None,
            selected_text: Some("Audit Trail)".to_string()),
            preview: Some("Audit Trail records who changed what and when.".to_string()),
            source_response_id: Some("response-audit-trail".to_string()),
        }];
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Sourcing".to_string()),
            response_code: Some("R-AUDIT".to_string()),
            canonical_uri: None,
            summary: Some("Event Sourcing stores domain events for auditability.".to_string()),
            key_points: vec![],
            keywords: vec!["event sourcing".to_string(), "audit trail".to_string()],
            entities: vec!["Event Sourcing".to_string()],
        });
        request.question = "Bu ne demek? nasıl kullanılır?".to_string();
        request.intent = QuickAskIntent::Usage;

        let focus = resolve_quick_ask_focus(&request);
        let composed = quick_composed_task(&request, &focus);
        let prompt = quick_user_prompt(&request);
        let validation = quick_answer_validation(
            "Audit Trail, Event Sourcing bağlamında izlenebilir audit kaydı sağlar.",
            &focus,
            &request,
        );

        assert_eq!(
            focus.original_focus_subject.as_deref(),
            Some("Audit Trail)")
        );
        assert_eq!(focus.focus_subject.as_deref(), Some("Audit Trail"));
        assert_eq!(
            composed.as_deref(),
            Some("Event Sourcing bağlamında Audit Trail ne anlama gelir ve nasıl kullanılır?")
        );
        assert!(prompt.contains("Answer focus: Audit Trail"));
        assert!(
            prompt.contains("Clean composed user question:\nEvent Sourcing bağlamında Audit Trail")
        );
        assert!(!prompt.contains("Answer focus: Audit Trail)"));
        assert!(!prompt.contains("Focus subject:"));
        assert!(!prompt.contains("Answer requirements:"));
        assert!(validation.validation_passed);
    }

    #[test]
    fn quick_visible_answer_cleanup_removes_debug_label_and_malformed_duplicate_subject() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("Audit Trail)".to_string());
        request.question = "Bu ne demek? nasıl kullanılır?".to_string();
        request.intent = QuickAskIntent::Usage;
        let focus = resolve_quick_ask_focus(&request);

        let cleaned = clean_quick_visible_answer(
            "Focus subject: Audit Trail) Audit Trail) Event Sourcing bağlamında izlenebilirlik sağlar.",
            &focus,
        );

        assert!(cleaned.starts_with("Audit Trail Event Sourcing"));
        assert!(!cleaned.contains("Focus subject:"));
        assert!(!cleaned.contains("Audit Trail) Audit Trail)"));
    }

    #[test]
    fn selected_fragment_is_primary_and_acronym_instruction_is_source_aware() {
        let request = QuickAskRequest {
            session_id: "ask-1".to_string(),
            quick_ask_trace_id: Some("trace-1".to_string()),
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
            active_references: vec![],
            turns: vec![QuickAskTurn {
                question: "önceki soru".to_string(),
                answer: "önceki cevap".to_string(),
                title: None,
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
    fn focus_and_selected_fragment_are_before_background_turns_and_source() {
        let request = quick_request_with_turns();
        let prompt = quick_user_prompt(&request);

        let focus_index = prompt.find("Task focus").expect("focus block");
        let selected_index = prompt.find("Selected fragment").expect("selected block");
        let turns_index = prompt
            .find("Previous temporary Ask turns")
            .expect("previous turns block");
        let source_index = prompt
            .find("Background source context")
            .expect("source block");
        let question_index = prompt.find("Current question").expect("current question");

        assert!(focus_index < selected_index);
        assert!(selected_index < source_index);
        assert!(selected_index < turns_index);
        assert!(turns_index < source_index);
        assert!(focus_index < question_index);
        assert!(prompt.contains("Current question:\nşimdi açıkla"));
        assert!(prompt.contains("User: önceki soru"));
        assert!(prompt.contains("Assistant: önceki cevap"));
    }

    #[test]
    fn translation_prompt_keeps_selected_fragment_primary() {
        let request = QuickAskRequest {
            session_id: "ask-translation".to_string(),
            quick_ask_trace_id: Some("trace-translation".to_string()),
            source_loom_id: Some("loom-1".to_string()),
            source_response_id: Some("response-1".to_string()),
            selected_text: Some("Tarihsel Takip".to_string()),
            source_context: Some(QuickAskSourceContext {
                title: Some("Event Sourcing".to_string()),
                response_code: None,
                canonical_uri: None,
                summary: Some("Event Sourcing açıklaması".to_string()),
                key_points: vec!["Kaynak yalnız arka plan ipucudur.".to_string()],
                keywords: vec!["event sourcing".to_string()],
                entities: vec![],
            }),
            active_references: vec![],
            turns: vec![],
            question: "ingilizcesi ne".to_string(),
            intent: QuickAskIntent::Translation,
            options: QuickAskOptions::default(),
        };
        let prompt = quick_user_prompt(&request);

        assert!(prompt.contains("Translation rule"));
        assert!(prompt.contains("translate only this selected fragment"));
        assert!(prompt.contains("Tarihsel Takip"));
        assert!(prompt.contains("Do not explain the whole source response"));
        assert!(!prompt.contains("raw_thinking"));
    }

    #[test]
    fn active_reference_context_is_first_class_for_implementation_topic() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("Error Tracking".to_string());
        request.active_references = vec![QuickAskActiveReference {
            reference_id: Some("ref-error-tracking".to_string()),
            label: "Error Tracking".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: Some("response-error-tracking".to_string()),
            target_uri: Some("loom://response/response-error-tracking#fragment=err".to_string()),
            selected_text: Some("Error Tracking".to_string()),
            preview: Some("Track command failures and error events.".to_string()),
            source_response_id: Some("response-error-tracking".to_string()),
        }];
        request.question = "nasıl yapılır event sourcingde?".to_string();
        request.intent = QuickAskIntent::ImplementationInTopic;

        let prompt = quick_user_prompt(&request);
        let active_index = prompt
            .find("Active reference/context chips")
            .expect("active reference block");
        let source_index = prompt
            .find("Background source context")
            .expect("source block");
        let turns_index = prompt
            .find("Previous temporary Ask turns")
            .expect("previous turns block");
        let question_index = prompt.find("Current question").expect("current question");

        assert!(prompt.contains("Error Tracking"));
        assert!(prompt.contains("Answer focus: Error Tracking"));
        assert!(prompt.contains("Requested/background topic: Event Sourcing"));
        assert!(prompt.contains("Resolved intent: implementation_in_topic"));
        assert!(prompt.contains("generic source-topic basics"));
        assert!(active_index < source_index);
        assert!(active_index < turns_index);
        assert!(turns_index < source_index);
        assert!(question_index < active_index);
        assert!(!prompt.contains("raw_thinking"));
    }

    #[test]
    fn active_reference_chip_becomes_focus_subject_for_subjectless_meaning_question() {
        let mut request = quick_request_with_turns();
        request.selected_text = None;
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "Compaction".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: None,
            target_uri: None,
            selected_text: None,
            preview: Some("Compaction reduces long event history with snapshots.".to_string()),
            source_response_id: Some("response-event-sourcing".to_string()),
        }];
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Sourcing".to_string()),
            response_code: Some("R-CMP".to_string()),
            canonical_uri: None,
            summary: Some(
                "Event Store, Replay, Snapshot and Compaction are part of the discussion."
                    .to_string(),
            ),
            key_points: vec!["Compaction keeps replay cost manageable.".to_string()],
            keywords: vec!["event sourcing".to_string(), "compaction".to_string()],
            entities: vec!["Event Sourcing".to_string()],
        });
        request.question = "ne anlama geliyor".to_string();
        request.intent = QuickAskIntent::Definition;

        let focus = resolve_quick_ask_focus(&request);
        let prompt = quick_user_prompt(&request);

        assert_eq!(focus.focus_subject.as_deref(), Some("Compaction"));
        assert_eq!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::ActiveReference
        );
        assert_eq!(focus.intent, QuickAskResolvedIntent::Definition);
        assert_eq!(focus.requested_topic.as_deref(), Some("Event Sourcing"));
        assert!(prompt.contains("Answer focus: Compaction"));
        assert!(prompt.contains("The answer must be about Compaction."));
        assert!(prompt.contains("Do not answer only \"What is Event Sourcing?\""));
        assert!(!prompt.contains("raw_thinking"));
    }

    #[test]
    fn selected_fragment_chip_becomes_focus_subject_for_subjectless_meaning_question() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("Compaction".to_string());
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "Compaction".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: None,
            target_uri: None,
            selected_text: Some("Compaction".to_string()),
            preview: None,
            source_response_id: Some("response-event-sourcing".to_string()),
        }];
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Sourcing".to_string()),
            response_code: None,
            canonical_uri: None,
            summary: Some("Event Sourcing keeps event history and can use compaction.".to_string()),
            key_points: vec![],
            keywords: vec!["event sourcing".to_string()],
            entities: vec![],
        });
        request.question = "ne anlama geliyor".to_string();
        request.intent = QuickAskIntent::Definition;

        let focus = resolve_quick_ask_focus(&request);

        assert_eq!(focus.focus_subject.as_deref(), Some("Compaction"));
        assert_eq!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::SelectedFragment
        );
        assert_eq!(focus.requested_topic.as_deref(), Some("Event Sourcing"));
    }

    #[test]
    fn source_title_does_not_override_active_reference_focus() {
        let mut request = quick_request_with_turns();
        request.selected_text = None;
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "Compaction".to_string(),
            target_kind: None,
            target_id: None,
            target_uri: None,
            selected_text: None,
            preview: None,
            source_response_id: None,
        }];
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Sourcing nedir".to_string()),
            response_code: None,
            canonical_uri: None,
            summary: Some("Generic Event Sourcing background.".to_string()),
            key_points: vec![],
            keywords: vec![],
            entities: vec![],
        });
        request.question = "ne anlama geliyor".to_string();
        request.intent = QuickAskIntent::Definition;

        let focus = resolve_quick_ask_focus(&request);

        assert_eq!(focus.focus_subject.as_deref(), Some("Compaction"));
        assert_ne!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::SourceResponse
        );
    }

    #[test]
    fn turkish_relation_topic_is_extracted_for_event_sourcing_suffix() {
        let mut request = quick_request_with_turns();
        request.selected_text = None;
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "Error Tracking".to_string(),
            target_kind: None,
            target_id: None,
            target_uri: None,
            selected_text: None,
            preview: None,
            source_response_id: None,
        }];
        request.question = "nasıl yapılır event sourcingde?".to_string();
        request.intent = QuickAskIntent::ImplementationInTopic;

        let focus = resolve_quick_ask_focus(&request);

        assert_eq!(focus.focus_subject.as_deref(), Some("Error Tracking"));
        assert_eq!(focus.requested_topic.as_deref(), Some("Event Sourcing"));
        assert_eq!(focus.intent, QuickAskResolvedIntent::ImplementationInTopic);
    }

    #[test]
    fn previous_turns_do_not_override_current_active_reference_focus() {
        let mut request = quick_request_with_turns();
        request.selected_text = None;
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "Compaction".to_string(),
            target_kind: None,
            target_id: None,
            target_uri: None,
            selected_text: None,
            preview: Some("Event log compaction".to_string()),
            source_response_id: None,
        }];
        request.turns = vec![QuickAskTurn {
            question: "event sourcing nedir?".to_string(),
            answer: "Event Sourcing temel açıklaması.".to_string(),
            title: None,
        }];
        request.question = "ne anlama geliyor".to_string();
        request.intent = QuickAskIntent::Definition;

        let focus = resolve_quick_ask_focus(&request);
        let prompt = quick_user_prompt(&request);

        assert_eq!(focus.focus_subject.as_deref(), Some("Compaction"));
        assert!(
            prompt.find("Answer focus: Compaction").unwrap()
                < prompt.find("Previous temporary Ask turns").unwrap()
        );
    }

    #[test]
    fn audit_trail_usage_question_resolves_focus_and_provider_summary() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("Audit Trail".to_string());
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "Audit Trail".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: Some("response-audit-trail".to_string()),
            target_uri: None,
            selected_text: Some("Audit Trail".to_string()),
            preview: Some("Audit Trail records who changed what and when.".to_string()),
            source_response_id: Some("response-audit-trail".to_string()),
        }];
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Sourcing".to_string()),
            response_code: Some("R-AUDIT".to_string()),
            canonical_uri: None,
            summary: Some("Event Sourcing stores domain events for auditability.".to_string()),
            key_points: vec!["Audit Trail is a common Event Sourcing use case.".to_string()],
            keywords: vec!["event sourcing".to_string(), "audit trail".to_string()],
            entities: vec!["Event Sourcing".to_string()],
        });
        request.question = "hangi işlerde kullanılıyor ki?".to_string();
        request.intent = QuickAskIntent::Usage;

        let focus = resolve_quick_ask_focus(&request);
        let prompt = quick_user_prompt(&request);
        let diagnostics = quick_diagnostics(
            &request,
            &focus,
            "Audit Trail Event Sourcing kullanımı.",
            None,
        );

        assert_eq!(focus.focus_subject.as_deref(), Some("Audit Trail"));
        assert_eq!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::SelectedFragment
        );
        assert_eq!(focus.intent, QuickAskResolvedIntent::Usage);
        assert_eq!(focus.requested_topic.as_deref(), Some("Event Sourcing"));
        assert!(prompt.contains("Answer focus: Audit Trail"));
        assert!(
            prompt.find("Answer focus: Audit Trail").unwrap()
                < prompt.find("Background source context").unwrap()
        );
        assert_eq!(diagnostics.active_reference_labels, vec!["Audit Trail"]);
        assert_eq!(diagnostics.focus_subject.as_deref(), Some("Audit Trail"));
        assert_eq!(diagnostics.resolved_intent, "usage");
        assert!(
            diagnostics
                .prompt_section_order
                .iter()
                .position(|section| section == "focus_subject")
                .unwrap()
                < diagnostics
                    .prompt_section_order
                    .iter()
                    .position(|section| section == "background_source_context")
                    .unwrap()
        );
        assert!(diagnostics.provider_request_summary.contains_focus_subject);
        assert!(
            diagnostics
                .provider_request_summary
                .focus_subject_before_source
        );
    }

    #[test]
    fn write_side_trace_resolves_composed_task_and_prompt_order() {
        let mut request = quick_request_with_turns();
        request.quick_ask_trace_id = Some("trace-write-side".to_string());
        request.selected_text = Some("Write Side".to_string());
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "Write Side".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: Some("response-write-side".to_string()),
            target_uri: None,
            selected_text: Some("Write Side".to_string()),
            preview: Some("Write Side appends validated events to the Event Store.".to_string()),
            source_response_id: Some("response-write-side".to_string()),
        }];
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Store".to_string()),
            response_code: Some("R-STORE".to_string()),
            canonical_uri: None,
            summary: Some(
                "Event Store keeps event streams. Write Side validates commands and appends events."
                    .to_string(),
            ),
            key_points: vec!["Write Side and Read Side are Event Store concepts.".to_string()],
            keywords: vec!["event store".to_string(), "write side".to_string()],
            entities: vec!["Event Store".to_string()],
        });
        request.question = "ne anlama geliyor".to_string();
        request.intent = QuickAskIntent::Definition;

        let focus = resolve_quick_ask_focus(&request);
        let prompt = quick_user_prompt(&request);
        let answer =
            "Write Side, Event Store bağlamında komutları işleyip olay append eden taraftır.";
        let diagnostics = quick_diagnostics(&request, &focus, answer, None);

        assert_eq!(focus.focus_subject.as_deref(), Some("Write Side"));
        assert_eq!(focus.requested_topic.as_deref(), Some("Event Store"));
        assert_eq!(
            diagnostics.composed_task.as_deref(),
            Some("Event Store bağlamında Write Side ne anlama gelir?")
        );
        assert!(prompt.contains("Clean composed user question:\nEvent Store bağlamında Write Side"));
        let order = &diagnostics.prompt_section_order;
        assert!(
            order
                .iter()
                .position(|section| section == "current_task")
                .unwrap()
                < order
                    .iter()
                    .position(|section| section == "composed_task")
                    .unwrap()
        );
        assert!(
            order
                .iter()
                .position(|section| section == "composed_task")
                .unwrap()
                < order
                    .iter()
                    .position(|section| section == "current_question")
                    .unwrap()
        );
        assert!(
            order
                .iter()
                .position(|section| section == "current_question")
                .unwrap()
                < order
                    .iter()
                    .position(|section| section == "focus_subject")
                    .unwrap()
        );
        assert!(
            diagnostics
                .prompt_section_order
                .iter()
                .position(|section| section == "composed_task")
                .unwrap()
                < diagnostics
                    .prompt_section_order
                    .iter()
                    .position(|section| section == "background_source_context")
                    .unwrap()
        );
        assert_eq!(
            diagnostics
                .provider_request_summary
                .composed_task_preview
                .as_deref(),
            Some("Event Store bağlamında Write Side ne anlama gelir?")
        );
        assert!(diagnostics.answer_validation.includes_focus_subject);
        assert!(diagnostics.answer_validation.includes_requested_topic);
        assert!(!diagnostics.answer_validation.generic_source_only_detected);
        assert!(diagnostics.answer_validation.validation_passed);
    }

    #[test]
    fn answer_validation_flags_generic_source_only_output() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("Write Side".to_string());
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Store".to_string()),
            response_code: None,
            canonical_uri: None,
            summary: Some("Event Store stores domain events.".to_string()),
            key_points: vec![],
            keywords: vec!["event store".to_string()],
            entities: vec![],
        });
        request.question = "ne anlama geliyor".to_string();
        request.intent = QuickAskIntent::Definition;
        let focus = resolve_quick_ask_focus(&request);

        let validation = quick_answer_validation("Event Store olayları saklar.", &focus, &request);

        assert!(!validation.includes_focus_subject);
        assert!(validation.includes_requested_topic);
        assert!(validation.generic_source_only_detected);
        assert!(!validation.validation_passed);
        assert!(validation
            .failure_reasons
            .contains(&"validation_missing_focus".to_string()));
        assert!(validation
            .failure_reasons
            .contains(&"provider_ignored_focus".to_string()));
    }

    #[test]
    fn focused_answer_validation_passes_focused_answer() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("Time Travel".to_string());
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Sourcing".to_string()),
            response_code: None,
            canonical_uri: None,
            summary: Some("Event Sourcing stores events.".to_string()),
            key_points: vec![],
            keywords: vec!["event sourcing".to_string()],
            entities: vec![],
        });
        request.question = "nasıl kullanılıyor? bu ne demek".to_string();
        request.intent = QuickAskIntent::Usage;
        let focus = resolve_quick_ask_focus(&request);

        let validation = quick_answer_validation(
            "Time Travel, Event Sourcing bağlamında geçmiş olayları belirli bir ana kadar replay ederek kullanılır.",
            &focus,
            &request,
        );

        assert!(validation.includes_focus_subject);
        assert!(validation.includes_requested_topic);
        assert!(!validation.generic_source_only_detected);
        assert!(validation.starts_with_focus_subject_or_definition);
        assert!(validation.validation_passed);
        assert!(validation.failure_reasons.is_empty());
    }

    #[test]
    fn event_chip_meaning_composes_natural_turkish_without_olarak() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("event)".to_string());
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "event)".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: Some("response-event".to_string()),
            target_uri: None,
            selected_text: Some("event)".to_string()),
            preview: Some("An event records a state change.".to_string()),
            source_response_id: Some("response-event".to_string()),
        }];
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Sourcing".to_string()),
            response_code: Some("R-EVENT".to_string()),
            canonical_uri: None,
            summary: Some("Event Sourcing stores state changes as events.".to_string()),
            key_points: vec![],
            keywords: vec!["event sourcing".to_string(), "event".to_string()],
            entities: vec!["Event Sourcing".to_string()],
        });
        request.question = "ne demek".to_string();
        request.intent = QuickAskIntent::Definition;

        let focus = resolve_quick_ask_focus(&request);
        let composed = quick_composed_task(&request, &focus).expect("composed task");

        assert_eq!(focus.original_focus_subject.as_deref(), Some("event)"));
        assert_eq!(focus.focus_subject.as_deref(), Some("event"));
        assert_eq!(composed, "Event Sourcing bağlamında event ne anlama gelir?");
        assert!(!composed.contains("olarak ne demek"));
    }

    #[test]
    fn previous_assistant_term_beats_stale_active_chip() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("event)".to_string());
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "event)".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: Some("response-event".to_string()),
            target_uri: None,
            selected_text: Some("event)".to_string()),
            preview: Some("Event is the old selected chip.".to_string()),
            source_response_id: Some("response-event".to_string()),
        }];
        request.turns = vec![QuickAskTurn {
            question: "ne demek".to_string(),
            answer:
                "Event, Event Sourcing bağlamında bir durum değişikliğini kaydeder. Resultado burada sonuç anlamına gelen yabancı bir kelimedir."
                    .to_string(),
            title: None,
        }];
        request.question = "resultado ne be".to_string();
        request.intent = QuickAskIntent::Definition;

        let focus = resolve_quick_ask_focus(&request);
        let composed = quick_composed_task(&request, &focus).expect("composed task");
        let prompt = quick_user_prompt(&request);
        let diagnostics = quick_diagnostics(
            &request,
            &focus,
            "Resultado, önceki yanıtta sonuç anlamında kullanılmıştır.",
            None,
        );

        assert_eq!(focus.focus_subject.as_deref(), Some("resultado"));
        assert_eq!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::PreviousAssistantAnswer
        );
        assert_eq!(
            composed,
            "Önceki yanıtta geçen \"resultado\" ne anlama gelir?"
        );
        assert!(prompt.contains("Previous temporary Ask turns"));
        assert!(prompt.contains("Decay rule"));
        assert_eq!(
            diagnostics.previous_answer_term_matched.as_deref(),
            Some("resultado")
        );
        assert!(diagnostics.active_chip_used_as_background);
        assert!(!diagnostics.active_chip_used_as_primary);
        assert!(!diagnostics.answer_validation.stale_chip_override_detected);
    }

    #[test]
    fn follow_up_usage_uses_previous_answer_and_seed_as_background() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("event logging)".to_string());
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "event logging)".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: Some("response-event-logging".to_string()),
            target_uri: None,
            selected_text: Some("event logging)".to_string()),
            preview: Some("Event logging records domain events.".to_string()),
            source_response_id: Some("response-event-logging".to_string()),
        }];
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Sourcing".to_string()),
            response_code: Some("R-EVENT-LOGGING".to_string()),
            canonical_uri: None,
            summary: Some("Event Sourcing stores state changes as events.".to_string()),
            key_points: vec!["event logging records append-only events.".to_string()],
            keywords: vec!["event sourcing".to_string(), "event logging".to_string()],
            entities: vec!["Event Sourcing".to_string()],
        });
        request.turns = vec![QuickAskTurn {
            question: "bu ne".to_string(),
            answer:
                "event logging, Event Sourcing bağlamında domain eventleri kaydetme yaklaşımıdır."
                    .to_string(),
            title: None,
        }];
        request.question = "nasıl kullanılıyor".to_string();
        request.intent = QuickAskIntent::Usage;

        let focus = resolve_quick_ask_focus(&request);
        let composed = quick_composed_task(&request, &focus).expect("composed task");
        let prompt = quick_user_prompt(&request);
        let diagnostics = quick_diagnostics(
            &request,
            &focus,
            "event logging, Event Sourcing'de domain event oluştuğunda Event Store'a append edilerek kullanılır. `OrderCreated` gibi eventler replay ve projection üretimi için event log'dan okunur.",
            None,
        );

        assert_eq!(focus.focus_subject.as_deref(), Some("event logging"));
        assert_eq!(
            focus.focus_subject_source,
            QuickAskFocusSubjectSource::PreviousAssistantAnswer
        );
        assert_eq!(focus.intent, QuickAskResolvedIntent::Usage);
        assert_eq!(
            composed,
            "Önceki yanıtta açıklanan \"event logging\" teriminin Event Sourcing bağlamında nasıl kullanıldığını açıkla."
        );
        assert!(prompt.contains("Do not repeat the previous Quick Ask answer"));
        assert_eq!(diagnostics.seed_context_labels, vec!["event logging"]);
        assert_eq!(diagnostics.seed_context_mode, "background");
        assert_eq!(
            diagnostics.current_turn_primary_context,
            "previous_answer + current_question"
        );
        assert_eq!(diagnostics.follow_up_intent.as_deref(), Some("usage"));
        assert!(diagnostics.active_chip_used_as_background);
        assert!(!diagnostics.active_chip_used_as_primary);
        assert!(diagnostics.answer_validation.follows_up_on_previous_turn);
        assert!(!diagnostics.answer_validation.repeats_previous_answer);
        assert!(diagnostics.answer_validation.answer_adds_new_information);
        assert!(diagnostics.answer_validation.validation_passed);
    }

    #[test]
    fn follow_up_repetition_and_language_contamination_fail_validation() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("event logging)".to_string());
        request.turns = vec![QuickAskTurn {
            question: "bu ne".to_string(),
            answer: "event logging, Event Sourcing bağlamında domain eventleri kaydetme yaklaşımıdır. Bu kayıt audit ve geçmişi izleme için kullanılır.".to_string(),
            title: None,
        }];
        request.question = "nasıl kullanılıyor".to_string();
        request.intent = QuickAskIntent::Usage;
        let focus = resolve_quick_ask_focus(&request);

        let repeated = quick_answer_validation(
            "event logging, Event Sourcing bağlamında domain eventleri kaydetme yaklaşımıdır. Bu kayıt audit ve geçmişi izleme için kullanılır.",
            &focus,
            &request,
        );
        let contaminated = quick_answer_validation(
            "event logging, Event Sourcing bağlamında place olarak Event Store'a append edilir.",
            &focus,
            &request,
        );

        assert!(repeated.repeats_previous_answer);
        assert!(!repeated.answer_adds_new_information);
        assert!(repeated
            .failure_reasons
            .contains(&"repeats_previous_answer".to_string()));
        assert!(contaminated.language_contamination_detected);
        assert!(contaminated
            .failure_reasons
            .contains(&"language_contamination_detected".to_string()));
    }

    #[test]
    fn stale_chip_override_and_language_contamination_are_detected() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("event)".to_string());
        request.turns = vec![QuickAskTurn {
            question: "ne demek".to_string(),
            answer: "Resultado önceki yanıtta geçen terimdir.".to_string(),
            title: None,
        }];
        request.question = "resultado ne be".to_string();
        request.intent = QuickAskIntent::Definition;
        let focus = resolve_quick_ask_focus(&request);

        let stale_validation = quick_answer_validation(
            "event, Event Sourcing bağlamında sistemde olan değişikliktir.",
            &focus,
            &request,
        );
        let language_validation = quick_answer_validation(
            "Resultado, önceki yanıtta sonuç anlamına gelir بلکه unrelated filler.",
            &focus,
            &request,
        );

        assert!(stale_validation.stale_chip_override_detected);
        assert!(stale_validation
            .failure_reasons
            .contains(&"stale_chip_override_detected".to_string()));
        assert!(language_validation.language_contamination_detected);
        assert!(language_validation
            .failure_reasons
            .contains(&"language_contamination_detected".to_string()));
    }

    #[test]
    fn repair_prompt_requires_focus_subject_first() {
        let mut request = quick_request_with_turns();
        request.selected_text = Some("Time Travel".to_string());
        request.source_context = Some(QuickAskSourceContext {
            title: Some("Event Sourcing".to_string()),
            response_code: None,
            canonical_uri: None,
            summary: Some("Event Sourcing stores events.".to_string()),
            key_points: vec![],
            keywords: vec!["event sourcing".to_string()],
            entities: vec![],
        });
        request.question = "nasıl kullanılıyor? bu ne demek".to_string();
        request.intent = QuickAskIntent::Usage;
        let focus = resolve_quick_ask_focus(&request);
        let repair = quick_repair_ollama_request(
            &request,
            &focus,
            "Event Sourcing genel olarak olay kaydeder.",
            "qwen".to_string(),
            "repair-test".to_string(),
        );
        let prompt = &repair.messages[1].content;

        assert!(prompt.contains("The previous answer ignored the focus subject."));
        assert!(prompt.contains("It must be about Time Travel in the context of Event Sourcing."));
        assert!(prompt.contains("Start with Time Travel."));
        assert!(prompt
            .contains("Use this clean user-facing task: Event Sourcing bağlamında Time Travel"));
    }

    #[test]
    fn focus_diagnostics_do_not_include_forbidden_raw_thinking_keys() {
        let mut request = quick_request_with_turns();
        request.active_references = vec![QuickAskActiveReference {
            reference_id: Some("ref-safe".to_string()),
            label: "Compaction".to_string(),
            target_kind: Some("fragment".to_string()),
            target_id: Some("response-safe".to_string()),
            target_uri: None,
            selected_text: Some("Compaction".to_string()),
            preview: Some("Snapshot and event log pruning.".to_string()),
            source_response_id: Some("response-safe".to_string()),
        }];
        request.question = "ne anlama geliyor".to_string();
        let focus = resolve_quick_ask_focus(&request);
        let diagnostic = json!({
            "focusSubject": focus.focus_subject,
            "focusSubjectSource": focus.focus_subject_source.as_str(),
            "resolvedIntent": focus.intent.as_str(),
            "requestedTopic": focus.requested_topic,
            "warnings": focus.warnings,
        });
        let serialized = serde_json::to_string(&diagnostic).expect("serialize diagnostic");

        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("thinking_text"));
        assert!(!serialized.contains("chain_of_thought"));
        assert!(!serialized.contains("hidden_reasoning"));
    }

    #[test]
    fn unresolved_active_reference_label_is_included_with_warning() {
        let mut request = quick_request_with_turns();
        request.active_references = vec![QuickAskActiveReference {
            reference_id: None,
            label: "Error Tracking".to_string(),
            target_kind: None,
            target_id: None,
            target_uri: None,
            selected_text: None,
            preview: None,
            source_response_id: None,
        }];
        request.intent = QuickAskIntent::ImplementationInTopic;

        let prompt = quick_user_prompt(&request);

        assert!(prompt.contains("Error Tracking"));
        assert!(prompt.contains("unresolved target"));
        assert_eq!(
            quick_reference_warnings(&request),
            vec!["reference_context_unresolved".to_string()]
        );
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

    #[test]
    fn quick_provider_request_preserves_non_stream_contract_mapping() {
        let mut request = quick_request_with_turns();
        request.options.num_ctx = Some(99_999);
        request.options.num_predict = Some(99_999);
        let ollama =
            quick_ollama_request(&request, "quick-model".to_string(), "quick-1".to_string());
        let provider_request = quick_provider_request_from_ollama_request(
            &ollama,
            crate::providers::config::ProviderKind::Ollama,
            "ollama-local",
        );

        assert_eq!(provider_request.provider_profile_id, "ollama-local");
        assert_eq!(provider_request.model_id, "quick-model");
        assert!(!provider_request.stream);
        assert_eq!(provider_request.options.thinking, Some(false));
        assert_eq!(
            provider_request.options.context_tokens,
            Some(MAX_QUICK_NUM_CTX)
        );
        assert_eq!(
            provider_request.options.max_tokens,
            Some(MAX_QUICK_NUM_PREDICT)
        );
        assert_eq!(
            provider_request.messages[0].role,
            ProviderContractMessageRole::System
        );
        assert_eq!(
            provider_request.messages[1].role,
            ProviderContractMessageRole::User
        );
    }

    #[test]
    fn quick_provider_events_collect_visible_deltas_and_ignore_thinking_status() {
        let answer = collect_quick_answer_from_provider_events(vec![
            ProviderContractEvent::ThinkingStatus {
                status: "active".to_string(),
                duration_ms: Some(12),
                token_estimate: Some(4),
            },
            ProviderContractEvent::Delta {
                text: "Event ".to_string(),
            },
            ProviderContractEvent::Delta {
                text: "Sourcing".to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: crate::providers::contract::ProviderUsageMetadata::unavailable(
                    "provider_did_not_report_usage",
                ),
            },
        ])
        .expect("provider events");

        assert_eq!(answer.as_deref(), Some("Event Sourcing"));
    }

    #[test]
    fn quick_provider_error_maps_to_existing_quick_error_kind() {
        let provider_error = ProviderError::new(
            ProviderErrorKind::ModelMissing,
            crate::providers::config::ProviderKind::Ollama,
        )
        .with_provider_id("ollama-local")
        .with_model(Some("missing-model".to_string()))
        .with_technical_message("selected model is missing");

        let error = collect_quick_answer_from_provider_events(vec![ProviderContractEvent::Error {
            error: provider_error,
        }])
        .expect_err("provider error");

        assert_eq!(error.kind, OllamaRuntimeErrorKind::ModelMissing);
        assert_eq!(error.message, "selected model is missing");
    }

    #[test]
    fn quick_answer_parser_accepts_ollama_non_stream_chat_response() {
        let body = json!({
            "model": "llama3.2:latest",
            "message": {
                "role": "assistant",
                "content": "Event Sourcing olayları saklama yaklaşımıdır.",
                "thinking": "private reasoning"
            },
            "done": true,
            "done_reason": "stop",
            "raw_thinking": "must not leak"
        });

        let answer = quick_answer_from_ollama_body(&body).expect("visible answer");

        assert_eq!(answer, "Event Sourcing olayları saklama yaklaşımıdır.");
        assert!(!answer.contains("private reasoning"));
        assert!(!answer.contains("raw_thinking"));
    }

    #[test]
    fn quick_answer_parser_accepts_legacy_response_field() {
        let body = json!({
            "response": "Kısa görünür cevap.",
            "thinking_text": "must not leak"
        });

        let answer = quick_answer_from_ollama_body(&body).expect("visible answer");

        assert_eq!(answer, "Kısa görünür cevap.");
        assert!(!answer.contains("thinking_text"));
    }

    #[test]
    fn quick_answer_parser_rejects_thinking_only_payload() {
        let body = json!({
            "message": {
                "role": "assistant",
                "thinking": "private reasoning"
            },
            "hidden_reasoning": "must not leak"
        });

        assert!(quick_answer_from_ollama_body(&body).is_none());
    }

    fn quick_request_with_turns() -> QuickAskRequest {
        QuickAskRequest {
            session_id: "ask-1".to_string(),
            quick_ask_trace_id: Some("trace-turns".to_string()),
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
            active_references: vec![],
            turns: vec![QuickAskTurn {
                question: "önceki soru".to_string(),
                answer: "önceki cevap".to_string(),
                title: None,
            }],
            question: "şimdi açıkla".to_string(),
            intent: QuickAskIntent::ExplainThis,
            options: QuickAskOptions::default(),
        }
    }
}
