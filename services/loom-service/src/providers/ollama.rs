use crate::{
    config::OllamaConfig,
    providers::types::{
        classify_http_failure, OllamaChatRequest, OllamaHealthResponse, OllamaModelsResponse,
        OllamaRuntimeError, OllamaRuntimeErrorKind, OllamaSecurityResponse, OllamaTagsResponse,
        OllamaVersionResponse,
    },
};
use reqwest::{Client, Response};
use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::watch;
use tokio::time::timeout;

#[derive(Debug, Clone)]
pub struct OllamaRuntime {
    client: Option<Client>,
    config: OllamaConfig,
    cancellations: CancellationRegistry,
    init_error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct CancellationRegistry {
    senders: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl OllamaRuntime {
    pub fn new(config: OllamaConfig) -> Self {
        let security = assess_base_url_security(&config);
        let client_result = reqwest::Url::parse(&config.base_url)
            .map_err(|error| format!("invalid Ollama base URL: {error}"))
            .and_then(|url| {
                if let Some(reason) = security.block_reason.clone() {
                    Err(reason)
                } else {
                    Ok(url)
                }
            })
            .and_then(|_| {
                Client::builder()
                    .no_proxy()
                    .timeout(config.request_timeout)
                    .build()
                    .map_err(|error| format!("failed to build Ollama HTTP client: {error}"))
            });
        let (client, init_error) = match client_result {
            Ok(client) => (Some(client), None),
            Err(error) => (None, Some(error)),
        };

        Self {
            client,
            config,
            cancellations: CancellationRegistry::default(),
            init_error,
        }
    }

    pub fn config(&self) -> &OllamaConfig {
        &self.config
    }

    pub async fn health(&self) -> OllamaHealthResponse {
        let base_security = assess_base_url_security(&self.config);
        let Some(client) = self.client.as_ref() else {
            let version_status = if base_security.network_exposure_risk == "high"
                && base_security
                    .warnings
                    .iter()
                    .any(|warning| warning.contains("Remote Ollama"))
            {
                "remote_unsafe"
            } else {
                "unavailable"
            };
            return OllamaHealthResponse {
                status: "invalid_config".to_string(),
                base_url: self.config.base_url.clone(),
                version: None,
                models_endpoint_reachable: false,
                reason: self.init_error.clone(),
                security: base_security.to_response(version_status, None),
            };
        };

        let version_probe = timeout(
            Duration::from_secs(2),
            client.get(self.version_url()).send(),
        )
        .await
        .ok()
        .and_then(Result::ok);
        let version = match version_probe {
            Some(response) if response.status().is_success() => response
                .json::<OllamaVersionResponse>()
                .await
                .ok()
                .and_then(|payload| payload.version),
            Some(_) => None,
            None => None,
        };
        let version_status = version_security_status(
            version.as_deref(),
            &self.config.security.minimum_recommended_ollama_version,
        );

        let models_reachable = timeout(Duration::from_secs(2), client.get(self.tags_url()).send())
            .await
            .ok()
            .and_then(Result::ok)
            .is_some_and(|response| {
                response.status().is_success() || response.status().as_u16() == 404
            });
        let status = if !models_reachable {
            "unavailable"
        } else if base_security.high_risk || version_status != "ok" {
            "degraded"
        } else {
            "ready"
        };

        OllamaHealthResponse {
            status: status.to_string(),
            base_url: self.config.base_url.clone(),
            version,
            models_endpoint_reachable: models_reachable,
            reason: (!models_reachable).then(|| "runtime_unavailable".to_string()),
            security: base_security.to_response(version_status, None),
        }
    }

    pub async fn models(&self) -> Result<OllamaModelsResponse, OllamaRuntimeError> {
        let client = self.client()?;
        let response = client.get(self.tags_url()).send().await.map_err(|error| {
            if error.is_connect() || error.is_timeout() {
                OllamaRuntimeError::new(
                    OllamaRuntimeErrorKind::RuntimeUnavailable,
                    "Ollama is not reachable.",
                    true,
                )
            } else {
                OllamaRuntimeError::new(
                    OllamaRuntimeErrorKind::UnexpectedResponse,
                    "Ollama returned an unexpected response.",
                    true,
                )
            }
        })?;

        let status = response.status();
        if !status.is_success() {
            return Err(OllamaRuntimeError::new(
                classify_http_failure(status.as_u16(), ""),
                "Ollama models endpoint failed.",
                true,
            )
            .with_status(status.as_u16()));
        }

        let tags = response.json::<OllamaTagsResponse>().await.map_err(|_| {
            OllamaRuntimeError::new(
                OllamaRuntimeErrorKind::UnexpectedResponse,
                "Ollama returned malformed model metadata.",
                true,
            )
        })?;

        Ok(OllamaModelsResponse {
            models: tags.models.into_iter().map(|model| model.name).collect(),
        })
    }

    pub async fn post_chat(
        &self,
        input: &OllamaChatRequest,
    ) -> Result<Response, OllamaRuntimeError> {
        let client = self.client()?;
        let mut body = serde_json::json!({
            "model": input.model,
            "messages": input.messages,
            "stream": true,
            "options": input.options.clone().unwrap_or_default()
        });

        if let Some(think) = input.think {
            body["think"] = serde_json::json!(think);
        }

        let response = client
            .post(self.chat_url())
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                if error.is_connect() {
                    OllamaRuntimeError::new(
                        OllamaRuntimeErrorKind::RuntimeUnavailable,
                        "Ollama is not reachable.",
                        true,
                    )
                } else if error.is_timeout() {
                    OllamaRuntimeError::new(
                        OllamaRuntimeErrorKind::TimeoutBeforeFirstChunk,
                        "The model did not start responding in time.",
                        true,
                    )
                } else {
                    OllamaRuntimeError::new(
                        OllamaRuntimeErrorKind::UnexpectedResponse,
                        "Ollama returned an unexpected response.",
                        true,
                    )
                }
            })?;

        let status = response.status();
        if !status.is_success() {
            let body_preview = response.text().await.unwrap_or_default();
            let preview = safe_preview(&body_preview);
            let kind = classify_http_failure(status.as_u16(), &preview);
            return Err(
                OllamaRuntimeError::new(kind, "Ollama rejected the chat request.", true)
                    .with_status(status.as_u16()),
            );
        }

        Ok(response)
    }

