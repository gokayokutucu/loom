use crate::{
    capabilities::{strategy::ExecutionStrategy, ExecutionStrategyDecision},
    context::{
        budget::estimate_tokens,
        contributors::{
            AttachedReferencesContributor, ContextContribution, ContextContributor,
            RecentTurnsContributor,
        },
        retrieval::{ContextRetrievalCandidateKind, ContextRetrievalIncludeMode},
        types::{
            ArtifactStatus, AttachedReferenceInput, BuildContextInput,
            ContextCandidateBudgetDecision, ContextCandidateKind, ContextMessage,
            ContextMessageRole, ContextSource, ContextSourceKind, LoomCheckpointSummary,
            ReferenceContext, ResponseContextCapsule, ResponseMode, WeftOriginContext,
        },
        ContextManager, ContextRetriever,
    },
    storage::{
        db::{test_database, Database},
        repositories::{
            context_artifacts::{
                ContextArtifactsRepository, UpsertResponseCapsule, UpsertWeftOriginContext,
            },
            looms::{LoomRepository, NewLoom},
            responses::{NewResponse, ResponseRepository},
        },
    },
};
use serde_json::json;
use std::collections::BTreeMap;

const FORBIDDEN_THINKING_KEYS: [&str; 4] = [
    "raw_thinking",
    "thinking_text",
    "chain_of_thought",
    "hidden_reasoning",
];

#[tokio::test]
async fn eval_long_loom_protects_recent_pair_and_avoids_unrelated_topic_dominance() {
    let fixture = EvalFixture::new().await;
    fixture.insert_multi_topic_history(24).await;
    fixture
        .insert_response(
            "r-current",
            "user",
            "Avantajları ve dezavantajları biraz daha açar mısın?",
            90,
            None,
        )
        .await;

    let manager = fixture.manager();
    let built = manager
        .build_context_with_repositories(fixture.input_with_recent_event_sourcing(
            "Avantajları ve dezavantajları biraz daha açar mısın?",
            Some("r-current"),
        ))
        .await
        .expect("build context");

    let joined = context_text(&built.messages);
    assert!(joined.contains("User: Event Sourcing avantajları ve dezavantajları nedir?"));
    assert!(joined.contains("Assistant: Event Sourcing avantajları audit"));
    assert!(!joined.contains("Redis filler should not dominate"));
    assert!(built
        .budget_diagnostics
        .candidate_records
        .iter()
        .any(|record| {
            record.candidate_kind == ContextCandidateKind::RecentTurn
                && record.reason == "immediate_previous_pair_or_recent_turn"
        }));
    assert_no_forbidden_thinking(&serde_json::to_value(&built.budget_diagnostics).unwrap());
}

#[tokio::test]
async fn eval_older_topic_retrieval_finds_event_store_and_replay_after_unrelated_turns() {
    let fixture = EvalFixture::new().await;
    fixture
        .insert_response(
            "r-old-event",
            "assistant",
            "Event Sourcing kararı: Event Store kayıt kaynağıdır; Replay projeksiyonları yeniden kurar; CQRS okuma/yazma ayrımı sağlar.",
            1,
            None,
        )
        .await;
    fixture
        .insert_capsule(
            "r-old-event",
            "Event Sourcing checkpoint capsule",
            "Event Store, Replay, CQRS, Snapshot ve avantaj/dezavantaj kararları.",
            &[
                "Event Sourcing",
                "Event Store",
                "Replay",
                "CQRS",
                "Snapshot",
            ],
        )
        .await;
    fixture.insert_multi_topic_history(28).await;
    fixture
        .insert_response(
            "r-current",
            "user",
            "Event Store ve Replay ilişkisini hatırlıyor musun?",
            99,
            None,
        )
        .await;

    let built = fixture
        .manager()
        .build_context_with_repositories(fixture.input(
            "Event Store ve Replay ilişkisini hatırlıyor musun?",
            Some("r-current"),
        ))
        .await
        .expect("build context");

    let retrieved = built
        .messages
        .iter()
        .find(|message| message.source_kind == Some(ContextSourceKind::RetrievedMemory))
        .expect("retrieved memory");
    assert!(retrieved.content.contains("Event Store"));
    assert!(retrieved.content.contains("Replay"));
    assert!(!retrieved
        .content
        .contains("Redis filler should not dominate"));
    assert!(built.budget_diagnostics.retrieval_estimate > 0);
    assert!(built
        .budget_diagnostics
        .candidate_records
        .iter()
        .any(|record| {
            record.candidate_kind == ContextCandidateKind::RetrievedMemory
                && record.decision == ContextCandidateBudgetDecision::Selected
        }));
}

