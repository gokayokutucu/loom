-- Community-maintained capability baseline catalog.
-- These entries are maintainer-reviewed hints only; local benchmarks remain authoritative.
-- Raw thinking, private prompts, and personal data must never be stored here.

CREATE TABLE community_model_benchmarks (
    entry_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    confidence TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    loom_service_version TEXT,
    ollama_version TEXT,
    system_json TEXT NOT NULL,
    model_json TEXT NOT NULL,
    benchmark_json TEXT NOT NULL,
    notes TEXT,
    provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    os_name TEXT NOT NULL,
    arch TEXT NOT NULL,
    prompt_kind TEXT NOT NULL,
    strategy TEXT NOT NULL,
    parallelism INTEGER NOT NULL,
    success INTEGER NOT NULL,
    imported_at TEXT NOT NULL
);

CREATE INDEX idx_community_model_benchmarks_model_json
    ON community_model_benchmarks(model_json);

CREATE INDEX idx_community_model_benchmarks_submitted_at
    ON community_model_benchmarks(submitted_at);

CREATE INDEX idx_community_model_benchmarks_confidence
    ON community_model_benchmarks(confidence);

CREATE INDEX idx_community_model_benchmarks_model_prompt
    ON community_model_benchmarks(provider, model_name, prompt_kind, success);

CREATE INDEX idx_community_model_benchmarks_system_match
    ON community_model_benchmarks(provider, model_name, os_name, arch, confidence);
