# Phase 5 — Tool Runtime Registry Seed Design v1.0
# TOOL-RUNTIME-REGISTRY-SEED-DESIGN-001

## 1. Executive Recommendation

**Outcome: Option B — Seed a minimal, read-only set of 3 descriptors.**

All three are `NotAvailable` (no execution path exists), `AlwaysAllowed` (read-only inspection), and
carry stable Loom-native names that will not need renaming when execution eventually lands.

The registry remaining empty is semantically correct but technically wasteful: the introspection
endpoint exists and is gated. Seeding three stable descriptors proves the seeding mechanism and
establishes naming convention without implying any executable capability or freezing any unfinished
architecture.

Mutations, approval-required tools, and tools that depend on RETRIEVAL-ARCH-001,
AGENT-CONTEXT-MANAGER-001, or MCP-BOUNDARY-001 are explicitly deferred.

---

## 2. Current Registry Contract Assessment

`RegisteredTool` requires:

| Field | Type | Notes |
|---|---|---|
| `name` | `ToolName(String)` | Canonical identifier. Newtype wrapper. Key for HashMap. |
| `display_name` | `String` | Human-readable label for UI and inspector. |
| `description` | `String` | Capability description. Plain text only. |
| `category` | `String` | Grouping string. Free-form. |
| `availability` | `ToolAvailability` | See taxonomy below. |
| `permission_requirement` | `ToolPermissionRequirement` | See taxonomy below. |
| `argument_schema` | `Option<Value>` | JSON Schema concept. Metadata only. |
| `output_schema` | `Option<Value>` | JSON Schema concept. Metadata only. |
| `enabled` | `bool` | Administrative on/off. Master switch. |

**Availability values:** `Available`, `Disabled`, `NotConfigured`, `NotAvailable`, `Experimental`,
`Unknown`

**Permission values:** `AlwaysAllowed`, `RequiresUserApproval`, `Disabled`, `DenyByDefault`

**Resolution logic:** `!enabled || Disabled` → `Disabled`. Then `NotConfigured` → `NotConfigured`.
Then `NotAvailable` → `NotAvailable`. Otherwise → `Resolved(tool)`.

**Boundary behavior:** Any `Resolved` tool, regardless of its `PermissionRequirement`, is
executed as `Skipped` with `TOOL_EXECUTION_NOT_IMPLEMENTED`. A `Denied` tool is `Denied`.
**No tool executes in any current code path.**

---

## 3. Canonical ToolName Naming Convention

### 3.1 Format

```
loom.{domain}.{verb}
```

- **Prefix:** Always `loom.` for Loom-native tools. This is the reserved namespace.
- **Domain:** The Loom entity type, singular, lowercase. From Loom vocabulary only.
- **Verb:** The operation, lowercase. From the approved verb list.
- **Separator:** Period `.`
- **Depth:** Exactly 3 segments. No 4-segment names in the initial taxonomy.
- **Characters:** `[a-z][a-z0-9_]*` per segment.
- **Case:** All lowercase. No camelCase, no SCREAMING.

### 3.2 Approved Domain Segments

| Segment | Loom Entity |
|---|---|
| `loom` | The Loom conversation thread entity |
| `weft` | A cross-link between Looms |
| `response` | A message/turn within a Loom |
| `reference` | A linked document or URI |
| `attachment` | An uploaded file |
| `memory` | A persistent user note/insight |
| `bookmark` | A user bookmark |
| `graph` | The relationship graph of Looms |
| `context` | The context capsule / artifact |
| `runtime` | The Loom service runtime |
| `search` | Cross-entity retrieval |

The domain `loom` names the Loom thread entity. The prefix `loom.` names the Loom system
namespace. The doubled form `loom.loom.inspect` is intentional and unambiguous: Loom-system tool
operating on the Loom-thread entity. Do not introduce aliases or shorthand to avoid this.

### 3.3 Approved Verb Segments

