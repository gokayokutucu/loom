# Loom SubAgent Runtime Design

Status: DESIGN ONLY
Task: SUBAGENT-RUNTIME-DESIGN-001

## 1. Overview

This document defines Loom's SubAgent Runtime model. It outlines how a primary Agent Run delegates tasks to child Agent Runs, handles context sharing, integrates results, and adheres to provider concurrency constraints. The design specifically positions SubAgents as internally orchestrated, tightly-coupled elements of the Agent Runtime rather than autonomous actors communicating over external protocols.

## 2. Definitions

- **SubAgent**: A role-bound execution of an Agent, running as a child within the context of a broader parent AgentRun.
- **AgentDefinition**: The immutable template defining an agent's capabilities, prompt instructions, tool access, and default provider constraints. A SubAgent is an instantiation of an AgentDefinition.
- **Parent/Child Relationship**: The execution linkage where a parent AgentRun spawns a child AgentRun, awaits its outcome, and integrates its results. A SubAgent is effectively a child AgentRun.

## 3. Parent/Child Run Model

The SubAgent architecture is built on a hierarchical **Run Tree**:

- `root_run_id`: The ID of the highest-level AgentRun that initiated the request tree. Passed down to all descendants.
- `parent_run_id`: The ID of the immediate caller that spawned this child run.
- `child_run_id`: The unique AgentRunId assigned to the SubAgent run.
- `delegation_id`: A correlation ID representing the specific task delegation request from the parent.

**Tree Characteristics**:
- **Max Depth**: Enforced to prevent infinite delegation loops (e.g., max depth of 3).
- **Fan-out/Fan-in**: A parent may spawn multiple SubAgents concurrently (fan-out) and block until all required delegations return (fan-in), subject to the execution topology.

## 4. Delegation Contract

A parent delegates work via a strict contract rather than an unstructured prompt.

```text
DelegationRequest {
  delegation_id: string
  target_agent_id: string          // Which AgentDefinition to instantiate
  assigned_role: string            // E.g., "Code Reviewer", "Web Researcher"
  instruction: string              // Specific task description
  required_capabilities: string[]  // E.g., ["search", "read_file"]
  provider_preference: enum        // e.g., local_only, cloud_preferred
  budget_allocation: integer       // Max tokens or cost allowed
}

DelegationResult {
  delegation_id: string
  status: enum (success, failed, cancelled)
  summary: string
  artifacts: ArtifactReference[]
  evidence_references: string[]
  confidence_score: float
  diagnostics: DiagnosticsBlock
}
```

## 5. Context Inheritance

When a parent spawns a child, the child needs context but shouldn't redundantly process the entire conversation.

- **Inherited**: The primary user request, specific references passed in the `DelegationRequest`, and active explicit memories.
- **Excluded**: The parent's internal thought process, unrelated tool results, and the entire raw transcript.
- **Child ContextSnapshot**: The child generates its own `ContextSnapshot` tailored to its `assigned_role` and `instruction`.
- **Relationship**: The child's ContextSnapshot references the parent's ContextSnapshot for lineage but does not duplicate its raw bytes.
- **Hidden Background Inheritance**: System instructions and guardrails are automatically inherited without parent explicit passing.

## 6. Memory Boundary

SubAgents must not corrupt the user's primary memory graph.

- **Read Access**: SubAgents have full read access to the memory graph via their ContextSnapshot.
- **Write Permission**: SubAgents MAY propose memory writes, but they are staged.
- **Parent Approval**: Staged memory writes require parent run (or root run) approval before committing to the canonical SQLite graph.
- **Always-Include**: SubAgents CANNOT create `always_include` memories autonomously. This requires explicit user interaction.
- **Visibility**: Child memory changes do NOT affect the parent run immediately; they are returned as part of the `DelegationResult` for the parent to synthesize.

## 7. Provider Scheduling

SubAgents are constrained by the `ProviderConcurrencyPolicy` and `ModelExecutionTopology`:

- `local_single_agent`: SubAgents queue and execute strictly one at a time. The parent blocks entirely.
- `local_sequential_multi_agent`: Parent and child runs can both be "active", but their actual inference streams queue on the local provider semaphore. Tool calls run in parallel.
- `remote_multi_agent`: SubAgents execute in parallel on cloud providers, bounded only by 429 rate limits.
- `hybrid_multi_agent`: Roles dictate the queue. A `local_reasoner` child queues locally; a `coding` child parallelizes remotely.

## 8. Tool Boundary

SubAgents are securely sandboxed regarding tool execution.

- **Tool Calling**: Children CAN call tools.
- **Inherited Permissions**: Children inherit the parent's approved permissions (e.g., read access to specific files).
- **Child-Specific Permissions**: The `DelegationRequest` strictly bounds what tools the child is allowed to invoke.
- **Approval Model**: If a child requests a tool requiring user approval, the approval request bubbles up to the root run UI.
- **Tool Result Ownership**: Tool results are owned by the child run and stored in its artifact/response boundaries.
- **Artifact Ownership**: Generated artifacts are linked to the child but returned to the parent in the `DelegationResult`.

## 9. Event Propagation

SubAgent events map to the `AgentEvent` model for durable correlation:

