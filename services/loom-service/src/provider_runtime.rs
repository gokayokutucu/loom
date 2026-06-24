#![allow(dead_code)]
// LOOM_BOUNDARY:
// marker: V2_EXPERIMENTAL_DISCONNECTED
// owner_layer: V2 Runtime
// migration_status: disconnected
// rules:
// - ProviderRuntimeService is the canonical safe provider execution seam for V2.
// - Do not persist prompts, provider payloads, raw output, tokens, secrets, or raw thinking.
// next_task: PROVIDER-RUNTIME-BRIDGE-001
//! Provider Runtime seam.
//!
//! This module owns provider execution metadata and lifecycle orchestration for
//! AgentRun-bound model work. It intentionally performs no real provider calls,
//! opens no streams, and stores no prompt, provider envelope, raw output, token,
//! secret, or raw-thinking content.

use crate::error::ServiceError;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};

const NOOP_PROVIDER_SUMMARY: &str = "Noop provider completed without model execution.";

const FORBIDDEN_PROVIDER_RUNTIME_MARKERS: [&str; 24] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "prompt",
    "provider_request",
    "provider_response",
    "provider_payload",
    "provider_envelope",
    "raw_response",
    "raw_output",
    "completion",
    "messages",
    "stdout",
    "stderr",
    "authorization",
    "bearer",
    "apikey",
    "api_key",
    "password",
    "credential",
    "client_secret",
    "secret",
    "sk-",
];

fn now_epoch_ms() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    ms.to_string()
}

fn validate_safe_provider_runtime_text(label: &str, value: &str) -> Result<(), ServiceError> {
    let lower = value.to_ascii_lowercase();
    for marker in FORBIDDEN_PROVIDER_RUNTIME_MARKERS {
        if lower.contains(marker) {
            return Err(ServiceError::storage(format!(
                "{label} contains forbidden provider runtime marker: {marker}"
            )));
        }
    }
    Ok(())
}

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: V2 Runtime
// migration_status: canonical
// rules:
// - Provider execution statuses are the canonical V2 provider lifecycle vocabulary.
// - Do not add provider-specific wire states here.
// next_task: PROVIDER-RUNTIME-BRIDGE-001
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderExecutionStatus {
    Requested,
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    TimedOut,
    Skipped,
}

