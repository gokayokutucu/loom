# QA SQLITE-PROJECTION-CONTRACTS-001 v1.0

## Architecture QA

- [x] SQLite remains the source of truth.
- [x] Projection metadata does not store embeddings or external index payloads.
- [x] Future LanceDB/Tantivy adapters can rebuild from SQLite identity metadata.
- [x] Retrieval engines remain candidate producers only.
- [x] Context Manager prompt assembly remains out of scope.

## Privacy QA

- [x] Raw thinking is not a projection source.
- [x] Agent events are not a projection source.
- [x] Provider delta text is not a projection source.
- [x] Tool output summaries are not a projection source.
- [x] Prompt envelopes are not a projection source.
- [x] Secrets and credential markers are rejected from projection candidates.

## Product Isolation QA

- [x] Main generation behavior is untouched.
- [x] Quick Ask behavior is untouched.
- [x] No frontend UI is added.
- [x] No LanceDB/Tantivy/vector DB integration is added.

## Validation Evidence

- [x] Targeted retrieval projection Rust tests passed.
- [x] Full validation passed.
- [x] Packaged Electron validation passed.
- [x] Fresh binary/runtime validation reported.
- [x] Commit hash recorded in final task report.