#[tokio::test]
async fn eval_explicit_reference_is_prioritized_before_retrieved_memory() {
    let fixture = EvalFixture::new().await;
    fixture
        .insert_response(
            "r-event",
            "assistant",
            "Event Store ve Replay Event Sourcing için ana mekanizmalardır.",
            1,
            None,
        )
        .await;
    fixture
        .insert_response(
            "r-reference",
            "assistant",
            "PostgreSQL migration karar kaydı explicit Reference olarak seçildi.",
            2,
            None,
        )
        .await;
    fixture
        .insert_response(
            "r-current",
            "user",
            "Event Store ve Replay ilişkisini açıkla.",
            30,
            None,
        )
        .await;

    let built = fixture
        .manager()
        .build_context_with_repositories(BuildContextInput {
            attached_references: vec![fixture.reference("r-reference")],
            ..fixture.input(
                "Event Store ve Replay ilişkisini açıkla.",
                Some("r-current"),
            )
        })
        .await
        .expect("build context");

    let reference_index = built
        .messages
        .iter()
        .position(|message| message.source_kind == Some(ContextSourceKind::Reference))
        .expect("reference message");
    let retrieval_index = built
        .messages
        .iter()
        .position(|message| message.source_kind == Some(ContextSourceKind::RetrievedMemory))
        .expect("retrieved memory message");
    assert!(reference_index < retrieval_index);

    let reference_record = built
        .budget_diagnostics
        .candidate_records
        .iter()
        .find(|record| record.candidate_kind == ContextCandidateKind::Reference)
        .expect("reference diagnostics record");
    let retrieval_record = built
        .budget_diagnostics
        .candidate_records
        .iter()
        .find(|record| record.candidate_kind == ContextCandidateKind::RetrievedMemory)
        .expect("retrieval diagnostics record");
    assert!(reference_record.priority < retrieval_record.priority);
    assert_eq!(reference_record.reason, "explicit_reference");
}

