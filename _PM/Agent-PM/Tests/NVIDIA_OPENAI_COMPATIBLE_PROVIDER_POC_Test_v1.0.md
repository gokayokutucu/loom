# NVIDIA OpenAI-Compatible Provider POC Test v1.0

Task ID: NVIDIA-OPENAI-COMPATIBLE-PROVIDER-POC-001

## Expected Proof

- [x] Disabled/absent NVIDIA profile does not replace Ollama default.
- [x] Explicit enabled NVIDIA profile routes Main generation through ProviderPipeline.
- [x] Fake OpenAI-compatible provider receives `stream: true`.
- [x] Fake provider receives an Authorization header without test code storing the raw header value.
- [x] Prompt, persisted response, UI, and E2E payload do not contain raw API key or raw thinking markers.
- [x] Quick Ask routing remains unchanged.
- [x] Temp SQLite DB and temp service config are used for product-mode E2E.
