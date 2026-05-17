use crate::{
    api::state::AppState,
    events::types::service_event,
    providers::types::{
        done_reason_is_length, LoomServiceErrorPayload, OllamaChatRequest, OllamaRuntimeError,
        OllamaRuntimeErrorKind, OllamaStreamChunk, OllamaWireChunk,
    },
    runtime::OperationKind,
};
use async_stream::stream;
use axum::{
    extract::{Path, State},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures_util::{Stream, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::{convert::Infallible, time::Instant};
use tokio::{sync::watch, time::timeout};

pub async fn health(
    State(state): State<AppState>,
) -> Json<crate::providers::types::OllamaHealthResponse> {
    Json(state.ollama.health().await)
}

pub async fn models(
    State(state): State<AppState>,
) -> Result<Json<crate::providers::types::OllamaModelsResponse>, Json<LoomServiceErrorPayload>> {
    state.ollama.models().await.map(Json).map_err(|error| {
        Json(error_payload(
            "models",
            &error,
            state.ollama.config().base_url.as_str(),
            None,
        ))
    })
}

pub async fn cancel(
    State(state): State<AppState>,
    Path(request_id): Path<String>,
) -> Json<CancelResponse> {
    Json(CancelResponse {
        request_id: request_id.clone(),
        cancelled: state.ollama.cancel(&request_id),
    })
}

pub async fn chat(
    State(state): State<AppState>,
    Json(input): Json<OllamaChatRequest>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let request_id = input
        .request_id
        .clone()
        .unwrap_or_else(|| format!("ollama-{}", unix_timestamp_millis()));
    let cancel_rx = state.ollama.register_cancellation(&request_id);
    let stream = chat_event_stream(state, input, request_id, cancel_rx);

    Sse::new(stream).keep_alive(KeepAlive::default())
}

fn chat_event_stream(
    state: AppState,
    input: OllamaChatRequest,
    request_id: String,
    mut cancel_rx: watch::Receiver<bool>,
) -> impl Stream<Item = Result<Event, Infallible>> {
    stream! {
        let _operation_guard = state
            .operations
            .start(request_id.clone(), OperationKind::ModelGeneration);
        let started = Instant::now();
        let mut first_chunk = true;
        let mut thinking_started_at: Option<Instant> = None;
        let mut buffer = String::new();

        yield Ok(to_sse_event(service_event(
            request_id.clone(),
            "response.placeholder_created",
            json!({ "requestId": request_id }),
        )));

        let response = match state.ollama.post_chat(&input).await {
            Ok(response) => response,
            Err(error) => {
                yield Ok(error_event(&request_id, &error, &state, started.elapsed().as_millis()));
                state.ollama.finish_request(&request_id);
                return;
            }
        };

        let mut bytes_stream = response.bytes_stream();

        loop {
            let idle_timeout = if first_chunk {
                state.ollama.config().first_chunk_timeout
            } else {
                state.ollama.config().stream_idle_timeout
            };

            let next_chunk = tokio::select! {
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() {
                        yield Ok(to_sse_event(service_event(
                            request_id.clone(),
                            "response.cancelled",
                            json!({ "requestId": request_id, "elapsedMs": started.elapsed().as_millis() }),
                        )));
                        state.ollama.finish_request(&request_id);
                        return;
                    }
                    continue;
                }
                result = timeout(idle_timeout, bytes_stream.next()) => result
            };

            let Some(chunk_result) = (match next_chunk {
                Ok(value) => value,
                Err(_) => {
                    let kind = if first_chunk {
                        OllamaRuntimeErrorKind::TimeoutBeforeFirstChunk
                    } else {
                        OllamaRuntimeErrorKind::TimeoutDuringStream
                    };
                    let error = OllamaRuntimeError::new(
                        kind,
                        if first_chunk {
                            "The model did not start responding in time."
                        } else {
                            "The model stopped responding before the answer finished."
                        },
                        true,
                    );
                    yield Ok(error_event(&request_id, &error, &state, started.elapsed().as_millis()));
                    state.ollama.finish_request(&request_id);
                    return;
                }
            }) else {
                for event in parse_remaining_buffer(&request_id, &mut buffer, &mut thinking_started_at, started) {
                    yield Ok(event);
                }
                yield Ok(to_sse_event(service_event(
                    request_id.clone(),
                    "response.completed",
                    json!({ "requestId": request_id, "elapsedMs": started.elapsed().as_millis(), "doneReason": Value::Null }),
                )));
                state.ollama.finish_request(&request_id);
                return;
            };

            first_chunk = false;

            let bytes = match chunk_result {
                Ok(bytes) => bytes,
                Err(error) => {
                    let runtime_error = if error.is_connect() {
                        OllamaRuntimeError::new(
                            OllamaRuntimeErrorKind::RuntimeUnavailable,
                            "Ollama is not reachable.",
                            true,
                        )
                    } else {
                        OllamaRuntimeError::new(
                            OllamaRuntimeErrorKind::UnexpectedResponse,
                            "Ollama returned an unexpected stream response.",
                            true,
                        )
                    };
                    yield Ok(error_event(&request_id, &runtime_error, &state, started.elapsed().as_millis()));
                    state.ollama.finish_request(&request_id);
                    return;
                }
            };

            let chunks = match parse_ndjson_bytes(&mut buffer, &bytes) {
                Ok(chunks) => chunks,
                Err(error) => {
                    yield Ok(error_event(&request_id, &error, &state, started.elapsed().as_millis()));
                    state.ollama.finish_request(&request_id);
                    return;
                }
            };

            for chunk in chunks {
                if chunk.thinking_seen {
                    let started_at = thinking_started_at.get_or_insert_with(Instant::now);
                    yield Ok(to_sse_event(service_event(
                        request_id.clone(),
                        "orchestration.progress",
                        json!({
                            "requestId": request_id,
                            "thinking": {
                                "status": "active",
                                "durationMs": started_at.elapsed().as_millis()
                            }
                        }),
                    )));
                }

                if let Some(content) = chunk.content.filter(|content| !content.is_empty()) {
                    yield Ok(to_sse_event(service_event(
                        request_id.clone(),
                        "response.delta",
                        json!({ "requestId": request_id, "content": content }),
                    )));
                }

                if chunk.done {
                    let done_reason = chunk.done_reason.clone();
                    let event_type = done_reason
                        .as_deref()
                        .filter(|reason| done_reason_is_length(reason))
                        .map(|_| "response.truncated")
                        .unwrap_or("response.completed");

                    yield Ok(to_sse_event(service_event(
                        request_id.clone(),
                        event_type,
                        json!({
                            "requestId": request_id,
                            "elapsedMs": started.elapsed().as_millis(),
                            "doneReason": done_reason
                        }),
                    )));
                    state.ollama.finish_request(&request_id);
                    return;
                }
            }
        }
    }
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
    while let Some(newline_index) = buffer.find('\n') {
        let line = buffer[..newline_index].trim().to_string();
        buffer.replace_range(..=newline_index, "");
        if line.is_empty() {
            continue;
        }
        chunks.push(parse_ollama_line(&line)?);
    }

    Ok(chunks)
}

fn parse_ollama_line(line: &str) -> Result<OllamaStreamChunk, OllamaRuntimeError> {
    serde_json::from_str::<OllamaWireChunk>(line)
        .map(OllamaStreamChunk::from)
        .map_err(|_| {
            OllamaRuntimeError::new(
                OllamaRuntimeErrorKind::StreamParseError,
                "Ollama returned malformed NDJSON.",
                true,
            )
        })
}

fn parse_remaining_buffer(
    request_id: &str,
    buffer: &mut String,
    thinking_started_at: &mut Option<Instant>,
    started: Instant,
) -> Vec<Event> {
    let mut events = Vec::new();
    let line = buffer.trim().to_string();
    if line.is_empty() {
        return events;
    }

    if let Ok(chunk) = parse_ollama_line(&line) {
        if chunk.thinking_seen {
            let started_at = thinking_started_at.get_or_insert_with(Instant::now);
            events.push(to_sse_event(service_event(
                request_id.to_string(),
                "orchestration.progress",
                json!({
                    "requestId": request_id,
                    "thinking": {
                        "status": "active",
                        "durationMs": started_at.elapsed().as_millis()
                    }
                }),
            )));
        }
        if let Some(content) = chunk.content.filter(|content| !content.is_empty()) {
            events.push(to_sse_event(service_event(
                request_id.to_string(),
                "response.delta",
                json!({ "requestId": request_id, "content": content }),
            )));
        }
        if chunk.done {
            events.push(to_sse_event(service_event(
                request_id.to_string(),
                "response.completed",
                json!({
                    "requestId": request_id,
                    "elapsedMs": started.elapsed().as_millis(),
                    "doneReason": chunk.done_reason
                }),
            )));
        }
    }

    buffer.clear();
    events
}

fn error_event(
    request_id: &str,
    error: &OllamaRuntimeError,
    state: &AppState,
    elapsed_ms: u128,
) -> Event {
    let payload = error_payload(
        request_id,
        error,
        &state.ollama.config().base_url,
        Some(elapsed_ms),
    );
    to_sse_event(service_event(
        request_id.to_string(),
        "response.error",
        serde_json::to_value(payload).unwrap_or_else(|_| json!({ "requestId": request_id })),
    ))
}

fn error_payload(
    correlation_id: &str,
    error: &OllamaRuntimeError,
    base_url: &str,
    elapsed_ms: Option<u128>,
) -> LoomServiceErrorPayload {
    LoomServiceErrorPayload {
        code: format!("{:?}", error.kind).to_ascii_uppercase(),
        message: error.message.clone(),
        kind: error.kind,
        retryable: error.retryable,
        correlation_id: correlation_id.to_string(),
        details: json!({
            "endpoint": "/api/chat",
            "baseUrl": base_url,
            "elapsedMs": elapsed_ms,
            "httpStatus": error.status,
            "doneReason": error.done_reason
        }),
    }
}

fn to_sse_event(event: crate::events::types::LoomServiceEvent) -> Event {
    let event_type = event.event_type.clone();
    let event_id = event.id.clone();
    let data = serde_json::to_string(&event)
        .unwrap_or_else(|_| "{\"type\":\"response.error\"}".to_string());
    Event::default().event(event_type).id(event_id).data(data)
}

fn unix_timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelResponse {
    pub request_id: String,
    pub cancelled: bool,
}

#[cfg(test)]
mod tests {
    use super::{parse_ndjson_bytes, to_sse_event};
    use crate::events::types::service_event;
    use serde_json::json;

    #[test]
    fn parser_sanitizes_thinking_chunks() {
        let mut buffer = String::new();
        let chunks = parse_ndjson_bytes(
            &mut buffer,
            br#"{"message":{"thinking":"private raw thinking"},"done":false}
"#,
        )
        .expect("parse chunk");

        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].thinking_seen);
        assert!(chunks[0].content.is_none());
    }

    #[test]
    fn thinking_status_event_has_no_raw_thinking_text() {
        let event = service_event(
            "test".to_string(),
            "orchestration.progress",
            json!({
                "thinking": {
                    "status": "active",
                    "durationMs": 12
                }
            }),
        );
        let serialized = serde_json::to_string(&event).expect("serialize event");

        assert!(!serialized.contains("private raw thinking"));
        assert!(!serialized.contains("thinkingText"));
        assert!(!serialized.contains("rawThinking"));
        let _ = to_sse_event(event);
    }
}
