# Task NATIVE-GEMINI-ADAPTER-001 v1.0

## Status
completed

## Checklist
- [x] Extend enums in `providers/config.rs` (`ProviderKind`, `ProviderTransportKind`, `ProviderVendor`)
- [x] Add `gemini_native_example` profile template in `providers/config.rs`
- [x] Register new environment variables and override logic in `config.rs`
- [x] Create `providers/gemini.rs` with `GeminiRuntime`, `GeminiProviderAdapter`, and unit tests
- [x] Register `gemini` module in `providers/mod.rs`
- [x] Add `gemini` routing in `providers/adapter.rs`
- [x] Add `Gemini` match arms in `api/capabilities.rs` and `api/model_runtime.rs`
- [x] Add `ProviderKind::Gemini` support in `capabilities/provider_discovery.rs` test helper
- [x] Implement local fake Gemini test server (`e2e/helpers/fakeGeminiServer.ts`)
- [x] Implement Playwright test suite `e2e/gemini-native-compatibility.spec.ts`
- [x] Verify build and tests pass successfully (`cargo check`, `cargo test`, `npm run service:check`, `npm run service:test`, `npm run test:unit`, `npm run build`, `git diff --check`)
