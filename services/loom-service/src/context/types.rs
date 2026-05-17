use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextSource {
    Composer,
    Graph,
    Ask,
    Weft,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResponseMode {
    Auto,
    Instant,
    Thinking,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextStrategy {
    Minimal,
    RecentTurns,
    CheckpointAndRecent,
    ReferenceCapsules,
    WeftOriginAndRecent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnswerPlanSummary {
    pub intent: String,
    pub answer_style: String,
    pub context_strategy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildContextInput {
    pub loom_id: String,
    pub current_head_response_id: Option<String>,
    pub user_prompt: String,
    pub attached_references: Vec<AttachedReferenceInput>,
    pub response_mode: ResponseMode,
    pub resolved_num_ctx: u32,
    pub answer_plan: Option<AnswerPlanSummary>,
    pub source: ContextSource,
    pub weft_origin: Option<WeftOriginContext>,
    pub checkpoint: Option<LoomCheckpointSummary>,
    pub recent_messages: Vec<ContextMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltContext {
    pub messages: Vec<ContextMessage>,
    pub artifacts: ContextArtifacts,
    pub budget: ContextBudget,
    pub budget_plan: ContextBudgetPlan,
    pub budget_diagnostics: ContextBudgetDiagnostics,
    pub warnings: Vec<String>,
    pub strategy: ContextStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextMessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextSourceKind {
    SystemPolicy,
    RecentTurn,
    UserPrompt,
    ResponseCapsule,
    LoomCheckpoint,
    WeftOrigin,
    Reference,
    RetrievedMemory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextMessage {
    pub role: ContextMessageRole,
    pub content: String,
    pub source_kind: Option<ContextSourceKind>,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextArtifacts {
    pub checkpoint_id: Option<String>,
    pub response_capsule_ids: Vec<String>,
    pub reference_capsule_ids: Vec<String>,
    pub weft_origin_context_id: Option<String>,
    pub origin_capsule_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextBudget {
    pub max_context: usize,
    pub estimated_used: usize,
    pub reserved_for_answer: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextBudgetPlan {
    pub max_input_tokens: usize,
    pub reserved_output_tokens: usize,
    pub soft_trim_threshold: usize,
    pub hard_trim_threshold: usize,
    pub recent_full_response_limit: usize,
    pub recent_full_token_budget: usize,
    pub capsule_token_budget: usize,
    pub checkpoint_token_budget: usize,
    pub reference_token_budget: usize,
    pub code_block_token_budget: usize,
    pub include_exact_code_blocks: bool,
    pub allow_thinking: bool,
    pub strategy_source: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextCandidateKind {
    CurrentPrompt,
    RecentTurn,
    Reference,
    Capsule,
    Checkpoint,
    CodeBlock,
    RetrievedMemory,
    WeftOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextCandidateBudgetDecision {
    Selected,
    Summarized,
    Downgraded,
    Dropped,
    Overflow,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextCandidateBudgetRecord {
    pub candidate_kind: ContextCandidateKind,
    pub candidate_id: Option<String>,
    pub estimated_tokens: usize,
    pub decision: ContextCandidateBudgetDecision,
    pub reason: String,
    pub priority: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextBudgetDiagnostics {
    pub total_estimated_input_tokens: usize,
    pub reserved_output_tokens: usize,
    pub remaining_input_budget: usize,
    pub soft_trim_threshold: usize,
    pub hard_trim_threshold: usize,
    pub selected_token_estimate: usize,
    pub recent_turns_estimate: usize,
    pub references_estimate: usize,
    pub capsules_estimate: usize,
    pub checkpoints_estimate: usize,
    pub code_blocks_estimate: usize,
    pub retrieval_estimate: usize,
    pub weft_origin_estimate: usize,
    pub selected_candidate_count: usize,
    pub overflow_candidate_count: usize,
    pub dropped_candidate_count: usize,
    pub candidate_records: Vec<ContextCandidateBudgetRecord>,
    pub warnings: Vec<String>,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactStatus {
    Pending,
    Ready,
    Stale,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResponseContextCapsule {
    pub capsule_id: String,
    pub response_id: String,
    pub loom_id: String,
    pub response_code: Option<String>,
    pub title: Option<String>,
    pub summary: String,
    pub key_points: Vec<String>,
    pub keywords: Vec<String>,
    pub entities: Vec<String>,
    pub code_blocks: Vec<String>,
    pub canonical_uri: Option<String>,
    pub source_hash: Option<String>,
    pub generator: Option<String>,
    pub status: ArtifactStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoomCheckpointSummary {
    pub checkpoint_id: String,
    pub loom_id: String,
    pub up_to_response_id: Option<String>,
    pub summary: String,
    pub decisions: Vec<String>,
    pub constraints: Vec<String>,
    pub open_questions: Vec<String>,
    pub entities: Vec<String>,
    pub wefts: Vec<String>,
    pub references: Vec<String>,
    pub source_hash: Option<String>,
    pub status: ArtifactStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeftOriginContext {
    pub context_id: String,
    pub weft_loom_id: String,
    pub origin_loom_id: String,
    pub origin_response_id: String,
    pub origin_capsule_id: Option<String>,
    pub origin_summary: String,
    pub source_hash: Option<String>,
    pub status: ArtifactStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceContext {
    pub reference_id: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub target_uri: Option<String>,
    pub label: Option<String>,
    pub selected_text: Option<String>,
    pub capsule_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachedReferenceInput {
    pub reference: ReferenceContext,
    pub response_capsule: Option<ResponseContextCapsule>,
}

impl ContextMessage {
    pub fn new(
        role: ContextMessageRole,
        content: impl Into<String>,
        source_kind: Option<ContextSourceKind>,
        source_id: Option<String>,
    ) -> Self {
        Self {
            role,
            content: content.into(),
            source_kind,
            source_id,
        }
    }
}
