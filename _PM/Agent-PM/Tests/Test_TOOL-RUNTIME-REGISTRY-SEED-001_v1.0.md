# TOOL-RUNTIME-REGISTRY-SEED-001 Test Evidence

## Catalog Contract

- [x] Exactly four canonical descriptors are registered; no extras exist.
- [x] All descriptors are enabled, `NotAvailable`, and `AlwaysAllowed`.
- [x] Metadata and minimal schemas match the approved contract.
- [x] Repeated seeding preserves count, metadata, and schemas.
- [x] Listing order is deterministic by canonical name.

## Shared Registry and Introspection

- [x] Startup seeds before AppState shares the registry.
- [x] AgentRuntimeService and ToolRuntimeBoundary retain the same registry ownership chain.
- [x] Experimental tools route remains absent when the gate is disabled.
- [x] Enabled introspection returns four descriptors and `executionEnabled: false`.
- [x] Repeated introspection responses are identical.

## Execution and Privacy

- [x] Every seeded descriptor resolves to a skipped invocation.
- [x] `TOOL_EXECUTION_NOT_IMPLEMENTED` remains the stable non-execution code.
- [x] No handler or execution primitive is introduced.
- [x] Serialized metadata and schemas contain no credential or private-reasoning fields.
- [x] Main generation and Quick Ask static isolation guards remain active.

## Validation Matrix

Rust formatting/check/tests, service scripts, frontend build/unit tests, repository diff checks,
the root validation helper, and packaged Electron fresh-sidecar validation are required.
