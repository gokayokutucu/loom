---
name: loom-validation
description: Use the root Loom validation helper script as the standard validation gate before commits. Use when preparing task completion reports, commit instructions, manual validation steps, or scoped Loom quality checks.
---

# Loom Validation Skill

## Purpose

Use `loom.sh` as the standard validation gate before committing Loom changes.

## When to Use

- Before reporting that an implementation is complete.
- Before or during a scoped commit workflow.
- When the user asks which validation command to run.
- When a task changes service, provider, orchestration, Electron sidecar, ThinkingPanel, or frontend behavior.

## Command Matrix

Frontend-only:

```bash
./loom.sh --test
```

Rust service, provider runtime, orchestration, service endpoint, or Electron sidecar affected:

```bash
./loom.sh --publish --test
```

ThinkingPanel live reasoning stream affected:

```bash
./loom.sh --publish --test --e2e-thinking
```

ThinkingPanel E2E with a custom port:

```bash
./loom.sh --publish --test --e2e-thinking --e2e-port 5191
```

## Manual Commit Workflow

```bash
git status --short
git add <scoped files>
git diff --cached --name-only
git diff --cached --check
./loom.sh --publish --test
git commit -m "<message>"
git status --short
git show --stat --name-only HEAD
```

Adjust `./loom.sh` flags from the command matrix based on the task type.

## Rules

- The user stages files manually unless explicitly delegated.
- The script does not stage, commit, push, tag, merge, or release.
- The script must be run from the repository root.
- Keep commits scoped.
- Do not include unrelated files.
- Do not push unless explicitly asked.
- For commit-prep output, include `git diff --cached --name-only` before the validation command.

## Task Output Template

Manual validation:

```bash
git diff --cached --name-only
./loom.sh --publish --test
```

Use `./loom.sh --test` for frontend-only work, and add `--e2e-thinking` plus `--e2e-port <port>` when the ThinkingPanel live reasoning stream needs product E2E proof.
