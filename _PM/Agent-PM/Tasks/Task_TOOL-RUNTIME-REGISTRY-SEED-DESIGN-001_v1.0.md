# Task: TOOL-RUNTIME-REGISTRY-SEED-DESIGN-001 v1.0
## Design Initial Loom-native Tool Registry Seed

---

## Metadata

| Field | Value |
|---|---|
| Task ID | TOOL-RUNTIME-REGISTRY-SEED-DESIGN-001 |
| Phase | 5 — Agent Runtime Foundation |
| Status | COMPLETE |
| Commit | `docs: design initial Loom-native tool registry seed` |
| Branch | feature/agent-runtime |
| Mode | ARCHITECTURE AND DESIGN ONLY |
| Scope | Design documents only. No production source modified. |
| Design Document | `_PM/Agent-PM/Plans/Phase5_ToolRuntimeRegistrySeedDesign_v1.0.md` |
| Blocked By | None |
| Blocks | TOOL-RUNTIME-REGISTRY-SEED-001 (implementation) |

---

## Hard Constraints (verbatim from task brief)

- Do not modify production source files
- Do not seed ToolRegistry
- Do not add RegisteredTool instances to startup
- Do not add real handlers, executable abstractions, closures, callbacks, or trait objects for execution
- Do not execute shell commands, access filesystem, perform network requests, add browser automation
- Do not add code execution, MCP, retrieval
- Do not add LanceDB, Tantivy, sqlite-vec, SQLite migrations
- Do not add permission UI
- Do not modify Main generation or Quick Ask
- Do not push, merge, tag, or release

---

## Pre-Design Question Answers

### Q1: What does "implement a tool" mean in the current architecture?

In the current architecture, "implementing a tool" means registering a `RegisteredTool` descriptor
in the `ToolRegistry`. It does **not** mean adding an execution handler. The `ToolRuntimeBoundary`
always returns `Skipped` with `TOOL_EXECUTION_NOT_IMPLEMENTED` for any resolved tool. There is no
callable handler, no trait object, no closure, no function pointer stored in `RegisteredTool`.

A descriptor is purely metadata: name, display_name, description, category, availability,
permission_requirement, optional argument_schema, optional output_schema, and enabled flag.

### Q2: What is the difference between ToolAvailability::Available and NotAvailable?

- `Available`: The tool is conceptually ready AND an execution path exists. The `ToolRuntimeBoundary`
  resolves it to `Resolved(tool)`, then returns `Skipped` (because no execution exists anywhere in
  the codebase). No tool should currently be `Available`.
- `NotAvailable`: The capability is conceptually defined but no execution path exists. The boundary
  resolves it as `NotAvailable` and returns `Skipped`. This is the correct state for all metadata-only
  descriptors.

**The initial seed must use `NotAvailable` for all descriptors.** Using `Available` would be a false
architectural claim — no tool can execute. `Available` is reserved for when a real implementation
is wired and reviewed.

### Q3: Does ToolRegistry seeding happen at AppState construction or at router construction?

**At router construction in `router_with_experimental()`.**

- `ToolRegistry::new()` is called in `api/mod.rs`.
- The `Arc<RwLock<ToolRegistry>>` is wrapped and passed into `AppState`.
- `AppState::agent_runtime()` creates a per-call `AgentRuntimeService` from the shared Arc.
- There is no lazy initialization or re-seeding. Seeding must happen once, after `ToolRegistry::new()`
  and before `AppState` construction.

Recommended seeding call site:
```rust
let tool_registry = Arc::new(RwLock::new(ToolRegistry::new()));
seed_builtin_tools(&mut tool_registry.write().expect("tool registry seed lock"));
let state = AppState { ..., tool_registry };
```

### Q4: Are any Loom domain repositories accessible from the agent runtime today?

