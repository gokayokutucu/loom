#![allow(dead_code)]

use crate::{
    error::ServiceError,
    storage::{
        db::Database,
        repositories::{
            code_blocks::{list_code_blocks_by_response, ResponseCodeBlockRecord},
            responses::ResponseRecord,
        },
    },
};
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, BTreeSet};

const SAME_TOPIC_LINK_CAP: usize = 5;
const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

const KNOWN_TERMS: &[(&str, &str)] = &[
    ("Event Sourcing", "architecture"),
    ("Event Store", "architecture"),
    ("CQRS", "acronym"),
    ("DDD", "acronym"),
    ("Replay", "architecture"),
    ("Snapshot", "architecture"),
    ("CRUD", "acronym"),
    ("Graph", "architecture"),
    ("Electron", "technology"),
    ("IPC", "acronym"),
    ("MCP", "acronym"),
    ("API", "acronym"),
    ("CLI", "acronym"),
    ("SQLite", "technology"),
    ("PostgreSQL", "technology"),
    ("Ollama", "technology"),
    ("Rust", "technology"),
    ("TypeScript", "technology"),
];

#[derive(Debug, Clone, PartialEq)]
pub struct ResponseTagRecord {
    pub tag_id: String,
    pub response_id: String,
    pub loom_id: String,
    pub tag: String,
    pub normalized_tag: String,
    pub tag_kind: String,
    pub confidence: Option<f64>,
    pub source: String,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewResponseTag {
    pub tag: String,
    pub normalized_tag: String,
    pub tag_kind: String,
    pub confidence: f64,
    pub source: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LoomTopicRecord {
    pub topic_id: String,
    pub loom_id: String,
    pub topic: String,
    pub normalized_topic: String,
    pub first_response_id: Option<String>,
    pub latest_response_id: Option<String>,
    pub weight: Option<f64>,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ContextGraphLinkRecord {
    pub link_id: String,
    pub loom_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub link_kind: String,
    pub weight: Option<f64>,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewContextGraphLink {
    pub source_kind: String,
    pub source_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub link_kind: String,
    pub weight: f64,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResponseTagRepository {
    pool: SqlitePool,
}

impl ResponseTagRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn replace_for_response(
        &self,
        response_id: &str,
        loom_id: &str,
        tags: Vec<NewResponseTag>,
    ) -> Result<Vec<ResponseTagRecord>, ServiceError> {
        replace_tags_for_response(&self.pool, response_id, loom_id, tags).await?;
        self.list_by_response(response_id).await
    }

    pub async fn list_by_response(
        &self,
        response_id: &str,
    ) -> Result<Vec<ResponseTagRecord>, ServiceError> {
        list_tags_by_response(&self.pool, response_id).await
    }

    pub async fn list_by_loom(
        &self,
        loom_id: &str,
    ) -> Result<Vec<ResponseTagRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM response_tags
             WHERE loom_id = ?1
             ORDER BY created_at ASC, tag ASC",
        )
        .bind(loom_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(tag_from_row).collect())
        .map_err(|error| ServiceError::storage(format!("failed to list Response tags: {error}")))
    }

    pub async fn find_by_tag(
        &self,
        loom_id: &str,
        normalized_tag: &str,
    ) -> Result<Vec<ResponseTagRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM response_tags
             WHERE loom_id = ?1 AND normalized_tag = ?2
             ORDER BY created_at ASC, response_id ASC",
        )
        .bind(loom_id)
        .bind(normalized_tag)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(tag_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to find Response tags by tag: {error}"))
        })
    }
}

#[derive(Debug, Clone)]
pub struct TopicIndexRepository {
    pool: SqlitePool,
}

impl TopicIndexRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn upsert_topic(
        &self,
        loom_id: &str,
        topic: &str,
        response_id: &str,
        weight: f64,
    ) -> Result<(), ServiceError> {
        upsert_topic(&self.pool, loom_id, topic, response_id, weight).await
    }

    pub async fn list_topics_for_loom(
        &self,
        loom_id: &str,
    ) -> Result<Vec<LoomTopicRecord>, ServiceError> {
        list_topics_for_loom(&self.pool, loom_id).await
    }

    pub async fn get_topic(
        &self,
        loom_id: &str,
        normalized_topic: &str,
    ) -> Result<Option<LoomTopicRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM loom_topic_index
             WHERE loom_id = ?1 AND normalized_topic = ?2
             LIMIT 1",
        )
        .bind(loom_id)
        .bind(normalized_topic)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(topic_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to get Loom topic: {error}")))
    }
}

#[derive(Debug, Clone)]
pub struct ContextGraphLinkRepository {
    pool: SqlitePool,
}

impl ContextGraphLinkRepository {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool().clone(),
        }
    }

    pub async fn replace_links_for_response(
        &self,
        response_id: &str,
        links: Vec<NewContextGraphLink>,
    ) -> Result<(), ServiceError> {
        replace_links_for_response(&self.pool, response_id, links).await
    }

    pub async fn insert_links(
        &self,
        loom_id: &str,
        links: Vec<NewContextGraphLink>,
    ) -> Result<(), ServiceError> {
        insert_links(&self.pool, loom_id, links).await
    }

    pub async fn list_links_for_response(
        &self,
        response_id: &str,
    ) -> Result<Vec<ContextGraphLinkRecord>, ServiceError> {
        list_links_for_response(&self.pool, response_id).await
    }

    pub async fn list_links_for_loom(
        &self,
        loom_id: &str,
    ) -> Result<Vec<ContextGraphLinkRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM context_graph_links
             WHERE loom_id = ?1
             ORDER BY created_at ASC, link_id ASC",
        )
        .bind(loom_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(link_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list context graph links: {error}"))
        })
    }

    pub async fn list_neighbors(
        &self,
        loom_id: &str,
        source_kind: &str,
        source_id: &str,
    ) -> Result<Vec<ContextGraphLinkRecord>, ServiceError> {
        sqlx::query(
            "SELECT * FROM context_graph_links
             WHERE loom_id = ?1 AND source_kind = ?2 AND source_id = ?3
             ORDER BY weight DESC, created_at DESC",
        )
        .bind(loom_id)
        .bind(source_kind)
        .bind(source_id)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().map(link_from_row).collect())
        .map_err(|error| {
            ServiceError::storage(format!("failed to list context graph neighbors: {error}"))
        })
    }
}

