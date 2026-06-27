#![allow(dead_code)]
// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Tool Runtime
// migration_status: canonical
// rules:
// - ToolAdapter is the canonical execution contract every future adapter (File, Web
//   Search, OCR, Browser, Shell, MCP, Memory, External APIs) must implement.
// - This module defines the contract only. It performs no execution itself.
// - Do not import process-spawning, raw socket, or provider/MCP-specific
//   execution machinery into this file — that belongs in a concrete adapter
//   implementation, not in the contract (see
//   tool_adapter_contract_static_guard_no_real_execution below).
// - ToolSchedulerRuntime/ToolSchedulerRepository remain unmodified and unaware of
//   any concrete adapter; this contract is the seam a future
//   TOOL-SCHEDULER-BRIDGE-001 task would route through.
// next_task: TOOL-SCHEDULER-BRIDGE-001
//! Tool Runtime Adapter Contract.
//!
//! This module defines the canonical execution interface every future tool
//! adapter must implement (File, Web Search, OCR, Browser, Shell, MCP, Memory,
//! External APIs, ...). It deliberately contains no execution logic, no real
//! adapter implementation, and no scheduler/AgentRun changes — it exists so
//! that every future adapter implements one shape instead of inventing its
//! own. See `docs/tool_runtime_implementation_state_audit.md` §1 (#5, #15-20)
//! and §5 task 1 for the audit finding that motivated this contract.
//!
//! Structural privacy guarantee: [`ToolAdapterRequest`] and [`ToolAdapterResult`]
//! have no field that could hold a prompt, provider payload, raw thinking, raw
//! stdout/stderr, file contents, or credentials — there is no such field to
//! populate, by construction, not just by runtime validation. Free-text fields
//! (`safe_summary`, `safe_label`, `safe_code`, `safe_message`, JSON metadata
//! values) are additionally validated against the same forbidden-marker list
//! [`storage::repositories::tool_scheduler`] already enforces for persisted
//! scheduler text, so a future adapter cannot smuggle disallowed content
//! through a free-text field either.

use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::watch;

use crate::agent_runtime::tools::SafeToolArguments;
use crate::error::ServiceError;
use crate::storage::repositories::tool_scheduler::{
    validate_safe_persisted_text, ToolArtifactKind, ToolArtifactVisibility, ToolPermissionScope,
};

fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}

fn validate_safe_metadata_value(label: &str, value: &Value) -> Result<(), ServiceError> {
    validate_safe_persisted_text(label, &value.to_string())
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

// LOOM_BOUNDARY_METHOD:
// marker: V2_CANONICAL_RUNTIME
// role: read-only cancellation signal handed to an adapter's execute() call
// rules: An adapter may only observe cancellation; only the scheduler/runtime
//   that owns the underlying watch::Sender may request it.
// next_task: none
/// A read-only cancellation signal. Adapters observe it during long-running
/// work; they never construct or trigger it themselves — ownership of the
/// underlying `watch::Sender` stays with whatever calls the adapter (mirrors
/// the existing `AgentRunStore` cancellation-signal pattern in
/// `agent_runtime/runtime.rs`).
#[derive(Debug, Clone)]
pub struct ToolAdapterCancellationToken(watch::Receiver<bool>);

impl ToolAdapterCancellationToken {
    pub fn new(receiver: watch::Receiver<bool>) -> Self {
        Self(receiver)
    }

    /// A token that can never be cancelled — useful for adapters invoked
    /// outside of any cancellable run context (e.g. in tests).
    pub fn never_cancelled() -> Self {
        let (_sender, receiver) = watch::channel(false);
        Self(receiver)
    }

    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }

    pub fn into_receiver(self) -> watch::Receiver<bool> {
        self.0
    }
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Tool Runtime
// migration_status: canonical
// rules:
// - Carries invocation/identity/permission/argument metadata only.
// - Must never carry provider payloads, prompts, raw thinking, or provider messages.
// next_task: TOOL-SCHEDULER-BRIDGE-001
/// Authorization context handed to an adapter alongside a request. Adapters
/// must treat `authorized: false` as a hard stop — they do not re-evaluate
/// permission themselves; that remains `ToolSchedulerRuntime`'s job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapterPermissionContext {
    pub authorized: bool,
    pub scope: Option<ToolAdapterPermissionScope>,
    pub grant_id: Option<String>,
}

