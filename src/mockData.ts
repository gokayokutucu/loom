import type {
  AddressSuggestion,
  BookmarkItem,
  Conversation,
  HistoryEntry,
  ResponseItem,
} from "./types";

export const conversations: Conversation[] = [
  {
    id: "c-architecture",
    title: "Loom AI navigation architecture",
    path: "loom://loom-ai/navigation-architecture",
    folder: "Product systems",
    summary: "Browser-first navigation model, addresses, and lifecycle rules.",
    iconKey: "compass",
    pinned: true,
    unread: true,
  },
  {
    id: "c-research",
    title: "Research synthesis workflow",
    path: "loom://research/synthesis-workflow",
    folder: "Research",
    summary: "How to reuse model answers across literature review sessions.",
    iconKey: "book-open",
    pinned: true,
  },
  {
    id: "c-prompts",
    title: "Prompt reuse library for long-form launch narratives and reusable context",
    path: "loom://prompts/reuse-library",
    folder: "Writing",
    summary: "Reusable prompts and prior answers for long-form drafting.",
    iconKey: "sparkles",
  },
  {
    id: "c-security",
    title: "Security review Looms",
    path: "loom://engineering/security-review",
    folder: "Engineering",
    summary: "Threat modeling and mitigation Q+A history.",
    iconKey: "shield",
  },
  {
    id: "c-launch",
    title: "Launch narrative options",
    path: "loom://go-to-market/launch-narrative",
    folder: "Product systems",
    summary: "Positioning experiments for the V1 release.",
    iconKey: "rocket",
  },
  {
    id: "c-onboarding",
    title: "Onboarding questions and first-run browser flow",
    path: "loom://product/onboarding-browser-flow",
    folder: "Product systems",
    summary: "First-run moments and empty-state prompts for new users.",
    iconKey: "lightbulb",
  },
  {
    id: "c-bookmarks",
    title: "Bookmark interaction polish",
    path: "loom://product/bookmark-interaction-polish",
    folder: "Product systems",
    summary: "Saved destinations, hover affordances, and right-click actions.",
    iconKey: "book-open",
  },
  {
    id: "c-graph-map",
    title: "Graph view as secondary site map",
    path: "loom://product/graph-view-site-map",
    folder: "Product systems",
    summary: "Graph mode boundaries and navigation back to browser mode.",
    iconKey: "network",
  },
  {
    id: "c-browser-shell",
    title: "Browser shell keyboard navigation model",
    path: "loom://product/browser-shell-keyboard-navigation",
    folder: "Product systems",
    summary: "Back, forward, address focus, and menu keyboard behaviors.",
    iconKey: "terminal",
  },
  {
    id: "c-memory",
    title: "Semantic memory ranking experiments",
    path: "loom://research/semantic-memory-ranking",
    folder: "Research",
    summary: "Search ranking tests for personal AI web destinations.",
    iconKey: "brain",
  },
  {
    id: "c-citations",
    title: "Citation reuse and provenance review",
    path: "loom://research/citation-provenance-review",
    folder: "Research",
    summary: "How selected text, references, and sources move into prompts.",
    iconKey: "flask",
  },
  {
    id: "c-drafts",
    title: "Draft writing workspace comparisons",
    path: "loom://writing/draft-workspace-comparisons",
    folder: "Writing",
    summary: "Long-form writing flows with reusable conversation references.",
    iconKey: "palette",
  },
  {
    id: "c-integrations",
    title: "MCP and plugin integration notes",
    path: "loom://engineering/mcp-plugin-integration",
    folder: "Engineering",
    summary: "Future host shell integration and extension boundaries.",
    iconKey: "puzzle",
  },
  {
    id: "c-privacy",
    title: "Private local address resolution",
    path: "loom://engineering/private-address-resolution",
    folder: "Engineering",
    summary: "Local-first addressing and resolver trust boundaries.",
    iconKey: "lock",
  },
  {
    id: "c-release",
    title: "Release checklist for V1 conversation browser",
    path: "loom://go-to-market/v1-release-checklist",
    folder: "Product systems",
    summary: "Launch readiness tasks and V1 quality bar.",
    iconKey: "target",
  },
  {
    id: "c-support",
    title: "Support workflows for broken references",
    path: "loom://support/broken-reference-workflows",
    folder: "Engineering",
    summary: "Recovery states for archived and deleted conversation links.",
    iconKey: "shield",
  },
];

