# Phase 5: Agent Runtime Cleanup Plan v1.0

## Objective
Refine the Loom-native experimental Agent Runtime foundation by narrowing compiler warning exclusions and moving hard-coded provider options to a configurable structure.

## Scope & Prerequisites
- Narrow module-level `allow(dead_code, unused_imports)` in `agent_runtime` mod to specific structs/impls/files where dead code is expected temporarily (since the runtime is currently dev-only/internal).
- Define `AgentRuntimeProviderOptions` struct containing `temperature` and `max_output_tokens`.
- Add `AgentRuntimeProviderOptions` to `AgentRuntimeRequest` (as an optional field defaulting to temperature = 0.7, max_output_tokens = 1024).
- Pass these options into the pipeline bridge (`ProviderContractRequest`).
- Ensure no raw thinking/reasoning leakages.
- Verify all existing and new tests pass.

## Changelog
- **v1.0**: Initial cleanup plan for AGENT-RUNTIME-FOUNDATION-CLEANUP-001.