| Verb | Meaning |
|---|---|
| `inspect` | Read a single entity's structured metadata (not raw content) |
| `list` | List multiple entities by a filter |
| `read` | Read the content of a single entity (may be large) |
| `resolve` | Resolve an address, URI, or alias to a record |
| `build` | Trigger a context build or compute job |
| `write` | Create or update an entity |
| `delete` | Soft-delete an entity |
| `search` | Keyword or semantic search across entities |

### 3.4 Naming Rules

1. Names represent **intent**, not implementation. `loom.response.read` describes what the agent
   intends to do, not which repository method handles it.
2. No version numbers in names (`loom.response.read`, not `loom.response.read_v1`).
3. No tense in verbs (`read` not `reading` or `reads`).
4. No plural domain segments (`loom.response.read` not `loom.responses.read`).
5. No noun-first ordering (`loom.read.response` is forbidden).
6. Once a name is registered in a production build, it is stable. Renaming requires a deprecation
   cycle (see Section 12).

### 3.5 Future MCP Namespace

MCP tools registered by MCP-BOUNDARY-001 use the reserved prefix `mcp.`:

```
mcp.{server_id}.{tool_name}
```

This prevents any collision with `loom.*` names. External MCP tools may never override
Loom-native tools because their names occupy a different prefix. The registry is a flat HashMap —
no hierarchy enforcement is required; the naming convention provides the separation.

---

## 4. Capability Categories

| Category string | Scope |
|---|---|
| `runtime.diagnostics` | Agent runtime health and status |
| `loom.core` | Core Loom/Weft entity inspection |
| `loom.content` | Response and content reading |
| `loom.references` | Reference and address resolution |
| `loom.attachments` | Attachment metadata and content |
| `loom.memory` | Memory notes and insights |
| `loom.graph` | Graph and ancestry inspection |
| `loom.context` | Context capsule inspection |
| `loom.search` | Keyword and semantic retrieval |
| `loom.mutations` | Data-mutating operations (write, delete) |

The `category` field is a free-form String; no enum enforces this. These values should be used
consistently across all seed descriptors. Future tooling may group or filter on them.

---

## 5. Permission Assignment Rules

| Operation class | Permission | Rationale |
|---|---|---|
| Read-only inspect / list / resolve | `AlwaysAllowed` | No data mutation; no external side effect; may proceed without user action. |
| Content read (potentially large/sensitive) | `AlwaysAllowed` initially; re-evaluate when execution lands if content is privacy-sensitive. | Reading response text in the agent's own Loom is expected agent behaviour. |
| Search (keyword/semantic) | `AlwaysAllowed` | Read-only retrieval. |
| Context build (async job trigger) | `RequiresUserApproval` | Triggers a compute job; potentially expensive; touches stored capsules. |
| Write / Create | `RequiresUserApproval` | Data mutation affecting persistent user state. |
| Delete | `DenyByDefault` until TOOL-PERMISSION-UI-001 is available; then `RequiresUserApproval`. | Irreversible (soft-delete, but still user-facing). |
| External side effects | `DenyByDefault` | No outbound calls, browser automation, or shell access. |
| MCP tools (future) | `RequiresUserApproval` by default; configurable per-tool when MCP-BOUNDARY-001 lands. | External trust boundary. |

**Critical rule:** Never register a descriptor with `AlwaysAllowed` for a mutating operation.
`AlwaysAllowed` means the agent may act without asking. Reserve it strictly for read-only
inspection of data the agent already has access to within its run context.

---

## 6. Availability Assignment Rules

| State | When to use |
|---|---|
| `Available` | A real, reviewed execution implementation exists AND it is safe to call. Not used in the initial seed. |
| `Experimental` | Execution is draft or unreviewed. Use for first-pass implementations that may change. |
| `NotAvailable` | The capability is conceptually meaningful but no execution path exists yet. Use for all initial seed descriptors. |
| `NotConfigured` | The capability requires user configuration (an API key, endpoint, etc.) that has not been provided. |
| `Disabled` | Administratively turned off by policy or operator. |
| `Unknown` | Resolution failure only; never seed with this value. |

**Rule:** Never mark a tool `Available` solely because its metadata can be registered. `Available`
means execution will run. Until `ToolRuntimeBoundary.invoke()` routes the tool to a real
implementation, `NotAvailable` is the correct state regardless of how complete the metadata is.

