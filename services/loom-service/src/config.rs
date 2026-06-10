use crate::{
    error::ServiceError,
    providers::config::{
        classify_provider_config_change, reject_forbidden_config_value, validate_provider_profiles,
        ProviderCapabilitiesConfig, ProviderConfigChangeClassification, ProviderKind,
        ProviderModelDiscoveryConfig, ProviderProfileConfig, ProviderRequestDefaultsConfig,
        ProviderSecurityPolicyConfig, ProviderTransportKind, ProviderVendor,
    },
    speech::{
        apply_speech_patch, validate_speech_config, SpeechToTextConfig, SpeechToTextPatch,
        SpeechToTextProviderKind,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    env,
    fmt::Write as FmtWrite,
    fs,
    io::Write,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 17_633;
const DEFAULT_LOG: &str = "info,sqlx=warn";
const DEFAULT_DB_PATH: &str = "services/loom-service/.data/loom.db";
const DEFAULT_CONFIG_PATH: &str = "services/loom-service/.data/loom-service.toml";
const DEFAULT_OLLAMA_BASE_URL: &str = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_OLLAMA_FIRST_CHUNK_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_OLLAMA_STREAM_IDLE_TIMEOUT_MS: u64 = 60_000;

const CONFIG_HEADER: &str = "# loom-service configuration
# Non-secret runtime settings only.
# Do not store API keys, tokens, credentials, or private secrets here.
# Raw model thinking/internal monologue must never be persisted or exported.

";

#[derive(Debug, Clone)]
pub struct ServiceConfig {
    pub host: IpAddr,
    pub port: u16,
    pub log_filter: String,
    pub db_path: PathBuf,
    pub config_path: PathBuf,
    pub config_file: LoomServiceConfig,
    pub ollama: OllamaConfig,
}

#[derive(Debug, Clone)]
pub struct OllamaConfig {
    pub base_url: String,
    pub request_timeout: Duration,
    pub first_chunk_timeout: Duration,
    pub stream_idle_timeout: Duration,
    pub security: SecuritySection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoomServiceConfig {
    pub service: ServiceSection,
    pub database: DatabaseSection,
    pub ollama: OllamaSection,
    pub providers: ProviderSection,
    pub speech: SpeechToTextConfig,
    pub ocr: OcrSection,
    pub memory: MemorySection,
    pub context: ContextSection,
    pub runtime: RuntimeSection,
    pub features: FeatureSection,
    pub security: SecuritySection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSection {
    pub host: String,
    pub port: u16,
    pub log_level: String,
    pub local_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatabaseSection {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaSection {
    pub base_url: String,
    pub request_timeout_ms: u64,
    pub first_chunk_timeout_ms: u64,
    pub stream_idle_timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSection {
    pub default_main_model: String,
    pub default_quick_model: String,
    pub main_provider_profile_id: Option<String>,
    pub main_model_id: Option<String>,
    pub response_mode_default: String,
    pub profiles: Vec<ProviderProfileConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrSection {
    pub enabled: bool,
    pub provider: String,
    pub command_path: Option<String>,
    pub pdf_rasterizer_command_path: Option<String>,
    pub language: String,
    pub dpi: u32,
    pub timeout_seconds: u64,
    pub max_pages_per_file: u32,
    pub max_image_pixels: u64,
    pub temp_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextSection {
    pub max_context_length: u32,
    pub default_num_ctx_small: u32,
    pub default_num_ctx_medium: u32,
    pub default_num_ctx_large: u32,
    pub max_recent_candidate_responses: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySection {
    pub enabled: bool,
    pub reference_recent_looms: bool,
    pub reference_saved_memories: bool,
    pub nickname: String,
    pub occupation: String,
    pub style_preferences: String,
    pub more_about_you: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSection {
    pub event_heartbeat_ms: u64,
    pub max_active_generations: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSection {
    pub enable_ollama: bool,
    pub enable_exports: bool,
    pub enable_extensions: bool,
    pub enable_mcp: bool,
    pub enable_llm_artifact_refinement: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySection {
    pub enforce_local_ollama: bool,
    pub allow_remote_ollama: bool,
    pub allow_unsafe_ollama_model_management: bool,
    pub minimum_recommended_ollama_version: String,
    pub warn_on_windows_ollama_updater_risk: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPatch {
    pub service: Option<ServicePatch>,
    pub database: Option<DatabasePatch>,
    pub ollama: Option<OllamaPatch>,
    pub providers: Option<ProviderPatch>,
    pub speech: Option<SpeechToTextPatch>,
    pub ocr: Option<OcrPatch>,
    pub memory: Option<MemoryPatch>,
    pub context: Option<ContextPatch>,
    pub runtime: Option<RuntimePatch>,
    pub features: Option<FeaturePatch>,
    pub security: Option<SecurityPatch>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePatch {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub log_level: Option<String>,
    pub local_only: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct DatabasePatch {
    pub path: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaPatch {
    pub base_url: Option<String>,
    pub request_timeout_ms: Option<u64>,
    pub first_chunk_timeout_ms: Option<u64>,
    pub stream_idle_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPatch {
    pub default_main_model: Option<String>,
    pub default_quick_model: Option<String>,
    pub main_provider_profile_id: Option<Option<String>>,
    pub main_model_id: Option<Option<String>>,
    pub response_mode_default: Option<String>,
    pub profiles: Option<Vec<ProviderProfileConfig>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPatch {
    pub enabled: Option<bool>,
    pub provider: Option<String>,
    pub command_path: Option<Option<String>>,
    pub pdf_rasterizer_command_path: Option<Option<String>>,
    pub language: Option<String>,
    pub dpi: Option<u32>,
    pub timeout_seconds: Option<u64>,
    pub max_pages_per_file: Option<u32>,
    pub max_image_pixels: Option<u64>,
    pub temp_dir: Option<Option<String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPatch {
    pub max_context_length: Option<u32>,
    pub default_num_ctx_small: Option<u32>,
    pub default_num_ctx_medium: Option<u32>,
    pub default_num_ctx_large: Option<u32>,
    pub max_recent_candidate_responses: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPatch {
    pub enabled: Option<bool>,
    pub reference_recent_looms: Option<bool>,
    pub reference_saved_memories: Option<bool>,
    pub nickname: Option<String>,
    pub occupation: Option<String>,
    pub style_preferences: Option<String>,
    pub more_about_you: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePatch {
    pub event_heartbeat_ms: Option<u64>,
    pub max_active_generations: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturePatch {
    pub enable_ollama: Option<bool>,
    pub enable_exports: Option<bool>,
    pub enable_extensions: Option<bool>,
    pub enable_mcp: Option<bool>,
    pub enable_llm_artifact_refinement: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPatch {
    pub enforce_local_ollama: Option<bool>,
    pub allow_remote_ollama: Option<bool>,
    pub allow_unsafe_ollama_model_management: Option<bool>,
    pub minimum_recommended_ollama_version: Option<String>,
    pub warn_on_windows_ollama_updater_risk: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatus {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Clone)]
pub struct ConfigManager {
    path: Arc<PathBuf>,
    current: Arc<RwLock<LoomServiceConfig>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigUpdateResult {
    pub config: LoomServiceConfig,
    pub restart: RestartClassification,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestartClassification {
    pub restart_required: bool,
    pub reason: Option<String>,
    pub changed_paths: Vec<String>,
}

impl Default for LoomServiceConfig {
    fn default() -> Self {
        Self {
            service: ServiceSection {
                host: DEFAULT_HOST.to_string(),
                port: DEFAULT_PORT,
                log_level: DEFAULT_LOG.to_string(),
                local_only: true,
            },
            database: DatabaseSection {
                path: DEFAULT_DB_PATH.to_string(),
            },
            ollama: OllamaSection {
                base_url: DEFAULT_OLLAMA_BASE_URL.to_string(),
                request_timeout_ms: DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS,
                first_chunk_timeout_ms: DEFAULT_OLLAMA_FIRST_CHUNK_TIMEOUT_MS,
                stream_idle_timeout_ms: DEFAULT_OLLAMA_STREAM_IDLE_TIMEOUT_MS,
            },
            providers: ProviderSection {
                default_main_model: "qwen3.5:9b".to_string(),
                default_quick_model: "llama3.2:latest".to_string(),
                main_provider_profile_id: None,
                main_model_id: None,
                response_mode_default: "auto".to_string(),
                profiles: vec![ProviderProfileConfig::default_ollama(
                    "qwen3.5:9b".to_string(),
                    DEFAULT_OLLAMA_BASE_URL.to_string(),
                )],
            },
            speech: SpeechToTextConfig::default(),
            ocr: OcrSection::default(),
            memory: MemorySection {
                enabled: true,
                reference_recent_looms: true,
                reference_saved_memories: false,
                nickname: String::new(),
                occupation: String::new(),
                style_preferences: String::new(),
                more_about_you: String::new(),
            },
            context: ContextSection {
                max_context_length: 8_192,
                default_num_ctx_small: 2_048,
                default_num_ctx_medium: 4_096,
                default_num_ctx_large: 8_192,
                max_recent_candidate_responses: 24,
            },
            runtime: RuntimeSection {
                event_heartbeat_ms: 15_000,
                max_active_generations: 2,
            },
            features: FeatureSection {
                enable_ollama: true,
                enable_exports: true,
                enable_extensions: false,
                enable_mcp: false,
                enable_llm_artifact_refinement: false,
            },
            security: SecuritySection::default(),
        }
    }
}

impl Default for SecuritySection {
    fn default() -> Self {
        Self {
            enforce_local_ollama: true,
            allow_remote_ollama: false,
            allow_unsafe_ollama_model_management: false,
            minimum_recommended_ollama_version: "0.17.1".to_string(),
            warn_on_windows_ollama_updater_risk: true,
        }
    }
}

impl Default for OcrSection {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: "tesseract".to_string(),
            command_path: None,
            pdf_rasterizer_command_path: None,
            language: "eng".to_string(),
            dpi: 200,
            timeout_seconds: 60,
            max_pages_per_file: 20,
            max_image_pixels: 24_000_000,
            temp_dir: None,
        }
    }
}

impl ServiceConfig {
    pub fn from_env() -> Result<Self, ServiceError> {
        let config_path = config_path_from_env();
        let mut config_file = load_or_create_config(&config_path)?;
        apply_env_overrides(&mut config_file)?;
        validate_config(&config_file)?;
        Self::from_config(config_path, config_file)
    }

    pub fn from_config(
        config_path: PathBuf,
        config_file: LoomServiceConfig,
    ) -> Result<Self, ServiceError> {
        validate_config(&config_file)?;
        let host = config_file
            .service
            .host
            .parse::<IpAddr>()
            .map_err(|error| {
                ServiceError::config(format!("service.host must be an IP address: {error}"))
            })?;

        Ok(Self {
            host,
            port: config_file.service.port,
            log_filter: config_file.service.log_level.clone(),
            db_path: PathBuf::from(&config_file.database.path),
            config_path,
            ollama: OllamaConfig::from_config_with_security(
                &config_file.ollama,
                &config_file.security,
            ),
            config_file,
        })
    }

    pub fn address(&self) -> SocketAddr {
        SocketAddr::new(self.host, self.port)
    }

    pub fn local_only(&self) -> bool {
        self.config_file.service.local_only
    }
}

impl OllamaConfig {
    fn from_config_with_security(config: &OllamaSection, security: &SecuritySection) -> Self {
        Self {
            base_url: config.base_url.trim_end_matches('/').to_string(),
            request_timeout: Duration::from_millis(config.request_timeout_ms),
            first_chunk_timeout: Duration::from_millis(config.first_chunk_timeout_ms),
            stream_idle_timeout: Duration::from_millis(config.stream_idle_timeout_ms),
            security: security.clone(),
        }
    }
}

impl ConfigManager {
    pub fn new(path: PathBuf, current: LoomServiceConfig) -> Self {
        Self {
            path: Arc::new(path),
            current: Arc::new(RwLock::new(current)),
        }
    }

    pub fn status(&self) -> ConfigStatus {
        ConfigStatus {
            status: "ready".to_string(),
            path: self.path.display().to_string(),
        }
    }

    pub fn current(&self) -> LoomServiceConfig {
        self.current
            .read()
            .expect("config manager read lock")
            .clone()
    }

    pub fn patch(&self, patch: ConfigPatch) -> Result<ConfigUpdateResult, ServiceError> {
        let current = self.current();
        let mut candidate = current.clone();
        apply_patch(&mut candidate, patch);
        validate_config(&candidate)?;
        let restart = classify_restart_requirement(&current, &candidate);
        write_config_atomic(&self.path, &candidate)?;
        *self.current.write().expect("config manager write lock") = candidate.clone();

        Ok(ConfigUpdateResult {
            config: candidate,
            restart,
        })
    }
}

pub fn config_path_from_env() -> PathBuf {
    PathBuf::from(
        env::var("LOOM_SERVICE_CONFIG_PATH").unwrap_or_else(|_| DEFAULT_CONFIG_PATH.to_string()),
    )
}

pub fn load_or_create_config(path: &Path) -> Result<LoomServiceConfig, ServiceError> {
    if !path.exists() {
        let config = LoomServiceConfig::default();
        write_config_atomic(path, &config)?;
        return Ok(config);
    }

    let text = fs::read_to_string(path).map_err(|error| {
        ServiceError::config(format!("failed to read config {}: {error}", path.display()))
    })?;
    parse_config(&text)
        .map_err(|error| ServiceError::config(format!("{} in {}", error.message, path.display())))
}

pub fn write_config_atomic(path: &Path, config: &LoomServiceConfig) -> Result<(), ServiceError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            ServiceError::config(format!(
                "failed to create config directory {}: {error}",
                parent.display()
            ))
        })?;
    }

    let serialized = serialize_config(config);
    let temp_path = path.with_extension(format!(
        "tmp-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));

    {
        let mut file = fs::File::create(&temp_path).map_err(|error| {
            ServiceError::config(format!(
                "failed to create temp config {}: {error}",
                temp_path.display()
            ))
        })?;
        file.write_all(CONFIG_HEADER.as_bytes()).map_err(|error| {
            ServiceError::config(format!("failed to write config header: {error}"))
        })?;
        file.write_all(serialized.as_bytes()).map_err(|error| {
            ServiceError::config(format!("failed to write config body: {error}"))
        })?;
        file.sync_all()
            .map_err(|error| ServiceError::config(format!("failed to sync config: {error}")))?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        ServiceError::config(format!(
            "failed to replace config {}: {error}",
            path.display()
        ))
    })
}

#[derive(Debug, Clone)]
struct ConfigParseError {
    message: String,
}

impl ConfigParseError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

fn serialize_config(config: &LoomServiceConfig) -> String {
    let mut output = String::new();

    writeln!(&mut output, "[service]").expect("write service config");
    writeln!(
        &mut output,
        "host = \"{}\"",
        escape_toml_string(&config.service.host)
    )
    .expect("write service host");
    writeln!(&mut output, "port = {}", config.service.port).expect("write service port");
    writeln!(
        &mut output,
        "logLevel = \"{}\"",
        escape_toml_string(&config.service.log_level)
    )
    .expect("write service log level");
    writeln!(&mut output, "localOnly = {}", config.service.local_only)
        .expect("write service local only");

    writeln!(&mut output, "\n[database]").expect("write database config");
    writeln!(
        &mut output,
        "path = \"{}\"",
        escape_toml_string(&config.database.path)
    )
    .expect("write database path");

    writeln!(&mut output, "\n[ollama]").expect("write ollama config");
    writeln!(
        &mut output,
        "baseUrl = \"{}\"",
        escape_toml_string(&config.ollama.base_url)
    )
    .expect("write ollama base url");
    writeln!(
        &mut output,
        "requestTimeoutMs = {}",
        config.ollama.request_timeout_ms
    )
    .expect("write ollama request timeout");
    writeln!(
        &mut output,
        "firstChunkTimeoutMs = {}",
        config.ollama.first_chunk_timeout_ms
    )
    .expect("write ollama first chunk timeout");
    writeln!(
        &mut output,
        "streamIdleTimeoutMs = {}",
        config.ollama.stream_idle_timeout_ms
    )
    .expect("write ollama stream idle timeout");

    writeln!(&mut output, "\n[providers]").expect("write provider config");
    writeln!(
        &mut output,
        "defaultMainModel = \"{}\"",
        escape_toml_string(&config.providers.default_main_model)
    )
    .expect("write default main model");
    writeln!(
        &mut output,
        "defaultQuickModel = \"{}\"",
        escape_toml_string(&config.providers.default_quick_model)
    )
    .expect("write default quick model");
    if let Some(profile_id) = &config.providers.main_provider_profile_id {
        writeln!(
            &mut output,
            "mainProviderProfileId = \"{}\"",
            escape_toml_string(profile_id)
        )
        .expect("write main provider profile id");
    }
    if let Some(model_id) = &config.providers.main_model_id {
        writeln!(
            &mut output,
            "mainModelId = \"{}\"",
            escape_toml_string(model_id)
        )
        .expect("write main model id");
    }
    writeln!(
        &mut output,
        "responseModeDefault = \"{}\"",
        escape_toml_string(&config.providers.response_mode_default)
    )
    .expect("write default response mode");
    for profile in &config.providers.profiles {
        write_provider_profile(&mut output, profile);
    }

    writeln!(&mut output, "\n[speech]").expect("write speech config");
    writeln!(&mut output, "enabled = {}", config.speech.enabled).expect("write speech enabled");
    writeln!(
        &mut output,
        "defaultProviderKind = \"{}\"",
        config.speech.default_provider_kind.as_config_str()
    )
    .expect("write speech provider kind");
    writeln!(
        &mut output,
        "allowCloudStt = {}",
        config.speech.allow_cloud_stt
    )
    .expect("write cloud stt policy");
    writeln!(
        &mut output,
        "persistAudio = {}",
        config.speech.persist_audio
    )
    .expect("write audio retention");
    writeln!(
        &mut output,
        "persistTranscript = {}",
        config.speech.persist_transcript
    )
    .expect("write transcript retention");
    writeln!(
        &mut output,
        "maxAudioBytes = {}",
        config.speech.max_audio_bytes
    )
    .expect("write max audio bytes");
    writeln!(
        &mut output,
        "allowedMimeTypes = {}",
        format_toml_string_array(&config.speech.allowed_mime_types)
    )
    .expect("write speech mime types");
    if let Some(default_language) = &config.speech.default_language {
        writeln!(
            &mut output,
            "defaultLanguage = \"{}\"",
            escape_toml_string(default_language)
        )
        .expect("write speech language");
    }
    if let Some(provider_profile_id) = &config.speech.provider_profile_id {
        writeln!(
            &mut output,
            "providerProfileId = \"{}\"",
            escape_toml_string(provider_profile_id)
        )
        .expect("write speech provider profile");
    }
    if let Some(local_command_path) = &config.speech.local_command_path {
        writeln!(
            &mut output,
            "localCommandPath = \"{}\"",
            escape_toml_string(local_command_path)
        )
        .expect("write speech local command path");
    }
    writeln!(
        &mut output,
        "localCommandArgs = {}",
        format_toml_string_array(&config.speech.local_command_args)
    )
    .expect("write speech local command args");
    writeln!(
        &mut output,
        "localCommandTimeoutMs = {}",
        config.speech.local_command_timeout_ms
    )
    .expect("write speech local command timeout");
    if let Some(local_temp_dir) = &config.speech.local_temp_dir {
        writeln!(
            &mut output,
            "localTempDir = \"{}\"",
            escape_toml_string(local_temp_dir)
        )
        .expect("write speech local temp dir");
    }
    writeln!(
        &mut output,
        "warnings = {}",
        format_toml_string_array(&config.speech.warnings)
    )
    .expect("write speech warnings");
    writeln!(
        &mut output,
        "localCommandOutputMode = \"{}\"",
        config.speech.local_command_output_mode.as_config_str()
    )
    .expect("write speech local command output mode");
    writeln!(
        &mut output,
        "localCommandTranscriptFileExtension = \"{}\"",
        escape_toml_string(&config.speech.local_command_transcript_file_extension)
    )
    .expect("write speech transcript file extension");

    writeln!(&mut output, "\n[ocr]").expect("write ocr config");
    writeln!(&mut output, "enabled = {}", config.ocr.enabled).expect("write ocr enabled");
    writeln!(
        &mut output,
        "provider = \"{}\"",
        escape_toml_string(&config.ocr.provider)
    )
    .expect("write ocr provider");
    if let Some(command_path) = &config.ocr.command_path {
        writeln!(
            &mut output,
            "commandPath = \"{}\"",
            escape_toml_string(command_path)
        )
        .expect("write ocr command path");
    }
    if let Some(command_path) = &config.ocr.pdf_rasterizer_command_path {
        writeln!(
            &mut output,
            "pdfRasterizerCommandPath = \"{}\"",
            escape_toml_string(command_path)
        )
        .expect("write pdf rasterizer command path");
    }
    writeln!(
        &mut output,
        "language = \"{}\"",
        escape_toml_string(&config.ocr.language)
    )
    .expect("write ocr language");
    writeln!(&mut output, "dpi = {}", config.ocr.dpi).expect("write ocr dpi");
    writeln!(
        &mut output,
        "timeoutSeconds = {}",
        config.ocr.timeout_seconds
    )
    .expect("write ocr timeout");
    writeln!(
        &mut output,
        "maxPagesPerFile = {}",
        config.ocr.max_pages_per_file
    )
    .expect("write ocr page limit");
    writeln!(
        &mut output,
        "maxImagePixels = {}",
        config.ocr.max_image_pixels
    )
    .expect("write ocr pixel limit");
    if let Some(temp_dir) = &config.ocr.temp_dir {
        writeln!(
            &mut output,
            "tempDir = \"{}\"",
            escape_toml_string(temp_dir)
        )
        .expect("write ocr temp dir");
    }

    writeln!(&mut output, "\n[memory]").expect("write memory config");
    writeln!(&mut output, "enabled = {}", config.memory.enabled).expect("write memory enabled");
    writeln!(
        &mut output,
        "referenceRecentLooms = {}",
        config.memory.reference_recent_looms
    )
    .expect("write reference recent Looms");
    writeln!(
        &mut output,
        "referenceSavedMemories = {}",
        config.memory.reference_saved_memories
    )
    .expect("write reference saved memories");
    writeln!(
        &mut output,
        "nickname = \"{}\"",
        escape_toml_string(&config.memory.nickname)
    )
    .expect("write memory nickname");
    writeln!(
        &mut output,
        "occupation = \"{}\"",
        escape_toml_string(&config.memory.occupation)
    )
    .expect("write memory occupation");
    writeln!(
        &mut output,
        "stylePreferences = \"{}\"",
        escape_toml_string(&config.memory.style_preferences)
    )
    .expect("write memory style preferences");
    writeln!(
        &mut output,
        "moreAboutYou = \"{}\"",
        escape_toml_string(&config.memory.more_about_you)
    )
    .expect("write memory more about you");

    writeln!(&mut output, "\n[context]").expect("write context config");
    writeln!(
        &mut output,
        "maxContextLength = {}",
        config.context.max_context_length
    )
    .expect("write max context length");
    writeln!(
        &mut output,
        "defaultNumCtxSmall = {}",
        config.context.default_num_ctx_small
    )
    .expect("write small ctx");
    writeln!(
        &mut output,
        "defaultNumCtxMedium = {}",
        config.context.default_num_ctx_medium
    )
    .expect("write medium ctx");
    writeln!(
        &mut output,
        "defaultNumCtxLarge = {}",
        config.context.default_num_ctx_large
    )
    .expect("write large ctx");
    writeln!(
        &mut output,
        "maxRecentCandidateResponses = {}",
        config.context.max_recent_candidate_responses
    )
    .expect("write max recent candidate responses");

    writeln!(&mut output, "\n[runtime]").expect("write runtime config");
    writeln!(
        &mut output,
        "eventHeartbeatMs = {}",
        config.runtime.event_heartbeat_ms
    )
    .expect("write heartbeat");
    writeln!(
        &mut output,
        "maxActiveGenerations = {}",
        config.runtime.max_active_generations
    )
    .expect("write active generations");

    writeln!(&mut output, "\n[features]").expect("write feature config");
    writeln!(
        &mut output,
        "enableOllama = {}",
        config.features.enable_ollama
    )
    .expect("write enable ollama");
    writeln!(
        &mut output,
        "enableExports = {}",
        config.features.enable_exports
    )
    .expect("write enable exports");
    writeln!(
        &mut output,
        "enableExtensions = {}",
        config.features.enable_extensions
    )
    .expect("write enable extensions");
    writeln!(&mut output, "enableMcp = {}", config.features.enable_mcp).expect("write enable mcp");
    writeln!(
        &mut output,
        "enableLlmArtifactRefinement = {}",
        config.features.enable_llm_artifact_refinement
    )
    .expect("write enable llm artifact refinement");

    writeln!(&mut output, "\n[security]").expect("write security config");
    writeln!(
        &mut output,
        "enforceLocalOllama = {}",
        config.security.enforce_local_ollama
    )
    .expect("write enforce local ollama");
    writeln!(
        &mut output,
        "allowRemoteOllama = {}",
        config.security.allow_remote_ollama
    )
    .expect("write allow remote ollama");
    writeln!(
        &mut output,
        "allowUnsafeOllamaModelManagement = {}",
        config.security.allow_unsafe_ollama_model_management
    )
    .expect("write allow unsafe model management");
    writeln!(
        &mut output,
        "minimumRecommendedOllamaVersion = \"{}\"",
        escape_toml_string(&config.security.minimum_recommended_ollama_version)
    )
    .expect("write minimum recommended ollama version");
    writeln!(
        &mut output,
        "warnOnWindowsOllamaUpdaterRisk = {}",
        config.security.warn_on_windows_ollama_updater_risk
    )
    .expect("write windows ollama updater warning");

    output
}

fn write_provider_profile(output: &mut String, profile: &ProviderProfileConfig) {
    writeln!(output, "\n[[providers.profiles]]").expect("write provider profile header");
    writeln!(output, "id = \"{}\"", escape_toml_string(&profile.id))
        .expect("write provider profile id");
    writeln!(
        output,
        "providerKind = \"{}\"",
        profile.provider_kind.as_config_str()
    )
    .expect("write provider kind");
    writeln!(
        output,
        "transportKind = \"{}\"",
        profile.transport_kind.as_config_str()
    )
    .expect("write provider transport kind");
    writeln!(output, "vendor = \"{}\"", profile.vendor.as_config_str())
        .expect("write provider vendor");
    writeln!(
        output,
        "displayName = \"{}\"",
        escape_toml_string(&profile.display_name)
    )
    .expect("write provider display name");
    writeln!(output, "enabled = {}", profile.enabled).expect("write provider enabled");
    writeln!(output, "experimental = {}", profile.experimental)
        .expect("write provider experimental flag");
    if let Some(base_url) = &profile.base_url {
        writeln!(output, "baseUrl = \"{}\"", escape_toml_string(base_url))
            .expect("write provider base url");
    }
    if let Some(default_model) = &profile.default_model {
        writeln!(
            output,
            "defaultModel = \"{}\"",
            escape_toml_string(default_model)
        )
        .expect("write provider default model");
    }
    writeln!(output, "requiresSecret = {}", profile.requires_secret)
        .expect("write provider requires secret");
    if let Some(secret_ref) = &profile.secret_ref {
        writeln!(output, "secretRef = \"{}\"", escape_toml_string(secret_ref))
            .expect("write provider secret ref");
    }
    writeln!(
        output,
        "modelDiscoveryEnabled = {}",
        profile.model_discovery.enabled
    )
    .expect("write model discovery enabled");
    if let Some(endpoint_path) = &profile.model_discovery.endpoint_path {
        writeln!(
            output,
            "modelDiscoveryEndpointPath = \"{}\"",
            escape_toml_string(endpoint_path)
        )
        .expect("write model discovery endpoint");
    }
    if let Some(refresh) = profile.model_discovery.refresh_interval_seconds {
        writeln!(output, "modelDiscoveryRefreshIntervalSeconds = {refresh}")
            .expect("write model discovery refresh");
    }
    write_optional_f32(output, "temperature", profile.request_defaults.temperature);
    write_optional_f32(output, "topP", profile.request_defaults.top_p);
    write_optional_u32(output, "numCtx", profile.request_defaults.num_ctx);
    write_optional_u32(output, "numPredict", profile.request_defaults.num_predict);
    write_optional_bool(output, "think", profile.request_defaults.think);
    write_optional_bool(output, "stream", profile.request_defaults.stream);
    writeln!(
        output,
        "localOnlyRequired = {}",
        profile.security.local_only_required
    )
    .expect("write local only required");
    writeln!(
        output,
        "allowRemoteEndpoint = {}",
        profile.security.allow_remote_endpoint
    )
    .expect("write allow remote endpoint");
    writeln!(
        output,
        "allowInsecureHttpRemote = {}",
        profile.security.allow_insecure_http_remote
    )
    .expect("write allow insecure http remote");
    writeln!(
        output,
        "allowUnsafeModelManagement = {}",
        profile.security.allow_unsafe_model_management
    )
    .expect("write unsafe model management");
    writeln!(
        output,
        "supportsStreaming = {}",
        profile.capabilities.supports_streaming
    )
    .expect("write streaming capability");
    writeln!(
        output,
        "supportsCancellation = {}",
        profile.capabilities.supports_cancellation
    )
    .expect("write cancellation capability");
    writeln!(
        output,
        "supportsModelListing = {}",
        profile.capabilities.supports_model_listing
    )
    .expect("write model listing capability");
    writeln!(
        output,
        "supportsThinking = {}",
        profile.capabilities.supports_thinking
    )
    .expect("write thinking capability");
    writeln!(
        output,
        "supportsSystemPrompt = {}",
        profile.capabilities.supports_system_prompt
    )
    .expect("write system prompt capability");
    write_optional_bool(
        output,
        "supportsJsonMode",
        profile.capabilities.supports_json_mode,
    );
}

fn write_optional_bool(output: &mut String, key: &str, value: Option<bool>) {
    if let Some(value) = value {
        writeln!(output, "{key} = {value}").expect("write optional bool");
    }
}

fn write_optional_u32(output: &mut String, key: &str, value: Option<u32>) {
    if let Some(value) = value {
        writeln!(output, "{key} = {value}").expect("write optional u32");
    }
}

fn write_optional_f32(output: &mut String, key: &str, value: Option<f32>) {
    if let Some(value) = value {
        writeln!(output, "{key} = {value}").expect("write optional f32");
    }
}

fn format_toml_string_array(values: &[String]) -> String {
    let quoted = values
        .iter()
        .map(|value| format!("\"{}\"", escape_toml_string(value)))
        .collect::<Vec<_>>()
        .join(", ");
    format!("[{quoted}]")
}

fn parse_config(text: &str) -> Result<LoomServiceConfig, ConfigParseError> {
    let mut config = LoomServiceConfig::default();
    let mut section = String::new();
    let mut parsed_provider_profiles = false;

    for (line_index, raw_line) in text.lines().enumerate() {
        let line_number = line_index + 1;
        let line = strip_toml_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }

        if line == "[[providers.profiles]]" {
            if !parsed_provider_profiles {
                config.providers.profiles.clear();
                parsed_provider_profiles = true;
            }
            config.providers.profiles.push(ProviderProfileConfig {
                id: String::new(),
                provider_kind: ProviderKind::Ollama,
                transport_kind: ProviderTransportKind::Ollama,
                vendor: ProviderVendor::Ollama,
                display_name: String::new(),
                enabled: true,
                experimental: false,
                base_url: None,
                default_model: None,
                requires_secret: false,
                secret_ref: None,
                model_discovery: ProviderModelDiscoveryConfig::default(),
                request_defaults: ProviderRequestDefaultsConfig::default(),
                security: ProviderSecurityPolicyConfig::default(),
                capabilities: ProviderCapabilitiesConfig::default(),
                metadata_json: None,
            });
            section = "providers.profiles".to_string();
            continue;
        }

        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
        {
            section = name.trim().to_string();
            continue;
        }

        let (key, value) = line.split_once('=').ok_or_else(|| {
            ConfigParseError::new(format!("line {line_number}: expected key = value"))
        })?;
        set_config_value(&mut config, &section, key.trim(), value.trim(), line_number)?;
    }

    Ok(config)
}

fn set_config_value(
    config: &mut LoomServiceConfig,
    section: &str,
    key: &str,
    value: &str,
    line_number: usize,
) -> Result<(), ConfigParseError> {
    match (section, key) {
        ("service", "host") => config.service.host = parse_toml_string(value, line_number)?,
        ("service", "port") => config.service.port = parse_toml_u16(value, line_number)?,
        ("service", "logLevel") => {
            config.service.log_level = parse_toml_string(value, line_number)?;
        }
        ("service", "localOnly") => {
            config.service.local_only = parse_toml_bool(value, line_number)?
        }
        ("database", "path") => config.database.path = parse_toml_string(value, line_number)?,
        ("ollama", "baseUrl") => config.ollama.base_url = parse_toml_string(value, line_number)?,
        ("ollama", "requestTimeoutMs") => {
            config.ollama.request_timeout_ms = parse_toml_u64(value, line_number)?;
        }
        ("ollama", "firstChunkTimeoutMs") => {
            config.ollama.first_chunk_timeout_ms = parse_toml_u64(value, line_number)?;
        }
        ("ollama", "streamIdleTimeoutMs") => {
            config.ollama.stream_idle_timeout_ms = parse_toml_u64(value, line_number)?;
        }
        ("providers", "defaultMainModel") => {
            config.providers.default_main_model = parse_toml_string(value, line_number)?;
        }
        ("providers", "defaultQuickModel") => {
            config.providers.default_quick_model = parse_toml_string(value, line_number)?;
        }
        ("providers", "mainProviderProfileId") => {
            config.providers.main_provider_profile_id =
                Some(parse_toml_string(value, line_number)?);
        }
        ("providers", "mainModelId") => {
            config.providers.main_model_id = Some(parse_toml_string(value, line_number)?);
        }
        ("providers", "responseModeDefault") => {
            config.providers.response_mode_default = parse_toml_string(value, line_number)?;
        }
        ("providers.profiles", key) => {
            let Some(profile) = config.providers.profiles.last_mut() else {
                return Err(ConfigParseError::new(format!(
                    "line {line_number}: providers.profiles key appears before profile table"
                )));
            };
            set_provider_profile_value(profile, key, value, line_number)?;
        }
        ("speech", "enabled") => config.speech.enabled = parse_toml_bool(value, line_number)?,
        ("speech", "defaultProviderKind") => {
            let parsed = parse_toml_string(value, line_number)?;
            config.speech.default_provider_kind = SpeechToTextProviderKind::parse(&parsed)
                .ok_or_else(|| {
                    ConfigParseError::new(format!(
                        "line {line_number}: unknown speech.defaultProviderKind {parsed}"
                    ))
                })?;
        }
        ("speech", "allowCloudStt") => {
            config.speech.allow_cloud_stt = parse_toml_bool(value, line_number)?;
        }
        ("speech", "persistAudio") => {
            config.speech.persist_audio = parse_toml_bool(value, line_number)?;
        }
        ("speech", "persistTranscript") => {
            config.speech.persist_transcript = parse_toml_bool(value, line_number)?;
        }
        ("speech", "maxAudioBytes") => {
            config.speech.max_audio_bytes = parse_toml_u64(value, line_number)?;
        }
        ("speech", "allowedMimeTypes") => {
            config.speech.allowed_mime_types = parse_toml_string_array(value, line_number)?;
        }
        ("speech", "defaultLanguage") => {
            config.speech.default_language = Some(parse_toml_string(value, line_number)?);
        }
        ("speech", "providerProfileId") => {
            config.speech.provider_profile_id = Some(parse_toml_string(value, line_number)?);
        }
        ("speech", "localCommandPath") => {
            config.speech.local_command_path = Some(parse_toml_string(value, line_number)?);
        }
        ("speech", "localCommandArgs") => {
            config.speech.local_command_args = parse_toml_string_array(value, line_number)?;
        }
        ("speech", "localCommandTimeoutMs") => {
            config.speech.local_command_timeout_ms = parse_toml_u64(value, line_number)?;
        }
        ("speech", "localTempDir") => {
            config.speech.local_temp_dir = Some(parse_toml_string(value, line_number)?);
        }
        ("speech", "warnings") => {
            config.speech.warnings = parse_toml_string_array(value, line_number)?;
        }
        ("speech", "localCommandOutputMode") => {
            let parsed = parse_toml_string(value, line_number)?;
            config.speech.local_command_output_mode =
                crate::speech::LocalCommandOutputMode::parse(&parsed).ok_or_else(|| {
                    ConfigParseError::new(format!(
                        "line {line_number}: unknown speech.localCommandOutputMode {parsed}"
                    ))
                })?;
        }
        ("speech", "localCommandTranscriptFileExtension") => {
            config.speech.local_command_transcript_file_extension =
                parse_toml_string(value, line_number)?;
        }
        ("ocr", "enabled") => config.ocr.enabled = parse_toml_bool(value, line_number)?,
        ("ocr", "provider") => config.ocr.provider = parse_toml_string(value, line_number)?,
        ("ocr", "commandPath") => {
            config.ocr.command_path = Some(parse_toml_string(value, line_number)?);
        }
        ("ocr", "pdfRasterizerCommandPath") => {
            config.ocr.pdf_rasterizer_command_path = Some(parse_toml_string(value, line_number)?);
        }
        ("ocr", "language") => config.ocr.language = parse_toml_string(value, line_number)?,
        ("ocr", "dpi") => config.ocr.dpi = parse_toml_u32(value, line_number)?,
        ("ocr", "timeoutSeconds") => {
            config.ocr.timeout_seconds = parse_toml_u64(value, line_number)?;
        }
        ("ocr", "maxPagesPerFile") => {
            config.ocr.max_pages_per_file = parse_toml_u32(value, line_number)?;
        }
        ("ocr", "maxImagePixels") => {
            config.ocr.max_image_pixels = parse_toml_u64(value, line_number)?;
        }
        ("ocr", "tempDir") => {
            config.ocr.temp_dir = Some(parse_toml_string(value, line_number)?);
        }
        ("memory", "enabled") => {
            config.memory.enabled = parse_toml_bool(value, line_number)?;
        }
        ("memory", "referenceRecentLooms") => {
            config.memory.reference_recent_looms = parse_toml_bool(value, line_number)?;
        }
        ("memory", "referenceSavedMemories") => {
            config.memory.reference_saved_memories = parse_toml_bool(value, line_number)?;
        }
        ("memory", "nickname") => {
            config.memory.nickname = parse_toml_string(value, line_number)?;
        }
        ("memory", "occupation") => {
            config.memory.occupation = parse_toml_string(value, line_number)?;
        }
        ("memory", "stylePreferences") => {
            config.memory.style_preferences = parse_toml_string(value, line_number)?;
        }
        ("memory", "moreAboutYou") => {
            config.memory.more_about_you = parse_toml_string(value, line_number)?;
        }
        ("context", "maxContextLength") => {
            config.context.max_context_length = parse_toml_u32(value, line_number)?;
        }
        ("context", "defaultNumCtxSmall") => {
            config.context.default_num_ctx_small = parse_toml_u32(value, line_number)?;
        }
        ("context", "defaultNumCtxMedium") => {
            config.context.default_num_ctx_medium = parse_toml_u32(value, line_number)?;
        }
        ("context", "defaultNumCtxLarge") => {
            config.context.default_num_ctx_large = parse_toml_u32(value, line_number)?;
        }
        ("context", "maxRecentCandidateResponses") => {
            config.context.max_recent_candidate_responses = parse_toml_u32(value, line_number)?;
        }
        ("runtime", "eventHeartbeatMs") => {
            config.runtime.event_heartbeat_ms = parse_toml_u64(value, line_number)?;
        }
        ("runtime", "maxActiveGenerations") => {
            config.runtime.max_active_generations = parse_toml_u32(value, line_number)?;
        }
        ("features", "enableOllama") => {
            config.features.enable_ollama = parse_toml_bool(value, line_number)?;
        }
        ("features", "enableExports") => {
            config.features.enable_exports = parse_toml_bool(value, line_number)?;
        }
        ("features", "enableExtensions") => {
            config.features.enable_extensions = parse_toml_bool(value, line_number)?;
        }
        ("features", "enableMcp") => {
            config.features.enable_mcp = parse_toml_bool(value, line_number)?;
        }
        ("features", "enableLlmArtifactRefinement") => {
            config.features.enable_llm_artifact_refinement = parse_toml_bool(value, line_number)?;
        }
        ("security", "enforceLocalOllama") => {
            config.security.enforce_local_ollama = parse_toml_bool(value, line_number)?;
        }
        ("security", "allowRemoteOllama") => {
            config.security.allow_remote_ollama = parse_toml_bool(value, line_number)?;
        }
        ("security", "allowUnsafeOllamaModelManagement") => {
            config.security.allow_unsafe_ollama_model_management =
                parse_toml_bool(value, line_number)?;
        }
        ("security", "minimumRecommendedOllamaVersion") => {
            config.security.minimum_recommended_ollama_version =
                parse_toml_string(value, line_number)?;
        }
        ("security", "warnOnWindowsOllamaUpdaterRisk") => {
            config.security.warn_on_windows_ollama_updater_risk =
                parse_toml_bool(value, line_number)?;
        }
        ("", _) => {
            return Err(ConfigParseError::new(format!(
                "line {line_number}: key appears before a section"
            )));
        }
        _ => {
            return Err(ConfigParseError::new(format!(
                "line {line_number}: unknown config key {section}.{key}"
            )));
        }
    }

    Ok(())
}

fn set_provider_profile_value(
    profile: &mut ProviderProfileConfig,
    key: &str,
    value: &str,
    line_number: usize,
) -> Result<(), ConfigParseError> {
    match key {
        "id" => profile.id = parse_toml_string(value, line_number)?,
        "providerKind" => {
            let parsed = parse_toml_string(value, line_number)?;
            profile.provider_kind = ProviderKind::parse(&parsed).ok_or_else(|| {
                ConfigParseError::new(format!("line {line_number}: unknown providerKind {parsed}"))
            })?;
        }
        "transportKind" => {
            let parsed = parse_toml_string(value, line_number)?;
            profile.transport_kind = ProviderTransportKind::parse(&parsed).ok_or_else(|| {
                ConfigParseError::new(format!(
                    "line {line_number}: unknown transportKind {parsed}"
                ))
            })?;
        }
        "vendor" => {
            let parsed = parse_toml_string(value, line_number)?;
            profile.vendor = ProviderVendor::parse(&parsed).ok_or_else(|| {
                ConfigParseError::new(format!("line {line_number}: unknown vendor {parsed}"))
            })?;
        }
        "displayName" => profile.display_name = parse_toml_string(value, line_number)?,
        "enabled" => profile.enabled = parse_toml_bool(value, line_number)?,
        "experimental" => profile.experimental = parse_toml_bool(value, line_number)?,
        "baseUrl" => {
            profile.base_url = Some(
                parse_toml_string(value, line_number)?
                    .trim_end_matches('/')
                    .to_string(),
            );
        }
        "defaultModel" => profile.default_model = Some(parse_toml_string(value, line_number)?),
        "requiresSecret" => profile.requires_secret = parse_toml_bool(value, line_number)?,
        "secretRef" => profile.secret_ref = Some(parse_toml_string(value, line_number)?),
        "modelDiscoveryEnabled" => {
            profile.model_discovery.enabled = parse_toml_bool(value, line_number)?;
        }
        "modelDiscoveryEndpointPath" => {
            profile.model_discovery.endpoint_path = Some(parse_toml_string(value, line_number)?);
        }
        "modelDiscoveryRefreshIntervalSeconds" => {
            profile.model_discovery.refresh_interval_seconds =
                Some(parse_toml_u64(value, line_number)?);
        }
        "temperature" => {
            profile.request_defaults.temperature = Some(parse_toml_f32(value, line_number)?);
        }
        "topP" => profile.request_defaults.top_p = Some(parse_toml_f32(value, line_number)?),
        "numCtx" => profile.request_defaults.num_ctx = Some(parse_toml_u32(value, line_number)?),
        "numPredict" => {
            profile.request_defaults.num_predict = Some(parse_toml_u32(value, line_number)?);
        }
        "think" => profile.request_defaults.think = Some(parse_toml_bool(value, line_number)?),
        "stream" => profile.request_defaults.stream = Some(parse_toml_bool(value, line_number)?),
        "localOnlyRequired" => {
            profile.security.local_only_required = parse_toml_bool(value, line_number)?;
        }
        "allowRemoteEndpoint" => {
            profile.security.allow_remote_endpoint = parse_toml_bool(value, line_number)?;
        }
        "allowInsecureHttpRemote" => {
            profile.security.allow_insecure_http_remote = parse_toml_bool(value, line_number)?;
        }
        "allowUnsafeModelManagement" => {
            profile.security.allow_unsafe_model_management = parse_toml_bool(value, line_number)?;
        }
        "supportsStreaming" => {
            profile.capabilities.supports_streaming = parse_toml_bool(value, line_number)?;
        }
        "supportsCancellation" => {
            profile.capabilities.supports_cancellation = parse_toml_bool(value, line_number)?;
        }
        "supportsModelListing" => {
            profile.capabilities.supports_model_listing = parse_toml_bool(value, line_number)?;
        }
        "supportsThinking" => {
            profile.capabilities.supports_thinking = parse_toml_bool(value, line_number)?;
        }
        "supportsSystemPrompt" => {
            profile.capabilities.supports_system_prompt = parse_toml_bool(value, line_number)?;
        }
        "supportsJsonMode" => {
            profile.capabilities.supports_json_mode = Some(parse_toml_bool(value, line_number)?);
        }
        key if is_forbidden_config_key(key) => {
            return Err(ConfigParseError::new(format!(
                "line {line_number}: provider config must not contain secret/raw-thinking field {key}"
            )));
        }
        _ => {
            return Err(ConfigParseError::new(format!(
                "line {line_number}: unknown provider profile key {key}"
            )));
        }
    }
    Ok(())
}

fn strip_toml_comment(line: &str) -> &str {
    let mut escaped = false;
    let mut quoted = false;
    for (index, ch) in line.char_indices() {
        match ch {
            '\\' if quoted && !escaped => {
                escaped = true;
            }
            '"' if !escaped => {
                quoted = !quoted;
            }
            '#' if !quoted => {
                return &line[..index];
            }
            _ => {
                escaped = false;
            }
        }
    }
    line
}

fn parse_toml_string(value: &str, line_number: usize) -> Result<String, ConfigParseError> {
    let value = value.trim();
    let Some(inner) = value
        .strip_prefix('"')
        .and_then(|stripped| stripped.strip_suffix('"'))
    else {
        return Err(ConfigParseError::new(format!(
            "line {line_number}: expected quoted string"
        )));
    };

    let mut parsed = String::new();
    let mut chars = inner.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            let Some(next) = chars.next() else {
                return Err(ConfigParseError::new(format!(
                    "line {line_number}: incomplete string escape"
                )));
            };
            match next {
                '"' => parsed.push('"'),
                '\\' => parsed.push('\\'),
                'n' => parsed.push('\n'),
                't' => parsed.push('\t'),
                other => {
                    return Err(ConfigParseError::new(format!(
                        "line {line_number}: unsupported string escape \\{other}"
                    )));
                }
            }
        } else {
            parsed.push(ch);
        }
    }

    Ok(parsed)
}

fn parse_toml_bool(value: &str, line_number: usize) -> Result<bool, ConfigParseError> {
    match value.trim() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(ConfigParseError::new(format!(
            "line {line_number}: expected boolean"
        ))),
    }
}

fn parse_toml_string_array(
    value: &str,
    line_number: usize,
) -> Result<Vec<String>, ConfigParseError> {
    let value = value.trim();
    let Some(inner) = value
        .strip_prefix('[')
        .and_then(|stripped| stripped.strip_suffix(']'))
    else {
        return Err(ConfigParseError::new(format!(
            "line {line_number}: expected string array"
        )));
    };
    if inner.trim().is_empty() {
        return Ok(Vec::new());
    }

    inner
        .split(',')
        .map(|item| parse_toml_string(item.trim(), line_number))
        .collect()
}

fn parse_toml_u16(value: &str, line_number: usize) -> Result<u16, ConfigParseError> {
    value.trim().parse::<u16>().map_err(|error| {
        ConfigParseError::new(format!("line {line_number}: expected u16 number: {error}"))
    })
}

fn parse_toml_u32(value: &str, line_number: usize) -> Result<u32, ConfigParseError> {
    value.trim().parse::<u32>().map_err(|error| {
        ConfigParseError::new(format!("line {line_number}: expected u32 number: {error}"))
    })
}

fn parse_toml_u64(value: &str, line_number: usize) -> Result<u64, ConfigParseError> {
    value.trim().parse::<u64>().map_err(|error| {
        ConfigParseError::new(format!("line {line_number}: expected u64 number: {error}"))
    })
}

fn parse_toml_f32(value: &str, line_number: usize) -> Result<f32, ConfigParseError> {
    value.trim().parse::<f32>().map_err(|error| {
        ConfigParseError::new(format!("line {line_number}: expected f32 number: {error}"))
    })
}

fn is_forbidden_config_key(key: &str) -> bool {
    matches!(
        key,
        "api_key"
            | "apiKey"
            | "apikey"
            | "token"
            | "bearer"
            | "authorization"
            | "bearer_token"
            | "bearerToken"
            | "password"
            | "credential"
            | "client_secret"
            | "private_key"
            | "refresh_token"
            | "refreshToken"
            | "raw_thinking"
            | "thinking_text"
            | "chain_of_thought"
            | "hidden_reasoning"
    )
}

fn escape_toml_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\t', "\\t")
}

pub fn validate_config(config: &LoomServiceConfig) -> Result<(), ServiceError> {
    let host = config.service.host.parse::<IpAddr>().map_err(|error| {
        ServiceError::config(format!("service.host must be an IP address: {error}"))
    })?;
    if config.service.local_only && !host.is_loopback() {
        return Err(ServiceError::config(
            "service.host must be loopback when service.localOnly is true",
        ));
    }
    if config.service.port == 0 {
        return Err(ServiceError::config("service.port must be greater than 0"));
    }
    if config.database.path.trim().is_empty() {
        return Err(ServiceError::config("database.path must not be empty"));
    }
    if config.ollama.base_url.trim().is_empty() {
        return Err(ServiceError::config("ollama.baseUrl must not be empty"));
    }
    validate_provider_base_url("ollama.baseUrl", &config.ollama.base_url)?;
    if config.ollama.request_timeout_ms == 0
        || config.ollama.first_chunk_timeout_ms == 0
        || config.ollama.stream_idle_timeout_ms == 0
    {
        return Err(ServiceError::config("ollama timeouts must be positive"));
    }
    if config
        .security
        .minimum_recommended_ollama_version
        .trim()
        .is_empty()
    {
        return Err(ServiceError::config(
            "security.minimumRecommendedOllamaVersion must not be empty",
        ));
    }
    if config.runtime.event_heartbeat_ms == 0 {
        return Err(ServiceError::config(
            "runtime.eventHeartbeatMs must be positive",
        ));
    }
    if config.runtime.max_active_generations < 1 {
        return Err(ServiceError::config(
            "runtime.maxActiveGenerations must be at least 1",
        ));
    }
    if config.context.max_context_length < 512 || config.context.max_context_length > 262_144 {
        return Err(ServiceError::config(
            "context.maxContextLength must be between 512 and 262144",
        ));
    }
    if config.context.max_recent_candidate_responses < 2
        || config.context.max_recent_candidate_responses > 200
    {
        return Err(ServiceError::config(
            "context.maxRecentCandidateResponses must be between 2 and 200",
        ));
    }
    reject_forbidden_config_value(&serde_json::to_value(config).map_err(|error| {
        ServiceError::config(format!(
            "failed to inspect config for forbidden fields: {error}"
        ))
    })?)?;
    validate_provider_profiles(&config.providers.profiles)?;
    validate_main_provider_assignment(&config.providers)?;
    validate_speech_config(&config.speech)?;
    validate_ocr_config(&config.ocr)?;

    Ok(())
}

fn validate_main_provider_assignment(providers: &ProviderSection) -> Result<(), ServiceError> {
    let Some(profile_id) = providers.main_provider_profile_id.as_deref() else {
        if providers.main_model_id.is_some() {
            return Err(ServiceError::config(
                "providers.mainProviderProfileId is required when providers.mainModelId is set",
            ));
        }
        return Ok(());
    };
    if profile_id.trim().is_empty() {
        return Err(ServiceError::config(
            "providers.mainProviderProfileId must not be empty when set",
        ));
    }
    let model_id = providers.main_model_id.as_deref().ok_or_else(|| {
        ServiceError::config(
            "providers.mainModelId is required when providers.mainProviderProfileId is set",
        )
    })?;
    if model_id.trim().is_empty() {
        return Err(ServiceError::config(
            "providers.mainModelId must not be empty when set",
        ));
    }
    let Some(profile) = providers
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
    else {
        return Err(ServiceError::config(format!(
            "providers.mainProviderProfileId '{profile_id}' does not match a provider profile",
        )));
    };
    if !profile.enabled {
        return Err(ServiceError::config(format!(
            "providers.mainProviderProfileId '{profile_id}' must be enabled before selection",
        )));
    }
    Ok(())
}

fn validate_ocr_config(config: &OcrSection) -> Result<(), ServiceError> {
    if config.provider != "tesseract" {
        return Err(ServiceError::config(
            "ocr.provider must be \"tesseract\" for the v1 OCR pipeline",
        ));
    }
    if config.enabled && config.language.trim().is_empty() {
        return Err(ServiceError::config(
            "ocr.language must not be empty when OCR is enabled",
        ));
    }
    if !(100..=600).contains(&config.dpi) {
        return Err(ServiceError::config("ocr.dpi must be between 100 and 600"));
    }
    if config.timeout_seconds == 0 || config.timeout_seconds > 600 {
        return Err(ServiceError::config(
            "ocr.timeoutSeconds must be between 1 and 600",
        ));
    }
    if config.max_pages_per_file == 0 || config.max_pages_per_file > 200 {
        return Err(ServiceError::config(
            "ocr.maxPagesPerFile must be between 1 and 200",
        ));
    }
    if config.max_image_pixels < 1_000_000 || config.max_image_pixels > 200_000_000 {
        return Err(ServiceError::config(
            "ocr.maxImagePixels must be between 1000000 and 200000000",
        ));
    }
    Ok(())
}

fn validate_provider_base_url(path: &str, base_url: &str) -> Result<(), ServiceError> {
    let parsed = reqwest::Url::parse(base_url)
        .map_err(|error| ServiceError::config(format!("{path} is invalid: {error}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ServiceError::config(format!(
            "{path} must use http or https"
        )));
    }
    if parsed.host_str().is_none() {
        return Err(ServiceError::config(format!("{path} must include a host")));
    }
    Ok(())
}

fn apply_env_overrides(config: &mut LoomServiceConfig) -> Result<(), ServiceError> {
    apply_env_overrides_from(config, |name| env::var(name).ok())
}

fn apply_env_overrides_from<F>(
    config: &mut LoomServiceConfig,
    lookup: F,
) -> Result<(), ServiceError>
where
    F: Fn(&str) -> Option<String>,
{
    if let Some(value) = lookup("LOOM_SERVICE_HOST") {
        config.service.host = value;
    }
    if let Some(value) = lookup("LOOM_SERVICE_PORT") {
        config.service.port = value
            .parse::<u16>()
            .map_err(|error| ServiceError::config(format!("LOOM_SERVICE_PORT invalid: {error}")))?;
    }
    if let Some(value) = lookup("LOOM_SERVICE_LOG") {
        config.service.log_level = value;
    }
    if let Some(value) = lookup("LOOM_SERVICE_DB_PATH") {
        config.database.path = value;
    }
    if let Some(value) = lookup("LOOM_OLLAMA_BASE_URL") {
        config.ollama.base_url = value.trim_end_matches('/').to_string();
    }
    if let Some(value) = lookup("LOOM_OLLAMA_REQUEST_TIMEOUT_MS") {
        config.ollama.request_timeout_ms = parse_env_u64("LOOM_OLLAMA_REQUEST_TIMEOUT_MS", &value)?;
    }
    if let Some(value) = lookup("LOOM_OLLAMA_FIRST_CHUNK_TIMEOUT_MS") {
        config.ollama.first_chunk_timeout_ms =
            parse_env_u64("LOOM_OLLAMA_FIRST_CHUNK_TIMEOUT_MS", &value)?;
    }
    if let Some(value) = lookup("LOOM_OLLAMA_STREAM_IDLE_TIMEOUT_MS") {
        config.ollama.stream_idle_timeout_ms =
            parse_env_u64("LOOM_OLLAMA_STREAM_IDLE_TIMEOUT_MS", &value)?;
    }
    if let Some(value) = lookup("LOOM_OLLAMA_ALLOW_REMOTE") {
        config.security.allow_remote_ollama = parse_env_bool("LOOM_OLLAMA_ALLOW_REMOTE", &value)?;
    }
    if let Some(value) = lookup("LOOM_OLLAMA_ENFORCE_LOCAL") {
        config.security.enforce_local_ollama = parse_env_bool("LOOM_OLLAMA_ENFORCE_LOCAL", &value)?;
    }
    if lookup("LOOM_SERVICE_E2E_PROVIDER_PROFILE").as_deref() == Some("nvidia") {
        apply_e2e_nvidia_openai_compatible_profile(config, &lookup, true)?;
    } else if lookup("LOOM_SERVICE_E2E_ENABLE_PROVIDER_PROFILE").as_deref() == Some("nvidia") {
        apply_e2e_nvidia_openai_compatible_profile(config, &lookup, false)?;
    } else if lookup("LOOM_SERVICE_E2E_PROVIDER_PROFILE").as_deref() == Some("litellm-sandbox") {
        apply_e2e_litellm_sandbox_profile(config, &lookup, true)?;
    } else if lookup("LOOM_SERVICE_E2E_ENABLE_PROVIDER_PROFILE").as_deref()
        == Some("litellm-sandbox")
    {
        apply_e2e_litellm_sandbox_profile(config, &lookup, false)?;
    } else if lookup("LOOM_SERVICE_E2E_PROVIDER_PROFILE").as_deref() == Some("openai-native") {
        apply_e2e_openai_native_profile(config, &lookup, true)?;
    } else if lookup("LOOM_SERVICE_E2E_ENABLE_PROVIDER_PROFILE").as_deref() == Some("openai-native")
    {
        apply_e2e_openai_native_profile(config, &lookup, false)?;
    } else if lookup("LOOM_SERVICE_E2E_PROVIDER_PROFILE").as_deref() == Some("anthropic-native") {
        apply_e2e_anthropic_native_profile(config, &lookup, true)?;
    } else if lookup("LOOM_SERVICE_E2E_ENABLE_PROVIDER_PROFILE").as_deref() == Some("anthropic-native")
    {
        apply_e2e_anthropic_native_profile(config, &lookup, false)?;
    }

    Ok(())
}

fn apply_e2e_nvidia_openai_compatible_profile<F>(
    config: &mut LoomServiceConfig,
    lookup: &F,
    select_for_main: bool,
) -> Result<(), ServiceError>
where
    F: Fn(&str) -> Option<String>,
{
    let mut profile = ProviderProfileConfig::nvidia_openai_compatible_example();
    profile.enabled = true;
    if let Some(value) = lookup("LOOM_SERVICE_E2E_OPENAI_BASE_URL") {
        profile.base_url = Some(value.trim_end_matches('/').to_string());
        profile.security.allow_insecure_http_remote = true;
    }
    if let Some(value) = lookup("LOOM_SERVICE_E2E_OPENAI_MODEL") {
        profile.default_model = Some(value);
    }
    if select_for_main {
        config.providers.default_main_model = profile
            .default_model
            .clone()
            .unwrap_or_else(|| config.providers.default_main_model.clone());
        config.providers.main_model_id = profile.default_model.clone();
        config.providers.main_provider_profile_id = Some(profile.id.clone());
    }
    profile.secret_ref = Some("env:NVIDIA_API_KEY".to_string());
    upsert_provider_profile(&mut config.providers.profiles, profile);
    Ok(())
}

/// Inject the LiteLLM sandbox provider profile from environment variables.
///
/// This mirrors the nvidia pattern and is intended for local sandbox development only.
/// The LiteLLM sandbox is defined in `tools/litellm-sandbox/` and must be running
/// before any generation request is made.
///
/// When `select_for_main` is true the sandbox becomes the active main generation
/// provider; when false it is added to the profile registry but Ollama remains active.
///
/// Environment variables consumed:
/// - `LOOM_LITELLM_BASE_URL` — defaults to `http://127.0.0.1:4000/v1`
/// - `LOOM_LITELLM_MODEL` — required when selecting for main (no default committed)
/// - `LOOM_LITELLM_API_KEY` — resolved via `env:LOOM_LITELLM_API_KEY` secret_ref
fn apply_e2e_litellm_sandbox_profile<F>(
    config: &mut LoomServiceConfig,
    lookup: &F,
    select_for_main: bool,
) -> Result<(), ServiceError>
where
    F: Fn(&str) -> Option<String>,
{
    let mut profile = ProviderProfileConfig::litellm_sandbox_example();
    profile.enabled = true;
    // Override base URL from env (already defaults to http://127.0.0.1:4000/v1 in template).
    if let Some(value) = lookup("LOOM_LITELLM_BASE_URL") {
        profile.base_url = Some(value.trim_end_matches('/').to_string());
    }
    // Model must be provided; no model is committed in the template.
    if let Some(value) = lookup("LOOM_LITELLM_MODEL") {
        profile.default_model = Some(value);
    }
    if select_for_main {
        // A model must be configured when selecting as main provider.
        let model = profile.default_model.clone().ok_or_else(|| {
            ServiceError::config(
                "LOOM_LITELLM_MODEL is required when \
                 LOOM_SERVICE_E2E_PROVIDER_PROFILE=litellm-sandbox",
            )
        })?;
        config.providers.default_main_model = model.clone();
        config.providers.main_model_id = Some(model);
        config.providers.main_provider_profile_id = Some(profile.id.clone());
    }
    // secret_ref is already set to "env:LOOM_LITELLM_API_KEY" in the template.
    upsert_provider_profile(&mut config.providers.profiles, profile);
    Ok(())
}

fn apply_e2e_openai_native_profile<F>(
    config: &mut LoomServiceConfig,
    lookup: &F,
    select_for_main: bool,
) -> Result<(), ServiceError>
where
    F: Fn(&str) -> Option<String>,
{
    let mut profile = ProviderProfileConfig::openai_native_example();
    profile.enabled = true;
    if let Some(value) = lookup("LOOM_OPENAI_BASE_URL") {
        profile.base_url = Some(value.trim_end_matches('/').to_string());
        profile.security.allow_insecure_http_remote = true;
    }
    if let Some(value) = lookup("LOOM_OPENAI_MODEL") {
        profile.default_model = Some(value);
    }
    if select_for_main {
        let model = profile.default_model.clone().ok_or_else(|| {
            ServiceError::config(
                "LOOM_OPENAI_MODEL is required when \
                 LOOM_SERVICE_E2E_PROVIDER_PROFILE=openai-native",
            )
        })?;
        config.providers.default_main_model = model.clone();
        config.providers.main_model_id = Some(model);
        config.providers.main_provider_profile_id = Some(profile.id.clone());
    }
    profile.secret_ref = Some("env:LOOM_OPENAI_API_KEY".to_string());
    upsert_provider_profile(&mut config.providers.profiles, profile);
    Ok(())
}

fn apply_e2e_anthropic_native_profile<F>(
    config: &mut LoomServiceConfig,
    lookup: &F,
    select_for_main: bool,
) -> Result<(), ServiceError>
where
    F: Fn(&str) -> Option<String>,
{
    let mut profile = ProviderProfileConfig::anthropic_native_example();
    profile.enabled = true;
    if let Some(value) = lookup("LOOM_ANTHROPIC_BASE_URL") {
        profile.base_url = Some(value.trim_end_matches('/').to_string());
        profile.security.allow_insecure_http_remote = true;
    }
    if let Some(value) = lookup("LOOM_ANTHROPIC_MODEL") {
        profile.default_model = Some(value);
    }
    if select_for_main {
        let model = profile.default_model.clone().ok_or_else(|| {
            ServiceError::config(
                "LOOM_ANTHROPIC_MODEL is required when \
                 LOOM_SERVICE_E2E_PROVIDER_PROFILE=anthropic-native",
            )
        })?;
        config.providers.default_main_model = model.clone();
        config.providers.main_model_id = Some(model);
        config.providers.main_provider_profile_id = Some(profile.id.clone());
    }
    profile.secret_ref = Some("env:LOOM_ANTHROPIC_API_KEY".to_string());
    upsert_provider_profile(&mut config.providers.profiles, profile);
    Ok(())
}

fn upsert_provider_profile(
    profiles: &mut Vec<ProviderProfileConfig>,
    profile: ProviderProfileConfig,
) {
    if let Some(existing) = profiles
        .iter_mut()
        .find(|existing| existing.id == profile.id)
    {
        *existing = profile;
    } else {
        profiles.push(profile);
    }
}

fn parse_env_u64(name: &str, value: &str) -> Result<u64, ServiceError> {
    value
        .parse::<u64>()
        .map_err(|error| ServiceError::config(format!("{name} must be a number: {error}")))
}

fn parse_env_bool(name: &str, value: &str) -> Result<bool, ServiceError> {
    match value.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(ServiceError::config(format!("{name} must be a boolean"))),
    }
}

fn apply_patch(config: &mut LoomServiceConfig, patch: ConfigPatch) {
    if let Some(service) = patch.service {
        if let Some(value) = service.host {
            config.service.host = value;
        }
        if let Some(value) = service.port {
            config.service.port = value;
        }
        if let Some(value) = service.log_level {
            config.service.log_level = value;
        }
        if let Some(value) = service.local_only {
            config.service.local_only = value;
        }
    }
    if let Some(database) = patch.database {
        if let Some(value) = database.path {
            config.database.path = value;
        }
    }
    if let Some(ollama) = patch.ollama {
        if let Some(value) = ollama.base_url {
            config.ollama.base_url = value.trim_end_matches('/').to_string();
        }
        if let Some(value) = ollama.request_timeout_ms {
            config.ollama.request_timeout_ms = value;
        }
        if let Some(value) = ollama.first_chunk_timeout_ms {
            config.ollama.first_chunk_timeout_ms = value;
        }
        if let Some(value) = ollama.stream_idle_timeout_ms {
            config.ollama.stream_idle_timeout_ms = value;
        }
    }
    if let Some(providers) = patch.providers {
        if let Some(value) = providers.default_main_model {
            config.providers.default_main_model = value;
        }
        if let Some(value) = providers.default_quick_model {
            config.providers.default_quick_model = value;
        }
        if let Some(value) = providers.main_provider_profile_id {
            config.providers.main_provider_profile_id = value;
        }
        if let Some(value) = providers.main_model_id {
            config.providers.main_model_id = value;
        }
        if let Some(value) = providers.response_mode_default {
            config.providers.response_mode_default = value;
        }
        if let Some(value) = providers.profiles {
            config.providers.profiles = value;
        }
    }
    if let Some(speech) = patch.speech {
        apply_speech_patch(&mut config.speech, speech);
    }
    if let Some(ocr) = patch.ocr {
        if let Some(value) = ocr.enabled {
            config.ocr.enabled = value;
        }
        if let Some(value) = ocr.provider {
            config.ocr.provider = value;
        }
        if let Some(value) = ocr.command_path {
            config.ocr.command_path = value;
        }
        if let Some(value) = ocr.pdf_rasterizer_command_path {
            config.ocr.pdf_rasterizer_command_path = value;
        }
        if let Some(value) = ocr.language {
            config.ocr.language = value;
        }
        if let Some(value) = ocr.dpi {
            config.ocr.dpi = value;
        }
        if let Some(value) = ocr.timeout_seconds {
            config.ocr.timeout_seconds = value;
        }
        if let Some(value) = ocr.max_pages_per_file {
            config.ocr.max_pages_per_file = value;
        }
        if let Some(value) = ocr.max_image_pixels {
            config.ocr.max_image_pixels = value;
        }
        if let Some(value) = ocr.temp_dir {
            config.ocr.temp_dir = value;
        }
    }
    if let Some(memory) = patch.memory {
        if let Some(value) = memory.enabled {
            config.memory.enabled = value;
        }
        if let Some(value) = memory.reference_recent_looms {
            config.memory.reference_recent_looms = value;
        }
        if let Some(value) = memory.reference_saved_memories {
            config.memory.reference_saved_memories = value;
        }
        if let Some(value) = memory.nickname {
            config.memory.nickname = value;
        }
        if let Some(value) = memory.occupation {
            config.memory.occupation = value;
        }
        if let Some(value) = memory.style_preferences {
            config.memory.style_preferences = value;
        }
        if let Some(value) = memory.more_about_you {
            config.memory.more_about_you = value;
        }
    }
    if let Some(context) = patch.context {
        if let Some(value) = context.max_context_length {
            config.context.max_context_length = value;
        }
        if let Some(value) = context.default_num_ctx_small {
            config.context.default_num_ctx_small = value;
        }
        if let Some(value) = context.default_num_ctx_medium {
            config.context.default_num_ctx_medium = value;
        }
        if let Some(value) = context.default_num_ctx_large {
            config.context.default_num_ctx_large = value;
        }
        if let Some(value) = context.max_recent_candidate_responses {
            config.context.max_recent_candidate_responses = value;
        }
    }
    if let Some(runtime) = patch.runtime {
        if let Some(value) = runtime.event_heartbeat_ms {
            config.runtime.event_heartbeat_ms = value;
        }
        if let Some(value) = runtime.max_active_generations {
            config.runtime.max_active_generations = value;
        }
    }
    if let Some(features) = patch.features {
        if let Some(value) = features.enable_ollama {
            config.features.enable_ollama = value;
        }
        if let Some(value) = features.enable_exports {
            config.features.enable_exports = value;
        }
        if let Some(value) = features.enable_extensions {
            config.features.enable_extensions = value;
        }
        if let Some(value) = features.enable_mcp {
            config.features.enable_mcp = value;
        }
        if let Some(value) = features.enable_llm_artifact_refinement {
            config.features.enable_llm_artifact_refinement = value;
        }
    }
    if let Some(security) = patch.security {
        if let Some(value) = security.enforce_local_ollama {
            config.security.enforce_local_ollama = value;
        }
        if let Some(value) = security.allow_remote_ollama {
            config.security.allow_remote_ollama = value;
        }
        if let Some(value) = security.allow_unsafe_ollama_model_management {
            config.security.allow_unsafe_ollama_model_management = value;
        }
        if let Some(value) = security.minimum_recommended_ollama_version {
            config.security.minimum_recommended_ollama_version = value;
        }
        if let Some(value) = security.warn_on_windows_ollama_updater_risk {
            config.security.warn_on_windows_ollama_updater_risk = value;
        }
    }
}

pub fn classify_restart_requirement(
    current: &LoomServiceConfig,
    candidate: &LoomServiceConfig,
) -> RestartClassification {
    let mut changed_paths = Vec::new();
    let mut restart_required = false;

    macro_rules! check {
        ($path:literal, $current:expr, $candidate:expr, $restart:expr) => {
            if $current != $candidate {
                changed_paths.push($path.to_string());
                restart_required |= $restart;
            }
        };
    }

    check!(
        "service.host",
        current.service.host,
        candidate.service.host,
        true
    );
    check!(
        "service.port",
        current.service.port,
        candidate.service.port,
        true
    );
    check!(
        "service.localOnly",
        current.service.local_only,
        candidate.service.local_only,
        true
    );
    check!(
        "service.logLevel",
        current.service.log_level,
        candidate.service.log_level,
        false
    );
    check!(
        "database.path",
        current.database.path,
        candidate.database.path,
        true
    );
    check!(
        "ollama.baseUrl",
        current.ollama.base_url,
        candidate.ollama.base_url,
        false
    );
    check!(
        "ollama.requestTimeoutMs",
        current.ollama.request_timeout_ms,
        candidate.ollama.request_timeout_ms,
        false
    );
    check!(
        "ollama.firstChunkTimeoutMs",
        current.ollama.first_chunk_timeout_ms,
        candidate.ollama.first_chunk_timeout_ms,
        false
    );
    check!(
        "ollama.streamIdleTimeoutMs",
        current.ollama.stream_idle_timeout_ms,
        candidate.ollama.stream_idle_timeout_ms,
        false
    );
    check!(
        "providers.defaultMainModel",
        current.providers.default_main_model,
        candidate.providers.default_main_model,
        false
    );
    check!(
        "providers.defaultQuickModel",
        current.providers.default_quick_model,
        candidate.providers.default_quick_model,
        false
    );
    check!(
        "providers.mainProviderProfileId",
        current.providers.main_provider_profile_id,
        candidate.providers.main_provider_profile_id,
        false
    );
    check!(
        "providers.mainModelId",
        current.providers.main_model_id,
        candidate.providers.main_model_id,
        false
    );
    check!(
        "providers.responseModeDefault",
        current.providers.response_mode_default,
        candidate.providers.response_mode_default,
        false
    );
    if current.providers.profiles != candidate.providers.profiles {
        changed_paths.push("providers.profiles".to_string());
        restart_required |= provider_profiles_require_restart_or_reconnect(
            &current.providers.profiles,
            &candidate.providers.profiles,
        );
    }
    check!("speech", current.speech, candidate.speech, false);
    check!("ocr", current.ocr, candidate.ocr, false);
    check!("memory", current.memory, candidate.memory, false);
    check!(
        "context.maxContextLength",
        current.context.max_context_length,
        candidate.context.max_context_length,
        false
    );
    check!(
        "context.maxRecentCandidateResponses",
        current.context.max_recent_candidate_responses,
        candidate.context.max_recent_candidate_responses,
        false
    );
    check!(
        "runtime.eventHeartbeatMs",
        current.runtime.event_heartbeat_ms,
        candidate.runtime.event_heartbeat_ms,
        true
    );
    check!(
        "runtime.maxActiveGenerations",
        current.runtime.max_active_generations,
        candidate.runtime.max_active_generations,
        false
    );
    check!(
        "features.enableOllama",
        current.features.enable_ollama,
        candidate.features.enable_ollama,
        false
    );
    check!(
        "features.enableExports",
        current.features.enable_exports,
        candidate.features.enable_exports,
        false
    );
    check!(
        "features.enableExtensions",
        current.features.enable_extensions,
        candidate.features.enable_extensions,
        false
    );
    check!(
        "features.enableMcp",
        current.features.enable_mcp,
        candidate.features.enable_mcp,
        false
    );
    check!(
        "features.enableLlmArtifactRefinement",
        current.features.enable_llm_artifact_refinement,
        candidate.features.enable_llm_artifact_refinement,
        false
    );
    check!(
        "security.enforceLocalOllama",
        current.security.enforce_local_ollama,
        candidate.security.enforce_local_ollama,
        true
    );
    check!(
        "security.allowRemoteOllama",
        current.security.allow_remote_ollama,
        candidate.security.allow_remote_ollama,
        true
    );
    check!(
        "security.allowUnsafeOllamaModelManagement",
        current.security.allow_unsafe_ollama_model_management,
        candidate.security.allow_unsafe_ollama_model_management,
        true
    );
    check!(
        "security.minimumRecommendedOllamaVersion",
        current.security.minimum_recommended_ollama_version,
        candidate.security.minimum_recommended_ollama_version,
        true
    );
    check!(
        "security.warnOnWindowsOllamaUpdaterRisk",
        current.security.warn_on_windows_ollama_updater_risk,
        candidate.security.warn_on_windows_ollama_updater_risk,
        false
    );

    RestartClassification {
        restart_required,
        reason: restart_required.then(|| "Changed settings require service restart.".to_string()),
        changed_paths,
    }
}

fn provider_profiles_require_restart_or_reconnect(
    current: &[ProviderProfileConfig],
    candidate: &[ProviderProfileConfig],
) -> bool {
    if current.len() != candidate.len() {
        return true;
    }
    current.iter().zip(candidate).any(|(current, candidate)| {
        matches!(
            classify_provider_config_change(current, candidate),
            ProviderConfigChangeClassification::ProviderReconnectRequired
                | ProviderConfigChangeClassification::ServiceRestartRequired
                | ProviderConfigChangeClassification::Invalid
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{
        apply_env_overrides_from, classify_restart_requirement, load_or_create_config,
        serialize_config, validate_config, write_config_atomic, ConfigManager, ConfigPatch,
        LoomServiceConfig, MemoryPatch, OcrPatch, ProviderPatch, ServicePatch,
    };
    use crate::providers::config::{
        classify_provider_config_change, normalize_provider_request_options,
        ProviderConfigChangeClassification, ProviderKind, ProviderProfileConfig,
        ProviderRequestNormalizationInput,
    };
    use crate::speech::SpeechToTextProviderKind;

    #[test]
    fn creates_default_config_file_if_missing() {
        let path = test_path("create-default");
        let config = load_or_create_config(&path).expect("create config");

        assert!(path.exists());
        assert!(config.service.local_only);
        let text = std::fs::read_to_string(path).expect("read config");
        assert!(text.contains("Do not store API keys"));
    }

    #[test]
    fn loads_toml_config() {
        let path = test_path("load-toml");
        let mut config = LoomServiceConfig::default();
        config.providers.default_main_model = "custom-main".to_string();
        write_config_atomic(&path, &config).expect("write config");

        let loaded = load_or_create_config(&path).expect("load config");
        assert_eq!(loaded.providers.default_main_model, "custom-main");
    }

    #[test]
    fn env_overrides_config_values() {
        let mut config = LoomServiceConfig::default();
        apply_env_overrides_from(&mut config, |name| match name {
            "LOOM_SERVICE_PORT" => Some("18000".to_string()),
            "LOOM_SERVICE_DB_PATH" => Some("/tmp/loom-test.db".to_string()),
            "LOOM_OLLAMA_BASE_URL" => Some("http://127.0.0.1:11500/".to_string()),
            _ => None,
        })
        .expect("apply overrides");

        assert_eq!(config.service.port, 18_000);
        assert_eq!(config.database.path, "/tmp/loom-test.db");
        assert_eq!(config.ollama.base_url, "http://127.0.0.1:11500");
    }

    #[test]
    fn e2e_nvidia_profile_override_adds_enabled_non_secret_profile() {
        let mut config = LoomServiceConfig::default();

        apply_env_overrides_from(&mut config, |name| match name {
            "LOOM_SERVICE_E2E_PROVIDER_PROFILE" => Some("nvidia".to_string()),
            "LOOM_SERVICE_E2E_OPENAI_BASE_URL" => Some("http://127.0.0.1:9999/v1".to_string()),
            "LOOM_SERVICE_E2E_OPENAI_MODEL" => Some("nvidia/e2e-openai-compatible".to_string()),
            _ => None,
        })
        .expect("apply env");

        let nvidia = config
            .providers
            .profiles
            .iter()
            .find(|profile| profile.id == "nvidia")
            .expect("nvidia profile");
        assert!(nvidia.enabled);
        assert_eq!(nvidia.secret_ref.as_deref(), Some("env:NVIDIA_API_KEY"));
        assert_eq!(nvidia.base_url.as_deref(), Some("http://127.0.0.1:9999/v1"));
        assert_eq!(
            config.providers.default_main_model,
            "nvidia/e2e-openai-compatible"
        );
        assert_eq!(
            config.providers.main_provider_profile_id.as_deref(),
            Some("nvidia")
        );
        assert_eq!(
            config.providers.main_model_id.as_deref(),
            Some("nvidia/e2e-openai-compatible")
        );
        let serialized = serialize_config(&config);
        assert!(!serialized.contains("nvapi-"));
        validate_config(&config).expect("valid e2e profile");
    }

    #[test]
    fn e2e_nvidia_enable_override_does_not_select_remote_main() {
        let mut config = LoomServiceConfig::default();

        apply_env_overrides_from(&mut config, |name| match name {
            "LOOM_SERVICE_E2E_ENABLE_PROVIDER_PROFILE" => Some("nvidia".to_string()),
            "LOOM_SERVICE_E2E_OPENAI_BASE_URL" => Some("http://127.0.0.1:9999/v1".to_string()),
            "LOOM_SERVICE_E2E_OPENAI_MODEL" => Some("nvidia/e2e-openai-compatible".to_string()),
            _ => None,
        })
        .expect("apply env");

        let nvidia = config
            .providers
            .profiles
            .iter()
            .find(|profile| profile.id == "nvidia")
            .expect("nvidia profile");
        assert!(nvidia.enabled);
        assert_eq!(config.providers.main_provider_profile_id, None);
        assert_eq!(config.providers.main_model_id, None);
        assert_eq!(config.providers.default_main_model, "qwen3.5:9b");
        let serialized = serialize_config(&config);
        assert!(!serialized.contains("nvapi-"));
        validate_config(&config).expect("enabled profile without Main assignment is valid");
    }

    // ── LiteLLM sandbox profile tests ────────────────────────────────────────

    #[test]
    fn litellm_sandbox_example_is_disabled_by_default() {
        let profile = ProviderProfileConfig::litellm_sandbox_example();
        assert_eq!(profile.id, "litellm-sandbox");
        assert!(
            !profile.enabled,
            "sandbox profile must be disabled by default"
        );
        assert!(profile.experimental);
        assert_eq!(
            profile.base_url.as_deref(),
            Some("http://127.0.0.1:4000/v1")
        );
        assert_eq!(
            profile.secret_ref.as_deref(),
            Some("env:LOOM_LITELLM_API_KEY")
        );
        assert!(profile.default_model.is_none(), "no model committed");
        // Vendor must be Custom — not Nvidia / OpenAi / Ollama.
        assert_eq!(
            profile.vendor.as_config_str(),
            "custom",
            "litellm-sandbox vendor must be Custom"
        );
        // Must NOT appear in default config profiles.
        let config = LoomServiceConfig::default();
        assert!(
            !config
                .providers
                .profiles
                .iter()
                .any(|p| p.id == "litellm-sandbox"),
            "litellm-sandbox must not appear in default profiles"
        );
    }

    #[test]
    fn e2e_litellm_sandbox_profile_selects_for_main() {
        let mut config = LoomServiceConfig::default();

        apply_env_overrides_from(&mut config, |name| match name {
            "LOOM_SERVICE_E2E_PROVIDER_PROFILE" => Some("litellm-sandbox".to_string()),
            "LOOM_LITELLM_BASE_URL" => Some("http://127.0.0.1:4000/v1".to_string()),
            "LOOM_LITELLM_MODEL" => Some("gpt-4o-mini".to_string()),
            _ => None,
        })
        .expect("apply litellm env");

        let sandbox = config
            .providers
            .profiles
            .iter()
            .find(|p| p.id == "litellm-sandbox")
            .expect("litellm-sandbox profile must be injected");

        assert!(sandbox.enabled);
        assert_eq!(
            sandbox.base_url.as_deref(),
            Some("http://127.0.0.1:4000/v1")
        );
        assert_eq!(sandbox.default_model.as_deref(), Some("gpt-4o-mini"));
        assert_eq!(
            sandbox.secret_ref.as_deref(),
            Some("env:LOOM_LITELLM_API_KEY")
        );
        assert_eq!(
            config.providers.main_provider_profile_id.as_deref(),
            Some("litellm-sandbox")
        );
        assert_eq!(
            config.providers.main_model_id.as_deref(),
            Some("gpt-4o-mini")
        );
        assert_eq!(config.providers.default_main_model, "gpt-4o-mini");
        // Serialized config must not contain any real secret.
        let serialized = serialize_config(&config);
        assert!(
            !serialized.contains("LOOM_LITELLM_API_KEY="),
            "secret key must not be serialized"
        );
        validate_config(&config).expect("litellm-sandbox profile for main is valid");
    }

    #[test]
    fn e2e_litellm_sandbox_enable_does_not_select_main() {
        let mut config = LoomServiceConfig::default();

        apply_env_overrides_from(&mut config, |name| match name {
            "LOOM_SERVICE_E2E_ENABLE_PROVIDER_PROFILE" => Some("litellm-sandbox".to_string()),
            "LOOM_LITELLM_BASE_URL" => Some("http://127.0.0.1:4000/v1".to_string()),
            "LOOM_LITELLM_MODEL" => Some("gpt-4o-mini".to_string()),
            _ => None,
        })
        .expect("apply litellm enable env");

        let sandbox = config
            .providers
            .profiles
            .iter()
            .find(|p| p.id == "litellm-sandbox")
            .expect("litellm-sandbox profile must be injected");

        assert!(sandbox.enabled);
        // main_provider_profile_id must remain None — Ollama stays active.
        assert_eq!(config.providers.main_provider_profile_id, None);
        assert_eq!(config.providers.main_model_id, None);
        assert_eq!(config.providers.default_main_model, "qwen3.5:9b");
        validate_config(&config).expect("enabled sandbox without Main assignment is valid");
    }

    #[test]
    fn e2e_litellm_sandbox_profile_errors_without_model() {
        let mut config = LoomServiceConfig::default();

        let result = apply_env_overrides_from(&mut config, |name| match name {
            "LOOM_SERVICE_E2E_PROVIDER_PROFILE" => Some("litellm-sandbox".to_string()),
            // No LOOM_LITELLM_MODEL — must error.
            _ => None,
        });

        assert!(
            result.is_err(),
            "selecting litellm-sandbox as main without a model must fail"
        );
        let message = format!("{}", result.unwrap_err());
        assert!(
            message.contains("LOOM_LITELLM_MODEL"),
            "error must mention LOOM_LITELLM_MODEL; got: {message}"
        );
    }

    // ── OpenAI Native profile tests ──────────────────────────────────────────

    #[test]
    fn openai_native_example_is_disabled_by_default() {
        let profile = ProviderProfileConfig::openai_native_example();
        assert_eq!(profile.id, "openai-native");
        assert!(
            !profile.enabled,
            "openai-native profile must be disabled by default"
        );
        assert!(!profile.experimental);
        assert_eq!(
            profile.base_url.as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(
            profile.secret_ref.as_deref(),
            Some("env:LOOM_OPENAI_API_KEY")
        );
        assert_eq!(profile.default_model.as_deref(), Some("gpt-4o-mini"));
        assert_eq!(
            profile.vendor.as_config_str(),
            "openai",
            "openai-native vendor must be OpenAi"
        );
        let config = LoomServiceConfig::default();
        assert!(
            !config
                .providers
                .profiles
                .iter()
                .any(|p| p.id == "openai-native"),
            "openai-native must not appear in default profiles"
        );
    }

    #[test]
    fn e2e_openai_native_profile_selects_for_main() {
        let mut config = LoomServiceConfig::default();

        apply_env_overrides_from(&mut config, |name| match name {
            "LOOM_SERVICE_E2E_PROVIDER_PROFILE" => Some("openai-native".to_string()),
            "LOOM_OPENAI_BASE_URL" => Some("https://api.openai.com/v1".to_string()),
            "LOOM_OPENAI_MODEL" => Some("gpt-4o-mini".to_string()),
            _ => None,
        })
        .expect("apply openai env");

        let openai = config
            .providers
            .profiles
            .iter()
            .find(|p| p.id == "openai-native")
            .expect("openai-native profile must be injected");

        assert!(openai.enabled);
        assert_eq!(
            openai.base_url.as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(openai.default_model.as_deref(), Some("gpt-4o-mini"));
        assert_eq!(
            openai.secret_ref.as_deref(),
            Some("env:LOOM_OPENAI_API_KEY")
        );
        assert_eq!(
            config.providers.main_provider_profile_id.as_deref(),
            Some("openai-native")
        );
        assert_eq!(
            config.providers.main_model_id.as_deref(),
            Some("gpt-4o-mini")
        );
        assert_eq!(config.providers.default_main_model, "gpt-4o-mini");
        let serialized = serialize_config(&config);
        assert!(
            !serialized.contains("LOOM_OPENAI_API_KEY="),
            "secret key must not be serialized"
        );
        validate_config(&config).expect("openai-native profile for main is valid");
    }

    #[test]
    fn rejects_non_local_host_when_local_only() {
        let mut config = LoomServiceConfig::default();
        config.service.host = "0.0.0.0".to_string();

        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn patch_config_validates_and_writes_atomically() {
        let path = test_path("patch-write");
        let config = LoomServiceConfig::default();
        write_config_atomic(&path, &config).expect("write config");
        let manager = ConfigManager::new(path.clone(), config);

        let result = manager
            .patch(ConfigPatch {
                providers: Some(ProviderPatch {
                    default_main_model: Some("qwen3.5:9b".to_string()),
                    ..ProviderPatch::default()
                }),
                ..ConfigPatch::default()
            })
            .expect("patch config");

        assert!(!result.restart.restart_required);
        assert!(std::fs::read_to_string(path)
            .expect("read config")
            .contains("qwen3.5:9b"));
    }

    #[test]
    fn restart_classification_marks_port_change_only() {
        let current = LoomServiceConfig::default();
        let mut changed = current.clone();
        changed.service.port = 17_634;

        let classification = classify_restart_requirement(&current, &changed);
        assert!(classification.restart_required);
        assert!(classification
            .changed_paths
            .contains(&"service.port".to_string()));
    }

    #[test]
    fn restart_classification_allows_model_default_live() {
        let current = LoomServiceConfig::default();
        let mut changed = current.clone();
        changed.providers.default_main_model = "another-model".to_string();

        let classification = classify_restart_requirement(&current, &changed);
        assert!(!classification.restart_required);
    }

    #[test]
    fn provider_profile_config_parses_from_toml() {
        let mut config = LoomServiceConfig::default();
        config.providers.profiles[0].request_defaults.num_ctx = Some(8192);
        config.providers.profiles[0].request_defaults.num_predict = Some(1024);
        config.providers.profiles[0].requires_secret = true;
        config.providers.profiles[0].secret_ref = Some("provider:ollama-local:apiKey".to_string());
        let path = test_path("provider-profile");
        write_config_atomic(&path, &config).expect("write config");

        let loaded = load_or_create_config(&path).expect("load config");
        let profile = loaded
            .providers
            .profiles
            .iter()
            .find(|profile| profile.id == "ollama-local")
            .expect("ollama profile");
        assert_eq!(profile.provider_kind, ProviderKind::Ollama);
        assert_eq!(profile.base_url.as_deref(), Some("http://127.0.0.1:11434"));
        assert_eq!(profile.request_defaults.num_ctx, Some(8192));
        assert_eq!(profile.request_defaults.num_predict, Some(1024));
        assert_eq!(
            profile.secret_ref.as_deref(),
            Some("provider:ollama-local:apiKey")
        );
        assert!(!profile.security.allow_unsafe_model_management);
    }

    #[test]
    fn remote_provider_profile_toml_round_trip_preserves_non_secret_fields() {
        let mut config = LoomServiceConfig::default();
        let mut nvidia = ProviderProfileConfig::nvidia_openai_compatible_example();
        nvidia.enabled = true;
        config.providers.main_provider_profile_id = Some("nvidia".to_string());
        config.providers.main_model_id = nvidia.default_model.clone();
        config.providers.profiles.push(nvidia);
        let path = test_path("remote-provider-profile");
        write_config_atomic(&path, &config).expect("write config");

        let serialized = std::fs::read_to_string(&path).expect("read config");
        assert!(serialized.contains("mainProviderProfileId = \"nvidia\""));
        assert!(serialized.contains("mainModelId = \"meta/llama-3.1-70b-instruct\""));
        assert!(serialized.contains("id = \"nvidia\""));
        assert!(serialized.contains("providerKind = \"openai_compatible\""));
        assert!(serialized.contains("transportKind = \"native_openai_compatible\""));
        assert!(serialized.contains("vendor = \"nvidia\""));
        assert!(serialized.contains("experimental = true"));
        assert!(serialized.contains("baseUrl = \"https://integrate.api.nvidia.com/v1\""));
        assert!(serialized.contains("secretRef = \"env:NVIDIA_API_KEY\""));
        assert!(!serialized.contains("nvapi-"));
        assert!(!serialized.contains("Bearer "));

        let loaded = load_or_create_config(&path).expect("load config");
        let profile = loaded
            .providers
            .profiles
            .iter()
            .find(|profile| profile.id == "nvidia")
            .expect("nvidia profile");

        assert_eq!(profile.provider_kind, ProviderKind::OpenAiCompatible);
        assert_eq!(
            profile.transport_kind,
            crate::providers::config::ProviderTransportKind::NativeOpenAiCompatible
        );
        assert_eq!(
            profile.vendor,
            crate::providers::config::ProviderVendor::Nvidia
        );
        assert!(profile.enabled);
        assert!(profile.experimental);
        assert_eq!(profile.secret_ref.as_deref(), Some("env:NVIDIA_API_KEY"));
        assert_eq!(
            profile.base_url.as_deref(),
            Some("https://integrate.api.nvidia.com/v1")
        );
        assert_eq!(
            loaded.providers.main_provider_profile_id.as_deref(),
            Some("nvidia")
        );
        assert_eq!(
            loaded.providers.main_model_id.as_deref(),
            Some("meta/llama-3.1-70b-instruct")
        );
    }

    #[test]
    fn selected_main_provider_requires_enabled_profile_and_model() {
        let mut config = LoomServiceConfig::default();
        let mut nvidia = ProviderProfileConfig::nvidia_openai_compatible_example();
        nvidia.enabled = false;
        config.providers.main_provider_profile_id = Some("nvidia".to_string());
        config.providers.main_model_id = nvidia.default_model.clone();
        config.providers.profiles.push(nvidia.clone());

        assert!(validate_config(&config).is_err());

        nvidia.enabled = true;
        config
            .providers
            .profiles
            .retain(|profile| profile.id != "nvidia");
        config.providers.profiles.push(nvidia);
        config.providers.main_model_id = None;

        assert!(validate_config(&config).is_err());

        config.providers.main_model_id = Some("meta/llama-3.1-70b-instruct".to_string());
        validate_config(&config).expect("enabled selected provider with model is valid");
    }

    #[test]
    fn enabled_remote_profile_with_missing_secret_ref_value_does_not_break_config_validation() {
        let mut config = LoomServiceConfig::default();
        let mut nvidia = ProviderProfileConfig::nvidia_openai_compatible_example();
        nvidia.enabled = true;
        nvidia.secret_ref = Some("env:LOOM_TEST_MISSING_NVIDIA_API_KEY".to_string());
        std::env::remove_var("LOOM_TEST_MISSING_NVIDIA_API_KEY");
        config.providers.profiles.push(nvidia);

        validate_config(&config).expect("missing secret value is runtime status, not boot failure");
    }

    #[test]
    fn provider_profile_serializes_without_secrets_or_raw_thinking() {
        let serialized = serialize_config(&LoomServiceConfig::default());
        for forbidden in [
            "apiKey",
            "api_key",
            "token",
            "authorization",
            "bearerToken",
            "password",
            "credential",
            "client_secret",
            "private_key",
            "refreshToken",
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(!serialized.contains(forbidden));
        }
        assert!(serialized.contains("[[providers.profiles]]"));
        assert!(serialized.contains("requiresSecret = false"));
    }

    #[test]
    fn speech_config_parses_from_toml_and_defaults_to_disabled() {
        let mut config = LoomServiceConfig::default();
        config.speech.enabled = true;
        config.speech.default_provider_kind = SpeechToTextProviderKind::LocalCommand;
        config.speech.default_language = Some("tr".to_string());
        config.speech.allowed_mime_types = vec!["audio/webm".to_string(), "audio/wav".to_string()];
        config.speech.local_command_path = Some("/usr/local/bin/whisper".to_string());
        config.speech.local_command_args = vec![
            "--input".to_string(),
            "{audio_file}".to_string(),
            "--language".to_string(),
            "{language}".to_string(),
        ];
        config.speech.local_command_timeout_ms = 60_000;
        let path = test_path("speech-config");
        write_config_atomic(&path, &config).expect("write config");

        let loaded = load_or_create_config(&path).expect("load config");
        assert!(loaded.speech.enabled);
        assert_eq!(
            loaded.speech.default_provider_kind,
            SpeechToTextProviderKind::LocalCommand
        );
        assert_eq!(loaded.speech.default_language.as_deref(), Some("tr"));
        assert_eq!(
            loaded.speech.allowed_mime_types,
            vec!["audio/webm".to_string(), "audio/wav".to_string()]
        );
        assert_eq!(
            loaded.speech.local_command_path.as_deref(),
            Some("/usr/local/bin/whisper")
        );
        assert_eq!(
            loaded.speech.local_command_args,
            vec![
                "--input".to_string(),
                "{audio_file}".to_string(),
                "--language".to_string(),
                "{language}".to_string()
            ]
        );
        assert_eq!(loaded.speech.local_command_timeout_ms, 60_000);
    }

    #[test]
    fn memory_config_parses_and_patches_without_restart() {
        let mut config = LoomServiceConfig::default();
        config.memory.reference_recent_looms = false;
        config.memory.reference_saved_memories = true;
        let path = test_path("memory-config");
        write_config_atomic(&path, &config).expect("write config");

        let loaded = load_or_create_config(&path).expect("load config");
        assert!(!loaded.memory.reference_recent_looms);
        assert!(loaded.memory.reference_saved_memories);

        let manager = ConfigManager::new(path, loaded);
        let result = manager
            .patch(ConfigPatch {
                memory: Some(MemoryPatch {
                    reference_recent_looms: Some(true),
                    reference_saved_memories: Some(false),
                    ..MemoryPatch::default()
                }),
                ..ConfigPatch::default()
            })
            .expect("patch memory config");

        assert!(!result.restart.restart_required);
        assert_eq!(result.restart.changed_paths, vec!["memory".to_string()]);
        assert!(result.config.memory.reference_recent_looms);
        assert!(!result.config.memory.reference_saved_memories);
    }

    #[test]
    fn speech_config_serializes_without_secrets_or_raw_thinking() {
        let serialized = serialize_config(&LoomServiceConfig::default());
        assert!(serialized.contains("[speech]"));
        assert!(serialized.contains("enabled = false"));
        assert!(serialized.contains("persistAudio = false"));
        assert!(serialized.contains("persistTranscript = false"));
        assert!(serialized.contains("localCommandArgs = [\"{audio_file}\"]"));
        assert!(serialized.contains("localCommandTimeoutMs = 120000"));
        for forbidden in [
            "apiKey",
            "bearerToken",
            "password",
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn ocr_config_serializes_parses_and_patches_without_restart() {
        let mut config = LoomServiceConfig::default();
        config.ocr.enabled = true;
        config.ocr.command_path = Some("/opt/homebrew/bin/tesseract".to_string());
        config.ocr.pdf_rasterizer_command_path = Some("/opt/homebrew/bin/pdftoppm".to_string());
        config.ocr.language = "eng+tur".to_string();
        config.ocr.dpi = 300;
        let path = test_path("ocr-config");
        write_config_atomic(&path, &config).expect("write config");

        let loaded = load_or_create_config(&path).expect("load config");
        assert!(loaded.ocr.enabled);
        assert_eq!(loaded.ocr.provider, "tesseract");
        assert_eq!(loaded.ocr.language, "eng+tur");
        assert_eq!(loaded.ocr.dpi, 300);
        assert_eq!(
            loaded.ocr.command_path.as_deref(),
            Some("/opt/homebrew/bin/tesseract")
        );

        let manager = ConfigManager::new(path, loaded);
        let result = manager
            .patch(ConfigPatch {
                ocr: Some(OcrPatch {
                    enabled: Some(false),
                    command_path: Some(None),
                    ..OcrPatch::default()
                }),
                ..ConfigPatch::default()
            })
            .expect("patch ocr config");

        assert!(!result.restart.restart_required);
        assert_eq!(result.restart.changed_paths, vec!["ocr".to_string()]);
        assert!(!result.config.ocr.enabled);
        assert!(result.config.ocr.command_path.is_none());
    }

    #[test]
    fn invalid_provider_base_url_is_rejected_safely() {
        let mut config = LoomServiceConfig::default();
        config.providers.profiles[0].base_url = Some("not a valid url".to_string());

        let error = validate_config(&config).expect_err("invalid profile");
        assert!(error.to_string().contains("baseUrl is invalid"));
    }

    #[test]
    fn ollama_profile_remote_url_is_blocked_unless_policy_allows_it() {
        let mut config = LoomServiceConfig::default();
        config.providers.profiles[0].base_url = Some("http://192.168.1.20:11434".to_string());

        assert!(validate_config(&config).is_err());

        config.providers.profiles[0].security.allow_remote_endpoint = true;
        config.providers.profiles[0]
            .security
            .allow_insecure_http_remote = true;
        validate_config(&config).expect("explicit remote profile allowed");
    }

    #[test]
    fn request_option_normalization_maps_budgets_and_quick_ask_policy() {
        let profile = &LoomServiceConfig::default().providers.profiles[0];
        let normalized = normalize_provider_request_options(
            profile,
            ProviderRequestNormalizationInput {
                model: None,
                output_budget: Some(512),
                context_budget: Some(4096),
                temperature: Some(0.1),
                top_p: Some(0.9),
                think: Some(true),
                stream: None,
                quick_ask: true,
            },
        )
        .expect("normalize options");

        assert_eq!(normalized.model, "qwen3.5:9b");
        assert_eq!(normalized.num_predict, Some(512));
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
    fn provider_config_change_classification_detects_reconnect() {
        let current = ProviderProfileConfig::default_ollama(
            "qwen3.5:9b".to_string(),
            "http://127.0.0.1:11434".to_string(),
        );
        let mut changed = current.clone();
        changed.base_url = Some("http://127.0.0.1:11500".to_string());

        assert_eq!(
            classify_provider_config_change(&current, &changed),
            ProviderConfigChangeClassification::ProviderReconnectRequired
        );
    }

    #[test]
    fn provider_config_rejects_secret_like_fields() {
        let text = r#"
[service]
host = "127.0.0.1"
port = 17633
logLevel = "info"
localOnly = true

[[providers.profiles]]
id = "unsafe"
providerKind = "ollama"
displayName = "Unsafe"
apiKey = "do-not-store"
"#;

        let path = test_path("provider-secret");
        std::fs::write(&path, text).expect("write test config");
        let error = load_or_create_config(&path).expect_err("secret field rejected");
        assert!(error.to_string().contains("secret"));
    }

    #[test]
    fn provider_config_rejects_raw_secret_looking_values() {
        let mut config = LoomServiceConfig::default();
        let mut profile = ProviderProfileConfig::nvidia_openai_compatible_example();
        profile.metadata_json = Some(serde_json::json!({
            "example": "sk-this-is-a-raw-secret-value"
        }));
        config.providers.profiles.push(profile);

        let error = validate_config(&config).expect_err("raw secret value rejected");

        assert!(error.to_string().contains("raw secret"));
    }

    #[test]
    fn config_has_no_secret_or_raw_thinking_fields() {
        let serialized = serialize_config(&LoomServiceConfig::default());
        let forbidden = [
            "api_key",
            "token",
            "credential",
            "persist_raw_thinking",
            "export_raw_thinking",
            "include_raw_thinking_in_context",
            "raw_thinking",
            "thinking_text",
        ];

        for field in forbidden {
            assert!(!serialized.contains(field));
        }
    }

    #[test]
    fn invalid_patch_is_rejected() {
        let path = test_path("invalid-patch");
        let config = LoomServiceConfig::default();
        write_config_atomic(&path, &config).expect("write config");
        let manager = ConfigManager::new(path, config);

        let error = manager
            .patch(ConfigPatch {
                service: Some(ServicePatch {
                    host: Some("0.0.0.0".to_string()),
                    ..ServicePatch::default()
                }),
                ..ConfigPatch::default()
            })
            .expect_err("patch should fail");

        assert!(error.to_string().contains("loopback"));
    }

    #[test]
    fn speech_output_mode_and_transcript_extension_survive_config_round_trip() {
        use crate::speech::{LocalCommandOutputMode, SpeechToTextConfig, SpeechToTextProviderKind};

        let path = test_path("speech-output-mode-round-trip");
        let mut config = LoomServiceConfig::default();
        config.speech = SpeechToTextConfig {
            enabled: true,
            default_provider_kind: SpeechToTextProviderKind::LocalCommand,
            local_command_path: Some("/usr/local/bin/whisper-cli".to_string()),
            local_command_args: vec![
                "-m".to_string(),
                "/tmp/ggml-base.bin".to_string(),
                "-f".to_string(),
                "{input}".to_string(),
                "-otxt".to_string(),
                "-of".to_string(),
                "{output}".to_string(),
            ],
            local_command_output_mode: LocalCommandOutputMode::File,
            local_command_transcript_file_extension: "txt".to_string(),
            warnings: vec![],
            ..SpeechToTextConfig::default()
        };
        write_config_atomic(&path, &config).expect("write config");

        let toml = std::fs::read_to_string(&path).expect("read toml");
        assert!(
            toml.contains("localCommandOutputMode = \"file\""),
            "localCommandOutputMode must be written to TOML; got:\n{toml}"
        );
        assert!(
            toml.contains("localCommandTranscriptFileExtension = \"txt\""),
            "localCommandTranscriptFileExtension must be written to TOML; got:\n{toml}"
        );

        let loaded = load_or_create_config(&path).expect("reload config");
        assert_eq!(
            loaded.speech.local_command_output_mode,
            LocalCommandOutputMode::File,
            "localCommandOutputMode must survive write→reload round-trip"
        );
        assert_eq!(
            loaded.speech.local_command_transcript_file_extension, "txt",
            "localCommandTranscriptFileExtension must survive write→reload round-trip"
        );
        assert_eq!(
            loaded.speech.local_command_path.as_deref(),
            Some("/usr/local/bin/whisper-cli")
        );
        let _ = std::fs::remove_file(path);
    }

    fn test_path(name: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "loom-service-{name}-{}.toml",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        path
    }
}