No. The current `AgentRuntimeService` is constructed from:
- `OllamaRuntime` (provider pipeline)
- `AgentRunStore` (in-memory run state)
- `Arc<RwLock<ToolRegistry>>` (metadata registry)

There is no database pool, no LoomRepository, no ResponseRepository in the agent runtime call path.
When tools are eventually made `Available`, the execution implementation will need database access.
The seeding design does not pre-commit to how that wiring will work.

This means that tools like `loom.loom.inspect` and `loom.response.read`, which would eventually
call `LoomRepository.get_loom` and `ResponseRepository.get_response`, cannot be executed today
even if their availability were changed to `Available`. The `NotAvailable` state is both
architecturally accurate and pragmatically necessary.

### Q5: What is the correct module placement for seeding logic?

New module: `services/loom-service/src/agent_runtime/catalog.rs`

This separates:
- `tool_registry.rs` — registry contract, data structures, resolution logic
- `tools.rs` — tool call pipeline, boundary, sanitization
- `catalog.rs` — seeding, descriptor definitions, naming catalog

Export from `agent_runtime/mod.rs`:
```rust
pub mod catalog;
```

`catalog.rs` must have no executable dependencies (no process, fs, net, reqwest, tokio::process).
A static guard test must enforce this.

### Q6: What domain entities exist in Loom's repositories?

Confirmed from source inspection:

| Entity | Repository Method | Exists |
|---|---|---|
| Loom (thread) | `get_loom`, `list_looms` | Yes |
| Weft (cross-link) | `find_weft_by_origin` | Yes |
| Response (message) | `get_response`, `list_responses_for_loom` | Yes |
| Reference (linked doc) | `get_reference`, `list_references_for_loom` | Yes |
| Attachment (file) | `get_attachment`, `list_attachments_for_loom`, `get_attachment_blob` | Yes |
| Memory (note/insight) | `get_memory`, `list_memories`, `insert_memory`, `soft_delete_memory` | Yes |
| Bookmark | `list_bookmarks`, `get_bookmark`, `find_by_target` | Yes |
| Graph (projection) | `build_graph_projection` | Yes |
| Context artifact | `get_response_capsule`, `get_latest_checkpoint_for_loom` | Yes |
| Address | `resolve_address` | Yes |
| Search (keyword) | `search` (SearchIndexRepository) | Yes |

### Q7: What distinguishes a tool name from a tool capability?

**Tool name:** A stable, machine-readable identifier. Used as the HashMap key. Never changes once
registered in production. Format: `loom.{domain}.{verb}`. Example: `loom.response.read`.

**Capability:** The architectural category and operational semantics of the tool. A capability may
be backed by one or more tool names, or a tool name may represent a subset of a broader capability.
Example: the "content reading" capability spans `loom.response.read` and eventually
`loom.attachment.read`, but these are two separate ToolNames.

The naming convention maps names to capabilities: `loom.{domain}` identifies the entity; `.{verb}`
identifies the operation. This composition is the capability claim.

### Q8: What prevents a seeded tool from being executed?

Three enforcement layers:

1. **ToolAvailability::NotAvailable** — The `ToolRegistry::resolve()` method returns
   `ToolRegistryResolution::NotAvailable` for any tool with this availability. The
   `ToolRuntimeBoundary` sees `NotAvailable` and returns `ToolInvocationResult::Skipped`.

2. **`#[cfg(test)]` on `with_policy()`** — The only way to construct a disconnected
   `ToolRuntimeBoundary` is via `with_policy()`, which is test-only since HARDENING-001.
   Production code cannot construct a boundary without the shared registry.

3. **No execution path** — The production `execute_run()` in `AgentRuntime` only calls
   `boundary.invoke()`, and `invoke()` never dispatches to any handler, database, or subprocess
   under any code path in the current codebase. There is no match arm for `Skipped` that runs
   anything.

---

## Decision Log

### D1: Option B (Minimal 3-descriptor seed) selected over Option A (empty) and Option C (full catalog)

