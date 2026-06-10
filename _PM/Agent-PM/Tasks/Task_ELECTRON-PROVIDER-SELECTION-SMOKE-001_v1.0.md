# Task ELECTRON-PROVIDER-SELECTION-SMOKE-001 v1.0

## Checklist

- [x] Verify branch is `feature/litellm-sandbox-001`.
- [x] Verify working tree was clean before smoke.
- [x] Verify HEAD equals upstream.
- [x] Verify latest commit includes `a0f50c7 Route generation by provider profile`.
- [x] Verify LiteLLM sandbox health.
- [x] Stop test-owned stale dev `loom-service` and Vite processes.
- [x] Build React app.
- [x] Build fresh `loom-service` binary.
- [x] Start Electron dev runtime with LiteLLM profile enabled.
- [x] Verify Electron-owned `loom-service` PID, service URL, config path, DB path, and health.
- [x] Verify provider grouping in model picker.
- [x] Verify Ollama/local generation streams and completes.
- [x] Verify LiteLLM Sandbox generation routes and completes.
- [x] Verify LiteLLM receives `POST /v1/chat/completions 200 OK`.
- [x] Detect provider/model persistence bug after renderer reload.
- [x] Patch minimal restore bug that mixed remote provider id with Ollama fallback model.
- [x] Re-run smoke after patch.
- [x] Run required validation commands.

## Notes

Initial smoke exposed a blocking persistence bug: remote Main selection reloaded as `litellm-sandbox · qwen3.5:9b` even though service config contained `mainModelId=ollama-qwen`.
The fix preserves remote Main model ids during local settings reconciliation instead of applying the Ollama installed-model fallback.
