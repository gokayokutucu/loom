-- SQLite FTS search projection.
--
-- Search documents are derived, rebuildable rows. They are not source of truth
-- and must not contain raw model thinking/internal monologue.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS search_documents (
  doc_id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  loom_id TEXT,
  response_id TEXT,
  attachment_id TEXT,
  parse_artifact_id TEXT,
  title TEXT,
  body TEXT NOT NULL,
  tags TEXT,
  source_rank REAL NOT NULL DEFAULT 1.0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_documents_source
  ON search_documents(source_kind, source_id);

CREATE INDEX IF NOT EXISTS idx_search_documents_loom_deleted
  ON search_documents(loom_id, is_deleted, source_rank);

CREATE INDEX IF NOT EXISTS idx_search_documents_response
  ON search_documents(response_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_search_documents_attachment
  ON search_documents(attachment_id, parse_artifact_id, is_deleted);

CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts
USING fts5(
  title,
  body,
  tags,
  content='search_documents',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS search_index_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
