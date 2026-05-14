use crate::{error::ServiceError, providers::config::reject_forbidden_config_value};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_MAX_AUDIO_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpeechToTextProviderKind {
    Disabled,
    BrowserLater,
    LocalLater,
    OpenAiCompatibleLater,
    MockTest,
}

impl SpeechToTextProviderKind {
    pub fn as_config_str(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::BrowserLater => "browser_later",
            Self::LocalLater => "local_later",
            Self::OpenAiCompatibleLater => "openai_compatible_later",
            Self::MockTest => "mock_test",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "disabled" => Some(Self::Disabled),
            "browser_later" => Some(Self::BrowserLater),
            "local_later" => Some(Self::LocalLater),
            "openai_compatible_later" => Some(Self::OpenAiCompatibleLater),
            "mock_test" => Some(Self::MockTest),
            _ => None,
        }
    }

    pub fn is_cloud(&self) -> bool {
        matches!(self, Self::OpenAiCompatibleLater)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechToTextConfig {
    pub enabled: bool,
    pub default_provider_kind: SpeechToTextProviderKind,
    pub allow_cloud_stt: bool,
    pub persist_audio: bool,
    pub persist_transcript: bool,
    pub max_audio_bytes: u64,
    pub allowed_mime_types: Vec<String>,
    pub default_language: Option<String>,
    pub provider_profile_id: Option<String>,
    pub warnings: Vec<String>,
}

impl Default for SpeechToTextConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            default_provider_kind: SpeechToTextProviderKind::Disabled,
            allow_cloud_stt: false,
            persist_audio: false,
            persist_transcript: false,
            max_audio_bytes: DEFAULT_MAX_AUDIO_BYTES,
            allowed_mime_types: vec![
                "audio/webm".to_string(),
                "audio/wav".to_string(),
                "audio/mpeg".to_string(),
                "audio/mp4".to_string(),
                "audio/ogg".to_string(),
            ],
            default_language: None,
            provider_profile_id: None,
            warnings: vec!["speech_to_text_ui_deferred".to_string()],
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechToTextPatch {
    pub enabled: Option<bool>,
    pub default_provider_kind: Option<SpeechToTextProviderKind>,
    pub allow_cloud_stt: Option<bool>,
    pub persist_audio: Option<bool>,
    pub persist_transcript: Option<bool>,
    pub max_audio_bytes: Option<u64>,
    pub allowed_mime_types: Option<Vec<String>>,
    pub default_language: Option<Option<String>>,
    pub provider_profile_id: Option<Option<String>>,
    pub warnings: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpeechToTextErrorKind {
    SttDisabled,
    UnsupportedAudioType,
    AudioTooLarge,
    ProviderUnavailable,
    MissingSecret,
    CloudSttDisabled,
    TranscriptionFailed,
    InvalidRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechToTextError {
    pub kind: SpeechToTextErrorKind,
    pub message: String,
    pub warnings: Vec<String>,
}

impl SpeechToTextError {
    pub fn new(kind: SpeechToTextErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            warnings: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechToTextProviderRequest {
    pub audio_bytes: Vec<u8>,
    pub mime_type: String,
    pub language: Option<String>,
    pub provider_profile_id: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRetentionPolicy {
    pub audio_persisted: bool,
    pub transcript_persisted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechToTextResult {
    pub transcript: String,
    pub language: Option<String>,
    pub confidence: Option<f32>,
    pub provider: String,
    pub warnings: Vec<String>,
    pub retention: SpeechRetentionPolicy,
}

#[allow(dead_code)]
pub trait SpeechToTextProvider {
    fn provider_kind(&self) -> SpeechToTextProviderKind;
    fn supported_mime_types(&self) -> &[String];
    fn max_audio_bytes(&self) -> u64;
    fn requires_secret(&self) -> bool;
    fn is_local(&self) -> bool;
    fn transcribe(
        &self,
        request: SpeechToTextProviderRequest,
    ) -> Result<SpeechToTextResult, SpeechToTextError>;
}

#[derive(Debug, Clone)]
pub struct MockSpeechToTextProvider {
    supported_mime_types: Vec<String>,
    max_audio_bytes: u64,
}

impl MockSpeechToTextProvider {
    pub fn from_config(config: &SpeechToTextConfig) -> Self {
        Self {
            supported_mime_types: config.allowed_mime_types.clone(),
            max_audio_bytes: config.max_audio_bytes,
        }
    }
}

impl SpeechToTextProvider for MockSpeechToTextProvider {
    fn provider_kind(&self) -> SpeechToTextProviderKind {
        SpeechToTextProviderKind::MockTest
    }

    fn supported_mime_types(&self) -> &[String] {
        &self.supported_mime_types
    }

    fn max_audio_bytes(&self) -> u64 {
        self.max_audio_bytes
    }

    fn requires_secret(&self) -> bool {
        false
    }

    fn is_local(&self) -> bool {
        true
    }

    fn transcribe(
        &self,
        request: SpeechToTextProviderRequest,
    ) -> Result<SpeechToTextResult, SpeechToTextError> {
        validate_request_limits(
            &request,
            self.supported_mime_types(),
            self.max_audio_bytes(),
        )?;
        validate_safe_metadata(request.metadata.as_ref())?;
        Ok(SpeechToTextResult {
            transcript: "Mock transcription transcript.".to_string(),
            language: request.language,
            confidence: Some(1.0),
            provider: self.provider_kind().as_config_str().to_string(),
            warnings: vec!["mock_stt_provider".to_string()],
            retention: SpeechRetentionPolicy {
                audio_persisted: false,
                transcript_persisted: false,
            },
        })
    }
}

pub fn apply_speech_patch(config: &mut SpeechToTextConfig, patch: SpeechToTextPatch) {
    if let Some(value) = patch.enabled {
        config.enabled = value;
    }
    if let Some(value) = patch.default_provider_kind {
        config.default_provider_kind = value;
    }
    if let Some(value) = patch.allow_cloud_stt {
        config.allow_cloud_stt = value;
    }
    if let Some(value) = patch.persist_audio {
        config.persist_audio = value;
    }
    if let Some(value) = patch.persist_transcript {
        config.persist_transcript = value;
    }
    if let Some(value) = patch.max_audio_bytes {
        config.max_audio_bytes = value;
    }
    if let Some(value) = patch.allowed_mime_types {
        config.allowed_mime_types = value;
    }
    if let Some(value) = patch.default_language {
        config.default_language = value;
    }
    if let Some(value) = patch.provider_profile_id {
        config.provider_profile_id = value;
    }
    if let Some(value) = patch.warnings {
        config.warnings = value;
    }
}

pub fn validate_speech_config(config: &SpeechToTextConfig) -> Result<(), ServiceError> {
    if config.persist_audio {
        return Err(ServiceError::config(
            "speech.persistAudio is disabled until explicit retention controls exist",
        ));
    }
    if config.persist_transcript {
        return Err(ServiceError::config(
            "speech.persistTranscript is disabled; transcripts are user drafts until sent",
        ));
    }
    if config.max_audio_bytes == 0 {
        return Err(ServiceError::config(
            "speech.maxAudioBytes must be positive",
        ));
    }
    if config.allowed_mime_types.is_empty() {
        return Err(ServiceError::config(
            "speech.allowedMimeTypes must include at least one MIME type",
        ));
    }
    for mime_type in &config.allowed_mime_types {
        validate_mime_type(mime_type).map_err(ServiceError::config)?;
    }
    if config.default_provider_kind.is_cloud() && !config.allow_cloud_stt {
        return Err(ServiceError::config(
            "cloud Speech-to-Text requires speech.allowCloudStt=true",
        ));
    }
    if let Some(value) = &config.provider_profile_id {
        reject_secret_like_string("speech.providerProfileId", value)
            .map_err(ServiceError::config)?;
    }
    if let Some(value) = &config.default_language {
        reject_secret_like_string("speech.defaultLanguage", value).map_err(ServiceError::config)?;
    }
    for warning in &config.warnings {
        reject_secret_like_string("speech.warnings", warning).map_err(ServiceError::config)?;
    }
    validate_safe_metadata(Some(&serde_json::to_value(config).map_err(|error| {
        ServiceError::config(format!("failed to inspect speech config: {error}"))
    })?))
    .map_err(|error| ServiceError::config(error.message))?;
    Ok(())
}

pub fn validate_transcribe_request(
    config: &SpeechToTextConfig,
    request: &SpeechToTextProviderRequest,
) -> Result<(), SpeechToTextError> {
    if !config.enabled {
        return Err(SpeechToTextError::new(
            SpeechToTextErrorKind::SttDisabled,
            "Speech-to-Text is disabled.",
        ));
    }
    if config.default_provider_kind.is_cloud() && !config.allow_cloud_stt {
        return Err(SpeechToTextError::new(
            SpeechToTextErrorKind::CloudSttDisabled,
            "Cloud Speech-to-Text is disabled.",
        ));
    }
    if config.default_provider_kind != SpeechToTextProviderKind::MockTest {
        return Err(SpeechToTextError::new(
            SpeechToTextErrorKind::ProviderUnavailable,
            "No real Speech-to-Text provider is configured yet.",
        ));
    }
    validate_request_limits(request, &config.allowed_mime_types, config.max_audio_bytes)?;
    validate_safe_metadata(request.metadata.as_ref())?;
    Ok(())
}

pub fn validate_request_limits(
    request: &SpeechToTextProviderRequest,
    allowed_mime_types: &[String],
    max_audio_bytes: u64,
) -> Result<(), SpeechToTextError> {
    if request.audio_bytes.is_empty() {
        return Err(SpeechToTextError::new(
            SpeechToTextErrorKind::InvalidRequest,
            "Audio payload is required.",
        ));
    }
    if request.audio_bytes.len() as u64 > max_audio_bytes {
        return Err(SpeechToTextError::new(
            SpeechToTextErrorKind::AudioTooLarge,
            "Audio payload exceeds the configured size limit.",
        ));
    }
    if !allowed_mime_types
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&request.mime_type))
    {
        return Err(SpeechToTextError::new(
            SpeechToTextErrorKind::UnsupportedAudioType,
            "Audio MIME type is not supported.",
        ));
    }
    Ok(())
}

pub fn validate_safe_metadata(metadata: Option<&Value>) -> Result<(), SpeechToTextError> {
    if let Some(metadata) = metadata {
        reject_forbidden_config_value(metadata).map_err(|error| {
            SpeechToTextError::new(SpeechToTextErrorKind::InvalidRequest, error.to_string())
        })?;
    }
    Ok(())
}

fn validate_mime_type(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || !trimmed.contains('/') {
        return Err(format!("invalid speech MIME type '{value}'"));
    }
    reject_secret_like_string("speech.allowedMimeTypes", trimmed)
}

fn reject_secret_like_string(path: &str, value: &str) -> Result<(), String> {
    let normalized = value.to_ascii_lowercase();
    for forbidden in [
        "api_key",
        "apikey",
        "bearer",
        "password",
        "refresh_token",
        "raw_thinking",
        "thinking_text",
        "chain_of_thought",
        "hidden_reasoning",
    ] {
        if normalized.contains(forbidden) {
            return Err(format!("{path} must not contain secret/raw-thinking text"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn enabled_mock_config() -> SpeechToTextConfig {
        SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::MockTest,
            ..SpeechToTextConfig::default()
        }
    }

    #[test]
    fn default_stt_config_is_disabled_and_non_persistent() {
        let config = SpeechToTextConfig::default();
        assert!(!config.enabled);
        assert_eq!(
            config.default_provider_kind,
            SpeechToTextProviderKind::Disabled
        );
        assert!(!config.persist_audio);
        assert!(!config.persist_transcript);
        validate_speech_config(&config).expect("default config is safe");
    }

    #[test]
    fn stt_config_rejects_audio_or_transcript_persistence() {
        let mut config = SpeechToTextConfig {
            persist_audio: true,
            ..SpeechToTextConfig::default()
        };
        assert!(validate_speech_config(&config).is_err());

        config.persist_audio = false;
        config.persist_transcript = true;
        assert!(validate_speech_config(&config).is_err());
    }

    #[test]
    fn cloud_stt_is_blocked_without_explicit_opt_in() {
        let config = SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::OpenAiCompatibleLater,
            allow_cloud_stt: false,
            ..SpeechToTextConfig::default()
        };
        let error = validate_speech_config(&config).expect_err("cloud blocked");
        assert!(error.to_string().contains("allowCloudStt"));
    }

    #[test]
    fn request_validation_accepts_allowed_mime_and_rejects_unsupported_or_large_audio() {
        let config = enabled_mock_config();
        let mut request = SpeechToTextProviderRequest {
            audio_bytes: vec![1, 2, 3],
            mime_type: "audio/webm".to_string(),
            language: Some("tr".to_string()),
            provider_profile_id: None,
            metadata: None,
        };
        validate_transcribe_request(&config, &request).expect("allowed mime");

        request.mime_type = "text/plain".to_string();
        assert_eq!(
            validate_transcribe_request(&config, &request)
                .expect_err("unsupported")
                .kind,
            SpeechToTextErrorKind::UnsupportedAudioType
        );

        request.mime_type = "audio/webm".to_string();
        request.audio_bytes = vec![0; (config.max_audio_bytes + 1) as usize];
        assert_eq!(
            validate_transcribe_request(&config, &request)
                .expect_err("too large")
                .kind,
            SpeechToTextErrorKind::AudioTooLarge
        );
    }

    #[test]
    fn mock_provider_returns_transcript_without_persisting_audio_or_transcript() {
        let config = enabled_mock_config();
        let provider = MockSpeechToTextProvider::from_config(&config);
        let result = provider
            .transcribe(SpeechToTextProviderRequest {
                audio_bytes: vec![1, 2, 3],
                mime_type: "audio/webm".to_string(),
                language: Some("tr".to_string()),
                provider_profile_id: None,
                metadata: Some(json!({"purpose": "preview"})),
            })
            .expect("mock transcript");

        assert_eq!(result.transcript, "Mock transcription transcript.");
        assert_eq!(result.language.as_deref(), Some("tr"));
        assert!(!result.retention.audio_persisted);
        assert!(!result.retention.transcript_persisted);
    }

    #[test]
    fn metadata_rejects_raw_thinking_and_secret_like_keys() {
        let config = enabled_mock_config();
        let request = SpeechToTextProviderRequest {
            audio_bytes: vec![1],
            mime_type: "audio/webm".to_string(),
            language: None,
            provider_profile_id: None,
            metadata: Some(json!({"raw_thinking": "never"})),
        };
        let error = validate_transcribe_request(&config, &request).expect_err("metadata rejected");
        assert_eq!(error.kind, SpeechToTextErrorKind::InvalidRequest);

        let mut unsafe_config = SpeechToTextConfig::default();
        unsafe_config.provider_profile_id = Some("api_key_in_profile".to_string());
        assert!(validate_speech_config(&unsafe_config).is_err());
    }
}