export const responsesByConversation: Record<string, ResponseItem[]> = {
  "c-architecture": [
    {
      id: "r-address-bar",
      title: "Address Bar as local AI web navigator",
      address: "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar",
      question:
        "How should the address bar work if Loom AI is a browser for conversations?",
      answer: [
        "Treat the Address Bar as the user's primary orientation device. It should accept a Loom address, a natural-language query, or the title of a remembered answer without forcing the user to choose a search mode first.",
        "The result list should feel closer to browser autocomplete than a database search table. Each row needs a destination type, a readable title, a path, and a confidence cue such as Recent, Semantic, or Bookmark.",
        "The important design constraint is that search and navigation are not separate products. Typing is already the act of asking where to go next inside the user's personal AI web.",
      ],
      suggestedLinks: [
        {
          id: "s-semantic-memory",
          type: "semantic",
          title: "Semantic memory ranking",
          path: "loom://research/synthesis-workflow/loom/search/r-ranking",
          badge: "Suggested",
        },
      ],
      bookmarkedLinks: [
        {
          id: "p-inline-references",
          type: "response",
          title: "Inline reference composition rules",
          path: "loom://loom-ai/navigation-architecture/loom/composer/r-inline-references",
          badge: "Linked",
        },
      ],
      bookmarked: true,
    },
    {
      id: "r-archive-delete",
      title: "Archive is a browser close, delete is destructive",
      address: "loom://loom-ai/navigation-architecture/loom/lifecycle/r-archive-delete",
      question:
        "What should happen when someone closes a conversation tab?",
      answer: [
        "Closing a conversation tab should archive it, not delete it. The behavior should mirror closing a browser tab: the workspace becomes less crowded, but the destination remains recoverable through history, bookmarks, archive, and direct address navigation.",
        "Permanent delete belongs behind a kebab menu and must explain that existing Loom references may become unreachable. Since Loom turns responses into addressable objects, deletion is not just cleanup; it can break navigation.",
      ],
      suggestedLinks: [
        {
          id: "s-broken-links",
          type: "loom",
          title: "Broken reference recovery",
          path: "loom://engineering/security-review/loom/data-trust",
          badge: "Suggested",
        },
      ],
      bookmarkedLinks: [],
    },
    {
      id: "r-composer",
      title: "Hypertext composer beats copy-paste",
      address: "loom://loom-ai/navigation-architecture/loom/composer/r-inline-references",
      question:
        "How should prompt composition work when users reuse prior answers?",
      answer: [
        "The composer should accept saved destinations and linked responses directly inside the prompt surface. A user can drop a bookmark into the prompt, insert a response through Link, and then write ordinary prose around those references.",
        "The canonical representation can serialize to Markdown links, but the visual layer should stay richer: chips should show the title, object type, and provenance so the user knows exactly what they are bringing into the prompt.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [
        {
          id: "p-bookmarking",
          type: "bookmark",
          title: "Bookmark reuse behavior",
          path: "loom://prompts/reuse-library/bookmarks/reusable-context",
          badge: "Linked",
        },
      ],
    },
  ],
  "c-research": [
    {
      id: "r-synthesis",
      title: "Research answers need durable destinations",
      address: "loom://research/synthesis-workflow/loom/revisitability/r-synthesis",
      question: "Why does research work benefit from Loom addresses?",
      answer: [
        "Research conversations frequently produce answers that are useful days later. A stable destination lets the user revisit the exact reasoning without scrolling through a transcript or copying fragments into a notes app.",
        "The browsing model is especially valuable when a later prompt needs multiple prior answers. Instead of pasting text, the user composes with links and preserves provenance.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
      bookmarked: true,
    },
  ],
  "c-prompts": [
    {
      id: "r-library",
      title: "Prompt patterns as reusable bookmarks",
      address: "loom://prompts/reuse-library/loom/patterns/r-library",
      question: "How should prompt reuse appear in the UI?",
      answer: [
        "Prompt patterns should appear as saved destinations, not static snippets. The user should be able to drag them into the composer alongside prior responses and Looms.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-security": [
    {
      id: "r-threats",
      title: "Data trust and broken reference handling",
      address: "loom://engineering/security-review/loom/data-trust/r-threats",
      question: "What breaks when references are deleted?",
      answer: [
        "Deleted objects can leave unresolved Loom references. The UI should show a clear broken-reference state and avoid silent disappearance.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-launch": [
    {
      id: "r-positioning",
      title: "The browser metaphor is the launch hook",
      address: "loom://go-to-market/launch-narrative/loom/v1/r-positioning",
      question: "What is the shortest V1 product promise?",
      answer: [
        "Navigate, search, bookmark, link, and revisit AI conversations like a browser.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
      bookmarked: true,
    },
  ],
  "c-onboarding": [
    {
      id: "r-empty-start",
      title: "Empty start should feel like a browser search surface",
      address: "loom://product/onboarding-browser-flow/loom/empty-state/r-empty-start",
      question: "How should a new Loom begin before there is a transcript?",
      answer: [
        "The new conversation state should feel closer to a focused browser/search page than a blank chat log. The composer can sit centered until the first ask materializes the Loom.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "r-first-reference",
      title: "First reference teaches the web model",
      address: "loom://product/onboarding-browser-flow/loom/references/r-first-reference",
      question: "What should the first reusable reference teach?",
      answer: [
        "The first inserted reference should show that prior answers are destinations, not pasted text. It should remain lightweight and clearly removable.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-bookmarks": [
    {
      id: "r-bookmark-panel",
      title: "Bookmark panel as saved destinations",
      address: "loom://product/bookmark-interaction-polish/loom/panel/r-bookmark-panel",
      question: "How should bookmarks feel in Loom AI?",
      answer: [
        "Bookmarks should behave like browser destinations with stable titles, readable paths, right-click menus, and drag-to-reference behavior.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "r-bookmark-card-actions",
      title: "Bookmark cards keep actions off the content",
      address: "loom://product/bookmark-interaction-polish/loom/cards/r-bookmark-card-actions",
      question: "Where should bookmark actions live?",
      answer: [
        "Primary reading metadata belongs in the card body. Destructive actions should stay in a compact rail or context menu so the destination remains scannable.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-graph-map": [
    {
      id: "r-site-map",
      title: "Graph view is a secondary site map",
      address: "loom://product/graph-view-site-map/loom/site-map/r-site-map",
      question: "What is Graph View for?",
      answer: [
        "Graph View should help users inspect relationships and return to browser mode. It is not the primary work surface.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "r-evidence-map",
      title: "Evidence map can reveal provenance clusters",
      address: "loom://product/graph-view-site-map/loom/evidence/r-evidence-map",
      question: "How should evidence clusters appear?",
      answer: [
        "Evidence clusters should remain readable as a site map, highlighting source relationships without turning the main app into a mind map.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-browser-shell": [
    {
      id: "r-shell-shortcuts",
      title: "Browser shell keyboard shortcuts",
      address: "loom://product/browser-shell-keyboard-navigation/loom/shortcuts/r-shell-shortcuts",
      question: "Which shortcuts make Loom feel browser-native?",
      answer: [
        "Back, Forward, Address Bar focus, and context menu shortcuts should follow browser expectations while remaining scoped to Loom destinations.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "r-history-menu",
      title: "Right-click history menus build confidence",
      address: "loom://product/browser-shell-keyboard-navigation/loom/history-menu/r-history-menu",
      question: "Why should Back and Forward have menus?",
      answer: [
        "Right-click history menus let users inspect where they will go before navigating. This is critical when destinations are responses and Loom branches.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-memory": [
    {
      id: "r-ranking",
      title: "Semantic ranking needs browser confidence",
      address: "loom://research/semantic-memory-ranking/loom/ranking/r-ranking",
      question: "How should semantic matches appear in the omnibox?",
      answer: [
        "Semantic results should look navigable and accountable: type, title, path, and confidence badge all matter.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "r-recency",
      title: "Recency is a navigation signal",
      address: "loom://research/semantic-memory-ranking/loom/recency/r-recency",
      question: "How does recent activity affect search?",
      answer: [
        "Recent destinations should rank as browser memory, not as a separate database filter.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-citations": [
    {
      id: "r-provenance",
      title: "Selected text becomes a reusable reference",
      address: "loom://research/citation-provenance-review/loom/selection/r-provenance",
      question: "How should selected text move into composition?",
      answer: [
        "Selected text can become an attached Loom reference without forcing it into the sentence body. Provenance stays visible and removable.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "r-citation-audit",
      title: "Citation audit trails stay addressable",
      address: "loom://research/citation-provenance-review/loom/audit/r-citation-audit",
      question: "How should citation audits be revisited?",
      answer: [
        "Audit trails should remain addressable so a user can revisit why a reference entered a prompt and which answer it came from.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-drafts": [
    {
      id: "r-workspace",
      title: "Draft workspace composes from live Loom references",
      address: "loom://writing/draft-workspace-comparisons/loom/workspace/r-workspace",
      question: "How should drafting reuse prior conversations?",
      answer: [
        "A drafting workspace should accept live Loom references inline and preserve their source paths under the hood.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "r-editing-history",
      title: "Editor history must understand references",
      address: "loom://writing/draft-workspace-comparisons/loom/history/r-editing-history",
      question: "What makes undo feel natural?",
      answer: [
        "Text bursts can coalesce, but Loom reference insertion, deletion, and movement should remain distinct undo boundaries.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-integrations": [
    {
      id: "r-host-shell",
      title: "Host shell adapters keep Electron optional",
      address: "loom://engineering/mcp-plugin-integration/loom/host-shell/r-host-shell",
      question: "How should the web prototype stay Electron-ready?",
      answer: [
        "Navigation, context menus, storage, and protocol resolution should sit behind adapters so the renderer can move into Electron later.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "r-plugin-boundary",
      title: "Plugin boundary should not leak shell assumptions",
      address: "loom://engineering/mcp-plugin-integration/loom/plugin-boundary/r-plugin-boundary",
      question: "Where should plugin behavior attach?",
      answer: [
        "Plugins should attach through Loom objects and host adapters, not by taking over the browser shell.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-privacy": [
    {
      id: "r-local-resolution",
      title: "Local address resolution protects private memory",
      address: "loom://engineering/private-address-resolution/loom/local/r-local-resolution",
      question: "How should Loom addresses resolve privately?",
      answer: [
        "The resolver should prefer local state and explicit user action before any external lookup.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-release": [
    {
      id: "r-release-risk",
      title: "Release checklist needs broken-reference coverage",
      address: "loom://go-to-market/v1-release-checklist/loom/risk/r-release-risk",
      question: "What must be tested before launch?",
      answer: [
        "Archive, restore, delete warnings, broken references, Back/Forward, and bookmarked destinations need full lifecycle coverage.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
  "c-support": [
    {
      id: "r-recovery",
      title: "Broken reference recovery should explain next steps",
      address: "loom://support/broken-reference-workflows/loom/recovery/r-recovery",
      question: "What should users see when a reference breaks?",
      answer: [
        "The UI should explain whether the target was archived, deleted, or moved, and offer recovery paths where possible.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "r-restore-paths",
      title: "Archive restore keeps destinations intact",
      address: "loom://support/broken-reference-workflows/loom/archive/r-restore-paths",
      question: "How should archive restoration behave?",
      answer: [
        "Restoring from archive should bring the conversation back without changing its address or breaking existing Loom references.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
  ],
};

export const bookmarks: BookmarkItem[] = [
  {
    id: "b-address",
    type: "response",
    title: "Address Bar as local AI web navigator",
    editableTitle: "Address Bar navigator rules",
    path: "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar",
    badge: "Response",
    lastUsed: "Used 12 min ago",
  },
  {
    id: "b-composer",
    type: "response",
    title: "Hypertext composer beats copy-paste",
    editableTitle: "Inline reference composition model",
    path: "loom://loom-ai/navigation-architecture/loom/composer/r-inline-references",
    badge: "Response",
    lastUsed: "Used today",
  },
  {
    id: "b-research",
    type: "loom",
    title: "Research answers need durable destinations",
    editableTitle: "Research revisitability loom",
    path: "loom://research/synthesis-workflow/loom/revisitability",
    badge: "Weft",
    lastUsed: "Yesterday",
  },
  {
    id: "b-launch",
    type: "conversation",
    title: "Launch narrative options",
    editableTitle: "V1 launch promise",
    path: "loom://go-to-market/launch-narrative",
    badge: "Loom",
    lastUsed: "Apr 24",
  },
];

export const initialHistory: HistoryEntry[] = [
  {
    id: "h-1",
    type: "response",
    title: "Address Bar as local AI web navigator",
    path: "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar",
    visitedAt: "Now",
  },
  {
    id: "h-2",
    type: "conversation",
    title: "Research synthesis workflow",
    path: "loom://research/synthesis-workflow",
    visitedAt: "14 min ago",
  },
  {
    id: "h-3",
    type: "loom",
    title: "Inline reference composition rules",
    path: "loom://loom-ai/navigation-architecture/loom/composer",
    visitedAt: "22 min ago",
  },
  {
    id: "h-4",
    type: "bookmark",
    title: "V1 launch promise",
    path: "loom://go-to-market/launch-narrative",
    visitedAt: "Yesterday",
  },
];

export const addressSuggestions: AddressSuggestion[] = [
  {
    id: "a-1",
    type: "conversation",
    title: "Loom AI navigation architecture",
    subtitle: "Loom",
    path: "loom://loom-ai/navigation-architecture",
    badge: "Recent",
    iconLabel: "Loom",
  },
  {
    id: "a-2",
    type: "response",
    title: "Address Bar as local AI web navigator",
    subtitle: "Q+A item in Browser loom",
    path: "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar",
    badge: "Bookmark",
    iconLabel: "Response",
  },
  {
    id: "a-3",
    type: "bookmark",
    title: "Inline reference composition model",
    subtitle: "Saved destination",
    path: "loom://loom-ai/navigation-architecture/loom/composer/r-inline-references",
    badge: "Bookmark",
    iconLabel: "Bookmark",
  },
  {
    id: "a-4",
    type: "semantic",
    title: "Search and navigation are the same action",
    subtitle: "Semantic match from response body",
    path: "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar",
    badge: "Semantic",
    iconLabel: "Semantic",
  },
  {
    id: "a-5",
    type: "recent",
    title: "Research synthesis workflow",
    subtitle: "Recent destination",
    path: "loom://research/synthesis-workflow",
    badge: "Recent",
    iconLabel: "Recent",
  },
];
