-- SQLite retrieval projection contracts.
--
-- SQLite remains the source of truth. These tables track rebuildable
-- projection identity and lifecycle metadata for future retrieval adapters.
-- They do not store embeddings, external index payloads, raw provider
-- payloads, prompt envelopes, raw thinking, or tool execution output.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS retrieval_projection_sources (
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  projection_version TEXT NOT NULL,
  loom_id TEXT,
  response_id TEXT,
  source_digest TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  source_updated_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (source_kind, source_id, projection_version)
);

CREATE INDEX IF NOT EXISTS idx_retrieval_projection_sources_loom
  ON retrieval_projection_sources(loom_id, is_deleted, source_kind);

CREATE INDEX IF NOT EXISTS idx_retrieval_projection_sources_response
  ON retrieval_projection_sources(response_id, is_deleted);

CREATE TABLE IF NOT EXISTS retrieval_projection_chunks (
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_ref TEXT NOT NULL,
  projection_version TEXT NOT NULL,
  loom_id TEXT,
  response_id TEXT,
  content_digest TEXT NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  source_updated_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  metadata_json TEXT,
  PRIMARY KEY (source_kind, source_id, chunk_ref, projection_version),
  FOREIGN KEY (source_kind, source_id, projection_version)
    REFERENCES retrieval_projection_sources(source_kind, source_id, projection_version)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_retrieval_projection_chunks_active
  ON retrieval_projection_chunks(is_deleted, source_kind, loom_id, source_updated_at);

CREATE INDEX IF NOT EXISTS idx_retrieval_projection_chunks_response
  ON retrieval_projection_chunks(response_id, is_deleted);
