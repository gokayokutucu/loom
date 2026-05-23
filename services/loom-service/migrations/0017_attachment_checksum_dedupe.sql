-- Checksum-based attachment blob and parsed artifact deduplication.
--
-- Attachment rows remain Loom-scoped. Raw bytes and successful parser outputs
-- can be reused by checksum and parser version without making attachments
-- globally visible across Looms.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS attachment_blob_objects (
  blob_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE attachments
  ADD COLUMN blob_id TEXT;

ALTER TABLE attachments
  ADD COLUMN sha256 TEXT;

ALTER TABLE attachments
  ADD COLUMN parse_artifact_id TEXT;

CREATE INDEX IF NOT EXISTS idx_attachments_blob_id
  ON attachments(blob_id);

CREATE INDEX IF NOT EXISTS idx_attachments_sha256
  ON attachments(sha256);

CREATE INDEX IF NOT EXISTS idx_attachments_parse_artifact_id
  ON attachments(parse_artifact_id);

CREATE TABLE IF NOT EXISTS attachment_parse_artifacts (
  parse_artifact_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  parser_kind TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_kind TEXT NOT NULL,
  content_text TEXT NOT NULL,
  compressed_text BLOB,
  compression_kind TEXT NOT NULL DEFAULT 'none',
  char_count INTEGER NOT NULL,
  original_byte_count INTEGER NOT NULL DEFAULT 0,
  stored_byte_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (sha256, parser_kind, parser_version)
);

CREATE INDEX IF NOT EXISTS idx_attachment_parse_artifacts_sha_parser
  ON attachment_parse_artifacts(sha256, parser_kind, parser_version);

CREATE TABLE IF NOT EXISTS attachment_parse_artifact_chunks (
  chunk_id TEXT PRIMARY KEY,
  parse_artifact_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_text TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  token_estimate INTEGER NOT NULL,
  page_number INTEGER,
  sheet_name TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (parse_artifact_id) REFERENCES attachment_parse_artifacts(parse_artifact_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_parse_artifact_chunks_unique
  ON attachment_parse_artifact_chunks(parse_artifact_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_attachment_parse_artifact_chunks_artifact
  ON attachment_parse_artifact_chunks(parse_artifact_id, chunk_index);

CREATE TABLE IF NOT EXISTS attachment_parse_artifact_summaries (
  parse_artifact_id TEXT PRIMARY KEY,
  summary_text TEXT NOT NULL,
  summary_kind TEXT NOT NULL,
  parser TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parse_artifact_id) REFERENCES attachment_parse_artifacts(parse_artifact_id) ON DELETE RESTRICT
);
