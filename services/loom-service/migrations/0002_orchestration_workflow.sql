-- Orchestration workflow persistence.
--
-- Privacy rule: raw model thinking/internal monologue must never be persisted.
-- Do not add thinking_text, raw_thinking, chain_of_thought, or hidden_reasoning
-- columns. Orchestration events may store structured AnswerPlan/progress
-- metadata only.

CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id TEXT PRIMARY KEY,
  loom_id TEXT,
  response_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS workflow_stages (
  stage_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  sequence_index INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  metadata_json TEXT,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id)
);

CREATE TABLE IF NOT EXISTS orchestration_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  stage_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_started
  ON workflow_runs(status, started_at);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_loom
  ON workflow_runs(loom_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_response
  ON workflow_runs(response_id);

CREATE INDEX IF NOT EXISTS idx_workflow_stages_run_sequence
  ON workflow_stages(run_id, sequence_index);

CREATE INDEX IF NOT EXISTS idx_workflow_stages_run_status
  ON workflow_stages(run_id, status);

CREATE INDEX IF NOT EXISTS idx_orchestration_events_run_created
  ON orchestration_events(run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_orchestration_events_type_created
  ON orchestration_events(event_type, created_at);
