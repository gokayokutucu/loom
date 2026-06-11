mod agent_experimental;
mod ask;
mod attachments;
mod bookmarks;
mod capabilities;
mod code_snippets;
mod config;
mod context;
mod dev;
mod events;
pub(crate) mod exports;
pub(crate) mod graph;
pub(crate) mod health;
mod history;
mod looms;
mod memory;
mod model_runtime;
mod ocr;
mod ollama;
mod orchestration;
mod provider_secrets;
mod references;
mod reset;
pub(crate) mod resolve;
mod responses;
mod runtime_api;
mod speech;
mod state;
mod ui_state;
mod wefts;

use crate::config::ConfigManager;
use crate::providers::{ollama::OllamaRuntime, secret_store::ProviderSecretStore};
use crate::runtime::{OperationTracker, RestartState};
use crate::storage::db::Database;
use axum::{
    body::Body,
    extract::DefaultBodyLimit,
    http::{header, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Router,
};
use state::AppState;

/// Opt-in switches for experimental, non-product API surfaces. Everything is
/// off by default; gated routes are not mounted at all unless enabled.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ExperimentalApiConfig {
    pub agent_runtime_api: bool,
}

impl ExperimentalApiConfig {
    pub fn from_env() -> Self {
        let enabled = matches!(
            std::env::var(agent_experimental::EXPERIMENTAL_AGENT_RUNTIME_ENV)
                .ok()
                .as_deref(),
            Some("1") | Some("true")
        );
        Self {
            agent_runtime_api: enabled,
        }
    }
}

pub fn router(
    database: Database,
    ollama: OllamaRuntime,
    config: ConfigManager,
    operations: OperationTracker,
    restart: RestartState,
) -> Router {
    router_with_experimental(
        database,
        ollama,
        config,
        operations,
        restart,
        ExperimentalApiConfig::from_env(),
    )
}

