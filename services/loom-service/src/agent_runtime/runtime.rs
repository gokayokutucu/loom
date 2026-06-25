use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_stream::stream;
use futures_util::Stream;
use futures_util::StreamExt;
use tokio::sync::watch;

use crate::agent_runtime::event_writer::event_to_safe_record;
use crate::agent_runtime::events::AgentEvent;
use crate::agent_runtime::tools::{
    SafeToolArguments, ToolCallId, ToolInvocationRequest, ToolName, ToolRuntimeBoundary,
};
use crate::agent_runtime::types::{
    new_agent_run_id, AgentRun, AgentRunId, AgentRunStatus, AgentRuntimeProviderOptions,
    AgentRuntimeRequest, AgentStepId, AgentStepKind, AgentStepStatus, AgentUsage,
};
use crate::context::types::{BuiltContext, ContextMessageRole};
use crate::provider_runtime::{ProviderExecutionRequest, ProviderRuntimeService};
use crate::providers::adapter::ProviderRegistry;
use crate::providers::contract::{
    ProviderContractEvent, ProviderContractMessage, ProviderContractMessageRole,
    ProviderContractOptions, ProviderContractRequest,
};
use crate::providers::pipeline::{ProviderPipeline, ProviderPipelineRegistry};
use crate::storage::repositories::agent_runs::{
    AgentRunRepository, NewAgentEvent, NewAgentRun, NewAgentStep,
};

const PROVIDER_CALL_COMPLETED_SAFE_SUMMARY: &str = "provider_call_completed_via_bridge";
const PROVIDER_CALL_FAILED_SAFE_CODE: &str = "provider_call_failed";
const PROVIDER_STREAM_ENDED_WITHOUT_TERMINAL_EVENT_SAFE_CODE: &str =
    "provider_stream_ended_without_terminal_event";

fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// In-memory run state. Process-lifetime cache; `AgentRunRepository` is the
/// durable history source. The store owns cancellation signals.
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentTerminalTransition {
    Applied(AgentRun),
    Preserved(AgentRun),
    Missing,
}

impl AgentTerminalTransition {
    fn effective_status(&self) -> Option<AgentRunStatus> {
        match self {
            Self::Applied(run) | Self::Preserved(run) => Some(run.status),
            Self::Missing => None,
        }
    }
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

    /// Returns all stored run IDs. Useful for tests and introspection — the
    /// store never evicts, so this includes both active and terminal runs.
    pub fn all_run_ids(&self) -> Vec<AgentRunId> {
        self.runs.lock().unwrap().keys().cloned().collect()
    }

    pub fn request_cancel(&self, run_id: &AgentRunId) -> AgentCancellationOutcome {
        let outcome = {
            let mut runs = self.runs.lock().unwrap();
            let Some(run) = runs.get_mut(run_id) else {
                return AgentCancellationOutcome::NotFound;
            };

            match run.status {
                AgentRunStatus::Created
                | AgentRunStatus::Queued
                | AgentRunStatus::Pending
                | AgentRunStatus::Running
                | AgentRunStatus::WaitingTool
                | AgentRunStatus::WaitingSubagent => {
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
                AgentRunStatus::Completed
                | AgentRunStatus::Failed
                | AgentRunStatus::Interrupted => {
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

    fn transition_terminal(
        &self,
        run_id: &AgentRunId,
        requested_status: AgentRunStatus,
        usage: Option<AgentUsage>,
    ) -> AgentTerminalTransition {
        debug_assert!(matches!(
            requested_status,
            AgentRunStatus::Completed | AgentRunStatus::Failed | AgentRunStatus::Cancelled
        ));

        let transition = {
            let mut runs = self.runs.lock().unwrap();
            let Some(run) = runs.get_mut(run_id) else {
                return AgentTerminalTransition::Missing;
            };

            if matches!(
                run.status,
                AgentRunStatus::Completed
                    | AgentRunStatus::Failed
                    | AgentRunStatus::Cancelled
                    | AgentRunStatus::Interrupted
            ) {
                AgentTerminalTransition::Preserved(run.clone())
            } else {
                run.status = requested_status;
                run.completed_at = Some(now_epoch_ms());
                if requested_status == AgentRunStatus::Completed {
                    run.usage = usage;
                }
                AgentTerminalTransition::Applied(run.clone())
            }
        };

        self.cancellation_signals.lock().unwrap().remove(run_id);
        transition
    }
}

fn terminal_event(
    run_id: &str,
    transition: &AgentTerminalTransition,
    elapsed_ms: u64,
    failure_message: impl Into<String>,
) -> AgentEvent {
    match transition.effective_status() {
        Some(AgentRunStatus::Completed) => AgentEvent::RunCompleted {
            run_id: run_id.to_string(),
            elapsed_ms,
        },
        Some(AgentRunStatus::Cancelled) => AgentEvent::RunCancelled {
            run_id: run_id.to_string(),
        },
        Some(
            AgentRunStatus::Failed
            | AgentRunStatus::Created
            | AgentRunStatus::Queued
            | AgentRunStatus::Pending
            | AgentRunStatus::Running
            | AgentRunStatus::WaitingTool
            | AgentRunStatus::WaitingSubagent
            | AgentRunStatus::Interrupted,
        ) => AgentEvent::RunFailed {
            run_id: run_id.to_string(),
            error_message: failure_message.into(),
        },
        None => AgentEvent::RunFailed {
            run_id: run_id.to_string(),
            error_message: "Agent run state was unavailable during terminal transition".to_string(),
        },
    }
}

fn terminal_status_str(transition: &AgentTerminalTransition) -> AgentRunStatus {
    match transition {
        AgentTerminalTransition::Applied(run) | AgentTerminalTransition::Preserved(run) => {
            run.status
        }
        AgentTerminalTransition::Missing => AgentRunStatus::Failed,
    }
}

fn terminal_event_type(transition: &AgentTerminalTransition) -> &'static str {
    match terminal_status_str(transition) {
        AgentRunStatus::Completed => "run_completed",
        AgentRunStatus::Cancelled => "run_cancelled",
        _ => "run_failed",
    }
}

fn provider_role_from_context(role: ContextMessageRole) -> ProviderContractMessageRole {
    match role {
        ContextMessageRole::System => ProviderContractMessageRole::System,
        ContextMessageRole::User => ProviderContractMessageRole::User,
        ContextMessageRole::Assistant => ProviderContractMessageRole::Assistant,
    }
}

fn provider_messages_from_built_context(
    built_context: &BuiltContext,
) -> Vec<ProviderContractMessage> {
    built_context
        .messages
        .iter()
        .map(|message| ProviderContractMessage {
            role: provider_role_from_context(message.role.clone()),
            content: message.content.clone(),
        })
        .collect()
}

fn safe_legacy_context_metadata(
    built_context: &BuiltContext,
    context_snapshot_id: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "contextBuilt": true,
        "contextSource": "legacy_context_manager",
        "contextSnapshotId": context_snapshot_id,
        "messageCount": built_context.messages.len(),
        "selectedCandidateCount": built_context.budget_diagnostics.selected_candidate_count,
        "droppedCandidateCount": built_context.budget_diagnostics.dropped_candidate_count,
        "overflowCandidateCount": built_context.budget_diagnostics.overflow_candidate_count,
        "recentSelectedResponses": built_context.budget_diagnostics.recent_selected_responses,
        "referenceCapsuleCount": built_context.artifacts.reference_capsule_ids.len(),
        "responseCapsuleCount": built_context.artifacts.response_capsule_ids.len(),
        "hasCheckpoint": built_context.artifacts.checkpoint_id.is_some(),
        "hasWeftOrigin": built_context.artifacts.weft_origin_context_id.is_some(),
        "warningCount": built_context.warnings.len(),
        "strategy": built_context.strategy,
    })
}

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: V2 Runtime
// migration_status: bridged
// rules:
// - AgentRuntime owns AgentRun lifecycle, steps, cancellation, and safe events.
// - It consumes the legacy Context Pipeline via LegacyContextRuntimeInput and drives
//   ProviderRuntimeService lifecycle metadata around its own provider call (PROVIDER-RUNTIME-BRIDGE-001).
// next_task: none
#[derive(Debug)]
pub struct AgentRuntime<R = ProviderRegistry> {
    pipeline: ProviderPipeline<R>,
    provider_runtime: ProviderRuntimeService,
    run_store: AgentRunStore,
    tool_registry: Arc<std::sync::RwLock<crate::agent_runtime::tool_registry::ToolRegistry>>,
    run_repository: Option<AgentRunRepository>,
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
            provider_runtime: ProviderRuntimeService::new(),
            run_store,
            tool_registry: Arc::new(std::sync::RwLock::new(
                crate::agent_runtime::tool_registry::ToolRegistry::new(),
            )),
            run_repository: None,
        }
    }

