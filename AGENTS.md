# LoomAI Agent Rules

This file defines working rules for the LoomAI workspace.

---

## 1) Core Principle

LoomAI is an **AI browser / AI OS**, not a CRUD app.

Always think in terms of:
- Loom (container)
- Weft (lineage)
- Response (node)
- Reference (usage)
- Bookmark (promotion)
- Window (projection)

Do NOT reintroduce obsolete container, lineage, composer, or promotion labels.

---

## Documentation Source of Truth

All architectural and product decisions are defined under:

`docs/`

Agents MUST consult relevant documents before implementing:

- Loom model
- Resolver behavior
- Graph persistence
- Composer behavior
- Navigation rules

If implementation conflicts with docs:
→ docs are the source of truth

---

## 2) Architecture Boundaries (Mandatory)

- Resolver, graph model, and addressing logic live in services layer
- UI components must NOT contain business logic
- Weft / Loom projection logic must be computed in hooks/services, not components
- Model providers must be abstracted (Ollama, OpenAI, etc.)

---

## 3) Frontend Standards (React + TypeScript)

- Strict TypeScript only
- No `any`
- Component-first architecture
- Separate:
  - UI (components)
  - state (hooks)
  - logic (services)

---

## 4) Component Architecture Rules

- AppShell = layout only
- Features must be modular:
  - address-bar
  - composer
  - weft
  - history
  - bookmarks
  - graph
  - ask

- Components must be dumb
- Hooks/services must own behavior

---

## 5) Model Provider Rules

- Never hardcode a single model
- Always route by intent:
  - Quick → quickModel
  - Main → mainModel

- Do NOT install Ollama automatically
- Only detect and guide user

---

## 6) Workflow and Safety

- Do not commit or push unless explicitly asked
- Keep changes minimal
- No silent architectural drift

---

## 7) UX Contract Protection

- Do NOT change user-visible behavior silently
- If UI changes → explicitly explain
- Preserve Loom mental model

---

## 8) Validation

Before finishing any change:

- npm run build
- git diff --check
- Run targeted E2E when the task touches a tested feature
- Run full E2E when broad architecture, routing, or test infrastructure changes occur

---

## 8.1) E2E Data Authority Policy

Product-mode E2E tests MUST:

1. Use `rust-service` product runtime.
2. Start `loom-service` with an isolated temporary SQLite database.
3. Create test data through service/product flows, not by relying on static JSON fixtures.
4. Assert against data persisted by `loom-service`.
5. Stop the service after the test.
6. Delete temporary DB/config/files after the test.
7. Never use the user's real DB, production data, or default developer DB.
8. Never silently fall back to TypeScript runtime.
9. Treat TypeScript-local mode as explicit legacy/dev/test-only.
10. Avoid live Ollama as a CI requirement; use deterministic service/provider behavior where needed.
11. Keep live Ollama tests as optional smoke tests only.
12. Preserve raw-thinking privacy in all fixtures, logs, DB assertions, exports, and copied output.

Static JSON fixtures may be used only for:

- tiny expected snippets
- deterministic provider mappings
- schema examples
- explicitly marked legacy/dev/test tests

Static JSON fixtures MUST NOT be the main proof path for product-mode E2E.

Every task touching E2E tests must report:

- whether the test uses temp SQLite DB
- whether loom-service was started
- whether test data was created through service/product flow
- whether cleanup removed temp files/DB
- whether any TypeScript-local mode remains and why
- whether any static fixture remains and why

E2E fixtures and assertions must never include:

- `raw_thinking`
- `thinking_text`
- `chain_of_thought`
- `hidden_reasoning`

---

## 9) Output Format

Responses should be:
- concise
- structured
- aligned with Loom concepts

Every Codex task output must include:

- Task ID
- Task status:
  - completed
  - partial
  - blocked
  - inspection-only
- Summary of changes
- Files changed
- Behavior changed
- Validation commands and results
- Commit/push status
- Ledger update recommendation:
  - move from ACTIVE to LOCKED
  - keep ACTIVE
  - add NEXT item
- Current ledger block:
  - LOCKED
  - ACTIVE
  - NEXT

---

