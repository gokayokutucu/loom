//! Loom-native Tool Registry compatibility contract (TOOL-RUNTIME-REGISTRY-001).
//!
//! Metadata, availability, and permission configurations for tools. This module
//! does NOT execute tools. The durable Tool Scheduler repository is the
//! canonical tool-definition store; this module keeps the legacy Agent Runtime
//! registry DTOs and bridges them into SQLite-backed scheduler definitions.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent_runtime::tools::{ToolName, ToolPermissionDecision, ToolPermissionStatus};
use crate::error::ServiceError;
use crate::storage::repositories::tool_scheduler::{
    NewToolDefinition, ToolDefinitionRecord, ToolSchedulerRepository,
};

pub const SCHEDULER_NOOP_TOOL_ID: &str = "runtime.noop";
pub const SCHEDULER_NOOP_TOOL_NAME: &str = "runtime.noop";

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchedulerToolDefinitionSeed {
    pub tool_id: String,
    pub tool_name: String,
    pub tool_kind: String,
    pub trust_level: String,
    pub requires_permission: bool,
    pub is_enabled: bool,
}

impl SchedulerToolDefinitionSeed {
    fn as_new_definition(&self) -> NewToolDefinition<'_> {
        NewToolDefinition {
            tool_id: &self.tool_id,
            tool_name: &self.tool_name,
            tool_kind: &self.tool_kind,
            trust_level: &self.trust_level,
            requires_permission: self.requires_permission,
            is_enabled: self.is_enabled,
        }
    }
}

impl RegisteredTool {
    pub fn to_scheduler_definition_seed(&self) -> SchedulerToolDefinitionSeed {
        SchedulerToolDefinitionSeed {
            tool_id: self.name.as_str().to_string(),
            tool_name: self.name.as_str().to_string(),
            tool_kind: "loom_native".to_string(),
            trust_level: scheduler_trust_level(self.permission_requirement).to_string(),
            requires_permission: matches!(
                self.permission_requirement,
                ToolPermissionRequirement::RequiresUserApproval
                    | ToolPermissionRequirement::DenyByDefault
            ),
            is_enabled: self.enabled
                && matches!(
                    self.availability,
                    ToolAvailability::Available | ToolAvailability::Experimental
                )
                && self.permission_requirement != ToolPermissionRequirement::Disabled,
        }
    }
}

impl From<&ToolDefinitionRecord> for RegisteredTool {
    fn from(record: &ToolDefinitionRecord) -> Self {
        let availability = if record.is_enabled {
            ToolAvailability::Available
        } else {
            ToolAvailability::Disabled
        };
        let permission_requirement = if record.requires_permission {
            ToolPermissionRequirement::RequiresUserApproval
        } else {
            ToolPermissionRequirement::AlwaysAllowed
        };
        Self {
            name: ToolName::from(record.tool_name.clone()),
            display_name: record.tool_name.clone(),
            description: "SQLite-backed Tool Scheduler definition".to_string(),
            category: record.tool_kind.clone(),
            availability,
            permission_requirement,
            argument_schema: None,
            output_schema: None,
            enabled: record.is_enabled,
        }
    }
}

fn scheduler_trust_level(permission: ToolPermissionRequirement) -> &'static str {
    match permission {
        ToolPermissionRequirement::AlwaysAllowed => "trusted",
        ToolPermissionRequirement::RequiresUserApproval => "sandboxed",
        ToolPermissionRequirement::Disabled | ToolPermissionRequirement::DenyByDefault => {
            "untrusted"
        }
    }
}

