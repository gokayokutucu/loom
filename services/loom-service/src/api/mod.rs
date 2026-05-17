mod ask;
mod bookmarks;
mod capabilities;
mod config;
mod context;
mod dev;
mod events;
pub(crate) mod exports;
pub(crate) mod graph;
mod health;
mod history;
mod looms;
mod ollama;
mod orchestration;
mod references;
pub(crate) mod resolve;
mod responses;
mod speech;
mod state;
mod ui_state;
mod wefts;

use crate::config::ConfigManager;
use crate::providers::ollama::OllamaRuntime;
use crate::runtime::{OperationTracker, RestartState};
use crate::storage::db::Database;
use axum::{
    body::Body,
    http::{header, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Router,
};
use state::AppState;

pub fn router(
    database: Database,
    ollama: OllamaRuntime,
    config: ConfigManager,
    operations: OperationTracker,
    restart: RestartState,
) -> Router {
    let state = AppState {
        database,
        ollama,
        config,
        operations,
        restart,
    };

    Router::new()
        .route("/health", get(health::health))
        .route("/version", get(health::version))
        .route("/events", get(events::events_stream))
        .route(
            "/config",
            get(config::get_config).patch(config::patch_config),
        )
        .route("/runtime/restart-status", get(config::restart_status))
        .route("/runtime/restart", post(config::request_restart))
        .route("/resolve", post(resolve::resolve))
        .route("/dev/seed-fixtures", post(dev::seed_fixtures))
        .route("/dev/e2e-proof/:loom_id", get(dev::e2e_proof))
        .route("/ask/quick", post(ask::quick))
        .route("/speech/transcribe", post(speech::transcribe))
        .route("/speech/provider/health", get(speech::provider_health))
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
        .route("/wefts", post(wefts::create_weft))
        .route("/looms", get(looms::list_looms).post(looms::create_loom))
        .route(
            "/looms/:loom_id",
            get(looms::get_loom)
                .patch(looms::patch_loom)
                .delete(looms::delete_loom),
        )
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
        .route("/exports/loom", post(exports::export_loom))
        .route("/exports/response", post(exports::export_response))
        .route(
            "/responses/:response_id/regenerate",
            post(orchestration::regenerate_response),
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
