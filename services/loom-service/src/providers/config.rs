use crate::error::ServiceError;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::IpAddr;

const FORBIDDEN_CONFIG_KEYS: [&str; 12] = [
    "api_key",
    "apikey",
    "apiKey",
    "bearer_token",
    "bearerToken",
    "password",
    "refresh_token",
    "refreshToken",
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Ollama,
    OpenAiCompatible,
    CustomHttpLater,
}

impl ProviderKind {
    pub fn as_config_str(&self) -> &'static str {
        match self {
            Self::Ollama => "ollama",
            Self::OpenAiCompatible => "openai_compatible",
            Self::CustomHttpLater => "custom_http_later",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "ollama" => Some(Self::Ollama),
            "openai_compatible" => Some(Self::OpenAiCompatible),
            "custom_http_later" => Some(Self::CustomHttpLater),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDiscoveryConfig {
    pub enabled: bool,
    pub endpoint_path: Option<String>,
    pub refresh_interval_seconds: Option<u64>,
}

impl Default for ProviderModelDiscoveryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            endpoint_path: Some("/api/tags".to_string()),
            refresh_interval_seconds: Some(300),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRequestDefaultsConfig {
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub num_ctx: Option<u32>,
    pub num_predict: Option<u32>,
    pub think: Option<bool>,
    pub stream: Option<bool>,
}

impl Default for ProviderRequestDefaultsConfig {
    fn default() -> Self {
        Self {
            temperature: Some(0.2),
            top_p: None,
            num_ctx: None,
            num_predict: None,
            think: Some(false),
            stream: Some(true),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecurityPolicyConfig {
    pub local_only_required: bool,
    pub allow_remote_endpoint: bool,
    pub allow_insecure_http_remote: bool,
    pub allow_unsafe_model_management: bool,
}

impl Default for ProviderSecurityPolicyConfig {
    fn default() -> Self {
        Self {
            local_only_required: true,
            allow_remote_endpoint: false,
            allow_insecure_http_remote: false,
            allow_unsafe_model_management: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilitiesConfig {
    pub supports_streaming: bool,
    pub supports_cancellation: bool,
    pub supports_model_listing: bool,
    pub supports_thinking: bool,
    pub supports_system_prompt: bool,
    pub supports_json_mode: Option<bool>,
}

impl Default for ProviderCapabilitiesConfig {
    fn default() -> Self {
        Self {
            supports_streaming: true,
            supports_cancellation: true,
            supports_model_listing: true,
            supports_thinking: true,
            supports_system_prompt: true,
            supports_json_mode: Some(false),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfileConfig {
    pub id: String,
    pub provider_kind: ProviderKind,
    pub display_name: String,
    pub enabled: bool,
    pub base_url: Option<String>,
    pub default_model: Option<String>,
    pub requires_secret: bool,
    pub model_discovery: ProviderModelDiscoveryConfig,
    pub request_defaults: ProviderRequestDefaultsConfig,
    pub security: ProviderSecurityPolicyConfig,
    pub capabilities: ProviderCapabilitiesConfig,
    pub metadata_json: Option<Value>,
}

impl ProviderProfileConfig {
    pub fn default_ollama(default_model: String, base_url: String) -> Self {
        Self {
            id: "ollama-local".to_string(),
            provider_kind: ProviderKind::Ollama,
            display_name: "Ollama Local".to_string(),
            enabled: true,
            base_url: Some(base_url.trim_end_matches('/').to_string()),
            default_model: Some(default_model),
            requires_secret: false,
            model_discovery: ProviderModelDiscoveryConfig::default(),
            request_defaults: ProviderRequestDefaultsConfig::default(),
            security: ProviderSecurityPolicyConfig::default(),
            capabilities: ProviderCapabilitiesConfig::default(),
            metadata_json: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderConfigChangeClassification {
    LiveApply,
    ProviderReconnectRequired,
    ServiceRestartRequired,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRequestNormalizationInput {
    pub model: Option<String>,
    pub output_budget: Option<u32>,
    pub context_budget: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub think: Option<bool>,
    pub stream: Option<bool>,
    pub quick_ask: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedProviderRequestOptions {
    pub model: String,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub max_output_tokens: Option<u32>,
    pub max_context_tokens: Option<u32>,
    pub num_predict: Option<u32>,
    pub num_ctx: Option<u32>,
    pub think: Option<bool>,
    pub stream: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDiscoveryResult {
    pub provider_profile_id: String,
    pub provider_kind: ProviderKind,
    pub source: String,
    pub models: Vec<String>,
    pub warnings: Vec<String>,
}

pub fn validate_provider_profiles(profiles: &[ProviderProfileConfig]) -> Result<(), ServiceError> {
    let mut ids = std::collections::BTreeSet::new();
    for profile in profiles {
        validate_profile_identity(profile)?;
        if !ids.insert(profile.id.clone()) {
            return Err(ServiceError::config(format!(
                "providers.profiles id '{}' must be unique",
                profile.id
            )));
        }
        validate_profile_endpoint(profile)?;
        validate_profile_metadata(profile)?;
    }
    Ok(())
}

fn validate_profile_identity(profile: &ProviderProfileConfig) -> Result<(), ServiceError> {
    if profile.id.trim().is_empty() {
        return Err(ServiceError::config(
            "providers.profiles.id must not be empty",
        ));
    }
    if profile.display_name.trim().is_empty() {
        return Err(ServiceError::config(
            "providers.profiles.displayName must not be empty",
        ));
    }
    if let Some(model) = &profile.default_model {
        if model.trim().is_empty() {
            return Err(ServiceError::config(
                "providers.profiles.defaultModel must not be empty when present",
            ));
        }
    }
    Ok(())
}

fn validate_profile_endpoint(profile: &ProviderProfileConfig) -> Result<(), ServiceError> {
    let Some(base_url) = profile.base_url.as_deref() else {
        if profile.provider_kind == ProviderKind::OpenAiCompatible {
            return Err(ServiceError::config(
                "openai_compatible provider profiles require baseUrl",
            ));
        }
        return Ok(());
    };
    let parsed = Url::parse(base_url).map_err(|error| {
        ServiceError::config(format!(
            "providers.profiles '{}' baseUrl is invalid: {error}",
            profile.id
        ))
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ServiceError::config(format!(
            "providers.profiles '{}' baseUrl must use http or https",
            profile.id
        )));
    }
    let Some(host) = parsed.host_str() else {
        return Err(ServiceError::config(format!(
            "providers.profiles '{}' baseUrl must include a host",
            profile.id
        )));
    };

    let is_loopback = is_loopback_host(host);
    if profile.provider_kind == ProviderKind::Ollama
        && profile.security.local_only_required
        && !is_loopback
        && !profile.security.allow_remote_endpoint
    {
        return Err(ServiceError::config(
            "Ollama provider profiles must use loopback baseUrl unless allowRemoteEndpoint is true",
        ));
    }
    if host == "0.0.0.0" {
        return Err(ServiceError::config(
            "0.0.0.0 is not a safe provider client target",
        ));
    }
    if !is_loopback && parsed.scheme() == "http" && !profile.security.allow_insecure_http_remote {
        return Err(ServiceError::config(
            "remote provider baseUrl using http requires allowInsecureHttpRemote=true",
        ));
    }
    Ok(())
}

fn validate_profile_metadata(profile: &ProviderProfileConfig) -> Result<(), ServiceError> {
    if let Some(metadata) = &profile.metadata_json {
        reject_forbidden_config_value(metadata)?;
    }
    Ok(())
}

pub fn reject_forbidden_config_value(value: &Value) -> Result<(), ServiceError> {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                if FORBIDDEN_CONFIG_KEYS
                    .iter()
                    .any(|forbidden| key.eq_ignore_ascii_case(forbidden))
                {
                    return Err(ServiceError::config(format!(
                        "provider config must not contain secret/raw-thinking field '{key}'"
                    )));
                }
                reject_forbidden_config_value(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_forbidden_config_value(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn classify_provider_config_change(
    current: &ProviderProfileConfig,
    candidate: &ProviderProfileConfig,
) -> ProviderConfigChangeClassification {
    if validate_provider_profiles(std::slice::from_ref(candidate)).is_err() {
        return ProviderConfigChangeClassification::Invalid;
    }
    if current.provider_kind != candidate.provider_kind
        || current.security != candidate.security
        || current.enabled != candidate.enabled
    {
        return ProviderConfigChangeClassification::ServiceRestartRequired;
    }
    if current.base_url != candidate.base_url
        || current.model_discovery != candidate.model_discovery
    {
        return ProviderConfigChangeClassification::ProviderReconnectRequired;
    }
    ProviderConfigChangeClassification::LiveApply
}

#[allow(dead_code)]
pub fn normalize_provider_request_options(
    profile: &ProviderProfileConfig,
    input: ProviderRequestNormalizationInput,
) -> Result<NormalizedProviderRequestOptions, ServiceError> {
    let model = input
        .model
        .or_else(|| profile.default_model.clone())
        .ok_or_else(|| ServiceError::config("provider request requires a model"))?;
    let defaults = &profile.request_defaults;
    let mut warnings = Vec::new();
    let mut think = input.think.or(defaults.think);
    if input.quick_ask {
        if think == Some(true) {
            warnings.push("quick_ask_forced_think_false".to_string());
        }
        think = Some(false);
    }
    if think == Some(true) && !profile.capabilities.supports_thinking {
        warnings.push("provider_does_not_support_thinking".to_string());
        think = Some(false);
    }

    let stream = input.stream.or(defaults.stream).unwrap_or(true);
    let top_p = input.top_p.or(defaults.top_p);
    if top_p.is_some() && profile.provider_kind == ProviderKind::Ollama {
        warnings.push("top_p_not_mapped_for_ollama".to_string());
    }

    let max_output_tokens = input.output_budget.or(defaults.num_predict);
    let max_context_tokens = input.context_budget.or(defaults.num_ctx);
    let (num_predict, num_ctx) = match profile.provider_kind {
        ProviderKind::Ollama => (max_output_tokens, max_context_tokens),
        ProviderKind::OpenAiCompatible | ProviderKind::CustomHttpLater => (None, None),
    };

    Ok(NormalizedProviderRequestOptions {
        model,
        temperature: input.temperature.or(defaults.temperature),
        top_p,
        max_output_tokens,
        max_context_tokens,
        num_predict,
        num_ctx,
        think,
        stream,
        warnings,
    })
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ollama_localhost_profile_passes_validation() {
        let profile = ProviderProfileConfig::default_ollama(
            "qwen3.5:9b".to_string(),
            "http://127.0.0.1:11434".to_string(),
        );
        validate_provider_profiles(&[profile]).expect("valid profile");
    }

    #[test]
    fn ollama_remote_profile_is_blocked_unless_explicitly_allowed() {
        let mut profile = ProviderProfileConfig::default_ollama(
            "qwen3.5:9b".to_string(),
            "http://192.168.1.20:11434".to_string(),
        );
        assert!(validate_provider_profiles(&[profile.clone()]).is_err());

        profile.security.allow_remote_endpoint = true;
        profile.security.allow_insecure_http_remote = true;
        validate_provider_profiles(&[profile]).expect("explicit remote profile allowed");
    }

    #[test]
    fn request_normalization_maps_ollama_budgets_and_quick_ask_think_false() {
        let mut profile = ProviderProfileConfig::default_ollama(
            "qwen3.5:9b".to_string(),
            "http://127.0.0.1:11434".to_string(),
        );
        profile.request_defaults.think = Some(true);
        let normalized = normalize_provider_request_options(
            &profile,
            ProviderRequestNormalizationInput {
                model: None,
                output_budget: Some(900),
                context_budget: Some(4096),
                temperature: Some(0.1),
                top_p: Some(0.9),
                think: Some(true),
                stream: None,
                quick_ask: true,
            },
        )
        .expect("normalize");

        assert_eq!(normalized.model, "qwen3.5:9b");
        assert_eq!(normalized.num_predict, Some(900));
        assert_eq!(normalized.num_ctx, Some(4096));
        assert_eq!(normalized.think, Some(false));
        assert!(normalized
            .warnings
            .contains(&"quick_ask_forced_think_false".to_string()));
        assert!(normalized
            .warnings
            .contains(&"top_p_not_mapped_for_ollama".to_string()));
    }

    #[test]
    fn provider_change_classifies_endpoint_reconnect_and_security_restart() {
        let current = ProviderProfileConfig::default_ollama(
            "qwen3.5:9b".to_string(),
            "http://127.0.0.1:11434".to_string(),
        );
        let mut endpoint = current.clone();
        endpoint.base_url = Some("http://127.0.0.1:11500".to_string());
        assert_eq!(
            classify_provider_config_change(&current, &endpoint),
            ProviderConfigChangeClassification::ProviderReconnectRequired
        );

        let mut security = current.clone();
        security.security.allow_remote_endpoint = true;
        assert_eq!(
            classify_provider_config_change(&current, &security),
            ProviderConfigChangeClassification::ServiceRestartRequired
        );
    }

    #[test]
    fn provider_metadata_rejects_secret_and_raw_thinking_keys() {
        let mut profile = ProviderProfileConfig::default_ollama(
            "qwen3.5:9b".to_string(),
            "http://127.0.0.1:11434".to_string(),
        );
        profile.metadata_json = Some(serde_json::json!({ "apiKey": "hidden" }));
        assert!(validate_provider_profiles(&[profile]).is_err());
    }
}
