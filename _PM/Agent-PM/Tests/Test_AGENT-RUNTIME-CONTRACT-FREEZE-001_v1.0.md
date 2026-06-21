# Test AGENT-RUNTIME-CONTRACT-FREEZE-001 v1.0

## Design Acceptance

- [x] Contracts do not depend on Rust, HTTP, SQLite table layout, or deployment topology.
- [x] Local and remote providers use one ProviderBinding model.
- [x] Loom-native, MCP, and future Tools use one invocation/result model.
- [x] Every SubAgent execution is an ordinary child AgentRun.
- [x] Parent/child ownership, join, and cancellation propagation are explicit.
- [x] Run states and allowed transitions are complete and terminal-safe.
- [x] Cancellation is idempotent, subtree-aware, and race-defined.
- [x] Agent Events use one envelope and per-run sequence.
- [x] Durable and transient Event classes are explicit.
- [x] Context Snapshots are one-per-run, finalized, content-free references.
- [x] Agent audit records are excluded from Retrieval and Context knowledge sources.
- [x] Raw thinking, provider envelopes, credentials, and raw Tool output are forbidden.

## Validation

- [x] Required documents exist.
- [x] Markdown and whitespace checks pass.
- [x] Git scope contains documentation only.

