#![allow(dead_code)]

use std::{
    collections::{BTreeSet, HashSet},
    time::Instant,
};

use crate::{error::ServiceError, storage::db::Database};
use sqlx::{Row, SqlitePool};

const MAX_WEFT_LINEAGE_DEPTH: u8 = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeResolutionRequest {
    pub active_loom_id: String,
    pub agent_run_id: String,
    pub explicit_reference_ids: Vec<String>,
    pub options: ScopeResolutionOptions,
}

impl ScopeResolutionRequest {
    pub fn new(active_loom_id: impl Into<String>, agent_run_id: impl Into<String>) -> Self {
        Self {
            active_loom_id: active_loom_id.into(),
            agent_run_id: agent_run_id.into(),
            explicit_reference_ids: Vec::new(),
            options: ScopeResolutionOptions::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeResolutionOptions {
    pub include_archived: bool,
    pub max_weft_lineage_depth: u8,
    pub cross_conversation_enabled: bool,
}

impl Default for ScopeResolutionOptions {
    fn default() -> Self {
        Self {
            include_archived: false,
            max_weft_lineage_depth: MAX_WEFT_LINEAGE_DEPTH,
            cross_conversation_enabled: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeContext {
    pub scopes: Vec<ScopeDescriptor>,
    pub active_loom_id: String,
    pub agent_run_id: String,
    pub weft_loom_detected: bool,
    pub scoped_retrieval_loom_ids: Vec<String>,
    pub cross_conversation_loom_ids: Vec<String>,
    pub archived_retrieval_loom_ids: Vec<String>,
    pub diagnostics: ScopeResolutionDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeDescriptor {
    pub scope_type: ScopeType,
    pub priority: u8,
    pub status: ScopeStatus,
    pub visibility: ScopeVisibility,
    pub hidden_background: bool,
    pub loom_ids: Vec<String>,
    pub memory_scope: Option<MemoryScopeInfo>,
    pub attachment_scope: Option<AttachmentScopeInfo>,
    pub lineage_depth: Option<u8>,
    pub origin_loom_id: Option<String>,
    pub origin_response_id: Option<String>,
    pub explicit_reference_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ScopeType {
    CurrentConversation,
    WeftOriginChain,
    ProjectGroup,
    ScopedMemory,
    GlobalMemory,
    ConversationAttachment,
    ProjectAttachment,
    ScopedRetrieval,
    CrossConversationRetrieval,
    ArchivedRetrieval,
    ToolMcpContext,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeStatus {
    Active,
    HiddenBackground,
    Empty,
    Reserved,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeVisibility {
    Visible,
    HiddenBackground,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MemoryScopeInfo {
    pub eligible_count: usize,
    pub explicit_user_memory_count: usize,
    pub inferred_confirmed_count: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AttachmentScopeInfo {
    pub eligible_attachment_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeResolutionDiagnostics {
    pub scopes: Vec<ScopeDiagnostic>,
    pub total_scopes: usize,
    pub active_scopes: usize,
    pub empty_scopes: usize,
    pub reserved_scopes: usize,
    pub current_conversation_present: bool,
    pub weft_detected: bool,
    pub lineage_depth: u8,
    pub cycle_detected: bool,
    pub attachment_scopes_count: usize,
    pub memory_scopes_count: usize,
    pub cross_conversation_scope_enabled: bool,
    pub archived_scope_enabled: bool,
    pub explicit_references_provided: usize,
    pub explicit_references_validated: usize,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeDiagnostic {
    pub scope_type: ScopeType,
    pub priority: u8,
    pub status: ScopeStatus,
    pub loom_count: usize,
    pub memory_count: usize,
    pub attachment_count: usize,
    pub lineage_depth: Option<u8>,
}

#[derive(Debug, Clone)]
pub struct ScopeResolutionService {
    pool: SqlitePool,
}

impl ScopeResolutionService {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn resolve(
        &self,
        request: ScopeResolutionRequest,
    ) -> Result<ScopeContext, ServiceError> {
        let started = Instant::now();
        let mut scopes = Vec::new();
        let options = normalize_options(request.options);
        let active_loom_id = request.active_loom_id.trim().to_string();
        let agent_run_id = request.agent_run_id;
        let explicit_reference_ids = normalize_ids(request.explicit_reference_ids);
        let explicit_references_provided = explicit_reference_ids.len();
        let explicit_references_validated = self
            .validated_reference_ids(&explicit_reference_ids)
            .await?
            .len();

        let Some(active_loom) = self.active_loom(&active_loom_id).await? else {
            scopes.push(descriptor(
                ScopeType::CurrentConversation,
                ScopeStatus::Unavailable,
                ScopeVisibility::Visible,
                Vec::new(),
            ));
            sort_scopes(&mut scopes);
            return Ok(context(
                scopes,
                active_loom_id,
                agent_run_id,
                false,
                Vec::new(),
                Vec::new(),
                Vec::new(),
                false,
                explicit_references_provided,
                explicit_references_validated,
                elapsed_ms(started),
                options,
            ));
        };

        let current_refs = self
            .validated_reference_ids(&explicit_reference_ids)
            .await?;
        let mut current = descriptor(
            ScopeType::CurrentConversation,
            ScopeStatus::Active,
            ScopeVisibility::Visible,
            vec![active_loom_id.clone()],
        );
        current.lineage_depth = Some(0);
        current.explicit_reference_ids = current_refs;
        scopes.push(current);

        let mut cycle_detected = false;
        let mut lineage_loom_ids = Vec::new();
        if active_loom.origin_loom_id.is_some() {
            let lineage = self
                .weft_lineage(&active_loom_id, options.max_weft_lineage_depth)
                .await?;
            cycle_detected = lineage.cycle_detected;
            for item in lineage.items {
                lineage_loom_ids.push(item.origin_loom_id.clone());
                let mut scope = descriptor(
                    ScopeType::WeftOriginChain,
                    ScopeStatus::HiddenBackground,
                    ScopeVisibility::HiddenBackground,
                    vec![item.origin_loom_id.clone()],
                );
                scope.hidden_background = true;
                scope.lineage_depth = Some(item.depth);
                scope.origin_loom_id = Some(item.origin_loom_id);
                scope.origin_response_id = item.origin_response_id;
                scopes.push(scope);
            }
        }

        scopes.push(descriptor(
            ScopeType::ProjectGroup,
            ScopeStatus::Reserved,
            ScopeVisibility::Visible,
            Vec::new(),
        ));

        let scoped_memory = self.memory_scope(Some(&active_loom_id)).await?;
        let mut scoped_memory_descriptor = descriptor(
            ScopeType::ScopedMemory,
            status_for_count(scoped_memory.eligible_count),
            ScopeVisibility::Visible,
            vec![active_loom_id.clone()],
        );
        scoped_memory_descriptor.memory_scope = Some(scoped_memory);
        scopes.push(scoped_memory_descriptor);

        let global_memory = self.memory_scope(None).await?;
        let mut global_memory_descriptor = descriptor(
            ScopeType::GlobalMemory,
            status_for_count(global_memory.eligible_count),
            ScopeVisibility::Visible,
            Vec::new(),
        );
        global_memory_descriptor.memory_scope = Some(global_memory);
        scopes.push(global_memory_descriptor);

        let attachment_count = self.ready_attachment_count(&active_loom_id).await?;
        let mut attachment_descriptor = descriptor(
            ScopeType::ConversationAttachment,
            status_for_count(attachment_count),
            ScopeVisibility::Visible,
            vec![active_loom_id.clone()],
        );
        attachment_descriptor.attachment_scope = Some(AttachmentScopeInfo {
            eligible_attachment_count: attachment_count,
        });
        scopes.push(attachment_descriptor);

        scopes.push(descriptor(
            ScopeType::ProjectAttachment,
            ScopeStatus::Reserved,
            ScopeVisibility::Visible,
            Vec::new(),
        ));

        scopes.push(descriptor(
            ScopeType::ScopedRetrieval,
            ScopeStatus::Active,
            ScopeVisibility::Visible,
            vec![active_loom_id.clone()],
        ));

        let cross_conversation_loom_ids = if options.cross_conversation_enabled {
            self.cross_conversation_loom_ids(&active_loom_id).await?
        } else {
            Vec::new()
        };
        scopes.push(descriptor(
            ScopeType::CrossConversationRetrieval,
            status_for_count(cross_conversation_loom_ids.len()),
            ScopeVisibility::Visible,
            cross_conversation_loom_ids.clone(),
        ));

        let archived_retrieval_loom_ids = if options.include_archived {
            self.archived_loom_ids().await?
        } else {
            Vec::new()
        };
        scopes.push(descriptor(
            ScopeType::ArchivedRetrieval,
            status_for_count(archived_retrieval_loom_ids.len()),
            ScopeVisibility::Visible,
            archived_retrieval_loom_ids.clone(),
        ));

        scopes.push(descriptor(
            ScopeType::ToolMcpContext,
            ScopeStatus::Reserved,
            ScopeVisibility::Visible,
            Vec::new(),
        ));

        sort_scopes(&mut scopes);
        Ok(context(
            scopes,
            active_loom_id.clone(),
            agent_run_id,
            active_loom.origin_loom_id.is_some(),
            vec![active_loom_id],
            cross_conversation_loom_ids,
            archived_retrieval_loom_ids,
            cycle_detected,
            explicit_references_provided,
            explicit_references_validated,
            elapsed_ms(started),
            options,
        ))
    }

    async fn active_loom(&self, loom_id: &str) -> Result<Option<ScopeLoom>, ServiceError> {
        sqlx::query(
            "SELECT loom_id, origin_loom_id, origin_response_id, is_deleted, archived_at
             FROM looms
             WHERE loom_id = ?1",
        )
        .bind(loom_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to resolve Scope active Loom: {error}"))
        })
        .map(|row| {
            row.and_then(|row| {
                let is_deleted = row.get::<i64, _>("is_deleted") != 0;
                if is_deleted {
                    return None;
                }
                Some(ScopeLoom {
                    loom_id: row.get("loom_id"),
                    origin_loom_id: row.get("origin_loom_id"),
                    origin_response_id: row.get("origin_response_id"),
                    archived_at: row.get("archived_at"),
                })
            })
        })
    }

    async fn weft_lineage(
        &self,
        active_loom_id: &str,
        max_depth: u8,
    ) -> Result<WeftLineage, ServiceError> {
        let mut items = Vec::new();
        let mut cycle_detected = false;
        let mut visited = HashSet::new();
        visited.insert(active_loom_id.to_string());
        let mut current_weft_id = active_loom_id.to_string();

        for depth in 1..=max_depth {
            let Some(origin) = self.weft_origin(&current_weft_id).await? else {
                break;
            };
            if !visited.insert(origin.origin_loom_id.clone()) {
                cycle_detected = true;
                break;
            }
            let Some(origin_loom) = self.active_loom(&origin.origin_loom_id).await? else {
                break;
            };
            items.push(WeftLineageItem {
                depth,
                origin_loom_id: origin.origin_loom_id.clone(),
                origin_response_id: origin.origin_response_id.clone(),
            });
            current_weft_id = origin_loom.loom_id;
            if origin_loom.origin_loom_id.is_none() {
                break;
            }
        }

        Ok(WeftLineage {
            items,
            cycle_detected,
        })
    }

    async fn weft_origin(&self, weft_loom_id: &str) -> Result<Option<WeftOrigin>, ServiceError> {
        sqlx::query(
            "SELECT origin_loom_id, origin_response_id
             FROM weft_origin_contexts
             WHERE weft_loom_id = ?1
             ORDER BY updated_at DESC, context_id ASC
             LIMIT 1",
        )
        .bind(weft_loom_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to resolve Weft origin scope: {error}"))
        })
        .map(|row| {
            row.map(|row| WeftOrigin {
                origin_loom_id: row.get("origin_loom_id"),
                origin_response_id: row.get("origin_response_id"),
            })
        })
    }

    async fn memory_scope(
        &self,
        source_loom_id: Option<&str>,
    ) -> Result<MemoryScopeInfo, ServiceError> {
        let rows = if let Some(source_loom_id) = source_loom_id {
            sqlx::query(
                "SELECT memory_type, COUNT(*) AS count
                 FROM memories
                 WHERE source_loom_id = ?1 AND user_confirmed = 1 AND deleted_at IS NULL
                 GROUP BY memory_type",
            )
            .bind(source_loom_id)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query(
                "SELECT memory_type, COUNT(*) AS count
                 FROM memories
                 WHERE source_loom_id IS NULL AND user_confirmed = 1 AND deleted_at IS NULL
                 GROUP BY memory_type",
            )
            .fetch_all(&self.pool)
            .await
        }
        .map_err(|error| {
            ServiceError::storage(format!("failed to count Scope memories: {error}"))
        })?;

        let mut info = MemoryScopeInfo::default();
        for row in rows {
            let memory_type: String = row.get("memory_type");
            let count = row.get::<i64, _>("count").max(0) as usize;
            info.eligible_count += count;
            match memory_type.as_str() {
                "explicit_user_memory" => info.explicit_user_memory_count += count,
                "inferred_preference" => info.inferred_confirmed_count += count,
                _ => {}
            }
        }
        Ok(info)
    }

    async fn ready_attachment_count(&self, loom_id: &str) -> Result<usize, ServiceError> {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)
             FROM attachments
             WHERE loom_id = ?1 AND parse_status = 'ready'",
        )
        .bind(loom_id)
        .fetch_one(&self.pool)
        .await
        .map(|count| count.max(0) as usize)
        .map_err(|error| {
            ServiceError::storage(format!("failed to count Scope attachments: {error}"))
        })
    }

    async fn cross_conversation_loom_ids(
        &self,
        active_loom_id: &str,
    ) -> Result<Vec<String>, ServiceError> {
        sqlx::query_scalar::<_, String>(
            "SELECT loom_id
             FROM looms
             WHERE is_deleted = 0 AND archived_at IS NULL AND loom_id != ?1
             ORDER BY updated_at DESC, loom_id ASC",
        )
        .bind(active_loom_id)
        .fetch_all(&self.pool)
        .await
        .map(normalize_ids)
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to resolve cross-conversation scope: {error}"
            ))
        })
    }

    async fn archived_loom_ids(&self) -> Result<Vec<String>, ServiceError> {
        sqlx::query_scalar::<_, String>(
            "SELECT loom_id
             FROM looms
             WHERE is_deleted = 0 AND archived_at IS NOT NULL
             ORDER BY archived_at DESC, loom_id ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map(normalize_ids)
        .map_err(|error| {
            ServiceError::storage(format!(
                "failed to resolve archived retrieval scope: {error}"
            ))
        })
    }

    async fn validated_reference_ids(
        &self,
        reference_ids: &[String],
    ) -> Result<Vec<String>, ServiceError> {
        let mut valid = Vec::new();
        for reference_id in reference_ids {
            let exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*)
                 FROM \"references\"
                 WHERE reference_id = ?1",
            )
            .bind(reference_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|error| {
                ServiceError::storage(format!("failed to validate Scope reference: {error}"))
            })?;
            if exists > 0 {
                valid.push(reference_id.clone());
            }
        }
        Ok(valid)
    }
}

#[derive(Debug, Clone)]
struct ScopeLoom {
    loom_id: String,
    origin_loom_id: Option<String>,
    origin_response_id: Option<String>,
    archived_at: Option<String>,
}

#[derive(Debug, Clone)]
struct WeftOrigin {
    origin_loom_id: String,
    origin_response_id: Option<String>,
}

#[derive(Debug, Clone)]
struct WeftLineage {
    items: Vec<WeftLineageItem>,
    cycle_detected: bool,
}

#[derive(Debug, Clone)]
struct WeftLineageItem {
    depth: u8,
    origin_loom_id: String,
    origin_response_id: Option<String>,
}

fn context(
    scopes: Vec<ScopeDescriptor>,
    active_loom_id: String,
    agent_run_id: String,
    weft_loom_detected: bool,
    scoped_retrieval_loom_ids: Vec<String>,
    cross_conversation_loom_ids: Vec<String>,
    archived_retrieval_loom_ids: Vec<String>,
    cycle_detected: bool,
    explicit_references_provided: usize,
    explicit_references_validated: usize,
    latency_ms: u64,
    options: ScopeResolutionOptions,
) -> ScopeContext {
    let diagnostics = diagnostics_for_scopes(
        &scopes,
        weft_loom_detected,
        cycle_detected,
        options.cross_conversation_enabled,
        options.include_archived,
        explicit_references_provided,
        explicit_references_validated,
        latency_ms,
    );
    ScopeContext {
        scopes,
        active_loom_id,
        agent_run_id,
        weft_loom_detected,
        scoped_retrieval_loom_ids,
        cross_conversation_loom_ids,
        archived_retrieval_loom_ids,
        diagnostics,
    }
}

fn descriptor(
    scope_type: ScopeType,
    status: ScopeStatus,
    visibility: ScopeVisibility,
    loom_ids: Vec<String>,
) -> ScopeDescriptor {
    ScopeDescriptor {
        scope_type,
        priority: priority(scope_type),
        status,
        visibility,
        hidden_background: matches!(visibility, ScopeVisibility::HiddenBackground),
        loom_ids: normalize_ids(loom_ids),
        memory_scope: None,
        attachment_scope: None,
        lineage_depth: None,
        origin_loom_id: None,
        origin_response_id: None,
        explicit_reference_ids: Vec::new(),
    }
}

fn diagnostics_for_scopes(
    scopes: &[ScopeDescriptor],
    weft_loom_detected: bool,
    cycle_detected: bool,
    cross_conversation_scope_enabled: bool,
    archived_scope_enabled: bool,
    explicit_references_provided: usize,
    explicit_references_validated: usize,
    latency_ms: u64,
) -> ScopeResolutionDiagnostics {
    let scope_diagnostics = scopes
        .iter()
        .map(|scope| ScopeDiagnostic {
            scope_type: scope.scope_type,
            priority: scope.priority,
            status: scope.status,
            loom_count: scope.loom_ids.len(),
            memory_count: scope
                .memory_scope
                .as_ref()
                .map(|memory| memory.eligible_count)
                .unwrap_or_default(),
            attachment_count: scope
                .attachment_scope
                .as_ref()
                .map(|attachment| attachment.eligible_attachment_count)
                .unwrap_or_default(),
            lineage_depth: scope.lineage_depth,
        })
        .collect::<Vec<_>>();
    ScopeResolutionDiagnostics {
        total_scopes: scopes.len(),
        active_scopes: scopes
            .iter()
            .filter(|scope| {
                matches!(
                    scope.status,
                    ScopeStatus::Active | ScopeStatus::HiddenBackground
                )
            })
            .count(),
        empty_scopes: scopes
            .iter()
            .filter(|scope| matches!(scope.status, ScopeStatus::Empty))
            .count(),
        reserved_scopes: scopes
            .iter()
            .filter(|scope| matches!(scope.status, ScopeStatus::Reserved))
            .count(),
        current_conversation_present: scopes.iter().any(|scope| {
            scope.scope_type == ScopeType::CurrentConversation
                && scope.status == ScopeStatus::Active
        }),
        weft_detected: weft_loom_detected,
        lineage_depth: scopes
            .iter()
            .filter(|scope| scope.scope_type == ScopeType::WeftOriginChain)
            .filter_map(|scope| scope.lineage_depth)
            .max()
            .unwrap_or_default(),
        cycle_detected,
        attachment_scopes_count: scopes
            .iter()
            .filter(|scope| scope.attachment_scope.is_some())
            .count(),
        memory_scopes_count: scopes
            .iter()
            .filter(|scope| scope.memory_scope.is_some())
            .count(),
        cross_conversation_scope_enabled,
        archived_scope_enabled,
        explicit_references_provided,
        explicit_references_validated,
        latency_ms,
        scopes: scope_diagnostics,
    }
}

fn priority(scope_type: ScopeType) -> u8 {
    match scope_type {
        ScopeType::CurrentConversation => 2,
        ScopeType::WeftOriginChain => 3,
        ScopeType::ProjectGroup => 4,
        ScopeType::ScopedMemory => 5,
        ScopeType::GlobalMemory => 5,
        ScopeType::ConversationAttachment => 6,
        ScopeType::ProjectAttachment => 7,
        ScopeType::ScopedRetrieval => 8,
        ScopeType::CrossConversationRetrieval => 9,
        ScopeType::ArchivedRetrieval => 10,
        ScopeType::ToolMcpContext => 11,
    }
}

fn status_for_count(count: usize) -> ScopeStatus {
    if count == 0 {
        ScopeStatus::Empty
    } else {
        ScopeStatus::Active
    }
}

fn sort_scopes(scopes: &mut [ScopeDescriptor]) {
    scopes.sort_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| left.scope_type.cmp(&right.scope_type))
            .then_with(|| left.lineage_depth.cmp(&right.lineage_depth))
    });
}

fn normalize_ids(ids: Vec<String>) -> Vec<String> {
    ids.into_iter()
        .filter(|id| !id.trim().is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn normalize_options(mut options: ScopeResolutionOptions) -> ScopeResolutionOptions {
    options.max_weft_lineage_depth = options
        .max_weft_lineage_depth
        .clamp(1, MAX_WEFT_LINEAGE_DEPTH);
    options
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::{
        ScopeResolutionRequest, ScopeResolutionService, ScopeStatus, ScopeType, ScopeVisibility,
    };
    use crate::{
        retrieval::{
            hybrid_service::{HybridRetrievalService, RetrievalQuery},
            lancedb_adapter::{EmbeddingGenerator, LanceDbRetrievalAdapter, LanceDbSearchRequest},
            tantivy_adapter::{TantivyRetrievalAdapter, TantivySearchRequest},
        },
        storage::db::{test_database, Database},
    };
    use std::sync::Arc;

    #[tokio::test]
    async fn current_conversation_scope_is_emitted() {
        let database = test_database().await;
        seed_loom(&database, "loom-a", None, None, None, 0).await;
        let context = resolve(&database, "loom-a").await;
        let current = scope(&context, ScopeType::CurrentConversation);
        assert_eq!(current.status, ScopeStatus::Active);
        assert_eq!(current.visibility, ScopeVisibility::Visible);
        assert_eq!(current.loom_ids, vec!["loom-a"]);
        assert_eq!(context.scoped_retrieval_loom_ids, vec!["loom-a"]);
        assert!(context.diagnostics.current_conversation_present);
    }

    #[tokio::test]
    async fn weft_origin_scope_is_hidden_background_when_applicable() {
        let database = test_database().await;
        seed_loom(&database, "origin", None, None, None, 0).await;
        seed_loom(
            &database,
            "weft",
            Some("origin"),
            Some("origin-response"),
            None,
            0,
        )
        .await;
        seed_weft_origin(&database, "weft", "origin", Some("origin-response")).await;

        let context = resolve(&database, "weft").await;
        let weft_scope = scope(&context, ScopeType::WeftOriginChain);
        assert_eq!(weft_scope.status, ScopeStatus::HiddenBackground);
        assert_eq!(weft_scope.visibility, ScopeVisibility::HiddenBackground);
        assert!(weft_scope.hidden_background);
        assert_eq!(weft_scope.lineage_depth, Some(1));
        assert!(context.weft_loom_detected);
        assert_eq!(context.diagnostics.lineage_depth, 1);
    }

    #[tokio::test]
    async fn non_weft_loom_has_no_weft_origin_scope() {
        let database = test_database().await;
        seed_loom(&database, "loom-a", None, None, None, 0).await;
        let context = resolve(&database, "loom-a").await;
        assert!(!context
            .scopes
            .iter()
            .any(|scope| scope.scope_type == ScopeType::WeftOriginChain));
        assert!(!context.weft_loom_detected);
        assert_eq!(context.diagnostics.lineage_depth, 0);
    }

    #[tokio::test]
    async fn reserved_scopes_are_emitted() {
        let database = test_database().await;
        seed_loom(&database, "loom-a", None, None, None, 0).await;
        let context = resolve(&database, "loom-a").await;
        for scope_type in [
            ScopeType::ProjectGroup,
            ScopeType::ProjectAttachment,
            ScopeType::ToolMcpContext,
        ] {
            assert_eq!(scope(&context, scope_type).status, ScopeStatus::Reserved);
        }
        assert_eq!(context.diagnostics.reserved_scopes, 3);
    }

    #[tokio::test]
    async fn scoped_and_cross_retrieval_descriptors_carry_allowlists() {
        let database = test_database().await;
        seed_loom(&database, "loom-a", None, None, None, 0).await;
        seed_loom(&database, "loom-b", None, None, None, 0).await;
        let context = resolve(&database, "loom-a").await;
        assert_eq!(
            scope(&context, ScopeType::ScopedRetrieval).loom_ids,
            vec!["loom-a"]
        );
        let cross = scope(&context, ScopeType::CrossConversationRetrieval);
        assert_eq!(cross.priority, 9);
        assert_eq!(cross.status, ScopeStatus::Active);
        assert_eq!(cross.loom_ids, vec!["loom-b"]);
    }

    #[tokio::test]
    async fn archived_retrieval_is_disabled_by_default_and_lower_priority_when_enabled() {
        let database = test_database().await;
        seed_loom(&database, "loom-a", None, None, None, 0).await;
        seed_loom(&database, "archived", None, None, Some("4"), 0).await;
        let disabled = resolve(&database, "loom-a").await;
        assert_eq!(
            scope(&disabled, ScopeType::ArchivedRetrieval).status,
            ScopeStatus::Empty
        );
        assert!(!disabled.diagnostics.archived_scope_enabled);

        let service = ScopeResolutionService::new(&database);
        let mut request = ScopeResolutionRequest::new("loom-a", "run-a");
        request.options.include_archived = true;
        let enabled = service.resolve(request).await.expect("resolve");
        let archived = scope(&enabled, ScopeType::ArchivedRetrieval);
        assert_eq!(archived.priority, 10);
        assert_eq!(archived.status, ScopeStatus::Active);
        assert_eq!(archived.loom_ids, vec!["archived"]);
        assert!(enabled.diagnostics.archived_scope_enabled);
    }

    #[tokio::test]
    async fn diagnostics_are_counts_and_status_only() {
        let database = test_database().await;
        seed_loom(&database, "loom-secret", None, None, None, 0).await;
        seed_memory(
            &database,
            "memory-secret",
            Some("loom-secret"),
            "explicit_user_memory",
            1,
        )
        .await;
        seed_ready_attachment(&database, "attachment-secret", "loom-secret").await;
        let mut request = ScopeResolutionRequest::new("loom-secret", "run-secret");
        request.explicit_reference_ids = vec!["missing-reference-secret".to_string()];
        let context = ScopeResolutionService::new(&database)
            .resolve(request)
            .await
            .expect("resolve");
        let diagnostics = format!("{:?}", context.diagnostics);
        for forbidden in [
            "loom-secret",
            "memory-secret",
            "attachment-secret",
            "missing-reference-secret",
            "private query text",
            "raw_thinking",
            "secret",
        ] {
            assert!(!diagnostics.contains(forbidden), "{forbidden}");
        }
        assert_eq!(context.diagnostics.memory_scopes_count, 2);
        assert_eq!(context.diagnostics.attachment_scopes_count, 1);
    }

    #[tokio::test]
    async fn raw_thinking_markers_are_absent_from_scope_resolution() {
        let database = test_database().await;
        seed_loom(&database, "loom-a", None, None, None, 0).await;
        let context = resolve(&database, "loom-a").await;
        let debug = format!("{:?}", context.diagnostics);
        for forbidden in [
            "raw_thinking",
            "thinking_text",
            "chain_of_thought",
            "hidden_reasoning",
        ] {
            assert!(!debug.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn retrieval_query_loom_ids_filter_tantivy() {
        let database = test_database().await;
        seed_retrieval_response(&database, "loom-a", "resp-a", "shared lexical apple").await;
        seed_retrieval_response(&database, "loom-b", "resp-b", "shared lexical apple").await;
        let adapter = TantivyRetrievalAdapter::new(&database, temp_path("scope-tantivy-filter"))
            .expect("adapter");
        adapter.rebuild_full().await.expect("rebuild");

        let mut request = TantivySearchRequest::keyword("shared lexical apple");
        request.limit = 10;
        request.loom_ids = vec!["loom-b".to_string()];
        let result = adapter.search(&request).await.expect("search");
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].loom_id.as_deref(), Some("loom-b"));
        assert_eq!(result.candidates[0].source_id, "resp-b");
    }

    #[tokio::test]
    async fn retrieval_query_loom_ids_filter_lancedb() {
        let database = test_database().await;
        seed_retrieval_response(&database, "loom-a", "resp-a", "semantic apple").await;
        seed_retrieval_response(&database, "loom-b", "resp-b", "semantic apple").await;
        let adapter = LanceDbRetrievalAdapter::new(
            &database,
            temp_path("scope-lancedb-filter"),
            Arc::new(FakeEmbedding::new(12)),
        )
        .expect("adapter");
        adapter.rebuild_full().await.expect("rebuild");

        let mut request = LanceDbSearchRequest::semantic("semantic apple");
        request.limit = 10;
        request.loom_ids = vec!["loom-b".to_string()];
        let result = adapter.search(&request).await.expect("search");
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].loom_id.as_deref(), Some("loom-b"));
        assert_eq!(result.candidates[0].source_id, "resp-b");
    }

    #[tokio::test]
    async fn hybrid_retrieval_passes_loom_ids_and_empty_preserves_old_behavior() {
        let database = test_database().await;
        seed_retrieval_response(&database, "loom-a", "resp-a", "hybrid apple").await;
        seed_retrieval_response(&database, "loom-b", "resp-b", "hybrid apple").await;
        let tantivy = Arc::new(
            TantivyRetrievalAdapter::new(&database, temp_path("scope-hybrid-tantivy"))
                .expect("tantivy"),
        );
        let lancedb = Arc::new(
            LanceDbRetrievalAdapter::new(
                &database,
                temp_path("scope-hybrid-lancedb"),
                Arc::new(FakeEmbedding::new(12)),
            )
            .expect("lancedb"),
        );
        tantivy.rebuild_full().await.expect("tantivy rebuild");
        lancedb.rebuild_full().await.expect("lancedb rebuild");

        let service = HybridRetrievalService::new(
            Some(Arc::new(
                crate::retrieval::hybrid_service::TantivyHybridSource::new(tantivy),
            )),
            Some(Arc::new(
                crate::retrieval::hybrid_service::LanceDbHybridSource::new(lancedb),
            )),
        );
        let mut scoped =
            RetrievalQuery::hybrid("hybrid apple").with_loom_ids(vec!["loom-b".into()]);
        scoped.max_candidates = 10;
        let scoped_result = service.retrieve(&scoped).await;
        assert!(!scoped_result.candidates.is_empty());
        assert!(scoped_result
            .candidates
            .iter()
            .all(|candidate| candidate.loom_id.as_deref() == Some("loom-b")));

        let mut unscoped = RetrievalQuery::hybrid("hybrid apple");
        unscoped.max_candidates = 10;
        let unscoped_result = service.retrieve(&unscoped).await;
        let loom_ids = unscoped_result
            .candidates
            .iter()
            .filter_map(|candidate| candidate.loom_id.as_deref())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(loom_ids, ["loom-a", "loom-b"].into_iter().collect());
    }

    #[tokio::test]
    async fn legacy_empty_loom_ids_matches_unfiltered_tantivy_behavior() {
        let database = test_database().await;
        seed_retrieval_response(&database, "loom-a", "resp-a", "compat apple").await;
        seed_retrieval_response(&database, "loom-b", "resp-b", "compat apple").await;
        let adapter = TantivyRetrievalAdapter::new(&database, temp_path("scope-tantivy-compat"))
            .expect("adapter");
        adapter.rebuild_full().await.expect("rebuild");
        let mut request = TantivySearchRequest::keyword("compat apple");
        request.limit = 10;
        let result = adapter.search(&request).await.expect("search");
        assert_eq!(result.candidates.len(), 2);
    }

    fn scope(context: &super::ScopeContext, scope_type: ScopeType) -> &super::ScopeDescriptor {
        context
            .scopes
            .iter()
            .find(|scope| scope.scope_type == scope_type)
            .expect("scope")
    }

    async fn resolve(database: &Database, loom_id: &str) -> super::ScopeContext {
        ScopeResolutionService::new(database)
            .resolve(ScopeResolutionRequest::new(loom_id, "run-a"))
            .await
            .expect("resolve")
    }

    async fn seed_loom(
        database: &Database,
        loom_id: &str,
        origin_loom_id: Option<&str>,
        origin_response_id: Option<&str>,
        archived_at: Option<&str>,
        is_deleted: i64,
    ) {
        sqlx::query(
            "INSERT INTO looms (
                loom_id, title, kind, origin_loom_id, origin_response_id,
                created_at, updated_at, archived_at, is_deleted
             ) VALUES (?1, ?2, 'conversation', ?3, ?4, '1', '1', ?5, ?6)",
        )
        .bind(loom_id)
        .bind(format!("title-{loom_id}"))
        .bind(origin_loom_id)
        .bind(origin_response_id)
        .bind(archived_at)
        .bind(is_deleted)
        .execute(database.pool())
        .await
        .expect("seed loom");
    }

    async fn seed_weft_origin(
        database: &Database,
        weft_loom_id: &str,
        origin_loom_id: &str,
        origin_response_id: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO weft_origin_contexts (
                context_id, weft_loom_id, origin_loom_id, origin_response_id,
                origin_summary, status, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'summary', 'ready', '1', '1')",
        )
        .bind(format!("context-{weft_loom_id}"))
        .bind(weft_loom_id)
        .bind(origin_loom_id)
        .bind(origin_response_id.unwrap_or("origin-response"))
        .execute(database.pool())
        .await
        .expect("seed weft origin");
    }

    async fn seed_memory(
        database: &Database,
        memory_id: &str,
        source_loom_id: Option<&str>,
        memory_type: &str,
        user_confirmed: i64,
    ) {
        sqlx::query(
            "INSERT INTO memories (
                memory_id, memory_type, content, normalized_content,
                created_at, updated_at, source_loom_id, user_confirmed
             ) VALUES (?1, ?2, 'memory content', 'memory content', '1', '1', ?3, ?4)",
        )
        .bind(memory_id)
        .bind(memory_type)
        .bind(source_loom_id)
        .bind(user_confirmed)
        .execute(database.pool())
        .await
        .expect("seed memory");
    }

