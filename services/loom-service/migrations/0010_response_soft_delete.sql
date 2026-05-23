-- Response soft-delete support.
--
-- Edited user prompts invalidate downstream active Responses without erasing
-- durable records. Deleted rows remain addressable as tombstones and are
-- excluded from active Loom projections, graph traversal, and context.

ALTER TABLE responses ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE responses ADD COLUMN deleted_at TEXT;
ALTER TABLE responses ADD COLUMN deleted_reason TEXT;
ALTER TABLE responses ADD COLUMN deleted_by_response_id TEXT;

CREATE INDEX IF NOT EXISTS idx_responses_active_loom_sequence
  ON responses(loom_id, is_deleted, sequence_index);
