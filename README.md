# Loom

<p align="center">
  <img src="public/loom_logo.png" alt="Loom logo" width="96" />
</p>

<p align="center">
  <strong>Build your personal web from AI conversations.</strong>
</p>

<p align="center">
  Loom turns AI conversations into an addressable, navigable, replayable personal web.
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

Loom is a local-first AI runtime and desktop app for turning useful AI work into durable knowledge objects. Instead of losing answers inside long transcripts, you can browse them, ask across them, reference them, branch from them, attach local files, and reconstruct why a model saw a piece of context.

It is not a hosted SaaS, not a generic chat UI, not just RAG, and not an opaque memory wrapper. Loom is built around explicit context, provenance, graph navigation, and local ownership.

## What Loom Is

**Looms** are addressable spaces for AI work. A Loom contains Responses, References, Wefts, attachments, and retrieval history.

**Quick Ask** is the lightweight ask/search surface. It behaves more like an AI-native Spotlight or browser omnibox than a full transcript: fast, contextual, and ephemeral until you promote useful output into a Loom, Reference, or Weft.

**Wefts** are exploration branches. They let an idea split into a new path while preserving origin context without copying hidden seed rows into the visible transcript.

**References** make prior work reusable. A Response can be referenced in a new prompt, keeping provenance attached instead of relying on copy and paste.

**Attachments** are local files you explicitly add as context. Parsed content is stored separately, chunked, deduped, and included only when you activate the attachment chip.

**Graph** makes Loom non-linear. It connects Looms, Wefts, Responses, References, Bookmarks, attachments, and retrieval lineage so AI work can be navigated as knowledge, not just scrolled as chat.

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
- Weft-based exploration with hidden origin context and clean visible transcript semantics.
- Graph navigation across Looms, Wefts, References, Bookmarks, attachments, and provenance links.
- Explicit `#` References for composing new prompts from prior Responses.
- Attachment-aware context for local text and document artifacts.
- Local parsing for `txt`, `md`, `json`, `xml`, `csv`, selectable `pdf`, `docx`, and bounded `xlsx`.
- PDF density classification for text PDFs, scanned PDFs, mixed PDFs, and unsupported/empty PDFs.
- OCR-ready architecture for scanned PDF pages through an optional local Tesseract-style pipeline.
- SQLite + FTS retrieval as an inspectable candidate layer under ContextManager policy.
- Retrieval diagnostics designed for replayable provenance, attachment lineage, and context reconstruction.
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

Loom treats AI work as a local web of reusable artifacts:

- every answer can become a destination
- every Response can be referenced, bookmarked, and reused
- every Weft can branch while staying connected to its origin
- every attachment can be explicit context instead of silent background data
- every Quick Ask can stay temporary or become a reusable object when it matters
- every graph edge can preserve where an idea, file, Reference, or retrieval result came from
- retrieval can be inspected, budgeted, and reconstructed

The goal is not to automate the user out of the loop. The goal is to make serious AI work navigable.

## Architecture

Loom is intentionally small at the top level:

- **Electron + React + TypeScript** for the desktop interface.
- **Rust `loom-service`** as the product runtime boundary.
- **SQLite** as the canonical local store.
- **ContextManager** as the policy authority for prompt assembly.
- **SQLite FTS** as a local retrieval candidate layer.
- **Attachment pipeline** for local blob storage, parsing, chunking, dedupe, and parser metadata.
- **Graph projection** for Loom, Weft, Reference, Bookmark, attachment, and provenance relationships.
- **Ollama** as the current external local model runtime.

Loom uses a hybrid store: normalized SQLite domain records plus event/log-style records where they help with provenance, replay, diagnostics, and reconstruction. It shares lineage/replay/provenance ideas with event-centric systems, but remains a UX-first, human-in-the-loop AI browser/runtime rather than a pure reactive agent runtime.

## Local-First Philosophy

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

## License

License information has not been finalized yet.
