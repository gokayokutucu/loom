# Product Positioning + V1 Scope

**Product Name**: Loom AI\
**Document Type**: Product Positioning & Scope Definition\
**Version**: Draft 1.0\
**Date**: 2026/04/27

---

## 1. Product Thesis

Loom AI starts as an **AI Conversation Browser**.

It is not positioned first as a chatbot, not first as a generic AI workspace, and not first as an AI operating system. Its initial purpose is more precise:

> **Loom AI turns linear AI chats into a navigable personal web.**

### 1.1 Document Boundary

This document defines **product positioning**, **V1 scope**, and the **top-level UX thesis** only.
It is **not** the canonical place for every detailed interaction, graph, node, window, composer, or navigation rule.

Detailed semantics and interaction rules should live in companion documents, such as:

- **Loom Graph Model** — canonical objects, edges, promotion rules, fork rules, bookmark rules, and addressability
- **Conversation Tree & Navigation Model** — sidebar tree, node types, commit-flow style lineage, Back/Forward behavior, and history semantics
- **Composer & Reference Model** — inline references, selection-derived reference chips, `#` trigger behavior, drag-to-link, undo/redo, and linked-reference synchronization
- **Interaction Patterns** — context menus, tooltips, hover actions, selection popovers, Ask flow, archive/delete behavior, and bookmark card behavior

This separation keeps the product story readable while allowing the interaction and data model to evolve without overloading the positioning document.

Users already generate a large amount of knowledge through AI conversations, but current chat interfaces trap that knowledge inside long vertical transcripts. Once a conversation grows, the user loses orientation:

- where a specific answer was given
- which answer led to which follow-up
- which response should be reused in another context
- how two different conversations relate to each other
- how to revisit or compare prior reasoning without copying and pasting fragments manually

Loom AI treats AI outputs as **addressable knowledge objects** rather than disposable text blocks.

In Loom AI:

- a **Conversation** behaves like a site
- a **Response / Q+A item** behaves like a page
- a **Bookmark** behaves like a saved destination
- **History** behaves like browser navigation memory
- **Links** connect one knowledge object to another
- a **Graph View** acts as an optional site map / reasoning map

This is why the correct primary mental model is not “threaded chat app,” but:

> **browser for AI conversations**

---

## 2. Positioning Statement

### 2.1 Primary Positioning

**Loom AI is a browser for AI conversations.**

It allows users to:

- navigate AI conversations with **Back** and **Forward**
- search conversations, looms, and Q+A items through an **Address Bar**
- save and organize reusable knowledge via **Bookmarks**
- compose new prompts by dragging addressable responses into the input area
- revisit prior reasoning through **History** and deep links
- optionally switch to a **Graph View** to inspect relationships visually

### 2.2 What Loom AI is not in V1

Loom AI V1 is **not** positioned as:

- a foundational model product
- a ChatGPT replacement based on model quality
- a full agent runtime by default
- a full AI operating system in its first release
- a generic note-taking app
- a generic knowledge base

Those may become future layers, but V1 must stay focused.

### 2.3 Long-term Direction

The longer-term trajectory can evolve in layers:

- **V1**: AI Conversation Browser
- **V2**: Personal Conversation Web
- **V3**: Extensible AI Workspace / AI OS

This layered framing is important. The first release must win by solving one painful problem clearly:

> **Users lose their place in AI conversations and cannot navigate or reuse them naturally.**

---

## 3. Core User Problem

### 3.1 Current State of AI Chat Interfaces

Most AI chat interfaces are still fundamentally linear:

- one left sidebar for chat history
- one main transcript
- one text input
- weak linking between answers
- weak revisitability
- weak cross-conversation composition

This structure works for short exchanges but breaks down for deeper usage.

### 3.2 Pain Points Loom AI Solves

Loom AI exists to solve the following concrete problems:

1. **Navigation problem**

   - Users cannot move through prior reasoning naturally.
   - They can scroll, but cannot browse.

2. **Reuse problem**

   - Users cannot easily take a good answer from one place and use it in another.
   - Copy/paste destroys structure and provenance.

