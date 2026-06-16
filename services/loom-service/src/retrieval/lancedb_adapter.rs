#![allow(dead_code)]

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use arrow_array::{
    types::Float32Type, Array, FixedSizeListArray, Float32Array, Float64Array, RecordBatch,
    RecordBatchIterator, StringArray,
};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use futures_util::TryStreamExt;
use lancedb::{
    arrow::IntoArrow,
    connection::Connection,
    query::{ExecutableQuery, QueryBase},
    Table as LanceDbTable,
};
use serde::{Deserialize, Serialize};

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

const LANCEDB_INDEX_VERSION: &str = "lancedb-vector-v1";
const LANCEDB_TABLE_NAME: &str = "loom_retrieval_vectors";
const LANCEDB_META_FILE: &str = "loom_lancedb_projection_meta.json";
const DEFAULT_SEARCH_OVERSAMPLE: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LanceDbSearchRequest {
    pub query: String,
    pub limit: usize,
    pub source_kinds: Vec<String>,
}

impl LanceDbSearchRequest {
    pub fn semantic(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            limit: 10,
            source_kinds: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LanceDbSearchCandidate {
    pub source_kind: String,
    pub source_id: String,
    pub chunk_ref: String,
    pub content_digest: String,
    pub projection_version: String,
    pub vector_score: f32,
    pub vector_distance: f32,
    pub embedding_provider_id: String,
    pub embedding_model_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LanceDbSearchResult {
    pub candidates: Vec<LanceDbSearchCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LanceDbIndexDiagnostics {
    pub document_count: usize,
    pub chunk_count: usize,
    pub index_version: String,
    pub projection_version: String,
    pub embedding_provider_id: String,
    pub embedding_model_id: String,
    pub embedding_dimensions: usize,
    pub last_rebuild: Option<String>,
}

pub trait EmbeddingGenerator: Send + Sync {
    fn provider_id(&self) -> &str;
    fn model_id(&self) -> &str;
    fn dimensions(&self) -> usize;
    fn embed_texts(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, ServiceError>;

    fn embed_query(&self, query: &str) -> Result<Vec<f32>, ServiceError> {
        let mut embeddings = self.embed_texts(&[query.to_string()])?;
        embeddings.pop().ok_or_else(|| {
            ServiceError::storage("embedding provider returned no query vector".to_string())
        })
    }
}

#[derive(Clone)]
pub struct LanceDbIndexManager {
    database_dir: PathBuf,
    embedding_provider: Arc<dyn EmbeddingGenerator>,
}

impl LanceDbIndexManager {
    pub fn new(
        database_dir: impl Into<PathBuf>,
        embedding_provider: Arc<dyn EmbeddingGenerator>,
    ) -> Result<Self, ServiceError> {
        if embedding_provider.dimensions() == 0 {
            return Err(ServiceError::storage(
                "LanceDB embedding dimensions must be greater than zero",
            ));
        }
        let database_dir = database_dir.into();
        fs::create_dir_all(&database_dir).map_err(|error| {
            ServiceError::storage(format!(
                "failed to create LanceDB retrieval directory: {error}"
            ))
        })?;
        Ok(Self {
            database_dir,
            embedding_provider,
        })
    }

    async fn connection(&self) -> Result<Connection, ServiceError> {
        lancedb::connect(&self.database_dir.to_string_lossy())
            .execute()
            .await
            .map_err(lancedb_error("failed to open LanceDB retrieval database"))
    }

    async fn open_or_create_table(&self) -> Result<LanceDbTable, ServiceError> {
        let connection = self.connection().await?;
        match connection.open_table(LANCEDB_TABLE_NAME).execute().await {
            Ok(table) => Ok(table),
            Err(_) => connection
                .create_empty_table(LANCEDB_TABLE_NAME, lancedb_schema(self.dimensions()))
                .execute()
                .await
                .map_err(lancedb_error("failed to create LanceDB retrieval table")),
        }
    }

    fn dimensions(&self) -> usize {
        self.embedding_provider.dimensions()
    }

    fn provider_id(&self) -> &str {
        self.embedding_provider.provider_id()
    }

    fn model_id(&self) -> &str {
        self.embedding_provider.model_id()
    }

    fn embed_texts(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, ServiceError> {
        let embeddings = self.embedding_provider.embed_texts(inputs)?;
        if embeddings.len() != inputs.len() {
            return Err(ServiceError::storage(format!(
                "embedding provider returned {} vectors for {} inputs",
                embeddings.len(),
                inputs.len()
            )));
        }
        for embedding in &embeddings {
            validate_embedding(embedding, self.dimensions())?;
        }
        Ok(embeddings)
    }

    fn embed_query(&self, query: &str) -> Result<Vec<f32>, ServiceError> {
        let embedding = self.embedding_provider.embed_query(query)?;
        validate_embedding(&embedding, self.dimensions())?;
        Ok(embedding)
    }

    fn write_diagnostics(&self, diagnostics: &LanceDbIndexDiagnostics) -> Result<(), ServiceError> {
        let payload = serde_json::to_string_pretty(diagnostics).map_err(|error| {
            ServiceError::storage(format!(
                "failed to serialize LanceDB retrieval diagnostics: {error}"
            ))
        })?;
        fs::write(self.database_dir.join(LANCEDB_META_FILE), payload).map_err(|error| {
            ServiceError::storage(format!(
                "failed to write LanceDB retrieval diagnostics: {error}"
            ))
        })
    }

    pub fn diagnostics(&self) -> Result<LanceDbIndexDiagnostics, ServiceError> {
        let path = self.database_dir.join(LANCEDB_META_FILE);
        if !path.exists() {
            return Ok(LanceDbIndexDiagnostics {
                document_count: 0,
                chunk_count: 0,
                index_version: LANCEDB_INDEX_VERSION.to_string(),
                projection_version: RETRIEVAL_PROJECTION_VERSION.to_string(),
                embedding_provider_id: self.provider_id().to_string(),
                embedding_model_id: self.model_id().to_string(),
                embedding_dimensions: self.dimensions(),
                last_rebuild: None,
            });
        }
        let payload = fs::read_to_string(path).map_err(|error| {
            ServiceError::storage(format!(
                "failed to read LanceDB retrieval diagnostics: {error}"
            ))
        })?;
        serde_json::from_str(&payload).map_err(|error| {
            ServiceError::storage(format!(
                "failed to parse LanceDB retrieval diagnostics: {error}"
            ))
        })
    }
}

#[derive(Clone)]
pub struct LanceDbRetrievalAdapter {
    projection: RetrievalProjectionRepository,
    manager: LanceDbIndexManager,
}

impl LanceDbRetrievalAdapter {
    pub fn new(
        database: &Database,
        database_dir: impl Into<PathBuf>,
        embedding_provider: Arc<dyn EmbeddingGenerator>,
    ) -> Result<Self, ServiceError> {
        Ok(Self {
            projection: RetrievalProjectionRepository::new(database),
            manager: LanceDbIndexManager::new(database_dir, embedding_provider)?,
        })
    }

    pub async fn rebuild_full(&self) -> Result<LanceDbIndexDiagnostics, ServiceError> {
        let candidates = self.projection.enumerate_active_chunks().await?;
        let connection = self.manager.connection().await?;
        let _ = connection.drop_table(LANCEDB_TABLE_NAME, &[]).await;
        let table = if candidates.is_empty() {
            connection
                .create_empty_table(
                    LANCEDB_TABLE_NAME,
                    lancedb_schema(self.manager.dimensions()),
                )
                .execute()
                .await
                .map_err(lancedb_error(
                    "failed to create empty LanceDB retrieval table",
                ))?
        } else {
            let data = self.record_batch_for_candidates(&candidates)?;
            connection
                .create_table(LANCEDB_TABLE_NAME, data)
                .execute()
                .await
                .map_err(lancedb_error("failed to rebuild LanceDB retrieval table"))?
        };
        drop(table);
        self.projection.plan_full_rebuild().await?;
        let diagnostics = self.diagnostics_for_count(candidates.len(), Some(timestamp()));
        self.manager.write_diagnostics(&diagnostics)?;
        Ok(diagnostics)
    }

    pub async fn upsert_incremental(&self) -> Result<LanceDbIndexDiagnostics, ServiceError> {
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
        let table = self.manager.open_or_create_table().await?;

        for candidate in &candidates {
            let key = doc_key(
                &candidate.identity.source_kind,
                &candidate.identity.source_id,
                &candidate.identity.chunk_ref,
                &candidate.identity.projection_version,
            );
            delete_doc_key(&table, &key).await?;
        }

        for stored in self.projection.list_stored_chunks().await? {
            let key = doc_key(
                &stored.source_kind,
                &stored.source_id,
                &stored.chunk_ref,
                &stored.projection_version,
            );
            if stored.is_deleted || !active_keys.contains(&key) {
                delete_doc_key(&table, &key).await?;
            }
        }

        if !candidates.is_empty() {
            let data = self.record_batch_for_candidates(&candidates)?;
            table
                .add(data)
                .execute()
                .await
                .map_err(lancedb_error("failed to upsert LanceDB retrieval vectors"))?;
        }

        let diagnostics = self.diagnostics_for_count(candidates.len(), Some(timestamp()));
        self.manager.write_diagnostics(&diagnostics)?;
        debug_assert_eq!(diagnostics.chunk_count, stored_plan.active_chunks);
        Ok(diagnostics)
    }

    pub async fn search(
        &self,
        request: &LanceDbSearchRequest,
    ) -> Result<LanceDbSearchResult, ServiceError> {
        let query_text = request.query.trim();
        if query_text.is_empty() || request.limit == 0 {
            return Ok(LanceDbSearchResult {
                candidates: Vec::new(),
            });
        }
        let table = match self.manager.open_or_create_table().await {
            Ok(table) => table,
            Err(_) => {
                return Ok(LanceDbSearchResult {
                    candidates: Vec::new(),
                })
            }
        };
        let query_vector = self.manager.embed_query(query_text)?;
        let source_filter = request
            .source_kinds
            .iter()
            .map(|source| source.as_str())
            .collect::<HashSet<_>>();
        let search_limit = request
            .limit
            .saturating_mul(DEFAULT_SEARCH_OVERSAMPLE)
            .max(request.limit);
        let batches = table
            .query()
            .limit(search_limit)
            .nearest_to(query_vector.as_slice())
            .map_err(lancedb_error("failed to build LanceDB vector query"))?
            .execute()
            .await
            .map_err(lancedb_error("failed to search LanceDB vectors"))?
            .try_collect::<Vec<_>>()
            .await
            .map_err(lancedb_error("failed to collect LanceDB vector results"))?;
        let mut candidates = Vec::new();
        for batch in batches {
            for row in 0..batch.num_rows() {
                let candidate = candidate_from_batch(&batch, row)?;
                if !source_filter.is_empty()
                    && !source_filter.contains(candidate.source_kind.as_str())
                {
                    continue;
                }
                candidates.push(candidate);
                if candidates.len() >= request.limit {
                    return Ok(LanceDbSearchResult { candidates });
                }
            }
        }
        Ok(LanceDbSearchResult { candidates })
    }

    pub fn diagnostics(&self) -> Result<LanceDbIndexDiagnostics, ServiceError> {
        self.manager.diagnostics()
    }

    fn record_batch_for_candidates(
        &self,
        candidates: &[RetrievalProjectionCandidate],
    ) -> Result<impl IntoArrow, ServiceError> {
        let inputs = candidates
            .iter()
            .map(embedding_input)
            .collect::<Result<Vec<_>, _>>()?;
        let embeddings = self.manager.embed_texts(&inputs)?;
        let dimensions = self.manager.dimensions();
        let schema = lancedb_schema(dimensions);
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from_iter_values(candidates.iter().map(
                    |candidate| {
                        doc_key(
                            &candidate.identity.source_kind,
                            &candidate.identity.source_id,
                            &candidate.identity.chunk_ref,
                            &candidate.identity.projection_version,
                        )
                    },
                ))),
                Arc::new(StringArray::from_iter_values(
                    candidates
                        .iter()
                        .map(|candidate| candidate.identity.source_kind.as_str()),
                )),
                Arc::new(StringArray::from_iter_values(
                    candidates
                        .iter()
                        .map(|candidate| candidate.identity.source_id.as_str()),
                )),
                Arc::new(StringArray::from_iter_values(
                    candidates
                        .iter()
                        .map(|candidate| candidate.identity.chunk_ref.as_str()),
                )),
                Arc::new(StringArray::from_iter_values(
                    candidates
                        .iter()
                        .map(|candidate| candidate.identity.content_digest.as_str()),
                )),
                Arc::new(StringArray::from_iter_values(
                    candidates
                        .iter()
                        .map(|candidate| candidate.identity.projection_version.as_str()),
                )),
                Arc::new(StringArray::from_iter_values(
                    std::iter::repeat(self.manager.provider_id()).take(candidates.len()),
                )),
                Arc::new(StringArray::from_iter_values(
                    std::iter::repeat(self.manager.model_id()).take(candidates.len()),
                )),
                Arc::new(
                    FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
                        embeddings.iter().map(|embedding| {
                            Some(embedding.iter().copied().map(Some).collect::<Vec<_>>())
                        }),
                        dimensions as i32,
                    ),
                ),
            ],
        )
        .map_err(|error| {
            ServiceError::storage(format!("failed to build LanceDB retrieval batch: {error}"))
        })?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)].into_iter(), schema);
        Ok(Box::new(reader))
    }

    fn diagnostics_for_count(
        &self,
        count: usize,
        last_rebuild: Option<String>,
    ) -> LanceDbIndexDiagnostics {
        LanceDbIndexDiagnostics {
            document_count: count,
            chunk_count: count,
            index_version: LANCEDB_INDEX_VERSION.to_string(),
            projection_version: RETRIEVAL_PROJECTION_VERSION.to_string(),
            embedding_provider_id: self.manager.provider_id().to_string(),
            embedding_model_id: self.manager.model_id().to_string(),
            embedding_dimensions: self.manager.dimensions(),
            last_rebuild,
        }
    }
}

