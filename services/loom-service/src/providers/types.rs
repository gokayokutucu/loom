use crate::providers::config::ProviderKind;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const FORBIDDEN_PROVIDER_ERROR_KEYS: [&str; 16] = [
    "api_key",
    "apikey",
    "apiKey",
    "token",
    "bearer",
    "authorization",
    "bearer_token",
    "password",
    "credential",
    "client_secret",
    "private_key",
    "prompt",
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct OllamaOptions {
    pub num_ctx: Option<u32>,
    pub num_predict: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaChatRequest {
    pub model: String,
    pub messages: Vec<OllamaMessage>,
    pub stream: Option<bool>,
    pub think: Option<bool>,
    pub options: Option<OllamaOptions>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealthResponse {
    pub status: String,
    pub base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub models_endpoint_reachable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub security: OllamaSecurityResponse,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaSecurityResponse {
    pub local_only: bool,
    pub remote_allowed: bool,
    pub network_exposure_risk: String,
    pub version_status: String,
    pub minimum_recommended_version: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModelsResponse {
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum ProviderErrorKind {
    InvalidConfig,
    UnsafeEndpoint,
    RemoteEndpointBlocked,
    InsecureRemoteHttpBlocked,
    MissingSecret,
    SecretUnavailable,
    UnsafeModelManagementDisabled,
    RuntimeUnavailable,
    ConnectionRefused,
    DnsFailed,
    RequestTimeout,
    TimeoutBeforeFirstChunk,
    TimeoutDuringStream,
    ServiceUnavailable,
    AuthRequired,
    Unauthorized,
    Forbidden,
    RateLimited,
    QuotaExceeded,
    ModelMissing,
    ModelUnavailable,
    EndpointNotFound,
    UnsupportedFeature,
    InvalidRequest,
    ProviderRejectedThink,
    ContextTooLarge,
    OutputLimitReached,
    StreamParseError,
    InvalidResponse,
    EmptyResponse,
    DoneReasonLength,
    Cancelled,
    ProviderError,
    Unknown,
}

impl ProviderErrorKind {
    pub fn user_message(self) -> &'static str {
        match self {
            Self::InvalidConfig => "Provider configuration is invalid.",
            Self::UnsafeEndpoint
            | Self::RemoteEndpointBlocked
            | Self::InsecureRemoteHttpBlocked => {
                "This provider endpoint is blocked by the local security policy."
            }
            Self::MissingSecret | Self::SecretUnavailable | Self::AuthRequired => {
                "This provider requires a secret before it can be used."
            }
            Self::UnsafeModelManagementDisabled => {
                "Provider model management is disabled by the local security policy."
            }
            Self::RuntimeUnavailable | Self::ConnectionRefused | Self::DnsFailed => {
                "The provider runtime is unavailable."
            }
            Self::RequestTimeout | Self::TimeoutBeforeFirstChunk | Self::TimeoutDuringStream => {
                "The provider request timed out."
            }
            Self::ServiceUnavailable => "The provider service is unavailable.",
            Self::Unauthorized => "Provider authentication failed.",
            Self::Forbidden => "Provider authorization failed.",
            Self::RateLimited => "The provider rate limit was reached.",
            Self::QuotaExceeded => "The provider quota was exceeded.",
            Self::ModelMissing | Self::ModelUnavailable => "The selected model is not available.",
            Self::EndpointNotFound => "The provider endpoint was not found.",
            Self::UnsupportedFeature => "The provider does not support this feature.",
            Self::InvalidRequest => "The provider rejected the request as invalid.",
            Self::ProviderRejectedThink => "The provider rejected the thinking option.",
            Self::ContextTooLarge => "The request exceeded the provider context limit.",
            Self::OutputLimitReached | Self::DoneReasonLength => {
                "The response reached the provider length limit."
            }
            Self::StreamParseError => "The provider returned an unexpected stream response.",
            Self::InvalidResponse => "The provider returned an unexpected response.",
            Self::EmptyResponse => "The provider returned an empty response.",
            Self::Cancelled => "The provider request was cancelled.",
            Self::ProviderError | Self::Unknown => "The provider returned an error.",
        }
    }

    pub fn retryable(self) -> bool {
        matches!(
            self,
            Self::ConnectionRefused
                | Self::DnsFailed
                | Self::RequestTimeout
                | Self::TimeoutBeforeFirstChunk
                | Self::TimeoutDuringStream
                | Self::ServiceUnavailable
                | Self::RateLimited
                | Self::RuntimeUnavailable
                | Self::ProviderError
                | Self::Unknown
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderError {
    pub kind: ProviderErrorKind,
    pub provider_kind: ProviderKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    pub retryable: bool,
    pub user_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technical_message: Option<String>,
    pub warnings: Vec<String>,
    pub safe_metadata: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_provider_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_provider_message: Option<String>,
}

impl ProviderError {
    pub fn new(kind: ProviderErrorKind, provider_kind: ProviderKind) -> Self {
        Self {
            kind,
            provider_kind,
            provider_id: None,
            model: None,
            status_code: None,
            retryable: kind.retryable(),
            user_message: kind.user_message().to_string(),
            technical_message: None,
            warnings: Vec::new(),
            safe_metadata: Value::Object(Map::new()),
            raw_provider_code: None,
            raw_provider_message: None,
        }
    }

    pub fn with_provider_id(mut self, provider_id: impl Into<String>) -> Self {
        self.provider_id = Some(provider_id.into());
        self
    }

    pub fn with_model(mut self, model: Option<String>) -> Self {
        self.model = model.filter(|model| !model.trim().is_empty());
        self
    }

    pub fn with_status_code(mut self, status_code: Option<u16>) -> Self {
        self.status_code = status_code;
        self
    }

    pub fn with_technical_message(mut self, message: impl Into<String>) -> Self {
        self.technical_message = Some(sanitize_provider_text(&message.into()));
        self
    }

    #[allow(dead_code)]
    pub fn with_safe_metadata(mut self, metadata: Value) -> Self {
        self.safe_metadata = sanitize_provider_metadata(&metadata);
        self
    }

    #[allow(dead_code)]
    pub fn with_raw_provider_code(mut self, code: Option<String>) -> Self {
        self.raw_provider_code = code.map(|code| sanitize_provider_text(&code));
        self
    }

    #[allow(dead_code)]
    pub fn with_raw_provider_message(mut self, message: Option<String>) -> Self {
        self.raw_provider_message = message.map(|message| sanitize_provider_text(&message));
        self
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct OllamaTagsResponse {
    pub models: Vec<OllamaTagModel>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OllamaVersionResponse {
    pub version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OllamaTagModel {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OllamaWireMessage {
    pub content: Option<String>,
    pub thinking: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OllamaWireChunk {
    /// Ollama error field: present when Ollama returns `{"error":"..."}` in the stream.
    /// Must be checked before processing other fields — a chunk with `error` set is never
    /// a valid content chunk regardless of the value of `done`.
    pub error: Option<String>,
    pub message: Option<OllamaWireMessage>,
    pub response: Option<String>,
    pub thinking: Option<String>,
    #[serde(default)]
    pub done: bool,
    #[serde(
        default,
        alias = "doneReason",
        alias = "reason",
        alias = "stop_reason",
        alias = "stopReason"
    )]
    pub done_reason: Option<String>,
    /// Total tokens generated in this response (present on the final done=true chunk).
    pub eval_count: Option<u64>,
    /// Tokens consumed by the prompt (present on the final done=true chunk).
    pub prompt_eval_count: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OllamaStreamChunk {
    pub content: Option<String>,
    pub thinking_seen: bool,
    /// Raw byte length of thinking text in this chunk (used for live token estimation).
    pub thinking_char_count: usize,
    pub done: bool,
    pub done_reason: Option<String>,
    /// Authoritative generated token count from the final chunk.
    pub eval_count: Option<u64>,
    /// Authoritative prompt token count from the final chunk.
    pub prompt_eval_count: Option<u64>,
}

impl From<OllamaWireChunk> for OllamaStreamChunk {
    fn from(chunk: OllamaWireChunk) -> Self {
        let message_content = chunk
            .message
            .as_ref()
            .and_then(|message| message.content.clone());
        let message_thinking = chunk
            .message
            .as_ref()
            .and_then(|message| message.thinking.as_deref());
        let message_thinking_seen = message_thinking.is_some_and(|thinking| !thinking.is_empty());
        let top_level_thinking = chunk.thinking.as_deref();
        let thinking_char_count = message_thinking.map(str::len).unwrap_or(0)
            + top_level_thinking.map(str::len).unwrap_or(0);

        Self {
            content: message_content.or(chunk.response),
            thinking_seen: message_thinking_seen
                || top_level_thinking.is_some_and(|thinking| !thinking.is_empty()),
            thinking_char_count,
            done: chunk.done,
            done_reason: chunk.done_reason,
            eval_count: chunk.eval_count,
            prompt_eval_count: chunk.prompt_eval_count,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum OllamaRuntimeErrorKind {
    InvalidConfig,
    RuntimeUnavailable,
    ModelMissing,
    TimeoutBeforeFirstChunk,
    TimeoutDuringStream,
    UnexpectedResponse,
    StreamParseError,
    Aborted,
    DoneReasonLength,
    ProviderRejectedThink,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomServiceErrorPayload {
    pub code: String,
    pub message: String,
    pub kind: OllamaRuntimeErrorKind,
    pub retryable: bool,
    pub correlation_id: String,
    pub details: Value,
}

#[derive(Debug, Clone)]
pub struct OllamaRuntimeError {
    pub kind: OllamaRuntimeErrorKind,
    pub message: String,
    pub retryable: bool,
    pub status: Option<u16>,
    pub done_reason: Option<String>,
}

impl OllamaRuntimeError {
    pub fn new(kind: OllamaRuntimeErrorKind, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            kind,
            message: message.into(),
            retryable,
            status: None,
            done_reason: None,
        }
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }

    #[allow(dead_code)]
    pub fn to_provider_error(
        &self,
        provider_id: Option<&str>,
        model: Option<&str>,
    ) -> ProviderError {
        let kind = match self.kind {
            OllamaRuntimeErrorKind::InvalidConfig => classify_ollama_invalid_config(&self.message),
            OllamaRuntimeErrorKind::RuntimeUnavailable => ProviderErrorKind::RuntimeUnavailable,
            OllamaRuntimeErrorKind::ModelMissing => ProviderErrorKind::ModelMissing,
            OllamaRuntimeErrorKind::TimeoutBeforeFirstChunk => {
                ProviderErrorKind::TimeoutBeforeFirstChunk
            }
            OllamaRuntimeErrorKind::TimeoutDuringStream => ProviderErrorKind::TimeoutDuringStream,
            OllamaRuntimeErrorKind::UnexpectedResponse => ProviderErrorKind::InvalidResponse,
            OllamaRuntimeErrorKind::StreamParseError => ProviderErrorKind::StreamParseError,
            OllamaRuntimeErrorKind::Aborted => ProviderErrorKind::Cancelled,
            OllamaRuntimeErrorKind::DoneReasonLength => ProviderErrorKind::DoneReasonLength,
            OllamaRuntimeErrorKind::ProviderRejectedThink => {
                ProviderErrorKind::ProviderRejectedThink
            }
            OllamaRuntimeErrorKind::Unknown => ProviderErrorKind::Unknown,
        };
        let mut error = ProviderError::new(kind, ProviderKind::Ollama)
            .with_status_code(self.status)
            .with_technical_message(self.message.clone())
            .with_model(model.map(str::to_string));
        if let Some(provider_id) = provider_id {
            error = error.with_provider_id(provider_id);
        }
        if let Some(done_reason) = &self.done_reason {
            error = error.with_safe_metadata(serde_json::json!({ "doneReason": done_reason }));
        }
        error
    }
}

pub fn done_reason_is_length(done_reason: &str) -> bool {
    matches!(
        done_reason.to_ascii_lowercase().as_str(),
        "length" | "max_tokens" | "num_predict" | "token_limit" | "context_length"
    )
}

pub fn classify_http_failure(status: u16, body_preview: &str) -> OllamaRuntimeErrorKind {
    let body = body_preview.to_ascii_lowercase();
    if status == 404 || body.contains("model") && body.contains("not found") {
        return OllamaRuntimeErrorKind::ModelMissing;
    }
    if body.contains("think") && (body.contains("unsupported") || body.contains("rejected")) {
        return OllamaRuntimeErrorKind::ProviderRejectedThink;
    }
    OllamaRuntimeErrorKind::UnexpectedResponse
}

pub fn provider_error_kind_from_http_status(
    status: u16,
    body_preview: &str,
    model_context: bool,
) -> ProviderErrorKind {
    let body = body_preview.to_ascii_lowercase();
    if body.contains("quota") {
        return ProviderErrorKind::QuotaExceeded;
    }
    if body.contains("rate limit") || body.contains("rate_limit") {
        return ProviderErrorKind::RateLimited;
    }
    if body.contains("context") && (body.contains("large") || body.contains("length")) {
        return ProviderErrorKind::ContextTooLarge;
    }
    if body.contains("model") && (body.contains("not found") || body.contains("missing")) {
        return ProviderErrorKind::ModelMissing;
    }
    match status {
        400 | 422 => ProviderErrorKind::InvalidRequest,
        401 => ProviderErrorKind::Unauthorized,
        403 => ProviderErrorKind::Forbidden,
        404 if model_context => ProviderErrorKind::ModelMissing,
        404 => ProviderErrorKind::EndpointNotFound,
        408 => ProviderErrorKind::RequestTimeout,
        413 => ProviderErrorKind::ContextTooLarge,
        429 => ProviderErrorKind::RateLimited,
        500 | 502 | 503 | 504 => ProviderErrorKind::ServiceUnavailable,
        _ => ProviderErrorKind::ProviderError,
    }
}

#[allow(dead_code)]
pub fn sanitize_provider_metadata(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sanitized = Map::new();
            for (key, value) in map {
                if FORBIDDEN_PROVIDER_ERROR_KEYS
                    .iter()
                    .any(|forbidden| key.eq_ignore_ascii_case(forbidden))
                {
                    continue;
                }
                sanitized.insert(key.clone(), sanitize_provider_metadata(value));
            }
            Value::Object(sanitized)
        }
        Value::Array(values) => {
            Value::Array(values.iter().map(sanitize_provider_metadata).collect())
        }
        Value::String(value) => Value::String(sanitize_provider_text(value)),
        other => other.clone(),
    }
}

pub fn sanitize_provider_text(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    if FORBIDDEN_PROVIDER_ERROR_KEYS
        .iter()
        .any(|forbidden| lower.contains(&forbidden.to_ascii_lowercase()))
    {
        return "Provider returned sensitive content that was sanitized.".to_string();
    }
    value.chars().take(240).collect()
}

#[allow(dead_code)]
fn classify_ollama_invalid_config(message: &str) -> ProviderErrorKind {
    let lower = message.to_ascii_lowercase();
    if lower.contains("remote ollama") || lower.contains("remote") {
        ProviderErrorKind::RemoteEndpointBlocked
    } else if lower.contains("0.0.0.0") || lower.contains("unsafe") {
        ProviderErrorKind::UnsafeEndpoint
    } else if lower.contains("http") && lower.contains("insecure") {
        ProviderErrorKind::InsecureRemoteHttpBlocked
    } else {
        ProviderErrorKind::InvalidConfig
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_http_failure, done_reason_is_length, provider_error_kind_from_http_status,
        sanitize_provider_metadata, LoomServiceErrorPayload, OllamaRuntimeError,
        OllamaRuntimeErrorKind, OllamaStreamChunk, OllamaWireChunk, ProviderErrorKind,
    };

    #[test]
    fn parses_content_chunk() {
        let chunk: OllamaWireChunk =
            serde_json::from_str(r#"{"message":{"content":"hello"},"done":false}"#)
                .expect("valid chunk");
        let sanitized = OllamaStreamChunk::from(chunk);

        assert_eq!(sanitized.content.as_deref(), Some("hello"));
        assert!(!sanitized.thinking_seen);
    }

    #[test]
    fn parses_thinking_without_exposing_raw_text() {
        let chunk: OllamaWireChunk =
            serde_json::from_str(r#"{"message":{"thinking":"private raw thinking"},"done":false}"#)
                .expect("valid chunk");
        let sanitized = OllamaStreamChunk::from(chunk);

        assert!(sanitized.thinking_seen);
        assert!(sanitized.content.is_none());
    }

    #[test]
    fn parses_done_reason_aliases() {
        let chunk: OllamaWireChunk =
            serde_json::from_str(r#"{"done":true,"doneReason":"length"}"#).expect("valid chunk");
        let sanitized = OllamaStreamChunk::from(chunk);

        assert_eq!(sanitized.done_reason.as_deref(), Some("length"));
        assert!(done_reason_is_length("length"));
    }

    #[test]
    fn length_done_reasons_are_classified_as_truncation_not_generic_errors() {
        for reason in [
            "length",
            "max_tokens",
            "num_predict",
            "token_limit",
            "context_length",
        ] {
            assert!(done_reason_is_length(reason), "{reason} should be length");
        }
        assert!(!done_reason_is_length("stop"));
        let chunk: OllamaWireChunk =
            serde_json::from_str(r#"{"done":true,"stop_reason":"num_predict"}"#)
                .expect("valid chunk");
        let sanitized = OllamaStreamChunk::from(chunk);

        assert_eq!(sanitized.done_reason.as_deref(), Some("num_predict"));
        assert!(done_reason_is_length(
            sanitized.done_reason.as_deref().unwrap()
        ));
    }

    #[test]
    fn classifies_model_missing() {
        assert_eq!(
            classify_http_failure(404, "model not found"),
            OllamaRuntimeErrorKind::ModelMissing
        );
    }

    #[test]
    fn classifies_provider_rejected_think() {
        assert_eq!(
            classify_http_failure(400, "think is unsupported by this model"),
            OllamaRuntimeErrorKind::ProviderRejectedThink
        );
        assert_eq!(
            classify_http_failure(422, "provider rejected think parameter"),
            OllamaRuntimeErrorKind::ProviderRejectedThink
        );
    }

    #[test]
    fn canonical_http_status_mapping_covers_provider_errors() {
        assert_eq!(
            provider_error_kind_from_http_status(401, "", false),
            ProviderErrorKind::Unauthorized
        );
        assert_eq!(
            provider_error_kind_from_http_status(403, "", false),
            ProviderErrorKind::Forbidden
        );
        assert_eq!(
            provider_error_kind_from_http_status(404, "", true),
            ProviderErrorKind::ModelMissing
        );
        assert_eq!(
            provider_error_kind_from_http_status(404, "", false),
            ProviderErrorKind::EndpointNotFound
        );
        assert_eq!(
            provider_error_kind_from_http_status(413, "", false),
            ProviderErrorKind::ContextTooLarge
        );
        assert_eq!(
            provider_error_kind_from_http_status(429, "quota exceeded", false),
            ProviderErrorKind::QuotaExceeded
        );
        assert_eq!(
            provider_error_kind_from_http_status(503, "", false),
            ProviderErrorKind::ServiceUnavailable
        );
    }

    #[test]
    fn retryable_classification_is_consistent() {
        assert!(ProviderErrorKind::RequestTimeout.retryable());
        assert!(ProviderErrorKind::TimeoutBeforeFirstChunk.retryable());
        assert!(ProviderErrorKind::RateLimited.retryable());
        assert!(ProviderErrorKind::ServiceUnavailable.retryable());
        assert!(!ProviderErrorKind::InvalidConfig.retryable());
        assert!(!ProviderErrorKind::MissingSecret.retryable());
        assert!(!ProviderErrorKind::Unauthorized.retryable());
        assert!(!ProviderErrorKind::ModelMissing.retryable());
        assert!(!ProviderErrorKind::ProviderRejectedThink.retryable());
    }

    #[test]
    fn ollama_errors_map_to_provider_taxonomy() {
        let unavailable = OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::RuntimeUnavailable,
            "Ollama is not reachable.",
            true,
        )
        .to_provider_error(Some("ollama-local"), Some("qwen"));
        assert_eq!(unavailable.kind, ProviderErrorKind::RuntimeUnavailable);
        assert_eq!(unavailable.provider_id.as_deref(), Some("ollama-local"));

        let unsafe_remote = OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::InvalidConfig,
            "Remote Ollama URLs are disabled by default.",
            false,
        )
        .to_provider_error(None, None);
        assert_eq!(unsafe_remote.kind, ProviderErrorKind::RemoteEndpointBlocked);

        let malformed_stream = OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::StreamParseError,
            "Ollama returned malformed NDJSON.",
            true,
        )
        .to_provider_error(None, None);
        assert_eq!(malformed_stream.kind, ProviderErrorKind::StreamParseError);

        let length = OllamaRuntimeError {
            kind: OllamaRuntimeErrorKind::DoneReasonLength,
            message: "Provider reached a length limit.".to_string(),
            retryable: false,
            status: None,
            done_reason: Some("length".to_string()),
        }
        .to_provider_error(None, None);
        assert_eq!(length.kind, ProviderErrorKind::DoneReasonLength);
        assert_eq!(length.safe_metadata["doneReason"], "length");
    }

    #[test]
    fn provider_error_payload_sanitizes_secrets_prompts_and_raw_thinking() {
        let error = OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::UnexpectedResponse,
            "raw_thinking private chain_of_thought",
            true,
        )
        .to_provider_error(None, None)
        .with_safe_metadata(serde_json::json!({
            "prompt": "private prompt",
            "apiKey": "private",
            "authorization": "Bearer sk-secret",
            "client_secret": "client-secret",
            "private_key": "private-key",
            "credential": "credential",
            "safe": "value",
            "nested": {
                "hidden_reasoning": "private"
            }
        }));
        let json = serde_json::to_string(&error).expect("error json");

        assert_eq!(error.safe_metadata["safe"], "value");
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "private prompt",
            "apiKey",
            "authorization",
            "client_secret",
            "private_key",
            "credential",
            "sk-secret",
            "private",
        ] {
            assert!(!json.contains(forbidden));
        }

        let metadata = sanitize_provider_metadata(&serde_json::json!({
            "raw_thinking": "private",
            "safe": ["visible", {"password": "secret", "token": "secret"}]
        }));
        let metadata_json = serde_json::to_string(&metadata).expect("metadata json");
        assert!(metadata_json.contains("visible"));
        assert!(!metadata_json.contains("password"));
    }

    #[test]
    fn provider_timeout_parse_and_unavailable_errors_are_structured_and_safe() {
        for kind in [
            OllamaRuntimeErrorKind::TimeoutBeforeFirstChunk,
            OllamaRuntimeErrorKind::TimeoutDuringStream,
            OllamaRuntimeErrorKind::StreamParseError,
            OllamaRuntimeErrorKind::RuntimeUnavailable,
            OllamaRuntimeErrorKind::DoneReasonLength,
            OllamaRuntimeErrorKind::ProviderRejectedThink,
        ] {
            let payload = LoomServiceErrorPayload {
                code: format!("{kind:?}").to_ascii_uppercase(),
                message: "Provider failed safely.".to_string(),
                kind,
                retryable: true,
                correlation_id: "provider-test".to_string(),
                details: serde_json::json!({
                    "doneReason": if kind == OllamaRuntimeErrorKind::DoneReasonLength {
                        Some("length")
                    } else {
                        None
                    }
                }),
            };
            let json = serde_json::to_string(&payload).expect("serialize payload");

            assert!(!json.contains("raw_thinking"));
            assert!(!json.contains("thinking_text"));
            assert!(!json.contains("chain_of_thought"));
            assert!(!json.contains("hidden_reasoning"));
        }
    }

    // ------------------------------------------------------------------
    // OllamaWireChunk error field (Ollama error stream chunk support)
    // ------------------------------------------------------------------

    #[test]
    fn wire_chunk_with_error_field_parses_correctly() {
        let chunk: OllamaWireChunk =
            serde_json::from_str(r#"{"error":"model not found"}"#).expect("valid error chunk");
        assert_eq!(chunk.error.as_deref(), Some("model not found"));
        assert!(chunk.message.is_none());
        assert!(chunk.response.is_none());
        assert!(!chunk.done);
    }

    #[test]
    fn wire_chunk_without_error_field_parses_correctly() {
        let chunk: OllamaWireChunk =
            serde_json::from_str(r#"{"message":{"content":"hello"},"done":false}"#)
                .expect("valid content chunk");
        assert!(chunk.error.is_none());
        assert_eq!(
            chunk.message.as_ref().and_then(|m| m.content.as_deref()),
            Some("hello")
        );
    }

    #[test]
    fn wire_chunk_final_done_has_no_error() {
        let chunk: OllamaWireChunk =
            serde_json::from_str(r#"{"done":true,"total_duration":12345}"#)
                .expect("valid final chunk");
        assert!(chunk.error.is_none());
        assert!(chunk.done);
    }
}
