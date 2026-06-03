# Implementation Plan - Revision Paging Anchor and Highlight Fix

Fix the revision counter paging behavior to act as a focus/navigation control instead of mutating the main Loom message prompt.

## Objective

Ensure that paging through message revisions:
1. Preserves the original parent prompt text in the main Loom (origin panel) instead of replacing it with revision text.
2. Focuses and scrolls the correct panel (origin panel for `1/x`, weft panel for `2/x+`) and scrolls the target user-message/response pair into view.
3. Applies a temporary highlight animation to both the user-message and its paired response.
4. Focuses the main composer input when returning to `1/x`.
5. Suppresses competing auto-scroll actions during revision navigation.

## Adjustments / Rules
- **Rule 1**: Treat `1/x` as `main-origin` navigation:
  - Focus/select the main Loom pane.
  - Smooth-scroll the original/main user-message just below the topbar.
  - Highlight the origin user-message and its paired response.
  - Focus the main Loom composer input so the cursor is active.
  - Do not use the generic revision/weft navigation path.
- **Rule 2**: Treat `2/x+` as `revision-pane` navigation:
  - Focus/scroll the split/weft/revision pane.
  - Highlight the active revision user-message and response in that pane.
  - Do not disturb, replace, or re-anchor the main Loom origin user-message.
- **Rule 3**: Keep revision selection state separate from scroll/focus target state:
  - Revision selection = which revision counter item is active.
  - Scroll/focus target = which pane and which user-message/response pair should be focused.
- **Rule 4**: Use separate highlight classes:
  - `.revision-focus-highlight`
  - `.revision-focus-highlight--prompt`
  - `.revision-focus-highlight--response`
  - Do not reuse the fragment reference highlight class.

## Proposed Changes

### Logic / Services

#### [NEW] [revisionPaging.ts](file:///Users/gokay/Documents/Workspace/LoomAI/src/services/revisionPaging.ts)
- Implement `resolveRevisionTarget` logic to resolve the target pane, loomId, and responseId for a given revision index.

#### [NEW] [revisionPaging.test.ts](file:///Users/gokay/Documents/Workspace/LoomAI/src/services/revisionPaging.test.ts)
- Add Vitest unit tests verifying `resolveRevisionTarget` targets `main-origin` for `1/x` (index 0) and `weft` pane/response for `2/x+`.

### Frontend Styling

#### [MODIFY] [styles.css](file:///Users/gokay/Documents/Workspace/LoomAI/src/styles.css)
- Define `.revision-focus-highlight`, `.revision-focus-highlight--prompt`, `.revision-focus-highlight--response` styling and animation to temporarily highlight the elements.

### Frontend Components

#### [MODIFY] [App.tsx](file:///Users/gokay/Documents/Workspace/LoomAI/src/App.tsx)
- Define `highlightedRevisionResponseId` state and trigger highlight on navigation with a 1500ms timeout.
- Implement `onPromptRevisionNavigate` handler that invokes `resolveRevisionTarget` and triggers scroll/focus/highlight.
- Support `smooth` parameter in `scrollElementIntoViewFromCurrent` to animate scrolling.
- Suppress auto-scroll snaps using a short-lived `revisionNavigationInProgressRef` guard.
- Pass `isOriginPanel` prop to `ChatTranscript` to prevent rendering revision prompt text in the main Loom.
- Pass `highlightedRevisionResponseId` and `onPromptRevisionNavigate` props down to `ChatTranscript` components.

## Verification Plan

### Automated Tests
- Run Vitest tests:
  ```bash
  npx vitest run src/services/revisionPaging.test.ts
  ```
- Run targeted Playwright tests:
  ```bash
  npx playwright test e2e/prompt-edit.spec.ts
  ```
- Run production build check:
  ```bash
  npm run build
  ```
