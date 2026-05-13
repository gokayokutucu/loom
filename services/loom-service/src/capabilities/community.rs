use crate::error::ServiceError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{env, fs, path::PathBuf};

pub const FORBIDDEN_COMMUNITY_KEYS: [&str; 7] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "private_prompt",
    "user_prompt",
    "personal_data",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityBenchmarkCatalog {
    pub version: i64,
    pub entries: Vec<CommunityBenchmarkEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityBenchmarkEntry {
    pub entry_id: String,
    pub source: String,
    pub confidence: String,
    pub submitted_at: String,
    pub loom_service_version: Option<String>,
    pub ollama_version: Option<String>,
    pub system: CommunityBenchmarkSystem,
    pub model: CommunityBenchmarkModel,
    pub benchmark: CommunityBenchmarkMetrics,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityBenchmarkSystem {
    pub os_name: String,
    pub os_version: Option<String>,
    pub arch: String,
    pub cpu_brand: Option<String>,
    pub physical_cores: Option<i64>,
    pub logical_cores: Option<i64>,
    pub total_memory_bytes: Option<i64>,
    pub gpu_info: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityBenchmarkModel {
    pub provider: String,
    pub model_name: String,
    pub model_family: Option<String>,
    pub parameter_count_b: Option<f64>,
    pub quantization: Option<String>,
    pub supports_thinking: Option<bool>,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityBenchmarkMetrics {
    pub prompt_kind: String,
    pub strategy: String,
    pub num_ctx: Option<i64>,
    pub num_predict: Option<i64>,
    pub parallelism: i64,
    pub first_token_latency_ms: Option<i64>,
    pub total_latency_ms: Option<i64>,
    pub tokens_per_second: Option<f64>,
    pub success: bool,
    pub error_kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityBenchmarkRecord {
    pub entry_id: String,
    pub source: String,
    pub confidence: String,
    pub submitted_at: String,
    pub loom_service_version: Option<String>,
    pub ollama_version: Option<String>,
    pub system_json: String,
    pub model_json: String,
    pub benchmark_json: String,
    pub notes: Option<String>,
    pub provider: String,
    pub model_name: String,
    pub os_name: String,
    pub arch: String,
    pub prompt_kind: String,
    pub strategy: String,
    pub parallelism: i64,
    pub success: bool,
    pub imported_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommunityImportSummary {
    pub imported: usize,
    pub skipped: usize,
    pub rejected: usize,
    pub errors: Vec<String>,
}

pub fn configured_catalog_path() -> Option<PathBuf> {
    env::var("LOOM_COMMUNITY_BENCHMARK_CATALOG_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
}

pub fn default_catalog_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("docs/capability/community_model_benchmarks.sample.json")
}

pub fn load_catalog_from_path(path: PathBuf) -> Result<CommunityBenchmarkCatalog, ServiceError> {
    let raw = fs::read_to_string(&path).map_err(|error| {
        ServiceError::storage(format!(
            "failed to read community benchmark catalog {}: {error}",
            path.display()
        ))
    })?;
    parse_catalog(&raw)
}

pub fn parse_catalog(raw: &str) -> Result<CommunityBenchmarkCatalog, ServiceError> {
    let value: Value = serde_json::from_str(raw).map_err(|error| {
        ServiceError::storage(format!(
            "failed to parse community benchmark catalog: {error}"
        ))
    })?;
    reject_forbidden_keys(&value)?;

    let catalog: CommunityBenchmarkCatalog = serde_json::from_value(value).map_err(|error| {
        ServiceError::storage(format!(
            "community benchmark catalog does not match required shape: {error}"
        ))
    })?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

pub fn validate_catalog(catalog: &CommunityBenchmarkCatalog) -> Result<(), ServiceError> {
    if catalog.version != 1 {
        return Err(ServiceError::storage(
            "community benchmark catalog version must be 1",
        ));
    }

    for entry in &catalog.entries {
        require_non_empty("entryId", &entry.entry_id)?;
        require_non_empty("source", &entry.source)?;
        require_non_empty("confidence", &entry.confidence)?;
        require_non_empty("submittedAt", &entry.submitted_at)?;
        require_non_empty("system.osName", &entry.system.os_name)?;
        require_non_empty("system.arch", &entry.system.arch)?;
        require_non_empty("model.provider", &entry.model.provider)?;
        require_non_empty("model.modelName", &entry.model.model_name)?;
        require_non_empty("benchmark.promptKind", &entry.benchmark.prompt_kind)?;
        require_non_empty("benchmark.strategy", &entry.benchmark.strategy)?;

        if !matches!(entry.confidence.as_str(), "low" | "medium" | "high") {
            return Err(ServiceError::storage(format!(
                "community benchmark {} has invalid confidence",
                entry.entry_id
            )));
        }
        if !matches!(entry.source.as_str(), "community_pr" | "community_catalog") {
            return Err(ServiceError::storage(format!(
                "community benchmark {} has invalid source",
                entry.entry_id
            )));
        }
        if entry.benchmark.parallelism < 1 {
            return Err(ServiceError::storage(format!(
                "community benchmark {} has invalid parallelism",
                entry.entry_id
            )));
        }
        if !is_known_prompt_kind(&entry.benchmark.prompt_kind) {
            return Err(ServiceError::storage(format!(
                "community benchmark {} has invalid promptKind",
                entry.entry_id
            )));
        }
        if !is_known_strategy(&entry.benchmark.strategy) {
            return Err(ServiceError::storage(format!(
                "community benchmark {} has invalid strategy",
                entry.entry_id
            )));
        }
    }

    Ok(())
}

fn reject_forbidden_keys(value: &Value) -> Result<(), ServiceError> {
    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                if FORBIDDEN_COMMUNITY_KEYS.contains(&key.as_str()) {
                    return Err(ServiceError::storage(format!(
                        "community benchmark catalog contains forbidden field {key}"
                    )));
                }
                reject_forbidden_keys(nested)?;
            }
        }
        Value::Array(values) => {
            for nested in values {
                reject_forbidden_keys(nested)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn require_non_empty(field: &str, value: &str) -> Result<(), ServiceError> {
    if value.trim().is_empty() {
        return Err(ServiceError::storage(format!(
            "community benchmark catalog is missing required field {field}"
        )));
    }
    Ok(())
}

fn is_known_prompt_kind(value: &str) -> bool {
    matches!(
        value,
        "tiny_health"
            | "short_factual"
            | "factual"
            | "long_form"
            | "synthesis"
            | "deep_synthesis"
            | "document"
            | "code"
            | "explanation"
    )
}

fn is_known_strategy(value: &str) -> bool {
    matches!(
        value,
        "short_direct"
            | "normal_direct"
            | "long_direct"
            | "long_auto_continue"
            | "sectioned_sequential"
            | "parallel_2_draft_synthesize"
            | "parallel_3_draft_synthesize"
            | "deep_synthesis"
            | "fallback_safe"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_with(extra: &str) -> String {
        format!(
            r#"{{
              "version": 1,
              "entries": [{{
                "entryId": "sample-entry",
                "source": "community_pr",
                "confidence": "high",
                "submittedAt": "2026-05-10T00:00:00Z",
                "loomServiceVersion": null,
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
                  "strategy": "sectioned_sequential",
                  "numCtx": null,
                  "numPredict": null,
                  "parallelism": 1,
                  "firstTokenLatencyMs": null,
                  "totalLatencyMs": null,
                  "tokensPerSecond": null,
                  "success": true,
                  "errorKind": null
                }},
                "notes": null
                {extra}
              }}]
            }}"#
        )
    }

    #[test]
    fn valid_catalog_import_shape_passes() {
        let catalog = parse_catalog(&sample_with("")).unwrap();
        assert_eq!(catalog.version, 1);
        assert_eq!(catalog.entries[0].entry_id, "sample-entry");
    }

    #[test]
    fn nullable_optional_fields_pass() {
        let catalog = parse_catalog(&sample_with("")).unwrap();
        assert_eq!(catalog.entries[0].system.total_memory_bytes, None);
        assert_eq!(catalog.entries[0].benchmark.tokens_per_second, None);
    }

    #[test]
    fn missing_required_field_fails() {
        let raw = sample_with("").replace(r#""entryId": "sample-entry","#, "");
        assert!(parse_catalog(&raw).is_err());
    }

    #[test]
    fn forbidden_raw_thinking_field_fails() {
        let raw = sample_with(r#","raw_thinking": "secret""#);
        assert!(parse_catalog(&raw).is_err());
    }

    #[test]
    fn forbidden_user_prompt_field_fails() {
        let raw = sample_with(r#","user_prompt": "private""#);
        assert!(parse_catalog(&raw).is_err());
    }
}
