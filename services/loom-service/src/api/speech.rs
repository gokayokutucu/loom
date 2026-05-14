use crate::{
    api::state::AppState,
    speech::{
        validate_transcribe_request, MockSpeechToTextProvider, SpeechToTextError,
        SpeechToTextErrorKind, SpeechToTextProvider, SpeechToTextProviderKind,
        SpeechToTextProviderRequest, SpeechToTextResult,
    },
};
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub message: String,
    pub warnings: Vec<String>,
}

pub async fn transcribe(
    State(state): State<AppState>,
    Json(input): Json<SpeechTranscribeRequest>,
) -> Result<Json<SpeechToTextResult>, (StatusCode, Json<SpeechTranscribeErrorPayload>)> {
    let config = state.config.current().speech;
    let request = SpeechToTextProviderRequest {
        audio_bytes: input.audio_bytes,
        mime_type: input.mime_type,
        language: input.language.or(config.default_language.clone()),
        provider_profile_id: input
            .provider_profile_id
            .or(config.provider_profile_id.clone()),
        metadata: input.metadata,
    };

    validate_mode(input.mode.as_deref()).map_err(speech_error)?;
    validate_transcribe_request(&config, &request).map_err(speech_error)?;

    match config.default_provider_kind {
        SpeechToTextProviderKind::MockTest => MockSpeechToTextProvider::from_config(&config)
            .transcribe(request)
            .map(Json)
            .map_err(speech_error),
        _ => Err(speech_error(SpeechToTextError::new(
            SpeechToTextErrorKind::ProviderUnavailable,
            "No real Speech-to-Text provider is configured yet.",
        ))),
    }
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
    let status = match error.kind {
        SpeechToTextErrorKind::SttDisabled => StatusCode::FORBIDDEN,
        SpeechToTextErrorKind::UnsupportedAudioType => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        SpeechToTextErrorKind::AudioTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        SpeechToTextErrorKind::CloudSttDisabled => StatusCode::FORBIDDEN,
        SpeechToTextErrorKind::MissingSecret => StatusCode::UNAUTHORIZED,
        SpeechToTextErrorKind::ProviderUnavailable => StatusCode::SERVICE_UNAVAILABLE,
        SpeechToTextErrorKind::InvalidRequest => StatusCode::BAD_REQUEST,
        SpeechToTextErrorKind::TranscriptionFailed => StatusCode::BAD_GATEWAY,
    };
    (
        status,
        Json(SpeechTranscribeErrorPayload {
            kind: error.kind,
            message: error.message,
            warnings: error.warnings,
        }),
    )
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
    use std::path::PathBuf;

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
            operations: OperationTracker::default(),
            restart: RestartState::default(),
        }
    }
}
