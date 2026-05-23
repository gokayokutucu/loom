-- Loom-scoped attachment artifacts.
--
-- Privacy rule: raw model thinking/internal monologue must never be persisted.
-- Attachment blobs and parsed content are local user artifacts. Parsed content is
-- stored separately from raw file bytes and is only included in model context
-- when the user explicitly references the attachment.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS attachments (
  attachment_id TEXT PRIMARY KEY,
  loom_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  extension TEXT,
  size_bytes INTEGER NOT NULL,
  kind TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  parser TEXT,
  error TEXT,
  thumbnail_data_url TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachment_blobs (
  attachment_id TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (attachment_id) REFERENCES attachments(attachment_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachment_parsed_content (
  attachment_id TEXT PRIMARY KEY,
  content_text TEXT NOT NULL,
  content_kind TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  parser TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (attachment_id) REFERENCES attachments(attachment_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_loom
  ON attachments(loom_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_parse_status
  ON attachments(parse_status);
