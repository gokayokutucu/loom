use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_stream::stream;
use futures_util::Stream;
use futures_util::StreamExt;
use tokio::sync::watch;

use crate::agent_runtime::events::AgentEvent;
use crate::agent_runtime::types::{
    AgentRun, AgentRunId, AgentRunStatus, AgentRuntimeProviderOptions, AgentRuntimeRequest,
    AgentStepKind, AgentUsage,
};
use crate::providers::adapter::ProviderRegistry;
use crate::providers::contract::{
    ProviderContractEvent, ProviderContractMessage, ProviderContractMessageRole,
    ProviderContractOptions, ProviderContractRequest,
};
use crate::providers::pipeline::{ProviderPipeline, ProviderPipelineRegistry};

fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// In-memory run state. No persistence, no SQLite schema — run history is
/// internal/dev-only in this phase (AGENT-RUN-PERSISTENCE-001 is deferred).
#[derive(Debug, Clone, Default)]
pub struct AgentRunStore {
    runs: Arc<Mutex<HashMap<AgentRunId, AgentRun>>>,
    cancellation_signals: Arc<Mutex<HashMap<AgentRunId, watch::Sender<bool>>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentCancellationOutcome {
    NotFound,
    Cancelled {
        run: AgentRun,
        newly_requested: bool,
    },
    Terminal {
        run: AgentRun,
    },
}

impl AgentRunStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, run: AgentRun) -> watch::Receiver<bool> {
        let run_id = run.run_id.clone();
        let (sender, receiver) = watch::channel(false);
        self.runs.lock().unwrap().insert(run_id.clone(), run);
        self.cancellation_signals
            .lock()
            .unwrap()
            .insert(run_id, sender);
        receiver
    }

    pub fn get(&self, run_id: &AgentRunId) -> Option<AgentRun> {
        self.runs.lock().unwrap().get(run_id).cloned()
    }

    pub fn len(&self) -> usize {
        self.runs.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.runs.lock().unwrap().is_empty()
    }

    pub fn request_cancel(&self, run_id: &AgentRunId) -> AgentCancellationOutcome {
        let outcome = {
            let mut runs = self.runs.lock().unwrap();
            let Some(run) = runs.get_mut(run_id) else {
                return AgentCancellationOutcome::NotFound;
            };

            match run.status {
                AgentRunStatus::Pending | AgentRunStatus::Running => {
                    let newly_requested = !run.cancel_requested;
                    run.cancel_requested = true;
                    run.status = AgentRunStatus::Cancelled;
                    run.completed_at.get_or_insert_with(now_epoch_ms);
                    AgentCancellationOutcome::Cancelled {
                        run: run.clone(),
                        newly_requested,
                    }
                }
                AgentRunStatus::Cancelled => AgentCancellationOutcome::Cancelled {
                    run: run.clone(),
                    newly_requested: false,
                },
                AgentRunStatus::Completed | AgentRunStatus::Failed => {
                    AgentCancellationOutcome::Terminal { run: run.clone() }
                }
            }
        };

        if matches!(
            outcome,
            AgentCancellationOutcome::Cancelled {
                newly_requested: true,
                ..
            }
        ) {
            if let Some(sender) = self.cancellation_signals.lock().unwrap().get(run_id) {
                let _ = sender.send(true);
            }
        }

        outcome
    }

    fn finish(&self, run_id: &AgentRunId, status: AgentRunStatus, usage: Option<AgentUsage>) {
        if let Some(run) = self.runs.lock().unwrap().get_mut(run_id) {
            if run.status == AgentRunStatus::Cancelled && status != AgentRunStatus::Cancelled {
                return;
            }
            run.status = status;
            run.completed_at = Some(now_epoch_ms());
            if usage.is_some() {
                run.usage = usage;
            }
        }
        self.cancellation_signals.lock().unwrap().remove(run_id);
    }
}

#[derive(Debug)]
pub struct AgentRuntime<R = ProviderRegistry> {
    pipeline: ProviderPipeline<R>,
    run_store: AgentRunStore,
}

