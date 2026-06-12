# PM Documentation Hygiene Rules

This document establishes conventions for keeping repository-tracked project management (Agent-PM) artifacts clean, portable, and free of local-only runtime data, private paths, and credentials.

---

## 1. Scope & Goals
As agentic workflows generate planning, execution, and QA reports under `_PM/Agent-PM/`, they must not leak details of the local development machine, active OS environment, or credentials into git history.

---

## 2. Repo-Safe Content Rules

### Repo-safe PM docs MAY include:
- Task ID (e.g. `AGENT-UI-RUN-INSPECTOR-PACKAGED-SMOKE-001`)
- Git branch name (e.g. `feature/agent-runtime`)
- Commit hash (e.g. `2543a46` or abbreviated format)
- High-level validation results and summaries
- Test command names (e.g. `cargo test`, `vitest run`)
- Test pass/fail statistics
- API endpoint route names (e.g. `/health`, `/ask/quick`)
- Feature gate names (e.g. `isExperimentalAgentInspectorEnabled()`)
- Sanitized runtime status categories (e.g. `ready`, `error`, `resolving-binary`)
- Known limitations
- Next task recommendations

### Repo-safe PM docs MUST NOT include:
- Local absolute file paths (e.g., `/Users/username/Documents/...`)
- Absolute `file://` scheme URLs (use repo-relative paths instead)
- User home directory paths (e.g. `~/Library/...`)
- Local SQLite database paths (e.g. `/Users/username/Library/Application Support/Loom/...`)
- Local config paths (e.g. `loom-service.toml` absolute paths)
- Local Process IDs (PIDs) (e.g. `PID 12345`)
- Local filesystem inodes (e.g. `inode 186521074`)
- Exact runtime binary fingerprints/hashes (e.g. `sha256:3cec1b6ad...`)
- Raw JSON payloads from `/health` or model responses
- `Authorization` headers
- `Bearer` tokens
- API keys, credentials, or secret values (even mock values unless fully generalized)
- Raw provider request/response payloads
- Raw LLM reasoning/thinking/monologues (privacy guard)
- Antigravity/Gemini scratch paths (e.g. `.gemini/...` or `/scratch/...`)
- Temporary local script paths outside the repository

---

## 3. Preferred Replacements

When recording validation output, replace local-only markers with these standard placeholders:

| Local-only Marker | Repo-Safe Replacement |
| :--- | :--- |
| `/Users/<user>/Documents/Workspace/LoomAI/...` | `<repo-root>/...` |
| `file:///Users/<user>/...` | relative repo path (e.g., `../../src/...`) or omit link target |
| `~/Library/Application Support/...` | `<app-data-dir>/...` |
| `PID 12345` | `PID observed locally` or `PID omitted` |
| `sha256:3cec1b6ad...` | `fingerprint matched` or `fingerprint verified` |
| Raw `/health` JSON | Summarized health status |
| `.gemini/antigravity/scratch/...` | `local scratch artifact, not committed` |

---

## 4. PM Docs Pre-Commit Checklist

Before committing any PM documents to the repository, run the following steps:

1. **Check Staging Status**:
   ```bash
   git status --short
   ```
2. **Review Staged Files**:
   ```bash
   git diff --cached --name-only
   ```
3. **Audit Staged Content for Forbidden Markers**:
   Run the following grep filter:
   ```bash
   git diff --cached | grep -Ei "file://|/Users/|/private/|Library/Application Support|PID|fingerprint|inode|Bearer|Authorization|api[_-]?key|secret|token|\\.gemini|antigravity|scratch" || true
   ```
   > [!NOTE]
   > A match from this grep command does not automatically mean failure (e.g. a rule explaining secret masking will trigger it). However, every match must be manually reviewed and either sanitized, generalized, or explicitly justified.

4. **Confirm Phase and Ledger Alignment**:
   Ensure listed phase names and ledger sections align with `docs/loom_service_architecture_ledger.md` and do not conflict.
