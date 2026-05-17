use crate::{
    config::ContextSection,
    context::{
        artifact_loader::RepositoryContextLoader,
        budget::{
            estimate_tokens, limit_recent_messages_for_plan, resolve_context_budget,
            resolve_context_budget_plan,
        },
        contributors::{ContextContribution, ContextContributor},
        policies::{default_contributors, ordered_contributors, select_context_strategy},
        retrieval::ContextRetriever,
        types::{
            BuildContextInput, BuiltContext, ContextArtifacts, ContextBudgetDiagnostics,
            ContextCandidateBudgetDecision, ContextCandidateBudgetRecord, ContextCandidateKind,
            ContextMessage, ContextMessageRole, ContextSourceKind,
        },
    },
};

#[derive(Debug, Clone, Default)]
pub struct ContextManager {
    config: Option<ContextSection>,
    artifact_loader: Option<RepositoryContextLoader>,
}

impl ContextManager {
    pub fn new(config: Option<ContextSection>) -> Self {
        Self {
            config,
            artifact_loader: None,
        }
    }

    pub fn with_repository(
        config: Option<ContextSection>,
        repository: crate::storage::repositories::context_artifacts::ContextArtifactsRepository,
    ) -> Self {
        Self {
            config,
            artifact_loader: Some(RepositoryContextLoader::new(repository)),
        }
    }

    pub fn build_context(&self, input: BuildContextInput) -> BuiltContext {
        self.build_context_with_contributors(input, default_contributors())
    }

    pub async fn build_context_with_repositories(
        &self,
        input: BuildContextInput,
    ) -> Result<BuiltContext, crate::error::ServiceError> {
        self.build_context_with_repositories_and_strategy(input, None)
            .await
    }

    pub async fn build_context_with_repositories_and_strategy(
        &self,
        input: BuildContextInput,
        strategy_decision: Option<&crate::capabilities::ExecutionStrategyDecision>,
    ) -> Result<BuiltContext, crate::error::ServiceError> {
        let Some(loader) = &self.artifact_loader else {
            return Ok(self.build_context_with_contributors_and_strategy(
                input,
                default_contributors(),
                strategy_decision,
            ));
        };

        let (input, loader_warnings) = loader.enrich_input(input).await?;
        let retrieval_result = ContextRetriever::new(loader.pool())
            .retrieve_with_strategy(&input, strategy_decision)
            .await?;
        let retrieval_warnings = retrieval_result.warnings.clone();
        let mut contributors = default_contributors();
        if !retrieval_result.selected.is_empty() {
            contributors.push(Box::new(
                crate::context::contributors::RetrievedMemoryContributor::new(retrieval_result),
            ));
        }
        let mut built = self.build_context_with_contributors_and_strategy(
            input,
            contributors,
            strategy_decision,
        );
        built
            .warnings
            .extend(loader_warnings.into_iter().map(|warning| warning.code));
        built.warnings.extend(retrieval_warnings);
        Ok(built)
    }

    pub fn build_context_with_contributors(
        &self,
        input: BuildContextInput,
        contributors: Vec<Box<dyn ContextContributor>>,
    ) -> BuiltContext {
        self.build_context_with_contributors_and_strategy(input, contributors, None)
    }