    pub fn with_run_store_and_registry(
        pipeline: ProviderPipeline<R>,
        run_store: AgentRunStore,
        tool_registry: Arc<std::sync::RwLock<crate::agent_runtime::tool_registry::ToolRegistry>>,
    ) -> Self {
        Self {
            pipeline,
            provider_runtime: ProviderRuntimeService::new(),
            run_store,
            tool_registry,
            run_repository: None,
        }
    }

    /// Attaches a durable repository for run persistence. The in-memory store
    /// remains the cancellation and cache authority; the repository is the
    /// history source of truth.
    pub fn with_repository(mut self, repo: AgentRunRepository) -> Self {
        self.run_repository = Some(repo);
        self
    }

    pub fn run_store(&self) -> &AgentRunStore {
        &self.run_store
    }

    pub fn provider_runtime(&self) -> &ProviderRuntimeService {
        &self.provider_runtime
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
            self.pipeline.cancel_generation(run_id.as_str());
        }
        outcome
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V2_CANONICAL_RUNTIME
    // role: executes AgentRun lifecycle; drives ProviderRuntimeService lifecycle metadata around its own provider call
    // rules: Preserve safe events; ProviderRuntimeService tracks lifecycle only, the real call stays here.
    // next_task: none
    pub fn execute_run(&self, request: AgentRuntimeRequest) -> impl Stream<Item = AgentEvent> {
        let pipeline = self.pipeline.clone();
        let provider_runtime = self.provider_runtime.clone();
        let run_store = self.run_store.clone();
        let tool_registry = self.tool_registry.clone();
        let run_repository = self.run_repository.clone();
        stream! {
            // AgentRunId is an independent UUID v4 — never derived from response_id.
            let run_id = new_agent_run_id().0;
            let now_ms = now_epoch_ms();
            let started_at_str = now_ms.to_string();

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
                correlation_id: run_id.clone(),
                causation_id: request.parent_response_id.clone(),
                context_snapshot_id: request.context_snapshot_id.clone(),
                status: AgentRunStatus::Running,
                started_at: now_ms,
                completed_at: None,
                cancel_requested: false,
                provider_profile_id: Some(provider_profile_id.clone()),
                model_id: Some(model_id.clone()),
                usage: None,
            });
            let store_run_id = AgentRunId::from(run_id.clone());

            // Persist run start
            if let Some(ref repo) = run_repository {
                let _ = repo.insert_run(&NewAgentRun {
                    agent_run_id: &run_id,
                    agent_id: None,
                    agent_revision: None,
                    loom_id: request.loom_id.as_deref(),
                    response_id: request.response_id.as_deref(),
                    parent_response_id: request.parent_response_id.as_deref(),
                    correlation_id: &run_id,
                    causation_id: request.parent_response_id.as_deref(),
                    root_run_id: None,
                    parent_run_id: None,
                    context_snapshot_id: request.context_snapshot_id.as_deref(),
                    provider_profile_id: Some(provider_profile_id.as_str()),
                    model_id: Some(model_id.as_str()),
                    started_at: &started_at_str,
                }).await;
            }

            let run_started = AgentEvent::RunStarted {
                run_id: run_id.clone(),
                loom_id: request.loom_id.clone(),
            };
            persist_event(&run_repository, &run_id, &run_started).await;
            yield run_started;

