use crate::{
    error::ServiceError,
    storage::{
        db::Database,
        repositories::{
            addresses::{AddressRepository, NewAddress, NewAddressAlias},
            bookmarks::{BookmarkRepository, NewBookmark},
            looms::{LoomRepository, NewLoom},
            references::{NewReference, ReferenceRepository},
            responses::{NewResponse, ResponseRepository},
        },
    },
};
use serde::{Deserialize, Serialize};

const DEFAULT_FIXTURE_JSON: &str = include_str!("../../../../fixtures/loom/default.json");
const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SeedFixturesResult {
    pub fixture: String,
    pub inserted: SeedFixturesCounts,
    pub skipped: SeedFixturesCounts,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SeedFixturesCounts {
    pub looms: usize,
    pub responses: usize,
    pub addresses: usize,
    pub address_aliases: usize,
    pub references: usize,
    pub bookmarks: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SeedFixture {
    fixture: String,
    looms: Vec<SeedLoom>,
    responses: Vec<SeedResponse>,
    #[serde(default)]
    aliases: Vec<SeedAlias>,
    #[serde(default)]
    references: Vec<SeedReference>,
    #[serde(default)]
    bookmarks: Vec<SeedBookmark>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SeedLoom {
    loom_id: String,
    title: String,
    summary: Option<String>,
    code: Option<String>,
    canonical_uri: String,
    kind: String,
    origin_loom_id: Option<String>,
    origin_response_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SeedResponse {
    response_id: String,
    loom_id: String,
    role: String,
    content: String,
    title: Option<String>,
    code: Option<String>,
    canonical_uri: String,
    sequence_index: i64,
    metadata_json: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SeedAlias {
    alias_id: String,
    canonical_uri: String,
    alias_uri: String,
    status: String,
    created_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SeedReference {
    reference_id: String,
    source_loom_id: Option<String>,
    source_response_id: Option<String>,
    target_kind: String,
    target_id: Option<String>,
    target_uri: Option<String>,
    selected_text: Option<String>,
    label: Option<String>,
    metadata_json: Option<String>,
    created_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SeedBookmark {
    bookmark_id: String,
    target_kind: String,
    target_id: Option<String>,
    target_uri: Option<String>,
    title: String,
    metadata_json: Option<String>,
    created_at: String,
}

pub async fn seed_fixture(
    database: &Database,
    fixture: &str,
) -> Result<SeedFixturesResult, ServiceError> {
    if fixture != "default" {
        return Err(ServiceError::config(format!(
            "unsupported fixture {fixture}; expected default"
        )));
    }

    let fixture: SeedFixture = serde_json::from_str(DEFAULT_FIXTURE_JSON)
        .map_err(|error| ServiceError::config(format!("invalid seed fixture JSON: {error}")))?;
    reject_forbidden_fixture_payload(&fixture)?;

    let looms = LoomRepository::new(database);
    let responses = ResponseRepository::new(database);
    let addresses = AddressRepository::new(database);
    let references = ReferenceRepository::new(database);
    let bookmarks = BookmarkRepository::new(database);
    let mut result = SeedFixturesResult {
        fixture: fixture.fixture.clone(),
        inserted: SeedFixturesCounts::default(),
        skipped: SeedFixturesCounts::default(),
    };

    for loom in fixture.looms {
        let inserted = looms
            .insert_loom_if_missing(&NewLoom {
                loom_id: loom.loom_id.clone(),
                title: loom.title,
                summary: loom.summary,
                code: loom.code,
                canonical_uri: Some(loom.canonical_uri.clone()),
                kind: loom.kind.clone(),
                origin_loom_id: loom.origin_loom_id,
                origin_response_id: loom.origin_response_id,
                created_at: loom.created_at.clone(),
                updated_at: loom.updated_at,
                metadata_json: None,
            })
            .await?;
        count(
            inserted,
            &mut result.inserted.looms,
            &mut result.skipped.looms,
        );

        let inserted = addresses
            .insert_address_if_missing(&NewAddress {
                address_id: format!("seed-address-loom-{}", loom.loom_id),
                object_kind: if loom.kind == "weft" {
                    "weft".to_string()
                } else {
                    "loom".to_string()
                },
                object_id: loom.loom_id,
                canonical_uri: loom.canonical_uri,
                created_at: loom.created_at,
            })
            .await?;
        count(
            inserted,
            &mut result.inserted.addresses,
            &mut result.skipped.addresses,
        );
    }

    for response in fixture.responses {
        let inserted = responses
            .insert_response_if_missing(&NewResponse {
                response_id: response.response_id.clone(),
                loom_id: response.loom_id,
                role: response.role,
                content: response.content,
                title: response.title,
                code: response.code,
                canonical_uri: Some(response.canonical_uri.clone()),
                created_at: response.created_at.clone(),
                updated_at: response.updated_at,
                sequence_index: response.sequence_index,
                metadata_json: response.metadata_json,
            })
            .await?;
        count(
            inserted,
            &mut result.inserted.responses,
            &mut result.skipped.responses,
        );

        let inserted = addresses
            .insert_address_if_missing(&NewAddress {
                address_id: format!("seed-address-response-{}", response.response_id),
                object_kind: "response".to_string(),
                object_id: response.response_id,
                canonical_uri: response.canonical_uri,
                created_at: response.created_at,
            })
            .await?;
        count(
            inserted,
            &mut result.inserted.addresses,
            &mut result.skipped.addresses,
        );
    }

    for alias in fixture.aliases {
        let inserted = addresses
            .insert_alias_if_missing(&NewAddressAlias {
                alias_id: alias.alias_id,
                canonical_uri: alias.canonical_uri,
                alias_uri: alias.alias_uri,
                status: alias.status,
                created_at: alias.created_at,
            })
            .await?;
        count(
            inserted,
            &mut result.inserted.address_aliases,
            &mut result.skipped.address_aliases,
        );
    }

    for reference in fixture.references {
        let inserted = references
            .insert_reference_if_missing(&NewReference {
                reference_id: reference.reference_id,
                source_loom_id: reference.source_loom_id,
                source_response_id: reference.source_response_id,
                target_kind: reference.target_kind,
                target_id: reference.target_id,
                target_uri: reference.target_uri,
                selected_text: reference.selected_text,
                label: reference.label,
                metadata_json: reference.metadata_json,
                created_at: reference.created_at,
            })
            .await?;
        count(
            inserted,
            &mut result.inserted.references,
            &mut result.skipped.references,
        );
    }

    for bookmark in fixture.bookmarks {
        let inserted = bookmarks
            .insert_bookmark_if_missing(&NewBookmark {
                bookmark_id: bookmark.bookmark_id,
                target_kind: bookmark.target_kind,
                target_id: bookmark.target_id,
                target_uri: bookmark.target_uri,
                title: bookmark.title,
                metadata_json: bookmark.metadata_json,
                created_at: bookmark.created_at,
            })
            .await?;
        count(
            inserted,
            &mut result.inserted.bookmarks,
            &mut result.skipped.bookmarks,
        );
    }

    Ok(result)
}

fn count(inserted: bool, inserted_count: &mut usize, skipped_count: &mut usize) {
    if inserted {
        *inserted_count += 1;
    } else {
        *skipped_count += 1;
    }
}

fn reject_forbidden_fixture_payload(fixture: &SeedFixture) -> Result<(), ServiceError> {
    let payload = serde_json::to_string(fixture).map_err(|error| {
        ServiceError::config(format!("failed to inspect seed fixture JSON: {error}"))
    })?;
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if payload.contains(forbidden) {
            return Err(ServiceError::config(format!(
                "seed fixture contains forbidden key {forbidden}"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::seed_fixture;
    use crate::{
        api::{
            exports::{export_loom_impl, ExportFormat, ExportLoomRequest},
            graph::{build_graph_projection, GraphQuery},
            resolve::{resolve_address, ResolveAddressStatus},
        },
        storage::db::test_database,
    };

    #[tokio::test]
    async fn default_fixture_seeds_looms_responses_and_is_idempotent() {
        let database = test_database().await;
        let first = seed_fixture(&database, "default")
            .await
            .expect("seed default fixture");
        assert!(first.inserted.looms >= 1);
        assert!(first.inserted.responses >= 1);
        assert!(first.inserted.addresses >= first.inserted.looms + first.inserted.responses);

        let second = seed_fixture(&database, "default")
            .await
            .expect("seed default fixture again");
        assert_eq!(second.inserted.looms, 0);
        assert_eq!(second.inserted.responses, 0);
        assert_eq!(second.inserted.addresses, 0);
        assert!(second.skipped.looms >= first.inserted.looms);
        assert!(second.skipped.responses >= first.inserted.responses);
    }

    #[tokio::test]
    async fn seeded_addresses_resolve_for_loom_and_exact_response_scroll() {
        let database = test_database().await;
        seed_fixture(&database, "default")
            .await
            .expect("seed fixture");

        let loom = resolve_address(&database, "loom://product/graph-view-site-map")
            .await
            .expect("resolve loom");
        assert_eq!(loom.status, ResolveAddressStatus::Resolved);
        assert_eq!(loom.object_kind.as_deref(), Some("loom"));

        let response = resolve_address(
            &database,
            "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar",
        )
        .await
        .expect("resolve response alias");
        assert_eq!(response.status, ResolveAddressStatus::AliasResolved);
        assert_eq!(response.object_kind.as_deref(), Some("response"));
        let destination = response.destination.expect("response destination");
        assert_eq!(destination.loom_id, "c-architecture");
        assert_eq!(
            destination.scroll_target_response_id.as_deref(),
            Some("r-address-bar")
        );
        assert_eq!(destination.scroll_mode.as_deref(), Some("exact"));
    }

    #[tokio::test]
    async fn seeded_sidebar_loom_addresses_resolve() {
        let database = test_database().await;
        seed_fixture(&database, "default")
            .await
            .expect("seed fixture");

        for address in [
            "loom://loom-ai/navigation-architecture",
            "loom://research/synthesis-workflow",
            "loom://prompts/reuse-library",
            "loom://engineering/security-review",
            "loom://go-to-market/launch-narrative",
            "loom://product/onboarding-browser-flow",
            "loom://product/bookmark-interaction-polish",
            "loom://product/graph-view-site-map",
            "loom://product/graph-view-site-map/weft/spacing",
            "loom://product/graph-view-site-map/weft/continuation",
            "loom://product/graph-view-site-map/weft/continuation/errors",
            "loom://product/browser-shell-keyboard-navigation",
            "loom://research/semantic-memory-ranking",
            "loom://research/citation-provenance-review",
            "loom://writing/draft-workspace-comparisons",
            "loom://engineering/mcp-plugin-integration",
            "loom://engineering/mcp-plugin-integration/weft/tool-execution",
            "loom://engineering/private-address-resolution",
            "loom://go-to-market/v1-release-checklist",
            "loom://support/broken-reference-workflows",
        ] {
            let resolved = resolve_address(&database, address)
                .await
                .expect("resolve seeded sidebar Loom address");
            assert_eq!(
                resolved.status,
                ResolveAddressStatus::Resolved,
                "{address} should resolve through service seed fixture"
            );
            assert!(
                matches!(resolved.object_kind.as_deref(), Some("loom" | "weft")),
                "{address} should resolve to a Loom or Weft"
            );
            assert!(
                resolved.destination.is_some(),
                "{address} should return a navigation destination"
            );
        }
    }

    #[tokio::test]
    async fn seeded_graph_and_export_read_from_service_data() {
        let database = test_database().await;
        seed_fixture(&database, "default")
            .await
            .expect("seed fixture");

        let graph = build_graph_projection(
            &database,
            "c-graph-map",
            GraphQuery {
                include_references: true,
                include_bookmarks: true,
                focused_response_id: Some("r-graph-continuation".to_string()),
            },
        )
        .await
        .expect("graph projection");
        assert!(graph.nodes.iter().any(|node| node.id == "loom:c-graph-map"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.id == "response:r-graph-continuation"));
        assert!(graph.edges.iter().any(|edge| edge.kind == "weft_origin"));
        assert_eq!(
            graph.focused_node_id.as_deref(),
            Some("response:r-graph-continuation")
        );

        let integration_graph = build_graph_projection(
            &database,
            "c-integrations",
            GraphQuery {
                include_references: true,
                include_bookmarks: true,
                focused_response_id: None,
            },
        )
        .await
        .expect("integration graph projection");
        assert!(integration_graph
            .nodes
            .iter()
            .any(|node| node.id == "response:r-plugin-boundary"));
        assert!(integration_graph
            .nodes
            .iter()
            .any(|node| node.id == "response:r-mcp-execution-boundary"));
        assert!(integration_graph
            .nodes
            .iter()
            .any(|node| node.id == "loom:c-integrations-mcp-tools"));
        assert!(integration_graph
            .nodes
            .iter()
            .any(|node| node.id == "response:r-mcp-invocation-flow"));
        assert!(integration_graph
            .nodes
            .iter()
            .any(|node| node.id == "response:r-mcp-error-boundary"));
        assert!(integration_graph.edges.iter().any(|edge| {
            edge.kind == "weft_origin"
                && edge.source == "response:r-mcp-execution-boundary"
                && edge.target == "loom:c-integrations-mcp-tools"
        }));
        assert!(integration_graph.edges.iter().any(|edge| {
            edge.kind == "loom_response"
                && edge.source == "loom:c-integrations-mcp-tools"
                && edge.target == "response:r-mcp-invocation-flow"
        }));

        let export = export_loom_impl(
            &database,
            ExportLoomRequest {
                loom_id: "c-graph-map".to_string(),
                format: ExportFormat::Json,
                include_metadata: true,
                include_references: true,
                include_bookmarks: true,
                include_graph: true,
            },
        )
        .await
        .expect("export seeded loom");
        assert_eq!(export.mime_type, "application/json; charset=utf-8");
        assert!(!export.content_base64.is_empty());
    }
}
