import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Bot,
  Boxes,
  Brain,
  Check,
  Clock3,
  Compass,
  CornerDownLeft,
  Code2,
  Cpu,
  Database,
  Edit3,
  FileText,
  FlaskConical,
  Folder,
  GitBranch,
  GitFork,
  Globe2,
  History,
  Layers,
  Lightbulb,
  Link2,
  Lock,
  Map,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Network,
  PanelLeft,
  Palette,
  Plus,
  Puzzle,
  Rocket,
  RotateCcw,
  Search,
  Share2,
  Shield,
  Sparkles,
  Target,
  Terminal,
  Trash2,
  WandSparkles,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  addressSuggestions,
  bookmarks as seedBookmarks,
  conversations as seedConversations,
  initialHistory,
  responsesByConversation as seedResponsesByConversation,
} from "./mockData";
import {
  getContextMenuItems,
  toLinkFromResponse,
  type ContextMenuItem,
  type ContextMenuPayload,
} from "./services/contextMenu";
import { browserHostShell } from "./services/hostShell";
import {
  createHistoryEntry,
  markHistoryOlder,
  type NavigationDirection,
} from "./services/navigation";
import {
  createMockLoomGraphRepository,
  isLoomAddress,
  linkFromResolvedObject,
  normalizeLoomTitle,
  resolveLoomAddress,
  toLoomMarkdown,
} from "./services/loomProtocol";
import type {
  AddressSuggestion,
  BookmarkItem,
  Conversation,
  HistoryEntry,
  LoomLink,
  LoomObjectType,
  ResponseItem,
  TabGroup,
} from "./types";

const iconForType: Record<LoomObjectType, typeof Globe2> = {
  conversation: Globe2,
  loom: GitBranch,
  response: FileText,
  bookmark: Bookmark,
  semantic: Sparkles,
  recent: Clock3,
};

interface ConversationIconOption {
  key: string;
  label: string;
  tags: string[];
  Icon: LucideIcon;
}

const conversationIconOptions: ConversationIconOption[] = [
  { key: "compass", label: "Compass", tags: ["navigation", "browser"], Icon: Compass },
  { key: "globe", label: "Web", tags: ["site", "internet"], Icon: Globe2 },
  { key: "sparkles", label: "AI", tags: ["prompt", "magic"], Icon: Sparkles },
  { key: "book-open", label: "Research", tags: ["reading", "knowledge"], Icon: BookOpen },
  { key: "brain", label: "Thinking", tags: ["reasoning", "model"], Icon: Brain },
  { key: "workflow", label: "Workflow", tags: ["process", "systems"], Icon: Workflow },
  { key: "network", label: "Network", tags: ["graph", "links"], Icon: Network },
  { key: "layers", label: "Layers", tags: ["product", "stack"], Icon: Layers },
  { key: "rocket", label: "Launch", tags: ["go to market", "release"], Icon: Rocket },
  { key: "target", label: "Target", tags: ["strategy", "focus"], Icon: Target },
  { key: "code", label: "Code", tags: ["engineering", "developer"], Icon: Code2 },
  { key: "terminal", label: "Terminal", tags: ["cli", "ops"], Icon: Terminal },
  { key: "database", label: "Database", tags: ["data", "storage"], Icon: Database },
  { key: "cpu", label: "Compute", tags: ["system", "runtime"], Icon: Cpu },
  { key: "shield", label: "Security", tags: ["trust", "review"], Icon: Shield },
  { key: "lock", label: "Private", tags: ["privacy", "access"], Icon: Lock },
  { key: "flask", label: "Experiment", tags: ["test", "lab"], Icon: FlaskConical },
  { key: "lightbulb", label: "Idea", tags: ["insight", "concept"], Icon: Lightbulb },
  { key: "puzzle", label: "Integration", tags: ["plugin", "extension"], Icon: Puzzle },
  { key: "palette", label: "Design", tags: ["visual", "brand"], Icon: Palette },
  { key: "wand", label: "Generate", tags: ["assistant", "compose"], Icon: WandSparkles },
];

function getConversationIconOption(iconKey?: string) {
  return (
    conversationIconOptions.find((option) => option.key === iconKey) ??
    conversationIconOptions[0]
  );
}

type ActivePanel = "bookmarks" | "history" | "looms" | "archive" | null;

interface AskState {
  response: ResponseItem;
  selectedText: string;
  question: string;
  answered: boolean;
}

interface SelectionAskState {
  response: ResponseItem;
  selectedText: string;
  x: number;
  y: number;
}

interface SelectionReferenceState {
  draftKey: string;
  link: LoomLink;
}

interface ContextMenuState {
  x: number;
  y: number;
  payload: ContextMenuPayload;
  items: ContextMenuItem[];
}

interface ForkRecord {
  id: string;
  parentConversationId: string;
  parentResponseId: string;
  childConversationId: string;
  title: string;
}

type LineageNodeType = "conversation" | "loom" | "response" | "quick";

interface LineageNode {
  id: string;
  type: LineageNodeType;
  title: string;
  path: string;
  subtitle: string;
  conversationId: string;
  responseId?: string;
  children: LineageNode[];
}

interface VisibleLineageNode {
  node: LineageNode;
  depth: number;
  parentId: string | null;
  lane: number;
  hasChildren: boolean;
  collapsed: boolean;
  active: boolean;
  inActiveLineage: boolean;
  activeDescendantHidden: boolean;
}

interface MeasuredLoomRow {
  id: string;
  top: number;
  height: number;
  centerY: number;
}

type ComposerReferenceGroup = "Conversations" | "Looms" | "Bookmarks";

interface ComposerReferenceOption extends LoomLink {
  group: ComposerReferenceGroup;
  subtitle: string;
}

interface MentionState {
  query: string;
  x: number;
  y: number;
  selectedIndex: number;
  range: Range;
}

interface ComposerDraft {
  html: string;
  links: LoomLink[];
}

type ComposerEditIntent =
  | "text"
  | "paste"
  | "replace"
  | "reference-insert"
  | "reference-delete"
  | "reference-move"
  | "reference-remove-dropdown"
  | "external-reference";

interface ComposerHistoryMeta {
  intent: ComposerEditIntent;
  at: number;
  caret: number;
  direction: "insert" | "delete" | "structural";
}

interface ComposerHistoryState {
  entries: ComposerDraft[];
  index: number;
  lastMeta?: ComposerHistoryMeta;
}

const EMPTY_COMPOSER_DRAFT: ComposerDraft = { html: "", links: [] };

const seedComposerLink: LoomLink = {
  id: "seed-link",
  type: "response",
  title: "Inline reference composition rules",
  path: "loom://loom-ai/navigation-architecture/loom/composer/r-inline-references",
  badge: "Linked",
};

const initialNavigationDestination: LoomLink = {
  id: "r-address-bar",
  type: "response",
  title: "Address Bar as local AI web navigator",
  path: "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar",
  badge: "Response",
};

const initialForkRecords: ForkRecord[] = [
  {
    id: "fork-architecture-browser-shell",
    parentConversationId: "c-architecture",
    parentResponseId: "r-address-bar",
    childConversationId: "c-browser-shell",
    title: "Browser shell branch",
  },
  {
    id: "fork-architecture-memory",
    parentConversationId: "c-architecture",
    parentResponseId: "r-address-bar",
    childConversationId: "c-memory",
    title: "Semantic ranking branch",
  },
  {
    id: "fork-architecture-onboarding",
    parentConversationId: "c-architecture",
    parentResponseId: "r-address-bar",
    childConversationId: "c-onboarding",
    title: "First-run address branch",
  },
  {
    id: "fork-architecture-prompts",
    parentConversationId: "c-architecture",
    parentResponseId: "r-composer",
    childConversationId: "c-prompts",
    title: "Prompt reuse branch",
  },
  {
    id: "fork-architecture-bookmarks",
    parentConversationId: "c-architecture",
    parentResponseId: "r-composer",
    childConversationId: "c-bookmarks",
    title: "Bookmark reuse branch",
  },
  {
    id: "fork-architecture-security",
    parentConversationId: "c-architecture",
    parentResponseId: "r-archive-delete",
    childConversationId: "c-security",
    title: "Broken references branch",
  },
  {
    id: "fork-archive-support",
    parentConversationId: "c-architecture",
    parentResponseId: "r-archive-delete",
    childConversationId: "c-support",
    title: "Reference recovery branch",
  },
  {
    id: "fork-prompts-drafts",
    parentConversationId: "c-prompts",
    parentResponseId: "r-library",
    childConversationId: "c-drafts",
    title: "Long-form drafting branch",
  },
  {
    id: "fork-drafts-integrations",
    parentConversationId: "c-drafts",
    parentResponseId: "r-workspace",
    childConversationId: "c-integrations",
    title: "Host integration branch",
  },
  {
    id: "fork-integrations-privacy",
    parentConversationId: "c-integrations",
    parentResponseId: "r-host-shell",
    childConversationId: "c-privacy",
    title: "Local resolver branch",
  },
  {
    id: "fork-security-support",
    parentConversationId: "c-security",
    parentResponseId: "r-threats",
    childConversationId: "c-release",
    title: "Release risk branch",
  },
  {
    id: "fork-memory-research",
    parentConversationId: "c-memory",
    parentResponseId: "r-ranking",
    childConversationId: "c-research",
    title: "Research retrieval branch",
  },
  {
    id: "fork-research-citations",
    parentConversationId: "c-research",
    parentResponseId: "r-synthesis",
    childConversationId: "c-citations",
    title: "Citation provenance branch",
  },
  {
    id: "fork-citations-graph",
    parentConversationId: "c-citations",
    parentResponseId: "r-provenance",
    childConversationId: "c-graph-map",
    title: "Evidence map branch",
  },
  {
    id: "fork-bookmarks-launch",
    parentConversationId: "c-bookmarks",
    parentResponseId: "r-bookmark-panel",
    childConversationId: "c-launch",
    title: "Launch bookmark story branch",
  },
];

const seedComposerText = `Use the linked Loom references to draft the V1 onboarding prompt for a power user. <span class="inline-loom-token" contenteditable="false" draggable="true" data-loom-id="${seedComposerLink.id}" data-loom-path="${seedComposerLink.path}" data-loom-title="${seedComposerLink.title}" data-loom-type="${seedComposerLink.type}" data-loom-badge="${seedComposerLink.badge}">[[${seedComposerLink.title}]]</span>`;

const EPHEMERAL_DRAFT_ID = "draft-new-conversation";

const LOOM_LINK_MIME = "application/loom-link";

const typeLabel: Record<LoomObjectType, string> = {
  conversation: "Conversation",
  loom: "Loom",
  response: "Response",
  bookmark: "Bookmark",
  semantic: "Semantic",
  recent: "Recent",
};

function setLoomDragPayload(event: React.DragEvent, link: LoomLink) {
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(LOOM_LINK_MIME, JSON.stringify(link));
  event.dataTransfer.setData("text/plain", toLoomMarkdown(link));
}

function getLoomDragPayload(event: React.DragEvent) {
  const payload = event.dataTransfer.getData(LOOM_LINK_MIME);
  if (!payload) return null;
  try {
    return JSON.parse(payload) as LoomLink;
  } catch {
    return null;
  }
}

function makeInitialTabGroups(conversations: Conversation[]): TabGroup[] {
  return [
    {
      id: "g-product-systems",
      name: "Product Systems",
      conversationIds: conversations
        .filter((conversation) => conversation.folder === "Product systems" && !conversation.pinned)
        .map((conversation) => conversation.id),
      collapsed: false,
    },
  ].filter((group) => group.conversationIds.length > 0);
}

