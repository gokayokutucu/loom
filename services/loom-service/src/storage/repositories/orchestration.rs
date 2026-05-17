#![allow(dead_code)]

use crate::{error::ServiceError, storage::db::Database};
use serde::Serialize;
use sqlx::{Row, SqlitePool};

const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunRecord {
    pub run_id: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewWorkflowRun {
    pub run_id: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStageRecord {
    pub stage_id: String,
    pub run_id: String,
    pub stage_kind: String,
    pub title: String,
    pub status: String,
    pub sequence_index: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewWorkflowStage {
    pub stage_id: String,
    pub run_id: String,
    pub stage_kind: String,
    pub title: String,
    pub status: String,
    pub sequence_index: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<String>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationEventRecord {
    pub event_id: String,
    pub run_id: String,
    pub event_type: String,
    pub stage_id: Option<String>,
    pub payload_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewOrchestrationEvent {
    pub event_id: String,
    pub run_id: String,
    pub event_type: String,
    pub stage_id: Option<String>,
    pub payload_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct WorkflowRunRepository {
    pool: SqlitePool,
}

#[derive(Debug, Clone)]
pub struct WorkflowStageRepository {
    pool: SqlitePool,
}

#[derive(Debug, Clone)]
pub struct OrchestrationEventRepository {
    pool: SqlitePool,
}

impl WorkflowRunRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_run(&self, run: &NewWorkflowRun) -> Result<(), ServiceError> {
        reject_forbidden_payload(run.metadata_json.as_deref())?;
        sqlx::query(
            "INSERT INTO workflow_runs (
                run_id, loom_id, response_id, status, started_at, finished_at, metadata_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&run.run_id)
        .bind(&run.loom_id)
        .bind(&run.response_id)
        .bind(&run.status)
        .bind(&run.started_at)
        .bind(&run.finished_at)
        .bind(&run.metadata_json)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert workflow run: {error}"))
        })?;

        Ok(())
    }

    pub async fn get_run(&self, run_id: &str) -> Result<Option<WorkflowRunRecord>, ServiceError> {
        sqlx::query("SELECT * FROM workflow_runs WHERE run_id = ?1 LIMIT 1")
            .bind(run_id)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(workflow_run_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to get workflow run: {error}")))
    }

    pub async fn update_run_status(
        &self,
        run_id: &str,
        status: &str,
        finished_at: Option<&str>,
    ) -> Result<(), ServiceError> {
        sqlx::query(
            "UPDATE workflow_runs
             SET status = ?2,
                 finished_at = COALESCE(?3, finished_at)
             WHERE run_id = ?1",
        )
        .bind(run_id)
        .bind(status)
        .bind(finished_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to update workflow run status: {error}"))
        })?;

        Ok(())
    }

    pub async fn list_runs_by_status(
        &self,
        status: &str,
    ) -> Result<Vec<WorkflowRunRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM workflow_runs
             WHERE status = ?1
             ORDER BY started_at ASC",
        )
        .bind(status)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(workflow_run_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list workflow runs: {error}")))
    }
}

impl WorkflowStageRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_stages(&self, stages: &[NewWorkflowStage]) -> Result<(), ServiceError> {
        for stage in stages {
            reject_forbidden_payload(stage.metadata_json.as_deref())?;
            sqlx::query(
                "INSERT INTO workflow_stages (
                    stage_id, run_id, stage_kind, title, status, sequence_index,
                    started_at, finished_at, error, metadata_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .bind(&stage.stage_id)
            .bind(&stage.run_id)
            .bind(&stage.stage_kind)
            .bind(&stage.title)
            .bind(&stage.status)
            .bind(stage.sequence_index)
            .bind(&stage.started_at)
            .bind(&stage.finished_at)
            .bind(&stage.error)
            .bind(&stage.metadata_json)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to insert workflow stage: {error}"))
            })?;
        }

        Ok(())
    }

    pub async fn list_stages_for_run(
        &self,
        run_id: &str,
    ) -> Result<Vec<WorkflowStageRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM workflow_stages
             WHERE run_id = ?1
             ORDER BY sequence_index ASC",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(workflow_stage_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list workflow stages: {error}")))
    }

    pub async fn update_stage_status(
        &self,
        run_id: &str,
        stage_id: &str,
        status: &str,
        error: Option<&str>,
        timestamp: &str,
    ) -> Result<(), ServiceError> {
        let (started_at, finished_at) = match status {
            "running" => (Some(timestamp), None),
            "done" | "failed" | "skipped" | "cancelled" => (None, Some(timestamp)),
            _ => (None, None),
        };
        sqlx::query(
            "UPDATE workflow_stages
             SET status = ?3,
                 started_at = COALESCE(?5, started_at),
                 finished_at = COALESCE(?6, finished_at),
                 error = COALESCE(?4, error)
             WHERE run_id = ?1 AND (stage_id = ?2 OR stage_kind = ?2)",
        )
        .bind(run_id)
        .bind(stage_id)
        .bind(status)
        .bind(error)
        .bind(started_at)
        .bind(finished_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to update workflow stage status: {error}"))
        })?;

        Ok(())
    }

    pub async fn mark_stage_running(
        &self,
        run_id: &str,
        stage_id: &str,
    ) -> Result<(), ServiceError> {
        self.update_stage_status(run_id, stage_id, "running", None, &timestamp())
            .await
    }

    pub async fn mark_stage_done(&self, run_id: &str, stage_id: &str) -> Result<(), ServiceError> {
        self.update_stage_status(run_id, stage_id, "done", None, &timestamp())
            .await
    }

    pub async fn mark_stage_failed(
        &self,
        run_id: &str,
        stage_id: &str,
        error: &str,
    ) -> Result<(), ServiceError> {
        self.update_stage_status(run_id, stage_id, "failed", Some(error), &timestamp())
            .await
    }

    pub async fn mark_stage_skipped(
        &self,
        run_id: &str,
        stage_id: &str,
    ) -> Result<(), ServiceError> {
        self.update_stage_status(run_id, stage_id, "skipped", None, &timestamp())
            .await
    }
}

