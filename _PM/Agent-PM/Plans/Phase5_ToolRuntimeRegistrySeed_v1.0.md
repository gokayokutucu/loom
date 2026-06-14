# Phase 5 Tool Runtime Registry Seed Plan

## Objective

Seed the process-local shared Tool Registry with exactly four approved Loom-native descriptors:
`loom.runtime.status`, `loom.loom.inspect`, `loom.weft.inspect`, and `loom.response.read`.

## Implementation

1. Define descriptors in `agent_runtime/catalog.rs` with minimal JSON schema placeholders.
2. Seed once before the registry is wrapped in shared `Arc<RwLock<_>>` state.
3. Make registry listing deterministic by canonical tool name.
4. Preserve idempotency through the registry's name-keyed upsert behavior.
5. Keep every descriptor enabled, `NotAvailable`, and `AlwaysAllowed`.
6. Preserve `Skipped` / `TOOL_EXECUTION_NOT_IMPLEMENTED`; add no execution abstraction.
7. Keep the experimental HTTP route gated and default-off.

## Safety Boundaries

- No handlers, callbacks, closures, function pointers, or executable trait objects.
- No shell, filesystem, network, browser, code execution, MCP, retrieval, or persistence.
- No changes to Main generation, Quick Ask, or Agent Run Inspector.
- Schemas expose no credential, provider-envelope, local-path, or private-reasoning fields.

## Validation

Catalog, shared-state, introspection, non-execution, privacy, full project, and packaged Electron
validation must pass before completion.
