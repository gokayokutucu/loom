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
pub struct OpenAiRuntime {
    client: Option<Client>,
    profile: ProviderProfileConfig,
    secret: Option<OpenAiSecret>,
    init_error: Option<OpenAiRuntimeError>,
}

#[derive(Clone)]
pub struct OpenAiSecret {
    api_key: String,
}

impl fmt::Debug for OpenAiSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OpenAiSecret")
            .field("api_key", &"<redacted>")
            .finish()
    }
}

impl OpenAiSecret {
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            api_key: value.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpenAiRuntimeErrorKind {
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
pub struct OpenAiRuntimeError {
    pub kind: OpenAiRuntimeErrorKind,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl OpenAiRuntimeError {
    pub fn new(kind: OpenAiRuntimeErrorKind, message: impl Into<String>, retryable: bool) -> Self {
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
            ProviderError::new(self.kind.to_provider_error_kind(), ProviderKind::OpenAi)
                .with_status_code(self.status)
                .with_technical_message(self.message.clone())
                .with_model(model.map(str::to_string));
        if let Some(provider_id) = provider_id {
            error = error.with_provider_id(provider_id);
        }
        error
    }
}

impl OpenAiRuntimeErrorKind {
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
pub struct OpenAiHealthResponse {
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
pub struct OpenAiModelsResponse {
    pub models: Vec<String>,
    pub discovery: ProviderModelDiscoveryResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OpenAiMessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenAiMessage {
    pub role: OpenAiMessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiChatInput {
    pub model: Option<String>,
    pub messages: Vec<OpenAiMessage>,
    pub output_budget: Option<u32>,
    pub context_budget: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub stream: Option<bool>,
    pub quick_ask: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiChatResponse {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenAiSseEvent {
    pub deltas: Vec<String>,
    pub done: bool,
    pub done_reason: Option<String>,
    pub usage: Option<OpenAiUsageRecord>,
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
    #[serde(default)]
    choices: Vec<OpenAiChatChoice>,
    usage: Option<OpenAiUsageRecord>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct OpenAiUsageRecord {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiChatChoice {
    delta: Option<OpenAiChatMessage>,
    message: Option<OpenAiChatMessage>,
    finish_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiChatMessage {
    content: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiErrorResponse {
    error: OpenAiErrorRecord,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenAiErrorRecord {
    message: String,
    #[serde(rename = "type")]
    error_type: Option<String>,
    code: Option<String>,
}

impl OpenAiRuntime {
    pub fn new(profile: ProviderProfileConfig, secret: Option<OpenAiSecret>) -> Self {
        let init_result = validate_openai_profile(&profile).and_then(|_| {
            Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| {
                    OpenAiRuntimeError::new(
                        OpenAiRuntimeErrorKind::InvalidConfig,
                        "OpenAI HTTP client could not be initialized.",
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

    pub async fn health(&self) -> OpenAiHealthResponse {
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
                    OpenAiRuntimeErrorKind::Unauthorized => "unauthorized",
                    OpenAiRuntimeErrorKind::MissingSecret => "missing_secret",
                    OpenAiRuntimeErrorKind::InvalidConfig => "invalid_config",
                    OpenAiRuntimeErrorKind::RateLimited => "degraded",
                    OpenAiRuntimeErrorKind::ProviderUnavailable
                    | OpenAiRuntimeErrorKind::RequestTimeout => "unavailable",
                    _ => "degraded",
                };
                self.health_response(status, false, Some(error.message), vec![])
            }
        }
    }

    pub async fn models(&self) -> Result<OpenAiModelsResponse, OpenAiRuntimeError> {
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
            let err_msg = if let Ok(err_payload) = response.json::<OpenAiErrorResponse>().await {
                err_payload.error.message
            } else {
                "OpenAI model discovery failed.".to_string()
            };
            return Err(classify_status(status, &err_msg));
        }
        let envelope = response.json::<OpenAiModelsEnvelope>().await.map_err(|_| {
            OpenAiRuntimeError::new(
                OpenAiRuntimeErrorKind::MalformedResponse,
                "OpenAI model discovery returned malformed metadata.",
                true,
            )
        })?;
        let models = model_ids_from_envelope(envelope);
        Ok(OpenAiModelsResponse {
            discovery: ProviderModelDiscoveryResult {
                provider_profile_id: self.profile.id.clone(),
                provider_kind: ProviderKind::OpenAi,
                source: "provider_discovery".to_string(),
                models: models.clone(),
                warnings: Vec::new(),
            },
            models,
        })
    }

    pub async fn post_chat_stream(
        &self,
        input: OpenAiChatInput,
    ) -> Result<reqwest::Response, OpenAiRuntimeError> {
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
            let err_msg = if let Ok(err_payload) = response.json::<OpenAiErrorResponse>().await {
                err_payload.error.message
            } else {
                "OpenAI chat request failed.".to_string()
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
    ) -> OpenAiHealthResponse {
        OpenAiHealthResponse {
            status: status.into(),
            provider_kind: ProviderKind::OpenAi,
            provider_profile_id: self.profile.id.clone(),
            base_url: self.safe_base_url_display(),
            models_endpoint_reachable,
            warnings,
            reason,
        }
    }

    fn client(&self) -> Result<&Client, OpenAiRuntimeError> {
        self.client.as_ref().ok_or_else(|| {
            self.init_error.clone().unwrap_or_else(|| {
                OpenAiRuntimeError::new(
                    OpenAiRuntimeErrorKind::InvalidConfig,
                    "OpenAI provider is not configured.",
                    false,
                )
            })
        })
    }

    fn ensure_secret_available(&self) -> Result<(), OpenAiRuntimeError> {
        if self.profile.requires_secret && self.secret.is_none() {
            return Err(OpenAiRuntimeError::new(
                OpenAiRuntimeErrorKind::MissingSecret,
                "OpenAI provider requires a secret reference that is not available.",
                false,
            ));
        }
        Ok(())
    }

    fn auth_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(secret) = &self.secret {
            if let Ok(value) =
                reqwest::header::HeaderValue::from_str(&format!("Bearer {}", secret.api_key))
            {
                headers.insert(reqwest::header::AUTHORIZATION, value);
            }
        }
        headers
    }

    fn models_url(&self) -> Result<Url, OpenAiRuntimeError> {
        let endpoint = self
            .profile
            .model_discovery
            .endpoint_path
            .as_deref()
            .unwrap_or("/v1/models");
        self.url_for_path(endpoint)
    }

    fn chat_url(&self) -> Result<Url, OpenAiRuntimeError> {
        self.url_for_path("/v1/chat/completions")
    }

    fn url_for_path(&self, path: &str) -> Result<Url, OpenAiRuntimeError> {
        let base_url = self.profile.base_url.as_deref().ok_or_else(|| {
            OpenAiRuntimeError::new(
                OpenAiRuntimeErrorKind::InvalidConfig,
                "OpenAI provider requires a base URL.",
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

pub fn validate_openai_profile(profile: &ProviderProfileConfig) -> Result<(), OpenAiRuntimeError> {
    if profile.provider_kind != ProviderKind::OpenAi {
        return Err(OpenAiRuntimeError::new(
            OpenAiRuntimeErrorKind::InvalidConfig,
            "OpenAI runtime requires an openai provider profile.",
            false,
        ));
    }
    validate_provider_profiles(std::slice::from_ref(profile)).map_err(config_to_runtime_error)
}

fn config_to_runtime_error(error: ServiceError) -> OpenAiRuntimeError {
    OpenAiRuntimeError::new(
        OpenAiRuntimeErrorKind::InvalidConfig,
        error.to_string(),
        false,
    )
}

pub fn build_chat_body(
    normalized: &NormalizedProviderRequestOptions,
    messages: &[OpenAiMessage],
    force_stream: bool,
) -> Value {
    let stream_active = force_stream || normalized.stream;
    let mut body = json!({
        "model": normalized.model,
        "messages": messages,
        "stream": stream_active,
    });
    if stream_active {
        body["stream_options"] = json!({ "include_usage": true });
    }
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

pub fn parse_openai_sse_event(payload: &str) -> Result<OpenAiSseEvent, OpenAiRuntimeError> {
    let mut deltas = Vec::new();
    let mut done = false;
    let mut done_reason = None;
    let mut usage = None;

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
            OpenAiRuntimeError::new(
                OpenAiRuntimeErrorKind::StreamParseError,
                "OpenAI stream chunk was malformed.",
                true,
            )
        })?;

        let envelope: OpenAiChatEnvelope = serde_json::from_value(value).map_err(|_| {
            OpenAiRuntimeError::new(
                OpenAiRuntimeErrorKind::StreamParseError,
                "OpenAI stream chunk shape was unsupported.",
                true,
            )
        })?;

        if let Some(usage_record) = envelope.usage {
            usage = Some(usage_record);
        }

        for choice in envelope.choices {
            if let Some(content) = choice.delta.and_then(|message| message.content) {
                deltas.push(content);
            }
            if done_reason.is_none() {
                done_reason = choice.finish_reason;
            }
        }
    }
    Ok(OpenAiSseEvent {
        deltas,
        done,
        done_reason,
        usage,
    })
}

fn model_ids_from_envelope(envelope: OpenAiModelsEnvelope) -> Vec<String> {
    envelope
        .data
        .into_iter()
        .map(|model| model.id)
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>()
}

fn join_openai_path(base_url: &str, path: &str) -> Result<Url, OpenAiRuntimeError> {
    let base = Url::parse(base_url).map_err(|_| {
        OpenAiRuntimeError::new(
            OpenAiRuntimeErrorKind::InvalidConfig,
            "OpenAI base URL is invalid.",
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

fn classify_status(status: StatusCode, message: &str) -> OpenAiRuntimeError {
    let kind = match provider_error_kind_from_http_status(status.as_u16(), "", false) {
        ProviderErrorKind::Unauthorized | ProviderErrorKind::AuthRequired => {
            OpenAiRuntimeErrorKind::Unauthorized
        }
        ProviderErrorKind::Forbidden => OpenAiRuntimeErrorKind::Forbidden,
        ProviderErrorKind::RateLimited | ProviderErrorKind::QuotaExceeded => {
            OpenAiRuntimeErrorKind::RateLimited
        }
        ProviderErrorKind::ContextTooLarge => OpenAiRuntimeErrorKind::ContextTooLarge,
        ProviderErrorKind::EndpointNotFound => OpenAiRuntimeErrorKind::EndpointNotFound,
        ProviderErrorKind::ModelMissing => OpenAiRuntimeErrorKind::ModelMissing,
        ProviderErrorKind::ServiceUnavailable => OpenAiRuntimeErrorKind::ProviderUnavailable,
        ProviderErrorKind::RequestTimeout => OpenAiRuntimeErrorKind::RequestTimeout,
        _ => OpenAiRuntimeErrorKind::ProviderError,
    };
    let retryable = matches!(
        kind,
        OpenAiRuntimeErrorKind::RateLimited
            | OpenAiRuntimeErrorKind::ProviderUnavailable
            | OpenAiRuntimeErrorKind::ProviderError
    );
    OpenAiRuntimeError::new(kind, message, retryable).with_status(status.as_u16())
}

fn map_reqwest_error(error: reqwest::Error) -> OpenAiRuntimeError {
    if error.is_timeout() {
        OpenAiRuntimeError::new(
            OpenAiRuntimeErrorKind::RequestTimeout,
            "OpenAI provider request timed out.",
            true,
        )
    } else if error.is_connect() {
        OpenAiRuntimeError::new(
            OpenAiRuntimeErrorKind::ProviderUnavailable,
            "OpenAI provider is not reachable.",
            true,
        )
    } else {
        OpenAiRuntimeError::new(
            OpenAiRuntimeErrorKind::ProviderError,
            "OpenAI provider request failed.",
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
pub struct OpenAiProviderAdapter {
    runtime: OpenAiRuntime,
    provider_profile_id: String,
}

impl OpenAiProviderAdapter {
    pub fn new(profile: ProviderProfileConfig, secret: Option<String>) -> Self {
        let provider_profile_id = profile.id.clone();
        Self {
            runtime: OpenAiRuntime::new(profile, secret.map(OpenAiSecret::new)),
            provider_profile_id,
        }
    }
}

impl ProviderAdapter for OpenAiProviderAdapter {
    fn provider_kind(&self) -> ProviderKind {
        ProviderKind::OpenAi
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
            let response = match adapter.runtime.post_chat_stream(openai_chat_input_from_contract(&request)).await {
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

            while let Some(chunk) = bytes_stream.next().await {
                let bytes = match chunk {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        let error = OpenAiRuntimeError::new(
                            OpenAiRuntimeErrorKind::ProviderError,
                            "OpenAI provider stream failed.",
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
                        let error = OpenAiRuntimeError::new(
                            OpenAiRuntimeErrorKind::StreamParseError,
                            "OpenAI provider returned non-UTF8 stream data.",
                            true,
                        );
                        yield ProviderContractEvent::Error {
                            error: error.to_provider_error(Some(&adapter.provider_profile_id), Some(&model_id)),
                        };
                        return;
                    }
                };
                buffer.push_str(text);

                while let Some(index) = buffer.find("\n\n") {
                    let event_payload = buffer[..index].to_string();
                    buffer.replace_range(..index + 2, "");
                    if event_payload.trim().is_empty() {
                        continue;
                    }
                    let event = match parse_openai_sse_event(&event_payload) {
                        Ok(event) => event,
                        Err(error) => {
                            yield ProviderContractEvent::Error {
                                error: error.to_provider_error(Some(&adapter.provider_profile_id), Some(&model_id)),
                            };
                            return;
                        }
                    };
                    for delta in event.deltas {
                        if !delta.is_empty() {
                            yield ProviderContractEvent::Delta { text: delta };
                        }
                    }
                    if event.done {
                        let usage = match event.usage {
                            Some(usage) => ProviderUsageMetadata::Available {
                                prompt_tokens: usage.prompt_tokens,
                                completion_tokens: usage.completion_tokens,
                                total_tokens: usage.total_tokens,
                            },
                            None => ProviderUsageMetadata::unavailable("provider_did_not_report_usage"),
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
                    ProviderKind::OpenAi,
                )
                .with_provider_id(&adapter.provider_profile_id)
                .with_model(Some(model_id))
                .with_technical_message("OpenAI stream closed without a done marker."),
            };
        })
    }

    fn cancel(&self, _request_id: &str) -> bool {
        // reqwest connection drop will cancel standard OpenAI HTTP streaming
        true
    }
}

fn openai_chat_input_from_contract(request: &ProviderContractRequest) -> OpenAiChatInput {
    OpenAiChatInput {
        model: Some(request.model_id.clone()),
        messages: request
            .messages
            .iter()
            .map(|message| OpenAiMessage {
                role: match message.role {
                    ProviderContractMessageRole::System => OpenAiMessageRole::System,
                    ProviderContractMessageRole::User => OpenAiMessageRole::User,
                    ProviderContractMessageRole::Assistant => OpenAiMessageRole::Assistant,
                },
                content: message.content.clone(),
            })
            .collect(),
        output_budget: request.options.max_tokens,
        context_budget: request.options.context_tokens,
        temperature: request.options.temperature,
        top_p: request.options.top_p,
        stream: Some(request.stream),
        quick_ask: false,
    }
}

// ----------------- Unit Tests -----------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::config::{ProviderTransportKind, ProviderVendor};

    fn openai_profile(base_url: &str) -> ProviderProfileConfig {
        ProviderProfileConfig {
            id: "openai-native-test".to_string(),
            provider_kind: ProviderKind::OpenAi,
            transport_kind: ProviderTransportKind::OpenAi,
            vendor: ProviderVendor::OpenAi,
            display_name: "OpenAI Native Test".to_string(),
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
                supports_cancellation: true,
                supports_model_listing: true,
                supports_thinking: false,
                supports_system_prompt: true,
                supports_json_mode: Some(true),
            },
            metadata_json: None,
        }
    }

    #[test]
    fn test_secret_debug_redacts_api_key() {
        let secret = OpenAiSecret::new("sk-1234567890abcdef");
        let debug_str = format!("{:?}", secret);
        assert!(debug_str.contains("<redacted>"));
        assert!(!debug_str.contains("sk-"));
    }

    #[test]
    fn test_chat_body_mapping() {
        let profile = openai_profile("https://api.openai.com/v1");
        let normalized = normalize_provider_request_options(
            &profile,
            ProviderRequestNormalizationInput {
                model: None,
                output_budget: Some(700),
                context_budget: Some(8192),
                temperature: Some(0.1),
                top_p: Some(0.8),
                think: Some(false),
                stream: Some(true),
                quick_ask: false,
            },
        )
        .expect("normalize");

        let body = build_chat_body(
            &normalized,
            &[OpenAiMessage {
                role: OpenAiMessageRole::User,
                content: "Hello".to_string(),
            }],
            false,
        );

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["max_tokens"], 700);
        assert!((body["temperature"].as_f64().unwrap() - 0.1).abs() < 0.0001);
        assert!((body["top_p"].as_f64().unwrap() - 0.8).abs() < 0.0001);
        assert_eq!(body["stream"], true);
        assert_eq!(body["stream_options"]["include_usage"], true);
    }

    #[test]
    fn test_sse_event_parsing() {
        let chunk1 = r#"data: {"choices":[{"delta":{"content":"Hello"}}]}"#;
        let event = parse_openai_sse_event(chunk1).unwrap();
        assert_eq!(event.deltas, vec!["Hello"]);
        assert!(!event.done);

        let chunk_done = "data: [DONE]";
        let event_done = parse_openai_sse_event(chunk_done).unwrap();
        assert!(event_done.done);

        let chunk_usage = r#"data: {"choices":[], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}"#;
        let event_usage = parse_openai_sse_event(chunk_usage).unwrap();
        assert_eq!(
            event_usage.usage,
            Some(OpenAiUsageRecord {
                prompt_tokens: Some(10),
                completion_tokens: Some(5),
                total_tokens: Some(15)
            })
        );
    }

    #[test]
    fn test_openai_error_mapping() {
        let raw_error = OpenAiRuntimeError::new(
            OpenAiRuntimeErrorKind::Unauthorized,
            "Incorrect API key provided.",
            false,
        );
        let provider_error =
            raw_error.to_provider_error(Some("openai-native"), Some("gpt-4o-mini"));
        assert_eq!(provider_error.kind, ProviderErrorKind::Unauthorized);
        assert_eq!(provider_error.provider_id.as_deref(), Some("openai-native"));
        assert_eq!(provider_error.model.as_deref(), Some("gpt-4o-mini"));
    }

    #[test]
    fn test_joining_base_url_openai() {
        let url = join_openai_path("https://api.openai.com/v1", "/v1/chat/completions").unwrap();
        assert_eq!(url.as_str(), "https://api.openai.com/v1/chat/completions");

        let url2 = join_openai_path("https://api.openai.com", "/v1/chat/completions").unwrap();
        assert_eq!(url2.as_str(), "https://api.openai.com/v1/chat/completions");
    }
}
