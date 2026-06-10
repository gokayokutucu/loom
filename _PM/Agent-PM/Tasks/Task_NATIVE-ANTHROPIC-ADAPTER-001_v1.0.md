# Task NATIVE-ANTHROPIC-ADAPTER-001 v1.0

## Status
completed

## Checklist
- [x] Extend enums in `providers/config.rs` (`ProviderKind`, `ProviderTransportKind`, `ProviderVendor`)
- [x] Add `anthropic_native_example` profile template in `providers/config.rs`
- [x] Register new environment variables and override logic in `config.rs`
- [x] Create `providers/anthropic.rs` with `AnthropicRuntime`, `AnthropicProviderAdapter`, and unit tests
- [x] Register `anthropic` module in `providers/mod.rs`
- [x] Add `anthropic` routing in `providers/adapter.rs`
- [x] Add `Anthropic` match arms in `api/capabilities.rs` and `api/model_runtime.rs`
- [x] Implement local fake Anthropic test server and Playwright test suite `e2e/anthropic-native-compatibility.spec.ts`
- [x] Verify build and tests pass successfully (`cargo check`, `cargo test`, `npm run service:check`, `npm run service:test`, `npm run test:unit`, `npm run build`, `git diff --check`)

