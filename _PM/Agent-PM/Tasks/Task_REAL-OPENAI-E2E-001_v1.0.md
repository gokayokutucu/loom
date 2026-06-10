# Task REAL-OPENAI-E2E-001 v1.0

## Status
hold

## Checklist
- [x] Verify current git branch is `feature/litellm-sandbox-001`.
- [x] Check for stale service conflicts (none found).
- [ ] Configure local environment variables targeting production OpenAI API:
  - `LOOM_SERVICE_E2E_PROVIDER_PROFILE=openai-native`
  - `LOOM_OPENAI_BASE_URL=https://api.openai.com/v1`
  - `LOOM_OPENAI_MODEL=gpt-4o-mini`
  - `LOOM_OPENAI_API_KEY=<real OpenAI API key>`
- [ ] Build fresh artifacts (`npm run build` and cargo build).
- [ ] Start Electron dev app (`npm run electron:dev`).
- [ ] Verify OpenAI Native group is visible in model picker.
- [ ] Test prompt streaming and completion end-to-end against live OpenAI endpoints.
- [ ] Document runtime freshness parameters.
- [ ] Document E2E routing evidence.
- [ ] Verify validation check suite.

## Findings
- Locked under Level 2 (Real Provider Validation) until local environment secrets are available.
