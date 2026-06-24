# Loom V1/V2 Code Boundary Marking

Status: implemented
Task: `LOOM-V1-V2-CODEBOUNDARY-MARKING-001`

## Purpose

This document records the source-level boundary markers added after `docs/loom_v1_v2_boundary_audit.md` and `docs/provider_runtime_seam_audit.md`.

The change is annotation-only. It does not refactor, move, delete, rename, bridge, or alter runtime behavior.

## Marker Taxonomy

- `V1_CANONICAL_KNOWLEDGE_LAYER`: Existing Loom context/knowledge mechanism. Remains canonical and consumed by V2. Must not be replaced by Tool Runtime.
- `V1_CONSUMED_BY_V2`: Existing component remains active and should be called by V2 instead of duplicated.
- `V1_SHIM`: Existing endpoint/path remains operational for compatibility. Bug fixes and V2 integration only.
- `V1_DEPRECATED_NO_NEW_FEATURES`: Existing path should not receive new behavior and should be kept only until replacement/bridge is complete.
- `V2_CANONICAL_RUNTIME`: New Agent Runtime / Provider Runtime / Tool Scheduler canonical execution layer.
- `V2_EXPERIMENTAL_DISCONNECTED`: New V2 component exists but is not wired into canonical execution yet.
- `NEEDS_BRIDGE`: Component or method must be connected to another canonical V2 component in a future bridge task.
- `NEEDS_RETIREMENT`: Code path is expected to be retired after bridge/shim migration.

## Files And Modules Marked

- `services/loom-service/src/api/orchestration.rs`: `V1_SHIM`, `V1_DEPRECATED_NO_NEW_FEATURES`, `NEEDS_BRIDGE`.
- `services/loom-service/src/api/ask.rs`: `V1_SHIM`, `NEEDS_BRIDGE`, Knowledge Layer focus helpers.
- `services/loom-service/src/context_selection.rs`: `V1_CANONICAL_KNOWLEDGE_LAYER`, `V1_CONSUMED_BY_V2`.
- `services/loom-service/src/agent_context_manager.rs`: `V1_CANONICAL_KNOWLEDGE_LAYER`, `V1_CONSUMED_BY_V2`.
- `services/loom-service/src/context/manager.rs`: `V1_CANONICAL_KNOWLEDGE_LAYER`.
- `services/loom-service/src/retrieval/hybrid_service.rs`: `V1_CANONICAL_KNOWLEDGE_LAYER`.
- `services/loom-service/src/storage/repositories/attachments.rs`: `V1_CANONICAL_KNOWLEDGE_LAYER`.
- `services/loom-service/src/storage/repositories/context_artifacts.rs`: `V1_CANONICAL_KNOWLEDGE_LAYER`.
- `services/loom-service/src/storage/repositories/references.rs`: `V1_CANONICAL_KNOWLEDGE_LAYER`.
- `services/loom-service/src/storage/repositories/memory.rs`: `V1_CANONICAL_KNOWLEDGE_LAYER`.
- `services/loom-service/src/agent_runtime/mod.rs`: `V2_CANONICAL_RUNTIME`, `NEEDS_BRIDGE`.
- `services/loom-service/src/agent_runtime/runtime.rs`: `V2_CANONICAL_RUNTIME`, `NEEDS_BRIDGE`.
- `services/loom-service/src/agent_runtime/service.rs`: `V2_CANONICAL_RUNTIME`, `NEEDS_BRIDGE`.
- `services/loom-service/src/provider_runtime.rs`: `V2_EXPERIMENTAL_DISCONNECTED` at file level, `V2_CANONICAL_RUNTIME` on the service/status/request surface.
- `services/loom-service/src/tool_scheduler_runtime.rs`: `V2_CANONICAL_RUNTIME`.
- `services/loom-service/src/providers/pipeline.rs`: `NEEDS_BRIDGE`.

## Method-Level Markers Added

