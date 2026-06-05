# Task_REVISION-PAGING-HIGHLIGHT-CONSISTENCY-FIX-002_v1.0

## Objective

Fix inconsistent response-only highlight behavior when paging prompt revisions across 1/x, 2/x, and 3/x states.

## Scope

- [x] Audit revision paging target resolution and split-pane highlight timing.
- [x] Preserve existing revision paging semantics.
- [x] Keep highlight scoped to assistant response DOM only.
- [x] Wait for the correct pane and exact response DOM before starting highlight timeout.
- [x] Add stale-token guard so latest paging request wins.
- [x] Add exact 1/3, 2/3, and 3/3 resolver unit coverage.
- [x] Cover revision Looms that already have follow-up responses so 3/x highlights the revision answer, not a later child response.
- [x] Tighten E2E assertions to exact `.chat-transcript [data-response-id] > .assistant-message` targets.
- [x] Add E2E latest-target paging sequence.
- [x] Run build, targeted unit, targeted E2E, full Vitest, and diff validation.

## Notes

Real Electron service data for `loom://how-does-https-work/L-A1FC3?id=253ea0bd-834b-4156-a4b7-d88c36300c94` showed the third revision Loom has a follow-up assistant response. The previous resolver projected the origin response index into the child Loom, so 3/3 could target the follow-up response instead of the initial revision answer. The resolver now falls back to the first child response for revision pages when no explicit revision-id prefix is present.

Full `e2e/prompt-edit.spec.ts` still has an unrelated graph-node selector failure in the permanent-delete graph test. The multi-revision highlight product E2E passed.
