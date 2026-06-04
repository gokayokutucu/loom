# Task Checklist: PROVIDER-RUNTIME-CONCURRENCY-POLICY-001 v1.1

## 1. Quick Ask Protection
- [x] Update `onKeyDown` in `src/components/AskPopup.tsx` to check `submitBlockedReason`
- [ ] Update `submitQuickQuestion` in `src/App.tsx` to guard against `quickAskSubmitBlockedReason`
- [ ] Update `computeQuickAskBlockedReason` in `src/services/modelProviders.ts` to block only on local model collisions

## 2. Policy Helper implementation & Tests
- [ ] Define `computeMainGenerationConcurrencyDecision` in `src/services/localGenerationQueue.ts`
- [ ] Add unit tests in `src/services/localGenerationQueue.test.ts` for the decision helper

## 3. Concurrency State & Ref maps in `src/App.tsx`
- [ ] Add `activeMainLoomStates` React state to track multi-composer active state
- [ ] Add `mainAbortsRef`, `mainRevealTargetsRef`, `mainServiceCancellationsRef`, `currentMainRequestsRef`, and `mainGenerationsRef` ref maps keyed by `loomId`
- [ ] Add a `useEffect` hook to synchronize `composerRuntimeState` and `composerRuntimeTargetKey` with the primary active conversation's status
- [ ] Add a `useEffect` hook to synchronize `generatingResponseId` with the active conversation's generating response ID

## 4. Concurrency Checks & Submission Control
- [ ] Update `submitMainResponse` to check remote concurrency limit (2) using the policy helper and block if exceeded
- [ ] Update `submitMainResponse` event loop and catches to update `activeMainLoomStates` and map refs, cleaning them up on exit/completion
- [ ] Update `regenerateFromEditedPrompt` and `executeRetryFromUserMessage` to check concurrency limits before execution
- [ ] Update `runtimeStateForComposer` in `src/App.tsx` to return correct states for local queues, remote limits, and active runs

## 5. Stop & Cancel Refactoring
- [ ] Update `stopMainResponse` to accept `loomId` and stop only that Loom's active run, or stop all active runs if none specified
- [ ] Update `stopMainResponseForComposer` to pass the correct draftKey to `stopMainResponse`
- [ ] Ensure cancelled queued items clean up correctly

## 6. Verification & Testing
- [ ] Verify build compiles (`npm run build`)
- [ ] Run automated tests (`npx vitest run`)
- [ ] Verify using Playwright E2E tests