pub async fn sync_response_tags_topics_and_links(
    pool: &SqlitePool,
    response_id: &str,
) -> Result<(), ServiceError> {
    let Some(response) = load_response(pool, response_id).await? else {
        return Ok(());
    };
    reject_forbidden_payload(Some(&response.content))?;
    reject_forbidden_payload(response.metadata_json.as_deref())?;

    let parts = list_response_parts(pool, response_id).await?;
    let code_blocks = list_code_blocks_by_response(pool, response_id).await?;
    let tags = extract_tags_for_response(&response, &parts, &code_blocks)?;
    replace_tags_for_response(pool, response_id, &response.loom_id, tags.clone()).await?;
    for tag in tags.iter().filter(|tag| {
        matches!(
            tag.tag_kind.as_str(),
            "topic" | "architecture" | "technology" | "domain" | "pattern" | "acronym"
        )
    }) {
        upsert_topic(
            pool,
            &response.loom_id,
            &tag.tag,
            response_id,
            tag.confidence,
        )
        .await?;
    }

    let links = derive_links_for_response(pool, &response, &tags, &code_blocks).await?;
    replace_links_for_response(pool, response_id, links).await
}

fn extract_tags_for_response(
    response: &ResponseRecord,
    parts: &[ResponsePartSummary],
    code_blocks: &[ResponseCodeBlockRecord],
) -> Result<Vec<NewResponseTag>, ServiceError> {
    reject_forbidden_payload(Some(&response.content))?;
    reject_forbidden_payload(response.metadata_json.as_deref())?;
    let mut tags: BTreeMap<String, NewResponseTag> = BTreeMap::new();
    let mut add = |tag: &str, tag_kind: &str, confidence: f64, reason: &str| {
        if let Some(normalized) = normalize_tag(tag) {
            let entry = tags
                .entry(normalized.clone())
                .or_insert_with(|| NewResponseTag {
                    tag: clean_tag_label(tag),
                    normalized_tag: normalized,
                    tag_kind: tag_kind.to_string(),
                    confidence,
                    source: "heuristic".to_string(),
                    metadata_json: Some(serde_json::json!({ "reason": reason }).to_string()),
                });
            if confidence > entry.confidence {
                entry.confidence = confidence;
                entry.tag_kind = tag_kind.to_string();
                entry.metadata_json = Some(serde_json::json!({ "reason": reason }).to_string());
            }
        }
    };

    if let Some(title) = response.title.as_deref() {
        add(title, "topic", 0.86, "response_title");
    }
    if let Some(code) = response.code.as_deref() {
        add(code, "technology", 0.82, "response_code");
    }

    let full_text = [
        response.title.as_deref().unwrap_or_default(),
        response.code.as_deref().unwrap_or_default(),
        &response.content,
    ]
    .join("\n");
    let lower = full_text.to_lowercase();
    for (term, kind) in KNOWN_TERMS {
        if lower.contains(&term.to_lowercase()) {
            add(term, kind, 0.9, "known_term");
        }
    }

    for acronym in extract_acronyms(&full_text) {
        add(&acronym, "acronym", 0.76, "uppercase_acronym");
    }

    for part in parts {
        reject_forbidden_payload(part.content.as_deref())?;
        reject_forbidden_payload(part.markdown.as_deref())?;
        let text = part
            .content
            .as_deref()
            .or(part.markdown.as_deref())
            .unwrap_or_default();
        match part.part_kind.as_str() {
            "heading" => {
                for phrase in heading_topic_candidates(text) {
                    add(&phrase, "topic", 0.78, "heading");
                }
                add_decision_risk_tags(text, &mut add);
            }
            "table" => {
                add("table", "unknown", 0.42, "table_part");
            }
            "warning" | "decision" | "example" => {
                add(&part.part_kind, &part.part_kind, 0.72, "part_kind");
                add_decision_risk_tags(text, &mut add);
            }
            "paragraph" | "list" | "quote" => add_decision_risk_tags(text, &mut add),
            _ => {}
        }
    }

    for code_block in code_blocks {
        reject_forbidden_payload(Some(&code_block.code))?;
        if let Some(language) = code_block.language.as_deref() {
            add(language, "code", 0.94, "code_block_language");
        }
    }

    if let Some(metadata) = response.metadata_json.as_deref() {
        add_reference_metadata_tags(metadata, &mut add)?;
        add_stale_metadata_tags(metadata, &mut add)?;
    }

    Ok(tags.into_values().collect())
}

async fn derive_links_for_response(
    pool: &SqlitePool,
    response: &ResponseRecord,
    tags: &[NewResponseTag],
    code_blocks: &[ResponseCodeBlockRecord],
) -> Result<Vec<NewContextGraphLink>, ServiceError> {
    let mut links = BTreeMap::<String, NewContextGraphLink>::new();
    let mut add = |link: NewContextGraphLink| {
        let key = link_key(&link);
        links.entry(key).or_insert(link);
    };

    if let Some(previous) = previous_response(pool, response).await? {
        add(link(
            "response",
            &previous.response_id,
            "response",
            &response.response_id,
            "follows",
            1.0,
            None,
        ));
    }
    if response.role == "assistant" {
        if let Some(user) = previous_user_response(pool, response).await? {
            add(link(
                "response",
                &user.response_id,
                "response",
                &response.response_id,
                "answers",
                1.0,
                None,
            ));
        }
    }
    for code_block in code_blocks {
        add(link(
            "code_block",
            &code_block.code_block_id,
            "response",
            &response.response_id,
            "code_for",
            0.86,
            Some(serde_json::json!({
                "language": code_block.language,
                "blockIndex": code_block.block_index
            })),
        ));
    }
    for reference in references_for_response(pool, &response.response_id).await? {
        let target_kind = reference
            .target_kind
            .unwrap_or_else(|| "reference".to_string());
        let target_id = reference
            .target_id
            .or(reference.target_uri)
            .unwrap_or(reference.reference_id);
        add(link(
            "response",
            &response.response_id,
            &target_kind,
            &target_id,
            "references",
            0.8,
            None,
        ));
    }
    for same_topic in same_topic_links(pool, response, tags).await? {
        add(same_topic);
    }
    if let Some(metadata) = response.metadata_json.as_deref() {
        for metadata_link in links_from_response_metadata(response, metadata)? {
            add(metadata_link);
        }
    }

    Ok(links.into_values().collect())
}

