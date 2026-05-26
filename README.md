# Loom — Your Personal AI Web

<p align="center">
  <img src="public/loom_logo.png" alt="Loom logo" width="96" />
</p>

<p align="center">
  <strong>Build your personal web from AI conversations.</strong>
</p>

<p align="center">
  Loom turns AI conversations into an addressable, navigable, replayable personal web for reusable AI knowledge.
</p>

<p align="center">
  <!-- Badges: build status, release artifact, license -->
</p>

<p align="center">
  <!-- Loom hero demo video -->
  <!-- Add a short product walkthrough once public media is ready. -->
</p>

<p align="center">
  <!-- Loom demo GIF preview -->
</p>

Loom turns conversations with AI into reusable, addressable knowledge instead of disposable chat history. Instead of losing answers inside long transcripts, you can browse them, ask across them, reference them, branch from them, attach local files, inspect retrieval lineage, and reconstruct why a model saw a piece of context.

It is not a hosted SaaS, not a generic chat UI, not just RAG, and not an opaque memory wrapper. Loom is built around explicit context, provenance, graph navigation, and local ownership.

## What Loom Is

**Looms** are addressable spaces for AI work. A Loom contains Responses, References, Wefts, attachments, and retrieval history.

**Wefts** are exploration branches. They let an idea split into a new path while preserving origin context without copying hidden seed rows into the visible transcript.

**Quick Ask** is the lightweight ask/search surface. It behaves more like an AI-native Spotlight or browser omnibox than a full transcript: fast, contextual, and ephemeral until you promote useful output into a Loom, Reference, or Weft.

Quick Ask reduces context inflation. Instead of reopening giant conversations and replaying the same context, you can branch from exactly where the idea already exists. Ask lightweight contextual questions, then promote only the useful results into Looms, References, or Wefts when they become important.

**References** make prior work reusable. A Response can be referenced in a new prompt, keeping provenance attached instead of relying on copy and paste.

**Attachments** are local files you explicitly add as context. Parsed content is stored separately, chunked, deduped, and included only when you activate the attachment chip.

**Graph** makes Loom non-linear. It connects Looms, Wefts, Responses, References, Bookmarks, attachments, retrieval lineage, and provenance so AI work can be explored as a navigable knowledge graph instead of disposable chat history.

**ContextManager** is Loom's context authority. It decides how recent conversation, explicit References, attachments, memories, Weft origin context, and retrieval candidates fit into the prompt budget.

**Local runtime** means the app stores its data locally through `loom-service`, uses SQLite as the canonical store, and currently runs model requests through user-controlled local runtime setup such as Ollama.

## Screenshots and Media

<!-- Screenshot: Address Bar navigation -->

<!-- Screenshot: Quick Ask lightweight lookup -->

<!-- Screenshot: Weft split/full exploration -->

<!-- Screenshot: Graph lineage and provenance -->

<!-- Screenshot: Attachment chips and explicit context -->

<!-- Screenshot: Retrieval diagnostics / provenance view -->

<!-- GIF: Create a Weft from a Response -->

## Core Features

- Address Bar navigation for Looms, Wefts, Responses, Bookmarks, and free-text Loom creation.
- Quick Ask for lightweight ask/search/lookup flows that stay ephemeral until promoted.
- Reusable context through Wefts, References, attachments, and retrieval lineage instead of repeatedly replaying large transcripts.
- Weft-based exploration with hidden origin context and clean visible transcript semantics.
- Graph navigation across Looms, Wefts, References, Bookmarks, attachments, and provenance links.
- Explicit `#` References for composing new prompts from prior Responses.
- Attachment-aware context for local text and document artifacts.
- Local parsing for `txt`, `md`, `json`, `xml`, `csv`, selectable `pdf`, `docx`, and bounded `xlsx`.
- PDF density classification for text PDFs, scanned PDFs, mixed PDFs, and unsupported/empty PDFs.
- OCR-ready architecture for scanned PDF pages through an optional local Tesseract-style pipeline.
- SQLite + FTS retrieval as an inspectable candidate layer under ContextManager policy.
- Retrieval diagnostics designed for replayable provenance, attachment lineage, and context reconstruction.
- Graph exploration for understanding how Looms, Wefts, References, attachments, and retrieval decisions connect together.
- Packaged Electron desktop app with bundled Rust `loom-service` sidecar.
- Ollama-backed local model support when Ollama and a model are installed.
- Local Speech-to-Text flows where runtime and model setup are available.

## Why Loom Exists

Most AI interfaces still treat conversations as disposable linear transcripts:

- useful answers are hard to revisit
- branches lose their origin
- context selection is hidden
- memory becomes opaque
- files are either ignored or dumped into prompts without provenance
- graph relationships between ideas and artifacts disappear
- users repeatedly re-explain the same context
- retrieval and memory become impossible to inspect
- token usage grows because conversations cannot be reused structurally

Loom treats AI work as a local web of reusable artifacts:

- every answer can become a destination
- every Response can be referenced, bookmarked, and reused
- every Weft can branch while staying connected to its origin
- every attachment can be explicit context instead of silent background data
- every Quick Ask can stay temporary or become a reusable object when it matters
- every graph edge can preserve where an idea, file, Reference, or retrieval result came from
- conversations become reusable context instead of repeatedly replayed transcripts
- Wefts let you continue from the exact point where an idea already exists
- retrieval can reuse structured artifacts instead of re-inflating entire histories

The goal is not to automate the user out of the loop.

> Chat apps optimize for conversations. Loom optimizes for continuity.
The system is designed to reduce context waste by turning AI work into reusable, addressable artifacts instead of repeatedly rebuilding the same context window from scratch.

The goal is to make serious AI work navigable.