impl OrchestrationEventRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_event(&self, event: &NewOrchestrationEvent) -> Result<(), ServiceError> {
        reject_forbidden_payload(event.payload_json.as_deref())?;
        sqlx::query(
            "INSERT INTO orchestration_events (
                event_id, run_id, event_type, stage_id, payload_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&event.event_id)
        .bind(&event.run_id)
        .bind(&event.event_type)
        .bind(&event.stage_id)
        .bind(&event.payload_json)
        .bind(&event.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert orchestration event: {error}"))
        })?;

        Ok(())
    }

    pub async fn list_events_for_run(
        &self,
        run_id: &str,
    ) -> Result<Vec<OrchestrationEventRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM orchestration_events
             WHERE run_id = ?1
             ORDER BY created_at ASC, event_id ASC",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(orchestration_event_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list orchestration events: {error}"))
        })
    }

    pub async fn list_events_for_run_after(
        &self,
        run_id: &str,
        after_event_id: Option<&str>,
    ) -> Result<Vec<OrchestrationEventRecord>, ServiceError> {
        let events = self.list_events_for_run(run_id).await?;
        let Some(after_event_id) = after_event_id else {
            return Ok(events);
        };
        let Some(position) = events
            .iter()
            .position(|event| event.event_id == after_event_id)
        else {
            return Ok(events);
        };
        Ok(events.into_iter().skip(position + 1).collect())
    }
}

fn workflow_run_from_row(row: sqlx::sqlite::SqliteRow) -> WorkflowRunRecord {
    WorkflowRunRecord {
        run_id: row.get("run_id"),
        loom_id: row.get("loom_id"),
        response_id: row.get("response_id"),
        status: row.get("status"),
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
        metadata_json: row.get("metadata_json"),
    }
}

fn workflow_stage_from_row(row: sqlx::sqlite::SqliteRow) -> WorkflowStageRecord {
    WorkflowStageRecord {
        stage_id: row.get("stage_id"),
        run_id: row.get("run_id"),
        stage_kind: row.get("stage_kind"),
        title: row.get("title"),
        status: row.get("status"),
        sequence_index: row.get("sequence_index"),
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
        error: row.get("error"),
        metadata_json: row.get("metadata_json"),
    }
}

fn orchestration_event_from_row(row: sqlx::sqlite::SqliteRow) -> OrchestrationEventRecord {
    OrchestrationEventRecord {
        event_id: row.get("event_id"),
        run_id: row.get("run_id"),
        event_type: row.get("event_type"),
        stage_id: row.get("stage_id"),
        payload_json: row.get("payload_json"),
        created_at: row.get("created_at"),
    }
}

