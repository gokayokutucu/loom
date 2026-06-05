# Phase 4 Implementation Plan - Split Pane Return Control Leak Fix

Remove the leaked "Return to Origin" control button from the main/origin split panel header while retaining it for the right (weft/revision) panel.

## Technical Scope
- **Prop Removal**: Change `onReturnToOrigin={returnToOrigin}` to `onReturnToOrigin={undefined}` (or remove it) in the `<ChatTranscript>` component rendering for the `origin-split-panel` (left side) inside [src/App.tsx](file:///Users/gokay/Documents/Workspace/LoomAI/src/App.tsx#L14339).
- **Tests**: Add E2E assertions in `e2e/prompt-edit.spec.ts` (or relevant spec) to verify that the "Return to Origin" button is absent from the left/origin panel, while verifying it is present in the right/weft split panel.
