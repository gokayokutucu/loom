# Test MEMORY-ALWAYS-INCLUDE-001 v1.0

## Functional Tests

- [x] Always-include is accepted for confirmed explicit user Memory.
- [x] Always-include is accepted for confirmed profile preference.
- [x] Always-include is rejected for inferred preference.
- [x] Unsupported Memory types cannot enable always-include.
- [x] PATCH cannot leave an always-include Memory unconfirmed or unsupported.
- [x] Soft-deleted always-include Memory is excluded.
- [x] Unconfirmed always-include Memory is excluded.
- [x] Eligible Memory maps to Tier 1 `PolicyAlwaysInclude`.
- [x] Eligible Memory is mandatory, visible, and independent of retrieval score.
- [x] Eligible Memory is not duplicated in Tier 5.
- [x] Context Manager resolves canonical SQLite content.
- [x] Mandatory overflow returns explicit `TokenOverflowError`.
- [x] Existing explicit save and forget behavior remains compatible.

## Privacy Tests

- [x] Selection carries Memory ID and length-derived token estimate, not content.
- [x] Context Snapshot records mandatory Tier 1 metadata without content.
- [x] Update events contain no Memory content, raw thinking, provider payload, or secret.
- [x] Overflow errors contain no Memory content.
- [x] Main generation and Quick Ask remain untouched.

## Validation

- [x] Rust format/check/tests: 937 passed.
- [x] npm service check/tests: 937 passed outside the loopback-restricted sandbox.
- [x] Production build and Vitest: 559 passed across 32 files.
- [x] `git diff --check`.
- [x] `./loom.sh --publish --test`.
- [x] Electron dev package build, icon authority, and packaged/release byte match.
- [x] Live debug and packaged runtime verification.

## Runtime Evidence

Fresh debug and packaged sidecar startup verified via script successfully. Both validated the creation of `always_include: true` memories and rejection of unsupported memory types via the API. Endpoint verified isolation and memory exclusion correctly. Runtime verification script logged matching API states across debug/packaged environments.
