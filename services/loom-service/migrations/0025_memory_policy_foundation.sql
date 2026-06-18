-- Memory Policy Engine schema foundation.
-- Extends the canonical memories table from migration 0013. No policy
-- behavior, extraction worker, or additional provenance table is introduced.

ALTER TABLE memories ADD COLUMN supersedes_id TEXT REFERENCES memories(memory_id);
ALTER TABLE memories ADD COLUMN always_include INTEGER NOT NULL DEFAULT 0
  CHECK (always_include IN (0, 1));
ALTER TABLE memories ADD COLUMN origin_response_id TEXT;
ALTER TABLE memories ADD COLUMN extraction_method TEXT
  CHECK (extraction_method IN ('explicit', 'llm_extraction', 'system'));
ALTER TABLE memories ADD COLUMN confidence REAL
  CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0));
ALTER TABLE memories ADD COLUMN topic_key TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_supersedes
  ON memories(supersedes_id);

CREATE INDEX IF NOT EXISTS idx_memories_conflict_key
  ON memories(topic_key, source_loom_id, memory_type)
  WHERE deleted_at IS NULL;
