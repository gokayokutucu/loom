# TOOL-RUNTIME-REGISTRY-SEED-001

## Summary

Implement the approved initial metadata-only Loom-native Tool Registry catalog.

## Accepted Catalog

| Name | Category | Availability | Permission | Enabled |
| --- | --- | --- | --- | --- |
| `loom.runtime.status` | `runtime` | `NotAvailable` | `AlwaysAllowed` | yes |
| `loom.loom.inspect` | `loom` | `NotAvailable` | `AlwaysAllowed` | yes |
| `loom.weft.inspect` | `weft` | `NotAvailable` | `AlwaysAllowed` | yes |
| `loom.response.read` | `response` | `NotAvailable` | `AlwaysAllowed` | yes |

The first `loom` segment is the namespace. The second segment is the canonical domain entity.
`loom.loom.inspect` is intentional. Weft remains a first-class derived Loom concept and is not
renamed to branch or fork.

## Implementation Record

- Add a catalog module containing descriptor metadata and minimal schemas.
- Seed before AppState shares the registry.
- Sort registry listing by canonical name.
- Keep seeding deterministic and idempotent through name-keyed upsert.
- Keep introspection gated with `executionEnabled: false`.
- Keep all invocation results non-executable.

## Out of Scope

Real execution, handlers, permission UI, MCP, retrieval, persistence, frontend changes, Main
generation changes, and Quick Ask changes remain deferred.
