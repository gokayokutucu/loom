#![allow(dead_code)]
// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Execution Engine
// migration_status: foundation
// rules:
// - ExecutionDispatcher decides WHO executes a ready node; it never decides
//   WHAT is ready (that is the Scheduler's job, in execution_scheduler.rs)
//   and never decides HOW a node executes (that is each NodeExecutor's job).
// - The Scheduler never references this module, and this module never
//   references the Scheduler — Dispatcher is the only connection between
//   them, and that connection is a future caller's responsibility (taking a
//   Scheduler-produced ReadyForExecution identity and loading the
//   GraphInstance/NodeInstance this module actually requires), not
//   something wired inside either module today.
// - This module performs no real execution: no provider calls, no tool
//   calls, no context building, no memory writes, no MCP/shell/file/web
//   access. Every registered NodeExecutor is a placeholder that validates
//   its inputs and returns NotImplemented.
// - No graph mutation, no persistence writes, no schema changes.
// next_task: AGENT-EXECUTION-PROVIDER-EXECUTOR-001
//! Execution Dispatcher.
//!
//! Implements the canonical Loom Execution Dispatcher described in
//! `docs/agent_execution_graph_design.md` and
//! `docs/agent_execution_engine_design.md`, and registered as Epic 3 of
//! `docs/loom_master_roadmap.md` §3 P22 (Execution Engine). The Dispatcher
//! sits between the Scheduler (decides *what* is ready) and Node Executors
//! (decide *how* a node actually runs): it loads a node's type, resolves the
//! one registered [`NodeExecutor`] for that type, and invokes it. It never
//! executes anything itself, and it never panics — an unregistered or
//! unrecognized node type produces a canonical, structured result instead.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::storage::repositories::execution_graph::{
    GraphInstanceRecord, NodeInstanceRecord, NodeType,
};

fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}

// ---------------------------------------------------------------------------
// ExecutionContext — cross-cutting dispatch metadata, identity only
// ---------------------------------------------------------------------------

/// Identity/metadata the Dispatcher hands to every executor alongside the
/// `GraphInstanceRecord`/`NodeInstanceRecord` being dispatched. Deliberately
/// minimal and decoupled from `execution_scheduler.rs`'s own types — an
/// executor never needs to know about leases, the ready queue, or any other
/// Scheduler-internal concept, only the few identifiers it would need to
/// report telemetry/results against once a real executor exists.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExecutionContext {
    pub node_attempt_id: Option<String>,
    pub lease_id: Option<String>,
    pub worker_id: Option<String>,
    pub dispatched_at: String,
}

impl ExecutionContext {
    pub fn new(
        node_attempt_id: Option<String>,
        lease_id: Option<String>,
        worker_id: Option<String>,
    ) -> Self {
        Self {
            node_attempt_id,
            lease_id,
            worker_id,
            dispatched_at: now_iso(),
        }
    }
}

// ---------------------------------------------------------------------------
// Canonical executor outcome
// ---------------------------------------------------------------------------

/// The only outcome any executor in this task can produce. Every registered
/// executor is a placeholder, so every outcome today is `NotImplemented` —
/// distinguished from [`DispatchResult::ExecutorNotRegistered`] only by
/// *why* nothing happened (a real executor existed and declined to act, vs.
/// no executor was registered for this node type at all). Future executor
/// implementations add real terminal variants here (e.g. `Completed`,
/// `Failed`) — adding a variant does not require any change to
/// [`ExecutionDispatcher`] or [`ExecutorRegistry`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeExecutionOutcome {
    NotImplemented {
        node_type: NodeType,
        executor_id: String,
        safe_reason: String,
    },
}

// ---------------------------------------------------------------------------
// Dispatch result — what the Dispatcher itself returns
// ---------------------------------------------------------------------------

/// What `ExecutionDispatcher::dispatch` returns. Never a panic, regardless
/// of what is or is not registered, or what the persisted `node_type` string
/// happens to contain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchResult {
    /// A registered executor ran (today, every executor is a placeholder, so
    /// this always carries a `NodeExecutionOutcome::NotImplemented`).
    Executed(NodeExecutionOutcome),
    /// No `NodeExecutor` is registered for this node type. This is the
    /// canonical "ExecutorNotImplemented" result the task calls for —
    /// structurally identical in shape to an executor's own
    /// `NotImplemented` outcome, but produced by the Dispatcher itself
    /// before ever reaching an executor.
    ExecutorNotRegistered { node_type: NodeType },
    /// The persisted `node_instance.node_type` string did not parse into a
    /// known `NodeType` at all. Defensive only — the database schema's own
    /// `CHECK` constraint should make this unreachable in practice, but the
    /// Dispatcher must never panic regardless, so this path exists and is
    /// tested.
    UnknownNodeType { raw_node_type: String },
}

