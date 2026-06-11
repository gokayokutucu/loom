# Task: AGENT-UI-RUN-INSPECTOR-001 v1.0

- [x] Audit branch, working tree, API client patterns, Settings diagnostics, and NDJSON conventions.
- [x] Add an isolated experimental Agent Runtime stream client.
- [x] Add whitelist-based event sanitization and safe stream errors.
- [x] Add a gated Agent Run Inspector under Settings → Advanced.
- [x] Keep prompt and streamed rows transient and non-persistent.
- [x] Add gate, endpoint isolation, stream parsing, sanitization, and UI rendering tests.
- [x] Run frontend and standard Loom validation.
- [x] Package Electron and verify package/icon output.
- [x] Commit locally without pushing.

## Known Limitations

- The inspector is a manual proof surface, not a product Agent composer.
- The inspector does not expose cancellation controls; it can display a terminal cancellation event if the run is cancelled through the experimental API.
- Runs and event rows are intentionally lost when the Settings modal closes or the app reloads.
- Packaged `Loom.app` was built successfully. A first startup correctly rejected the already-running debug service with `runtime_binary_mismatch`; the isolated-port retry could not be authorized by the execution environment, so a clean packaged window startup remains a follow-up smoke.