            // 1. ContextBuild step — uses legacy ContextManager when supplied.
            let context_step_id = format!("{}-context-build", run_id);
            let context_step_started = AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: context_step_id.clone(),
                kind: AgentStepKind::ContextBuild,
            };
            persist_step_started(&run_repository, &run_id, &context_step_id, AgentStepKind::ContextBuild, 0, &started_at_str, &context_step_started).await;
            yield context_step_started;

            let mut provider_messages = vec![ProviderContractMessage {
                role: ProviderContractMessageRole::User,
                content: request.prompt.clone(),
            }];
            let mut loom_context_metadata = serde_json::json!({
                "contextBuilt": false,
                "contextSnapshotId": request.context_snapshot_id.clone(),
            });

            if let Some(legacy_context) = request.legacy_context.clone() {
                let built_context = crate::context::manager::ContextManager::default()
                    .build_context(legacy_context.build_input);
                provider_messages = provider_messages_from_built_context(&built_context);
                loom_context_metadata = safe_legacy_context_metadata(
                    &built_context,
                    request.context_snapshot_id.as_deref(),
                );
            }

            finish_step_in_repo(&run_repository, &context_step_id, AgentStepStatus::Completed, None).await;

            // 2. ProviderCall step
            let provider_step_id = format!("{}-provider-call", run_id);
            let provider_step_started = AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: provider_step_id.clone(),
                kind: AgentStepKind::ProviderCall,
            };
            persist_step_started(&run_repository, &run_id, &provider_step_id, AgentStepKind::ProviderCall, 1, &started_at_str, &provider_step_started).await;
            yield provider_step_started;

            let default_opts = AgentRuntimeProviderOptions::default();
            let provider_opts = request.provider_options.as_ref();
            let temperature = provider_opts
                .and_then(|o| o.temperature)
                .or(default_opts.temperature);
            let max_tokens = provider_opts
                .and_then(|o| o.max_output_tokens)
                .or(default_opts.max_output_tokens);

            let provider_execution_id = format!("{run_id}-provider-exec");
            let provider_profile_id_for_runtime = provider_profile_id.clone();
            let model_id_for_runtime = model_id.clone();

            let provider_request = ProviderContractRequest {
                provider_kind,
                provider_profile_id,
                model_id,
                messages: provider_messages,
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
                loom_context_metadata,
            };

            // ProviderRuntimeService tracks safe lifecycle metadata for this provider
            // call; the call itself still runs through `pipeline` below
            // (PROVIDER-RUNTIME-BRIDGE-001 — see docs/provider_runtime_seam_audit.md).
            let _ = provider_runtime.submit_noop(ProviderExecutionRequest {
                execution_id: provider_execution_id.clone(),
                root_run_id: run_id.clone(),
                agent_run_id: run_id.clone(),
                provider_profile_id: Some(provider_profile_id_for_runtime),
                model_id: Some(model_id_for_runtime),
                requested_at: Some(started_at_str.clone()),
                timeout_ms: None,
                diagnostics_json: None,
                auto_complete_noop: false,
                force_noop_failure: false,
            });
            let _ = provider_runtime.transition_to_running(&provider_execution_id);

            let start_time = std::time::Instant::now();
            let mut provider_stream = pipeline.stream_chat(provider_request);
            let mut completed_successfully = false;
            let mut run_usage: Option<AgentUsage> = None;

            loop {
                let next_event = tokio::select! {
                    biased;
                    changed = cancel_rx.changed() => {
                        if changed.is_ok() && *cancel_rx.borrow() {
                            let _ = provider_runtime.cancel_execution(&provider_execution_id);
                            let transition = run_store.transition_terminal(
                                &store_run_id,
                                AgentRunStatus::Cancelled,
                                None,
                            );
                            let t_event = terminal_event(
                                &run_id,
                                &transition,
                                start_time.elapsed().as_millis() as u64,
                                "Agent run cancelled",
                            );
                            finish_run_in_repo(
                                &run_repository,
                                &run_id,
                                &transition,
                                None,
                                Some("Agent run cancelled"),
                                start_time.elapsed().as_millis() as u64,
                            ).await;
                            finish_step_in_repo(&run_repository, &provider_step_id, AgentStepStatus::Cancelled, None).await;
                            yield t_event;
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
                        // ProviderDelta is NOT persisted (delta text excluded).
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
                        let _ = provider_runtime.complete_execution(
                            &provider_execution_id,
                            PROVIDER_CALL_COMPLETED_SAFE_SUMMARY,
                        );
                        run_usage = AgentUsage::from_provider(&usage);
                        let completed_event = AgentEvent::ProviderCompleted {
                            run_id: run_id.clone(),
                            step_id: provider_step_id.clone(),
                            done_reason,
                            usage: run_usage,
                        };
                        persist_event(&run_repository, &run_id, &completed_event).await;
                        finish_step_in_repo(&run_repository, &provider_step_id, AgentStepStatus::Completed, None).await;
                        yield completed_event;
                        completed_successfully = true;
                        break;
                    }
                    ProviderContractEvent::Error { error } => {
                        let _ = provider_runtime.fail_execution(
                            &provider_execution_id,
                            PROVIDER_CALL_FAILED_SAFE_CODE,
                        );
                        let transition = run_store.transition_terminal(
                            &store_run_id,
                            AgentRunStatus::Failed,
                            None,
                        );
                        let t_event = terminal_event(
                            &run_id,
                            &transition,
                            start_time.elapsed().as_millis() as u64,
                            error.user_message.clone(),
                        );
                        finish_run_in_repo(
                            &run_repository,
                            &run_id,
                            &transition,
                            None,
                            Some(error.user_message.as_str()),
                            start_time.elapsed().as_millis() as u64,
                        ).await;
                        finish_step_in_repo(&run_repository, &provider_step_id, AgentStepStatus::Failed, Some(error.user_message.as_str())).await;
                        yield t_event;
                        return;
                    }
                    ProviderContractEvent::Cancelled => {
                        let _ = provider_runtime.cancel_execution(&provider_execution_id);
                        let transition = run_store.transition_terminal(
                            &store_run_id,
                            AgentRunStatus::Cancelled,
                            None,
                        );
                        let t_event = terminal_event(
                            &run_id,
                            &transition,
                            start_time.elapsed().as_millis() as u64,
                            "Agent run cancelled",
                        );
                        finish_run_in_repo(
                            &run_repository,
                            &run_id,
                            &transition,
                            None,
                            Some("Agent run cancelled"),
                            start_time.elapsed().as_millis() as u64,
                        ).await;
                        finish_step_in_repo(&run_repository, &provider_step_id, AgentStepStatus::Cancelled, None).await;
                        yield t_event;
                        return;
                    }
                }
            }

            if !completed_successfully {
                let _ = provider_runtime.fail_execution(
                    &provider_execution_id,
                    PROVIDER_STREAM_ENDED_WITHOUT_TERMINAL_EVENT_SAFE_CODE,
                );
                let transition = run_store.transition_terminal(
                    &store_run_id,
                    AgentRunStatus::Failed,
                    None,
                );
                let t_event = terminal_event(
                    &run_id,
                    &transition,
                    start_time.elapsed().as_millis() as u64,
                    "Provider stream ended abruptly without completion event",
                );
                finish_run_in_repo(
                    &run_repository,
                    &run_id,
                    &transition,
                    None,
                    Some("Provider stream ended abruptly without completion event"),
                    start_time.elapsed().as_millis() as u64,
                ).await;
                finish_step_in_repo(&run_repository, &provider_step_id, AgentStepStatus::Failed, Some("Provider stream ended abruptly without completion event")).await;
                yield t_event;
                return;
            }

            if *cancel_rx.borrow() {
                // Race outcome: the provider call already completed (handled above,
                // provider_runtime is already terminal there) but cancellation was
                // also requested. cancel_execution is a safe no-op on a terminal record.
                let _ = provider_runtime.cancel_execution(&provider_execution_id);
                let transition = run_store.transition_terminal(
                    &store_run_id,
                    AgentRunStatus::Cancelled,
                    None,
                );
                let t_event = terminal_event(
                    &run_id,
                    &transition,
                    start_time.elapsed().as_millis() as u64,
                    "Agent run cancelled",
                );
                finish_run_in_repo(
                    &run_repository,
                    &run_id,
                    &transition,
                    None,
                    Some("Agent run cancelled"),
                    start_time.elapsed().as_millis() as u64,
                ).await;
                finish_step_in_repo(&run_repository, &provider_step_id, AgentStepStatus::Cancelled, None).await;
                yield t_event;
                return;
            }

            // 3. ToolCallPlaceholder step
            let tool_step_id = format!("{}-tool-call", run_id);
            let tool_step_started = AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: tool_step_id.clone(),
                kind: AgentStepKind::ToolCallPlaceholder,
            };
            persist_step_started(&run_repository, &run_id, &tool_step_id, AgentStepKind::ToolCallPlaceholder, 2, &started_at_str, &tool_step_started).await;
            yield tool_step_started;

            let tool_boundary = ToolRuntimeBoundary::with_shared_registry(tool_registry);
            let tool_request = ToolInvocationRequest {
                call_id: ToolCallId::from(format!("{tool_step_id}-call")),
                run_id: AgentRunId::from(run_id.clone()),
                step_id: Some(AgentStepId::from(tool_step_id.clone())),
                tool_name: ToolName::from("dummy_placeholder_tool"),
                arguments: SafeToolArguments::empty(),
                requested_at: now_epoch_ms(),
                origin: Some("placeholder".to_string()),
            };
            let tool_call_requested = AgentEvent::ToolCallRequested {
                run_id: run_id.clone(),
                step_id: tool_step_id.clone(),
                tool_name: tool_request.tool_name.to_string(),
            };
            persist_event(&run_repository, &run_id, &tool_call_requested).await;
            yield tool_call_requested;

            let tool_result = tool_boundary.invoke(&tool_request);
            let tool_perm = AgentEvent::ToolPermissionEvaluated {
                run_id: run_id.clone(),
                step_id: tool_step_id.clone(),
                tool_name: tool_result.tool_name.to_string(),
                status: tool_result.permission.status,
                reason: tool_result.permission.reason.clone(),
            };
            persist_event(&run_repository, &run_id, &tool_perm).await;
            yield tool_perm;

            let tool_skipped = AgentEvent::ToolCallSkipped {
                run_id: run_id.clone(),
                step_id: tool_step_id.clone(),
                tool_name: tool_result.tool_name.to_string(),
                reason: tool_result
                    .error
                    .as_ref()
                    .map(|error| error.code.clone())
                    .or_else(|| tool_result.permission.reason.clone())
                    .unwrap_or_else(|| "tool execution not implemented".to_string()),
            };
            persist_event(&run_repository, &run_id, &tool_skipped).await;
            yield tool_skipped;
            finish_step_in_repo(&run_repository, &tool_step_id, AgentStepStatus::Skipped, None).await;

            // 4. ArtifactPlaceholder step
            let artifact_step_id = format!("{}-artifact", run_id);
            let artifact_step_started = AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: artifact_step_id.clone(),
                kind: AgentStepKind::ArtifactPlaceholder,
            };
            persist_step_started(&run_repository, &run_id, &artifact_step_id, AgentStepKind::ArtifactPlaceholder, 3, &started_at_str, &artifact_step_started).await;
            yield artifact_step_started;

            let artifact_created = AgentEvent::ArtifactCreated {
                run_id: run_id.clone(),
                step_id: artifact_step_id.clone(),
                artifact_id: "dummy_placeholder_artifact".to_string(),
            };
            persist_event(&run_repository, &run_id, &artifact_created).await;
            yield artifact_created;
            finish_step_in_repo(&run_repository, &artifact_step_id, AgentStepStatus::Completed, None).await;

            // 5. ValidationPlaceholder step
            let validation_step_id = format!("{}-validation", run_id);
            let validation_step_started = AgentEvent::StepStarted {
                run_id: run_id.clone(),
                step_id: validation_step_id.clone(),
                kind: AgentStepKind::ValidationPlaceholder,
            };
            persist_step_started(&run_repository, &run_id, &validation_step_id, AgentStepKind::ValidationPlaceholder, 4, &started_at_str, &validation_step_started).await;
            yield validation_step_started;
            finish_step_in_repo(&run_repository, &validation_step_id, AgentStepStatus::Completed, None).await;

            let transition = run_store.transition_terminal(
                &store_run_id,
                AgentRunStatus::Completed,
                run_usage,
            );
            let t_event = terminal_event(
                &run_id,
                &transition,
                start_time.elapsed().as_millis() as u64,
                "Agent run failed",
            );
            finish_run_in_repo(
                &run_repository,
                &run_id,
                &transition,
                run_usage,
                None,
                start_time.elapsed().as_millis() as u64,
            ).await;
            yield t_event;
        }
    }
}

