# Loom Product Roadmap

Loom turns AI conversations into an addressable, navigable, replayable personal web.

The product is evolving into an AI-native personal web and local-first knowledge runtime. It is not just another chat UI, not a generic agent framework, not a token-tree explorer, and not a vector-memory wrapper. Loom treats AI work as a set of durable local objects: Looms, Wefts, Responses, References, Bookmarks, Quick Ask turns, attachments, graph links, retrieval records, and runtime events.

## Why Loom Exists

AI work usually disappears into long transcripts. Users lose the answer that mattered, the branch that produced it, the files that grounded it, and the reason a model saw a particular piece of context.

Loom makes that work addressable:

- every answer can become a destination
- every Response can be referenced, bookmarked, and reused
- every Quick Ask can stay lightweight until it is worth promoting
- every Weft keeps its origin linkage while exploring a new path
- every explicit Reference or attachment chip preserves provenance
- retrieval is inspectable rather than opaque memory or hidden RAG
- graph links make relationships between ideas, files, References, Bookmarks, and Wefts navigable
- local runtime state can be rebuilt from canonical records and safe derived artifacts

The goal is not to hide complexity behind an autonomous agent graph. The goal is to make human AI work browsable, reusable, auditable, and reconstructable.

## Architecture Direction

Loom is local-first by default. The Rust `loom-service` is the product runtime authority, SQLite is the canonical store, and React/Electron is the browser-like shell.

Current architecture is hybrid:

- normalized SQLite tables own Loom, Weft, Response, Reference, Bookmark, Memory, Quick Ask, attachment, graph, and runtime state
- derived artifacts such as Response parts, code blocks, capsules, checkpoints, attachment chunks, and FTS documents are rebuildable projections
- graph projections connect Looms, Wefts, References, Bookmarks, attachments, and provenance/retrieval lineage
- workflow runs, orchestration events, context diagnostics, retrieval diagnostics, and parse jobs provide event/log-style replay and provenance where useful
- ContextManager remains the policy authority for prompt context construction

Loom shares ideas with event/log-centric AI systems such as append-only lineage, fork/diff semantics, provenance, replayable state, and deterministic reconstruction. ActiveGraph-like systems focus on event-sourced runtimes for auditable autonomous agents; Loom focuses on a local-first AI browser/runtime for reusable human-AI knowledge. It is not trying to become a pure event-sourced orchestration framework. Product clarity, local ownership, and human-in-the-loop workflows come first.

## Foundation

Completed or locked foundations:

- Loom, Weft, Response, Reference, Bookmark, History, and Window concepts
- Quick Ask as a lightweight AI-native ask/search surface
- Weft as a Loom with origin linkage and clean visible transcript semantics
- split/full Weft navigation and hidden Weft origin context
- Address Bar for lookup, navigation, and free-text Loom creation
- Graph projection for Loom, Weft, Reference, Bookmark, attachment, and provenance relationships
- Rust `loom-service` as authoritative product runtime
- SQLite local-first canonical store
- ContextManager with budget planning, recent response windows, explicit Reference priority, saved Memory handling, Weft origin handling, and retrieval diagnostics
- Response code block extraction, Response parts, tags, topic index, capsules, checkpoints, and graph links
- explicit References and attachment chips as context controls
- provenance/retrieval lineage diagnostics for context reconstruction
- attachment metadata, local raw blob storage, parsed content storage, chunking, compression, checksum dedupe, and parser-version-aware reuse
- text, Markdown, JSON, XML, CSV, selectable PDF, DOCX, and bounded XLSX attachment parsing
- PDF density classification for `text_pdf`, `scanned_pdf`, `mixed_pdf`, and `empty_or_unsupported`
- SQLite FTS retrieval projection and FTS candidate integration under ContextManager policy
- local Speech-to-Text boundary, no-speech detection, and packaged runtime validation
- packaged macOS arm64 Electron app with bundled Rust sidecar and userData-backed DB/config

## Active Roadmap

Near implementation tasks:

- `OCR-PAGE-RANGE-PIPELINE-001`: optional local Tesseract OCR for PDF pages classified as OCR-needed, with page-range processing and no cloud OCR
- `ATTACHMENT-BLOB-GC-POLICY-001`: define safe garbage collection for shared blobs and parsed artifacts without breaking Loom-scoped attachment rows
- `RELEASE-SELECTIVE-COMMIT-001`: commit intended release work without generated artifacts, local DBs, or unrelated changes
- runtime setup UX for Ollama, local Speech-to-Text, and OCR provider detection
- retrieval tuning based on diagnostics, source priority, and query intent
- Quick Ask promotion paths into Looms, References, Bookmarks, and Wefts
- graph lineage exploration for References, attachment usage, retrieval decisions, and Weft origins
- release hygiene for signed/notarized macOS distribution

