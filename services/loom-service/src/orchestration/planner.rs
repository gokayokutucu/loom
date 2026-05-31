use crate::orchestration::answer_plan::{
    AnswerIntent, AnswerPlan, AnswerStyle, ContextStrategy, EstimatedComplexity, ModelProfile,
    PlannerInput, PlannerReference, QuestionUnit, ResponseMode,
};

pub struct DeterministicPlanner;

impl DeterministicPlanner {
    pub fn plan(input: PlannerInput) -> AnswerPlan {
        let prompt = input.clean_user_prompt.trim().to_string();
        let references = input.attached_references;
        let lines = normalized_lines(&input.prompt_lines, &prompt);
        let complexity = estimate_complexity(&prompt, &references);
        let follow_up_prompt = references.is_empty() && is_follow_up_prompt(&prompt);
        let simple_factual =
            references.is_empty() && !follow_up_prompt && is_short_factual(&prompt);
        let code_task = is_code_task(&prompt);
        let separate_line_references = has_separate_line_reference_questions(&lines, &references);
        let reference_prompt_text = input_text(&lines);
        // A fragment reference (target_kind=="fragment" or selected_text_preview present) is
        // always reference-scoped, even when the user types a short bare prompt like "explain"
        // that does not explicitly mention the reference token.
        let fragment_reference_scoped =
            references.len() == 1 && is_fragment_reference(&references[0]);
        let single_reference_scoped = fragment_reference_scoped
            || (references.len() == 1
                && !prompt.is_empty()
                && prompt_mentions_reference(&reference_prompt_text, &references[0]));
        let same_line_multi_reference = !separate_line_references && references.len() > 1;

        let mut intent = if simple_factual {
            AnswerIntent::SimpleFactual
        } else if code_task {
            AnswerIntent::CodeTask
        } else if separate_line_references || single_reference_scoped {
            AnswerIntent::ReferenceScopedQuestion
        } else if same_line_multi_reference {
            AnswerIntent::MultiReferenceSynthesis
        } else if follow_up_prompt {
            AnswerIntent::GeneralQuestion
        } else if is_comparison(&prompt) {
            AnswerIntent::Comparison
        } else if is_summary(&prompt) {
            AnswerIntent::Summary
        } else if prompt.is_empty() {
            AnswerIntent::Unknown
        } else {
            AnswerIntent::GeneralQuestion
        };

        let answer_style = match intent {
            AnswerIntent::SimpleFactual => AnswerStyle::Direct,
            AnswerIntent::ReferenceScopedQuestion => AnswerStyle::SeparateSections,
            AnswerIntent::MultiReferenceSynthesis => AnswerStyle::Synthesis,
            AnswerIntent::CodeTask => AnswerStyle::Code,
            AnswerIntent::Comparison => AnswerStyle::Bullets,
            _ if asks_step_by_step(&prompt) => AnswerStyle::StepByStep,
            _ => AnswerStyle::Direct,
        };

        let context_strategy = match intent {
            _ if follow_up_prompt => ContextStrategy::RecentTurns,
            AnswerIntent::SimpleFactual => ContextStrategy::Minimal,
            AnswerIntent::ReferenceScopedQuestion | AnswerIntent::MultiReferenceSynthesis => {
                ContextStrategy::ReferenceCapsules
            }
            AnswerIntent::CodeTask => ContextStrategy::FullSourceRequired,
            _ => ContextStrategy::RecentTurns,
        };

        let response_mode =
            if simple_factual && matches!(input.selected_response_mode, ResponseMode::Auto) {
                ResponseMode::Instant
            } else {
                input.selected_response_mode.clone()
            };
        let use_thinking = match input.selected_response_mode {
            ResponseMode::Instant => false,
            ResponseMode::Thinking => true,
            ResponseMode::Auto => false,
        };

        if prompt.is_empty() {
            intent = AnswerIntent::Unknown;
        }

        // For a short prompt with a single selected-fragment reference, anchor the
        // rewritten_prompt to the fragment so the context manager and the model
        // both see the explicit subject — not just "explain" in isolation.
        let rewritten_prompt =
            fragment_anchor_rewrite(&prompt, &references).unwrap_or_else(|| prompt.clone());

        AnswerPlan {
            intent,
            response_mode,
            use_thinking,
            model_profile: if code_task {
                ModelProfile::Code
            } else {
                ModelProfile::Main
            },
            context_strategy,
            answer_style,
            question_units: question_units(&lines, &references, separate_line_references),
            rewritten_prompt,
            needs_full_source_text: code_task
                || contains_any(&input_text(&lines), &["full source", "tam kaynak"]),
            needs_exact_quote: contains_any(&input_text(&lines), &["quote", "alıntı", "aynen"]),
            needs_code_context: code_task,
            estimated_complexity: complexity,
            notes_for_context_builder: Some(
                "Structured AnswerPlan only; no raw reasoning.".to_string(),
            ),
        }
    }
}

