# Task CONTEXT-SNAPSHOT-LINKING-001 v1.0

## Goal

Add a safe repository seam for linking an existing Context Snapshot to an existing Agent Run.

## Checklist

- [x] Audit branch, worktree, and required pushed commits.
- [x] Inspect Context Selection, Context Snapshot, Agent Run, runtime, and schema contracts.
- [x] Add `AgentRunRepository::link_context_snapshot`.
- [x] Validate Agent Run and Context Snapshot existence.
- [x] Preserve run status and all non-link fields.
- [x] Make same-link calls idempotent.
- [x] Reject conflicting snapshot ownership or replacement.
- [x] Add focused tests.
- [x] Run full validation.
- [x] Run fresh debug runtime verification.
- [x] Run packaged sidecar verification.
- [x] Commit with `feat: link context snapshots to agent runs`.

## Scope Guard

- [x] No Context Manager implementation.
- [x] No prompt assembly or content fetching.
- [x] No generation-path wiring.
- [x] No Context Selection ranking changes.
- [x] No Main generation or Quick Ask changes.
- [x] No Memory Policy, Tool, or MCP implementation.

## Schema Note

`agent_runs.context_snapshot_id` has no DB-level foreign key. Forward-link integrity is therefore enforced by repository-level validation. The reverse optional `context_snapshots.agent_run_id` column has a foreign key to `agent_runs.agent_run_id`.

## Validation Evidence

Passed:

- Focused Context Snapshot linking repository tests: 3 passed.
- Full Rust suite: 926 passed.
- Full Vitest suite: 559 passed across 32 files.
- Rust format/check, npm service wrappers, production build, Electron dev packaging, and `git diff --check`.
- Packaged sidecar SHA-256 matches the release binary.
- Packaged icon matches `public/loom_logo.icns`; `electron.icns` is absent and `CFBundleIconFile` is `loom_logo.icns`.
- `./loom.sh --publish --test` passed successfully.
- Fresh debug and packaged sidecar verification succeeded (using port 17699). `/health` check returned status 'ready' and correct fingerprints and git commit hashes.
- Temporary files and ports were released and cleaned up successfully.
