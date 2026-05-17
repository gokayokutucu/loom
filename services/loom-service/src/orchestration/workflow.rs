use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStageKind {
    Orchestrate,
    PrepareContext,
    Generate,
    ReviewOptional,
    CompressCheckpoint,
    Persist,
    EmitEvents,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStageStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStage {
    pub id: String,
    pub title: String,
    pub status: WorkflowStageStatus,
    pub stage_kind: WorkflowStageKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub run_id: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub stages: Vec<WorkflowStage>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: WorkflowStageStatus,
}

#[derive(Debug, Clone, Default)]
pub struct WorkflowRunner {
    run: Option<WorkflowRun>,
}

#[derive(Debug, Clone)]
pub struct RepositoryWorkflowRunner {
    runs: crate::storage::repositories::orchestration::WorkflowRunRepository,
    stages: crate::storage::repositories::orchestration::WorkflowStageRepository,
    events: crate::storage::repositories::orchestration::OrchestrationEventRepository,
}

impl WorkflowRunner {
    pub fn create_run(
        &mut self,
        loom_id: Option<String>,
        response_id: Option<String>,
    ) -> WorkflowRun {
        let run = WorkflowRun {
            run_id: format!("workflow-{}", timestamp()),
            loom_id,
            response_id,
            stages: default_stages(),
            started_at: timestamp(),
            finished_at: None,
            status: WorkflowStageStatus::Pending,
        };
        self.run = Some(run.clone());
        run
    }

    pub fn mark_stage_running(&mut self, stage_id: &str) {
        self.update_stage(stage_id, WorkflowStageStatus::Running);
        if let Some(run) = &mut self.run {
            run.status = WorkflowStageStatus::Running;
        }
    }

    pub fn mark_stage_done(&mut self, stage_id: &str) {
        self.update_stage(stage_id, WorkflowStageStatus::Done);
        self.finish_if_complete();
    }

    pub fn mark_stage_failed(&mut self, stage_id: &str) {
        self.update_stage(stage_id, WorkflowStageStatus::Failed);
        if let Some(run) = &mut self.run {
            run.status = WorkflowStageStatus::Failed;
            run.finished_at = Some(timestamp());
        }
    }

    pub fn mark_stage_skipped(&mut self, stage_id: &str) {
        self.update_stage(stage_id, WorkflowStageStatus::Skipped);
        self.finish_if_complete();
    }

    pub fn current_progress(&self) -> Option<WorkflowRun> {
        self.run.clone()
    }

    fn update_stage(&mut self, stage_id: &str, status: WorkflowStageStatus) {
        if let Some(run) = &mut self.run {
            if let Some(stage) = run.stages.iter_mut().find(|stage| stage.id == stage_id) {
                stage.status = status;
            }
        }
    }

    fn finish_if_complete(&mut self) {
        if let Some(run) = &mut self.run {
            if run.stages.iter().all(|stage| {
                matches!(
                    stage.status,
                    WorkflowStageStatus::Done | WorkflowStageStatus::Skipped
                )
            }) {
                run.status = WorkflowStageStatus::Done;
                run.finished_at = Some(timestamp());
            }
        }
    }
}

impl RepositoryWorkflowRunner {
    pub fn new(database: &crate::storage::db::Database) -> Self {
        Self {
            runs: crate::storage::repositories::orchestration::WorkflowRunRepository::new(database),
            stages: crate::storage::repositories::orchestration::WorkflowStageRepository::new(
                database,
            ),
            events: crate::storage::repositories::orchestration::OrchestrationEventRepository::new(
                database,
            ),
        }
    }

    pub async fn create_run(
        &self,
        loom_id: Option<String>,
        response_id: Option<String>,
        metadata_json: Option<String>,
    ) -> Result<WorkflowRun, crate::error::ServiceError> {
        let run = WorkflowRun {
            run_id: format!("workflow-{}", timestamp()),
            loom_id,
            response_id,
            stages: default_stages(),
            started_at: timestamp(),
            finished_at: None,
            status: WorkflowStageStatus::Pending,
        };
        self.runs
            .insert_run(
                &crate::storage::repositories::orchestration::NewWorkflowRun {
                    run_id: run.run_id.clone(),
                    loom_id: run.loom_id.clone(),
                    response_id: run.response_id.clone(),
                    status: status_to_string(&run.status),
                    started_at: run.started_at.clone(),
                    finished_at: run.finished_at.clone(),
                    metadata_json,
                },
            )
            .await?;
        let stages: Vec<_> = run
            .stages
            .iter()
            .enumerate()
            .map(
                |(index, stage)| crate::storage::repositories::orchestration::NewWorkflowStage {
                    stage_id: format!("{}:{}", run.run_id, stage.id),
                    run_id: run.run_id.clone(),
                    stage_kind: stage_kind_to_string(&stage.stage_kind),
                    title: stage.title.clone(),
                    status: status_to_string(&stage.status),
                    sequence_index: index as i64,
                    started_at: None,
                    finished_at: None,
                    error: None,
                    metadata_json: None,
                },
            )
            .collect();
        self.stages.insert_stages(&stages).await?;
        self.persist_progress_event(&run).await?;
        Ok(run)
    }

    pub async fn mark_stage_running(
        &self,
        run_id: &str,
        stage_id: &str,
    ) -> Result<WorkflowRun, crate::error::ServiceError> {
        self.stages.mark_stage_running(run_id, stage_id).await?;
        self.runs.update_run_status(run_id, "running", None).await?;
        let run = self.current_progress(run_id).await?;
        self.persist_progress_event(&run).await?;
        Ok(run)
    }

    pub async fn mark_stage_done(
        &self,
        run_id: &str,
        stage_id: &str,
    ) -> Result<WorkflowRun, crate::error::ServiceError> {
        self.stages.mark_stage_done(run_id, stage_id).await?;
        let mut run = self.current_progress(run_id).await?;
        if run.stages.iter().all(|stage| {
            matches!(
                stage.status,
                WorkflowStageStatus::Done | WorkflowStageStatus::Skipped
            )
        }) {
            self.runs
                .update_run_status(run_id, "done", Some(&timestamp()))
                .await?;
            run = self.current_progress(run_id).await?;
        }
        self.persist_progress_event(&run).await?;
        Ok(run)
    }

    pub async fn mark_stage_failed(
        &self,
        run_id: &str,
        stage_id: &str,
        error: &str,
    ) -> Result<WorkflowRun, crate::error::ServiceError> {
        self.stages
            .mark_stage_failed(run_id, stage_id, error)
            .await?;
        self.runs
            .update_run_status(run_id, "failed", Some(&timestamp()))
            .await?;
        let run = self.current_progress(run_id).await?;
        self.persist_progress_event(&run).await?;
        Ok(run)
    }

    pub async fn mark_stage_cancelled(
        &self,
        run_id: &str,
        stage_id: &str,
    ) -> Result<WorkflowRun, crate::error::ServiceError> {
        self.stages
            .update_stage_status(run_id, stage_id, "cancelled", None, &timestamp())
            .await?;
        self.runs
            .update_run_status(run_id, "cancelled", Some(&timestamp()))
            .await?;
        let run = self.current_progress(run_id).await?;
        self.persist_progress_event(&run).await?;
        Ok(run)
    }

    pub async fn mark_stage_skipped(
        &self,
        run_id: &str,
        stage_id: &str,
    ) -> Result<WorkflowRun, crate::error::ServiceError> {
        self.stages.mark_stage_skipped(run_id, stage_id).await?;
        let mut run = self.current_progress(run_id).await?;
        if run.stages.iter().all(|stage| {
            matches!(
                stage.status,
                WorkflowStageStatus::Done | WorkflowStageStatus::Skipped
            )
        }) {
            self.runs
                .update_run_status(run_id, "done", Some(&timestamp()))
                .await?;
            run = self.current_progress(run_id).await?;
        }
        self.persist_progress_event(&run).await?;
        Ok(run)
    }

    pub async fn current_progress(
        &self,
        run_id: &str,
    ) -> Result<WorkflowRun, crate::error::ServiceError> {
        let run = self
            .runs
            .get_run(run_id)
            .await?
            .ok_or_else(|| crate::error::ServiceError::storage("workflow run not found"))?;
        let stages = self.stages.list_stages_for_run(run_id).await?;

        Ok(WorkflowRun {
            run_id: run.run_id,
            loom_id: run.loom_id,
            response_id: run.response_id,
            stages: stages
                .into_iter()
                .map(|stage| WorkflowStage {
                    id: stage.stage_kind.clone(),
                    title: stage.title,
                    status: status_from_string(&stage.status),
                    stage_kind: stage_kind_from_string(&stage.stage_kind),
                })
                .collect(),
            started_at: run.started_at,
            finished_at: run.finished_at,
            status: status_from_string(&run.status),
        })
    }

    async fn persist_progress_event(
        &self,
        run: &WorkflowRun,
    ) -> Result<(), crate::error::ServiceError> {
        let event = crate::orchestration::progress::OrchestrationProgressEvent::from_run(run);
        self.persist_event(
            run.run_id.clone(),
            event.event_type.clone(),
            event.active_stage.as_ref().map(|stage| stage.id.clone()),
            serde_json::to_string(&event).map_err(|error| {
                crate::error::ServiceError::storage(format!(
                    "failed to serialize orchestration event: {error}"
                ))
            })?,
        )
        .await
    }

    pub async fn persist_event(
        &self,
        run_id: String,
        event_type: String,
        stage_id: Option<String>,
        payload_json: String,
    ) -> Result<(), crate::error::ServiceError> {
        self.events
            .insert_event(
                &crate::storage::repositories::orchestration::NewOrchestrationEvent {
                    event_id: format!("event-{}-{}", run_id, timestamp()),
                    run_id,
                    event_type,
                    stage_id,
                    payload_json: Some(payload_json),
                    created_at: timestamp(),
                },
            )
            .await
    }
}

pub fn default_stages() -> Vec<WorkflowStage> {
    vec![
        stage(
            "orchestrate",
            "Understanding the question",
            WorkflowStageKind::Orchestrate,
        ),
        stage(
            "prepare_context",
            "Building Loom context",
            WorkflowStageKind::PrepareContext,
        ),
        stage(
            "generate",
            "Writing final response",
            WorkflowStageKind::Generate,
        ),
        stage(
            "review_optional",
            "Reviewing answer",
            WorkflowStageKind::ReviewOptional,
        ),
        stage(
            "compress_checkpoint",
            "Updating Loom memory",
            WorkflowStageKind::CompressCheckpoint,
        ),
        stage(
            "persist",
            "Saving response state",
            WorkflowStageKind::Persist,
        ),
        stage(
            "emit_events",
            "Publishing progress",
            WorkflowStageKind::EmitEvents,
        ),
    ]
}

fn stage(id: &str, title: &str, stage_kind: WorkflowStageKind) -> WorkflowStage {
    WorkflowStage {
        id: id.to_string(),
        title: title.to_string(),
        status: WorkflowStageStatus::Pending,
        stage_kind,
    }
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

pub fn status_to_string(status: &WorkflowStageStatus) -> String {
    match status {
        WorkflowStageStatus::Pending => "pending",
        WorkflowStageStatus::Running => "running",
        WorkflowStageStatus::Done => "done",
        WorkflowStageStatus::Failed => "failed",
        WorkflowStageStatus::Skipped => "skipped",
        WorkflowStageStatus::Cancelled => "cancelled",
    }
    .to_string()
}

pub fn status_from_string(status: &str) -> WorkflowStageStatus {
    match status {
        "running" => WorkflowStageStatus::Running,
        "done" => WorkflowStageStatus::Done,
        "failed" => WorkflowStageStatus::Failed,
        "skipped" => WorkflowStageStatus::Skipped,
        "cancelled" => WorkflowStageStatus::Cancelled,
        _ => WorkflowStageStatus::Pending,
    }
}

pub fn stage_kind_to_string(kind: &WorkflowStageKind) -> String {
    match kind {
        WorkflowStageKind::Orchestrate => "orchestrate",
        WorkflowStageKind::PrepareContext => "prepare_context",
        WorkflowStageKind::Generate => "generate",
        WorkflowStageKind::ReviewOptional => "review_optional",
        WorkflowStageKind::CompressCheckpoint => "compress_checkpoint",
        WorkflowStageKind::Persist => "persist",
        WorkflowStageKind::EmitEvents => "emit_events",
    }
    .to_string()
}

pub fn stage_kind_from_string(kind: &str) -> WorkflowStageKind {
    match kind {
        "prepare_context" => WorkflowStageKind::PrepareContext,
        "generate" => WorkflowStageKind::Generate,
        "review_optional" => WorkflowStageKind::ReviewOptional,
        "compress_checkpoint" => WorkflowStageKind::CompressCheckpoint,
        "persist" => WorkflowStageKind::Persist,
        "emit_events" => WorkflowStageKind::EmitEvents,
        _ => WorkflowStageKind::Orchestrate,
    }
}

#[cfg(test)]
mod tests {
    use super::{RepositoryWorkflowRunner, WorkflowRunner, WorkflowStageStatus};
    use crate::storage::{
        db::test_database, repositories::orchestration::OrchestrationEventRepository,
    };

    #[test]
    fn workflow_runner_tracks_stage_progression() {
        let mut runner = WorkflowRunner::default();
        runner.create_run(Some("loom-1".to_string()), None);

        runner.mark_stage_running("orchestrate");
        assert_eq!(
            runner.current_progress().unwrap().stages[0].status,
            WorkflowStageStatus::Running
        );

        runner.mark_stage_done("orchestrate");
        assert_eq!(
            runner.current_progress().unwrap().stages[0].status,
            WorkflowStageStatus::Done
        );
    }

    #[tokio::test]
    async fn repository_runner_persists_stage_transitions_and_progress_events() {
        let database = test_database().await;
        let runner = RepositoryWorkflowRunner::new(&database);
        let run = runner
            .create_run(
                Some("loom-1".to_string()),
                None,
                Some("{\"answerPlan\":\"structured\"}".to_string()),
            )
            .await
            .expect("create run");

        let run = runner
            .mark_stage_running(&run.run_id, "orchestrate")
            .await
            .expect("mark running");
        assert_eq!(run.stages[0].status, WorkflowStageStatus::Running);

        let run = runner
            .mark_stage_done(&run.run_id, "orchestrate")
            .await
            .expect("mark done");
        assert_eq!(run.stages[0].status, WorkflowStageStatus::Done);

        let events = OrchestrationEventRepository::new(&database)
            .list_events_for_run(&run.run_id)
            .await
            .expect("list events");
        assert!(events.len() >= 3);
    }

    #[tokio::test]
    async fn repository_runner_marks_stage_cancelled() {
        let database = test_database().await;
        let runner = RepositoryWorkflowRunner::new(&database);
        let run = runner
            .create_run(Some("loom-1".to_string()), None, None)
            .await
            .expect("create run");

        let run = runner
            .mark_stage_cancelled(&run.run_id, "generate")
            .await
            .expect("mark cancelled");

        assert_eq!(run.status, WorkflowStageStatus::Cancelled);
        assert_eq!(
            run.stages
                .iter()
                .find(|stage| stage.id == "generate")
                .unwrap()
                .status,
            WorkflowStageStatus::Cancelled
        );
    }
}
