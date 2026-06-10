# Phase 4 — Provider Runtime: Concurrency & Fingerprinting
## Task: SERVICE-BINARY-FINGERPRINT-001
### Changelog from v1.0
- Updated to specify the exact root-level fields for `GET /health` required by the task description (`service_version`, `git_commit`, `build_timestamp`, `binary_path`, `binary_fingerprint`).
- Added compile-time generation of git commit and build timestamp using a Cargo build script `build.rs`.
- Added Electron sidecar manager level verification of binary fingerprints on both startup and connection recovery.

### Objective
Expose immutable runtime identity information from `loom-service` and allow the UI/Electron to detect and block stale binaries.

### Scope

#### Phase 1: Backend
- Create `services/loom-service/build.rs` to generate compile-time git commit hash and ISO 8601 UTC build timestamp, exposed as `GIT_COMMIT` and `BUILD_TIMESTAMP` env vars.
- Update `services/loom-service/src/api/health.rs` to hash the running binary using SHA-256 (cached with `OnceLock`).
- Expose the new root-level snake_case fields: `service_version`, `git_commit`, `build_timestamp`, `binary_path`, `binary_fingerprint` in `HealthResponse`.

#### Phase 2: Frontend
- Add new properties to `ServiceHealthStatus` interface in `src/engine/LoomEngineTypes.ts`.
- Map the new fields in `RustHttpLoomEngineClient.ts`.
- In `src/components/AIProviderSettings.tsx`, compare running service fingerprint vs expected packaged fingerprint and display `Runtime Freshness: ✓ Fresh` or `⚠ runtime_binary_mismatch`.

#### Phase 3: Electron
- Add SHA-256 fingerprint calculations in `electron/sidecar-manager.mjs`.
- Compare expected packaged fingerprint with running service fingerprint in `recoverExistingRuntime` and `waitForHealth`.
- Throw mismatch error and block startup if they do not match.