async fn replace_tags_for_response(
    pool: &SqlitePool,
    response_id: &str,
    loom_id: &str,
    tags: Vec<NewResponseTag>,
) -> Result<(), ServiceError> {
    let now = timestamp();
    let mut transaction = pool.begin().await.map_err(|error| {
        ServiceError::storage(format!("failed to start Response tag transaction: {error}"))
    })?;
    sqlx::query("DELETE FROM response_tags WHERE response_id = ?1")
        .bind(response_id)
        .execute(&mut transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to clear Response tags: {error}"))
        })?;
    for (index, tag) in tags.into_iter().enumerate() {
        reject_forbidden_payload(tag.metadata_json.as_deref())?;
        let tag_id = format!("tag-{response_id}-{index}-{}", safe_id(&tag.normalized_tag));
        sqlx::query(
            "INSERT INTO response_tags (
                tag_id, response_id, loom_id, tag, normalized_tag, tag_kind,
                confidence, source, metadata_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(tag_id)
        .bind(response_id)
        .bind(loom_id)
        .bind(tag.tag)
        .bind(tag.normalized_tag)
        .bind(tag.tag_kind)
        .bind(tag.confidence)
        .bind(tag.source)
        .bind(tag.metadata_json)
        .bind(&now)
        .execute(&mut transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert Response tag: {error}"))
        })?;
    }
    transaction.commit().await.map_err(|error| {
        ServiceError::storage(format!(
            "failed to commit Response tag transaction: {error}"
        ))
    })?;
    Ok(())
}

async fn upsert_topic(
    pool: &SqlitePool,
    loom_id: &str,
    topic: &str,
    response_id: &str,
    weight: f64,
) -> Result<(), ServiceError> {
    reject_forbidden_payload(Some(topic))?;
    let Some(normalized_topic) = normalize_tag(topic) else {
        return Ok(());
    };
    let now = timestamp();
    let topic_id = format!("topic-{loom_id}-{}", safe_id(&normalized_topic));
    sqlx::query(
        "INSERT INTO loom_topic_index (
            topic_id, loom_id, topic, normalized_topic, first_response_id,
            latest_response_id, weight, metadata_json, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?8)
        ON CONFLICT(loom_id, normalized_topic) DO UPDATE SET
            latest_response_id = excluded.latest_response_id,
            weight = COALESCE(loom_topic_index.weight, 0) + excluded.weight,
            updated_at = excluded.updated_at",
    )
    .bind(topic_id)
    .bind(loom_id)
    .bind(clean_tag_label(topic))
    .bind(normalized_topic)
    .bind(response_id)
    .bind(weight)
    .bind(serde_json::json!({ "source": "heuristic" }).to_string())
    .bind(now)
    .execute(pool)
    .await
    .map_err(|error| ServiceError::storage(format!("failed to upsert Loom topic: {error}")))?;
    Ok(())
}

async fn replace_links_for_response(
    pool: &SqlitePool,
    response_id: &str,
    links: Vec<NewContextGraphLink>,
) -> Result<(), ServiceError> {
    let Some(response) = load_response(pool, response_id).await? else {
        return Ok(());
    };
    sqlx::query(
        "DELETE FROM context_graph_links
         WHERE loom_id = ?1
           AND (
             (source_kind = 'response' AND source_id = ?2)
             OR (target_kind = 'response' AND target_id = ?2 AND link_kind IN ('answers', 'same_topic', 'stale_due_to', 'supersedes', 'code_for'))
             OR source_id IN (SELECT code_block_id FROM response_code_blocks WHERE response_id = ?2)
           )",
    )
    .bind(&response.loom_id)
    .bind(response_id)
    .execute(pool)
    .await
    .map_err(|error| {
        ServiceError::storage(format!("failed to clear context graph links: {error}"))
    })?;
    insert_links(pool, &response.loom_id, links).await
}

async fn insert_links(
    pool: &SqlitePool,
    loom_id: &str,
    links: Vec<NewContextGraphLink>,
) -> Result<(), ServiceError> {
    let now = timestamp();
    let mut transaction = pool.begin().await.map_err(|error| {
        ServiceError::storage(format!(
            "failed to start context graph link transaction: {error}"
        ))
    })?;
    for link in links {
        reject_forbidden_payload(link.metadata_json.as_deref())?;
        let link_id = format!(
            "link-{loom_id}-{}",
            safe_id(&format!(
                "{}-{}-{}-{}-{}",
                link.source_kind, link.source_id, link.link_kind, link.target_kind, link.target_id
            ))
        );
        sqlx::query(
            "INSERT OR REPLACE INTO context_graph_links (
                link_id, loom_id, source_kind, source_id, target_kind, target_id,
                link_kind, weight, metadata_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(link_id)
        .bind(loom_id)
        .bind(link.source_kind)
        .bind(link.source_id)
        .bind(link.target_kind)
        .bind(link.target_id)
        .bind(link.link_kind)
        .bind(link.weight)
        .bind(link.metadata_json)
        .bind(&now)
        .execute(&mut transaction)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to insert context graph link: {error}"))
        })?;
    }
    transaction.commit().await.map_err(|error| {
        ServiceError::storage(format!(
            "failed to commit context graph link transaction: {error}"
        ))
    })?;
    Ok(())
}

