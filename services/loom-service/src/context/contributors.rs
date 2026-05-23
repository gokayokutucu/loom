use crate::context::{
    budget::estimate_tokens,
    retrieval::{ContextRetrievalIncludeMode, ContextRetrievalResult},
    types::{
        BuildContextInput, ContextMessageRole, ContextSource, ContextSourceKind, ReferenceContext,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextContribution {
    pub source_id: String,
    pub title: String,
    pub content: String,
    pub estimated_tokens: usize,
    pub source_kind: ContextSourceKind,
    pub metadata: BTreeMap<String, Value>,
}

pub trait ContextContributor {
    fn id(&self) -> &'static str;
    fn label(&self) -> &'static str;
    fn priority(&self) -> i32;
    fn can_contribute(&self, input: &BuildContextInput) -> bool;
    fn contribute(&self, input: &BuildContextInput) -> Vec<ContextContribution>;
}

#[derive(Debug, Clone, Copy)]
pub struct RecentTurnsContributor;

#[derive(Debug, Clone, Copy)]
pub struct ProfileMemoryContributor;

#[derive(Debug, Clone, Copy)]
pub struct LoomCheckpointContributor;

#[derive(Debug, Clone, Copy)]
pub struct WeftOriginContributor;

#[derive(Debug, Clone, Copy)]
pub struct AttachedReferencesContributor;

#[derive(Debug, Clone, Copy)]
pub struct ResponseCapsuleContributor;

#[derive(Debug, Clone)]
pub struct RetrievedMemoryContributor {
    result: ContextRetrievalResult,
}

impl RetrievedMemoryContributor {
    pub fn new(result: ContextRetrievalResult) -> Self {
        Self { result }
    }
}

impl ContextContributor for RecentTurnsContributor {
    fn id(&self) -> &'static str {
        "recent_turns"
    }

    fn label(&self) -> &'static str {
        "Recent turns"
    }

    fn priority(&self) -> i32 {
        50
    }

    fn can_contribute(&self, input: &BuildContextInput) -> bool {
        !input.recent_messages.is_empty()
    }

    fn contribute(&self, input: &BuildContextInput) -> Vec<ContextContribution> {
        let content = input
            .recent_messages
            .iter()
            .map(|message| {
                let role = match message.role {
                    ContextMessageRole::User => "User",
                    ContextMessageRole::Assistant => "Assistant",
                    ContextMessageRole::System => "System",
                };
                format!("{role}: {}", message.content)
            })
            .collect::<Vec<_>>()
            .join("\n\n");

        vec![contribution(
            "recent-conversation",
            "Recent conversation",
            content,
            ContextSourceKind::RecentTurn,
        )]
    }
}

impl ContextContributor for ProfileMemoryContributor {
    fn id(&self) -> &'static str {
        "profile_memory"
    }

    fn label(&self) -> &'static str {
        "Profile memory"
    }

    fn priority(&self) -> i32 {
        45
    }

    fn can_contribute(&self, input: &BuildContextInput) -> bool {
        !input.memory_messages.is_empty()
    }

    fn contribute(&self, input: &BuildContextInput) -> Vec<ContextContribution> {
        let content = input
            .memory_messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        vec![contribution(
            "profile-memory",
            "User profile and saved Memory",
            content,
            ContextSourceKind::RetrievedMemory,
        )]
    }
}

impl ContextContributor for LoomCheckpointContributor {
    fn id(&self) -> &'static str {
        "loom_checkpoint"
    }

    fn label(&self) -> &'static str {
        "Loom checkpoint"
    }

    fn priority(&self) -> i32 {
        40
    }

    fn can_contribute(&self, input: &BuildContextInput) -> bool {
        input.checkpoint.is_some()
    }

    fn contribute(&self, input: &BuildContextInput) -> Vec<ContextContribution> {
        input
            .checkpoint
            .iter()
            .map(|checkpoint| {
                let content = if input.resolved_num_ctx >= 8192 {
                    rich_checkpoint_content(checkpoint)
                } else {
                    compact_checkpoint_content(checkpoint)
                };
                contribution(
                    checkpoint.checkpoint_id.clone(),
                    "Loom checkpoint",
                    content,
                    ContextSourceKind::LoomCheckpoint,
                )
            })
            .collect()
    }
}

