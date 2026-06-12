//! Loom-native Tool Runtime boundary (TOOL-RUNTIME-BOUNDARY-001).
//!
//! Contract layer only: this module models tool invocations, permission
//! decisions, and safe results so AgentRuntime can represent tool calls before
//! any tool exists. Nothing here executes shell commands, touches the
//! filesystem, performs network calls, or implements MCP — real execution is
//! deferred to TOOL-RUNTIME-REGISTRY-001 and later tasks.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent_runtime::types::{AgentRunId, AgentStepId};

const REDACTED_PLACEHOLDER: &str = "[redacted]";

/// Key fragments that force redaction of an argument entry (case-insensitive).
const SENSITIVE_KEY_FRAGMENTS: [&str; 8] = [
    "authorization",
    "bearer",
    "api_key",
    "apikey",
    "token",
    "secret",
    "password",
    "credential",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ToolName(pub String);

impl ToolName {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for ToolName {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl From<String> for ToolName {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl std::fmt::Display for ToolName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ToolCallId(pub String);

impl ToolCallId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for ToolCallId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl From<String> for ToolCallId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl std::fmt::Display for ToolCallId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Untrusted, never-executed tool arguments.
///
/// Arguments are model/provider-proposed data, not commands: the boundary
/// stores them for inspection only. Construction redacts credential-shaped
/// keys and bearer-style values, so a `SafeToolArguments` can never carry
/// Authorization headers, API keys, or secrets by the time it exists.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SafeToolArguments(Value);

impl SafeToolArguments {
    pub fn empty() -> Self {
        Self(Value::Object(serde_json::Map::new()))
    }

    /// Wraps untrusted argument JSON, redacting sensitive keys and values.
    pub fn from_untrusted(value: Value) -> Self {
        Self(redact_value(value))
    }

    /// Redacted JSON view, safe for display/debug surfaces.
    pub fn redacted(&self) -> &Value {
        &self.0
    }
}

fn key_is_sensitive(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    SENSITIVE_KEY_FRAGMENTS
        .iter()
        .any(|fragment| lower.contains(fragment))
}

fn value_is_sensitive(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("bearer ") || lower.contains("authorization:")
}

fn redact_value(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, entry)| {
                    if key_is_sensitive(&key) {
                        (key, Value::String(REDACTED_PLACEHOLDER.to_string()))
                    } else {
                        (key, redact_value(entry))
                    }
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(redact_value).collect()),
        Value::String(text) => {
            if value_is_sensitive(&text) {
                Value::String(REDACTED_PLACEHOLDER.to_string())
            } else {
                Value::String(text)
            }
        }
        other => other,
    }
}

/// Redacts forbidden markers from free-form text (error messages, reasons).
pub fn sanitize_tool_text(text: &str) -> String {
    if value_is_sensitive(text) || key_is_sensitive(text) {
        REDACTED_PLACEHOLDER.to_string()
    } else {
        text.to_string()
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionStatus {
    Allowed,
    Denied,
    RequiresUserApproval,
    NotAvailable,
    Disabled,
    UnknownTool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolPermissionDecision {
    pub status: ToolPermissionStatus,
    pub reason: Option<String>,
}

impl ToolPermissionDecision {
    pub fn new(status: ToolPermissionStatus, reason: impl Into<String>) -> Self {
        Self {
            status,
            reason: Some(sanitize_tool_text(&reason.into())),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolInvocationStatus {
    Requested,
    Skipped,
    Denied,
    Completed,
    Failed,
}

/// Sanitized tool error: stable code plus a redacted message. Never carries
/// raw provider payloads or credentials.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRuntimeError {
    pub code: String,
    pub message: String,
}

impl ToolRuntimeError {
    pub fn new(code: impl Into<String>, message: &str) -> Self {
        Self {
            code: code.into(),
            message: sanitize_tool_text(message),
        }
    }
}

/// Explicit, inspectable tool invocation request. Arguments are untrusted and
/// never executed in this phase.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvocationRequest {
    pub call_id: ToolCallId,
    pub run_id: AgentRunId,
    pub step_id: Option<AgentStepId>,
    pub tool_name: ToolName,
    pub arguments: SafeToolArguments,
    pub requested_at: u64,
    /// Where the request originated (e.g. "placeholder", "test"). Metadata only.
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvocationResult {
    pub call_id: ToolCallId,
    pub tool_name: ToolName,
    pub status: ToolInvocationStatus,
    pub permission: ToolPermissionDecision,
    /// Short human-readable summary only — never raw tool output payloads.
    pub output_summary: Option<String>,
    pub error: Option<ToolRuntimeError>,
    pub completed_at: u64,
}

/// A request paired with its (eventual) result, for inspection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvocation {
    pub request: ToolInvocationRequest,
    pub result: Option<ToolInvocationResult>,
}

fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

use crate::agent_runtime::tool_registry::ToolRegistry;

/// Boundary, not executor: evaluates tool requests against an explicit policy
/// and returns safe placeholder results. No tool is ever executed here.
#[derive(Debug, Clone, Default)]
pub struct ToolRuntimeBoundary {
    registry: ToolRegistry,
}

impl ToolRuntimeBoundary {
    /// Deny-by-default boundary: every tool is unknown until a future
    /// registry (TOOL-RUNTIME-REGISTRY-001) declares it.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_registry(registry: ToolRegistry) -> Self {
        Self { registry }
    }

    pub fn with_policy(policy: HashMap<ToolName, ToolPermissionStatus>) -> Self {
        use crate::agent_runtime::tool_registry::{
            RegisteredTool, ToolAvailability, ToolPermissionRequirement,
        };
        let mut registry = ToolRegistry::new();
        for (name, status) in policy {
            let (availability, permission_requirement, enabled) = match status {
                ToolPermissionStatus::Allowed => (
                    ToolAvailability::Available,
                    ToolPermissionRequirement::AlwaysAllowed,
                    true,
                ),
                ToolPermissionStatus::Denied => (
                    ToolAvailability::Available,
                    ToolPermissionRequirement::DenyByDefault,
                    true,
                ),
                ToolPermissionStatus::RequiresUserApproval => (
                    ToolAvailability::Available,
                    ToolPermissionRequirement::RequiresUserApproval,
                    true,
                ),
                ToolPermissionStatus::NotAvailable => (
                    ToolAvailability::NotAvailable,
                    ToolPermissionRequirement::AlwaysAllowed,
                    true,
                ),
                ToolPermissionStatus::Disabled => (
                    ToolAvailability::Available,
                    ToolPermissionRequirement::Disabled,
                    false,
                ),
                ToolPermissionStatus::UnknownTool => {
                    continue;
                }
            };
            registry.register(RegisteredTool {
                name: name.clone(),
                display_name: format!("Policy Tool: {}", name),
                description: "Auto-generated from mock policy".to_string(),
                category: "policy".to_string(),
                availability,
                permission_requirement,
                argument_schema: None,
                output_schema: None,
                enabled,
            });
        }
        Self { registry }
    }

    pub fn evaluate_permission(&self, tool_name: &ToolName) -> ToolPermissionDecision {
        self.registry.permission_for(tool_name)
    }

    /// Evaluates a request and returns a safe result without executing
    /// anything. Even `Allowed` tools are skipped: execution is not
    /// implemented in this phase.
    pub fn invoke(&self, request: &ToolInvocationRequest) -> ToolInvocationResult {
        let permission = self.evaluate_permission(&request.tool_name);
        let status = match permission.status {
            ToolPermissionStatus::Denied => ToolInvocationStatus::Denied,
            _ => ToolInvocationStatus::Skipped,
        };
        let error = match permission.status {
            ToolPermissionStatus::Allowed => Some(ToolRuntimeError::new(
                "TOOL_EXECUTION_NOT_IMPLEMENTED",
                "tool execution is not implemented in the boundary phase",
            )),
            _ => None,
        };
        ToolInvocationResult {
            call_id: request.call_id.clone(),
            tool_name: request.tool_name.clone(),
            status,
            permission,
            output_summary: None,
            error,
            completed_at: now_epoch_ms(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_request(tool: &str, arguments: Value) -> ToolInvocationRequest {
        ToolInvocationRequest {
            call_id: ToolCallId::from("call-1"),
            run_id: AgentRunId::from("run-1"),
            step_id: Some(AgentStepId::from("step-1")),
            tool_name: ToolName::from(tool),
            arguments: SafeToolArguments::from_untrusted(arguments),
            requested_at: 1,
            origin: Some("test".to_string()),
        }
    }

    #[test]
    fn unknown_tool_returns_stable_safe_result() {
        let boundary = ToolRuntimeBoundary::new();
        let result = boundary.invoke(&make_request("nonexistent_tool", json!({})));

        assert_eq!(result.status, ToolInvocationStatus::Skipped);
        assert_eq!(result.permission.status, ToolPermissionStatus::UnknownTool);
        assert!(result.output_summary.is_none());
        assert!(result.error.is_none());
    }

    #[test]
    fn denied_tool_returns_denied_without_executing() {
        let boundary = ToolRuntimeBoundary::with_policy(HashMap::from([(
            ToolName::from("blocked_tool"),
            ToolPermissionStatus::Denied,
        )]));
        let result = boundary.invoke(&make_request("blocked_tool", json!({})));

        assert_eq!(result.status, ToolInvocationStatus::Denied);
        assert_eq!(result.permission.status, ToolPermissionStatus::Denied);
    }

    #[test]
    fn allowed_tool_is_skipped_as_not_implemented() {
        let boundary = ToolRuntimeBoundary::with_policy(HashMap::from([(
            ToolName::from("future_tool"),
            ToolPermissionStatus::Allowed,
        )]));
        let result = boundary.invoke(&make_request("future_tool", json!({"query": "hello"})));

        assert_eq!(result.status, ToolInvocationStatus::Skipped);
        assert_eq!(result.permission.status, ToolPermissionStatus::Allowed);
        assert_eq!(
            result.error.as_ref().map(|e| e.code.as_str()),
            Some("TOOL_EXECUTION_NOT_IMPLEMENTED")
        );
    }

    #[test]
    fn arguments_redact_sensitive_keys_and_values() {
        let arguments = SafeToolArguments::from_untrusted(json!({
            "query": "weather in berlin",
            "Authorization": "Bearer sk-live-12345",
            "api_key": "sk-12345",
            "apiKey": "sk-67890",
            "nested": {
                "client_secret": "shhh",
                "password": "hunter2",
                "items": [{"token": "t-1"}, "Bearer abc"],
                "safe": "visible"
            }
        }));

        let serialized = serde_json::to_string(arguments.redacted()).expect("serialize");
        for leaked in [
            "sk-live-12345",
            "sk-12345",
            "sk-67890",
            "shhh",
            "hunter2",
            "t-1",
            "Bearer abc",
        ] {
            assert!(
                !serialized.contains(leaked),
                "secret value leaked: {leaked}"
            );
        }
        assert!(serialized.contains("weather in berlin"));
        assert!(serialized.contains("visible"));
    }

    #[test]
    fn permission_decision_serializes_safely() {
        for status in [
            ToolPermissionStatus::Allowed,
            ToolPermissionStatus::Denied,
            ToolPermissionStatus::RequiresUserApproval,
            ToolPermissionStatus::NotAvailable,
            ToolPermissionStatus::Disabled,
            ToolPermissionStatus::UnknownTool,
        ] {
            let decision = ToolPermissionDecision::new(status, "policy reason");
            let serialized = serde_json::to_string(&decision).expect("serialize");
            for forbidden in [
                "raw_thinking",
                "thinking_text",
                "chain_of_thought",
                "hidden_reasoning",
                "bearer",
            ] {
                assert!(!serialized.to_ascii_lowercase().contains(forbidden));
            }
        }
    }

    #[test]
    fn tool_error_and_reason_text_is_sanitized() {
        let error = ToolRuntimeError::new("TOOL_FAILED", "upstream said: Bearer sk-123");
        assert_eq!(error.message, "[redacted]");

        let decision =
            ToolPermissionDecision::new(ToolPermissionStatus::Denied, "Authorization: leaked");
        assert_eq!(decision.reason.as_deref(), Some("[redacted]"));
    }

    #[test]
    fn invocation_serializes_without_forbidden_strings() {
        let request = make_request(
            "inspect_tool",
            json!({"Authorization": "Bearer sk-1", "query": "ok"}),
        );
        let boundary = ToolRuntimeBoundary::new();
        let result = boundary.invoke(&request);
        let invocation = ToolInvocation {
            request,
            result: Some(result),
        };

        let serialized = serde_json::to_string(&invocation)
            .expect("serialize")
            .to_ascii_lowercase();
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "bearer sk-1",
            "sk-1",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "found forbidden text: {forbidden}"
            );
        }
    }

    #[test]
    fn boundary_with_registry_resolves_and_executes_nothing() {
        use crate::agent_runtime::tool_registry::{
            RegisteredTool, ToolAvailability, ToolPermissionRequirement,
        };
        let mut registry = ToolRegistry::new();

        registry.register(RegisteredTool {
            name: ToolName::from("my_always_allowed_tool"),
            display_name: "Allowed".to_string(),
            description: "allowed tool".to_string(),
            category: "test".to_string(),
            availability: ToolAvailability::Available,
            permission_requirement: ToolPermissionRequirement::AlwaysAllowed,
            argument_schema: None,
            output_schema: None,
            enabled: true,
        });

        registry.register(RegisteredTool {
            name: ToolName::from("my_approval_tool"),
            display_name: "Approval".to_string(),
            description: "approval tool".to_string(),
            category: "test".to_string(),
            availability: ToolAvailability::Available,
            permission_requirement: ToolPermissionRequirement::RequiresUserApproval,
            argument_schema: None,
            output_schema: None,
            enabled: true,
        });

        let boundary = ToolRuntimeBoundary::with_registry(registry);

        // Always allowed tool should be skipped with implementation error
        let req_allowed = make_request("my_always_allowed_tool", json!({}));
        let res_allowed = boundary.invoke(&req_allowed);
        assert_eq!(res_allowed.status, ToolInvocationStatus::Skipped);
        assert_eq!(res_allowed.permission.status, ToolPermissionStatus::Allowed);
        assert_eq!(
            res_allowed.error.as_ref().map(|e| e.code.as_str()),
            Some("TOOL_EXECUTION_NOT_IMPLEMENTED")
        );

        // Approval tool should be skipped (deferred execution)
        let req_approval = make_request("my_approval_tool", json!({}));
        let res_approval = boundary.invoke(&req_approval);
        assert_eq!(res_approval.status, ToolInvocationStatus::Skipped);
        assert_eq!(
            res_approval.permission.status,
            ToolPermissionStatus::RequiresUserApproval
        );
    }

    #[test]
    fn boundary_module_performs_no_real_execution() {
        // Static guard: this module must stay free of process/fs/network
        // primitives until a dedicated, reviewed execution task lands.
        let source = include_str!("tools.rs");
        for forbidden in [
            "std::process",
            "Command::new",
            "std::fs::",
            "std::net",
            "TcpStream",
            "reqwest",
            "tokio::process",
            "tokio::fs",
        ] {
            // Skip the guard's own list by checking occurrence count: each
            // marker may appear only inside this test's array literal.
            let occurrences = source.matches(forbidden).count();
            assert!(
                occurrences <= 1,
                "{forbidden} appears outside the static guard"
            );
        }
    }
}
