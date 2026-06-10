use crate::{
    capabilities::repository::{CapabilityRepository, NewProviderDiscoveredModel},
    error::ServiceError,
    providers::{
        config::{ProviderKind, ProviderProfileConfig},
        types::{ProviderError, ProviderErrorKind},
    },
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDiscoveryRequest {
    pub provider_profile_id: Option<String>,
    pub provider_kind: Option<ProviderKind>,
    pub persist: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDiscoveryResponse {
    pub discovered: Vec<ProviderModelDiscoveryItem>,
    pub errors: Vec<ProviderModelDiscoveryError>,
    pub summary: ProviderModelDiscoverySummary,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDiscoveryItem {
    pub provider_profile_id: String,
    pub provider_kind: ProviderKind,
    pub model_name: String,
    pub source: String,
    pub persisted: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDiscoveryError {
    pub provider_profile_id: String,
    pub provider_kind: ProviderKind,
    pub kind: ProviderErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDiscoverySummary {
    pub discovered_count: usize,
    pub persisted_count: usize,
    pub error_count: usize,
}

pub async fn ingest_provider_model_names(
    repo: &CapabilityRepository,
    profile: &ProviderProfileConfig,
    model_names: Vec<String>,
    persist: bool,
) -> Result<Vec<ProviderModelDiscoveryItem>, ServiceError> {
    let mut items = Vec::new();
    for model_name in normalize_model_names(model_names) {
        let mut warnings = Vec::new();
        let persisted = if persist {
            let upsert = repo
                .upsert_provider_discovered_model(&NewProviderDiscoveredModel {
                    provider_kind: profile.provider_kind.clone(),
                    provider_profile_id: profile.id.clone(),
                    provider: profile.provider_kind.as_config_str().to_string(),
                    model_name: model_name.clone(),
                    model_family: infer_model_family(&model_name),
                    max_context_tokens: None,
                    details_json: None,
                    discovered_at: crate::capabilities::repository::timestamp(),
                })
                .await?;
            if let Some(reason) = upsert.skipped_reason {
                warnings.push(reason);
            }
            upsert.persisted
        } else {
            false
        };
        items.push(ProviderModelDiscoveryItem {
            provider_profile_id: profile.id.clone(),
            provider_kind: profile.provider_kind.clone(),
            model_name,
            source: "provider_discovery".to_string(),
            persisted,
            warnings,
        });
    }
    Ok(items)
}

pub fn discovery_error_from_provider(
    profile: &ProviderProfileConfig,
    error: ProviderError,
) -> ProviderModelDiscoveryError {
    ProviderModelDiscoveryError {
        provider_profile_id: profile.id.clone(),
        provider_kind: profile.provider_kind.clone(),
        kind: error.kind,
        message: error.user_message,
    }
}

pub fn discovery_error(
    profile: &ProviderProfileConfig,
    kind: ProviderErrorKind,
) -> ProviderModelDiscoveryError {
    ProviderModelDiscoveryError {
        provider_profile_id: profile.id.clone(),
        provider_kind: profile.provider_kind.clone(),
        kind,
        message: kind.user_message().to_string(),
    }
}

pub fn discovery_response(
    discovered: Vec<ProviderModelDiscoveryItem>,
    errors: Vec<ProviderModelDiscoveryError>,
) -> ProviderModelDiscoveryResponse {
    let persisted_count = discovered.iter().filter(|item| item.persisted).count();
    ProviderModelDiscoveryResponse {
        summary: ProviderModelDiscoverySummary {
            discovered_count: discovered.len(),
            persisted_count,
            error_count: errors.len(),
        },
        discovered,
        errors,
    }
}

fn normalize_model_names(model_names: Vec<String>) -> Vec<String> {
    let mut names = model_names
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

fn infer_model_family(model_name: &str) -> Option<String> {
    let lower = model_name.to_ascii_lowercase();
    if lower.contains("qwen") {
        Some("qwen".to_string())
    } else if lower.contains("llama") {
        Some("llama".to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        capabilities::{
            repository::provider_discovery_model_id,
            strategy::{
                resolve_execution_strategy, ExecutionStrategy, PromptKind, RequestedMode,
                ResolveExecutionStrategyInput,
            },
            ModelCatalogEntry, SystemResourceSnapshot,
        },
        providers::config::ProviderProfileConfig,
        storage::db::test_database,
    };

    fn fake_snapshot() -> SystemResourceSnapshot {
        SystemResourceSnapshot {
            snapshot_id: "sys-provider-discovery".to_string(),
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

    fn profile(kind: ProviderKind, id: &str) -> ProviderProfileConfig {
        match kind {
            ProviderKind::Ollama => ProviderProfileConfig::default_ollama(
                "qwen3.5:9b".to_string(),
                "http://127.0.0.1:11434".to_string(),
            ),
            ProviderKind::OpenAiCompatible => {
                let mut profile = ProviderProfileConfig::default_ollama(
                    "gpt-compatible".to_string(),
                    "http://127.0.0.1:8080".to_string(),
                );
                profile.id = id.to_string();
                profile.provider_kind = ProviderKind::OpenAiCompatible;
                profile.transport_kind =
                    crate::providers::config::ProviderTransportKind::NativeOpenAiCompatible;
                profile.vendor = crate::providers::config::ProviderVendor::Custom;
                profile.display_name = "OpenAI Compatible Test".to_string();
                profile.security.local_only_required = false;
                profile.capabilities.supports_thinking = false;
                profile
            }
            ProviderKind::OpenAi => {
                let mut profile = ProviderProfileConfig::openai_native_example();
                profile.id = id.to_string();
                profile.enabled = true;
                profile.security.local_only_required = false;
                profile
            }
            ProviderKind::Anthropic => {
                let mut profile = ProviderProfileConfig::anthropic_native_example();
                profile.id = id.to_string();
                profile.enabled = true;
                profile.security.local_only_required = false;
                profile
            }
            ProviderKind::CustomHttpLater => unreachable!("not used in tests"),
        }
    }

    #[tokio::test]
    async fn ollama_discovery_ingests_provider_discovery_rows_idempotently() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        let profile = profile(ProviderKind::Ollama, "ollama-local");

        let first = ingest_provider_model_names(
            &repo,
            &profile,
            vec!["qwen3.5:9b".to_string(), "qwen3.5:9b".to_string()],
            true,
        )
        .await
        .expect("ingest");
        let second =
            ingest_provider_model_names(&repo, &profile, vec!["qwen3.5:9b".to_string()], true)
                .await
                .expect("ingest again");

        assert_eq!(first.len(), 1);
        assert_eq!(second.len(), 1);
        let rows = repo.list_by_provider_profile("ollama-local").await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source, "provider_discovery");
        assert_eq!(rows[0].parameter_count_b, None);
        assert_eq!(rows[0].recommended_memory_bytes, None);
    }

    #[test]
    fn openai_models_response_normalizes_model_ids_without_network() {
        let models = crate::providers::openai_compatible::parse_openai_models_response_value(
            serde_json::json!({
                "data": [
                    {"id": "gpt-compatible-a"},
                    {"id": "gpt-compatible-b"}
                ]
            }),
        )
        .expect("models");

        assert_eq!(models, vec!["gpt-compatible-a", "gpt-compatible-b"]);
    }

    #[tokio::test]
    async fn stronger_catalog_record_is_not_overwritten_by_provider_discovery() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        let now = crate::capabilities::repository::timestamp();
        repo.upsert_model_catalog_entry(&ModelCatalogEntry {
            model_id: "ollama:qwen3.5:9b".to_string(),
            provider: "ollama".to_string(),
            model_name: "qwen3.5:9b".to_string(),
            model_family: Some("qwen".to_string()),
            parameter_count_b: Some(9.0),
            quantization: None,
            supports_thinking: true,
            supports_tools: false,
            recommended_min_memory_bytes: Some(8),
            recommended_memory_bytes: Some(16),
            max_context_tokens: Some(8192),
            source: "curated_seed".to_string(),
            confidence: "medium".to_string(),
            details_json: None,
            notes: None,
            created_at: now.clone(),
            updated_at: now,
        })
        .await
        .unwrap();
        let profile = profile(ProviderKind::Ollama, "ollama-local");

        let result =
            ingest_provider_model_names(&repo, &profile, vec!["qwen3.5:9b".to_string()], true)
                .await
                .unwrap();
        let model = repo
            .find_model(Some("ollama:qwen3.5:9b"), None, None)
            .await
            .unwrap()
            .unwrap();

        assert!(!result[0].persisted);
        assert_eq!(model.source, "curated_seed");
        assert_eq!(model.parameter_count_b, Some(9.0));
        assert_eq!(
            repo.list_by_provider_profile("ollama-local")
                .await
                .unwrap()
                .len(),
            0
        );
    }

    #[tokio::test]
    async fn provider_discovery_details_reject_forbidden_metadata() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        let input = NewProviderDiscoveredModel {
            provider_kind: ProviderKind::Ollama,
            provider_profile_id: "ollama-local".to_string(),
            provider: "ollama".to_string(),
            model_name: "safe-model".to_string(),
            model_family: None,
            max_context_tokens: None,
            details_json: Some(serde_json::json!({ "raw_thinking": "private" }).to_string()),
            discovered_at: crate::capabilities::repository::timestamp(),
        };

        assert!(repo.upsert_provider_discovered_model(&input).await.is_err());
    }

    #[test]
    fn missing_secret_and_unsafe_endpoint_errors_are_safe() {
        let openai = profile(ProviderKind::OpenAiCompatible, "openai-compatible");
        let missing = discovery_error(&openai, ProviderErrorKind::MissingSecret);
        let json = serde_json::to_string(&missing).expect("missing secret json");
        assert_eq!(missing.kind, ProviderErrorKind::MissingSecret);
        assert!(!json.contains("api_key"));
        assert!(!json.contains("bearer"));

        let ollama = profile(ProviderKind::Ollama, "ollama-local");
        let unsafe_error = discovery_error(&ollama, ProviderErrorKind::RemoteEndpointBlocked);
        assert_eq!(unsafe_error.kind, ProviderErrorKind::RemoteEndpointBlocked);
    }

    #[tokio::test]
    async fn provider_discovery_is_low_priority_for_strategy_and_quick_mode() {
        let database = test_database().await;
        let repo = CapabilityRepository::new(&database);
        let profile = profile(ProviderKind::Ollama, "ollama-local");
        ingest_provider_model_names(&repo, &profile, vec!["new-model".to_string()], true)
            .await
            .unwrap();
        let model_id =
            provider_discovery_model_id(&ProviderKind::Ollama, "ollama-local", "new-model");
        let model = repo
            .find_model(Some(&model_id), None, None)
            .await
            .unwrap()
            .unwrap();
        let snapshot = fake_snapshot();
        let input = ResolveExecutionStrategyInput {
            model_id: Some(model.model_id.clone()),
            provider: Some("ollama".to_string()),
            model_name: Some("new-model".to_string()),
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 4096,
            reference_count: 0,
            user_requested_parallelism: Some(3),
        };
        let decision = resolve_execution_strategy(&input, Some(&snapshot), Some(&model), None);
        assert_eq!(decision.max_parallelism, 1);
        assert!(!decision.allow_deep_synthesis);
        assert!(decision
            .warnings
            .contains(&"provider_discovery_is_availability_hint_only".to_string()));

        let quick = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Quick,
            ..input
        };
        let quick_decision =
            resolve_execution_strategy(&quick, Some(&snapshot), Some(&model), None);
        assert_eq!(quick_decision.strategy, ExecutionStrategy::ShortDirect);
        assert_eq!(quick_decision.max_parallelism, 1);
        assert!(!quick_decision.allow_deep_synthesis);
    }
}
