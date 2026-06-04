# PROVIDER-RUNTIME-MODEL-PICKER-MIGRATION-001

## Objective

Migrate Main model selection from ambiguous model string state to explicit provider-profile-aware selection while preserving Ollama defaults and keeping Quick Ask local.

## Checklist

- [x] Audit composer Main model picker and Settings provider selection flows.
- [x] Add non-secret provider profile metadata to Main provider settings state.
- [x] Preserve old `mainModelId` as Ollama/local when provider profile is missing.
- [x] Show remote selected Main profile/model in the composer model picker.
- [x] Keep local Ollama models as switch-back choices when available.
- [x] Sync Settings "Use for Main" to provider-aware local state and service config.
- [x] Keep Quick Ask model selection unchanged.
- [x] Avoid local Ollama queue/readiness blocking for remote Main selection.
- [x] Add unit tests and product-service-backed E2E coverage.
- [x] Run validation.

## Notes

- Raw API keys are not stored in provider settings state.
- Remote provider selection remains explicit and reversible.
- Remote provider discovery/model catalog UX remains a follow-up.
