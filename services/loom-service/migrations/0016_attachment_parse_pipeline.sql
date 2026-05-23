-- Attachment parse pipeline, compressed parsed text metadata, and context chunks.
--
-- Raw blobs remain in attachment_blobs. Parsed full text is stored separately
-- in attachment_parsed_content, optionally in compressed_text when a reversible
-- compression strategy is smaller than plain text. Context assembly should use
-- attachment_parsed_chunks for bounded explicit references.

PRAGMA foreign_keys = ON;

ALTER TABLE attachment_parsed_content
  ADD COLUMN compressed_text BLOB;

ALTER TABLE attachment_parsed_content
  ADD COLUMN compression_kind TEXT NOT NULL DEFAULT 'none';

ALTER TABLE attachment_parsed_content
  ADD COLUMN original_byte_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE attachment_parsed_content
  ADD COLUMN stored_byte_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS attachment_parse_jobs (
  job_id TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL,
  status TEXT NOT NULL,
  parser TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (attachment_id) REFERENCES attachments(attachment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachment_parse_jobs_attachment
  ON attachment_parse_jobs(attachment_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachment_parse_jobs_status
  ON attachment_parse_jobs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS attachment_parsed_chunks (
  chunk_id TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL,
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
  FOREIGN KEY (attachment_id) REFERENCES attachments(attachment_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_parsed_chunks_unique
  ON attachment_parsed_chunks(attachment_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_attachment_parsed_chunks_attachment
  ON attachment_parsed_chunks(attachment_id, chunk_index);

CREATE TABLE IF NOT EXISTS attachment_summaries (
  attachment_id TEXT PRIMARY KEY,
  summary_text TEXT NOT NULL,
  summary_kind TEXT NOT NULL,
  parser TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (attachment_id) REFERENCES attachments(attachment_id) ON DELETE CASCADE
);