async fn persist_step_started(
    run_repository: &Option<AgentRunRepository>,
    run_id: &str,
    step_id: &str,
    kind: AgentStepKind,
    sequence_index: i64,
    started_at: &str,
    event: &AgentEvent,
) {
    if let Some(repo) = run_repository {
        let _ = repo
            .insert_step(&NewAgentStep {
                agent_step_id: step_id,
                agent_run_id: run_id,
                kind,
                sequence_index,
                started_at: Some(started_at),
            })
            .await;
    }
    persist_event(run_repository, run_id, event).await;
}

async fn finish_step_in_repo(
    run_repository: &Option<AgentRunRepository>,
    step_id: &str,
    status: AgentStepStatus,
    error: Option<&str>,
) {
    if let Some(repo) = run_repository {
        let _ = repo.finish_step(step_id, status, error).await;
    }
}

/// Appends a non-terminal event to the repository if persistence is enabled.
// LOOM_BOUNDARY_METHOD:
// marker: V2_CANONICAL_RUNTIME
// role: persists allowlisted AgentEvent records only
// rules: Durable events must exclude provider deltas, prompts, raw tool output, secrets, and raw thinking.
// next_task: none
async fn persist_event(
    run_repository: &Option<AgentRunRepository>,
    run_id: &str,
    event: &AgentEvent,
) {
    if let Some(ref repo) = run_repository {
        if let Some((event_type, payload_json)) = event_to_safe_record(event) {
            let event_id = uuid::Uuid::new_v4().to_string();
            let seq = repo.next_sequence();
            let step_id = event_step_id(event);
            let _ = repo
                .append_event(&NewAgentEvent {
                    agent_event_id: &event_id,
                    agent_run_id: run_id,
                    agent_step_id: step_id,
                    sequence_number: seq,
                    event_type,
                    payload_json,
                })
                .await;
        }
    }
}

