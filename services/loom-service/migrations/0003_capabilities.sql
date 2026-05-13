-- Capability and execution strategy foundation.
-- Raw model thinking/internal monologue must never be stored in capability records.
-- Store only safe system, model, timing, success/failure, and strategy metadata.

CREATE TABLE system_resource_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    os_name TEXT NOT NULL,
    os_version TEXT,
    arch TEXT,
    cpu_brand TEXT,
    physical_cores INTEGER,
    logical_cores INTEGER,
    total_memory_bytes INTEGER,
    available_memory_bytes INTEGER,
    gpu_info_json TEXT,
    detected_at TEXT NOT NULL
);

CREATE TABLE model_catalog (
    model_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    model_family TEXT,
    parameter_count_b REAL,
    quantization TEXT,
    supports_thinking INTEGER NOT NULL DEFAULT 0,
    supports_tools INTEGER NOT NULL DEFAULT 0,
    recommended_min_memory_bytes INTEGER,
    recommended_memory_bytes INTEGER,
    max_context_tokens INTEGER,
    source TEXT NOT NULL DEFAULT 'curated_seed',
    confidence TEXT NOT NULL DEFAULT 'low',
    details_json TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE model_runtime_benchmarks (
    benchmark_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    prompt_kind TEXT NOT NULL,
    num_ctx INTEGER,
    num_predict INTEGER,
    parallelism INTEGER NOT NULL DEFAULT 1,
    first_token_latency_ms INTEGER,
    total_latency_ms INTEGER,
    eval_count INTEGER,
    eval_duration_ms INTEGER,
    tokens_per_second REAL,
    success INTEGER NOT NULL,
    error_kind TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE execution_strategy_decisions (
    decision_id TEXT PRIMARY KEY,
    snapshot_id TEXT,
    model_id TEXT,
    requested_mode TEXT,
    prompt_kind TEXT,
    context_size_tokens INTEGER,
    strategy TEXT NOT NULL,
    max_output_tokens INTEGER NOT NULL,
    max_parallelism INTEGER NOT NULL,
    allow_deep_synthesis INTEGER NOT NULL,
    allow_parallel_drafts INTEGER NOT NULL,
    reason_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_system_resource_snapshots_detected_at
    ON system_resource_snapshots(detected_at);

CREATE INDEX idx_model_catalog_provider_model_name
    ON model_catalog(provider, model_name);

CREATE INDEX idx_model_runtime_benchmarks_model_created_at
    ON model_runtime_benchmarks(model_id, created_at);

CREATE INDEX idx_execution_strategy_decisions_model_created_at
    ON execution_strategy_decisions(model_id, created_at);