fn reject_forbidden_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "orchestration payload contains forbidden key {forbidden}"
            )));
        }
    }

    Ok(())
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        NewOrchestrationEvent, NewWorkflowRun, NewWorkflowStage, OrchestrationEventRepository,
        WorkflowRunRepository, WorkflowStageRepository,
    };
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn create_workflow_run_stages_and_events() {
        let database = test_database().await;
        let runs = WorkflowRunRepository::new(&database);
        let stages = WorkflowStageRepository::new(&database);
        let events = OrchestrationEventRepository::new(&database);

        runs.insert_run(&sample_run("run-1"))
            .await
            .expect("insert run");
        stages
            .insert_stages(&[
                sample_stage("run-1", "orchestrate", 0),
                sample_stage("run-1", "generate", 1),
            ])
            .await
            .expect("insert stages");
        stages
            .mark_stage_running("run-1", "orchestrate")
            .await
            .expect("running");
        stages
            .mark_stage_done("run-1", "orchestrate")
            .await
            .expect("done");
        runs.update_run_status("run-1", "running", None)
            .await
            .expect("update run");
        events
            .insert_event(&NewOrchestrationEvent {
                event_id: "event-1".to_string(),
                run_id: "run-1".to_string(),
                event_type: "orchestration.progress".to_string(),
                stage_id: Some("orchestrate".to_string()),
                payload_json: Some("{\"statusText\":\"Understanding\"}".to_string()),
                created_at: "2026-05-09T00:00:00Z".to_string(),
            })
            .await
            .expect("insert event");

        assert_eq!(
            runs.get_run("run-1").await.unwrap().unwrap().status,
            "running"
        );
        assert_eq!(stages.list_stages_for_run("run-1").await.unwrap().len(), 2);
        assert_eq!(events.list_events_for_run("run-1").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn list_runs_by_status_and_stage_failure() {
        let database = test_database().await;
        let runs = WorkflowRunRepository::new(&database);
        let stages = WorkflowStageRepository::new(&database);
        runs.insert_run(&sample_run("run-1"))
            .await
            .expect("insert run");
        stages
            .insert_stages(&[sample_stage("run-1", "orchestrate", 0)])
            .await
            .expect("insert stage");
        stages
            .mark_stage_failed("run-1", "orchestrate", "failed")
            .await
            .expect("fail stage");

        assert_eq!(runs.list_runs_by_status("pending").await.unwrap().len(), 1);
        let stage = stages.list_stages_for_run("run-1").await.unwrap().remove(0);
        assert_eq!(stage.status, "failed");
        assert_eq!(stage.error.as_deref(), Some("failed"));
    }

    #[tokio::test]
    async fn orchestration_events_reject_raw_thinking_payload() {
        let database = test_database().await;
        let events = OrchestrationEventRepository::new(&database);
        let error = events
            .insert_event(&NewOrchestrationEvent {
                event_id: "event-raw".to_string(),
                run_id: "run-1".to_string(),
                event_type: "orchestration.progress".to_string(),
                stage_id: None,
                payload_json: Some("{\"chain_of_thought\":\"secret\"}".to_string()),
                created_at: "2026-05-09T00:00:00Z".to_string(),
            })
            .await
            .expect_err("raw thinking should be rejected");

        assert!(error.to_string().contains("forbidden key"));
    }

    fn sample_run(run_id: &str) -> NewWorkflowRun {
        NewWorkflowRun {
            run_id: run_id.to_string(),
            loom_id: Some("loom-1".to_string()),
            response_id: None,
            status: "pending".to_string(),
            started_at: "2026-05-09T00:00:00Z".to_string(),
            finished_at: None,
            metadata_json: Some("{\"answerPlan\":\"structured\"}".to_string()),
        }
    }

    fn sample_stage(run_id: &str, stage_id: &str, sequence_index: i64) -> NewWorkflowStage {
        NewWorkflowStage {
            stage_id: stage_id.to_string(),
            run_id: run_id.to_string(),
            stage_kind: stage_id.to_string(),
            title: stage_id.to_string(),
            status: "pending".to_string(),
            sequence_index,
            started_at: None,
            finished_at: None,
            error: None,
            metadata_json: None,
        }
    }
}
