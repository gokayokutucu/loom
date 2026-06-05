# Phase 4 Implementation Plan - Revision Paging Highlight Consistency

Ensure consistent highlight behavior when paging through multiple revisions (e.g., 1/3, 2/3, 3/3). Ensure DOM rendering/mount timing does not clear highlights before elements can receive classes.

## Technical Scope
- **Deferred Highlight Pipeline**: Implement a React `useRef` to track a pending revision highlight (loom ID, display response ID, target pane, revision index, request token, creation timestamp).
- **Target Resolution**: Let `resolveRevisionTarget` handle immediate target resolution when responses are loaded. When responses are not yet loaded (e.g., first navigation click to a new revision), defer resolution until `conversationResponses` is populated.
- **Mount/Render Hook**: Use a `useEffect` that monitors `conversationResponses` and split pane state, checks if the target response is loaded, and then queries the specific pane's DOM. Once the target response element is found in the DOM, trigger the highlight and clear the pending highlight state.
- **Unit Tests**: Update Vitest tests in `revisionPaging.test.ts` to cover 3-revision target resolution.
- **E2E Tests**: Update/add E2E tests in `e2e/prompt-edit.spec.ts` using a 3-revision prompt edit scenario to verify paging highlights in both directions (1/3, 2/3, 3/3).