impl ContextContributor for WeftOriginContributor {
    fn id(&self) -> &'static str {
        "weft_origin"
    }

    fn label(&self) -> &'static str {
        "Weft origin"
    }

    fn priority(&self) -> i32 {
        30
    }

    fn can_contribute(&self, input: &BuildContextInput) -> bool {
        input.source == ContextSource::Weft && input.weft_origin.is_some()
    }

    fn contribute(&self, input: &BuildContextInput) -> Vec<ContextContribution> {
        input
            .weft_origin
            .iter()
            .map(|origin| {
                contribution(
                    origin.context_id.clone(),
                    "Background context",
                    origin.origin_summary.clone(),
                    ContextSourceKind::WeftOrigin,
                )
            })
            .collect()
    }
}

impl ContextContributor for AttachedReferencesContributor {
    fn id(&self) -> &'static str {
        "attached_references"
    }

    fn label(&self) -> &'static str {
        "Attached references"
    }

    fn priority(&self) -> i32 {
        10
    }

    fn can_contribute(&self, input: &BuildContextInput) -> bool {
        !input.attached_references.is_empty()
    }

    fn contribute(&self, input: &BuildContextInput) -> Vec<ContextContribution> {
        input
            .attached_references
            .iter()
            .map(|attached| {
                attached
                    .attachment
                    .as_ref()
                    .map(attachment_contribution)
                    .unwrap_or_else(|| reference_contribution(&attached.reference))
            })
            .collect()
    }
}

impl ContextContributor for ResponseCapsuleContributor {
    fn id(&self) -> &'static str {
        "response_capsules"
    }

    fn label(&self) -> &'static str {
        "Response capsules"
    }

    fn priority(&self) -> i32 {
        20
    }

    fn can_contribute(&self, input: &BuildContextInput) -> bool {
        input
            .attached_references
            .iter()
            .any(|attached| attached.response_capsule.is_some())
    }

    fn contribute(&self, input: &BuildContextInput) -> Vec<ContextContribution> {
        input
            .attached_references
            .iter()
            .filter_map(|attached| attached.response_capsule.as_ref())
            .map(|capsule| {
                let content = if input.resolved_num_ctx >= 8192 {
                    rich_capsule_content(capsule)
                } else {
                    compact_capsule_content(capsule)
                };
                contribution(
                    capsule.capsule_id.clone(),
                    capsule
                        .title
                        .clone()
                        .unwrap_or_else(|| "Response capsule".to_string()),
                    content,
                    ContextSourceKind::ResponseCapsule,
                )
            })
            .collect()
    }
}

