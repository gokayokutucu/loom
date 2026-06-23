# QA TOOL-PERMISSION-MODEL-001 v1.0

## QA Objective

Confirm Tool Permission Model behavior is explicit, least-privilege, repository-only, and privacy-preserving.

## Checklist

- [x] Permission evaluation is deny-by-default.
- [x] Pending grants do not authorize.
- [x] Denied grants do not authorize.
- [x] Revoked grants do not authorize.
- [x] Expired grants do not authorize.
- [x] Parent run grants do not automatically authorize child runs.
- [x] Root-run scoped grants can authorize descendants only when explicitly scoped.
- [x] Session/workspace scopes use existing schema boundaries and do not add global workspace identifiers.
- [x] Diagnostics contain counts/status only.
- [x] Metadata sanitizer rejects prompt/provider/raw-thinking/credential markers.
- [x] No tool execution path added.
- [x] No MCP/provider/shell/file/network execution added.
- [x] No UI or Context Manager changes added.
- [x] Full validation suite passed.
- [x] Fresh debug service verified migration state.
- [x] Packaged sidecar verified migration state.
- [x] Electron icon packaging checks passed.

## Risk Notes

- One-time grant consumption is not enforced yet because `tool_permission_grants` has no `consumed_at` or `consumed_by_invocation_id` field. The evaluator authorizes active one-time grants and returns `one_time_consumption_deferred=true` in safe diagnostics.
- Permission events remain deferred. Existing event infrastructure maps in-memory AgentEvents to AgentRun events, while this repository policy layer does not own event sequencing.

## Changelog

- v1.0: Initial QA checklist for Tool Permission Model repository policy.
