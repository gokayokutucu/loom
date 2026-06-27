#![allow(dead_code)]
// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Execution Engine
// migration_status: foundation
// rules:
// - This module defines the durable graph type system only (types,
//   persistence contracts, deterministic validation helpers).
// - It introduces no scheduler, no execution, and no wiring into the Agent
//   Runtime, Provider Runtime, Tool Scheduler Runtime, Context Manager,
//   Context Selection, Main Generation, or Quick Ask. Nothing in this file
//   is called from any production code path as of this task.
// - Persist safe identifiers, statuses, timestamps, and structural
//   definitions only — never prompt text, provider payloads, tool output,
//   attachment contents, raw thinking, or secrets.
// next_task: AGENT-EXECUTION-GRAPH-SCHEDULER-001
//! Execution Graph foundation.
//!
//! Durable type system for the future Loom Execution Engine described in
//! `docs/agent_execution_graph_design.md` and
//! `docs/agent_execution_engine_design.md`. This module is purely additive:
//! types, SQLite persistence contracts, and deterministic DAG validation
//! helpers — no scheduling, no execution, no runtime writes from any
//! existing code path.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

use crate::error::ServiceError;
use crate::storage::repositories::tool_scheduler::validate_safe_persisted_text;

fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// `docs/agent_execution_graph_design.md` §2. Mandatory-for-V1 kinds are
/// `ContextBuild`/`Provider`/`Tool`/`Join`/`Finish`; the rest are reserved
/// vocabulary so a later task never needs to invent a second taxonomy.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    ContextBuild,
    Provider,
    Tool,
    Join,
    Finish,
    Planner,
    Condition,
    Memory,
    Artifact,
    SubAgent,
    HumanApproval,
    Summarizer,
    Evaluator,
}

impl NodeType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ContextBuild => "context_build",
            Self::Provider => "provider",
            Self::Tool => "tool",
            Self::Join => "join",
            Self::Finish => "finish",
            Self::Planner => "planner",
            Self::Condition => "condition",
            Self::Memory => "memory",
            Self::Artifact => "artifact",
            Self::SubAgent => "sub_agent",
            Self::HumanApproval => "human_approval",
            Self::Summarizer => "summarizer",
            Self::Evaluator => "evaluator",
        }
    }

    pub fn from_str_safe(value: &str) -> Option<Self> {
        match value {
            "context_build" => Some(Self::ContextBuild),
            "provider" => Some(Self::Provider),
            "tool" => Some(Self::Tool),
            "join" => Some(Self::Join),
            "finish" => Some(Self::Finish),
            "planner" => Some(Self::Planner),
            "condition" => Some(Self::Condition),
            "memory" => Some(Self::Memory),
            "artifact" => Some(Self::Artifact),
            "sub_agent" => Some(Self::SubAgent),
            "human_approval" => Some(Self::HumanApproval),
            "summarizer" => Some(Self::Summarizer),
            "evaluator" => Some(Self::Evaluator),
            _ => None,
        }
    }
}

/// `docs/agent_execution_graph_design.md` §3.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    Dependency,
    Success,
    Failure,
    Cancelled,
    Timeout,
    Parallel,
    Conditional,
    Loop,
    Retry,
}

impl EdgeType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dependency => "dependency",
            Self::Success => "success",
            Self::Failure => "failure",
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::Parallel => "parallel",
            Self::Conditional => "conditional",
            Self::Loop => "loop",
            Self::Retry => "retry",
        }
    }

    pub fn from_str_safe(value: &str) -> Option<Self> {
        match value {
            "dependency" => Some(Self::Dependency),
            "success" => Some(Self::Success),
            "failure" => Some(Self::Failure),
            "cancelled" => Some(Self::Cancelled),
            "timeout" => Some(Self::Timeout),
            "parallel" => Some(Self::Parallel),
            "conditional" => Some(Self::Conditional),
            "loop" => Some(Self::Loop),
            "retry" => Some(Self::Retry),
            _ => None,
        }
    }
}

/// `docs/agent_execution_graph_design.md` §4. Only meaningful on a node whose
/// `node_type` is `Join`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JoinPolicy {
    WaitAll,
    WaitAny,
    FirstSuccess,
    Quorum,
}

impl JoinPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WaitAll => "wait_all",
            Self::WaitAny => "wait_any",
            Self::FirstSuccess => "first_success",
            Self::Quorum => "quorum",
        }
    }

    pub fn from_str_safe(value: &str) -> Option<Self> {
        match value {
            "wait_all" => Some(Self::WaitAll),
            "wait_any" => Some(Self::WaitAny),
            "first_success" => Some(Self::FirstSuccess),
            "quorum" => Some(Self::Quorum),
            _ => None,
        }
    }
}

/// `docs/agent_execution_engine_design.md` §1.1 / State Machine #3 (run-level
/// continuation gate aggregated onto the graph instance as a whole).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GraphStatus {
    Active,
    WaitingForUserContinuation,
    Completed,
    Failed,
    Cancelled,
}

impl GraphStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::WaitingForUserContinuation => "waiting_for_user_continuation",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_str_safe(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "waiting_for_user_continuation" => Some(Self::WaitingForUserContinuation),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// `docs/agent_execution_engine_design.md` §1.1, State Machine #1.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    Pending,
    Ready,
    Leased,
    Running,
    Completed,
    Failed,
    Cancelled,
    WaitingForUserContinuation,
}

impl NodeStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Ready => "ready",
            Self::Leased => "leased",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::WaitingForUserContinuation => "waiting_for_user_continuation",
        }
    }

    pub fn from_str_safe(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "ready" => Some(Self::Ready),
            "leased" => Some(Self::Leased),
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "waiting_for_user_continuation" => Some(Self::WaitingForUserContinuation),
            _ => None,
        }
    }

    /// Whether this status is terminal for the node instance as a whole
    /// (not merely for one attempt — see [`AttemptStatus`]).
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

/// `docs/agent_execution_engine_design.md` §1.2, State Machine #2.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttemptStatus {
    Created,
    Leased,
    Running,
    Completed,
    Failed,
    Cancelled,
    /// The engine lost contact with this attempt (crash, killed process,
    /// expired lease with no heartbeat) — distinct from `Failed`, which
    /// means the attempt itself reported failure. See engine design §2.5/§6.
    Abandoned,
}

impl AttemptStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Leased => "leased",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Abandoned => "abandoned",
        }
    }

    pub fn from_str_safe(value: &str) -> Option<Self> {
        match value {
            "created" => Some(Self::Created),
            "leased" => Some(Self::Leased),
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "abandoned" => Some(Self::Abandoned),
            _ => None,
        }
    }
}

/// `docs/agent_execution_engine_design.md` §2.2/§8, lease state machine #4.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LeaseStatus {
    Active,
    Released,
    Expired,
}

impl LeaseStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Released => "released",
            Self::Expired => "expired",
        }
    }

    pub fn from_str_safe(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "released" => Some(Self::Released),
            "expired" => Some(Self::Expired),
            _ => None,
        }
    }
}

/// `docs/agent_execution_engine_design.md` §5.3/§5.4.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContinuationResolution {
    Continue,
    ContinueWithPartial,
    Retry,
    Cancel,
}

