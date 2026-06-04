# PROVIDER-RUNTIME-REMOTE-SELECTION-UX-001

## Objective

Allow explicit remote provider profile/model selection for Main generation while keeping Ollama as the default and keeping Quick Ask local for this task.

## Scope

- [x] Audit Settings provider profile UI and service provider config shape.
- [x] Add provider-aware Main assignment fields to service config.
- [x] Preserve provider-aware Main assignment in the TypeScript engine client.
- [x] Route Main generation through the explicitly selected provider profile/model.
- [x] Add Settings provider card action for explicit Main selection.
- [x] Gate remote Main selection behind enabled profile, saved secret, privacy acknowledgement, and safe runtime status.
- [x] Run full Rust, frontend, and service-backed validation.

## Notes

- Remote providers remain disabled by default.
- API keys remain write-only through service secret APIs.
- Quick Ask remains unchanged.
