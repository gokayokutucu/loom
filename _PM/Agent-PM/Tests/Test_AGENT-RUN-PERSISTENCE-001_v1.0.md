# Test Evidence: AGENT-RUN-PERSISTENCE-001 v1.0

## Identity and Linkage

- [x] AgentRunId is generated as UUID v4 and is not derived from Response id.
- [x] Response id remains a separate nullable reference.
- [x] Correlation id is persisted.
- [x] Context snapshot id is copied when present.

## Terminal Consistency

- [x] Run status and terminal event are written in one SQLite transaction.
- [x] Terminal event type must match terminal status.
- [x] A repeated finish call preserves the first terminal state.
- [x] A repeated finish call does not append a second terminal event.

## Step Persistence

- [x] Runtime persists five placeholder step rows.
- [x] Provider step records completed, failed, or cancelled state.
- [x] Non-provider placeholder steps record completed or skipped state.
- [x] Step-started events carry the durable step id.

## Privacy

- [x] ProviderDelta text is not persisted in durable agent events.
- [x] Tool output summary is not persisted in durable agent events.
- [x] Raw-thinking markers are rejected by the repository.
- [x] Authorization, Bearer, API key, password, credential, secret, prompt-key, and `sk-` payloads are rejected.
- [x] Free-form warning and tool reason text is sanitized before persistence.
- [x] Persisted run error text is sanitized.

## Recovery and Routes

- [x] Pending and running rows recover as interrupted.
- [x] Recovery appends a safe interruption event.
- [x] Experimental history routes remain gated and default-off.
- [x] Main generation and Quick Ask do not depend on Agent Runtime.

## Validation

- [x] Rust format check passed.
- [x] Rust check passed.
- [x] Rust test suite passed: 837 tests.
- [x] Frontend build passed.
- [x] Frontend unit suite passed: 553 tests.
- [x] `./loom.sh --publish --test` passed.
- [x] Fresh debug service health and fingerprint matched the built binary.
- [x] Packaged release sidecar health and fingerprint matched the packaged binary.
- [x] Experimental tool route returned 404 in default packaged flow.
