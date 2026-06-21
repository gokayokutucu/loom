# Agent Runtime Contracts

Status: Canonical design freeze
Task: `AGENT-RUNTIME-CONTRACT-FREEZE-001`

## 1. Purpose

This document defines the provider-neutral and implementation-independent domain contracts for Loom Agent execution. It freezes identity, ownership, parent/child relationships, Tool calls, results, and Context Snapshot references. It does not prescribe Rust types, HTTP routes, database tables, queues, or deployment topology.

The contracts apply equally to:

- local and remote model providers;
- single-agent and multi-agent execution;
- Loom-native, MCP, and future external Tools;
- in-process, sidecar, worker, and remote execution adapters.

The Rust service remains the authoritative owner of execution state. SQLite remains the canonical durable source for Loom records and audit metadata. Retrieval indexes remain rebuildable projections and never become Agent state authority.

## 2. Normative Language

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative. Logical field names use `snake_case`; a transport MAY map them to its casing convention without changing semantics.

## 3. Common Contracts

All identifiers are opaque, stable strings. An identifier MUST NOT encode prompt text, provider payloads, secrets, or raw thinking.

```text
AgentId             stable identity of an Agent definition
AgentRevision       immutable revision of that definition
AgentRunId          independent execution identity
DelegationId        identity of one parent-to-child delegation
AgentStepId         identity of one ordered unit of work in a run
ToolInvocationId    identity of one Tool request
AgentEventId        identity of one event
ContextSnapshotId   identity of one Context Snapshot
ArtifactId          identity of a canonical output artifact
CorrelationId       groups executions that belong to one user or system operation
CausationId         identifies the event, run, response, or request that caused an object
```

Time fields are UTC instants. Durations are non-negative elapsed values. Error fields use stable codes and sanitized user-safe messages.

## 4. Agent

An `Agent` is a versioned execution definition, not a running process and not a provider session.

```text
Agent {
  agent_id: AgentId
  revision: AgentRevision
  name: string
  role: string
  instruction_set_ref: optional opaque reference
  capability_profile_ref: optional opaque reference
  context_policy_ref: optional opaque reference
  tool_policy_ref: optional opaque reference
  provider_policy_ref: optional opaque reference
  enabled: boolean
  metadata: safe metadata only
}
```

Rules:

1. `(agent_id, revision)` is immutable.
2. A run binds to exactly one Agent revision for its entire lifecycle.
3. Provider choice is policy, not Agent identity. The same Agent revision can run through local or remote providers.
4. Tool availability is resolved at run time against the referenced policy and registry. It is not embedded as executable code in the Agent.
5. Instruction content is owned by its canonical instruction store. Runs and events reference it and MUST NOT duplicate private prompt envelopes.
6. Disabling an Agent prevents new runs; it does not rewrite or invalidate historical runs.

## 5. AgentRun

An `AgentRun` is the authoritative execution boundary. It owns lifecycle, ordered Steps, Tool Invocations, child delegations, Events, Context Snapshot linkage, cancellation, and terminal outcome metadata.

```text
AgentRun {
  run_id: AgentRunId
  agent_id: AgentId
  agent_revision: AgentRevision
  state: RunState

  root_run_id: AgentRunId
  parent_run_id: optional AgentRunId
  delegation_id: optional DelegationId
  correlation_id: CorrelationId
  causation_id: optional CausationId

  loom_id: optional LoomId
  weft_id: optional WeftId
  response_id: optional ResponseId
  parent_response_id: optional ResponseId
  context_snapshot_id: optional ContextSnapshotId

  provider_binding: optional ProviderBinding
  cancellation: CancellationState
  usage: optional UsageCounts
  outcome: optional RunOutcome

  created_at: instant
  started_at: optional instant
  completed_at: optional instant
  metadata: safe metadata only
}
```

`ProviderBinding` contains neutral identity only: provider kind, provider profile ID, model ID, and capability revision. It MUST NOT contain credentials, request bodies, response bodies, or provider-specific wire payloads.

`UsageCounts` contains numeric input, output, cached, and total usage when available. Unavailable usage remains explicitly absent.

`RunOutcome` contains a terminal result code, safe error metadata when applicable, and references to canonical Responses or Artifacts. It MUST NOT contain raw thinking or a provider response envelope.

Rules:

