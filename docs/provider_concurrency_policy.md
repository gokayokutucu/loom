# Loom Provider Concurrency Policy

Status: DESIGN ONLY
Task: PROVIDER-CONCURRENCY-POLICY-DESIGN-001

## 1. Overview

Loom executes Agent Runs in various topologies (from strictly sequential local models to highly parallel cloud APIs). The **Provider Concurrency Policy** defines how the Agent Runtime schedules, queues, and throttles provider interactions.

- **Why provider concurrency must be runtime-owned**: If every SubAgent manages its own concurrency, local hardware will suffer out-of-memory (OOM) errors or thrashing, and cloud APIs will quickly trigger HTTP 429 cascades. Concurrency must be governed globally at the provider adapter level.
- **Why agents must not assume concurrency**: SubAgents might be spawned concurrently, but their actual reasoning steps may be serialized by the provider's queue. Agents must be written to await model calls asynchronously without assuming parallel execution.
- **Why providers expose capabilities rather than execution behavior**: Providers (like Ollama or OpenAI) report their limits (e.g., `max_parallel_calls`, `supports_streaming`), and the Loom Runtime enforces the execution topology dynamically based on those facts.

## 2. Provider Concurrency Policy Object

The `ProviderConcurrencyPolicy` dictates how requests are scheduled for a specific provider instance.

```text
ProviderConcurrencyPolicy {
  providerId: string                // Unique ID of the provider (e.g., "ollama_default")
  topology: enum                    // local_single_agent | local_sequential_multi_agent | remote_multi_agent | hybrid_multi_agent
  maxParallelModelCalls: integer    // Maximum concurrent HTTP streams to the provider API
  maxParallelAgentRuns: integer     // Maximum active Agent Runs allowed to target this provider
  maxQueuedRequests: integer        // Maximum requests waiting in the backlog before rejecting new runs
  queueStrategy: enum               // fifo | priority_fifo | deadline_first | run_group_fairness
  timeoutMs: integer                // Maximum wait + execution time for a request
  cancellationMode: enum            // abort_request | drain_and_drop
  retryPolicy: RetryPolicy          // Rules for transient failures
  fallbackProviderIds: string[]     // Ordered list of providers to use if this one fails
  rateLimitProfile: RateLimitProfile// Sliding window tracker for TPM/RPM
  costProfile: CostProfile          // Tracker for cost limits
  privacyClass: enum                // strict | restricted | permissive
}
```

### Field Definitions
- **providerId**: Identifier linking to the provider registry.
- **topology**: The execution topology constraints for the provider.
- **maxParallelModelCalls**: How many actual inference requests can run concurrently (1 for local, N for remote).
- **maxParallelAgentRuns**: How many agents can actively hold a claim to use this provider.
- **maxQueuedRequests**: Bounding limit to prevent memory leaks from runaway queues.
- **queueStrategy**: Algorithm determining which request is dispatched next.
- **timeoutMs**: Failsafe to unblock the queue if a provider hangs.
- **cancellationMode**: How to stop active execution (abort network vs ignore response).
- **retryPolicy**: Exponential backoff configurations.
- **fallbackProviderIds**: Recovery path for unrecoverable errors.
- **rateLimitProfile / costProfile**: Accounting boundaries.
- **privacyClass**: Determines if strict-privacy context is permitted.

## 3. Local Provider Defaults

**Providers**: Ollama, LM Studio, llama.cpp, local LiteLLM, local embeddings.

### Defaults
- **maxParallelModelCalls**: 1
- **maxParallelAgentRuns**: Unbounded (many)
- **queueStrategy**: `fifo`
- **maxQueuedRequests**: 50
- **Queued model calls allowed**: Yes.
- **Tool Execution**: May remain parallel. Tool I/O does not block the single model queue.
- **Cancellation**: If a queued request is cancelled, it is removed immediately. If active, the HTTP stream is aborted.