The `enabled: true` flag should be set to `true` on all seeded descriptors. `enabled: false` is
the administrative kill switch; `availability: NotAvailable` is the architectural readiness signal.
These are orthogonal.

---

## 7. Candidate Capability Decision Table

| Candidate | Decision | Availability | Permission | Category | Future Owner | Notes |
|---|---|---|---|---|---|---|
| `loom.runtime.status` | **Keep** | `NotAvailable` | `AlwaysAllowed` | `runtime.diagnostics` | Agent Runtime | Backed by `/runtime/status`. Clean, stable name. No dependency on unfinished work. |
| `loom.loom.inspect` | **Keep** | `NotAvailable` | `AlwaysAllowed` | `loom.core` | Core Loom service | LoomRepository.get_loom exists. Stable name. Doubled "loom" is intentional and documented. |
| `loom.response.read` | **Keep** | `NotAvailable` | `AlwaysAllowed` | `loom.content` | Core Loom service | ResponseRepository.get_response exists. "read" signals content; distinguishable from "inspect" (metadata-only). |
| `loom.weft.inspect` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.core` | Core Loom service | LoomRepository has weft methods. Stable Loom vocabulary. Deferred from minimal seed. |
| `loom.response.list` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.content` | Core Loom service | ResponseRepository.list_responses_for_loom. Defer from minimal seed; list semantics need arg schema design. |
| `loom.reference.resolve` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.references` | Core Loom service | AddressRepository + ReferenceRepository. "resolve" is the precise verb for address→record. |
| `loom.reference.list` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.references` | Core Loom service | ReferenceRepository.list_references_for_loom. |
| `loom.attachment.list` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.attachments` | Core Loom service | AttachmentsRepository.list_attachments_for_loom. |
| `loom.attachment.read` | **Rename to `loom.attachment.inspect` for metadata** | `NotAvailable` | `AlwaysAllowed` | `loom.attachments` | Core Loom service | Metadata (name, size, type) only. Content reading is a separate capability with different privacy implications. |
| `loom.graph.inspect` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.graph` | Core Loom service | build_graph_projection exists. Stable name. |
| `loom.context.inspect` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.context` | AGENT-CONTEXT-MANAGER-001 | ContextArtifactsRepository exists but agent runtime has no DB access yet. Must wait for AGENT-CONTEXT-MANAGER-001 wiring. |
| `loom.context.build` | **Defer** | — | — | — | AGENT-CONTEXT-MANAGER-001 | Triggers async job. No job dispatch in agent runtime yet. Defer to AGENT-CONTEXT-MANAGER-001. |
| `loom.artifact.list` | **Defer** | — | — | — | TBD | "Artifact" is overloaded: context artifacts, agent step outputs, attachment artifacts. Name is premature. Defer until artifact taxonomy is settled. |
| `loom.artifact.read` | **Defer** | — | — | — | TBD | Same reason. |
| `loom.memory.search` | **Defer** | — | — | — | RETRIEVAL-ARCH-001 | No semantic memory search exists. `MemoryRepository.list_memories` is list, not search. |
| `loom.memory.write` | **Reject (initial seed)** | — | `RequiresUserApproval` | — | TOOL-PERMISSION-UI-001 | Mutation. No approval UI. Wrong signal to seed before TOOL-PERMISSION-UI-001. |
| `loom.search.semantic` | **Defer** | — | — | — | RETRIEVAL-ARCH-001 | No semantic search implementation. |
| `loom.search.keyword` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.search` | Core Loom service / RETRIEVAL-ARCH-001 | SearchIndexRepository.search exists but agent runtime has no DB access. |
| `loom.bookmark.list` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.core` | Core Loom service | BookmarkRepository.list_bookmarks. Read-only. |
| `loom.memory.list` | **Keep (catalog)** | `NotAvailable` | `AlwaysAllowed` | `loom.memory` | Core Loom service | MemoryRepository.list_memories. Distinct from search. |

---

## 8. Recommended Initial Seed Set (SEED-001)

**Outcome: Option B — 3 descriptors.**

These three are chosen for maximum naming stability, zero dependency on unfinished work, and the
clearest read-only semantics:

### 8.1 `loom.runtime.status`

```
name:                 loom.runtime.status
display_name:         "Loom Runtime Status"
description:          "Inspect the operational status of the Loom service, including runtime
                       health, database readiness, and provider configuration. Read-only."