- Main generation and compatibility paths:
  - `plan`
  - `dry_run`
  - `execute`
  - `regenerate_response`
  - `retry_response`
  - `cancel`
  - `deep_synthesis`
  - `create_persisted_response_lifecycle`
  - `resolve_response_mode_for_execute`
  - `run_auto_router`
  - `schedule_context_artifact_job`
  - `attached_references_for_sources`
  - `recent_messages_for_execution`
  - `memory_messages_for_execution`
  - `create_provider_pipeline_for_request`
  - `execute_stream`
  - `deep_synthesis_stream`
  - `collect_provider_pipeline_text`

- Quick Ask paths:
  - `quick`
  - `quick_answer_from_provider_adapter`
  - `collect_quick_answer_from_provider_events`
  - `quick_title_from_model`
  - `quick_messages`
  - `resolve_quick_ask_focus`
  - `quick_diagnostics`
  - `quick_answer_validation`
  - `quick_provider_request_summary`
  - `quick_ollama_request`

- Knowledge Layer:
  - `ContextSelectionService::select`
  - `mandatory_references`
  - `memory_read_policy`
  - `always_include_memories`
  - `conversation_turns`
  - `weft_origin_chain`
  - `transform_retrieval_candidate`
  - `persist_snapshot`
  - `AgentContextManager::build`
  - `resolve`
  - `resolve_reference`
  - `finalize_snapshot`
  - `validate_resolved_content`
  - `ContextManager::build_context`
  - `build_context_with_repositories`
  - `build_context_with_repositories_and_strategy`
  - `AttachmentRepository::get_referenced_attachment_content`
  - `ContextArtifactsRepository::get_response_capsule`
  - `get_latest_checkpoint_for_loom`
  - `get_weft_origin_context`
  - `ReferenceRepository::list_references_for_loom`
  - `get_reference`
  - `MemoryRepository::list_memories`
  - `get_memory`
  - `HybridRetrievalService::retrieve`

- V2 runtime and provider/tool boundaries:
  - `AgentRuntime::execute_run`
  - `persist_event`
  - `finish_run_in_repo`
  - `AgentRuntimeService::execute`
  - `AgentRuntimeService::cancel`
  - `ProviderRuntimeService::submit_noop`
  - `cancel_execution`
  - `timeout_execution`
  - `validate_request`
  - `ToolSchedulerRuntime::submit_invocation`
  - `start_invocation`
  - `cancel_invocation`
  - `timeout_invocation`
  - `complete_noop`
  - `ProviderPipeline::stream_chat`
  - `ProviderPipeline::cancel_generation`

## Areas Intentionally Not Marked

- UI/React files: this task is service source annotation only.
- Migrations: no schema or runtime behavior changes were required.
- Every storage CRUD method: only passive context-relevant repository surfaces were marked. Active mutations may become tools later but are not reclassified in this annotation task.
- Provider adapter implementations: the low-level adapter seam is represented by `ProviderPipeline`; individual adapters remain unchanged to avoid marker noise.
- Tests: production source markers are sufficient and avoid brittle test comment churn.

## Future Bridge Tasks Unlocked

- `CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001`
- `MAIN-GENERATION-AGENTRUN-SHIM-001`
- `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001`
- `PROVIDER-RUNTIME-BRIDGE-001`
- `TOOL-RUNTIME-ADAPTER-CONTRACT-001`
- `SUBAGENT-EXECUTION-SEAM-001`

## Ambiguity Found

- `api/orchestration.rs` contains both legacy shim behavior and canonical Knowledge Layer helper reads. Method-level markers distinguish the roles instead of marking the whole file as deprecated.
- `provider_runtime.rs` is canonical V2 runtime by design but disconnected from current AgentRuntime execution. The file-level marker captures disconnection; struct/method markers capture canonical ownership.
- Existing `ContextManager` and newer `AgentContextManager` both remain Knowledge Layer infrastructure. V2 integration should choose the correct abstraction through a dedicated design task rather than bypassing either ad hoc.
