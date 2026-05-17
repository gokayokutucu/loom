use crate::{error::ServiceError, providers::config::reject_forbidden_config_value};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const DEFAULT_MAX_AUDIO_BYTES: u64 = 10 * 1024 * 1024;
pub const DEFAULT_LOCAL_COMMAND_TIMEOUT_MS: u64 = 120_000;
pub const DEFAULT_LOCAL_COMMAND_TRANSCRIPT_FILE_EXTENSION: &str = "txt";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpeechToTextProviderKind {
    Disabled,
    BrowserLater,
    LocalLater,
    LocalCommand,
    OpenAiCompatibleLater,
    MockTest,
}

impl SpeechToTextProviderKind {
    pub fn as_config_str(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::BrowserLater => "browser_later",
            Self::LocalLater => "local_later",
            Self::LocalCommand => "local_command",
            Self::OpenAiCompatibleLater => "openai_compatible_later",
            Self::MockTest => "mock_test",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "disabled" => Some(Self::Disabled),
            "browser_later" => Some(Self::BrowserLater),
            "local_later" => Some(Self::LocalLater),
            "local_command" => Some(Self::LocalCommand),
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
    pub local_command_path: Option<String>,
    pub local_command_args: Vec<String>,
    pub local_command_timeout_ms: u64,
    pub local_temp_dir: Option<String>,
    #[serde(default)]
    pub local_command_output_mode: LocalCommandOutputMode,
    #[serde(default = "default_local_command_transcript_file_extension")]
    pub local_command_transcript_file_extension: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalCommandOutputMode {
    Stdout,
    File,
}

impl Default for LocalCommandOutputMode {
    fn default() -> Self {
        Self::Stdout
    }
}

fn default_local_command_transcript_file_extension() -> String {
    DEFAULT_LOCAL_COMMAND_TRANSCRIPT_FILE_EXTENSION.to_string()
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
            local_command_path: None,
            local_command_args: vec!["{audio_file}".to_string()],
            local_command_timeout_ms: DEFAULT_LOCAL_COMMAND_TIMEOUT_MS,
            local_temp_dir: None,
            local_command_output_mode: LocalCommandOutputMode::Stdout,
            local_command_transcript_file_extension:
                DEFAULT_LOCAL_COMMAND_TRANSCRIPT_FILE_EXTENSION.to_string(),
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
    pub local_command_path: Option<Option<String>>,
    pub local_command_args: Option<Vec<String>>,
    pub local_command_timeout_ms: Option<u64>,
    pub local_temp_dir: Option<Option<String>>,
    pub local_command_output_mode: Option<LocalCommandOutputMode>,
    pub local_command_transcript_file_extension: Option<String>,
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

#[derive(Debug, Clone)]
pub struct LocalCommandSpeechToTextProvider {
    supported_mime_types: Vec<String>,
    max_audio_bytes: u64,
    command_path: Option<String>,
    command_args: Vec<String>,
    timeout: Duration,
    temp_dir: Option<PathBuf>,
    output_mode: LocalCommandOutputMode,
    transcript_file_extension: String,
}

impl LocalCommandSpeechToTextProvider {
    pub fn from_config(config: &SpeechToTextConfig) -> Self {
        Self {
            supported_mime_types: config.allowed_mime_types.clone(),
            max_audio_bytes: config.max_audio_bytes,
            command_path: config.local_command_path.clone(),
            command_args: config.local_command_args.clone(),
            timeout: Duration::from_millis(config.local_command_timeout_ms),
            temp_dir: config.local_temp_dir.as_ref().map(PathBuf::from),
            output_mode: config.local_command_output_mode.clone(),
            transcript_file_extension: config.local_command_transcript_file_extension.clone(),
        }
    }

    fn configured_command(&self) -> Result<&str, SpeechToTextError> {
        let Some(command) = self
            .command_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return Err(SpeechToTextError::new(
                SpeechToTextErrorKind::ProviderUnavailable,
                "Local speech-to-text provider is not configured.",
            ));
        };
        if command.contains(std::path::MAIN_SEPARATOR) && !Path::new(command).exists() {
            return Err(SpeechToTextError::new(
                SpeechToTextErrorKind::ProviderUnavailable,
                "Local speech-to-text command was not found.",
            ));
        }
        Ok(command)
    }

    fn temp_audio_path(&self, mime_type: &str) -> PathBuf {
        let mut directory = self.temp_dir.clone().unwrap_or_else(std::env::temp_dir);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let extension = audio_extension_for_mime(mime_type);
        directory.push(format!(
            "loom-stt-{}-{timestamp}.{extension}",
            std::process::id()
        ));
        directory
    }

    fn temp_output_base_path(&self) -> PathBuf {
        let mut directory = self.temp_dir.clone().unwrap_or_else(std::env::temp_dir);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        directory.push(format!(
            "loom-stt-transcript-{}-{timestamp}",
            std::process::id()
        ));
        directory
    }

    fn transcript_output_path(&self, output_base_path: &Path) -> PathBuf {
        let extension = self
            .transcript_file_extension
            .trim()
            .trim_start_matches('.')
            .trim();
        if extension.is_empty() {
            return output_base_path.to_path_buf();
        }
        output_base_path.with_extension(extension)
    }

    fn build_args(
        &self,
        audio_path: &Path,
        output_base_path: &Path,
        request: &SpeechToTextProviderRequest,
    ) -> Vec<String> {
        let audio_file = audio_path.to_string_lossy();
        let output_file = output_base_path.to_string_lossy();
        let language = request.language.as_deref().unwrap_or("");
        self.command_args
            .iter()
            .map(|arg| {
                arg.replace("{audio_file}", &audio_file)
                    .replace("{input}", &audio_file)
                    .replace("{output}", &output_file)
                    .replace("{mime_type}", &request.mime_type)
                    .replace("{language}", language)
            })
            .collect()
    }

    fn run_command(
        &self,
        command: &str,
        args: &[String],
        require_stdout: bool,
    ) -> Result<String, SpeechToTextError> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| command_spawn_error(error))?;

        let start = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    if start.elapsed() >= self.timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(SpeechToTextError::new(
                            SpeechToTextErrorKind::TranscriptionFailed,
                            "Local speech-to-text provider timed out.",
                        ));
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => {
                    let _ = child.kill();
                    return Err(SpeechToTextError::new(
                        SpeechToTextErrorKind::TranscriptionFailed,
                        format!("Local speech-to-text provider failed: {error}"),
                    ));
                }
            }
        };

        let mut stdout = String::new();
        if let Some(mut output) = child.stdout.take() {
            output.read_to_string(&mut stdout).map_err(|error| {
                SpeechToTextError::new(
                    SpeechToTextErrorKind::TranscriptionFailed,
                    format!("Failed to read local speech-to-text output: {error}"),
                )
            })?;
        }

        if !status.success() {
            return Err(SpeechToTextError::new(
                SpeechToTextErrorKind::TranscriptionFailed,
                "Local speech-to-text provider failed.",
            ));
        }

        let transcript = stdout.trim().to_string();
        if require_stdout && transcript.is_empty() {
            return Err(SpeechToTextError::new(
                SpeechToTextErrorKind::TranscriptionFailed,
                "Local speech-to-text provider returned an empty transcript.",
            ));
        }
        Ok(transcript)
    }

    fn read_transcript_file(&self, output_base_path: &Path) -> Result<String, SpeechToTextError> {
        let transcript_path = self.transcript_output_path(output_base_path);
        let transcript = fs::read_to_string(&transcript_path).map_err(|error| {
            SpeechToTextError::new(
                SpeechToTextErrorKind::TranscriptionFailed,
                format!("Failed to read local speech-to-text transcript file: {error}"),
            )
        })?;
        let transcript = transcript.trim().to_string();
        if transcript.is_empty() {
            return Err(SpeechToTextError::new(
                SpeechToTextErrorKind::TranscriptionFailed,
                "Local speech-to-text provider returned an empty transcript.",
            ));
        }
        Ok(transcript)
    }

    pub fn health(&self) -> SpeechProviderHealth {
        let provider_kind = SpeechToTextProviderKind::LocalCommand
            .as_config_str()
            .to_string();
        let Some(command) = self
            .command_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return SpeechProviderHealth::unavailable(
                provider_kind,
                "missing_command",
                "Local speech-to-text provider is not configured.",
            );
        };
        if command.contains(std::path::MAIN_SEPARATOR) {
            let command_path = Path::new(command);
            if !command_path.exists() {
                return SpeechProviderHealth::unavailable(
                    provider_kind,
                    "command_not_found",
                    "Local speech-to-text command was not found.",
                );
            }
            if !is_executable(command_path) {
                return SpeechProviderHealth::unavailable(
                    provider_kind,
                    "command_not_executable",
                    "Local speech-to-text command is not executable.",
                );
            }
        }
        if matches!(self.output_mode, LocalCommandOutputMode::File)
            && !self.command_args.iter().any(|arg| arg.contains("{output}"))
        {
            return SpeechProviderHealth::unavailable(
                provider_kind,
                "invalid_args",
                "File output mode requires a {output} argument placeholder.",
            );
        }
        let temp_dir = self.temp_dir.clone().unwrap_or_else(std::env::temp_dir);
        if fs::create_dir_all(&temp_dir).is_err() {
            return SpeechProviderHealth::unavailable(
                provider_kind,
                "temp_dir_unavailable",
                "Local speech-to-text temporary directory is unavailable.",
            );
        }
        let probe = temp_dir.join(format!("loom-stt-health-{}", std::process::id()));
        if fs::write(&probe, b"probe").is_err() {
            return SpeechProviderHealth::unavailable(
                provider_kind,
                "temp_dir_unavailable",
                "Local speech-to-text temporary directory is not writable.",
            );
        }
        let _ = fs::remove_file(probe);
        SpeechProviderHealth {
            status: "configured".to_string(),
            provider_kind,
            message: "Local speech-to-text provider is configured.".to_string(),
            checks: vec![
                "local_command_present".to_string(),
                "temp_dir_writable".to_string(),
                "cloud_stt_disabled".to_string(),
                "audio_not_persisted".to_string(),
                "transcript_not_persisted".to_string(),
            ],
        }
    }
}

