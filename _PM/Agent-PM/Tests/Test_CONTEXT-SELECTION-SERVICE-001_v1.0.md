# Test CONTEXT-SELECTION-SERVICE-001 v1.0

## Selection Tests

- [x] Tier-first ordering is deterministic.
- [x] Same-tier score ordering is deterministic.
- [x] Memory type weighting is applied.
- [x] Retrieval-discovered Reference weighting is applied within Tier 8.
- [x] Weft candidates remain hidden background.
- [x] Mandatory References remain mandatory.
- [x] Cross-Loom and archived caps are enforced.
- [x] Reserved tiers are represented in diagnostics.
- [x] Empty retrieval still produces safe diagnostics.

## Snapshot Tests

- [x] Optional snapshot persistence creates parent and candidate rows.
- [x] Selected and rejected counts round-trip.
- [x] Snapshot does not mutate `agent_runs.context_snapshot_id`.

## Privacy Tests

- [x] Raw-thinking previews are removed.
- [x] Provider payload, secret, credential, vector, and raw-tool markers do not enter persisted metadata.
- [x] Diagnostics expose counts/status/booleans/timing only.
- [x] Agent audit source kinds are excluded.
- [x] Context payload contains no full-content or prompt field.
- [x] Main generation and Quick Ask modules remain unreferenced.

## Validation Commands

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `git diff --check`
- [x] `./loom.sh --publish --test`
- [x] `npm run electron:package:dev`
- [x] Fresh runtime `/health` verification.
- [ ] Packaged sidecar health and fingerprint verification.

Packaged/release fingerprints match, but packaged process launch health remains blocked by the external escalation usage limit.
