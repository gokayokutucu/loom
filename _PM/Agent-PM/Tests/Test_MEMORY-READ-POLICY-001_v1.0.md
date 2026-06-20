# Test MEMORY-READ-POLICY-001 v1.0

## Functional Tests

- [x] Deleted Memory is excluded.
- [x] Unconfirmed Memory is excluded.
- [x] Superseded and forgotten Memories are excluded through soft-delete state.
- [x] Always-include Memory appears only once as mandatory Tier 1.
- [x] Scoped Memory masks global Memory with the same non-null topic key.
- [x] Global Memory remains eligible without a scoped equivalent.
- [x] Null topic keys do not mask each other.
- [x] Different topic keys do not mask each other.
- [x] Memory from another Loom does not participate in active-Loom masking or selection.
- [x] SQLite scope must agree with retrieval candidate scope.
- [x] Explicit and profile Memories rank above inferred Memory at equal retrieval score.
- [x] Context Snapshot selected rows match selected Memory identities.
- [x] Existing always-include candidate behavior remains compatible.

## Diagnostics And Privacy

- [x] Diagnostics count active considered Memories.
- [x] Diagnostics count scoped/global selections and masked globals.
- [x] Diagnostics count Tier 1 selections and deleted/unconfirmed exclusions.
- [x] Diagnostics contain no content, source IDs, or topic-key values.
- [x] Context Snapshot contains no Memory content.
- [x] Main generation and Quick Ask remain untouched.

## Validation

- [x] Rust format/check/tests: 944 passed.
- [x] npm service check/tests: 944 passed with loopback test permission.
- [x] Production build and Vitest: 559 passed across 32 files.
- [x] `git diff --check`.
- [ ] `./loom.sh --publish --test`.
- [x] Electron dev package, icon authority, and packaged/release byte match.
- [ ] Live debug and packaged read-policy verification.

## Environment Blocker

Live debug and packaged sidecar startup require loopback bind permission. The permission requests were not granted during this run, so health/state runtime proof and the standard publish script remain incomplete. No public endpoint exposes Context Selection masking directly; deterministic masking is covered by the SQLite-backed Rust test. No commit is permitted until the required live gates pass.
