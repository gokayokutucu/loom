# Phase 1 Implementation Plan - Revision Paging Response Highlight Only Fix

Restore the previous scroll behavior during revision counter paging and restrict the visual highlight exclusively to the active assistant response, removing any prompt/user-message highlights.

## Technical Scope
- **Scroll Behavior**: Strip out custom scroll alignment overrides and composer focus redirects in `handlePromptRevisionNavigate`. Keep the previous/native scrolling path unchanged.
- **Highlights**: Remove `.revision-focus-highlight--user` and `.revision-focus-highlight--prompt` styling and DOM binding. Retain and pulse only `.revision-focus-highlight--response`.
- **E2E Tests**: Update E2E assertions in `e2e/prompt-edit.spec.ts` to expect only response highlights and check that user-message highlights and composer focus do not occur.
