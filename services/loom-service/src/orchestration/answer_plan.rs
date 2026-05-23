use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnswerIntent {
    SimpleFactual,
    GeneralQuestion,
    ReferenceScopedQuestion,
    MultiReferenceSynthesis,
    CodeTask,
    Summary,
    Comparison,
    Creative,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResponseMode {
    Instant,
    Auto,
    Thinking,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelProfile {
    Main,
    Quick,
    Code,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextStrategy {
    Minimal,
    RecentTurns,
    ReferenceCapsules,
    LoomCheckpoint,
    WeftOrigin,
    FullSourceRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnswerStyle {
    Direct,
    SeparateSections,
    Synthesis,
    StepByStep,
    Bullets,
    Code,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum EstimatedComplexity {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionUnit {
    pub id: String,
    pub question: String,
    pub reference_ids: Vec<String>,
    pub should_answer_separately: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnswerPlan {
    pub intent: AnswerIntent,
    pub response_mode: ResponseMode,
    pub use_thinking: bool,
    pub model_profile: ModelProfile,
    pub context_strategy: ContextStrategy,
    pub answer_style: AnswerStyle,
    pub question_units: Vec<QuestionUnit>,
    pub rewritten_prompt: String,
    pub needs_full_source_text: bool,
    pub needs_exact_quote: bool,
    pub needs_code_context: bool,
    pub estimated_complexity: EstimatedComplexity,
    pub notes_for_context_builder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannerReference {
    pub reference_id: String,
    pub label: Option<String>,
    pub selected_text_preview: Option<String>,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub source_response_code: Option<String>,
    pub source_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannerInput {
    pub clean_user_prompt: String,
    pub prompt_lines: Vec<String>,
    pub attached_references: Vec<PlannerReference>,
    pub selected_response_mode: ResponseMode,
    pub loom_id: Option<String>,
    pub source: Option<String>,
}

impl Default for PlannerInput {
    fn default() -> Self {
        Self {
            clean_user_prompt: String::new(),
            prompt_lines: Vec::new(),
            attached_references: Vec::new(),
            selected_response_mode: ResponseMode::Auto,
            loom_id: None,
            source: None,
        }
    }
}
