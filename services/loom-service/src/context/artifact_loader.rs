use crate::{
    context::types::{
        ArtifactStatus, AttachedReferenceInput, BuildContextInput, LoomCheckpointSummary,
        ResponseContextCapsule, WeftOriginContext,
    },
    error::ServiceError,
    storage::repositories::context_artifacts::{
        ContextArtifactsRepository, LoomCheckpointRecord, ResponseCapsuleRecord,
        WeftOriginContextRecord,
    },
};
use serde_json::Value;
use sqlx::SqlitePool;

const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct RepositoryContextLoader {
    repository: ContextArtifactsRepository,
}

impl RepositoryContextLoader {
    pub fn new(repository: ContextArtifactsRepository) -> Self {
        Self { repository }
    }

    pub async fn enrich_input(
        &self,
        mut input: BuildContextInput,
    ) -> Result<(BuildContextInput, Vec<ArtifactWarning>), ServiceError> {
        let mut warnings = Vec::new();

        self.load_latest_checkpoint(&mut input, &mut warnings)
            .await?;
        self.load_weft_origin(&mut input, &mut warnings).await?;
        self.load_reference_capsules(&mut input, &mut warnings)
            .await?;

        Ok((input, warnings))
    }

    pub fn pool(&self) -> SqlitePool {
        self.repository.pool()
    }

    async fn load_latest_checkpoint(
        &self,
        input: &mut BuildContextInput,
        warnings: &mut Vec<ArtifactWarning>,
    ) -> Result<(), ServiceError> {
        if input.checkpoint.is_some() {
            return Ok(());
        }

        match self
            .repository
            .get_latest_checkpoint_for_loom(&input.loom_id)
            .await?
        {
            Some(record) => {
                if artifact_status(&record.status) == ArtifactStatus::Ready {
                    input.checkpoint = Some(checkpoint_from_record(record, warnings));
                } else {
                    warnings.push(warning(
                        "missing_checkpoint",
                        "Latest Loom checkpoint is not ready and was skipped.",
                    ));
                }
            }
            None => warnings.push(warning(
                "missing_checkpoint",
                "No Loom checkpoint was available for this Loom.",
            )),
        }

        Ok(())
    }

    async fn load_weft_origin(
        &self,
        input: &mut BuildContextInput,
        warnings: &mut Vec<ArtifactWarning>,
    ) -> Result<(), ServiceError> {
        if input.weft_origin.is_some() {
            return Ok(());
        }

        if input.source != crate::context::types::ContextSource::Weft {
            return Ok(());
        }

        match self
            .repository
            .get_weft_origin_context(&input.loom_id)
            .await?
        {
            Some(record) => match artifact_status(&record.status) {
                ArtifactStatus::Ready | ArtifactStatus::Stale => {
                    if record.status == "stale" {
                        warnings.push(warning(
                            "artifact_failed_status",
                            "Weft origin context is stale and was used as fallback.",
                        ));
                    }
                    if record
                        .origin_summary
                        .as_deref()
                        .is_some_and(contains_forbidden_thinking_key)
                    {
                        warnings.push(warning(
                            "raw_thinking_forbidden",
                            "Weft origin context contained forbidden raw thinking keys and was skipped.",
                        ));
                        return Ok(());
                    }
                    let origin_capsule = self
                        .repository
                        .get_response_capsule(&record.origin_response_id)
                        .await?;
                    input.weft_origin =
                        Some(weft_origin_from_record(record, origin_capsule, warnings));
                }
                ArtifactStatus::Pending | ArtifactStatus::Failed => warnings.push(warning(
                    "missing_weft_origin_context",
                    "Weft origin context is not ready and was skipped.",
                )),
            },
            None => warnings.push(warning(
                "missing_weft_origin_context",
                "No Weft origin context was available for this Weft.",
            )),
        }

        Ok(())
    }

    async fn load_reference_capsules(
        &self,
        input: &mut BuildContextInput,
        warnings: &mut Vec<ArtifactWarning>,
    ) -> Result<(), ServiceError> {
        for attached in &mut input.attached_references {
            if attached.response_capsule.is_some() {
                continue;
            }
            if attached.reference.target_kind == "code_block" {
                continue;
            }

            let Some(response_id) = attached.reference.target_id.as_deref() else {
                continue;
            };

            match self.repository.get_response_capsule(response_id).await? {
                Some(record) => match artifact_status(&record.status) {
                    ArtifactStatus::Ready => {
                        attached.response_capsule = Some(capsule_from_record(record, warnings));
                    }
                    ArtifactStatus::Stale => {
                        warnings.push(warning(
                            "artifact_failed_status",
                            "Response capsule is stale and was used as fallback.",
                        ));
                        attached.response_capsule = Some(capsule_from_record(record, warnings));
                    }
                    ArtifactStatus::Pending | ArtifactStatus::Failed => warnings.push(warning(
                        "artifact_failed_status",
                        "Response capsule is not ready and was skipped.",
                    )),
                },
                None => warnings.push(warning(
                    "missing_response_capsule",
                    "No Response capsule was available for an attached Reference.",
                )),
            }
        }

        Ok(())
    }
}

