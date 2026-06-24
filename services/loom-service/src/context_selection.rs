#![allow(dead_code)]
// LOOM_BOUNDARY:
// marker: V1_CANONICAL_KNOWLEDGE_LAYER
// owner_layer: V1 Knowledge
// migration_status: consumed_by_v2
// rules:
// - Context Selection is canonical passive Knowledge Layer infrastructure.
// - V2 AgentRuntime must consume this layer instead of duplicating ranking or treating context as tools.
// next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
//! Metadata-only Context Selection foundation.
//!
//! This layer assigns source tiers and within-tier order. It does not resolve
//! full content, enforce a hard token budget, or assemble prompts.

use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap, HashSet},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::ServiceError,
    retrieval::hybrid_service::{RankSignals, RetrievalCandidate, RetrievalResult},
    scope_resolution::{ScopeContext, ScopeStatus, ScopeType},
    storage::{
        db::Database,
        repositories::context_snapshots::{
            ContextSnapshotCandidateCreateRequest, ContextSnapshotCreateRequest,
            ContextSnapshotRepository,
        },
    },
};

const MAX_PREVIEW_CHARS: usize = 240;
const SELECTION_VERSION: &str = "context-selection-v1";
const POLICY_VERSION: &str = "context-selection-policy-v1";
const FORBIDDEN_TEXT_MARKERS: [&str; 17] = [
    "rawthinking",
    "thinkingtext",
    "chainofthought",
    "hiddenreasoning",
    "providerpayload",
    "providerdelta",
    "promptenvelope",
    "authorization",
    "bearer",
    "apikey",
    "password",
    "credential",
    "secret",
    "rawtooloutput",
    "agentevents",
    "agentruns",
    "agentsteps",
];

