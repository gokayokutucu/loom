# Task: PROVIDER-ABSTRACTION-001 - Provider Profile Abstraction (v1.0)

Task ID: `PROVIDER-ABSTRACTION-001`  
Goal: Introduce a frontend-side provider profile abstraction/discovery layer without adding UI provider selection yet.

## Tasks
- [x] Create `src/services/providerDiscovery.ts` defining type `ProviderProfile` and `normalizeRuntimeProvider` function.
- [x] Implement `normalizeRuntimeProvider` helper mapping properties and handling sandbox cases correctly.
- [x] Create `src/services/providerDiscovery.test.ts` implementing unit tests.
- [x] Run vitest unit tests: `npm run test:unit`.
- [x] Run typescript typechecking and build: `npm run build`.
- [x] Verify git diff syntax: `git diff --check`.
