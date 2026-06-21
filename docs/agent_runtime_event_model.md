# Agent Runtime Event Model

Status: Canonical design freeze
Task: `AGENT-RUNTIME-CONTRACT-FREEZE-001`

## 1. Purpose

`AgentEvent` is the unified observation contract for Run lifecycle, Steps, providers, SubAgents, Tools, Context, Artifacts, warnings, and terminal outcomes. The same logical event model applies to in-process streams, HTTP streaming, queues, durable audit history, inspectors, and remote workers.

Events report facts. Commands such as start, approve, cancel, and invoke are not Events until the runtime accepts them and records the resulting fact.

## 2. Canonical Envelope

```text
AgentEvent {
  event_id: AgentEventId
  type: AgentEventType
  run_id: AgentRunId
  sequence_number: positive integer
  occurred_at: instant

  root_run_id: AgentRunId
  parent_run_id: optional AgentRunId
  agent_id: AgentId
  agent_revision: AgentRevision
  step_id: optional AgentStepId
  tool_invocation_id: optional ToolInvocationId
  child_run_id: optional AgentRunId

  correlation_id: CorrelationId
  causation_id: optional CausationId
  payload: typed safe payload
}
```

Rules:

1. Sequence numbers are strictly increasing and unique within one Run.
2. No total ordering is implied across Runs. Cross-run order is reconstructed through parent, child, correlation, causation, and timestamps.
3. Event IDs are globally unique and immutable.
4. Payload shape is determined by `type`; arbitrary untyped payloads are not canonical.
5. Durable events are append-only. Corrections are new events, never updates.
6. Every Event belongs to exactly one Run. Child events remain in the child Run stream.

## 3. Event Types

### 3.1 Run Lifecycle

| Type | Required payload |
|---|---|
| `run.created` | initial state, root/parent identity |
| `run.started` | started timestamp |
| `run.waiting` | wait reason, dependency kind/count |
| `run.resumed` | prior wait reason |
| `run.cancel_requested` | requester, scope, safe reason code |
| `run.cancelling` | accepted timestamp, active work counts |
| `run.completed` | elapsed time, usage counts, outcome refs |
| `run.failed` | stable error code, safe error kind/message |
| `run.cancelled` | elapsed time, cancellation requester/scope |
| `run.interrupted` | safe interruption reason, recovery source |

Exactly one of `run.completed`, `run.failed`, `run.cancelled`, or `run.interrupted` terminates a Run.

### 3.2 Steps

| Type | Required payload |
|---|---|
| `step.started` | step kind, sequence index |
| `step.waiting` | wait reason |
| `step.completed` | elapsed time |
| `step.failed` | stable error code, safe message |
| `step.cancelled` | safe cancellation code |
| `step.skipped` | stable skip reason |

### 3.3 Context

| Type | Required payload |
|---|---|
| `context.selection_completed` | candidate counts, tier counts, latency |
| `context.snapshot_finalized` | snapshot ID, policy/selection versions, selected/rejected counts |
| `context.snapshot_linked` | snapshot ID |
| `context.failed` | stable error code, mandatory-overflow flag |

Context Events contain counts and references only. They contain no query text, candidate content, prompt text, source titles, or raw diagnostics.

### 3.4 Provider

| Type | Required payload | Durability |
|---|---|---|
| `provider.started` | provider/profile/model identity, request ID | durable |
| `provider.delta` | assistant-visible text delta | transient only |
| `provider.completed` | done reason, usage counts | durable |
| `provider.truncated` | done reason, usage counts | durable |
| `provider.failed` | stable provider error kind/code | durable |
| `provider.cancelled` | safe cancellation code | durable |

Provider Events are provider-neutral. Adapter-specific fields remain behind the Provider contract. `provider.delta` is never written to the Agent Event log; canonical visible text belongs in Response storage.

Provider thinking deltas are not Agent Events. Raw thinking is dropped at the adapter/runtime boundary and is never serialized or persisted.

### 3.5 SubAgent Delegation

| Type | Required payload |
|---|---|
| `subagent.spawn_requested` | delegation ID, target Agent ID/revision, join policy |
| `subagent.started` | delegation ID, child Run ID |
| `subagent.waiting` | delegation ID, child counts by safe state |
| `subagent.completed` | delegation ID, child Run ID, safe outcome refs |
| `subagent.failed` | delegation ID, child Run ID, safe error code |
| `subagent.cancelled` | delegation ID, child Run ID, cancellation code |

These are parent correlation Events. They do not duplicate the child's Steps, provider deltas, Tool Events, or detailed error stream.

### 3.6 Tools

