use crate::{
    api::state::AppState,
    error::ServiceError,
    storage::repositories::{
        addresses::{AddressRecord, AddressRepository},
        looms::{LoomRecord, LoomRepository},
        responses::ResponseRepository,
    },
};
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveAddressRequest {
    pub address: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResolveAddressStatus {
    Resolved,
    AliasResolved,
    Missing,
    Deleted,
    Invalid,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveAddressResponse {
    pub status: ResolveAddressStatus,
    pub canonical_uri: Option<String>,
    pub object_kind: Option<String>,
    pub object_id: Option<String>,
    pub destination: Option<LoomNavigationDestination>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoomNavigationDestination {
    pub loom_id: String,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_loom_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_response_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_target_response_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_mode: Option<String>,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveApiError {
    pub code: String,
    pub message: String,
}

pub async fn resolve(
    State(state): State<AppState>,
    Json(input): Json<ResolveAddressRequest>,
) -> Result<Json<ResolveAddressResponse>, (StatusCode, Json<ResolveApiError>)> {
    resolve_address(&state.database, &input.address)
        .await
        .map(Json)
        .map_err(resolve_error)
}

pub(crate) async fn resolve_address(
    database: &crate::storage::db::Database,
    address: &str,
) -> Result<ResolveAddressResponse, ServiceError> {
    let address = address.trim();
    if !is_supported_loom_address(address) {
        return Ok(invalid_response("Address must use the loom:// scheme"));
    }

    let addresses = AddressRepository::new(database);
    if let Some(alias) = addresses.resolve_alias(address).await? {
        let Some(record) = addresses.resolve_address(&alias.canonical_uri).await? else {
            return Ok(ResolveAddressResponse {
                status: ResolveAddressStatus::Missing,
                canonical_uri: Some(alias.canonical_uri),
                object_kind: None,
                object_id: None,
                destination: None,
                error: Some("Address alias points to a missing canonical address".to_string()),
            });
        };

        return resolve_record(database, record, ResolveAddressStatus::AliasResolved).await;
    }

    let Some(record) = addresses.resolve_address(address).await? else {
        return Ok(ResolveAddressResponse {
            status: ResolveAddressStatus::Missing,
            canonical_uri: Some(address.to_string()),
            object_kind: None,
            object_id: None,
            destination: None,
            error: Some("No address record exists for this URI".to_string()),
        });
    };

    resolve_record(database, record, ResolveAddressStatus::Resolved).await
}

async fn resolve_record(
    database: &crate::storage::db::Database,
    record: AddressRecord,
    status: ResolveAddressStatus,
) -> Result<ResolveAddressResponse, ServiceError> {
    match record.object_kind.as_str() {
        "loom" | "weft" => resolve_loom_record(database, record, status).await,
        "response" => resolve_response_record(database, record, status).await,
        "bookmark" => resolve_bookmark_record(database, record, status).await,
        "fragment" => Ok(ResolveAddressResponse {
            status,
            canonical_uri: Some(record.canonical_uri),
            object_kind: Some("fragment".to_string()),
            object_id: Some(record.object_id),
            destination: None,
            error: None,
        }),
        _ => Ok(invalid_response("Address object kind is unsupported")),
    }
}

async fn resolve_loom_record(
    database: &crate::storage::db::Database,
    record: AddressRecord,
    status: ResolveAddressStatus,
) -> Result<ResolveAddressResponse, ServiceError> {
    let Some(loom) = LoomRepository::new(database)
        .get_loom(&record.object_id)
        .await?
    else {
        return Ok(missing_target_response(record));
    };

    if loom.archived_at.is_some() {
        return Ok(deleted_target_response(record));
    }

    let object_kind = if loom.kind == "weft" || record.object_kind == "weft" {
        "weft"
    } else {
        "loom"
    };

    Ok(ResolveAddressResponse {
        status,
        canonical_uri: Some(record.canonical_uri),
        object_kind: Some(object_kind.to_string()),
        object_id: Some(loom.loom_id.clone()),
        destination: Some(destination_for_loom(&loom)),
        error: None,
    })
}

async fn resolve_response_record(
    database: &crate::storage::db::Database,
    record: AddressRecord,
    status: ResolveAddressStatus,
) -> Result<ResolveAddressResponse, ServiceError> {
    let Some(response) = ResponseRepository::new(database)
        .get_response(&record.object_id)
        .await?
    else {
        return Ok(missing_target_response(record));
    };

    let loom = LoomRepository::new(database)
        .get_loom(&response.loom_id)
        .await?;
    if loom
        .as_ref()
        .and_then(|loom| loom.archived_at.as_ref())
        .is_some()
    {
        return Ok(deleted_target_response(record));
    }

    Ok(ResolveAddressResponse {
        status,
        canonical_uri: Some(record.canonical_uri),
        object_kind: Some("response".to_string()),
        object_id: Some(response.response_id.clone()),
        destination: Some(LoomNavigationDestination {
            loom_id: response.loom_id,
            mode: "full".to_string(),
            origin_loom_id: loom.as_ref().and_then(|loom| loom.origin_loom_id.clone()),
            origin_response_id: loom
                .as_ref()
                .and_then(|loom| loom.origin_response_id.clone()),
            scroll_target_response_id: Some(response.response_id),
            scroll_mode: Some("exact".to_string()),
            source: "addressBar".to_string(),
        }),
        error: None,
    })
}

async fn resolve_bookmark_record(
    database: &crate::storage::db::Database,
    record: AddressRecord,
    status: ResolveAddressStatus,
) -> Result<ResolveAddressResponse, ServiceError> {
    let exists: bool = sqlx::query("SELECT 1 AS exists_flag FROM bookmarks WHERE bookmark_id = ?1")
        .bind(&record.object_id)
        .fetch_optional(database.pool())
        .await
        .map_err(|error| ServiceError::storage(format!("failed to resolve Bookmark: {error}")))?
        .is_some();

    if !exists {
        return Ok(missing_target_response(record));
    }

    Ok(ResolveAddressResponse {
        status,
        canonical_uri: Some(record.canonical_uri),
        object_kind: Some("bookmark".to_string()),
        object_id: Some(record.object_id),
        destination: None,
        error: None,
    })
}

fn destination_for_loom(loom: &LoomRecord) -> LoomNavigationDestination {
    LoomNavigationDestination {
        loom_id: loom.loom_id.clone(),
        mode: "full".to_string(),
        origin_loom_id: loom.origin_loom_id.clone(),
        origin_response_id: loom.origin_response_id.clone(),
        scroll_target_response_id: None,
        scroll_mode: None,
        source: "addressBar".to_string(),
    }
}

fn is_supported_loom_address(address: &str) -> bool {
    let Some(rest) = address.strip_prefix("loom://") else {
        return false;
    };
    !rest.trim().is_empty()
}

fn invalid_response(message: &str) -> ResolveAddressResponse {
    ResolveAddressResponse {
        status: ResolveAddressStatus::Invalid,
        canonical_uri: None,
        object_kind: None,
        object_id: None,
        destination: None,
        error: Some(message.to_string()),
    }
}

fn missing_target_response(record: AddressRecord) -> ResolveAddressResponse {
    ResolveAddressResponse {
        status: ResolveAddressStatus::Missing,
        canonical_uri: Some(record.canonical_uri),
        object_kind: Some(record.object_kind),
        object_id: Some(record.object_id),
        destination: None,
        error: Some("Address target is missing".to_string()),
    }
}

fn deleted_target_response(record: AddressRecord) -> ResolveAddressResponse {
    ResolveAddressResponse {
        status: ResolveAddressStatus::Deleted,
        canonical_uri: Some(record.canonical_uri),
        object_kind: Some(record.object_kind),
        object_id: Some(record.object_id),
        destination: None,
        error: Some("Address target is deleted or archived".to_string()),
    }
}

fn resolve_error(error: ServiceError) -> (StatusCode, Json<ResolveApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ResolveApiError {
            code: "RESOLVE_FAILED".to_string(),
            message: error.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::{resolve_address, ResolveAddressStatus};
    use crate::storage::{
        db::test_database,
        repositories::{
            addresses::{AddressRepository, NewAddress, NewAddressAlias},
            looms::{LoomRepository, NewLoom},
            responses::{NewResponse, ResponseRepository},
        },
    };

    const NOW: &str = "2026-05-10T00:00:00Z";

    #[tokio::test]
    async fn canonical_loom_address_resolves() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "loom", None, None).await;
        insert_address(&database, "address-1", "loom", "loom-1", "loom://loom-1").await;

        let response = resolve_address(&database, "loom://loom-1")
            .await
            .expect("resolve");

        assert_eq!(response.status, ResolveAddressStatus::Resolved);
        assert_eq!(response.canonical_uri.as_deref(), Some("loom://loom-1"));
        assert_eq!(response.object_kind.as_deref(), Some("loom"));
        let destination = response.destination.expect("destination");
        assert_eq!(destination.loom_id, "loom-1");
        assert_eq!(destination.mode, "full");
        assert_eq!(destination.scroll_target_response_id, None);
    }

    #[tokio::test]
    async fn loom_destination_omits_null_optional_fields() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "loom", None, None).await;
        insert_address(&database, "address-1", "loom", "loom-1", "loom://loom-1").await;

        let response = resolve_address(&database, "loom://loom-1")
            .await
            .expect("resolve");
        let serialized = serde_json::to_value(&response).expect("serialize response");
        let destination = serialized
            .get("destination")
            .and_then(|value| value.as_object())
            .expect("serialized destination");

        assert!(!destination.contains_key("originLoomId"));
        assert!(!destination.contains_key("originResponseId"));
        assert!(!destination.contains_key("scrollTargetResponseId"));
        assert!(!destination.contains_key("scrollMode"));
        assert_eq!(
            destination.get("loomId").and_then(|value| value.as_str()),
            Some("loom-1")
        );
    }

    #[tokio::test]
    async fn canonical_response_address_resolves_to_parent_loom_and_exact_scroll() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "loom", None, None).await;
        insert_response(&database, "response-1", "loom-1", None).await;
        insert_address(
            &database,
            "address-1",
            "response",
            "response-1",
            "loom://response-1",
        )
        .await;

        let response = resolve_address(&database, "loom://response-1")
            .await
            .expect("resolve");

        assert_eq!(response.status, ResolveAddressStatus::Resolved);
        assert_eq!(response.object_kind.as_deref(), Some("response"));
        let destination = response.destination.expect("destination");
        assert_eq!(destination.loom_id, "loom-1");
        assert_eq!(
            destination.scroll_target_response_id.as_deref(),
            Some("response-1")
        );
        assert_eq!(destination.scroll_mode.as_deref(), Some("exact"));
    }

    #[tokio::test]
    async fn alias_address_resolves_to_canonical_address() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "loom", None, None).await;
        insert_address(&database, "address-1", "loom", "loom-1", "loom://canonical").await;
        insert_alias(&database, "alias-1", "loom://canonical", "loom://old").await;

        let response = resolve_address(&database, "loom://old")
            .await
            .expect("resolve");

        assert_eq!(response.status, ResolveAddressStatus::AliasResolved);
        assert_eq!(response.canonical_uri.as_deref(), Some("loom://canonical"));
        assert_eq!(response.destination.expect("destination").loom_id, "loom-1");
    }

    #[tokio::test]
    async fn missing_target_returns_missing() {
        let database = test_database().await;
        insert_address(
            &database,
            "address-1",
            "loom",
            "missing-loom",
            "loom://missing",
        )
        .await;

        let response = resolve_address(&database, "loom://missing")
            .await
            .expect("resolve");

        assert_eq!(response.status, ResolveAddressStatus::Missing);
        assert_eq!(response.destination, None);
    }

    #[tokio::test]
    async fn archived_loom_returns_deleted() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "loom", None, None).await;
        insert_address(&database, "address-1", "loom", "loom-1", "loom://archived").await;
        sqlx::query("UPDATE looms SET archived_at = ?1 WHERE loom_id = ?2")
            .bind(NOW)
            .bind("loom-1")
            .execute(database.pool())
            .await
            .expect("archive Loom");

        let response = resolve_address(&database, "loom://archived")
            .await
            .expect("resolve");

        assert_eq!(response.status, ResolveAddressStatus::Deleted);
        assert_eq!(response.destination, None);
    }

    #[tokio::test]
    async fn weft_loom_address_returns_origin_metadata() {
        let database = test_database().await;
        insert_loom(
            &database,
            "weft-1",
            "weft",
            Some("origin-loom"),
            Some("origin-response"),
        )
        .await;
        insert_address(&database, "address-1", "loom", "weft-1", "loom://weft-1").await;

        let response = resolve_address(&database, "loom://weft-1")
            .await
            .expect("resolve");

        assert_eq!(response.status, ResolveAddressStatus::Resolved);
        assert_eq!(response.object_kind.as_deref(), Some("weft"));
        let destination = response.destination.expect("destination");
        assert_eq!(destination.origin_loom_id.as_deref(), Some("origin-loom"));
        assert_eq!(
            destination.origin_response_id.as_deref(),
            Some("origin-response")
        );
    }

    #[tokio::test]
    async fn invalid_address_returns_invalid() {
        let database = test_database().await;

        let response = resolve_address(&database, "https://loom-1")
            .await
            .expect("resolve");

        assert_eq!(response.status, ResolveAddressStatus::Invalid);
        assert_eq!(response.destination, None);
    }

    #[tokio::test]
    async fn response_metadata_raw_thinking_keys_are_not_returned() {
        let database = test_database().await;
        insert_loom(&database, "loom-1", "loom", None, None).await;
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, code, canonical_uri,
                created_at, updated_at, sequence_index, metadata_json
            ) VALUES (?1, ?2, 'assistant', 'safe content', NULL, NULL, NULL, ?3, ?3, 0, ?4)",
        )
        .bind("response-1")
        .bind("loom-1")
        .bind(NOW)
        .bind(r#"{"raw_thinking":"do not return","hidden_reasoning":"never"}"#)
        .execute(database.pool())
        .await
        .expect("insert response with forbidden metadata");
        insert_address(
            &database,
            "address-1",
            "response",
            "response-1",
            "loom://response-1",
        )
        .await;

        let response = resolve_address(&database, "loom://response-1")
            .await
            .expect("resolve");
        let serialized = serde_json::to_string(&response).expect("serialize");

        assert_eq!(response.status, ResolveAddressStatus::Resolved);
        assert!(!serialized.contains("raw_thinking"));
        assert!(!serialized.contains("hidden_reasoning"));
        assert!(!serialized.contains("thinking_text"));
        assert!(!serialized.contains("chain_of_thought"));
    }

    async fn insert_loom(
        database: &crate::storage::db::Database,
        loom_id: &str,
        kind: &str,
        origin_loom_id: Option<&str>,
        origin_response_id: Option<&str>,
    ) {
        LoomRepository::new(database)
            .insert_loom(&NewLoom {
                loom_id: loom_id.to_string(),
                title: format!("Test {loom_id}"),
                summary: None,
                code: None,
                canonical_uri: Some(format!("loom://{loom_id}")),
                kind: kind.to_string(),
                origin_loom_id: origin_loom_id.map(str::to_string),
                origin_response_id: origin_response_id.map(str::to_string),
                created_at: NOW.to_string(),
                updated_at: NOW.to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");
    }

    async fn insert_response(
        database: &crate::storage::db::Database,
        response_id: &str,
        loom_id: &str,
        metadata_json: Option<&str>,
    ) {
        ResponseRepository::new(database)
            .insert_response(&NewResponse {
                response_id: response_id.to_string(),
                loom_id: loom_id.to_string(),
                role: "assistant".to_string(),
                content: "safe content".to_string(),
                title: None,
                code: None,
                canonical_uri: Some(format!("loom://{response_id}")),
                created_at: NOW.to_string(),
                updated_at: NOW.to_string(),
                sequence_index: 0,
                metadata_json: metadata_json.map(str::to_string),
            })
            .await
            .expect("insert Response");
    }

    async fn insert_address(
        database: &crate::storage::db::Database,
        address_id: &str,
        object_kind: &str,
        object_id: &str,
        canonical_uri: &str,
    ) {
        AddressRepository::new(database)
            .insert_address(&NewAddress {
                address_id: address_id.to_string(),
                object_kind: object_kind.to_string(),
                object_id: object_id.to_string(),
                canonical_uri: canonical_uri.to_string(),
                created_at: NOW.to_string(),
            })
            .await
            .expect("insert Address");
    }

    async fn insert_alias(
        database: &crate::storage::db::Database,
        alias_id: &str,
        canonical_uri: &str,
        alias_uri: &str,
    ) {
        AddressRepository::new(database)
            .insert_alias(&NewAddressAlias {
                alias_id: alias_id.to_string(),
                canonical_uri: canonical_uri.to_string(),
                alias_uri: alias_uri.to_string(),
                status: "stale".to_string(),
                created_at: NOW.to_string(),
            })
            .await
            .expect("insert Address alias");
    }
}
