# LOOM-VALIDATION-SCRIPT-001 Test Plan

## Script Behavior

- [x] No args prints usage and exits non-zero.
- [x] Unknown flags are rejected.
- [x] `--e2e-port` requires a value.
- [x] `--test` runs standard validation commands.
- [x] `--publish` runs a fresh Rust service build.
- [x] `--e2e-thinking` runs the targeted ThinkingPanel E2E with configurable port.

## Executed Validation

- [x] `./loom.sh --help` passes.
- [x] `./loom.sh --publish --test --e2e-thinking` passes.
- [x] `git diff --check` passes.