| Type | Required payload |
|---|---|
| `tool.requested` | invocation ID, Tool name/revision |
| `tool.permission_evaluated` | decision status, safe reason code |
| `tool.awaiting_approval` | invocation ID, approval policy reference |
| `tool.started` | invocation ID, adapter kind |
| `tool.completed` | invocation ID, safe summary, output refs/digest |
| `tool.failed` | invocation ID, stable error code, safe message |
| `tool.denied` | invocation ID, safe policy reason |
| `tool.cancelled` | invocation ID, safe cancellation code |
| `tool.skipped` | invocation ID, stable skip reason |

Tool Events never contain unredacted arguments or raw Tool output. `tool.completed` references verified canonical Artifacts or domain objects.

### 3.7 Artifacts and Warnings

| Type | Required payload |
|---|---|
| `artifact.created` | artifact ID, kind, owning Step |
| `artifact.updated` | artifact ID, safe status |
| `warning.raised` | stable warning code, safe message |

Warnings do not alter Run state by themselves.

## 4. Event Flow

A normal root Run follows this logical flow:

```text
run.created
run.started
context.selection_completed
context.snapshot_finalized
context.snapshot_linked
step.started(context)
step.completed(context)
step.started(provider)
provider.started
provider.delta*               transient only
provider.completed
step.completed(provider)
[tool and subagent flows]*
run.completed
```

A Tool flow is:

```text
tool.requested
tool.permission_evaluated
[tool.awaiting_approval]
tool.started
tool.completed | tool.failed | tool.cancelled
```

Denied or unavailable Tools terminate as:

```text
tool.requested
tool.permission_evaluated
tool.denied | tool.skipped
```

A child flow is:

```text
parent: subagent.spawn_requested
child:  run.created -> run.started -> ... -> terminal
parent: subagent.started
parent: [run.waiting]
parent: subagent.completed | subagent.failed | subagent.cancelled
parent: [run.resumed]
```

A cancellation flow is:

```text
run.cancel_requested
run.cancelling
[provider.cancelled]
[tool.cancelled]*
[subagent.cancelled]*
[step.cancelled]*
run.cancelled
```

## 5. Delivery and Replay Semantics

1. Delivery is at-least-once unless a transport explicitly provides stronger guarantees.
2. Consumers deduplicate by `event_id`.
3. Consumers order events by `(run_id, sequence_number)`, not arrival time.
4. Missing sequence numbers are a detectable gap; consumers MAY request replay.
5. Replay returns durable events only. Transient provider deltas are reconstructed from canonical Response state, not the Agent Event log.
6. A consumer MUST tolerate unknown additive Event types and fields.
7. A producer MUST NOT reuse a sequence number after restart.
8. Parent and child streams are replayed independently and joined by immutable IDs.

## 6. Durable and Transient Events

Durable events include lifecycle, Step, Context reference/count, provider terminal, SubAgent correlation, Tool lifecycle without raw output, Artifact reference, and Warning events.

Transient events include assistant-visible provider deltas and optional non-sensitive progress pulses. A transient event uses the same envelope where practical but is not promised by durable replay.

Raw provider thinking, internal monologue, unredacted Tool arguments, raw Tool output, prompts, provider envelopes, credentials, and secrets are neither durable nor transient Agent Events.

## 7. Error Model

```text
SafeError {
  code: stable string
  kind: validation | policy | context | provider | tool |
        cancellation | timeout | unavailable | internal
  message: optional bounded sanitized string
  retryable: boolean
  details: optional allowlisted scalar metadata
}
```

Errors MUST NOT contain prompts, source content, raw external responses, stack traces, provider payloads, Tool raw output, raw thinking, or credentials.

## 8. Compatibility With Current Events

Current implementation events map monotonically to this model:

| Current name | Canonical name |
|---|---|
| `run_started` | `run.started` |
| `step_started` | `step.started` |
| `provider_delta` | `provider.delta` transient |
| `provider_completed` | `provider.completed` |
| `tool_call_requested` | `tool.requested` |
| `tool_permission_evaluated` | `tool.permission_evaluated` |
| `tool_call_skipped` | `tool.skipped` |
| `tool_call_completed` | `tool.completed` |
| `tool_call_failed` | `tool.failed` |
| `artifact_created` | `artifact.created` |
| `warning` | `warning.raised` |
| `run_completed` | `run.completed` |
| `run_failed` | `run.failed` |
| `run_cancelled` | `run.cancelled` |

This table defines semantic alignment only. It does not authorize an implementation or migration.

## 9. Unified Event Invariants

1. Every Event has one owning Run.
2. Every durable Event has one immutable sequence position within that Run.
3. Exactly one terminal Run Event exists.
4. The terminal Event agrees with authoritative Run state.
5. Provider, Tool, and child adapters cannot emit authoritative Run terminal Events directly.
6. Agent audit Events are never Retrieval or Context sources.
7. No Event exposes raw thinking, prompt envelopes, provider payloads, credentials, or raw Tool output.
