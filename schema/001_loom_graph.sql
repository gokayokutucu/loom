PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS loom_objects (
  object_id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL CHECK (
    object_type IN (
      'conversation',
      'response',
      'quick_question',
      'bookmark',
      'fragment',
      'reference_mention'
    )
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'archived', 'deleted', 'unreachable')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE REFERENCES loom_objects(object_id),
  title TEXT NOT NULL,
  origin_type TEXT NOT NULL CHECK (origin_type IN ('root', 'fork', 'derived', 'imported')),
  forked_from_conversation_id TEXT REFERENCES conversations(conversation_id),
  forked_from_response_id TEXT REFERENCES responses(response_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responses (
  response_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE REFERENCES loom_objects(object_id),
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
  parent_response_id TEXT REFERENCES responses(response_id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  title TEXT,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quick_questions (
  quick_question_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE REFERENCES loom_objects(object_id),
  anchor_response_id TEXT NOT NULL REFERENCES responses(response_id),
  status TEXT NOT NULL CHECK (status IN ('ephemeral', 'promoted', 'discarded')),
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fragments (
  fragment_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE REFERENCES loom_objects(object_id),
  source_response_id TEXT NOT NULL REFERENCES responses(response_id),
  start_offset INTEGER,
  end_offset INTEGER,
  selected_text TEXT,
  snapshot_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  bookmark_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE REFERENCES loom_objects(object_id),
  target_object_id TEXT NOT NULL REFERENCES loom_objects(object_id),
  title TEXT NOT NULL,
  loom_address TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_mentions (
  mention_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL UNIQUE REFERENCES loom_objects(object_id),
  source_conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
  target_object_id TEXT NOT NULL REFERENCES loom_objects(object_id),
  range_start INTEGER,
  range_end INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loom_edges (
  edge_id TEXT PRIMARY KEY,
  from_object_id TEXT NOT NULL REFERENCES loom_objects(object_id),
  to_object_id TEXT NOT NULL REFERENCES loom_objects(object_id),
  edge_type TEXT NOT NULL CHECK (
    edge_type IN (
      'contains',
      'references',
      'forked_from',
      'derived_from',
      'bookmarked_as',
      'promoted_from',
      'anchored_to',
      'mentions'
    )
  ),
  created_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS loom_addresses (
  address_id TEXT PRIMARY KEY,
  target_object_id TEXT NOT NULL REFERENCES loom_objects(object_id),
  canonical_uri TEXT NOT NULL UNIQUE,
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loom_address_aliases (
  alias_id TEXT PRIMARY KEY,
  target_object_id TEXT NOT NULL REFERENCES loom_objects(object_id),
  alias_uri TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  retired_at TEXT
);

CREATE TABLE IF NOT EXISTS loom_revisions (
  revision_id TEXT PRIMARY KEY,
  target_object_id TEXT NOT NULL REFERENCES loom_objects(object_id),
  revision_number INTEGER,
  snapshot_hash TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(target_object_id, revision_number),
  UNIQUE(target_object_id, snapshot_hash)
);

CREATE TABLE IF NOT EXISTS loom_windows (
  window_id TEXT PRIMARY KEY,
  window_type TEXT NOT NULL CHECK (
    window_type IN ('conversation', 'loom', 'reference', 'time', 'context', 'lineage')
  ),
  anchor_object_id TEXT REFERENCES loom_objects(object_id),
  params_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loom_window_members (
  window_id TEXT NOT NULL REFERENCES loom_windows(window_id),
  object_id TEXT NOT NULL REFERENCES loom_objects(object_id),
  sort_key TEXT,
  metadata_json TEXT,
  PRIMARY KEY (window_id, object_id)
);

CREATE TABLE IF NOT EXISTS loom_navigation_history (
  history_id TEXT PRIMARY KEY,
  destination_object_id TEXT NOT NULL REFERENCES loom_objects(object_id),
  window_type TEXT CHECK (
    window_type IN ('conversation', 'loom', 'reference', 'time', 'context', 'lineage')
  ),
  params_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loom_ledger_events (
  ledger_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'bookmark_created',
      'address_created',
      'alias_created',
      'alias_updated',
      'alias_retired',
      'fork_created',
      'reference_mention_created',
      'fragment_created',
      'object_archived',
      'object_deleted',
      'broken_reference_detected',
      'revision_created'
    )
  ),
  object_id TEXT REFERENCES loom_objects(object_id),
  related_object_id TEXT REFERENCES loom_objects(object_id),
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_loom_ledger_events_no_update
BEFORE UPDATE ON loom_ledger_events
BEGIN
  SELECT RAISE(ABORT, 'loom_ledger_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_loom_ledger_events_no_delete
BEFORE DELETE ON loom_ledger_events
BEGIN
  SELECT RAISE(ABORT, 'loom_ledger_events is append-only');
END;

CREATE INDEX IF NOT EXISTS idx_loom_objects_type_status
  ON loom_objects(object_type, status);

CREATE INDEX IF NOT EXISTS idx_responses_conversation
  ON responses(conversation_id, parent_response_id);

CREATE INDEX IF NOT EXISTS idx_edges_from_type
  ON loom_edges(from_object_id, edge_type);

CREATE INDEX IF NOT EXISTS idx_edges_to_type
  ON loom_edges(to_object_id, edge_type);

CREATE INDEX IF NOT EXISTS idx_addresses_target_primary
  ON loom_addresses(target_object_id, is_primary);

CREATE INDEX IF NOT EXISTS idx_aliases_target_active
  ON loom_address_aliases(target_object_id, is_active);

CREATE INDEX IF NOT EXISTS idx_bookmarks_target
  ON bookmarks(target_object_id);

CREATE INDEX IF NOT EXISTS idx_revisions_target
  ON loom_revisions(target_object_id, revision_number);

CREATE INDEX IF NOT EXISTS idx_windows_anchor
  ON loom_windows(anchor_object_id, window_type);

CREATE INDEX IF NOT EXISTS idx_window_members_object
  ON loom_window_members(object_id);

CREATE INDEX IF NOT EXISTS idx_navigation_history_time
  ON loom_navigation_history(created_at);

CREATE INDEX IF NOT EXISTS idx_ledger_event_type_time
  ON loom_ledger_events(event_type, created_at);

-- Sample recursive query: descendants from a branch root.
-- WITH RECURSIVE descendants(object_id, depth) AS (
--   SELECT :root_object_id, 0
--   UNION ALL
--   SELECT e.to_object_id, descendants.depth + 1
--   FROM loom_edges e
--   JOIN descendants ON e.from_object_id = descendants.object_id
--   WHERE e.edge_type IN ('contains', 'forked_from', 'derived_from')
-- )
-- SELECT * FROM descendants ORDER BY depth;

-- Sample query: references to a response.
-- SELECT rm.*
-- FROM reference_mentions rm
-- JOIN loom_objects target ON target.object_id = rm.target_object_id
-- WHERE target.object_id = :response_object_id;
