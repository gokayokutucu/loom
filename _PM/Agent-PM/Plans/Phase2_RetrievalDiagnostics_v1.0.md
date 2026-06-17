# Phase 2 Retrieval Diagnostics v1.0

## Objective

Harden retrieval diagnostics, health, staleness, and corruption reporting before Context
Selection and Context Manager consume Hybrid Retrieval.

## Scope

- Report SQLite retrieval projection source, chunk, tombstone, stale, and digest mismatch counts.
- Report Tantivy and LanceDB source health without exposing paths or raw errors.
- Classify missing, stale, corrupt, and version-mismatched retrieval sources.
- Summarize Hybrid Retrieval diagnostics in a content-free form.
- Keep diagnostics candidate-only and metadata-only.

## Out of Scope

- Context Selection.
- Context Manager.
- Memory writes.
- Tool execution.
- MCP.
- Main generation.
- Quick Ask.
- Prompt assembly.
- Token budgeting.

## Privacy Boundary

Diagnostics must not include query text, full content, source ids, chunk refs, content digest
values, vectors, prompt envelopes, provider payloads, provider deltas, raw thinking, secrets,
raw filesystem paths, or raw internal error strings.

## Rollout Notes

This is a health/observability layer only. Context Selection and Context Manager may later consume
the safe diagnostics summary, but this task does not start those integrations.

## Validation Summary

- Rust service validation passed, including 887 service tests.
- Frontend validation passed, including 559 Vitest tests.
- Full `./loom.sh --publish --test` passed after rerun with loopback bind permission.
- Fresh debug and packaged sidecar health smokes passed with `runtime_binary_mismatch=false`.
- Electron dev packaging and packaged app startup smoke passed.
