# PROVIDER-SETTINGS-PROFILES-UX-001 Test Plan

## Unit Tests

- [x] Provider profile helper classifies local vs remote profiles.
- [x] Remote profile with `requiresSecret=true` reports Missing/Saved status safely.
- [x] Experimental Rig profile reports experimental/Rig badges.
- [x] Remote enable requires privacy acknowledgement.
- [x] Remote enable requires saved secret when a secret is required.
- [x] Rust HTTP client hydrates `providers.profiles`.
- [x] Rust HTTP client maps provider secret status responses.
- [x] Rust HTTP client hits provider secret set/status/test/delete endpoints.
- [x] Rust HTTP client returned status does not contain raw secret value.

## Validation

- [x] `npm run build`
- [x] `npx vitest run src/services/providerProfiles.test.ts src/engine/RustHttpLoomEngineClient.test.ts src/services/modelProviders.test.ts`
- [x] `npx vitest run`
- [x] Browser smoke for Settings → Providers
- [x] `git diff --check`
