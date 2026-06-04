# PROVIDER-RUNTIME-MODEL-PICKER-MIGRATION-001 Test Plan

## Unit

- [x] Old `mainModelId`-only settings map to `ollama-local`.
- [x] Explicit remote Main selection preserves provider profile id and model id.
- [x] Remote model label includes provider display name.
- [x] Quick Ask remains string/local-model based.
- [x] Provider selection gates still block missing secret/invalid remote status.

## Product E2E

- [x] Default config does not auto-select NVIDIA.
- [x] Settings can select NVIDIA for Main after explicit privacy acknowledgement.
- [x] Composer model picker reflects selected NVIDIA profile/model.
- [x] Main submit routes to fake OpenAI-compatible NVIDIA provider.
- [x] Settings can switch Main back to Ollama Local.
- [x] Later submit does not route to NVIDIA.
- [x] Raw fake key and Authorization markers do not appear in UI or persisted payloads.

## Validation

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `E2E_PORT=5193 npx playwright test e2e/nvidia-openai-compatible-provider-poc.spec.ts`
- [x] `git diff --check`