impl ContextContributor for RetrievedMemoryContributor {
    fn id(&self) -> &'static str {
        "retrieved_memory"
    }

    fn label(&self) -> &'static str {
        "Retrieved memory"
    }

    fn priority(&self) -> i32 {
        60
    }

    fn can_contribute(&self, _input: &BuildContextInput) -> bool {
        !self.result.selected.is_empty()
    }

    fn contribute(&self, _input: &BuildContextInput) -> Vec<ContextContribution> {
        self.result
            .selected
            .iter()
            .map(|candidate| {
                let mode = match candidate.include_mode {
                    ContextRetrievalIncludeMode::Full => "full",
                    ContextRetrievalIncludeMode::Capsule => "capsule",
                    ContextRetrievalIncludeMode::ReferenceOnly => "reference_only",
                    ContextRetrievalIncludeMode::CodeExact => "code_exact",
                    ContextRetrievalIncludeMode::CodeSummary => "code_summary",
                };
                let kind = match candidate.candidate_kind {
                    crate::context::retrieval::ContextRetrievalCandidateKind::Response => {
                        "response"
                    }
                    crate::context::retrieval::ContextRetrievalCandidateKind::ResponsePart => {
                        "response_part"
                    }
                    crate::context::retrieval::ContextRetrievalCandidateKind::ResponseCapsule => {
                        "response_capsule"
                    }
                    crate::context::retrieval::ContextRetrievalCandidateKind::Checkpoint => {
                        "checkpoint"
                    }
                    crate::context::retrieval::ContextRetrievalCandidateKind::CodeBlock => {
                        "code_block"
                    }
                    crate::context::retrieval::ContextRetrievalCandidateKind::Topic => "topic",
                    crate::context::retrieval::ContextRetrievalCandidateKind::Reference => {
                        "reference"
                    }
                    crate::context::retrieval::ContextRetrievalCandidateKind::Memory => "memory",
                    crate::context::retrieval::ContextRetrievalCandidateKind::AttachmentChunk => {
                        "attachment_chunk"
                    }
                    crate::context::retrieval::ContextRetrievalCandidateKind::WeftOrigin => {
                        "weft_origin"
                    }
                };
                let content = format!(
                    "Use as older background context ({mode}).\nWhy it may be relevant: {}\n{}",
                    candidate.reasons.join(", "),
                    candidate.text_preview
                );
                let mut contribution = contribution(
                    candidate.candidate_id.clone(),
                    "Relevant older Loom memory",
                    content,
                    ContextSourceKind::RetrievedMemory,
                );
                contribution
                    .metadata
                    .insert("includeMode".to_string(), Value::String(mode.to_string()));
                contribution
                    .metadata
                    .insert("candidateKind".to_string(), Value::String(kind.to_string()));
                contribution.metadata.insert(
                    "sourceLevel".to_string(),
                    serde_json::json!(candidate.source_level),
                );
                contribution.metadata.insert(
                    "queryIntent".to_string(),
                    serde_json::json!(candidate.query_intent),
                );
                contribution.metadata.insert(
                    "scoringReason".to_string(),
                    Value::String(candidate.scoring_reason.clone()),
                );
                contribution.metadata.insert(
                    "retrievalBudgetUsedTokens".to_string(),
                    serde_json::json!(candidate.budget_used_tokens),
                );
                contribution
            })
            .collect()
    }
}

fn rich_checkpoint_content(checkpoint: &crate::context::types::LoomCheckpointSummary) -> String {
    let mut sections = vec![checkpoint.summary.clone()];
    if !checkpoint.decisions.is_empty() {
        sections.push(format!("Decisions: {}", checkpoint.decisions.join("; ")));
    }
    if !checkpoint.constraints.is_empty() {
        sections.push(format!(
            "Constraints: {}",
            checkpoint.constraints.join("; ")
        ));
    }
    if !checkpoint.open_questions.is_empty() {
        sections.push(format!(
            "Open questions / risks: {}",
            checkpoint.open_questions.join("; ")
        ));
    }
    if !checkpoint.entities.is_empty() {
        sections.push(format!(
            "Topics/entities: {}",
            checkpoint.entities.join(", ")
        ));
    }
    if !checkpoint.references.is_empty() {
        sections.push(format!(
            "Reference/code block ids: {}",
            checkpoint.references.join(", ")
        ));
    }
    sections.join("\n")
}

fn compact_checkpoint_content(checkpoint: &crate::context::types::LoomCheckpointSummary) -> String {
    let mut content = checkpoint.summary.clone();
    if !checkpoint.decisions.is_empty() {
        content.push_str("\nTop decisions: ");
        content.push_str(
            &checkpoint
                .decisions
                .iter()
                .take(2)
                .cloned()
                .collect::<Vec<_>>()
                .join("; "),
        );
    }
    if !checkpoint.entities.is_empty() {
        content.push_str("\nTop topics: ");
        content.push_str(
            &checkpoint
                .entities
                .iter()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .join(", "),
        );
    }
    content
}

