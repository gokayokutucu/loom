# QA TOOL-SCHEDULER-SCHEMA-001 v1.0

## QA Objective

Confirm the Tool Scheduler schema and repository foundation are durable, privacy-preserving, and limited to storage-only behavior.

## Checklist

- [x] Schema stores scheduler metadata and references only.
- [x] Schema contains no raw tool payload columns.
- [x] Schema contains no stdout/stderr columns.
- [x] Schema contains no file content columns.
- [x] Schema contains no prompt or provider payload columns.
- [x] Schema contains no raw thinking columns.
- [x] Repository rejects forbidden diagnostics markers.
- [x] Repository methods do not execute tools.
- [x] Repository methods do not call MCP.
- [x] Repository methods do not call providers.
- [x] Repository methods do not touch filesystem or shell execution.
- [x] Repository links invocation, artifact, and grant records back to AgentRun/root_run_id.
- [x] Full validation suite passed.
- [x] Fresh debug service verified migration 0028.
- [x] Packaged sidecar verified migration 0028.
- [x] Electron icon packaging checks passed.

## Risk Notes

- Tool lifecycle status transitions are persistence-only. Runtime scheduling and permission arbitration remain future tasks.
- Artifact rows store `storage_ref`, digest, size, and visibility only; no artifact content is stored by this task.

## Changelog

- v1.0: Initial QA checklist for Tool Scheduler schema foundation.
