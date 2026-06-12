# Phase 4 Concurrency Policy Implementation Plan v1.1

Define and enforce concurrency policies for local Ollama and remote OpenAI-compatible provider generation.

## Changelog from v1.0
- Narrowed scope to avoid a broad `App.tsx` generation refactor.
- Defined a testable concurrency helper `computeMainGenerationConcurrencyDecision`.
- Ensured remote OpenAI-compatible providers are blocked without queuing when they exceed 2 active generations.
- Ensured Quick Ask is blocked only by local model collision and never by remote Main runs.
- Fixed the Enter key bypass bug in `AskPopup`.

## Objective
Ensure local generations (Ollama) are serialized/queued to prevent machine overloading, while allowing limited parallel remote generations (limit of 2 per provider) without global composer blocking.

## Proposed Changes

### Policy Helper Layer
#### [NEW] [localGenerationQueue.ts](../../src/services/localGenerationQueue.ts)
- Add `ActiveMainGenerationInfo` interface:
  ```typescript
  export interface ActiveMainGenerationInfo {
    loomId: string;
    providerProfileId: string;
    providerKind: MainGenerationProviderKind;
    modelId: string;
    startedAt: string;
    responseId?: string;
  }
  ```
- Implement `computeMainGenerationConcurrencyDecision(input: { providerProfileId, providerKind, modelId, targetLoomId, activeRuns })` to return `"allow" | "queue" | "block_same_loom" | "block_limit_exceeded"`.

#### [MODIFY] [modelProviders.ts](../../src/services/modelProviders.ts)
- Keep `computeQuickAskBlockedReason` signature but call it with local-only run status in `App.tsx`.

### UI Components

#### [MODIFY] [AskPopup.tsx](../../src/components/AskPopup.tsx)
- Check `submitBlockedReason` in `onKeyDown` to prevent Enter keypress submission when blocked.

---

### Core State & Logic in `src/App.tsx`
- Introduce a minimal active runs tracking state:
  ```typescript
  const [activeMainLoomStates, setActiveMainLoomStates] = useState<Record<string, {
    responseId: string;
    message: string | null;
    providerProfileId: string;
    providerKind: MainGenerationProviderKind;
    modelId: string;
    startedAt: string;
  }>>({});
  ```
- Map refs to hold in-flight `AbortController`s, reveal targets, current requests, and service cancellations:
  - `mainAbortsRef` (Map of loomId -> AbortController)
  - `mainRevealTargetsRef` (Map of loomId -> target info)
  - `mainServiceCancellationsRef` (Map of loomId -> cancellation info)
  - `currentMainRequestsRef` (Map of loomId -> request info)
  - `mainGenerationsRef` (Map of loomId -> generation sequence number)
- Add a `useEffect` hook to synchronize `composerRuntimeState`, `composerRuntimeTargetKey`, and `generatingResponseId` with the active conversation's active state.
- In `submitMainResponse`, call `computeMainGenerationConcurrencyDecision` to decide whether to allow, queue, or block (e.g. limit exceeded):
  - If `"block_limit_exceeded"`, display `"This remote provider already has 2 active responses."` and return `false`.
  - If `"block_same_loom"`, return `false`.
  - If `"queue"`, queue normally.
- Update `regenerateFromEditedPrompt` and `executeRetryFromUserMessage` to check `computeMainGenerationConcurrencyDecision` before execution.
- Update `runtimeStateForComposer(draftKey)` to return the correct blocked, queued, or running states per composer.

## Verification Plan

### Automated Tests
- Unit tests: Add unit tests for `computeMainGenerationConcurrencyDecision`.
- E2E Playwright: Run Playwright tests on provider generation and queue flows to ensure correctness.
