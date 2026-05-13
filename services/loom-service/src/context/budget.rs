use crate::{
    capabilities::strategy::{ExecutionStrategy, ExecutionStrategyDecision},
    config::ContextSection,
    context::types::{BuildContextInput, ContextBudget, ContextBudgetPlan, ResponseMode},
};

pub fn estimate_tokens(text: &str) -> usize {
    let chars = text.chars().count();
    chars.div_ceil(4).max(1)
}

pub fn resolve_context_budget(
    resolved_num_ctx: u32,
    config: Option<&ContextSection>,
) -> ContextBudget {
    let configured_max = config
        .map(|section| section.max_context_length as usize)
        .unwrap_or(8_192);
    let max_context = (resolved_num_ctx as usize).min(configured_max).max(512);
    let reserved_for_answer = (max_context / 4).clamp(256, 2_048);

    ContextBudget {
        max_context,
        estimated_used: 0,
        reserved_for_answer,
    }
}

pub fn budget_available_for_context(budget: &ContextBudget) -> usize {
    budget
        .max_context
        .saturating_sub(budget.reserved_for_answer)
}

pub fn resolve_context_budget_plan(
    input: &BuildContextInput,
    budget: &ContextBudget,
    strategy_decision: Option<&ExecutionStrategyDecision>,
) -> ContextBudgetPlan {
    let mut warnings = Vec::new();
    let is_quick =
        strategy_decision.is_some_and(|decision| decision.requested_mode.as_str() == "quick");
    let explicit_references = !input.attached_references.is_empty();
    let code_relevant =
        is_code_relevant_prompt(&input.user_prompt) || explicit_code_reference(input);
    let weft = input.source == crate::context::types::ContextSource::Weft;
    let mut reserved_output_tokens = strategy_decision
        .map(|decision| decision.max_output_tokens.max(0) as usize)
        .unwrap_or(budget.reserved_for_answer)
        .clamp(256, (budget.max_context / 2).max(256));
    if is_quick {
        reserved_output_tokens = reserved_output_tokens.min(768);
    }
    let max_input_tokens = budget
        .max_context
        .saturating_sub(reserved_output_tokens)
        .max(256);
    let soft_trim_threshold = soft_trim_threshold(max_input_tokens);
    let hard_trim_threshold = max_input_tokens;
    let strategy_source = strategy_decision
        .map(|decision| format!("capability_strategy:{}", decision.strategy.as_str()))
        .unwrap_or_else(|| "context_defaults".to_string());

    if is_quick {
        warnings.push("quick_mode_context_budget_is_minimal".to_string());
        return ContextBudgetPlan {
            max_input_tokens,
            reserved_output_tokens,
            soft_trim_threshold,
            hard_trim_threshold,
            recent_full_response_limit: 4,
            recent_full_token_budget: max_input_tokens / 3,
            capsule_token_budget: max_input_tokens / 10,
            checkpoint_token_budget: max_input_tokens / 10,
            reference_token_budget: if explicit_references {
                max_input_tokens / 4
            } else {
                max_input_tokens / 10
            },
            code_block_token_budget: 0,
            include_exact_code_blocks: false,
            allow_thinking: false,
            strategy_source,
            warnings,
        };
    }

    let profile = capability_profile(strategy_decision);
    let (recent_limit, capsule_ratio, checkpoint_ratio, code_ratio) = match profile {
        CapabilityContextProfile::Strong => (20, 4, 6, 4),
        CapabilityContextProfile::Medium => (10, 6, 8, 6),
        CapabilityContextProfile::Weak | CapabilityContextProfile::Unknown => (6, 10, 12, 10),
    };
    let mut recent_full_response_limit = recent_limit;
    if input.recent_messages.len() <= 2 {
        recent_full_response_limit = recent_full_response_limit.max(input.recent_messages.len());
    }
    let reference_token_budget = if explicit_references {
        (max_input_tokens / 3).max(512).min(max_input_tokens)
    } else {
        (max_input_tokens / 8).max(256).min(max_input_tokens)
    };
    let include_exact_code_blocks = code_relevant
        && !matches!(
            profile,
            CapabilityContextProfile::Weak | CapabilityContextProfile::Unknown
        );
    let code_block_token_budget = if include_exact_code_blocks {
        (max_input_tokens / code_ratio).max(384)
    } else if code_relevant {
        (max_input_tokens / 16).max(128)
    } else {
        0
    }
    .min(max_input_tokens);
    let capsule_token_budget = (max_input_tokens / capsule_ratio)
        .max(256)
        .min(max_input_tokens);
    let checkpoint_token_budget = (max_input_tokens / checkpoint_ratio)
        .max(if weft { 256 } else { 128 })
        .min(max_input_tokens);

    if matches!(
        profile,
        CapabilityContextProfile::Weak | CapabilityContextProfile::Unknown
    ) {
        warnings.push("conservative_context_budget".to_string());
    }
    if weft {
        warnings.push("weft_origin_context_budgeted_as_background".to_string());
    }

    ContextBudgetPlan {
        max_input_tokens,
        reserved_output_tokens,
        soft_trim_threshold,
        hard_trim_threshold,
        recent_full_response_limit,
        recent_full_token_budget: (max_input_tokens / 2).max(512).min(max_input_tokens),
        capsule_token_budget,
        checkpoint_token_budget,
        reference_token_budget,
        code_block_token_budget,
        include_exact_code_blocks,
        allow_thinking: input.response_mode == ResponseMode::Thinking
            && strategy_decision.is_some_and(|decision| decision.allow_deep_synthesis),
        strategy_source,
        warnings,
    }
}