// ---------------------------------------------------------------------------
// NodeExecutor — the canonical executor interface
// ---------------------------------------------------------------------------

/// Boxed future type alias, used for the same reason the Tool Adapter
/// Contract's own future alias is (see `tool_adapter_contract.rs`): trait
/// methods returning `impl Future` are not yet dyn-compatible on this
/// crate's Rust edition (2021) without an external macro dependency, so the
/// boxed-future shape is written out directly instead.
pub type NodeExecutorFuture<'a> = Pin<Box<dyn Future<Output = NodeExecutionOutcome> + Send + 'a>>;

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Execution Engine
// migration_status: foundation
// rules:
// - Every future executor (Provider, Tool, Join, Planner, Memory, Artifact,
//   HumanApproval, SubAgent, Evaluator, Summarizer, ContextBuild, Finish)
//   implements this trait. The Dispatcher owns lookup; implementations own
//   execution. No giant match statement over node types lives anywhere
//   outside ExecutorRegistry's lookup map.
// - Implementations must never call the Provider Runtime, the Tool
//   Scheduler Runtime, the Context Manager, Memory write paths, or any
//   MCP/shell/file/web mechanism until a dedicated future task explicitly
//   wires that executor's real behavior. This task's own six
//   implementations are placeholders only.
// next_task: AGENT-EXECUTION-PROVIDER-EXECUTOR-001
/// The canonical Node Executor interface. The Dispatcher resolves exactly
/// one `NodeExecutor` per `NodeType` via [`ExecutorRegistry`] and invokes
/// it; the executor decides how (or, today, whether at all) a node actually
/// runs.
pub trait NodeExecutor: Send + Sync {
    /// Stable identifier for this executor implementation (distinct from
    /// the node type it serves — useful once more than one implementation
    /// could in principle serve the same type, e.g. during a migration).
    fn executor_id(&self) -> &'static str;

    /// The single `NodeType` this executor serves. `ExecutorRegistry`
    /// indexes by this value at registration time.
    fn supported_node_type(&self) -> NodeType;

    /// Executes (or, for every implementation in this task, declines to
    /// execute) one node. Implementations must validate that the node
    /// instance they were handed actually matches `supported_node_type()`
    /// and belongs to the graph instance they were handed, and must never
    /// panic.
    fn execute(
        &self,
        graph_instance: &GraphInstanceRecord,
        node_instance: &NodeInstanceRecord,
        context: &ExecutionContext,
    ) -> NodeExecutorFuture<'_>;
}

/// Shared validation every placeholder executor in this task performs
/// before producing its `NotImplemented` outcome. Returns a safe diagnostic
/// string when the node instance does not actually match what this
/// executor was registered to serve — still surfaced as part of a
/// `NotImplemented` reason today, since no other outcome variant exists yet
/// (deliberately; this task does not introduce error/failure semantics).
fn validate_node_matches_type(
    expected: NodeType,
    graph_instance: &GraphInstanceRecord,
    node_instance: &NodeInstanceRecord,
) -> Option<String> {
    if NodeType::from_str_safe(&node_instance.node_type) != Some(expected) {
        return Some(format!(
            "node_instance.node_type ({}) does not match the type this executor serves ({})",
            node_instance.node_type,
            expected.as_str()
        ));
    }
    if node_instance.graph_instance_id != graph_instance.graph_instance_id {
        return Some(
            "node_instance.graph_instance_id does not match the supplied graph_instance"
                .to_string(),
        );
    }
    None
}

fn placeholder_outcome(
    node_type: NodeType,
    executor_id: &'static str,
    graph_instance: &GraphInstanceRecord,
    node_instance: &NodeInstanceRecord,
) -> NodeExecutionOutcome {
    let safe_reason = validate_node_matches_type(node_type, graph_instance, node_instance)
        .unwrap_or_else(|| format!("{} execution is not yet implemented", node_type.as_str()));
    NodeExecutionOutcome::NotImplemented {
        node_type,
        executor_id: executor_id.to_string(),
        safe_reason,
    }
}

// ---------------------------------------------------------------------------
// Placeholder executors
// ---------------------------------------------------------------------------

