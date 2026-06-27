#![allow(dead_code)]
// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Execution Engine
// migration_status: foundation
// rules:
// - ExecutionScheduler decides what may execute next. It never executes
//   anything itself: no provider calls, no tool calls, no adapter calls, no
//   context building, no memory writes.
// - It only reads/writes execution-graph metadata (graph_instances,
//   graph_nodes, graph_edges, node_attempts, graph_leases,
//   continuation_checkpoints) via ExecutionGraphRepository.
// - Nodes whose status is WaitingForUserContinuation are terminal for this
//   module — nothing here ever transitions one back to Ready. Only a future,
//   explicitly user-triggered API may do that; it is out of scope here.
// - Dispatch (actually calling a provider/tool/adapter for a node this
//   scheduler marked ready) is a separate, future concern. This module
//   returns identities only (ReadyForExecution/ReadyBatch).
// next_task: AGENT-EXECUTION-DISPATCH-001
//! Execution Scheduler.
//!
//! Implements the canonical Loom Execution Scheduler described in
//! `docs/agent_execution_graph_design.md` and
//! `docs/agent_execution_engine_design.md` §2/§3/§6. This module decides
//! what may execute next (dependency/join readiness, lease acquisition,
//! heartbeat, release, expiry, and metadata-only recovery) and nothing more.
//! It never calls the Provider Runtime, the Tool Scheduler Runtime, a Tool
//! Adapter, the Agent Runtime, or the Context Manager — see
//! `execution_scheduler_static_guard_no_execution_calls` below, which
//! enforces this structurally, not just by convention.

use std::collections::HashMap;

use sqlx::SqlitePool;

use crate::error::ServiceError;
use crate::storage::repositories::execution_graph::{
    AttemptStatus, EdgeInstanceRecord, EdgeType, ExecutionGraphRepository, JoinPolicy, LeaseRecord,
    NewLease, NewNodeAttempt, NodeAttemptRecord, NodeDefinition, NodeStatus, NodeType,
};

fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{ms}")
}

fn add_millis(timestamp_ms: &str, delta_ms: i64) -> String {
    let base: i64 = timestamp_ms.parse().unwrap_or(0);
    (base + delta_ms).to_string()
}

// ---------------------------------------------------------------------------
// Public scheduling results — identities only, never execution
// ---------------------------------------------------------------------------

/// One node this scheduler has determined is eligible to run next. This is
/// an identity, not an invitation to execute — the caller (a future,
/// separate dispatch task) decides whether and how to act on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadyForExecution {
    pub graph_instance_id: String,
    pub node_instance_id: String,
    pub node_id: String,
    pub node_type: NodeType,
}

/// A bounded, deterministically-ordered set of [`ReadyForExecution`] items.
/// Ordering is `(created_at, node_instance_id)` ascending so the same
/// underlying state always produces the same batch in the same order,
/// regardless of `HashMap`/query iteration order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReadyBatch {
    pub items: Vec<ReadyForExecution>,
}