impl ContinuationResolution {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Continue => "continue",
            Self::ContinueWithPartial => "continue_with_partial",
            Self::Retry => "retry",
            Self::Cancel => "cancel",
        }
    }

    pub fn from_str_safe(value: &str) -> Option<Self> {
        match value {
            "continue" => Some(Self::Continue),
            "continue_with_partial" => Some(Self::ContinueWithPartial),
            "retry" => Some(Self::Retry),
            "cancel" => Some(Self::Cancel),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Template-level definitions (embedded as validated JSON in graph_templates)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeDefinition {
    pub node_id: String,
    pub node_type: NodeType,
    /// Only meaningful when `node_type == NodeType::Join`.
    pub join_policy: Option<JoinPolicy>,
    pub retry_max_attempts: Option<u32>,
    pub retry_backoff_ms: Option<u64>,
    /// Safe, structured metadata only (e.g. routing hints) — validated by
    /// [`validate_graph_definition`].
    #[serde(default = "default_metadata")]
    pub safe_metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EdgeDefinition {
    pub edge_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub edge_type: EdgeType,
    /// Safe, structured predicate descriptor only — never raw content. See
    /// `docs/agent_execution_graph_design.md` §3 (`conditional` edges).
    pub condition_expression: Option<String>,
}

fn default_metadata() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

// ---------------------------------------------------------------------------
// DAG validation (deterministic, pure — no I/O, no scheduling)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GraphValidationIssue {
    DuplicateNodeId {
        node_id: String,
    },
    DanglingEdgeReference {
        edge_id: String,
        missing_node_id: String,
    },
    InvalidEdge {
        edge_id: String,
        reason: String,
    },
    CycleDetected {
        node_ids: Vec<String>,
    },
    OrphanNode {
        node_id: String,
    },
    UnreachableNode {
        node_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct GraphValidationReport {
    pub issues: Vec<GraphValidationIssue>,
}

impl GraphValidationReport {
    pub fn is_valid(&self) -> bool {
        self.issues.is_empty()
    }
}

/// Validates a node/edge definition set against every structural rule
/// `docs/agent_execution_graph_design.md` §1 requires of a Graph Template:
/// no duplicate node IDs, no edge referencing a node that doesn't exist, no
/// self-loop or other structurally invalid edge, no cycle (the persisted
/// template must remain acyclic — see design §1's "bounded re-entry, not a
/// structural cycle" rule), no orphan node, and no node unreachable from
/// every entry point. Deterministic: same input always produces the same
/// report, in the same order, with no scheduling or execution side effects.
pub fn validate_graph_definition(
    nodes: &[NodeDefinition],
    edges: &[EdgeDefinition],
) -> GraphValidationReport {
    let mut issues = Vec::new();

    // Duplicate node IDs.
    let mut seen_node_ids: HashSet<&str> = HashSet::new();
    let mut duplicate_node_ids: HashSet<&str> = HashSet::new();
    for node in nodes {
        if !seen_node_ids.insert(node.node_id.as_str()) {
            duplicate_node_ids.insert(node.node_id.as_str());
        }
    }
    for node_id in &duplicate_node_ids {
        issues.push(GraphValidationIssue::DuplicateNodeId {
            node_id: node_id.to_string(),
        });
    }

    let known_node_ids: HashSet<&str> = nodes.iter().map(|n| n.node_id.as_str()).collect();

    // Dangling edge references and structurally invalid edges (self-loops).
    let mut valid_edges: Vec<&EdgeDefinition> = Vec::new();
    for edge in edges {
        let mut edge_is_valid = true;
        if !known_node_ids.contains(edge.from_node_id.as_str()) {
            issues.push(GraphValidationIssue::DanglingEdgeReference {
                edge_id: edge.edge_id.clone(),
                missing_node_id: edge.from_node_id.clone(),
            });
            edge_is_valid = false;
        }
        if !known_node_ids.contains(edge.to_node_id.as_str()) {
            issues.push(GraphValidationIssue::DanglingEdgeReference {
                edge_id: edge.edge_id.clone(),
                missing_node_id: edge.to_node_id.clone(),
            });
            edge_is_valid = false;
        }
        if edge.from_node_id == edge.to_node_id {
            issues.push(GraphValidationIssue::InvalidEdge {
                edge_id: edge.edge_id.clone(),
                reason: "self_loop_not_allowed".to_string(),
            });
            edge_is_valid = false;
        }
        if edge_is_valid {
            valid_edges.push(edge);
        }
    }

    // Build adjacency only from edges with both endpoints known and valid,
    // so a dangling reference doesn't also corrupt cycle/reachability checks.
    let mut out_edges: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut in_degree: HashMap<&str, usize> =
        nodes.iter().map(|n| (n.node_id.as_str(), 0)).collect();
    for edge in &valid_edges {
        out_edges
            .entry(edge.from_node_id.as_str())
            .or_default()
            .push(edge.to_node_id.as_str());
        if let Some(count) = in_degree.get_mut(edge.to_node_id.as_str()) {
            *count += 1;
        }
    }

    // Cycle detection via Kahn's algorithm: if topological sort cannot order
    // every node, a cycle exists among the nodes it failed to order.
    let mut working_in_degree = in_degree.clone();
    let mut queue: VecDeque<&str> = working_in_degree
        .iter()
        .filter(|(_, degree)| **degree == 0)
        .map(|(node_id, _)| *node_id)
        .collect();
    let mut ordered_count = 0usize;
    let mut visited: HashSet<&str> = HashSet::new();
    while let Some(node_id) = queue.pop_front() {
        if !visited.insert(node_id) {
            continue;
        }
        ordered_count += 1;
        if let Some(successors) = out_edges.get(node_id) {
            for successor in successors {
                if let Some(degree) = working_in_degree.get_mut(successor) {
                    *degree = degree.saturating_sub(1);
                    if *degree == 0 {
                        queue.push_back(successor);
                    }
                }
            }
        }
    }
    if ordered_count < nodes.len() {
        let mut cyclic_node_ids: Vec<String> = nodes
            .iter()
            .map(|n| n.node_id.as_str())
            .filter(|node_id| !visited.contains(node_id))
            .map(|node_id| node_id.to_string())
            .collect();
        cyclic_node_ids.sort();
        issues.push(GraphValidationIssue::CycleDetected {
            node_ids: cyclic_node_ids,
        });
    }

    // Orphan nodes: zero incoming and zero outgoing valid edges, in a graph
    // that has more than one node (a single-node graph is never "orphaned").
    if nodes.len() > 1 {
        let mut has_outgoing: HashSet<&str> = HashSet::new();
        let mut has_incoming: HashSet<&str> = HashSet::new();
        for edge in &valid_edges {
            has_outgoing.insert(edge.from_node_id.as_str());
            has_incoming.insert(edge.to_node_id.as_str());
        }
        let mut orphan_node_ids: Vec<&str> = nodes
            .iter()
            .map(|n| n.node_id.as_str())
            .filter(|node_id| !has_outgoing.contains(node_id) && !has_incoming.contains(node_id))
            .collect();
        orphan_node_ids.sort_unstable();
        for node_id in orphan_node_ids {
            issues.push(GraphValidationIssue::OrphanNode {
                node_id: node_id.to_string(),
            });
        }
    }

    // Unreachable nodes: not reachable via a forward traversal from any
    // entry point (a node with zero incoming valid edges).
    let entry_points: Vec<&str> = nodes
        .iter()
        .map(|n| n.node_id.as_str())
        .filter(|node_id| in_degree.get(node_id).copied().unwrap_or(0) == 0)
        .collect();
    let mut reachable: HashSet<&str> = HashSet::new();
    let mut frontier: VecDeque<&str> = entry_points.into_iter().collect();
    while let Some(node_id) = frontier.pop_front() {
        if !reachable.insert(node_id) {
            continue;
        }
        if let Some(successors) = out_edges.get(node_id) {
            for successor in successors {
                frontier.push_back(successor);
            }
        }
    }
    let mut unreachable_node_ids: Vec<&str> = nodes
        .iter()
        .map(|n| n.node_id.as_str())
        .filter(|node_id| !reachable.contains(node_id))
        .collect();
    unreachable_node_ids.sort_unstable();
    for node_id in unreachable_node_ids {
        // Orphan nodes are already reported distinctly above; avoid
        // double-reporting the same node under both issue kinds.
        let already_orphan = nodes.len() > 1
            && issues.iter().any(|issue| {
                matches!(issue, GraphValidationIssue::OrphanNode { node_id: orphan_id } if orphan_id == node_id)
            });
        if !already_orphan {
            issues.push(GraphValidationIssue::UnreachableNode {
                node_id: node_id.to_string(),
            });
        }
    }

    GraphValidationReport { issues }
}

fn validate_node_definitions_safe_text(nodes: &[NodeDefinition]) -> Result<(), ServiceError> {
    for node in nodes {
        validate_safe_persisted_text("graph_node_definition.node_id", &node.node_id)?;
        validate_safe_persisted_text(
            "graph_node_definition.safe_metadata",
            &node.safe_metadata.to_string(),
        )?;
    }
    Ok(())
}

fn validate_edge_definitions_safe_text(edges: &[EdgeDefinition]) -> Result<(), ServiceError> {
    for edge in edges {
        validate_safe_persisted_text("graph_edge_definition.edge_id", &edge.edge_id)?;
        if let Some(expression) = edge.condition_expression.as_deref() {
            validate_safe_persisted_text("graph_edge_definition.condition_expression", expression)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphTemplateRecord {
    pub template_id: String,
    pub template_version: i64,
    pub template_name: String,
    pub nodes: Vec<NodeDefinition>,
    pub edges: Vec<EdgeDefinition>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphInstanceRecord {
    pub graph_instance_id: String,
    pub run_id: String,
    pub template_id: String,
    pub template_version: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstanceRecord {
    pub node_instance_id: String,
    pub graph_instance_id: String,
    pub node_id: String,
    pub node_type: String,
    pub status: String,
    pub attempt_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInstanceRecord {
    pub edge_instance_id: String,
    pub graph_instance_id: String,
    pub edge_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub edge_type: String,
    pub traversed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeAttemptRecord {
    pub node_attempt_id: String,
    pub node_instance_id: String,
    pub attempt_number: i64,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub safe_error_code: Option<String>,
    pub safe_error_message: Option<String>,
    pub tool_invocation_id: Option<String>,
    pub provider_execution_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LeaseRecord {
    pub lease_id: String,
    pub node_attempt_id: String,
    pub worker_id: String,
    pub status: String,
    pub leased_at: String,
    pub lease_expires_at: String,
    pub last_heartbeat_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContinuationCheckpointRecord {
    pub checkpoint_id: String,
    pub graph_instance_id: String,
    pub node_instance_id: String,
    pub safe_metadata_json: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub resolution: Option<String>,
}

// ---------------------------------------------------------------------------
// New* insert payloads
// ---------------------------------------------------------------------------

pub struct NewGraphTemplate<'a> {
    pub template_id: &'a str,
    pub template_version: i64,
    pub template_name: &'a str,
    pub nodes: &'a [NodeDefinition],
    pub edges: &'a [EdgeDefinition],
}

pub struct NewGraphInstance<'a> {
    pub graph_instance_id: &'a str,
    pub run_id: &'a str,
    pub template_id: &'a str,
    pub template_version: i64,
}

pub struct NewNodeInstance<'a> {
    pub node_instance_id: &'a str,
    pub graph_instance_id: &'a str,
    pub node_id: &'a str,
    pub node_type: NodeType,
}

pub struct NewEdgeInstance<'a> {
    pub edge_instance_id: &'a str,
    pub graph_instance_id: &'a str,
    pub edge_id: &'a str,
    pub from_node_id: &'a str,
    pub to_node_id: &'a str,
    pub edge_type: EdgeType,
}

pub struct NewNodeAttempt<'a> {
    pub node_attempt_id: &'a str,
    pub node_instance_id: &'a str,
    pub attempt_number: i64,
}

pub struct NewLease<'a> {
    pub lease_id: &'a str,
    pub node_attempt_id: &'a str,
    pub worker_id: &'a str,
    pub leased_at: &'a str,
    pub lease_expires_at: &'a str,
}

pub struct NewContinuationCheckpoint<'a> {
    pub checkpoint_id: &'a str,
    pub graph_instance_id: &'a str,
    pub node_instance_id: &'a str,
    pub safe_metadata_json: Option<&'a str>,
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Execution Engine
// migration_status: foundation
// rules:
// - CRUD and validation only. No method in this repository schedules,
//   executes, leases, or claims anything on its own initiative — every write
//   here requires an explicit caller-supplied identity and is a direct,
//   one-shot persistence operation.
// next_task: AGENT-EXECUTION-GRAPH-SCHEDULER-001
#[derive(Debug, Clone)]
pub struct ExecutionGraphRepository {
    pool: SqlitePool,
}

impl ExecutionGraphRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_pool(pool: &SqlitePool) -> Self {
        Self::new(pool.clone())
    }

    // -- Graph templates ----------------------------------------------------

    /// Validates the node/edge definitions (structural DAG rules +
    /// forbidden-marker text rules) before persisting. Returns the
    /// validation report's issues as a `ServiceError` if invalid; callers
    /// that want the structured report instead of an error should call
    /// [`validate_graph_definition`] themselves first.
    pub async fn create_template(
        &self,
        template: &NewGraphTemplate<'_>,
    ) -> Result<GraphTemplateRecord, ServiceError> {
        validate_safe_persisted_text("graph_template.template_id", template.template_id)?;
        validate_safe_persisted_text("graph_template.template_name", template.template_name)?;
        validate_node_definitions_safe_text(template.nodes)?;
        validate_edge_definitions_safe_text(template.edges)?;

        let report = validate_graph_definition(template.nodes, template.edges);
        if !report.is_valid() {
            return Err(ServiceError::storage(format!(
                "graph template failed validation: {} issue(s) found: {:?}",
                report.issues.len(),
                report.issues
            )));
        }

        let nodes_json = serde_json::to_string(template.nodes).map_err(|error| {
            ServiceError::storage(format!("failed to serialize nodes: {error}"))
        })?;
        let edges_json = serde_json::to_string(template.edges).map_err(|error| {
            ServiceError::storage(format!("failed to serialize edges: {error}"))
        })?;

        sqlx::query(
            "INSERT INTO graph_templates
             (template_id, template_version, template_name, nodes_json, edges_json, created_at)
             VALUES (?1,?2,?3,?4,?5,CURRENT_TIMESTAMP)",
        )
        .bind(template.template_id)
        .bind(template.template_version)
        .bind(template.template_name)
        .bind(&nodes_json)
        .bind(&edges_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create graph template: {error}"))
        })?;

        self.get_template(template.template_id, template.template_version)
            .await?
            .ok_or_else(|| ServiceError::storage("created graph template not found"))
    }

    pub async fn get_template(
        &self,
        template_id: &str,
        template_version: i64,
    ) -> Result<Option<GraphTemplateRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM graph_templates WHERE template_id = ?1 AND template_version = ?2",
        )
        .bind(template_id)
        .bind(template_version)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to get graph template: {error}")))?
        .map(graph_template_from_row)
        .transpose()
    }

    pub async fn list_template_versions(
        &self,
        template_id: &str,
    ) -> Result<Vec<GraphTemplateRecord>, ServiceError> {
        let rows = sqlx::query(
            "SELECT * FROM graph_templates WHERE template_id = ?1 ORDER BY template_version",
        )
        .bind(template_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to list graph templates: {error}"))
        })?;
        rows.into_iter().map(graph_template_from_row).collect()
    }

    // -- Graph instances ------------------------------------------------------

    pub async fn create_instance(
        &self,
        instance: &NewGraphInstance<'_>,
    ) -> Result<GraphInstanceRecord, ServiceError> {
        validate_safe_persisted_text(
            "graph_instance.graph_instance_id",
            instance.graph_instance_id,
        )?;
        validate_safe_persisted_text("graph_instance.run_id", instance.run_id)?;

        sqlx::query(
            "INSERT INTO graph_instances
             (graph_instance_id, run_id, template_id, template_version, status,
              created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .bind(instance.graph_instance_id)
        .bind(instance.run_id)
        .bind(instance.template_id)
        .bind(instance.template_version)
        .bind(GraphStatus::Active.as_str())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create graph instance: {error}"))
        })?;

        self.get_instance(instance.graph_instance_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created graph instance not found"))
    }

    pub async fn get_instance(
        &self,
        graph_instance_id: &str,
    ) -> Result<Option<GraphInstanceRecord>, ServiceError> {
        sqlx::query("SELECT * FROM graph_instances WHERE graph_instance_id = ?1")
            .bind(graph_instance_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(graph_instance_from_row))
            .map_err(|error| {
                ServiceError::storage(format!("failed to get graph instance: {error}"))
            })
    }

    pub async fn list_instances_for_run(
        &self,
        run_id: &str,
    ) -> Result<Vec<GraphInstanceRecord>, ServiceError> {
        sqlx::query("SELECT * FROM graph_instances WHERE run_id = ?1 ORDER BY created_at")
            .bind(run_id)
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(graph_instance_from_row).collect())
            .map_err(|error| {
                ServiceError::storage(format!("failed to list graph instances: {error}"))
            })
    }

    pub async fn update_instance_status(
        &self,
        graph_instance_id: &str,
        status: GraphStatus,
    ) -> Result<GraphInstanceRecord, ServiceError> {
        let completed_at_clause = if matches!(
            status,
            GraphStatus::Completed | GraphStatus::Failed | GraphStatus::Cancelled
        ) {
            "completed_at = CURRENT_TIMESTAMP,"
        } else {
            ""
        };
        let sql = format!(
            "UPDATE graph_instances SET status = ?1, {completed_at_clause} updated_at = CURRENT_TIMESTAMP
             WHERE graph_instance_id = ?2"
        );
        sqlx::query(&sql)
            .bind(status.as_str())
            .bind(graph_instance_id)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to update graph instance status: {error}"))
            })?;

        self.get_instance(graph_instance_id)
            .await?
            .ok_or_else(|| ServiceError::storage("graph instance not found after update"))
    }

    // -- Node instances ---------------------------------------------------

    pub async fn create_node_instance(
        &self,
        node: &NewNodeInstance<'_>,
    ) -> Result<NodeInstanceRecord, ServiceError> {
        validate_safe_persisted_text(
            "graph_node_instance.node_instance_id",
            node.node_instance_id,
        )?;
        validate_safe_persisted_text("graph_node_instance.node_id", node.node_id)?;

        sqlx::query(
            "INSERT INTO graph_nodes
             (node_instance_id, graph_instance_id, node_id, node_type, status,
              attempt_count, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        )
        .bind(node.node_instance_id)
        .bind(node.graph_instance_id)
        .bind(node.node_id)
        .bind(node.node_type.as_str())
        .bind(NodeStatus::Pending.as_str())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create node instance: {error}"))
        })?;

        self.get_node_instance(node.node_instance_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created node instance not found"))
    }

    pub async fn get_node_instance(
        &self,
        node_instance_id: &str,
    ) -> Result<Option<NodeInstanceRecord>, ServiceError> {
        sqlx::query("SELECT * FROM graph_nodes WHERE node_instance_id = ?1")
            .bind(node_instance_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(node_instance_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get node instance: {error}")))
    }

    pub async fn list_node_instances_for_graph(
        &self,
        graph_instance_id: &str,
    ) -> Result<Vec<NodeInstanceRecord>, ServiceError> {
        sqlx::query("SELECT * FROM graph_nodes WHERE graph_instance_id = ?1 ORDER BY created_at")
            .bind(graph_instance_id)
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(node_instance_from_row).collect())
            .map_err(|error| {
                ServiceError::storage(format!("failed to list node instances: {error}"))
            })
    }

    pub async fn update_node_instance_status(
        &self,
        node_instance_id: &str,
        status: NodeStatus,
    ) -> Result<NodeInstanceRecord, ServiceError> {
        sqlx::query(
            "UPDATE graph_nodes SET status = ?1, updated_at = CURRENT_TIMESTAMP
             WHERE node_instance_id = ?2",
        )
        .bind(status.as_str())
        .bind(node_instance_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to update node instance status: {error}"))
        })?;

        self.get_node_instance(node_instance_id)
            .await?
            .ok_or_else(|| ServiceError::storage("node instance not found after update"))
    }

    /// Atomically claims a `Ready` node instance by transitioning it to
    /// `Leased`, conditioned on its current status still being `Ready`.
    /// Returns `true` if this call won the claim, `false` if another
    /// claimant already won (or the node was not `Ready`) — used by
    /// `execution_scheduler::LeaseManager` as the single point of mutual
    /// exclusion for concurrent claim attempts. This performs no execution;
    /// it is a metadata-only conditional update.
    pub async fn try_claim_node_instance(
        &self,
        node_instance_id: &str,
    ) -> Result<bool, ServiceError> {
        let result = sqlx::query(
            "UPDATE graph_nodes SET status = 'leased', updated_at = CURRENT_TIMESTAMP
             WHERE node_instance_id = ?1 AND status = 'ready'",
        )
        .bind(node_instance_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to claim node instance: {error}"))
        })?;
        Ok(result.rows_affected() == 1)
    }

    // -- Edge instances -----------------------------------------------------

    pub async fn create_edge_instance(
        &self,
        edge: &NewEdgeInstance<'_>,
    ) -> Result<EdgeInstanceRecord, ServiceError> {
        validate_safe_persisted_text(
            "graph_edge_instance.edge_instance_id",
            edge.edge_instance_id,
        )?;
        validate_safe_persisted_text("graph_edge_instance.edge_id", edge.edge_id)?;

        sqlx::query(
            "INSERT INTO graph_edges
             (edge_instance_id, graph_instance_id, edge_id, from_node_id, to_node_id,
              edge_type, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,CURRENT_TIMESTAMP)",
        )
        .bind(edge.edge_instance_id)
        .bind(edge.graph_instance_id)
        .bind(edge.edge_id)
        .bind(edge.from_node_id)
        .bind(edge.to_node_id)
        .bind(edge.edge_type.as_str())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create edge instance: {error}"))
        })?;

        self.get_edge_instance(edge.edge_instance_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created edge instance not found"))
    }

    pub async fn get_edge_instance(
        &self,
        edge_instance_id: &str,
    ) -> Result<Option<EdgeInstanceRecord>, ServiceError> {
        sqlx::query("SELECT * FROM graph_edges WHERE edge_instance_id = ?1")
            .bind(edge_instance_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(edge_instance_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get edge instance: {error}")))
    }

    pub async fn list_edge_instances_for_graph(
        &self,
        graph_instance_id: &str,
    ) -> Result<Vec<EdgeInstanceRecord>, ServiceError> {
        sqlx::query("SELECT * FROM graph_edges WHERE graph_instance_id = ?1 ORDER BY created_at")
            .bind(graph_instance_id)
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(edge_instance_from_row).collect())
            .map_err(|error| {
                ServiceError::storage(format!("failed to list edge instances: {error}"))
            })
    }

    /// Records that an edge was traversed (its condition was satisfied and
    /// the scheduler acted on it). This method only persists the fact; it
    /// does not itself decide whether the edge should be traversed.
    pub async fn mark_edge_traversed(
        &self,
        edge_instance_id: &str,
    ) -> Result<EdgeInstanceRecord, ServiceError> {
        sqlx::query(
            "UPDATE graph_edges SET traversed_at = CURRENT_TIMESTAMP WHERE edge_instance_id = ?1",
        )
        .bind(edge_instance_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to mark edge traversed: {error}"))
        })?;

        self.get_edge_instance(edge_instance_id)
            .await?
            .ok_or_else(|| ServiceError::storage("edge instance not found after update"))
    }

    // -- Node attempts --------------------------------------------------------

    pub async fn create_attempt(
        &self,
        attempt: &NewNodeAttempt<'_>,
    ) -> Result<NodeAttemptRecord, ServiceError> {
        validate_safe_persisted_text("node_attempt.node_attempt_id", attempt.node_attempt_id)?;

        sqlx::query(
            "INSERT INTO node_attempts
             (node_attempt_id, node_instance_id, attempt_number, status, created_at)
             VALUES (?1,?2,?3,?4,CURRENT_TIMESTAMP)",
        )
        .bind(attempt.node_attempt_id)
        .bind(attempt.node_instance_id)
        .bind(attempt.attempt_number)
        .bind(AttemptStatus::Created.as_str())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create node attempt: {error}"))
        })?;

        sqlx::query(
            "UPDATE graph_nodes SET attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
             WHERE node_instance_id = ?1",
        )
        .bind(attempt.node_instance_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to increment node attempt count: {error}"))
        })?;

        self.get_attempt(attempt.node_attempt_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created node attempt not found"))
    }

    pub async fn get_attempt(
        &self,
        node_attempt_id: &str,
    ) -> Result<Option<NodeAttemptRecord>, ServiceError> {
        sqlx::query("SELECT * FROM node_attempts WHERE node_attempt_id = ?1")
            .bind(node_attempt_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(node_attempt_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get node attempt: {error}")))
    }

    pub async fn list_attempts_for_node(
        &self,
        node_instance_id: &str,
    ) -> Result<Vec<NodeAttemptRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM node_attempts WHERE node_instance_id = ?1 ORDER BY attempt_number",
        )
        .bind(node_instance_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(node_attempt_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list node attempts: {error}")))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_attempt_status(
        &self,
        node_attempt_id: &str,
        status: AttemptStatus,
        started_at: Option<&str>,
        finished_at: Option<&str>,
        safe_error_code: Option<&str>,
        safe_error_message: Option<&str>,
        tool_invocation_id: Option<&str>,
        provider_execution_id: Option<&str>,
    ) -> Result<NodeAttemptRecord, ServiceError> {
        if let Some(code) = safe_error_code {
            validate_safe_persisted_text("node_attempt.safe_error_code", code)?;
        }
        if let Some(message) = safe_error_message {
            validate_safe_persisted_text("node_attempt.safe_error_message", message)?;
        }

        sqlx::query(
            "UPDATE node_attempts SET
               status = ?1,
               started_at = COALESCE(?2, started_at),
               finished_at = COALESCE(?3, finished_at),
               safe_error_code = COALESCE(?4, safe_error_code),
               safe_error_message = COALESCE(?5, safe_error_message),
               tool_invocation_id = COALESCE(?6, tool_invocation_id),
               provider_execution_id = COALESCE(?7, provider_execution_id)
             WHERE node_attempt_id = ?8",
        )
        .bind(status.as_str())
        .bind(started_at)
        .bind(finished_at)
        .bind(safe_error_code)
        .bind(safe_error_message)
        .bind(tool_invocation_id)
        .bind(provider_execution_id)
        .bind(node_attempt_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to update node attempt: {error}"))
        })?;

        self.get_attempt(node_attempt_id)
            .await?
            .ok_or_else(|| ServiceError::storage("node attempt not found after update"))
    }

    // -- Leases ------------------------------------------------------------

    pub async fn create_lease(&self, lease: &NewLease<'_>) -> Result<LeaseRecord, ServiceError> {
        validate_safe_persisted_text("graph_lease.lease_id", lease.lease_id)?;
        validate_safe_persisted_text("graph_lease.worker_id", lease.worker_id)?;

        sqlx::query(
            "INSERT INTO graph_leases
             (lease_id, node_attempt_id, worker_id, status, leased_at, lease_expires_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
        )
        .bind(lease.lease_id)
        .bind(lease.node_attempt_id)
        .bind(lease.worker_id)
        .bind(LeaseStatus::Active.as_str())
        .bind(lease.leased_at)
        .bind(lease.lease_expires_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to create lease: {error}")))?;

        self.get_lease(lease.lease_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created lease not found"))
    }

    pub async fn get_lease(&self, lease_id: &str) -> Result<Option<LeaseRecord>, ServiceError> {
        sqlx::query("SELECT * FROM graph_leases WHERE lease_id = ?1")
            .bind(lease_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(lease_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get lease: {error}")))
    }

    pub async fn get_lease_for_attempt(
        &self,
        node_attempt_id: &str,
    ) -> Result<Option<LeaseRecord>, ServiceError> {
        sqlx::query("SELECT * FROM graph_leases WHERE node_attempt_id = ?1")
            .bind(node_attempt_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(lease_from_row))
            .map_err(|error| {
                ServiceError::storage(format!("failed to get lease for attempt: {error}"))
            })
    }

    pub async fn heartbeat_lease(
        &self,
        lease_id: &str,
        heartbeat_at: &str,
        new_expires_at: &str,
    ) -> Result<LeaseRecord, ServiceError> {
        sqlx::query(
            "UPDATE graph_leases SET last_heartbeat_at = ?1, lease_expires_at = ?2
             WHERE lease_id = ?3 AND status = 'active'",
        )
        .bind(heartbeat_at)
        .bind(new_expires_at)
        .bind(lease_id)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to heartbeat lease: {error}")))?;

        self.get_lease(lease_id)
            .await?
            .ok_or_else(|| ServiceError::storage("lease not found after heartbeat"))
    }

    pub async fn release_lease(&self, lease_id: &str) -> Result<LeaseRecord, ServiceError> {
        self.transition_lease(lease_id, LeaseStatus::Released).await
    }

    pub async fn expire_lease(&self, lease_id: &str) -> Result<LeaseRecord, ServiceError> {
        self.transition_lease(lease_id, LeaseStatus::Expired).await
    }

    async fn transition_lease(
        &self,
        lease_id: &str,
        status: LeaseStatus,
    ) -> Result<LeaseRecord, ServiceError> {
        sqlx::query("UPDATE graph_leases SET status = ?1 WHERE lease_id = ?2")
            .bind(status.as_str())
            .bind(lease_id)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to transition lease: {error}"))
            })?;

        self.get_lease(lease_id)
            .await?
            .ok_or_else(|| ServiceError::storage("lease not found after transition"))
    }

    /// Recovery metadata helper only (per `AGENT-EXECUTION-GRAPH-TYPES-001`
    /// scope: no recovery *behavior* is implemented here). Returns every
    /// lease still marked `active` whose `lease_expires_at` is at or before
    /// `now` — a future scheduler task decides what to do with this list.
    pub async fn list_expired_active_leases(
        &self,
        now: &str,
    ) -> Result<Vec<LeaseRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM graph_leases WHERE status = 'active' AND lease_expires_at <= ?1
             ORDER BY lease_expires_at",
        )
        .bind(now)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(lease_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list expired leases: {error}")))
    }

    /// Lists every lease still marked `active`, regardless of
    /// `lease_expires_at`. Used by startup recovery, which must treat every
    /// lease issued by a now-dead process as abandoned unconditionally — a
    /// fresh process cannot trust any `lease_expires_at` value it did not
    /// itself set (engine design §2.4). Deliberately a separate query from
    /// [`Self::list_expired_active_leases`] rather than a synthetic "far
    /// future" timestamp comparison: `lease_expires_at` is a TEXT column, and
    /// TEXT comparison of numeric strings is only reliably ordered when both
    /// operands have equal digit counts (true for real epoch-millisecond
    /// values, but not safely guaranteed for an arbitrary sentinel string).
    pub async fn list_all_active_leases(&self) -> Result<Vec<LeaseRecord>, ServiceError> {
        sqlx::query("SELECT * FROM graph_leases WHERE status = 'active' ORDER BY lease_expires_at")
            .fetch_all(&self.pool)
            .await
            .map(|rows| rows.into_iter().map(lease_from_row).collect())
            .map_err(|error| {
                ServiceError::storage(format!("failed to list active leases: {error}"))
            })
    }

    // -- Continuation checkpoints --------------------------------------------

    pub async fn create_continuation_checkpoint(
        &self,
        checkpoint: &NewContinuationCheckpoint<'_>,
    ) -> Result<ContinuationCheckpointRecord, ServiceError> {
        validate_safe_persisted_text(
            "continuation_checkpoint.checkpoint_id",
            checkpoint.checkpoint_id,
        )?;
        if let Some(metadata) = checkpoint.safe_metadata_json {
            validate_safe_persisted_text("continuation_checkpoint.safe_metadata_json", metadata)?;
        }

        sqlx::query(
            "INSERT INTO continuation_checkpoints
             (checkpoint_id, graph_instance_id, node_instance_id, safe_metadata_json, created_at)
             VALUES (?1,?2,?3,?4,CURRENT_TIMESTAMP)",
        )
        .bind(checkpoint.checkpoint_id)
        .bind(checkpoint.graph_instance_id)
        .bind(checkpoint.node_instance_id)
        .bind(checkpoint.safe_metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to create continuation checkpoint: {error}"))
        })?;

        self.get_continuation_checkpoint(checkpoint.checkpoint_id)
            .await?
            .ok_or_else(|| ServiceError::storage("created continuation checkpoint not found"))
    }

    pub async fn get_continuation_checkpoint(
        &self,
        checkpoint_id: &str,
    ) -> Result<Option<ContinuationCheckpointRecord>, ServiceError> {
        sqlx::query("SELECT * FROM continuation_checkpoints WHERE checkpoint_id = ?1")
            .bind(checkpoint_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(continuation_checkpoint_from_row))
            .map_err(|error| {
                ServiceError::storage(format!("failed to get continuation checkpoint: {error}"))
            })
    }

    pub async fn list_unresolved_checkpoints_for_graph(
        &self,
        graph_instance_id: &str,
    ) -> Result<Vec<ContinuationCheckpointRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM continuation_checkpoints
             WHERE graph_instance_id = ?1 AND resolved_at IS NULL
             ORDER BY created_at",
        )
        .bind(graph_instance_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(continuation_checkpoint_from_row)
                .collect()
        })
        .map_err(|error| {
            ServiceError::storage(format!("failed to list unresolved checkpoints: {error}"))
        })
    }

    pub async fn resolve_continuation_checkpoint(
        &self,
        checkpoint_id: &str,
        resolution: ContinuationResolution,
    ) -> Result<ContinuationCheckpointRecord, ServiceError> {
        sqlx::query(
            "UPDATE continuation_checkpoints
             SET resolved_at = CURRENT_TIMESTAMP, resolution = ?1
             WHERE checkpoint_id = ?2",
        )
        .bind(resolution.as_str())
        .bind(checkpoint_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to resolve continuation checkpoint: {error}"
            ))
        })?;

        self.get_continuation_checkpoint(checkpoint_id)
            .await?
            .ok_or_else(|| ServiceError::storage("continuation checkpoint not found after resolve"))
    }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

