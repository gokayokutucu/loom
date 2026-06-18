# Task MEMORY-POLICY-SQLITE-001 v1.0

## Goal

Extend the existing SQLite Memory schema and repository DTOs for future Memory Policy Engine behavior.

## Checklist

- [x] Confirm migration 0013 owns `memories` and `memory_events`.
- [x] Confirm no `memory_provenance` table is required.
- [x] Add ALTER-only migration 0025.
- [x] Register migration 0025.
- [x] Extend Memory repository and API DTOs with nullable/defaulted policy fields.
- [x] Preserve existing Memory creation behavior.
- [x] Reuse append-only `memory_events` without redesign.
- [x] Add schema, constraint, compatibility, and privacy tests.
- [x] Complete full validation and runtime verification.
- [x] Commit with `feat: add memory policy schema foundation`.

## Existing Schema Mapping

- Applicable Loom scope remains `source_loom_id`.
- Existing source provenance remains `source_response_id`.
- New extraction provenance uses `origin_response_id`.
- Lifecycle history remains append-only in `memory_events`.
