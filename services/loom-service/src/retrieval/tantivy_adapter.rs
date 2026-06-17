#![allow(dead_code)]

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use crate::{
    error::ServiceError,
    storage::{
        db::Database,
        repositories::retrieval_projection::{
            RetrievalProjectionCandidate, RetrievalProjectionRepository,
            RETRIEVAL_PROJECTION_VERSION,
        },
    },
};
use serde::{Deserialize, Serialize};
use tantivy::{
    collector::TopDocs,
    doc,
    query::{QueryParser, TermQuery},
    schema::{Field, Schema, TantivyDocument, Value, STORED, STRING, TEXT},
    Index, IndexReader, IndexWriter, ReloadPolicy, Score, Term,
};

const TANTIVY_INDEX_VERSION: &str = "tantivy-lexical-v1";
const TANTIVY_META_FILE: &str = "loom_tantivy_projection_meta.json";
const DEFAULT_WRITER_HEAP_BYTES: usize = 50_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TantivySearchRequest {
    pub query: String,
    pub limit: usize,
    pub source_kinds: Vec<String>,
    pub loom_ids: Vec<String>,
    pub exact: bool,
}

impl TantivySearchRequest {
    pub fn keyword(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            limit: 10,
            source_kinds: Vec::new(),
            loom_ids: Vec::new(),
            exact: false,
        }
    }

    pub fn exact(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            limit: 10,
            source_kinds: Vec::new(),
            loom_ids: Vec::new(),
            exact: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TantivySearchCandidate {
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: String,
    pub content_digest: String,
    pub projection_version: String,
    pub loom_id: Option<String>,
    pub response_id: Option<String>,
    pub bm25_score: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TantivySearchResult {
    pub candidates: Vec<TantivySearchCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TantivyIndexDiagnostics {
    pub document_count: usize,
    pub chunk_count: usize,
    pub index_version: String,
    pub projection_version: String,
    pub last_rebuild: Option<String>,
}

#[derive(Debug, Clone)]
struct TantivyFields {
    doc_key: Field,
    source_kind: Field,
    source_id: Field,
    chunk_ref: Field,
    content_digest: Field,
    projection_version: Field,
    title: Field,
    content: Field,
}

#[derive(Debug, Clone)]
pub struct TantivyIndexManager {
    index_dir: PathBuf,
    index: Index,
    fields: TantivyFields,
}

impl TantivyIndexManager {
    pub fn open_or_create(index_dir: impl Into<PathBuf>) -> Result<Self, ServiceError> {
        let index_dir = index_dir.into();
        fs::create_dir_all(&index_dir).map_err(|error| {
            ServiceError::storage(format!(
                "failed to create Tantivy retrieval index directory: {error}"
            ))
        })?;

        let schema = tantivy_schema();
        let index = match Index::open_in_dir(&index_dir) {
            Ok(index) => index,
            Err(_) => Index::create_in_dir(&index_dir, schema.clone()).map_err(|error| {
                ServiceError::storage(format!("failed to create Tantivy retrieval index: {error}"))
            })?,
        };
        let fields = TantivyFields::from_schema(index.schema())?;
        Ok(Self {
            index_dir,
            index,
            fields,
        })
    }

    pub fn writer(&self) -> Result<IndexWriter, ServiceError> {
        self.index
            .writer(DEFAULT_WRITER_HEAP_BYTES)
            .map_err(|error| {
                ServiceError::storage(format!("failed to open Tantivy index writer: {error}"))
            })
    }

    pub fn reader(&self) -> Result<IndexReader, ServiceError> {
        self.index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .map_err(|error| {
                ServiceError::storage(format!("failed to open Tantivy index reader: {error}"))
            })
    }

    fn write_diagnostics(&self, diagnostics: &TantivyIndexDiagnostics) -> Result<(), ServiceError> {
        let payload = serde_json::to_string_pretty(diagnostics).map_err(|error| {
            ServiceError::storage(format!(
                "failed to serialize Tantivy retrieval diagnostics: {error}"
            ))
        })?;
        fs::write(self.index_dir.join(TANTIVY_META_FILE), payload).map_err(|error| {
            ServiceError::storage(format!(
                "failed to write Tantivy retrieval diagnostics: {error}"
            ))
        })
    }

    pub fn diagnostics(&self) -> Result<TantivyIndexDiagnostics, ServiceError> {
        let path = self.index_dir.join(TANTIVY_META_FILE);
        if !path.exists() {
            return Ok(TantivyIndexDiagnostics {
                document_count: 0,
                chunk_count: 0,
                index_version: TANTIVY_INDEX_VERSION.to_string(),
                projection_version: RETRIEVAL_PROJECTION_VERSION.to_string(),
                last_rebuild: None,
            });
        }
        let payload = fs::read_to_string(path).map_err(|error| {
            ServiceError::storage(format!(
                "failed to read Tantivy retrieval diagnostics: {error}"
            ))
        })?;
        serde_json::from_str(&payload).map_err(|error| {
            ServiceError::storage(format!(
                "failed to parse Tantivy retrieval diagnostics: {error}"
            ))
        })
    }
}

#[derive(Debug, Clone)]
pub struct TantivyRetrievalAdapter {
    projection: RetrievalProjectionRepository,
    manager: TantivyIndexManager,
}

impl TantivyRetrievalAdapter {
    pub fn new(database: &Database, index_dir: impl Into<PathBuf>) -> Result<Self, ServiceError> {
        Ok(Self {
            projection: RetrievalProjectionRepository::new(database),
            manager: TantivyIndexManager::open_or_create(index_dir)?,
        })
    }

    pub async fn rebuild_full(&self) -> Result<TantivyIndexDiagnostics, ServiceError> {
        let candidates = self.projection.enumerate_active_chunks().await?;
        let mut writer = self.manager.writer()?;
        writer.delete_all_documents().map_err(|error| {
            ServiceError::storage(format!("failed to clear Tantivy retrieval index: {error}"))
        })?;

        for candidate in &candidates {
            self.add_candidate(&mut writer, candidate)?;
        }
        writer.commit().map_err(|error| {
            ServiceError::storage(format!(
                "failed to commit Tantivy retrieval rebuild: {error}"
            ))
        })?;
        self.projection.plan_full_rebuild().await?;

        let diagnostics = TantivyIndexDiagnostics {
            document_count: candidates.len(),
            chunk_count: candidates.len(),
            index_version: TANTIVY_INDEX_VERSION.to_string(),
            projection_version: RETRIEVAL_PROJECTION_VERSION.to_string(),
            last_rebuild: Some(timestamp()),
        };
        self.manager.write_diagnostics(&diagnostics)?;
        Ok(diagnostics)
    }

    pub async fn upsert_incremental(&self) -> Result<TantivyIndexDiagnostics, ServiceError> {
        let candidates = self.projection.enumerate_active_chunks().await?;
        let stored_plan = self.projection.plan_full_rebuild().await?;
        let active_keys = candidates
            .iter()
            .map(|candidate| {
                doc_key(
                    &candidate.identity.source_kind,
                    &candidate.identity.source_id,
                    &candidate.identity.chunk_ref,
                    &candidate.identity.projection_version,
                )
            })
            .collect::<HashSet<_>>();

        let mut writer = self.manager.writer()?;
        for candidate in &candidates {
            let key = doc_key(
                &candidate.identity.source_kind,
                &candidate.identity.source_id,
                &candidate.identity.chunk_ref,
                &candidate.identity.projection_version,
            );
            writer.delete_term(Term::from_field_text(self.manager.fields.doc_key, &key));
            self.add_candidate(&mut writer, candidate)?;
        }

        for stored in self.projection.list_stored_chunks().await? {
            let key = doc_key(
                &stored.source_kind,
                &stored.source_id,
                &stored.chunk_ref,
                &stored.projection_version,
            );
            if stored.is_deleted || !active_keys.contains(&key) {
                writer.delete_term(Term::from_field_text(self.manager.fields.doc_key, &key));
            }
        }

        writer.commit().map_err(|error| {
            ServiceError::storage(format!(
                "failed to commit Tantivy retrieval incremental update: {error}"
            ))
        })?;

        let diagnostics = TantivyIndexDiagnostics {
            document_count: candidates.len(),
            chunk_count: candidates.len(),
            index_version: TANTIVY_INDEX_VERSION.to_string(),
            projection_version: RETRIEVAL_PROJECTION_VERSION.to_string(),
            last_rebuild: Some(timestamp()),
        };
        self.manager.write_diagnostics(&diagnostics)?;
        debug_assert_eq!(diagnostics.chunk_count, stored_plan.active_chunks);
        Ok(diagnostics)
    }

    pub async fn search(
        &self,
        request: &TantivySearchRequest,
    ) -> Result<TantivySearchResult, ServiceError> {
        let query_text = request.query.trim();
        if query_text.is_empty() || request.limit == 0 {
            return Ok(TantivySearchResult {
                candidates: Vec::new(),
            });
        }

        let reader = self.manager.reader()?;
        reader.reload().map_err(|error| {
            ServiceError::storage(format!(
                "failed to reload Tantivy retrieval reader: {error}"
            ))
        })?;
        let searcher = reader.searcher();
        let query = if request.exact {
            Box::new(TermQuery::new(
                Term::from_field_text(self.manager.fields.content, query_text),
                tantivy::schema::IndexRecordOption::WithFreqsAndPositions,
            )) as Box<dyn tantivy::query::Query>
        } else {
            let parser = QueryParser::for_index(
                &self.manager.index,
                vec![self.manager.fields.title, self.manager.fields.content],
            );
            parser.parse_query(query_text).map_err(|error| {
                ServiceError::storage(format!("failed to parse Tantivy retrieval query: {error}"))
            })?
        };

        let top_docs_limit = if request.loom_ids.is_empty() {
            request.limit.saturating_mul(4).max(request.limit)
        } else {
            request.limit.saturating_mul(16).max(request.limit)
        };
        let top_docs = searcher
            .search(
                &query,
                &TopDocs::with_limit(top_docs_limit).order_by_score(),
            )
            .map_err(|error| {
                ServiceError::storage(format!("failed to search Tantivy index: {error}"))
            })?;

        let source_filter = request
            .source_kinds
            .iter()
            .map(|source| source.as_str())
            .collect::<HashSet<_>>();
        let loom_filter = request
            .loom_ids
            .iter()
            .map(|loom_id| loom_id.as_str())
            .collect::<HashSet<_>>();
        let mut candidates = Vec::new();
        for (score, address) in top_docs {
            let doc: TantivyDocument = searcher.doc(address).map_err(|error| {
                ServiceError::storage(format!("failed to read Tantivy document: {error}"))
            })?;
            let mut candidate = candidate_from_doc(&doc, &self.manager.fields, score)?;
            if !source_filter.is_empty() && !source_filter.contains(candidate.source_kind.as_str())
            {
                continue;
            }
            if !loom_filter.is_empty() {
                let Some(metadata) = self
                    .projection
                    .get_chunk_scope_metadata(
                        &candidate.source_kind,
                        &candidate.source_id,
                        &candidate.chunk_ref,
                        &candidate.projection_version,
                    )
                    .await?
                else {
                    continue;
                };
                if !metadata
                    .loom_id
                    .as_deref()
                    .is_some_and(|loom_id| loom_filter.contains(loom_id))
                {
                    continue;
                }
                candidate.loom_id = metadata.loom_id;
                candidate.response_id = metadata.response_id;
            } else if let Some(metadata) = self
                .projection
                .get_chunk_scope_metadata(
                    &candidate.source_kind,
                    &candidate.source_id,
                    &candidate.chunk_ref,
                    &candidate.projection_version,
                )
                .await?
            {
                candidate.loom_id = metadata.loom_id;
                candidate.response_id = metadata.response_id;
            }
            candidates.push(candidate);
            if candidates.len() >= request.limit {
                break;
            }
        }
        Ok(TantivySearchResult { candidates })
    }

    pub async fn exact_term_search(
        &self,
        term: &str,
        limit: usize,
    ) -> Result<TantivySearchResult, ServiceError> {
        self.search(&TantivySearchRequest {
            query: term.to_string(),
            limit,
            source_kinds: Vec::new(),
            loom_ids: Vec::new(),
            exact: true,
        })
        .await
    }

    pub fn diagnostics(&self) -> Result<TantivyIndexDiagnostics, ServiceError> {
        self.manager.diagnostics()
    }

    fn add_candidate(
        &self,
        writer: &mut IndexWriter,
        candidate: &RetrievalProjectionCandidate,
    ) -> Result<(), ServiceError> {
        reject_index_payload(Some(&candidate.content))?;
        reject_index_payload(candidate.title.as_deref())?;
        reject_index_payload(candidate.metadata_json.as_deref())?;
        let fields = &self.manager.fields;
        let key = doc_key(
            &candidate.identity.source_kind,
            &candidate.identity.source_id,
            &candidate.identity.chunk_ref,
            &candidate.identity.projection_version,
        );
        writer
            .add_document(doc!(
                fields.doc_key => key,
                fields.source_kind => candidate.identity.source_kind.clone(),
                fields.source_id => candidate.identity.source_id.clone(),
                fields.chunk_ref => candidate.identity.chunk_ref.clone(),
                fields.content_digest => candidate.identity.content_digest.clone(),
                fields.projection_version => candidate.identity.projection_version.clone(),
                fields.title => candidate.title.clone().unwrap_or_default(),
                fields.content => candidate.content.clone(),
            ))
            .map_err(|error| {
                ServiceError::storage(format!("failed to add Tantivy retrieval document: {error}"))
            })?;
        Ok(())
    }
}

impl TantivyFields {
    fn from_schema(schema: Schema) -> Result<Self, ServiceError> {
        Ok(Self {
            doc_key: schema.get_field("doc_key").map_err(schema_field_error)?,
            source_kind: schema
                .get_field("source_kind")
                .map_err(schema_field_error)?,
            source_id: schema.get_field("source_id").map_err(schema_field_error)?,
            chunk_ref: schema.get_field("chunk_ref").map_err(schema_field_error)?,
            content_digest: schema
                .get_field("content_digest")
                .map_err(schema_field_error)?,
            projection_version: schema
                .get_field("projection_version")
                .map_err(schema_field_error)?,
            title: schema.get_field("title").map_err(schema_field_error)?,
            content: schema.get_field("content").map_err(schema_field_error)?,
        })
    }
}

fn tantivy_schema() -> Schema {
    let mut builder = Schema::builder();
    builder.add_text_field("doc_key", STRING | STORED);
    builder.add_text_field("source_kind", STRING | STORED);
    builder.add_text_field("source_id", STRING | STORED);
    builder.add_text_field("chunk_ref", STRING | STORED);
    builder.add_text_field("content_digest", STRING | STORED);
    builder.add_text_field("projection_version", STRING | STORED);
    builder.add_text_field("title", TEXT | STORED);
    builder.add_text_field("content", TEXT | STORED);
    builder.build()
}

fn candidate_from_doc(
    doc: &TantivyDocument,
    fields: &TantivyFields,
    score: Score,
) -> Result<TantivySearchCandidate, ServiceError> {
    Ok(TantivySearchCandidate {
        source_kind: stored_text(doc, fields.source_kind, "source_kind")?,
        source_id: stored_text(doc, fields.source_id, "source_id")?,
        chunk_ref: stored_text(doc, fields.chunk_ref, "chunk_ref")?,
        content_digest: stored_text(doc, fields.content_digest, "content_digest")?,
        projection_version: stored_text(doc, fields.projection_version, "projection_version")?,
        loom_id: None,
        response_id: None,
        bm25_score: score,
    })
}

fn stored_text(doc: &TantivyDocument, field: Field, name: &str) -> Result<String, ServiceError> {
    doc.get_first(field)
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .ok_or_else(|| ServiceError::storage(format!("Tantivy document missing field {name}")))
}

fn doc_key(
    source_kind: &str,
    source_id: &str,
    chunk_ref: &str,
    projection_version: &str,
) -> String {
    format!("{source_kind}\u{1f}{source_id}\u{1f}{chunk_ref}\u{1f}{projection_version}")
}

fn schema_field_error(error: tantivy::TantivyError) -> ServiceError {
    ServiceError::storage(format!("invalid Tantivy retrieval schema: {error}"))
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn reject_index_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    const FORBIDDEN: [&str; 20] = [
        "raw_thinking",
        "thinking_text",
        "chain_of_thought",
        "hidden_reasoning",
        "rawThinking",
        "thinkingText",
        "chainOfThought",
        "hiddenReasoning",
        "provider_delta",
        "providerDelta",
        "provider_payload",
        "providerPayload",
        "Authorization",
        "Bearer ",
        "apiKey",
        "api_key",
        "password",
        "credential",
        "secret",
        "sk-",
    ];
    let Some(payload) = payload else {
        return Ok(());
    };
    for forbidden in FORBIDDEN {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "Tantivy retrieval payload contains forbidden marker {forbidden}"
            )));
        }
    }
    Ok(())
}