fn normalized_lines(lines: &[String], prompt: &str) -> Vec<String> {
    if lines.is_empty() {
        prompt
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect()
    } else {
        lines
            .iter()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect()
    }
}

fn question_units(
    lines: &[String],
    references: &[PlannerReference],
    separate_line_references: bool,
) -> Vec<QuestionUnit> {
    if separate_line_references {
        return lines
            .iter()
            .enumerate()
            .filter_map(|(index, line)| {
                let reference_ids = references_for_line(line, references);
                if reference_ids.is_empty() {
                    return None;
                }
                Some(QuestionUnit {
                    id: format!("unit-{}", index + 1),
                    question: strip_reference_labels(line, references),
                    reference_ids,
                    should_answer_separately: true,
                })
            })
            .collect();
    }

    vec![QuestionUnit {
        id: "unit-1".to_string(),
        question: input_text(lines),
        reference_ids: references
            .iter()
            .map(|reference| reference.reference_id.clone())
            .collect(),
        should_answer_separately: false,
    }]
}

fn has_separate_line_reference_questions(
    lines: &[String],
    references: &[PlannerReference],
) -> bool {
    if references.len() < 2 || lines.len() < 2 {
        return false;
    }
    let referenced_lines = lines
        .iter()
        .filter(|line| !references_for_line(line, references).is_empty())
        .count();
    referenced_lines >= 2
}

fn references_for_line(line: &str, references: &[PlannerReference]) -> Vec<String> {
    references
        .iter()
        .filter(|reference| {
            line.contains(&reference.reference_id)
                || reference
                    .label
                    .as_ref()
                    .is_some_and(|label| line.contains(label))
        })
        .map(|reference| reference.reference_id.clone())
        .collect()
}

fn prompt_mentions_reference(prompt: &str, reference: &PlannerReference) -> bool {
    prompt.contains(&reference.reference_id)
        || reference
            .label
            .as_ref()
            .is_some_and(|label| prompt.contains(label))
        || reference
            .selected_text_preview
            .as_ref()
            .is_some_and(|selected| !selected.trim().is_empty() && prompt.contains(selected))
}

fn strip_reference_labels(line: &str, references: &[PlannerReference]) -> String {
    references.iter().fold(line.to_string(), |acc, reference| {
        let acc = acc.replace(&reference.reference_id, "");
        if let Some(label) = &reference.label {
            acc.replace(label, "").trim().to_string()
        } else {
            acc.trim().to_string()
        }
    })
}

fn estimate_complexity(prompt: &str, references: &[PlannerReference]) -> EstimatedComplexity {
    let lower = prompt.to_lowercase();
    if references.len() > 2
        || contains_any(
            &lower,
            &[
                "detailed",
                "detaylı",
                "uzunca",
                "deep dive",
                "step by step",
                "adım adım",
                "analyze",
                "analiz",
            ],
        )
    {
        EstimatedComplexity::High
    } else if prompt.chars().count() > 160 || !references.is_empty() {
        EstimatedComplexity::Medium
    } else {
        EstimatedComplexity::Low
    }
}

fn is_short_factual(prompt: &str) -> bool {
    prompt.chars().count() <= 120
        && contains_any(
            &prompt.to_lowercase(),
            &[
                "what is", "who is", "when", "where", "kaç", "nedir", "kimdir",
            ],
        )
        && !contains_any(
            &prompt.to_lowercase(),
            &["detay", "uzun", "explain", "anlat"],
        )
}

fn is_code_task(prompt: &str) -> bool {
    contains_any(
        &prompt.to_lowercase(),
        &[
            "code",
            "implement",
            "fix",
            "rust",
            "typescript",
            "function",
            "bug",
            "kod",
        ],
    )
}