impl<R> AgentRuntime<R>
where
    R: ProviderPipelineRegistry,
{
    pub fn new(pipeline: ProviderPipeline<R>) -> Self {
        Self::with_run_store(pipeline, AgentRunStore::new())
    }

    pub fn with_run_store(pipeline: ProviderPipeline<R>, run_store: AgentRunStore) -> Self {
        Self {
            pipeline,
            run_store,
        }
    }

    pub fn run_store(&self) -> &AgentRunStore {
        &self.run_store
    }

    pub fn cancel_run(&self, run_id: &AgentRunId) -> AgentCancellationOutcome {
        let outcome = self.run_store.request_cancel(run_id);
        if matches!(
            outcome,
            AgentCancellationOutcome::Cancelled {
                newly_requested: true,
                ..
            }
        ) {
            // The runtime-owned signal is authoritative. Provider cancellation
            // is best-effort because some adapters cancel by dropping the
            // stream rather than exposing an active request registry.
            self.pipeline.cancel_generation(run_id.as_str());
        }
        outcome
    }

    pub fn execute_run(&self, request: AgentRuntimeRequest) -> impl Stream<Item = AgentEvent> {
        let pipeline = self.pipeline.clone();
        let run_store = self.run_store.clone();
        stream! {
            let run_id = request.response_id.clone().unwrap_or_else(|| {
                format!("agent-run-{}", now_epoch_ms())
            });

            let profile = pipeline.default_generation_profile();
            let provider_kind = profile.provider_kind;
            let provider_profile_id = profile.provider_profile_id;
            let model_id = request
                .model_id
                .clone()
                .or(profile.default_model)
                .unwrap_or_else(|| "default-model".to_string());

            let mut cancel_rx = run_store.insert(AgentRun {
                run_id: AgentRunId::from(run_id.clone()),
                loom_id: request.loom_id.clone(),
                response_id: request.response_id.clone(),
                parent_response_id: request.parent_response_id.clone(),
                status: AgentRunStatus::Running,
                started_at: now_epoch_ms(),
                completed_at: None,
                cancel_requested: false,
                provider_profile_id: Some(provider_profile_id.clone()),
                model_id: Some(model_id.clone()),
                usage: None,
            });
            let store_run_id = AgentRunId::from(run_id.clone());

            yield AgentEvent::RunStarted {
                run_id: run_id.clone(),
                loom_id: request.loom_id.clone(),
            };

            // 1. ContextBuild step — placeholder only. The Context Manager
            // (AGENT-CONTEXT-MANAGER-001) will own context assembly later.
            let context_step_id = format!("{}-context-build", run_id);
            yield AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: context_step_id.clone(),
                kind: AgentStepKind::ContextBuild,
            };

            // 2. ProviderCall step (LLM generation via existing ProviderPipeline)
            let provider_step_id = format!("{}-provider-call", run_id);
            yield AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: provider_step_id.clone(),
                kind: AgentStepKind::ProviderCall,
            };

            let default_opts = AgentRuntimeProviderOptions::default();
            let provider_opts = request.provider_options.as_ref();
            let temperature = provider_opts
                .and_then(|o| o.temperature)
                .or(default_opts.temperature);
            let max_tokens = provider_opts
                .and_then(|o| o.max_output_tokens)
                .or(default_opts.max_output_tokens);

            let provider_request = ProviderContractRequest {
                provider_kind,
                provider_profile_id,
                model_id,
                messages: vec![ProviderContractMessage {
                    role: ProviderContractMessageRole::User,
                    content: request.prompt.clone(),
                }],
                options: ProviderContractOptions {
                    temperature,
                    top_p: None,
                    max_tokens,
                    context_tokens: Some(2048),
                    thinking: Some(false),
                },
                stream: true,
                request_id: run_id.clone(),
                runtime_metadata: serde_json::json!({
                    "source": "agent_runtime.execute_run",
                }),
                loom_context_metadata: serde_json::json!({
                    "contextBuilt": false,
                    "contextSnapshotId": request.context_snapshot_id,
                }),
            };

            let start_time = std::time::Instant::now();
            let mut provider_stream = pipeline.stream_chat(provider_request);
            let mut completed_successfully = false;
            let mut run_usage: Option<AgentUsage> = None;

            loop {
                let next_event = tokio::select! {
                    biased;
                    changed = cancel_rx.changed() => {
                        if changed.is_ok() && *cancel_rx.borrow() {
                            run_store.finish(&store_run_id, AgentRunStatus::Cancelled, None);
                            yield AgentEvent::RunCancelled { run_id: run_id.clone() };
                            return;
                        }
                        continue;
                    }
                    event = provider_stream.next() => event,
                };

                let Some(event) = next_event else {
                    break;
                };
                match event {
                    ProviderContractEvent::Delta { text } => {
                        yield AgentEvent::provider_delta(
                            run_id.clone(),
                            provider_step_id.clone(),
                            &text,
                        );
                    }
                    ProviderContractEvent::ThinkingDelta { .. } => {
                        // Raw thinking is dropped: never emitted, serialized, or stored.
                    }
                    ProviderContractEvent::ThinkingStatus { .. } => {
                        // Thinking status updates are dropped as well.
                    }
                    ProviderContractEvent::Completed { done_reason, usage }
                    | ProviderContractEvent::Truncated { done_reason, usage } => {
                        run_usage = AgentUsage::from_provider(&usage);
                        yield AgentEvent::ProviderCompleted {
                            run_id: run_id.clone(),
                            step_id: provider_step_id.clone(),
                            done_reason,
                            usage: run_usage,
                        };
                        completed_successfully = true;
                        break;
                    }
                    ProviderContractEvent::Error { error } => {
                        run_store.finish(&store_run_id, AgentRunStatus::Failed, None);
                        yield AgentEvent::RunFailed {
                            run_id: run_id.clone(),
                            error_message: error.user_message,
                        };
                        return;
                    }
                    ProviderContractEvent::Cancelled => {
                        run_store.finish(&store_run_id, AgentRunStatus::Cancelled, None);
                        yield AgentEvent::RunCancelled {
                            run_id: run_id.clone(),
                        };
                        return;
                    }
                }
            }

            if !completed_successfully {
                run_store.finish(&store_run_id, AgentRunStatus::Failed, None);
                yield AgentEvent::RunFailed {
                    run_id: run_id.clone(),
                    error_message: "Provider stream ended abruptly without completion event".to_string(),
                };
                return;
            }

            if *cancel_rx.borrow() {
                run_store.finish(&store_run_id, AgentRunStatus::Cancelled, None);
                yield AgentEvent::RunCancelled { run_id: run_id.clone() };
                return;
            }

            // 3. ToolCallPlaceholder step — tool execution is deferred to
            // TOOL-RUNTIME-BOUNDARY-001; nothing is ever executed here.
            let tool_step_id = format!("{}-tool-call", run_id);
            yield AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: tool_step_id.clone(),
                kind: AgentStepKind::ToolCallPlaceholder,
            };
            yield AgentEvent::ToolCallRequested {
                run_id: run_id.clone(),
                step_id: tool_step_id.clone(),
                tool_name: "dummy_placeholder_tool".to_string(),
            };
            yield AgentEvent::ToolCallSkipped {
                run_id: run_id.clone(),
                step_id: tool_step_id.clone(),
                tool_name: "dummy_placeholder_tool".to_string(),
                reason: "tool execution not implemented in foundation phase".to_string(),
            };

            // 4. ArtifactPlaceholder step
            let artifact_step_id = format!("{}-artifact", run_id);
            yield AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: artifact_step_id.clone(),
                kind: AgentStepKind::ArtifactPlaceholder,
            };
            yield AgentEvent::ArtifactCreated {
                run_id: run_id.clone(),
                step_id: artifact_step_id.clone(),
                artifact_id: "dummy_placeholder_artifact".to_string(),
            };

            // 5. ValidationPlaceholder step
            let validation_step_id = format!("{}-validation", run_id);
            yield AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: validation_step_id.clone(),
                kind: AgentStepKind::ValidationPlaceholder,
            };

            run_store.finish(&store_run_id, AgentRunStatus::Completed, run_usage);
            yield AgentEvent::RunCompleted {
                run_id: run_id.clone(),
                elapsed_ms: start_time.elapsed().as_millis() as u64,
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime::test_support::make_test_runtime;
    use crate::agent_runtime::types::AgentRuntimeRequest;
    use crate::providers::config::ProviderKind;
    use crate::providers::contract::ProviderUsageMetadata;
    use crate::providers::types::{ProviderError, ProviderErrorKind};

    fn make_request(response_id: &str) -> AgentRuntimeRequest {
        AgentRuntimeRequest {
            prompt: "ping".to_string(),
            loom_id: Some("test-loom".to_string()),
            response_id: Some(response_id.to_string()),
            parent_response_id: None,
            provider_profile_id: None,
            model_id: None,
            context_snapshot_id: None,
            provider_options: None,
        }
    }

    #[tokio::test]
    async fn test_agent_runtime_lifecycle_event_order() {
        let events = vec![
            ProviderContractEvent::Delta {
                text: "hello".to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: ProviderUsageMetadata::Available {
                    prompt_tokens: Some(10),
                    completion_tokens: Some(20),
                    total_tokens: Some(30),
                },
            },
        ];
        let (runtime, _) = make_test_runtime(events);
        let request = make_request("test-response");

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;

        assert!(matches!(
            stream_events[0],
            AgentEvent::RunStarted { ref run_id, ref loom_id }
            if run_id == "test-response" && loom_id.as_deref() == Some("test-loom")
        ));
        assert!(matches!(
            stream_events[1],
            AgentEvent::StepStarted {
                kind: AgentStepKind::ContextBuild,
                ..
            }
        ));
        assert!(matches!(
            stream_events[2],
            AgentEvent::StepStarted {
                kind: AgentStepKind::ProviderCall,
                ..
            }
        ));
        assert!(matches!(
            stream_events[3],
            AgentEvent::ProviderDelta { ref delta, .. } if delta == "hello"
        ));
        assert!(matches!(
            stream_events[4],
            AgentEvent::ProviderCompleted { ref done_reason, ref usage, .. }
            if done_reason.as_deref() == Some("stop")
                && *usage == Some(AgentUsage {
                    input_tokens: Some(10),
                    output_tokens: Some(20),
                    total_tokens: Some(30),
                })
        ));
        assert!(matches!(
            stream_events[5],
            AgentEvent::StepStarted {
                kind: AgentStepKind::ToolCallPlaceholder,
                ..
            }
        ));
        assert!(matches!(
            stream_events[6],
            AgentEvent::ToolCallRequested { ref tool_name, .. } if tool_name == "dummy_placeholder_tool"
        ));
        assert!(matches!(
            stream_events[7],
            AgentEvent::ToolCallSkipped { ref tool_name, .. } if tool_name == "dummy_placeholder_tool"
        ));
        assert!(matches!(
            stream_events[8],
            AgentEvent::StepStarted {
                kind: AgentStepKind::ArtifactPlaceholder,
                ..
            }
        ));
        assert!(matches!(
            stream_events[9],
            AgentEvent::ArtifactCreated { ref artifact_id, .. } if artifact_id == "dummy_placeholder_artifact"
        ));
        assert!(matches!(
            stream_events[10],
            AgentEvent::StepStarted {
                kind: AgentStepKind::ValidationPlaceholder,
                ..
            }
        ));
        assert!(matches!(
            stream_events[11],
            AgentEvent::RunCompleted { ref run_id, .. } if run_id == "test-response"
        ));
        assert_eq!(stream_events.len(), 12);
    }

    #[tokio::test]
    async fn test_agent_runtime_run_store_tracks_completion() {
        let events = vec![
            ProviderContractEvent::Delta {
                text: "hi".to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: ProviderUsageMetadata::Available {
                    prompt_tokens: Some(1),
                    completion_tokens: Some(2),
                    total_tokens: Some(3),
                },
            },
        ];
        let (runtime, _) = make_test_runtime(events);
        let request = make_request("test-response-store");

        let _ = runtime.execute_run(request).collect::<Vec<_>>().await;

        let run = runtime
            .run_store()
            .get(&AgentRunId::from("test-response-store"))
            .expect("run recorded in store");
        assert_eq!(run.status, AgentRunStatus::Completed);
        assert!(run.completed_at.is_some());
        assert!(!run.cancel_requested);
        assert_eq!(run.usage.and_then(|u| u.total_tokens), Some(3));
        assert_eq!(
            run.provider_profile_id.as_deref(),
            Some("fake-agent-provider")
        );
    }

    #[tokio::test]
    async fn test_agent_runtime_thinking_privacy() {
        let events = vec![
            ProviderContractEvent::ThinkingStatus {
                status: "active".to_string(),
                duration_ms: Some(10),
                token_estimate: Some(5),
            },
            ProviderContractEvent::ThinkingDelta {
                text: "let me think...".to_string(),
            },
            ProviderContractEvent::Delta {
                text: "hello raw_thinking chain_of_thought hidden_reasoning thinking_text world"
                    .to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: ProviderUsageMetadata::unavailable("no-usage"),
            },
        ];
        let (runtime, _) = make_test_runtime(events);
        let request = make_request("test-response-privacy");

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        let serialized = serde_json::to_string(&stream_events).expect("serialize");

        // Raw thinking deltas/status are dropped and delta text is sanitized.
        for forbidden in [
            "let me think",
            "raw_thinking",
            "chain_of_thought",
            "hidden_reasoning",
            "thinking_text",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "found forbidden text: {forbidden}"
            );
        }

        let delta_event = stream_events
            .iter()
            .find(|e| matches!(e, AgentEvent::ProviderDelta { .. }))
            .unwrap();
        if let AgentEvent::ProviderDelta { delta, .. } = delta_event {
            assert_eq!(delta, "[sanitized thinking]");
        }

        // Run store must not retain thinking either.
        let run = runtime
            .run_store()
            .get(&AgentRunId::from("test-response-privacy"))
            .expect("run recorded");
        let run_serialized = serde_json::to_string(&run).expect("serialize run");
        for forbidden in [
            "let me think",
            "raw_thinking",
            "chain_of_thought",
            "hidden_reasoning",
            "thinking_text",
        ] {
            assert!(!run_serialized.contains(forbidden));
        }

        // Unavailable usage maps to None.
        assert!(stream_events
            .iter()
            .any(|e| matches!(e, AgentEvent::ProviderCompleted { usage: None, .. })));
    }

    #[tokio::test]
    async fn test_agent_runtime_error_mapping() {
        let error = ProviderError::new(ProviderErrorKind::Unauthorized, ProviderKind::Ollama)
            .with_technical_message("auth failed");
        let events = vec![ProviderContractEvent::Error { error }];
        let (runtime, _) = make_test_runtime(events);
        let request = make_request("test-response-error");

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        // RunStarted -> ContextBuild StepStarted -> ProviderCall StepStarted -> RunFailed
        assert_eq!(stream_events.len(), 4);
        assert!(matches!(
            stream_events[3],
            AgentEvent::RunFailed { ref error_message, .. }
            if error_message == "Provider authentication failed."
        ));

        let run = runtime
            .run_store()
            .get(&AgentRunId::from("test-response-error"))
            .expect("run recorded");
        assert_eq!(run.status, AgentRunStatus::Failed);
    }

    #[tokio::test]
    async fn test_agent_runtime_cancellation() {
        let events = vec![
            ProviderContractEvent::Delta {
                text: "partial".to_string(),
            },
            ProviderContractEvent::Cancelled,
        ];
        let (runtime, _) = make_test_runtime(events);
        let request = make_request("test-response-cancel");

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        // RunStarted -> ContextBuild StepStarted -> ProviderCall StepStarted -> ProviderDelta -> RunCancelled
        assert_eq!(stream_events.len(), 5);
        assert!(matches!(
            stream_events[4],
            AgentEvent::RunCancelled { ref run_id } if run_id == "test-response-cancel"
        ));

        let run = runtime
            .run_store()
            .get(&AgentRunId::from("test-response-cancel"))
            .expect("run recorded");
        assert_eq!(run.status, AgentRunStatus::Cancelled);
    }

    #[tokio::test]
    async fn test_agent_runtime_tool_placeholder_executes_nothing() {
        let events = vec![ProviderContractEvent::Completed {
            done_reason: Some("stop".to_string()),
            usage: ProviderUsageMetadata::unavailable("no-usage"),
        }];
        let (runtime, state) = make_test_runtime(events);
        let request = make_request("test-response-tool");

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;

        let requested = stream_events
            .iter()
            .position(|e| matches!(e, AgentEvent::ToolCallRequested { .. }))
            .expect("tool call requested");
        let skipped = stream_events
            .iter()
            .position(|e| matches!(e, AgentEvent::ToolCallSkipped { .. }))
            .expect("tool call skipped");
        assert_eq!(skipped, requested + 1, "skip follows request immediately");

        // The fake adapter saw no side effects beyond the single chat stream.
        assert!(state.lock().unwrap().cancel_called_with.is_none());
    }

    #[test]
    fn test_agent_event_serialization_has_no_thinking_fields() {
        // Exhaustive variant sweep: serialized AgentEvents must be free of
        // forbidden thinking keys regardless of variant.
        let usage = Some(AgentUsage {
            input_tokens: Some(1),
            output_tokens: Some(2),
            total_tokens: Some(3),
        });
        let all_variants = vec![
            AgentEvent::RunStarted {
                run_id: "r".into(),
                loom_id: Some("l".into()),
            },
            AgentEvent::StepStarted {
                run_id: "r".into(),
                step_id: "s".into(),
                kind: AgentStepKind::ProviderCall,
            },
            AgentEvent::provider_delta("r".into(), "s".into(), "visible text"),
            AgentEvent::ProviderCompleted {
                run_id: "r".into(),
                step_id: "s".into(),
                done_reason: Some("stop".into()),
                usage,
            },
            AgentEvent::ToolCallRequested {
                run_id: "r".into(),
                step_id: "s".into(),
                tool_name: "t".into(),
            },
            AgentEvent::ToolCallSkipped {
                run_id: "r".into(),
                step_id: "s".into(),
                tool_name: "t".into(),
                reason: "foundation phase".into(),
            },
            AgentEvent::ArtifactCreated {
                run_id: "r".into(),
                step_id: "s".into(),
                artifact_id: "a".into(),
            },
            AgentEvent::Warning {
                run_id: "r".into(),
                message: "w".into(),
            },
            AgentEvent::RunCompleted {
                run_id: "r".into(),
                elapsed_ms: 1,
            },
            AgentEvent::RunFailed {
                run_id: "r".into(),
                error_message: "e".into(),
            },
            AgentEvent::RunCancelled { run_id: "r".into() },
        ];

        let serialized = serde_json::to_string(&all_variants).expect("serialize");
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "authorization",
            "bearer",
        ] {
            assert!(
                !serialized.to_ascii_lowercase().contains(forbidden),
                "found forbidden key: {forbidden}"
            );
        }
    }

    #[test]
    fn test_provider_delta_constructor_sanitizes() {
        let event = AgentEvent::provider_delta("r".into(), "s".into(), "leak raw_thinking here");
        assert!(matches!(
            event,
            AgentEvent::ProviderDelta { ref delta, .. } if delta == "[sanitized thinking]"
        ));
    }

    #[tokio::test]
    async fn test_agent_runtime_maps_default_provider_options() {
        let events = vec![ProviderContractEvent::Completed {
            done_reason: Some("stop".to_string()),
            usage: ProviderUsageMetadata::unavailable("no-usage"),
        }];
        let (runtime, state) = make_test_runtime(events);
        let request = make_request("test-response-default-opts");

        let _ = runtime.execute_run(request).collect::<Vec<_>>().await;

        let captured_req = state.lock().unwrap().last_request.clone().unwrap();
        assert_eq!(captured_req.options.temperature, Some(0.7));
        assert_eq!(captured_req.options.max_tokens, Some(1024));
    }

    #[tokio::test]
    async fn test_agent_runtime_maps_custom_provider_options() {
        let events = vec![ProviderContractEvent::Completed {
            done_reason: Some("stop".to_string()),
            usage: ProviderUsageMetadata::unavailable("no-usage"),
        }];
        let (runtime, state) = make_test_runtime(events);
        let mut request = make_request("test-response-custom-opts");
        request.provider_options = Some(AgentRuntimeProviderOptions {
            temperature: Some(0.4),
            max_output_tokens: Some(512),
        });

        let _ = runtime.execute_run(request).collect::<Vec<_>>().await;

        let captured_req = state.lock().unwrap().last_request.clone().unwrap();
        assert_eq!(captured_req.options.temperature, Some(0.4));
        assert_eq!(captured_req.options.max_tokens, Some(512));
    }
}