fn lancedb_schema(dimensions: usize) -> SchemaRef {
    Arc::new(Schema::new(vec![
        Field::new("doc_key", DataType::Utf8, false),
        Field::new("source_kind", DataType::Utf8, false),
        Field::new("source_id", DataType::Utf8, false),
        Field::new("chunk_ref", DataType::Utf8, false),
        Field::new("content_digest", DataType::Utf8, false),
        Field::new("projection_version", DataType::Utf8, false),
        Field::new("embedding_provider_id", DataType::Utf8, false),
        Field::new("embedding_model_id", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                dimensions as i32,
            ),
            false,
        ),
    ]))
}

fn embedding_input(candidate: &RetrievalProjectionCandidate) -> Result<String, ServiceError> {
    reject_embedding_payload(Some(&candidate.content))?;
    reject_embedding_payload(candidate.title.as_deref())?;
    reject_embedding_payload(candidate.metadata_json.as_deref())?;
    Ok([
        candidate.title.as_deref().unwrap_or(""),
        candidate.content.as_str(),
    ]
    .into_iter()
    .filter(|part| !part.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n\n"))
}

fn validate_embedding(embedding: &[f32], dimensions: usize) -> Result<(), ServiceError> {
    if embedding.len() != dimensions {
        return Err(ServiceError::storage(format!(
            "embedding dimension mismatch: expected {dimensions}, got {}",
            embedding.len()
        )));
    }
    if embedding.iter().any(|value| !value.is_finite()) {
        return Err(ServiceError::storage(
            "embedding provider returned non-finite vector value",
        ));
    }
    Ok(())
}

async fn delete_doc_key(table: &LanceDbTable, key: &str) -> Result<(), ServiceError> {
    table
        .delete(&format!("doc_key = '{}'", escape_lancedb_literal(key)))
        .await
        .map_err(lancedb_error("failed to delete LanceDB retrieval vector"))
        .map(|_| ())
}

fn candidate_from_batch(
    batch: &RecordBatch,
    row: usize,
) -> Result<LanceDbSearchCandidate, ServiceError> {
    let distance = distance_at(batch, row)?;
    Ok(LanceDbSearchCandidate {
        source_kind: string_at(batch, "source_kind", row)?,
        source_id: string_at(batch, "source_id", row)?,
        chunk_ref: string_at(batch, "chunk_ref", row)?,
        content_digest: string_at(batch, "content_digest", row)?,
        projection_version: string_at(batch, "projection_version", row)?,
        vector_score: 1.0 / (1.0 + distance.max(0.0)),
        vector_distance: distance,
        embedding_provider_id: string_at(batch, "embedding_provider_id", row)?,
        embedding_model_id: string_at(batch, "embedding_model_id", row)?,
    })
}

fn string_at(batch: &RecordBatch, column: &str, row: usize) -> Result<String, ServiceError> {
    let values = batch
        .column_by_name(column)
        .and_then(|array| array.as_any().downcast_ref::<StringArray>())
        .ok_or_else(|| ServiceError::storage(format!("LanceDB result missing {column}")))?;
    if values.is_null(row) {
        return Err(ServiceError::storage(format!(
            "LanceDB result has null {column}"
        )));
    }
    Ok(values.value(row).to_string())
}

fn distance_at(batch: &RecordBatch, row: usize) -> Result<f32, ServiceError> {
    let Some(values) = batch.column_by_name("_distance") else {
        return Ok(0.0);
    };
    if let Some(values) = values.as_any().downcast_ref::<Float32Array>() {
        return Ok(values.value(row));
    }
    if let Some(values) = values.as_any().downcast_ref::<Float64Array>() {
        return Ok(values.value(row) as f32);
    }
    Err(ServiceError::storage(
        "LanceDB result has unsupported _distance type",
    ))
}

fn doc_key(
    source_kind: &str,
    source_id: &str,
    chunk_ref: &str,
    projection_version: &str,
) -> String {
    format!("{source_kind}\u{1f}{source_id}\u{1f}{chunk_ref}\u{1f}{projection_version}")
}

fn escape_lancedb_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn lancedb_error(context: &'static str) -> impl FnOnce(lancedb::Error) -> ServiceError {
    move |error| ServiceError::storage(format!("{context}: {error}"))
}

fn reject_embedding_payload(payload: Option<&str>) -> Result<(), ServiceError> {
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
                "LanceDB retrieval payload contains forbidden marker {forbidden}"
            )));
        }
    }
    Ok(())
}

