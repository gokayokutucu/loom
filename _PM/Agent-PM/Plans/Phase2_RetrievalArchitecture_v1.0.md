# Agent Phase 2: Retrieval Architecture Plan v1.0

## Objective

Design the complete Loom Retrieval Architecture: the contracts, ownership model, hybrid ranking
strategy, index lifecycle, and privacy boundaries that will let `loom-service` answer "what's
relevant to this query" without changing what already authoritatively stores that data.

This document is **architecture only**. It defines contracts and responsibilities, not code,
migrations, structs, or types. No implementation begins under this plan.

## Status

Design accepted. Implementation tracked separately, phase by phase, under Agent Phase 2
(Retrieval Architecture) follow-up tasks. SQLite remains authoritative; LanceDB and Tantivy
remain unimplemented as of this writing — see [§13](#13-final-recommendation).

## Changelog
- **v1.0**: Initial architecture design (RETRIEVAL-ARCH-001).

---

## 1. Current Retrieval-Relevant Assets

A repository audit (mandatory precondition for this design) found that Loom already has a
substantial amount of retrieval-adjacent infrastructure. None of it is wasted by this design —
the architecture below is explicitly built to reuse it.

### 1.1 Source-of-truth content (SQLite, `services/loom-service/migrations/`)

| Table | Migration | Role |
|---|---|---|
| `responses` | 0001 | Messages — the dominant retrievable content unit |
| `references` | 0001 | Existing link graph between responses/looms/fragments/external URIs |
| `response_code_blocks` | 0006 | Exact fenced code blocks extracted from responses |
| `response_parts` | 0007 | Semantic partitioning of a response (paragraph/heading/code/image) |
| `response_tags` | 0008 | Per-response tags (language, topic, entity, code) |
| `loom_topic_index` | 0008 | Topic weight tracking per loom |
| `context_graph_links` | 0008 | Generic knowledge-graph edges between artifact kinds |
| `memories` / `memory_events` | 0013 | Long-term memory, distinct from chat history, append-only event log |
| `attachments` / `attachment_blobs` / `attachment_parsed_content` | 0015 | Uploaded file metadata, raw bytes, extracted text |
| `attachment_parsed_chunks`, `attachment_parse_artifacts`, `attachment_parse_artifact_chunks` | 0016 | Chunked attachment text (default ~2,400 chars, token-estimated, page/sheet aware) |
| `attachment_summaries`, `attachment_parse_artifact_summaries` | 0016 | Per-attachment / per-artifact summaries |
| `attachment_blob_objects` | 0017 | Blob-level dedupe by checksum |
| `response_context_capsules` | 0001 | Response-level summary (key points, keywords, entities, code-block refs) |
| `loom_checkpoint_summaries` | 0001 | Loom-level rolling summary (decisions, constraints, open questions) |
| `weft_origin_contexts` | 0001 | Cross-loom ("weft") origin linkage |
| `context_build_jobs` / `context_artifact_events` | 0001 | Async build queue + lifecycle events for the above artifacts |
| `agent_runs` / `agent_steps` / `agent_events` | 0022 | Durable agent execution trace, append-only, privacy-filtered |

### 1.2 Existing derived/rebuildable projection (the template to generalize)

- `search_documents` + `search_documents_fts` (migration 0018) — an FTS5 virtual table populated
  by `SearchIndexRepository`, sourced from responses, memories, and attachment chunks. This is
  **already** a rebuildable projection of SQLite content, with a `source_rank` weighting field
  and an `is_deleted` tombstone convention.
- `search_index_state` — key-value rebuild-state tracking for that projection.

This pair is the architectural precedent this design generalizes: SQLite owns content,
a derived index is rebuilt from it, and the derived index can be deleted and regenerated without
data loss. The Retrieval Architecture in this document extends that same pattern to (eventually)
Tantivy and LanceDB, rather than inventing a new pattern.

### 1.3 Existing candidate/ranking logic (the seed of the candidate model)

`src/context/retrieval.rs`, `src/context/budget.rs`, `src/context/manager.rs` already define:

- `ContextRetrievalCandidateKind` — Response, ResponsePart, ResponseCapsule, Checkpoint,
  CodeBlock, Topic, Reference, Memory, AttachmentChunk, WeftOrigin
- `ContextRetrievalIncludeMode` — Full, Capsule, ReferenceOnly, CodeExact, CodeSummary
- `ContextSourceLevel` — Summary, Checkpoint, ExactResponsePart, AttachmentChunk, CodeBlock,
  Memory, WeftOrigin
- `QueryIntentKind` — EntityFactual, Code, Temporal, Decision, FileDocument, General
- `ContextRetrievalCandidate` / `ContextRetrievalResult` — scored, budgeted selection

This is heuristic/keyword scoring today, with no semantic ranking. It is **not replaced** by this
architecture — it is the Context Manager's existing internal selection logic, and it becomes a
**consumer** of the new Retrieval Architecture's candidates rather than computing them ad hoc
(see [§8](#8-context-manager-integration)).

### 1.4 Agent Runtime linkage already reserved

`agent_runs.context_snapshot_id` (migration 0022) is a nullable column reserved for **Phase 3
(Agent Context Manager)** linkage. It is unused today. This design treats it as the future seam
through which a `RetrievalResult`/context snapshot can be attached to an agent run for audit and
replay, without retrieval owning that column.

### 1.5 What does not exist yet

- No vector/embedding infrastructure (no LanceDB, no embedding model wiring, no HNSW/FAISS).
- No Tantivy (Cargo.lock confirmed: no `tantivy`, `lancedb`, `qdrant`, `hnsw`, `faiss`, or
  `fastembed` dependencies present anywhere in the workspace).
- No semantic/hybrid scoring of any kind. All search today is exact LIKE-based (`memories`) or
  FTS5 keyword search (`search_documents_fts`).
- No reusable "retrieval candidate" contract shared across subsystems — `context/retrieval.rs`'s
  types are private to the Context module and not exposed as a general retrieval API.

---

## 2. Canonical Retrieval Vocabulary

These five concepts are the entire public surface of the Retrieval Architecture. Every retrieval
engine (FTS5 today, Tantivy/LanceDB later) speaks this vocabulary; nothing outside retrieval needs
to know which engine answered.

### `RetrievalQuery`
The retrieval layer's only input. Carries:
- the raw query text (already PII/secret-scrubbed by the caller — retrieval does not scrub)
- a `QueryIntentKind`-style hint (reused from `context/retrieval.rs`, promoted to shared
  vocabulary) — code / temporal / decision / file-document / entity / general
- scoping filters: `loom_id`, optional `response_id` range, optional `source_kind` allowlist
  (response, memory, attachment_chunk, code_block, capsule, checkpoint)
- a result budget (max candidates, not a token budget — token budgeting is the Context Manager's
  job, not retrieval's)
- a mode flag: `keyword_only`, `hybrid`, or `semantic_only` (semantic modes are no-ops until
  Phase D/E land — see [§11](#11-recommended-rollout-plan))

### `RetrievalSource`
An opaque identifier for *which underlying engine and projection* produced a candidate. Not a
table name — a logical source:
- `Sqlite::Fts5(search_documents)` — keyword search over the existing FTS5 projection
- `Sqlite::ExactMemory` — the existing LIKE-based memory match path (kept, not replaced)
- `Tantivy::ResponseIndex` (future)
- `LanceDb::ResponseEmbeddings` (future)

`RetrievalSource` exists so diagnostics and rollout can answer "did this candidate come from
keyword or vector search" without leaking engine internals into the candidate model itself.

### `RetrievalCandidate`
The atomic unit of a retrieval result. Each candidate references *existing* SQLite identity — it
never carries a copy of the content that could drift from the row that owns it:
- `source_kind` + `source_id` (reuses the existing `search_documents.source_kind` /
  `source_id` convention — response, memory, attachment_chunk, code_block, capsule, checkpoint)
- `chunk_ref` (see [§4](#4-chunk-identity-model)) when the candidate is a sub-document fragment
- `relevance_score` — a normalized [0,1] score, engine-agnostic
- `rank_signals` — a small, named breakdown (e.g. `bm25`, `vector_cosine`, `recency_boost`,
  `source_rank`) for the *diagnostics* surface, not for product display
- `retrieval_source` — which `RetrievalSource` produced it
- a **text preview only** — never raw thinking, never full untruncated content; full content
  fetch is a separate, explicit SQLite read keyed by `source_id`, performed by the caller
  (Context Manager), not by retrieval

### `RetrievalResult`
The retrieval layer's only output. An ordered list of `RetrievalCandidate`, plus:
- the `RetrievalQuery` that produced it (for replay/audit, not for re-display)
- fusion metadata: which fusion strategy was applied (see [§5](#5-hybrid-retrieval-architecture))
  and how many candidates came from each `RetrievalSource` before fusion
- a `RetrievalDiagnostics` block

### `RetrievalDiagnostics`
Non-content metadata for observability and the future Agent Run trace
([§13 of the architecture ledger / agent_events](#9-memory-integration) already has precedent for
"safe, content-free telemetry"):
- per-source candidate counts and latency
- whether any source degraded (e.g. Tantivy index stale, falling back to FTS5)
- the fusion method and its parameters
- **no query text, no candidate text** — diagnostics are observable by the same privacy rules as
  `agent_events` (see [§7](#7-privacy-model))

---

## 3. Source-of-Truth Ownership

| Store | Owns | Why |
|---|---|---|
| **SQLite** | All content: responses, references, attachments, attachment chunks, memories, capsules, checkpoints, agent run history. The **only** place where deleting the store loses user data. | Already the system's transactional source of truth (Section 1.1). Every retrieval engine's job is to answer "which `source_id`s are relevant," never to *be* the place content lives. |
| **Tantivy** | A keyword/BM25 index over chunk-identity-stamped text pulled from SQLite. Fully rebuildable from SQLite at any time. | BM25 quality and multi-field keyword querying outgrow FTS5's feature set as retrieval needs grow (synonyms, field boosting, fuzzy matching, faceting). FTS5 is not deprecated by this — see [§11](#11-recommended-rollout-plan) Phase D framing. |
| **LanceDB** | A vector index of embeddings over the same chunk-identity-stamped text. Fully rebuildable from SQLite (re-embed) at any time. | Semantic similarity search that BM25/FTS5 structurally cannot do (paraphrase matching, cross-lingual recall, "find conceptually similar" queries). |

**Hard rule, restated from the task constraints and made structural, not aspirational:**
deleting the Tantivy index directory or the LanceDB database directory must be a *no-op* for user
knowledge — at most a temporary search-quality regression until the next rebuild completes. This
is enforced by construction: neither store is ever the only place a `source_id`'s content exists,
and neither store is permitted to mint its own identity for a document — both consume
`(source_kind, source_id, chunk_ref)` identity that SQLite already assigned (see
[§4](#4-chunk-identity-model)).

This also means: **no migration ever targets Tantivy or LanceDB.** Schema evolution for indexed
fields is handled by index rebuild, not by index migration. This sidesteps a whole category of
operational risk (no embedding-dimension migrations, no Tantivy schema migrations) at the cost of
rebuild time, which is an acceptable trade given content volume (see [§12](#12-risks-and-trade-offs)).

---

## 4. Chunk Identity Model

Every retrievable unit, whether a whole response or a 2,400-character attachment chunk, must be
addressable by an identity that:
1. Already exists in SQLite (retrieval never mints new identity)
2. Is stable across rebuilds (deleting and rebuilding Tantivy/LanceDB must reproduce the same
   identity for the same content, or candidates silently disappear from history/audit)
3. Lets a candidate be resolved back to its owning row in O(1)

### Identity components

- **`source_kind`** — reuses the existing `search_documents.source_kind` enum: `response`,
  `memory`, `attachment_chunk`. This design adds `code_block`, `capsule`, `checkpoint` to that
  enum's *logical* scope (not necessarily the literal column today) since those are now candidate
  kinds in `context/retrieval.rs` that retrieval should be able to surface.
- **`source_id`** — the primary key of the owning row (`response_id`, `memory_id`,
  `attachment_parsed_chunk.chunk_id`, `response_code_blocks.code_block_id`, `capsule_id`,
  `checkpoint_id`). This is the join key back to SQLite; it is never duplicated into the index as
  display content, only as a join key.
- **`chunk_ref`** — for `source_kind`s that are already pre-chunked at the SQLite layer
  (`attachment_parsed_chunks` rows are already discrete chunks; `response_parts` are already
  discrete parts), `chunk_ref == source_id` of the chunk-level table. For `source_kind`s that are
  *not* pre-chunked (a long `response.content`), retrieval-layer chunking (for embedding window
  sizing) produces a `chunk_ref` that is a deterministic function of `(source_id, char_start,
  char_end)` — **not** a random UUID — so that re-chunking the same content on rebuild reproduces
  the same `chunk_ref` and diagnostics/history referencing an old `chunk_ref` don't silently break.
- **`provenance`** — `(loom_id, response_id_if_applicable)`, copied from the owning row at
  index-build time, used purely for scoping filters in `RetrievalQuery`. Provenance is allowed to
  go stale between rebuilds (e.g. a response gets soft-deleted); staleness is resolved by the
  caller re-checking `is_deleted` in SQLite before using retrieved content, never by retrieval
  guaranteeing freshness.
- **`digest`** — a content hash (reusing the existing SHA-256 convention from
  `attachment_blob_objects`) of the exact text that was indexed/embedded for this `chunk_ref`.
  Digest ownership is **retrieval's**, not SQLite's — SQLite does not need to know what was
  embedded. Digest is how a rebuild decides "this chunk's source content changed, re-embed it"
  without comparing full text.

### Why this matters

This is what makes "LanceDB/Tantivy is rebuildable, deleting them never loses knowledge" true by
construction rather than by discipline: a candidate from either store is *never* more than
`(source_kind, source_id, chunk_ref)` plus a score. There is no path by which content lives only
in the index.

---

## 5. Hybrid Retrieval Architecture

### Candidates considered

| Approach | What it's good at | What it structurally can't do |
|---|---|---|
| **BM25** (FTS5 today, Tantivy later) | Exact term/phrase matching, fast, no embedding cost, explainable | Paraphrase/synonym/cross-lingual recall; struggles with short or vague queries |
| **Vector search** (LanceDB) | Semantic/paraphrase recall, "find similar meaning" | Exact identifiers (error codes, variable names, file paths) rank poorly; embedding cost and drift risk; less explainable |
| **Reciprocal Rank Fusion (RRF)** | Combines ranked lists from heterogeneous sources without needing comparable raw scores; simple, no tuning | Ignores score *magnitude* — a BM25 near-perfect match and a BM25 weak match both just contribute by rank position |
| **Weighted linear fusion** | Lets `source_rank`-style domain weighting persist (memory > response > attachment, already established in `search_documents.source_rank`) | Requires score normalization across heterogeneous engines, which is fragile when one engine (BM25) is unbounded and another (cosine) is naturally [-1,1] |
| **Learned re-rankers** | Best quality, can model query-document interaction directly | Requires labeled data and/or a model call per query — operationally heavy, latency cost, and a new model dependency Loom does not currently have for this purpose |

### Recommended approach

**RRF as the fusion backbone, with the existing `source_rank` domain weighting folded in as a
pre-fusion boost, not a post-fusion reweight.** Concretely:

1. Each source (`Sqlite::Fts5`, future `Tantivy::*`, future `LanceDb::*`) returns its own
   independently-ranked candidate list — no cross-engine score comparison happens inside a source.
2. Before fusion, each candidate's *rank* (not score) is adjusted by the existing domain
   weighting (memory ranks slightly ahead of response, response ahead of attachment chunk, mirroring
   `search_documents.source_rank`'s 1.2 / 1.0 / 1.1 precedent) — implemented as a small rank-shift,
   not a score multiply, so it composes cleanly with RRF's rank-based math.
3. RRF combines the adjusted rank lists into one fused ranking.
4. Re-rankers are **explicitly deferred**, not rejected — RRF output is exactly the input shape a
   future re-ranker would consume (a small candidate-and-rank list), so adding one later is additive,
   not a redesign.

**Why RRF over weighted linear fusion as the default:** Loom will have at most two or three
heterogeneous sources active at once (FTS5/Tantivy + LanceDB), and RRF's main weakness — ignoring
score magnitude — matters most when you have many sources of wildly different reliability. With
two or three sources, rank-based fusion is robust, requires no score-normalization tuning per
engine, and avoids the BM25-is-unbounded-vs-cosine-is-bounded normalization trap entirely. Weighted
fusion is not ruled out long-term; it's the natural next step *if and when* a learned re-ranker
needs raw scores rather than fused ranks as a feature.

**`hybrid` mode in `RetrievalQuery` therefore means:** query every available source (today: just
`Sqlite::Fts5`; later: + Tantivy, + LanceDB), apply domain rank-shift, fuse with RRF. `keyword_only`
restricts to BM25-family sources; `semantic_only` restricts to vector sources (a no-op until
LanceDB exists, returning an empty `RetrievalResult` with a diagnostics flag, not an error).

---

## 6. Index Lifecycle

Generalizing the existing `search_index_state` precedent to all rebuildable indexes:

- **Create**: An index (FTS5 table, future Tantivy index directory, future LanceDB table) is
  created empty and populated by a full rebuild pass over SQLite. No index is ever created
  pre-populated by a migration — migrations only create SQLite tables.
- **Update (incremental)**: On write to a source table SQLite already considers append/update-only
  for retrieval purposes (new response, new memory, new attachment chunk), an incremental upsert is
  pushed to each active index keyed by `(source_kind, source_id, chunk_ref)` — exactly the existing
  `SearchIndexRepository::upsert_*` pattern, generalized to also push to Tantivy/LanceDB once those
  exist.
- **Delete (tombstone, not row deletion)**: Soft-deletes in SQLite (`responses.is_deleted`,
  `memories.deleted_at`) propagate as tombstones in each index, mirroring `search_documents.is_deleted`
  today, rather than triggering an immediate physical delete. Physical compaction happens at rebuild
  time, not at delete time — this avoids a delete-storm during index writes on every soft-delete.
- **Rebuild (full)**: Each index supports a full rebuild from SQLite alone: drop, recreate empty,
  replay every non-deleted source row through the same upsert path incremental updates use. This is
  the same operation a fresh install or a corrupted index runs.
- **Corruption recovery**: Detected via index-open failure (Tantivy) or query failure (LanceDB) at
  startup or first use — mirrors the existing `ensure_fts5_available()` pattern of failing loud at
  startup rather than silently degrading. On detected corruption: mark that source unavailable in
  `RetrievalDiagnostics`, continue serving from remaining sources, and surface a rebuild-needed
  state (parallel to `runtime_model_download_jobs`'s job-tracking pattern) rather than blocking the
  request path.
- **Versioning**: Each index carries a schema/embedding-model version stamp (e.g. which embedding
  model produced a LanceDB table's vectors). A version mismatch on startup is treated identically
  to corruption — triggers a rebuild-needed state — because a stale embedding model's vectors are
  not safely comparable to a new model's query vector.

No index ever blocks a write to SQLite. All index maintenance is asynchronous relative to the
write that triggered it, exactly like `context_build_jobs` already decouples capsule/checkpoint
building from the response write that invalidated them.

---

## 7. Privacy Model

### Must never be indexed, embedded, or searchable

- Raw thinking / chain-of-thought / hidden reasoning, in any form, at any stage (matches the
  existing `agent_events` and `memories` write-time rejection pattern — extended here to index
  build time as well: the index builder reads from SQLite, and SQLite never had thinking to read,
  but the rule is restated here because it is a retrieval-layer invariant, not only a write-layer
  one).
- Raw provider request/response envelopes, API keys, secrets, Authorization/Bearer headers — same
  rationale; these are never in SQLite source tables to begin with, so they cannot leak into an
  index, but retrieval code must not introduce a new path that reads them (e.g. must not index
  `agent_events.payload_json` wholesale without re-validating against the same forbidden-pattern
  check already used at write time).
- Tool output raw payloads — `agent_events` already excludes tool output summaries; retrieval does
  not get a side channel to that content either.

### May be indexed

- `responses.content`, `response_parts`, `response_code_blocks` — already user-visible content.
- `memories.content` / `normalized_content` — already user-visible, already explicitly
  user-confirmed or system-inferred preference content, not raw model internals.
- `attachment_parsed_chunks.content_text` — already user-visible extracted text.
- `response_context_capsules` / `loom_checkpoint_summaries` — these are *generated* summaries, but
  generated from the same privacy-filtered pipeline that already forbids thinking in their source
  metadata; indexing the summary text itself is equivalent to indexing the response it summarizes.

### Structural enforcement, not just policy

Because every index is rebuilt exclusively from SQLite content (Section 6), and every SQLite write
path already enforces forbidden-pattern rejection (`reject_forbidden_payload` on `responses`,
`references`, `memories`; the `agent_events` allowlist), the index layer **inherits** these
guarantees automatically — it cannot index something SQLite refused to store. The one place this
inheritance is not automatic is `agent_events.payload_json`, because that table is allowed to hold
small structured metadata for non-content events; this design explicitly **excludes
`agent_events`/`agent_runs`/`agent_steps` from ever being a retrieval source**. They are an audit
trail, not retrievable knowledge — consistent with their existing purpose.

### Diagnostics privacy

`RetrievalDiagnostics` (Section 2) is held to the same bar as `agent_events`: counts, timings,
source identifiers, fusion parameters — never query text, never candidate text. This makes
diagnostics safe to eventually surface in the same kind of inspector UI that already exists for
agent run history, without a separate review pass.

---

## 8. Context Manager Integration

The future Agent Context Manager (Phase 3) is the **only** consumer of `RetrievalResult` that
assembles prompts. Retrieval's contract with it:

- Retrieval returns `RetrievalCandidate`s with **identity and score**, not assembled prompt text.
- The Context Manager owns: deciding `ContextRetrievalIncludeMode` (Full vs Capsule vs
  ReferenceOnly vs CodeExact vs CodeSummary) per candidate, token budgeting
  (`context/budget.rs`'s existing responsibility, unchanged), and final prompt assembly order.
- The existing `context/retrieval.rs` heuristic candidate generation does not disappear on day
  one. It becomes one *source* feeding the Context Manager's selection — practically, the Context
  Manager can call the new Retrieval Architecture's `RetrievalQuery` interface for the sources that
  already moved behind it (FTS5 today; Tantivy/LanceDB later) while keeping its own
  graph-traversal-style candidate generation (topic index, checkpoint chains, weft origins) as a
  separate, complementary candidate stream it fuses itself, since those are structural/graph
  candidates rather than text-relevance candidates and don't naturally fit a BM25/vector fusion
  model.
- `agent_runs.context_snapshot_id` is the seam: when Phase 3 lands, a `RetrievalResult`'s
  diagnostics-safe summary (source counts, fusion method, not content) can be persisted as part of
  whatever a "context snapshot" turns out to be, joined to an agent run via that already-reserved
  column. This document does not design the context snapshot itself — that's Phase 3's job — it
  only confirms the column is sufficient as a join key for retrieval's contribution to it.

Retrieval never calls into the Context Manager, and never decides what makes it into a prompt.
That asymmetry is intentional and matches the task's constraint that "retrieval engines never
directly modify prompts."

---

## 9. Memory Integration

Memory (`memories` / `memory_events`, migration 0013) is a **source**, not an owner, of retrieval —
and retrieval is not an owner of memory policy:

- Retrieval can index `memories.normalized_content` as `source_kind = memory` exactly as
  `search_documents` already does, and apply the same `source_rank` boost memory already gets
  (1.2 vs response's 1.0) as the rank-shift described in [§5](#5-hybrid-retrieval-architecture).
- Retrieval does not decide **which** memories exist, when a memory is promoted from
  `inferred_preference` to `explicit_user_memory`, or when a memory is soft-deleted. That remains
  entirely the memory subsystem's policy, expressed through `memory_events`.
- The future Agent Memory phase (Phase 4) may introduce memory *retrieval* policy (e.g. "only
  surface explicit memories above a confidence threshold, for this query intent") — that policy
  layer sits **between** the Retrieval Architecture and the Context Manager, filtering or
  re-weighting `RetrievalCandidate`s with `source_kind = memory` before they reach the Context
  Manager. Retrieval's job stops at "here are memory-sourced candidates and their relevance
  scores"; Phase 4 decides whether and how heavily to surface them.
- Concretely, this means the Retrieval Architecture's public contract (Section 2) needs no change
  to accommodate Phase 4 — Phase 4 is a filter/policy stage that consumes `RetrievalResult` the
  same way the Context Manager does, just with a narrower `source_kind` scope and different
  selection rules.

---

## 10. Future Tool Integration

### Loom-native tools

The existing Tool Runtime (`Phase 1A`) already has a process-local `ToolRegistry` and tool
execution boundary. A future Loom-native "search" or "retrieve" tool would:
- Accept a query and call the Retrieval Architecture's `RetrievalQuery` interface exactly as the
  Context Manager would — there is no special tool-facing API, because `RetrievalQuery` /
  `RetrievalResult` are already engine-agnostic and caller-agnostic.
- Return `RetrievalCandidate` previews (not full content) as its tool output, consistent with the
  existing rule that tool output summaries are not persisted into `agent_events` — a retrieval
  tool's output is exactly the kind of bounded, summarized content that rule was designed for.
- Not require retrieval to know it is being called by a tool versus the Context Manager versus an
  inspector UI. This is what "without creating coupling" means structurally: the tool is a thin
  caller of a stable contract, not a special integration point retrieval has to design around.

### MCP tools

MCP is explicitly deferred repository-wide (per current constraints) and this design does not
pull it forward. The only forward-looking commitment made here: because `RetrievalQuery` and
`RetrievalCandidate` are plain, engine-agnostic, serializable concepts (Section 2) with no
dependency on the internal tool runtime's types, an eventual MCP-exposed "search Loom" tool would
serialize a `RetrievalQuery` from MCP's tool-call arguments and serialize `RetrievalCandidate`
previews back, with no retrieval-side change required to support either Loom-native or MCP calling
conventions. Coupling is avoided by retrieval not knowing what a "tool" is at all — only the
Loom-native or MCP tool layer needs to know how to translate its call shape into a `RetrievalQuery`.

---

## 11. Recommended Rollout Plan

| Phase | Scope | Depends on |
|---|---|---|
| **A — Architecture** | This document. No code. | — |
| **B — SQLite Projection Contracts** | Define the chunk identity model (Section 4) as concrete, stable identity rules for every existing `source_kind`; extend `search_documents`-equivalent projection coverage to `code_block`, `capsule`, `checkpoint` source kinds that today are candidate kinds in `context/retrieval.rs` but not indexed. Still SQLite/FTS5 only — no new datastore. | A |
| **C — LanceDB Adapter** | Stand up LanceDB as a rebuildable projection following the lifecycle in Section 6: create/rebuild/version-check, populated from the Phase B identity contracts. Choose and pin an embedding model. No query-path changes yet — build and validate the index exists and is rebuildable before it's ever queried. | B |
| **D — Tantivy Adapter** | Stand up Tantivy as a second rebuildable BM25-family projection alongside (not replacing) FTS5, following the same lifecycle. Evaluate whether Tantivy fully supersedes FTS5 for query-time use or whether FTS5 remains the keyword source and Tantivy is additive — this is a decision Phase D produces, not one this document prejudges. | B (parallel to C) |
| **E — Hybrid Retrieval Service** | Implement `RetrievalQuery` → `RetrievalResult` per Section 2, with RRF fusion per Section 5, querying whichever of {FTS5, Tantivy, LanceDB} are live at that point. This is the first phase where a real query path exists. | C, D |
| **F — Diagnostics** | Implement `RetrievalDiagnostics` end-to-end, including corruption/staleness detection from Section 6 and the privacy bar from Section 7. Make diagnostics inspectable (mirroring the existing Agent Run Inspector pattern) before declaring E production-ready. | E |
| **G — Context Manager Integration** | Wire the Context Manager (Phase 3, separately tracked) as the first real consumer of `RetrievalResult`, per Section 8. | E, F, and Agent Phase 3 |

Phases C and D are independently shippable and order-interchangeable — neither depends on the
other, only both depend on B. This lets LanceDB and Tantivy work proceed in parallel once chunk
identity is settled.

---

## 12. Risks and Trade-offs

- **Rebuild cost grows with content volume.** Full rebuilds (Section 6) are the only path to
  schema/embedding-model version changes; there is no incremental migration path for index
  schemas. Acceptable trade for never needing embedding-dimension migrations or Tantivy schema
  migrations, but rebuild time becomes an operational concern as `responses`/`attachments` grow.
  Mitigation: rebuild is async and per-source, so a LanceDB rebuild does not block FTS5/Tantivy
  availability, and vice versa.
- **RRF's rank-only fusion discards score magnitude**, which could under-rank a near-perfect BM25
  match against several mediocre semantic matches in pathological cases. Accepted for now given
  only 2-3 sources are expected at once (Section 5); revisit if a fourth heterogeneous source or a
  re-ranker is added.
- **Embedding model choice is a long-lived commitment** once LanceDB tables are populated at scale
  — changing models means a full re-embed, which is exactly the "rebuild" cost above, but
  triggered by a product/quality decision rather than a schema change. The version-stamp mechanism
  in Section 6 makes this detectable and safe, but not free.
- **No re-ranker initially** means hybrid retrieval quality is capped by RRF + domain rank-shift
  quality. This is a deliberate scope cut to avoid taking on a new model-call dependency in Phase
  E; the design leaves the door open (Section 5) but does not commit to a timeline for it.
  Mitigation: candidate shape is already re-ranker-ready, so this is a pure feature addition later,
  not a rearchitecture.
- **Two BM25-family engines (FTS5 + Tantivy) running simultaneously** during/after Phase D risks
  divergence or redundant maintenance cost if Tantivy doesn't end up superseding FTS5 cleanly.
  Mitigation: Phase D is explicitly scoped to produce that decision rather than assume the outcome.
- **Chunk-ref determinism for non-pre-chunked content** (Section 4) requires careful, stable
  chunking-boundary logic; if chunking logic changes between rebuilds, `chunk_ref`s for
  not-pre-chunked sources (e.g. long responses) will shift, and any diagnostics/history referencing
  an old `chunk_ref` will silently point to nothing. Mitigation: chunk_ref is derived, not stored
  outside the index itself, except where it's used in diagnostics (which are short-lived,
  observability-only, and not depended on for correctness).

---

## 13. Final Recommendation

**Adopt this architecture as designed, and proceed to Phase B (SQLite Projection Contracts) next,
not Phase C/D.** Concretely:

1. **SQLite remains sole source of truth, unconditionally.** No retrieval engine is ever allowed
   to be the only home of content. This is enforced by the chunk identity model (Section 4) and
   the index lifecycle (Section 6), not merely stated as policy.
2. **Tantivy and LanceDB are additive, rebuildable projections — not yet implemented, and this
   document does not implement them.** Per the task's explicit instruction, no code, migrations,
   structs, or types are produced here.
3. **RRF with domain rank-shift is the recommended fusion strategy** over weighted linear fusion
   or learned re-ranking, for the reasons in Section 5, with re-ranking left as an explicit,
   low-cost future addition rather than a present requirement.
4. **The existing `search_documents`/FTS5 projection and `context/retrieval.rs` candidate logic
   are not thrown away.** They are the architectural precedent this design generalizes (Section
   1.2, 1.3) and the first real `RetrievalSource`/consumer once the contracts in Section 2 exist.
5. **Privacy enforcement is structural, not procedural**: because every index is rebuilt
   exclusively from SQLite, and SQLite already rejects forbidden content at write time (Section 7),
   raw thinking and secrets cannot reach an index without a new, separate bug — not merely a missed
   review step.
6. **Recommended next action**: begin Agent Phase 2 follow-up work at Phase B only — defining
   concrete, stable chunk identity for `code_block`, `capsule`, and `checkpoint` source kinds that
   today exist as candidate kinds but are not yet indexed anywhere. This is the natural, low-risk
   continuation of the existing `search_documents` pattern and the prerequisite for both Tantivy
   and LanceDB adapters, without committing to either yet.
