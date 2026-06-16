# Test HYBRID-RETRIEVAL-SERVICE-001 v1.0

## Rust Tests

- [x] Pure RRF fusion combines two sources.
- [x] Domain rank pre-shift affects source-local rank ordering.
- [x] Dedupe merges Tantivy and LanceDB candidates by projection identity.
- [x] Digest mismatch is recorded as diagnostics and does not reject candidates.
- [x] `KeywordOnly` mode queries Tantivy only.
- [x] `SemanticOnly` mode queries LanceDB only.
- [x] Hybrid mode degrades when one source is unavailable.
- [x] Both sources unavailable returns empty result with diagnostics.
- [x] Source search failure returns partial result with diagnostics.
- [x] `max_candidates` trims fused output.
- [x] BM25/vector rank signals are preserved.
- [x] Preview output is bounded.
- [x] Raw thinking markers are not returned in previews.
- [x] Secret markers are not returned in previews.
- [x] Source filtering applies across sources.
- [x] Agent run/event/step source kinds are excluded.
- [x] Tie ordering is deterministic.

## Validation Commands

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml` — 877 tests.
- [x] `npm run service:check`
- [x] `npm run service:test` — 877 tests.
- [x] `npm run build`
- [x] `npx vitest run` — 559 tests.
- [x] `git diff --check`
- [x] `./loom.sh --publish --test`
- [x] Fresh runtime `/health` verification on `127.0.0.1:17646`.
- [x] `npm run electron:package:dev`
- [x] Packaged sidecar health/fingerprint verification on `127.0.0.1:17647`.

## Runtime Evidence

- [x] Fresh debug runtime PID `41236`, binary `/Users/gokay/Documents/Workspace/LoomAI/services/loom-service/target/debug/loom-service`, inode `196493450`.
- [x] Fresh debug runtime fingerprint `sha256:87d8dcd85d5a5b8faa5c90c2ddc2be85348bf8f980238bcbdb14731321efa3ca`.
- [x] Fresh debug runtime used temp config `/var/folders/dj/hq4144vd0ysfw7xzq45jtms00000gn/T/loom-hybrid-runtime-smoke-FaqVDy/loom-service.toml` and temp DB `/var/folders/dj/hq4144vd0ysfw7xzq45jtms00000gn/T/loom-hybrid-runtime-smoke-FaqVDy/loom.db`.
- [x] Fresh debug runtime `runtime_binary_mismatch=false`; process stopped with `SIGTERM`; port `17646` released.
- [x] Packaged sidecar PID `49056`, binary `/Users/gokay/Documents/Workspace/LoomAI/dist-electron/Loom.app/Contents/Resources/loom-service/loom-service`, inode `196496658`.
- [x] Packaged sidecar fingerprint `sha256:44142c749ae1cd89a42a338dac9bd137a901922cf8b80fa52395730456c0202b`.
- [x] Packaged sidecar used temp config `/var/folders/dj/hq4144vd0ysfw7xzq45jtms00000gn/T/loom-hybrid-packaged-sidecar-smoke-M1C1Rt/loom-service.toml` and temp DB `/var/folders/dj/hq4144vd0ysfw7xzq45jtms00000gn/T/loom-hybrid-packaged-sidecar-smoke-M1C1Rt/loom.db`.
- [x] Packaged sidecar `runtime_binary_mismatch=false`; process stopped with `SIGTERM`; port `17647` released.
- [x] Packaged app startup smoke launched `/Users/gokay/Documents/Workspace/LoomAI/dist-electron/Loom.app/Contents/MacOS/Electron` with temp HOME `/var/folders/dj/hq4144vd0ysfw7xzq45jtms00000gn/T/loom-packaged-app-home-pB1EXD`.
- [x] Packaged app startup smoke verified sidecar health on `127.0.0.1:17648`, app PID `57643`, fingerprint `sha256:44142c749ae1cd89a42a338dac9bd137a901922cf8b80fa52395730456c0202b`; app exited with code `0` and port `17648` released.