#[test]
fn eval_capsule_and_checkpoint_context_are_selected_and_accounted() {
    let input = BuildContextInput {
        checkpoint: Some(LoomCheckpointSummary {
            checkpoint_id: "checkpoint-event-sourcing".to_string(),
            loom_id: "loom-1".to_string(),
            up_to_response_id: Some("r-checkpoint".to_string()),
            summary: "Rolling checkpoint: Event Sourcing decisions, CQRS constraints, and Replay open questions.".to_string(),
            decisions: vec!["Keep Event Store as source of truth".to_string()],
            constraints: vec!["Do not lose Reference priority".to_string()],
            open_questions: vec!["Snapshot interval remains unresolved".to_string()],
            entities: vec!["Event Sourcing".to_string(), "Replay".to_string()],
            wefts: Vec::new(),
            references: vec!["ref-capsule".to_string()],
            source_hash: None,
            status: ArtifactStatus::Ready,
        }),
        attached_references: vec![AttachedReferenceInput {
            reference: ReferenceContext {
                reference_id: "ref-capsule".to_string(),
                target_kind: "response".to_string(),
                target_id: Some("r-capsule".to_string()),
                target_uri: Some("loom://response/r-capsule".to_string()),
                label: Some("Event Sourcing capsule Reference".to_string()),
                selected_text: Some("Event Store Replay".to_string()),
                capsule_summary: None,
            },
            response_capsule: Some(ResponseContextCapsule {
                capsule_id: "capsule-r-capsule".to_string(),
                response_id: "r-capsule".to_string(),
                loom_id: "loom-1".to_string(),
                response_code: Some("R-CAPSULE".to_string()),
                title: Some("Event Sourcing capsule".to_string()),
                summary: "Capsule: Event Store, Replay, CQRS, and advantages/disadvantages.".to_string(),
                key_points: vec!["Replay rebuilds projections".to_string()],
                keywords: vec!["Event Store".to_string(), "Replay".to_string()],
                entities: vec!["CQRS".to_string()],
                code_blocks: vec!["code-block-1".to_string()],
                canonical_uri: Some("loom://response/r-capsule".to_string()),
                source_hash: None,
                generator: Some("context_eval".to_string()),
                status: ArtifactStatus::Ready,
            }),
            attachment: None,
        }],
        ..EvalFixture::static_input("Event Store ve Replay ilişkisini açıkla.")
    };

    let built = ContextManager::default().build_context(input);
    let joined = context_text(&built.messages);
    assert!(joined.contains("Rolling checkpoint"));
    assert!(joined.contains("Capsule: Event Store"));
    assert!(built.budget_diagnostics.checkpoints_estimate > 0);
    assert!(built.budget_diagnostics.capsules_estimate > 0);
    assert!(built
        .budget_diagnostics
        .candidate_records
        .iter()
        .any(|record| {
            record.candidate_kind == ContextCandidateKind::Checkpoint
                && record.decision == ContextCandidateBudgetDecision::Selected
        }));
    assert!(built
        .budget_diagnostics
        .candidate_records
        .iter()
        .any(|record| {
            record.candidate_kind == ContextCandidateKind::Capsule
                && record.decision == ContextCandidateBudgetDecision::Selected
        }));
    assert_no_forbidden_thinking(&serde_json::to_value(&built.budget_diagnostics).unwrap());
}

#[tokio::test]
async fn eval_code_aware_retrieval_uses_summary_for_concept_and_exact_code_for_debug() {
    let fixture = EvalFixture::new().await;
    let exact_code = "fn replay_events(events: Vec<Event>) {\n    for event in events {\n        apply(event);\n    }\n}\n";
    fixture
        .insert_response(
            "r-code",
            "assistant",
            &format!("Event Sourcing Replay implementation.\n```rust\n{exact_code}```"),
            1,
            None,
        )
        .await;
    fixture
        .insert_response(
            "r-current",
            "user",
            "Event Sourcing mimarisi nasıl çalışıyor?",
            40,
            None,
        )
        .await;

    let conceptual = fixture
        .retriever()
        .retrieve_with_strategy(
            &fixture.input(
                "Event Sourcing mimarisi nasıl çalışıyor?",
                Some("r-current"),
            ),
            Some(&strong_strategy()),
        )
        .await
        .expect("conceptual retrieval");
    assert!(conceptual.candidates.iter().any(|candidate| {
        candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock
            && candidate.include_mode == ContextRetrievalIncludeMode::CodeSummary
    }));
    assert!(!conceptual.selected.iter().any(|candidate| {
        candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock
            && candidate.include_mode == ContextRetrievalIncludeMode::CodeExact
    }));

    let debug = fixture
        .retriever()
        .retrieve_with_strategy(
            &fixture.input(
                "Event Sourcing Rust kod neden hata veriyor?",
                Some("r-current"),
            ),
            Some(&strong_strategy()),
        )
        .await
        .expect("debug retrieval");
    let code = debug
        .selected
        .iter()
        .find(|candidate| {
            candidate.candidate_kind == ContextRetrievalCandidateKind::CodeBlock
                && candidate.include_mode == ContextRetrievalIncludeMode::CodeExact
        })
        .expect("exact code candidate");
    assert!(code.text_preview.contains(exact_code));
    assert!(code.text_preview.contains("    for event in events"));
}

