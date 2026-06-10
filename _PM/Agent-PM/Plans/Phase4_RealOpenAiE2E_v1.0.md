# Phase 4 Real OpenAI E2E Validation Plan v1.0

## Objective
Validate the native OpenAI provider adapter (`openai-native` profile) end-to-end against the production `api.openai.com` endpoint using a real, paid OpenAI API key.

## Prerequisites & Environment
The following environment variables must be defined in the local shell environment:
- `LOOM_SERVICE_E2E_PROVIDER_PROFILE=openai-native`
- `LOOM_OPENAI_BASE_URL=https://api.openai.com/v1`
- `LOOM_OPENAI_MODEL=gpt-4o-mini`
- `LOOM_OPENAI_API_KEY=<real OpenAI API key>`

## Scope & Target Flow
- Electron App startup with custom environment configuration.
- Model picker dropdown displays "OpenAI Native" provider group.
- Select `gpt-4o-mini` model.
- Send a prompt (e.g. "Say hello in exactly two words") and verify:
  - Streaming tokens start and complete.
  - Final response renders correctly in the chat lane.
  - No provider resolution errors or api key auth errors.

## Status
- **HOLD**: This task is on hold until local environment API keys are available. Level 1 Contract Compatibility E2E is used instead.
