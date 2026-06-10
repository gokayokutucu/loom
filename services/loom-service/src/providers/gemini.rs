#![allow(dead_code)]

use crate::{
    error::ServiceError,
    providers::config::{
        normalize_provider_request_options, validate_provider_profiles, ProviderKind,
        ProviderModelDiscoveryResult, ProviderProfileConfig, ProviderRequestNormalizationInput,
    },
    providers::types::{provider_error_kind_from_http_status, ProviderError, ProviderErrorKind},
};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fmt, time::Duration};

#[derive(Debug, Clone)]
pub struct GeminiRuntime {
    client: Option<Client>,
    profile: ProviderProfileConfig,
    secret: Option<GeminiSecret>,
    init_error: Option<GeminiRuntimeError>,
}

#[derive(Clone)]
pub struct GeminiSecret {
    pub api_key: String,
}

impl fmt::Debug for GeminiSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("GeminiSecret")
            .field("api_key", &"<redacted>")
            .finish()
    }
}

impl GeminiSecret {
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            api_key: value.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GeminiRuntimeErrorKind {
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
pub struct GeminiRuntimeError {
    pub kind: GeminiRuntimeErrorKind,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl GeminiRuntimeError {
    pub fn new(kind: GeminiRuntimeErrorKind, message: impl Into<String>, retryable: bool) -> Self {
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
            ProviderError::new(self.kind.to_provider_error_kind(), ProviderKind::Gemini)
                .with_status_code(self.status)
                .with_technical_message(self.message.clone())
                .with_model(model.map(str::to_string));
        if let Some(provider_id) = provider_id {
            error = error.with_provider_id(provider_id);
        }
        error
    }
}

impl GeminiRuntimeErrorKind {
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
pub struct GeminiHealthResponse {
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
pub struct GeminiModelsResponse {
    pub models: Vec<String>,
    pub discovery: ProviderModelDiscoveryResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiPart {
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiContent {
    pub role: String,
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiSystemInstruction {
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeminiGenerationConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeminiChatInput {
    pub contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_instruction: Option<GeminiSystemInstruction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_config: Option<GeminiGenerationConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiSseEvent {
    pub deltas: Vec<String>,
    pub done: bool,
    pub done_reason: Option<String>,
    pub usage: Option<GeminiUsageMetadata>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiModelsEnvelope {
    models: Vec<GeminiModelRecord>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiModelRecord {
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiChatEnvelope {
    candidates: Option<Vec<GeminiCandidate>>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
    #[serde(rename = "finishReason")]
    finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiUsageMetadata {
    #[serde(rename = "promptTokenCount")]
    pub prompt_token_count: Option<u64>,
    #[serde(rename = "candidatesTokenCount")]
    pub candidates_token_count: Option<u64>,
    #[serde(rename = "totalTokenCount")]
    pub total_token_count: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiErrorResponse {
    error: GeminiErrorRecord,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiErrorRecord {
    code: Option<u16>,
    message: String,
    status: Option<String>,
}

impl GeminiRuntime {
    pub fn new(profile: ProviderProfileConfig, secret: Option<GeminiSecret>) -> Self {
        let init_result = validate_gemini_profile(&profile).and_then(|_| {
            Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| {
                    GeminiRuntimeError::new(
                        GeminiRuntimeErrorKind::InvalidConfig,
                        "Gemini HTTP client could not be initialized.",
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

    pub async fn health(&self) -> GeminiHealthResponse {
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
                    GeminiRuntimeErrorKind::Unauthorized => "unauthorized",
                    GeminiRuntimeErrorKind::MissingSecret => "missing_secret",
                    GeminiRuntimeErrorKind::InvalidConfig => "invalid_config",
                    GeminiRuntimeErrorKind::RateLimited => "degraded",
                    GeminiRuntimeErrorKind::ProviderUnavailable
                    | GeminiRuntimeErrorKind::RequestTimeout => "unavailable",
                    _ => "degraded",
                };
                self.health_response(status, false, Some(error.message), vec![])
            }
        }
    }

    pub async fn models(&self) -> Result<GeminiModelsResponse, GeminiRuntimeError> {
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
            let err_msg = if let Ok(err_payload) = response.json::<GeminiErrorResponse>().await {
                err_payload.error.message
            } else {
                "Gemini model discovery failed.".to_string()
            };
            return Err(classify_status(status, &err_msg));
        }
        let envelope = response.json::<GeminiModelsEnvelope>().await.map_err(|_| {
            GeminiRuntimeError::new(
                GeminiRuntimeErrorKind::MalformedResponse,
                "Gemini model discovery returned malformed metadata.",
                true,
            )
        })?;
        let models = model_ids_from_envelope(envelope);
        Ok(GeminiModelsResponse {
            discovery: ProviderModelDiscoveryResult {
                provider_profile_id: self.profile.id.clone(),
                provider_kind: ProviderKind::Gemini,
                source: "provider_discovery".to_string(),
                models: models.clone(),
                warnings: Vec::new(),
            },
            models,
        })
    }

    pub async fn post_chat_stream(
        &self,
        input: GeminiChatInput,
        model: &str,
    ) -> Result<reqwest::Response, GeminiRuntimeError> {
        self.ensure_secret_available()?;
        let client = self.client()?;
        let response = client
            .post(self.chat_url(model, true)?)
            .headers(self.auth_headers())
            .json(&input)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        if !status.is_success() {
            let err_msg = if let Ok(err_payload) = response.json::<GeminiErrorResponse>().await {
                err_payload.error.message
            } else {
                "Gemini chat request failed.".to_string()
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
    ) -> GeminiHealthResponse {
        GeminiHealthResponse {
            status: status.into(),
            provider_kind: ProviderKind::Gemini,
            provider_profile_id: self.profile.id.clone(),
            base_url: self.safe_base_url_display(),
            models_endpoint_reachable,
            warnings,
            reason,
        }
    }

    fn client(&self) -> Result<&Client, GeminiRuntimeError> {
        self.client.as_ref().ok_or_else(|| {
            self.init_error.clone().unwrap_or_else(|| {
                GeminiRuntimeError::new(
                    GeminiRuntimeErrorKind::InvalidConfig,
                    "Gemini provider is not configured.",
                    false,
                )
            })
        })
    }

    fn ensure_secret_available(&self) -> Result<(), GeminiRuntimeError> {
        if self.profile.requires_secret && self.secret.is_none() {
            return Err(GeminiRuntimeError::new(
                GeminiRuntimeErrorKind::MissingSecret,
                "Gemini provider requires a secret reference that is not available.",
                false,
            ));
        }
        Ok(())
    }

    fn auth_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(secret) = &self.secret {
            if let Ok(value) = reqwest::header::HeaderValue::from_str(&secret.api_key) {
                headers.insert("x-goog-api-key", value);
            }
        }
        headers
    }

    fn models_url(&self) -> Result<Url, GeminiRuntimeError> {
        let endpoint = self
            .profile
            .model_discovery
            .endpoint_path
            .as_deref()
            .unwrap_or("/v1beta/models");
        self.url_for_path(endpoint)
    }

    fn chat_url(&self, model: &str, stream: bool) -> Result<Url, GeminiRuntimeError> {
        let suffix = if stream {
            ":streamGenerateContent"
        } else {
            ":generateContent"
        };
        // Model identifier in Gemini API path is formatted as models/{model}
        let path = format!("/v1beta/models/{}{}", model, suffix);
        self.url_for_path(&path)
    }

    fn url_for_path(&self, path: &str) -> Result<Url, GeminiRuntimeError> {
        let base_url = self.profile.base_url.as_deref().ok_or_else(|| {
            GeminiRuntimeError::new(
                GeminiRuntimeErrorKind::InvalidConfig,
                "Gemini provider requires a base URL.",
                false,
            )
        })?;
        join_gemini_path(base_url, path)
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

pub fn validate_gemini_profile(profile: &ProviderProfileConfig) -> Result<(), GeminiRuntimeError> {
    if profile.provider_kind != ProviderKind::Gemini {
        return Err(GeminiRuntimeError::new(
            GeminiRuntimeErrorKind::InvalidConfig,
            "Gemini runtime requires a gemini provider profile.",
            false,
        ));
    }
    validate_provider_profiles(std::slice::from_ref(profile)).map_err(config_to_runtime_error)
}

fn config_to_runtime_error(error: ServiceError) -> GeminiRuntimeError {
    GeminiRuntimeError::new(
        GeminiRuntimeErrorKind::InvalidConfig,
        error.to_string(),
        false,
    )
}

pub fn parse_gemini_json_chunk(payload: &str) -> Result<GeminiSseEvent, GeminiRuntimeError> {
    let value: Value = serde_json::from_str(payload).map_err(|_| {
        GeminiRuntimeError::new(
            GeminiRuntimeErrorKind::StreamParseError,
            "Gemini stream chunk was malformed.",
            true,
        )
    })?;

    if let Some(err_val) = value.get("error") {
        if let Ok(err_resp) = serde_json::from_value::<GeminiErrorRecord>(err_val.clone()) {
            return Err(classify_status(
                StatusCode::from_u16(err_resp.code.unwrap_or(500))
                    .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                &err_resp.message,
            ));
        }
    }

    let envelope: GeminiChatEnvelope = serde_json::from_value(value).map_err(|_| {
        GeminiRuntimeError::new(
            GeminiRuntimeErrorKind::StreamParseError,
            "Gemini stream chunk shape was unsupported.",
            true,
        )
    })?;

    let mut deltas = Vec::new();
    let done = false;
    let mut done_reason = None;
    let mut usage = None;

    if let Some(usage_record) = envelope.usage_metadata {
        usage = Some(usage_record);
    }

    if let Some(candidates) = envelope.candidates {
        for candidate in candidates {
            if let Some(content) = candidate.content {
                for part in content.parts {
                    if let Some(text) = part.text {
                        deltas.push(text);
                    }
                }
            }
            if done_reason.is_none() {
                done_reason = candidate.finish_reason;
            }
        }
    }

    Ok(GeminiSseEvent {
        deltas,
        done,
        done_reason,
        usage,
    })
}

/// A stateful tokenizer that parses the chunked JSON array stream returned by Gemini.
/// Keeps track of brace depth and string quote/escapes to extract fully balanced JSON objects.
pub fn extract_next_json_object(buffer: &mut String) -> Option<String> {
    let mut depth = 0;
    let mut start_idx = None;
    let mut in_string = false;
    let mut escaped = false;

    let mut chars = buffer.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
        } else {
            if c == '"' {
                in_string = true;
            } else if c == '{' {
                if depth == 0 {
                    start_idx = Some(i);
                }
                depth += 1;
            } else if c == '}' {
                if depth > 0 {
                    depth -= 1;
                    if depth == 0 {
                        if let Some(start) = start_idx {
                            let obj = buffer[start..=i].to_string();
                            buffer.drain(..=i);
                            return Some(obj);
                        }
                    }
                }
            }
        }
    }
    None
}

fn model_ids_from_envelope(envelope: GeminiModelsEnvelope) -> Vec<String> {
    envelope
        .models
        .into_iter()
        .map(|model| {
            // Gemini model names are usually returned as "models/gemini-1.5-flash", strip models/ prefix
            model
                .name
                .strip_prefix("models/")
                .unwrap_or(&model.name)
                .to_string()
        })
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>()
}

fn join_gemini_path(base_url: &str, path: &str) -> Result<Url, GeminiRuntimeError> {
    let base = Url::parse(base_url).map_err(|_| {
        GeminiRuntimeError::new(
            GeminiRuntimeErrorKind::InvalidConfig,
            "Gemini base URL is invalid.",
            false,
        )
    })?;
    let target_path = path.trim_start_matches('/');
    let mut base_path = base.path().trim_end_matches('/').to_string();
    let target_without_v1beta = target_path.strip_prefix("v1beta/").unwrap_or(target_path);
    if base_path.ends_with("/v1beta") || base_path == "/v1beta" {
        base_path = format!("{base_path}/{target_without_v1beta}");
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

fn classify_status(status: StatusCode, message: &str) -> GeminiRuntimeError {
    let kind = match provider_error_kind_from_http_status(status.as_u16(), "", false) {
        ProviderErrorKind::Unauthorized | ProviderErrorKind::AuthRequired => {
            GeminiRuntimeErrorKind::Unauthorized
        }
        ProviderErrorKind::Forbidden => GeminiRuntimeErrorKind::Forbidden,
        ProviderErrorKind::RateLimited | ProviderErrorKind::QuotaExceeded => {
            GeminiRuntimeErrorKind::RateLimited
        }
        ProviderErrorKind::ContextTooLarge => GeminiRuntimeErrorKind::ContextTooLarge,
        ProviderErrorKind::EndpointNotFound => GeminiRuntimeErrorKind::EndpointNotFound,
        ProviderErrorKind::ModelMissing => GeminiRuntimeErrorKind::ModelMissing,
        ProviderErrorKind::ServiceUnavailable => GeminiRuntimeErrorKind::ProviderUnavailable,
        ProviderErrorKind::RequestTimeout => GeminiRuntimeErrorKind::RequestTimeout,
        _ => GeminiRuntimeErrorKind::ProviderError,
    };
    let retryable = matches!(
        kind,
        GeminiRuntimeErrorKind::RateLimited
            | GeminiRuntimeErrorKind::ProviderUnavailable
            | GeminiRuntimeErrorKind::ProviderError
    );
    GeminiRuntimeError::new(kind, message, retryable).with_status(status.as_u16())
}

fn map_reqwest_error(error: reqwest::Error) -> GeminiRuntimeError {
    if error.is_timeout() {
        GeminiRuntimeError::new(
            GeminiRuntimeErrorKind::RequestTimeout,
            "Gemini provider request timed out.",
            true,
        )
    } else if error.is_connect() {
        GeminiRuntimeError::new(
            GeminiRuntimeErrorKind::ProviderUnavailable,
            "Gemini provider is not reachable.",
            true,
        )
    } else {
        GeminiRuntimeError::new(
            GeminiRuntimeErrorKind::ProviderError,
            "Gemini provider request failed.",
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
pub struct GeminiProviderAdapter {
    runtime: GeminiRuntime,
    provider_profile_id: String,
}

impl GeminiProviderAdapter {
    pub fn new(profile: ProviderProfileConfig, secret: Option<String>) -> Self {
        let provider_profile_id = profile.id.clone();
        Self {
            runtime: GeminiRuntime::new(profile, secret.map(GeminiSecret::new)),
            provider_profile_id,
        }
    }
}

impl ProviderAdapter for GeminiProviderAdapter {
    fn provider_kind(&self) -> ProviderKind {
        ProviderKind::Gemini
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

            let system_prompt = request.messages.iter()
                .filter(|m| m.role == ProviderContractMessageRole::System)
                .map(|m| m.content.clone())
                .collect::<Vec<_>>()
                .join("\n\n");
            let system_instruction = if system_prompt.is_empty() {
                None
            } else {
                Some(GeminiSystemInstruction {
                    parts: vec![GeminiPart { text: Some(system_prompt) }],
                })
            };

            let contents = request.messages.iter()
                .filter(|m| m.role != ProviderContractMessageRole::System)
                .map(|m| GeminiContent {
                    role: match m.role {
                        ProviderContractMessageRole::User => "user".to_string(),
                        ProviderContractMessageRole::Assistant => "model".to_string(),
                        ProviderContractMessageRole::System => unreachable!(),
                    },
                    parts: vec![GeminiPart { text: Some(m.content.clone()) }],
                })
                .collect::<Vec<_>>();

            let profile = adapter.runtime.profile();
            let normalized = match normalize_provider_request_options(
                profile,
                ProviderRequestNormalizationInput {
                    model: Some(request.model_id.clone()),
                    output_budget: request.options.max_tokens,
                    context_budget: request.options.context_tokens,
                    temperature: request.options.temperature,
                    top_p: request.options.top_p,
                    think: Some(false),
                    stream: Some(request.stream),
                    quick_ask: false,
                },
            ) {
                Ok(normalized) => normalized,
                Err(error) => {
                    yield ProviderContractEvent::Error {
                        error: ProviderError::new(ProviderErrorKind::InvalidConfig, ProviderKind::Gemini)
                            .with_provider_id(&adapter.provider_profile_id)
                            .with_model(Some(model_id))
                            .with_technical_message(error.to_string()),
                    };
                    return;
                }
            };

            let generation_config = GeminiGenerationConfig {
                temperature: normalized.temperature,
                top_p: normalized.top_p,
                max_output_tokens: normalized.max_output_tokens.or(Some(1024)),
            };

            let chat_input = GeminiChatInput {
                contents,
                system_instruction,
                generation_config: Some(generation_config),
            };

            let response = match adapter.runtime.post_chat_stream(chat_input, &model_id).await {
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
                        let error = GeminiRuntimeError::new(
                            GeminiRuntimeErrorKind::ProviderError,
                            "Gemini provider stream failed.",
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
                        let error = GeminiRuntimeError::new(
                            GeminiRuntimeErrorKind::StreamParseError,
                            "Gemini provider returned non-UTF8 stream data.",
                            true,
                        );
                        yield ProviderContractEvent::Error {
                            error: error.to_provider_error(Some(&adapter.provider_profile_id), Some(&model_id)),
                        };
                        return;
                    }
                };
                buffer.push_str(text);

                while let Some(obj_str) = extract_next_json_object(&mut buffer) {
                    let event = match parse_gemini_json_chunk(&obj_str) {
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

                    if let Some(usage) = event.usage {
                        let usage_meta = ProviderUsageMetadata::Available {
                            prompt_tokens: usage.prompt_token_count,
                            completion_tokens: usage.candidates_token_count,
                            total_tokens: usage.total_token_count,
                        };
                        yield ProviderContractEvent::Completed {
                            done_reason: event.done_reason,
                            usage: usage_meta,
                        };
                        return;
                    }
                }
            }

            // If the stream finished without usage Metadata (unlikely but possible), emit completed with unavailable usage
            yield ProviderContractEvent::Completed {
                done_reason: None,
                usage: ProviderUsageMetadata::unavailable("provider_did_not_report_usage"),
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

    fn gemini_profile(base_url: &str) -> ProviderProfileConfig {
        ProviderProfileConfig {
            id: "gemini-native-test".to_string(),
            provider_kind: ProviderKind::Gemini,
            transport_kind: ProviderTransportKind::Gemini,
            vendor: ProviderVendor::Google,
            display_name: "Gemini Native Test".to_string(),
            enabled: true,
            experimental: false,
            base_url: Some(base_url.to_string()),
            default_model: Some("gemini-1.5-flash".to_string()),
            requires_secret: false,
            secret_ref: None,
            model_discovery: crate::providers::config::ProviderModelDiscoveryConfig {
                enabled: true,
                endpoint_path: Some("/v1beta/models".to_string()),
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
        let secret = GeminiSecret::new("AIzaSy-12345");
        let debug_str = format!("{:?}", secret);
        assert!(debug_str.contains("<redacted>"));
        assert!(!debug_str.contains("AIzaSy"));
    }

    #[test]
    fn test_balanced_brace_extraction() {
        let mut buffer = "[{\"candidates\": []}, {\"candidates\": []}]".to_string();
        let obj1 = extract_next_json_object(&mut buffer).unwrap();
        assert_eq!(obj1, "{\"candidates\": []}");
        let obj2 = extract_next_json_object(&mut buffer).unwrap();
        assert_eq!(obj2, "{\"candidates\": []}");
        assert!(extract_next_json_object(&mut buffer).is_none());
    }

    #[test]
    fn test_balanced_brace_extraction_nested_strings() {
        let mut buffer = "{\n  \"text\": \"braces { } inside \\\" quotes\"\n}".to_string();
        let obj = extract_next_json_object(&mut buffer).unwrap();
        assert_eq!(obj, "{\n  \"text\": \"braces { } inside \\\" quotes\"\n}");
    }

    #[test]
    fn test_chat_json_chunk_parsing() {
        let chunk = r#"{
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "Hello world!"}
                        ],
                        "role": "model"
                    },
                    "finishReason": "STOP"
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 10,
                "candidatesTokenCount": 8,
                "totalTokenCount": 18
            }
        }"#;

        let parsed = parse_gemini_json_chunk(chunk).unwrap();
        assert_eq!(parsed.deltas, vec!["Hello world!".to_string()]);
        assert_eq!(parsed.done_reason.as_deref(), Some("STOP"));
        assert_eq!(
            parsed.usage,
            Some(GeminiUsageMetadata {
                prompt_token_count: Some(10),
                candidates_token_count: Some(8),
                total_token_count: Some(18)
            })
        );
    }

    #[test]
    fn test_gemini_error_mapping() {
        let raw_error = GeminiRuntimeError::new(
            GeminiRuntimeErrorKind::Unauthorized,
            "API key not valid",
            false,
        );
        let provider_error =
            raw_error.to_provider_error(Some("gemini-native"), Some("gemini-1.5-flash"));
        assert_eq!(provider_error.kind, ProviderErrorKind::Unauthorized);
        assert_eq!(provider_error.provider_id.as_deref(), Some("gemini-native"));
        assert_eq!(provider_error.model.as_deref(), Some("gemini-1.5-flash"));
    }

    #[test]
    fn test_joining_base_url_gemini() {
        let url = join_gemini_path(
            "https://generativelanguage.googleapis.com",
            "/v1beta/models/gemini-1.5-flash:generateContent",
        )
        .unwrap();
        assert_eq!(url.as_str(), "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent");

        let url2 = join_gemini_path(
            "https://generativelanguage.googleapis.com/v1beta",
            "/v1beta/models/gemini-1.5-flash:generateContent",
        )
        .unwrap();
        assert_eq!(url2.as_str(), "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent");
    }
}
