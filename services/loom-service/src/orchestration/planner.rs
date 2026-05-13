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
        let single_reference_scoped = references.len() == 1
            && !prompt.is_empty()
            && prompt_mentions_reference(&reference_prompt_text, &references[0]);
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

        let response_mode = if simple_factual {
            ResponseMode::Instant
        } else {
            input.selected_response_mode.clone()
        };
        let use_thinking = match input.selected_response_mode {
            ResponseMode::Instant => false,
            ResponseMode::Thinking => !simple_factual && complexity >= EstimatedComplexity::Medium,
            ResponseMode::Auto => false,
        };

        if prompt.is_empty() {
            intent = AnswerIntent::Unknown;
        }

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
            rewritten_prompt: prompt,
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
    fn thinking_mode_blocks_simple_but_allows_complex() {
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

        assert!(!simple.use_thinking);
        assert!(complex.use_thinking);
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
}