/// Re-exported as a contract-local copy of [`ToolPermissionScope`] so adapter
/// implementations only need to depend on this module, not on the scheduler's
/// storage layer directly. Values map 1:1.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolAdapterPermissionScope {
    OneTime,
    Run,
    RootRun,
    Session,
    Workspace,
}

impl From<ToolPermissionScope> for ToolAdapterPermissionScope {
    fn from(scope: ToolPermissionScope) -> Self {
        match scope {
            ToolPermissionScope::OneTime => Self::OneTime,
            ToolPermissionScope::Run => Self::Run,
            ToolPermissionScope::RootRun => Self::RootRun,
            ToolPermissionScope::Session => Self::Session,
            ToolPermissionScope::Workspace => Self::Workspace,
        }
    }
}

/// The canonical execution request every adapter receives. Identity and
/// permission fields are required; everything else is optional metadata.
///
/// There is intentionally no field here that could carry a prompt, a
/// provider request/response payload, raw model thinking, or a provider
/// message list. An adapter that needs to know "what did the model ask for"
/// receives that only through `arguments` (already redacted by
/// [`SafeToolArguments`]), never through this request directly.
#[derive(Debug, Clone)]
pub struct ToolAdapterRequest {
    pub tool_id: String,
    pub tool_name: String,
    pub tool_version: Option<String>,
    pub execution_id: String,
    pub invocation_id: String,
    pub agent_run_id: String,
    pub root_run_id: String,
    /// Conversation identity, kept optional and identity-only — never a
    /// Response/Loom content payload.
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub permission: ToolAdapterPermissionContext,
    /// Absolute deadline, epoch milliseconds. An adapter must stop attempting
    /// new work once this passes, even if `timeout_ms` alone hasn't elapsed.
    pub deadline_epoch_ms: Option<i64>,
    pub timeout_ms: Option<i64>,
    pub cancellation: ToolAdapterCancellationToken,
    pub arguments: SafeToolArguments,
    /// Safe, free-form execution metadata (e.g. routing hints). Validated
    /// against the same forbidden-marker list the scheduler repository uses
    /// for persisted text — see [`ToolAdapterRequest::validate`].
    pub execution_metadata: Value,
}

