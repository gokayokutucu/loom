# Provider Validation Strategy

This document defines the two-level strategy for implementing, testing, and validating model provider adapters within the Loom workspace. It clarifies the roles of native adapters, compatibility gateways (e.g. LiteLLM), and E2E validation requirements.

---

## The Two-Level Validation Strategy

To allow robust development and CI testing without requiring real, paid API keys (OpenAI, Anthropic, Gemini) or leaking secrets, validation is split into two distinct levels.

```mermaid
graph TD
    subgraph Level 1: Contract Compatibility (Active)
        A[Loom Native Adapters] --> B[Compatible Gateway / Local Port]
        B --> C[LiteLLM Sandbox / NVIDIA NIM]
        C --> D[Local Ollama / Local Model]
    end
    subgraph Level 2: Real Provider Validation (Hold)
        E[Loom Native Adapters] --> F[Real API Endpoints]
        F --> G[api.openai.com]
        F --> H[api.anthropic.com]
        F --> I[Gemini API]
    end
```

### Level 1: Contract Compatibility (Default & E2E Target)
* **Goal**: Verify that the native adapter correctly formats requests, establishes streaming connections, parses response event shapes/deltas, and handles errors, using a local mock server or proxy.
* **Mechanism**:
  * Native adapters are pointed to a local OpenAI-compatible endpoint (like LiteLLM on port 4000 or a local mock server).
  * No real API keys are used. Auth is validated against mock keys.
  * The local gateway forwards requests to a local Ollama model to verify streaming.
* **Status**: **Active**. All E2E tests in CI and default developer workflows target Level 1 compatibility.

### Level 2: Real Provider Validation (Future / Hold)
* **Goal**: Validate actual behavior, latency, context windows, and performance against live production LLM endpoints.
* **Mechanism**:
  * Native adapters are configured with real API keys.
  * Requests are routed directly to the provider's production domain (e.g., `api.openai.com`).
* **Status**: **Hold**. Triggered only on-demand when explicit environment keys are supplied. Never a blocking gating check for standard commits.

---

## Role Definitions

### 1. Native Provider Adapters
* **Role**: Implement specific request/response and SSE streaming protocols for each provider (e.g., OpenAI Chat Completions, Anthropic Messages API, Gemini Generation API).
* **Location**: `services/loom-service/src/providers/`
* **Validation**:
  * Unit tests in Rust using mock servers (`mockito` or similar).
  * Level 1 E2E tests validating streaming behavior through compatible gateways.

### 2. LiteLLM / Compatibility Gateways
* **Role**: Serve as an **OpenAI-compatible gateway** translating requests to local backends (like Ollama).
* **Validation Purpose**: LiteLLM does *not* validate the correctness of native provider protocols; it acts as a mock endpoint that accepts OpenAI-formatted payloads and routes them to a local model, ensuring our end-to-end streaming plumbing functions correctly.

---

## Active & Future Roadmaps

### Current Active Path: OpenAI Compatibility E2E
* **Status**: Verified. The native OpenAI adapter can run Level 1 E2E tests using the local LiteLLM/Ollama sandbox on port 4000.
* **Open Tasks**: Reclassify all E2E validation tasks to target the local compatibility environment (`OPENAI-COMPATIBILITY-E2E-001`) instead of requiring production keys.

### Future Path: Anthropic & Gemini Gateways
* **Step 1**: Implement native Anthropic and Gemini adapters.
* **Step 2**: Create local Anthropic-compatible and Gemini-compatible gateway configurations.
* **Step 3**: Validate compatibility end-to-end via Level 1 local gateways.
* **Step 4**: Perform Level 2 real API validation only when secrets are manually provisioned.
