#[cfg(feature = "experimental-rig")]
use crate::providers::rig_openai_compatible::RigOpenAiCompatibleProviderAdapter;
use crate::providers::{
    config::ProviderKind,
    contract::{
        ProviderContractCapabilities, ProviderContractEvent, ProviderContractMessageRole,
        ProviderContractOptions, ProviderContractRequest, ProviderUsageMetadata,
    },
    ollama::OllamaRuntime,
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
    #[cfg(feature = "experimental-rig")]
    RigOpenAiCompatible(RigOpenAiCompatibleProviderAdapter),
}

impl ProviderAdapter for ProviderRegistryAdapter {
    fn provider_kind(&self) -> ProviderKind {
        match self {
            Self::Ollama(adapter) => adapter.provider_kind(),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.provider_kind(),
        }
    }

    fn provider_profile_id(&self) -> &str {
        match self {
            Self::Ollama(adapter) => adapter.provider_profile_id(),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.provider_profile_id(),
        }
    }

    fn capabilities(&self) -> ProviderContractCapabilities {
        match self {
            Self::Ollama(adapter) => adapter.capabilities(),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.capabilities(),
        }
    }

    fn stream_chat(&self, request: ProviderContractRequest) -> ProviderEventStream {
        match self {
            Self::Ollama(adapter) => adapter.stream_chat(request),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.stream_chat(request),
        }
    }

    fn cancel(&self, request_id: &str) -> bool {
        match self {
            Self::Ollama(adapter) => adapter.cancel(request_id),
            #[cfg(feature = "experimental-rig")]
            Self::RigOpenAiCompatible(adapter) => adapter.cancel(request_id),
        }
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
    fn parser_suppresses_raw_thinking_and_emits_status_metadata_only() {
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
