# NVIDIA OpenAI-Compatible Provider POC v1.0

Task ID: NVIDIA-OPENAI-COMPATIBLE-PROVIDER-POC-001

## Objective

Prove an explicitly enabled NVIDIA OpenAI-compatible profile can route Main generation through the existing ProviderPipeline without becoming the default provider and without exposing raw secrets.

## Checklist

- [x] Audit ProviderPipeline, provider registry, native OpenAI-compatible runtime, SecretStore, and E2E harness.
- [x] Add native OpenAI-compatible ProviderAdapter support.
- [x] Select NVIDIA profile only through explicit E2E/profile override and enabled config.
- [x] Preserve Ollama default behavior and Quick Ask path.
- [x] Prove safe Authorization handling with fake OpenAI-compatible server.
- [x] Add product-service-backed E2E coverage.
- [x] Run validation and report results.