1. `run_id` is independently generated and MUST NOT be derived from a Response ID.
2. `root_run_id` equals `run_id` for a root run and is inherited unchanged by descendants.
3. `parent_run_id` and `delegation_id` are both absent for a root run and both present for a child run.
4. Parentage is immutable and acyclic.
5. A run has at most one finalized Context Snapshot.
6. A run has exactly one terminal state and exactly one terminal Agent Event.
7. A terminal run is never reopened. Retry, resume-after-interruption, or regeneration creates a new run linked through causation metadata.
8. A run owns execution metadata, not canonical user knowledge. Agent Runs, Steps, and Events MUST NOT enter Retrieval or Context Selection as knowledge sources.

## 6. SubAgent

`SubAgent` is a delegation relationship, not a second kind of runtime container. Every SubAgent execution is an ordinary child `AgentRun` and uses the same state, event, cancellation, Context, provider, and Tool contracts as a root run.

```text
SubAgent {
  delegation_id: DelegationId
  parent_run_id: AgentRunId
  child_run_id: AgentRunId
  agent_id: AgentId
  agent_revision: AgentRevision
  spawn_step_id: AgentStepId
  task_ref: optional opaque reference
  join_policy: JoinPolicy
  cancellation_policy: ChildCancellationPolicy
  created_at: instant
}
```

`JoinPolicy` is one of:

- `wait_for_all`: resume parent after every selected child is terminal;
- `wait_for_any`: resume parent after the first qualifying child is terminal;
- `detached`: parent does not wait, but ownership and cancellation rules still apply;
- `policy_defined`: an orchestration policy evaluates child outcomes.

Rules:

1. The child owns its Steps, Tool Invocations, Events, Context Snapshot, provider binding, usage, and outcome.
2. A parent MUST NOT copy a child's raw event stream into its own stream. It emits correlation events containing child identity and safe outcome metadata.
3. Child failure does not implicitly fail the parent. The join policy determines parent behavior.
4. Child cancellation does not implicitly cancel the parent.
5. Parent subtree cancellation propagates to every non-terminal owned descendant, including detached descendants.
6. A child MAY use a different Agent revision, provider, model, Context Snapshot, and Tool policy while retaining the same root and correlation IDs.

## 7. AgentStep

An Agent Step is an ordered unit of work owned by one run.

```text
AgentStep {
  step_id: AgentStepId
  run_id: AgentRunId
  sequence_index: integer
  kind: context | provider | tool | delegation | validation | artifact | policy
  state: pending | running | waiting | completed | failed | cancelled | skipped
  started_at: optional instant
  completed_at: optional instant
  error: optional SafeError
  metadata: safe metadata only
}
```

Step state cannot outlive its run. When a run becomes terminal, every non-terminal Step MUST be terminalized as cancelled, failed, interrupted, or skipped according to the run outcome.

## 8. ToolInvocation

A `ToolInvocation` is a request by one Agent Run to execute one registered Tool capability.

```text
ToolInvocation {
  invocation_id: ToolInvocationId
  run_id: AgentRunId
  step_id: AgentStepId
  agent_id: AgentId
  tool_name: ToolName
  tool_revision: optional string
  state: requested | awaiting_approval | approved | running |
         completed | failed | denied | cancelled | skipped
  permission_decision: optional PermissionDecision
  idempotency_key: optional string
  argument_schema_revision: optional string
  safe_arguments: optional redacted structured value
  arguments_digest: optional string
  requested_at: instant
  started_at: optional instant
  completed_at: optional instant
}
```

Rules:

1. An invocation belongs to exactly one Step and one Run.
2. `tool_name` is the stable registry identity. Loom-native and MCP Tools use separate namespaces but the same invocation contract.
3. Untrusted arguments are validated and sanitized before execution.
4. The execution adapter MAY receive complete arguments through a transient protected channel. Durable records contain only redacted arguments, a digest, schema revision, and safe metadata.
5. Permission evaluation occurs before execution. `denied`, `skipped`, and `cancelled` are terminal without Tool execution.
6. An idempotency key, when present, is scoped to the Tool and owning Run. Repeated delivery MUST return the same terminal result or an explicit in-progress result.
7. A Tool implementation cannot mutate Run state directly. It returns a Tool Result; the runtime owns transitions and Events.

## 9. ToolResult

Every terminal Tool Invocation has exactly one logical `ToolResult`.