    async fn seed_ready_attachment(database: &Database, attachment_id: &str, loom_id: &str) {
        sqlx::query(
            "INSERT INTO attachments (
                attachment_id, loom_id, file_name, size_bytes, kind,
                parse_status, created_at, updated_at
             ) VALUES (?1, ?2, 'scope.txt', 10, 'text', 'ready', '1', '1')",
        )
        .bind(attachment_id)
        .bind(loom_id)
        .execute(database.pool())
        .await
        .expect("seed attachment");
    }

    async fn seed_retrieval_response(
        database: &Database,
        loom_id: &str,
        response_id: &str,
        content: &str,
    ) {
        seed_loom(database, loom_id, None, None, None, 0).await;
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, sequence_index,
                is_deleted, created_at, updated_at
             ) VALUES (?1, ?2, 'assistant', ?3, ?4, 0, 0, '1', '1')",
        )
        .bind(response_id)
        .bind(loom_id)
        .bind(content)
        .bind(format!("title-{response_id}"))
        .execute(database.pool())
        .await
        .expect("seed response");
    }

    #[derive(Debug, Clone)]
    struct FakeEmbedding {
        dimensions: usize,
    }

    impl FakeEmbedding {
        fn new(dimensions: usize) -> Self {
            Self { dimensions }
        }
    }

    impl EmbeddingGenerator for FakeEmbedding {
        fn provider_id(&self) -> &str {
            "scope-test"
        }

        fn model_id(&self) -> &str {
            "scope-test-model"
        }

        fn dimensions(&self) -> usize {
            self.dimensions
        }

        fn embed_texts(
            &self,
            inputs: &[String],
        ) -> Result<Vec<Vec<f32>>, crate::error::ServiceError> {
            Ok(inputs
                .iter()
                .map(|input| fake_embedding(input, self.dimensions))
                .collect())
        }
    }

    fn fake_embedding(input: &str, dimensions: usize) -> Vec<f32> {
        let mut vector = vec![0.0; dimensions];
        for (index, byte) in input.bytes().enumerate() {
            vector[index % dimensions] += f32::from(byte) / 255.0;
        }
        vector
    }

    fn temp_path(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("loom-{label}-{}", uuid::Uuid::new_v4()))
    }
}
