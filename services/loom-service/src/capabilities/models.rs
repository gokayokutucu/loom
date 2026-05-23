use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogEntry {
    pub model_id: String,
    pub provider: String,
    pub model_name: String,
    pub model_family: Option<String>,
    pub parameter_count_b: Option<f64>,
    pub quantization: Option<String>,
    pub supports_thinking: bool,
    pub supports_tools: bool,
    pub recommended_min_memory_bytes: Option<i64>,
    pub recommended_memory_bytes: Option<i64>,
    pub max_context_tokens: Option<i64>,
    pub source: String,
    pub confidence: String,
    pub details_json: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn default_model_catalog_entries() -> Vec<ModelCatalogEntry> {
    let now = crate::capabilities::repository::timestamp();
    vec![
        model(
            "ollama:qwen3.5:9b",
            "qwen3.5:9b",
            Some(9.0),
            "medium",
            "Initial supported local model profile. Exact memory and context limits must come from installed metadata or benchmarks.",
            &now,
        ),
        model(
            "ollama:qwen:7b",
            "qwen:7b",
            Some(7.0),
            "low",
            "Future seed profile for smaller Qwen local model.",
            &now,
        ),
        model(
            "ollama:llama3.2",
            "llama3.2",
            None,
            "low",
            "Future seed profile for lightweight Llama local model.",
            &now,
        ),
        model(
            "ollama:codeqwen:7b-code",
            "codeqwen:7b-code",
            Some(7.0),
            "low",
            "Future seed profile for code-oriented local model.",
            &now,
        ),
    ]
}

fn model(
    model_id: &str,
    model_name: &str,
    parameter_count_b: Option<f64>,
    confidence: &str,
    notes: &str,
    now: &str,
) -> ModelCatalogEntry {
    ModelCatalogEntry {
        model_id: model_id.to_string(),
        provider: "ollama".to_string(),
        model_name: model_name.to_string(),
        model_family: Some("qwen".to_string()).filter(|_| model_name.contains("qwen")),
        parameter_count_b,
        quantization: None,
        supports_thinking: model_name.contains("qwen"),
        supports_tools: false,
        recommended_min_memory_bytes: None,
        recommended_memory_bytes: None,
        max_context_tokens: None,
        source: "curated_seed".to_string(),
        confidence: confidence.to_string(),
        details_json: None,
        notes: Some(notes.to_string()),
        created_at: now.to_string(),
        updated_at: now.to_string(),
    }
}
