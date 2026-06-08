# QA ELECTRON-PROVIDER-SELECTION-SMOKE-001 v1.0

## QA Checklist

- [x] No raw API key rendered in UI.
- [x] LiteLLM API key provided only through environment variable.
- [x] Provider grouping is visible and does not collapse duplicate model identities.
- [x] Ollama/local generation path remains functional.
- [x] LiteLLM Sandbox generation path reaches the OpenAI-compatible adapter.
- [x] Runtime freshness captured from `/health` fingerprint.
- [x] Blocking persistence mismatch identified.
- [x] Persistence mismatch fixed and re-smoked.
- [x] Worktree status captured after validation.
- [x] No commit or push performed.

## Risk Notes

The smoke uses a local dev DB/config under `services/loom-service/.data/dev`. It validates local runtime behavior and should not be treated as isolated CI proof.
`cargo fmt --check` remains red because of unrelated formatting drift in `services/loom-service/src/api/orchestration.rs`; this smoke did not edit that file.