Product polish:

- retrieval inspection surfaces that show why context was selected
- provenance visualization for explicit References, attachment lineage, graph links, and retrieval candidates
- replay diagnostics UI for Quick Ask and Main composer context construction
- attachment status UX for parse, OCR-needed, OCR-running, ready, failed, and unsupported states
- source browser/search improvements for All, Files, References, Responses, Code, Bookmarks, and History
- clearer runtime/provider setup guidance when local engines are missing

## Near Future

Likely next product layers:

- image OCR as text extraction only, separate from image understanding
- search UX over Looms, Responses, References, Bookmarks, Memories, and attachment chunks
- structured diff between Looms and Wefts
- replay diagnostics UI for orchestration, context construction, and retrieval decisions
- Quick Ask evolution as an AI-native Spotlight/omnibox surface with explicit promotion into durable objects
- graph lineage exploration across Looms, Wefts, References, Bookmarks, attachments, and retrieval records
- attachment semantic search over parsed chunks and summaries
- attachment lineage showing where a file was referenced, parsed, reused, and included in context
- better Weft comparison, return-to-origin, and fork provenance displays
- local data controls for export, archive, delete, cache cleanup, and blob GC

## Long-Term Research

Research directions that fit Loom if they preserve local-first and inspectable behavior:

- vector embeddings as an optional retrieval layer alongside SQLite FTS, never as the only memory source
- CortexMem-style progressive memory levels: capsules, summaries, checkpoints, exact snippets, and detail expansion only when needed
- semantic structural diff between Looms, Wefts, Responses, and attachment revisions
- local multimodal runtimes for image understanding after OCR/text extraction is supported and clearly labeled
- event lineage explorer for Quick Ask turns, workflow runs, context builds, parser jobs, retrieval decisions, and Weft forks
- replay/fork visualizations that make provenance, graph evolution, and retrieval lineage visible without overwhelming normal use

Research directions to avoid unless a concrete product gap appears:

- adopting a generic agent framework as the core product model
- becoming a fully autonomous black-box orchestration substrate
- reducing Loom to chat branching or token-tree exploration
- replacing ContextManager with opaque vector memory
- adding dependency-heavy memory frameworks before Loom-native patterns are exhausted
- cloud OCR or cloud sync as a default assumption

## Contributor Roadmap

Contributor work should keep Loom on a product-first path: make AI work addressable, navigable, replayable, and local before adding broader runtime abstractions.

Near-term contributor priorities:

- make retrieval decisions easier to inspect and replay
- make graph lineage useful without turning the UI into an agent-runtime debugger
- keep Quick Ask lightweight while preserving promotion paths into durable Loom objects
- harden local runtime setup and provider health guidance
- improve attachment lifecycle management, including blob/artifact cleanup
- keep release packaging reproducible and free of generated/local data
- expand parser/OCR capability only behind clear local capability boundaries

Contributor principles:

- SQLite remains the canonical local store.
- ContextManager remains the authority for prompt context policy.
- Explicit References and active attachment chips beat implicit retrieval.
- Attachments are Loom-scoped, even when raw blobs and parsed artifacts are deduped.
- Retrieval must remain inspectable and diagnosable.
- Graph projections should clarify provenance and navigation, not hide business logic in UI components.
- Quick Ask should remain lightweight and human-controlled unless a user explicitly promotes its output.
- Raw model thinking/internal monologue must never be persisted, indexed, exported, summarized, or re-injected.
- Local-first is the default; cloud providers and sync must be explicit future choices.
- Derived artifacts should be rebuildable from canonical records when feasible.
- Event/log records should improve provenance and replay, not turn Loom into an abstract agent runtime.
- Avoid dependency creep. Add external frameworks only when a proven product gap cannot be solved cleanly in Loom.
- Product UX matters as much as infrastructure.

## Remaining Gaps

Important gaps before broader release:

- user-facing runtime setup for Ollama, local Speech-to-Text, and OCR
- signed and notarized macOS distribution
- release CI and artifact policy cleanup
- attachment blob/artifact garbage collection
- retrieval inspection UI
- graph lineage and provenance visualization
- Quick Ask promotion and replay diagnostics
- local data management settings
- stronger import/export and backup story
- Windows and Linux packaging after macOS arm64 is stable
