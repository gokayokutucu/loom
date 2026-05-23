use crate::{
    api::state::AppState,
    providers::types::OllamaRuntimeError,
    storage::repositories::model_runtime::{
        timestamp, NewRuntimeModelDownloadJob, RuntimeModelDownloadJobRecord,
        RuntimeModelDownloadJobUpdate, RuntimeModelRepository, UpsertRuntimeModelAsset,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CURATED_OLLAMA_MODELS: &[(&str, &str, bool)] = &[
    ("qwen3.5:9b", "Qwen 3.5 9B", true),
    ("llama3.2", "Llama 3.2 3B", false),
    ("codeqwen:7b-code", "CodeQwen 7B Code", false),
    ("qwen:7b", "Qwen 7B", true),
    ("llama3.1:8b", "Llama 3.1 8B", false),
    ("qwen2.5:7b", "Qwen 2.5 7B", true),
    ("mistral:7b", "Mistral 7B", false),
    ("nomic-embed-text", "Nomic Embed Text", false),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProviderStatus {
    pub provider_kind: String,
    pub provider_profile_id: String,
    pub status: String,
    pub base_url: String,
    pub version: Option<String>,
    pub models_endpoint_reachable: bool,
    pub runtime_owned_by: String,
    pub model_store_path: String,
    pub supports_downloads: bool,
    pub supports_start: bool,
    pub supports_stop: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModelsResponse {
    pub provider: RuntimeProviderStatus,
    pub models: Vec<RuntimeModelItem>,
    pub jobs: Vec<RuntimeModelDownloadJobRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModelItem {
    pub asset_id: String,
    pub provider_kind: String,
    pub provider_profile_id: Option<String>,
    pub model_name: String,
    pub display_name: String,
    pub installed: bool,
    pub status: String,
    pub local_path: Option<String>,
    pub size_bytes: Option<i64>,
    pub digest: Option<String>,
    pub supports_quick: bool,
    pub supports_main: bool,
    pub supports_thinking: bool,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartModelDownloadRequest {
    pub provider_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartModelDownloadResponse {
    pub job: RuntimeModelDownloadJobRecord,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDownloadEventsResponse {
    pub events: Vec<crate::storage::repositories::model_runtime::RuntimeModelDownloadEventRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeApiError {
    pub code: String,
    pub message: String,
}

pub async fn providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<RuntimeProviderStatus>>, (StatusCode, Json<RuntimeApiError>)> {
    Ok(Json(vec![ollama_provider_status(&state).await]))
}

pub async fn models(
    State(state): State<AppState>,
) -> Result<Json<RuntimeModelsResponse>, (StatusCode, Json<RuntimeApiError>)> {
    let repo = RuntimeModelRepository::new(&state.database);
    sync_ollama_assets(&state, &repo).await?;
    let assets = repo.list_assets().await.map_err(storage_error)?;
    let jobs = repo.list_jobs().await.map_err(storage_error)?;
    let provider = ollama_provider_status(&state).await;
    Ok(Json(RuntimeModelsResponse {
        provider,
        models: assets.into_iter().map(asset_to_item).collect(),
        jobs,
    }))
}

pub async fn discover_models(
    State(state): State<AppState>,
) -> Result<Json<RuntimeModelsResponse>, (StatusCode, Json<RuntimeApiError>)> {
    models(State(state)).await
}

pub async fn start_download(
    State(state): State<AppState>,
    Path(model_name): Path<String>,
    Json(input): Json<StartModelDownloadRequest>,
) -> Result<Json<StartModelDownloadResponse>, (StatusCode, Json<RuntimeApiError>)> {
    let model_name = normalize_ollama_model_name(&model_name);
    if !is_curated_model(&model_name) {
        return Err(policy_error(
            "UNTRUSTED_MODEL",
            "Model downloads are limited to curated local model manifests.",
        ));
    }
    if state.restart.is_draining() {
        return Err(policy_error(
            "RUNTIME_DRAINING",
            "loom-service is draining and cannot start a model download.",
        ));
    }

    let repo = RuntimeModelRepository::new(&state.database);
    let job = repo
        .insert_job(&NewRuntimeModelDownloadJob {
            provider_kind: "ollama".to_string(),
            provider_profile_id: input
                .provider_profile_id
                .filter(|value| !value.trim().is_empty())
                .or_else(|| Some("ollama-local".to_string())),
            model_name: model_name.clone(),
            metadata_json: json!({ "requestedBy": "service_api", "runtimeOwnedBy": "loom-service" }),
        })
        .await
        .map_err(storage_error)?;
    let state_for_task = state.clone();
    let job_id = job.job_id.clone();
    tokio::spawn(async move {
        run_ollama_download_job(state_for_task, job_id, model_name).await;
    });
    Ok(Json(StartModelDownloadResponse { job }))
}

pub async fn list_downloads(
    State(state): State<AppState>,
) -> Result<Json<Vec<RuntimeModelDownloadJobRecord>>, (StatusCode, Json<RuntimeApiError>)> {
    RuntimeModelRepository::new(&state.database)
        .list_jobs()
        .await
        .map(Json)
        .map_err(storage_error)
}

pub async fn get_download(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<RuntimeModelDownloadJobRecord>, (StatusCode, Json<RuntimeApiError>)> {
    RuntimeModelRepository::new(&state.database)
        .get_job(&job_id)
        .await
        .map_err(storage_error)?
        .map(Json)
        .ok_or_else(|| {
            not_found(
                "MODEL_DOWNLOAD_JOB_NOT_FOUND",
                "Model download job not found.",
            )
        })
}

pub async fn download_events(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<RuntimeDownloadEventsResponse>, (StatusCode, Json<RuntimeApiError>)> {
    let repo = RuntimeModelRepository::new(&state.database);
    if repo
        .get_job(&job_id)
        .await
        .map_err(storage_error)?
        .is_none()
    {
        return Err(not_found(
            "MODEL_DOWNLOAD_JOB_NOT_FOUND",
            "Model download job not found.",
        ));
    }
    Ok(Json(RuntimeDownloadEventsResponse {
        events: repo.list_events(&job_id).await.map_err(storage_error)?,
    }))
}

pub async fn cancel_download(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<RuntimeModelDownloadJobRecord>, (StatusCode, Json<RuntimeApiError>)> {
    RuntimeModelRepository::new(&state.database)
        .request_cancel(&job_id)
        .await
        .map(Json)
        .map_err(storage_error)
}

async fn run_ollama_download_job(state: AppState, job_id: String, model_name: String) {
    let repo = RuntimeModelRepository::new(&state.database);
    if let Err(error) = repo
        .update_job(
            &job_id,
            RuntimeModelDownloadJobUpdate {
                status: Some("downloading".to_string()),
                ..RuntimeModelDownloadJobUpdate::default()
            },
        )
        .await
    {
        tracing::warn!(%error, %job_id, "failed to mark model download as downloading");
        return;
    }
    let _ = repo
        .insert_event(
            &job_id,
            "download_started",
            json!({ "modelName": model_name }),
        )
        .await;

    let response = match state.ollama.post_pull_stream(&model_name).await {
        Ok(response) => response,
        Err(error) => {
            finish_failed(&repo, &job_id, error).await;
            return;
        }
    };
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut last_digest: Option<String> = None;
    let mut last_completed: Option<i64> = None;
    let mut last_total: Option<i64> = None;

    while let Some(chunk) = stream.next().await {
        let Ok(bytes) = chunk else {
            let _ = repo
                .update_job(
                    &job_id,
                    RuntimeModelDownloadJobUpdate {
                        status: Some("failed".to_string()),
                        error: Some("Ollama model download stream failed.".to_string()),
                        completed_at: Some(timestamp()),
                        ..RuntimeModelDownloadJobUpdate::default()
                    },
                )
                .await;
            let _ = repo
                .insert_event(&job_id, "failed", json!({ "error": "stream_failed" }))
                .await;
            return;
        };
        let text = match std::str::from_utf8(&bytes) {
            Ok(text) => text,
            Err(_) => continue,
        };
        buffer.push_str(text);
        while let Some(index) = buffer.find('\n') {
            let line = buffer[..index].trim().to_string();
            buffer.replace_range(..=index, "");
            if line.is_empty() {
                continue;
            }
            let progress = match serde_json::from_str::<OllamaPullProgress>(&line) {
                Ok(progress) => progress,
                Err(_) => continue,
            };
            if let Some(error) = progress.error {
                let _ = repo
                    .update_job(
                        &job_id,
                        RuntimeModelDownloadJobUpdate {
                            status: Some("failed".to_string()),
                            error: Some(safe_error_preview(&error)),
                            completed_at: Some(timestamp()),
                            ..RuntimeModelDownloadJobUpdate::default()
                        },
                    )
                    .await;
                let _ = repo
                    .insert_event(
                        &job_id,
                        "failed",
                        json!({ "error": safe_error_preview(&error) }),
                    )
                    .await;
                return;
            }
            last_digest = progress.digest.or(last_digest);
            last_completed = progress.completed.or(last_completed);
            last_total = progress.total.or(last_total);
            let percent = match (last_completed, last_total) {
                (Some(completed), Some(total)) if total > 0 => {
                    ((completed as f64 / total as f64) * 100.0).clamp(0.0, 99.0)
                }
                _ => 0.0,
            };
            let _ = repo
                .update_job(
                    &job_id,
                    RuntimeModelDownloadJobUpdate {
                        progress_percent: Some(percent),
                        downloaded_bytes: last_completed,
                        total_bytes: last_total,
                        digest: last_digest.clone(),
                        ..RuntimeModelDownloadJobUpdate::default()
                    },
                )
                .await;
            let _ = repo
                .insert_event(
                    &job_id,
                    "progress",
                    json!({
                        "status": progress.status,
                        "completed": last_completed,
                        "total": last_total,
                        "digest": last_digest,
                        "progressPercent": percent
                    }),
                )
                .await;
            if repo
                .get_job(&job_id)
                .await
                .ok()
                .flatten()
                .is_some_and(|job| job.cancel_requested)
            {
                let _ = repo
                    .update_job(
                        &job_id,
                        RuntimeModelDownloadJobUpdate {
                            status: Some("cancelled".to_string()),
                            completed_at: Some(timestamp()),
                            ..RuntimeModelDownloadJobUpdate::default()
                        },
                    )
                    .await;
                let _ = repo.insert_event(&job_id, "cancelled", json!({})).await;
                return;
            }
        }
    }

    let _ = repo
        .update_job(
            &job_id,
            RuntimeModelDownloadJobUpdate {
                status: Some("installed".to_string()),
                progress_percent: Some(100.0),
                downloaded_bytes: last_total.or(last_completed),
                total_bytes: last_total,
                digest: last_digest.clone(),
                completed_at: Some(timestamp()),
                ..RuntimeModelDownloadJobUpdate::default()
            },
        )
        .await;
    let _ = repo
        .upsert_asset(&UpsertRuntimeModelAsset {
            provider_kind: "ollama".to_string(),
            provider_profile_id: Some("ollama-local".to_string()),
            model_name: model_name.clone(),
            display_name: display_name_for_ollama_model(&model_name).to_string(),
            status: "available".to_string(),
            local_path: Some("~/.ollama/models".to_string()),
            size_bytes: last_total,
            digest: last_digest,
            capability_json: capability_json_for_model(&model_name),
            metadata_json: json!({ "source": "ollama_pull", "runtimeOwnedBy": "loom-service" }),
            installed_at: Some(timestamp()),
        })
        .await;
    let _ = repo
        .insert_event(&job_id, "installed", json!({ "modelName": model_name }))
        .await;
}

async fn finish_failed(repo: &RuntimeModelRepository, job_id: &str, error: OllamaRuntimeError) {
    let message = safe_error_preview(&error.message);
    let _ = repo
        .update_job(
            job_id,
            RuntimeModelDownloadJobUpdate {
                status: Some("failed".to_string()),
                error: Some(message.clone()),
                completed_at: Some(timestamp()),
                ..RuntimeModelDownloadJobUpdate::default()
            },
        )
        .await;
    let _ = repo
        .insert_event(job_id, "failed", json!({ "error": message }))
        .await;
}

async fn sync_ollama_assets(
    state: &AppState,
    repo: &RuntimeModelRepository,
) -> Result<(), (StatusCode, Json<RuntimeApiError>)> {
    let installed = state
        .ollama
        .models()
        .await
        .ok()
        .map(|response| response.models);
    for (model_name, display_name, supports_thinking) in CURATED_OLLAMA_MODELS {
        let normalized = normalize_ollama_model_name(model_name);
        let installed_match = installed.as_ref().is_some_and(|models| {
            models
                .iter()
                .any(|model| normalize_ollama_model_name(model) == normalized)
        });
        repo.upsert_asset(&UpsertRuntimeModelAsset {
            provider_kind: "ollama".to_string(),
            provider_profile_id: Some("ollama-local".to_string()),
            model_name: normalized.clone(),
            display_name: (*display_name).to_string(),
            status: if installed_match { "available" } else { "missing" }.to_string(),
            local_path: Some("~/.ollama/models".to_string()),
            size_bytes: None,
            digest: None,
            capability_json: json!({
                "supportsQuick": true,
                "supportsMain": true,
                "supportsThinking": supports_thinking,
                "roles": ["quick", "main"]
            }),
            metadata_json: json!({ "source": "curated_manifest", "runtimeOwnedBy": "loom-service" }),
            installed_at: installed_match.then(timestamp),
        })
        .await
        .map_err(storage_error)?;
    }
    Ok(())
}

async fn ollama_provider_status(state: &AppState) -> RuntimeProviderStatus {
    let health = state.ollama.health().await;
    RuntimeProviderStatus {
        provider_kind: "ollama".to_string(),
        provider_profile_id: "ollama-local".to_string(),
        status: health.status,
        base_url: health.base_url,
        version: health.version,
        models_endpoint_reachable: health.models_endpoint_reachable,
        runtime_owned_by: "external_ollama".to_string(),
        model_store_path: "~/.ollama/models".to_string(),
        supports_downloads: true,
        supports_start: false,
        supports_stop: false,
        warnings: health.security.warnings,
    }
}

fn asset_to_item(
    asset: crate::storage::repositories::model_runtime::RuntimeModelAssetRecord,
) -> RuntimeModelItem {
    RuntimeModelItem {
        asset_id: asset.asset_id,
        provider_kind: asset.provider_kind,
        provider_profile_id: asset.provider_profile_id,
        model_name: asset.model_name,
        display_name: asset.display_name,
        installed: asset.status == "available",
        status: asset.status,
        local_path: asset.local_path,
        size_bytes: asset.size_bytes,
        digest: asset.digest,
        supports_quick: bool_json(&asset.capability_json, "supportsQuick").unwrap_or(true),
        supports_main: bool_json(&asset.capability_json, "supportsMain").unwrap_or(true),
        supports_thinking: bool_json(&asset.capability_json, "supportsThinking").unwrap_or(false),
        source: string_json(&asset.metadata_json, "source")
            .unwrap_or("runtime_asset")
            .to_string(),
    }
}

#[derive(Debug, Clone, Deserialize)]
struct OllamaPullProgress {
    status: Option<String>,
    digest: Option<String>,
    total: Option<i64>,
    completed: Option<i64>,
    error: Option<String>,
}

fn is_curated_model(model_name: &str) -> bool {
    let normalized_input = normalize_ollama_model_name(model_name);
    CURATED_OLLAMA_MODELS
        .iter()
        .any(|(model, _, _)| normalize_ollama_model_name(model) == normalized_input)
}

fn normalize_ollama_model_name(model_name: &str) -> String {
    model_name
        .trim()
        .strip_suffix(":latest")
        .unwrap_or_else(|| model_name.trim())
        .to_string()
}

fn display_name_for_ollama_model(model_name: &str) -> &'static str {
    CURATED_OLLAMA_MODELS
        .iter()
        .find(|(model, _, _)| normalize_ollama_model_name(model) == model_name)
        .map(|(_, display, _)| *display)
        .unwrap_or("Ollama Model")
}

fn capability_json_for_model(model_name: &str) -> Value {
    let supports_thinking = CURATED_OLLAMA_MODELS
        .iter()
        .find(|(model, _, _)| normalize_ollama_model_name(model) == model_name)
        .map(|(_, _, supports_thinking)| *supports_thinking)
        .unwrap_or(false);
    json!({
        "supportsQuick": true,
        "supportsMain": true,
        "supportsThinking": supports_thinking,
        "roles": ["quick", "main"]
    })
}

fn bool_json(value: &Value, key: &str) -> Option<bool> {
    value.as_object()?.get(key)?.as_bool()
}

fn string_json<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.as_object()?.get(key)?.as_str()
}

fn safe_error_preview(value: &str) -> String {
    value.chars().take(240).collect()
}

fn storage_error(error: crate::error::ServiceError) -> (StatusCode, Json<RuntimeApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(RuntimeApiError {
            code: "RUNTIME_STORAGE_ERROR".to_string(),
            message: error.to_string(),
        }),
    )
}

fn policy_error(code: &str, message: &str) -> (StatusCode, Json<RuntimeApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(RuntimeApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

fn not_found(code: &str, message: &str) -> (StatusCode, Json<RuntimeApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(RuntimeApiError {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::repositories::model_runtime::runtime_asset_id;

    #[test]
    fn model_download_policy_accepts_only_curated_models() {
        assert!(is_curated_model("qwen3.5:9b"));
        assert!(is_curated_model("qwen3.5:9b:latest"));
        assert!(!is_curated_model("../../some-model"));
        assert!(!is_curated_model("untrusted:latest"));
    }

    #[test]
    fn asset_ids_are_stable_for_runtime_models() {
        assert_eq!(
            runtime_asset_id("ollama", Some("ollama-local"), "qwen3.5:9b"),
            "ollama:ollama-local:qwen3.5:9b"
        );
    }
}
