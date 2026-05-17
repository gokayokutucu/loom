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

## 14) Rust Service Binary Authority Policy

For every task touching any of these paths or boundaries:

- `services/loom-service/**`
- service provider/runtime code
- orchestration code
- context code
- speech code
- capability code
- storage, migrations, and repositories
- Rust API endpoints
- Rust config
- frontend engine/client code that changes the `loom-service` request/response contract, runtime routing, request lifecycle, or service-backed behavior

Codex MUST treat the Rust service binary as an authority boundary:

1. Build the Rust service after source changes.
2. Stop any stale `loom-service` process that Codex started for the task.
3. Start the service from the freshly built binary for live/manual/service-backed validation.
4. Verify and report the executable path.
5. Verify and report the PID and service port.
6. Call `GET /health` and verify it reports the expected `loom-service` runtime.
7. Prefer a build/version/fingerprint check when available.
8. Run relevant tests against that verified fresh service.
9. Report the database path and config path, and whether they are test/temp or dev paths.
10. Report whether any pre-existing user/dev-owned `loom-service` process was left untouched.
11. Never claim live/manual validation passed unless it used the verified fresh binary.

Live dev service anti-stale rule:

- If the user is validating the current browser app, Codex MUST identify the exact service URL/port used by that app before judging behavior.
- If that service process started before the current `services/loom-service/target/debug/loom-service` binary modification time, Codex MUST classify it as `runtime_binary_mismatch`.
- A `runtime_binary_mismatch` blocks debugging of prompts, providers, context, UI state, or model behavior until the process is replaced.
- When the stale process owns the service URL/port used by the current browser app, Codex MUST restart that process from the freshly built binary on the same port before continuing live/manual validation. This is not optional cleanup; it is part of the validation contract.
- Codex may leave unrelated `loom-service` processes untouched only if they are not the process backing the current app/test being validated.
- After restart, Codex MUST refresh or explicitly ask the user to refresh the browser when frontend or runtime state could be cached.
- Codex MUST re-run the failing request or a direct equivalent `/ask/quick`, `/orchestration/execute`, or relevant endpoint proof against the restarted service before saying the task is fixed.

End-of-task browser/runtime sync gate:

- For every task that changes Rust service code, service-calling frontend code, engine client code, Quick Ask, Main composer generation, provider/runtime behavior, or service-backed tests, and the user has the browser open on the local app, Codex MUST verify the service behind the browser's configured endpoint before the final response.
- This gate does not apply to UI-only or CSS-only changes that do not modify Rust code, engine clients, service DTOs, request lifecycle, generation behavior, Quick Ask semantics, Main composer service behavior, or service-backed tests.
- A frontend change is service-gated only when it changes how the UI calls `loom-service`, interprets service responses/errors, or validates service-backed behavior. Presentational UI validation in the browser does not require restarting `loom-service`.
- The check MUST resolve the browser app's service route, including Vite proxy routes such as `/__loom -> http://127.0.0.1:17633`.
- Codex MUST compare the running process executable path/inode/start time with `services/loom-service/target/debug/loom-service` after the final build.
- If the browser-backed process is stale, Codex MUST restart it from the fresh binary before finalizing, then call `/health` and report the new PID/port/binary path/DB/config.
- A separate fresh-binary smoke test on an isolated port is NOT sufficient when the user's open browser is backed by a different long-running dev service.
- Codex MUST NOT finish a Rust-service, engine-boundary, Quick Ask, Main composer, provider/runtime, or service-backed UI task with "completed" status while the current browser app is still connected to a stale `loom-service` process.
- The final response for any task covered by this gate MUST explicitly state one of:
  - browser-backed service verified fresh, with PID, port, binary path, health result, DB path, and config path
  - no active browser/dev service was used for validation
  - blocked by `runtime_binary_mismatch` because restart was not allowed
- If Codex cannot restart the stale browser-backed process because permission is denied or the user refuses, the task status MUST be `blocked` or `partial`, and the final answer must say the browser is not using the latest service.
- A task is not complete if tests pass against a temporary service but the user-facing browser app still points at a stale dev service.

Mandatory commands when Rust service files change:

- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- `cargo check --manifest-path services/loom-service/Cargo.toml`
- `cargo test --manifest-path services/loom-service/Cargo.toml`
- `npm run service:check`
- `npm run service:test`
- `npm run build`
- `git diff --check`

If E2E or manual service behavior is validated, Codex MUST also:

- build a fresh service binary first
- start the service from that fresh binary
- call `/health`
- record binary path, PID, port, DB path, and config path
- run the relevant E2E/manual validation against that verified service

Fresh binary verification rules:

- Before starting a service, kill only test-owned `loom-service` processes.
- Do not kill user/dev-owned service processes unless explicitly instructed, except when that process is the stale runtime backing the current browser app/test under validation. In that case, restart it from the fresh binary and report the action.
- If a process already owns the desired port, identify it and either fail with a clear reason or use an isolated test port.
- After starting the service, record service URL, PID, executable path, working directory, database path, config path, and whether it is using a temp test DB or dev DB.
- Provider health may be degraded, but DB/config must be ready for data tests.
- Health output must not be accepted as proof if it may come from a stale process.
- If no build/runtime fingerprint endpoint or health field exists, add follow-up task `SERVICE-BINARY-FINGERPRINT-001`.

Product-mode E2E harnesses MUST use:

- temp SQLite DB
- temporary `loom-service`
- freshly built service binary
- strict `rust-service` mode
- data created through service/product flow
- cleanup after test

If Playwright starts a service, it must use the fresh binary and must not silently connect to an already-running stale service. If validating against an existing manually running app, report that it is manual/dev validation only and do not use it as CI proof.

Manual UI validation MUST report:

- service URL used by the UI, running `loom-service` PID, executable path, process start time, binary modification time, and DB/config path when the manual scenario validates service-backed behavior
- whether the binary was rebuilt after the latest Rust source change and whether the running process started after the rebuilt binary when Rust/service code changed
- whether the browser was refreshed after service restart when a service restart was required
- whether stale Vite/app state could exist

Manual validation of service-backed behavior is invalid if the service binary path is unknown, PID is unknown, service was not restarted after Rust changes, the process start time is older than the rebuilt binary, the browser points to a stale service URL, or the UI bundle was not refreshed after frontend changes. Manual validation of UI-only/CSS-only changes only needs the latest frontend bundle/browser refresh; it does not require `loom-service` restart or binary proof.

Codex MUST NOT say "live smoke passed", "real UI verified", "service-backed proof passed", or "manual scenario passed" unless it reports fresh binary path, service PID, service port, health result, DB/config path, and test command/output.

If a stale binary or wrong service process is detected, classify it as:

`runtime_binary_mismatch`

This is a blocking error. It must not be treated as a model, prompt, context, provider, or UI bug until the binary/process mismatch is resolved.

---

## 15) Raw Thinking Privacy Rule

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
