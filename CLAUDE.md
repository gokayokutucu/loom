# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project rules

`AGENTS.md` in the repo root is the authoritative working-rules document for this codebase (architecture boundaries, validation gates, PM tracking protocol, raw-thinking privacy rule, Rust service binary authority policy, etc.). Read it before making non-trivial changes — its rules are mandatory, not advisory, and are not repeated here.

`docs/` is the source of truth for product/architecture decisions (Loom model, resolver behavior, graph persistence, navigation rules). If code conflicts with `docs/`, the docs win. Key documents:
- `docs/loom_service_architecture_ledger.md` — Rust service roadmap/phase state (also gitignored locally as a live ledger; check before any `loom-service` work)
- `docs/loom_service_api_and_module_boundaries.md` — service API/module boundaries
- `docs/loom_engine_contract.md` — UI-to-engine boundary contract
- `docs/loom_graph_model.md`, `docs/loom_addressing_and_resolution_model.md` — Loom/Weft/Response/Reference graph model
- `docs/sqlite_graph_storage_model.md` — SQLite-as-source-of-truth storage model

`_PM/Agent-PM/` holds versioned Plans/Tasks/Tests/QA docs tracking in-flight work — check `_PM/Agent-PM/Plans/` for the current phase design when picking up agent-runtime work.

## Commands