// LOOM_BOUNDARY:
// marker: V1_CONSUMED_BY_V2
// owner_layer: V1 Knowledge
// migration_status: consumed_by_v2
// rules:
// - Request metadata is the V2-consumable context selection contract.
// - Do not add prompt/provider payload fields here.
// next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
#[derive(Debug, Clone)]
pub struct ContextSelectionRequest {
    pub active_loom_id: String,
    pub agent_run_id: Option<String>,
    pub response_id: Option<String>,
    pub scope_context: ScopeContext,
    pub retrieval_result: RetrievalResult,
    pub mandatory_policy_entries: Vec<MandatoryPolicyEntry>,
    pub budget_hint: Option<ContextBudgetHint>,
    pub query_intent: QueryIntentKind,
    pub mode: ContextSelectionMode,
    pub persist_snapshot: bool,
    pub snapshot_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MandatoryPolicyEntry {
    pub policy_id: String,
    pub policy_kind: PolicyKind,
    pub estimated_tokens: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyKind {
    SystemPolicy,
    OperatorInstruction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextBudgetHint {
    pub approximate_input_budget: usize,
    pub max_retrieval_candidates: usize,
    pub cross_loom_candidate_cap: usize,
    pub archived_candidate_cap: usize,
    pub conversation_turn_cap: usize,
}

impl Default for ContextBudgetHint {
    fn default() -> Self {
        Self {
            approximate_input_budget: 8_192,
            max_retrieval_candidates: 10,
            cross_loom_candidate_cap: 5,
            archived_candidate_cap: 3,
            conversation_turn_cap: 12,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSelectionMode {
    Standard,
    CompactSummary,
    CodeFocused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryIntentKind {
    EntityFactual,
    Code,
    Temporal,
    Decision,
    FileDocument,
    General,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSourceTier {
    PolicyAlwaysInclude,
    ConversationThread,
    WeftOriginChain,
    ProjectGroup,
    ScopedMemory,
    GlobalMemory,
    ConversationAttachment,
    ProjectAttachment,
    ScopedRetrieval,
    CrossConversationRetrieval,
    ArchivedRetrieval,
    ToolMcpContext,
}

impl ContextSourceTier {
    pub fn priority(self) -> u8 {
        match self {
            Self::PolicyAlwaysInclude => 1,
            Self::ConversationThread => 2,
            Self::WeftOriginChain => 3,
            Self::ProjectGroup => 4,
            Self::ScopedMemory | Self::GlobalMemory => 5,
            Self::ConversationAttachment => 6,
            Self::ProjectAttachment => 7,
            Self::ScopedRetrieval => 8,
            Self::CrossConversationRetrieval => 9,
            Self::ArchivedRetrieval => 10,
            Self::ToolMcpContext => 11,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::PolicyAlwaysInclude => "policy_always_include",
            Self::ConversationThread => "conversation_thread",
            Self::WeftOriginChain => "weft_origin_chain",
            Self::ProjectGroup => "project_group",
            Self::ScopedMemory => "scoped_memory",
            Self::GlobalMemory => "global_memory",
            Self::ConversationAttachment => "conversation_attachment",
            Self::ProjectAttachment => "project_attachment",
            Self::ScopedRetrieval => "scoped_retrieval",
            Self::CrossConversationRetrieval => "cross_conversation_retrieval",
            Self::ArchivedRetrieval => "archived_retrieval",
            Self::ToolMcpContext => "tool_mcp_context",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextIncludeModeHint {
    Full,
    Capsule,
    ReferenceOnly,
    CodeExact,
    CodeSummary,
}

impl ContextIncludeModeHint {
    fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Capsule => "capsule",
            Self::ReferenceOnly => "reference_only",
            Self::CodeExact => "code_exact",
            Self::CodeSummary => "code_summary",
        }
    }
}

// LOOM_BOUNDARY:
// marker: V1_CANONICAL_KNOWLEDGE_LAYER
// owner_layer: V1 Knowledge
// migration_status: canonical
// rules:
// - Context candidates are passive context identities, not Tool invocations.
// - Preserve source identity and privacy-safe preview boundaries.
// next_task: none
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCandidate {
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: Option<String>,
    pub tier: ContextSourceTier,
    pub tier_priority: u8,
    pub retrieval_score: Option<f32>,
    pub within_tier_rank: u32,
    pub estimated_tokens: usize,
    pub include_mode_hint: ContextIncludeModeHint,
    pub is_hidden_background: bool,
    pub is_mandatory: bool,
    pub is_explicit_reference: bool,
    pub text_preview: Option<String>,
    pub rank_signals: Option<RankSignals>,
}

// LOOM_BOUNDARY:
// marker: V1_CONSUMED_BY_V2
// owner_layer: V1 Knowledge
// migration_status: consumed_by_v2
// rules:
// - Payload is the canonical selected context handoff to the Context Manager and V2 AgentRuntime.
// - Do not store full prompt text or provider payloads here.
// next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPayload {
    pub active_loom_id: String,
    pub agent_run_id: Option<String>,
    pub policy_entries: Vec<MandatoryPolicyEntry>,
    pub mandatory_references: Vec<ContextCandidate>,
    pub conversation_turns: Vec<ContextCandidate>,
    pub weft_origin_chain: Vec<ContextCandidate>,
    pub scoped_memories: Vec<ContextCandidate>,
    pub global_memories: Vec<ContextCandidate>,
    pub conversation_attachments: Vec<ContextCandidate>,
    pub scoped_retrieval: Vec<ContextCandidate>,
    pub cross_conversation_retrieval: Vec<ContextCandidate>,
    pub archived_retrieval: Vec<ContextCandidate>,
    pub query_intent: QueryIntentKind,
    pub code_relevance_detected: bool,
    pub weft_loom: bool,
    pub snapshot_id: Option<String>,
    pub selection_diagnostics: ContextSelectionDiagnostics,
}

impl ContextPayload {
    pub fn candidates_in_tier_order(&self) -> Vec<&ContextCandidate> {
        [
            &self.mandatory_references,
            &self.conversation_turns,
            &self.weft_origin_chain,
            &self.scoped_memories,
            &self.global_memories,
            &self.conversation_attachments,
            &self.scoped_retrieval,
            &self.cross_conversation_retrieval,
            &self.archived_retrieval,
        ]
        .into_iter()
        .flat_map(|candidates| candidates.iter())
        .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSelectionDiagnostics {
    pub tiers: Vec<TierDiagnostic>,
    pub total_candidates_evaluated: usize,
    pub total_candidates_selected: usize,
    pub total_estimated_tokens: usize,
    pub code_relevance_detected: bool,
    pub query_intent: QueryIntentKind,
    pub weft_loom: bool,
    pub weft_lineage_depth: u8,
    pub explicit_references_count: usize,
    pub reserved_scopes_count: usize,
    pub cross_loom_retrieval_activated: bool,
    pub cross_loom_candidates_before_cap: usize,
    pub cross_loom_candidates_after_cap: usize,
    pub archived_retrieval_activated: bool,
    pub archived_candidates_before_cap: usize,
    pub archived_candidates_after_cap: usize,
    pub scoped_memory_candidates: usize,
    pub global_memory_candidates: usize,
    pub memory_type_weight_applied: bool,
    pub memory_active_considered: usize,
    pub memory_scoped_selected: usize,
    pub memory_global_selected: usize,
    pub memory_global_masked: usize,
    pub memory_always_include_selected: usize,
    pub memory_deleted_unconfirmed_excluded: usize,
    pub attachment_candidates: usize,
    pub attachment_parse_status_drops: usize,
    pub scope_resolution_latency_ms: u64,
    pub retrieval_latency_ms: u64,
    pub selection_latency_ms: u64,
    pub total_pipeline_latency_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierDiagnostic {
    pub tier: ContextSourceTier,
    pub tier_number: u8,
    pub status: TierDiagnosticStatus,
    pub candidates_evaluated: usize,
    pub candidates_selected: usize,
    pub budget_hint_limited: bool,
    pub estimated_tokens: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TierDiagnosticStatus {
    Populated,
    Empty,
    Skipped,
    Reserved,
}

#[derive(Debug, Clone)]
pub struct ContextSelectionPolicy {
    pub explicit_user_memory_weight: f32,
    pub inferred_preference_weight: f32,
    pub other_confirmed_memory_weight: f32,
    pub retrieval_reference_weight: f32,
}

impl Default for ContextSelectionPolicy {
    fn default() -> Self {
        Self {
            explicit_user_memory_weight: 1.2,
            inferred_preference_weight: 1.0,
            other_confirmed_memory_weight: 1.0,
            retrieval_reference_weight: 1.5,
        }
    }
}

// LOOM_BOUNDARY:
// marker: V1_CANONICAL_KNOWLEDGE_LAYER
// owner_layer: V1 Knowledge
// migration_status: canonical
// rules:
// - Selection service owns passive context ranking only.
// - Must not execute tools or providers.
// next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
#[derive(Debug, Clone)]
pub struct ContextSelectionService {
    pool: SqlitePool,
    snapshots: ContextSnapshotRepository,
    policy: ContextSelectionPolicy,
}

#[derive(Debug, Clone)]
struct RankedCandidate {
    candidate: ContextCandidate,
    adjusted_score: f32,
}

#[derive(Debug, Clone)]
struct RejectedCandidate {
    candidate: ContextCandidate,
    reason: &'static str,
}

#[derive(Debug, Clone, Default)]
struct SelectionAccounting {
    evaluated: BTreeMap<ContextSourceTier, usize>,
    capped: BTreeMap<ContextSourceTier, usize>,
    attachment_parse_status_drops: usize,
    memory_weight_applied: bool,
}

#[derive(Debug, Clone)]
struct MemoryReadMetadata {
    memory_id: String,
    memory_type: String,
    source_loom_id: Option<String>,
    always_include: bool,
    content_length: usize,
}

#[derive(Debug, Clone, Default)]
struct MemoryReadPolicy {
    eligible_by_id: HashMap<String, MemoryReadMetadata>,
    always_include: Vec<MemoryReadMetadata>,
    active_considered: usize,
    global_masked: usize,
    deleted_unconfirmed_excluded: usize,
}

impl ContextSelectionService {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
            snapshots: ContextSnapshotRepository::new(database),
            policy: ContextSelectionPolicy::default(),
        }
    }

    pub fn with_policy(mut self, policy: ContextSelectionPolicy) -> Self {
        self.policy = policy;
        self
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V1_CONSUMED_BY_V2
    // role: selects passive Knowledge Layer context identities for an AgentRun or legacy flow
    // rules: V2 must call this instead of duplicating context ranking; no tool/provider execution here.
    // next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
    pub async fn select(
        &self,
        request: ContextSelectionRequest,
    ) -> Result<ContextPayload, ServiceError> {
        let started = Instant::now();
        validate_request(&request)?;
        let budget = request.budget_hint.clone().unwrap_or_default();
        let code_relevance = request.query_intent == QueryIntentKind::Code
            || request.mode == ContextSelectionMode::CodeFocused;
        let mut accounting = SelectionAccounting::default();
        let mut seen = HashSet::new();
        let memory_read_policy = self.memory_read_policy(&request.active_loom_id).await?;

        let policy_entries = validate_policy_entries(request.mandatory_policy_entries.clone())?;
        *accounting
            .evaluated
            .entry(ContextSourceTier::PolicyAlwaysInclude)
            .or_default() += policy_entries.len();

        let mut mandatory_references =
            self.always_include_memories(&memory_read_policy, &mut accounting);
        mandatory_references.extend(
            self.mandatory_references(&request.scope_context, &mut accounting)
                .await?,
        );
        retain_new_identities(&mut mandatory_references, &mut seen);
        let mut conversation_turns = self
            .conversation_turns(&request.active_loom_id, &budget, &mut accounting)
            .await?;
        retain_new_identities(&mut conversation_turns, &mut seen);
        let mut weft_origin_chain = self
            .weft_origin_chain(&request.scope_context, &mut accounting)
            .await?;
        retain_new_identities(&mut weft_origin_chain, &mut seen);

        let mut scoped_memories = Vec::new();
        let mut global_memories = Vec::new();
        let mut conversation_attachments = Vec::new();
        let mut scoped_retrieval = Vec::new();
        let mut cross_retrieval = Vec::new();
        let mut archived_retrieval = Vec::new();

        for retrieval in &request.retrieval_result.candidates {
            let Some(ranked) = self
                .transform_retrieval_candidate(
                    retrieval,
                    &request,
                    code_relevance,
                    &memory_read_policy,
                    &mut accounting,
                )
                .await?
            else {
                continue;
            };
            if !seen.insert(candidate_identity(&ranked.candidate)) {
                continue;
            }
            match ranked.candidate.tier {
                ContextSourceTier::ScopedMemory => scoped_memories.push(ranked),
                ContextSourceTier::GlobalMemory => global_memories.push(ranked),
                ContextSourceTier::ConversationAttachment => conversation_attachments.push(ranked),
                ContextSourceTier::ScopedRetrieval => scoped_retrieval.push(ranked),
                ContextSourceTier::CrossConversationRetrieval => cross_retrieval.push(ranked),
                ContextSourceTier::ArchivedRetrieval => archived_retrieval.push(ranked),
                _ => {}
            }
        }

        let cross_before_cap = cross_retrieval.len();
        let archived_before_cap = archived_retrieval.len();
        let mut rejected = Vec::new();
        let scoped_memories = rank_and_cap(
            scoped_memories,
            budget.max_retrieval_candidates,
            &mut accounting,
            &mut rejected,
        );
        let global_memories = rank_and_cap(
            global_memories,
            budget.max_retrieval_candidates,
            &mut accounting,
            &mut rejected,
        );
        let conversation_attachments = rank_and_cap(
            conversation_attachments,
            budget.max_retrieval_candidates,
            &mut accounting,
            &mut rejected,
        );
        let scoped_retrieval = rank_and_cap(
            scoped_retrieval,
            budget.max_retrieval_candidates,
            &mut accounting,
            &mut rejected,
        );
        let cross_conversation_retrieval = rank_and_cap(
            cross_retrieval,
            budget.cross_loom_candidate_cap,
            &mut accounting,
            &mut rejected,
        );
        let archived_retrieval = rank_and_cap(
            archived_retrieval,
            budget.archived_candidate_cap,
            &mut accounting,
            &mut rejected,
        );

        let selected_groups: [&[ContextCandidate]; 9] = [
            &mandatory_references,
            &conversation_turns,
            &weft_origin_chain,
            &scoped_memories,
            &global_memories,
            &conversation_attachments,
            &scoped_retrieval,
            &cross_conversation_retrieval,
            &archived_retrieval,
        ];
        let mut selected_by_tier = selected_counts_by_tier(&selected_groups);
        let mut estimated_by_tier = estimated_tokens_by_tier(&selected_groups);
        *selected_by_tier
            .entry(ContextSourceTier::PolicyAlwaysInclude)
            .or_default() += policy_entries.len();
        *estimated_by_tier
            .entry(ContextSourceTier::PolicyAlwaysInclude)
            .or_default() += policy_entries
            .iter()
            .map(|entry| entry.estimated_tokens)
            .sum::<usize>();
        let selected_candidate_count = selected_groups
            .iter()
            .map(|candidates| candidates.len())
            .sum::<usize>();
        let total_estimated_tokens = policy_entries
            .iter()
            .map(|entry| entry.estimated_tokens)
            .sum::<usize>()
            + selected_groups
                .iter()
                .flat_map(|candidates| candidates.iter())
                .map(|candidate| candidate.estimated_tokens)
                .sum::<usize>();
        let selection_latency = started.elapsed().as_millis() as u64;
        let diagnostics = build_diagnostics(
            &request,
            &accounting,
            &selected_by_tier,
            &estimated_by_tier,
            selected_candidate_count + policy_entries.len(),
            total_estimated_tokens,
            code_relevance,
            cross_before_cap,
            cross_conversation_retrieval.len(),
            archived_before_cap,
            archived_retrieval.len(),
            scoped_memories.len(),
            global_memories.len(),
            conversation_attachments.len(),
            &memory_read_policy,
            selection_latency,
        );

        let mut payload = ContextPayload {
            active_loom_id: request.active_loom_id.clone(),
            agent_run_id: request.agent_run_id.clone(),
            policy_entries,
            mandatory_references,
            conversation_turns,
            weft_origin_chain,
            scoped_memories,
            global_memories,
            conversation_attachments,
            scoped_retrieval,
            cross_conversation_retrieval,
            archived_retrieval,
            query_intent: request.query_intent,
            code_relevance_detected: code_relevance,
            weft_loom: request.scope_context.weft_loom_detected,
            snapshot_id: None,
            selection_diagnostics: diagnostics,
        };

        if request.persist_snapshot {
            let snapshot_id = request
                .snapshot_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            self.persist_snapshot(&request, &payload, &rejected, &snapshot_id)
                .await?;
            payload.snapshot_id = Some(snapshot_id);
        }
        Ok(payload)
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V1_CANONICAL_KNOWLEDGE_LAYER
    // role: validates explicit Reference identities as mandatory context
    // rules: Passive reference context loading is not a tool.
    // next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
    async fn mandatory_references(
        &self,
        scope: &ScopeContext,
        accounting: &mut SelectionAccounting,
    ) -> Result<Vec<ContextCandidate>, ServiceError> {
        let ids = scope
            .scopes
            .iter()
            .find(|descriptor| descriptor.scope_type == ScopeType::CurrentConversation)
            .map(|descriptor| descriptor.explicit_reference_ids.clone())
            .unwrap_or_default();
        let mut candidates = Vec::new();
        for reference_id in ids {
            *accounting
                .evaluated
                .entry(ContextSourceTier::PolicyAlwaysInclude)
                .or_default() += 1;
            let exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM \"references\" WHERE reference_id = ?1",
            )
            .bind(&reference_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to validate mandatory reference: {error}"))
            })?;
            if exists == 0 {
                continue;
            }
            candidates.push(ContextCandidate {
                source_kind: "reference".to_string(),
                source_id: reference_id,
                chunk_ref: None,
                tier: ContextSourceTier::PolicyAlwaysInclude,
                tier_priority: 1,
                retrieval_score: None,
                within_tier_rank: candidates.len() as u32 + 1,
                estimated_tokens: 0,
                include_mode_hint: ContextIncludeModeHint::Full,
                is_hidden_background: false,
                is_mandatory: true,
                is_explicit_reference: true,
                text_preview: None,
                rank_signals: None,
            });
        }
        Ok(candidates)
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V1_CANONICAL_KNOWLEDGE_LAYER
    // role: loads Memory read-policy metadata for passive context selection
    // rules: Memory selection is Knowledge Layer context, not Tool Runtime execution.
    // next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
    async fn memory_read_policy(
        &self,
        active_loom_id: &str,
    ) -> Result<MemoryReadPolicy, ServiceError> {
        let rows = sqlx::query(
            "SELECT memory_id, memory_type, source_loom_id, topic_key, always_include,
                    user_confirmed, deleted_at, LENGTH(content) AS content_length
             FROM memories
             WHERE source_loom_id IS NULL OR source_loom_id = ?1
             ORDER BY CASE WHEN source_loom_id = ?1 THEN 0 ELSE 1 END,
                      memory_type ASC, created_at ASC, memory_id ASC",
        )
        .bind(active_loom_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to load Memory read-policy metadata: {error}"
            ))
        })?;
        let deleted_unconfirmed_excluded = rows
            .iter()
            .filter(|row| {
                !row.get::<bool, _>("user_confirmed")
                    || row.get::<Option<String>, _>("deleted_at").is_some()
            })
            .count();
        let active_rows = rows
            .into_iter()
            .filter(|row| {
                row.get::<bool, _>("user_confirmed")
                    && row.get::<Option<String>, _>("deleted_at").is_none()
            })
            .collect::<Vec<_>>();
        let active_considered = active_rows.len();
        let scoped_topic_keys = active_rows
            .iter()
            .filter(|row| row.get::<Option<String>, _>("source_loom_id").is_some())
            .filter_map(|row| row.get::<Option<String>, _>("topic_key"))
            .collect::<HashSet<_>>();
        let global_masked = active_rows
            .iter()
            .filter(|row| row.get::<Option<String>, _>("source_loom_id").is_none())
            .filter_map(|row| row.get::<Option<String>, _>("topic_key"))
            .filter(|topic_key| scoped_topic_keys.contains(topic_key))
            .count();
        let eligible = active_rows
            .into_iter()
            .filter(|row| {
                let global_topic_key = row
                    .get::<Option<String>, _>("source_loom_id")
                    .is_none()
                    .then(|| row.get::<Option<String>, _>("topic_key"))
                    .flatten();
                global_topic_key
                    .as_ref()
                    .is_none_or(|topic_key| !scoped_topic_keys.contains(topic_key))
            })
            .map(|row| MemoryReadMetadata {
                memory_id: row.get("memory_id"),
                memory_type: row.get("memory_type"),
                source_loom_id: row.get("source_loom_id"),
                always_include: row.get("always_include"),
                content_length: row.get::<i64, _>("content_length") as usize,
            })
            .collect::<Vec<_>>();
        let always_include = eligible
            .iter()
            .filter(|memory| {
                memory.always_include
                    && matches!(
                        memory.memory_type.as_str(),
                        "explicit_user_memory" | "profile_preference"
                    )
            })
            .cloned()
            .collect();
        Ok(MemoryReadPolicy {
            eligible_by_id: eligible
                .into_iter()
                .map(|memory| (memory.memory_id.clone(), memory))
                .collect(),
            always_include,
            active_considered,
            global_masked,
            deleted_unconfirmed_excluded,
        })
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V1_CANONICAL_KNOWLEDGE_LAYER
    // role: promotes always-include Memory records into mandatory context candidates
    // rules: Passive memory injection must remain outside Tool Runtime.
    // next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
    fn always_include_memories(
        &self,
        policy: &MemoryReadPolicy,
        accounting: &mut SelectionAccounting,
    ) -> Vec<ContextCandidate> {
        *accounting
            .evaluated
            .entry(ContextSourceTier::PolicyAlwaysInclude)
            .or_default() += policy.always_include.len();
        policy
            .always_include
            .iter()
            .enumerate()
            .map(|(index, memory)| ContextCandidate {
                source_kind: "memory".to_string(),
                source_id: memory.memory_id.clone(),
                chunk_ref: None,
                tier: ContextSourceTier::PolicyAlwaysInclude,
                tier_priority: ContextSourceTier::PolicyAlwaysInclude.priority(),
                retrieval_score: None,
                within_tier_rank: index as u32 + 1,
                estimated_tokens: estimate_tokens(memory.content_length),
                include_mode_hint: ContextIncludeModeHint::Full,
                is_hidden_background: false,
                is_mandatory: true,
                is_explicit_reference: false,
                text_preview: None,
                rank_signals: None,
            })
            .collect()
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V1_CANONICAL_KNOWLEDGE_LAYER
    // role: loads current conversation candidates for context selection
    // rules: Passive conversation context loading is not a tool.
    // next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
    async fn conversation_turns(
        &self,
        active_loom_id: &str,
        budget: &ContextBudgetHint,
        accounting: &mut SelectionAccounting,
    ) -> Result<Vec<ContextCandidate>, ServiceError> {
        let limit = budget.conversation_turn_cap.min(i64::MAX as usize) as i64;
        let rows = sqlx::query(
            "SELECT response_id, sequence_index, LENGTH(content) AS content_length
             FROM responses
             WHERE loom_id = ?1 AND is_deleted = 0
             ORDER BY sequence_index DESC, response_id ASC
             LIMIT ?2",
        )
        .bind(active_loom_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to load conversation metadata: {error}"))
        })?;
        *accounting
            .evaluated
            .entry(ContextSourceTier::ConversationThread)
            .or_default() += rows.len();
        Ok(rows
            .into_iter()
            .enumerate()
            .map(|(index, row)| ContextCandidate {
                source_kind: "response".to_string(),
                source_id: row.get("response_id"),
                chunk_ref: None,
                tier: ContextSourceTier::ConversationThread,
                tier_priority: 2,
                retrieval_score: None,
                within_tier_rank: index as u32 + 1,
                estimated_tokens: estimate_tokens(row.get::<i64, _>("content_length") as usize),
                include_mode_hint: if index < 4 {
                    ContextIncludeModeHint::Full
                } else {
                    ContextIncludeModeHint::Capsule
                },
                is_hidden_background: false,
                is_mandatory: false,
                is_explicit_reference: false,
                text_preview: None,
                rank_signals: None,
            })
            .collect())
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V1_CANONICAL_KNOWLEDGE_LAYER
    // role: loads Weft origin lineage as hidden background context
    // rules: Weft lineage is canonical Knowledge Layer data consumed by V2.
    // next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
    async fn weft_origin_chain(
        &self,
        scope: &ScopeContext,
        accounting: &mut SelectionAccounting,
    ) -> Result<Vec<ContextCandidate>, ServiceError> {
        let mut candidates = Vec::new();
        let mut descriptors = scope
            .scopes
            .iter()
            .filter(|descriptor| descriptor.scope_type == ScopeType::WeftOriginChain)
            .filter(|descriptor| descriptor.hidden_background)
            .collect::<Vec<_>>();
        descriptors.sort_by_key(|descriptor| descriptor.lineage_depth.unwrap_or(u8::MAX));
        let mut weft_loom_id = scope.active_loom_id.clone();
        for descriptor in descriptors {
            let Some(origin_response_id) = descriptor.origin_response_id.as_deref() else {
                continue;
            };
            let row = sqlx::query(
                "SELECT context_id, origin_capsule_id
                 FROM weft_origin_contexts
                 WHERE weft_loom_id = ?1 AND origin_response_id = ?2 AND status = 'ready'
                 ORDER BY updated_at DESC LIMIT 1",
            )
            .bind(&weft_loom_id)
            .bind(origin_response_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to load Weft origin metadata: {error}"))
            })?;
            if let Some(row) = row {
                let rank = candidates.len() as u32 + 1;
                candidates.push(structural_background_candidate(
                    "weft_origin",
                    row.get("context_id"),
                    rank,
                ));
                if let Some(capsule_id) = row.get::<Option<String>, _>("origin_capsule_id") {
                    let rank = candidates.len() as u32 + 1;
                    candidates.push(structural_background_candidate(
                        "response_capsule",
                        capsule_id,
                        rank,
                    ));
                }
            } else {
                let rank = candidates.len() as u32 + 1;
                candidates.push(structural_background_candidate(
                    "response",
                    origin_response_id.to_string(),
                    rank,
                ));
            }
            if let Some(origin_loom_id) = &descriptor.origin_loom_id {
                weft_loom_id.clone_from(origin_loom_id);
            }
        }
        *accounting
            .evaluated
            .entry(ContextSourceTier::WeftOriginChain)
            .or_default() += candidates.len();
        Ok(candidates)
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V1_CANONICAL_KNOWLEDGE_LAYER
    // role: maps retrieval projection candidates into canonical context candidates
    // rules: Retrieval projections are rebuildable Knowledge Layer signals, not Agent state.
    // next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
    async fn transform_retrieval_candidate(
        &self,
        source: &RetrievalCandidate,
        request: &ContextSelectionRequest,
        code_relevance: bool,
        memory_read_policy: &MemoryReadPolicy,
        accounting: &mut SelectionAccounting,
    ) -> Result<Option<RankedCandidate>, ServiceError> {
        if !allowed_source_kind(&source.source_kind) {
            return Ok(None);
        }
        let Some(tier) = classify_retrieval_tier(source, request) else {
            return Ok(None);
        };
        *accounting.evaluated.entry(tier).or_default() += 1;
        let mut adjusted_score = source.relevance_score;
        let mut include_mode = if code_relevance && source.source_kind == "response" {
            ContextIncludeModeHint::CodeExact
        } else {
            ContextIncludeModeHint::Full
        };

        if source.source_kind == "memory" {
            let Some(memory) = memory_read_policy.eligible_by_id.get(&source.source_id) else {
                return Ok(None);
            };
            let verified_tier =
                if memory.source_loom_id.as_deref() == Some(request.active_loom_id.as_str()) {
                    ContextSourceTier::ScopedMemory
                } else {
                    ContextSourceTier::GlobalMemory
                };
            if tier != verified_tier {
                return Ok(None);
            }
            adjusted_score *= match memory.memory_type.as_str() {
                "explicit_user_memory" | "profile_preference" => {
                    self.policy.explicit_user_memory_weight
                }
                "inferred_preference" => self.policy.inferred_preference_weight,
                _ => self.policy.other_confirmed_memory_weight,
            };
            accounting.memory_weight_applied = true;
        }

        if source.source_kind == "attachment_chunk" {
            let ready = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*)
                 FROM attachment_parse_artifact_chunks c
                 JOIN attachments a ON a.parse_artifact_id = c.parse_artifact_id
                 WHERE c.chunk_id = ?1 AND a.loom_id = ?2 AND a.parse_status = 'ready'",
            )
            .bind(&source.source_id)
            .bind(&request.active_loom_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to validate attachment metadata: {error}"))
            })?;
            if ready == 0 {
                accounting.attachment_parse_status_drops += 1;
                return Ok(None);
            }
        }

        if tier == ContextSourceTier::ScopedRetrieval && source.source_kind == "reference" {
            adjusted_score *= self.policy.retrieval_reference_weight;
        }
        let estimated_tokens = source
            .text_preview
            .as_deref()
            .map(|preview| estimate_tokens(preview.chars().count()))
            .unwrap_or_default();
        if source.source_kind == "attachment_chunk" && estimated_tokens > 500 {
            include_mode = ContextIncludeModeHint::Capsule;
        }
        Ok(Some(RankedCandidate {
            candidate: ContextCandidate {
                source_kind: source.source_kind.clone(),
                source_id: source.source_id.clone(),
                chunk_ref: Some(source.chunk_ref.clone()),
                tier,
                tier_priority: tier.priority(),
                retrieval_score: Some(source.relevance_score),
                within_tier_rank: 0,
                estimated_tokens,
                include_mode_hint: include_mode,
                is_hidden_background: false,
                is_mandatory: false,
                is_explicit_reference: false,
                text_preview: bounded_safe_preview(source.text_preview.as_deref()),
                rank_signals: Some(source.rank_signals.clone()),
            },
            adjusted_score,
        }))
    }

    // LOOM_BOUNDARY_METHOD:
    // marker: V1_CONSUMED_BY_V2
    // role: persists metadata-only Context Snapshot audit records
    // rules: Snapshot persistence is a Knowledge Layer audit seam; never persist prompt/provider payloads.
    // next_task: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
    async fn persist_snapshot(
        &self,
        request: &ContextSelectionRequest,
        payload: &ContextPayload,
        rejected: &[RejectedCandidate],
        snapshot_id: &str,
    ) -> Result<(), ServiceError> {
        let selected = payload.candidates_in_tier_order();
        let candidate_count = selected.len() + rejected.len();
        let budget_json = serde_json::json!({
            "approximateInputBudget": request.budget_hint.as_ref().map(|hint| hint.approximate_input_budget),
            "candidatesPresented": candidate_count,
            "candidatesIncluded": selected.len(),
            "candidatesRejected": rejected.len()
        })
        .to_string();
        let diagnostics_json =
            serde_json::to_string(&payload.selection_diagnostics).map_err(|error| {
                ServiceError::storage(format!(
                    "failed to serialize selection diagnostics: {error}"
                ))
            })?;
        let parent = ContextSnapshotCreateRequest {
            snapshot_id: snapshot_id.to_string(),
            agent_run_id: request.agent_run_id.clone(),
            loom_id: request.active_loom_id.clone(),
            response_id: request.response_id.clone(),
            scope_context_id: None,
            created_at: timestamp(),
            policy_version: POLICY_VERSION.to_string(),
            selection_version: SELECTION_VERSION.to_string(),
            budget_json,
            diagnostics_json,
            candidate_count: candidate_count as i64,
            selected_count: selected.len() as i64,
            rejected_count: rejected.len() as i64,
        };
        let mut rows = Vec::with_capacity(candidate_count);
        for (index, candidate) in selected.into_iter().enumerate() {
            rows.push(snapshot_candidate(
                snapshot_id,
                candidate,
                index + 1,
                true,
                None,
            ));
        }
        for rejected_candidate in rejected {
            let rank = rows.len() + 1;
            rows.push(snapshot_candidate(
                snapshot_id,
                &rejected_candidate.candidate,
                rank,
                false,
                Some(rejected_candidate.reason),
            ));
        }
        self.snapshots
            .create_snapshot_with_candidates(&parent, &rows)
            .await
    }
}

fn validate_request(request: &ContextSelectionRequest) -> Result<(), ServiceError> {
    if request.active_loom_id != request.scope_context.active_loom_id {
        return Err(ServiceError::storage(
            "context selection active Loom does not match Scope Context",
        ));
    }
    Ok(())
}

fn validate_policy_entries(
    entries: Vec<MandatoryPolicyEntry>,
) -> Result<Vec<MandatoryPolicyEntry>, ServiceError> {
    for entry in &entries {
        if contains_forbidden_text(&entry.policy_id) {
            return Err(ServiceError::storage(
                "context selection policy metadata contains a forbidden marker",
            ));
        }
    }
    Ok(entries)
}

fn classify_retrieval_tier(
    candidate: &RetrievalCandidate,
    request: &ContextSelectionRequest,
) -> Option<ContextSourceTier> {
    if candidate.source_kind == "memory" {
        return match candidate.loom_id.as_deref() {
            Some(loom_id) if loom_id == request.active_loom_id => {
                Some(ContextSourceTier::ScopedMemory)
            }
            None => Some(ContextSourceTier::GlobalMemory),
            _ => None,
        };
    }
    if candidate.source_kind == "attachment_chunk"
        && candidate.loom_id.as_deref() == Some(request.active_loom_id.as_str())
    {
        return Some(ContextSourceTier::ConversationAttachment);
    }
    let loom_id = candidate.loom_id.as_deref()?;
    if request
        .scope_context
        .scoped_retrieval_loom_ids
        .iter()
        .any(|allowed| allowed == loom_id)
    {
        Some(ContextSourceTier::ScopedRetrieval)
    } else if request
        .scope_context
        .cross_conversation_loom_ids
        .iter()
        .any(|allowed| allowed == loom_id)
    {
        Some(ContextSourceTier::CrossConversationRetrieval)
    } else if request
        .scope_context
        .archived_retrieval_loom_ids
        .iter()
        .any(|allowed| allowed == loom_id)
    {
        Some(ContextSourceTier::ArchivedRetrieval)
    } else {
        None
    }
}

fn allowed_source_kind(source_kind: &str) -> bool {
    matches!(
        source_kind,
        "memory"
            | "attachment_chunk"
            | "response"
            | "reference"
            | "response_capsule"
            | "checkpoint"
    )
}

fn structural_background_candidate(
    source_kind: &str,
    source_id: String,
    rank: u32,
) -> ContextCandidate {
    ContextCandidate {
        source_kind: source_kind.to_string(),
        source_id,
        chunk_ref: None,
        tier: ContextSourceTier::WeftOriginChain,
        tier_priority: 3,
        retrieval_score: None,
        within_tier_rank: rank,
        estimated_tokens: 0,
        include_mode_hint: ContextIncludeModeHint::Capsule,
        is_hidden_background: true,
        is_mandatory: false,
        is_explicit_reference: false,
        text_preview: None,
        rank_signals: None,
    }
}

fn rank_and_cap(
    mut ranked: Vec<RankedCandidate>,
    cap: usize,
    accounting: &mut SelectionAccounting,
    rejected: &mut Vec<RejectedCandidate>,
) -> Vec<ContextCandidate> {
    ranked.sort_by(|left, right| {
        right
            .adjusted_score
            .partial_cmp(&left.adjusted_score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.candidate.source_kind.cmp(&right.candidate.source_kind))
            .then_with(|| left.candidate.source_id.cmp(&right.candidate.source_id))
            .then_with(|| left.candidate.chunk_ref.cmp(&right.candidate.chunk_ref))
    });
    let tier = ranked.first().map(|candidate| candidate.candidate.tier);
    let mut selected = Vec::new();
    let mut rejected_count = 0;
    for (index, mut candidate) in ranked.into_iter().enumerate() {
        candidate.candidate.within_tier_rank = index as u32 + 1;
        if index < cap {
            selected.push(candidate.candidate);
        } else {
            rejected_count += 1;
            rejected.push(RejectedCandidate {
                candidate: candidate.candidate,
                reason: "candidate_cap",
            });
        }
    }
    if let Some(tier) = tier {
        if rejected_count > 0 {
            *accounting.capped.entry(tier).or_default() += rejected_count;
        }
    }
    selected
}

#[allow(clippy::too_many_arguments)]
fn build_diagnostics(
    request: &ContextSelectionRequest,
    accounting: &SelectionAccounting,
    selected_by_tier: &BTreeMap<ContextSourceTier, usize>,
    estimated_by_tier: &BTreeMap<ContextSourceTier, usize>,
    total_selected: usize,
    total_estimated_tokens: usize,
    code_relevance: bool,
    cross_before: usize,
    cross_after: usize,
    archived_before: usize,
    archived_after: usize,
    scoped_memory_count: usize,
    global_memory_count: usize,
    attachment_count: usize,
    memory_read_policy: &MemoryReadPolicy,
    selection_latency_ms: u64,
) -> ContextSelectionDiagnostics {
    let all_tiers = [
        ContextSourceTier::PolicyAlwaysInclude,
        ContextSourceTier::ConversationThread,
        ContextSourceTier::WeftOriginChain,
        ContextSourceTier::ProjectGroup,
        ContextSourceTier::ScopedMemory,
        ContextSourceTier::GlobalMemory,
        ContextSourceTier::ConversationAttachment,
        ContextSourceTier::ProjectAttachment,
        ContextSourceTier::ScopedRetrieval,
        ContextSourceTier::CrossConversationRetrieval,
        ContextSourceTier::ArchivedRetrieval,
        ContextSourceTier::ToolMcpContext,
    ];
    let tiers = all_tiers
        .into_iter()
        .map(|tier| {
            let selected = selected_by_tier.get(&tier).copied().unwrap_or_default();
            let evaluated = accounting.evaluated.get(&tier).copied().unwrap_or_default();
            let reserved = matches!(
                tier,
                ContextSourceTier::ProjectGroup
                    | ContextSourceTier::ProjectAttachment
                    | ContextSourceTier::ToolMcpContext
            );
            TierDiagnostic {
                tier,
                tier_number: tier.priority(),
                status: if reserved {
                    TierDiagnosticStatus::Reserved
                } else if selected > 0 {
                    TierDiagnosticStatus::Populated
                } else {
                    TierDiagnosticStatus::Empty
                },
                candidates_evaluated: evaluated,
                candidates_selected: selected,
                budget_hint_limited: accounting.capped.get(&tier).copied().unwrap_or_default() > 0,
                estimated_tokens: estimated_by_tier.get(&tier).copied().unwrap_or_default(),
            }
        })
        .collect();
    let scope_latency = request.scope_context.diagnostics.latency_ms;
    let retrieval_latency = request.retrieval_result.diagnostics.total_latency_ms;
    ContextSelectionDiagnostics {
        tiers,
        total_candidates_evaluated: accounting.evaluated.values().sum(),
        total_candidates_selected: total_selected,
        total_estimated_tokens,
        code_relevance_detected: code_relevance,
        query_intent: request.query_intent,
        weft_loom: request.scope_context.weft_loom_detected,
        weft_lineage_depth: request.scope_context.diagnostics.lineage_depth,
        explicit_references_count: request
            .scope_context
            .diagnostics
            .explicit_references_validated,
        reserved_scopes_count: request
            .scope_context
            .scopes
            .iter()
            .filter(|scope| scope.status == ScopeStatus::Reserved)
            .count(),
        cross_loom_retrieval_activated: !request
            .scope_context
            .cross_conversation_loom_ids
            .is_empty(),
        cross_loom_candidates_before_cap: cross_before,
        cross_loom_candidates_after_cap: cross_after,
        archived_retrieval_activated: !request.scope_context.archived_retrieval_loom_ids.is_empty(),
        archived_candidates_before_cap: archived_before,
        archived_candidates_after_cap: archived_after,
        scoped_memory_candidates: scoped_memory_count,
        global_memory_candidates: global_memory_count,
        memory_type_weight_applied: accounting.memory_weight_applied,
        memory_active_considered: memory_read_policy.active_considered,
        memory_scoped_selected: scoped_memory_count,
        memory_global_selected: global_memory_count,
        memory_global_masked: memory_read_policy.global_masked,
        memory_always_include_selected: memory_read_policy.always_include.len(),
        memory_deleted_unconfirmed_excluded: memory_read_policy.deleted_unconfirmed_excluded,
        attachment_candidates: attachment_count,
        attachment_parse_status_drops: accounting.attachment_parse_status_drops,
        scope_resolution_latency_ms: scope_latency,
        retrieval_latency_ms: retrieval_latency,
        selection_latency_ms,
        total_pipeline_latency_ms: scope_latency + retrieval_latency + selection_latency_ms,
    }
}

fn selected_counts_by_tier(groups: &[&[ContextCandidate]]) -> BTreeMap<ContextSourceTier, usize> {
    let mut counts = BTreeMap::new();
    for candidate in groups.iter().flat_map(|group| group.iter()) {
        *counts.entry(candidate.tier).or_default() += 1;
    }
    counts
}

fn estimated_tokens_by_tier(groups: &[&[ContextCandidate]]) -> BTreeMap<ContextSourceTier, usize> {
    let mut totals = BTreeMap::new();
    for candidate in groups.iter().flat_map(|group| group.iter()) {
        *totals.entry(candidate.tier).or_default() += candidate.estimated_tokens;
    }
    totals
}

fn retain_new_identities(
    candidates: &mut Vec<ContextCandidate>,
    seen: &mut HashSet<(String, String, Option<String>)>,
) {
    candidates.retain(|candidate| seen.insert(candidate_identity(candidate)));
}

fn candidate_identity(candidate: &ContextCandidate) -> (String, String, Option<String>) {
    (
        candidate.source_kind.clone(),
        candidate.source_id.clone(),
        if candidate.source_kind == "memory" {
            None
        } else {
            candidate.chunk_ref.clone()
        },
    )
}

fn snapshot_candidate(
    snapshot_id: &str,
    candidate: &ContextCandidate,
    final_rank: usize,
    selected: bool,
    rejection_reason: Option<&str>,
) -> ContextSnapshotCandidateCreateRequest {
    ContextSnapshotCandidateCreateRequest {
        snapshot_candidate_id: Uuid::new_v4().to_string(),
        snapshot_id: snapshot_id.to_string(),
        source_kind: candidate.source_kind.clone(),
        source_id: candidate.source_id.clone(),
        chunk_ref: candidate.chunk_ref.clone().unwrap_or_default(),
        tier: candidate.tier.as_str().to_string(),
        include_mode_hint: candidate.include_mode_hint.as_str().to_string(),
        estimated_tokens: candidate.estimated_tokens as i64,
        retrieval_score: candidate.retrieval_score.map(f64::from),
        final_rank: final_rank as i64,
        is_mandatory: candidate.is_mandatory,
        is_hidden_background: candidate.is_hidden_background,
        is_selected: selected,
        rejection_reason: rejection_reason.map(str::to_string),
        metadata_json: serde_json::json!({
            "withinTierRank": candidate.within_tier_rank,
            "explicitReference": candidate.is_explicit_reference
        })
        .to_string(),
    }
}

fn estimate_tokens(character_count: usize) -> usize {
    character_count.saturating_add(3) / 4
}

fn bounded_safe_preview(preview: Option<&str>) -> Option<String> {
    let preview = preview?.trim();
    if preview.is_empty() || contains_forbidden_text(preview) {
        return None;
    }
    Some(preview.chars().take(MAX_PREVIEW_CHARS).collect())
}

fn contains_forbidden_text(text: &str) -> bool {
    if text.to_ascii_lowercase().contains("sk-") {
        return true;
    }
    let normalized = text
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    FORBIDDEN_TEXT_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        retrieval::hybrid_service::{
            DegradationReason, FusionMethod, RetrievalDiagnostics, RetrievalSourceDiagnostic,
            RetrievalSourceId, SourceStatus,
        },
        scope_resolution::{
            ScopeResolutionOptions, ScopeResolutionRequest, ScopeResolutionService,
        },
        storage::{db::test_database, repositories::context_snapshots::ContextSnapshotRepository},
    };

    async fn seed_loom(
        database: &Database,
        loom_id: &str,
        origin_loom_id: Option<&str>,
        origin_response_id: Option<&str>,
        archived: bool,
    ) {
        sqlx::query(
            "INSERT INTO looms (
                loom_id, title, summary, code, canonical_uri, kind,
                origin_loom_id, origin_response_id, created_at, updated_at, archived_at
             ) VALUES (?1, ?1, NULL, NULL, ?2, 'loom', ?3, ?4, '1', '1', ?5)",
        )
        .bind(loom_id)
        .bind(format!("/loom/{loom_id}"))
        .bind(origin_loom_id)
        .bind(origin_response_id)
        .bind(archived.then_some("2"))
        .execute(database.pool())
        .await
        .unwrap();
    }

    async fn seed_response(database: &Database, response_id: &str, loom_id: &str, sequence: i64) {
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, code, canonical_uri,
                created_at, updated_at, sequence_index, metadata_json
             ) VALUES (?1, ?2, 'assistant', 'bounded canonical response body', NULL, NULL,
                       NULL, '1', '1', ?3, NULL)",
        )
        .bind(response_id)
        .bind(loom_id)
        .bind(sequence)
        .execute(database.pool())
        .await
        .unwrap();
    }

    async fn seed_reference(database: &Database, reference_id: &str, loom_id: &str) {
        sqlx::query(
            "INSERT INTO \"references\" (
                reference_id, source_loom_id, source_response_id, target_kind,
                target_id, target_uri, selected_text, label, metadata_json, created_at
             ) VALUES (?1, ?2, NULL, 'loom', ?2, NULL, NULL, 'Reference', NULL, '1')",
        )
        .bind(reference_id)
        .bind(loom_id)
        .execute(database.pool())
        .await
        .unwrap();
    }

    async fn seed_memory(
        database: &Database,
        memory_id: &str,
        memory_type: &str,
        loom_id: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO memories (
                memory_id, memory_type, content, normalized_content, created_at, updated_at,
                source_loom_id, source_response_id, user_confirmed, deleted_at, metadata_json
             ) VALUES (?1, ?2, 'safe memory', 'safe memory', '1', '1', ?3, NULL, 1, NULL, NULL)",
        )
        .bind(memory_id)
        .bind(memory_type)
        .bind(loom_id)
        .execute(database.pool())
        .await
        .unwrap();
    }

    async fn mark_always_include(
        database: &Database,
        memory_id: &str,
        user_confirmed: bool,
        deleted_at: Option<&str>,
    ) {
        sqlx::query(
            "UPDATE memories
             SET always_include = 1, user_confirmed = ?2, deleted_at = ?3
             WHERE memory_id = ?1",
        )
        .bind(memory_id)
        .bind(user_confirmed)
        .bind(deleted_at)
        .execute(database.pool())
        .await
        .unwrap();
    }

    async fn configure_memory_read_policy(
        database: &Database,
        memory_id: &str,
        topic_key: Option<&str>,
        always_include: bool,
        user_confirmed: bool,
        deleted_at: Option<&str>,
    ) {
        sqlx::query(
            "UPDATE memories
             SET topic_key = ?2, always_include = ?3, user_confirmed = ?4, deleted_at = ?5
             WHERE memory_id = ?1",
        )
        .bind(memory_id)
        .bind(topic_key)
        .bind(always_include)
        .bind(user_confirmed)
        .bind(deleted_at)
        .execute(database.pool())
        .await
        .unwrap();
    }

    async fn seed_attachment_chunk(
        database: &Database,
        loom_id: &str,
        attachment_id: &str,
        chunk_id: &str,
        parse_status: &str,
    ) {
        let artifact_id = format!("artifact-{attachment_id}");
        sqlx::query(
            "INSERT INTO attachment_parse_artifacts (
                parse_artifact_id, sha256, parser_kind, parser_version, kind, content_kind,
                content_text, compression_kind, char_count, original_byte_count,
                stored_byte_count, metadata_json, created_at
             ) VALUES (?1, ?2, 'test', 'v1', 'document', 'text', 'safe attachment text',
                       'none', 20, 20, 20, NULL, '1')",
        )
        .bind(&artifact_id)
        .bind(format!("sha-{attachment_id}"))
        .execute(database.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO attachments (
                attachment_id, loom_id, file_name, mime_type, extension, size_bytes, kind,
                parse_status, parser, error, thumbnail_data_url, metadata_json,
                created_at, updated_at, parse_artifact_id
             ) VALUES (?1, ?2, ?3, 'text/plain', 'txt', 20, 'document', ?4,
                       'test', NULL, NULL, NULL, '1', '1', ?5)",
        )
        .bind(attachment_id)
        .bind(loom_id)
        .bind(format!("{attachment_id}.txt"))
        .bind(parse_status)
        .bind(&artifact_id)
        .execute(database.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO attachment_parse_artifact_chunks (
                chunk_id, parse_artifact_id, chunk_index, content_text, char_start,
                char_end, char_count, token_estimate, page_number, sheet_name,
                metadata_json, created_at
             ) VALUES (?1, ?2, 0, 'safe attachment text', 0, 20, 20, 5,
                       NULL, NULL, NULL, '1')",
        )
        .bind(chunk_id)
        .bind(&artifact_id)
        .execute(database.pool())
        .await
        .unwrap();
    }

