#![allow(dead_code)]

use crate::{
    capabilities::{
        community::{
            CommunityBenchmarkCatalog, CommunityBenchmarkEntry, CommunityBenchmarkRecord,
            CommunityImportSummary,
        },
        models::ModelCatalogEntry,
        resources::SystemResourceSnapshot,
        strategy::ExecutionStrategyDecision,
    },
    error::ServiceError,
    providers::config::ProviderKind,
    storage::db::Database,
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const FORBIDDEN_THINKING_KEYS: [&str; 7] = [
    "api_key",
    "bearer_token",
    "password",
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRuntimeBenchmarkRecord {
    pub benchmark_id: String,
    pub model_id: String,
    pub provider: String,
    pub model_name: String,
    pub prompt_kind: String,
    pub num_ctx: Option<i64>,
    pub num_predict: Option<i64>,
    pub parallelism: i64,
    pub first_token_latency_ms: Option<i64>,
    pub total_latency_ms: Option<i64>,
    pub eval_count: Option<i64>,
    pub eval_duration_ms: Option<i64>,
    pub tokens_per_second: Option<f64>,
    pub success: bool,
    pub error_kind: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewModelRuntimeBenchmark {
    pub benchmark_id: String,
    pub model_id: String,
    pub provider: String,
    pub model_name: String,
    pub prompt_kind: String,
    pub num_ctx: Option<i64>,
    pub num_predict: Option<i64>,
    pub parallelism: i64,
    pub first_token_latency_ms: Option<i64>,
    pub total_latency_ms: Option<i64>,
    pub eval_count: Option<i64>,
    pub eval_duration_ms: Option<i64>,
    pub tokens_per_second: Option<f64>,
    pub success: bool,
    pub error_kind: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewProviderDiscoveredModel {
    pub provider_kind: ProviderKind,
    pub provider_profile_id: String,
    pub provider: String,
    pub model_name: String,
    pub model_family: Option<String>,
    pub max_context_tokens: Option<i64>,
    pub details_json: Option<String>,
    pub discovered_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDiscoveredModelUpsert {
    pub model_id: String,
    pub model_name: String,
    pub persisted: bool,
    pub created: bool,
    pub skipped_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CapabilityRepository {
    pool: SqlitePool,
}

impl CapabilityRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_system_snapshot(
        &self,
        snapshot: &SystemResourceSnapshot,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(snapshot.gpu_info_json.as_deref())?;
        sqlx::query(
            "INSERT INTO system_resource_snapshots (
                snapshot_id, os_name, os_version, arch, cpu_brand, physical_cores,
                logical_cores, total_memory_bytes, available_memory_bytes, gpu_info_json, detected_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind(&snapshot.snapshot_id)
        .bind(&snapshot.os_name)
        .bind(&snapshot.os_version)
        .bind(&snapshot.arch)
        .bind(&snapshot.cpu_brand)
        .bind(snapshot.physical_cores)
        .bind(snapshot.logical_cores)
        .bind(snapshot.total_memory_bytes)
        .bind(snapshot.available_memory_bytes)
        .bind(&snapshot.gpu_info_json)
        .bind(&snapshot.detected_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert system resource snapshot: {error}"))
        })?;

        Ok(())
    }

    pub async fn latest_system_snapshot(
        &self,
    ) -> Result<Option<SystemResourceSnapshot>, ServiceError> {
        sqlx::query(
            "SELECT * FROM system_resource_snapshots
             ORDER BY detected_at DESC
             LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(system_snapshot_from_row))
        .map_err(|error| {
            ServiceError::storage(format!("failed to get system resource snapshot: {error}"))
        })
    }

    pub async fn seed_model_catalog(
        &self,
        entries: &[ModelCatalogEntry],
    ) -> Result<(), ServiceError> {
        for entry in entries {
            self.upsert_model_catalog_entry(entry).await?;
        }
        Ok(())
    }

    pub async fn upsert_model_catalog_entry(
        &self,
        entry: &ModelCatalogEntry,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(entry.notes.as_deref())?;
        sqlx::query(
            "INSERT INTO model_catalog (
                model_id, provider, model_name, model_family, parameter_count_b,
                quantization, supports_thinking, supports_tools,
                recommended_min_memory_bytes, recommended_memory_bytes,
                max_context_tokens, source, confidence, details_json, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(model_id) DO UPDATE SET
                provider = excluded.provider,
                model_name = excluded.model_name,
                model_family = excluded.model_family,
                parameter_count_b = excluded.parameter_count_b,
                quantization = excluded.quantization,
                supports_thinking = excluded.supports_thinking,
                supports_tools = excluded.supports_tools,
                recommended_min_memory_bytes = excluded.recommended_min_memory_bytes,
                recommended_memory_bytes = excluded.recommended_memory_bytes,
                max_context_tokens = excluded.max_context_tokens,
                source = excluded.source,
                confidence = excluded.confidence,
                details_json = excluded.details_json,
                notes = excluded.notes,
                updated_at = excluded.updated_at",
        )
        .bind(&entry.model_id)
        .bind(&entry.provider)
        .bind(&entry.model_name)
        .bind(&entry.model_family)
        .bind(entry.parameter_count_b)
        .bind(&entry.quantization)
        .bind(if entry.supports_thinking { 1 } else { 0 })
        .bind(if entry.supports_tools { 1 } else { 0 })
        .bind(entry.recommended_min_memory_bytes)
        .bind(entry.recommended_memory_bytes)
        .bind(entry.max_context_tokens)
        .bind(&entry.source)
        .bind(&entry.confidence)
        .bind(&entry.details_json)
        .bind(&entry.notes)
        .bind(&entry.created_at)
        .bind(&entry.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to upsert model catalog entry: {error}"))
        })?;

        Ok(())
    }

    pub async fn list_model_catalog(&self) -> Result<Vec<ModelCatalogEntry>, ServiceError> {
        sqlx::query(
            "SELECT * FROM model_catalog
             ORDER BY provider ASC, model_name ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(model_catalog_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list model catalog: {error}")))
    }

    pub async fn find_model(
        &self,
        model_id: Option<&str>,
        provider: Option<&str>,
        model_name: Option<&str>,
    ) -> Result<Option<ModelCatalogEntry>, ServiceError> {
        if let Some(model_id) = model_id {
            return sqlx::query("SELECT * FROM model_catalog WHERE model_id = ?1 LIMIT 1")
                .bind(model_id)
                .fetch_optional(&self.pool)
                .await
                .map(|row| row.map(model_catalog_from_row))
                .map_err(|error| ServiceError::storage(format!("failed to find model: {error}")));
        }

        let Some(provider) = provider else {
            return Ok(None);
        };
        let Some(model_name) = model_name else {
            return Ok(None);
        };

        sqlx::query(
            "SELECT * FROM model_catalog
             WHERE provider = ?1 AND model_name = ?2
             LIMIT 1",
        )
        .bind(provider)
        .bind(model_name)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(model_catalog_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to find model: {error}")))
    }

    pub async fn upsert_provider_discovered_model(
        &self,
        input: &NewProviderDiscoveredModel,
    ) -> Result<ProviderDiscoveredModelUpsert, ServiceError> {
        reject_forbidden_payload(Some(&input.provider_profile_id))?;
        reject_forbidden_payload(Some(&input.model_name))?;
        reject_forbidden_payload(input.details_json.as_deref())?;

        let stronger = sqlx::query(
            "SELECT model_id, source FROM model_catalog
             WHERE provider = ?1 AND model_name = ?2 AND source != 'provider_discovery'
             LIMIT 1",
        )
        .bind(&input.provider)
        .bind(&input.model_name)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect model catalog source: {error}"))
        })?;
        if let Some(row) = stronger {
            let source: String = row.get("source");
            return Ok(ProviderDiscoveredModelUpsert {
                model_id: row.get("model_id"),
                model_name: input.model_name.clone(),
                persisted: false,
                created: false,
                skipped_reason: Some(format!("stronger_catalog_source_exists:{source}")),
            });
        }

        let model_id = provider_discovery_model_id(
            &input.provider_kind,
            &input.provider_profile_id,
            &input.model_name,
        );
        let existed =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM model_catalog WHERE model_id = ?1")
                .bind(&model_id)
                .fetch_one(&self.pool)
                .await
                .map_err(|error| {
                    ServiceError::storage(format!(
                        "failed to inspect provider discovery model: {error}"
                    ))
                })?
                > 0;

        let details = provider_discovery_details_json(input)?;
        let entry = ModelCatalogEntry {
            model_id: model_id.clone(),
            provider: input.provider.clone(),
            model_name: input.model_name.clone(),
            model_family: input.model_family.clone(),
            parameter_count_b: None,
            quantization: None,
            supports_thinking: false,
            supports_tools: false,
            recommended_min_memory_bytes: None,
            recommended_memory_bytes: None,
            max_context_tokens: input.max_context_tokens,
            source: "provider_discovery".to_string(),
            confidence: "low".to_string(),
            details_json: Some(details),
            notes: Some("Provider-discovered availability hint; not a benchmark or hardware capability signal.".to_string()),
            created_at: input.discovered_at.clone(),
            updated_at: input.discovered_at.clone(),
        };
        self.upsert_model_catalog_entry(&entry).await?;
        Ok(ProviderDiscoveredModelUpsert {
            model_id,
            model_name: input.model_name.clone(),
            persisted: true,
            created: !existed,
            skipped_reason: None,
        })
    }

    pub async fn list_by_provider_profile(
        &self,
        provider_profile_id: &str,
    ) -> Result<Vec<ModelCatalogEntry>, ServiceError> {
        let entries = sqlx::query(
            "SELECT * FROM model_catalog
             WHERE source = 'provider_discovery'
             ORDER BY provider ASC, model_name ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to list provider discovery models: {error}"))
        })?
        .into_iter()
        .map(model_catalog_from_row)
        .filter(|entry| {
            entry
                .details_json
                .as_deref()
                .and_then(|details| serde_json::from_str::<serde_json::Value>(details).ok())
                .and_then(|details| {
                    details
                        .get("providerProfileId")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                })
                .is_some_and(|value| value == provider_profile_id)
        })
        .collect();
        Ok(entries)
    }

    pub async fn insert_benchmark(
        &self,
        benchmark: &NewModelRuntimeBenchmark,
    ) -> Result<(), ServiceError> {
        reject_forbidden_payload(benchmark.error_kind.as_deref())?;
        sqlx::query(
            "INSERT INTO model_runtime_benchmarks (
                benchmark_id, model_id, provider, model_name, prompt_kind, num_ctx,
                num_predict, parallelism, first_token_latency_ms, total_latency_ms,
                eval_count, eval_duration_ms, tokens_per_second, success, error_kind, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        )
        .bind(&benchmark.benchmark_id)
        .bind(&benchmark.model_id)
        .bind(&benchmark.provider)
        .bind(&benchmark.model_name)
        .bind(&benchmark.prompt_kind)
        .bind(benchmark.num_ctx)
        .bind(benchmark.num_predict)
        .bind(benchmark.parallelism)
        .bind(benchmark.first_token_latency_ms)
        .bind(benchmark.total_latency_ms)
        .bind(benchmark.eval_count)
        .bind(benchmark.eval_duration_ms)
        .bind(benchmark.tokens_per_second)
        .bind(if benchmark.success { 1 } else { 0 })
        .bind(&benchmark.error_kind)
        .bind(&benchmark.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to insert benchmark: {error}")))?;

        Ok(())
    }

    pub async fn list_benchmarks(&self) -> Result<Vec<ModelRuntimeBenchmarkRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM model_runtime_benchmarks
             ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(benchmark_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list benchmarks: {error}")))
    }

    pub async fn latest_successful_benchmark_for_model(
        &self,
        model_id: &str,
    ) -> Result<Option<ModelRuntimeBenchmarkRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM model_runtime_benchmarks
             WHERE model_id = ?1 AND success = 1
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(model_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(benchmark_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to get latest benchmark: {error}")))
    }

    pub async fn latest_benchmark_for_model(
        &self,
        model_id: &str,
    ) -> Result<Option<ModelRuntimeBenchmarkRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM model_runtime_benchmarks
             WHERE model_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(model_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(benchmark_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to get latest benchmark: {error}")))
    }

    pub async fn insert_strategy_decision(
        &self,
        decision: &ExecutionStrategyDecision,
    ) -> Result<(), ServiceError> {
        let reason_json = serde_json::to_string(&serde_json::json!({
            "reason": decision.reason,
            "warnings": decision.warnings,
        }))
        .map_err(|error| {
            ServiceError::storage(format!("failed to serialize strategy reason: {error}"))
        })?;
        reject_forbidden_payload(Some(&reason_json))?;

        sqlx::query(
            "INSERT INTO execution_strategy_decisions (
                decision_id, snapshot_id, model_id, requested_mode, prompt_kind,
                context_size_tokens, strategy, max_output_tokens, max_parallelism,
                allow_deep_synthesis, allow_parallel_drafts, reason_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )
        .bind(&decision.decision_id)
        .bind(&decision.snapshot_id)
        .bind(&decision.model_id)
        .bind(&decision.requested_mode)
        .bind(&decision.prompt_kind)
        .bind(decision.context_size_tokens)
        .bind(decision.strategy.as_str())
        .bind(decision.max_output_tokens)
        .bind(decision.max_parallelism)
        .bind(if decision.allow_deep_synthesis { 1 } else { 0 })
        .bind(if decision.allow_parallel_drafts { 1 } else { 0 })
        .bind(&reason_json)
        .bind(&decision.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert strategy decision: {error}"))
        })?;

        Ok(())
    }

    pub async fn import_community_catalog(
        &self,
        catalog: &CommunityBenchmarkCatalog,
    ) -> Result<CommunityImportSummary, ServiceError> {
        let mut summary = CommunityImportSummary::default();
        for entry in &catalog.entries {
            match self.upsert_community_benchmark(entry).await {
                Ok(true) => summary.imported += 1,
                Ok(false) => summary.skipped += 1,
                Err(error) => {
                    summary.rejected += 1;
                    summary.errors.push(format!("{}: {error}", entry.entry_id));
                }
            }
        }
        Ok(summary)
    }

    pub async fn upsert_community_benchmark(
        &self,
        entry: &CommunityBenchmarkEntry,
    ) -> Result<bool, ServiceError> {
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM community_model_benchmarks WHERE entry_id = ?1",
        )
        .bind(&entry.entry_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to inspect community benchmark: {error}"))
        })? > 0;

        let system_json = serde_json::to_string(&entry.system).map_err(|error| {
            ServiceError::storage(format!(
                "failed to serialize community system data: {error}"
            ))
        })?;
        let model_json = serde_json::to_string(&entry.model).map_err(|error| {
            ServiceError::storage(format!("failed to serialize community model data: {error}"))
        })?;
        let benchmark_json = serde_json::to_string(&entry.benchmark).map_err(|error| {
            ServiceError::storage(format!(
                "failed to serialize community benchmark data: {error}"
            ))
        })?;
        reject_forbidden_payload(Some(&system_json))?;
        reject_forbidden_payload(Some(&model_json))?;
        reject_forbidden_payload(Some(&benchmark_json))?;
        reject_forbidden_payload(entry.notes.as_deref())?;

        sqlx::query(
            "INSERT INTO community_model_benchmarks (
                entry_id, source, confidence, submitted_at, loom_service_version,
                ollama_version, system_json, model_json, benchmark_json, notes,
                provider, model_name, os_name, arch, prompt_kind, strategy,
                parallelism, success, imported_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
             ON CONFLICT(entry_id) DO UPDATE SET
                source = excluded.source,
                confidence = excluded.confidence,
                submitted_at = excluded.submitted_at,
                loom_service_version = excluded.loom_service_version,
                ollama_version = excluded.ollama_version,
                system_json = excluded.system_json,
                model_json = excluded.model_json,
                benchmark_json = excluded.benchmark_json,
                notes = excluded.notes,
                provider = excluded.provider,
                model_name = excluded.model_name,
                os_name = excluded.os_name,
                arch = excluded.arch,
                prompt_kind = excluded.prompt_kind,
                strategy = excluded.strategy,
                parallelism = excluded.parallelism,
                success = excluded.success,
                imported_at = excluded.imported_at",
        )
        .bind(&entry.entry_id)
        .bind(&entry.source)
        .bind(&entry.confidence)
        .bind(&entry.submitted_at)
        .bind(&entry.loom_service_version)
        .bind(&entry.ollama_version)
        .bind(&system_json)
        .bind(&model_json)
        .bind(&benchmark_json)
        .bind(&entry.notes)
        .bind(&entry.model.provider)
        .bind(&entry.model.model_name)
        .bind(&entry.system.os_name)
        .bind(&entry.system.arch)
        .bind(&entry.benchmark.prompt_kind)
        .bind(&entry.benchmark.strategy)
        .bind(entry.benchmark.parallelism)
        .bind(if entry.benchmark.success { 1 } else { 0 })
        .bind(timestamp())
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to upsert community benchmark: {error}"))
        })?;

        Ok(!exists)
    }

    pub async fn list_community_benchmarks(
        &self,
    ) -> Result<Vec<CommunityBenchmarkRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM community_model_benchmarks
             ORDER BY submitted_at DESC, entry_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(community_benchmark_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list community benchmarks: {error}"))
        })
    }

    pub async fn best_community_baseline(
        &self,
        provider: &str,
        model_name: &str,
        os_name: Option<&str>,
        arch: Option<&str>,
        prompt_kind: &str,
    ) -> Result<Option<CommunityBenchmarkRecord>, ServiceError> {
        let rows = sqlx::query(
            "SELECT * FROM community_model_benchmarks
             WHERE provider = ?1 AND model_name = ?2 AND prompt_kind = ?3 AND success = 1
             ORDER BY
                CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
                submitted_at DESC",
        )
        .bind(provider)
        .bind(model_name)
        .bind(prompt_kind)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to query community baseline: {error}"))
        })?;

        let mut records: Vec<CommunityBenchmarkRecord> =
            rows.into_iter().map(community_benchmark_from_row).collect();
        records.sort_by_key(|record| {
            (
                if os_name.is_some_and(|value| value == record.os_name) {
                    0
                } else {
                    1
                },
                if arch.is_some_and(|value| value == record.arch) {
                    0
                } else {
                    1
                },
                -confidence_rank(&record.confidence),
                std::cmp::Reverse(record.submitted_at.clone()),
            )
        });
        Ok(records.into_iter().next())
    }

    pub async fn community_baselines(
        &self,
        provider: &str,
        model_name: &str,
        prompt_kind: &str,
    ) -> Result<Vec<CommunityBenchmarkRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM community_model_benchmarks
             WHERE provider = ?1 AND model_name = ?2 AND prompt_kind = ?3
             ORDER BY
                CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
                submitted_at DESC,
                entry_id ASC",
        )
        .bind(provider)
        .bind(model_name)
        .bind(prompt_kind)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(community_benchmark_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to query community baselines: {error}"))
        })
    }
}

