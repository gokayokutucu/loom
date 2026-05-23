CREATE TABLE IF NOT EXISTS runtime_model_assets (
    asset_id TEXT PRIMARY KEY,
    provider_kind TEXT NOT NULL,
    provider_profile_id TEXT,
    model_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('available', 'missing', 'installing', 'error')),
    local_path TEXT,
    size_bytes INTEGER,
    digest TEXT,
    capability_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    installed_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(provider_kind, provider_profile_id, model_name)
);

CREATE TABLE IF NOT EXISTS runtime_model_download_jobs (
    job_id TEXT PRIMARY KEY,
    provider_kind TEXT NOT NULL,
    provider_profile_id TEXT,
    model_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'downloading', 'verifying', 'installed', 'failed', 'cancelled')),
    progress_percent REAL NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER,
    total_bytes INTEGER,
    digest TEXT,
    error TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS runtime_model_download_events (
    event_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES runtime_model_download_jobs(job_id)
);

CREATE INDEX IF NOT EXISTS idx_runtime_model_assets_provider
    ON runtime_model_assets(provider_kind, provider_profile_id, status);

CREATE INDEX IF NOT EXISTS idx_runtime_model_download_jobs_model
    ON runtime_model_download_jobs(provider_kind, provider_profile_id, model_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_model_download_events_job
    ON runtime_model_download_events(job_id, created_at);
