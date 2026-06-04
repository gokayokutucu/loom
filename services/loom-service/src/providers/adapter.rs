#[cfg(feature = "experimental-rig")]
use crate::providers::rig_openai_compatible::RigOpenAiCompatibleProviderAdapter;
use crate::providers::{
    config::{ProviderKind, ProviderProfileConfig, ProviderTransportKind},
    contract::{
        ProviderContractCapabilities, ProviderContractEvent, ProviderContractMessageRole,
        ProviderContractOptions, ProviderContractRequest, ProviderUsageMetadata,
    },
    ollama::OllamaRuntime,
    openai_compatible::{
        parse_openai_compatible_sse_event, OpenAiCompatibleChatInput, OpenAiCompatibleMessage,
        OpenAiCompatibleMessageRole, OpenAiCompatibleRuntime, OpenAiCompatibleRuntimeErrorKind,
        OpenAiCompatibleSecret,
    },
    secret_store::{ProviderSecretStore, SecretStore},
    types::{
        done_reason_is_length, OllamaChatRequest, OllamaMessage, OllamaOptions, OllamaRuntimeError,
        OllamaRuntimeErrorKind, OllamaStreamChunk, OllamaWireChunk, ProviderError,
    },
};
use async_stream::stream;
use futures_util::{Stream, StreamExt};
use serde_json::json;
use std::{pin::Pin, time::Instant};
use tokio::time::timeout;

pub type ProviderEventStream = Pin<Box<dyn Stream<Item = ProviderContractEvent> + Send>>;

pub trait ProviderAdapter: Clone + Send + Sync + 'static {
    fn provider_kind(&self) -> ProviderKind;
    fn provider_profile_id(&self) -> &str;
    fn default_model(&self) -> Option<&str> {
        None
    }
    fn capabilities(&self) -> ProviderContractCapabilities;
    fn stream_chat(&self, request: ProviderContractRequest) -> ProviderEventStream;
    fn cancel(&self, request_id: &str) -> bool;
}

#[derive(Debug, Clone)]
pub struct ProviderRegistry {
    default_generation: ProviderRegistryAdapter,
}

impl ProviderRegistry {
    pub fn new(ollama: OllamaRuntime) -> Self {
        #[cfg(feature = "experimental-rig")]
        if let Some(adapter) = RigOpenAiCompatibleProviderAdapter::from_env_for_e2e() {
            return Self {
                default_generation: ProviderRegistryAdapter::RigOpenAiCompatible(adapter),
            };
        }
        Self {
            default_generation: ProviderRegistryAdapter::Ollama(OllamaProviderAdapter::new(ollama)),
        }
    }

    pub fn new_for_main_generation(
        ollama: OllamaRuntime,
        config: &crate::config::LoomServiceConfig,
        secret_store: &ProviderSecretStore,
    ) -> Self {
        if let Some(adapter) = openai_compatible_adapter_from_e2e_profile(config, secret_store) {
            return Self {
                default_generation: ProviderRegistryAdapter::OpenAiCompatible(adapter),
            };
        }
        Self::new(ollama)
    }

    pub fn default_generation_adapter(&self) -> &ProviderRegistryAdapter {
        &self.default_generation
    }

    pub fn cancel_generation(&self, request_id: &str) -> bool {
        self.default_generation.cancel(request_id)
    }
}

#[derive(Debug, Clone)]
pub enum ProviderRegistryAdapter {
    Ollama(OllamaProviderAdapter),
    OpenAiCompatible(OpenAiCompatibleProviderAdapter),
    #[cfg(feature = "experimental-rig")]
    RigOpenAiCompatible(RigOpenAiCompatibleProviderAdapter),
}

impl ProviderAdapter for ProviderRegistryAdapter {
    fn provider_kind(&self) -> ProviderKind {
        match self {
            Self::Ollama(adapter) => adapter.provider_kind(),
            Self::OpenAiCompatible(adapter) => adapter.provider_kind(),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.provider_kind(),
        }
    }

    fn provider_profile_id(&self) -> &str {
        match self {
            Self::Ollama(adapter) => adapter.provider_profile_id(),
            Self::OpenAiCompatible(adapter) => adapter.provider_profile_id(),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.provider_profile_id(),
        }
    }

