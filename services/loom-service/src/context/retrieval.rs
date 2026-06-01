use crate::{
    capabilities::ExecutionStrategyDecision,
    context::{
        budget::{estimate_tokens, resolve_context_budget, resolve_context_budget_plan},
        types::{BuildContextInput, ContextSource},
    },
    error::ServiceError,
    storage::repositories::code_blocks::is_reusable_code_artifact,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, BTreeSet};

const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

const STOP_WORDS: &[&str] = &[
    "ve", "veya", "ile", "için", "icin", "bir", "bu", "şu", "su", "o", "mi", "mı", "mu", "mü",
    "nedir", "nasil", "nasıl", "daha", "biraz", "the", "and", "or", "for", "with", "this", "that",
    "what", "how", "why", "explain", "more",
];

const CODE_RELEVANCE_TERMS: &[&str] = &[
    "code",
    "kod",
    "hata",
    "bug",
    "debug",
    "exception",
    "stack trace",
    "compile",
    "build",
    "implement",
    "implementation",
    "nasıl yazarım",
    "nasil yazarim",
    "örnek kod",
    "ornek kod",
    "function",
    "class",
    "method",
    "endpoint",
    "controller",
    "service",
    "repository",
    "query",
    "sql",
    "sorgu",
    "snippet",
    "refactor",
    "fix",
    "çalışmıyor",
    "calismiyor",
    "derle",
    "uygula",
];