    pub fn build_context_with_contributors_and_strategy(
        &self,
        input: BuildContextInput,
        contributors: Vec<Box<dyn ContextContributor>>,
        strategy_decision: Option<&crate::capabilities::ExecutionStrategyDecision>,
    ) -> BuiltContext {
        let strategy = select_context_strategy(&input);
        let mut budget = resolve_context_budget(input.resolved_num_ctx, self.config.as_ref());
        let budget_plan = resolve_context_budget_plan(&input, &budget, strategy_decision);
        let mut input = input;
        input.recent_messages =
            limit_recent_messages_for_plan(&input.recent_messages, &budget_plan);
        let mut messages = vec![ContextMessage::new(
            ContextMessageRole::System,
            "Use the provided Loom context, explicit references, and recent conversation to answer the current user question. If the current question omits the topic, infer it from the recent conversation when available. Write valid Markdown only: headings must include heading text, and never emit orphan separators or markers such as `--- ###` or trailing `###`. Never include raw model thinking/internal monologue in context or output.",
            Some(ContextSourceKind::SystemPolicy),
            None,
        )];
        let mut warnings = budget_plan.warnings.clone();
        let mut artifacts = ContextArtifacts::default();

        if let Some(checkpoint) = &input.checkpoint {
            artifacts.checkpoint_id = Some(checkpoint.checkpoint_id.clone());
        }
        if let Some(origin) = &input.weft_origin {
            artifacts.weft_origin_context_id = Some(origin.context_id.clone());
            artifacts.origin_capsule_id = origin.origin_capsule_id.clone();
        }
        for attached in &input.attached_references {
            if let Some(capsule) = &attached.response_capsule {
                artifacts
                    .response_capsule_ids
                    .push(capsule.capsule_id.clone());
                artifacts
                    .reference_capsule_ids
                    .push(capsule.capsule_id.clone());
            }
        }

        let context_limit = budget_plan.max_input_tokens;
        let mut estimated_used = estimate_messages(&messages);
        let mut diagnostics = ContextBudgetDiagnostics {
            total_estimated_input_tokens: budget.max_context,
            reserved_output_tokens: budget_plan.reserved_output_tokens,
            remaining_input_budget: context_limit,
            soft_trim_threshold: budget_plan.soft_trim_threshold,
            hard_trim_threshold: budget_plan.hard_trim_threshold,
            warnings: budget_plan.warnings.clone(),
            reasons: vec![
                "response_reserve_not_available_to_input_context".to_string(),
                "current_prompt_protected".to_string(),
            ],
            ..ContextBudgetDiagnostics::default()
        };

        for contributor in ordered_contributors(contributors) {
            if !contributor.can_contribute(&input) {
                continue;
            }

            for contribution in contributor.contribute(&input) {
                let next_estimate = estimated_used.saturating_add(contribution.estimated_tokens);
                let candidate_kind = candidate_kind_for_contribution(&contribution);
                let content = if next_estimate > context_limit {
                    let remaining_tokens = context_limit.saturating_sub(estimated_used);
                    if remaining_tokens == 0 {
                        warnings.push(format!(
                            "budget_truncated: skipped '{}' because context budget was full.",
                            contribution.title
                        ));
                        diagnostics.record_candidate(ContextCandidateBudgetRecord {
                            candidate_kind,
                            candidate_id: Some(contribution.source_id),
                            estimated_tokens: contribution.estimated_tokens,
                            decision: ContextCandidateBudgetDecision::Dropped,
                            reason: "overflow_after_hard_trim".to_string(),
                            priority: contributor.priority(),
                        });
                        continue;
                    }
                    warnings.push(format!(
                        "budget_truncated: truncated '{}' to fit the context budget.",
                        contribution.title
                    ));
                    diagnostics.record_candidate(ContextCandidateBudgetRecord {
                        candidate_kind: candidate_kind.clone(),
                        candidate_id: Some(contribution.source_id.clone()),
                        estimated_tokens: contribution.estimated_tokens,
                        decision: ContextCandidateBudgetDecision::Downgraded,
                        reason: if candidate_kind == ContextCandidateKind::CodeBlock {
                            "code_summary_due_to_budget".to_string()
                        } else {
                            "soft_trim_truncated_to_remaining_budget".to_string()
                        },
                        priority: contributor.priority(),
                    });
                    truncate_to_token_estimate(&contribution.content, remaining_tokens)
                } else {
                    let decision = if next_estimate > budget_plan.soft_trim_threshold
                        && is_optional_old_context(&candidate_kind)
                    {
                        ContextCandidateBudgetDecision::Summarized
                    } else {
                        ContextCandidateBudgetDecision::Selected
                    };
                    let reason =
                        candidate_reason(&candidate_kind, &decision, next_estimate, &budget_plan);
                    diagnostics.record_candidate(ContextCandidateBudgetRecord {
                        candidate_kind,
                        candidate_id: Some(contribution.source_id.clone()),
                        estimated_tokens: contribution.estimated_tokens,
                        decision,
                        reason,
                        priority: contributor.priority(),
                    });
                    contribution.content
                };

                messages.push(ContextMessage::new(
                    ContextMessageRole::System,
                    format!("{}:\n{}", contribution.title, content),
                    Some(contribution.source_kind),
                    Some(contribution.source_id),
                ));
                estimated_used = estimate_messages(&messages);
            }
        }

        let user_prompt_tokens = estimate_tokens(&input.user_prompt);
        if estimated_used.saturating_add(user_prompt_tokens) > budget.max_context {
            warnings
                .push("User prompt approaches or exceeds the resolved context budget.".to_string());
        }
        diagnostics.record_candidate(ContextCandidateBudgetRecord {
            candidate_kind: ContextCandidateKind::CurrentPrompt,
            candidate_id: input.current_head_response_id.clone(),
            estimated_tokens: user_prompt_tokens,
            decision: ContextCandidateBudgetDecision::Selected,
            reason: "current_prompt_protected".to_string(),
            priority: 0,
        });
        messages.push(ContextMessage::new(
            ContextMessageRole::User,
            input.user_prompt,
            Some(ContextSourceKind::UserPrompt),
            input.current_head_response_id,
        ));
        estimated_used = estimate_messages(&messages);
        budget.estimated_used = estimated_used.min(budget.max_context);
        diagnostics.selected_token_estimate = budget.estimated_used;
        diagnostics.remaining_input_budget = context_limit.saturating_sub(budget.estimated_used);
        diagnostics.warnings = warnings.clone();

        BuiltContext {
            messages,
            artifacts,
            budget,
            budget_plan,
            budget_diagnostics: diagnostics,
            warnings,
            strategy,
        }
    }
}

