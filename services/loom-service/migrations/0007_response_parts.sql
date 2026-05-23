-- Derived semantic Response parts.
--
-- Raw Response Markdown remains authoritative. These rows are rebuildable
-- artifacts for future capsules, graph links, tags, search, and suggestions.
-- Privacy rule: raw model thinking/internal monologue must never be persisted.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS response_parts (
  part_id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL,
  loom_id TEXT NOT NULL,
  sequence_index INTEGER NOT NULL,
  part_kind TEXT NOT NULL,
  content TEXT,
  markdown TEXT,
  code_block_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (response_id) REFERENCES responses(response_id),
  FOREIGN KEY (loom_id) REFERENCES looms(loom_id),
  FOREIGN KEY (code_block_id) REFERENCES response_code_blocks(code_block_id)
);

CREATE INDEX IF NOT EXISTS idx_response_parts_response
  ON response_parts(response_id, sequence_index);

CREATE INDEX IF NOT EXISTS idx_response_parts_loom
  ON response_parts(loom_id);

CREATE INDEX IF NOT EXISTS idx_response_parts_kind
  ON response_parts(part_kind);

CREATE INDEX IF NOT EXISTS idx_response_parts_code_block
  ON response_parts(code_block_id);