fn rich_capsule_content(capsule: &crate::context::types::ResponseContextCapsule) -> String {
    let mut sections = vec![capsule.summary.clone()];
    if !capsule.key_points.is_empty() {
        sections.push(format!("Key points: {}", capsule.key_points.join("; ")));
    }
    if !capsule.keywords.is_empty() {
        sections.push(format!("Tags/topics: {}", capsule.keywords.join(", ")));
    }
    if !capsule.code_blocks.is_empty() {
        sections.push(format!(
            "Code block refs: {}",
            capsule.code_blocks.join(", ")
        ));
    }
    sections.join("\n")
}

fn compact_capsule_content(capsule: &crate::context::types::ResponseContextCapsule) -> String {
    let mut content = capsule.summary.clone();
    if !capsule.keywords.is_empty() {
        content.push_str("\nTopics: ");
        content.push_str(
            &capsule
                .keywords
                .iter()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .join(", "),
        );
    }
    content
}

fn reference_contribution(reference: &ReferenceContext) -> ContextContribution {
    let title = reference
        .label
        .clone()
        .or_else(|| reference.target_uri.clone())
        .unwrap_or_else(|| "Reference".to_string());
    let content = reference
        .capsule_summary
        .clone()
        .or_else(|| reference.selected_text.clone())
        .unwrap_or_else(|| {
            "Reference metadata is available, but no summary text is ready.".to_string()
        });

    contribution(
        reference.reference_id.clone(),
        title,
        content,
        ContextSourceKind::Reference,
    )
}

fn attachment_contribution(
    attachment: &crate::context::types::AttachmentContext,
) -> ContextContribution {
    let content = match (&attachment.content_text, attachment.parse_status.as_str()) {
        (Some(content), "ready") => format!(
            "Attachment: {}\nType: {}\nParser: {}\n\n{}",
            attachment.file_name,
            attachment
                .content_kind
                .as_deref()
                .unwrap_or(&attachment.kind),
            attachment.parser.as_deref().unwrap_or("unknown"),
            content
        ),
        _ => format!(
            "Attachment '{}' is referenced but parsed content is not ready (status: {}).",
            attachment.file_name, attachment.parse_status
        ),
    };
    contribution(
        attachment.attachment_id.clone(),
        attachment.file_name.clone(),
        content,
        ContextSourceKind::Attachment,
    )
}