    fn default_model(&self) -> Option<&str> {
        match self {
            Self::Ollama(adapter) => adapter.default_model(),
            Self::OpenAiCompatible(adapter) => adapter.default_model(),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.default_model(),
        }
    }

    fn capabilities(&self) -> ProviderContractCapabilities {
        match self {
            Self::Ollama(adapter) => adapter.capabilities(),
            Self::OpenAiCompatible(adapter) => adapter.capabilities(),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.capabilities(),
        }
    }

    fn stream_chat(&self, request: ProviderContractRequest) -> ProviderEventStream {
        match self {
            Self::Ollama(adapter) => adapter.stream_chat(request),
            Self::OpenAiCompatible(adapter) => adapter.stream_chat(request),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.stream_chat(request),
        }
    }

    fn cancel(&self, request_id: &str) -> bool {
        match self {
            Self::Ollama(adapter) => adapter.cancel(request_id),
            Self::OpenAiCompatible(adapter) => adapter.cancel(request_id),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.cancel(request_id),
        }
    }
}

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleProviderAdapter {
    runtime: OpenAiCompatibleRuntime,
    provider_profile_id: String,
}

impl OpenAiCompatibleProviderAdapter {
    fn new(profile: ProviderProfileConfig, secret: Option<String>) -> Self {
        let provider_profile_id = profile.id.clone();
        Self {
            runtime: OpenAiCompatibleRuntime::new(
                profile,
                secret.map(OpenAiCompatibleSecret::bearer),
            ),
            provider_profile_id,
        }
    }
}

impl ProviderAdapter for OpenAiCompatibleProviderAdapter {
    fn provider_kind(&self) -> ProviderKind {
        ProviderKind::OpenAiCompatible
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
            supports_cancellation: false,
            supports_usage_metadata: false,
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
                        let error = crate::providers::openai_compatible::OpenAiCompatibleRuntimeError::new(
                            OpenAiCompatibleRuntimeErrorKind::ProviderError,
                            "OpenAI-compatible provider stream failed.",
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
                        let error = crate::providers::openai_compatible::OpenAiCompatibleRuntimeError::new(
                            OpenAiCompatibleRuntimeErrorKind::StreamParseError,
                            "OpenAI-compatible provider returned non-UTF8 stream data.",
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
                    let event = match parse_openai_compatible_sse_event(&event_payload) {
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
                        yield ProviderContractEvent::Completed {
                            done_reason: event.done_reason,
                            usage: ProviderUsageMetadata::unavailable("provider_did_not_report_usage"),
                        };
                        return;
                    }
                }
            }

            yield ProviderContractEvent::Error {
                error: ProviderError::new(
                    crate::providers::types::ProviderErrorKind::StreamParseError,
                    ProviderKind::OpenAiCompatible,
                )
                .with_provider_id(&adapter.provider_profile_id)
                .with_model(Some(model_id))
                .with_technical_message("OpenAI-compatible stream closed without a done marker."),
            };
        })
    }

    fn cancel(&self, _request_id: &str) -> bool {
        false
    }
}

fn openai_compatible_adapter_from_e2e_profile(
    config: &crate::config::LoomServiceConfig,
    secret_store: &ProviderSecretStore,
) -> Option<OpenAiCompatibleProviderAdapter> {
    let profile_id = std::env::var("LOOM_SERVICE_E2E_PROVIDER_PROFILE").ok()?;
    let profile = config.providers.profiles.iter().find(|profile| {
        profile.id == profile_id
            && profile.enabled
            && profile.provider_kind == ProviderKind::OpenAiCompatible
            && profile.transport_kind == ProviderTransportKind::NativeOpenAiCompatible
    })?;
    let secret = profile
        .secret_ref
        .as_deref()
        .and_then(|secret_ref| secret_store.resolve_secret(secret_ref).ok().flatten())
        .map(|secret| secret.expose_for_provider_runtime().to_string());
    Some(OpenAiCompatibleProviderAdapter::new(
        profile.clone(),
        secret,
    ))
}

