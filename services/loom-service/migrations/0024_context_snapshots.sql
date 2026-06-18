-- Context Snapshot persistence foundation (CONTEXT-SNAPSHOT-MIGRATION-001).
--
-- Privacy boundary: these tables store references and safe metadata only.
-- Never add full content, prompt text, provider payloads/deltas, raw thinking,
-- secrets, vectors, or raw tool output columns.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS context_snapshots (
  snapshot_id       TEXT PRIMARY KEY,
  agent_run_id      TEXT,
  loom_id           TEXT NOT NULL,
  response_id       TEXT,
  scope_context_id  TEXT,
  created_at        TEXT NOT NULL,
  policy_version    TEXT NOT NULL,
  selection_version TEXT NOT NULL,
  budget_json       TEXT NOT NULL,
  diagnostics_json  TEXT NOT NULL,
  candidate_count   INTEGER NOT NULL CHECK (candidate_count >= 0),
  selected_count    INTEGER NOT NULL CHECK (selected_count >= 0),
  rejected_count    INTEGER NOT NULL CHECK (rejected_count >= 0),
  CHECK (candidate_count = selected_count + rejected_count),
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(agent_run_id),
  FOREIGN KEY (loom_id) REFERENCES looms(loom_id),
  FOREIGN KEY (response_id) REFERENCES responses(response_id)
);

CREATE TABLE IF NOT EXISTS context_snapshot_candidates (
  snapshot_candidate_id TEXT PRIMARY KEY,
  snapshot_id            TEXT NOT NULL,
  source_kind            TEXT NOT NULL,
  source_id              TEXT NOT NULL,
  chunk_ref              TEXT NOT NULL,
  tier                   TEXT NOT NULL,
  include_mode_hint      TEXT NOT NULL,
  estimated_tokens       INTEGER NOT NULL CHECK (estimated_tokens >= 0),
  retrieval_score        REAL,
  final_rank             INTEGER NOT NULL CHECK (final_rank >= 1),
  is_mandatory           INTEGER NOT NULL CHECK (is_mandatory IN (0, 1)),
  is_hidden_background   INTEGER NOT NULL CHECK (is_hidden_background IN (0, 1)),
  is_selected            INTEGER NOT NULL CHECK (is_selected IN (0, 1)),
  rejection_reason       TEXT,
  metadata_json          TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES context_snapshots(snapshot_id) ON DELETE CASCADE,
  UNIQUE (snapshot_id, final_rank),
  UNIQUE (snapshot_id, source_kind, source_id, chunk_ref)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_context_snapshots_agent_run
  ON context_snapshots(agent_run_id) WHERE agent_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_context_snapshots_loom_created
  ON context_snapshots(loom_id, created_at);

CREATE INDEX IF NOT EXISTS idx_context_snapshot_candidates_rank
  ON context_snapshot_candidates(snapshot_id, final_rank);

CREATE INDEX IF NOT EXISTS idx_context_snapshot_candidates_source
  ON context_snapshot_candidates(source_kind, source_id, chunk_ref);