fn estimate_messages(messages: &[ContextMessage]) -> usize {
    messages
        .iter()
        .map(|message| estimate_tokens(&message.content))
        .sum()
}

impl ContextBudgetDiagnostics {
    fn record_candidate(&mut self, record: ContextCandidateBudgetRecord) {
        match record.candidate_kind {
            ContextCandidateKind::CurrentPrompt => {}
            ContextCandidateKind::RecentTurn => {
                self.recent_turns_estimate = self
                    .recent_turns_estimate
                    .saturating_add(record.estimated_tokens);
            }
            ContextCandidateKind::Reference => {
                self.references_estimate = self
                    .references_estimate
                    .saturating_add(record.estimated_tokens);
            }
            ContextCandidateKind::Capsule => {
                self.capsules_estimate = self
                    .capsules_estimate
                    .saturating_add(record.estimated_tokens);
            }
            ContextCandidateKind::Checkpoint => {
                self.checkpoints_estimate = self
                    .checkpoints_estimate
                    .saturating_add(record.estimated_tokens);
            }
            ContextCandidateKind::CodeBlock => {
                self.code_blocks_estimate = self
                    .code_blocks_estimate
                    .saturating_add(record.estimated_tokens);
            }
            ContextCandidateKind::RetrievedMemory => {
                self.retrieval_estimate = self
                    .retrieval_estimate
                    .saturating_add(record.estimated_tokens);
            }
            ContextCandidateKind::WeftOrigin => {
                self.weft_origin_estimate = self
                    .weft_origin_estimate
                    .saturating_add(record.estimated_tokens);
            }
        }
        match record.decision {
            ContextCandidateBudgetDecision::Selected
            | ContextCandidateBudgetDecision::Summarized
            | ContextCandidateBudgetDecision::Downgraded => {
                self.selected_candidate_count = self.selected_candidate_count.saturating_add(1);
            }
            ContextCandidateBudgetDecision::Dropped => {
                self.dropped_candidate_count = self.dropped_candidate_count.saturating_add(1);
                self.overflow_candidate_count = self.overflow_candidate_count.saturating_add(1);
            }
            ContextCandidateBudgetDecision::Overflow => {
                self.overflow_candidate_count = self.overflow_candidate_count.saturating_add(1);
            }
        }
        if matches!(
            record.decision,
            ContextCandidateBudgetDecision::Dropped | ContextCandidateBudgetDecision::Overflow
        ) {
            self.reasons.push(record.reason.clone());
        }
        self.candidate_records.push(record);
    }
}

fn candidate_kind_for_contribution(contribution: &ContextContribution) -> ContextCandidateKind {
    if contribution
        .metadata
        .get("candidateKind")
        .and_then(|value| value.as_str())
        == Some("code_block")
    {
        return ContextCandidateKind::CodeBlock;
    }
    match contribution.source_kind {
        ContextSourceKind::RecentTurn => ContextCandidateKind::RecentTurn,
        ContextSourceKind::Reference => ContextCandidateKind::Reference,
        ContextSourceKind::ResponseCapsule => ContextCandidateKind::Capsule,
        ContextSourceKind::LoomCheckpoint => ContextCandidateKind::Checkpoint,
        ContextSourceKind::WeftOrigin => ContextCandidateKind::WeftOrigin,
        ContextSourceKind::RetrievedMemory => ContextCandidateKind::RetrievedMemory,
        ContextSourceKind::SystemPolicy | ContextSourceKind::UserPrompt => {
            ContextCandidateKind::RetrievedMemory
        }
    }
}

fn is_optional_old_context(kind: &ContextCandidateKind) -> bool {
    matches!(
        kind,
        ContextCandidateKind::Capsule
            | ContextCandidateKind::Checkpoint
            | ContextCandidateKind::CodeBlock
            | ContextCandidateKind::RetrievedMemory
    )
}

fn candidate_reason(
    kind: &ContextCandidateKind,
    decision: &ContextCandidateBudgetDecision,
    next_estimate: usize,
    plan: &crate::context::types::ContextBudgetPlan,
) -> String {
    match (kind, decision) {
        (ContextCandidateKind::RecentTurn, _) => {
            "immediate_previous_pair_or_recent_turn".to_string()
        }
        (ContextCandidateKind::Reference, _) => "explicit_reference".to_string(),
        (ContextCandidateKind::CurrentPrompt, _) => "current_prompt_protected".to_string(),
        (ContextCandidateKind::WeftOrigin, _) => "weft_origin_background_context".to_string(),
        (ContextCandidateKind::CodeBlock, ContextCandidateBudgetDecision::Summarized)
        | (ContextCandidateKind::CodeBlock, ContextCandidateBudgetDecision::Downgraded) => {
            "code_summary_due_to_budget".to_string()
        }
        (_, ContextCandidateBudgetDecision::Summarized)
            if next_estimate > plan.soft_trim_threshold =>
        {
            "soft_trim_threshold_reached".to_string()
        }
        _ => "selected_within_budget".to_string(),
    }
}