fn contribution(
    source_id: impl Into<String>,
    title: impl Into<String>,
    content: impl Into<String>,
    source_kind: ContextSourceKind,
) -> ContextContribution {
    let content = content.into();
    ContextContribution {
        source_id: source_id.into(),
        title: title.into(),
        estimated_tokens: estimate_tokens(&content),
        content,
        source_kind,
        metadata: BTreeMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AttachedReferencesContributor, ContextContributor, LoomCheckpointContributor,
        RecentTurnsContributor, ResponseCapsuleContributor, RetrievedMemoryContributor,
    };
    use crate::context::{
        policies::ordered_contributors,
        types::{
            ArtifactStatus, AttachedReferenceInput, BuildContextInput, ContextSource,
            LoomCheckpointSummary, ReferenceContext, ResponseContextCapsule, ResponseMode,
        },
    };

    #[test]
    fn contributor_ordering_uses_priority() {
        let contributors: Vec<Box<dyn ContextContributor>> = vec![
            Box::new(RecentTurnsContributor),
            Box::new(AttachedReferencesContributor),
            Box::new(LoomCheckpointContributor),
        ];

        let ordered = ordered_contributors(contributors);

        assert_eq!(ordered[0].id(), "attached_references");
        assert_eq!(ordered[1].id(), "loom_checkpoint");
        assert_eq!(ordered[2].id(), "recent_turns");
    }

    #[test]
    fn checkpoint_contributor_uses_richer_content_for_large_context_budget() {
        let contributor = LoomCheckpointContributor;
        let mut input = input_with_checkpoint(16_384);
        let rich = contributor.contribute(&input);
        assert!(rich[0].content.contains("Decisions:"));
        assert!(rich[0].content.contains("Open questions / risks:"));

        input.resolved_num_ctx = 4096;
        let compact = contributor.contribute(&input);
        assert!(compact[0].content.contains("Top decisions:"));
        assert!(compact[0].content.contains("Top topics:"));
        assert!(!compact[0].content.contains("Open questions / risks:"));
    }

    #[test]
    fn response_capsule_contributor_uses_compact_or_rich_capsule_detail() {
        let contributor = ResponseCapsuleContributor;
        let mut input = input_with_capsule(16_384);
        let rich = contributor.contribute(&input);
        assert!(rich[0].content.contains("Key points:"));
        assert!(rich[0].content.contains("Code block refs:"));

        input.resolved_num_ctx = 4096;
        let compact = contributor.contribute(&input);
        assert!(compact[0].content.contains("Topics:"));
        assert!(!compact[0].content.contains("Code block refs:"));
    }

    fn input_with_checkpoint(resolved_num_ctx: u32) -> BuildContextInput {
        BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: None,
            user_prompt: "Continue".to_string(),
            attached_references: Vec::new(),
            response_mode: ResponseMode::Auto,
            resolved_num_ctx,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: Some(LoomCheckpointSummary {
                checkpoint_id: "checkpoint-1".to_string(),
                loom_id: "loom-1".to_string(),
                up_to_response_id: Some("response-4".to_string()),
                summary: "Covered response range: response-1..response-4".to_string(),
                decisions: vec!["Use Event Sourcing".to_string()],
                constraints: vec!["Keep Replay deterministic".to_string()],
                open_questions: vec!["Snapshot cadence".to_string()],
                entities: vec!["Event Sourcing".to_string(), "CQRS".to_string()],
                wefts: Vec::new(),
                references: vec!["code-response-1-0".to_string()],
                source_hash: None,
                status: ArtifactStatus::Ready,
            }),
            memory_messages: Vec::new(),
            recent_messages: Vec::new(),
        }
    }

    fn input_with_capsule(resolved_num_ctx: u32) -> BuildContextInput {
        BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: None,
            user_prompt: "Continue".to_string(),
            attached_references: vec![AttachedReferenceInput {
                reference: ReferenceContext {
                    reference_id: "ref-1".to_string(),
                    label: Some("Event Sourcing".to_string()),
                    target_kind: "response".to_string(),
                    target_id: Some("response-1".to_string()),
                    target_uri: None,
                    selected_text: None,
                    capsule_summary: None,
                },
                response_capsule: Some(ResponseContextCapsule {
                    capsule_id: "capsule-1".to_string(),
                    response_id: "response-1".to_string(),
                    loom_id: "loom-1".to_string(),
                    response_code: None,
                    title: Some("Event Sourcing".to_string()),
                    summary: "Event Sourcing summary".to_string(),
                    key_points: vec!["Decision: Use Event Store".to_string()],
                    keywords: vec!["event sourcing".to_string(), "cqrs".to_string()],
                    entities: vec!["Event Store".to_string()],
                    code_blocks: vec!["code-response-1-0".to_string()],
                    canonical_uri: None,
                    source_hash: None,
                    generator: Some("heuristic_parts_tags".to_string()),
                    status: ArtifactStatus::Ready,
                }),
                attachment: None,
            }],
            response_mode: ResponseMode::Auto,
            resolved_num_ctx,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            memory_messages: Vec::new(),
            recent_messages: Vec::new(),
        }
    }
}
