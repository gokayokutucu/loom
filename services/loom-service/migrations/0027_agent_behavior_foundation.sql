-- Agent Behavior Foundation.
-- (AGENT-BEHAVIOR-FOUNDATION-001)
--
-- Adds canonical AgentDefinition persistence and extends AgentRun metadata for
-- future run-tree execution. This migration stores safe identities and state
-- only. It must not persist prompts, provider payloads, raw thinking, raw tool
-- output, credentials, or secrets.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS agent_definitions (
  agent_id                TEXT NOT NULL,
  revision                TEXT NOT NULL,
  name                    TEXT NOT NULL,
  role                    TEXT NOT NULL,
  instruction_set_ref     TEXT,
  capability_profile_ref  TEXT,
  context_policy_ref      TEXT,
  tool_policy_ref         TEXT,
  provider_policy_ref     TEXT,
  enabled                 INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  metadata_json           TEXT,
  created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, revision)
);

CREATE TABLE agent_runs_v27 (
  agent_run_id        TEXT PRIMARY KEY,
  agent_id            TEXT,
  agent_revision      TEXT,
  loom_id             TEXT,
  weft_id             TEXT,
  response_id         TEXT,
  parent_response_id  TEXT,
  correlation_id      TEXT NOT NULL,
  causation_id        TEXT,
  root_run_id         TEXT,
  parent_run_id       TEXT,
  context_snapshot_id TEXT,
  provider_profile_id TEXT,
  model_id            TEXT,
  status              TEXT NOT NULL CHECK (status IN (
                        'created', 'queued', 'pending', 'running',
                        'waiting_tool', 'waiting_subagent',
                        'completed', 'failed', 'cancelled', 'interrupted'
                      )),
  cancel_requested    INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  started_at          TEXT NOT NULL,
  completed_at        TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  total_tokens        INTEGER,
  error_message       TEXT,
  metadata_json       TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id, agent_revision) REFERENCES agent_definitions(agent_id, revision),
  FOREIGN KEY (parent_run_id) REFERENCES agent_runs_v27(agent_run_id),
  FOREIGN KEY (root_run_id) REFERENCES agent_runs_v27(agent_run_id)
);

INSERT INTO agent_runs_v27 (
  agent_run_id, agent_id, agent_revision, loom_id, weft_id, response_id,
  parent_response_id, correlation_id, causation_id, root_run_id, parent_run_id,
  context_snapshot_id, provider_profile_id, model_id, status, cancel_requested,
  started_at, completed_at, input_tokens, output_tokens, total_tokens,
  error_message, metadata_json, created_at
)
SELECT
  agent_run_id, NULL, NULL, loom_id, weft_id, response_id,
  parent_response_id, correlation_id, causation_id, agent_run_id, parent_run_id,
  context_snapshot_id, provider_profile_id, model_id, status, cancel_requested,
  started_at, completed_at, input_tokens, output_tokens, total_tokens,
  error_message, metadata_json, created_at
FROM agent_runs;

DROP TABLE agent_runs;
ALTER TABLE agent_runs_v27 RENAME TO agent_runs;

CREATE INDEX IF NOT EXISTS idx_agent_definitions_enabled
  ON agent_definitions(enabled, agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_revision
  ON agent_runs(agent_id, agent_revision);

CREATE INDEX IF NOT EXISTS idx_agent_runs_root_run
  ON agent_runs(root_run_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_loom_started
  ON agent_runs(loom_id, started_at);

CREATE INDEX IF NOT EXISTS idx_agent_runs_response
  ON agent_runs(response_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_status_started
  ON agent_runs(status, started_at);

CREATE INDEX IF NOT EXISTS idx_agent_runs_correlation
  ON agent_runs(correlation_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_run
  ON agent_runs(parent_run_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_run_sequence_unique
  ON agent_events(agent_run_id, sequence_number);

PRAGMA foreign_keys = ON;