const CODE_LANGUAGE_TERMS: &[&str] = &[
    "csharp",
    "c#",
    "rust",
    "typescript",
    "javascript",
    "sql",
    "bash",
    "json",
    "yaml",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ContextRetrievalCandidateKind {
    Response,
    ResponsePart,
    ResponseCapsule,
    Checkpoint,
    CodeBlock,
    Topic,
    Reference,
    Memory,
    AttachmentChunk,
    WeftOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ContextRetrievalIncludeMode {
    Full,
    Capsule,
    ReferenceOnly,
    CodeExact,
    CodeSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextSourceLevel {
    Summary,
    Checkpoint,
    ExactResponsePart,
    AttachmentChunk,
    CodeBlock,
    Memory,
    WeftOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QueryIntentKind {
    EntityFactual,
    Code,
    Temporal,
    Decision,
    FileDocument,
    General,
}

impl Default for QueryIntentKind {
    fn default() -> Self {
        Self::General
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextRetrievalCandidate {
    pub candidate_id: String,
    pub candidate_kind: ContextRetrievalCandidateKind,
    pub loom_id: String,
    pub response_id: Option<String>,
    pub score: f64,
    pub reasons: Vec<String>,
    pub text_preview: String,
    pub include_mode: ContextRetrievalIncludeMode,
    pub source_level: ContextSourceLevel,
    pub query_intent: QueryIntentKind,
    pub estimated_tokens: usize,
    pub budget_used_tokens: usize,
    pub scoring_reason: String,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextRetrievalResult {
    pub query_terms: Vec<String>,
    pub query_intent: QueryIntentKind,
    pub candidates: Vec<ContextRetrievalCandidate>,
    pub selected: Vec<ContextRetrievalCandidate>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ContextRetriever {
    pool: SqlitePool,
}

impl ContextRetriever {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn retrieve(
        &self,
        input: &BuildContextInput,
    ) -> Result<ContextRetrievalResult, ServiceError> {
        self.retrieve_with_strategy(input, None).await
    }

    pub async fn retrieve_with_strategy(
        &self,
        input: &BuildContextInput,
        strategy_decision: Option<&ExecutionStrategyDecision>,
    ) -> Result<ContextRetrievalResult, ServiceError> {
        let query = extract_query_terms(&input.user_prompt, input);
        if query.terms.is_empty() {
            return Ok(ContextRetrievalResult::default());
        }

        let current_sequence = self
            .current_sequence(input.current_head_response_id.as_deref())
            .await?;
        let mut accumulator = CandidateAccumulator::new(&input.loom_id, current_sequence);
        self.score_tags(input, &query, &mut accumulator).await?;
        self.score_topics(input, &query, &mut accumulator).await?;
        self.score_parts(input, &query, &mut accumulator).await?;
        self.score_capsules(input, &query, &mut accumulator).await?;
        self.score_graph_links(input, &mut accumulator).await?;
        self.score_code_blocks(input, &query, &mut accumulator)
            .await?;
        self.score_weft_origin(input, &query, &mut accumulator)
            .await?;
        self.score_fts_documents(input, &query, &mut accumulator)
            .await?;

        let mut candidates = accumulator.finish();
        self.enrich_filter_and_rank_candidates(input, &mut candidates)
            .await?;
        apply_query_intent_scores(&query, &mut candidates);
        set_retrieval_diagnostics(&query, &mut candidates);
        candidates.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.candidate_id.cmp(&right.candidate_id))
        });

        let (selected, mut warnings) =
            self.select_candidates(input, &query, &candidates, strategy_decision);
        if candidates.len() > selected.len() {
            warnings.push("retrieval_candidates_capped".to_string());
        }
        let warnings = if warnings.is_empty() {
            Vec::new()
        } else {
            warnings
        };

        Ok(ContextRetrievalResult {
            query_terms: query.terms.into_iter().collect(),
            query_intent: query.intent,
            candidates,
            selected,
            warnings,
        })
    }

    fn select_candidates(
        &self,
        input: &BuildContextInput,
        query: &QueryTerms,
        candidates: &[ContextRetrievalCandidate],
        strategy_decision: Option<&ExecutionStrategyDecision>,
    ) -> (Vec<ContextRetrievalCandidate>, Vec<String>) {
        let context_budget = resolve_context_budget(input.resolved_num_ctx, None);
        let budget_plan = resolve_context_budget_plan(input, &context_budget, strategy_decision);
        let max_selected = if input.resolved_num_ctx >= 8192 { 6 } else { 3 };
        let retrieval_budget = if input.resolved_num_ctx >= 8192 {
            800
        } else {
            360
        };
        let mut warnings = Vec::new();
        let mut used_tokens = 0usize;
        let mut used_code_tokens = 0usize;
        let mut selected = Vec::new();

        for candidate in candidates {
            if candidate.score < 1.0 {
                continue;
            }
            let mut candidate = candidate.clone();
            if candidate.include_mode == ContextRetrievalIncludeMode::CodeExact {
                let explicit = candidate
                    .reasons
                    .iter()
                    .any(|reason| reason == "explicit_code_reference")
                    || candidate.response_id.as_deref().is_some_and(|response_id| {
                        is_explicit_response_code_reference(input, response_id)
                    });
                if !query.code_relevant && !explicit {
                    candidate.include_mode = ContextRetrievalIncludeMode::CodeSummary;
                    candidate.text_preview = code_summary_from_metadata(&candidate);
                    candidate
                        .reasons
                        .push("non_code_prompt_downgraded_to_summary".to_string());
                }
                if input.resolved_num_ctx < 4096 && !explicit {
                    candidate.include_mode = ContextRetrievalIncludeMode::CodeSummary;
                    candidate.text_preview = code_summary_from_metadata(&candidate);
                    candidate
                        .reasons
                        .push("weak_budget_downgraded_to_summary".to_string());
                }
                if !budget_plan.include_exact_code_blocks && !explicit {
                    candidate.include_mode = ContextRetrievalIncludeMode::CodeSummary;
                    candidate.text_preview = code_summary_from_metadata(&candidate);
                    candidate
                        .reasons
                        .push("context_budget_plan_downgraded_to_summary".to_string());
                }
            }

            let mut estimated = estimate_tokens(&candidate.text_preview).max(8);
            if candidate.include_mode == ContextRetrievalIncludeMode::CodeExact {
                let remaining_code_budget = budget_plan
                    .code_block_token_budget
                    .saturating_sub(used_code_tokens);
                if remaining_code_budget == 0 {
                    candidate.include_mode = ContextRetrievalIncludeMode::CodeSummary;
                    candidate.text_preview = code_summary_from_metadata(&candidate);
                    candidate
                        .reasons
                        .push("code_block_budget_downgraded_to_summary".to_string());
                    warnings.push("code_block_budget_exhausted".to_string());
                    estimated = estimate_tokens(&candidate.text_preview).max(8);
                } else if estimated > remaining_code_budget {
                    candidate.text_preview =
                        truncate_code_context(&candidate.text_preview, remaining_code_budget);
                    candidate.reasons.push("code_block_truncated".to_string());
                    warnings.push("code_block_truncated".to_string());
                    estimated = estimate_tokens(&candidate.text_preview).max(8);
                }
            }

            candidate.source_level =
                source_level_for(&candidate.candidate_kind, &candidate.include_mode);
            candidate.estimated_tokens = estimated;
            if used_tokens.saturating_add(estimated) > retrieval_budget && !selected.is_empty() {
                continue;
            }
            if candidate.include_mode == ContextRetrievalIncludeMode::CodeExact {
                used_code_tokens = used_code_tokens.saturating_add(estimated);
            }
            used_tokens = used_tokens.saturating_add(estimated);
            candidate.budget_used_tokens = used_tokens;
            candidate.metadata.insert(
                "retrievalBudgetUsedTokens".to_string(),
                serde_json::json!(candidate.budget_used_tokens),
            );
            candidate.metadata.insert(
                "sourceLevel".to_string(),
                serde_json::json!(candidate.source_level),
            );
            candidate.metadata.insert(
                "queryIntent".to_string(),
                serde_json::json!(candidate.query_intent),
            );
            selected.push(candidate);
            if selected.len() >= max_selected {
                break;
            }
        }

        (selected, warnings)
    }

    async fn current_sequence(
        &self,
        response_id: Option<&str>,
    ) -> Result<Option<i64>, ServiceError> {
        let Some(response_id) = response_id else {
            return Ok(None);
        };
        sqlx::query(
            "SELECT sequence_index FROM responses
             WHERE response_id = ?1 AND is_deleted = 0
             LIMIT 1",
        )
        .bind(response_id)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(|row| row.get("sequence_index")))
        .map_err(|error| {
            ServiceError::storage(format!("failed to load current Response sequence: {error}"))
        })
    }

    async fn score_tags(
        &self,
        input: &BuildContextInput,
        query: &QueryTerms,
        accumulator: &mut CandidateAccumulator,
    ) -> Result<(), ServiceError> {
        let rows = sqlx::query(
            "SELECT response_id, tag, normalized_tag, tag_kind, confidence
             FROM response_tags
             WHERE loom_id = ?1",
        )
        .bind(&input.loom_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to retrieve tags: {error}")))?;

        for row in rows {
            let normalized_tag: String = row.get("normalized_tag");
            if !query.matches(&normalized_tag) {
                continue;
            }
            let response_id: String = row.get("response_id");
            let tag: String = row.get("tag");
            let tag_kind: String = row.get("tag_kind");
            let confidence: Option<f64> = row.get("confidence");
            let exact_bonus = if query.exact_terms.contains(&normalized_tag) {
                2.0
            } else {
                0.8
            };
            let acronym_bonus = if tag_kind == "acronym" { 1.2 } else { 0.0 };
            accumulator.add_response(
                &response_id,
                exact_bonus + acronym_bonus + confidence.unwrap_or(0.5),
                "tag_match",
                format!("Matched tag {tag} ({tag_kind})"),
            );
        }
        Ok(())
    }

    async fn score_topics(
        &self,
        input: &BuildContextInput,
        query: &QueryTerms,
        accumulator: &mut CandidateAccumulator,
    ) -> Result<(), ServiceError> {
        let rows = sqlx::query(
            "SELECT topic_id, topic, normalized_topic, latest_response_id, weight
             FROM loom_topic_index
             WHERE loom_id = ?1",
        )
        .bind(&input.loom_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to retrieve topics: {error}")))?;

        for row in rows {
            let normalized_topic: String = row.get("normalized_topic");
            if !query.matches(&normalized_topic) {
                continue;
            }
            let topic_id: String = row.get("topic_id");
            let topic: String = row.get("topic");
            let latest_response_id: Option<String> = row.get("latest_response_id");
            let weight: Option<f64> = row.get("weight");
            let score = 1.5 + weight.unwrap_or(0.0).min(4.0);
            accumulator.add_candidate(
                ContextRetrievalCandidateKind::Topic,
                topic_id,
                latest_response_id.clone(),
                score,
                "topic_index_match",
                topic,
                ContextRetrievalIncludeMode::ReferenceOnly,
            );
            if let Some(response_id) = latest_response_id {
                accumulator.add_response(
                    &response_id,
                    score,
                    "topic_index_latest_response",
                    "Latest Response for matched topic".to_string(),
                );
            }
        }
        Ok(())
    }

    async fn score_parts(
        &self,
        input: &BuildContextInput,
        query: &QueryTerms,
        accumulator: &mut CandidateAccumulator,
    ) -> Result<(), ServiceError> {
        let rows = sqlx::query(
            "SELECT part_id, response_id, part_kind, content, markdown, code_block_id
             FROM response_parts
             WHERE loom_id = ?1",
        )
        .bind(&input.loom_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to retrieve parts: {error}")))?;

        for row in rows {
            let text = row
                .get::<Option<String>, _>("content")
                .or_else(|| row.get::<Option<String>, _>("markdown"))
                .unwrap_or_default();
            reject_forbidden_payload(&text)?;
            let overlap = query.overlap_score(&text);
            if overlap <= 0.0 {
                continue;
            }
            let part_kind: String = row.get("part_kind");
            let response_id: String = row.get("response_id");
            let boost = match part_kind.as_str() {
                "heading" => 1.2,
                "table" => 1.0,
                "code_block" => {
                    if query.code_relevant {
                        1.0
                    } else {
                        0.2
                    }
                }
                _ => 0.4,
            };
            accumulator.add_candidate(
                ContextRetrievalCandidateKind::ResponsePart,
                row.get("part_id"),
                Some(response_id.clone()),
                overlap + boost,
                "response_part_match",
                preview(&text),
                ContextRetrievalIncludeMode::Capsule,
            );
            accumulator.add_response(
                &response_id,
                overlap + boost,
                "response_part_response_boost",
                format!("Matched {part_kind} part"),
            );
        }
        Ok(())
    }

    async fn score_capsules(
        &self,
        input: &BuildContextInput,
        query: &QueryTerms,
        accumulator: &mut CandidateAccumulator,
    ) -> Result<(), ServiceError> {
        let rows = sqlx::query(
            "SELECT capsule_id, response_id, title, summary, key_points_json, keywords_json, entities_json, code_blocks_json, status
             FROM response_context_capsules
             WHERE loom_id = ?1",
        )
        .bind(&input.loom_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to retrieve capsules: {error}")))?;

        for row in rows {
            let status: String = row.get("status");
            if status == "failed" || status == "pending" {
                continue;
            }
            let mut text = String::new();
            for key in [
                "title",
                "summary",
                "key_points_json",
                "keywords_json",
                "entities_json",
                "code_blocks_json",
            ] {
                if let Some(value) = row.get::<Option<String>, _>(key) {
                    text.push_str(&value);
                    text.push('\n');
                }
            }
            reject_forbidden_payload(&text)?;
            let overlap = query.overlap_score(&text);
            if overlap <= 0.0 {
                continue;
            }
            let response_id: String = row.get("response_id");
            accumulator.add_candidate(
                ContextRetrievalCandidateKind::ResponseCapsule,
                row.get("capsule_id"),
                Some(response_id.clone()),
                overlap + if status == "ready" { 1.0 } else { 0.2 },
                "response_capsule_match",
                preview(&text),
                ContextRetrievalIncludeMode::Capsule,
            );
            accumulator.add_response(
                &response_id,
                overlap + 0.8,
                "response_capsule_response_boost",
                "Matched ready Response capsule".to_string(),
            );
        }
        Ok(())
    }

    async fn score_graph_links(
        &self,
        input: &BuildContextInput,
        accumulator: &mut CandidateAccumulator,
    ) -> Result<(), ServiceError> {
        let candidate_response_ids = accumulator.response_ids();
        if candidate_response_ids.is_empty() {
            return Ok(());
        }
        let rows = sqlx::query(
            "SELECT source_kind, source_id, target_kind, target_id, link_kind, weight
             FROM context_graph_links
             WHERE loom_id = ?1",
        )
        .bind(&input.loom_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to retrieve graph links: {error}"))
        })?;

        for row in rows {
            let link_kind: String = row.get("link_kind");
            if !matches!(
                link_kind.as_str(),
                "same_topic" | "answers" | "references" | "code_for"
            ) {
                continue;
            }
            let source_kind: String = row.get("source_kind");
            let source_id: String = row.get("source_id");
            let target_kind: String = row.get("target_kind");
            let target_id: String = row.get("target_id");
            let weight: Option<f64> = row.get("weight");
            let boost = 0.4 + weight.unwrap_or(0.0).min(2.0);
            if source_kind == "response"
                && candidate_response_ids.contains(&source_id)
                && target_kind == "response"
            {
                accumulator.add_response(
                    &target_id,
                    boost,
                    "graph_neighbor",
                    format!("Shallow {link_kind} graph neighbor"),
                );
            }
            if target_kind == "response"
                && candidate_response_ids.contains(&target_id)
                && source_kind == "response"
            {
                accumulator.add_response(
                    &source_id,
                    boost,
                    "graph_neighbor",
                    format!("Shallow {link_kind} graph neighbor"),
                );
            }
            if source_kind == "code_block"
                && target_kind == "response"
                && candidate_response_ids.contains(&target_id)
            {
                accumulator.add_candidate(
                    ContextRetrievalCandidateKind::CodeBlock,
                    source_id,
                    Some(target_id),
                    boost,
                    "graph_code_for",
                    "Code block linked to matched Response".to_string(),
                    ContextRetrievalIncludeMode::CodeSummary,
                );
            }
        }
        Ok(())
    }

    async fn score_code_blocks(
        &self,
        input: &BuildContextInput,
        query: &QueryTerms,
        accumulator: &mut CandidateAccumulator,
    ) -> Result<(), ServiceError> {
        let explicit_code_block_ids: Vec<&str> = input
            .attached_references
            .iter()
            .filter(|attached| attached.reference.target_kind == "code_block")
            .filter_map(|attached| attached.reference.target_id.as_deref())
            .collect();
        let mut sql = String::from(
            "SELECT cb.code_block_id, cb.response_id, cb.language, cb.code, cb.exact_hash,
                    r.title AS source_title, r.code AS source_code
             FROM response_code_blocks cb
             LEFT JOIN responses r ON r.response_id = cb.response_id
             WHERE (cb.loom_id = ?1",
        );
        for index in 0..explicit_code_block_ids.len() {
            sql.push_str(&format!(" OR cb.code_block_id = ?{}", index + 2));
        }
        sql.push_str(") AND COALESCE(r.is_deleted, 0) = 0");
        let mut statement = sqlx::query(&sql).bind(&input.loom_id);
        for code_block_id in explicit_code_block_ids {
            statement = statement.bind(code_block_id);
        }
        let rows = statement.fetch_all(&self.pool).await.map_err(|error| {
            ServiceError::storage(format!("failed to retrieve code blocks: {error}"))
        })?;

        for row in rows {
            let code: String = row.get("code");
            reject_forbidden_payload(&code)?;
            let language: Option<String> = row.get("language");
            if !is_reusable_code_artifact(language.as_deref(), &code) {
                continue;
            }
            let code_block_id: String = row.get("code_block_id");
            let response_id: String = row.get("response_id");
            let exact_hash: String = row.get("exact_hash");
            let source_title: Option<String> = row.get("source_title");
            let source_code: Option<String> = row.get("source_code");
            let overlap = query.overlap_score(&format!(
                "{}\n{}",
                language.clone().unwrap_or_default(),
                code
            ));
            let explicit_code_reference =
                is_explicit_code_reference(input, &response_id, &code_block_id);
            if overlap <= 0.0 && !query.code_relevant && !explicit_code_reference {
                continue;
            }
            let include_mode = if (query.code_relevant || explicit_code_reference)
                && input.resolved_num_ctx >= 4096
            {
                ContextRetrievalIncludeMode::CodeExact
            } else {
                ContextRetrievalIncludeMode::CodeSummary
            };
            let text = match include_mode {
                ContextRetrievalIncludeMode::CodeExact => exact_code_context(
                    &code_block_id,
                    language.as_deref(),
                    &response_id,
                    source_title.as_deref().or(source_code.as_deref()),
                    &code,
                ),
                _ => summary_code_context(
                    &code_block_id,
                    language.as_deref(),
                    &exact_hash,
                    &response_id,
                    source_title.as_deref().or(source_code.as_deref()),
                ),
            };
            let text_preview = if include_mode == ContextRetrievalIncludeMode::CodeExact {
                text
            } else {
                preview(&text)
            };
            let mut metadata = BTreeMap::new();
            metadata.insert(
                "summaryText".to_string(),
                Value::String(summary_code_context(
                    &code_block_id,
                    language.as_deref(),
                    &exact_hash,
                    &response_id,
                    source_title.as_deref().or(source_code.as_deref()),
                )),
            );
            metadata.insert("exactHash".to_string(), Value::String(exact_hash));
            metadata.insert(
                "language".to_string(),
                Value::String(language.clone().unwrap_or_else(|| "unknown".to_string())),
            );
            accumulator.add_candidate_with_metadata(
                ContextRetrievalCandidateKind::CodeBlock,
                code_block_id,
                Some(response_id),
                overlap
                    + if query.code_relevant || explicit_code_reference {
                        8.0
                    } else {
                        0.4
                    },
                if explicit_code_reference {
                    "explicit_code_reference"
                } else if query.code_relevant {
                    "code_relevant_exact"
                } else {
                    "code_summary"
                },
                text_preview,
                include_mode,
                metadata,
            );
        }
        Ok(())
    }

    async fn score_weft_origin(
        &self,
        input: &BuildContextInput,
        query: &QueryTerms,
        accumulator: &mut CandidateAccumulator,
    ) -> Result<(), ServiceError> {
        if input.source != ContextSource::Weft {
            return Ok(());
        }
        let Some(origin) = input.weft_origin.as_ref() else {
            return Ok(());
        };
        reject_forbidden_payload(&origin.origin_summary)?;
        let overlap = query.overlap_score(&origin.origin_summary);
        if overlap > 0.0 {
            accumulator.add_candidate(
                ContextRetrievalCandidateKind::WeftOrigin,
                origin.context_id.clone(),
                Some(origin.origin_response_id.clone()),
                overlap + 2.0,
                "weft_hidden_origin_match",
                preview(&origin.origin_summary),
                ContextRetrievalIncludeMode::Capsule,
            );
        }
        Ok(())
    }

    async fn score_fts_documents(
        &self,
        input: &BuildContextInput,
        query: &QueryTerms,
        accumulator: &mut CandidateAccumulator,
    ) -> Result<(), ServiceError> {
        let fts_query = fts_match_query(query);
        if fts_query.is_empty() {
            return Ok(());
        }

        let rows = sqlx::query(
            "SELECT d.doc_id,
                    d.source_kind,
                    d.source_id,
                    d.loom_id,
                    d.response_id,
                    d.attachment_id,
                    d.parse_artifact_id,
                    d.title,
                    d.body,
                    d.tags,
                    d.source_rank,
                    d.updated_at,
                    d.metadata_json,
                    bm25(search_documents_fts) AS bm25_score
             FROM search_documents_fts
             JOIN search_documents d ON d.rowid = search_documents_fts.rowid
             WHERE search_documents_fts MATCH ?1
               AND d.is_deleted = 0
               AND (
                    d.loom_id = ?2
                    OR (d.loom_id IS NULL AND d.source_kind = 'memory')
               )
               AND d.source_kind IN (
                    'response',
                    'response_capsule',
                    'checkpoint',
                    'memory',
                    'attachment_chunk',
                    'attachment_summary',
                    'code_block'
               )
             ORDER BY d.source_rank DESC, bm25(search_documents_fts), d.updated_at DESC
             LIMIT 24",
        )
        .bind(fts_query)
        .bind(&input.loom_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to retrieve FTS docs: {error}")))?;

        for row in rows {
            let doc = FtsDocument::from_row(row);
            reject_forbidden_payload(doc.title.as_deref().unwrap_or_default())?;
            reject_forbidden_payload(&doc.body)?;
            reject_forbidden_payload(doc.tags.as_deref().unwrap_or_default())?;
            reject_forbidden_payload(doc.metadata_json.as_deref().unwrap_or_default())?;

            let Some(candidate_kind) = fts_candidate_kind(&doc.source_kind) else {
                continue;
            };
            if candidate_kind == ContextRetrievalCandidateKind::AttachmentChunk
                && !is_explicit_attachment_reference(input, doc.attachment_id.as_deref())
            {
                continue;
            }
            let include_mode = match candidate_kind {
                ContextRetrievalCandidateKind::CodeBlock => {
                    ContextRetrievalIncludeMode::CodeSummary
                }
                _ => ContextRetrievalIncludeMode::Capsule,
            };
            let mut metadata = BTreeMap::new();
            metadata.insert(
                "retrievalSource".to_string(),
                Value::String("fts".to_string()),
            );
            metadata.insert("ftsDocId".to_string(), Value::String(doc.doc_id.clone()));
            metadata.insert(
                "ftsSourceKind".to_string(),
                Value::String(doc.source_kind.clone()),
            );
            metadata.insert(
                "ftsSourceId".to_string(),
                Value::String(doc.source_id.clone()),
            );
            metadata.insert("ftsBm25".to_string(), serde_json::json!(doc.bm25_score));
            metadata.insert(
                "ftsSourceRank".to_string(),
                serde_json::json!(doc.source_rank),
            );
            metadata.insert(
                "ftsUpdatedAt".to_string(),
                Value::String(doc.updated_at.clone()),
            );
            if let Some(attachment_id) = doc.attachment_id.as_ref() {
                metadata.insert(
                    "attachmentId".to_string(),
                    Value::String(attachment_id.clone()),
                );
            }
            if let Some(parse_artifact_id) = doc.parse_artifact_id.as_ref() {
                metadata.insert(
                    "parseArtifactId".to_string(),
                    Value::String(parse_artifact_id.clone()),
                );
            }
            if let Some(title) = doc.title.as_ref() {
                metadata.insert("title".to_string(), Value::String(title.clone()));
            }

            let mut score = fts_base_score(doc.source_rank, doc.bm25_score);
            let mut reasons = vec!["fts_match".to_string()];
            if doc.loom_id.as_deref() == Some(&input.loom_id) {
                score += 1.0;
                reasons.push("fts_current_loom_boost".to_string());
            }
            if is_explicit_attachment_reference(input, doc.attachment_id.as_deref()) {
                score += 8.0;
                reasons.push("fts_explicit_attachment_reference_boost".to_string());
            }
            if doc
                .response_id
                .as_deref()
                .is_some_and(|response_id| is_explicit_response_reference(input, response_id))
            {
                score += 4.0;
                reasons.push("fts_explicit_response_reference_boost".to_string());
            }
            if fts_exact_title_match(query, doc.title.as_deref()) {
                score += 3.0;
                reasons.push("fts_exact_title_boost".to_string());
            }
            if query.intent == QueryIntentKind::Code && fts_code_signal(&doc) {
                score += 2.0;
                reasons.push("fts_code_intent_boost".to_string());
            }
            if query.intent == QueryIntentKind::FileDocument
                && matches!(
                    candidate_kind,
                    ContextRetrievalCandidateKind::AttachmentChunk
                )
            {
                score += 2.0;
                reasons.push("fts_file_document_intent_boost".to_string());
            }
            metadata.insert(
                "ftsRankingContribution".to_string(),
                serde_json::json!(score),
            );

            let title = doc.title.as_deref().unwrap_or(doc.source_kind.as_str());
            let text_preview = preview(&format!("{title}\n{}", doc.body));
            let candidate_id = fts_candidate_id(&doc);
            let first_reason = reasons
                .first()
                .cloned()
                .unwrap_or_else(|| "fts_match".to_string());
            accumulator.add_candidate_with_metadata(
                candidate_kind,
                candidate_id,
                doc.response_id.clone(),
                score,
                &first_reason,
                text_preview,
                include_mode,
                metadata,
            );
            for reason in reasons.into_iter().skip(1) {
                accumulator.add_candidate(
                    fts_candidate_kind(&doc.source_kind).expect("candidate kind"),
                    fts_candidate_id(&doc),
                    doc.response_id.clone(),
                    0.0,
                    &reason,
                    String::new(),
                    ContextRetrievalIncludeMode::ReferenceOnly,
                );
            }
        }
        Ok(())
    }

    async fn enrich_filter_and_rank_candidates(
        &self,
        input: &BuildContextInput,
        candidates: &mut Vec<ContextRetrievalCandidate>,
    ) -> Result<(), ServiceError> {
        let current_sequence = self
            .current_sequence(input.current_head_response_id.as_deref())
            .await?;
        for candidate in candidates.iter_mut() {
            if let Some(response_id) = candidate.response_id.as_deref() {
                if let Some(row) = sqlx::query(
                    "SELECT role, content, sequence_index, metadata_json, is_deleted
                     FROM responses
                     WHERE response_id = ?1
                     LIMIT 1",
                )
                .bind(response_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|error| {
                    ServiceError::storage(format!(
                        "failed to enrich retrieved Response candidate: {error}"
                    ))
                })? {
                    let content: String = row.get("content");
                    reject_forbidden_payload(&content)?;
                    if row.get::<i64, _>("is_deleted") != 0 {
                        candidate.score = 0.0;
                        candidate
                            .reasons
                            .push("deleted_response_excluded".to_string());
                        candidate.include_mode = ContextRetrievalIncludeMode::ReferenceOnly;
                        continue;
                    }
                    let sequence_index: i64 = row.get("sequence_index");
                    if current_sequence.is_some_and(|current| sequence_index >= current) {
                        candidate.score = 0.0;
                        candidate
                            .reasons
                            .push("current_or_future_excluded".to_string());
                        continue;
                    }
                    let metadata_json: Option<String> = row.get("metadata_json");
                    if let Some(metadata) = metadata_json.as_deref() {
                        reject_forbidden_payload(metadata)?;
                        if is_stale_metadata(metadata) {
                            candidate.score *= 0.15;
                            candidate.reasons.push("stale_response_penalty".to_string());
                            candidate.include_mode = ContextRetrievalIncludeMode::ReferenceOnly;
                        }
                    }
                    if candidate.text_preview.len() < 64 {
                        candidate.text_preview = self
                            .capsule_or_response_preview(response_id, &content)
                            .await?;
                    }
                    candidate.metadata.insert(
                        "sequenceIndex".to_string(),
                        serde_json::json!(sequence_index),
                    );
                    if row.get::<String, _>("role") == "assistant" {
                        candidate.score += 0.2;
                    }
                }
            }

            if let Some(response_id) = candidate.response_id.as_deref() {
                if input
                    .attached_references
                    .iter()
                    .any(|attached| attached.reference.target_id.as_deref() == Some(response_id))
                {
                    candidate.score += 4.0;
                    candidate
                        .reasons
                        .push("explicit_reference_boost".to_string());
                }
            }
        }
        Ok(())
    }

    async fn capsule_or_response_preview(
        &self,
        response_id: &str,
        response_content: &str,
    ) -> Result<String, ServiceError> {
        if let Some(row) = sqlx::query(
            "SELECT title, summary, key_points_json, keywords_json
             FROM response_context_capsules
             WHERE response_id = ?1 AND status IN ('ready', 'stale')
             ORDER BY updated_at DESC
             LIMIT 1",
        )
        .bind(response_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to load retrieved Response capsule: {error}"
            ))
        })? {
            let text = [
                row.get::<Option<String>, _>("title"),
                row.get::<Option<String>, _>("summary"),
                row.get::<Option<String>, _>("key_points_json"),
                row.get::<Option<String>, _>("keywords_json"),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("\n");
            reject_forbidden_payload(&text)?;
            if !text.trim().is_empty() {
                return Ok(preview(&text));
            }
        }
        Ok(preview(response_content))
    }
}

#[derive(Debug, Clone, Default)]
struct QueryTerms {
    terms: BTreeSet<String>,
    exact_terms: BTreeSet<String>,
    code_relevant: bool,
    intent: QueryIntentKind,
}

impl QueryTerms {
    fn matches(&self, normalized: &str) -> bool {
        self.terms.iter().any(|term| {
            normalized == term || normalized.contains(term) || term.contains(normalized)
        })
    }

    fn overlap_score(&self, text: &str) -> f64 {
        let normalized = normalize_text(text);
        self.terms
            .iter()
            .filter(|term| normalized.contains(term.as_str()))
            .count() as f64
    }
}

fn extract_query_terms(prompt: &str, input: &BuildContextInput) -> QueryTerms {
    let mut terms = BTreeSet::new();
    let mut exact_terms = BTreeSet::new();
    for phrase in quoted_phrases(prompt) {
        if let Some(normalized) = normalize_term(&phrase) {
            exact_terms.insert(normalized.clone());
            terms.insert(normalized);
        }
    }
    for token in tokenize(prompt) {
        terms.insert(token);
    }
    for attached in &input.attached_references {
        for value in [
            attached.reference.label.as_deref(),
            attached.reference.selected_text.as_deref(),
            attached.reference.target_uri.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            for token in tokenize(value) {
                terms.insert(token);
            }
        }
    }
    for phrase in known_phrase_terms(prompt) {
        if let Some(normalized) = normalize_term(phrase) {
            exact_terms.insert(normalized.clone());
            terms.insert(normalized);
        }
    }
    let lower = prompt.to_lowercase();
    for language in CODE_LANGUAGE_TERMS {
        if lower.contains(language) {
            terms.insert((*language).to_string());
        }
    }
    let code_relevant = CODE_RELEVANCE_TERMS
        .iter()
        .any(|needle| lower.contains(needle))
        || prompt.contains("```")
        || input.attached_references.iter().any(|attached| {
            attached
                .reference
                .label
                .as_deref()
                .or(attached.reference.selected_text.as_deref())
                .is_some_and(|value| {
                    let lower = value.to_lowercase();
                    CODE_RELEVANCE_TERMS
                        .iter()
                        .chain(CODE_LANGUAGE_TERMS.iter())
                        .any(|needle| lower.contains(needle))
                })
        });
    let intent = classify_query_intent(prompt, input, code_relevant);
    QueryTerms {
        terms,
        exact_terms,
        code_relevant,
        intent,
    }
}

fn classify_query_intent(
    prompt: &str,
    input: &BuildContextInput,
    code_relevant: bool,
) -> QueryIntentKind {
    let lower = prompt.to_lowercase();
    if code_relevant {
        return QueryIntentKind::Code;
    }
    if input
        .attached_references
        .iter()
        .any(|attached| attached.attachment.is_some())
        || [
            "file",
            "document",
            "attachment",
            "pdf",
            "docx",
            "xlsx",
            "spreadsheet",
            "sheet",
            "dosya",
            "belge",
            "ek",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        return QueryIntentKind::FileDocument;
    }
    if [
        "decision",
        "decide",
        "chosen",
        "tradeoff",
        "constraint",
        "risk",
        "karar",
        "seçim",
        "secim",
        "neden seçtik",
        "neden sectik",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return QueryIntentKind::Decision;
    }
    if [
        "latest", "recent", "when", "timeline", "before", "after", "last", "son", "ne zaman",
        "tarih",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return QueryIntentKind::Temporal;
    }
    if [
        "what", "who", "which", "where", "codename", "name", "id", "nedir", "kim", "hangi",
        "nerede", "adı", "adi",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return QueryIntentKind::EntityFactual;
    }
    QueryIntentKind::General
}

fn quoted_phrases(prompt: &str) -> Vec<String> {
    let mut phrases = Vec::new();
    let mut chars = prompt.char_indices();
    while let Some((_, ch)) = chars.next() {
        if ch != '"' && ch != '\'' && ch != '`' {
            continue;
        }
        let quote = ch;
        let mut phrase = String::new();
        for (_, next) in chars.by_ref() {
            if next == quote {
                break;
            }
            phrase.push(next);
        }
        if !phrase.trim().is_empty() {
            phrases.push(phrase);
        }
    }
    phrases
}

fn known_phrase_terms(prompt: &str) -> Vec<&'static str> {
    let lower = prompt.to_lowercase();
    [
        "event sourcing",
        "event store",
        "event replay",
        "event-driven",
        "cqrs",
        "mcp",
        "ipc",
        "sqlite",
        "postgresql",
        "ollama",
        "rust",
        "typescript",
    ]
    .into_iter()
    .filter(|phrase| lower.contains(*phrase))
    .collect()
}

fn tokenize(value: &str) -> Vec<String> {
    value
        .split(|ch: char| !ch.is_alphanumeric())
        .filter_map(normalize_term)
        .filter(|term| term.chars().count() >= 3 || is_acronym(term))
        .filter(|term| !STOP_WORDS.contains(&term.as_str()))
        .collect()
}

fn normalize_text(value: &str) -> String {
    tokenize(value).join(" ")
}

fn normalize_term(value: &str) -> Option<String> {
    let trimmed = value
        .trim_matches(|ch: char| !ch.is_alphanumeric())
        .trim()
        .to_lowercase();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn is_acronym(value: &str) -> bool {
    (2..=8).contains(&value.chars().count()) && value.chars().all(|ch| ch.is_ascii_alphanumeric())
}

#[derive(Debug, Clone)]
struct CandidateAccumulator {
    loom_id: String,
    current_sequence: Option<i64>,
    candidates: BTreeMap<String, ContextRetrievalCandidate>,
}

impl CandidateAccumulator {
    fn new(loom_id: &str, current_sequence: Option<i64>) -> Self {
        Self {
            loom_id: loom_id.to_string(),
            current_sequence,
            candidates: BTreeMap::new(),
        }
    }

    fn add_response(&mut self, response_id: &str, score: f64, reason: &str, text: String) {
        self.add_candidate(
            ContextRetrievalCandidateKind::Response,
            response_id.to_string(),
            Some(response_id.to_string()),
            score,
            reason,
            text,
            ContextRetrievalIncludeMode::Capsule,
        );
    }

    fn add_candidate(
        &mut self,
        candidate_kind: ContextRetrievalCandidateKind,
        candidate_id: String,
        response_id: Option<String>,
        score: f64,
        reason: &str,
        text_preview: String,
        include_mode: ContextRetrievalIncludeMode,
    ) {
        self.add_candidate_with_metadata(
            candidate_kind,
            candidate_id,
            response_id,
            score,
            reason,
            text_preview,
            include_mode,
            BTreeMap::new(),
        );
    }

    fn add_candidate_with_metadata(
        &mut self,
        candidate_kind: ContextRetrievalCandidateKind,
        candidate_id: String,
        response_id: Option<String>,
        score: f64,
        reason: &str,
        text_preview: String,
        include_mode: ContextRetrievalIncludeMode,
        metadata: BTreeMap<String, Value>,
    ) {
        if let Some(response_id) = response_id.as_deref() {
            if self.is_current_or_future(response_id) {
                return;
            }
        }
        let key = format!("{candidate_kind:?}:{candidate_id}");
        let entry = self
            .candidates
            .entry(key)
            .or_insert_with(|| ContextRetrievalCandidate {
                candidate_id,
                candidate_kind: candidate_kind.clone(),
                loom_id: self.loom_id.clone(),
                response_id,
                score: 0.0,
                reasons: Vec::new(),
                text_preview: String::new(),
                include_mode: include_mode.clone(),
                source_level: source_level_for(&candidate_kind, &include_mode),
                query_intent: QueryIntentKind::General,
                estimated_tokens: 0,
                budget_used_tokens: 0,
                scoring_reason: reason.to_string(),
                metadata: metadata.clone(),
            });
        for (key, value) in metadata {
            entry.metadata.entry(key).or_insert(value);
        }
        entry.score += score;
        if !entry.reasons.iter().any(|item| item == reason) {
            entry.reasons.push(reason.to_string());
        }
        if entry.scoring_reason.is_empty() {
            entry.scoring_reason = reason.to_string();
        }
        if include_mode_priority(&include_mode) > include_mode_priority(&entry.include_mode) {
            entry.include_mode = include_mode;
            entry.source_level = source_level_for(&entry.candidate_kind, &entry.include_mode);
        }
        if entry.text_preview.is_empty() || entry.text_preview.len() < text_preview.len() {
            entry.text_preview = text_preview;
        }
    }

    fn is_current_or_future(&self, _response_id: &str) -> bool {
        // The current sequence is honored during final Response enrichment. The
        // deterministic candidate scorer avoids DB lookups in this hot path.
        false
    }

    fn response_ids(&self) -> BTreeSet<String> {
        self.candidates
            .values()
            .filter_map(|candidate| candidate.response_id.clone())
            .collect()
    }

    fn finish(mut self) -> Vec<ContextRetrievalCandidate> {
        let current_sequence = self.current_sequence;
        for candidate in self.candidates.values_mut() {
            if candidate
                .reasons
                .iter()
                .any(|reason| reason == "explicit_reference")
            {
                candidate.score += 4.0;
            }
            candidate.metadata.insert(
                "currentSequence".to_string(),
                serde_json::json!(current_sequence),
            );
            candidate.estimated_tokens = estimate_tokens(&candidate.text_preview).max(8);
        }
        self.candidates.into_values().collect()
    }
}

fn source_level_for(
    kind: &ContextRetrievalCandidateKind,
    include_mode: &ContextRetrievalIncludeMode,
) -> ContextSourceLevel {
    match (kind, include_mode) {
        (ContextRetrievalCandidateKind::WeftOrigin, _) => ContextSourceLevel::WeftOrigin,
        (ContextRetrievalCandidateKind::Checkpoint, _) => ContextSourceLevel::Checkpoint,
        (ContextRetrievalCandidateKind::CodeBlock, ContextRetrievalIncludeMode::CodeExact) => {
            ContextSourceLevel::CodeBlock
        }
        (ContextRetrievalCandidateKind::CodeBlock, _) => ContextSourceLevel::Summary,
        (ContextRetrievalCandidateKind::ResponsePart, ContextRetrievalIncludeMode::Full) => {
            ContextSourceLevel::ExactResponsePart
        }
        (ContextRetrievalCandidateKind::ResponsePart, _) => ContextSourceLevel::Summary,
        (ContextRetrievalCandidateKind::Response, ContextRetrievalIncludeMode::Full) => {
            ContextSourceLevel::ExactResponsePart
        }
        (ContextRetrievalCandidateKind::Response, _) => ContextSourceLevel::Summary,
        (ContextRetrievalCandidateKind::ResponseCapsule, _) => ContextSourceLevel::Summary,
        (ContextRetrievalCandidateKind::Topic, _) => ContextSourceLevel::Summary,
        (ContextRetrievalCandidateKind::Reference, _) => ContextSourceLevel::Memory,
        (ContextRetrievalCandidateKind::Memory, _) => ContextSourceLevel::Memory,
        (ContextRetrievalCandidateKind::AttachmentChunk, _) => ContextSourceLevel::AttachmentChunk,
    }
}

fn apply_query_intent_scores(query: &QueryTerms, candidates: &mut [ContextRetrievalCandidate]) {
    for candidate in candidates {
        candidate.query_intent = query.intent.clone();
        match query.intent {
            QueryIntentKind::Code
                if candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock =>
            {
                candidate.score += 2.0;
                push_reason(candidate, "intent_code_boost");
            }
            QueryIntentKind::Decision => {
                let text = candidate.text_preview.to_lowercase();
                if candidate.candidate_kind == ContextRetrievalCandidateKind::ResponseCapsule
                    || candidate.candidate_kind == ContextRetrievalCandidateKind::Checkpoint
                    || text.contains("decision")
                    || text.contains("karar")
                    || text.contains("constraint")
                    || text.contains("risk")
                {
                    candidate.score += 1.25;
                    push_reason(candidate, "intent_decision_summary_boost");
                }
            }
            QueryIntentKind::EntityFactual => {
                if matches!(
                    candidate.candidate_kind,
                    ContextRetrievalCandidateKind::ResponsePart
                        | ContextRetrievalCandidateKind::ResponseCapsule
                        | ContextRetrievalCandidateKind::Response
                        | ContextRetrievalCandidateKind::Memory
                        | ContextRetrievalCandidateKind::WeftOrigin
                ) {
                    candidate.score += 0.6;
                    push_reason(candidate, "intent_entity_factual_boost");
                }
            }
            QueryIntentKind::Temporal => {
                if candidate.metadata.contains_key("sequenceIndex")
                    || candidate.text_preview.contains("202")
                    || candidate.text_preview.to_lowercase().contains("latest")
                {
                    candidate.score += 0.5;
                    push_reason(candidate, "intent_temporal_boost");
                }
            }
            QueryIntentKind::FileDocument => {
                if candidate.candidate_kind == ContextRetrievalCandidateKind::AttachmentChunk {
                    candidate.score += 1.0;
                    push_reason(candidate, "intent_file_document_boost");
                }
            }
            QueryIntentKind::Code | QueryIntentKind::General => {}
        }
    }
}

#[derive(Debug, Clone)]
struct FtsDocument {
    doc_id: String,
    source_kind: String,
    source_id: String,
    loom_id: Option<String>,
    response_id: Option<String>,
    attachment_id: Option<String>,
    parse_artifact_id: Option<String>,
    title: Option<String>,
    body: String,
    tags: Option<String>,
    source_rank: f64,
    updated_at: String,
    metadata_json: Option<String>,
    bm25_score: f64,
}

impl FtsDocument {
    fn from_row(row: sqlx::sqlite::SqliteRow) -> Self {
        Self {
            doc_id: row.get("doc_id"),
            source_kind: row.get("source_kind"),
            source_id: row.get("source_id"),
            loom_id: row.get("loom_id"),
            response_id: row.get("response_id"),
            attachment_id: row.get("attachment_id"),
            parse_artifact_id: row.get("parse_artifact_id"),
            title: row.get("title"),
            body: row.get("body"),
            tags: row.get("tags"),
            source_rank: row.get("source_rank"),
            updated_at: row.get("updated_at"),
            metadata_json: row.get("metadata_json"),
            bm25_score: row.get("bm25_score"),
        }
    }
}

fn fts_candidate_kind(source_kind: &str) -> Option<ContextRetrievalCandidateKind> {
    match source_kind {
        "response" => Some(ContextRetrievalCandidateKind::Response),
        "response_capsule" => Some(ContextRetrievalCandidateKind::ResponseCapsule),
        "checkpoint" => Some(ContextRetrievalCandidateKind::Checkpoint),
        "memory" => Some(ContextRetrievalCandidateKind::Memory),
        "attachment_chunk" | "attachment_summary" => {
            Some(ContextRetrievalCandidateKind::AttachmentChunk)
        }
        "code_block" => Some(ContextRetrievalCandidateKind::CodeBlock),
        _ => None,
    }
}

fn fts_candidate_id(doc: &FtsDocument) -> String {
    match doc.source_kind.as_str() {
        "response" => doc
            .response_id
            .clone()
            .unwrap_or_else(|| doc.source_id.clone()),
        _ => doc.doc_id.clone(),
    }
}

fn fts_match_query(query: &QueryTerms) -> String {
    let mut terms = query
        .terms
        .iter()
        .filter(|term| term.chars().count() >= 2)
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    terms.sort();
    terms.dedup();
    terms.join(" OR ")
}

fn fts_base_score(source_rank: f64, bm25_score: f64) -> f64 {
    let bm25_component = if bm25_score.is_sign_negative() {
        (-bm25_score).min(8.0)
    } else {
        (1.0 / (1.0 + bm25_score.abs())).min(2.0)
    };
    1.0 + source_rank.max(0.0) * 2.0 + bm25_component
}

fn is_explicit_attachment_reference(
    input: &BuildContextInput,
    attachment_id: Option<&str>,
) -> bool {
    let Some(attachment_id) = attachment_id else {
        return false;
    };
    input.attached_references.iter().any(|attached| {
        attached
            .attachment
            .as_ref()
            .is_some_and(|attachment| attachment.attachment_id == attachment_id)
            || (matches!(
                attached.reference.target_kind.as_str(),
                "attachment" | "attachment_chunk" | "file"
            ) && attached.reference.target_id.as_deref() == Some(attachment_id))
    })
}

fn is_explicit_response_reference(input: &BuildContextInput, response_id: &str) -> bool {
    input.attached_references.iter().any(|attached| {
        attached.reference.target_kind == "response"
            && attached.reference.target_id.as_deref() == Some(response_id)
    })
}

fn fts_exact_title_match(query: &QueryTerms, title: Option<&str>) -> bool {
    let Some(title) = title else {
        return false;
    };
    let normalized = normalize_text(title);
    query
        .exact_terms
        .iter()
        .any(|term| normalized.contains(term.as_str()))
        || query
            .terms
            .iter()
            .filter(|term| term.chars().count() >= 4)
            .any(|term| normalized.contains(term.as_str()))
}

fn fts_code_signal(doc: &FtsDocument) -> bool {
    let text = format!(
        "{}\n{}\n{}\n{}",
        doc.source_kind,
        doc.title.as_deref().unwrap_or_default(),
        doc.tags.as_deref().unwrap_or_default(),
        doc.metadata_json.as_deref().unwrap_or_default()
    )
    .to_lowercase();
    text.contains("code")
        || CODE_LANGUAGE_TERMS
            .iter()
            .any(|language| text.contains(language))
}

fn set_retrieval_diagnostics(query: &QueryTerms, candidates: &mut [ContextRetrievalCandidate]) {
    for candidate in candidates {
        candidate.source_level =
            source_level_for(&candidate.candidate_kind, &candidate.include_mode);
        candidate.query_intent = query.intent.clone();
        candidate.estimated_tokens = estimate_tokens(&candidate.text_preview).max(8);
        candidate.scoring_reason = candidate
            .reasons
            .first()
            .cloned()
            .unwrap_or_else(|| "retrieval_score".to_string());
        candidate.metadata.insert(
            "sourceLevel".to_string(),
            serde_json::json!(candidate.source_level),
        );
        candidate.metadata.insert(
            "queryIntent".to_string(),
            serde_json::json!(candidate.query_intent),
        );
        candidate.metadata.insert(
            "estimatedTokens".to_string(),
            serde_json::json!(candidate.estimated_tokens),
        );
        candidate.metadata.insert(
            "scoringReason".to_string(),
            Value::String(candidate.scoring_reason.clone()),
        );
    }
}

fn push_reason(candidate: &mut ContextRetrievalCandidate, reason: &str) {
    if !candidate.reasons.iter().any(|existing| existing == reason) {
        candidate.reasons.push(reason.to_string());
    }
}

fn include_mode_priority(mode: &ContextRetrievalIncludeMode) -> u8 {
    match mode {
        ContextRetrievalIncludeMode::ReferenceOnly => 0,
        ContextRetrievalIncludeMode::CodeSummary => 1,
        ContextRetrievalIncludeMode::Capsule => 2,
        ContextRetrievalIncludeMode::Full => 3,
        ContextRetrievalIncludeMode::CodeExact => 4,
    }
}

fn is_explicit_code_reference(
    input: &BuildContextInput,
    response_id: &str,
    code_block_id: &str,
) -> bool {
    input.attached_references.iter().any(|attached| {
        let target_id = attached.reference.target_id.as_deref();
        let targets_code_block = matches!(attached.reference.target_kind.as_str(), "code_block")
            && target_id == Some(code_block_id);
        let targets_source_response = target_id == Some(response_id);
        (targets_code_block || targets_source_response)
            && (targets_code_block
                || attached
                    .response_capsule
                    .as_ref()
                    .is_some_and(|capsule| !capsule.code_blocks.is_empty())
                || attached
                    .reference
                    .label
                    .as_deref()
                    .or(attached.reference.selected_text.as_deref())
                    .is_some_and(|value| {
                        let lower = value.to_lowercase();
                        CODE_RELEVANCE_TERMS
                            .iter()
                            .chain(CODE_LANGUAGE_TERMS.iter())
                            .any(|needle| lower.contains(needle))
                    })
                || matches!(
                    attached.reference.target_kind.as_str(),
                    "code" | "code_block" | "response"
                ))
    })
}

fn is_explicit_response_code_reference(input: &BuildContextInput, response_id: &str) -> bool {
    input.attached_references.iter().any(|attached| {
        attached.reference.target_id.as_deref() == Some(response_id)
            && (attached
                .response_capsule
                .as_ref()
                .is_some_and(|capsule| !capsule.code_blocks.is_empty())
                || attached
                    .reference
                    .label
                    .as_deref()
                    .is_some_and(contains_code_signal)
                || attached
                    .reference
                    .selected_text
                    .as_deref()
                    .is_some_and(contains_code_signal))
    })
}

fn contains_code_signal(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.contains("```")
        || CODE_RELEVANCE_TERMS
            .iter()
            .chain(CODE_LANGUAGE_TERMS.iter())
            .any(|needle| lower.contains(needle))
}

fn exact_code_context(
    code_block_id: &str,
    language: Option<&str>,
    source_response_id: &str,
    source_title: Option<&str>,
    code: &str,
) -> String {
    let language = language.unwrap_or("text");
    let source_title = source_title.unwrap_or("Untitled Response");
    format!(
        "Relevant code block:\n- codeBlockId: {code_block_id}\n- language: {language}\n- sourceResponseId: {source_response_id}\n- sourceTitle: {source_title}\n~~~{language}\n{code}~~~"
    )
}

fn summary_code_context(
    code_block_id: &str,
    language: Option<&str>,
    exact_hash: &str,
    source_response_id: &str,
    source_title: Option<&str>,
) -> String {
    let language = language.unwrap_or("unknown");
    let source_title = source_title.unwrap_or("Untitled Response");
    format!(
        "Relevant code block reference:\n* codeBlockId: {code_block_id}\n* language: {language}\n* exactHash: {exact_hash}\n* sourceResponseId: {source_response_id}\n* descriptor: {source_title}"
    )
}

fn code_summary_from_metadata(candidate: &ContextRetrievalCandidate) -> String {
    candidate
        .metadata
        .get("summaryText")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "Relevant code block reference:\n* codeBlockId: {}\n* descriptor: exact code available as artifact",
                candidate.candidate_id
            )
        })
}

fn truncate_code_context(value: &str, max_tokens: usize) -> String {
    let max_chars = max_tokens.saturating_mul(4);
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = String::new();
    for character in value.chars().take(max_chars.saturating_sub(80)) {
        truncated.push(character);
    }
    truncated.push_str(
        "\n...\n[code_block_truncated: exact code continues in the code block artifact]\n~~~",
    );
    truncated
}

fn preview(value: &str) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= 420 {
        collapsed
    } else {
        let mut result: String = collapsed.chars().take(419).collect();
        result.push('…');
        result
    }
}

fn reject_forbidden_payload(payload: &str) -> Result<(), ServiceError> {
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "retrieval payload contains forbidden key {forbidden}"
            )));
        }
    }
    Ok(())
}

