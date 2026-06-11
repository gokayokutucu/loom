# Test: AGENT-RUNTIME-CANCELLATION-001 v1.0

- [x] Disabled cancel route returns 404.
- [x] Enabled cancel route returns a stable 404 response for an unknown run.
- [x] Active run can be cancelled through the HTTP route.
- [x] Repeated cancellation is idempotent.
- [x] Cancelled NDJSON stream terminates with `run_cancelled`.
- [x] Terminal completed/failed runs are not rewritten by cancellation.
- [x] Cancellation response and stream do not expose prompt text, raw thinking, credentials, Authorization headers, or provider payloads.
- [x] Main generation and Quick Ask remain independent from the experimental Agent Runtime route.
- [x] Full Rust and frontend validation pass.
- [x] Fresh service health/fingerprint is recorded.

## Evidence

- Focused route tests: 12 passed.
- Focused Agent Runtime tests: 19 passed.
- Full Rust suite: 767 passed.
- Frontend unit suite: 543 passed.
- `npm run build`: passed.
- `./loom.sh --publish --test`: passed after running outside the restricted network sandbox required by an existing localhost-binding Ollama test.
- Fresh service: PID `8235`, port `17633`, binary `services/loom-service/target/debug/loom-service`, inode `186521074`, health `ready`.
- Live unknown-run proof: `404` with `{ "runId": "live-unknown", "status": "not_found", "cancelled": false }`.
