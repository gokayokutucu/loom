#![allow(dead_code)]

use crate::{config::ServiceConfig, error::ServiceError, storage::migrations::run_migrations};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{path::Path, path::PathBuf, str::FromStr, time::Duration};

#[derive(Debug, Clone)]
pub struct Database {
    pool: SqlitePool,
}

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub display_path: String,
}

impl DatabaseConfig {
    pub fn from_service_config(config: &ServiceConfig) -> Result<Self, ServiceError> {
        Self::from_path(&config.db_path)
    }

    pub fn in_memory() -> Self {
        Self {
            url: "sqlite::memory:".to_string(),
            display_path: "sqlite::memory:".to_string(),
        }
    }

    pub fn from_path(path: &Path) -> Result<Self, ServiceError> {
        let path = normalize_path(path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                ServiceError::storage(format!(
                    "failed to create database directory {}: {error}",
                    parent.display()
                ))
            })?;
        }

        let path_text = path.to_string_lossy().to_string();
        Ok(Self {
            url: format!("sqlite://{path_text}?mode=rwc"),
            display_path: path_text,
        })
    }
}

impl Database {
    pub async fn connect(config: &DatabaseConfig) -> Result<Self, ServiceError> {
        let connect_options = SqliteConnectOptions::from_str(&config.url)
            .map_err(|error| {
                ServiceError::storage(format!("failed to configure SQLite database: {error}"))
            })?
            .busy_timeout(Duration::from_secs(5));

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(connect_options)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to connect SQLite database: {error}"))
            })?;

        Ok(Self { pool })
    }

    pub async fn connect_and_migrate(config: &DatabaseConfig) -> Result<Self, ServiceError> {
        let database = Self::connect(config).await?;
        database.run_migrations().await?;
        Ok(database)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn run_migrations(&self) -> Result<(), ServiceError> {
        run_migrations(&self.pool).await
    }

    pub async fn health_check(&self) -> bool {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map(|_| true)
            .unwrap_or(false)
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }

    std::env::current_dir()
        .map(|cwd| cwd.join(path))
        .unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
pub async fn test_database() -> Database {
    let config = DatabaseConfig::in_memory();
    Database::connect_and_migrate(&config)
        .await
        .expect("test database should migrate")
}
