use crate::capabilities::{
    community::CommunityBenchmarkRecord,
    models::ModelCatalogEntry,
    repository::ModelRuntimeBenchmarkRecord,
    resources::SystemResourceSnapshot,
    strategy::{prompt_kind_name, requested_mode_name, PromptKind, RequestedMode},
};
use serde::{Deserialize, Serialize};

const GIB: i64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CompatibilityGrade {
    S,
    A,
    B,
    C,
    D,
    F,
    #[serde(rename = "unknown")]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryFit {
    Great,
    Good,
    Tight,
    Barely,
    TooHeavy,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeedEstimate {
    Fast,
    Acceptable,
    Slow,
    VerySlow,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EstimateConfidence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityEstimate {
    pub grade: CompatibilityGrade,
    pub memory_fit: MemoryFit,
    pub speed_estimate: SpeedEstimate,
    pub recommended_max_context: Option<i64>,
    pub recommended_max_output: Option<i64>,
    pub recommended_parallelism: i64,
    pub allow_deep_synthesis: bool,
    pub confidence: EstimateConfidence,
    pub source: String,
    pub warnings: Vec<String>,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityEstimateInput {
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
}

pub fn estimate_model_compatibility(
    input: &CompatibilityEstimateInput,
    snapshot: Option<&SystemResourceSnapshot>,
    model: Option<&ModelCatalogEntry>,
    benchmark: Option<&ModelRuntimeBenchmarkRecord>,
    community_entries: &[CommunityBenchmarkRecord],
) -> CompatibilityEstimate {
    let mut warnings = Vec::new();
    let mut reasons = vec![
        "compatibility_estimate_conservative".to_string(),
        format!(
            "requested_mode={}",
            requested_mode_name(&input.requested_mode)
        ),
        format!("prompt_kind={}", prompt_kind_name(&input.prompt_kind)),
        format!("context_size_tokens={}", input.context_size_tokens),
        format!("reference_count={}", input.reference_count),
    ];

    if input.requested_mode == RequestedMode::Quick {
        reasons.push("quick_mode_ignores_estimate".to_string());
        return CompatibilityEstimate {
            grade: CompatibilityGrade::C,
            memory_fit: MemoryFit::Unknown,
            speed_estimate: SpeedEstimate::Unknown,
            recommended_max_context: Some(2048),
            recommended_max_output: Some(768),
            recommended_parallelism: 1,
            allow_deep_synthesis: false,
            confidence: EstimateConfidence::Low,
            source: "estimate".to_string(),
            warnings,
            reasons,
        };
    }

    if benchmark.is_some() {
        reasons.push("local_benchmark_overrides_estimate".to_string());
    }

    let Some(snapshot) = snapshot else {
        warnings.push("system_snapshot_missing".to_string());
        reasons.push("compatibility_estimate_low_confidence".to_string());
        return unknown_conservative(warnings, reasons);
    };

    let memory = snapshot.total_memory_bytes;
    let available_memory = snapshot.available_memory_bytes;
    let logical_cores = snapshot.logical_cores;
    let Some(model) = model else {
        warnings.push("unknown_model_metadata_conservative".to_string());
        reasons.push("compatibility_estimate_low_confidence".to_string());
        return unknown_conservative(warnings, reasons);
    };

    if model.parameter_count_b.is_none()
        && model.recommended_memory_bytes.is_none()
        && model.max_context_tokens.is_none()
    {
        warnings.push("unknown_model_metadata_conservative".to_string());
        reasons.push("compatibility_estimate_low_confidence".to_string());
        return unknown_conservative(warnings, reasons);
    }

    let memory_fit = estimate_memory_fit(memory, available_memory, model, &mut reasons);
    let confidence = estimate_confidence(model, snapshot, community_entries);
    let speed_estimate = estimate_speed(memory, logical_cores, &memory_fit, &confidence);
    let grade = estimate_grade(&memory_fit, &speed_estimate, &confidence);

    let mut recommended_parallelism = match (&grade, &confidence) {
        (CompatibilityGrade::S | CompatibilityGrade::A, EstimateConfidence::High) => 2,
        (CompatibilityGrade::A | CompatibilityGrade::B, EstimateConfidence::Medium) => 2,
        _ => 1,
    };
    if !matches!(memory_fit, MemoryFit::Great | MemoryFit::Good) {
        recommended_parallelism = 1;
    }

    let allow_deep_synthesis =
        recommended_parallelism >= 2 && confidence == EstimateConfidence::High;
    if !allow_deep_synthesis {
        reasons.push("estimate_does_not_enable_deep_synthesis_without_high_confidence".to_string());
    }
    reasons.push("estimate_does_not_enable_parallel_3".to_string());
    if !community_entries.is_empty() {
        reasons.push("community_catalog_remains_above_estimate".to_string());
    }
    let recommended_max_context = recommended_context(&memory_fit, model);
    let recommended_max_output = recommended_output(&memory_fit, input);

    CompatibilityEstimate {
        grade,
        memory_fit,
        speed_estimate,
        recommended_max_context,
        recommended_max_output,
        recommended_parallelism,
        allow_deep_synthesis,
        confidence,
        source: "estimate".to_string(),
        warnings,
        reasons,
    }
}

impl From<&crate::capabilities::strategy::ResolveExecutionStrategyInput>
    for CompatibilityEstimateInput
{
    fn from(input: &crate::capabilities::strategy::ResolveExecutionStrategyInput) -> Self {
        Self {
            provider: input.provider.clone(),
            model_name: input.model_name.clone(),
            requested_mode: input.requested_mode.clone(),
            prompt_kind: input.prompt_kind.clone(),
            context_size_tokens: input.context_size_tokens,
            reference_count: input.reference_count,
        }
    }
}

fn unknown_conservative(warnings: Vec<String>, reasons: Vec<String>) -> CompatibilityEstimate {
    CompatibilityEstimate {
        grade: CompatibilityGrade::Unknown,
        memory_fit: MemoryFit::Unknown,
        speed_estimate: SpeedEstimate::Unknown,
        recommended_max_context: None,
        recommended_max_output: Some(2048),
        recommended_parallelism: 1,
        allow_deep_synthesis: false,
        confidence: EstimateConfidence::Low,
        source: "estimate".to_string(),
        warnings,
        reasons,
    }
}

fn estimate_memory_fit(
    total_memory: Option<i64>,
    available_memory: Option<i64>,
    model: &ModelCatalogEntry,
    reasons: &mut Vec<String>,
) -> MemoryFit {
    if let Some(recommended) = model.recommended_memory_bytes {
        let Some(total) = total_memory else {
            reasons.push("memory_fit_unknown_missing_total_memory".to_string());
            return MemoryFit::Unknown;
        };
        if total >= recommended * 2 {
            return MemoryFit::Great;
        }
        if total >= recommended + recommended / 2 {
            return MemoryFit::Good;
        }
        if total >= recommended {
            return MemoryFit::Tight;
        }
        if total >= recommended * 3 / 4 {
            return MemoryFit::Barely;
        }
        return MemoryFit::TooHeavy;
    }

    let Some(parameter_count_b) = model.parameter_count_b else {
        reasons.push("memory_fit_unknown_missing_model_size".to_string());
        return MemoryFit::Unknown;
    };
    let Some(total) = total_memory else {
        reasons.push("memory_fit_unknown_missing_total_memory".to_string());
        return MemoryFit::Unknown;
    };
    let available = available_memory.unwrap_or(total);
    let model_size = if parameter_count_b <= 4.0 {
        "small"
    } else if parameter_count_b <= 9.0 {
        "medium"
    } else {
        "large"
    };
    reasons.push(format!("model_size_bucket={model_size}"));

    match model_size {
        "small" if total >= 16 * GIB && available >= 6 * GIB => MemoryFit::Great,
        "small" if total >= 8 * GIB => MemoryFit::Good,
        "medium" if total >= 48 * GIB && available >= 16 * GIB => MemoryFit::Great,
        "medium" if total >= 24 * GIB && available >= 8 * GIB => MemoryFit::Good,
        "medium" if total >= 16 * GIB => MemoryFit::Tight,
        "medium" if total >= 12 * GIB => MemoryFit::Barely,
        "large" if total >= 96 * GIB && available >= 32 * GIB => MemoryFit::Good,
        "large" if total >= 64 * GIB => MemoryFit::Tight,
        "large" if total >= 32 * GIB => MemoryFit::Barely,
        _ => MemoryFit::TooHeavy,
    }
}

fn estimate_confidence(
    model: &ModelCatalogEntry,
    snapshot: &SystemResourceSnapshot,
    community_entries: &[CommunityBenchmarkRecord],
) -> EstimateConfidence {
    if model.recommended_memory_bytes.is_some()
        && model.max_context_tokens.is_some()
        && snapshot.total_memory_bytes.is_some()
        && snapshot.logical_cores.is_some()
    {
        return EstimateConfidence::High;
    }
    if model.parameter_count_b.is_some()
        && snapshot.total_memory_bytes.is_some()
        && snapshot.logical_cores.is_some()
        && !community_entries.is_empty()
    {
        return EstimateConfidence::Medium;
    }
    if model.parameter_count_b.is_some()
        && snapshot.total_memory_bytes.is_some()
        && snapshot.logical_cores.is_some()
    {
        return EstimateConfidence::Medium;
    }
    EstimateConfidence::Low
}

fn estimate_speed(
    memory: Option<i64>,
    cores: Option<i64>,
    memory_fit: &MemoryFit,
    confidence: &EstimateConfidence,
) -> SpeedEstimate {
    let memory = memory.unwrap_or_default();
    let cores = cores.unwrap_or_default();
    match (memory_fit, confidence) {
        (MemoryFit::Great, EstimateConfidence::High) if memory >= 64 * GIB && cores >= 12 => {
            SpeedEstimate::Fast
        }
        (MemoryFit::Great | MemoryFit::Good, _) if memory >= 24 * GIB && cores >= 8 => {
            SpeedEstimate::Acceptable
        }
        (MemoryFit::Tight, _) => SpeedEstimate::Slow,
        (MemoryFit::Barely | MemoryFit::TooHeavy, _) => SpeedEstimate::VerySlow,
        _ => SpeedEstimate::Unknown,
    }
}

fn estimate_grade(
    memory_fit: &MemoryFit,
    speed: &SpeedEstimate,
    confidence: &EstimateConfidence,
) -> CompatibilityGrade {
    match (memory_fit, speed, confidence) {
        (MemoryFit::Great, SpeedEstimate::Fast, EstimateConfidence::High) => CompatibilityGrade::S,
        (
            MemoryFit::Great | MemoryFit::Good,
            SpeedEstimate::Fast | SpeedEstimate::Acceptable,
            _,
        ) => CompatibilityGrade::A,
        (
            MemoryFit::Good | MemoryFit::Tight,
            SpeedEstimate::Acceptable | SpeedEstimate::Slow,
            _,
        ) => CompatibilityGrade::B,
        (MemoryFit::Tight, _, _) => CompatibilityGrade::C,
        (MemoryFit::Barely, _, _) => CompatibilityGrade::D,
        (MemoryFit::TooHeavy, _, _) => CompatibilityGrade::F,
        _ => CompatibilityGrade::Unknown,
    }
}

fn recommended_context(memory_fit: &MemoryFit, model: &ModelCatalogEntry) -> Option<i64> {
    let conservative = match memory_fit {
        MemoryFit::Great => Some(16_384),
        MemoryFit::Good => Some(12_288),
        MemoryFit::Tight => Some(8_192),
        MemoryFit::Barely => Some(4_096),
        MemoryFit::TooHeavy => Some(2_048),
        MemoryFit::Unknown => None,
    };
    match (conservative, model.max_context_tokens) {
        (Some(estimate), Some(model_max)) => Some(estimate.min(model_max)),
        (Some(estimate), None) => Some(estimate),
        (None, Some(model_max)) => Some(model_max.min(4_096)),
        (None, None) => None,
    }
}

fn recommended_output(memory_fit: &MemoryFit, input: &CompatibilityEstimateInput) -> Option<i64> {
    if input.requested_mode == RequestedMode::Quick {
        return Some(768);
    }
    Some(match memory_fit {
        MemoryFit::Great | MemoryFit::Good
            if matches!(
                input.prompt_kind,
                PromptKind::LongForm | PromptKind::Document | PromptKind::Synthesis
            ) =>
        {
            8192
        }
        MemoryFit::Great | MemoryFit::Good => 4096,
        MemoryFit::Tight => 3072,
        MemoryFit::Barely | MemoryFit::TooHeavy => 2048,
        MemoryFit::Unknown => 2048,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(memory_gib: i64, cores: i64) -> SystemResourceSnapshot {
        SystemResourceSnapshot {
            snapshot_id: "sys-estimate".to_string(),
            os_name: "test".to_string(),
            os_version: None,
            arch: Some("test".to_string()),
            cpu_brand: None,
            physical_cores: Some(cores),
            logical_cores: Some(cores),
            total_memory_bytes: Some(memory_gib * GIB),
            available_memory_bytes: Some(memory_gib * GIB / 2),
            gpu_info_json: None,
            detected_at: "2026-05-13T00:00:00Z".to_string(),
        }
    }

    fn input(mode: RequestedMode, kind: PromptKind) -> CompatibilityEstimateInput {
        CompatibilityEstimateInput {
            provider: Some("ollama".to_string()),
            model_name: Some("qwen3.5:9b".to_string()),
            requested_mode: mode,
            prompt_kind: kind,
            context_size_tokens: 4096,
            reference_count: 0,
        }
    }

    fn known_model() -> ModelCatalogEntry {
        ModelCatalogEntry {
            model_id: "ollama:small".to_string(),
            provider: "ollama".to_string(),
            model_name: "small:4b".to_string(),
            model_family: Some("small".to_string()),
            parameter_count_b: Some(4.0),
            quantization: None,
            supports_thinking: true,
            supports_tools: false,
            recommended_min_memory_bytes: None,
            recommended_memory_bytes: None,
            max_context_tokens: Some(16_384),
            source: "test".to_string(),
            confidence: "medium".to_string(),
            details_json: None,
            notes: None,
            created_at: "2026-05-13T00:00:00Z".to_string(),
            updated_at: "2026-05-13T00:00:00Z".to_string(),
        }
    }

    fn unknown_model() -> ModelCatalogEntry {
        let mut model = known_model();
        model.parameter_count_b = None;
        model.max_context_tokens = None;
        model
    }

    fn benchmark() -> ModelRuntimeBenchmarkRecord {
        ModelRuntimeBenchmarkRecord {
            benchmark_id: "bench".to_string(),
            model_id: "ollama:small".to_string(),
            provider: "ollama".to_string(),
            model_name: "small:4b".to_string(),
            prompt_kind: "synthesis".to_string(),
            num_ctx: Some(2048),
            num_predict: Some(512),
            parallelism: 2,
            first_token_latency_ms: Some(1000),
            total_latency_ms: Some(10_000),
            eval_count: None,
            eval_duration_ms: None,
            tokens_per_second: Some(30.0),
            success: true,
            error_kind: None,
            created_at: "2026-05-13T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn unknown_model_metadata_returns_conservative_unknown_estimate() {
        let estimate = estimate_model_compatibility(
            &input(RequestedMode::Normal, PromptKind::Explanation),
            Some(&snapshot(32, 8)),
            Some(&unknown_model()),
            None,
            &[],
        );

        assert_eq!(estimate.grade, CompatibilityGrade::Unknown);
        assert_eq!(estimate.memory_fit, MemoryFit::Unknown);
        assert_eq!(estimate.recommended_parallelism, 1);
        assert!(!estimate.allow_deep_synthesis);
        assert_eq!(estimate.confidence, EstimateConfidence::Low);
        assert!(estimate
            .warnings
            .contains(&"unknown_model_metadata_conservative".to_string()));
    }

    #[test]
    fn low_memory_system_returns_low_grade_and_no_parallelism() {
        let mut model = known_model();
        model.parameter_count_b = Some(9.0);
        let estimate = estimate_model_compatibility(
            &input(RequestedMode::Deep, PromptKind::Synthesis),
            Some(&snapshot(8, 4)),
            Some(&model),
            None,
            &[],
        );

        assert!(matches!(
            estimate.memory_fit,
            MemoryFit::Barely | MemoryFit::TooHeavy | MemoryFit::Tight
        ));
        assert_eq!(estimate.recommended_parallelism, 1);
        assert!(!estimate.allow_deep_synthesis);
    }

    #[test]
    fn higher_memory_known_small_model_returns_better_estimate() {
        let estimate = estimate_model_compatibility(
            &input(RequestedMode::Long, PromptKind::LongForm),
            Some(&snapshot(32, 10)),
            Some(&known_model()),
            None,
            &[],
        );

        assert!(matches!(
            estimate.grade,
            CompatibilityGrade::A | CompatibilityGrade::B
        ));
        assert!(matches!(
            estimate.memory_fit,
            MemoryFit::Great | MemoryFit::Good
        ));
        assert!(estimate.recommended_max_context.unwrap_or_default() >= 12_288);
        assert!(estimate.recommended_max_output.unwrap_or_default() >= 4096);
    }

    #[test]
    fn local_benchmark_override_is_reported_but_estimate_stays_safe() {
        let estimate = estimate_model_compatibility(
            &input(RequestedMode::Deep, PromptKind::Synthesis),
            Some(&snapshot(64, 12)),
            Some(&known_model()),
            Some(&benchmark()),
            &[],
        );

        assert!(estimate
            .reasons
            .contains(&"local_benchmark_overrides_estimate".to_string()));
        assert!(estimate.recommended_parallelism <= 2);
    }

    #[test]
    fn quick_mode_ignores_estimate() {
        let estimate = estimate_model_compatibility(
            &input(RequestedMode::Quick, PromptKind::Synthesis),
            Some(&snapshot(128, 24)),
            Some(&known_model()),
            None,
            &[],
        );

        assert_eq!(estimate.recommended_parallelism, 1);
        assert!(!estimate.allow_deep_synthesis);
        assert_eq!(estimate.recommended_max_output, Some(768));
        assert!(estimate
            .reasons
            .contains(&"quick_mode_ignores_estimate".to_string()));
    }

    #[test]
    fn estimate_output_has_no_forbidden_raw_thinking_keys() {
        let estimate = estimate_model_compatibility(
            &input(RequestedMode::Normal, PromptKind::Explanation),
            Some(&snapshot(32, 8)),
            Some(&known_model()),
            None,
            &[],
        );
        let json = serde_json::to_string(&estimate).expect("estimate json");

        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(!json.contains(forbidden));
        }
    }
}