3. **Addressability problem**

   - Responses are not treated as first-class, revisit-able objects.
   - There is no stable, local URL-like identity for them.

4. **Composition problem**

   - Users often want to combine multiple answers, threads, or conversations into one new question.
   - Current UIs make this clumsy.

5. **Orientation problem**

   - Long or branching AI work causes the user to lose track of what came from where.

6. **Search problem**

   - Users remember “something about that answer,” not always which conversation it was in.
   - Search needs to behave like a local search engine over the user’s AI web.

---

## 4. Target Users

Loom AI should initially focus on users who do substantial thinking with AI, not casual one-off users.

### 4.1 Primary Users

- **Software engineers**
- **Architects / technical leads**
- **Researchers**
- **Writers**
- **Product thinkers**
- **AI-heavy knowledge workers**

These users:

- branch often
- revisit answers often
- compare outputs often
- synthesize multiple responses into one follow-up
- need stable references and history

### 4.2 Secondary Users

- students
- consultants
- analysts
- power users who already use AI daily for structured tasks

### 4.3 Non-Primary Users for V1

- purely casual users asking one-off questions
- users expecting model superiority as the main value
- users uninterested in navigation, reuse, or composition

---

## 5. Product Metaphor

### 5.1 The Local Web Model

Loom AI is built on the idea that a user’s AI activity forms a **local internet**.

As the user talks to AI:

- responses accumulate
- relationships appear
- follow-ups form paths
- references form links
- titles create recognizable destinations
- history becomes meaningful

Instead of leaving this information trapped in a transcript, Loom AI exposes it as a navigable system.

### 5.2 Mapping to Browser Concepts

| Browser Concept    | Loom AI Equivalent                                              |
| ------------------ | --------------------------------------------------------------- |
| Website            | Conversation                                                    |
| Web page           | Response / Q+A item                                             |
| URL                | Loom address                                                    |
| Bookmark           | User-promoted saved destination / reusable Loom object handle    |
| Address bar        | Local search + navigation + direct addressing                   |
| Back / Forward     | AI navigation history                                           |
| History            | Loom navigation history timeline                                |
| Search suggestions | Conversations, looms, titled Q+A, bookmarks, semantic matches   |
| Site map           | Optional Graph View                                             |
| Tabs               | Conversations                                                   |
| Commit graph / branch line | Conversation tree / lineage view                        |

This metaphor is not cosmetic. It is the functional core of the UX.

---

## 6. Product Naming and Interaction Terms

### 6.1 Product Name

**Loom AI**

### 6.2 Approved Interaction Terms

- **Conversation**
- **Loom**
- **Bookmark**
- **Link**
- **Ask**
- **History**
- **Address Bar**
- **Graph View**
- **References**

### 6.3 Renamed Terms

- “Quick Ask” is renamed to **Ask**
- “Add to Thread” is renamed to **Link**

---

## 7. Core Product Model

### 7.1 Addressable Objects

Every important knowledge unit can become addressable.

The product should support addressability for at least:

- **Conversation**
- **Thread**
- **Q+A item / Response item**
- **Bookmark collection / response set**

### 7.2 Human-Friendly Identity

Every Q+A should have:

- a **semantic title**
- a **stable internal identity**
- a **resolvable Loom address**

These titles can be AI-generated initially, but the user must be allowed to edit them when bookmarked.

### 7.3 Bookmarking as Acceptance Layer

Not every AI-generated reference should become a hard reference immediately.

The acceptance model is:

1. AI may **suggest** references.
2. These appear as **suggested links**, not canonical Loom references yet.
3. The user can accept the suggestion through a **Bookmark** action.
4. Once bookmarked, the relevant Q+A or Q+A path becomes a real Loom-addressable object.
5. The generated title can then be edited by the user.

This keeps the system trustworthy.

### 7.4 Conversation Tree and Lineage Model

Loom AI should also support a **conversation tree** / **lineage view** in the sidebar.
This view should feel closer to a **commit flow** than to a generic folder tree.

Key ideas:

