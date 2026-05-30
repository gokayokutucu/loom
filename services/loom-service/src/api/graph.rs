use crate::{
    api::state::AppState,
    display_code::{display_code, DisplayCodeKind},
    error::ServiceError,
    storage::{
        db::Database,
        repositories::{
            addresses::AddressRepository,
            bookmarks::{BookmarkRecord, BookmarkRepository},
            looms::{LoomRecord, LoomRepository},
            references::{ReferenceRecord, ReferenceRepository},
            responses::{ResponseRecord, ResponseRepository},
        },
    },
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const REFERENCE_EDGE_CAP: usize = 50;
const GRAPH_LANE_WIDTH: f64 = 360.0;
const GRAPH_ROW_GAP: f64 = 300.0;
const GRAPH_DERIVED_LOOM_DEPTH_LIMIT: usize = 8;

const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GraphQuery {
    #[serde(default)]
    pub include_references: bool,
    #[serde(default)]
    pub include_bookmarks: bool,
    pub focused_response_id: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphProjectionResult {
    pub loom_id: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub focused_node_id: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub kind: String,
    pub loom_id: String,
    pub response_id: Option<String>,
    pub title: String,
    pub preview: Option<String>,
    pub code: Option<String>,
    pub display_code: String,
    pub canonical_uri: Option<String>,
    pub depth: i64,
    pub lane: i64,
    pub position: Option<GraphPosition>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub target: String,
    pub label: Option<String>,
    pub prompt_text: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphApiError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoomAncestryStepResult {
    pub loom_id: String,
    pub has_parent_ancestry: bool,
    pub parent_loom: Option<LoomAncestryLoomSummary>,
    pub parent_origin_response: Option<LoomAncestryResponseSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoomAncestryLoomSummary {
    pub loom_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub canonical_uri: Option<String>,
    pub code: Option<String>,
    pub display_code: String,
    pub kind: String,
    pub origin_loom_id: Option<String>,
    pub origin_response_id: Option<String>,
    pub has_parent_ancestry: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoomAncestryResponseSummary {
    pub response_id: String,
    pub loom_id: String,
    pub title: String,
    pub preview: Option<String>,
    pub canonical_uri: Option<String>,
    pub code: Option<String>,
    pub display_code: String,
}

#[derive(Debug)]
pub(crate) enum GraphProjectionError {
    NotFound,
    Archived,
    Storage(ServiceError),
}

#[derive(Debug, Clone)]
struct ProjectedResponseNode<'a> {
    response: &'a ResponseRecord,
    prompt: Option<&'a ResponseRecord>,
}

struct DerivedLoomFrame {
    loom_id: String,
    depth: i64,
    ancestry_depth: usize,
}

pub async fn get_graph(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
    Query(query): Query<GraphQuery>,
) -> Result<Json<GraphProjectionResult>, (StatusCode, Json<GraphApiError>)> {
    build_graph_projection(&state.database, &loom_id, query)
        .await
        .map(Json)
        .map_err(graph_error)
}

pub async fn get_ancestry_step(
    State(state): State<AppState>,
    Path(loom_id): Path<String>,
) -> Result<Json<LoomAncestryStepResult>, (StatusCode, Json<GraphApiError>)> {
    build_ancestry_step(&state.database, &loom_id)
        .await
        .map(Json)
        .map_err(graph_error)
}

pub(crate) async fn build_ancestry_step(
    database: &Database,
    loom_id: &str,
) -> Result<LoomAncestryStepResult, GraphProjectionError> {
    let loom_repository = LoomRepository::new(database);
    let response_repository = ResponseRepository::new(database);
    let Some(loom) = loom_repository
        .get_loom(loom_id)
        .await
        .map_err(GraphProjectionError::Storage)?
    else {
        return Err(GraphProjectionError::NotFound);
    };

    if loom.archived_at.is_some() || loom.is_deleted {
        return Err(GraphProjectionError::Archived);
    }

    let mut warnings = Vec::new();
    let has_parent_ancestry = loom.origin_loom_id.is_some() && loom.origin_response_id.is_some();
    let (Some(parent_loom_id), Some(parent_origin_response_id)) = (
        loom.origin_loom_id.as_deref(),
        loom.origin_response_id.as_deref(),
    ) else {
        return Ok(LoomAncestryStepResult {
            loom_id: loom.loom_id,
            has_parent_ancestry: false,
            parent_loom: None,
            parent_origin_response: None,
            warnings,
        });
    };

    let parent_loom = loom_repository
        .get_loom(parent_loom_id)
        .await
        .map_err(GraphProjectionError::Storage)?;
    let parent_origin_response = response_repository
        .get_response(parent_origin_response_id)
        .await
        .map_err(GraphProjectionError::Storage)?;

    match (parent_loom, parent_origin_response) {
        (Some(parent_loom), Some(parent_origin_response))
            if parent_origin_response.loom_id == parent_loom.loom_id =>
        {
            Ok(LoomAncestryStepResult {
                loom_id: loom.loom_id,
                has_parent_ancestry,
                parent_loom: Some(loom_ancestry_summary(&parent_loom)),
                parent_origin_response: Some(response_ancestry_summary(&parent_origin_response)),
                warnings,
            })
        }
        (Some(_), Some(parent_origin_response)) => {
            warnings.push(format!(
                "Skipped ancestry step for {} because origin Response {} belongs to another Loom.",
                loom.loom_id, parent_origin_response.response_id
            ));
            Ok(LoomAncestryStepResult {
                loom_id: loom.loom_id,
                has_parent_ancestry,
                parent_loom: None,
                parent_origin_response: None,
                warnings,
            })
        }
        (None, _) => {
            warnings.push(format!(
                "Skipped ancestry step for {} because parent Loom is missing.",
                loom.loom_id
            ));
            Ok(LoomAncestryStepResult {
                loom_id: loom.loom_id,
                has_parent_ancestry,
                parent_loom: None,
                parent_origin_response: None,
                warnings,
            })
        }
        (_, None) => {
            warnings.push(format!(
                "Skipped ancestry step for {} because parent origin Response is missing.",
                loom.loom_id
            ));
            Ok(LoomAncestryStepResult {
                loom_id: loom.loom_id,
                has_parent_ancestry,
                parent_loom: None,
                parent_origin_response: None,
                warnings,
            })
        }
    }
}

pub(crate) async fn build_graph_projection(
    database: &Database,
    loom_id: &str,
    query: GraphQuery,
) -> Result<GraphProjectionResult, GraphProjectionError> {
    let loom_repository = LoomRepository::new(database);
    let response_repository = ResponseRepository::new(database);
    let reference_repository = ReferenceRepository::new(database);
    let bookmark_repository = BookmarkRepository::new(database);
    let Some(root) = loom_repository
        .get_loom(loom_id)
        .await
        .map_err(GraphProjectionError::Storage)?
    else {
        return Err(GraphProjectionError::NotFound);
    };

    if root.archived_at.is_some() || root.is_deleted {
        return Err(GraphProjectionError::Archived);
    }

    let responses = response_repository
        .list_responses_for_loom(loom_id)
        .await
        .map_err(GraphProjectionError::Storage)?;
    let mut warnings = Vec::new();

    let root_node_id = loom_node_id(&root.loom_id);
    let is_weft_root = root.kind == "weft";
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut response_depths = HashMap::new();
    let mut response_node_ids = HashMap::new();
    let mut loom_node_ids = HashMap::new();
    let mut root_depth = 0_i64;

    if is_weft_root {
        match (
            root.origin_loom_id.as_deref(),
            root.origin_response_id.as_deref(),
        ) {
            (Some(origin_loom_id), Some(origin_response_id)) => {
                let origin_loom = loom_repository
                    .get_loom(origin_loom_id)
                    .await
                    .map_err(GraphProjectionError::Storage)?;
                let origin_response = response_repository
                    .get_response(origin_response_id)
                    .await
                    .map_err(GraphProjectionError::Storage)?;

                match (origin_loom, origin_response) {
                    (Some(origin_loom), Some(origin_response))
                        if origin_response.loom_id == origin_loom.loom_id =>
                    {
                        let origin_loom_node_id = loom_node_id(&origin_loom.loom_id);
                        let origin_response_node_id =
                            response_node_id(&origin_response.response_id);
                        loom_node_ids
                            .insert(origin_loom.loom_id.clone(), origin_loom_node_id.clone());
                        response_depths.insert(origin_response.response_id.clone(), 1);
                        response_node_ids.insert(
                            origin_response.response_id.clone(),
                            origin_response_node_id.clone(),
                        );

                        let mut origin_node = with_graph_role(
                            loom_node(&origin_loom, &origin_loom_node_id, 0, 0),
                            "origin-context",
                        );
                        set_metadata_bool(
                            &mut origin_node,
                            "hasParentAncestry",
                            origin_loom.origin_loom_id.is_some()
                                && origin_loom.origin_response_id.is_some(),
                        );
                        nodes.push(origin_node);
                        nodes.push(with_graph_role(
                            response_node(&origin_response, None, &origin_response_node_id, 1, 0),
                            "origin-response",
                        ));
                        edges.push(GraphEdge {
                            id: format!("edge:{}:{}", origin_loom_node_id, origin_response_node_id),
                            kind: "loom_response_origin".to_string(),
                            source: origin_loom_node_id,
                            target: origin_response_node_id.clone(),
                            label: Some("Origin response".to_string()),
                            prompt_text: None,
                            metadata: Some(serde_json::json!({
                                "originLoomId": origin_loom_id,
                                "originResponseId": origin_response_id
                            })),
                        });
                        edges.push(GraphEdge {
                            id: format!("edge:{}:{}", origin_response_node_id, root_node_id),
                            kind: "weft_origin".to_string(),
                            source: origin_response_node_id,
                            target: root_node_id.clone(),
                            label: Some("Weft origin".to_string()),
                            prompt_text: None,
                            metadata: Some(serde_json::json!({
                                "originLoomId": origin_loom_id,
                                "originResponseId": origin_response_id
                            })),
                        });
                        root_depth = 2;
                    }
                    (Some(_), Some(origin_response)) => {
                        warnings.push(format!(
                            "Skipped Weft origin context for {} because origin Response {} belongs to another Loom.",
                            root.loom_id, origin_response.response_id
                        ));
                    }
                    (None, _) => warnings.push(format!(
                        "Skipped Weft origin context for {} because origin Loom is missing.",
                        root.loom_id
                    )),
                    (_, None) => warnings.push(format!(
                        "Skipped Weft origin context for {} because origin Response is missing.",
                        root.loom_id
                    )),
                }
            }
            _ => warnings.push(format!(
                "Skipped Weft origin context for {} because origin metadata is incomplete.",
                root.loom_id
            )),
        }
    }

    loom_node_ids.insert(root.loom_id.clone(), root_node_id.clone());
    nodes.push(with_graph_role(
        loom_node(&root, &root_node_id, root_depth, 0),
        "current-root",
    ));

    let projected_responses = project_response_nodes(&responses);
    for (index, projected_response) in projected_responses.iter().enumerate() {
        let response = projected_response.response;
        let depth = root_depth + (index as i64) + 1;
        let node_id = response_node_id(&response.response_id);
        response_depths.insert(response.response_id.clone(), depth);
        response_node_ids.insert(response.response_id.clone(), node_id.clone());
        if let Some(prompt) = projected_response.prompt {
            response_depths.insert(prompt.response_id.clone(), depth);
            response_node_ids.insert(prompt.response_id.clone(), node_id.clone());
        }
        nodes.push(with_graph_role(
            response_node(response, projected_response.prompt, &node_id, depth, 0),
            "child-response",
        ));

        if index == 0 {
            edges.push(GraphEdge {
                id: format!("edge:{}:{}", root_node_id, node_id),
                kind: "loom_response".to_string(),
                source: root_node_id.clone(),
                target: node_id,
                label: None,
                prompt_text: None,
                metadata: None,
            });
        } else {
            let previous = projected_responses[index - 1].response;
            let source = response_node_id(&previous.response_id);
            edges.push(GraphEdge {
                id: format!("edge:{}:{}", source, node_id),
                kind: "response_sequence".to_string(),
                source,
                target: node_id,
                label: None,
                prompt_text: None,
                metadata: None,
            });
        }
    }

    append_derived_loom_branches(
        &loom_repository,
        &response_repository,
        loom_id,
        root_depth,
        &mut nodes,
        &mut edges,
        &mut response_depths,
        &mut response_node_ids,
        &mut loom_node_ids,
        &mut warnings,
    )
    .await
    .map_err(GraphProjectionError::Storage)?;

    if query.include_references {
        let references = reference_repository
            .list_references_for_loom(loom_id)
            .await
            .map_err(GraphProjectionError::Storage)?;
        add_reference_edges(
            database,
            &references,
            &response_node_ids,
            &loom_node_ids,
            &mut edges,
            &mut warnings,
        )
        .await
        .map_err(GraphProjectionError::Storage)?;
    }

    if query.include_bookmarks {
        let bookmarks = bookmark_repository
            .list_bookmarks()
            .await
            .map_err(GraphProjectionError::Storage)?;
        annotate_bookmarks(
            &bookmarks,
            &mut nodes,
            &response_node_ids,
            &loom_node_ids,
            &mut warnings,
        );
    }

    let focused_node_id = query
        .focused_response_id
        .and_then(|response_id| response_node_ids.get(&response_id).cloned());

    Ok(GraphProjectionResult {
        loom_id: loom_id.to_string(),
        nodes,
        edges,
        focused_node_id,
        warnings,
    })
}

async fn append_derived_loom_branches(
    loom_repository: &LoomRepository,
    response_repository: &ResponseRepository,
    origin_loom_id: &str,
    root_depth: i64,
    nodes: &mut Vec<GraphNode>,
    edges: &mut Vec<GraphEdge>,
    response_depths: &mut HashMap<String, i64>,
    response_node_ids: &mut HashMap<String, String>,
    loom_node_ids: &mut HashMap<String, String>,
    warnings: &mut Vec<String>,
) -> Result<(), ServiceError> {
    let mut visited_loom_ids: HashSet<String> = HashSet::from([origin_loom_id.to_string()]);
    let mut stack = vec![DerivedLoomFrame {
        loom_id: origin_loom_id.to_string(),
        depth: root_depth,
        ancestry_depth: 0,
    }];
    let mut next_lane = 1_i64;

    while let Some(frame) = stack.pop() {
        if frame.ancestry_depth >= GRAPH_DERIVED_LOOM_DEPTH_LIMIT {
            warnings.push(format!(
                "Skipped deeper derived Loom branches for {} because the graph depth limit was reached.",
                frame.loom_id
            ));
            continue;
        }

        let child_wefts = loom_repository
            .list_child_wefts_by_origin_loom(&frame.loom_id)
            .await?;
        for weft in child_wefts {
            if !visited_loom_ids.insert(weft.loom_id.clone()) {
                warnings.push(format!(
                    "Skipped derived Loom {} because it was already projected.",
                    weft.loom_id
                ));
                continue;
            }

            let source_response_id = weft.origin_response_id.clone();
            let depth = source_response_id
                .as_ref()
                .and_then(|response_id| response_depths.get(response_id))
                .map(|depth| depth + 1)
                .unwrap_or(frame.depth + 1);
            let lane = next_lane;
            next_lane += 1;
            let weft_node_id = loom_node_id(&weft.loom_id);
            loom_node_ids.insert(weft.loom_id.clone(), weft_node_id.clone());
            nodes.push(with_graph_role(
                loom_node(&weft, &weft_node_id, depth, lane),
                "child-weft",
            ));

            if let Some(source_response_id) = source_response_id {
                if let Some(source) = response_node_ids.get(&source_response_id) {
                    edges.push(GraphEdge {
                        id: format!("edge:{}:{}", source, weft_node_id),
                        kind: "weft_origin".to_string(),
                        source: source.clone(),
                        target: weft_node_id.clone(),
                        label: Some("Weft origin".to_string()),
                        prompt_text: None,
                        metadata: Some(serde_json::json!({
                            "originLoomId": frame.loom_id,
                            "originResponseId": source_response_id
                        })),
                    });
                } else {
                    warnings.push(format!(
                        "Skipped Weft origin edge for {} because origin Response is missing.",
                        weft.loom_id
                    ));
                }
            } else {
                warnings.push(format!(
                    "Skipped Weft origin edge for {} because origin Response metadata is missing.",
                    weft.loom_id
                ));
            }

            let weft_responses = response_repository
                .list_responses_for_loom(&weft.loom_id)
                .await?;
            let projected_weft_responses = project_response_nodes(&weft_responses);
            for (response_index, projected_response) in projected_weft_responses.iter().enumerate()
            {
                let response = projected_response.response;
                let response_depth = depth + (response_index as i64) + 1;
                let weft_response_node_id = response_node_id(&response.response_id);
                response_depths.insert(response.response_id.clone(), response_depth);
                response_node_ids
                    .insert(response.response_id.clone(), weft_response_node_id.clone());
                if let Some(prompt) = projected_response.prompt {
                    response_depths.insert(prompt.response_id.clone(), response_depth);
                    response_node_ids
                        .insert(prompt.response_id.clone(), weft_response_node_id.clone());
                }
                nodes.push(with_graph_role(
                    response_node(
                        response,
                        projected_response.prompt,
                        &weft_response_node_id,
                        response_depth,
                        lane,
                    ),
                    "child-response",
                ));

                if response_index == 0 {
                    edges.push(GraphEdge {
                        id: format!("edge:{}:{}", weft_node_id, weft_response_node_id),
                        kind: "loom_response".to_string(),
                        source: weft_node_id.clone(),
                        target: weft_response_node_id,
                        label: None,
                        prompt_text: None,
                        metadata: None,
                    });
                } else {
                    let previous = projected_weft_responses[response_index - 1].response;
                    let source = response_node_id(&previous.response_id);
                    edges.push(GraphEdge {
                        id: format!("edge:{}:{}", source, weft_response_node_id),
                        kind: "response_sequence".to_string(),
                        source,
                        target: weft_response_node_id,
                        label: None,
                        prompt_text: None,
                        metadata: None,
                    });
                }
            }

            stack.push(DerivedLoomFrame {
                loom_id: weft.loom_id,
                depth,
                ancestry_depth: frame.ancestry_depth + 1,
            });
        }
    }

    Ok(())
}

fn project_response_nodes(responses: &[ResponseRecord]) -> Vec<ProjectedResponseNode<'_>> {
    let mut regenerated_response_indexes_by_user_id = HashMap::new();
    for (index, response) in responses.iter().enumerate() {
        if response.role == "assistant" {
            if let Some(user_response_id) = regenerated_from_user_response_id(response) {
                regenerated_response_indexes_by_user_id.insert(user_response_id, index);
            }
        }
    }

    let mut projected = Vec::new();
    let mut consumed_response_ids = HashSet::new();

    for (index, response) in responses.iter().enumerate() {
        if consumed_response_ids.contains(&response.response_id) {
            continue;
        }

        if response.role == "user" {
            if let Some(regenerated_response_index) =
                regenerated_response_indexes_by_user_id.get(&response.response_id)
            {
                let regenerated_response = &responses[*regenerated_response_index];
                if !consumed_response_ids.contains(&regenerated_response.response_id) {
                    consumed_response_ids.insert(response.response_id.clone());
                    consumed_response_ids.insert(regenerated_response.response_id.clone());
                    projected.push(ProjectedResponseNode {
                        response: regenerated_response,
                        prompt: Some(response),
                    });
                    continue;
                }
            }

            if let Some(next_response) = responses.get(index + 1) {
                if next_response.role == "assistant"
                    && !consumed_response_ids.contains(&next_response.response_id)
                {
                    consumed_response_ids.insert(response.response_id.clone());
                    consumed_response_ids.insert(next_response.response_id.clone());
                    projected.push(ProjectedResponseNode {
                        response: next_response,
                        prompt: Some(response),
                    });
                    continue;
                }
            }
        }

        consumed_response_ids.insert(response.response_id.clone());
        projected.push(ProjectedResponseNode {
            response,
            prompt: None,
        });
    }

    projected
}

fn regenerated_from_user_response_id(response: &ResponseRecord) -> Option<String> {
    response
        .metadata_json
        .as_deref()
        .and_then(|metadata| serde_json::from_str::<serde_json::Value>(metadata).ok())
        .and_then(|metadata| {
            metadata
                .get("regeneratedFromUserResponseId")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
}

pub(crate) async fn graph_projection_for_export(
    database: &Database,
    loom_id: &str,
    include_references: bool,
    include_bookmarks: bool,
) -> Result<Option<GraphProjectionResult>, ServiceError> {
    match build_graph_projection(
        database,
        loom_id,
        GraphQuery {
            include_references,
            include_bookmarks,
            focused_response_id: None,
        },
    )
    .await
    {
        Ok(graph) => Ok(Some(graph)),
        Err(GraphProjectionError::NotFound | GraphProjectionError::Archived) => Ok(None),
        Err(GraphProjectionError::Storage(error)) => Err(error),
    }
}

fn annotate_bookmarks(
    bookmarks: &[BookmarkRecord],
    nodes: &mut [GraphNode],
    response_node_ids: &HashMap<String, String>,
    loom_node_ids: &HashMap<String, String>,
    warnings: &mut Vec<String>,
) {
    let mut node_indexes_by_id = HashMap::new();
    let mut node_ids_by_canonical_uri = HashMap::new();
    for (index, node) in nodes.iter().enumerate() {
        node_indexes_by_id.insert(node.id.clone(), index);
        if let Some(canonical_uri) = node.canonical_uri.as_ref() {
            node_ids_by_canonical_uri.insert(canonical_uri.clone(), node.id.clone());
        }
    }

    let mut bookmarked_nodes = HashSet::new();
    for bookmark in bookmarks {
        if contains_forbidden_payload(bookmark.metadata_json.as_deref()) {
            warnings.push(format!(
                "bookmark_metadata_sanitized:{}",
                bookmark.bookmark_id
            ));
        }

        let Some(node_id) = bookmark_target_node(
            bookmark,
            response_node_ids,
            loom_node_ids,
            &node_ids_by_canonical_uri,
        ) else {
            warnings.push(format!(
                "bookmark_target_unresolved:{}",
                bookmark.bookmark_id
            ));
            continue;
        };

        if !bookmarked_nodes.insert(node_id.clone()) {
            warnings.push(format!("bookmark_duplicate_targets:{node_id}"));
            continue;
        }

        let Some(node_index) = node_indexes_by_id.get(&node_id).copied() else {
            warnings.push(format!(
                "bookmark_target_unresolved:{}",
                bookmark.bookmark_id
            ));
            continue;
        };
        set_bookmark_metadata(&mut nodes[node_index], bookmark);
    }
}

fn bookmark_target_node(
    bookmark: &BookmarkRecord,
    response_node_ids: &HashMap<String, String>,
    loom_node_ids: &HashMap<String, String>,
    node_ids_by_canonical_uri: &HashMap<String, String>,
) -> Option<String> {
    let node_by_kind = match bookmark.target_kind.as_str() {
        "response" => bookmark
            .target_id
            .as_ref()
            .and_then(|target_id| response_node_ids.get(target_id))
            .cloned(),
        "loom" | "weft" => bookmark
            .target_id
            .as_ref()
            .and_then(|target_id| loom_node_ids.get(target_id))
            .cloned(),
        _ => None,
    };

    node_by_kind.or_else(|| {
        bookmark
            .target_uri
            .as_ref()
            .and_then(|target_uri| node_ids_by_canonical_uri.get(target_uri))
            .cloned()
    })
}

fn set_bookmark_metadata(node: &mut GraphNode, bookmark: &BookmarkRecord) {
    let mut metadata = node
        .metadata
        .as_ref()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    metadata.insert(
        "bookmark".to_string(),
        serde_json::json!({
            "bookmarked": true,
            "bookmarkId": bookmark.bookmark_id,
            "title": sanitize_graph_text(&bookmark.title).unwrap_or_else(|| "Bookmark".to_string()),
            "createdAt": bookmark.created_at,
        }),
    );
    node.metadata = Some(serde_json::Value::Object(metadata));
}

async fn add_reference_edges(
    database: &Database,
    references: &[ReferenceRecord],
    response_node_ids: &HashMap<String, String>,
    loom_node_ids: &HashMap<String, String>,
    edges: &mut Vec<GraphEdge>,
    warnings: &mut Vec<String>,
) -> Result<(), ServiceError> {
    let addresses = AddressRepository::new(database);
    let mut added = 0_usize;
    let mut seen_edge_ids = HashSet::new();

    for reference in references {
        if added >= REFERENCE_EDGE_CAP {
            warnings.push("reference_edges_capped".to_string());
            break;
        }

        if contains_forbidden_payload(reference.metadata_json.as_deref()) {
            warnings.push(format!(
                "reference_metadata_sanitized:{}",
                reference.reference_id
            ));
        }

        let Some(source) = reference_source_node(reference, response_node_ids, loom_node_ids)
        else {
            warnings.push(format!(
                "reference_source_unresolved:{}",
                reference.reference_id
            ));
            continue;
        };

        let Some(target) =
            reference_target_node(reference, response_node_ids, loom_node_ids, &addresses).await?
        else {
            warnings.push(format!(
                "{}:{}",
                reference_target_warning(reference),
                reference.reference_id
            ));
            continue;
        };

        let edge_id = format!("reference:{}:{}:{}", reference.reference_id, source, target);
        if !seen_edge_ids.insert(edge_id.clone()) {
            continue;
        }

        edges.push(GraphEdge {
            id: edge_id,
            kind: "reference".to_string(),
            source,
            target,
            label: reference.label.as_deref().and_then(sanitize_graph_text),
            prompt_text: None,
            metadata: Some(reference_edge_metadata(reference)),
        });
        added += 1;
    }

    Ok(())
}

fn reference_source_node(
    reference: &ReferenceRecord,
    response_node_ids: &HashMap<String, String>,
    loom_node_ids: &HashMap<String, String>,
) -> Option<String> {
    reference
        .source_response_id
        .as_ref()
        .and_then(|response_id| response_node_ids.get(response_id))
        .cloned()
        .or_else(|| {
            reference
                .source_loom_id
                .as_ref()
                .and_then(|loom_id| loom_node_ids.get(loom_id))
                .cloned()
        })
}

async fn reference_target_node(
    reference: &ReferenceRecord,
    response_node_ids: &HashMap<String, String>,
    loom_node_ids: &HashMap<String, String>,
    addresses: &AddressRepository,
) -> Result<Option<String>, ServiceError> {
    if let Some(node) = reference_target_id_node(reference, response_node_ids, loom_node_ids) {
        return Ok(Some(node));
    }

    let Some(target_uri) = reference.target_uri.as_deref() else {
        return Ok(None);
    };
    let canonical_uri = match addresses.resolve_alias(target_uri).await? {
        Some(alias) => alias.canonical_uri,
        None => target_uri.to_string(),
    };
    let Some(address) = addresses.resolve_address(&canonical_uri).await? else {
        return Ok(None);
    };

    Ok(match address.object_kind.as_str() {
        "response" => response_node_ids.get(&address.object_id).cloned(),
        "loom" | "weft" => loom_node_ids.get(&address.object_id).cloned(),
        "fragment" => reference
            .target_id
            .as_ref()
            .and_then(|target_id| response_node_ids.get(target_id))
            .cloned()
            .or_else(|| {
                reference
                    .source_response_id
                    .as_ref()
                    .and_then(|source_response_id| response_node_ids.get(source_response_id))
                    .cloned()
            }),
        _ => None,
    })
}

fn reference_target_id_node(
    reference: &ReferenceRecord,
    response_node_ids: &HashMap<String, String>,
    loom_node_ids: &HashMap<String, String>,
) -> Option<String> {
    match reference.target_kind.as_str() {
        "response" => reference
            .target_id
            .as_ref()
            .and_then(|target_id| response_node_ids.get(target_id))
            .cloned(),
        "loom" | "weft" => reference
            .target_id
            .as_ref()
            .and_then(|target_id| loom_node_ids.get(target_id))
            .cloned(),
        "fragment" | "response_fragment" | "code_block" => reference
            .target_id
            .as_ref()
            .and_then(|target_id| response_node_ids.get(target_id))
            .cloned()
            .or_else(|| {
                reference
                    .source_response_id
                    .as_ref()
                    .and_then(|source_response_id| response_node_ids.get(source_response_id))
                    .cloned()
            }),
        _ => None,
    }
}

fn reference_target_warning(reference: &ReferenceRecord) -> &'static str {
    if reference
        .target_uri
        .as_deref()
        .map(|uri| !uri.starts_with("loom://"))
        .unwrap_or(false)
    {
        "reference_external_target_skipped"
    } else if reference.target_uri.is_some()
        || matches!(
            reference.target_kind.as_str(),
            "response" | "loom" | "weft" | "fragment" | "response_fragment" | "code_block"
        )
    {
        "reference_target_unresolved"
    } else {
        "reference_external_target_skipped"
    }
}

fn reference_edge_metadata(reference: &ReferenceRecord) -> serde_json::Value {
    serde_json::json!({
        "referenceId": reference.reference_id,
        "targetKind": reference.target_kind,
        "targetId": reference.target_id,
        "targetUri": reference.target_uri,
        "selectedTextPreview": reference
            .selected_text
            .as_deref()
            .and_then(sanitize_graph_text)
            .map(|value| truncate_chars(&value, 180)),
    })
}

fn loom_node(loom: &LoomRecord, id: &str, depth: i64, lane: i64) -> GraphNode {
    let kind = if loom.kind == "weft" { "weft" } else { "loom" };
    GraphNode {
        id: id.to_string(),
        kind: kind.to_string(),
        loom_id: loom.loom_id.clone(),
        response_id: None,
        title: sanitize_graph_text(&loom.title).unwrap_or_else(|| "Untitled Loom".to_string()),
        preview: loom.summary.as_deref().and_then(sanitize_graph_text),
        code: loom.code.clone(),
        display_code: display_code(
            if loom.kind == "weft" {
                DisplayCodeKind::Weft
            } else {
                DisplayCodeKind::Loom
            },
            &loom.loom_id,
        ),
        canonical_uri: loom.canonical_uri.clone(),
        depth,
        lane,
        position: Some(position(depth, lane)),
        metadata: loom_node_metadata(loom),
    }
}

fn loom_node_metadata(loom: &LoomRecord) -> Option<serde_json::Value> {
    let weft_kind = loom
        .metadata_json
        .as_deref()
        .and_then(|metadata| serde_json::from_str::<serde_json::Value>(metadata).ok())
        .and_then(|metadata| {
            metadata
                .get("weftKind")
                .and_then(|value| value.as_str())
                .filter(|value| *value == "exploration" || *value == "revision")
                .map(str::to_string)
        });
    weft_kind.map(|weft_kind| {
        serde_json::json!({
            "weftKind": weft_kind
        })
    })
}

fn loom_ancestry_summary(loom: &LoomRecord) -> LoomAncestryLoomSummary {
    LoomAncestryLoomSummary {
        loom_id: loom.loom_id.clone(),
        title: sanitize_graph_text(&loom.title).unwrap_or_else(|| "Untitled Loom".to_string()),
        summary: loom.summary.as_deref().and_then(sanitize_graph_text),
        canonical_uri: loom.canonical_uri.clone(),
        code: loom.code.clone(),
        display_code: display_code(
            if loom.kind == "weft" {
                DisplayCodeKind::Weft
            } else {
                DisplayCodeKind::Loom
            },
            &loom.loom_id,
        ),
        kind: if loom.kind == "weft" {
            "weft".to_string()
        } else {
            "loom".to_string()
        },
        origin_loom_id: loom.origin_loom_id.clone(),
        origin_response_id: loom.origin_response_id.clone(),
        has_parent_ancestry: loom.origin_loom_id.is_some() && loom.origin_response_id.is_some(),
    }
}

fn response_ancestry_summary(response: &ResponseRecord) -> LoomAncestryResponseSummary {
    LoomAncestryResponseSummary {
        response_id: response.response_id.clone(),
        loom_id: response.loom_id.clone(),
        title: response
            .title
            .as_deref()
            .and_then(sanitize_graph_text)
            .or_else(|| first_meaningful_phrase(&response.content))
            .unwrap_or_else(|| format!("{} Response", title_case(&response.role))),
        preview: first_meaningful_phrase(&response.content),
        canonical_uri: response.canonical_uri.clone(),
        code: response.code.clone(),
        display_code: display_code(DisplayCodeKind::Response, &response.response_id),
    }
}

fn response_node(
    response: &ResponseRecord,
    prompt: Option<&ResponseRecord>,
    id: &str,
    depth: i64,
    lane: i64,
) -> GraphNode {
    let title = prompt
        .and_then(|prompt| first_meaningful_phrase(&prompt.content))
        .or_else(|| response.title.as_deref().and_then(sanitize_graph_text))
        .or_else(|| first_meaningful_phrase(&response.content))
        .unwrap_or_else(|| format!("{} Response", title_case(&response.role)));

    GraphNode {
        id: id.to_string(),
        kind: "response".to_string(),
        loom_id: response.loom_id.clone(),
        response_id: Some(response.response_id.clone()),
        title,
        preview: preview(&response.content),
        code: response.code.clone(),
        display_code: display_code(DisplayCodeKind::Response, &response.response_id),
        canonical_uri: response.canonical_uri.clone(),
        depth,
        lane,
        position: Some(position(depth, lane)),
        metadata: None,
    }
}

fn with_graph_role(mut node: GraphNode, graph_role: &str) -> GraphNode {
    let mut metadata = node
        .metadata
        .as_ref()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    metadata.insert(
        "graphRole".to_string(),
        serde_json::Value::String(graph_role.to_string()),
    );
    node.metadata = Some(serde_json::Value::Object(metadata));
    node
}

fn set_metadata_bool(node: &mut GraphNode, key: &str, value: bool) {
    let mut metadata = node
        .metadata
        .as_ref()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    metadata.insert(key.to_string(), serde_json::json!(value));
    node.metadata = Some(serde_json::Value::Object(metadata));
}

fn position(depth: i64, lane: i64) -> GraphPosition {
    GraphPosition {
        x: (lane as f64) * GRAPH_LANE_WIDTH,
        y: (depth as f64) * GRAPH_ROW_GAP,
    }
}

fn first_meaningful_phrase(content: &str) -> Option<String> {
    let sanitized = sanitize_graph_text(content)?;
    let phrase = sanitized
        .split(['.', '\n', '?', '!'])
        .map(str::trim)
        .find(|part| !part.is_empty())
        .unwrap_or(sanitized.trim());
    Some(truncate_chars(phrase, 80))
}

fn preview(content: &str) -> Option<String> {
    sanitize_graph_text(content).map(|value| truncate_chars(&value, 180))
}

fn sanitize_graph_text(input: &str) -> Option<String> {
    let compact = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return None;
    }
    let lower = compact.to_lowercase();
    if FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|forbidden| lower.contains(forbidden))
    {
        return Some("[redacted private reasoning]".to_string());
    }
    Some(compact)
}

fn contains_forbidden_payload(payload: Option<&str>) -> bool {
    payload
        .map(|payload| {
            FORBIDDEN_THINKING_KEYS
                .iter()
                .any(|forbidden| payload.contains(forbidden))
        })
        .unwrap_or(false)
}

fn truncate_chars(input: &str, limit: usize) -> String {
    let mut output = String::new();
    for (index, character) in input.chars().enumerate() {
        if index >= limit {
            output.push_str("...");
            return output;
        }
        output.push(character);
    }
    output
}

fn title_case(input: &str) -> String {
    let mut characters = input.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => "Unknown".to_string(),
    }
}

fn loom_node_id(loom_id: &str) -> String {
    format!("loom:{loom_id}")
}

fn response_node_id(response_id: &str) -> String {
    format!("response:{response_id}")
}

fn graph_error(error: GraphProjectionError) -> (StatusCode, Json<GraphApiError>) {
    match error {
        GraphProjectionError::NotFound => (
            StatusCode::NOT_FOUND,
            Json(GraphApiError {
                code: "LOOM_NOT_FOUND".to_string(),
                message: "Loom not found".to_string(),
            }),
        ),
        GraphProjectionError::Archived => (
            StatusCode::GONE,
            Json(GraphApiError {
                code: "LOOM_ARCHIVED".to_string(),
                message: "Loom is archived".to_string(),
            }),
        ),
        GraphProjectionError::Storage(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GraphApiError {
                code: "GRAPH_PROJECTION_FAILED".to_string(),
                message: error.to_string(),
            }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_ancestry_step, build_graph_projection, GraphProjectionError, GraphQuery,
        GRAPH_ROW_GAP,
    };
    use crate::storage::{
        db::test_database,
        repositories::{
            bookmarks::{BookmarkRepository, NewBookmark},
            looms::{LoomRepository, NewLoom},
            references::{NewReference, ReferenceRepository},
            responses::{NewResponse, ResponseRepository},
        },
    };

    #[tokio::test]
    async fn loom_with_responses_returns_root_and_turn_response_node() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Trip Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "user", "Plan Greece", 0).await;
        insert_response(
            &database,
            "loom-1",
            "response-2",
            "assistant",
            "Visit Athens and Santorini.",
            1,
        )
        .await;

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");

        assert_eq!(graph.loom_id, "loom-1");
        assert_eq!(graph.nodes.len(), 2);
        assert!(graph.nodes.iter().any(|node| node.id == "loom:loom-1"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "loom:loom-1" && node.display_code.starts_with("L-")));
        assert!(!graph
            .nodes
            .iter()
            .any(|node| node.id == "response:response-1"));
        let response = graph
            .nodes
            .iter()
            .find(|node| node.id == "response:response-2")
            .expect("turn response node");
        assert_eq!(response.title, "Plan Greece");
        assert_eq!(
            response.preview.as_deref(),
            Some("Visit Athens and Santorini.")
        );
        assert!(response.display_code.starts_with("R-"));
    }

    #[tokio::test]
    async fn ancestry_step_returns_false_for_root_loom() {
        let database = test_database().await;
        insert_loom(&database, "loom-root", "Root Loom", "loom", None, None).await;

        let step = build_ancestry_step(&database, "loom-root")
            .await
            .expect("ancestry step");

        assert_eq!(step.loom_id, "loom-root");
        assert!(!step.has_parent_ancestry);
        assert!(step.parent_loom.is_none());
        assert!(step.parent_origin_response.is_none());
        assert!(step.warnings.is_empty());
    }

    #[tokio::test]
    async fn ancestry_step_returns_exact_one_parent_step_without_unrelated_responses() {
        let database = test_database().await;
        insert_loom(&database, "loom-a", "Ancestor Loom A", "loom", None, None).await;
        insert_response(
            &database,
            "loom-a",
            "response-a-origin",
            "assistant",
            "A origin answer",
            0,
        )
        .await;
        insert_response(
            &database,
            "loom-a",
            "response-a-other",
            "assistant",
            "A unrelated answer",
            1,
        )
        .await;
        insert_loom(
            &database,
            "weft-b",
            "Weft B",
            "weft",
            Some("loom-a"),
            Some("response-a-origin"),
        )
        .await;
        insert_response(
            &database,
            "weft-b",
            "response-b-origin",
            "assistant",
            "B origin answer",
            0,
        )
        .await;
        insert_loom(
            &database,
            "weft-c",
            "Weft C",
            "weft",
            Some("weft-b"),
            Some("response-b-origin"),
        )
        .await;

        let step = build_ancestry_step(&database, "weft-b")
            .await
            .expect("ancestry step");

        assert!(step.has_parent_ancestry);
        assert_eq!(
            step.parent_loom.as_ref().map(|loom| loom.loom_id.as_str()),
            Some("loom-a")
        );
        assert_eq!(
            step.parent_origin_response
                .as_ref()
                .map(|response| response.response_id.as_str()),
            Some("response-a-origin")
        );
        assert_eq!(
            step.parent_origin_response
                .as_ref()
                .map(|response| response.preview.as_deref()),
            Some(Some("A origin answer"))
        );
        assert!(!serde_json::to_string(&step)
            .expect("serialize step")
            .contains("response-a-other"));

        let c_step = build_ancestry_step(&database, "weft-c")
            .await
            .expect("ancestry step");
        assert_eq!(
            c_step
                .parent_loom
                .as_ref()
                .map(|loom| loom.loom_id.as_str()),
            Some("weft-b")
        );
        assert_eq!(
            c_step
                .parent_loom
                .as_ref()
                .map(|loom| loom.has_parent_ancestry),
            Some(true)
        );
    }

    #[tokio::test]
    async fn ancestry_step_warns_for_missing_parent_origin_response() {
        let database = test_database().await;
        insert_loom(&database, "loom-a", "Ancestor Loom A", "loom", None, None).await;
        insert_loom(
            &database,
            "weft-b",
            "Weft B",
            "weft",
            Some("loom-a"),
            Some("missing-response"),
        )
        .await;

        let step = build_ancestry_step(&database, "weft-b")
            .await
            .expect("ancestry step");

        assert!(step.has_parent_ancestry);
        assert!(step.parent_loom.is_none());
        assert!(step.parent_origin_response.is_none());
        assert!(step
            .warnings
            .iter()
            .any(|warning| warning.contains("parent origin Response is missing")));
    }

    #[tokio::test]
    async fn response_sequence_edges_are_ordered_by_sequence_index() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Ordered Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-late", "assistant", "Late", 2).await;
        insert_response(&database, "loom-1", "response-early", "user", "Early", 0).await;
        insert_response(
            &database,
            "loom-1",
            "response-middle",
            "assistant",
            "Middle",
            1,
        )
        .await;

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");

        let sequence_edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|edge| edge.kind == "response_sequence")
            .collect();
        assert_eq!(sequence_edges.len(), 1);
        assert_eq!(sequence_edges[0].source, "response:response-middle");
        assert_eq!(sequence_edges[0].target, "response:response-late");
    }

    #[tokio::test]
    async fn regenerated_assistant_pairs_with_edited_user_prompt() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Edit Loom", "loom", None, None).await;
        insert_response(
            &database,
            "loom-1",
            "response-user-1",
            "user",
            "Original question",
            0,
        )
        .await;
        insert_response(
            &database,
            "loom-1",
            "response-assistant-1",
            "assistant",
            "Original answer",
            1,
        )
        .await;
        insert_response(
            &database,
            "loom-1",
            "response-user-2",
            "user",
            "AWS uzerinde nasil entegre edilir",
            2,
        )
        .await;
        insert_response_with_metadata(
            &database,
            "loom-1",
            "response-assistant-2",
            "assistant",
            "AWS uzerinde Event Sourcing entegrasyonu birden fazla yolla yapilir.",
            3,
            r#"{"regeneratedFromUserResponseId":"response-user-2"}"#,
        )
        .await;

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");

        assert!(!graph
            .nodes
            .iter()
            .any(|node| node.id == "response:response-user-2"));
        let regenerated = graph
            .nodes
            .iter()
            .find(|node| node.id == "response:response-assistant-2")
            .expect("regenerated assistant node");
        assert_eq!(regenerated.title, "AWS uzerinde nasil entegre edilir");
        assert_eq!(
            regenerated.preview.as_deref(),
            Some("AWS uzerinde Event Sourcing entegrasyonu birden fazla yolla yapilir.")
        );
        assert_eq!(
            graph.focused_node_id, None,
            "default graph should not set focus"
        );
    }

    #[tokio::test]
    async fn focused_user_response_id_resolves_to_paired_assistant_node() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Focus Pair Loom", "loom", None, None).await;
        insert_response(
            &database,
            "loom-1",
            "response-user",
            "user",
            "Focus prompt",
            0,
        )
        .await;
        insert_response(
            &database,
            "loom-1",
            "response-assistant",
            "assistant",
            "Focus answer",
            1,
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                focused_response_id: Some("response-user".to_string()),
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        assert_eq!(
            graph.focused_node_id.as_deref(),
            Some("response:response-assistant")
        );
    }

    #[tokio::test]
    async fn response_preview_is_generated() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Preview Loom", "loom", None, None).await;
        insert_response(
            &database,
            "loom-1",
            "response-1",
            "assistant",
            "Athens has museums, food, and ferry access.",
            0,
        )
        .await;

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");
        let response = graph
            .nodes
            .iter()
            .find(|node| node.id == "response:response-1")
            .expect("response node");

        assert_eq!(
            response.preview.as_deref(),
            Some("Athens has museums, food, and ferry access.")
        );
    }

    #[tokio::test]
    async fn child_weft_creates_weft_origin_edge() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Root Loom", "loom", None, None).await;
        insert_response(
            &database,
            "loom-1",
            "response-origin",
            "assistant",
            "Source answer",
            0,
        )
        .await;
        insert_loom(
            &database,
            "weft-1",
            "Weft Loom",
            "weft",
            Some("loom-1"),
            Some("response-origin"),
        )
        .await;
        insert_response(
            &database,
            "weft-1",
            "weft-response-1",
            "assistant",
            "Weft answer one",
            0,
        )
        .await;
        insert_response(
            &database,
            "weft-1",
            "weft-response-2",
            "assistant",
            "Weft answer two",
            1,
        )
        .await;

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");

        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "loom:weft-1" && node.kind == "weft"));
        let origin = graph
            .nodes
            .iter()
            .find(|node| node.id == "response:response-origin")
            .expect("origin response");
        let weft = graph
            .nodes
            .iter()
            .find(|node| node.id == "loom:weft-1")
            .expect("weft node");
        assert!(
            weft.position.as_ref().expect("weft position").y
                - origin.position.as_ref().expect("origin position").y
                >= GRAPH_ROW_GAP
        );
        let edge = graph
            .edges
            .iter()
            .find(|edge| edge.kind == "weft_origin")
            .expect("weft origin edge");
        assert_eq!(edge.source, "response:response-origin");
        assert_eq!(edge.target, "loom:weft-1");
        let first_weft_response = graph
            .nodes
            .iter()
            .find(|node| node.id == "response:weft-response-1")
            .expect("first Weft response node");
        let second_weft_response = graph
            .nodes
            .iter()
            .find(|node| node.id == "response:weft-response-2")
            .expect("second Weft response node");
        assert_eq!(first_weft_response.lane, weft.lane);
        assert_eq!(second_weft_response.lane, weft.lane);
        assert!(
            first_weft_response
                .position
                .as_ref()
                .expect("first Weft response position")
                .y
                > weft.position.as_ref().expect("weft position").y
        );
        assert!(graph.edges.iter().any(|edge| {
            edge.kind == "loom_response"
                && edge.source == "loom:weft-1"
                && edge.target == "response:weft-response-1"
        }));
        assert!(graph.edges.iter().any(|edge| {
            edge.kind == "response_sequence"
                && edge.source == "response:weft-response-1"
                && edge.target == "response:weft-response-2"
        }));
    }

    #[tokio::test]
    async fn descendant_weft_branch_attaches_to_exact_weft_response() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Root Loom", "loom", None, None).await;
        insert_response(
            &database,
            "loom-1",
            "root-response",
            "assistant",
            "Root answer",
            0,
        )
        .await;
        insert_loom(
            &database,
            "weft-a",
            "Weft A",
            "weft",
            Some("loom-1"),
            Some("root-response"),
        )
        .await;
        insert_response(
            &database,
            "weft-a",
            "weft-a-response",
            "assistant",
            "Weft A answer",
            0,
        )
        .await;
        insert_response(
            &database,
            "weft-a",
            "weft-a-unrelated-response",
            "assistant",
            "Unrelated Weft A answer",
            1,
        )
        .await;
        insert_loom(
            &database,
            "weft-b",
            "Weft B",
            "weft",
            Some("weft-a"),
            Some("weft-a-response"),
        )
        .await;
        insert_response(
            &database,
            "weft-b",
            "weft-b-response",
            "assistant",
            "Weft B answer",
            0,
        )
        .await;

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");

        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "loom:weft-b" && node.kind == "weft"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "response:weft-b-response" && node.kind == "response"));
        assert!(graph.edges.iter().any(|edge| {
            edge.kind == "weft_origin"
                && edge.source == "response:weft-a-response"
                && edge.target == "loom:weft-b"
        }));
        assert!(!graph.edges.iter().any(|edge| {
            edge.kind == "weft_origin"
                && edge.source == "response:weft-a-unrelated-response"
                && edge.target == "loom:weft-b"
        }));
    }

    #[tokio::test]
    async fn revision_weft_keeps_revision_metadata_in_graph_node() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Root Loom", "loom", None, None).await;
        insert_response(
            &database,
            "loom-1",
            "response-origin",
            "assistant",
            "Source answer",
            0,
        )
        .await;
        insert_loom_with_metadata(
            &database,
            "revision-1",
            "Revision Loom",
            "weft",
            Some("loom-1"),
            Some("response-origin"),
            Some(r#"{"weftKind":"revision"}"#),
        )
        .await;

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");
        let revision = graph
            .nodes
            .iter()
            .find(|node| node.id == "loom:revision-1")
            .expect("revision node");

        assert_eq!(revision.kind, "weft");
        assert_eq!(
            revision
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("weftKind"))
                .and_then(|value| value.as_str()),
            Some("revision")
        );
    }

    #[tokio::test]
    async fn active_weft_graph_includes_immediate_origin_context_only() {
        let database = test_database().await;
        insert_loom(&database, "origin-loom", "Origin Loom", "loom", None, None).await;
        insert_response(
            &database,
            "origin-loom",
            "origin-response",
            "assistant",
            "Exact source answer",
            0,
        )
        .await;
        insert_response(
            &database,
            "origin-loom",
            "unrelated-origin-response",
            "assistant",
            "Do not include this answer",
            1,
        )
        .await;
        insert_loom(
            &database,
            "weft-1",
            "Current Weft",
            "weft",
            Some("origin-loom"),
            Some("origin-response"),
        )
        .await;
        insert_response(
            &database,
            "weft-1",
            "weft-response",
            "assistant",
            "Current Weft answer",
            0,
        )
        .await;

        let graph = build_graph_projection(&database, "weft-1", GraphQuery::default())
            .await
            .expect("graph projection");

        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "loom:origin-loom" && node.kind == "loom"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "response:origin-response" && node.kind == "response"));
        assert!(!graph
            .nodes
            .iter()
            .any(|node| node.id == "response:unrelated-origin-response"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "loom:weft-1" && node.kind == "weft"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "response:weft-response" && node.kind == "response"));

        assert_eq!(
            graph_role(&graph, "loom:origin-loom").as_deref(),
            Some("origin-context")
        );
        assert_eq!(
            graph_role(&graph, "response:origin-response").as_deref(),
            Some("origin-response")
        );
        assert_eq!(
            graph_role(&graph, "loom:weft-1").as_deref(),
            Some("current-root")
        );
        assert_eq!(
            graph_role(&graph, "response:weft-response").as_deref(),
            Some("child-response")
        );

        assert!(graph.edges.iter().any(|edge| {
            edge.kind == "loom_response_origin"
                && edge.source == "loom:origin-loom"
                && edge.target == "response:origin-response"
        }));
        assert!(graph.edges.iter().any(|edge| {
            edge.kind == "weft_origin"
                && edge.source == "response:origin-response"
                && edge.target == "loom:weft-1"
        }));
        assert!(graph.edges.iter().any(|edge| {
            edge.kind == "loom_response"
                && edge.source == "loom:weft-1"
                && edge.target == "response:weft-response"
        }));
    }

    #[tokio::test]
    async fn unknown_loom_returns_not_found() {
        let database = test_database().await;
        let error = build_graph_projection(&database, "missing", GraphQuery::default())
            .await
            .expect_err("missing Loom should fail");

        assert!(matches!(error, GraphProjectionError::NotFound));
    }

    #[tokio::test]
    async fn graph_projection_does_not_include_raw_thinking_metadata() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Privacy Loom", "loom", None, None).await;
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, code, canonical_uri,
                created_at, updated_at, sequence_index, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind("response-1")
        .bind("loom-1")
        .bind("assistant")
        .bind("Final answer")
        .bind("Safe title")
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind("2026-05-10T00:00:00Z")
        .bind("2026-05-10T00:00:00Z")
        .bind(0_i64)
        .bind("{\"raw_thinking\":\"do not expose\"}")
        .execute(database.pool())
        .await
        .expect("insert raw metadata fixture");

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");
        let serialized = serde_json::to_string(&graph).expect("serialize graph");

        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("thinking_text"));
        assert!(!serialized.contains("chain_of_thought"));
        assert!(!serialized.contains("hidden_reasoning"));
        assert!(!serialized.contains("do not expose"));
    }

    #[tokio::test]
    async fn focused_response_id_sets_focused_node_id() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Focus Loom", "loom", None, None).await;
        insert_response(
            &database,
            "loom-1",
            "response-1",
            "assistant",
            "Focus me",
            0,
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                focused_response_id: Some("response-1".to_string()),
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        assert_eq!(
            graph.focused_node_id.as_deref(),
            Some("response:response-1")
        );
    }

    #[tokio::test]
    async fn include_references_false_keeps_reference_edges_out() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Reference Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "First", 0).await;
        insert_response(&database, "loom-1", "response-2", "assistant", "Second", 1).await;
        insert_reference(
            &database,
            "reference-1",
            Some("loom-1"),
            Some("response-1"),
            "response",
            Some("response-2"),
            None,
            None,
            Some("Related"),
            "{}",
        )
        .await;

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");

        assert!(graph.edges.iter().all(|edge| edge.kind != "reference"));
        assert!(graph
            .warnings
            .iter()
            .all(|warning| !warning.contains("reference")));
    }

    #[tokio::test]
    async fn include_references_adds_response_to_response_edge() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Reference Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "First", 0).await;
        insert_response(&database, "loom-1", "response-2", "assistant", "Second", 1).await;
        insert_reference(
            &database,
            "reference-1",
            Some("loom-1"),
            Some("response-1"),
            "response",
            Some("response-2"),
            None,
            None,
            Some("Related"),
            "{}",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_references: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        let edge = graph
            .edges
            .iter()
            .find(|edge| edge.kind == "reference")
            .expect("reference edge");
        assert_eq!(edge.source, "response:response-1");
        assert_eq!(edge.target, "response:response-2");
        assert_eq!(edge.label.as_deref(), Some("Related"));
    }

    #[tokio::test]
    async fn unresolved_reference_target_is_skipped_with_warning() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Reference Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "First", 0).await;
        insert_reference(
            &database,
            "reference-1",
            Some("loom-1"),
            Some("response-1"),
            "response",
            Some("missing-response"),
            None,
            None,
            None,
            "{}",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_references: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        assert!(graph.edges.iter().all(|edge| edge.kind != "reference"));
        assert!(graph
            .warnings
            .iter()
            .any(|warning| warning.contains("reference_target_unresolved:reference-1")));
    }

    #[tokio::test]
    async fn fragment_reference_maps_to_parent_response_with_selected_text() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Fragment Loom", "loom", None, None).await;
        insert_response(
            &database,
            "loom-1",
            "response-1",
            "assistant",
            "Santorini",
            0,
        )
        .await;
        insert_reference(
            &database,
            "reference-fragment",
            Some("loom-1"),
            Some("response-1"),
            "fragment",
            Some("response-1"),
            None,
            Some("Santorini"),
            Some("Selected fragment"),
            "{}",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_references: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        let edge = graph
            .edges
            .iter()
            .find(|edge| edge.kind == "reference")
            .expect("fragment reference edge");
        assert_eq!(edge.source, "response:response-1");
        assert_eq!(edge.target, "response:response-1");
        assert_eq!(
            edge.metadata
                .as_ref()
                .and_then(|metadata| metadata.get("selectedTextPreview"))
                .and_then(|value| value.as_str()),
            Some("Santorini")
        );
    }

    #[tokio::test]
    async fn external_reference_target_is_skipped() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Reference Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "First", 0).await;
        insert_reference(
            &database,
            "reference-external",
            Some("loom-1"),
            Some("response-1"),
            "url",
            None,
            Some("https://example.test/source"),
            None,
            None,
            "{}",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_references: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        assert!(graph.edges.iter().all(|edge| edge.kind != "reference"));
        assert!(graph.warnings.iter().any(|warning| {
            warning.contains("reference_external_target_skipped:reference-external")
        }));
    }

    #[tokio::test]
    async fn reference_edge_cap_produces_warning() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Capped Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "First", 0).await;
        insert_response(&database, "loom-1", "response-2", "assistant", "Second", 1).await;
        for index in 0..51 {
            insert_reference(
                &database,
                &format!("reference-{index}"),
                Some("loom-1"),
                Some("response-1"),
                "response",
                Some("response-2"),
                None,
                None,
                None,
                "{}",
            )
            .await;
        }

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_references: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        assert_eq!(
            graph
                .edges
                .iter()
                .filter(|edge| edge.kind == "reference")
                .count(),
            50
        );
        assert!(graph
            .warnings
            .iter()
            .any(|warning| warning == "reference_edges_capped"));
    }

    #[tokio::test]
    async fn raw_thinking_reference_metadata_is_sanitized() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Privacy Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "First", 0).await;
        insert_response(&database, "loom-1", "response-2", "assistant", "Second", 1).await;
        sqlx::query(
            "INSERT INTO \"references\" (
                reference_id, source_loom_id, source_response_id, target_kind,
                target_id, target_uri, selected_text, label, metadata_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind("reference-raw")
        .bind("loom-1")
        .bind("response-1")
        .bind("response")
        .bind("response-2")
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind("Safe label")
        .bind("{\"raw_thinking\":\"hidden\"}")
        .bind("2026-05-10T00:00:01Z")
        .execute(database.pool())
        .await
        .expect("insert raw reference metadata fixture");

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_references: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");
        let serialized = serde_json::to_string(&graph).expect("serialize graph");

        assert!(graph
            .warnings
            .iter()
            .any(|warning| warning.contains("reference_metadata_sanitized:reference-raw")));
        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("hidden"));
    }

    #[tokio::test]
    async fn sequence_and_weft_edges_remain_with_references() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Root Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "Source", 0).await;
        insert_response(&database, "loom-1", "response-2", "assistant", "Target", 1).await;
        insert_loom(
            &database,
            "weft-1",
            "Weft Loom",
            "weft",
            Some("loom-1"),
            Some("response-1"),
        )
        .await;
        insert_reference(
            &database,
            "reference-1",
            Some("loom-1"),
            Some("response-1"),
            "response",
            Some("response-2"),
            None,
            None,
            None,
            "{}",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_references: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        assert!(graph.edges.iter().any(|edge| edge.kind == "loom_response"));
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.kind == "response_sequence"));
        assert!(graph.edges.iter().any(|edge| edge.kind == "weft_origin"));
        assert!(graph.edges.iter().any(|edge| edge.kind == "reference"));
    }

    #[tokio::test]
    async fn include_bookmarks_false_keeps_bookmark_metadata_out() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Bookmark Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "Saved", 0).await;
        insert_bookmark(
            &database,
            "bookmark-1",
            "response",
            Some("response-1"),
            None,
            "Saved Response",
            "{}",
            "2026-05-10T00:00:01Z",
        )
        .await;

        let graph = build_graph_projection(&database, "loom-1", GraphQuery::default())
            .await
            .expect("graph projection");
        let response = graph
            .nodes
            .iter()
            .find(|node| node.id == "response:response-1")
            .expect("response node");

        assert!(response
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("bookmark"))
            .is_none());
        assert!(graph
            .warnings
            .iter()
            .all(|warning| !warning.contains("bookmark")));
    }

    #[tokio::test]
    async fn include_bookmarks_marks_bookmarked_response_node() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Bookmark Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "Saved", 0).await;
        insert_bookmark(
            &database,
            "bookmark-1",
            "response",
            Some("response-1"),
            None,
            "Saved Response",
            "{}",
            "2026-05-10T00:00:01Z",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_bookmarks: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");
        let bookmark = node_bookmark(&graph, "response:response-1");

        assert_eq!(
            bookmark.get("bookmarkId").and_then(|value| value.as_str()),
            Some("bookmark-1")
        );
        assert_eq!(
            bookmark.get("bookmarked").and_then(|value| value.as_bool()),
            Some(true)
        );
    }

    #[tokio::test]
    async fn include_bookmarks_marks_bookmarked_loom_node() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Bookmark Loom", "loom", None, None).await;
        insert_bookmark(
            &database,
            "bookmark-loom",
            "loom",
            Some("loom-1"),
            None,
            "Saved Loom",
            "{}",
            "2026-05-10T00:00:01Z",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_bookmarks: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");
        let bookmark = node_bookmark(&graph, "loom:loom-1");

        assert_eq!(
            bookmark.get("bookmarkId").and_then(|value| value.as_str()),
            Some("bookmark-loom")
        );
    }

    #[tokio::test]
    async fn include_bookmarks_marks_node_by_target_uri() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Bookmark Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "Saved", 0).await;
        insert_bookmark(
            &database,
            "bookmark-uri",
            "uri",
            None,
            Some("loom://loom-1/responses/response-1"),
            "Saved URI",
            "{}",
            "2026-05-10T00:00:01Z",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_bookmarks: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");
        let bookmark = node_bookmark(&graph, "response:response-1");

        assert_eq!(
            bookmark.get("bookmarkId").and_then(|value| value.as_str()),
            Some("bookmark-uri")
        );
    }

    #[tokio::test]
    async fn unresolved_bookmark_target_is_skipped_with_warning() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Bookmark Loom", "loom", None, None).await;
        insert_bookmark(
            &database,
            "bookmark-missing",
            "response",
            Some("missing-response"),
            None,
            "Missing",
            "{}",
            "2026-05-10T00:00:01Z",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_bookmarks: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        assert!(graph
            .warnings
            .iter()
            .any(|warning| warning.contains("bookmark_target_unresolved:bookmark-missing")));
    }

    #[tokio::test]
    async fn duplicate_bookmark_targets_keep_latest_with_warning() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Bookmark Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "Saved", 0).await;
        insert_bookmark(
            &database,
            "bookmark-old",
            "response",
            Some("response-1"),
            None,
            "Older",
            "{}",
            "2026-05-10T00:00:01Z",
        )
        .await;
        insert_bookmark(
            &database,
            "bookmark-new",
            "response",
            Some("response-1"),
            None,
            "Newer",
            "{}",
            "2026-05-10T00:00:02Z",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_bookmarks: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");
        let bookmark = node_bookmark(&graph, "response:response-1");

        assert_eq!(
            bookmark.get("bookmarkId").and_then(|value| value.as_str()),
            Some("bookmark-new")
        );
        assert!(graph
            .warnings
            .iter()
            .any(|warning| warning.contains("bookmark_duplicate_targets:response:response-1")));
    }

    #[tokio::test]
    async fn raw_thinking_bookmark_metadata_is_sanitized() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Privacy Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "Saved", 0).await;
        sqlx::query(
            "INSERT INTO bookmarks (
                bookmark_id, target_kind, target_id, target_uri, title, metadata_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind("bookmark-raw")
        .bind("response")
        .bind("response-1")
        .bind(Option::<String>::None)
        .bind("Safe bookmark")
        .bind("{\"raw_thinking\":\"hidden\"}")
        .bind("2026-05-10T00:00:01Z")
        .execute(database.pool())
        .await
        .expect("insert raw bookmark metadata fixture");

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_bookmarks: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");
        let serialized = serde_json::to_string(&graph).expect("serialize graph");

        assert!(graph
            .warnings
            .iter()
            .any(|warning| warning.contains("bookmark_metadata_sanitized:bookmark-raw")));
        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("hidden"));
    }

    #[tokio::test]
    async fn references_and_bookmarks_can_be_requested_together() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "Root Loom", "loom", None, None).await;
        insert_response(&database, "loom-1", "response-1", "assistant", "Source", 0).await;
        insert_response(&database, "loom-1", "response-2", "assistant", "Target", 1).await;
        insert_loom(
            &database,
            "weft-1",
            "Weft Loom",
            "weft",
            Some("loom-1"),
            Some("response-1"),
        )
        .await;
        insert_reference(
            &database,
            "reference-1",
            Some("loom-1"),
            Some("response-1"),
            "response",
            Some("response-2"),
            None,
            None,
            None,
            "{}",
        )
        .await;
        insert_bookmark(
            &database,
            "bookmark-1",
            "response",
            Some("response-2"),
            None,
            "Saved Target",
            "{}",
            "2026-05-10T00:00:01Z",
        )
        .await;

        let graph = build_graph_projection(
            &database,
            "loom-1",
            GraphQuery {
                include_references: true,
                include_bookmarks: true,
                ..GraphQuery::default()
            },
        )
        .await
        .expect("graph projection");

        assert!(graph.edges.iter().any(|edge| edge.kind == "loom_response"));
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.kind == "response_sequence"));
        assert!(graph.edges.iter().any(|edge| edge.kind == "weft_origin"));
        assert!(graph.edges.iter().any(|edge| edge.kind == "reference"));
        assert_eq!(
            node_bookmark(&graph, "response:response-2")
                .get("bookmarkId")
                .and_then(|value| value.as_str()),
            Some("bookmark-1")
        );
    }

    async fn insert_loom(
        database: &crate::storage::db::Database,
        loom_id: &str,
        title: &str,
        kind: &str,
        origin_loom_id: Option<&str>,
        origin_response_id: Option<&str>,
    ) {
        insert_loom_with_metadata(
            database,
            loom_id,
            title,
            kind,
            origin_loom_id,
            origin_response_id,
            None,
        )
        .await;
    }

    async fn insert_loom_with_metadata(
        database: &crate::storage::db::Database,
        loom_id: &str,
        title: &str,
        kind: &str,
        origin_loom_id: Option<&str>,
        origin_response_id: Option<&str>,
        metadata_json: Option<&str>,
    ) {
        LoomRepository::new(database)
            .insert_loom(&NewLoom {
                loom_id: loom_id.to_string(),
                title: title.to_string(),
                summary: Some(format!("{title} summary")),
                code: Some(format!("L-{}", loom_id.to_uppercase())),
                canonical_uri: Some(format!("loom://{loom_id}")),
                kind: kind.to_string(),
                origin_loom_id: origin_loom_id.map(str::to_string),
                origin_response_id: origin_response_id.map(str::to_string),
                created_at: "2026-05-10T00:00:00Z".to_string(),
                updated_at: "2026-05-10T00:00:00Z".to_string(),
                metadata_json: metadata_json.map(str::to_string),
            })
            .await
            .expect("insert Loom");
    }

    async fn insert_response(
        database: &crate::storage::db::Database,
        loom_id: &str,
        response_id: &str,
        role: &str,
        content: &str,
        sequence_index: i64,
    ) {
        insert_response_with_metadata(
            database,
            loom_id,
            response_id,
            role,
            content,
            sequence_index,
            "{}",
        )
        .await;
    }

    async fn insert_response_with_metadata(
        database: &crate::storage::db::Database,
        loom_id: &str,
        response_id: &str,
        role: &str,
        content: &str,
        sequence_index: i64,
        metadata_json: &str,
    ) {
        ResponseRepository::new(database)
            .insert_response(&NewResponse {
                response_id: response_id.to_string(),
                loom_id: loom_id.to_string(),
                role: role.to_string(),
                content: content.to_string(),
                title: None,
                code: Some(format!("R-{}", response_id.to_uppercase())),
                canonical_uri: Some(format!("loom://{loom_id}/responses/{response_id}")),
                created_at: "2026-05-10T00:00:00Z".to_string(),
                updated_at: "2026-05-10T00:00:00Z".to_string(),
                sequence_index,
                metadata_json: Some(metadata_json.to_string()),
            })
            .await
            .expect("insert Response");
    }

    async fn insert_reference(
        database: &crate::storage::db::Database,
        reference_id: &str,
        source_loom_id: Option<&str>,
        source_response_id: Option<&str>,
        target_kind: &str,
        target_id: Option<&str>,
        target_uri: Option<&str>,
        selected_text: Option<&str>,
        label: Option<&str>,
        metadata_json: &str,
    ) {
        ReferenceRepository::new(database)
            .insert_reference(&NewReference {
                reference_id: reference_id.to_string(),
                source_loom_id: source_loom_id.map(str::to_string),
                source_response_id: source_response_id.map(str::to_string),
                target_kind: target_kind.to_string(),
                target_id: target_id.map(str::to_string),
                target_uri: target_uri.map(str::to_string),
                selected_text: selected_text.map(str::to_string),
                label: label.map(str::to_string),
                metadata_json: Some(metadata_json.to_string()),
                created_at: format!("2026-05-10T00:00:{reference_id}Z"),
            })
            .await
            .expect("insert Reference");
    }

    async fn insert_bookmark(
        database: &crate::storage::db::Database,
        bookmark_id: &str,
        target_kind: &str,
        target_id: Option<&str>,
        target_uri: Option<&str>,
        title: &str,
        metadata_json: &str,
        created_at: &str,
    ) {
        BookmarkRepository::new(database)
            .insert_bookmark(&NewBookmark {
                bookmark_id: bookmark_id.to_string(),
                target_kind: target_kind.to_string(),
                target_id: target_id.map(str::to_string),
                target_uri: target_uri.map(str::to_string),
                title: title.to_string(),
                metadata_json: Some(metadata_json.to_string()),
                created_at: created_at.to_string(),
            })
            .await
            .expect("insert Bookmark");
    }

    fn node_bookmark<'a>(
        graph: &'a super::GraphProjectionResult,
        node_id: &str,
    ) -> &'a serde_json::Value {
        graph
            .nodes
            .iter()
            .find(|node| node.id == node_id)
            .expect("graph node")
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("bookmark"))
            .expect("bookmark metadata")
    }

    fn graph_role(graph: &super::GraphProjectionResult, node_id: &str) -> Option<String> {
        graph
            .nodes
            .iter()
            .find(|node| node.id == node_id)
            .and_then(|node| node.metadata.as_ref())
            .and_then(|metadata| metadata.get("graphRole"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
    }
}
