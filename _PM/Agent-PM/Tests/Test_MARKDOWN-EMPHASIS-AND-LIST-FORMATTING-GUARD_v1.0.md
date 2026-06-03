# MARKDOWN-EMPHASIS-AND-LIST-FORMATTING-GUARD-001 Test Plan

## Prompt Contract

- [x] Main system policy instructs valid Markdown.
- [x] Main system policy prefers `- ` bullet lists.
- [x] Main system policy recommends `**Label:**` for bold labels.
- [x] Main system policy forbids malformed `**Label:*` emphasis.
- [x] Main system policy forbids inline asterisk-separated pseudo-lists.
- [x] Quick Ask prompt behavior is not changed by this task.

## Validation

- [x] Targeted Rust context manager test passes.
- [x] Full Rust service validation passes.
- [x] `npm run build` passes.
- [x] `npx vitest run` passes.
- [x] `git diff --check` passes.
