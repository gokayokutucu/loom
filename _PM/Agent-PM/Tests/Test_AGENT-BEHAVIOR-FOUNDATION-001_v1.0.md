# Test: AGENT-BEHAVIOR-FOUNDATION-001 v1.0

- [x] `AgentDefinition` persistence stores identity, revision, safe refs, enabled state, and metadata only.
- [x] `AgentDefinition` metadata rejects prompt/private markers.
- [x] Root `AgentRun` creation records `root_run_id = run_id`.
- [x] Child `AgentRun` creation records `parent_run_id` and inherited `root_run_id`.
- [x] Child creation rejects mismatched root identity.
- [x] Child creation rejects terminal parent runs.
- [x] `created -> queued` emits `run_queued`.
- [x] `queued -> running` emits `run_started`.
- [x] `running -> waiting_tool` emits `run_waiting_tool`.
- [x] `waiting_tool -> running` emits `run_started`.
- [x] `running -> waiting_subagent` emits `run_waiting_subagent`.
- [x] `waiting_subagent -> running` emits `run_started`.
- [x] `running -> completed` emits `run_completed`.
- [x] `running -> failed` emits `run_failed`.
- [x] `running -> cancelled` is covered by repository cancellation.
- [x] Invalid transitions do not mutate run state or append lifecycle events.
- [x] Parent cancellation cascades to child and grandchild runs.
- [x] Repeated parent cancellation does not emit duplicate `run_cancelled` events.
- [x] Lifecycle event sequence numbers are ordered within each run.
- [x] Event and run records reject raw thinking, prompt, provider payload, and credential markers.
- [x] Full validation stack passes.

## Evidence

- `cargo test --manifest-path services/loom-service/Cargo.toml`: 956 passed.
- `npm run service:test`: 956 passed.
- `npx vitest run`: 32 files / 559 tests passed.
- `./loom.sh --publish --test`: passed after sandbox-denied local bind retry with escalation.
- `npm run electron:package:dev`: passed.
