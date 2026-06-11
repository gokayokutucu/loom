# Phase 5: Agent Runtime Internal Boundary Plan v1.0

## Objective
Wire the Loom-native AgentRuntime foundation into `loom-service` as an internal service boundary (`AgentRuntimeService`) without exposing any product surface.

## Scope & Prerequisites
- Builds on AGENT-RUNTIME-FOUNDATION-001 and AGENT-RUNTIME-FOUNDATION-CLEANUP-001.
- `AgentRuntimeService` wraps `AgentRuntime` behind `Arc`, cloneable for app-state patterns.
- `AppState` owns a process-lifetime `AgentRunStore` (`agent_runs`); `AppState::agent_runtime()` builds the service per call, mirroring the existing `ProviderPipeline::new(state.ollama.clone())` idiom.
- No public route, no `/experimental/agent/run`, no frontend/Electron/Tauri integration.
- Main generation and Quick Ask remain untouched; a static guard test enforces it.
- Cancellation is a placeholder (store flag + pipeline cancel); cooperative mid-run cancellation deferred to AGENT-RUNTIME-CANCELLATION-001.
- Retrieval, persistence, tool execution, MCP, and Context Manager all remain deferred.

## Changelog
- **v1.0**: Initial plan for AGENT-RUNTIME-API-INTERNAL-001.