function App() {
  const addressBarRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const composerFocusRef = useRef<(() => void) | null>(null);
  const pendingScrollPathRef = useRef<string | null>(null);
  const [conversations, setConversations] =
    useState<Conversation[]>(seedConversations);
  const [conversationResponses, setConversationResponses] = useState<
    Record<string, ResponseItem[]>
  >(seedResponsesByConversation);
  const [forkRecords, setForkRecords] = useState<ForkRecord[]>(initialForkRecords);
  const [pinnedConversationIds, setPinnedConversationIds] = useState<string[]>(
    seedConversations
      .filter((conversation) => conversation.pinned)
      .map((conversation) => conversation.id)
  );
  const [tabGroups, setTabGroups] = useState<TabGroup[]>(
    makeInitialTabGroups(seedConversations)
  );
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [archived, setArchived] = useState<Conversation[]>([]);
  const [draftConversation, setDraftConversation] = useState<Conversation | null>(null);
  const [activeConversationId, setActiveConversationId] = useState(
    seedConversations[0].id
  );
  const [activeObjectTitle, setActiveObjectTitle] = useState(
    "Address Bar as local AI web navigator"
  );
  const [activePanel, setActivePanel] = useState<ActivePanel>("bookmarks");
  const [graphMode, setGraphMode] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraft>>({
    [seedConversations[0].id]: {
      html: seedComposerText,
      links: [seedComposerLink],
    },
  });
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(seedBookmarks);
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [navigationStack, setNavigationStack] = useState<HistoryEntry[]>([
    createHistoryEntry(initialNavigationDestination),
  ]);
  const [navigationIndex, setNavigationIndex] = useState(0);
  const [addressFocused, setAddressFocused] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [askState, setAskState] = useState<AskState | null>(null);
  const [selectionAskState, setSelectionAskState] =
    useState<SelectionAskState | null>(null);
  const [selectionReference, setSelectionReference] =
    useState<SelectionReferenceState | null>(null);
  const selectionHighlightRef = useRef<HTMLSpanElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [iconPickerTarget, setIconPickerTarget] = useState<Conversation | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [responseTitleOverrides, setResponseTitleOverrides] = useState<
    Record<string, string>
  >({});

  const activeConversation =
    activeConversationId === draftConversation?.id
      ? draftConversation
      : conversations.find((conversation) => conversation.id === activeConversationId) ??
    conversations[0] ??
    archived[0];

  const activeResponses = activeConversation && activeConversation.id !== draftConversation?.id
    ? conversationResponses[activeConversation.id] ?? []
    : [];

  const activeDraftKey = activeConversation?.id ?? EPHEMERAL_DRAFT_ID;
  const activeComposerDraft = composerDrafts[activeDraftKey] ?? EMPTY_COMPOSER_DRAFT;
  const isNewConversationDraft = activeConversationId === EPHEMERAL_DRAFT_ID;

  const filteredSuggestions = useMemo(() => {
    if (!addressQuery.trim()) return addressSuggestions;
    const query = addressQuery.toLowerCase();
    return addressSuggestions.filter((suggestion) =>
      [suggestion.title, suggestion.subtitle, suggestion.path, suggestion.badge]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    );
  }, [addressQuery]);

  const currentLocation = activeConversation
    ? `${activeConversation.title} / ${activeObjectTitle}`
    : "Archive / No active conversation";

  const currentActiveDestination = useMemo<LoomLink>(() => {
    const activeResponse = activeResponses.find(
      (response) =>
        (responseTitleOverrides[response.id] ?? response.title) === activeObjectTitle
    );
    if (activeResponse) {
      return {
        id: activeResponse.id,
        type: "response",
        title: responseTitleOverrides[activeResponse.id] ?? activeResponse.title,
        path: activeResponse.address,
        badge: "Response",
      };
    }
    if (activeConversation) {
      return {
        id: activeConversation.id,
        type: "conversation",
        title: activeConversation.title,
        path: activeConversation.path,
        badge: "Conversation",
      };
    }
    return {
      id: "archive",
      type: "recent",
      title: "Archive",
      path: "loom://archive",
      badge: "Recent",
    };
  }, [activeConversation, activeObjectTitle, activeResponses, responseTitleOverrides]);

  const composerReferenceOptions = useMemo<ComposerReferenceOption[]>(() => {
    const conversationOptions = conversations.map((conversation) => ({
      id: conversation.id,
      type: "conversation" as const,
      title: conversation.title,
      path: conversation.path,
      badge: "Conversation",
      group: "Conversations" as const,
      subtitle: conversation.folder,
    }));
    const loomOptions = Object.values(conversationResponses)
      .flat()
      .map((response) => ({
        id: response.id,
        type: "response" as const,
        title: response.title,
        path: response.address,
        badge: "Loom",
        group: "Looms" as const,
        subtitle: "Q+A response",
      }));
    const bookmarkOptions = bookmarks.map((bookmark) => ({
      ...bookmark,
      title: bookmark.editableTitle,
      group: "Bookmarks" as const,
      subtitle: bookmark.lastUsed,
    }));

    return [...conversationOptions, ...loomOptions, ...bookmarkOptions];
  }, [bookmarks, conversationResponses, conversations]);

  const loomGraphRepository = useMemo(
    () =>
      createMockLoomGraphRepository({
        conversations,
        responsesByConversation: conversationResponses,
        bookmarks,
      }),
    [bookmarks, conversationResponses, conversations]
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        addressFocused &&
        addressBarRef.current &&
        !addressBarRef.current.contains(event.target as Node)
      ) {
        setAddressFocused(false);
        setAddressQuery("");
      }
      if (contextMenu) {
        setContextMenu(null);
      }
      if (selectionAskState) {
        const target = event.target as HTMLElement;
        if (!target.closest(".selection-action-popover")) {
          setSelectionAskState(null);
          if (!askState) clearSelectionHighlight();
        }
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAddressFocused(false);
        setAddressQuery("");
        setContextMenu(null);
        if (selectionAskState || askState) closeSelectionAskFlow();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [addressFocused, askState, contextMenu, selectionAskState]);

  function normalizeResolvedDestination(
    destination: LoomLink | AddressSuggestion | HistoryEntry
  ): LoomLink | AddressSuggestion | HistoryEntry {
    const resolution = resolveLoomAddress(destination.path, loomGraphRepository);
    if (resolution.status === "resolved") {
      const resolvedObject = resolution.targetObject ?? resolution.object;
      return resolvedObject
        ? { ...destination, ...linkFromResolvedObject(resolvedObject) }
        : destination;
    }
    if (resolution.status === "alias_stale" && resolution.object) {
      return {
        ...destination,
        ...linkFromResolvedObject(resolution.object),
        path: resolution.staleAliasReplacement ?? destination.path,
      };
    }
    if (resolution.status === "not_found") return destination;
    return {
      ...destination,
      badge:
        resolution.status === "deleted"
          ? "Deleted"
          : resolution.status === "window_invalid"
            ? "Invalid window"
            : "Broken reference",
    };
  }

  function restoreDestination(destination: LoomLink | AddressSuggestion | HistoryEntry) {
    const resolvedDestination = normalizeResolvedDestination(destination);
    setActiveObjectTitle(resolvedDestination.title);
    const conversation = conversations.find((item) =>
      resolvedDestination.path.startsWith(item.path)
    );
    if (conversation) setActiveConversationId(conversation.id);
    if (resolvedDestination.path === "loom://drafts/new-conversation") {
      setDraftConversation((current) =>
        current ?? {
          id: EPHEMERAL_DRAFT_ID,
          title: "New conversation",
          path: "loom://drafts/new-conversation",
          folder: "Drafts",
          summary: "Clean unsaved conversation draft.",
          iconKey: "compass",
        }
      );
      setComposerDrafts((current) => ({
        ...current,
        [EPHEMERAL_DRAFT_ID]:
          current[EPHEMERAL_DRAFT_ID] ?? { html: "", links: [] },
      }));
      setActiveConversationId(EPHEMERAL_DRAFT_ID);
    }
    pendingScrollPathRef.current = resolvedDestination.path;
    setAddressFocused(false);
    setAddressQuery("");
    setSelectedSuggestion(0);
    setGraphMode(false);
  }

  function pushNavigationEntry(destination: LoomLink | AddressSuggestion | HistoryEntry) {
    const resolvedDestination = normalizeResolvedDestination(destination);
    setNavigationStack((current) => {
      const base = current.slice(0, navigationIndex + 1);
      const last = base[base.length - 1];
      if (
        last?.path === resolvedDestination.path &&
        last.title === resolvedDestination.title
      ) {
        setNavigationIndex(base.length - 1);
        return base;
      }
      const next = [...base, createHistoryEntry(resolvedDestination)];
      setNavigationIndex(next.length - 1);
      return next;
    });
  }

  function replaceNavigationEntry(destination: LoomLink | AddressSuggestion | HistoryEntry) {
    const resolvedDestination = normalizeResolvedDestination(destination);
    setNavigationStack((current) => {
      if (!current[navigationIndex]) return [createHistoryEntry(resolvedDestination)];
      return current.map((entry, index) =>
        index === navigationIndex ? createHistoryEntry(resolvedDestination) : entry
      );
    });
  }

  function visitDestination(destination: LoomLink | AddressSuggestion | HistoryEntry) {
    const resolvedDestination = normalizeResolvedDestination(destination);
    restoreDestination(resolvedDestination);
    pushNavigationEntry(resolvedDestination);
    setHistory((current) => [
      createHistoryEntry(resolvedDestination),
      ...markHistoryOlder(current),
    ]);
  }

  useEffect(() => {
    const pendingPath = pendingScrollPathRef.current;
    if (!pendingPath || graphMode) return;
    pendingScrollPathRef.current = null;
    window.requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (!transcript) return;
      const target = transcript.querySelector<HTMLElement>(
        `[data-response-address="${CSS.escape(pendingPath)}"]`
      );
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (activeConversation?.path === pendingPath) {
        transcript.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }, [activeConversation?.path, activeConversationId, activeObjectTitle, graphMode]);

  function archiveConversation(conversation: Conversation) {
    const nextConversations = conversations.filter(
      (item) => item.id !== conversation.id
    );
    setConversations(nextConversations);
    setArchived((current) => [conversation, ...current]);
    setPinnedConversationIds((current) =>
      current.filter((id) => id !== conversation.id)
    );
    if (conversation.id === activeConversationId && nextConversations[0]) {
      setActiveConversationId(nextConversations[0].id);
      setActiveObjectTitle(nextConversations[0].title);
    }
  }

  function restoreConversation(conversation: Conversation) {
    setArchived((current) => current.filter((item) => item.id !== conversation.id));
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setActiveObjectTitle(conversation.title);
    setActivePanel(null);
  }

  function deleteConversation(conversation: Conversation) {
    setConversations((current) =>
      current.filter((item) => item.id !== conversation.id)
    );
    setArchived((current) => current.filter((item) => item.id !== conversation.id));
    setBookmarks((current) =>
      current.map((bookmark) =>
        bookmark.path.startsWith(conversation.path)
          ? { ...bookmark, badge: "Broken reference" }
          : bookmark
      )
    );
    setPinnedConversationIds((current) =>
      current.filter((id) => id !== conversation.id)
    );
    setDeleteTarget(null);
    setContextMenu(null);
  }

  function updateComposerDraft(key: string, updater: (draft: ComposerDraft) => ComposerDraft) {
    setComposerDrafts((current) => ({
      ...current,
      [key]: updater(current[key] ?? EMPTY_COMPOSER_DRAFT),
    }));
  }

  function setActiveComposerDraft(draft: ComposerDraft) {
    setComposerDrafts((current) => ({
      ...current,
      [activeDraftKey]: draft,
    }));
  }

  function linkObject(link: LoomLink) {
    updateComposerDraft(activeDraftKey, (draft) => ({
      ...draft,
      links: draft.links.some((item) => item.path === link.path)
        ? draft.links
        : [...draft.links, link],
    }));
  }

  function bookmarkResponse(response: ResponseItem) {
    setBookmarks((current) => {
      if (current.some((item) => item.path === response.address)) return current;
      return [
        {
          id: `b-${response.id}`,
          type: "response",
          title: response.title,
          editableTitle: response.title,
          path: response.address,
          badge: "Response",
          lastUsed: "Just saved",
        },
        ...current,
      ];
    });
    setActivePanel("bookmarks");
  }

  function handleAddressKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedSuggestion((index) =>
        Math.min(index + 1, filteredSuggestions.length - 1)
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedSuggestion((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter" && filteredSuggestions[selectedSuggestion]) {
      event.preventDefault();
      visitDestination(filteredSuggestions[selectedSuggestion]);
    }
    if (
      event.key === "Enter" &&
      !filteredSuggestions[selectedSuggestion] &&
      isLoomAddress(addressQuery)
    ) {
      event.preventDefault();
      visitDestination({
        id: `address-${Date.now()}`,
        type: "recent",
        title: addressQuery,
        path: addressQuery,
        badge: "Address",
      });
    }
    if (event.key === "Escape") {
      setAddressFocused(false);
      setAddressQuery("");
    }
  }

  function handleBackForward(direction: NavigationDirection) {
    const nextIndex =
      direction === "back" ? navigationIndex - 1 : navigationIndex + 1;
    const entry = navigationStack[nextIndex];
    if (!entry) return;
    setNavigationIndex(nextIndex);
    restoreDestination(entry);
  }

  function openContextMenu(
    event: React.MouseEvent,
    payload: ContextMenuPayload
  ) {
    event.preventDefault();
    event.stopPropagation();
    const request = { kind: payload.kind, payload };
    if (browserHostShell.openContextMenu(request)) return;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 320)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360)),
      payload,
      items: getContextMenuItems(payload),
    });
  }

  function openConversationMenu(event: React.MouseEvent, conversation: Conversation) {
    openContextMenu(event, {
      kind: "conversation",
      conversation,
      pinned: pinnedConversationIds.includes(conversation.id),
    });
  }

  function openGroupMenu(event: React.MouseEvent, group: TabGroup) {
    openContextMenu(event, { kind: "group", group });
  }

  function nextGroupName(groups: TabGroup[]) {
    let index = 1;
    while (groups.some((group) => group.name === `Group #${index}`)) index += 1;
    return `Group #${index}`;
  }

  function createGroupFromConversations(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setPinnedConversationIds((current) =>
      current.filter((id) => id !== sourceId && id !== targetId)
    );
    setTabGroups((current) => {
      if (
        current.some(
          (group) =>
            group.conversationIds.includes(sourceId) &&
            group.conversationIds.includes(targetId)
        )
      ) {
        return current;
      }
      const strippedGroups = current
        .map((group) => ({
          ...group,
          conversationIds: group.conversationIds.filter(
            (id) => id !== sourceId && id !== targetId
          ),
        }))
        .filter((group) => group.conversationIds.length > 0);
      return [
        ...strippedGroups,
        {
          id: `g-${Date.now()}`,
          name: nextGroupName(strippedGroups),
          conversationIds: [targetId, sourceId],
          collapsed: false,
        },
      ];
    });
  }

  function addConversationToGroup(conversationId: string, groupId: string) {
    setPinnedConversationIds((current) => current.filter((id) => id !== conversationId));
    setTabGroups((current) =>
      current
        .map((group) => ({
          ...group,
          conversationIds:
            group.id === groupId
              ? [
                  ...group.conversationIds.filter((id) => id !== conversationId),
                  conversationId,
                ]
              : group.conversationIds.filter((id) => id !== conversationId),
        }))
        .filter((group) => group.conversationIds.length > 0)
    );
  }

  function removeConversationFromGroups(conversationId: string) {
    setTabGroups((current) =>
      current
        .map((group) => ({
          ...group,
          conversationIds: group.conversationIds.filter((id) => id !== conversationId),
        }))
        .filter((group) => group.conversationIds.length > 0)
    );
  }

  function renameTabGroup(groupId: string, name: string) {
    const nextName = normalizeLoomTitle(name);
    if (!nextName) return;
    setTabGroups((current) =>
      current.map((group) =>
        group.id === groupId ? { ...group, name: nextName } : group
      )
    );
    setRenamingGroupId(null);
  }

  function toggleTabGroup(groupId: string) {
    setTabGroups((current) =>
      current.map((group) =>
        group.id === groupId ? { ...group, collapsed: !group.collapsed } : group
      )
    );
  }

  function ungroupTabGroup(groupId: string) {
    setTabGroups((current) => current.filter((group) => group.id !== groupId));
    setRenamingGroupId(null);
  }

  function deleteTabGroup(group: TabGroup) {
    const confirmed = window.confirm(
      `Delete "${group.name}" group? Conversations will stay as standalone tabs.`
    );
    if (confirmed) ungroupTabGroup(group.id);
  }

  function createConversationInGroup(groupId: string) {
    const id = `c-new-${Date.now()}`;
    const conversation: Conversation = {
      id,
      title: "New Loom conversation",
      path: `loom://drafts/${id}`,
      folder: "Personal web",
      summary: "New grouped conversation tab.",
      iconKey: "compass",
    };
    setConversations((current) => [conversation, ...current]);
    setTabGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? { ...group, collapsed: false, conversationIds: [...group.conversationIds, id] }
          : group
      )
    );
    setActiveConversationId(id);
    setActiveObjectTitle(conversation.title);
    setActivePanel(null);
    setGraphMode(false);
    const destination: LoomLink = {
      id,
      type: "conversation",
      title: conversation.title,
      path: conversation.path,
      badge: "Conversation",
    };
    pushNavigationEntry(destination);
    setHistory((current) => [
      createHistoryEntry(destination),
      ...markHistoryOlder(current),
    ]);
  }

  function openNewConversationDraft() {
    const draft: Conversation = {
      id: EPHEMERAL_DRAFT_ID,
      title: "New conversation",
      path: "loom://drafts/new-conversation",
      folder: "Drafts",
      summary: "Clean unsaved conversation draft.",
      iconKey: "compass",
    };
    setDraftConversation(draft);
    setComposerDrafts((current) => ({
      ...current,
      [EPHEMERAL_DRAFT_ID]: { html: "", links: [] },
    }));
    setActiveConversationId(EPHEMERAL_DRAFT_ID);
    setActiveObjectTitle("New conversation");
    setActivePanel(null);
    setGraphMode(false);
    pushNavigationEntry({
      id: EPHEMERAL_DRAFT_ID,
      type: "conversation",
      title: "New conversation",
      path: "loom://drafts/new-conversation",
      badge: "Draft",
    });
  }

  function materializeDraftConversation(draft: ComposerDraft) {
    if (activeConversationId !== EPHEMERAL_DRAFT_ID || !draftConversation) return;
    const plainText = draft.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const meaningful = plainText.length > 0 || draft.links.length > 0;
    if (!meaningful) return;
    const id = `c-${Date.now()}`;
    const title = normalizeLoomTitle(
      plainText ? plainText.slice(0, 54) : "New Loom conversation"
    );
    const conversation: Conversation = {
      ...draftConversation,
      id,
      title,
      path: `loom://drafts/${id}`,
      summary: "New conversation created from a prompt draft.",
    };
    setConversations((current) => [conversation, ...current]);
    setComposerDrafts((current) => {
      const { [EPHEMERAL_DRAFT_ID]: _discard, ...rest } = current;
      return {
        ...rest,
        [id]: { html: "", links: [] },
      };
    });
    setDraftConversation(null);
    setActiveConversationId(id);
    setActiveObjectTitle(title);
    const destination: LoomLink = {
      id,
      type: "conversation",
      title,
      path: conversation.path,
      badge: "Conversation",
    };
    replaceNavigationEntry(destination);
    setHistory((current) => [
      createHistoryEntry(destination),
      ...markHistoryOlder(current),
    ]);
  }

  function openHistoryMenu(event: React.MouseEvent, direction: NavigationDirection) {
    const entries =
      direction === "back"
        ? navigationStack.slice(0, navigationIndex).reverse().slice(0, 6)
        : navigationStack.slice(navigationIndex + 1, navigationIndex + 7);
    openContextMenu(
      event,
      { kind: direction === "back" ? "history-back" : "history-forward", entries }
    );
  }

  function jumpNavigationHistory(direction: NavigationDirection, menuIndex: number) {
    const targetIndex =
      direction === "back"
        ? navigationIndex - 1 - menuIndex
        : navigationIndex + 1 + menuIndex;
    const entry = navigationStack[targetIndex];
    if (!entry) return;
    setNavigationIndex(targetIndex);
    restoreDestination(entry);
  }

  function togglePinnedConversation(conversation: Conversation) {
    setPinnedConversationIds((current) =>
      current.includes(conversation.id)
        ? current.filter((id) => id !== conversation.id)
        : [conversation.id, ...current]
    );
  }

  function renameConversation(conversation: Conversation) {
    const title = window.prompt("Rename conversation", conversation.title);
    if (!title) return;
    const nextTitle = normalizeLoomTitle(title);
    setConversations((current) =>
      current.map((item) =>
        item.id === conversation.id ? { ...item, title: nextTitle } : item
      )
    );
    if (conversation.id === activeConversationId) setActiveObjectTitle(nextTitle);
  }

  function changeConversationIcon(conversation: Conversation, iconKey: string) {
    setConversations((current) =>
      current.map((item) =>
        item.id === conversation.id ? { ...item, iconKey } : item
      )
    );
    setIconPickerTarget(null);
  }

  function bookmarkConversation(conversation: Conversation) {
    bookmarkLoomLink({
      id: conversation.id,
      type: "conversation",
      title: conversation.title,
      path: conversation.path,
      badge: "Conversation",
    });
  }

  function bookmarkLoomLink(link: LoomLink) {
    setBookmarks((current) => {
      if (current.some((item) => item.path === link.path)) return current;
      return [
        {
          id: `b-${link.id}-${Date.now()}`,
          type: link.type,
          title: link.title,
          editableTitle: link.title,
          path: link.path,
          badge: link.badge ?? typeLabel[link.type],
          lastUsed: "Just saved",
        },
        ...current,
      ];
    });
    setActivePanel("bookmarks");
  }

  function renameBookmark(bookmark: BookmarkItem) {
    const title = window.prompt("Rename bookmark", bookmark.editableTitle);
    if (!title) return;
    const nextTitle = normalizeLoomTitle(title);
    setBookmarks((current) =>
      current.map((item) =>
        item.id === bookmark.id
          ? { ...item, editableTitle: nextTitle, title: nextTitle }
          : item
      )
    );
  }

  function removeBookmark(bookmark: BookmarkItem) {
    setBookmarks((current) => current.filter((item) => item.id !== bookmark.id));
  }

  function toggleSuggestedBookmark(link: LoomLink) {
    const existing = bookmarks.find((bookmark) => bookmark.path === link.path);
    if (existing) {
      removeBookmark(existing);
      return;
    }
    bookmarkLoomLink({ ...link, badge: link.badge ?? "Bookmark" });
  }

  function buildLineageTree() {
    if (!activeConversation) return null;
    const conversationsById = new globalThis.Map(conversations.map((conversation) => [conversation.id, conversation]));
    let rootConversation = activeConversation;
    let parentFork = forkRecords.find(
      (record) => record.childConversationId === rootConversation.id
    );
    while (parentFork) {
      const parent = conversationsById.get(parentFork.parentConversationId);
      if (!parent) break;
      rootConversation = parent;
      parentFork = forkRecords.find(
        (record) => record.childConversationId === rootConversation.id
      );
    }

    const buildConversationNode = (
      conversation: Conversation,
      asLoom: boolean,
      forkTitle?: string
    ): LineageNode => {
      const responses = conversationResponses[conversation.id] ?? [];
      return {
        id: `${asLoom ? "loom" : "conversation"}-${conversation.id}`,
        type: asLoom ? "loom" : "conversation",
        title: asLoom ? forkTitle ?? conversation.title : conversation.title,
        path: conversation.path,
        subtitle: asLoom ? conversation.title : "Conversation root",
        conversationId: conversation.id,
        children: responses.map((response) => ({
          id: `response-${conversation.id}-${response.id}`,
          type: "response" as const,
          title: response.title,
          path: response.address,
          subtitle: "Response",
          conversationId: conversation.id,
          responseId: response.id,
          children: forkRecords
            .filter(
              (record) =>
                record.parentConversationId === conversation.id &&
                record.parentResponseId === response.id
            )
            .map((record) => {
              const childConversation = conversationsById.get(record.childConversationId);
              return childConversation
                ? buildConversationNode(childConversation, true, record.title)
                : null;
            })
            .filter((node): node is LineageNode => Boolean(node)),
        })),
      };
    };

    return buildConversationNode(rootConversation, false);
  }

  const lineageRoot = useMemo(
    buildLineageTree,
    [activeConversation, conversationResponses, conversations, forkRecords]
  );

  function forkResponseLoom(response: ResponseItem) {
    if (!activeConversation) return;
    const sourceResponses = conversationResponses[activeConversation.id] ?? [];
    const responseIndex = sourceResponses.findIndex((item) => item.id === response.id);
    if (responseIndex < 0) return;
    const id = `c-loom-${Date.now()}`;
    const path = `${activeConversation.path}/loom/${id}`;
    const title = normalizeLoomTitle(`Loom: ${response.title}`);
    const conversation: Conversation = {
      id,
      title,
      path,
      folder: activeConversation.folder,
      summary: `Branched from ${activeConversation.title}.`,
      iconKey: "workflow",
    };
    const lineage = sourceResponses.slice(0, responseIndex + 1).map((item, index) => ({
      ...item,
      id: `${item.id}-${id}`,
      address: `${path}/r-${index + 1}`,
    }));
    setConversations((current) => [conversation, ...current]);
    setConversationResponses((current) => ({
      ...current,
      [id]: lineage,
    }));
    setForkRecords((current) => [
      ...current,
      {
        id: `fork-${activeConversation.id}-${response.id}-${id}`,
        parentConversationId: activeConversation.id,
        parentResponseId: response.id,
        childConversationId: id,
        title: `Loom from ${response.title}`,
      },
    ]);
    setComposerDrafts((current) => ({
      ...current,
      [id]: { html: "", links: [] },
    }));
    setActiveConversationId(id);
    setActiveObjectTitle(response.title);
    setActivePanel(null);
    setGraphMode(false);
    const destination: LoomLink = {
      id,
      type: "conversation",
      title,
      path,
      badge: "Loom",
    };
    pushNavigationEntry(destination);
    setHistory((current) => [
      createHistoryEntry(destination),
      ...markHistoryOlder(current),
    ]);
  }

  function renameResponse(response: ResponseItem) {
    const title = window.prompt(
      "Rename response title",
      responseTitleOverrides[response.id] ?? response.title
    );
    if (!title) return;
    setResponseTitleOverrides((current) => ({
      ...current,
      [response.id]: normalizeLoomTitle(title),
    }));
  }

  function bookmarkSuggestedLinks(response: ResponseItem) {
    const firstSuggested = response.suggestedLinks[0];
    if (!firstSuggested) return;
    visitDestination({ ...firstSuggested, type: "response", badge: "Linked" });
  }

  function handleContextAction(item: ContextMenuItem, historyIndex = 0) {
    if (!contextMenu || item.disabled) return;
    const { payload } = contextMenu;
    setContextMenu(null);

    if (payload.kind === "history-back" || payload.kind === "history-forward") {
      jumpNavigationHistory(
        payload.kind === "history-back" ? "back" : "forward",
        historyIndex
      );
      return;
    }

    if (payload.kind === "conversation") {
      const { conversation } = payload;
      if (item.id === "open") {
        visitDestination({
          id: conversation.id,
          type: "conversation",
          title: conversation.title,
          path: conversation.path,
          badge: "Conversation",
        });
        setActivePanel(null);
      }
      if (item.id === "pin" || item.id === "unpin") togglePinnedConversation(conversation);
      if (item.id === "rename") renameConversation(conversation);
      if (item.id === "change-icon") setIconPickerTarget(conversation);
      if (item.id === "bookmark") bookmarkConversation(conversation);
      if (item.id === "copy-address") void browserHostShell.copyText(conversation.path);
      if (item.id === "archive") archiveConversation(conversation);
      if (item.id === "delete") setDeleteTarget(conversation);
    }

    if (payload.kind === "response") {
      const response = {
        ...payload.response,
        title: responseTitleOverrides[payload.response.id] ?? payload.response.title,
      };
      if (item.id === "ask") openAsk(response);
      if (item.id === "link") linkObject(toLinkFromResponse(response));
      if (item.id === "bookmark") bookmarkResponse(response);
      if (item.id === "copy-address") void browserHostShell.copyText(response.address);
      if (item.id === "copy-markdown") {
        void browserHostShell.copyText(
          toLoomMarkdown({ title: response.title, path: response.address })
        );
      }
      if (item.id === "bookmark-suggested") bookmarkSuggestedLinks(response);
      if (item.id === "rename") renameResponse(response);
      if (item.id === "open-graph") {
        setActiveObjectTitle(response.title);
        setGraphMode(true);
        setActivePanel(null);
      }
    }

    if (payload.kind === "bookmark") {
      const { bookmark } = payload;
      if (item.id === "open") visitDestination(bookmark);
      if (item.id === "insert") linkObject(bookmark);
      if (item.id === "rename") renameBookmark(bookmark);
      if (item.id === "copy-address") void browserHostShell.copyText(bookmark.path);
      if (item.id === "remove") removeBookmark(bookmark);
    }

    if (payload.kind === "group") {
      const { group } = payload;
      if (item.id === "rename") setRenamingGroupId(group.id);
      if (item.id === "new-tab-group") createConversationInGroup(group.id);
      if (item.id === "ungroup") ungroupTabGroup(group.id);
      if (item.id === "delete-group") deleteTabGroup(group);
    }
  }

  function openAsk(response: ResponseItem, selectedText = "") {
    setSelectionAskState(null);
    clearSelectionHighlight();
    setAskState({
      response,
      selectedText:
        selectedText ||
        "The Address Bar should accept a Loom address, a natural-language query, or a remembered title.",
      question: "",
      answered: false,
    });
  }

  function clearSelectionHighlight() {
    const highlight = selectionHighlightRef.current;
    if (!highlight) return;
    const parent = highlight.parentNode;
    if (!parent) {
      selectionHighlightRef.current = null;
      return;
    }
    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }
    parent.removeChild(highlight);
    parent.normalize();
    selectionHighlightRef.current = null;
  }

  function createSelectionHighlight(range: Range) {
    clearSelectionHighlight();
    const highlight = document.createElement("span");
    highlight.className = "loom-selection-highlight";
    try {
      const contents = range.extractContents();
      highlight.appendChild(contents);
      range.insertNode(highlight);
      selectionHighlightRef.current = highlight;
      window.getSelection()?.removeAllRanges();
      return true;
    } catch {
      return false;
    }
  }

  function closeSelectionAskFlow() {
    setSelectionAskState(null);
    setAskState(null);
    setSelectionReference(null);
    clearSelectionHighlight();
  }

  function onSelectionAsk(response: ResponseItem) {
    const selection = window.getSelection();
    const selected = selection?.toString().trim();
    if (!selection || selection.rangeCount === 0 || !selected || selected.length <= 4) {
      if (!askState) {
        setSelectionAskState(null);
        clearSelectionHighlight();
      }
      return;
    }
    const range = selection.getRangeAt(0);
    const selectionElement =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    if (!selectionElement?.closest(".assistant-body")) return;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    if (!createSelectionHighlight(range.cloneRange())) return;
    setSelectionAskState({
      response,
      selectedText: selected,
      x: Math.min(window.innerWidth - 260, Math.max(12, rect.left + rect.width / 2)),
      y: Math.max(52, rect.top - 12),
    });
  }

  function launchSelectionAsk(kind: "ask" | "quick") {
    if (!selectionAskState) return;
    if (kind === "ask") {
      setSelectionReference({
        draftKey: activeDraftKey,
        link: {
          id: `selection-${selectionAskState.response.id}-${Date.now()}`,
          type: "response",
          title: selectionAskState.selectedText,
          path: `${selectionAskState.response.address}#selection`,
          badge: "Selection",
        },
      });
      setSelectionAskState(null);
      window.requestAnimationFrame(() => composerFocusRef.current?.());
      return;
    }
    setAskState({
      response: selectionAskState.response,
      selectedText: selectionAskState.selectedText,
      question: "",
      answered: false,
    });
    setSelectionAskState(null);
  }

  function scrollTranscriptToBottom() {
    if (!transcriptRef.current || isNewConversationDraft) return;
    transcriptRef.current.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }

  return (
    <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <TopBrowserBar
        addressBarRef={addressBarRef}
        location={currentLocation}
        path={currentActiveDestination.path}
        addressFocused={addressFocused}
        addressQuery={addressQuery}
        suggestions={filteredSuggestions}
        selectedSuggestion={selectedSuggestion}
        canBack={navigationIndex > 0}
        canForward={navigationIndex < navigationStack.length - 1}
        graphMode={graphMode}
        activePanel={activePanel}
        sidebarCollapsed={sidebarCollapsed}
        currentBookmarked={bookmarks.some(
          (bookmark) => bookmark.path === currentActiveDestination.path
        )}
        currentDestination={currentActiveDestination}
        onAddressFocus={() => setAddressFocused(true)}
        onAddressChange={(value) => {
          setAddressQuery(value);
          setSelectedSuggestion(0);
        }}
        onAddressKeyDown={handleAddressKeyDown}
        onVisit={visitDestination}
        onBack={() => handleBackForward("back")}
        onForward={() => handleBackForward("forward")}
        onContextNav={openHistoryMenu}
        onBookmarkCurrent={() => {
          bookmarkLoomLink(currentActiveDestination);
        }}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onTogglePanel={(panel) => {
          setAddressFocused(false);
          setActivePanel(activePanel === panel ? null : panel);
        }}
        onToggleGraph={() => {
          setAddressFocused(false);
          setAddressQuery("");
          setGraphMode((current) => !current);
          setActivePanel(null);
        }}
      />

      <div className="app-body">
        <Sidebar
          conversations={conversations}
          pinnedConversationIds={pinnedConversationIds}
          tabGroups={tabGroups}
          renamingGroupId={renamingGroupId}
          collapsed={sidebarCollapsed}
          archivedCount={archived.length}
          activeConversationId={activeConversationId}
          activePanel={activePanel}
          onDropBookmark={bookmarkLoomLink}
          onCreateGroup={createGroupFromConversations}
          onAddToGroup={addConversationToGroup}
          onRemoveFromGroups={removeConversationFromGroups}
          onRenameGroup={renameTabGroup}
          onCancelRenameGroup={() => setRenamingGroupId(null)}
          onToggleGroup={toggleTabGroup}
          onNewConversation={openNewConversationDraft}
          onSelectConversation={(conversation) => {
            visitDestination({
              id: conversation.id,
              type: "conversation",
              title: conversation.title,
              path: conversation.path,
              badge: "Conversation",
            });
            setActivePanel(null);
          }}
          onOpenPanel={setActivePanel}
          onArchive={archiveConversation}
          onOpenContextMenu={openConversationMenu}
          onOpenGroupContextMenu={openGroupMenu}
          onDeleteRequest={setDeleteTarget}
        />

        <main className="workspace">

        <div className={isNewConversationDraft ? "content-area empty-draft-mode" : "content-area"}>
          {isNewConversationDraft ? (
            <section className="empty-conversation-start" aria-label="New conversation">
              <div className="empty-conversation-copy">
                <span>New Loom conversation</span>
                <h1>Ask, search, or reference your AI web.</h1>
              </div>
              <PromptComposer
                variant="centered"
                draftKey={activeDraftKey}
                draft={activeComposerDraft}
                attachedReferences={
                  selectionReference?.draftKey === activeDraftKey
                    ? [selectionReference.link]
                    : []
                }
                referenceOptions={composerReferenceOptions}
                onDraftChange={setActiveComposerDraft}
                onRemoveLink={(link) =>
                  updateComposerDraft(activeDraftKey, (draft) => ({
                    html: draft.html,
                    links: draft.links.filter((item) => item.path !== link.path),
                  }))
                }
                onDropLink={linkObject}
                onRemoveAttachedReference={() => {
                  setSelectionReference(null);
                  clearSelectionHighlight();
                }}
                onReadyToFocus={(focus) => {
                  composerFocusRef.current = focus;
                }}
                onSend={materializeDraftConversation}
                onUserTyping={scrollTranscriptToBottom}
              />
            </section>
          ) : (
            <>
              {graphMode ? (
                <GraphView
                  conversations={conversations}
                  responses={activeResponses}
                  onVisit={visitDestination}
                />
              ) : (
                <ChatTranscript
                  transcriptRef={(node) => {
                    transcriptRef.current = node;
                  }}
                  conversation={activeConversation}
                  responses={activeResponses}
                  onLink={linkObject}
                  onAsk={openAsk}
                  onLoom={forkResponseLoom}
                  onToggleSuggestedBookmark={toggleSuggestedBookmark}
                  bookmarkedPaths={new Set(bookmarks.map((bookmark) => bookmark.path))}
                  onSelectionAsk={onSelectionAsk}
                  responseTitleOverrides={responseTitleOverrides}
                  onOpenContextMenu={(event, response) =>
                    openContextMenu(event, { kind: "response", response })
                  }
                />
              )}

              <PromptComposer
                variant="bottom"
                draftKey={activeDraftKey}
                draft={activeComposerDraft}
                attachedReferences={
                  selectionReference?.draftKey === activeDraftKey
                    ? [selectionReference.link]
                    : []
                }
                referenceOptions={composerReferenceOptions}
                onDraftChange={setActiveComposerDraft}
                onRemoveLink={(link) =>
                  updateComposerDraft(activeDraftKey, (draft) => ({
                    html: draft.html,
                    links: draft.links.filter((item) => item.path !== link.path),
                  }))
                }
                onDropLink={linkObject}
                onRemoveAttachedReference={() => {
                  setSelectionReference(null);
                  clearSelectionHighlight();
                }}
                onReadyToFocus={(focus) => {
                  composerFocusRef.current = focus;
                }}
                onSend={materializeDraftConversation}
                onUserTyping={scrollTranscriptToBottom}
              />
            </>
          )}
        </div>
        </main>

        <RightPanel
          activePanel={activePanel}
          bookmarks={bookmarks}
          history={history}
          lineageRoot={lineageRoot}
          activeDestination={currentActiveDestination}
          archived={archived}
          onClose={() => setActivePanel(null)}
          onVisit={visitDestination}
          onInsert={linkObject}
          onBookmark={bookmarkLoomLink}
          onOpenGraph={(destination) => {
            visitDestination(destination);
            setGraphMode(true);
            setActivePanel(null);
          }}
          onRenameBookmark={renameBookmark}
          onRemoveBookmark={removeBookmark}
          onOpenBookmarkMenu={(event, bookmark) =>
            openContextMenu(event, { kind: "bookmark", bookmark })
          }
          onDropBookmark={bookmarkLoomLink}
          onRestore={restoreConversation}
          onDeleteRequest={setDeleteTarget}
        />
      </div>

      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      {iconPickerTarget && (
        <ConversationIconPicker
          conversation={
            conversations.find((item) => item.id === iconPickerTarget.id) ??
            iconPickerTarget
          }
          options={conversationIconOptions}
          onCancel={() => setIconPickerTarget(null)}
          onSave={changeConversationIcon}
        />
      )}

      {selectionAskState && (
        <SelectionActionPopover
          x={selectionAskState.x}
          y={selectionAskState.y}
          onAsk={() => launchSelectionAsk("ask")}
          onQuickQuestion={() => launchSelectionAsk("quick")}
        />
      )}

      {askState && (
        <AskPopover
          state={askState}
          onUpdate={setAskState}
          onClose={closeSelectionAskFlow}
          onBookmark={() => {
            bookmarkResponse(askState.response);
            closeSelectionAskFlow();
          }}
          onLoom={() => {
            visitDestination({
              id: `loom-${askState.response.id}`,
              type: "loom",
              title: `Ask follow-up: ${askState.response.title}`,
              path: askState.response.address.replace("/r-", "/loom/ask/r-"),
              badge: "Loom",
            });
            closeSelectionAskFlow();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteConversationDialog
          conversation={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteConversation(deleteTarget)}
        />
      )}
    </div>
  );
}

interface SidebarProps {
  conversations: Conversation[];
  pinnedConversationIds: string[];
  tabGroups: TabGroup[];
  renamingGroupId: string | null;
  collapsed: boolean;
  archivedCount: number;
  activeConversationId: string;
  activePanel: ActivePanel;
  onDropBookmark: (link: LoomLink) => void;
  onCreateGroup: (sourceId: string, targetId: string) => void;
  onAddToGroup: (conversationId: string, groupId: string) => void;
  onRemoveFromGroups: (conversationId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onCancelRenameGroup: () => void;
  onToggleGroup: (groupId: string) => void;
  onNewConversation: () => void;
  onSelectConversation: (conversation: Conversation) => void;
  onOpenPanel: (panel: ActivePanel) => void;
  onArchive: (conversation: Conversation) => void;
  onOpenContextMenu: (event: React.MouseEvent, conversation: Conversation) => void;
  onOpenGroupContextMenu: (event: React.MouseEvent, group: TabGroup) => void;
  onDeleteRequest: (conversation: Conversation) => void;
}

function Sidebar({
  conversations,
  pinnedConversationIds,
  tabGroups,
  renamingGroupId,
  collapsed,
  archivedCount,
  activeConversationId,
  activePanel,
  onDropBookmark,
  onCreateGroup,
  onAddToGroup,
  onRemoveFromGroups,
  onRenameGroup,
  onCancelRenameGroup,
  onToggleGroup,
  onNewConversation,
  onSelectConversation,
  onOpenPanel,
  onArchive,
  onOpenContextMenu,
  onOpenGroupContextMenu,
  onDeleteRequest,
}: SidebarProps) {
  const hoverGroupTimerRef = useRef<number | null>(null);
  const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null);
  const [groupingPreviewId, setGroupingPreviewId] = useState<string | null>(null);
  const [groupDropTargetId, setGroupDropTargetId] = useState<string | null>(null);
  const [standaloneDropActive, setStandaloneDropActive] = useState(false);
  const pinnedConversations = pinnedConversationIds
    .map((id) => conversations.find((conversation) => conversation.id === id))
    .filter((conversation): conversation is Conversation => Boolean(conversation));
  const groupedConversationIds = new Set(
    tabGroups.flatMap((group) => group.conversationIds)
  );
  const ungroupedConversations = conversations.filter(
    (item) =>
      !groupedConversationIds.has(item.id) && !pinnedConversationIds.includes(item.id)
  );

  function clearHoverGroupTimer() {
    if (hoverGroupTimerRef.current) {
      window.clearTimeout(hoverGroupTimerRef.current);
      hoverGroupTimerRef.current = null;
    }
    setGroupingPreviewId(null);
  }

  function getGroupIdForConversation(conversationId: string) {
    return tabGroups.find((group) => group.conversationIds.includes(conversationId))?.id;
  }

  function startConversationGroupHover(targetId: string) {
    if (!draggedConversationId || draggedConversationId === targetId) return;
    const sourceGroupId = getGroupIdForConversation(draggedConversationId);
    const targetGroupId = getGroupIdForConversation(targetId);
    if (sourceGroupId && sourceGroupId === targetGroupId) return;
    clearHoverGroupTimer();
    setGroupingPreviewId(targetId);
    hoverGroupTimerRef.current = window.setTimeout(() => {
      onCreateGroup(draggedConversationId, targetId);
      setGroupingPreviewId(null);
      hoverGroupTimerRef.current = null;
    }, 1000);
  }

  function conversationToLink(conversation: Conversation): LoomLink {
    return {
      id: conversation.id,
      type: "conversation",
      title: conversation.title,
      path: conversation.path,
      badge: "Conversation",
    };
  }

  function handleConversationDragStart(event: React.DragEvent, conversation: Conversation) {
    setDraggedConversationId(conversation.id);
    setLoomDragPayload(event, conversationToLink(conversation));
  }

  function handleConversationDragEnd() {
    setDraggedConversationId(null);
    setGroupDropTargetId(null);
    setStandaloneDropActive(false);
    clearHoverGroupTimer();
  }

  function renderConversationTab(conversation: Conversation) {
    const pinned = pinnedConversationIds.includes(conversation.id);
    const Icon = getConversationIconOption(conversation.iconKey).Icon;
    return (
      <div
        key={conversation.id}
        className={[
          "conversation-tab",
          conversation.id === activeConversationId ? "active" : "",
          groupingPreviewId === conversation.id ? "grouping-preview" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onContextMenu={(event) => onOpenContextMenu(event, conversation)}
        onDragEnter={() => startConversationGroupHover(conversation.id)}
        onDragOver={(event) => {
          if (draggedConversationId && draggedConversationId !== conversation.id) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            clearHoverGroupTimer();
          }
        }}
      >
        <button
          className="conversation-tab-main"
          draggable
          onDragStart={(event) => handleConversationDragStart(event, conversation)}
          onDragEnd={handleConversationDragEnd}
          onClick={() => onSelectConversation(conversation)}
          aria-label={`Open ${conversation.title}`}
          title={collapsed ? conversation.title : undefined}
        >
          <span className="conversation-favicon">
            <Icon size={13} />
          </span>
          <span className="conversation-tab-copy">
            <strong>{conversation.title}</strong>
            <small>{conversation.summary}</small>
          </span>
          <span className="conversation-tab-meta">
            {conversation.pinned && <em>Pinned</em>}
            {conversation.unread && <i aria-label="Unread" />}
          </span>
        </button>
        <div className="conversation-tab-actions">
          <button
            className="icon-button subtle"
            onClick={() => onArchive(conversation)}
            aria-label={`Archive ${conversation.title}`}
            title="Archive conversation"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <aside
      className={collapsed ? "sidebar collapsed" : "sidebar"}
      aria-label="Conversation library"
    >
      <div className="brand-row">
        <div className="brand-mark">L</div>
        <div>
          <div className="brand-name">Loom AI</div>
          <div className="brand-caption">Conversation Browser</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          className={activePanel === "bookmarks" ? "nav-row active" : "nav-row"}
          onClick={() => onOpenPanel("bookmarks")}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(LOOM_LINK_MIME)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(event) => {
            const link = getLoomDragPayload(event);
            if (!link) return;
            event.preventDefault();
            onDropBookmark(link);
          }}
        >
          <Bookmark size={16} />
          Bookmarks
        </button>
        <button
          className={activePanel === "history" ? "nav-row active" : "nav-row"}
          onClick={() => onOpenPanel("history")}
        >
          <History size={16} />
          Loom History
        </button>
        <button
          className={activePanel === "archive" ? "nav-row active" : "nav-row"}
          onClick={() => onOpenPanel("archive")}
        >
          <Archive size={16} />
          Archive
        </button>
      </nav>

      <div className="folder-list">
        {pinnedConversations.length > 0 && (
          <section className="pinned-tabs" aria-label="Pinned conversations">
            {pinnedConversations.map((conversation) => (
              <PinnedConversationTab
                key={`pinned-${conversation.id}`}
                conversation={conversation}
                active={conversation.id === activeConversationId}
                onSelect={onSelectConversation}
                onOpenContextMenu={onOpenContextMenu}
                onDragStart={handleConversationDragStart}
                onDragEnd={handleConversationDragEnd}
              />
            ))}
          </section>
        )}
        {tabGroups.map((group) => {
          const groupConversations = group.conversationIds
            .map((id) => conversations.find((conversation) => conversation.id === id))
            .filter((conversation): conversation is Conversation => Boolean(conversation));
          if (groupConversations.length === 0) return null;
          return (
            <section
              className={[
                "tab-group",
                groupDropTargetId === group.id ? "group-drop-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={group.id}
              onDragEnter={() => {
                if (draggedConversationId) setGroupDropTargetId(group.id);
              }}
              onDragOver={(event) => {
                if (draggedConversationId) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setGroupDropTargetId(null);
                }
              }}
              onDrop={(event) => {
                if (!draggedConversationId) return;
                event.preventDefault();
                onAddToGroup(draggedConversationId, group.id);
                setGroupDropTargetId(null);
              }}
            >
              <TabGroupHeader
                group={group}
                editing={renamingGroupId === group.id}
                onContextMenu={onOpenGroupContextMenu}
                onRename={onRenameGroup}
                onCancelRename={onCancelRenameGroup}
                onToggle={onToggleGroup}
              />
              {!group.collapsed && groupConversations.map(renderConversationTab)}
            </section>
          );
        })}
        <div
          className={standaloneDropActive ? "loose-tabs standalone-drop-zone active" : "loose-tabs standalone-drop-zone"}
          onDragEnter={() => {
            if (draggedConversationId) setStandaloneDropActive(true);
          }}
          onDragOver={(event) => {
            if (draggedConversationId) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setStandaloneDropActive(false);
            }
          }}
          onDrop={(event) => {
            if (!draggedConversationId) return;
            event.preventDefault();
            onRemoveFromGroups(draggedConversationId);
            setStandaloneDropActive(false);
          }}
        >
          {ungroupedConversations.map(renderConversationTab)}
        </div>
      </div>

      <div className="sidebar-bottom">
        <button className="new-chat-button" onClick={onNewConversation}>
          <Plus size={16} />
          <span>New Loom</span>
          <kbd>⌘ L</kbd>
        </button>
      </div>

      <div className="sidebar-footer">
        <div className="profile-dot">G</div>
        <div>
          <div className="footer-title">Personal web</div>
          <div className="footer-caption">Local prototype</div>
        </div>
      </div>
    </aside>
  );
}

function TabGroupHeader({
  group,
  editing,
  onContextMenu,
  onRename,
  onCancelRename,
  onToggle,
}: {
  group: TabGroup;
  editing: boolean;
  onContextMenu: (event: React.MouseEvent, group: TabGroup) => void;
  onRename: (groupId: string, name: string) => void;
  onCancelRename: () => void;
  onToggle: (groupId: string) => void;
}) {
  const [draft, setDraft] = useState(group.name);

  useEffect(() => {
    setDraft(group.name);
  }, [group.name, editing]);

  if (editing) {
    return (
      <div className="tab-group-header editing">
        <Folder size={13} />
        <input
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onRename(group.id, draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRename(group.id, draft);
            if (event.key === "Escape") onCancelRename();
          }}
          aria-label={`Rename ${group.name}`}
        />
      </div>
    );
  }

  return (
    <button
      className="tab-group-header"
      onClick={() => onToggle(group.id)}
      onContextMenu={(event) => onContextMenu(event, group)}
      aria-expanded={!group.collapsed}
      aria-label={`${group.collapsed ? "Expand" : "Collapse"} ${group.name}`}
    >
      <Folder size={13} />
      <span>{group.name}</span>
    </button>
  );
}

function PinnedConversationTab({
  conversation,
  active,
  onSelect,
  onOpenContextMenu,
  onDragStart,
  onDragEnd,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: (conversation: Conversation) => void;
  onOpenContextMenu: (event: React.MouseEvent, conversation: Conversation) => void;
  onDragStart: (event: React.DragEvent, conversation: Conversation) => void;
  onDragEnd: () => void;
}) {
  const Icon = getConversationIconOption(conversation.iconKey).Icon;
  return (
    <button
      className={active ? "pinned-tab active" : "pinned-tab"}
      draggable
      onDragStart={(event) => onDragStart(event, conversation)}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(conversation)}
      onContextMenu={(event) => onOpenContextMenu(event, conversation)}
      title={conversation.title}
      aria-label={`Open pinned ${conversation.title}`}
    >
      <Icon size={14} />
    </button>
  );
}

