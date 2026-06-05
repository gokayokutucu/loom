# Phase 4 Concurrency Policy Implementation Plan v1.0

Define and enforce concurrency policies for local Ollama and remote OpenAI-compatible provider generation.

## Objective
Ensure local generations (Ollama) are serialized/queued to prevent machine overloading, while allowing limited parallel remote generations (limit of 2 per provider) without global composer blocking.

## Proposed Changes

### Frontend state management in `src/App.tsx`
- Refactor how active Main generations are tracked.
- Replace or synchronize `composerRuntimeState` and `composerRuntimeTargetKey` with a new React state:
  ```typescript
  const [activeMainLoomStates, setActiveMainLoomStates] = useState<Record<string, {
    responseId: string;
    message: string | null;
    providerProfileId: string;
    providerKind: MainGenerationProviderKind;
    modelId: string;
  }>>({});
  ```
- Store active `AbortController`s, service cancellations, reveal targets, and current request parameters in ref maps keyed by `loomId`.
- Add a synchronization `useEffect` that updates `composerRuntimeState` and `composerRuntimeTargetKey` based on `activeMainLoomStates` and `activeConversationId` to guarantee backward compatibility with other UI components and tests.
- Maintain `generatingResponseId` by synchronizing it to the response ID currently generating in the active conversation tab.

### Concurrency check refactoring
- Enforce the policy during `submitMainResponse`, `regenerateFromEditedPrompt`, and `executeRetryFromUserMessage`:
  - **Local Ollama Main policy**:
    - Same Loom: block (do not submit second Main).
    - Different Loom: queue using the local Ollama queue.
  - **Remote Main policy**:
    - Check the count of active generations sharing the same remote `providerProfileId`.
    - If count >= 2, block submission and return a clear status message: `"Remote provider concurrency limit reached. Wait for other responses to finish."`
- Implement `runtimeStateForComposer(draftKey)`:
  - If the composer is currently generating, return `{ running: true, message: activeState.message }`.
  - If the selected provider is local (Ollama) and there's an active local run: return queue message if queueable, or block if same Loom.
  - If the selected provider is remote and the active runs for that provider >= 2: return blocked state with limit message.
  - Otherwise, return idle state `{ running: false, message: null }`.

### Quick Ask concurrency protection
- Update `computeQuickAskBlockedReason` in `src/services/modelProviders.ts` to only return a blocked reason if there is an active local Ollama Main run on the same model ID. Allow it to run if the active Main is remote.
- Update `onKeyDown` in `src/components/AskPopup.tsx` to explicitly return early if `submitBlockedReason` is true, preventing Enter keypress bypass.
- Guard `submitQuickQuestion` in `src/App.tsx` by verifying if `quickAskSubmitBlockedReason` is present before executing.

### Stop/cancellation behavior
- Refactor `stopMainResponse()` to accept an optional `loomId`. If provided, stop only that specific Loom's generation. If not provided (e.g. from keyboard shortcut), stop all active generations or the one for the active conversation.
- Clear `activeMainLoomStates` and the respective ref maps upon complete, error, or cancellation.
- Dequeue next local generation only if the stopped run was local Ollama.

## Verification Plan

### Automated Tests
- Unit tests: Add unit tests verifying `computeQuickAskBlockedReason`, `canQueueLocalMainGeneration`, and composer run state calculations under the new concurrency parameters.
- E2E Playwright: Run Playwright tests on provider generation and queue flows to ensure correctness.