#[allow(dead_code)]
fn _assert_lancedb_path_is_projection_only(path: &Path) -> bool {
    path.ends_with("lancedb") || path.exists()
}

#[cfg(test)]
mod tests {
    use super::{
        EmbeddingGenerator, LanceDbRetrievalAdapter, LanceDbSearchRequest, LANCEDB_INDEX_VERSION,
    };
    use crate::storage::db::{test_database, Database};
    use sqlx::Row;
    use std::sync::Arc;

    #[derive(Debug, Clone)]
    struct DeterministicFakeEmbeddingProvider {
        dimensions: usize,
    }

    impl DeterministicFakeEmbeddingProvider {
        fn new(dimensions: usize) -> Self {
            Self { dimensions }
        }
    }

    impl EmbeddingGenerator for DeterministicFakeEmbeddingProvider {
        fn provider_id(&self) -> &str {
            "deterministic-fake"
        }

        fn model_id(&self) -> &str {
            "fake-semantic-v1"
        }

        fn dimensions(&self) -> usize {
            self.dimensions
        }

        fn embed_texts(
            &self,
            inputs: &[String],
        ) -> Result<Vec<Vec<f32>>, crate::error::ServiceError> {
            inputs
                .iter()
                .map(|input| Ok(fake_embedding(input, self.dimensions)))
                .collect()
        }
    }

