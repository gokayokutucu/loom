-- Agent Run Persistence, Tracing, and Append-Only Event Log.
-- (AGENT-RUN-PERSISTENCE-001)
--
-- Privacy rule: raw model thinking/internal monologue must never be persisted.
-- Do not add thinking_text, raw_thinking, chain_of_thought, or hidden_reasoning columns.
-- Do not add prompt, messages, context, provider_payload, or provider_request columns.
-- Do not add authorization, bearer, api_key, apiKey, token, or secret columns.
-- agent_runs stores run metadata and safe references only.
-- agent_steps stores structured step metadata only.
-- agent_events is an append-only trace log of safe event payloads.
-- provider_delta text (streaming content) must never be persisted in agent_events.
-- tool output summaries must not be persisted in agent_events.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_runs (
  -- Primary identity: UUID v4, always independently generated, never derived from response_id.
  agent_run_id       TEXT PRIMARY KEY,
  -- Loom domain references (FK-intent; not enforced — agent runtime has no DB access today).
  loom_id            TEXT,
  weft_id            TEXT,
  response_id        TEXT,
  parent_response_id TEXT,
  -- Trace identity
  correlation_id     TEXT NOT NULL,
  causation_id       TEXT,
  parent_run_id      TEXT,
  -- Context linkage (Phase 3 integration point)
  context_snapshot_id TEXT,
  -- Provider identity
  provider_profile_id TEXT,
  model_id            TEXT,
  -- Run lifecycle
  status             TEXT NOT NULL CHECK (status IN (
                       'pending', 'running', 'completed', 'failed',
                       'cancelled', 'interrupted'
                     )),
  cancel_requested   INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  -- Timing (ISO 8601 TEXT, consistent with all Loom tables)
  started_at         TEXT NOT NULL,
  completed_at       TEXT,
  -- Token usage (counts only — no content)
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  total_tokens       INTEGER,
  -- Sanitized error message for failed/interrupted runs only
  error_message      TEXT,
  -- Safe metadata extension slot — must never contain prompt body, provider payloads,
  -- authorization headers, raw thinking, bearer tokens, api keys, or secrets.
  metadata_json      TEXT,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_steps (
  agent_step_id  TEXT PRIMARY KEY,
  agent_run_id   TEXT NOT NULL,
  kind           TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN (
                   'pending', 'running', 'completed', 'failed', 'cancelled', 'skipped'
                 )),
  sequence_index INTEGER NOT NULL,
  started_at     TEXT,
  completed_at   TEXT,
  error          TEXT,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(agent_run_id)
);

CREATE TABLE IF NOT EXISTS agent_events (
  -- Append-only event log: never UPDATE or DELETE rows in this table.
  agent_event_id  TEXT PRIMARY KEY,
  agent_run_id    TEXT NOT NULL,
  agent_step_id   TEXT,
  sequence_number INTEGER NOT NULL,
  event_type      TEXT NOT NULL,
  -- Payload built from an explicit safe allowlist per event type.
  -- Must never contain: prompt text, provider_delta text, provider request body,
  -- authorization headers, bearer tokens, api keys, raw thinking, or secrets.
  -- provider_delta text (streaming content) is excluded — canonical home is responses table.
  -- tool_call_completed output_summary is excluded.
  payload_json    TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(agent_run_id)
);

-- Indexes for agent_runs
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

-- Indexes for agent_steps
CREATE INDEX IF NOT EXISTS idx_agent_steps_run_sequence
  ON agent_steps(agent_run_id, sequence_index);

CREATE INDEX IF NOT EXISTS idx_agent_steps_run_status
  ON agent_steps(agent_run_id, status);

-- Indexes for agent_events
CREATE INDEX IF NOT EXISTS idx_agent_events_run_sequence
  ON agent_events(agent_run_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_agent_events_run_type
  ON agent_events(agent_run_id, event_type);

CREATE INDEX IF NOT EXISTS idx_agent_events_step
  ON agent_events(agent_step_id);