### Why Local Multi-Agent ≠ Local Parallel Inference
In a local environment, multiple SubAgents can be "running" simultaneously from the Agent Runtime's perspective. However, because local hardware (VRAM/RAM) is constrained, their actual model inference steps MUST be serialized. When SubAgent A and SubAgent B both request generation, the Provider Runtime queues them. SubAgent A executes its thinking while SubAgent B waits. Thus, multi-agent workflows function perfectly, but do not execute inference in parallel.

## 4. Remote Provider Defaults

**Providers**: OpenAI, Claude, Gemini, OpenRouter, remote LiteLLM.

### Defaults
- **Bounded parallelism**: `maxParallelModelCalls` = N (e.g., 5-50 depending on tier).
- **Retry behavior**: Exponential backoff with jitter on 429/500/502 errors.
- **HTTP 429 handling**: Immediately pause queue dispatch, apply `Retry-After` header if present, and back off.
- **Retry-After support**: The queue honors the exact delay requested by the provider before resuming dispatch.
- **Fallback behavior**: Switch to `fallbackProviderIds` if 429 persists beyond max retries or on 503 Service Unavailable.
- **Timeout strategy**: Aggressive connection timeouts; generous read/streaming timeouts.

## 5. Hybrid Provider Pool

The **ProviderPool** abstracts multiple providers behind functional roles to optimize cost, latency, and privacy.

### Roles
- `local_reasoner`: Primary router, classifier, and local assistant.
- `local_embedding`: Vector generation.
- `planner`: Cloud model for deep multi-step orchestration.
- `coding`: Cloud model with large context for generation.
- `reviewer`: Fast cloud model for code/artifact review.
- `fallback`: Secondary cloud model if the primary is down.

### Mechanics
- **Routing Model**: Agent Runtime dispatches requests to the Pool with a required role and privacy class. The Pool selects the correct Provider Policy.
- **Selection Rules**: `strict` privacy tasks ALWAYS route to `local_*` roles.
- **Fallback Hierarchy**: If `coding` (e.g., Claude) fails, fallback to `fallback` (e.g., OpenRouter). If `local_reasoner` fails, do not fallback to cloud unless privacy allows.
- **Cancellation Propagation**: Canceling the pool request cancels the active underlying provider stream.

## 6. Queue Strategies

Available Strategies:
- `fifo`: First-in, first-out.
- `priority_fifo`: User direct prompts first, background tasks (e.g., auto-titling) last.
- `deadline_first`: Shortest timeout executes first.
- `run_group_fairness`: Round-robin across different root runs to prevent one complex task from starving another.

### V1 Selection: `fifo`
**Reasoning**: For v1, `fifo` provides the most predictable and easily debugged execution model. `priority_fifo` introduces complex starvation risks for background processes that require active management. A strict `fifo` guarantees that local multi-agent workflows complete in the order their steps naturally resolve, aligning perfectly with standard asynchronous programming expectations.

## 7. Backpressure

The Provider Runtime absorbs backend stress to protect the Agent Runtime.

| Scenario | Runtime Reaction | Retry Reaction | Event Emission |
|---|---|---|---|
| **Provider queue full** | Block `run.started` or reject request | None (fail fast) | `ProviderBackpressureApplied` |
| **HTTP 429** | Pause queue dispatch | Backoff + `Retry-After` | `ProviderBackpressureApplied` |
| **Local OOM** | Fail active request, pause queue | None (unrecoverable) | `ProviderRequestFailed` |
| **Timeout** | Abort active request | Retry if idempotent | `ProviderRequestRetried` / `Failed`|
| **Provider unavailable**| Suspend queue, select fallback | Route to fallback | `ProviderFallbackSelected` |

## 8. Cancellation

Cancellation follows the semantic rules defined in `docs/agent_runtime_state_machine.md`.

