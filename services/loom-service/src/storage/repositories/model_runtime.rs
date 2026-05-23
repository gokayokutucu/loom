use crate::{error::ServiceError, storage::db::Database};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use std::sync::atomic::{AtomicU64, Ordering};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

const FORBIDDEN_RUNTIME_KEYS: [&str; 8] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "rawThinking",
    "thinkingText",
    "chainOfThought",
    "hiddenReasoning",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModelAssetRecord {
    pub asset_id: String,
    pub provider_kind: String,
    pub provider_profile_id: Option<String>,
    pub model_name: String,
    pub display_name: String,
    pub status: String,
    pub local_path: Option<String>,
    pub size_bytes: Option<i64>,
    pub digest: Option<String>,
    pub capability_json: Value,
    pub metadata_json: Value,
    pub installed_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModelDownloadJobRecord {
    pub job_id: String,
    pub provider_kind: String,
    pub provider_profile_id: Option<String>,
    pub model_name: String,
    pub status: String,
    pub progress_percent: f64,
    pub downloaded_bytes: Option<i64>,
    pub total_bytes: Option<i64>,
    pub digest: Option<String>,
    pub error: Option<String>,
    pub cancel_requested: bool,
    pub metadata_json: Value,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModelDownloadEventRecord {
    pub event_id: String,
    pub job_id: String,
    pub event_type: String,
    pub payload_json: Value,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct UpsertRuntimeModelAsset {
    pub provider_kind: String,
    pub provider_profile_id: Option<String>,
    pub model_name: String,
    pub display_name: String,
    pub status: String,
    pub local_path: Option<String>,
    pub size_bytes: Option<i64>,
    pub digest: Option<String>,
    pub capability_json: Value,
    pub metadata_json: Value,
    pub installed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewRuntimeModelDownloadJob {
    pub provider_kind: String,
    pub provider_profile_id: Option<String>,
    pub model_name: String,
    pub metadata_json: Value,
}

#[derive(Debug, Clone, Default)]
pub struct RuntimeModelDownloadJobUpdate {
    pub status: Option<String>,
    pub progress_percent: Option<f64>,
    pub downloaded_bytes: Option<i64>,
    pub total_bytes: Option<i64>,
    pub digest: Option<String>,
    pub error: Option<String>,
    pub cancel_requested: Option<bool>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeModelRepository {
    database: Database,
}

impl RuntimeModelRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            database: database.clone(),
        }
    }

    pub async fn upsert_asset(
        &self,
        asset: &UpsertRuntimeModelAsset,
    ) -> Result<RuntimeModelAssetRecord, ServiceError> {
        reject_forbidden_runtime_value(&asset.capability_json)?;
        reject_forbidden_runtime_value(&asset.metadata_json)?;
        let now = timestamp();
        let asset_id = runtime_asset_id(
            &asset.provider_kind,
            asset.provider_profile_id.as_deref(),
            &asset.model_name,
        );
        sqlx::query(
            "INSERT INTO runtime_model_assets (
                asset_id, provider_kind, provider_profile_id, model_name, display_name, status,
                local_path, size_bytes, digest, capability_json, metadata_json, installed_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(provider_kind, provider_profile_id, model_name) DO UPDATE SET
                display_name=excluded.display_name,
                status=excluded.status,
                local_path=excluded.local_path,
                size_bytes=excluded.size_bytes,
                digest=excluded.digest,
                capability_json=excluded.capability_json,
                metadata_json=excluded.metadata_json,
                installed_at=COALESCE(excluded.installed_at, runtime_model_assets.installed_at),
                updated_at=excluded.updated_at",
        )
        .bind(&asset_id)
        .bind(&asset.provider_kind)
        .bind(&asset.provider_profile_id)
        .bind(&asset.model_name)
        .bind(&asset.display_name)
        .bind(&asset.status)
        .bind(&asset.local_path)
        .bind(asset.size_bytes)
        .bind(&asset.digest)
        .bind(safe_json_string(&asset.capability_json)?)
        .bind(safe_json_string(&asset.metadata_json)?)
        .bind(&asset.installed_at)
        .bind(&now)
        .execute(self.database.pool())
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to upsert runtime model asset: {error}"))
        })?;

        self.get_asset(&asset_id).await?.ok_or_else(|| {
            ServiceError::storage("runtime model asset was not found after upsert".to_string())
        })
    }

    pub async fn list_assets(&self) -> Result<Vec<RuntimeModelAssetRecord>, ServiceError> {
        let rows = sqlx::query(
            "SELECT asset_id, provider_kind, provider_profile_id, model_name, display_name,
                status, local_path, size_bytes, digest, capability_json, metadata_json,
                installed_at, updated_at
             FROM runtime_model_assets
             ORDER BY provider_kind, display_name COLLATE NOCASE",
        )
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to list runtime model assets: {error}"))
        })?;
        rows.into_iter().map(asset_from_row).collect()
    }

    pub async fn get_asset(
        &self,
        asset_id: &str,
    ) -> Result<Option<RuntimeModelAssetRecord>, ServiceError> {
        let row = sqlx::query(
            "SELECT asset_id, provider_kind, provider_profile_id, model_name, display_name,
                status, local_path, size_bytes, digest, capability_json, metadata_json,
                installed_at, updated_at
             FROM runtime_model_assets
             WHERE asset_id = ?1",
        )
        .bind(asset_id)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to get runtime model asset: {error}"))
        })?;
        row.map(asset_from_row).transpose()
    }

    pub async fn insert_job(
        &self,
        job: &NewRuntimeModelDownloadJob,
    ) -> Result<RuntimeModelDownloadJobRecord, ServiceError> {
        reject_forbidden_runtime_value(&job.metadata_json)?;
        let now = timestamp();
        let job_id = new_runtime_id("model-download");
        sqlx::query(
            "INSERT INTO runtime_model_download_jobs (
                job_id, provider_kind, provider_profile_id, model_name, status,
                progress_percent, metadata_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5, ?6, ?6)",
        )
        .bind(&job_id)
        .bind(&job.provider_kind)
        .bind(&job.provider_profile_id)
        .bind(&job.model_name)
        .bind(safe_json_string(&job.metadata_json)?)
        .bind(&now)
        .execute(self.database.pool())
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to create runtime model download job: {error}"
            ))
        })?;
        self.insert_event(&job_id, "queued", json!({ "modelName": job.model_name }))
            .await?;
        self.get_job(&job_id).await?.ok_or_else(|| {
            ServiceError::storage(
                "runtime model download job was not found after insert".to_string(),
            )
        })
    }

    pub async fn list_jobs(&self) -> Result<Vec<RuntimeModelDownloadJobRecord>, ServiceError> {
        let rows = sqlx::query(
            "SELECT job_id, provider_kind, provider_profile_id, model_name, status,
                progress_percent, downloaded_bytes, total_bytes, digest, error,
                cancel_requested, metadata_json, created_at, updated_at, completed_at
             FROM runtime_model_download_jobs
             ORDER BY created_at DESC",
        )
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to list runtime model download jobs: {error}"
            ))
        })?;
        rows.into_iter().map(job_from_row).collect()
    }

    pub async fn get_job(
        &self,
        job_id: &str,
    ) -> Result<Option<RuntimeModelDownloadJobRecord>, ServiceError> {
        let row = sqlx::query(
            "SELECT job_id, provider_kind, provider_profile_id, model_name, status,
                progress_percent, downloaded_bytes, total_bytes, digest, error,
                cancel_requested, metadata_json, created_at, updated_at, completed_at
             FROM runtime_model_download_jobs
             WHERE job_id = ?1",
        )
        .bind(job_id)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to get runtime model download job: {error}"))
        })?;
        row.map(job_from_row).transpose()
    }

    pub async fn update_job(
        &self,
        job_id: &str,
        update: RuntimeModelDownloadJobUpdate,
    ) -> Result<RuntimeModelDownloadJobRecord, ServiceError> {
        let current = self.get_job(job_id).await?.ok_or_else(|| {
            ServiceError::storage(format!("runtime model download job not found: {job_id}"))
        })?;
        let status = update.status.unwrap_or(current.status);
        let progress_percent = update
            .progress_percent
            .unwrap_or(current.progress_percent)
            .clamp(0.0, 100.0);
        let downloaded_bytes = update.downloaded_bytes.or(current.downloaded_bytes);
        let total_bytes = update.total_bytes.or(current.total_bytes);
        let digest = update.digest.or(current.digest);
        let error = update.error.or(current.error);
        let cancel_requested = update.cancel_requested.unwrap_or(current.cancel_requested);
        let completed_at = update.completed_at.or(current.completed_at);
        let now = timestamp();
        sqlx::query(
            "UPDATE runtime_model_download_jobs
             SET status = ?2, progress_percent = ?3, downloaded_bytes = ?4,
                total_bytes = ?5, digest = ?6, error = ?7, cancel_requested = ?8,
                updated_at = ?9, completed_at = ?10
             WHERE job_id = ?1",
        )
        .bind(job_id)
        .bind(&status)
        .bind(progress_percent)
        .bind(downloaded_bytes)
        .bind(total_bytes)
        .bind(&digest)
        .bind(&error)
        .bind(if cancel_requested { 1 } else { 0 })
        .bind(&now)
        .bind(&completed_at)
        .execute(self.database.pool())
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to update runtime model download job: {error}"
            ))
        })?;
        self.get_job(job_id).await?.ok_or_else(|| {
            ServiceError::storage(format!(
                "runtime model download job not found after update: {job_id}"
            ))
        })
    }

    pub async fn request_cancel(
        &self,
        job_id: &str,
    ) -> Result<RuntimeModelDownloadJobRecord, ServiceError> {
        let job = self
            .update_job(
                job_id,
                RuntimeModelDownloadJobUpdate {
                    cancel_requested: Some(true),
                    ..RuntimeModelDownloadJobUpdate::default()
                },
            )
            .await?;
        self.insert_event(job_id, "cancel_requested", json!({}))
            .await?;
        Ok(job)
    }

    pub async fn insert_event(
        &self,
        job_id: &str,
        event_type: &str,
        payload_json: Value,
    ) -> Result<RuntimeModelDownloadEventRecord, ServiceError> {
        reject_forbidden_runtime_value(&payload_json)?;
        let event_id = new_runtime_id("model-download-event");
        let now = timestamp();
        sqlx::query(
            "INSERT INTO runtime_model_download_events (
                event_id, job_id, event_type, payload_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&event_id)
        .bind(job_id)
        .bind(event_type)
        .bind(safe_json_string(&payload_json)?)
        .bind(&now)
        .execute(self.database.pool())
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to insert runtime model download event: {error}"
            ))
        })?;
        Ok(RuntimeModelDownloadEventRecord {
            event_id,
            job_id: job_id.to_string(),
            event_type: event_type.to_string(),
            payload_json,
            created_at: now,
        })
    }

    pub async fn list_events(
        &self,
        job_id: &str,
    ) -> Result<Vec<RuntimeModelDownloadEventRecord>, ServiceError> {
        let rows = sqlx::query(
            "SELECT event_id, job_id, event_type, payload_json, created_at
             FROM runtime_model_download_events
             WHERE job_id = ?1
             ORDER BY created_at ASC",
        )
        .bind(job_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to list runtime model download events: {error}"
            ))
        })?;
        rows.into_iter().map(event_from_row).collect()
    }
}

