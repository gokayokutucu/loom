//! Loom-native Tool Registry contract (TOOL-RUNTIME-REGISTRY-001).
//!
//! Metadata, availability, and permission configurations for tools. This module
//! does NOT execute tools. It is strictly for modeling which tools exist, their
//! schemas, and their invocation permissions.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent_runtime::tools::{ToolName, ToolPermissionDecision, ToolPermissionStatus};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolAvailability {
    Available,
    Disabled,
    NotConfigured,
    NotAvailable,
    Experimental,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionRequirement {
    AlwaysAllowed,
    RequiresUserApproval,
    Disabled,
    DenyByDefault,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredTool {
    pub name: ToolName,
    pub display_name: String,
    pub description: String,
    pub category: String,
    pub availability: ToolAvailability,
    pub permission_requirement: ToolPermissionRequirement,
    pub argument_schema: Option<Value>,
    pub output_schema: Option<Value>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ToolRegistryResolution {
    Resolved(RegisteredTool),
    Disabled(RegisteredTool),
    NotConfigured(RegisteredTool),
    NotAvailable(RegisteredTool),
    Unknown,
}

impl ToolRegistryResolution {
    pub fn to_permission_decision(&self) -> ToolPermissionDecision {
        match self {
            Self::Unknown => ToolPermissionDecision::new(
                ToolPermissionStatus::UnknownTool,
                "tool is not registered with the tool runtime",
            ),
            Self::Disabled(tool) => ToolPermissionDecision::new(
                ToolPermissionStatus::Disabled,
                format!("tool '{}' is disabled", tool.name),
            ),
            Self::NotConfigured(tool) => ToolPermissionDecision::new(
                ToolPermissionStatus::NotAvailable,
                format!("tool '{}' is not configured", tool.name),
            ),
            Self::NotAvailable(tool) => ToolPermissionDecision::new(
                ToolPermissionStatus::NotAvailable,
                format!("tool '{}' is not available in this build", tool.name),
            ),
            Self::Resolved(tool) => match tool.permission_requirement {
                ToolPermissionRequirement::AlwaysAllowed => ToolPermissionDecision::new(
                    ToolPermissionStatus::Allowed,
                    format!("tool '{}' is permitted", tool.name),
                ),
                ToolPermissionRequirement::RequiresUserApproval => ToolPermissionDecision::new(
                    ToolPermissionStatus::RequiresUserApproval,
                    format!("tool '{}' requires explicit user approval", tool.name),
                ),
                ToolPermissionRequirement::Disabled => ToolPermissionDecision::new(
                    ToolPermissionStatus::Disabled,
                    format!("tool '{}' is disabled by policy", tool.name),
                ),
                ToolPermissionRequirement::DenyByDefault => ToolPermissionDecision::new(
                    ToolPermissionStatus::Denied,
                    format!("tool '{}' is denied by default", tool.name),
                ),
            },
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ToolRegistry {
    tools: HashMap<ToolName, RegisteredTool>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, tool: RegisteredTool) {
        self.tools.insert(tool.name.clone(), tool);
    }

    pub fn list(&self) -> Vec<RegisteredTool> {
        self.tools.values().cloned().collect()
    }

    pub fn resolve(&self, tool_name: &ToolName) -> ToolRegistryResolution {
        match self.tools.get(tool_name) {
            None => ToolRegistryResolution::Unknown,
            Some(tool) => {
                if !tool.enabled || tool.availability == ToolAvailability::Disabled {
                    ToolRegistryResolution::Disabled(tool.clone())
                } else if tool.availability == ToolAvailability::NotConfigured {
                    ToolRegistryResolution::NotConfigured(tool.clone())
                } else if tool.availability == ToolAvailability::NotAvailable {
                    ToolRegistryResolution::NotAvailable(tool.clone())
                } else {
                    ToolRegistryResolution::Resolved(tool.clone())
                }
            }
        }
    }

    pub fn permission_for(&self, tool_name: &ToolName) -> ToolPermissionDecision {
        self.resolve(tool_name).to_permission_decision()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_tool(
        name: &str,
        availability: ToolAvailability,
        permission: ToolPermissionRequirement,
        enabled: bool,
    ) -> RegisteredTool {
        RegisteredTool {
            name: ToolName::from(name),
            display_name: format!("Display: {name}"),
            description: format!("Description of {name}"),
            category: "testing".to_string(),
            availability,
            permission_requirement: permission,
            argument_schema: Some(json!({
                "type": "object",
                "properties": {
                    "param": { "type": "string" }
                }
            })),
            output_schema: Some(json!({
                "type": "string"
            })),
            enabled,
        }
    }

    #[test]
    fn registry_resolves_unknown_tool_safely() {
        let registry = ToolRegistry::new();
        let name = ToolName::from("nonexistent_tool");
        let resolution = registry.resolve(&name);
        assert_eq!(resolution, ToolRegistryResolution::Unknown);

        let decision = registry.permission_for(&name);
        assert_eq!(decision.status, ToolPermissionStatus::UnknownTool);
        assert_eq!(
            decision.reason.as_deref(),
            Some("tool is not registered with the tool runtime")
        );
    }

    #[test]
    fn registry_resolves_disabled_tool_safely() {
        let mut registry = ToolRegistry::new();
        let tool = test_tool(
            "disabled_tool",
            ToolAvailability::Available,
            ToolPermissionRequirement::AlwaysAllowed,
            false,
        );
        registry.register(tool.clone());

        let name = ToolName::from("disabled_tool");
        let resolution = registry.resolve(&name);
        assert_eq!(resolution, ToolRegistryResolution::Disabled(tool));

        let decision = registry.permission_for(&name);
        assert_eq!(decision.status, ToolPermissionStatus::Disabled);
        assert_eq!(
            decision.reason.as_deref(),
            Some("tool 'disabled_tool' is disabled")
        );
    }

    #[test]
    fn registry_resolves_not_configured_tool_safely() {
        let mut registry = ToolRegistry::new();
        let tool = test_tool(
            "not_configured_tool",
            ToolAvailability::NotConfigured,
            ToolPermissionRequirement::AlwaysAllowed,
            true,
        );
        registry.register(tool.clone());

        let name = ToolName::from("not_configured_tool");
        let resolution = registry.resolve(&name);
        assert_eq!(resolution, ToolRegistryResolution::NotConfigured(tool));

        let decision = registry.permission_for(&name);
        assert_eq!(decision.status, ToolPermissionStatus::NotAvailable);
        assert_eq!(
            decision.reason.as_deref(),
            Some("tool 'not_configured_tool' is not configured")
        );
    }

    #[test]
    fn registry_resolves_not_available_tool_safely() {
        let mut registry = ToolRegistry::new();
        let tool = test_tool(
            "not_available_tool",
            ToolAvailability::NotAvailable,
            ToolPermissionRequirement::AlwaysAllowed,
            true,
        );
        registry.register(tool.clone());

        let name = ToolName::from("not_available_tool");
        let resolution = registry.resolve(&name);
        assert_eq!(resolution, ToolRegistryResolution::NotAvailable(tool));

        let decision = registry.permission_for(&name);
        assert_eq!(decision.status, ToolPermissionStatus::NotAvailable);
        assert_eq!(
            decision.reason.as_deref(),
            Some("tool 'not_available_tool' is not available in this build")
        );
    }

    #[test]
    fn registry_resolves_approval_required_tool_safely() {
        let mut registry = ToolRegistry::new();
        let tool = test_tool(
            "approval_tool",
            ToolAvailability::Available,
            ToolPermissionRequirement::RequiresUserApproval,
            true,
        );
        registry.register(tool.clone());

        let name = ToolName::from("approval_tool");
        let resolution = registry.resolve(&name);
        assert_eq!(resolution, ToolRegistryResolution::Resolved(tool));

        let decision = registry.permission_for(&name);
        assert_eq!(decision.status, ToolPermissionStatus::RequiresUserApproval);
        assert_eq!(
            decision.reason.as_deref(),
            Some("tool 'approval_tool' requires explicit user approval")
        );
    }

    #[test]
    fn registry_resolves_always_allowed_metadata_safely() {
        let mut registry = ToolRegistry::new();
        let tool = test_tool(
            "allowed_tool",
            ToolAvailability::Available,
            ToolPermissionRequirement::AlwaysAllowed,
            true,
        );
        registry.register(tool.clone());

        let name = ToolName::from("allowed_tool");
        let resolution = registry.resolve(&name);
        assert_eq!(resolution, ToolRegistryResolution::Resolved(tool));

        let decision = registry.permission_for(&name);
        assert_eq!(decision.status, ToolPermissionStatus::Allowed);
        assert_eq!(
            decision.reason.as_deref(),
            Some("tool 'allowed_tool' is permitted")
        );
    }

    #[test]
    fn safe_metadata_serialization_contains_no_forbidden_strings() {
        let tool = test_tool(
            "allowed_tool",
            ToolAvailability::Available,
            ToolPermissionRequirement::AlwaysAllowed,
            true,
        );
        let serialized = serde_json::to_string(&tool).expect("serialize");

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
                "found forbidden field/value in serialization: {forbidden}"
            );
        }
    }

    #[test]
    fn registry_module_performs_no_real_execution() {
        // Static guard: this module must stay free of process/fs/network
        // primitives until a dedicated, reviewed execution task lands.
        let source = include_str!("tool_registry.rs");
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
