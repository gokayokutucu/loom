# QA SCOPE-RESOLUTION-001 v1.0

## Architecture

- [x] Scope Resolution answers where it is valid to look.
- [x] Hybrid Retrieval remains responsible for relevance.
- [x] Context Selection is not implemented.
- [x] Context Manager is not implemented.
- [x] Prompt assembly is not implemented.
- [x] Token budgeting is not implemented.
- [x] Memory Policy is not implemented.
- [x] Tool/MCP execution is not implemented.
- [x] UI behavior is unchanged.

## Contracts

- [x] `ScopeResolutionService` is internal/foundation-level.
- [x] `ScopeResolutionRequest` carries active Loom, agent run, explicit references, and options.
- [x] `ScopeContext` carries descriptors and retrieval allowlists.
- [x] `ScopeDescriptor` carries scope type, priority, status, visibility, and metadata counts.
- [x] Reserved scopes are present without migrations.
- [x] `RetrievalQuery.loom_ids` is additive and empty means no Loom filter.

## Privacy

- [x] Scope diagnostics include counts/status/booleans only.
- [x] Diagnostics include no content.
- [x] Diagnostics include no query text.
- [x] Diagnostics include no Loom names or IDs.
- [x] Diagnostics include no source IDs or chunk refs.
- [x] Diagnostics include no memory content.
- [x] Diagnostics include no attachment content.
- [x] Diagnostics include no raw thinking.
- [x] Diagnostics include no secrets.

## Validation QA

- [x] Full validation passes.
- [x] Fresh debug runtime verification reports `runtime_binary_mismatch=false`.
- [x] Electron packaged build validation passes.
- [x] Packaged sidecar binary matches the release service binary.
- [x] Packaged sidecar launch health smoke passes.

## Notes

- The sandboxed `./loom.sh --publish --test` attempt failed because two tests could not bind local loopback servers. The rerun with explicit loopback bind permission passed.
- Electron macOS icon packaging was verified: `loom_logo.icns` is packaged, byte-identical to `public/loom_logo.icns`, `CFBundleIconFile` is `loom_logo.icns`, and `electron.icns` is absent.
