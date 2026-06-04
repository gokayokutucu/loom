use crate::api::state::AppState;
use axum::extract::State;
use axum::Json;
use serde::Serialize;
use std::sync::OnceLock;
use std::time::SystemTime;

const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn service_start_time() -> SystemTime {
    static START_TIME: OnceLock<SystemTime> = OnceLock::new();
    *START_TIME.get_or_init(SystemTime::now)
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoomServiceFingerprint {
    pub package_version: &'static str,
    pub service_start_time: String,
    pub process_id: u32,
    pub runtime_owner_kind: crate::runtime::RuntimeOwnerKind,
    pub binary_path: Option<String>,
    pub binary_size_bytes: Option<u64>,
    pub binary_modified_at: Option<String>,
    pub binary_inode: Option<u64>,
    pub build_profile: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
    pub runtime: &'static str,
    pub version: &'static str,
    pub lifecycle_state: crate::runtime::RuntimeLifecycleState,
    pub runtime_owner_kind: crate::runtime::RuntimeOwnerKind,
    pub active_run_count: usize,
    pub shutdown_requested: bool,
    pub local_only: bool,
    pub database: DatabaseHealthResponse,
    pub config: crate::config::ConfigStatus,
    pub providers: ProvidersHealthResponse,
    pub fingerprint: LoomServiceFingerprint,
}

#[derive(Debug, Serialize)]
pub struct DatabaseHealthResponse {
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct ProvidersHealthResponse {
    pub ollama: crate::providers::types::OllamaHealthResponse,
}

#[derive(Debug, Serialize)]
pub struct VersionResponse {
    pub name: &'static str,
    pub version: &'static str,
    pub build: &'static str,
}

struct Tm {
    year: i32,
    month: i32,
    day: i32,
    hour: i32,
    min: i32,
    sec: i32,
}

fn secs_to_tm(secs: u64) -> Tm {
    const SECS_PER_MIN: u64 = 60;
    const SECS_PER_HOUR: u64 = 3600;
    const SECS_PER_DAY: u64 = 86400;

    let day_seconds = secs % SECS_PER_DAY;
    let days = secs / SECS_PER_DAY;

    let hour = (day_seconds / SECS_PER_HOUR) as i32;
    let min = ((day_seconds % SECS_PER_HOUR) / SECS_PER_MIN) as i32;
    let sec = (day_seconds % SECS_PER_MIN) as i32;

    let mut year = 1970;
    let mut days_left = days;

    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if is_leap { 366 } else { 365 };
        if days_left < days_in_year {
            break;
        }
        days_left -= days_in_year;
        year += 1;
    }

    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let month_days = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for &days_in_month in &month_days {
        if days_left < days_in_month {
            break;
        }
        days_left -= days_in_month;
        month += 1;
    }

    Tm {
        year,
        month,
        day: (days_left + 1) as i32,
        hour,
        min,
        sec,
    }
}

fn format_system_time(system_time: SystemTime) -> String {
    if let Ok(duration) = system_time.duration_since(std::time::UNIX_EPOCH) {
        let secs = duration.as_secs();
        let tm = secs_to_tm(secs);
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            tm.year, tm.month, tm.day, tm.hour, tm.min, tm.sec
        )
    } else {
        "1970-01-01T00:00:00Z".to_string()
    }
}

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let database_ready = state.database.health_check().await;
    let ollama = state.ollama.health().await;
    let providers_ready = ollama.status == "ready";
    let runtime_status = state.restart.runtime_status(&state.operations);

    let mut binary_path = None;
    let mut binary_size_bytes = None;
    let mut binary_modified_at = None;
    let mut binary_inode = None;

    if let Ok(exe_path) = std::env::current_exe() {
        binary_path = exe_path.to_str().map(|s| s.to_string());
        if let Ok(metadata) = std::fs::metadata(&exe_path) {
            binary_size_bytes = Some(metadata.len());
            if let Ok(modified) = metadata.modified() {
                binary_modified_at = Some(format_system_time(modified));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                binary_inode = Some(metadata.ino());
            }
        }
    }

    let fingerprint = LoomServiceFingerprint {
        package_version: PACKAGE_VERSION,
        service_start_time: format_system_time(service_start_time()),
        process_id: std::process::id(),
        runtime_owner_kind: runtime_status.runtime_owner_kind.clone(),
        binary_path,
        binary_size_bytes,
        binary_modified_at,
        binary_inode,
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
    };

    Json(HealthResponse {
        status: if database_ready && providers_ready {
            runtime_status.lifecycle_state.as_str()
        } else {
            "degraded"
        }
        .to_string(),
        runtime: "loom-service",
        version: PACKAGE_VERSION,
        lifecycle_state: runtime_status.lifecycle_state,
        runtime_owner_kind: runtime_status.runtime_owner_kind,
        active_run_count: runtime_status.active_run_count,
        shutdown_requested: runtime_status.shutdown_requested,
        local_only: true,
        database: DatabaseHealthResponse {
            status: if database_ready {
                "ready"
            } else {
                "unavailable"
            }
            .to_string(),
        },
        config: state.config.status(),
        providers: ProvidersHealthResponse { ollama },
        fingerprint,
    })
}

pub async fn version() -> Json<VersionResponse> {
    Json(VersionResponse {
        name: "loom-service",
        version: PACKAGE_VERSION,
        build: "dev",
    })
}

#[cfg(test)]
mod tests {
    use super::health;
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        storage::db::test_database,
    };
    use axum::extract::State;
    use std::{path::PathBuf, time::Duration};

    #[tokio::test]
    async fn service_health_degrades_but_stays_available_when_ollama_unreachable() {
        let state = test_state("http://127.0.0.1:9").await;

        let response = health(State(state)).await.0;

        assert_eq!(response.runtime, "loom-service");
        assert_eq!(response.status, "degraded");
        assert_eq!(response.database.status, "ready");
        assert_eq!(response.config.status, "ready");
        assert_eq!(response.providers.ollama.status, "unavailable");
        assert_eq!(
            response.providers.ollama.reason.as_deref(),
            Some("runtime_unavailable")
        );
    }

    #[tokio::test]
    async fn service_health_returns_safe_fingerprint_diagnostics() {
        let state = test_state("http://127.0.0.1:9").await;

        let response = health(State(state)).await.0;

        assert_eq!(
            response.fingerprint.package_version,
            env!("CARGO_PKG_VERSION")
        );
        assert!(response.fingerprint.process_id > 0);
        assert!(!response.fingerprint.service_start_time.is_empty());
        assert!(
            response.fingerprint.build_profile == "debug"
                || response.fingerprint.build_profile == "release"
        );

        let serialized =
            serde_json::to_value(&response.fingerprint).expect("serialize fingerprint");
        let serialized_str = serialized.to_string().to_lowercase();
        assert!(!serialized_str.contains("secret"));
        assert!(!serialized_str.contains("key"));
        assert!(!serialized_str.contains("password"));
        assert!(!serialized_str.contains("token"));
        assert!(!serialized_str.contains("auth"));
    }

    async fn test_state(ollama_base_url: &str) -> AppState {
        let database = test_database().await;
        let config_file = LoomServiceConfig::default();
        let ollama = OllamaRuntime::new(OllamaConfig {
            base_url: ollama_base_url.to_string(),
            request_timeout: Duration::from_millis(200),
            first_chunk_timeout: Duration::from_millis(200),
            stream_idle_timeout: Duration::from_millis(200),
            security: Default::default(),
        });

        AppState {
            database,
            ollama,
            config: ConfigManager::new(PathBuf::from("/tmp/loom-service-test.toml"), config_file),
            secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }
}
