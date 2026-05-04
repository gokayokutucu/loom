# LoomAI Agent Rules Overlay

This file maps curated skills to LoomAI workflows.
Root `AGENTS.md` is authoritative if there is any conflict.

---

## 1. Bug Fix Flow

1. `debugging-and-error-recovery`: reproduce and isolate root cause.
2. `test-driven-development`: add failing regression test first.
3. `incremental-implementation`: smallest safe fix.
4. `code-review-and-quality`: correctness/security/perf review.
5. Validate Loom runtime + UI behavior before handoff.

Focus:
- Resolver correctness (object → window → revision)
- Reference integrity (no cloning, only ReferenceMention)
- Weft rendering correctness (lineage integrity)

---

## 2. Feature Flow

1. `planning-and-task-breakdown`: task slicing and dependency order.
2. Choose appropriate domain:
   - UI → `frontend-ui-engineering`
   - Resolver/Graph → internal services
   - Model routing → provider layer
3. `incremental-implementation`: deliver vertical slices.
4. `test-driven-development`: behavior and edge-case coverage.
5. `documentation-and-adrs`: for Loom model / resolver / provider changes.

---

## 3. Loom + UI Coordinated Flow

1. Define behavior in terms of Loom model:
   - Loom (container)
   - Weft (lineage)
   - Response (node)
   - Reference (usage)
   - Bookmark (promotion)

2. Keep business logic out of components:
   - Resolver → services
   - Graph → repository layer
   - Projection (Weft) → hooks

3. UI must only consume resolved/projection data.

4. Add tests where applicable:
   - resolver scenarios
   - reference linking
   - model routing

---

## 4. Validation Discipline

- Treat failing checks as blockers.
- Do not normalize regressions as "pre-existing" without proof.
- Report pass/fail explicitly:
  - npm run build
  - runtime interaction checks
- Separate UI issues from resolver/runtime issues.

---

## 5. Model & Runtime Rules

- Always route by intent:
  - Quick interactions → quickModel
  - Main chat → mainModel

- Never assume model availability.

- Must check runtime health:
  - Ollama reachable
  - model installed

- Do NOT auto-install system dependencies.
- Provide guidance instead.

---

## 6. Graph & Resolver Rules

- Object identity first (Loom / Response / Bookmark)
- Window applied second (Weft / Reference / Context)
- Revision/snapshot applied third

Never:
- treat Weft as identity
- clone Responses
- lose Reference linkage

---

## 7. Performance & UX Gates

- Weft rendering must scale with depth
- No unnecessary re-renders in conversation view
- Use virtualization for large Looms if needed
- Keep interactions fast (<200ms perceived latency)

---

## 8. Documentation Expectations

Use `documentation-and-adrs` when changing:
- Loom model
- Resolver behavior
- Provider architecture
- Terminology (Loom / Weft / Reference / Bookmark)

---

## 9. Drift Prevention

If you see:
- Conversation
- Thread
- Publish
- Input Dock

You MUST stop and correct them.

These terms are invalid in LoomAI.
