-- Exact code block artifacts linked to Responses.
--
-- Privacy rule: raw model thinking/internal monologue must never be persisted.
-- Do not add thinking_text, raw_thinking, chain_of_thought, or hidden_reasoning
-- columns. Code content is exact fenced-block source from visible Response Markdown.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS response_code_blocks (
  code_block_id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL,
  loom_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  language TEXT,
  code TEXT NOT NULL,
  exact_hash TEXT NOT NULL,
  fence TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (response_id) REFERENCES responses(response_id),
  FOREIGN KEY (loom_id) REFERENCES looms(loom_id)
);

CREATE INDEX IF NOT EXISTS idx_response_code_blocks_response
  ON response_code_blocks(response_id, block_index);

CREATE INDEX IF NOT EXISTS idx_response_code_blocks_loom
  ON response_code_blocks(loom_id);

CREATE INDEX IF NOT EXISTS idx_response_code_blocks_exact_hash
  ON response_code_blocks(exact_hash);
