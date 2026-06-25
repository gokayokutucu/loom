# AgentRun Shim Chain Roadmap Reconciliation Report

## 1. Drift Cases Fixed
- **Context Pipeline Production Status**: P15 and P16 were previously marked as `LOCKED`, which implied they were actively used in production. A drift correction note was added to explicitly state that while the architecture is complete, `ContextSelectionService` and `AgentContextManager` are **not** the production path. The system still relies on the legacy `ContextManager` for the first phase of the AgentRun migration.
- **Untracked AgentRun Shim Tasks**: Added Phase `P21 — V1/V2 Boundary & AgentRun Shim Integration` to formally track the execution shim and bridge work. This correctly enumerates the recently completed and planned tasks that were causing PM drift warnings.
- **ProviderRuntimeBridge Dependency**: Corrected the dependency chain by explicitly placing P21 on the critical path *before* P20. `PROVIDER-RUNTIME-BRIDGE-001` now correctly reflects its dependency on the execution shim and context assembly.

## 2. Corrected Task State (P21)

### Boundary & Audits
- `LOOM-V1-V2-BOUNDARY-AUDIT-001` — **LOCKED**
- `LOOM-V1-V2-CODEBOUNDARY-MARKING-001` — **LOCKED**
- `CONTEXT-PIPELINE-FLOW-AUDIT-001` — **LOCKED**
- `CONTEXT-INTEGRATION-SPEC-AMEND-001` — **LOCKED**

### Execution Shims
- `AGENTRUN-CONTEXT-CONSUMPTION-001` — **LOCKED**
- `MAIN-GENERATION-AGENTRUN-SHIM-001` — **LOCKED**
- `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001` — **NEXT**

### Bridges
- `PROVIDER-RUNTIME-BRIDGE-001` — **NEXT**
- `TOOL-RUNTIME-ADAPTER-CONTRACT-001` — **HOLD**
- `SUBAGENT-EXECUTION-SEAM-001` — **HOLD**

## 3. Corrected Critical Path
```
P21 V1/V2 AgentRun Shim Integration -> P20 Tool Scheduler Implementation
```
The V1/V2 bridging strategy (AgentRun Context Consumption -> Provider Runtime Bridge -> Main Generation Shim) must be completed before the new Tool Scheduler can be wired into a real execution loop.

## 4. Remaining Work Estimate
- **P21 V1/V2 AgentRun Shim Integration**: Medium relative size. There are two remaining `NEXT` tasks in P21 (`PROVIDER-RUNTIME-BRIDGE-001` and `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001`).

## 5. Next Recommended Task
The immediate priority is to connect the newly constructed AgentRun to the Provider Runtime.
**Next Recommended Task**: `PROVIDER-RUNTIME-BRIDGE-001`
