# QA Checklist: PROVIDER-SELECTION-001 (v1.0)

Quality Assurance post-implementation review:

- [x] Check grouping: Verify models are grouped under headers when `discoveredProfiles` is loaded.
- [x] Check headers: Verify headings display provider label, badge with provider kind, sandbox badge (where applicable), and model counts.
- [x] Check duplicate models: Verify that duplicate models appear under multiple groups and resolve to the correct provider+model pair.
- [x] Check fallback: Verify that flat fallback renders correctly when `discoveredProfiles` is empty.
- [x] Verify no settings screen or backend API changes are introduced.
- [x] Verify `npm run test:unit` passes successfully.
- [x] Verify `npm run build` compiles with no errors.
