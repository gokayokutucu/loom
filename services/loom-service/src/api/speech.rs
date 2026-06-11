use crate::{
    api::state::AppState,
    config::ConfigPatch,
    speech::{
        audio_extension_for_mime, normalized_mime_type, validate_transcribe_request,
        LocalCommandOutputMode, LocalCommandSpeechToTextProvider, MockSpeechToTextProvider,
        SpeechProviderHealth, SpeechToTextError, SpeechToTextErrorKind, SpeechToTextPatch,
        SpeechToTextProvider, SpeechToTextProviderKind, SpeechToTextProviderRequest,
        SpeechToTextResult,
    },
};
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

const DEFAULT_WHISPER_MODEL_NAME: &str = "ggml-base.bin";
const DEFAULT_WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const INSTALL_SPEECH_ENGINE_MESSAGE: &str = "Install the Loom local speech engine from Settings.";
const WHISPER_BINARY_NAMES: &[&str] = &["whisper-cli", "whisper-cpp", "whisper", "main"];
const WHISPER_SYSTEM_CANDIDATES: &[&str] = &[
    "/opt/homebrew/bin/whisper-cli",
    "/opt/homebrew/bin/whisper-cpp",
    "/usr/local/bin/whisper-cli",
    "/usr/local/bin/whisper-cpp",
];
pub(crate) const SPEECH_TRANSCRIBE_HTTP_BODY_LIMIT_BYTES: usize = 48 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTranscribeRequest {
    pub audio_bytes: Vec<u8>,
    pub mime_type: String,
    pub language: Option<String>,
    pub provider_profile_id: Option<String>,
    pub mode: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTranscribeErrorPayload {
    pub kind: SpeechToTextErrorKind,
    pub code: String,
    pub message: String,
    pub warnings: Vec<String>,
    pub diagnostics: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSetupBinaryCandidate {
    pub path: String,
    pub exists: bool,
    pub executable: bool,
    pub preferred: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSetupModelStatus {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub size_bytes: Option<u64>,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSetupStatus {
    pub state: String,
    pub message: String,
    pub running_in_electron: bool,
    pub install_command: String,
    pub detected_binary_path: Option<String>,
    pub detected_runtime_source: String,
    pub runtime_version: Option<String>,
    pub binary_candidates: Vec<SpeechSetupBinaryCandidate>,
    pub model_directory: String,
    pub model: SpeechSetupModelStatus,
    pub recommended_args: Vec<String>,
    pub provider_health: SpeechProviderHealth,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSetupDownloadResult {
    pub status: SpeechSetupStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSetupConfigureResult {
    pub status: SpeechSetupStatus,
}

pub async fn transcribe(
    State(state): State<AppState>,
    Json(input): Json<SpeechTranscribeRequest>,
) -> Result<Json<SpeechToTextResult>, (StatusCode, Json<SpeechTranscribeErrorPayload>)> {
    if state.restart.is_draining() {
        let mut error = SpeechToTextError::new(
            SpeechToTextErrorKind::ProviderUnavailable,
            "loom-service is draining and is not accepting new speech transcription requests.",
        );
        error.warnings.push("runtime_draining".to_string());
        return Err(speech_error(error));
    }
    let config = state.config.current().speech;
    let request_metadata = input.metadata.clone();
    let request = SpeechToTextProviderRequest {
        audio_bytes: input.audio_bytes,
        mime_type: input.mime_type,
        language: input.language.or(config.default_language.clone()),
        provider_profile_id: input
            .provider_profile_id
            .or(config.provider_profile_id.clone()),
        metadata: input.metadata,
    };
    let provider_kind = config.default_provider_kind.clone();
    let audio_byte_len = request.audio_bytes.len();
    let mime_type = request.mime_type.clone();
    let normalized_mime = normalized_mime_type(&mime_type);
    let audio_extension = audio_extension_for_mime(&mime_type);
    let request_diagnostics = speech_request_diagnostics(
        &mime_type,
        &normalized_mime,
        audio_extension,
        audio_byte_len,
        &provider_kind,
        request_metadata.as_ref(),
    );
    tracing::info!(
        provider_kind = ?provider_kind,
        %mime_type,
        %normalized_mime,
        %audio_extension,
        audio_byte_len,
        "speech transcription requested"
    );

    if let Err(error) = validate_mode(input.mode.as_deref()) {
        tracing::warn!(
            provider_kind = ?provider_kind,
            %mime_type,
            %normalized_mime,
            %audio_extension,
            audio_byte_len,
            error_kind = ?error.kind,
            "speech transcription rejected"
        );
        return Err(speech_error_with_diagnostics(
            error,
            request_diagnostics.clone(),
        ));
    }
    if let Err(error) = validate_transcribe_request(&config, &request) {
        tracing::warn!(
            provider_kind = ?provider_kind,
            %mime_type,
            %normalized_mime,
            %audio_extension,
            audio_byte_len,
            error_kind = ?error.kind,
            "speech transcription rejected"
        );
        return Err(speech_error_with_diagnostics(
            error,
            request_diagnostics.clone(),
        ));
    }

    match config.default_provider_kind {
        SpeechToTextProviderKind::MockTest => {
            match MockSpeechToTextProvider::from_config(&config).transcribe(request) {
                Ok(result) => {
                    tracing::info!(
                        provider_kind = ?provider_kind,
                        %mime_type,
                        %normalized_mime,
                        %audio_extension,
                        audio_byte_len,
                        "speech transcription completed"
                    );
                    Ok(Json(result))
                }
                Err(error) => {
                    tracing::warn!(
                        provider_kind = ?provider_kind,
                        %mime_type,
                        %normalized_mime,
                        %audio_extension,
                        audio_byte_len,
                        error_kind = ?error.kind,
                        "speech transcription failed"
                    );
                    Err(speech_error_with_diagnostics(
                        error,
                        request_diagnostics.clone(),
                    ))
                }
            }
        }
        SpeechToTextProviderKind::LocalCommand => {
            match LocalCommandSpeechToTextProvider::from_config(&config).transcribe(request) {
                Ok(result) => {
                    tracing::info!(
                        provider_kind = ?provider_kind,
                        %mime_type,
                        %normalized_mime,
                        %audio_extension,
                        audio_byte_len,
                        "speech transcription completed"
                    );
                    Ok(Json(result))
                }
                Err(error) => {
                    tracing::warn!(
                        provider_kind = ?provider_kind,
                        %mime_type,
                        %normalized_mime,
                        %audio_extension,
                        audio_byte_len,
                        error_kind = ?error.kind,
                        "speech transcription failed"
                    );
                    Err(speech_error_with_diagnostics(
                        error,
                        request_diagnostics.clone(),
                    ))
                }
            }
        }
        _ => {
            let error = SpeechToTextError::new(
                SpeechToTextErrorKind::ProviderUnavailable,
                "No real Speech-to-Text provider is configured yet.",
            );
            tracing::warn!(
                provider_kind = ?provider_kind,
                %mime_type,
                %normalized_mime,
                %audio_extension,
                audio_byte_len,
                error_kind = ?error.kind,
                "speech transcription failed"
            );
            Err(speech_error_with_diagnostics(error, request_diagnostics))
        }
    }
}

pub async fn provider_health(State(state): State<AppState>) -> Json<SpeechProviderHealth> {
    let config = state.config.current().speech;
    if !config.enabled
        || matches!(
            config.default_provider_kind,
            SpeechToTextProviderKind::Disabled
        )
    {
        return Json(SpeechProviderHealth {
            status: "provider_unavailable".to_string(),
            provider_kind: config.default_provider_kind.as_config_str().to_string(),
            message: "Speech-to-Text is disabled.".to_string(),
            checks: Vec::new(),
        });
    }
    if config.default_provider_kind.is_cloud() || config.allow_cloud_stt {
        return Json(SpeechProviderHealth {
            status: "provider_unavailable".to_string(),
            provider_kind: config.default_provider_kind.as_config_str().to_string(),
            message: "Cloud Speech-to-Text is not enabled by this local provider check."
                .to_string(),
            checks: vec!["cloud_stt_disabled".to_string()],
        });
    }
    match config.default_provider_kind {
        SpeechToTextProviderKind::LocalCommand => {
            Json(LocalCommandSpeechToTextProvider::from_config(&config).health())
        }
        SpeechToTextProviderKind::MockTest => Json(SpeechProviderHealth {
            status: "provider_unavailable".to_string(),
            provider_kind: "mock_test".to_string(),
            message: "mock_test is explicit dev/test only and is not a user-facing STT provider."
                .to_string(),
            checks: Vec::new(),
        }),
        _ => Json(SpeechProviderHealth {
            status: "provider_unavailable".to_string(),
            provider_kind: config.default_provider_kind.as_config_str().to_string(),
            message: "No local Speech-to-Text provider is configured.".to_string(),
            checks: Vec::new(),
        }),
    }
}

pub async fn setup_status(State(state): State<AppState>) -> Json<SpeechSetupStatus> {
    Json(build_setup_status(&state))
}

pub async fn download_setup_model(
    State(state): State<AppState>,
) -> Result<Json<SpeechSetupDownloadResult>, (StatusCode, Json<SpeechTranscribeErrorPayload>)> {
    let model_path = default_model_path();
    if model_path.exists() {
        return Ok(Json(SpeechSetupDownloadResult {
            status: build_setup_status(&state),
        }));
    }
    if let Some(parent) = model_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            speech_error(SpeechToTextError::new(
                SpeechToTextErrorKind::ProviderUnavailable,
                format!("Could not create Whisper model directory: {error}"),
            ))
        })?;
    }
    let bytes = reqwest::Client::new()
        .get(DEFAULT_WHISPER_MODEL_URL)
        .send()
        .await
        .map_err(|error| {
            speech_error(SpeechToTextError::new(
                SpeechToTextErrorKind::ProviderUnavailable,
                format!("Could not download Whisper model: {error}"),
            ))
        })?
        .error_for_status()
        .map_err(|error| {
            speech_error(SpeechToTextError::new(
                SpeechToTextErrorKind::ProviderUnavailable,
                format!("Whisper model download failed: {error}"),
            ))
        })?
        .bytes()
        .await
        .map_err(|error| {
            speech_error(SpeechToTextError::new(
                SpeechToTextErrorKind::ProviderUnavailable,
                format!("Could not read Whisper model download: {error}"),
            ))
        })?;
    fs::write(&model_path, bytes).map_err(|error| {
        speech_error(SpeechToTextError::new(
            SpeechToTextErrorKind::ProviderUnavailable,
            format!("Could not save Whisper model: {error}"),
        ))
    })?;
    Ok(Json(SpeechSetupDownloadResult {
        status: build_setup_status(&state),
    }))
}

pub async fn configure_setup(
    State(state): State<AppState>,
) -> Result<Json<SpeechSetupConfigureResult>, (StatusCode, Json<SpeechTranscribeErrorPayload>)> {
    let Some((binary_path, _source)) = detect_whisper_runtime() else {
        return Err(speech_error(SpeechToTextError::new(
            SpeechToTextErrorKind::ProviderUnavailable,
            "Local Speech Engine is not installed. Open Settings → Capability → Speech-to-Text and install the local speech engine.",
        )));
    };
    let model_path = default_model_path();
    if !model_path.exists() {
        return Err(speech_error(SpeechToTextError::new(
            SpeechToTextErrorKind::ProviderUnavailable,
            "Local speech model is missing. Download the local model first.",
        )));
    }
    state
        .config
        .patch(speech_setup_config_patch(&binary_path, &model_path))
        .map_err(|error| {
            speech_error(SpeechToTextError::new(
                SpeechToTextErrorKind::ProviderUnavailable,
                format!("Could not save Speech-to-Text setup: {error}"),
            ))
        })?;
    Ok(Json(SpeechSetupConfigureResult {
        status: build_setup_status(&state),
    }))
}

fn validate_mode(mode: Option<&str>) -> Result<(), SpeechToTextError> {
    match mode.unwrap_or("preview") {
        "preview" => Ok(()),
        _ => Err(SpeechToTextError::new(
            SpeechToTextErrorKind::InvalidRequest,
            "Only Speech-to-Text preview mode is supported.",
        )),
    }
}

fn speech_error(error: SpeechToTextError) -> (StatusCode, Json<SpeechTranscribeErrorPayload>) {
    speech_error_with_diagnostics(error, serde_json::json!({}))
}

pub(crate) fn payload_too_large_error(
    content_length: Option<u64>,
) -> (StatusCode, Json<SpeechTranscribeErrorPayload>) {
    let mut error = SpeechToTextError::new(
        SpeechToTextErrorKind::AudioTooLarge,
        "Recording is too long. Try a shorter recording.",
    );
    error.diagnostics = Some(serde_json::json!({
        "httpBodyLimitBytes": SPEECH_TRANSCRIBE_HTTP_BODY_LIMIT_BYTES,
        "contentLength": content_length,
    }));
    speech_error(error)
}

fn speech_error_with_diagnostics(
    error: SpeechToTextError,
    request_diagnostics: Value,
) -> (StatusCode, Json<SpeechTranscribeErrorPayload>) {
    let status = match error.kind {
        SpeechToTextErrorKind::SttDisabled => StatusCode::FORBIDDEN,
        SpeechToTextErrorKind::UnsupportedAudioType => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        SpeechToTextErrorKind::AudioTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        SpeechToTextErrorKind::CloudSttDisabled => StatusCode::FORBIDDEN,
        SpeechToTextErrorKind::MissingSecret => StatusCode::UNAUTHORIZED,
        SpeechToTextErrorKind::ProviderUnavailable => StatusCode::SERVICE_UNAVAILABLE,
        SpeechToTextErrorKind::InvalidRequest => StatusCode::BAD_REQUEST,
        SpeechToTextErrorKind::NoSpeechDetected => StatusCode::UNPROCESSABLE_ENTITY,
        SpeechToTextErrorKind::ProviderTimeout => StatusCode::GATEWAY_TIMEOUT,
        SpeechToTextErrorKind::TranscriptionFailed => StatusCode::BAD_GATEWAY,
    };
    let code = speech_error_code(&error.kind).to_string();
    let diagnostics = merge_speech_diagnostics(request_diagnostics, error.diagnostics);
    (
        status,
        Json(SpeechTranscribeErrorPayload {
            kind: error.kind,
            code,
            message: error.message,
            warnings: error.warnings,
            diagnostics,
        }),
    )
}

fn speech_error_code(kind: &SpeechToTextErrorKind) -> &'static str {
    match kind {
        SpeechToTextErrorKind::SttDisabled => "stt_disabled",
        SpeechToTextErrorKind::UnsupportedAudioType => "unsupported_audio",
        SpeechToTextErrorKind::AudioTooLarge => "payload_too_large",
        SpeechToTextErrorKind::ProviderUnavailable => "service_unavailable",
        SpeechToTextErrorKind::MissingSecret => "missing_secret",
        SpeechToTextErrorKind::CloudSttDisabled => "cloud_stt_disabled",
        SpeechToTextErrorKind::NoSpeechDetected => "no_speech_detected",
        SpeechToTextErrorKind::ProviderTimeout => "provider_timeout",
        SpeechToTextErrorKind::TranscriptionFailed => "provider_failed",
        SpeechToTextErrorKind::InvalidRequest => "invalid_request",
    }
}

fn merge_speech_diagnostics(mut base: Value, extra: Option<Value>) -> Value {
    if let (Some(base_object), Some(extra_value)) = (base.as_object_mut(), extra) {
        if let Some(extra_object) = extra_value.as_object() {
            for (key, value) in extra_object {
                base_object.insert(key.clone(), value.clone());
            }
        }
    }
    base
}

fn speech_request_diagnostics(
    mime_type: &str,
    normalized_mime: &str,
    audio_extension: &str,
    audio_byte_len: usize,
    provider_kind: &SpeechToTextProviderKind,
    metadata: Option<&Value>,
) -> Value {
    serde_json::json!({
        "mimeType": mime_type,
        "normalizedMimeType": normalized_mime,
        "extension": audio_extension,
        "byteLength": audio_byte_len,
        "durationMs": metadata.and_then(|value| numeric_metadata(value, "durationSeconds")).map(|value| (value * 1000.0).round() as u64),
        "sampleRate": metadata.and_then(|value| numeric_metadata(value, "sampleRate")),
        "channelCount": metadata.and_then(|value| numeric_metadata(value, "channelCount")),
        "sourceSampleRate": metadata.and_then(|value| numeric_metadata(value, "sourceSampleRate")),
        "sourceChannelCount": metadata.and_then(|value| numeric_metadata(value, "sourceChannelCount")),
        "sourceByteSize": metadata.and_then(|value| numeric_metadata(value, "sourceByteSize")),
        "wavByteSize": metadata.and_then(|value| numeric_metadata(value, "wavByteSize")),
        "providerKind": provider_kind.as_config_str(),
    })
}

fn numeric_metadata(value: &Value, key: &str) -> Option<f64> {
    value.as_object()?.get(key)?.as_f64()
}

fn default_model_dir() -> PathBuf {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    home.join("Library")
        .join("Application Support")
        .join("Loom")
        .join("models")
        .join("whisper")
}

fn default_model_path() -> PathBuf {
    default_model_dir().join(DEFAULT_WHISPER_MODEL_NAME)
}

fn platform_arch_segment() -> String {
    let platform = match env::consts::OS {
        "macos" => "darwin",
        value => value,
    };
    let arch = match env::consts::ARCH {
        "aarch64" => "arm64",
        value => value,
    };
    format!("{platform}-{arch}")
}

fn bundled_runtime_root() -> Option<PathBuf> {
    env::var_os("LOOM_SERVICE_RESOURCES_PATH")
        .map(PathBuf::from)
        .map(|resources| {
            resources
                .join("bin")
                .join("whisper")
                .join(platform_arch_segment())
        })
}

fn managed_runtime_root() -> PathBuf {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    home.join("Library")
        .join("Application Support")
        .join("Loom")
        .join("runtimes")
        .join("whisper")
}

fn path_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn named_candidates_from_dir(directory: &Path) -> Vec<PathBuf> {
    WHISPER_BINARY_NAMES
        .iter()
        .map(|name| directory.join(name))
        .collect()
}

fn bundled_runtime_candidates() -> Vec<PathBuf> {
    bundled_runtime_root()
        .map(|root| named_candidates_from_dir(&root))
        .unwrap_or_default()
}

fn managed_runtime_candidates() -> Vec<PathBuf> {
    managed_runtime_candidates_from_root(&managed_runtime_root())
}

fn managed_runtime_candidates_from_root(root: &Path) -> Vec<PathBuf> {
    let mut version_dirs: Vec<PathBuf> = fs::read_dir(root)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    version_dirs.sort();
    version_dirs.reverse();
    version_dirs
        .into_iter()
        .flat_map(|directory| named_candidates_from_dir(&directory))
        .collect()
}

fn path_candidates_from_path() -> Vec<PathBuf> {
    let Some(path_value) = env::var_os("PATH") else {
        return Vec::new();
    };
    path_candidates_from_dirs(env::split_paths(&path_value).collect())
}

fn path_candidates_from_dirs(directories: Vec<PathBuf>) -> Vec<PathBuf> {
    WHISPER_BINARY_NAMES
        .iter()
        .flat_map(|name| {
            directories
                .iter()
                .map(move |directory| directory.join(name))
        })
        .collect()
}

fn system_fallback_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = WHISPER_SYSTEM_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .collect();
    for candidate in path_candidates_from_path() {
        if !candidates.iter().any(|existing| existing == &candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn all_binary_candidates() -> Vec<(PathBuf, String)> {
    let mut candidates: Vec<(PathBuf, String)> = Vec::new();
    for candidate in bundled_runtime_candidates() {
        candidates.push((candidate, "bundled".to_string()));
    }
    for candidate in managed_runtime_candidates() {
        candidates.push((candidate, "installed".to_string()));
    }
    for candidate in system_fallback_candidates() {
        candidates.push((candidate, "system".to_string()));
    }
    candidates
}

fn setup_binary_candidates(config: &crate::speech::SpeechToTextConfig) -> Vec<(PathBuf, String)> {
    let mut candidates = all_binary_candidates();
    if let Some(command_path) = &config.local_command_path {
        let configured = PathBuf::from(command_path);
        if !candidates
            .iter()
            .any(|(candidate, _source)| candidate == &configured)
        {
            candidates.push((configured, "configured".to_string()));
        }
    }
    candidates
}

fn detect_whisper_runtime() -> Option<(PathBuf, String)> {
    detect_whisper_runtime_from_candidates(all_binary_candidates())
}

fn detect_setup_runtime(config: &crate::speech::SpeechToTextConfig) -> Option<(PathBuf, String)> {
    detect_whisper_runtime_from_candidates(setup_binary_candidates(config))
}

fn detect_whisper_runtime_from_candidates(
    candidates: Vec<(PathBuf, String)>,
) -> Option<(PathBuf, String)> {
    candidates
        .into_iter()
        .find(|(candidate, _source)| path_executable(candidate))
}

fn runtime_version(binary_path: Option<&Path>) -> Option<String> {
    let binary_path = binary_path?;
    let output = std::process::Command::new(binary_path)
        .arg("--help")
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    });
    text.lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().chars().take(120).collect())
}

fn recommended_whisper_args(model_path: &Path) -> Vec<String> {
    vec![
        "-m".to_string(),
        model_path.to_string_lossy().to_string(),
        "-f".to_string(),
        "{input}".to_string(),
        "-l".to_string(),
        "auto".to_string(),
        "-otxt".to_string(),
        "-of".to_string(),
        "{output}".to_string(),
        "-nt".to_string(),
    ]
}

fn setup_state(
    binary_path: Option<&Path>,
    model_exists: bool,
    provider_health: &SpeechProviderHealth,
) -> (String, String) {
    if binary_path.is_none() {
        return (
            "whisper_not_found".to_string(),
            "Local Speech Engine is not installed. Open Settings → Capability → Speech-to-Text and install the local speech engine.".to_string(),
        );
    }
    if !model_exists {
        return (
            "model_missing".to_string(),
            "Local Speech Engine is installed. Download the local transcription model next."
                .to_string(),
        );
    }
    if provider_health.status == "configured" {
        return (
            "ready".to_string(),
            "Local Speech-to-Text is ready.".to_string(),
        );
    }
    (
        "model_ready".to_string(),
        "Local Speech Engine and model are ready. Save the recommended provider configuration."
            .to_string(),
    )
}

fn speech_setup_config_patch(binary_path: &Path, model_path: &Path) -> ConfigPatch {
    ConfigPatch {
        speech: Some(SpeechToTextPatch {
            enabled: Some(true),
            default_provider_kind: Some(SpeechToTextProviderKind::LocalCommand),
            allow_cloud_stt: Some(false),
            persist_audio: Some(false),
            persist_transcript: Some(false),
            local_command_path: Some(Some(binary_path.to_string_lossy().to_string())),
            local_command_args: Some(recommended_whisper_args(model_path)),
            local_command_timeout_ms: Some(120_000),
            local_command_output_mode: Some(LocalCommandOutputMode::File),
            local_command_transcript_file_extension: Some("txt".to_string()),
            warnings: Some(Vec::new()),
            ..SpeechToTextPatch::default()
        }),
        ..ConfigPatch::default()
    }
}

fn build_setup_status(state: &AppState) -> SpeechSetupStatus {
    let speech_config = state.config.current().speech;
    let detected_runtime = detect_setup_runtime(&speech_config);
    let binary_path = detected_runtime
        .as_ref()
        .map(|(path, _source)| path.clone());
    let detected_source = detected_runtime
        .as_ref()
        .map(|(_path, source)| source.clone())
        .unwrap_or_else(|| "missing".to_string());
    let model_path = default_model_path();
    let model_exists = model_path.exists();
    let model_size = fs::metadata(&model_path)
        .ok()
        .map(|metadata| metadata.len());
    let provider_health = LocalCommandSpeechToTextProvider::from_config(&speech_config).health();
    let (state_name, message) = setup_state(binary_path.as_deref(), model_exists, &provider_health);
    SpeechSetupStatus {
        state: state_name,
        message,
        running_in_electron: env::var("LOOM_SERVICE_RUNTIME_OWNER_KIND")
            .map(|value| value == "electron")
            .unwrap_or(false),
        install_command: INSTALL_SPEECH_ENGINE_MESSAGE.to_string(),
        detected_binary_path: binary_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        detected_runtime_source: detected_source,
        runtime_version: runtime_version(binary_path.as_deref()),
        binary_candidates: setup_binary_candidates(&speech_config)
            .into_iter()
            .map(|(path, source)| {
                let executable = path_executable(&path);
                SpeechSetupBinaryCandidate {
                    path: path.to_string_lossy().to_string(),
                    exists: path.exists(),
                    executable,
                    preferred: binary_path
                        .as_ref()
                        .map(|detected| detected == &path)
                        .unwrap_or(false),
                    source,
                }
            })
            .collect(),
        model_directory: default_model_dir().to_string_lossy().to_string(),
        model: SpeechSetupModelStatus {
            name: DEFAULT_WHISPER_MODEL_NAME.to_string(),
            path: model_path.to_string_lossy().to_string(),
            exists: model_exists,
            size_bytes: model_size,
            download_url: DEFAULT_WHISPER_MODEL_URL.to_string(),
        },
        recommended_args: recommended_whisper_args(&model_path),
        provider_health,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        api::state::AppState,
        config::{ConfigManager, LoomServiceConfig, OllamaConfig},
        providers::ollama::OllamaRuntime,
        runtime::{OperationTracker, RestartState},
        speech::{SpeechToTextConfig, SpeechToTextProviderKind},
        storage::db::{Database, DatabaseConfig},
    };
    use serde_json::json;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = env::temp_dir().join(format!("loom-speech-{name}-{nanos}"));
        fs::create_dir_all(&path).expect("test dir");
        path
    }

    fn create_executable(path: &Path) {
        fs::write(path, "#!/bin/sh\nexit 0\n").expect("write executable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(path).expect("metadata").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).expect("set permissions");
        }
    }

    fn silent_wav_pcm16(seconds: u32) -> Vec<u8> {
        let sample_rate = 16_000u32;
        let sample_count = sample_rate as usize * seconds as usize;
        let data_byte_len = sample_count * 2;
        let mut bytes = Vec::with_capacity(44 + data_byte_len);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_byte_len as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data_byte_len as u32).to_le_bytes());
        bytes.resize(44 + data_byte_len, 0);
        bytes
    }

    #[tokio::test]
    async fn transcribe_rejects_disabled_stt_without_persistence() {
        let state = test_state(SpeechToTextConfig::default()).await;
        let error = transcribe(
            State(state),
            Json(SpeechTranscribeRequest {
                audio_bytes: vec![1, 2, 3],
                mime_type: "audio/webm".to_string(),
                language: None,
                provider_profile_id: None,
                mode: Some("preview".to_string()),
                metadata: None,
            }),
        )
        .await
        .expect_err("disabled");

        assert_eq!(error.0, StatusCode::FORBIDDEN);
        assert_eq!(error.1 .0.kind, SpeechToTextErrorKind::SttDisabled);
    }

    #[tokio::test]
    async fn transcribe_mock_provider_returns_preview_without_persistence() {
        let config = SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::MockTest,
            ..SpeechToTextConfig::default()
        };
        let state = test_state(config).await;
        let response = transcribe(
            State(state),
            Json(SpeechTranscribeRequest {
                audio_bytes: vec![1, 2, 3],
                mime_type: "audio/webm".to_string(),
                language: Some("tr".to_string()),
                provider_profile_id: None,
                mode: Some("preview".to_string()),
                metadata: Some(json!({"source": "test"})),
            }),
        )
        .await
        .expect("transcribed")
        .0;

        assert_eq!(response.transcript, "Mock transcription transcript.");
        assert!(!response.retention.audio_persisted);
        assert!(!response.retention.transcript_persisted);
    }

    #[tokio::test]
    async fn transcribe_local_command_missing_provider_returns_unavailable() {
        let config = SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::LocalCommand,
            local_command_path: None,
            ..SpeechToTextConfig::default()
        };
        let state = test_state(config).await;
        let error = transcribe(
            State(state),
            Json(SpeechTranscribeRequest {
                audio_bytes: vec![1, 2, 3],
                mime_type: "audio/webm".to_string(),
                language: None,
                provider_profile_id: None,
                mode: Some("preview".to_string()),
                metadata: None,
            }),
        )
        .await
        .expect_err("local provider unavailable");

        assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(error.1 .0.kind, SpeechToTextErrorKind::ProviderUnavailable);
        assert_eq!(
            error.1 .0.message,
            "Speech-to-Text is not configured yet. Open Settings → Capability → Speech-to-Text and run Auto-configure."
        );
    }

    #[test]
    fn payload_too_large_error_is_structured_for_pre_route_rejection() {
        let (status, payload) =
            payload_too_large_error(Some((SPEECH_TRANSCRIBE_HTTP_BODY_LIMIT_BYTES + 1) as u64));

        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(payload.0.code, "payload_too_large");
        assert_eq!(
            payload.0.message,
            "Recording is too long. Try a shorter recording."
        );
        assert_eq!(
            payload.0.diagnostics["httpBodyLimitBytes"],
            serde_json::json!(SPEECH_TRANSCRIBE_HTTP_BODY_LIMIT_BYTES)
        );
    }

    #[tokio::test]
    async fn provider_health_reports_local_command_missing_without_recording() {
        let state = test_state(SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::LocalCommand,
            local_command_path: None,
            ..SpeechToTextConfig::default()
        })
        .await;

        let health = provider_health(State(state)).await.0;

        assert_eq!(health.status, "missing_command");
        assert_eq!(health.provider_kind, "local_command");
        assert!(health.message.contains("not configured"));
    }

    #[tokio::test]
    async fn provider_health_reports_local_command_configured_without_persistence() {
        let state = test_state(SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::LocalCommand,
            local_command_path: Some("/bin/cat".to_string()),
            ..SpeechToTextConfig::default()
        })
        .await;

        let health = provider_health(State(state)).await.0;

        assert_eq!(health.status, "configured");
        assert!(health.checks.contains(&"audio_not_persisted".to_string()));
        assert!(health
            .checks
            .contains(&"transcript_not_persisted".to_string()));
    }

    #[test]
    fn setup_recommended_args_match_whisper_cpp_file_output_contract() {
        let model_path = PathBuf::from("/tmp/ggml-base.bin");
        assert_eq!(
            recommended_whisper_args(&model_path),
            vec![
                "-m",
                "/tmp/ggml-base.bin",
                "-f",
                "{input}",
                "-l",
                "auto",
                "-otxt",
                "-of",
                "{output}",
                "-nt"
            ]
        );
    }

    #[test]
    fn setup_path_candidates_prioritize_whisper_cli_then_whisper_cpp() {
        let first = PathBuf::from("/tmp/first");
        let second = PathBuf::from("/tmp/second");
        let candidates = path_candidates_from_dirs(vec![first.clone(), second.clone()]);

        assert_eq!(candidates[0], first.join("whisper-cli"));
        assert_eq!(candidates[1], second.join("whisper-cli"));
        assert_eq!(candidates[2], first.join("whisper-cpp"));
        assert_eq!(candidates[3], second.join("whisper-cpp"));
    }

    #[test]
    fn setup_checked_candidates_include_homebrew_whisper_cpp_paths() {
        let candidates = all_binary_candidates();

        assert_eq!(
            candidates[0].0,
            PathBuf::from("/opt/homebrew/bin/whisper-cli")
        );
        assert_eq!(
            candidates[1].0,
            PathBuf::from("/opt/homebrew/bin/whisper-cpp")
        );
        assert_eq!(candidates[2].0, PathBuf::from("/usr/local/bin/whisper-cli"));
        assert_eq!(candidates[3].0, PathBuf::from("/usr/local/bin/whisper-cpp"));
        assert!(candidates
            .iter()
            .any(|(candidate, source)| source == "system"
                && candidate.file_name().and_then(|name| name.to_str()) == Some("whisper-cpp")));
    }

    #[test]
    fn setup_runtime_candidates_prioritize_bundled_then_managed_then_system() {
        let bundled = PathBuf::from("/tmp/resources/bin/whisper/darwin-arm64/whisper-cli");
        let managed = PathBuf::from("/tmp/Loom/runtimes/whisper/v1/whisper-cli");
        let system = PathBuf::from("/opt/homebrew/bin/whisper-cpp");
        let candidates = vec![
            (bundled.clone(), "bundled".to_string()),
            (managed, "installed".to_string()),
            (system, "system".to_string()),
        ];

        assert_eq!(candidates[0], (bundled, "bundled".to_string()));
    }

    #[test]
    fn setup_managed_runtime_candidates_prefer_newer_version_dirs() {
        let root = unique_test_dir("managed-runtime");
        fs::create_dir_all(root.join("v1")).expect("v1");
        fs::create_dir_all(root.join("v2")).expect("v2");

        let candidates = managed_runtime_candidates_from_root(&root);

        assert_eq!(candidates[0], root.join("v2").join("whisper-cli"));
        assert_eq!(candidates[4], root.join("v1").join("whisper-cli"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn setup_detects_whisper_cli_before_lower_priority_binaries() {
        let dir = unique_test_dir("detect-cli");
        let whisper_cli = dir.join("whisper-cli");
        let whisper_cpp = dir.join("whisper-cpp");
        create_executable(&whisper_cpp);
        create_executable(&whisper_cli);

        let detected = detect_whisper_runtime_from_candidates(vec![
            (whisper_cli.clone(), "bundled".to_string()),
            (whisper_cpp, "installed".to_string()),
            (dir.join("whisper"), "system".to_string()),
            (dir.join("main"), "system".to_string()),
        ]);

        assert_eq!(detected, Some((whisper_cli, "bundled".to_string())));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn setup_detects_homebrew_whisper_cpp_binary_name() {
        let dir = unique_test_dir("detect-cpp");
        let whisper_cpp = dir.join("whisper-cpp");
        create_executable(&whisper_cpp);

        let detected = detect_whisper_runtime_from_candidates(vec![
            (dir.join("whisper-cli"), "bundled".to_string()),
            (whisper_cpp.clone(), "bundled".to_string()),
            (dir.join("whisper"), "system".to_string()),
            (dir.join("main"), "system".to_string()),
        ]);

        assert_eq!(detected, Some((whisper_cpp, "bundled".to_string())));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn setup_detects_no_binary_when_candidates_are_missing() {
        let dir = unique_test_dir("detect-none");
        let detected = detect_whisper_runtime_from_candidates(vec![
            (dir.join("whisper-cli"), "bundled".to_string()),
            (dir.join("whisper-cpp"), "installed".to_string()),
            (dir.join("whisper"), "system".to_string()),
            (dir.join("main"), "system".to_string()),
        ]);

        assert_eq!(detected, None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn setup_detection_falls_back_to_configured_command_path() {
        let dir = unique_test_dir("detect-configured");
        let configured = dir.join("whisper-cli");
        create_executable(&configured);
        let config = SpeechToTextConfig {
            local_command_path: Some(configured.to_string_lossy().to_string()),
            ..SpeechToTextConfig::default()
        };

        let detected = detect_setup_runtime(&config);

        assert_eq!(detected, Some((configured, "configured".to_string())));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn setup_state_guides_missing_binary_and_model_before_ready() {
        let unavailable = SpeechProviderHealth {
            status: "missing_command".to_string(),
            provider_kind: "local_command".to_string(),
            message: "missing".to_string(),
            checks: Vec::new(),
        };
        assert_eq!(
            setup_state(None, false, &unavailable).0,
            "whisper_not_found"
        );
        assert!(setup_state(None, false, &unavailable)
            .1
            .contains("Local Speech Engine is not installed"));
        assert_eq!(
            setup_state(
                Some(Path::new("/opt/homebrew/bin/whisper-cpp")),
                false,
                &unavailable
            )
            .0,
            "model_missing"
        );
        assert_eq!(
            setup_state(
                Some(Path::new("/opt/homebrew/bin/whisper-cpp")),
                true,
                &unavailable
            )
            .0,
            "model_ready"
        );
        let configured = SpeechProviderHealth {
            status: "configured".to_string(),
            provider_kind: "local_command".to_string(),
            message: "ready".to_string(),
            checks: Vec::new(),
        };
        assert_eq!(
            setup_state(
                Some(Path::new("/opt/homebrew/bin/whisper-cpp")),
                true,
                &configured
            )
            .0,
            "ready"
        );
    }

    #[test]
    fn setup_configure_patch_uses_detected_whisper_cpp_path() {
        let binary_path = PathBuf::from("/opt/homebrew/bin/whisper-cpp");
        let model_path = PathBuf::from(
            "/Users/test/Library/Application Support/Loom/models/whisper/ggml-base.bin",
        );
        let patch = speech_setup_config_patch(&binary_path, &model_path);
        let speech = patch.speech.expect("speech patch");

        assert_eq!(
            speech.local_command_path,
            Some(Some(binary_path.to_string_lossy().to_string()))
        );
        assert_eq!(
            speech.local_command_args,
            Some(recommended_whisper_args(&model_path))
        );
        assert_eq!(
            speech.default_provider_kind,
            Some(SpeechToTextProviderKind::LocalCommand)
        );
    }

    #[tokio::test]
    async fn transcribe_local_command_returns_preview_without_persistence() {
        let config = SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::LocalCommand,
            local_command_path: Some("/bin/cat".to_string()),
            local_command_args: vec!["{audio_file}".to_string()],
            ..SpeechToTextConfig::default()
        };
        let state = test_state(config).await;
        let response = transcribe(
            State(state),
            Json(SpeechTranscribeRequest {
                audio_bytes: b"local transcript".to_vec(),
                mime_type: "audio/webm".to_string(),
                language: Some("en".to_string()),
                provider_profile_id: None,
                mode: Some("preview".to_string()),
                metadata: Some(json!({"source": "test"})),
            }),
        )
        .await
        .expect("transcribed")
        .0;

        assert_eq!(response.transcript, "local transcript");
        assert_eq!(response.provider, "local_command");
        assert!(!response.retention.audio_persisted);
        assert!(!response.retention.transcript_persisted);
    }

    #[tokio::test]
    async fn transcribe_local_command_silent_wav_returns_structured_no_speech() {
        let dir = unique_test_dir("silent-api");
        let marker = dir.join("provider-invoked");
        let config = SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::LocalCommand,
            local_command_path: Some("/bin/sh".to_string()),
            local_command_args: vec![
                "-c".to_string(),
                format!("touch '{}'; printf 'you'", marker.to_string_lossy()),
            ],
            local_temp_dir: Some(dir.to_string_lossy().to_string()),
            ..SpeechToTextConfig::default()
        };
        let state = test_state(config).await;
        let error = transcribe(
            State(state),
            Json(SpeechTranscribeRequest {
                audio_bytes: silent_wav_pcm16(6),
                mime_type: "audio/wav".to_string(),
                language: None,
                provider_profile_id: None,
                mode: Some("preview".to_string()),
                metadata: Some(json!({"durationSeconds": 6.0, "sampleRate": 16000})),
            }),
        )
        .await
        .expect_err("silent wav rejected");

        assert_eq!(error.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(error.1 .0.kind, SpeechToTextErrorKind::NoSpeechDetected);
        assert_eq!(error.1 .0.code, "no_speech_detected");
        assert_eq!(
            error.1 .0.message,
            "No speech was detected. Try speaking a little louder or longer."
        );
        assert_eq!(
            error.1 .0.diagnostics["noSpeechStage"],
            json!("pre_provider_energy_gate")
        );
        assert_eq!(error.1 .0.diagnostics["providerInvoked"], json!(false));
        assert!(error.1 .0.diagnostics.get("transcript").is_none());
        assert!(!marker.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn transcribe_rejects_raw_thinking_metadata() {
        let config = SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::MockTest,
            ..SpeechToTextConfig::default()
        };
        let state = test_state(config).await;
        let error = transcribe(
            State(state),
            Json(SpeechTranscribeRequest {
                audio_bytes: vec![1],
                mime_type: "audio/webm".to_string(),
                language: None,
                provider_profile_id: None,
                mode: Some("preview".to_string()),
                metadata: Some(json!({"hidden_reasoning": "never"})),
            }),
        )
        .await
        .expect_err("metadata rejected");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert_eq!(error.1 .0.kind, SpeechToTextErrorKind::InvalidRequest);
    }

    async fn test_state(speech: SpeechToTextConfig) -> AppState {
        let mut config_file = LoomServiceConfig::default();
        config_file.speech = speech;
        AppState {
            database: Database::connect_and_migrate(&DatabaseConfig::in_memory())
                .await
                .expect("db"),
            ollama: OllamaRuntime::new(OllamaConfig {
                base_url: "http://127.0.0.1:9".to_string(),
                request_timeout: std::time::Duration::from_millis(10),
                first_chunk_timeout: std::time::Duration::from_millis(10),
                stream_idle_timeout: std::time::Duration::from_millis(10),
                security: config_file.security.clone(),
            }),
            config: ConfigManager::new(
                PathBuf::from("/tmp/loom-service-speech-test.toml"),
                config_file,
            ),
            secret_store: crate::providers::secret_store::ProviderSecretStore::default(),
            operations: OperationTracker::default(),
            restart: RestartState::default(),
            agent_runs: Default::default(),
        }
    }
}
