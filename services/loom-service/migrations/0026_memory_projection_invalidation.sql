-- Durable invalidation state for rebuildable retrieval projections.
-- No source content, provider payload, prompt, vector, or secret is stored.

ALTER TABLE retrieval_projection_sources
  ADD COLUMN invalidation_state TEXT NOT NULL DEFAULT 'current'
  CHECK (invalidation_state IN ('current', 'stale', 'tombstoned'));

ALTER TABLE retrieval_projection_sources
  ADD COLUMN invalidated_at TEXT;

ALTER TABLE retrieval_projection_chunks
  ADD COLUMN invalidation_state TEXT NOT NULL DEFAULT 'current'
  CHECK (invalidation_state IN ('current', 'stale', 'tombstoned'));

ALTER TABLE retrieval_projection_chunks
  ADD COLUMN invalidated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_retrieval_projection_chunks_invalidation
  ON retrieval_projection_chunks(invalidation_state, source_kind, invalidated_at);