macro_rules! placeholder_executor {
    ($name:ident, $node_type:expr, $executor_id:literal) => {
        #[derive(Debug, Clone, Copy, Default)]
        pub struct $name;

        impl NodeExecutor for $name {
            fn executor_id(&self) -> &'static str {
                $executor_id
            }

            fn supported_node_type(&self) -> NodeType {
                $node_type
            }

            fn execute(
                &self,
                graph_instance: &GraphInstanceRecord,
                node_instance: &NodeInstanceRecord,
                _context: &ExecutionContext,
            ) -> NodeExecutorFuture<'_> {
                let outcome =
                    placeholder_outcome($node_type, $executor_id, graph_instance, node_instance);
                Box::pin(async move { outcome })
            }
        }
    };
}

placeholder_executor!(
    ProviderExecutor,
    NodeType::Provider,
    "provider_executor_placeholder"
);
placeholder_executor!(ToolExecutor, NodeType::Tool, "tool_executor_placeholder");
placeholder_executor!(JoinExecutor, NodeType::Join, "join_executor_placeholder");
placeholder_executor!(
    FinishExecutor,
    NodeType::Finish,
    "finish_executor_placeholder"
);
placeholder_executor!(
    ContextBuildExecutor,
    NodeType::ContextBuild,
    "context_build_executor_placeholder"
);
placeholder_executor!(
    PlannerExecutor,
    NodeType::Planner,
    "planner_executor_placeholder"
);

// ---------------------------------------------------------------------------
// ExecutorRegistry
// ---------------------------------------------------------------------------

/// Maps `NodeType` to the single `NodeExecutor` registered for it. Lookup
/// only — registration order does not matter, and registering a second
/// executor for a type already registered replaces the first (last write
/// wins), rather than erroring, since this task does not define a conflict
/// policy and a future task is free to without changing this type's shape.
#[derive(Clone, Default)]
pub struct ExecutorRegistry {
    executors: HashMap<NodeType, Arc<dyn NodeExecutor>>,
}

impl ExecutorRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, executor: Arc<dyn NodeExecutor>) {
        self.executors
            .insert(executor.supported_node_type(), executor);
    }

    pub fn get(&self, node_type: NodeType) -> Option<Arc<dyn NodeExecutor>> {
        self.executors.get(&node_type).cloned()
    }

    pub fn registered_node_types(&self) -> Vec<NodeType> {
        self.executors.keys().copied().collect()
    }

    /// Registers exactly the six placeholder executors this task
    /// implements (`Provider`, `Tool`, `Join`, `Finish`, `ContextBuild`,
    /// `Planner`). The remaining node types (`Memory`, `Artifact`,
    /// `SubAgent`, `HumanApproval`, `Evaluator`, `Summarizer`) are
    /// deliberately left unregistered — dispatching one of them today
    /// correctly produces `DispatchResult::ExecutorNotRegistered`, proving
    /// the architecture needs no change to add them later: a future task
    /// only calls `register()` again with a new executor, never touches
    /// `ExecutionDispatcher` or this registry's shape.
    pub fn with_placeholder_defaults() -> Self {
        let mut registry = Self::new();
        registry.register(Arc::new(ProviderExecutor));
        registry.register(Arc::new(ToolExecutor));
        registry.register(Arc::new(JoinExecutor));
        registry.register(Arc::new(FinishExecutor));
        registry.register(Arc::new(ContextBuildExecutor));
        registry.register(Arc::new(PlannerExecutor));
        registry
    }
}

// ---------------------------------------------------------------------------
// ExecutionDispatcher — the public entry point
// ---------------------------------------------------------------------------

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Execution Engine
// migration_status: foundation
// rules:
// - The only public entry point for dispatch. Owns executor lookup;
//   executors own execution.
// - Never calls the Scheduler. A future caller (out of this task's scope)
//   is responsible for taking a Scheduler-produced ReadyForExecution
//   identity, loading the corresponding GraphInstanceRecord/NodeInstanceRecord,
//   and calling dispatch() with them — that glue does not live here or in
//   execution_scheduler.rs.
// next_task: AGENT-EXECUTION-PROVIDER-EXECUTOR-001
#[derive(Clone, Default)]
pub struct ExecutionDispatcher {
    registry: ExecutorRegistry,
}

impl ExecutionDispatcher {
    pub fn new(registry: ExecutorRegistry) -> Self {
        Self { registry }
    }

