use crate::orchestration::workflow::{WorkflowRun, WorkflowStage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationProgressEvent {
    pub event_type: String,
    pub run_id: String,
    pub active_stage: Option<WorkflowStage>,
    pub stages: Vec<WorkflowStage>,
    pub status_text: String,
}

impl OrchestrationProgressEvent {
    pub fn from_run(run: &WorkflowRun) -> Self {
        let active_stage = run
            .stages
            .iter()
            .find(|stage| {
                matches!(
                    stage.status,
                    crate::orchestration::workflow::WorkflowStageStatus::Running
                )
            })
            .cloned()
            .or_else(|| {
                run.stages
                    .iter()
                    .find(|stage| {
                        matches!(
                            stage.status,
                            crate::orchestration::workflow::WorkflowStageStatus::Pending
                        )
                    })
                    .cloned()
            });
        let status_text = active_stage
            .as_ref()
            .map(|stage| stage.title.clone())
            .unwrap_or_else(|| "Finalizing".to_string());

        Self {
            event_type: "orchestration.progress".to_string(),
            run_id: run.run_id.clone(),
            active_stage,
            stages: run.stages.clone(),
            status_text,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::orchestration::{
        progress::OrchestrationProgressEvent,
        workflow::{WorkflowRunner, WorkflowStageStatus},
    };

    #[test]
    fn progress_event_is_json_safe_without_raw_thinking_fields() {
        let mut runner = WorkflowRunner::default();
        let run = runner.create_run(Some("loom-1".to_string()), None);
        runner.mark_stage_running("orchestrate");
        let event = OrchestrationProgressEvent::from_run(&runner.current_progress().unwrap_or(run));
        let serialized = serde_json::to_string(&event).expect("serialize progress event");

        assert!(serialized.contains("orchestration.progress"));
        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("thinking_text"));
        assert!(!serialized.contains("chain_of_thought"));
        assert!(!serialized.contains("hidden_reasoning"));
        assert_eq!(
            event.active_stage.unwrap().status,
            WorkflowStageStatus::Running
        );
    }
}