category:             runtime.diagnostics
availability:         NotAvailable
permission_requirement: AlwaysAllowed
enabled:              true
argument_schema:      None (no arguments; status is global)
output_schema:        None (defined at implementation time)
```

**Rationale:** The runtime status API already exists. This tool would eventually forward to
`GET /runtime/status`. The name is stable — "runtime status" is not a Loom entity, it's a
diagnostic, and `runtime.diagnostics` signals that clearly. No other candidate has this category.

**Future owner:** Agent Runtime (internal service boundary, not a repository call).

### 8.2 `loom.loom.inspect`

```
name:                 loom.loom.inspect
display_name:         "Inspect Loom Thread"
description:          "Read the metadata of a specific Loom conversation thread by ID. Returns
                       title, status, kind, and timestamps. Does not return response content.
                       Read-only."
category:             loom.core
availability:         NotAvailable
permission_requirement: AlwaysAllowed
enabled:              true
argument_schema:      { "type": "object",
                        "properties": { "loom_id": { "type": "string" } },
                        "required": ["loom_id"] }
output_schema:        None (defined at implementation time)
```

**Rationale:** `LoomRepository.get_loom` is the most fundamental read operation in the system.
Every agent action that touches Loom data implicitly depends on knowing the Loom exists. This is
the first capability most agent behaviors will need. The "inspect" verb signals metadata-only
(not response content). The doubled `loom.loom.*` form is documented.

**Future owner:** Core Loom service (LoomRepository).

### 8.3 `loom.response.read`

```
name:                 loom.response.read
display_name:         "Read Response"
description:          "Read the content and metadata of a specific Response (a message or turn
                       in a Loom conversation) by ID. Returns role, content text, sequence
                       position, and timestamps. Read-only."
category:             loom.content
availability:         NotAvailable
permission_requirement: AlwaysAllowed
enabled:              true
argument_schema:      { "type": "object",
                        "properties": { "response_id": { "type": "string" } },
                        "required": ["response_id"] }