fn is_comparison(prompt: &str) -> bool {
    contains_any(
        &prompt.to_lowercase(),
        &["compare", "karşılaştır", "vs", "versus"],
    )
}

fn is_summary(prompt: &str) -> bool {
    contains_any(&prompt.to_lowercase(), &["summarize", "özetle", "summary"])
}

fn asks_step_by_step(prompt: &str) -> bool {
    contains_any(&prompt.to_lowercase(), &["step by step", "adım adım"])
}

fn is_follow_up_prompt(prompt: &str) -> bool {
    if prompt.trim().is_empty() {
        return false;
    }
    let normalized = prompt.to_lowercase();
    contains_any(
        &normalized,
        &[
            "bunu",
            "şunu",
            "sunu",
            "bunun",
            "şunun",
            "onun",
            "bu ",
            "peki",
            "devam",
            "biraz daha",
            "açar",
            "acar",
            "açabilir",
            "acabilir",
            "daha detay",
            "detaylı",
            "detayli",
            "örnek",
            "ornek",
            "nasıl uygular",
            "nasil uygular",
            "nasıl kullan",
            "nasil kullan",
            "tablo",
            "avantaj",
            "dezavantaj",
            "artıları",
            "artilari",
            "eksileri",
            "karşılaştır",
            "karsilastir",
            "this",
            "that",
            "continue",
            "expand",
            "pros",
            "cons",
            "advantages",
            "disadvantages",
            "table",
            "example",
            "explain more",
            "how",
        ],
    )
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn input_text(lines: &[String]) -> String {
    lines.join("\n")
}

/// Returns true for a reference that carries a selected text fragment —
/// either via `target_kind == "fragment"` or a non-empty `selected_text_preview`.
fn is_fragment_reference(reference: &PlannerReference) -> bool {
    reference.target_kind == "fragment"
        || reference
            .selected_text_preview
            .as_ref()
            .is_some_and(|t| !t.trim().is_empty())
}

/// Returns true when the prompt explicitly asks the model to summarize or
/// explain the *entire* source response — in those cases fragment anchoring
/// must not apply.
fn asks_for_full_source(prompt: &str) -> bool {
    let lower = prompt.to_lowercase();
    contains_any(
        &lower,
        &[
            "whole",
            "entire",
            "full response",
            "full answer",
            "all of this",
            "all of it",
        ],
    )
}

/// When exactly one fragment reference is attached and the user typed a short
/// bare prompt, rewrites the prompt to explicitly name the selected fragment as
/// the subject.
///
/// Examples:
///   "explain"              → `explain: "The Process of Trilateration"`
///   "why?"                 → `why: "The Process of Trilateration"`
///   "what does this mean?" → `what does this mean: "The Process of Trilateration"`
///
/// Returns `None` when anchoring is not appropriate (long prompt, multi-ref,
/// explicit whole-source request, or no selected text).
pub fn fragment_anchor_rewrite(prompt: &str, references: &[PlannerReference]) -> Option<String> {
    if references.len() != 1 {
        return None;
    }
    let reference = &references[0];
    if !is_fragment_reference(reference) {
        return None;
    }
    let selected_text = reference.selected_text_preview.as_deref()?;
    let selected_text = selected_text.trim();
    if selected_text.is_empty() {
        return None;
    }
    // Only anchor short, single-line prompts.
    let char_count = prompt.chars().count();
    if char_count >= 120 || prompt.contains('\n') {
        return None;
    }
    // Never anchor when the user explicitly asked for the whole source.
    if asks_for_full_source(prompt) {
        return None;
    }
    // Truncate the fragment preview to avoid huge prompts.
    let fragment: String = selected_text.chars().take(200).collect();
    let verb = prompt.trim_end_matches('?').trim_end_matches('!').trim();
    Some(format!("{verb}: \"{fragment}\""))
}

#[cfg(test)]
mod tests {
    use super::DeterministicPlanner;
    use crate::orchestration::answer_plan::{
        AnswerIntent, AnswerStyle, ContextStrategy, EstimatedComplexity, PlannerInput,
        PlannerReference, ResponseMode,
    };

    #[test]
    fn simple_factual_prompt_uses_instant_minimal_no_thinking() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "ahtapot kaç kolludur".to_string(),
            ..PlannerInput::default()
        });

        assert_eq!(plan.intent, AnswerIntent::SimpleFactual);
        assert_eq!(plan.response_mode, ResponseMode::Instant);
        assert!(!plan.use_thinking);
        assert_eq!(plan.context_strategy, ContextStrategy::Minimal);
    }

    #[test]
    fn short_follow_up_prompts_force_recent_turns_context() {
        for prompt in [
            "Avantaj ve dezavantajları tablo şeklinde verebilir misin?",
            "Dezavantajları ve avantajları biraz daha açar mısın",
            "Can you expand the pros and cons in a table?",
        ] {
            let plan = DeterministicPlanner::plan(PlannerInput {
                clean_user_prompt: prompt.to_string(),
                ..PlannerInput::default()
            });

            assert_eq!(plan.intent, AnswerIntent::GeneralQuestion, "{prompt}");
            assert_eq!(
                plan.context_strategy,
                ContextStrategy::RecentTurns,
                "{prompt}"
            );
            assert_ne!(plan.context_strategy, ContextStrategy::Minimal, "{prompt}");
        }
    }

    #[test]
    fn explicit_references_remain_primary_for_follow_up_like_prompt() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "Bunu tablo şeklinde anlat".to_string(),
            prompt_lines: vec!["Bunu tablo şeklinde anlat Reference A".to_string()],
            attached_references: vec![reference("ref-1", "Reference A")],
            ..PlannerInput::default()
        });

        assert_eq!(plan.intent, AnswerIntent::ReferenceScopedQuestion);
        assert_eq!(plan.context_strategy, ContextStrategy::ReferenceCapsules);
    }

    #[test]
    fn separate_line_references_create_question_units() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "Deneme 1 ne diyor?\nDeneme 2 ne diyor?".to_string(),
            prompt_lines: vec![
                "Deneme 1 ne diyor?".to_string(),
                "Deneme 2 ne diyor?".to_string(),
            ],
            attached_references: vec![
                reference("ref-1", "Deneme 1"),
                reference("ref-2", "Deneme 2"),
            ],
            ..PlannerInput::default()
        });

        assert_eq!(plan.intent, AnswerIntent::ReferenceScopedQuestion);
        assert_eq!(plan.answer_style, AnswerStyle::SeparateSections);
        assert_eq!(plan.question_units.len(), 2);
        assert_eq!(plan.context_strategy, ContextStrategy::ReferenceCapsules);
        assert!(plan.question_units[0].should_answer_separately);
        assert_eq!(plan.question_units[0].reference_ids, vec!["ref-1"]);
        assert_eq!(plan.question_units[1].reference_ids, vec!["ref-2"]);
        let serialized = serde_json::to_string(&plan).expect("serialize plan");
        assert!(!serialized.contains("Group 1"));
        assert!(!serialized.contains("Group 2"));
    }

    #[test]
    fn same_line_references_use_synthesis() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "Deneme 1 ve Deneme 2 farkı nedir?".to_string(),
            prompt_lines: vec!["Deneme 1 ve Deneme 2 farkı nedir?".to_string()],
            attached_references: vec![
                reference("ref-1", "Deneme 1"),
                reference("ref-2", "Deneme 2"),
            ],
            ..PlannerInput::default()
        });

        assert_eq!(plan.intent, AnswerIntent::MultiReferenceSynthesis);
        assert_eq!(plan.answer_style, AnswerStyle::Synthesis);
        assert_eq!(plan.context_strategy, ContextStrategy::ReferenceCapsules);
        assert_eq!(plan.question_units.len(), 1);
        assert!(!plan.question_units[0].should_answer_separately);
        assert_eq!(plan.question_units[0].reference_ids, vec!["ref-1", "ref-2"]);
    }

    #[test]
    fn fragment_reference_metadata_is_preserved_for_context_builder() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "Bu fragment ne anlama geliyor?".to_string(),
            prompt_lines: vec!["Bu fragment ne anlama geliyor? Fragment A".to_string()],
            attached_references: vec![PlannerReference {
                reference_id: "fragment-a".to_string(),
                label: Some("Fragment A".to_string()),
                selected_text_preview: Some("MCP".to_string()),
                target_kind: "fragment".to_string(),
                target_id: Some("response-1#fragment-a".to_string()),
                source_response_code: Some("R-1".to_string()),
                source_title: Some("Plugin source".to_string()),
            }],
            ..PlannerInput::default()
        });

        assert_eq!(plan.intent, AnswerIntent::ReferenceScopedQuestion);
        assert_eq!(plan.context_strategy, ContextStrategy::ReferenceCapsules);
        assert_eq!(plan.question_units.len(), 1);
        assert_eq!(plan.question_units[0].reference_ids, vec!["fragment-a"]);
        assert!(plan.question_units[0]
            .question
            .contains("Bu fragment ne anlama geliyor?"));
        let serialized = serde_json::to_string(&plan).expect("serialize plan");
        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("chain_of_thought"));
    }

    #[test]
    fn instant_mode_forces_no_thinking() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "detaylı analiz yap".to_string(),
            selected_response_mode: ResponseMode::Instant,
            ..PlannerInput::default()
        });

        assert!(!plan.use_thinking);
        assert_eq!(plan.response_mode, ResponseMode::Instant);
    }

    #[test]
    fn auto_mode_keeps_visible_answers_direct_without_thinking() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "Event sourcing nedir? Nerelerde kullanılır? Detaylı anlat"
                .to_string(),
            selected_response_mode: ResponseMode::Auto,
            ..PlannerInput::default()
        });

        assert_eq!(plan.estimated_complexity, EstimatedComplexity::High);
        assert_eq!(plan.response_mode, ResponseMode::Auto);
        assert!(!plan.use_thinking);
    }

    #[test]
    fn thinking_mode_enables_thinking_for_simple_and_complex() {
        let simple = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "nedir".to_string(),
            selected_response_mode: ResponseMode::Thinking,
            ..PlannerInput::default()
        });
        let complex = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "Event sourcing konusunu detaylı analiz et ve adım adım açıkla"
                .to_string(),
            selected_response_mode: ResponseMode::Thinking,
            ..PlannerInput::default()
        });

        assert!(simple.use_thinking);
        assert_eq!(simple.response_mode, ResponseMode::Thinking);
        assert!(complex.use_thinking);
        assert_eq!(complex.response_mode, ResponseMode::Thinking);
        assert_eq!(complex.estimated_complexity, EstimatedComplexity::High);
    }

    fn reference(id: &str, label: &str) -> PlannerReference {
        PlannerReference {
            reference_id: id.to_string(),
            label: Some(label.to_string()),
            selected_text_preview: None,
            target_kind: "response".to_string(),
            target_id: Some(id.to_string()),
            source_response_code: None,
            source_title: Some(label.to_string()),
        }
    }

    fn fragment_reference(selected_text: &str) -> PlannerReference {
        PlannerReference {
            reference_id: "frag-1".to_string(),
            label: None,
            selected_text_preview: Some(selected_text.to_string()),
            target_kind: "fragment".to_string(),
            target_id: Some("response-1#frag-1".to_string()),
            source_response_code: Some("R-GPS".to_string()),
            source_title: Some("GPS Explained".to_string()),
        }
    }

    const FRAGMENT: &str = "The Process of Trilateration";

    // ── Fix 1: fragment reference forces ReferenceScopedQuestion ─────────────

    #[test]
    fn fragment_ref_with_bare_explain_is_reference_scoped() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "explain".to_string(),
            attached_references: vec![fragment_reference(FRAGMENT)],
            ..PlannerInput::default()
        });
        assert_eq!(plan.intent, AnswerIntent::ReferenceScopedQuestion);
        assert_eq!(plan.context_strategy, ContextStrategy::ReferenceCapsules);
    }

    #[test]
    fn fragment_ref_with_bare_why_is_reference_scoped() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "why?".to_string(),
            attached_references: vec![fragment_reference(FRAGMENT)],
            ..PlannerInput::default()
        });
        assert_eq!(plan.intent, AnswerIntent::ReferenceScopedQuestion);
        assert_eq!(plan.context_strategy, ContextStrategy::ReferenceCapsules);
    }

    // ── Fix 2: short-prompt anchoring ────────────────────────────────────────

    #[test]
    fn explain_anchors_to_fragment_text() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "explain".to_string(),
            attached_references: vec![fragment_reference(FRAGMENT)],
            ..PlannerInput::default()
        });
        assert!(
            plan.rewritten_prompt.contains(FRAGMENT),
            "rewritten_prompt should contain fragment text, got: {}",
            plan.rewritten_prompt
        );
    }

    #[test]
    fn why_prompt_anchors_to_fragment() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "why?".to_string(),
            attached_references: vec![fragment_reference(FRAGMENT)],
            ..PlannerInput::default()
        });
        assert!(plan.rewritten_prompt.contains(FRAGMENT));
        // Trailing ? should be stripped from the verb part
        assert!(plan.rewritten_prompt.starts_with("why:"));
    }

    #[test]
    fn what_does_this_mean_anchors_to_fragment() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "what does this mean?".to_string(),
            attached_references: vec![fragment_reference(FRAGMENT)],
            ..PlannerInput::default()
        });
        assert!(plan.rewritten_prompt.contains(FRAGMENT));
    }

    #[test]
    fn give_an_example_anchors_to_fragment() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "give an example".to_string(),
            attached_references: vec![fragment_reference(FRAGMENT)],
            ..PlannerInput::default()
        });
        assert!(plan.rewritten_prompt.contains(FRAGMENT));
    }

    #[test]
    fn explicit_whole_source_prompt_is_not_anchored() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "summarize the whole answer".to_string(),
            attached_references: vec![fragment_reference(FRAGMENT)],
            ..PlannerInput::default()
        });
        assert!(
            !plan.rewritten_prompt.contains(FRAGMENT),
            "whole-source request must not be anchored to fragment"
        );
    }

    #[test]
    fn explicit_full_response_prompt_is_not_anchored() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "explain the entire response".to_string(),
            attached_references: vec![fragment_reference(FRAGMENT)],
            ..PlannerInput::default()
        });
        assert!(!plan.rewritten_prompt.contains(FRAGMENT));
    }

    #[test]
    fn long_prompt_is_not_anchored() {
        let long =
            "explain this concept in detail and relate it to the broader context please".repeat(3);
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: long.clone(),
            attached_references: vec![fragment_reference(FRAGMENT)],
            ..PlannerInput::default()
        });
        // Long prompts should not be rewritten (they already provide enough context)
        assert_eq!(plan.rewritten_prompt, long.trim());
    }

    #[test]
    fn no_fragment_reference_means_no_anchoring() {
        let plan = DeterministicPlanner::plan(PlannerInput {
            clean_user_prompt: "explain".to_string(),
            attached_references: vec![reference("ref-1", "GPS Explained")],
            ..PlannerInput::default()
        });
        assert!(!plan.rewritten_prompt.contains(FRAGMENT));
    }

    // ── fragment_anchor_rewrite unit tests ────────────────────────────────────

    #[test]
    fn anchor_rewrite_formats_verb_colon_fragment() {
        use super::fragment_anchor_rewrite;
        let refs = vec![fragment_reference(FRAGMENT)];
        let result = fragment_anchor_rewrite("explain", &refs).unwrap();
        assert_eq!(result, format!("explain: \"{FRAGMENT}\""));
    }

    #[test]
    fn anchor_rewrite_strips_trailing_question_mark() {
        use super::fragment_anchor_rewrite;
        let refs = vec![fragment_reference(FRAGMENT)];
        let result = fragment_anchor_rewrite("why?", &refs).unwrap();
        assert_eq!(result, format!("why: \"{FRAGMENT}\""));
    }

    #[test]
    fn anchor_rewrite_returns_none_for_long_prompt() {
        use super::fragment_anchor_rewrite;
        let refs = vec![fragment_reference(FRAGMENT)];
        let long = "x".repeat(120);
        assert!(fragment_anchor_rewrite(&long, &refs).is_none());
    }

    #[test]
    fn anchor_rewrite_returns_none_for_whole_source_request() {
        use super::fragment_anchor_rewrite;
        let refs = vec![fragment_reference(FRAGMENT)];
        assert!(fragment_anchor_rewrite("summarize the whole answer", &refs).is_none());
        assert!(fragment_anchor_rewrite("explain the entire response", &refs).is_none());
        assert!(fragment_anchor_rewrite("summarize the full response", &refs).is_none());
    }
}
