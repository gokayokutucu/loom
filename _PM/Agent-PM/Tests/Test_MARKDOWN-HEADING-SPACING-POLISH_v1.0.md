# MARKDOWN-HEADING-SPACING-POLISH-001 Test Plan

## Validation

- [x] `npm run build` passes.
- [x] `npx vitest run` passes.
- [x] `git diff --check` passes.

## Expected CSS Behavior

- [x] Assistant response h1/h2 headings have larger top margin than bottom margin.
- [x] Assistant response h3/h4/h5/h6 headings have moderate top margin.
- [x] First heading in an assistant response does not add extra top whitespace.
- [x] Styles are scoped to assistant response Markdown.
