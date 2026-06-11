# Task: AGENT-RUNTIME-CANCELLATION-001 v1.0

- [x] Audit branch, working tree, runtime service, route gate, and product-path guards.
- [x] Add cooperative per-run cancellation signal to the in-memory Agent Runtime store.
- [x] Make cancellation idempotent for known terminal runs.
- [x] Return a stable unknown-run response.
- [x] Add gated `POST /experimental/agent/runs/:run_id/cancel`.
- [x] Ensure active NDJSON streams terminate with `run_cancelled`.
- [x] Add router-level cancellation and privacy tests.
- [x] Preserve the Main generation and Quick Ask static guard.
- [x] Run required validation.
- [x] Verify a fresh service binary through `/health`.
- [x] Commit locally without pushing.

## Known Limitations

- Run state and cancellation remain process-local and in-memory.
- Cancellation does not survive service restart.
- No frontend or Electron client integration is included.
- Provider cancellation is best-effort; the runtime-owned cooperative signal is authoritative for stream termination.
- The ignored architecture ledger/API boundary files were not changed; update them in the repository's documentation publication workflow.
