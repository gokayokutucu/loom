# Test Plan: AGENTRUN-CONTEXT-CONSUMPTION-001 v1.0

## Behavioral Tests

- [x] AgentRuntime can build provider messages through legacy `ContextManager`.
- [x] Legacy context path includes recent turns.
- [x] Legacy context path includes references.
- [x] Legacy context path includes response capsules.
- [x] Legacy context path includes Weft origin context.
- [x] Legacy context path includes memory messages.
- [x] Context metadata reports `contextBuilt=true` and `contextSource=legacy_context_manager`.
- [x] Default/minimal AgentRuntime requests still report `contextBuilt=false`.
- [x] Main Generation production path remains untouched.
- [x] Quick Ask production path remains untouched.
- [x] Durable AgentRun events do not persist raw context content.

## Validation

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

## Runtime Verification

- [x] Fresh debug service starts with isolated DB/config.
- [x] Fresh debug service `/health` reports ready.
- [x] Fresh debug service stops and releases port.
- [x] Packaged sidecar starts with isolated DB/config.
- [x] Packaged sidecar `/health` reports ready.
- [x] Packaged sidecar stops and releases port.