interface TopBrowserBarProps {
  addressBarRef: React.RefObject<HTMLDivElement>;
  location: string;
  path: string;
  addressFocused: boolean;
  addressQuery: string;
  suggestions: AddressSuggestion[];
  selectedSuggestion: number;
  canBack: boolean;
  canForward: boolean;
  graphMode: boolean;
  activePanel: ActivePanel;
  sidebarCollapsed: boolean;
  currentBookmarked: boolean;
  currentDestination: LoomLink;
  onAddressFocus: () => void;
  onAddressChange: (value: string) => void;
  onAddressKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onVisit: (destination: LoomLink | AddressSuggestion) => void;
  onBack: () => void;
  onForward: () => void;
  onContextNav: (event: React.MouseEvent, direction: NavigationDirection) => void;
  onBookmarkCurrent: () => void;
  onToggleSidebar: () => void;
  onTogglePanel: (panel: "bookmarks" | "history" | "looms") => void;
  onToggleGraph: () => void;
}

function TopBrowserBar({
  addressBarRef,
  location,
  path,
  addressFocused,
  addressQuery,
  suggestions,
  selectedSuggestion,
  canBack,
  canForward,
  graphMode,
  activePanel,
  sidebarCollapsed,
  currentBookmarked,
  currentDestination,
  onAddressFocus,
  onAddressChange,
  onAddressKeyDown,
  onVisit,
  onBack,
  onForward,
  onContextNav,
  onBookmarkCurrent,
  onToggleSidebar,
  onTogglePanel,
  onToggleGraph,
}: TopBrowserBarProps) {
  return (
    <header className="top-browser-bar">
      <div className="nav-cluster">
        <div className="chrome-product" aria-label="Loom browser chrome">
          <span className="chrome-window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <button
            className="chrome-sidebar-icon"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <PanelLeft size={15} />
          </button>
          <strong>Loom</strong>
        </div>
        <button
          className="icon-button"
          disabled={!canBack}
          onClick={onBack}
          onContextMenu={(event) => onContextNav(event, "back")}
          aria-label="Back"
          title="Back. Right-click for history."
        >
          <ArrowLeft size={17} />
        </button>
        <button
          className="icon-button"
          disabled={!canForward}
          onClick={onForward}
          onContextMenu={(event) => onContextNav(event, "forward")}
          aria-label="Forward"
          title="Forward. Right-click for history."
        >
          <ArrowRight size={17} />
        </button>
      </div>

      <div
        ref={addressBarRef}
        className={addressFocused ? "address-cluster focused" : "address-cluster"}
      >
        <button
          className={currentBookmarked ? "icon-button address-bookmark-button active" : "icon-button address-bookmark-button"}
          onClick={onBookmarkCurrent}
          aria-label={currentBookmarked ? "Loom address bookmarked" : "Bookmark current Loom address"}
          title={currentBookmarked ? "Loom address bookmarked" : "Bookmark current Loom address"}
        >
          <Bookmark size={15} />
        </button>
        <div className="address-shell">
          <span
            className="address-identity-drag"
            draggable
            onDragStart={(event) => setLoomDragPayload(event, currentDestination)}
            role="button"
            tabIndex={0}
            aria-label="Drag current Loom address"
            title="Drag current Loom address"
          >
            <Compass size={16} />
          </span>
          <input
            value={addressFocused ? addressQuery : ""}
            onChange={(event) => onAddressChange(event.target.value)}
            onFocus={onAddressFocus}
            onKeyDown={onAddressKeyDown}
            aria-label="Loom Address Bar"
            placeholder={addressFocused ? "Search, ask, or paste a Loom address" : location}
          />
          <span className="address-path">{addressFocused ? path : "loom addressable"}</span>
          {addressFocused && (
            <AddressSuggestionList
              suggestions={suggestions}
              selectedSuggestion={selectedSuggestion}
              onVisit={onVisit}
            />
          )}
        </div>
        <button className="icon-button address-share-button" aria-label="Share">
          <Share2 size={16} />
        </button>
      </div>

      <div className="top-actions">
        <button
          className={activePanel === "history" ? "chrome-button history-icon-button active" : "chrome-button history-icon-button"}
          onClick={() => onTogglePanel("history")}
          aria-label="Open Loom History"
          title="History"
        >
          <History size={16} />
        </button>
        <button
          className={activePanel === "looms" ? "chrome-button active" : "chrome-button"}
          onClick={() => onTogglePanel("looms")}
          aria-label="Open Weft"
          title="Weft"
        >
          <GitBranch size={16} />
        </button>
        <button
          className={graphMode ? "chrome-button active" : "chrome-button"}
          onClick={onToggleGraph}
          aria-label="Toggle Graph View"
        >
          <Map size={16} />
          Graph
        </button>
      </div>
    </header>
  );
}

