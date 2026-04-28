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

---

## 9) Output Format

Responses should be:
- concise
- structured
- aligned with Loom concepts

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