fn builtin_noop_tool() -> RegisteredTool {
    RegisteredTool {
        name: ToolName::from(SCHEDULER_NOOP_TOOL_NAME),
        display_name: "Runtime Noop".to_string(),
        description: "No-I/O scheduler runtime test tool.".to_string(),
        category: "runtime".to_string(),
        availability: ToolAvailability::Available,
        permission_requirement: ToolPermissionRequirement::AlwaysAllowed,
        argument_schema: None,
        output_schema: None,
        enabled: true,
    }
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

fn resolve_registered_tool(tool: RegisteredTool) -> ToolRegistryResolution {
    if !tool.enabled || tool.availability == ToolAvailability::Disabled {
        ToolRegistryResolution::Disabled(tool)
    } else if tool.availability == ToolAvailability::NotConfigured {
        ToolRegistryResolution::NotConfigured(tool)
    } else if tool.availability == ToolAvailability::NotAvailable {
        ToolRegistryResolution::NotAvailable(tool)
    } else {
        ToolRegistryResolution::Resolved(tool)
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
        let mut tools: Vec<_> = self.tools.values().cloned().collect();
        tools.sort_by(|left, right| left.name.as_str().cmp(right.name.as_str()));
        tools
    }

    pub fn resolve(&self, tool_name: &ToolName) -> ToolRegistryResolution {
        match self.tools.get(tool_name) {
            None => ToolRegistryResolution::Unknown,
            Some(tool) => resolve_registered_tool(tool.clone()),
        }
    }

    pub fn permission_for(&self, tool_name: &ToolName) -> ToolPermissionDecision {
        self.resolve(tool_name).to_permission_decision()
    }
}

#[derive(Debug, Clone)]
pub struct ToolRegistryBridge {
    repository: ToolSchedulerRepository,
}

impl ToolRegistryBridge {
    pub fn new(repository: ToolSchedulerRepository) -> Self {
        Self { repository }
    }

    pub async fn seed_registered_tool(
        &self,
        tool: &RegisteredTool,
    ) -> Result<ToolDefinitionRecord, ServiceError> {
        self.seed_definition(&tool.to_scheduler_definition_seed())
            .await
    }

    pub async fn seed_registered_tools(
        &self,
        tools: &[RegisteredTool],
    ) -> Result<Vec<ToolDefinitionRecord>, ServiceError> {
        let mut records = Vec::with_capacity(tools.len());
        for tool in tools {
            records.push(self.seed_registered_tool(tool).await?);
        }
        Ok(records)
    }

    pub async fn seed_noop_tool(&self) -> Result<ToolDefinitionRecord, ServiceError> {
        let mut seed = builtin_noop_tool().to_scheduler_definition_seed();
        seed.tool_id = SCHEDULER_NOOP_TOOL_ID.to_string();
        self.seed_definition(&seed).await
    }

    pub async fn list_registered_tools(&self) -> Result<Vec<RegisteredTool>, ServiceError> {
        Ok(self
            .repository
            .list_tool_definitions()
            .await?
            .iter()
            .map(RegisteredTool::from)
            .collect())
    }

    pub async fn resolve_registered_tool(
        &self,
        tool_name: &ToolName,
    ) -> Result<ToolRegistryResolution, ServiceError> {
        let tools = self.list_registered_tools().await?;
        let Some(tool) = tools
            .into_iter()
            .find(|tool| tool.name.as_str() == tool_name.as_str())
        else {
            return Ok(ToolRegistryResolution::Unknown);
        };
        Ok(resolve_registered_tool(tool))
    }

    async fn seed_definition(
        &self,
        seed: &SchedulerToolDefinitionSeed,
    ) -> Result<ToolDefinitionRecord, ServiceError> {
        if let Some(record) = self.repository.get_tool_definition(&seed.tool_id).await? {
            return Ok(record);
        }
        if let Some(record) = self
            .repository
            .list_tool_definitions()
            .await?
            .into_iter()
            .find(|record| record.tool_name == seed.tool_name)
        {
            return Ok(record);
        }
        self.repository
            .create_tool_definition(&seed.as_new_definition())
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{
        db::test_database,
        repositories::{
            agent_runs::{AgentRunRepository, NewAgentRun},
            tool_scheduler::{
                NewToolPermissionGrant, ToolGrantStatus, ToolPermissionLookup, ToolPermissionScope,
                ToolSchedulerRepository,
            },
        },
    };
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

    fn timestamp() -> &'static str {
        "1700000000000"
    }

    async fn create_agent_run_tree(repo: &AgentRunRepository) {
        repo.create_run(&NewAgentRun {
            agent_run_id: "root-run",
            run_mode: crate::agent_runtime::types::AgentRunMode::FullConversation,
            agent_id: None,
            agent_revision: None,
            loom_id: None,
            response_id: None,
            parent_response_id: None,
            correlation_id: "corr-root",
            causation_id: None,
            root_run_id: None,
            parent_run_id: None,
            context_snapshot_id: None,
            provider_profile_id: None,
            model_id: None,
            started_at: timestamp(),
        })
        .await
        .unwrap();
        repo.create_run(&NewAgentRun {
            agent_run_id: "child-run",
            run_mode: crate::agent_runtime::types::AgentRunMode::FullConversation,
            agent_id: None,
            agent_revision: None,
            loom_id: None,
            response_id: None,
            parent_response_id: None,
            correlation_id: "corr-child",
            causation_id: None,
            root_run_id: Some("root-run"),
            parent_run_id: Some("root-run"),
            context_snapshot_id: None,
            provider_profile_id: None,
            model_id: None,
            started_at: timestamp(),
        })
        .await
        .unwrap();
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

    #[tokio::test]
    async fn bridge_seeds_legacy_registry_tool_into_scheduler_repository() {
        let database = test_database().await;
        let repo = ToolSchedulerRepository::from_pool(database.pool());
        let bridge = ToolRegistryBridge::new(repo.clone());
        let tool = test_tool(
            "bridge_tool",
            ToolAvailability::Available,
            ToolPermissionRequirement::RequiresUserApproval,
            true,
        );

        let record = bridge.seed_registered_tool(&tool).await.unwrap();
        assert_eq!(record.tool_id, "bridge_tool");
        assert_eq!(record.tool_name, "bridge_tool");
        assert!(record.requires_permission);
        assert!(record.is_enabled);

        let canonical = repo
            .get_tool_definition("bridge_tool")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(canonical, record);
    }

    #[tokio::test]
    async fn bridge_discovers_scheduler_definitions_as_compat_registered_tools() {
        let database = test_database().await;
        let repo = ToolSchedulerRepository::from_pool(database.pool());
        let bridge = ToolRegistryBridge::new(repo);
        bridge.seed_noop_tool().await.unwrap();

        let tools = bridge.list_registered_tools().await.unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name.as_str(), SCHEDULER_NOOP_TOOL_NAME);
        assert_eq!(
            bridge
                .resolve_registered_tool(&ToolName::from(SCHEDULER_NOOP_TOOL_NAME))
                .await
                .unwrap()
                .to_permission_decision()
                .status,
            ToolPermissionStatus::Allowed
        );
    }

    #[tokio::test]
    async fn bridge_initialization_is_idempotent_for_duplicate_definitions() {
        let database = test_database().await;
        let repo = ToolSchedulerRepository::from_pool(database.pool());
        let bridge = ToolRegistryBridge::new(repo.clone());

        let first = bridge.seed_noop_tool().await.unwrap();
        let second = bridge.seed_noop_tool().await.unwrap();
        assert_eq!(first.tool_id, second.tool_id);
        assert_eq!(repo.list_tool_definitions().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn builtin_catalog_can_seed_scheduler_with_noop_tool() {
        let database = test_database().await;
        let repo = ToolSchedulerRepository::from_pool(database.pool());
        let records = crate::agent_runtime::catalog::seed_builtin_tools_to_scheduler(&repo)
            .await
            .unwrap();
        let names: Vec<_> = repo
            .list_tool_definitions()
            .await
            .unwrap()
            .into_iter()
            .map(|record| record.tool_name)
            .collect();

        assert_eq!(records.len(), 5);
        assert!(names.contains(&SCHEDULER_NOOP_TOOL_NAME.to_string()));
        assert!(names.contains(&"loom.runtime.status".to_string()));
        assert!(names.contains(&"loom.response.read".to_string()));
    }

    #[test]
    fn compatibility_status_mapping_matches_scheduler_statuses() {
        use crate::agent_runtime::tools::ToolInvocationStatus as CompatStatus;
        use crate::storage::repositories::tool_scheduler::ToolInvocationStatus as SchedulerStatus;

        assert_eq!(
            CompatStatus::from_scheduler_status(SchedulerStatus::Requested),
            CompatStatus::Requested
        );
        assert_eq!(
            CompatStatus::from_scheduler_status(SchedulerStatus::PermissionDenied),
            CompatStatus::Denied
        );
        assert_eq!(
            CompatStatus::from_scheduler_status(SchedulerStatus::Completed),
            CompatStatus::Completed
        );
        assert_eq!(
            CompatStatus::from_scheduler_status(SchedulerStatus::TimedOut),
            CompatStatus::Failed
        );
        assert_eq!(
            CompatStatus::Denied.to_scheduler_status(),
            SchedulerStatus::PermissionDenied
        );
        assert_eq!(
            CompatStatus::Skipped.to_scheduler_status(),
            SchedulerStatus::Cancelled
        );
    }

    #[tokio::test]
    async fn bridge_permission_mapping_does_not_auto_grant_child_runs() {
        let database = test_database().await;
        let agent_runs = AgentRunRepository::from_pool(database.pool());
        create_agent_run_tree(&agent_runs).await;

        let repo = ToolSchedulerRepository::from_pool(database.pool());
        let bridge = ToolRegistryBridge::new(repo.clone());
        bridge
            .seed_registered_tool(&test_tool(
                "approval_bridge_tool",
                ToolAvailability::Available,
                ToolPermissionRequirement::RequiresUserApproval,
                true,
            ))
            .await
            .unwrap();

        repo.create_permission_grant(&NewToolPermissionGrant {
            grant_id: "root-run-grant",
            root_run_id: "root-run",
            agent_run_id: Some("root-run"),
            tool_id: Some("approval_bridge_tool"),
            permission_scope: ToolPermissionScope::Run.as_str(),
            permission_status: ToolGrantStatus::Granted,
            granted_by: "test",
            granted_at: Some(timestamp()),
            expires_at: None,
            metadata_json: None,
        })
        .await
        .unwrap();

        let parent_permission = repo
            .evaluate_permission(&ToolPermissionLookup {
                root_run_id: "root-run",
                agent_run_id: "root-run",
                tool_id: "approval_bridge_tool",
                now: timestamp(),
            })
            .await
            .unwrap();
        let child_permission = repo
            .evaluate_permission(&ToolPermissionLookup {
                root_run_id: "root-run",
                agent_run_id: "child-run",
                tool_id: "approval_bridge_tool",
                now: timestamp(),
            })
            .await
            .unwrap();

        assert!(parent_permission.authorized);
        assert!(!child_permission.authorized);
        assert_eq!(child_permission.reason_code, "no_matching_active_grant");
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