    #[test]
    fn fake_embedding_provider_is_deterministic() {
        let provider = DeterministicFakeEmbeddingProvider::new(16);
        let first = provider
            .embed_query("semantic apple")
            .expect("first embedding");
        let second = provider
            .embed_query("semantic apple")
            .expect("second embedding");
        let different = provider
            .embed_query("different banana")
            .expect("different embedding");
        assert_eq!(first, second);
        assert_ne!(first, different);
        assert_eq!(first.len(), 16);
    }

    #[tokio::test]
    async fn initializes_empty_lancedb_index_and_diagnostics() {
        let fixture = Fixture::empty().await;
        let adapter = fixture.adapter();
        let diagnostics = adapter.rebuild_full().await.expect("rebuild empty");
        assert_eq!(diagnostics.document_count, 0);
        assert_eq!(diagnostics.chunk_count, 0);
        assert_eq!(diagnostics.index_version, LANCEDB_INDEX_VERSION);
        assert_eq!(
            diagnostics.projection_version,
            "sqlite-retrieval-projection-v1"
        );
        assert_eq!(diagnostics.embedding_provider_id, "deterministic-fake");
        assert_eq!(diagnostics.embedding_model_id, "fake-semantic-v1");
        assert_eq!(diagnostics.embedding_dimensions, 24);
        assert!(diagnostics.last_rebuild.is_some());
        assert_eq!(adapter.diagnostics().expect("diagnostics"), diagnostics);
    }