**Rationale:** Option A wastes the already-gated introspection endpoint — the inspector shows
nothing even though the gating, routing, and serialization are all working. Option C commits
names too broadly before the domain taxonomy is fully stable (artifact ambiguity, context
manager dependency, retrieval dependency). Option B seeds three stable, read-only descriptors
that prove the mechanism, establish the convention, and leave no open questions about naming.

**Decisive constraint:** "semantic stability over visual richness" — the three chosen descriptors
(`loom.runtime.status`, `loom.loom.inspect`, `loom.response.read`) are the least likely of all
candidates to need renaming or restructuring.

### D2: Doubled `loom.loom.inspect` accepted without alias

**Context:** The first `loom.` is the product namespace; the second `loom` is the Loom entity
type. This produces the form `loom.loom.inspect`.

**Alternatives considered:** `loom.thread.inspect` (non-vocabulary), `loom.conversation.inspect`
(non-vocabulary), `loom.session.inspect` (non-vocabulary).

**Decision:** The doubled form is intentional and correct. The convention maps domain segments to
Loom vocabulary nouns. "Loom" is the vocabulary noun for a conversation thread. Introducing an
alias would pollute the namespace and imply that "thread" or "conversation" are accepted domain
segment names, which they are not.

**Documentation:** The naming convention in Phase5_ToolRuntimeRegistrySeedDesign_v1.0.md
explicitly explains the doubled form.

### D3: `loom.artifact.*` deferred due to naming instability

**Context:** "Artifact" is overloaded in the current codebase:
- Context artifacts (`context_artifacts` repository, `ResponseContextCapsule`)
- Agent step artifacts (`AgentStepKind::ArtifactPlaceholder`)
- Attachment-as-artifact (uploaded files sometimes called artifacts)

**Decision:** No `loom.artifact.*` names are registered until the artifact taxonomy is resolved.
Premature registration risks a naming conflict or a confusing capability description. The context
artifact use case is covered by `loom.context.inspect` when it becomes ready.

### D4: Write and delete tools excluded until TOOL-PERMISSION-UI-001

**Context:** `loom.memory.write` and any future delete tools require `RequiresUserApproval`.
The approval UI does not exist. A tool with `RequiresUserApproval` cannot be approved — it would
be permanently skipped. Seeding it now creates a misleading inspector entry.

**Decision:** All mutation tools are excluded from the initial seed and from the catalog until
TOOL-PERMISSION-UI-001 lands.

### D5: `loom.context.inspect` is catalog-ready but not in minimal seed

**Context:** `ContextArtifactsRepository` exists, but the agent runtime does not have database
access. The tool cannot be wired even when ready.

**Decision:** Include in the full catalog (documented in the design) but not in the Option B
minimal seed. The SEED-001 implementer may register it alongside the 3 minimal descriptors —
it is architecturally safe to do so since `NotAvailable` prevents execution.

### D6: MCP namespace `mcp.{server_id}.{tool_name}` reserved

**Decision:** Explicitly documented in the naming convention. Loom-native `loom.*` names and
MCP-bridged `mcp.*` names are separated by prefix. No collision is possible. No registry changes
are required to support MCP tools — they simply use a different name prefix when registered.

---

## Outputs

### Files Created

- `_PM/Agent-PM/Plans/Phase5_ToolRuntimeRegistrySeedDesign_v1.0.md` — Full design document
- `_PM/Agent-PM/Tasks/Task_TOOL-RUNTIME-REGISTRY-SEED-DESIGN-001_v1.0.md` — This task record

### Files Modified

None. No production source was touched.

---

## Implementation Handoff for TOOL-RUNTIME-REGISTRY-SEED-001

### What to create

```
services/loom-service/src/agent_runtime/catalog.rs
```

Export in `agent_runtime/mod.rs`:
```rust
pub mod catalog;
```

### What the catalog module must contain

