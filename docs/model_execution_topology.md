# Loom Model Execution Topology

Status: DESIGN ONLY
Task: MODEL-EXECUTION-TOPOLOGY-DESIGN-001

## 1. Overview

This document defines Loom's model execution topology contract. As the Agent Runtime supports both single and multi-agent patterns (including orchestration, tool execution, and context snapshots), the choice of model provider fundamentally constrains execution concurrency, privacy, and capability. This document formalizes how Loom maps Agent Runs to physical model execution topologies, ranging from strictly local sequential inference to remote parallel multi-agent execution.

## 2. Execution Topologies

Loom defines four canonical execution topologies:

### `local_single_agent`
- **Purpose**: Fully private, offline-capable single-agent execution.
- **Supported Providers**: Ollama, LM Studio, llama.cpp, local LiteLLM.
- **Concurrency**: Strictly sequential. One active model call at a time.
- **Agent Behavior**: Single agent; no parallel subagents.
- **Tool Behavior**: Tools may execute in parallel if computationally safe (e.g., I/O bound).
- **Privacy Tradeoffs**: Maximum privacy. Data never leaves the machine.
- **Expected Latency**: Hardware-dependent, generally higher TTFT for initial loading.
- **Fallback Behavior**: May fall back to another local model or fail.

### `local_sequential_multi_agent`
- **Purpose**: Private multi-agent workflows running on limited local hardware.
- **Supported Providers**: Ollama, LM Studio, llama.cpp, local LiteLLM.
- **Concurrency**: Model calls are queued and executed sequentially to avoid OOM or thrashing.
- **Agent/Subagent Behavior**: Subagents can be spawned, but their reasoning steps block each other at the provider level.
- **Tool Behavior**: Non-model tools may run in parallel.
- **Privacy Tradeoffs**: Maximum privacy.
- **Expected Latency**: High, as multi-agent reasoning steps queue behind one another.
- **Fallback Behavior**: Queues wait indefinitely or time out.

### `remote_multi_agent`
- **Purpose**: High-throughput, complex multi-agent execution leveraging cloud scale.
- **Supported Providers**: OpenAI, Claude, Gemini, OpenRouter, remote LiteLLM.
- **Concurrency**: High parallelism. Multiple subagents execute model calls concurrently.
- **Agent/Subagent Behavior**: Subagents reason and operate in parallel, bottlenecked only by provider rate limits.
- **Tool Behavior**: Fully parallel.
- **Privacy Tradeoffs**: Low privacy. Prompts, context, and tool output are sent to external APIs.
- **Expected Latency**: Low TTFT, high throughput.
- **Fallback Behavior**: Rate limit backpressure, retries, or fallback to a secondary remote provider.

### `hybrid_multi_agent`
- **Purpose**: Optimize privacy, cost, and latency by blending local and remote models.
- **Supported Providers**: Mixed (e.g., Ollama + OpenAI).
- **Concurrency**: Mixed. Local model calls queue; remote model calls parallelize.
- **Agent Behavior**: Routine/privacy-sensitive tasks (routing, classification, embedding, topic key generation) use local models. Complex reasoning, coding, and synthesis use remote models.
- **Tool Behavior**: Fully parallel.
- **Privacy Tradeoffs**: Tiered. Core context and memory remain local; explicitly defined synthesis prompts are sent remotely.
- **Expected Latency**: Balanced.
- **Fallback Behavior**: Remote failures may gracefully degrade to slower local execution if hardware permits.

## 3. Provider Classes

### Local Runtime Rules (e.g., Ollama, LM Studio, llama.cpp, local LiteLLM)
- Default to **single-agent** or **sequential multi-agent** topologies.
- Model calls MUST be queued locally to prevent VRAM exhaustion and hardware thrashing.
- Non-model Tool calls MAY still run in parallel if safe (e.g., fetching a URL).
- Core Loom context (Memory, Retrieval, Graph) MUST remain local.
- Local embedding models are supported and run sequentially.

### Remote Runtime Rules (e.g., OpenAI, Claude, Gemini, OpenRouter, remote LiteLLM)
- Multi-agent execution runs in **parallel**.
- Provider rate limits govern concurrency. A local concurrency policy/backpressure mechanism is required to avoid HTTP 429 cascades.
- Fallback providers may be configured for high availability.

### Hybrid Runtime Rules
- Local memory, retrieval, and context building remain strictly local.
- Local small models handle fast, structured tasks: classification, routing, topic_key generation, and embeddings.
- Cloud models handle high-token, complex logic: planning, coding, review, and final synthesis.
- Subagents receive a per-agent provider assignment (e.g., an "Editor" agent uses Claude, a "Tagging" agent uses Ollama).

## 4. Capability Model

