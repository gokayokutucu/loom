#![allow(dead_code)]

use crate::{error::ServiceError, storage::db::Database};
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddressRecord {
    pub address_id: String,
    pub object_kind: String,
    pub object_id: String,
    pub canonical_uri: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewAddress {
    pub address_id: String,
    pub object_kind: String,
    pub object_id: String,
    pub canonical_uri: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddressAliasRecord {
    pub alias_id: String,
    pub canonical_uri: String,
    pub alias_uri: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct NewAddressAlias {
    pub alias_id: String,
    pub canonical_uri: String,
    pub alias_uri: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct AddressRepository {
    pool: SqlitePool,
}

impl AddressRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn insert_address(&self, address: &NewAddress) -> Result<(), ServiceError> {
        sqlx::query(
            "INSERT INTO addresses (
                address_id, object_kind, object_id, canonical_uri, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&address.address_id)
        .bind(&address.object_kind)
        .bind(&address.object_id)
        .bind(&address.canonical_uri)
        .bind(&address.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to insert Address: {error}")))?;

        Ok(())
    }

    pub async fn insert_address_if_missing(
        &self,
        address: &NewAddress,
    ) -> Result<bool, ServiceError> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO addresses (
                address_id, object_kind, object_id, canonical_uri, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&address.address_id)
        .bind(&address.object_kind)
        .bind(&address.object_id)
        .bind(&address.canonical_uri)
        .bind(&address.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to seed Address: {error}")))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn resolve_address(
        &self,
        canonical_uri: &str,
    ) -> Result<Option<AddressRecord>, ServiceError> {
        sqlx::query("SELECT * FROM addresses WHERE canonical_uri = ?1")
            .bind(canonical_uri)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(address_from_row))
            .map_err(|error| ServiceError::storage(format!("failed to resolve Address: {error}")))
    }

    pub async fn insert_alias(&self, alias: &NewAddressAlias) -> Result<(), ServiceError> {
        sqlx::query(
            "INSERT INTO address_aliases (
                alias_id, canonical_uri, alias_uri, status, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&alias.alias_id)
        .bind(&alias.canonical_uri)
        .bind(&alias.alias_uri)
        .bind(&alias.status)
        .bind(&alias.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert Address alias: {error}"))
        })?;

        Ok(())
    }

    pub async fn insert_alias_if_missing(
        &self,
        alias: &NewAddressAlias,
    ) -> Result<bool, ServiceError> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO address_aliases (
                alias_id, canonical_uri, alias_uri, status, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&alias.alias_id)
        .bind(&alias.canonical_uri)
        .bind(&alias.alias_uri)
        .bind(&alias.status)
        .bind(&alias.created_at)
        .execute(&self.pool)
        .await
        .map_err(|error| ServiceError::storage(format!("failed to seed Address alias: {error}")))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn resolve_alias(
        &self,
        alias_uri: &str,
    ) -> Result<Option<AddressAliasRecord>, ServiceError> {
        sqlx::query("SELECT * FROM address_aliases WHERE alias_uri = ?1")
            .bind(alias_uri)
            .fetch_optional(&self.pool)
            .await
            .map(|row| row.map(address_alias_from_row))
            .map_err(|error| {
                ServiceError::storage(format!("failed to resolve Address alias: {error}"))
            })
    }
}

fn address_from_row(row: sqlx::sqlite::SqliteRow) -> AddressRecord {
    AddressRecord {
        address_id: row.get("address_id"),
        object_kind: row.get("object_kind"),
        object_id: row.get("object_id"),
        canonical_uri: row.get("canonical_uri"),
        created_at: row.get("created_at"),
    }
}

fn address_alias_from_row(row: sqlx::sqlite::SqliteRow) -> AddressAliasRecord {
    AddressAliasRecord {
        alias_id: row.get("alias_id"),
        canonical_uri: row.get("canonical_uri"),
        alias_uri: row.get("alias_uri"),
        status: row.get("status"),
        created_at: row.get("created_at"),
    }
}

#[cfg(test)]
mod tests {
    use super::{AddressRepository, NewAddress, NewAddressAlias};
    use crate::storage::db::test_database;

    #[tokio::test]
    async fn insert_and_resolve_canonical_address() {
        let database = test_database().await;
        let repository = AddressRepository::new(&database);

        repository
            .insert_address(&NewAddress {
                address_id: "address-1".to_string(),
                object_kind: "loom".to_string(),
                object_id: "loom-1".to_string(),
                canonical_uri: "loom://L-TEST".to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
            })
            .await
            .expect("insert address");

        let found = repository
            .resolve_address("loom://L-TEST")
            .await
            .expect("resolve address")
            .expect("address exists");
        assert_eq!(found.object_id, "loom-1");
    }

    #[tokio::test]
    async fn insert_and_resolve_alias() {
        let database = test_database().await;
        let repository = AddressRepository::new(&database);

        repository
            .insert_alias(&NewAddressAlias {
                alias_id: "alias-1".to_string(),
                canonical_uri: "loom://L-TEST".to_string(),
                alias_uri: "loom://old-title".to_string(),
                status: "stale".to_string(),
                created_at: "2026-05-08T00:00:00Z".to_string(),
            })
            .await
            .expect("insert alias");

        let found = repository
            .resolve_alias("loom://old-title")
            .await
            .expect("resolve alias")
            .expect("alias exists");
        assert_eq!(found.canonical_uri, "loom://L-TEST");
        assert_eq!(found.status, "stale");
    }
}