fn openai_chat_input_from_contract(request: &ProviderContractRequest) -> OpenAiCompatibleChatInput {
    OpenAiCompatibleChatInput {
        model: Some(request.model_id.clone()),
        messages: request
            .messages
            .iter()
            .map(|message| OpenAiCompatibleMessage {
                role: match message.role {
                    ProviderContractMessageRole::System => OpenAiCompatibleMessageRole::System,
                    ProviderContractMessageRole::User => OpenAiCompatibleMessageRole::User,
                    ProviderContractMessageRole::Assistant => {
                        OpenAiCompatibleMessageRole::Assistant
                    }
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

#[derive(Debug, Clone)]
pub struct OllamaProviderAdapter {
    runtime: OllamaRuntime,
    provider_profile_id: String,
}

impl OllamaProviderAdapter {
    pub fn new(runtime: OllamaRuntime) -> Self {
        Self {
            runtime,
            provider_profile_id: "ollama-local".to_string(),
        }
    }
}

impl ProviderAdapter for OllamaProviderAdapter {
    fn provider_kind(&self) -> ProviderKind {
        ProviderKind::Ollama
    }

    fn provider_profile_id(&self) -> &str {
        &self.provider_profile_id
    }

    fn capabilities(&self) -> ProviderContractCapabilities {
        ProviderContractCapabilities {
            supports_streaming: true,
            supports_cancellation: true,
            supports_usage_metadata: true,
            supports_temperature: true,
            supports_top_p: false,
            supports_max_tokens: true,
            supports_system_prompt: true,
            supports_thinking_status: true,
        }
    }

    fn stream_chat(&self, request: ProviderContractRequest) -> ProviderEventStream {
        let runtime = self.runtime.clone();
        let provider_profile_id = self.provider_profile_id.clone();
        Box::pin(stream! {
            let request_id = request.request_id.clone();
            let model_id = request.model_id.clone();
            let ollama_request = ollama_request_from_contract(&request);
            let mut cancel_rx = runtime.register_cancellation(&request_id);

            let post_chat = runtime.post_chat(&ollama_request);
            tokio::pin!(post_chat);
            let response = loop {
                tokio::select! {
                    response = &mut post_chat => break response,
                    changed = cancel_rx.changed() => {
                        if changed.is_ok() && *cancel_rx.borrow() {
                            yield ProviderContractEvent::Cancelled;
                            runtime.finish_request(&request_id);
                            return;
                        }
                    }
                }
            };

            let response = match response {
                Ok(response) => response,
                Err(error) => {
                    yield ProviderContractEvent::Error {
                        error: ollama_error_to_provider_error(
                            &error,
                            &provider_profile_id,
                            Some(&model_id),
                        ),
                    };
                    runtime.finish_request(&request_id);
                    return;
                }
            };

            if !request.stream {
                let body = match response.json::<serde_json::Value>().await {
                    Ok(body) => body,
                    Err(_) => {
                        let error = OllamaRuntimeError::new(
                            OllamaRuntimeErrorKind::UnexpectedResponse,
                            "Ollama returned malformed chat JSON.",
                            true,
                        );
                        yield ProviderContractEvent::Error {
                            error: ollama_error_to_provider_error(
                                &error,
                                &provider_profile_id,
                                Some(&model_id),
                            ),
                        };
                        runtime.finish_request(&request_id);
                        return;
                    }
                };
                if let Some(answer) = visible_text_from_ollama_body(&body) {
                    yield ProviderContractEvent::Delta { text: answer };
                }
                yield ProviderContractEvent::Completed {
                    done_reason: None,
                    usage: ProviderUsageMetadata::unavailable("provider_did_not_report_usage"),
                };
                runtime.finish_request(&request_id);
                return;
            }

            let mut bytes_stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut first_chunk = true;
            let mut thinking_started_at: Option<Instant> = None;
            let mut thinking_total_chars: usize = 0;

            loop {
                let idle_timeout = if first_chunk {
                    runtime.config().first_chunk_timeout
                } else {
                    runtime.config().stream_idle_timeout
                };
                let next_chunk = tokio::select! {
                    changed = cancel_rx.changed() => {
                        if changed.is_ok() && *cancel_rx.borrow() {
                            yield ProviderContractEvent::Cancelled;
                            runtime.finish_request(&request_id);
                            return;
                        }
                        continue;
                    }
                    result = timeout(idle_timeout, bytes_stream.next()) => result
                };

                let Some(chunk_result) = (match next_chunk {
                    Ok(value) => value,
                    Err(_) => {
                        let error = OllamaRuntimeError::new(
                            if first_chunk {
                                OllamaRuntimeErrorKind::TimeoutBeforeFirstChunk
                            } else {
                                OllamaRuntimeErrorKind::TimeoutDuringStream
                            },
                            if first_chunk {
                                "The model did not start responding in time."
                            } else {
                                "The model stopped responding before the answer finished."
                            },
                            true,
                        );
                        yield ProviderContractEvent::Error {
                            error: ollama_error_to_provider_error(
                                &error,
                                &provider_profile_id,
                                Some(&model_id),
                            ),
                        };
                        runtime.finish_request(&request_id);
                        return;
                    }
                }) else {
                    yield ProviderContractEvent::Completed {
                        done_reason: None,
                        usage: ProviderUsageMetadata::unavailable("provider_stream_closed_without_usage"),
                    };
                    runtime.finish_request(&request_id);
                    return;
                };
                first_chunk = false;

                let bytes = match chunk_result {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        let runtime_error = map_stream_error(error);
                        yield ProviderContractEvent::Error {
                            error: ollama_error_to_provider_error(
                                &runtime_error,
                                &provider_profile_id,
                                Some(&model_id),
                            ),
                        };
                        runtime.finish_request(&request_id);
                        return;
                    }
                };

                let chunks = match parse_ndjson_bytes(&mut buffer, &bytes) {
                    Ok(chunks) => chunks,
                    Err(error) => {
                        yield ProviderContractEvent::Error {
                            error: ollama_error_to_provider_error(
                                &error,
                                &provider_profile_id,
                                Some(&model_id),
                            ),
                        };
                        runtime.finish_request(&request_id);
                        return;
                    }
                };

                for chunk in chunks {
                    if chunk.thinking_seen {
                        let started_at = thinking_started_at.get_or_insert_with(Instant::now);
                        thinking_total_chars += chunk.thinking_char_count;
                        let token_estimate = (thinking_total_chars as f64 / 3.5) as u64;
                        if let Some(text) = chunk.thinking_text.clone() {
                            yield ProviderContractEvent::ThinkingDelta { text };
                        }
                        yield ProviderContractEvent::ThinkingStatus {
                            status: "active".to_string(),
                            duration_ms: Some(started_at.elapsed().as_millis() as u64),
                            token_estimate: Some(token_estimate),
                        };
                    }

                    if let Some(content) = chunk
                        .content
                        .as_ref()
                        .filter(|content| !content.is_empty())
                        .cloned()
                    {
                        yield ProviderContractEvent::Delta { text: content };
                    }

                    if chunk.done {
                        let usage = usage_from_ollama_chunk(&chunk);
                        let done_reason = chunk.done_reason.clone();
                        if done_reason.as_deref().is_some_and(done_reason_is_length) {
                            yield ProviderContractEvent::Truncated { done_reason, usage };
                        } else {
                            yield ProviderContractEvent::Completed { done_reason, usage };
                        }
                        runtime.finish_request(&request_id);
                        return;
                    }
                }
            }
        })
    }

    fn cancel(&self, request_id: &str) -> bool {
        self.runtime.cancel(request_id)
    }
}

pub fn ollama_request_from_contract(request: &ProviderContractRequest) -> OllamaChatRequest {
    OllamaChatRequest {
        model: request.model_id.clone(),
        messages: request
            .messages
            .iter()
            .map(|message| OllamaMessage {
                role: match message.role {
                    ProviderContractMessageRole::System => "system".to_string(),
                    ProviderContractMessageRole::User => "user".to_string(),
                    ProviderContractMessageRole::Assistant => "assistant".to_string(),
                },
                content: message.content.clone(),
            })
            .collect(),
        stream: Some(request.stream),
        think: request.options.thinking,
        options: Some(ollama_options_from_contract(&request.options)),
        request_id: Some(request.request_id.clone()),
    }
}

fn ollama_options_from_contract(options: &ProviderContractOptions) -> OllamaOptions {
    OllamaOptions {
        num_ctx: options.context_tokens,
        num_predict: options.max_tokens,
        temperature: options.temperature,
    }
}

fn usage_from_ollama_chunk(chunk: &OllamaStreamChunk) -> ProviderUsageMetadata {
    match (chunk.prompt_eval_count, chunk.eval_count) {
        (None, None) => ProviderUsageMetadata::unavailable("provider_did_not_report_usage"),
        (prompt_tokens, completion_tokens) => ProviderUsageMetadata::Available {
            prompt_tokens,
            completion_tokens,
            total_tokens: prompt_tokens
                .zip(completion_tokens)
                .map(|(prompt, completion)| prompt.saturating_add(completion)),
        },
    }
}

fn visible_text_from_ollama_body(body: &serde_json::Value) -> Option<String> {
    body.get("message")
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| body.get("response").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|answer| !answer.is_empty())
        .map(ToString::to_string)
}

fn parse_ndjson_bytes(
    buffer: &mut String,
    bytes: &[u8],
) -> Result<Vec<OllamaStreamChunk>, OllamaRuntimeError> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::StreamParseError,
            "Ollama returned non-UTF8 stream data.",
            true,
        )
    })?;
    buffer.push_str(text);

    let mut chunks = Vec::new();
    while let Some(index) = buffer.find('\n') {
        let line = buffer[..index].trim().to_string();
        buffer.replace_range(..=index, "");
        if line.is_empty() {
            continue;
        }
        chunks.push(parse_ollama_line(&line)?);
    }
    Ok(chunks)
}