#[tokio::test]
async fn eval_weft_keeps_origin_context_hidden_background_and_visible_seed_clean() {
    let fixture = EvalFixture::new().await;
    fixture.insert_weft_origin().await;

    let mut input = fixture.input_with_recent_seed("Buradaki karar neden önemli?", None);
    input.loom_id = "weft-1".to_string();
    input.source = ContextSource::Weft;
    input.weft_origin = Some(WeftOriginContext {
        context_id: "weft-origin-1".to_string(),
        weft_loom_id: "weft-1".to_string(),
        origin_loom_id: "loom-1".to_string(),
        origin_response_id: "r-origin".to_string(),
        origin_capsule_id: Some("capsule-origin".to_string()),
        origin_summary: "Hidden origin context: Event Sourcing kararının nedeni Event Store ve Replay denetlenebilirliğidir.".to_string(),
        source_hash: None,
        status: ArtifactStatus::Ready,
    });

    let built = ContextManager::default().build_context(input);
    let background = built
        .messages
        .iter()
        .find(|message| message.source_kind == Some(ContextSourceKind::WeftOrigin))
        .expect("hidden origin background context");
    assert!(background.content.contains("Hidden origin context"));

    let visible_recent = built
        .messages
        .iter()
        .find(|message| message.source_kind == Some(ContextSourceKind::RecentTurn))
        .expect("visible seed recent turns");
    assert!(visible_recent
        .content
        .contains("Weft visible seed question"));
    assert!(!visible_recent.content.contains("Parent Loom full history"));
    assert_eq!(
        built.artifacts.weft_origin_context_id.as_deref(),
        Some("weft-origin-1")
    );
    assert!(built
        .budget_diagnostics
        .candidate_records
        .iter()
        .any(|record| {
            record.candidate_kind == ContextCandidateKind::WeftOrigin
                && record.reason == "weft_origin_background_context"
        }));
}

#[tokio::test]
async fn eval_stale_response_is_not_primary_when_regenerated_answer_exists() {
    let fixture = EvalFixture::new().await;
    fixture
        .insert_response(
            "r-stale",
            "assistant",
            "Event Sourcing eski ve hatalı cevap; bunu birincil gerçek olarak kullanma.",
            1,
            Some(
                json!({
                    "stale": true,
                    "staleReason": "prompt_edited",
                    "staleSourceResponseId": "r-user"
                })
                .to_string(),
            ),
        )
        .await;
    fixture
        .insert_response(
            "r-regenerated",
            "assistant",
            "Event Sourcing güncel cevap: Event Store, Replay ve CQRS birlikte değerlendirilir.",
            2,
            Some(json!({ "regeneratedFromUserResponseId": "r-user" }).to_string()),
        )
        .await;
    fixture
        .insert_response("r-current", "user", "Event Sourcing güncel cevap", 10, None)
        .await;

    let result = fixture
        .retriever()
        .retrieve(&fixture.input("Event Sourcing güncel cevap", Some("r-current")))
        .await
        .expect("retrieve");

    let stale = result
        .candidates
        .iter()
        .find(|candidate| candidate.response_id.as_deref() == Some("r-stale"))
        .expect("stale candidate");
    assert!(stale
        .reasons
        .iter()
        .any(|reason| reason == "stale_response_penalty"));
    assert_eq!(
        result
            .selected
            .first()
            .and_then(|candidate| candidate.response_id.as_deref()),
        Some("r-regenerated")
    );
}