    fn retrieval_candidate(
        source_kind: &str,
        source_id: &str,
        loom_id: Option<&str>,
        score: f32,
    ) -> RetrievalCandidate {
        RetrievalCandidate {
            source_kind: source_kind.to_string(),
            source_id: source_id.to_string(),
            chunk_ref: format!("{source_kind}:{source_id}:chunk"),
            projection_version: "projection-v1".to_string(),
            content_digest: "sha256:diagnostic-only".to_string(),
            loom_id: loom_id.map(str::to_string),
            response_id: None,
            relevance_score: score,
            rank_signals: RankSignals {
                bm25_rank: Some(1),
                bm25_score: Some(score),
                vector_rank: None,
                vector_score: None,
            },
            text_preview: Some("bounded safe preview".to_string()),
            contributing_sources: vec![RetrievalSourceId::Tantivy],
        }
    }

    fn retrieval_result(candidates: Vec<RetrievalCandidate>) -> RetrievalResult {
        RetrievalResult {
            candidates,
            diagnostics: RetrievalDiagnostics {
                fusion_method: FusionMethod::ReciprocalRankFusion,
                fusion_k: 60.0,
                domain_rank_shift_applied: true,
                domain_rank_version: "v1".to_string(),
                total_candidates_before_fusion: 0,
                total_candidates_after_fusion: 0,
                digest_mismatch_count: 0,
                digest_mismatch_source_kinds: Vec::new(),
                sources: vec![RetrievalSourceDiagnostic {
                    source_id: RetrievalSourceId::Tantivy,
                    status: SourceStatus::Ready,
                    candidate_count: 0,
                    latency_ms: 2,
                    index_version: Some("v1".to_string()),
                    projection_version: Some("v1".to_string()),
                    last_rebuild: None,
                    degradation_reason: None::<DegradationReason>,
                }],
                total_latency_ms: 2,
            },
        }
    }