Each Provider Profile must declare a Capability Model to inform the Agent Runtime orchestrator.

```text
ProviderCapability {
  supports_streaming: boolean
  supports_tools: boolean
  supports_parallel_calls: boolean
  supports_embeddings: boolean
  supports_vision: boolean
  supports_json_mode: boolean
  max_context_tokens: integer
  max_parallel_model_calls: integer (1 for local, N for remote)
  local_or_remote: enum (local | remote)
  privacy_class: enum (strict | restricted | permissive)
}
```

## 5. Topology Selection Algorithm

Loom chooses the execution topology at run creation based on:
1. **User Setting**: Explicit user overrides (e.g., "Force Local Mode").
2. **Provider Capabilities**: Selected profiles' `local_or_remote` and `max_parallel_model_calls`.
3. **Privacy Mode**: If a task involves strict-privacy context, Loom restricts it to local topologies.
4. **Task Complexity**: Single-turn chat defaults to `local_single_agent` if sufficient; complex plans invoke `hybrid_multi_agent` or `remote_multi_agent`.
5. **Model Availability**: Health checks on local/remote providers.
6. **Cost/Rate Limits**: Enforced bounds on cloud usage.
7. **Local Hardware Capacity**: System VRAM/RAM constraints dictate the queuing depth.

## 6. Agent Runtime Interaction

- **AgentRun Creation**: Topology is determined before the run enters the `running` state. The ProviderBinding is finalized.
- **SubAgent Creation**: Subagents inherit the parent's topology unless explicitly bound to a hybrid role.
- **Child Run Scheduling**:
  - In `remote_multi_agent`, child runs dispatch immediately.
  - In `local_sequential_multi_agent`, child runs queue on a provider semaphore.
- **Cancellation**: Cancelling a parallel remote run stops all network streams. Cancelling a queued local run removes it from the queue and stops the active stream.
- **Event Ordering**: Sequential topologies yield strictly ordered events. Parallel topologies yield interleaved correlation events.
- **Context Snapshot Creation**: Always local, preceding model execution.
- **Failure/Retry Behavior**: Topologies dictate backpressure (429 retries for remote, OOM/timeout handling for local).

## 7. UI/UX Surface

The topology directly affects the user interface:

- **Local Safe Mode**:
  - UI indicates "100% Local" (e.g., a shield icon).
  - Expect slower, sequential progress bars.
  - Total privacy guarantee.
- **Cloud Multi-Agent Mode**:
  - UI indicates parallel execution (e.g., multiple agent avatars thinking simultaneously).
  - Explicit privacy warning: "Context leaves machine."
  - High performance and rapid streaming.
- **Hybrid Mode**:
  - UI visually separates local ("Thinking...") and remote ("Cloud Processing...") tasks.
  - Only specific artifacts leave the machine; core memory graph remains private.

## 8. Privacy Model

Loom asserts strict control over data flow.
- Memory, SQLite Graph, and Retrieval indices are always stored locally.
- In Remote/Hybrid modes, the Context Selection algorithm sanitizes payloads. `always_include` memories and retrieved chunks are attached, but raw thinking and internal metadata are filtered out before transmission.
- Provider Binding restricts strict-privacy tasks from executing on permissive (cloud) providers.

## 9. Failure and Fallback Behavior

- **Remote Fallback**: If a remote provider fails (e.g., OpenAI outage), Loom may fallback to a secondary remote provider (e.g., OpenRouter) if authorized.
- **Local Fallback**: If local hardware OOMs, the queue drops concurrency to 1, or aborts the run with a safe `failed` terminal outcome.
- **Network Degradation**: If offline, Hybrid/Remote topologies gracefully fail or fall back to `local_sequential_multi_agent` if the local model fits the task.

## 10. Future Roadmap Hooks

The design supports:
- **Subagents**: Built-in support for hierarchical or parallel swarms.
- **Tool Runtime**: Distinct from model concurrency. Tools can parallelize even when the model queues.
- **MCP Runtime**: Model Context Protocol can run locally or remotely as tools.
- **Planner/Executor**: Hybrid mode perfectly supports a cloud planner and local executors.
- **Provider Pool**: Round-robin or load-balancing across multiple local/remote endpoints.
- **Rate Limit Backpressure**: Required foundation for remote parallel execution.
- **Offline Mode**: Supported via strict local topology routing.

## 11. Final Recommendations

1. **Immediate Next Step**: Define the Provider Concurrency Policy (`PROVIDER-CONCURRENCY-POLICY-DESIGN-001`) to handle queueing and rate limit backpressure.
2. Adopt the Capability Model on all existing Provider Profiles.
3. Enforce the `max_parallel_model_calls = 1` constraint on the Ollama provider immediately to prevent local OOMs during testing.