## 10) Drift Prevention

If you see obsolete container, lineage, promotion, or composer labels, you MUST fix them.

---

## 11) Development Direction

Always optimize for:
- graph-first thinking
- addressable AI objects
- browser-like navigation

Never fall back to:
- chat app patterns
- CRUD thinking

---

## 12) Loom Service / Ledger Reporting Rules

For any task related to `loom-service`, Rust service, SQLite engine, provider runtime, context pipeline, orchestration workflow, engine boundary, or future Electron/Rust integration:

- consult `docs/loom_service_architecture_ledger.md`
- consult `docs/loom_engine_contract.md` when UI-to-engine boundaries are involved
- report whether `docs/loom_service_architecture_ledger.md` needs updating
- do not silently change the ledger
- if the ledger changes, mention exact sections updated

For every Codex output, include:

- completed task id
- summary of changes
- files changed
- validation commands and results
- whether commit/push was performed
- ledger movement recommendation
- current ledger block

Ledger recommendations must use:

- move from ACTIVE to LOCKED
- keep ACTIVE
- add NEXT item

---

## 13) Loom Service Phase Reporting Rules

For any task related to:

- `loom-service`
- Rust service
- TypeScript engine boundary
- Electron shell
- SQLite persistence
- Ollama/provider runtime
- ContextManager
- orchestration/workflow
- Graph/addressing engine
- exports/imports
- extensions/MCP

Codex output MUST include a phase report.

Codex must consult these source-of-truth documents for phase names, roadmap state, and boundary decisions:

- `docs/loom_service_architecture_ledger.md`
- `docs/loom_service_api_and_module_boundaries.md`
- `docs/loom_engine_contract.md`

If phase docs and the current task disagree, report the mismatch and do not silently invent phase state.

Required phase report format:

- Current Phase:
  - Phase number
  - Phase title
  - Phase purpose
- Current Task:
  - Task ID
  - Task status:
    - completed
    - partial
    - blocked
    - inspection-only
- Phase Sub-Items:
  - list all known sub-items under that phase
  - mark each as:
    - done
    - active
    - pending
    - blocked
- Completed In This Task:
  - sub-items completed by this task
- Remaining In This Phase:
  - sub-items still pending or blocked
- Phase Status:
  - not started
  - active
  - partial
  - completed
  - blocked
- Next Phase:
  - phase number
  - phase title
  - only if current phase is completed or nearly completed
- Next Recommended Task:
  - exact task id
  - short reason
- Ledger Update Recommendation:
  - move task to LOCKED
  - keep task ACTIVE
  - add NEXT item
  - update `docs/loom_service_architecture_ledger.md` if needed
- Current Ledger Block:
  - LOCKED
  - ACTIVE
  - NEXT

Example phase report:

```text
Current Phase:
Phase 4 — Provider Runtime

Current Task:
SERVICE-OLLAMA-001 — completed

Phase Sub-Items:
- Ollama health endpoint — done
- Ollama models endpoint — done
- Streaming chat prototype — done
- Cancellation endpoint — partial
- Error classification — done
- Raw thinking privacy enforcement — done

Completed In This Task:
- Ollama health endpoint
- Ollama models endpoint
- Streaming chat prototype
- Error classification

Remaining In This Phase:
- Cancellation endpoint hardening
- UI/client integration later

Phase Status:
partial

Next Phase:
Phase 5 — Context Pipeline

Next Recommended Task:
SERVICE-CONTEXT-001 — define Rust ContextManager contract

Current Ledger Block:
LOCKED
- ...

ACTIVE
- ...

NEXT
- ...
```

For non-service product/UI tasks, the normal Task ID, validation, and ledger reporting rules are enough. Phase reporting is optional unless the task affects the service roadmap or engine/runtime architecture.

---

## 14) Raw Thinking Privacy Rule

Raw model thinking/internal monologue must never be persisted.

Raw thinking must not enter:

- SQLite
- summaries
- response capsules
- checkpoint summaries
- exports
- graph artifacts
- future context
- future prompts
- engine events

Only non-sensitive thinking duration/status metadata may be kept.

Engine events must not expose raw thinking text.
