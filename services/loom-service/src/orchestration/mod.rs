//! Contract-first orchestration layer.
//!
//! This module does not call model providers and does not replace the active
//! TypeScript answer pipeline. It returns structured planning metadata only.
//! Raw chain-of-thought/internal reasoning must never be represented here.

#![allow(dead_code, unused_imports)]

pub mod answer_plan;
pub mod deep_synthesis;
pub mod planner;
pub mod progress;
pub mod workflow;

pub use answer_plan::{
    AnswerIntent, AnswerPlan, AnswerStyle, EstimatedComplexity, ModelProfile, PlannerInput,
    PlannerReference, QuestionUnit, ResponseMode,
};
pub use planner::DeterministicPlanner;
pub use progress::OrchestrationProgressEvent;
pub use workflow::{
    WorkflowRun, WorkflowRunner, WorkflowStage, WorkflowStageKind, WorkflowStageStatus,
};