## Architecture

Loom is intentionally small at the top level:

- **Electron + React + TypeScript** for the desktop interface.
- **Rust `loom-service`** as the product runtime boundary.
- **SQLite** as the canonical local store.
- **ContextManager** as the policy authority for prompt assembly.
- **SQLite FTS** as a local retrieval candidate layer.
- Retrieval lineage and provenance diagnostics for reconstructable context assembly.
- **Attachment pipeline** for local blob storage, parsing, chunking, dedupe, and parser metadata.
- **Graph projection** for Loom, Weft, Reference, Bookmark, attachment, and provenance relationships.
- **Ollama** as the current external local model runtime.

Loom uses a hybrid store: normalized SQLite domain records plus event/log-style records where they help with provenance, replay, diagnostics, and reconstruction. It shares lineage/replay/provenance ideas with event-centric systems, but remains a UX-first, human-in-the-loop AI browser/runtime rather than a pure reactive agent runtime.

## Local-First Philosophy

Local-first is not just a deployment model. It is a product boundary.

Your conversations, references, provenance graph, retrieval history, and reusable context remain inspectable and user-owned.

Loom is designed around local ownership:

- no cloud dependency is required for the core app
- Loom data lives in local SQLite
- packaged desktop builds use Electron `userData`, not repository dev paths
- Ollama remains an external local runtime for now
- memory and retrieval are explicit and inspectable
- graph/provenance records are local and user-owned
- raw model thinking is not persisted, indexed, exported, summarized, or re-injected

Cloud sync, hosted collaboration, and cloud OCR are not claimed or implemented.

## Current Capabilities

Implemented:

- Loom, Weft, Response, Reference, Bookmark, History, and Window concepts.
- Address Bar lookup, navigation, and new Loom creation.
- Quick Ask lightweight contextual ask/search flow.
- Graph view for navigating Loom relationships and provenance-oriented links.
- Weft origin context without visible transcript pollution.
- Rust `loom-service` runtime with SQLite persistence.
- Explicit Reference and attachment-chip context.
- Attachment parsing for `txt`, `md`, `json`, `xml`, `csv`, selectable `pdf`, `docx`, and bounded `xlsx`.
- Attachment chunking, compression, checksum dedupe, and parser-version-aware reuse.
- SQLite FTS schema and retrieval integration under ContextManager.
- macOS arm64 packaged Electron app and DMG flow.
- Ollama/local model support when configured.

Not yet:

- bundled model runtime
- full OCR as a bundled runtime
- general image understanding
- cloud sync
- vector embeddings
- Windows/Linux packaging
- notarized macOS release

## Development Setup

Install dependencies:

```sh
npm install
```

Run the web development app:

```sh
npm run dev
```

Run Electron in development:

```sh
npm run electron:dev
```

Run Rust service checks:

```sh
npm run service:check
npm run service:test
```

Build the frontend:

```sh
npm run build
```

Ollama remains external. To use local model features, install Ollama separately, install a supported model, then verify provider status inside Loom Settings.

## Packaging

Loom currently targets macOS arm64 first.

Build a packaged app:

```sh
npm run electron:package:mac:arm64
```

Output:

```text
dist-electron/Loom.app
```

Create a DMG:

```sh
npm run electron:dist:mac:arm64
```

Output:

```text
release/Loom-0.1.0-mac-arm64.dmg
```

The packaged app includes the Rust sidecar at:

```text
Loom.app/Contents/Resources/loom-service/loom-service
```

Packaged app data is stored under Electron user data:

```text
~/Library/Application Support/loom-ai/loom-service/
```

## Roadmap

Short-term:

- optional local OCR for scanned PDF page ranges
- attachment blob/artifact garbage collection
- retrieval inspection and replay diagnostics UI
- Quick Ask promotion and provenance polish
- Graph lineage exploration for References, attachments, and retrieval decisions
- release hygiene and macOS signing/notarization
- runtime onboarding polish for Ollama, local Speech-to-Text, and OCR

Longer-term:

- image OCR as text extraction, separate from image understanding
- semantic diff between Looms and Wefts
- provenance visualization and replay/fork visualization
- structural and semantic Weft diffing
- graph-aware retrieval inspection
- optional local vector embeddings
- local multimodal runtimes when capability boundaries are clear

See [docs/product/roadmap.md](docs/product/roadmap.md) for the detailed product and contributor roadmap.

## Contributing

Loom is product-first infrastructure. Contributions should preserve these boundaries:

- SQLite remains the canonical local store.
- ContextManager owns prompt context policy, budgets, and diagnostics.
- Explicit References and attachment chips outrank implicit retrieval.
- Attachments are Loom-scoped, even when blobs and parsed artifacts are deduped.
- Retrieval should stay inspectable and diagnosable.
- Context reuse and provenance are product-level features, not implementation details.
- Raw model thinking must never be persisted or re-used as future context.
- Local-first behavior is the default.
- Avoid dependency creep; add frameworks only after a concrete product gap is proven.
- Product UX matters as much as runtime architecture.

Before opening changes, run the relevant checks:

```sh
npm run build
git diff --check
```

Service/runtime changes should also run the Rust and service checks described in the project docs.

## Example Flow

1. Ask a question in Quick Ask.
2. Promote the useful answer into a Loom.
3. Create a Weft from a specific Response.
4. Attach local files as explicit context.
5. Reuse prior Responses through References.
6. Explore how ideas connect through Graph.

## License

Loom is source-available under the Business Source License (BUSL).

Commercial licensing will be available separately.

This repository is not open source.

You may:
- view the source
- modify it
- use it personally or internally

You may NOT:
- offer Loom as a hosted commercial service
- resell Loom
- build competing commercial products from Loom without permission
