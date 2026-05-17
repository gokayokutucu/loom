use crate::{
    api::state::AppState,
    context::readiness::{ContextReadinessGate, ContextReadinessInput, ContextReadinessResult},
    context::worker::{ContextWorkerRunOptions, ContextWorkerRunResult},
    runtime::OperationKind,
    storage::repositories::context_artifacts::ContextBuildJobRecord,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

pub async fn prepare(
    State(state): State<AppState>,
    Json(input): Json<ContextReadinessInput>,
) -> Result<Json<ContextReadinessResult>, (StatusCode, Json<ContextApiError>)> {
    let _operation = state.operations.start(
        format!("context-prepare-{}", input.loom_id),
        OperationKind::ContextBuild,
    );
    let gate = ContextReadinessGate::new(&state.database);
    gate.prepare(input).await.map(Json).map_err(context_error)
}

pub async fn list_jobs(
    State(state): State<AppState>,
    Query(query): Query<ContextJobsQuery>,
) -> Result<Json<Vec<ContextBuildJobRecord>>, (StatusCode, Json<ContextApiError>)> {
    crate::context::worker::ContextArtifactWorker::new(&state.database)
        .list_jobs(query.status.as_deref())
        .await
        .map(Json)
        .map_err(context_error)
}

pub async fn run_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    body: Option<Json<ContextWorkerRunRequest>>,
) -> Result<Json<ContextWorkerRunResult>, (StatusCode, Json<ContextApiError>)> {
    let _operation = state
        .operations
        .start(format!("context-job-{job_id}"), OperationKind::ContextBuild);
    crate::context::worker::ContextArtifactWorker::new(&state.database)
        .run_job_with_options(
            &job_id,
            run_options(&state, body.as_ref().map(|body| &body.0)),
        )
        .await
        .map(Json)
        .map_err(context_error)
}

pub async fn run_next_job(
    State(state): State<AppState>,
    body: Option<Json<ContextWorkerRunRequest>>,
) -> Result<Json<ContextWorkerRunNextResponse>, (StatusCode, Json<ContextApiError>)> {
    let _operation = state.operations.start(
        "context-job-run-next".to_string(),
        OperationKind::ContextBuild,
    );
    crate::context::worker::ContextArtifactWorker::new(&state.database)
        .run_next_pending_job_with_options(run_options(&state, body.as_ref().map(|body| &body.0)))
        .await
        .map(|result| {
            Json(ContextWorkerRunNextResponse {
                ran: result.is_some(),
                result,
            })
        })
        .map_err(context_error)
}

fn run_options(
    state: &AppState,
    request: Option<&ContextWorkerRunRequest>,
) -> ContextWorkerRunOptions {
    ContextWorkerRunOptions {
        refine_with_llm: request
            .and_then(|request| request.refine_with_llm)
            .unwrap_or(false)
            || state
                .config
                .current()
                .features
                .enable_llm_artifact_refinement,
    }
}

fn context_error(error: crate::error::ServiceError) -> (StatusCode, Json<ContextApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ContextApiError {
            code: "CONTEXT_PREPARE_FAILED".to_string(),
            message: error.to_string(),
        }),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextJobsQuery {
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextWorkerRunRequest {
    pub refine_with_llm: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextWorkerRunNextResponse {
    pub ran: bool,
    pub result: Option<ContextWorkerRunResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextApiError {
    pub code: String,
    pub message: String,
}