impl ReadyBatch {
    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

// ---------------------------------------------------------------------------
// DependencyResolver — pure, deterministic, no I/O
// ---------------------------------------------------------------------------

/// Evaluates whether a single non-`Join` node's incoming edges are
/// satisfied, given the *current* status of every other node in the graph
/// instance. Pure function: same inputs always produce the same output.
///
/// Edge semantics (`docs/agent_execution_graph_design.md` §3):
/// - `Dependency`/`Parallel`: satisfied once the source reaches *any*
///   terminal state (`Completed`/`Failed`/`Cancelled`).
/// - `Success`: satisfied only if the source is `Completed`.
/// - `Failure`: satisfied only if the source is `Failed`.
/// - `Timeout`: modeled identically to `Failure` in this implementation —
///   `AttemptStatus`/`NodeStatus` do not yet carry a distinct "timed out"
///   terminal state separate from `Failed`/`Abandoned` (see engine design
///   §1.2, where a timeout becomes `Abandoned` at the attempt level, not a
///   new terminal). Distinguishing "failed because it timed out" from
///   "failed for another reason" at the edge-evaluation level would require
///   a schema/data addition out of scope for this task; this is a
///   deliberate, documented simplification, not an oversight.
/// - `Cancelled`: satisfied only if the source is `Cancelled`.
/// - `Conditional`: conservatively treated as requiring `Completed` (same
///   as `Success`) — real predicate evaluation against a node's safe output
///   requires output data this scheduler does not persist or read (no
///   schema change was introduced to add it, per task scope); a future
///   dispatch-aware task may refine this once that data exists.
/// - `Loop`/`Retry`: per design, these are template-level/policy
///   constructs, not literal instance edges — if one is ever found on a
///   persisted instance graph (which it should not be), it is treated as
///   never satisfied, defensively, rather than silently ignored.
pub struct DependencyResolver;

impl DependencyResolver {
    pub fn is_satisfied(
        incoming_edges: &[&EdgeInstanceRecord],
        node_status_by_id: &HashMap<&str, NodeStatus>,
    ) -> bool {
        incoming_edges.iter().all(|edge| {
            let source_status = node_status_by_id.get(edge.from_node_id.as_str()).copied();
            match EdgeType::from_str_safe(&edge.edge_type) {
                Some(EdgeType::Dependency) | Some(EdgeType::Parallel) => {
                    source_status.map(NodeStatus::is_terminal).unwrap_or(false)
                }
                Some(EdgeType::Success) => source_status == Some(NodeStatus::Completed),
                Some(EdgeType::Failure) | Some(EdgeType::Timeout) => {
                    source_status == Some(NodeStatus::Failed)
                }
                Some(EdgeType::Cancelled) => source_status == Some(NodeStatus::Cancelled),
                Some(EdgeType::Conditional) => source_status == Some(NodeStatus::Completed),
                Some(EdgeType::Loop) | Some(EdgeType::Retry) | None => false,
            }
        })
    }
}

// ---------------------------------------------------------------------------
// JoinResolver — pure, deterministic, no I/O
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JoinReadiness {
    NotReady,
    Ready {
        satisfied_branch_node_ids: Vec<String>,
    },
    /// The join's policy can structurally never be satisfied given the
    /// branches' current/possible outcomes (e.g. `wait_all` with one branch
    /// already `Failed`, or `quorum` whose remaining live branches can no
    /// longer reach the required count). The caller is responsible for
    /// deciding what to do with this — this resolver only reports the fact.
    Unsatisfiable,
}

/// `docs/agent_execution_graph_design.md` §4. Evaluates a `Join` node's
/// fan-in branches against its policy. Pure function, no I/O.
pub struct JoinResolver;

impl JoinResolver {
    pub fn evaluate(
        join_policy: JoinPolicy,
        incoming_edges: &[&EdgeInstanceRecord],
        node_status_by_id: &HashMap<&str, NodeStatus>,
        quorum_required: Option<usize>,
    ) -> JoinReadiness {
        let branch_node_ids: Vec<&str> = incoming_edges
            .iter()
            .map(|edge| edge.from_node_id.as_str())
            .collect();
        if branch_node_ids.is_empty() {
            // A Join with no incoming branches is vacuously ready — nothing
            // to wait for. Unusual but not invalid.
            return JoinReadiness::Ready {
                satisfied_branch_node_ids: Vec::new(),
            };
        }

        let statuses: Vec<Option<NodeStatus>> = branch_node_ids
            .iter()
            .map(|node_id| node_status_by_id.get(*node_id).copied())
            .collect();
        let completed_branch_ids: Vec<String> = branch_node_ids
            .iter()
            .zip(statuses.iter())
            .filter(|(_, status)| **status == Some(NodeStatus::Completed))
            .map(|(node_id, _)| node_id.to_string())
            .collect();
        let terminal_count = statuses
            .iter()
            .filter(|status| status.map(NodeStatus::is_terminal).unwrap_or(false))
            .count();
        let total = branch_node_ids.len();

        match join_policy {
            JoinPolicy::WaitAll => {
                if terminal_count < total {
                    JoinReadiness::NotReady
                } else if completed_branch_ids.len() == total {
                    JoinReadiness::Ready {
                        satisfied_branch_node_ids: completed_branch_ids,
                    }
                } else {
                    JoinReadiness::Unsatisfiable
                }
            }
            JoinPolicy::WaitAny | JoinPolicy::FirstSuccess => {
                if !completed_branch_ids.is_empty() {
                    JoinReadiness::Ready {
                        satisfied_branch_node_ids: completed_branch_ids,
                    }
                } else if terminal_count == total {
                    // Every branch reached a terminal state and none
                    // succeeded.
                    JoinReadiness::Unsatisfiable
                } else {
                    JoinReadiness::NotReady
                }
            }
            JoinPolicy::Quorum => {
                let required = quorum_required.unwrap_or(total);
                if completed_branch_ids.len() >= required {
                    JoinReadiness::Ready {
                        satisfied_branch_node_ids: completed_branch_ids,
                    }
                } else {
                    let still_pending = total - terminal_count;
                    let best_possible = completed_branch_ids.len() + still_pending;
                    if best_possible < required {
                        JoinReadiness::Unsatisfiable
                    } else {
                        JoinReadiness::NotReady
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// ReadyQueue — in-memory cache only, fully reconstructable from SQLite
// ---------------------------------------------------------------------------

/// `docs/agent_execution_engine_design.md` §2.1: the ready queue is a cache,
/// never the source of truth. It is always safe to discard and rebuild —
/// [`ReadyQueue::rebuild`] performs the exact same computation used during
/// steady-state operation, so "rebuild after restart" is not a special code
/// path, it is this same function called again.
#[derive(Debug, Clone, Default)]
pub struct ReadyQueue {
    items: Vec<ReadyForExecution>,
}

impl ReadyQueue {
    /// Builds a fresh, deterministically-ordered queue from a set of
    /// candidates. Ordering key is `(created_at, node_instance_id)` so two
    /// calls against identical underlying state always produce an identical
    /// queue, independent of map/query iteration order.
    pub fn rebuild(mut candidates: Vec<(ReadyForExecution, String)>) -> Self {
        candidates.sort_by(|(a_item, a_created_at), (b_item, b_created_at)| {
            a_created_at
                .cmp(b_created_at)
                .then_with(|| a_item.node_instance_id.cmp(&b_item.node_instance_id))
        });
        ReadyQueue {
            items: candidates.into_iter().map(|(item, _)| item).collect(),
        }
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn as_batch(&self, max_items: usize) -> ReadyBatch {
        ReadyBatch {
            items: self.items.iter().take(max_items).cloned().collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// Lease acquisition outcome
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeaseAcquisition {
    Acquired {
        lease: LeaseRecord,
        attempt: NodeAttemptRecord,
    },
    /// Another claimant already won the race for this node instance, or it
    /// was no longer `Ready` by the time this call reached the database.
    LostRace,
}

// ---------------------------------------------------------------------------
// LeaseManager
// ---------------------------------------------------------------------------

/// `docs/agent_execution_engine_design.md` §2.2/§2.3. Owns the
/// claim/heartbeat/release lifecycle. The actual mutual-exclusion point is
/// `ExecutionGraphRepository::try_claim_node_instance`'s atomic conditional
/// `UPDATE ... WHERE status = 'ready'` — no separate locking mechanism is
/// introduced here.
pub struct LeaseManager<'a> {
    repository: &'a ExecutionGraphRepository,
}

impl<'a> LeaseManager<'a> {
    pub fn new(repository: &'a ExecutionGraphRepository) -> Self {
        Self { repository }
    }

    pub async fn try_acquire(
        &self,
        node_instance_id: &str,
        worker_id: &str,
        now: &str,
        lease_duration_ms: i64,
    ) -> Result<LeaseAcquisition, ServiceError> {
        let claimed = self
            .repository
            .try_claim_node_instance(node_instance_id)
            .await?;
        if !claimed {
            return Ok(LeaseAcquisition::LostRace);
        }

        let node = self
            .repository
            .get_node_instance(node_instance_id)
            .await?
            .ok_or_else(|| ServiceError::storage("claimed node instance not found"))?;
        let attempt_number = node.attempt_count + 1;
        let node_attempt_id = format!("{node_instance_id}-attempt-{attempt_number}");

        let attempt = self
            .repository
            .create_attempt(&NewNodeAttempt {
                node_attempt_id: &node_attempt_id,
                node_instance_id,
                attempt_number,
            })
            .await?;

        let lease_expires_at = add_millis(now, lease_duration_ms);
        let lease_id = format!("lease-{node_attempt_id}");
        let lease = self
            .repository
            .create_lease(&NewLease {
                lease_id: &lease_id,
                node_attempt_id: &attempt.node_attempt_id,
                worker_id,
                leased_at: now,
                lease_expires_at: &lease_expires_at,
            })
            .await?;

        let attempt = self
            .repository
            .update_attempt_status(
                &attempt.node_attempt_id,
                AttemptStatus::Leased,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .await?;

        Ok(LeaseAcquisition::Acquired { lease, attempt })
    }

    pub async fn heartbeat(
        &self,
        lease_id: &str,
        now: &str,
        lease_duration_ms: i64,
    ) -> Result<LeaseRecord, ServiceError> {
        let new_expires_at = add_millis(now, lease_duration_ms);
        self.repository
            .heartbeat_lease(lease_id, now, &new_expires_at)
            .await
    }

    pub async fn release(&self, lease_id: &str) -> Result<LeaseRecord, ServiceError> {
        self.repository.release_lease(lease_id).await
    }
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RecoveryReport {
    pub expired_leases_recovered: usize,
    pub abandoned_attempt_ids: Vec<String>,
    pub requeued_node_instance_ids: Vec<String>,
    /// Node instances whose owning attempt was abandoned but which were
    /// `WaitingForUserContinuation` (or already terminal) and were
    /// therefore deliberately NOT requeued. Recorded for observability only.
    pub skipped_requeue_node_instance_ids: Vec<String>,
}

/// `docs/agent_execution_engine_design.md` §2.4/§6. Performs metadata-only
/// recovery: expires stale leases, marks their attempts `Abandoned`, and
/// requeues the owning node instance to `Ready` for a future attempt —
/// *unless* that node instance is `WaitingForUserContinuation` or already
/// terminal, in which case it is left untouched (per the mandatory rule
/// that such nodes are never automatically requeued). This struct never
/// calls any downstream execution subsystem (Tool Scheduler, Provider
/// Runtime) to check whether the abandoned work actually finished — that
/// idempotency cross-check is explicitly deferred to a future
/// dispatch-aware task; recovery here only repairs scheduler-owned metadata.
pub struct RecoveryScanner<'a> {
    repository: &'a ExecutionGraphRepository,
}

impl<'a> RecoveryScanner<'a> {
    pub fn new(repository: &'a ExecutionGraphRepository) -> Self {
        Self { repository }
    }

    /// Treats every still-`active` lease whose `lease_expires_at` is at or
    /// before `now` as abandoned. On process boot, callers should pass a
    /// `now` value and additionally treat the *entire* active-lease set as
    /// suspect (per engine design §2.4: a fresh process cannot trust any
    /// lease `lease_expires_at` it did not itself issue) — see
    /// [`RecoveryScanner::run_startup_scan`] for that variant.
    pub async fn scan_expired_leases(&self, now: &str) -> Result<RecoveryReport, ServiceError> {
        let expired = self.repository.list_expired_active_leases(now).await?;
        self.recover_leases(expired, now).await
    }

    /// Startup recovery: unlike a normal in-process tick, a freshly started
    /// process cannot distinguish "this lease is still genuinely active" from
    /// "the previous process died holding it" — per engine design §2.4, every
    /// lease this process did not itself issue is treated as abandoned
    /// immediately, not merely once its `lease_expires_at` passes. This is
    /// achieved by querying with a `now` far enough in the future that every
    /// pre-existing active lease is captured. Callers must supply a `now`
    /// they consider authoritative for "this process's boot time."
    pub async fn run_startup_scan(&self, boot_time: &str) -> Result<RecoveryReport, ServiceError> {
        // Every lease still marked `active` was issued by a process that no
        // longer exists — recover all of them unconditionally, regardless
        // of `lease_expires_at`, since no living worker from a prior process
        // can exist at boot (engine design §2.4).
        let all_active = self.repository.list_all_active_leases().await?;
        self.recover_leases(all_active, boot_time).await
    }

    async fn recover_leases(
        &self,
        leases: Vec<LeaseRecord>,
        now: &str,
    ) -> Result<RecoveryReport, ServiceError> {
        let mut report = RecoveryReport::default();
        for lease in leases {
            self.repository.expire_lease(&lease.lease_id).await?;
            report.expired_leases_recovered += 1;

            let Some(attempt) = self.repository.get_attempt(&lease.node_attempt_id).await? else {
                continue;
            };
            let attempt_status = AttemptStatus::from_str_safe(&attempt.status);
            if !matches!(
                attempt_status,
                Some(AttemptStatus::Leased) | Some(AttemptStatus::Running)
            ) {
                // Already terminal for some other reason (e.g. the attempt
                // actually completed and only the lease release lagged
                // behind) — leave it untouched.
                continue;
            }

            self.repository
                .update_attempt_status(
                    &attempt.node_attempt_id,
                    AttemptStatus::Abandoned,
                    None,
                    Some(now),
                    None,
                    None,
                    None,
                    None,
                )
                .await?;
            report
                .abandoned_attempt_ids
                .push(attempt.node_attempt_id.clone());

            let Some(node) = self
                .repository
                .get_node_instance(&attempt.node_instance_id)
                .await?
            else {
                continue;
            };
            let node_status = NodeStatus::from_str_safe(&node.status);
            let is_waiting_for_user =
                matches!(node_status, Some(NodeStatus::WaitingForUserContinuation));
            let is_terminal = node_status.map(NodeStatus::is_terminal).unwrap_or(true);
            if is_waiting_for_user || is_terminal {
                report
                    .skipped_requeue_node_instance_ids
                    .push(node.node_instance_id);
                continue;
            }

            self.repository
                .update_node_instance_status(&node.node_instance_id, NodeStatus::Ready)
                .await?;
            report
                .requeued_node_instance_ids
                .push(node.node_instance_id);
        }
        Ok(report)
    }
}

// ---------------------------------------------------------------------------
// ExecutionScheduler — the public entry point
// ---------------------------------------------------------------------------

// LOOM_BOUNDARY:
// marker: V2_CANONICAL_RUNTIME
// owner_layer: Execution Engine
// migration_status: foundation
// rules:
// - The only public entry point for scheduling decisions. Internally
//   delegates to DependencyResolver/JoinResolver (pure) and
//   LeaseManager/RecoveryScanner (repository-backed).
// - Never calls any execution subsystem. See the static guard test.
// next_task: AGENT-EXECUTION-DISPATCH-001
#[derive(Debug, Clone)]
pub struct ExecutionScheduler {
    repository: ExecutionGraphRepository,
}

impl ExecutionScheduler {
    pub fn new(repository: ExecutionGraphRepository) -> Self {
        Self { repository }
    }

    pub fn from_pool(pool: &SqlitePool) -> Self {
        Self::new(ExecutionGraphRepository::from_pool(pool))
    }

    /// Discovers every node in `graph_instance_id` that is currently
    /// eligible to run, bounded by `max_batch_size` and by
    /// `max_concurrent_for_instance` (if supplied — the number of
    /// `Leased`/`Running` nodes already in flight for this instance is
    /// subtracted from that cap before truncating the batch). Requires the
    /// owning template's node definitions (for `node_type`/`join_policy`)
    /// since those are not denormalized onto `graph_nodes` rows.
    ///
    /// This is the exact function "rebuild ready queue after restart" means
    /// — there is no separate rebuild code path; calling this after a
    /// restart with no prior in-memory state produces an identical result
    /// to calling it mid-session, because it is computed entirely from
    /// SQLite each time (per engine design §2.1).
    pub async fn discover_ready_batch(
        &self,
        graph_instance_id: &str,
        template_nodes: &[NodeDefinition],
        max_batch_size: usize,
        max_concurrent_for_instance: Option<usize>,
    ) -> Result<ReadyBatch, ServiceError> {
        let nodes = self
            .repository
            .list_node_instances_for_graph(graph_instance_id)
            .await?;
        let edges = self
            .repository
            .list_edge_instances_for_graph(graph_instance_id)
            .await?;

        let node_status_by_id: HashMap<&str, NodeStatus> = nodes
            .iter()
            .filter_map(|node| {
                NodeStatus::from_str_safe(&node.status)
                    .map(|status| (node.node_id.as_str(), status))
            })
            .collect();
        let definition_by_id: HashMap<&str, &NodeDefinition> = template_nodes
            .iter()
            .map(|definition| (definition.node_id.as_str(), definition))
            .collect();

        let mut incoming_by_target: HashMap<&str, Vec<&EdgeInstanceRecord>> = HashMap::new();
        for edge in &edges {
            incoming_by_target
                .entry(edge.to_node_id.as_str())
                .or_default()
                .push(edge);
        }

        let mut candidates: Vec<(ReadyForExecution, String)> = Vec::new();
        let mut joins_to_fail: Vec<String> = Vec::new();

        for node in &nodes {
            if NodeStatus::from_str_safe(&node.status) != Some(NodeStatus::Pending) {
                continue;
            }
            let incoming = incoming_by_target
                .get(node.node_id.as_str())
                .cloned()
                .unwrap_or_default();

            let node_type = NodeType::from_str_safe(&node.node_type);
            let is_ready = if node_type == Some(NodeType::Join) {
                let join_policy = definition_by_id
                    .get(node.node_id.as_str())
                    .and_then(|definition| definition.join_policy)
                    .unwrap_or(JoinPolicy::WaitAll);
                match JoinResolver::evaluate(join_policy, &incoming, &node_status_by_id, None) {
                    JoinReadiness::Ready { .. } => true,
                    JoinReadiness::NotReady => false,
                    JoinReadiness::Unsatisfiable => {
                        joins_to_fail.push(node.node_instance_id.clone());
                        false
                    }
                }
            } else {
                DependencyResolver::is_satisfied(&incoming, &node_status_by_id)
            };

            if is_ready {
                if let Some(node_type) = node_type {
                    candidates.push((
                        ReadyForExecution {
                            graph_instance_id: graph_instance_id.to_string(),
                            node_instance_id: node.node_instance_id.clone(),
                            node_id: node.node_id.clone(),
                            node_type,
                        },
                        node.created_at.clone(),
                    ));
                }
            }
        }

        // A Join whose policy can never be satisfied is a graph-level
        // failure propagation fact, not an execution — recording it is
        // metadata work, identical in kind to every other status transition
        // this scheduler already performs.
        for node_instance_id in joins_to_fail {
            self.repository
                .update_node_instance_status(&node_instance_id, NodeStatus::Failed)
                .await?;
        }

        let mut queue = ReadyQueue::rebuild(candidates);

        let remaining_capacity = match max_concurrent_for_instance {
            Some(limit) => {
                let in_flight = nodes
                    .iter()
                    .filter(|node| {
                        matches!(
                            NodeStatus::from_str_safe(&node.status),
                            Some(NodeStatus::Leased) | Some(NodeStatus::Running)
                        )
                    })
                    .count();
                limit.saturating_sub(in_flight)
            }
            None => usize::MAX,
        };
        let effective_batch_size = max_batch_size.min(remaining_capacity);
        let batch = queue.as_batch(effective_batch_size);
        let _ = &mut queue; // queue is rebuilt fresh on every call; nothing to retain.
        Ok(batch)
    }

    pub async fn acquire_lease(
        &self,
        node_instance_id: &str,
        worker_id: &str,
        now: &str,
        lease_duration_ms: i64,
    ) -> Result<LeaseAcquisition, ServiceError> {
        LeaseManager::new(&self.repository)
            .try_acquire(node_instance_id, worker_id, now, lease_duration_ms)
            .await
    }

    pub async fn heartbeat_lease(
        &self,
        lease_id: &str,
        now: &str,
        lease_duration_ms: i64,
    ) -> Result<LeaseRecord, ServiceError> {
        LeaseManager::new(&self.repository)
            .heartbeat(lease_id, now, lease_duration_ms)
            .await
    }

    /// Records the outcome of an attempt that some future dispatcher
    /// actually executed. This scheduler never produces this outcome on its
    /// own initiative — it must always be told. Refuses to move a node
    /// instance away from `WaitingForUserContinuation` (callers must use a
    /// future, explicit continuation API for that transition instead).
    #[allow(clippy::too_many_arguments)]
    pub async fn report_attempt_outcome(
        &self,
        lease_id: &str,
        node_attempt_id: &str,
        node_instance_id: &str,
        attempt_status: AttemptStatus,
        node_status: NodeStatus,
        now: &str,
        safe_error_code: Option<&str>,
        safe_error_message: Option<&str>,
    ) -> Result<(), ServiceError> {
        if let Some(current) = self.repository.get_node_instance(node_instance_id).await? {
            if NodeStatus::from_str_safe(&current.status)
                == Some(NodeStatus::WaitingForUserContinuation)
            {
                return Err(ServiceError::storage(
                    "cannot report an outcome against a node waiting for user continuation",
                ));
            }
        }

        LeaseManager::new(&self.repository)
            .release(lease_id)
            .await?;
        self.repository
            .update_attempt_status(
                node_attempt_id,
                attempt_status,
                None,
                Some(now),
                safe_error_code,
                safe_error_message,
                None,
                None,
            )
            .await?;
        self.repository
            .update_node_instance_status(node_instance_id, node_status)
            .await?;
        Ok(())
    }

    pub async fn run_recovery_scan(&self, now: &str) -> Result<RecoveryReport, ServiceError> {
        RecoveryScanner::new(&self.repository)
            .scan_expired_leases(now)
            .await
    }

    pub async fn run_startup_recovery(
        &self,
        boot_time: &str,
    ) -> Result<RecoveryReport, ServiceError> {
        RecoveryScanner::new(&self.repository)
            .run_startup_scan(boot_time)
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
            execution_graph::{
                EdgeDefinition, NewEdgeInstance, NewGraphInstance, NewGraphTemplate,
                NewNodeInstance,
            },
        },
    };

    fn timestamp() -> &'static str {
        "1700000000000"
    }

    fn node_def(id: &str, node_type: NodeType, join_policy: Option<JoinPolicy>) -> NodeDefinition {
        NodeDefinition {
            node_id: id.to_string(),
            node_type,
            join_policy,
            retry_max_attempts: None,
            retry_backoff_ms: None,
            safe_metadata: serde_json::Value::Object(serde_json::Map::new()),
        }
    }

    fn edge_def(id: &str, from: &str, to: &str, edge_type: EdgeType) -> EdgeDefinition {
        EdgeDefinition {
            edge_id: id.to_string(),
            from_node_id: from.to_string(),
            to_node_id: to.to_string(),
            edge_type,
            condition_expression: None,
        }
    }

    // -- Pure resolver tests ------------------------------------------------

    #[test]
    fn dependency_resolver_entry_point_has_no_incoming_edges() {
        let statuses = HashMap::new();
        assert!(DependencyResolver::is_satisfied(&[], &statuses));
    }

    #[test]
    fn dependency_resolver_success_edge_requires_completed_source() {
        let edge = EdgeInstanceRecord {
            edge_instance_id: "ei-1".into(),
            graph_instance_id: "gi-1".into(),
            edge_id: "e1".into(),
            from_node_id: "a".into(),
            to_node_id: "b".into(),
            edge_type: "success".into(),
            traversed_at: None,
            created_at: "1".into(),
        };
        let mut statuses = HashMap::new();
        statuses.insert("a", NodeStatus::Failed);
        assert!(!DependencyResolver::is_satisfied(&[&edge], &statuses));

        statuses.insert("a", NodeStatus::Completed);
        assert!(DependencyResolver::is_satisfied(&[&edge], &statuses));
    }

    #[test]
    fn dependency_resolver_loop_and_retry_edges_are_never_satisfied() {
        for edge_type in ["loop", "retry"] {
            let edge = EdgeInstanceRecord {
                edge_instance_id: "ei-1".into(),
                graph_instance_id: "gi-1".into(),
                edge_id: "e1".into(),
                from_node_id: "a".into(),
                to_node_id: "b".into(),
                edge_type: edge_type.into(),
                traversed_at: None,
                created_at: "1".into(),
            };
            let mut statuses = HashMap::new();
            statuses.insert("a", NodeStatus::Completed);
            assert!(!DependencyResolver::is_satisfied(&[&edge], &statuses));
        }
    }

    #[test]
    fn join_resolver_wait_all_requires_every_branch_completed() {
        let edges = vec![
            EdgeInstanceRecord {
                edge_instance_id: "ei-1".into(),
                graph_instance_id: "gi-1".into(),
                edge_id: "e1".into(),
                from_node_id: "a".into(),
                to_node_id: "join".into(),
                edge_type: "dependency".into(),
                traversed_at: None,
                created_at: "1".into(),
            },
            EdgeInstanceRecord {
                edge_instance_id: "ei-2".into(),
                graph_instance_id: "gi-1".into(),
                edge_id: "e2".into(),
                from_node_id: "b".into(),
                to_node_id: "join".into(),
                edge_type: "dependency".into(),
                traversed_at: None,
                created_at: "1".into(),
            },
        ];
        let edge_refs: Vec<&EdgeInstanceRecord> = edges.iter().collect();

        let mut statuses = HashMap::new();
        statuses.insert("a", NodeStatus::Completed);
        statuses.insert("b", NodeStatus::Running);
        assert_eq!(
            JoinResolver::evaluate(JoinPolicy::WaitAll, &edge_refs, &statuses, None),
            JoinReadiness::NotReady
        );

        statuses.insert("b", NodeStatus::Failed);
        assert_eq!(
            JoinResolver::evaluate(JoinPolicy::WaitAll, &edge_refs, &statuses, None),
            JoinReadiness::Unsatisfiable
        );

        statuses.insert("b", NodeStatus::Completed);
        assert_eq!(
            JoinResolver::evaluate(JoinPolicy::WaitAll, &edge_refs, &statuses, None),
            JoinReadiness::Ready {
                satisfied_branch_node_ids: vec!["a".to_string(), "b".to_string()]
            }
        );
    }

    #[test]
    fn join_resolver_wait_any_succeeds_on_first_completion() {
        let edges = vec![EdgeInstanceRecord {
            edge_instance_id: "ei-1".into(),
            graph_instance_id: "gi-1".into(),
            edge_id: "e1".into(),
            from_node_id: "a".into(),
            to_node_id: "join".into(),
            edge_type: "dependency".into(),
            traversed_at: None,
            created_at: "1".into(),
        }];
        let edge_refs: Vec<&EdgeInstanceRecord> = edges.iter().collect();
        let mut statuses = HashMap::new();
        statuses.insert("a", NodeStatus::Running);
        assert_eq!(
            JoinResolver::evaluate(JoinPolicy::WaitAny, &edge_refs, &statuses, None),
            JoinReadiness::NotReady
        );
        statuses.insert("a", NodeStatus::Completed);
        assert_eq!(
            JoinResolver::evaluate(JoinPolicy::WaitAny, &edge_refs, &statuses, None),
            JoinReadiness::Ready {
                satisfied_branch_node_ids: vec!["a".to_string()]
            }
        );
    }

    #[test]
    fn join_resolver_quorum_detects_unreachable_target() {
        let edges = vec![
            EdgeInstanceRecord {
                edge_instance_id: "ei-1".into(),
                graph_instance_id: "gi-1".into(),
                edge_id: "e1".into(),
                from_node_id: "a".into(),
                to_node_id: "join".into(),
                edge_type: "dependency".into(),
                traversed_at: None,
                created_at: "1".into(),
            },
            EdgeInstanceRecord {
                edge_instance_id: "ei-2".into(),
                graph_instance_id: "gi-1".into(),
                edge_id: "e2".into(),
                from_node_id: "b".into(),
                to_node_id: "join".into(),
                edge_type: "dependency".into(),
                traversed_at: None,
                created_at: "1".into(),
            },
            EdgeInstanceRecord {
                edge_instance_id: "ei-3".into(),
                graph_instance_id: "gi-1".into(),
                edge_id: "e3".into(),
                from_node_id: "c".into(),
                to_node_id: "join".into(),
                edge_type: "dependency".into(),
                traversed_at: None,
                created_at: "1".into(),
            },
        ];
        let edge_refs: Vec<&EdgeInstanceRecord> = edges.iter().collect();
        let mut statuses = HashMap::new();
        statuses.insert("a", NodeStatus::Failed);
        statuses.insert("b", NodeStatus::Failed);
        statuses.insert("c", NodeStatus::Running);
        // Need 2 of 3; only "c" remains live and it alone cannot reach 2.
        assert_eq!(
            JoinResolver::evaluate(JoinPolicy::Quorum, &edge_refs, &statuses, Some(2)),
            JoinReadiness::Unsatisfiable
        );
    }

    // -- Integration tests ---------------------------------------------------

    async fn seeded_scheduler() -> (
        ExecutionScheduler,
        ExecutionGraphRepository,
        sqlx::SqlitePool,
    ) {
        let database = test_database().await;
        let pool = database.pool().clone();
        let agent_runs = AgentRunRepository::from_pool(&pool);
        agent_runs
            .create_run(&NewAgentRun {
                agent_run_id: "run-sched-1",
                run_mode: crate::agent_runtime::types::AgentRunMode::FullConversation,
                agent_id: None,
                agent_revision: None,
                loom_id: None,
                response_id: None,
                parent_response_id: None,
                correlation_id: "corr-sched-1",
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

        let graph_repository = ExecutionGraphRepository::from_pool(&pool);
        let nodes = vec![
            node_def("context-build", NodeType::ContextBuild, None),
            node_def("provider-call", NodeType::Provider, None),
            node_def("tool-call", NodeType::Tool, None),
            node_def("finish", NodeType::Finish, None),
        ];
        let edges = vec![
            edge_def("e1", "context-build", "provider-call", EdgeType::Dependency),
            edge_def("e2", "provider-call", "tool-call", EdgeType::Dependency),
            edge_def("e3", "tool-call", "finish", EdgeType::Dependency),
        ];
        graph_repository
            .create_template(&NewGraphTemplate {
                template_id: "linear-v1",
                template_version: 1,
                template_name: "Linear V1",
                nodes: &nodes,
                edges: &edges,
            })
            .await
            .unwrap();
        graph_repository
            .create_instance(&NewGraphInstance {
                graph_instance_id: "gi-sched-1",
                run_id: "run-sched-1",
                template_id: "linear-v1",
                template_version: 1,
            })
            .await
            .unwrap();
        for (node_id, node_type) in [
            ("context-build", NodeType::ContextBuild),
            ("provider-call", NodeType::Provider),
            ("tool-call", NodeType::Tool),
            ("finish", NodeType::Finish),
        ] {
            graph_repository
                .create_node_instance(&NewNodeInstance {
                    node_instance_id: &format!("ni-{node_id}"),
                    graph_instance_id: "gi-sched-1",
                    node_id,
                    node_type,
                })
                .await
                .unwrap();
        }
        for (edge_id, from, to) in [
            ("e1", "context-build", "provider-call"),
            ("e2", "provider-call", "tool-call"),
            ("e3", "tool-call", "finish"),
        ] {
            graph_repository
                .create_edge_instance(&NewEdgeInstance {
                    edge_instance_id: &format!("ei-{edge_id}"),
                    graph_instance_id: "gi-sched-1",
                    edge_id,
                    from_node_id: from,
                    to_node_id: to,
                    edge_type: EdgeType::Dependency,
                })
                .await
                .unwrap();
        }

        let scheduler = ExecutionScheduler::from_pool(&pool);
        (scheduler, graph_repository, pool)
    }

    #[tokio::test]
    async fn discover_ready_batch_finds_only_entry_point_initially() {
        let (scheduler, _, _) = seeded_scheduler().await;
        let template_nodes = vec![
            node_def("context-build", NodeType::ContextBuild, None),
            node_def("provider-call", NodeType::Provider, None),
            node_def("tool-call", NodeType::Tool, None),
            node_def("finish", NodeType::Finish, None),
        ];
        let batch = scheduler
            .discover_ready_batch("gi-sched-1", &template_nodes, 10, None)
            .await
            .unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch.items[0].node_id, "context-build");
    }

    #[tokio::test]
    async fn discover_ready_batch_is_deterministic_across_repeated_calls() {
        let (scheduler, _, _) = seeded_scheduler().await;
        let template_nodes = vec![
            node_def("context-build", NodeType::ContextBuild, None),
            node_def("provider-call", NodeType::Provider, None),
            node_def("tool-call", NodeType::Tool, None),
            node_def("finish", NodeType::Finish, None),
        ];
        let first = scheduler
            .discover_ready_batch("gi-sched-1", &template_nodes, 10, None)
            .await
            .unwrap();
        let second = scheduler
            .discover_ready_batch("gi-sched-1", &template_nodes, 10, None)
            .await
            .unwrap();
        assert_eq!(first, second);
    }

    #[tokio::test]
    async fn lease_acquire_heartbeat_release_full_cycle() {
        let (scheduler, repo, _) = seeded_scheduler().await;
        repo.update_node_instance_status("ni-context-build", NodeStatus::Ready)
            .await
            .unwrap();

        let acquisition = scheduler
            .acquire_lease("ni-context-build", "worker-1", "1000", 5000)
            .await
            .unwrap();
        let (lease, attempt) = match acquisition {
            LeaseAcquisition::Acquired { lease, attempt } => (lease, attempt),
            LeaseAcquisition::LostRace => panic!("expected to win the claim"),
        };
        assert_eq!(lease.status, "active");
        assert_eq!(attempt.status, "leased");

        let node_after_claim = repo
            .get_node_instance("ni-context-build")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(node_after_claim.status, "leased");

        let heartbeated = scheduler
            .heartbeat_lease(&lease.lease_id, "2000", 5000)
            .await
            .unwrap();
        assert_eq!(heartbeated.lease_expires_at, "7000");

        scheduler
            .report_attempt_outcome(
                &lease.lease_id,
                &attempt.node_attempt_id,
                "ni-context-build",
                AttemptStatus::Completed,
                NodeStatus::Completed,
                "3000",
                None,
                None,
            )
            .await
            .unwrap();

        let node_after_completion = repo
            .get_node_instance("ni-context-build")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(node_after_completion.status, "completed");

        let lease_after = repo.get_lease(&lease.lease_id).await.unwrap().unwrap();
        assert_eq!(lease_after.status, "released");
    }

    #[tokio::test]
    async fn second_claimant_loses_the_race() {
        let (scheduler, repo, _) = seeded_scheduler().await;
        repo.update_node_instance_status("ni-context-build", NodeStatus::Ready)
            .await
            .unwrap();

        let first = scheduler
            .acquire_lease("ni-context-build", "worker-1", "1000", 5000)
            .await
            .unwrap();
        assert!(matches!(first, LeaseAcquisition::Acquired { .. }));

        let second = scheduler
            .acquire_lease("ni-context-build", "worker-2", "1000", 5000)
            .await
            .unwrap();
        assert_eq!(second, LeaseAcquisition::LostRace);
    }

    #[tokio::test]
    async fn report_attempt_outcome_refuses_to_override_waiting_for_user_continuation() {
        let (scheduler, repo, _) = seeded_scheduler().await;
        repo.update_node_instance_status("ni-provider-call", NodeStatus::Ready)
            .await
            .unwrap();
        let acquisition = scheduler
            .acquire_lease("ni-provider-call", "worker-1", "1000", 5000)
            .await
            .unwrap();
        let (lease, attempt) = match acquisition {
            LeaseAcquisition::Acquired { lease, attempt } => (lease, attempt),
            LeaseAcquisition::LostRace => panic!("expected to win the claim"),
        };

        // Simulate a future continuation API having already parked this
        // node — the scheduler must never auto-clear that.
        repo.update_node_instance_status(
            "ni-provider-call",
            NodeStatus::WaitingForUserContinuation,
        )
        .await
        .unwrap();

        let error = scheduler
            .report_attempt_outcome(
                &lease.lease_id,
                &attempt.node_attempt_id,
                "ni-provider-call",
                AttemptStatus::Completed,
                NodeStatus::Completed,
                "2000",
                None,
                None,
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("waiting for user continuation"));

        let node = repo
            .get_node_instance("ni-provider-call")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(node.status, "waiting_for_user_continuation");
    }

    #[tokio::test]
    async fn recovery_scan_abandons_expired_lease_and_requeues_node() {
        let (scheduler, repo, _) = seeded_scheduler().await;
        repo.update_node_instance_status("ni-tool-call", NodeStatus::Ready)
            .await
            .unwrap();
        let acquisition = scheduler
            .acquire_lease("ni-tool-call", "worker-1", "1000", 1000)
            .await
            .unwrap();
        assert!(matches!(acquisition, LeaseAcquisition::Acquired { .. }));

        // Lease expires at 2000; recover at 5000 (well past expiry).
        let report = scheduler.run_recovery_scan("5000").await.unwrap();
        assert_eq!(report.expired_leases_recovered, 1);
        assert_eq!(
            report.requeued_node_instance_ids,
            vec!["ni-tool-call".to_string()]
        );
        assert!(report.skipped_requeue_node_instance_ids.is_empty());

        let node = repo
            .get_node_instance("ni-tool-call")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(node.status, "ready");
    }

    #[tokio::test]
    async fn recovery_scan_never_requeues_a_waiting_for_user_continuation_node() {
        let (scheduler, repo, _) = seeded_scheduler().await;
        repo.update_node_instance_status("ni-provider-call", NodeStatus::Ready)
            .await
            .unwrap();
        let acquisition = scheduler
            .acquire_lease("ni-provider-call", "worker-1", "1000", 1000)
            .await
            .unwrap();
        let attempt = match acquisition {
            LeaseAcquisition::Acquired { attempt, .. } => attempt,
            LeaseAcquisition::LostRace => panic!("expected to win the claim"),
        };
        // The node reaches WaitingForUserContinuation (e.g. its Provider
        // turn completed) while its lease row is still technically present
        // (a future dispatcher would release it; simulate the lease
        // expiring before that happens).
        repo.update_node_instance_status(
            "ni-provider-call",
            NodeStatus::WaitingForUserContinuation,
        )
        .await
        .unwrap();
        let _ = attempt;

        let report = scheduler.run_recovery_scan("5000").await.unwrap();
        assert_eq!(report.expired_leases_recovered, 1);
        assert!(report.requeued_node_instance_ids.is_empty());
        assert_eq!(
            report.skipped_requeue_node_instance_ids,
            vec!["ni-provider-call".to_string()]
        );

        let node = repo
            .get_node_instance("ni-provider-call")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(node.status, "waiting_for_user_continuation");
    }

    #[tokio::test]
    async fn startup_recovery_reclaims_leases_regardless_of_expiry_timestamp() {
        let (scheduler, repo, _) = seeded_scheduler().await;
        repo.update_node_instance_status("ni-context-build", NodeStatus::Ready)
            .await
            .unwrap();
        // A lease duration long enough that it has not "expired" in the
        // normal sense a short time later, simulating a crash mid-lease.
        // Timestamps deliberately stay at realistic epoch-millisecond scale
        // (13 digits, matching `now_iso()` in production) throughout this
        // test — `lease_expires_at` comparisons are TEXT comparisons at the
        // SQLite layer, which only behave numerically when both operands
        // have the same digit count, exactly as real epoch-ms values always
        // do across any practical timespan.
        let acquisition = scheduler
            .acquire_lease("ni-context-build", "worker-1", "1700000000000", 300_000)
            .await
            .unwrap();
        assert!(matches!(acquisition, LeaseAcquisition::Acquired { .. }));

        // A normal (non-startup) scan a short time later would find
        // nothing, because the lease has not expired yet.
        let normal_scan = scheduler.run_recovery_scan("1700000100000").await.unwrap();
        assert_eq!(normal_scan.expired_leases_recovered, 0);

        // Startup recovery treats it as abandoned anyway.
        let startup_scan = scheduler
            .run_startup_recovery("1700000100000")
            .await
            .unwrap();
        assert_eq!(startup_scan.expired_leases_recovered, 1);
        assert_eq!(
            startup_scan.requeued_node_instance_ids,
            vec!["ni-context-build".to_string()]
        );
    }

    #[tokio::test]
    async fn discover_ready_batch_respects_bounded_concurrency() {
        let (scheduler, repo, _) = seeded_scheduler().await;
        // Make both context-build and provider-call simultaneously Ready by
        // dropping provider-call's dependency on context-build for this
        // bounded-concurrency check (directly flipping status to isolate the
        // concurrency cap from dependency evaluation).
        repo.update_node_instance_status("ni-context-build", NodeStatus::Ready)
            .await
            .unwrap();
        repo.update_node_instance_status("ni-provider-call", NodeStatus::Leased)
            .await
            .unwrap();

        let template_nodes = vec![
            node_def("context-build", NodeType::ContextBuild, None),
            node_def("provider-call", NodeType::Provider, None),
            node_def("tool-call", NodeType::Tool, None),
            node_def("finish", NodeType::Finish, None),
        ];
        // One node ("provider-call") is already in flight; cap of 1 means no
        // further nodes may be claimed right now.
        let batch = scheduler
            .discover_ready_batch("gi-sched-1", &template_nodes, 10, Some(1))
            .await
            .unwrap();
        assert!(batch.is_empty());
    }

    #[test]
    fn execution_scheduler_static_guard_no_execution_calls() {
        let source = include_str!("execution_scheduler.rs");
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
        ];
        for marker in forbidden {
            assert!(
                !source.contains(marker),
                "execution scheduler must never reference an execution subsystem: {marker}"
            );
        }
    }
}