#[allow(dead_code)]
fn _assert_index_path_is_projection_only(path: &Path) -> bool {
    path.ends_with("tantivy") || path.exists()
}

#[cfg(test)]
mod tests {
    use super::{TantivyRetrievalAdapter, TantivySearchRequest};
    use crate::storage::db::{test_database, Database};
    use sqlx::Row;

    #[tokio::test]
    async fn rebuild_index_searches_all_projection_sources() {
        let fixture = Fixture::seed().await;
        let adapter = fixture.adapter();
        let diagnostics = adapter.rebuild_full().await.expect("rebuild");
        assert_eq!(diagnostics.chunk_count, 6);

        let result = adapter
            .search(&TantivySearchRequest::keyword("projection"))
            .await
            .expect("search");
        let mut kinds = result
            .candidates
            .iter()
            .map(|candidate| candidate.source_kind.as_str())
            .collect::<Vec<_>>();
        kinds.sort_unstable();
        assert_eq!(
            kinds,
            vec![
                "attachment_chunk",
                "checkpoint",
                "memory",
                "reference",
                "response",
                "response_capsule"
            ]
        );
    }

    #[tokio::test]
    async fn rebuild_from_empty_index_is_reproducible() {
        let fixture = Fixture::seed().await;
        let adapter = fixture.adapter();
        let first = adapter.rebuild_full().await.expect("first rebuild");
        let first_results = adapter
            .search(&TantivySearchRequest::keyword("response"))
            .await
            .expect("first search")
            .candidates;
        let second = adapter.rebuild_full().await.expect("second rebuild");
        let second_results = adapter
            .search(&TantivySearchRequest::keyword("response"))
            .await
            .expect("second search")
            .candidates;
        assert_eq!(first.chunk_count, second.chunk_count);
        assert_eq!(first_results, second_results);
    }