```text
ToolResult {
  invocation_id: ToolInvocationId
  status: completed | failed | denied | cancelled | skipped
  output_schema_revision: optional string
  output_ref: optional ArtifactId or canonical object reference
  safe_summary: optional string
  output_digest: optional string
  error: optional SafeError
  usage: optional numeric usage metadata
  completed_at: instant
}
```

Rules:

1. Raw Tool output is transient and MUST NOT be copied into durable Agent Events.
2. Durable output is a verified canonical Artifact or domain-object reference. A bounded safe summary MAY accompany it.
3. Tool output can enter future Context only through an eligible canonical source and Context Selection. An Agent Event is never a Context source.
4. Errors use stable codes and sanitized messages. Stack traces, credentials, headers, and raw external responses are forbidden.
5. Result delivery after invocation or run terminalization is ignored or quarantined; it cannot reopen the invocation or run.

## 10. ContextSnapshotReference

A Context Snapshot is the audit record of Context Selection and Context Manager decisions for one run.

```text
ContextSnapshotReference {
  snapshot_id: ContextSnapshotId
  run_id: AgentRunId
  lifecycle: building | finalized
  policy_version: string
  selection_version: string
  created_at: instant
  finalized_at: optional instant
}
```

Rules:

1. A snapshot belongs to exactly one run; a run links at most one finalized snapshot.
2. Child runs create their own snapshots. They MUST NOT reuse the parent's snapshot as their authoritative Context record.
3. During `building`, Context Selection and Context Manager may add candidates and final decisions. After `finalized`, the snapshot is immutable.
4. Provider execution that consumes assembled Context MUST NOT begin before snapshot finalization and successful linkage, except for an explicitly declared no-context run.
5. Snapshots store identities, ranks, inclusion modes, counts, token budgets, and safe diagnostics only.
6. Snapshots MUST NOT store prompt text, full source content, provider payloads, provider deltas, raw thinking, secrets, vectors, or raw Tool output.
7. Rehydration resolves current canonical content from SQLite by source identity. A snapshot proves selection history, not an immutable copy of source content.

## 11. Ownership Matrix

| Concern | Authoritative owner |
|---|---|
| Agent definition and revision | Agent catalog/configuration boundary |
| Run identity, lifecycle, terminal outcome | Agent Runtime |
| Parent/child delegation graph | Agent Runtime orchestrator |
| Run, Step, and durable Event history | SQLite Agent repositories |
| Live cancellation signal | Agent Runtime process/worker executing the run |
| Provider request and stream | Provider adapter selected by Provider Pipeline |
| Tool metadata and resolution | Tool Registry |
| Tool permission decision | Tool policy/approval boundary |
| Tool execution | Tool adapter selected by Tool Runtime |
| Canonical Tool artifact | Owning domain or Artifact repository |
| Retrieval candidates and scores | Retrieval service and rebuildable projections |
| Full Context content | Canonical SQLite source records |
| Context selection/budget audit | Context Snapshot |
| Final visible response content | Response repository |

No adapter may claim ownership of the Run. Providers and Tools report outcomes; the Agent Runtime commits state.

## 12. Privacy and Durability Classes

| Data class | Durable | Event payload |
|---|---:|---:|
| IDs, state, timestamps, safe codes | yes | yes |
| Numeric token/usage counts | yes | yes |
| Context candidate identities and counts | yes | yes, bounded |
| Final visible Response content | yes, in Response storage | reference only |
| Verified Tool Artifact | yes, in Artifact/domain storage | reference only |
| Provider delta text | no in Agent Event log | transient stream only |
| Tool raw output | no in Agent Event log | never |
| Prompt/provider request envelope | no | never |
| Raw thinking/internal monologue | never | never |
| Credentials, headers, secrets | never | never |

## 13. Compatibility and Evolution

1. Additive optional fields and new non-terminal Event types are compatible.
2. Existing enum meanings, terminal states, identity semantics, and ownership rules MUST NOT be redefined.
3. New providers implement the Provider contract without changing Agent, Run, or Event contracts.
4. New Tool transports implement ToolInvocation/ToolResult without changing Run or Event contracts.
5. Multi-agent execution adds child runs and delegation Events; it does not add a second run model.
6. Storage and API schemas may be narrower during rollout, but MUST map monotonically toward these contracts and MUST NOT introduce conflicting semantics.