fn soft_trim_threshold(max_input_tokens: usize) -> usize {
    ((max_input_tokens as f64) * 0.8).round() as usize
}

pub fn limit_recent_messages_for_plan<T: Clone>(
    messages: &[T],
    plan: &ContextBudgetPlan,
) -> Vec<T> {
    let limit = plan.recent_full_response_limit.max(2);
    if messages.len() <= limit {
        return messages.to_vec();
    }
    messages[messages.len() - limit..].to_vec()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CapabilityContextProfile {
    Strong,
    Medium,
    Weak,
    Unknown,
}

fn capability_profile(
    strategy_decision: Option<&ExecutionStrategyDecision>,
) -> CapabilityContextProfile {
    let Some(decision) = strategy_decision else {
        return CapabilityContextProfile::Unknown;
    };
    if decision.requested_mode == "quick"
        || matches!(decision.strategy, ExecutionStrategy::FallbackSafe)
    {
        return CapabilityContextProfile::Weak;
    }
    if decision.max_parallelism >= 2
        || decision.allow_parallel_drafts
        || decision.allow_deep_synthesis
        || decision.max_output_tokens >= 12_000
    {
        return CapabilityContextProfile::Strong;
    }
    if decision.max_output_tokens >= 6_000
        || matches!(
            decision.strategy,
            ExecutionStrategy::LongDirect
                | ExecutionStrategy::LongAutoContinue
                | ExecutionStrategy::SectionedSequential
        )
    {
        return CapabilityContextProfile::Medium;
    }
    CapabilityContextProfile::Weak
}

fn is_code_relevant_prompt(prompt: &str) -> bool {
    let prompt = prompt.to_lowercase();
    [
        "code",
        "kod",
        "bug",
        "debug",
        "hata",
        "error",
        "exception",
        "stack trace",
        "build",
        "function",
        "fonksiyon",
        "class",
        "method",
        "endpoint",
        "controller",
        "service",
        "repository",
        "implement",
        "implementation",
        "nasıl yazarım",
        "nasil yazarim",
        "örnek kod",
        "ornek kod",
        "refactor",
        "fix",
        "compile",
        "derle",
        "sorgu",
        "typescript",
        "javascript",
        "rust",
        "csharp",
        "c#",
        "sql",
        "bash",
        "json",
        "yaml",
        "snippet",
        "çalışmıyor",
        "calismiyor",
    ]
    .iter()
    .any(|needle| prompt.contains(needle))
        || prompt.contains("```")
}

fn explicit_code_reference(input: &BuildContextInput) -> bool {
    input.attached_references.iter().any(|attached| {
        let label = attached
            .reference
            .label
            .as_deref()
            .unwrap_or_default()
            .to_lowercase();
        let target_kind = attached.reference.target_kind.to_lowercase();
        target_kind.contains("code")
            || label.contains("code")
            || label.contains("kod")
            || attached
                .response_capsule
                .as_ref()
                .is_some_and(|capsule| !capsule.code_blocks.is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        budget_available_for_context, estimate_tokens, limit_recent_messages_for_plan,
        resolve_context_budget, resolve_context_budget_plan,
    };
    use crate::{
        capabilities::strategy::{ExecutionStrategy, ExecutionStrategyDecision},
        context::types::{
            AttachedReferenceInput, BuildContextInput, ContextMessage, ContextMessageRole,
            ContextSource, ReferenceContext, ResponseMode,
        },
    };

    #[test]
    fn token_estimation_uses_simple_char_heuristic() {
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
    }

    #[test]
    fn budget_reserves_answer_space() {
        let budget = resolve_context_budget(2_048, None);

        assert_eq!(budget.max_context, 2_048);
        assert!(budget.reserved_for_answer >= 256);
        assert!(budget_available_for_context(&budget) < budget.max_context);
    }

    #[test]
    fn strong_capability_plan_keeps_more_recent_responses() {
        let input = input("Explain the architecture in detail.");
        let budget = resolve_context_budget(16_384, None);
        let plan = resolve_context_budget_plan(
            &input,
            &budget,
            Some(&decision(
                ExecutionStrategy::Parallel2DraftSynthesize,
                16_384,
                2,
                true,
                "deep",
            )),
        );

        assert_eq!(plan.recent_full_response_limit, 20);
        assert!(plan.capsule_token_budget > 1_000);
    }

    #[test]
    fn medium_capability_plan_uses_moderate_recent_window() {
        let input = input("Explain event sourcing.");
        let budget = resolve_context_budget(8_192, None);
        let plan = resolve_context_budget_plan(
            &input,
            &budget,
            Some(&decision(
                ExecutionStrategy::SectionedSequential,
                8_192,
                1,
                false,
                "long",
            )),
        );

        assert_eq!(plan.recent_full_response_limit, 10);
        assert!(!plan.allow_thinking);
    }

    #[test]
    fn unknown_capability_plan_is_conservative() {
        let input = input("Explain event sourcing.");
        let budget = resolve_context_budget(4_096, None);
        let plan = resolve_context_budget_plan(&input, &budget, None);

        assert_eq!(plan.recent_full_response_limit, 6);
        assert!(!plan.include_exact_code_blocks);
        assert!(plan
            .warnings
            .contains(&"conservative_context_budget".to_string()));
    }

    #[test]
    fn recent_message_limit_preserves_immediate_pair() {
        let input = BuildContextInput {
            recent_messages: vec![
                message("old"),
                message("user previous"),
                message("assistant previous"),
            ],
            ..input("Bunu tablo yapar mısın?")
        };
        let budget = resolve_context_budget(2_048, None);
        let mut plan = resolve_context_budget_plan(&input, &budget, None);
        plan.recent_full_response_limit = 2;

        let limited = limit_recent_messages_for_plan(&input.recent_messages, &plan);

        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].content, "user previous");
        assert_eq!(limited[1].content, "assistant previous");
    }

    #[test]
    fn explicit_references_receive_priority_budget() {
        let input = BuildContextInput {
            attached_references: vec![reference("Selected fragment")],
            ..input("Use this reference.")
        };
        let budget = resolve_context_budget(8_192, None);
        let plan = resolve_context_budget_plan(&input, &budget, None);

        assert!(plan.reference_token_budget > plan.capsule_token_budget);
    }

    #[test]
    fn code_relevant_prompt_enables_exact_code_budget_on_capable_strategy() {
        let input = input("Bu Rust code neden compile etmiyor?");
        let budget = resolve_context_budget(16_384, None);
        let plan = resolve_context_budget_plan(
            &input,
            &budget,
            Some(&decision(
                ExecutionStrategy::LongDirect,
                8_192,
                1,
                false,
                "normal",
            )),
        );

        assert!(plan.include_exact_code_blocks);
        assert!(plan.code_block_token_budget > 0);
    }

    #[test]
    fn non_code_prompt_avoids_exact_code_block_budget() {
        let input = input("Event Sourcing avantajlarını anlat.");
        let budget = resolve_context_budget(16_384, None);
        let plan = resolve_context_budget_plan(
            &input,
            &budget,
            Some(&decision(
                ExecutionStrategy::LongDirect,
                8_192,
                1,
                false,
                "normal",
            )),
        );

        assert!(!plan.include_exact_code_blocks);
        assert_eq!(plan.code_block_token_budget, 0);
    }

    #[test]
    fn weft_plan_budgets_background_origin_without_visible_mutation() {
        let input = BuildContextInput {
            source: ContextSource::Weft,
            ..input("Continue this Weft.")
        };
        let budget = resolve_context_budget(8_192, None);
        let plan = resolve_context_budget_plan(&input, &budget, None);

        assert!(plan
            .warnings
            .contains(&"weft_origin_context_budgeted_as_background".to_string()));
        assert!(plan.checkpoint_token_budget > 0);
    }

    #[test]
    fn quick_mode_is_small_and_no_thinking() {
        let input = BuildContextInput {
            response_mode: ResponseMode::Thinking,
            ..input("Quick definition")
        };
        let budget = resolve_context_budget(8_192, None);
        let plan = resolve_context_budget_plan(
            &input,
            &budget,
            Some(&decision(
                ExecutionStrategy::ShortDirect,
                768,
                1,
                false,
                "quick",
            )),
        );

        assert_eq!(plan.recent_full_response_limit, 4);
        assert_eq!(plan.code_block_token_budget, 0);
        assert!(!plan.allow_thinking);
    }

    #[test]
    fn budget_plan_serialization_has_no_forbidden_internal_reasoning_keys() {
        let budget = resolve_context_budget(4_096, None);
        let plan = resolve_context_budget_plan(&input("hello"), &budget, None);
        let serialized = serde_json::to_string(&plan).expect("serialize plan");
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn budget_plan_exposes_soft_and_hard_trim_thresholds() {
        let budget = resolve_context_budget(8_192, None);
        let plan = resolve_context_budget_plan(&input("Explain Event Sourcing."), &budget, None);

        assert_eq!(plan.hard_trim_threshold, plan.max_input_tokens);
        assert!(plan.soft_trim_threshold < plan.hard_trim_threshold);
        assert!(plan.soft_trim_threshold > plan.max_input_tokens / 2);
    }

    #[test]
    fn strong_capability_plan_has_more_context_capacity_than_weak_plan() {
        let input = input("Explain the architecture in detail.");
        let strong_budget = resolve_context_budget(16_384, None);
        let weak_budget = resolve_context_budget(4_096, None);
        let strong = resolve_context_budget_plan(
            &input,
            &strong_budget,
            Some(&decision(
                ExecutionStrategy::Parallel2DraftSynthesize,
                8_192,
                2,
                true,
                "deep",
            )),
        );
        let weak = resolve_context_budget_plan(&input, &weak_budget, None);

        assert!(strong.max_input_tokens > weak.max_input_tokens);
        assert!(strong.capsule_token_budget > weak.capsule_token_budget);
        assert!(strong.recent_full_response_limit > weak.recent_full_response_limit);
    }

    fn input(prompt: &str) -> BuildContextInput {
        BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: Some("response-current".to_string()),
            user_prompt: prompt.to_string(),
            attached_references: Vec::new(),
            response_mode: ResponseMode::Auto,
            resolved_num_ctx: 8_192,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            recent_messages: Vec::new(),
        }
    }

    fn message(content: &str) -> ContextMessage {
        ContextMessage::new(
            ContextMessageRole::User,
            content,
            Some(crate::context::types::ContextSourceKind::RecentTurn),
            None,
        )
    }

    fn reference(selected_text: &str) -> AttachedReferenceInput {
        AttachedReferenceInput {
            reference: ReferenceContext {
                reference_id: "ref-1".to_string(),
                target_kind: "fragment".to_string(),
                target_id: Some("response-1".to_string()),
                target_uri: None,
                label: Some("Reference".to_string()),
                selected_text: Some(selected_text.to_string()),
                capsule_summary: None,
            },
            response_capsule: None,
        }
    }

    fn decision(
        strategy: ExecutionStrategy,
        max_output_tokens: i64,
        max_parallelism: i64,
        allow_deep_synthesis: bool,
        requested_mode: &str,
    ) -> ExecutionStrategyDecision {
        ExecutionStrategyDecision {
            decision_id: "strategy-1".to_string(),
            snapshot_id: None,
            model_id: Some("model-1".to_string()),
            requested_mode: requested_mode.to_string(),
            prompt_kind: "explanation".to_string(),
            context_size_tokens: 2048,
            strategy,
            max_output_tokens,
            max_parallelism,
            allow_deep_synthesis,
            allow_parallel_drafts: max_parallelism > 1,
            reason: Vec::new(),
            warnings: Vec::new(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }
}