    #[tokio::test]
    async fn full_rebuild_indexes_all_projection_candidates() {
        let fixture = Fixture::seed().await;
        let adapter = fixture.adapter();
        let diagnostics = adapter.rebuild_full().await.expect("rebuild");
        assert_eq!(diagnostics.chunk_count, 6);

        let result = adapter
            .search(&LanceDbSearchRequest::semantic("projection content"))
            .await
            .expect("search");
        let mut kinds = result
            .candidates
            .iter()
            .map(|candidate| candidate.source_kind.as_str())
            .collect::<Vec<_>>();
        kinds.sort_unstable();
        kinds.dedup();
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
    async fn rebuild_from_empty_is_reproducible() {
        let fixture = Fixture::seed_response_only().await;
        let adapter = fixture.adapter();
        let first = adapter.rebuild_full().await.expect("first rebuild");
        let first_results = adapter
            .search(&LanceDbSearchRequest::semantic("original semantic"))
            .await
            .expect("first search")
            .candidates;
        let second = adapter.rebuild_full().await.expect("second rebuild");
        let second_results = adapter
            .search(&LanceDbSearchRequest::semantic("original semantic"))
            .await
            .expect("second search")
            .candidates;
        assert_eq!(first.chunk_count, second.chunk_count);
        assert_eq!(first_results, second_results);
    }

    #[tokio::test]
    async fn incremental_upsert_replaces_changed_vectors() {
        let fixture = Fixture::seed_response_only().await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        assert_eq!(
            adapter
                .search(&LanceDbSearchRequest::semantic("original apple"))
                .await
                .expect("original search")
                .candidates[0]
                .source_id,
            "resp-a"
        );

        sqlx::query(
            "UPDATE responses SET content = 'updated banana semantic vector content', updated_at = '2'
             WHERE response_id = 'resp-a'",
        )
        .execute(fixture.database.pool())
        .await
        .expect("update response");

        adapter.upsert_incremental().await.expect("incremental");
        let candidate = adapter
            .search(&LanceDbSearchRequest::semantic("updated banana"))
            .await
            .expect("updated search")
            .candidates
            .into_iter()
            .next()
            .expect("candidate");
        assert_eq!(candidate.source_id, "resp-a");
        assert_ne!(candidate.content_digest, "missing");
    }

    #[tokio::test]
    async fn tombstone_delete_removes_lancedb_vector() {
        let fixture = Fixture::seed_response_only().await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        sqlx::query("UPDATE responses SET is_deleted = 1 WHERE response_id = 'resp-a'")
            .execute(fixture.database.pool())
            .await
            .expect("delete response");
        adapter.upsert_incremental().await.expect("incremental");
        let result = adapter
            .search(&LanceDbSearchRequest::semantic("original apple"))
            .await
            .expect("search");
        assert!(result.candidates.is_empty());
    }

    #[tokio::test]
    async fn vector_search_preserves_projection_identity_and_embedding_metadata() {
        let fixture = Fixture::seed_response_only().await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        let result = adapter
            .search(&LanceDbSearchRequest::semantic("original apple semantic"))
            .await
            .expect("search");
        assert_eq!(result.candidates.len(), 1);
        let candidate = &result.candidates[0];
        assert_eq!(candidate.source_kind, "response");
        assert_eq!(candidate.source_id, "resp-a");
        assert_eq!(candidate.chunk_ref, "response:resp-a:content");
        assert_eq!(
            candidate.projection_version,
            "sqlite-retrieval-projection-v1"
        );
        assert!(candidate.vector_score > 0.0);
        assert!(candidate.vector_distance >= 0.0);
        assert_eq!(candidate.embedding_provider_id, "deterministic-fake");
        assert_eq!(candidate.embedding_model_id, "fake-semantic-v1");
    }

    #[tokio::test]
    async fn source_filtering_limits_semantic_candidates() {
        let fixture = Fixture::seed().await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        let mut request = LanceDbSearchRequest::semantic("projection content");
        request.source_kinds = vec!["memory".to_string()];
        let result = adapter.search(&request).await.expect("filtered search");
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].source_kind, "memory");
    }

    #[tokio::test]
    async fn privacy_exclusion_blocks_raw_thinking_and_agent_events() {
        let fixture = Fixture::seed_response_only().await;
        seed_agent_event_noise(&fixture.database).await;
        let adapter = fixture.adapter();
        adapter.rebuild_full().await.expect("rebuild");
        let event_noise_results = adapter
            .search(&LanceDbSearchRequest::semantic("agent event text"))
            .await
            .expect("agent event search");
        assert!(event_noise_results.candidates.iter().all(|candidate| {
            candidate.source_kind != "agent_run" && candidate.source_kind != "agent_event"
        }));

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

    #[test]
    fn no_ollama_only_embedding_dependency_is_introduced() {
        let cargo_toml = include_str!("../../Cargo.toml");
        assert!(cargo_toml.contains("lancedb"));
        assert!(!cargo_toml.contains("fastembed"));
        assert!(!cargo_toml.contains("sentence-transformers"));
        assert!(!cargo_toml.contains("nomic-embed-text"));
        assert!(!cargo_toml.contains("ollama-embedding"));
    }

    struct Fixture {
        database: Database,
        index_dir: std::path::PathBuf,
    }

    impl Fixture {
        async fn empty() -> Self {
            let database = test_database().await;
            let index_dir =
                std::env::temp_dir().join(format!("loom-lancedb-test-{}", uuid::Uuid::new_v4()));
            Self {
                database,
                index_dir,
            }
        }

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
            let fixture = Self::empty().await;
            seed_loom(&fixture.database, "loom-a").await;
            seed_response(
                &fixture.database,
                "resp-a",
                "loom-a",
                "original apple semantic vector projection content",
                0,
                0,
            )
            .await;
            fixture
        }

        fn adapter(&self) -> LanceDbRetrievalAdapter {
            LanceDbRetrievalAdapter::new(
                &self.database,
                &self.index_dir,
                Arc::new(DeterministicFakeEmbeddingProvider::new(24)),
            )
            .expect("adapter")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.index_dir);
        }
    }

    fn fake_embedding(input: &str, dimensions: usize) -> Vec<f32> {
        let mut vector = vec![0.001f32; dimensions];
        for token in input
            .split(|character: char| !character.is_ascii_alphanumeric())
            .filter(|token| !token.is_empty())
            .map(str::to_ascii_lowercase)
        {
            let mut hash = 0usize;
            for byte in token.as_bytes() {
                hash = hash.wrapping_mul(31).wrapping_add(*byte as usize);
            }
            vector[hash % dimensions] += 1.0;
            vector[(hash / dimensions.max(1)) % dimensions] += 0.25;
        }
        let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
        if norm > 0.0 {
            for value in &mut vector {
                *value /= norm;
            }
        }
        vector
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
