# Test Plan: PROVIDER-RUNTIME-SEAM-001 v1.0

## Rust Provider Runtime Tests

- [x] Noop provider request transitions through queued, running, and completed.
- [x] Noop provider failure path records safe error code only.
- [x] Cancellation path is idempotent.
- [x] Timeout path is safe and terminal.
- [x] Skipped path is safe and terminal.
- [x] Forbidden markers in request metadata are rejected before storage.
- [x] Provider runtime results expose no prompt, provider payload, raw response, token, secret, or raw-thinking fields.
- [x] Provider runtime events are metadata only.
- [x] Static guard proves the seam does not call real provider runtime/client code.

## Regression Tests

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

- [x] Fresh debug service starts from rebuilt binary with isolated DB/config.
- [x] `/health` reports ready.
- [x] Debug service stops and releases port.
- [x] Packaged sidecar starts with isolated DB/config.
- [x] Packaged sidecar `/health` reports ready.
- [x] Packaged sidecar stops and releases port.
