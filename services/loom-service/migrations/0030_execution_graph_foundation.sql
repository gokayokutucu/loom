-- Execution Graph Foundation.
-- (AGENT-EXECUTION-GRAPH-TYPES-001)
--
-- Durable type system for the future Loom Execution Engine described in
-- docs/agent_execution_graph_design.md and docs/agent_execution_engine_design.md.
--
-- This migration is purely additive: it introduces new tables only and does
-- not alter agent_runs, tool_definitions, tool_invocations, tool_artifacts,
-- tool_permission_grants, context_snapshots, or any other existing table.
--
-- No runtime writes happen against these tables yet (no scheduler, no
-- execution). This migration stores safe identifiers, statuses, timestamps,
-- attempt/retry counters, and structural graph definitions only. It must
-- never persist raw prompt text, provider request/response payloads, raw
-- tool output, attachment contents, raw thinking, or secrets/credentials.

PRAGMA foreign_keys = ON;

-- Static graph shape: one row per (template_id, template_version). The node
-- and edge definitions for a template are stored as validated JSON arrays
-- (validated in Rust via execution_graph::validate_graph_definition before
-- insert) rather than as separate rows, because a template's structure is
-- immutable once created and is always read/written as a whole unit.
CREATE TABLE IF NOT EXISTS graph_templates (
  template_id      TEXT NOT NULL,
  template_version INTEGER NOT NULL CHECK (template_version >= 1),
  template_name    TEXT NOT NULL,
  nodes_json       TEXT NOT NULL,
  edges_json       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (template_id, template_version)
);

-- One row per executed graph (one per AgentRun's graph execution, including
-- child runs spawned by a future SubAgent node).
CREATE TABLE IF NOT EXISTS graph_instances (
  graph_instance_id TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  template_id       TEXT NOT NULL,
  template_version  INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN (
                      'active',
                      'waiting_for_user_continuation',
                      'completed',
                      'failed',
                      'cancelled'
                    )),
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at      TEXT,
  FOREIGN KEY (run_id) REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
  FOREIGN KEY (template_id, template_version)
    REFERENCES graph_templates(template_id, template_version)
);

CREATE INDEX IF NOT EXISTS idx_graph_instances_run_id ON graph_instances(run_id);
CREATE INDEX IF NOT EXISTS idx_graph_instances_status ON graph_instances(status);

-- One row per node *instance*: the per-execution materialization of one
-- node_id from the owning graph_instance's template. node_type is
-- denormalized from the template definition for query convenience.
CREATE TABLE IF NOT EXISTS graph_nodes (
  node_instance_id  TEXT PRIMARY KEY,
  graph_instance_id TEXT NOT NULL,
  node_id           TEXT NOT NULL,
  node_type         TEXT NOT NULL CHECK (node_type IN (
                      'context_build',
                      'provider',
                      'tool',
                      'join',
                      'finish',
                      'planner',
                      'condition',
                      'memory',
                      'artifact',
                      'sub_agent',
                      'human_approval',
                      'summarizer',
                      'evaluator'
                    )),
  status            TEXT NOT NULL CHECK (status IN (
                      'pending',
                      'ready',
                      'leased',
                      'running',
                      'completed',
                      'failed',
                      'cancelled',
                      'waiting_for_user_continuation'
                    )),
  attempt_count     INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (graph_instance_id) REFERENCES graph_instances(graph_instance_id) ON DELETE CASCADE,
  UNIQUE (graph_instance_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_instance ON graph_nodes(graph_instance_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_status ON graph_nodes(status);

-- One row per edge *instance*: the per-execution materialization of one
-- edge_id from the owning graph_instance's template, plus when (if ever) it
-- was traversed. Edge traversal is a fact recorded for audit/replay, not a
-- decision made by this migration or by any code introduced in this task.
CREATE TABLE IF NOT EXISTS graph_edges (
  edge_instance_id  TEXT PRIMARY KEY,
  graph_instance_id TEXT NOT NULL,
  edge_id           TEXT NOT NULL,
  from_node_id      TEXT NOT NULL,
  to_node_id        TEXT NOT NULL,
  edge_type         TEXT NOT NULL CHECK (edge_type IN (
                      'dependency',
                      'success',
                      'failure',
                      'cancelled',
                      'timeout',
                      'parallel',
                      'conditional',
                      'loop',
                      'retry'
                    )),
  traversed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (graph_instance_id) REFERENCES graph_instances(graph_instance_id) ON DELETE CASCADE,
  UNIQUE (graph_instance_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_instance ON graph_edges(graph_instance_id);

-- One row per attempt at executing a node_instance. A node_instance may have
-- more than one attempt (retry policy, or future crash-recovery re-attempts).
CREATE TABLE IF NOT EXISTS node_attempts (
  node_attempt_id       TEXT PRIMARY KEY,
  node_instance_id      TEXT NOT NULL,
  attempt_number        INTEGER NOT NULL CHECK (attempt_number >= 1),
  status                TEXT NOT NULL CHECK (status IN (
                          'created',
                          'leased',
                          'running',
                          'completed',
                          'failed',
                          'cancelled',
                          'abandoned'
                        )),
  started_at            TEXT,
  finished_at           TEXT,
  safe_error_code       TEXT,
  safe_error_message    TEXT,
  tool_invocation_id    TEXT,
  provider_execution_id TEXT,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (node_instance_id) REFERENCES graph_nodes(node_instance_id) ON DELETE CASCADE,
  UNIQUE (node_instance_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_node_attempts_node_instance ON node_attempts(node_instance_id);

-- At most one active lease per node_attempt at a time (enforced by the
-- UNIQUE constraint on node_attempt_id). Recovery metadata only — no
-- scheduling or execution logic is introduced by this migration or its
-- accompanying repository.
CREATE TABLE IF NOT EXISTS graph_leases (
  lease_id          TEXT PRIMARY KEY,
  node_attempt_id   TEXT NOT NULL UNIQUE,
  worker_id         TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('active', 'released', 'expired')),
  leased_at         TEXT NOT NULL,
  lease_expires_at  TEXT NOT NULL,
  last_heartbeat_at TEXT,
  FOREIGN KEY (node_attempt_id) REFERENCES node_attempts(node_attempt_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_graph_leases_expires ON graph_leases(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_graph_leases_status ON graph_leases(status);

-- One row per WaitingForUserContinuation boundary entered by a graph
-- instance. safe_metadata_json is a content-free snapshot of which sibling
-- branches/results were available at pause time (identifiers and statuses
-- only) so a future "Continue with latest tool results" action can be
-- implemented correctly even across a process restart.
CREATE TABLE IF NOT EXISTS continuation_checkpoints (
  checkpoint_id      TEXT PRIMARY KEY,
  graph_instance_id  TEXT NOT NULL,
  node_instance_id   TEXT NOT NULL,
  safe_metadata_json TEXT,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at        TEXT,
  resolution         TEXT CHECK (resolution IS NULL OR resolution IN (
                       'continue',
                       'continue_with_partial',
                       'retry',
                       'cancel'
                     )),
  FOREIGN KEY (graph_instance_id) REFERENCES graph_instances(graph_instance_id) ON DELETE CASCADE,
  FOREIGN KEY (node_instance_id) REFERENCES graph_nodes(node_instance_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_continuation_checkpoints_instance
  ON continuation_checkpoints(graph_instance_id);
