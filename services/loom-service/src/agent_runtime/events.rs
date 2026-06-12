use serde::{Deserialize, Serialize};

use crate::agent_runtime::tools::ToolPermissionStatus;
use crate::agent_runtime::types::{AgentStepKind, AgentUsage};

const FORBIDDEN_THINKING_SUBSTRINGS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

/// Safe-by-construction agent event contract.
///
/// Every variant carries only assistant-visible text, identifiers, and
/// structured metadata. There is intentionally no variant capable of carrying
/// raw thinking, hidden reasoning, provider secrets, Authorization headers, or
/// raw provider payloads — privacy holds at the type level, not only in tests.
/// Construct `ProviderDelta` via [`AgentEvent::provider_delta`] so text passes
/// through sanitization.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    RunStarted {
        run_id: String,
        loom_id: Option<String>,
    },
    StepStarted {
        run_id: String,
        step_id: String,
        kind: AgentStepKind,
    },
    ProviderDelta {
        run_id: String,
        step_id: String,
        delta: String,
    },
    ProviderCompleted {
        run_id: String,
        step_id: String,
        done_reason: Option<String>,
        usage: Option<AgentUsage>,
    },
    ToolCallRequested {
        run_id: String,
        step_id: String,
        tool_name: String,
    },
    /// Permission decision for a requested tool call. Carries the decision
    /// status and a sanitized reason only.
    ToolPermissionEvaluated {
        run_id: String,
        step_id: String,
        tool_name: String,
        status: ToolPermissionStatus,
        reason: Option<String>,
    },
    ToolCallSkipped {
        run_id: String,
        step_id: String,
        tool_name: String,
        reason: String,
    },
    /// Future-execution contract: a short summary only, never raw tool output.
    ToolCallCompleted {
        run_id: String,
        step_id: String,
        call_id: String,
        tool_name: String,
        output_summary: Option<String>,
    },
    /// Future-execution contract: stable error code plus sanitized message.
    ToolCallFailed {
        run_id: String,
        step_id: String,
        call_id: String,
        tool_name: String,
        error_code: String,
        error_message: String,
    },
    ArtifactCreated {
        run_id: String,
        step_id: String,
        artifact_id: String,
    },
    Warning {
        run_id: String,
        message: String,
    },
    RunCompleted {
        run_id: String,
        elapsed_ms: u64,
    },
    RunFailed {
        run_id: String,
        error_message: String,
    },
    RunCancelled {
        run_id: String,
    },
}

impl AgentEvent {
    /// Builds a `ProviderDelta` from assistant-visible text, sanitizing
    /// forbidden thinking markers before the event exists.
    pub fn provider_delta(run_id: String, step_id: String, text: &str) -> Self {
        Self::ProviderDelta {
            run_id,
            step_id,
            delta: sanitize_agent_delta(text),
        }
    }
}

/// Sanitizes assistant text deltas by replacing forbidden thinking indicators if present.
pub fn sanitize_agent_delta(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    for substring in FORBIDDEN_THINKING_SUBSTRINGS {
        if lower.contains(substring) {
            return "[sanitized thinking]".to_string();
        }
    }
    text.to_string()
}
