# QA: AGENT-RUNTIME-CANCELLATION-001 v1.0

- [x] Experimental gate remains default-off and unmounted routes return 404.
- [x] Active cancellation returns a stable safe response.
- [x] Repeated cancellation is idempotent.
- [x] Unknown runs return a stable 404 response.
- [x] Completed and failed runs retain their terminal status.
- [x] Active streams terminate with `run_cancelled`.
- [x] Cancellation does not emit or persist prompt text or raw thinking.
- [x] Main generation and Quick Ask static guards remain green.
- [x] Full Rust/frontend validation passes.
- [x] Browser-backed service uses the fresh workspace binary.

## Known Limitations

- Run state is process-local and is lost on service restart.
- Cancellation has no frontend client or UI integration.
- Provider cancellation is best-effort; the runtime cancellation signal guarantees the Agent Runtime stream terminal event.
- The ignored architecture ledger/API boundary sources still need their publication workflow updated with this route contract.
