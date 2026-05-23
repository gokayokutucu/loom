//! Rust-side ContextManager contract and deterministic context policy layer.
//!
//! This module is intentionally contract-first. It does not replace the active
//! TypeScript Context Builder yet and it does not call model providers.
//! Raw model thinking/internal monologue must never enter context messages,
//! context contributions, artifacts, exports, checkpoints, capsules, or prompts.

#![allow(dead_code, unused_imports)]

pub mod artifact_loader;
pub mod budget;
pub mod contributors;
#[cfg(test)]
mod eval_suite;
pub mod manager;
pub mod policies;
pub mod readiness;
pub mod refinement;
pub mod retrieval;
pub mod types;
pub mod worker;

pub use artifact_loader::{ArtifactWarning, RepositoryContextLoader};
pub use budget::{
    estimate_tokens, limit_recent_messages_for_plan, resolve_context_budget,
    resolve_context_budget_plan,
};
pub use contributors::{
    AttachedReferencesContributor, ContextContribution, ContextContributor,
    LoomCheckpointContributor, RecentTurnsContributor, ResponseCapsuleContributor,
    RetrievedMemoryContributor, WeftOriginContributor,
};
pub use manager::ContextManager;
pub use policies::{ordered_contributors, select_context_strategy};
pub use readiness::{
    ContextBuildJob, ContextReadinessGate, ContextReadinessInput, ContextReadinessResult,
    ContextReadinessStatus, RequiredContextArtifact, RequiredContextArtifactType,
};
pub use refinement::{
    ArtifactRefinementProvider, LoomCheckpointRefinement, LoomCheckpointRefinementInput,
    ResponseCapsuleRefinement, ResponseCapsuleRefinementInput,
};
pub use retrieval::{
    ContextRetrievalCandidate, ContextRetrievalCandidateKind, ContextRetrievalIncludeMode,
    ContextRetrievalResult, ContextRetriever, ContextSourceLevel, QueryIntentKind,
};
pub use types::{
    AnswerPlanSummary, ArtifactStatus, AttachedReferenceInput, BuildContextInput, BuiltContext,
    ContextArtifacts, ContextBudget, ContextBudgetPlan, ContextMessage, ContextMessageRole,
    ContextSource, ContextSourceKind, ContextStrategy, LoomCheckpointSummary, ReferenceContext,
    ResponseContextCapsule, ResponseMode, WeftOriginContext,
};
pub use worker::{ContextArtifactWorker, ContextWorkerRunOptions, ContextWorkerRunResult};
