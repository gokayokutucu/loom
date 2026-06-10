# Phase4 Electron Provider Selection Smoke v1.0

## Objective

Validate provider-aware model selection and routing in the Electron-backed Loom UI.

## Scope

- Verify clean `feature/litellm-sandbox-001` branch state.
- Verify LiteLLM sandbox health.
- Build fresh React and `loom-service` artifacts.
- Start Electron dev runtime with the `litellm-sandbox` provider profile.
- Smoke test provider grouping, Ollama/local generation, LiteLLM Sandbox generation, and selected provider/model persistence.

## Preconditions

- LiteLLM sandbox is available at `http://127.0.0.1:4000`.
- Electron dev runtime can own `loom-service` on `127.0.0.1:17633`.
- Runtime must not have `runtime_binary_mismatch`.

## Changelog

- v1.0: Initial smoke validation plan.