fn truncate_to_token_estimate(value: &str, max_tokens: usize) -> String {
    let max_chars = max_tokens.saturating_mul(4);
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let mut truncated: String = value.chars().take(max_chars.saturating_sub(1)).collect();
    truncated.push('…');
    truncated
}

#[cfg(test)]
pub(crate) mod tests {
    use super::ContextManager;
    use crate::{
        context::contributors::{ContextContribution, ContextContributor},
        context::types::{
            ArtifactStatus, AttachedReferenceInput, BuildContextInput,
            ContextCandidateBudgetDecision, ContextCandidateKind, ContextMessage,
            ContextMessageRole, ContextSource, ContextSourceKind, LoomCheckpointSummary,
            ReferenceContext, ResponseMode, WeftOriginContext,
        },
        storage::{
            db::test_database,
            repositories::context_artifacts::{
                ContextArtifactsRepository, UpsertLoomCheckpoint, UpsertResponseCapsule,
                UpsertWeftOriginContext,
            },
        },
    };
    use std::collections::BTreeMap;

    #[test]
    fn short_context_builds_system_and_user_prompt() {
        let manager = ContextManager::default();
        let built = manager.build_context(minimal_input("Explain event sourcing."));

        assert_eq!(built.messages.len(), 2);
        assert!(built.messages[0]
            .content
            .contains("Never include raw model thinking"));
        assert_eq!(built.messages[1].content, "Explain event sourcing.");
    }

    #[test]
    fn attached_reference_contribution_appears_in_built_context() {
        let manager = ContextManager::default();
        let built = manager.build_context(BuildContextInput {
            attached_references: vec![sample_reference("ref-1", "Selected fragment about events")],
            ..minimal_input("Use the reference.")
        });

        assert!(built
            .messages
            .iter()
            .any(|message| message.content.contains("Selected fragment about events")));
    }

    #[test]
    fn attached_reference_is_background_context_not_visible_user_prompt() {
        let manager = ContextManager::default();
        let built = manager.build_context(BuildContextInput {
            attached_references: vec![sample_reference("ref-1", "Selected fragment about MCP")],
            ..minimal_input("Explain this selected part.")
        });

        let reference_message = built
            .messages
            .iter()
            .find(|message| message.content.contains("Selected fragment about MCP"))
            .expect("reference contribution");
        assert_eq!(
            reference_message.role,
            crate::context::types::ContextMessageRole::System
        );
        assert_eq!(
            reference_message.source_kind,
            Some(crate::context::types::ContextSourceKind::Reference)
        );
        let visible_user_messages = built
            .messages
            .iter()
            .filter(|message| message.role == crate::context::types::ContextMessageRole::User)
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>();
        assert_eq!(visible_user_messages, vec!["Explain this selected part."]);
    }

    #[test]
    fn budget_does_not_exceed_max_context_in_simple_case() {
        let manager = ContextManager::default();
        let built = manager.build_context(BuildContextInput {
            resolved_num_ctx: 1_024,
            ..minimal_input("Short prompt")
        });

        assert!(built.budget.estimated_used <= built.budget.max_context);
    }

    #[test]
    fn diagnostics_include_response_reserve_and_remaining_budget() {
        let built = ContextManager::default().build_context(minimal_input("hello"));

        assert_eq!(
            built.budget_diagnostics.reserved_output_tokens,
            built.budget_plan.reserved_output_tokens
        );
        assert_eq!(
            built.budget_diagnostics.soft_trim_threshold,
            built.budget_plan.soft_trim_threshold
        );
        assert_eq!(
            built.budget_diagnostics.hard_trim_threshold,
            built.budget_plan.hard_trim_threshold
        );
        assert!(built.budget_diagnostics.remaining_input_budget > 0);
        assert!(built
            .budget_diagnostics
            .reasons
            .contains(&"response_reserve_not_available_to_input_context".to_string()));
    }

    #[test]
    fn diagnostics_soft_trim_downgrades_before_hard_trim_drops() {
        let manager = ContextManager::default();
        let built = manager.build_context_with_contributors(
            BuildContextInput {
                resolved_num_ctx: 512,
                ..minimal_input("Keep the current prompt.")
            },
            vec![Box::new(StaticContributor::new(
                ContextSourceKind::RetrievedMemory,
                60,
                vec![
                    ("old-large", "x".repeat(1_200)),
                    ("old-overflow", "y".repeat(1_200)),
                ],
            ))],
        );

        assert!(built
            .budget_diagnostics
            .candidate_records
            .iter()
            .any(|record| {
                record.decision == ContextCandidateBudgetDecision::Downgraded
                    && record.reason == "soft_trim_truncated_to_remaining_budget"
            }));
        assert!(built.budget_diagnostics.dropped_candidate_count > 0);
        assert!(built.budget_diagnostics.overflow_candidate_count > 0);
        assert!(!serde_json::to_string(&built.budget_diagnostics)
            .expect("diagnostics json")
            .contains(&"y".repeat(64)));
        assert!(built
            .messages
            .iter()
            .any(|message| message.content == "Keep the current prompt."));
    }