pub fn timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{millis}")
}

pub fn new_id(prefix: &str) -> String {
    let sequence = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{sequence}", timestamp())
}

fn system_snapshot_from_row(row: sqlx::sqlite::SqliteRow) -> SystemResourceSnapshot {
    SystemResourceSnapshot {
        snapshot_id: row.get("snapshot_id"),
        os_name: row.get("os_name"),
        os_version: row.get("os_version"),
        arch: row.get("arch"),
        cpu_brand: row.get("cpu_brand"),
        physical_cores: row.get("physical_cores"),
        logical_cores: row.get("logical_cores"),
        total_memory_bytes: row.get("total_memory_bytes"),
        available_memory_bytes: row.get("available_memory_bytes"),
        gpu_info_json: row.get("gpu_info_json"),
        detected_at: row.get("detected_at"),
    }
}

fn model_catalog_from_row(row: sqlx::sqlite::SqliteRow) -> ModelCatalogEntry {
    ModelCatalogEntry {
        model_id: row.get("model_id"),
        provider: row.get("provider"),
        model_name: row.get("model_name"),
        model_family: row.get("model_family"),
        parameter_count_b: row.get("parameter_count_b"),
        quantization: row.get("quantization"),
        supports_thinking: row.get::<i64, _>("supports_thinking") == 1,
        supports_tools: row.get::<i64, _>("supports_tools") == 1,
        recommended_min_memory_bytes: row.get("recommended_min_memory_bytes"),
        recommended_memory_bytes: row.get("recommended_memory_bytes"),
        max_context_tokens: row.get("max_context_tokens"),
        source: row.get("source"),
        confidence: row.get("confidence"),
        details_json: row.get("details_json"),
        notes: row.get("notes"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn benchmark_from_row(row: sqlx::sqlite::SqliteRow) -> ModelRuntimeBenchmarkRecord {
    ModelRuntimeBenchmarkRecord {
        benchmark_id: row.get("benchmark_id"),
        model_id: row.get("model_id"),
        provider: row.get("provider"),
        model_name: row.get("model_name"),
        prompt_kind: row.get("prompt_kind"),
        num_ctx: row.get("num_ctx"),
        num_predict: row.get("num_predict"),
        parallelism: row.get("parallelism"),
        first_token_latency_ms: row.get("first_token_latency_ms"),
        total_latency_ms: row.get("total_latency_ms"),
        eval_count: row.get("eval_count"),
        eval_duration_ms: row.get("eval_duration_ms"),
        tokens_per_second: row.get("tokens_per_second"),
        success: row.get::<i64, _>("success") == 1,
        error_kind: row.get("error_kind"),
        created_at: row.get("created_at"),
    }
}

fn community_benchmark_from_row(row: sqlx::sqlite::SqliteRow) -> CommunityBenchmarkRecord {
    CommunityBenchmarkRecord {
        entry_id: row.get("entry_id"),
        source: row.get("source"),
        confidence: row.get("confidence"),
        submitted_at: row.get("submitted_at"),
        loom_service_version: row.get("loom_service_version"),
        ollama_version: row.get("ollama_version"),
        system_json: row.get("system_json"),
        model_json: row.get("model_json"),
        benchmark_json: row.get("benchmark_json"),
        notes: row.get("notes"),
        provider: row.get("provider"),
        model_name: row.get("model_name"),
        os_name: row.get("os_name"),
        arch: row.get("arch"),
        prompt_kind: row.get("prompt_kind"),
        strategy: row.get("strategy"),
        parallelism: row.get("parallelism"),
        success: row.get::<i64, _>("success") == 1,
        imported_at: row.get("imported_at"),
    }
}

fn confidence_rank(value: &str) -> i64 {
    match value {
        "high" => 3,
        "medium" => 2,
        _ => 1,
    }
}

fn reject_forbidden_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    let lower = payload.to_ascii_lowercase();
    if FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| lower.contains(key))
    {
        return Err(ServiceError::storage(
            "capability payload contains forbidden raw thinking metadata",
        ));
    }
    Ok(())
}

pub fn provider_discovery_model_id(
    provider_kind: &ProviderKind,
    provider_profile_id: &str,
    model_name: &str,
) -> String {
    format!(
        "provider_discovery:{}:{}:{}",
        provider_kind.as_config_str(),
        safe_catalog_id_part(provider_profile_id),
        safe_catalog_id_part(model_name)
    )
}

fn provider_discovery_details_json(
    input: &NewProviderDiscoveredModel,
) -> Result<String, ServiceError> {
    let mut details = serde_json::json!({
        "providerKind": input.provider_kind.as_config_str(),
        "providerProfileId": input.provider_profile_id,
        "source": "provider_discovery",
        "discoveredAt": input.discovered_at,
        "available": true,
        "stale": false,
    });
    if let Some(extra) = &input.details_json {
        let extra = serde_json::from_str::<serde_json::Value>(extra).map_err(|error| {
            ServiceError::storage(format!(
                "provider discovery details_json is invalid: {error}"
            ))
        })?;
        reject_forbidden_payload(Some(&extra.to_string()))?;
        details["providerMetadata"] = extra;
    }
    let serialized = serde_json::to_string(&details).map_err(|error| {
        ServiceError::storage(format!(
            "failed to serialize provider discovery details: {error}"
        ))
    })?;
    reject_forbidden_payload(Some(&serialized))?;
    Ok(serialized)
}

fn safe_catalog_id_part(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        capabilities::{
            community::parse_catalog,
            default_model_catalog_entries,
            resources::SystemResourceSnapshot,
            strategy::{
                resolve_execution_strategy, resolve_execution_strategy_with_community, PromptKind,
                RequestedMode, ResolveExecutionStrategyInput,
            },
        },
        storage::db::test_database,
    };

    fn fake_snapshot() -> SystemResourceSnapshot {
        SystemResourceSnapshot {
            snapshot_id: "sys-test".to_string(),
            os_name: "macos".to_string(),
            os_version: Some("15.0".to_string()),
            arch: Some("aarch64".to_string()),
            cpu_brand: Some("Apple".to_string()),
            physical_cores: Some(12),
            logical_cores: Some(12),
            total_memory_bytes: Some(64 * 1024 * 1024 * 1024),
            available_memory_bytes: Some(48 * 1024 * 1024 * 1024),
            gpu_info_json: None,
            detected_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[tokio::test]
    async fn system_snapshot_can_be_created_with_fake_detector_data() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        repo.insert_system_snapshot(&fake_snapshot()).await.unwrap();

        let latest = repo.latest_system_snapshot().await.unwrap().unwrap();
        assert_eq!(latest.snapshot_id, "sys-test");
        assert_eq!(latest.os_name, "macos");
    }

    #[tokio::test]
    async fn model_catalog_seed_inserts_qwen() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        repo.seed_model_catalog(&default_model_catalog_entries())
            .await
            .unwrap();

        let models = repo.list_model_catalog().await.unwrap();
        assert!(models.iter().any(|model| model.model_name == "qwen3.5:9b"));
    }

    #[tokio::test]
    async fn benchmark_record_can_be_inserted_and_read() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        let benchmark = NewModelRuntimeBenchmark {
            benchmark_id: "bench-test".to_string(),
            model_id: "ollama:qwen3.5:9b".to_string(),
            provider: "ollama".to_string(),
            model_name: "qwen3.5:9b".to_string(),
            prompt_kind: "factual".to_string(),
            num_ctx: Some(512),
            num_predict: Some(8),
            parallelism: 1,
            first_token_latency_ms: Some(1200),
            total_latency_ms: Some(1500),
            eval_count: Some(8),
            eval_duration_ms: Some(300),
            tokens_per_second: Some(30.0),
            success: true,
            error_kind: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };
        repo.insert_benchmark(&benchmark).await.unwrap();

        let records = repo.list_benchmarks().await.unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].tokens_per_second, Some(30.0));
        assert_eq!(records[0].eval_count, Some(8));
    }

    #[tokio::test]
    async fn strategy_decision_is_persisted() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        let snapshot = fake_snapshot();
        let model = default_model_catalog_entries()
            .into_iter()
            .find(|entry| entry.model_name == "qwen3.5:9b")
            .unwrap();
        let input = ResolveExecutionStrategyInput {
            model_id: Some(model.model_id.clone()),
            provider: Some(model.provider.clone()),
            model_name: Some(model.model_name.clone()),
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Document,
            context_size_tokens: 12000,
            reference_count: 5,
            user_requested_parallelism: Some(3),
        };
        let decision = resolve_execution_strategy(&input, Some(&snapshot), Some(&model), None);
        repo.insert_strategy_decision(&decision).await.unwrap();

        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM execution_strategy_decisions WHERE decision_id = ?1",
        )
        .bind(&decision.decision_id)
        .fetch_one(database.pool())
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn raw_thinking_keys_are_rejected_from_capability_payloads() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        let benchmark = NewModelRuntimeBenchmark {
            benchmark_id: "bench-test".to_string(),
            model_id: "ollama:qwen3.5:9b".to_string(),
            provider: "ollama".to_string(),
            model_name: "qwen3.5:9b".to_string(),
            prompt_kind: "factual".to_string(),
            num_ctx: None,
            num_predict: None,
            parallelism: 1,
            first_token_latency_ms: None,
            total_latency_ms: None,
            eval_count: None,
            eval_duration_ms: None,
            tokens_per_second: None,
            success: false,
            error_kind: Some("raw_thinking".to_string()),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };

        assert!(repo.insert_benchmark(&benchmark).await.is_err());
    }

    #[tokio::test]
    async fn curated_seed_keeps_uncertain_model_facts_null() {
        let qwen = default_model_catalog_entries()
            .into_iter()
            .find(|entry| entry.model_name == "qwen3.5:9b")
            .unwrap();

        assert_eq!(qwen.source, "curated_seed");
        assert_eq!(qwen.confidence, "medium");
        assert_eq!(qwen.recommended_memory_bytes, None);
        assert_eq!(qwen.max_context_tokens, None);
        assert_eq!(qwen.details_json, None);
    }

    fn community_catalog(strategy: &str, confidence: &str) -> CommunityBenchmarkCatalog {
        parse_catalog(&format!(
            r#"{{
              "version": 1,
              "entries": [{{
                "entryId": "community-qwen",
                "source": "community_pr",
                "confidence": "{confidence}",
                "submittedAt": "2026-05-10T00:00:00Z",
                "loomServiceVersion": "0.1.0",
                "ollamaVersion": null,
                "system": {{
                  "osName": "macos",
                  "osVersion": null,
                  "arch": "aarch64",
                  "cpuBrand": null,
                  "physicalCores": null,
                  "logicalCores": null,
                  "totalMemoryBytes": null,
                  "gpuInfo": null
                }},
                "model": {{
                  "provider": "ollama",
                  "modelName": "qwen3.5:9b",
                  "modelFamily": "qwen",
                  "parameterCountB": 9,
                  "quantization": null,
                  "supportsThinking": true,
                  "details": null
                }},
                "benchmark": {{
                  "promptKind": "synthesis",
                  "strategy": "{strategy}",
                  "numCtx": 2048,
                  "numPredict": 512,
                  "parallelism": 2,
                  "firstTokenLatencyMs": 1000,
                  "totalLatencyMs": 12000,
                  "tokensPerSecond": 28,
                  "success": true,
                  "errorKind": null
                }},
                "notes": null
              }}]
            }}"#
        ))
        .unwrap()
    }

    #[tokio::test]
    async fn valid_community_catalog_imports_and_duplicate_skips() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        let catalog = community_catalog("sectioned_sequential", "high");

        let first = repo.import_community_catalog(&catalog).await.unwrap();
        let second = repo.import_community_catalog(&catalog).await.unwrap();

        assert_eq!(first.imported, 1);
        assert_eq!(second.skipped, 1);
        let records = repo.list_community_benchmarks().await.unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].entry_id, "community-qwen");
    }

    #[tokio::test]
    async fn community_baseline_is_used_only_when_local_benchmark_is_missing() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        let catalog = community_catalog("sectioned_sequential", "high");
        repo.import_community_catalog(&catalog).await.unwrap();
        let community = repo
            .best_community_baseline(
                "ollama",
                "qwen3.5:9b",
                Some("macos"),
                Some("aarch64"),
                "synthesis",
            )
            .await
            .unwrap()
            .unwrap();
        let model = default_model_catalog_entries()
            .into_iter()
            .find(|entry| entry.model_name == "qwen3.5:9b")
            .unwrap();
        let input = ResolveExecutionStrategyInput {
            model_id: Some(model.model_id.clone()),
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 8000,
            reference_count: 2,
            user_requested_parallelism: Some(2),
        };

        let without_local = resolve_execution_strategy_with_community(
            &input,
            Some(&SystemResourceSnapshot {
                total_memory_bytes: Some(16 * 1024 * 1024 * 1024),
                logical_cores: Some(6),
                ..fake_snapshot()
            }),
            Some(&model),
            None,
            Some(&community),
        );
        assert_eq!(
            without_local.strategy,
            crate::capabilities::strategy::ExecutionStrategy::SectionedSequential
        );
        assert!(without_local
            .reason
            .iter()
            .any(|reason| reason.contains("community_catalog")));

        let local_benchmark = ModelRuntimeBenchmarkRecord {
            benchmark_id: "bench-local".to_string(),
            model_id: model.model_id.clone(),
            provider: "ollama".to_string(),
            model_name: "qwen3.5:9b".to_string(),
            prompt_kind: "synthesis".to_string(),
            num_ctx: None,
            num_predict: None,
            parallelism: 1,
            first_token_latency_ms: None,
            total_latency_ms: None,
            eval_count: None,
            eval_duration_ms: None,
            tokens_per_second: Some(3.0),
            success: true,
            error_kind: None,
            created_at: "2026-05-10T00:00:00Z".to_string(),
        };
        let with_local = resolve_execution_strategy_with_community(
            &input,
            Some(&fake_snapshot()),
            Some(&model),
            Some(&local_benchmark),
            Some(&community),
        );
        assert!(with_local
            .reason
            .iter()
            .any(|reason| reason.contains("local_benchmark_available")));
        assert_eq!(with_local.max_parallelism, 1);
    }
}
