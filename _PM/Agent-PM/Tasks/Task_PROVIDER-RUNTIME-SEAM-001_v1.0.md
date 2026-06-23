# Task: PROVIDER-RUNTIME-SEAM-001 v1.0

## Objective

Introduce the first provider runtime seam that connects AgentRun lifecycle concepts to provider execution metadata without performing real model calls.

## Scope

- [x] Audit provider topology, concurrency, AgentRun, and event contracts.
- [x] Define safe `ProviderExecutionRequest` metadata type.
- [x] Define safe `ProviderExecutionResult` metadata type.
- [x] Define `ProviderExecutionStatus`.
- [x] Add a provider runtime service module.
- [x] Add a fake/noop provider executor for tests only.
- [x] Keep provider runtime in-memory because no provider execution schema exists.
- [x] Prepare metadata-only provider runtime events.
- [x] Reject forbidden prompt, provider payload, raw output, token/secret, and raw-thinking markers.
- [x] Avoid real OpenAI, Claude, Gemini, Ollama, LiteLLM, local model, or network execution.
- [x] Preserve existing AgentRun and Tool Scheduler contracts.

## Out Of Scope

- [x] No real provider execution.
- [x] No streaming model output.
- [x] No UI changes.
- [x] No Context Manager changes.
- [x] No prompt/provider payload persistence.
- [x] No tool adapter or MCP implementation.
- [x] No push.

## Implementation Notes

- Provider execution records are process-local metadata records.
- AgentRun integration is by explicit `agent_run_id` and `root_run_id` metadata only.
- Durable persistence is intentionally deferred until a provider execution schema is designed.
