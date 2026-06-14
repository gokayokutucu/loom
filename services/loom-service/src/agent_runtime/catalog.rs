//! Built-in Loom-native tool metadata catalog.
//!
//! The catalog contains descriptors only. It has no handlers and cannot
//! execute tools. Every built-in remains `NotAvailable` until a separately
//! reviewed task supplies an execution architecture.

use serde_json::json;

use crate::agent_runtime::tool_registry::{
    RegisteredTool, ToolAvailability, ToolPermissionRequirement, ToolRegistry,
};
use crate::agent_runtime::tools::ToolName;

/// Registers the deterministic, metadata-only Loom-native tool catalog.
///
/// `ToolRegistry::register` upserts by canonical tool name, so calling this
/// function repeatedly is idempotent and preserves exactly four descriptors.
pub fn seed_builtin_tools(registry: &mut ToolRegistry) {
    for tool in builtin_tools() {
        registry.register(tool);
    }
}

fn builtin_tools() -> [RegisteredTool; 4] {
    [
        descriptor(
            "loom.runtime.status",
            "Runtime Status",
            "Inspect safe Loom Agent Runtime status metadata.",
            "runtime",
            json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            json!({ "type": "object" }),
        ),
        descriptor(
            "loom.loom.inspect",
            "Inspect Loom",
            "Inspect safe metadata for a Loom conversation.",
            "loom",
            json!({
                "type": "object",
                "properties": {
                    "loomId": { "type": "string" }
                },
                "additionalProperties": false
            }),
            json!({ "type": "object" }),
        ),
        descriptor(
            "loom.weft.inspect",
            "Inspect Weft",
            "Inspect safe metadata and lineage information for a Weft derived from a Loom response.",
            "weft",
            json!({
                "type": "object",
                "properties": {
                    "weftId": { "type": "string" }
                },
                "additionalProperties": false
            }),
            json!({ "type": "object" }),
        ),
        descriptor(
            "loom.response.read",
            "Read Response",
            "Read a response through the future Loom-native read capability.",
            "response",
            json!({
                "type": "object",
                "properties": {
                    "responseId": { "type": "string" }
                },
                "required": ["responseId"],
                "additionalProperties": false
            }),
            json!({ "type": "object" }),
        ),
    ]
}