#[test]
fn eval_budget_diagnostics_track_pressure_overflow_and_safe_records() {
    let mut references = Vec::new();
    for index in 0..3 {
        references.push(AttachedReferenceInput {
            reference: ReferenceContext {
                reference_id: format!("ref-{index}"),
                target_kind: "response".to_string(),
                target_id: Some(format!("r-ref-{index}")),
                target_uri: None,
                label: Some(format!("Reference {index}")),
                selected_text: Some("Event Sourcing explicit reference".to_string()),
                capsule_summary: None,
            },
            response_capsule: None,
            attachment: None,
        });
    }
    let input = BuildContextInput {
        resolved_num_ctx: 512,
        attached_references: references,
        recent_messages: vec![
            context_message(
                ContextMessageRole::User,
                "Immediate previous Event Sourcing question",
            ),
            context_message(
                ContextMessageRole::Assistant,
                "Immediate previous Event Sourcing answer with Replay and CQRS",
            ),
        ],
        ..EvalFixture::static_input("Event Store ve Replay ilişkisini açıkla.")
    };
    let manager = ContextManager::default();
    let built = manager.build_context_with_contributors(
        input,
        vec![
            Box::new(AttachedReferencesContributor),
            Box::new(RecentTurnsContributor),
            Box::new(StaticContributor::new(
                ContextSourceKind::RecentTurn,
                50,
                vec![(
                    "old-recent",
                    "recent pressure ".repeat(120),
                    BTreeMap::new(),
                )],
            )),
            Box::new(StaticContributor::new(
                ContextSourceKind::RetrievedMemory,
                60,
                vec![
                    (
                        "memory-1",
                        "Event Sourcing retrieved memory ".repeat(140),
                        BTreeMap::new(),
                    ),
                    (
                        "memory-2",
                        "PostgreSQL overflow candidate ".repeat(140),
                        BTreeMap::new(),
                    ),
                ],
            )),
            Box::new(StaticContributor::new(
                ContextSourceKind::RetrievedMemory,
                60,
                vec![(
                    "code-1",
                    "Relevant code block:\n- codeBlockId: code-1\n~~~rust\nfn replay() {}\n~~~"
                        .repeat(80),
                    BTreeMap::from([(
                        "candidateKind".to_string(),
                        serde_json::Value::String("code_block".to_string()),
                    )]),
                )],
            )),
        ],
    );

    let diagnostics = &built.budget_diagnostics;
    assert!(diagnostics.reserved_output_tokens > 0);
    assert!(diagnostics.remaining_input_budget <= diagnostics.hard_trim_threshold);
    assert!(diagnostics.soft_trim_threshold < diagnostics.hard_trim_threshold);
    assert!(diagnostics.selected_candidate_count > 0);
    assert!(diagnostics.overflow_candidate_count > 0);
    assert!(diagnostics.dropped_candidate_count > 0);
    assert!(diagnostics.recent_turns_estimate > 0);
    assert!(diagnostics.references_estimate > 0);
    assert!(diagnostics.retrieval_estimate > 0 || diagnostics.code_blocks_estimate > 0);
    assert!(diagnostics.candidate_records.iter().any(|record| {
        record.candidate_kind == ContextCandidateKind::CurrentPrompt
            && record.reason == "current_prompt_protected"
    }));
    assert!(diagnostics.candidate_records.iter().any(|record| {
        record.candidate_kind == ContextCandidateKind::Reference
            && record.reason == "explicit_reference"
    }));
    assert_no_forbidden_thinking(&serde_json::to_value(diagnostics).unwrap());
    assert!(!serde_json::to_string(diagnostics)
        .unwrap()
        .contains("Event Store ve Replay ilişkisini açıkla."));
}

#[derive(Clone)]
struct EvalFixture {
    database: Database,
}

