# Phase 4 — Provider Runtime: Concurrency & Fingerprinting
## Task: SERVICE-BINARY-FINGERPRINT-001

Expose a safe runtime binary fingerprint in `/health` to detect stale service binaries and resolve mtime/inode/path mismatches.

### Objective
Add a safe `fingerprint` property to the `/health` JSON response returned by `loom-service`, expose it in the TypeScript client/types, and include it in standard validation scripts.

### Prerequisites
- Compiles via `cargo build` in `services/loom-service`.

### Technical Details
- Extend the `HealthResponse` struct in `services/loom-service/src/api/health.rs`.
- Retrieve binary path using `std::env::current_exe()`.
- Retrieve size, modification time (formatted as ISO 8601 UTC string), and inode (on Unix/macOS) from file metadata.
- Expose process ID using `std::process::id()`.
- Expose build profile ("debug" or "release") using `cfg!(debug_assertions)`.
- Store `serviceStartTime` as `SystemTime::now()` recorded during `AppState` construction.
- Formats dates using a lightweight, dependency-free UTC calendar formatting utility.
- Exclude secrets, environment variables, git commit hash, and user data to ensure privacy.
- Update `LoomEngineTypes.ts` and `RustHttpLoomEngineClient.ts` to type and map the new `fingerprint` field.
- Print fingerprint details in `loom.sh` validation output.
