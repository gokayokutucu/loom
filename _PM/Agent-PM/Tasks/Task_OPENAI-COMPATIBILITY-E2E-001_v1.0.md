# Task OPENAI-COMPATIBILITY-E2E-001 v1.0

## Status
active

## Checklist
- [x] Verify current git branch is `feature/litellm-sandbox-001`.
- [x] Check for stale service conflicts (none found).
- [ ] Configure local environment variables targeting the local LiteLLM sandbox on port 4000:
  - `LOOM_SERVICE_E2E_PROVIDER_PROFILE=openai-native`
  - `LOOM_OPENAI_BASE_URL=http://127.0.0.1:4000/v1`
  - `LOOM_OPENAI_MODEL=gpt-4o-mini`
  - `LOOM_OPENAI_API_KEY=mock-key`
- [ ] Build fresh artifacts (`npm run build` and cargo build).
- [ ] Start Electron dev app (`npm run electron:dev`).
- [ ] Verify OpenAI Native group is visible in model picker.
- [ ] Test prompt streaming and completion end-to-end through the local gateway.
- [ ] Document runtime freshness parameters.
- [ ] Document E2E routing evidence.
- [ ] Verify validation check suite.

## Findings
- Git branch is clean and aligned with upstream at HEAD `0003526`.
- Port 17633 is free and no stale `loom-service` is active.