async fn same_topic_links(
    pool: &SqlitePool,
    response: &ResponseRecord,
    tags: &[NewResponseTag],
) -> Result<Vec<NewContextGraphLink>, ServiceError> {
    let important_tags = tags
        .iter()
        .filter(|tag| {
            matches!(
                tag.tag_kind.as_str(),
                "topic" | "architecture" | "technology" | "domain" | "pattern" | "acronym"
            )
        })
        .map(|tag| tag.normalized_tag.clone())
        .collect::<BTreeSet<_>>();
    if important_tags.is_empty() {
        return Ok(Vec::new());
    }

    let mut candidate_scores: BTreeMap<String, (f64, Vec<String>)> = BTreeMap::new();
    for tag in important_tags {
        let rows = sqlx::query(
            "SELECT response_id, tag
             FROM response_tags
             WHERE loom_id = ?1 AND normalized_tag = ?2 AND response_id != ?3",
        )
        .bind(&response.loom_id)
        .bind(&tag)
        .bind(&response.response_id)
        .fetch_all(pool)
        .await
        .map_err(|error| {
            ServiceError::storage(format!("failed to find same-topic candidates: {error}"))
        })?;
        for row in rows {
            let response_id: String = row.get("response_id");
            let tag_label: String = row.get("tag");
            let entry = candidate_scores
                .entry(response_id)
                .or_insert_with(|| (0.0, Vec::new()));
            entry.0 += 1.0;
            entry.1.push(tag_label);
        }
    }

    let mut candidates = candidate_scores.into_iter().collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .1
             .0
            .partial_cmp(&left.1 .0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.0.cmp(&left.0))
    });
    let capped = candidates.len() > SAME_TOPIC_LINK_CAP;
    Ok(candidates
        .into_iter()
        .take(SAME_TOPIC_LINK_CAP)
        .map(|(target_response_id, (weight, shared_tags))| {
            link(
                "response",
                &response.response_id,
                "response",
                &target_response_id,
                "same_topic",
                weight,
                Some(serde_json::json!({
                    "sharedTags": shared_tags,
                    "capped": capped
                })),
            )
        })
        .collect())
}

fn links_from_response_metadata(
    response: &ResponseRecord,
    metadata: &str,
) -> Result<Vec<NewContextGraphLink>, ServiceError> {
    reject_forbidden_payload(Some(metadata))?;
    let Ok(value) = serde_json::from_str::<serde_json::Value>(metadata) else {
        return Ok(Vec::new());
    };
    let mut links = Vec::new();
    if let Some(stale_source) = value
        .get("staleSourceResponseId")
        .and_then(serde_json::Value::as_str)
    {
        links.push(link(
            "response",
            stale_source,
            "response",
            &response.response_id,
            "stale_due_to",
            0.75,
            None,
        ));
    }
    if let Some(replaces) = value
        .get("replacesStaleResponseId")
        .and_then(serde_json::Value::as_str)
    {
        links.push(link(
            "response",
            &response.response_id,
            "response",
            replaces,
            "supersedes",
            0.8,
            None,
        ));
    }
    if let Some(origin) = value
        .get("originResponseId")
        .or_else(|| value.get("sourceResponseId"))
        .and_then(serde_json::Value::as_str)
    {
        links.push(link(
            "response",
            &response.response_id,
            "response",
            origin,
            "weft_origin",
            0.72,
            None,
        ));
    }
    Ok(links)
}

fn link(
    source_kind: &str,
    source_id: &str,
    target_kind: &str,
    target_id: &str,
    link_kind: &str,
    weight: f64,
    metadata: Option<serde_json::Value>,
) -> NewContextGraphLink {
    NewContextGraphLink {
        source_kind: source_kind.to_string(),
        source_id: source_id.to_string(),
        target_kind: target_kind.to_string(),
        target_id: target_id.to_string(),
        link_kind: link_kind.to_string(),
        weight,
        metadata_json: metadata.map(|value| value.to_string()),
    }
}

fn link_key(link: &NewContextGraphLink) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        link.source_kind, link.source_id, link.link_kind, link.target_kind, link.target_id
    )
}

fn add_reference_metadata_tags<F>(metadata: &str, add: &mut F) -> Result<(), ServiceError>
where
    F: FnMut(&str, &str, f64, &str),
{
    reject_forbidden_payload(Some(metadata))?;
    let Ok(value) = serde_json::from_str::<serde_json::Value>(metadata) else {
        return Ok(());
    };
    for key in [
        "sourceTitle",
        "sourceResponseTitle",
        "sourceResponseCode",
        "sourceCanonicalUri",
        "selectedText",
    ] {
        if let Some(text) = value.get(key).and_then(serde_json::Value::as_str) {
            for phrase in heading_topic_candidates(text) {
                add(&phrase, "topic", 0.62, "response_metadata");
            }
        }
    }
    Ok(())
}

fn add_stale_metadata_tags<F>(metadata: &str, add: &mut F) -> Result<(), ServiceError>
where
    F: FnMut(&str, &str, f64, &str),
{
    reject_forbidden_payload(Some(metadata))?;
    let Ok(value) = serde_json::from_str::<serde_json::Value>(metadata) else {
        return Ok(());
    };
    if value.get("stale").and_then(serde_json::Value::as_bool) == Some(true)
        || value.get("staleReason").is_some()
    {
        add("stale", "risk", 0.72, "stale_metadata");
    }
    Ok(())
}

fn add_decision_risk_tags<F>(text: &str, add: &mut F)
where
    F: FnMut(&str, &str, f64, &str),
{
    let lower = text.to_lowercase();
    if ["decision", "decided", "karar", "trade-off", "tradeoff"]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        add("decision", "decision", 0.7, "decision_keyword");
    }
    if ["risk", "warning", "blocker", "limitation", "uyarı", "kısıt"]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        add("risk", "risk", 0.7, "risk_keyword");
    }
}

fn heading_topic_candidates(text: &str) -> Vec<String> {
    let cleaned = strip_markdown_prefix(text);
    let words = cleaned
        .split_whitespace()
        .map(clean_word)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    if words.is_empty() {
        return Vec::new();
    }
    let phrase = words.iter().take(4).cloned().collect::<Vec<_>>().join(" ");
    if phrase.chars().count() >= 3 && !is_stop_phrase(&phrase) {
        vec![phrase]
    } else {
        Vec::new()
    }
}

fn extract_acronyms(text: &str) -> Vec<String> {
    let mut acronyms = BTreeSet::new();
    for token in text.split(|ch: char| !ch.is_alphanumeric()) {
        if (2..=8).contains(&token.chars().count())
            && token.chars().any(|ch| ch.is_ascii_alphabetic())
            && token
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
        {
            acronyms.insert(token.to_string());
        }
    }
    acronyms.into_iter().collect()
}

fn normalize_tag(value: &str) -> Option<String> {
    let normalized = value
        .split_whitespace()
        .map(clean_word)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    if normalized.is_empty() || is_stop_phrase(&normalized) {
        None
    } else {
        Some(normalized)
    }
}

