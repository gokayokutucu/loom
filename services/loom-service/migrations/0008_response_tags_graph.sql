-- Derived tags, topic index, and context graph links.
--
-- These tables are rebuildable service artifacts derived from visible Response
-- content, Response parts, exact Code Block Artifacts, and safe metadata.
-- Privacy rule: raw model thinking/internal monologue must never be persisted.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS response_tags (
  tag_id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL,
  loom_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  normalized_tag TEXT NOT NULL,
  tag_kind TEXT NOT NULL,
  confidence REAL,
  source TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (response_id) REFERENCES responses(response_id),
  FOREIGN KEY (loom_id) REFERENCES looms(loom_id)
);

CREATE INDEX IF NOT EXISTS idx_response_tags_response
  ON response_tags(response_id);

CREATE INDEX IF NOT EXISTS idx_response_tags_loom_tag
  ON response_tags(loom_id, normalized_tag);

CREATE INDEX IF NOT EXISTS idx_response_tags_loom_kind
  ON response_tags(loom_id, tag_kind);

CREATE TABLE IF NOT EXISTS loom_topic_index (
  topic_id TEXT PRIMARY KEY,
  loom_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  normalized_topic TEXT NOT NULL,
  first_response_id TEXT,
  latest_response_id TEXT,
  weight REAL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (loom_id) REFERENCES looms(loom_id),
  FOREIGN KEY (first_response_id) REFERENCES responses(response_id),
  FOREIGN KEY (latest_response_id) REFERENCES responses(response_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loom_topic_index_loom_topic
  ON loom_topic_index(loom_id, normalized_topic);

CREATE INDEX IF NOT EXISTS idx_loom_topic_index_loom_weight
  ON loom_topic_index(loom_id, weight);

CREATE TABLE IF NOT EXISTS context_graph_links (
  link_id TEXT PRIMARY KEY,
  loom_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  link_kind TEXT NOT NULL,
  weight REAL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (loom_id) REFERENCES looms(loom_id)
);

CREATE INDEX IF NOT EXISTS idx_context_graph_links_source
  ON context_graph_links(loom_id, source_kind, source_id);

CREATE INDEX IF NOT EXISTS idx_context_graph_links_target
  ON context_graph_links(loom_id, target_kind, target_id);

CREATE INDEX IF NOT EXISTS idx_context_graph_links_kind
  ON context_graph_links(loom_id, link_kind);
