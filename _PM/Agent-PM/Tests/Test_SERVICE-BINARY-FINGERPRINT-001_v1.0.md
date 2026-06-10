# Test Execution Plan: SERVICE-BINARY-FINGERPRINT-001

## Test Cases

### 1. Backend API response structure
- [x] Call `GET /health` on rebuilt service.
- [x] Verify root-level properties exist and have valid values:
  - `status` (String)
  - `service_version` (String matching Cargo version)
  - `git_commit` (Sha1 hash length or "unknown")
  - `build_timestamp` (ISO 8601 UTC formatted date-time string)
  - `binary_path` (Absolute path to executable)
  - `binary_fingerprint` (Prefixed with `sha256:`)

### 2. Fingerprint Stability & Changes
- [x] Rebuilding the service without any changes produces a stable `binary_fingerprint`.
- [x] Modifying a source file (e.g. adding a comment in `main.rs`) and rebuilding changes the `binary_fingerprint` and updates `build_timestamp`.
- [x] Fingerprint is cached in memory and does not trigger disk I/O on every `/health` request.

### 3. Electron Startup & Mismatch Enforcement
- [x] Running Electron with matching binary starts normally and logs fresh status.
- [x] Modifying the binary after startup or running against a mismatched binary triggers `runtime_binary_mismatch` error and blocks sidecar attachment.

### 4. UI Freshness Display
- [x] Verify settings panel displays `Runtime Freshness: ✓ Fresh` when fingerprints match.
- [x] Verify settings panel displays `Runtime Freshness: ⚠ runtime_binary_mismatch` when fingerprints mismatch.