fn clean_tag_label(value: &str) -> String {
    value
        .split_whitespace()
        .map(clean_word)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_markdown_prefix(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('#')
        .trim_start_matches('>')
        .trim_start_matches('-')
        .trim_start_matches('*')
        .trim()
        .to_string()
}

fn clean_word(value: &str) -> String {
    value
        .trim_matches(|ch: char| {
            ch.is_ascii_punctuation() || matches!(ch, '“' | '”' | '‘' | '’' | '…' | '|' | ':' | ';')
        })
        .to_string()
}

fn is_stop_phrase(value: &str) -> bool {
    matches!(
        value,
        "the"
            | "and"
            | "or"
            | "with"
            | "without"
            | "bir"
            | "ve"
            | "veya"
            | "ile"
            | "için"
            | "nedir"
            | "summary"
            | "table"
    )
}

async fn load_response(
    pool: &SqlitePool,
    response_id: &str,
) -> Result<Option<ResponseRecord>, ServiceError> {
    sqlx::query("SELECT * FROM responses WHERE response_id = ?1 LIMIT 1")
        .bind(response_id)
        .fetch_optional(pool)
        .await
        .map(|row| row.map(response_from_row))
        .map_err(|error| ServiceError::storage(format!("failed to load Response: {error}")))
}

async fn previous_response(
    pool: &SqlitePool,
    response: &ResponseRecord,
) -> Result<Option<ResponseRecord>, ServiceError> {
    sqlx::query(
        "SELECT * FROM responses
         WHERE loom_id = ?1 AND sequence_index < ?2
         ORDER BY sequence_index DESC
         LIMIT 1",
    )
    .bind(&response.loom_id)
    .bind(response.sequence_index)
    .fetch_optional(pool)
    .await
    .map(|row| row.map(response_from_row))
    .map_err(|error| ServiceError::storage(format!("failed to load previous Response: {error}")))
}

async fn previous_user_response(
    pool: &SqlitePool,
    response: &ResponseRecord,
) -> Result<Option<ResponseRecord>, ServiceError> {
    sqlx::query(
        "SELECT * FROM responses
         WHERE loom_id = ?1 AND sequence_index < ?2 AND role = 'user'
         ORDER BY sequence_index DESC
         LIMIT 1",
    )
    .bind(&response.loom_id)
    .bind(response.sequence_index)
    .fetch_optional(pool)
    .await
    .map(|row| row.map(response_from_row))
    .map_err(|error| {
        ServiceError::storage(format!("failed to load previous user Response: {error}"))
    })
}

async fn list_response_parts(
    pool: &SqlitePool,
    response_id: &str,
) -> Result<Vec<ResponsePartSummary>, ServiceError> {
    sqlx::query(
        "SELECT part_kind, content, markdown, code_block_id
         FROM response_parts
         WHERE response_id = ?1
         ORDER BY sequence_index ASC",
    )
    .bind(response_id)
    .fetch_all(pool)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| ResponsePartSummary {
                part_kind: row.get("part_kind"),
                content: row.get("content"),
                markdown: row.get("markdown"),
                code_block_id: row.get("code_block_id"),
            })
            .collect()
    })
    .map_err(|error| ServiceError::storage(format!("failed to list Response parts: {error}")))
}

#[derive(Debug, Clone)]
struct ResponsePartSummary {
    part_kind: String,
    content: Option<String>,
    markdown: Option<String>,
    code_block_id: Option<String>,
}

#[derive(Debug, Clone)]
struct ReferenceSummary {
    reference_id: String,
    target_kind: Option<String>,
    target_id: Option<String>,
    target_uri: Option<String>,
}

async fn references_for_response(
    pool: &SqlitePool,
    response_id: &str,
) -> Result<Vec<ReferenceSummary>, ServiceError> {
    sqlx::query(
        "SELECT reference_id, target_kind, target_id, target_uri
         FROM \"references\"
         WHERE source_response_id = ?1",
    )
    .bind(response_id)
    .fetch_all(pool)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| ReferenceSummary {
                reference_id: row.get("reference_id"),
                target_kind: row.get("target_kind"),
                target_id: row.get("target_id"),
                target_uri: row.get("target_uri"),
            })
            .collect()
    })
    .map_err(|error| ServiceError::storage(format!("failed to list Response references: {error}")))
}

fn response_from_row(row: sqlx::sqlite::SqliteRow) -> ResponseRecord {
    ResponseRecord {
        response_id: row.get("response_id"),
        loom_id: row.get("loom_id"),
        role: row.get("role"),
        content: row.get("content"),
        title: row.get("title"),
        code: row.get("code"),
        canonical_uri: row.get("canonical_uri"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        sequence_index: row.get("sequence_index"),
        metadata_json: row.get("metadata_json"),
    }
}

async fn list_tags_by_response(
    pool: &SqlitePool,
    response_id: &str,
) -> Result<Vec<ResponseTagRecord>, ServiceError> {
    sqlx::query(
        "SELECT * FROM response_tags
         WHERE response_id = ?1
         ORDER BY tag ASC",
    )
    .bind(response_id)
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(tag_from_row).collect())
    .map_err(|error| ServiceError::storage(format!("failed to list Response tags: {error}")))
}

async fn list_topics_for_loom(
    pool: &SqlitePool,
    loom_id: &str,
) -> Result<Vec<LoomTopicRecord>, ServiceError> {
    sqlx::query(
        "SELECT * FROM loom_topic_index
         WHERE loom_id = ?1
         ORDER BY weight DESC, topic ASC",
    )
    .bind(loom_id)
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(topic_from_row).collect())
    .map_err(|error| ServiceError::storage(format!("failed to list Loom topics: {error}")))
}

async fn list_links_for_response(
    pool: &SqlitePool,
    response_id: &str,
) -> Result<Vec<ContextGraphLinkRecord>, ServiceError> {
    sqlx::query(
        "SELECT * FROM context_graph_links
         WHERE source_id = ?1 OR target_id = ?1
         ORDER BY link_kind ASC, created_at ASC",
    )
    .bind(response_id)
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(link_from_row).collect())
    .map_err(|error| {
        ServiceError::storage(format!(
            "failed to list context graph links for Response: {error}"
        ))
    })
}

