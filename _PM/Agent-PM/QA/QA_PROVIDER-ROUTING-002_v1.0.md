# QA Checklist: PROVIDER-ROUTING-002 (v1.0)

Quality assurance checks for the backend provider routing:

## Code Quality & Compilation
- [x] Rust codebase compiles without warnings or errors.
- [x] Code formatted correctly with `cargo fmt`.
- [x] Lint checks pass with `cargo check`.
- [x] No trailing whitespace or formatting issues (`git diff --check`).

## Functional Integrity
- [x] Legacy model-only requests behave identically (verified by tests).
- [x] Valid `providerProfileId` routes to Ollama adapter profile.
- [x] Valid `providerProfileId` routes to OpenAI-compatible adapter profile.
- [x] Unknown/invalid `providerProfileId` returns `provider_resolution_error`.
- [x] API keys/secrets are never exposed in log outputs, error messages, or JSON payloads.
- [x] Regenerate and retry endpoints correctly propagate `providerProfileId`.
