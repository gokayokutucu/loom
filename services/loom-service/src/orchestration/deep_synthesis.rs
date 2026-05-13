use crate::capabilities::strategy::{
    ExecutionStrategy, ExecutionStrategyDecision, RequestedMode, ResolveExecutionStrategyInput,
};
use serde::{Deserialize, Serialize};

/// Deep Synthesis is explicit, strategy-gated orchestration output.
/// Intermediate drafts are model outputs, not raw thinking. Raw internal
/// monologue must never be represented in these types, events, or prompts.

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSynthesisRequest {
    pub loom_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub references: Vec<DeepSynthesisReference>,
    #[serde(default)]
    pub requested_mode: RequestedMode,
    pub model_name: String,
    pub strategy_decision_id: Option<String>,
    pub strategy: Option<ExecutionStrategyDecision>,
    pub max_parallelism: Option<i64>,
    pub section_count: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSynthesisReference {
    pub reference_id: String,
    pub label: Option<String>,
    pub selected_text: Option<String>,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeepSynthesisWorkerRole {
    ConciseDraft,
    DetailedDraft,
    CriticalDraft,
    SectionWriter,
    Synthesizer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeepSynthesisStepStatus {
    Pending,
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSynthesisSection {
    pub section_id: String,
    pub title: String,
    pub status: DeepSynthesisStepStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSynthesisDraft {
    pub draft_id: String,
    pub worker_role: DeepSynthesisWorkerRole,
    pub content: String,
    pub status: DeepSynthesisStepStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSynthesisPlan {
    pub strategy: ExecutionStrategy,
    pub sections: Vec<DeepSynthesisSection>,
    pub draft_workers: Vec<DeepSynthesisWorkerRole>,
    pub synthesis_step: DeepSynthesisWorkerRole,
    pub max_parallelism: i64,
    pub estimated_budget: i64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepSynthesisExecutionResult {
    pub run_id: String,
    pub plan: DeepSynthesisPlan,
    pub drafts: Vec<DeepSynthesisDraft>,
    pub final_answer: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeepSynthesisError {
    pub kind: &'static str,
    pub message: String,
}

impl DeepSynthesisError {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

pub fn strategy_input_from_request(
    request: &DeepSynthesisRequest,
) -> ResolveExecutionStrategyInput {
    ResolveExecutionStrategyInput {
        model_id: None,
        provider: Some("ollama".to_string()),
        model_name: Some(request.model_name.clone()),
        requested_mode: request.requested_mode.clone(),
        prompt_kind: if request.requested_mode == RequestedMode::Document {
            crate::capabilities::strategy::PromptKind::Document
        } else {
            crate::capabilities::strategy::PromptKind::Synthesis
        },
        context_size_tokens: estimate_tokens(&request.prompt),
        reference_count: request.references.len() as i64,
        user_requested_parallelism: request.max_parallelism,
    }
}

pub fn plan_deep_synthesis(
    request: &DeepSynthesisRequest,
    decision: &ExecutionStrategyDecision,
) -> Result<DeepSynthesisPlan, DeepSynthesisError> {
    if request.requested_mode == RequestedMode::Quick {
        return Err(DeepSynthesisError::new(
            "quick_mode_rejected",
            "Quick Ask cannot use Deep Synthesis.",
        ));
    }

    let mut warnings = Vec::new();
    if request.strategy_decision_id.is_some() && request.strategy.is_none() {
        warnings.push(
            "strategyDecisionId was supplied but persisted decision lookup is not implemented; resolved current strategy instead."
                .to_string(),
        );
    }

    let requested_parallelism = request.max_parallelism.unwrap_or(decision.max_parallelism);
    let max_parallelism = requested_parallelism
        .max(1)
        .min(decision.max_parallelism.max(1));
    let strategy = match decision.strategy {
        ExecutionStrategy::Parallel3DraftSynthesize if decision.allow_parallel_drafts => {
            if max_parallelism >= 3 {
                ExecutionStrategy::Parallel3DraftSynthesize
            } else {
                warnings.push("Requested/capability parallelism downgraded below 3.".to_string());
                ExecutionStrategy::Parallel2DraftSynthesize
            }
        }
        ExecutionStrategy::Parallel2DraftSynthesize if decision.allow_parallel_drafts => {
            if max_parallelism >= 2 {
                ExecutionStrategy::Parallel2DraftSynthesize
            } else {
                warnings.push(
                    "Parallel drafts are not available; using sectioned sequential.".to_string(),
                );
                ExecutionStrategy::SectionedSequential
            }
        }
        ExecutionStrategy::DeepSynthesis if decision.allow_deep_synthesis => {
            ExecutionStrategy::DeepSynthesis
        }
        ExecutionStrategy::Parallel3DraftSynthesize
        | ExecutionStrategy::Parallel2DraftSynthesize
        | ExecutionStrategy::DeepSynthesis => {
            warnings.push(
                "Capability decision named a deep strategy but did not allow it; using sectioned sequential."
                    .to_string(),
            );
            ExecutionStrategy::SectionedSequential
        }
        ExecutionStrategy::SectionedSequential => ExecutionStrategy::SectionedSequential,
        ExecutionStrategy::LongDirect | ExecutionStrategy::LongAutoContinue => {
            warnings.push(
                "Capability policy did not allow parallel drafts; using sectioned sequential."
                    .to_string(),
            );
            ExecutionStrategy::SectionedSequential
        }
        ExecutionStrategy::NormalDirect
        | ExecutionStrategy::FallbackSafe
        | ExecutionStrategy::ShortDirect => {
            return Err(DeepSynthesisError::new(
                "strategy_not_allowed",
                "Capability strategy does not allow Deep Synthesis for this request.",
            ));
        }
    };

    let section_count = request.section_count.unwrap_or_else(|| {
        if matches!(strategy, ExecutionStrategy::SectionedSequential) {
            3
        } else {
            0
        }
    });
    let sections = (0..section_count)
        .map(|index| DeepSynthesisSection {
            section_id: format!("section-{}", index + 1),
            title: format!("Section {}", index + 1),
            status: DeepSynthesisStepStatus::Pending,
        })
        .collect();
    let draft_workers = match strategy {
        ExecutionStrategy::Parallel3DraftSynthesize | ExecutionStrategy::DeepSynthesis => vec![
            DeepSynthesisWorkerRole::ConciseDraft,
            DeepSynthesisWorkerRole::DetailedDraft,
            DeepSynthesisWorkerRole::CriticalDraft,
        ],
        ExecutionStrategy::Parallel2DraftSynthesize => vec![
            DeepSynthesisWorkerRole::ConciseDraft,
            DeepSynthesisWorkerRole::DetailedDraft,
        ],
        ExecutionStrategy::SectionedSequential => vec![DeepSynthesisWorkerRole::SectionWriter],
        _ => Vec::new(),
    };

    Ok(DeepSynthesisPlan {
        strategy,
        sections,
        draft_workers,
        synthesis_step: DeepSynthesisWorkerRole::Synthesizer,
        max_parallelism: match strategy {
            ExecutionStrategy::Parallel3DraftSynthesize => 3.min(max_parallelism),
            ExecutionStrategy::Parallel2DraftSynthesize => 2.min(max_parallelism),
            _ => 1,
        },
        estimated_budget: decision.max_output_tokens,
        warnings,
    })
}

pub struct MockDeepSynthesisExecutor;

impl MockDeepSynthesisExecutor {
    pub async fn execute(
        run_id: &str,
        request: &DeepSynthesisRequest,
        plan: DeepSynthesisPlan,
    ) -> DeepSynthesisExecutionResult {
        let mut drafts = Vec::new();
        match plan.strategy {
            ExecutionStrategy::SectionedSequential => {
                for section in &plan.sections {
                    drafts.push(DeepSynthesisDraft {
                        draft_id: format!("draft-{}", section.section_id),
                        worker_role: DeepSynthesisWorkerRole::SectionWriter,
                        content: format!(
                            "{} draft for: {}",
                            section.title,
                            compact_prompt(&request.prompt)
                        ),
                        status: DeepSynthesisStepStatus::Done,
                    });
                }
            }
            _ => {
                for role in &plan.draft_workers {
                    drafts.push(DeepSynthesisDraft {
                        draft_id: format!("draft-{:?}", role).to_ascii_lowercase(),
                        worker_role: role.clone(),
                        content: format!(
                            "{:?} output for: {}",
                            role,
                            compact_prompt(&request.prompt)
                        ),
                        status: DeepSynthesisStepStatus::Done,
                    });
                }
            }
        }

        let final_answer = format!(
            "Synthesized answer for: {}\n\n{}",
            compact_prompt(&request.prompt),
            drafts
                .iter()
                .map(|draft| draft.content.clone())
                .collect::<Vec<_>>()
                .join("\n")
        );

        DeepSynthesisExecutionResult {
            run_id: run_id.to_string(),
            plan,
            drafts,
            final_answer,
            cancelled: false,
        }
    }
}

pub fn contains_forbidden_raw_thinking(value: &serde_json::Value) -> bool {
    let text = value.to_string().to_ascii_lowercase();
    [
        "raw_thinking",
        "thinking_text",
        "chain_of_thought",
        "hidden_reasoning",
    ]
    .iter()
    .any(|key| text.contains(key))
}

fn estimate_tokens(text: &str) -> i64 {
    (text.chars().count() as i64 / 4).max(1)
}

fn compact_prompt(prompt: &str) -> String {
    let prompt = prompt.trim();
    if prompt.chars().count() <= 120 {
        return prompt.to_string();
    }
    prompt.chars().take(117).collect::<String>() + "..."
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(
        strategy: ExecutionStrategy,
        parallelism: i64,
        allow_deep: bool,
    ) -> ExecutionStrategyDecision {
        ExecutionStrategyDecision {
            decision_id: "decision-1".to_string(),
            snapshot_id: Some("snapshot-1".to_string()),
            model_id: Some("ollama:qwen3.5:9b".to_string()),
            requested_mode: "deep".to_string(),
            prompt_kind: "synthesis".to_string(),
            context_size_tokens: 1000,
            strategy,
            max_output_tokens: 8192,
            max_parallelism: parallelism,
            allow_deep_synthesis: allow_deep,
            allow_parallel_drafts: parallelism > 1,
            reason: vec![],
            warnings: vec![],
            created_at: "1".to_string(),
        }
    }

    fn request(mode: RequestedMode) -> DeepSynthesisRequest {
        DeepSynthesisRequest {
            loom_id: None,
            prompt: "Write a deep synthesis about local AI runtime strategy.".to_string(),
            references: Vec::new(),
            requested_mode: mode,
            model_name: "qwen3.5:9b".to_string(),
            strategy_decision_id: None,
            strategy: None,
            max_parallelism: None,
            section_count: None,
        }
    }

    #[test]
    fn quick_mode_rejects_deep_synthesis() {
        let result = plan_deep_synthesis(
            &request(RequestedMode::Quick),
            &decision(ExecutionStrategy::Parallel2DraftSynthesize, 2, true),
        );
        assert_eq!(result.unwrap_err().kind, "quick_mode_rejected");
    }

    #[test]
    fn low_capability_downgrades_parallel_strategy() {
        let mut decision = decision(ExecutionStrategy::LongAutoContinue, 1, false);
        decision.allow_parallel_drafts = false;
        let plan = plan_deep_synthesis(&request(RequestedMode::Long), &decision).unwrap();
        assert_eq!(plan.strategy, ExecutionStrategy::SectionedSequential);
        assert_eq!(plan.max_parallelism, 1);
    }

    #[test]
    fn high_capability_allows_2_way_parallel_draft() {
        let plan = plan_deep_synthesis(
            &request(RequestedMode::Deep),
            &decision(ExecutionStrategy::Parallel2DraftSynthesize, 2, true),
        )
        .unwrap();
        assert_eq!(plan.draft_workers.len(), 2);
        assert_eq!(plan.synthesis_step, DeepSynthesisWorkerRole::Synthesizer);
    }

    #[test]
    fn very_high_capability_allows_3_way_parallel_draft() {
        let plan = plan_deep_synthesis(
            &request(RequestedMode::Document),
            &decision(ExecutionStrategy::Parallel3DraftSynthesize, 3, true),
        )
        .unwrap();
        assert_eq!(plan.draft_workers.len(), 3);
        assert_eq!(plan.max_parallelism, 3);
    }

    #[test]
    fn sectioned_sequential_plan_creates_sections() {
        let mut request = request(RequestedMode::Long);
        request.section_count = Some(4);
        let plan = plan_deep_synthesis(
            &request,
            &decision(ExecutionStrategy::SectionedSequential, 1, false),
        )
        .unwrap();
        assert_eq!(plan.sections.len(), 4);
        assert_eq!(
            plan.draft_workers,
            vec![DeepSynthesisWorkerRole::SectionWriter]
        );
    }

    #[test]
    fn raw_thinking_fields_are_detected() {
        let value = serde_json::json!({ "hidden_reasoning": "private" });
        assert!(contains_forbidden_raw_thinking(&value));
    }

    #[tokio::test]
    async fn mock_executor_returns_final_synthesized_answer() {
        let request = request(RequestedMode::Deep);
        let plan = plan_deep_synthesis(
            &request,
            &decision(ExecutionStrategy::Parallel2DraftSynthesize, 2, true),
        )
        .unwrap();
        let result = MockDeepSynthesisExecutor::execute("run-1", &request, plan).await;
        assert!(result.final_answer.contains("Synthesized answer"));
        assert_eq!(result.drafts.len(), 2);
    }
}