- a **Conversation** may start from scratch or be forked from an existing response / Loom lineage point
- a **Conversation** may link to other conversations
- a **Response** may be bookmarked and become Loom-addressable
- a **Response** may be re-linked elsewhere, creating a new reference node in another flow
- a **Quick Question** may remain ephemeral or become a durable node if promoted into a Loom/fork
- a **Thread** should be treated as a lineage/fork path rather than only a visual comment chain

The sidebar should ultimately be able to render:

- object type distinctions
- lineage / fork structure
- commit-like progression
- easy node-to-node traversal via **Back** and **Forward**

The exact node/edge/window semantics belong in a dedicated graph-model document, not fully inside this scope document.

---

## 8. V1 Product Principles

### 8.1 Browser-First, Not Tree-First

Earlier exploration considered a multi-level lineage sidebar.

The current direction is different:

- the main UX should behave like a browser
- not like a permanent visible lineage tree
- not like a mind map by default
- not like a visual canvas by default

The graph model still matters, but only as an optional mode.

### 8.2 Familiar Before Powerful

The product should feel familiar on first use.

The user should quickly understand:

- Back
- Forward
- Bookmark
- History
- Address Bar
- Tab-like conversations
- drag and drop into the prompt composer

Advanced graph behavior should be discoverable later, not mandatory on day one.

### 8.3 Hypertext Composer, Not Plain Input

The prompt input is not just a text box. It is a **rich composition surface**.

Users should be able to:

- drag bookmarks into it
- insert linked response chips
- type natural language around them
- create a new conversation or Loom branch from linked knowledge objects

The internal representation can serialize to Markdown links, but the visual UI should remain richer and safer than raw Markdown editing.

### 8.4 Optional Visualization

Graph / canvas view should exist, but as a **secondary mode**.

Default mode:

- browser-like navigation

Optional mode:

- graph-like reasoning map

---

## 9. V1 Feature Scope

This section defines the intended V1 scope.

## 9.1 V1 Core Promise

> Navigate, search, bookmark, link, and revisit AI conversations like a browser.

If V1 does this well, it is already valuable.

### 9.2 Must-Have V1 Features

#### A. Sidebar Conversation Tabs

Conversations should behave like tabs.

Requirements:

- each conversation is visible as a selectable navigation unit
- active conversation is clearly indicated
- closing a conversation via **X** does **not** delete it
- closing via X should **archive** the conversation
- permanent delete must be a separate destructive action under the **kebab menu**

Archive behavior:

- archived conversation is removed from active tab view
- it can still exist in archive/history/bookmark systems depending on policy

Delete behavior:

- user can permanently delete a conversation from kebab menu
- if deleted, address targets from that conversation may become unreachable
- the user must be warned that references pointing there may break

#### B. Back / Forward Navigation

Browser-style navigation is a core V1 feature.

Requirements:

- Back and Forward buttons live in the top bar
- they navigate between visited Loom objects / states
- right-click on Back shows previous visited destinations
- right-click on Forward shows future destinations if any
- behavior should feel close to a browser history stack

#### C. Loom History

Loom navigation history must exist as a visible feature.

Requirements:

- accessible from a top-bar button near Share
- presents linear navigation history
- supports jumping directly to prior destinations
- should work together with Back/Forward cursor behavior

#### D. Address Bar

The Address Bar is one of the most important V1 features.

It should behave like a hybrid of:

- browser omnibox
- local search engine
- direct Loom address navigator
- command/search surface

When the user types, suggestions should include:

- conversations
- looms
- titled Q+A items
- bookmarks
- semantic matches
- recent destinations

The Address Bar should support:

- direct navigation to a Loom address
- title-based matching
- semantic search over local conversation content
- autocomplete suggestions similar to a search engine experience

This is the “Perplexity-like” part of the product.

#### E. Bookmark System

Users must be able to bookmark:

- a response / Q+A item
- a response set
- a thread
- a conversation

Bookmark usage in V1:

- fast save from the UI
- list visible in a bookmark surface
- drag and drop into the prompt input dock
- titles editable by the user

AI-generated titles are allowed as a starting point, but user editing is essential.

#### F. Hypertext Prompt Composition

The prompt area should support rich inline and attached Loom references.

