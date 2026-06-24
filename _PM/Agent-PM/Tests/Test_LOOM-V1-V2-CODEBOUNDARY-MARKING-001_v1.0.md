# Test Plan: LOOM-V1-V2-CODEBOUNDARY-MARKING-001 v1.0

## Annotation Verification

- [x] File/module-level markers use the requested `LOOM_BOUNDARY` format.
- [x] Method-level markers use the requested `LOOM_BOUNDARY_METHOD` format.
- [x] V1 shim paths are marked as no-new-features / needs bridge.
- [x] Knowledge Layer paths are marked canonical and consumed by V2.
- [x] V2 runtime paths are marked canonical.
- [x] Disconnected ProviderRuntime bridge need is visible.
- [x] ProviderPipeline direct streaming path is marked `NEEDS_BRIDGE`.
- [x] Marker documentation is created.

## Behavior-Neutral Validation

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

## Runtime Verification

- [x] Fresh debug service starts with isolated DB/config.
- [x] Fresh debug service `/health` reports ready.
- [x] Fresh debug service stops and releases port.
- [x] Packaged sidecar starts with isolated DB/config.
- [x] Packaged sidecar `/health` reports ready.
- [x] Packaged sidecar stops and releases port.
