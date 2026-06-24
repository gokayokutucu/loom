# Test MAIN-GENERATION-AGENTRUN-SHIM-001 v1.0

Status: ACTIVE

## Automated Tests

- [x] Prove Main Generation shim creates a durable AgentRun record.
- [x] Prove AgentRun metadata links Loom, assistant response, and parent user response when available.
- [x] Prove legacy ContextManager input is supplied to the AgentRuntime seam as `legacyContext`.
- [x] Prove context metadata records `contextBuilt=true` without storing raw context bodies.
- [x] Prove AgentRun lifecycle event order is `run_created`, `run_queued`, `run_started`, `main_generation_context_built`, terminal event.
- [x] Prove successful generation mirrors to `completed`.
- [x] Prove failed generation mirrors to `failed`.
- [x] Prove prompt text and provider request/response markers are absent from AgentRun events.
- [x] Prove existing Quick Ask tests still pass unchanged.
- [x] Run full Rust service test suite.
- [x] Run npm service and frontend validation.
- [x] Run package/runtime smoke validation.

## Manual/Runtime Tests

- [x] Start fresh debug service with isolated DB/config and verify `/health`.
- [x] Run available main generation smoke without external provider secrets.
- [x] Stop debug process and verify port release.
- [x] Start packaged sidecar with isolated DB/config and verify `/health`.
- [x] Stop packaged sidecar and verify port release.
