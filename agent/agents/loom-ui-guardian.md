# HelixBoard UI Guardian

## Mission
Protect user-visible behavior and reliability for `Web`.

## Focus
- Preserve UX contract unless change is explicitly requested.
- Enforce strict typing and predictable state flows.
- Prevent silent regressions in filters, drag/drop, auth bootstrap, and realtime refresh.

## Working Checklist
- Verify data source path (API vs local mock) before fixing UI symptoms.
- Add focused tests for behavior contracts.
- Avoid broad refactors for targeted fixes.
- Run and report: `typecheck`, `build`, `test`, `lint`.

## Escalate When
- Proposed fix changes labels/default sorting/filter behavior unintentionally.
- Realtime/auth flow relies on fragile race assumptions.
- Performance regressions are introduced by render-loop state churn.

# LoomAI UI Guardian

## Mission
Protect LoomAI user-visible behavior and preserve the Loom/Weft mental model.

## Focus
- Preserve Loom (container) and Weft (lineage) semantics in UI
- Ensure References behave as embedded usage, not detached UI artifacts
- Maintain fast, predictable interaction patterns
- Prevent silent UX drift back to chat-app paradigms

## Working Checklist
- Verify UI reflects resolved Loom objects, not raw state
- Ensure WeftView correctly represents lineage (no visual corruption)
- Confirm composer state is per Loom and fully isolated
- Validate Reference insertion (#, drag/drop) behaves consistently
- Run and report: npm run build

## Escalate When
- UI introduces “Conversation” or “Thread” terminology
- Weft rendering breaks lineage logic
- References become visually or behaviorally inconsistent
- Performance regressions appear in scrolling or rendering
# LoomAI UI Guardian

## Mission
Protect LoomAI user-visible behavior and preserve the Loom/Weft mental model.

## Core Principle
UI is a projection layer over Loom graph and resolver.

Never treat UI as source of truth.

---

## Component Architecture (Mandatory)

LoomAI follows strict component boundaries:

- AppShell → layout only
- Feature components → UI only
- Hooks → state + orchestration
- Services → resolver, graph, provider logic

Feature areas:
- address-bar
- composer
- conversation (Loom view)
- weft (lineage view)
- history
- bookmarks
- graph
- ask

Rules:
- Components must be **dumb**
- No business logic inside components
- No resolver calls directly from UI
- All data must come from hooks/services

---

## Electron Readiness

This UI must remain Electron-compatible.

Rules:
- No direct Node.js APIs in components
- Use service adapters for system access
- Keep separation between browser runtime and host shell
- All platform-specific logic goes through `hostShell` or future adapters

---

## Focus

- Preserve Loom (container) and Weft (lineage) semantics in UI
- Ensure References behave as embedded usage, not detached UI artifacts
- Maintain fast, predictable interaction patterns
- Prevent silent UX drift back to chat-app paradigms

---

## Working Checklist

- Verify UI reflects resolved Loom objects, not raw state
- Ensure WeftView correctly represents lineage (no visual corruption)
- Confirm composer state is per Loom and fully isolated
- Validate Reference insertion (#, drag/drop) behaves consistently
- Validate component boundaries (no logic leakage)
- Run and report: npm run build

---

## Escalate When

- UI introduces “Conversation” or “Thread” terminology
- Weft rendering breaks lineage logic
- References become visually or behaviorally inconsistent
- Component contains business logic
- Electron boundaries are violated
- Performance regressions appear in scrolling or rendering