import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  Archive,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Boxes,
  Brain,
  Check,
  Clock3,
  Compass,
  Copy,
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
  Maximize2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Network,
  PanelLeft,
  Palette,
  Paperclip,
  Plus,
  Puzzle,
  Rocket,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Target,
  Terminal,
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
  getBackTraversal,
  getForwardTraversal,
  historyEntryMatchesDestination,
  jumpToTraversalIndex,
  markHistoryOlder,
  type NavigationTraversalEntry,
  type NavigationDirection,
} from "./services/navigation";
import {
  isLoomAddress,
  linkFromResolvedObject,
  normalizeLoomTitle,
  resolveLoomAddress,
  toLoomMarkdown,
} from "./services/loomProtocol";
import {
  createRuntimeLoomGraphRepository,
  readRuntimeBookmarks,
  writeRuntimeBookmarks,
} from "./services/loomRuntimeGraph";
import {
  getProfileModel,
  isMockResponseModeEnabled,
  readAIProviderSettings,
  runModelProfileRequest,
  writeAIProviderSettings,
  type AIProviderSettings,
  type ModelEffort,
  type ModelProfileId,
  type RuntimeHealthState,
} from "./services/modelProviders";
import { useRuntimeHealth } from "./hooks/useRuntimeHealth";
import { useSidebarDnD } from "./hooks/useSidebarDnD";
import { AppShell } from "./components/AppShell";
import { AddressBar } from "./components/AddressBar";
import { AIProviderSettingsModal } from "./components/AIProviderSettings";
import { AskPopup, type AskPopupState } from "./components/AskPopup";
import { BookmarkView } from "./components/BookmarkView";
import { ChangeIconPopover } from "./components/ChangeIconPopover";
import { ContextMenu, type ContextMenuState } from "./components/ContextMenu";
import { ConversationView } from "./components/ConversationView";
import { DeleteConversationDialog } from "./components/DeleteConversationDialog";
import { GraphView } from "./components/GraphView";
import { HistoryView } from "./components/HistoryView";
import { ReferencesListBox } from "./components/ReferencesListBox";
import { SelectionPopover } from "./components/SelectionPopover";
import { TopBar } from "./components/TopBar";
import { WeftView } from "./components/WeftView";
import type {
  AddressSuggestion,
  BookmarkItem,
  Conversation,
  HistoryEntry,
  LoomLink,
  LoomNavigationDestination,
  LoomObjectType,
  LoomResolutionResult,
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

type AskState = AskPopupState;

interface SelectionAskState {
  response: ResponseItem;
  draftKey: string;
  selectedText: string;
  x: number;
  y: number;
}

interface SelectionReferenceState {
  draftKey: string;
  link: LoomLink;
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

type ComposerReferenceGroup = "Open Looms" | "Responses" | "Bookmarks";

interface ComposerReferenceOption extends LoomLink {
  group: ComposerReferenceGroup;
  subtitle: string;
}

type AttachContentTab = "all" | "bookmarks" | "history" | "openLooms" | "responses" | "files";

type AttachContentSource = "bookmark" | "history" | "openLoom" | "response";

interface AttachContentItem extends LoomLink {
  source: AttachContentSource;
  subtitle: string;
  keywords: string[];
}

interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
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
  attachments?: ComposerAttachment[];
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

const attachContentTabs: Array<{
  id: AttachContentTab;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: "all", label: "All", Icon: Boxes },
  { id: "bookmarks", label: "Bookmarks", Icon: Bookmark },
  { id: "history", label: "History", Icon: History },
  { id: "openLooms", label: "Open Looms", Icon: Globe2 },
  { id: "responses", label: "Responses", Icon: FileText },
  { id: "files", label: "Files", Icon: Paperclip },
];

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const EPHEMERAL_DRAFT_ID = "draft-new-conversation";

const LOOM_LINK_MIME = "application/loom-link";

const seedComposerLink: LoomLink = {
  id: "seed-link",
  type: "response",
  title: "Inline reference composition rules",
  path: "loom://loom-ai/navigation-architecture/loom/composer/r-inline-references",
  badge: "Linked",
};

const initialNavigationDestination: LoomLink = {
  id: EPHEMERAL_DRAFT_ID,
  type: "conversation",
  title: "New conversation",
  path: "loom://drafts/new-conversation",
  badge: "Draft",
};

const initialResolvedNavigationDestination: LoomNavigationDestination = {
  loomId: EPHEMERAL_DRAFT_ID,
  mode: "full",
  source: "userNavigation",
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

const typeLabel: Record<LoomObjectType, string> = {
  conversation: "Loom",
  loom: "Weft",
  response: "Response",
  bookmark: "Bookmark",
  semantic: "Semantic",
  recent: "Recent",
};

function displayObjectTypeLabel(label?: string) {
  if (label === "Conversation") return "Loom";
  if (label === "Loom") return "Weft";
  return label;
}

function normalizeAddressBarTitle(value?: string) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function formatAddressBarTitle(activeLoom?: Pick<Conversation, "title"> | null, destinationTitle?: string) {
  const loomTitle = normalizeAddressBarTitle(activeLoom?.title);
  const targetTitle = normalizeAddressBarTitle(destinationTitle);

  if (!loomTitle && !targetTitle) return "Archive / No active conversation";
  if (!loomTitle) return targetTitle;
  if (!targetTitle || loomTitle.toLocaleLowerCase() === targetTitle.toLocaleLowerCase()) {
    return loomTitle;
  }
  return `${loomTitle} / ${targetTitle}`;
}

function setLoomDragPayload(event: React.DragEvent, link: LoomLink) {
  event.dataTransfer.effectAllowed = "copyMove";
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

function createLoomDragPreview(event: React.DragEvent, title: string) {
  document.querySelectorAll("[data-testid='loom-drag-preview']").forEach((node) => {
    node.remove();
  });
  const preview = document.createElement("div");
  preview.className = "loom-drag-preview";
  preview.dataset.testid = "loom-drag-preview";
  preview.textContent = title;
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 12, 14);
  return () => preview.remove();
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
  const workspaceRef = useRef<HTMLElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const originTranscriptRef = useRef<HTMLElement | null>(null);
  const composerFocusRef = useRef<(() => void) | null>(null);
  const pendingScrollPathRef = useRef<string | null>(null);
  const pendingScrollDestinationRef = useRef<LoomNavigationDestination | null>(null);
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
  const [draftConversation, setDraftConversation] = useState<Conversation | null>({
    id: EPHEMERAL_DRAFT_ID,
    title: "New conversation",
    path: "loom://drafts/new-conversation",
    folder: "Drafts",
    summary: "Clean unsaved conversation draft.",
    iconKey: "compass",
  });
  const [activeConversationId, setActiveConversationId] = useState(EPHEMERAL_DRAFT_ID);
  const [activeObjectTitle, setActiveObjectTitle] = useState("New conversation");
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [activeSplitPanel, setActiveSplitPanel] = useState<"origin" | "weft">("weft");
  const [splitPanelMenu, setSplitPanelMenu] = useState<{
    panel: "origin" | "weft";
    x: number;
    y: number;
  } | null>(null);
  const [graphMode, setGraphMode] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraft>>({
    [seedConversations[0].id]: {
      html: seedComposerText,
      links: [seedComposerLink],
    },
    [EPHEMERAL_DRAFT_ID]: { html: "", links: [] },
  });
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() =>
    readRuntimeBookmarks(seedBookmarks)
  );
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [navigationStack, setNavigationStack] = useState<HistoryEntry[]>([
    createHistoryEntry(initialNavigationDestination, initialResolvedNavigationDestination),
  ]);
  const [navigationIndex, setNavigationIndex] = useState(0);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [addressFocused, setAddressFocused] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [addressFeedback, setAddressFeedback] =
    useState<LoomResolutionResult | null>(null);
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
  const [providerSettings, setProviderSettings] = useState<AIProviderSettings>(() =>
    readAIProviderSettings()
  );
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const [composerRuntimeState, setComposerRuntimeState] = useState<{
    running: boolean;
    message: string | null;
  }>({ running: false, message: null });
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

  const currentNavigationDestination =
    navigationStack[navigationIndex]?.navigationDestination ??
    initialResolvedNavigationDestination;

  const activeWeftOrigin = getWeftOrigin(activeConversationId);
  const originConversation = activeWeftOrigin
    ? conversations.find((conversation) => conversation.id === activeWeftOrigin.originLoomId)
    : undefined;
  const originResponses = originConversation
    ? conversationResponses[originConversation.id] ?? []
    : [];
  const minimumWeftPanelWidth = 520;
  const splitPanelGap = 1;
  const canShowWeftSplit =
    workspaceWidth > 0 &&
    Math.floor((workspaceWidth - splitPanelGap) / 2) >= minimumWeftPanelWidth;
  const showWeftSplit =
    Boolean(activeWeftOrigin && originConversation) &&
    currentNavigationDestination.mode === "split" &&
    canShowWeftSplit;
  const focusedSplitConversation =
    showWeftSplit && activeSplitPanel === "origin" && originConversation
      ? originConversation
      : activeConversation;
  const focusedSplitResponses =
    focusedSplitConversation && focusedSplitConversation.id !== draftConversation?.id
      ? conversationResponses[focusedSplitConversation.id] ?? []
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

  const currentLocation = formatAddressBarTitle(focusedSplitConversation, activeObjectTitle);

  const currentActiveDestination = useMemo<LoomLink>(() => {
    if (showWeftSplit && focusedSplitConversation) {
      return {
        id: focusedSplitConversation.id,
        type: getWeftOrigin(focusedSplitConversation.id) ? "loom" : "conversation",
        title: focusedSplitConversation.title,
        path: focusedSplitConversation.path,
        badge: getWeftOrigin(focusedSplitConversation.id) ? typeLabel.loom : typeLabel.conversation,
      };
    }
    const activeResponse = focusedSplitResponses.find(
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
    if (focusedSplitConversation) {
      return {
        id: focusedSplitConversation.id,
        type: getWeftOrigin(focusedSplitConversation.id) ? "loom" : "conversation",
        title: focusedSplitConversation.title,
        path: focusedSplitConversation.path,
        badge: getWeftOrigin(focusedSplitConversation.id) ? typeLabel.loom : typeLabel.conversation,
      };
    }
    return {
      id: "archive",
      type: "recent",
      title: "Archive",
      path: "loom://archive",
      badge: "Recent",
    };
  }, [
    activeObjectTitle,
    focusedSplitConversation,
    focusedSplitResponses,
    responseTitleOverrides,
    showWeftSplit,
  ]);

  const composerReferenceOptions = useMemo<ComposerReferenceOption[]>(() => {
    const conversationOptions = conversations.map((conversation) => ({
      id: conversation.id,
      type: "conversation" as const,
      title: conversation.title,
      path: conversation.path,
      badge: typeLabel.conversation,
      group: "Open Looms" as const,
      subtitle: conversation.folder,
    }));
    const loomOptions = Object.values(conversationResponses)
      .flat()
      .map((response) => ({
        id: response.id,
        type: "response" as const,
        title: response.title,
        path: response.address,
        badge: typeLabel.response,
        group: "Responses" as const,
        subtitle: "Response",
      }));
    const bookmarkOptions = bookmarks.map((bookmark) => ({
      ...bookmark,
      title: bookmark.editableTitle,
      group: "Bookmarks" as const,
      subtitle: bookmark.lastUsed,
    }));

    return [...conversationOptions, ...loomOptions, ...bookmarkOptions];
  }, [bookmarks, conversationResponses, conversations]);

  const attachContentItems = useMemo<AttachContentItem[]>(() => {
    const bookmarkItems = bookmarks.map((bookmark) => ({
      ...bookmark,
      title: bookmark.editableTitle,
      source: "bookmark" as const,
      subtitle: bookmark.path,
      keywords: ["Bookmark", bookmark.lastUsed],
    }));
    const historyItems = history.map((entry) => ({
      ...entry,
      source: "history" as const,
      subtitle: entry.path,
      keywords: ["Loom History", entry.visitedAt],
    }));
    const openLoomItems = conversations.map((conversation) => ({
      id: conversation.id,
      type: getWeftOrigin(conversation.id) ? "loom" as const : "conversation" as const,
      title: conversation.title,
      path: conversation.path,
      badge: getWeftOrigin(conversation.id) ? typeLabel.loom : typeLabel.conversation,
      source: "openLoom" as const,
      subtitle: conversation.folder,
      keywords: ["Open Loom", conversation.summary],
    }));
    const responseItems = Object.values(conversationResponses)
      .flat()
      .map((response) => ({
        id: response.id,
        type: "response" as const,
        title: response.title,
        path: response.address,
        badge: typeLabel.response,
        source: "response" as const,
        subtitle: response.question,
        keywords: ["Response", ...response.answer],
      }));

    return [...bookmarkItems, ...historyItems, ...openLoomItems, ...responseItems];
  }, [bookmarks, conversationResponses, conversations, forkRecords, history]);

  const loomGraphRepository = useMemo(
    () =>
      createRuntimeLoomGraphRepository({
        conversations,
        responsesByConversation: conversationResponses,
        bookmarks,
      }),
    [bookmarks, conversationResponses, conversations]
  );

  useEffect(() => {
    writeRuntimeBookmarks(bookmarks);
  }, [bookmarks]);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const updateWorkspaceWidth = () => {
      setWorkspaceWidth(workspace.getBoundingClientRect().width);
    };
    updateWorkspaceWidth();
    const observer = new ResizeObserver(updateWorkspaceWidth);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  function saveProviderSettings(nextSettings: AIProviderSettings) {
    setProviderSettings(nextSettings);
    writeAIProviderSettings(nextSettings);
  }

  const composerRuntimeHealth = useRuntimeHealth(
    providerSettings,
    "main",
    saveProviderSettings
  );
  const mockResponsesEnabled = isMockResponseModeEnabled(providerSettings);
  const activeComposerRuntimeHealth = mockResponsesEnabled
    ? {
        ...composerRuntimeHealth,
        ollama_installed: true,
        ollama_running: true,
        models_available: true,
        selected_model_ready: true,
        status: "ready" as const,
        message: "Demo responses are enabled for this development session.",
      }
    : composerRuntimeHealth;

  function plainTextFromDraft(draft: ComposerDraft) {
    return draft.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  function responseSlug(value: string) {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 42) || "response"
    );
  }

  function answerParagraphs(value: string) {
    return value
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function providerErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "The selected model provider failed.";
  }

  function modelReadinessMessage(profile: ModelProfileId) {
    if (mockResponsesEnabled) return null;
    const model = getProfileModel(providerSettings, profile);
    if (providerSettings.ollama.lastConnectionStatus !== "connected") {
      return "Ollama is not ready. Open AI Providers and test the runtime.";
    }
    if (!providerSettings.ollama.models.some((item) => item.installed)) {
      return "No Ollama models are installed. Pull a model in AI Providers.";
    }
    if (!model.installed) {
      return `${model.name} is not installed. Download it in AI Providers.`;
    }
    return null;
  }

  function isDestinationBookmarked(destination: LoomLink) {
    const destinationResolution = resolveLoomAddress(destination.path, loomGraphRepository);
    const destinationObjectId =
      destinationResolution.status === "resolved"
        ? (destinationResolution.targetObject ?? destinationResolution.object)?.objectId
        : destination.targetObjectId;
    return bookmarks.some((bookmark) => {
      if (bookmark.path === destination.path) return true;
      if (destinationObjectId && bookmark.targetObjectId === destinationObjectId) return true;
      const bookmarkResolution = resolveLoomAddress(bookmark.path, loomGraphRepository);
      const bookmarkTargetId =
        bookmarkResolution.status === "resolved"
          ? (bookmarkResolution.targetObject ?? bookmarkResolution.object)?.objectId
          : bookmark.targetObjectId;
      return Boolean(destinationObjectId && bookmarkTargetId === destinationObjectId);
    });
  }

  function getWeftOrigin(loomId: string) {
    const record = forkRecords.find((item) => item.childConversationId === loomId);
    return record
      ? {
          originLoomId: record.parentConversationId,
          originResponseId: record.parentResponseId,
        }
      : undefined;
  }

  function findLoomByPath(path: string) {
    return conversations.find((item) => path === item.path || path.startsWith(`${item.path}/`));
  }

  function findResponseInLoom(loomId: string, responseId?: string) {
    if (!responseId) return undefined;
    return (conversationResponses[loomId] ?? []).find((response) => response.id === responseId);
  }

  function findResponseByPath(loomId: string, path: string) {
    return (conversationResponses[loomId] ?? []).find((response) => response.address === path);
  }

  function lastResponseInLoom(loomId: string) {
    const responses = conversationResponses[loomId] ?? [];
    return responses[responses.length - 1];
  }

  function loomLinkForId(loomId: string): LoomLink {
    const loom =
      loomId === draftConversation?.id
        ? draftConversation
        : conversations.find((item) => item.id === loomId) ?? activeConversation;
    return {
      id: loom?.id ?? loomId,
      type: getWeftOrigin(loomId) ? "loom" : "conversation",
      title: loom?.title ?? "Loom",
      path: loom?.path ?? `loom://unknown/${loomId}`,
      badge: getWeftOrigin(loomId) ? typeLabel.loom : typeLabel.conversation,
    };
  }

  function responseLinkForNavigation(
    loomId: string,
    response: ResponseItem,
    badge = typeLabel.response
  ): LoomLink {
    return {
      id: response.id,
      type: "response",
      title: responseTitleOverrides[response.id] ?? response.title,
      path: response.address,
      badge,
    };
  }

  function linkForNavigationDestination(destination: LoomNavigationDestination): LoomLink {
    if (destination.scrollMode === "lastResponse") {
      const latest = lastResponseInLoom(destination.loomId);
      if (latest) return responseLinkForNavigation(destination.loomId, latest);
    }
    if (destination.scrollTargetResponseId) {
      const target = findResponseInLoom(destination.loomId, destination.scrollTargetResponseId);
      if (target) return responseLinkForNavigation(destination.loomId, target);
    }
    return loomLinkForId(destination.loomId);
  }

  function navigationDestinationForLink(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    source: LoomNavigationDestination["source"],
    overrides: Partial<LoomNavigationDestination> = {}
  ): LoomNavigationDestination {
    const loom = findLoomByPath(destination.path);
    const loomId = overrides.loomId ?? loom?.id ?? destination.id;
    const response = loom ? findResponseByPath(loom.id, destination.path) : undefined;
    const origin = getWeftOrigin(loomId);
    const mode = overrides.mode ?? "full";
    const scrollTargetResponseId =
      overrides.scrollTargetResponseId ?? response?.id ?? undefined;
    const scrollMode =
      overrides.scrollMode ?? (response ? "exact" : undefined);

    return {
      loomId,
      mode,
      originLoomId: overrides.originLoomId ?? origin?.originLoomId,
      originResponseId: overrides.originResponseId ?? origin?.originResponseId,
      scrollTargetResponseId,
      scrollMode,
      source,
    };
  }

  function withBackForwardSource(destination: LoomNavigationDestination): LoomNavigationDestination {
    return { ...destination, source: "backForward" };
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        addressFocused &&
        addressBarRef.current &&
        !addressBarRef.current.contains(event.target as Node)
      ) {
        setAddressFocused(false);
        setAddressQuery("");
        setAddressFeedback(null);
      }
      if (contextMenu) {
        setContextMenu(null);
      }
      if (splitPanelMenu) {
        const target = event.target as HTMLElement;
        if (!target.closest(".split-panel-menu") && !target.closest(".split-panel-control")) {
          setSplitPanelMenu(null);
        }
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
        setAddressFeedback(null);
        setContextMenu(null);
        setSplitPanelMenu(null);
        if (selectionAskState || askState) closeSelectionAskFlow();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [addressFocused, askState, contextMenu, selectionAskState, splitPanelMenu]);

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

  function resolveNavigationDestination(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    options: { allowUnresolved?: boolean } = {}
  ):
    | { ok: true; destination: LoomLink | AddressSuggestion | HistoryEntry }
    | { ok: false; resolution: LoomResolutionResult } {
    if (!isLoomAddress(destination.path)) return { ok: true, destination };
    const resolution = resolveLoomAddress(destination.path, loomGraphRepository);
    if (resolution.status === "resolved") {
      const resolvedObject = resolution.targetObject ?? resolution.object;
      return {
        ok: true,
        destination: resolvedObject
          ? {
              ...destination,
              ...linkFromResolvedObject(resolvedObject),
              targetObjectId: resolvedObject.objectId,
              canonicalUri: resolvedObject.canonicalUri,
              resolutionStatus: resolution.status,
            }
          : destination,
      };
    }
    if (resolution.status === "not_found" && options.allowUnresolved) {
      return { ok: true, destination };
    }
    if (resolution.status === "broken_reference") {
      loomGraphRepository.emitBrokenReference(destination, resolution.reason ?? "Navigation failed");
    }
    return { ok: false, resolution };
  }

  function restoreDestination(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    navigationDestination?: LoomNavigationDestination
  ) {
    const resolvedDestination = normalizeResolvedDestination(destination);
    const resolvedNavigationDestination =
      navigationDestination ??
      ("navigationDestination" in resolvedDestination
        ? resolvedDestination.navigationDestination
        : undefined);
    const conversation = resolvedNavigationDestination
      ? conversations.find((item) => item.id === resolvedNavigationDestination.loomId)
      : conversations.find((item) => resolvedDestination.path.startsWith(item.path));
    const scrollResponse = resolvedNavigationDestination?.scrollTargetResponseId
      ? findResponseInLoom(
          resolvedNavigationDestination.loomId,
          resolvedNavigationDestination.scrollTargetResponseId
        )
      : resolvedNavigationDestination?.scrollMode === "lastResponse"
        ? lastResponseInLoom(resolvedNavigationDestination.loomId)
        : undefined;
    setActiveObjectTitle(
      scrollResponse
        ? responseTitleOverrides[scrollResponse.id] ?? scrollResponse.title
        : resolvedNavigationDestination?.loomId
          ? loomLinkForId(resolvedNavigationDestination.loomId).title
          : resolvedDestination.title
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
    pendingScrollDestinationRef.current = resolvedNavigationDestination ?? null;
    pendingScrollPathRef.current = resolvedDestination.path;
    setAddressFocused(false);
    setAddressQuery("");
    setAddressFeedback(null);
    setSelectedSuggestion(0);
    setGraphMode(false);
  }

  function pushNavigationEntry(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    navigationDestination = navigationDestinationForLink(destination, "userNavigation")
  ) {
    const resolvedDestination = normalizeResolvedDestination(destination);
    setNavigationStack((current) => {
      const base = current.slice(0, navigationIndex + 1);
      const last = base[base.length - 1];
      if (historyEntryMatchesDestination(last, resolvedDestination, navigationDestination)) {
        setNavigationIndex(base.length - 1);
        return base;
      }
      const next = [...base, createHistoryEntry(resolvedDestination, navigationDestination)];
      setNavigationIndex(next.length - 1);
      return next;
    });
  }

  function replaceNavigationEntry(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    navigationDestination = navigationDestinationForLink(destination, "userNavigation")
  ) {
    const resolvedDestination = normalizeResolvedDestination(destination);
    setNavigationStack((current) => {
      if (!current[navigationIndex]) {
        return [createHistoryEntry(resolvedDestination, navigationDestination)];
      }
      return current.map((entry, index) =>
        index === navigationIndex
          ? createHistoryEntry(resolvedDestination, navigationDestination)
          : entry
      );
    });
  }

  function pushNavigationSequence(
    entries: Array<{
      link: LoomLink | AddressSuggestion | HistoryEntry;
      destination: LoomNavigationDestination;
    }>
  ) {
    if (entries.length === 0) return;
    setNavigationStack((current) => {
      let next = current.slice(0, navigationIndex + 1);
      entries.forEach((entry) => {
        const resolvedLink = normalizeResolvedDestination(entry.link);
        const last = next[next.length - 1];
        if (historyEntryMatchesDestination(last, resolvedLink, entry.destination)) return;
        next = [...next, createHistoryEntry(resolvedLink, entry.destination)];
      });
      setNavigationIndex(next.length - 1);
      return next;
    });
  }

  function visitDestination(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    options: {
      allowUnresolved?: boolean;
      source?: LoomNavigationDestination["source"];
      navigationDestination?: LoomNavigationDestination;
    } = {}
  ) {
    const resolution = resolveNavigationDestination(destination, options);
    if (!resolution.ok) {
      setAddressFeedback(resolution.resolution);
      setAddressFocused(true);
      return;
    }
    const resolvedDestination = resolution.destination;
    const source = options.source ?? "userNavigation";
    const navigationDestination =
      options.navigationDestination ??
      ("navigationDestination" in destination && destination.navigationDestination
        ? { ...destination.navigationDestination, source }
        : undefined) ??
      navigationDestinationForLink(resolvedDestination, source);
    restoreDestination(resolvedDestination, navigationDestination);
    if (
      navigationDestination.mode === "full" &&
      navigationDestination.originLoomId &&
      navigationDestination.originResponseId &&
      source !== "returnToOrigin" &&
      source !== "backForward"
    ) {
      const originResponse = findResponseInLoom(
        navigationDestination.originLoomId,
        navigationDestination.originResponseId
      );
      const originLastResponse = lastResponseInLoom(navigationDestination.originLoomId);
      const originAtLastDestination: LoomNavigationDestination = {
        loomId: navigationDestination.originLoomId,
        mode: "full",
        scrollTargetResponseId: originLastResponse?.id,
        scrollMode: "lastResponse",
        source,
      };
      const originAtResponseDestination: LoomNavigationDestination = {
        loomId: navigationDestination.originLoomId,
        mode: "full",
        scrollTargetResponseId: navigationDestination.originResponseId,
        scrollMode: "origin",
        source,
      };
      const splitWeftDestination: LoomNavigationDestination = {
        ...navigationDestination,
        mode: "split",
      };
      pushNavigationSequence([
        {
          link: originLastResponse
            ? responseLinkForNavigation(navigationDestination.originLoomId, originLastResponse)
            : loomLinkForId(navigationDestination.originLoomId),
          destination: originAtLastDestination,
        },
        {
          link: originResponse
            ? responseLinkForNavigation(navigationDestination.originLoomId, originResponse)
            : loomLinkForId(navigationDestination.originLoomId),
          destination: originAtResponseDestination,
        },
        { link: linkForNavigationDestination(splitWeftDestination), destination: splitWeftDestination },
        { link: resolvedDestination, destination: navigationDestination },
      ]);
    } else {
      pushNavigationEntry(resolvedDestination, navigationDestination);
    }
    setHistory((current) => [
      createHistoryEntry(resolvedDestination, navigationDestination),
      ...markHistoryOlder(current),
    ]);
  }

  useEffect(() => {
    const pendingDestination = pendingScrollDestinationRef.current;
    const pendingPath = pendingScrollPathRef.current;
    if ((!pendingDestination && !pendingPath) || graphMode) return;
    pendingScrollDestinationRef.current = null;
    pendingScrollPathRef.current = null;
    window.requestAnimationFrame(() => {
      const scrollToResponse = (
        transcript: HTMLElement | null,
        responseId?: string,
        path?: string
      ) => {
        if (!transcript) return false;
        const target = responseId
          ? transcript.querySelector<HTMLElement>(
              `[data-response-id="${CSS.escape(responseId)}"]`
            )
          : path
            ? transcript.querySelector<HTMLElement>(
                `[data-response-address="${CSS.escape(path)}"]`
              )
            : null;
        if (!target) return false;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return true;
      };

      if (pendingDestination?.mode === "split" && pendingDestination.originResponseId) {
        scrollToResponse(
          originTranscriptRef.current,
          pendingDestination.originResponseId
        );
      }

      if (pendingDestination?.scrollMode === "lastResponse") {
        const latest = lastResponseInLoom(pendingDestination.loomId);
        if (scrollToResponse(transcriptRef.current, latest?.id)) return;
      }

      if (
        pendingDestination?.scrollTargetResponseId &&
        scrollToResponse(
          transcriptRef.current,
          pendingDestination.scrollTargetResponseId
        )
      ) {
        return;
      }

      if (pendingPath && scrollToResponse(transcriptRef.current, undefined, pendingPath)) {
        return;
      }

      if (activeConversation?.path === pendingPath) {
        transcriptRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }, [
    activeConversation?.path,
    activeConversationId,
    activeObjectTitle,
    currentNavigationDestination,
    graphMode,
    workspaceWidth,
  ]);

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
    setConversations((current) => [...current, conversation]);
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

  function setComposerDraftForKey(key: string, draft: ComposerDraft) {
    setComposerDrafts((current) => ({
      ...current,
      [key]: draft,
    }));
  }

  function removeComposerLink(key: string, link: LoomLink) {
    updateComposerDraft(key, (draft) => ({
      ...draft,
      links: draft.links.filter((item) => item.path !== link.path),
    }));
  }

  function resolveReferenceLink(link: LoomLink, sourceLoomId = activeConversationId): LoomLink {
    if (link.referenceMentionId || link.resolutionStatus) return link;
    const resolution = resolveLoomAddress(link.path, loomGraphRepository);
    if (resolution.status !== "resolved") {
      loomGraphRepository.emitBrokenReference(link, resolution.reason ?? "Reference target did not resolve");
      return {
        ...link,
        badge:
          resolution.status === "deleted"
            ? "Deleted"
            : resolution.status === "window_invalid"
              ? "Invalid window"
              : "Broken reference",
        resolutionStatus: resolution.status,
      };
    }
    const targetObject = resolution.targetObject ?? resolution.object;
    const sourceConversation =
      sourceLoomId === draftConversation?.id
        ? draftConversation
        : conversations.find((conversation) => conversation.id === sourceLoomId);
    const mention = targetObject
      ? loomGraphRepository.createReferenceMention({
          sourceConversationId: sourceLoomId,
          sourcePath: sourceConversation?.path ?? currentActiveDestination.path,
          target: link,
        })
      : undefined;
    return targetObject
      ? {
          ...link,
          id: targetObject.objectId,
          path: targetObject.aliasUri ?? targetObject.canonicalUri,
          targetObjectId: targetObject.objectId,
          canonicalUri: targetObject.canonicalUri,
          referenceMentionId: mention?.mentionId,
          resolutionStatus: "resolved",
        }
      : link;
  }

  function linkObjectForDraft(link: LoomLink, draftKey: string) {
    const draft = composerDrafts[draftKey] ?? EMPTY_COMPOSER_DRAFT;
    if (
      draft.links.some(
        (item) =>
          item.path === link.path ||
          (link.targetObjectId && item.targetObjectId === link.targetObjectId)
      )
    ) {
      return;
    }
    const stableLink = resolveReferenceLink(link, draftKey);
    if (
      stableLink.targetObjectId &&
      draft.links.some(
        (item) =>
          item.targetObjectId === stableLink.targetObjectId || item.path === stableLink.path
      )
    ) {
      return;
    }
    updateComposerDraft(draftKey, (draft) => ({
      ...draft,
      links: draft.links.some((item) => item.path === stableLink.path)
        ? draft.links
        : [...draft.links, stableLink],
    }));
  }

  function linkObject(link: LoomLink) {
    linkObjectForDraft(link, activeDraftKey);
  }

  function bookmarkResponse(response: ResponseItem) {
    bookmarkLoomLink({
      id: response.id,
      type: "response",
      title: response.title,
      path: response.address,
      badge: "Response",
    });
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
      visitDestination(filteredSuggestions[selectedSuggestion], { source: "addressBar" });
    }
    if (
      event.key === "Enter" &&
      !filteredSuggestions[selectedSuggestion] &&
      isLoomAddress(addressQuery)
    ) {
      event.preventDefault();
      visitDestination(
        {
          id: `address-${Date.now()}`,
          type: "recent",
          title: addressQuery,
          path: addressQuery,
          badge: "Address",
        },
        { source: "addressBar" }
      );
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
    restoreDestination(
      entry,
      entry.navigationDestination
        ? withBackForwardSource(entry.navigationDestination)
        : undefined
    );
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

  function copyLoomAddress(destination: Pick<LoomLink, "path" | "canonicalUri">) {
    void browserHostShell.copyText(destination.canonicalUri ?? destination.path);
  }

  function openComposerReference(link: LoomLink) {
    const resolution = resolveLoomAddress(link.path, loomGraphRepository);
    if (resolution.status === "resolved") {
      visitDestination(link, { source: "userNavigation" });
      return null;
    }
    if (resolution.status === "alias_stale" && resolution.object) {
      const nextLink = {
        ...link,
        ...linkFromResolvedObject(resolution.object),
        path: resolution.staleAliasReplacement ?? resolution.object.aliasUri ?? link.path,
        targetObjectId: resolution.object.objectId,
        canonicalUri: resolution.object.canonicalUri,
      };
      visitDestination(nextLink, { source: "userNavigation" });
      return null;
    }
    if (resolution.status === "broken_reference") {
      loomGraphRepository.emitBrokenReference(
        link,
        resolution.reason ?? "Reference target did not resolve"
      );
    }
    return resolution.reason ?? "This Reference target cannot be opened.";
  }

  function nextGroupName(groups: TabGroup[]) {
    let index = 1;
    while (groups.some((group) => group.name === `Group #${index}`)) index += 1;
    return `Group #${index}`;
  }

  function groupIdForConversation(conversationId: string, groups = tabGroups) {
    return groups.find((group) => group.conversationIds.includes(conversationId))?.id;
  }

  function createGroupFromConversations(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    if (
      pinnedConversationIds.includes(sourceId) ||
      pinnedConversationIds.includes(targetId) ||
      groupIdForConversation(sourceId) ||
      groupIdForConversation(targetId)
    ) {
      return;
    }
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
        .filter((group) => group.conversationIds.length > 1);
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
    if (pinnedConversationIds.includes(conversationId)) return;
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
        .filter((group) => group.conversationIds.length > 1)
    );
  }

  function removeConversationFromGroups(conversationId: string) {
    setTabGroups((current) =>
      current
        .map((group) => ({
          ...group,
          conversationIds: group.conversationIds.filter((id) => id !== conversationId),
        }))
        .filter((group) => group.conversationIds.length > 1)
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
    setConversations((current) => [...current, conversation]);
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
      badge: typeLabel.conversation,
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
    const plainText = plainTextFromDraft(draft);
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
      badge: typeLabel.conversation,
    };
    replaceNavigationEntry(destination);
    setHistory((current) => [
      createHistoryEntry(destination),
      ...markHistoryOlder(current),
    ]);
  }

  async function sendComposerToModel(
    draft: ComposerDraft,
    options: { effort: ModelEffort; loomId?: string; preserveNavigation?: boolean }
  ) {
    const prompt = plainTextFromDraft(draft);
    const meaningful = prompt.length > 0 || draft.links.length > 0;
    if (!meaningful || composerRuntimeState.running) return false;

    const readinessMessage = modelReadinessMessage("main");
    if (readinessMessage) {
      setComposerRuntimeState({ running: false, message: readinessMessage });
      return false;
    }

    setComposerRuntimeState({
      running: true,
      message: `Sending to ${getProfileModel(providerSettings, "main").name}...`,
    });
    const linkContext = draft.links.map((link) => `${link.title}: ${link.path}`);
    const targetLoomId = options.loomId ?? activeConversationId;
    const existingTargetConversation =
      targetLoomId === draftConversation?.id
        ? draftConversation
        : conversations.find((conversation) => conversation.id === targetLoomId);
    const targetConversationId =
      targetLoomId === EPHEMERAL_DRAFT_ID || !existingTargetConversation
        ? `c-${Date.now()}`
        : existingTargetConversation.id;
    const targetConversation =
      targetLoomId === EPHEMERAL_DRAFT_ID || !existingTargetConversation
        ? {
            ...(draftConversation ?? {
              id: targetConversationId,
              folder: "Drafts",
              iconKey: "compass",
              summary: "New conversation created from a prompt draft.",
            }),
            id: targetConversationId,
            title: normalizeLoomTitle(
              prompt ? prompt.slice(0, 54) : "New Loom conversation"
            ),
            path: `loom://drafts/${targetConversationId}`,
            summary: "New conversation created from a prompt draft.",
          }
        : existingTargetConversation;

    try {
      const result = await runModelProfileRequest(providerSettings, {
        profile: "main",
        effort: options.effort,
        prompt: prompt || "Use the attached Loom references to continue this conversation.",
        context: linkContext,
        system:
          "You are Loom AI. Answer clearly, preserve linked-reference provenance, and keep the response useful for later Loom reuse.",
      });
      const responseId = `r-${Date.now()}`;
      const title = normalizeLoomTitle(prompt ? prompt.slice(0, 64) : "Model response");
      const response: ResponseItem = {
        id: responseId,
        title,
        address: `${targetConversation.path}/r-${responseSlug(title)}`,
        question: prompt || "Use the linked Loom references.",
        answer: answerParagraphs(result.text),
        suggestedLinks: [],
        bookmarkedLinks: [],
      };

      if (targetLoomId === EPHEMERAL_DRAFT_ID || !existingTargetConversation) {
        setConversations((current) => [...current, targetConversation]);
        setDraftConversation(null);
        setActiveConversationId(targetConversation.id);
      }

      setConversationResponses((current) => ({
        ...current,
        [targetConversation.id]: [...(current[targetConversation.id] ?? []), response],
      }));
      setComposerDrafts((current) => {
        const { [targetLoomId]: _discardTarget, [EPHEMERAL_DRAFT_ID]: _discardDraft, ...rest } = current;
        return {
          ...rest,
          [targetConversation.id]: { html: "", links: [] },
        };
      });
      if (!options.preserveNavigation) setActiveObjectTitle(response.title);
      const destination: LoomLink = {
        id: response.id,
        type: "response",
        title: response.title,
        path: response.address,
        badge: typeLabel.response,
      };
      if (!options.preserveNavigation) {
        if (targetLoomId === EPHEMERAL_DRAFT_ID) replaceNavigationEntry(destination);
        else pushNavigationEntry(destination);
        setHistory((current) => [
          createHistoryEntry(destination),
          ...markHistoryOlder(current),
        ]);
        pendingScrollPathRef.current = response.address;
      }
      setComposerRuntimeState({
        running: false,
        message: `Main model responded with ${result.modelId}.`,
      });
      return true;
    } catch (error) {
      setComposerRuntimeState({
        running: false,
        message: providerErrorMessage(error),
      });
      return false;
    }
  }

  function jumpNavigationTraversal(targetIndex: number) {
    const resolvedIndex = jumpToTraversalIndex(navigationStack, targetIndex);
    if (resolvedIndex === undefined) return;
    const entry = navigationStack[resolvedIndex];
    setNavigationIndex(resolvedIndex);
    restoreDestination(
      entry,
      entry.navigationDestination
        ? withBackForwardSource(entry.navigationDestination)
        : undefined
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
    restoreDestination(
      entry,
      entry.navigationDestination
        ? withBackForwardSource(entry.navigationDestination)
        : undefined
    );
  }

  function togglePinnedConversation(conversation: Conversation) {
    setPinnedConversationIds((current) =>
      current.includes(conversation.id)
        ? current.filter((id) => id !== conversation.id)
        : [...current, conversation.id]
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
      badge: typeLabel.conversation,
    });
  }

  function bookmarkLoomLink(link: LoomLink) {
    const promotion = loomGraphRepository.promoteBookmark(link);
    setBookmarks((current) => {
      if (
        current.some(
          (item) =>
            item.path === promotion.bookmark.path ||
            item.targetObjectId === promotion.targetObject.objectId
        )
      ) {
        return current;
      }
      return [promotion.bookmark, ...current];
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
    const resolved = resolveLoomAddress(link.path, loomGraphRepository);
    const targetObjectId =
      resolved.status === "resolved"
        ? (resolved.targetObject ?? resolved.object)?.objectId
        : undefined;
    const existing = bookmarks.find(
      (bookmark) =>
        bookmark.path === link.path ||
        (targetObjectId && bookmark.targetObjectId === targetObjectId)
    );
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

  function forkResponseLoom(response: ResponseItem, sourceLoomId = activeConversationId) {
    const sourceConversation =
      sourceLoomId === draftConversation?.id
        ? draftConversation
        : conversations.find((conversation) => conversation.id === sourceLoomId);
    if (!sourceConversation) return;
    const sourceResponses = conversationResponses[sourceConversation.id] ?? [];
    const responseIndex = sourceResponses.findIndex((item) => item.id === response.id);
    if (responseIndex < 0) return;
    const existingFork = forkRecords.find(
      (record) =>
        record.parentConversationId === sourceConversation.id &&
        record.parentResponseId === response.id
    );
    const existingWeft = existingFork
      ? conversations.find((conversation) => conversation.id === existingFork.childConversationId)
      : undefined;
    const openWeftDestination = (weftConversation: Conversation) => {
      setActiveConversationId(weftConversation.id);
      setActiveSplitPanel("weft");
      setActiveObjectTitle(response.title);
      setActivePanel(null);
      setGraphMode(false);
      const destination: LoomLink = {
        id: weftConversation.id,
        type: "loom",
        title: weftConversation.title,
        path: weftConversation.path,
        badge: typeLabel.loom,
      };
      const originLastResponse = lastResponseInLoom(sourceConversation.id);
      const originAtResponseLink = responseLinkForNavigation(sourceConversation.id, response);
      const originAtLastLink = originLastResponse
        ? responseLinkForNavigation(sourceConversation.id, originLastResponse)
        : loomLinkForId(sourceConversation.id);
      const originAtLastDestination: LoomNavigationDestination = {
        loomId: sourceConversation.id,
        mode: "full",
        scrollTargetResponseId: originLastResponse?.id,
        scrollMode: "lastResponse",
        source: "weftCreate",
      };
      const originAtResponseDestination: LoomNavigationDestination = {
        loomId: sourceConversation.id,
        mode: "full",
        scrollTargetResponseId: response.id,
        scrollMode: "origin",
        source: "weftCreate",
      };
      const splitWeftDestination: LoomNavigationDestination = {
        loomId: weftConversation.id,
        mode: "split",
        originLoomId: sourceConversation.id,
        originResponseId: response.id,
        source: "weftCreate",
      };
      if (
        !historyEntryMatchesDestination(
          navigationStack[navigationIndex],
          destination,
          splitWeftDestination
        )
      ) {
        pushNavigationSequence([
          { link: originAtLastLink, destination: originAtLastDestination },
          { link: originAtResponseLink, destination: originAtResponseDestination },
          { link: destination, destination: splitWeftDestination },
        ]);
        setHistory((current) => [
          createHistoryEntry(destination, splitWeftDestination),
          ...markHistoryOlder(current),
        ]);
      }
      pendingScrollDestinationRef.current = splitWeftDestination;
    };
    if (existingWeft) {
      openWeftDestination(existingWeft);
      return;
    }
    const id = `c-loom-${Date.now()}`;
    const path = `${sourceConversation.path}/loom/${id}`;
    const title = normalizeLoomTitle(`Loom: ${response.title}`);
    const conversation: Conversation = {
      id,
      title,
      path,
      folder: sourceConversation.folder,
      summary: `Branched from ${sourceConversation.title}.`,
      iconKey: "workflow",
    };
    const lineage = sourceResponses.slice(0, responseIndex + 1).map((item, index) => ({
      ...item,
      id: `${item.id}-${id}`,
      address: `${path}/r-${index + 1}`,
    }));
    setConversations((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceConversation.id);
      if (sourceIndex < 0) return [conversation, ...current];
      return [
        ...current.slice(0, sourceIndex),
        conversation,
        ...current.slice(sourceIndex),
      ];
    });
    setTabGroups((current) =>
      current.map((group) => {
        const sourceIndex = group.conversationIds.indexOf(sourceConversation.id);
        if (sourceIndex < 0) return group;
        return {
          ...group,
          conversationIds: [
            ...group.conversationIds.slice(0, sourceIndex),
            id,
            ...group.conversationIds.slice(sourceIndex),
          ],
        };
      })
    );
    setConversationResponses((current) => ({
      ...current,
      [id]: lineage,
    }));
    setForkRecords((current) => [
      ...current,
      {
        id: `fork-${sourceConversation.id}-${response.id}-${id}`,
        parentConversationId: sourceConversation.id,
        parentResponseId: response.id,
        childConversationId: id,
        title: `Loom from ${response.title}`,
      },
    ]);
    setComposerDrafts((current) => ({
      ...current,
      [id]: { html: "", links: [] },
    }));
    openWeftDestination(conversation);
  }

  function returnToOrigin() {
    const origin = getWeftOrigin(activeConversationId);
    if (!origin) return;
    const originResponse = findResponseInLoom(origin.originLoomId, origin.originResponseId);
    const destination: LoomNavigationDestination = {
      loomId: origin.originLoomId,
      mode: "full",
      scrollTargetResponseId: origin.originResponseId,
      scrollMode: "origin",
      source: "returnToOrigin",
    };
    const link = originResponse
      ? responseLinkForNavigation(origin.originLoomId, originResponse)
      : loomLinkForId(origin.originLoomId);
    restoreDestination(link, destination);
    pushNavigationEntry(link, destination);
    setHistory((current) => [
      createHistoryEntry(link, destination),
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
          badge: typeLabel.conversation,
        });
        setActivePanel(null);
      }
      if (item.id === "pin" || item.id === "unpin") togglePinnedConversation(conversation);
      if (item.id === "rename") renameConversation(conversation);
      if (item.id === "change-icon") setIconPickerTarget(conversation);
      if (item.id === "bookmark") bookmarkConversation(conversation);
      if (item.id === "copy-address") copyLoomAddress(conversation);
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
      if (item.id === "copy-address") copyLoomAddress(bookmark);
      if (item.id === "remove") removeBookmark(bookmark);
    }

    if (payload.kind === "history-entry") {
      const { entry } = payload;
      if (item.id === "open") visitDestination(entry);
      if (item.id === "insert") linkObject(entry);
      if (item.id === "bookmark") bookmarkLoomLink(entry);
      if (item.id === "copy-address") copyLoomAddress(entry);
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

  async function submitQuickQuestion() {
    if (!askState || askState.running) return;
    const prompt = askState.question.trim();
    if (!prompt) {
      setAskState({ ...askState, error: "Write a quick question first." });
      return;
    }
    const readinessMessage = modelReadinessMessage("quick");
    if (readinessMessage) {
      setAskState({ ...askState, error: readinessMessage });
      return;
    }
    setAskState({ ...askState, running: true, error: undefined });
    try {
      const result = await runModelProfileRequest(providerSettings, {
        profile: "quick",
        effort: "Low",
        prompt,
        context: [
          `Selected text: ${askState.selectedText}`,
          `Response title: ${askState.response.title}`,
          `Response address: ${askState.response.address}`,
        ],
        system:
          "Answer this as a short Loom quick question. Be concise and stay anchored to the selected text.",
      });
      setAskState({
        ...askState,
        running: false,
        answered: true,
        answer: result.text,
        error: undefined,
      });
    } catch (error) {
      setAskState({
        ...askState,
        running: false,
        answered: false,
        error: providerErrorMessage(error),
      });
    }
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

  function onSelectionAsk(response: ResponseItem, draftKey = activeDraftKey) {
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
      draftKey,
      selectedText: selected,
      x: Math.min(window.innerWidth - 260, Math.max(12, rect.left + rect.width / 2)),
      y: Math.max(52, rect.top - 12),
    });
  }

  function launchSelectionAsk(kind: "ask" | "quick") {
    if (!selectionAskState) return;
    if (kind === "ask") {
      setSelectionReference({
        draftKey: selectionAskState.draftKey,
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

  function renderPanelComposer(loomId: string, panel: "origin" | "weft") {
    const panelActive = activeSplitPanel === panel;
    return (
      <PromptComposer
        variant="bottom"
        draftKey={loomId}
        draft={composerDrafts[loomId] ?? EMPTY_COMPOSER_DRAFT}
        attachedReferences={
          selectionReference?.draftKey === loomId ? [selectionReference.link] : []
        }
        referenceOptions={composerReferenceOptions}
        attachContentItems={attachContentItems}
        providerSettings={providerSettings}
        runtimeState={composerRuntimeState}
        runtimeHealth={activeComposerRuntimeHealth}
        active={panelActive}
        onActivate={() => setActiveSplitPanel(panel)}
        onProviderSettingsChange={saveProviderSettings}
        onOpenProviderSettings={() => setProviderSettingsOpen(true)}
        onDraftChange={(draft) => setComposerDraftForKey(loomId, draft)}
        onRemoveLink={(link) => removeComposerLink(loomId, link)}
        onDropLink={(link) => linkObjectForDraft(link, loomId)}
        onResolveReference={(link) => resolveReferenceLink(link, loomId)}
        onOpenReference={openComposerReference}
        onCopyReferenceAddress={copyLoomAddress}
        onRemoveAttachedReference={() => {
          setSelectionReference(null);
          clearSelectionHighlight();
        }}
        onReadyToFocus={(focus) => {
          if (panelActive) composerFocusRef.current = focus;
        }}
        onSend={(draft, options) =>
          sendComposerToModel(draft, {
            ...options,
            loomId,
            preserveNavigation: showWeftSplit,
          })
        }
        onUserTyping={() => {
          const transcript =
            panel === "origin" ? originTranscriptRef.current : transcriptRef.current;
          transcript?.scrollTo({
            top: transcript.scrollHeight,
            behavior: "smooth",
          });
        }}
      />
    );
  }

  function focusSplitPanel(panel: "origin" | "weft", options: { graph?: boolean; latest?: boolean } = {}) {
    const conversation = panel === "origin" ? originConversation : activeConversation;
    if (!conversation) return;
    const origin = panel === "weft" ? activeWeftOrigin : undefined;
    const originResponse =
      panel === "origin" && activeWeftOrigin
        ? findResponseInLoom(conversation.id, activeWeftOrigin.originResponseId)
        : undefined;
    const latestResponse = options.latest ? lastResponseInLoom(conversation.id) : undefined;
    const navigationDestination: LoomNavigationDestination = {
      loomId: conversation.id,
      mode: "full",
      originLoomId: origin?.originLoomId,
      originResponseId: origin?.originResponseId,
      scrollTargetResponseId:
        latestResponse?.id ??
        (panel === "origin" ? activeWeftOrigin?.originResponseId : undefined),
      scrollMode: latestResponse ? "lastResponse" : panel === "origin" ? "origin" : undefined,
      source: "userNavigation",
    };
    const link =
      latestResponse
        ? responseLinkForNavigation(conversation.id, latestResponse)
        : originResponse
          ? responseLinkForNavigation(conversation.id, originResponse)
          : loomLinkForId(conversation.id);
    restoreDestination(link, navigationDestination);
    pushNavigationEntry(link, navigationDestination);
    setHistory((current) => [
      createHistoryEntry(link, navigationDestination),
      ...markHistoryOlder(current),
    ]);
    setSplitPanelMenu(null);
    setActiveSplitPanel(panel);
    if (options.graph) {
      setGraphMode(true);
      setActivePanel(null);
    }
  }

  function copySplitPanelAddress(panel: "origin" | "weft") {
    const conversation = panel === "origin" ? originConversation : activeConversation;
    if (!conversation) return;
    copyLoomAddress(loomLinkForId(conversation.id));
    setSplitPanelMenu(null);
  }

  function renderSplitPanelControls(panel: "origin" | "weft") {
    const label = panel === "origin" ? "Origin" : "Weft";
    return (
      <div className="split-panel-controls" aria-label={`${label} panel controls`}>
        {panel === "weft" && (
          <>
            <button
              className="split-panel-control"
              type="button"
              title="Maximize Weft"
              aria-label="Maximize Weft"
              onClick={(event) => {
                event.stopPropagation();
                focusSplitPanel("weft");
              }}
            >
              <Maximize2 size={13} />
            </button>
            <button
              className="split-panel-control"
              type="button"
              title="Close Weft Panel"
              aria-label="Close Weft Panel"
              onClick={(event) => {
                event.stopPropagation();
                focusSplitPanel("origin");
              }}
            >
              <X size={13} />
            </button>
          </>
        )}
        <button
          className="split-panel-control"
          type="button"
          title="More"
          aria-label="More"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setSplitPanelMenu({
              panel,
              x: rect.right - 176,
              y: rect.bottom + 6,
            });
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    );
  }

  return (
    <AppShell sidebarCollapsed={sidebarCollapsed}>
      <TopBrowserBar
        addressBarRef={addressBarRef}
        location={currentLocation}
        path={currentActiveDestination.path}
        addressFocused={addressFocused}
        addressQuery={addressQuery}
        suggestions={filteredSuggestions}
        resolutionFeedback={addressFeedback}
        selectedSuggestion={selectedSuggestion}
        canBack={navigationIndex > 0}
        canForward={navigationIndex < navigationStack.length - 1}
        backTraversal={getBackTraversal(navigationStack, navigationIndex)}
        forwardTraversal={getForwardTraversal(navigationStack, navigationIndex)}
        graphMode={graphMode}
        activePanel={activePanel}
        sidebarCollapsed={sidebarCollapsed}
        currentBookmarked={isDestinationBookmarked(currentActiveDestination)}
        currentDestination={currentActiveDestination}
        onAddressFocus={() => setAddressFocused(true)}
        onAddressChange={(value) => {
          setAddressQuery(value);
          setAddressFeedback(null);
          setSelectedSuggestion(0);
        }}
        onAddressKeyDown={handleAddressKeyDown}
        onVisit={(destination) => visitDestination(destination, { source: "addressBar" })}
        onBack={() => handleBackForward("back")}
        onForward={() => handleBackForward("forward")}
        onJumpTraversal={jumpNavigationTraversal}
        onBookmarkCurrent={() => {
          bookmarkLoomLink(currentActiveDestination);
        }}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onTogglePanel={(panel) => {
          setAddressFocused(false);
          setActivePanel(activePanel === panel ? null : panel);
          setAddressFeedback(null);
        }}
        onToggleGraph={() => {
          setAddressFocused(false);
          setAddressQuery("");
          setAddressFeedback(null);
          setGraphMode((current) => !current);
          setActivePanel(null);
        }}
        onOpenProviderSettings={() => setProviderSettingsOpen(true)}
      />

      <div className="app-body">
        <Sidebar
          conversations={conversations}
          pinnedConversationIds={pinnedConversationIds}
          tabGroups={tabGroups}
          renamingGroupId={renamingGroupId}
          collapsed={sidebarCollapsed}
          archivedCount={archived.length}
          activeConversationId={
            showWeftSplit && focusedSplitConversation
              ? focusedSplitConversation.id
              : activeConversationId
          }
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
              badge: typeLabel.conversation,
            });
            setActivePanel(null);
          }}
          onOpenPanel={setActivePanel}
          onArchive={archiveConversation}
          onOpenContextMenu={openConversationMenu}
          onOpenGroupContextMenu={openGroupMenu}
          onDeleteRequest={setDeleteTarget}
        />

        <main className="workspace" ref={workspaceRef}>

        <ConversationView emptyDraft={isNewConversationDraft}>
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
                attachContentItems={attachContentItems}
                providerSettings={providerSettings}
                runtimeState={composerRuntimeState}
                runtimeHealth={activeComposerRuntimeHealth}
                onProviderSettingsChange={saveProviderSettings}
                onOpenProviderSettings={() => setProviderSettingsOpen(true)}
                onDraftChange={setActiveComposerDraft}
                onRemoveLink={(link) =>
                  updateComposerDraft(activeDraftKey, (draft) => ({
                    ...draft,
                    links: draft.links.filter((item) => item.path !== link.path),
                  }))
                }
                onDropLink={linkObject}
                onResolveReference={resolveReferenceLink}
                onOpenReference={openComposerReference}
                onCopyReferenceAddress={copyLoomAddress}
                onRemoveAttachedReference={() => {
                  setSelectionReference(null);
                  clearSelectionHighlight();
                }}
                onReadyToFocus={(focus) => {
                  composerFocusRef.current = focus;
                }}
                onSend={sendComposerToModel}
                onUserTyping={scrollTranscriptToBottom}
              />
            </section>
          ) : (
            <>
              {showWeftSplit ? (
                  <WeftView>
                    <div className="weft-split-view">
                      {originConversation && (
                        <div
                          className="weft-panel origin-split-panel"
                          onPointerDownCapture={() => setActiveSplitPanel("origin")}
                          onFocusCapture={() => setActiveSplitPanel("origin")}
                        >
                          {renderSplitPanelControls("origin")}
                          <ChatTranscript
                            transcriptRef={(node) => {
                              originTranscriptRef.current = node;
                            }}
                            conversation={originConversation}
                            responses={originResponses}
                            onLink={(link) => {
                              setActiveSplitPanel("origin");
                              linkObjectForDraft(link, originConversation.id);
                            }}
                            onAsk={openAsk}
                            onLoom={(response) => forkResponseLoom(response, originConversation.id)}
                            onToggleSuggestedBookmark={toggleSuggestedBookmark}
                            bookmarkedPaths={new Set(bookmarks.map((bookmark) => bookmark.path))}
                            onSelectionAsk={(response) => {
                              setActiveSplitPanel("origin");
                              onSelectionAsk(response, originConversation.id);
                            }}
                            responseTitleOverrides={responseTitleOverrides}
                            onOpenContextMenu={(event, response) =>
                              openContextMenu(event, { kind: "response", response })
                            }
                          />
                          {renderPanelComposer(originConversation.id, "origin")}
                        </div>
                      )}
                      {activeConversation && (
                        <div
                          className="weft-panel weft-split-panel"
                          onPointerDownCapture={() => setActiveSplitPanel("weft")}
                          onFocusCapture={() => setActiveSplitPanel("weft")}
                        >
                          {renderSplitPanelControls("weft")}
                          <ChatTranscript
                            transcriptRef={(node) => {
                              transcriptRef.current = node;
                            }}
                            conversation={activeConversation}
                            responses={activeResponses}
                            onLink={(link) => {
                              setActiveSplitPanel("weft");
                              linkObjectForDraft(link, activeConversation.id);
                            }}
                            onAsk={openAsk}
                            onLoom={(response) => forkResponseLoom(response, activeConversation.id)}
                            onToggleSuggestedBookmark={toggleSuggestedBookmark}
                            bookmarkedPaths={new Set(bookmarks.map((bookmark) => bookmark.path))}
                            onSelectionAsk={(response) => {
                              setActiveSplitPanel("weft");
                              onSelectionAsk(response, activeConversation.id);
                            }}
                            responseTitleOverrides={responseTitleOverrides}
                            onOpenContextMenu={(event, response) =>
                              openContextMenu(event, { kind: "response", response })
                            }
                            onReturnToOrigin={returnToOrigin}
                          />
                          {renderPanelComposer(activeConversation.id, "weft")}
                        </div>
                      )}
                      {splitPanelMenu && (
                        <div
                          className="split-panel-menu"
                          role="menu"
                          style={{ left: splitPanelMenu.x, top: splitPanelMenu.y }}
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          {splitPanelMenu.panel === "origin" ? (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => focusSplitPanel("origin", { latest: true })}
                            >
                              Return to Latest Response
                            </button>
                          ) : (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setSplitPanelMenu(null);
                                returnToOrigin();
                              }}
                            >
                              Return to Origin
                            </button>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => copySplitPanelAddress(splitPanelMenu.panel)}
                          >
                            Copy Loom Address
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => focusSplitPanel(splitPanelMenu.panel, { graph: true })}
                          >
                            Open in Graph View
                          </button>
                        </div>
                      )}
                    </div>
                  </WeftView>
                ) : (
                  <ChatTranscript
                    transcriptRef={(node) => {
                      transcriptRef.current = node;
                      originTranscriptRef.current = null;
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
                    onReturnToOrigin={activeWeftOrigin ? returnToOrigin : undefined}
                  />
                )}

              {!showWeftSplit && (
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
                  attachContentItems={attachContentItems}
                  providerSettings={providerSettings}
                  runtimeState={composerRuntimeState}
                  runtimeHealth={activeComposerRuntimeHealth}
                  onProviderSettingsChange={saveProviderSettings}
                  onOpenProviderSettings={() => setProviderSettingsOpen(true)}
                  onDraftChange={setActiveComposerDraft}
                  onRemoveLink={(link) => removeComposerLink(activeDraftKey, link)}
                  onDropLink={linkObject}
                  onResolveReference={resolveReferenceLink}
                  onOpenReference={openComposerReference}
                  onCopyReferenceAddress={copyLoomAddress}
                  onRemoveAttachedReference={() => {
                    setSelectionReference(null);
                    clearSelectionHighlight();
                  }}
                  onReadyToFocus={(focus) => {
                    composerFocusRef.current = focus;
                  }}
                  onSend={sendComposerToModel}
                  onUserTyping={scrollTranscriptToBottom}
                />
              )}
            </>
          )}
        </ConversationView>
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
          onOpenHistoryMenu={(event, entry) =>
            openContextMenu(event, { kind: "history-entry", entry })
          }
          onDropBookmark={bookmarkLoomLink}
          onRestore={restoreConversation}
          onDeleteRequest={setDeleteTarget}
	        />
        {graphMode && (
          <div className="graph-overlay-panel" aria-label="Graph View overlay">
            <button
              className="graph-overlay-close"
              type="button"
              aria-label="Close Graph View"
              title="Close Graph View"
              onClick={() => setGraphMode(false)}
            >
              <X size={14} />
            </button>
            <GraphView
              conversations={conversations}
              responses={focusedSplitResponses}
              onVisit={visitDestination}
            />
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      {iconPickerTarget && (
        <ChangeIconPopover
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
        <SelectionPopover
          x={selectionAskState.x}
          y={selectionAskState.y}
          onAsk={() => launchSelectionAsk("ask")}
          onQuickQuestion={() => launchSelectionAsk("quick")}
        />
      )}

      {askState && (
        <AskPopup
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
              badge: typeLabel.loom,
            });
            closeSelectionAskFlow();
          }}
          onSubmit={submitQuickQuestion}
        />
      )}

      {providerSettingsOpen && (
        <AIProviderSettingsModal
          settings={providerSettings}
          runtimeHealth={activeComposerRuntimeHealth}
          onSave={saveProviderSettings}
          onClose={() => setProviderSettingsOpen(false)}
        />
      )}

      {deleteTarget && (
        <DeleteConversationDialog
          conversation={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteConversation(deleteTarget)}
        />
      )}
    </AppShell>
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
  const folderListRef = useRef<HTMLDivElement | null>(null);
  const dragPreviewCleanupRef = useRef<(() => void) | null>(null);
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
  const sidebarDnD = useSidebarDnD({
    conversations,
    pinnedConversationIds,
    tabGroups,
    operations: {
      createGroup: onCreateGroup,
      addToGroup: onAddToGroup,
      removeFromGroups: onRemoveFromGroups,
    },
  });

  useEffect(() => {
    folderListRef.current?.scrollTo({
      top: folderListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [conversations.length, activeConversationId]);

  function conversationToLink(conversation: Conversation): LoomLink {
    return {
      id: conversation.id,
      type: "conversation",
      title: conversation.title,
      path: conversation.path,
      badge: typeLabel.conversation,
    };
  }

  function handleConversationDragStart(event: React.DragEvent, conversation: Conversation) {
    sidebarDnD.startDrag(conversation.id);
    setLoomDragPayload(event, conversationToLink(conversation));
    dragPreviewCleanupRef.current?.();
    dragPreviewCleanupRef.current = createLoomDragPreview(event, conversation.title);
  }

  function handleConversationDragEnd() {
    sidebarDnD.endDrag();
    dragPreviewCleanupRef.current?.();
    dragPreviewCleanupRef.current = null;
  }

  function renderConversationTab(conversation: Conversation) {
    const pinned = pinnedConversationIds.includes(conversation.id);
    const groupId = sidebarDnD.getGroupIdForConversation(conversation.id);
    const Icon = getConversationIconOption(conversation.iconKey).Icon;
    return (
      <div
        key={conversation.id}
        className={[
          "conversation-tab",
          conversation.id === activeConversationId ? "active" : "",
          sidebarDnD.groupingPreviewId === conversation.id ? "grouping-preview" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onContextMenu={(event) => onOpenContextMenu(event, conversation)}
        onDragEnter={() => sidebarDnD.handleConversationDragEnter(conversation.id)}
        onDragOver={(event) => sidebarDnD.handleConversationDragOver(event, conversation.id)}
        onDragLeave={sidebarDnD.handleConversationDragLeave}
        onDrop={(event) => sidebarDnD.handleConversationDrop(event, conversation.id)}
        data-testid={`sidebar-loom-${conversation.id}`}
        data-loom-id={conversation.id}
        data-sidebar-group-id={groupId ?? "standalone"}
        data-sidebar-pinned={pinned ? "true" : "false"}
        data-sidebar-dnd-armed={
          sidebarDnD.armedIntent === "createGroup" &&
          sidebarDnD.hoverTargetId === `conversation:${conversation.id}`
            ? "createGroup"
            : undefined
        }
        data-sidebar-dnd-feedback={
          sidebarDnD.hoverTargetId === `conversation:${conversation.id}`
            ? sidebarDnD.dropFeedbackIntent ?? undefined
            : undefined
        }
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
      data-dnd-context="sidebar"
      data-testid="loom-sidebar"
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

      {pinnedConversations.length > 0 && (
        <section className="pinned-tabs" aria-label="Pinned conversations" data-testid="sidebar-pinned-zone">
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

      <div className="folder-list" ref={folderListRef}>
        {tabGroups.map((group) => {
          const groupConversations = group.conversationIds
            .map((id) => conversations.find((conversation) => conversation.id === id))
            .filter((conversation): conversation is Conversation => Boolean(conversation));
          if (groupConversations.length === 0) return null;
          return (
            <section
              className={[
                "tab-group",
                sidebarDnD.groupDropTargetId === group.id ? "group-drop-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={group.id}
              onDragEnter={() => sidebarDnD.handleGroupDragEnter(group.id)}
              onDragOver={(event) => sidebarDnD.handleGroupDragOver(event, group.id)}
              onDragLeave={sidebarDnD.handleGroupDragLeave}
              onDrop={(event) => sidebarDnD.handleGroupDrop(event, group.id)}
              data-testid={`sidebar-group-${group.id}`}
              data-sidebar-group-id={group.id}
              data-sidebar-dnd-armed={
                sidebarDnD.armedIntent === "createGroup" &&
                sidebarDnD.groupDropTargetId === group.id
                  ? "createGroup"
                  : undefined
              }
              data-sidebar-dnd-feedback={
                sidebarDnD.groupDropTargetId === group.id
                  ? sidebarDnD.dropFeedbackIntent ?? undefined
                  : undefined
              }
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
          className={sidebarDnD.standaloneDropActive ? "loose-tabs standalone-drop-zone active" : "loose-tabs standalone-drop-zone"}
          onDragEnter={sidebarDnD.handleStandaloneDragEnter}
          onDragOver={sidebarDnD.handleStandaloneDragOver}
          onDragLeave={sidebarDnD.handleStandaloneDragLeave}
          onDrop={sidebarDnD.handleStandaloneDrop}
          data-testid="sidebar-standalone-zone"
          data-sidebar-dnd-armed={
            sidebarDnD.armedIntent === "createGroup" && sidebarDnD.hoverTargetId === "standalone"
              ? "createGroup"
              : undefined
          }
          data-sidebar-dnd-feedback={
            sidebarDnD.hoverTargetId === "standalone"
              ? sidebarDnD.dropFeedbackIntent ?? undefined
              : undefined
          }
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
      data-testid={`sidebar-pinned-loom-${conversation.id}`}
      data-loom-id={conversation.id}
      data-sidebar-pinned="true"
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
  resolutionFeedback: LoomResolutionResult | null;
  selectedSuggestion: number;
  canBack: boolean;
  canForward: boolean;
  backTraversal: NavigationTraversalEntry[];
  forwardTraversal: NavigationTraversalEntry[];
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
  onJumpTraversal: (index: number) => void;
  onBookmarkCurrent: () => void;
  onToggleSidebar: () => void;
  onTogglePanel: (panel: "bookmarks" | "history" | "looms") => void;
  onToggleGraph: () => void;
  onOpenProviderSettings: () => void;
}

function TopBrowserBar({
  addressBarRef,
  location,
  path,
  addressFocused,
  addressQuery,
  suggestions,
  resolutionFeedback,
  selectedSuggestion,
  canBack,
  canForward,
  backTraversal,
  forwardTraversal,
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
  onJumpTraversal,
  onBookmarkCurrent,
  onToggleSidebar,
  onTogglePanel,
  onToggleGraph,
  onOpenProviderSettings,
}: TopBrowserBarProps) {
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const forwardButtonRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [traversalMenu, setTraversalMenu] = useState<{
    direction: NavigationDirection;
    x: number;
    y: number;
    highlightedIndex: number;
  } | null>(null);
  const activeTraversal =
    traversalMenu?.direction === "back" ? backTraversal : forwardTraversal;

  function closeTraversalMenu() {
    setTraversalMenu(null);
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function openTraversalMenu(
    direction: NavigationDirection,
    anchor: { x: number; y: number }
  ) {
    const entries = direction === "back" ? backTraversal : forwardTraversal;
    if (entries.length === 0) return;
    setTraversalMenu({
      direction,
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - 320)),
      y: Math.max(8, Math.min(anchor.y, window.innerHeight - 360)),
      highlightedIndex: 0,
    });
  }

  function openTraversalMenuFromButton(direction: NavigationDirection) {
    const button = direction === "back" ? backButtonRef.current : forwardButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    openTraversalMenu(direction, { x: rect.left, y: rect.bottom + 6 });
  }

  function handleTraversalPointerDown(direction: NavigationDirection) {
    clearLongPressTimer();
    suppressClickRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      openTraversalMenuFromButton(direction);
    }, 520);
  }

  function handleTraversalPointerUp() {
    clearLongPressTimer();
  }

  function handleTraversalClick(
    event: React.MouseEvent<HTMLButtonElement>,
    action: () => void
  ) {
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }
    action();
  }

  function selectTraversalEntry(item: NavigationTraversalEntry) {
    onJumpTraversal(item.index);
    closeTraversalMenu();
  }

  useEffect(() => {
    if (!traversalMenu) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest(".traversal-menu, .traversal-nav-button")) return;
      closeTraversalMenu();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTraversalMenu();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setTraversalMenu((current) =>
          current
            ? {
                ...current,
                highlightedIndex: Math.min(
                  current.highlightedIndex + 1,
                  activeTraversal.length - 1
                ),
              }
            : current
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setTraversalMenu((current) =>
          current
            ? {
                ...current,
                highlightedIndex: Math.max(current.highlightedIndex - 1, 0),
              }
            : current
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (!traversalMenu) return;
        const item = activeTraversal[traversalMenu.highlightedIndex];
        if (item) selectTraversalEntry(item);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTraversal, traversalMenu]);

  useEffect(() => () => clearLongPressTimer(), []);

  return (
    <TopBar>
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
          ref={backButtonRef}
          className="icon-button traversal-nav-button"
          disabled={!canBack}
          onClick={(event) => handleTraversalClick(event, onBack)}
          onContextMenu={(event) => {
            event.preventDefault();
            openTraversalMenu("back", { x: event.clientX, y: event.clientY });
          }}
          onPointerDown={() => handleTraversalPointerDown("back")}
          onPointerUp={handleTraversalPointerUp}
          onPointerLeave={handleTraversalPointerUp}
          aria-label="Back"
          title="Back. Right-click or long-press for Back Traversal."
        >
          <ArrowLeft size={17} />
        </button>
        <button
          ref={forwardButtonRef}
          className="icon-button traversal-nav-button"
          disabled={!canForward}
          onClick={(event) => handleTraversalClick(event, onForward)}
          onContextMenu={(event) => {
            event.preventDefault();
            openTraversalMenu("forward", { x: event.clientX, y: event.clientY });
          }}
          onPointerDown={() => handleTraversalPointerDown("forward")}
          onPointerUp={handleTraversalPointerUp}
          onPointerLeave={handleTraversalPointerUp}
          aria-label="Forward"
          title="Forward. Right-click or long-press for Forward Traversal."
        >
          <ArrowRight size={17} />
        </button>
        {traversalMenu && (
          <TraversalMenu
            direction={traversalMenu.direction}
            entries={activeTraversal}
            highlightedIndex={traversalMenu.highlightedIndex}
            style={{ left: traversalMenu.x, top: traversalMenu.y }}
            onHighlight={(highlightedIndex) =>
              setTraversalMenu((current) =>
                current ? { ...current, highlightedIndex } : current
              )
            }
            onSelect={selectTraversalEntry}
          />
        )}
      </div>

      <AddressBar addressBarRef={addressBarRef} focused={addressFocused}>
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
              resolutionFeedback={resolutionFeedback}
              selectedSuggestion={selectedSuggestion}
              onVisit={onVisit}
            />
          )}
        </div>
        <button className="icon-button address-share-button" aria-label="Share">
          <Share2 size={16} />
        </button>
      </AddressBar>

      <div className="top-actions">
        <button
          className="chrome-button"
          onClick={onOpenProviderSettings}
          aria-label="Open AI Provider Settings"
          title="AI Providers"
        >
          <Settings size={16} />
        </button>
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
    </TopBar>
  );
}

function TraversalMenu({
  direction,
  entries,
  highlightedIndex,
  style,
  onHighlight,
  onSelect,
}: {
  direction: NavigationDirection;
  entries: NavigationTraversalEntry[];
  highlightedIndex: number;
  style: CSSProperties;
  onHighlight: (index: number) => void;
  onSelect: (entry: NavigationTraversalEntry) => void;
}) {
  return (
    <div
      className="traversal-menu"
      style={style}
      role="menu"
      aria-label={direction === "back" ? "Back Traversal" : "Forward Traversal"}
    >
      <div className="traversal-menu-title">
        {direction === "back" ? "Back Traversal" : "Forward Traversal"}
      </div>
      <div className="traversal-menu-list" role="group" aria-label="Traversal List">
        {entries.map((item, index) => {
          const Icon = iconForType[item.entry.type] ?? Globe2;
          const meta = traversalEntryMeta(item.entry);
          return (
            <button
              type="button"
              key={`${item.index}-${item.entry.id}`}
              className={
                index === highlightedIndex
                  ? "traversal-menu-item highlighted"
                  : "traversal-menu-item"
              }
              role="menuitem"
              onMouseEnter={() => onHighlight(index)}
              onFocus={() => onHighlight(index)}
              onClick={() => onSelect(item)}
            >
              <Icon size={14} />
              <span>
                <strong>{meta.title}</strong>
                <small>{meta.subtitle}</small>
              </span>
              <em>{meta.badge}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function traversalEntryMeta(entry: HistoryEntry) {
  const destination = entry.navigationDestination;
  const titlePrefix = entry.type === "loom" ? "Weft: " : "";
  const mode =
    destination?.mode === "split"
      ? "Split"
      : destination?.mode === "full" && entry.type === "loom"
        ? "Full"
        : undefined;
  const scroll =
    destination?.scrollMode === "origin"
      ? "Origin"
      : destination?.scrollMode === "lastResponse"
        ? "Latest"
        : destination?.scrollMode === "exact"
          ? "Exact"
          : undefined;
  const badge = [mode, scroll, displayObjectTypeLabel(entry.badge)].filter(Boolean).join(" · ");

  return {
    title: `${titlePrefix}${entry.title}`,
    subtitle: entry.path,
    badge: badge || typeLabel[entry.type],
  };
}

function AddressSuggestionList({
  suggestions,
  resolutionFeedback,
  selectedSuggestion,
  onVisit,
}: {
  suggestions: AddressSuggestion[];
  resolutionFeedback: LoomResolutionResult | null;
  selectedSuggestion: number;
  onVisit: (destination: LoomLink | AddressSuggestion) => void;
}) {
  const feedbackTitle =
    resolutionFeedback?.status === "alias_stale"
      ? "This Loom address has moved."
      : resolutionFeedback?.status === "not_found"
        ? "No Loom object found."
        : resolutionFeedback?.status === "deleted"
          ? "This Loom object was deleted."
          : resolutionFeedback?.status === "snapshot_missing"
            ? "That revision or snapshot is not available."
            : resolutionFeedback?.status === "window_invalid"
              ? "That window is not valid for this object."
              : resolutionFeedback?.status === "broken_reference"
                ? "This Loom reference is broken."
                : null;
  return (
    <div className="suggestion-popover" role="listbox">
      <div className="suggestion-heading">
        <span>Go somewhere in your AI web</span>
        <kbd>Enter</kbd>
      </div>
      {resolutionFeedback && feedbackTitle && (
        <div className="address-resolution-feedback" role="status">
          <strong>{feedbackTitle}</strong>
          <span>{resolutionFeedback.reason}</span>
          {resolutionFeedback.status === "alias_stale" &&
            resolutionFeedback.staleAliasReplacement && (
              <button
                onClick={() =>
                  onVisit({
                    id: `alias-${resolutionFeedback.staleAliasReplacement}`,
                    type: "recent",
                    title: resolutionFeedback.object?.title ?? "Updated Loom address",
                    path: resolutionFeedback.staleAliasReplacement ?? "",
                    badge: "Alias",
                    targetObjectId: resolutionFeedback.object?.objectId,
                    canonicalUri: resolutionFeedback.canonicalUri,
                  })
                }
              >
                Open updated address
              </button>
            )}
        </div>
      )}
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
  onReturnToOrigin,
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
  onReturnToOrigin?: () => void;
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
        <div className="conversation-context-title-row">
          <h1>{conversation.title}</h1>
          {onReturnToOrigin && (
            <button className="link-chip return-origin-chip" onClick={onReturnToOrigin}>
              <ArrowLeft size={13} />
              <strong>Return to Origin</strong>
            </button>
          )}
        </div>
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
            data-response-id={displayResponse.id}
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
  attachContentItems,
  providerSettings,
  runtimeState,
  runtimeHealth,
  active = true,
  onProviderSettingsChange,
  onOpenProviderSettings,
  onActivate,
  onDraftChange,
  onRemoveLink,
  onRemoveAttachedReference,
  onReadyToFocus,
  onDropLink,
  onResolveReference,
  onOpenReference,
  onCopyReferenceAddress,
  onSend,
  onUserTyping,
}: {
  variant?: "bottom" | "centered";
  draftKey: string;
  draft: ComposerDraft;
  attachedReferences: LoomLink[];
  referenceOptions: ComposerReferenceOption[];
  attachContentItems: AttachContentItem[];
  providerSettings: AIProviderSettings;
  runtimeState: { running: boolean; message: string | null };
  runtimeHealth: RuntimeHealthState & {
    checking: boolean;
    testRuntime: () => Promise<RuntimeHealthState>;
  };
  active?: boolean;
  onProviderSettingsChange: (settings: AIProviderSettings) => void;
  onOpenProviderSettings: () => void;
  onActivate?: () => void;
  onDraftChange: (draft: ComposerDraft) => void;
  onRemoveLink: (link: LoomLink) => void;
  onRemoveAttachedReference: (link: LoomLink) => void;
  onReadyToFocus: (focus: () => void) => void;
  onDropLink: (link: LoomLink) => void;
  onResolveReference: (link: LoomLink) => LoomLink;
  onOpenReference: (link: LoomLink) => string | null;
  onCopyReferenceAddress: (link: Pick<LoomLink, "path" | "canonicalUri">) => void;
  onSend: (draft: ComposerDraft, options: { effort: ModelEffort }) => Promise<boolean>;
  onUserTyping: () => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceButtonRef = useRef<HTMLButtonElement>(null);
  const referenceMenuRef = useRef<HTMLDivElement>(null);
  const insertedPathsRef = useRef<Set<string>>(new Set());
  const activeDraftKeyRef = useRef("");
  const historiesRef = useRef<Record<string, ComposerHistoryState>>({});
  const applyingHistoryRef = useRef(false);
  const pendingInputRef = useRef<{
    inputType: string;
    replacesSelection: boolean;
  } | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  const [attachSearch, setAttachSearch] = useState("");
  const [attachTab, setAttachTab] = useState<AttachContentTab>("all");
  const [attachFeedback, setAttachFeedback] = useState<string | null>(null);
  const [attachPopoverStyle, setAttachPopoverStyle] = useState<{
    left: number;
    top: number;
    minWidth: number;
    placement: "top" | "bottom";
  } | null>(null);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceSearch, setReferenceSearch] = useState("");
  const [referencePopoverStyle, setReferencePopoverStyle] = useState<{
    left: number;
    top: number;
    minWidth: number;
    placement: "top" | "bottom";
  } | null>(null);
  const [referenceOpenError, setReferenceOpenError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const mainModel = getProfileModel(providerSettings, "main");
  const installedModels = providerSettings.ollama.models.filter((model) => model.installed);
  const selectableModels =
    mainModel.provider === "mock"
      ? [mainModel]
      : installedModels.length > 0
        ? installedModels
        : providerSettings.ollama.models;
  const selectedModelId = mainModel.id;
  const runtimeWarning = !runtimeHealth.ollama_running
    ? "Ollama is not running. Test Runtime in AI Providers."
    : !runtimeHealth.models_available
      ? "No Ollama models are installed. Pull a model before sending."
      : !runtimeHealth.selected_model_ready
        ? `${mainModel.name} is not installed. Download it in AI Providers.`
        : null;

  function setMainModel(modelId: string) {
    onProviderSettingsChange({
      ...providerSettings,
      profiles: {
        ...providerSettings.profiles,
        mainModelId: modelId,
      },
    });
  }

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
    const groups: ComposerReferenceGroup[] = ["Open Looms", "Responses", "Bookmarks"];
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

  const selectedReferenceKeys = useMemo(() => {
    const keys = new Set<string>();
    [...attachedReferences, ...draft.links].forEach((link) => {
      keys.add(link.path);
      if (link.targetObjectId) keys.add(link.targetObjectId);
    });
    return keys;
  }, [attachedReferences, draft.links]);

  const currentAttachments = draft.attachments ?? [];

  const filteredAttachItems = useMemo(() => {
    const query = attachSearch.trim().toLowerCase();
    return attachContentItems.filter((item) => {
      if (attachTab === "bookmarks" && item.source !== "bookmark") return false;
      if (attachTab === "history" && item.source !== "history") return false;
      if (attachTab === "openLooms" && item.source !== "openLoom") return false;
      if (attachTab === "responses" && item.source !== "response") return false;
      if (attachTab === "files") return false;
      if (!query) return true;
      return [item.title, item.subtitle, item.path, item.badge, item.source, ...item.keywords]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [attachContentItems, attachSearch, attachTab]);

  const attachGroups = useMemo(
    () => [
      {
        id: "bookmark" as const,
        title: "Bookmarks",
        items: filteredAttachItems.filter((item) => item.source === "bookmark"),
      },
      {
        id: "history" as const,
        title: "Loom History",
        items: filteredAttachItems.filter((item) => item.source === "history"),
      },
      {
        id: "openLoom" as const,
        title: "Open Looms",
        items: filteredAttachItems.filter((item) => item.source === "openLoom"),
      },
      {
        id: "response" as const,
        title: "Responses",
        items: filteredAttachItems.filter((item) => item.source === "response"),
      },
    ],
    [filteredAttachItems]
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        attachPickerOpen &&
        attachButtonRef.current &&
        attachMenuRef.current &&
        !attachButtonRef.current.contains(target) &&
        !attachMenuRef.current.contains(target)
      ) {
        setAttachPickerOpen(false);
        setAttachPopoverStyle(null);
        setAttachFeedback(null);
      }
      if (
        referencePickerOpen &&
        referenceButtonRef.current &&
        referenceMenuRef.current &&
        !referenceButtonRef.current.contains(target) &&
        !referenceMenuRef.current.contains(target)
      ) {
        setReferencePickerOpen(false);
        setReferencePopoverStyle(null);
        setReferenceOpenError(null);
      }
      if (
        mention &&
        surfaceRef.current &&
        !surfaceRef.current.contains(target)
      ) {
        setMention(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMention(null);
        setAttachPickerOpen(false);
        setAttachFeedback(null);
        setReferencePickerOpen(false);
        setReferenceOpenError(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [attachPickerOpen, mention, referencePickerOpen]);

  useLayoutEffect(() => {
    if (!referencePickerOpen) {
      setReferencePopoverStyle(null);
      return;
    }

    function updateReferencePopoverPosition() {
      const button = referenceButtonRef.current;
      const menu = referenceMenuRef.current;
      if (!button || !menu) return;

      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 6;
      const minWidth = Math.max(buttonRect.width, 330);

      let left = buttonRect.left;
      let top = buttonRect.bottom + gap;
      let placement: "top" | "bottom" = "bottom";

      if (top + menuRect.height > window.innerHeight - viewportPadding) {
        const aboveTop = buttonRect.top - gap - menuRect.height;
        if (aboveTop >= viewportPadding) {
          top = aboveTop;
          placement = "top";
        }
      }

      const width = Math.max(menuRect.width, minWidth);
      if (left + width > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      }

      setReferencePopoverStyle({ left, top, minWidth: width, placement });
    }

    const raf = window.requestAnimationFrame(updateReferencePopoverPosition);
    window.addEventListener("resize", updateReferencePopoverPosition);
    window.addEventListener("scroll", updateReferencePopoverPosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateReferencePopoverPosition);
      window.removeEventListener("scroll", updateReferencePopoverPosition, true);
    };
  }, [filteredLinkedReferences.length, referencePickerOpen]);

  useLayoutEffect(() => {
    if (!attachPickerOpen) {
      setAttachPopoverStyle(null);
      return;
    }

    function updateAttachPopoverPosition() {
      const button = attachButtonRef.current;
      const menu = attachMenuRef.current;
      if (!button || !menu) return;

      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 6;
      const minWidth = Math.max(buttonRect.width, 430);
      const fixedMenuHeight = Math.min(360, window.innerHeight - viewportPadding * 2);

      let left = buttonRect.left;
      let top = buttonRect.bottom + gap;
      let placement: "top" | "bottom" = "bottom";

      if (top + fixedMenuHeight > window.innerHeight - viewportPadding) {
        const aboveTop = buttonRect.top - gap - fixedMenuHeight;
        if (aboveTop >= viewportPadding) {
          top = aboveTop;
          placement = "top";
        }
      }

      const width = Math.max(menuRect.width, minWidth);
      if (left + width > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      }

      setAttachPopoverStyle({ left, top, minWidth: width, placement });
    }

    const raf = window.requestAnimationFrame(updateAttachPopoverPosition);
    window.addEventListener("resize", updateAttachPopoverPosition);
    window.addEventListener("scroll", updateAttachPopoverPosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateAttachPopoverPosition);
      window.removeEventListener("scroll", updateAttachPopoverPosition, true);
    };
  }, [attachPickerOpen]);

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
    if (link.targetObjectId) token.dataset.loomTargetObjectId = link.targetObjectId;
    if (link.canonicalUri) token.dataset.loomCanonicalUri = link.canonicalUri;
    if (link.referenceMentionId) token.dataset.loomReferenceMentionId = link.referenceMentionId;
    if (link.resolutionStatus) token.dataset.loomResolutionStatus = link.resolutionStatus;
    token.title = toLoomMarkdown(link);
    token.textContent = `[[${link.title}]]`;
    return token;
  }

  function sameDraft(a: ComposerDraft, b: ComposerDraft) {
    if (a.html !== b.html) return false;
    if (a.links.length !== b.links.length) return false;
    const aAttachments = a.attachments ?? [];
    const bAttachments = b.attachments ?? [];
    if (aAttachments.length !== bAttachments.length) return false;
    const sameLinks = a.links.every((link, index) => {
      const other = b.links[index];
      return (
        other &&
        link.path === other.path &&
        link.title === other.title &&
        link.type === other.type &&
        link.badge === other.badge
      );
    });
    if (!sameLinks) return false;
    return aAttachments.every((attachment, index) => {
      const other = bAttachments[index];
      return (
        other &&
        attachment.id === other.id &&
        attachment.name === other.name &&
        attachment.size === other.size
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
        targetObjectId: token.dataset.loomTargetObjectId,
        canonicalUri: token.dataset.loomCanonicalUri,
        referenceMentionId: token.dataset.loomReferenceMentionId,
        resolutionStatus: token.dataset.loomResolutionStatus as LoomLink["resolutionStatus"],
      });
    });
    return {
      html: editor.innerHTML,
      links: Array.from(linksByPath.values()),
      attachments: draft.attachments ?? [],
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
  }, [draftKey, draft.links, draft.attachments]);

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
    const resolvedLink = onResolveReference(link);
    const token = makeToken(resolvedLink);
    range.deleteContents();
    range.insertNode(document.createTextNode(" "));
    range.insertNode(token);
    placeCaretAfter(token);
    insertedPathsRef.current.add(resolvedLink.path);
    onDropLink(resolvedLink);
    window.requestAnimationFrame(() => commitDraftChange(intent));
    setMention(null);
  }

  function insertTokenAtEnd(link: LoomLink) {
    const editor = editorRef.current;
    if (!editor) return link;
    const resolvedLink = onResolveReference(link);
    const token = makeToken(resolvedLink);
    if (editor.textContent?.trim()) editor.append(document.createTextNode(" "));
    editor.append(token, document.createTextNode(" "));
    insertedPathsRef.current.add(resolvedLink.path);
    return resolvedLink;
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

  function isReferenceSelected(link: LoomLink) {
    return (
      selectedReferenceKeys.has(link.path) ||
      Boolean(link.targetObjectId && selectedReferenceKeys.has(link.targetObjectId))
    );
  }

  function insertReferenceFromAttachPicker(item: AttachContentItem) {
    if (isReferenceSelected(item)) {
      setAttachFeedback("Already referenced");
      return;
    }

    const editor = editorRef.current;
    const selection = window.getSelection();
    const range =
      editor && selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).startContainer)
        ? selection.getRangeAt(0).cloneRange()
        : null;

    if (range) {
      insertTokenAtRange(item, range);
    } else {
      const resolvedLink = insertTokenAtEnd(item);
      onDropLink(resolvedLink);
      window.requestAnimationFrame(() => commitDraftChange("reference-insert"));
    }
    setAttachFeedback(null);
  }

  function toggleAttachReference(item: AttachContentItem) {
    if (isReferenceSelected(item)) {
      removeLinkedReference(item);
      setAttachFeedback(null);
      return;
    }
    insertReferenceFromAttachPicker(item);
  }

  function updateDraftAttachments(nextAttachments: ComposerAttachment[]) {
    const nextDraft = {
      ...extractDraftFromEditor(),
      attachments: nextAttachments,
    };
    const history = getHistoryState();
    const entries = history.entries.slice(0, history.index + 1);
    history.entries = [...entries, nextDraft];
    history.index = history.entries.length - 1;
    history.lastMeta = {
      intent: "external-reference",
      at: Date.now(),
      caret: getCaretOffset(),
      direction: "structural",
    };
    onDraftChange(nextDraft);
  }

  function addAttachments(files: FileList | null) {
    if (!files || files.length === 0) return;
    const existing = draft.attachments ?? [];
    const seen = new Set(
      existing.map((attachment) => `${attachment.name}:${attachment.size}:${attachment.lastModified}`)
    );
    const next = [...existing];
    Array.from(files).forEach((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) return;
      seen.add(key);
      next.push({
        id: key,
        name: file.name,
        size: file.size,
        type: file.type || "File",
        lastModified: file.lastModified,
      });
    });
    updateDraftAttachments(next);
  }

  function removeAttachment(attachmentId: string) {
    updateDraftAttachments(
      (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId)
    );
  }

  async function submitComposer() {
    if (runtimeState.running || runtimeWarning) return;
    const nextDraft = extractDraftFromEditor();
    onDraftChange(nextDraft);
    onUserTyping();
    const sent = await onSend(nextDraft, { effort: "Medium" });
    if (sent) applyDraftSnapshot({ html: "", links: [], attachments: [] });
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
      targetObjectId: token.dataset.loomTargetObjectId,
      canonicalUri: token.dataset.loomCanonicalUri,
      referenceMentionId: token.dataset.loomReferenceMentionId,
      resolutionStatus: token.dataset.loomResolutionStatus as LoomLink["resolutionStatus"],
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
      className={[
        variant === "centered" ? "prompt-composer centered" : "prompt-composer",
        active ? "active" : "passive",
      ].join(" ")}
      aria-label="Prompt composer"
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      data-dnd-context="composer"
      data-testid="prompt-composer"
    >
      <div
        ref={surfaceRef}
        className={dragActive ? "prompt-surface drag-over" : "prompt-surface"}
        data-testid="prompt-surface"
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
            const resolvedLink = insertTokenAtEnd(link);
            onDropLink(resolvedLink);
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
        {currentAttachments.length > 0 && (
          <div className="attached-file-row" aria-label="File attachments">
            {currentAttachments.map((attachment) => (
              <span
                className="file-attachment-chip"
                key={attachment.id}
                title={`${attachment.name} (${formatAttachmentSize(attachment.size)})`}
              >
                <Paperclip size={13} />
                <span>{attachment.name}</span>
                <small>{formatAttachmentSize(attachment.size)}</small>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
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
          data-placeholder="Ask anything, or reference a Loom with #..."
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
            ref={attachButtonRef}
            className="composer-icon-action"
            aria-label="Attach"
            title="Attach"
            aria-haspopup="dialog"
            aria-expanded={attachPickerOpen}
            onClick={() => {
              setAttachPickerOpen((current) => {
                const next = !current;
                if (!next) {
                  setAttachPopoverStyle(null);
                  setAttachFeedback(null);
                }
                return next;
              });
            }}
          >
            <Plus size={16} />
          </button>
          {attachPickerOpen && (
            <AttachContentDropdown
              menuRef={attachMenuRef}
              style={
                attachPopoverStyle
                  ? {
                      left: attachPopoverStyle.left,
                      top: attachPopoverStyle.top,
                      minWidth: attachPopoverStyle.minWidth,
                      visibility: "visible",
                    }
                  : {
                      left: 0,
                      top: 0,
                      minWidth: 430,
                      visibility: "hidden",
                    }
              }
              tab={attachTab}
              query={attachSearch}
              groups={attachGroups}
              filteredItems={filteredAttachItems}
              selectedKeys={selectedReferenceKeys}
              attachments={currentAttachments}
              feedback={attachFeedback}
              fileInputRef={fileInputRef}
              onTabChange={(nextTab) => {
                setAttachTab(nextTab);
                setAttachFeedback(null);
              }}
              onQueryChange={setAttachSearch}
              onToggleReference={toggleAttachReference}
              onAddFiles={addAttachments}
              onRemoveAttachment={removeAttachment}
            />
          )}
          <div className="linked-reference-anchor">
            <button
              ref={referenceButtonRef}
              className={referencePickerOpen ? "reference-globe active" : "reference-globe"}
              onClick={() => {
                setReferencePickerOpen((current) => {
                  const next = !current;
                  if (!next) setReferencePopoverStyle(null);
                  if (!next) setReferenceOpenError(null);
                  return next;
                });
              }}
              aria-label="References"
              title="References"
              aria-haspopup="listbox"
              aria-expanded={referencePickerOpen}
            >
              <Globe2 size={15} />
              <span>References</span>
              {draft.links.length + attachedReferences.length > 0 && (
                <em>{draft.links.length + attachedReferences.length}</em>
              )}
            </button>
            {referencePickerOpen && (
              <LinkedReferenceDropdown
                menuRef={referenceMenuRef}
                style={
                  referencePopoverStyle
                    ? {
                        left: referencePopoverStyle.left,
                        top: referencePopoverStyle.top,
                        minWidth: referencePopoverStyle.minWidth,
                        visibility: "visible",
                      }
                    : {
                        left: 0,
                        top: 0,
                        minWidth: 330,
                        visibility: "hidden",
                      }
                }
                links={filteredLinkedReferences}
                query={referenceSearch}
                error={referenceOpenError}
                onQueryChange={setReferenceSearch}
                onOpen={(link) => {
                  const error = onOpenReference(link);
                  setReferenceOpenError(error);
                  if (!error) {
                    setReferencePickerOpen(false);
                    setReferencePopoverStyle(null);
                  }
                }}
                onCopy={(link) => {
                  onCopyReferenceAddress(link);
                  setReferenceOpenError(null);
                }}
                onRemove={removeLinkedReference}
              />
            )}
          </div>
          <span>Type # to insert Loom references inline.</span>
          <select
            className="model-picker-select"
            value={selectedModelId}
            onChange={(event) => setMainModel(event.target.value)}
            aria-label="Select model"
            title={`Main model: ${mainModel.name}`}
          >
            {selectableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          <button
            className="composer-icon-action"
            onClick={onOpenProviderSettings}
            aria-label="Open AI Provider Settings"
            title="AI Providers"
          >
            <Settings size={15} />
          </button>
          <button className="composer-icon-action" aria-label="Voice input" title="Voice input">
            <Mic size={15} />
          </button>
          <button
            className="send-button"
            aria-label="Send"
            onClick={submitComposer}
            disabled={runtimeState.running || Boolean(runtimeWarning)}
            title={runtimeWarning ?? "Send"}
          >
            <ArrowUp size={16} />
          </button>
        </div>
        {(runtimeWarning || runtimeState.message) && (
          <p
            className={
              runtimeWarning
                ? "composer-runtime-status error"
                : runtimeState.running
                ? "composer-runtime-status"
                : runtimeState.message?.includes("responded")
                  ? "composer-runtime-status"
                  : "composer-runtime-status error"
            }
          >
            {runtimeWarning ?? runtimeState.message}
          </p>
        )}
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
  menuRef,
  style,
  links,
  query,
  error,
  onQueryChange,
  onOpen,
  onCopy,
  onRemove,
}: {
  menuRef: RefObject<HTMLDivElement>;
  style?: CSSProperties;
  links: LoomLink[];
  query: string;
  error: string | null;
  onQueryChange: (query: string) => void;
  onOpen: (link: LoomLink) => void;
  onCopy: (link: LoomLink) => void;
  onRemove: (link: LoomLink) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{
    link: LoomLink;
    x: number;
    y: number;
  } | null>(null);

  function openReference(link: LoomLink) {
    setContextMenu(null);
    onOpen(link);
  }

  return (
    <div ref={menuRef} className="linked-reference-dropdown" style={style}>
      <label className="linked-reference-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search linked references"
          aria-label="Search linked references"
        />
      </label>
      <ReferencesListBox>
        {links.length === 0 ? (
          <div className="empty-state">No linked references.</div>
        ) : (
          links.map((link) => {
            const Icon = iconForType[link.type];
            return (
              <div
                className="linked-reference-row"
                key={`${link.id}-${link.path}`}
                role="button"
                tabIndex={0}
                title="Open Reference"
                onClick={() => openReference(link)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ link, x: event.clientX, y: event.clientY });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  openReference(link);
                }}
              >
                <Icon size={14} />
                <span>
                  <strong>{link.title}</strong>
                  <small>{link.path}</small>
                </span>
                <button
                  className="linked-reference-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    setContextMenu(null);
                    onRemove(link);
                  }}
                  title="Remove Reference"
                  aria-label="Remove Reference"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })
        )}
      </ReferencesListBox>
      {contextMenu && (
        <div
          className="linked-reference-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              onCopy(contextMenu.link);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>Copy Loom Address</span>
          </button>
        </div>
      )}
      {error && <div className="linked-reference-error">{error}</div>}
    </div>
  );
}

function AttachContentDropdown({
  menuRef,
  style,
  tab,
  query,
  groups,
  filteredItems,
  selectedKeys,
  attachments,
  feedback,
  fileInputRef,
  onTabChange,
  onQueryChange,
  onToggleReference,
  onAddFiles,
  onRemoveAttachment,
}: {
  menuRef: RefObject<HTMLDivElement>;
  style?: CSSProperties;
  tab: AttachContentTab;
  query: string;
  groups: Array<{ id: AttachContentSource; title: string; items: AttachContentItem[] }>;
  filteredItems: AttachContentItem[];
  selectedKeys: Set<string>;
  attachments: ComposerAttachment[];
  feedback: string | null;
  fileInputRef: RefObject<HTMLInputElement>;
  onTabChange: (tab: AttachContentTab) => void;
  onQueryChange: (query: string) => void;
  onToggleReference: (item: AttachContentItem) => void;
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  function itemSelected(item: AttachContentItem) {
    return (
      selectedKeys.has(item.path) ||
      Boolean(item.targetObjectId && selectedKeys.has(item.targetObjectId))
    );
  }

  function renderItem(item: AttachContentItem) {
    const Icon = iconForType[item.type];
    const selected = itemSelected(item);
    return (
      <button
        type="button"
        key={`${item.source}-${item.id}-${item.path}`}
        className={selected ? "attach-content-row selected" : "attach-content-row"}
        onClick={() => onToggleReference(item)}
      >
        <Icon size={15} />
        <span>
          <strong>{item.title}</strong>
          <small>{item.subtitle || item.path}</small>
        </span>
        <em>{displayObjectTypeLabel(item.badge ?? attachSourceLabel(item.source))}</em>
        <i aria-hidden="true">{selected ? <Check size={13} /> : null}</i>
      </button>
    );
  }

  return (
    <div ref={menuRef} className="attach-content-dropdown" style={style} role="dialog">
      <div className="attach-content-header">
        <strong>Attach content</strong>
        <span>Add Loom references or files to your prompt.</span>
      </div>
      <label className="linked-reference-search attach-content-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search Looms, Bookmarks, History, Responses..."
          aria-label="Search attach content"
        />
      </label>
      <div className="attach-content-tabs" role="tablist" aria-label="Attach content sources">
        {attachContentTabs.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            className={tab === id ? "active" : ""}
            title={label}
            aria-label={label}
            aria-selected={tab === id}
            role="tab"
            onClick={() => onTabChange(id)}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>
      <div className="attach-content-results">
        {tab === "all" ? (
          <>
            {groups.filter((group) => group.items.length > 0).map((group) => (
              <div className="attach-content-section" key={group.id}>
                <h3>{group.title}</h3>
                {group.items.slice(0, 5).map(renderItem)}
              </div>
            ))}
            <AttachFilesSection
              attachments={attachments}
              fileInputRef={fileInputRef}
              onAddFiles={onAddFiles}
              onRemoveAttachment={onRemoveAttachment}
            />
          </>
        ) : tab === "files" ? (
          <AttachFilesSection
            attachments={attachments}
            fileInputRef={fileInputRef}
            onAddFiles={onAddFiles}
            onRemoveAttachment={onRemoveAttachment}
          />
        ) : filteredItems.length > 0 ? (
          filteredItems.map(renderItem)
        ) : (
          <div className="empty-state">No matching Loom references.</div>
        )}
      </div>
      {feedback && <div className="linked-reference-error">{feedback}</div>}
    </div>
  );
}

function AttachFilesSection({
  attachments,
  fileInputRef,
  onAddFiles,
  onRemoveAttachment,
}: {
  attachments: ComposerAttachment[];
  fileInputRef: RefObject<HTMLInputElement>;
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  return (
    <div className="attach-content-section">
      <h3>Files</h3>
      <button
        type="button"
        className="attach-file-action"
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip size={14} />
        <span>Add file</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="visually-hidden-file-input"
        onChange={(event) => {
          onAddFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      {attachments.length === 0 ? (
        <div className="attach-file-empty">No files attached.</div>
      ) : (
        attachments.map((attachment) => (
          <div className="attach-file-row" key={attachment.id}>
            <Paperclip size={14} />
            <span>
              <strong>{attachment.name}</strong>
              <small>{formatAttachmentSize(attachment.size)}</small>
            </span>
            <button
              type="button"
              onClick={() => onRemoveAttachment(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
              title="Remove file"
            >
              <X size={13} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function attachSourceLabel(source: AttachContentSource) {
  if (source === "bookmark") return "Bookmark";
  if (source === "history") return "History";
  if (source === "openLoom") return "Loom";
  return "Response";
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
  onOpenHistoryMenu,
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
  onOpenHistoryMenu: (event: React.MouseEvent, entry: HistoryEntry) => void;
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
        <BookmarkView
          dragActive={bookmarkDragActive}
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
        </BookmarkView>
      )}

      {activePanel === "history" && (
        <HistoryView>
          {history.map((entry) => (
            <DestinationRow
              key={entry.id}
              destination={entry}
              timestamp={entry.visitedAt}
              showBadge={false}
              className="history-destination-row"
              onVisit={onVisit}
              onOpenContextMenu={onOpenHistoryMenu}
            />
          ))}
        </HistoryView>
      )}

      {activePanel === "looms" && (
        <WeftView>
          <LoomsPanel
            root={lineageRoot}
            activePath={activeDestination.path}
            onVisit={onVisit}
            onBookmark={onBookmark}
            onOpenGraph={onOpenGraph}
          />
        </WeftView>
      )}

      {activePanel === "archive" && (
        <div className="panel-list">
          {archived.length === 0 ? (
            <div className="empty-state">Archived conversations will appear here.</div>
          ) : (
            archived.map((conversation) => {
              const destination: LoomLink = {
                id: conversation.id,
                type: "conversation",
                title: conversation.title,
                path: conversation.path,
                badge: typeLabel.conversation,
              };
              return (
                <DestinationRow
                  key={conversation.id}
                  destination={destination}
                  timestamp="Archived"
                  showBadge={false}
                  className="archive-destination-row"
                  onVisit={() => onRestore(conversation)}
                  actions={
                    <>
                      <Tooltip label="Restore">
                        <button
                          className="bookmark-rail-button"
                          onClick={() => onRestore(conversation)}
                          aria-label={`Restore ${conversation.title}`}
                        >
                          <RotateCcw size={13} />
                        </button>
                      </Tooltip>
                      <Tooltip label="Delete">
                        <button
                          className="bookmark-rail-button danger"
                          onClick={() => onDeleteRequest(conversation)}
                          aria-label={`Delete ${conversation.title}`}
                        >
                          <X size={13} />
                        </button>
                      </Tooltip>
                    </>
                  }
                />
              );
            })
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
      badge: node.type === "loom" ? typeLabel.loom : node.type === "response" ? typeLabel.response : typeLabel.conversation,
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
                      {node.type === "conversation" ? typeLabel.conversation : node.type === "loom" ? typeLabel.loom : node.type === "quick" ? "Quick" : typeLabel.response}
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

function DestinationRow<T extends LoomLink>({
  destination,
  timestamp,
  showBadge = true,
  className = "",
  onVisit,
  onRemove,
  onOpenContextMenu,
  actions,
}: {
  destination: T;
  timestamp?: string;
  showBadge?: boolean;
  className?: string;
  onVisit: (destination: T) => void;
  onRemove?: (destination: T) => void;
  onOpenContextMenu?: (event: React.MouseEvent, destination: T) => void;
  actions?: React.ReactNode;
}) {
  const Icon = iconForType[destination.type];
  const title =
    "editableTitle" in destination && typeof destination.editableTitle === "string"
      ? destination.editableTitle
      : destination.title;
  const rowClassName = [
    "bookmark-row",
    className,
    destination.badge === "Broken reference" ? "broken" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={rowClassName}
      draggable
      onContextMenu={(event) => onOpenContextMenu?.(event, destination)}
      onDragStart={(event) => {
        setLoomDragPayload(event, destination);
      }}
    >
      <span className="bookmark-type-icon">
        <Icon size={16} />
      </span>
      <button className="bookmark-content" onClick={() => onVisit(destination)}>
        <strong title={title}>{title}</strong>
        <small title={destination.path}>{destination.path}</small>
        <span className={showBadge ? "bookmark-meta-row" : "bookmark-meta-row no-label"}>
          {showBadge && destination.badge ? (
            <em>{displayObjectTypeLabel(destination.badge)}</em>
          ) : null}
          {timestamp ? <time>{timestamp}</time> : null}
        </span>
      </button>
      <div className="bookmark-action-rail">
        {actions ?? (onRemove ? (
          <Tooltip label="Delete">
            <button
              className="bookmark-rail-button danger"
              onClick={() => onRemove(destination)}
              aria-label={`Delete ${title}`}
            >
              <X size={13} />
            </button>
          </Tooltip>
        ) : null)}
      </div>
    </div>
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
  return (
    <DestinationRow
      destination={bookmark}
      timestamp={bookmark.lastUsed}
      onVisit={onVisit}
      onRemove={onRemove}
      onOpenContextMenu={onOpenContextMenu}
    />
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

export default App;
