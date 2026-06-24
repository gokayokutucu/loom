# Context Integration Spec Amendment

## 1. Selected Context Source Strategy
**Option A: Reuse legacy ContextManager + contributors first.**
- **Risk**: Low. The legacy `ContextManager` is the only battle-tested path that correctly handles attachments, capsules, Wefts, and memory. Swapping to `AgentContextManager` simultaneously with the `AgentRun` shim would introduce massive regression risk.
- **Migration effort**: Low. We wrap the existing `ContextManager` invocation inside the new `AgentRun` state machine's `ContextBuild` phase.
- **Preservation of behavior**: Guaranteed, as it uses the identical code currently in production for main generation.
- **Snapshot compatibility**: We will need a lightweight adapter to emit a basic `ContextSnapshot` from the legacy contributors until the full `AgentContextManager` is promoted.
- **Ability to support AgentRun**: Sufficient for the first migration phase. `AgentRun` only needs a finalized prompt and context payload, which legacy `ContextManager` provides.

## 2. Safe V1 -> V2 Context Migration Sequence
1. **Phase 1 (Execution Shim)**: Implement `AGENTRUN-CONTEXT-CONSUMPTION-001`. The `AgentRun` state machine delegates `ContextBuild` to the legacy `ContextManager`. Attachments, capsules, Wefts, and memory are preserved.
2. **Phase 2 (Provider Bridge)**: Implement `PROVIDER-RUNTIME-BRIDGE-001`. Hook `ProviderRuntimeService` to consume the prompt emitted by Phase 1.
3. **Phase 3 (Context Engine Swap)**: Promote `ContextSelectionService` and `AgentContextManager` to production, replacing the legacy `ContextManager`. Ensure it matches V1 behavior exactly.
4. **Phase 4 (Deprecation)**: Retire legacy `ContextManager`.

## 3. Corrected Unsafe Assumptions
- **"ContextSelection/AgentContextManager is locked production path"** -> **CORRECTION**: It currently has zero production callers. It is a target architecture, not the current working state. We must not wire it directly into the first shim without testing.
- **"ProviderRuntimeBridge can proceed before AgentRun context consumption"** -> **CORRECTION**: `ProviderRuntimeBridge` must wait until `AgentRuntime` can successfully construct a real prompt (via legacy `ContextManager`), otherwise the bridge will have no valid payload to execute.
- **"MainGeneration shim can be implemented before context source is selected"** -> **CORRECTION**: The shim absolutely requires a concrete context source. We have now selected the legacy `ContextManager` as that initial source.

## 4. New Bridge Task: AGENTRUN-CONTEXT-CONSUMPTION-001
- **What it must do**: Modify `AgentRuntime::execute_run` to invoke the legacy `ContextManager` during the `ContextBuild` phase. It must extract the finalized prompt string and pass it down the state machine. It must generate a minimal `ContextSnapshot` adapter to satisfy the runtime contract.
- **What it must NOT do**: It must not delete `AgentContextManager`. It must not attempt to promote `ContextSelectionService`. It must not break existing attachment or capsule parsing.

## 5. ProviderRuntimeBridge Dependency
`PROVIDER-RUNTIME-BRIDGE-001` is strictly blocked by `AGENTRUN-CONTEXT-CONSUMPTION-001`. The provider bridge requires a finalized context payload from the `AgentRun` state machine to function safely.

## 6. Quick Ask Decision
Quick Ask remains the V1 fast path for now. It intentionally bypasses deep context work. We will not shim Quick Ask into `AgentRun` until the main generation shim is stable.
