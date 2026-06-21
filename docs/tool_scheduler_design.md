# Loom Tool Scheduler Design

Status: DESIGN ONLY
Task: TOOL-SCHEDULER-DESIGN-001

## 1. Overview

The Tool Scheduler is the execution engine for all capabilities (local commands, filesystem access, model-calling tools) invoked by AgentRuns and SubAgents. It bridges the gap between raw tool execution and the Agent Runtime event model, ensuring tool calls are scheduled safely alongside model inference, permissions are rigorously bounded, and deadlock conditions in multi-agent topologies are prevented.

## 2. Definitions

- **ToolScheduler**: The core arbitration engine responsible for queuing, permission-checking, and executing tools on behalf of an AgentRun.
- **ToolDefinition**: The immutable schema describing a tool's capabilities, arguments, and required permissions.
- **ToolInvocation**: The intent expressed by an agent to execute a tool, including its arguments.
- **ToolExecution**: The active process/lifecycle of a running tool.
- **ToolResult**: The structured outcome of a tool execution, including sanitized summaries and artifact references.
- **ToolArtifact**: A durable output produced by a tool (e.g., a written file or a large JSON dump) stored outside the standard context window.
- **ToolArtifactRef**: A lightweight pointer to a `ToolArtifact` injected into the prompt context.
- **ToolPermissionRequest**: A request generated when a tool invocation exceeds the agent's current granted capabilities.
- **ToolPermissionGrant**: A durable authorization bound to a specific scope, allowing the tool execution to proceed.

## 3. Ownership Model

Every tool execution must have a clear chain of custody.

- **Owning AgentRun**: The specific AgentRun (or SubAgent) that requested the tool invocation. The tool execution is bound to this run's lifecycle.
- **Root AgentRun**: The top-level run that initiated the entire task tree. Used for global timeout and budget attribution.
- **Parent AgentRun**: The run that spawned the owning SubAgent.
- **SubAgent Ownership**: A SubAgent owns its tool executions natively. It does not hand the tool execution up to the parent.
- **Artifact Ownership**: Generated `ToolArtifact`s are owned by the `Root AgentRun` for lifetime management, but are strongly referenced by the `Owning AgentRun`.
- **Event Ownership**: All tool lifecycle events (`tool.*`) are emitted into the `Owning AgentRun`'s event stream.
- **Context Snapshot Relationship**: Tool results are added to the context boundary of the `Owning AgentRun`, which may later be passed up in the `DelegationResult` to the parent.

## 4. Permission Model

Tools operate in a sandboxed permission model.

- **Inherited Permissions**: **No automatic broad inheritance.** A child SubAgent does NOT automatically inherit file-read or broad permissions granted to the parent unless the parent explicitly delegates a strictly scoped grant in the `DelegationRequest`.
- **Child-Specific Permissions**: SubAgents must be explicitly provisioned with the least-privilege permissions required for their assigned role.
- **Parent-Approved Permissions**: A parent can approve a child's permission request dynamically if the parent holds the superset of that permission.
- **User-Approved Permissions**: For dangerous operations (e.g., destructive writes, unverified network access), a bubble-up request is sent to the root UI for user approval.
- **Permission Scopes**:
  - `one-time`: Approved for a single `ToolInvocation`.
  - `run-scoped`: Approved for the duration of the `Owning AgentRun`.
  - `session-scoped`: Approved for the duration of the `Root AgentRun`.
  - `workspace-scoped`: Approved globally for the Loom container.
- **Denied/Revoked Permissions**: If denied, the tool fails with a safe policy error. Permissions can be revoked manually by the user via the Inspector.

## 5. Scheduling Model

Tools are categorized by their concurrency profiles:

- **Classes**:
  - `pure local deterministic`: String manipulation, math (High concurrency).
  - `filesystem read`: Safe to parallelize.
  - `filesystem write`: Exclusive lock required per file/directory.
  - `network`: Parallelized, bounded by standard OS connection pools.
  - `shell/process`: Heavy, potentially exclusive depending on memory usage.
  - `model-calling tools`: Must queue against the `ProviderConcurrencyPolicy`.
  - `long-running tools`: Background tasks (e.g., builds) that yield the event loop.
  - `MCP tools`: Delegated to the remote server's concurrency model.

- **Concurrency Limits**:
  - **Parallel-safe tools**: Execute immediately on a separate Tokio task pool.
  - **Exclusive tools**: Queue on a per-resource semaphore (e.g., mutex on a specific file path).
  - **Queue Strategy**: `fifo` queue for all tool invocations that hit a concurrency limit, separated entirely from the model inference queue.

## 6. Deadlock Prevention

The critical risk in `local_sequential_multi_agent` topologies is a tool callback waiting on a model queue while the model queue is held by a blocked agent.

- **V1 Rule**: The Tool Scheduler and Provider Scheduler are separate queues. Model-calling tools MUST acquire provider capacity explicitly.
- **Fan-in Wait Deadlock**: If a parent spawns 3 SubAgents locally, they queue. If SubAgent 1 calls a model-tool, it must re-queue. To prevent deadlock, an agent awaiting a tool result **yields its provider lock** until the tool completes.
- **Queue Jumping**: A child spawned by a blocked parent does NOT jump the queue by default. It waits in the standard FIFO.
- **Timeout Cascade**: Every wait (tool queue, tool execution, model queue) has a strict timeout. If a deadlock occurs, the timeout breaks it, failing the step and returning control to the parent/user.

## 7. Cancellation

Tool cancellation must be instantaneous and recursive.