    #[tokio::test]
    async fn incremental_update_replaces_changed_content() {
        let fixture = Fixture::seed_response_only().await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        assert_eq!(
            adapter
                .search(&TantivySearchRequest::keyword("original"))
                .await
                .expect("original search")
                .candidates
                .len(),
            1
        );

        sqlx::query(
            "UPDATE responses SET content = 'updated lexical content', updated_at = '2'
             WHERE response_id = 'resp-a'",
        )
        .execute(fixture.database.pool())
        .await
        .expect("update response");

        adapter.upsert_incremental().await.expect("incremental");
        assert_eq!(
            adapter
                .search(&TantivySearchRequest::keyword("updated"))
                .await
                .expect("updated search")
                .candidates
                .len(),
            1
        );
        assert_eq!(
            adapter
                .search(&TantivySearchRequest::keyword("original"))
                .await
                .expect("old search")
                .candidates
                .len(),
            0
        );
    }

    #[tokio::test]
    async fn deletion_tombstones_are_removed_from_tantivy() {
        let fixture = Fixture::seed_response_only().await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        sqlx::query("UPDATE responses SET is_deleted = 1 WHERE response_id = 'resp-a'")
            .execute(fixture.database.pool())
            .await
            .expect("delete response");
        adapter.upsert_incremental().await.expect("incremental");
        let result = adapter
            .search(&TantivySearchRequest::keyword("original"))
            .await
            .expect("search");
        assert!(result.candidates.is_empty());
    }