impl EvalFixture {
    async fn new() -> Self {
        let database = test_database().await;
        let looms = LoomRepository::new(&database);
        looms
            .insert_loom(&NewLoom {
                loom_id: "loom-1".to_string(),
                title: "Context Eval Loom".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "loom".to_string(),
                origin_loom_id: None,
                origin_response_id: None,
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Loom");
        looms
            .insert_loom(&NewLoom {
                loom_id: "weft-1".to_string(),
                title: "Context Eval Weft".to_string(),
                summary: None,
                code: None,
                canonical_uri: None,
                kind: "weft".to_string(),
                origin_loom_id: Some("loom-1".to_string()),
                origin_response_id: Some("r-origin".to_string()),
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
                metadata_json: None,
            })
            .await
            .expect("insert Weft");
        Self { database }
    }

    fn manager(&self) -> ContextManager {
        ContextManager::with_repository(None, ContextArtifactsRepository::new(&self.database))
    }

    fn retriever(&self) -> ContextRetriever {
        ContextRetriever::new(self.database.pool().clone())
    }

    async fn insert_multi_topic_history(&self, count: usize) {
        let topics = [
            (
                "CQRS",
                "CQRS okuma ve yazma modellerini ayırır; Event Sourcing ile ilişkili olabilir.",
            ),
            (
                "PostgreSQL",
                "PostgreSQL indeks, migration ve transaction kararları konuşuldu.",
            ),
            (
                "Redis",
                "Redis filler should not dominate cache TTL konuşması.",
            ),
            (
                "UI polish",
                "UI polish hover action ve panel hizalama konusu.",
            ),
            (
                "Filler",
                "Unrelated filler topic about scheduling and naming.",
            ),
        ];
        for index in 0..count {
            let (topic, content) = topics[index % topics.len()];
            self.insert_response(
                &format!("r-topic-{index}"),
                "assistant",
                &format!("{topic}: {content}"),
                10 + index as i64,
                None,
            )
            .await;
        }
    }

    async fn insert_response(
        &self,
        response_id: &str,
        role: &str,
        content: &str,
        sequence_index: i64,
        metadata_json: Option<String>,
    ) {
        ResponseRepository::new(&self.database)
            .insert_response(&NewResponse {
                response_id: response_id.to_string(),
                loom_id: "loom-1".to_string(),
                role: role.to_string(),
                content: content.to_string(),
                title: None,
                code: None,
                canonical_uri: None,
                created_at: sequence_index.to_string(),
                updated_at: sequence_index.to_string(),
                sequence_index,
                metadata_json,
            })
            .await
            .expect("insert Response");
    }

    async fn insert_capsule(
        &self,
        response_id: &str,
        title: &str,
        summary: &str,
        keywords: &[&str],
    ) {
        ContextArtifactsRepository::new(&self.database)
            .upsert_response_capsule(&UpsertResponseCapsule {
                capsule_id: format!("capsule-{response_id}"),
                response_id: response_id.to_string(),
                loom_id: "loom-1".to_string(),
                response_code: None,
                title: Some(title.to_string()),
                summary: Some(summary.to_string()),
                key_points_json: Some(json!(["context eval key point"]).to_string()),
                keywords_json: Some(json!(keywords).to_string()),
                entities_json: Some(json!(keywords).to_string()),
                code_blocks_json: Some(json!([]).to_string()),
                canonical_uri: None,
                source_hash: None,
                generator: Some("context_eval".to_string()),
                status: "ready".to_string(),
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
            })
            .await
            .expect("insert capsule");
    }

    async fn insert_weft_origin(&self) {
        ContextArtifactsRepository::new(&self.database)
            .upsert_weft_origin_context(&UpsertWeftOriginContext {
                context_id: "weft-origin-1".to_string(),
                weft_loom_id: "weft-1".to_string(),
                origin_loom_id: "loom-1".to_string(),
                origin_response_id: "r-origin".to_string(),
                origin_capsule_id: Some("capsule-origin".to_string()),
                origin_summary: Some(
                    "Hidden origin context: Event Sourcing Replay decision.".to_string(),
                ),
                source_hash: None,
                status: "ready".to_string(),
                created_at: "1".to_string(),
                updated_at: "1".to_string(),
            })
            .await
            .expect("insert weft origin");
    }

    fn input(&self, prompt: &str, current_head_response_id: Option<&str>) -> BuildContextInput {
        BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: current_head_response_id.map(str::to_string),
            user_prompt: prompt.to_string(),
            attached_references: Vec::new(),
            response_mode: ResponseMode::Auto,
            resolved_num_ctx: 8192,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            memory_messages: Vec::new(),
            recent_messages: Vec::new(),
        }
    }

    fn static_input(prompt: &str) -> BuildContextInput {
        BuildContextInput {
            loom_id: "loom-1".to_string(),
            current_head_response_id: Some("r-current".to_string()),
            user_prompt: prompt.to_string(),
            attached_references: Vec::new(),
            response_mode: ResponseMode::Auto,
            resolved_num_ctx: 8192,
            answer_plan: None,
            source: ContextSource::Composer,
            weft_origin: None,
            checkpoint: None,
            memory_messages: Vec::new(),
            recent_messages: Vec::new(),
        }
    }

    fn input_with_recent_event_sourcing(
        &self,
        prompt: &str,
        current_head_response_id: Option<&str>,
    ) -> BuildContextInput {
        BuildContextInput {
            recent_messages: vec![
                context_message(
                    ContextMessageRole::User,
                    "Event Sourcing avantajları ve dezavantajları nedir?",
                ),
                context_message(
                    ContextMessageRole::Assistant,
                    "Event Sourcing avantajları audit, Replay ve CQRS; dezavantajları Event Store işletimidir.",
                ),
            ],
            ..self.input(prompt, current_head_response_id)
        }
    }

    fn input_with_recent_seed(
        &self,
        prompt: &str,
        current_head_response_id: Option<&str>,
    ) -> BuildContextInput {
        BuildContextInput {
            recent_messages: vec![
                context_message(ContextMessageRole::User, "Weft visible seed question"),
                context_message(
                    ContextMessageRole::Assistant,
                    "Weft visible seed answer about the selected decision.",
                ),
            ],
            ..self.input(prompt, current_head_response_id)
        }
    }

    fn reference(&self, response_id: &str) -> AttachedReferenceInput {
        AttachedReferenceInput {
            reference: ReferenceContext {
                reference_id: format!("ref-{response_id}"),
                target_kind: "response".to_string(),
                target_id: Some(response_id.to_string()),
                target_uri: Some(format!("loom://response/{response_id}")),
                label: Some("Explicit eval Reference".to_string()),
                selected_text: Some("PostgreSQL migration karar kaydı".to_string()),
                capsule_summary: None,
            },
            response_capsule: None,
            attachment: None,
        }
    }
}

struct StaticContributor {
    source_kind: ContextSourceKind,
    priority: i32,
    contributions: Vec<(String, String, BTreeMap<String, serde_json::Value>)>,
}

impl StaticContributor {
    fn new(
        source_kind: ContextSourceKind,
        priority: i32,
        contributions: Vec<(&str, String, BTreeMap<String, serde_json::Value>)>,
    ) -> Self {
        Self {
            source_kind,
            priority,
            contributions: contributions
                .into_iter()
                .map(|(id, content, metadata)| (id.to_string(), content, metadata))
                .collect(),
        }
    }
}

impl ContextContributor for StaticContributor {
    fn id(&self) -> &'static str {
        "context_eval_static"
    }

