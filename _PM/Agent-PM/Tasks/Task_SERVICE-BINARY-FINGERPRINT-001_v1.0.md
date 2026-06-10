# Task Checklist: SERVICE-BINARY-FINGERPRINT-001

## 1. Rust Service Changes
- [x] Create `services/loom-service/build.rs` to expose `GIT_COMMIT` and `BUILD_TIMESTAMP` at compile time.
- [x] Implement SHA-256 binary hashing with caching in `services/loom-service/src/api/health.rs`.
- [x] Add root-level fields `service_version`, `git_commit`, `build_timestamp`, `binary_path`, and `binary_fingerprint` to `HealthResponse`.
- [x] Add unit tests verifying fingerprint values and safety in `health.rs`.

## 2. Electron Integration
- [x] Implement `getBinaryFingerprint` in `electron/sidecar-manager.mjs` using `node:crypto` and `node:fs`.
- [x] Expose `expectedFingerprint` in `LoomServiceSidecarManager` status.
- [x] Add validation gates in `recoverExistingRuntime` and `waitForHealth` to block mismatched binaries.

## 3. Frontend Integration
- [x] Update `LoomEngineTypes.ts` with new health and desktop status fields.
- [x] Map snake_case fields in `RustHttpLoomEngineClient.ts`.
- [x] Render `Runtime Freshness` (`✓ Fresh` or `⚠ runtime_binary_mismatch`) in settings panels in `AIProviderSettings.tsx`.

## 4. Verification
- [x] Verify that tests build and pass using local test scripts.
- [x] Verify that building the service changes/updates the build timestamp and fingerprint as expected.
- [x] Run full local validation: `./loom.sh --publish --test`.
