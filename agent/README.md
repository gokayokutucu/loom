# LoomAI Agent Workspace

This folder is a curated, project-local subset of agent skills adapted for LoomAI.

## Authority

The root `AGENTS.md` is the primary authority.
This `agent/` workspace extends execution guidance and must remain aligned with LoomAI architecture.

---

## Documentation

All LoomAI specifications live under:

- `docs/`

Agents should load these documents as needed:

- product positioning
- graph model
- addressing model
- composer model
- navigation model
- architecture ledger

---

## LoomAI Context

This workspace is built for a system that is:

- a graph-first AI browser
- based on Loom (container) and Weft (lineage)
- driven by resolver + window projections
- using References and Bookmarks as core primitives

This is NOT a traditional CRUD or chat application.

---

## Selected Skill Areas

Selected skills support LoomAI’s real delivery needs:

- planning and phased implementation
- resolver and graph reasoning
- React + TypeScript UI architecture
- model provider routing and runtime debugging
- regression prevention (TDD + review discipline)
- security and performance hardening
- architecture and decision documentation

---

## Included Skills

- `planning-and-task-breakdown`
- `incremental-implementation`
- `test-driven-development`
- `frontend-ui-engineering`
- `api-and-interface-design`
- `browser-testing-with-devtools`
- `debugging-and-error-recovery`
- `code-review-and-quality`
- `security-and-hardening`
- `ci-cd-and-automation`
- `documentation-and-adrs`
- `performance-optimization`

---

## Included References

- `references/testing-patterns.md`
- `references/security-checklist.md`
- `references/performance-checklist.md`
- `references/accessibility-checklist.md`

---

## How To Use In LoomAI

1. Start from root `AGENTS.md` constraints.
2. Think in Loom terms:
   - Loom (container)
   - Weft (lineage)
   - Response (node)
   - Reference (usage)
   - Bookmark (promotion)
3. Pick one or two skills that match the current phase.
4. Keep strict separation between:
   - UI (components)
   - state (hooks)
   - logic (services)
5. Use personas in `agent/agents/` for focused reviews.

---

## Agent Personas

The following personas define behavior modules for LoomAI:

- `agents/loom-ui-guardian.md`
  → protects UI architecture, component boundaries, and Loom/Weft semantics

- `agents/loom-debugger.md`
  → isolates resolver, graph, runtime, and UI failures

- `loom-agent-rules.md`
  → defines execution flow and development discipline

---

## Scope Guardrails

- Do not reintroduce Conversation / Thread terminology.
- Do not move business logic into UI components.
- Do not bypass resolver or graph model.
- Do not silently change UX behavior.
- Keep patches minimal, explicit, and reversible.

---

## Development Direction

Always optimize for:

- graph-first thinking
- addressable AI objects
- browser-like navigation
- provider-agnostic model execution

Never fall back to:

- chat app patterns
- CRUD mental models
