use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Notify;
use tokio::time::{sleep, timeout};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum OperationKind {
    ModelGeneration,
    ModelDownload,
    SqliteMigration,
    ContextBuild,
    ExportImport,
    ExtensionTool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveOperation {
    pub operation_id: String,
    pub kind: OperationKind,
}

#[derive(Debug, Clone, Default)]
pub struct OperationTracker {
    active: Arc<Mutex<HashMap<String, OperationKind>>>,
}

#[derive(Debug, Clone, Default)]
pub struct RestartState {
    pending: Arc<Mutex<RestartStatus>>,
    lifecycle: Arc<Mutex<RuntimeLifecycle>>,
    shutdown_notify: Arc<Notify>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeLifecycleState {
    Ready,
    Draining,
    Stopping,
}

impl RuntimeLifecycleState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Draining => "draining",
            Self::Stopping => "stopping",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeOwnerKind {
    Electron,
    Dev,
    Test,
}

impl RuntimeOwnerKind {
    pub fn from_env() -> Self {
        match std::env::var("LOOM_SERVICE_RUNTIME_OWNER_KIND")
            .unwrap_or_else(|_| "dev".to_string())
            .to_ascii_lowercase()
            .as_str()
        {
            "electron" | "electron-owned" => Self::Electron,
            "test" => Self::Test,
            _ => Self::Dev,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeLifecycle {
    pub lifecycle_state: RuntimeLifecycleState,
    pub runtime_owner_kind: RuntimeOwnerKind,
    pub owner_pid: Option<u32>,
    pub shutdown_requested: bool,
    pub shutdown_reason: Option<String>,
    pub graceful_drain_timeout_ms: u64,
    pub orphan_idle_timeout_ms: u64,
    pub drain_after_owner_lost: bool,
    pub started_at: String,
}

impl Default for RuntimeLifecycle {
    fn default() -> Self {
        Self {
            lifecycle_state: RuntimeLifecycleState::Ready,
            runtime_owner_kind: RuntimeOwnerKind::from_env(),
            owner_pid: env_u32("LOOM_SERVICE_OWNER_PID"),
            shutdown_requested: false,
            shutdown_reason: None,
            graceful_drain_timeout_ms: env_u64("LOOM_SERVICE_GRACEFUL_DRAIN_TIMEOUT_MS", 120_000),
            orphan_idle_timeout_ms: env_u64("LOOM_SERVICE_ORPHAN_IDLE_TIMEOUT_MS", 10_000),
            drain_after_owner_lost: env_bool("LOOM_SERVICE_DRAIN_AFTER_OWNER_LOST", true),
            started_at: timestamp_millis_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub runtime: &'static str,
    pub lifecycle_state: RuntimeLifecycleState,
    pub runtime_owner_kind: RuntimeOwnerKind,
    pub owner_pid: Option<u32>,
    pub pid: u32,
    pub active_run_count: usize,
    pub shutdown_requested: bool,
    pub shutdown_reason: Option<String>,
    pub graceful_drain_timeout_ms: u64,
    pub orphan_idle_timeout_ms: u64,
    pub started_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeShutdownRequest {
    pub mode: Option<String>,
    pub reason: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeShutdownResponse {
    pub accepted: bool,
    pub lifecycle_state: RuntimeLifecycleState,
    pub active_run_count: usize,
    pub will_exit: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartStatus {
    pub restart_required: bool,
    pub pending_restart: bool,
    pub reason: Option<String>,
    pub active_operations: Vec<ActiveOperation>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartRequestResponse {
    pub restart_accepted: bool,
    pub restart_deferred: bool,
    pub reason: String,
    pub status: RestartStatus,
}

impl OperationTracker {
    pub fn start(&self, operation_id: impl Into<String>, kind: OperationKind) -> OperationGuard {
        let operation_id = operation_id.into();
        self.active
            .lock()
            .expect("operation tracker lock")
            .insert(operation_id.clone(), kind);

        OperationGuard {
            operation_id,
            tracker: self.clone(),
        }
    }

    pub fn finish(&self, operation_id: &str) {
        self.active
            .lock()
            .expect("operation tracker lock")
            .remove(operation_id);
    }

    pub fn active_operations(&self) -> Vec<ActiveOperation> {
        self.active
            .lock()
            .expect("operation tracker lock")
            .iter()
            .map(|(operation_id, kind)| ActiveOperation {
                operation_id: operation_id.clone(),
                kind: *kind,
            })
            .collect()
    }
}

#[derive(Debug)]
pub struct OperationGuard {
    operation_id: String,
    tracker: OperationTracker,
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        self.tracker.finish(&self.operation_id);
    }
}

impl RestartState {
    pub fn runtime_status(&self, operations: &OperationTracker) -> RuntimeStatus {
        let lifecycle = self
            .lifecycle
            .lock()
            .expect("runtime lifecycle lock")
            .clone();
        RuntimeStatus {
            runtime: "loom-service",
            lifecycle_state: lifecycle.lifecycle_state,
            runtime_owner_kind: lifecycle.runtime_owner_kind,
            owner_pid: lifecycle.owner_pid,
            pid: std::process::id(),
            active_run_count: operations.active_operations().len(),
            shutdown_requested: lifecycle.shutdown_requested,
            shutdown_reason: lifecycle.shutdown_reason,
            graceful_drain_timeout_ms: lifecycle.graceful_drain_timeout_ms,
            orphan_idle_timeout_ms: lifecycle.orphan_idle_timeout_ms,
            started_at: lifecycle.started_at,
        }
    }

    pub fn is_draining(&self) -> bool {
        let lifecycle = self.lifecycle.lock().expect("runtime lifecycle lock");
        lifecycle.lifecycle_state != RuntimeLifecycleState::Ready
    }

    pub fn request_shutdown(
        &self,
        operations: OperationTracker,
        request: RuntimeShutdownRequest,
    ) -> RuntimeShutdownResponse {
        let _mode = request.mode.as_deref().unwrap_or("drain");
        let active_run_count = operations.active_operations().len();
        let reason = request
            .reason
            .clone()
            .unwrap_or_else(|| "runtime_shutdown".to_string());
        let timeout_ms = request.timeout_ms.unwrap_or_else(|| {
            self.lifecycle
                .lock()
                .expect("runtime lifecycle lock")
                .graceful_drain_timeout_ms
        });

        {
            let mut lifecycle = self.lifecycle.lock().expect("runtime lifecycle lock");
            lifecycle.lifecycle_state = RuntimeLifecycleState::Draining;
            lifecycle.shutdown_requested = true;
            lifecycle.shutdown_reason = Some(reason.clone());
            if request.timeout_ms.is_some() {
                lifecycle.graceful_drain_timeout_ms = timeout_ms;
            }
        }

        let state = self.clone();
        tokio::spawn(async move {
            state
                .notify_shutdown_when_drained(operations, timeout_ms)
                .await;
        });

        RuntimeShutdownResponse {
            accepted: true,
            lifecycle_state: RuntimeLifecycleState::Draining,
            active_run_count,
            will_exit: true,
            reason,
        }
    }

    pub async fn wait_for_shutdown(&self) {
        self.shutdown_notify.notified().await;
    }

    async fn notify_shutdown_when_drained(&self, operations: OperationTracker, timeout_ms: u64) {
        let wait = async {
            loop {
                if operations.active_operations().is_empty() {
                    break;
                }
                sleep(Duration::from_millis(250)).await;
            }
        };
        let _ = timeout(Duration::from_millis(timeout_ms), wait).await;
        {
            let mut lifecycle = self.lifecycle.lock().expect("runtime lifecycle lock");
            lifecycle.lifecycle_state = RuntimeLifecycleState::Stopping;
        }
        self.shutdown_notify.notify_waiters();
    }

    pub fn spawn_owner_reaper(&self, operations: OperationTracker) {
        let lifecycle = self
            .lifecycle
            .lock()
            .expect("runtime lifecycle lock")
            .clone();
        if lifecycle.runtime_owner_kind != RuntimeOwnerKind::Electron
            || !lifecycle.drain_after_owner_lost
            || lifecycle.owner_pid.is_none()
        {
            return;
        }
        let state = self.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_millis(1_000)).await;
                if state.is_draining() {
                    return;
                }
                let owner_pid = {
                    state
                        .lifecycle
                        .lock()
                        .expect("runtime lifecycle lock")
                        .owner_pid
                };
                if owner_pid.is_some_and(process_is_running) {
                    continue;
                }

                if operations.active_operations().is_empty() {
                    let idle_timeout_ms = state
                        .lifecycle
                        .lock()
                        .expect("runtime lifecycle lock")
                        .orphan_idle_timeout_ms;
                    sleep(Duration::from_millis(idle_timeout_ms)).await;
                    if state.is_draining() {
                        return;
                    }
                    let owner_pid = {
                        state
                            .lifecycle
                            .lock()
                            .expect("runtime lifecycle lock")
                            .owner_pid
                    };
                    if owner_pid.is_some_and(process_is_running) {
                        continue;
                    }
                }

                let timeout_ms = if operations.active_operations().is_empty() {
                    0
                } else {
                    state
                        .lifecycle
                        .lock()
                        .expect("runtime lifecycle lock")
                        .graceful_drain_timeout_ms
                };
                state.request_shutdown(
                    operations.clone(),
                    RuntimeShutdownRequest {
                        mode: Some("drain".to_string()),
                        reason: Some("electron_owner_lost".to_string()),
                        timeout_ms: Some(timeout_ms),
                    },
                );
                return;
            }
        });
    }

    pub fn mark_required(
        &self,
        reason: Option<String>,
        operations: &OperationTracker,
    ) -> RestartStatus {
        let active_operations = operations.active_operations();
        let mut status = self.pending.lock().expect("restart status lock");
        status.restart_required = true;
        status.pending_restart = !active_operations.is_empty();
        status.reason = reason.or_else(|| Some("Restart required.".to_string()));
        status.active_operations = active_operations;
        status.clone()
    }

    pub fn status(&self, operations: &OperationTracker) -> RestartStatus {
        let mut status = self.pending.lock().expect("restart status lock").clone();
        status.active_operations = operations.active_operations();
        if status.restart_required && !status.active_operations.is_empty() {
            status.pending_restart = true;
        }
        status
    }

    pub fn request_restart(&self, operations: &OperationTracker) -> RestartRequestResponse {
        let active_operations = operations.active_operations();
        if active_operations.is_empty() {
            let mut status = self.pending.lock().expect("restart status lock");
            status.restart_required = true;
            status.pending_restart = false;
            status.reason = Some(
                "Restart accepted. Electron will own actual service restart later.".to_string(),
            );
            status.active_operations = Vec::new();
            return RestartRequestResponse {
                restart_accepted: true,
                restart_deferred: false,
                reason: status.reason.clone().unwrap_or_default(),
                status: status.clone(),
            };
        }

        let mut status = self.pending.lock().expect("restart status lock");
        status.restart_required = true;
        status.pending_restart = true;
        status.reason = Some("Restart required after current task completes.".to_string());
        status.active_operations = active_operations;

        RestartRequestResponse {
            restart_accepted: false,
            restart_deferred: true,
            reason: status.reason.clone().unwrap_or_default(),
            status: status.clone(),
        }
    }
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

fn env_u32(key: &str) -> Option<u32> {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
}

fn env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(default)
}

fn timestamp_millis_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn process_is_running(pid: u32) -> bool {
    if pid == std::process::id() {
        return true;
    }
    #[cfg(unix)]
    {
        std::process::Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{
        OperationKind, OperationTracker, RestartState, RuntimeLifecycleState,
        RuntimeShutdownRequest,
    };

    #[test]
    fn restart_deferred_when_model_generation_active() {
        let operations = OperationTracker::default();
        let restart = RestartState::default();
        let _guard = operations.start("request-1", OperationKind::ModelGeneration);

        let response = restart.request_restart(&operations);

        assert!(!response.restart_accepted);
        assert!(response.restart_deferred);
        assert_eq!(response.status.active_operations.len(), 1);
    }

    #[tokio::test]
    async fn shutdown_drain_waits_for_active_generation() {
        let operations = OperationTracker::default();
        let runtime = RestartState::default();
        let guard = operations.start("run-1", OperationKind::ModelGeneration);

        let response = runtime.request_shutdown(
            operations.clone(),
            RuntimeShutdownRequest {
                mode: Some("drain".to_string()),
                reason: Some("test".to_string()),
                timeout_ms: Some(2_000),
            },
        );

        assert!(response.accepted);
        assert_eq!(response.active_run_count, 1);
        assert!(runtime.is_draining());

        drop(guard);
        tokio::time::timeout(
            std::time::Duration::from_millis(1_000),
            runtime.wait_for_shutdown(),
        )
        .await
        .expect("shutdown notified after active generation finished");
        assert_eq!(
            runtime.runtime_status(&operations).lifecycle_state,
            RuntimeLifecycleState::Stopping
        );
    }

    #[tokio::test]
    async fn shutdown_drain_without_active_runs_notifies_promptly() {
        let operations = OperationTracker::default();
        let runtime = RestartState::default();

        let response = runtime.request_shutdown(
            operations.clone(),
            RuntimeShutdownRequest {
                mode: Some("drain".to_string()),
                reason: Some("test".to_string()),
                timeout_ms: Some(2_000),
            },
        );

        assert_eq!(response.active_run_count, 0);
        tokio::time::timeout(
            std::time::Duration::from_millis(1_000),
            runtime.wait_for_shutdown(),
        )
        .await
        .expect("shutdown notified without active work");
    }
}
