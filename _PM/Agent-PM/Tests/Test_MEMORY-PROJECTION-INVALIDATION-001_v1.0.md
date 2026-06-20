# Test MEMORY-PROJECTION-INVALIDATION-001 v1.0

## Functional Tests

- [x] Migration adds invalidation state and timestamp metadata to projection source/chunk tables.
- [x] Invalid invalidation states are rejected by SQLite constraints.
- [x] Explicit Memory create produces one deterministic stale projection chunk.
- [x] Shared rebuild planning recognizes a stale Memory chunk as changed.
- [x] Shared planning returns the refreshed chunk to current state.
- [x] Forget marks source/chunk metadata deleted and tombstoned.
- [x] Supersession marks the predecessor tombstoned and successor stale.
- [x] Exact duplicate creates no additional chunk or invalidation timestamp.
- [x] `always_include`-only update leaves invalidation state/timestamp unchanged.
- [x] Existing write, forget, supersession, and read-policy behavior remains covered.

## Privacy Tests

- [x] Invalidation migration adds no content, prompt, provider payload, vector, or private-thinking column.
- [x] Initial invalidation rows contain no Memory content or metadata payload.
- [x] Refreshed projection metadata contains no Memory content or forbidden marker.
- [x] Lifecycle invalidation errors and state contain no Memory content.
- [x] Main generation and Quick Ask remain untouched.

## Validation

- [x] Rust format/check/tests.
- [x] npm service check/tests.
- [x] Production build and Vitest.
- [x] `git diff --check`.
- [x] `./loom.sh --publish --test`.
- [x] Electron dev package build.
- [ ] Packaged sidecar binary and live checks.
- [ ] Live debug and packaged invalidation verification.
