# Test: AGENT-RUNTIME-API-INTERNAL-001 v1.0

- [x] Service construction + execution test: `AgentRuntimeService` executes a fake-provider-backed run and emits `RunStarted` … `RunCompleted`.
- [x] Shared store test: an externally owned `AgentRunStore` (app-state pattern) observes runs executed through the service boundary.
- [x] Privacy test: service-path events drop `ThinkingDelta`/`ThinkingStatus`; serialized events contain no `raw_thinking`, `thinking_text`, `chain_of_thought`, `hidden_reasoning`, `Authorization`, or `Bearer`; the run store retains metadata only (no prompts/payloads/headers).
- [x] Cancellation placeholder test: `cancel(run_id)` flags `cancel_requested` in the store and invokes `ProviderPipeline::cancel_generation`.
- [x] Provider options test: default and custom `AgentRuntimeProviderOptions` flow through the service boundary into the provider request.
- [x] Static product-path guard: `orchestration.rs` and `ask.rs` sources contain no `AgentRuntimeService`, `execute_run`, or `agent_runtime()` references.
- [x] Existing foundation tests (lifecycle, error mapping, tool placeholder, serialization sweep) still pass unchanged.