    #[test]
    fn diagnostics_protect_immediate_pair_and_current_prompt() {
        let manager = ContextManager::default();
        let built = manager.build_context(BuildContextInput {
            resolved_num_ctx: 512,
            recent_messages: vec![
                context_message(ContextMessageRole::User, "previous user"),
                context_message(ContextMessageRole::Assistant, "previous assistant"),
            ],
            ..minimal_input("Bunu tablo yapar mısın?")
        });

        assert!(built
            .messages
            .iter()
            .any(|message| message.content.contains("previous user")));
        assert!(built
            .messages
            .iter()
            .any(|message| message.content.contains("previous assistant")));
        assert!(built
            .budget_diagnostics
            .candidate_records
            .iter()
            .any(|record| {
                record.candidate_kind == ContextCandidateKind::RecentTurn
                    && record.reason == "immediate_previous_pair_or_recent_turn"
            }));
        assert!(built
            .budget_diagnostics
            .candidate_records
            .iter()
            .any(|record| {
                record.candidate_kind == ContextCandidateKind::CurrentPrompt
                    && record.reason == "current_prompt_protected"
            }));
    }

    #[test]
    fn diagnostics_select_explicit_reference_before_retrieved_memory() {
        let manager = ContextManager::default();
        let built = manager.build_context_with_contributors(
            BuildContextInput {
                resolved_num_ctx: 512,
                attached_references: vec![sample_reference("ref-1", "Selected Reference text")],
                ..minimal_input("Use the reference.")
            },
            vec![
                Box::new(crate::context::contributors::AttachedReferencesContributor),
                Box::new(StaticContributor::new(
                    ContextSourceKind::RetrievedMemory,
                    60,
                    vec![("retrieved-1", "z".repeat(1_200))],
                )),
            ],
        );

        let reference_index = built
            .budget_diagnostics
            .candidate_records
            .iter()
            .position(|record| record.candidate_kind == ContextCandidateKind::Reference)
            .expect("reference record");
        let retrieval_index = built
            .budget_diagnostics
            .candidate_records
            .iter()
            .position(|record| {
                record.candidate_kind == ContextCandidateKind::RetrievedMemory
                    && record.candidate_id.as_deref() == Some("retrieved-1")
            })
            .expect("retrieval record");

        assert!(reference_index < retrieval_index);
        assert_eq!(
            built.budget_diagnostics.candidate_records[reference_index].reason,
            "explicit_reference"
        );
    }

    #[test]
    fn diagnostics_track_code_block_summary_when_budget_is_tight() {
        let manager = ContextManager::default();
        let built = manager.build_context_with_contributors(
            BuildContextInput {
                resolved_num_ctx: 512,
                ..minimal_input("Bu kod neden hata veriyor?")
            },
            vec![Box::new(StaticContributor::new_with_metadata(
                ContextSourceKind::RetrievedMemory,
                60,
                vec![(
                    "code-1",
                    "fn main() {\n    println!(\"hi\");\n}\n".repeat(80),
                )],
                ("candidateKind", "code_block"),
            ))],
        );

        let record = built
            .budget_diagnostics
            .candidate_records
            .iter()
            .find(|record| record.candidate_kind == ContextCandidateKind::CodeBlock)
            .expect("code block record");
        assert!(matches!(
            record.decision,
            ContextCandidateBudgetDecision::Downgraded
                | ContextCandidateBudgetDecision::Dropped
                | ContextCandidateBudgetDecision::Summarized
        ));
        assert_eq!(record.reason, "code_summary_due_to_budget");
        assert!(built.budget_diagnostics.code_blocks_estimate > 0);
    }

    #[test]
    fn weft_origin_policy_adds_only_immediate_origin_context() {
        let manager = ContextManager::default();
        let built = manager.build_context(BuildContextInput {
            source: ContextSource::Weft,
            weft_origin: Some(sample_weft_origin()),
            ..minimal_input("Continue this Weft.")
        });

        assert!(built
            .messages
            .iter()
            .any(|message| message.content.contains("Immediate origin summary")));
        let origin_message = built
            .messages
            .iter()
            .find(|message| message.content.contains("Immediate origin summary"))
            .expect("origin message");
        assert_eq!(
            origin_message.role,
            crate::context::types::ContextMessageRole::System
        );
        assert_eq!(
            origin_message.source_kind,
            Some(crate::context::types::ContextSourceKind::WeftOrigin)
        );
        assert_eq!(
            built.artifacts.weft_origin_context_id.as_deref(),
            Some("weft-origin-1")
        );
        assert_eq!(
            built.artifacts.origin_capsule_id.as_deref(),
            Some("capsule-1")
        );
    }