fn is_stale_metadata(metadata: &str) -> bool {
    serde_json::from_str::<Value>(metadata)
        .ok()
        .is_some_and(|value| {
            value.get("stale").and_then(Value::as_bool) == Some(true)
                || value.get("staleReason").is_some()
                || value.get("staleDueTo").is_some()
        })
}

#[cfg(test)]
mod tests {
    use super::{
        ContextRetrievalCandidateKind, ContextRetrievalIncludeMode, ContextRetriever,
        ContextSourceLevel, QueryIntentKind,
    };
    use crate::{
        capabilities::strategy::{ExecutionStrategy, ExecutionStrategyDecision},
        context::{
            manager::ContextManager,
            types::{
                AttachedReferenceInput, AttachmentContext, BuildContextInput, ContextMessage,
                ContextMessageRole, ContextSource, ContextSourceKind, ReferenceContext,
                ResponseMode, WeftOriginContext,
            },
        },
        storage::{
            db::test_database,
            repositories::{
                context_artifacts::{
                    ContextArtifactsRepository, UpsertResponseCapsule, UpsertWeftOriginContext,
                },
                looms::{LoomRepository, NewLoom},
                responses::{NewResponse, ResponseRepository},
                search_index::SearchIndexRepository,
            },
        },
    };
    use serde_json::Value;