- **Queued Tool Cancellation**: Tool is dropped from the scheduler queue without executing. Emits `ToolExecutionCancelled`.
- **Active Tool Cancellation**: The runtime sends an abort signal to the running tool (e.g., SIGTERM to a shell process, or context cancellation to a Rust future).
- **Non-Cancellable Tool**: If a tool cannot be safely aborted (e.g., a remote MCP call that doesn't support cancellation), the runtime drops the future/connection but leaves the external process running orphaned.
- **Subtree Cancellation**: Canceling an AgentRun recursively cancels all its active/queued tools.
- **Artifact Cleanup**: If a tool is cancelled mid-execution, any partial artifacts are marked `tombstoned` and cleaned up.
- **Cancellation/Completion Race**: Handled by the Agent Runtime state machine. First terminal state wins.

## 8. Result Boundary

Strict boundaries prevent context window pollution and raw payload leaks.

- **Raw Tool Output**: Never blindly injected into prompt context.
- **Sanitized Tool Result**: The Context Manager only sees a strictly formatted, sanitized summary of the tool execution.
- **Artifact Reference**: If the output is large (e.g., a file read > 100 lines), it is stored as a `ToolArtifact` and the prompt receives a `ToolArtifactRef`.
- **Diagnostics/Stdout/Stderr**: Captured and stored alongside the `ToolResult` for the Inspector, but truncated or summarized before entering the model's context window.
- **Secret Filtering**: All tool outputs are scanned to mask sensitive environment variables before context injection.
- **Prompt Inclusion Policy**: The Agent Definition dictates how tool summaries are folded into the rolling context (e.g., as a distinct "Tool Response" message role).

## 9. Artifact Model

Artifacts represent durable outputs.

- **ToolArtifactRef**: A URI pointing to the artifact storage (e.g., `loom://artifacts/run-123/tool-456`).
- **Storage Authority**: Artifacts are stored in an ephemeral SQLite table or local filesystem cache bound to the workspace.
- **Lifetime/Cleanup**: Tied to the `Root AgentRun`. When the session ends, artifacts are cleaned up unless explicitly saved/exported by the user.
- **Visibility/Access**: Tool artifacts are visible in the UI Inspector but isolated from the main Loom memory graph.
- **Export Policy**: Artifacts can be promoted to canonical files or explicitly exported by user action.

## 10. MCP Compatibility

Model Context Protocol (MCP) will attach to this scheduler in the future.

- **MCP Tool Descriptor -> Loom ToolDefinition**: MCP endpoints will be dynamically parsed and registered as Loom tools.
- **MCP Invocation -> ToolInvocation**: The Tool Scheduler treats MCP tools identically to native tools, translating the invocation to JSON-RPC.
- **MCP Permissions**: Loom maintains the permission wrapper. If an MCP server requires approval, Loom handles the UI bubble.
- **Trust Model**: MCP servers are treated as untrusted external execution environments.
- **Implementation**: Deferred to `A2A-INTEROP-DESIGN-001`.

## 11. UI/Inspector

The Tool Scheduler exposes its state to the UI transparently.

- **Pending Approval Bubble**: Blocks execution visually in the timeline until the user accepts/denies the permission request.
- **Tool Execution Timeline**: Nested under the SubAgent/AgentRun timeline block.
- **Artifact Preview**: Clicking a `ToolArtifactRef` opens a side-panel preview of the raw file/output.
- **Action Buttons**: Tools that fail or are denied show "Retry" or "Cancel" buttons.
- **SubAgent Tool Grouping**: Tools are visually grouped under the specific child agent that called them.

## 12. Diagnostics

The Tool Scheduler emits telemetry for debugging.

- **Safe Diagnostics Allowed**: Queue depth, active tool calls, tool latency, timeout count, failure count, permission denial count, artifact count, cancellation count.
- **Forbidden**: Raw tool payloads, secrets, full file contents, provider payloads, raw thinking traces.

## 13. PM Reporting Impact

This design document utilizes the `PM-REPORTING-CONTRACT-001` format. The execution of this task updates the completion percentage of P20 and identifies the next actionable implementation phases.

## 14. Implementation Phasing

1. **TOOL-SCHEDULER-SCHEMA-001**: Define Rust DTOs for `ToolInvocation`, `ToolExecution`, `ToolResult`, and `ToolArtifact`.
2. **TOOL-PERMISSION-MODEL-001**: Implement the permission tree, scoping rules, and request/grant data structures.
3. **TOOL-SCHEDULER-RUNTIME-001**: Build the queue, concurrency limits, and yielding execution loop.
4. **TOOL-ARTIFACTS-001**: Implement artifact storage and reference injection.
5. **TOOL-INSPECTOR-001**: Update the UI to display tool timelines and permission bubbles.

## 15. Final Recommendations

1. **Permission Inheritance Decision**: Default to **no automatic broad inheritance**. Child SubAgents must request specific permissions or be explicitly delegated a scoped capability by the parent to maintain the sandbox.
2. **V1 Scheduling Rule**: Decouple tool execution entirely from the model execution queue to allow non-model tools to run concurrently.
3. **Deadlock Prevention Rule**: Require agents to yield their provider queue lock when waiting for a tool execution to prevent queue starvation.
4. **MCP Compatibility Decision**: Build the internal Tool Scheduler completely agnostically, treating MCP simply as a future `network` tool class adapter.
5. **Next Task**: `TOOL-SCHEDULER-SCHEMA-001` is ready next, as it establishes the strict DTO contracts required before any execution runtime can be built. `AGENT-BEHAVIOR-PROVIDER-EXECUTION-001` cannot start until the Tool Scheduler schema is locked.