output_schema:        None (defined at implementation time)
```

**Rationale:** `ResponseRepository.get_response` is the core content read. The verb "read"
(not "inspect") signals that this returns content, not just metadata. The agent needs to read
responses to understand conversation history. `AlwaysAllowed` is appropriate because reading
responses already in the agent's run context is expected behaviour.

**Future owner:** Core Loom service (ResponseRepository).

---

## 9. Explicitly Rejected / Deferred Capabilities

### Rejected for initial seed

| Name | Reason |
|---|---|
| `loom.memory.write` | Mutation. Requires TOOL-PERMISSION-UI-001 before any write tool is seeded. Premature. |
| `loom.artifact.list` | "Artifact" is overloaded. Name is not stable until agent artifact taxonomy is defined. |
| `loom.artifact.read` | Same. |
| `loom.context.build` | Triggers async job. AGENT-CONTEXT-MANAGER-001 is deferred. |
| `loom.search.semantic` | RETRIEVAL-ARCH-001 not implemented. |
| `loom.memory.search` | Same. |

### Deferred to SEED-001 implementation catalog (not minimal seed, but ready for catalog)

`loom.weft.inspect`, `loom.response.list`, `loom.reference.resolve`, `loom.reference.list`,
`loom.attachment.list`, `loom.attachment.inspect`, `loom.graph.inspect`, `loom.bookmark.list`,
`loom.memory.list`, `loom.search.keyword`

These are fully designed here and may be registered in TOOL-RUNTIME-REGISTRY-SEED-001 implementation
as part of a broader catalog. They are not the minimal seed. The task author decides whether to
register all ten at once or add only the three minimum.

---

## 10. Future Owner Map

| Capability | Future Owner | Blocking Task |
|---|---|---|
| `loom.runtime.status` | Agent Runtime | None — immediate |
| `loom.loom.inspect` | Core Loom service | None — immediate |
| `loom.response.read` | Core Loom service | None — immediate |
| `loom.weft.inspect` | Core Loom service | None |
| `loom.response.list` | Core Loom service | None |
| `loom.reference.resolve` | Core Loom service | None |
| `loom.reference.list` | Core Loom service | None |
| `loom.attachment.list` | Core Loom service | None |
| `loom.attachment.inspect` | Core Loom service | None |
| `loom.graph.inspect` | Core Loom service | None |
| `loom.context.inspect` | AGENT-CONTEXT-MANAGER-001 | AGENT-CONTEXT-MANAGER-001 |
| `loom.context.build` | AGENT-CONTEXT-MANAGER-001 | AGENT-CONTEXT-MANAGER-001 |
| `loom.bookmark.list` | Core Loom service | None |
| `loom.memory.list` | Core Loom service | None |
| `loom.search.keyword` | Core Loom / RETRIEVAL-ARCH-001 | DB access from agent runtime |
| `loom.memory.search` | RETRIEVAL-ARCH-001 | RETRIEVAL-ARCH-001 |
| `loom.search.semantic` | RETRIEVAL-ARCH-001 | RETRIEVAL-ARCH-001 |
| `loom.memory.write` | Core Loom service | TOOL-PERMISSION-UI-001 |
| Any MCP tool | MCP-BOUNDARY-001 | MCP-BOUNDARY-001 |

---

## 11. MCP Compatibility Model

### 11.1 Namespace separation

Loom-native tools use the `loom.*` prefix. MCP tools use the `mcp.*` prefix:

```
loom.response.read          ← Loom-native
mcp.filesystem.read_file    ← MCP-bridged
```

The ToolRegistry is a flat HashMap keyed on ToolName. No hierarchy enforcement is needed —
the prefix convention provides namespace separation. The registry implementation does not need
to change to support MCP tools.

### 11.2 Canonical identity

`ToolName` is always the primary key. A Loom-native tool and an MCP tool with overlapping
intent (e.g., `loom.response.read` and `mcp.loom_content.get_response`) coexist as separate
entries. The agent runtime decides which to invoke; the registry simply resolves either name.

MCP tools may NOT override Loom-native tool names. `mcp.*` tools cannot register a ToolName
under the `loom.*` prefix. This should be enforced by MCP-BOUNDARY-001 when it lands.

### 11.3 Trust and permission

Loom-native read tools may carry `AlwaysAllowed` because they operate within the trusted service
boundary and on user data the agent already has access to.

MCP-registered tools should default to `RequiresUserApproval`. The MCP adapter (MCP-BOUNDARY-001)
is responsible for assigning permission per-tool based on MCP server trust level and tool category.
The permission model is already rich enough to accommodate this.

### 11.4 No aliases

There are no aliases in the current ToolRegistry design. A future `aliases` field on
`RegisteredTool` could map MCP tool names to Loom-native descriptors, but this is deferred.
The initial seeding does not require aliases.

### 11.5 Open integration point

When MCP-BOUNDARY-001 lands, it should call `registry.register(...)` for each MCP-discovered
tool, using `mcp.{server_id}.{tool_name}` as the `ToolName`. The shared `Arc<RwLock<ToolRegistry>>`
in AppState is the correct write target. No new registry infrastructure is required.

---

## 12. Versioning and Deprecation Model

### 12.1 No version numbers in ToolName

`loom.response.read` is the name forever. Not `loom.response.read_v1` or
`loom.v1.response.read`. The name is the stable identifier across all metadata and schema
evolution.

### 12.2 Schema evolution

`argument_schema` and `output_schema` are `Option<serde_json::Value>`. When they change:
- Additive changes (new optional fields): backwards-compatible. No version bump needed.
- Breaking changes (removing required fields, changing types): require a new ToolName
  (e.g., `loom.response.read` → `loom.response.read_detail` for a fundamentally different
  output shape).

If schema versioning metadata is needed inside the schema, use a `$schemaVersion` property
inside the JSON Schema object, not in the ToolName.

### 12.3 Deprecation cycle

When a tool is renamed or retired:
1. Register the old name with `availability: Disabled` and a description noting the new name.
2. Register the new name as the active descriptor.
3. Remove the old name at the next major product version.

There are no programmatic aliases. The deprecation is descriptive metadata only.

### 12.4 Execution versioning

A tool may have `availability: NotAvailable` indefinitely while its metadata descriptor is
stable and registered. Execution capability is added when the owning subsystem implements it
by changing `availability` to `Available` (or `Experimental` first). The ToolName does not
change when execution lands. The metadata is the stable contract; the execution is additive.

### 12.5 `enabled` flag

The `enabled: bool` field is the administrative kill switch. Setting `enabled: false` makes
the resolution return `Disabled` regardless of `availability`. This is an operator control,
not an architectural version marker.

---

## 13. Security and Privacy Rules for Seeded Descriptors

1. **No secrets in metadata.** ToolName, display_name, description, and schemas must never
   contain API keys, credentials, passwords, bearer tokens, or any value that would trigger
   `value_is_sensitive()`.

2. **No raw provider content in descriptions.** Descriptions are public metadata. They describe
   capability intent, not implementation internals.

3. **Tool names must not contain SENSITIVE_KEY_FRAGMENTS as substrings.** After the hardening
   changes in AGENT-RUNTIME-TOOL-STACK-HARDENING-001, `sanitize_tool_text` no longer
   false-positives on tool names with "token" or "secret" as plain substrings (it now only
   redacts `token=` and `token: ` patterns). However, the canonical naming convention avoids
   words like "secret", "password", "credential", and "token" in the domain and verb segments
   to prevent any future sanitizer regression.

4. **Read-only tools with `AlwaysAllowed` do not permit writes.** The boundary returns `Skipped`
   regardless. But future implementation must enforce this — a tool registered as `AlwaysAllowed`
   must only be wired to read operations.

5. **JSON schemas in argument_schema and output_schema are metadata only.** They inform
   consumers about intended structure. They do not execute validation, marshal arguments, or
   invoke any code.

6. **`enabled: true` on a `NotAvailable` tool does not grant execution.** The ToolRuntimeBoundary
   always returns `Skipped` for `NotAvailable` tools. Enabling a descriptor does not bypass
   the execution boundary.

---

## 14. Implementation Constraints for TOOL-RUNTIME-REGISTRY-SEED-001

These constraints govern the implementation task. They are architectural requirements, not
suggestions.

### 14.1 Module placement

Create a new module: `services/loom-service/src/agent_runtime/catalog.rs`

Do not place seeding logic in:
- `tool_registry.rs` (registry contract, not seed)
- `mod.rs` (router construction, not catalog)
- `state.rs` (AppState contract, not catalog)
- `main.rs` (entry point, not catalog)

### 14.2 Seeding function signature

```rust
/// Registers the built-in Loom-native tool descriptors.
///
/// Called once at process startup from router construction. All registered
/// descriptors are metadata-only; no execution path exists. Availability is
/// NotAvailable until the owning subsystem implements the capability.
pub fn seed_builtin_tools(registry: &mut crate::agent_runtime::tool_registry::ToolRegistry) {
    // ...
}
```

Returns nothing. Panics are acceptable on startup (if `ToolRegistry::register` ever
panics, which it currently cannot). No `Result` return type.

### 14.3 Seeding call site

Call from `router_with_experimental()` in `services/loom-service/src/api/mod.rs`,
immediately after creating the `tool_registry` Arc and before constructing `AppState`:

```rust
let tool_registry = std::sync::Arc::new(std::sync::RwLock::new(
    crate::agent_runtime::tool_registry::ToolRegistry::new(),
));
crate::agent_runtime::catalog::seed_builtin_tools(
    &mut tool_registry.write().expect("tool registry seed lock")
);
```

The write lock is held for microseconds at process startup. No runtime contention risk.

### 14.4 Seeding is unconditional

Seed regardless of `experimental.agent_runtime_api`. The registry is always present. The
introspection route is gated separately. An empty registry is never visible unless the gate
is open.

### 14.5 No execution handlers

`catalog.rs` must not import or reference:
- `std::process`
- `std::fs`
- `std::net`
- `reqwest`
- `tokio::process` / `tokio::fs`
- Any HTTP client or connection pool
- Any SQL pool or database connection

The static execution guard must be extended to cover `catalog.rs`:
```rust
#[test]
fn catalog_module_performs_no_real_execution() {
    let source = include_str!("catalog.rs");
    for forbidden in ["std::process", "Command::new", "std::fs::", "std::net",
                      "TcpStream", "reqwest", "tokio::process", "tokio::fs"] {
        let occurrences = source.matches(forbidden).count();
        assert!(occurrences <= 1, "{forbidden} appears outside the static guard");
    }
}
```

### 14.6 No Closures or Trait Objects

`catalog.rs` must not define, store, or register closures, function pointers, or trait objects.
`RegisteredTool` does not have handler fields. This must remain true.

### 14.7 Privacy

No seeded descriptor may contain literal values that trigger `value_is_sensitive()`:
- No `bearer ` or `authorization:` in any string field.
- No `{label}=` or `{label}: ` patterns for sensitive labels in description text.

### 14.8 Module export

Export from `agent_runtime/mod.rs`:

```rust
pub mod catalog;
```

### 14.9 MEDIUM-003 safety (resolved by hardening)

The `sanitize_tool_text` over-redaction was fixed in AGENT-RUNTIME-TOOL-STACK-HARDENING-001.
The current implementation only redacts text that looks like an active credential assignment
(`token=`, `token: `, `authorization: `, etc.), not all text containing those words as
substrings. Seeded tool names like `loom.runtime.status`, `loom.loom.inspect`, and
`loom.response.read` do not trigger redaction.

---

## 15. Tests That SEED-001 Must Add

### 15.1 Rust tests in `catalog.rs`

```
#[test] seed_builtin_tools_produces_nonempty_registry
  → registry.list().len() >= 3 (minimum seed count)

