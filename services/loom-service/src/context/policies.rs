use crate::context::{
    contributors::{
        AttachedReferencesContributor, ContextContributor, LoomCheckpointContributor,
        ProfileMemoryContributor, RecentTurnsContributor, ResponseCapsuleContributor,
        WeftOriginContributor,
    },
    types::{BuildContextInput, ContextSource, ContextStrategy},
};

pub fn select_context_strategy(input: &BuildContextInput) -> ContextStrategy {
    if !input.attached_references.is_empty() {
        return ContextStrategy::ReferenceCapsules;
    }

    if input.source == ContextSource::Weft && input.weft_origin.is_some() {
        return ContextStrategy::WeftOriginAndRecent;
    }

    if input.checkpoint.is_some() || input.recent_messages.len() > 8 {
        return ContextStrategy::CheckpointAndRecent;
    }

    if input.recent_messages.is_empty() {
        return ContextStrategy::Minimal;
    }

    ContextStrategy::RecentTurns
}

pub fn default_contributors() -> Vec<Box<dyn ContextContributor>> {
    vec![
        Box::new(LoomCheckpointContributor),
        Box::new(WeftOriginContributor),
        Box::new(AttachedReferencesContributor),
        Box::new(ResponseCapsuleContributor),
        Box::new(ProfileMemoryContributor),
        Box::new(RecentTurnsContributor),
    ]
}

pub fn ordered_contributors(
    mut contributors: Vec<Box<dyn ContextContributor>>,
) -> Vec<Box<dyn ContextContributor>> {
    contributors.sort_by_key(|contributor| contributor.priority());
    contributors
}

#[cfg(test)]
mod tests {
    use super::select_context_strategy;
    use crate::context::types::{BuildContextInput, ContextSource, ContextStrategy};

    #[test]
    fn short_context_uses_minimal_strategy() {
        let input = BuildContextInput {
            user_prompt: "What is event sourcing?".to_string(),
            ..minimal_input()
        };

        assert_eq!(select_context_strategy(&input), ContextStrategy::Minimal);
    }

    #[test]
    fn weft_policy_includes_immediate_origin_only() {
        let input = BuildContextInput {
            source: ContextSource::Weft,
            weft_origin: Some(crate::context::manager::tests::sample_weft_origin()),
            ..minimal_input()
        };

        assert_eq!(
            select_context_strategy(&input),
            ContextStrategy::WeftOriginAndRecent
        );
    }

    fn minimal_input() -> BuildContextInput {
        crate::context::manager::tests::minimal_input("hello")
    }
}