    async fn scope(
        database: &Database,
        active_loom_id: &str,
        explicit_references: Vec<String>,
    ) -> ScopeContext {
        let mut request = ScopeResolutionRequest::new(active_loom_id, "selection-run");
        request.explicit_reference_ids = explicit_references;
        request.options = ScopeResolutionOptions {
            include_archived: true,
            max_weft_lineage_depth: 3,
            cross_conversation_enabled: true,
        };
        ScopeResolutionService::new(database)
            .resolve(request)
            .await
            .unwrap()
    }

    fn request(
        scope_context: ScopeContext,
        retrieval_result: RetrievalResult,
    ) -> ContextSelectionRequest {
        ContextSelectionRequest {
            active_loom_id: scope_context.active_loom_id.clone(),
            agent_run_id: None,
            response_id: None,
            scope_context,
            retrieval_result,
            mandatory_policy_entries: vec![MandatoryPolicyEntry {
                policy_id: "policy-default".to_string(),
                policy_kind: PolicyKind::SystemPolicy,
                estimated_tokens: 8,
            }],
            budget_hint: Some(ContextBudgetHint {
                max_retrieval_candidates: 10,
                cross_loom_candidate_cap: 1,
                archived_candidate_cap: 1,
                ..ContextBudgetHint::default()
            }),
            query_intent: QueryIntentKind::General,
            mode: ContextSelectionMode::Standard,
            persist_snapshot: false,
            snapshot_id: None,
        }
    }