impl ToolAdapterRequest {
    /// Validates every free-text/JSON field against the shared forbidden-
    /// marker list. Structural privacy (no prompt/payload field to begin
    /// with) is enforced by the type definition above; this validates the
    /// fields that *do* carry free text.
    pub fn validate(&self) -> Result<(), ServiceError> {
        validate_safe_persisted_text("tool_adapter_request.tool_id", &self.tool_id)?;
        validate_safe_persisted_text("tool_adapter_request.tool_name", &self.tool_name)?;
        if let Some(version) = self.tool_version.as_deref() {
            validate_safe_persisted_text("tool_adapter_request.tool_version", version)?;
        }
        validate_safe_persisted_text("tool_adapter_request.execution_id", &self.execution_id)?;
        validate_safe_persisted_text("tool_adapter_request.invocation_id", &self.invocation_id)?;
        validate_safe_persisted_text("tool_adapter_request.agent_run_id", &self.agent_run_id)?;
        validate_safe_persisted_text("tool_adapter_request.root_run_id", &self.root_run_id)?;
        validate_safe_metadata_value(
            "tool_adapter_request.execution_metadata",
            &self.execution_metadata,
        )?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

/// A metadata-only artifact reference an adapter produced. There is no
/// `content` field — adapters never return raw output through this contract;
/// real content lives wherever the eventual storage implementation puts it,
/// referenced here only by `storage_ref`/`content_digest`. This mirrors
/// [`crate::storage::repositories::tool_scheduler::ToolArtifactRecord`]
/// exactly, by design, so a future bridge can persist one directly from the
/// other without a translation layer inventing new semantics.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapterArtifact {
    pub kind: ToolAdapterArtifactKind,
    pub visibility: ToolAdapterArtifactVisibility,
    pub storage_ref: String,
    pub content_digest: Option<String>,
    pub size_bytes: Option<i64>,
    /// Short, human-safe label (e.g. a filename or title) — never raw content.
    pub safe_label: Option<String>,
}

impl ToolAdapterArtifact {
    pub fn validate(&self) -> Result<(), ServiceError> {
        validate_safe_persisted_text("tool_adapter_artifact.storage_ref", &self.storage_ref)?;
        if let Some(digest) = self.content_digest.as_deref() {
            validate_safe_persisted_text("tool_adapter_artifact.content_digest", digest)?;
        }
        if let Some(label) = self.safe_label.as_deref() {
            validate_safe_persisted_text("tool_adapter_artifact.safe_label", label)?;
        }
        Ok(())
    }
}

/// Contract-local mirror of [`ToolArtifactKind`]. Future kinds (e.g. a new
/// adapter introducing a kind this list doesn't cover yet) are added here
/// first and only promoted into the scheduler's persisted enum once a real
/// bridge needs to store them — this list is intentionally allowed to be a
/// superset of what the scheduler currently persists.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolAdapterArtifactKind {
    TextSummary,
    FileRef,
    ImageRef,
    JsonSummary,
    BinaryRef,
    LogSummary,
}

impl From<ToolArtifactKind> for ToolAdapterArtifactKind {
    fn from(kind: ToolArtifactKind) -> Self {
        match kind {
            ToolArtifactKind::TextSummary => Self::TextSummary,
            ToolArtifactKind::FileRef => Self::FileRef,
            ToolArtifactKind::ImageRef => Self::ImageRef,
            ToolArtifactKind::JsonSummary => Self::JsonSummary,
            ToolArtifactKind::BinaryRef => Self::BinaryRef,
            ToolArtifactKind::LogSummary => Self::LogSummary,
        }
    }
}

impl ToolAdapterArtifactKind {
    /// Maps back to the scheduler's persisted enum, when this kind has a
    /// persisted counterpart. Returns `None` for any future kind the
    /// scheduler doesn't know how to store yet — callers must treat that as
    /// "not persistable today," not as an error.
    pub fn to_scheduler_kind(self) -> Option<ToolArtifactKind> {
        match self {
            Self::TextSummary => Some(ToolArtifactKind::TextSummary),
            Self::FileRef => Some(ToolArtifactKind::FileRef),
            Self::ImageRef => Some(ToolArtifactKind::ImageRef),
            Self::JsonSummary => Some(ToolArtifactKind::JsonSummary),
            Self::BinaryRef => Some(ToolArtifactKind::BinaryRef),
            Self::LogSummary => Some(ToolArtifactKind::LogSummary),
        }
    }
}

/// Contract-local mirror of [`ToolArtifactVisibility`].
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolAdapterArtifactVisibility {
    Private,
    Run,
    RootRun,
    UserVisible,
}

impl From<ToolArtifactVisibility> for ToolAdapterArtifactVisibility {
    fn from(visibility: ToolArtifactVisibility) -> Self {
        match visibility {
            ToolArtifactVisibility::Private => Self::Private,
            ToolArtifactVisibility::Run => Self::Run,
            ToolArtifactVisibility::RootRun => Self::RootRun,
            ToolArtifactVisibility::UserVisible => Self::UserVisible,
        }
    }
}

