-- Tool Scheduler Foundation.
-- (TOOL-SCHEDULER-SCHEMA-001)
--
-- Durable metadata and lifecycle records for future tool scheduling. This
-- migration stores safe identifiers, statuses, timestamps, artifact references,
-- and sanitized summaries only. It must not persist raw tool payloads, raw
-- stdout/stderr, file contents, prompts, provider payloads, credentials,
-- secrets, or raw thinking.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tool_definitions (
  tool_id              TEXT PRIMARY KEY,
  tool_name            TEXT NOT NULL UNIQUE,
  tool_kind            TEXT NOT NULL,
  trust_level          TEXT NOT NULL CHECK (trust_level IN (
                         'trusted', 'sandboxed', 'untrusted'
                       )),
  requires_permission  INTEGER NOT NULL DEFAULT 1 CHECK (requires_permission IN (0, 1)),
  is_enabled           INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_invocations (
  invocation_id         TEXT PRIMARY KEY,
  root_run_id           TEXT NOT NULL,
  agent_run_id          TEXT NOT NULL,
  parent_invocation_id  TEXT,
  tool_id               TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN (
                          'requested',
                          'permission_required',
                          'permission_denied',
                          'queued',
                          'running',
                          'completed',
                          'failed',
                          'cancelled',
                          'timed_out'
                        )),
  permission_status     TEXT NOT NULL CHECK (permission_status IN (
                          'not_required',
                          'pending',
                          'granted',
                          'denied',
                          'revoked'
                        )),
  requested_at          TEXT NOT NULL,
  queued_at             TEXT,
  started_at            TEXT,
  completed_at          TEXT,
  cancelled_at          TEXT,
  failed_at             TEXT,
  timeout_ms            INTEGER CHECK (timeout_ms IS NULL OR timeout_ms >= 0),
  sanitized_summary     TEXT,
  diagnostics_json      TEXT,
  FOREIGN KEY (root_run_id) REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_invocation_id) REFERENCES tool_invocations(invocation_id) ON DELETE CASCADE,
  FOREIGN KEY (tool_id) REFERENCES tool_definitions(tool_id)
);

CREATE TABLE IF NOT EXISTS tool_artifacts (
  artifact_id      TEXT PRIMARY KEY,
  invocation_id    TEXT NOT NULL,
  root_run_id      TEXT NOT NULL,
  agent_run_id     TEXT NOT NULL,
  artifact_kind    TEXT NOT NULL,
  storage_ref      TEXT NOT NULL,
  visibility       TEXT NOT NULL CHECK (visibility IN (
                   'agent_internal',
                   'user_visible',
                   'exportable'
                 )),
  content_digest   TEXT,
  size_bytes       INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at       TEXT,
  FOREIGN KEY (invocation_id) REFERENCES tool_invocations(invocation_id) ON DELETE CASCADE,
  FOREIGN KEY (root_run_id) REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tool_permission_grants (
  grant_id           TEXT PRIMARY KEY,
  root_run_id        TEXT NOT NULL,
  agent_run_id       TEXT,
  tool_id            TEXT,
  permission_scope   TEXT NOT NULL,
  permission_status  TEXT NOT NULL CHECK (permission_status IN (
                     'pending',
                     'granted',
                     'denied',
                     'revoked',
                     'expired'
                   )),
  granted_by         TEXT NOT NULL,
  granted_at         TEXT,
  revoked_at         TEXT,
  expires_at         TEXT,
  metadata_json      TEXT,
  FOREIGN KEY (root_run_id) REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
  FOREIGN KEY (tool_id) REFERENCES tool_definitions(tool_id)
);

CREATE INDEX IF NOT EXISTS idx_tool_definitions_enabled
  ON tool_definitions(is_enabled, tool_kind, tool_name);

CREATE INDEX IF NOT EXISTS idx_tool_invocations_root_status
  ON tool_invocations(root_run_id, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_tool_invocations_agent_status
  ON tool_invocations(agent_run_id, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_tool_invocations_tool_status
  ON tool_invocations(tool_id, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_tool_invocations_parent
  ON tool_invocations(parent_invocation_id);

CREATE INDEX IF NOT EXISTS idx_tool_artifacts_invocation
  ON tool_artifacts(invocation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_artifacts_root
  ON tool_artifacts(root_run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_permission_grants_root_status
  ON tool_permission_grants(root_run_id, permission_status, permission_scope);

CREATE INDEX IF NOT EXISTS idx_tool_permission_grants_tool_status
  ON tool_permission_grants(tool_id, permission_status);