fn graph_template_from_row(row: SqliteRow) -> Result<GraphTemplateRecord, ServiceError> {
    let nodes_json: String = row.get("nodes_json");
    let edges_json: String = row.get("edges_json");
    let nodes: Vec<NodeDefinition> = serde_json::from_str(&nodes_json)
        .map_err(|error| ServiceError::storage(format!("failed to parse nodes_json: {error}")))?;
    let edges: Vec<EdgeDefinition> = serde_json::from_str(&edges_json)
        .map_err(|error| ServiceError::storage(format!("failed to parse edges_json: {error}")))?;
    Ok(GraphTemplateRecord {
        template_id: row.get("template_id"),
        template_version: row.get("template_version"),
        template_name: row.get("template_name"),
        nodes,
        edges,
        created_at: row.get("created_at"),
    })
}

fn graph_instance_from_row(row: SqliteRow) -> GraphInstanceRecord {
    GraphInstanceRecord {
        graph_instance_id: row.get("graph_instance_id"),
        run_id: row.get("run_id"),
        template_id: row.get("template_id"),
        template_version: row.get("template_version"),
        status: row.get("status"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        completed_at: row.get("completed_at"),
    }
}

fn node_instance_from_row(row: SqliteRow) -> NodeInstanceRecord {
    NodeInstanceRecord {
        node_instance_id: row.get("node_instance_id"),
        graph_instance_id: row.get("graph_instance_id"),
        node_id: row.get("node_id"),
        node_type: row.get("node_type"),
        status: row.get("status"),
        attempt_count: row.get("attempt_count"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn edge_instance_from_row(row: SqliteRow) -> EdgeInstanceRecord {
    EdgeInstanceRecord {
        edge_instance_id: row.get("edge_instance_id"),
        graph_instance_id: row.get("graph_instance_id"),
        edge_id: row.get("edge_id"),
        from_node_id: row.get("from_node_id"),
        to_node_id: row.get("to_node_id"),
        edge_type: row.get("edge_type"),
        traversed_at: row.get("traversed_at"),
        created_at: row.get("created_at"),
    }
}

fn node_attempt_from_row(row: SqliteRow) -> NodeAttemptRecord {
    NodeAttemptRecord {
        node_attempt_id: row.get("node_attempt_id"),
        node_instance_id: row.get("node_instance_id"),
        attempt_number: row.get("attempt_number"),
        status: row.get("status"),
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
        safe_error_code: row.get("safe_error_code"),
        safe_error_message: row.get("safe_error_message"),
        tool_invocation_id: row.get("tool_invocation_id"),
        provider_execution_id: row.get("provider_execution_id"),
        created_at: row.get("created_at"),
    }
}

fn lease_from_row(row: SqliteRow) -> LeaseRecord {
    LeaseRecord {
        lease_id: row.get("lease_id"),
        node_attempt_id: row.get("node_attempt_id"),
        worker_id: row.get("worker_id"),
        status: row.get("status"),
        leased_at: row.get("leased_at"),
        lease_expires_at: row.get("lease_expires_at"),
        last_heartbeat_at: row.get("last_heartbeat_at"),
    }
}

fn continuation_checkpoint_from_row(row: SqliteRow) -> ContinuationCheckpointRecord {
    ContinuationCheckpointRecord {
        checkpoint_id: row.get("checkpoint_id"),
        graph_instance_id: row.get("graph_instance_id"),
        node_instance_id: row.get("node_instance_id"),
        safe_metadata_json: row.get("safe_metadata_json"),
        created_at: row.get("created_at"),
        resolved_at: row.get("resolved_at"),
        resolution: row.get("resolution"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{
        db::test_database,
        repositories::agent_runs::{AgentRunRepository, NewAgentRun},
    };

    fn timestamp() -> &'static str {
        "1700000000000"
    }

    fn node(id: &str, node_type: NodeType) -> NodeDefinition {
        NodeDefinition {
            node_id: id.to_string(),
            node_type,
            join_policy: None,
            retry_max_attempts: None,
            retry_backoff_ms: None,
            safe_metadata: default_metadata(),
        }
    }

    fn edge(id: &str, from: &str, to: &str, edge_type: EdgeType) -> EdgeDefinition {
        EdgeDefinition {
            edge_id: id.to_string(),
            from_node_id: from.to_string(),
            to_node_id: to.to_string(),
            edge_type,
            condition_expression: None,
        }
    }

    fn linear_v1_nodes() -> Vec<NodeDefinition> {
        vec![
            node("context-build", NodeType::ContextBuild),
            node("provider-call", NodeType::Provider),
            node("tool-call", NodeType::Tool),
            node("finish", NodeType::Finish),
        ]
    }

    fn linear_v1_edges() -> Vec<EdgeDefinition> {
        vec![
            edge("e1", "context-build", "provider-call", EdgeType::Dependency),
            edge("e2", "provider-call", "tool-call", EdgeType::Dependency),
            edge("e3", "tool-call", "finish", EdgeType::Dependency),
        ]
    }

    // -- Validation tests -----------------------------------------------

    #[test]
    fn linear_template_validates_cleanly() {
        let report = validate_graph_definition(&linear_v1_nodes(), &linear_v1_edges());
        assert!(report.is_valid(), "unexpected issues: {:?}", report.issues);
    }

    #[test]
    fn detects_duplicate_node_id() {
        let nodes = vec![
            node("a", NodeType::ContextBuild),
            node("a", NodeType::Provider),
        ];
        let report = validate_graph_definition(&nodes, &[]);
        assert!(report
            .issues
            .contains(&GraphValidationIssue::DuplicateNodeId {
                node_id: "a".to_string()
            }));
    }

    #[test]
    fn detects_dangling_edge_reference() {
        let nodes = vec![node("a", NodeType::ContextBuild)];
        let edges = vec![edge("e1", "a", "missing", EdgeType::Dependency)];
        let report = validate_graph_definition(&nodes, &edges);
        assert!(report
            .issues
            .contains(&GraphValidationIssue::DanglingEdgeReference {
                edge_id: "e1".to_string(),
                missing_node_id: "missing".to_string()
            }));
    }

    #[test]
    fn detects_self_loop_as_invalid_edge() {
        let nodes = vec![node("a", NodeType::ContextBuild)];
        let edges = vec![edge("e1", "a", "a", EdgeType::Dependency)];
        let report = validate_graph_definition(&nodes, &edges);
        assert!(report.issues.iter().any(|issue| matches!(
            issue,
            GraphValidationIssue::InvalidEdge { edge_id, .. } if edge_id == "e1"
        )));
    }

    #[test]
    fn detects_cycle() {
        let nodes = vec![
            node("a", NodeType::ContextBuild),
            node("b", NodeType::Provider),
            node("c", NodeType::Tool),
        ];
        let edges = vec![
            edge("e1", "a", "b", EdgeType::Dependency),
            edge("e2", "b", "c", EdgeType::Dependency),
            edge("e3", "c", "a", EdgeType::Dependency),
        ];
        let report = validate_graph_definition(&nodes, &edges);
        assert!(report
            .issues
            .iter()
            .any(|issue| matches!(issue, GraphValidationIssue::CycleDetected { .. })));
    }

    #[test]
    fn detects_orphan_node() {
        let nodes = vec![
            node("a", NodeType::ContextBuild),
            node("b", NodeType::Provider),
            node("isolated", NodeType::Tool),
        ];
        let edges = vec![edge("e1", "a", "b", EdgeType::Dependency)];
        let report = validate_graph_definition(&nodes, &edges);
        assert!(report.issues.contains(&GraphValidationIssue::OrphanNode {
            node_id: "isolated".to_string()
        }));
    }

    #[test]
    fn disconnected_component_with_its_own_entry_point_is_not_flagged() {
        // "c" -> "d" is a second, independent component with its own entry
        // point ("c" has in-degree 0), so neither node is an orphan (each
        // has an edge) nor unreachable (each is reachable from "c"). A
        // template may legitimately contain more than one entry point.
        let nodes = vec![
            node("a", NodeType::ContextBuild),
            node("b", NodeType::Provider),
            node("c", NodeType::Tool),
            node("d", NodeType::Finish),
        ];
        let edges = vec![
            edge("e1", "a", "b", EdgeType::Dependency),
            edge("e2", "c", "d", EdgeType::Dependency),
        ];
        let report = validate_graph_definition(&nodes, &edges);
        assert!(
            report.is_valid(),
            "expected two independently valid components: {:?}",
            report.issues
        );
    }

    #[test]
    fn detects_node_unreachable_from_any_entry_point() {
        // "b" only has an incoming edge from "a" via a node that is itself
        // never an entry point because of a cycle excluding "a" — simplest
        // direct case: a node whose only incoming edge originates from a
        // node that's already unreachable. "start" is the sole entry point;
        // "mid" and "target" form a cycle reachable only from each other,
        // never from "start".
        let nodes = vec![
            node("start", NodeType::ContextBuild),
            node("mid", NodeType::Provider),
            node("target", NodeType::Finish),
        ];
        let edges = vec![
            edge("e1", "mid", "target", EdgeType::Dependency),
            edge("e2", "target", "mid", EdgeType::Dependency),
        ];
        let report = validate_graph_definition(&nodes, &edges);
        // "start" has no incoming edges (entry point, reachable from itself).
        // "mid"/"target" form a cycle with no incoming edge from "start", so
        // neither has in-degree 0 and neither is an entry point; both are
        // unreachable from the only real entry point ("start").
        assert!(report
            .issues
            .iter()
            .any(|issue| matches!(issue, GraphValidationIssue::UnreachableNode { node_id } if node_id == "mid")));
        assert!(report
            .issues
            .iter()
            .any(|issue| matches!(issue, GraphValidationIssue::UnreachableNode { node_id } if node_id == "target")));
        // And the cycle itself is still independently reported.
        assert!(report
            .issues
            .iter()
            .any(|issue| matches!(issue, GraphValidationIssue::CycleDetected { .. })));
    }

    #[test]
    fn validation_is_deterministic_across_repeated_calls() {
        let nodes = linear_v1_nodes();
        let edges = linear_v1_edges();
        let first = validate_graph_definition(&nodes, &edges);
        let second = validate_graph_definition(&nodes, &edges);
        assert_eq!(first, second);
    }

    // -- Repository tests -------------------------------------------------

    async fn seeded_repo() -> (
        ExecutionGraphRepository,
        AgentRunRepository,
        sqlx::SqlitePool,
    ) {
        let database = test_database().await;
        let pool = database.pool().clone();
        let agent_runs = AgentRunRepository::from_pool(&pool);
        agent_runs
            .create_run(&NewAgentRun {
                agent_run_id: "run-graph-1",
                run_mode: crate::agent_runtime::types::AgentRunMode::FullConversation,
                agent_id: None,
                agent_revision: None,
                loom_id: None,
                response_id: None,
                parent_response_id: None,
                correlation_id: "corr-graph-1",
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
        let repo = ExecutionGraphRepository::from_pool(&pool);
        (repo, agent_runs, pool)
    }

    #[tokio::test]
    async fn template_can_be_created_and_read_back() {
        let (repo, _, _) = seeded_repo().await;
        let nodes = linear_v1_nodes();
        let edges = linear_v1_edges();
        let record = repo
            .create_template(&NewGraphTemplate {
                template_id: "linear-v1",
                template_version: 1,
                template_name: "Linear V1",
                nodes: &nodes,
                edges: &edges,
            })
            .await
            .unwrap();
        assert_eq!(record.nodes.len(), 4);
        assert_eq!(record.edges.len(), 3);

        let fetched = repo.get_template("linear-v1", 1).await.unwrap().unwrap();
        assert_eq!(fetched, record);
    }

    #[tokio::test]
    async fn template_creation_rejects_invalid_graph() {
        let (repo, _, _) = seeded_repo().await;
        let nodes = vec![
            node("a", NodeType::ContextBuild),
            node("a", NodeType::Provider),
        ];
        let error = repo
            .create_template(&NewGraphTemplate {
                template_id: "broken",
                template_version: 1,
                template_name: "Broken",
                nodes: &nodes,
                edges: &[],
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("validation"));
    }

    #[tokio::test]
    async fn template_creation_rejects_forbidden_marker_in_metadata() {
        let (repo, _, _) = seeded_repo().await;
        let mut nodes = linear_v1_nodes();
        nodes[0].safe_metadata = serde_json::json!({ "secret": "leak" });
        let error = repo
            .create_template(&NewGraphTemplate {
                template_id: "leaky",
                template_version: 1,
                template_name: "Leaky",
                nodes: &nodes,
                edges: &linear_v1_edges(),
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("secret"));
    }

    #[tokio::test]
    async fn instance_lifecycle_round_trips() {
        let (repo, _, _) = seeded_repo().await;
        let nodes = linear_v1_nodes();
        let edges = linear_v1_edges();
        repo.create_template(&NewGraphTemplate {
            template_id: "linear-v1",
            template_version: 1,
            template_name: "Linear V1",
            nodes: &nodes,
            edges: &edges,
        })
        .await
        .unwrap();

        let instance = repo
            .create_instance(&NewGraphInstance {
                graph_instance_id: "gi-1",
                run_id: "run-graph-1",
                template_id: "linear-v1",
                template_version: 1,
            })
            .await
            .unwrap();
        assert_eq!(instance.status, "active");

        let updated = repo
            .update_instance_status("gi-1", GraphStatus::WaitingForUserContinuation)
            .await
            .unwrap();
        assert_eq!(updated.status, "waiting_for_user_continuation");
        assert!(updated.completed_at.is_none());

        let completed = repo
            .update_instance_status("gi-1", GraphStatus::Completed)
            .await
            .unwrap();
        assert_eq!(completed.status, "completed");
        assert!(completed.completed_at.is_some());

        let listed = repo.list_instances_for_run("run-graph-1").await.unwrap();
        assert_eq!(listed.len(), 1);
    }

    #[tokio::test]
    async fn node_instance_and_attempt_round_trip() {
        let (repo, _, _) = seeded_repo().await;
        let nodes = linear_v1_nodes();
        repo.create_template(&NewGraphTemplate {
            template_id: "linear-v1",
            template_version: 1,
            template_name: "Linear V1",
            nodes: &nodes,
            edges: &linear_v1_edges(),
        })
        .await
        .unwrap();
        repo.create_instance(&NewGraphInstance {
            graph_instance_id: "gi-2",
            run_id: "run-graph-1",
            template_id: "linear-v1",
            template_version: 1,
        })
        .await
        .unwrap();

        let node_instance = repo
            .create_node_instance(&NewNodeInstance {
                node_instance_id: "ni-1",
                graph_instance_id: "gi-2",
                node_id: "provider-call",
                node_type: NodeType::Provider,
            })
            .await
            .unwrap();
        assert_eq!(node_instance.status, "pending");
        assert_eq!(node_instance.attempt_count, 0);

        repo.update_node_instance_status("ni-1", NodeStatus::Ready)
            .await
            .unwrap();

        let attempt = repo
            .create_attempt(&NewNodeAttempt {
                node_attempt_id: "na-1",
                node_instance_id: "ni-1",
                attempt_number: 1,
            })
            .await
            .unwrap();
        assert_eq!(attempt.status, "created");

        let node_instance_after = repo.get_node_instance("ni-1").await.unwrap().unwrap();
        assert_eq!(node_instance_after.attempt_count, 1);

        let updated_attempt = repo
            .update_attempt_status(
                "na-1",
                AttemptStatus::Completed,
                Some(timestamp()),
                Some(timestamp()),
                None,
                None,
                None,
                Some("provider-exec-1"),
            )
            .await
            .unwrap();
        assert_eq!(updated_attempt.status, "completed");
        assert_eq!(
            updated_attempt.provider_execution_id.as_deref(),
            Some("provider-exec-1")
        );

        let attempts = repo.list_attempts_for_node("ni-1").await.unwrap();
        assert_eq!(attempts.len(), 1);
    }

    #[tokio::test]
    async fn try_claim_node_instance_is_exclusive() {
        let (repo, _, _) = seeded_repo().await;
        let nodes = linear_v1_nodes();
        repo.create_template(&NewGraphTemplate {
            template_id: "linear-v1",
            template_version: 1,
            template_name: "Linear V1",
            nodes: &nodes,
            edges: &linear_v1_edges(),
        })
        .await
        .unwrap();
        repo.create_instance(&NewGraphInstance {
            graph_instance_id: "gi-claim",
            run_id: "run-graph-1",
            template_id: "linear-v1",
            template_version: 1,
        })
        .await
        .unwrap();
        repo.create_node_instance(&NewNodeInstance {
            node_instance_id: "ni-claim",
            graph_instance_id: "gi-claim",
            node_id: "provider-call",
            node_type: NodeType::Provider,
        })
        .await
        .unwrap();

        // Pending nodes cannot be claimed directly.
        assert!(!repo.try_claim_node_instance("ni-claim").await.unwrap());

        repo.update_node_instance_status("ni-claim", NodeStatus::Ready)
            .await
            .unwrap();

        let first_claim = repo.try_claim_node_instance("ni-claim").await.unwrap();
        let second_claim = repo.try_claim_node_instance("ni-claim").await.unwrap();
        assert!(first_claim, "first claimant should win");
        assert!(!second_claim, "second claimant must lose the race");

        let node = repo.get_node_instance("ni-claim").await.unwrap().unwrap();
        assert_eq!(node.status, "leased");
    }

    #[tokio::test]
    async fn lease_lifecycle_round_trip() {
        let (repo, _, _) = seeded_repo().await;
        let nodes = linear_v1_nodes();
        repo.create_template(&NewGraphTemplate {
            template_id: "linear-v1",
            template_version: 1,
            template_name: "Linear V1",
            nodes: &nodes,
            edges: &linear_v1_edges(),
        })
        .await
        .unwrap();
        repo.create_instance(&NewGraphInstance {
            graph_instance_id: "gi-3",
            run_id: "run-graph-1",
            template_id: "linear-v1",
            template_version: 1,
        })
        .await
        .unwrap();
        repo.create_node_instance(&NewNodeInstance {
            node_instance_id: "ni-2",
            graph_instance_id: "gi-3",
            node_id: "tool-call",
            node_type: NodeType::Tool,
        })
        .await
        .unwrap();
        repo.create_attempt(&NewNodeAttempt {
            node_attempt_id: "na-2",
            node_instance_id: "ni-2",
            attempt_number: 1,
        })
        .await
        .unwrap();

        let lease = repo
            .create_lease(&NewLease {
                lease_id: "lease-1",
                node_attempt_id: "na-2",
                worker_id: "worker-1",
                leased_at: "1000",
                lease_expires_at: "2000",
            })
            .await
            .unwrap();
        assert_eq!(lease.status, "active");

        let heartbeated = repo
            .heartbeat_lease("lease-1", "1500", "3000")
            .await
            .unwrap();
        assert_eq!(heartbeated.lease_expires_at, "3000");
        assert_eq!(heartbeated.last_heartbeat_at.as_deref(), Some("1500"));

        let expired = repo.list_expired_active_leases("2500").await.unwrap();
        assert!(expired.is_empty(), "lease was heartbeated past 2500");

        let still_expired = repo.list_expired_active_leases("3500").await.unwrap();
        assert_eq!(still_expired.len(), 1);

        let all_active = repo.list_all_active_leases().await.unwrap();
        assert_eq!(all_active.len(), 1);

        let released = repo.release_lease("lease-1").await.unwrap();
        assert_eq!(released.status, "released");

        let all_active_after_release = repo.list_all_active_leases().await.unwrap();
        assert!(all_active_after_release.is_empty());
    }

    #[tokio::test]
    async fn continuation_checkpoint_round_trip() {
        let (repo, _, _) = seeded_repo().await;
        let nodes = linear_v1_nodes();
        repo.create_template(&NewGraphTemplate {
            template_id: "linear-v1",
            template_version: 1,
            template_name: "Linear V1",
            nodes: &nodes,
            edges: &linear_v1_edges(),
        })
        .await
        .unwrap();
        repo.create_instance(&NewGraphInstance {
            graph_instance_id: "gi-4",
            run_id: "run-graph-1",
            template_id: "linear-v1",
            template_version: 1,
        })
        .await
        .unwrap();
        repo.create_node_instance(&NewNodeInstance {
            node_instance_id: "ni-3",
            graph_instance_id: "gi-4",
            node_id: "provider-call",
            node_type: NodeType::Provider,
        })
        .await
        .unwrap();

        let checkpoint = repo
            .create_continuation_checkpoint(&NewContinuationCheckpoint {
                checkpoint_id: "cp-1",
                graph_instance_id: "gi-4",
                node_instance_id: "ni-3",
                safe_metadata_json: Some(r#"{"siblingNodeIds":["tool-call"]}"#),
            })
            .await
            .unwrap();
        assert!(checkpoint.resolved_at.is_none());

        let unresolved = repo
            .list_unresolved_checkpoints_for_graph("gi-4")
            .await
            .unwrap();
        assert_eq!(unresolved.len(), 1);

        let resolved = repo
            .resolve_continuation_checkpoint("cp-1", ContinuationResolution::Continue)
            .await
            .unwrap();
        assert_eq!(resolved.resolution.as_deref(), Some("continue"));
        assert!(resolved.resolved_at.is_some());

        let unresolved_after = repo
            .list_unresolved_checkpoints_for_graph("gi-4")
            .await
            .unwrap();
        assert!(unresolved_after.is_empty());
    }

    #[tokio::test]
    async fn continuation_checkpoint_rejects_forbidden_marker() {
        let (repo, _, _) = seeded_repo().await;
        let nodes = linear_v1_nodes();
        repo.create_template(&NewGraphTemplate {
            template_id: "linear-v1",
            template_version: 1,
            template_name: "Linear V1",
            nodes: &nodes,
            edges: &linear_v1_edges(),
        })
        .await
        .unwrap();
        repo.create_instance(&NewGraphInstance {
            graph_instance_id: "gi-5",
            run_id: "run-graph-1",
            template_id: "linear-v1",
            template_version: 1,
        })
        .await
        .unwrap();
        repo.create_node_instance(&NewNodeInstance {
            node_instance_id: "ni-4",
            graph_instance_id: "gi-5",
            node_id: "provider-call",
            node_type: NodeType::Provider,
        })
        .await
        .unwrap();

        let error = repo
            .create_continuation_checkpoint(&NewContinuationCheckpoint {
                checkpoint_id: "cp-2",
                graph_instance_id: "gi-5",
                node_instance_id: "ni-4",
                safe_metadata_json: Some(r#"{"leak":"raw_thinking"}"#),
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("raw_thinking"));
    }

    #[tokio::test]
    async fn edge_instance_traversal_round_trip() {
        let (repo, _, _) = seeded_repo().await;
        let nodes = linear_v1_nodes();
        let edges = linear_v1_edges();
        repo.create_template(&NewGraphTemplate {
            template_id: "linear-v1",
            template_version: 1,
            template_name: "Linear V1",
            nodes: &nodes,
            edges: &edges,
        })
        .await
        .unwrap();
        repo.create_instance(&NewGraphInstance {
            graph_instance_id: "gi-6",
            run_id: "run-graph-1",
            template_id: "linear-v1",
            template_version: 1,
        })
        .await
        .unwrap();

        let edge_instance = repo
            .create_edge_instance(&NewEdgeInstance {
                edge_instance_id: "ei-1",
                graph_instance_id: "gi-6",
                edge_id: "e1",
                from_node_id: "context-build",
                to_node_id: "provider-call",
                edge_type: EdgeType::Dependency,
            })
            .await
            .unwrap();
        assert!(edge_instance.traversed_at.is_none());

        let traversed = repo.mark_edge_traversed("ei-1").await.unwrap();
        assert!(traversed.traversed_at.is_some());

        let listed = repo.list_edge_instances_for_graph("gi-6").await.unwrap();
        assert_eq!(listed.len(), 1);
    }

    #[tokio::test]
    async fn execution_graph_tables_do_not_store_raw_payload_columns() {
        let (_, _, pool) = seeded_repo().await;
        for table in [
            "graph_templates",
            "graph_instances",
            "graph_nodes",
            "graph_edges",
            "node_attempts",
            "graph_leases",
            "continuation_checkpoints",
        ] {
            let columns: Vec<String> = sqlx::query(&format!("PRAGMA table_info({table})"))
                .fetch_all(&pool)
                .await
                .unwrap()
                .into_iter()
                .map(|row| row.get::<String, _>("name"))
                .collect();
            for forbidden in [
                "prompt",
                "raw_thinking",
                "provider_payload",
                "raw_output",
                "stdout",
                "stderr",
                "secret",
                "credential",
                "api_key",
            ] {
                assert!(
                    !columns
                        .iter()
                        .any(|column| column.to_ascii_lowercase().contains(forbidden)),
                    "table {table} has a column resembling forbidden content: {forbidden}"
                );
            }
        }
    }

    #[test]
    fn execution_graph_static_guard_no_scheduling_or_execution() {
        let source = include_str!("execution_graph.rs");
        let forbidden = [
            concat!("Provider", "Pipeline"),
            concat!("Tool", "SchedulerRuntime"),
            concat!("Agent", "Runtime"),
            concat!("tokio::", "spawn"),
            concat!("std::", "process::Command"),
        ];
        for marker in forbidden {
            assert!(
                !source.contains(marker),
                "execution graph types must not reference scheduling/execution machinery: {marker}"
            );
        }
    }
}