function AddressSuggestionList({
  suggestions,
  selectedSuggestion,
  onVisit,
}: {
  suggestions: AddressSuggestion[];
  selectedSuggestion: number;
  onVisit: (destination: AddressSuggestion) => void;
}) {
  return (
    <div className="suggestion-popover" role="listbox">
      <div className="suggestion-heading">
        <span>Go somewhere in your AI web</span>
        <kbd>Enter</kbd>
      </div>
      {suggestions.length === 0 ? (
        <div className="empty-state">No matching Loom destinations.</div>
      ) : (
        suggestions.map((suggestion, index) => {
          const Icon = iconForType[suggestion.type];
          return (
            <button
              key={suggestion.id}
              className={
                index === selectedSuggestion
                  ? "suggestion-row selected"
                  : "suggestion-row"
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onVisit(suggestion)}
              role="option"
              aria-selected={index === selectedSuggestion}
            >
              <span className="suggestion-icon">
                <Icon size={16} />
              </span>
              <span className="suggestion-copy">
                <strong>{suggestion.title}</strong>
                <small>{suggestion.subtitle} · {suggestion.path}</small>
              </span>
              <span className={`badge ${suggestion.badge?.toLowerCase()}`}>
                {suggestion.badge}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function ChatTranscript({
  transcriptRef,
  conversation,
  responses,
  onLink,
  onAsk,
  onLoom,
  onToggleSuggestedBookmark,
  bookmarkedPaths,
  onSelectionAsk,
  responseTitleOverrides,
  onOpenContextMenu,
}: {
  transcriptRef?: (node: HTMLElement | null) => void;
  conversation?: Conversation;
  responses: ResponseItem[];
  onLink: (link: LoomLink) => void;
  onAsk: (response: ResponseItem) => void;
  onLoom: (response: ResponseItem) => void;
  onToggleSuggestedBookmark: (link: LoomLink) => void;
  bookmarkedPaths: Set<string>;
  onSelectionAsk: (response: ResponseItem) => void;
  responseTitleOverrides: Record<string, string>;
  onOpenContextMenu: (event: React.MouseEvent, response: ResponseItem) => void;
}) {
  if (!conversation) {
    return (
      <section className="chat-transcript empty-transcript" ref={transcriptRef}>
        <Boxes size={28} />
        <h1>No active conversation</h1>
        <p>Restore an archived conversation or open a saved destination.</p>
      </section>
    );
  }

  return (
    <section className="chat-transcript" ref={transcriptRef} aria-label="Conversation transcript">
      <div className="conversation-context">
        <span>{conversation.path}</span>
        <h1>{conversation.title}</h1>
        <p>{conversation.summary}</p>
      </div>

      {responses.map((response) => {
        const displayResponse = {
          ...response,
          title: responseTitleOverrides[response.id] ?? response.title,
        };
        const isBookmarkedResponse = bookmarkedPaths.has(displayResponse.address);
        return (
          <article
            className="qa-item"
            key={response.id}
            data-response-address={displayResponse.address}
            onMouseUp={() => onSelectionAsk(displayResponse)}
            onContextMenu={(event) => onOpenContextMenu(event, displayResponse)}
          >
            <div className="user-message">
              <p>{displayResponse.question}</p>
            </div>

            <div className="assistant-message">
              {isBookmarkedResponse && (
                <div className="assistant-header">
                  <div>
                    <div className="semantic-title">{displayResponse.title}</div>
                    <div className="loom-address">{displayResponse.address}</div>
                  </div>
                  <ResponseActions response={displayResponse} />
                </div>
              )}
              <div className="assistant-body">
                {displayResponse.answer.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>

              <div className="reference-strip">
                <button
                  className={isBookmarkedResponse ? "link-chip response-bookmark-chip bookmarked" : "link-chip response-bookmark-chip"}
                  onClick={() => onToggleSuggestedBookmark(toLinkFromResponse(displayResponse))}
                  aria-pressed={isBookmarkedResponse}
                  aria-label={isBookmarkedResponse ? `Remove bookmark for ${displayResponse.title}` : `Bookmark suggested ${displayResponse.title}`}
                >
                  <Bookmark size={13} fill={isBookmarkedResponse ? "currentColor" : "none"} />
                  {isBookmarkedResponse ? (
                    <strong>Bookmark</strong>
                  ) : displayResponse.suggestedLinks[0] ? (
                    <>
                      <em>Suggested</em>
                      <Sparkles size={13} />
                      <span>{displayResponse.suggestedLinks[0].title}</span>
                    </>
                  ) : (
                    <strong>Bookmark</strong>
                  )}
                </button>
                <button
                  className="link-chip response-action-chip"
                  onClick={() => onLink(toLinkFromResponse(displayResponse))}
                >
                  <Link2 size={13} />
                  <strong>Link</strong>
                </button>
                <button
                  className="link-chip response-action-chip"
                  onClick={() => onAsk(displayResponse)}
                >
                  <MessageSquare size={13} />
                  <strong>Ask</strong>
                </button>
                <button
                  className="link-chip response-action-chip"
                  onClick={() => onLoom(displayResponse)}
                >
                  <GitFork size={13} />
                  <strong>Weft</strong>
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function ResponseActions({
  response,
}: {
  response: ResponseItem;
}) {
  return (
    <div className="response-actions" aria-label={`Actions for ${response.title}`}>
      <button aria-label="More response actions">
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}

function PromptComposer({
  variant = "bottom",
  draftKey,
  draft,
  attachedReferences,
  referenceOptions,
  onDraftChange,
  onRemoveLink,
  onRemoveAttachedReference,
  onReadyToFocus,
  onDropLink,
  onSend,
  onUserTyping,
}: {
  variant?: "bottom" | "centered";
  draftKey: string;
  draft: ComposerDraft;
  attachedReferences: LoomLink[];
  referenceOptions: ComposerReferenceOption[];
  onDraftChange: (draft: ComposerDraft) => void;
  onRemoveLink: (link: LoomLink) => void;
  onRemoveAttachedReference: (link: LoomLink) => void;
  onReadyToFocus: (focus: () => void) => void;
  onDropLink: (link: LoomLink) => void;
  onSend: (draft: ComposerDraft) => void;
  onUserTyping: () => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const referenceDropdownRef = useRef<HTMLDivElement | null>(null);
  const insertedPathsRef = useRef<Set<string>>(new Set());
  const activeDraftKeyRef = useRef("");
  const historiesRef = useRef<Record<string, ComposerHistoryState>>({});
  const applyingHistoryRef = useRef(false);
  const pendingInputRef = useRef<{
    inputType: string;
    replacesSelection: boolean;
  } | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceSearch, setReferenceSearch] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [model, setModel] = useState("Loom Auto");

  useEffect(() => {
    onReadyToFocus(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }, [onReadyToFocus]);

  const filteredMentionOptions = useMemo(() => {
    const query = mention?.query.trim().toLowerCase() ?? "";
    return referenceOptions.filter((option) =>
      query
        ? [option.title, option.subtitle, option.path, option.group]
            .join(" ")
            .toLowerCase()
            .includes(query)
        : true
    );
  }, [mention?.query, referenceOptions]);

  const groupedMentionOptions = useMemo(() => {
    const groups: ComposerReferenceGroup[] = ["Conversations", "Looms", "Bookmarks"];
    return groups
      .map((group) => ({
        group,
        options: filteredMentionOptions.filter((option) => option.group === group),
      }))
      .filter((group) => group.options.length > 0);
  }, [filteredMentionOptions]);

  const flattenedMentionOptions = groupedMentionOptions.flatMap((group) => group.options);

  const filteredLinkedReferences = useMemo(() => {
    const allReferences = [...attachedReferences, ...draft.links];
    const query = referenceSearch.trim().toLowerCase();
    if (!query) return allReferences;
    return allReferences.filter((link) =>
      [link.title, link.path, link.badge]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [attachedReferences, draft.links, referenceSearch]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        referencePickerOpen &&
        referenceDropdownRef.current &&
        !referenceDropdownRef.current.contains(event.target as Node)
      ) {
        setReferencePickerOpen(false);
      }
      if (
        mention &&
        surfaceRef.current &&
        !surfaceRef.current.contains(event.target as Node)
      ) {
        setMention(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMention(null);
        setReferencePickerOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mention, referencePickerOpen]);

  function makeToken(link: LoomLink) {
    const token = document.createElement("span");
    token.className = "inline-loom-token";
    token.contentEditable = "false";
    token.draggable = true;
    token.dataset.loomId = link.id;
    token.dataset.loomPath = link.path;
    token.dataset.loomTitle = link.title;
    token.dataset.loomType = link.type;
    if (link.badge) token.dataset.loomBadge = link.badge;
    token.title = toLoomMarkdown(link);
    token.textContent = `[[${link.title}]]`;
    return token;
  }

  function sameDraft(a: ComposerDraft, b: ComposerDraft) {
    if (a.html !== b.html) return false;
    if (a.links.length !== b.links.length) return false;
    return a.links.every((link, index) => {
      const other = b.links[index];
      return (
        other &&
        link.path === other.path &&
        link.title === other.title &&
        link.type === other.type &&
        link.badge === other.badge
      );
    });
  }

  function sameLinkSet(a: LoomLink[], b: LoomLink[]) {
    if (a.length !== b.length) return false;
    const aPaths = [...a.map((link) => link.path)].sort();
    const bPaths = [...b.map((link) => link.path)].sort();
    return aPaths.every((path, index) => path === bPaths[index]);
  }

  function getCaretOffset() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return 0;
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(editor);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  }

  function getHistoryState() {
    const existing = historiesRef.current[draftKey];
    if (existing) return existing;
    const initial = draft;
    const next: ComposerHistoryState = { entries: [initial], index: 0 };
    historiesRef.current[draftKey] = next;
    return next;
  }

  function syncInsertedPaths(nextDraft: ComposerDraft) {
    insertedPathsRef.current = new Set(nextDraft.links.map((link) => link.path));
  }

  function applyDraftSnapshot(nextDraft: ComposerDraft) {
    const editor = editorRef.current;
    if (!editor) return;
    applyingHistoryRef.current = true;
    editor.innerHTML = nextDraft.html;
    syncInsertedPaths(nextDraft);
    onDraftChange(nextDraft);
    window.requestAnimationFrame(() => {
      applyingHistoryRef.current = false;
    });
  }

  function shouldCoalesceHistory(
    history: ComposerHistoryState,
    intent: ComposerEditIntent,
    meta: ComposerHistoryMeta
  ) {
    const previous = history.lastMeta;
    if (!previous) return false;
    if (intent !== "text" || previous.intent !== "text") return false;
    if (meta.direction !== previous.direction) return false;
    if (meta.at - previous.at > 1100) return false;
    return Math.abs(meta.caret - previous.caret) <= 48;
  }

  function commitDraftChange(intent: ComposerEditIntent) {
    if (applyingHistoryRef.current) return;
    const nextDraft = extractDraftFromEditor();
    syncInsertedPaths(nextDraft);
    const history = getHistoryState();
    const current = history.entries[history.index] ?? EMPTY_COMPOSER_DRAFT;
    if (sameDraft(current, nextDraft)) {
      onDraftChange(nextDraft);
      return;
    }
    const direction: ComposerHistoryMeta["direction"] =
      intent === "text"
        ? nextDraft.html.length >= current.html.length
          ? "insert"
          : "delete"
        : "structural";
    const meta: ComposerHistoryMeta = {
      intent,
      at: Date.now(),
      caret: getCaretOffset(),
      direction,
    };
    const entries = history.entries.slice(0, history.index + 1);
    if (shouldCoalesceHistory(history, intent, meta)) {
      entries[entries.length - 1] = nextDraft;
      history.entries = entries;
      history.index = entries.length - 1;
    } else {
      history.entries = [...entries, nextDraft];
      history.index = history.entries.length - 1;
    }
    history.lastMeta = meta;
    onDraftChange(nextDraft);
  }

  function undoComposer() {
    const history = getHistoryState();
    if (history.index <= 0) return;
    history.index -= 1;
    history.lastMeta = undefined;
    applyDraftSnapshot(history.entries[history.index]);
  }

  function redoComposer() {
    const history = getHistoryState();
    if (history.index >= history.entries.length - 1) return;
    history.index += 1;
    history.lastMeta = undefined;
    applyDraftSnapshot(history.entries[history.index]);
  }

  function extractDraftFromEditor(): ComposerDraft {
    const editor = editorRef.current;
    if (!editor) return draft;
    const linksByPath = new globalThis.Map<string, LoomLink>();
    editor.querySelectorAll<HTMLElement>(".inline-loom-token").forEach((token) => {
      const path = token.dataset.loomPath;
      const title = token.dataset.loomTitle;
      const type = token.dataset.loomType as LoomObjectType | undefined;
      if (!path || !title || !type) return;
      linksByPath.set(path, {
        id: token.dataset.loomId ?? path,
        type,
        title,
        path,
        badge: token.dataset.loomBadge,
      });
    });
    return {
      html: editor.innerHTML,
      links: Array.from(linksByPath.values()),
    };
  }

  function emitDraftChange() {
    syncInsertedPaths(extractDraftFromEditor());
    onDraftChange(extractDraftFromEditor());
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (activeDraftKeyRef.current !== draftKey) {
      activeDraftKeyRef.current = draftKey;
      if (!historiesRef.current[draftKey]) {
        historiesRef.current[draftKey] = { entries: [draft], index: 0 };
      }
      editor.innerHTML = draft.html;
      syncInsertedPaths(draft);
    }

    let insertedExternalReference = false;
    draft.links.forEach((link) => {
      if (!insertedPathsRef.current.has(link.path)) {
        insertTokenAtEnd(link);
        insertedExternalReference = true;
      }
    });

    let removedExternalReference = false;
    Array.from(insertedPathsRef.current).forEach((path) => {
      if (!draft.links.some((link) => link.path === path)) {
        editor
          .querySelectorAll(`[data-loom-path="${CSS.escape(path)}"]`)
          .forEach((node) => node.remove());
        insertedPathsRef.current.delete(path);
        removedExternalReference = true;
      }
    });

    if (insertedExternalReference || removedExternalReference) {
      window.requestAnimationFrame(() =>
        commitDraftChange(
          insertedExternalReference ? "external-reference" : "reference-remove-dropdown"
        )
      );
    }
  }, [draftKey, draft.links]);

  function placeCaretAfter(node: Node) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertTokenAtRange(
    link: LoomLink,
    range: Range,
    intent: ComposerEditIntent = "reference-insert"
  ) {
    const token = makeToken(link);
    range.deleteContents();
    range.insertNode(document.createTextNode(" "));
    range.insertNode(token);
    placeCaretAfter(token);
    insertedPathsRef.current.add(link.path);
    onDropLink(link);
    window.requestAnimationFrame(() => commitDraftChange(intent));
    setMention(null);
  }

  function insertTokenAtEnd(link: LoomLink) {
    const editor = editorRef.current;
    if (!editor) return;
    const token = makeToken(link);
    if (editor.textContent?.trim()) editor.append(document.createTextNode(" "));
    editor.append(token, document.createTextNode(" "));
    insertedPathsRef.current.add(link.path);
  }

  function getDropRange(event: React.DragEvent) {
    const editor = editorRef.current;
    if (!editor) return null;
    const documentAtPoint = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
    };
    const pointRange = documentAtPoint.caretRangeFromPoint?.(
      event.clientX,
      event.clientY
    );
    if (pointRange && editor.contains(pointRange.startContainer)) return pointRange;
    const caretPosition = documentAtPoint.caretPositionFromPoint?.(
      event.clientX,
      event.clientY
    );
    if (caretPosition && editor.contains(caretPosition.offsetNode)) {
      const range = document.createRange();
      range.setStart(caretPosition.offsetNode, caretPosition.offset);
      range.collapse(true);
      return range;
    }
    const selection = window.getSelection();
    if (
      selection &&
      selection.rangeCount > 0 &&
      editor.contains(selection.getRangeAt(0).startContainer)
    ) {
      return selection.getRangeAt(0).cloneRange();
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }

  function getMentionRange() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editorRef.current?.contains(range.startContainer)) return null;

    let textNode = range.startContainer;
    let offset = range.startOffset;
    if (textNode.nodeType !== Node.TEXT_NODE) {
      const fallbackNode = Array.from(textNode.childNodes)
        .slice(0, Math.max(offset, 1))
        .reverse()
        .find((node) => node.nodeType === Node.TEXT_NODE);
      if (!fallbackNode) return null;
      textNode = fallbackNode;
      offset = fallbackNode.textContent?.length ?? 0;
    }

    const text = textNode.textContent ?? "";
    const beforeCaret = text.slice(0, offset);
    const match = beforeCaret.match(/(?:^|\s)#([^\s#]*)$/);
    if (!match) return null;
    const query = match[1] ?? "";
    const hashIndex = beforeCaret.lastIndexOf("#");
    const mentionRange = document.createRange();
    mentionRange.setStart(textNode, hashIndex);
    mentionRange.setEnd(textNode, offset);
    return { query, range: mentionRange };
  }

  function updateMention() {
    const match = getMentionRange();
    if (!match || !surfaceRef.current) {
      setMention(null);
      return;
    }
    const rect = match.range.getBoundingClientRect();
    const surfaceRect = surfaceRef.current.getBoundingClientRect();
    setMention((current) => ({
      query: match.query,
      range: match.range.cloneRange(),
      selectedIndex: current?.query === match.query ? current.selectedIndex : 0,
      x: Math.max(10, rect.left - surfaceRect.left),
      y: Math.max(42, rect.bottom - surfaceRect.top + 8),
    }));
  }

  function selectMentionOption(option: ComposerReferenceOption) {
    const range = mention?.range;
    if (!range) return;
    insertTokenAtRange(option, range);
  }

  function submitComposer() {
    const nextDraft = extractDraftFromEditor();
    onDraftChange(nextDraft);
    onUserTyping();
    onSend(nextDraft);
    applyDraftSnapshot({ html: "", links: [] });
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redoComposer();
      else undoComposer();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redoComposer();
      return;
    }
    if (!mention && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitComposer();
      return;
    }
    if (!mention) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMention((current) =>
        current
          ? {
              ...current,
              selectedIndex: Math.min(
                current.selectedIndex + 1,
                flattenedMentionOptions.length - 1
              ),
            }
          : current
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMention((current) =>
        current
          ? { ...current, selectedIndex: Math.max(current.selectedIndex - 1, 0) }
          : current
      );
    }
    if (event.key === "Enter" && flattenedMentionOptions[mention.selectedIndex]) {
      event.preventDefault();
      selectMentionOption(flattenedMentionOptions[mention.selectedIndex]);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMention(null);
    }
  }

  function handleEditorDragStart(event: React.DragEvent<HTMLDivElement>) {
    const token = (event.target as HTMLElement).closest<HTMLElement>(".inline-loom-token");
    if (!token) return;
    const path = token.dataset.loomPath;
    const title = token.dataset.loomTitle;
    const type = token.dataset.loomType as LoomObjectType | undefined;
    if (!path || !title || !type) return;
    setLoomDragPayload(event, {
      id: token.dataset.loomId ?? path,
      type,
      title,
      path,
      badge: token.dataset.loomBadge,
    });
    event.dataTransfer.setData("application/loom-token-path", path);
  }

  function removeLinkedReference(link: LoomLink) {
    if (attachedReferences.some((item) => item.path === link.path)) {
      onRemoveAttachedReference(link);
      return;
    }
    editorRef.current
      ?.querySelectorAll(`[data-loom-path="${CSS.escape(link.path)}"]`)
      .forEach((node) => node.remove());
    insertedPathsRef.current.delete(link.path);
    window.requestAnimationFrame(() => commitDraftChange("reference-remove-dropdown"));
  }

  return (
    <section
      className={variant === "centered" ? "prompt-composer centered" : "prompt-composer"}
      aria-label="Prompt composer"
    >
      <div
        ref={surfaceRef}
        className={dragActive ? "prompt-surface drag-over" : "prompt-surface"}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes(LOOM_LINK_MIME)) {
            event.preventDefault();
            setDragActive(true);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(LOOM_LINK_MIME)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          const link = getLoomDragPayload(event);
          if (!link) return;
          event.preventDefault();
          setDragActive(false);
          const movedTokenPath = event.dataTransfer.getData("application/loom-token-path");
          if (movedTokenPath) {
            editorRef.current
              ?.querySelectorAll(`[data-loom-path="${CSS.escape(movedTokenPath)}"]`)
              .forEach((node) => node.remove());
            insertedPathsRef.current.delete(movedTokenPath);
          }
          const range = getDropRange(event);
          if (range) {
            insertTokenAtRange(
              link,
              range,
              movedTokenPath ? "reference-move" : "reference-insert"
            );
          } else {
            insertTokenAtEnd(link);
            onDropLink(link);
            window.requestAnimationFrame(() =>
              commitDraftChange(movedTokenPath ? "reference-move" : "reference-insert")
            );
          }
        }}
      >
        {attachedReferences.length > 0 && (
          <div className="attached-reference-row" aria-label="Attached references">
            {attachedReferences.map((link) => (
              <span
                className="selection-reference-chip"
                key={`${link.id}-${link.path}`}
                title={link.title}
              >
                <FileText size={13} />
                <span>{link.title}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachedReference(link)}
                  aria-label={`Remove ${link.title}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div
          ref={editorRef}
          className="prompt-editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          tabIndex={0}
          aria-label="Prompt"
          data-placeholder="Ask anything, or reference a Loom conversation with #..."
          onBeforeInput={(event) => {
            const selection = window.getSelection();
            pendingInputRef.current = {
              inputType: (event.nativeEvent as InputEvent).inputType ?? "",
              replacesSelection: Boolean(selection && !selection.isCollapsed),
            };
          }}
          onInput={() => {
            updateMention();
            const nextDraft = extractDraftFromEditor();
            const history = getHistoryState();
            const previousDraft = history.entries[history.index] ?? EMPTY_COMPOSER_DRAFT;
            const inputType = pendingInputRef.current?.inputType ?? "";
            const linkSetChanged = !sameLinkSet(previousDraft.links, nextDraft.links);
            const intent: ComposerEditIntent = linkSetChanged
              ? "reference-delete"
              : inputType.includes("Paste")
                ? "paste"
                : pendingInputRef.current?.replacesSelection
                  ? "replace"
                  : "text";
            commitDraftChange(intent);
            pendingInputRef.current = null;
          }}
          onKeyUp={updateMention}
          onClick={updateMention}
          onKeyDown={handleEditorKeyDown}
          onDragStart={handleEditorDragStart}
        >
        </div>

        {mention && (
          <ComposerMentionMenu
            mention={mention}
            groups={groupedMentionOptions}
            selectedOption={flattenedMentionOptions[mention.selectedIndex]}
            onSelect={selectMentionOption}
          />
        )}

        <div className="composer-footer">
          <button
            className="composer-icon-action"
            aria-label="Attach"
            title="Attach"
            onClick={() => undefined}
          >
            <Plus size={16} />
          </button>
          <div className="linked-reference-anchor" ref={referenceDropdownRef}>
            <button
              className={referencePickerOpen ? "reference-globe active" : "reference-globe"}
              onClick={() => setReferencePickerOpen((current) => !current)}
              aria-label="References"
              title="References"
            >
              <Globe2 size={15} />
              <span>References</span>
              {draft.links.length + attachedReferences.length > 0 && (
                <em>{draft.links.length + attachedReferences.length}</em>
              )}
            </button>
            {referencePickerOpen && (
              <LinkedReferenceDropdown
                links={filteredLinkedReferences}
                query={referenceSearch}
                onQueryChange={setReferenceSearch}
                onRemove={removeLinkedReference}
              />
            )}
          </div>
          <span>Type # to insert Loom references inline.</span>
          <select
            className="model-select"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            aria-label="Select model"
          >
            <option>Loom Auto</option>
            <option>Deep Research</option>
            <option>Fast Draft</option>
          </select>
          <button className="composer-icon-action" aria-label="Voice input" title="Voice input">
            <Mic size={15} />
          </button>
          <button
            className="send-button"
            aria-label="Send"
            onClick={submitComposer}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}

function ComposerMentionMenu({
  mention,
  groups,
  selectedOption,
  onSelect,
}: {
  mention: MentionState;
  groups: Array<{ group: ComposerReferenceGroup; options: ComposerReferenceOption[] }>;
  selectedOption?: ComposerReferenceOption;
  onSelect: (option: ComposerReferenceOption) => void;
}) {
  return (
    <div
      className="composer-mention-menu"
      style={{ left: mention.x, top: mention.y }}
      role="listbox"
      aria-label="Loom reference suggestions"
    >
      {groups.length === 0 ? (
        <div className="composer-mention-empty">No Loom references found.</div>
      ) : (
        groups.map((group) => (
          <div className="mention-group" key={group.group}>
            <div className="mention-group-title">{group.group}</div>
            {group.options.map((option) => {
              const Icon = iconForType[option.type];
              const selected = selectedOption?.path === option.path;
              return (
                <button
                  key={`${group.group}-${option.path}`}
                  className={selected ? "mention-option selected" : "mention-option"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(option)}
                  role="option"
                  aria-selected={selected}
                >
                  <Icon size={14} />
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.subtitle}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

function LinkedReferenceDropdown({
  links,
  query,
  onQueryChange,
  onRemove,
}: {
  links: LoomLink[];
  query: string;
  onQueryChange: (query: string) => void;
  onRemove: (link: LoomLink) => void;
}) {
  return (
    <div className="linked-reference-dropdown">
      <label className="linked-reference-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search linked references"
          aria-label="Search linked references"
        />
      </label>
      <div className="linked-reference-list">
        {links.length === 0 ? (
          <div className="empty-state">No linked references.</div>
        ) : (
          links.map((link) => {
            const Icon = iconForType[link.type];
            return (
              <div className="linked-reference-row" key={`${link.id}-${link.path}`}>
                <Icon size={14} />
                <span>
                  <strong>{link.title}</strong>
                  <small>{link.path}</small>
                </span>
                <button onClick={() => onRemove(link)} aria-label={`Remove ${link.title}`}>
                  <X size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function RightPanel({
  activePanel,
  bookmarks,
  history,
  lineageRoot,
  activeDestination,
  archived,
  onClose,
  onVisit,
  onInsert,
  onBookmark,
  onOpenGraph,
  onRenameBookmark,
  onRemoveBookmark,
  onOpenBookmarkMenu,
  onDropBookmark,
  onRestore,
  onDeleteRequest,
}: {
  activePanel: ActivePanel;
  bookmarks: BookmarkItem[];
  history: HistoryEntry[];
  lineageRoot: LineageNode | null;
  activeDestination: LoomLink;
  archived: Conversation[];
  onClose: () => void;
  onVisit: (destination: LoomLink) => void;
  onInsert: (destination: LoomLink) => void;
  onBookmark: (destination: LoomLink) => void;
  onOpenGraph: (destination: LoomLink) => void;
  onRenameBookmark: (bookmark: BookmarkItem) => void;
  onRemoveBookmark: (bookmark: BookmarkItem) => void;
  onOpenBookmarkMenu: (event: React.MouseEvent, bookmark: BookmarkItem) => void;
  onDropBookmark: (link: LoomLink) => void;
  onRestore: (conversation: Conversation) => void;
  onDeleteRequest: (conversation: Conversation) => void;
}) {
  const [bookmarkDragActive, setBookmarkDragActive] = useState(false);

  if (!activePanel) return null;
  const panelLabel =
    activePanel === "bookmarks"
      ? "Bookmarks"
      : activePanel === "history"
        ? "Loom History"
        : activePanel === "looms"
          ? "Weft"
          : "Archive";

  return (
    <aside className="right-panel" aria-label={`${panelLabel} panel`}>
      <div className="panel-header">
        <div>
          <span>{panelLabel}</span>
          <h2>
            {activePanel === "bookmarks" && "Saved destinations"}
            {activePanel === "history" && "Loom History"}
            {activePanel === "looms" && "Looms"}
            {activePanel === "archive" && "Archived conversations"}
          </h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close panel">
          <X size={16} />
        </button>
      </div>

      {activePanel === "bookmarks" && (
        <div
          className={bookmarkDragActive ? "panel-list bookmark-drop-target drag-over" : "panel-list bookmark-drop-target"}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes(LOOM_LINK_MIME)) {
              event.preventDefault();
              setBookmarkDragActive(true);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(LOOM_LINK_MIME)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setBookmarkDragActive(false);
            }
          }}
          onDrop={(event) => {
            const link = getLoomDragPayload(event);
            if (!link) return;
            event.preventDefault();
            setBookmarkDragActive(false);
            onDropBookmark(link);
          }}
        >
          {bookmarks.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              onVisit={onVisit}
              onRemove={onRemoveBookmark}
              onOpenContextMenu={onOpenBookmarkMenu}
            />
          ))}
        </div>
      )}

      {activePanel === "history" && (
        <div className="panel-list">
          {history.map((entry) => {
            const Icon = iconForType[entry.type];
            return (
              <button
                key={entry.id}
                className="history-row"
                draggable
                onDragStart={(event) => setLoomDragPayload(event, entry)}
                onClick={() => onVisit(entry)}
              >
                <Icon size={15} />
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.path}</small>
                </span>
                <em>{entry.visitedAt}</em>
              </button>
            );
          })}
        </div>
      )}

      {activePanel === "looms" && (
        <LoomsPanel
          root={lineageRoot}
          activePath={activeDestination.path}
          onVisit={onVisit}
          onBookmark={onBookmark}
          onOpenGraph={onOpenGraph}
        />
      )}

      {activePanel === "archive" && (
        <div className="panel-list">
          {archived.length === 0 ? (
            <div className="empty-state">Archived conversations will appear here.</div>
          ) : (
            archived.map((conversation) => (
              <div className="archive-row" key={conversation.id}>
                <div>
                  <strong>{conversation.title}</strong>
                  <small>{conversation.path}</small>
                </div>
                <div className="archive-actions">
                  <Tooltip label="Restore">
                    <button
                      className="archive-icon-button"
                      onClick={() => onRestore(conversation)}
                      aria-label={`Restore ${conversation.title}`}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </Tooltip>
                  <button
                    className="archive-icon-button danger"
                    onClick={() => onDeleteRequest(conversation)}
                    aria-label={`Delete ${conversation.title}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
}

function LoomsPanel({
  root,
  activePath,
  onVisit,
  onBookmark,
  onOpenGraph,
}: {
  root: LineageNode | null;
  activePath: string;
  onVisit: (destination: LoomLink) => void;
  onBookmark: (destination: LoomLink) => void;
  onOpenGraph: (destination: LoomLink) => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: LineageNode } | null>(null);

  function nodeToLink(node: LineageNode): LoomLink {
    return {
      id: node.id,
      type:
        node.type === "conversation"
          ? "conversation"
          : node.type === "response"
            ? "response"
            : "loom",
      title: node.title,
      path: node.path,
      badge: node.type === "loom" ? "Loom" : node.type === "response" ? "Response" : "Conversation",
    };
  }

  function containsActive(node: LineageNode): boolean {
    return node.path === activePath || node.children.some(containsActive);
  }

  function collectIds(node: LineageNode): string[] {
    return [node.id, ...node.children.flatMap(collectIds)];
  }

  function collectCollapsibleIds(node: LineageNode): string[] {
    return [
      ...(node.children.length > 0 ? [node.id] : []),
      ...node.children.flatMap(collectCollapsibleIds),
    ];
  }

  function flatten(node: LineageNode, depth = 0, parentId: string | null = null): VisibleLineageNode[] {
    const collapsed = collapsedIds.has(node.id);
    const current: VisibleLineageNode = {
      node,
      depth,
      parentId,
      lane: depth,
      hasChildren: node.children.length > 0,
      collapsed,
      active: node.path === activePath,
      inActiveLineage: containsActive(node),
      activeDescendantHidden: collapsed && node.path !== activePath && containsActive(node),
    };
    if (collapsed) return [current];
    return [current, ...node.children.flatMap((child) => flatten(child, depth + 1, node.id))];
  }

  const visibleNodes = useMemo(() => (root ? flatten(root) : []), [root, collapsedIds, activePath]);
  const focusLane =
    visibleNodes.find((item) => item.node.id === selectedId)?.lane ??
    visibleNodes.find((item) => item.active)?.lane ??
    0;
  const maxLane = Math.max(0, ...visibleNodes.map((item) => item.lane));
  const laneWindowStart = clampNumber(
    focusLane - (LOOMS_MAX_VISIBLE_LANES - 1),
    0,
    Math.max(0, maxLane - (LOOMS_MAX_VISIBLE_LANES - 1))
  );
  const laneWindowEnd = laneWindowStart + LOOMS_MAX_VISIBLE_LANES - 1;
  const [logViewportHeight, setLogViewportHeight] = useState(0);
  const [contentOverlayHeight, setContentOverlayHeight] = useState(LOOMS_ROW_HEIGHT);
  const [rowMeasurements, setRowMeasurements] = useState<Record<string, MeasuredLoomRow>>({});
  const selectedIndex = Math.max(
    0,
    visibleNodes.findIndex((item) => item.node.id === selectedId)
  );
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new globalThis.Map<string, HTMLDivElement>());
  const activeScrollNode =
    visibleNodes.find((item) => item.active) ??
    visibleNodes.find((item) => item.activeDescendantHidden);

  const registerRowRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) rowRefs.current.set(id, element);
    else rowRefs.current.delete(id);
  }, []);

  const measureVisibleRows = useCallback(() => {
    const scrollBody = scrollBodyRef.current;
    if (!scrollBody) return;

    const scrollRect = scrollBody.getBoundingClientRect();
    const nextMeasurements: Record<string, MeasuredLoomRow> = {};

    visibleNodes.forEach((item) => {
      const rowElement = rowRefs.current.get(item.node.id);
      if (!rowElement) return;
      const rowRect = rowElement.getBoundingClientRect();
      const top = rowRect.top - scrollRect.top + scrollBody.scrollTop;
      const height = rowRect.height;
      nextMeasurements[item.node.id] = {
        id: item.node.id,
        top,
        height,
        centerY: top + height / 2,
      };
    });

    const measuredContentHeight = Math.max(
      LOOMS_ROW_HEIGHT,
      scrollBody.clientHeight,
      ...Object.values(nextMeasurements).map((row) => row.top + row.height)
    );

    setRowMeasurements(nextMeasurements);
    setContentOverlayHeight(measuredContentHeight);
    setLogViewportHeight(scrollBody.clientHeight);
  }, [visibleNodes]);

  useEffect(() => {
    if (!menu) return;
    function closeMenu(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".loom-node-menu")) return;
      setMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  useEffect(() => {
    if (!visibleNodes.length) return;
    const activeNode = visibleNodes.find((item) => item.active);
    setSelectedId((current) =>
      current && visibleNodes.some((item) => item.node.id === current)
        ? current
        : activeNode?.node.id ?? visibleNodes[0].node.id
    );
  }, [activePath, visibleNodes.length]);

  useEffect(() => {
    if (!activeScrollNode || !scrollBodyRef.current) return;
    const container = scrollBodyRef.current;
    const row = scrollBodyRef.current.querySelector<HTMLElement>(
      `[data-lineage-node-id="${activeScrollNode.node.id}"]`
    );
    if (!row) return;
    const top = row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [activeScrollNode?.node.id]);

  useLayoutEffect(() => {
    measureVisibleRows();
  }, [measureVisibleRows, selectedId, collapsedIds]);

  useEffect(() => {
    const container = scrollBodyRef.current;
    if (!container) return;

    const updateMeasurements = () => {
      measureVisibleRows();
    };

    updateMeasurements();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateMeasurements);
      return () => window.removeEventListener("resize", updateMeasurements);
    }

    const observer = new ResizeObserver(updateMeasurements);
    observer.observe(container);
    rowRefs.current.forEach((rowElement) => observer.observe(rowElement));
    return () => observer.disconnect();
  }, [measureVisibleRows]);

  if (!root) {
    return (
      <div className="looms-empty">
        <GitBranch size={22} />
        <p>No active lineage yet.</p>
      </div>
    );
  }

  function toggleNode(node: LineageNode) {
    if (node.children.length === 0) return;
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }

  function focusActiveLineage() {
    if (!root) return;
    function findNode(node: LineageNode, id: string): LineageNode | null {
      if (node.id === id) return node;
      for (const child of node.children) {
        const match = findNode(child, id);
        if (match) return match;
      }
      return null;
    }
    setCollapsedIds(new Set(collectCollapsibleIds(root).filter((id) => {
      const node = findNode(root, id);
      return node ? !containsActive(node) : false;
    })));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const current = visibleNodes[selectedIndex];
    if (!current) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedId(visibleNodes[Math.min(selectedIndex + 1, visibleNodes.length - 1)].node.id);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedId(visibleNodes[Math.max(selectedIndex - 1, 0)].node.id);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (current.hasChildren && !current.collapsed) toggleNode(current.node);
      else {
        const parent = [...visibleNodes]
          .slice(0, selectedIndex)
          .reverse()
          .find((item) => item.depth < current.depth);
        if (parent) setSelectedId(parent.node.id);
      }
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (current.hasChildren && current.collapsed) toggleNode(current.node);
      else if (visibleNodes[selectedIndex + 1]?.depth > current.depth) {
        setSelectedId(visibleNodes[selectedIndex + 1].node.id);
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onVisit(nodeToLink(current.node));
    }
  }

  function handleMenuAction(action: string) {
    if (!menu || !root) return;
    const { node } = menu;
    if (action === "open") onVisit(nodeToLink(node));
    if (action === "graph") onOpenGraph(nodeToLink(node));
    if (action === "bookmark") onBookmark(nodeToLink(node));
    if (action === "copy") void browserHostShell.copyText(node.path);
    if (action === "collapse") setCollapsedIds((current) => new Set([...current, node.id]));
    if (action === "expand") setCollapsedIds((current) => {
      const next = new Set(current);
      collectIds(node).forEach((id) => next.delete(id));
      return next;
    });
    if (action === "focus") {
      setCollapsedIds(new Set(collectCollapsibleIds(root).filter((id) => !collectIds(node).includes(id))));
    }
    if (action === "collapse-others") focusActiveLineage();
    if (action === "expand-all") setCollapsedIds(new Set());
    setMenu(null);
  }

  return (
    <div className="looms-panel" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="looms-toolbar">
        <button onClick={focusActiveLineage}>Focus current</button>
        <button onClick={() => setCollapsedIds(new Set())}>Expand all</button>
        <span className="looms-depth-indicator">
          Lane {laneWindowStart + 1}-{Math.min(laneWindowEnd + 1, maxLane + 1)} / {maxLane + 1}
        </span>
      </div>
      <div className="looms-log" role="tree" aria-label="Conversation Loom lineage">
        <LoomsViewportRails rows={visibleNodes} focusLane={focusLane} viewportHeight={logViewportHeight} />
        <div className="looms-log__scroll-body" ref={scrollBodyRef}>
          <LoomsContentOverlay
            rows={visibleNodes}
            focusLane={focusLane}
            rowMeasurements={rowMeasurements}
            height={contentOverlayHeight}
          />
          <div className="looms-log__rows">
        {visibleNodes.map(({ node, hasChildren, collapsed, active, inActiveLineage, activeDescendantHidden }) => {
          const Icon =
            node.type === "conversation"
              ? Globe2
              : node.type === "loom"
                ? GitFork
                : node.type === "quick"
                  ? MessageSquare
                  : FileText;
          return (
            <div
              className={[
                "looms-log__row",
                active ? "active" : "",
                inActiveLineage ? "in-lineage" : "",
                hasChildren ? "branch-node" : "leaf-node",
                collapsed ? "collapsed" : "",
                activeDescendantHidden ? "collapsed-active-lineage" : "",
                selectedId === node.id ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={node.id}
              role="treeitem"
              data-lineage-node-id={node.id}
              ref={(element) => registerRowRef(node.id, element)}
              aria-expanded={hasChildren ? !collapsed : undefined}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelectedId(node.id);
                setMenu({
                  x: Math.min(event.clientX, window.innerWidth - 250),
                  y: Math.min(event.clientY, window.innerHeight - 300),
                  node,
                });
              }}
            >
              <button
                className="looms-log__row-hit"
                onClick={() => {
                  setSelectedId(node.id);
                  if (hasChildren) {
                    toggleNode(node);
                    return;
                  }
                  onVisit(nodeToLink(node));
                }}
                onDoubleClick={() => {
                  setSelectedId(node.id);
                  onVisit(nodeToLink(node));
                }}
                title={
                  hasChildren
                    ? collapsed
                      ? "Expand branch. Double-click or press Enter to open."
                      : "Collapse branch. Double-click or press Enter to open."
                    : "Open"
                }
              >
                <span aria-hidden="true" />
                <span className="looms-log__main">
                  <span className="looms-log__title-row">
                    <span className={hasChildren ? "looms-log__disclosure" : "looms-log__disclosure empty"}>
                      {hasChildren ? (collapsed ? "›" : "⌄") : ""}
                    </span>
                    <span className={`looms-log__icon looms-log__icon--${node.type}`} aria-hidden="true">
                      <Icon size={13} />
                    </span>
                    <span className="looms-log__title">{node.title}</span>
                    {hasChildren && collapsed && (
                      <span className="looms-log__branch-state">
                        {activeDescendantHidden ? "Current inside" : "Collapsed"}
                      </span>
                    )}
                    <span className="looms-log__type">
                      {node.type === "conversation" ? "Conversation" : node.type === "loom" ? "Loom" : node.type === "quick" ? "Quick" : "Response"}
                    </span>
                  </span>
                  <span className="looms-log__subtitle">{node.subtitle}</span>
                </span>
              </button>
            </div>
          );
        })}
          </div>
        </div>
      </div>
      {menu && (
        <div
          className="loom-node-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseLeave={() => undefined}
        >
          <button onClick={() => handleMenuAction("open")}>Open</button>
          <button onClick={() => handleMenuAction("graph")}>Open in Graph View</button>
          <button onClick={() => handleMenuAction("bookmark")}>Bookmark</button>
          <button onClick={() => handleMenuAction("copy")}>Copy Loom Address</button>
          <button onClick={() => handleMenuAction("collapse")} disabled={menu.node.children.length === 0}>Collapse Branch</button>
          <button onClick={() => handleMenuAction("expand")} disabled={menu.node.children.length === 0}>Expand Branch</button>
          <button onClick={() => handleMenuAction("focus")}>Focus This Branch</button>
          <button onClick={() => handleMenuAction("collapse-others")}>Collapse Others</button>
          <button onClick={() => handleMenuAction("expand-all")}>Expand All</button>
        </div>
      )}
    </div>
  );
}

const LOOMS_MAX_VISIBLE_LANES = 4;
const LOOMS_ROW_HEIGHT = 46;
const LOOMS_GUTTER_WIDTH = 78;
const LOOMS_LANE_SPACING = 16;
const LOOMS_LANE_BASE_X = 17;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getLoomLaneProjection(rows: VisibleLineageNode[], focusLane: number) {
  const maxLane = Math.max(0, ...rows.map((row) => row.lane));
  const laneWindowStart = clampNumber(
    focusLane - (LOOMS_MAX_VISIBLE_LANES - 1),
    0,
    Math.max(0, maxLane - (LOOMS_MAX_VISIBLE_LANES - 1))
  );
  const laneWindowEnd = laneWindowStart + LOOMS_MAX_VISIBLE_LANES - 1;
  const visibleLanes = Array.from(
    { length: LOOMS_MAX_VISIBLE_LANES },
    (_, index) => laneWindowStart + index
  );
  const activeLanes = new Set(rows.filter((row) => row.inActiveLineage).map((row) => row.lane));
  const hasActiveLeftOverflow = Array.from(activeLanes).some((lane) => lane < laneWindowStart);
  const hasActiveRightOverflow = Array.from(activeLanes).some((lane) => lane > laneWindowEnd);
  const viewportOffsetX = laneWindowStart * LOOMS_LANE_SPACING;
  const worldXForLane = (lane: number) => LOOMS_LANE_BASE_X + lane * LOOMS_LANE_SPACING;

  return {
    activeLanes,
    hasActiveLeftOverflow,
    hasActiveRightOverflow,
    laneWindowEnd,
    laneWindowStart,
    viewportOffsetX,
    visibleLanes,
    worldXForLane,
  };
}

function LoomsViewportRails({
  rows,
  focusLane,
  viewportHeight,
}: {
  rows: VisibleLineageNode[];
  focusLane: number;
  viewportHeight: number;
}) {
  const height = Math.max(1, viewportHeight);
  const {
    activeLanes,
    hasActiveLeftOverflow,
    hasActiveRightOverflow,
    laneWindowEnd,
    laneWindowStart,
    viewportOffsetX,
    visibleLanes,
    worldXForLane,
  } = getLoomLaneProjection(rows, focusLane);
  const clipId = "looms-rails-viewport";

  return (
    <div className="looms-log__viewport-rails" aria-hidden="true">
      <svg
        className="looms-log__rails-svg"
        width={LOOMS_GUTTER_WIDTH}
        height={height}
        viewBox={`0 0 ${LOOMS_GUTTER_WIDTH} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={LOOMS_GUTTER_WIDTH} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <g
            className="looms-log__lane-world"
            style={{ transform: `translateX(${-viewportOffsetX}px)` }}
          >
            {visibleLanes.map((lane) => {
              const isEdgeOverflow =
                (lane === laneWindowStart && hasActiveLeftOverflow) ||
                (lane === laneWindowEnd && hasActiveRightOverflow);
              return (
                <line
                  key={`rail-${lane}`}
                  x1={worldXForLane(lane)}
                  x2={worldXForLane(lane)}
                  y1={0}
                  y2={height}
                  className={[
                    "looms-log__lane-line",
                    activeLanes.has(lane) ? "is-active" : "",
                    isEdgeOverflow ? "is-window-edge" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              );
            })}
          </g>
        </g>
        {hasActiveLeftOverflow && (
          <path d={`M 5 0 L 5 ${height}`} className="looms-log__overflow-indicator left" />
        )}
        {hasActiveRightOverflow && (
          <path
            d={`M ${LOOMS_GUTTER_WIDTH - 5} 0 L ${LOOMS_GUTTER_WIDTH - 5} ${height}`}
            className="looms-log__overflow-indicator right"
          />
        )}
      </svg>
    </div>
  );
}

function LoomsContentOverlay({
  rows,
  focusLane,
  rowMeasurements,
  height,
}: {
  rows: VisibleLineageNode[];
  focusLane: number;
  rowMeasurements: Record<string, MeasuredLoomRow>;
  height: number;
}) {
  const overlayHeight = Math.max(LOOMS_ROW_HEIGHT, height);
  const {
    laneWindowEnd,
    laneWindowStart,
    viewportOffsetX,
    worldXForLane,
  } = getLoomLaneProjection(rows, focusLane);
  const rowById = new globalThis.Map(rows.map((row) => [row.node.id, row]));
  const clipId = "looms-content-viewport";

  return (
    <svg
      className="looms-log__content-overlay"
      width={LOOMS_GUTTER_WIDTH}
      height={overlayHeight}
      viewBox={`0 0 ${LOOMS_GUTTER_WIDTH} ${overlayHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={LOOMS_GUTTER_WIDTH} height={overlayHeight} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g
          className="looms-log__lane-world"
          style={{ transform: `translateX(${-viewportOffsetX}px)` }}
        >
          {rows.map((row) => {
            const measuredRow = rowMeasurements[row.node.id];
            if (!measuredRow) return null;

            const cy = measuredRow.centerY;
            const x = worldXForLane(row.lane);
            const isOffWindow = row.lane < laneWindowStart || row.lane > laneWindowEnd;
            const parentRow = row.parentId ? rowById.get(row.parentId) : undefined;
            const parentMeasurement = row.parentId ? rowMeasurements[row.parentId] : undefined;
            const parentX = parentRow ? worldXForLane(parentRow.lane) : null;
            const parentY = parentMeasurement?.centerY ?? null;
            const path =
              parentX !== null && parentY !== null
                ? `M ${parentX} ${parentY} C ${parentX} ${(parentY + cy) / 2}, ${x} ${(parentY + cy) / 2}, ${x} ${cy}`
                : null;
            const parentOffWindow = parentRow
              ? parentRow.lane < laneWindowStart || parentRow.lane > laneWindowEnd
              : false;
            const pathOffWindow = isOffWindow || parentOffWindow;

            return (
              <g key={row.node.id}>
                {path && (
                  <path
                    d={path}
                    className={[
                      "looms-log__fork-path",
                      row.inActiveLineage ? "is-active" : "",
                      pathOffWindow ? "is-off-window" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                )}
                <circle
                  cx={x}
                  cy={cy}
                  r={row.active ? 5 : 4}
                  className={[
                    "looms-log__node-dot",
                    row.active ? "is-active" : "",
                    row.collapsed ? "is-collapsed" : "",
                    row.activeDescendantHidden ? "has-active-descendant" : "",
                    isOffWindow ? "is-off-window" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}

function BookmarkRow({
  bookmark,
  onVisit,
  onRemove,
  onOpenContextMenu,
}: {
  bookmark: BookmarkItem;
  onVisit: (destination: BookmarkItem) => void;
  onRemove: (destination: BookmarkItem) => void;
  onOpenContextMenu: (event: React.MouseEvent, destination: BookmarkItem) => void;
}) {
  const Icon = iconForType[bookmark.type];
  return (
    <div
      className={bookmark.badge === "Broken reference" ? "bookmark-row broken" : "bookmark-row"}
      draggable
      onContextMenu={(event) => onOpenContextMenu(event, bookmark)}
      onDragStart={(event) => {
        setLoomDragPayload(event, bookmark);
      }}
    >
      <span className="bookmark-type-icon">
        <Icon size={16} />
      </span>
      <button className="bookmark-content" onClick={() => onVisit(bookmark)}>
        <strong title={bookmark.editableTitle}>{bookmark.editableTitle}</strong>
        <small title={bookmark.path}>{bookmark.path}</small>
        <span className="bookmark-meta-row">
          <em>{bookmark.badge}</em>
          <time>{bookmark.lastUsed}</time>
        </span>
      </button>
      <div className="bookmark-action-rail">
        <Tooltip label="Delete">
          <button
            className="bookmark-rail-button danger"
            onClick={() => onRemove(bookmark)}
            aria-label={`Delete ${bookmark.editableTitle}`}
          >
            <X size={13} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function Tooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement;
}) {
  return (
    <span className="tooltip-host" data-tooltip={label}>
      {children}
    </span>
  );
}

function SelectionActionPopover({
  x,
  y,
  onAsk,
  onQuickQuestion,
}: {
  x: number;
  y: number;
  onAsk: () => void;
  onQuickQuestion: () => void;
}) {
  return (
    <div
      className="selection-action-popover"
      style={{ left: x, top: y }}
      role="toolbar"
      aria-label="Selection actions"
    >
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onAsk}
      >
        Ask to Loom
      </button>
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onQuickQuestion}
      >
        Quick Question
      </button>
    </div>
  );
}

function AskPopover({
  state,
  onUpdate,
  onClose,
  onBookmark,
  onLoom,
}: {
  state: AskState;
  onUpdate: (state: AskState) => void;
  onClose: () => void;
  onBookmark: () => void;
  onLoom: () => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!dragRef.current) return;
      const width = 460;
      const nextX = Math.min(
        window.innerWidth - 24,
        Math.max(24 - width, event.clientX - dragRef.current.offsetX)
      );
      const nextY = Math.min(
        window.innerHeight - 120,
        Math.max(48, event.clientY - dragRef.current.offsetY)
      );
      setPosition({ x: nextX, y: nextY });
    }

    function handlePointerUp() {
      dragRef.current = null;
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const popover = event.currentTarget.closest(".ask-popover");
    if (!(popover instanceof HTMLElement)) return;
    const rect = popover.getBoundingClientRect();
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setPosition({ x: rect.left, y: rect.top });
  }

  return (
    <div
      className="ask-popover"
      style={
        position
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-title"
    >
      <div className="ask-header ask-drag-handle" onPointerDown={startDrag}>
        <div>
          <span>Ask</span>
          <h2 id="ask-title">{state.response.title}</h2>
        </div>
        <button
          className="icon-button"
          tabIndex={0}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          aria-label="Close Ask"
        >
          <X size={16} />
        </button>
      </div>
      <blockquote>{state.selectedText}</blockquote>
      <textarea
        ref={textareaRef}
        value={state.question}
        onChange={(event) => onUpdate({ ...state, question: event.target.value })}
        placeholder="Ask a focused follow-up about this selection..."
        aria-label="Ask question"
        tabIndex={0}
      />
      {state.answered && (
        <div className="ask-answer">
          <Bot size={15} />
          <p>
            This selection is about orientation: the Address Bar combines navigation,
            local search, and direct Loom addressing so the user never chooses a mode.
          </p>
        </div>
      )}
      <div className="ask-actions">
        <button tabIndex={0} onClick={onLoom}>Convert to Loom</button>
        <button tabIndex={0} onClick={onBookmark}>Bookmark</button>
        <button
          className="primary"
          tabIndex={0}
          onClick={() => onUpdate({ ...state, answered: true })}
        >
          <CornerDownLeft size={15} />
          Ask
        </button>
      </div>
    </div>
  );
}

function DeleteConversationDialog({
  conversation,
  onCancel,
  onConfirm,
}: {
  conversation: Conversation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
      >
        <div className="danger-icon">
          <Trash2 size={20} />
        </div>
        <h2 id="delete-title">Delete this conversation permanently?</h2>
        <p>
          Deleting <strong>{conversation.title}</strong> removes the conversation and
          can break Loom references, bookmarks, and bookmarked links that point to it.
          Archive keeps the destination recoverable; delete does not.
        </p>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="delete-button" onClick={onConfirm}>
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}

function GraphView({
  conversations,
  responses,
  onVisit,
}: {
  conversations: Conversation[];
  responses: ResponseItem[];
  onVisit: (destination: LoomLink) => void;
}) {
  return (
    <section className="graph-view" aria-label="Graph View">
      <div className="graph-header">
        <span>Graph View</span>
        <h1>Site map for the active AI conversation web</h1>
        <p>
          Conversations, Looms, Q+A items, suggested references, and bookmarked
          links appear as navigable nodes. Browser mode remains the primary workspace.
        </p>
      </div>
      <div className="graph-canvas">
        {conversations.slice(0, 4).map((conversation, index) => (
          <button
            key={conversation.id}
            className={`graph-node conversation node-${index + 1}`}
            onClick={() =>
              onVisit({
                id: conversation.id,
                type: "conversation",
                title: conversation.title,
                path: conversation.path,
              })
            }
          >
            <Globe2 size={18} />
            <strong>{conversation.title}</strong>
            <small>Conversation</small>
          </button>
        ))}
        {responses.map((response, index) => (
          <button
            key={response.id}
            className={`graph-node response response-${index + 1}`}
            onClick={() =>
              onVisit({
                id: response.id,
                type: "response",
                title: response.title,
                path: response.address,
              })
            }
          >
            <FileText size={16} />
            <strong>{response.title}</strong>
            <small>Q+A item</small>
          </button>
        ))}
        <svg className="graph-lines" aria-hidden="true">
          <path d="M170 120 C310 40 420 170 560 110" />
          <path d="M210 290 C340 210 470 250 600 210" />
          <path d="M450 130 C520 220 610 260 730 300" />
          <path d="M300 420 C420 350 560 420 690 360" />
        </svg>
      </div>
    </section>
  );
}

function ContextMenu({
  state,
  onAction,
  onClose,
}: {
  state: ContextMenuState;
  onAction: (item: ContextMenuItem, index: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="context-menu-backdrop"
      role="presentation"
      onContextMenu={(event) => event.preventDefault()}
      onClick={onClose}
    >
      <div
        className="context-menu"
        role="menu"
        style={{ left: state.x, top: state.y }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {state.items.map((item, index) => (
          <button
            key={`${item.id}-${index}-${item.label}`}
            className={[
              "context-menu-item",
              item.danger ? "danger" : "",
              item.separatorBefore ? "separated" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={item.disabled}
            onClick={() => onAction(item, index)}
            role="menuitem"
          >
            <span>{item.label}</span>
            {item.detail && <small>{item.detail}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConversationIconPicker({
  conversation,
  options,
  onSave,
  onCancel,
}: {
  conversation: Conversation;
  options: ConversationIconOption[];
  onSave: (conversation: Conversation, iconKey: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIconKey, setSelectedIconKey] = useState(
    conversation.iconKey ?? options[0].key
  );

  const filteredOptions = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return options;
    return options.filter((option) =>
      [option.label, option.key, ...option.tags].some((item) =>
        item.toLowerCase().includes(value)
      )
    );
  }, [options, query]);

  const selectedOption = getConversationIconOption(selectedIconKey);
  const SelectedIcon = selectedOption.Icon;

  useEffect(() => {
    inputRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") onSave(conversation, selectedIconKey);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [conversation, onCancel, onSave, selectedIconKey]);

  return (
    <div className="icon-picker-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="icon-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="icon-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="icon-picker-header">
          <div className="icon-picker-preview">
            <SelectedIcon size={20} />
          </div>
          <div>
            <span>Conversation icon</span>
            <h2 id="icon-picker-title">{conversation.title}</h2>
          </div>
        </div>

        <label className="icon-search">
          <Search size={14} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search icons"
            aria-label="Search icons"
          />
        </label>

        <div className="icon-grid" role="listbox" aria-label="Conversation icons">
          {filteredOptions.map((option) => {
            const selected = option.key === selectedIconKey;
            return (
              <button
                key={option.key}
                className={selected ? "icon-choice selected" : "icon-choice"}
                onClick={() => setSelectedIconKey(option.key)}
                role="option"
                aria-selected={selected}
                title={option.label}
              >
                <option.Icon size={18} />
                {selected && <Check size={12} className="icon-choice-check" />}
              </button>
            );
          })}
        </div>

        {filteredOptions.length === 0 && (
          <div className="empty-state">No matching icons.</div>
        )}

        <div className="icon-picker-footer">
          <span>{selectedOption.label}</span>
          <div>
            <button onClick={onCancel}>Cancel</button>
            <button
              className="primary"
              onClick={() => onSave(conversation, selectedIconKey)}
            >
              Done
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;