#[test] seed_builtin_tools_produces_no_available_tools
  → all seeded tools have availability != Available (no premature availability claim)

#[test] seed_builtin_tools_all_tools_have_not_available_or_experimental
  → every tool is NotAvailable or Experimental

#[test] seed_builtin_tools_all_tools_are_enabled
  → all tools have enabled: true (availability gate, not kill switch)

#[test] seed_builtin_tools_all_read_only_tools_are_always_allowed
  → AlwaysAllowed tools are only in categories that are read-only

#[test] seed_builtin_tools_no_tool_is_immediately_executable
  → boundary.invoke(request) returns Skipped for every seeded tool
  (ToolRuntimeBoundary with shared registry returns Skipped, not Executed)

#[test] seed_builtin_tools_names_match_naming_convention
  → every ToolName starts with "loom.", has exactly 3 dot-separated segments,
    all lowercase, no spaces

#[test] seed_builtin_tools_serializes_without_forbidden_strings
  → serde_json::to_string(registry.list()) contains none of the forbidden markers

#[test] catalog_module_performs_no_real_execution
  → static source guard (see constraint 14.5)
```

### 15.2 Integration test in `agent_experimental.rs`

```
#[tokio::test] tools_route_returns_seeded_tools_after_startup
  → test_router(experimental: true) → GET /experimental/agent/tools
    → payload["count"] >= 3
    → all tools have executionEnabled: false
    → all tools have availability != "available"
    → loom.runtime.status is present in the list
