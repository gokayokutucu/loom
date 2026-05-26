CREATE TABLE IF NOT EXISTS memories (
    memory_id TEXT PRIMARY KEY,
    memory_type TEXT NOT NULL CHECK (
        memory_type IN (
            'explicit_user_memory',
            'profile_preference',
            'inferred_preference',
            'system_note'
        )
    ),
    content TEXT NOT NULL,
    normalized_content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_loom_id TEXT NULL,
    source_response_id TEXT NULL,
    user_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (user_confirmed IN (0, 1)),
    deleted_at TEXT NULL,
    metadata_json TEXT NULL,
    FOREIGN KEY (source_loom_id) REFERENCES looms(loom_id),
    FOREIGN KEY (source_response_id) REFERENCES responses(response_id)
);

CREATE INDEX IF NOT EXISTS idx_memories_type_active
    ON memories(memory_type, deleted_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_memories_source_loom
    ON memories(source_loom_id);

CREATE INDEX IF NOT EXISTS idx_memories_source_response
    ON memories(source_response_id);

CREATE TABLE IF NOT EXISTS memory_events (
    event_id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory_created
    ON memory_events(memory_id, created_at);
