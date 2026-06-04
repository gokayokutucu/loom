use crate::{
    api::state::AppState,
    capabilities::{
        configured_catalog_path, default_catalog_path, default_model_catalog_entries,
        detect_system_resources, discovery_error, discovery_error_from_provider,
        discovery_response, estimate_model_compatibility, ingest_provider_model_names,
        load_catalog_from_path, resolve_execution_strategy,
        resolve_execution_strategy_with_community_entries, CapabilityRepository,
        CommunityBenchmarkRecord, CommunityImportSummary, CompatibilityEstimate,
        CompatibilityEstimateInput, ModelCatalogEntry, ProviderModelDiscoveryRequest,
        ProviderModelDiscoveryResponse, ResolveExecutionStrategyInput, SystemResourceSnapshot,
    },
    providers::{
        openai_compatible::{OpenAiCompatibleRuntime, OpenAiCompatibleSecret},
        secret_store::{default_provider_secret_ref, SecretStore},
        types::ProviderErrorKind,
    },
};
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub async fn system(
    State(state): State<AppState>,
) -> Result<Json<SystemResourceSnapshot>, (StatusCode, Json<CapabilityApiError>)> {
    let snapshot = detect_system_resources();
    CapabilityRepository::new(&state.database)
        .insert_system_snapshot(&snapshot)
        .await
        .map_err(api_error)?;
    Ok(Json(snapshot))
}

pub async fn models(
    State(state): State<AppState>,
) -> Result<Json<Vec<ModelCatalogEntry>>, (StatusCode, Json<CapabilityApiError>)> {
    let repo = CapabilityRepository::new(&state.database);
    ensure_default_models(&repo).await.map_err(api_error)?;
    repo.list_model_catalog().await.map(Json).map_err(api_error)
}

pub async fn seed_models(
    State(state): State<AppState>,
) -> Result<Json<Vec<ModelCatalogEntry>>, (StatusCode, Json<CapabilityApiError>)> {
    let repo = CapabilityRepository::new(&state.database);
    repo.seed_model_catalog(&default_model_catalog_entries())
        .await
        .map_err(api_error)?;
    repo.list_model_catalog().await.map(Json).map_err(api_error)
}

pub async fn discover_models(
    State(state): State<AppState>,
    Json(input): Json<ProviderModelDiscoveryRequest>,
) -> Result<Json<ProviderModelDiscoveryResponse>, (StatusCode, Json<CapabilityApiError>)> {
    let repo = CapabilityRepository::new(&state.database);
    let persist = input.persist.unwrap_or(true);
    let config = state.config.current();
    let mut discovered = Vec::new();
    let mut errors = Vec::new();
    let profiles = if let Some(ref requested_id) = input.provider_profile_id {
        config
            .providers
            .profiles
            .into_iter()
            .filter(|profile| &profile.id == requested_id)
            .filter(|profile| {
                input
                    .provider_kind
                    .as_ref()
                    .map_or(true, |kind| &profile.provider_kind == kind)
            })
            .collect::<Vec<_>>()
    } else {
        config
            .providers
            .profiles
            .into_iter()
            .filter(|profile| profile.enabled)
            .filter(|profile| {
                input
                    .provider_kind
                    .as_ref()
                    .map_or(true, |kind| &profile.provider_kind == kind)
            })
            .collect::<Vec<_>>()
    };

    for profile in profiles {
        if !profile.enabled {
            errors.push(discovery_error(&profile, ProviderErrorKind::Disabled));
            continue;
        }

        match profile.provider_kind {
            crate::providers::config::ProviderKind::Ollama => match state.ollama.models().await {
                Ok(response) => {
                    discovered.extend(
                        ingest_provider_model_names(&repo, &profile, response.models, persist)
                            .await
                            .map_err(api_error)?,
                    );
                }
                Err(error) => {
                    errors.push(discovery_error_from_provider(
                        &profile,
                        error.to_provider_error(Some(&profile.id), None),
                    ));
                }
            },
            crate::providers::config::ProviderKind::OpenAiCompatible => {
                let mut secret = None;
                if profile.requires_secret {
                    let secret_ref = profile
                        .secret_ref
                        .clone()
                        .unwrap_or_else(|| default_provider_secret_ref(&profile.id));
                    match state.secret_store.resolve_secret(&secret_ref) {
                        Ok(Some(resolved)) => {
                            secret = Some(OpenAiCompatibleSecret::bearer(
                                resolved.expose_for_provider_runtime().to_string(),
                            ));
                        }
                        _ => {
                            errors
                                .push(discovery_error(&profile, ProviderErrorKind::MissingSecret));
                            continue;
                        }
                    }
                }

                let runtime = OpenAiCompatibleRuntime::new(profile.clone(), secret);
                match runtime.models().await {
                    Ok(response) => {
                        discovered.extend(
                            ingest_provider_model_names(&repo, &profile, response.models, persist)
                                .await
                                .map_err(api_error)?,
                        );
                    }
                    Err(error) => {
                        errors.push(discovery_error_from_provider(
                            &profile,
                            error.to_provider_error(Some(&profile.id), None),
                        ));
                    }
                }
            }
            crate::providers::config::ProviderKind::CustomHttpLater => {
                errors.push(discovery_error(
                    &profile,
                    ProviderErrorKind::UnsupportedFeature,
                ));
            }
        }
    }

    Ok(Json(discovery_response(discovered, errors)))
}

pub async fn resolve_strategy(
    State(state): State<AppState>,
    Json(input): Json<ResolveExecutionStrategyInput>,
) -> Result<
    Json<crate::capabilities::ExecutionStrategyDecision>,
    (StatusCode, Json<CapabilityApiError>),
