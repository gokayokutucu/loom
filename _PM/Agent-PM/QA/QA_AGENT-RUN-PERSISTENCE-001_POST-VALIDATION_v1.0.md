# QA: AGENT-RUN-PERSISTENCE-001 Post-Validation v1.0

## Repository Hygiene

- [x] Persistence commit scope audited.
- [x] Unrelated sidebar test and style files were not included in `7e61710`.
- [x] No Main generation or Quick Ask code changed in the follow-up.
- [x] No tool execution, MCP, retrieval, or vector database work added.

## Runtime Safety

- [x] Exactly one terminal event is durable per run transition.
- [x] Durable terminal event type agrees with durable run status.
- [x] Runtime step history is no longer empty.
- [x] Durable event payloads use explicit event mapping plus repository-level rejection.
- [x] Raw thinking and provider delta text remain transient.

## Freshness

- [x] Fresh debug binary started on an isolated port with temporary DB/config.
- [x] Debug `/health` reported the expected binary path, inode, and fingerprint.
- [x] Electron development package embedded the fresh release binary.
- [x] Packaged sidecar `/health` fingerprint matched the embedded binary.
- [x] `runtime_binary_mismatch` was false for both validation runtimes.
- [x] Test-owned processes stopped and ports were released.

## Known Limitations

- Persistence write failures are currently best-effort inside the event stream and are not surfaced to the HTTP client.
- Event sequence allocation is process-local; restart recovery ordering across an existing run should be revisited if resumable runs are introduced.
- The existing user-owned packaged service on the normal development port was intentionally left untouched.