    #[tokio::test]
    async fn bm25_and_exact_match_return_chunk_level_identity() {
        let fixture = Fixture::seed_response_only().await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        let bm25 = adapter
            .search(&TantivySearchRequest::keyword("original"))
            .await
            .expect("bm25");
        assert_eq!(bm25.candidates.len(), 1);
        let candidate = &bm25.candidates[0];
        assert_eq!(candidate.source_kind, "response");
        assert_eq!(candidate.source_id, "resp-a");
        assert_eq!(candidate.chunk_ref, "response:resp-a:content");
        assert_eq!(
            candidate.projection_version,
            "sqlite-retrieval-projection-v1"
        );
        assert!(candidate.bm25_score > 0.0);

        let exact = adapter
            .exact_term_search("original", 10)
            .await
            .expect("exact");
        assert_eq!(exact.candidates[0].source_id, "resp-a");
    }

    #[tokio::test]
    async fn source_filtering_limits_candidates() {
        let fixture = Fixture::seed().await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        let mut request = TantivySearchRequest::keyword("projection");
        request.source_kinds = vec!["memory".to_string()];
        let result = adapter.search(&request).await.expect("filtered search");
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].source_kind, "memory");
    }

    #[tokio::test]
    async fn diagnostics_and_digest_reflect_latest_projection_state() {
        let fixture = Fixture::seed_response_only().await;
        let adapter = fixture.adapter();
        let first = adapter.rebuild_full().await.expect("rebuild");
        assert_eq!(first.document_count, 1);
        assert_eq!(first.chunk_count, 1);
        assert_eq!(first.index_version, "tantivy-lexical-v1");
        assert_eq!(first.projection_version, "sqlite-retrieval-projection-v1");
        assert!(first.last_rebuild.is_some());
        assert_eq!(adapter.diagnostics().expect("diagnostics"), first);
        let first_digest = adapter
            .search(&TantivySearchRequest::keyword("original"))
            .await
            .expect("search")
            .candidates[0]
            .content_digest
            .clone();

        sqlx::query(
            "UPDATE responses SET content = 'updated digest projection content', updated_at = '2'
             WHERE response_id = 'resp-a'",
        )
        .execute(fixture.database.pool())
        .await
        .expect("update response");
        adapter.upsert_incremental().await.expect("incremental");
        let second_digest = adapter
            .search(&TantivySearchRequest::keyword("updated"))
            .await
            .expect("search updated")
            .candidates[0]
            .content_digest
            .clone();
        assert_ne!(first_digest, second_digest);
    }

    #[tokio::test]
    async fn privacy_exclusion_blocks_raw_thinking_and_agent_events() {
        let fixture = Fixture::seed_response_only().await;
        seed_agent_event_noise(&fixture.database).await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        assert!(adapter
            .search(&TantivySearchRequest::keyword("agent event text"))
            .await
            .expect("agent event search")
            .candidates
            .is_empty());

        sqlx::query(
            "UPDATE responses SET content = 'raw_thinking forbidden marker'
             WHERE response_id = 'resp-a'",
        )
        .execute(fixture.database.pool())
        .await
        .expect("unsafe response");
        let error = adapter
            .rebuild_full()
            .await
            .expect_err("raw thinking rejected");
        assert!(error.to_string().contains("raw_thinking"));
    }

    struct Fixture {
        database: Database,
        index_dir: std::path::PathBuf,
    }

    impl Fixture {
        async fn seed() -> Self {
            let fixture = Self::seed_response_only().await;
            seed_reference(&fixture.database).await;
            seed_memory(&fixture.database).await;
            seed_attachment_chunk(&fixture.database).await;
            seed_response_capsule(&fixture.database).await;
            seed_checkpoint(&fixture.database).await;
            fixture
        }

        async fn seed_response_only() -> Self {
            let database = test_database().await;
            seed_loom(&database, "loom-a").await;
            seed_response(
                &database,
                "resp-a",
                "loom-a",
                "original response projection content",
                0,
                0,
            )
            .await;
            let index_dir =
                std::env::temp_dir().join(format!("loom-tantivy-test-{}", uuid::Uuid::new_v4()));
            Self {
                database,
                index_dir,
            }
        }

        fn adapter(&self) -> TantivyRetrievalAdapter {
            TantivyRetrievalAdapter::new(&self.database, &self.index_dir).expect("adapter")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.index_dir);
        }
    }

    async fn seed_loom(database: &Database, loom_id: &str) {
        sqlx::query(
            "INSERT INTO looms (loom_id, title, created_at, updated_at)
             VALUES (?1, ?2, '1', '1')",
        )
        .bind(loom_id)
        .bind(loom_id)
        .execute(database.pool())
        .await
        .expect("seed loom");
    }

    async fn seed_response(
        database: &Database,
        response_id: &str,
        loom_id: &str,
        content: &str,
        is_deleted: i64,
        sequence_index: i64,
    ) {
        sqlx::query(
            "INSERT INTO responses (
                response_id, loom_id, role, content, title, created_at, updated_at,
                sequence_index, is_deleted
             ) VALUES (?1, ?2, 'assistant', ?3, 'Projection response', '1', '1', ?4, ?5)",
        )
        .bind(response_id)
        .bind(loom_id)
        .bind(content)
        .bind(sequence_index)
        .bind(is_deleted)
        .execute(database.pool())
        .await
        .expect("seed response");
    }

    async fn seed_reference(database: &Database) {
        sqlx::query(
            "INSERT INTO \"references\" (
                reference_id, source_loom_id, source_response_id, target_kind,
                target_id, selected_text, label, created_at
             ) VALUES (
                'ref-a', 'loom-a', 'resp-a', 'response',
                'resp-a', 'Selected reference projection content', 'Reference label', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed reference");
    }

    async fn seed_memory(database: &Database) {
        sqlx::query(
            "INSERT INTO memories (
                memory_id, memory_type, content, normalized_content, source_loom_id,
                source_response_id, user_confirmed, updated_at
             ) VALUES (
                'mem-a', 'explicit_user_memory', 'Memory projection content',
                'memory projection content', 'loom-a', 'resp-a', 1, '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed memory");
    }

    async fn seed_attachment_chunk(database: &Database) {
        sqlx::query(
            "INSERT INTO attachments (
                attachment_id, loom_id, file_name, mime_type, size_bytes, kind,
                parse_status, created_at, updated_at, parse_artifact_id
             ) VALUES (
                'att-a', 'loom-a', 'notes.txt', 'text/plain', 10, 'text',
                'ready', '1', '1', 'artifact-a'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed attachment");
        sqlx::query(
            "INSERT INTO attachment_parse_artifacts (
                parse_artifact_id, sha256, parser_kind, parser_version, kind,
                content_kind, content_text, char_count, created_at
             ) VALUES (
                'artifact-a', 'sha-a', 'test', '1', 'text',
                'text', 'Attachment projection content', 29, '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed parse artifact");
        sqlx::query(
            "INSERT INTO attachment_parse_artifact_chunks (
                chunk_id, parse_artifact_id, chunk_index, content_text,
                char_start, char_end, char_count, token_estimate, created_at
             ) VALUES (
                'artifact-chunk-a', 'artifact-a', 0, 'Attachment chunk projection content',
                0, 35, 35, 8, '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed artifact chunk");
    }

    async fn seed_response_capsule(database: &Database) {
        sqlx::query(
            "INSERT INTO response_context_capsules (
                capsule_id, response_id, loom_id, title, summary, status, created_at, updated_at
             ) VALUES (
                'capsule-a', 'resp-a', 'loom-a', 'Capsule title',
                'Response capsule projection content', 'ready', '1', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed capsule");
    }

    async fn seed_checkpoint(database: &Database) {
        sqlx::query(
            "INSERT INTO loom_checkpoint_summaries (
                checkpoint_id, loom_id, up_to_response_id, summary, status, created_at, updated_at
             ) VALUES (
                'checkpoint-a', 'loom-a', 'resp-a',
                'Checkpoint projection content', 'ready', '1', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed checkpoint");
    }

    async fn seed_agent_event_noise(database: &Database) {
        sqlx::query(
            "INSERT INTO agent_runs (
                agent_run_id, loom_id, response_id, correlation_id, status, started_at, created_at
             ) VALUES (
                'agent-run-a', 'loom-a', 'resp-a', 'corr-a', 'completed', '1', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed agent run");
        sqlx::query(
            "INSERT INTO agent_events (
                agent_event_id, agent_run_id, sequence_number, event_type, payload_json, created_at
             ) VALUES (
                'agent-event-a', 'agent-run-a', 1, 'provider_delta',
                '{\"delta\":\"agent event text must not become knowledge\"}', '1'
             )",
        )
        .execute(database.pool())
        .await
        .expect("seed agent event");
        let count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM agent_events")
            .fetch_one(database.pool())
            .await
            .expect("agent events count")
            .get("count");
        assert_eq!(count, 1);
    }
}
