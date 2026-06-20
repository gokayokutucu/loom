# Test MEMORY-TOPIC-KEY-MANUAL-001 v1.0

## Contract Tests

- [x] `POST /memory` input without `topicKey` remains valid.
- [x] Absent `topicKey` remains absent and is not generated.
- [x] Valid camelCase `topicKey` is stored and returned.
- [x] Memory response DTO uses `topicKey`, not `topic_key`.
- [x] Noncanonical snake_case `topic_key` is rejected.
- [x] Invalid syntax returns `INVALID_TOPIC_KEY`.
- [x] Lowercase dot-separated tokens are accepted unchanged.
- [x] Uppercase, spaces, slashes, leading/trailing dots, and repeated dots are rejected.
- [x] Exact duplicate precedence remains unchanged.
- [x] Same-scope public API supersession remains unchanged.

## Validation

- [x] Rust format, check, and full tests.
- [x] npm service check and tests.
- [x] Frontend build and Vitest.
- [x] `git diff --check`.
- [x] `./loom.sh --publish --test`.
- [x] Electron dev package.
- [x] Fresh debug service API verification.
- [x] Packaged-sidecar API and fingerprint verification.
