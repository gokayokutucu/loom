# Task Checklist: SERVICE-BINARY-FINGERPRINT-001

## 1. Rust Service Changes
- [ ] Add `service_start_time` field to `AppState` struct in `services/loom-service/src/api/state.rs`
- [ ] Initialize `service_start_time` in `services/loom-service/src/main.rs` and the test harness/mock state creators
- [ ] Add `LoomServiceFingerprint` struct and lightweight time formatting in `services/loom-service/src/api/health.rs`
- [ ] Extend `HealthResponse` struct to contain the `fingerprint` property
- [ ] Implement fingerprint population in the `/health` handler
- [ ] Add unit tests verifying fingerprint values and safety properties (e.g. no secrets or env vars) in `health.rs`

## 2. TypeScript Client Integration
- [ ] Update `HealthResponse` interface in `src/engine/LoomEngineTypes.ts` to include optional/nullable `fingerprint` types
- [ ] Ensure `RustHttpLoomEngineClient.ts` maps this structure safely and tolerates missing or older service formats

## 3. Validation Helpers
- [ ] Update `loom.sh` to extract and print `/health` fingerprint details when validating the service

## 4. Verification & E2E
- [ ] Verify that tests build and pass using local test scripts
- [ ] Run `./loom.sh --publish --test`
