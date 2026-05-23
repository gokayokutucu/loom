-- Loom/Weft tombstone support.
--
-- Permanent delete keeps a small tombstone so existing Loom addresses can
-- resolve to a deleted/broken state instead of silently pointing at active data.

ALTER TABLE looms ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE looms ADD COLUMN deleted_at TEXT;
ALTER TABLE looms ADD COLUMN deleted_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_looms_active
  ON looms(is_deleted, archived_at, created_at);

CREATE INDEX IF NOT EXISTS idx_looms_origin_active
  ON looms(origin_loom_id, origin_response_id, is_deleted, archived_at, created_at);
