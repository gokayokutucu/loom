# Test QUICK-ASK-AGENTRUN-MODE-001 v1.0

## Expected Coverage

- [x] `AgentRunMode` serializes as stable snake_case storage/API values.
- [x] `AgentRunMode` defaults to `FullConversation`.
- [x] Migration 0029 adds `agent_runs.run_mode`.
- [x] Migration 0029 defaults existing/new rows to `full_conversation`.
- [x] Migration 0029 rejects invalid run mode values.
- [x] Full conversation AgentRuns persist `full_conversation`.
- [x] Lightweight Quick Ask AgentRuns persist `lightweight_quick_ask`.
- [x] Lightweight Quick Ask create/start emits only run-level lifecycle events.
- [x] Lightweight Quick Ask mode creates no `agent_steps`.
- [x] Lightweight Quick Ask mode rejects context snapshot links.
- [x] Existing AgentRuntime tests remain full-conversation.
- [x] Existing Tool Scheduler tests remain compatible.

## Validation Commands

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `git diff --check`
- [x] `./loom.sh --publish --test`
- [x] `npm run electron:package:dev`