fn parse_ollama_line(line: &str) -> Result<OllamaStreamChunk, OllamaRuntimeError> {
    let wire: OllamaWireChunk = serde_json::from_str(line).map_err(|_| {
        OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::StreamParseError,
            "Ollama returned malformed stream JSON.",
            true,
        )
    })?;
    if let Some(error) = wire.error.as_deref() {
        let kind = if error.to_ascii_lowercase().contains("not found") {
            OllamaRuntimeErrorKind::ModelMissing
        } else if error
            .to_ascii_lowercase()
            .contains("does not support thinking")
        {
            OllamaRuntimeErrorKind::ProviderRejectedThink
        } else {
            OllamaRuntimeErrorKind::UnexpectedResponse
        };
        return Err(OllamaRuntimeError::new(kind, error, true));
    }
    Ok(OllamaStreamChunk::from(wire))
}

fn map_stream_error(error: reqwest::Error) -> OllamaRuntimeError {
    if error.is_connect() {
        OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::RuntimeUnavailable,
            "Ollama is not reachable.",
            true,
        )
    } else if error.is_timeout() {
        OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::TimeoutDuringStream,
            "The model stopped responding before the answer finished.",
            true,
        )
    } else {
        OllamaRuntimeError::new(
            OllamaRuntimeErrorKind::UnexpectedResponse,
            "Ollama returned an unexpected stream response.",
            true,
        )
    }
}

