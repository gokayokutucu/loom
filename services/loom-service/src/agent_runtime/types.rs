use serde::{Deserialize, Serialize};

use crate::providers::contract::ProviderUsageMetadata;

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
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub run_id: AgentRunId,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub parent_response_id: Option<String>,
    pub status: AgentRunStatus,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    /// Cancellation placeholder: cooperative cancellation lands in a later phase.
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeRequest {
    pub prompt: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub parent_response_id: Option<String>,
    pub provider_profile_id: Option<String>,
    pub model_id: Option<String>,
    /// Context Manager integration point (Phase 3). No assembly logic yet.
    pub context_snapshot_id: Option<String>,
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
