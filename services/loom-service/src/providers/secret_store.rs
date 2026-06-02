use crate::error::ServiceError;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fmt,
    sync::{Arc, RwLock},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecretStatusKind {
    Saved,
    Missing,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub secret_ref: String,
    pub present: bool,
    pub status: SecretStatusKind,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ResolvedSecret {
    value: String,
}

impl ResolvedSecret {
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
        }
    }

    #[allow(dead_code)]
    pub fn expose_for_provider_runtime(&self) -> &str {
        &self.value
    }
}

impl fmt::Debug for ResolvedSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ResolvedSecret")
            .field("value", &"<redacted>")
            .finish()
    }
}

pub trait SecretStore: Clone + Send + Sync + 'static {
    fn set_secret(&self, secret_ref: &str, value: &str) -> Result<SecretStatus, ServiceError>;
    fn delete_secret(&self, secret_ref: &str) -> Result<SecretStatus, ServiceError>;
    fn has_secret(&self, secret_ref: &str) -> Result<bool, ServiceError>;
    fn status(&self, secret_ref: &str) -> Result<SecretStatus, ServiceError>;
    fn resolve_secret(&self, secret_ref: &str) -> Result<Option<ResolvedSecret>, ServiceError>;
}

#[derive(Debug, Clone, Default)]
pub struct ProviderSecretStore {
    memory: Arc<RwLock<HashMap<String, String>>>,
}

impl SecretStore for ProviderSecretStore {
    fn set_secret(&self, secret_ref: &str, value: &str) -> Result<SecretStatus, ServiceError> {
        validate_secret_ref(secret_ref)?;
        if secret_ref_kind(secret_ref)? == SecretRefKind::Env {
            return Err(ServiceError::config(
                "env secret refs are read-only and cannot be set through the service API",
            ));
        }
        if value.trim().is_empty() {
            return Err(ServiceError::config(
                "provider secret value must not be empty",
            ));
        }
        self.memory
            .write()
            .map_err(|_| ServiceError::config("provider secret store is unavailable"))?
            .insert(secret_ref.to_string(), value.to_string());
        self.status(secret_ref)
    }

    fn delete_secret(&self, secret_ref: &str) -> Result<SecretStatus, ServiceError> {
        validate_secret_ref(secret_ref)?;
        if secret_ref_kind(secret_ref)? == SecretRefKind::Provider {
            let _ = self
                .memory
                .write()
                .map_err(|_| ServiceError::config("provider secret store is unavailable"))?
                .remove(secret_ref);
        }
        self.status(secret_ref)
    }

    fn has_secret(&self, secret_ref: &str) -> Result<bool, ServiceError> {
        Ok(self.resolve_secret(secret_ref)?.is_some())
    }

    fn status(&self, secret_ref: &str) -> Result<SecretStatus, ServiceError> {
        validate_secret_ref(secret_ref)?;
        let present = self.has_secret(secret_ref)?;
        Ok(SecretStatus {
            secret_ref: secret_ref.to_string(),
            present,
            status: if present {
                SecretStatusKind::Saved
            } else {
                SecretStatusKind::Missing
            },
        })
    }

    fn resolve_secret(&self, secret_ref: &str) -> Result<Option<ResolvedSecret>, ServiceError> {
        validate_secret_ref(secret_ref)?;
        match secret_ref_kind(secret_ref)? {
            SecretRefKind::Provider => Ok(self
                .memory
                .read()
                .map_err(|_| ServiceError::config("provider secret store is unavailable"))?
                .get(secret_ref)
                .filter(|value| !value.trim().is_empty())
                .cloned()
                .map(ResolvedSecret::new)),
            SecretRefKind::Env => {
                let name = secret_ref
                    .strip_prefix("env:")
                    .expect("validated env secret ref");
                Ok(env::var(name)
                    .ok()
                    .filter(|value| !value.trim().is_empty())
                    .map(ResolvedSecret::new))
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SecretRefKind {
    Provider,
    Env,
}

fn secret_ref_kind(secret_ref: &str) -> Result<SecretRefKind, ServiceError> {
    if secret_ref.starts_with("provider:") {
        Ok(SecretRefKind::Provider)
    } else if secret_ref.starts_with("env:") {
        Ok(SecretRefKind::Env)
    } else {
        Err(ServiceError::config(
            "provider secretRef must start with provider: or env:",
        ))
    }
}

pub fn default_provider_secret_ref(profile_id: &str) -> String {
    format!("provider:{profile_id}:apiKey")
}

pub fn validate_secret_ref(secret_ref: &str) -> Result<(), ServiceError> {
    let trimmed = secret_ref.trim();
    if trimmed != secret_ref || trimmed.is_empty() {
        return Err(ServiceError::config(
            "provider secretRef must be non-empty and trimmed",
        ));
    }
    if let Some(rest) = trimmed.strip_prefix("provider:") {
        let parts = rest.split(':').collect::<Vec<_>>();
        if parts.len() != 2 || parts[0].trim().is_empty() || parts[1] != "apiKey" {
            return Err(ServiceError::config(
                "provider secretRef must use provider:<profileId>:apiKey",
            ));
        }
        return Ok(());
    }
    if let Some(name) = trimmed.strip_prefix("env:") {
        if name.is_empty()
            || !name
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
        {
            return Err(ServiceError::config(
                "env secretRef must use an uppercase environment variable name",
            ));
        }
        return Ok(());
    }
    Err(ServiceError::config(
        "provider secretRef must start with provider: or env:",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_secret_store_set_delete_and_has_never_exposes_debug_value() {
        let store = ProviderSecretStore::default();
        let secret_ref = default_provider_secret_ref("openai-local");

        let saved = store
            .set_secret(&secret_ref, "sk-secret-provider")
            .expect("set secret");
        assert!(saved.present);
        assert!(store.has_secret(&secret_ref).expect("has secret"));
        assert!(!format!("{:?}", store.resolve_secret(&secret_ref)).contains("sk-secret"));

        let deleted = store.delete_secret(&secret_ref).expect("delete secret");
        assert!(!deleted.present);
        assert!(!store.has_secret(&secret_ref).expect("missing secret"));
    }

    #[test]
    fn env_secret_ref_resolves_without_persisting_value() {
        let store = ProviderSecretStore::default();
        std::env::set_var("LOOM_TEST_PROVIDER_SECRET_REF", "sk-env-secret");

        let resolved = store
            .resolve_secret("env:LOOM_TEST_PROVIDER_SECRET_REF")
            .expect("resolve env")
            .expect("env present");

        assert_eq!(resolved.expose_for_provider_runtime(), "sk-env-secret");
        assert!(!format!("{resolved:?}").contains("sk-env-secret"));
        assert!(
            store
                .status("env:LOOM_TEST_PROVIDER_SECRET_REF")
                .expect("status")
                .present
        );

        std::env::remove_var("LOOM_TEST_PROVIDER_SECRET_REF");
    }

    #[test]
    fn missing_env_secret_returns_missing_status_safely() {
        let store = ProviderSecretStore::default();
        std::env::remove_var("LOOM_TEST_MISSING_PROVIDER_SECRET_REF");

        let status = store
            .status("env:LOOM_TEST_MISSING_PROVIDER_SECRET_REF")
            .expect("status");

        assert!(!status.present);
        assert_eq!(status.status, SecretStatusKind::Missing);
    }

    #[test]
    fn invalid_secret_refs_are_rejected() {
        for secret_ref in [
            "",
            "api_key:secret",
            "provider:only-id",
            "env:openai_api_key",
        ] {
            assert!(validate_secret_ref(secret_ref).is_err());
        }
    }
}