    #[tokio::test]
    async fn tier_first_ordering_weights_memory_and_references_and_applies_caps() {
        let database = test_database().await;
        seed_loom(&database, "loom-active", None, None, false).await;
        seed_loom(&database, "loom-cross-a", None, None, false).await;
        seed_loom(&database, "loom-cross-b", None, None, false).await;
        seed_loom(&database, "loom-archived", None, None, true).await;
        seed_response(&database, "response-current", "loom-active", 1).await;
        seed_reference(&database, "reference-explicit", "loom-active").await;
        seed_memory(
            &database,
            "memory-explicit",
            "explicit_user_memory",
            Some("loom-active"),
        )
        .await;
        seed_memory(&database, "memory-global", "profile_preference", None).await;
        seed_memory(
            &database,
            "memory-inferred",
            "inferred_preference",
            Some("loom-active"),
        )
        .await;

        let scope_context = scope(
            &database,
            "loom-active",
            vec!["reference-explicit".to_string()],
        )
        .await;
        let candidates = vec![
            retrieval_candidate("memory", "memory-explicit", Some("loom-active"), 0.50),
            retrieval_candidate("memory", "memory-inferred", Some("loom-active"), 0.55),
            retrieval_candidate("memory", "memory-global", None, 0.95),
            retrieval_candidate("response", "retrieved-response", Some("loom-active"), 0.70),
            retrieval_candidate(
                "reference",
                "retrieved-reference",
                Some("loom-active"),
                0.50,
            ),
            retrieval_candidate("response", "cross-a", Some("loom-cross-a"), 0.90),
            retrieval_candidate("response", "cross-b", Some("loom-cross-b"), 0.80),
            retrieval_candidate("response", "archived", Some("loom-archived"), 0.90),
        ];
        let payload = ContextSelectionService::new(&database)
            .select(request(scope_context, retrieval_result(candidates)))
            .await
            .unwrap();

        assert!(payload.mandatory_references[0].is_mandatory);
        assert!(payload.mandatory_references[0].is_explicit_reference);
        assert_eq!(payload.scoped_memories[0].source_id, "memory-explicit");
        assert_eq!(payload.global_memories[0].source_id, "memory-global");
        assert_eq!(payload.scoped_retrieval[0].source_id, "retrieved-reference");
        assert_eq!(payload.cross_conversation_retrieval.len(), 1);
        assert_eq!(payload.archived_retrieval.len(), 1);
        assert_eq!(
            payload
                .selection_diagnostics
                .cross_loom_candidates_before_cap,
            2
        );
        assert_eq!(
            payload
                .selection_diagnostics
                .cross_loom_candidates_after_cap,
            1
        );
        let priorities = payload
            .candidates_in_tier_order()
            .into_iter()
            .map(|candidate| candidate.tier_priority)
            .collect::<Vec<_>>();
        assert!(priorities.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(payload.selection_diagnostics.memory_type_weight_applied);
        for tier in [
            ContextSourceTier::ProjectGroup,
            ContextSourceTier::ProjectAttachment,
            ContextSourceTier::ToolMcpContext,
        ] {
            assert!(payload
                .selection_diagnostics
                .tiers
                .iter()
                .any(|diagnostic| {
                    diagnostic.tier == tier && diagnostic.status == TierDiagnosticStatus::Reserved
                }));
        }
    }

    #[tokio::test]
    async fn always_include_memories_are_tier_one_mandatory_deduplicated_and_snapshotted() {
        let database = test_database().await;
        seed_loom(&database, "loom-always", None, None, false).await;
        for (id, memory_type, loom_id) in [
            (
                "memory-always-scoped",
                "explicit_user_memory",
                Some("loom-always"),
            ),
            ("memory-always-global", "profile_preference", None),
            (
                "memory-always-deleted",
                "explicit_user_memory",
                Some("loom-always"),
            ),
            (
                "memory-always-unconfirmed",
                "explicit_user_memory",
                Some("loom-always"),
            ),
            (
                "memory-ordinary",
                "explicit_user_memory",
                Some("loom-always"),
            ),
        ] {
            seed_memory(&database, id, memory_type, loom_id).await;
        }
        mark_always_include(&database, "memory-always-scoped", true, None).await;
        mark_always_include(&database, "memory-always-global", true, None).await;
        mark_always_include(&database, "memory-always-deleted", true, Some("deleted")).await;
        mark_always_include(&database, "memory-always-unconfirmed", false, None).await;

        let scope_context = scope(&database, "loom-always", Vec::new()).await;
        let candidates = vec![
            retrieval_candidate("memory", "memory-always-scoped", Some("loom-always"), 0.01),
            retrieval_candidate("memory", "memory-ordinary", Some("loom-always"), 0.90),
        ];
        let mut selection_request = request(scope_context, retrieval_result(candidates));
        selection_request.persist_snapshot = true;
        selection_request.snapshot_id = Some("snapshot-always".to_string());
        let payload = ContextSelectionService::new(&database)
            .select(selection_request)
            .await
            .unwrap();

        let always = payload
            .mandatory_references
            .iter()
            .filter(|candidate| candidate.source_kind == "memory")
            .collect::<Vec<_>>();
        assert_eq!(always.len(), 2);
        assert!(always.iter().all(|candidate| {
            candidate.tier == ContextSourceTier::PolicyAlwaysInclude
                && candidate.is_mandatory
                && !candidate.is_hidden_background
                && candidate.text_preview.is_none()
        }));
        assert!(always
            .iter()
            .any(|candidate| candidate.source_id == "memory-always-scoped"));
        assert!(always
            .iter()
            .any(|candidate| candidate.source_id == "memory-always-global"));
        let selected_ids = payload
            .candidates_in_tier_order()
            .into_iter()
            .map(|candidate| candidate.source_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            selected_ids
                .iter()
                .filter(|id| **id == "memory-always-scoped")
                .count(),
            1
        );
        assert!(!selected_ids.contains(&"memory-always-deleted"));
        assert!(!selected_ids.contains(&"memory-always-unconfirmed"));
        assert_eq!(payload.scoped_memories[0].source_id, "memory-ordinary");

        let snapshot_rows = ContextSnapshotRepository::new(&database)
            .list_candidates("snapshot-always")
            .await
            .unwrap();
        let always_row = snapshot_rows
            .iter()
            .find(|row| row.source_id == "memory-always-scoped")
            .unwrap();
        assert_eq!(always_row.tier, "policy_always_include");
        assert!(always_row.is_mandatory);
        assert!(!always_row.is_hidden_background);
        let persisted = serde_json::to_string(&snapshot_rows).unwrap();
        assert!(!persisted.contains("safe memory"));
        assert!(!persisted.contains("raw_thinking"));
        assert!(!persisted.contains("provider_payload"));
    }

    #[tokio::test]
    async fn memory_read_policy_masks_by_topic_scope_and_persists_selected_identities_only() {
        let database = test_database().await;
        seed_loom(&database, "loom-read-policy", None, None, false).await;
        seed_loom(&database, "loom-other", None, None, false).await;
        let memories = [
            (
                "memory-scoped-shared",
                "explicit_user_memory",
                Some("loom-read-policy"),
                Some("preference.shared"),
                false,
                true,
                None,
            ),
            (
                "memory-global-shared",
                "profile_preference",
                None,
                Some("preference.shared"),
                false,
                true,
                None,
            ),
            (
                "memory-global-only",
                "profile_preference",
                None,
                Some("preference.global_only"),
                false,
                true,
                None,
            ),
            (
                "memory-scoped-null",
                "inferred_preference",
                Some("loom-read-policy"),
                None,
                false,
                true,
                None,
            ),
            (
                "memory-global-null",
                "profile_preference",
                None,
                None,
                false,
                true,
                None,
            ),
            (
                "memory-scoped-different",
                "profile_preference",
                Some("loom-read-policy"),
                Some("preference.scoped"),
                false,
                true,
                None,
            ),
            (
                "memory-global-different",
                "profile_preference",
                None,
                Some("preference.global"),
                false,
                true,
                None,
            ),
            (
                "memory-other-loom",
                "explicit_user_memory",
                Some("loom-other"),
                Some("preference.shared"),
                false,
                true,
                None,
            ),
            (
                "memory-deleted",
                "explicit_user_memory",
                Some("loom-read-policy"),
                Some("preference.deleted"),
                false,
                true,
                Some("deleted"),
            ),
            (
                "memory-unconfirmed",
                "inferred_preference",
                Some("loom-read-policy"),
                Some("preference.unconfirmed"),
                false,
                false,
                None,
            ),
            (
                "memory-superseded",
                "explicit_user_memory",
                None,
                Some("preference.superseded"),
                false,
                true,
                Some("superseded"),
            ),
            (
                "memory-forgotten",
                "explicit_user_memory",
                None,
                Some("preference.forgotten"),
                false,
                true,
                Some("forgotten"),
            ),
            (
                "memory-always",
                "explicit_user_memory",
                Some("loom-read-policy"),
                Some("preference.always"),
                true,
                true,
                None,
            ),
        ];
        for (id, memory_type, loom_id, topic_key, always, confirmed, deleted_at) in memories {
            seed_memory(&database, id, memory_type, loom_id).await;
            configure_memory_read_policy(&database, id, topic_key, always, confirmed, deleted_at)
                .await;
        }

        let retrieval = memories
            .into_iter()
            .map(|(id, _, loom_id, _, _, _, _)| retrieval_candidate("memory", id, loom_id, 0.8))
            .collect();
        let scope_context = scope(&database, "loom-read-policy", Vec::new()).await;
        let mut selection_request = request(scope_context, retrieval_result(retrieval));
        selection_request.persist_snapshot = true;
        selection_request.snapshot_id = Some("snapshot-memory-read-policy".to_string());
        let payload = ContextSelectionService::new(&database)
            .select(selection_request)
            .await
            .unwrap();

        let selected_memory_ids = payload
            .candidates_in_tier_order()
            .into_iter()
            .filter(|candidate| candidate.source_kind == "memory")
            .map(|candidate| candidate.source_id.as_str())
            .collect::<HashSet<_>>();
        for expected in [
            "memory-scoped-shared",
            "memory-global-only",
            "memory-scoped-null",
            "memory-global-null",
            "memory-scoped-different",
            "memory-global-different",
            "memory-always",
        ] {
            assert!(selected_memory_ids.contains(expected));
        }
        for excluded in [
            "memory-global-shared",
            "memory-other-loom",
            "memory-deleted",
            "memory-unconfirmed",
            "memory-superseded",
            "memory-forgotten",
        ] {
            assert!(!selected_memory_ids.contains(excluded));
        }
        assert_eq!(
            selected_memory_ids
                .iter()
                .filter(|id| **id == "memory-always")
                .count(),
            1
        );
        let always = payload
            .mandatory_references
            .iter()
            .find(|candidate| candidate.source_id == "memory-always")
            .unwrap();
        assert_eq!(always.tier, ContextSourceTier::PolicyAlwaysInclude);
        assert!(always.is_mandatory);
        assert_eq!(payload.selection_diagnostics.memory_active_considered, 8);
        assert_eq!(payload.selection_diagnostics.memory_scoped_selected, 3);
        assert_eq!(
            payload.scoped_memories.last().unwrap().source_id,
            "memory-scoped-null"
        );
        assert_eq!(payload.selection_diagnostics.memory_global_selected, 3);
        assert_eq!(payload.selection_diagnostics.memory_global_masked, 1);
        assert_eq!(
            payload.selection_diagnostics.memory_always_include_selected,
            1
        );
        assert_eq!(
            payload
                .selection_diagnostics
                .memory_deleted_unconfirmed_excluded,
            4
        );

        let snapshot_rows = ContextSnapshotRepository::new(&database)
            .list_candidates("snapshot-memory-read-policy")
            .await
            .unwrap();
        let snapshot_memory_ids = snapshot_rows
            .iter()
            .filter(|row| row.source_kind == "memory" && row.is_selected)
            .map(|row| row.source_id.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(snapshot_memory_ids, selected_memory_ids);
        let diagnostics = serde_json::to_string(&payload.selection_diagnostics).unwrap();
        for forbidden in [
            "safe memory",
            "preference.shared",
            "preference.global_only",
            "raw_thinking",
            "provider_payload",
        ] {
            assert!(!diagnostics.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn attachment_readiness_and_same_tier_ties_are_deterministic() {
        let database = test_database().await;
        seed_loom(&database, "loom-attachments", None, None, false).await;
        seed_attachment_chunk(
            &database,
            "loom-attachments",
            "attachment-ready",
            "chunk-ready",
            "ready",
        )
        .await;
        seed_attachment_chunk(
            &database,
            "loom-attachments",
            "attachment-pending",
            "chunk-pending",
            "pending",
        )
        .await;
        let scope_context = scope(&database, "loom-attachments", Vec::new()).await;
        let candidates = vec![
            retrieval_candidate(
                "attachment_chunk",
                "chunk-ready",
                Some("loom-attachments"),
                0.8,
            ),
            retrieval_candidate(
                "attachment_chunk",
                "chunk-pending",
                Some("loom-attachments"),
                0.9,
            ),
            retrieval_candidate("response", "response-z", Some("loom-attachments"), 0.5),
            retrieval_candidate("response", "response-a", Some("loom-attachments"), 0.5),
        ];
        let payload = ContextSelectionService::new(&database)
            .select(request(scope_context, retrieval_result(candidates)))
            .await
            .unwrap();
        assert_eq!(payload.conversation_attachments.len(), 1);
        assert_eq!(payload.conversation_attachments[0].source_id, "chunk-ready");
        assert_eq!(
            payload.selection_diagnostics.attachment_parse_status_drops,
            1
        );
        assert_eq!(payload.scoped_retrieval[0].source_id, "response-a");
        assert_eq!(payload.scoped_retrieval[1].source_id, "response-z");
    }

    #[tokio::test]
    async fn weft_origin_candidates_are_irreversibly_hidden_background() {
        let database = test_database().await;
        seed_loom(&database, "loom-root", None, None, false).await;
        seed_response(&database, "response-origin", "loom-root", 0).await;
        seed_loom(
            &database,
            "loom-weft",
            Some("loom-root"),
            Some("response-origin"),
            false,
        )
        .await;
        sqlx::query(
            "INSERT INTO weft_origin_contexts (
                context_id, weft_loom_id, origin_loom_id, origin_response_id,
                origin_capsule_id, origin_summary, source_hash, status, created_at, updated_at
             ) VALUES ('weft-context', 'loom-weft', 'loom-root', 'response-origin',
                       NULL, NULL, NULL, 'ready', '1', '1')",
        )
        .execute(database.pool())
        .await
        .unwrap();
        let scope_context = scope(&database, "loom-weft", Vec::new()).await;
        let payload = ContextSelectionService::new(&database)
            .select(request(scope_context, retrieval_result(Vec::new())))
            .await
            .unwrap();
        assert_eq!(payload.weft_origin_chain.len(), 1);
        assert!(payload.weft_origin_chain[0].is_hidden_background);
        assert_eq!(
            payload.weft_origin_chain[0].tier,
            ContextSourceTier::WeftOriginChain
        );
    }

    #[tokio::test]
    async fn empty_retrieval_still_returns_safe_count_only_diagnostics() {
        let database = test_database().await;
        seed_loom(&database, "loom-empty", None, None, false).await;
        let scope_context = scope(&database, "loom-empty", Vec::new()).await;
        let payload = ContextSelectionService::new(&database)
            .select(request(scope_context, retrieval_result(Vec::new())))
            .await
            .unwrap();
        assert!(payload.scoped_retrieval.is_empty());
        let serialized = serde_json::to_string(&payload.selection_diagnostics).unwrap();
        for forbidden in [
            "loom-empty",
            "sourceId",
            "chunkRef",
            "contentDigest",
            "textPreview",
            "raw_thinking",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn private_previews_are_removed_and_agent_audit_sources_are_excluded() {
        let database = test_database().await;
        seed_loom(&database, "loom-private", None, None, false).await;
        let scope_context = scope(&database, "loom-private", Vec::new()).await;
        let mut private =
            retrieval_candidate("response", "response-private", Some("loom-private"), 0.8);
        private.text_preview = Some("provider_payload raw_thinking sk-test".to_string());
        let audit = retrieval_candidate("agent_events", "event-private", Some("loom-private"), 1.0);
        let payload = ContextSelectionService::new(&database)
            .select(request(
                scope_context,
                retrieval_result(vec![private, audit]),
            ))
            .await
            .unwrap();
        assert_eq!(payload.scoped_retrieval.len(), 1);
        assert!(payload.scoped_retrieval[0].text_preview.is_none());
        assert!(payload
            .candidates_in_tier_order()
            .iter()
            .all(|candidate| candidate.source_kind != "agent_events"));
    }

    #[tokio::test]
    async fn snapshot_persists_selected_and_capped_candidates_without_linking_agent_run() {
        let database = test_database().await;
        seed_loom(&database, "loom-snapshot-selection", None, None, false).await;
        seed_loom(&database, "loom-cross-one", None, None, false).await;
        seed_loom(&database, "loom-cross-two", None, None, false).await;
        sqlx::query(
            "INSERT INTO agent_runs (
                agent_run_id, correlation_id, status, started_at, cancel_requested, created_at
             ) VALUES ('run-selection', 'run-selection', 'running', '1', 0, '1')",
        )
        .execute(database.pool())
        .await
        .unwrap();
        let scope_context = scope(&database, "loom-snapshot-selection", Vec::new()).await;
        let candidates = vec![
            retrieval_candidate("response", "cross-one", Some("loom-cross-one"), 0.9),
            retrieval_candidate("response", "cross-two", Some("loom-cross-two"), 0.8),
        ];
        let mut selection_request = request(scope_context, retrieval_result(candidates));
        selection_request.agent_run_id = Some("run-selection".to_string());
        selection_request.persist_snapshot = true;
        selection_request.snapshot_id = Some("snapshot-selection".to_string());
        let payload = ContextSelectionService::new(&database)
            .select(selection_request)
            .await
            .unwrap();
        assert_eq!(payload.snapshot_id.as_deref(), Some("snapshot-selection"));

        let repository = ContextSnapshotRepository::new(&database);
        let snapshot = repository
            .get_snapshot("snapshot-selection")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.rejected_count, 1);
        assert_eq!(
            snapshot.candidate_count,
            snapshot.selected_count + snapshot.rejected_count
        );
        let rows = repository
            .list_candidates("snapshot-selection")
            .await
            .unwrap();
        assert_eq!(rows.iter().filter(|row| !row.is_selected).count(), 1);
        let persisted = serde_json::to_string(&(snapshot, rows)).unwrap();
        for forbidden in [
            "raw_thinking",
            "provider_payload",
            "provider_delta",
            "promptEnvelope",
            "secret",
            "credential",
            "rawToolOutput",
        ] {
            assert!(!persisted.contains(forbidden));
        }
        let linked = sqlx::query_scalar::<_, Option<String>>(
            "SELECT context_snapshot_id FROM agent_runs WHERE agent_run_id = 'run-selection'",
        )
        .fetch_one(database.pool())
        .await
        .unwrap();
        assert_eq!(linked, None);
    }

    #[test]
    fn policy_metadata_rejects_private_markers() {
        for policy_id in [
            "secret-policy",
            "provider_payload",
            "raw_thinking",
            "sk-test",
        ] {
            let result = validate_policy_entries(vec![MandatoryPolicyEntry {
                policy_id: policy_id.to_string(),
                policy_kind: PolicyKind::OperatorInstruction,
                estimated_tokens: 1,
            }]);
            assert!(result.is_err(), "{policy_id} should be rejected");
        }
    }

    #[test]
    fn payload_contract_has_no_full_content_prompt_or_provider_fields() {
        let source = include_str!("context_selection.rs");
        for field_name in [
            "content",
            "prompt",
            "provider_payload",
            "provider_delta",
            "raw_thinking",
            "vector",
            "raw_tool_output",
        ] {
            let forbidden_field = ["pub ", field_name, ":"].concat();
            assert!(!source.contains(&forbidden_field));
        }
        assert!(!source.contains(&["crate", "::api::ask"].concat()));
        assert!(!source.contains(&["crate", "::api::orchestration"].concat()));
    }
}
