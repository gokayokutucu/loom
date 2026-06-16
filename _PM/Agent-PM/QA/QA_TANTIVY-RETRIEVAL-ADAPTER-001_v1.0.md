# QA TANTIVY-RETRIEVAL-ADAPTER-001 v1.0

## Architecture QA

- [x] SQLite remains the source of truth.
- [x] Tantivy is a rebuildable projection only.
- [x] Deleting Tantivy cannot lose user knowledge.
- [x] Retrieval returns candidates only.
- [x] Retrieval does not assemble prompts.
- [x] Retrieval does not write memory.
- [x] Context Manager ownership remains unchanged.

## Privacy QA

- [x] Raw thinking is not indexed.
- [x] Agent runs/events are not indexed.
- [x] Provider payloads are not indexed.
- [x] Provider delta text is not indexed.
- [x] Prompt envelopes are not indexed.
- [x] Secrets and credentials are rejected.

## Validation Evidence

- [x] Targeted Tantivy adapter tests passed.
- [x] Full validation passed.
- [x] Packaged Electron validation passed.
- [x] Fresh binary/runtime validation reported.
- [ ] Commit hash recorded.
