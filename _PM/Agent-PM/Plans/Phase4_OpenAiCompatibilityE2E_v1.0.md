# Phase 4 OpenAI Compatibility E2E Validation Plan v1.0

## Objective
Validate the native OpenAI provider adapter (`openai-native` profile) end-to-end using Level 1 Contract Compatibility (routing requests to the local LiteLLM/Ollama sandbox on port 4000 without requiring real API keys).

## Prerequisites & Environment
The following environment variables must be defined in the local shell environment:
- `LOOM_SERVICE_E2E_PROVIDER_PROFILE=openai-native`
- `LOOM_OPENAI_BASE_URL=http://127.0.0.1:4000/v1`
- `LOOM_OPENAI_MODEL=gpt-4o-mini`
- `LOOM_OPENAI_API_KEY=mock-key-not-real-key`

## Scope & Target Flow
- LiteLLM/Ollama sandbox running on port 4000.
- Start Electron dev app with native OpenAI environment settings.
- Model picker dropdown displays "OpenAI Native" provider group.
- Select `gpt-4o-mini` model.
- Send a prompt (e.g. "Say hello in exactly two words") and verify:
  - Streaming tokens start and complete.
  - Final response renders correctly in the chat lane.
  - No provider resolution errors or api key auth errors.

## Status
- **ACTIVE**: Level 1 E2E is currently the active test target.