pub fn router_with_experimental(
    database: Database,
    ollama: OllamaRuntime,
    config: ConfigManager,
    operations: OperationTracker,
    restart: RestartState,
    experimental: ExperimentalApiConfig,
) -> Router {
    let state = AppState {
        database,
        ollama,
        config,
        secret_store: ProviderSecretStore::default(),
        operations,
        restart,
        agent_runs: crate::agent_runtime::runtime::AgentRunStore::new(),
    };

    let experimental_routes = if experimental.agent_runtime_api {
        tracing::info!("experimental agent runtime API enabled");
        Router::new()
            .route(
                agent_experimental::EXPERIMENTAL_AGENT_RUN_PATH,
                post(agent_experimental::run),
            )
            .route(
                agent_experimental::EXPERIMENTAL_AGENT_CANCEL_PATH,
                post(agent_experimental::cancel),
            )
    } else {
        Router::new()
    };

    Router::new()
        .merge(experimental_routes)
        .route("/health", get(health::health))
        .route("/version", get(health::version))
        .route("/events", get(events::events_stream))
        .route(
            "/config",
            get(config::get_config).patch(config::patch_config),
        )
        .route("/runtime/restart-status", get(config::restart_status))
        .route("/runtime/restart", post(config::request_restart))
        .route("/runtime/status", get(runtime_api::status))
        .route("/runtime/shutdown", post(runtime_api::shutdown))
        .route("/runtime/providers", get(model_runtime::providers))
        .route(
            "/runtime/models",
            get(model_runtime::models).post(model_runtime::discover_models),
        )
        .route(
            "/runtime/models/:model_name/download",
            post(model_runtime::start_download),
        )
        .route("/runtime/downloads", get(model_runtime::list_downloads))
        .route(
            "/runtime/downloads/:job_id",
            get(model_runtime::get_download),
        )
        .route(
            "/runtime/downloads/:job_id/events",
            get(model_runtime::download_events),
        )
        .route(
            "/runtime/downloads/:job_id/cancel",
            post(model_runtime::cancel_download),
        )
        .route("/resolve", post(resolve::resolve))
        .route("/hard-reset", post(reset::hard_reset))
        .route("/dev/seed-fixtures", post(dev::seed_fixtures))
        .route("/dev/seed-transcript", post(dev::seed_transcript))
        .route("/dev/e2e-proof/:loom_id", get(dev::e2e_proof))
        .route("/ask/quick", post(ask::quick))
        .route(
            "/speech/transcribe",
            post(speech::transcribe)
                .layer(DefaultBodyLimit::max(
                    speech::SPEECH_TRANSCRIBE_HTTP_BODY_LIMIT_BYTES,
                ))
                .layer(middleware::from_fn(speech_transcribe_body_limit)),
        )
        .route("/speech/provider/health", get(speech::provider_health))
        .route("/ocr/provider/health", get(ocr::provider_health))
        .route("/speech/setup/status", get(speech::setup_status))
        .route(
            "/speech/setup/download-model",
            post(speech::download_setup_model),
        )
        .route("/speech/setup/configure", post(speech::configure_setup))
        .route(
            "/bookmarks",
            get(bookmarks::list_bookmarks).post(bookmarks::create_bookmark),
        )
        .route(
            "/history",
            get(history::list_history).post(history::record_history),
        )
        .route(
            "/ui/state/:key",
            get(ui_state::get_ui_state).put(ui_state::put_ui_state),
        )
        .route(
            "/memory",
            get(memory::list_memory).post(memory::create_memory),
        )
        .route(
            "/memory/:memory_id",
            get(memory::get_memory)
                .patch(memory::patch_memory)
                .delete(memory::delete_memory),
        )
        .route("/bookmarks/target", get(bookmarks::get_bookmark_for_target))
        .route(
            "/bookmarks/:bookmark_id",
            get(bookmarks::get_bookmark).delete(bookmarks::delete_bookmark),
        )
        .route("/references", post(references::create_reference))
        .route("/references/suggest", post(references::suggest_references))
        .route(
            "/references/:reference_id",
            get(references::get_reference).delete(references::delete_reference),
        )
        .route(
            "/looms/:loom_id/references",
            get(references::list_loom_references),
        )
        .route(
            "/responses/:response_id/references",
            get(references::list_response_references),
        )
        .route(
            "/looms/:loom_id/attachments",
            get(attachments::list_attachments).post(attachments::create_attachment),
        )
        .route(
            "/attachments/:attachment_id",
            get(attachments::get_attachment).delete(attachments::delete_attachment),
        )
        .route(
            "/looms/:loom_id/attachments/:attachment_id/materialize",
            post(attachments::materialize_attachment),
        )
        .route(
            "/looms/:loom_id/attachments/:attachment_id/adopt",
            post(attachments::adopt_attachment),
        )
        .route("/code-snippets", get(code_snippets::list_code_snippets))
        .route("/wefts", post(wefts::create_weft))
        .route("/looms", get(looms::list_looms).post(looms::create_loom))
        .route(
            "/looms/:loom_id/transcript",
            get(looms::get_loom_transcript_page),
        )
        .route(
            "/looms/:loom_id/transcript/outline",
            get(looms::get_loom_transcript_outline),
        )
        .route(
            "/looms/:loom_id",
            get(looms::get_loom)
                .patch(looms::patch_loom)
                .delete(looms::delete_loom),
        )
        .route("/looms/:loom_id/archive", post(looms::archive_loom))
        .route("/looms/:loom_id/restore", post(looms::restore_loom))
        .route("/looms/:loom_id/wefts", get(wefts::list_wefts_for_loom))
        .route(
            "/responses/:response_id/wefts",
            get(wefts::list_wefts_for_response),
        )
        .route(
            "/wefts/:weft_loom_id/responses",
            post(wefts::persist_weft_responses),
        )
        .route("/looms/:loom_id/graph", get(graph::get_graph))
        .route(
            "/looms/:loom_id/ancestry-step",
            get(graph::get_ancestry_step),
        )
        .route("/exports/loom", post(exports::export_loom))
        .route("/exports/response", post(exports::export_response))
        .route(
            "/responses/:response_id/regenerate",
            post(orchestration::regenerate_response),
        )
        .route(
            "/responses/:response_id/retry",
            post(orchestration::retry_response),
        )
        .route("/responses/:response_id", patch(responses::patch_response))
        .route("/context/prepare", post(context::prepare))
        .route("/context/jobs", get(context::list_jobs))
        .route("/context/jobs/run-next", post(context::run_next_job))
        .route("/context/jobs/:job_id/run", post(context::run_job))
        .route("/orchestration/plan", post(orchestration::plan))
        .route("/orchestration/dry-run", post(orchestration::dry_run))
        .route("/orchestration/execute", post(orchestration::execute))
        .route(
            "/orchestration/deep-synthesis",
            post(orchestration::deep_synthesis),
        )
        .route(
            "/orchestration/deep-synthesis/eval",
            post(orchestration::deep_synthesis_eval),
        )
        .route(
            "/orchestration/deep-synthesis/cancel/:run_id",
            post(orchestration::cancel),
        )
        .route("/orchestration/cancel/:run_id", post(orchestration::cancel))
        .route("/orchestration/runs/:run_id", get(orchestration::get_run))
        .route(
            "/orchestration/runs/:run_id/status",
            get(orchestration::get_run_status),
        )
        .route(
            "/orchestration/runs/:run_id/events",
            get(orchestration::get_run_events),
        )
        .route(
            "/orchestration/runs/:run_id/response-state",
            get(orchestration::get_run_response_state),
        )
        .route("/providers/ollama/health", get(ollama::health))
        .route("/providers/ollama/models", get(ollama::models))
        .route("/providers/ollama/chat", post(ollama::chat))
        .route("/providers/ollama/cancel/:request_id", post(ollama::cancel))
        .route(
            "/providers/secrets/:profile_id",
            get(provider_secrets::provider_secret_status)
                .put(provider_secrets::set_provider_secret)
                .delete(provider_secrets::delete_provider_secret),
        )
        .route(
            "/providers/secrets/:profile_id/test",
            post(provider_secrets::test_provider_secret),
        )
        // Loom intentionally does not proxy Ollama /api/create or /api/push.
        // Model-management APIs can load attacker-controlled model data or
        // publish local model data and are disabled by default policy.
        .route("/capabilities/system", get(capabilities::system))
        .route("/capabilities/models", get(capabilities::models))
        .route("/capabilities/models/seed", post(capabilities::seed_models))
        .route(
            "/capabilities/models/discover",
            post(capabilities::discover_models),
        )
        .route(
            "/capabilities/strategy/resolve",
            post(capabilities::resolve_strategy),
        )
        .route("/capabilities/estimate", post(capabilities::estimate))
        .route("/capabilities/benchmarks", get(capabilities::benchmarks))
        .route("/capabilities/community", get(capabilities::community))
        .route(
            "/capabilities/community/import",
            post(capabilities::import_community),
        )
        .layer(middleware::from_fn(local_cors))
        .with_state(state)
}

async fn local_cors(request: Request<Body>, next: Next) -> Response {
    if request.method() == Method::OPTIONS {
        return with_cors_headers(StatusCode::NO_CONTENT.into_response());
    }

    with_cors_headers(next.run(request).await)
}

async fn speech_transcribe_body_limit(request: Request<Body>, next: Next) -> Response {
    let content_length = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if content_length
        .map(|length| length > speech::SPEECH_TRANSCRIBE_HTTP_BODY_LIMIT_BYTES as u64)
        .unwrap_or(false)
    {
        tracing::warn!(
            content_length,
            http_body_limit_bytes = speech::SPEECH_TRANSCRIBE_HTTP_BODY_LIMIT_BYTES,
            "speech transcription rejected before body extraction"
        );
        return speech::payload_too_large_error(content_length).into_response();
    }

    next.run(request).await
}

fn with_cors_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET,POST,PATCH,DELETE,OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type,authorization"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    response
}