    /// Constructs a Dispatcher pre-registered with this task's six
    /// placeholder executors.
    pub fn with_placeholder_defaults() -> Self {
        Self::new(ExecutorRegistry::with_placeholder_defaults())
    }

    pub fn registry(&self) -> &ExecutorRegistry {
        &self.registry
    }

    /// Loads the node's type, resolves the registered executor for it, and
    /// invokes it. Never panics: an unparseable `node_type` or an
    /// unregistered node type both produce a structured `DispatchResult`
    /// variant instead.
    pub async fn dispatch(
        &self,
        graph_instance: &GraphInstanceRecord,
        node_instance: &NodeInstanceRecord,
        context: &ExecutionContext,
    ) -> DispatchResult {
        let Some(node_type) = NodeType::from_str_safe(&node_instance.node_type) else {
            return DispatchResult::UnknownNodeType {
                raw_node_type: node_instance.node_type.clone(),
            };
        };

        match self.registry.get(node_type) {
            Some(executor) => {
                let outcome = executor
                    .execute(graph_instance, node_instance, context)
                    .await;
                DispatchResult::Executed(outcome)
            }
            None => DispatchResult::ExecutorNotRegistered { node_type },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph_instance(graph_instance_id: &str) -> GraphInstanceRecord {
        GraphInstanceRecord {
            graph_instance_id: graph_instance_id.to_string(),
            run_id: "run-1".to_string(),
            template_id: "linear-v1".to_string(),
            template_version: 1,
            status: "active".to_string(),
            created_at: "1000".to_string(),
            updated_at: "1000".to_string(),
            completed_at: None,
        }
    }

    fn node_instance(
        node_instance_id: &str,
        graph_instance_id: &str,
        node_id: &str,
        node_type: &str,
    ) -> NodeInstanceRecord {
        NodeInstanceRecord {
            node_instance_id: node_instance_id.to_string(),
            graph_instance_id: graph_instance_id.to_string(),
            node_id: node_id.to_string(),
            node_type: node_type.to_string(),
            status: "ready".to_string(),
            attempt_count: 0,
            created_at: "1000".to_string(),
            updated_at: "1000".to_string(),
        }
    }

    #[test]
    fn registry_registers_and_resolves_each_placeholder() {
        let registry = ExecutorRegistry::with_placeholder_defaults();
        for node_type in [
            NodeType::Provider,
            NodeType::Tool,
            NodeType::Join,
            NodeType::Finish,
            NodeType::ContextBuild,
            NodeType::Planner,
        ] {
            assert!(
                registry.get(node_type).is_some(),
                "expected a registered executor for {:?}",
                node_type
            );
        }
    }

    #[test]
    fn registry_does_not_register_unimplemented_node_types() {
        let registry = ExecutorRegistry::with_placeholder_defaults();
        for node_type in [
            NodeType::Memory,
            NodeType::Artifact,
            NodeType::SubAgent,
            NodeType::HumanApproval,
            NodeType::Evaluator,
            NodeType::Summarizer,
        ] {
            assert!(
                registry.get(node_type).is_none(),
                "did not expect a registered executor for {:?}",
                node_type
            );
        }
    }

    #[tokio::test]
    async fn dispatch_invokes_the_registered_placeholder_for_provider() {
        let dispatcher = ExecutionDispatcher::with_placeholder_defaults();
        let graph = graph_instance("gi-1");
        let node = node_instance("ni-1", "gi-1", "provider-call", "provider");
        let context = ExecutionContext::new(
            Some("na-1".to_string()),
            Some("lease-1".to_string()),
            Some("worker-1".to_string()),
        );

        let result = dispatcher.dispatch(&graph, &node, &context).await;
        match result {
            DispatchResult::Executed(NodeExecutionOutcome::NotImplemented {
                node_type,
                executor_id,
                ..
            }) => {
                assert_eq!(node_type, NodeType::Provider);
                assert_eq!(executor_id, "provider_executor_placeholder");
            }
            other => panic!("expected Executed(NotImplemented), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn dispatch_returns_executor_not_registered_for_memory_node() {
        let dispatcher = ExecutionDispatcher::with_placeholder_defaults();
        let graph = graph_instance("gi-1");
        let node = node_instance("ni-2", "gi-1", "memory-node", "memory");
        let context = ExecutionContext::default();

        let result = dispatcher.dispatch(&graph, &node, &context).await;
        assert_eq!(
            result,
            DispatchResult::ExecutorNotRegistered {
                node_type: NodeType::Memory
            }
        );
    }

    #[tokio::test]
    async fn dispatch_never_panics_on_unknown_node_type_string() {
        let dispatcher = ExecutionDispatcher::with_placeholder_defaults();
        let graph = graph_instance("gi-1");
        let node = node_instance("ni-3", "gi-1", "mystery-node", "totally_unrecognized_kind");
        let context = ExecutionContext::default();

        let result = dispatcher.dispatch(&graph, &node, &context).await;
        assert_eq!(
            result,
            DispatchResult::UnknownNodeType {
                raw_node_type: "totally_unrecognized_kind".to_string()
            }
        );
    }

    #[tokio::test]
    async fn dispatch_flags_node_belonging_to_a_different_graph_instance() {
        let dispatcher = ExecutionDispatcher::with_placeholder_defaults();
        let graph = graph_instance("gi-1");
        // node claims membership in a different graph instance than the one supplied.
        let node = node_instance("ni-4", "gi-OTHER", "provider-call", "provider");
        let context = ExecutionContext::default();

        let result = dispatcher.dispatch(&graph, &node, &context).await;
        match result {
            DispatchResult::Executed(NodeExecutionOutcome::NotImplemented {
                safe_reason, ..
            }) => {
                assert!(safe_reason.contains("graph_instance_id"));
            }
            other => panic!("expected Executed(NotImplemented), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn future_executor_can_be_registered_without_changing_dispatcher_code() {
        // Proves requirement 7 (future compatibility): adding support for a
        // node type this task does not implement requires only registering
        // a new executor, never touching ExecutionDispatcher/ExecutorRegistry.
        struct TestMemoryExecutor;
        impl NodeExecutor for TestMemoryExecutor {
            fn executor_id(&self) -> &'static str {
                "test_memory_executor"
            }
            fn supported_node_type(&self) -> NodeType {
                NodeType::Memory
            }
            fn execute(
                &self,
                _graph_instance: &GraphInstanceRecord,
                _node_instance: &NodeInstanceRecord,
                _context: &ExecutionContext,
            ) -> NodeExecutorFuture<'_> {
                Box::pin(async move {
                    NodeExecutionOutcome::NotImplemented {
                        node_type: NodeType::Memory,
                        executor_id: "test_memory_executor".to_string(),
                        safe_reason: "test-only executor".to_string(),
                    }
                })
            }
        }

        let mut registry = ExecutorRegistry::with_placeholder_defaults();
        registry.register(Arc::new(TestMemoryExecutor));
        let dispatcher = ExecutionDispatcher::new(registry);

        let graph = graph_instance("gi-1");
        let node = node_instance("ni-5", "gi-1", "memory-node", "memory");
        let context = ExecutionContext::default();

        let result = dispatcher.dispatch(&graph, &node, &context).await;
        match result {
            DispatchResult::Executed(NodeExecutionOutcome::NotImplemented {
                executor_id, ..
            }) => {
                assert_eq!(executor_id, "test_memory_executor");
            }
            other => panic!("expected Executed(NotImplemented), got {other:?}"),
        }
    }

    #[test]
    fn execution_dispatcher_static_guard_no_real_execution() {
        let source = include_str!("execution_dispatcher.rs");
        let forbidden = [
            concat!("Provider", "Pipeline"),
            concat!("Provider", "RuntimeService"),
            concat!("Tool", "SchedulerRuntime"),
            concat!("Agent", "Runtime"),
            concat!("Context", "Manager"),
            concat!("Context", "SelectionService"),
            concat!("Tool", "Adapter"),
            concat!("std::", "process::Command"),
            concat!("req", "west::"),
            concat!("rmcp", "::"),
        ];
        for marker in forbidden {
            assert!(
                !source.contains(marker),
                "execution dispatcher must never reference an execution subsystem: {marker}"
            );
        }
    }

    #[test]
    fn execution_dispatcher_static_guard_no_scheduler_import() {
        // Doc comments are allowed to *mention* the Scheduler by name when
        // explaining the decoupling (see the module header); what must
        // never exist is an actual `use` of it — that would be real
        // coupling, not prose.
        let source = include_str!("execution_dispatcher.rs");
        for forbidden_import in [
            concat!("use crate::", "execution_scheduler"),
            concat!("use super::super::", "execution_scheduler"),
        ] {
            assert!(
                !source.contains(forbidden_import),
                "execution dispatcher must never import execution_scheduler"
            );
        }
    }
}
