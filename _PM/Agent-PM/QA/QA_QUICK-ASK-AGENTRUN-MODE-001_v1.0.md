# QA QUICK-ASK-AGENTRUN-MODE-001 v1.0

## Behavior Neutrality

- [x] `services/loom-service/src/api/ask.rs` was not modified.
- [x] Public Quick Ask request/response contract was not changed.
- [x] Frontend behavior was not changed.
- [x] Main Generation remains full-conversation AgentRun mode.
- [x] Lightweight Quick Ask mode is foundation-only and not wired to production Quick Ask.

## Privacy

- [x] No prompt persistence added.
- [x] No raw context body persistence added.
- [x] No provider request/response persistence added.
- [x] No raw thinking persistence added.
- [x] Lightweight lifecycle payloads contain metadata only.

## Runtime Verification

- [x] Fresh debug service started from freshly built binary with isolated DB/config.
- [x] Fresh debug service `/health` returned ready.
- [x] Fresh debug service process stopped and port released.
- [x] Packaged sidecar started with isolated DB/config.
- [x] Packaged sidecar `/health` returned ready.
- [x] Packaged sidecar process stopped and port released.