- **Queued request cancellation**: Request is cleanly evicted from the provider queue. Emits `ProviderRequestCancelled`.
- **Active request cancellation**: Network stream/socket is immediately aborted. Response is discarded.
- **Subtree cancellation**: If a parent Run is cancelled, the Runtime propagates the cancellation to all child SubAgents, which sequentially evict or abort their provider requests.
- **Provider cannot cancel generation**: If a provider API lacks an abort mechanism, the Runtime drains and drops the incoming stream to free the connection, but ignores the content.
- **Completion/Cancellation races**: If a model request completes simultaneously with a cancellation signal, the state machine dictates the outcome. If the terminal response is written before cancellation is processed, it is `completed`. Otherwise, it is `cancelled`.

## 9. Event Model

These events integrate with `docs/agent_runtime_event_model.md`:

- `ProviderRequestQueued`: Emitted when a request enters a busy provider's queue.
- `ProviderRequestStarted`: Maps to `provider.started`.
- `ProviderRequestCompleted`: Maps to `provider.completed`.
- `ProviderRequestFailed`: Maps to `provider.failed`.
- `ProviderRequestRetried`: Emitted when a transient error triggers a retry.
- `ProviderRequestCancelled`: Maps to `provider.cancelled`.
- `ProviderBackpressureApplied`: Emitted when a 429 or queue limit throttles execution.
- `ProviderFallbackSelected`: Emitted when the primary provider fails and a fallback takes over.

## 10. Diagnostics

Provider state must be observable without leaking private memory or raw internal thinking.

### Allowed Diagnostics
- Queue depth
- Active calls
- Average latency / TTFT (Time to First Token)
- Retry count
- Backpressure count
- Fallback count
- Provider status (healthy, degraded, offline)

### Forbidden Diagnostics
- Prompts (system or user)
- Responses / Raw thinking
- Provider payloads (JSON envelopes)
- Tool payloads
- Secrets (API keys)

## 11. UI States

The UI reacts to Provider Runtime states without needing to understand the underlying topology:

- `queued`: Displayed when a local request is waiting for a prior generation to finish.
- `waiting_for_local_model`: Displayed during local TTFT or model loading.
- `provider_rate_limited`: Displayed when remote APIs return 429s.
- `provider_unavailable`: Displayed if the provider is offline and no fallback exists.
- `fallback_selected`: Minor warning/info that a secondary model was engaged.
- `cloud_parallel_agents_active`: Displayed when multiple remote subagents are reasoning concurrently.
- `local_model_queue_active`: Displayed when multiple local subagents are taking turns on the GPU.

## 12. Future Compatibility

This concurrency model lays the groundwork for:
- **SubAgents & Multi-agent execution**: By isolating concurrency in the provider layer, agents can be programmed asynchronously without worrying about local hardware deadlocks.
- **Tool Runtime**: Tools can parallelize freely; only model calls queue.
- **MCP Runtime**: Model Context Protocol servers can be assigned their own concurrency profiles.
- **Hybrid execution / Provider Pools**: Abstracting providers into roles allows seamless transitions between local and cloud execution.
- **Offline mode**: Guaranteed by strict adherence to local-only routing for specific privacy classes.
- **Cost telemetry**: Integrating cost metrics natively into the `remote_multi_agent` policy bounds.

## 13. Final Recommendations

1. **Recommended v1 Queue Strategy**: `fifo`. It is predictable, easy to trace, and prevents starvation.
2. **Recommended Local Policy**: `maxParallelModelCalls = 1`, `fifo` queue, generous timeouts to account for cold model loads.
3. **Recommended Remote Policy**: `maxParallelModelCalls = 10`, strict 429 backoff, rapid connection timeouts to detect provider outages fast.
4. **Recommended Hybrid Policy**: Bind `local_reasoner` roles to strict local queues for privacy/context building, and assign `planner`/`coding` roles to parallel remote profiles for speed.
5. **Next Step**: Given that the Provider Concurrency and Topology designs are complete, `SUBAGENT-RUNTIME-DESIGN-001` is ready next, as it relies entirely on the premise that subagents can operate concurrently and rely on the provider layer to safely manage hardware queuing.