```rust
pub fn seed_builtin_tools(registry: &mut ToolRegistry) {
    // register loom.runtime.status
    // register loom.loom.inspect
    // register loom.response.read
    // (optionally: register the full deferred catalog, all NotAvailable)
}
```

No closures. No trait objects. No handlers. No imports of process/fs/net/reqwest.

### Where to call it

`services/loom-service/src/api/mod.rs` — `router_with_experimental()`:

```rust
let tool_registry = Arc::new(RwLock::new(ToolRegistry::new()));
crate::agent_runtime::catalog::seed_builtin_tools(
    &mut tool_registry.write().expect("tool registry seed lock")
);
let state = AppState { ..., tool_registry };
```

### Required tests

See Section 15 of Phase5_ToolRuntimeRegistrySeedDesign_v1.0.md.

Minimum:
- `seed_builtin_tools_produces_nonempty_registry`
- `seed_builtin_tools_produces_no_available_tools`
- `seed_builtin_tools_names_match_naming_convention`
- `seed_builtin_tools_no_tool_is_immediately_executable`
- `catalog_module_performs_no_real_execution` (static source guard)
- `tools_route_returns_seeded_tools_after_startup` (integration)

### Commit message for SEED-001

```
feat: seed built-in Loom-native tool descriptors in agent runtime catalog
```

---

## Verification Checklist (for SEED-001 review)

- [ ] `catalog.rs` exists in `agent_runtime/`
- [ ] `catalog.rs` exports `seed_builtin_tools` with correct signature
- [ ] `agent_runtime/mod.rs` exports `pub mod catalog`
- [ ] `router_with_experimental()` calls `seed_builtin_tools` before AppState construction
- [ ] All seeded tools have `availability: NotAvailable`
- [ ] No seeded tool has `availability: Available`
- [ ] All seeded tools have `enabled: true`
- [ ] All seeded ToolNames match `loom.{domain}.{verb}` pattern
- [ ] `catalog.rs` contains no process/fs/net/reqwest imports
- [ ] Static execution guard test passes
- [ ] `seed_builtin_tools_no_tool_is_immediately_executable` test passes
- [ ] `/experimental/agent/tools` route returns seeded tools in integration test
- [ ] No production source other than `catalog.rs` and `mod.rs` modified
- [ ] No `ToolAvailability::Available` added anywhere
- [ ] `cargo test` passes
- [ ] `cargo clippy` clean

---

## Audit Trail

| Date | Event |
|---|---|
| 2026-06-14 | AGENT-RUNTIME-TOOL-STACK-INDEPENDENT-AUDIT-001 completed. No CRITICAL or HIGH findings. Gate opened for design task. |
| 2026-06-14 | AGENT-RUNTIME-TOOL-STACK-HARDENING-001 (b543d9d) confirmed in LOCKED ledger. All MEDIUM findings resolved. |
| 2026-06-14 | TOOL-RUNTIME-REGISTRY-SEED-DESIGN-001 initiated. Branch: feature/agent-runtime at b543d9d. |
| 2026-06-14 | All domain repositories surveyed. 8 pre-design questions answered. |
| 2026-06-14 | Naming convention finalized: `loom.{domain}.{verb}`. |
| 2026-06-14 | All 18 candidate capabilities reviewed. Decisions: 3 in minimal seed, 10 in catalog, 3 deferred, 1 rejected, 2 renamed/split. |
| 2026-06-14 | Option B (3 descriptors) selected. |
| 2026-06-14 | MCP compatibility, versioning, permission, and deprecation models finalized. |
| 2026-06-14 | Phase5_ToolRuntimeRegistrySeedDesign_v1.0.md written. |
| 2026-06-14 | Task_TOOL-RUNTIME-REGISTRY-SEED-DESIGN-001_v1.0.md written. |
| 2026-06-14 | Local commit: `docs: design initial Loom-native tool registry seed`. |