    #[tokio::test]
    async fn event_sourcing_query_retrieves_old_tagged_capsule() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-event",
                "assistant",
                "## Event Sourcing\nEvent Store, Replay ve CQRS ile avantajları ve dezavantajları açıklar.",
                1,
                None,
            )
            .await;
        fixture
            .insert_capsule(
                "r-event",
                "Event Sourcing capsule",
                "Event Sourcing uses an Event Store, Replay, CQRS, advantages and disadvantages.",
                &["Event Sourcing", "Event Store", "Replay", "CQRS"],
                &[],
            )
            .await;
        fixture
            .insert_response("r-current", "user", "Event Sourcing avantajları", 9, None)
            .await;

        let result = fixture
            .retriever()
            .retrieve(&fixture.input("Event Sourcing avantajları", Some("r-current")))
            .await
            .expect("retrieve");

        assert!(result
            .query_terms
            .iter()
            .any(|term| term == "event sourcing"));
        assert!(result.selected.iter().any(|candidate| {
            candidate.response_id.as_deref() == Some("r-event")
                && candidate.text_preview.contains("Event Sourcing")
        }));
    }

    #[tokio::test]
    async fn retrieval_diagnostics_include_source_level_reason_and_budget() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-event",
                "assistant",
                "Event Sourcing uses Event Store and Replay.",
                1,
                None,
            )
            .await;
        fixture
            .insert_capsule(
                "r-event",
                "Event Sourcing capsule",
                "Event Sourcing summary with Replay.",
                &["Event Sourcing", "Replay"],
                &[],
            )
            .await;
        fixture
            .insert_response(
                "r-current",
                "user",
                "What is Event Sourcing Replay?",
                9,
                None,
            )
            .await;

        let result = fixture
            .retriever()
            .retrieve(&fixture.input("What is Event Sourcing Replay?", Some("r-current")))
            .await
            .expect("retrieve");
        let selected = result.selected.first().expect("selected candidate");

        assert_eq!(result.query_intent, QueryIntentKind::EntityFactual);
        assert!(matches!(
            selected.source_level,
            ContextSourceLevel::Summary | ContextSourceLevel::ExactResponsePart
        ));
        assert!(!selected.scoring_reason.is_empty());
        assert!(selected.estimated_tokens > 0);
        assert!(selected.budget_used_tokens >= selected.estimated_tokens);
        assert!(selected.metadata.contains_key("sourceLevel"));
        assert!(selected.metadata.contains_key("queryIntent"));
    }

    #[tokio::test]
    async fn acronym_query_retrieves_acronym_tagged_response() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-cqrs",
                "assistant",
                "CQRS, komut ve okuma modellerini ayıran bir mimari yaklaşımdır.",
                1,
                None,
            )
            .await;
        fixture
            .insert_response("r-current", "user", "CQRS ilişkisi nedir?", 9, None)
            .await;

        let result = fixture
            .retriever()
            .retrieve(&fixture.input("CQRS ilişkisi nedir?", Some("r-current")))
            .await
            .expect("retrieve");

        assert!(result.selected.iter().any(|candidate| {
            candidate.response_id.as_deref() == Some("r-cqrs")
                && candidate.reasons.iter().any(|reason| reason == "tag_match")
        }));
    }

    #[tokio::test]
    async fn graph_topic_and_reference_signals_rank_candidates_deterministically() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-1",
                "assistant",
                "Event Sourcing ve CQRS ilişkisi.",
                1,
                None,
            )
            .await;
        fixture
            .insert_response(
                "r-2",
                "assistant",
                "Event Sourcing için Replay detayları.",
                2,
                None,
            )
            .await;
        fixture
            .insert_response("r-current", "user", "Replay nasıl yapılır?", 9, None)
            .await;

        let result = fixture
            .retriever()
            .retrieve(&BuildContextInput {
                attached_references: vec![fixture.reference("r-2")],
                ..fixture.input("Replay nasıl yapılır?", Some("r-current"))
            })
            .await
            .expect("retrieve");

        let selected_ids = result
            .selected
            .iter()
            .filter_map(|candidate| candidate.response_id.as_deref())
            .collect::<Vec<_>>();
        assert!(selected_ids.contains(&"r-2"));
        assert!(result.selected.iter().any(|candidate| {
            candidate.response_id.as_deref() == Some("r-2")
                && candidate
                    .reasons
                    .iter()
                    .any(|reason| reason == "explicit_reference_boost")
        }));
        assert!(result.candidates.iter().any(|candidate| {
            candidate
                .reasons
                .iter()
                .any(|reason| reason == "graph_neighbor")
        }));
    }

    #[tokio::test]
    async fn code_relevant_prompt_uses_exact_code_and_non_code_prompt_uses_summary() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-code",
                "assistant",
                "```rust\nfn replay_events() {\n    apply();\n}\n```",
                1,
                None,
            )
            .await;
        fixture
            .insert_response(
                "r-current",
                "user",
                "bu Rust kod neden çalışmıyor?",
                9,
                None,
            )
            .await;

        let exact = fixture
            .retriever()
            .retrieve_with_strategy(
                &fixture.input("bu Rust kod neden çalışmıyor?", Some("r-current")),
                Some(&strong_strategy()),
            )
            .await
            .expect("retrieve");
        assert_eq!(exact.query_intent, QueryIntentKind::Code);
        assert!(
            exact.selected.iter().any(|candidate| {
                candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock
                    && candidate.include_mode == ContextRetrievalIncludeMode::CodeExact
                    && candidate
                        .reasons
                        .iter()
                        .any(|reason| reason == "intent_code_boost")
            }),
            "selected={:?}; candidates={:?}",
            exact.selected,
            exact.candidates
        );

        let summary = fixture
            .retriever()
            .retrieve(&fixture.input("Rust mimarisi nedir?", Some("r-current")))
            .await
            .expect("retrieve");
        assert!(summary.candidates.iter().any(|candidate| {
            candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock
                && candidate.include_mode == ContextRetrievalIncludeMode::CodeSummary
        }));
    }

    #[tokio::test]
    async fn explicit_reference_to_code_response_promotes_exact_code_when_budget_allows() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-code",
                "assistant",
                "```typescript\nexport function replay() {\n  return events.map(apply);\n}\n```",
                1,
                None,
            )
            .await;
        fixture
            .insert_response("r-current", "user", "Bu referansı açıkla", 9, None)
            .await;

        let input = BuildContextInput {
            attached_references: vec![AttachedReferenceInput {
                reference: ReferenceContext {
                    reference_id: "ref-code".to_string(),
                    target_kind: "response".to_string(),
                    target_id: Some("r-code".to_string()),
                    target_uri: None,
                    label: Some("TypeScript code reference".to_string()),
                    selected_text: Some("Replay implementation code".to_string()),
                    capsule_summary: None,
                },
                response_capsule: None,
                attachment: None,
            }],
            ..fixture.input("Bu referansı açıkla", Some("r-current"))
        };
        let result = fixture
            .retriever()
            .retrieve_with_strategy(&input, Some(&strong_strategy()))
            .await
            .expect("retrieve");

        let code = result
            .selected
            .iter()
            .find(|candidate| candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock)
            .expect("code candidate");
        assert_eq!(code.include_mode, ContextRetrievalIncludeMode::CodeExact);
        assert!(code.text_preview.contains("export function replay()"));
        assert!(code
            .reasons
            .iter()
            .any(|reason| reason == "explicit_code_reference"));
    }

    #[tokio::test]
    async fn explicit_code_block_reference_promotes_exact_code_by_code_block_id() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-code",
                "assistant",
                "```sql\nSELECT *\nFROM orders\nWHERE status = 'open';\n```",
                1,
                None,
            )
            .await;
        fixture
            .insert_response("r-current", "user", "Bu snippet'i açıkla", 9, None)
            .await;
        let code_block_id = fixture.code_block_id_for_response("r-code").await;

        let input = BuildContextInput {
            attached_references: vec![AttachedReferenceInput {
                reference: ReferenceContext {
                    reference_id: "ref-code-block".to_string(),
                    target_kind: "code_block".to_string(),
                    target_id: Some(code_block_id.clone()),
                    target_uri: Some("loom://responses/r-code#code-block=0".to_string()),
                    label: Some("SQL code snippet".to_string()),
                    selected_text: None,
                    capsule_summary: None,
                },
                response_capsule: None,
                attachment: None,
            }],
            ..fixture.input("Bu snippet'i açıkla", Some("r-current"))
        };
        let result = fixture
            .retriever()
            .retrieve_with_strategy(&input, Some(&strong_strategy()))
            .await
            .expect("retrieve");

        let code = result
            .selected
            .iter()
            .find(|candidate| candidate.candidate_id == code_block_id)
            .expect("code candidate");
        assert_eq!(code.include_mode, ContextRetrievalIncludeMode::CodeExact);
        assert!(code.text_preview.contains("SELECT *"));
        assert!(code.text_preview.contains("WHERE status = 'open';"));
        assert!(code
            .reasons
            .iter()
            .any(|reason| reason == "explicit_code_reference"));
    }

    #[tokio::test]
    async fn illustrative_artifact_metadata_blocks_are_not_retrieved_as_code() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-fake-artifact",
                "assistant",
                "Illustrative generated artifact metadata example.",
                1,
                None,
            )
            .await;
        sqlx::query(
            "INSERT INTO response_code_blocks (
                code_block_id, response_id, loom_id, block_index, language, code,
                exact_hash, fence, metadata_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)",
        )
        .bind("codeblock-fake-artifact")
        .bind("r-fake-artifact")
        .bind("loom-1")
        .bind(0i64)
        .bind("text")
        .bind(
            "Assistant: Kod review artifact'ı oluşturulur\n- Hash: abc123def456\n- Type: Security Analysis\n- Provenance: [timestamp, user, tool]\n",
        )
        .bind("fnv1a64:fake")
        .bind("```")
        .bind("1")
        .bind("1")
        .execute(fixture.database.pool())
        .await
        .expect("insert fake code block");
        fixture
            .insert_response(
                "r-current",
                "user",
                "Kod artifact hash provenance nedir?",
                9,
                None,
            )
            .await;

        let result = fixture
            .retriever()
            .retrieve_with_strategy(
                &fixture.input("Kod artifact hash provenance nedir?", Some("r-current")),
                Some(&strong_strategy()),
            )
            .await
            .expect("retrieve");

        assert!(
            result
                .candidates
                .iter()
                .all(|candidate| candidate.candidate_id != "codeblock-fake-artifact"),
            "candidates={:?}",
            result.candidates
        );
    }

    #[tokio::test]
    async fn exact_code_context_preserves_indentation_blank_lines_and_pipes() {
        let fixture = Fixture::new().await;
        let exact_code =
            "fn render_table() {\n    let row = \"| a | b |\";\n\n    println!(\"{}\", row);\n}\n";
        fixture
            .insert_response(
                "r-code",
                "assistant",
                &format!("```rust\n{exact_code}```"),
                1,
                None,
            )
            .await;
        fixture
            .insert_response("r-current", "user", "Rust kod hata veriyor", 9, None)
            .await;

        let result = fixture
            .retriever()
            .retrieve_with_strategy(
                &fixture.input("Rust kod hata veriyor", Some("r-current")),
                Some(&strong_strategy()),
            )
            .await
            .expect("retrieve");

        let code = result
            .selected
            .iter()
            .find(|candidate| candidate.include_mode == ContextRetrievalIncludeMode::CodeExact)
            .expect("exact code");
        assert!(code.text_preview.contains(exact_code));
        assert!(code.text_preview.contains("    let row = \"| a | b |\";"));
        assert!(code.text_preview.contains("\n\n    println!"));
    }

    #[tokio::test]
    async fn large_code_block_is_truncated_with_warning() {
        let fixture = Fixture::new().await;
        let large_code = (0..900)
            .map(|index| format!("    line_{index}();"))
            .collect::<Vec<_>>()
            .join("\n");
        fixture
            .insert_response(
                "r-large-code",
                "assistant",
                &format!("```rust\n{large_code}\n```"),
                1,
                None,
            )
            .await;
        fixture
            .insert_response("r-current", "user", "Rust kod debug", 9, None)
            .await;

        let result = fixture
            .retriever()
            .retrieve_with_strategy(
                &fixture.input("Rust kod debug", Some("r-current")),
                Some(&strong_strategy()),
            )
            .await
            .expect("retrieve");

        assert!(result
            .warnings
            .iter()
            .any(|warning| warning == "code_block_truncated"));
        let code = result
            .selected
            .iter()
            .find(|candidate| candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock)
            .expect("code candidate");
        assert!(code.text_preview.contains("code_block_truncated"));
    }

    #[tokio::test]
    async fn weak_budget_downgrades_code_exact_to_summary() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-code",
                "assistant",
                "```rust\nfn replay_events() {\n    apply();\n}\n```",
                1,
                None,
            )
            .await;
        fixture
            .insert_response("r-current", "user", "Rust kod debug", 9, None)
            .await;

        let result = fixture
            .retriever()
            .retrieve_with_strategy(
                &fixture.input("Rust kod debug", Some("r-current")),
                Some(&weak_strategy()),
            )
            .await
            .expect("retrieve");

        assert!(result.selected.iter().any(|candidate| {
            candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock
                && candidate.include_mode == ContextRetrievalIncludeMode::CodeSummary
                && candidate
                    .reasons
                    .iter()
                    .any(|reason| reason == "context_budget_plan_downgraded_to_summary")
        }));
    }

    #[tokio::test]
    async fn conceptual_event_sourcing_follow_up_does_not_include_exact_code() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-event-code",
                "assistant",
                "Event Sourcing example.\n```rust\nfn replay_events() {\n    apply();\n}\n```",
                1,
                None,
            )
            .await;
        fixture
            .insert_response(
                "r-current",
                "user",
                "Event Sourcing avantajları nelerdir?",
                9,
                None,
            )
            .await;

        let result = fixture
            .retriever()
            .retrieve_with_strategy(
                &fixture.input("Event Sourcing avantajları nelerdir?", Some("r-current")),
                Some(&strong_strategy()),
            )
            .await
            .expect("retrieve");

        assert!(!result.selected.iter().any(|candidate| {
            candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock
                && candidate.include_mode == ContextRetrievalIncludeMode::CodeExact
        }));
    }

    #[tokio::test]
    async fn stale_response_is_penalized_and_not_selected_as_primary() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-stale",
                "assistant",
                "Event Sourcing eski ve hatalı bir açıklama.",
                1,
                Some(serde_json::json!({ "stale": true }).to_string()),
            )
            .await;
        fixture
            .insert_response(
                "r-fresh",
                "assistant",
                "Event Sourcing güncel açıklama.",
                2,
                None,
            )
            .await;
        fixture
            .insert_response("r-current", "user", "Event Sourcing", 9, None)
            .await;

        let result = fixture
            .retriever()
            .retrieve(&fixture.input("Event Sourcing", Some("r-current")))
            .await
            .expect("retrieve");

        let stale = result
            .candidates
            .iter()
            .find(|candidate| candidate.response_id.as_deref() == Some("r-stale"))
            .expect("stale candidate");
        assert!(stale
            .reasons
            .iter()
            .any(|reason| reason == "stale_response_penalty"));
        assert_eq!(
            stale.include_mode,
            ContextRetrievalIncludeMode::ReferenceOnly
        );
        assert_eq!(
            result
                .selected
                .first()
                .and_then(|candidate| candidate.response_id.as_deref()),
            Some("r-fresh")
        );
    }

    #[tokio::test]
    async fn repository_context_keeps_recent_turns_and_adds_retrieved_memory() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-old",
                "assistant",
                "Event Sourcing eski kararlarda Event Store ve CQRS ile seçildi.",
                1,
                None,
            )
            .await;
        fixture
            .insert_response("r-current", "user", "Event Sourcing avantajları", 9, None)
            .await;

        let manager = ContextManager::with_repository(
            None,
            ContextArtifactsRepository::new(&fixture.database),
        );
        let built = manager
            .build_context_with_repositories(
                fixture.input_with_recent("Event Sourcing avantajları", Some("r-current")),
            )
            .await
            .expect("build context");

        assert!(built.messages.iter().any(|message| {
            message.source_kind == Some(ContextSourceKind::RecentTurn)
                && message.content.contains("Immediate previous answer")
        }));
        assert!(built.messages.iter().any(|message| {
            message.source_kind == Some(ContextSourceKind::RetrievedMemory)
                && message.content.contains("Event Sourcing")
        }));
    }

    #[tokio::test]
    async fn weft_retrieval_uses_hidden_origin_summary_as_background() {
        let fixture = Fixture::new().await;
        fixture.insert_weft_origin().await;
        fixture
            .insert_response("r-current", "user", "Event Sourcing Replay", 9, None)
            .await;

        let mut input = fixture.input("Event Sourcing Replay", Some("r-current"));
        input.source = ContextSource::Weft;
        input.loom_id = "weft-1".to_string();
        input.weft_origin = Some(WeftOriginContext {
            context_id: "weft-origin-1".to_string(),
            weft_loom_id: "weft-1".to_string(),
            origin_loom_id: "loom-1".to_string(),
            origin_response_id: "r-origin".to_string(),
            origin_capsule_id: Some("capsule-origin".to_string()),
            origin_summary: "Hidden origin: Event Sourcing Replay with Event Store.".to_string(),
            source_hash: None,
            status: crate::context::types::ArtifactStatus::Ready,
        });

        let result = fixture
            .retriever()
            .retrieve(&input)
            .await
            .expect("retrieve");
        assert!(result.selected.iter().any(|candidate| {
            candidate
                .reasons
                .iter()
                .any(|reason| reason == "weft_hidden_origin_match")
                && candidate.text_preview.contains("Hidden origin")
        }));
    }

    #[tokio::test]
    async fn fts_retrieval_returns_relevant_response_candidate_with_diagnostics() {
        let fixture = Fixture::new().await;
        fixture
            .insert_response(
                "r-fts",
                "assistant",
                "Blue Otter is the launch codename for the local-first search work.",
                1,
                None,
            )
            .await;
        fixture
            .insert_response(
                "r-current",
                "user",
                "What is the Blue Otter codename?",
                9,
                None,
            )
            .await;
        SearchIndexRepository::new(&fixture.database)
            .upsert_response_docs("r-fts")
            .await
            .expect("index response");

        let result = fixture
            .retriever()
            .retrieve(&fixture.input("What is the Blue Otter codename?", Some("r-current")))
            .await
            .expect("retrieve");

        let fts = result
            .selected
            .iter()
            .find(|candidate| candidate.response_id.as_deref() == Some("r-fts"))
            .expect("fts response candidate");
        assert!(fts.reasons.iter().any(|reason| reason == "fts_match"));
        assert_eq!(
            fts.metadata.get("retrievalSource").and_then(Value::as_str),
            Some("fts")
        );
        assert!(fts.metadata.contains_key("ftsBm25"));
        assert!(fts.metadata.contains_key("ftsRankingContribution"));
    }

    #[tokio::test]
    async fn fts_current_loom_memory_is_boosted_over_global_memory() {
        let fixture = Fixture::new().await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "memory:global".to_string(),
                source_kind: "memory".to_string(),
                source_id: "memory-global".to_string(),
                loom_id: None,
                response_id: None,
                attachment_id: None,
                title: Some("Global codename memory".to_string()),
                body: "Blue Otter global memory".to_string(),
                tags: Some("explicit_user_memory".to_string()),
                source_rank: 1.0,
                is_deleted: false,
                metadata_json: None,
            })
            .await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "memory:loom".to_string(),
                source_kind: "memory".to_string(),
                source_id: "memory-loom".to_string(),
                loom_id: Some("loom-1".to_string()),
                response_id: None,
                attachment_id: None,
                title: Some("Loom codename memory".to_string()),
                body: "Blue Otter current Loom memory".to_string(),
                tags: Some("explicit_user_memory".to_string()),
                source_rank: 1.0,
                is_deleted: false,
                metadata_json: None,
            })
            .await;

        let result = fixture
            .retriever()
            .retrieve(&fixture.input("Blue Otter codename", None))
            .await
            .expect("retrieve");

        let first = result.selected.first().expect("selected");
        assert_eq!(first.candidate_id, "memory:loom");
        assert!(first
            .reasons
            .iter()
            .any(|reason| reason == "fts_current_loom_boost"));
    }

    #[tokio::test]
    async fn fts_explicit_attachment_reference_outranks_generic_hits() {
        let fixture = Fixture::new().await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "memory:generic".to_string(),
                source_kind: "memory".to_string(),
                source_id: "memory-generic".to_string(),
                loom_id: None,
                response_id: None,
                attachment_id: None,
                title: Some("Generic Blue Otter note".to_string()),
                body: "Blue Otter generic background".to_string(),
                tags: Some("memory".to_string()),
                source_rank: 4.0,
                is_deleted: false,
                metadata_json: None,
            })
            .await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "attachment:att-1:chunk:0".to_string(),
                source_kind: "attachment_chunk".to_string(),
                source_id: "chunk-1".to_string(),
                loom_id: Some("loom-1".to_string()),
                response_id: None,
                attachment_id: Some("att-1".to_string()),
                title: Some("blue-otter-plan.md".to_string()),
                body: "Blue Otter attachment plan with launch constraints.".to_string(),
                tags: Some("md".to_string()),
                source_rank: 0.5,
                is_deleted: false,
                metadata_json: Some(serde_json::json!({ "chunkIndex": 0 }).to_string()),
            })
            .await;

        let input = BuildContextInput {
            attached_references: vec![fixture.attachment_reference("att-1", "blue-otter-plan.md")],
            ..fixture.input("Blue Otter constraints", None)
        };
        let result = fixture
            .retriever()
            .retrieve(&input)
            .await
            .expect("retrieve");

        let first = result.selected.first().expect("selected");
        assert_eq!(
            first.candidate_kind,
            ContextRetrievalCandidateKind::AttachmentChunk
        );
        assert_eq!(
            first.metadata.get("attachmentId").and_then(Value::as_str),
            Some("att-1")
        );
        assert!(first
            .reasons
            .iter()
            .any(|reason| reason == "fts_explicit_attachment_reference_boost"));
    }

    #[tokio::test]
    async fn fts_attachment_chunks_do_not_leak_across_looms() {
        let fixture = Fixture::new().await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "attachment:other:chunk:0".to_string(),
                source_kind: "attachment_chunk".to_string(),
                source_id: "other-chunk".to_string(),
                loom_id: Some("loom-other".to_string()),
                response_id: None,
                attachment_id: Some("att-other".to_string()),
                title: Some("other.md".to_string()),
                body: "Blue Otter should not leak from another Loom.".to_string(),
                tags: Some("md".to_string()),
                source_rank: 9.0,
                is_deleted: false,
                metadata_json: None,
            })
            .await;

        let result = fixture
            .retriever()
            .retrieve(&fixture.input("Blue Otter leak", None))
            .await
            .expect("retrieve");

        assert!(!result.candidates.iter().any(|candidate| {
            candidate
                .metadata
                .get("attachmentId")
                .and_then(Value::as_str)
                == Some("att-other")
        }));
    }

    #[tokio::test]
    async fn fts_attachment_chunks_require_explicit_window_reference() {
        let fixture = Fixture::new().await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "attachment:att-1:chunk:0".to_string(),
                source_kind: "attachment_chunk".to_string(),
                source_id: "chunk-1".to_string(),
                loom_id: Some("loom-1".to_string()),
                response_id: None,
                attachment_id: Some("att-1".to_string()),
                title: Some("blue-otter-plan.md".to_string()),
                body:
                    "Blue Otter attachment plan should not be retrieved without a window reference."
                        .to_string(),
                tags: Some("md".to_string()),
                source_rank: 9.0,
                is_deleted: false,
                metadata_json: None,
            })
            .await;

        let result = fixture
            .retriever()
            .retrieve(&fixture.input("Blue Otter attachment plan", None))
            .await
            .expect("retrieve");

        assert!(!result.candidates.iter().any(|candidate| {
            candidate.candidate_kind == ContextRetrievalCandidateKind::AttachmentChunk
        }));
    }

    #[tokio::test]
    async fn fts_does_not_replace_weft_hidden_origin_context() {
        let fixture = Fixture::new().await;
        fixture.insert_weft_origin().await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "memory:event".to_string(),
                source_kind: "memory".to_string(),
                source_id: "memory-event".to_string(),
                loom_id: None,
                response_id: None,
                attachment_id: None,
                title: Some("Event Sourcing memory".to_string()),
                body: "Event Sourcing Replay from FTS memory.".to_string(),
                tags: Some("memory".to_string()),
                source_rank: 1.0,
                is_deleted: false,
                metadata_json: None,
            })
            .await;
        let mut input = fixture.input("Event Sourcing Replay", None);
        input.source = ContextSource::Weft;
        input.loom_id = "weft-1".to_string();
        input.weft_origin = Some(WeftOriginContext {
            context_id: "weft-origin-1".to_string(),
            weft_loom_id: "weft-1".to_string(),
            origin_loom_id: "loom-1".to_string(),
            origin_response_id: "r-origin".to_string(),
            origin_capsule_id: Some("capsule-origin".to_string()),
            origin_summary: "Hidden origin: Event Sourcing Replay with Event Store.".to_string(),
            source_hash: None,
            status: crate::context::types::ArtifactStatus::Ready,
        });

        let result = fixture
            .retriever()
            .retrieve(&input)
            .await
            .expect("retrieve");

        assert!(result.candidates.iter().any(|candidate| {
            candidate
                .reasons
                .iter()
                .any(|reason| reason == "weft_hidden_origin_match")
        }));
        assert!(result.candidates.iter().any(|candidate| {
            candidate
                .metadata
                .get("retrievalSource")
                .and_then(Value::as_str)
                == Some("fts")
        }));
    }

    #[tokio::test]
    async fn fts_query_intent_boosts_code_documents() {
        let fixture = Fixture::new().await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "response:generic-code".to_string(),
                source_kind: "response".to_string(),
                source_id: "generic-code".to_string(),
                loom_id: Some("loom-1".to_string()),
                response_id: None,
                attachment_id: None,
                title: Some("Rust architecture".to_string()),
                body: "Rust build error and implementation note.".to_string(),
                tags: Some("assistant".to_string()),
                source_rank: 1.0,
                is_deleted: false,
                metadata_json: None,
            })
            .await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "code:block-1".to_string(),
                source_kind: "code_block".to_string(),
                source_id: "block-1".to_string(),
                loom_id: Some("loom-1".to_string()),
                response_id: None,
                attachment_id: None,
                title: Some("Rust code block".to_string()),
                body: "fn build_index() { compile(); }".to_string(),
                tags: Some("rust code".to_string()),
                source_rank: 1.0,
                is_deleted: false,
                metadata_json: Some(serde_json::json!({ "language": "rust" }).to_string()),
            })
            .await;

        let result = fixture
            .retriever()
            .retrieve(&fixture.input("Rust code compile bug", None))
            .await
            .expect("retrieve");

        assert_eq!(result.query_intent, QueryIntentKind::Code);
        let first = result.selected.first().expect("selected");
        assert_eq!(
            first.candidate_kind,
            ContextRetrievalCandidateKind::CodeBlock
        );
        assert!(first
            .reasons
            .iter()
            .any(|reason| reason == "fts_code_intent_boost"));
    }

    #[tokio::test]
    async fn fts_excludes_deleted_docs_and_rejects_raw_thinking_payloads() {
        let fixture = Fixture::new().await;
        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "memory:deleted".to_string(),
                source_kind: "memory".to_string(),
                source_id: "memory-deleted".to_string(),
                loom_id: None,
                response_id: None,
                attachment_id: None,
                title: Some("Deleted Blue Otter".to_string()),
                body: "Blue Otter deleted content".to_string(),
                tags: Some("memory".to_string()),
                source_rank: 9.0,
                is_deleted: true,
                metadata_json: None,
            })
            .await;
        let deleted = fixture
            .retriever()
            .retrieve(&fixture.input("Blue Otter deleted", None))
            .await
            .expect("retrieve");
        assert!(deleted.candidates.is_empty());

        fixture
            .insert_search_doc(TestSearchDoc {
                doc_id: "memory:raw".to_string(),
                source_kind: "memory".to_string(),
                source_id: "memory-raw".to_string(),
                loom_id: None,
                response_id: None,
                attachment_id: None,
                title: Some("Unsafe memory".to_string()),
                body: "raw thinking payload includes raw_thinking and must fail.".to_string(),
                tags: Some("memory".to_string()),
                source_rank: 1.0,
                is_deleted: false,
                metadata_json: None,
            })
            .await;
        let error = fixture
            .retriever()
            .retrieve(&fixture.input("raw thinking", None))
            .await
            .expect_err("raw thinking payload should fail");
        assert!(error.to_string().contains("forbidden key"));
    }

    #[tokio::test]
    async fn fts_retrieval_respects_selection_budget() {
        let fixture = Fixture::new().await;
        for index in 0..8 {
            fixture
                .insert_search_doc(TestSearchDoc {
                    doc_id: format!("memory:budget-{index}"),
                    source_kind: "memory".to_string(),
                    source_id: format!("memory-budget-{index}"),
                    loom_id: None,
                    response_id: None,
                    attachment_id: None,
                    title: Some(format!("Budget Blue Otter {index}")),
                    body: format!(
                        "Blue Otter budget candidate {index}. {}",
                        "Detailed context ".repeat(80)
                    ),
                    tags: Some("memory".to_string()),
                    source_rank: 1.0,
                    is_deleted: false,
                    metadata_json: None,
                })
                .await;
        }

        let result = fixture
            .retriever()
            .retrieve(&BuildContextInput {
                resolved_num_ctx: 2048,
                ..fixture.input("Blue Otter budget", None)
            })
            .await
            .expect("retrieve");

        assert!(result.selected.len() <= 3);
        assert!(result
            .warnings
            .iter()
            .any(|warning| warning == "retrieval_candidates_capped"));
        assert!(result
            .selected
            .iter()
            .all(|candidate| candidate.budget_used_tokens > 0));
    }

    #[tokio::test]
    async fn retrieval_rejects_raw_thinking_payloads() {
        let fixture = Fixture::new().await;
        sqlx::query(
            "INSERT INTO response_context_capsules (
                capsule_id, response_id, loom_id, summary, status, created_at, updated_at
            ) VALUES ('capsule-raw', 'r-raw', 'loom-1', 'raw_thinking should fail', 'ready', '1', '1')",
        )
        .execute(fixture.database.pool())
        .await
        .expect("insert unsafe capsule");

        let error = fixture
            .retriever()
            .retrieve(&fixture.input("raw thinking", None))
            .await
            .expect_err("raw thinking payload should fail");
        assert!(error.to_string().contains("forbidden key"));
    }

    fn strong_strategy() -> ExecutionStrategyDecision {
        ExecutionStrategyDecision {
            decision_id: "strategy-strong".to_string(),
            snapshot_id: None,
            model_id: None,
            requested_mode: "normal".to_string(),
            prompt_kind: "code".to_string(),
            context_size_tokens: 16_384,
            strategy: ExecutionStrategy::LongDirect,
            max_output_tokens: 8_000,
            max_parallelism: 2,
            allow_deep_synthesis: false,
            allow_parallel_drafts: true,
            reason: vec!["test_strong".to_string()],
            warnings: Vec::new(),
            created_at: "1".to_string(),
        }
    }

    fn weak_strategy() -> ExecutionStrategyDecision {
        ExecutionStrategyDecision {
            decision_id: "strategy-weak".to_string(),
            snapshot_id: None,
            model_id: None,
            requested_mode: "normal".to_string(),
            prompt_kind: "code".to_string(),
            context_size_tokens: 2_048,
            strategy: ExecutionStrategy::FallbackSafe,
            max_output_tokens: 1_024,
            max_parallelism: 1,
            allow_deep_synthesis: false,
            allow_parallel_drafts: false,
            reason: vec!["test_weak".to_string()],
            warnings: Vec::new(),
            created_at: "1".to_string(),
        }
    }

    struct TestSearchDoc {
        doc_id: String,
        source_kind: String,
        source_id: String,
        loom_id: Option<String>,
        response_id: Option<String>,
        attachment_id: Option<String>,
        title: Option<String>,
        body: String,
        tags: Option<String>,
        source_rank: f64,
        is_deleted: bool,
        metadata_json: Option<String>,
    }

    struct Fixture {
        database: crate::storage::db::Database,
    }

    impl Fixture {
        async fn new() -> Self {
            let database = test_database().await;
            let looms = LoomRepository::new(&database);
            looms
                .insert_loom(&NewLoom {
                    loom_id: "loom-1".to_string(),
                    title: "Context Loom".to_string(),
                    summary: None,
                    code: None,
                    canonical_uri: None,
                    kind: "loom".to_string(),
                    origin_loom_id: None,
                    origin_response_id: None,
                    created_at: "1".to_string(),
                    updated_at: "1".to_string(),
                    metadata_json: None,
                })
                .await
                .expect("insert Loom");
            looms
                .insert_loom(&NewLoom {
                    loom_id: "weft-1".to_string(),
                    title: "Weft".to_string(),
                    summary: None,
                    code: None,
                    canonical_uri: None,
                    kind: "weft".to_string(),
                    origin_loom_id: Some("loom-1".to_string()),
                    origin_response_id: Some("r-origin".to_string()),
                    created_at: "1".to_string(),
                    updated_at: "1".to_string(),
                    metadata_json: None,
                })
                .await
                .expect("insert Weft");
            Self { database }
        }

        fn retriever(&self) -> ContextRetriever {
            ContextRetriever::new(self.database.pool().clone())
        }

        async fn insert_response(
            &self,
            response_id: &str,
            role: &str,
            content: &str,
            sequence_index: i64,
            metadata_json: Option<String>,
        ) {
            ResponseRepository::new(&self.database)
                .insert_response(&NewResponse {
                    response_id: response_id.to_string(),
                    loom_id: "loom-1".to_string(),
                    role: role.to_string(),
                    content: content.to_string(),
                    title: None,
                    code: None,
                    canonical_uri: None,
                    created_at: sequence_index.to_string(),
                    updated_at: sequence_index.to_string(),
                    sequence_index,
                    metadata_json,
                })
                .await
                .expect("insert Response");
        }

        async fn code_block_id_for_response(&self, response_id: &str) -> String {
            sqlx::query_scalar::<_, String>(
                "SELECT code_block_id FROM response_code_blocks WHERE response_id = ?1 ORDER BY block_index LIMIT 1",
            )
            .bind(response_id)
            .fetch_one(self.database.pool())
            .await
            .expect("code block id")
        }

        async fn insert_capsule(
            &self,
            response_id: &str,
            title: &str,
            summary: &str,
            keywords: &[&str],
            code_blocks: &[&str],
        ) {
            ContextArtifactsRepository::new(&self.database)
                .upsert_response_capsule(&UpsertResponseCapsule {
                    capsule_id: format!("capsule-{response_id}"),
                    response_id: response_id.to_string(),
                    loom_id: "loom-1".to_string(),
                    response_code: None,
                    title: Some(title.to_string()),
                    summary: Some(summary.to_string()),
                    key_points_json: Some(serde_json::json!(["key point"]).to_string()),
                    keywords_json: Some(serde_json::json!(keywords).to_string()),
                    entities_json: Some(serde_json::json!(keywords).to_string()),
                    code_blocks_json: Some(serde_json::json!(code_blocks).to_string()),
                    canonical_uri: None,
                    source_hash: None,
                    generator: Some("test".to_string()),
                    status: "ready".to_string(),
                    created_at: "1".to_string(),
                    updated_at: "1".to_string(),
                })
                .await
                .expect("insert capsule");
        }

        async fn insert_weft_origin(&self) {
            ContextArtifactsRepository::new(&self.database)
                .upsert_weft_origin_context(&UpsertWeftOriginContext {
                    context_id: "weft-origin-1".to_string(),
                    weft_loom_id: "weft-1".to_string(),
                    origin_loom_id: "loom-1".to_string(),
                    origin_response_id: "r-origin".to_string(),
                    origin_capsule_id: Some("capsule-origin".to_string()),
                    origin_summary: Some(
                        "Hidden origin: Event Sourcing Replay with Event Store.".to_string(),
                    ),
                    source_hash: None,
                    status: "ready".to_string(),
                    created_at: "1".to_string(),
                    updated_at: "1".to_string(),
                })
                .await
                .expect("insert weft origin");
        }

        async fn insert_search_doc(&self, doc: TestSearchDoc) {
            sqlx::query(
                "INSERT INTO search_documents (
                    doc_id, source_kind, source_id, loom_id, response_id, attachment_id,
                    parse_artifact_id, title, body, tags, source_rank, is_deleted,
                    updated_at, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?10, ?11, '1', ?12)",
            )
            .bind(doc.doc_id)
            .bind(doc.source_kind)
            .bind(doc.source_id)
            .bind(doc.loom_id)
            .bind(doc.response_id)
            .bind(doc.attachment_id)
            .bind(doc.title)
            .bind(doc.body)
            .bind(doc.tags)
            .bind(doc.source_rank)
            .bind(if doc.is_deleted { 1 } else { 0 })
            .bind(doc.metadata_json)
            .execute(self.database.pool())
            .await
            .expect("insert search doc");
            sqlx::query(
                "INSERT INTO search_documents_fts(search_documents_fts) VALUES ('rebuild')",
            )
            .execute(self.database.pool())
            .await
            .expect("rebuild fts");
        }

        fn input(&self, prompt: &str, current_head_response_id: Option<&str>) -> BuildContextInput {
            BuildContextInput {
                loom_id: "loom-1".to_string(),
                current_head_response_id: current_head_response_id.map(str::to_string),
                user_prompt: prompt.to_string(),
                attached_references: Vec::new(),
                response_mode: ResponseMode::Auto,
                resolved_num_ctx: 8192,
                answer_plan: None,
                source: ContextSource::Composer,
                weft_origin: None,
                checkpoint: None,
                memory_messages: Vec::new(),
                recent_messages: Vec::new(),
            }
        }

        fn input_with_recent(
            &self,
            prompt: &str,
            current_head_response_id: Option<&str>,
        ) -> BuildContextInput {
            BuildContextInput {
                recent_messages: vec![
                    ContextMessage::new(
                        ContextMessageRole::User,
                        "Immediate previous question",
                        Some(ContextSourceKind::RecentTurn),
                        Some("r-prev-user".to_string()),
                    ),
                    ContextMessage::new(
                        ContextMessageRole::Assistant,
                        "Immediate previous answer",
                        Some(ContextSourceKind::RecentTurn),
                        Some("r-prev-assistant".to_string()),
                    ),
                ],
                ..self.input(prompt, current_head_response_id)
            }
        }

        fn reference(&self, response_id: &str) -> AttachedReferenceInput {
            AttachedReferenceInput {
                reference: ReferenceContext {
                    reference_id: format!("ref-{response_id}"),
                    target_kind: "response".to_string(),
                    target_id: Some(response_id.to_string()),
                    target_uri: None,
                    label: Some("Explicit Reference".to_string()),
                    selected_text: Some("Replay".to_string()),
                    capsule_summary: None,
                },
                response_capsule: None,
                attachment: None,
            }
        }

        fn attachment_reference(
            &self,
            attachment_id: &str,
            file_name: &str,
        ) -> AttachedReferenceInput {
            AttachedReferenceInput {
                reference: ReferenceContext {
                    reference_id: format!("ref-{attachment_id}"),
                    target_kind: "attachment".to_string(),
                    target_id: Some(attachment_id.to_string()),
                    target_uri: None,
                    label: Some(file_name.to_string()),
                    selected_text: None,
                    capsule_summary: None,
                },
                response_capsule: None,
                attachment: Some(AttachmentContext {
                    attachment_id: attachment_id.to_string(),
                    loom_id: "loom-1".to_string(),
                    file_name: file_name.to_string(),
                    mime_type: Some("text/markdown".to_string()),
                    kind: "file".to_string(),
                    parse_status: "ready".to_string(),
                    parser: Some("text_v1".to_string()),
                    content_text: Some("Blue Otter attachment plan".to_string()),
                    content_kind: Some("text".to_string()),
                    char_count: Some(27),
                }),
            }
        }
    }
}
