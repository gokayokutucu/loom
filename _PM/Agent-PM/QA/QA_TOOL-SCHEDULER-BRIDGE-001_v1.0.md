# QA TOOL-SCHEDULER-BRIDGE-001 v1.0

## Architecture

- [x] Canonical path is `AgentRuntime -> ToolSchedulerRuntime -> ToolSchedulerRepository`.
- [x] Adapter availability is resolved through the `ToolAdapter` contract.
- [x] Legacy `ToolRegistry` is not used for AgentRuntime invocation scheduling.
- [x] No migration or public API contract change was introduced.

## Safety And Privacy

- [x] No adapter `execute` call is made by the bridge.
- [x] No shell, filesystem, network, provider, MCP, or arbitrary command execution was added.
- [x] Scheduler records metadata only.
- [x] No prompt, raw provider payload, stdout/stderr, file content, secret, or raw thinking is persisted.

## Runtime Verification

- [x] Fresh debug service uses a freshly built binary and isolated DB/config.
- [x] Fresh debug service `/health` is ready and safe smoke passes.
- [x] Debug process stops and releases its port.
- [x] Packaged sidecar uses isolated DB/config.
- [x] Packaged sidecar `/health` is ready and safe smoke passes.
- [x] Packaged process stops and releases its port.
- [x] Browser-backed 17633 sidecar was restarted from the freshly packaged binary.