    #[test]
    fn raw_thinking_strings_are_not_type_fields_or_output_keys() {
        let built = ContextManager::default().build_context(minimal_input("hello"));
        let serialized = serde_json::to_string(&built).expect("serialize built context");
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn repository_context_loads_response_capsule_for_reference() {
        let repository = test_repository().await;
        insert_capsule(
            &repository,
            "capsule-1",
            "response-1",
            "ready",
            "Persisted capsule summary",
        )
        .await;
        let manager = ContextManager::with_repository(None, repository);

        let built = manager
            .build_context_with_repositories(BuildContextInput {
                attached_references: vec![sample_reference("ref-1", "fallback text")],
                ..minimal_input("Use the attached response.")
            })
            .await
            .expect("build context");

        assert!(built
            .messages
            .iter()
            .any(|message| message.content.contains("Persisted capsule summary")));
        assert_eq!(built.artifacts.response_capsule_ids, vec!["capsule-1"]);
    }

    #[tokio::test]
    async fn repository_context_warns_on_missing_response_capsule() {
        let repository = test_repository().await;
        let manager = ContextManager::with_repository(None, repository);

        let built = manager
            .build_context_with_repositories(BuildContextInput {
                attached_references: vec![sample_reference("ref-1", "fallback text")],
                ..minimal_input("Use the attached response.")
            })
            .await
            .expect("build context");

        assert!(built
            .warnings
            .iter()
            .any(|warning| warning == "missing_response_capsule"));
    }

    #[tokio::test]
    async fn repository_context_loads_latest_checkpoint() {
        let repository = test_repository().await;
        insert_checkpoint(
            &repository,
            "checkpoint-old",
            "Old checkpoint summary",
            "2026-05-08T00:00:01Z",
            "ready",
        )
        .await;
        insert_checkpoint(
            &repository,
            "checkpoint-new",
            "Latest checkpoint summary",
            "2026-05-08T00:00:02Z",
            "ready",
        )
        .await;
        let manager = ContextManager::with_repository(None, repository);

        let built = manager
            .build_context_with_repositories(minimal_input("Continue."))
            .await
            .expect("build context");

        assert!(built
            .messages
            .iter()
            .any(|message| message.content.contains("Latest checkpoint summary")));
        assert_eq!(
            built.artifacts.checkpoint_id.as_deref(),
            Some("checkpoint-new")
        );
        assert!(!built
            .messages
            .iter()
            .any(|message| message.content.contains("Old checkpoint summary")));
    }

    #[tokio::test]
    async fn repository_context_loads_immediate_weft_origin() {
        let repository = test_repository().await;
        insert_capsule(
            &repository,
            "capsule-origin",
            "origin-response",
            "ready",
            "Origin capsule summary",
        )
        .await;
        repository
            .upsert_weft_origin_context(&UpsertWeftOriginContext {
                context_id: "origin-1".to_string(),
                weft_loom_id: "loom-1".to_string(),
                origin_loom_id: "origin-loom".to_string(),
                origin_response_id: "origin-response".to_string(),
                origin_capsule_id: Some("capsule-origin".to_string()),
                origin_summary: Some("Repository Weft origin summary".to_string()),
                source_hash: None,
                status: "ready".to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
            })
            .await
            .expect("insert origin");
        let manager = ContextManager::with_repository(None, repository);

        let built = manager
            .build_context_with_repositories(BuildContextInput {
                source: ContextSource::Weft,
                ..minimal_input("Continue Weft.")
            })
            .await
            .expect("build context");

        assert!(built
            .messages
            .iter()
            .any(|message| message.content.contains("Repository Weft origin summary")));
        assert!(built
            .messages
            .iter()
            .any(|message| message.content.contains("Origin capsule summary")));
        let origin_message = built
            .messages
            .iter()
            .find(|message| message.content.contains("Repository Weft origin summary"))
            .expect("origin message");
        assert_eq!(
            origin_message.role,
            crate::context::types::ContextMessageRole::System
        );
        assert_eq!(
            origin_message.source_kind,
            Some(crate::context::types::ContextSourceKind::WeftOrigin)
        );
        assert_eq!(
            built.artifacts.weft_origin_context_id.as_deref(),
            Some("origin-1")
        );
        assert_eq!(
            built.artifacts.origin_capsule_id.as_deref(),
            Some("capsule-origin")
        );
        let visible_user_messages = built
            .messages
            .iter()
            .filter(|message| message.role == crate::context::types::ContextMessageRole::User)
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>();
        assert_eq!(visible_user_messages, vec!["Continue Weft."]);
        assert!(!visible_user_messages
            .iter()
            .any(|message| message.contains("Repository Weft origin summary")));
    }

    #[tokio::test]
    async fn repository_context_missing_weft_origin_warns_without_failing() {
        let repository = test_repository().await;
        let manager = ContextManager::with_repository(None, repository);

        let built = manager
            .build_context_with_repositories(BuildContextInput {
                source: ContextSource::Weft,
                ..minimal_input("Continue Weft.")
            })
            .await
            .expect("build context");

        assert!(built
            .warnings
            .iter()
            .any(|warning| warning == "missing_weft_origin_context"));
        assert!(built.artifacts.weft_origin_context_id.is_none());
        assert!(built
            .messages
            .iter()
            .any(|message| message.content == "Continue Weft."));
    }

    #[tokio::test]
    async fn repository_context_does_not_traverse_origin_chain() {
        let repository = test_repository().await;
        repository
            .upsert_weft_origin_context(&UpsertWeftOriginContext {
                context_id: "origin-1".to_string(),
                weft_loom_id: "loom-1".to_string(),
                origin_loom_id: "origin-loom".to_string(),
                origin_response_id: "origin-response".to_string(),
                origin_capsule_id: None,
                origin_summary: Some("Immediate origin only".to_string()),
                source_hash: None,
                status: "ready".to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
            })
            .await
            .expect("insert immediate origin");
        repository
            .upsert_weft_origin_context(&UpsertWeftOriginContext {
                context_id: "origin-parent".to_string(),
                weft_loom_id: "origin-loom".to_string(),
                origin_loom_id: "grandparent-loom".to_string(),
                origin_response_id: "grandparent-response".to_string(),
                origin_capsule_id: None,
                origin_summary: Some("Grandparent origin should not appear".to_string()),
                source_hash: None,
                status: "ready".to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
            })
            .await
            .expect("insert parent origin");
        let manager = ContextManager::with_repository(None, repository);

        let built = manager
            .build_context_with_repositories(BuildContextInput {
                source: ContextSource::Weft,
                ..minimal_input("Continue Weft.")
            })
            .await
            .expect("build context");

        assert!(built
            .messages
            .iter()
            .any(|message| message.content.contains("Immediate origin only")));
        assert!(!built.messages.iter().any(|message| message
            .content
            .contains("Grandparent origin should not appear")));
    }

    #[tokio::test]
    async fn repository_context_truncates_large_artifact_to_budget() {
        let repository = test_repository().await;
        insert_capsule(
            &repository,
            "capsule-1",
            "response-1",
            "ready",
            &"x".repeat(20_000),
        )
        .await;
        let manager = ContextManager::with_repository(None, repository);

        let built = manager
            .build_context_with_repositories(BuildContextInput {
                resolved_num_ctx: 512,
                attached_references: vec![sample_reference("ref-1", "fallback text")],
                ..minimal_input("Use compact context.")
            })
            .await
            .expect("build context");

        assert!(built.budget.estimated_used <= built.budget.max_context);
        assert!(built
            .warnings
            .iter()
            .any(|warning| warning.contains("budget_truncated")));
    }

    #[tokio::test]
    async fn repository_context_skips_failed_or_pending_artifacts() {
        let repository = test_repository().await;
        insert_capsule(
            &repository,
            "capsule-1",
            "response-1",
            "failed",
            "Do not use",
        )
        .await;
        let manager = ContextManager::with_repository(None, repository);

        let built = manager
            .build_context_with_repositories(BuildContextInput {
                attached_references: vec![sample_reference("ref-1", "fallback text")],
                ..minimal_input("Use reference.")
            })
            .await
            .expect("build context");

        assert!(!built
            .messages
            .iter()
            .any(|message| message.content.contains("Do not use")));
        assert!(built
            .warnings
            .iter()
            .any(|warning| warning == "artifact_failed_status"));
    }

    #[tokio::test]
    async fn repository_context_rejects_forbidden_raw_thinking_json() {
        let repository = test_repository().await;
        let error = repository
            .upsert_response_capsule(&UpsertResponseCapsule {
                capsule_id: "capsule-1".to_string(),
                response_id: "response-1".to_string(),
                loom_id: "loom-1".to_string(),
                response_code: None,
                title: Some("Capsule".to_string()),
                summary: Some("Safe summary".to_string()),
                key_points_json: Some("{\"raw_thinking\":\"secret\"}".to_string()),
                keywords_json: None,
                entities_json: None,
                code_blocks_json: None,
                canonical_uri: None,
                source_hash: None,
                generator: None,
                status: "ready".to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
            })
            .await
            .expect_err("raw thinking should be rejected");

        assert!(error.to_string().contains("raw_thinking"));
    }

    pub(crate) fn minimal_input(prompt: &str) -> BuildContextInput {
        BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: None,
            user_prompt: prompt.to_string(),
            attached_references: Vec::new(),
            response_mode: ResponseMode::Auto,
            resolved_num_ctx: 2_048,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            recent_messages: Vec::new(),
        }
    }

