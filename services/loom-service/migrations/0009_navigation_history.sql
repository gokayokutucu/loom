CREATE TABLE IF NOT EXISTS navigation_history (
    history_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    path TEXT NOT NULL,
    object_type TEXT NOT NULL,
    badge TEXT,
    target_object_id TEXT,
    canonical_uri TEXT,
    reference_code TEXT,
    navigation_destination_json TEXT,
    metadata_json TEXT,
    visited_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_navigation_history_visited_at
    ON navigation_history(visited_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_navigation_history_path
    ON navigation_history(path);
