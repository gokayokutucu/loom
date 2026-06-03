# LOOM-VALIDATION-MANUAL-AND-AGENTS-DOC-001 Test Plan

## Documentation Checks

- [x] `AGENTS.md` names the correct `loom.sh` validation commands.
- [x] `AGENTS.md` requires a task-output Manual validation block.
- [x] Skill manual includes command matrix and commit workflow.
- [x] Skill manual states that `loom.sh` does not stage, commit, push, tag, merge, or release.

## Validation

- [x] `./loom.sh --help` passes.
- [x] `git diff --check` passes.