impl ProviderExecutionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
            Self::Skipped => "skipped",
        }
    }

    fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::TimedOut | Self::Skipped
        )
    }
}

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: V2 Runtime
// migration_status: canonical
// rules:
// - Request carries metadata only for AgentRun-bound provider execution.
// - Never add prompt text, provider envelopes, secrets, or raw thinking fields.
// next_task: PROVIDER-RUNTIME-BRIDGE-001
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderExecutionRequest {
    pub execution_id: String,
    pub root_run_id: String,
    pub agent_run_id: String,
    pub provider_profile_id: Option<String>,
    pub model_id: Option<String>,
    pub requested_at: Option<String>,
    pub timeout_ms: Option<i64>,
    pub diagnostics_json: Option<String>,
    pub auto_complete_noop: bool,
    pub force_noop_failure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderExecutionResult {
    pub execution_id: String,
    pub root_run_id: String,
    pub agent_run_id: String,
    pub provider_profile_id: Option<String>,
    pub model_id: Option<String>,
    pub status: ProviderExecutionStatus,
    pub requested_at: String,
    pub queued_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub failed_at: Option<String>,
    pub cancelled_at: Option<String>,
    pub timed_out_at: Option<String>,
    pub skipped_at: Option<String>,
    pub timeout_ms: Option<i64>,
    pub safe_summary: Option<String>,
    pub safe_error_code: Option<String>,
    pub diagnostics_json: Option<String>,
    pub events: Vec<ProviderRuntimeEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRuntimeEvent {
    pub execution_id: String,
    pub root_run_id: String,
    pub agent_run_id: String,
    pub event_type: String,
    pub status: ProviderExecutionStatus,
    pub occurred_at: String,
    pub safe_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProviderExecutionRecord {
    execution_id: String,
    root_run_id: String,
    agent_run_id: String,
    provider_profile_id: Option<String>,
    model_id: Option<String>,
    status: ProviderExecutionStatus,
    requested_at: String,
    queued_at: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    failed_at: Option<String>,
    cancelled_at: Option<String>,
    timed_out_at: Option<String>,
    skipped_at: Option<String>,
    timeout_ms: Option<i64>,
    safe_summary: Option<String>,
    safe_error_code: Option<String>,
    diagnostics_json: Option<String>,
    events: Vec<ProviderRuntimeEvent>,
}

impl ProviderExecutionRecord {
    fn from_request(request: ProviderExecutionRequest) -> Self {
        Self {
            execution_id: request.execution_id,
            root_run_id: request.root_run_id,
            agent_run_id: request.agent_run_id,
            provider_profile_id: request.provider_profile_id,
            model_id: request.model_id,
            status: ProviderExecutionStatus::Requested,
            requested_at: request.requested_at.unwrap_or_else(now_epoch_ms),
            queued_at: None,
            started_at: None,
            completed_at: None,
            failed_at: None,
            cancelled_at: None,
            timed_out_at: None,
            skipped_at: None,
            timeout_ms: request.timeout_ms,
            safe_summary: None,
            safe_error_code: None,
            diagnostics_json: request.diagnostics_json,
            events: Vec::new(),
        }
    }

    fn to_result(&self) -> ProviderExecutionResult {
        ProviderExecutionResult {
            execution_id: self.execution_id.clone(),
            root_run_id: self.root_run_id.clone(),
            agent_run_id: self.agent_run_id.clone(),
            provider_profile_id: self.provider_profile_id.clone(),
            model_id: self.model_id.clone(),
            status: self.status,
            requested_at: self.requested_at.clone(),
            queued_at: self.queued_at.clone(),
            started_at: self.started_at.clone(),
            completed_at: self.completed_at.clone(),
            failed_at: self.failed_at.clone(),
            cancelled_at: self.cancelled_at.clone(),
            timed_out_at: self.timed_out_at.clone(),
            skipped_at: self.skipped_at.clone(),
            timeout_ms: self.timeout_ms,
            safe_summary: self.safe_summary.clone(),
            safe_error_code: self.safe_error_code.clone(),
            diagnostics_json: self.diagnostics_json.clone(),
            events: self.events.clone(),
        }
    }

    fn push_event(&mut self, event_type: &'static str, safe_code: Option<&str>) {
        self.events.push(ProviderRuntimeEvent {
            execution_id: self.execution_id.clone(),
            root_run_id: self.root_run_id.clone(),
            agent_run_id: self.agent_run_id.clone(),
            event_type: event_type.to_string(),
            status: self.status,
            occurred_at: now_epoch_ms(),
            safe_code: safe_code.map(ToString::to_string),
        });
    }
}

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: V2 Runtime
// migration_status: needs_bridge
// rules:
// - Canonical safe provider execution seam; currently not wired into AgentRuntime.
// - AgentRuntime should route provider work through this service in a bridge task.
// next_task: PROVIDER-RUNTIME-BRIDGE-001
#[derive(Debug, Clone, Default)]
pub struct ProviderRuntimeService {
    records: Arc<RwLock<HashMap<String, ProviderExecutionRecord>>>,
}

impl ProviderRuntimeService {
    pub fn new() -> Self {
        Self::default()
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V2_EXPERIMENTAL_DISCONNECTED
    // role: test-only no-I/O provider execution lifecycle
    // rules: Keep as metadata-only until real provider bridge is designed and implemented.
    // next_task: PROVIDER-RUNTIME-BRIDGE-001
    pub fn submit_noop(
        &self,
        request: ProviderExecutionRequest,
    ) -> Result<ProviderExecutionResult, ServiceError> {
        validate_request(&request)?;
        let execution_id = request.execution_id.clone();
        let auto_complete_noop = request.auto_complete_noop;
        let force_noop_failure = request.force_noop_failure;

        let mut record = ProviderExecutionRecord::from_request(request);
        record.push_event("provider_execution_requested", None);

        {
            let mut records = self.records.write().unwrap();
            if records.contains_key(&execution_id) {
                return Err(ServiceError::storage(
                    "provider execution already exists for execution_id",
                ));
            }
            records.insert(execution_id.clone(), record);
        }

        self.transition_to_queued(&execution_id)?;

        if !auto_complete_noop {
            return self
                .get_execution(&execution_id)?
                .ok_or_else(|| ServiceError::storage("provider execution not found"));
        }

        self.transition_to_running(&execution_id)?;
        if force_noop_failure {
            return self.fail_execution(&execution_id, "noop_provider_failure");
        }
        self.complete_noop(&execution_id)
    }

    pub fn get_execution(
        &self,
        execution_id: &str,
    ) -> Result<Option<ProviderExecutionResult>, ServiceError> {
        validate_safe_provider_runtime_text("provider execution id", execution_id)?;
        Ok(self
            .records
            .read()
            .unwrap()
            .get(execution_id)
            .map(ProviderExecutionRecord::to_result))
    }

    pub fn transition_to_queued(
        &self,
        execution_id: &str,
    ) -> Result<ProviderExecutionResult, ServiceError> {
        self.transition(execution_id, ProviderExecutionStatus::Queued, None)
    }

    pub fn transition_to_running(
        &self,
        execution_id: &str,
    ) -> Result<ProviderExecutionResult, ServiceError> {
        self.transition(execution_id, ProviderExecutionStatus::Running, None)
    }

    pub fn complete_noop(
        &self,
        execution_id: &str,
    ) -> Result<ProviderExecutionResult, ServiceError> {
        self.transition(
            execution_id,
            ProviderExecutionStatus::Completed,
            Some(NOOP_PROVIDER_SUMMARY),
        )
    }

    pub fn fail_execution(
        &self,
        execution_id: &str,
        safe_error_code: &str,
    ) -> Result<ProviderExecutionResult, ServiceError> {
        validate_safe_provider_runtime_text("provider safe_error_code", safe_error_code)?;
        self.transition(
            execution_id,
            ProviderExecutionStatus::Failed,
            Some(safe_error_code),
        )
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V2_CANONICAL_RUNTIME
    // role: idempotent provider execution cancellation metadata transition
    // rules: Cancellation must remain metadata-only and must not attempt provider I/O here.
    // next_task: PROVIDER-RUNTIME-BRIDGE-001
    pub fn cancel_execution(
        &self,
        execution_id: &str,
    ) -> Result<ProviderExecutionResult, ServiceError> {
        self.transition(execution_id, ProviderExecutionStatus::Cancelled, None)
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V2_CANONICAL_RUNTIME
    // role: marks provider execution timeout safely
    // rules: Timeout state carries safe code/metadata only, never raw provider response.
    // next_task: PROVIDER-RUNTIME-BRIDGE-001
    pub fn timeout_execution(
        &self,
        execution_id: &str,
    ) -> Result<ProviderExecutionResult, ServiceError> {
        self.transition(execution_id, ProviderExecutionStatus::TimedOut, None)
    }

    pub fn skip_execution(
        &self,
        execution_id: &str,
        safe_reason_code: &str,
    ) -> Result<ProviderExecutionResult, ServiceError> {
        validate_safe_provider_runtime_text("provider skip reason", safe_reason_code)?;
        self.transition(
            execution_id,
            ProviderExecutionStatus::Skipped,
            Some(safe_reason_code),
        )
    }

    fn transition(
        &self,
        execution_id: &str,
        target: ProviderExecutionStatus,
        safe_detail: Option<&str>,
    ) -> Result<ProviderExecutionResult, ServiceError> {
        validate_safe_provider_runtime_text("provider execution id", execution_id)?;
        if let Some(detail) = safe_detail {
            validate_safe_provider_runtime_text("provider execution detail", detail)?;
        }

        let mut records = self.records.write().unwrap();
        let record = records
            .get_mut(execution_id)
            .ok_or_else(|| ServiceError::storage("provider execution not found"))?;

        if record.status == ProviderExecutionStatus::Cancelled
            && target == ProviderExecutionStatus::Cancelled
        {
            return Ok(record.to_result());
        }

        if record.status.is_terminal() {
            return Ok(record.to_result());
        }

        let valid = matches!(
            (record.status, target),
            (
                ProviderExecutionStatus::Requested,
                ProviderExecutionStatus::Queued
            ) | (
                ProviderExecutionStatus::Queued,
                ProviderExecutionStatus::Running
            ) | (
                ProviderExecutionStatus::Queued,
                ProviderExecutionStatus::Cancelled
            ) | (
                ProviderExecutionStatus::Queued,
                ProviderExecutionStatus::Skipped
            ) | (
                ProviderExecutionStatus::Running,
                ProviderExecutionStatus::Completed
            ) | (
                ProviderExecutionStatus::Running,
                ProviderExecutionStatus::Failed
            ) | (
                ProviderExecutionStatus::Running,
                ProviderExecutionStatus::Cancelled
            ) | (
                ProviderExecutionStatus::Running,
                ProviderExecutionStatus::TimedOut
            ) | (
                ProviderExecutionStatus::Requested,
                ProviderExecutionStatus::Skipped
            )
        );
        if !valid {
            return Err(ServiceError::storage(format!(
                "invalid provider execution transition from {} to {}",
                record.status.as_str(),
                target.as_str()
            )));
        }

        record.status = target;
        match target {
            ProviderExecutionStatus::Queued => {
                record.queued_at = Some(now_epoch_ms());
                record.push_event("provider_execution_queued", None);
            }
            ProviderExecutionStatus::Running => {
                record.started_at = Some(now_epoch_ms());
                record.push_event("provider_execution_started", None);
            }
            ProviderExecutionStatus::Completed => {
                record.completed_at = Some(now_epoch_ms());
                record.safe_summary = safe_detail.map(ToString::to_string);
                record.push_event("provider_execution_completed", Some("noop_completed"));
            }
            ProviderExecutionStatus::Failed => {
                record.failed_at = Some(now_epoch_ms());
                record.safe_error_code = safe_detail.map(ToString::to_string);
                record.push_event("provider_execution_failed", safe_detail);
            }
            ProviderExecutionStatus::Cancelled => {
                record.cancelled_at = Some(now_epoch_ms());
                record.push_event("provider_execution_cancelled", Some("cancelled"));
            }
            ProviderExecutionStatus::TimedOut => {
                record.timed_out_at = Some(now_epoch_ms());
                record.safe_error_code = Some("provider_execution_timed_out".to_string());
                record.push_event("provider_execution_timed_out", Some("timed_out"));
            }
            ProviderExecutionStatus::Skipped => {
                record.skipped_at = Some(now_epoch_ms());
                record.safe_error_code = safe_detail.map(ToString::to_string);
                record.push_event("provider_execution_skipped", safe_detail);
            }
            ProviderExecutionStatus::Requested => {}
        }

        Ok(record.to_result())
    }
}

// LOOM_BOUNDARY_METHOD:
// marker: V2_CANONICAL_RUNTIME
// role: enforces provider-runtime privacy markers before metadata is stored
// rules: Reject prompt/provider payload/secret/raw-thinking markers at the seam.
// next_task: none
fn validate_request(request: &ProviderExecutionRequest) -> Result<(), ServiceError> {
    validate_safe_provider_runtime_text("provider execution_id", &request.execution_id)?;
    validate_safe_provider_runtime_text("provider root_run_id", &request.root_run_id)?;
    validate_safe_provider_runtime_text("provider agent_run_id", &request.agent_run_id)?;
    if let Some(provider_profile_id) = request.provider_profile_id.as_deref() {
        validate_safe_provider_runtime_text("provider profile id", provider_profile_id)?;
    }
    if let Some(model_id) = request.model_id.as_deref() {
        validate_safe_provider_runtime_text("provider model id", model_id)?;
    }
    if let Some(requested_at) = request.requested_at.as_deref() {
        validate_safe_provider_runtime_text("provider requested_at", requested_at)?;
    }
    if let Some(diagnostics) = request.diagnostics_json.as_deref() {
        validate_safe_provider_runtime_text("provider diagnostics_json", diagnostics)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(execution_id: &str) -> ProviderExecutionRequest {
        ProviderExecutionRequest {
            execution_id: execution_id.to_string(),
            root_run_id: "run-root".to_string(),
            agent_run_id: "run-root".to_string(),
            provider_profile_id: Some("provider-profile-local".to_string()),
            model_id: Some("noop-model".to_string()),
            requested_at: Some("1700000000000".to_string()),
            timeout_ms: Some(1000),
            diagnostics_json: Some(r#"{"queueDepth":0,"activeCalls":0}"#.to_string()),
            auto_complete_noop: true,
            force_noop_failure: false,
        }
    }

    #[test]
    fn noop_provider_request_queues_runs_and_completes() {
        let runtime = ProviderRuntimeService::new();
        let result = runtime
            .submit_noop(request("provider-exec-complete"))
            .unwrap();

        assert_eq!(result.status, ProviderExecutionStatus::Completed);
        assert_eq!(result.safe_summary.as_deref(), Some(NOOP_PROVIDER_SUMMARY));
        assert!(result.queued_at.is_some());
        assert!(result.started_at.is_some());
        assert!(result.completed_at.is_some());
        assert_eq!(
            result
                .events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<_>>(),
            vec![
                "provider_execution_requested",
                "provider_execution_queued",
                "provider_execution_started",
                "provider_execution_completed"
            ]
        );
    }

    #[test]
    fn noop_provider_failure_path_is_safe() {
        let runtime = ProviderRuntimeService::new();
        let mut failing = request("provider-exec-failed");
        failing.force_noop_failure = true;

        let result = runtime.submit_noop(failing).unwrap();

        assert_eq!(result.status, ProviderExecutionStatus::Failed);
        assert_eq!(
            result.safe_error_code.as_deref(),
            Some("noop_provider_failure")
        );
        assert!(result.failed_at.is_some());
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("prompt"));
        assert!(!serialized.contains("provider_payload"));
        assert!(!serialized.contains("raw_response"));
        assert!(!serialized.contains("raw_thinking"));
    }

    #[test]
    fn cancellation_path_is_idempotent() {
        let runtime = ProviderRuntimeService::new();
        let mut queued = request("provider-exec-cancelled");
        queued.auto_complete_noop = false;
        let queued_result = runtime.submit_noop(queued).unwrap();
        assert_eq!(queued_result.status, ProviderExecutionStatus::Queued);

        let first = runtime.cancel_execution("provider-exec-cancelled").unwrap();
        let second = runtime.cancel_execution("provider-exec-cancelled").unwrap();

        assert_eq!(first.status, ProviderExecutionStatus::Cancelled);
        assert_eq!(second.status, ProviderExecutionStatus::Cancelled);
        assert_eq!(
            second
                .events
                .iter()
                .filter(|event| event.event_type == "provider_execution_cancelled")
                .count(),
            1
        );
    }

    #[test]
    fn timeout_path_is_safe() {
        let runtime = ProviderRuntimeService::new();
        let mut running = request("provider-exec-timeout");
        running.auto_complete_noop = false;
        runtime.submit_noop(running).unwrap();
        runtime
            .transition_to_running("provider-exec-timeout")
            .unwrap();

        let result = runtime.timeout_execution("provider-exec-timeout").unwrap();

        assert_eq!(result.status, ProviderExecutionStatus::TimedOut);
        assert_eq!(
            result.safe_error_code.as_deref(),
            Some("provider_execution_timed_out")
        );
        assert!(result.timed_out_at.is_some());
    }

    #[test]
    fn forbidden_markers_in_request_metadata_are_rejected() {
        let runtime = ProviderRuntimeService::new();
        let mut bad = request("provider-exec-forbidden");
        bad.diagnostics_json = Some(r#"{"prompt":"leak"}"#.to_string());

        let error = runtime.submit_noop(bad).unwrap_err();

        assert!(error.to_string().contains("prompt"));
        assert!(runtime
            .get_execution("provider-exec-forbidden")
            .unwrap()
            .is_none());
    }

    #[test]
    fn provider_runtime_results_have_no_payload_prompt_response_fields() {
        let runtime = ProviderRuntimeService::new();
        let result = runtime
            .submit_noop(request("provider-exec-privacy"))
            .unwrap();
        let serialized = serde_json::to_string(&result).unwrap();

        for forbidden in [
            "providerRequest",
            "providerResponse",
            "providerPayload",
            "providerEnvelope",
            "prompt",
            "rawOutput",
            "rawResponse",
            "rawThinking",
            "thinkingText",
            "chainOfThought",
            "hiddenReasoning",
            "token",
            "secret",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "provider runtime result must not contain {forbidden}"
            );
        }
    }

    #[test]
    fn provider_runtime_prepares_metadata_only_events() {
        let runtime = ProviderRuntimeService::new();
        let result = runtime
            .submit_noop(request("provider-exec-events"))
            .unwrap();

        for event in &result.events {
            let serialized = serde_json::to_string(event).unwrap();
            assert!(serialized.contains("provider_execution_"));
            assert!(!serialized.contains("prompt"));
            assert!(!serialized.contains("raw_output"));
            assert!(!serialized.contains("raw_thinking"));
            assert!(!serialized.contains("provider_payload"));
        }
    }

    #[test]
    fn skipped_execution_is_terminal_without_model_execution() {
        let runtime = ProviderRuntimeService::new();
        let mut queued = request("provider-exec-skipped");
        queued.auto_complete_noop = false;
        runtime.submit_noop(queued).unwrap();

        let result = runtime
            .skip_execution("provider-exec-skipped", "policy_skipped")
            .unwrap();

        assert_eq!(result.status, ProviderExecutionStatus::Skipped);
        assert_eq!(result.safe_error_code.as_deref(), Some("policy_skipped"));
        assert!(result.skipped_at.is_some());
        assert!(result.completed_at.is_none());
    }

    #[test]
    fn provider_runtime_static_guard_no_real_execution() {
        let source = include_str!("provider_runtime.rs");
        let forbidden = [
            concat!("Ollama", "Runtime"),
            concat!("Provider", "Pipeline"),
            concat!("Provider", "Registry"),
            concat!("req", "west::"),
            concat!("Tcp", "Stream"),
            concat!("std::", "net"),
            concat!("generate", "Content"),
            concat!("chat/", "completions"),
        ];
        for marker in forbidden {
            let marker = marker.to_string();
            assert!(
                !source.contains(&marker),
                "provider runtime seam must not import or call real provider execution: {marker}"
            );
        }
        for marker in [
            concat!("Ollama", "Runtime"),
            concat!("Provider", "Pipeline"),
            concat!("Provider", "Registry"),
            concat!("req", "west::"),
            concat!("Tcp", "Stream"),
            concat!("std::", "net"),
            concat!("generate", "Content"),
            concat!("chat/", "completions"),
        ] {
            assert!(
                !source.contains(marker),
                "provider runtime seam must not import or call real provider execution: {marker}"
            );
        }
    }
}
