use crate::capabilities::{
    community::{CommunityBenchmarkRecord, CommunityBenchmarkSystem},
    estimate::{estimate_model_compatibility, CompatibilityEstimate},
    models::ModelCatalogEntry,
    repository::ModelRuntimeBenchmarkRecord,
    resources::SystemResourceSnapshot,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const GIB: i64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStrategy {
    ShortDirect,
    NormalDirect,
    LongDirect,
    LongAutoContinue,
    SectionedSequential,
    Parallel2DraftSynthesize,
    Parallel3DraftSynthesize,
    DeepSynthesis,
    FallbackSafe,
}

impl ExecutionStrategy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ShortDirect => "short_direct",
            Self::NormalDirect => "normal_direct",
            Self::LongDirect => "long_direct",
            Self::LongAutoContinue => "long_auto_continue",
            Self::SectionedSequential => "sectioned_sequential",
            Self::Parallel2DraftSynthesize => "parallel_2_draft_synthesize",
            Self::Parallel3DraftSynthesize => "parallel_3_draft_synthesize",
            Self::DeepSynthesis => "deep_synthesis",
            Self::FallbackSafe => "fallback_safe",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestedMode {
    Quick,
    Normal,
    Long,
    Deep,
    Document,
}

impl Default for RequestedMode {
    fn default() -> Self {
        Self::Normal
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptKind {
    Factual,
    Explanation,
    LongForm,
    Code,
    Synthesis,
    Document,
}

impl Default for PromptKind {
    fn default() -> Self {
        Self::Explanation
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveExecutionStrategyInput {
    pub model_id: Option<String>,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    #[serde(default)]
    pub requested_mode: RequestedMode,
    #[serde(default)]
    pub prompt_kind: PromptKind,
    #[serde(default)]
    pub context_size_tokens: i64,
    #[serde(default)]
    pub reference_count: i64,
    pub user_requested_parallelism: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionStrategyDecision {
    pub decision_id: String,
    pub snapshot_id: Option<String>,
    pub model_id: Option<String>,
    pub requested_mode: String,
    pub prompt_kind: String,
    pub context_size_tokens: i64,
    pub strategy: ExecutionStrategy,
    pub max_output_tokens: i64,
    pub max_parallelism: i64,
    pub allow_deep_synthesis: bool,
    pub allow_parallel_drafts: bool,
    pub reason: Vec<String>,
    pub warnings: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityCapabilitySignal {
    pub matched_entry_count: usize,
    pub strongest_confidence: Option<String>,
    pub recommended_max_parallelism: i64,
    pub recommended_strategy: Option<ExecutionStrategy>,
    pub estimated_latency_bucket: Option<String>,
    pub warnings: Vec<String>,
    pub source_entry_ids: Vec<String>,
}

pub fn resolve_execution_strategy(
    input: &ResolveExecutionStrategyInput,
    snapshot: Option<&SystemResourceSnapshot>,
    model: Option<&ModelCatalogEntry>,
    benchmark: Option<&ModelRuntimeBenchmarkRecord>,
) -> ExecutionStrategyDecision {
    resolve_execution_strategy_with_community(input, snapshot, model, benchmark, None)
}

pub fn resolve_execution_strategy_with_community(
    input: &ResolveExecutionStrategyInput,
    snapshot: Option<&SystemResourceSnapshot>,
    model: Option<&ModelCatalogEntry>,
    benchmark: Option<&ModelRuntimeBenchmarkRecord>,
    community: Option<&CommunityBenchmarkRecord>,
) -> ExecutionStrategyDecision {
    let entries = community
        .map(|record| vec![record.clone()])
        .unwrap_or_default();
    resolve_execution_strategy_with_community_entries(input, snapshot, model, benchmark, &entries)
}

pub fn resolve_execution_strategy_with_community_entries(
    input: &ResolveExecutionStrategyInput,
    snapshot: Option<&SystemResourceSnapshot>,
    model: Option<&ModelCatalogEntry>,
    benchmark: Option<&ModelRuntimeBenchmarkRecord>,
    community_entries: &[CommunityBenchmarkRecord],
) -> ExecutionStrategyDecision {
    let now = crate::capabilities::repository::timestamp();
    let mut reason = Vec::new();
    let mut warnings = Vec::new();

    if input.requested_mode == RequestedMode::Quick {
        reason.push(
            "Quick Ask is always fast, single-pass, no-parallel, and no deep synthesis."
                .to_string(),
        );
        return ExecutionStrategyDecision {
            decision_id: crate::capabilities::repository::new_id("strategy"),
            snapshot_id: snapshot.map(|value| value.snapshot_id.clone()),
            model_id: model
                .map(|value| value.model_id.clone())
                .or_else(|| input.model_id.clone()),
            requested_mode: requested_mode_name(&input.requested_mode).to_string(),
            prompt_kind: prompt_kind_name(&input.prompt_kind).to_string(),
            context_size_tokens: input.context_size_tokens,
            strategy: ExecutionStrategy::ShortDirect,
            max_output_tokens: 768,
            max_parallelism: 1,
            allow_deep_synthesis: false,
            allow_parallel_drafts: false,
            reason,
            warnings,
            created_at: now,
        };
    }

    let Some(snapshot) = snapshot else {
        warnings.push("No system resource snapshot is available.".to_string());
        return decision(
            input,
            None,
            model,
            ExecutionStrategy::FallbackSafe,
            2048,
            1,
            false,
            false,
            reason,
            warnings,
            now,
        );
    };

    if input.requested_mode == RequestedMode::Normal && input.prompt_kind == PromptKind::Factual {
        reason.push("Normal factual prompts use a modest single-pass strategy.".to_string());
        return decision(
            input,
            Some(snapshot),
            model,
            ExecutionStrategy::NormalDirect,
            2048,
            1,
            false,
            false,
            reason,
            warnings,
            now,
        );
    }

    let capability = classify_capability(snapshot, model, benchmark, &mut reason, &mut warnings);
    let mut requested_parallelism = input.user_requested_parallelism.unwrap_or(i64::MAX);
    if requested_parallelism < 1 {
        requested_parallelism = 1;
    }

    let mut strategy = match capability {
        CapabilityClass::Low => {
            if is_long_request(input) {
                ExecutionStrategy::LongAutoContinue
            } else {
                ExecutionStrategy::NormalDirect
            }
        }
        CapabilityClass::Medium => {
            if matches!(
                input.requested_mode,
                RequestedMode::Long | RequestedMode::Document
            ) || matches!(
                input.prompt_kind,
                PromptKind::LongForm | PromptKind::Document
            ) {
                ExecutionStrategy::SectionedSequential
            } else {
                ExecutionStrategy::LongDirect
            }
        }
        CapabilityClass::High => {
            if is_deep_request(input) {
                ExecutionStrategy::Parallel2DraftSynthesize
            } else if is_long_request(input) || input.reference_count > 1 {
                ExecutionStrategy::SectionedSequential
            } else {
                ExecutionStrategy::LongDirect
            }
        }
        CapabilityClass::VeryHigh => {
            if is_deep_request(input) && requested_parallelism >= 3 {
                ExecutionStrategy::Parallel3DraftSynthesize
            } else if is_deep_request(input) {
                ExecutionStrategy::Parallel2DraftSynthesize
            } else if is_long_request(input) {
                ExecutionStrategy::SectionedSequential
            } else {
                ExecutionStrategy::LongDirect
            }
        }
    };

    let community_signal = community_capability_signal(input, snapshot, community_entries);
    let estimate_input = input.into();
    let compatibility_estimate = estimate_model_compatibility(
        &estimate_input,
        Some(snapshot),
        model,
        benchmark,
        community_entries,
    );
    record_compatibility_estimate(&compatibility_estimate, &mut reason);
    if benchmark.is_none() {
        apply_community_signal(
            input,
            community_signal.as_ref(),
            capability,
            requested_parallelism,
            &mut strategy,
            &mut reason,
            &mut warnings,
        );
        if community_signal.is_none() {
            apply_compatibility_estimate(
                &compatibility_estimate,
                &mut strategy,
                &mut reason,
                &mut warnings,
            );
        } else {
            reason.push("community_catalog_remains_above_estimate".to_string());
        }
    } else if let Some(signal) = community_signal.as_ref() {
        reason.push(
            serde_json::json!({
                "source": "community_catalog",
                "ignoredBecause": "local_benchmark_available",
                "matchedEntryCount": signal.matched_entry_count,
                "sourceEntryIds": signal.source_entry_ids,
            })
            .to_string(),
        );
        reason.push("local_benchmark_overrides_estimate".to_string());
    } else {
        reason.push("local_benchmark_overrides_estimate".to_string());
    }

    let latency_bucket = benchmark.map(classify_benchmark_latency);
    if let Some(benchmark) = benchmark {
        apply_local_benchmark_tuning(
            input,
            benchmark,
            latency_bucket.unwrap_or(LatencyBucket::Failed),
            capability,
            requested_parallelism,
            &mut strategy,
            &mut reason,
            &mut warnings,
        );
    }

    let max_parallelism = match strategy {
        ExecutionStrategy::Parallel3DraftSynthesize => 3.min(requested_parallelism),
        ExecutionStrategy::Parallel2DraftSynthesize => 2.min(requested_parallelism),
        _ => 1,
    };
    let allow_parallel_drafts = max_parallelism > 1;
    let allow_deep_synthesis = matches!(
        strategy,
        ExecutionStrategy::Parallel2DraftSynthesize
            | ExecutionStrategy::Parallel3DraftSynthesize
            | ExecutionStrategy::DeepSynthesis
    ) && is_deep_request(input);
    let mut max_output_tokens = match capability {
        CapabilityClass::Low => {
            if is_long_request(input) {
                4096
            } else {
                2048
            }
        }
        CapabilityClass::Medium => 8192,
        CapabilityClass::High | CapabilityClass::VeryHigh => 16384,
    };
    if let Some(latency_bucket) = latency_bucket {
        match latency_bucket {
            LatencyBucket::Slow => {
                max_output_tokens = max_output_tokens.min(8192);
            }
            LatencyBucket::VerySlow | LatencyBucket::Failed => {
                max_output_tokens = max_output_tokens.min(4096);
            }
            LatencyBucket::Fast | LatencyBucket::Acceptable => {}
        }
    }

    decision(
        input,
        Some(snapshot),
        model,
        strategy,
        max_output_tokens,
        max_parallelism,
        allow_deep_synthesis,
        allow_parallel_drafts,
        reason,
        warnings,
        now,
    )
}

fn record_compatibility_estimate(estimate: &CompatibilityEstimate, reason: &mut Vec<String>) {
    reason.push(
        serde_json::json!({
            "source": "estimate",
            "compatibility_estimate_used": true,
            "grade": estimate.grade,
            "memoryFit": estimate.memory_fit,
            "speedEstimate": estimate.speed_estimate,
            "recommendedMaxContext": estimate.recommended_max_context,
            "recommendedMaxOutput": estimate.recommended_max_output,
            "recommendedParallelism": estimate.recommended_parallelism,
            "allowDeepSynthesis": estimate.allow_deep_synthesis,
            "confidence": estimate.confidence,
            "warnings": estimate.warnings,
            "reasons": estimate.reasons,
        })
        .to_string(),
    );
}

fn apply_compatibility_estimate(
    estimate: &CompatibilityEstimate,
    strategy: &mut ExecutionStrategy,
    reason: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    reason.push("compatibility_estimate_used".to_string());
    if estimate
        .reasons
        .iter()
        .any(|item| item == "compatibility_estimate_low_confidence")
    {
        reason.push("compatibility_estimate_low_confidence".to_string());
    }
    if estimate.recommended_parallelism < 3
        && matches!(
            strategy,
            ExecutionStrategy::Parallel3DraftSynthesize | ExecutionStrategy::DeepSynthesis
        )
    {
        *strategy = ExecutionStrategy::Parallel2DraftSynthesize;
        warnings.push("compatibility_estimate_prevented_parallel_3".to_string());
    }
    if !estimate.allow_deep_synthesis && matches!(strategy, ExecutionStrategy::DeepSynthesis) {
        *strategy = ExecutionStrategy::Parallel2DraftSynthesize;
        warnings.push("compatibility_estimate_prevented_deep_synthesis".to_string());
    }
}

pub fn community_capability_signal(
    input: &ResolveExecutionStrategyInput,
    snapshot: &SystemResourceSnapshot,
    records: &[CommunityBenchmarkRecord],
) -> Option<CommunityCapabilitySignal> {
    let provider = input.provider.as_deref();
    let model_name = input.model_name.as_deref();
    let prompt_kind = prompt_kind_name(&input.prompt_kind);
    let mut candidates: Vec<_> = records
        .iter()
        .filter(|record| {
            provider.map_or(true, |provider| provider == record.provider)
                && model_name.map_or(true, |model_name| model_name == record.model_name)
                && record.prompt_kind == prompt_kind
        })
        .collect();
    if candidates.is_empty() {
        return None;
    }

    candidates.sort_by(|left, right| {
        community_match_score(right, snapshot)
            .cmp(&community_match_score(left, snapshot))
            .then_with(|| {
                confidence_rank(&right.confidence).cmp(&confidence_rank(&left.confidence))
            })
            .then_with(|| right.submitted_at.cmp(&left.submitted_at))
            .then_with(|| left.entry_id.cmp(&right.entry_id))
    });

    let strongest_confidence = candidates
        .iter()
        .map(|record| record.confidence.as_str())
        .max_by_key(|confidence| confidence_rank(confidence))
        .map(str::to_string);
    let mut warnings = Vec::new();
    if !candidates.iter().any(|record| {
        record.os_name == snapshot.os_name && Some(record.arch.as_str()) == snapshot.arch.as_deref()
    }) {
        warnings.push("community_no_close_system_match".to_string());
    }
    if candidates
        .iter()
        .all(|record| record.confidence.as_str() == "low")
    {
        warnings.push("community_low_confidence_only".to_string());
    }

    let successful: Vec<_> = candidates
        .iter()
        .copied()
        .filter(|record| record.success)
        .collect();
    let failed: Vec<_> = candidates
        .iter()
        .copied()
        .filter(|record| !record.success)
        .collect();
    let mut conflict_detected = !failed.is_empty() && !successful.is_empty();
    let mut successful_ranks = BTreeSet::new();
    for record in &successful {
        if let Some(strategy) = strategy_from_name(&record.strategy) {
            successful_ranks.insert(community_parallelism_rank(strategy, record.parallelism));
        }
    }
    if successful_ranks.len() > 1 {
        conflict_detected = true;
    }
    if conflict_detected {
        warnings.push("community_conflict_detected".to_string());
    }

    let mut recommended_max_parallelism = 1;
    let mut recommended_strategy = None;
    for record in &successful {
        let confidence = confidence_rank(&record.confidence);
        let Some(strategy) = strategy_from_name(&record.strategy) else {
            continue;
        };
        let strategy_rank = community_parallelism_rank(strategy, record.parallelism);
        let allowed_by_confidence = match confidence {
            3 => strategy_rank,
            2 => strategy_rank.min(2),
            _ => 1,
        };
        if allowed_by_confidence > recommended_max_parallelism {
            recommended_max_parallelism = allowed_by_confidence;
            recommended_strategy = Some(strategy_for_parallelism(allowed_by_confidence, strategy));
        } else if recommended_strategy.is_none() && allowed_by_confidence == 1 {
            recommended_strategy = Some(strategy_for_parallelism(1, strategy));
        }
    }

    let failure_cap = failed
        .iter()
        .filter_map(|record| strategy_from_name(&record.strategy).map(strategy_parallelism_rank))
        .chain(failed.iter().map(|record| record.parallelism.min(3)))
        .min();
    if let Some(failure_cap) = failure_cap {
        let downgraded = (failure_cap - 1).max(1);
        if recommended_max_parallelism > downgraded {
            recommended_max_parallelism = downgraded;
            recommended_strategy = recommended_strategy
                .map(|strategy| strategy_for_parallelism(recommended_max_parallelism, strategy));
            warnings.push("community_parallelism_downgraded".to_string());
        }
    }

    let estimated_latency_bucket = latency_bucket(&successful);
    let source_entry_ids = candidates
        .iter()
        .take(8)
        .map(|record| record.entry_id.clone())
        .collect();

    Some(CommunityCapabilitySignal {
        matched_entry_count: candidates.len(),
        strongest_confidence,
        recommended_max_parallelism,
        recommended_strategy,
        estimated_latency_bucket,
        warnings,
        source_entry_ids,
    })
}

fn community_match_score(
    record: &CommunityBenchmarkRecord,
    snapshot: &SystemResourceSnapshot,
) -> i64 {
    let mut score = 0;
    if record.os_name == snapshot.os_name {
        score += 40;
    }
    if Some(record.arch.as_str()) == snapshot.arch.as_deref() {
        score += 30;
    }
    if let Some(system) = community_system(record) {
        if similar_memory(system.total_memory_bytes, snapshot.total_memory_bytes) {
            score += 20;
        }
        if similar_cores(system.logical_cores, snapshot.logical_cores) {
            score += 10;
        }
    }
    score
}

fn community_system(record: &CommunityBenchmarkRecord) -> Option<CommunityBenchmarkSystem> {
    serde_json::from_str(&record.system_json).ok()
}

fn similar_memory(left: Option<i64>, right: Option<i64>) -> bool {
    let (Some(left), Some(right)) = (left, right) else {
        return false;
    };
    if left <= 0 || right <= 0 {
        return false;
    }
    let lower = left.min(right) as f64;
    let upper = left.max(right) as f64;
    lower / upper >= 0.65
}

fn similar_cores(left: Option<i64>, right: Option<i64>) -> bool {
    let (Some(left), Some(right)) = (left, right) else {
        return false;
    };
    (left - right).abs() <= 2
}

fn strategy_parallelism_rank(strategy: ExecutionStrategy) -> i64 {
    match strategy {
        ExecutionStrategy::Parallel3DraftSynthesize | ExecutionStrategy::DeepSynthesis => 3,
        ExecutionStrategy::Parallel2DraftSynthesize => 2,
        _ => 1,
    }
}

fn community_parallelism_rank(strategy: ExecutionStrategy, reported_parallelism: i64) -> i64 {
    let strategy_rank = strategy_parallelism_rank(strategy);
    if strategy_rank > 1 {
        strategy_rank.max(reported_parallelism.min(3))
    } else {
        strategy_rank
    }
}

fn strategy_for_parallelism(
    max_parallelism: i64,
    original: ExecutionStrategy,
) -> ExecutionStrategy {
    match max_parallelism {
        parallelism if parallelism >= 3 => {
            if matches!(original, ExecutionStrategy::DeepSynthesis) {
                ExecutionStrategy::DeepSynthesis
            } else {
                ExecutionStrategy::Parallel3DraftSynthesize
            }
        }
        2 => ExecutionStrategy::Parallel2DraftSynthesize,
        _ => {
            if matches!(
                original,
                ExecutionStrategy::SectionedSequential
                    | ExecutionStrategy::Parallel2DraftSynthesize
                    | ExecutionStrategy::Parallel3DraftSynthesize
                    | ExecutionStrategy::DeepSynthesis
            ) {
                ExecutionStrategy::SectionedSequential
            } else {
                original
            }
        }
    }
}

fn latency_bucket(records: &[&CommunityBenchmarkRecord]) -> Option<String> {
    let mut latencies: Vec<i64> = records
        .iter()
        .filter_map(|record| {
            serde_json::from_str::<serde_json::Value>(&record.benchmark_json)
                .ok()
                .and_then(|value| {
                    value
                        .get("totalLatencyMs")
                        .and_then(|latency| latency.as_i64())
                })
        })
        .collect();
    if latencies.is_empty() {
        return None;
    }
    latencies.sort_unstable();
    let median = latencies[latencies.len() / 2];
    Some(
        if median <= 30_000 {
            "fast"
        } else if median <= 90_000 {
            "moderate"
        } else {
            "slow"
        }
        .to_string(),
    )
}

fn apply_community_signal(
    input: &ResolveExecutionStrategyInput,
    signal: Option<&CommunityCapabilitySignal>,
    capability: CapabilityClass,
    requested_parallelism: i64,
    strategy: &mut ExecutionStrategy,
    reason: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    let Some(signal) = signal else {
        return;
    };

    reason.push(
        serde_json::json!({
            "source": "community_catalog",
            "matchedEntryCount": signal.matched_entry_count,
            "strongestConfidence": signal.strongest_confidence,
            "recommendedMaxParallelism": signal.recommended_max_parallelism,
            "recommendedStrategy": signal.recommended_strategy.map(ExecutionStrategy::as_str),
            "estimatedLatencyBucket": signal.estimated_latency_bucket,
            "sourceEntryIds": signal.source_entry_ids,
        })
        .to_string(),
    );
    warnings.extend(signal.warnings.clone());

    let Some(baseline_strategy) = signal.recommended_strategy else {
        warnings.push("Community baseline had no successful strategy hint.".to_string());
        return;
    };

    if signal
        .warnings
        .iter()
        .any(|warning| warning == "community_parallelism_downgraded")
        && strategy_parallelism_rank(*strategy) > signal.recommended_max_parallelism
    {
        *strategy = strategy_for_parallelism(signal.recommended_max_parallelism, *strategy);
    }

    match signal.strongest_confidence.as_deref() {
        Some("high") => apply_high_confidence_baseline(
            input,
            baseline_strategy,
            signal.recommended_max_parallelism,
            capability,
            requested_parallelism,
            strategy,
        ),
        Some("medium") => {
            apply_medium_confidence_baseline(input, baseline_strategy, capability, strategy)
        }
        _ => {
            reason
                .push("Low-confidence community signal recorded as a weak hint only.".to_string());
        }
    }
}

fn apply_high_confidence_baseline(
    input: &ResolveExecutionStrategyInput,
    baseline_strategy: ExecutionStrategy,
    baseline_parallelism: i64,
    capability: CapabilityClass,
    requested_parallelism: i64,
    strategy: &mut ExecutionStrategy,
) {
    if !is_long_request(input) {
        return;
    }

    match baseline_strategy {
        ExecutionStrategy::SectionedSequential => {
            if capability >= CapabilityClass::Medium
                && matches!(
                    strategy,
                    ExecutionStrategy::LongDirect | ExecutionStrategy::LongAutoContinue
                )
            {
                *strategy = ExecutionStrategy::SectionedSequential;
            }
        }
        ExecutionStrategy::Parallel2DraftSynthesize => {
            if is_deep_request(input)
                && capability >= CapabilityClass::High
                && requested_parallelism >= 2
                && baseline_parallelism >= 2
            {
                *strategy = ExecutionStrategy::Parallel2DraftSynthesize;
            } else if capability >= CapabilityClass::Medium
                && matches!(
                    strategy,
                    ExecutionStrategy::LongDirect | ExecutionStrategy::LongAutoContinue
                )
            {
                *strategy = ExecutionStrategy::SectionedSequential;
            }
        }
        ExecutionStrategy::Parallel3DraftSynthesize | ExecutionStrategy::DeepSynthesis => {
            if is_deep_request(input)
                && capability >= CapabilityClass::VeryHigh
                && requested_parallelism >= 3
                && baseline_parallelism >= 3
            {
                *strategy = ExecutionStrategy::Parallel3DraftSynthesize;
            }
        }
        _ => {}
    }
}

fn apply_medium_confidence_baseline(
    input: &ResolveExecutionStrategyInput,
    baseline_strategy: ExecutionStrategy,
    capability: CapabilityClass,
    strategy: &mut ExecutionStrategy,
) {
    if !is_long_request(input) || capability < CapabilityClass::Medium {
        return;
    }

    if matches!(
        baseline_strategy,
        ExecutionStrategy::SectionedSequential
            | ExecutionStrategy::Parallel2DraftSynthesize
            | ExecutionStrategy::Parallel3DraftSynthesize
            | ExecutionStrategy::DeepSynthesis
    ) && matches!(
        strategy,
        ExecutionStrategy::LongDirect | ExecutionStrategy::LongAutoContinue
    ) {
        *strategy = ExecutionStrategy::SectionedSequential;
    }
}

fn strategy_from_name(value: &str) -> Option<ExecutionStrategy> {
    Some(match value {
        "short_direct" => ExecutionStrategy::ShortDirect,
        "normal_direct" => ExecutionStrategy::NormalDirect,
        "long_direct" => ExecutionStrategy::LongDirect,
        "long_auto_continue" => ExecutionStrategy::LongAutoContinue,
        "sectioned_sequential" => ExecutionStrategy::SectionedSequential,
        "parallel_2_draft_synthesize" => ExecutionStrategy::Parallel2DraftSynthesize,
        "parallel_3_draft_synthesize" => ExecutionStrategy::Parallel3DraftSynthesize,
        "deep_synthesis" => ExecutionStrategy::DeepSynthesis,
        "fallback_safe" => ExecutionStrategy::FallbackSafe,
        _ => return None,
    })
}

fn confidence_rank(value: &str) -> i64 {
    match value {
        "high" => 3,
        "medium" => 2,
        _ => 1,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CapabilityClass {
    Low,
    Medium,
    High,
    VeryHigh,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LatencyBucket {
    Fast,
    Acceptable,
    Slow,
    VerySlow,
    Failed,
}

fn apply_local_benchmark_tuning(
    input: &ResolveExecutionStrategyInput,
    benchmark: &ModelRuntimeBenchmarkRecord,
    latency: LatencyBucket,
    capability: CapabilityClass,
    requested_parallelism: i64,
    strategy: &mut ExecutionStrategy,
    reason: &mut Vec<String>,
    warnings: &mut Vec<String>,
) {
    if !benchmark.success {
        warnings.push("local_benchmark_failed".to_string());
        if is_deep_synthesis_eval_benchmark(benchmark) {
            warnings.push("deep_synthesis_eval_failed".to_string());
        }
        downgrade_for_failed_benchmark(
            benchmark,
            capability,
            requested_parallelism,
            strategy,
            warnings,
        );
        return;
    }

    if is_deep_synthesis_eval_benchmark(benchmark) {
        reason.push("deep_synthesis_eval_success".to_string());
    }

    match latency {
        LatencyBucket::Fast => {
            reason.push("local_benchmark_fast".to_string());
            if is_deep_request(input)
                && capability >= CapabilityClass::High
                && requested_parallelism >= 2
                && benchmark.parallelism >= 2
                && benchmark_strategy(benchmark)
                    .is_some_and(|strategy| strategy_parallelism_rank(strategy) >= 2)
            {
                *strategy = if requested_parallelism >= 3
                    && capability >= CapabilityClass::VeryHigh
                    && benchmark.parallelism >= 3
                {
                    ExecutionStrategy::Parallel3DraftSynthesize
                } else {
                    ExecutionStrategy::Parallel2DraftSynthesize
                };
            }
        }
        LatencyBucket::Acceptable => {
            reason.push("local_benchmark_acceptable".to_string());
            if is_deep_request(input)
                && capability >= CapabilityClass::High
                && requested_parallelism >= 2
                && benchmark.parallelism >= 2
                && matches!(
                    benchmark_strategy(benchmark),
                    Some(ExecutionStrategy::Parallel2DraftSynthesize)
                        | Some(ExecutionStrategy::DeepSynthesis)
                )
            {
                *strategy = ExecutionStrategy::Parallel2DraftSynthesize;
            }
        }
        LatencyBucket::Slow => {
            warnings.push("local_benchmark_slow".to_string());
            downgrade_slow_parallel_strategy(strategy, warnings);
        }
        LatencyBucket::VerySlow => {
            warnings.push("local_benchmark_slow".to_string());
            warnings.push("local_benchmark_very_slow".to_string());
            *strategy = if is_long_request(input) {
                ExecutionStrategy::LongAutoContinue
            } else {
                ExecutionStrategy::NormalDirect
            };
            warnings.push("parallelism_downgraded".to_string());
        }
        LatencyBucket::Failed => {
            warnings.push("local_benchmark_failed".to_string());
            downgrade_for_failed_benchmark(
                benchmark,
                capability,
                requested_parallelism,
                strategy,
                warnings,
            );
        }
    }
}

fn downgrade_for_failed_benchmark(
    benchmark: &ModelRuntimeBenchmarkRecord,
    capability: CapabilityClass,
    requested_parallelism: i64,
    strategy: &mut ExecutionStrategy,
    warnings: &mut Vec<String>,
) {
    match benchmark_strategy(benchmark).unwrap_or(*strategy) {
        ExecutionStrategy::Parallel3DraftSynthesize | ExecutionStrategy::DeepSynthesis => {
            *strategy = if capability >= CapabilityClass::High && requested_parallelism >= 2 {
                ExecutionStrategy::Parallel2DraftSynthesize
            } else {
                ExecutionStrategy::SectionedSequential
            };
            warnings.push("parallel_3_downgraded".to_string());
            warnings.push("parallelism_downgraded".to_string());
        }
        ExecutionStrategy::Parallel2DraftSynthesize => {
            *strategy = ExecutionStrategy::SectionedSequential;
            warnings.push("parallel_2_downgraded".to_string());
            warnings.push("parallelism_downgraded".to_string());
        }
        ExecutionStrategy::SectionedSequential => {
            *strategy = ExecutionStrategy::LongAutoContinue;
            warnings.push("sectioned_sequential_downgraded".to_string());
        }
        _ => {
            if matches!(
                *strategy,
                ExecutionStrategy::Parallel2DraftSynthesize
                    | ExecutionStrategy::Parallel3DraftSynthesize
                    | ExecutionStrategy::DeepSynthesis
            ) {
                *strategy = ExecutionStrategy::SectionedSequential;
                warnings.push("parallelism_downgraded".to_string());
            }
        }
    }
}

fn downgrade_slow_parallel_strategy(strategy: &mut ExecutionStrategy, warnings: &mut Vec<String>) {
    match strategy {
        ExecutionStrategy::Parallel3DraftSynthesize | ExecutionStrategy::DeepSynthesis => {
            *strategy = ExecutionStrategy::Parallel2DraftSynthesize;
            warnings.push("parallel_3_downgraded".to_string());
            warnings.push("parallelism_downgraded".to_string());
        }
        ExecutionStrategy::Parallel2DraftSynthesize => {
            *strategy = ExecutionStrategy::SectionedSequential;
            warnings.push("parallel_2_downgraded".to_string());
            warnings.push("parallelism_downgraded".to_string());
        }
        _ => {}
    }
}

fn classify_benchmark_latency(benchmark: &ModelRuntimeBenchmarkRecord) -> LatencyBucket {
    if !benchmark.success {
        return LatencyBucket::Failed;
    }
    if benchmark.tokens_per_second.is_some_and(|value| value < 4.0)
        || benchmark
            .total_latency_ms
            .is_some_and(|value| value > 180_000)
        || benchmark
            .first_token_latency_ms
            .is_some_and(|value| value > 45_000)
    {
        return LatencyBucket::VerySlow;
    }
    if benchmark.tokens_per_second.is_some_and(|value| value < 8.0)
        || benchmark
            .total_latency_ms
            .is_some_and(|value| value > 90_000)
        || benchmark
            .first_token_latency_ms
            .is_some_and(|value| value > 30_000)
    {
        return LatencyBucket::Slow;
    }
    if benchmark
        .tokens_per_second
        .is_some_and(|value| value >= 25.0)
        || benchmark
            .total_latency_ms
            .is_some_and(|value| value <= 30_000)
        || benchmark
            .first_token_latency_ms
            .is_some_and(|value| value <= 5_000)
    {
        return LatencyBucket::Fast;
    }
    LatencyBucket::Acceptable
}

fn is_deep_synthesis_eval_benchmark(benchmark: &ModelRuntimeBenchmarkRecord) -> bool {
    benchmark.prompt_kind.starts_with("deep_synthesis")
}

fn benchmark_strategy(benchmark: &ModelRuntimeBenchmarkRecord) -> Option<ExecutionStrategy> {
    benchmark
        .prompt_kind
        .strip_prefix("deep_synthesis:")
        .and_then(strategy_from_name)
}

fn classify_capability(
    snapshot: &SystemResourceSnapshot,
    model: Option<&ModelCatalogEntry>,
    benchmark: Option<&ModelRuntimeBenchmarkRecord>,
    reason: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> CapabilityClass {
    let memory = snapshot.total_memory_bytes.unwrap_or_default();
    let logical_cores = snapshot.logical_cores.unwrap_or_default();
    let mut class = if memory >= 64 * GIB && logical_cores >= 12 {
        CapabilityClass::VeryHigh
    } else if memory >= 32 * GIB && logical_cores >= 8 {
        CapabilityClass::High
    } else if memory >= 16 * GIB && logical_cores >= 6 {
        CapabilityClass::Medium
    } else {
        CapabilityClass::Low
    };

    if let Some(model) = model {
        if model.source == "provider_discovery" && benchmark.is_none() {
            reason.push(
                "provider_discovery_available_but_low_priority_without_benchmark".to_string(),
            );
            warnings.push("provider_discovery_is_availability_hint_only".to_string());
            class = class.min(CapabilityClass::Low);
        }
        if let (Some(total), Some(recommended)) =
            (snapshot.total_memory_bytes, model.recommended_memory_bytes)
        {
            if total < recommended {
                reason.push("System memory is below the model recommended memory.".to_string());
                class = CapabilityClass::Low;
            }
        }
    } else {
        warnings.push("Selected model is not in the catalog.".to_string());
    }

    if let Some(benchmark) = benchmark {
        if benchmark.success {
            if let Some(tokens_per_second) = benchmark.tokens_per_second {
                if tokens_per_second >= 45.0 && memory >= 32 * GIB {
                    class = CapabilityClass::VeryHigh;
                    reason.push("local_benchmark_fast".to_string());
                } else if tokens_per_second >= 25.0 && memory >= 24 * GIB {
                    class = class.max(CapabilityClass::High);
                    reason.push("local_benchmark_fast".to_string());
                } else if tokens_per_second < 8.0 {
                    class = CapabilityClass::Low;
                    reason.push("local_benchmark_slow".to_string());
                }
            }
        } else {
            warnings.push("local_benchmark_failed".to_string());
            if is_deep_synthesis_eval_benchmark(benchmark) {
                warnings.push("deep_synthesis_eval_failed".to_string());
            }
            class = CapabilityClass::Low;
        }
    } else {
        reason.push(
            "No successful benchmark is available; resolver uses hardware profile.".to_string(),
        );
    }

    reason.push(format!(
        "Capability class: {}.",
        match class {
            CapabilityClass::Low => "low",
            CapabilityClass::Medium => "medium",
            CapabilityClass::High => "high",
            CapabilityClass::VeryHigh => "very_high",
        }
    ));

    class
}

impl PartialOrd for CapabilityClass {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for CapabilityClass {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (*self as u8).cmp(&(*other as u8))
    }
}

fn decision(
    input: &ResolveExecutionStrategyInput,
    snapshot: Option<&SystemResourceSnapshot>,
    model: Option<&ModelCatalogEntry>,
    strategy: ExecutionStrategy,
    max_output_tokens: i64,
    max_parallelism: i64,
    allow_deep_synthesis: bool,
    allow_parallel_drafts: bool,
    reason: Vec<String>,
    warnings: Vec<String>,
    created_at: String,
) -> ExecutionStrategyDecision {
    ExecutionStrategyDecision {
        decision_id: crate::capabilities::repository::new_id("strategy"),
        snapshot_id: snapshot.map(|value| value.snapshot_id.clone()),
        model_id: model
            .map(|value| value.model_id.clone())
            .or_else(|| input.model_id.clone()),
        requested_mode: requested_mode_name(&input.requested_mode).to_string(),
        prompt_kind: prompt_kind_name(&input.prompt_kind).to_string(),
        context_size_tokens: input.context_size_tokens,
        strategy,
        max_output_tokens,
        max_parallelism,
        allow_deep_synthesis,
        allow_parallel_drafts,
        reason,
        warnings,
        created_at,
    }
}

fn is_long_request(input: &ResolveExecutionStrategyInput) -> bool {
    matches!(
        input.requested_mode,
        RequestedMode::Long | RequestedMode::Deep | RequestedMode::Document
    ) || matches!(
        input.prompt_kind,
        PromptKind::LongForm | PromptKind::Synthesis | PromptKind::Document
    ) || input.context_size_tokens > 6000
}

fn is_deep_request(input: &ResolveExecutionStrategyInput) -> bool {
    matches!(
        input.requested_mode,
        RequestedMode::Deep | RequestedMode::Document
    ) || matches!(input.prompt_kind, PromptKind::Document)
}

pub fn requested_mode_name(mode: &RequestedMode) -> &'static str {
    match mode {
        RequestedMode::Quick => "quick",
        RequestedMode::Normal => "normal",
        RequestedMode::Long => "long",
        RequestedMode::Deep => "deep",
        RequestedMode::Document => "document",
    }
}

pub fn prompt_kind_name(kind: &PromptKind) -> &'static str {
    match kind {
        PromptKind::Factual => "factual",
        PromptKind::Explanation => "explanation",
        PromptKind::LongForm => "long_form",
        PromptKind::Code => "code",
        PromptKind::Synthesis => "synthesis",
        PromptKind::Document => "document",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(memory_gib: i64, cores: i64) -> SystemResourceSnapshot {
        SystemResourceSnapshot {
            snapshot_id: "sys-test".to_string(),
            os_name: "test".to_string(),
            os_version: None,
            arch: Some("test".to_string()),
            cpu_brand: None,
            physical_cores: Some(cores),
            logical_cores: Some(cores),
            total_memory_bytes: Some(memory_gib * GIB),
            available_memory_bytes: Some(memory_gib * GIB / 2),
            gpu_info_json: None,
            detected_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn model() -> ModelCatalogEntry {
        crate::capabilities::models::default_model_catalog_entries()
            .into_iter()
            .find(|entry| entry.model_name == "qwen3.5:9b")
            .unwrap()
    }

    fn community(strategy: &str, confidence: &str) -> CommunityBenchmarkRecord {
        community_entry(
            &format!("community-{confidence}-{strategy}"),
            strategy,
            confidence,
            true,
            "2026-05-10T00:00:00Z",
            "test",
            "test",
            48,
            10,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn community_entry(
        entry_id: &str,
        strategy: &str,
        confidence: &str,
        success: bool,
        submitted_at: &str,
        os_name: &str,
        arch: &str,
        memory_gib: i64,
        cores: i64,
    ) -> CommunityBenchmarkRecord {
        CommunityBenchmarkRecord {
            entry_id: entry_id.to_string(),
            source: "community_pr".to_string(),
            confidence: confidence.to_string(),
            submitted_at: submitted_at.to_string(),
            loom_service_version: None,
            ollama_version: None,
            system_json: serde_json::json!({
                "osName": os_name,
                "arch": arch,
                "totalMemoryBytes": memory_gib * GIB,
                "logicalCores": cores
            })
            .to_string(),
            model_json: "{}".to_string(),
            benchmark_json: serde_json::json!({
                "totalLatencyMs": 42_000,
                "success": success
            })
            .to_string(),
            notes: None,
            provider: "ollama".to_string(),
            model_name: "qwen3.5:9b".to_string(),
            os_name: os_name.to_string(),
            arch: arch.to_string(),
            prompt_kind: "synthesis".to_string(),
            strategy: strategy.to_string(),
            parallelism: strategy_parallelism_rank(strategy_from_name(strategy).unwrap()),
            success,
            imported_at: "2026-05-10T00:00:00Z".to_string(),
        }
    }

    fn local_benchmark(tokens_per_second: Option<f64>) -> ModelRuntimeBenchmarkRecord {
        deep_benchmark(
            "deep_synthesis:parallel_2_draft_synthesize",
            2,
            true,
            tokens_per_second,
            Some(20_000),
        )
    }

    fn deep_benchmark(
        prompt_kind: &str,
        parallelism: i64,
        success: bool,
        tokens_per_second: Option<f64>,
        total_latency_ms: Option<i64>,
    ) -> ModelRuntimeBenchmarkRecord {
        ModelRuntimeBenchmarkRecord {
            benchmark_id: "bench-local".to_string(),
            model_id: "ollama:qwen3.5:9b".to_string(),
            provider: "ollama".to_string(),
            model_name: "qwen3.5:9b".to_string(),
            prompt_kind: prompt_kind.to_string(),
            num_ctx: Some(2048),
            num_predict: Some(512),
            parallelism,
            first_token_latency_ms: Some(1000),
            total_latency_ms,
            eval_count: None,
            eval_duration_ms: None,
            tokens_per_second,
            success,
            error_kind: (!success).then(|| "eval_failed".to_string()),
            created_at: "2026-05-10T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn low_capability_disables_parallel_drafts() {
        let input = ResolveExecutionStrategyInput {
            model_id: Some("ollama:qwen3.5:9b".to_string()),
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Document,
            context_size_tokens: 8000,
            reference_count: 4,
            user_requested_parallelism: Some(3),
        };
        let decision =
            resolve_execution_strategy(&input, Some(&snapshot(8, 4)), Some(&model()), None);
        assert_eq!(decision.max_parallelism, 1);
        assert!(!decision.allow_parallel_drafts);
        assert!(!decision.allow_deep_synthesis);
    }

    #[test]
    fn high_capability_allows_2_way_parallel_drafts() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(2),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision =
            resolve_execution_strategy(&input, Some(&snapshot(48, 10)), Some(&model()), None);
        assert_eq!(
            decision.strategy,
            ExecutionStrategy::Parallel2DraftSynthesize
        );
        assert_eq!(decision.max_parallelism, 2);
        assert!(decision.allow_parallel_drafts);
    }

    #[test]
    fn very_high_capability_without_benchmark_does_not_enable_parallel_3_from_estimate() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Document,
            prompt_kind: PromptKind::Document,
            context_size_tokens: 12000,
            reference_count: 5,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision =
            resolve_execution_strategy(&input, Some(&snapshot(96, 16)), Some(&model()), None);
        assert_ne!(
            decision.strategy,
            ExecutionStrategy::Parallel3DraftSynthesize
        );
        assert_eq!(decision.max_parallelism, 2);
        assert!(decision.allow_deep_synthesis);
        assert!(decision
            .warnings
            .contains(&"compatibility_estimate_prevented_parallel_3".to_string()));
        assert!(decision
            .reason
            .iter()
            .any(|reason| reason == "compatibility_estimate_used"));
    }

    #[test]
    fn quick_mode_is_always_fast() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Quick,
            prompt_kind: PromptKind::Document,
            context_size_tokens: 20000,
            reference_count: 9,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision =
            resolve_execution_strategy(&input, Some(&snapshot(128, 24)), Some(&model()), None);
        assert_eq!(decision.strategy, ExecutionStrategy::ShortDirect);
        assert_eq!(decision.max_parallelism, 1);
        assert!(!decision.allow_parallel_drafts);
        assert!(!decision.allow_deep_synthesis);
        assert!(decision.max_output_tokens <= 768);
    }

    #[test]
    fn long_form_detail_prompt_receives_large_output_budget() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Normal,
            prompt_kind: PromptKind::LongForm,
            context_size_tokens: 6000,
            reference_count: 1,
            user_requested_parallelism: None,
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision =
            resolve_execution_strategy(&input, Some(&snapshot(48, 10)), Some(&model()), None);

        assert!(decision.max_output_tokens >= 8192);
        assert_eq!(decision.max_parallelism, 1);
        assert!(!decision.allow_deep_synthesis);
    }

    #[test]
    fn quick_factual_prompt_stays_small_and_direct() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Quick,
            prompt_kind: PromptKind::Factual,
            context_size_tokens: 512,
            reference_count: 0,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision =
            resolve_execution_strategy(&input, Some(&snapshot(48, 10)), Some(&model()), None);

        assert_eq!(decision.strategy, ExecutionStrategy::ShortDirect);
        assert_eq!(decision.max_parallelism, 1);
        assert!(!decision.allow_parallel_drafts);
        assert!(!decision.allow_deep_synthesis);
        assert!(decision.max_output_tokens <= 2048);
    }

    #[test]
    fn normal_factual_prompt_uses_modest_single_pass_strategy() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Normal,
            prompt_kind: PromptKind::Factual,
            context_size_tokens: 512,
            reference_count: 0,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision =
            resolve_execution_strategy(&input, Some(&snapshot(96, 16)), Some(&model()), None);

        assert!(matches!(
            decision.strategy,
            ExecutionStrategy::ShortDirect | ExecutionStrategy::NormalDirect
        ));
        assert_eq!(decision.max_parallelism, 1);
        assert!(!decision.allow_parallel_drafts);
        assert!(!decision.allow_deep_synthesis);
        assert!(decision.max_output_tokens <= 2048);
    }

    #[test]
    fn no_snapshot_returns_fallback_safe() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Normal,
            prompt_kind: PromptKind::Explanation,
            context_size_tokens: 1000,
            reference_count: 0,
            user_requested_parallelism: None,
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy(&input, None, Some(&model()), None);
        assert_eq!(decision.strategy, ExecutionStrategy::FallbackSafe);
    }

    #[test]
    fn low_confidence_community_entry_does_not_enable_aggressive_parallelism() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy_with_community(
            &input,
            Some(&snapshot(16, 6)),
            Some(&model()),
            None,
            Some(&community("parallel_3_draft_synthesize", "low")),
        );
        assert_ne!(
            decision.strategy,
            ExecutionStrategy::Parallel3DraftSynthesize
        );
        assert_eq!(decision.max_parallelism, 1);
    }

    #[test]
    fn high_confidence_community_entry_can_allow_safe_non_default_strategy() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(2),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy_with_community(
            &input,
            Some(&snapshot(16, 6)),
            Some(&model()),
            None,
            Some(&community("sectioned_sequential", "high")),
        );
        assert!(matches!(
            decision.strategy,
            ExecutionStrategy::SectionedSequential | ExecutionStrategy::LongAutoContinue
        ));
        assert!(decision
            .reason
            .iter()
            .any(|reason| reason.contains("community_catalog")));
    }

    #[test]
    fn same_os_arch_high_confidence_entry_influences_signal() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(2),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let records = vec![
            community_entry(
                "distant",
                "parallel_2_draft_synthesize",
                "high",
                true,
                "2026-05-11T00:00:00Z",
                "other",
                "other",
                48,
                10,
            ),
            community_entry(
                "close",
                "parallel_2_draft_synthesize",
                "high",
                true,
                "2026-05-10T00:00:00Z",
                "test",
                "test",
                48,
                10,
            ),
        ];
        let signal = community_capability_signal(&input, &snapshot(48, 10), &records)
            .expect("community signal");

        assert_eq!(signal.source_entry_ids[0], "close");
        assert_eq!(signal.recommended_max_parallelism, 2);
    }

    #[test]
    fn conflicting_entries_choose_safer_strategy() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Document,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 12000,
            reference_count: 4,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let records = vec![
            community_entry(
                "success-p3",
                "parallel_3_draft_synthesize",
                "high",
                true,
                "2026-05-10T00:00:00Z",
                "test",
                "test",
                96,
                16,
            ),
            community_entry(
                "fail-p2",
                "parallel_2_draft_synthesize",
                "medium",
                false,
                "2026-05-11T00:00:00Z",
                "test",
                "test",
                96,
                16,
            ),
        ];

        let decision = resolve_execution_strategy_with_community_entries(
            &input,
            Some(&snapshot(96, 16)),
            Some(&model()),
            None,
            &records,
        );

        assert_ne!(
            decision.strategy,
            ExecutionStrategy::Parallel3DraftSynthesize
        );
        assert!(decision
            .warnings
            .iter()
            .any(|warning| warning == "community_conflict_detected"));
        assert!(decision
            .warnings
            .iter()
            .any(|warning| warning == "community_parallelism_downgraded"));
    }

    #[test]
    fn newer_matching_entry_is_preferred_over_older_similar_entry() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(2),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let records = vec![
            community_entry(
                "older",
                "sectioned_sequential",
                "high",
                true,
                "2026-01-01T00:00:00Z",
                "test",
                "test",
                48,
                10,
            ),
            community_entry(
                "newer",
                "parallel_2_draft_synthesize",
                "high",
                true,
                "2026-05-10T00:00:00Z",
                "test",
                "test",
                48,
                10,
            ),
        ];
        let signal = community_capability_signal(&input, &snapshot(48, 10), &records)
            .expect("community signal");

        assert_eq!(signal.source_entry_ids[0], "newer");
    }

    #[test]
    fn local_benchmark_overrides_community_signal() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let records = vec![community_entry(
            "community-p3",
            "parallel_3_draft_synthesize",
            "high",
            true,
            "2026-05-10T00:00:00Z",
            "test",
            "test",
            96,
            16,
        )];

        let decision = resolve_execution_strategy_with_community_entries(
            &input,
            Some(&snapshot(96, 16)),
            Some(&model()),
            Some(&local_benchmark(Some(5.0))),
            &records,
        );

        assert_eq!(decision.max_parallelism, 1);
        assert!(decision
            .reason
            .iter()
            .any(|reason| reason.contains("local_benchmark_available")));
        assert!(decision
            .reason
            .contains(&"local_benchmark_overrides_estimate".to_string()));
    }

    #[test]
    fn community_catalog_remains_above_estimate() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(2),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy_with_community_entries(
            &input,
            Some(&snapshot(48, 10)),
            Some(&model()),
            None,
            &[community("sectioned_sequential", "high")],
        );

        assert!(decision
            .reason
            .contains(&"community_catalog_remains_above_estimate".to_string()));
        assert!(decision
            .reason
            .iter()
            .any(|reason| reason.contains("\"source\":\"community_catalog\"")));
    }

    #[test]
    fn quick_mode_ignores_community_parallel_and_deep_suggestions() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Quick,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy_with_community_entries(
            &input,
            Some(&snapshot(96, 16)),
            Some(&model()),
            None,
            &[community("deep_synthesis", "high")],
        );

        assert_eq!(decision.strategy, ExecutionStrategy::ShortDirect);
        assert_eq!(decision.max_parallelism, 1);
        assert!(!decision.allow_deep_synthesis);
        assert!(!decision
            .reason
            .iter()
            .any(|reason| reason.contains("compatibility_estimate_used")));
    }

    #[test]
    fn system_guardrail_downgrades_aggressive_community_suggestion() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy_with_community_entries(
            &input,
            Some(&snapshot(8, 4)),
            Some(&model()),
            None,
            &[community("parallel_3_draft_synthesize", "high")],
        );

        assert_ne!(
            decision.strategy,
            ExecutionStrategy::Parallel3DraftSynthesize
        );
        assert_eq!(decision.max_parallelism, 1);
    }

    #[test]
    fn aggregation_output_has_sources_warnings_and_no_forbidden_fields() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let signal = community_capability_signal(
            &input,
            &snapshot(48, 10),
            &[community_entry(
                "low-only",
                "parallel_3_draft_synthesize",
                "low",
                true,
                "2026-05-10T00:00:00Z",
                "other",
                "other",
                48,
                10,
            )],
        )
        .expect("community signal");
        let json = serde_json::to_string(&signal).expect("serialize signal");

        assert!(signal.source_entry_ids.contains(&"low-only".to_string()));
        assert!(signal
            .warnings
            .contains(&"community_low_confidence_only".to_string()));
        assert!(signal
            .warnings
            .contains(&"community_no_close_system_match".to_string()));
        assert!(!json.contains("raw_thinking"));
        assert!(!json.contains("user_prompt"));
        assert!(!json.contains("personal_data"));
    }

    #[test]
    fn successful_parallel_2_eval_allows_parallel_2_with_guardrails() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(2),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy(
            &input,
            Some(&snapshot(48, 10)),
            Some(&model()),
            Some(&deep_benchmark(
                "deep_synthesis:parallel_2_draft_synthesize",
                2,
                true,
                Some(28.0),
                Some(35_000),
            )),
        );

        assert_eq!(
            decision.strategy,
            ExecutionStrategy::Parallel2DraftSynthesize
        );
        assert!(decision
            .reason
            .iter()
            .any(|reason| reason == "deep_synthesis_eval_success"));
    }

    #[test]
    fn failed_parallel_2_eval_downgrades_to_sectioned() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(2),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy(
            &input,
            Some(&snapshot(48, 10)),
            Some(&model()),
            Some(&deep_benchmark(
                "deep_synthesis:parallel_2_draft_synthesize",
                2,
                false,
                None,
                None,
            )),
        );

        assert!(matches!(
            decision.strategy,
            ExecutionStrategy::SectionedSequential | ExecutionStrategy::LongAutoContinue
        ));
        assert!(decision
            .warnings
            .contains(&"parallel_2_downgraded".to_string()));
        assert!(decision
            .warnings
            .contains(&"deep_synthesis_eval_failed".to_string()));
    }

    #[test]
    fn failed_parallel_3_eval_downgrades_to_parallel_2_or_sectioned() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Document,
            prompt_kind: PromptKind::Document,
            context_size_tokens: 12000,
            reference_count: 5,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy(
            &input,
            Some(&snapshot(96, 16)),
            Some(&model()),
            Some(&deep_benchmark(
                "deep_synthesis:parallel_3_draft_synthesize",
                3,
                false,
                None,
                None,
            )),
        );

        assert_ne!(
            decision.strategy,
            ExecutionStrategy::Parallel3DraftSynthesize
        );
        assert!(matches!(
            decision.strategy,
            ExecutionStrategy::Parallel2DraftSynthesize | ExecutionStrategy::SectionedSequential
        ));
        assert!(decision
            .warnings
            .contains(&"parallel_3_downgraded".to_string()));
    }

    #[test]
    fn slow_benchmark_reduces_output_and_parallel_strategy() {
        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(2),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy(
            &input,
            Some(&snapshot(48, 10)),
            Some(&model()),
            Some(&deep_benchmark(
                "deep_synthesis:parallel_2_draft_synthesize",
                2,
                true,
                Some(6.0),
                Some(120_000),
            )),
        );

        assert!(
            matches!(
                decision.strategy,
                ExecutionStrategy::SectionedSequential | ExecutionStrategy::LongAutoContinue
            ),
            "unexpected strategy {:?}",
            decision.strategy
        );
        assert!(decision.max_output_tokens <= 8192);
        assert!(decision
            .warnings
            .contains(&"local_benchmark_slow".to_string()));
    }

    #[test]
    fn null_hardware_facts_choose_conservative_strategy() {
        let mut unknown = snapshot(0, 0);
        unknown.total_memory_bytes = None;
        unknown.logical_cores = None;
        unknown.available_memory_bytes = None;

        let input = ResolveExecutionStrategyInput {
            requested_mode: RequestedMode::Deep,
            prompt_kind: PromptKind::Synthesis,
            context_size_tokens: 9000,
            reference_count: 3,
            user_requested_parallelism: Some(3),
            model_id: None,
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
        };
        let decision = resolve_execution_strategy(&input, Some(&unknown), Some(&model()), None);

        assert_eq!(decision.max_parallelism, 1);
        assert!(!decision.allow_deep_synthesis);
    }
}