fn asset_from_row(row: sqlx::sqlite::SqliteRow) -> Result<RuntimeModelAssetRecord, ServiceError> {
    let capability_json: String = row.get("capability_json");
    let metadata_json: String = row.get("metadata_json");
    Ok(RuntimeModelAssetRecord {
        asset_id: row.get("asset_id"),
        provider_kind: row.get("provider_kind"),
        provider_profile_id: row.get("provider_profile_id"),
        model_name: row.get("model_name"),
        display_name: row.get("display_name"),
        status: row.get("status"),
        local_path: row.get("local_path"),
        size_bytes: row.get("size_bytes"),
        digest: row.get("digest"),
        capability_json: parse_json(&capability_json)?,
        metadata_json: parse_json(&metadata_json)?,
        installed_at: row.get("installed_at"),
        updated_at: row.get("updated_at"),
    })
}

fn job_from_row(
    row: sqlx::sqlite::SqliteRow,
) -> Result<RuntimeModelDownloadJobRecord, ServiceError> {
    let metadata_json: String = row.get("metadata_json");
    Ok(RuntimeModelDownloadJobRecord {
        job_id: row.get("job_id"),
        provider_kind: row.get("provider_kind"),
        provider_profile_id: row.get("provider_profile_id"),
        model_name: row.get("model_name"),
        status: row.get("status"),
        progress_percent: row.get("progress_percent"),
        downloaded_bytes: row.get("downloaded_bytes"),
        total_bytes: row.get("total_bytes"),
        digest: row.get("digest"),
        error: row.get("error"),
        cancel_requested: row.get::<i64, _>("cancel_requested") != 0,
        metadata_json: parse_json(&metadata_json)?,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        completed_at: row.get("completed_at"),
    })
}