```

### 15.3 Shared registry integration

The existing test `test_shared_registry_visibility_and_identity` verifies that tools written
to the shared Arc are visible through both the list_tools route and the ToolRuntimeBoundary.
After SEED-001, an additional test must verify that the seed function writes through the same
Arc path:

```
#[tokio::test] seed_is_visible_through_shared_registry_and_list_tools_route
  → call seed_builtin_tools on a fresh registry
  → wrap in Arc<RwLock>
  → build AppState with that registry
  → GET /experimental/agent/tools returns seeded tools
```

---

## 16. Open Questions

**Q1: Should the seeded catalog include all 10+ deferred descriptors immediately,
or only the 3 minimal descriptors?**

The design recommends 3. The implementation task (SEED-001) may choose to include the full
catalog at once — all marked `NotAvailable`. The trade-off is richness vs. stability risk
(more names committed earlier). The design does not mandate the minimum.

**Q2: Should the agent runtime have database access for execution?**

The current architecture has no database in AppState for agent use. When `loom.loom.inspect`
or `loom.response.read` are eventually made `Available`, the execution implementation will
need a database connection. Whether the agent runtime gets its own pool, borrows from AppState,
or goes through an internal service boundary is an architectural decision for the owning task.
This design does not pre-commit to any option.

**Q3: Should `loom.loom.inspect` remain the canonical name, or should a disambiguation
be introduced?**

The doubled form is intentional. Alternatives considered: `loom.thread.inspect`,
`loom.conversation.inspect`. Both are non-vocabulary. The doubled form is recommended. This
question should be re-evaluated only if the doubled form causes concrete problems at
implementation or in UI.

**Q4: Does the category string need to become an enum?**

Currently `category` is a free-form `String`. Enforcement is by convention. An enum would
provide compile-time guarantees but would require schema changes and migration logic. Given
the current experimental phase, the convention approach is preferred. Revisit at
TOOL-PERMISSION-UI-001 when the UI needs to group tools by category.

**Q5: Should the argument_schema be populated now or at execution time?**

This design proposes populating the argument schema at seed time (as metadata). It does not
need to match any runtime execution signature — it is purely informational. The inspector UI
can display it. The recommendation is to include simple schemas for the 3 seeded tools (as
shown in Section 8) and leave `None` for tools where the argument structure is uncertain.

---

## 17. Architecture Decision Record Summary

**ADR: Loom-native ToolName Convention**

- **Status:** Accepted
- **Decision:** `loom.{domain}.{verb}` with exactly 3 dot-separated lowercase segments
- **Alternatives rejected:** snake_case (`loom_response_read`), verb-first (`read_response`), 4-segment depth
- **Consequences:** Predictable, scannable names. MCP namespace separation is free. Doubled `loom.loom.*` is accepted.

**ADR: Minimal Initial Seed (Option B)**

- **Status:** Accepted
- **Decision:** Seed exactly 3 read-only, NotAvailable descriptors. Broader catalog deferred.
- **Alternatives rejected:** Option A (empty, wastes gated infrastructure), Option C (10+ descriptors, premature commitment)
- **Consequences:** Inspector shows 3 tools immediately. Naming convention is established in production code. No risk of prematurely naming unstable capabilities.

**ADR: All Initial Seed Tools are NotAvailable**

- **Status:** Accepted
- **Decision:** `NotAvailable` for all seeded descriptors regardless of whether a backing repository exists.
- **Rationale:** No execution path connects the agent runtime to any repository. `Available` would be a false promise.
- **Consequences:** `ToolRuntimeBoundary.invoke()` returns `Skipped` for all seeded tools. Inspector correctly reflects this.

**ADR: Seeding is Unconditional at Router Construction**

- **Status:** Accepted
- **Decision:** `seed_builtin_tools` is called regardless of `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API` state.
- **Rationale:** The registry is always present. Seeding is cheap. The introspection route is the gate, not the registry.
- **Consequences:** Even in production without the env var, the registry has metadata. It is never exposed unless the gate is open.

**ADR: Mutation Tools Excluded Until TOOL-PERMISSION-UI-001**

- **Status:** Accepted
- **Decision:** No write, delete, create, or build tools in the initial seed.
- **Rationale:** `RequiresUserApproval` tools cannot be acted on without a UI approval path. Seeding them now implies a workflow that does not exist.
- **Consequences:** Initial seed is read-only. Mutation tools are a separate design and implementation task.

---

*This document is design-only. No production source was modified.*
*Commit: docs — add to task tracker at TOOL-RUNTIME-REGISTRY-SEED-DESIGN-001 completion.*