fn descriptor(
    name: &str,
    display_name: &str,
    description: &str,
    category: &str,
    argument_schema: serde_json::Value,
    output_schema: serde_json::Value,
) -> RegisteredTool {
    RegisteredTool {
        name: ToolName::from(name),
        display_name: display_name.to_string(),
        description: description.to_string(),
        category: category.to_string(),
        availability: ToolAvailability::NotAvailable,
        permission_requirement: ToolPermissionRequirement::AlwaysAllowed,
        argument_schema: Some(argument_schema),
        output_schema: Some(output_schema),
        enabled: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_runtime::tools::{
        SafeToolArguments, ToolCallId, ToolInvocationRequest, ToolInvocationStatus,
        ToolPermissionStatus, ToolRuntimeBoundary,
    };
    use crate::agent_runtime::types::AgentRunId;

    const EXPECTED_NAMES: [&str; 4] = [
        "loom.loom.inspect",
        "loom.response.read",
        "loom.runtime.status",
        "loom.weft.inspect",
    ];

    fn seeded_registry() -> ToolRegistry {
        let mut registry = ToolRegistry::new();
        seed_builtin_tools(&mut registry);
        registry
    }

    #[test]
    fn seed_registers_exact_approved_catalog_with_deterministic_order() {
        let tools = seeded_registry().list();
        let names: Vec<_> = tools.iter().map(|tool| tool.name.as_str()).collect();

        assert_eq!(names, EXPECTED_NAMES);
        assert_eq!(tools.len(), 4);
        assert!(tools.iter().all(|tool| tool.enabled));
        assert!(tools
            .iter()
            .all(|tool| tool.availability == ToolAvailability::NotAvailable));
        assert!(tools.iter().all(|tool| {
            tool.permission_requirement == ToolPermissionRequirement::AlwaysAllowed
        }));
    }

    #[test]
    fn approved_descriptor_metadata_and_minimal_schemas_are_exact() {
        let tools = seeded_registry().list();
        let summaries: Vec<_> = tools
            .iter()
            .map(|tool| {
                (
                    tool.name.as_str(),
                    tool.display_name.as_str(),
                    tool.description.as_str(),
                    tool.category.as_str(),
                )
            })
            .collect();
        assert_eq!(
            summaries,
            vec![
                (
                    "loom.loom.inspect",
                    "Inspect Loom",
                    "Inspect safe metadata for a Loom conversation.",
                    "loom",
                ),
                (
                    "loom.response.read",
                    "Read Response",
                    "Read a response through the future Loom-native read capability.",
                    "response",
                ),
                (
                    "loom.runtime.status",
                    "Runtime Status",
                    "Inspect safe Loom Agent Runtime status metadata.",
                    "runtime",
                ),
                (
                    "loom.weft.inspect",
                    "Inspect Weft",
                    "Inspect safe metadata and lineage information for a Weft derived from a Loom response.",
                    "weft",
                ),
            ]
        );

        for tool in tools {
            let arguments = tool.argument_schema.expect("argument schema");
            let output = tool.output_schema.expect("output schema");
            assert_eq!(arguments["type"], "object");
            assert_eq!(output, json!({ "type": "object" }));
            let serialized = format!("{arguments}{output}").to_ascii_lowercase();
            for forbidden in [
                "handler",
                "command",
                "executable",
                "authorization",
                "bearer",
                "api_key",
                "apikey",
                "password",
                "raw_thinking",
                "thinking_text",
                "chain_of_thought",
                "hidden_reasoning",
            ] {
                assert!(
                    !serialized.contains(forbidden),
                    "found forbidden schema field: {forbidden}"
                );
            }
        }
    }

    #[test]
    fn seeding_is_idempotent_and_preserves_metadata_and_schemas() {
        let mut registry = seeded_registry();
        let first = registry.list();
        seed_builtin_tools(&mut registry);
        assert_eq!(registry.list(), first);
        assert_eq!(registry.list().len(), 4);
    }

    #[test]
    fn every_seeded_descriptor_remains_non_executable() {
        let registry = seeded_registry();
        let boundary = ToolRuntimeBoundary::with_registry(registry);

        for name in EXPECTED_NAMES {
            let request = ToolInvocationRequest {
                call_id: ToolCallId::from(format!("call-{name}")),
                run_id: AgentRunId::from("catalog-test-run"),
                step_id: None,
                tool_name: ToolName::from(name),
                arguments: SafeToolArguments::empty(),
                requested_at: 0,
                origin: Some("catalog-test".to_string()),
            };
            let result = boundary.invoke(&request);
            assert_eq!(result.status, ToolInvocationStatus::Skipped);
            assert_eq!(result.permission.status, ToolPermissionStatus::NotAvailable);
            assert_eq!(
                result.error.as_ref().map(|error| error.code.as_str()),
                Some("TOOL_EXECUTION_NOT_IMPLEMENTED")
            );
        }
    }

    #[test]
    fn serialized_catalog_contains_no_private_or_credential_values() {
        let serialized = serde_json::to_string(&seeded_registry().list())
            .expect("serialize catalog")
            .to_ascii_lowercase();
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
            "authorization",
            "bearer ",
            "apikey",
            "api_key",
            "password",
            "sk-",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "found forbidden catalog text: {forbidden}"
            );
        }
    }

    #[test]
    fn catalog_module_performs_no_real_execution() {
        let source = include_str!("catalog.rs");
        for forbidden in [
            "std::process",
            "Command::new",
            "std::fs::",
            "std::net",
            "TcpStream",
            "reqwest",
            "tokio::process",
            "tokio::fs",
            "dyn Fn",
            "Box<dyn",
        ] {
            let occurrences = source.matches(forbidden).count();
            assert!(
                occurrences <= 1,
                "{forbidden} appears outside the static guard"
            );
        }
    }
}