fn capsule_from_record(
    record: ResponseCapsuleRecord,
    warnings: &mut Vec<ArtifactWarning>,
) -> ResponseContextCapsule {
    ResponseContextCapsule {
        capsule_id: record.capsule_id,
        response_id: record.response_id,
        loom_id: record.loom_id,
        response_code: record.response_code,
        title: record.title,
        summary: record.summary.unwrap_or_default(),
        key_points: parse_string_array(record.key_points_json.as_deref(), warnings),
        keywords: parse_string_array(record.keywords_json.as_deref(), warnings),
        entities: parse_string_array(record.entities_json.as_deref(), warnings),
        code_blocks: parse_string_array(record.code_blocks_json.as_deref(), warnings),
        canonical_uri: record.canonical_uri,
        source_hash: record.source_hash,
        generator: record.generator,
        status: artifact_status(&record.status),
    }
}

fn checkpoint_from_record(
    record: LoomCheckpointRecord,
    warnings: &mut Vec<ArtifactWarning>,
) -> LoomCheckpointSummary {
    LoomCheckpointSummary {
        checkpoint_id: record.checkpoint_id,
        loom_id: record.loom_id,
        up_to_response_id: record.up_to_response_id,
        summary: record.summary,
        decisions: parse_string_array(record.decisions_json.as_deref(), warnings),
        constraints: parse_string_array(record.constraints_json.as_deref(), warnings),
        open_questions: parse_string_array(record.open_questions_json.as_deref(), warnings),
        entities: parse_string_array(record.entities_json.as_deref(), warnings),
        wefts: parse_string_array(record.wefts_json.as_deref(), warnings),
        references: parse_string_array(record.references_json.as_deref(), warnings),
        source_hash: record.source_hash,
        status: artifact_status(&record.status),
    }
}

fn weft_origin_from_record(
    record: WeftOriginContextRecord,
    origin_capsule: Option<ResponseCapsuleRecord>,
    warnings: &mut Vec<ArtifactWarning>,
) -> WeftOriginContext {
    let origin_capsule = origin_capsule.and_then(|capsule| {
        if capsule.status == "ready" || capsule.status == "stale" {
            Some(capsule_from_record(capsule, warnings))
        } else {
            warnings.push(warning(
                "missing_origin_capsule",
                "Origin Response capsule was not ready and was skipped.",
            ));
            None
        }
    });
    let origin_capsule_summary = origin_capsule
        .as_ref()
        .map(|capsule| capsule.summary.as_str())
        .filter(|summary| !summary.is_empty());
    let origin_summary = match (record.origin_summary, origin_capsule_summary) {
        (Some(summary), Some(capsule_summary)) if !summary.contains(capsule_summary) => {
            format!("{summary}\n\nOrigin response summary:\n{capsule_summary}")
        }
        (Some(summary), _) => summary,
        (None, Some(capsule_summary)) => capsule_summary.to_string(),
        (None, None) => String::new(),
    };
    WeftOriginContext {
        context_id: record.context_id,
        weft_loom_id: record.weft_loom_id,
        origin_loom_id: record.origin_loom_id,
        origin_response_id: record.origin_response_id,
        origin_capsule_id: origin_capsule
            .map(|capsule| capsule.capsule_id)
            .or(record.origin_capsule_id),
        origin_summary,
        source_hash: record.source_hash,
        status: artifact_status(&record.status),
    }
}

fn artifact_status(status: &str) -> ArtifactStatus {
    match status {
        "ready" => ArtifactStatus::Ready,
        "stale" => ArtifactStatus::Stale,
        "pending" => ArtifactStatus::Pending,
        "failed" => ArtifactStatus::Failed,
        _ => ArtifactStatus::Failed,
    }
}

fn parse_string_array(value: Option<&str>, warnings: &mut Vec<ArtifactWarning>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };

    if contains_forbidden_thinking_key(value) {
        warnings.push(warning(
            "raw_thinking_forbidden",
            "Artifact JSON contained forbidden raw thinking keys and was ignored.",
        ));
        return Vec::new();
    }

    match serde_json::from_str::<Value>(value) {
        Ok(Value::Array(items)) => items
            .into_iter()
            .filter_map(|item| item.as_str().map(ToString::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

fn contains_forbidden_thinking_key(value: &str) -> bool {
    FORBIDDEN_THINKING_KEYS
        .iter()
        .any(|key| value.contains(key))
}

fn warning(code: &str, message: &str) -> ArtifactWarning {
    ArtifactWarning {
        code: code.to_string(),
        message: message.to_string(),
    }
}