impl From<ToolAdapterArtifactVisibility> for ToolArtifactVisibility {
    fn from(visibility: ToolAdapterArtifactVisibility) -> Self {
        match visibility {
            ToolAdapterArtifactVisibility::Private => Self::Private,
            ToolAdapterArtifactVisibility::Run => Self::Run,
            ToolAdapterArtifactVisibility::RootRun => Self::RootRun,
            ToolAdapterArtifactVisibility::UserVisible => Self::UserVisible,
        }
    }
}

// ---------------------------------------------------------------------------
// Context contribution
// ---------------------------------------------------------------------------

/// What an adapter believes should happen to its output with respect to
/// future context. This is a *declaration*, not an action — nothing in this
/// module writes to Context Selection, the legacy ContextManager, or any
/// other context pipeline. A future bridge task reads this declaration and
/// decides what, if anything, to do with it.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolAdapterContextDisposition {
    /// Not useful for context at all (e.g. a pure side-effect tool).
    Discard,
    /// Useful for the current turn only; should not be durably stored.
    Ephemeral,
    /// Should become a durable artifact (see [`ToolAdapterArtifact`]).
    Artifact,
    /// Should be nominated as a memory candidate (see
    /// [`ToolAdapterMemoryCandidate`] — nomination only, no write).
    Memory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapterContextContribution {
    pub disposition: ToolAdapterContextDisposition,
    /// Short, bounded, sanitized preview text — never the adapter's raw
    /// output. Mirrors the existing `text_preview` discipline already used
    /// by retrieval candidates (`RetrievalCandidate.text_preview` in
    /// `retrieval/hybrid_service.rs`) and Context Selection's identity-only
    /// candidate boundary: a preview, never full content.
    pub safe_preview: Option<String>,
    pub estimated_tokens: Option<u32>,
}