    pub(crate) fn sample_weft_origin() -> WeftOriginContext {
        WeftOriginContext {
            context_id: "weft-origin-1".to_string(),
            weft_loom_id: "weft-1".to_string(),
            origin_loom_id: "loom-1".to_string(),
            origin_response_id: "response-1".to_string(),
            origin_capsule_id: Some("capsule-1".to_string()),
            origin_summary: "Immediate origin summary".to_string(),
            source_hash: None,
            status: ArtifactStatus::Ready,
        }
    }

    #[allow(dead_code)]
    pub(crate) fn sample_checkpoint() -> LoomCheckpointSummary {
        LoomCheckpointSummary {
            checkpoint_id: "checkpoint-1".to_string(),
            loom_id: "loom-1".to_string(),
            up_to_response_id: Some("response-1".to_string()),
            summary: "Checkpoint summary".to_string(),
            decisions: Vec::new(),
            constraints: Vec::new(),
            open_questions: Vec::new(),
            entities: Vec::new(),
            wefts: Vec::new(),
            references: Vec::new(),
            source_hash: None,
            status: ArtifactStatus::Ready,
        }
    }

    fn sample_reference(reference_id: &str, selected_text: &str) -> AttachedReferenceInput {
        AttachedReferenceInput {
            reference: ReferenceContext {
                reference_id: reference_id.to_string(),
                target_kind: "response_fragment".to_string(),
                target_id: Some("response-1".to_string()),
                target_uri: Some("loom://response/response-1".to_string()),
                label: Some("Reference".to_string()),
                selected_text: Some(selected_text.to_string()),
                capsule_summary: None,
            },
            response_capsule: None,
        }
    }