fn ollama_error_to_provider_error(
    error: &OllamaRuntimeError,
    provider_profile_id: &str,
    model: Option<&str>,
) -> ProviderError {
    error
        .to_provider_error(Some(provider_profile_id), model)
        .with_safe_metadata(json!({
            "legacyProvider": "ollama",
            "legacyKind": format!("{:?}", error.kind),
            "status": error.status,
            "doneReason": error.done_reason,
        }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::types::ProviderErrorKind;
    use crate::{
        config::{LoomServiceConfig, ServiceConfig},
        providers::{config::ProviderProfileConfig, secret_store::ProviderSecretStore},
    };
    use std::{
        path::PathBuf,
        sync::{Mutex, OnceLock},
    };

    fn e2e_env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .expect("e2e env lock")
    }

    fn contract_request() -> ProviderContractRequest {
        ProviderContractRequest {
            provider_kind: ProviderKind::Ollama,
            provider_profile_id: "ollama-local".to_string(),
            model_id: "qwen3:latest".to_string(),
            messages: vec![
                crate::providers::contract::ProviderContractMessage {
                    role: ProviderContractMessageRole::System,
                    content: "system prompt".to_string(),
                },
                crate::providers::contract::ProviderContractMessage {
                    role: ProviderContractMessageRole::User,
                    content: "question".to_string(),
                },
                crate::providers::contract::ProviderContractMessage {
                    role: ProviderContractMessageRole::Assistant,
                    content: "prior answer".to_string(),
                },
            ],
            options: ProviderContractOptions {
                temperature: Some(0.2),
                top_p: Some(0.9),
                max_tokens: Some(512),
                context_tokens: Some(2048),
                thinking: Some(true),
            },
            stream: true,
            request_id: "run-1".to_string(),
            runtime_metadata: json!({ "safe": true }),
            loom_context_metadata: json!({ "source": "context_manager" }),
        }
    }

    fn nvidia_config(enabled: bool) -> LoomServiceConfig {
        let mut config = LoomServiceConfig::default();
        let mut profile = ProviderProfileConfig::nvidia_openai_compatible_example();
        profile.enabled = enabled;
        profile.base_url = Some("http://127.0.0.1:8080/v1".to_string());
        profile.security.allow_insecure_http_remote = true;
        profile.secret_ref = Some("env:LOOM_TEST_NVIDIA_ADAPTER_API_KEY".to_string());
        config.providers.profiles.push(profile);
        config
    }

    fn test_ollama_runtime() -> OllamaRuntime {
        let service_config = ServiceConfig::from_config(
            PathBuf::from("/tmp/loom-provider-adapter-test.toml"),
            LoomServiceConfig::default(),
        )
        .expect("service config");
        OllamaRuntime::new(service_config.ollama)
    }

    #[test]
    fn registry_keeps_ollama_as_default_without_explicit_profile_override() {
        let _lock = e2e_env_lock();
        std::env::remove_var("LOOM_SERVICE_E2E_PROVIDER_PROFILE");
        let registry = ProviderRegistry::new_for_main_generation(
            test_ollama_runtime(),
            &nvidia_config(true),
            &ProviderSecretStore::default(),
        );

        assert_eq!(
            registry.default_generation_adapter().provider_kind(),
            ProviderKind::Ollama
        );
        assert_eq!(
            registry.default_generation_adapter().provider_profile_id(),
            "ollama-local"
        );
    }

    #[test]
    fn registry_does_not_select_disabled_nvidia_profile() {
        let _lock = e2e_env_lock();
        std::env::set_var("LOOM_SERVICE_E2E_PROVIDER_PROFILE", "nvidia");
        let registry = ProviderRegistry::new_for_main_generation(
            test_ollama_runtime(),
            &nvidia_config(false),
            &ProviderSecretStore::default(),
        );
        std::env::remove_var("LOOM_SERVICE_E2E_PROVIDER_PROFILE");

        assert_eq!(
            registry.default_generation_adapter().provider_kind(),
            ProviderKind::Ollama
        );
    }

    #[test]
    fn registry_selects_enabled_native_nvidia_profile_without_exposing_secret() {
        let _lock = e2e_env_lock();
        std::env::set_var("LOOM_SERVICE_E2E_PROVIDER_PROFILE", "nvidia");
        std::env::set_var("LOOM_TEST_NVIDIA_ADAPTER_API_KEY", "nvapi-adapter-secret");
        let secret_store = ProviderSecretStore::default();
        let registry = ProviderRegistry::new_for_main_generation(
            test_ollama_runtime(),
            &nvidia_config(true),
            &secret_store,
        );
        std::env::remove_var("LOOM_SERVICE_E2E_PROVIDER_PROFILE");
        std::env::remove_var("LOOM_TEST_NVIDIA_ADAPTER_API_KEY");

        let adapter = registry.default_generation_adapter();
        let debug = format!("{adapter:?}");
        assert_eq!(adapter.provider_kind(), ProviderKind::OpenAiCompatible);
        assert_eq!(adapter.provider_profile_id(), "nvidia");
        assert!(!debug.contains("nvapi-adapter-secret"));
    }

    #[test]
    fn ollama_request_mapping_preserves_roles_and_options() {
        let mapped = ollama_request_from_contract(&contract_request());

        assert_eq!(mapped.model, "qwen3:latest");
        assert_eq!(mapped.stream, Some(true));
        assert_eq!(mapped.think, Some(true));
        assert_eq!(mapped.request_id.as_deref(), Some("run-1"));
        assert_eq!(mapped.messages[0].role, "system");
        assert_eq!(mapped.messages[1].role, "user");
        assert_eq!(mapped.messages[2].role, "assistant");

        let options = mapped.options.expect("ollama options");
        assert_eq!(options.temperature, Some(0.2));
        assert_eq!(options.num_predict, Some(512));
        assert_eq!(options.num_ctx, Some(2048));
    }

    #[test]
    fn usage_mapping_uses_ollama_final_counts() {
        let chunk = OllamaStreamChunk {
            content: None,
            thinking_text: None,
            thinking_seen: false,
            thinking_char_count: 0,
            done: true,
            done_reason: Some("stop".to_string()),
            eval_count: Some(8),
            prompt_eval_count: Some(12),
        };

        assert_eq!(
            usage_from_ollama_chunk(&chunk),
            ProviderUsageMetadata::Available {
                prompt_tokens: Some(12),
                completion_tokens: Some(8),
                total_tokens: Some(20),
            }
        );
    }

    #[test]
    fn usage_mapping_is_explicit_when_unavailable() {
        let chunk = OllamaStreamChunk {
            content: None,
            thinking_text: None,
            thinking_seen: false,
            thinking_char_count: 0,
            done: true,
            done_reason: Some("stop".to_string()),
            eval_count: None,
            prompt_eval_count: None,
        };

        assert_eq!(
            usage_from_ollama_chunk(&chunk),
            ProviderUsageMetadata::unavailable("provider_did_not_report_usage")
        );
    }

    #[test]
    fn parser_keeps_thinking_as_transient_stream_text() {
        let mut buffer = String::new();
        let chunks = parse_ndjson_bytes(
            &mut buffer,
            br#"{"message":{"thinking":"hidden raw thoughts","content":"visible"},"done":false}
"#,
        )
        .expect("valid chunk");

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].content.as_deref(), Some("visible"));
        assert!(chunks[0].thinking_seen);
        assert_eq!(
            chunks[0].thinking_text.as_deref(),
            Some("hidden raw thoughts")
        );
        assert_eq!(chunks[0].thinking_char_count, "hidden raw thoughts".len());
    }

    #[test]
    fn parser_maps_provider_error_to_safe_provider_error_kind() {
        let mut buffer = String::new();
        let error = parse_ndjson_bytes(
            &mut buffer,
            br#"{"error":"model not found","done":true}
"#,
        )
        .expect_err("provider error");
        let provider_error =
            ollama_error_to_provider_error(&error, "ollama-local", Some("missing"));

        assert_eq!(provider_error.kind, ProviderErrorKind::ModelMissing);
        assert_eq!(provider_error.provider_id.as_deref(), Some("ollama-local"));
        assert_eq!(provider_error.model.as_deref(), Some("missing"));
    }

    #[test]
    fn completed_length_reason_becomes_truncated_event() {
        let chunk = OllamaStreamChunk {
            content: None,
            thinking_text: None,
            thinking_seen: false,
            thinking_char_count: 0,
            done: true,
            done_reason: Some("length".to_string()),
            eval_count: Some(10),
            prompt_eval_count: Some(5),
        };
        let usage = usage_from_ollama_chunk(&chunk);
        let event = if chunk
            .done_reason
            .as_deref()
            .is_some_and(done_reason_is_length)
        {
            ProviderContractEvent::Truncated {
                done_reason: chunk.done_reason.clone(),
                usage,
            }
        } else {
            ProviderContractEvent::Completed {
                done_reason: chunk.done_reason.clone(),
                usage,
            }
        };

        assert!(matches!(event, ProviderContractEvent::Truncated { .. }));
    }

    #[test]
    fn non_stream_body_extracts_visible_text_without_reasoning() {
        let body = json!({
            "message": {
                "thinking": "hidden raw thinking",
                "content": "visible answer"
            }
        });

        assert_eq!(
            visible_text_from_ollama_body(&body).as_deref(),
            Some("visible answer")
        );
    }
}