- `SubAgentDelegationRequested`: Emitted by parent when preparing the request.
- `SubAgentRunCreated`: Emitted when the child Run is initialized.
- `SubAgentRunStarted`: Emitted when the child Run begins execution.
- `SubAgentRunCompleted`: Emitted by child upon success.
- `SubAgentRunFailed`: Emitted by child upon error.
- `SubAgentRunCancelled`: Emitted by child upon cancellation.
- `SubAgentResultIntegrated`: Emitted by parent upon receiving and parsing the `DelegationResult`.

## 10. Cancellation Model

Cancellation cascades safely down the Run Tree.

- **Parent Cancellation**: Canceling a parent run automatically issues a cancellation request to all active child subtree runs.
- **Child Cancellation**: Canceling a specific child run does NOT cancel the parent. The parent receives a `cancelled` DelegationResult and decides how to proceed (e.g., retry or fail).
- **Cancellation Race Rules**: Follows standard state machine rules. If a child completes before the cancel signal arrives, it is `completed`.
- **Queued Child Cancellation**: Dropped from the provider queue immediately.
- **Active Child Cancellation**: Provider HTTP stream aborted.

## 11. Failure Semantics

Child failures must not inherently crash the root task.

- **Fatal vs Non-Fatal**: Provider OOM is non-fatal to the parent (parent can retry or fallback). A strict policy violation is fatal and bubbles up.
- **Partial Results**: A failed child may return partial artifacts in its result object.
- **Retry Behavior**: The parent AgentRun dictates retry logic based on the child's `status`.
- **Fallback**: The parent may spawn a different SubAgent (e.g., using a smaller model) if the primary child fails.
- **Timeouts**: Child runs have strict execution timeouts defined by the `budget_allocation`.

## 12. Result Integration

The parent must safely consume the child's work.

- **Method**: The child run terminates, yielding a structured `DelegationResult` to the parent.
- **Contents**: The result includes a summary, artifact references, and evidence (tool outputs).
- **No Raw Thinking**: The child's internal monologue/raw thinking is explicitly dropped and NOT passed to the parent to prevent context window pollution and privacy leaks.
- **No Provider Payload**: Raw API envelopes are stripped.

## 13. Cost/Budget Attribution

Cost tracking follows the Run Tree hierarchy.

- **Token Budget**: Parents allocate a max token budget to children via `DelegationRequest`.
- **Cost Attribution**: The child tracks its own usage, but the total cost rolls up to the `root_run_id` for user billing/telemetry.
- **Caps**: If a child exceeds its `budget_allocation`, the run is forcefully terminated with a `failed` (Budget Exceeded) status.

## 14. A2A Positioning

**Loom does NOT use A2A (Agent-to-Agent protocol) as the internal SubAgent Runtime v1.**

**Reasons for Internal Native SubAgents**:
- Internal SubAgents require tight coupling with `AgentRun` state machines.
- `ContextSnapshot` ownership requires shared internal database access.
- Subtree cancellation must be instantaneous.
- Provider concurrency policy (queueing) requires internal memory/semaphore sharing.
- Safe local/offline execution requires skipping network layer serialization.

**A2A Future Interoperability**:
A2A is positioned purely as a future external interoperability layer, allowing Loom to communicate with third-party external agents.

**Future A2A Tasks**:
- `A2A-INTEROP-DESIGN-001`
- `A2A-CLIENT-ADAPTER-001`
- `A2A-SERVER-ADAPTER-001`
- `A2A-AGENT-CARD-001`
- `A2A-CAPABILITY-MAPPING-001`

## 15. Implementation Phasing

To safely roll out SubAgents, implementation is staged:

1. **SUBAGENT-RUNTIME-SCHEMA-001**: Implement `parent_run_id`, `root_run_id`, and `DelegationRequest` DTOs in Rust.
2. **SUBAGENT-RUNTIME-REPOSITORY-001**: Update SQLite repositories to support Run Trees and cascaded lookups.
3. **SUBAGENT-RUNTIME-SCHEDULER-001**: Implement the parent fan-out/fan-in executor and timeout handling.
4. **SUBAGENT-RUNTIME-EVENTS-001**: Wire the SubAgent event correlation into the existing event bus.
5. **SUBAGENT-RUNTIME-INSPECTOR-001**: Update the UI/DevTools to visualize the hierarchical Run Tree.

## 16. UI/Inspector Model

The Loom UI must reflect the tree structure without overwhelming the user.

- **Run Tree Visualization**: The Dev Inspector shows a hierarchical tree of active/completed runs.
- **Child Timeline**: SubAgents appear as collapsed, nested blocks within the parent's timeline.
- **Collapsed Events**: Tool calls made by a child are grouped under the child's block.
- **Cost/Time**: Displayed per child, rolling up to the root parent.

## 17. Final Recommendations

1. **Adopt Native Run Trees**: Implement SubAgents natively using `parent_run_id` relationships over REST/A2A networks to ensure robust cancellation and context sharing.
2. **Strict Context Boundaries**: Enforce the rule that raw thinking never passes from child to parent.
3. **Defer A2A**: Acknowledge A2A as an external integration priority, not an internal architecture constraint.
4. **Next Step**: Evaluate the Tool Runtime / Tool Scheduler (`TOOL-SCHEDULER-DESIGN-001`), as SubAgents and Tools share similar execution, permission, and concurrency boundaries.