    fn context_message(role: ContextMessageRole, content: &str) -> ContextMessage {
        ContextMessage::new(
            role,
            content.to_string(),
            Some(ContextSourceKind::RecentTurn),
            None,
        )
    }

    struct StaticContributor {
        source_kind: ContextSourceKind,
        priority: i32,
        contributions: Vec<(String, String)>,
        metadata: Option<(String, String)>,
    }

    impl StaticContributor {
        fn new(
            source_kind: ContextSourceKind,
            priority: i32,
            contributions: Vec<(&str, String)>,
        ) -> Self {
            Self {
                source_kind,
                priority,
                contributions: contributions
                    .into_iter()
                    .map(|(id, content)| (id.to_string(), content))
                    .collect(),
                metadata: None,
            }
        }

        fn new_with_metadata(
            source_kind: ContextSourceKind,
            priority: i32,
            contributions: Vec<(&str, String)>,
            metadata: (&str, &str),
        ) -> Self {
            Self {
                metadata: Some((metadata.0.to_string(), metadata.1.to_string())),
                ..Self::new(source_kind, priority, contributions)
            }
        }
    }

    impl ContextContributor for StaticContributor {
        fn id(&self) -> &'static str {
            "static_test"
        }

        fn label(&self) -> &'static str {
            "Static test"
        }

        fn priority(&self) -> i32 {
            self.priority
        }

        fn can_contribute(&self, _input: &BuildContextInput) -> bool {
            true
        }

        fn contribute(&self, _input: &BuildContextInput) -> Vec<ContextContribution> {
            self.contributions
                .iter()
                .map(|(source_id, content)| {
                    let mut metadata = BTreeMap::new();
                    if let Some((key, value)) = &self.metadata {
                        metadata.insert(key.clone(), serde_json::Value::String(value.clone()));
                    }
                    ContextContribution {
                        source_id: source_id.clone(),
                        title: source_id.clone(),
                        content: content.clone(),
                        estimated_tokens: crate::context::estimate_tokens(content),
                        source_kind: self.source_kind.clone(),
                        metadata,
                    }
                })
                .collect()
        }
    }

    async fn test_repository() -> ContextArtifactsRepository {
        let database = test_database().await;
        ContextArtifactsRepository::new(&database)
    }

    async fn insert_capsule(
        repository: &ContextArtifactsRepository,
        capsule_id: &str,
        response_id: &str,
        status: &str,
        summary: &str,
    ) {
        repository
            .upsert_response_capsule(&UpsertResponseCapsule {
                capsule_id: capsule_id.to_string(),
                response_id: response_id.to_string(),
                loom_id: "loom-1".to_string(),
                response_code: Some("R-TEST".to_string()),
                title: Some("Capsule".to_string()),
                summary: Some(summary.to_string()),
                key_points_json: Some("[\"point\"]".to_string()),
                keywords_json: None,
                entities_json: None,
                code_blocks_json: None,
                canonical_uri: None,
                source_hash: None,
                generator: Some("test".to_string()),
                status: status.to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: "2026-05-08T00:00:01Z".to_string(),
            })
            .await
            .expect("insert capsule");
    }

    async fn insert_checkpoint(
        repository: &ContextArtifactsRepository,
        checkpoint_id: &str,
        summary: &str,
        updated_at: &str,
        status: &str,
    ) {
        repository
            .upsert_loom_checkpoint(&UpsertLoomCheckpoint {
                checkpoint_id: checkpoint_id.to_string(),
                loom_id: "loom-1".to_string(),
                up_to_response_id: Some("response-1".to_string()),
                summary: summary.to_string(),
                decisions_json: Some("[]".to_string()),
                constraints_json: None,
                open_questions_json: None,
                entities_json: None,
                wefts_json: None,
                references_json: None,
                source_hash: None,
                status: status.to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
                updated_at: updated_at.to_string(),
            })
            .await
            .expect("insert checkpoint");
    }
}
