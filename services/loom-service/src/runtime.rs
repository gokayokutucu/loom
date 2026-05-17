use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

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

#[cfg(test)]
mod tests {
    use super::{OperationKind, OperationTracker, RestartState};

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
}
