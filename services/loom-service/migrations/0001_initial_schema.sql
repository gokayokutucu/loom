-- Initial loom-service SQLite schema.
--
-- Privacy rule: raw model thinking/internal monologue must never be persisted.
-- Do not add thinking_text, raw_thinking, chain_of_thought, or hidden_reasoning
-- columns. Future thinking metadata may store duration/status only.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS looms (
  loom_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  code TEXT,
  canonical_uri TEXT,
  kind TEXT NOT NULL DEFAULT 'loom',
  origin_loom_id TEXT,
  origin_response_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS responses (
  response_id TEXT PRIMARY KEY,
  loom_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  title TEXT,
  code TEXT,
  canonical_uri TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sequence_index INTEGER NOT NULL,
  metadata_json TEXT,
  FOREIGN KEY (loom_id) REFERENCES looms(loom_id)
);

CREATE TABLE IF NOT EXISTS "references" (
  reference_id TEXT PRIMARY KEY,
  source_loom_id TEXT,
  source_response_id TEXT,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  target_uri TEXT,
  selected_text TEXT,
  label TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  bookmark_id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  target_uri TEXT,
  title TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS addresses (
  address_id TEXT PRIMARY KEY,
  object_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  canonical_uri TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS address_aliases (
  alias_id TEXT PRIMARY KEY,
  canonical_uri TEXT NOT NULL,
  alias_uri TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS response_context_capsules (
  capsule_id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL,
  loom_id TEXT NOT NULL,
  response_code TEXT,
  title TEXT,
  summary TEXT,
  key_points_json TEXT,
  keywords_json TEXT,
  entities_json TEXT,
  code_blocks_json TEXT,
  canonical_uri TEXT,
  source_hash TEXT,
  generator TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loom_checkpoint_summaries (
  checkpoint_id TEXT PRIMARY KEY,
  loom_id TEXT NOT NULL,
  up_to_response_id TEXT,
  summary TEXT NOT NULL,
  decisions_json TEXT,
  constraints_json TEXT,
  open_questions_json TEXT,
  entities_json TEXT,
  wefts_json TEXT,
  references_json TEXT,
  source_hash TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weft_origin_contexts (
  context_id TEXT PRIMARY KEY,
  weft_loom_id TEXT NOT NULL,
  origin_loom_id TEXT NOT NULL,
  origin_response_id TEXT NOT NULL,
  origin_capsule_id TEXT,
  origin_summary TEXT,
  source_hash TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_build_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  loom_id TEXT,
  response_id TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS context_artifact_events (
  event_id TEXT PRIMARY KEY,
  artifact_type TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_kind TEXT,
  aggregate_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_responses_loom_sequence
  ON responses(loom_id, sequence_index);

CREATE INDEX IF NOT EXISTS idx_references_source_loom
  ON "references"(source_loom_id);

CREATE INDEX IF NOT EXISTS idx_references_source_response
  ON "references"(source_response_id);

CREATE INDEX IF NOT EXISTS idx_bookmarks_target
  ON bookmarks(target_kind, target_id);

CREATE INDEX IF NOT EXISTS idx_addresses_object
  ON addresses(object_kind, object_id);

CREATE INDEX IF NOT EXISTS idx_address_aliases_alias_uri
  ON address_aliases(alias_uri);

CREATE INDEX IF NOT EXISTS idx_response_context_capsules_response
  ON response_context_capsules(response_id);

CREATE INDEX IF NOT EXISTS idx_response_context_capsules_loom
  ON response_context_capsules(loom_id);

CREATE INDEX IF NOT EXISTS idx_loom_checkpoint_summaries_loom_response
  ON loom_checkpoint_summaries(loom_id, up_to_response_id);

CREATE INDEX IF NOT EXISTS idx_weft_origin_contexts_weft
  ON weft_origin_contexts(weft_loom_id);

CREATE INDEX IF NOT EXISTS idx_context_build_jobs_status_priority
  ON context_build_jobs(status, priority);

CREATE INDEX IF NOT EXISTS idx_service_events_type_created
  ON service_events(event_type, created_at);