Frontend (Vite + React + TypeScript), run from repo root:
- `npm run dev` — Vite dev server
- `npm run build` — `tsc && vite build` (typecheck is part of build; there's no separate `lint`/`typecheck` script)
- `npm run test:unit` — vitest run (single run); `npm run test:unit:watch` for watch mode
- `npx vitest run path/to/file.test.ts` — run a single test file
- `npm run test:e2e` — Playwright E2E (`playwright.config.ts`)

Rust service (`services/loom-service`), run from repo root:
- `npm run service:dev` — `cargo run` the service
- `npm run service:check` — `cargo check`
- `npm run service:test` — `cargo test`
- `cargo test --manifest-path services/loom-service/Cargo.toml <test_name>` — run a single Rust test
- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check` — required before considering Rust changes done

Electron packaging:
- `npm run electron:dev` — run Electron against dev Vite server
- `npm run electron:package:dev` — builds release Rust service binary + frontend build + packages dev Electron app (run after any UI/CSS/renderer change per AGENTS.md §8)
- `npm run electron:package:mac:arm64` / `electron:dist:mac:arm64` — macOS arm64 package/dist
- `npm run electron:package:win` / `electron:dist:win`, `electron:package:linux` / `electron:dist:linux`

Combined validation:
- `./loom.sh --test` — frontend-only validation (no Rust rebuild)
- `./loom.sh --publish --test` — rebuilds the Rust service binary first, then validates; required whenever Rust service code, provider runtime, service endpoints, orchestration, or Electron sidecar behavior changed
- `./loom.sh --publish --test --e2e-thinking [--e2e-port <port>]` — adds the ThinkingPanel live-reasoning-stream E2E
- `loom.sh` never stages, commits, pushes, tags, merges, or releases — that must be done explicitly and separately

## Architecture

Loom is an Electron desktop app (React/TypeScript renderer) backed by a Rust sidecar service (`services/loom-service`, Axum-based) that owns all persistence and orchestration. SQLite is the sole canonical store; Tantivy (lexical/BM25) and LanceDB (vector/semantic) are **rebuildable projection indexes** derived from SQLite, never a second source of truth.

### Core domain model
- **Loom** — an addressable container for AI work (Responses, References, Wefts, attachments, retrieval history)
- **Weft** — an exploration branch off a Response; preserves hidden origin/seed context without copying it into the visible transcript (`is_hidden_background` is irreversible once set)
- **Response** — a node in a Loom; the unit conversation turns are built from
- **Reference** — a Response reused inside a new prompt, carrying provenance instead of copy/paste
- **Bookmark** — promotion of ephemeral Quick Ask output into durable Loom/Reference/Weft state
- **Quick Ask** — ephemeral, lightweight ask/search surface; output is promoted into a Loom only when useful
- **Attachment** — explicitly added local file context; parsed/chunked/deduped separately and only included when its chip is activated
- **Graph** — connects Looms, Wefts, Responses, References, Bookmarks, attachments, and retrieval lineage into a navigable structure (not a linear chat history)

Do not reintroduce generic chat-app/CRUD vocabulary (e.g. "conversation", "message thread") in place of these terms — see AGENTS.md §1/§10.

### Agent runtime pipeline (current branch focus)

The retrieval/context pipeline for agent runs is being built in phases and flows in this order:

```
User Query → Scope Resolution → Hybrid Retrieval (per tier) → Context Selection → Context Manager → Prompt Assembly
```

- **Scope Resolution** (`scope_resolution.rs`) answers "where is it valid to look?" — produces a `ScopeContext` (per-scope `ScopeDescriptor`s, loom allowlists per retrieval tier, weft-detection, visibility flags) by reading SQLite metadata only (counts/flags, never content). Its only effect on existing types is an additive `loom_ids: Vec<String>` field on `RetrievalQuery`.
- **Hybrid Retrieval** (`retrieval/`) answers "what is relevant?" — fuses Tantivy (lexical) and LanceDB (vector) results via Reciprocal Rank Fusion (k=60, with domain rank pre-shift: memory=1.2, attachment_chunk=1.1, others=1.0), scoped by the loom allowlist from Scope Resolution.
- **Context Selection** (`context_selection.rs`) owns tier assignment and within-tier ordering across an 11-tier model (PolicyAlwaysInclude, ConversationThread, WeftOriginChain[hidden], ProjectGroup[reserved], ScopedMemory, GlobalMemory, ConversationAttachment, ProjectAttachment[reserved], ScopedRetrieval, CrossConversation, ArchivedRetrieval, ToolMcpContext[reserved]). It produces identity-only `ContextCandidate`s (source_kind/source_id/chunk_ref + scoring + token estimate) — **never carries full content**.
- **Context Manager** (`context/manager.rs`) is the only place in the pipeline that fetches full content from SQLite (by `source_kind`/`source_id`), applies the token budget, and assembles the final prompt.

Design docs for each phase live under `_PM/Agent-PM/Plans/Phase*_*.md` and should be read before extending any of these modules — several boundaries here (e.g. Scope Resolution never holds query text or content; Context Selection never carries content) are deliberate and load-bearing, not incidental.

### Privacy invariant: raw thinking

Raw model thinking/chain-of-thought must never be persisted or pass through SQLite, retrieval projections, Context Selection, diagnostics, exports, or graph artifacts (AGENTS.md §15). Forbidden content markers are checked at write time; treat any new code path touching model output, memory extraction, or diagnostics as needing this guard.

### Rust service module map (`services/loom-service/src/`)

- `api/` — Axum HTTP handlers, one file per resource (looms, wefts, responses, references, bookmarks, memory, attachments, context, orchestration, graph, etc.)
- `storage/` — SQLite access: `db.rs`, `migrations.rs` (numbered `.sql` files under `migrations/`), `repositories/` (one repo per table/aggregate)
- `retrieval/` — Tantivy/LanceDB adapters + hybrid fusion service + diagnostics
- `context/` — Context Manager: budget, policies, contributors, artifact loading, readiness gating, refinement
- `context_selection.rs`, `scope_resolution.rs`, `agent_context_manager.rs` — agent-runtime pipeline pieces described above
- `orchestration/`, `agent_runtime/`, `capabilities/` — multi-step/agentic execution and capability surface
- `providers/` — model provider abstraction (Ollama today; never hardcode a single provider — route by intent via quickModel/mainModel)
- `domain/`, `graph/`, `exports/`, `events/`, `speech.rs`, `config.rs` — supporting domain types, graph persistence, export pipelines, event streaming, speech-to-text, runtime config

Config is read via `LOOM_SERVICE_CONFIG_PATH` (not a `--config` CLI flag), with `LOOM_SERVICE_PORT` and `LOOM_SERVICE_DB_PATH` as overrides — relevant when scripting smoke tests against a packaged sidecar binary.

### Frontend module map (`src/`)

- `engine/` — `LoomEngineClient` abstraction with two implementations: `RustHttpLoomEngineClient` (talks to `loom-service`, the product runtime) and `TypeScriptLocalLoomEngine` (legacy/dev/test-only local engine, see `docs/typescript_runtime_deprecation_plan.md`)
- `services/` — business logic/state-adjacent helpers (context building, navigation, model selection, provider discovery, export, etc.) — UI components must not contain this logic
- `features/` — feature-scoped UI modules (currently `graph`; address-bar, composer, weft, history, bookmarks, ask are modular concerns per AGENTS.md §4)
- `hooks/`, `state/`, `components/` — state/behavior in hooks, presentation in dumb components

### Electron shell (`electron/`)

`sidecar-manager.mjs`/`sidecar-lifecycle.mjs` manage the bundled Rust `loom-service` binary as a subprocess; `package-dev.mjs`/`package-mac-arm64.mjs`/`build-win.mjs`/`package-linux.mjs` are per-platform packaging entry points invoked by the `electron:package:*` npm scripts. macOS icon packaging has a strict contract (source `public/loom_logo.icns` → `Loom.app/Contents/Resources/loom_logo.icns`, no leftover `electron.icns`) — see AGENTS.md §16 before touching packaging.

### E2E testing

Product-mode E2E (`e2e/`) must run against the real `rust-service` runtime with an isolated temp SQLite DB, create data through service/product flows (not static JSON fixtures), and clean up the temp DB/service afterward — see AGENTS.md §8.2 for the full data-authority policy and required reporting.

## PM Reporting Contract and Output Format

To prevent roadmap drift and ensure consistent project tracking, every final response for any completed task or milestone MUST conclude with a strict structured PM Report.

### Mandatory Report Structure
Your output MUST include the exact sections below. A report missing any of these sections is INVALID.

### ROADMAP STATUS
- **Current Phase**: [Phase ID and Name]
- **Current Epic**: [Epic Name]
- **Current Task**: [Task ID]

### PROGRESS
- **Overall Project Progress**: [Z]%
- **Current Phase Progress**: [X]%
- **Current Epic Progress**: [Y]%

### REMAINING BIG BLOCKS
- [List of uncompleted Epics/Phases gating completion]

### CRITICAL PATH
- [Ordered list of Phases/Tasks that gate production]

### ESTIMATED REMAINING WORK
- Current Epic: [N] engineering days
- Current Phase: [N] engineering days
- Entire Project: [N] engineering days

### LEDGER
**LOCKED**
- [Task IDs]

**ACTIVE**
- [Task IDs]

**NEXT**
- [Task IDs]

**HOLD-BACKLOG**
- [Task IDs]

### NEXT RECOMMENDED TASK
- [Exact Task ID]

### Source-Of-Truth Rules
You MUST derive all status from repository documents (`docs/loom_master_roadmap.md`, `docs/pm_operating_model.md`, `docs/ledger_contract.md`, `docs/pm_reporting_contract.md`, `docs/pm_reporting_enforcement.md`).
You MUST NOT invent percentages, ACTIVE/NEXT tasks, remaining work estimates, or reuse stale ledger values. Percentages must be mathematically derived from the checklists in `_PM/Agent-PM/Tasks/`.

### Drift Detection Rules (`report_drift_detected`)
Trigger the `report_drift_detected` state when: roadmap progress differs mathematically from physical checklist counts, active task differs from the roadmap without formal promotion, phase differs, critical path differs from roadmap dependencies, or remaining work differs from the established formula.
When triggered, you MUST halt `LOCKED` promotion, output a `### DRIFT WARNING`, and request human triage.

### PM Skill Contract
Specialized PM agents or skills determining status must do the following programmatically:
- **current phase**: Derived from `docs/loom_master_roadmap.md` Phase mappings.
- **current epic**: Derived from `docs/loom_master_roadmap.md` Epics lists.
- **active task**: Selected strictly per `docs/pm_operating_model.md` priority queue logic.
- **next task**: Evaluated from the remaining unblocked checklist items.
- **progress**: Counted mathematically from physical `- [x]` items vs `- [ ]` items in `_PM/Agent-PM/Tasks/`.
- **critical path**: Computed from the `Depends On` column in the roadmap.