    fn label(&self) -> &'static str {
        "Context eval static"
    }

    fn priority(&self) -> i32 {
        self.priority
    }

    fn can_contribute(&self, _input: &BuildContextInput) -> bool {
        true
    }

    fn contribute(&self, _input: &BuildContextInput) -> Vec<ContextContribution> {
        self.contributions
            .iter()
            .map(|(source_id, content, metadata)| ContextContribution {
                source_id: source_id.clone(),
                title: source_id.clone(),
                content: content.clone(),
                estimated_tokens: estimate_tokens(content),
                source_kind: self.source_kind.clone(),
                metadata: metadata.clone(),
            })
            .collect()
    }
}

fn context_message(role: ContextMessageRole, content: &str) -> ContextMessage {
    ContextMessage::new(
        role,
        content.to_string(),
        Some(ContextSourceKind::RecentTurn),
        None,
    )
}

fn context_text(messages: &[ContextMessage]) -> String {
    messages
        .iter()
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn strong_strategy() -> ExecutionStrategyDecision {
    ExecutionStrategyDecision {
        decision_id: "context-eval-strong".to_string(),
        snapshot_id: None,
        model_id: None,
        requested_mode: "normal".to_string(),
        prompt_kind: "code".to_string(),
        context_size_tokens: 16_384,
        strategy: ExecutionStrategy::LongDirect,
        max_output_tokens: 8_000,
        max_parallelism: 2,
        allow_deep_synthesis: false,
        allow_parallel_drafts: true,
        reason: vec!["context_eval_strong".to_string()],
        warnings: Vec::new(),
        created_at: "1".to_string(),
    }
}

fn assert_no_forbidden_thinking(value: &serde_json::Value) {
    let serialized = serde_json::to_string(value).expect("serialize value");
    for forbidden in FORBIDDEN_THINKING_KEYS {
        assert!(
            !serialized.contains(forbidden),
            "forbidden thinking key leaked: {forbidden}"
        );
    }
}
