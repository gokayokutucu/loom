#![allow(dead_code)]

//! Agent-only Context Manager boundary.
//!
//! Resolves Context Selection identities from canonical SQLite records and
//! returns structured context. It does not assemble provider payloads or run providers.

use std::time::Instant;

use serde::Serialize;
use sqlx::{Row, SqlitePool};

use crate::{
    context_selection::{
        ContextCandidate, ContextIncludeModeHint, ContextPayload, ContextSourceTier,
        MandatoryPolicyEntry,
    },
    error::ServiceError,
    storage::{
        db::Database,
        repositories::{
            agent_runs::AgentRunRepository,
            context_snapshots::{ContextSnapshotCandidateDecision, ContextSnapshotRepository},
        },
    },
};

const SUMMARY_CHAR_LIMIT: usize = 800;
const FORBIDDEN_CONTENT_MARKERS: [&str; 8] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
    "provider_payload",
    "provider_delta",
    "authorization",
    "bearer ",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextRetrievalIncludeMode {
    Full,
    Summary,
    ReferenceOnly,
    CodeExact,
    HiddenBackground,
}

impl ContextRetrievalIncludeMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Summary => "summary",
            Self::ReferenceOnly => "reference_only",
            Self::CodeExact => "code_exact",
            Self::HiddenBackground => "hidden_background",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextBudgetPlan {
    pub reserved_system_tokens: usize,
    pub reserved_response_tokens: usize,
    pub max_context_tokens: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptSectionKind {
    System,
    Mandatory,
    Conversation,
    Memory,
    Attachments,
    Retrieval,
    HiddenBackground,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedContextItem {
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: Option<String>,
    pub include_mode: ContextRetrievalIncludeMode,
    pub content: String,
    pub estimated_tokens: usize,
    pub actual_tokens: usize,
    pub mandatory: bool,
    pub hidden_background: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSection {
    pub kind: PromptSectionKind,
    pub items: Vec<ResolvedContextItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextManagerDiagnostics {
    pub candidates_resolved: usize,
    pub candidates_included: usize,
    pub candidates_dropped: usize,
    pub estimated_tokens: usize,
    pub actual_tokens: usize,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalContext {
    pub sections: Vec<PromptSection>,
    pub diagnostics: ContextManagerDiagnostics,
    pub available_context_tokens: usize,
    pub consumed_context_tokens: usize,
}

#[derive(Debug, Clone)]
pub struct AgentContextManager {
    pool: SqlitePool,
    snapshots: ContextSnapshotRepository,
    agent_runs: AgentRunRepository,
}

#[derive(Debug)]
struct CandidateOutcome {
    source_kind: String,
    source_id: String,
    chunk_ref: String,
    include_mode: ContextRetrievalIncludeMode,
    token_count: usize,
    included: bool,
    exclusion_reason: Option<&'static str>,
    item: Option<ResolvedContextItem>,
    section: PromptSectionKind,
}

impl AgentContextManager {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
            snapshots: ContextSnapshotRepository::new(database),
            agent_runs: AgentRunRepository::from_pool(database.pool()),
        }
    }

    pub async fn build(
        &self,
        payload: &ContextPayload,
        budget: &ContextBudgetPlan,
    ) -> Result<FinalContext, ServiceError> {
        let started = Instant::now();
        let reserved = budget
            .reserved_system_tokens
            .checked_add(budget.reserved_response_tokens)
            .ok_or_else(|| ServiceError::storage("context token reserve overflow"))?;
        let available = budget
            .max_context_tokens
            .checked_sub(reserved)
            .ok_or_else(|| {
                ServiceError::storage(
                    "TokenOverflowError: reserved tokens exceed max context tokens",
                )
            })?;

        let mandatory_policy_tokens = payload
            .policy_entries
            .iter()
            .map(|entry| entry.estimated_tokens)
            .sum::<usize>();
        let mut consumed = mandatory_policy_tokens;
        if consumed > available {
            return Err(ServiceError::storage(
                "TokenOverflowError: mandatory context exceeds available context budget",
            ));
        }

        let mut sections = empty_sections();
        add_policy_entries(&mut sections, &payload.policy_entries);
        let mut outcomes = Vec::new();
        let mut resolved_count = 0;
        for candidate in payload.candidates_in_tier_order() {
            let include_mode = include_mode(candidate);
            let section = section_kind(candidate);
            let resolved = self.resolve(candidate, include_mode).await?;
            let Some(content) = resolved else {
                if candidate.is_mandatory {
                    return Err(ServiceError::storage(
                        "mandatory context could not be resolved from SQLite",
                    ));
                }
                outcomes.push(outcome(
                    candidate,
                    include_mode,
                    section,
                    0,
                    false,
                    Some("excluded"),
                    None,
                ));
                continue;
            };
            validate_resolved_content(&content)?;
            resolved_count += 1;
            let tokens = estimate_tokens(&content);
            if consumed.saturating_add(tokens) > available {
                if candidate.is_mandatory {
                    return Err(ServiceError::storage(
                        "TokenOverflowError: mandatory context exceeds available context budget",
                    ));
                }
                outcomes.push(outcome(
                    candidate,
                    include_mode,
                    section,
                    tokens,
                    false,
                    Some("excluded_budget"),
                    None,
                ));
                continue;
            }
            consumed += tokens;
            let item = ResolvedContextItem {
                source_kind: candidate.source_kind.clone(),
                source_id: candidate.source_id.clone(),
                chunk_ref: candidate.chunk_ref.clone(),
                include_mode,
                content,
                estimated_tokens: candidate.estimated_tokens,
                actual_tokens: tokens,
                mandatory: candidate.is_mandatory,
                hidden_background: include_mode == ContextRetrievalIncludeMode::HiddenBackground,
            };
            section_mut(&mut sections, section).items.push(item.clone());
            outcomes.push(outcome(
                candidate,
                include_mode,
                section,
                tokens,
                true,
                None,
                Some(item),
            ));
        }

        let included = outcomes.iter().filter(|outcome| outcome.included).count();
        let diagnostics = ContextManagerDiagnostics {
            candidates_resolved: resolved_count,
            candidates_included: included,
            candidates_dropped: outcomes.len() - included,
            estimated_tokens: payload.selection_diagnostics.total_estimated_tokens,
            actual_tokens: consumed,
            latency_ms: started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
        };

        if let Some(snapshot_id) = payload.snapshot_id.as_deref() {
            self.finalize_snapshot(snapshot_id, &outcomes, budget, &diagnostics)
                .await?;
            if let Some(run_id) = payload.agent_run_id.as_deref() {
                self.agent_runs
                    .link_context_snapshot(run_id, snapshot_id)
                    .await?;
            }
        }

        Ok(FinalContext {
            sections: sections
                .into_iter()
                .filter(|section| !section.items.is_empty())
                .collect(),
            diagnostics,
            available_context_tokens: available,
            consumed_context_tokens: consumed,
        })
    }

    async fn resolve(
        &self,
        candidate: &ContextCandidate,
        mode: ContextRetrievalIncludeMode,
    ) -> Result<Option<String>, ServiceError> {
        if mode == ContextRetrievalIncludeMode::ReferenceOnly {
            return self.resolve_reference_only(candidate).await;
        }
        let content = match candidate.source_kind.as_str() {
            "response" if mode == ContextRetrievalIncludeMode::CodeExact => {
                sqlx::query_scalar::<_, String>(
                    "SELECT code FROM response_code_blocks
                     WHERE code_block_id = ?1 OR response_id = ?2
                     ORDER BY CASE WHEN code_block_id = ?1 THEN 0 ELSE 1 END, block_index ASC
                     LIMIT 1",
                )
                .bind(candidate.chunk_ref.as_deref().unwrap_or(""))
                .bind(&candidate.source_id)
                .fetch_optional(&self.pool)
                .await
            }
            "response" => {
                sqlx::query_scalar::<_, String>(
                    "SELECT content FROM responses WHERE response_id = ?1 AND is_deleted = 0",
                )
                .bind(&candidate.source_id)
                .fetch_optional(&self.pool)
                .await
            }
            "memory" => {
                sqlx::query_scalar::<_, String>(
                    "SELECT content FROM memories
                 WHERE memory_id = ?1 AND user_confirmed = 1 AND deleted_at IS NULL",
                )
                .bind(&candidate.source_id)
                .fetch_optional(&self.pool)
                .await
            }
            "attachment_chunk" => {
                sqlx::query_scalar::<_, String>(
                    "SELECT c.content_text FROM attachment_parse_artifact_chunks c
                 JOIN attachments a ON a.parse_artifact_id = c.parse_artifact_id
                 WHERE c.chunk_id = ?1 AND a.parse_status = 'ready'",
                )
                .bind(&candidate.source_id)
                .fetch_optional(&self.pool)
                .await
            }
            "reference" => self.resolve_reference(candidate).await,
            "response_capsule" => sqlx::query_scalar::<_, Option<String>>(
                "SELECT summary FROM response_context_capsules
                 WHERE capsule_id = ?1 AND status = 'ready'",
            )
            .bind(&candidate.source_id)
            .fetch_optional(&self.pool)
            .await
            .map(|value| value.flatten()),
            "checkpoint" => {
                sqlx::query_scalar::<_, String>(
                    "SELECT summary FROM loom_checkpoint_summaries
                 WHERE checkpoint_id = ?1 AND status = 'ready'",
                )
                .bind(&candidate.source_id)
                .fetch_optional(&self.pool)
                .await
            }
            "weft_origin" | "weft_origin_context" => sqlx::query_scalar::<_, Option<String>>(
                "SELECT origin_summary FROM weft_origin_contexts
                 WHERE context_id = ?1 AND status = 'ready'",
            )
            .bind(&candidate.source_id)
            .fetch_optional(&self.pool)
            .await
            .map(|value| value.flatten()),
            _ => return Ok(None),
        }
        .map_err(|error| {
            ServiceError::storage(format!("failed to resolve canonical context: {error}"))
        })?;

        Ok(content.map(|content| apply_mode(content, mode)))
    }

    async fn resolve_reference(
        &self,
        candidate: &ContextCandidate,
    ) -> Result<Option<String>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT selected_text, target_kind, target_id, label, target_uri
             FROM \"references\" WHERE reference_id = ?1",
        )
        .bind(&candidate.source_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        if let Some(text) = row.get::<Option<String>, _>("selected_text") {
            return Ok(Some(text));
        }
        if row.get::<String, _>("target_kind") == "response" {
            if let Some(target_id) = row.get::<Option<String>, _>("target_id") {
                return sqlx::query_scalar::<_, String>(
                    "SELECT content FROM responses WHERE response_id = ?1 AND is_deleted = 0",
                )
                .bind(target_id)
                .fetch_optional(&self.pool)
                .await;
            }
        }
        Ok(row
            .get::<Option<String>, _>("label")
            .or_else(|| row.get::<Option<String>, _>("target_uri")))
    }

    async fn resolve_reference_only(
        &self,
        candidate: &ContextCandidate,
    ) -> Result<Option<String>, ServiceError> {
        if candidate.source_kind == "reference" {
            return sqlx::query_scalar::<_, Option<String>>(
                "SELECT COALESCE(label, target_uri, target_id) FROM \"references\"
                 WHERE reference_id = ?1",
            )
            .bind(&candidate.source_id)
            .fetch_optional(&self.pool)
            .await
            .map(|value| value.flatten())
            .map_err(|error| {
                ServiceError::storage(format!("failed to resolve reference metadata: {error}"))
            });
        }
        Ok(Some(format!(
            "{}:{}",
            candidate.source_kind, candidate.source_id
        )))
    }

    async fn finalize_snapshot(
        &self,
        snapshot_id: &str,
        outcomes: &[CandidateOutcome],
        budget: &ContextBudgetPlan,
        diagnostics: &ContextManagerDiagnostics,
    ) -> Result<(), ServiceError> {
        let decisions = outcomes
            .iter()
            .map(|outcome| ContextSnapshotCandidateDecision {
                source_kind: &outcome.source_kind,
                source_id: &outcome.source_id,
                chunk_ref: &outcome.chunk_ref,
                include_mode: outcome.include_mode.as_str(),
                estimated_tokens: outcome.token_count.try_into().unwrap_or(i64::MAX),
                included: outcome.included,
                exclusion_reason: outcome.exclusion_reason,
            })
            .collect::<Vec<_>>();
        let budget_json = serde_json::json!({
            "reservedSystemTokens": budget.reserved_system_tokens,
            "reservedResponseTokens": budget.reserved_response_tokens,
            "maxContextTokens": budget.max_context_tokens,
            "actualTokens": diagnostics.actual_tokens
        })
        .to_string();
        let diagnostics_json = serde_json::to_string(diagnostics).map_err(|error| {
            ServiceError::storage(format!(
                "failed to serialize Context Manager diagnostics: {error}"
            ))
        })?;
        self.snapshots
            .finalize_context_manager(snapshot_id, &decisions, &budget_json, &diagnostics_json)
            .await
    }
}

fn include_mode(candidate: &ContextCandidate) -> ContextRetrievalIncludeMode {
    if candidate.is_hidden_background {
        return ContextRetrievalIncludeMode::HiddenBackground;
    }
    match candidate.include_mode_hint {
        ContextIncludeModeHint::Full => ContextRetrievalIncludeMode::Full,
        ContextIncludeModeHint::Capsule | ContextIncludeModeHint::CodeSummary => {
            ContextRetrievalIncludeMode::Summary
        }
        ContextIncludeModeHint::ReferenceOnly => ContextRetrievalIncludeMode::ReferenceOnly,
        ContextIncludeModeHint::CodeExact => ContextRetrievalIncludeMode::CodeExact,
    }
}

fn section_kind(candidate: &ContextCandidate) -> PromptSectionKind {
    if candidate.is_hidden_background {
        return PromptSectionKind::HiddenBackground;
    }
    if candidate.is_mandatory || candidate.is_explicit_reference {
        return PromptSectionKind::Mandatory;
    }
    match candidate.tier {
        ContextSourceTier::ConversationThread => PromptSectionKind::Conversation,
        ContextSourceTier::ScopedMemory | ContextSourceTier::GlobalMemory => {
            PromptSectionKind::Memory
        }
        ContextSourceTier::ConversationAttachment | ContextSourceTier::ProjectAttachment => {
            PromptSectionKind::Attachments
        }
        ContextSourceTier::WeftOriginChain => PromptSectionKind::HiddenBackground,
        _ => PromptSectionKind::Retrieval,
    }
}

fn empty_sections() -> Vec<PromptSection> {
    [
        PromptSectionKind::System,
        PromptSectionKind::Mandatory,
        PromptSectionKind::Conversation,
        PromptSectionKind::Memory,
        PromptSectionKind::Attachments,
        PromptSectionKind::Retrieval,
        PromptSectionKind::HiddenBackground,
    ]
    .into_iter()
    .map(|kind| PromptSection {
        kind,
        items: Vec::new(),
    })
    .collect()
}

fn section_mut(sections: &mut [PromptSection], kind: PromptSectionKind) -> &mut PromptSection {
    sections
        .iter_mut()
        .find(|section| section.kind == kind)
        .expect("section exists")
}

fn add_policy_entries(sections: &mut [PromptSection], entries: &[MandatoryPolicyEntry]) {
    let system = section_mut(sections, PromptSectionKind::System);
    for entry in entries {
        system.items.push(ResolvedContextItem {
            source_kind: "policy".to_string(),
            source_id: entry.policy_id.clone(),
            chunk_ref: None,
            include_mode: ContextRetrievalIncludeMode::ReferenceOnly,
            content: entry.policy_id.clone(),
            estimated_tokens: entry.estimated_tokens,
            actual_tokens: entry.estimated_tokens,
            mandatory: true,
            hidden_background: false,
        });
    }
}

fn apply_mode(content: String, mode: ContextRetrievalIncludeMode) -> String {
    if mode == ContextRetrievalIncludeMode::Summary {
        content.chars().take(SUMMARY_CHAR_LIMIT).collect()
    } else {
        content
    }
}

fn estimate_tokens(content: &str) -> usize {
    content.chars().count().div_ceil(4).max(1)
}

fn validate_resolved_content(content: &str) -> Result<(), ServiceError> {
    let lower = content.to_ascii_lowercase();
    if FORBIDDEN_CONTENT_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return Err(ServiceError::storage(
            "resolved context contains forbidden private content marker",
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn outcome(
    candidate: &ContextCandidate,
    include_mode: ContextRetrievalIncludeMode,
    section: PromptSectionKind,
    token_count: usize,
    included: bool,
    exclusion_reason: Option<&'static str>,
    item: Option<ResolvedContextItem>,
) -> CandidateOutcome {
    CandidateOutcome {
        source_kind: candidate.source_kind.clone(),
        source_id: candidate.source_id.clone(),
        chunk_ref: candidate.chunk_ref.clone().unwrap_or_default(),
        include_mode,
        token_count,
        included,
        exclusion_reason,
        item,
        section,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context_selection::{
        ContextSelectionDiagnostics, ContextSelectionMode, PolicyKind, QueryIntentKind,
        TierDiagnostic,
    };

    fn diagnostics() -> ContextSelectionDiagnostics {
        ContextSelectionDiagnostics {
            tiers: Vec::<TierDiagnostic>::new(),
            total_candidates_evaluated: 0,
            total_candidates_selected: 0,
            total_estimated_tokens: 0,
            code_relevance_detected: false,
            query_intent: QueryIntentKind::General,
            weft_loom: false,
            weft_lineage_depth: 0,
            explicit_references_count: 0,
            reserved_scopes_count: 0,
            cross_loom_retrieval_activated: false,
            cross_loom_candidates_before_cap: 0,
            cross_loom_candidates_after_cap: 0,
            archived_retrieval_activated: false,
            archived_candidates_before_cap: 0,
            archived_candidates_after_cap: 0,
            scoped_memory_candidates: 0,
            global_memory_candidates: 0,
            memory_type_weight_applied: false,
            attachment_candidates: 0,
            attachment_parse_status_drops: 0,
            scope_resolution_latency_ms: 0,
            retrieval_latency_ms: 0,
            selection_latency_ms: 0,
            total_pipeline_latency_ms: 0,
        }
    }

    fn candidate(
        id: &str,
        mandatory: bool,
        hidden: bool,
        hint: ContextIncludeModeHint,
    ) -> ContextCandidate {
        ContextCandidate {
            source_kind: "response".to_string(),
            source_id: id.to_string(),
            chunk_ref: None,
            tier: if hidden {
                ContextSourceTier::WeftOriginChain
            } else {
                ContextSourceTier::ConversationThread
            },
            tier_priority: if hidden { 3 } else { 2 },
            retrieval_score: None,
            within_tier_rank: 1,
            estimated_tokens: 4,
            include_mode_hint: hint,
            is_hidden_background: hidden,
            is_mandatory: mandatory,
            is_explicit_reference: mandatory,
            text_preview: Some("must not be used".to_string()),
            rank_signals: None,
        }
    }

    fn payload(candidates: Vec<ContextCandidate>) -> ContextPayload {
        ContextPayload {
            active_loom_id: "loom-context-manager".to_string(),
            agent_run_id: None,
            policy_entries: Vec::new(),
            mandatory_references: candidates
                .iter()
                .filter(|candidate| candidate.is_mandatory)
                .cloned()
                .collect(),
            conversation_turns: candidates
                .iter()
                .filter(|candidate| !candidate.is_mandatory && !candidate.is_hidden_background)
                .cloned()
                .collect(),
            weft_origin_chain: candidates
                .iter()
                .filter(|candidate| candidate.is_hidden_background)
                .cloned()
                .collect(),
            scoped_memories: Vec::new(),
            global_memories: Vec::new(),
            conversation_attachments: Vec::new(),
            scoped_retrieval: Vec::new(),
            cross_conversation_retrieval: Vec::new(),
            archived_retrieval: Vec::new(),
            query_intent: QueryIntentKind::General,
            code_relevance_detected: false,
            weft_loom: false,
            snapshot_id: None,
            selection_diagnostics: diagnostics(),
        }
    }

    async fn setup() -> Database {
        let database = crate::storage::db::test_database().await;
        sqlx::query("INSERT INTO looms (loom_id, title, canonical_uri, kind, created_at, updated_at) VALUES ('loom-context-manager', 'Loom', '/loom/context-manager', 'loom', '1', '1')")
            .execute(database.pool()).await.unwrap();
        database
    }

    async fn seed_response(database: &Database, id: &str, content: &str, sequence: i64) {
        sqlx::query("INSERT INTO responses (response_id, loom_id, role, content, created_at, updated_at, sequence_index) VALUES (?1, 'loom-context-manager', 'assistant', ?2, '1', '1', ?3)")
            .bind(id).bind(content).bind(sequence).execute(database.pool()).await.unwrap();
    }

    fn budget(max: usize) -> ContextBudgetPlan {
        ContextBudgetPlan {
            reserved_system_tokens: 2,
            reserved_response_tokens: 2,
            max_context_tokens: max,
        }
    }

    #[tokio::test]
    async fn resolves_sqlite_content_and_never_uses_preview() {
        let database = setup().await;
        seed_response(&database, "response-one", "canonical sqlite content", 1).await;
        let result = AgentContextManager::new(&database)
            .build(
                &payload(vec![candidate(
                    "response-one",
                    false,
                    false,
                    ContextIncludeModeHint::Full,
                )]),
                &budget(100),
            )
            .await
            .unwrap();
        assert_eq!(
            result.sections[0].items[0].content,
            "canonical sqlite content"
        );
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("must not be used"));
    }

    #[tokio::test]
    async fn applies_summary_hidden_background_and_budget_drop_modes() {
        let database = setup().await;
        seed_response(&database, "summary", &"x".repeat(1000), 1).await;
        seed_response(&database, "hidden", "hidden origin", 2).await;
        seed_response(
            &database,
            "dropped",
            "optional content that does not fit",
            3,
        )
        .await;
        let result = AgentContextManager::new(&database)
            .build(
                &payload(vec![
                    candidate("summary", false, false, ContextIncludeModeHint::Capsule),
                    candidate("hidden", false, true, ContextIncludeModeHint::Full),
                    candidate("dropped", false, false, ContextIncludeModeHint::Full),
                ]),
                &budget(210),
            )
            .await
            .unwrap();
        assert!(result
            .sections
            .iter()
            .any(|section| section.kind == PromptSectionKind::HiddenBackground));
        assert_eq!(result.diagnostics.candidates_dropped, 1);
        let summary = result
            .sections
            .iter()
            .flat_map(|section| &section.items)
            .find(|item| item.source_id == "summary")
            .unwrap();
        assert_eq!(summary.content.chars().count(), SUMMARY_CHAR_LIMIT);
    }

    #[tokio::test]
    async fn mandatory_overflow_is_explicit_and_never_silently_drops() {
        let database = setup().await;
        seed_response(&database, "mandatory", &"m".repeat(100), 1).await;
        let error = AgentContextManager::new(&database)
            .build(
                &payload(vec![candidate(
                    "mandatory",
                    true,
                    false,
                    ContextIncludeModeHint::Full,
                )]),
                &budget(10),
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("TokenOverflowError"));
    }

    #[tokio::test]
    async fn rejects_raw_thinking_from_canonical_sqlite_content() {
        let database = setup().await;
        seed_response(&database, "private", "raw_thinking must not leak", 1).await;
        let error = AgentContextManager::new(&database)
            .build(
                &payload(vec![candidate(
                    "private",
                    false,
                    false,
                    ContextIncludeModeHint::Full,
                )]),
                &budget(100),
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("forbidden private content"));
    }

    #[tokio::test]
    async fn finalizes_snapshot_metadata_and_links_agent_run_without_content() {
        let database = setup().await;
        seed_response(
            &database,
            "snapshot-response",
            "snapshot canonical content",
            1,
        )
        .await;
        sqlx::query(
            "INSERT INTO agent_runs
             (agent_run_id, correlation_id, status, started_at, cancel_requested, created_at)
             VALUES ('run-context-manager', 'run-context-manager', 'running', '1', 0, '1')",
        )
        .execute(database.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO context_snapshots
             (snapshot_id, agent_run_id, loom_id, created_at, policy_version,
              selection_version, budget_json, diagnostics_json, candidate_count,
              selected_count, rejected_count)
             VALUES ('snapshot-context-manager', 'run-context-manager',
                     'loom-context-manager', '1', 'policy-v1', 'selection-v1',
                     '{}', '{}', 1, 1, 0)",
        )
        .execute(database.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO context_snapshot_candidates
             (snapshot_candidate_id, snapshot_id, source_kind, source_id, chunk_ref,
              tier, include_mode_hint, estimated_tokens, final_rank, is_mandatory,
              is_hidden_background, is_selected, metadata_json)
             VALUES ('candidate-context-manager', 'snapshot-context-manager', 'response',
                     'snapshot-response', '', 'conversation_thread', 'full', 4, 1, 0, 0, 1, '{}')",
        )
        .execute(database.pool())
        .await
        .unwrap();

        let mut input = payload(vec![candidate(
            "snapshot-response",
            false,
            false,
            ContextIncludeModeHint::Full,
        )]);
        input.agent_run_id = Some("run-context-manager".to_string());
        input.snapshot_id = Some("snapshot-context-manager".to_string());
        let result = AgentContextManager::new(&database)
            .build(&input, &budget(100))
            .await
            .unwrap();

        let linked = sqlx::query_scalar::<_, Option<String>>(
            "SELECT context_snapshot_id FROM agent_runs WHERE agent_run_id = 'run-context-manager'",
        )
        .fetch_one(database.pool())
        .await
        .unwrap();
        assert_eq!(linked.as_deref(), Some("snapshot-context-manager"));
        let row = sqlx::query(
            "SELECT is_selected, rejection_reason, include_mode_hint
             FROM context_snapshot_candidates
             WHERE snapshot_candidate_id = 'candidate-context-manager'",
        )
        .fetch_one(database.pool())
        .await
        .unwrap();
        assert_eq!(row.get::<i64, _>("is_selected"), 1);
        assert_eq!(row.get::<Option<String>, _>("rejection_reason"), None);
        assert_eq!(row.get::<String, _>("include_mode_hint"), "full");
        let snapshot_json = sqlx::query(
            "SELECT budget_json, diagnostics_json FROM context_snapshots
             WHERE snapshot_id = 'snapshot-context-manager'",
        )
        .fetch_one(database.pool())
        .await
        .unwrap();
        let persisted = format!(
            "{}{}",
            snapshot_json.get::<String, _>("budget_json"),
            snapshot_json.get::<String, _>("diagnostics_json")
        );
        assert!(!persisted.contains("snapshot canonical content"));
        assert_eq!(result.diagnostics.candidates_included, 1);
    }

    #[test]
    fn module_has_no_provider_main_quick_ask_or_tool_execution_dependency() {
        let source = include_str!("agent_context_manager.rs");
        assert!(!source.contains(&["api", "::ask"].concat()));
        assert!(!source.contains(&["api", "::orchestration"].concat()));
        assert!(!source.contains(&["providers", "::"].concat()));
        assert!(!source.contains(&["agent_runtime", "::tools"].concat()));
        let _ = ContextSelectionMode::Standard;
        let _ = PolicyKind::SystemPolicy;
    }
}
