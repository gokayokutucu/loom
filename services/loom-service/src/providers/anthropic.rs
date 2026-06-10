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

#[derive(Debug, Clone)]
pub struct AnthropicRuntime {
    client: Option<Client>,
    profile: ProviderProfileConfig,
    secret: Option<AnthropicSecret>,
    init_error: Option<AnthropicRuntimeError>,
}

#[derive(Clone)]
pub struct AnthropicSecret {
    api_key: String,
}

impl fmt::Debug for AnthropicSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AnthropicSecret")
            .field("api_key", &"<redacted>")
            .finish()
    }
}

impl AnthropicSecret {
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            api_key: value.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnthropicRuntimeErrorKind {
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
pub struct AnthropicRuntimeError {
    pub kind: AnthropicRuntimeErrorKind,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl AnthropicRuntimeError {
    pub fn new(
        kind: AnthropicRuntimeErrorKind,
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
        let mut error =
            ProviderError::new(self.kind.to_provider_error_kind(), ProviderKind::Anthropic)
                .with_status_code(self.status)
                .with_technical_message(self.message.clone())
                .with_model(model.map(str::to_string));
        if let Some(provider_id) = provider_id {
            error = error.with_provider_id(provider_id);
        }
        error
    }
}

impl AnthropicRuntimeErrorKind {
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
pub struct AnthropicHealthResponse {
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
pub struct AnthropicModelsResponse {
    pub models: Vec<String>,
    pub discovery: ProviderModelDiscoveryResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnthropicMessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnthropicMessage {
    pub role: AnthropicMessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnthropicChatInput {
    pub model: Option<String>,
    pub messages: Vec<AnthropicMessage>,
    pub system: Option<String>,
    pub output_budget: Option<u32>,
    pub context_budget: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub stream: Option<bool>,
    pub quick_ask: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnthropicSseEvent {
    pub delta_text: Option<String>,
    pub done: bool,
    pub done_reason: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicModelsEnvelope {
    data: Vec<AnthropicModelRecord>,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicModelRecord {
    id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicErrorResponse {
    error: AnthropicErrorRecord,
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicErrorRecord {
    message: String,
    #[serde(rename = "type")]
    error_type: Option<String>,
}

impl AnthropicRuntime {
    pub fn new(profile: ProviderProfileConfig, secret: Option<AnthropicSecret>) -> Self {
        let init_result = validate_anthropic_profile(&profile).and_then(|_| {
            Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| {
                    AnthropicRuntimeError::new(
                        AnthropicRuntimeErrorKind::InvalidConfig,
                        "Anthropic HTTP client could not be initialized.",
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

    pub async fn health(&self) -> AnthropicHealthResponse {
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
                    AnthropicRuntimeErrorKind::Unauthorized => "unauthorized",
                    AnthropicRuntimeErrorKind::MissingSecret => "missing_secret",
                    AnthropicRuntimeErrorKind::InvalidConfig => "invalid_config",
                    AnthropicRuntimeErrorKind::RateLimited => "degraded",
                    AnthropicRuntimeErrorKind::ProviderUnavailable
                    | AnthropicRuntimeErrorKind::RequestTimeout => "unavailable",
                    _ => "degraded",
                };
                self.health_response(status, false, Some(error.message), vec![])
            }
        }
    }

    pub async fn models(&self) -> Result<AnthropicModelsResponse, AnthropicRuntimeError> {
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
            let err_msg = if let Ok(err_payload) = response.json::<AnthropicErrorResponse>().await {
                err_payload.error.message
            } else {
                "Anthropic model discovery failed.".to_string()
            };
            return Err(classify_status(status, &err_msg));
        }
        let envelope = response
            .json::<AnthropicModelsEnvelope>()
            .await
            .map_err(|_| {
                AnthropicRuntimeError::new(
                    AnthropicRuntimeErrorKind::MalformedResponse,
                    "Anthropic model discovery returned malformed metadata.",
                    true,
                )
            })?;
        let models = model_ids_from_envelope(envelope);
        Ok(AnthropicModelsResponse {
            discovery: ProviderModelDiscoveryResult {
                provider_profile_id: self.profile.id.clone(),
                provider_kind: ProviderKind::Anthropic,
                source: "provider_discovery".to_string(),
                models: models.clone(),
                warnings: Vec::new(),
            },
            models,
        })
    }

    pub async fn post_messages_stream(
        &self,
        input: AnthropicChatInput,
    ) -> Result<reqwest::Response, AnthropicRuntimeError> {
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
        let body = build_messages_body(&normalized, &input.messages, input.system.as_deref(), true);
        let response = client
            .post(self.chat_url()?)
            .headers(self.auth_headers())
            .json(&body)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        if !status.is_success() {
            let err_msg = if let Ok(err_payload) = response.json::<AnthropicErrorResponse>().await {
                err_payload.error.message
            } else {
                "Anthropic chat request failed.".to_string()
            };
            return Err(classify_status(status, &err_msg));
        }
        Ok(response)
    }

    fn health_response(
        &self,
        status: impl Into<String>,
        models_endpoint_reachable: bool,
        reason: Option<String>,
        warnings: Vec<String>,
    ) -> AnthropicHealthResponse {
        AnthropicHealthResponse {
            status: status.into(),
            provider_kind: ProviderKind::Anthropic,
            provider_profile_id: self.profile.id.clone(),
            base_url: self.safe_base_url_display(),
            models_endpoint_reachable,
            warnings,
            reason,
        }
    }

    fn client(&self) -> Result<&Client, AnthropicRuntimeError> {
        self.client.as_ref().ok_or_else(|| {
            self.init_error.clone().unwrap_or_else(|| {
                AnthropicRuntimeError::new(
                    AnthropicRuntimeErrorKind::InvalidConfig,
                    "Anthropic provider is not configured.",
                    false,
                )
            })
        })
    }

    fn ensure_secret_available(&self) -> Result<(), AnthropicRuntimeError> {
        if self.profile.requires_secret && self.secret.is_none() {
            return Err(AnthropicRuntimeError::new(
                AnthropicRuntimeErrorKind::MissingSecret,
                "Anthropic provider requires a secret reference that is not available.",
                false,
            ));
        }
        Ok(())
    }

    fn auth_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(secret) = &self.secret {
            if let Ok(value) = reqwest::header::HeaderValue::from_str(&secret.api_key) {
                headers.insert("x-api-key", value);
            }
        }
        if let Ok(value) = reqwest::header::HeaderValue::from_str("2023-06-01") {
            headers.insert("anthropic-version", value);
        }
        headers
    }

    fn models_url(&self) -> Result<Url, AnthropicRuntimeError> {
        let endpoint = self
            .profile
            .model_discovery
            .endpoint_path
            .as_deref()
            .unwrap_or("/v1/models");
        self.url_for_path(endpoint)
    }

    fn chat_url(&self) -> Result<Url, AnthropicRuntimeError> {
        self.url_for_path("/v1/messages")
    }

    fn url_for_path(&self, path: &str) -> Result<Url, AnthropicRuntimeError> {
        let base_url = self.profile.base_url.as_deref().ok_or_else(|| {
            AnthropicRuntimeError::new(
                AnthropicRuntimeErrorKind::InvalidConfig,
                "Anthropic provider requires a base URL.",
                false,
            )
        })?;
        join_anthropic_path(base_url, path)
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

pub fn validate_anthropic_profile(
    profile: &ProviderProfileConfig,
) -> Result<(), AnthropicRuntimeError> {
    if profile.provider_kind != ProviderKind::Anthropic {
        return Err(AnthropicRuntimeError::new(
            AnthropicRuntimeErrorKind::InvalidConfig,
            "Anthropic runtime requires an anthropic provider profile.",
            false,
        ));
    }
    validate_provider_profiles(std::slice::from_ref(profile)).map_err(config_to_runtime_error)
}

fn config_to_runtime_error(error: ServiceError) -> AnthropicRuntimeError {
    AnthropicRuntimeError::new(
        AnthropicRuntimeErrorKind::InvalidConfig,
        error.to_string(),
        false,
    )
}

pub fn build_messages_body(
    normalized: &NormalizedProviderRequestOptions,
    messages: &[AnthropicMessage],
    system: Option<&str>,
    force_stream: bool,
) -> Value {
    let stream_active = force_stream || normalized.stream;
    let mut body = json!({
        "model": normalized.model,
        "messages": messages,
        "stream": stream_active,
    });

    // Anthropic Messages API requires max_tokens to be provided
    let max_tokens = normalized.max_output_tokens.unwrap_or(1024);
    body["max_tokens"] = json!(max_tokens);

    if let Some(system) = system {
        if !system.trim().is_empty() {
            body["system"] = json!(system);
        }
    }
    if let Some(temperature) = normalized.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(top_p) = normalized.top_p {
        body["top_p"] = json!(top_p);
    }
    body
}

pub fn parse_anthropic_sse_event(
    payload: &str,
) -> Result<AnthropicSseEvent, AnthropicRuntimeError> {
    let mut delta_text = None;
    let mut done = false;
    let mut done_reason = None;
    let mut input_tokens = None;
    let mut output_tokens = None;

    let mut current_event = String::new();

    for line in payload
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(event) = line.strip_prefix("event:") {
            current_event = event.trim().to_string();
            continue;
        }
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() {
            continue;
        }

        let value: Value = serde_json::from_str(data).map_err(|_| {
            AnthropicRuntimeError::new(
                AnthropicRuntimeErrorKind::StreamParseError,
                "Anthropic stream chunk was malformed.",
                true,
            )
        })?;

        match current_event.as_str() {
            "message_start" => {
                if let Some(input) = value
                    .pointer("/message/usage/input_tokens")
                    .and_then(Value::as_u64)
                {
                    input_tokens = Some(input);
                }
            }
            "content_block_delta" => {
                if let Some(text) = value.pointer("/delta/text").and_then(Value::as_str) {
                    delta_text = Some(text.to_string());
                }
            }
            "message_delta" => {
                if let Some(output) = value
                    .pointer("/usage/output_tokens")
                    .and_then(Value::as_u64)
                {
                    output_tokens = Some(output);
                }
                if let Some(stop) = value.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    done_reason = Some(stop.to_string());
                }
            }
            "message_stop" => {
                done = true;
            }
            _ => {}
        }
    }

    Ok(AnthropicSseEvent {
        delta_text,
        done,
        done_reason,
        input_tokens,
        output_tokens,
    })
}

fn model_ids_from_envelope(envelope: AnthropicModelsEnvelope) -> Vec<String> {
    envelope
        .data
        .into_iter()
        .map(|model| model.id)
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>()
}

fn join_anthropic_path(base_url: &str, path: &str) -> Result<Url, AnthropicRuntimeError> {
    let base = Url::parse(base_url).map_err(|_| {
        AnthropicRuntimeError::new(
            AnthropicRuntimeErrorKind::InvalidConfig,
            "Anthropic base URL is invalid.",
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

fn classify_status(status: StatusCode, message: &str) -> AnthropicRuntimeError {
    let kind = match provider_error_kind_from_http_status(status.as_u16(), "", false) {
        ProviderErrorKind::Unauthorized | ProviderErrorKind::AuthRequired => {
            AnthropicRuntimeErrorKind::Unauthorized
        }
        ProviderErrorKind::Forbidden => AnthropicRuntimeErrorKind::Forbidden,
        ProviderErrorKind::RateLimited | ProviderErrorKind::QuotaExceeded => {
            AnthropicRuntimeErrorKind::RateLimited
        }
        ProviderErrorKind::ContextTooLarge => AnthropicRuntimeErrorKind::ContextTooLarge,
        ProviderErrorKind::EndpointNotFound => AnthropicRuntimeErrorKind::EndpointNotFound,
        ProviderErrorKind::ModelMissing => AnthropicRuntimeErrorKind::ModelMissing,
        ProviderErrorKind::ServiceUnavailable => AnthropicRuntimeErrorKind::ProviderUnavailable,
        ProviderErrorKind::RequestTimeout => AnthropicRuntimeErrorKind::RequestTimeout,
        _ => AnthropicRuntimeErrorKind::ProviderError,
    };
    let retryable = matches!(
        kind,
        AnthropicRuntimeErrorKind::RateLimited
            | AnthropicRuntimeErrorKind::ProviderUnavailable
            | AnthropicRuntimeErrorKind::ProviderError
    );
    AnthropicRuntimeError::new(kind, message, retryable).with_status(status.as_u16())
}

fn map_reqwest_error(error: reqwest::Error) -> AnthropicRuntimeError {
    if error.is_timeout() {
        AnthropicRuntimeError::new(
            AnthropicRuntimeErrorKind::RequestTimeout,
            "Anthropic provider request timed out.",
            true,
        )
    } else if error.is_connect() {
        AnthropicRuntimeError::new(
            AnthropicRuntimeErrorKind::ProviderUnavailable,
            "Anthropic provider is not reachable.",
            true,
        )
    } else {
        AnthropicRuntimeError::new(
            AnthropicRuntimeErrorKind::ProviderError,
            "Anthropic provider request failed.",
            true,
        )
    }
}

// ----------------- ProviderAdapter Implementation -----------------

use crate::providers::adapter::{ProviderAdapter, ProviderEventStream};
use crate::providers::contract::{
    ProviderContractCapabilities, ProviderContractEvent, ProviderContractMessageRole,
    ProviderContractRequest, ProviderUsageMetadata,
};
use async_stream::stream;
use futures_util::StreamExt;

#[derive(Debug, Clone)]
pub struct AnthropicProviderAdapter {
    runtime: AnthropicRuntime,
    provider_profile_id: String,
}

impl AnthropicProviderAdapter {
    pub fn new(profile: ProviderProfileConfig, secret: Option<String>) -> Self {
        let provider_profile_id = profile.id.clone();
        Self {
            runtime: AnthropicRuntime::new(profile, secret.map(AnthropicSecret::new)),
            provider_profile_id,
        }
    }
}

impl ProviderAdapter for AnthropicProviderAdapter {
    fn provider_kind(&self) -> ProviderKind {
        ProviderKind::Anthropic
    }

    fn provider_profile_id(&self) -> &str {
        &self.provider_profile_id
    }

    fn default_model(&self) -> Option<&str> {
        self.runtime.profile().default_model.as_deref()
    }

    fn capabilities(&self) -> ProviderContractCapabilities {
        let profile = self.runtime.profile();
        ProviderContractCapabilities {
            supports_streaming: profile.capabilities.supports_streaming,
            supports_cancellation: true,
            supports_usage_metadata: true,
            supports_temperature: true,
            supports_top_p: true,
            supports_max_tokens: true,
            supports_system_prompt: profile.capabilities.supports_system_prompt,
            supports_thinking_status: false,
        }
    }

    fn stream_chat(&self, request: ProviderContractRequest) -> ProviderEventStream {
        let adapter = self.clone();
        Box::pin(stream! {
            let model_id = request.model_id.clone();

            // Extract system prompt if any, and filter them out of message history
            let system_prompt = request.messages.iter()
                .filter(|m| m.role == ProviderContractMessageRole::System)
                .map(|m| m.content.clone())
                .collect::<Vec<_>>()
                .join("\n\n");
            let system = if system_prompt.is_empty() { None } else { Some(system_prompt) };

            let filtered_messages = request.messages.iter()
                .filter(|m| m.role != ProviderContractMessageRole::System)
                .map(|m| AnthropicMessage {
                    role: match m.role {
                        ProviderContractMessageRole::User => AnthropicMessageRole::User,
                        ProviderContractMessageRole::Assistant => AnthropicMessageRole::Assistant,
                        ProviderContractMessageRole::System => unreachable!(),
                    },
                    content: m.content.clone(),
                })
                .collect::<Vec<_>>();

            let chat_input = AnthropicChatInput {
                model: Some(request.model_id.clone()),
                messages: filtered_messages,
                system,
                output_budget: request.options.max_tokens,
                context_budget: request.options.context_tokens,
                temperature: request.options.temperature,
                top_p: request.options.top_p,
                stream: Some(request.stream),
                quick_ask: false,
            };

            let response = match adapter.runtime.post_messages_stream(chat_input).await {
                Ok(response) => response,
                Err(error) => {
                    yield ProviderContractEvent::Error {
                        error: error.to_provider_error(Some(&adapter.provider_profile_id), Some(&model_id)),
                    };
                    return;
                }
            };
            let mut bytes_stream = response.bytes_stream();
            let mut buffer = String::new();

            let mut accumulated_prompt_tokens = None;

            while let Some(chunk) = bytes_stream.next().await {
                let bytes = match chunk {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        let error = AnthropicRuntimeError::new(
                            AnthropicRuntimeErrorKind::ProviderError,
                            "Anthropic provider stream failed.",
                            true,
                        );
                        yield ProviderContractEvent::Error {
                            error: error.to_provider_error(Some(&adapter.provider_profile_id), Some(&model_id)),
                        };
                        return;
                    }
                };
                let text = match std::str::from_utf8(&bytes) {
                    Ok(text) => text,
                    Err(_) => {
                        let error = AnthropicRuntimeError::new(
                            AnthropicRuntimeErrorKind::StreamParseError,
                            "Anthropic provider returned non-UTF8 stream data.",
                            true,
                        );
                        yield ProviderContractEvent::Error {
                            error: error.to_provider_error(Some(&adapter.provider_profile_id), Some(&model_id)),
                        };
                        return;
                    }
                };
                buffer.push_str(text);

                // Anthropic streams SSE using standard double newline separator
                while let Some(index) = buffer.find("\n\n") {
                    let event_payload = buffer[..index].to_string();
                    buffer.replace_range(..index + 2, "");
                    if event_payload.trim().is_empty() {
                        continue;
                    }
                    let event = match parse_anthropic_sse_event(&event_payload) {
                        Ok(event) => event,
                        Err(error) => {
                            yield ProviderContractEvent::Error {
                                error: error.to_provider_error(Some(&adapter.provider_profile_id), Some(&model_id)),
                            };
                            return;
                        }
                    };
                    if let Some(tokens) = event.input_tokens {
                        accumulated_prompt_tokens = Some(tokens);
                    }
                    if let Some(delta) = event.delta_text {
                        if !delta.is_empty() {
                            yield ProviderContractEvent::Delta { text: delta };
                        }
                    }
                    if event.done {
                        let usage = match (accumulated_prompt_tokens, event.output_tokens) {
                            (Some(prompt), Some(completion)) => ProviderUsageMetadata::Available {
                                prompt_tokens: Some(prompt),
                                completion_tokens: Some(completion),
                                total_tokens: Some(prompt + completion),
                            },
                            _ => ProviderUsageMetadata::unavailable("provider_did_not_report_usage"),
                        };
                        yield ProviderContractEvent::Completed {
                            done_reason: event.done_reason,
                            usage,
                        };
                        return;
                    }
                }
            }

            yield ProviderContractEvent::Error {
                error: ProviderError::new(
                    ProviderErrorKind::StreamParseError,
                    ProviderKind::Anthropic,
                )
                .with_provider_id(&adapter.provider_profile_id)
                .with_model(Some(model_id))
                .with_technical_message("Anthropic stream closed without a message_stop marker."),
            };
        })
    }

    fn cancel(&self, _request_id: &str) -> bool {
        true
    }
}

// ----------------- Unit Tests -----------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::config::{ProviderTransportKind, ProviderVendor};

    fn anthropic_profile(base_url: &str) -> ProviderProfileConfig {
        ProviderProfileConfig {
            id: "anthropic-native-test".to_string(),
            provider_kind: ProviderKind::Anthropic,
            transport_kind: ProviderTransportKind::Anthropic,
            vendor: ProviderVendor::Anthropic,
            display_name: "Anthropic Native Test".to_string(),
            enabled: true,
            experimental: false,
            base_url: Some(base_url.to_string()),
            default_model: Some("claude-3-5-sonnet-latest".to_string()),
            requires_secret: false,
            secret_ref: None,
            model_discovery: crate::providers::config::ProviderModelDiscoveryConfig {
                enabled: true,
                endpoint_path: Some("/v1/models".to_string()),
                refresh_interval_seconds: Some(300),
            },
            request_defaults: crate::providers::config::ProviderRequestDefaultsConfig {
                temperature: Some(0.2),
                top_p: Some(1.0),
                num_ctx: None,
                num_predict: Some(1024),
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
                supports_cancellation: true,
                supports_model_listing: true,
                supports_thinking: false,
                supports_system_prompt: true,
                supports_json_mode: Some(false),
            },
            metadata_json: None,
        }
    }

    #[test]
    fn test_secret_debug_redacts_api_key() {
        let secret = AnthropicSecret::new("ant-12345");
        let debug_str = format!("{:?}", secret);
        assert!(debug_str.contains("<redacted>"));
        assert!(!debug_str.contains("ant-"));
    }

    #[test]
    fn test_messages_body_mapping() {
        let profile = anthropic_profile("https://api.anthropic.com");
        let normalized = normalize_provider_request_options(
            &profile,
            ProviderRequestNormalizationInput {
                model: None,
                output_budget: Some(2048),
                context_budget: None,
                temperature: Some(0.1),
                top_p: Some(0.9),
                think: Some(false),
                stream: Some(true),
                quick_ask: false,
            },
        )
        .expect("normalize");

        let body = build_messages_body(
            &normalized,
            &[AnthropicMessage {
                role: AnthropicMessageRole::User,
                content: "Hello Claude".to_string(),
            }],
            Some("System Instruction"),
            false,
        );

        assert_eq!(body["model"], "claude-3-5-sonnet-latest");
        assert_eq!(body["max_tokens"], 2048);
        assert_eq!(body["system"], "System Instruction");
        assert!((body["temperature"].as_f64().unwrap() - 0.1).abs() < 0.0001);
        assert!((body["top_p"].as_f64().unwrap() - 0.9).abs() < 0.0001);
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn test_sse_event_parsing() {
        let payload1 = r#"event: message_start
data: {"type": "message_start", "message": {"usage": {"input_tokens": 12}}}"#;
        let event = parse_anthropic_sse_event(payload1).unwrap();
        assert_eq!(event.input_tokens, Some(12));
        assert!(!event.done);

        let payload2 = r#"event: content_block_delta
data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello world"}}"#;
        let event = parse_anthropic_sse_event(payload2).unwrap();
        assert_eq!(event.delta_text.as_deref(), Some("Hello world"));

        let payload3 = r#"event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 25}}"#;
        let event = parse_anthropic_sse_event(payload3).unwrap();
        assert_eq!(event.output_tokens, Some(25));
        assert_eq!(event.done_reason.as_deref(), Some("end_turn"));

        let payload4 = r#"event: message_stop
data: {"type": "message_stop"}"#;
        let event = parse_anthropic_sse_event(payload4).unwrap();
        assert!(event.done);
    }

    #[test]
    fn test_anthropic_error_mapping() {
        let raw_error = AnthropicRuntimeError::new(
            AnthropicRuntimeErrorKind::Unauthorized,
            "Invalid API key.",
            false,
        );
        let provider_error =
            raw_error.to_provider_error(Some("anthropic-native"), Some("claude-3-5-sonnet-latest"));
        assert_eq!(provider_error.kind, ProviderErrorKind::Unauthorized);
        assert_eq!(
            provider_error.provider_id.as_deref(),
            Some("anthropic-native")
        );
        assert_eq!(
            provider_error.model.as_deref(),
            Some("claude-3-5-sonnet-latest")
        );
    }

    #[test]
    fn test_joining_base_url_anthropic() {
        let url = join_anthropic_path("https://api.anthropic.com", "/v1/messages").unwrap();
        assert_eq!(url.as_str(), "https://api.anthropic.com/v1/messages");
    }
}
