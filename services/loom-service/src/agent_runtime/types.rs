use serde::{Deserialize, Serialize};

use crate::context::types::BuildContextInput;
use crate::providers::contract::ProviderUsageMetadata;

/// Generates a new UUID v4 agent run ID.
pub fn new_agent_run_id() -> AgentRunId {
    AgentRunId(uuid::Uuid::new_v4().to_string())
}

/// Generates a new UUID v4 agent step ID.
pub fn new_agent_step_id() -> AgentStepId {
    AgentStepId(uuid::Uuid::new_v4().to_string())
}

/// Generates a raw UUID v4 string (for event IDs, correlation IDs, etc.).
pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct AgentRunId(pub String);

impl AgentRunId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for AgentRunId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for AgentRunId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl std::fmt::Display for AgentRunId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct AgentStepId(pub String);

impl AgentStepId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for AgentStepId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for AgentStepId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl std::fmt::Display for AgentStepId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunStatus {
    Created,
    Queued,
    Pending,
    Running,
    WaitingTool,
    WaitingSubagent,
    Completed,
    Failed,
    Cancelled,
    /// Service restarted while this run was active. Outcome unknown.
    Interrupted,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunMode {
    FullConversation,
    LightweightQuickAsk,
}

impl Default for AgentRunMode {
    fn default() -> Self {
        Self::FullConversation
    }
}

impl AgentRunMode {
    pub fn as_str(self) -> &'static str {
        match self {
            AgentRunMode::FullConversation => "full_conversation",
            AgentRunMode::LightweightQuickAsk => "lightweight_quick_ask",
        }
    }

    pub fn from_storage(value: &str) -> Option<Self> {
        match value {
            "full_conversation" => Some(Self::FullConversation),
            "lightweight_quick_ask" => Some(Self::LightweightQuickAsk),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStepKind {
    ContextBuild,
    ProviderCall,
    ToolCallPlaceholder,
    ArtifactPlaceholder,
    ValidationPlaceholder,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
    Skipped,
}

/// Structured provider usage. Carries token counts only — never provider
/// payloads, reasoning content, or secrets.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

impl AgentUsage {
    pub fn from_provider(usage: &ProviderUsageMetadata) -> Option<Self> {
        match usage {
            ProviderUsageMetadata::Available {
                prompt_tokens,
                completion_tokens,
                total_tokens,
            } => Some(Self {
                input_tokens: *prompt_tokens,
                output_tokens: *completion_tokens,
                total_tokens: *total_tokens,
            }),
            ProviderUsageMetadata::Unavailable { .. } => None,
        }
    }
}

/// Safe run metadata only. Must never carry raw thinking, hidden reasoning,
/// provider secrets, Authorization headers, or full provider request payloads.
/// Must never carry prompt text or provider request envelope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub run_id: AgentRunId,
    #[serde(default)]
    pub run_mode: AgentRunMode,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub parent_response_id: Option<String>,
    /// Groups related runs in the same user interaction.
    pub correlation_id: String,
    /// ID that triggered this run (parent_response_id or parent_run_id).
    pub causation_id: Option<String>,
    /// Context snapshot used for this run (links to context_artifacts table).
    pub context_snapshot_id: Option<String>,
    pub status: AgentRunStatus,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    /// Safe process-local cancellation metadata only.
    pub cancel_requested: bool,
    pub provider_profile_id: Option<String>,
    pub model_id: Option<String>,
    pub usage: Option<AgentUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentStep {
    pub step_id: AgentStepId,
    pub run_id: AgentRunId,
    pub kind: AgentStepKind,
    pub status: AgentStepStatus,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeProviderOptions {
    pub temperature: Option<f32>,
    pub max_output_tokens: Option<u32>,
}

impl Default for AgentRuntimeProviderOptions {
    fn default() -> Self {
        Self {
            temperature: Some(0.7),
            max_output_tokens: Some(1024),
        }
    }
}

/// Optional v1 Knowledge Layer context input for AgentRuntime.
///
/// This is a bridge seam only: it carries the same structured input the legacy
/// ContextManager already consumes. It must not be persisted as an AgentRun
/// diagnostic/event because it may contain raw prompt/context content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyContextRuntimeInput {
    pub build_input: BuildContextInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeRequest {
    pub prompt: String,
    #[serde(default)]
    pub run_mode: AgentRunMode,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub parent_response_id: Option<String>,
    pub provider_profile_id: Option<String>,
    pub model_id: Option<String>,
    /// Context Manager integration point (Phase 3). No assembly logic yet.
    pub context_snapshot_id: Option<String>,
    /// Optional legacy ContextManager input. When present, AgentRuntime builds
    /// provider messages through the production v1 ContextManager path.
    /// This field may include raw context content and must never be persisted.
    pub legacy_context: Option<LegacyContextRuntimeInput>,
    pub provider_options: Option<AgentRuntimeProviderOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeResult {
    pub run_id: AgentRunId,
    pub status: AgentRunStatus,
    pub output_text: Option<String>,
    pub error_message: Option<String>,
    pub usage: Option<AgentUsage>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_run_mode_serializes_with_stable_storage_names() {
        assert_eq!(
            serde_json::to_string(&AgentRunMode::FullConversation).unwrap(),
            "\"full_conversation\""
        );
        assert_eq!(
            serde_json::to_string(&AgentRunMode::LightweightQuickAsk).unwrap(),
            "\"lightweight_quick_ask\""
        );
        assert_eq!(
            AgentRunMode::from_storage("full_conversation"),
            Some(AgentRunMode::FullConversation)
        );
        assert_eq!(
            AgentRunMode::from_storage("lightweight_quick_ask"),
            Some(AgentRunMode::LightweightQuickAsk)
        );
        assert_eq!(AgentRunMode::from_storage("quick_ask"), None);
    }

    #[test]
    fn agent_run_mode_defaults_to_full_conversation() {
        assert_eq!(AgentRunMode::default(), AgentRunMode::FullConversation);
    }
}
