# Task: LOOM-V1-V2-CODEBOUNDARY-MARKING-001 v1.0

## Objective

Apply explicit V1/V2 boundary markers across Loom service source code so future work does not drift into deprecated or shim paths.

## Checklist

- [x] Read `docs/loom_v1_v2_boundary_audit.md`.
- [x] Read `docs/provider_runtime_seam_audit.md`.
- [x] Read `docs/agent_runtime_contracts.md`.
- [x] Read `docs/pm_reporting_enforcement.md`.
- [x] Read `docs/loom_master_roadmap.md`.
- [x] Mark v1 main orchestration shim surfaces.
- [x] Mark v1 Quick Ask shim surfaces.
- [x] Mark canonical Knowledge Layer context selection surfaces.
- [x] Mark canonical Knowledge Layer context manager surfaces.
- [x] Mark passive attachment, capsule, checkpoint, weft, reference, memory, and retrieval context surfaces.
- [x] Mark V2 Agent Runtime canonical surfaces.
- [x] Mark Provider Runtime as canonical but disconnected.
- [x] Mark Tool Scheduler Runtime as canonical.
- [x] Mark ProviderPipeline direct streaming path as needing bridge.
- [x] Document marker taxonomy and coverage in `docs/loom_v1_v2_codeboundary_marking.md`.
- [x] Avoid behavior changes, refactors, migrations, UI changes, and bridge implementation.
- [x] Run full validation.
- [x] Commit if validation passes.

## Out Of Scope

- [x] No `PROVIDER-RUNTIME-BRIDGE-001` implementation.
- [x] No business logic changes.
- [x] No Context Manager behavior changes.
- [x] No Context Selection behavior changes.
- [x] No Quick Ask behavior changes.
- [x] No main generation behavior changes.
- [x] No AgentRuntime, ProviderRuntime, or ToolScheduler behavior changes.
- [x] No migrations.
- [x] No UI changes.
- [x] No push.
