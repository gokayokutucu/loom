# QA TOOL-ARTIFACTS-001 v1.0

## QA Objective

Confirm Tool Artifact lifecycle behavior is reference-only, least-privilege, soft-delete aware, and privacy-preserving.

## Checklist

- [x] Artifact references store metadata only.
- [x] Artifact creation validates ownership against the existing invocation.
- [x] Artifact kinds are restricted to the supported safe set.
- [x] Artifact visibility is restricted to the supported semantic set.
- [x] Locked schema visibility values are preserved through repository mapping.
- [x] Default artifact reads omit soft-deleted records.
- [x] Default artifact lists omit soft-deleted records.
- [x] Include-deleted paths are explicit.
- [x] Storage refs are not dereferenced or read as file contents.
- [x] Metadata sanitizer rejects raw output, stdout/stderr, prompt, provider, secret, credential, and raw-thinking markers.
- [x] No tool execution path added.
- [x] No MCP/provider/shell/file/network execution added.
- [x] No UI or Context Manager changes added.
- [x] Full validation suite passed.
- [x] Fresh debug service verified migration state.
- [x] Packaged sidecar verified migration state.
- [x] Electron icon packaging checks passed.

## Risk Notes

- The locked `0028_tool_scheduler_foundation.sql` migration stores `visibility` as `agent_internal`, `user_visible`, or `exportable`. The repository accepts the task's semantic values (`private`, `run`, `root_run`, `user_visible`) and maps them to the existing stored values instead of rewriting a locked migration.
- Artifact event integration remains deferred. This repository layer does not own AgentRun event sequencing.

## Changelog

- v1.0: Initial QA checklist for Tool Artifact lifecycle repository policy.
