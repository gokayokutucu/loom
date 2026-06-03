# MARKDOWN-EMPHASIS-AND-LIST-FORMATTING-GUARD-001

## Objective

Prevent malformed assistant Markdown emphasis and inline asterisk pseudo-lists by strengthening Main generation formatting guidance without changing the renderer.

## Checklist

- [x] Audit Main generation prompt assembly.
- [x] Confirm malformed output is model-output quality, not parser behavior.
- [x] Add scoped Markdown bullet and bold-label formatting guidance to system policy.
- [x] Add/update prompt contract test.
- [x] Run validation.