fn event_step_id(event: &AgentEvent) -> Option<&str> {
    match event {
        AgentEvent::StepStarted { step_id, .. }
        | AgentEvent::ProviderDelta { step_id, .. }
        | AgentEvent::ProviderCompleted { step_id, .. }
        | AgentEvent::ToolCallRequested { step_id, .. }
        | AgentEvent::ToolPermissionEvaluated { step_id, .. }
        | AgentEvent::ToolCallSkipped { step_id, .. }
        | AgentEvent::ToolCallCompleted { step_id, .. }
        | AgentEvent::ToolCallFailed { step_id, .. }
        | AgentEvent::ArtifactCreated { step_id, .. } => Some(step_id),
        AgentEvent::RunStarted { .. }
        | AgentEvent::Warning { .. }
        | AgentEvent::RunCompleted { .. }
        | AgentEvent::RunFailed { .. }
        | AgentEvent::RunCancelled { .. } => None,
    }
}

/// Atomically persists the terminal status and event via finish_run.
// LOOM_BOUNDARY_METHOD:
// marker: V2_CANONICAL_RUNTIME
// role: commits terminal AgentRun state and terminal event atomically
// rules: Terminal AgentRun persistence must remain safe and idempotent.
// next_task: none
async fn finish_run_in_repo(
    run_repository: &Option<AgentRunRepository>,
    run_id: &str,
    transition: &AgentTerminalTransition,
    usage: Option<AgentUsage>,
    error_message: Option<&str>,
    elapsed_ms: u64,
) {
    if let Some(ref repo) = run_repository {
        let status = terminal_status_str(transition);
        let event_type = terminal_event_type(transition);
        let event_id = uuid::Uuid::new_v4().to_string();
        let seq = repo.next_sequence();
        let payload = serde_json::json!({
            "runId": run_id,
            "elapsedMs": elapsed_ms,
        })
        .to_string();
        let _ = repo
            .finish_run(
                run_id,
                status,
                usage,
                error_message,
                &event_id,
                event_type,
                seq,
                Some(payload),
            )
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime::test_support::make_test_runtime;
    use crate::agent_runtime::tools::ToolPermissionStatus;
    use crate::agent_runtime::types::{AgentRuntimeRequest, LegacyContextRuntimeInput};
    use crate::context::types::{
        AnswerPlanSummary, ArtifactStatus, AttachedReferenceInput, BuildContextInput,
        ContextMessage, ContextMessageRole, ContextSource, ReferenceContext,
        ResponseContextCapsule, ResponseMode, WeftOriginContext,
    };
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
            legacy_context: None,
            provider_options: None,
        }
    }

    fn make_stored_run(run_id: &str) -> AgentRun {
        AgentRun {
            run_id: AgentRunId::from(run_id),
            loom_id: Some("test-loom".to_string()),
            response_id: Some(run_id.to_string()),
            parent_response_id: None,
            correlation_id: run_id.to_string(),
            causation_id: None,
            context_snapshot_id: None,
            status: AgentRunStatus::Running,
            started_at: now_epoch_ms(),
            completed_at: None,
            cancel_requested: false,
            provider_profile_id: Some("fake-agent-provider".to_string()),
            model_id: Some("test-model".to_string()),
            usage: None,
        }
    }

    /// Extracts the run_id from the first RunStarted event in a stream.
    fn extract_run_id(events: &[AgentEvent]) -> String {
        match events.first() {
            Some(AgentEvent::RunStarted { run_id, .. }) => run_id.clone(),
            _ => panic!(
                "expected RunStarted as first event, got: {:?}",
                events.first()
            ),
        }
    }

    fn terminal_event_count(events: &[AgentEvent]) -> usize {
        events
            .iter()
            .filter(|event| {
                matches!(
                    event,
                    AgentEvent::RunCompleted { .. }
                        | AgentEvent::RunFailed { .. }
                        | AgentEvent::RunCancelled { .. }
                )
            })
            .count()
    }

    fn legacy_context_input() -> LegacyContextRuntimeInput {
        LegacyContextRuntimeInput {
            build_input: BuildContextInput {
                loom_id: "test-loom".to_string(),
                current_head_response_id: Some("current-user-response".to_string()),
                user_prompt: "Use the legacy context.".to_string(),
                attached_references: vec![AttachedReferenceInput {
                    reference: ReferenceContext {
                        reference_id: "ref-1".to_string(),
                        target_kind: "response".to_string(),
                        target_id: Some("source-response".to_string()),
                        target_uri: Some("loom://test-loom/responses/source-response".to_string()),
                        label: Some("Source response".to_string()),
                        selected_text: Some("Selected reference fragment".to_string()),
                        capsule_summary: Some("Reference summary".to_string()),
                    },
                    response_capsule: Some(ResponseContextCapsule {
                        capsule_id: "capsule-1".to_string(),
                        response_id: "source-response".to_string(),
                        loom_id: "test-loom".to_string(),
                        response_code: None,
                        title: Some("Capsule title".to_string()),
                        summary: "Capsule summary text".to_string(),
                        key_points: vec!["Capsule key point".to_string()],
                        keywords: vec!["capsule".to_string()],
                        entities: vec![],
                        code_blocks: vec![],
                        canonical_uri: None,
                        source_hash: None,
                        generator: Some("test".to_string()),
                        status: ArtifactStatus::Ready,
                    }),
                    attachment: None,
                }],
                response_mode: ResponseMode::Instant,
                resolved_num_ctx: 8192,
                answer_plan: Some(AnswerPlanSummary {
                    intent: "answer".to_string(),
                    answer_style: "direct".to_string(),
                    context_strategy: Some("test".to_string()),
                }),
                source: ContextSource::Weft,
                weft_origin: Some(WeftOriginContext {
                    context_id: "weft-origin-1".to_string(),
                    weft_loom_id: "test-loom".to_string(),
                    origin_loom_id: "origin-loom".to_string(),
                    origin_response_id: "origin-response".to_string(),
                    origin_capsule_id: Some("origin-capsule".to_string()),
                    origin_summary: "Weft origin background".to_string(),
                    source_hash: None,
                    status: ArtifactStatus::Ready,
                }),
                checkpoint: None,
                memory_messages: vec![ContextMessage::new(
                    ContextMessageRole::System,
                    "Saved memory context",
                    None,
                    Some("memory-1".to_string()),
                )],
                recent_messages: vec![
                    ContextMessage::new(
                        ContextMessageRole::User,
                        "Recent user turn",
                        None,
                        Some("recent-user".to_string()),
                    ),
                    ContextMessage::new(
                        ContextMessageRole::Assistant,
                        "Recent assistant turn",
                        None,
                        Some("recent-assistant".to_string()),
                    ),
                ],
            },
        }
    }

    #[test]
    fn cancellation_immediately_before_completion_preserves_cancelled_terminal_state() {
        let store = AgentRunStore::new();
        let run_id = AgentRunId::from("cancel-before-complete");
        let _receiver = store.insert(make_stored_run(run_id.as_str()));

        assert!(matches!(
            store.request_cancel(&run_id),
            AgentCancellationOutcome::Cancelled {
                newly_requested: true,
                ..
            }
        ));
        let transition = store.transition_terminal(
            &run_id,
            AgentRunStatus::Completed,
            Some(AgentUsage {
                input_tokens: Some(1),
                output_tokens: Some(2),
                total_tokens: Some(3),
            }),
        );

        assert!(matches!(
            transition,
            AgentTerminalTransition::Preserved(ref run)
                if run.status == AgentRunStatus::Cancelled && run.usage.is_none()
        ));
        assert!(matches!(
            terminal_event(run_id.as_str(), &transition, 1, "failed"),
            AgentEvent::RunCancelled { .. }
        ));
        assert_eq!(
            store.get(&run_id).expect("stored run").status,
            AgentRunStatus::Cancelled
        );
    }

    #[test]
    fn completion_before_cancellation_remains_completed() {
        let store = AgentRunStore::new();
        let run_id = AgentRunId::from("complete-before-cancel");
        let _receiver = store.insert(make_stored_run(run_id.as_str()));

        let transition = store.transition_terminal(
            &run_id,
            AgentRunStatus::Completed,
            Some(AgentUsage {
                input_tokens: None,
                output_tokens: None,
                total_tokens: Some(5),
            }),
        );
        assert!(matches!(transition, AgentTerminalTransition::Applied(_)));
        assert!(matches!(
            store.request_cancel(&run_id),
            AgentCancellationOutcome::Terminal { ref run }
                if run.status == AgentRunStatus::Completed
        ));
        assert_eq!(
            store
                .get(&run_id)
                .expect("stored run")
                .usage
                .and_then(|usage| usage.total_tokens),
            Some(5)
        );
    }

    #[test]
    fn failure_after_cancellation_emits_cancelled_and_preserves_store() {
        let store = AgentRunStore::new();
        let run_id = AgentRunId::from("failure-after-cancel");
        let _receiver = store.insert(make_stored_run(run_id.as_str()));
        let _ = store.request_cancel(&run_id);

        let transition = store.transition_terminal(&run_id, AgentRunStatus::Failed, None);
        let event = terminal_event(run_id.as_str(), &transition, 1, "provider failed");

        assert!(matches!(event, AgentEvent::RunCancelled { .. }));
        assert_eq!(
            store.get(&run_id).expect("stored run").status,
            AgentRunStatus::Cancelled
        );
    }

    #[test]
    fn interrupted_run_in_store_is_terminal_for_cancel() {
        let store = AgentRunStore::new();
        let run_id = AgentRunId::from("interrupted-run");
        let mut run = make_stored_run(run_id.as_str());
        run.status = AgentRunStatus::Interrupted;
        let _ = store.insert(run);

        assert!(matches!(
            store.request_cancel(&run_id),
            AgentCancellationOutcome::Terminal { .. }
        ));
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

        // Extract the actual UUID run_id from the RunStarted event.
        let run_id = extract_run_id(&stream_events);

        assert!(matches!(
            stream_events[0],
            AgentEvent::RunStarted { ref loom_id, .. }
            if loom_id.as_deref() == Some("test-loom")
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
            AgentEvent::ToolPermissionEvaluated {
                ref tool_name,
                status: ToolPermissionStatus::UnknownTool,
                ..
            } if tool_name == "dummy_placeholder_tool"
        ));
        assert!(matches!(
            stream_events[8],
            AgentEvent::ToolCallSkipped { ref tool_name, .. } if tool_name == "dummy_placeholder_tool"
        ));
        assert!(matches!(
            stream_events[9],
            AgentEvent::StepStarted {
                kind: AgentStepKind::ArtifactPlaceholder,
                ..
            }
        ));
        assert!(matches!(
            stream_events[10],
            AgentEvent::ArtifactCreated { ref artifact_id, .. } if artifact_id == "dummy_placeholder_artifact"
        ));
        assert!(matches!(
            stream_events[11],
            AgentEvent::StepStarted {
                kind: AgentStepKind::ValidationPlaceholder,
                ..
            }
        ));
        // Terminal event must carry the same run_id as RunStarted.
        assert!(matches!(
            stream_events[12],
            AgentEvent::RunCompleted { run_id: ref actual, .. } if actual == &run_id
        ));
        assert_eq!(stream_events.len(), 13);
        assert_eq!(terminal_event_count(&stream_events), 1);
    }

    #[tokio::test]
    async fn test_agent_runtime_provider_runtime_reflects_completion() {
        let events = vec![
            ProviderContractEvent::Delta {
                text: "hello".to_string(),
            },
            ProviderContractEvent::Completed {
                done_reason: Some("stop".to_string()),
                usage: ProviderUsageMetadata::unavailable("no-usage"),
            },
        ];
        let (runtime, _) = make_test_runtime(events);
        let request = make_request("provider-runtime-completion");

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        let run_id = extract_run_id(&stream_events);
        let execution_id = format!("{run_id}-provider-exec");

        let execution = runtime
            .provider_runtime()
            .get_execution(&execution_id)
            .expect("lookup does not error")
            .expect("provider execution recorded for this run");
        assert_eq!(
            execution.status,
            crate::provider_runtime::ProviderExecutionStatus::Completed
        );
        assert_eq!(
            execution.safe_summary.as_deref(),
            Some("provider_call_completed_via_bridge")
        );

        let serialized = serde_json::to_string(&execution).expect("serialize execution");
        assert!(!serialized.to_ascii_lowercase().contains("prompt"));
        assert!(!serialized.to_ascii_lowercase().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn test_agent_runtime_provider_runtime_reflects_failure() {
        let error = ProviderError::new(ProviderErrorKind::Unauthorized, ProviderKind::Ollama)
            .with_technical_message("auth failed");
        let events = vec![ProviderContractEvent::Error { error }];
        let (runtime, _) = make_test_runtime(events);
        let request = make_request("provider-runtime-failure");

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        let run_id = extract_run_id(&stream_events);
        let execution_id = format!("{run_id}-provider-exec");

        let execution = runtime
            .provider_runtime()
            .get_execution(&execution_id)
            .expect("lookup does not error")
            .expect("provider execution recorded for this run");
        assert_eq!(
            execution.status,
            crate::provider_runtime::ProviderExecutionStatus::Failed
        );
        assert_eq!(
            execution.safe_error_code.as_deref(),
            Some("provider_call_failed")
        );
    }

    #[tokio::test]
    async fn test_agent_runtime_provider_runtime_reflects_cancellation() {
        let events = vec![
            ProviderContractEvent::Delta {
                text: "partial".to_string(),
            },
            ProviderContractEvent::Cancelled,
        ];
        let (runtime, _) = make_test_runtime(events);
        let request = make_request("provider-runtime-cancel");

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        let run_id = extract_run_id(&stream_events);
        let execution_id = format!("{run_id}-provider-exec");

        let execution = runtime
            .provider_runtime()
            .get_execution(&execution_id)
            .expect("lookup does not error")
            .expect("provider execution recorded for this run");
        assert_eq!(
            execution.status,
            crate::provider_runtime::ProviderExecutionStatus::Cancelled
        );
    }

    #[tokio::test]
    async fn test_agent_runtime_builds_provider_messages_from_legacy_context_manager() {
        let events = vec![ProviderContractEvent::Completed {
            done_reason: Some("stop".to_string()),
            usage: ProviderUsageMetadata::unavailable("no-usage"),
        }];
        let (runtime, state) = make_test_runtime(events);
        let mut request = make_request("legacy-context-response");
        request.context_snapshot_id = Some("snapshot-deferred".to_string());
        request.legacy_context = Some(legacy_context_input());

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        assert!(matches!(
            stream_events.last(),
            Some(AgentEvent::RunCompleted { .. })
        ));

        let provider_request = state
            .lock()
            .unwrap()
            .last_request
            .clone()
            .expect("provider request captured");

        assert!(provider_request.messages.len() > 1);
        assert!(provider_request.messages.iter().any(|message| {
            message.role == ProviderContractMessageRole::System
                && message.content.contains("Recent user turn")
        }));
        assert!(provider_request.messages.iter().any(|message| {
            message.role == ProviderContractMessageRole::System
                && message.content.contains("Selected reference fragment")
        }));
        assert!(provider_request.messages.iter().any(|message| {
            message.role == ProviderContractMessageRole::System
                && message.content.contains("Capsule summary text")
        }));
        assert!(provider_request.messages.iter().any(|message| {
            message.role == ProviderContractMessageRole::System
                && message.content.contains("Weft origin background")
        }));
        assert!(provider_request.messages.iter().any(|message| {
            message.role == ProviderContractMessageRole::System
                && message.content.contains("Saved memory context")
        }));
        assert!(provider_request.messages.iter().any(|message| {
            message.role == ProviderContractMessageRole::User
                && message.content == "Use the legacy context."
        }));

        let metadata = provider_request.loom_context_metadata;
        assert_eq!(metadata["contextBuilt"], true);
        assert_eq!(metadata["contextSource"], "legacy_context_manager");
        assert_eq!(metadata["contextSnapshotId"], "snapshot-deferred");
        assert!(metadata["messageCount"].as_u64().unwrap_or_default() > 1);
        assert_eq!(metadata["responseCapsuleCount"], 1);
        assert_eq!(metadata["referenceCapsuleCount"], 1);
        assert_eq!(metadata["hasWeftOrigin"], true);

        let serialized_metadata = serde_json::to_string(&metadata).expect("metadata json");
        assert!(!serialized_metadata.contains("Selected reference fragment"));
        assert!(!serialized_metadata.contains("Capsule summary text"));
        assert!(!serialized_metadata.contains("Weft origin background"));
        assert!(!serialized_metadata.contains("Saved memory context"));
        assert!(!serialized_metadata.contains("Use the legacy context."));
    }

    #[tokio::test]
    async fn test_agent_runtime_without_legacy_context_preserves_minimal_request_path() {
        let events = vec![ProviderContractEvent::Completed {
            done_reason: Some("stop".to_string()),
            usage: ProviderUsageMetadata::unavailable("no-usage"),
        }];
        let (runtime, state) = make_test_runtime(events);
        let request = make_request("minimal-context-response");

        let _ = runtime.execute_run(request).collect::<Vec<_>>().await;
        let provider_request = state
            .lock()
            .unwrap()
            .last_request
            .clone()
            .expect("provider request captured");

        assert_eq!(provider_request.messages.len(), 1);
        assert_eq!(
            provider_request.messages[0].role,
            ProviderContractMessageRole::User
        );
        assert_eq!(provider_request.messages[0].content, "ping");
        assert_eq!(
            provider_request.loom_context_metadata["contextBuilt"],
            false
        );
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

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        let run_id = AgentRunId::from(extract_run_id(&stream_events));

        let run = runtime
            .run_store()
            .get(&run_id)
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
    async fn test_agent_runtime_run_has_correlation_id_equal_to_run_id() {
        let events = vec![ProviderContractEvent::Completed {
            done_reason: Some("stop".to_string()),
            usage: ProviderUsageMetadata::unavailable("no-usage"),
        }];
        let (runtime, _) = make_test_runtime(events);
        let stream_events = runtime
            .execute_run(make_request("r"))
            .collect::<Vec<_>>()
            .await;
        let run_id = AgentRunId::from(extract_run_id(&stream_events));
        let run = runtime.run_store().get(&run_id).expect("run");
        assert_eq!(run.correlation_id, run_id.as_str());
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
        let run_id = AgentRunId::from(extract_run_id(&stream_events));
        let serialized = serde_json::to_string(&stream_events).expect("serialize");

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

        let run = runtime.run_store().get(&run_id).expect("run recorded");
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

        let run_id = AgentRunId::from(extract_run_id(&stream_events));
        let run = runtime.run_store().get(&run_id).expect("run recorded");
        assert_eq!(run.status, AgentRunStatus::Failed);
        assert_eq!(terminal_event_count(&stream_events), 1);
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

        let run_id = extract_run_id(&stream_events);
        assert!(matches!(
            stream_events[4],
            AgentEvent::RunCancelled { run_id: ref actual } if actual == &run_id
        ));

        let run = runtime
            .run_store()
            .get(&AgentRunId::from(run_id))
            .expect("run recorded");
        assert_eq!(run.status, AgentRunStatus::Cancelled);
        assert_eq!(terminal_event_count(&stream_events), 1);
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
        let permission = stream_events
            .iter()
            .position(|e| matches!(e, AgentEvent::ToolPermissionEvaluated { .. }))
            .expect("tool permission evaluated");
        let skipped = stream_events
            .iter()
            .position(|e| matches!(e, AgentEvent::ToolCallSkipped { .. }))
            .expect("tool call skipped");
        assert_eq!(permission, requested + 1, "permission follows request");
        assert_eq!(skipped, permission + 1, "skip follows permission decision");

        assert!(state.lock().unwrap().cancel_called_with.is_none());
    }

    #[test]
    fn test_agent_event_serialization_has_no_thinking_fields() {
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
            AgentEvent::ToolPermissionEvaluated {
                run_id: "r".into(),
                step_id: "s".into(),
                tool_name: "t".into(),
                status: ToolPermissionStatus::UnknownTool,
                reason: Some("tool is not registered".into()),
            },
            AgentEvent::ToolCallSkipped {
                run_id: "r".into(),
                step_id: "s".into(),
                tool_name: "t".into(),
                reason: "foundation phase".into(),
            },
            AgentEvent::ToolCallCompleted {
                run_id: "r".into(),
                step_id: "s".into(),
                call_id: "c".into(),
                tool_name: "t".into(),
                output_summary: Some("summary".into()),
            },
            AgentEvent::ToolCallFailed {
                run_id: "r".into(),
                step_id: "s".into(),
                call_id: "c".into(),
                tool_name: "t".into(),
                error_code: "TOOL_FAILED".into(),
                error_message: "safe message".into(),
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
            "apikey",
            "api_key",
            "secret",
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

    #[tokio::test]
    async fn test_agent_runtime_persists_step_lifecycle_and_safe_events() {
        let events = vec![ProviderContractEvent::Completed {
            done_reason: Some("stop".to_string()),
            usage: ProviderUsageMetadata::unavailable("no-usage"),
        }];
        let (pipeline, _) = crate::agent_runtime::test_support::make_test_pipeline(events);
        let database = crate::storage::db::test_database().await;
        let repo = AgentRunRepository::from_pool(database.pool());
        let runtime = AgentRuntime::new(pipeline).with_repository(repo.clone());

        let stream_events = runtime
            .execute_run(make_request("persisted-response"))
            .collect::<Vec<_>>()
            .await;
        let run_id = stream_events
            .iter()
            .find_map(|event| match event {
                AgentEvent::RunStarted { run_id, .. } => Some(run_id.clone()),
                _ => None,
            })
            .expect("run id");

        let steps = repo.list_steps_for_run(&run_id).await.unwrap();
        assert_eq!(steps.len(), 5);
        assert_eq!(steps[0].kind, "context_build");
        assert_eq!(steps[0].status, "completed");
        assert_eq!(steps[1].kind, "provider_call");
        assert_eq!(steps[1].status, "completed");
        assert_eq!(steps[2].kind, "tool_call_placeholder");
        assert_eq!(steps[2].status, "skipped");
        assert!(steps.iter().all(|step| step.completed_at.is_some()));

        let durable_events = repo.list_events_for_run(&run_id, 0, 100).await.unwrap();
        assert_eq!(
            durable_events
                .iter()
                .filter(|event| event.event_type.starts_with("run_")
                    && event.event_type != "run_started")
                .count(),
            1
        );
        assert!(durable_events.iter().all(|event| {
            event
                .payload_json
                .as_deref()
                .map(|payload| !payload.contains("persisted-response"))
                .unwrap_or(true)
        }));
        assert!(durable_events
            .iter()
            .filter(|event| event.event_type == "step_started")
            .all(|event| event.agent_step_id.is_some()));
    }

    #[tokio::test]
    async fn test_legacy_context_content_is_not_persisted_in_agent_events() {
        let events = vec![ProviderContractEvent::Completed {
            done_reason: Some("stop".to_string()),
            usage: ProviderUsageMetadata::unavailable("no-usage"),
        }];
        let (pipeline, _) = crate::agent_runtime::test_support::make_test_pipeline(events);
        let database = crate::storage::db::test_database().await;
        let repo = AgentRunRepository::from_pool(database.pool());
        let runtime = AgentRuntime::new(pipeline).with_repository(repo.clone());
        let mut request = make_request("legacy-context-persisted-response");
        request.legacy_context = Some(legacy_context_input());

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        let run_id = extract_run_id(&stream_events);
        let durable_events = repo.list_events_for_run(&run_id, 0, 100).await.unwrap();
        let serialized_events = serde_json::to_string(&durable_events).expect("events json");

        assert!(!serialized_events.contains("Selected reference fragment"));
        assert!(!serialized_events.contains("Capsule summary text"));
        assert!(!serialized_events.contains("Weft origin background"));
        assert!(!serialized_events.contains("Saved memory context"));
        assert!(!serialized_events.contains("Use the legacy context."));
        assert!(!serialized_events.contains("raw_thinking"));
        assert!(!serialized_events.contains("chain_of_thought"));
        assert!(!serialized_events.contains("hidden_reasoning"));
    }

    #[tokio::test]
    async fn test_execute_run_uses_uuid_run_id_not_response_id() {
        let events = vec![ProviderContractEvent::Completed {
            done_reason: Some("stop".to_string()),
            usage: ProviderUsageMetadata::unavailable("no-usage"),
        }];
        let (runtime, _) = make_test_runtime(events);
        let request = make_request("my-response-id");

        let stream_events = runtime.execute_run(request).collect::<Vec<_>>().await;
        let run_id = extract_run_id(&stream_events);

        // The run_id must be a UUID v4, not derived from response_id.
        assert_ne!(run_id, "my-response-id");
        assert!(
            uuid::Uuid::parse_str(&run_id).is_ok(),
            "run_id must be a valid UUID: {run_id}"
        );

        // The stored run retains the response_id as a separate product reference.
        let stored = runtime
            .run_store()
            .get(&AgentRunId::from(run_id))
            .expect("run in store");
        assert_eq!(stored.response_id.as_deref(), Some("my-response-id"));
    }
}
