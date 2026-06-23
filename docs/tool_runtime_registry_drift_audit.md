# Tool Runtime & Registry Drift Audit

Status: COMPLETED
Task: TOOL-RUNTIME-REGISTRY-DRIFT-AUDIT-001

## 1. Current Implementation Inventory
The Loom service currently contains two parallel representations of tool capabilities and permissions due to the recent completion of the `TOOL-SCHEDULER-*` tasks (P20) atop the older `AGENT-RUNTIME-*` foundation (P18).

## 2. Existing Files and Modules Found
- **Older Agent Runtime Foundation (In-Memory/Mock)**:
  - `services/loom-service/src/agent_runtime/tool_registry.rs`: Implements an in-memory `HashMap`-backed `ToolRegistry` with `RegisteredTool`, `ToolAvailability`, and `ToolPermissionRequirement`.
  - `services/loom-service/src/agent_runtime/tools.rs`: Defines `ToolInvocationRequest`, `ToolInvocationResult`, `ToolPermissionStatus`, `ToolInvocationStatus`, and a safe no-op `ToolRuntimeBoundary`.
  - `services/loom-service/src/agent_runtime/catalog.rs`: Exists but primarily delegates or is empty.

- **New Tool Scheduler Foundation (Persistent/Robust)**:
  - `services/loom-service/src/tool_scheduler_runtime.rs`: Defines the new execution entry point `ToolSchedulerRuntime` and its own `ToolInvocationRequest` and `ToolRuntimeResult`.
  - `services/loom-service/src/storage/repositories/tool_scheduler.rs`: Fully normalized SQLite-backed persistence layer defining `ToolDefinitionRecord`, `ToolInvocationStatus`, `ToolInvocationPermissionStatus`, `ToolArtifactRecord`, and `ToolPermissionGrantRecord`.
  - `services/loom-service/migrations/0028_tool_scheduler_foundation.sql`: Database schema for the persistent tool scheduler.

- **Capabilities Module**:
  - `services/loom-service/src/capabilities/*.rs`: Focused exclusively on Model discovery, community benchmarks, execution strategy, and hardware capability estimates (`CompatibilityEstimate`, `SpeedEstimate`, `MemoryFit`). It does **not** overlap with Tool Execution.

## 3. What is Complete
- **Tool Scheduler Schema**: Database migrations and SQLite repository queries for tools, invocations, artifacts, and permissions are fully implemented (`repositories/tool_scheduler.rs`).
- **Safety Boundary**: The strict redaction of sensitive credentials (`SafeToolArguments`) in `agent_runtime/tools.rs` is robust and complete.
- **Provider Capability Models**: The system effectively tracks model properties (e.g. `MemoryFit`, `ExecutionStrategy`) independently of tools.

## 4. What is Partial
- **ToolSchedulerRuntime**: Contains a safe no-op path but lacks the execution loop, queueing mechanisms, and adapter routing to actually run a process.

## 5. What is Stale
- The entire `agent_runtime/tool_registry.rs` in-memory module is now architecturally stale. Persistence must move to the `ToolSchedulerRepository`.
- `agent_runtime/tools.rs` contains duplicated types (e.g. `ToolInvocationRequest`, `ToolInvocationStatus`) that now conflict with the newer database-backed domain models.

## 6. What conflicts with Tool Scheduler
- **Duplicate Definitions**: `ToolInvocationRequest` and `ToolInvocationStatus` exist in both the `agent_runtime` boundary and the `tool_scheduler` runtime/repository.
- **Duplicate Permission Concepts**: `ToolPermissionRequirement` (AlwaysAllowed, DenyByDefault) in `tool_registry.rs` vs `ToolPermissionScope` and `ToolPermissionGrantRecord` in `tool_scheduler.rs`.
- **Parallel Registries**: The agent runtime checks an ephemeral `HashMap` for tools, while the new design requires checking the `tool_definitions` SQLite table.

## 7. Recommended Canonical Ownership
- **Canonical Domain**: `services/loom-service/src/storage/repositories/tool_scheduler.rs` and `services/loom-service/src/tool_scheduler_runtime.rs` must become the single source of truth for tool definitions, permissions, and invocation records.
- **Execution**: The new `ToolSchedulerRuntime` should own the queue and execution loop.
- **Agent Integration**: The `agent_runtime` should delegate directly to `ToolSchedulerRuntime` instead of holding its own `ToolRuntimeBoundary`.

## 8. Recommended Deprecations
1. **Deprecate** `services/loom-service/src/agent_runtime/tool_registry.rs`.
2. **Merge and Deprecate** duplicate structs in `services/loom-service/src/agent_runtime/tools.rs` into `tool_scheduler_runtime.rs`.
3. **Deprecate** the in-memory `ToolRuntimeBoundary` in favor of the persistent `ToolSchedulerRuntime`.

## 9. Recommended Next Implementation Task
**`TOOL-REGISTRY-BRIDGE-001`**: Refactor the `agent_runtime` to use the `ToolSchedulerRepository` as its source of truth, eliminating the duplicate `ToolInvocationRequest` and `ToolInvocationStatus` structs, and deprecating the in-memory `tool_registry.rs`.

## 10. Risks
- Attempting to build tool execution adapters (like MCP or local shell) before resolving the duplicate invocation records will result in fractured state and prompt-injection vulnerabilities if the redaction layer is bypassed.
- If `agent_runtime` is not bridged properly, tools registered in SQLite will be invisible to the LLM agent context.

---

### ROADMAP STATUS

**Current Phase**: P11 Drift Remediation
**Current Epic**: Tool Registry Drift
**Current Task**: TOOL-RUNTIME-REGISTRY-DRIFT-AUDIT-001

### PROGRESS

**Overall Project Progress**: 95%
**Current Phase Progress**: 100%
**Current Epic Progress**: 100%

### REMAINING BIG BLOCKS
- P20 Multi-Agent Execution Topology (Tool Registry Bridge, Tool Adapters, Tool Context Injection)

### CRITICAL PATH
- P20 Tool Registry Bridge

### ESTIMATED REMAINING WORK
- Current Epic: 0 engineering days
- Current Phase: 0 engineering days
- Entire Project: 42.0 engineering days

### LEDGER
**LOCKED**
- TOOL-RUNTIME-REGISTRY-DRIFT-AUDIT-001 (P11)

**ACTIVE**
- None

**NEXT**
- TOOL-REGISTRY-BRIDGE-001 (P20)

**HOLD-BACKLOG**
- SETTINGS-IA-001 (P19)

### NEXT RECOMMENDED TASK
- TOOL-REGISTRY-BRIDGE-001
