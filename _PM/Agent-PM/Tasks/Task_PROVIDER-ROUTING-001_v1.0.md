# Task: PROVIDER-ROUTING-001 (v1.0)

Checklist for implementing provider routing:

- [x] Investigate current generation request payload builder functions in `src/engine/RustHttpLoomEngineClient.ts`
- [x] Add `providerProfileId` optional property to `SendMessageInput`, `RegenerateFromResponseInput`, and `RetryUserMessageInput` in `src/engine/LoomEngineTypes.ts`
- [x] Update `executePayload`, `regeneratePayload`, and `retryPayload` to include `providerProfileId` in `src/engine/RustHttpLoomEngineClient.ts`
- [x] Wire `providerProfileId` in `App.tsx` generation calls using `resolveModelSelection`
- [x] Add `provider_profile_id` optional field to Rust structs (`OrchestrationExecuteInput`, `RegenerateResponseInput`, `RetryResponseInput`) in `services/loom-service/src/api/orchestration.rs`
- [x] Update manual constructions of `OrchestrationExecuteInput` in Rust to set `provider_profile_id`
- [x] Add Rust test case in `orchestration.rs` to verify deserialization of `providerProfileId` works and legacy payload works
- [x] Add unit tests in `src/engine/RustHttpLoomEngineClient.test.ts` to verify payloads are built and sent with `providerProfileId`
- [x] Run `npm run test:unit` and verify all tests pass
- [x] Run `npm run build` and verify compilation passes
- [x] Run cargo check, cargo fmt, and cargo test for Rust backend
- [x] Check formatting with `git diff --check`
