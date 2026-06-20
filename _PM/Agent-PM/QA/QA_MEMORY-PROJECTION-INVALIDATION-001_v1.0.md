# QA MEMORY-PROJECTION-INVALIDATION-001 v1.0

## Architecture

- [x] SQLite remains canonical authority.
- [x] Invalidation commits atomically with create, forget, and supersession state.
- [x] Projection identity remains deterministic and shared by both adapters.
- [x] Tantivy and LanceDB remain rebuildable projections.
- [x] Memory requests do not perform index I/O or embedding work.
- [x] Duplicate and policy-only updates avoid unnecessary reindex work.
- [x] No Retrieval ranking, Context Selection, Context Manager, Main, or Quick Ask behavior changes.

## Privacy

- [x] Invalidation metadata is identity/state/timestamp only.
- [x] No Memory content, prompt, provider payload, raw thinking, vector, or sensitive value is added.
- [x] PM documentation contains no runtime-local identifiers or sensitive values.

## Verification

- [x] Full automated validation passes.
- [ ] Fresh debug create/forget invalidation verification passes.
- [ ] Packaged sidecar create/forget invalidation verification passes.

## QA Result

Automated validation passed. Live debug and packaged-sidecar verification remain blocked because the required out-of-sandbox process-start approval was unavailable; the task stays active and uncommitted.