impl ToolAdapterContextContribution {
    pub fn validate(&self) -> Result<(), ServiceError> {
        if let Some(preview) = self.safe_preview.as_deref() {
            validate_safe_persisted_text(
                "tool_adapter_context_contribution.safe_preview",
                preview,
            )?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Memory contribution
// ---------------------------------------------------------------------------

/// A memory candidate an adapter nominates. Adapters never write memory
/// themselves — memory ownership (write pipeline, conflict resolution,
/// supersession) remains entirely with the Memory subsystem
/// (`storage/repositories/memory.rs`, the Memory Policy Engine write
/// pipeline). This struct is a hint a future bridge may or may not act on.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapterMemoryCandidate {
    pub safe_summary: String,
    pub topic_key: Option<String>,
    /// Free-text hint only (e.g. "fact", "preference") — not a validated
    /// `memory_type` value from the memory schema; the eventual write
    /// pipeline owns that classification.
    pub memory_type_hint: Option<String>,
}

impl ToolAdapterMemoryCandidate {
    pub fn validate(&self) -> Result<(), ServiceError> {
        validate_safe_persisted_text(
            "tool_adapter_memory_candidate.safe_summary",
            &self.safe_summary,
        )?;
        if let Some(topic_key) = self.topic_key.as_deref() {
            validate_safe_persisted_text("tool_adapter_memory_candidate.topic_key", topic_key)?;
        }
        if let Some(hint) = self.memory_type_hint.as_deref() {
            validate_safe_persisted_text("tool_adapter_memory_candidate.memory_type_hint", hint)?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/// Execution telemetry. No raw payload, stdout, or stderr logging — only
/// timing/attempt/version metadata and a caller-supplied safe metadata blob.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapterTelemetry {
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub retry_count: u32,
    pub attempt: u32,
    pub adapter_version: String,
    pub safe_metadata: Value,
}

impl ToolAdapterTelemetry {
    pub fn start(adapter_version: impl Into<String>) -> Self {
        Self {
            started_at: now_iso(),
            finished_at: None,
            duration_ms: None,
            retry_count: 0,
            attempt: 1,
            adapter_version: adapter_version.into(),
            safe_metadata: Value::Object(serde_json::Map::new()),
        }
    }

    /// Finalizes timing fields. Adapters call this once they have a result,
    /// rather than computing `duration_ms` by hand.
    pub fn finish(mut self) -> Self {
        let finished_at = now_iso();
        if let (Ok(started), Ok(finished)) =
            (self.started_at.parse::<i64>(), finished_at.parse::<i64>())
        {
            self.duration_ms = Some(finished - started);
        }
        self.finished_at = Some(finished_at);
        self
    }

    pub fn validate(&self) -> Result<(), ServiceError> {
        validate_safe_persisted_text(
            "tool_adapter_telemetry.adapter_version",
            &self.adapter_version,
        )?;
        validate_safe_metadata_value("tool_adapter_telemetry.safe_metadata", &self.safe_metadata)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Retry hints
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapterRetryHint {
    pub retryable: bool,
    pub recommended_backoff_ms: Option<u64>,
    pub max_attempts_hint: Option<u32>,
}

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

/// Canonical, provider-agnostic adapter error classification. Deliberately
/// does not reuse `ProviderErrorKind` (`providers/types.rs`) — tool failures
/// and provider failures are different domains, and a future MCP adapter's
/// failure should not be forced through LLM-provider vocabulary.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolAdapterErrorKind {
    PermissionDenied,
    Timeout,
    Cancelled,
    AdapterUnavailable,
    InvalidArguments,
    TemporaryFailure,
    PermanentFailure,
    ExecutionFailed,
    PrivacyRejection,
    ValidationFailure,
}

impl ToolAdapterErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PermissionDenied => "permission_denied",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
            Self::AdapterUnavailable => "adapter_unavailable",
            Self::InvalidArguments => "invalid_arguments",
            Self::TemporaryFailure => "temporary_failure",
            Self::PermanentFailure => "permanent_failure",
            Self::ExecutionFailed => "execution_failed",
            Self::PrivacyRejection => "privacy_rejection",
            Self::ValidationFailure => "validation_failure",
        }
    }

    /// Whether this error kind is *generally* retryable absent a more
    /// specific [`ToolAdapterRetryHint`]. Adapters may override via an
    /// explicit hint; this is only the default.
    pub fn default_retryable(self) -> bool {
        matches!(
            self,
            Self::Timeout | Self::TemporaryFailure | Self::AdapterUnavailable
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapterError {
    pub kind: ToolAdapterErrorKind,
    pub safe_code: String,
    pub safe_message: String,
    pub retryable: bool,
}

impl ToolAdapterError {
    pub fn new(
        kind: ToolAdapterErrorKind,
        safe_code: impl Into<String>,
        safe_message: impl Into<String>,
    ) -> Result<Self, ServiceError> {
        let safe_code = safe_code.into();
        let safe_message = safe_message.into();
        validate_safe_persisted_text("tool_adapter_error.safe_code", &safe_code)?;
        validate_safe_persisted_text("tool_adapter_error.safe_message", &safe_message)?;
        Ok(Self {
            kind,
            safe_code,
            safe_message,
            retryable: kind.default_retryable(),
        })
    }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolAdapterExecutionStatus {
    Completed,
    Failed,
    Cancelled,
    TimedOut,
    PermissionDenied,
    Skipped,
}

/// The canonical execution result every adapter returns.
///
/// As with [`ToolAdapterRequest`], there is no field here that could carry a
/// raw provider payload, secret, credential, or stdout/stderr dump — only
/// `artifacts` (metadata-only references), bounded safe text, and structured
/// telemetry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapterResult {
    pub status: ToolAdapterExecutionStatus,
    pub safe_summary: Option<String>,
    pub artifacts: Vec<ToolAdapterArtifact>,
    pub context_contribution: Option<ToolAdapterContextContribution>,
    pub memory_contribution: Vec<ToolAdapterMemoryCandidate>,
    pub telemetry: ToolAdapterTelemetry,
    pub retry_hint: Option<ToolAdapterRetryHint>,
    pub safe_metadata: Value,
    pub error: Option<ToolAdapterError>,
}

impl ToolAdapterResult {
    /// Validates every free-text/JSON field. Call this before handing a
    /// result to any future caller (scheduler bridge, telemetry sink, etc.).
    pub fn validate(&self) -> Result<(), ServiceError> {
        if let Some(summary) = self.safe_summary.as_deref() {
            validate_safe_persisted_text("tool_adapter_result.safe_summary", summary)?;
        }
        for artifact in &self.artifacts {
            artifact.validate()?;
        }
        if let Some(contribution) = &self.context_contribution {
            contribution.validate()?;
        }
        for candidate in &self.memory_contribution {
            candidate.validate()?;
        }
        self.telemetry.validate()?;
        validate_safe_metadata_value("tool_adapter_result.safe_metadata", &self.safe_metadata)?;
        Ok(())
    }

    pub fn completed(telemetry: ToolAdapterTelemetry) -> Self {
        Self {
            status: ToolAdapterExecutionStatus::Completed,
            safe_summary: None,
            artifacts: Vec::new(),
            context_contribution: None,
            memory_contribution: Vec::new(),
            telemetry,
            retry_hint: None,
            safe_metadata: Value::Object(serde_json::Map::new()),
            error: None,
        }
    }

    pub fn failed(telemetry: ToolAdapterTelemetry, error: ToolAdapterError) -> Self {
        Self {
            status: ToolAdapterExecutionStatus::Failed,
            safe_summary: None,
            artifacts: Vec::new(),
            context_contribution: None,
            memory_contribution: Vec::new(),
            telemetry,
            retry_hint: Some(ToolAdapterRetryHint {
                retryable: error.retryable,
                recommended_backoff_ms: None,
                max_attempts_hint: None,
            }),
            safe_metadata: Value::Object(serde_json::Map::new()),
            error: Some(error),
        }
    }
}

// ---------------------------------------------------------------------------
// The contract trait
// ---------------------------------------------------------------------------

/// Boxed future type alias, used because trait methods returning
/// `impl Future` are not yet dyn-compatible on this crate's Rust edition
/// (2021) without an external macro dependency; this avoids adding one.
pub type ToolAdapterFuture<'a> = Pin<Box<dyn Future<Output = ToolAdapterResult> + Send + 'a>>;

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Tool Runtime
// migration_status: canonical
// rules:
// - Every future tool adapter (File, Web Search, OCR, Browser, Shell, MCP,
//   Memory, External APIs) must implement this trait.
// - Implementations own real execution; this trait and module own none.
// - Implementations must call request.validate() before acting on a request
//   and result.validate() before returning, or rely on a shared helper that
//   does so, to keep the privacy guarantee enforced at every real adapter
//   boundary, not just at the contract's own construction sites.
// next_task: TOOL-SCHEDULER-BRIDGE-001
/// The canonical Tool Runtime Adapter Contract.
///
/// No type in this crate implements this trait outside of `#[cfg(test)]`
/// fixtures used to prove the contract is implementable — see
/// `tests::NoopContractAdapter` below. Real adapters (File, Web Search, OCR,
/// Browser, Shell, MCP, Memory, External APIs) are out of scope for this
/// task; see `docs/tool_runtime_implementation_state_audit.md` §5 for the
/// recommended order in which they should be built against this contract.
pub trait ToolAdapter: Send + Sync {
    /// Stable identifier for this adapter implementation (not the tool name
    /// — one adapter may serve several tool names/kinds).
    fn adapter_id(&self) -> &str;

    /// Semantic version of this adapter implementation, surfaced in
    /// [`ToolAdapterTelemetry::adapter_version`].
    fn adapter_version(&self) -> &str;

    /// Tool kinds this adapter can serve (matches
    /// `ToolDefinitionRecord.tool_kind` values it is prepared to handle).
    fn supported_tool_kinds(&self) -> &[&str];

    /// Executes one tool invocation. Implementations must honor
    /// `request.cancellation` and `request.deadline_epoch_ms`/`timeout_ms`,
    /// and must return promptly with `ToolAdapterExecutionStatus::Cancelled`
    /// or `::TimedOut` rather than ignoring them.
    fn execute(&self, request: ToolAdapterRequest) -> ToolAdapterFuture<'_>;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_request() -> ToolAdapterRequest {
        ToolAdapterRequest {
            tool_id: "tool-1".to_string(),
            tool_name: "loom.test.echo".to_string(),
            tool_version: Some("1.0.0".to_string()),
            execution_id: "exec-1".to_string(),
            invocation_id: "invocation-1".to_string(),
            agent_run_id: "run-1".to_string(),
            root_run_id: "run-1".to_string(),
            loom_id: Some("loom-1".to_string()),
            response_id: None,
            permission: ToolAdapterPermissionContext {
                authorized: true,
                scope: Some(ToolAdapterPermissionScope::Run),
                grant_id: Some("grant-1".to_string()),
            },
            deadline_epoch_ms: None,
            timeout_ms: Some(5_000),
            cancellation: ToolAdapterCancellationToken::never_cancelled(),
            arguments: SafeToolArguments::empty(),
            execution_metadata: Value::Object(serde_json::Map::new()),
        }
    }

    /// A test-only, no-I/O adapter implementation. It proves the trait is
    /// dyn-compatible and implementable without performing any real
    /// execution — exactly the same role `ProviderRuntimeService`'s noop path
    /// plays for providers, and `ToolSchedulerRuntime`'s `runtime.noop` plays
    /// for the scheduler. This is not a shipped adapter.
    struct NoopContractAdapter;

    impl ToolAdapter for NoopContractAdapter {
        fn adapter_id(&self) -> &str {
            "test.noop"
        }

        fn adapter_version(&self) -> &str {
            "0.0.0-test"
        }

        fn supported_tool_kinds(&self) -> &[&str] {
            &["test"]
        }

        fn execute(&self, request: ToolAdapterRequest) -> ToolAdapterFuture<'_> {
            Box::pin(async move {
                request.validate().expect("test request is valid");
                ToolAdapterResult::completed(
                    ToolAdapterTelemetry::start(self.adapter_version().to_string()).finish(),
                )
            })
        }
    }

    #[tokio::test]
    async fn contract_is_implementable_as_a_trait_object() {
        let adapter: Box<dyn ToolAdapter> = Box::new(NoopContractAdapter);
        let result = adapter.execute(test_request()).await;
        assert_eq!(result.status, ToolAdapterExecutionStatus::Completed);
        result.validate().expect("result is privacy-safe");
    }

    #[test]
    fn request_validate_rejects_forbidden_marker_in_tool_name() {
        let mut request = test_request();
        request.tool_name = "leaked raw_thinking".to_string();
        let error = request.validate().unwrap_err();
        assert!(error.to_string().contains("raw_thinking"));
    }

    #[test]
    fn request_validate_rejects_forbidden_marker_in_execution_metadata() {
        let mut request = test_request();
        request.execution_metadata = serde_json::json!({ "secret": "leak" });
        let error = request.validate().unwrap_err();
        assert!(error.to_string().contains("secret"));
    }

    #[test]
    fn error_construction_rejects_forbidden_marker_in_safe_message() {
        let error = ToolAdapterError::new(
            ToolAdapterErrorKind::ExecutionFailed,
            "execution_failed",
            "raw_thinking leaked",
        );
        assert!(error.unwrap_err().to_string().contains("raw_thinking"));
    }

    #[test]
    fn error_default_retryable_matches_kind() {
        let timeout =
            ToolAdapterError::new(ToolAdapterErrorKind::Timeout, "timeout", "timed out").unwrap();
        assert!(timeout.retryable);

        let permanent = ToolAdapterError::new(
            ToolAdapterErrorKind::PermanentFailure,
            "permanent_failure",
            "will never succeed",
        )
        .unwrap();
        assert!(!permanent.retryable);
    }

    #[test]
    fn artifact_kind_round_trips_through_scheduler_enum() {
        for kind in [
            ToolArtifactKind::TextSummary,
            ToolArtifactKind::FileRef,
            ToolArtifactKind::ImageRef,
            ToolArtifactKind::JsonSummary,
            ToolArtifactKind::BinaryRef,
            ToolArtifactKind::LogSummary,
        ] {
            let adapter_kind: ToolAdapterArtifactKind = kind.into();
            assert_eq!(adapter_kind.to_scheduler_kind(), Some(kind));
        }
    }

    #[test]
    fn visibility_round_trips_through_scheduler_enum() {
        for visibility in [
            ToolArtifactVisibility::Private,
            ToolArtifactVisibility::Run,
            ToolArtifactVisibility::RootRun,
            ToolArtifactVisibility::UserVisible,
        ] {
            let adapter_visibility: ToolAdapterArtifactVisibility = visibility.into();
            let round_tripped: ToolArtifactVisibility = adapter_visibility.into();
            assert_eq!(round_tripped, visibility);
        }
    }

    #[test]
    fn artifact_validate_rejects_forbidden_marker_in_safe_label() {
        let artifact = ToolAdapterArtifact {
            kind: ToolAdapterArtifactKind::TextSummary,
            visibility: ToolAdapterArtifactVisibility::Private,
            storage_ref: "ref-1".to_string(),
            content_digest: None,
            size_bytes: None,
            safe_label: Some("contains raw_thinking".to_string()),
        };
        assert!(artifact
            .validate()
            .unwrap_err()
            .to_string()
            .contains("raw_thinking"));
    }

    #[test]
    fn memory_candidate_validate_rejects_forbidden_marker() {
        let candidate = ToolAdapterMemoryCandidate {
            safe_summary: "chain_of_thought leaked".to_string(),
            topic_key: None,
            memory_type_hint: None,
        };
        assert!(candidate
            .validate()
            .unwrap_err()
            .to_string()
            .contains("chain_of_thought"));
    }

    #[test]
    fn cancellation_token_reflects_sender_state() {
        let (sender, receiver) = watch::channel(false);
        let token = ToolAdapterCancellationToken::new(receiver);
        assert!(!token.is_cancelled());
        sender.send(true).unwrap();
        assert!(token.is_cancelled());
    }

    #[test]
    fn never_cancelled_token_is_never_cancelled() {
        let token = ToolAdapterCancellationToken::never_cancelled();
        assert!(!token.is_cancelled());
    }

    #[test]
    fn result_serialization_has_no_forbidden_keys() {
        let telemetry = ToolAdapterTelemetry::start("0.0.0-test".to_string()).finish();
        let result = ToolAdapterResult::completed(telemetry);
        let serialized = serde_json::to_string(&result).unwrap();
        for forbidden in [
            "rawThinking",
            "thinkingText",
            "chainOfThought",
            "hiddenReasoning",
            "prompt",
            "providerPayload",
            "providerRequest",
            "providerResponse",
            "rawStdout",
            "rawStderr",
            "credential",
            "secret",
            "apiKey",
            "password",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "result must not contain {forbidden}"
            );
        }
    }

    #[test]
    fn tool_adapter_contract_static_guard_no_real_execution() {
        let source = include_str!("tool_adapter_contract.rs");
        let forbidden = [
            concat!("std::", "process::Command"),
            concat!("req", "west::"),
            concat!("Tcp", "Stream"),
            concat!("std::", "net::"),
            concat!("Ollama", "Runtime"),
            concat!("Provider", "Pipeline"),
            concat!("rmcp", "::"),
            concat!("mcp", "_client"),
        ];
        for marker in forbidden {
            assert!(
                !source.contains(marker),
                "tool adapter contract must not import or call real tool execution: {marker}"
            );
        }
    }
}