Requirements:

- supports drag and drop from bookmarks
- supports insertion through **Link** action
- each inserted object appears as a chip / token / rich link object
- user writes normal prompt text around or alongside these objects
- new prompt creates a new Loom continuation using those references

This is one of the highest-value differentiators in V1.

#### G. Ask Interaction

**Ask** is the fast question interaction.

Requirements:

- available on hover for a Q+A item / response item
- available in selection context when user highlights text in a response
- selection should expose an “Ask” action similar to text-selection quick actions
- clicking Ask opens a mini popup / mini modal

This mini popup supports:

- quick question
- quick response
- lightweight focused interaction without leaving the current flow

When closing the mini popup, the user can choose to:

- discard it
- convert it into a thread
- bookmark it

This is important: not every quick interaction must become permanent, but it must be possible to promote it into a durable object.

#### H. Suggested Links + Bookmark

AI-generated references should not be immediately canonical.

Requirements:

- AI may suggest references to other Q+A items, threads, or conversations
- suggested references are visually distinct from accepted Loom links
- they are not yet hard references
- user can choose **Bookmark** to convert the relevant conversation state/path into real Loom references
- Bookmark creates accepted, addressable references
- bookmarked object titles are editable by the user

This Bookmark step is a trust and curation layer.

#### I. Visual Graph View (Optional Mode)

V1 may include a secondary graph view if feasible, but it is not the primary surface.

Purpose:

- show linked Q+A items, conversations, and derived paths as connected nodes
- help power users inspect relationships visually
- act like an LMCanvas-style exploration surface

Requirements:

- accessible by explicit toggle
- not required for the core browsing experience
- clicking a node navigates back to the corresponding Loom object
- Back/Forward should still work across graph navigation when meaningful

---

## 10. Explicit Non-Goals for V1

The following should not define V1:

- full agent platform behavior by default
- full OpenClaw-like runtime identity
- plugin marketplace as a launch requirement
- automatic hard-link generation without user approval
- complex permanent visible thread trees as the primary navigation model
- replacing the underlying AI model layer
- trying to be an all-in-one productivity suite

V1 must stay sharp.

---

## 11. UI Layout Direction for V1

The current agreed direction is ChatGPT-like but browser-enhanced.

### 11.1 Main Layout

From left to right:

1. **Sidebar / Conversation Tree**

   - chat list and grouped conversations
   - archived items access
   - browser-like navigation surface
   - long-term support for a **conversation tree / lineage view** with object types
   - should feel closer to a **commit-flow sidebar** than to a plain file tree

2. **Chat Window**

   - main content area
   - user and assistant messages
   - hover actions
   - prompt composer

3. **Optional Right Panel**
   - history, archive, graph helpers, or contextual panels when needed

### 11.2 Top Bar

The bar above the chat window includes:

Left side:

- **Back**
- **Forward**

Center:

- current conversation title / location context

Right side:

- **Loom History** button
- **Share** button
- optionally bookmark or graph-view access depending on final placement

Back and Forward are not cosmetic controls. They are expected to support navigation across the conversation tree / lineage graph in a browser-like way.

### 11.3 Input Area

The input area must include:

- rich prompt input
- References control
- send action

The composer supports:

- drag/drop bookmarks
- automatic insertion through Link
- visual chip/token representation

---

## 12. Loom Addressing Model (V1 Direction)

V1 must support real addressability.

### 12.1 Addressable Targets

At minimum:

- Conversation
- Loom / fork lineage
- Q+A / Response item
- Bookmark set / response set

### 12.2 Address Philosophy

There should be a distinction between:

- **stable internal identity**
- **human-friendly readable path / display**

The system must not depend purely on mutable human-readable titles.

### 12.3 Markdown Link Representation

Markdown link syntax is considered a good **canonical text representation**.

Example:

```markdown
"[Kırmızı Benekli Alabalık](loom://baliklar-hakkinde/alabalik/thread/t3/kirmizi-benekli/r12)'larda olduğu gibi olacaksa bir de [Balık Çiflikleri](loom://denizlerde-balık-çiflikleri/levrek/thread/t5/alabalik-melezleme/r6)'nde kullanım nasıl olur. Bunu konuşalım"
```