> {
    let repo = CapabilityRepository::new(&state.database);
    ensure_default_models(&repo).await.map_err(api_error)?;

    let snapshot = match repo.latest_system_snapshot().await.map_err(api_error)? {
        Some(snapshot) => snapshot,
        None => {
            let snapshot = detect_system_resources();
            repo.insert_system_snapshot(&snapshot)
                .await
                .map_err(api_error)?;
            snapshot
        }
    };
    let model = repo
        .find_model(
            input.model_id.as_deref(),
            input.provider.as_deref(),
            input.model_name.as_deref(),
        )
        .await
        .map_err(api_error)?;
    let benchmark = match model.as_ref() {
        Some(model) => repo
            .latest_benchmark_for_model(&model.model_id)
            .await
            .map_err(api_error)?,
        None => None,
    };
    let provider = input
        .provider
        .as_deref()
        .or_else(|| model.as_ref().map(|value| value.provider.as_str()));
    let model_name = input
        .model_name
        .as_deref()
        .or_else(|| model.as_ref().map(|value| value.model_name.as_str()));
    let community_entries = match (provider, model_name) {
        (Some(provider), Some(model_name)) => repo
            .community_baselines(
                provider,
                model_name,
                crate::capabilities::strategy::prompt_kind_name(&input.prompt_kind),
            )
            .await
            .map_err(api_error)?,
        _ => Vec::new(),
    };
    let decision = if community_entries.is_empty() {
        resolve_execution_strategy(&input, Some(&snapshot), model.as_ref(), benchmark.as_ref())
    } else {
        resolve_execution_strategy_with_community_entries(
            &input,
            Some(&snapshot),
            model.as_ref(),
            benchmark.as_ref(),
            &community_entries,
        )
    };
    repo.insert_strategy_decision(&decision)
        .await
        .map_err(api_error)?;

    Ok(Json(decision))
}

pub async fn benchmarks(
    State(state): State<AppState>,
) -> Result<
    Json<Vec<crate::capabilities::repository::ModelRuntimeBenchmarkRecord>>,
    (StatusCode, Json<CapabilityApiError>),
> {
    CapabilityRepository::new(&state.database)
        .list_benchmarks()
        .await
        .map(Json)
        .map_err(api_error)
}

pub async fn estimate(
    State(state): State<AppState>,
    Json(input): Json<CompatibilityEstimateInput>,
) -> Result<Json<CompatibilityEstimateResponse>, (StatusCode, Json<CapabilityApiError>)> {
    let repo = CapabilityRepository::new(&state.database);
    ensure_default_models(&repo).await.map_err(api_error)?;

    let snapshot = match repo.latest_system_snapshot().await.map_err(api_error)? {
        Some(snapshot) => snapshot,
        None => {
            let snapshot = detect_system_resources();
            repo.insert_system_snapshot(&snapshot)
                .await
                .map_err(api_error)?;
            snapshot
        }
    };
    let model = repo
        .find_model(None, input.provider.as_deref(), input.model_name.as_deref())
        .await
        .map_err(api_error)?;
    let benchmark = match model.as_ref() {
        Some(model) => repo
            .latest_benchmark_for_model(&model.model_id)
            .await
            .map_err(api_error)?,
        None => None,
    };
    let community_entries = match (input.provider.as_deref(), input.model_name.as_deref()) {
        (Some(provider), Some(model_name)) => repo
            .community_baselines(
                provider,
                model_name,
                crate::capabilities::strategy::prompt_kind_name(&input.prompt_kind),
            )
            .await
            .map_err(api_error)?,
        _ => Vec::new(),
    };
    let estimate = estimate_model_compatibility(
        &input,
        Some(&snapshot),
        model.as_ref(),
        benchmark.as_ref(),
        &community_entries,
    );
    let used_for_strategy = benchmark.is_none()
        && community_entries.is_empty()
        && input.requested_mode != crate::capabilities::strategy::RequestedMode::Quick;
    let warnings = estimate.warnings.clone();

    Ok(Json(CompatibilityEstimateResponse {
        estimate,
        used_for_strategy,
        warnings,
    }))
}

pub async fn import_community(
    State(state): State<AppState>,
    Json(input): Json<CommunityImportRequest>,
) -> Result<Json<CommunityImportSummary>, (StatusCode, Json<CapabilityApiError>)> {
    let path = input
        .path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(configured_catalog_path)
        .unwrap_or_else(default_catalog_path);
    let catalog = load_catalog_from_path(path).map_err(api_error)?;
    CapabilityRepository::new(&state.database)
        .import_community_catalog(&catalog)
        .await
        .map(Json)
        .map_err(api_error)
}

pub async fn community(
    State(state): State<AppState>,
) -> Result<Json<Vec<CommunityBenchmarkRecord>>, (StatusCode, Json<CapabilityApiError>)> {
    CapabilityRepository::new(&state.database)
        .list_community_benchmarks()
        .await
        .map(Json)
        .map_err(api_error)
}

async fn ensure_default_models(
    repo: &CapabilityRepository,
) -> Result<(), crate::error::ServiceError> {
    repo.seed_model_catalog(&default_model_catalog_entries())
        .await
}

fn api_error(error: crate::error::ServiceError) -> (StatusCode, Json<CapabilityApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(CapabilityApiError {
            code: "CAPABILITY_FAILED".to_string(),
            message: error.to_string(),
        }),
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityApiError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityEstimateResponse {
    pub estimate: CompatibilityEstimate,
    pub used_for_strategy: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityImportRequest {
    pub path: Option<String>,
}
