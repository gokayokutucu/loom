# Canonical LLM Contract Review

This review evaluates whether Loom's current `ProviderAdapter` and `ProviderPipeline` stream contracts are sufficiently provider-agnostic to support native OpenAI, Anthropic, and Gemini adapters.

---

## 1. Provider Abstraction Analysis

The backend provider interface in Loom consists of three main layers:
1. **`ProviderAdapter` (Trait)**: Defines the common interface for all adapters.
   - Requires implementing `provider_kind()`, `provider_profile_id()`, `capabilities()`, `stream_chat()`, and `cancel()`.
2. **`ProviderRegistry` (Struct)**: Aggregates active adapters and resolves configuration-specific overrides (like `mainProviderProfileId`).
3. **`ProviderPipeline` (Struct)**: Wraps a registry, extracts default generation profiles and capabilities, and exposes a high-level `stream_chat()` method returning `ProviderEventStream`.

### Current Adapters
- **`OllamaProviderAdapter`**: Maps Ollama ndjson streams.
- **`OpenAiCompatibleProviderAdapter`**: Maps standard OpenAI-compatible completions.

---

## 2. Streaming Model Evaluation

Loom uses a unified `ProviderContractEvent` enum to communicate stream chunks from the adapters to the orchestrator:
*   `Delta { text: String }`: Accumulates visible text chunk.
*   `ThinkingDelta { text: String }`: Accumulates model reasoning (private).
*   `ThinkingStatus { status, duration_ms, token_estimate }`: Exposes reasoning progress metadata.
*   `Completed { done_reason, usage }`: Emitted when generation halts successfully.
*   `Truncated { done_reason, usage }`: Emitted if output or context limits are hit.
*   `Error { error }`: Carries a structured `ProviderError`.
*   `Cancelled`: Emitted if aborted by the client.

### Timeouts & Cancellations
- **Timeouts**: Handled inside the adapters via HTTP client timeouts (`reqwest`).
- **Cancellations**: Handled via `cancel()` which signals cancellation registries (supported by Ollama via active request IDs, while standard REST endpoints rely on connection termination).

---

## 3. Tool and Function Calling Capability

### Current Abstraction Support
- **Does the current contract support tools?** **No**. 
  - `ProviderContractRequest` contains no `tools` array.
  - `ProviderContractMessage` and `ProviderContractMessageRole` have no representation for `tool`/`function` roles or tool call results.
  - `ProviderContractEvent` has no variants for streaming tool calls (`tool_calls` or `tool_use`).

### Mapping Native Tool Calls
- **OpenAI `tool_calls`**, **Anthropic `tool_use`**, and **Gemini `functionCall`** **cannot** be mapped using the current core stream abstractions.
- *Required changes to add tool calling*:
  1. Add `tools` definition field to `ProviderContractRequest` and `OrchestrationExecuteInput`.
  2. Add `tool` or `functionResponse` role to message structures.
  3. Introduce a `ToolCall` and `ToolCallDelta` variant to `ProviderContractEvent` to support tool arguments stream accumulation.

---

## 4. Provider Response Mapping

- **Translation**: Provider-specific response structures are completely translated inside the adapters (e.g. `openai_compatible.rs` or `adapter.rs`) before emitting to the stream.
- **Leakage**: The current mapping implementation is highly clean and does not leak provider-specific fields upward.
- **UI Agnosticism**: The UI only consumes generic SSE events (`"response.delta"`, `"response.completed"`, `"response.error"`, `"orchestration.progress"`) emitted by the orchestrator.

---

## 5. Native Adapter Readiness

| Provider | Can implement without changing abstraction? | Missing Fields/Events |
| :--- | :--- | :--- |
| **OpenAI Native** | **Yes** (Identical structure to current OpenAI-compatible adapter) | None |
| **Anthropic Native** | **Yes** (Messages and SSE event chunks map cleanly to `Delta` and `Completed` events) | None (unless tool calling is required) |
| **Gemini Native** | **Yes** (JSON array chunks map cleanly to `Delta` and `Completed` events) | None (unless tool calling is required) |

---

## 6. Recommendation

### Selected Option: **A. Proceed directly to NATIVE-OPENAI-ADAPTER-001**

#### Rationale
Loom currently functions as an AI browser utilizing clean, text-based generation and reasoning streams. It does not implement any agentic tool/function calling workflows (such as web search or local file execution). 

Because the existing `ProviderContractRequest` and `ProviderContractEvent` traits support full text generation, multi-turn conversation, reasoning streams, and token usage reporting perfectly:
1. We can implement native OpenAI, Anthropic, and Gemini adapters directly on top of the current abstraction.
2. We should not prematurely expand the core contract for tool calling until an agentic feature (e.g., search integration or local MCP tools) explicitly demands it.
