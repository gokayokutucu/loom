# LOOM-VALIDATION-SCRIPT-001

## Objective

Add a root-level Loom validation helper script for standard local validation after manual staging.

## Checklist

- [x] Create root-level `loom.sh`.
- [x] Support `--test`, `--publish`, `--e2e-thinking`, `--e2e-port`, and `--help`.
- [x] Keep script non-mutating for Git state: no staging, commit, push, tag, merge, or release.
- [x] Make script executable.
- [x] Validate help output.
- [x] Run requested publish/test/e2e validation command.
- [x] Run `git diff --check`.
