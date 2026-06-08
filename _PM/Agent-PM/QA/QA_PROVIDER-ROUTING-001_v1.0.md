# QA Checklist: PROVIDER-ROUTING-001 (v1.0)

Quality Assurance post-implementation review:

- [x] Check type definitions: Verify optional `providerProfileId` in `SendMessageInput`, `RegenerateFromResponseInput`, and `RetryUserMessageInput`.
- [x] Check payload builders: Verify `providerProfileId` is serialized in JSON body of request envelopes.
- [x] Check wiring: Verify `App.tsx` passes resolved profile IDs to engine requests.
- [x] Check Rust: Verify `OrchestrationExecuteInput` and other inputs have optional `provider_profile_id` field and manual struct instantiations compile.
- [x] Verify no provider switching is actually performed yet (carry metadata safely only).
- [x] Verify `npm run test:unit` passes.
- [x] Verify `npm run build` compiles without errors.
- [x] Verify `cargo test` passes.