impl SpeechToTextProvider for LocalCommandSpeechToTextProvider {
    fn provider_kind(&self) -> SpeechToTextProviderKind {
        SpeechToTextProviderKind::LocalCommand
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
        let command = self.configured_command()?;
        let temp_path = self.temp_audio_path(&request.mime_type);
        let output_base_path = self.temp_output_base_path();
        let transcript_path = self.transcript_output_path(&output_base_path);
        let temp_result = (|| {
            if let Some(parent) = temp_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    SpeechToTextError::new(
                        SpeechToTextErrorKind::ProviderUnavailable,
                        format!("Failed to prepare local speech-to-text temp directory: {error}"),
                    )
                })?;
            }
            fs::write(&temp_path, &request.audio_bytes).map_err(|error| {
                SpeechToTextError::new(
                    SpeechToTextErrorKind::TranscriptionFailed,
                    format!("Failed to write temporary speech audio: {error}"),
                )
            })?;
            let args = self.build_args(&temp_path, &output_base_path, &request);
            match self.output_mode {
                LocalCommandOutputMode::Stdout => self.run_command(command, &args, true),
                LocalCommandOutputMode::File => {
                    self.run_command(command, &args, false)?;
                    self.read_transcript_file(&output_base_path)
                }
            }
        })();
        let cleanup_result = fs::remove_file(&temp_path);
        if let Err(error) = cleanup_result {
            if temp_path.exists() {
                return Err(SpeechToTextError::new(
                    SpeechToTextErrorKind::TranscriptionFailed,
                    format!("Failed to clean up temporary speech audio: {error}"),
                ));
            }
        }
        let transcript_cleanup_result = fs::remove_file(&transcript_path);
        if let Err(error) = transcript_cleanup_result {
            if transcript_path.exists() {
                return Err(SpeechToTextError::new(
                    SpeechToTextErrorKind::TranscriptionFailed,
                    format!("Failed to clean up temporary speech transcript: {error}"),
                ));
            }
        }
        let transcript = temp_result?;
        Ok(SpeechToTextResult {
            transcript,
            language: request.language,
            confidence: None,
            provider: self.provider_kind().as_config_str().to_string(),
            warnings: Vec::new(),
            retention: SpeechRetentionPolicy {
                audio_persisted: false,
                transcript_persisted: false,
            },
        })
    }
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
    if let Some(value) = patch.local_command_path {
        config.local_command_path = value;
    }
    if let Some(value) = patch.local_command_args {
        config.local_command_args = value;
    }
    if let Some(value) = patch.local_command_timeout_ms {
        config.local_command_timeout_ms = value;
    }
    if let Some(value) = patch.local_temp_dir {
        config.local_temp_dir = value;
    }
    if let Some(value) = patch.local_command_output_mode {
        config.local_command_output_mode = value;
    }
    if let Some(value) = patch.local_command_transcript_file_extension {
        config.local_command_transcript_file_extension = value;
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
    if config.local_command_timeout_ms == 0 {
        return Err(ServiceError::config(
            "speech.localCommandTimeoutMs must be positive",
        ));
    }
    if matches!(
        config.local_command_output_mode,
        LocalCommandOutputMode::File
    ) && !config
        .local_command_args
        .iter()
        .any(|arg| arg.contains("{output}"))
    {
        return Err(ServiceError::config(
            "speech.localCommandArgs must include {output} when speech.localCommandOutputMode=file",
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
    if let Some(value) = &config.local_command_path {
        reject_secret_like_string("speech.localCommandPath", value)
            .map_err(ServiceError::config)?;
    }
    if let Some(value) = &config.local_temp_dir {
        reject_secret_like_string("speech.localTempDir", value).map_err(ServiceError::config)?;
    }
    for value in &config.local_command_args {
        reject_secret_like_string("speech.localCommandArgs", value)
            .map_err(ServiceError::config)?;
    }
    reject_secret_like_string(
        "speech.localCommandTranscriptFileExtension",
        &config.local_command_transcript_file_extension,
    )
    .map_err(ServiceError::config)?;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechProviderHealth {
    pub status: String,
    pub provider_kind: String,
    pub message: String,
    pub checks: Vec<String>,
}

impl SpeechProviderHealth {
    fn unavailable(provider_kind: String, status: &str, message: &str) -> Self {
        Self {
            status: status.to_string(),
            provider_kind,
            message: message.to_string(),
            checks: Vec::new(),
        }
    }
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
    if !matches!(
        config.default_provider_kind,
        SpeechToTextProviderKind::MockTest | SpeechToTextProviderKind::LocalCommand
    ) {
        return Err(SpeechToTextError::new(
            SpeechToTextErrorKind::ProviderUnavailable,
            "No real Speech-to-Text provider is configured yet.",
        ));
    }
    validate_request_limits(request, &config.allowed_mime_types, config.max_audio_bytes)?;
    validate_safe_metadata(request.metadata.as_ref())?;
    Ok(())
}

fn command_spawn_error(error: std::io::Error) -> SpeechToTextError {
    if error.kind() == std::io::ErrorKind::NotFound {
        SpeechToTextError::new(
            SpeechToTextErrorKind::ProviderUnavailable,
            "Local speech-to-text command was not found.",
        )
    } else {
        SpeechToTextError::new(
            SpeechToTextErrorKind::ProviderUnavailable,
            format!("Local speech-to-text provider is unavailable: {error}"),
        )
    }
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn audio_extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type.to_ascii_lowercase().as_str() {
        "audio/webm" => "webm",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/mp4" => "mp4",
        "audio/ogg" => "ogg",
        _ => "audio",
    }
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
    use std::path::Path;

    fn enabled_mock_config() -> SpeechToTextConfig {
        SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::MockTest,
            ..SpeechToTextConfig::default()
        }
    }

    fn enabled_local_command_config(command_path: Option<String>) -> SpeechToTextConfig {
        SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::LocalCommand,
            local_command_path: command_path,
            local_command_args: vec!["{audio_file}".to_string()],
            local_command_timeout_ms: 1_000,
            ..SpeechToTextConfig::default()
        }
    }

    fn temp_test_dir(name: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("loom-service-stt-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("temp dir");
        path
    }

    fn count_temp_audio_files(path: &Path) -> usize {
        fs::read_dir(path)
            .expect("read temp dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("loom-stt-"))
            .count()
    }

    fn count_temp_speech_files(path: &Path) -> usize {
        fs::read_dir(path)
            .expect("read temp dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("loom-stt"))
            .count()
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
    fn local_command_provider_missing_binary_returns_provider_unavailable() {
        let config = enabled_local_command_config(Some(
            "/definitely/missing/loom-local-stt-command".to_string(),
        ));
        validate_transcribe_request(
            &config,
            &SpeechToTextProviderRequest {
                audio_bytes: vec![1, 2, 3],
                mime_type: "audio/webm".to_string(),
                language: None,
                provider_profile_id: None,
                metadata: None,
            },
        )
        .expect("local command is accepted by request validation");
        let provider = LocalCommandSpeechToTextProvider::from_config(&config);
        let error = provider
            .transcribe(SpeechToTextProviderRequest {
                audio_bytes: vec![1, 2, 3],
                mime_type: "audio/webm".to_string(),
                language: None,
                provider_profile_id: None,
                metadata: None,
            })
            .expect_err("missing command");
        assert_eq!(error.kind, SpeechToTextErrorKind::ProviderUnavailable);
    }

    #[test]
    fn local_command_provider_cleans_temp_audio_and_does_not_persist_transcript() {
        let temp_dir = temp_test_dir("cleanup");
        let config = SpeechToTextConfig {
            local_temp_dir: Some(temp_dir.to_string_lossy().to_string()),
            ..enabled_local_command_config(Some("/bin/cat".to_string()))
        };
        let provider = LocalCommandSpeechToTextProvider::from_config(&config);
        let result = provider
            .transcribe(SpeechToTextProviderRequest {
                audio_bytes: b"spoken words".to_vec(),
                mime_type: "audio/webm".to_string(),
                language: Some("en".to_string()),
                provider_profile_id: None,
                metadata: Some(json!({"purpose": "preview"})),
            })
            .expect("local command transcript");

        assert_eq!(result.transcript, "spoken words");
        assert_eq!(result.provider, "local_command");
        assert!(!result.retention.audio_persisted);
        assert!(!result.retention.transcript_persisted);
        assert_eq!(count_temp_audio_files(&temp_dir), 0);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn local_command_replaces_input_language_and_output_placeholders() {
        let temp_dir = temp_test_dir("placeholders");
        let config = SpeechToTextConfig {
            local_command_args: vec![
                "-c".to_string(),
                "printf 'input=%s language=%s' \"$1\" \"$2\" > \"$3.txt\"".to_string(),
                "loom-stt-test".to_string(),
                "{input}".to_string(),
                "{language}".to_string(),
                "{output}".to_string(),
            ],
            local_command_output_mode: LocalCommandOutputMode::File,
            local_command_transcript_file_extension: "txt".to_string(),
            local_temp_dir: Some(temp_dir.to_string_lossy().to_string()),
            ..enabled_local_command_config(Some("/bin/sh".to_string()))
        };
        let provider = LocalCommandSpeechToTextProvider::from_config(&config);
        let result = provider
            .transcribe(SpeechToTextProviderRequest {
                audio_bytes: b"audio".to_vec(),
                mime_type: "audio/webm".to_string(),
                language: Some("en".to_string()),
                provider_profile_id: None,
                metadata: None,
            })
            .expect("file transcript");

        assert!(result.transcript.contains("input="));
        assert!(result.transcript.contains("language=en"));
        assert!(!result.transcript.contains("{input}"));
        assert!(!result.transcript.contains("{output}"));
        assert_eq!(count_temp_speech_files(&temp_dir), 0);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn local_command_file_output_mode_reads_transcript_file_and_cleans_it() {
        let temp_dir = temp_test_dir("file-output");
        let config = SpeechToTextConfig {
            local_command_args: vec![
                "-c".to_string(),
                "printf 'real whisper transcript' > \"$1.txt\"".to_string(),
                "loom-stt-test".to_string(),
                "{output}".to_string(),
            ],
            local_command_output_mode: LocalCommandOutputMode::File,
            local_command_transcript_file_extension: "txt".to_string(),
            local_temp_dir: Some(temp_dir.to_string_lossy().to_string()),
            ..enabled_local_command_config(Some("/bin/sh".to_string()))
        };
        let provider = LocalCommandSpeechToTextProvider::from_config(&config);
        let result = provider
            .transcribe(SpeechToTextProviderRequest {
                audio_bytes: b"audio".to_vec(),
                mime_type: "audio/webm".to_string(),
                language: None,
                provider_profile_id: None,
                metadata: None,
            })
            .expect("file transcript");

        assert_eq!(result.transcript, "real whisper transcript");
        assert!(!result.retention.audio_persisted);
        assert!(!result.retention.transcript_persisted);
        assert_eq!(count_temp_speech_files(&temp_dir), 0);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn provider_health_reports_missing_command_and_valid_local_command() {
        let missing =
            LocalCommandSpeechToTextProvider::from_config(&enabled_local_command_config(None));
        assert_eq!(missing.health().status, "missing_command");

        let configured = LocalCommandSpeechToTextProvider::from_config(
            &enabled_local_command_config(Some("/bin/cat".to_string())),
        );
        let health = configured.health();
        assert_eq!(health.status, "configured");
        assert!(health.checks.contains(&"cloud_stt_disabled".to_string()));
        assert!(health.checks.contains(&"audio_not_persisted".to_string()));
    }

    #[test]
    fn provider_health_rejects_file_output_without_output_placeholder() {
        let config = SpeechToTextConfig {
            local_command_output_mode: LocalCommandOutputMode::File,
            local_command_args: vec!["{input}".to_string()],
            ..enabled_local_command_config(Some("/bin/cat".to_string()))
        };
        let provider = LocalCommandSpeechToTextProvider::from_config(&config);
        assert_eq!(provider.health().status, "invalid_args");
    }

    #[cfg(unix)]
    #[test]
    fn provider_health_reports_command_not_executable() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = temp_test_dir("not-executable");
        let command_path = temp_dir.join("not-executable-command");
        fs::write(&command_path, "#!/bin/sh\nprintf nope").expect("write command");
        fs::set_permissions(&command_path, fs::Permissions::from_mode(0o644)).expect("permissions");
        let config = enabled_local_command_config(Some(command_path.to_string_lossy().to_string()));
        let provider = LocalCommandSpeechToTextProvider::from_config(&config);
        assert_eq!(provider.health().status, "command_not_executable");
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn local_command_provider_timeout_maps_to_transcription_failed_and_cleans_temp() {
        let temp_dir = temp_test_dir("timeout");
        let config = SpeechToTextConfig {
            local_command_args: vec!["2".to_string()],
            local_command_timeout_ms: 10,
            local_temp_dir: Some(temp_dir.to_string_lossy().to_string()),
            ..enabled_local_command_config(Some("/bin/sleep".to_string()))
        };
        let provider = LocalCommandSpeechToTextProvider::from_config(&config);
        let error = provider
            .transcribe(SpeechToTextProviderRequest {
                audio_bytes: b"spoken words".to_vec(),
                mime_type: "audio/webm".to_string(),
                language: None,
                provider_profile_id: None,
                metadata: None,
            })
            .expect_err("timeout");

        assert_eq!(error.kind, SpeechToTextErrorKind::TranscriptionFailed);
        assert!(error.message.contains("timed out"));
        assert_eq!(count_temp_audio_files(&temp_dir), 0);
        let _ = fs::remove_dir_all(temp_dir);
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
