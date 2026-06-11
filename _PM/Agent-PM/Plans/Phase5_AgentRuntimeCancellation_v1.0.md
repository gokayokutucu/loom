# Phase 5: Agent Runtime Cancellation Plan v1.0

## Objective

Expose safe, idempotent HTTP cancellation for runs started through the gated experimental Agent Runtime API.

## Scope

- Add `POST /experimental/agent/runs/:run_id/cancel` under the existing `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API` gate.
- Complete cooperative cancellation in `AgentRuntimeService` and `AgentRuntime` using process-local run state.
- Terminate an active NDJSON run stream with `run_cancelled`.
- Return a stable JSON cancellation response without prompts, provider payloads, credentials, or raw thinking.
- Preserve Main generation and Quick Ask behavior.

## Contract Decisions

- Unknown run: `404` with `status=not_found` and `cancelled=false`.
- Active run: `200` with `status=cancelled` and `cancelled=true`.
- Already cancelled run: idempotent `200` with `status=cancelled` and `cancelled=true`.
- Completed or failed run: idempotent `200`, unchanged terminal status, `cancelled=false`.
- The route is not mounted when the experimental gate is disabled.

## Validation

- Rust router/service/runtime tests.
- Full Rust service test suite.
- Frontend unit suite to prove no product-path regression.
- `./loom.sh --publish --test`.
- Fresh service binary and `/health` fingerprint verification.

## Changelog

- v1.0: Initial plan for AGENT-RUNTIME-CANCELLATION-001.
