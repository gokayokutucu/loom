# Plan: Phase 4 Provider Routing (v1.0)

## Objective
Safely carry the provider-aware model selection (`providerProfileId`) into the generation request routing path from the frontend UI/client down to the backend `loom-service` orchestration endpoints, without changing the default generation or provider registry execution behaviors.

## Scope
1. **Frontend Type Extensions**:
   - Update `SendMessageInput`, `RegenerateFromResponseInput`, and `RetryUserMessageInput` in [LoomEngineTypes.ts](../../src/engine/LoomEngineTypes.ts) to include optional `providerProfileId?: string;`.
2. **Frontend Wiring**:
   - Update payload construction functions (`executePayload`, `regeneratePayload`, `retryPayload`) inside [RustHttpLoomEngineClient.ts](../../src/engine/RustHttpLoomEngineClient.ts) to carry the `providerProfileId` into JSON bodies.
   - Update call sites in `src/App.tsx` where these functions are invoked to retrieve the resolved `providerProfileId` from the selection helper and pass it along.
3. **Backend Compatibility**:
   - Update Rust API structs in [orchestration.rs](../../services/loom-service/src/api/orchestration.rs):
     - `OrchestrationExecuteInput`
     - `RegenerateResponseInput`
     - `RetryResponseInput`
     to include an optional `provider_profile_id: Option<String>` field (renamed from `providerProfileId` using `camelCase`).
   - Carry this field inside manual struct constructions in `regenerate` and `retry` functions.
   - Add tests to ensure that `providerProfileId` is safely ignored for now and that legacy payloads (without this field) still deserialize correctly.
4. **Unit Tests**:
   - Add frontend unit tests in [RustHttpLoomEngineClient.test.ts](../../src/engine/RustHttpLoomEngineClient.test.ts) to verify that `providerProfileId` is sent over HTTP when present, and omitted when undefined.
   - Add backend tests in [orchestration.rs](../../services/loom-service/src/api/orchestration.rs) to verify deserialization compatibility.

## Technical Prerequisites
- `modelSelectionResolver` returns a resolved `providerProfileId` on selection changes.