V1 recommendation:

- users primarily interact with **visual chips / rich links**
- Markdown links serve as:
  - serialization format
  - export/import format
  - copy/paste-friendly textual representation
  - possibly model-facing representation when needed

So Markdown link usage is **approved conceptually**, but should not be the only editing surface.

---

## 13. Data Trust Model

### 13.1 AI Suggestions Are Not Automatically Truth

Loom AI must not blindly accept AI-generated references.

Rules:

- AI may suggest link targets
- system displays them as suggested links
- user acceptance is required before promotion into canonical Loom links
- Bookmark acts as acceptance/promotion action

### 13.2 User Control

Users must retain control over:

- which suggested references become real
- which titles are used
- whether a quick Ask result becomes durable
- whether a conversation is archived or deleted

---

## 14. Deletion, Archive, and Broken Reference Rules

This must be explicit because Loom relies on addressability.

### 14.1 Archive

Archive is a soft-close / soft-remove behavior.

- clicking X on a conversation tab archives it
- archive should not be treated as permanent deletion
- archived conversations may still remain resolvable unless explicitly purged

### 14.2 Delete

Delete is destructive.

- initiated from kebab menu
- should require clear confirmation
- must explain that existing references to this conversation may become unreachable

### 14.3 Unreachable References

If a conversation or item is deleted:

- reference resolution may fail
- UI should show an understandable broken-reference state
- user must not be surprised by silent disappearance

---

## 15. Search and Discovery Model in V1

Search should not be separated from navigation.

The Address Bar should act as the user’s **local search engine**.

### 15.1 Search Sources

V1 search suggestions may come from:

- conversation titles
- user-edited bookmark titles
- AI-generated Q+A titles
- Loom titles
- recent history
- semantic match against stored Q+A content

### 15.2 Search Output Quality

Autocomplete suggestions must feel strong and useful because they are central to the AI browser experience.

Suggestion rows may include:

- type icon (conversation / Loom / item / bookmark)
- title
- short subtitle or path
- recent/semantic badge if useful

---

## 16. Future Expansion Beyond V1

The following are real future directions, but not launch blockers:

### 16.1 Plugin / MCP Extensibility

Future versions may allow:

- plugins to operate on Loom objects
- MCP-powered extensions
- model-generated references using external tool resolution

### 16.2 Agentic Layer

Future versions may allow the interface to behave more like an agent workspace or OpenClaw-like environment.

### 16.3 Full AI OS Layer

Long term, Loom may evolve into:

- AI browser
- AI search engine
- AI workspace runtime
- graph-aware local knowledge operating layer

But V1 should not try to ship all of that at once.

---

## 17. V1 Summary

### 17.1 Final Positioning

**Loom AI is an AI Conversation Browser.**

It turns conversations, Loom branches, and responses into addressable, navigable objects that users can:

- browse
- search
- bookmark
- link
- revisit
- compose into new prompts

### 17.2 V1 Must Ship These Core Ideas Clearly

- browser-like Back/Forward
- tab-like conversations
- address bar with local search + suggestions
- bookmarks as reusable knowledge handles
- rich Loom references for prompt composition
- Ask for fast contextual questioning
- Bookmark for trusted promotion of AI-suggested references
- archive vs delete distinction
- optional graph mode, not primary mode

### 17.3 V1 Success Criteria

V1 is successful if users feel:

- “I can finally find my way around AI conversations.”
- “I can reuse past answers without copy-paste chaos.”
- “This feels like browsing my own AI web.”
- “I wish standard chat products worked like this.”

---

## 18. Final Strategic Note

Loom AI should begin with one sharp promise:

> **AI conversations should be navigable like the web.**

This document should remain the **north-star positioning and V1 scope document**. Detailed object semantics, conversation-tree rules, lineage behavior, and interaction contracts should be split into dedicated companion documents instead of being continuously appended here.

If this is executed cleanly, Loom AI can later grow into something much larger. But that larger vision must be earned through a strong V1, not assumed before it exists.