    pub fn register_cancellation(&self, request_id: &str) -> watch::Receiver<bool> {
        self.cancellations.register(request_id)
    }

    pub fn finish_request(&self, request_id: &str) {
        self.cancellations.remove(request_id);
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        self.cancellations.cancel(request_id)
    }

    fn tags_url(&self) -> String {
        format!("{}/api/tags", self.config.base_url)
    }

    fn chat_url(&self) -> String {
        format!("{}/api/chat", self.config.base_url)
    }

    fn version_url(&self) -> String {
        format!("{}/api/version", self.config.base_url)
    }

    fn client(&self) -> Result<&Client, OllamaRuntimeError> {
        self.client.as_ref().ok_or_else(|| {
            OllamaRuntimeError::new(
                OllamaRuntimeErrorKind::InvalidConfig,
                self.init_error
                    .clone()
                    .unwrap_or_else(|| "Ollama runtime is not configured.".to_string()),
                false,
            )
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BaseUrlSecurityAssessment {
    local_only: bool,
    remote_allowed: bool,
    network_exposure_risk: String,
    high_risk: bool,
    minimum_recommended_version: String,
    block_reason: Option<String>,
    warnings: Vec<String>,
}

impl BaseUrlSecurityAssessment {
    fn to_response(
        &self,
        version_status: impl Into<String>,
        extra_warning: Option<String>,
    ) -> OllamaSecurityResponse {
        let mut warnings = self.warnings.clone();
        let version_status = version_status.into();
        if version_status == "vulnerable" {
            warnings
                .push("Ollama version may be vulnerable. Update to 0.17.1 or newer.".to_string());
        } else if version_status == "unknown" {
            warnings.push("Ollama version could not be verified. Use 0.17.1 or newer.".to_string());
        } else if version_status == "unavailable" {
            warnings.push(
                "Ollama version is unavailable because the runtime is not reachable.".to_string(),
            );
        }
        if cfg!(target_os = "windows") {
            warnings.push("Windows Ollama updater vulnerabilities have been reported. Use a current trusted Ollama release and do not expose Ollama to a network.".to_string());
        }
        if let Some(extra_warning) = extra_warning {
            warnings.push(extra_warning);
        }
        OllamaSecurityResponse {
            local_only: self.local_only,
            remote_allowed: self.remote_allowed,
            network_exposure_risk: self.network_exposure_risk.clone(),
            version_status,
            minimum_recommended_version: self.minimum_recommended_version.clone(),
            warnings,
        }
    }
}

fn assess_base_url_security(config: &OllamaConfig) -> BaseUrlSecurityAssessment {
    let remote_allowed = config.security.allow_remote_ollama;
    let local_only = config.security.enforce_local_ollama && !remote_allowed;
    let mut warnings = Vec::new();
    let parsed = match reqwest::Url::parse(&config.base_url) {
        Ok(url) => url,
        Err(error) => {
            return BaseUrlSecurityAssessment {
                local_only,
                remote_allowed,
                network_exposure_risk: "unknown".to_string(),
                high_risk: true,
                minimum_recommended_version: config
                    .security
                    .minimum_recommended_ollama_version
                    .clone(),
                block_reason: Some(format!("invalid Ollama base URL: {error}")),
                warnings: vec!["Ollama base URL is invalid.".to_string()],
            };
        }
    };

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return BaseUrlSecurityAssessment {
            local_only,
            remote_allowed,
            network_exposure_risk: "unknown".to_string(),
            high_risk: true,
            minimum_recommended_version: config.security.minimum_recommended_ollama_version.clone(),
            block_reason: Some("Ollama base URL must use http or https.".to_string()),
            warnings: vec!["Ollama base URL must use http or https.".to_string()],
        };
    }

    let Some(host) = parsed.host_str() else {
        return BaseUrlSecurityAssessment {
            local_only,
            remote_allowed,
            network_exposure_risk: "unknown".to_string(),
            high_risk: true,
            minimum_recommended_version: config.security.minimum_recommended_ollama_version.clone(),
            block_reason: Some("Ollama base URL must include a host.".to_string()),
            warnings: vec!["Ollama base URL must include a host.".to_string()],
        };
    };

    let host = host.trim_start_matches('[').trim_end_matches(']');

    if host.eq_ignore_ascii_case("localhost") {
        return BaseUrlSecurityAssessment {
            local_only,
            remote_allowed,
            network_exposure_risk: "low".to_string(),
            high_risk: false,
            minimum_recommended_version: config.security.minimum_recommended_ollama_version.clone(),
            block_reason: None,
            warnings,
        };
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if ip.is_loopback() {
            return BaseUrlSecurityAssessment {
                local_only,
                remote_allowed,
                network_exposure_risk: "low".to_string(),
                high_risk: false,
                minimum_recommended_version: config
                    .security
                    .minimum_recommended_ollama_version
                    .clone(),
                block_reason: None,
                warnings,
            };
        }
        if ip.is_unspecified() {
            return BaseUrlSecurityAssessment {
                local_only,
                remote_allowed,
                network_exposure_risk: "high".to_string(),
                high_risk: true,
                minimum_recommended_version: config
                    .security
                    .minimum_recommended_ollama_version
                    .clone(),
                block_reason: Some("0.0.0.0 is not a safe Ollama client target.".to_string()),
                warnings: vec!["0.0.0.0 is not a safe Ollama client target.".to_string()],
            };
        }
    }

    let message = if remote_allowed {
        None
    } else {
        Some("Remote Ollama URLs are disabled by default. Use a loopback base URL or explicitly allow remote Ollama.".to_string())
    };
    if remote_allowed {
        warnings.push(
            "Remote Ollama URL is explicitly allowed. Do not expose Ollama to untrusted networks."
                .to_string(),
        );
    } else {
        warnings.push("Remote Ollama URL is not allowed by default.".to_string());
    }
    BaseUrlSecurityAssessment {
        local_only,
        remote_allowed,
        network_exposure_risk: "high".to_string(),
        high_risk: true,
        minimum_recommended_version: config.security.minimum_recommended_ollama_version.clone(),
        block_reason: message,
        warnings,
    }
}

fn version_security_status(version: Option<&str>, minimum: &str) -> &'static str {
    let Some(version) = version else {
        return "unavailable";
    };
    match compare_versions(version, minimum) {
        Some(std::cmp::Ordering::Less) => "vulnerable",
        Some(_) => "ok",
        None => "unknown",
    }
}

fn compare_versions(left: &str, right: &str) -> Option<std::cmp::Ordering> {
    let left = parse_semver_triplet(left)?;
    let right = parse_semver_triplet(right)?;
    Some(left.cmp(&right))
}

fn parse_semver_triplet(value: &str) -> Option<(u64, u64, u64)> {
    let trimmed = value.trim().trim_start_matches('v');
    let version = trimmed.split(['-', '+']).next().unwrap_or(trimmed);
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

impl CancellationRegistry {
    fn register(&self, request_id: &str) -> watch::Receiver<bool> {
        let (sender, receiver) = watch::channel(false);
        let mut senders = self.senders.lock().expect("cancellation registry lock");
        senders.insert(request_id.to_string(), sender);
        receiver
    }

    fn cancel(&self, request_id: &str) -> bool {
        let senders = self.senders.lock().expect("cancellation registry lock");
        senders
            .get(request_id)
            .map(|sender| sender.send(true).is_ok())
            .unwrap_or(false)
    }

    fn remove(&self, request_id: &str) {
        let mut senders = self.senders.lock().expect("cancellation registry lock");
        senders.remove(request_id);
    }
}

fn safe_preview(body: &str) -> String {
    body.chars().take(240).collect()
}

#[cfg(test)]
mod tests {
    use super::{assess_base_url_security, version_security_status, OllamaRuntime};
    use crate::{config::OllamaConfig, providers::types::OllamaRuntimeErrorKind};
    use std::time::Duration;

    fn test_config(base_url: &str) -> OllamaConfig {
        OllamaConfig {
            base_url: base_url.to_string(),
            request_timeout: Duration::from_millis(200),
            first_chunk_timeout: Duration::from_millis(200),
            stream_idle_timeout: Duration::from_millis(200),
            security: Default::default(),
        }
    }

    #[test]
    fn localhost_and_loopback_ollama_urls_are_allowed() {
        for base_url in [
            "http://localhost:11434",
            "http://127.0.0.1:11434",
            "http://[::1]:11434",
        ] {
            let assessment = assess_base_url_security(&test_config(base_url));
            assert_eq!(assessment.network_exposure_risk, "low");
            assert!(assessment.block_reason.is_none());
        }
    }

    #[test]
    fn unspecified_and_remote_ollama_urls_are_blocked_by_default() {
        for base_url in [
            "http://0.0.0.0:11434",
            "http://192.168.1.10:11434",
            "http://203.0.113.10:11434",
            "http://ollama.example.test:11434",
        ] {
            let assessment = assess_base_url_security(&test_config(base_url));
            assert_eq!(assessment.network_exposure_risk, "high");
            assert!(
                assessment.block_reason.is_some(),
                "{base_url} should be blocked"
            );
        }
    }

    #[test]
    fn explicit_remote_ollama_override_warns_but_allows_client() {
        let mut config = test_config("http://192.168.1.10:11434");
        config.security.allow_remote_ollama = true;
        let assessment = assess_base_url_security(&config);

        assert_eq!(assessment.network_exposure_risk, "high");
        assert!(assessment.block_reason.is_none());
        assert!(assessment
            .warnings
            .iter()
            .any(|warning| warning.contains("explicitly allowed")));
    }

    #[test]
    fn ollama_version_security_status_uses_minimum_recommended_version() {
        assert_eq!(version_security_status(Some("0.17.1"), "0.17.1"), "ok");
        assert_eq!(version_security_status(Some("0.18.0"), "0.17.1"), "ok");
        assert_eq!(
            version_security_status(Some("0.16.9"), "0.17.1"),
            "vulnerable"
        );
        assert_eq!(
            version_security_status(Some("not-semver"), "0.17.1"),
            "unknown"
        );
        assert_eq!(version_security_status(None, "0.17.1"), "unavailable");
    }

    #[tokio::test]
    async fn runtime_initializes_with_unreachable_ollama_url() {
        let runtime = OllamaRuntime::new(test_config("http://127.0.0.1:9"));

        let health = runtime.health().await;

        assert_eq!(health.status, "unavailable");
        assert_eq!(health.reason.as_deref(), Some("runtime_unavailable"));
        assert_eq!(health.security.network_exposure_risk, "low");
    }

    #[test]
    fn health_security_response_marks_version_states_without_raw_details() {
        let assessment = assess_base_url_security(&test_config("http://127.0.0.1:11434"));
        let ok = assessment.to_response("ok", None);
        let vulnerable = assessment.to_response("vulnerable", None);
        let unknown = assessment.to_response("unknown", None);

        assert_eq!(ok.version_status, "ok");
        assert_eq!(vulnerable.version_status, "vulnerable");
        assert_eq!(unknown.version_status, "unknown");
        assert!(vulnerable
            .warnings
            .iter()
            .any(|warning| warning.contains("Update to 0.17.1 or newer")));
        let serialized = serde_json::to_string(&vulnerable).expect("security json");
        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("chain_of_thought"));
    }

    #[tokio::test]
    async fn runtime_handles_invalid_ollama_url_without_panic() {
        let runtime = OllamaRuntime::new(test_config("not a valid url"));

        let health = runtime.health().await;
        let models_error = runtime.models().await.expect_err("invalid config error");

        assert_eq!(health.status, "invalid_config");
        assert_eq!(health.security.version_status, "unavailable");
        assert_eq!(models_error.kind, OllamaRuntimeErrorKind::InvalidConfig);
    }

    #[tokio::test]
    async fn runtime_blocks_remote_ollama_url_by_default_without_panic() {
        let runtime = OllamaRuntime::new(test_config("http://203.0.113.10:11434"));

        let health = runtime.health().await;
        let models_error = runtime.models().await.expect_err("remote config error");

        assert_eq!(health.status, "invalid_config");
        assert_eq!(health.security.network_exposure_risk, "high");
        assert_eq!(health.security.version_status, "remote_unsafe");
        assert_eq!(models_error.kind, OllamaRuntimeErrorKind::InvalidConfig);
    }

    #[tokio::test]
    async fn provider_errors_do_not_contain_raw_thinking_fields() {
        let runtime = OllamaRuntime::new(test_config("not a valid url"));
        let health = runtime.health().await;
        let health_json = serde_json::to_string(&health).expect("health json");
        let error = runtime.models().await.expect_err("invalid config error");
        let error_text = format!("{:?} {}", error.kind, error.message);
        let combined = format!("{health_json}\n{error_text}");

        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(!combined.contains(forbidden));
        }
    }
}
