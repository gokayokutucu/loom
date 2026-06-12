# Plan: Provider Profile Abstraction / Discovery Layer (v1.0)

Task ID: `PROVIDER-ABSTRACTION-001`  
Branch: `feature/litellm-sandbox-001`  
Objective: Introduce a frontend-side provider profile abstraction and discovery layer without adding UI selection components, settings pages, or modifying prompt generation runtime behavior.

---

## 1. Objectives & Scope
- **Goals**:
  - Define `ProviderProfile` type matching frontend concepts.
  - Implement a normalization helper that maps `RuntimeModelProviderStatus` (and optionally `RuntimeModelItem[]`) into `ProviderProfile`.
  - Classify `litellm-sandbox` as sandbox provider.
  - Safely ignore secrets (do not expose or parse secret keys).
  - Add unit tests for the helper.
- **Out of Scope**:
  - NO provider picker UI or dropdowns.
  - NO settings screens modifications.
  - NO changes to prompts, composers, or default runtime generation model settings.
  - No changes to backend API.

---

## 2. Technical Design & Proposed Changes

### 2.1 Component: Services Layer (`src/services/`)

We will define the new types and functions in `src/services/providerDiscovery.ts`.

#### [NEW] [providerDiscovery.ts](../../src/services/providerDiscovery.ts)
- Define `ProviderProfile` structure:
```typescript
import type { RuntimeModelProviderStatus, RuntimeModelItem } from "../engine";

export type ProviderProfileKind = "ollama" | "openai-compatible" | "custom" | "sandbox" | "unknown";

export interface ProviderProfile {
  id: string;
  label: string;
  kind: ProviderProfileKind;
  endpoint?: string;
  modelIds: string[];
  isDefault?: boolean;
  isSandbox?: boolean;
  isAvailable?: boolean;
  warning?: string;
}
```
- Implement the normalization helper `normalizeRuntimeProvider(status: RuntimeModelProviderStatus, models?: RuntimeModelItem[]): ProviderProfile`.
- Keep secrets safe: do not accept or process secret values (only read `requiresSecret` and `secretStatus` from the status object).

#### [NEW] [providerDiscovery.test.ts](../../src/services/providerDiscovery.test.ts)
- Add Vitest tests for `normalizeRuntimeProvider` mapping:
  - Default Ollama/local provider mapping (`ollama-local`).
  - `litellm-sandbox` mapping (`sandbox`).
  - Unknown/custom provider mapping.
  - Available vs. unavailable providers mapping.
  - Verify that model IDs are correctly aggregated from the models list (falling back to `defaultModel`).
  - Verify no secrets are exposed.

---

## 3. Verification Plan

### Automated Tests
- Run unit tests: `npm run test:unit`
- Run build verification: `npm run build`
- Run lint/check: `git diff --check`

### Manual Verification
- None required (no UI changes).
