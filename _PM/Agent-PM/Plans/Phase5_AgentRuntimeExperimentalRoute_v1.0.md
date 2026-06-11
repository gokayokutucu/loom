# Phase 5: Agent Runtime Experimental Route Plan v1.0

## Objective
Expose the internal `AgentRuntimeService` through a gated, experimental HTTP route in `loom-service` for service-level stream proof — with zero default behavior change.

## Scope & Prerequisites
- Builds on AGENT-RUNTIME-API-INTERNAL-001.
- Route: `POST /experimental/agent/run`, NDJSON stream of safe `AgentEvent` values.
- Gate: `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API=1` (or `true`); the route is **not mounted at all** by default (`ExperimentalApiConfig`), so disabled means 404 with no handler execution.
- Route DTO is separate from the internal request and uses `deny_unknown_fields` to reject raw provider payloads, API keys, or Authorization-style fields.
- This is NOT the production generation path: Main generation and Quick Ask remain untouched (static guard now sweeps all of `src/api`).
- No frontend, Electron/Tauri, persistence, retrieval, tool execution, or MCP changes.
- Cancellation route deferred to AGENT-RUNTIME-CANCELLATION-001.

## Changelog
- **v1.0**: Initial plan for AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001.
