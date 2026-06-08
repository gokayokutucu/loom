# QA Checklist: PROVIDER-PERSISTENCE-001 (v1.0)

Quality Assurance post-implementation review:

- [x] Check legacy restore: Verify that a client with legacy `mainModelId` only gets its provider profile resolved correctly on startup.
- [x] Check exact restore: Verify that a client with active `mainProviderProfileId` and `mainModelId` has the exact pair restored.
- [x] Check missing fallback: Verify that if the saved provider profile is deleted or offline, it falls back to resolver.
- [x] Check UI consistency: Verify that app restarts, settings closes/reopens, and picker opens preserve selection state.
- [x] Verify no backend schema, endpoints, or contracts are modified.
- [x] Verify `npm run test:unit` passes successfully.
- [x] Verify `npm run build` compiles with no errors.