fn event_from_row(
    row: sqlx::sqlite::SqliteRow,
) -> Result<RuntimeModelDownloadEventRecord, ServiceError> {
    let payload_json: String = row.get("payload_json");
    Ok(RuntimeModelDownloadEventRecord {
        event_id: row.get("event_id"),
        job_id: row.get("job_id"),
        event_type: row.get("event_type"),
        payload_json: parse_json(&payload_json)?,
        created_at: row.get("created_at"),
    })
}

pub fn runtime_asset_id(
    provider_kind: &str,
    provider_profile_id: Option<&str>,
    model_name: &str,
) -> String {
    let profile = provider_profile_id.unwrap_or("default");
    format!(
        "{}:{}:{}",
        sanitize_id_part(provider_kind),
        sanitize_id_part(profile),
        sanitize_id_part(model_name)
    )
}

pub fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn unix_timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn new_runtime_id(prefix: &str) -> String {
    let sequence = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{sequence}", unix_timestamp_millis())
}

fn sanitize_id_part(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn parse_json(value: &str) -> Result<Value, ServiceError> {
    serde_json::from_str(value)
        .map_err(|error| ServiceError::storage(format!("invalid runtime metadata JSON: {error}")))
}

fn safe_json_string(value: &Value) -> Result<String, ServiceError> {
    reject_forbidden_runtime_value(value)?;
    serde_json::to_string(value).map_err(|error| {
        ServiceError::storage(format!("failed to serialize runtime JSON: {error}"))
    })
}

fn reject_forbidden_runtime_value(value: &Value) -> Result<(), ServiceError> {
    match value {
        Value::Object(map) => {
            for (key, entry) in map {
                if FORBIDDEN_RUNTIME_KEYS.contains(&key.as_str()) {
                    return Err(ServiceError::config(
                        "runtime model metadata contains forbidden raw thinking fields",
                    ));
                }
                reject_forbidden_runtime_value(entry)?;
            }
            Ok(())
        }
        Value::Array(values) => {
            for entry in values {
                reject_forbidden_runtime_value(entry)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn runtime_model_asset_and_job_lifecycle_persist() {
        let database = test_database().await;
        let repo = RuntimeModelRepository::new(&database);

        let asset = repo
            .upsert_asset(&UpsertRuntimeModelAsset {
                provider_kind: "ollama".to_string(),
                provider_profile_id: Some("ollama-local".to_string()),
                model_name: "qwen3.5:9b".to_string(),
                display_name: "Qwen 3.5 9B".to_string(),
                status: "missing".to_string(),
                local_path: Some("~/.ollama/models".to_string()),
                size_bytes: None,
                digest: None,
                capability_json: json!({"supportsThinking": true, "roles": ["quick", "main"]}),
                metadata_json: json!({"source": "test"}),
                installed_at: None,
            })
            .await
            .expect("asset");
        assert_eq!(asset.status, "missing");

        let job = repo
            .insert_job(&NewRuntimeModelDownloadJob {
                provider_kind: "ollama".to_string(),
                provider_profile_id: Some("ollama-local".to_string()),
                model_name: "qwen3.5:9b".to_string(),
                metadata_json: json!({"requestedBy": "test"}),
            })
            .await
            .expect("job");
        assert_eq!(job.status, "queued");

        let updated = repo
            .update_job(
                &job.job_id,
                RuntimeModelDownloadJobUpdate {
                    status: Some("downloading".to_string()),
                    progress_percent: Some(50.0),
                    downloaded_bytes: Some(50),
                    total_bytes: Some(100),
                    ..RuntimeModelDownloadJobUpdate::default()
                },
            )
            .await
            .expect("update");
        assert_eq!(updated.progress_percent, 50.0);

        let events = repo.list_events(&job.job_id).await.expect("events");
        assert_eq!(events[0].event_type, "queued");
    }

    #[tokio::test]
    async fn runtime_model_metadata_rejects_raw_thinking() {
        let database = test_database().await;
        let repo = RuntimeModelRepository::new(&database);
        let result = repo
            .insert_job(&NewRuntimeModelDownloadJob {
                provider_kind: "ollama".to_string(),
                provider_profile_id: None,
                model_name: "qwen3.5:9b".to_string(),
                metadata_json: json!({"raw_thinking": "nope"}),
            })
            .await;

        assert!(result.is_err());
    }
}
