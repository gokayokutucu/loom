# QA LANCEDB-RETRIEVAL-ADAPTER-001 v1.0

## Privacy

- [x] LanceDB stores canonical projection identity, embedding metadata, and vectors only.
- [x] Source content remains SQLite-owned and is not stored as a LanceDB text column.
- [x] Raw thinking markers are rejected before embedding.
- [x] Agent runs/events/steps are not projection sources.
- [x] Provider payloads, provider deltas, prompt envelopes, secrets, and credentials remain excluded.

## Architecture

- [x] SQLite remains source of truth.
- [x] LanceDB is rebuildable projection only.
- [x] LanceDB does not mint canonical identities.
- [x] Retrieval returns candidates only.
- [x] Embedding generation is behind a provider-neutral boundary.
- [x] Tests use deterministic fake embeddings.

## Product Isolation

- [x] Main generation is untouched.
- [x] Quick Ask is untouched.
- [x] Agent Runtime behavior is untouched.
- [x] No Context Manager integration is added.
- [x] No UI is added.

## Remaining QA

- [x] Full service validation passes.
- [x] Fresh debug runtime verification reports `runtime_binary_mismatch=false`.
- [x] Electron packaged build validation passes.
- [x] Packaged sidecar binary matches the release service binary.
- [x] Packaged sidecar launch health smoke passes with `runtime_binary_mismatch=false`.
- [x] Packaged sidecar process cleanup and port release are verified.
