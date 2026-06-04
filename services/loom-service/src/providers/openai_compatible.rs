#![allow(dead_code)]

use crate::{
    error::ServiceError,
    providers::config::{
        normalize_provider_request_options, validate_provider_profiles,
        NormalizedProviderRequestOptions, ProviderKind, ProviderModelDiscoveryResult,
        ProviderProfileConfig, ProviderRequestNormalizationInput,
    },
    providers::types::{provider_error_kind_from_http_status, ProviderError, ProviderErrorKind},
};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fmt, time::Duration};

const FORBIDDEN_REASONING_KEYS: [&str; 5] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "reasoning",
];

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleRuntime {
    client: Option<Client>,
    profile: ProviderProfileConfig,
    secret: Option<OpenAiCompatibleSecret>,
    init_error: Option<OpenAiCompatibleRuntimeError>,
}

#[derive(Clone)]
pub struct OpenAiCompatibleSecret {
    authorization_header_value: String,
}

impl fmt::Debug for OpenAiCompatibleSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OpenAiCompatibleSecret")
            .field("authorization_header_value", &"<redacted>")
            .finish()
    }
}

impl OpenAiCompatibleSecret {
    #[allow(dead_code)]
    pub fn bearer(value: impl Into<String>) -> Self {
        Self {
            authorization_header_value: format!("Bearer {}", value.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpenAiCompatibleRuntimeErrorKind {
    InvalidConfig,
    MissingSecret,
    Unauthorized,
    Forbidden,
    RateLimited,
    ContextTooLarge,
    EndpointNotFound,
    ModelMissing,
    ProviderUnavailable,
    ProviderError,
    RequestTimeout,
    StreamParseError,
    MalformedResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleRuntimeError {
    pub kind: OpenAiCompatibleRuntimeErrorKind,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl OpenAiCompatibleRuntimeError {
    pub fn new(
        kind: OpenAiCompatibleRuntimeErrorKind,
        message: impl Into<String>,
        retryable: bool,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            retryable,
            status: None,
        }
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }

    pub fn to_provider_error(
        &self,
        provider_id: Option<&str>,
        model: Option<&str>,
    ) -> ProviderError {
        let mut error = ProviderError::new(
            self.kind.to_provider_error_kind(),
            ProviderKind::OpenAiCompatible,
        )
        .with_status_code(self.status)
        .with_technical_message(self.message.clone())
        .with_model(model.map(str::to_string));
        if let Some(provider_id) = provider_id {
            error = error.with_provider_id(provider_id);
        }
        error
    }
}

impl OpenAiCompatibleRuntimeErrorKind {
    pub fn to_provider_error_kind(&self) -> ProviderErrorKind {
        match self {
            Self::InvalidConfig => ProviderErrorKind::InvalidConfig,
            Self::MissingSecret => ProviderErrorKind::MissingSecret,
            Self::Unauthorized => ProviderErrorKind::Unauthorized,
            Self::Forbidden => ProviderErrorKind::Forbidden,
            Self::RateLimited => ProviderErrorKind::RateLimited,
            Self::ContextTooLarge => ProviderErrorKind::ContextTooLarge,
            Self::EndpointNotFound => ProviderErrorKind::EndpointNotFound,
            Self::ModelMissing => ProviderErrorKind::ModelMissing,
            Self::ProviderUnavailable => ProviderErrorKind::ServiceUnavailable,
            Self::ProviderError => ProviderErrorKind::ProviderError,
            Self::RequestTimeout => ProviderErrorKind::RequestTimeout,
            Self::StreamParseError => ProviderErrorKind::StreamParseError,
            Self::MalformedResponse => ProviderErrorKind::InvalidResponse,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleHealthResponse {
    pub status: String,
    pub provider_kind: ProviderKind,
    pub provider_profile_id: String,
    pub base_url: Option<String>,
    pub models_endpoint_reachable: bool,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleModelsResponse {
    pub models: Vec<String>,
    pub discovery: ProviderModelDiscoveryResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OpenAiCompatibleMessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenAiCompatibleMessage {
    pub role: OpenAiCompatibleMessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleChatInput {
    pub model: Option<String>,
    pub messages: Vec<OpenAiCompatibleMessage>,
    pub output_budget: Option<u32>,
    pub context_budget: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub stream: Option<bool>,
    pub quick_ask: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleChatResponse {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenAiCompatibleSseEvent {
    pub deltas: Vec<String>,
    pub done: bool,
    pub done_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiModelsEnvelope {
    data: Vec<OpenAiModelRecord>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiModelRecord {
    id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiChatEnvelope {
    choices: Vec<OpenAiChatChoice>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiChatChoice {
    message: Option<OpenAiChatMessage>,
    delta: Option<OpenAiChatMessage>,
    finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiChatMessage {
    content: Option<String>,
}

impl OpenAiCompatibleRuntime {
    pub fn new(profile: ProviderProfileConfig, secret: Option<OpenAiCompatibleSecret>) -> Self {
        let init_result = validate_openai_compatible_profile(&profile).and_then(|_| {
            Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| {
                    OpenAiCompatibleRuntimeError::new(
                        OpenAiCompatibleRuntimeErrorKind::InvalidConfig,
                        "OpenAI-compatible HTTP client could not be initialized.",
                        false,
                    )
                })
        });

        let (client, init_error) = match init_result {
            Ok(client) => (Some(client), None),
            Err(error) => (None, Some(error)),
        };

        Self {
            client,
            profile,
            secret,
            init_error,
        }
    }

    pub fn profile(&self) -> &ProviderProfileConfig {
        &self.profile
    }

    pub async fn health(&self) -> OpenAiCompatibleHealthResponse {
        if let Some(error) = self.init_error.clone() {
            return self.health_response("invalid_config", false, Some(error.message), vec![]);
        }
        if let Err(error) = self.ensure_secret_available() {
            return self.health_response("missing_secret", false, Some(error.message), vec![]);
        }

        match self.models().await {
            Ok(_) => self.health_response("ready", true, None, vec![]),
            Err(error) => {
                let status = match error.kind {
                    OpenAiCompatibleRuntimeErrorKind::Unauthorized => "unauthorized",
                    OpenAiCompatibleRuntimeErrorKind::MissingSecret => "missing_secret",
                    OpenAiCompatibleRuntimeErrorKind::InvalidConfig => "invalid_config",
                    OpenAiCompatibleRuntimeErrorKind::RateLimited => "degraded",
                    OpenAiCompatibleRuntimeErrorKind::ProviderUnavailable
                    | OpenAiCompatibleRuntimeErrorKind::RequestTimeout => "unavailable",
                    _ => "degraded",
                };
                self.health_response(status, false, Some(error.message), vec![])
            }
        }
    }

    pub async fn models(
        &self,
    ) -> Result<OpenAiCompatibleModelsResponse, OpenAiCompatibleRuntimeError> {
        self.ensure_secret_available()?;
        let client = self.client()?;
        let response = client
            .get(self.models_url()?)
            .headers(self.auth_headers())
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(classify_status(
                status,
                "OpenAI-compatible model discovery failed.",
            ));
        }
        let envelope = response.json::<OpenAiModelsEnvelope>().await.map_err(|_| {
            OpenAiCompatibleRuntimeError::new(
                OpenAiCompatibleRuntimeErrorKind::MalformedResponse,
                "OpenAI-compatible model discovery returned malformed metadata.",
                true,
            )
        })?;
        let models = model_ids_from_envelope(envelope);
        Ok(OpenAiCompatibleModelsResponse {
            discovery: ProviderModelDiscoveryResult {
                provider_profile_id: self.profile.id.clone(),
                provider_kind: ProviderKind::OpenAiCompatible,
                source: "provider_discovery".to_string(),
                models: models.clone(),
                warnings: Vec::new(),
            },
            models,
        })
    }

    pub async fn chat_completion(
        &self,
        input: OpenAiCompatibleChatInput,
    ) -> Result<OpenAiCompatibleChatResponse, OpenAiCompatibleRuntimeError> {
        self.ensure_secret_available()?;
        let client = self.client()?;
        let normalized = normalize_provider_request_options(
            &self.profile,
            ProviderRequestNormalizationInput {
                model: input.model,
                output_budget: input.output_budget,
                context_budget: input.context_budget,
                temperature: input.temperature,
                top_p: input.top_p,
                think: Some(false),
                stream: input.stream,
                quick_ask: input.quick_ask,
            },
        )
        .map_err(config_to_runtime_error)?;
        let body = build_chat_body(&normalized, &input.messages, false);
        let response = client
            .post(self.chat_url()?)
            .headers(self.auth_headers())
            .json(&body)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(classify_status(
                status,
                "OpenAI-compatible chat request failed.",
            ));
        }
        let value = response.json::<Value>().await.map_err(|_| {
            OpenAiCompatibleRuntimeError::new(
                OpenAiCompatibleRuntimeErrorKind::MalformedResponse,
                "OpenAI-compatible chat response was malformed.",
                true,
            )
        })?;
        parse_chat_response_value(value)
    }

    pub async fn post_chat_stream(
        &self,
        input: OpenAiCompatibleChatInput,
    ) -> Result<reqwest::Response, OpenAiCompatibleRuntimeError> {
        self.ensure_secret_available()?;
        let client = self.client()?;
        let normalized = normalize_provider_request_options(
            &self.profile,
            ProviderRequestNormalizationInput {
                model: input.model,
                output_budget: input.output_budget,
                context_budget: input.context_budget,
                temperature: input.temperature,
                top_p: input.top_p,
                think: Some(false),
                stream: input.stream.or(Some(true)),
                quick_ask: input.quick_ask,
            },
        )
        .map_err(config_to_runtime_error)?;
        let body = build_chat_body(&normalized, &input.messages, true);
        let response = client
            .post(self.chat_url()?)
            .headers(self.auth_headers())
            .json(&body)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(classify_status(
                status,
                "OpenAI-compatible chat request failed.",
            ));
        }
        Ok(response)
    }

    fn health_response(
        &self,
        status: impl Into<String>,
        models_endpoint_reachable: bool,
        reason: Option<String>,
        warnings: Vec<String>,
    ) -> OpenAiCompatibleHealthResponse {
        OpenAiCompatibleHealthResponse {
            status: status.into(),
            provider_kind: ProviderKind::OpenAiCompatible,
            provider_profile_id: self.profile.id.clone(),
            base_url: self.safe_base_url_display(),
            models_endpoint_reachable,
            warnings,
            reason,
        }
    }

    fn client(&self) -> Result<&Client, OpenAiCompatibleRuntimeError> {
        self.client.as_ref().ok_or_else(|| {
            self.init_error.clone().unwrap_or_else(|| {
                OpenAiCompatibleRuntimeError::new(
                    OpenAiCompatibleRuntimeErrorKind::InvalidConfig,
                    "OpenAI-compatible provider is not configured.",
                    false,
                )
            })
        })
    }

    fn ensure_secret_available(&self) -> Result<(), OpenAiCompatibleRuntimeError> {
        if self.profile.requires_secret && self.secret.is_none() {
            return Err(OpenAiCompatibleRuntimeError::new(
                OpenAiCompatibleRuntimeErrorKind::MissingSecret,
                "OpenAI-compatible provider requires a secret reference that is not available.",
                false,
            ));
        }
        Ok(())
    }

    fn auth_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(secret) = &self.secret {
            if let Ok(value) =
                reqwest::header::HeaderValue::from_str(&secret.authorization_header_value)
            {
                headers.insert(reqwest::header::AUTHORIZATION, value);
            }
        }
        headers
    }

    fn models_url(&self) -> Result<Url, OpenAiCompatibleRuntimeError> {
        let endpoint = self
            .profile
            .model_discovery
            .endpoint_path
            .as_deref()
            .unwrap_or("/v1/models");
        let endpoint = if endpoint == "/api/tags" {
            "/v1/models"
        } else {
            endpoint
        };
        self.url_for_path(endpoint)
    }

    fn chat_url(&self) -> Result<Url, OpenAiCompatibleRuntimeError> {
        self.url_for_path("/v1/chat/completions")
    }

    fn url_for_path(&self, path: &str) -> Result<Url, OpenAiCompatibleRuntimeError> {
        let base_url = self.profile.base_url.as_deref().ok_or_else(|| {
            OpenAiCompatibleRuntimeError::new(
                OpenAiCompatibleRuntimeErrorKind::InvalidConfig,
                "OpenAI-compatible provider requires a base URL.",
                false,
            )
        })?;
        join_openai_path(base_url, path)
    }

    fn safe_base_url_display(&self) -> Option<String> {
        let base_url = self.profile.base_url.as_deref()?;
        Url::parse(base_url).ok().map(|url| {
            let host = url.host_str().unwrap_or("unknown-host");
            let port = url
                .port()
                .map(|port| format!(":{port}"))
                .unwrap_or_default();
            let path = url.path().trim_end_matches('/');
            format!("{}://{}{}{}", url.scheme(), host, port, path)
        })
    }
}

pub fn validate_openai_compatible_profile(
    profile: &ProviderProfileConfig,
) -> Result<(), OpenAiCompatibleRuntimeError> {
    if profile.provider_kind != ProviderKind::OpenAiCompatible {
        return Err(OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::InvalidConfig,
            "OpenAI-compatible runtime requires an openai_compatible provider profile.",
            false,
        ));
    }
    validate_provider_profiles(std::slice::from_ref(profile)).map_err(config_to_runtime_error)
}

fn config_to_runtime_error(error: ServiceError) -> OpenAiCompatibleRuntimeError {
    OpenAiCompatibleRuntimeError::new(
        OpenAiCompatibleRuntimeErrorKind::InvalidConfig,
        error.to_string(),
        false,
    )
}

pub fn build_chat_body(
    normalized: &NormalizedProviderRequestOptions,
    messages: &[OpenAiCompatibleMessage],
    force_stream: bool,
) -> Value {
    let mut body = json!({
        "model": normalized.model,
        "messages": messages,
        "stream": force_stream || normalized.stream,
    });
    if let Some(max_tokens) = normalized.max_output_tokens {
        body["max_tokens"] = json!(max_tokens);
    }
    if let Some(temperature) = normalized.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(top_p) = normalized.top_p {
        body["top_p"] = json!(top_p);
    }
    body
}

pub fn parse_openai_compatible_sse(
    payload: &str,
) -> Result<Vec<String>, OpenAiCompatibleRuntimeError> {
    let mut deltas = Vec::new();
    for line in payload
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            return Ok(deltas);
        }
        let value: Value = serde_json::from_str(data).map_err(|_| {
            OpenAiCompatibleRuntimeError::new(
                OpenAiCompatibleRuntimeErrorKind::StreamParseError,
                "OpenAI-compatible stream chunk was malformed.",
                true,
            )
        })?;
        if contains_forbidden_reasoning_key(&value) {
            continue;
        }
        let envelope: OpenAiChatEnvelope = serde_json::from_value(value).map_err(|_| {
            OpenAiCompatibleRuntimeError::new(
                OpenAiCompatibleRuntimeErrorKind::StreamParseError,
                "OpenAI-compatible stream chunk shape was unsupported.",
                true,
            )
        })?;
        for choice in envelope.choices {
            if let Some(content) = choice.delta.and_then(|message| message.content) {
                deltas.push(content);
            }
        }
    }
    Err(OpenAiCompatibleRuntimeError::new(
        OpenAiCompatibleRuntimeErrorKind::StreamParseError,
        "OpenAI-compatible stream ended without a done marker.",
        true,
    ))
}

pub fn parse_openai_compatible_sse_event(
    payload: &str,
) -> Result<OpenAiCompatibleSseEvent, OpenAiCompatibleRuntimeError> {
    let mut deltas = Vec::new();
    let mut done = false;
    let mut done_reason = None;
    for line in payload
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            done = true;
            continue;
        }
        let value: Value = serde_json::from_str(data).map_err(|_| {
            OpenAiCompatibleRuntimeError::new(
                OpenAiCompatibleRuntimeErrorKind::StreamParseError,
                "OpenAI-compatible stream chunk was malformed.",
                true,
            )
        })?;
        if contains_forbidden_reasoning_key(&value) {
            continue;
        }
        let envelope: OpenAiChatEnvelope = serde_json::from_value(value).map_err(|_| {
            OpenAiCompatibleRuntimeError::new(
                OpenAiCompatibleRuntimeErrorKind::StreamParseError,
                "OpenAI-compatible stream chunk shape was unsupported.",
                true,
            )
        })?;
        for choice in envelope.choices {
            if let Some(content) = choice.delta.and_then(|message| message.content) {
                deltas.push(content);
            }
            if done_reason.is_none() {
                done_reason = choice.finish_reason;
            }
        }
    }
    Ok(OpenAiCompatibleSseEvent {
        deltas,
        done,
        done_reason,
    })
}

fn parse_chat_response_value(
    value: Value,
) -> Result<OpenAiCompatibleChatResponse, OpenAiCompatibleRuntimeError> {
    let reasoning_sanitized = contains_forbidden_reasoning_key(&value);
    let envelope: OpenAiChatEnvelope = serde_json::from_value(value).map_err(|_| {
        OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::MalformedResponse,
            "OpenAI-compatible chat response shape was unsupported.",
            true,
        )
    })?;
    let mut content = String::new();
    let mut finish_reason = None;
    for choice in envelope.choices {
        if let Some(message_content) = choice.message.and_then(|message| message.content) {
            content.push_str(&message_content);
        }
        if finish_reason.is_none() {
            finish_reason = choice.finish_reason;
        }
    }
    if content.is_empty() {
        return Err(OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::MalformedResponse,
            "OpenAI-compatible chat response did not include visible assistant content.",
            true,
        ));
    }
    let warnings = if reasoning_sanitized {
        vec!["reasoning_fields_sanitized".to_string()]
    } else {
        Vec::new()
    };
    Ok(OpenAiCompatibleChatResponse {
        content,
        finish_reason,
        warnings,
    })
}

pub fn parse_openai_models_response_value(
    value: Value,
) -> Result<Vec<String>, OpenAiCompatibleRuntimeError> {
    let envelope: OpenAiModelsEnvelope = serde_json::from_value(value).map_err(|_| {
        OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::MalformedResponse,
            "OpenAI-compatible model discovery returned malformed metadata.",
            true,
        )
    })?;
    Ok(model_ids_from_envelope(envelope))
}

fn model_ids_from_envelope(envelope: OpenAiModelsEnvelope) -> Vec<String> {
    envelope
        .data
        .into_iter()
        .map(|model| model.id)
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>()
}

fn join_openai_path(base_url: &str, path: &str) -> Result<Url, OpenAiCompatibleRuntimeError> {
    let base = Url::parse(base_url).map_err(|_| {
        OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::InvalidConfig,
            "OpenAI-compatible base URL is invalid.",
            false,
        )
    })?;
    let target_path = path.trim_start_matches('/');
    let mut base_path = base.path().trim_end_matches('/').to_string();
    let target_without_v1 = target_path.strip_prefix("v1/").unwrap_or(target_path);
    if base_path.ends_with("/v1") || base_path == "/v1" {
        base_path = format!("{base_path}/{target_without_v1}");
    } else if base_path.is_empty() || base_path == "/" {
        base_path = format!("/{target_path}");
    } else {
        base_path = format!("{base_path}/{target_path}");
    }
    let mut url = base;
    url.set_path(&base_path);
    url.set_query(None);
    Ok(url)
}

fn classify_status(status: StatusCode, message: &'static str) -> OpenAiCompatibleRuntimeError {
    let kind = match provider_error_kind_from_http_status(status.as_u16(), "", false) {
        ProviderErrorKind::Unauthorized | ProviderErrorKind::AuthRequired => {
            OpenAiCompatibleRuntimeErrorKind::Unauthorized
        }
        ProviderErrorKind::Forbidden => OpenAiCompatibleRuntimeErrorKind::Forbidden,
        ProviderErrorKind::RateLimited | ProviderErrorKind::QuotaExceeded => {
            OpenAiCompatibleRuntimeErrorKind::RateLimited
        }
        ProviderErrorKind::ContextTooLarge => OpenAiCompatibleRuntimeErrorKind::ContextTooLarge,
        ProviderErrorKind::EndpointNotFound => OpenAiCompatibleRuntimeErrorKind::EndpointNotFound,
        ProviderErrorKind::ModelMissing => OpenAiCompatibleRuntimeErrorKind::ModelMissing,
        ProviderErrorKind::ServiceUnavailable => {
            OpenAiCompatibleRuntimeErrorKind::ProviderUnavailable
        }
        ProviderErrorKind::RequestTimeout => OpenAiCompatibleRuntimeErrorKind::RequestTimeout,
        _ => OpenAiCompatibleRuntimeErrorKind::ProviderError,
    };
    let retryable = matches!(
        kind,
        OpenAiCompatibleRuntimeErrorKind::RateLimited
            | OpenAiCompatibleRuntimeErrorKind::ProviderUnavailable
            | OpenAiCompatibleRuntimeErrorKind::ProviderError
    );
    OpenAiCompatibleRuntimeError::new(kind, message, retryable).with_status(status.as_u16())
}

fn map_reqwest_error(error: reqwest::Error) -> OpenAiCompatibleRuntimeError {
    if error.is_timeout() {
        OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::RequestTimeout,
            "OpenAI-compatible provider request timed out.",
            true,
        )
    } else if error.is_connect() {
        OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::ProviderUnavailable,
            "OpenAI-compatible provider is not reachable.",
            true,
        )
    } else {
        OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::ProviderError,
            "OpenAI-compatible provider request failed.",
            true,
        )
    }
}

fn contains_forbidden_reasoning_key(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, value)| {
            FORBIDDEN_REASONING_KEYS
                .iter()
                .any(|forbidden| key.eq_ignore_ascii_case(forbidden))
                || contains_forbidden_reasoning_key(value)
        }),
        Value::Array(values) => values.iter().any(contains_forbidden_reasoning_key),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn openai_profile(base_url: &str) -> ProviderProfileConfig {
        ProviderProfileConfig {
            id: "openai-compatible-test".to_string(),
            provider_kind: ProviderKind::OpenAiCompatible,
            transport_kind: crate::providers::config::ProviderTransportKind::NativeOpenAiCompatible,
            vendor: crate::providers::config::ProviderVendor::Custom,
            display_name: "OpenAI Compatible Test".to_string(),
            enabled: true,
            experimental: false,
            base_url: Some(base_url.to_string()),
            default_model: Some("test-model".to_string()),
            requires_secret: false,
            secret_ref: None,
            model_discovery: crate::providers::config::ProviderModelDiscoveryConfig {
                enabled: true,
                endpoint_path: Some("/v1/models".to_string()),
                refresh_interval_seconds: Some(300),
            },
            request_defaults: crate::providers::config::ProviderRequestDefaultsConfig {
                temperature: Some(0.2),
                top_p: Some(0.9),
                num_ctx: Some(4096),
                num_predict: Some(512),
                think: Some(false),
                stream: Some(false),
            },
            security: crate::providers::config::ProviderSecurityPolicyConfig {
                local_only_required: false,
                allow_remote_endpoint: true,
                allow_insecure_http_remote: false,
                allow_unsafe_model_management: false,
            },
            capabilities: crate::providers::config::ProviderCapabilitiesConfig {
                supports_streaming: true,
                supports_cancellation: false,
                supports_model_listing: true,
                supports_thinking: false,
                supports_system_prompt: true,
                supports_json_mode: Some(true),
            },
            metadata_json: None,
        }
    }

    #[test]
    fn valid_local_openai_compatible_base_url_is_accepted() {
        let profile = openai_profile("http://127.0.0.1:8080");

        validate_openai_compatible_profile(&profile).expect("valid local profile");
    }

    #[test]
    fn valid_https_remote_base_url_is_accepted_when_policy_allows() {
        let profile = openai_profile("https://provider.example.test");

        validate_openai_compatible_profile(&profile).expect("valid https profile");
    }

    #[test]
    fn http_remote_base_url_requires_explicit_insecure_policy() {
        let mut profile = openai_profile("http://provider.example.test");
        assert!(validate_openai_compatible_profile(&profile).is_err());

        profile.security.allow_insecure_http_remote = true;
        validate_openai_compatible_profile(&profile).expect("explicit insecure remote allowed");
    }

    #[test]
    fn invalid_or_missing_base_url_returns_invalid_config() {
        let invalid = openai_profile("not a url");
        let error = validate_openai_compatible_profile(&invalid).expect_err("invalid config");
        assert_eq!(error.kind, OpenAiCompatibleRuntimeErrorKind::InvalidConfig);

        let mut missing = openai_profile("http://127.0.0.1:8080");
        missing.base_url = None;
        let error = validate_openai_compatible_profile(&missing).expect_err("missing baseUrl");
        assert_eq!(error.kind, OpenAiCompatibleRuntimeErrorKind::InvalidConfig);
    }

    #[tokio::test]
    async fn missing_secret_returns_missing_secret_without_leaking_values() {
        let mut profile = openai_profile("http://127.0.0.1:8080");
        profile.id = "nvidia".to_string();
        profile.display_name = "NVIDIA NIM".to_string();
        profile.vendor = crate::providers::config::ProviderVendor::Nvidia;
        profile.enabled = true;
        profile.experimental = true;
        profile.requires_secret = true;
        profile.secret_ref = Some("env:LOOM_TEST_MISSING_NVIDIA_API_KEY".to_string());
        std::env::remove_var("LOOM_TEST_MISSING_NVIDIA_API_KEY");
        let runtime = OpenAiCompatibleRuntime::new(profile, None);

        let health = runtime.health().await;
        let json = serde_json::to_string(&health).expect("health json");

        assert_eq!(health.status, "missing_secret");
        assert_eq!(health.provider_kind, ProviderKind::OpenAiCompatible);
        assert!(!health.models_endpoint_reachable);
        assert_eq!(
            health.reason.as_deref(),
            Some("OpenAI-compatible provider requires a secret reference that is not available.")
        );
        assert!(!json.contains("api_key"));
        assert!(!json.contains("bearer"));
        assert!(!json.contains("password"));
    }

    #[test]
    fn chat_body_maps_openai_parameters_without_think_or_reasoning() {
        let profile = openai_profile("http://127.0.0.1:8080");
        let normalized = normalize_provider_request_options(
            &profile,
            ProviderRequestNormalizationInput {
                model: None,
                output_budget: Some(700),
                context_budget: Some(8192),
                temperature: Some(0.1),
                top_p: Some(0.8),
                think: Some(true),
                stream: Some(false),
                quick_ask: true,
            },
        )
        .expect("normalize");
        let body = build_chat_body(
            &normalized,
            &[OpenAiCompatibleMessage {
                role: OpenAiCompatibleMessageRole::User,
                content: "MCP acilimi nedir?".to_string(),
            }],
            false,
        );
        let body_json = serde_json::to_string(&body).expect("body json");

        assert_eq!(body["max_tokens"], json!(700));
        assert!((body["temperature"].as_f64().unwrap() - 0.1).abs() < 0.0001);
        assert!((body["top_p"].as_f64().unwrap() - 0.8).abs() < 0.0001);
        assert_eq!(body["stream"], json!(false));
        assert!(!body_json.contains("think"));
        assert!(!body_json.contains("reasoning"));
        assert!(!body_json.contains("chain_of_thought"));
    }

    #[test]
    fn model_discovery_parses_v1_models_response() {
        let models = parse_openai_models_response_value(json!({
            "data": [
                {"id": "local-model-a"},
                {"id": "local-model-b"}
            ]
        }))
        .expect("models");

        assert_eq!(models, vec!["local-model-a", "local-model-b"]);
    }

    #[test]
    fn auth_and_rate_limit_statuses_are_classified() {
        let auth_error = classify_status(
            StatusCode::UNAUTHORIZED,
            "OpenAI-compatible model discovery failed.",
        );
        assert_eq!(
            auth_error.kind,
            OpenAiCompatibleRuntimeErrorKind::Unauthorized
        );

        let rate_error = classify_status(
            StatusCode::TOO_MANY_REQUESTS,
            "OpenAI-compatible model discovery failed.",
        );
        assert_eq!(
            rate_error.kind,
            OpenAiCompatibleRuntimeErrorKind::RateLimited
        );

        let context_error = classify_status(
            StatusCode::PAYLOAD_TOO_LARGE,
            "OpenAI-compatible chat request failed.",
        );
        assert_eq!(
            context_error.kind,
            OpenAiCompatibleRuntimeErrorKind::ContextTooLarge
        );
    }

    #[test]
    fn openai_compatible_errors_map_to_shared_provider_taxonomy() {
        let missing_secret = OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::MissingSecret,
            "This provider requires a secret reference.",
            false,
        )
        .to_provider_error(Some("openai-local"), Some("gpt-compatible"));
        assert_eq!(missing_secret.kind, ProviderErrorKind::MissingSecret);
        assert_eq!(missing_secret.provider_kind, ProviderKind::OpenAiCompatible);
        assert_eq!(missing_secret.provider_id.as_deref(), Some("openai-local"));

        let malformed = OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::MalformedResponse,
            "raw_thinking private provider response",
            true,
        )
        .to_provider_error(None, None);
        let json = serde_json::to_string(&malformed).expect("provider error json");
        assert_eq!(malformed.kind, ProviderErrorKind::InvalidResponse);
        assert!(!json.contains("raw_thinking"));
        assert!(!json.contains("private provider response"));
    }

    #[test]
    fn malformed_sse_maps_to_stream_parse_error() {
        let error =
            parse_openai_compatible_sse("data: {not json}\n").expect_err("malformed stream");

        assert_eq!(
            error.kind,
            OpenAiCompatibleRuntimeErrorKind::StreamParseError
        );
    }

    #[test]
    fn valid_sse_extracts_visible_deltas_and_done_marker() {
        let deltas = parse_openai_compatible_sse(
            r#"data: {"choices":[{"delta":{"content":"hel"}}]}
data: {"choices":[{"delta":{"content":"lo"}}]}
data: [DONE]
"#,
        )
        .expect("stream deltas");

        assert_eq!(deltas, vec!["hel", "lo"]);
    }

    #[test]
    fn chat_response_sanitizes_reasoning_fields() {
        let response = parse_chat_response_value(json!({
            "choices": [
                {
                    "message": {
                        "content": "Visible final answer.",
                        "reasoning": "private reasoning",
                        "raw_thinking": "private raw thinking"
                    },
                    "finish_reason": "stop"
                }
            ]
        }))
        .expect("chat response");
        let json = serde_json::to_string(&response).expect("response json");

        assert_eq!(response.content, "Visible final answer.");
        assert!(response
            .warnings
            .contains(&"reasoning_fields_sanitized".to_string()));
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "private reasoning",
        ] {
            assert!(!json.contains(forbidden));
        }
    }

    #[test]
    fn provider_errors_do_not_include_raw_thinking_fields() {
        let error = OpenAiCompatibleRuntimeError::new(
            OpenAiCompatibleRuntimeErrorKind::MalformedResponse,
            "Provider failed safely.",
            true,
        );
        let json = serde_json::to_string(&error).expect("error json");

        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(!json.contains(forbidden));
        }
    }

    #[test]
    fn joining_base_url_with_v1_does_not_duplicate_v1() {
        let url = join_openai_path("http://127.0.0.1:8080/v1", "/v1/models").expect("url");

        assert_eq!(url.as_str(), "http://127.0.0.1:8080/v1/models");
    }
}