fn tag_from_row(row: sqlx::sqlite::SqliteRow) -> ResponseTagRecord {
    ResponseTagRecord {
        tag_id: row.get("tag_id"),
        response_id: row.get("response_id"),
        loom_id: row.get("loom_id"),
        tag: row.get("tag"),
        normalized_tag: row.get("normalized_tag"),
        tag_kind: row.get("tag_kind"),
        confidence: row.get("confidence"),
        source: row.get("source"),
        metadata_json: row.get("metadata_json"),
        created_at: row.get("created_at"),
    }
}

fn topic_from_row(row: sqlx::sqlite::SqliteRow) -> LoomTopicRecord {
    LoomTopicRecord {
        topic_id: row.get("topic_id"),
        loom_id: row.get("loom_id"),
        topic: row.get("topic"),
        normalized_topic: row.get("normalized_topic"),
        first_response_id: row.get("first_response_id"),
        latest_response_id: row.get("latest_response_id"),
        weight: row.get("weight"),
        metadata_json: row.get("metadata_json"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn link_from_row(row: sqlx::sqlite::SqliteRow) -> ContextGraphLinkRecord {
    ContextGraphLinkRecord {
        link_id: row.get("link_id"),
        loom_id: row.get("loom_id"),
        source_kind: row.get("source_kind"),
        source_id: row.get("source_id"),
        target_kind: row.get("target_kind"),
        target_id: row.get("target_id"),
        link_kind: row.get("link_kind"),
        weight: row.get("weight"),
        metadata_json: row.get("metadata_json"),
        created_at: row.get("created_at"),
    }
}

fn safe_id(value: &str) -> String {
    let safe = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if safe.is_empty() {
        "unknown".to_string()
    } else {
        safe
    }
}

fn reject_forbidden_payload(payload: Option<&str>) -> Result<(), ServiceError> {
    let Some(payload) = payload else {
        return Ok(());
    };
    for forbidden in FORBIDDEN_THINKING_KEYS {
        if payload.contains(forbidden) {
            return Err(ServiceError::storage(format!(
                "forbidden raw thinking key is not allowed in derived context graph artifacts: {forbidden}"
            )));
        }
    }
    Ok(())
}

/// Removes stale `response_tags` rows with `tag_kind = 'code'` that were derived
/// from pseudo-artifact code blocks deleted by migration 0019.
///
/// Code-language tags are exclusively sourced from code block language headers via
/// `extract_tags_for_response` (`"code_block_language"` reason).  After migration 0019
/// deleted pseudo-artifact code blocks, the corresponding `'code'` kind tags became
/// orphaned.  This function is the Rust-level complement to migration 0021 and is
/// called at startup as defense-in-depth to catch any rows that the SQL migration did
/// not cover (e.g., blocks removed by `cleanup_pseudo_artifact_blocks` after startup).
///
/// Returns the number of orphaned tag rows deleted.
pub async fn cleanup_orphaned_code_language_tags(pool: &SqlitePool) -> Result<usize, ServiceError> {
    let result = sqlx::query(
        "DELETE FROM response_tags
         WHERE tag_kind = 'code'
           AND NOT EXISTS (
               SELECT 1 FROM response_code_blocks rcb
               WHERE rcb.response_id = response_tags.response_id
                 AND LOWER(COALESCE(rcb.language, '')) = response_tags.normalized_tag
           )",
    )
    .execute(pool)
    .await
    .map_err(|error| {
        ServiceError::storage(format!(
            "failed to clean orphaned code-language tags: {error}"
        ))
    })?;

    Ok(result.rows_affected() as usize)
}

fn timestamp() -> String {
    crate::capabilities::repository::timestamp()
}

#[cfg(test)]
mod tests {
    use super::{
        sync_response_tags_topics_and_links, ContextGraphLinkRepository, ResponseTagRepository,
        TopicIndexRepository, SAME_TOPIC_LINK_CAP,
    };
    use crate::storage::{
        db::test_database,
        repositories::{
            code_blocks::ResponseCodeBlockRepository,
            references::{NewReference, ReferenceRepository},
            responses::{NewResponse, ResponseRepository},
        },
    };

    #[tokio::test]
    async fn extracts_tags_from_headings_paragraphs_and_event_sourcing_terms() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(
            &database,
            "assistant-1",
            "assistant",
            1,
            "# Event Sourcing\n\nEvent Sourcing uses an Event Store, Replay, CQRS, DDD, Snapshot, and sometimes contrasts with CRUD.",
            None,
        )
        .await;

        let tags = ResponseTagRepository::new(&database)
            .list_by_response("assistant-1")
            .await
            .expect("tags");
        let normalized = tags
            .iter()
            .map(|tag| tag.normalized_tag.as_str())
            .collect::<Vec<_>>();

        assert!(normalized.contains(&"event sourcing"));
        assert!(normalized.contains(&"event store"));
        assert!(normalized.contains(&"cqrs"));
        assert!(normalized.contains(&"ddd"));
        assert!(normalized.contains(&"crud"));
    }

    #[tokio::test]
    async fn extracts_acronyms_and_code_block_language_tags() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(
            &database,
            "assistant-1",
            "assistant",
            1,
            "MCP and IPC integration:\n\n```rust\nfn main() {}\n```",
            None,
        )
        .await;

        let tags = ResponseTagRepository::new(&database)
            .list_by_response("assistant-1")
            .await
            .expect("tags");
        assert!(tags.iter().any(|tag| tag.normalized_tag == "mcp"));
        assert!(tags.iter().any(|tag| tag.normalized_tag == "ipc"));
        assert!(tags
            .iter()
            .any(|tag| tag.normalized_tag == "rust" && tag.tag_kind == "code"));
    }

    #[tokio::test]
    async fn topic_index_upserts_and_updates_latest_response() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(
            &database,
            "assistant-1",
            "assistant",
            1,
            "Event Sourcing overview.",
            None,
        )
        .await;
        insert_response(
            &database,
            "assistant-2",
            "assistant",
            2,
            "Event Sourcing trade-offs.",
            None,
        )
        .await;

        let topic = TopicIndexRepository::new(&database)
            .get_topic("loom-1", "event sourcing")
            .await
            .expect("topic query")
            .expect("topic");

        assert_eq!(topic.first_response_id.as_deref(), Some("assistant-1"));
        assert_eq!(topic.latest_response_id.as_deref(), Some("assistant-2"));
        assert!(topic.weight.unwrap_or_default() > 1.0);
    }

    #[tokio::test]
    async fn follows_answers_same_topic_and_code_links_are_created() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(
            &database,
            "user-1",
            "user",
            0,
            "Event Sourcing nedir?",
            None,
        )
        .await;
        insert_response(
            &database,
            "assistant-1",
            "assistant",
            1,
            "Event Sourcing uses an Event Store.",
            None,
        )
        .await;
        insert_response(
            &database,
            "assistant-2",
            "assistant",
            2,
            "Event Sourcing example:\n```ts\nconst event = {}\n```",
            None,
        )
        .await;

        let links = ContextGraphLinkRepository::new(&database)
            .list_links_for_loom("loom-1")
            .await
            .expect("links");

        assert!(links.iter().any(|link| link.link_kind == "follows"
            && link.source_id == "assistant-1"
            && link.target_id == "assistant-2"));
        assert!(links.iter().any(|link| link.link_kind == "answers"
            && link.source_id == "user-1"
            && link.target_id == "assistant-1"));
        assert!(links.iter().any(|link| link.link_kind == "same_topic"
            && link.source_id == "assistant-2"
            && link.target_id == "assistant-1"));
        assert!(links
            .iter()
            .any(|link| link.link_kind == "code_for" && link.target_id == "assistant-2"));
    }

    #[tokio::test]
    async fn reference_and_stale_metadata_links_are_created() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(&database, "user-1", "user", 0, "Prompt", None).await;
        insert_response(
            &database,
            "assistant-1",
            "assistant",
            1,
            "Answer",
            Some(r#"{"stale":true,"staleSourceResponseId":"user-1"}"#),
        )
        .await;
        ReferenceRepository::new(&database)
            .insert_reference(&NewReference {
                reference_id: "ref-1".to_string(),
                source_loom_id: Some("loom-1".to_string()),
                source_response_id: Some("assistant-1".to_string()),
                target_kind: "response".to_string(),
                target_id: Some("target-response".to_string()),
                target_uri: None,
                selected_text: None,
                label: Some("Target".to_string()),
                metadata_json: None,
                created_at: "2026-01-01T00:00:00Z".to_string(),
            })
            .await
            .expect("insert reference");
        sync_response_tags_topics_and_links(database.pool(), "assistant-1")
            .await
            .expect("resync links");

        let links = ContextGraphLinkRepository::new(&database)
            .list_links_for_response("assistant-1")
            .await
            .expect("links");
        assert!(links
            .iter()
            .any(|link| link.link_kind == "references" && link.target_id == "target-response"));
        assert!(links
            .iter()
            .any(|link| link.link_kind == "stale_due_to" && link.source_id == "user-1"));
    }

    #[tokio::test]
    async fn same_topic_links_are_capped() {
        let database = test_database().await;
        seed_loom(&database).await;
        for index in 0..8 {
            insert_response(
                &database,
                &format!("assistant-{index}"),
                "assistant",
                index,
                "Event Sourcing and CQRS.",
                None,
            )
            .await;
        }
        insert_response(
            &database,
            "assistant-current",
            "assistant",
            20,
            "Event Sourcing with CQRS and Replay.",
            None,
        )
        .await;
        let links = ContextGraphLinkRepository::new(&database)
            .list_links_for_response("assistant-current")
            .await
            .expect("links");
        let same_topic_count = links
            .iter()
            .filter(|link| link.link_kind == "same_topic")
            .count();
        assert_eq!(same_topic_count, SAME_TOPIC_LINK_CAP);
        assert!(links.iter().any(|link| link
            .metadata_json
            .as_deref()
            .is_some_and(|value| value.contains("\"capped\":true"))));
    }

    #[tokio::test]
    async fn raw_thinking_metadata_is_rejected_for_derived_artifacts() {
        let database = test_database().await;
        seed_loom(&database).await;
        let error = ResponseRepository::new(&database)
            .insert_response(&NewResponse {
                response_id: "assistant-1".to_string(),
                loom_id: "loom-1".to_string(),
                role: "assistant".to_string(),
                content: "Safe content".to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                sequence_index: 0,
                metadata_json: Some(r#"{"raw_thinking":"no"}"#.to_string()),
            })
            .await
            .expect_err("raw thinking rejected");

        assert!(error.to_string().contains("raw_thinking"));
    }

    async fn seed_loom(database: &crate::storage::db::Database) {
        sqlx::query(
            "INSERT INTO looms (
                loom_id, title, summary, code, canonical_uri, kind,
                created_at, updated_at
            ) VALUES ('loom-1', 'Test Loom', NULL, NULL, '/loom/test', 'loom',
                '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(database.pool())
        .await
        .expect("insert loom");
    }

    async fn insert_response(
        database: &crate::storage::db::Database,
        response_id: &str,
        role: &str,
        sequence_index: i64,
        content: &str,
        metadata_json: Option<&str>,
    ) {
        ResponseRepository::new(database)
            .insert_response(&NewResponse {
                response_id: response_id.to_string(),
                loom_id: "loom-1".to_string(),
                role: role.to_string(),
                content: content.to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
                sequence_index,
                metadata_json: metadata_json.map(str::to_string),
            })
            .await
            .expect("insert response");
    }

    #[tokio::test]
    async fn code_block_repository_remains_compatible() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(
            &database,
            "assistant-1",
            "assistant",
            1,
            "```rust\nfn main() {}\n```",
            None,
        )
        .await;
        let code_blocks = ResponseCodeBlockRepository::new(&database)
            .list_by_response("assistant-1")
            .await
            .expect("code blocks");
        assert_eq!(code_blocks.len(), 1);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // cleanup_orphaned_code_language_tags
    // ──────────────────────────────────────────────────────────────────────────

    /// Simulate the pre-authority-boundary state: insert a code-language tag whose
    /// source code block no longer exists, then verify cleanup removes it.
    #[tokio::test]
    async fn cleanup_orphaned_code_language_tags_removes_stale_tags() {
        use super::cleanup_orphaned_code_language_tags;

        let database = test_database().await;
        seed_loom(&database).await;

        // Insert a response without any content that would produce real code blocks.
        insert_response(&database, "assistant-orphan", "assistant", 1, "No code here.", None).await;

        // Directly insert a stale 'code' kind tag simulating a pseudo-artifact block
        // that was deleted by migration 0019 (no corresponding response_code_blocks row).
        sqlx::query(
            "INSERT INTO response_tags (
                tag_id, response_id, loom_id, tag, normalized_tag, tag_kind,
                confidence, source, metadata_json, created_at
            ) VALUES ('stale-tag-1', 'assistant-orphan', 'loom-1', 'text', 'text', 'code',
                      0.94, 'heuristic', NULL, '1')",
        )
        .execute(database.pool())
        .await
        .expect("insert stale code tag");

        // Verify the stale tag is present before cleanup.
        let tags_before = ResponseTagRepository::new(&database)
            .list_by_response("assistant-orphan")
            .await
            .expect("tags before");
        assert!(
            tags_before.iter().any(|t| t.tag_kind == "code"),
            "stale code tag should be present before cleanup"
        );

        // Run the cleanup.
        let removed = cleanup_orphaned_code_language_tags(database.pool())
            .await
            .expect("cleanup should succeed");
        assert_eq!(removed, 1, "exactly one orphaned code tag should be removed");

        // Verify the stale tag is gone.
        let tags_after = ResponseTagRepository::new(&database)
            .list_by_response("assistant-orphan")
            .await
            .expect("tags after");
        assert!(
            !tags_after.iter().any(|t| t.tag_kind == "code"),
            "stale code tag must be removed after cleanup"
        );
    }

    /// A 'code' kind tag backed by a real surviving code block must NOT be removed.
    #[tokio::test]
    async fn cleanup_orphaned_code_language_tags_preserves_valid_code_tags() {
        use super::cleanup_orphaned_code_language_tags;

        let database = test_database().await;
        seed_loom(&database).await;

        // Insert a response with a real TypeScript block — this produces a 'code'/'ts' tag.
        insert_response(
            &database,
            "assistant-real",
            "assistant",
            1,
            "```ts\nconst value = 1;\n```",
            None,
        )
        .await;

        let tags_before = ResponseTagRepository::new(&database)
            .list_by_response("assistant-real")
            .await
            .expect("tags before");
        assert!(
            tags_before.iter().any(|t| t.tag_kind == "code" && t.normalized_tag == "ts"),
            "real code block should produce a 'ts' code tag"
        );

        // Cleanup should not remove the tag backed by the surviving code block.
        let removed = cleanup_orphaned_code_language_tags(database.pool())
            .await
            .expect("cleanup should succeed");
        assert_eq!(removed, 0, "no tags should be removed when code block exists");

        let tags_after = ResponseTagRepository::new(&database)
            .list_by_response("assistant-real")
            .await
            .expect("tags after");
        assert!(
            tags_after.iter().any(|t| t.tag_kind == "code" && t.normalized_tag == "ts"),
            "valid code tag must survive cleanup"
        );
    }

    /// Running cleanup twice must not produce an error and must return 0 on the
    /// second call — confirms the operation is deterministic and idempotent.
    #[tokio::test]
    async fn cleanup_orphaned_code_language_tags_is_idempotent() {
        use super::cleanup_orphaned_code_language_tags;

        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(&database, "assistant-idem", "assistant", 1, "No code.", None).await;

        // Plant a stale tag.
        sqlx::query(
            "INSERT INTO response_tags (
                tag_id, response_id, loom_id, tag, normalized_tag, tag_kind,
                confidence, source, metadata_json, created_at
            ) VALUES ('idem-tag-1', 'assistant-idem', 'loom-1', 'text', 'text', 'code',
                      0.94, 'heuristic', NULL, '1')",
        )
        .execute(database.pool())
        .await
        .expect("insert stale code tag");

        let first = cleanup_orphaned_code_language_tags(database.pool())
            .await
            .expect("first cleanup");
        assert_eq!(first, 1);

        let second = cleanup_orphaned_code_language_tags(database.pool())
            .await
            .expect("second cleanup");
        assert_eq!(second, 0, "idempotent: no rows to remove on second call");
    }

    /// Cleanup of orphaned code-language tags must not delete canonical response rows.
    #[tokio::test]
    async fn projection_cleanup_preserves_canonical_responses() {
        use super::cleanup_orphaned_code_language_tags;
        use crate::storage::repositories::responses::ResponseRepository;

        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(&database, "assistant-keep", "assistant", 1, "Some answer.", None).await;

        // Plant a stale code tag to trigger the cleanup predicate.
        sqlx::query(
            "INSERT INTO response_tags (
                tag_id, response_id, loom_id, tag, normalized_tag, tag_kind,
                confidence, source, metadata_json, created_at
            ) VALUES ('keep-tag-1', 'assistant-keep', 'loom-1', 'text', 'text', 'code',
                      0.94, 'heuristic', NULL, '1')",
        )
        .execute(database.pool())
        .await
        .expect("insert stale code tag");

        cleanup_orphaned_code_language_tags(database.pool())
            .await
            .expect("cleanup");

        // The response itself must still exist.
        let response = ResponseRepository::new(&database)
            .get_response("assistant-keep")
            .await
            .expect("get response")
            .expect("response must still exist after projection cleanup");
        assert_eq!(response.content, "Some answer.");
    }

    /// Fake Hash:/CODE-001 blocks must not produce code_for graph links.
    #[tokio::test]
    async fn fake_artifact_metadata_blocks_produce_no_graph_links() {
        let database = test_database().await;
        seed_loom(&database).await;
        insert_response(
            &database,
            "assistant-fake",
            "assistant",
            1,
            concat!(
                "```text\n",
                "Hash: abc123def456\n",
                "Type: Security Analysis\n",
                "Provenance: [timestamp, user, tool]\n",
                "```\n"
            ),
            None,
        )
        .await;

        let links = ContextGraphLinkRepository::new(&database)
            .list_links_for_loom("loom-1")
            .await
            .expect("links");

        assert!(
            !links.iter().any(|l| l.link_kind == "code_for"),
            "fake artifact metadata blocks must not produce code_for graph links"
        );
    }
}
