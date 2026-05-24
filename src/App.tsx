import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Boxes,
  Brain,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Clock3,
  Compass,
  Copy,
  CornerDownLeft,
  Code2,
  Cpu,
  Database,
  Edit3,
  ExternalLink,
  FileText,
  FlaskConical,
  Folder,
  GitBranch,
  GitFork,
  Globe2,
  HelpCircle,
  History,
  Info,
  Layers,
  Lightbulb,
  Link2,
  LoaderCircle,
  Lock,
  Map,
  Maximize2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  MoreVertical,
  Network,
  PanelLeft,
  Palette,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  Rocket,
  RotateCcw,
  Search,
  Settings,
  Share,
  Shield,
  Sparkles,
  Square,
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
  canonicalLoomUri,
  isLoomAddress,
  linkFromResolvedObject,
  normalizeLoomTitle,
  resolveLoomAddress,
  toLoomMarkdown,
} from "./services/loomProtocol";
import {
  buildAddressBarSuggestions,
  isAddressBarAddressLike,
  resolveAddressBarEnterAction,
} from "./services/omnibox";
import {
  createRuntimeLoomGraphRepository,
  readRuntimeBookmarks,
  writeRuntimeBookmarks,
} from "./services/loomRuntimeGraph";
import {
  transitionTemporaryWeftStatus,
  type TemporaryWeftLifecycleStatus,
} from "./state/temporaryWeftMachine";
import {
  addressablePanelFromFocusState,
  initialSplitFocusState,
  reduceSplitFocus,
  splitPanelFromFocusState,
  type SplitFocusEvent,
} from "./state/splitFocusMachine";
import {
  initialAddressBarState,
  isAddressBarFocusedState,
  reduceAddressBar,
  type AddressBarEvent,
} from "./state/addressBarMachine";
import {
  getAvatarInitial,
  getDisplayProfileName,
  getDisplayWorkspaceName,
  isMockDataEnabled,
  readAppSettings,
  writeAppSettings,
  type AppSettings,
  type ModelResponseMode,
} from "./services/appSettings";
import {
  matchesKeyboardCommand,
  primaryCompactShortcutLabel,
} from "./services/keyboardShortcuts";
import {
  downloadBase64File,
  exportLoomAsCsv,
  exportLoomMetadataJson,
  exportLoomAsMarkdown,
  exportLoomAsZip,
  safeExportFilename,
  textToBase64,
} from "./services/exportService";
import { formatRelativeTimestamp } from "./services/timeLabels";
import { formatBadgeCode } from "./services/displayCode";
import {
  codeSnippetFirstMeaningfulLine,
  codeSnippetLanguageLabel,
  codeSnippetSemanticTitle,
  isReusableCodeSnippet,
} from "./services/codeSnippetDisplay";
import {
  getElectronPermissionsBridge,
  getElectronRuntimeInfo,
  getElectronWindowControls,
} from "./electronRuntime";
import {
  applyMetadataRefinement,
  buildRuntimeMetadataRecord,
  createAddressableLoomMetadata,
  createDraftResponseMetadata,
  generateMetadataWithQuickModel,
  hydrateAddressableLoomMetadata,
  hydrateResponseMetadata,
  metadataKeyForLoom,
  metadataKeyForResponse,
  metadataTextForLoom,
  metadataTextForResponse,
  readRuntimeMetadata,
  promoteResponseMetadata,
  writeRuntimeMetadata,
} from "./services/metadataService";
import { createMetadataUuid } from "./services/codeService";
import {
  referenceCodeForLink,
  referenceDisplayModeForLink,
  referenceLabelForMode,
  referenceMarkdownLink,
  referenceTokenText,
  loomLinkFromMarkdownReference,
  withReferenceDisplayDefaults,
} from "./services/referenceDisplay";
import { polishDisplayTitle } from "./services/displayTitlePolish";
import {
  normalizeReferenceAddress,
  normalizeResponseLinkSource,
  referenceIdentityKey,
  referencesShareIdentity,
  responseIdFromReferenceAddress,
  selectedReferenceKeysForLink,
} from "./services/referenceIdentity";
import {
  buildAskContextPayload,
  createHeuristicResponseContextCapsule,
  type AskActiveReferenceContext,
  type AskContextPayload,
  type FocusedAskIntent,
  type ResponseContextCapsule,
} from "./services/responseContextCapsule";
import {
  buildLoomContext,
  type LoomContextReference,
  type LoomQuestionGroup,
} from "./services/loomContextBuilder";
import {
  orchestrateQuestionPlan,
  planAnswerDeterministically,
} from "./services/answerPlanner";
import { resolveAnswerExecutionConfig } from "./services/answerExecution";
import {
  buildAssistantCopyPayload,
  cleanMarkdownDisplayText,
  normalizeAssistantMarkdownSource,
  responseMarkdownSource,
} from "./services/assistantMarkdown";
import { codeToClipboardHtml } from "./services/clipboard";
import { prepareContextArtifactsForGeneration } from "./services/contextReadinessGate";
import {
  activateVisibleAnswerStage,
  appendVisibleProgressEvent,
  createInitialVisibleAnswerProgress,
  createOrchestrationVisibleProgress,
  createDeterministicVisibleAnswerPlan,
  createVisibleAnswerProgressFromStatus,
  createVisibleTaskProgressFromPlan,
  formatVisibleDuration,
  generateVisibleAnswerPlan,
  updateVisibleProgressDebug,
} from "./services/visibleAnswerProgress";
import {
  filterAndRankReferenceSuggestions,
  readableReferenceCode,
} from "./services/referenceSuggestions";
import { insertTranscriptAtCursorText } from "./services/speechTranscriptInsertion";
import {
  getProfileModel,
  isMockResponseModeEnabled,
  ModelProviderError,
  readAIProviderSettings,
  resolveOllamaContextLength,
  runModelProfileRequest,
  writeAIProviderSettings,
  type AIProviderSettings,
  type ModelEffort,
  type ModelExecutionProgress,
  type ModelOutputBudget,
  type ModelProfileId,
  type RuntimeHealthState,
} from "./services/modelProviders";
import { isSimpleAutoAnswerCandidate } from "./services/thinkingGuard";
import {
  createLoomEngineClient,
  getConfiguredLoomEngineMode,
  type CodeSnippetReferenceItem,
  type CreateBookmarkInput,
  type CreateOrOpenWeftResult,
  type GenerationResponseStateResult,
  type JsonValue,
  type LoomEngineClient,
  type LoomDetail,
  type LoomSummary,
  type PersistedWeftTurn,
  type VisibleWeftSeedResponse,
} from "./engine";
import { useRuntimeHealth } from "./hooks/useRuntimeHealth";
import { useSidebarDnD } from "./hooks/useSidebarDnD";
import { useSpeechToTextRecorder } from "./hooks/useSpeechToTextRecorder";
import { AppShell } from "./components/AppShell";
import { AddressBar } from "./components/AddressBar";
import { AddressMetadataBadge } from "./components/AddressMetadataBadge";
import {
  AIProviderSettingsModal,
  type SettingsCategoryId,
} from "./components/AIProviderSettings";
import { AddressHintPopover } from "./components/AddressHintPopover";
import { AskPopup, type AskPopupState } from "./components/AskPopup";
import { AssistantMarkdownContent } from "./components/AssistantMarkdownContent";
import { BookmarkView } from "./components/BookmarkView";
import { ChangeIconPopover } from "./components/ChangeIconPopover";
import { ContextMenu, type ContextMenuState } from "./components/ContextMenu";
import { ConversationView } from "./components/ConversationView";
import { DeleteConversationDialog } from "./components/DeleteConversationDialog";
import { GroupColorPopover } from "./components/GroupColorPopover";
import { GraphView } from "./components/GraphView";
import { HistoryView } from "./components/HistoryView";
import { ReferencesListBox } from "./components/ReferencesListBox";
import { RetryConfirmationDialog } from "./components/RetryConfirmationDialog";
import { SelectionPopover } from "./components/SelectionPopover";
import { TopBar } from "./components/TopBar";
import {
  ToastNotification,
  type ToastNotificationColor,
  type ToastNotificationIcon,
} from "./components/ToastNotification";
import { WeftView } from "./components/WeftView";
import type {
  AddressSuggestion,
  BookmarkItem,
  Conversation,
  HistoryEntry,
  LoomLink,
  LoomForkRecord,
  LoomMetadata,
  LoomNavigationDestination,
  LoomObjectKind,
  LoomObjectType,
  ReferenceDisplayMode,
  LoomResolutionResult,
  ResponseCodeBlock,
  ResponseItem,
  TabGroup,
  VisibleAnswerPlan,
  VisibleAnswerProgress,
} from "./types";

const iconForType: Record<LoomObjectType, typeof Globe2> = {
  conversation: Globe2,
  loom: GitBranch,
  response: FileText,
  fragment: FileText,
  attachment: Paperclip,
  bookmark: Bookmark,
  semantic: Sparkles,
  recent: Clock3,
};

const POPOVER_HINT_AUTO_CLOSE_MS = 2000;
const REFERENCE_ADDRESS_HINT_DELAY_MS = 1000;
const REFERENCE_ADDRESS_HINT_CLOSE_DELAY_MS = 180;
const GROWTH_MILESTONES = [5, 10, 25] as const;
const GROWTH_HIGHLIGHT_MS = 1800;
const MILESTONE_TOAST_DELAY_MS = 2300;

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
type UtilityPanelId = Exclude<ActivePanel, null>;
type UtilityOverlayId = UtilityPanelId | "graph";

type AskState = AskPopupState;

interface AskExchange {
  id: string;
  question: string;
  answer: string;
  title?: string;
  createdAt: number;
  capsuleSnapshot?: ResponseContextCapsule;
  selectedText?: string;
  sourceLoomId?: string;
  sourceResponseId?: string;
  sourceFragment?: LoomLink;
  activeReferences?: AskActiveReferenceContext[];
  payloadReport?: Pick<
    AskContextPayload,
    "usedFullResponse" | "contextCharCount" | "capsuleSource" | "includedSelectedText"
  >;
  debugTrace?: QuickAskDebugTrace;
}

interface QuickAskDebugTrace {
  traceId: string;
  engineMode?: string;
  clientKind?: string;
  requestAttempted?: boolean;
  endpoint?: string;
  httpStatus?: number;
  transportErrorKind?: string;
  responseParseStatus?: string;
  diagnosticsReceived?: boolean;
  visibleChipLabels: string[];
  userQuestion: string;
  selectedFragmentPreview?: string;
  sourceTitle?: string;
  sourceResponseCode?: string;
  inputActiveReferenceLabels: string[];
  previousAskTurnCount: number;
  diagnostics?: JsonValue;
  errorKind?: string;
  warnings?: string[];
}

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

type ForkRecord = LoomForkRecord;

type TemporaryWeftWorkspaceStatus = Exclude<
  TemporaryWeftLifecycleStatus,
  "absent" | "discarded"
>;

function asTemporaryWeftWorkspaceStatus(
  status: TemporaryWeftLifecycleStatus
): TemporaryWeftWorkspaceStatus {
  if (status === "absent" || status === "discarded") {
    throw new Error(`Temporary Weft workspace cannot remain in ${status} state.`);
  }
  return status;
}

interface TemporaryWeftWorkspace {
  temporaryId: string;
  originLoomId: string;
  originResponseId: string;
  title: string;
  summary: string;
  path: string;
  folder: string;
  anchorTitle: string;
  anchorCode?: string;
  status: TemporaryWeftWorkspaceStatus;
  persistedWeftId?: string;
  createdAt: string;
}

const forbiddenThinkingMetadataKeys = new Set([
  "raw_thinking",
  "thinking_text",
  "chain_of_thought",
  "hidden_reasoning",
  "rawThinking",
  "thinkingText",
  "chainOfThought",
  "hiddenReasoning",
]);

function sanitizeWeftMetadataValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map(sanitizeWeftMetadataValue)
      .filter((entry): entry is JsonValue => entry !== undefined);
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([key]) => !forbiddenThinkingMetadataKeys.has(key))
      .map(([key, entry]) => [key, sanitizeWeftMetadataValue(entry)] as const)
      .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== undefined);
    return Object.fromEntries(entries);
  }
  return undefined;
}

function temporaryWeftKey(originLoomId: string, originResponseId: string) {
  return `${originLoomId}::${originResponseId}`;
}

function forkRecordMatchesResponse(
  record: ForkRecord,
  conversationId: string,
  response: Pick<ResponseItem, "id" | "serviceUserResponseId">
) {
  return (
    record.parentConversationId === conversationId &&
    (record.parentResponseId === response.id ||
      record.parentResponseId === response.serviceUserResponseId)
  );
}

type LineageNodeType = "conversation" | "loom" | "response" | "quick";

interface LineageNode {
  id: string;
  type: LineageNodeType;
  title: string;
  path: string;
  canonicalUri?: string;
  referenceCode?: string;
  meta?: LoomMetadata;
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

type ComposerReferenceGroup = "Open Looms" | "Responses" | "Code Snippets" | "Bookmarks" | "History";

interface ComposerReferenceOption extends LoomLink {
  group: ComposerReferenceGroup;
  subtitle: string;
  keywords: string[];
  searchText: string[];
  suggestionMatchReason?: string;
}

type AttachContentTab = "all" | "bookmarks" | "history" | "openLooms" | "responses" | "codeSnippets" | "files";

type AttachContentSource = "bookmark" | "history" | "openLoom" | "response" | "codeSnippet";

interface AttachContentItem extends LoomLink {
  source: AttachContentSource;
  subtitle: string;
  keywords: string[];
}

interface ComposerAttachment {
  id: string;
  attachmentId?: string;
  loomId?: string;
  name: string;
  size: number;
  type: string;
  extension?: string;
  kind?: string;
  parseStatus?:
    | "queued"
    | "parsing"
    | "extracting_text"
    | "ocr_needed"
    | "ocr_running"
    | "ready"
    | "failed"
    | "unsupported";
  parser?: string;
  error?: string;
  thumbnailDataUrl?: string;
  parsedCharCount?: number;
  metadataJson?: JsonValue;
  lastModified: number;
  attachedAt?: number;
}

interface MentionState {
  query: string;
  x: number;
  y: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
  selectedIndex: number;
  range: Range;
}

interface ComposerDraft {
  html: string;
  links: LoomLink[];
  attachments?: ComposerAttachment[];
}

interface TextInsertionRequest {
  id: number;
  text: string;
}

type NewLoomStarterCategoryId =
  | "research"
  | "explain"
  | "compare"
  | "plan"
  | "code"
  | "review"
  | "organize";

interface NewLoomStarterCategory {
  id: NewLoomStarterCategoryId;
  label: string;
  Icon: LucideIcon;
  prompts: string[];
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
const modelResponseModes: Array<{
  id: ModelResponseMode;
  label: string;
  description: string;
}> = [
  { id: "auto", label: "Auto", description: "Loom chooses based on prompt and References." },
  { id: "instant", label: "Instant", description: "Prioritize faster responses." },
  { id: "thinking", label: "Thinking", description: "Ask capable models to reason visibly." },
];

const newLoomStarterCategories: NewLoomStarterCategory[] = [
  {
    id: "research",
    label: "Research",
    Icon: Search,
    prompts: [
      "Research a topic and build a reusable summary",
      "Map the strongest arguments around a topic",
      "Find recent context and organize it into Loom notes",
    ],
  },
  {
    id: "explain",
    label: "Explain",
    Icon: Lightbulb,
    prompts: [
      "Explain a complex idea in plain language",
      "Create a study guide from a topic",
      "Break down this concept with examples",
      "Turn a dense document into a clear explanation",
      "Explain the tradeoffs behind this decision",
      "Create an analogy that makes this easier to remember",
    ],
  },
  {
    id: "compare",
    label: "Compare",
    Icon: Layers,
    prompts: [
      "Compare two tools or frameworks",
      "Build a tradeoff matrix for these options",
      "Find the practical differences between two approaches",
      "Compare these products for a specific workflow",
      "Rank options by risk, cost, and speed",
      "Summarize where each option wins",
    ],
  },
  {
    id: "plan",
    label: "Plan",
    Icon: Target,
    prompts: [
      "Plan a project from idea to execution",
      "Turn a rough goal into milestones",
      "Create a launch checklist with risks",
      "Map dependencies and next actions",
      "Draft a weekly execution plan",
      "Identify blockers before starting work",
    ],
  },
  {
    id: "code",
    label: "Code",
    Icon: Code2,
    prompts: [
      "Design an implementation plan for this feature",
      "Find edge cases before writing code",
      "Explain how this code path works",
      "Review an API shape before implementation",
      "Turn requirements into test cases",
      "Outline a refactor without changing behavior",
    ],
  },
  {
    id: "review",
    label: "Review",
    Icon: Check,
    prompts: [
      "Review this code or document",
      "Find risks and missing tests in this change",
      "Check this proposal for unclear assumptions",
      "Audit this plan for missing constraints",
      "Find contradictions in these notes",
      "Summarize what still needs a decision",
    ],
  },
  {
    id: "organize",
    label: "Organize",
    Icon: Workflow,
    prompts: [
      "Turn scattered notes into a Loom",
      "Cluster these ideas into reusable sections",
      "Extract decisions, open questions, and next steps",
      "Create a reusable outline from rough notes",
      "Group related threads into a coherent map",
      "Convert meeting notes into action-oriented Looms",
    ],
  },
];

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
  { id: "codeSnippets", label: "Code Snippets", Icon: Code2 },
  { id: "files", label: "Files", Icon: Paperclip },
];

const MAX_COMPOSER_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_SIZE_LABEL = "25 MB";

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAttachmentDisplayName(fileName: string, maxLength = 22) {
  if (fileName.length <= maxLength) return fileName;
  const dotIndex = fileName.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < fileName.length - 1;
  const extension = hasExtension ? fileName.slice(dotIndex) : "";
  const baseName = hasExtension ? fileName.slice(0, dotIndex) : fileName;
  const availableNameLength = Math.max(8, maxLength - extension.length - 3);
  const suffixLength = Math.min(6, Math.max(4, Math.floor(availableNameLength * 0.4)));
  const prefixLength = Math.max(4, availableNameLength - suffixLength);
  return `${baseName.slice(0, prefixLength)}...${baseName.slice(-suffixLength)}${extension}`;
}

function isAttachmentReferenceLink(link: Pick<LoomLink, "type" | "targetKind">) {
  return link.type === "attachment" || link.targetKind === "attachment";
}

function composerReferenceTokenText(
  link: LoomLink,
  fallbackDisplayMode: ReferenceDisplayMode
) {
  if (!isAttachmentReferenceLink(link)) {
    return referenceTokenText(link, fallbackDisplayMode);
  }
  const displayMode = referenceDisplayModeForLink(link, fallbackDisplayMode);
  const label = referenceLabelForMode(link, displayMode);
  return `[[${formatAttachmentDisplayName(label, 26)}]]`;
}

function runtimeGraphObjectIdFor(kind: LoomObjectKind, id: string) {
  const prefix: Record<LoomObjectKind, string> = {
    conversation: "CNV",
    response: "RSP",
    quick_question: "QQ",
    bookmark: "BMK",
    fragment: "FRG",
    reference_mention: "RMN",
  };
  return `${prefix[kind]}_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function selectedReferenceRankForItem(
  item: LoomLink,
  selectedRanks: Map<string, number>
) {
  return selectedReferenceKeysForLink(item).reduce<number | null>((rank, key) => {
    const selectedRank = selectedRanks.get(key);
    if (selectedRank === undefined) return rank;
    return rank === null ? selectedRank : Math.max(rank, selectedRank);
  }, null);
}

function fragmentTextHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function fragmentReferenceTitle(selectedText: string, fallback: string) {
  const words = selectedText.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const label = words.slice(0, 8).join(" ");
  return label || fallback;
}

function isFragmentReference(link: LoomLink) {
  return link.type === "fragment" || Boolean(link.selectedText && link.sourceResponseId);
}

function isAttachedQuoteReference(link: LoomLink) {
  return isFragmentReference(link) && link.badge === "Selection";
}

function splitPromptReferences(links?: LoomLink[]) {
  const attached: LoomLink[] = [];
  const inline: LoomLink[] = [];
  (links ?? []).forEach((link) => {
    if (isAttachedQuoteReference(link)) attached.push(link);
    else inline.push(link);
  });
  return { attached, inline };
}

function mergeUniqueReferences(links: LoomLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = referenceIdentityKey(link);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fragmentQuoteText(link: LoomLink) {
  return (link.selectedText ?? link.title).replace(/\s+/g, " ").trim();
}

function stripAttachedReferenceTokens(text: string, references?: LoomLink[]) {
  const withoutReferenceTokens = splitPromptReferences(references).attached.reduce((current, link) => {
    const labels = new Set([
      composerReferenceTokenText(link, link.referenceDisplayMode ?? "title"),
      referenceTokenText(link, link.referenceDisplayMode ?? "title"),
      referenceTokenText(link, "title"),
      referenceTokenText(link, "code"),
      `[[${link.title}]]`,
      link.referenceCustomLabel ? `[[${link.referenceCustomLabel}]]` : "",
    ]);
    let next = current;
    labels.forEach((label) => {
      if (!label) return;
      next = next.split(label).join(" ");
    });
    return next;
  }, text);
  return withoutReferenceTokens
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textFromComposerHtml(html: string, preserveLineBreaks: boolean) {
  if (!preserveLineBreaks) {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const root = document.createElement("div");
  root.innerHTML = html;
  const parts: string[] = [];
  const blockTags = new Set(["DIV", "P", "LI"]);
  const appendLineBreak = () => {
    if (parts.length === 0) return;
    const last = parts[parts.length - 1];
    if (last && !last.endsWith("\n")) parts.push("\n");
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      parts.push("\n");
      return;
    }
    const isBlock = blockTags.has(node.tagName);
    if (isBlock && parts.length > 0) appendLineBreak();
    node.childNodes.forEach(visit);
    if (isBlock) appendLineBreak();
  };
  root.childNodes.forEach(visit);
  return parts
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokenTextsForQuestionGroupReference(link: LoomLink) {
  return Array.from(
    new Set([
      composerReferenceTokenText(link, link.referenceDisplayMode ?? "title"),
      referenceTokenText(link, link.referenceDisplayMode ?? "title"),
      referenceTokenText(link, "title"),
      referenceTokenText(link, "code"),
      `[[${link.title}]]`,
      link.referenceCustomLabel ? `[[${link.referenceCustomLabel}]]` : "",
    ].filter(Boolean))
  );
}

function parseReferenceQuestionGroups(
  prompt: string,
  references: LoomLink[]
): LoomQuestionGroup[] {
  const inlineReferences = splitPromptReferences(references).inline;
  if (inlineReferences.length === 0) return [];
  const groups = prompt
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const scopedReferences = inlineReferences.filter((link) =>
        tokenTextsForQuestionGroupReference(link).some((tokenText) => line.includes(tokenText))
      );
      let question = line;
      scopedReferences.forEach((link) => {
        tokenTextsForQuestionGroupReference(link).forEach((tokenText) => {
          question = question.split(tokenText).join(" ");
        });
      });
      return {
        references: scopedReferences,
        question: question.replace(/\s+/g, " ").trim(),
      };
    })
    .filter((group) => group.question.length > 0 || group.references.length > 0);
  return groups.some((group) => group.references.length > 0) ? groups : [];
}

function dayKeyForTimestamp(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatConversationDaySeparator(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (diffDays === 0) return `Today ${timeLabel}`;
  if (diffDays === 1) return `Yesterday ${timeLabel}`;
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  return `${dateLabel} ${timeLabel}`;
}

function compactAskTurnText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function buildTemporaryAskTurnContext(exchanges: AskExchange[]) {
  const completeTurns = exchanges
    .filter((exchange) => exchange.question.trim() && exchange.answer.trim())
    .slice(-3);
  if (completeTurns.length === 0) return [];
  const lines: string[] = ["Previous quick turns:"];
  let usedChars = lines[0].length;
  completeTurns.forEach((exchange) => {
    const question = compactAskTurnText(exchange.question, 220);
    const answer = compactAskTurnText(exchange.answer, 420);
    const block = [`User: ${question}`, `Assistant: ${answer}`];
    const blockLength = block.reduce((total, item) => total + item.length, 0);
    if (usedChars + blockLength > 1500) return;
    lines.push(...block);
    usedChars += blockLength;
  });
  return lines.length > 1 ? [lines.join("\n")] : [];
}

function quickAskNumPredict(intent: FocusedAskIntent, hasSelectedText: boolean) {
  if (!hasSelectedText) return 1024;
  if (intent === "relation_to_source" || intent === "how_it_works") return 1536;
  if (intent === "acronym_expansion" || intent === "definition" || intent === "explain_this") {
    return intent === "acronym_expansion" ? 768 : 1024;
  }
  return hasSelectedText ? 1536 : 1024;
}

function looksLikeRestatedQuickAskQuestion(input: {
  answer: string;
  question: string;
  selectedText?: string;
}) {
  const answer = input.answer.replace(/\s+/g, " ").trim();
  const selectedText = input.selectedText?.trim();
  if (!answer.endsWith("?") || !selectedText) return false;
  const normalizedAnswer = answer.toLocaleLowerCase("tr-TR");
  const normalizedQuestion = input.question.toLocaleLowerCase("tr-TR");
  const normalizedSelection = selectedText.toLocaleLowerCase("tr-TR");
  return (
    normalizedAnswer.includes(normalizedSelection) &&
    (normalizedAnswer.includes(normalizedQuestion) ||
      normalizedAnswer.includes("nedir") ||
      normalizedAnswer.includes("ne ") ||
      normalizedAnswer.includes("what "))
  );
}

function sortAttachContentItemsBySelection(
  items: AttachContentItem[],
  selectedRanks: Map<string, number>
) {
  return items
    .map((item, index) => ({
      item,
      index,
      selectedRank: selectedReferenceRankForItem(item, selectedRanks),
    }))
    .sort((a, b) => {
      const aSelected = a.selectedRank !== null;
      const bSelected = b.selectedRank !== null;
      if (aSelected && bSelected) {
        return (b.selectedRank ?? 0) - (a.selectedRank ?? 0) || a.index - b.index;
      }
      if (aSelected) return -1;
      if (bSelected) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function codeSnippetAttachItemFromService(
  snippet: CodeSnippetReferenceItem
): AttachContentItem {
  const language = codeSnippetLanguageLabel(snippet.language);
  const sourceTitle =
    cleanMarkdownDisplayText(snippet.sourceResponseTitle ?? snippet.sourceResponseCode ?? "") ||
    "Response";
  const firstLine = codeSnippetFirstMeaningfulLine(snippet.code);
  const semanticTitle = codeSnippetSemanticTitle(snippet);
  const sourceUri = snippet.sourceCanonicalUri ?? `loom://responses/${snippet.responseId}`;
  return {
    id: snippet.codeBlockId,
    type: "fragment",
    title: semanticTitle,
    path: `${sourceUri}#code-block=${encodeURIComponent(snippet.codeBlockId)}`,
    badge: "Code",
    targetKind: "code_block",
    targetObjectId: snippet.codeBlockId,
    canonicalUri: `${sourceUri}#code-block=${encodeURIComponent(snippet.codeBlockId)}`,
    referenceDisplayMode: "title",
    referenceCustomLabel: semanticTitle,
    sourceLoomId: snippet.loomId,
    sourceResponseId: snippet.responseId,
    selectedText: snippet.code,
    sourceResponseCode: snippet.sourceResponseCode,
    sourceResponseTitle: snippet.sourceResponseTitle,
    sourceCanonicalUri: sourceUri,
    fragmentHash: snippet.exactHash,
    source: "codeSnippet",
    subtitle: `${language} · ${sourceTitle} · ${snippet.loomTitle ?? "Loom"} · ${firstLine}`,
    keywords: [
      "Code Snippet",
      language,
      snippet.loomTitle ?? "",
      sourceTitle,
      firstLine,
      snippet.code,
    ],
  };
}

function dedupeAttachContentItems(items: AttachContentItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.targetKind === "code_block"
      ? `code:${item.targetObjectId ?? item.id}`
      : referenceIdentityKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortAttachmentsBySelection(attachments: ComposerAttachment[]) {
  return [...attachments].sort(
    (a, b) =>
      (b.attachedAt ?? b.lastModified) - (a.attachedAt ?? a.lastModified)
  );
}

function attachmentToLoomLink(attachment: ComposerAttachment): LoomLink {
  const attachmentId = attachment.attachmentId ?? attachment.id;
  const path = attachment.loomId
    ? `loom://${attachment.loomId}/attachments/${attachmentId}`
    : `loom://attachments/${attachmentId}`;
  return {
    id: attachmentId,
    type: "attachment",
    title: attachment.name,
    path,
    badge:
      attachment.parseStatus === "unsupported"
        ? "Unsupported file"
        : attachment.kind === "image"
          ? "Image"
          : "File",
    targetObjectId: attachmentId,
    targetKind: "attachment",
    canonicalUri: path,
  };
}

function attachmentStatusLabel(attachment: ComposerAttachment) {
  const ocrNeededPages = attachmentOcrNeededPageCount(attachment.metadataJson);
  if (attachment.parseStatus === "ready" && ocrNeededPages > 0) {
    return `Ready · OCR needed ${ocrNeededPages} ${ocrNeededPages === 1 ? "page" : "pages"}`;
  }
  if (attachment.parseStatus === "queued") return "Queued";
  if (attachment.parseStatus === "ready") return "Ready";
  if (attachment.parseStatus === "parsing") return "Parsing";
  if (attachment.parseStatus === "extracting_text") return "Extracting text";
  if (attachment.parseStatus === "ocr_needed") {
    return ocrNeededPages > 0
      ? `OCR needed · ${ocrNeededPages} ${ocrNeededPages === 1 ? "page" : "pages"}`
      : "OCR needed";
  }
  if (attachment.parseStatus === "ocr_running") return "OCR running";
  if (attachment.parseStatus === "failed") return "Failed";
  if (attachment.parseStatus === "unsupported") return "Unsupported";
  return "Pending";
}

function attachmentOcrNeededPageCount(metadata: JsonValue | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0;
  const pages = metadata.ocrNeededPages;
  return Array.isArray(pages) ? pages.length : 0;
}

function attachmentParseActive(attachment: ComposerAttachment) {
  return (
    attachment.parseStatus === "queued" ||
    attachment.parseStatus === "parsing" ||
    attachment.parseStatus === "extracting_text" ||
    attachment.parseStatus === "ocr_running"
  );
}

const EPHEMERAL_DRAFT_ID = "draft-new-conversation";

const LAST_ACTIVE_LOOM_STORAGE_KEY = "loom:last-active-loom-v1";
const SIDEBAR_LAYOUT_STATE_KEY = "sidebar-layout-v1";
const SIDEBAR_LAYOUT_STORAGE_KEY = "loom:sidebar-layout-v1";
const COMPOSER_DRAFTS_STORAGE_KEY = "loom:composer-drafts-v1";
const initialAppSettingsSnapshot = readAppSettings();
const initialMockDataEnabled = isMockDataEnabled(initialAppSettingsSnapshot);
const initialSeedConversations = initialMockDataEnabled ? seedConversations : [];
const seedConversationIds = new Set(seedConversations.map((conversation) => conversation.id));

interface LastActiveLoomSession {
  activeLoomId: string;
  updatedAt: number;
}

function readLastActiveLoomId(conversations: Conversation[]) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_LOOM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastActiveLoomSession>;
    const activeLoomId = parsed.activeLoomId;
    if (!activeLoomId || activeLoomId === EPHEMERAL_DRAFT_ID) return null;
    return conversations.some((conversation) => conversation.id === activeLoomId)
      ? activeLoomId
      : null;
  } catch {
    return null;
  }
}

function writeLastActiveLoomId(activeLoomId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!activeLoomId || activeLoomId === EPHEMERAL_DRAFT_ID) {
      window.localStorage.removeItem(LAST_ACTIVE_LOOM_STORAGE_KEY);
      return;
    }
    const session: LastActiveLoomSession = {
      activeLoomId,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(LAST_ACTIVE_LOOM_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Session restore is best-effort only.
  }
}

interface SidebarLayoutState {
  pinnedConversationIds: string[];
  tabGroups: TabGroup[];
  collapsed: boolean;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStoredTabGroup(value: unknown): value is TabGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TabGroup>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    isStringArray(candidate.conversationIds) &&
    (candidate.collapsed === undefined || typeof candidate.collapsed === "boolean") &&
    (candidate.color === undefined || typeof candidate.color === "string")
  );
}

function normalizeSidebarLayoutState(
  state: SidebarLayoutState,
  availableConversationIds: Set<string>
): SidebarLayoutState {
  const pinnedConversationIds = Array.from(
    new Set(
      state.pinnedConversationIds.filter((conversationId) =>
        availableConversationIds.has(conversationId)
      )
    )
  );
  const pinnedSet = new Set(pinnedConversationIds);
  const groupedIds = new Set<string>();
  const tabGroups = state.tabGroups
    .map((group) => {
      const conversationIds = group.conversationIds.filter((conversationId) => {
        if (
          !availableConversationIds.has(conversationId) ||
          pinnedSet.has(conversationId) ||
          groupedIds.has(conversationId)
        ) {
          return false;
        }
        groupedIds.add(conversationId);
        return true;
      });
      return { ...group, conversationIds };
    })
    .filter((group) => group.conversationIds.length > 1);
  return { pinnedConversationIds, tabGroups, collapsed: Boolean(state.collapsed) };
}

function readSidebarLayoutState(fallback: SidebarLayoutState, conversations: Conversation[]) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SidebarLayoutState>;
    const state: SidebarLayoutState = {
      pinnedConversationIds: isStringArray(parsed.pinnedConversationIds)
        ? parsed.pinnedConversationIds
        : fallback.pinnedConversationIds,
      tabGroups: Array.isArray(parsed.tabGroups)
        ? parsed.tabGroups.filter(isStoredTabGroup)
        : fallback.tabGroups,
      collapsed: typeof parsed.collapsed === "boolean" ? parsed.collapsed : fallback.collapsed,
    };
    const availableConversationIds =
      conversations.length > 0
        ? new Set(conversations.map((conversation) => conversation.id))
        : new Set([
            ...state.pinnedConversationIds,
            ...state.tabGroups.flatMap((group) => group.conversationIds),
          ]);
    return normalizeSidebarLayoutState(state, availableConversationIds);
  } catch (error) {
    console.warn("Unable to restore sidebar layout.", error);
    return fallback;
  }
}

function sidebarLayoutStateFromJsonValue(value: JsonValue | undefined): SidebarLayoutState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = value as Record<string, JsonValue | undefined>;
  const tabGroupsValue: unknown = parsed.tabGroups;
  return {
    pinnedConversationIds: isStringArray(parsed.pinnedConversationIds)
      ? parsed.pinnedConversationIds
      : [],
    tabGroups: Array.isArray(tabGroupsValue) ? tabGroupsValue.filter(isStoredTabGroup) : [],
    collapsed: typeof parsed.collapsed === "boolean" ? parsed.collapsed : false,
  };
}

function writeSidebarLayoutState(state: SidebarLayoutState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Unable to persist sidebar layout.", error);
  }
}

function isComposerAttachment(value: unknown): value is ComposerAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ComposerAttachment>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.type === "string" &&
    typeof candidate.lastModified === "number" &&
    (candidate.attachedAt === undefined || typeof candidate.attachedAt === "number")
  );
}

function isStoredLoomLink(value: unknown): value is LoomLink {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<LoomLink>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.path === "string"
  );
}

function isStoredComposerDraft(value: unknown): value is ComposerDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ComposerDraft>;
  return (
    typeof candidate.html === "string" &&
    Array.isArray(candidate.links) &&
    candidate.links.every(isStoredLoomLink) &&
    (candidate.attachments === undefined ||
      (Array.isArray(candidate.attachments) &&
        candidate.attachments.every(isComposerAttachment)))
  );
}

function composerDraftHasContent(draft: ComposerDraft) {
  return (
    textFromComposerHtml(draft.html, false).length > 0 ||
    draft.links.length > 0 ||
    (draft.attachments?.length ?? 0) > 0
  );
}

function readComposerDrafts() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, draft]) => isStoredComposerDraft(draft))
        .map(([key, draft]) => [key, sanitizeComposerDraft(draft as ComposerDraft)])
        .filter(([, draft]) => composerDraftHasContent(draft as ComposerDraft))
    ) as Record<string, ComposerDraft>;
  } catch (error) {
    console.warn("Unable to restore composer drafts.", error);
    return {};
  }
}

function writeComposerDrafts(drafts: Record<string, ComposerDraft>) {
  if (typeof window === "undefined") return;
  try {
    const meaningfulDrafts = Object.fromEntries(
      Object.entries(drafts)
        .map(([key, draft]) => [key, sanitizeComposerDraft(draft)])
        .filter(([, draft]) => composerDraftHasContent(draft as ComposerDraft))
    );
    if (Object.keys(meaningfulDrafts).length === 0) {
      window.localStorage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      COMPOSER_DRAFTS_STORAGE_KEY,
      JSON.stringify(meaningfulDrafts)
    );
  } catch (error) {
    console.warn("Unable to persist composer drafts.", error);
  }
}

const LOOM_LINK_MIME = "application/loom-link";
const LOOM_INLINE_TOKEN_DRAG_MIME = "application/loom-inline-token-drag-id";

const seedComposerLink: LoomLink = {
  id: "seed-link",
  type: "response",
  title: "Inline reference composition rules",
  path: "loom://loom-ai/navigation-architecture/loom/composer/r-inline-references",
  badge: "Linked",
};

const restoredInitialLoomId = initialAppSettingsSnapshot.startup.continueFromLastLoom
  ? readLastActiveLoomId(initialSeedConversations)
  : null;
const restoredInitialLoom = restoredInitialLoomId
  ? initialSeedConversations.find((conversation) => conversation.id === restoredInitialLoomId)
  : undefined;

const draftNavigationDestination: LoomLink = {
  id: EPHEMERAL_DRAFT_ID,
  type: "conversation",
  title: "New conversation",
  path: "loom://drafts/new-conversation",
  badge: "Draft",
};

const draftResolvedNavigationDestination: LoomNavigationDestination = {
  loomId: EPHEMERAL_DRAFT_ID,
  mode: "full",
  source: "userNavigation",
};

const initialNavigationDestination: LoomLink = restoredInitialLoom
  ? {
      id: restoredInitialLoom.id,
      type: "conversation",
      title: restoredInitialLoom.title,
      path: restoredInitialLoom.path,
      badge: "Loom",
      canonicalUri: restoredInitialLoom.meta?.canonicalUri,
      meta: restoredInitialLoom.meta,
    }
  : draftNavigationDestination;

const initialResolvedNavigationDestination: LoomNavigationDestination = {
  loomId: restoredInitialLoom?.id ?? EPHEMERAL_DRAFT_ID,
  mode: "full",
  source: "userNavigation",
};

const mockForkRecords: ForkRecord[] = [
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
    id: "fork-integrations-mcp-tools",
    parentConversationId: "c-integrations",
    parentResponseId: "r-mcp-execution-boundary",
    childConversationId: "c-integrations-mcp-tools",
    title: "MCP tool execution branch",
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
    id: "fork-graph-spacing",
    parentConversationId: "c-graph-map",
    parentResponseId: "r-site-map",
    childConversationId: "c-graph-spacing",
    title: "Graph spacing Weft",
  },
  {
    id: "fork-graph-continuation",
    parentConversationId: "c-graph-map",
    parentResponseId: "r-graph-continuation",
    childConversationId: "c-graph-continuation",
    title: "Graph continuation Weft",
  },
  {
    id: "fork-graph-continuation-errors",
    parentConversationId: "c-graph-continuation",
    parentResponseId: "r-continuation-main-route",
    childConversationId: "c-graph-continuation-errors",
    title: "Continuation error-state Weft",
  },
  {
    id: "fork-bookmarks-launch",
    parentConversationId: "c-bookmarks",
    parentResponseId: "r-bookmark-panel",
    childConversationId: "c-launch",
    title: "Launch bookmark story branch",
  },
];
const initialForkRecords = initialMockDataEnabled ? mockForkRecords : [];

const seedComposerText = `Use the linked Loom references to draft the V1 onboarding prompt for a power user. <span class="inline-loom-token" contenteditable="false" draggable="true" data-loom-id="${seedComposerLink.id}" data-loom-path="${seedComposerLink.path}" data-loom-title="${seedComposerLink.title}" data-loom-type="${seedComposerLink.type}" data-loom-badge="${seedComposerLink.badge}">[[${seedComposerLink.title}]]</span>`;

const typeLabel: Record<LoomObjectType, string> = {
  conversation: "Loom",
  loom: "Weft",
  response: "Response",
  fragment: "Fragment",
  attachment: "Attachment",
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

function cleanMarkdownDisplayTitle(value?: string) {
  const normalized = normalizeAddressBarTitle(value);
  if (!normalized) return "";
  const cleaned = cleanMarkdownDisplayText(normalized);
  return cleaned || normalized;
}

function cleanPolishedDisplayTitle(value?: string) {
  return polishDisplayTitle(cleanMarkdownDisplayTitle(value));
}

function isEditableSelectAllTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('[contenteditable="true"]')) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(target.type);
  }
  return false;
}

function isSelectAllShortcut(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "a";
}

function compactLoomTitle(value: string, maxLength = 96) {
  const normalized = normalizeLoomTitle(value);
  if (normalized.length <= maxLength) return normalized;
  const ellipsis = "…";
  const hardLimit = Math.max(1, maxLength - ellipsis.length);
  const candidate = normalized.slice(0, hardLimit).trim();
  const lastWhitespace = candidate.search(/\s+\S*$/);
  const wordSafe =
    lastWhitespace > Math.floor(hardLimit * 0.55)
      ? candidate.slice(0, lastWhitespace).trim()
      : candidate;
  return `${wordSafe.replace(/[.,;:!?-]+$/g, "").trim()}${ellipsis}`;
}

function normalizePromptEditText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatAddressBarTitle(activeLoom?: Pick<Conversation, "title"> | null, destinationTitle?: string) {
  const loomTitle = cleanPolishedDisplayTitle(activeLoom?.title);
  const targetTitle = cleanPolishedDisplayTitle(destinationTitle);

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

function escapeInlineReferenceHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeInlineReferenceAttribute(value: string) {
  return escapeInlineReferenceHtml(value).replace(/"/g, "&quot;");
}

function inlineReferenceTokenHtml(
  link: LoomLink,
  referenceDisplayMode: ReferenceDisplayMode
) {
  const displayLink = normalizeResponseLinkSource(
    withReferenceDisplayDefaults(link, referenceDisplayMode)
  );
  const code = referenceCodeForLink(displayLink);
  const displayMode = referenceDisplayModeForLink(displayLink, referenceDisplayMode);
  const attributes: Array<[string, string | number | undefined]> = [
    ["data-testid", "inline-loom-token"],
    ["data-loom-id", displayLink.id],
    ["data-loom-path", displayLink.path],
    ["data-loom-title", displayLink.title],
    ["data-loom-type", displayLink.type],
    ["data-loom-display-mode", displayMode],
    ["data-loom-code", code],
    ["data-loom-badge", displayLink.badge],
    ["data-loom-occurrence-index", displayLink.referenceOccurrenceIndex],
    ["data-loom-selected-at", displayLink.selectedAt],
    ["data-loom-target-object-id", displayLink.targetObjectId],
    ["data-loom-target-kind", displayLink.targetKind],
    ["data-loom-canonical-uri", displayLink.canonicalUri],
    ["data-loom-custom-label", displayLink.referenceCustomLabel],
    ["data-loom-reference-mention-id", displayLink.referenceMentionId],
    ["data-loom-resolution-status", displayLink.resolutionStatus],
    ["data-loom-source-loom-id", displayLink.sourceLoomId],
    ["data-loom-source-response-id", displayLink.sourceResponseId],
    ["data-loom-selected-text", displayLink.selectedText],
    ["data-loom-source-response-code", displayLink.sourceResponseCode],
    ["data-loom-source-response-title", displayLink.sourceResponseTitle],
    ["data-loom-source-canonical-uri", displayLink.sourceCanonicalUri],
    ["data-loom-fragment-hash", displayLink.fragmentHash],
    ["data-loom-created-at", displayLink.createdAt],
  ];
  const serializedAttributes = attributes
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([name, value]) =>
        `${name}="${escapeInlineReferenceAttribute(String(value))}"`
    )
    .join(" ");
  const tokenText = escapeInlineReferenceHtml(
    composerReferenceTokenText(displayLink, referenceDisplayMode)
  );
  const title = escapeInlineReferenceAttribute(displayLink.title);
  return `<span class="inline-loom-token" contenteditable="false" draggable="true" title="${title}" ${serializedAttributes}>${tokenText}</span>`;
}

function appendInlineReferenceTokenHtml(
  html: string,
  link: LoomLink,
  referenceDisplayMode: ReferenceDisplayMode
) {
  const token = inlineReferenceTokenHtml(
    withReferenceOccurrenceIndex(link, countInlineReferenceOccurrences(html, link) + 1),
    referenceDisplayMode
  );
  const needsLeadingSpace = html.trim().length > 0 && !/\s$/.test(html);
  return `${html}${needsLeadingSpace ? " " : ""}${token} `;
}

function markdownToReferenceClipboardHtml(markdown: string) {
  const tokenPattern = /\[([^\]]+)\]\((loom:\/\/[^)\s]+)\)/g;
  let cursor = 0;
  let html = "";
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(markdown)) !== null) {
    if (match.index > cursor) {
      html += escapeInlineReferenceHtml(markdown.slice(cursor, match.index));
    }
    const label = match[1] ?? "";
    const address = match[2] ?? "";
    html += `<a href="${escapeInlineReferenceAttribute(address)}" data-loom-reference-title="${escapeInlineReferenceAttribute(
      label
    )}">${escapeInlineReferenceHtml(label)}</a>`;
    cursor = match.index + match[0].length;
  }
  if (cursor < markdown.length) {
    html += escapeInlineReferenceHtml(markdown.slice(cursor));
  }
  return `<div style="white-space: pre-wrap;">${html.replace(/\n/g, "<br>")}</div>`;
}

function linkFromInlineTokenElement(token: HTMLElement): LoomLink | null {
  const path =
    token.dataset.loomPath ||
    token.dataset.loomCanonicalUri ||
    token.dataset.loomSourceCanonicalUri;
  const title = token.dataset.loomTitle;
  const type = token.dataset.loomType as LoomObjectType | undefined;
  if (!path || !title || !type) return null;
  return normalizeResponseLinkSource({
    id: token.dataset.loomId ?? path,
    type,
    title,
    path,
    badge: token.dataset.loomBadge,
    selectedAt: token.dataset.loomSelectedAt
      ? Number(token.dataset.loomSelectedAt)
      : undefined,
    targetObjectId: token.dataset.loomTargetObjectId,
    targetKind: token.dataset.loomTargetKind as LoomLink["targetKind"],
    canonicalUri: token.dataset.loomCanonicalUri,
    referenceCode: token.dataset.loomCode,
    referenceDisplayMode:
      token.dataset.loomDisplayMode === "code" ? "code" : "title",
    referenceCustomLabel: token.dataset.loomCustomLabel?.trim() || undefined,
    referenceOccurrenceIndex: token.dataset.loomOccurrenceIndex
      ? Number(token.dataset.loomOccurrenceIndex)
      : undefined,
    referenceMentionId: token.dataset.loomReferenceMentionId,
    resolutionStatus: token.dataset.loomResolutionStatus as LoomLink["resolutionStatus"],
    sourceLoomId: token.dataset.loomSourceLoomId,
    sourceResponseId: token.dataset.loomSourceResponseId,
    selectedText: token.dataset.loomSelectedText,
    sourceResponseCode: token.dataset.loomSourceResponseCode,
    sourceResponseTitle: token.dataset.loomSourceResponseTitle,
    sourceCanonicalUri: token.dataset.loomSourceCanonicalUri,
    fragmentHash: token.dataset.loomFragmentHash,
    createdAt: token.dataset.loomCreatedAt ? Number(token.dataset.loomCreatedAt) : undefined,
  });
}

function sanitizeComposerDraft(draft: ComposerDraft): ComposerDraft {
  if (typeof document === "undefined") return draft;
  const root = document.createElement("div");
  root.innerHTML = draft.html;
  const inlineLinks = Array.from(
    root.querySelectorAll<HTMLElement>(".inline-loom-token")
  )
    .map((token) => linkFromInlineTokenElement(token))
    .filter((link): link is LoomLink => Boolean(link));
  const attachedLinks = draft.links.filter(isAttachedQuoteReference);
  return {
    html: root.innerHTML,
    links: [...attachedLinks, ...inlineLinks],
    attachments: draft.attachments ?? [],
  };
}

function countInlineReferenceOccurrences(html: string, link: LoomLink) {
  if (typeof document === "undefined" || html.trim().length === 0) return 0;
  const container = document.createElement("div");
  container.innerHTML = html;
  return Array.from(container.querySelectorAll<HTMLElement>(".inline-loom-token")).filter(
    (token) => {
      const tokenLink = linkFromInlineTokenElement(token);
      return Boolean(tokenLink && referencesShareIdentity(tokenLink, link));
    }
  ).length;
}

function withReferenceOccurrenceIndex(link: LoomLink, index: number): LoomLink {
  return {
    ...link,
    referenceOccurrenceIndex: index > 1 ? index : undefined,
  };
}

function createLoomDragPreview(event: React.DragEvent, title: string, address?: string) {
  document.querySelectorAll("[data-testid='loom-drag-preview']").forEach((node) => {
    node.remove();
  });
  const preview = document.createElement("div");
  preview.className = "loom-drag-preview";
  preview.dataset.testid = "loom-drag-preview";

  if (address) {
    const titleElement = document.createElement("strong");
    titleElement.textContent = title;
    const addressElement = document.createElement("small");
    addressElement.textContent = address;
    preview.append(titleElement, addressElement);
  } else {
    preview.textContent = title;
  }

  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 12, 14);
  return () => preview.remove();
}

function compactPromptText(value: string) {
  return value
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function firstPromptTopic(value: string) {
  const compact = compactPromptText(value);
  if (!compact) return "this Loom";
  const words = compact.split(" ").filter(Boolean).slice(0, 8);
  return words.join(" ").replace(/[?.!,;:]+$/g, "");
}

function heuristicLoomTitleFromPrompt(prompt: string) {
  const topic = firstPromptTopic(prompt);
  return normalizeLoomTitle(topic === "this Loom" ? "New Loom conversation" : topic);
}

function heuristicLoomSummaryFromPrompt(prompt: string) {
  const topic = firstPromptTopic(prompt);
  return topic === "this Loom"
    ? "Drafting an answer for the first Loom prompt."
    : `Drafting an answer about ${topic}.`;
}

function quickAskFallbackTitle(question: string, answer: string) {
  const source = answer.trim() || question.trim();
  const firstSentence = source.split(/(?<=[.!?])\s+/)[0] ?? source;
  return normalizeLoomTitle(firstSentence.slice(0, 72)) || "Quick Ask";
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

function withHydratedLoomMetadata(
  conversation: Conversation,
  metadata: Record<string, LoomMetadata>
) {
  return {
    ...conversation,
    meta: hydrateAddressableLoomMetadata(
      {
        id: conversation.meta?.id ?? metadata[metadataKeyForLoom(conversation.id)]?.id ?? createMetadataUuid(),
        title: conversation.title,
        text: metadataTextForLoom(conversation),
      },
      conversation.meta ?? metadata[metadataKeyForLoom(conversation.id)]
    ),
  };
}

function withHydratedResponseMetadata(
  loomId: string,
  response: ResponseItem,
  metadata: Record<string, LoomMetadata>
) {
  const meta = hydrateResponseMetadata(
    {
      id:
        response.meta?.id ??
        metadata[metadataKeyForResponse(loomId, response.id)]?.id ??
        createMetadataUuid(),
      title: response.title,
      text: metadataTextForResponse(response),
    },
    response.meta ?? metadata[metadataKeyForResponse(loomId, response.id)]
  );
  return {
    ...response,
    address:
      meta.status === "addressable" &&
      meta.canonicalUri &&
      responseIdFromReferenceAddress(meta.canonicalUri) === response.id
        ? meta.canonicalUri
        : response.address,
    meta,
  };
}

function responseAddressForConversation(conversation: Conversation, response: ResponseItem) {
  if (response.address && responseIdFromReferenceAddress(response.address) === response.id) {
    return response.address;
  }
  if (
    response.meta?.canonicalUri &&
    responseIdFromReferenceAddress(response.meta.canonicalUri) === response.id
  ) {
    return response.meta.canonicalUri;
  }
  let basePath = (conversation.meta?.canonicalUri ?? conversation.path).replace(/\/$/, "");
  try {
    const url = new URL(basePath);
    url.search = "";
    url.hash = "";
    basePath = url.toString().replace(/\/$/, "");
  } catch {
    basePath = basePath.split("#")[0]?.split("?")[0]?.replace(/\/$/, "") ?? basePath;
  }
  const code = response.meta?.displayCode ?? response.meta?.code ?? "R-00000";
  return `${basePath}/r/${encodeURIComponent(code)}?id=${encodeURIComponent(response.id)}`;
}

function responseIdentityCandidates(
  loomId: string,
  response: ResponseItem,
  conversation?: Conversation
) {
  const runtimeResponseObjectId = runtimeGraphObjectIdFor(
    "response",
    `${loomId}_${response.id}`
  );
  const runtimePromptObjectId = response.serviceUserResponseId
    ? runtimeGraphObjectIdFor("response", `${loomId}_${response.serviceUserResponseId}`)
    : undefined;
  const responseUrl = conversation
    ? responseAddressForConversation(conversation, response)
    : response.meta?.canonicalUri ?? response.address;
  return new Set(
    [
      response.id,
      response.serviceUserResponseId,
      response.meta?.id,
      response.address,
      response.meta?.canonicalUri,
      responseUrl,
      runtimeResponseObjectId,
      runtimePromptObjectId,
    ].filter((value): value is string => Boolean(value))
  );
}

function metadataValue(value: JsonValue | undefined, key: string) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value[key]
    : undefined;
}

function conversationFromServiceLoom(loom: LoomSummary): Conversation {
  const canonicalUri =
    loom.canonicalUri ??
    (loom.kind === "weft"
      ? canonicalLoomUri("conversation", loom.loomId)
      : canonicalLoomUri("conversation", loom.loomId));
  const revisionPrompt =
    loom.weftKind === "revision" &&
    typeof metadataValue(loom.metadata, "revisionPrompt") === "string"
      ? String(metadataValue(loom.metadata, "revisionPrompt"))
      : undefined;
  const title = revisionPrompt ? compactLoomTitle(`Revision: ${revisionPrompt}`) : loom.title;
  const summary =
    loom.summary ??
    (typeof metadataValue(loom.metadata, "summary") === "string"
      ? String(metadataValue(loom.metadata, "summary"))
      : "");
  const baseMeta = createAddressableLoomMetadata({
    id: loom.loomId,
    title,
    text: summary || title,
  });
  return {
    id: loom.loomId,
    title,
    path: canonicalUri,
    folder: loom.kind === "weft" ? "Wefts" : "Looms",
    summary,
    pinned: false,
    iconKey: loom.kind === "weft" ? "workflow" : "compass",
    meta: {
      ...baseMeta,
      code: loom.code ?? baseMeta.code,
      displayCode: loom.displayCode ?? baseMeta.displayCode,
      canonicalUri,
    },
  };
}

function tabOrderTimestamp(value?: string | null) {
  if (!value) return 0n;
  if (/^\d+$/.test(value)) return BigInt(value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0n : BigInt(parsed) * 1_000_000n;
}

function compareServiceLoomDetailsByTabOrder(left: LoomDetail, right: LoomDetail) {
  const leftTime = tabOrderTimestamp(left.createdAt ?? left.updatedAt);
  const rightTime = tabOrderTimestamp(right.createdAt ?? right.updatedAt);
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  return left.loomId.localeCompare(right.loomId);
}

function appendConversationInTabOrder(
  current: Conversation[],
  conversation: Conversation
) {
  return [
    ...current.filter((item) => item.id !== conversation.id),
    conversation,
  ];
}

function appendTabGroupConversationId(group: TabGroup, conversationId: string) {
  return {
    ...group,
    conversationIds: [
      ...group.conversationIds.filter((item) => item !== conversationId),
      conversationId,
    ],
  };
}

function serviceLoomDetailsToState(details: LoomDetail[]) {
  const sortedDetails = [...details].sort(compareServiceLoomDetailsByTabOrder);
  const conversations = sortedDetails.map(conversationFromServiceLoom);
  const responses = Object.fromEntries(
    sortedDetails.map((detail) => [detail.loomId, detail.responses])
  );
  const forkRecords: ForkRecord[] = sortedDetails
    .filter(
      (detail) =>
        detail.kind === "weft" &&
        Boolean(detail.originLoomId) &&
        Boolean(detail.originResponseId)
    )
    .map((detail) => {
      const revisionSourceResponseId =
        detail.weftKind === "revision" &&
        typeof metadataValue(detail.metadata, "editedResponseId") === "string"
          ? String(metadataValue(detail.metadata, "editedResponseId"))
          : undefined;
      const revisionPrompt =
        detail.weftKind === "revision" &&
        typeof metadataValue(detail.metadata, "revisionPrompt") === "string"
          ? String(metadataValue(detail.metadata, "revisionPrompt"))
          : undefined;
      const originalPrompt =
        detail.weftKind === "revision" &&
        typeof metadataValue(detail.metadata, "originalPrompt") === "string"
          ? String(metadataValue(detail.metadata, "originalPrompt"))
          : undefined;
      const visualParentResponseId = revisionSourceResponseId ?? detail.originResponseId!;
      return {
        id: `fork-${detail.originLoomId}-${visualParentResponseId}-${detail.loomId}`,
        parentConversationId: detail.originLoomId!,
        parentResponseId: visualParentResponseId,
        childConversationId: detail.loomId,
        title: revisionPrompt
          ? compactLoomTitle(`Revision: ${revisionPrompt}`)
          : detail.title,
        kind: detail.weftKind ?? "exploration",
        revisionSourceResponseId,
        revisionPrompt,
        originalPrompt,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      };
    });
  return { conversations, responses, forkRecords };
}

function collectDeletedLoomIds(rootLoomId: string, records: ForkRecord[]) {
  const deleted = new Set([rootLoomId]);
  let changed = true;
  while (changed) {
    changed = false;
    records.forEach((record) => {
      if (
        deleted.has(record.parentConversationId) &&
        !deleted.has(record.childConversationId)
      ) {
        deleted.add(record.childConversationId);
        changed = true;
      }
    });
  }
  return deleted;
}

function App() {
  const addressBarRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const originTranscriptRef = useRef<HTMLElement | null>(null);
  const conversationResponsesRef = useRef<Record<string, ResponseItem[]>>({});
  const activeConversationIdRef = useRef(EPHEMERAL_DRAFT_ID);
  const activeObjectTitleRef = useRef("New conversation");
  const transcriptAutoFollowPausedRef = useRef(false);
  const transcriptProgrammaticScrollRef = useRef(false);
  const previousComposerRunningRef = useRef(false);
  const activeVisitLoomIdRef = useRef<string | null>(null);
  const activeVisitKnownResponseIdsRef = useRef<Set<string>>(new Set());
  const wasWeftSplitVisibleRef = useRef(false);
  const metadataGenerationRef = useRef(new Set<string>());
  const composerFocusRef = useRef<(() => void) | null>(null);
  const pendingScrollPathRef = useRef<string | null>(null);
  const pendingScrollDestinationRef = useRef<LoomNavigationDestination | null>(null);
  const pendingScrollHighlightRef = useRef(false);
  const linkCopyToastTimerRef = useRef<number | null>(null);
  const starterPromptRequestIdRef = useRef(0);
  const serviceLoomsHydratedRef = useRef(false);
  const serviceSidebarLayoutHydratedRef = useRef(
    getConfiguredLoomEngineMode() !== "rust-service" || initialMockDataEnabled
  );
  const lastPersistedSidebarLayoutJsonRef = useRef<string | null>(null);
  const serviceHistoryHydratedRef = useRef(false);
  const lastPersistedHistoryEntryRef = useRef<string | null>(null);
  const loomSurfaceLoadingTimerRef = useRef<number | null>(null);
  const [metadataSeed] = useState<Record<string, LoomMetadata>>(() =>
    readRuntimeMetadata()
  );
  const [conversations, setConversations] =
    useState<Conversation[]>(() =>
      initialSeedConversations.map((conversation) =>
        withHydratedLoomMetadata(conversation, metadataSeed)
      )
    );
  const [conversationResponses, setConversationResponses] = useState<
    Record<string, ResponseItem[]>
  >(() =>
    initialMockDataEnabled
      ? Object.fromEntries(
          Object.entries(seedResponsesByConversation).map(([loomId, responses]) => [
            loomId,
            responses.map((response) =>
              withHydratedResponseMetadata(loomId, response, metadataSeed)
            ),
          ])
        )
      : {}
  );
  const [forkRecords, setForkRecords] = useState<ForkRecord[]>(initialForkRecords);
  const [selectedPromptRevisionByResponseId, setSelectedPromptRevisionByResponseId] =
    useState<Record<string, string | null>>({});
  const [initialSidebarLayout] = useState<SidebarLayoutState>(() =>
    readSidebarLayoutState(
      {
        pinnedConversationIds: initialSeedConversations
          .filter((conversation) => conversation.pinned)
          .map((conversation) => conversation.id),
        tabGroups: makeInitialTabGroups(initialSeedConversations),
        collapsed: false,
      },
      initialSeedConversations
    )
  );
  const [pinnedConversationIds, setPinnedConversationIds] = useState<string[]>(
    initialSidebarLayout.pinnedConversationIds
  );
  const [tabGroups, setTabGroups] = useState<TabGroup[]>(
    initialSidebarLayout.tabGroups
  );
  const pinnedConversationIdsRef = useRef(pinnedConversationIds);
  const tabGroupsRef = useRef(tabGroups);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [groupColorTarget, setGroupColorTarget] = useState<TabGroup | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarLayout.collapsed);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  const [sidebarFlyoutOpen, setSidebarFlyoutOpen] = useState(false);
  const [sidebarFlyoutDragActive, setSidebarFlyoutDragActive] = useState(false);
  const [archived, setArchived] = useState<Conversation[]>([]);
  const [draftConversation, setDraftConversation] = useState<Conversation | null>({
    id: EPHEMERAL_DRAFT_ID,
    title: "New conversation",
    path: "loom://drafts/new-conversation",
    folder: "Drafts",
    summary: "Clean unsaved conversation draft.",
    iconKey: "compass",
  });
  const [activeConversationId, setActiveConversationId] = useState(
    initialResolvedNavigationDestination.loomId
  );
  const [activeObjectTitle, setActiveObjectTitle] = useState(
    initialNavigationDestination.title
  );
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [splitFocusState, dispatchSplitFocus] = useReducer(
    reduceSplitFocus,
    initialSplitFocusState
  );
  const [splitPanelMenu, setSplitPanelMenu] = useState<{
    panel: "origin" | "weft";
    x: number;
    y: number;
  } | null>(null);
  const [temporaryWefts, setTemporaryWefts] = useState<
    Record<string, TemporaryWeftWorkspace>
  >({});
  const [graphMode, setGraphMode] = useState(false);
  const [rightDockPinned, setRightDockPinned] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraft>>(
    () => ({
      ...(initialSeedConversations[0]
        ? {
            [initialSeedConversations[0].id]: {
              html: seedComposerText,
              links: [seedComposerLink],
            },
          }
        : {}),
      [EPHEMERAL_DRAFT_ID]: { html: "", links: [] },
      ...readComposerDrafts(),
    })
  );
  const composerDraftsRef = useRef(composerDrafts);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() =>
    getConfiguredLoomEngineMode() === "rust-service"
      ? []
      : readRuntimeBookmarks(seedBookmarks)
  );
  const [history, setHistory] = useState<HistoryEntry[]>(
    initialMockDataEnabled ? initialHistory : []
  );
  const [serviceCodeSnippetItems, setServiceCodeSnippetItems] = useState<AttachContentItem[]>([]);
  const [navigationStack, setNavigationStack] = useState<HistoryEntry[]>([
    createHistoryEntry(initialNavigationDestination, initialResolvedNavigationDestination),
  ]);
  const [navigationIndex, setNavigationIndex] = useState(0);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [addressBarState, dispatchAddressBar] = useReducer(
    reduceAddressBar,
    initialAddressBarState
  );
  const [addressQuery, setAddressQuery] = useState("");
  const [addressFeedback, setAddressFeedback] =
    useState<LoomResolutionResult | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const [addressSuggestionsVisible, setAddressSuggestionsVisible] = useState(false);
  const addressFocused = isAddressBarFocusedState(addressBarState);

  const setAddressFocused = (focused: boolean) => {
    dispatchAddressBar({ type: focused ? "FOCUS" : "BLUR" });
  };

  const dispatchAddressBarSequence = (...events: AddressBarEvent[]) => {
    events.forEach((event) => dispatchAddressBar(event));
  };
  const [serviceLoomsLoading, setServiceLoomsLoading] = useState(false);
  const [loomSurfaceLoading, setLoomSurfaceLoading] = useState(false);
  const [askState, setAskState] = useState<AskState | null>(null);
  const [responseContextCapsules, setResponseContextCapsules] = useState<
    Record<string, ResponseContextCapsule>
  >({});
  const [selectionAskState, setSelectionAskState] =
    useState<SelectionAskState | null>(null);
  const [selectionReference, setSelectionReference] =
    useState<SelectionReferenceState | null>(null);
  const selectionHighlightRef = useRef<HTMLSpanElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [retryConfirmTarget, setRetryConfirmTarget] = useState<{
    loomId: string;
    responseId: string;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const [iconPickerTarget, setIconPickerTarget] = useState<Conversation | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [providerSettings, setProviderSettings] = useState<AIProviderSettings>(() =>
    readAIProviderSettings()
  );
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const [providerSettingsInitialCategory, setProviderSettingsInitialCategory] =
    useState<SettingsCategoryId>("runtime");
  const [appSettings, setAppSettings] = useState<AppSettings>(
    initialAppSettingsSnapshot
  );
  const mockDataEnabled = isMockDataEnabled(appSettings);
  const [starterCategoryId, setStarterCategoryId] =
    useState<NewLoomStarterCategoryId>("research");
  const [starterPromptRequest, setStarterPromptRequest] =
    useState<TextInsertionRequest | null>(null);
  const [composerRuntimeState, setComposerRuntimeState] = useState<{
    running: boolean;
    message: string | null;
  }>({ running: false, message: null });
  const [composerRuntimeTargetKey, setComposerRuntimeTargetKey] = useState<string | null>(null);
  const mainGenerationRef = useRef(0);
  const mainComposerSubmissionInFlightRef = useRef(false);
  const mainAbortRef = useRef<AbortController | null>(null);
  const mainRevealTargetRef = useRef<{ loomId: string; responseId: string } | null>(null);
  const mainServiceCancellationRef = useRef<{
    loomId: string;
    responseId: string;
    workflowRunId?: string;
    cancelRequested: boolean;
  } | null>(null);
  const thinkingGuardRetryResponseRef = useRef<string | null>(null);
  const thinkingAutoAnswerResponseRef = useRef<string | null>(null);
  const currentMainRequestRef = useRef<{
    loomId: string;
    responseId: string;
    prompt: string;
    context: string[];
    system: string;
    effort: ModelEffort;
    mode: ModelResponseMode;
    think: boolean;
    outputBudget: ModelOutputBudget;
    numPredict: number;
    referenceCount: number;
    referenceCharCount: number;
    messageCount: number;
    resolvedNumCtx: number;
    controller: AbortController;
  } | null>(null);
  const quickGenerationRef = useRef(0);
  const quickAbortRef = useRef<AbortController | null>(null);
  const quickRevealQuestionRef = useRef<string | null>(null);
  const [responseTitleOverrides, setResponseTitleOverrides] = useState<
    Record<string, string>
  >({});
  const [linkCopyToastVisible, setLinkCopyToastVisible] = useState(false);
  const [toastTitle, setToastTitle] = useState<string | undefined>(undefined);
  const [copyToastMessage, setCopyToastMessage] = useState("Link is copied");
  const [toastIcon, setToastIcon] =
    useState<ToastNotificationIcon | undefined>(undefined);
  const [toastColor, setToastColor] =
    useState<ToastNotificationColor>("neutral");
  const [recentBookmarkFeedbackId, setRecentBookmarkFeedbackId] =
    useState<string | null>(null);
  const [bookmarksNavPulse, setBookmarksNavPulse] = useState(false);
  const [recentWeftFeedbackLoomId, setRecentWeftFeedbackLoomId] =
    useState<string | null>(null);
  const [recentResponseFeedbackId, setRecentResponseFeedbackId] =
    useState<string | null>(null);
  const [generatingResponseId, setGeneratingResponseId] =
    useState<string | null>(null);
  const [completionActionRevealResponseId, setCompletionActionRevealResponseId] =
    useState<string | null>(null);
  const [currentVisitResponseIds, setCurrentVisitResponseIds] = useState<Set<string>>(
    () => new Set()
  );
  const completionActionRevealFrameRef = useRef<number | null>(null);
  const completionActionRevealTimerRef = useRef<number | null>(null);
  const growthMilestoneToastTimerRef = useRef<number | null>(null);
  const activeTemporaryWeft = temporaryWefts[activeConversationId];
  const activeTemporaryConversation: Conversation | undefined = activeTemporaryWeft
    ? {
        id: activeTemporaryWeft.temporaryId,
        title: activeTemporaryWeft.title,
        path: activeTemporaryWeft.path,
        folder: activeTemporaryWeft.folder,
        summary: activeTemporaryWeft.summary,
        iconKey: "workflow",
        meta: createAddressableLoomMetadata({
          id: activeTemporaryWeft.temporaryId,
          title: activeTemporaryWeft.title,
          text: `${activeTemporaryWeft.title}\n\n${activeTemporaryWeft.summary}`,
        }),
      }
    : undefined;

  const activeConversation =
    activeConversationId === draftConversation?.id
          ? draftConversation
          : activeTemporaryConversation
          ? activeTemporaryConversation
          : conversations.find((conversation) => conversation.id === activeConversationId) ??
    conversations[0] ??
    archived[0];

  const newLoomDraftHasText = plainTextFromDraft(
    composerDrafts[EPHEMERAL_DRAFT_ID] ?? EMPTY_COMPOSER_DRAFT
  ).length > 0;

  const activeResponses = activeConversation && activeConversation.id !== draftConversation?.id
    ? conversationResponses[activeConversation.id] ?? []
    : [];

  useEffect(() => {
    const loomId =
      activeConversation && activeConversation.id !== draftConversation?.id
        ? activeConversation.id
        : null;
    const responseIds = activeResponses.map((response) => response.id);

    if (!loomId) {
      activeVisitLoomIdRef.current = null;
      activeVisitKnownResponseIdsRef.current = new Set();
      setCurrentVisitResponseIds((current) =>
        current.size === 0 ? current : new Set()
      );
      return;
    }

    if (activeVisitLoomIdRef.current !== loomId) {
      activeVisitLoomIdRef.current = loomId;
      activeVisitKnownResponseIdsRef.current = new Set(responseIds);
      setCurrentVisitResponseIds((current) =>
        current.size === 0 ? current : new Set()
      );
      return;
    }

    const nextIds = responseIds.filter(
      (responseId) => !activeVisitKnownResponseIdsRef.current.has(responseId)
    );
    responseIds.forEach((responseId) =>
      activeVisitKnownResponseIdsRef.current.add(responseId)
    );
    if (nextIds.length === 0) return;

    setCurrentVisitResponseIds((current) => {
      const next = new Set(current);
      nextIds.forEach((responseId) => next.add(responseId));
      return next;
    });
  }, [activeConversation?.id, activeResponses, draftConversation?.id]);

  useEffect(() => {
    conversationResponsesRef.current = conversationResponses;
  }, [conversationResponses]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    pinnedConversationIdsRef.current = pinnedConversationIds;
  }, [pinnedConversationIds]);

  useEffect(() => {
    tabGroupsRef.current = tabGroups;
  }, [tabGroups]);

  useEffect(() => {
    sidebarCollapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (
      getConfiguredLoomEngineMode() === "rust-service" &&
      (!serviceLoomsHydratedRef.current || !serviceSidebarLayoutHydratedRef.current) &&
      conversations.length === 0
    ) {
      return;
    }
    const layout = normalizeSidebarLayoutState(
      { pinnedConversationIds, tabGroups, collapsed: sidebarCollapsed },
      new Set(conversations.map((conversation) => conversation.id))
    );
    const serialized = JSON.stringify(layout);
    writeSidebarLayoutState(layout);
    if (
      getConfiguredLoomEngineMode() !== "rust-service" ||
      mockDataEnabled ||
      !serviceLoomsHydratedRef.current ||
      !serviceSidebarLayoutHydratedRef.current ||
      serialized === lastPersistedSidebarLayoutJsonRef.current
    ) {
      return;
    }
    lastPersistedSidebarLayoutJsonRef.current = serialized;
    void loomEngineClientRef.current
      .saveUiState({ key: SIDEBAR_LAYOUT_STATE_KEY, value: layout as unknown as JsonValue })
      .catch((error) => {
        console.warn("Sidebar layout persistence requires loom-service.", error);
        lastPersistedSidebarLayoutJsonRef.current = null;
      });
  }, [conversations, mockDataEnabled, pinnedConversationIds, sidebarCollapsed, tabGroups]);

  useEffect(() => {
    composerDraftsRef.current = composerDrafts;
    writeComposerDrafts(composerDrafts);
  }, [composerDrafts]);

  useEffect(
    () => () => {
      if (loomSurfaceLoadingTimerRef.current !== null) {
        window.clearTimeout(loomSurfaceLoadingTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (activeConversationId === EPHEMERAL_DRAFT_ID) return;
    writeLastActiveLoomId(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    if (activeConversationId === EPHEMERAL_DRAFT_ID) return;
    setTabGroups((current) => {
      let changed = false;
      const next = current.map((group) => {
        if (!group.collapsed || !group.conversationIds.includes(activeConversationId)) {
          return group;
        }
        changed = true;
        return { ...group, collapsed: false };
      });
      return changed ? next : current;
    });
  }, [activeConversationId]);

  useEffect(() => {
    activeObjectTitleRef.current = activeObjectTitle;
  }, [activeObjectTitle]);

  const currentNavigationDestination =
    navigationStack[navigationIndex]?.navigationDestination ??
    initialResolvedNavigationDestination;
  const sidebarFlyoutVisible = sidebarCollapsed && sidebarFlyoutOpen;
  const utilityPanelOpen = activePanel !== null;
  const dockedUtilityOverlay = rightDockPinned && utilityPanelOpen;

  const activeWeftOrigin =
    activeTemporaryWeft
      ? {
          originLoomId: activeTemporaryWeft.originLoomId,
          originResponseId: activeTemporaryWeft.originResponseId,
        }
      : getWeftOrigin(activeConversationId);
  const originConversation = activeWeftOrigin
    ? conversations.find((conversation) => conversation.id === activeWeftOrigin.originLoomId)
    : undefined;
  const originResponses = originConversation
    ? conversationResponses[originConversation.id] ?? []
    : [];
  const canShowWeftSplit = workspaceWidth > 0;
  const showWeftSplit =
    Boolean(activeWeftOrigin && originConversation) &&
    (currentNavigationDestination.mode === "split" || Boolean(activeTemporaryWeft)) &&
    canShowWeftSplit;
  const activeSplitPanel = splitPanelFromFocusState(splitFocusState);
  const activeAddressableSplitPanel = addressablePanelFromFocusState(splitFocusState);

  const setActiveSplitPanel = (panel: "origin" | "weft") => {
    const event: SplitFocusEvent =
      panel === "origin"
        ? { type: "ORIGIN_INTERACTED" }
        : activeTemporaryWeft
          ? { type: "TEMP_WEFT_INTERACTED" }
          : { type: "PERSISTED_WEFT_INTERACTED" };
    dispatchSplitFocus(event);
  };

  useEffect(() => {
    if (activeWeftOrigin) return;
    setSelectedPromptRevisionByResponseId((current) =>
      Object.keys(current).length > 0 ? {} : current
    );
  }, [activeConversationId, activeWeftOrigin]);

  const focusedSplitConversation =
    showWeftSplit && activeSplitPanel === "origin" && originConversation
      ? originConversation
      : activeConversation;
  const focusedSplitResponses =
    focusedSplitConversation && focusedSplitConversation.id !== draftConversation?.id
      ? conversationResponses[focusedSplitConversation.id] ?? []
      : [];
  const activeAddressableConversation = showWeftSplit
    ? activeAddressableSplitPanel === "origin"
      ? originConversation
      : activeConversation
    : focusedSplitConversation;
  const activeAddressableResponses =
    activeAddressableConversation && activeAddressableConversation.id !== draftConversation?.id
      ? conversationResponses[activeAddressableConversation.id] ?? []
      : [];
  const bookmarkedResponseAddresses = useMemo(
    () =>
      new Set(
        bookmarks.flatMap((bookmark) => Array.from(bookmarkIdentityCandidates(bookmark)))
      ),
    [bookmarks]
  );
  const conversationTitlesById = useMemo(
    () =>
      Object.fromEntries(
        conversations.map((conversation) => [conversation.id, conversation.title])
      ),
    [conversations]
  );
  const forkRecordsWithTimestamps = useMemo(
    () =>
      forkRecords.map((record) => {
        if (record.createdAt) return record;
        const childResponses = conversationResponses[record.childConversationId] ?? [];
        const firstResponseTimestamp = childResponses.find((response) => response.createdAt)
          ?.createdAt;
        return firstResponseTimestamp ? { ...record, createdAt: firstResponseTimestamp } : record;
      }),
    [conversationResponses, forkRecords]
  );

  const activeDraftKey = activeConversation?.id ?? EPHEMERAL_DRAFT_ID;
  const activeComposerDraft = composerDrafts[activeDraftKey] ?? EMPTY_COMPOSER_DRAFT;
  const isNewConversationDraft = activeConversationId === EPHEMERAL_DRAFT_ID;
  const showLoomSurfaceLoading =
    !isNewConversationDraft &&
    !graphMode &&
    (serviceLoomsLoading || loomSurfaceLoading);
  const filteredSuggestions = useMemo(() => {
    return buildAddressBarSuggestions({
      query: addressQuery,
      conversations,
      fallbackSuggestions: mockDataEnabled ? addressSuggestions : [],
    });
  }, [addressQuery, conversations, mockDataEnabled]);

  const addressBarObjectTitle =
    activeAddressableConversation?.id === focusedSplitConversation?.id
      ? activeObjectTitle
      : activeAddressableConversation?.title;
  const currentLocation = formatAddressBarTitle(
    activeAddressableConversation,
    addressBarObjectTitle
  );

  function visibleSplitPanelForLoomId(loomId: string) {
    if (!showWeftSplit) return null;
    if (originConversation?.id === loomId) return "origin" as const;
    if (activeConversation?.id === loomId) return "weft" as const;
    return null;
  }

  function markSplitPanelActive(panel: "origin" | "weft") {
    setActiveSplitPanel(panel);
    const conversation = panel === "origin" ? originConversation : activeConversation;
    if (conversation) setActiveObjectTitle(conversation.title);
  }

  const currentActiveDestination = useMemo<LoomLink>(() => {
    if (showWeftSplit && activeAddressableConversation) {
      return {
        id: activeAddressableConversation.id,
        type: getWeftOrigin(activeAddressableConversation.id) ? "loom" : "conversation",
        title: activeAddressableConversation.title,
        path: activeAddressableConversation.path,
        badge: getWeftOrigin(activeAddressableConversation.id) ? typeLabel.loom : typeLabel.conversation,
        canonicalUri: activeAddressableConversation.meta?.canonicalUri,
        meta: activeAddressableConversation.meta,
      };
    }
    const activeResponse = activeAddressableResponses.find(
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
        canonicalUri: activeResponse.meta?.canonicalUri,
        meta: activeResponse.meta,
      };
    }
    if (activeAddressableConversation) {
      return {
        id: activeAddressableConversation.id,
        type: getWeftOrigin(activeAddressableConversation.id) ? "loom" : "conversation",
        title: activeAddressableConversation.title,
        path: activeAddressableConversation.path,
        badge: getWeftOrigin(activeAddressableConversation.id) ? typeLabel.loom : typeLabel.conversation,
        canonicalUri: activeAddressableConversation.meta?.canonicalUri,
        meta: activeAddressableConversation.meta,
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
    activeAddressableConversation,
    activeAddressableResponses,
    responseTitleOverrides,
    showWeftSplit,
  ]);
  const currentShareDestination = useMemo<LoomLink>(() => {
    if (activeAddressableConversation) {
      return {
        id: activeAddressableConversation.id,
        type: getWeftOrigin(activeAddressableConversation.id) ? "loom" : "conversation",
        title: activeAddressableConversation.title,
        path: activeAddressableConversation.path,
        badge: getWeftOrigin(activeAddressableConversation.id)
          ? typeLabel.loom
          : typeLabel.conversation,
        canonicalUri: activeAddressableConversation.meta?.canonicalUri,
        meta: activeAddressableConversation.meta,
      };
    }
    return currentActiveDestination;
  }, [activeAddressableConversation, currentActiveDestination]);
  const currentAddressBarValue = isNewConversationDraft
    ? ""
    : currentShareDestination.canonicalUri ?? currentShareDestination.path;

  const currentLoomExportTarget = useMemo(() => {
    if (!focusedSplitConversation) return null;
    return {
      loom: focusedSplitConversation,
      responses: focusedSplitResponses.map((response) => ({
        ...response,
        title: responseTitleOverrides[response.id] ?? response.title,
      })),
    };
  }, [focusedSplitConversation, focusedSplitResponses, responseTitleOverrides]);

  useEffect(() => {
    if (showWeftSplit && !wasWeftSplitVisibleRef.current) {
      dispatchSplitFocus({
        type: "SPLIT_OPENED",
        weftKind: activeTemporaryWeft ? "temporary" : "persisted",
      });
    }
    if (!showWeftSplit && wasWeftSplitVisibleRef.current) {
      dispatchSplitFocus({ type: "NAVIGATED_FULL" });
    }
    wasWeftSplitVisibleRef.current = showWeftSplit;
  }, [activeTemporaryWeft, showWeftSplit]);

  const composerReferenceOptions = useMemo<ComposerReferenceOption[]>(() => {
    const conversationOptions = conversations.map((conversation) => ({
      id: conversation.id,
      type: getWeftOrigin(conversation.id) ? "loom" as const : "conversation" as const,
      title: conversation.title,
      path: conversation.path,
      badge: getWeftOrigin(conversation.id) ? typeLabel.loom : typeLabel.conversation,
      canonicalUri: conversation.meta?.canonicalUri,
      meta: conversation.meta,
      referenceCode: conversation.meta?.code,
      group: "Open Looms" as const,
      subtitle: conversation.folder,
      keywords: [
        "Open Loom",
        conversation.folder,
        conversation.summary,
        ...(conversation.meta?.keywords ?? []),
      ],
      searchText: [conversation.summary, conversation.meta?.summary ?? ""],
    }));
    const loomOptions = Object.values(conversationResponses)
      .flat()
      .map((response) => ({
        id: response.id,
        type: "response" as const,
        title: response.title,
        path: response.address,
        badge: typeLabel.response,
        canonicalUri: response.meta?.canonicalUri,
        meta: response.meta,
        referenceCode: response.meta?.code,
        group: "Responses" as const,
        subtitle: response.meta?.summary || response.question || "Response",
        keywords: ["Response", ...(response.meta?.keywords ?? [])],
        searchText: [response.question, response.meta?.summary ?? "", ...response.answer],
      }));
    const bookmarkOptions = bookmarks.map((bookmark) => ({
      ...bookmark,
      title: bookmark.editableTitle,
      referenceCode: bookmark.referenceCode ?? bookmark.meta?.code,
      group: "Bookmarks" as const,
      subtitle: bookmark.lastUsed,
      keywords: [
        "Bookmark",
        bookmark.lastUsed,
        bookmark.title,
        bookmark.editableTitle,
        ...(bookmark.meta?.keywords ?? []),
      ],
      searchText: [bookmark.title, bookmark.meta?.summary ?? ""],
    }));
    const historyOptions = history.map((entry) => ({
      ...entry,
      referenceCode: entry.referenceCode ?? entry.meta?.code,
      group: "History" as const,
      subtitle: entry.path,
      keywords: ["Loom History", entry.visitedAt, ...(entry.meta?.keywords ?? [])],
      searchText: [entry.visitedAt, entry.meta?.summary ?? ""],
    }));
    const codeSnippetOptions = serviceCodeSnippetItems.map((item) => ({
      ...item,
      group: "Code Snippets" as const,
      searchText: [item.subtitle, item.path, item.selectedText ?? "", ...item.keywords],
    }));

    return [
      ...conversationOptions,
      ...loomOptions,
      ...codeSnippetOptions,
      ...bookmarkOptions,
      ...historyOptions,
    ];
  }, [bookmarks, conversationResponses, conversations, forkRecords, history, serviceCodeSnippetItems]);

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
    const openLoomItems = conversations.map((conversation) => {
      const targetObjectId = runtimeGraphObjectIdFor("conversation", conversation.id);
      return {
        id: conversation.id,
        type: getWeftOrigin(conversation.id) ? "loom" as const : "conversation" as const,
        title: conversation.title,
        path: conversation.path,
        badge: getWeftOrigin(conversation.id) ? typeLabel.loom : typeLabel.conversation,
        targetObjectId,
        canonicalUri: conversation.meta?.canonicalUri ?? canonicalLoomUri("conversation", targetObjectId),
        meta: conversation.meta,
        source: "openLoom" as const,
        subtitle: conversation.folder,
        keywords: [
          "Open Loom",
          conversation.summary,
          ...(conversation.meta?.keywords ?? []),
        ],
      };
    });
    const responseItems = Object.entries(conversationResponses).flatMap(([conversationId, responses]) =>
      responses.map((response) => {
        const targetObjectId = runtimeGraphObjectIdFor(
          "response",
          `${conversationId}_${response.id}`
        );
        return {
        id: response.id,
        type: "response" as const,
        title: response.title,
        path: response.address,
        badge: typeLabel.response,
        targetObjectId,
        canonicalUri: response.meta?.canonicalUri ?? canonicalLoomUri("response", targetObjectId),
        meta: response.meta,
        source: "response" as const,
        subtitle: response.question,
        keywords: [
          "Response",
          ...(response.meta?.keywords ?? []),
          ...response.answer,
        ],
        };
      })
    );
    const loadedCodeSnippetItems = Object.entries(conversationResponses).flatMap(([conversationId, responses]) => {
      const conversation = conversations.find((item) => item.id === conversationId);
      return responses.flatMap((response) =>
        (response.codeBlocks ?? [])
          .map((codeBlock) => ({
            codeBlockId: codeBlock.codeBlockId ?? `${response.id}-code-${codeBlock.blockIndex}`,
            responseId: response.id,
            loomId: conversationId,
            loomTitle: conversation?.title,
            sourceResponseTitle: response.title,
            sourceResponseCode: response.meta?.displayCode ?? response.meta?.code,
            sourceCanonicalUri: response.meta?.canonicalUri ?? response.address,
            blockIndex: codeBlock.blockIndex,
            language: codeBlock.language,
            code: codeBlock.code,
            exactHash: codeBlock.exactHash,
            fence: codeBlock.fence,
          }))
          .filter(isReusableCodeSnippet)
          .map(codeSnippetAttachItemFromService)
      );
    });

    return dedupeAttachContentItems([
      ...bookmarkItems,
      ...historyItems,
      ...openLoomItems,
      ...responseItems,
      ...serviceCodeSnippetItems,
      ...loadedCodeSnippetItems,
    ]);
  }, [bookmarks, conversationResponses, conversations, forkRecords, history, serviceCodeSnippetItems]);

  const loomGraphRepository = useMemo(
    () =>
      createRuntimeLoomGraphRepository({
        conversations,
        responsesByConversation: conversationResponses,
        bookmarks,
      }),
    [bookmarks, conversationResponses, conversations]
  );
  const loomEngineClient = useMemo(
    () =>
      createLoomEngineClient({
        localDependencies: {
          graphRepository: loomGraphRepository,
          quickAsk: async (input) => {
            const result = await runModelProfileRequest(providerSettings, {
              profile: "quick",
              effort: "Low",
              mode: "instant",
              think: false,
              outputBudget: "short",
              numPredict: input.options?.numPredict ?? 768,
              prompt: input.question,
              context: [
                input.selectedText
                  ? `Selected fragment:\n"${input.selectedText}"`
                  : "",
                input.activeReferences?.length
                  ? [
                      "Active reference/context:",
                      ...input.activeReferences.map((reference) =>
                        [
                          `- ${reference.label}`,
                          reference.selectedText ? `  selected text: ${reference.selectedText}` : "",
                          reference.preview ? `  preview: ${reference.preview}` : "",
                          reference.targetUri ? `  target URI: ${reference.targetUri}` : "",
                        ].filter(Boolean).join("\n")
                      ),
                      "Instruction: treat active reference/context chips as first-class context.",
                    ].join("\n")
                  : "",
                input.sourceContext
                  ? [
                      input.sourceContext.title ? `Title: ${input.sourceContext.title}` : "",
                      input.sourceContext.responseCode
                        ? `Response code: ${input.sourceContext.responseCode}`
                        : "",
                      input.sourceContext.canonicalUri
                        ? `Canonical URI: ${input.sourceContext.canonicalUri}`
                        : "",
                      input.sourceContext.summary ? `Summary: ${input.sourceContext.summary}` : "",
                      input.sourceContext.keyPoints?.length
                        ? `Key points:\n${input.sourceContext.keyPoints.map((point) => `- ${point}`).join("\n")}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join("\n")
                  : "",
                input.turns.length
                  ? [
                      "Previous quick turns:",
                      ...input.turns.slice(-3).map((turn) => `User: ${turn.question}\nAssistant: ${turn.answer}`),
                    ].join("\n")
                  : "",
              ].filter(Boolean),
              system:
                "Answer this as a Loom Quick Ask. Keep instant, no-thinking behavior and use the selected fragment as primary context when present. Be concise but useful: do not force the answer into one sentence, use 2-5 sentences or short bullets when helpful, and do not write a long essay. Use previous temporary Ask turns silently. Answer directly; do not mention context blocks, capsules, wrapper labels, or artifact names.",
            });
            return { answer: sanitizeModelAnswer(result.text), model: result.modelId, warnings: [] };
          },
          exportLoom: async (input) => {
            if (!currentLoomExportTarget || currentLoomExportTarget.loom.id !== input.loomId) {
              throw new Error("TypeScript export fallback could not find the active Loom.");
            }
            if (input.format === "markdown") {
              return {
                fileName: safeExportFilename(currentLoomExportTarget.loom, "md"),
                mimeType: "text/markdown;charset=utf-8",
                contentBase64: textToBase64(exportLoomAsMarkdown(currentLoomExportTarget)),
                warnings: [],
              };
            }
            if (input.format === "csv") {
              return {
                fileName: safeExportFilename(currentLoomExportTarget.loom, "csv"),
                mimeType: "text/csv;charset=utf-8",
                contentBase64: textToBase64(exportLoomAsCsv(currentLoomExportTarget)),
                warnings: [],
              };
            }
            if (input.format === "json") {
              return {
                fileName: safeExportFilename(currentLoomExportTarget.loom, "json"),
                mimeType: "application/json;charset=utf-8",
                contentBase64: textToBase64(exportLoomMetadataJson(currentLoomExportTarget)),
                warnings: [],
              };
            }
            if (input.format === "zip") {
              return {
                fileName: safeExportFilename(currentLoomExportTarget.loom, "zip"),
                mimeType: "application/zip",
                contentBase64: exportLoomAsZip(currentLoomExportTarget),
                warnings: [],
              };
            }
            throw new Error("Unsupported Loom export format.");
          },
        },
      }),
    [currentLoomExportTarget, loomGraphRepository, providerSettings]
  );
  const loomEngineClientRef = useRef(loomEngineClient);

  useEffect(() => {
    loomEngineClientRef.current = loomEngineClient;
  }, [loomEngineClient]);

  useEffect(() => {
    if (getConfiguredLoomEngineMode() !== "rust-service" || mockDataEnabled) {
      setServiceCodeSnippetItems([]);
      return;
    }
    const loomId =
      activeAddressableConversation?.id &&
      activeAddressableConversation.id !== EPHEMERAL_DRAFT_ID &&
      !temporaryWefts[activeAddressableConversation.id]
        ? activeAddressableConversation.id
        : undefined;
    let cancelled = false;
    void loomEngineClientRef.current
      .listCodeSnippets({ loomId, limit: 200 })
      .then((result) => {
        if (cancelled) return;
        setServiceCodeSnippetItems(
          result.codeSnippets
            .filter(isReusableCodeSnippet)
            .map(codeSnippetAttachItemFromService)
        );
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("Code Snippet listing requires loom-service.", error);
        setServiceCodeSnippetItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAddressableConversation?.id, conversationResponses, mockDataEnabled, temporaryWefts]);

  const refreshServiceLooms = useCallback(async () => {
    if (getConfiguredLoomEngineMode() !== "rust-service" || mockDataEnabled) return;
    setServiceLoomsLoading(true);
    try {
      const summaries = await loomEngineClientRef.current.listLooms();
      const archivedSummaries = await loomEngineClientRef.current.listLooms({
        archived: true,
      });
      const details = await Promise.all(
        summaries.map((summary) => loomEngineClientRef.current.getLoom(summary.loomId))
      );
      const next = serviceLoomDetailsToState(details);
      const nextArchived = archivedSummaries.map(conversationFromServiceLoom);
      const availableConversationIds = new Set(
        next.conversations.map((conversation) => conversation.id)
      );
      setConversations(next.conversations);
      setArchived(nextArchived);
      setConversationResponses(next.responses);
      setForkRecords(next.forkRecords);
      let restoredLayout: SidebarLayoutState | null = null;
      try {
        const result = await loomEngineClientRef.current.getUiState({
          key: SIDEBAR_LAYOUT_STATE_KEY,
        });
        restoredLayout = sidebarLayoutStateFromJsonValue(result.state?.value);
      } catch (error) {
        console.warn("Sidebar layout hydration requires loom-service.", error);
      }
      const fallbackLayout = normalizeSidebarLayoutState(
        {
          pinnedConversationIds: pinnedConversationIdsRef.current,
          tabGroups: tabGroupsRef.current,
          collapsed: sidebarCollapsedRef.current,
        },
        availableConversationIds
      );
      const nextLayout = normalizeSidebarLayoutState(
        restoredLayout ?? fallbackLayout,
        availableConversationIds
      );
      setPinnedConversationIds(nextLayout.pinnedConversationIds);
      setTabGroups(nextLayout.tabGroups);
      setSidebarCollapsed(nextLayout.collapsed);
      serviceSidebarLayoutHydratedRef.current = true;
      lastPersistedSidebarLayoutJsonRef.current = JSON.stringify(nextLayout);
      serviceLoomsHydratedRef.current = true;
      if (
        appSettings.startup.continueFromLastLoom &&
        activeConversationIdRef.current === EPHEMERAL_DRAFT_ID
      ) {
        const restoredLoomId = readLastActiveLoomId(next.conversations);
        const restoredLoom = restoredLoomId
          ? next.conversations.find((conversation) => conversation.id === restoredLoomId)
          : undefined;
        if (restoredLoom) {
          const restoredDestination: LoomLink = {
            id: restoredLoom.id,
            type: "conversation",
            title: restoredLoom.title,
            path: restoredLoom.path,
            badge: restoredLoom.folder === "Wefts" ? "Weft" : "Loom",
            canonicalUri: restoredLoom.meta?.canonicalUri,
            meta: restoredLoom.meta,
          };
          const restoredNavigationDestination: LoomNavigationDestination = {
            loomId: restoredLoom.id,
            mode: "full",
            source: "userNavigation",
          };
          setActiveConversationId(restoredLoom.id);
          setActiveObjectTitle(restoredLoom.title);
          setNavigationStack([
            createHistoryEntry(restoredDestination, restoredNavigationDestination),
          ]);
          setNavigationIndex(0);
        }
      }
      const activeStillExists = next.conversations.some(
        (conversation) => conversation.id === activeConversationIdRef.current
      );
      if (
        activeConversationIdRef.current !== EPHEMERAL_DRAFT_ID &&
        !activeStillExists
      ) {
        setActiveConversationId(EPHEMERAL_DRAFT_ID);
        setActiveObjectTitle(draftNavigationDestination.title);
        setNavigationStack([
          createHistoryEntry(
            draftNavigationDestination,
            draftResolvedNavigationDestination
          ),
        ]);
        setNavigationIndex(0);
      }
    } catch (error) {
      console.warn("Loom hydration requires loom-service.", error);
    } finally {
      setServiceLoomsLoading(false);
    }
  }, [appSettings.startup.continueFromLastLoom, mockDataEnabled]);

  const refreshServiceHistory = useCallback(async () => {
    if (getConfiguredLoomEngineMode() !== "rust-service" || mockDataEnabled) return;
    try {
      const result = await loomEngineClientRef.current.listHistory();
      setHistory(result.history);
      lastPersistedHistoryEntryRef.current = result.history[0]?.id ?? null;
      serviceHistoryHydratedRef.current = true;
    } catch (error) {
      console.warn("History hydration requires loom-service.", error);
      setHistory([]);
      serviceHistoryHydratedRef.current = true;
    }
  }, [mockDataEnabled]);

  useEffect(() => {
    void refreshServiceLooms();
  }, [refreshServiceLooms]);

  useEffect(() => {
    void refreshServiceHistory();
  }, [refreshServiceHistory]);

  const liveServiceGenerationRunIds = useMemo(() => {
    if (getConfiguredLoomEngineMode() !== "rust-service" || mockDataEnabled) return [];
    const runIds = new Set<string>();
    for (const responses of Object.values(conversationResponses)) {
      for (const response of responses) {
        if (
          response.workflowRunId &&
          isLiveServiceGenerationStatus(response.serviceGenerationStatus)
        ) {
          runIds.add(response.workflowRunId);
        }
      }
    }
    return Array.from(runIds).sort();
  }, [conversationResponses, mockDataEnabled]);

  const liveServiceGenerationRunKey = liveServiceGenerationRunIds.join("|");

  useEffect(() => {
    if (
      getConfiguredLoomEngineMode() !== "rust-service" ||
      mockDataEnabled ||
      liveServiceGenerationRunIds.length === 0
    ) {
      return;
    }
    let cancelled = false;
    let timeoutId: number | undefined;
    const poll = async () => {
      const runIds = liveServiceGenerationRunKey
        .split("|")
        .map((runId) => runId.trim())
        .filter(Boolean);
      for (const workflowRunId of runIds) {
        if (cancelled) return;
        try {
          const state =
            await loomEngineClientRef.current.getGenerationResponseState(workflowRunId);
          if (!cancelled) applyGenerationResponseState(state);
        } catch (error) {
          console.warn("Generation response state polling failed.", error);
        }
      }
      if (!cancelled) {
        timeoutId = window.setTimeout(poll, 500);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [liveServiceGenerationRunKey, liveServiceGenerationRunIds.length, mockDataEnabled]);

  useEffect(() => {
    if (
      getConfiguredLoomEngineMode() !== "rust-service" ||
      mockDataEnabled ||
      !serviceHistoryHydratedRef.current
    ) {
      return;
    }
    const latest = history[0];
    if (!latest || latest.id === lastPersistedHistoryEntryRef.current) return;
    if (latest.id === EPHEMERAL_DRAFT_ID || latest.path === draftNavigationDestination.path) {
      return;
    }
    lastPersistedHistoryEntryRef.current = latest.id;
    void loomEngineClientRef.current.recordHistory({ entry: latest }).catch((error) => {
      console.warn("History persistence requires loom-service.", error);
    });
  }, [history, mockDataEnabled]);

  const refreshServiceBookmarks = useCallback(async () => {
    if (getConfiguredLoomEngineMode() !== "rust-service") return;
    try {
      const result = await loomEngineClientRef.current.listBookmarks();
      const responsesByLoom = conversationResponsesRef.current;
      const normalizeServiceBookmark = (bookmark: BookmarkItem): BookmarkItem => {
        if (bookmark.type !== "response") return bookmark;
        for (const [loomId, responses] of Object.entries(responsesByLoom)) {
          const response = responses.find(
            (item) =>
              item.id === bookmark.targetObjectId ||
              item.serviceUserResponseId === bookmark.targetObjectId ||
              item.meta?.id === bookmark.targetObjectId ||
              item.address === bookmark.path ||
              item.address === bookmark.canonicalUri ||
              item.meta?.canonicalUri === bookmark.path ||
              item.meta?.canonicalUri === bookmark.canonicalUri
          );
          if (!response) continue;
          return {
            ...bookmark,
            path: response.address,
            canonicalUri: response.meta?.canonicalUri ?? bookmark.canonicalUri,
            targetObjectId: bookmark.targetObjectId ?? response.id,
            meta: response.meta ?? bookmark.meta,
            referenceCode: response.meta?.code ?? bookmark.referenceCode,
          };
        }
        return bookmark;
      };
      setBookmarks(() => {
        const seen = new Set<string>();
        return result.bookmarks.map(normalizeServiceBookmark).filter((bookmark) => {
          const key = `${bookmark.type}:${Array.from(bookmarkIdentityCandidates(bookmark)).join("|")}`;
          if (seen.has(bookmark.id) || seen.has(key)) return false;
          seen.add(bookmark.id);
          seen.add(key);
          return true;
        });
      });
    } catch (error) {
      console.warn("Bookmark hydration requires loom-service.", error);
      setBookmarks([]);
    }
  }, []);

  useEffect(() => {
    void refreshServiceBookmarks();
  }, [refreshServiceBookmarks]);

  useEffect(() => {
    if (activePanel !== "bookmarks") return;
    void refreshServiceBookmarks();
  }, [activePanel, refreshServiceBookmarks]);

  useEffect(() => {
    if (getConfiguredLoomEngineMode() === "rust-service") return;
    writeRuntimeBookmarks(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    writeRuntimeMetadata(
      buildRuntimeMetadataRecord(conversations, conversationResponses)
    );
  }, [conversationResponses, conversations]);

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

  useEffect(
    () => () => {
      if (linkCopyToastTimerRef.current !== null) {
        window.clearTimeout(linkCopyToastTimerRef.current);
      }
      if (growthMilestoneToastTimerRef.current !== null) {
        window.clearTimeout(growthMilestoneToastTimerRef.current);
      }
      if (completionActionRevealFrameRef.current !== null) {
        window.cancelAnimationFrame(completionActionRevealFrameRef.current);
      }
      if (completionActionRevealTimerRef.current !== null) {
        window.clearTimeout(completionActionRevealTimerRef.current);
      }
    },
    []
  );

  function saveProviderSettings(nextSettings: AIProviderSettings) {
    setProviderSettings(nextSettings);
    writeAIProviderSettings(nextSettings);
  }

  function applyMockDataMode(enabled: boolean) {
    if (enabled) {
      const hydratedConversations = seedConversations.map((conversation) =>
        withHydratedLoomMetadata(conversation, metadataSeed)
      );
      const hydratedResponses = Object.fromEntries(
        Object.entries(seedResponsesByConversation).map(([loomId, responses]) => [
          loomId,
          responses.map((response) =>
            withHydratedResponseMetadata(loomId, response, metadataSeed)
          ),
        ])
      );
      setConversations((current) => [
        ...hydratedConversations,
        ...current.filter((conversation) => !seedConversationIds.has(conversation.id)),
      ]);
      setConversationResponses((current) => ({
        ...hydratedResponses,
        ...Object.fromEntries(
          Object.entries(current).filter(([loomId]) => !seedConversationIds.has(loomId))
        ),
      }));
      setForkRecords(mockForkRecords);
      setPinnedConversationIds(
        seedConversations
          .filter((conversation) => conversation.pinned)
          .map((conversation) => conversation.id)
      );
      setTabGroups(makeInitialTabGroups(seedConversations));
      setHistory(initialHistory);
      setComposerDrafts((current) => ({
        ...current,
        [seedConversations[0].id]: {
          html: seedComposerText,
          links: [seedComposerLink],
        },
        [EPHEMERAL_DRAFT_ID]: current[EPHEMERAL_DRAFT_ID] ?? EMPTY_COMPOSER_DRAFT,
      }));
      return;
    }

    setConversations((current) =>
      current.filter((conversation) => !seedConversationIds.has(conversation.id))
    );
    setConversationResponses((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([loomId]) => !seedConversationIds.has(loomId))
      )
    );
    setForkRecords([]);
    setPinnedConversationIds((current) =>
      current.filter((conversationId) => !seedConversationIds.has(conversationId))
    );
    setTabGroups((current) =>
      current
        .map((group) => ({
          ...group,
          conversationIds: group.conversationIds.filter(
            (conversationId) => !seedConversationIds.has(conversationId)
          ),
        }))
        .filter((group) => group.conversationIds.length > 0)
    );
    setHistory([]);
    setComposerDrafts((current) => ({
      ...Object.fromEntries(
        Object.entries(current).filter(([loomId]) => !seedConversationIds.has(loomId))
      ),
      [EPHEMERAL_DRAFT_ID]: current[EPHEMERAL_DRAFT_ID] ?? EMPTY_COMPOSER_DRAFT,
    }));
    if (seedConversationIds.has(activeConversationIdRef.current)) {
      setActiveConversationId(EPHEMERAL_DRAFT_ID);
      setActiveObjectTitle(draftNavigationDestination.title);
      const draftEntry = createHistoryEntry(
        draftNavigationDestination,
        draftResolvedNavigationDestination
      );
      setNavigationStack([draftEntry]);
      setNavigationIndex(0);
      setGraphMode(false);
      setActivePanel(null);
      writeLastActiveLoomId(null);
    }
  }

  function saveAppSettings(nextSettings: AppSettings) {
    const previousMockDataEnabled = isMockDataEnabled(appSettings);
    const nextMockDataEnabled = isMockDataEnabled(nextSettings);
    setAppSettings(nextSettings);
    writeAppSettings(nextSettings);
    if (previousMockDataEnabled !== nextMockDataEnabled) {
      applyMockDataMode(nextMockDataEnabled);
      if (!nextMockDataEnabled) {
        void refreshServiceLooms();
        void refreshServiceHistory();
        void refreshServiceBookmarks();
      }
    }
  }

  const composerRuntimeHealth = useRuntimeHealth(
    providerSettings,
    "main",
    saveProviderSettings
  );
  const mockResponsesEnabled = isMockResponseModeEnabled(providerSettings);
  const appThemeClass = `theme-${appSettings.theme}`;
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

  function canAttemptMetadataGeneration() {
    return (
      mockResponsesEnabled ||
      providerSettings.ollama.lastConnectionStatus === "connected"
    );
  }

  function queueLoomMetadataGeneration(
    conversation: Conversation,
    contextText?: string
  ) {
    const meta = conversation.meta;
    if (!meta || metadataGenerationRef.current.has(metadataKeyForLoom(conversation.id))) {
      return;
    }
    if (!canAttemptMetadataGeneration()) return;
    const metadataKey = metadataKeyForLoom(conversation.id);
    metadataGenerationRef.current.add(metadataKey);
    void generateMetadataWithQuickModel(providerSettings, {
      title: conversation.title,
      text: [metadataTextForLoom(conversation), contextText].filter(Boolean).join("\n\n"),
    })
      .then((refinement) => {
        if (!refinement) return;
        const nextTitle = normalizeLoomTitle(refinement.title || conversation.title);
        const nextSummary = refinement.summary || conversation.summary;
        setConversations((current) =>
          current.map((item) =>
            item.id === conversation.id && item.meta?.id === meta.id
              ? {
                  ...item,
                  title: nextTitle,
                  summary: nextSummary,
                  meta: applyMetadataRefinement(item.meta, {
                    ...refinement,
                    title: nextTitle,
                    summary: nextSummary,
                  }),
                }
              : item
          )
        );
        const updateLoomEntry = (entry: HistoryEntry): HistoryEntry =>
          entry.type === "conversation" && entry.path === conversation.path
            ? {
                ...entry,
                title: nextTitle,
                meta: entry.meta
                  ? applyMetadataRefinement(entry.meta, {
                      ...refinement,
                      title: nextTitle,
                      summary: nextSummary,
                    })
                  : entry.meta,
              }
            : entry;
        setNavigationStack((current) => current.map(updateLoomEntry));
        setHistory((current) => current.map(updateLoomEntry));
        if (
          activeConversationIdRef.current === conversation.id &&
          activeObjectTitleRef.current === conversation.title
        ) {
          setActiveObjectTitle(nextTitle);
        }
      })
      .catch(() => {
        // Metadata fallback already exists; model refinement is best effort only.
      })
      .finally(() => {
        metadataGenerationRef.current.delete(metadataKey);
      });
  }

  function queueResponseMetadataGeneration(loomId: string, response: ResponseItem) {
    const meta = response.meta;
    if (
      !meta ||
      meta.status !== "draft" ||
      metadataGenerationRef.current.has(metadataKeyForResponse(loomId, response.id))
    ) {
      return;
    }
    if (!canAttemptMetadataGeneration()) return;
    const metadataKey = metadataKeyForResponse(loomId, response.id);
    metadataGenerationRef.current.add(metadataKey);
    void generateMetadataWithQuickModel(providerSettings, {
      title: response.title,
      text: metadataTextForResponse(response),
    })
      .then((refinement) => {
        if (!refinement) return;
        setConversationResponses((current) => {
          const nextResponses = current[loomId]?.map((item) =>
            item.id === response.id &&
            item.meta?.id === meta.id &&
            item.meta.status === "draft"
              ? { ...item, meta: applyMetadataRefinement(item.meta, refinement) }
              : item
          );
          if (!nextResponses) return current;
          return {
            ...current,
            [loomId]: nextResponses,
          };
        });
      })
      .catch(() => {
        // Metadata fallback already exists; model refinement is best effort only.
      })
      .finally(() => {
        metadataGenerationRef.current.delete(metadataKey);
      });
  }

  function updateResponseAnswer(
    loomId: string,
    responseId: string,
    answer: string[]
  ) {
    setConversationResponses((current) => ({
      ...current,
      [loomId]: (current[loomId] ?? []).map((response) =>
        response.id === responseId ? { ...response, answer } : response
      ),
    }));
  }

  function updateResponseMarkdown(
    loomId: string,
    responseId: string,
    markdown: string
  ) {
    const sanitized = sanitizeModelAnswer(markdown);
    setConversationResponses((current) => ({
      ...current,
      [loomId]: (current[loomId] ?? []).map((response) =>
        response.id === responseId
          ? {
              ...response,
              answer: answerParagraphs(sanitized),
              finalContent: sanitized,
            }
          : response
      ),
    }));
  }

  function isLiveServiceGenerationStatus(status?: string) {
    return status === "streaming" || status === "pending" || status === "running";
  }

  function applyGenerationResponseState(state: GenerationResponseStateResult) {
    const assistant = state.assistantResponse;
    if (!assistant) return;
    const sanitized = sanitizeModelAnswer(assistant.content);
    const serviceGenerationStatus = assistant.status ?? state.status;
    setConversationResponses((current) => {
      const existingResponses = current[assistant.loomId] ?? [];
      let updated = false;
      const nextResponses = existingResponses.map((response) => {
        if (response.id !== assistant.responseId) return response;
        updated = true;
        return {
          ...response,
          answer: answerParagraphs(sanitized),
          finalContent: sanitized,
          workflowRunId: state.workflowRunId,
          serviceGenerationStatus,
          serviceUserResponseId:
            response.serviceUserResponseId ?? state.userResponse?.responseId,
          visibleProgress: isLiveServiceGenerationStatus(serviceGenerationStatus)
            ? response.visibleProgress
            : undefined,
          doneReason:
            state.status === "completed" || state.status === "truncated"
              ? response.doneReason ?? "stop"
              : response.doneReason,
          truncated: state.status === "truncated" ? true : response.truncated,
        };
      });
      if (!updated) return current;
      return {
        ...current,
        [assistant.loomId]: nextResponses,
      };
    });
    if (!isLiveServiceGenerationStatus(serviceGenerationStatus)) {
      setGeneratingResponseId((current) =>
        current === assistant.responseId ? null : current
      );
      if (mainServiceCancellationRef.current?.workflowRunId === state.workflowRunId) {
        mainServiceCancellationRef.current = null;
      }
    }
  }

  function withVisibleProgress(
    response: ResponseItem,
    visibleProgress: VisibleAnswerProgress | undefined
  ): ResponseItem {
    if (visibleProgress) return { ...response, visibleProgress };
    const { visibleProgress: _discard, ...rest } = response;
    return rest;
  }

  function withVisiblePlan(
    response: ResponseItem,
    visiblePlan: VisibleAnswerPlan | undefined
  ): ResponseItem {
    if (visiblePlan) return { ...response, visiblePlan };
    const { visiblePlan: _discard, ...rest } = response;
    return rest;
  }

  function updateResponseVisibleProgress(
    loomId: string,
    responseId: string,
    visibleProgress: VisibleAnswerProgress | undefined
  ) {
    setConversationResponses((current) => ({
      ...current,
      [loomId]: (current[loomId] ?? []).map((response) =>
        response.id === responseId ? withVisibleProgress(response, visibleProgress) : response
      ),
    }));
  }

  function updateResponseVisiblePlanAndProgress(
    loomId: string,
    responseId: string,
    visiblePlan: VisibleAnswerPlan | undefined,
    visibleProgress: VisibleAnswerProgress | undefined
  ) {
    setConversationResponses((current) => ({
      ...current,
      [loomId]: (current[loomId] ?? []).map((response) =>
        response.id === responseId
          ? withVisibleProgress(withVisiblePlan(response, visiblePlan), visibleProgress)
          : response
      ),
    }));
  }

  function updateResponseThinking(
    loomId: string,
    responseId: string,
    progress: ModelExecutionProgress
  ) {
    setConversationResponses((current) => ({
      ...current,
      [loomId]: (current[loomId] ?? []).map((response) => {
        if (response.id !== responseId) return response;
        const thinkingStartedAt =
          response.thinkingStartedAt && progress.thinkingStartedAt && !progress.thinkingEndedAt
            ? response.thinkingStartedAt
            : progress.thinkingStartedAt ?? response.thinkingStartedAt;
        const finalStartedAt = response.finalStartedAt ?? progress.finalStartedAt;
        const shouldEndThinking = Boolean(
          progress.thinkingEndedAt ||
            progress.done ||
            progress.finalStartedAt ||
            progress.finalContent?.trim()
        );
        const thinkingEndedAt =
          progress.thinkingEndedAt ??
          (shouldEndThinking && thinkingStartedAt
            ? response.thinkingEndedAt ?? new Date().toISOString()
            : response.thinkingEndedAt);
        const computedElapsedThinkingSeconds =
          thinkingStartedAt && thinkingEndedAt
            ? Math.max(
                0,
                Math.round(
                  (Date.parse(thinkingEndedAt) - Date.parse(thinkingStartedAt)) / 1000
                )
              )
            : undefined;
        const elapsedThinkingSeconds =
          response.thinkingEndedAt || thinkingEndedAt
            ? response.elapsedThinkingSeconds ??
              progress.elapsedThinkingSeconds ??
              computedElapsedThinkingSeconds
            : progress.elapsedThinkingSeconds ?? response.elapsedThinkingSeconds;
        return {
          ...response,
          finalContent: progress.finalContent ?? response.finalContent,
          thinkingStartedAt,
          thinkingEndedAt,
          finalStartedAt,
          elapsedThinkingSeconds,
          thinkingTimeoutMs: progress.thinkingTimeoutMs ?? response.thinkingTimeoutMs,
          doneReason: progress.doneReason ?? response.doneReason,
          truncated: progress.truncated ?? response.truncated,
          outputBudget: progress.outputBudget ?? response.outputBudget,
          numPredict: progress.numPredict ?? response.numPredict,
          thinkingStalled: progress.thinkingStalled ?? response.thinkingStalled,
          thinkingStallReason:
            progress.thinkingStallReason ?? response.thinkingStallReason,
          thinkingTokenCount:
            progress.thinkingTokenCount !== undefined
              ? progress.thinkingTokenCount
              : response.thinkingTokenCount,
        };
      }),
    }));
  }

  function showResponseCompletionActions(responseId: string) {
    setGeneratingResponseId((current) => (current === responseId ? null : current));
    if (completionActionRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(completionActionRevealFrameRef.current);
      completionActionRevealFrameRef.current = null;
    }
    if (completionActionRevealTimerRef.current !== null) {
      window.clearTimeout(completionActionRevealTimerRef.current);
      completionActionRevealTimerRef.current = null;
    }
    setCompletionActionRevealResponseId(null);
    completionActionRevealFrameRef.current = window.requestAnimationFrame(() => {
      completionActionRevealFrameRef.current = null;
      setCompletionActionRevealResponseId(responseId);
      completionActionRevealTimerRef.current = window.setTimeout(() => {
        completionActionRevealTimerRef.current = null;
        setCompletionActionRevealResponseId((current) =>
          current === responseId ? null : current
        );
      }, 900);
    });
  }

  function delay(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function revealResponseAnswer(
    loomId: string,
    responseId: string,
    answer: string[],
    generationId: number
  ) {
    const fullText = answer.join("\n\n");
    const parts = fullText.match(/\S+\s*/g) ?? [fullText];
    let visible = "";
    for (const part of parts) {
      if (mainGenerationRef.current !== generationId) {
        updateResponseAnswer(
          loomId,
          responseId,
          answerParagraphs(completeOpenMarkdownCodeFence(visible))
        );
        return false;
      }
      visible += part;
      updateResponseAnswer(loomId, responseId, answerParagraphs(visible));
      await delay(18);
    }
    if (mainGenerationRef.current !== generationId) {
      updateResponseAnswer(
        loomId,
        responseId,
        answerParagraphs(completeOpenMarkdownCodeFence(visible))
      );
      return false;
    }
    updateResponseAnswer(loomId, responseId, answer);
    return true;
  }

  function stopMainResponse() {
    mainGenerationRef.current += 1;
    const serviceCancellation = mainServiceCancellationRef.current;
    if (
      serviceCancellation?.workflowRunId &&
      !serviceCancellation.cancelRequested
    ) {
      serviceCancellation.cancelRequested = true;
      void loomEngineClient
        .cancelMessage({
          loomId: serviceCancellation.loomId,
          responseId: serviceCancellation.responseId,
          workflowRunId: serviceCancellation.workflowRunId,
          reason: "user_stopped_main_composer",
        })
        .catch((error) => {
          if (import.meta.env.DEV) {
            console.warn("[LoomEngine] Service generation cancel request failed.", error);
          }
        });
    }
    mainAbortRef.current?.abort();
    mainAbortRef.current = null;
    const revealTarget = mainRevealTargetRef.current;
    if (revealTarget) {
      setConversationResponses((current) => ({
        ...current,
        [revealTarget.loomId]: (current[revealTarget.loomId] ?? []).map((response) =>
          response.id === revealTarget.responseId
            ? {
                ...response,
                answer: answerParagraphs(
                  completeOpenMarkdownCodeFence(response.answer.join("\n\n"))
                ),
                thinkingEndedAt:
                  response.thinkingStartedAt && !response.thinkingEndedAt
                    ? new Date().toISOString()
                    : response.thinkingEndedAt,
                visiblePlan: undefined,
                visibleProgress: undefined,
              }
            : response
        ),
      }));
    }
    mainServiceCancellationRef.current = null;
    mainRevealTargetRef.current = null;
    currentMainRequestRef.current = null;
    thinkingAutoAnswerResponseRef.current = null;
    if (revealTarget) showResponseCompletionActions(revealTarget.responseId);
    setComposerRuntimeState({ running: false, message: "Response stopped." });
  }

  function runtimeStateForComposer(draftKey: string) {
    if (composerRuntimeTargetKey !== draftKey) {
      return { running: false, message: null };
    }
    return composerRuntimeState;
  }

  function maybeAutoAnswerNow(responseId: string, progress: ModelExecutionProgress) {
    const request = currentMainRequestRef.current;
    const currentResponse = request
      ? conversationResponsesRef.current[request.loomId]?.find(
          (response) => response.id === responseId
        )
      : undefined;
    const hasFinalContentStarted = Boolean(
      progress.finalStartedAt ||
        progress.finalContent?.trim() ||
        currentResponse?.finalStartedAt ||
        currentResponse?.finalContent?.trim() ||
        currentResponse?.answer.join("\n\n").trim()
    );
    if (
      !request ||
      request.responseId !== responseId ||
      request.mode !== "thinking" ||
      thinkingAutoAnswerResponseRef.current === responseId ||
      hasFinalContentStarted
    ) {
      return;
    }
    const thinkingStartedAt = progress.thinkingStartedAt
      ? Date.parse(progress.thinkingStartedAt)
      : undefined;
    const elapsedMs = thinkingStartedAt ? Math.max(0, Date.now() - thinkingStartedAt) : 0;
    if (
      isSimpleAutoAnswerCandidate({
        promptText: request.prompt,
        referenceCount: request.referenceCount,
        resolvedNumCtx: request.resolvedNumCtx,
        elapsedMs,
        finalContentStarted: hasFinalContentStarted,
        thinkingStalled: Boolean(progress.thinkingStalled),
      })
    ) {
      thinkingAutoAnswerResponseRef.current = responseId;
      setComposerRuntimeState({
        running: true,
        message: "Switching to instant answer...",
      });
      window.setTimeout(() => {
        void answerNowFromThinking(responseId);
      }, 0);
    }
  }

  async function answerNowFromThinking(responseId: string) {
    const currentRequest = currentMainRequestRef.current;
    if (!currentRequest || currentRequest.responseId !== responseId) return;
    const currentResponse = conversationResponsesRef.current[currentRequest.loomId]?.find(
      (response) => response.id === responseId
    );
    const hasFinalContentStarted = Boolean(
      currentResponse?.finalStartedAt ||
        currentResponse?.finalContent?.trim() ||
        currentResponse?.answer.join("\n\n").trim()
    );
    if (hasFinalContentStarted) {
      thinkingAutoAnswerResponseRef.current = null;
      return;
    }
    thinkingGuardRetryResponseRef.current = responseId;
    currentRequest.controller.abort();

    const generationId = mainGenerationRef.current + 1;
    mainGenerationRef.current = generationId;
    const controller = new AbortController();
    mainAbortRef.current = controller;
    currentMainRequestRef.current = {
      ...currentRequest,
      mode: "instant",
      think: false,
      controller,
    };
    mainRevealTargetRef.current = {
      loomId: currentRequest.loomId,
      responseId,
    };
    let answerNowProgress = createVisibleAnswerProgressFromStatus(
      "Answering now without Thinking...",
      "generation"
    );
    setComposerRuntimeState({ running: true, message: "Answering now without Thinking..." });
    setConversationResponses((current) => ({
      ...current,
      [currentRequest.loomId]: (current[currentRequest.loomId] ?? []).map((response) =>
        response.id === responseId
          ? {
              ...response,
              thinkingGuardTimedOut: false,
              thinkingStalled: false,
              thinkingStallReason: undefined,
              thinkingStopped: false,
              thinkingEndedAt: response.thinkingEndedAt ?? new Date().toISOString(),
              answer: [""],
              finalContent: "",
              finalStartedAt: undefined,
              doneReason: undefined,
              truncated: false,
              visibleProgress: answerNowProgress,
            }
          : response
      ),
    }));

    try {
      const result = await runModelProfileRequest(providerSettings, {
        profile: "main",
        effort: currentRequest.effort,
        mode: "instant",
        think: false,
        outputBudget: currentRequest.outputBudget,
        numPredict: currentRequest.numPredict,
        referenceCount: currentRequest.referenceCount,
        referenceCharCount: currentRequest.referenceCharCount,
        messageCount: currentRequest.messageCount,
        signal: controller.signal,
        prompt: currentRequest.prompt,
        context: currentRequest.context,
        system: currentRequest.system,
        onProgress: (progress) => {
          if (mainGenerationRef.current !== generationId) return;
          updateResponseThinking(currentRequest.loomId, responseId, progress);
          if (progress.finalContent !== undefined) {
            const finalContentStarted = Boolean(
              progress.finalStartedAt || progress.finalContent.trim()
            );
            if (finalContentStarted && answerNowProgress.statusText !== "Writing final response...") {
              updateResponseVisibleProgress(currentRequest.loomId, responseId, undefined);
            }
            updateResponseMarkdown(currentRequest.loomId, responseId, progress.finalContent);
          }
        },
      });
      const answer = answerParagraphs(sanitizeModelAnswer(result.text));
      updateResponseVisibleProgress(currentRequest.loomId, responseId, undefined);
      updateResponseAnswer(currentRequest.loomId, responseId, answer);
      updateResponseThinking(currentRequest.loomId, responseId, {
        finalContent: result.finalContent,
        thinkingStartedAt: result.thinkingStartedAt,
        thinkingEndedAt: result.thinkingEndedAt,
        finalStartedAt: result.finalStartedAt,
        elapsedThinkingSeconds: result.elapsedThinkingSeconds,
        thinkingTimeoutMs: result.thinkingTimeoutMs,
        doneReason: result.doneReason,
        truncated: result.truncated,
        outputBudget: result.outputBudget,
        numPredict: result.numPredict,
        thinkingStalled: result.thinkingStalled,
        thinkingStallReason: result.thinkingStallReason,
        done: true,
      });
      const completedResponse =
        conversationResponses[currentRequest.loomId]?.find((response) => response.id === responseId);
      if (completedResponse) {
        queueResponseMetadataGeneration(currentRequest.loomId, {
          ...completedResponse,
          answer,
        });
      }
      setComposerRuntimeState({
        running: false,
        message: `Main model responded with ${result.modelId}.`,
      });
      showResponseCompletionActions(responseId);
    } catch (error) {
      if (!controller.signal.aborted) {
        markRuntimeUnavailableFromError(error);
        setComposerRuntimeState({
          running: false,
          message: providerErrorMessage(error),
        });
        updateResponseVisibleProgress(currentRequest.loomId, responseId, undefined);
      }
    } finally {
      if (mainAbortRef.current === controller) mainAbortRef.current = null;
      if (currentMainRequestRef.current?.responseId === responseId) {
        currentMainRequestRef.current = null;
      }
      if (thinkingGuardRetryResponseRef.current === responseId) {
        thinkingGuardRetryResponseRef.current = null;
      }
      if (thinkingAutoAnswerResponseRef.current === responseId) {
        thinkingAutoAnswerResponseRef.current = null;
      }
      mainRevealTargetRef.current = null;
    }
  }

  function continueThinkingResponse(responseId: string) {
    const request = currentMainRequestRef.current;
    if (!request || request.responseId !== responseId) return;
    setConversationResponses((current) => ({
      ...current,
      [request.loomId]: (current[request.loomId] ?? []).map((response) =>
        response.id === responseId && (response.thinkingContinueCount ?? 0) < 2
          ? {
              ...response,
              thinkingGuardTimedOut: false,
              thinkingStalled: false,
              thinkingStallReason: undefined,
              thinkingContinueCount: (response.thinkingContinueCount ?? 0) + 1,
            }
          : response
      ),
    }));
  }

  function stopThinkingResponse(responseId: string) {
    const request = currentMainRequestRef.current;
    if (!request || request.responseId !== responseId) return;
    stopMainResponse();
    setConversationResponses((current) => ({
      ...current,
      [request.loomId]: (current[request.loomId] ?? []).map((response) =>
        response.id === responseId
          ? {
              ...response,
              thinkingStopped: true,
              thinkingGuardTimedOut: false,
              thinkingStalled: false,
              thinkingEndedAt: response.thinkingEndedAt ?? new Date().toISOString(),
            }
          : response
      ),
    }));
  }

  async function continueTruncatedResponse(responseId: string) {
    if (composerRuntimeState.running) return;
    const match = Object.entries(conversationResponsesRef.current).reduce<{
      loomId: string;
      response: ResponseItem;
    } | null>((found, [loomId, responses]) => {
      if (found) return found;
      const response = responses.find((item) => item.id === responseId);
      return response ? { loomId, response } : null;
    }, null);
    if (!match) return;

    const previousAnswer = match.response.answer.join("\n\n").trim();
    if (!previousAnswer) return;

    const generationId = mainGenerationRef.current + 1;
    mainGenerationRef.current = generationId;
    const controller = new AbortController();
    mainAbortRef.current = controller;
    mainRevealTargetRef.current = { loomId: match.loomId, responseId };
    currentMainRequestRef.current = {
      loomId: match.loomId,
      responseId,
      prompt: match.response.question,
      context: [],
      system:
        "You are Loom AI. Continue the previous answer without restarting. Do not include raw thinking.",
      effort: "Medium",
      mode: "auto",
      think: false,
      outputBudget: "long",
      numPredict: 2048,
      referenceCount: match.response.questionReferences?.length ?? 0,
      referenceCharCount: 0,
      messageCount: 2,
      resolvedNumCtx: 2048,
      controller,
    };
    setGeneratingResponseId(responseId);
    setCompletionActionRevealResponseId(null);
    let continuationProgress = createVisibleAnswerProgressFromStatus(
      "Continuing response...",
      "generation"
    );
    setComposerRuntimeState({ running: true, message: "Continuing response..." });
    setConversationResponses((current) => ({
      ...current,
      [match.loomId]: (current[match.loomId] ?? []).map((response) =>
        response.id === responseId
          ? {
              ...response,
              truncated: false,
              doneReason: undefined,
              visibleProgress: continuationProgress,
            }
          : response
      ),
    }));

    const previousTail = previousAnswer.slice(-2000);
    const continuationPrompt = [
      "Continue the previous answer from where it stopped. Do not restart. Continue in the same language and style.",
      `Original user prompt:\n${match.response.question}`,
      `Previous answer tail:\n${previousTail}`,
    ].join("\n\n");

    try {
      const result = await runModelProfileRequest(providerSettings, {
        profile: "main",
        effort: "Medium",
        mode: "auto",
        think: false,
        outputBudget: "long",
        numPredict: 2048,
        referenceCount: match.response.questionReferences?.length ?? 0,
        referenceCharCount: 0,
        messageCount: 2,
        signal: controller.signal,
        system:
          "You are Loom AI. Continue the previous answer without restarting. Do not include raw thinking.",
        prompt: continuationPrompt,
        onProgress: (progress) => {
          if (mainGenerationRef.current !== generationId) return;
          const finalContentStarted = Boolean(
            progress.finalStartedAt || progress.finalContent?.trim()
          );
          if (finalContentStarted && continuationProgress.statusText !== "Writing final response...") {
            updateResponseVisibleProgress(match.loomId, responseId, undefined);
          }
          const combined = [previousAnswer, sanitizeModelAnswer(progress.finalContent ?? "")]
            .filter(Boolean)
            .join("\n\n");
          updateResponseAnswer(match.loomId, responseId, answerParagraphs(combined));
        },
      });
      if (mainGenerationRef.current !== generationId) return;
      const combined = [previousAnswer, sanitizeModelAnswer(result.text)].filter(Boolean).join("\n\n");
      const answer = answerParagraphs(combined);
      setConversationResponses((current) => ({
        ...current,
        [match.loomId]: (current[match.loomId] ?? []).map((response) =>
          response.id === responseId
            ? {
                ...response,
                answer,
                finalContent: combined,
                doneReason: result.doneReason,
                truncated: result.truncated,
                outputBudget: result.outputBudget,
                numPredict: result.numPredict,
                visibleProgress: undefined,
              }
            : response
        ),
      }));
      setComposerRuntimeState({
        running: false,
        message: `Main model continued with ${result.modelId}.`,
      });
      showResponseCompletionActions(responseId);
    } catch (error) {
      if (!controller.signal.aborted) {
        markRuntimeUnavailableFromError(error);
        setComposerRuntimeState({
          running: false,
          message: providerErrorMessage(error),
        });
        updateResponseVisibleProgress(match.loomId, responseId, undefined);
        showResponseCompletionActions(responseId);
      }
    } finally {
      if (mainAbortRef.current === controller) mainAbortRef.current = null;
      if (currentMainRequestRef.current?.responseId === responseId) {
        currentMainRequestRef.current = null;
      }
      mainRevealTargetRef.current = null;
      setGeneratingResponseId((current) => (current === responseId ? null : current));
    }
  }

  function plainTextFromDraft(draft: ComposerDraft) {
    return textFromComposerHtml(draft.html, false);
  }

  function promptTextFromDraft(draft: ComposerDraft) {
    return textFromComposerHtml(draft.html, true);
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

  function sanitizeModelAnswer(value: string) {
    let sanitized = value.trimStart();
    for (let index = 0; index < 2; index += 1) {
      const next = sanitized.replace(
        /^\s*(?:[*_`~\s]*)?(?:(?:Cep|Kaynak|Context|Response)\s+)?(?:Kapsülü|Capsule)(?:\s+[A-Z]-[A-Z0-9]+)?\s*[:：-]\s*/i,
        ""
      );
      if (next === sanitized) break;
      sanitized = next.trimStart();
    }
    return sanitized;
  }

  function completeOpenMarkdownCodeFence(value: string) {
    const fenceCount = value
      .split("\n")
      .filter((line) => line.trimStart().startsWith("```")).length;
    if (fenceCount % 2 === 0) return value;
    return `${value.replace(/\s*$/, "")}\n\`\`\``;
  }

  function providerErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "The selected model provider failed.";
    const kind =
      typeof error === "object" && error !== null && "kind" in error
        ? String((error as { kind?: unknown }).kind)
        : undefined;
    if (kind === "request_aborted") return "Request cancelled.";
    if (kind === "timeout") {
      return "loom-service timed out while opening the model stream. Check the service/provider status and retry.";
    }
    if (kind === "provider_unavailable") {
      return message || "The selected provider is unavailable. Check the provider and retry.";
    }
    if (kind === "model_missing") {
      return message || "The selected model is not available. Choose another model and retry.";
    }
    if (kind === "invalid_config") {
      return message || "Provider configuration is invalid. Check Settings and retry.";
    }
    if (
      message.includes("loom-service is not reachable") ||
      message.includes("service down") ||
      message.includes("service_unavailable")
    ) {
      return "loom-service is unavailable. Start loom-service and retry.";
    }
    return message;
  }

  function markRuntimeUnavailableFromError(error: unknown) {
    if (!(error instanceof ModelProviderError)) return;
    if (
      ![
        "runtime_unavailable",
        "provider_unavailable",
        "tags_unavailable",
        "probe_timeout",
      ].includes(error.code)
    ) {
      return;
    }
    const checkedAt = new Date().toISOString();
    const nextSettings: AIProviderSettings = {
      ...providerSettings,
      ollama: {
        ...providerSettings.ollama,
        lastConnectionStatus: "offline",
        lastCheckedAt: checkedAt,
      },
    };
    saveProviderSettings(nextSettings);
  }

  function splitAnswerParagraphs(answer: string) {
    return answer
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
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

  function findResponseRecord(link: Pick<LoomLink, "id" | "path">) {
    for (const [loomId, responses] of Object.entries(conversationResponses)) {
      const response =
        responses.find((item) => item.address === link.path) ??
        responses.find((item) => item.id === link.id);
      if (!response) continue;
      const conversation =
        conversations.find((item) => item.id === loomId) ??
        (draftConversation?.id === loomId ? draftConversation : undefined);
      if (!conversation) continue;
      return {
        loomId,
        conversation,
        response,
      };
    }
    return undefined;
  }

  function promoteResponseLink(link: LoomLink) {
    if (link.type !== "response") return link;
    const located = findResponseRecord(link);
    if (!located) return link;

    const responseObjectId = runtimeGraphObjectIdFor(
      "response",
      `${located.loomId}_${located.response.id}`
    );
    const promotedMeta = promoteResponseMetadata({
      response: {
        ...located.response,
        title:
          responseTitleOverrides[located.response.id] ?? located.response.title,
      },
      loom: located.conversation,
    });
    const responseUrl = promotedMeta.canonicalUri ?? located.response.address;
    if (located.response.address !== responseUrl) {
      loomGraphRepository.registerAliasUri({
        aliasUri: located.response.address,
        targetObjectId: responseObjectId,
        replacementAliasUri: responseUrl,
      });
      loomGraphRepository.registerAliasUri({
        aliasUri: responseUrl,
        targetObjectId: responseObjectId,
      });
    }
    setConversationResponses((current) => ({
      ...current,
      [located.loomId]: (current[located.loomId] ?? []).map((item) =>
        item.id === located.response.id
          ? {
              ...item,
              address: responseUrl,
              meta: promotedMeta,
            }
          : item
      ),
    }));
    setBookmarks((current) =>
      current.map((bookmark) =>
        bookmark.targetObjectId === responseObjectId
          ? { ...bookmark, meta: promotedMeta }
          : bookmark
      )
    );
    return {
      ...link,
      title: responseTitleOverrides[located.response.id] ?? located.response.title,
      path: responseUrl,
      targetObjectId: responseObjectId,
      canonicalUri: responseUrl,
      meta: promotedMeta,
      referenceCode: promotedMeta.code,
      sourceLoomId: located.loomId,
      sourceResponseId: located.response.id,
      sourceCanonicalUri: responseUrl,
    };
  }

  function isDestinationBookmarked(destination: LoomLink) {
    const destinationResolution = resolveLoomAddress(destination.path, loomGraphRepository);
    const destinationObjectId =
      destinationResolution.status === "resolved"
        ? (destinationResolution.targetObject ?? destinationResolution.object)?.objectId
        : destination.targetObjectId;
    const destinationCandidates = linkIdentityCandidates(destination);
    return bookmarks.some((bookmark) => {
      const bookmarkCandidates = bookmarkIdentityCandidates(bookmark);
      if (
        Array.from(bookmarkCandidates).some((candidate) =>
          destinationCandidates.has(candidate)
        )
      ) {
        return true;
      }
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
    const temporary = temporaryWefts[loomId];
    if (temporary) {
      return {
        originLoomId: temporary.originLoomId,
        originResponseId: temporary.originResponseId,
      };
    }
    const record = forkRecords.find((item) => item.childConversationId === loomId);
    return record
      ? {
          originLoomId: record.parentConversationId,
          originResponseId: record.parentResponseId,
        }
      : undefined;
  }

  function findLoomByPath(path: string) {
    return conversations.find(
      (item) =>
        path === item.path ||
        path.startsWith(`${item.path}/`) ||
        path === item.meta?.canonicalUri
    );
  }

  function findResponseInLoom(loomId: string, responseId?: string) {
    if (!responseId) return undefined;
    return (conversationResponses[loomId] ?? []).find((response) => response.id === responseId);
  }

  function findResponseByPath(loomId: string, path: string) {
    return (conversationResponses[loomId] ?? []).find(
      (response) =>
        response.address === path ||
        response.meta?.canonicalUri === path ||
        seedResponsesByConversation[loomId]?.some(
          (seedResponse) =>
            seedResponse.id === response.id && seedResponse.address === path
        )
    );
  }

  function findReferenceTargetResponse(link: LoomLink) {
    if (link.sourceLoomId && link.sourceResponseId) {
      const sourceResponse = findResponseInLoom(link.sourceLoomId, link.sourceResponseId);
      if (sourceResponse) return { loomId: link.sourceLoomId, response: sourceResponse };
    }

    const codeBlockCandidates = new Set(
      [
        link.targetKind === "code_block" ? link.targetObjectId : undefined,
        link.targetKind === "code_block" ? link.id : undefined,
      ].filter((candidate): candidate is string => Boolean(candidate))
    );
    const responseCodeCandidates = new Set(
      [
        link.sourceResponseCode,
        link.referenceCode,
      ].filter((candidate): candidate is string => Boolean(candidate))
    );

    if (codeBlockCandidates.size === 0 && responseCodeCandidates.size === 0) {
      return null;
    }

    for (const [loomId, responses] of Object.entries(conversationResponses)) {
      for (const response of responses) {
        const hasCodeBlockTarget = (response.codeBlocks ?? []).some((codeBlock) =>
          codeBlock.codeBlockId ? codeBlockCandidates.has(codeBlock.codeBlockId) : false
        );
        const hasResponseCodeTarget = [
          response.meta?.code,
          response.meta?.displayCode,
        ].some((code) => code ? responseCodeCandidates.has(code) : false);
        if (hasCodeBlockTarget || hasResponseCodeTarget) {
          return { loomId, response };
        }
      }
    }

    return null;
  }

  function destinationAddressCandidates(
    destination: LoomLink | AddressSuggestion | HistoryEntry
  ) {
    return new Set(
      [
        destination.path,
        destination.canonicalUri,
        destination.meta?.canonicalUri,
      ].filter((value): value is string => Boolean(value))
    );
  }

  function bookmarkIdentityCandidates(bookmark: BookmarkItem) {
    return new Set(
      [
        bookmark.path,
        bookmark.canonicalUri,
        bookmark.targetObjectId,
        bookmark.sourceResponseId,
        bookmark.sourceCanonicalUri,
        bookmark.meta?.id,
        bookmark.meta?.canonicalUri,
      ].filter((value): value is string => Boolean(value))
    );
  }

  function linkIdentityCandidates(link: LoomLink) {
    return new Set(
      [
        link.id,
        link.path,
        link.canonicalUri,
        link.targetObjectId,
        link.sourceResponseId,
        link.sourceCanonicalUri,
        responseIdFromReferenceAddress(link.path),
        responseIdFromReferenceAddress(link.canonicalUri),
        responseIdFromReferenceAddress(link.sourceCanonicalUri),
        link.meta?.id,
        link.meta?.canonicalUri,
        responseIdFromReferenceAddress(link.meta?.canonicalUri),
      ].filter((value): value is string => Boolean(value))
    );
  }

  function findLocalResponseTarget(
    destination: LoomLink | AddressSuggestion | HistoryEntry
  ) {
    const addresses = destinationAddressCandidates(destination);
    const identityCandidates = linkIdentityCandidates(destination);
    for (const [loomId, responses] of Object.entries(conversationResponses)) {
      for (const response of responses) {
        const targetObjectId = runtimeGraphObjectIdFor(
          "response",
          `${loomId}_${response.id}`
        );
        const responseCandidates = responseIdentityCandidates(loomId, response);
        const seedResponse = seedResponsesByConversation[loomId]?.find(
          (item) => item.id === response.id
        );
        const matchesIdentity =
          destination.id === response.id ||
          destination.id === response.serviceUserResponseId ||
          destination.id === response.meta?.id ||
          destination.id === targetObjectId ||
          destination.targetObjectId === targetObjectId ||
          Array.from(identityCandidates).some((candidate) =>
            responseCandidates.has(candidate)
          );
        const matchesAddress =
          addresses.has(response.address) ||
          addresses.has(response.meta?.canonicalUri ?? "") ||
          addresses.has(seedResponse?.address ?? "");

        if (!matchesIdentity && !matchesAddress) continue;
        const loom = conversations.find((conversation) => conversation.id === loomId);
        if (loom) return { loom, response };
      }
    }
    return undefined;
  }

  function findLocalLoomTarget(
    destination: LoomLink | AddressSuggestion | HistoryEntry
  ) {
    const addresses = destinationAddressCandidates(destination);
    return conversations.find((conversation) => {
      const targetObjectId = runtimeGraphObjectIdFor("conversation", conversation.id);
      return (
        destination.id === conversation.id ||
        destination.id === targetObjectId ||
        destination.targetObjectId === targetObjectId ||
        addresses.has(conversation.path) ||
        addresses.has(conversation.meta?.canonicalUri ?? "") ||
        Array.from(addresses).some((address) =>
          address.startsWith(`${conversation.path}/`)
        )
      );
    });
  }

  function hasLocalNavigationTarget(
    destination: LoomLink | AddressSuggestion | HistoryEntry
  ) {
    return Boolean(findLocalResponseTarget(destination) ?? findLocalLoomTarget(destination));
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
      canonicalUri: loom?.meta?.canonicalUri,
      meta: loom?.meta,
    };
  }

  function responseLinkForNavigation(
    loomId: string,
    response: ResponseItem,
    badge = typeLabel.response
  ): LoomLink {
    const responseConversation =
      conversations.find((conversation) => conversation.id === loomId) ??
      archived.find((conversation) => conversation.id === loomId) ??
      (draftConversation?.id === loomId ? draftConversation : undefined);
    const responseUrl = responseConversation
      ? responseAddressForConversation(responseConversation, response)
      : response.meta?.canonicalUri ?? response.address;
    return {
      id: response.id,
      type: "response",
      title: responseTitleOverrides[response.id] ?? response.title,
      path: responseUrl,
      badge,
      targetObjectId: runtimeGraphObjectIdFor("response", `${loomId}_${response.id}`),
      canonicalUri: responseUrl,
      meta: response.meta,
      referenceCode: response.meta?.code,
      sourceLoomId: loomId,
      sourceResponseId: response.id,
      sourceCanonicalUri: responseUrl,
    };
  }

  function responseCapsuleKey(loomId: string, responseId: string) {
    return `${loomId}:${responseId}`;
  }

  function responseCapsuleForContext(loomId: string, response: ResponseItem) {
    return (
      responseContextCapsules[responseCapsuleKey(loomId, response.id)] ??
      createHeuristicResponseContextCapsule(response, loomId)
    );
  }

  function loomContextReferenceForLink(link: LoomLink): LoomContextReference {
    if (link.type === "fragment" && link.sourceLoomId && link.sourceResponseId) {
      const sourceResponse = findResponseInLoom(link.sourceLoomId, link.sourceResponseId);
      if (!sourceResponse) return { link };
      return {
        link,
        targetResponse: sourceResponse,
        targetLoomId: link.sourceLoomId,
        capsule: createHeuristicResponseContextCapsule(
          sourceResponse,
          link.sourceLoomId,
          link.selectedText
        ),
      };
    }
    const target = findLocalResponseTarget(link);
    if (!target) return { link };
    return {
      link,
      targetResponse: target.response,
      targetLoomId: target.loom.id,
      capsule: responseCapsuleForContext(target.loom.id, target.response),
    };
  }

  function enrichDestinationMetadata<T extends LoomLink | HistoryEntry>(destination: T): T {
    const existingCanonicalUri = destination.canonicalUri ?? destination.meta?.canonicalUri;
    if (destination.referenceCode || destination.meta?.code) {
      return destination.path.startsWith("loom://drafts/") && existingCanonicalUri
        ? { ...destination, path: existingCanonicalUri, canonicalUri: existingCanonicalUri }
        : destination;
    }
    const responseTarget = findLocalResponseTarget(destination);
    if (responseTarget?.response.meta) {
      const canonicalUri =
        destination.canonicalUri ??
        destination.meta?.canonicalUri ??
        responseTarget.response.meta.canonicalUri;
      return {
        ...destination,
        path:
          destination.path.startsWith("loom://drafts/") && canonicalUri
            ? canonicalUri
            : destination.path,
        targetObjectId:
          destination.targetObjectId ??
          runtimeGraphObjectIdFor(
            "response",
            `${responseTarget.loom.id}_${responseTarget.response.id}`
          ),
        canonicalUri,
        meta: responseTarget.response.meta,
        referenceCode: responseTarget.response.meta.code,
      };
    }
    const loomTarget = findLocalLoomTarget(destination);
    if (loomTarget?.meta) {
      const canonicalUri =
        destination.canonicalUri ?? destination.meta?.canonicalUri ?? loomTarget.meta.canonicalUri;
      return {
        ...destination,
        path:
          destination.path.startsWith("loom://drafts/") && canonicalUri
            ? canonicalUri
            : destination.path,
        targetObjectId:
          destination.targetObjectId ??
          runtimeGraphObjectIdFor("conversation", loomTarget.id),
        canonicalUri,
        meta: loomTarget.meta,
        referenceCode: loomTarget.meta.code,
      };
    }
    return destination;
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

  function normalizeStoredNavigationDestination(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    navigationDestination: LoomNavigationDestination,
    source: LoomNavigationDestination["source"]
  ): LoomNavigationDestination {
    const next: LoomNavigationDestination = { ...navigationDestination, source };
    if (next.scrollTargetResponseId) {
      const responses = conversationResponses[next.loomId];
      const targetStillVisible = responses?.some(
        (response) => response.id === next.scrollTargetResponseId
      );
      if (responses && !targetStillVisible) {
        const latest = responses[responses.length - 1];
        return {
          ...next,
          scrollTargetResponseId: latest?.id,
          scrollMode: latest ? "lastResponse" : undefined,
        };
      }
    }
    if (next.scrollMode || next.scrollTargetResponseId) return next;
    const responseTarget = findLocalResponseTarget(destination);
    if (responseTarget) {
      return {
        ...next,
        loomId: responseTarget.loom.id,
        scrollTargetResponseId: responseTarget.response.id,
        scrollMode: "exact",
      };
    }
    const loom = findLocalLoomTarget(destination) ?? findLoomByPath(destination.path);
    if (loom && loom.id !== EPHEMERAL_DRAFT_ID) {
      return {
        ...next,
        loomId: loom.id,
        scrollMode: "lastResponse",
      };
    }
    return next;
  }

  function navigationDestinationForLink(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    source: LoomNavigationDestination["source"],
    overrides: Partial<LoomNavigationDestination> = {}
  ): LoomNavigationDestination {
    const responseTarget = findLocalResponseTarget(destination);
    const loom =
      responseTarget?.loom ??
      findLocalLoomTarget(destination) ??
      findLoomByPath(destination.path);
    const loomId = overrides.loomId ?? responseTarget?.loom.id ?? loom?.id ?? destination.id;
    const response =
      responseTarget?.response ??
      (loom ? findResponseByPath(loom.id, destination.path) : undefined);
    const origin = getWeftOrigin(loomId);
    const visibleSplitPanel = visibleSplitPanelForLoomId(loomId);
    const mode = overrides.mode ?? (visibleSplitPanel ? "split" : "full");
    const scrollTargetResponseId =
      overrides.scrollTargetResponseId ?? response?.id ?? undefined;
    const scrollMode =
      overrides.scrollMode ??
      (response ? "exact" : loom && loom.id !== EPHEMERAL_DRAFT_ID ? "lastResponse" : undefined);

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
        setAddressSuggestionsVisible(false);
        setSelectedSuggestion(-1);
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
        if (
          addressFocused &&
          addressBarRef.current?.contains(event.target as Node | null)
        ) {
          return;
        }
        setAddressFocused(false);
        setAddressQuery("");
        setAddressFeedback(null);
        setAddressSuggestionsVisible(false);
        setSelectedSuggestion(-1);
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

  useEffect(() => {
    function handleGlobalShortcuts(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (isSelectAllShortcut(event) && !isEditableSelectAllTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (providerSettingsOpen) return;
      if (matchesKeyboardCommand(event, "focus-address-bar")) {
        event.preventDefault();
        event.stopPropagation();
        focusAddressBar();
        return;
      }
      if (matchesKeyboardCommand(event, "new-loom")) {
        event.preventDefault();
        event.stopPropagation();
        openNewConversationDraft();
        return;
      }
      if (matchesKeyboardCommand(event, "back")) {
        if (navigationIndex <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        handleBackForward("back");
        return;
      }
      if (matchesKeyboardCommand(event, "forward")) {
        if (navigationIndex >= navigationStack.length - 1) return;
        event.preventDefault();
        event.stopPropagation();
        handleBackForward("forward");
        return;
      }
      if (matchesKeyboardCommand(event, "reload")) {
        event.preventDefault();
        event.stopPropagation();
        window.location.reload();
        return;
      }
      if (matchesKeyboardCommand(event, "home")) {
        event.preventDefault();
        event.stopPropagation();
        openNewConversationDraft();
        return;
      }
      if (matchesKeyboardCommand(event, "stop") && composerRuntimeState.running) {
        event.preventDefault();
        event.stopPropagation();
        stopMainResponse();
      }
    }

    document.addEventListener("keydown", handleGlobalShortcuts, true);
    return () => document.removeEventListener("keydown", handleGlobalShortcuts, true);
  }, [
    composerRuntimeState.running,
    navigationIndex,
    navigationStack.length,
    providerSettingsOpen,
  ]);

  function closeUtilityOverlay(overlay: UtilityOverlayId) {
    if (overlay === "graph") {
      setGraphMode(false);
      return;
    } else {
      setActivePanel((current) => (current === overlay ? null : current));
    }
    setRightDockPinned(false);
  }

  function openUtilityPanel(panel: UtilityPanelId) {
    setActivePanel(panel);
  }

  function toggleUtilityPanel(panel: UtilityPanelId) {
    const closingActivePanel = !rightDockPinned && activePanel === panel;
    setActivePanel(closingActivePanel ? null : panel);
  }

  function openGraphOverlay() {
    dispatchSplitFocus({ type: "GRAPH_CONTEXT_SWITCHED" });
    dispatchSplitFocus({ type: "GRAPH_CONTEXT_SWITCHED" });
    setGraphMode(true);
  }

  function toggleGraphOverlay() {
    dispatchSplitFocus({ type: "GRAPH_CONTEXT_SWITCHED" });
    dispatchSplitFocus({ type: "GRAPH_CONTEXT_SWITCHED" });
    setGraphMode((current) => !current);
  }

  function toggleRightDockPin() {
    setRightDockPinned((current) => !current);
  }

  function closeUnpinnedUtilityOverlays() {
    if (rightDockPinned) return;
    setActivePanel(null);
  }

  function closeAddressSearch() {
    dispatchAddressBar({ type: "RESET" });
    setAddressQuery("");
    setAddressFeedback(null);
    setSelectedSuggestion(-1);
    setAddressSuggestionsVisible(false);
  }

  function blurAddressBarInput() {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      addressBarRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
  }

  function focusAddressBar() {
    dispatchAddressBar({ type: "FOCUS" });
    setAddressQuery(currentAddressBarValue);
    setSelectedSuggestion(-1);
    setAddressFeedback(null);
    setAddressSuggestionsVisible(true);
    window.requestAnimationFrame(() => {
      const input = addressBarRef.current?.querySelector<HTMLInputElement>(
        "input[aria-label='Loom Address Bar']"
      );
      input?.focus();
      input?.select();
    });
  }

  function selectAddressBarTextSoon() {
    window.requestAnimationFrame(() => {
      const input = addressBarRef.current?.querySelector<HTMLInputElement>(
        "input[aria-label='Loom Address Bar']"
      );
      input?.focus();
      input?.select();
    });
  }

  function focusActiveComposerFromAddressBar() {
    dispatchAddressBar({ type: "BLUR" });
    setAddressQuery("");
    setAddressFeedback(null);
    setAddressSuggestionsVisible(false);
    setSelectedSuggestion(-1);
    blurAddressBarInput();
    focusComposerAfterNavigation();
  }

  function focusComposerAfterNavigation() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        composerFocusRef.current?.();
        if (document.activeElement?.closest("[data-testid='prompt-composer']")) return;
        const editors = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-testid='prompt-composer'] [role='textbox']"
          )
        );
        const visibleEditor =
          editors.find((editor) => editor.getClientRects().length > 0) ??
          editors[editors.length - 1];
        if (!visibleEditor) return;
        visibleEditor.focus();
        const range = document.createRange();
        range.selectNodeContents(visibleEditor);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
    });
  }

  function startLoomSurfaceLoading() {
    setLoomSurfaceLoading(true);
    if (loomSurfaceLoadingTimerRef.current !== null) {
      window.clearTimeout(loomSurfaceLoadingTimerRef.current);
    }
    loomSurfaceLoadingTimerRef.current = window.setTimeout(() => {
      loomSurfaceLoadingTimerRef.current = null;
      setLoomSurfaceLoading(false);
    }, 4_000);
  }

  function finishLoomSurfaceLoading() {
    if (loomSurfaceLoadingTimerRef.current !== null) {
      window.clearTimeout(loomSurfaceLoadingTimerRef.current);
      loomSurfaceLoadingTimerRef.current = null;
    }
    setLoomSurfaceLoading(false);
  }

  function normalizeResolvedDestination(
    destination: LoomLink | AddressSuggestion | HistoryEntry
  ): LoomLink | AddressSuggestion | HistoryEntry {
    if (
      destination.resolutionStatus === "resolved" ||
      destination.resolutionStatus === "alias_stale"
    ) {
      return destination;
    }
    const resolution = resolveLoomAddress(destination.path, loomGraphRepository);
    if (resolution.status === "resolved") {
      const resolvedObject = resolution.targetObject ?? resolution.object;
      return resolvedObject
        ? {
            ...destination,
            ...linkFromResolvedObject(resolvedObject),
            canonicalUri:
              destination.canonicalUri ??
              destination.meta?.canonicalUri ??
              resolvedObject.canonicalUri,
          }
        : destination;
    }
    if (resolution.status === "alias_stale" && resolution.object) {
      return {
        ...destination,
        ...linkFromResolvedObject(resolution.object),
        path: resolution.staleAliasReplacement ?? destination.path,
        canonicalUri:
          destination.canonicalUri ??
          destination.meta?.canonicalUri ??
          resolution.object.canonicalUri,
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

  async function resolveNavigationDestinationWithEngine(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    options: { allowUnresolved?: boolean } = {}
  ): Promise<
    | { ok: true; destination: LoomLink | AddressSuggestion | HistoryEntry }
    | { ok: false; resolution: LoomResolutionResult }
  > {
    if (!isLoomAddress(destination.path)) return { ok: true, destination };
    const resolution = await loomEngineClient.resolveAddress({ address: destination.path });
    if (
      resolution.status === "resolved" ||
      resolution.status === "alias_resolved" ||
      (resolution.status === "alias_stale" && resolution.object)
    ) {
      const resolvedObject = resolution.targetObject ?? resolution.object;
      return {
        ok: true,
        destination: resolvedObject
          ? {
              ...destination,
              ...linkFromResolvedObject(resolvedObject),
              path:
                resolution.status === "alias_stale"
                  ? resolution.staleAliasReplacement ??
                    resolvedObject.aliasUri ??
                    destination.path
                  : destination.path,
              targetObjectId: resolvedObject.objectId,
              canonicalUri:
                destination.canonicalUri ??
                destination.meta?.canonicalUri ??
                resolvedObject.canonicalUri,
              navigationDestination: resolution.destination,
              resolutionStatus:
                resolution.status === "alias_stale" ? "alias_stale" : resolution.status,
            }
          : resolution.destination
            ? {
                ...destination,
                canonicalUri:
                  destination.canonicalUri ??
                  destination.meta?.canonicalUri ??
                  resolution.canonicalUri,
                navigationDestination: resolution.destination,
                resolutionStatus: resolution.status,
              }
            : destination,
      };
    }
    if (
      (resolution.status === "not_found" || resolution.status === "missing") &&
      (options.allowUnresolved || hasLocalNavigationTarget(destination))
    ) {
      return { ok: true, destination };
    }
    if (resolution.status === "deleted" && hasLocalNavigationTarget(destination)) {
      return { ok: true, destination };
    }
    if (options.allowUnresolved && hasLocalNavigationTarget(destination)) {
      return { ok: true, destination };
    }
    if (resolution.status === "broken_reference") {
      loomGraphRepository.emitBrokenReference(destination, resolution.reason ?? "Navigation failed");
    }
    return { ok: false, resolution };
  }

  function shouldHighlightResponseFocus(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    navigationDestination?: LoomNavigationDestination
  ) {
    if (navigationDestination) {
      return (
        Boolean(navigationDestination.scrollTargetResponseId) &&
        (navigationDestination.scrollMode === "exact" ||
          navigationDestination.scrollMode === "origin")
      );
    }
    return destination.type === "response";
  }

  function resolveNavigationDestination(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    options: { allowUnresolved?: boolean } = {}
  ):
    | { ok: true; destination: LoomLink | AddressSuggestion | HistoryEntry }
    | { ok: false; resolution: LoomResolutionResult } {
    if (!isLoomAddress(destination.path)) return { ok: true, destination };
    const resolution = resolveLoomAddress(destination.path, loomGraphRepository);
    if (
      resolution.status === "resolved" ||
      (resolution.status === "alias_stale" && resolution.object)
    ) {
      const resolvedObject = resolution.targetObject ?? resolution.object;
      return {
        ok: true,
        destination: resolvedObject
          ? {
              ...destination,
              ...linkFromResolvedObject(resolvedObject),
              path:
                resolution.status === "alias_stale"
                  ? resolution.staleAliasReplacement ??
                    resolvedObject.aliasUri ??
                    destination.path
                  : destination.path,
              targetObjectId: resolvedObject.objectId,
              canonicalUri:
                destination.canonicalUri ??
                destination.meta?.canonicalUri ??
                resolvedObject.canonicalUri,
              resolutionStatus:
                resolution.status === "alias_stale" ? "alias_stale" : "resolved",
            }
          : destination,
      };
    }
    if (
      resolution.status === "not_found" &&
      (options.allowUnresolved || hasLocalNavigationTarget(destination))
    ) {
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
    const visibleSplitPanel = resolvedNavigationDestination
      ? visibleSplitPanelForLoomId(resolvedNavigationDestination.loomId)
      : null;
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
    if (conversation && visibleSplitPanel !== "origin") setActiveConversationId(conversation.id);
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
    } else if (resolvedNavigationDestination?.loomId) {
      startLoomSurfaceLoading();
    }
    pendingScrollDestinationRef.current = resolvedNavigationDestination ?? null;
    pendingScrollPathRef.current = resolvedDestination.path;
    pendingScrollHighlightRef.current = shouldHighlightResponseFocus(
      resolvedDestination,
      resolvedNavigationDestination
    );
    setAddressFocused(false);
    setAddressQuery("");
    setAddressFeedback(null);
    setSelectedSuggestion(-1);
    setAddressSuggestionsVisible(false);
    if (visibleSplitPanel) {
      setActiveSplitPanel(visibleSplitPanel);
    } else if (resolvedNavigationDestination?.mode === "split") {
      setActiveSplitPanel("weft");
    }
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

  async function visitDestination(
    destination: LoomLink | AddressSuggestion | HistoryEntry,
    options: {
      allowUnresolved?: boolean;
      source?: LoomNavigationDestination["source"];
      navigationDestination?: LoomNavigationDestination;
    } = {}
  ) {
    if (options.source !== "addressBar") {
      closeAddressSearch();
    } else {
      dispatchAddressBarSequence({ type: "RESOLVE_STARTED" });
    }
    let resolution:
      | { ok: true; destination: LoomLink | AddressSuggestion | HistoryEntry }
      | { ok: false; resolution: LoomResolutionResult };
    try {
      resolution = await resolveNavigationDestinationWithEngine(destination, options);
    } catch (error) {
      showToast({
        title: "Navigation failed",
        message:
          getConfiguredLoomEngineMode() === "rust-service"
            ? providerErrorMessage(error)
            : "Address navigation failed.",
        color: "neutral",
      });
      dispatchAddressBarSequence({ type: "RESOLVE_FAILED" }, { type: "FOCUS" });
      return;
    }
    if (!resolution.ok) {
      setAddressFeedback(resolution.resolution);
      dispatchAddressBar({ type: "RESOLVE_FAILED" });
      return;
    }
    if (options.source === "addressBar") {
      dispatchAddressBarSequence({ type: "RESOLVE_SUCCEEDED" });
    }
    const resolvedDestination = resolution.destination;
    const source = options.source ?? "userNavigation";
    const fromAddressBar = source === "addressBar";
    const storedNavigationDestination =
      "navigationDestination" in resolvedDestination && resolvedDestination.navigationDestination
        ? resolvedDestination.navigationDestination
        : "navigationDestination" in destination
          ? destination.navigationDestination
          : undefined;
    const navigationDestination =
      options.navigationDestination ??
      (storedNavigationDestination
        ? normalizeStoredNavigationDestination(
            resolvedDestination,
            storedNavigationDestination,
            source
          )
        : undefined) ??
      navigationDestinationForLink(resolvedDestination, source);
    if (fromAddressBar) blurAddressBarInput();
    if (fromAddressBar) dispatchAddressBar({ type: "NAVIGATION_STARTED" });
    restoreDestination(resolvedDestination, navigationDestination);
    if (
      navigationDestination.mode === "full" &&
      navigationDestination.originLoomId &&
      navigationDestination.originResponseId &&
      !navigationDestination.scrollTargetResponseId &&
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
    if (fromAddressBar) focusComposerAfterNavigation();
    if (fromAddressBar) dispatchAddressBar({ type: "NAVIGATION_FINISHED" });
  }

  useEffect(() => {
    const pendingDestination = pendingScrollDestinationRef.current;
    const pendingPath = pendingScrollPathRef.current;
    const shouldHighlightPendingScroll = pendingScrollHighlightRef.current;
    if ((!pendingDestination && !pendingPath) || graphMode) return;
    window.requestAnimationFrame(() => {
      let completedScroll = false;
      const completePendingScroll = () => {
        pendingScrollDestinationRef.current = null;
        pendingScrollPathRef.current = null;
        pendingScrollHighlightRef.current = false;
        finishLoomSurfaceLoading();
        completedScroll = true;
      };
      const scrollToResponse = (
        transcript: HTMLElement | null,
        responseId?: string,
        path?: string,
        highlight = false,
        targetPrompt = false
      ) => {
        if (!transcript) return false;
        const target = responseId
          ? transcript.querySelector<HTMLElement>(
              targetPrompt
                ? `[data-prompt-response-id="${CSS.escape(responseId)}"]`
                : `[data-response-id="${CSS.escape(responseId)}"]`
            )
          : path
            ? transcript.querySelector<HTMLElement>(
                `[data-response-address="${CSS.escape(path)}"]`
              )
            : null;
        if (!target) return false;
        scrollElementIntoViewFromCurrent(
          transcript,
          target,
          targetPrompt ? "start" : "center",
          targetPrompt
        );
        if (highlight) {
          target.classList.remove("response-scroll-highlight");
          void target.offsetWidth;
          target.classList.add("response-scroll-highlight");
          window.setTimeout(() => {
            target.classList.remove("response-scroll-highlight");
          }, 1800);
        }
        completePendingScroll();
        return true;
      };

      const transcriptForLoom = (loomId?: string) => {
        if (showWeftSplit && loomId === originConversation?.id) {
          return originTranscriptRef.current;
        }
        return transcriptRef.current;
      };
      const scrollTranscriptToEnd = (transcript: HTMLElement | null) => {
        if (!transcript) return false;
        transcript.scrollTo({
          top: transcript.scrollHeight,
          behavior: "smooth",
        });
        completePendingScroll();
        return true;
      };

      if (
        pendingDestination?.mode === "split" &&
        pendingDestination.originResponseId &&
        !pendingDestination.preserveOriginScroll
      ) {
        scrollToResponse(
          originTranscriptRef.current,
          pendingDestination.originResponseId,
          undefined,
          false,
          true
        );
      }

      if (pendingDestination?.scrollMode === "lastResponse") {
        const latest = lastResponseInLoom(pendingDestination.loomId);
        if (latest && scrollTranscriptToEnd(transcriptForLoom(pendingDestination.loomId))) {
          return;
        }
        if (
          !latest &&
          !serviceLoomsLoading &&
          activeConversationId === pendingDestination.loomId
        ) {
          completePendingScroll();
          return;
        }
      }

      if (pendingDestination?.scrollMode === "top") {
        const transcript = transcriptForLoom(pendingDestination.loomId);
        if (transcript) {
          transcript.scrollTo({ top: 0, behavior: "smooth" });
          completePendingScroll();
          return;
        }
      }

      if (
        pendingDestination?.scrollTargetResponseId &&
        scrollToResponse(
          transcriptForLoom(pendingDestination.loomId),
          pendingDestination.scrollTargetResponseId,
          undefined,
          shouldHighlightPendingScroll,
          pendingDestination.scrollMode === "origin"
        )
      ) {
        return;
      }

      if (
        pendingDestination?.scrollTargetResponseId &&
        !serviceLoomsLoading &&
        activeConversationId === pendingDestination.loomId
      ) {
        const latest = lastResponseInLoom(pendingDestination.loomId);
        const transcript = transcriptForLoom(pendingDestination.loomId);
        if (latest && scrollTranscriptToEnd(transcript)) return;
        if (transcript) {
          completePendingScroll();
          return;
        }
      }

      if (
        pendingPath &&
        scrollToResponse(
          transcriptRef.current,
          undefined,
          pendingPath,
          shouldHighlightPendingScroll
        )
      ) {
        return;
      }

      if (activeConversation?.path === pendingPath) {
        const latest = lastResponseInLoom(activeConversation.id);
        if (latest && scrollTranscriptToEnd(transcriptRef.current)) return;
        if (activeResponses.length > 0 && transcriptRef.current) {
          transcriptRef.current.scrollTo({
            top: transcriptRef.current.scrollHeight,
            behavior: "smooth",
          });
          completePendingScroll();
        }
      }
      if (!completedScroll && !serviceLoomsLoading) {
        finishLoomSurfaceLoading();
      }
    });
  }, [
    activeConversation?.path,
    activeConversationId,
    activeResponses.length,
    activeSplitPanel,
    activeObjectTitle,
    currentNavigationDestination,
    graphMode,
    originConversation?.id,
    serviceLoomsLoading,
    showWeftSplit,
    workspaceWidth,
  ]);

  async function archiveConversation(conversation: Conversation) {
    try {
      await loomEngineClient.archiveLoom({ loomId: conversation.id });
      const nextConversations = conversations.filter(
        (item) => item.id !== conversation.id
      );
      setConversations(nextConversations);
      setArchived((current) => [conversation, ...current]);
      setPinnedConversationIds((current) =>
        current.filter((id) => id !== conversation.id)
      );
      if (conversation.id === activeConversationId) {
        openNewConversationDraft();
      }
    } catch (error) {
      console.warn("Archive requires loom-service.", error);
      showToast({
        title: "Archive failed",
        message: "Loom could not be archived.",
        color: "red",
      });
    }
  }

  async function restoreConversation(conversation: Conversation) {
    try {
      await loomEngineClient.restoreLoom({ loomId: conversation.id });
      setArchived((current) => current.filter((item) => item.id !== conversation.id));
      setConversations((current) => appendConversationInTabOrder(current, conversation));
      setActiveConversationId(conversation.id);
      setActiveObjectTitle(conversation.title);
      closeUnpinnedUtilityOverlays();
    } catch (error) {
      console.warn("Restore requires loom-service.", error);
      showToast({
        title: "Restore failed",
        message: "Loom could not be restored.",
        color: "red",
      });
    }
  }

  async function deleteConversation(conversation: Conversation) {
    const deletedLoomIds = collectDeletedLoomIds(conversation.id, forkRecords);
    try {
      await loomEngineClient.deleteLoom({ loomId: conversation.id });
    } catch (error) {
      console.warn("Permanent Loom delete requires loom-service.", error);
      showToast({
        title: "Delete failed",
        message: "Loom could not be deleted permanently.",
        color: "red",
      });
      return;
    }
    setConversations((current) =>
      current.filter((item) => !deletedLoomIds.has(item.id))
    );
    setArchived((current) => current.filter((item) => !deletedLoomIds.has(item.id)));
    setConversationResponses((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([loomId]) => !deletedLoomIds.has(loomId))
      )
    );
    setForkRecords((current) =>
      current.filter(
        (record) =>
          !deletedLoomIds.has(record.parentConversationId) &&
          !deletedLoomIds.has(record.childConversationId)
      )
    );
    setSelectedPromptRevisionByResponseId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, revisionLoomId]) =>
          revisionLoomId ? !deletedLoomIds.has(revisionLoomId) : true
        )
      )
    );
    setTemporaryWefts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([loomId, workspace]) =>
            !deletedLoomIds.has(loomId) &&
            !deletedLoomIds.has(workspace.temporaryId) &&
            !deletedLoomIds.has(workspace.originLoomId)
        )
      )
    );
    setBookmarks((current) =>
      current.map((bookmark) =>
        bookmark.path.startsWith(conversation.path)
          ? { ...bookmark, badge: "Broken reference" }
          : bookmark
      )
    );
    setPinnedConversationIds((current) =>
      current.filter((id) => !deletedLoomIds.has(id))
    );
    setHistory((current) =>
      current.filter(
        (entry) => !deletedLoomIds.has(entry.navigationDestination?.loomId ?? "")
      )
    );
    setNavigationStack((current) => {
      const filtered = current.filter(
        (entry) => !deletedLoomIds.has(entry.navigationDestination?.loomId ?? "")
      );
      if (filtered.length === current.length) return current;
      const currentEntry = current[navigationIndex];
      const currentEntryDeleted =
        !currentEntry ||
        deletedLoomIds.has(currentEntry.navigationDestination?.loomId ?? "");
      if (!currentEntryDeleted) {
        const newIndex = filtered.findIndex((e) => e.id === currentEntry.id);
        setNavigationIndex(newIndex >= 0 ? newIndex : 0);
      }
      return filtered;
    });
    if (deletedLoomIds.has(activeConversationId)) {
      openNewConversationDraft();
    }
    if (getConfiguredLoomEngineMode() === "rust-service" && !mockDataEnabled) {
      void refreshServiceLooms();
    }
    setDeleteTarget(null);
    setContextMenu(null);
    showToast({
      title: "Deleted",
      message: "Loom was deleted permanently.",
      color: "neutral",
    });
  }

  function updateComposerDraft(key: string, updater: (draft: ComposerDraft) => ComposerDraft) {
    const nextDrafts = {
      ...composerDraftsRef.current,
      [key]: updater(composerDraftsRef.current[key] ?? EMPTY_COMPOSER_DRAFT),
    };
    composerDraftsRef.current = nextDrafts;
    setComposerDrafts(nextDrafts);
  }

  function setActiveComposerDraft(draft: ComposerDraft) {
    const nextDrafts = {
      ...composerDraftsRef.current,
      [activeDraftKey]: draft,
    };
    composerDraftsRef.current = nextDrafts;
    setComposerDrafts(nextDrafts);
  }

  function setComposerDraftForKey(key: string, draft: ComposerDraft) {
    const nextDrafts = {
      ...composerDraftsRef.current,
      [key]: draft,
    };
    composerDraftsRef.current = nextDrafts;
    setComposerDrafts(nextDrafts);
  }

  function removeComposerLink(key: string, link: LoomLink) {
    updateComposerDraft(key, (draft) => ({
      ...draft,
      links: draft.links.filter((item) => !referencesShareIdentity(item, link)),
    }));
  }

  function resolveReferenceLink(link: LoomLink, sourceLoomId = activeConversationId): LoomLink {
    if (link.type === "fragment") return link;
    if (link.referenceMentionId || link.resolutionStatus) return link;
    const resolution = resolveLoomAddress(link.path, loomGraphRepository);
    if (
      resolution.status !== "resolved" &&
      !(resolution.status === "alias_stale" && resolution.object)
    ) {
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
          path:
            resolution.status === "alias_stale"
              ? resolution.staleAliasReplacement ??
                targetObject.aliasUri ??
                targetObject.canonicalUri
              : targetObject.aliasUri ?? targetObject.canonicalUri,
          targetObjectId: targetObject.objectId,
          canonicalUri:
            link.canonicalUri ?? link.meta?.canonicalUri ?? targetObject.canonicalUri,
          referenceCode: referenceCodeForLink(link),
          referenceMentionId: mention?.mentionId,
          resolutionStatus:
            resolution.status === "alias_stale" ? "alias_stale" : "resolved",
        }
      : link;
  }

  function linkObjectForDraft(link: LoomLink, draftKey: string) {
    const transcript = transcriptRef.current;
    const preservedScrollTop = transcript?.scrollTop;
    const shouldFollowTranscript =
      transcript ? isScrollContainerNearBottom(transcript, 140) : false;
    const stableLink = resolveReferenceLink(promoteResponseLink(link), draftKey);
    updateComposerDraft(draftKey, (currentDraft) => {
      const selectedLink = withReferenceOccurrenceIndex(
        {
          ...stableLink,
          selectedAt: stableLink.selectedAt ?? Date.now(),
        },
        countInlineReferenceOccurrences(currentDraft.html, stableLink) + 1
      );
      return {
        ...currentDraft,
        html: appendInlineReferenceTokenHtml(
          currentDraft.html,
          selectedLink,
          appSettings.referenceDisplayMode
        ),
        links: [...currentDraft.links, selectedLink],
      };
    });
    composerFocusRef.current?.();
    if (transcript && shouldFollowTranscript) {
      const followScroll = () => {
        scrollTranscriptToBottom(transcript);
      };
      window.requestAnimationFrame(followScroll);
      window.setTimeout(followScroll, 0);
      window.setTimeout(followScroll, 80);
      window.setTimeout(followScroll, 220);
    } else if (transcript && preservedScrollTop !== undefined) {
      transcriptProgrammaticScrollRef.current = true;
      const restoreScroll = () => {
        transcript.scrollTop = preservedScrollTop;
      };
      restoreScroll();
      window.requestAnimationFrame(restoreScroll);
      window.setTimeout(restoreScroll, 0);
      window.setTimeout(() => {
        restoreScroll();
        transcriptProgrammaticScrollRef.current = false;
      }, 80);
      window.setTimeout(restoreScroll, 220);
      window.setTimeout(restoreScroll, 420);
    }
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
      canonicalUri: response.meta?.canonicalUri,
      meta: response.meta,
    });
  }

  function handleAddressKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAddressSuggestionsVisible(true);
      if (filteredSuggestions.length === 0) return;
      setSelectedSuggestion((index) =>
        index < 0 ? 0 : Math.min(index + 1, filteredSuggestions.length - 1)
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setAddressSuggestionsVisible(true);
      if (filteredSuggestions.length === 0) return;
      setSelectedSuggestion((index) =>
        index < 0 ? filteredSuggestions.length - 1 : Math.max(index - 1, 0)
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      dispatchAddressBar({ type: "SUBMIT" });
      const action = resolveAddressBarEnterAction({
        query: addressQuery,
        suggestions: filteredSuggestions,
        selectedSuggestion,
      });
      if (action.kind === "suggestion") {
        dispatchAddressBar({ type: "ADDRESS_DETECTED" });
        visitDestination(action.suggestion, { source: "addressBar" });
      }
      if (action.kind === "address") {
        dispatchAddressBar({ type: "ADDRESS_DETECTED" });
        visitDestination(
          {
            id: `address-${Date.now()}`,
            type: "recent",
            title: action.address,
            path: action.address,
            badge: "Address",
          },
          { source: "addressBar" }
        );
      }
      if (action.kind === "prompt") {
        dispatchAddressBar({ type: "FREE_TEXT_DETECTED" });
        void startNewLoomFromAddressBar(action.prompt);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (addressSuggestionsVisible) {
        setAddressSuggestionsVisible(false);
        setSelectedSuggestion(-1);
        return;
      }
      if (addressQuery !== currentAddressBarValue) {
        dispatchAddressBar({ type: "FOCUS" });
        setAddressQuery(currentAddressBarValue);
        setAddressFeedback(null);
        setSelectedSuggestion(-1);
        selectAddressBarTextSoon();
        return;
      }
      focusActiveComposerFromAddressBar();
    }
  }

  async function startNewLoomFromAddressBar(value: string) {
    const prompt = value.trim();
    if (!prompt) return;
    if (composerRuntimeState.running) {
      showToast({
        title: "Loom is already responding",
        message: "Wait for the active response before starting a new Loom from the address bar.",
        color: "neutral",
      });
      return;
    }
    dispatchAddressBar({ type: "RESET" });
    setAddressQuery("");
    setAddressFeedback(null);
    setSelectedSuggestion(-1);
    setAddressSuggestionsVisible(false);
    blurAddressBarInput();
    setGraphMode(false);
    closeUnpinnedUtilityOverlays();
    const sendPromise = sendComposerToModel(
      {
        html: escapeInlineReferenceHtml(prompt),
        links: [],
      },
      {
        effort: "Medium",
        mode: appSettings.modelResponseMode,
        loomId: EPHEMERAL_DRAFT_ID,
      }
    );
    focusComposerAfterNavigation();
    try {
      await sendPromise;
    } finally {
      dispatchAddressBar({ type: "NAVIGATION_FINISHED" });
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
      items: getContextMenuItemsForPayload(payload),
    });
  }

  function getContextMenuItemsForPayload(payload: ContextMenuPayload) {
    const items = getContextMenuItems(payload);
    if (payload.kind !== "conversation") return items;

    const { conversation, pinned } = payload;
    const currentGroupId = groupIdForConversation(conversation.id);
    const targetGroups = tabGroups.filter((group) => group.id !== currentGroupId);
    const moveItems: ContextMenuItem[] = [
      {
        id: "move-to-group",
        label: "Move to Groups",
        detail: pinned ? "Unpin first" : targetGroups.length === 0 ? "No other groups" : undefined,
        disabled: pinned || targetGroups.length === 0,
        separatorBefore: true,
        children: targetGroups.map((group) => ({
          id: "move-to-group",
          label: group.name,
          detail: "Tab group",
          targetGroupId: group.id,
        })),
      },
    ];

    const insertIndex = items.findIndex((item) => item.id === "bookmark");
    if (insertIndex < 0) return [...items, ...moveItems];
    return [
      ...items.slice(0, insertIndex),
      ...moveItems,
      ...items.slice(insertIndex),
    ];
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

  function showToast({
    title,
    message,
    color = "neutral",
    icon,
  }: {
    title?: string;
    message: string;
    color?: ToastNotificationColor;
    icon?: ToastNotificationIcon;
  }) {
    if (linkCopyToastTimerRef.current !== null) {
      window.clearTimeout(linkCopyToastTimerRef.current);
    }
    setToastTitle(title);
    setCopyToastMessage(message);
    setToastIcon(icon);
    setToastColor(color);
    setLinkCopyToastVisible(true);
    linkCopyToastTimerRef.current = window.setTimeout(() => {
      setLinkCopyToastVisible(false);
      linkCopyToastTimerRef.current = null;
    }, 1400);
  }

  function showLinkCopyToast(message = "Link is copied") {
    showToast({ message, icon: "copy" });
  }

  function pulseBookmarkFeedback(bookmarkId?: string) {
    setBookmarksNavPulse(true);
    if (bookmarkId) setRecentBookmarkFeedbackId(bookmarkId);
    window.setTimeout(() => {
      setBookmarksNavPulse(false);
      if (bookmarkId) {
        setRecentBookmarkFeedbackId((current) => (current === bookmarkId ? null : current));
      }
    }, GROWTH_HIGHLIGHT_MS);
  }

  function pulseWeftFeedback(weftLoomId: string, originResponseId: string) {
    setRecentWeftFeedbackLoomId(weftLoomId);
    setRecentResponseFeedbackId(originResponseId);
    window.setTimeout(() => {
      setRecentWeftFeedbackLoomId((current) => (current === weftLoomId ? null : current));
      setRecentResponseFeedbackId((current) =>
        current === originResponseId ? null : current
      );
    }, GROWTH_HIGHLIGHT_MS);
  }

  function recordGrowthEvent(settingsPatch: Partial<AppSettings> = {}) {
    const settingsBase = { ...appSettings, ...settingsPatch };
    const nextCount = settingsBase.growthEventCount + 1;
    const milestone = GROWTH_MILESTONES.find(
      (value) =>
        value === nextCount && !settingsBase.shownGrowthMilestones.includes(value)
    );
    saveAppSettings({
      ...settingsBase,
      growthEventCount: nextCount,
      shownGrowthMilestones: milestone
        ? [...settingsBase.shownGrowthMilestones, milestone]
        : settingsBase.shownGrowthMilestones,
    });
    if (!milestone) return;
    if (growthMilestoneToastTimerRef.current !== null) {
      window.clearTimeout(growthMilestoneToastTimerRef.current);
    }
    growthMilestoneToastTimerRef.current = window.setTimeout(() => {
      growthMilestoneToastTimerRef.current = null;
      showToast({
        title: "Your Loom is growing",
        message: `You now have ${milestone} addressable pieces to search, reuse, and branch from.`,
        color: "sunset",
        icon: "sparkles",
      });
    }, MILESTONE_TOAST_DELAY_MS);
  }

  function copyLoomAddressWithToast(destination: Pick<LoomLink, "path" | "canonicalUri">) {
    copyLoomAddress(destination);
    showLinkCopyToast();
  }

  function copyShareItem(kind: "address" | "markdown" | "title-address") {
    const address = currentShareDestination.canonicalUri ?? currentShareDestination.path;
    if (kind === "address") {
      void browserHostShell.copyText(address);
      showLinkCopyToast("Loom address is copied");
      return;
    }
    if (kind === "markdown") {
      void browserHostShell.copyText(
        toLoomMarkdown({ title: currentShareDestination.title, path: address })
      );
      showLinkCopyToast("Markdown link is copied");
      return;
    }
    void browserHostShell.copyText(`${currentShareDestination.title}\n${address}`);
    showLinkCopyToast("Title and address are copied");
  }

  async function exportCurrentLoom(format: "markdown" | "csv" | "zip") {
    if (!currentLoomExportTarget) {
      showToast({
        title: "Export failed",
        message: "There is no active Loom surface to export.",
        color: "neutral",
      });
      return;
    }
    try {
      const exportResult = await loomEngineClient.exportLoom({
        loomId: currentLoomExportTarget.loom.id,
        format,
        includeMetadata: true,
        includeReferences: true,
        includeBookmarks: true,
        includeGraph: format === "zip",
      });
      downloadBase64File(
        exportResult.fileName,
        exportResult.contentBase64,
        exportResult.mimeType
      );
      showToast({
        title: `${format === "markdown" ? "Markdown" : format === "csv" ? "CSV" : "ZIP"} export created`,
        message: `${currentLoomExportTarget.loom.title} was exported as ${format === "markdown" ? "Markdown" : format === "csv" ? "CSV" : "ZIP"}.`,
        color: "sunset",
        icon: "copy",
      });
    } catch (error) {
      showToast({
        title: "Export failed",
        message:
          getConfiguredLoomEngineMode() === "rust-service"
            ? providerErrorMessage(error)
            : "Loom export could not be created.",
        color: "neutral",
      });
    }
  }

  function responseMarkdownForCopy(response: ResponseItem) {
    return responseMarkdownSource(response);
  }

  async function copyResponseAsMarkdown(response: ResponseItem) {
    await browserHostShell.copyText(buildAssistantCopyPayload(responseMarkdownForCopy(response)).markdown);
    showLinkCopyToast("Markdown is copied");
  }

  async function copyResponseAsPlainText(response: ResponseItem) {
    await browserHostShell.copyText(buildAssistantCopyPayload(responseMarkdownForCopy(response)).plainText);
    showLinkCopyToast("Plain text is copied");
  }

  async function copyResponseAsRichText(response: ResponseItem) {
    const payload = buildAssistantCopyPayload(responseMarkdownForCopy(response));
    await browserHostShell.copyRichText({
      html: payload.html,
      plainText: payload.plainText,
    });
    showLinkCopyToast("Rich text is copied");
  }

  function copyResponseAnswerWithToast(response: ResponseItem) {
    void copyResponseAsRichText(response).catch(() => {
      showToast({
        title: "Copy failed",
        message: "The response could not be copied from this browser session.",
        color: "neutral",
        icon: "copy",
      });
    });
  }

  function promptClipboardPayload(promptText: string, references: LoomLink[] = []) {
    const referenceQueue = [...references];
    const markdown = referenceQueue.reduce((current, link) => {
      const tokenCandidates = [
        composerReferenceTokenText(link, link.referenceDisplayMode ?? "title"),
        referenceTokenText(link, link.referenceDisplayMode ?? "title"),
        referenceTokenText(link, "title"),
        referenceTokenText(link, "code"),
        `[[${link.title}]]`,
        link.referenceCustomLabel ? `[[${link.referenceCustomLabel}]]` : "",
      ].filter(Boolean);
      const token = tokenCandidates.find((candidate) => current.includes(candidate));
      if (!token) return current;
      return current.replace(
        token,
        referenceMarkdownLink(link, link.referenceDisplayMode ?? "title")
      );
    }, promptText);
    return {
      plainText: markdown,
      html: markdownToReferenceClipboardHtml(markdown),
    };
  }

  function copyPromptTextWithToast(promptText: string, references?: LoomLink[]) {
    const payload = promptClipboardPayload(promptText, references);
    void browserHostShell.copyRichText(payload).then(
      () => showLinkCopyToast("Prompt is copied"),
      () =>
        showToast({
          title: "Copy failed",
          message: "The prompt could not be copied from this browser session.",
          color: "neutral",
          icon: "copy",
        })
    );
  }

  async function copyCodeBlockWithToast(code: string) {
    try {
      await browserHostShell.copyRichText({
        html: codeToClipboardHtml(code),
        plainText: code,
      });
      showLinkCopyToast("Code is copied");
      return true;
    } catch {
      return false;
    }
  }

  async function addCodeBlockAsReference(
    conversation: Conversation,
    response: ResponseItem,
    codeBlock: ResponseCodeBlock
  ) {
    let resolvedCodeBlock = codeBlock;
    if (getConfiguredLoomEngineMode() === "rust-service" && !resolvedCodeBlock.codeBlockId) {
      try {
        const latestLoom = await loomEngineClient.getLoom(conversation.id);
        const latestResponse = latestLoom.responses.find((item) => item.id === response.id);
        const persistedCodeBlock = latestResponse?.codeBlocks?.find(
          (item) =>
            item.blockIndex === codeBlock.blockIndex ||
            item.code.trimEnd() === codeBlock.code.trimEnd()
        );
        if (persistedCodeBlock) {
          resolvedCodeBlock = persistedCodeBlock;
        }
        const freshCodeBlocks = latestResponse?.codeBlocks;
        if (freshCodeBlocks?.length) {
          setConversationResponses((current) => ({
            ...current,
            [conversation.id]: (current[conversation.id] ?? []).map((item) =>
              item.id === response.id && !item.codeBlocks?.length
                ? { ...item, codeBlocks: freshCodeBlocks }
                : item
            ),
          }));
        }
      } catch (error) {
        console.warn("Could not hydrate persisted code block before Reference creation.", error);
      }
    }

    const code = resolvedCodeBlock.code;
    if (!code.trim()) return false;

    const responseCode = response.meta?.code;
    const sourceCanonicalUri = response.meta?.canonicalUri ?? response.address;
    const codeBlockHash = resolvedCodeBlock.exactHash ?? fragmentTextHash(code);
    const codeBlockAnchor =
      resolvedCodeBlock.codeBlockId ?? `block-${resolvedCodeBlock.blockIndex}-${codeBlockHash}`;
    const language = resolvedCodeBlock.language?.trim() || "code";
    const title = `${language} code from ${
      cleanMarkdownDisplayTitle(response.title) || response.title
    }`;
    const codeBlockUri = `${sourceCanonicalUri}#code-block=${encodeURIComponent(
      codeBlockAnchor
    )}`;
    const codeReference: LoomLink = {
      id: `codeblock:${conversation.id}:${response.id}:${resolvedCodeBlock.blockIndex}:${codeBlockHash}`,
      type: "fragment",
      title,
      path: codeBlockUri,
      badge: "Code",
      targetKind: "code_block",
      selectedAt: Date.now(),
      canonicalUri: codeBlockUri,
      referenceCode: responseCode,
      referenceDisplayMode: "title",
      sourceLoomId: conversation.id,
      sourceResponseId: response.id,
      selectedText: code,
      sourceResponseCode: responseCode,
      sourceResponseTitle: response.title,
      sourceCanonicalUri,
      fragmentHash: codeBlockHash,
      createdAt: Date.now(),
      referenceCustomLabel: title,
      targetObjectId: resolvedCodeBlock.codeBlockId ?? response.id,
    };
    const draft = composerDrafts[conversation.id] ?? EMPTY_COMPOSER_DRAFT;
    if (draft.links.some((link) => referencesShareIdentity(link, codeReference))) {
      showToast({ message: "Already referenced", icon: "copy" });
      window.requestAnimationFrame(() => composerFocusRef.current?.());
      return true;
    }

    let referenceToInsert = codeReference;
    if (getConfiguredLoomEngineMode() === "rust-service") {
      try {
        const metadata: Record<string, JsonValue> = {
          targetKind: "code_block",
          codeBlockId: resolvedCodeBlock.codeBlockId ?? codeReference.id,
          blockIndex: resolvedCodeBlock.blockIndex,
          language,
          exactHash: codeBlockHash,
          referenceDisplayMode: "title",
        };
        if (responseCode) metadata.sourceResponseCode = responseCode;
        if (response.title) metadata.sourceResponseTitle = response.title;
        if (sourceCanonicalUri) metadata.sourceCanonicalUri = sourceCanonicalUri;
        const result = await loomEngineClient.addReference({
          loomId: conversation.id,
          sourceResponseId: response.id,
          reference: codeReference,
          metadata,
        });
        referenceToInsert = {
          ...codeReference,
          ...result.reference,
          badge: codeReference.badge,
          selectedText: codeReference.selectedText,
          sourceResponseCode: codeReference.sourceResponseCode,
          sourceResponseTitle: codeReference.sourceResponseTitle,
          sourceCanonicalUri: codeReference.sourceCanonicalUri,
          fragmentHash: codeReference.fragmentHash,
          referenceDisplayMode: "title",
          targetKind: "code_block",
          referenceCustomLabel:
            result.reference.referenceCustomLabel ?? codeReference.referenceCustomLabel,
          targetObjectId: codeReference.targetObjectId,
        };
      } catch (error) {
        console.warn("Code block reference creation requires loom-service.", error);
        showToast({ message: "Reference requires loom-service" });
        return false;
      }
    }

    if (resolvedCodeBlock.codeBlockId) {
      const snippetItem = codeSnippetAttachItemFromService({
        codeBlockId: resolvedCodeBlock.codeBlockId,
        responseId: response.id,
        loomId: conversation.id,
        loomTitle: conversation.title,
        sourceResponseTitle: response.title,
        sourceResponseCode: responseCode,
        sourceCanonicalUri,
        blockIndex: resolvedCodeBlock.blockIndex,
        language: resolvedCodeBlock.language,
        code,
        exactHash: codeBlockHash,
        fence: resolvedCodeBlock.fence,
      });
      setServiceCodeSnippetItems((current) =>
        dedupeAttachContentItems([snippetItem, ...current])
      );
    }

    linkObjectForDraft(referenceToInsert, conversation.id);
    showToast({ message: "Code Reference added", icon: "copy" });
    window.requestAnimationFrame(() => composerFocusRef.current?.());
    return true;
  }

  function insertStarterPrompt(text: string) {
    starterPromptRequestIdRef.current += 1;
    setStarterPromptRequest({
      id: starterPromptRequestIdRef.current,
      text,
    });
    window.requestAnimationFrame(() => composerFocusRef.current?.());
  }

  function chooseStarterCategory(categoryId: NewLoomStarterCategoryId) {
    setStarterCategoryId(categoryId);
    window.requestAnimationFrame(() => composerFocusRef.current?.());
  }

  function findConversationByObjectId(objectId?: string) {
    if (!objectId) return undefined;
    return conversations.find(
      (conversation) =>
        runtimeGraphObjectIdFor("conversation", conversation.id) === objectId
    );
  }

  function findResponseRecordByObjectId(objectId?: string) {
    if (!objectId) return undefined;
    for (const [loomId, responses] of Object.entries(conversationResponses)) {
      const response = responses.find(
        (item) => runtimeGraphObjectIdFor("response", `${loomId}_${item.id}`) === objectId
      );
      if (!response) continue;
      const conversation = conversations.find((item) => item.id === loomId);
      if (!conversation) continue;
      return { loomId, conversation, response };
    }
    return undefined;
  }

  function visitResolvedReference(link: LoomLink, resolution: LoomResolutionResult) {
    const resolvedObject = resolution.targetObject ?? resolution.object;
    if (!resolvedObject) {
      visitDestination(link, { source: "userNavigation" });
      return;
    }

    if (resolvedObject.kind === "response") {
      const located =
        findResponseRecordByObjectId(resolvedObject.objectId) ??
        findResponseRecord(link);
      if (located) {
        const destination = responseLinkForNavigation(
          located.loomId,
          located.response
        );
        visitDestination(destination, {
          source: "userNavigation",
          navigationDestination: navigationDestinationForLink(destination, "userNavigation", {
            scrollTargetResponseId: located.response.id,
            scrollMode: "exact",
          }),
        });
        return;
      }
    }

    if (resolvedObject.kind === "conversation") {
      const conversation = findConversationByObjectId(resolvedObject.objectId);
      if (conversation) {
        visitDestination(loomLinkForId(conversation.id), {
          source: "userNavigation",
          navigationDestination: {
            loomId: conversation.id,
            mode: "full",
            source: "userNavigation",
          },
        });
        return;
      }
    }

    visitDestination(
      {
        ...link,
        ...linkFromResolvedObject(resolvedObject),
        path:
          resolution.status === "alias_stale"
            ? resolution.staleAliasReplacement ??
              resolvedObject.aliasUri ??
              link.path
            : link.path,
        targetObjectId: resolvedObject.objectId,
        canonicalUri:
          link.canonicalUri ??
          link.meta?.canonicalUri ??
          resolvedObject.canonicalUri,
      },
      { source: "userNavigation" }
    );
  }

  function openComposerReference(link: LoomLink) {
    if (link.type === "fragment" || link.targetKind === "code_block") {
      const target = findReferenceTargetResponse(link);
      if (!target) return "This Reference source cannot be opened.";
      const destination = responseLinkForNavigation(target.loomId, target.response);
      visitDestination(destination, {
        source: "userNavigation",
        navigationDestination: navigationDestinationForLink(destination, "userNavigation", {
          scrollTargetResponseId: target.response.id,
          scrollMode: "exact",
        }),
      });
      focusComposerAfterNavigation();
      return null;
    }
    const resolution = resolveLoomAddress(link.path, loomGraphRepository);
    if (resolution.status === "resolved") {
      visitResolvedReference(link, resolution);
      focusComposerAfterNavigation();
      return null;
    }
    if (resolution.status === "alias_stale" && resolution.object) {
      const nextLink = {
        ...link,
        ...linkFromResolvedObject(resolution.object),
        path: resolution.staleAliasReplacement ?? resolution.object.aliasUri ?? link.path,
        targetObjectId: resolution.object.objectId,
        canonicalUri:
          link.canonicalUri ??
          link.meta?.canonicalUri ??
          resolution.object.canonicalUri,
      };
      visitResolvedReference(nextLink, resolution);
      focusComposerAfterNavigation();
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
    while (
      groups.some(
        (group) => group.name === `Group ${index}` || group.name === `Group #${index}`
      )
    ) {
      index += 1;
    }
    return `Group ${index}`;
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

  function saveTabGroupSettings(groupId: string, input: { name: string; color?: string }) {
    const nextName = normalizeLoomTitle(input.name);
    if (!nextName) return;
    setTabGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? { ...group, name: nextName, color: input.color }
          : group
      )
    );
    setRenamingGroupId(null);
    setGroupColorTarget(null);
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
    setConversations((current) => appendConversationInTabOrder(current, conversation));
    setTabGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...appendTabGroupConversationId(group, id),
              collapsed: false,
            }
          : group
      )
    );
    setActiveConversationId(id);
    setActiveObjectTitle(conversation.title);
    closeUnpinnedUtilityOverlays();
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
    setGraphMode(false);
    closeAddressSearch();
    blurAddressBarInput();
    closeUnpinnedUtilityOverlays();
    pushNavigationEntry({
      id: EPHEMERAL_DRAFT_ID,
      type: "conversation",
      title: "New conversation",
      path: "loom://drafts/new-conversation",
      badge: "Draft",
    });
    focusComposerAfterNavigation();
  }

  function materializeDraftConversation(draft: ComposerDraft) {
    if (activeConversationId !== EPHEMERAL_DRAFT_ID || !draftConversation) return;
    const plainText = plainTextFromDraft(draft);
    const meaningful = plainText.length > 0 || draft.links.length > 0;
    if (!meaningful) return;
    const id = `c-${Date.now()}`;
    const title = heuristicLoomTitleFromPrompt(plainText);
    const summary = heuristicLoomSummaryFromPrompt(plainText);
    const conversation: Conversation = {
      ...draftConversation,
      id,
      title,
      path: `loom://drafts/${id}`,
      summary,
      meta: createAddressableLoomMetadata({
        id: createMetadataUuid(),
        title,
        text: metadataTextForLoom({
          title,
          summary,
        }),
      }),
    };
    setConversations((current) => appendConversationInTabOrder(current, conversation));
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
      canonicalUri: conversation.meta?.canonicalUri,
      meta: conversation.meta,
    };
    replaceNavigationEntry(destination);
    setHistory((current) => [
      createHistoryEntry(destination),
      ...markHistoryOlder(current),
    ]);
    queueLoomMetadataGeneration(conversation, `First user prompt:\n${plainText}`);
  }

  async function sendComposerToModel(
    draft: ComposerDraft,
    options: {
      effort: ModelEffort;
      mode?: ModelResponseMode;
      loomId?: string;
      preserveNavigation?: boolean;
      revealResponse?: boolean;
      onResponseCreated?: (loomId: string, response: ResponseItem) => void;
    }
  ) {
    const prompt = promptTextFromDraft(draft);
    const meaningful = prompt.length > 0 || draft.links.length > 0;
    const originalDraftKey = options.loomId ?? activeConversationId;
    if (!meaningful || composerRuntimeState.running) return false;
    const useRustServiceGeneration = getConfiguredLoomEngineMode() === "rust-service";

    const readinessMessage = modelReadinessMessage("main");
    if (readinessMessage && !useRustServiceGeneration) {
      setComposerRuntimeTargetKey(originalDraftKey);
      setComposerRuntimeState({ running: false, message: readinessMessage });
      return false;
    }

    if (mainComposerSubmissionInFlightRef.current) return false;
    mainComposerSubmissionInFlightRef.current = true;
    try {
    const generationId = mainGenerationRef.current + 1;
    mainGenerationRef.current = generationId;
    const controller = new AbortController();
    mainAbortRef.current = controller;
    mainRevealTargetRef.current = null;
    setComposerRuntimeTargetKey(originalDraftKey);

    setComposerRuntimeState({
      running: true,
      message: "Understanding question...",
    });
    let targetLoomId = originalDraftKey;
    let promotedSeedResponses: ResponseItem[] | undefined;
    let promotedTargetConversation: Conversation | undefined;
    const temporaryTargetWeft = temporaryWefts[targetLoomId];
    if (temporaryTargetWeft) {
      const originConversationForPromotion = conversations.find(
        (conversation) => conversation.id === temporaryTargetWeft.originLoomId
      );
      const originResponseForPromotion = findResponseInLoom(
        temporaryTargetWeft.originLoomId,
        temporaryTargetWeft.originResponseId
      );
      if (!originConversationForPromotion || !originResponseForPromotion) {
        setComposerRuntimeState({
          running: false,
          message: "Temporary Flow origin is no longer available.",
        });
        return false;
      }
      setTemporaryWefts((current) => ({
        ...current,
        [temporaryTargetWeft.temporaryId]: {
          ...temporaryTargetWeft,
          status: asTemporaryWeftWorkspaceStatus(
            transitionTemporaryWeftStatus(temporaryTargetWeft.status, {
              type: "SUBMIT_FIRST_PROMPT",
            })
          ),
        },
      }));
      setComposerRuntimeState({
        running: true,
        message: "Promoting temporary Flow...",
      });
      if (useRustServiceGeneration) {
        const serviceResult = await loomEngineClient.createOrOpenWeft({
          originLoomId: temporaryTargetWeft.originLoomId,
          originResponseId: temporaryTargetWeft.originResponseId,
          initialPrompt: prompt,
          summary: `Branched from ${originConversationForPromotion.title}.`,
          reuseExisting: false,
          source: "response_action",
          seedMode: "none",
          createOriginContextSnapshot: true,
          metadata: sanitizeWeftMetadataValue({
            source: "temporary_workspace_promotion",
            sourceLoomId: temporaryTargetWeft.originLoomId,
            sourceResponseId: temporaryTargetWeft.originResponseId,
          }),
        });
        const promotedTitle = serviceResult.weft?.title || temporaryTargetWeft.title;
        const promotedSummary =
          serviceResult.weft?.summary ?? `Branched from ${originConversationForPromotion.title}.`;
        const fallbackPath = `${originConversationForPromotion.path}/loom/${serviceResult.loomId}`;
        const promotedMeta = createAddressableLoomMetadata({
          id: createMetadataUuid(),
          title: promotedTitle,
          text: metadataTextForLoom({ title: promotedTitle, summary: promotedSummary }),
        });
        const promotedConversation: Conversation = {
          id: serviceResult.loomId,
          title: promotedTitle,
          path: serviceResult.weft?.canonicalUri ?? fallbackPath,
          folder: originConversationForPromotion.folder,
          summary: promotedSummary,
          iconKey: "workflow",
          meta: {
            ...promotedMeta,
            code: serviceResult.weft?.code ?? promotedMeta.code,
            displayCode: serviceResult.weft?.displayCode ?? promotedMeta.displayCode,
            canonicalUri: serviceResult.weft?.canonicalUri ?? promotedMeta.canonicalUri,
          },
        };
        promotedTargetConversation = promotedConversation;
        promotedSeedResponses = [];
        setConversations((current) => {
          if (current.some((item) => item.id === promotedConversation.id)) return current;
          return appendConversationInTabOrder(current, promotedConversation);
        });
        setTabGroups((current) =>
          current.map((group) => {
            if (group.conversationIds.includes(promotedConversation.id)) return group;
            const sourceIndex = group.conversationIds.indexOf(
              originConversationForPromotion.id
            );
            if (sourceIndex < 0) return group;
            return appendTabGroupConversationId(group, promotedConversation.id);
          })
        );
        setConversationResponses((current) => {
          const { [temporaryTargetWeft.temporaryId]: _discard, ...rest } = current;
          return {
            ...rest,
            [promotedConversation.id]: promotedSeedResponses ?? [],
          };
        });
        setForkRecords((current) => [
          ...current,
          {
            id: `fork-${temporaryTargetWeft.originLoomId}-${temporaryTargetWeft.originResponseId}-${promotedConversation.id}`,
            parentConversationId: temporaryTargetWeft.originLoomId,
            parentResponseId: temporaryTargetWeft.originResponseId,
            childConversationId: promotedConversation.id,
        title: promotedConversation.title,
        kind: serviceResult.weft?.weftKind ?? "exploration",
        createdAt: serviceResult.weft?.createdAt ?? new Date().toISOString(),
        updatedAt: serviceResult.weft?.updatedAt,
      },
        ]);
        setTemporaryWefts((current) => {
          const { [temporaryTargetWeft.temporaryId]: _discard, ...rest } = current;
          return rest;
        });
        setComposerDrafts((current) => {
          const { [temporaryTargetWeft.temporaryId]: _discard, ...rest } = current;
          const next = {
            ...rest,
            [promotedConversation.id]: current[temporaryTargetWeft.temporaryId] ?? draft,
          };
          composerDraftsRef.current = next;
          return next;
        });
        dispatchSplitFocus({ type: "TEMP_WEFT_PROMOTED" });
        setActiveConversationId(promotedConversation.id);
        dispatchSplitFocus({ type: "PERSISTED_WEFT_INTERACTED" });
        setActiveObjectTitle(promotedConversation.title);
        pendingScrollDestinationRef.current = {
          loomId: promotedConversation.id,
          mode: "split",
          originLoomId: temporaryTargetWeft.originLoomId,
          originResponseId: temporaryTargetWeft.originResponseId,
          scrollMode: "lastResponse",
          source: "weftCreate",
        };
        const promotedLink: LoomLink = {
          id: promotedConversation.id,
          type: "loom",
          title: promotedConversation.title,
          path: promotedConversation.path,
          badge: typeLabel.loom,
          canonicalUri: promotedConversation.meta?.canonicalUri,
          meta: promotedConversation.meta,
        };
        const promotedDestination: LoomNavigationDestination = {
          loomId: promotedConversation.id,
          mode: "split",
          originLoomId: temporaryTargetWeft.originLoomId,
          originResponseId: temporaryTargetWeft.originResponseId,
          scrollMode: "lastResponse",
          source: "weftCreate",
        };
        pushNavigationEntry(promotedLink, promotedDestination);
        setHistory((current) => [
          createHistoryEntry(promotedLink, promotedDestination),
          ...markHistoryOlder(current),
        ]);
        targetLoomId = promotedConversation.id;
        pulseWeftFeedback(promotedConversation.id, temporaryTargetWeft.originResponseId);
      } else {
        const promotedId = `c-loom-${Date.now()}`;
        const promotedPath = `${originConversationForPromotion.path}/loom/${promotedId}`;
        const promotedConversation: Conversation = {
          id: promotedId,
          title: temporaryTargetWeft.title,
          path: promotedPath,
          folder: originConversationForPromotion.folder,
          summary: `Branched from ${originConversationForPromotion.title}.`,
          iconKey: "workflow",
          meta: createAddressableLoomMetadata({
            id: createMetadataUuid(),
            title: temporaryTargetWeft.title,
            text: metadataTextForLoom({
              title: temporaryTargetWeft.title,
              summary: `Branched from ${originConversationForPromotion.title}.`,
            }),
          }),
        };
        promotedTargetConversation = promotedConversation;
        promotedSeedResponses = [];
        setConversations((current) => appendConversationInTabOrder(current, promotedConversation));
        setConversationResponses((current) => {
          const { [temporaryTargetWeft.temporaryId]: _discard, ...rest } = current;
          return {
            ...rest,
            [promotedConversation.id]: promotedSeedResponses ?? [],
          };
        });
        setForkRecords((current) => [
          ...current,
          {
            id: `fork-${temporaryTargetWeft.originLoomId}-${temporaryTargetWeft.originResponseId}-${promotedConversation.id}`,
            parentConversationId: temporaryTargetWeft.originLoomId,
            parentResponseId: temporaryTargetWeft.originResponseId,
            childConversationId: promotedConversation.id,
            title: promotedConversation.title,
            kind: "exploration",
            createdAt: new Date().toISOString(),
          },
        ]);
        setTemporaryWefts((current) => {
          const { [temporaryTargetWeft.temporaryId]: _discard, ...rest } = current;
          return rest;
        });
        dispatchSplitFocus({ type: "TEMP_WEFT_PROMOTED" });
        setActiveConversationId(promotedConversation.id);
        dispatchSplitFocus({ type: "PERSISTED_WEFT_INTERACTED" });
        setActiveObjectTitle(promotedConversation.title);
        const promotedLink: LoomLink = {
          id: promotedConversation.id,
          type: "loom",
          title: promotedConversation.title,
          path: promotedConversation.path,
          badge: typeLabel.loom,
          canonicalUri: promotedConversation.meta?.canonicalUri,
          meta: promotedConversation.meta,
        };
        const promotedDestination: LoomNavigationDestination = {
          loomId: promotedConversation.id,
          mode: "split",
          originLoomId: temporaryTargetWeft.originLoomId,
          originResponseId: temporaryTargetWeft.originResponseId,
          scrollMode: "lastResponse",
          source: "weftCreate",
        };
        pendingScrollDestinationRef.current = promotedDestination;
        pushNavigationEntry(promotedLink, promotedDestination);
        setHistory((current) => [
          createHistoryEntry(promotedLink, promotedDestination),
          ...markHistoryOlder(current),
        ]);
        targetLoomId = promotedConversation.id;
      }
    }
    const existingTargetConversation =
      targetLoomId === draftConversation?.id
        ? draftConversation
        : promotedTargetConversation ??
          conversations.find((conversation) => conversation.id === targetLoomId);
    const targetConversationId =
      targetLoomId === EPHEMERAL_DRAFT_ID || !existingTargetConversation
        ? `c-${Date.now()}`
        : existingTargetConversation.id;
    const targetConversationSeed =
      targetLoomId === EPHEMERAL_DRAFT_ID || !existingTargetConversation
        ? {
            ...(draftConversation ?? {
              id: targetConversationId,
              folder: "Drafts",
              iconKey: "compass",
              summary: heuristicLoomSummaryFromPrompt(prompt),
            }),
            id: targetConversationId,
            title: heuristicLoomTitleFromPrompt(prompt),
            path: `loom://drafts/${targetConversationId}`,
            summary: heuristicLoomSummaryFromPrompt(prompt),
          }
        : existingTargetConversation;
    const targetConversation: Conversation = {
      ...targetConversationSeed,
      meta: hydrateAddressableLoomMetadata(
        {
          id:
            targetConversationSeed.meta?.id ??
            createMetadataUuid(),
          title: targetConversationSeed.title,
          text: metadataTextForLoom(targetConversationSeed),
        },
        targetConversationSeed.meta
      ),
    };
    const targetResponses =
      promotedSeedResponses ?? conversationResponses[targetConversation.id] ?? [];
    const responseId = `r-${Date.now()}`;
    const title = normalizeLoomTitle(prompt ? prompt.slice(0, 64) : "Model response");
    const initialQuestion = prompt || "Use the linked Loom references.";
    const response: ResponseItem = {
      id: responseId,
      title,
      address: `${targetConversation.path}/r-${responseSlug(title)}`,
      question: initialQuestion,
      createdAt: new Date().toISOString(),
      questionReferences: draft.links,
      answer: [""],
      visibleProgress: createInitialVisibleAnswerProgress(),
      suggestedLinks: [],
      bookmarkedLinks: [],
      meta: createDraftResponseMetadata({
        id: createMetadataUuid(),
        title,
        text: metadataTextForResponse({
          title,
          question: initialQuestion,
          answer: [],
        }),
      }),
    };
    const materializingNewLoom = targetLoomId === EPHEMERAL_DRAFT_ID || !existingTargetConversation;

    if (materializingNewLoom) {
      setConversations((current) => appendConversationInTabOrder(current, targetConversation));
      setDraftConversation(null);
      setActiveConversationId(targetConversation.id);
      setActiveObjectTitle(targetConversation.title);
      replaceNavigationEntry({
        id: targetConversation.id,
        type: "conversation",
        title: targetConversation.title,
        path: targetConversation.path,
        badge: typeLabel.conversation,
        canonicalUri: targetConversation.meta?.canonicalUri,
        meta: targetConversation.meta,
      });
      setHistory((current) => [
        createHistoryEntry({
          id: targetConversation.id,
          type: "conversation",
          title: targetConversation.title,
          path: targetConversation.path,
          badge: typeLabel.conversation,
          canonicalUri: targetConversation.meta?.canonicalUri,
          meta: targetConversation.meta,
        }),
        ...markHistoryOlder(current),
      ]);
      queueLoomMetadataGeneration(
        targetConversation,
        `First user prompt:\n${prompt}`
      );
    } else if (
      existingTargetConversation.meta?.id !== targetConversation.meta?.id ||
      existingTargetConversation.meta?.canonicalUri !== targetConversation.meta?.canonicalUri
    ) {
      setConversations((current) =>
        current.map((item) =>
          item.id === targetConversation.id
            ? { ...item, meta: targetConversation.meta }
            : item
        )
      );
      queueLoomMetadataGeneration(targetConversation);
    }

    setComposerRuntimeTargetKey(targetConversation.id);
    setConversationResponses((current) => ({
      ...current,
      [targetConversation.id]: [
        ...(current[targetConversation.id] ?? promotedSeedResponses ?? []),
        response,
      ],
    }));
    setGeneratingResponseId(response.id);
    setCompletionActionRevealResponseId(null);
    options.onResponseCreated?.(targetConversation.id, response);
    mainRevealTargetRef.current = { loomId: targetConversation.id, responseId: response.id };
    setComposerDrafts((current) => {
      const {
        [targetLoomId]: _discardTarget,
        [originalDraftKey]: _discardOriginal,
        [EPHEMERAL_DRAFT_ID]: _discardDraft,
        ...rest
      } = current;
      return {
        ...rest,
        [targetConversation.id]: { html: "", links: [] },
      };
    });

    let visibleProgress = createOrchestrationVisibleProgress();
    const setResponseProgress = (nextProgress: VisibleAnswerProgress | undefined) => {
      if (nextProgress) visibleProgress = nextProgress;
      updateResponseVisibleProgress(targetConversation.id, response.id, nextProgress);
    };
    const updateProgress = (
      updater: (progress: VisibleAnswerProgress) => VisibleAnswerProgress
    ) => {
      const nextProgress = updater(visibleProgress);
      setResponseProgress(nextProgress);
      return nextProgress;
    };
    const markDebugEvent = (label: string, detail?: string) => {
      updateProgress((progress) => appendVisibleProgressEvent(progress, label, detail));
    };
    const carryProgressDebug = (nextProgress: VisibleAnswerProgress) => ({
      ...nextProgress,
      debug: visibleProgress.debug ?? nextProgress.debug,
      debugEvents: visibleProgress.debugEvents,
    });
    setResponseProgress(
      appendVisibleProgressEvent(
        updateVisibleProgressDebug(visibleProgress, {
          targetLoomId: targetConversation.id,
          targetResponseId: response.id,
          referenceCount: draft.links.length,
        }),
        "Response placeholder created",
        `Writing to ${targetConversation.id}/${response.id}`
      )
    );
    const modelPrompt = prompt || "Use the attached Loom references to continue this conversation.";
    const selectedResponseMode = options.mode ?? appSettings.modelResponseMode;
    const promotedWeftOrigin =
      promotedTargetConversation && temporaryTargetWeft
        ? {
            originLoomId: temporaryTargetWeft.originLoomId,
            originResponseId: temporaryTargetWeft.originResponseId,
          }
        : undefined;

    if (useRustServiceGeneration) {
      let serviceAccepted = false;
      let serviceResponseId = response.id;
      let serviceFinalContent = "";
      let persistedUserResponseId: string | undefined;
      const mainModel = getProfileModel(providerSettings, "main");
      const mainModelName = mainModel.name;
      const retainServiceWorkflowRunId = (workflowRunId?: string) => {
        if (!workflowRunId) return;
        mainServiceCancellationRef.current = {
          loomId: targetConversation.id,
          responseId: serviceResponseId,
          workflowRunId,
          cancelRequested: mainServiceCancellationRef.current?.cancelRequested ?? false,
        };
        setConversationResponses((current) => ({
          ...current,
          [targetConversation.id]: (current[targetConversation.id] ?? []).map((item) =>
            item.id === serviceResponseId
              ? { ...item, workflowRunId, serviceGenerationStatus: "streaming" }
              : item
          ),
        }));
      };
      const replaceServiceResponseId = (nextResponseId: string) => {
        if (nextResponseId === serviceResponseId) return;
        const previousResponseId = serviceResponseId;
        serviceResponseId = nextResponseId;
        if (mainServiceCancellationRef.current) {
          mainServiceCancellationRef.current = {
            ...mainServiceCancellationRef.current,
            responseId: nextResponseId,
          };
        }
        setGeneratingResponseId(nextResponseId);
        mainRevealTargetRef.current = {
          loomId: targetConversation.id,
          responseId: nextResponseId,
        };
        setConversationResponses((current) => ({
          ...current,
          [targetConversation.id]: (current[targetConversation.id] ?? []).map((item) =>
            item.id === previousResponseId
              ? {
                  ...item,
                  id: nextResponseId,
                  serviceUserResponseId: item.serviceUserResponseId ?? persistedUserResponseId,
                }
              : item
          ),
        }));
        options.onResponseCreated?.(targetConversation.id, {
          ...response,
          id: nextResponseId,
          serviceUserResponseId: persistedUserResponseId,
        });
      };
      const applyServiceLoomTitle = (nextTitle?: string) => {
        const normalizedTitle = nextTitle ? normalizeLoomTitle(nextTitle) : "";
        if (!normalizedTitle) return;
        setConversations((current) =>
          current.map((item) =>
            item.id === targetConversation.id
              ? {
                  ...item,
                  title: normalizedTitle,
                  meta: item.meta
                    ? {
                        ...item.meta,
                        title: normalizedTitle,
                      }
                    : item.meta,
                }
              : item
          )
        );
        if (targetConversation.id === activeConversationIdRef.current) {
          setActiveObjectTitle(normalizedTitle);
        }
      };

      try {
        setComposerRuntimeState({
          running: true,
          message: "Preparing service Loom...",
        });
        await loomEngineClient.createLoom({
          loomId: targetConversation.id,
          title: targetConversation.title,
          summary: targetConversation.summary,
          kind: promotedWeftOrigin ?? getWeftOrigin(targetConversation.id) ? "weft" : "loom",
          originLoomId:
            promotedWeftOrigin?.originLoomId ??
            getWeftOrigin(targetConversation.id)?.originLoomId,
          originResponseId:
            promotedWeftOrigin?.originResponseId ??
            getWeftOrigin(targetConversation.id)?.originResponseId,
          canonicalUri: targetConversation.meta?.canonicalUri ?? targetConversation.path,
          code: targetConversation.meta?.code,
          metadata: {
            source: "main_composer",
            folder: targetConversation.folder,
          },
        });

        setComposerRuntimeState({
          running: true,
          message: `Sending to ${mainModelName} through loom-service...`,
        });
        markDebugEvent(
          "Service generation request started",
          `${mainModelName}, references:${draft.links.length}`
        );

        mainServiceCancellationRef.current = {
          loomId: targetConversation.id,
          responseId: serviceResponseId,
          cancelRequested: false,
        };
        for await (const event of loomEngineClient.sendMessage({
          loomId: targetConversation.id,
          draftKey: targetLoomId,
          promptText: modelPrompt,
          references: draft.links,
          attachments: draft.attachments?.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            size: attachment.size,
            type: attachment.type,
            lastModified: attachment.lastModified,
            attachedAt: attachment.attachedAt ?? null,
          })),
          responseMode: selectedResponseMode,
          focusedResponseId: lastResponseInLoom(targetConversation.id)?.id,
          source: "composer",
          model: mainModel.id,
          options: {
            numCtx: providerSettings.ollama.contextLength,
          },
          persistWorkflow: true,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted || mainGenerationRef.current !== generationId) return false;

          if (event.type === "assistant_placeholder_created") {
            serviceAccepted = true;
            applyServiceLoomTitle(event.payload.loomTitle);
            retainServiceWorkflowRunId(event.payload.workflowRunId);
            replaceServiceResponseId(event.payload.responseId);
            markDebugEvent(
              "Service assistant placeholder created",
              event.payload.workflowRunId
            );
            continue;
          }
          if (event.type === "user_message_created") {
            serviceAccepted = true;
            applyServiceLoomTitle(event.payload.loomTitle);
            persistedUserResponseId = event.payload.responseId;
            retainServiceWorkflowRunId(event.payload.workflowRunId);
            setConversationResponses((current) => ({
              ...current,
              [targetConversation.id]: (current[targetConversation.id] ?? []).map((item) =>
                item.id === serviceResponseId
                  ? { ...item, serviceUserResponseId: event.payload.responseId }
                  : item
              ),
            }));
            markDebugEvent("Service user message persisted", event.payload.responseId);
            continue;
          }
          if (event.type === "answer_plan_ready") {
            markDebugEvent("Service AnswerPlan ready");
            continue;
          }
          if (event.type === "context_ready") {
            setResponseProgress(
              activateVisibleAnswerStage(
                visibleProgress,
                "context",
                "Building Loom context..."
              )
            );
            markDebugEvent(
              "Service context ready",
              `${event.payload.contextBlockCount} artifacts`
            );
            continue;
          }
          if (event.type === "thinking_status") {
            updateResponseThinking(targetConversation.id, serviceResponseId, {
              thinkingStartedAt: new Date().toISOString(),
              elapsedThinkingSeconds:
                event.payload.durationMs !== undefined
                  ? Math.round(event.payload.durationMs / 1000)
                  : undefined,
              thinkingTokenCount: event.payload.tokenEstimate,
            });
            continue;
          }
          if (event.type === "content_delta") {
            serviceAccepted = true;
            if (event.payload.responseId) replaceServiceResponseId(event.payload.responseId);
            serviceFinalContent += event.payload.delta;
            const firstFinalStartedAt = new Date().toISOString();
            updateResponseThinking(targetConversation.id, serviceResponseId, {
              finalStartedAt: firstFinalStartedAt,
              thinkingEndedAt: firstFinalStartedAt,
            });
            setResponseProgress(undefined);
            updateResponseMarkdown(targetConversation.id, serviceResponseId, serviceFinalContent);
            continue;
          }
          if (event.type === "response_completed" || event.type === "response_truncated") {
            serviceAccepted = true;
            applyServiceLoomTitle(event.payload.loomTitle);
            replaceServiceResponseId(event.payload.responseId);
            const sanitizedFinalContent = sanitizeModelAnswer(serviceFinalContent);
            const answer = answerParagraphs(sanitizedFinalContent);
            const completedResponse: ResponseItem = {
              ...response,
              id: serviceResponseId,
              answer,
              finalContent: sanitizedFinalContent,
              doneReason: event.payload.doneReason,
                      truncated: event.type === "response_truncated",
                      serviceGenerationStatus:
                        event.type === "response_truncated" ? "truncated" : "completed",
                      workflowRunId: mainServiceCancellationRef.current?.workflowRunId,
                      visiblePlan: undefined,
              visibleProgress: undefined,
              meta: createDraftResponseMetadata({
                id: createMetadataUuid(),
                title,
                text: metadataTextForResponse({
                  title,
                  question: initialQuestion,
                  answer,
                }),
              }),
            };
            updateResponseThinking(targetConversation.id, serviceResponseId, {
              finalContent: sanitizedFinalContent,
              doneReason: event.payload.doneReason,
              truncated: event.type === "response_truncated",
              done: true,
            });
            setConversationResponses((current) => ({
              ...current,
              [targetConversation.id]: (current[targetConversation.id] ?? []).map((item) =>
                item.id === serviceResponseId
                  ? {
                      ...item,
                      ...completedResponse,
                      thinkingEndedAt:
                        item.thinkingStartedAt && !item.thinkingEndedAt
                          ? new Date().toISOString()
                          : item.thinkingEndedAt,
                      serviceUserResponseId:
                        item.serviceUserResponseId ??
                        completedResponse.serviceUserResponseId ??
                        persistedUserResponseId,
                      thinkingTokenCount:
                        event.payload.evalTokenCount ?? item.thinkingTokenCount,
                      inferenceMs:
                        event.payload.elapsedMs ?? item.inferenceMs,
                      inferenceTokenCount:
                        event.payload.evalTokenCount ?? item.inferenceTokenCount,
                    }
                  : item
              ),
            }));
            setComposerRuntimeState({
              running: false,
              message: `Main model responded with ${mainModelName}.`,
            });
            setGeneratingResponseId(null);
            showResponseCompletionActions(serviceResponseId);
            if (mainAbortRef.current === controller) mainAbortRef.current = null;
            mainServiceCancellationRef.current = null;
            mainRevealTargetRef.current = null;
            if (currentMainRequestRef.current?.responseId === serviceResponseId) {
              currentMainRequestRef.current = null;
            }
            queueResponseMetadataGeneration(targetConversation.id, completedResponse);
            return true;
          }
          if (event.type === "response_error") {
            serviceAccepted = true;
            retainServiceWorkflowRunId(event.payload.workflowRunId);
            const errorMessage = event.payload.message;
            if (event.payload.responseId) replaceServiceResponseId(event.payload.responseId);
            setComposerRuntimeState({
              running: false,
              message: errorMessage,
            });
            updateResponseVisiblePlanAndProgress(
              targetConversation.id,
              serviceResponseId,
              undefined,
              undefined
            );
            updateResponseThinking(targetConversation.id, serviceResponseId, { done: true });
            setConversationResponses((current) => ({
              ...current,
              [targetConversation.id]: (current[targetConversation.id] ?? []).map((item) =>
                item.id === serviceResponseId
                  ? { ...item, serviceGenerationStatus: "error" }
                  : item
              ),
            }));
            updateResponseAnswer(targetConversation.id, serviceResponseId, [errorMessage]);
            showResponseCompletionActions(serviceResponseId);
            if (mainAbortRef.current === controller) mainAbortRef.current = null;
            mainServiceCancellationRef.current = null;
            mainRevealTargetRef.current = null;
            return true;
          }
          if (event.type === "response_cancelled") {
            serviceAccepted = true;
            retainServiceWorkflowRunId(event.payload.workflowRunId);
            updateResponseThinking(targetConversation.id, serviceResponseId, { done: true });
            setConversationResponses((current) => ({
              ...current,
              [targetConversation.id]: (current[targetConversation.id] ?? []).map((item) =>
                item.id === serviceResponseId
                  ? { ...item, serviceGenerationStatus: "cancelled" }
                  : item
              ),
            }));
            setComposerRuntimeState({ running: false, message: "Response stopped." });
            showResponseCompletionActions(serviceResponseId);
            if (mainAbortRef.current === controller) mainAbortRef.current = null;
            mainServiceCancellationRef.current = null;
            mainRevealTargetRef.current = null;
            return true;
          }
        }
      } catch (error) {
        if (controller.signal.aborted || mainGenerationRef.current !== generationId) {
          setComposerRuntimeState({ running: false, message: "Response stopped." });
          if (mainAbortRef.current === controller) mainAbortRef.current = null;
          mainServiceCancellationRef.current = null;
          mainRevealTargetRef.current = null;
          return false;
        }
        if (useRustServiceGeneration || serviceAccepted) {
          setComposerRuntimeState({
            running: false,
            message: providerErrorMessage(error),
          });
          updateResponseAnswer(targetConversation.id, serviceResponseId, [
            providerErrorMessage(error),
          ]);
          showResponseCompletionActions(serviceResponseId);
          if (mainAbortRef.current === controller) mainAbortRef.current = null;
          mainServiceCancellationRef.current = null;
          mainRevealTargetRef.current = null;
          return false;
        }
      }
    }

    const questionGroups = parseReferenceQuestionGroups(prompt, draft.links);
    const preliminaryAnswerPlan = planAnswerDeterministically({
      cleanUserPrompt: modelPrompt,
      attachedReferences: draft.links,
      selectedResponseMode,
    });
    const preliminaryExecutionConfig = resolveAnswerExecutionConfig({
      promptText: modelPrompt,
      answerPlan: preliminaryAnswerPlan,
      referenceCount: draft.links.length,
    });
    const preliminaryVisiblePlan = createDeterministicVisibleAnswerPlan({
      promptText: modelPrompt,
      answerPlan: preliminaryAnswerPlan,
      referenceCount: draft.links.length,
      outputBudget: preliminaryExecutionConfig.outputBudget,
    });
    visibleProgress = carryProgressDebug(
      createVisibleTaskProgressFromPlan(preliminaryVisiblePlan, "orchestration")
    );
    updateResponseVisiblePlanAndProgress(
      targetConversation.id,
      response.id,
      preliminaryVisiblePlan,
      visibleProgress
    );
    markDebugEvent(
      "Deterministic plan installed",
      `${preliminaryVisiblePlan.tasks.length} tasks, ${preliminaryVisiblePlan.contentOutline?.length ?? 0} outline items`
    );
    const answerPlan = await orchestrateQuestionPlan(providerSettings, {
      cleanUserPrompt: modelPrompt,
      attachedReferences: draft.links,
      selectedResponseMode,
      signal: controller.signal,
    });
    if (controller.signal.aborted || mainGenerationRef.current !== generationId) return false;
    markDebugEvent(
      "AnswerPlan ready",
      `${answerPlan.intent}, ${answerPlan.answerStyle}, ${answerPlan.contextStrategy}`
    );
    const executionConfig = resolveAnswerExecutionConfig({
      promptText: modelPrompt,
      answerPlan,
      referenceCount: draft.links.length,
    });
    markDebugEvent(
      "Execution config resolved",
      `think:${executionConfig.think}, budget:${executionConfig.outputBudget}, num_predict:${executionConfig.numPredict}`
    );
    const deterministicVisiblePlan = createDeterministicVisibleAnswerPlan({
      promptText: modelPrompt,
      answerPlan,
      referenceCount: draft.links.length,
      outputBudget: executionConfig.outputBudget,
    });
    visibleProgress = carryProgressDebug(
      createVisibleTaskProgressFromPlan(deterministicVisiblePlan, "orchestration")
    );
    updateResponseVisiblePlanAndProgress(
      targetConversation.id,
      response.id,
      deterministicVisiblePlan,
      visibleProgress
    );
    const visiblePlan = await generateVisibleAnswerPlan({
      providerSettings,
      promptText: modelPrompt,
      answerPlan,
      referenceCount: draft.links.length,
      outputBudget: executionConfig.outputBudget,
      references: draft.links,
      signal: controller.signal,
    });
    if (controller.signal.aborted || mainGenerationRef.current !== generationId) return false;
    markDebugEvent(
      "Visible plan ready",
      `${visiblePlan.source}, ${visiblePlan.tasks.length} tasks`
    );
    visibleProgress = carryProgressDebug(
      createVisibleTaskProgressFromPlan(
        visiblePlan,
        draft.links.length > 0 ? "references" : undefined
      )
    );
    updateResponseVisiblePlanAndProgress(
      targetConversation.id,
      response.id,
      visiblePlan,
      visibleProgress
    );
    const responseMode = executionConfig.responseMode;
    const attachedReferences = draft.links.map(loomContextReferenceForLink);
    const referenceCharCount = attachedReferences.reduce((total, reference) => {
      const capsule = reference.capsule;
      if (capsule) {
        return (
          total +
          capsule.summary.length +
          capsule.keyPoints.reduce((pointTotal, point) => pointTotal + point.length, 0)
        );
      }
      return total + reference.link.title.length + reference.link.path.length;
    }, 0);
    const targetWeftOrigin = promotedWeftOrigin ?? getWeftOrigin(targetConversation.id);
    const targetWeftOriginResponse = targetWeftOrigin
      ? findResponseInLoom(targetWeftOrigin.originLoomId, targetWeftOrigin.originResponseId)
      : undefined;
    const estimatedContextMessageCount =
      2 +
      Math.min(targetResponses.length, 4) +
      attachedReferences.length +
      (targetWeftOriginResponse ? 1 : 0);
    const resolvedContextLength = resolveOllamaContextLength({
      promptText: modelPrompt,
      referenceCount: attachedReferences.length,
      referenceCharCount,
      messageCount: estimatedContextMessageCount,
      mode: responseMode,
      userConfiguredMaxContext: providerSettings.ollama.contextLength,
    });
    updateProgress((progress) =>
      updateVisibleProgressDebug(progress, {
        responseMode,
        think: executionConfig.think,
        outputBudget: executionConfig.outputBudget,
        numPredict: executionConfig.numPredict,
        numCtx: resolvedContextLength,
        referenceCount: attachedReferences.length,
        contextMessageCount: estimatedContextMessageCount,
      })
    );
    setComposerRuntimeState({
      running: true,
      message: "Preparing context...",
    });
    setResponseProgress(
      activateVisibleAnswerStage(
        visibleProgress,
        attachedReferences.length > 0 ? "references" : "context",
        attachedReferences.length > 0 ? "Reading references..." : "Building Loom context..."
      )
    );
    markDebugEvent(
      attachedReferences.length > 0 ? "Reading references" : "Building context",
      `${attachedReferences.length} references, ${referenceCharCount} reference chars`
    );
    const preparedContextArtifacts = await prepareContextArtifactsForGeneration({
      loomId: targetConversation.id,
      conversation: targetConversation,
      responses: targetResponses,
      currentHeadResponseId: lastResponseInLoom(targetConversation.id)?.id,
      attachedReferences,
      activeWeftOrigin:
        targetWeftOrigin && targetWeftOriginResponse
          ? {
              ...targetWeftOrigin,
              response: targetWeftOriginResponse,
            }
          : undefined,
      forkRecords,
      existingCapsules: responseContextCapsules,
    });
    if (controller.signal.aborted || mainGenerationRef.current !== generationId) return false;
    markDebugEvent(
      "Context artifacts ready",
      `${Object.keys(preparedContextArtifacts.responseCapsules).length} response capsules`
    );
    setResponseContextCapsules((current) => ({
      ...current,
      ...preparedContextArtifacts.responseCapsules,
    }));
    setResponseProgress(
      activateVisibleAnswerStage(
        visibleProgress,
        "context",
        "Building Loom context..."
      )
    );
    const loomContext = buildLoomContext({
      loomId: targetConversation.id,
      currentHeadResponseId: lastResponseInLoom(targetConversation.id)?.id,
      newUserPrompt: modelPrompt,
      questionGroups,
      answerPlan,
      questionUnits: answerPlan.questionUnits,
      contextStrategy: answerPlan.contextStrategy,
      rewrittenPrompt: answerPlan.rewrittenPrompt,
      attachedReferences,
      responseMode,
      resolvedNumCtx: resolvedContextLength,
      activeWeftOrigin:
        preparedContextArtifacts.weftOrigin ??
        (targetWeftOrigin && targetWeftOriginResponse
          ? {
              ...targetWeftOrigin,
              response: targetWeftOriginResponse,
              capsule: responseCapsuleForContext(
                targetWeftOrigin.originLoomId,
                targetWeftOriginResponse
              ),
            }
          : undefined),
      conversation: targetConversation,
      responses: targetResponses,
      responseCapsules: preparedContextArtifacts.responseCapsules,
      checkpointSummary: preparedContextArtifacts.checkpointSummary,
      forkRecords,
    });
    markDebugEvent(
      "Loom context built",
      `${loomContext.context.length} context blocks, strategy:${answerPlan.contextStrategy}`
    );
    const mainModel = getProfileModel(providerSettings, "main");
    const mainModelName = mainModel.name;
    setComposerRuntimeState({
      running: true,
      message: `Sending to ${mainModelName}...`,
    });
    setResponseProgress(
      activateVisibleAnswerStage(
        visibleProgress,
        "generation",
        `Sending to ${mainModelName}...`
      )
    );
    updateProgress((progress) =>
      updateVisibleProgressDebug(progress, { model: mainModelName })
    );
    markDebugEvent(
      "Main model request started",
      `${mainModelName}, ctx:${resolvedContextLength}, predict:${executionConfig.numPredict}`
    );

    let createdResponseForCompletion: ResponseItem | null = response;
    try {
      let receivedStreamingContent = false;
      let finalWritingProgressSet = false;
      let finalChunkCount = 0;
      let lastFinalCharCount = 0;
      currentMainRequestRef.current = {
        loomId: targetConversation.id,
        responseId: response.id,
        prompt: loomContext.prompt,
        context: loomContext.context,
        system: loomContext.system,
        effort: options.effort,
        mode: responseMode,
        think: executionConfig.think,
        outputBudget: executionConfig.outputBudget,
        numPredict: executionConfig.numPredict,
        referenceCount: attachedReferences.length,
        referenceCharCount,
        messageCount: estimatedContextMessageCount,
        resolvedNumCtx: resolvedContextLength,
        controller,
      };
      const result = await runModelProfileRequest(providerSettings, {
        profile: "main",
        effort: options.effort,
        mode: responseMode,
        think: executionConfig.think,
        outputBudget: executionConfig.outputBudget,
        numPredict: executionConfig.numPredict,
        referenceCount: attachedReferences.length,
        referenceCharCount,
        messageCount: estimatedContextMessageCount,
        signal: controller.signal,
        prompt: loomContext.prompt,
        context: loomContext.context,
        system: loomContext.system,
        onProgress: (progress) => {
          if (mainGenerationRef.current !== generationId) return;
          updateResponseThinking(targetConversation.id, response.id, progress);
          maybeAutoAnswerNow(response.id, progress);
          if (progress.finalContent !== undefined) {
            const finalContentStarted = Boolean(
              progress.finalStartedAt || progress.finalContent.trim()
            );
            if (finalContentStarted && !finalWritingProgressSet) {
              finalWritingProgressSet = true;
              markDebugEvent("Final content started", `Writing answer into ${response.id}`);
              setResponseProgress(undefined);
            }
            receivedStreamingContent = progress.finalContent.length > 0;
            if (!finalContentStarted && progress.finalContent.length !== lastFinalCharCount) {
              finalChunkCount += 1;
              lastFinalCharCount = progress.finalContent.length;
              updateProgress((currentProgress) =>
                updateVisibleProgressDebug(currentProgress, {
                  finalChunkCount,
                  finalCharCount: progress.finalContent?.length ?? 0,
                  lastChunkAt: Date.now(),
                })
              );
            }
            updateResponseMarkdown(targetConversation.id, response.id, progress.finalContent);
          }
        },
      });
      const answer = answerParagraphs(sanitizeModelAnswer(result.text));
      markDebugEvent(
        "Main model request completed",
        result.doneReason ? `done_reason:${result.doneReason}` : "stream completed"
      );
      const completedResponse: ResponseItem = {
        ...response,
        answer,
        finalContent: result.finalContent,
        thinkingStartedAt: result.thinkingStartedAt,
        thinkingEndedAt: result.thinkingEndedAt,
        finalStartedAt: result.finalStartedAt,
        elapsedThinkingSeconds: result.elapsedThinkingSeconds,
        thinkingTimeoutMs: result.thinkingTimeoutMs,
        doneReason: result.doneReason,
        truncated: result.truncated,
        outputBudget: result.outputBudget,
        numPredict: result.numPredict,
        thinkingStalled: result.thinkingStalled,
        thinkingStallReason: result.thinkingStallReason,
        visiblePlan: undefined,
        visibleProgress: undefined,
        meta: createDraftResponseMetadata({
          id: createMetadataUuid(),
          title,
          text: metadataTextForResponse({
            title,
            question: initialQuestion,
            answer,
          }),
        }),
      };
      updateResponseThinking(targetConversation.id, response.id, {
        finalContent: result.finalContent,
        thinkingStartedAt: result.thinkingStartedAt,
        thinkingEndedAt: result.thinkingEndedAt,
        finalStartedAt: result.finalStartedAt,
        elapsedThinkingSeconds: result.elapsedThinkingSeconds,
        thinkingTimeoutMs: result.thinkingTimeoutMs,
        doneReason: result.doneReason,
        truncated: result.truncated,
        outputBudget: result.outputBudget,
        numPredict: result.numPredict,
        thinkingStalled: result.thinkingStalled,
        thinkingStallReason: result.thinkingStallReason,
        done: true,
      });
      if (options.revealResponse && !receivedStreamingContent) {
        const completedReveal = await revealResponseAnswer(
          targetConversation.id,
          response.id,
          answer,
          generationId
        );
        if (!completedReveal) return true;
      } else {
        updateResponseAnswer(targetConversation.id, response.id, answer);
      }
      if (mainGenerationRef.current !== generationId) return true;
      setConversationResponses((current) => ({
        ...current,
        [targetConversation.id]: (current[targetConversation.id] ?? []).map((item) =>
          item.id === completedResponse.id ? completedResponse : item
        ),
      }));
      setComposerDrafts((current) => {
        const {
          [targetLoomId]: _discardTarget,
          [originalDraftKey]: _discardOriginal,
          [EPHEMERAL_DRAFT_ID]: _discardDraft,
          ...rest
        } = current;
        return {
          ...rest,
          [targetConversation.id]: { html: "", links: [] },
        };
      });
      if (!options.preserveNavigation) setActiveObjectTitle(response.title);
      const destination: LoomLink = {
        id: completedResponse.id,
        type: "response",
        title: completedResponse.title,
        path: completedResponse.address,
        badge: typeLabel.response,
        canonicalUri: completedResponse.meta?.canonicalUri,
        meta: completedResponse.meta,
      };
      if (!options.preserveNavigation) {
        if (targetLoomId === EPHEMERAL_DRAFT_ID) replaceNavigationEntry(destination);
        else pushNavigationEntry(destination);
        setHistory((current) => [
          createHistoryEntry(destination),
          ...markHistoryOlder(current),
        ]);
        pendingScrollPathRef.current = response.address;
        pendingScrollHighlightRef.current = false;
      }
      setComposerRuntimeState({
        running: false,
        message: `Main model responded with ${result.modelId}.`,
      });
      showResponseCompletionActions(completedResponse.id);
      if (mainAbortRef.current === controller) mainAbortRef.current = null;
      mainRevealTargetRef.current = null;
      if (currentMainRequestRef.current?.responseId === response.id) {
        currentMainRequestRef.current = null;
      }
      queueResponseMetadataGeneration(targetConversation.id, completedResponse);
      return true;
    } catch (error) {
      if (controller.signal.aborted) {
        if (mainAbortRef.current === controller) mainAbortRef.current = null;
        if (thinkingGuardRetryResponseRef.current === createdResponseForCompletion?.id) {
          return false;
        }
        const responseWasMaterialized = Boolean(createdResponseForCompletion);
        mainRevealTargetRef.current = null;
        if (createdResponseForCompletion) {
          updateResponseVisiblePlanAndProgress(
            targetConversation.id,
            createdResponseForCompletion.id,
            undefined,
            undefined
          );
          showResponseCompletionActions(createdResponseForCompletion.id);
        } else {
          setGeneratingResponseId(null);
        }
        setComposerRuntimeState({ running: false, message: "Response stopped." });
        return responseWasMaterialized;
      }
      setComposerRuntimeState({
        running: false,
        message: providerErrorMessage(error),
      });
      markRuntimeUnavailableFromError(error);
      if (mainAbortRef.current === controller) mainAbortRef.current = null;
      mainRevealTargetRef.current = null;
      if (createdResponseForCompletion) {
        updateResponseVisiblePlanAndProgress(
          targetConversation.id,
          createdResponseForCompletion.id,
          undefined,
          undefined
        );
        updateResponseAnswer(
          targetConversation.id,
          createdResponseForCompletion.id,
          [providerErrorMessage(error)]
        );
        showResponseCompletionActions(createdResponseForCompletion.id);
      } else {
        setGeneratingResponseId(null);
      }
      return false;
    }
    } finally {
      mainComposerSubmissionInFlightRef.current = false;
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
    setPinnedConversationIds((current) => {
      const alreadyPinned = current.includes(conversation.id);
      if (!alreadyPinned) {
        removeConversationFromGroups(conversation.id);
      }
      return alreadyPinned
        ? current.filter((id) => id !== conversation.id)
        : [...current, conversation.id];
    });
  }

  function changeConversationIcon(conversation: Conversation, iconKey: string, tabLabel: string) {
    const trimmed = tabLabel.trim();
    const nextTabLabel = trimmed === conversation.title ? undefined : normalizeLoomTitle(trimmed);
    setConversations((current) =>
      current.map((item) =>
        item.id === conversation.id ? { ...item, iconKey, tabLabel: nextTabLabel } : item
      )
    );
    setIconPickerTarget(null);
  }

  function bookmarkTargetKindForLink(link: LoomLink): CreateBookmarkInput["targetKind"] {
    if (link.type === "response") return "response";
    if (link.type === "fragment") return "fragment";
    if (link.type === "conversation" || link.type === "loom") {
      return forkRecords.some((record) => record.childConversationId === link.id) ? "weft" : "loom";
    }
    return "external";
  }

  function bookmarkInputForLink(
    link: LoomLink,
    targetObjectId?: string
  ): CreateBookmarkInput {
    return {
      targetKind: bookmarkTargetKindForLink(link),
      targetId: targetObjectId ?? link.targetObjectId ?? link.id,
      targetUri: link.canonicalUri ?? link.path,
      title: (link.referenceCustomLabel ?? link.title).trim() || "Untitled Loom",
      metadata: link.meta
        ? (JSON.parse(JSON.stringify(link.meta)) as JsonValue)
        : undefined,
    };
  }

  function bookmarkConversation(conversation: Conversation) {
    void bookmarkLoomLink({
      id: conversation.id,
      type: "conversation",
      title: conversation.title,
      path: conversation.path,
      badge: typeLabel.conversation,
      canonicalUri: conversation.meta?.canonicalUri,
      meta: conversation.meta,
    });
  }

  async function bookmarkLoomLink(link: LoomLink): Promise<boolean> {
    const promotedLink = promoteResponseLink(link);
    const promotion = loomGraphRepository.promoteBookmark(promotedLink);
    let bookmarkWithMetadata: BookmarkItem = {
      ...promotion.bookmark,
      meta: promotedLink.meta ?? promotion.bookmark.meta,
    };
    if (getConfiguredLoomEngineMode() === "rust-service") {
      try {
        const serviceTargetObjectId =
          promotedLink.type === "response"
            ? promotedLink.id
            : promotion.targetObject.objectId;
        const serviceResult = await loomEngineClient.createBookmark(
          bookmarkInputForLink(promotedLink, serviceTargetObjectId)
        );
        bookmarkWithMetadata = {
          ...bookmarkWithMetadata,
          id: serviceResult.bookmark.id,
          path: serviceResult.bookmark.path || bookmarkWithMetadata.path,
          canonicalUri: serviceResult.bookmark.canonicalUri ?? bookmarkWithMetadata.canonicalUri,
          targetObjectId:
            serviceResult.bookmark.targetObjectId ?? bookmarkWithMetadata.targetObjectId,
          selectedAt: serviceResult.bookmark.selectedAt ?? bookmarkWithMetadata.selectedAt,
          lastUsed: serviceResult.bookmark.lastUsed || bookmarkWithMetadata.lastUsed,
          editableTitle:
            serviceResult.bookmark.editableTitle || bookmarkWithMetadata.editableTitle,
          meta: bookmarkWithMetadata.meta ?? serviceResult.bookmark.meta,
        };
      } catch (error) {
        console.warn("Bookmark creation requires loom-service.", error);
        showToast({ message: "Bookmark requires loom-service", color: "sunset" });
        return false;
      }
    }
    const existingBookmark = bookmarks.find(
      (item) =>
        item.path === bookmarkWithMetadata.path ||
        item.targetObjectId === promotion.targetObject.objectId
    );
    const firstBookmarkFeedback =
      !existingBookmark &&
      bookmarks.length === 0 &&
      !appSettings.hasSeenFirstBookmarkFeedback;
    setBookmarks((current) => {
      const existingIndex = current.findIndex(
        (item) =>
          item.path === bookmarkWithMetadata.path ||
          item.targetObjectId === promotion.targetObject.objectId
      );
      if (existingIndex >= 0) {
        return current.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                meta: bookmarkWithMetadata.meta ?? item.meta,
              }
            : item
        );
      }
      return [bookmarkWithMetadata, ...current];
    });
    const bookmarkTitle =
      (bookmarkWithMetadata.editableTitle ?? bookmarkWithMetadata.title).trim() ||
      "Untitled Loom";
    if (existingBookmark) {
      showToast({
        title: "Bookmark saved",
        message: `“${bookmarkTitle}” is already in Bookmarks.`,
        color: "sunset",
        icon: "bookmark",
      });
      pulseBookmarkFeedback(existingBookmark.id);
      return true;
    }
    if (firstBookmarkFeedback) {
      openUtilityPanel("bookmarks");
    }
    showToast({
      title: "Bookmark saved",
      message: firstBookmarkFeedback
        ? `“${bookmarkTitle}” is now addressable.`
        : `“${bookmarkTitle}” added to Bookmarks.`,
      color: "sunset",
      icon: "bookmark",
    });
    pulseBookmarkFeedback(bookmarkWithMetadata.id);
    recordGrowthEvent(
      firstBookmarkFeedback ? { hasSeenFirstBookmarkFeedback: true } : undefined
    );
    return true;
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

  async function removeBookmark(bookmark: BookmarkItem): Promise<boolean> {
    if (getConfiguredLoomEngineMode() === "rust-service") {
      try {
        await loomEngineClient.deleteBookmark({ bookmarkId: bookmark.id });
      } catch (error) {
        console.warn("Bookmark removal requires loom-service.", error);
        showToast({ message: "Bookmark removal requires loom-service", color: "sunset" });
        return false;
      }
    }
    setBookmarks((current) => current.filter((item) => item.id !== bookmark.id));
    return true;
  }

  function responseBookmarkAddressCandidates(response: ResponseItem) {
    return new Set(
      [response.address, response.meta?.canonicalUri].filter(
        (value): value is string => Boolean(value)
      )
    );
  }

  function responseBookmarkIdCandidates(response: ResponseItem) {
    return new Set(
      [response.id, response.serviceUserResponseId, response.meta?.id].filter(
        (value): value is string => Boolean(value)
      )
    );
  }

  function bookmarkMatchesResponse(bookmark: BookmarkItem, response: ResponseItem) {
    if (bookmark.type !== "response") return false;
    const bookmarkCandidates = bookmarkIdentityCandidates(bookmark);
    const responseCandidates = new Set([
      ...Array.from(responseBookmarkAddressCandidates(response)),
      ...Array.from(responseBookmarkIdCandidates(response)),
    ]);
    return Array.from(bookmarkCandidates).some((candidate) =>
      responseCandidates.has(candidate)
    );
  }

  async function findServiceBookmarkForResponse(
    response: ResponseItem
  ): Promise<BookmarkItem | undefined> {
    if (getConfiguredLoomEngineMode() !== "rust-service") {
      return bookmarks.find((bookmark) => bookmarkMatchesResponse(bookmark, response));
    }

    const addressCandidates = Array.from(responseBookmarkAddressCandidates(response));
    const idCandidates = Array.from(responseBookmarkIdCandidates(response));
    const preferredTargetUri = response.meta?.canonicalUri ?? response.address;

    for (const targetId of idCandidates) {
      try {
        const result = await loomEngineClient.getBookmarkForTarget({
          targetKind: "response",
          targetId,
          targetUri: preferredTargetUri,
        });
        return result.bookmark;
      } catch {
        // Fall through to the next known response identity or the list endpoint.
      }
    }

    for (const targetUri of addressCandidates) {
      try {
        const result = await loomEngineClient.getBookmarkForTarget({
          targetKind: "response",
          targetUri,
        });
        return result.bookmark;
      } catch {
        // Fall through to list matching.
      }
    }

    try {
      const result = await loomEngineClient.listBookmarks();
      return result.bookmarks.find((bookmark) => bookmarkMatchesResponse(bookmark, response));
    } catch {
      return undefined;
    }
  }

  function setResponseBookmarkState(loomId: string, responseId: string, bookmarked: boolean) {
    setConversationResponses((current) => ({
      ...current,
      [loomId]: (current[loomId] ?? []).map((response) =>
        response.id === responseId ? { ...response, bookmarked } : response
      ),
    }));
  }

  async function toggleResponseBookmark(
    loomId: string,
    response: ResponseItem,
    currentlyBookmarked?: boolean
  ) {
    if (currentlyBookmarked) {
      const bookmark =
        bookmarks.find((item) => bookmarkMatchesResponse(item, response)) ??
        (await findServiceBookmarkForResponse(response));
      if (!bookmark) {
        showToast({
          message: "Bookmark state could not be refreshed from loom-service",
          color: "sunset",
        });
        return;
      }
      const removed = await removeBookmark(bookmark);
      if (removed) setResponseBookmarkState(loomId, response.id, false);
      return;
    }

    await toggleSuggestedBookmark(responseLinkForNavigation(loomId, response), false);
  }

  async function toggleSuggestedBookmark(link: LoomLink, currentlyBookmarked?: boolean) {
    const resolved = resolveLoomAddress(link.path, loomGraphRepository);
    const targetObjectId =
      resolved.status === "resolved"
        ? (resolved.targetObject ?? resolved.object)?.objectId
        : undefined;
    const responseTarget = findLocalResponseTarget(link);
    const linkAddressCandidates = destinationAddressCandidates(link);
    const linkCandidates = linkIdentityCandidates(link);
    const responseIdCandidates = new Set(
      [
        link.id,
        link.targetObjectId,
        link.meta?.id,
        responseTarget?.response.id,
        responseTarget?.response.serviceUserResponseId,
        responseTarget?.response.meta?.id,
      ].filter((value): value is string => Boolean(value))
    );
    const setResponseBookmarkState = (bookmarked: boolean) => {
      if (!responseTarget) return;
      setConversationResponses((current) => ({
        ...current,
        [responseTarget.loom.id]: (current[responseTarget.loom.id] ?? []).map((response) =>
          response.id === responseTarget.response.id
            ? { ...response, bookmarked }
            : response
        ),
      }));
    };
    const existing = bookmarks.find(
      (bookmark) => {
        const bookmarkCandidates = bookmarkIdentityCandidates(bookmark);
        return (
          Array.from(bookmarkCandidates).some((candidate) =>
            linkCandidates.has(candidate)
          ) ||
          bookmark.path === link.path ||
          linkAddressCandidates.has(bookmark.path) ||
          (bookmark.canonicalUri ? linkAddressCandidates.has(bookmark.canonicalUri) : false) ||
          (targetObjectId && bookmark.targetObjectId === targetObjectId)
        );
      }
    );
    let serviceExisting = existing;
    if (!serviceExisting && getConfiguredLoomEngineMode() === "rust-service") {
      try {
        const serviceResult = await loomEngineClient.getBookmarkForTarget({
          targetKind: "response",
          targetId: link.id,
          targetUri: link.canonicalUri ?? link.path,
        });
        serviceExisting = serviceResult.bookmark;
      } catch {
        serviceExisting = undefined;
      }
      if (!serviceExisting) {
        try {
          const serviceBookmarks = await loomEngineClient.listBookmarks();
          const responseBookmarks = serviceBookmarks.bookmarks.filter(
            (bookmark) => bookmark.type === "response"
          );
          serviceExisting = serviceBookmarks.bookmarks.find(
            (bookmark) => {
              const bookmarkCandidates = bookmarkIdentityCandidates(bookmark);
              return (
                Array.from(bookmarkCandidates).some((candidate) =>
                  linkCandidates.has(candidate)
                ) ||
                linkAddressCandidates.has(bookmark.path) ||
              (bookmark.canonicalUri ? linkAddressCandidates.has(bookmark.canonicalUri) : false) ||
              (bookmark.meta?.canonicalUri
                ? linkAddressCandidates.has(bookmark.meta.canonicalUri)
                : false) ||
              (bookmark.targetObjectId ? responseIdCandidates.has(bookmark.targetObjectId) : false) ||
              (targetObjectId ? bookmark.targetObjectId === targetObjectId : false) ||
              (currentlyBookmarked &&
                bookmark.type === "response" &&
                bookmark.title === link.title)
              );
            }
          );
          if (!serviceExisting && currentlyBookmarked && responseBookmarks.length === 1) {
            serviceExisting = responseBookmarks[0];
          }
        } catch {
          serviceExisting = undefined;
        }
      }
    }
    if (serviceExisting || responseTarget?.response.bookmarked || currentlyBookmarked) {
      if (serviceExisting) {
        const removed = await removeBookmark(serviceExisting);
        if (!removed) return;
      }
      setResponseBookmarkState(false);
      return;
    }
    const created = await bookmarkLoomLink({ ...link, badge: link.badge ?? "Bookmark" });
    if (created) setResponseBookmarkState(true);
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
      forkTitle?: string,
      forkSubtitle?: string
    ): LineageNode => {
      const responses = conversationResponses[conversation.id] ?? [];
      const responseMatchesForkParent = (response: ResponseItem, record: ForkRecord) =>
        record.parentResponseId === response.id ||
        record.parentResponseId === response.serviceUserResponseId;
      const orphanForkRecords = forkRecords.filter(
        (record) =>
          record.parentConversationId === conversation.id &&
          !responses.some((response) => responseMatchesForkParent(response, record))
      );
      return {
        id: `${asLoom ? "loom" : "conversation"}-${conversation.id}`,
        type: asLoom ? "loom" : "conversation",
        title: asLoom ? forkTitle ?? conversation.title : conversation.title,
        path: conversation.path,
        canonicalUri: conversation.meta?.canonicalUri,
        referenceCode: conversation.meta?.code,
        meta: conversation.meta,
        subtitle: forkSubtitle ?? (asLoom ? conversation.title : "Conversation root"),
        conversationId: conversation.id,
        children: [
          ...responses.map((response) => ({
            id: `response-${conversation.id}-${response.id}`,
            type: "response" as const,
            title: response.title,
            path: response.address,
            canonicalUri: response.meta?.canonicalUri,
            referenceCode: response.meta?.code,
            meta: response.meta,
            subtitle: "Response",
            conversationId: conversation.id,
            responseId: response.id,
            children: forkRecords
              .filter(
                (record) =>
                  record.parentConversationId === conversation.id &&
                  responseMatchesForkParent(response, record)
              )
              .map((record) => {
                const childConversation = conversationsById.get(record.childConversationId);
                return childConversation
                  ? buildConversationNode(childConversation, true, record.title)
                  : null;
              })
              .filter((node): node is LineageNode => Boolean(node)),
          })),
          ...orphanForkRecords
            .map((record) => {
              const childConversation = conversationsById.get(record.childConversationId);
              return childConversation
                ? buildConversationNode(
                    childConversation,
                    true,
                    record.title,
                    "Original response no longer available"
                  )
                : null;
            })
            .filter((node): node is LineageNode => Boolean(node)),
        ],
      };
    };

    return buildConversationNode(rootConversation, false);
  }

  const lineageRoot = useMemo(
    buildLineageTree,
    [activeConversation, conversationResponses, conversations, forkRecords]
  );

  function focusActiveComposerSoon() {
    window.requestAnimationFrame(() => {
      composerFocusRef.current?.();
    });
  }

  function focusVisibleWeftWorkspace() {
    setActiveSplitPanel("weft");
    if (activeTemporaryWeft) {
      setTemporaryWefts((current) => {
        const workspace = current[activeTemporaryWeft.temporaryId];
        if (!workspace) return current;
        const nextStatus = transitionTemporaryWeftStatus(workspace.status, {
          type: "FOCUS_TEMP",
        });
        if (nextStatus === workspace.status) return current;
        return {
          ...current,
          [workspace.temporaryId]: {
            ...workspace,
            status: asTemporaryWeftWorkspaceStatus(nextStatus),
          },
        };
      });
    }
    const latestResponse = activeConversation
      ? lastResponseInLoom(activeConversation.id)
      : undefined;
    pendingScrollDestinationRef.current = {
      loomId: activeConversationId,
      mode: "split",
      originLoomId: activeWeftOrigin?.originLoomId,
      originResponseId: activeWeftOrigin?.originResponseId,
      scrollTargetResponseId: latestResponse?.id,
      scrollMode: "lastResponse",
      source: "userNavigation",
    };
    pendingScrollHighlightRef.current = false;
    focusActiveComposerSoon();
  }

  function scrollTranscriptResponseIntoView(
    transcript: HTMLElement | null,
    responseId: string,
    block: ScrollLogicalPosition = "center"
  ) {
    if (!transcript) return false;
    const target = Array.from(
      transcript.querySelectorAll<HTMLElement>("[data-response-id]")
    ).find((element) => element.dataset.responseId === responseId);
    if (!target) return false;
    scrollElementIntoViewFromCurrent(transcript, target, block);
    return true;
  }

  function scrollTranscriptPromptToStart(
    transcript: HTMLElement | null,
    responseId: string
  ) {
    if (!transcript) return false;
    const target = transcript.querySelector<HTMLElement>(
      `[data-prompt-response-id="${CSS.escape(responseId)}"]`
    );
    if (!target) return false;
    scrollElementIntoViewFromCurrent(transcript, target, "start", true);
    return true;
  }

  function scrollElementIntoViewFromCurrent(
    transcript: HTMLElement,
    target: HTMLElement,
    block: ScrollLogicalPosition = "center",
    forceBlock = false
  ) {
    if (forceBlock && block === "start") {
      const alignToTranscriptStart = () => {
        const transcriptRect = transcript.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const nextTop = Math.max(
          0,
          transcript.scrollTop + targetRect.top - transcriptRect.top - 16
        );
        transcript.scrollTop = nextTop;
      };
      alignToTranscriptStart();
      window.requestAnimationFrame(() => alignToTranscriptStart());
      window.setTimeout(() => alignToTranscriptStart(), 120);
      window.setTimeout(() => alignToTranscriptStart(), 320);
      window.setTimeout(() => alignToTranscriptStart(), 640);
      return;
    }
    const transcriptRect = transcript.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const visibleMargin = 24;
    const targetAlreadyVisible =
      targetRect.top >= transcriptRect.top + visibleMargin &&
      targetRect.bottom <= transcriptRect.bottom - visibleMargin;
    target.scrollIntoView({
      behavior: "smooth",
      block: targetAlreadyVisible && !forceBlock ? "nearest" : block,
    });
  }

  function anchorBranchCounterNavigation(
    loomId: string,
    responseId: string,
    panel: "origin" | "weft" | "full"
  ) {
    const transcript =
      panel === "origin" ? originTranscriptRef.current : transcriptRef.current;
    const mode = showWeftSplit ? "split" : "full";
    pendingScrollDestinationRef.current = {
      loomId,
      mode,
      scrollTargetResponseId: responseId,
      scrollMode: panel === "origin" ? "origin" : "exact",
      source: "userNavigation",
    };
    pendingScrollHighlightRef.current = false;
    window.requestAnimationFrame(() => {
      scrollTranscriptResponseIntoView(transcript, responseId, "center");
    });
  }

  function openPersistedWeftBranch(
    record: ForkRecord,
    options: { preserveOriginScroll?: boolean; scrollMode?: "lastResponse" | "top" } = {}
  ) {
    const weftConversation = conversations.find(
      (conversation) => conversation.id === record.childConversationId
    );
    if (!weftConversation) return false;
    setActiveConversationId(weftConversation.id);
    setActiveSplitPanel("weft");
    setActiveObjectTitle(weftConversation.title);
    closeUnpinnedUtilityOverlays();
    const link: LoomLink = {
      id: weftConversation.id,
      type: "loom",
      title: weftConversation.title,
      path: weftConversation.path,
      badge: typeLabel.loom,
      canonicalUri: weftConversation.meta?.canonicalUri,
      meta: weftConversation.meta,
    };
    const latestResponse = lastResponseInLoom(weftConversation.id);
    const originFocusResponseId = record.revisionSourceResponseId ?? record.parentResponseId;
    const preserveMountedOriginScroll = Boolean(options.preserveOriginScroll && showWeftSplit);
    const destination: LoomNavigationDestination = {
      loomId: weftConversation.id,
      mode: canShowWeftSplit ? "split" : "full",
      originLoomId: record.parentConversationId,
      originResponseId: originFocusResponseId,
      preserveOriginScroll: preserveMountedOriginScroll,
      scrollTargetResponseId: options.scrollMode === "top" ? undefined : latestResponse?.id,
      scrollMode: options.scrollMode ?? "lastResponse",
      source: "userNavigation",
    };
    restoreDestination(link, destination);
    setActiveSplitPanel("weft");
    pushNavigationEntry(link, destination);
    setHistory((current) => [
      createHistoryEntry(link, destination),
      ...markHistoryOlder(current),
    ]);
    pendingScrollDestinationRef.current = destination;
    pendingScrollHighlightRef.current = false;
    focusActiveComposerSoon();
    return true;
  }

  function discardTemporaryWeft(
    temporaryId: string,
    eventType: "DISCARD_TEMP" | "CLOSE_SPLIT" = "DISCARD_TEMP"
  ) {
    let shouldDiscard = false;
    setTemporaryWefts((current) => {
      const workspace = current[temporaryId];
      if (!workspace) return current;
      const nextStatus = transitionTemporaryWeftStatus(workspace.status, {
        type: eventType,
      });
      shouldDiscard = nextStatus === "discarded";
      if (!shouldDiscard) {
        return {
          ...current,
          [temporaryId]: {
            ...workspace,
            status: asTemporaryWeftWorkspaceStatus(nextStatus),
          },
        };
      }
      const { [temporaryId]: _discard, ...rest } = current;
      return rest;
    });
    if (!shouldDiscard) return;
    setConversationResponses((current) => {
      const { [temporaryId]: _discard, ...rest } = current;
      return rest;
    });
    setComposerDrafts((current) => {
      const { [temporaryId]: _discard, ...rest } = current;
      composerDraftsRef.current = rest;
      return rest;
    });
  }

  function openTemporaryWeftWorkspace(
    sourceConversation: Conversation,
    response: ResponseItem
  ) {
    const key = temporaryWeftKey(sourceConversation.id, response.id);
    const existing = Object.values(temporaryWefts).find(
      (workspace) =>
        temporaryWeftKey(workspace.originLoomId, workspace.originResponseId) === key &&
        workspace.status !== "persisted"
    );
    const workspace =
      existing ??
      ({
        temporaryId: `temp-weft-${sourceConversation.id}-${response.id}`,
        originLoomId: sourceConversation.id,
        originResponseId: response.id,
        title: normalizeLoomTitle(`Loom: ${response.title}`),
        summary: `Temporary Flow from ${sourceConversation.title}.`,
        path: `${sourceConversation.path}/temporary-weft/${response.id}`,
        folder: sourceConversation.folder,
        anchorTitle: response.title,
        anchorCode: response.meta?.displayCode ?? response.meta?.code,
        status: asTemporaryWeftWorkspaceStatus(
          transitionTemporaryWeftStatus("absent", { type: "OPEN_TEMP" })
        ),
        createdAt: new Date().toISOString(),
      } satisfies TemporaryWeftWorkspace);

    if (!existing) {
      setTemporaryWefts((current) => ({
        ...current,
        [workspace.temporaryId]: workspace,
      }));
      setConversationResponses((current) => ({
        ...current,
        [workspace.temporaryId]: [],
      }));
      setComposerDrafts((current) => {
        const next = {
          ...current,
          [workspace.temporaryId]: current[workspace.temporaryId] ?? { html: "", links: [] },
        };
        composerDraftsRef.current = next;
        return next;
      });
    }

    setActiveConversationId(workspace.temporaryId);
    setActiveSplitPanel("weft");
    setActiveObjectTitle(workspace.title);
    closeUnpinnedUtilityOverlays();
    pendingScrollDestinationRef.current = {
      loomId: workspace.temporaryId,
      mode: "split",
      originLoomId: sourceConversation.id,
      originResponseId: response.id,
      scrollTargetResponseId: response.id,
      scrollMode: "origin",
      source: "weftCreate",
    };
    pendingScrollHighlightRef.current = false;
    focusActiveComposerSoon();
    showToast({
      title: existing ? "Temporary Flow focused" : "Temporary Flow opened",
      message: "Ask inside this Flow to persist it.",
      color: "sunset",
      icon: "weft",
    });
    return true;
  }

  async function forkResponseLoom(
    response: ResponseItem,
    sourceLoomId = activeConversationId,
    initialExchange?: {
      question: string;
      answer: string;
      turns?: AskExchange[];
      capsuleSnapshot?: unknown;
      selectedText?: string;
      sourceLoomId?: string;
      sourceResponseId?: string;
      sourceFragment?: LoomLink;
      activeReferences?: AskActiveReferenceContext[];
    }
  ): Promise<boolean> {
    const sourceConversation =
      sourceLoomId === draftConversation?.id
        ? draftConversation
        : conversations.find((conversation) => conversation.id === sourceLoomId);
    if (!sourceConversation) return false;
    const sourceResponses = conversationResponses[sourceConversation.id] ?? [];
    const responseIndex = sourceResponses.findIndex((item) => item.id === response.id);
    if (responseIndex < 0) return false;
    const existingFork = initialExchange
      ? undefined
      : forkRecords.find(
          (record) =>
            record.parentConversationId === sourceConversation.id &&
            record.parentResponseId === response.id
        );
    const existingWeft = existingFork
      ? conversations.find((conversation) => conversation.id === existingFork.childConversationId)
      : undefined;
    const openWeftDestination = (weftConversation: Conversation) => {
      if (!graphMode) {
        setActiveConversationId(weftConversation.id);
        setActiveSplitPanel("weft");
      }
      setActiveObjectTitle(weftConversation.title);
      closeUnpinnedUtilityOverlays();
      const destination: LoomLink = {
        id: weftConversation.id,
        type: "loom",
        title: weftConversation.title,
        path: weftConversation.path,
        badge: typeLabel.loom,
        canonicalUri: weftConversation.meta?.canonicalUri,
        meta: weftConversation.meta,
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
      const canOpenSplit = canShowWeftSplit;
      const weftDestination: LoomNavigationDestination = {
        loomId: weftConversation.id,
        mode: canOpenSplit ? "split" : "full",
        originLoomId: sourceConversation.id,
        originResponseId: response.id,
        source: "weftCreate",
      };
      if (
        !historyEntryMatchesDestination(
          navigationStack[navigationIndex],
          destination,
          weftDestination
        )
      ) {
        if (canOpenSplit) {
          pushNavigationSequence([
            { link: originAtLastLink, destination: originAtLastDestination },
            { link: originAtResponseLink, destination: originAtResponseDestination },
            { link: destination, destination: weftDestination },
          ]);
        } else {
          pushNavigationEntry(destination, weftDestination);
        }
        setHistory((current) => [
          createHistoryEntry(destination, weftDestination),
          ...markHistoryOlder(current),
        ]);
      }
      pendingScrollDestinationRef.current = weftDestination;
      pendingScrollHighlightRef.current = false;
    };
    const askTurnsToPersist =
      initialExchange?.turns?.length
        ? initialExchange.turns
        : initialExchange
      ? [
              {
                id: `ask-turn-${Date.now()}`,
                question: initialExchange.question,
                answer: initialExchange.answer,
                createdAt: Date.now(),
                capsuleSnapshot: initialExchange.capsuleSnapshot as ResponseContextCapsule | undefined,
                selectedText: initialExchange.selectedText,
                sourceLoomId: initialExchange.sourceLoomId ?? sourceLoomId,
                sourceResponseId: initialExchange.sourceResponseId ?? response.id,
                sourceFragment: initialExchange.sourceFragment,
                activeReferences: initialExchange.activeReferences,
                title: quickAskFallbackTitle(initialExchange.question, initialExchange.answer),
              } satisfies AskExchange,
            ]
          : [];
    const askResponseFromTurn = (
      turn: AskExchange,
      weftPath: string,
      index: number
    ): ResponseItem => {
      const title = normalizeLoomTitle(
        turn.title ?? quickAskFallbackTitle(turn.question, turn.answer)
      );
      return {
        id: `r-ask-${turn.id}-${index}`,
        title,
        address: `${weftPath}/r-ask-${turn.createdAt}-${index}`,
        question: turn.question,
        createdAt: new Date(turn.createdAt).toISOString(),
        answer: splitAnswerParagraphs(turn.answer),
        askContextCapsuleSnapshot: turn.capsuleSnapshot,
        askSelectedText: turn.selectedText,
        askSourceLoomId: turn.sourceLoomId,
        askSourceResponseId: turn.sourceResponseId,
        askSourceFragment: turn.sourceFragment,
        suggestedLinks: [],
        bookmarkedLinks: [],
        meta: createDraftResponseMetadata({
          id: createMetadataUuid(),
          title,
          text: `${turn.question}\n\n${turn.answer}`,
        }),
      };
    };
    const materializeServiceWeftConversation = (weft: LoomSummary): Conversation => {
      const title = weft.title || normalizeLoomTitle(`Loom: ${response.title}`);
      const summary = weft.summary ?? `Branched from ${sourceConversation.title}.`;
      const fallbackPath = `${sourceConversation.path}/loom/${weft.loomId}`;
      const meta = createAddressableLoomMetadata({
        id: createMetadataUuid(),
        title,
        text: metadataTextForLoom({ title, summary }),
      });
      return {
        id: weft.loomId,
        title,
        path: weft.canonicalUri ?? fallbackPath,
        folder: sourceConversation.folder,
        summary,
        iconKey: "workflow",
        meta: {
          ...meta,
          code: weft.code ?? meta.code,
          displayCode: weft.displayCode ?? meta.displayCode,
          canonicalUri: weft.canonicalUri ?? meta.canonicalUri,
        },
      };
    };
    const visibleSeedResponsesToItems = (
      seedResponses: VisibleWeftSeedResponse[] | undefined,
      weftPath: string
    ): ResponseItem[] => {
      const sortedSeeds = [...(seedResponses ?? [])].sort(
        (left, right) => left.sequenceIndex - right.sequenceIndex
      );
      const items: ResponseItem[] = [];
      let pendingUser: VisibleWeftSeedResponse | undefined;
      for (const seed of sortedSeeds) {
        if (seed.role === "user") {
          pendingUser = seed;
          continue;
        }
        const question = pendingUser?.content ?? response.question;
        const title = seed.title ?? pendingUser?.title ?? normalizeLoomTitle(question);
        const seedItem: ResponseItem = {
          id: seed.responseId,
          title,
          address: `${weftPath}/responses/${seed.responseId}`,
          question,
          createdAt: new Date().toISOString(),
          answer: splitAnswerParagraphs(seed.content),
          suggestedLinks: [],
          bookmarkedLinks: [],
          serviceUserResponseId: pendingUser?.responseId,
          meta: createDraftResponseMetadata({
            id: createMetadataUuid(),
            title,
            text: `${question}\n\n${seed.content}`,
          }),
        };
        items.push(seedItem);
        pendingUser = undefined;
      }
      return items;
    };
    const useRustServiceWeft = getConfiguredLoomEngineMode() === "rust-service";
    const convertedAskTitle =
      askTurnsToPersist.length > 0
        ? normalizeLoomTitle(
            `Loom: ${
              askTurnsToPersist[0]?.question?.trim() ||
              askTurnsToPersist[0]?.title ||
              response.question
            }`
          )
        : normalizeLoomTitle(`Loom: ${response.title}`);
    if (askTurnsToPersist.length === 0) {
      const activeOriginMatchesResponse =
        activeWeftOrigin?.originLoomId === sourceConversation.id &&
        (activeWeftOrigin.originResponseId === response.id ||
          activeWeftOrigin.originResponseId === response.serviceUserResponseId);
      if (showWeftSplit && activeOriginMatchesResponse) {
        focusVisibleWeftWorkspace();
        return true;
      }
      return openTemporaryWeftWorkspace(sourceConversation, response);
    }
    if (useRustServiceWeft) {
      try {
        const serviceMetadata = sanitizeWeftMetadataValue({
          selectedText: initialExchange?.selectedText,
          sourceLoomId: initialExchange?.sourceLoomId ?? sourceConversation.id,
          sourceResponseId: initialExchange?.sourceResponseId ?? response.id,
          sourceFragment: initialExchange?.sourceFragment,
          askTurnCount: askTurnsToPersist.length,
        });
        const serviceResult = await loomEngineClient.createOrOpenWeft({
          originLoomId: sourceConversation.id,
          originResponseId: response.id,
          title: convertedAskTitle,
          summary: `Branched from ${sourceConversation.title}.`,
          reuseExisting: askTurnsToPersist.length === 0,
          source: initialExchange ? "quick_ask_convert" : "response_action",
          seedMode: initialExchange ? "none" : "origin_qa_pair",
          createOriginContextSnapshot: true,
          metadata: serviceMetadata,
        });
        const serviceWeftConversation = serviceResult.weft
          ? materializeServiceWeftConversation(serviceResult.weft)
          : {
              id: serviceResult.loomId,
              title: convertedAskTitle,
              path: `${sourceConversation.path}/loom/${serviceResult.loomId}`,
              folder: sourceConversation.folder,
              summary: `Branched from ${sourceConversation.title}.`,
              iconKey: "workflow",
              meta: createAddressableLoomMetadata({
                id: createMetadataUuid(),
                title: convertedAskTitle,
                text: metadataTextForLoom({
                  title: convertedAskTitle,
                  summary: `Branched from ${sourceConversation.title}.`,
                }),
              }),
            };
        const localServiceWeft =
          conversations.find((conversation) => conversation.id === serviceWeftConversation.id) ??
          serviceWeftConversation;
        let persistedAskTurns: PersistedWeftTurn[] = [];
        if (askTurnsToPersist.length > 0) {
          try {
            const persistResult = await loomEngineClient.persistWeftTurns({
              weftLoomId: serviceWeftConversation.id,
              originLoomId: sourceConversation.id,
              originResponseId: response.id,
              selectedText: initialExchange?.selectedText,
              fragmentHash: initialExchange?.sourceFragment?.fragmentHash,
              sourceMetadata: sanitizeWeftMetadataValue({
                sourceResponseCode: response.meta?.code,
                sourceTitle: response.title,
                sourceCanonicalUri: response.meta?.canonicalUri,
              }),
              turns: askTurnsToPersist.map((turn) => ({
                id: turn.id,
                question: turn.question,
                answer: turn.answer,
                title: turn.title ?? quickAskFallbackTitle(turn.question, turn.answer),
                createdAt: new Date(turn.createdAt).toISOString(),
                metadata: sanitizeWeftMetadataValue({
                  selectedText: turn.selectedText,
                  sourceLoomId: turn.sourceLoomId,
                  sourceResponseId: turn.sourceResponseId,
                  sourceFragment: turn.sourceFragment,
                  activeReferences: turn.activeReferences,
                  payloadReport: turn.payloadReport,
                }),
              })),
            });
            persistedAskTurns = persistResult.responses;
        } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "loom-service could not persist converted Ask turns.";
            throw new Error(message);
          }
        }
        const serviceVisibleSeeds = visibleSeedResponsesToItems(
          serviceResult.visibleSeedResponses,
          serviceWeftConversation.path
        );
        const initialAskResponses = askTurnsToPersist.map((turn, index) => {
          const askResponse = askResponseFromTurn(
            turn,
            serviceWeftConversation.path,
            serviceVisibleSeeds.length + index + 1
          );
          const persistedTurn = persistedAskTurns[index];
          if (!persistedTurn) return askResponse;
          return {
            ...askResponse,
            id: persistedTurn.assistantResponseId,
            address: `${serviceWeftConversation.path}/responses/${persistedTurn.assistantResponseId}`,
            question: persistedTurn.question,
            answer: splitAnswerParagraphs(persistedTurn.answer),
            title: normalizeLoomTitle(
              persistedTurn.title ??
                turn.title ??
                quickAskFallbackTitle(persistedTurn.question, persistedTurn.answer)
            ),
            serviceUserResponseId: persistedTurn.userResponseId,
          };
        });
        setConversations((current) => {
          if (current.some((item) => item.id === serviceWeftConversation.id)) return current;
          return appendConversationInTabOrder(current, serviceWeftConversation);
        });
        setTabGroups((current) =>
          current.map((group) => {
            if (group.conversationIds.includes(serviceWeftConversation.id)) return group;
            const sourceIndex = group.conversationIds.indexOf(sourceConversation.id);
            if (sourceIndex < 0) return group;
            return appendTabGroupConversationId(group, serviceWeftConversation.id);
          })
        );
        setConversationResponses((current) => {
          const existingResponses = current[serviceWeftConversation.id] ?? [];
          const baselineResponses =
            existingResponses.length > 0 ? existingResponses : serviceVisibleSeeds;
          const nextAskResponses = initialAskResponses.filter(
            (askResponse) =>
              !baselineResponses.some(
                (item) =>
                  item.question === askResponse.question &&
                  item.answer.join("\n\n") === askResponse.answer.join("\n\n")
              )
          );
          return {
            ...current,
            [serviceWeftConversation.id]: [...baselineResponses, ...nextAskResponses],
          };
        });
        setForkRecords((current) => {
          const existingIndex = current.findIndex(
            (record) =>
              record.parentConversationId === sourceConversation.id &&
              record.parentResponseId === response.id
          );
          const nextRecord = {
            id: `fork-${sourceConversation.id}-${response.id}-${serviceWeftConversation.id}`,
            parentConversationId: sourceConversation.id,
            parentResponseId: response.id,
            childConversationId: serviceWeftConversation.id,
            title: serviceWeftConversation.title,
            kind: serviceResult.weft?.weftKind ?? "exploration",
            createdAt: serviceResult.weft?.createdAt ?? new Date().toISOString(),
            updatedAt: serviceResult.weft?.updatedAt,
          };
          if (
            existingIndex >= 0 &&
            current[existingIndex]?.childConversationId === serviceWeftConversation.id
          ) {
            return current.map((record, index) => (index === existingIndex ? nextRecord : record));
          }
          if (current.some((record) => record.id === nextRecord.id)) return current;
          if (existingIndex < 0 || askTurnsToPersist.length > 0) return [...current, nextRecord];
          return current.map((record, index) => (index === existingIndex ? nextRecord : record));
        });
        setComposerDrafts((current) =>
          current[serviceWeftConversation.id]
            ? current
            : { ...current, [serviceWeftConversation.id]: { html: "", links: [] } }
        );
        queueLoomMetadataGeneration(serviceWeftConversation);
        openWeftDestination(localServiceWeft);
        pulseWeftFeedback(
          serviceWeftConversation.id,
          initialAskResponses[initialAskResponses.length - 1]?.id ?? response.id
        );
        showToast({
          title: serviceResult.reused ? "Existing Weft opened" : "Weft started",
          message: serviceResult.reused
            ? "This response already has a Weft."
            : `Started from “${
                (responseTitleOverrides[response.id] ?? response.title).trim() ||
                response.meta?.code ||
                response.id
              }”.`,
          color: "sunset",
          icon: "weft",
        });
        recordGrowthEvent();
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "loom-service could not create or open the Weft.";
        setAskState((current) =>
          current
            ? {
                ...current,
                error: `Could not convert to Weft through loom-service: ${message}`,
              }
            : current
        );
        showToast({
          title: "Weft conversion failed",
          message: "loom-service is unavailable or could not create the Weft.",
          color: "sunset",
          icon: "weft",
        });
        return false;
      }
    }
    if (existingWeft && askTurnsToPersist.length === 0) {
      if (askTurnsToPersist.length > 0) {
        const askResponses = askTurnsToPersist.map((turn, index) =>
          askResponseFromTurn(turn, existingWeft.path, index + 1)
        );
        setConversationResponses((current) => {
          const existingResponses = current[existingWeft.id] ?? [];
          const nextAskResponses = askResponses.filter(
            (askResponse) =>
              !existingResponses.some(
                (item) =>
                  item.question === askResponse.question &&
                  item.answer.join("\n\n") === askResponse.answer.join("\n\n")
              )
          );
          if (nextAskResponses.length === 0) return current;
          return {
            ...current,
            [existingWeft.id]: [...existingResponses, ...nextAskResponses],
          };
        });
      }
      openWeftDestination(existingWeft);
      pulseWeftFeedback(existingWeft.id, response.id);
      showToast({
        title: "Existing Weft opened",
        message: "This response already has a Weft.",
        color: "sunset",
        icon: "weft",
      });
      return true;
    }
    const id = `c-loom-${Date.now()}`;
    const path = `${sourceConversation.path}/loom/${id}`;
    const title = convertedAskTitle;
    const conversation: Conversation = {
      id,
      title,
      path,
      folder: sourceConversation.folder,
      summary: `Branched from ${sourceConversation.title}.`,
      iconKey: "workflow",
      meta: createAddressableLoomMetadata({
        id: createMetadataUuid(),
        title,
        text: metadataTextForLoom({
          title,
          summary: `Branched from ${sourceConversation.title}.`,
        }),
      }),
    };
    const originSeedSourceResponses = askTurnsToPersist.length > 0 ? [] : [response];
    const lineage = originSeedSourceResponses.map((item, index) => {
      const clonedResponse: ResponseItem = {
        ...item,
        id: `${item.id}-${id}`,
        address: `${path}/r-${index + 1}`,
      };
      return {
        ...clonedResponse,
        meta: createDraftResponseMetadata({
          id: createMetadataUuid(),
          title: clonedResponse.title,
          text: metadataTextForResponse(clonedResponse),
        }),
      };
    });
    const initialAskResponses = askTurnsToPersist.map((turn, index) =>
      askResponseFromTurn(turn, path, lineage.length + index + 1)
    );
    const weftResponses = initialAskResponses.length > 0 ? initialAskResponses : lineage;
    setConversations((current) => appendConversationInTabOrder(current, conversation));
    setTabGroups((current) =>
      current.map((group) => {
        const sourceIndex = group.conversationIds.indexOf(sourceConversation.id);
        if (sourceIndex < 0) return group;
        return appendTabGroupConversationId(group, id);
      })
    );
    setConversationResponses((current) => ({
      ...current,
      [id]: weftResponses,
    }));
    setForkRecords((current) => [
      ...current,
      {
        id: `fork-${sourceConversation.id}-${response.id}-${id}`,
        parentConversationId: sourceConversation.id,
        parentResponseId: response.id,
        childConversationId: id,
        title: conversation.title,
        kind: "exploration",
        createdAt: new Date().toISOString(),
      },
    ]);
    setComposerDrafts((current) => ({
      ...current,
      [id]: { html: "", links: [] },
    }));
    queueLoomMetadataGeneration(conversation);
    openWeftDestination(conversation);
    pulseWeftFeedback(
      conversation.id,
      initialAskResponses[initialAskResponses.length - 1]?.id ?? response.id
    );
    showToast({
      title: "Weft started",
      message: `Started from “${
        (responseTitleOverrides[response.id] ?? response.title).trim() ||
        response.meta?.code ||
        response.id
      }”.`,
      color: "sunset",
      icon: "weft",
    });
    recordGrowthEvent();
    return true;
  }

  function returnToOrigin(options: { keepPromptRevisionSelection?: boolean } = {}) {
    const origin = getWeftOrigin(activeConversationId);
    if (!origin) return;
    const originConversation = conversations.find(
      (conversation) => conversation.id === origin.originLoomId
    );
    if (!originConversation) {
      showToast({
        title: "Return unavailable",
        message: "The original Loom is no longer available.",
        color: "neutral",
        icon: "weft",
      });
      return;
    }
    const activeRevisionRecord = forkRecords.find(
      (record) => record.kind === "revision" && record.childConversationId === activeConversationId
    );
    const originResponseId =
      activeRevisionRecord?.revisionSourceResponseId ?? origin.originResponseId;
    if (activeRevisionRecord?.revisionSourceResponseId && options.keepPromptRevisionSelection !== false) {
      setSelectedPromptRevisionByResponseId((current) => ({
        ...current,
        [activeRevisionRecord.revisionSourceResponseId!]: activeRevisionRecord.childConversationId,
      }));
    }
    const originResponse = findResponseInLoom(origin.originLoomId, originResponseId);
    const fallbackResponse = originResponse ?? lastResponseInLoom(origin.originLoomId);
    if (!originResponse) {
      showToast({
        title: "Origin response unavailable",
        message: "The original response is no longer available.",
        color: "neutral",
        icon: "weft",
      });
    }
    const destination: LoomNavigationDestination = {
      loomId: origin.originLoomId,
      mode: canShowWeftSplit ? "split" : "full",
      scrollTargetResponseId: fallbackResponse?.id,
      scrollMode: originResponse ? "origin" : fallbackResponse ? "lastResponse" : undefined,
      source: "returnToOrigin",
    };
    const link = fallbackResponse
      ? responseLinkForNavigation(origin.originLoomId, fallbackResponse)
      : loomLinkForId(origin.originLoomId);
    if (canShowWeftSplit) {
      setActiveConversationId(activeConversationId);
      setActiveSplitPanel("origin");
      pendingScrollDestinationRef.current = destination;
      pendingScrollHighlightRef.current = Boolean(originResponse);
      focusComposerAfterNavigation();
      if (originResponse) {
        window.requestAnimationFrame(() => {
          scrollTranscriptPromptToStart(originTranscriptRef.current, originResponseId);
          window.setTimeout(() => {
            scrollTranscriptPromptToStart(originTranscriptRef.current, originResponseId);
          }, 160);
        });
      }
    } else {
      restoreDestination(link, destination);
    }
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

  function replaceResponseAndPruneTail(
    responses: ResponseItem[],
    sourceResponse: ResponseItem,
    replacement: ResponseItem
  ) {
    const sourceIndex = responses.findIndex(
      (response) =>
        response.id === sourceResponse.id ||
        (sourceResponse.serviceUserResponseId !== undefined &&
          response.serviceUserResponseId === sourceResponse.serviceUserResponseId)
    );
    if (sourceIndex < 0) {
      return [...responses, replacement];
    }
    return [...responses.slice(0, sourceIndex), replacement];
  }

  function visibleWeftSeedResponsesToResponseItems(
    seedResponses: VisibleWeftSeedResponse[] | undefined,
    weftPath: string,
    fallbackQuestion: string
  ): ResponseItem[] {
    const sortedSeeds = [...(seedResponses ?? [])].sort(
      (left, right) => left.sequenceIndex - right.sequenceIndex
    );
    const items: ResponseItem[] = [];
    let pendingUser: VisibleWeftSeedResponse | undefined;
    for (const seed of sortedSeeds) {
      if (seed.role === "user") {
        pendingUser = seed;
        continue;
      }
      const question = pendingUser?.content ?? fallbackQuestion;
      const title = normalizeLoomTitle(seed.title ?? pendingUser?.title ?? question);
      items.push({
        id: seed.responseId,
        title,
        address: `${weftPath}/responses/${seed.responseId}`,
        question,
        createdAt: new Date().toISOString(),
        answer: splitAnswerParagraphs(seed.content),
        suggestedLinks: [],
        bookmarkedLinks: [],
        serviceUserResponseId: pendingUser?.responseId,
        meta: createDraftResponseMetadata({
          id: createMetadataUuid(),
          title,
          text: `${question}\n\n${seed.content}`,
        }),
      });
      pendingUser = undefined;
    }
    return items;
  }

  async function createRevisionWeftFromPromptEdit(
    loomId: string,
    responseId: string,
    normalizedPrompt: string
  ) {
    const sourceConversation = conversations.find((conversation) => conversation.id === loomId);
    const sourceResponses = conversationResponses[loomId] ?? [];
    const sourceIndex = sourceResponses.findIndex((response) => response.id === responseId);
    const sourceResponse = sourceResponses[sourceIndex];
    const anchorResponse = sourceIndex > 0 ? sourceResponses[sourceIndex - 1] : undefined;
    if (!sourceConversation || !sourceResponse) return false;
    if (!anchorResponse) {
      showToast({
        title: "Revision unavailable",
        message: "Editing the root prompt needs the root-origin strategy before it can branch safely.",
        color: "sunset",
        icon: "weft",
      });
      return false;
    }
    const revisionWeftTitle = compactLoomTitle(`Revision: ${normalizedPrompt}`);
    const revisionResponseTitle = compactLoomTitle(normalizedPrompt);

    let serviceResult: CreateOrOpenWeftResult;
    try {
      serviceResult = await loomEngineClient.createOrOpenWeft({
        originLoomId: sourceConversation.id,
        originResponseId: anchorResponse.id,
        title: revisionWeftTitle,
        summary: `Edited continuation from ${sourceConversation.title}.`,
        reuseExisting: false,
        source: "response_action",
        weftKind: "revision",
        seedMode: "none",
        createOriginContextSnapshot: true,
        metadata: sanitizeWeftMetadataValue({
          editSource: "prompt_edit",
          editedResponseId: sourceResponse.id,
          editedUserResponseId: sourceResponse.serviceUserResponseId,
          originalPrompt: sourceResponse.question,
          revisionPrompt: normalizedPrompt,
        }),
      });
    } catch (error) {
      showToast({
        title: "Revision Weft failed",
        message: error instanceof Error ? error.message : "loom-service could not create the Revision Weft.",
        color: "sunset",
        icon: "weft",
      });
      return false;
    }

    const serviceWeft = serviceResult.weft;
    const weftConversation: Conversation = {
      id: serviceResult.loomId,
      title: serviceWeft?.title ?? revisionWeftTitle,
      path: serviceWeft?.canonicalUri ?? `${sourceConversation.path}/revision/${serviceResult.loomId}`,
      folder: "Wefts",
      summary: serviceWeft?.summary ?? `Edited continuation from ${sourceConversation.title}.`,
      iconKey: "workflow",
      meta: {
        ...createAddressableLoomMetadata({
          id: serviceResult.loomId,
          title: serviceWeft?.title ?? revisionWeftTitle,
          text: serviceWeft?.summary ?? `Edited continuation from ${sourceConversation.title}.`,
        }),
        code: serviceWeft?.code,
        displayCode: serviceWeft?.displayCode,
        canonicalUri: serviceWeft?.canonicalUri,
      },
    };
    const seedItems: ResponseItem[] = [];
    const localResponseId = `revision-${sourceResponse.id}-${Date.now()}`;
    const revisionResponse: ResponseItem = {
      id: localResponseId,
      title: revisionResponseTitle,
      address: `${weftConversation.path}/responses/${localResponseId}`,
      question: normalizedPrompt,
      createdAt: new Date().toISOString(),
      questionReferences: sourceResponse.questionReferences,
      answer: [""],
      visibleProgress: createInitialVisibleAnswerProgress(),
      suggestedLinks: [],
      bookmarkedLinks: [],
      meta: createDraftResponseMetadata({
        id: createMetadataUuid(),
        title: revisionResponseTitle,
        text: normalizedPrompt,
      }),
    };

    setConversations((current) => {
      if (current.some((conversation) => conversation.id === weftConversation.id)) return current;
      return appendConversationInTabOrder(current, weftConversation);
    });
    setConversationResponses((current) => ({
      ...current,
      [weftConversation.id]: [...seedItems, revisionResponse],
    }));
    setForkRecords((current) => [
      ...current.filter(
        (record) =>
          !(
            record.parentConversationId === sourceConversation.id &&
            record.parentResponseId === sourceResponse.id &&
            record.childConversationId === weftConversation.id
          )
      ),
      {
        id: `fork-${sourceConversation.id}-${sourceResponse.id}-${weftConversation.id}`,
        parentConversationId: sourceConversation.id,
        parentResponseId: sourceResponse.id,
        childConversationId: weftConversation.id,
        title: weftConversation.title,
        kind: "revision",
        revisionSourceResponseId: sourceResponse.id,
        revisionPrompt: normalizedPrompt,
        originalPrompt: sourceResponse.question,
        createdAt: serviceWeft?.createdAt ?? new Date().toISOString(),
        updatedAt: serviceWeft?.updatedAt,
      },
    ]);
    setSelectedPromptRevisionByResponseId((current) => ({
      ...current,
      [sourceResponse.id]: weftConversation.id,
    }));
    setComposerDrafts((current) => ({
      ...current,
      [weftConversation.id]: current[weftConversation.id] ?? { html: "", links: [] },
    }));

    const destination: LoomNavigationDestination = {
      loomId: weftConversation.id,
      mode: canShowWeftSplit ? "split" : "full",
      originLoomId: sourceConversation.id,
      originResponseId: sourceResponse.id,
      scrollTargetResponseId: sourceResponse.id,
      scrollMode: "origin",
      source: "weftCreate",
    };
    const link: LoomLink = {
      id: weftConversation.id,
      type: "loom",
      title: weftConversation.title,
      path: weftConversation.path,
      badge: typeLabel.loom,
      canonicalUri: weftConversation.meta?.canonicalUri,
      meta: weftConversation.meta,
    };
    setActiveConversationId(weftConversation.id);
    setActiveSplitPanel("weft");
    setActiveObjectTitle(weftConversation.title);
    restoreDestination(link, destination);
    setActiveSplitPanel("weft");
    pushNavigationEntry(link, destination);
    pendingScrollDestinationRef.current = destination;
    pendingScrollHighlightRef.current = false;
    setGeneratingResponseId(localResponseId);

    const generationId = mainGenerationRef.current + 1;
    mainGenerationRef.current = generationId;
    const controller = new AbortController();
    mainAbortRef.current = controller;
    let activeResponseId = localResponseId;
    let finalContent = "";
    const mainModel = getProfileModel(providerSettings, "main");
    const mainModelName = mainModel.name;
    setComposerRuntimeState({
      running: true,
      message: `Writing Revision Weft with ${mainModelName}...`,
    });

    const replaceActiveResponseId = (nextResponseId: string, userResponseId?: string) => {
      if (nextResponseId === activeResponseId) return;
      const previousResponseId = activeResponseId;
      activeResponseId = nextResponseId;
      setGeneratingResponseId(nextResponseId);
      setConversationResponses((current) => ({
        ...current,
        [weftConversation.id]: (current[weftConversation.id] ?? []).map((item) =>
          item.id === previousResponseId
            ? { ...item, id: nextResponseId, serviceUserResponseId: item.serviceUserResponseId ?? userResponseId }
            : item
        ),
      }));
    };

    try {
      for await (const event of loomEngineClient.sendMessage({
        loomId: weftConversation.id,
        draftKey: weftConversation.id,
        promptText: normalizedPrompt,
        references: sourceResponse.questionReferences ?? [],
        responseMode: appSettings.modelResponseMode,
        focusedResponseId: seedItems[seedItems.length - 1]?.id,
        source: "composer",
        model: mainModel.id,
        options: {
          numCtx: providerSettings.ollama.contextLength,
        },
        persistWorkflow: true,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted || mainGenerationRef.current !== generationId) return true;
        if (event.type === "user_message_created") {
          setConversationResponses((current) => ({
            ...current,
            [weftConversation.id]: (current[weftConversation.id] ?? []).map((item) =>
              item.id === activeResponseId
                ? { ...item, serviceUserResponseId: event.payload.responseId }
                : item
            ),
          }));
          continue;
        }
        if (event.type === "assistant_placeholder_created") {
          replaceActiveResponseId(event.payload.responseId);
          continue;
        }
        if (event.type === "content_delta") {
          if (event.payload.responseId) replaceActiveResponseId(event.payload.responseId);
          finalContent += event.payload.delta;
          const firstFinalStartedAt = new Date().toISOString();
          updateResponseThinking(weftConversation.id, activeResponseId, {
            finalStartedAt: firstFinalStartedAt,
            thinkingEndedAt: firstFinalStartedAt,
          });
          updateResponseVisiblePlanAndProgress(weftConversation.id, activeResponseId, undefined, undefined);
          updateResponseMarkdown(weftConversation.id, activeResponseId, finalContent);
          continue;
        }
        if (event.type === "response_completed" || event.type === "response_truncated") {
          replaceActiveResponseId(event.payload.responseId);
          const sanitizedFinalContent = sanitizeModelAnswer(finalContent);
          updateResponseMarkdown(weftConversation.id, activeResponseId, sanitizedFinalContent);
          updateResponseThinking(weftConversation.id, activeResponseId, {
            finalContent: sanitizedFinalContent,
            doneReason: event.payload.doneReason,
            truncated: event.type === "response_truncated",
            done: true,
          });
          updateResponseVisiblePlanAndProgress(weftConversation.id, activeResponseId, undefined, undefined);
          setComposerRuntimeState({ running: false, message: "Revision Weft ready." });
          setGeneratingResponseId(null);
          mainAbortRef.current = null;
          return true;
        }
        if (event.type === "response_error") {
          const message = event.payload.message;
          updateResponseAnswer(weftConversation.id, activeResponseId, [message]);
          updateResponseVisiblePlanAndProgress(weftConversation.id, activeResponseId, undefined, undefined);
          setComposerRuntimeState({ running: false, message });
          setGeneratingResponseId(null);
          mainAbortRef.current = null;
          return true;
        }
      }
    } catch (error) {
      const message = providerErrorMessage(error);
      updateResponseAnswer(weftConversation.id, activeResponseId, [message]);
      updateResponseVisiblePlanAndProgress(weftConversation.id, activeResponseId, undefined, undefined);
      setComposerRuntimeState({ running: false, message });
      setGeneratingResponseId(null);
      mainAbortRef.current = null;
      return true;
    }
    return true;
  }

  async function updateResponsePrompt(loomId: string, responseId: string, nextPrompt: string) {
    const normalizedPrompt = normalizePromptEditText(nextPrompt);
    if (!normalizedPrompt) return false;
    const currentResponse = conversationResponses[loomId]?.find((response) => response.id === responseId);
    if (currentResponse && normalizePromptEditText(currentResponse.question) === normalizedPrompt) {
      return false;
    }
    const serviceUserResponseId = currentResponse?.serviceUserResponseId;
    let shouldRegenerateFromServiceEdit = false;
    let editedServiceResponse: ResponseItem | undefined;
    if (getConfiguredLoomEngineMode() === "rust-service" && serviceUserResponseId) {
      return createRevisionWeftFromPromptEdit(loomId, responseId, normalizedPrompt);
    }
    setConversationResponses((current) => ({
      ...current,
      [loomId]: (current[loomId] ?? []).map((response) =>
        response.id === responseId
          ? {
              ...response,
              question: normalizedPrompt,
              promptEditedAt: new Date().toISOString(),
              answerStale: shouldRegenerateFromServiceEdit
                ? false
                : response.answer.join("\n\n").trim().length > 0,
            }
          : response
      ),
    }));
    if (shouldRegenerateFromServiceEdit) {
      void regenerateFromEditedPrompt(loomId, responseId, editedServiceResponse);
    }
    return true;
  }

  async function regenerateFromEditedPrompt(
    loomId: string,
    responseId: string,
    sourceResponseOverride?: ResponseItem
  ) {
    const sourceResponse =
      sourceResponseOverride ?? conversationResponses[loomId]?.find((response) => response.id === responseId);
    if (!sourceResponse?.serviceUserResponseId) {
      showToast({
        title: "Regenerate unavailable",
        message: "This prompt is not persisted in loom-service yet.",
        color: "sunset",
      });
      return;
    }
    const generationId = mainGenerationRef.current + 1;
    mainGenerationRef.current = generationId;
    const controller = new AbortController();
    mainAbortRef.current = controller;
    const localResponseId = `regenerated-${sourceResponse.id}-${Date.now()}`;
    let activeResponseId = localResponseId;
    let finalContent = "";
    const mainModel = getProfileModel(providerSettings, "main");
    const mainModelName = mainModel.name;
    const regeneratedResponse: ResponseItem = {
      ...sourceResponse,
      id: localResponseId,
      address: `${sourceResponse.address}/regenerated-${Date.now().toString(36)}`,
      answer: [],
      finalContent: undefined,
      answerStale: false,
      workflowRunId: undefined,
      visiblePlan: undefined,
      visibleProgress: createOrchestrationVisibleProgress(),
      doneReason: undefined,
      truncated: false,
      bookmarked: false,
    };
    setConversationResponses((current) => ({
      ...current,
      [loomId]: replaceResponseAndPruneTail(current[loomId] ?? [], sourceResponse, regeneratedResponse),
    }));
    setGeneratingResponseId(localResponseId);
    setComposerRuntimeState({
      running: true,
      message: `Regenerating through loom-service with ${mainModelName}...`,
    });
    mainServiceCancellationRef.current = {
      loomId,
      responseId: localResponseId,
      cancelRequested: false,
    };

    const replaceActiveResponseId = (nextResponseId: string) => {
      if (nextResponseId === activeResponseId) return;
      const previousResponseId = activeResponseId;
      activeResponseId = nextResponseId;
      setGeneratingResponseId(nextResponseId);
      if (mainServiceCancellationRef.current) {
        mainServiceCancellationRef.current = {
          ...mainServiceCancellationRef.current,
          responseId: nextResponseId,
        };
      }
      setConversationResponses((current) => ({
        ...current,
        [loomId]: (current[loomId] ?? []).map((item) =>
          item.id === previousResponseId ? { ...item, id: nextResponseId } : item
        ),
      }));
    };

    try {
      for await (const event of loomEngineClient.regenerateFromResponse({
        loomId,
        userResponseId: sourceResponse.serviceUserResponseId,
        staleAssistantResponseId: sourceResponse.id,
        responseMode: appSettings.modelResponseMode,
        source: "prompt_edit_regenerate",
        model: mainModel.id,
        options: {
          numCtx: providerSettings.ollama.contextLength,
        },
        signal: controller.signal,
      })) {
        if (controller.signal.aborted || mainGenerationRef.current !== generationId) return;
        if (event.type === "user_message_created") {
          if (event.payload.workflowRunId) {
            mainServiceCancellationRef.current = {
              loomId,
              responseId: activeResponseId,
              workflowRunId: event.payload.workflowRunId,
              cancelRequested: false,
            };
          }
          continue;
        }
        if (event.type === "assistant_placeholder_created") {
          if (event.payload.workflowRunId) {
            mainServiceCancellationRef.current = {
              loomId,
              responseId: event.payload.responseId,
              workflowRunId: event.payload.workflowRunId,
              cancelRequested: false,
            };
          }
          replaceActiveResponseId(event.payload.responseId);
          continue;
        }
        if (event.type === "context_ready") {
          updateResponseVisibleProgress(
            loomId,
            activeResponseId,
            activateVisibleAnswerStage(
              regeneratedResponse.visibleProgress ?? createOrchestrationVisibleProgress(),
              "context",
              "Building Loom context..."
            )
          );
          continue;
        }
        if (event.type === "thinking_status") {
          updateResponseThinking(loomId, activeResponseId, {
            thinkingStartedAt: new Date().toISOString(),
            elapsedThinkingSeconds:
              event.payload.durationMs !== undefined
                ? Math.round(event.payload.durationMs / 1000)
                : undefined,
          });
          continue;
        }
        if (event.type === "content_delta") {
          if (event.payload.responseId) replaceActiveResponseId(event.payload.responseId);
          finalContent += event.payload.delta;
          const firstFinalStartedAt = new Date().toISOString();
          updateResponseThinking(loomId, activeResponseId, {
            finalStartedAt: firstFinalStartedAt,
            thinkingEndedAt: firstFinalStartedAt,
          });
          updateResponseVisiblePlanAndProgress(loomId, activeResponseId, undefined, undefined);
          updateResponseMarkdown(loomId, activeResponseId, finalContent);
          continue;
        }
        if (event.type === "response_completed" || event.type === "response_truncated") {
          replaceActiveResponseId(event.payload.responseId);
          const sanitizedFinalContent = sanitizeModelAnswer(finalContent);
          const answer = answerParagraphs(sanitizedFinalContent);
          const completedResponse: ResponseItem = {
            ...regeneratedResponse,
            id: activeResponseId,
            answer,
            finalContent: sanitizedFinalContent,
            doneReason: event.payload.doneReason,
            truncated: event.type === "response_truncated",
            workflowRunId: mainServiceCancellationRef.current?.workflowRunId,
            visibleProgress: undefined,
            meta: createDraftResponseMetadata({
              id: createMetadataUuid(),
              title: sourceResponse.title,
              text: metadataTextForResponse({
                title: sourceResponse.title,
                question: sourceResponse.question,
                answer,
              }),
            }),
          };
          updateResponseThinking(loomId, activeResponseId, {
            finalContent: sanitizedFinalContent,
            doneReason: event.payload.doneReason,
            truncated: event.type === "response_truncated",
            done: true,
          });
          setConversationResponses((current) => ({
            ...current,
            [loomId]: (current[loomId] ?? []).map((item) =>
              item.id === activeResponseId
                ? {
                    ...item,
                    ...completedResponse,
                    thinkingEndedAt:
                      item.thinkingStartedAt && !item.thinkingEndedAt
                        ? new Date().toISOString()
                        : item.thinkingEndedAt,
                  }
                : item
            ),
          }));
          setComposerRuntimeState({ running: false, message: "Prompt regenerated." });
          setGeneratingResponseId(null);
          showResponseCompletionActions(activeResponseId);
          queueResponseMetadataGeneration(loomId, completedResponse);
          mainAbortRef.current = null;
          mainServiceCancellationRef.current = null;
          return;
        }
        if (event.type === "response_error") {
          if (event.payload.responseId) replaceActiveResponseId(event.payload.responseId);
          const message = event.payload.message;
          updateResponseThinking(loomId, activeResponseId, { done: true });
          updateResponseAnswer(loomId, activeResponseId, [message]);
          updateResponseVisiblePlanAndProgress(loomId, activeResponseId, undefined, undefined);
          setComposerRuntimeState({ running: false, message });
          setGeneratingResponseId(null);
          showResponseCompletionActions(activeResponseId);
          mainAbortRef.current = null;
          mainServiceCancellationRef.current = null;
          return;
        }
        if (event.type === "response_cancelled") {
          updateResponseThinking(loomId, activeResponseId, { done: true });
          setComposerRuntimeState({ running: false, message: "Response stopped." });
          setGeneratingResponseId(null);
          showResponseCompletionActions(activeResponseId);
          mainAbortRef.current = null;
          mainServiceCancellationRef.current = null;
          return;
        }
      }
    } catch (error) {
      const message = providerErrorMessage(error);
      showToast({
        title: "Regenerate failed",
        message,
        color: "sunset",
      });
      setConversationResponses((current) => ({
        ...current,
        [loomId]: (current[loomId] ?? []).map((item) =>
          item.id === activeResponseId
            ? {
                ...sourceResponse,
                id: activeResponseId,
                answer: [message],
                finalContent: message,
                answerStale: false,
                visibleProgress: undefined,
              }
            : item
        ),
      }));
      setGeneratingResponseId(null);
      setComposerRuntimeState({ running: false, message });
      mainAbortRef.current = null;
      mainServiceCancellationRef.current = null;
    }
  }

  async function retryFromUserMessage(
    loomId: string,
    responseId: string,
    returnFocus: HTMLElement | null = null
  ) {
    const responses = conversationResponses[loomId] ?? [];
    const sourceIndex = responses.findIndex((response) => response.id === responseId);
    const sourceResponse = responses[sourceIndex];
    if (!sourceResponse?.serviceUserResponseId) {
      showToast({
        title: "Retry unavailable",
        message: "This prompt is not persisted in loom-service yet.",
        color: "sunset",
      });
      return;
    }
    const hasDownstreamActiveMessages = sourceIndex >= 0 && sourceIndex < responses.length - 1;
    if (hasDownstreamActiveMessages) {
      setRetryConfirmTarget({ loomId, responseId, returnFocus });
      return;
    }

    await executeRetryFromUserMessage(loomId, responseId);
  }

  async function executeRetryFromUserMessage(loomId: string, responseId: string) {
    const responses = conversationResponses[loomId] ?? [];
    const sourceIndex = responses.findIndex((response) => response.id === responseId);
    const sourceResponse = responses[sourceIndex];
    if (!sourceResponse?.serviceUserResponseId) {
      showToast({
        title: "Retry unavailable",
        message: "This prompt is not persisted in loom-service yet.",
        color: "sunset",
      });
      return;
    }

    const generationId = mainGenerationRef.current + 1;
    mainGenerationRef.current = generationId;
    const controller = new AbortController();
    mainAbortRef.current = controller;
    const localResponseId = `retry-${sourceResponse.id}-${Date.now()}`;
    let activeResponseId = localResponseId;
    let finalContent = "";
    const mainModel = getProfileModel(providerSettings, "main");
    const mainModelName = mainModel.name;
    const retryResponse: ResponseItem = {
      ...sourceResponse,
      id: localResponseId,
      address: `${sourceResponse.address}/retry-${Date.now().toString(36)}`,
      answer: [],
      finalContent: undefined,
      answerStale: false,
      workflowRunId: undefined,
      visiblePlan: undefined,
      visibleProgress: createOrchestrationVisibleProgress(),
      doneReason: undefined,
      truncated: false,
      bookmarked: false,
    };
    setConversationResponses((current) => ({
      ...current,
      [loomId]: replaceResponseAndPruneTail(current[loomId] ?? [], sourceResponse, retryResponse),
    }));
    setGeneratingResponseId(localResponseId);
    setComposerRuntimeState({
      running: true,
      message: `Retrying through loom-service with ${mainModelName}...`,
    });
    mainServiceCancellationRef.current = {
      loomId,
      responseId: localResponseId,
      cancelRequested: false,
    };

    const replaceActiveResponseId = (nextResponseId: string) => {
      if (nextResponseId === activeResponseId) return;
      const previousResponseId = activeResponseId;
      activeResponseId = nextResponseId;
      setGeneratingResponseId(nextResponseId);
      if (mainServiceCancellationRef.current) {
        mainServiceCancellationRef.current = {
          ...mainServiceCancellationRef.current,
          responseId: nextResponseId,
        };
      }
      setConversationResponses((current) => ({
        ...current,
        [loomId]: (current[loomId] ?? []).map((item) =>
          item.id === previousResponseId ? { ...item, id: nextResponseId } : item
        ),
      }));
    };

    try {
      for await (const event of loomEngineClient.retryUserMessage({
        loomId,
        userResponseId: sourceResponse.serviceUserResponseId,
        responseMode: appSettings.modelResponseMode,
        softDeleteDownstream: true,
        reason: "retry_from_user_message",
        model: mainModel.id,
        options: {
          numCtx: providerSettings.ollama.contextLength,
        },
        signal: controller.signal,
      })) {
        if (controller.signal.aborted || mainGenerationRef.current !== generationId) return;
        if (event.type === "user_message_created") {
          if (event.payload.workflowRunId) {
            mainServiceCancellationRef.current = {
              loomId,
              responseId: activeResponseId,
              workflowRunId: event.payload.workflowRunId,
              cancelRequested: false,
            };
          }
          continue;
        }
        if (event.type === "assistant_placeholder_created") {
          if (event.payload.workflowRunId) {
            mainServiceCancellationRef.current = {
              loomId,
              responseId: event.payload.responseId,
              workflowRunId: event.payload.workflowRunId,
              cancelRequested: false,
            };
          }
          replaceActiveResponseId(event.payload.responseId);
          continue;
        }
        if (event.type === "context_ready") {
          updateResponseVisibleProgress(
            loomId,
            activeResponseId,
            activateVisibleAnswerStage(
              retryResponse.visibleProgress ?? createOrchestrationVisibleProgress(),
              "context",
              "Building Loom context..."
            )
          );
          continue;
        }
        if (event.type === "thinking_status") {
          updateResponseThinking(loomId, activeResponseId, {
            thinkingStartedAt: new Date().toISOString(),
            elapsedThinkingSeconds:
              event.payload.durationMs !== undefined
                ? Math.round(event.payload.durationMs / 1000)
                : undefined,
          });
          continue;
        }
        if (event.type === "content_delta") {
          if (event.payload.responseId) replaceActiveResponseId(event.payload.responseId);
          finalContent += event.payload.delta;
          const firstFinalStartedAt = new Date().toISOString();
          updateResponseThinking(loomId, activeResponseId, {
            finalStartedAt: firstFinalStartedAt,
            thinkingEndedAt: firstFinalStartedAt,
          });
          updateResponseVisiblePlanAndProgress(loomId, activeResponseId, undefined, undefined);
          updateResponseMarkdown(loomId, activeResponseId, finalContent);
          continue;
        }
        if (event.type === "response_completed" || event.type === "response_truncated") {
          replaceActiveResponseId(event.payload.responseId);
          const sanitizedFinalContent = sanitizeModelAnswer(finalContent);
          const answer = answerParagraphs(sanitizedFinalContent);
          const completedResponse: ResponseItem = {
            ...retryResponse,
            id: activeResponseId,
            answer,
            finalContent: sanitizedFinalContent,
            doneReason: event.payload.doneReason,
            truncated: event.type === "response_truncated",
            workflowRunId: mainServiceCancellationRef.current?.workflowRunId,
            visibleProgress: undefined,
            meta: createDraftResponseMetadata({
              id: createMetadataUuid(),
              title: sourceResponse.title,
              text: metadataTextForResponse({
                title: sourceResponse.title,
                question: sourceResponse.question,
                answer,
              }),
            }),
          };
          updateResponseThinking(loomId, activeResponseId, {
            finalContent: sanitizedFinalContent,
            doneReason: event.payload.doneReason,
            truncated: event.type === "response_truncated",
            done: true,
          });
          setConversationResponses((current) => ({
            ...current,
            [loomId]: (current[loomId] ?? []).map((item) =>
              item.id === activeResponseId
                ? {
                    ...item,
                    ...completedResponse,
                    thinkingEndedAt:
                      item.thinkingStartedAt && !item.thinkingEndedAt
                        ? new Date().toISOString()
                        : item.thinkingEndedAt,
                  }
                : item
            ),
          }));
          setComposerRuntimeState({ running: false, message: "Message retried." });
          setGeneratingResponseId(null);
          showResponseCompletionActions(activeResponseId);
          queueResponseMetadataGeneration(loomId, completedResponse);
          mainAbortRef.current = null;
          mainServiceCancellationRef.current = null;
          return;
        }
        if (event.type === "response_error") {
          if (event.payload.responseId) replaceActiveResponseId(event.payload.responseId);
          const message = event.payload.message;
          updateResponseThinking(loomId, activeResponseId, { done: true });
          updateResponseAnswer(loomId, activeResponseId, [message]);
          updateResponseVisiblePlanAndProgress(loomId, activeResponseId, undefined, undefined);
          setComposerRuntimeState({ running: false, message });
          setGeneratingResponseId(null);
          showResponseCompletionActions(activeResponseId);
          mainAbortRef.current = null;
          mainServiceCancellationRef.current = null;
          return;
        }
        if (event.type === "response_cancelled") {
          updateResponseThinking(loomId, activeResponseId, { done: true });
          setComposerRuntimeState({ running: false, message: "Response stopped." });
          setGeneratingResponseId(null);
          showResponseCompletionActions(activeResponseId);
          mainAbortRef.current = null;
          mainServiceCancellationRef.current = null;
          return;
        }
      }
    } catch (error) {
      const message = providerErrorMessage(error);
      showToast({
        title: "Retry failed",
        message,
        color: "sunset",
      });
      setConversationResponses((current) => ({
        ...current,
        [loomId]: (current[loomId] ?? []).map((item) =>
          item.id === activeResponseId
            ? {
                ...sourceResponse,
                id: activeResponseId,
                answer: [message],
                finalContent: message,
                answerStale: false,
                visibleProgress: undefined,
              }
            : item
        ),
      }));
      setGeneratingResponseId(null);
      setComposerRuntimeState({ running: false, message });
      mainAbortRef.current = null;
      mainServiceCancellationRef.current = null;
    }
  }

  function restoreRetryConfirmationFocus(target: HTMLElement | null) {
    window.requestAnimationFrame(() => {
      if (target?.isConnected) {
        target.focus();
        return;
      }
      composerFocusRef.current?.();
    });
  }

  function cancelRetryConfirmation() {
    const target = retryConfirmTarget;
    setRetryConfirmTarget(null);
    restoreRetryConfirmationFocus(target?.returnFocus ?? null);
  }

  function confirmRetryFromDialog() {
    const target = retryConfirmTarget;
    setRetryConfirmTarget(null);
    restoreRetryConfirmationFocus(target?.returnFocus ?? null);
    if (!target) return;
    void executeRetryFromUserMessage(target.loomId, target.responseId);
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
        closeUnpinnedUtilityOverlays();
      }
      if (item.id === "pin" || item.id === "unpin") togglePinnedConversation(conversation);
      if (item.id === "rename" || item.id === "change-icon") setIconPickerTarget(conversation);
      if (item.id === "move-to-group" && item.targetGroupId) {
        addConversationToGroup(conversation.id, item.targetGroupId);
      }
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
      if (item.id === "copy-answer-markdown") void copyResponseAsMarkdown(response);
      if (item.id === "copy-answer-rich") void copyResponseAsRichText(response);
      if (item.id === "copy-answer-plain") void copyResponseAsPlainText(response);
      if (item.id === "bookmark-suggested") bookmarkSuggestedLinks(response);
      if (item.id === "rename") renameResponse(response);
      if (item.id === "open-graph") {
        setActiveObjectTitle(response.title);
        openGraphOverlay();
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
      if (item.id === "rename") setGroupColorTarget(group);
      if (item.id === "set-group-color") setGroupColorTarget(group);
      if (item.id === "new-tab-group") createConversationInGroup(group.id);
      if (item.id === "ungroup") ungroupTabGroup(group.id);
      if (item.id === "delete-group") deleteTabGroup(group);
    }
  }

  function openAsk(response: ResponseItem, selectedText = "", sourceLoomId = activeConversationId) {
    const capsuleKey = `${sourceLoomId}:${response.id}`;
    const capsule =
      responseContextCapsules[capsuleKey] ??
      createHeuristicResponseContextCapsule(response, sourceLoomId, selectedText);
    if (!responseContextCapsules[capsuleKey]) {
      setResponseContextCapsules((current) => ({ ...current, [capsuleKey]: capsule }));
    }
    queueQuickResponseContextCapsule(response, sourceLoomId, selectedText, capsuleKey);
    setSelectionAskState(null);
    clearSelectionHighlight();
    setAskState({
      sessionId: `ask-${sourceLoomId}-${response.id}-${Date.now()}`,
      response,
      selectedText: selectedText || capsule.summary,
      sourceResponseId: response.id,
      contextKind: "response",
      contextPreview: [
        capsule.responseCode ? `${capsule.responseCode} · ${capsule.title}` : capsule.title,
        selectedText ? `Selected text: ${selectedText}` : "",
        capsule.summary,
      ]
        .filter(Boolean)
        .join("\n\n"),
      contextModeLabel: "Using compact context",
      question: "",
      answered: false,
      exchanges: [],
      sourceLoomId,
    });
  }

  function queueQuickResponseContextCapsule(
    response: ResponseItem,
    sourceLoomId: string,
    selectedText: string,
    capsuleKey: string
  ) {
    if (!canAttemptMetadataGeneration()) return;
    const sourceText = response.answer.join("\n\n").trim();
    if (sourceText.length < 1200) return;
    void runModelProfileRequest(providerSettings, {
      profile: "quick",
      effort: "Low",
      mode: "instant",
      prompt: [
        "Create compact source notes for answering follow-up questions about this response.",
        "Preserve factual details, decisions, names, code identifiers, and important constraints.",
        "Do not include the full text.",
        'Return JSON only: {"summary":"...","keyPoints":["..."],"keywords":["..."],"entities":["..."],"codeBlocks":[{"language":"...","summary":"..."}]}',
        "",
        `Title: ${response.title}`,
        `Response code: ${response.meta?.code ?? ""}`,
        `Response text:\n${sourceText.slice(0, 6000)}`,
      ].join("\n"),
      system: "Return compact JSON only for Loom Ask source notes.",
    })
      .then((result) => {
        const parsed = JSON.parse(result.text) as Partial<ResponseContextCapsule>;
        const heuristic = createHeuristicResponseContextCapsule(response, sourceLoomId, selectedText);
        setResponseContextCapsules((current) => ({
          ...current,
          [capsuleKey]: {
            ...heuristic,
            summary: typeof parsed.summary === "string" ? parsed.summary : heuristic.summary,
            keyPoints: Array.isArray(parsed.keyPoints)
              ? parsed.keyPoints.filter((item): item is string => typeof item === "string").slice(0, 8)
              : heuristic.keyPoints,
            keywords: Array.isArray(parsed.keywords)
              ? parsed.keywords.filter((item): item is string => typeof item === "string").slice(0, 12)
              : heuristic.keywords,
            entities: Array.isArray(parsed.entities)
              ? parsed.entities.filter((item): item is string => typeof item === "string").slice(0, 12)
              : heuristic.entities,
            codeBlocks: Array.isArray(parsed.codeBlocks)
              ? parsed.codeBlocks
                  .filter(
                    (item): item is { language?: string; summary: string } =>
                      typeof item === "object" &&
                      item !== null &&
                      typeof item.summary === "string"
                  )
                  .slice(0, 4)
              : heuristic.codeBlocks,
            codeBlockSummaries: Array.isArray(parsed.codeBlocks)
              ? parsed.codeBlocks
                  .filter(
                    (item): item is { language?: string; summary: string } =>
                      typeof item === "object" &&
                      item !== null &&
                      typeof item.summary === "string"
                  )
                  .slice(0, 4)
              : heuristic.codeBlockSummaries,
            capsuleSource: "quickModel",
            generatedBy: "quickModel",
            updatedAt: Date.now(),
          },
        }));
      })
      .catch(() => {
        // Heuristic capsule remains available; Ask should never wait on distillation.
      });
  }

  function updateLatestQuickAskAnswer(question: string, answer: string) {
    const visibleAnswer = stripQuickAskFocusSubjectPrefix(answer);
    setAskState((current) => {
      if (!current) return current;
      const exchanges = current.exchanges ?? [];
      return {
        ...current,
        answer: visibleAnswer,
        exchanges: exchanges.map((exchange, index) =>
          index === exchanges.length - 1 && exchange.question === question
            ? { ...exchange, answer: visibleAnswer }
            : exchange
        ),
      };
    });
  }

  function stripQuickAskFocusSubjectPrefix(answer: string) {
    return answer
      .replace(/^\s*(Focus subject|Answer focus|Current task|Composed task|Answer requirements):\s*/i, "")
      .trimStart();
  }

  async function revealQuickAskAnswer(
    question: string,
    answer: string,
    generationId: number
  ) {
    const parts = answer.match(/\S+\s*/g) ?? [answer];
    let visible = "";
    for (const part of parts) {
      if (quickGenerationRef.current !== generationId) {
        updateLatestQuickAskAnswer(question, completeOpenMarkdownCodeFence(visible));
        return false;
      }
      visible += part;
      updateLatestQuickAskAnswer(question, visible);
      await delay(18);
    }
    if (quickGenerationRef.current !== generationId) {
      updateLatestQuickAskAnswer(question, completeOpenMarkdownCodeFence(visible));
      return false;
    }
    updateLatestQuickAskAnswer(question, answer);
    return true;
  }

  function stopQuickAskResponse() {
    quickGenerationRef.current += 1;
    quickAbortRef.current?.abort();
    quickAbortRef.current = null;
    const question = quickRevealQuestionRef.current;
    if (question) {
      setAskState((current) => {
        if (!current) return current;
        const exchanges = current.exchanges ?? [];
        const nextExchanges = exchanges.map((exchange, index) =>
          index === exchanges.length - 1 && exchange.question === question
            ? {
                ...exchange,
                answer: completeOpenMarkdownCodeFence(exchange.answer),
              }
            : exchange
        );
        return {
          ...current,
          running: false,
          answer: nextExchanges[nextExchanges.length - 1]?.answer ?? current.answer,
          exchanges: nextExchanges,
        };
      });
    } else {
      setAskState((current) => current ? { ...current, running: false } : current);
    }
    quickRevealQuestionRef.current = null;
  }

  function quickAskActiveReferencesFromState(state: AskState): AskActiveReferenceContext[] {
    const selectedLabel = state.sourceSelectedText?.trim() || state.selectedText?.trim();
    const sourceFragment = state.sourceFragment;
    if (!selectedLabel && !sourceFragment?.title) return [];
    const label = selectedLabel || sourceFragment?.title || "Active Reference";
    return [
      {
        label,
        targetKind: sourceFragment?.type ?? state.contextKind,
        targetId: sourceFragment?.targetObjectId ?? sourceFragment?.sourceResponseId ?? state.sourceResponseId,
        targetUri: sourceFragment?.canonicalUri ?? sourceFragment?.path,
        selectedText: sourceFragment?.selectedText ?? selectedLabel,
        preview: state.contextPreview,
        sourceResponseId: sourceFragment?.sourceResponseId ?? state.sourceResponseId ?? state.response.id,
      },
    ];
  }

  async function submitQuickQuestion() {
    if (!askState || askState.running) return;
    const prompt = askState.question.trim();
    if (!prompt) {
      setAskState({ ...askState, error: "Write a quick question first." });
      return;
    }
    const useRustServiceQuickAsk = getConfiguredLoomEngineMode() === "rust-service";
    const readinessMessage = modelReadinessMessage("quick");
    if (readinessMessage && !useRustServiceQuickAsk) {
      setAskState({ ...askState, error: readinessMessage });
      return;
    }
    const generationId = quickGenerationRef.current + 1;
    quickGenerationRef.current = generationId;
    const controller = new AbortController();
    quickAbortRef.current = controller;
    quickRevealQuestionRef.current = null;
    const capsuleKey = `${askState.sourceLoomId ?? activeConversationId}:${askState.response.id}`;
    const capsule =
      responseContextCapsules[capsuleKey] ??
      createHeuristicResponseContextCapsule(
        askState.response,
        askState.sourceLoomId ?? activeConversationId,
        askState.sourceSelectedText
      );
    const activeReferences = quickAskActiveReferencesFromState(askState);
    const visibleChipLabels = activeReferences
      .map((reference) => reference.label.trim())
      .filter((label) => label.length > 0);
    const quickAskTraceId = `quick-ask-${Date.now()}-${generationId}`;
    const askPayload = buildAskContextPayload({
      response: askState.response,
      selectedText: askState.sourceSelectedText,
      userQuestion: prompt,
      capsule,
      activeReferences,
    });
    const previousAskTurnContext = buildTemporaryAskTurnContext(
      (askState.exchanges ?? []).map((exchange, index) => ({
        id: exchange.id ?? `ask-turn-${index}`,
        question: exchange.question,
        answer: exchange.answer,
        createdAt: exchange.createdAt ?? Date.now(),
        capsuleSnapshot: exchange.capsuleSnapshot as ResponseContextCapsule | undefined,
        selectedText: exchange.selectedText,
        payloadReport: exchange.payloadReport as AskExchange["payloadReport"],
      }))
    );
    const quickModel = getProfileModel(providerSettings, "quick");
    const mainModel = getProfileModel(providerSettings, "main");
    const quickModelName = quickModel.name;
    const quickServiceModel =
      quickModel.id === mainModel.id
        ? undefined
        : quickModel.id;
    const quickAskInput = {
      sessionId: askState.sessionId ?? `ask-${askState.response.id}`,
      quickAskTraceId,
      sourceLoomId: askState.sourceLoomId ?? activeConversationId,
      sourceResponseId: askState.sourceResponseId ?? askState.response.id,
      selectedText: askState.sourceSelectedText,
      sourceContext: {
        title: capsule.sourceTitle ?? capsule.title,
        responseCode: capsule.sourceResponseCode ?? capsule.responseCode,
        canonicalUri: capsule.sourceCanonicalUri ?? capsule.canonicalUri,
        summary: capsule.summary,
        keyPoints: capsule.keyPoints,
        keywords: capsule.keywords,
        entities: capsule.entities,
      },
      activeReferences,
      turns: (askState.exchanges ?? []).map((exchange) => ({
        question: exchange.question,
        answer: exchange.answer,
        title: exchange.title,
      })),
      question: prompt,
      intent: askPayload.focusedIntent,
      options: {
        model: useRustServiceQuickAsk ? quickServiceModel : quickModelName,
        numCtx: 1024,
        numPredict: quickAskNumPredict(
          askPayload.focusedIntent,
          Boolean(askState.sourceSelectedText)
        ),
      },
      signal: controller.signal,
    };
    const optimisticExchange: AskExchange = {
      id: `ask-turn-${Date.now()}`,
      question: prompt,
      answer: "",
      createdAt: Date.now(),
      capsuleSnapshot: capsule,
      selectedText: askState.sourceSelectedText,
      sourceLoomId: askState.sourceLoomId,
      sourceResponseId: askState.sourceResponseId ?? askState.response.id,
      sourceFragment: askState.sourceFragment,
      activeReferences,
      payloadReport: {
        usedFullResponse: askPayload.usedFullResponse,
        contextCharCount: askPayload.contextCharCount,
        capsuleSource: askPayload.capsuleSource,
        includedSelectedText: askPayload.includedSelectedText,
      },
      debugTrace: {
        traceId: quickAskTraceId,
        engineMode: useRustServiceQuickAsk ? "rust-service" : "typescript-local",
        clientKind: useRustServiceQuickAsk ? "rust-http" : "typescript-local",
        requestAttempted: true,
        endpoint: useRustServiceQuickAsk ? "/ask/quick" : "typescript-local.quickAsk",
        responseParseStatus: "not_started",
        diagnosticsReceived: false,
        visibleChipLabels,
        userQuestion: prompt,
        selectedFragmentPreview: askState.sourceSelectedText,
        sourceTitle: capsule.sourceTitle ?? capsule.title,
        sourceResponseCode: capsule.sourceResponseCode ?? capsule.responseCode,
        inputActiveReferenceLabels: visibleChipLabels,
        previousAskTurnCount: askState.exchanges?.length ?? 0,
        warnings: useRustServiceQuickAsk ? [] : ["non_rust_service_path"],
      },
    };
    quickRevealQuestionRef.current = prompt;
    setAskState({
      ...askState,
      question: "",
      running: true,
      answered: true,
      answer: "",
      exchanges: [...(askState.exchanges ?? []), optimisticExchange],
      error: undefined,
    });
    try {
      const result = useRustServiceQuickAsk
        ? await loomEngineClient.quickAsk(quickAskInput)
        : await runModelProfileRequest(providerSettings, {
            profile: "quick",
            effort: "Low",
            mode: "instant",
            think: false,
            outputBudget: "short",
            numPredict: quickAskInput.options.numPredict,
            signal: controller.signal,
            prompt,
            context: [
              ...askPayload.context,
              ...previousAskTurnContext,
              ...askPayload.backgroundContext,
            ],
            system: askState.contextKind === "fragment"
              ? "Answer this as a Loom Quick Ask. The user is asking about the selected fragment. Use the fragment as the primary context and the parent Response only as secondary background. Keep instant, no-thinking behavior, but do not force the answer into one sentence. Use 2-5 sentences or short bullets when useful, and do not write a long essay. Use previous temporary Ask turns silently. Answer directly; do not mention context blocks, capsules, wrapper labels, or artifact names."
              : "Answer this as a Loom Quick Ask. Use the provided source context and previous temporary Ask turns silently. Preserve local Ask continuity while staying anchored to the source Response. Keep instant, no-thinking behavior, but do not force the answer into one sentence. Use 2-5 sentences or short bullets when useful, and do not write a long essay. Answer directly; do not mention context blocks, capsules, wrapper labels, or artifact names.",
          });
      if (controller.signal.aborted || quickGenerationRef.current !== generationId) return;
      const sanitizedAnswer = stripQuickAskFocusSubjectPrefix(
        sanitizeModelAnswer("answer" in result ? result.answer : result.text)
      );
      const resultTitle =
        "title" in result && typeof result.title === "string"
          ? normalizeLoomTitle(result.title)
          : quickAskFallbackTitle(prompt, sanitizedAnswer);
      const resultDiagnostics = "diagnostics" in result ? result.diagnostics : undefined;
      const resultWarnings = "warnings" in result ? result.warnings : [];
      const resultDiagnosticsRecord =
        resultDiagnostics && typeof resultDiagnostics === "object" && !Array.isArray(resultDiagnostics)
          ? (resultDiagnostics as Record<string, unknown>)
          : undefined;
      const diagnosticsReceived = Boolean(resultDiagnosticsRecord?.diagnosticsReceived);
      const transportWarnings = [
        ...resultWarnings,
        ...(diagnosticsReceived ? [] : ["service_diagnostics_missing"]),
      ];
      if (
        looksLikeRestatedQuickAskQuestion({
          answer: sanitizedAnswer,
          question: prompt,
          selectedText: askState.sourceSelectedText,
        })
      ) {
        console.debug("Quick Ask answer looked like a restated selected-fragment question.", {
          selectedText: askState.sourceSelectedText,
          question: prompt,
        });
      }
      const completedReveal = await revealQuickAskAnswer(prompt, sanitizedAnswer, generationId);
      if (!completedReveal) return;
      setAskState((current) => {
        if (!current) return current;
        const exchanges = current.exchanges ?? [];
        return {
          ...current,
          running: false,
          answered: true,
          answer: sanitizedAnswer,
          exchanges: exchanges.map((exchange, index) =>
            index === exchanges.length - 1 && exchange.question === prompt
              ? {
                  ...exchange,
                  answer: sanitizedAnswer,
                  title: resultTitle,
                  debugTrace: {
                    ...(exchange.debugTrace ?? optimisticExchange.debugTrace),
                    traceId: quickAskTraceId,
                    engineMode: useRustServiceQuickAsk ? "rust-service" : "typescript-local",
                    clientKind: useRustServiceQuickAsk ? "rust-http" : "typescript-local",
                    requestAttempted: true,
                    endpoint: useRustServiceQuickAsk ? "/ask/quick" : "typescript-local.quickAsk",
                    httpStatus:
                      typeof resultDiagnosticsRecord?.httpStatus === "number"
                        ? resultDiagnosticsRecord.httpStatus
                        : undefined,
                    responseParseStatus:
                      typeof resultDiagnosticsRecord?.responseParseStatus === "string"
                        ? resultDiagnosticsRecord.responseParseStatus
                        : resultDiagnostics ? "success" : undefined,
                    diagnosticsReceived,
                    diagnostics: resultDiagnostics,
                    warnings: transportWarnings,
                  },
                }
              : exchange
          ),
          error: undefined,
        };
      });
      if (quickAbortRef.current === controller) quickAbortRef.current = null;
      quickRevealQuestionRef.current = null;
    } catch (error) {
      if (controller.signal.aborted) {
        if (quickAbortRef.current === controller) quickAbortRef.current = null;
        quickRevealQuestionRef.current = null;
        setAskState((current) => current ? { ...current, running: false } : current);
        return;
      }
      setAskState((current) =>
        current
          ? {
              ...current,
              running: false,
              error: providerErrorMessage(error),
              exchanges: (current.exchanges ?? []).map((exchange, index, exchanges) =>
                index === exchanges.length - 1 && exchange.question === prompt
                  ? {
                      ...exchange,
                      debugTrace: {
                        ...(exchange.debugTrace ?? optimisticExchange.debugTrace),
                        traceId: quickAskTraceId,
                        engineMode: useRustServiceQuickAsk ? "rust-service" : "typescript-local",
                        clientKind: useRustServiceQuickAsk ? "rust-http" : "typescript-local",
                        requestAttempted: true,
                        endpoint: useRustServiceQuickAsk ? "/ask/quick" : "typescript-local.quickAsk",
                        httpStatus:
                          typeof (error as { details?: Record<string, unknown> })?.details?.httpStatus === "number"
                            ? (error as { details?: { httpStatus?: number } }).details?.httpStatus
                            : typeof (error as { details?: Record<string, unknown> })?.details?.status === "number"
                              ? (error as { details?: { status?: number } }).details?.status
                              : undefined,
                        responseParseStatus:
                          typeof (error as { details?: Record<string, unknown> })?.details?.responseParseStatus === "string"
                            ? String((error as { details?: { responseParseStatus?: unknown } }).details?.responseParseStatus)
                            : undefined,
                        diagnosticsReceived: false,
                        errorKind:
                          error instanceof Error && "kind" in error
                            ? String((error as { kind?: unknown }).kind)
                            : undefined,
                        transportErrorKind:
                          error instanceof Error && "kind" in error
                            ? String((error as { kind?: unknown }).kind)
                            : undefined,
                        warnings: [
                          providerErrorMessage(error),
                          useRustServiceQuickAsk ? "service_diagnostics_missing" : "non_rust_service_path",
                        ],
                      },
                    }
                  : exchange
              ),
            }
          : current
      );
      markRuntimeUnavailableFromError(error);
      if (quickAbortRef.current === controller) quickAbortRef.current = null;
      quickRevealQuestionRef.current = null;
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

  function closeSelectionAskFlow() {
    quickAbortRef.current?.abort();
    quickAbortRef.current = null;
    quickRevealQuestionRef.current = null;
    setSelectionAskState(null);
    setAskState(null);
    setSelectionReference(null);
    clearSelectionHighlight();
  }

  function onSelectionAsk(response: ResponseItem, draftKey = activeDraftKey) {
    const selection = window.getSelection();
    const selected = selection?.toString().trim();
    if (!selection || selection.rangeCount === 0 || !selected || selected.length < 3) {
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
    clearSelectionHighlight();
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
    const selectionLink = selectionReferenceFromSelection(selectionAskState);
    if (kind === "ask") {
      setSelectionReference({
        draftKey: selectionAskState.draftKey,
        link: selectionLink,
      });
      setSelectionAskState(null);
      clearSelectionHighlight();
      window.requestAnimationFrame(() => composerFocusRef.current?.());
      return;
    }
    const response = selectionAskState.response;
    const sourceLoomId = selectionAskState.draftKey;
    const capsuleKey = `${sourceLoomId}:${response.id}`;
    const capsule =
      responseContextCapsules[capsuleKey] ??
      createHeuristicResponseContextCapsule(response, sourceLoomId, selectionLink.selectedText);
    if (!responseContextCapsules[capsuleKey]) {
      setResponseContextCapsules((current) => ({ ...current, [capsuleKey]: capsule }));
    }
    queueQuickResponseContextCapsule(response, sourceLoomId, selectionLink.selectedText ?? "", capsuleKey);
    setAskState({
      sessionId: `ask-${sourceLoomId}-${response.id}-${selectionLink.fragmentHash ?? Date.now()}`,
      response,
      selectedText: selectionLink.selectedText ?? selectionAskState.selectedText,
      sourceSelectedText: selectionLink.selectedText ?? selectionAskState.selectedText,
      sourceResponseId: response.id,
      sourceFragment: selectionLink,
      contextKind: "fragment",
      contextPreview: [
        selectionLink.selectedText ?? selectionAskState.selectedText,
        selectionLink.sourceResponseCode
          ? `${selectionLink.sourceResponseCode} · ${selectionLink.sourceResponseTitle ?? response.title}`
          : selectionLink.sourceResponseTitle ?? response.title,
      ]
        .filter(Boolean)
        .join("\n\n"),
      contextModeLabel: "Using selected fragment",
      question: "",
      answered: false,
      exchanges: [],
      sourceLoomId,
    });
    setSelectionAskState(null);
    clearSelectionHighlight();
  }

  function fragmentReferenceFromSelection(state: SelectionAskState): LoomLink {
    const responseCode = state.response.meta?.code;
    const sourceConversation =
      conversations.find((item) => item.id === state.draftKey) ??
      archived.find((item) => item.id === state.draftKey) ??
      (draftConversation?.id === state.draftKey ? draftConversation : undefined);
    const sourceCanonicalUri = sourceConversation
      ? responseAddressForConversation(sourceConversation, state.response)
      : state.response.meta?.canonicalUri;
    const fragmentHash = fragmentTextHash(state.selectedText);
    const title = fragmentReferenceTitle(
      state.selectedText,
      responseCode ?? state.response.title
    );
    const sourceAddress = sourceCanonicalUri ?? state.response.address;
    return {
      id: `fragment:${state.draftKey}:${state.response.id}:${fragmentHash}`,
      type: "fragment",
      title,
      path: `${sourceAddress}#fragment=${fragmentHash}`,
      badge: "Fragment",
      selectedAt: Date.now(),
      canonicalUri: sourceCanonicalUri ? `${sourceCanonicalUri}#fragment=${fragmentHash}` : undefined,
      referenceCode: responseCode,
      sourceLoomId: state.draftKey,
      sourceResponseId: state.response.id,
      selectedText: state.selectedText,
      sourceResponseCode: responseCode,
      sourceResponseTitle: state.response.title,
      sourceCanonicalUri,
      fragmentHash,
      createdAt: Date.now(),
      referenceCustomLabel: title,
    };
  }

  function selectionReferenceFromSelection(state: SelectionAskState): LoomLink {
    return {
      ...fragmentReferenceFromSelection(state),
      badge: "Selection",
    };
  }

  async function addSelectionAsReference() {
    if (!selectionAskState) return;
    const fragmentReference = fragmentReferenceFromSelection(selectionAskState);
    const draft = composerDrafts[selectionAskState.draftKey] ?? EMPTY_COMPOSER_DRAFT;
    if (draft.links.some((link) => referencesShareIdentity(link, fragmentReference))) {
      showToast({ message: "Already referenced", icon: "copy" });
      setSelectionAskState(null);
      clearSelectionHighlight();
      window.requestAnimationFrame(() => composerFocusRef.current?.());
      return;
    }
    let referenceToInsert = fragmentReference;
    if (getConfiguredLoomEngineMode() === "rust-service") {
      try {
        const metadata: Record<string, string> = {};
        if (fragmentReference.sourceResponseCode) {
          metadata.sourceResponseCode = fragmentReference.sourceResponseCode;
        }
        if (fragmentReference.sourceResponseTitle) {
          metadata.sourceResponseTitle = fragmentReference.sourceResponseTitle;
        }
        if (fragmentReference.sourceCanonicalUri) {
          metadata.sourceCanonicalUri = fragmentReference.sourceCanonicalUri;
        }
        const result = await loomEngineClient.addReference({
          loomId: selectionAskState.draftKey,
          sourceResponseId: selectionAskState.response.id,
          reference: fragmentReference,
          metadata,
        });
        referenceToInsert = {
          ...fragmentReference,
          ...result.reference,
          badge: fragmentReference.badge,
          selectedText: fragmentReference.selectedText,
          sourceResponseCode: fragmentReference.sourceResponseCode,
          sourceResponseTitle: fragmentReference.sourceResponseTitle,
          sourceCanonicalUri: fragmentReference.sourceCanonicalUri,
          fragmentHash: fragmentReference.fragmentHash,
          referenceCustomLabel:
            result.reference.referenceCustomLabel ?? fragmentReference.referenceCustomLabel,
        };
      } catch (error) {
        console.warn("Reference creation requires loom-service.", error);
        showToast({ message: "Reference requires loom-service" });
        return;
      }
    }
    linkObjectForDraft(referenceToInsert, selectionAskState.draftKey);
    showToast({ message: "Fragment Reference added", icon: "copy" });
    setSelectionAskState(null);
    clearSelectionHighlight();
    window.requestAnimationFrame(() => composerFocusRef.current?.());
  }

  function scrollTranscriptToBottom(transcript = transcriptRef.current) {
    if (!transcript || isNewConversationDraft) return;
    transcriptProgrammaticScrollRef.current = true;
    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: "smooth",
    });
    window.setTimeout(() => {
      transcriptProgrammaticScrollRef.current = false;
    }, 220);
  }

  function scrollTranscriptToBottomIfNearBottom(transcript = transcriptRef.current) {
    if (!transcript || isNewConversationDraft) return;
    if (!isTranscriptNearBottom(transcript, 140)) return;
    scrollTranscriptToBottom(transcript);
  }

  function resumeTranscriptAutoFollow() {
    transcriptAutoFollowPausedRef.current = false;
    transcriptProgrammaticScrollRef.current = true;
    window.setTimeout(() => {
      transcriptProgrammaticScrollRef.current = false;
    }, 900);
  }

  function isTranscriptNearBottom(transcript: HTMLElement, threshold = 72) {
    return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= threshold;
  }

  function followTranscriptToBottom(behavior: ScrollBehavior) {
    const transcript = transcriptRef.current;
    if (!transcript || isNewConversationDraft) return;
    transcriptProgrammaticScrollRef.current = true;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior });
    window.setTimeout(() => {
      transcriptProgrammaticScrollRef.current = false;
    }, behavior === "smooth" ? 260 : 80);
  }

  function handleTranscriptScroll(event: React.UIEvent<HTMLElement>) {
    if (!composerRuntimeState.running || transcriptProgrammaticScrollRef.current) return;
    const transcript = event.currentTarget;
    if (!isTranscriptNearBottom(transcript)) {
      transcriptAutoFollowPausedRef.current = true;
    }
  }

  const activeResponseStreamingSignature = activeResponses
    .map((response) => [
      response.id,
      response.answer.join("\n\n").length,
      response.thinkingEndedAt ?? "",
      response.elapsedThinkingSeconds ?? "",
      response.thinkingStalled ? "stalled" : "",
      response.finalStartedAt ?? "",
    ].join(":"))
    .join("|");

  useEffect(() => {
    const wasRunning = previousComposerRunningRef.current;
    const isRunning = composerRuntimeState.running;
    previousComposerRunningRef.current = isRunning;

    if (isRunning && !wasRunning) {
      transcriptAutoFollowPausedRef.current = false;
    }

    if (isRunning) {
      if (!transcriptAutoFollowPausedRef.current) {
        window.requestAnimationFrame(() => followTranscriptToBottom("auto"));
      }
      return;
    }

    if (wasRunning) {
      window.requestAnimationFrame(() => {
        followTranscriptToBottom("smooth");
        transcriptAutoFollowPausedRef.current = false;
      });
    }
  }, [
    activeResponseStreamingSignature,
    composerRuntimeState.running,
    graphMode,
    isNewConversationDraft,
    showWeftSplit,
  ]);

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
        referenceDisplayMode={appSettings.referenceDisplayMode}
        modelResponseMode={appSettings.modelResponseMode}
        providerSettings={providerSettings}
        engineClient={loomEngineClient}
        runtimeState={runtimeStateForComposer(loomId)}
        runtimeHealth={activeComposerRuntimeHealth}
        active={panelActive}
        onActivate={() => markSplitPanelActive(panel)}
        onProviderSettingsChange={saveProviderSettings}
        onModelResponseModeChange={(mode) =>
          saveAppSettings({ ...appSettings, modelResponseMode: mode })
        }
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
        onStop={stopMainResponse}
        onUserTyping={() => {
          const transcript =
            panel === "origin" ? originTranscriptRef.current : transcriptRef.current;
          scrollTranscriptToBottomIfNearBottom(transcript);
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
      openGraphOverlay();
    }
  }

  function copySplitPanelAddress(panel: "origin" | "weft") {
    const conversation = panel === "origin" ? originConversation : activeConversation;
    if (!conversation) return;
    copyLoomAddress(loomLinkForId(conversation.id));
    setSplitPanelMenu(null);
  }

  function closeFlowPanel() {
    if (activeTemporaryWeft) {
      const originId = activeTemporaryWeft.originLoomId;
      const originResponseId = activeTemporaryWeft.originResponseId;
      discardTemporaryWeft(activeTemporaryWeft.temporaryId, "CLOSE_SPLIT");
      dispatchSplitFocus({ type: "SPLIT_CLOSED" });
      dispatchSplitFocus({ type: "NAVIGATED_FULL" });
      setActiveConversationId(originId);
      focusComposerAfterNavigation();
      pendingScrollDestinationRef.current = {
        loomId: originId,
        mode: "full",
        scrollTargetResponseId: originResponseId,
        scrollMode: "origin",
        source: "userNavigation",
      };
      pendingScrollHighlightRef.current = true;
      return;
    }
    if (activeWeftOrigin) {
      const originResponse = findResponseInLoom(
        activeWeftOrigin.originLoomId,
        activeWeftOrigin.originResponseId
      );
      const fallbackResponse = originResponse ?? lastResponseInLoom(activeWeftOrigin.originLoomId);
      const originConversationForClose = conversations.find(
        (conversation) => conversation.id === activeWeftOrigin.originLoomId
      );
      const destination: LoomNavigationDestination = {
        loomId: activeWeftOrigin.originLoomId,
        mode: "full",
        scrollTargetResponseId: fallbackResponse?.id,
        scrollMode: originResponse ? "origin" : fallbackResponse ? "lastResponse" : undefined,
        source: "userNavigation",
      };
      const link = fallbackResponse
        ? responseLinkForNavigation(activeWeftOrigin.originLoomId, fallbackResponse)
        : loomLinkForId(activeWeftOrigin.originLoomId);
      if (!originResponse) {
        showToast({
          title: "Origin response unavailable",
          message: "The original response is no longer available.",
          color: "neutral",
          icon: "weft",
        });
      }
      dispatchSplitFocus({ type: "SPLIT_CLOSED" });
      dispatchSplitFocus({ type: "NAVIGATED_FULL" });
      setActiveConversationId(activeWeftOrigin.originLoomId);
      setActiveObjectTitle(fallbackResponse?.title ?? originConversationForClose?.title ?? link.title);
      restoreDestination(link, destination);
      pushNavigationEntry(link, destination);
      pendingScrollDestinationRef.current = destination;
      pendingScrollHighlightRef.current = Boolean(originResponse);
      focusComposerAfterNavigation();
      return;
    }
    focusSplitPanel("origin");
  }

  function renderSplitPanelControls(panel: "origin" | "weft") {
    const label = panel === "origin" ? "Origin" : "Flow";
    return (
      <div className="split-panel-controls" aria-label={`${label} panel controls`}>
        {panel === "weft" && (
          <>
            <button
              className="split-panel-control"
              type="button"
              title="Maximize Flow"
              aria-label="Maximize Flow"
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
              title="Close Flow panel"
              aria-label="Close Flow panel"
              onClick={(event) => {
                event.stopPropagation();
                closeFlowPanel();
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
          <MoreVertical size={14} />
        </button>
      </div>
    );
  }

  return (
    <AppShell sidebarCollapsed={sidebarCollapsed} theme={appThemeClass}>
      <TopBrowserBar
        addressBarRef={addressBarRef}
        location={currentLocation}
        path={currentActiveDestination.path}
        addressFocused={addressFocused}
        addressQuery={addressQuery}
        suggestions={filteredSuggestions}
        resolutionFeedback={addressFeedback}
        selectedSuggestion={selectedSuggestion}
        addressSuggestionsVisible={addressSuggestionsVisible}
        canBack={navigationIndex > 0}
        canForward={navigationIndex < navigationStack.length - 1}
        backTraversal={getBackTraversal(navigationStack, navigationIndex)}
        forwardTraversal={getForwardTraversal(navigationStack, navigationIndex)}
        graphMode={graphMode}
        activePanel={activePanel}
        sidebarCollapsed={sidebarCollapsed}
        currentBookmarked={isDestinationBookmarked(currentActiveDestination)}
        currentDestination={currentActiveDestination}
        canDragCurrentDestination={!isNewConversationDraft}
        onAddressFocus={focusAddressBar}
        onAddressChange={(value) => {
          dispatchAddressBar({ type: "INPUT_CHANGED" });
          setAddressQuery(value);
          setAddressFeedback(null);
          setSelectedSuggestion(-1);
          setAddressSuggestionsVisible(true);
        }}
        onAddressKeyDown={handleAddressKeyDown}
        onVisit={(destination) => {
          dispatchAddressBarSequence({ type: "SUBMIT" }, { type: "ADDRESS_DETECTED" });
          visitDestination(destination, { source: "addressBar" });
        }}
        onStartNewLoomFromAddressBar={(value) => {
          dispatchAddressBarSequence({ type: "SUBMIT" }, { type: "FREE_TEXT_DETECTED" });
          void startNewLoomFromAddressBar(value);
        }}
        onBack={() => handleBackForward("back")}
        onForward={() => handleBackForward("forward")}
        onJumpTraversal={jumpNavigationTraversal}
        onBookmarkCurrent={() => {
          bookmarkLoomLink(currentActiveDestination);
        }}
        onCopyShareItem={copyShareItem}
        onExportCurrentLoom={exportCurrentLoom}
        onToggleSidebar={() => {
          setSidebarFlyoutOpen(false);
          setSidebarFlyoutDragActive(false);
          setSidebarCollapsed((current) => !current);
        }}
        onTogglePanel={(panel) => {
          dispatchAddressBar({ type: "BLUR" });
          setAddressSuggestionsVisible(false);
          toggleUtilityPanel(panel);
          setAddressFeedback(null);
        }}
        onToggleGraph={() => {
          dispatchAddressBar({ type: "RESET" });
          setAddressQuery("");
          setAddressFeedback(null);
          setAddressSuggestionsVisible(false);
          toggleGraphOverlay();
        }}
      />

      <div
        className={[
          "app-body",
          dockedUtilityOverlay ? "utility-panel-docked" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Sidebar
          conversations={conversations}
          pinnedConversationIds={pinnedConversationIds}
          tabGroups={tabGroups}
          renamingGroupId={renamingGroupId}
          collapsed={sidebarCollapsed && !sidebarFlyoutVisible}
          flyout={sidebarFlyoutVisible}
          archivedCount={archived.length}
          appSettings={appSettings}
          activeConversationId={
            showWeftSplit && activeAddressableConversation
              ? activeAddressableConversation.id
              : activeConversationId
          }
          activePanel={activePanel}
          bookmarksNavPulse={bookmarksNavPulse}
          highlightedConversationId={recentWeftFeedbackLoomId}
          onDropBookmark={bookmarkLoomLink}
          onCreateGroup={createGroupFromConversations}
          onAddToGroup={addConversationToGroup}
          onRemoveFromGroups={removeConversationFromGroups}
          onRenameGroup={renameTabGroup}
          onCancelRenameGroup={() => setRenamingGroupId(null)}
          onToggleGroup={toggleTabGroup}
          onNewConversation={openNewConversationDraft}
          onSelectConversation={(conversation) => {
            closeAddressSearch();
            const destination = {
              id: conversation.id,
              type: "conversation" as const,
              title: conversation.title,
              path: conversation.path,
              badge: typeLabel.conversation,
              canonicalUri: conversation.meta?.canonicalUri,
              meta: conversation.meta,
            };
            visitDestination(destination, {
              allowUnresolved: true,
              navigationDestination: navigationDestinationForLink(
                destination,
                "userNavigation",
                { loomId: conversation.id, scrollMode: "lastResponse" }
              ),
            });
            closeUnpinnedUtilityOverlays();
          }}
          onOpenPanel={(panel) => {
            if (panel) openUtilityPanel(panel);
          }}
          onArchive={archiveConversation}
          onOpenContextMenu={openConversationMenu}
          onOpenGroupContextMenu={openGroupMenu}
          onDeleteRequest={setDeleteTarget}
          onOpenSettings={(category = "runtime") => {
            setProviderSettingsInitialCategory(category);
            setProviderSettingsOpen(true);
          }}
          onHoverExpandStart={() => {
            if (sidebarCollapsed) setSidebarFlyoutOpen(true);
          }}
          onHoverExpandEnd={() => {
            if (sidebarCollapsed && !sidebarFlyoutDragActive) setSidebarFlyoutOpen(false);
          }}
          onFlyoutDragStart={() => {
            if (!sidebarCollapsed) return;
            setSidebarFlyoutOpen(true);
            setSidebarFlyoutDragActive(true);
          }}
          onFlyoutDragEnd={() => {
            setSidebarFlyoutDragActive(false);
            if (sidebarCollapsed) setSidebarFlyoutOpen(false);
          }}
        />

        <main
          className={["workspace", showLoomSurfaceLoading ? "workspace-loading" : ""]
            .filter(Boolean)
            .join(" ")}
          ref={workspaceRef}
          aria-busy={showLoomSurfaceLoading}
        >

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
                referenceDisplayMode={appSettings.referenceDisplayMode}
                modelResponseMode={appSettings.modelResponseMode}
                providerSettings={providerSettings}
                engineClient={loomEngineClient}
                runtimeState={runtimeStateForComposer(activeDraftKey)}
                runtimeHealth={activeComposerRuntimeHealth}
                textInsertionRequest={starterPromptRequest}
                onProviderSettingsChange={saveProviderSettings}
                onModelResponseModeChange={(mode) =>
                  saveAppSettings({ ...appSettings, modelResponseMode: mode })
                }
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
                onStop={stopMainResponse}
                onUserTyping={scrollTranscriptToBottom}
              />
              {!newLoomDraftHasText && (
                <NewLoomStarterPanel
                  categories={newLoomStarterCategories}
                  activeCategoryId={starterCategoryId}
                  onCategoryChange={chooseStarterCategory}
                  onPromptSelect={insertStarterPrompt}
                />
              )}
            </section>
          ) : (
            <>
              {graphMode ? (
                <GraphView
                  engineClient={loomEngineClient}
                  conversations={conversations}
                  responsesByConversation={conversationResponses}
                  forkRecords={forkRecordsWithTimestamps}
                  activeLoomId={activeAddressableConversation?.id ?? activeConversation?.id}
                  focusedResponseId={
                    currentNavigationDestination?.scrollTargetResponseId ??
                    recentResponseFeedbackId ??
                    activeAddressableResponses[activeAddressableResponses.length - 1]?.id
                  }
                  focusedWeftLoomId={
                    recentWeftFeedbackLoomId ??
                    (currentNavigationDestination?.source === "weftCreate" &&
                    conversations.some(
                      (conversation) => conversation.id === currentNavigationDestination.loomId
                    )
                      ? currentNavigationDestination.loomId
                      : null)
                  }
                  bookmarkedResponseAddresses={bookmarkedResponseAddresses}
                  onOpenLoom={(loomId) => {
                    visitDestination(loomLinkForId(loomId), {
                      source: "userNavigation",
                      navigationDestination: {
                        loomId,
                        mode: visibleSplitPanelForLoomId(loomId) ? "split" : "full",
                        source: "userNavigation",
                      },
                    });
                    setGraphMode(false);
                  }}
                  onOpenResponse={(loomId, response) => {
                    visitDestination(responseLinkForNavigation(loomId, response), {
                      source: "userNavigation",
                      navigationDestination: {
                        loomId,
                        mode: visibleSplitPanelForLoomId(loomId) ? "split" : "full",
                        scrollTargetResponseId: response.id,
                        scrollMode: "exact",
                        source: "userNavigation",
                      },
                    });
                    setGraphMode(false);
                  }}
                  onBookmarkResponse={(loomId, response, currentlyBookmarked) => {
                    toggleResponseBookmark(
                      loomId,
                      response,
                      currentlyBookmarked ?? response.bookmarked
                    );
                  }}
                  onLinkResponse={(loomId, response) => {
                    linkObjectForDraft(
                      responseLinkForNavigation(loomId, response),
                      loomId
                    );
                    showToast({
                      title: "Link added",
                      message: "Added to the active composer.",
                      icon: "copy",
                    });
                  }}
                  onWeftResponse={(loomId, response) => {
                    forkResponseLoom(response, loomId);
                  }}
                  renderContinuationComposer={({
                    loomId,
                    onSubmitStart,
                    onResponseCreated,
                    onResponseCompleted,
                  }) => (
                    <PromptComposer
                      variant="bottom"
                      draftKey={loomId}
                      draft={composerDrafts[loomId] ?? EMPTY_COMPOSER_DRAFT}
                      attachedReferences={
                        selectionReference?.draftKey === loomId ? [selectionReference.link] : []
                      }
                      referenceOptions={composerReferenceOptions}
                      attachContentItems={attachContentItems}
                      referenceDisplayMode={appSettings.referenceDisplayMode}
                      modelResponseMode={appSettings.modelResponseMode}
                      providerSettings={providerSettings}
                      engineClient={loomEngineClient}
                      runtimeState={runtimeStateForComposer(loomId)}
                      runtimeHealth={activeComposerRuntimeHealth}
                      onProviderSettingsChange={saveProviderSettings}
                      onModelResponseModeChange={(mode) =>
                        saveAppSettings({ ...appSettings, modelResponseMode: mode })
                      }
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
                        composerFocusRef.current = focus;
                      }}
                      onSend={async (draft, options) => {
                        const prompt = plainTextFromDraft(draft);
                        const meaningful = prompt.length > 0 || draft.links.length > 0;
                        if (!meaningful) return false;
                        if (runtimeStateForComposer(loomId).running) {
                          stopMainResponse();
                          return false;
                        }
                        onSubmitStart();
                        let createdResponse: ResponseItem | undefined;
                        const sent = await sendComposerToModel(draft, {
                          ...options,
                          loomId,
                          preserveNavigation: true,
                          revealResponse: true,
                          onResponseCreated: (_targetLoomId, response) => {
                            createdResponse = response;
                            setRecentResponseFeedbackId(response.id);
                            setActiveObjectTitle(response.title);
                            onResponseCreated(response);
                          },
                        });
                        if (sent && createdResponse) {
                          onResponseCompleted(createdResponse);
                        }
                        return sent;
                      }}
                      onStop={stopMainResponse}
                      onUserTyping={() => undefined}
                    />
                  )}
                />
              ) : showWeftSplit ? (
                  <WeftView>
                    <div className="weft-split-view">
                      {originConversation && (
                        <div
                          className="weft-panel origin-split-panel"
                          onPointerDownCapture={() => markSplitPanelActive("origin")}
                          onClickCapture={() => markSplitPanelActive("origin")}
                          onFocusCapture={() => markSplitPanelActive("origin")}
                        >
                          {renderSplitPanelControls("origin")}
                          <ChatTranscript
                            transcriptRef={(node) => {
                              originTranscriptRef.current = node;
                            }}
                            conversation={originConversation}
                            responses={originResponses}
                            activeLoomId={
                              activeSplitPanel === "weft"
                                ? activeConversation?.id
                                : originConversation.id
                            }
                            onLink={(link) => {
                              markSplitPanelActive("origin");
                              linkObjectForDraft(link, originConversation.id);
                            }}
                            onLoom={(response) => forkResponseLoom(response, originConversation.id)}
                            promptRevisionSelections={selectedPromptRevisionByResponseId}
                            onPromptRevisionSelect={(responseId, revisionLoomId) => {
                              setSelectedPromptRevisionByResponseId((current) => ({
                                ...current,
                                [responseId]: revisionLoomId,
                              }));
                            }}
                            onPromptBranchNavigate={(responseId) => {
                              markSplitPanelActive("origin");
                              anchorBranchCounterNavigation(
                                originConversation.id,
                                responseId,
                                "origin"
                              );
                            }}
                            onSelectWeft={openPersistedWeftBranch}
                            onToggleSuggestedBookmark={toggleSuggestedBookmark}
                            bookmarkedPaths={bookmarkedResponseAddresses}
                            forkRecords={forkRecordsWithTimestamps}
                            conversationTitlesById={conversationTitlesById}
                            temporaryWefts={Object.values(temporaryWefts)}
                            onSelectionAsk={(response) => {
                              markSplitPanelActive("origin");
                              onSelectionAsk(response, originConversation.id);
                            }}
                            responseTitleOverrides={responseTitleOverrides}
                            onOpenContextMenu={(event, response) =>
                              openContextMenu(event, { kind: "response", response })
                            }
                            onCopyAddress={copyLoomAddress}
                            onCopyAddressWithToast={copyLoomAddressWithToast}
                            onCopyResponse={copyResponseAnswerWithToast}
                            onCopyPrompt={copyPromptTextWithToast}
                            onCopyCode={copyCodeBlockWithToast}
                            onAddCodeReference={addCodeBlockAsReference}
                            onOpenReference={openComposerReference}
                            onReturnToOrigin={returnToOrigin}
                            highlightedResponseId={recentResponseFeedbackId}
                            onTranscriptScroll={(event) => {
                              markSplitPanelActive("origin");
                              handleTranscriptScroll(event);
                            }}
                            onScrollToBottom={() => {
                              markSplitPanelActive("origin");
                              resumeTranscriptAutoFollow();
                            }}
                            generatingResponseId={generatingResponseId}
                            completionActionRevealResponseId={completionActionRevealResponseId}
                            onAnswerNowFromThinking={(responseId) => {
                              void answerNowFromThinking(responseId);
                            }}
                            onContinueThinking={continueThinkingResponse}
                            onStopThinking={stopThinkingResponse}
                            onContinueTruncatedResponse={continueTruncatedResponse}
                            onEditPrompt={updateResponsePrompt}
                            onRegenerateFromPrompt={regenerateFromEditedPrompt}
                            onRetryPrompt={retryFromUserMessage}
                            showGenerationDebug={appSettings.showGenerationDebug}
                            uncollapsedResponseIds={
                              activeSplitPanel === "origin"
                                ? currentVisitResponseIds
                                : undefined
                            }
                            collapseUserMessages={appSettings.messageCollapse.userMessages}
                            collapseResponses={appSettings.messageCollapse.responses}
                          />
                          {renderPanelComposer(originConversation.id, "origin")}
                        </div>
                      )}
                      {activeConversation && (
                        <div
                          className="weft-panel weft-split-panel"
                          onPointerDownCapture={() => markSplitPanelActive("weft")}
                          onClickCapture={() => markSplitPanelActive("weft")}
                          onFocusCapture={() => markSplitPanelActive("weft")}
                        >
                          {renderSplitPanelControls("weft")}
                          <ChatTranscript
                            transcriptRef={(node) => {
                              transcriptRef.current = node;
                            }}
                            conversation={activeConversation}
                            responses={activeResponses}
                            activeLoomId={activeConversation.id}
                            onLink={(link) => {
                              markSplitPanelActive("weft");
                              linkObjectForDraft(link, activeConversation.id);
                            }}
                            onLoom={(response) => forkResponseLoom(response, activeConversation.id)}
                            promptRevisionSelections={selectedPromptRevisionByResponseId}
                            onPromptRevisionSelect={(responseId, revisionLoomId) => {
                              setSelectedPromptRevisionByResponseId((current) => ({
                                ...current,
                                [responseId]: revisionLoomId,
                              }));
                            }}
                            onPromptBranchNavigate={(responseId) => {
                              markSplitPanelActive("weft");
                              anchorBranchCounterNavigation(
                                activeConversation.id,
                                responseId,
                                "weft"
                              );
                            }}
                            onSelectWeft={openPersistedWeftBranch}
                            onToggleSuggestedBookmark={toggleSuggestedBookmark}
                            bookmarkedPaths={bookmarkedResponseAddresses}
                            forkRecords={forkRecordsWithTimestamps}
                            conversationTitlesById={conversationTitlesById}
                            temporaryWefts={Object.values(temporaryWefts)}
                            onSelectionAsk={(response) => {
                              markSplitPanelActive("weft");
                              onSelectionAsk(response, activeConversation.id);
                            }}
                            responseTitleOverrides={responseTitleOverrides}
                            onOpenContextMenu={(event, response) =>
                              openContextMenu(event, { kind: "response", response })
                            }
                            onCopyAddress={copyLoomAddress}
                            onCopyAddressWithToast={copyLoomAddressWithToast}
                            onCopyResponse={copyResponseAnswerWithToast}
                            onCopyPrompt={copyPromptTextWithToast}
                            onCopyCode={copyCodeBlockWithToast}
                            onAddCodeReference={addCodeBlockAsReference}
                            onOpenReference={openComposerReference}
                            onReturnToOrigin={returnToOrigin}
                            highlightedResponseId={recentResponseFeedbackId}
                            onTranscriptScroll={(event) => {
                              markSplitPanelActive("weft");
                              handleTranscriptScroll(event);
                            }}
                            onScrollToBottom={() => {
                              markSplitPanelActive("weft");
                              resumeTranscriptAutoFollow();
                            }}
                            generatingResponseId={generatingResponseId}
                            completionActionRevealResponseId={completionActionRevealResponseId}
                            onAnswerNowFromThinking={(responseId) => {
                              void answerNowFromThinking(responseId);
                            }}
                            onContinueThinking={continueThinkingResponse}
                            onStopThinking={stopThinkingResponse}
                            onContinueTruncatedResponse={continueTruncatedResponse}
                            onEditPrompt={updateResponsePrompt}
                            onRegenerateFromPrompt={regenerateFromEditedPrompt}
                            onRetryPrompt={retryFromUserMessage}
                            showGenerationDebug={appSettings.showGenerationDebug}
                            uncollapsedResponseIds={
                              activeSplitPanel === "weft"
                                ? currentVisitResponseIds
                                : undefined
                            }
                            collapseUserMessages={appSettings.messageCollapse.userMessages}
                            collapseResponses={appSettings.messageCollapse.responses}
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
                    activeLoomId={activeConversation?.id}
                    onLink={linkObject}
                    onLoom={forkResponseLoom}
                    promptRevisionSelections={selectedPromptRevisionByResponseId}
                    onPromptRevisionSelect={(responseId, revisionLoomId) => {
                      setSelectedPromptRevisionByResponseId((current) => ({
                        ...current,
                        [responseId]: revisionLoomId,
                      }));
                    }}
                    onPromptBranchNavigate={(responseId) => {
                      if (!activeConversation) return;
                      anchorBranchCounterNavigation(activeConversation.id, responseId, "full");
                    }}
                    onSelectWeft={openPersistedWeftBranch}
                    onToggleSuggestedBookmark={toggleSuggestedBookmark}
                    bookmarkedPaths={bookmarkedResponseAddresses}
                    forkRecords={forkRecordsWithTimestamps}
                    conversationTitlesById={conversationTitlesById}
                    temporaryWefts={Object.values(temporaryWefts)}
                    onSelectionAsk={onSelectionAsk}
                    responseTitleOverrides={responseTitleOverrides}
                    onOpenContextMenu={(event, response) =>
                      openContextMenu(event, { kind: "response", response })
                    }
                    onCopyAddress={copyLoomAddress}
                    onCopyAddressWithToast={copyLoomAddressWithToast}
                    onCopyResponse={copyResponseAnswerWithToast}
                    onCopyPrompt={copyPromptTextWithToast}
                    onCopyCode={copyCodeBlockWithToast}
                    onAddCodeReference={addCodeBlockAsReference}
                    onOpenReference={openComposerReference}
                    onReturnToOrigin={activeWeftOrigin ? returnToOrigin : undefined}
                    highlightedResponseId={recentResponseFeedbackId}
                    onTranscriptScroll={handleTranscriptScroll}
                    onScrollToBottom={resumeTranscriptAutoFollow}
                    generatingResponseId={generatingResponseId}
                    completionActionRevealResponseId={completionActionRevealResponseId}
                    onAnswerNowFromThinking={(responseId) => {
                      void answerNowFromThinking(responseId);
                    }}
                    onContinueThinking={continueThinkingResponse}
                    onStopThinking={stopThinkingResponse}
                    onContinueTruncatedResponse={continueTruncatedResponse}
                    onEditPrompt={updateResponsePrompt}
                    onRegenerateFromPrompt={regenerateFromEditedPrompt}
                    onRetryPrompt={retryFromUserMessage}
                    showGenerationDebug={appSettings.showGenerationDebug}
                    uncollapsedResponseIds={currentVisitResponseIds}
                    collapseUserMessages={appSettings.messageCollapse.userMessages}
                    collapseResponses={appSettings.messageCollapse.responses}
                  />
                )}

              {!graphMode && !showWeftSplit && (
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
                  referenceDisplayMode={appSettings.referenceDisplayMode}
                  modelResponseMode={appSettings.modelResponseMode}
                  providerSettings={providerSettings}
                  engineClient={loomEngineClient}
                  runtimeState={runtimeStateForComposer(activeDraftKey)}
                  runtimeHealth={activeComposerRuntimeHealth}
                  onProviderSettingsChange={saveProviderSettings}
                  onModelResponseModeChange={(mode) =>
                    saveAppSettings({ ...appSettings, modelResponseMode: mode })
                  }
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
                  onStop={stopMainResponse}
                  onUserTyping={() => scrollTranscriptToBottomIfNearBottom()}
                />
              )}
            </>
          )}
        </ConversationView>
        </main>

        <RightPanel
          activePanel={activePanel}
          bookmarks={bookmarks}
          history={history.map(enrichDestinationMetadata)}
          lineageRoot={lineageRoot}
          activeLoomId={activeConversationId}
          activeDestination={currentActiveDestination}
          archived={archived}
          pinned={rightDockPinned}
          highlightedBookmarkId={recentBookmarkFeedbackId}
          onTogglePin={() => {
            if (activePanel) toggleRightDockPin();
          }}
          onClose={() => {
            if (activePanel) closeUtilityOverlay(activePanel);
          }}
          onVisit={visitDestination}
          onInsert={linkObject}
          onBookmark={bookmarkLoomLink}
          onOpenGraph={(destination) => {
            visitDestination(destination);
            openGraphOverlay();
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
      </div>

      <ToastNotification
        open={linkCopyToastVisible}
        title={toastTitle}
        message={copyToastMessage}
        icon={toastIcon}
        color={toastColor}
      />

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

      {groupColorTarget && (
        <GroupColorPopover
          group={
            tabGroups.find((group) => group.id === groupColorTarget.id) ??
            groupColorTarget
          }
          onCancel={() => setGroupColorTarget(null)}
          onSave={saveTabGroupSettings}
        />
      )}

      {selectionAskState && (
        <SelectionPopover
          x={selectionAskState.x}
          y={selectionAskState.y}
          onAsk={() => launchSelectionAsk("ask")}
          onQuickQuestion={() => launchSelectionAsk("quick")}
          onAddReference={addSelectionAsReference}
        />
      )}

      {askState && (
        <AskPopup
          state={askState}
          onUpdate={setAskState}
          onClose={closeSelectionAskFlow}
          onLoom={async () => {
            const completedTurns = (askState.exchanges ?? [])
              .filter((exchange) => exchange.question.trim() && exchange.answer.trim())
              .map((exchange, index) => ({
                id: exchange.id ?? `ask-turn-${index}`,
                question: exchange.question,
                answer: exchange.answer,
                createdAt: exchange.createdAt ?? Date.now(),
                capsuleSnapshot:
                  exchange.capsuleSnapshot as ResponseContextCapsule | undefined,
                selectedText: exchange.selectedText,
                sourceLoomId: exchange.sourceLoomId,
                sourceResponseId: exchange.sourceResponseId,
                sourceFragment: exchange.sourceFragment,
                activeReferences:
                  exchange.activeReferences as AskActiveReferenceContext[] | undefined,
                payloadReport: exchange.payloadReport as AskExchange["payloadReport"],
              }));
            const latestExchange =
              completedTurns[completedTurns.length - 1] ??
              (askState.answer
                ? {
                    id: `ask-turn-${Date.now()}`,
                    question: askState.question,
                    answer: askState.answer,
                    createdAt: Date.now(),
                    capsuleSnapshot: undefined,
                    selectedText: askState.sourceSelectedText,
                    sourceLoomId: askState.sourceLoomId,
                    sourceResponseId: askState.sourceResponseId ?? askState.response.id,
                    sourceFragment: askState.sourceFragment,
                    activeReferences: quickAskActiveReferencesFromState(askState),
                  }
                : undefined);
            if (!latestExchange) return;
            const converted = await forkResponseLoom(
              askState.response,
              askState.sourceLoomId ?? activeConversationId,
              {
                question: latestExchange.question,
                answer: latestExchange.answer,
                turns: completedTurns,
                capsuleSnapshot: latestExchange.capsuleSnapshot,
                selectedText: latestExchange.selectedText,
                sourceLoomId: latestExchange.sourceLoomId,
                sourceResponseId: latestExchange.sourceResponseId,
                sourceFragment: latestExchange.sourceFragment,
                activeReferences:
                  latestExchange.activeReferences as AskActiveReferenceContext[] | undefined,
              }
            );
            if (converted) closeSelectionAskFlow();
          }}
          onSubmit={submitQuickQuestion}
          onStop={stopQuickAskResponse}
          showDebug={false}
        />
      )}

      {providerSettingsOpen && (
        <AIProviderSettingsModal
          settings={providerSettings}
          appSettings={appSettings}
          runtimeHealth={activeComposerRuntimeHealth}
          engineClient={loomEngineClient}
          initialCategory={providerSettingsInitialCategory}
          onSave={saveProviderSettings}
          onAppSettingsSave={saveAppSettings}
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

      {retryConfirmTarget && (
        <RetryConfirmationDialog
          onCancel={cancelRetryConfirmation}
          onConfirm={confirmRetryFromDialog}
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
  flyout: boolean;
  archivedCount: number;
  appSettings: AppSettings;
  activeConversationId: string;
  activePanel: ActivePanel;
  bookmarksNavPulse: boolean;
  highlightedConversationId: string | null;
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
  onOpenSettings: (category?: SettingsCategoryId) => void;
  onHoverExpandStart: () => void;
  onHoverExpandEnd: () => void;
  onFlyoutDragStart: () => void;
  onFlyoutDragEnd: () => void;
}

function Sidebar({
  conversations,
  pinnedConversationIds,
  tabGroups,
  renamingGroupId,
  collapsed,
  flyout,
  archivedCount,
  appSettings,
  activeConversationId,
  activePanel,
  bookmarksNavPulse,
  highlightedConversationId,
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
  onOpenSettings,
  onHoverExpandStart,
  onHoverExpandEnd,
  onFlyoutDragStart,
  onFlyoutDragEnd,
}: SidebarProps) {
  const folderListRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const dragPreviewCleanupRef = useRef<(() => void) | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
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
  const [profileInfoPanel, setProfileInfoPanel] = useState<"help" | "about" | null>(
    null
  );
  const profileName = getDisplayProfileName(appSettings);
  const workspaceName = getDisplayWorkspaceName(appSettings);
  const avatarInitial = getAvatarInitial(profileName);

  useLayoutEffect(() => {
    const folderList = folderListRef.current;
    if (!folderList || !activeConversationId) return;
    const activeTab = folderList.querySelector<HTMLElement>(
      `[data-loom-id="${CSS.escape(activeConversationId)}"]`
    );
    if (!activeTab) return;

    const folderRect = folderList.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    const fullyVisible =
      tabRect.top >= folderRect.top && tabRect.bottom <= folderRect.bottom;
    if (fullyVisible) return;

    activeTab.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [conversations.length, activeConversationId, tabGroups]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && profileMenuRef.current?.contains(target)) return;
      setProfileMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileMenuOpen]);

  function openSettingsFromProfile(category: SettingsCategoryId = "runtime") {
    setProfileMenuOpen(false);
    setProfileInfoPanel(null);
    onOpenSettings(category);
  }

  function openProfileInfoPanel(panel: "help" | "about") {
    setProfileMenuOpen(false);
    setProfileInfoPanel(panel);
  }

  function conversationToLink(conversation: Conversation): LoomLink {
    return {
      id: conversation.id,
      type: "conversation",
      title: conversation.title,
      path: conversation.path,
      badge: typeLabel.conversation,
      canonicalUri: conversation.meta?.canonicalUri,
      meta: conversation.meta,
      referenceCode: conversation.meta?.code,
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
    const displayTitle = cleanPolishedDisplayTitle(conversation.tabLabel ?? conversation.title);
    const displaySummary = cleanMarkdownDisplayTitle(conversation.summary);
    return (
      <div
        key={conversation.id}
        className={[
          "conversation-tab",
          conversation.id === activeConversationId ? "active" : "",
          conversation.id === highlightedConversationId ? "is-newly-added" : "",
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
          aria-label={`Open ${displayTitle}`}
          title={collapsed ? displayTitle : undefined}
        >
          <span className="conversation-favicon">
            <Icon size={13} />
          </span>
          <span className="conversation-tab-copy">
            <strong>{displayTitle}</strong>
            <small>{displaySummary}</small>
          </span>
          <span className="conversation-tab-meta">
            {conversation.pinned && <em>Pinned</em>}
            {conversation.unread && <i aria-label="Unread" />}
          </span>
        </button>
        <div className="conversation-tab-actions">
          <Tooltip label="Archive" placement="bottom-right">
            <button
              className="icon-button subtle"
              onClick={() => onArchive(conversation)}
              aria-label={`Archive ${displayTitle}`}
              title="Archive conversation"
            >
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <aside
      className={[
        "sidebar",
        collapsed ? "collapsed" : "",
        flyout ? "sidebar-flyout" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Conversation library"
      data-dnd-context="sidebar"
      data-testid="loom-sidebar"
      data-sidebar-flyout={flyout ? "true" : "false"}
      onPointerEnter={onHoverExpandStart}
      onPointerLeave={onHoverExpandEnd}
      onDragStartCapture={onFlyoutDragStart}
      onDragEndCapture={onFlyoutDragEnd}
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
          className={[
            "nav-row",
            activePanel === "bookmarks" ? "active" : "",
            bookmarksNavPulse ? "is-causal-pulse" : "",
          ]
            .filter(Boolean)
            .join(" ")}
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
          aria-label="Open Bookmarks"
          title="Open Bookmarks"
        >
          <Bookmark size={16} />
          Bookmarks
        </button>
        <button
          className={activePanel === "history" ? "nav-row active" : "nav-row"}
          onClick={() => onOpenPanel("history")}
          aria-label="Open Loom History"
          title="Open Loom History"
        >
          <History size={16} />
          Loom History
        </button>
        <button
          className={activePanel === "archive" ? "nav-row active" : "nav-row"}
          onClick={() => onOpenPanel("archive")}
          aria-label="Open Archive"
          title="Open Archive"
        >
          <Archive size={16} />
          Archive
        </button>
      </nav>

      {pinnedConversations.length === 0 && <div className="sidebar-nav-separator" />}

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
              style={
                group.color
                  ? ({ "--tab-group-accent": group.color } as CSSProperties)
                  : undefined
              }
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
        <button
          className="new-chat-button"
          onClick={onNewConversation}
          aria-label="New Loom"
          title="Open a new Loom"
        >
          <Plus size={16} />
          <span>New Loom</span>
          <kbd>{primaryCompactShortcutLabel("new-loom")}</kbd>
        </button>
      </div>

      <div className="profile-menu-container" ref={profileMenuRef}>
        <button
          className="sidebar-footer profile-button"
          type="button"
          data-testid="profile-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={profileMenuOpen}
          onClick={() => setProfileMenuOpen((current) => !current)}
        >
          <div className="profile-dot">{avatarInitial}</div>
          <div>
            <div className="footer-title">{profileName}</div>
            <div className="footer-caption">{workspaceName}</div>
          </div>
        </button>
        {profileMenuOpen && (
          <div className="profile-menu" role="menu" aria-label="Profile menu">
            <div className="profile-menu-header">
              <div className="profile-dot">{avatarInitial}</div>
              <div>
                <strong>{profileName}</strong>
                <span>{workspaceName}</span>
              </div>
            </div>
            <div className="profile-menu-section">
              <button
                type="button"
                role="menuitem"
                data-testid="open-app-settings"
                onClick={() => openSettingsFromProfile("runtime")}
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>
            </div>
            <div className="profile-menu-section">
              <button
                type="button"
                role="menuitem"
                onClick={() => openSettingsFromProfile("ai-providers")}
              >
                <Cpu size={14} />
                <span>AI Providers</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => openSettingsFromProfile("models")}
              >
                <Settings size={14} />
                <span>Model settings</span>
              </button>
            </div>
            <div className="profile-menu-section">
              <button
                type="button"
                role="menuitem"
                onClick={() => openProfileInfoPanel("help")}
              >
                <HelpCircle size={14} />
                <span>Help</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => openProfileInfoPanel("about")}
              >
                <Info size={14} />
                <span>About Loom</span>
              </button>
            </div>
            <div className="profile-menu-section profile-menu-footer">
              <button
                type="button"
                role="menuitem"
                onClick={() => openSettingsFromProfile("context-memory")}
              >
                <Settings size={14} />
                <span>Manage local profile</span>
              </button>
            </div>
          </div>
        )}
      </div>
      {profileInfoPanel && (
        <ProfileInfoDialog
          panel={profileInfoPanel}
          onClose={() => setProfileInfoPanel(null)}
        />
      )}
    </aside>
  );
}

function ProfileInfoDialog({
  panel,
  onClose,
}: {
  panel: "help" | "about";
  onClose: () => void;
}) {
  const isHelp = panel === "help";
  return (
    <div className="profile-info-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="profile-info-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isHelp ? "Loom Help" : "About Loom"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="profile-info-header">
          <div>
            <span>{isHelp ? "Help" : "About"}</span>
            <h2>{isHelp ? "Using Loom" : "Loom AI"}</h2>
          </div>
          <button type="button" className="icon-button subtle" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {isHelp ? (
          <div className="profile-info-body">
            <p>
              Loom is a local-first AI browser.
            </p>
            <p>Use the address bar to move between Looms.</p>
            <p>
              Type <strong>#</strong> in the composer to reference Looms inline.
            </p>
            <p>Create Wefts from responses when you want to branch a thought.</p>
            <p>
              Everything stays connected to its origin while remaining independently
              navigable.
            </p>
          </div>
        ) : (
          <div className="profile-info-body">
            <p>Build your personal web from AI conversations.</p>
            <p>
              Loom turns linear AI chats into a Personal Web.
            </p>
            <p>Every answer becomes addressable.</p>
            <p>Every response can be bookmarked, referenced, and reused.</p>
            <p>
              Every idea can branch into a new path while staying tied to its origin.
            </p>
            <p>Loom is your personal, writable, navigable AI web.</p>
            <p>Browse your thinking.</p>
            <p>Connect it.</p>
            <p>Build on it.</p>
          </div>
        )}
      </section>
    </div>
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
  const displayTitle = cleanPolishedDisplayTitle(conversation.title);
  return (
    <button
      className={active ? "pinned-tab active" : "pinned-tab"}
      draggable
      onDragStart={(event) => onDragStart(event, conversation)}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(conversation)}
      onContextMenu={(event) => onOpenContextMenu(event, conversation)}
      title={displayTitle}
      aria-label={`Open pinned ${displayTitle}`}
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
  addressSuggestionsVisible: boolean;
  canBack: boolean;
  canForward: boolean;
  backTraversal: NavigationTraversalEntry[];
  forwardTraversal: NavigationTraversalEntry[];
  graphMode: boolean;
  activePanel: ActivePanel;
  sidebarCollapsed: boolean;
  currentBookmarked: boolean;
  currentDestination: LoomLink;
  canDragCurrentDestination: boolean;
  onAddressFocus: () => void;
  onAddressChange: (value: string) => void;
  onAddressKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onVisit: (destination: LoomLink | AddressSuggestion) => void;
  onStartNewLoomFromAddressBar: (value: string) => void | Promise<void>;
  onBack: () => void;
  onForward: () => void;
  onJumpTraversal: (index: number) => void;
  onBookmarkCurrent: () => void;
  onCopyShareItem: (kind: "address" | "markdown" | "title-address") => void;
  onExportCurrentLoom: (format: "markdown" | "csv" | "zip") => void;
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
  resolutionFeedback,
  selectedSuggestion,
  addressSuggestionsVisible,
  canBack,
  canForward,
  backTraversal,
  forwardTraversal,
  graphMode,
  activePanel,
  sidebarCollapsed,
  currentBookmarked,
  currentDestination,
  canDragCurrentDestination,
  onAddressFocus,
  onAddressChange,
  onAddressKeyDown,
  onVisit,
  onStartNewLoomFromAddressBar,
  onBack,
  onForward,
  onJumpTraversal,
  onBookmarkCurrent,
  onCopyShareItem,
  onExportCurrentLoom,
  onToggleSidebar,
  onTogglePanel,
  onToggleGraph,
}: TopBrowserBarProps) {
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const forwardButtonRef = useRef<HTMLButtonElement | null>(null);
  const shareButtonRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [traversalMenu, setTraversalMenu] = useState<{
    direction: NavigationDirection;
    x: number;
    y: number;
    highlightedIndex: number;
  } | null>(null);
  const [shareMenuPosition, setShareMenuPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const desktopRuntime = getElectronRuntimeInfo();
  const windowControls = getElectronWindowControls();
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
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - 372)),
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

  function closeShareMenu() {
    setShareMenuPosition(null);
  }

  function toggleShareMenu() {
    if (shareMenuPosition) {
      closeShareMenu();
      return;
    }
    const button = shareButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = 248;
    const estimatedHeight = 320;
    const gap = 6;
    const viewportPadding = 8;
    const preferredLeft = rect.right - width;
    setShareMenuPosition({
      x: Math.max(
        viewportPadding,
        Math.min(preferredLeft, window.innerWidth - width - viewportPadding)
      ),
      y: Math.max(viewportPadding, Math.min(rect.bottom + gap, window.innerHeight - estimatedHeight - viewportPadding)),
    });
  }

  function handleShareCopy(kind: "address" | "markdown" | "title-address") {
    if (!canDragCurrentDestination) return;
    onCopyShareItem(kind);
    closeShareMenu();
  }

  function handleShareExport(format: "markdown" | "csv" | "zip") {
    if (!canDragCurrentDestination) return;
    onExportCurrentLoom(format);
    closeShareMenu();
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

  useEffect(() => {
    if (!shareMenuPosition) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest(".share-menu, .address-share-button")) return;
      closeShareMenu();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeShareMenu();
    }
    function handleWindowChange() {
      closeShareMenu();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [shareMenuPosition]);

  useEffect(() => () => clearLongPressTimer(), []);

  return (
    <TopBar>
      <div className="nav-cluster">
        <div className="chrome-product" aria-label="Loom browser chrome">
          {desktopRuntime?.isElectron && windowControls ? (
            <span className="chrome-window-dots" aria-label="Window controls">
              <button
                type="button"
                className="chrome-window-dot chrome-window-dot--close"
                aria-label="Close window"
                title="Close"
                onClick={() => void windowControls.close()}
              />
              <button
                type="button"
                className="chrome-window-dot chrome-window-dot--minimize"
                aria-label="Minimize window"
                title="Minimize"
                onClick={() => void windowControls.minimize()}
              />
              <button
                type="button"
                className="chrome-window-dot chrome-window-dot--maximize"
                aria-label="Maximize window"
                title="Maximize"
                onClick={() => void windowControls.toggleMaximize()}
              />
            </span>
          ) : (
            <span className="chrome-window-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          <button
            className={[
              "chrome-sidebar-icon",
              sidebarCollapsed ? "" : "is-active",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={!sidebarCollapsed}
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
            openTraversalMenuFromButton("back");
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
            openTraversalMenuFromButton("forward");
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
        <Tooltip label={currentBookmarked ? "Bookmarked" : "Bookmark"}>
          <button
            className={currentBookmarked ? "icon-button address-bookmark-button active" : "icon-button address-bookmark-button"}
            onClick={onBookmarkCurrent}
            aria-label={currentBookmarked ? "Loom address bookmarked" : "Bookmark current Loom address"}
            title={currentBookmarked ? "Loom address bookmarked" : "Bookmark current Loom address"}
          >
            <Bookmark size={15} />
          </button>
        </Tooltip>
        <div className="address-shell">
          <span
            className={
              canDragCurrentDestination
                ? "address-identity-drag"
                : "address-identity-drag disabled"
            }
            draggable={canDragCurrentDestination}
            onDragStart={(event) => {
              if (!canDragCurrentDestination) {
                event.preventDefault();
                return;
              }
              setLoomDragPayload(event, currentDestination);
            }}
            role="button"
            tabIndex={canDragCurrentDestination ? 0 : -1}
            aria-disabled={!canDragCurrentDestination}
            aria-label={
              canDragCurrentDestination
                ? "Drag current Loom address"
                : "Current Loom address is not available yet"
            }
            title={
              canDragCurrentDestination
                ? "Drag current Loom address"
                : "Current Loom address is not available yet"
            }
          >
            <Compass size={16} />
          </span>
          <input
            value={addressFocused ? addressQuery : ""}
            onChange={(event) => onAddressChange(event.target.value)}
            onFocus={onAddressFocus}
            onClick={onAddressFocus}
            onKeyDown={onAddressKeyDown}
            aria-label="Loom Address Bar"
            role="combobox"
            aria-expanded={addressFocused && addressSuggestionsVisible}
            aria-controls="address-suggestion-list"
            aria-activedescendant={
              selectedSuggestion >= 0
                ? `address-suggestion-${selectedSuggestion}`
                : undefined
            }
            placeholder={addressFocused ? "Search, ask, or paste a Loom address" : location}
          />
          <span className="address-path">{addressFocused ? path : "loom addressable"}</span>
          {addressFocused && addressSuggestionsVisible && (
            <AddressSuggestionList
              suggestions={suggestions}
              resolutionFeedback={resolutionFeedback}
              selectedSuggestion={selectedSuggestion}
              query={addressQuery}
              onVisit={onVisit}
              onStartNewLoom={onStartNewLoomFromAddressBar}
            />
          )}
        </div>
        <Tooltip label="Share">
          <button
            ref={shareButtonRef}
            className="icon-button address-share-button"
            aria-label="Share"
            title="Share"
            aria-haspopup="menu"
            aria-expanded={Boolean(shareMenuPosition)}
            onClick={toggleShareMenu}
          >
            <Share size={16} />
          </button>
        </Tooltip>
        {shareMenuPosition &&
          createPortal(
            <ShareMenu
              style={{ left: shareMenuPosition.x, top: shareMenuPosition.y }}
              disabled={!canDragCurrentDestination}
              onCopy={handleShareCopy}
              onExport={handleShareExport}
            />,
            document.body
          )}
      </AddressBar>

      <div className="top-actions">
        <Tooltip label="History">
          <button
            className={activePanel === "history" ? "chrome-button history-icon-button active" : "chrome-button history-icon-button"}
            onClick={() => onTogglePanel("history")}
            aria-label="Open Loom History"
            title="History"
          >
            <History size={16} />
          </button>
        </Tooltip>
        <Tooltip label="Flow">
          <button
            className={activePanel === "looms" ? "chrome-button active" : "chrome-button"}
            onClick={() => onTogglePanel("looms")}
            aria-label="Open Flow"
            title="Flow"
          >
            <GitBranch size={16} />
          </button>
        </Tooltip>
        <Tooltip label="Graph">
          <button
            className={graphMode ? "chrome-button active" : "chrome-button"}
            onClick={onToggleGraph}
            aria-label="Toggle Graph View"
            title="Graph"
          >
            <Map size={16} />
          </button>
        </Tooltip>
      </div>
    </TopBar>
  );
}

function ShareMenu({
  style,
  disabled,
  onCopy,
  onExport,
}: {
  style: CSSProperties;
  disabled: boolean;
  onCopy: (kind: "address" | "markdown" | "title-address") => void;
  onExport: (format: "markdown" | "csv" | "zip") => void;
}) {
  return (
    <div className="share-menu" style={style} role="menu" aria-label="Share current Loom">
      <div className="share-menu-section">
        <div className="share-menu-title">Copy</div>
        <button type="button" role="menuitem" disabled={disabled} onClick={() => onCopy("address")}>
          Copy Loom Address
        </button>
        <button type="button" role="menuitem" disabled={disabled} onClick={() => onCopy("markdown")}>
          Copy Markdown Link
        </button>
        <button type="button" role="menuitem" disabled={disabled} onClick={() => onCopy("title-address")}>
          Copy Title + Address
        </button>
      </div>
      <div className="share-menu-section">
        <div className="share-menu-title">Export</div>
        <button type="button" role="menuitem" disabled={disabled} onClick={() => onExport("markdown")}>
          Export as Markdown
        </button>
        <button type="button" role="menuitem" disabled={disabled} onClick={() => onExport("csv")}>
          Export as CSV
        </button>
        <button type="button" role="menuitem" disabled={disabled} onClick={() => onExport("zip")}>
          Export as ZIP
        </button>
      </div>
      <div className="share-menu-section">
        <div className="share-menu-title">Public</div>
        <button
          type="button"
          role="menuitem"
          disabled
          title="Public sharing is not available yet."
        >
          <span>Make Public</span>
          <small>Public sharing is not available yet.</small>
        </button>
      </div>
    </div>
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
          const code = referenceCodeForLink(item.entry);
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
              <span className="traversal-menu-copy">
                <strong>{meta.title}</strong>
                <small>{meta.subtitle}</small>
              </span>
              <span className="traversal-menu-badges">
                {code ? <code>{code}</code> : null}
                <em>{meta.badge}</em>
              </span>
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
  query,
  onVisit,
  onStartNewLoom,
}: {
  suggestions: AddressSuggestion[];
  resolutionFeedback: LoomResolutionResult | null;
  selectedSuggestion: number;
  query: string;
  onVisit: (destination: LoomLink | AddressSuggestion) => void;
  onStartNewLoom: (value: string) => void | Promise<void>;
}) {
  const trimmedQuery = query.trim();
  const canStartNewLoom = Boolean(trimmedQuery) && !isAddressBarAddressLike(trimmedQuery);
  const feedbackTitle =
    resolutionFeedback?.status === "alias_stale"
      ? "This Loom address has moved."
      : resolutionFeedback?.status === "not_found" || resolutionFeedback?.status === "missing"
        ? "No Loom object found."
      : resolutionFeedback?.status === "deleted"
        ? "This Loom object was deleted."
        : resolutionFeedback?.status === "invalid"
          ? "That Loom address is invalid."
          : resolutionFeedback?.status === "snapshot_missing"
            ? "That revision or snapshot is not available."
            : resolutionFeedback?.status === "window_invalid"
              ? "That window is not valid for this object."
              : resolutionFeedback?.status === "broken_reference"
                ? "This Loom reference is broken."
                : null;
  return (
    <div className="suggestion-popover" id="address-suggestion-list" role="listbox">
      <div className="suggestion-heading">
        <span>Search Looms or start a new Loom</span>
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
        canStartNewLoom ? (
          <button
            className="suggestion-row suggestion-row-action"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void onStartNewLoom(trimmedQuery)}
            role="option"
            aria-selected={false}
          >
            <span className="suggestion-icon">
              <Plus size={16} />
            </span>
            <span className="suggestion-copy">
              <strong>Start new Loom</strong>
              <small>{trimmedQuery}</small>
            </span>
            <span className="badge conversation">Prompt</span>
          </button>
        ) : (
          <div className="empty-state">No matching Loom destinations.</div>
        )
      ) : (
        suggestions.map((suggestion, index) => {
          const Icon = iconForType[suggestion.type];
          const formattedCode = formatBadgeCode({
            code: suggestion.referenceCode ?? suggestion.meta?.code,
            displayCode: suggestion.meta?.displayCode,
          });
          return (
            <button
              key={suggestion.id}
              id={`address-suggestion-${index}`}
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
                <small>{suggestion.subtitle || suggestion.iconLabel || suggestion.badge}</small>
              </span>
              {formattedCode && (
                <span className="suggestion-code" title={suggestion.referenceCode ?? suggestion.meta?.code}>
                  {formattedCode}
                </span>
              )}
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

function NewLoomStarterPanel({
  categories,
  activeCategoryId,
  onCategoryChange,
  onPromptSelect,
}: {
  categories: NewLoomStarterCategory[];
  activeCategoryId: NewLoomStarterCategoryId;
  onCategoryChange: (categoryId: NewLoomStarterCategoryId) => void;
  onPromptSelect: (prompt: string) => void;
}) {
  const activeCategory =
    categories.find((category) => category.id === activeCategoryId) ?? categories[0];

  return (
    <section className="new-loom-starters" aria-label="New Loom starter suggestions">
      <div className="new-loom-starter-tabs" role="tablist" aria-label="Starter categories">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={
              category.id === activeCategory.id
                ? "new-loom-starter-chip active"
                : "new-loom-starter-chip"
            }
            role="tab"
            aria-selected={category.id === activeCategory.id}
            onClick={() => onCategoryChange(category.id)}
          >
            <category.Icon size={14} aria-hidden="true" />
            {category.label}
          </button>
        ))}
      </div>
      <div className="new-loom-starter-prompts">
        {activeCategory.prompts.slice(0, 3).map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="new-loom-starter-prompt"
            onClick={() => onPromptSelect(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}

function formatThinkingSeconds(value: number | undefined) {
  if (value === undefined) return undefined;
  if (value < 10) return value.toFixed(1);
  return Math.round(value).toString();
}

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}m ${secs}s`;
}

function formatTokenCount(count: number): string {
  if (count < 1000) return `${count} tokens`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k tokens`;
  return `${(count / 1_000_000).toFixed(1)}M tokens`;
}

function AnimatedProgressText({ text }: { text: string }) {
  return (
    <span className="assistant-progress-animated-text" aria-label={text}>
      {Array.from(text).map((letter, index) => (
        <span
          key={`${text}-${letter}-${index}`}
          style={{ "--weaving-letter-index": index } as CSSProperties}
        >
          {letter === " " ? "\u00a0" : letter}
        </span>
      ))}
    </span>
  );
}

function ResponseProgressChecklist({
  progress,
  showDebug,
  compact = false,
}: {
  progress: VisibleAnswerProgress;
  showDebug: boolean;
  compact?: boolean;
}) {
  const activeTask = progress.tasks.find((task) => task.id === progress.activeTaskId);
  const statusText = progress.statusText || (activeTask ? `${activeTask.title}...` : "Preparing response...");
  const now = Date.now();
  const taskList = progress.tasks.length > 0
    ? progress.tasks
    : [
        {
          id: "fallback-progress",
          title: statusText.replace(/\s*\.\.\.$/, ""),
          stage: "generation" as const,
          status: "running" as const,
        },
      ];
  const contentOutline = progress.contentOutline?.filter(Boolean).slice(0, 6) ?? [];
  const debug = progress.debug;
  const debugFacts = [
    debug?.model ? `model ${debug.model}` : undefined,
    debug?.responseMode ? `mode ${debug.responseMode}` : undefined,
    debug?.think !== undefined ? `think ${debug.think ? "on" : "off"}` : undefined,
    debug?.numCtx ? `ctx ${debug.numCtx}` : undefined,
    debug?.numPredict ? `predict ${debug.numPredict}` : undefined,
    debug?.outputBudget ? `budget ${debug.outputBudget}` : undefined,
    debug?.referenceCount !== undefined ? `refs ${debug.referenceCount}` : undefined,
  ].filter(Boolean);
  const chunkFacts = [
    debug?.finalChunkCount ? `${debug.finalChunkCount} final chunks` : undefined,
    debug?.finalCharCount ? `${debug.finalCharCount} chars written` : undefined,
    debug?.targetResponseId ? `target ${debug.targetResponseId}` : undefined,
  ].filter(Boolean);

  return (
    <section
      className={[
        "assistant-response-progress",
        compact ? "assistant-response-progress--compact" : "",
      ].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-label={statusText}
    >
      <ol className="assistant-progress-task-list">
        {taskList.map((task) => {
          const running = task.status === "running";
          const duration =
            task.durationMs ??
            (running && task.startedAt ? Math.max(0, now - task.startedAt) : undefined);
          return (
            <li
              className={[
                "assistant-progress-task",
                `assistant-progress-task--${task.status}`,
              ].join(" ")}
              key={task.id}
            >
              <span className="assistant-progress-task-icon" aria-hidden="true">
                {task.status === "done" ? (
                  <Check size={12} strokeWidth={2.4} />
                ) : task.status === "failed" ? (
                  <X size={12} strokeWidth={2.4} />
                ) : running ? (
                  <ArrowRight size={12} strokeWidth={2.2} />
                ) : (
                  <span className="assistant-progress-task-dot" />
                )}
              </span>
              <span className="assistant-progress-task-title">
                {running ? <AnimatedProgressText text={statusText} /> : task.title}
              </span>
              {duration !== undefined && (
                <span className="assistant-progress-task-duration">
                  {formatVisibleDuration(duration)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {contentOutline.length > 0 && (
        <div className="assistant-progress-outline" aria-label="Answer outline">
          <div className="assistant-progress-outline-label">Content plan</div>
          <ul className="assistant-progress-outline-list">
            {contentOutline.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {showDebug &&
        (debugFacts.length > 0 || chunkFacts.length > 0 || (progress.debugEvents?.length ?? 0) > 0) && (
        <div className="assistant-progress-debug" aria-label="Generation debug monitor">
          <div className="assistant-progress-outline-label">Debug monitor</div>
          {debugFacts.length > 0 && (
            <div className="assistant-progress-debug-grid">
              {debugFacts.map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </div>
          )}
          {chunkFacts.length > 0 && (
            <div className="assistant-progress-debug-grid">
              {chunkFacts.map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </div>
          )}
          {progress.debugEvents && progress.debugEvents.length > 0 && (
            <ol className="assistant-progress-debug-events">
              {progress.debugEvents.map((event) => (
                <li key={event.id}>
                  <span>{formatVisibleDuration(event.elapsedMs)}</span>
                  <strong>{event.label}</strong>
                  {event.detail && <em>{event.detail}</em>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function ThinkingPanel({
  response,
  visibleProgress,
  showDebug,
  onAnswerNow,
  onContinueThinking,
  onStop,
}: {
  response: ResponseItem;
  visibleProgress?: VisibleAnswerProgress;
  showDebug: boolean;
  onAnswerNow: (responseId: string) => void;
  onContinueThinking: (responseId: string) => void;
  onStop: (responseId: string) => void;
}) {
  const [continuedAt, setContinuedAt] = useState<number | null>(null);
  const hasVisibleProgress = Boolean(visibleProgress);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const hasThinking = Boolean(
    response.thinkingStartedAt ||
      response.thinkingEndedAt ||
      response.elapsedThinkingSeconds !== undefined ||
      response.thinkingStopped
  );
  const finalStarted = Boolean(
    response.finalStartedAt ||
      response.finalContent?.trim() ||
      response.answer.join("\n\n").trim()
  );
  const thinkingRunning = Boolean(response.thinkingStartedAt && !response.thinkingEndedAt);
  const guardStartedAt = continuedAt ?? (response.thinkingStartedAt ? Date.parse(response.thinkingStartedAt) : undefined);
  const guardElapsedMs =
    guardStartedAt && thinkingRunning ? Math.max(0, now - guardStartedAt) : 0;
  const guardTimedOut = Boolean(
    thinkingRunning &&
    !finalStarted &&
    response.thinkingTimeoutMs &&
    guardElapsedMs >= response.thinkingTimeoutMs
  );
  const continueCount = response.thinkingContinueCount ?? 0;
  const stalledVisible = Boolean(
    thinkingRunning &&
    !finalStarted &&
    response.thinkingStalled &&
    (!continuedAt || guardTimedOut)
  );
  const showGuardControls = guardTimedOut || stalledVisible;

  useEffect(() => {
    if (!hasThinking || !thinkingRunning) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [hasThinking, thinkingRunning]);

  if (!hasThinking && !hasVisibleProgress) return null;
  if (finalStarted && !showGuardControls && !response.thinkingStopped) return null;

  const liveElapsed =
    response.thinkingStartedAt && thinkingRunning
      ? Math.max(0, (now - Date.parse(response.thinkingStartedAt)) / 1000)
      : response.elapsedThinkingSeconds;
  const elapsedLabel = liveElapsed !== undefined ? formatElapsedTime(liveElapsed) : undefined;
  const visibleTask = visibleProgress?.tasks.find(
    (task) => task.id === visibleProgress.activeTaskId
  );
  const visibleStatusLabel =
    visibleProgress?.statusText || (visibleTask ? `${visibleTask.title}...` : undefined);
  const liveTokenCount = response.thinkingTokenCount;
  const tokenLabel = liveTokenCount !== undefined ? formatTokenCount(liveTokenCount) : undefined;
  const primaryLabel = thinkingRunning
    ? showGuardControls
      ? "Still thinking..."
      : tokenLabel
      ? `Thinking · ${tokenLabel}`
      : "Thinking..."
    : visibleStatusLabel
      ? "Thinking"
      : tokenLabel
      ? `Thought · ${tokenLabel}`
      : elapsedLabel
      ? `Thought for ${elapsedLabel}`
      : "Thought";
  const secondaryLabel = thinkingRunning && !showGuardControls && elapsedLabel
    ? `${elapsedLabel} elapsed`
    : !thinkingRunning && visibleStatusLabel
    ? visibleStatusLabel
    : undefined;
  const ariaLabel = secondaryLabel ? `${primaryLabel} · ${secondaryLabel}` : primaryLabel;

  return (
    <section className={thinkingRunning ? "thinking-panel is-running" : "thinking-panel"}>
      <button
        type="button"
        className="thinking-panel-toggle"
        aria-label={ariaLabel}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <Lightbulb size={13} />
        <span>{primaryLabel}</span>
        {secondaryLabel && (
          <small>{secondaryLabel}</small>
        )}
      </button>
      {expanded && !showGuardControls && !response.thinkingStopped && (
        <div className="thinking-panel-detail">
          {visibleProgress ? (
            <ResponseProgressChecklist
              progress={visibleProgress}
              showDebug={showDebug}
              compact
            />
          ) : (
            <span>
              Thinking is active. Raw model thinking is private, so Loom only shows safe timing
              status here.
            </span>
          )}
        </div>
      )}
      {showGuardControls && (
        <div className="thinking-panel-guard" aria-label="Thinking controls">
          <span>
            {stalledVisible
              ? "The model may be stuck in a reasoning loop."
              : "Still thinking. Large context may take longer."}
          </span>
          <button type="button" onClick={() => onAnswerNow(response.id)}>
            Answer now
          </button>
          {continueCount < 2 && (
            <button
              type="button"
              onClick={() => {
                setContinuedAt(Date.now());
                onContinueThinking(response.id);
              }}
            >
              Continue thinking
            </button>
          )}
          <button type="button" onClick={() => onStop(response.id)}>
            Stop
          </button>
        </div>
      )}
      {response.thinkingStopped && (
        <div className="thinking-panel-guard thinking-panel-guard--stopped">
          Thinking stopped.
        </div>
      )}
    </section>
  );
}

function ResponseTruncationNotice({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="response-truncation-notice" role="status">
      <span>Response stopped at length limit.</span>
      <button type="button" onClick={onContinue}>
        Continue
      </button>
    </div>
  );
}

function ResponseContent({
  markdown,
  codeBlocks,
  onCopyCode,
  onAddCodeReference,
  onOpenReference,
  onReferenceHint,
  onReferenceHintClose,
}: {
  markdown: string;
  codeBlocks?: ResponseCodeBlock[];
  onCopyCode: (code: string) => Promise<boolean>;
  onAddCodeReference: (codeBlock: ResponseCodeBlock) => Promise<boolean>;
  onOpenReference: (link: LoomLink) => string | null;
  onReferenceHint: (link: LoomLink, target: HTMLElement) => void;
  onReferenceHintClose: () => void;
}) {
  return (
    <AssistantMarkdownContent
      markdown={markdown}
      codeBlocks={codeBlocks}
      onCopyCode={onCopyCode}
      onAddCodeReference={onAddCodeReference}
      onOpenReference={onOpenReference}
      onReferenceHint={onReferenceHint}
      onReferenceHintClose={onReferenceHintClose}
    />
  );
}

const USER_PROMPT_COLLAPSE_LINE_COUNT = 40;

function CollapsibleResponseContent({
  responseId,
  markdown,
  codeBlocks,
  onCopyCode,
  onAddCodeReference,
  onOpenReference,
  onReferenceHint,
  onReferenceHintClose,
}: {
  responseId: string;
  markdown: string;
  codeBlocks?: ResponseCodeBlock[];
  onCopyCode: (code: string) => Promise<boolean>;
  onAddCodeReference: (codeBlock: ResponseCodeBlock) => Promise<boolean>;
  onOpenReference: (link: LoomLink) => string | null;
  onReferenceHint: (link: LoomLink, target: HTMLElement) => void;
  onReferenceHintClose: () => void;
}) {
  return (
    <div
      id={`assistant-response-content-${responseId}`}
      className="assistant-response-content"
    >
      <ResponseContent
        markdown={markdown}
        codeBlocks={codeBlocks}
        onCopyCode={onCopyCode}
        onAddCodeReference={onAddCodeReference}
        onOpenReference={onOpenReference}
        onReferenceHint={onReferenceHint}
        onReferenceHintClose={onReferenceHintClose}
      />
    </div>
  );
}

function UserPromptContent({
  text,
  references,
  onOpenReference,
  onReferenceHint,
  onReferenceHintClose,
}: {
  text: string;
  references?: LoomLink[];
  onOpenReference: (link: LoomLink) => string | null;
  onReferenceHint: (link: LoomLink, target: HTMLElement) => void;
  onReferenceHintClose: () => void;
}) {
  const remainingReferences = [...(references ?? [])];
  const rendered: ReactNode[] = [];
  let cursor = 0;
  type PromptReferenceMatch = {
    link: LoomLink;
    tokenText: string;
    index: number;
    referenceIndex: number;
  };
  const findNextReferenceMatch = (): PromptReferenceMatch | null => {
    let match: PromptReferenceMatch | null = null;
    remainingReferences.forEach((link, referenceIndex) => {
      const tokenCandidates = Array.from(
        new Set([
          composerReferenceTokenText(link, link.referenceDisplayMode ?? "title"),
          referenceTokenText(link, link.referenceDisplayMode ?? "title"),
          referenceTokenText(link, "title"),
          referenceTokenText(link, "code"),
        ])
      );
      tokenCandidates.forEach((tokenText) => {
        const index = text.indexOf(tokenText, cursor);
        if (index < 0) return;
        if (!match || index < match.index) {
          match = { link, tokenText, index, referenceIndex };
        }
      });
    });
    return match;
  };
  while (remainingReferences.length > 0) {
    const nextMatch = findNextReferenceMatch();
    if (!nextMatch) break;
    if (nextMatch.index > cursor) rendered.push(text.slice(cursor, nextMatch.index));
    rendered.push(
      <button
        className="sent-prompt-reference-token"
        key={`${nextMatch.link.id}-${nextMatch.index}`}
        type="button"
        onClick={() => onOpenReference(nextMatch.link)}
        onMouseEnter={(event) => onReferenceHint(nextMatch.link, event.currentTarget)}
        onMouseLeave={onReferenceHintClose}
        onFocus={(event) => onReferenceHint(nextMatch.link, event.currentTarget)}
        onBlur={onReferenceHintClose}
        title={nextMatch.link.selectedText ?? nextMatch.link.title}
        data-loom-id={nextMatch.link.id}
        data-loom-path={nextMatch.link.path}
        data-loom-title={nextMatch.link.title}
        data-loom-type={nextMatch.link.type}
        data-loom-canonical-uri={nextMatch.link.canonicalUri}
        data-loom-source-canonical-uri={nextMatch.link.sourceCanonicalUri}
      >
        <span>
          {isAttachmentReferenceLink(nextMatch.link)
            ? formatAttachmentDisplayName(
                referenceLabelForMode(
                  nextMatch.link,
                  nextMatch.link.referenceDisplayMode ?? "title"
                ),
                26
              )
            : referenceLabelForMode(
                nextMatch.link,
                nextMatch.link.referenceDisplayMode ?? "title"
              )}
        </span>
      </button>
    );
    cursor = nextMatch.index + nextMatch.tokenText.length;
    remainingReferences.splice(nextMatch.referenceIndex, 1);
  }
  if (cursor < text.length) rendered.push(text.slice(cursor));

  return (
    <>
      {remainingReferences.map((link) => (
        <button
          className="sent-prompt-reference-token"
          key={`${link.id}-${link.path}`}
          type="button"
          onClick={() => onOpenReference(link)}
          onMouseEnter={(event) => onReferenceHint(link, event.currentTarget)}
          onMouseLeave={onReferenceHintClose}
          onFocus={(event) => onReferenceHint(link, event.currentTarget)}
          onBlur={onReferenceHintClose}
          title={link.selectedText ?? link.title}
          data-loom-id={link.id}
          data-loom-path={link.path}
          data-loom-title={link.title}
          data-loom-type={link.type}
          data-loom-canonical-uri={link.canonicalUri}
          data-loom-source-canonical-uri={link.sourceCanonicalUri}
        >
          <span>
            {isAttachmentReferenceLink(link)
              ? formatAttachmentDisplayName(
                  referenceLabelForMode(link, link.referenceDisplayMode ?? "title"),
                  26
                )
              : referenceLabelForMode(link, link.referenceDisplayMode ?? "title")}
          </span>
        </button>
      ))}
      {remainingReferences.length > 0 && text ? " " : ""}
      {rendered}
    </>
  );
}

function CollapsibleUserPromptContent({
  text,
  references,
  onOpenReference,
  onReferenceHint,
  onReferenceHintClose,
  collapseEnabled = true,
}: {
  text: string;
  references?: LoomLink[];
  onOpenReference: (link: LoomLink) => string | null;
  onReferenceHint: (link: LoomLink, target: HTMLElement) => void;
  onReferenceHintClose: () => void;
  collapseEnabled?: boolean;
}) {
  const promptRef = useRef<HTMLParagraphElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  useLayoutEffect(() => {
    const element = promptRef.current;
    if (!element) return;

    function measure() {
      if (!element) return;
      const overflowing = element.scrollHeight > element.clientHeight + 2;
      setCollapsible((current) => (expanded ? current || overflowing : overflowing));
    }

    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const mutationObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    resizeObserver?.observe(element);
    mutationObserver?.observe(element, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [text, expanded]);

  const canCollapse = collapseEnabled && collapsible;

  return (
    <div className="user-message-collapsible" data-expanded={expanded ? "true" : "false"}>
      <p
        ref={promptRef}
        className={[
          "user-message-prompt-text",
          collapseEnabled && !expanded ? "is-clamped" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          collapseEnabled && !expanded
            ? ({
                "--user-message-collapse-lines": USER_PROMPT_COLLAPSE_LINE_COUNT,
              } as CSSProperties)
            : undefined
        }
      >
        <UserPromptContent
          text={text}
          references={references}
          onOpenReference={onOpenReference}
          onReferenceHint={onReferenceHint}
          onReferenceHintClose={onReferenceHintClose}
        />
      </p>
      {canCollapse && (
        <button
          type="button"
          className="user-message-collapse-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "Show full message"}
        </button>
      )}
    </div>
  );
}

function AttachedPromptReferences({
  references,
  onOpenReference,
  onReferenceHint,
  onReferenceHintClose,
}: {
  references: LoomLink[];
  onOpenReference: (link: LoomLink) => string | null;
  onReferenceHint: (link: LoomLink, target: HTMLElement) => void;
  onReferenceHintClose: () => void;
}) {
  if (references.length === 0) return null;
  const visibleReferences = references.slice(0, 3);
  const hiddenCount = Math.max(0, references.length - visibleReferences.length);
  return (
    <div className="sent-prompt-attached-references" aria-label="Attached quote references">
      {visibleReferences.map((link) => (
        <button
          className="sent-prompt-quote-reference"
          key={referenceIdentityKey(link)}
          type="button"
          onClick={() => onOpenReference(link)}
          onMouseEnter={(event) => onReferenceHint(link, event.currentTarget)}
          onMouseLeave={onReferenceHintClose}
          onFocus={(event) => onReferenceHint(link, event.currentTarget)}
          onBlur={onReferenceHintClose}
          title={link.sourceResponseTitle ?? link.title}
          data-loom-id={link.id}
          data-loom-path={link.path}
          data-loom-title={link.title}
          data-loom-type={link.type}
          data-loom-canonical-uri={link.canonicalUri}
          data-loom-source-canonical-uri={link.sourceCanonicalUri}
        >
          <CornerDownRightIcon />
          <span>{fragmentQuoteText(link)}</span>
        </button>
      ))}
      {hiddenCount > 0 && (
        <span className="sent-prompt-reference-overflow">+{hiddenCount}</span>
      )}
    </div>
  );
}

function CornerDownRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="M4 3v5a3 3 0 0 0 3 3h5" />
      <path d="m9 8 3 3-3 3" />
    </svg>
  );
}

function isScrollContainerNearBottom(transcript: HTMLElement, threshold = 96) {
  return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= threshold;
}

function useScrollToBottomVisibility(transcriptRef: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  const frameRef = useRef<number | null>(null);

  const updateVisibility = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      setVisible(false);
      return;
    }
    const scrollable = transcript.scrollHeight > transcript.clientHeight + 96;
    setVisible(scrollable && !isScrollContainerNearBottom(transcript));
  }, [transcriptRef]);

  const scheduleVisibilityUpdate = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      updateVisibility();
    });
  }, [updateVisibility]);

  const scrollToBottom = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
    scheduleVisibilityUpdate();
  }, [scheduleVisibilityUpdate, transcriptRef]);

  useEffect(() => {
    scheduleVisibilityUpdate();
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scheduleVisibilityUpdate]);

  return { visible, scheduleVisibilityUpdate, scrollToBottom };
}

function ScrollToBottomButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      className="scroll-to-bottom-button"
      aria-label="Scroll to latest message"
      title="Scroll to latest message"
      onClick={onClick}
    >
      <ArrowDown size={18} />
    </button>
  );
}

function ChatTranscript({
  transcriptRef,
  conversation,
  responses,
  activeLoomId,
  onLink,
  onLoom,
  promptRevisionSelections,
  onPromptRevisionSelect,
  onPromptBranchNavigate,
  onSelectWeft,
  onToggleSuggestedBookmark,
  bookmarkedPaths,
  forkRecords,
  conversationTitlesById,
  temporaryWefts,
  onSelectionAsk,
  responseTitleOverrides,
  onOpenContextMenu,
  onCopyAddress,
  onCopyAddressWithToast,
  onCopyResponse,
  onCopyPrompt,
  onCopyCode,
  onAddCodeReference,
  onOpenReference,
  onReturnToOrigin,
  highlightedResponseId,
  onTranscriptScroll,
  onScrollToBottom,
  generatingResponseId,
  completionActionRevealResponseId,
  onAnswerNowFromThinking,
  onContinueThinking,
  onStopThinking,
  onContinueTruncatedResponse,
  onEditPrompt,
  onRegenerateFromPrompt,
  onRetryPrompt,
  showGenerationDebug,
  uncollapsedResponseIds,
  collapseUserMessages = true,
  collapseResponses = true,
}: {
  transcriptRef?: (node: HTMLElement | null) => void;
  conversation?: Conversation;
  responses: ResponseItem[];
  activeLoomId?: string;
  onLink: (link: LoomLink) => void;
  onLoom: (response: ResponseItem) => void;
  promptRevisionSelections?: Record<string, string | null>;
  onPromptRevisionSelect?: (responseId: string, revisionLoomId: string | null) => void;
  onPromptBranchNavigate?: (responseId: string) => void;
  onSelectWeft: (
    record: ForkRecord,
    options?: { preserveOriginScroll?: boolean; scrollMode?: "lastResponse" | "top" }
  ) => void;
  onToggleSuggestedBookmark: (link: LoomLink, currentlyBookmarked?: boolean) => void;
  bookmarkedPaths: Set<string>;
  forkRecords: ForkRecord[];
  conversationTitlesById: Record<string, string>;
  temporaryWefts: TemporaryWeftWorkspace[];
  onSelectionAsk: (response: ResponseItem) => void;
  responseTitleOverrides: Record<string, string>;
  onOpenContextMenu: (event: React.MouseEvent, response: ResponseItem) => void;
  onCopyAddress: (link: Pick<LoomLink, "path" | "canonicalUri">) => void;
  onCopyAddressWithToast: (link: Pick<LoomLink, "path" | "canonicalUri">) => void;
  onCopyResponse: (response: ResponseItem) => void;
  onCopyPrompt: (promptText: string, references?: LoomLink[]) => void;
  onCopyCode: (code: string) => Promise<boolean>;
  onAddCodeReference: (
    conversation: Conversation,
    response: ResponseItem,
    codeBlock: ResponseCodeBlock
  ) => Promise<boolean>;
  onOpenReference: (link: LoomLink) => string | null;
  onReturnToOrigin?: (options?: { keepPromptRevisionSelection?: boolean }) => void;
  highlightedResponseId?: string | null;
  onTranscriptScroll?: (event: React.UIEvent<HTMLElement>) => void;
  onScrollToBottom?: () => void;
  generatingResponseId?: string | null;
  completionActionRevealResponseId?: string | null;
  onAnswerNowFromThinking: (responseId: string) => void;
  onContinueThinking: (responseId: string) => void;
  onStopThinking: (responseId: string) => void;
  onContinueTruncatedResponse: (responseId: string) => void;
  onEditPrompt: (loomId: string, responseId: string, nextPrompt: string) => Promise<boolean>;
  onRegenerateFromPrompt: (loomId: string, responseId: string) => void;
  onRetryPrompt: (
    loomId: string,
    responseId: string,
    returnFocus?: HTMLElement | null
  ) => void;
  showGenerationDebug: boolean;
  uncollapsedResponseIds?: ReadonlySet<string>;
  collapseUserMessages?: boolean;
  collapseResponses?: boolean;
}) {
  const [sentReferenceHint, setSentReferenceHint] = useState<{
    link: LoomLink;
    x: number;
    y: number;
    placement: "top" | "bottom";
    maxHeight: number;
  } | null>(null);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptEditDraft, setPromptEditDraft] = useState("");
  const [weftBranchPickerResponseId, setWeftBranchPickerResponseId] =
    useState<string | null>(null);
  const sentReferenceHintCloseTimerRef = useRef<number | null>(null);
  const transcriptNodeRef = useRef<HTMLElement | null>(null);
  const {
    visible: scrollToBottomVisible,
    scheduleVisibilityUpdate,
    scrollToBottom,
  } = useScrollToBottomVisibility(transcriptNodeRef);

  const setTranscriptNode = useCallback(
    (node: HTMLElement | null) => {
      transcriptNodeRef.current = node;
      transcriptRef?.(node);
      scheduleVisibilityUpdate();
    },
    [scheduleVisibilityUpdate, transcriptRef]
  );

  const handleTranscriptScroll = useCallback(
    (event: React.UIEvent<HTMLElement>) => {
      onTranscriptScroll?.(event);
      scheduleVisibilityUpdate();
    },
    [onTranscriptScroll, scheduleVisibilityUpdate]
  );

  useEffect(() => {
    scheduleVisibilityUpdate();
  }, [conversation?.id, responses, scheduleVisibilityUpdate]);

  useEffect(() => {
    function handleDocumentPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (
        target?.closest(".weft-branch-picker") ||
        target?.closest(".response-weft-action-cluster")
      ) {
        return;
      }
      setWeftBranchPickerResponseId(null);
    }
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, []);

  function clearSentReferenceHintCloseTimer() {
    if (sentReferenceHintCloseTimerRef.current === null) return;
    window.clearTimeout(sentReferenceHintCloseTimerRef.current);
    sentReferenceHintCloseTimerRef.current = null;
  }

  function showSentReferenceHint(link: LoomLink, target: HTMLElement) {
    clearSentReferenceHintCloseTimer();
    const hintLink =
      link.type === "fragment" && link.sourceResponseId
        ? (() => {
            const sourceResponse = responses.find(
              (response) =>
                response.id === link.sourceResponseId ||
                response.serviceUserResponseId === link.sourceResponseId
            );
            if (!sourceResponse || !conversation) return link;
            const sourceAddress = responseAddressForConversation(conversation, sourceResponse);
            return {
              ...link,
              path: link.path?.startsWith("loom://")
                ? link.path
                : `${sourceAddress}${link.fragmentHash ? `#fragment=${link.fragmentHash}` : ""}`,
              canonicalUri: link.canonicalUri?.startsWith("loom://")
                ? link.canonicalUri
                : `${sourceAddress}${link.fragmentHash ? `#fragment=${link.fragmentHash}` : ""}`,
              sourceCanonicalUri: link.sourceCanonicalUri?.startsWith("loom://")
                ? link.sourceCanonicalUri
                : sourceAddress,
            };
          })()
        : link;
    const rect = target.getBoundingClientRect();
    const viewportPadding = 12;
    const hoverGap = 8;
    const popoverWidth = Math.min(340, window.innerWidth - 24);
    const x = Math.min(
      Math.max(viewportPadding, rect.left + rect.width / 2 - popoverWidth / 2),
      window.innerWidth - popoverWidth - viewportPadding
    );
    const availableAbove = rect.top - hoverGap - viewportPadding;
    const availableBelow = window.innerHeight - rect.bottom - hoverGap - viewportPadding;
    const openAbove = availableAbove > availableBelow && availableAbove > 120;
    setSentReferenceHint({
      link: hintLink,
      x,
      y: openAbove
        ? Math.max(viewportPadding, rect.top - hoverGap)
        : Math.min(window.innerHeight - viewportPadding, rect.bottom + hoverGap),
      placement: openAbove ? "top" : "bottom",
      maxHeight: Math.max(120, openAbove ? availableAbove : availableBelow),
    });
  }

  function scheduleSentReferenceHintClose() {
    clearSentReferenceHintCloseTimer();
    sentReferenceHintCloseTimerRef.current = window.setTimeout(() => {
      sentReferenceHintCloseTimerRef.current = null;
      setSentReferenceHint(null);
    }, 140);
  }

  function preserveTranscriptScrollAfterRevisionAction() {
    const transcript = transcriptNodeRef.current;
    if (!transcript) return;
    const scrollTop = transcript.scrollTop;
    window.requestAnimationFrame(() => {
      transcript.scrollTop = scrollTop;
      window.requestAnimationFrame(() => {
        transcript.scrollTop = scrollTop;
      });
    });
  }

  if (!conversation) {
    return (
      <section
        className="chat-transcript empty-transcript"
        ref={setTranscriptNode}
        onScroll={handleTranscriptScroll}
      >
        <Boxes size={28} />
        <h1>No active conversation</h1>
        <p>Restore an archived conversation or open a saved destination.</p>
      </section>
    );
  }

  const loomSurfaceLink: LoomLink = {
    id: conversation.id,
    type: "conversation",
    title: conversation.title,
    path: conversation.path,
    badge: typeLabel.conversation,
    canonicalUri: conversation.meta?.canonicalUri,
    meta: conversation.meta,
    referenceCode: conversation.meta?.code,
  };

  return (
    <div className="chat-transcript-shell">
      <section
        className="chat-transcript"
        ref={setTranscriptNode}
        aria-label="Conversation transcript"
        onScroll={handleTranscriptScroll}
      >
      <div className="conversation-context">
        <div className="conversation-address-row">
          {(conversation.meta?.code || conversation.meta?.displayCode) && (
            <AddressMetadataBadge
              link={loomSurfaceLink}
              className="metadata-code-badge loom-code-badge"
              testId={`loom-code-${conversation.id}`}
              showHint={false}
              title={`Full code: ${conversation.meta.code ?? conversation.meta.displayCode}`}
              ariaLabel={`Full code: ${conversation.meta.code ?? conversation.meta.displayCode}`}
              onContextMenu={(event, link) => {
                event.preventDefault();
                event.stopPropagation();
                onCopyAddressWithToast(link);
              }}
            >
              {formatBadgeCode(conversation.meta)}
            </AddressMetadataBadge>
          )}
        </div>
        <div className="conversation-context-title-row">
          <h1>{cleanPolishedDisplayTitle(conversation.title)}</h1>
          {onReturnToOrigin && (
            <Tooltip label="Return to Origin">
              <button
                className="link-chip return-origin-chip"
                onClick={() => onReturnToOrigin()}
                aria-label="Return to Origin"
              >
                <CornerDownLeft size={13} />
              </button>
            </Tooltip>
          )}
        </div>
        <p>{cleanMarkdownDisplayTitle(conversation.summary)}</p>
      </div>

      {responses.map((response, index) => {
        const displayResponse = {
          ...response,
          title: responseTitleOverrides[response.id] ?? response.title,
        };
        const { attached: attachedPromptReferences, inline: inlinePromptReferences } =
          splitPromptReferences(displayResponse.questionReferences);
        const cleanPromptText = stripAttachedReferenceTokens(
          displayResponse.question,
          attachedPromptReferences
        );
        const isEditingPrompt = editingPromptId === displayResponse.id;
        const currentDayKey = dayKeyForTimestamp(displayResponse.createdAt);
        const previousDayKey = dayKeyForTimestamp(responses[index - 1]?.createdAt);
        const showDaySeparator =
          Boolean(displayResponse.createdAt) &&
          Boolean(currentDayKey) &&
          (index === 0 || currentDayKey !== previousDayKey);
        const responseWeftRecords = forkRecords.filter(
          (record) =>
            record.kind !== "revision" &&
            forkRecordMatchesResponse(record, conversation.id, displayResponse)
        );
        const temporaryWeft = temporaryWefts.find(
          (workspace) =>
            workspace.status !== "persisted" &&
            workspace.originLoomId === conversation.id &&
            (workspace.originResponseId === displayResponse.id ||
              workspace.originResponseId === displayResponse.serviceUserResponseId)
        );
        const hasTemporaryWeft = Boolean(temporaryWeft);
        const promptRevisionRecords = forkRecords.filter(
          (record) =>
            record.kind === "revision" &&
            record.parentConversationId === conversation.id &&
            record.revisionSourceResponseId === displayResponse.id
        );
        const hasExplicitRevisionSelection = Object.prototype.hasOwnProperty.call(
          promptRevisionSelections ?? {},
          displayResponse.id
        );
        const selectedRevisionLoomId = promptRevisionSelections?.[displayResponse.id];
        const activePromptRevisionIndex = promptRevisionRecords.findIndex(
          (record) =>
            record.childConversationId ===
            (hasExplicitRevisionSelection ? selectedRevisionLoomId : activeLoomId)
        );
        const activePromptRevision =
          hasExplicitRevisionSelection && selectedRevisionLoomId === null
            ? undefined
            : activePromptRevisionIndex >= 0
            ? promptRevisionRecords[activePromptRevisionIndex]
            : undefined;
        const displayPromptText = activePromptRevision?.revisionPrompt ?? cleanPromptText;
        const normalizedPromptEditDraft = normalizePromptEditText(promptEditDraft);
        const promptEditHasChanges =
          normalizedPromptEditDraft.length > 0 &&
          normalizedPromptEditDraft !== normalizePromptEditText(displayPromptText);
        const savePromptEdit = () => {
          const draftToSave = promptEditDraft;
          if (!promptEditHasChanges) return;
          setEditingPromptId(null);
          setPromptEditDraft("");
          void onEditPrompt(conversation.id, displayResponse.id, draftToSave);
        };
        const cancelPromptEdit = () => {
          setEditingPromptId(null);
          setPromptEditDraft("");
        };
        const responseBranchRecords = responseWeftRecords;
        const explorationWeftCount = responseBranchRecords.length;
        const hasExistingWeft = explorationWeftCount > 0;
        const hasRevisionWeft = promptRevisionRecords.length > 0;
        const hasRevisionCounter = promptRevisionRecords.length > 0;
        const revisionCounterTotal = hasRevisionCounter ? promptRevisionRecords.length + 1 : 0;
        const selectedRevisionIndex =
          activePromptRevisionIndex >= 0 ? activePromptRevisionIndex + 1 : 0;
        const previousRevisionIndex =
          revisionCounterTotal > 1 && selectedRevisionIndex > 0
            ? selectedRevisionIndex - 1
            : undefined;
        const nextRevisionIndex =
          revisionCounterTotal > 1 && selectedRevisionIndex < revisionCounterTotal - 1
            ? selectedRevisionIndex + 1
            : undefined;
        const openPromptRevisionIndex = (revisionIndex: number) => {
          preserveTranscriptScrollAfterRevisionAction();
          if (revisionIndex === 0) {
            onPromptRevisionSelect?.(displayResponse.id, null);
            return;
          }
          const revisionRecord = promptRevisionRecords[revisionIndex - 1];
          if (revisionRecord) {
            onPromptRevisionSelect?.(displayResponse.id, revisionRecord.childConversationId);
            onSelectWeft(revisionRecord, {
              preserveOriginScroll: true,
              scrollMode: "top",
            });
          }
        };
        const openExplorationWeft = (record?: ForkRecord) => {
          if (!record) return;
          setWeftBranchPickerResponseId(null);
          onSelectWeft(record, { preserveOriginScroll: true, scrollMode: "top" });
        };
        const isWeftBranchPickerOpen = weftBranchPickerResponseId === displayResponse.id;
        const weftButtonClassName = [
          "link-chip response-action-chip response-weft-chip",
          hasExistingWeft ? "is-wefted" : "",
          hasTemporaryWeft ? "is-temporary-wefted" : "",
          hasRevisionWeft ? "is-revision-wefted" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const isGeneratingResponse = displayResponse.id === generatingResponseId;
        const revealCompletionActions =
          displayResponse.id === completionActionRevealResponseId;
        const displayResponseTitle =
          cleanMarkdownDisplayTitle(displayResponse.title) || displayResponse.title;
        const responseUrl = responseAddressForConversation(conversation, displayResponse);
        const responseLink: LoomLink = {
          id: displayResponse.id,
          type: "response",
          title: displayResponseTitle,
          path: responseUrl,
          badge: typeLabel.response,
          targetObjectId: runtimeGraphObjectIdFor(
            "response",
            `${conversation.id}_${displayResponse.id}`
          ),
          canonicalUri: responseUrl,
          meta: displayResponse.meta,
          referenceCode: displayResponse.meta?.code,
          sourceLoomId: conversation.id,
          sourceResponseId: displayResponse.id,
          sourceCanonicalUri: responseUrl,
        };
        const responseBookmarkCandidates = responseIdentityCandidates(
          conversation.id,
          displayResponse,
          conversation
        );
        const isBookmarkedResponse =
          displayResponse.bookmarked ||
          Array.from(responseBookmarkCandidates).some((candidate) =>
            bookmarkedPaths.has(candidate)
          );
        return (
          <Fragment key={response.id}>
          {showDaySeparator && displayResponse.createdAt && (
            <div className="conversation-day-separator">
              <span>{formatConversationDaySeparator(displayResponse.createdAt)}</span>
            </div>
          )}
          <article
            className={[
              "qa-item",
              displayResponse.id === highlightedResponseId
                ? "response-scroll-highlight"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-response-id={displayResponse.id}
            data-response-address={displayResponse.address}
            onMouseUp={() => onSelectionAsk(displayResponse)}
            onContextMenu={(event) => onOpenContextMenu(event, displayResponse)}
          >
            <div
              className={[
                "user-turn",
                isEditingPrompt ? "is-editing-prompt" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-prompt-response-id={displayResponse.id}
            >
              <div className="user-message">
                <AttachedPromptReferences
                  references={attachedPromptReferences}
                  onOpenReference={onOpenReference}
                  onReferenceHint={showSentReferenceHint}
                  onReferenceHintClose={scheduleSentReferenceHintClose}
                />
                {isEditingPrompt ? (
                  <div className="prompt-edit-panel">
                    {inlinePromptReferences.length > 0 && (
                      <div className="prompt-edit-reference-row" aria-label="Preserved References">
                        {inlinePromptReferences.map((link) => (
                          <button
                            className="sent-prompt-reference-token"
                            key={referenceIdentityKey(link)}
                            type="button"
                            onClick={() => onOpenReference(link)}
                            title={link.selectedText ?? link.title}
                          >
                            <span>{referenceLabelForMode(link, link.referenceDisplayMode ?? "title")}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea
                      className="prompt-edit-textarea"
                      value={promptEditDraft}
                      aria-label="Edit prompt text"
                      onChange={(event) => setPromptEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelPromptEdit();
                          return;
                        }
                        if (
                          event.key === "Enter" &&
                          (event.metaKey || event.ctrlKey)
                        ) {
                          event.preventDefault();
                          savePromptEdit();
                        }
                      }}
                      rows={Math.min(Math.max(promptEditDraft.split("\n").length, 2), 8)}
                    />
                    <div className="prompt-edit-actions">
                      <button
                        type="button"
                        onClick={savePromptEdit}
                        disabled={!promptEditHasChanges}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelPromptEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <CollapsibleUserPromptContent
                    text={displayPromptText}
                    references={inlinePromptReferences}
                    collapseEnabled={collapseUserMessages}
                    onOpenReference={onOpenReference}
                    onReferenceHint={showSentReferenceHint}
                    onReferenceHintClose={scheduleSentReferenceHintClose}
                  />
                )}
              </div>
              {!isEditingPrompt && (
                <div className="user-prompt-actions" aria-label="Prompt actions">
                  {hasRevisionCounter && (
                    <div
                      className="prompt-action-button prompt-revision-action-counter"
                      aria-label={`Message revisions ${selectedRevisionIndex + 1} of ${revisionCounterTotal}`}
                      title="Message revisions"
                    >
                      <button
                        type="button"
                        aria-label="Previous message revision"
                        title="Previous message revision"
                        disabled={previousRevisionIndex === undefined}
                        onClick={() => {
                          if (previousRevisionIndex !== undefined) {
                            openPromptRevisionIndex(previousRevisionIndex);
                          }
                        }}
                      >
                        {"<"}
                      </button>
                      <span>
                        {selectedRevisionIndex + 1}/{revisionCounterTotal}
                      </span>
                      <button
                        type="button"
                        aria-label="Next message revision"
                        title="Next message revision"
                        disabled={nextRevisionIndex === undefined}
                        onClick={() => {
                          if (nextRevisionIndex !== undefined) {
                            openPromptRevisionIndex(nextRevisionIndex);
                          }
                        }}
                      >
                        {">"}
                      </button>
                    </div>
                  )}
                  <Tooltip label="Copy prompt" placement="bottom-right">
                    <button
                      type="button"
                      className="prompt-action-button prompt-copy-trigger"
                      aria-label={`Copy prompt: ${displayResponse.title}`}
                      data-testid={`copy-prompt-${displayResponse.id}`}
                      onClick={() => onCopyPrompt(displayPromptText, inlinePromptReferences)}
                    >
                      <Copy size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip label="Edit prompt" placement="bottom-right">
                    <button
                      type="button"
                      className="prompt-action-button prompt-edit-trigger"
                      aria-label={`Edit prompt: ${displayResponse.title}`}
                      data-testid={`edit-prompt-${displayResponse.id}`}
                      onClick={() => {
                        setEditingPromptId(displayResponse.id);
                        setPromptEditDraft(displayPromptText);
                      }}
                    >
                      <Edit3 size={16} />
                    </button>
                  </Tooltip>
                  {conversation && displayResponse.serviceUserResponseId && (
                    <Tooltip label="Retry" placement="bottom-right">
                      <button
                        type="button"
                        className="prompt-action-button prompt-retry-trigger"
                        aria-label="Retry from this message"
                        data-testid={`retry-prompt-${displayResponse.id}`}
                        title="Retry"
                        onClick={(event) => {
                          onRetryPrompt(conversation.id, displayResponse.id, event.currentTarget);
                        }}
                      >
                        <RotateCcw size={16} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>
            <div className="assistant-message">
              {(displayResponse.meta?.code || displayResponse.meta?.displayCode) && !isGeneratingResponse && (
                <div className="response-metadata-row">
                  <AddressMetadataBadge
                    link={responseLink}
                    className="metadata-code-badge loom-code-badge response-code-badge"
                    testId={`response-code-${displayResponse.id}`}
                    showHint={false}
                    title={`Full code: ${displayResponse.meta.code ?? displayResponse.meta.displayCode}`}
                    ariaLabel={`Full code: ${displayResponse.meta.code ?? displayResponse.meta.displayCode}`}
                    onContextMenu={(event, link) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onCopyAddressWithToast(link);
                    }}
                  >
                    {formatBadgeCode(displayResponse.meta)}
                  </AddressMetadataBadge>
                </div>
              )}
              {isBookmarkedResponse && (
                <div className="assistant-header">
                  <div>
                    <div className="semantic-title">{displayResponseTitle}</div>
                    <div className="loom-address">{displayResponse.address}</div>
                  </div>
                </div>
              )}
              {!isGeneratingResponse && (
                <ResponseActions
                  response={displayResponse}
                  onOpenContextMenu={onOpenContextMenu}
                />
              )}
              <div className="assistant-body">
                <ThinkingPanel
                  response={displayResponse}
                  visibleProgress={displayResponse.visibleProgress}
                  showDebug={showGenerationDebug}
                  onAnswerNow={onAnswerNowFromThinking}
                  onContinueThinking={onContinueThinking}
                  onStop={onStopThinking}
                />
                <CollapsibleResponseContent
                  responseId={displayResponse.id}
                  markdown={responseMarkdownSource(displayResponse)}
                  codeBlocks={displayResponse.codeBlocks}
                  onCopyCode={onCopyCode}
                  onAddCodeReference={(codeBlock) =>
                    onAddCodeReference(conversation, displayResponse, codeBlock)
                  }
                  onOpenReference={onOpenReference}
                  onReferenceHint={showSentReferenceHint}
                  onReferenceHintClose={scheduleSentReferenceHintClose}
                />
                {displayResponse.answerStale && !isGeneratingResponse && (
                  <div className="stale-answer-notice">
                    <span>Answer may be outdated after prompt edit.</span>
                    <button
                      type="button"
                      disabled={!conversation || !displayResponse.serviceUserResponseId}
                      title={
                        displayResponse.serviceUserResponseId
                          ? "Regenerate from the edited prompt"
                          : "Regenerate from here requires a persisted service prompt."
                      }
                      onClick={() => {
                        if (conversation) onRegenerateFromPrompt(conversation.id, displayResponse.id);
                      }}
                    >
                      Regenerate from here
                    </button>
                  </div>
                )}
                {displayResponse.truncated && !isGeneratingResponse && (
                  <ResponseTruncationNotice
                    onContinue={() => onContinueTruncatedResponse(displayResponse.id)}
                  />
                )}
              </div>

              {!isGeneratingResponse && (
              <div
                className={
                  revealCompletionActions
                    ? "reference-strip response-completion-reveal"
                    : "reference-strip"
                }
              >
                <Tooltip label="Copy" placement="bottom-right">
                  <button
                    type="button"
                    className="link-chip response-action-chip"
                    onClick={() => onCopyResponse(displayResponse)}
                    aria-label={`Copy response: ${displayResponseTitle}`}
                  >
                    <Copy size={13} />
                  </button>
                </Tooltip>
                <Tooltip label="Bookmark" placement="bottom-right">
                  <button
                    className={isBookmarkedResponse ? "link-chip response-bookmark-chip bookmarked" : "link-chip response-bookmark-chip"}
                    onClick={() =>
                      onToggleSuggestedBookmark(
                        responseLink,
                        isBookmarkedResponse
                      )
                    }
                    aria-pressed={isBookmarkedResponse}
                    aria-label={isBookmarkedResponse ? `Remove bookmark for ${displayResponseTitle}` : `Bookmark suggested ${displayResponseTitle}`}
                  >
                    <Bookmark size={13} fill={isBookmarkedResponse ? "currentColor" : "none"} />
                  </button>
                </Tooltip>
                <Tooltip label="Link" placement="bottom-right">
                  <AddressMetadataBadge
                    as="button"
                    link={responseLink}
                    className="link-chip response-action-chip response-link-chip"
                    title="Link"
                    showHint={false}
                    onClick={() => onLink(responseLink)}
                    testId={`response-link-${displayResponse.id}`}
                    ariaLabel={`Link ${displayResponseTitle}`}
                    onCopy={onCopyAddress}
                  >
                    <Link2 size={13} />
                  </AddressMetadataBadge>
                </Tooltip>
                <span className="response-weft-action-cluster">
                  <Tooltip label={hasTemporaryWeft ? "Focus Weft" : "Start Weft"} placement="bottom-right">
                    <button
                      className={weftButtonClassName}
                      onClick={(event) => {
                        event.preventDefault();
                        setWeftBranchPickerResponseId(null);
                        onLoom(displayResponse);
                      }}
                      aria-pressed={hasExistingWeft || hasTemporaryWeft}
                      aria-label={
                        hasTemporaryWeft
                          ? `Focus temporary Flow from ${displayResponseTitle}`
                          : `Start Weft from ${displayResponseTitle}`
                      }
                      title={
                        explorationWeftCount > 0
                          ? `${explorationWeftCount} Weft${
                              explorationWeftCount === 1 ? "" : "s"
                            } from this response`
                          : undefined
                      }
                    >
                      <GitFork size={13} />
                    </button>
                  </Tooltip>
                  {explorationWeftCount > 0 && (
                    <button
                      type="button"
                      className="response-weft-count-trigger"
                      aria-label={`${explorationWeftCount} Wefts from this response`}
                      aria-haspopup="menu"
                      aria-expanded={isWeftBranchPickerOpen}
                      title={`${explorationWeftCount} Weft${
                        explorationWeftCount === 1 ? "" : "s"
                      } from this response`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setWeftBranchPickerResponseId((current) =>
                          current === displayResponse.id ? null : displayResponse.id
                        );
                      }}
                    >
                      <span className="response-weft-chip-count">{explorationWeftCount}</span>
                      <ChevronsUpDown size={11} aria-hidden="true" />
                    </button>
                  )}
                {(() => {
                  const { inferenceTokenCount, inferenceMs } = displayResponse;
                  const isFinalized = displayResponse.serviceGenerationStatus === "completed" ||
                    displayResponse.serviceGenerationStatus === "truncated";
                  if (!isFinalized || (inferenceTokenCount === undefined && inferenceMs === undefined)) return null;
                  const parts: string[] = [];
                  if (inferenceTokenCount !== undefined) parts.push(formatTokenCount(inferenceTokenCount));
                  if (inferenceMs !== undefined) parts.push(formatElapsedTime(inferenceMs / 1000));
                  return (
                    <span className="response-inference-metadata" aria-label={`Inference: ${parts.join(", ")}`}>
                      {parts.join(" · ")}
                    </span>
                  );
                })()}
                  {isWeftBranchPickerOpen && (
                    <div className="weft-branch-picker" role="menu" aria-label="Weft branches">
                      {responseBranchRecords.map((record, branchIndex) => (
                        <button
                          key={record.id}
                          type="button"
                          role="menuitem"
                          className={
                            record.childConversationId === activeLoomId ? "active" : undefined
                          }
                          onClick={() => openExplorationWeft(record)}
                        >
                          <GitFork size={13} />
                          <span>
                            <strong>
                              {conversationTitlesById[record.childConversationId] ??
                                record.title}
                            </strong>
                            <em className="weft-branch-picker-meta">
                              <span>{branchIndex + 1} of {explorationWeftCount}</span>
                              <span>
                                {formatRelativeTimestamp(record.createdAt) ||
                                  formatRelativeTimestamp(record.updatedAt) ||
                                  formatRelativeTimestamp(new Date().toISOString())}
                              </span>
                            </em>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </span>
              </div>
              )}
            </div>
          </article>
          </Fragment>
        );
      })}
      {sentReferenceHint && (
        <AddressHintPopover
          link={sentReferenceHint.link}
          style={{
            left: sentReferenceHint.x,
            top: sentReferenceHint.y,
            maxHeight: sentReferenceHint.maxHeight,
            transform:
              sentReferenceHint.placement === "top"
                ? "translateY(-100%)"
                : "translateY(0)",
          }}
          placement={sentReferenceHint.placement}
          onEnter={clearSentReferenceHintCloseTimer}
          onClose={scheduleSentReferenceHintClose}
          onCopy={onCopyAddress}
        />
      )}
      </section>
      <ScrollToBottomButton
        visible={scrollToBottomVisible}
        onClick={() => {
          onScrollToBottom?.();
          scrollToBottom();
        }}
      />
    </div>
  );
}

function ResponseActions({
  response,
  onOpenContextMenu,
}: {
  response: ResponseItem;
  onOpenContextMenu: (event: React.MouseEvent, response: ResponseItem) => void;
}) {
  return (
    <div
      className="response-actions"
      aria-label={`Actions for ${response.title}`}
    >
      <button
        type="button"
        aria-label="More response actions"
        onClick={(event) => onOpenContextMenu(event, response)}
      >
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
  referenceDisplayMode,
  modelResponseMode,
  providerSettings,
  engineClient,
  runtimeState,
  runtimeHealth,
  active = true,
  textInsertionRequest,
  onProviderSettingsChange,
  onModelResponseModeChange,
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
  onStop,
  onUserTyping,
}: {
  variant?: "bottom" | "centered";
  draftKey: string;
  draft: ComposerDraft;
  attachedReferences: LoomLink[];
  referenceOptions: ComposerReferenceOption[];
  attachContentItems: AttachContentItem[];
  referenceDisplayMode: ReferenceDisplayMode;
  modelResponseMode: ModelResponseMode;
  providerSettings: AIProviderSettings;
  engineClient: LoomEngineClient;
  runtimeState: { running: boolean; message: string | null };
  runtimeHealth: RuntimeHealthState & {
    checking: boolean;
    testRuntime: () => Promise<RuntimeHealthState>;
  };
  active?: boolean;
  textInsertionRequest?: TextInsertionRequest | null;
  onProviderSettingsChange: (settings: AIProviderSettings) => void;
  onModelResponseModeChange: (mode: ModelResponseMode) => void;
  onActivate?: () => void;
  onDraftChange: (draft: ComposerDraft) => void;
  onRemoveLink: (link: LoomLink) => void;
  onRemoveAttachedReference: (link: LoomLink) => void;
  onReadyToFocus: (focus: () => void) => void;
  onDropLink: (link: LoomLink) => void;
  onResolveReference: (link: LoomLink) => LoomLink;
  onOpenReference: (link: LoomLink) => string | null;
  onCopyReferenceAddress: (link: Pick<LoomLink, "path" | "canonicalUri">) => void;
  onSend: (
    draft: ComposerDraft,
    options: { effort: ModelEffort; mode: ModelResponseMode }
  ) => Promise<boolean>;
  onStop: () => void;
  onUserTyping: () => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceButtonRef = useRef<HTMLButtonElement>(null);
  const referenceMenuRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const insertedPathsRef = useRef<Set<string>>(new Set());
  const activeDraftKeyRef = useRef("");
  const historiesRef = useRef<Record<string, ComposerHistoryState>>({});
  const applyingHistoryRef = useRef(false);
  const stoppedRunningSubmitRef = useRef(false);
  const pendingComposerFollowRef = useRef(false);
  const pendingInputRef = useRef<{
    inputType: string;
    replacesSelection: boolean;
  } | null>(null);
  const lastEditorRangeRef = useRef<Range | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  const [attachSearch, setAttachSearch] = useState("");
  const [attachTab, setAttachTab] = useState<AttachContentTab>("all");
  const [attachFeedback, setAttachFeedback] = useState<string | null>(null);
  const [attachPopoverStyle, setAttachPopoverStyle] = useState<{
    left: number;
    top: number;
    minWidth: number;
    height: number;
    placement: "top" | "bottom";
  } | null>(null);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceSearch, setReferenceSearch] = useState("");
  const [referenceSelectedIndex, setReferenceSelectedIndex] = useState(0);
  const [referencePopoverStyle, setReferencePopoverStyle] = useState<{
    left: number;
    top: number;
    minWidth: number;
    placement: "top" | "bottom";
  } | null>(null);
  const [referenceOpenError, setReferenceOpenError] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPopoverStyle, setModelPopoverStyle] = useState<{
    left: number;
    top: number;
    minWidth: number;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [tokenContextMenu, setTokenContextMenu] = useState<{
    link: LoomLink;
    x: number;
    y: number;
  } | null>(null);
  const [tokenRenamePopover, setTokenRenamePopover] = useState<{
    link: LoomLink;
    x: number;
    y: number;
    value: string;
    error: string | null;
  } | null>(null);
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  const [addressHint, setAddressHint] = useState<{
    link: LoomLink;
    x: number;
    y: number;
    placement: "top" | "bottom";
    maxHeight: number;
  } | null>(null);
  const speechSnapshotRef = useRef<{
    draft: ComposerDraft;
    range: Range | null;
    selectionStart: number;
    selectionEnd: number;
  } | null>(null);
  const addressHintTimerRef = useRef<number | null>(null);
  const addressHintAutoCloseTimerRef = useRef<number | null>(null);
  const addressHintTargetRef = useRef<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const lastTextInsertionRequestRef = useRef(0);
  const mainModel = getProfileModel(providerSettings, "main");
  const installedModels = providerSettings.ollama.models.filter((model) => model.installed);
  const selectableModels =
    mainModel.provider === "mock"
      ? [mainModel]
      : installedModels.length > 0
        ? installedModels
        : providerSettings.ollama.models;
  const selectedModelId = mainModel.id;
  const runtimeWarning =
    getConfiguredLoomEngineMode() === "rust-service"
      ? null
      : !runtimeHealth.ollama_running
        ? "Ollama is not running. Test Runtime in AI Providers."
        : !runtimeHealth.models_available
          ? "No Ollama models are installed. Pull a model before sending."
          : !runtimeHealth.selected_model_ready
            ? `${mainModel.name} is not installed. Download it in AI Providers.`
            : null;
  const speechRecorder = useSpeechToTextRecorder(engineClient);
  const speechActive = speechRecorder.status !== "idle";
  const electronPermissions = getElectronPermissionsBridge();

  function setMainModel(modelId: string) {
    onProviderSettingsChange({
      ...providerSettings,
      profiles: {
        ...providerSettings.profiles,
        mainModelId: modelId,
      },
    });
  }

  const resizeEditorToContent = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const styles = window.getComputedStyle(editor);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const minHeight = lineHeight + paddingTop + paddingBottom;
    const maxHeight = lineHeight * 8 + paddingTop + paddingBottom;
    const measure = document.createElement("div");
    measure.className = editor.className;
    measure.setAttribute("aria-hidden", "true");
    measure.innerHTML = editor.innerHTML || "<br>";
    measure.style.position = "absolute";
    measure.style.visibility = "hidden";
    measure.style.pointerEvents = "none";
    measure.style.zIndex = "-1";
    measure.style.left = "-9999px";
    measure.style.top = "0";
    measure.style.width = `${editor.clientWidth}px`;
    measure.style.height = "auto";
    measure.style.minHeight = "0";
    measure.style.maxHeight = "none";
    measure.style.overflow = "visible";
    document.body.appendChild(measure);
    const nextHeight = Math.ceil(
      Math.min(Math.max(measure.scrollHeight, minHeight), maxHeight)
    );
    document.body.removeChild(measure);
    setEditorHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  function followTranscriptAfterComposerLayout() {
    pendingComposerFollowRef.current = true;
    window.requestAnimationFrame(() => {
      resizeEditorToContent();
      window.requestAnimationFrame(() => {
        if (!pendingComposerFollowRef.current) return;
        pendingComposerFollowRef.current = false;
        onUserTyping();
        window.setTimeout(onUserTyping, 0);
        window.setTimeout(onUserTyping, 80);
      });
    });
  }

  function revealEditorInsertion(node?: HTMLElement | null) {
    const editor = editorRef.current;
    if (!editor) return;
    window.requestAnimationFrame(() => {
      resizeEditorToContent();
      window.requestAnimationFrame(() => {
        const currentEditor = editorRef.current;
        if (!currentEditor) return;
        if (node && currentEditor.contains(node)) {
          const nodeBottom = node.offsetTop + node.offsetHeight;
          const visibleBottom = currentEditor.scrollTop + currentEditor.clientHeight;
          if (nodeBottom > visibleBottom) {
            currentEditor.scrollTop = nodeBottom - currentEditor.clientHeight;
          }
          return;
        }
        currentEditor.scrollTop = currentEditor.scrollHeight;
      });
    });
  }

  useLayoutEffect(() => {
    const raf = window.requestAnimationFrame(resizeEditorToContent);
    return () => window.cancelAnimationFrame(raf);
  });

  useEffect(() => {
    onReadyToFocus(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }, [onReadyToFocus]);

  useEffect(() => {
    const request = textInsertionRequest;
    const editor = editorRef.current;
    if (!request || !editor || request.id === lastTextInsertionRequestRef.current) return;
    lastTextInsertionRequestRef.current = request.id;
    editor.textContent = request.text;
    insertedPathsRef.current.clear();
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    resizeEditorToContent();
    commitDraftChange("replace");
  }, [resizeEditorToContent, textInsertionRequest?.id]);

  const filteredMentionOptions = useMemo(() => {
    const query = mention?.query.trim() ?? "";
    return filterAndRankReferenceSuggestions(referenceOptions, query);
  }, [mention?.query, referenceOptions]);

  const groupedMentionOptions = useMemo(() => {
    const groups: ComposerReferenceGroup[] = ["Open Looms", "Responses", "Code Snippets", "Bookmarks", "History"];
    return groups
      .map((group) => ({
        group,
        options: filteredMentionOptions.filter((option) => option.group === group),
      }))
      .filter((group) => group.options.length > 0);
  }, [filteredMentionOptions]);

  const flattenedMentionOptions = groupedMentionOptions.flatMap((group) => group.options);

  const currentAttachments = useMemo(
    () => sortAttachmentsBySelection(draft.attachments ?? []),
    [draft.attachments]
  );
  useEffect(() => {
    if (!currentAttachments.some(attachmentParseActive)) return;
    let cancelled = false;
    const refreshAttachments = async () => {
      try {
        const result = await engineClient.listAttachments({ loomId: draftKey });
        if (cancelled) return;
        const byId = new globalThis.Map(
          result.attachments.map((attachment) => [attachment.attachmentId, attachment])
        );
        const nextAttachments = (draftRef.current.attachments ?? []).map((attachment) => {
          const attachmentId = attachment.attachmentId ?? attachment.id;
          const stored = byId.get(attachmentId);
          return stored
            ? {
                ...attachment,
                id: stored.attachmentId,
                attachmentId: stored.attachmentId,
                loomId: stored.loomId,
                name: stored.fileName,
                size: stored.sizeBytes,
                type: stored.mimeType ?? attachment.type,
                extension: stored.extension,
                kind: stored.kind,
                parseStatus: stored.parseStatus,
                parser: stored.parser,
                error: stored.error,
                thumbnailDataUrl: stored.thumbnailDataUrl,
                parsedCharCount: stored.parsedCharCount,
                metadataJson: stored.metadataJson,
              }
            : attachment;
        });
        updateDraftAttachments(nextAttachments);
      } catch {
        // Keep current chip state; upload error handling already reports failures.
      }
    };
    void refreshAttachments();
    const interval = window.setInterval(refreshAttachments, 900);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentAttachments, draftKey, engineClient]);
  const draftAttachedReferences = useMemo(
    () => splitPromptReferences(draft.links).attached,
    [draft.links]
  );
  const draftInlineReferences = useMemo(
    () => splitPromptReferences(draft.links).inline,
    [draft.links]
  );
  const visibleAttachedReferences = useMemo(
    () => mergeUniqueReferences([...attachedReferences, ...draftAttachedReferences]),
    [attachedReferences, draftAttachedReferences]
  );

  const filteredLinkedReferences = useMemo(() => {
    const allReferences = [...visibleAttachedReferences, ...draftInlineReferences];
    const query = referenceSearch.trim().toLowerCase();
    if (!query) return allReferences;
    return allReferences.filter((link) =>
      [link.title, link.path, link.badge]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [visibleAttachedReferences, draftInlineReferences, referenceSearch]);

  useEffect(() => {
    setReferenceSelectedIndex((current) =>
      Math.min(current, Math.max(filteredLinkedReferences.length - 1, 0))
    );
  }, [filteredLinkedReferences.length]);

  const selectedReferenceKeys = useMemo(() => {
    const keys = new Set<string>();
    [...visibleAttachedReferences, ...draftInlineReferences].forEach((link) => {
      selectedReferenceKeysForLink(link).forEach((key) => keys.add(key));
    });
    return keys;
  }, [visibleAttachedReferences, draftInlineReferences]);

  const selectedReferenceRanks = useMemo(() => {
    const ranks = new globalThis.Map<string, number>();
    [...visibleAttachedReferences, ...draftInlineReferences].forEach((link, index) => {
      const rank = link.selectedAt ?? index + 1;
      selectedReferenceKeysForLink(link).forEach((key) => {
        ranks.set(key, Math.max(ranks.get(key) ?? 0, rank));
      });
    });
    return ranks;
  }, [visibleAttachedReferences, draftInlineReferences]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const filteredAttachItems = useMemo(() => {
    const query = attachSearch.trim().toLowerCase();
    const matchingItems = attachContentItems.filter((item) => {
      if (attachTab === "bookmarks" && item.source !== "bookmark") return false;
      if (attachTab === "history" && item.source !== "history") return false;
      if (attachTab === "openLooms" && item.source !== "openLoom") return false;
      if (attachTab === "responses" && item.source !== "response") return false;
      if (attachTab === "codeSnippets" && item.source !== "codeSnippet") return false;
      if (attachTab === "files") return false;
      if (!query) return true;
      return [item.title, item.subtitle, item.path, item.badge, item.source, ...item.keywords]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    return sortAttachContentItemsBySelection(matchingItems, selectedReferenceRanks);
  }, [attachContentItems, attachSearch, attachTab, selectedReferenceRanks]);

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
      {
        id: "codeSnippet" as const,
        title: "Code Snippets",
        items: filteredAttachItems.filter((item) => item.source === "codeSnippet"),
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
        modelPickerOpen &&
        modelButtonRef.current &&
        modelMenuRef.current &&
        !modelButtonRef.current.contains(target) &&
        !modelMenuRef.current.contains(target)
      ) {
        setModelPickerOpen(false);
        setModelPopoverStyle(null);
      }
      if (
        mention &&
        editorRef.current &&
        !editorRef.current.contains(target) &&
        !mentionMenuRef.current?.contains(target)
      ) {
        setMention(null);
      }
      if (
        tokenContextMenu &&
        !((target as Element | null)?.closest(".reference-token-context-menu"))
      ) {
        setTokenContextMenu(null);
      }
      if (
        tokenRenamePopover &&
        !((target as Element | null)?.closest(".reference-token-rename-popover"))
      ) {
        setTokenRenamePopover(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (speechActive) {
          event.preventDefault();
          cancelSpeechRecording();
          return;
        }
        setMention(null);
        setAttachPickerOpen(false);
        setAttachFeedback(null);
        setReferencePickerOpen(false);
        setReferenceOpenError(null);
        setModelPickerOpen(false);
        setModelPopoverStyle(null);
        setTokenContextMenu(null);
        setTokenRenamePopover(null);
        closeAddressHint();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      const target = event.target as Node | null;
      if (
        mention &&
        target &&
        editorRef.current &&
        !editorRef.current.contains(target) &&
        !mentionMenuRef.current?.contains(target)
      ) {
        setMention(null);
      }
    }

    function handleScroll() {
      if (addressHint) closeAddressHint();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [
    addressHint,
    attachPickerOpen,
    mention,
    modelPickerOpen,
    referencePickerOpen,
    speechActive,
    speechRecorder,
    tokenContextMenu,
    tokenRenamePopover,
  ]);

  useEffect(() => () => {
    clearAddressHintTimer();
    clearAddressHintAutoCloseTimer();
  }, []);

  useEffect(() => {
    clearAddressHintAutoCloseTimer();
    return clearAddressHintAutoCloseTimer;
  }, [addressHint?.link.path]);

  useEffect(() => {
    if (!tokenRenamePopover) return;
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [tokenRenamePopover?.link.path, tokenRenamePopover?.x, tokenRenamePopover?.y]);

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
      const topBarRect = document.querySelector(".top-browser-bar")?.getBoundingClientRect();
      const viewportPadding = 12;
      const topBoundary = Math.max(viewportPadding, (topBarRect?.bottom ?? 0) + 8);
      const gap = 6;
      const minWidth = Math.max(buttonRect.width, 430);
      const desiredMenuHeight = 360;
      const minimumMenuHeight = 220;
      const availableAbove = Math.max(0, buttonRect.top - gap - topBoundary);
      const availableBelow = Math.max(
        0,
        window.innerHeight - viewportPadding - buttonRect.bottom - gap
      );
      const openAbove =
        availableAbove >= minimumMenuHeight || availableAbove >= availableBelow;
      const fixedMenuHeight = openAbove
        ? Math.min(desiredMenuHeight, Math.max(minimumMenuHeight, availableAbove))
        : Math.min(desiredMenuHeight, Math.max(minimumMenuHeight, availableBelow));

      let left = buttonRect.left;
      const top = openAbove
        ? Math.max(topBoundary, buttonRect.top - gap - fixedMenuHeight)
        : Math.min(
            buttonRect.bottom + gap,
            window.innerHeight - viewportPadding - fixedMenuHeight
          );
      const placement: "top" | "bottom" = openAbove ? "top" : "bottom";

      const width = Math.max(menuRect.width, minWidth);
      if (left + width > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      }

      setAttachPopoverStyle({ left, top, minWidth: width, height: fixedMenuHeight, placement });
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

  useLayoutEffect(() => {
    if (!modelPickerOpen) {
      setModelPopoverStyle(null);
      return;
    }

    function updateModelPopoverPosition() {
      const button = modelButtonRef.current;
      const menu = modelMenuRef.current;
      if (!button || !menu) return;

      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 6;
      const minWidth = Math.max(buttonRect.width, 220);
      let left = buttonRect.left;
      let top = buttonRect.bottom + gap;
      const menuHeight = menuRect.height || 44 * selectableModels.length;

      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = Math.max(viewportPadding, buttonRect.top - gap - menuHeight);
      }

      const width = Math.max(menuRect.width, minWidth);
      if (left + width > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      }

      setModelPopoverStyle({ left, top, minWidth: width });
    }

    const raf = window.requestAnimationFrame(updateModelPopoverPosition);
    window.addEventListener("resize", updateModelPopoverPosition);
    window.addEventListener("scroll", updateModelPopoverPosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateModelPopoverPosition);
      window.removeEventListener("scroll", updateModelPopoverPosition, true);
    };
  }, [modelPickerOpen, selectableModels.length]);

  useLayoutEffect(() => {
    if (!mention) return;

    function updateMentionPopoverPosition() {
      setMention((current) => {
        if (!current) return current;
        const position = measureMentionPosition(current.range);
        const selectedIndex = Math.min(
          current.selectedIndex,
          Math.max(flattenedMentionOptions.length - 1, 0)
        );
        if (
          current.x === position.x &&
          current.y === position.y &&
          current.width === position.width &&
          current.maxHeight === position.maxHeight &&
          current.placement === position.placement &&
          current.selectedIndex === selectedIndex
        ) {
          return current;
        }
        return {
          ...current,
          ...position,
          selectedIndex,
        };
      });
    }

    const raf = window.requestAnimationFrame(updateMentionPopoverPosition);
    window.addEventListener("resize", updateMentionPopoverPosition);
    window.addEventListener("scroll", updateMentionPopoverPosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateMentionPopoverPosition);
      window.removeEventListener("scroll", updateMentionPopoverPosition, true);
    };
  }, [flattenedMentionOptions.length, mention?.query, mention?.range]);

  useLayoutEffect(() => {
    if (!mention) return;
    const menu = mentionMenuRef.current;
    if (!menu) return;
    const selected = menu.querySelector<HTMLElement>(".mention-option.selected");
    selected?.scrollIntoView({ block: "nearest" });
  }, [mention?.selectedIndex, mention?.query]);

  function clearAddressHintTimer() {
    if (addressHintTimerRef.current === null) return;
    window.clearTimeout(addressHintTimerRef.current);
    addressHintTimerRef.current = null;
  }

  function clearAddressHintAutoCloseTimer() {
    if (addressHintAutoCloseTimerRef.current === null) return;
    window.clearTimeout(addressHintAutoCloseTimerRef.current);
    addressHintAutoCloseTimerRef.current = null;
  }

  function closeAddressHint() {
    clearAddressHintTimer();
    clearAddressHintAutoCloseTimer();
    addressHintTargetRef.current = null;
    setAddressHint(null);
  }

  function scheduleAddressHintClose() {
    clearAddressHintTimer();
    clearAddressHintAutoCloseTimer();
    addressHintAutoCloseTimerRef.current = window.setTimeout(() => {
      addressHintAutoCloseTimerRef.current = null;
      addressHintTargetRef.current = null;
      setAddressHint(null);
    }, REFERENCE_ADDRESS_HINT_CLOSE_DELAY_MS);
  }

  function getTokenFromEventTarget(target: EventTarget | null) {
    if (target instanceof HTMLElement) {
      const token = target.closest<HTMLElement>(".inline-loom-token, .selection-reference-chip");
      if (token?.classList.contains("selection-reference-chip--quote")) return null;
      return token;
    }
    if (target instanceof Text) {
      const token = target.parentElement?.closest<HTMLElement>(
        ".inline-loom-token, .selection-reference-chip"
      ) ?? null;
      if (token?.classList.contains("selection-reference-chip--quote")) return null;
      return token;
    }
    return null;
  }

  function anchorRectForMentionRange(range: Range) {
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
      if (selectionRect.width > 0 || selectionRect.height > 0) return selectionRect;
    }
    return editorRef.current?.getBoundingClientRect() ?? surfaceRef.current?.getBoundingClientRect() ?? rect;
  }

  function measureMentionPosition(range: Range) {
    const anchorRect = anchorRectForMentionRange(range);
    const viewportPadding = 12;
    const gap = 8;
    const width = Math.min(340, Math.max(260, window.innerWidth - viewportPadding * 2));
    const availableBelow = window.innerHeight - anchorRect.bottom - gap - viewportPadding;
    const availableAbove = anchorRect.top - gap - viewportPadding;
    const placement: MentionState["placement"] =
      availableBelow >= 220 || availableBelow >= availableAbove ? "bottom" : "top";
    const availableSpace = placement === "bottom" ? availableBelow : availableAbove;
    const maxHeight = Math.max(48, Math.min(320, availableSpace));
    const left = Math.max(
      viewportPadding,
      Math.min(anchorRect.left, window.innerWidth - width - viewportPadding)
    );
    const y =
      placement === "bottom"
        ? Math.max(
            viewportPadding,
            Math.min(anchorRect.bottom + gap, window.innerHeight - viewportPadding - maxHeight)
          )
        : Math.max(
            viewportPadding + maxHeight,
            Math.min(anchorRect.top - gap, window.innerHeight - viewportPadding)
          );

    return {
      x: left,
      y,
      width,
      maxHeight,
      placement,
    };
  }

  function openReferenceFromComposerToken(link: LoomLink) {
    const error = onOpenReference(link);
    setReferenceOpenError(error);
    return error;
  }

  function scheduleAddressHintForToken(token: HTMLElement) {
    const link =
      token.classList.contains("inline-loom-token")
        ? linkFromInlineToken(token)
        : visibleAttachedReferences.find((item) => item.path === token.dataset.loomPath);
    if (!link) return;
    const targetKey = selectedReferenceKeysForLink(link)[0] ?? link.path;
    clearAddressHintAutoCloseTimer();
    if (addressHint && addressHintTargetRef.current === targetKey) {
      return;
    }
    if (addressHintTimerRef.current !== null && addressHintTargetRef.current === targetKey) {
      return;
    }
    clearAddressHintTimer();
    addressHintTargetRef.current = targetKey;
    addressHintTimerRef.current = window.setTimeout(() => {
      addressHintTimerRef.current = null;
      const rect = token.getBoundingClientRect();
      const viewportPadding = 8;
      const hoverGap = 5;
      const width = Math.min(340, window.innerWidth - viewportPadding * 2);
      const estimatedHeight = link.type === "fragment" && link.selectedText ? 190 : 108;
      const availableAbove = rect.top - hoverGap - viewportPadding;
      const availableBelow = window.innerHeight - rect.bottom - hoverGap - viewportPadding;
      const openAbove = availableAbove >= estimatedHeight || availableAbove >= availableBelow;
      setAddressHint({
        link,
        x: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding)),
        y: openAbove
          ? Math.max(viewportPadding, rect.top - hoverGap)
          : Math.min(window.innerHeight - viewportPadding, rect.bottom + hoverGap),
        placement: openAbove ? "top" : "bottom",
        maxHeight: Math.max(120, openAbove ? availableAbove : availableBelow),
      });
    }, REFERENCE_ADDRESS_HINT_DELAY_MS);
  }

  function updateInlineTokenDisplayMode(
    token: HTMLElement,
    displayMode: ReferenceDisplayMode
  ) {
    const link = linkFromInlineToken(token);
    if (!link) return;
    const nextLink: LoomLink = {
      ...link,
      referenceDisplayMode: displayMode,
      referenceCode: referenceCodeForLink(link),
      referenceCustomLabel: undefined,
    };
    token.dataset.loomDisplayMode = displayMode;
    if (nextLink.referenceCode) token.dataset.loomCode = nextLink.referenceCode;
    delete token.dataset.loomCustomLabel;
    token.title = nextLink.title;
    token.textContent = composerReferenceTokenText(nextLink, referenceDisplayMode);
    window.requestAnimationFrame(() => commitDraftChange("external-reference"));
  }

  function switchInlineReferenceDisplayMode(
    link: LoomLink,
    displayMode: ReferenceDisplayMode
  ) {
    const editor = editorRef.current;
    if (!editor) return;
    const token = Array.from(
      editor.querySelectorAll<HTMLElement>(".inline-loom-token")
    ).find((item) => {
      const itemLink = linkFromInlineToken(item);
      return Boolean(itemLink && referencesMatchComposerInstance(itemLink, link));
    });
    if (!token) return;
    updateInlineTokenDisplayMode(token, displayMode);
    setTokenContextMenu(null);
  }

  function visibleReferenceLabel(link: LoomLink) {
    return referenceLabelForMode(
      link,
      referenceDisplayModeForLink(link, referenceDisplayMode)
    );
  }

  function openInlineReferenceRename(link: LoomLink) {
    const editor = editorRef.current;
    if (!editor) return;
    const token = Array.from(
      editor.querySelectorAll<HTMLElement>(".inline-loom-token")
    ).find((item) => {
      const itemLink = linkFromInlineToken(item);
      return Boolean(itemLink && referencesMatchComposerInstance(itemLink, link));
    });
    if (!token) return;
    const rect = token.getBoundingClientRect();
    const popoverWidth = 260;
    setTokenRenamePopover({
      link,
      x: Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8)),
      y: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 170)),
      value: visibleReferenceLabel(link),
      error: null,
    });
    setTokenContextMenu(null);
    scheduleAddressHintClose();
  }

  function applyInlineReferenceRename() {
    if (!tokenRenamePopover) return;
    const customLabel = tokenRenamePopover.value.trim();
    if (!customLabel) {
      setTokenRenamePopover((current) =>
        current ? { ...current, error: "Enter a label." } : current
      );
      return;
    }

    const editor = editorRef.current;
    if (!editor) return;
    const token = Array.from(
      editor.querySelectorAll<HTMLElement>(".inline-loom-token")
    ).find((item) => {
      const itemLink = linkFromInlineToken(item);
      return Boolean(
        itemLink && referencesMatchComposerInstance(itemLink, tokenRenamePopover.link)
      );
    });
    if (!token) {
      setTokenRenamePopover(null);
      return;
    }

    const nextLink = {
      ...tokenRenamePopover.link,
      referenceCustomLabel: customLabel,
      referenceCode: referenceCodeForLink(tokenRenamePopover.link),
    };
    token.dataset.loomCustomLabel = customLabel;
    if (nextLink.referenceCode) token.dataset.loomCode = nextLink.referenceCode;
    token.title = nextLink.title;
    token.textContent = composerReferenceTokenText(nextLink, referenceDisplayMode);
    setTokenRenamePopover(null);
    window.requestAnimationFrame(() => commitDraftChange("external-reference"));
  }

  function removeInlineToken(link: LoomLink) {
    removeLinkedReference(link);
    setTokenContextMenu(null);
    setTokenRenamePopover(null);
    scheduleAddressHintClose();
  }

  function referencesMatchComposerInstance(a: LoomLink, b: LoomLink) {
    if (!referencesShareIdentity(a, b)) return false;
    if (
      a.referenceOccurrenceIndex !== undefined ||
      b.referenceOccurrenceIndex !== undefined
    ) {
      return a.referenceOccurrenceIndex === b.referenceOccurrenceIndex;
    }
    return true;
  }

  function removeSingleInlineToken(token: HTMLElement, intent: ComposerEditIntent) {
    const editor = editorRef.current;
    if (!editor || !editor.contains(token)) return false;
    const marker = document.createTextNode("");
    token.replaceWith(marker);
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStartAfter(marker);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    marker.remove();
    syncInsertedPaths(extractDraftFromEditor());
    resizeEditorToContent();
    commitDraftChange(intent);
    closeAddressHint();
    return true;
  }

  function selectedInlineTokens(range: Range) {
    const editor = editorRef.current;
    if (!editor) return [];
    return Array.from(editor.querySelectorAll<HTMLElement>(".inline-loom-token")).filter(
      (token) => range.intersectsNode(token)
    );
  }

  function adjacentInlineTokenFromCaret(range: Range, direction: "previous" | "next") {
    const editor = editorRef.current;
    if (!editor || !range.collapsed) return null;
    const container = range.startContainer;
    const offset = range.startOffset;

    function tokenFromNode(node: Node | null) {
      if (!node) return null;
      if (node instanceof HTMLElement && node.classList.contains("inline-loom-token")) {
        return node;
      }
      if (node instanceof HTMLElement) {
        return node.closest<HTMLElement>(".inline-loom-token");
      }
      return node.parentElement?.closest<HTMLElement>(".inline-loom-token") ?? null;
    }

    if (container.nodeType === Node.ELEMENT_NODE) {
      const element = container as Element;
      const child = element.childNodes[
        direction === "previous" ? offset - 1 : offset
      ];
      const directToken = tokenFromNode(child);
      if (directToken && editor.contains(directToken)) return directToken;
    }

    if (container.nodeType === Node.TEXT_NODE) {
      const text = container.textContent ?? "";
      if (direction === "previous" && text.slice(0, offset).trim().length > 0) return null;
      if (direction === "next" && text.slice(offset).trim().length > 0) return null;
    }

    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (
            node instanceof HTMLElement &&
            node.classList.contains("inline-loom-token")
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        },
      }
    );
    const nodes: Node[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const tokenIndex = nodes.findIndex((node) => {
      if (node === container) return true;
      return node.contains?.(container) ?? false;
    });
    const scanStart =
      tokenIndex >= 0
        ? tokenIndex + (direction === "previous" ? -1 : 1)
        : direction === "previous"
          ? nodes.length - 1
          : 0;
    for (
      let index = scanStart;
      direction === "previous" ? index >= 0 : index < nodes.length;
      index += direction === "previous" ? -1 : 1
    ) {
      const node = nodes[index];
      const token = tokenFromNode(node);
      if (token && editor.contains(token)) return token;
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return null;
    }
    return null;
  }

  function handleInlineTokenDeletionKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Backspace" && event.key !== "Delete") return false;
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (
      !editor.contains(range.commonAncestorContainer) &&
      !range.intersectsNode(editor)
    ) {
      return false;
    }

    if (!range.collapsed) {
      const tokens = selectedInlineTokens(range);
      if (tokens.length === 0) return false;
      event.preventDefault();
      if (editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        tokens.forEach((token) => {
          if (editor.contains(token)) token.remove();
        });
      } else {
        editor.innerHTML = "";
      }
      const nextRange = document.createRange();
      nextRange.selectNodeContents(editor);
      nextRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      syncInsertedPaths(extractDraftFromEditor());
      resizeEditorToContent();
      commitDraftChange("reference-remove-dropdown");
      return true;
    }

    const token = adjacentInlineTokenFromCaret(
      range,
      event.key === "Backspace" ? "previous" : "next"
    );
    if (!token) return false;
    event.preventDefault();
    return removeSingleInlineToken(token, "reference-remove-dropdown");
  }

  function handleTokenContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    const token = getTokenFromEventTarget(event.target);
    if (!token || !token.classList.contains("inline-loom-token")) return;
    const link = linkFromInlineToken(token);
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    closeAddressHint();
    setTokenContextMenu({
      link,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 210)),
    });
  }

  function handleEditorClick(event: React.MouseEvent<HTMLDivElement>) {
    const token = getTokenFromEventTarget(event.target);
    if (token?.classList.contains("inline-loom-token") && (event.metaKey || event.ctrlKey)) {
      const link = linkFromInlineToken(token);
      if (link) {
        event.preventDefault();
        event.stopPropagation();
        openReferenceFromComposerToken(link);
      }
      return;
    }
    storeEditorRange();
    updateMention();
  }

  function handleReferenceClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    const token = getTokenFromEventTarget(event.target);
    if (!token?.classList.contains("inline-loom-token")) return;
    if (!event.metaKey && !event.ctrlKey) return;
    const link = linkFromInlineToken(token);
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    openReferenceFromComposerToken(link);
  }

  function handleReferencePointerDownCapture(event: React.PointerEvent<HTMLDivElement>) {
    const token = getTokenFromEventTarget(event.target);
    if (!token?.classList.contains("inline-loom-token")) return;
    if (!event.metaKey && !event.ctrlKey) return;
    const link = linkFromInlineToken(token);
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    openReferenceFromComposerToken(link);
  }

  function handleReferenceMouseMoveCapture(event: React.MouseEvent<HTMLDivElement>) {
    const token = getTokenFromEventTarget(event.target);
    if (!token) return;
    scheduleAddressHintForToken(token);
  }

  function handleReferencePointerOver(event: React.PointerEvent<HTMLDivElement>) {
    const token = getTokenFromEventTarget(event.target);
    if (!token) return;
    scheduleAddressHintForToken(token);
  }

  function handleReferencePointerOut(event: React.PointerEvent<HTMLDivElement>) {
    const token = getTokenFromEventTarget(event.target);
    if (!token) return;
    if (token.contains(event.relatedTarget as Node | null)) return;
    if (
      event.relatedTarget instanceof HTMLElement &&
      event.relatedTarget.closest(".address-hint-popover")
    ) {
      return;
    }
    closeAddressHint();
  }

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    function handleNativeReferenceOver(event: MouseEvent) {
      const token = getTokenFromEventTarget(event.target);
      if (!token) return;
      scheduleAddressHintForToken(token);
    }

    function handleNativeReferenceOut(event: MouseEvent) {
      const token = getTokenFromEventTarget(event.target);
      if (!token) return;
      if (token.contains(event.relatedTarget as Node | null)) return;
      if (
        event.relatedTarget instanceof HTMLElement &&
        event.relatedTarget.closest(".address-hint-popover")
      ) {
        return;
      }
      scheduleAddressHintClose();
    }

    function handleNativeReferenceDown(event: MouseEvent) {
      const token = getTokenFromEventTarget(event.target);
      if (!token?.classList.contains("inline-loom-token")) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const link = linkFromInlineToken(token);
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      openReferenceFromComposerToken(link);
    }

    surface.addEventListener("mouseover", handleNativeReferenceOver, true);
    surface.addEventListener("mousemove", handleNativeReferenceOver, true);
    surface.addEventListener("mouseout", handleNativeReferenceOut, true);
    surface.addEventListener("mousedown", handleNativeReferenceDown, true);
    return () => {
      surface.removeEventListener("mouseover", handleNativeReferenceOver, true);
      surface.removeEventListener("mousemove", handleNativeReferenceOver, true);
      surface.removeEventListener("mouseout", handleNativeReferenceOut, true);
      surface.removeEventListener("mousedown", handleNativeReferenceDown, true);
    };
  });

  function makeToken(link: LoomLink) {
    const displayLink = normalizeResponseLinkSource(
      withReferenceDisplayDefaults(link, referenceDisplayMode)
    );
    const code = referenceCodeForLink(displayLink);
    const displayMode = referenceDisplayModeForLink(displayLink, referenceDisplayMode);
    const token = document.createElement("span");
    token.className = "inline-loom-token";
    token.contentEditable = "false";
    token.draggable = true;
    token.setAttribute("data-testid", "inline-loom-token");
    token.dataset.loomId = displayLink.id;
    token.dataset.loomPath = displayLink.path;
    token.dataset.loomTitle = displayLink.title;
    token.dataset.loomType = displayLink.type;
    token.dataset.loomDisplayMode = displayMode;
    if (code) token.dataset.loomCode = code;
    if (displayLink.badge) token.dataset.loomBadge = displayLink.badge;
    if (displayLink.referenceOccurrenceIndex) {
      token.dataset.loomOccurrenceIndex = String(displayLink.referenceOccurrenceIndex);
    }
    if (displayLink.selectedAt) token.dataset.loomSelectedAt = String(displayLink.selectedAt);
    if (displayLink.targetObjectId) token.dataset.loomTargetObjectId = displayLink.targetObjectId;
    if (displayLink.targetKind) token.dataset.loomTargetKind = displayLink.targetKind;
    if (displayLink.canonicalUri) token.dataset.loomCanonicalUri = displayLink.canonicalUri;
    if (displayLink.referenceCustomLabel) {
      token.dataset.loomCustomLabel = displayLink.referenceCustomLabel;
    }
    if (displayLink.referenceMentionId) token.dataset.loomReferenceMentionId = displayLink.referenceMentionId;
    if (displayLink.resolutionStatus) token.dataset.loomResolutionStatus = displayLink.resolutionStatus;
    if (displayLink.sourceLoomId) token.dataset.loomSourceLoomId = displayLink.sourceLoomId;
    if (displayLink.sourceResponseId) token.dataset.loomSourceResponseId = displayLink.sourceResponseId;
    if (displayLink.selectedText) token.dataset.loomSelectedText = displayLink.selectedText;
    if (displayLink.sourceResponseCode) token.dataset.loomSourceResponseCode = displayLink.sourceResponseCode;
    if (displayLink.sourceResponseTitle) token.dataset.loomSourceResponseTitle = displayLink.sourceResponseTitle;
    if (displayLink.sourceCanonicalUri) token.dataset.loomSourceCanonicalUri = displayLink.sourceCanonicalUri;
    if (displayLink.fragmentHash) token.dataset.loomFragmentHash = displayLink.fragmentHash;
    if (displayLink.createdAt) token.dataset.loomCreatedAt = String(displayLink.createdAt);
    token.title = displayLink.title;
    token.textContent = composerReferenceTokenText(displayLink, referenceDisplayMode);
    token.addEventListener("mouseenter", () => scheduleAddressHintForToken(token));
    token.addEventListener("mouseover", () => scheduleAddressHintForToken(token));
    token.addEventListener("mousemove", () => scheduleAddressHintForToken(token));
    token.addEventListener("mouseleave", (event) => {
      if (
        event.relatedTarget instanceof HTMLElement &&
        event.relatedTarget.closest(".address-hint-popover")
      ) {
        return;
      }
      scheduleAddressHintClose();
    });
    token.addEventListener("click", (event) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const tokenLink = linkFromInlineToken(token);
      if (!tokenLink) return;
      event.preventDefault();
      event.stopPropagation();
      openReferenceFromComposerToken(tokenLink);
    });
    return token;
  }

  function syncExistingTokenMetadata(token: HTMLElement, link: LoomLink) {
    const displayLink = normalizeResponseLinkSource(
      withReferenceDisplayDefaults(link, referenceDisplayMode)
    );
    token.dataset.loomId = displayLink.id;
    token.dataset.loomPath = displayLink.path;
    token.dataset.loomTitle = displayLink.title;
    token.dataset.loomType = displayLink.type;
    token.dataset.loomDisplayMode = referenceDisplayModeForLink(
      displayLink,
      referenceDisplayMode
    );
    const code = referenceCodeForLink(displayLink);
    if (code) token.dataset.loomCode = code;
    else delete token.dataset.loomCode;
    if (displayLink.referenceOccurrenceIndex) {
      token.dataset.loomOccurrenceIndex = String(displayLink.referenceOccurrenceIndex);
    } else {
      delete token.dataset.loomOccurrenceIndex;
    }
    if (displayLink.targetObjectId) token.dataset.loomTargetObjectId = displayLink.targetObjectId;
    else delete token.dataset.loomTargetObjectId;
    if (displayLink.targetKind) token.dataset.loomTargetKind = displayLink.targetKind;
    else delete token.dataset.loomTargetKind;
    if (displayLink.canonicalUri) token.dataset.loomCanonicalUri = displayLink.canonicalUri;
    else delete token.dataset.loomCanonicalUri;
    if (displayLink.sourceResponseId) {
      token.dataset.loomSourceResponseId = displayLink.sourceResponseId;
    } else {
      delete token.dataset.loomSourceResponseId;
    }
    if (displayLink.sourceCanonicalUri) {
      token.dataset.loomSourceCanonicalUri = displayLink.sourceCanonicalUri;
    } else {
      delete token.dataset.loomSourceCanonicalUri;
    }
    token.title = displayLink.title;
    token.textContent = composerReferenceTokenText(displayLink, referenceDisplayMode);
  }

  function normalizeEditorReferenceTokens() {
    const editor = editorRef.current;
    if (!editor) return false;
    const seenCounts = new globalThis.Map<string, number>();
    let changed = false;
    editor.querySelectorAll<HTMLElement>(".inline-loom-token").forEach((token) => {
      const tokenLink = linkFromInlineToken(token);
      if (!tokenLink) return;
      const key = referenceIdentityKey(tokenLink);
      const occurrence = (seenCounts.get(key) ?? 0) + 1;
      seenCounts.set(key, occurrence);
      const nextLink = withReferenceOccurrenceIndex(tokenLink, occurrence);
      const before = token.outerHTML;
      syncExistingTokenMetadata(token, nextLink);
      if (token.outerHTML !== before) changed = true;
    });
    return changed;
  }

  function linkFromInlineToken(token: HTMLElement): LoomLink | null {
    return linkFromInlineTokenElement(token);
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
        link.badge === other.badge &&
        link.selectedAt === other.selectedAt &&
        link.targetObjectId === other.targetObjectId &&
        link.canonicalUri === other.canonicalUri &&
            link.referenceCode === other.referenceCode &&
            link.referenceDisplayMode === other.referenceDisplayMode &&
            link.referenceCustomLabel === other.referenceCustomLabel &&
            link.referenceOccurrenceIndex === other.referenceOccurrenceIndex
          );
    });
    if (!sameLinks) return false;
    return aAttachments.every((attachment, index) => {
      const other = bAttachments[index];
      return (
        other &&
        attachment.id === other.id &&
        attachment.name === other.name &&
        attachment.size === other.size &&
        attachment.attachedAt === other.attachedAt
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

  function getRangeTextOffsets(range: Range) {
    const editor = editorRef.current;
    if (!editor) return { start: 0, end: 0 };
    const startRange = range.cloneRange();
    startRange.selectNodeContents(editor);
    startRange.setEnd(range.startContainer, range.startOffset);
    const endRange = range.cloneRange();
    endRange.selectNodeContents(editor);
    endRange.setEnd(range.endContainer, range.endOffset);
    return {
      start: startRange.toString().length,
      end: endRange.toString().length,
    };
  }

  function getCurrentEditorRange() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return null;
    return range.cloneRange();
  }

  function storeEditorRange() {
    const range = getCurrentEditorRange();
    if (range) lastEditorRangeRef.current = range;
  }

  function getPreferredEditorInsertionRange() {
    const currentRange = getCurrentEditorRange();
    if (currentRange) return currentRange;
    const editor = editorRef.current;
    const storedRange = lastEditorRangeRef.current;
    if (!editor || !storedRange) return null;
    try {
      if (!editor.contains(storedRange.commonAncestorContainer)) return null;
      return storedRange.cloneRange();
    } catch {
      return null;
    }
  }

  function setEditorSelectionByTextOffsets(selectionStart: number, selectionEnd = selectionStart) {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const textLength = editor.textContent?.length ?? 0;
    const start = Math.max(0, Math.min(selectionStart, textLength));
    const end = Math.max(0, Math.min(selectionEnd, textLength));
    let offset = 0;
    let startNode: Text | null = null;
    let startNodeOffset = 0;
    let endNode: Text | null = null;
    let endNodeOffset = 0;

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const length = node.textContent?.length ?? 0;
      if (!startNode && start <= offset + length) {
        startNode = node;
        startNodeOffset = start - offset;
      }
      if (!endNode && end <= offset + length) {
        endNode = node;
        endNodeOffset = end - offset;
        break;
      }
      offset += length;
    }

    const range = document.createRange();
    if (!startNode) {
      range.selectNodeContents(editor);
      range.collapse(false);
    } else {
      range.setStart(startNode, startNodeOffset);
      if (endNode) range.setEnd(endNode, endNodeOffset);
      else range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function restoreSpeechSnapshotFocus() {
    const snapshot = speechSnapshotRef.current;
    const editor = editorRef.current;
    if (!snapshot || !editor) return;
    applyDraftSnapshot(snapshot.draft);
    window.requestAnimationFrame(() => {
      editor.focus();
      setEditorSelectionByTextOffsets(snapshot.selectionStart, snapshot.selectionEnd);
    });
  }

  function restoreSpeechRangeOrOffset() {
    const snapshot = speechSnapshotRef.current;
    const editor = editorRef.current;
    if (!snapshot || !editor) return null;
    editor.focus();
    if (snapshot.range && editor.contains(snapshot.range.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(snapshot.range.cloneRange());
      return snapshot.range.cloneRange();
    }
    setEditorSelectionByTextOffsets(snapshot.selectionStart, snapshot.selectionEnd);
    return getCurrentEditorRange();
  }

  async function startSpeechRecording() {
    const range = getCurrentEditorRange();
    const offsets = range ? getRangeTextOffsets(range) : { start: getCaretOffset(), end: getCaretOffset() };
    speechSnapshotRef.current = {
      draft: extractDraftFromEditor(),
      range,
      selectionStart: offsets.start,
      selectionEnd: offsets.end,
    };
    setMention(null);
    setAttachPickerOpen(false);
    setReferencePickerOpen(false);
    setModelPickerOpen(false);
    await speechRecorder.startRecording();
  }

  function cancelSpeechRecording() {
    speechRecorder.cancelRecording();
    restoreSpeechSnapshotFocus();
  }

  async function stopSpeechRecording() {
    const result = await speechRecorder.stopAndTranscribe();
    if (!result) {
      restoreSpeechSnapshotFocus();
      return;
    }
    insertSpeechTranscript(result.transcript);
  }

  async function retrySpeechRecording() {
    restoreSpeechSnapshotFocus();
    await startSpeechRecording();
  }

  async function openMicrophoneSettings() {
    await electronPermissions?.openMicrophoneSettings();
  }

  function insertSpeechTranscript(transcript: string) {
    const editor = editorRef.current;
    const snapshot = speechSnapshotRef.current;
    if (!editor || !snapshot) return;
    const range = restoreSpeechRangeOrOffset();
    const text = editor.textContent ?? "";
    const offsets = range
      ? getRangeTextOffsets(range)
      : { start: snapshot.selectionStart, end: snapshot.selectionEnd };
    const insertion = insertTranscriptAtCursorText({
      text,
      selectionStart: offsets.start,
      selectionEnd: offsets.end,
      transcript,
    });
    if (!insertion.changed) {
      restoreSpeechSnapshotFocus();
      return;
    }
    const activeRange = range ?? getCurrentEditorRange();
    if (!activeRange) {
      editor.appendChild(document.createTextNode(insertion.insertedText));
      setEditorSelectionByTextOffsets(insertion.caretIndex);
    } else {
      activeRange.deleteContents();
      const textNode = document.createTextNode(insertion.insertedText);
      activeRange.insertNode(textNode);
      const selection = window.getSelection();
      const nextRange = document.createRange();
      nextRange.setStartAfter(textNode);
      nextRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(nextRange);
    }
    editor.focus();
    resizeEditorToContent();
    commitDraftChange("text");
    followTranscriptAfterComposerLayout();
    speechSnapshotRef.current = null;
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
    insertedPathsRef.current = new Set(
      nextDraft.links.filter((link) => !isAttachedQuoteReference(link)).map((link) => link.path)
    );
  }

  function applyDraftSnapshot(nextDraft: ComposerDraft) {
    const editor = editorRef.current;
    if (!editor) return;
    applyingHistoryRef.current = true;
    editor.innerHTML = nextDraft.html;
    syncEditorEmptyState(editor);
    syncInsertedPaths(nextDraft);
    onDraftChange(nextDraft);
    window.requestAnimationFrame(() => {
      applyingHistoryRef.current = false;
      resizeEditorToContent();
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

  function syncEditorEmptyState(editor: HTMLDivElement) {
    const hasInlineTokens = Boolean(editor.querySelector(".inline-loom-token"));
    const visibleText = (editor.textContent ?? "")
      .replace(/\u200b/g, "")
      .replace(/\u00a0/g, " ")
      .trim();
    const empty = !hasInlineTokens && visibleText.length === 0;
    if (empty && editor.innerHTML !== "") {
      editor.innerHTML = "";
    }
    editor.dataset.empty = empty ? "true" : "false";
    return empty;
  }

  function extractDraftFromEditor(): ComposerDraft {
    const editor = editorRef.current;
    if (!editor) return draft;
    const attachedLinksByKey = new globalThis.Map<string, LoomLink>();
    draft.links
      .filter(isAttachedQuoteReference)
      .forEach((link) => attachedLinksByKey.set(referenceIdentityKey(link), link));
    const inlineLinks: LoomLink[] = [];
    editor.querySelectorAll<HTMLElement>(".inline-loom-token").forEach((token) => {
      const link = linkFromInlineToken(token);
      if (link) inlineLinks.push(link);
    });
    const editorIsEmpty = syncEditorEmptyState(editor);
    return {
      html: editorIsEmpty ? "" : editor.innerHTML,
      links: [...Array.from(attachedLinksByKey.values()), ...inlineLinks],
      attachments: draft.attachments ?? [],
    };
  }

  function emitDraftChange() {
    syncInsertedPaths(extractDraftFromEditor());
    onDraftChange(extractDraftFromEditor());
  }

  function countEditorInlineReferenceOccurrences(link: LoomLink) {
    const editor = editorRef.current;
    if (!editor) return 0;
    return Array.from(editor.querySelectorAll<HTMLElement>(".inline-loom-token")).filter(
      (token) => {
        const tokenLink = linkFromInlineToken(token);
        return Boolean(tokenLink && referencesShareIdentity(tokenLink, link));
      }
    ).length;
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
      syncEditorEmptyState(editor);
      resizeEditorToContent();
      if (normalizeEditorReferenceTokens()) {
        window.requestAnimationFrame(() => commitDraftChange("reference-insert"));
      }
    }

    let insertedExternalReference = false;
    const expectedReferenceCounts = new globalThis.Map<string, number>();
    draftInlineReferences.forEach((link) => {
      const key = referenceIdentityKey(link);
      const expectedCount = (expectedReferenceCounts.get(key) ?? 0) + 1;
      expectedReferenceCounts.set(key, expectedCount);
      const currentCount = countEditorInlineReferenceOccurrences(link);
      if (currentCount < expectedCount) {
        insertTokenAtEnd(withReferenceOccurrenceIndex(link, expectedCount));
        insertedExternalReference = true;
      } else {
        insertedPathsRef.current.add(link.path);
      }
    });

    let removedExternalReference = false;
    Array.from(insertedPathsRef.current).forEach((path) => {
      if (!draftInlineReferences.some((link) => link.path === path)) {
        editor
          .querySelectorAll(`[data-loom-path="${CSS.escape(path)}"]`)
          .forEach((node) => node.remove());
        insertedPathsRef.current.delete(path);
        removedExternalReference = true;
      }
    });

    if (insertedExternalReference || removedExternalReference) {
      normalizeEditorReferenceTokens();
      syncEditorEmptyState(editor);
      const inlineTokens = Array.from(
        editor.querySelectorAll<HTMLElement>(".inline-loom-token")
      );
      revealEditorInsertion(inlineTokens[inlineTokens.length - 1]);
      window.requestAnimationFrame(() =>
        commitDraftChange(
          insertedExternalReference ? "external-reference" : "reference-remove-dropdown"
        )
      );
      followTranscriptAfterComposerLayout();
    }
  }, [draftKey, draft.links, draftInlineReferences, draft.attachments, resizeEditorToContent]);

  function placeCaretAfter(node: Node) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    lastEditorRangeRef.current = range.cloneRange();
  }

  function insertTokenAtRange(
    link: LoomLink,
    range: Range,
    intent: ComposerEditIntent = "reference-insert",
    syncExternalLink = true
  ) {
    const resolvedLink = onResolveReference({
      ...link,
      selectedAt: link.selectedAt ?? Date.now(),
    });
    const occurrenceLink = withReferenceOccurrenceIndex(
      resolvedLink,
      countEditorInlineReferenceOccurrences(resolvedLink) + 1
    );
    const token = makeToken(occurrenceLink);
    range.deleteContents();
    range.insertNode(document.createTextNode(" "));
    range.insertNode(token);
    placeCaretAfter(token);
    insertedPathsRef.current.add(occurrenceLink.path);
    if (syncExternalLink) onDropLink(occurrenceLink);
    revealEditorInsertion(token);
    normalizeEditorReferenceTokens();
    window.requestAnimationFrame(() => commitDraftChange(intent));
    setMention(null);
  }

  function insertTokenAtEnd(link: LoomLink) {
    const editor = editorRef.current;
    if (!editor) return link;
    const resolvedLink = onResolveReference({
      ...link,
      selectedAt: link.selectedAt ?? Date.now(),
    });
    const occurrenceLink = withReferenceOccurrenceIndex(
      resolvedLink,
      link.referenceOccurrenceIndex ??
        countEditorInlineReferenceOccurrences(resolvedLink) + 1
    );
    const token = makeToken(occurrenceLink);
    if (editor.textContent?.trim()) editor.append(document.createTextNode(" "));
    editor.append(token, document.createTextNode(" "));
    insertedPathsRef.current.add(occurrenceLink.path);
    revealEditorInsertion(token);
    placeCaretAfter(token);
    normalizeEditorReferenceTokens();
    return occurrenceLink;
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
    if (!match) {
      setMention(null);
      return;
    }
    const position = measureMentionPosition(match.range);
    setMention((current) => ({
      query: match.query,
      range: match.range.cloneRange(),
      selectedIndex: current?.query === match.query ? current.selectedIndex : 0,
      ...position,
    }));
  }

  function selectMentionOption(option: ComposerReferenceOption) {
    const range = mention?.range;
    if (!range) return;
    insertTokenAtRange(option, range);
  }

  function isReferenceSelected(link: LoomLink) {
    return selectedReferenceKeysForLink(link).some((key) => selectedReferenceKeys.has(key));
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
    draftRef.current = nextDraft;
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

  function readFileAsBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("File could not be read."));
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadAttachment(file: File, pendingAttachment: ComposerAttachment) {
    try {
      const contentBase64 = await readFileAsBase64(file);
      const result = await engineClient.createAttachment({
        loomId: draftKey,
        fileName: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        contentBase64,
      });
      const stored = result.attachment;
      updateDraftAttachments(
        (draftRef.current.attachments ?? []).map((attachment) =>
          attachment.id === pendingAttachment.id
            ? {
                ...attachment,
                id: stored.attachmentId,
                attachmentId: stored.attachmentId,
                loomId: stored.loomId,
                name: stored.fileName,
                size: stored.sizeBytes,
                type: stored.mimeType ?? file.type ?? "File",
                extension: stored.extension,
                kind: stored.kind,
                parseStatus: stored.parseStatus,
                parser: stored.parser,
                error: stored.error,
                thumbnailDataUrl: stored.thumbnailDataUrl,
                parsedCharCount: stored.parsedCharCount,
                metadataJson: stored.metadataJson,
              }
            : attachment
        )
      );
    } catch (error) {
      updateDraftAttachments(
        (draftRef.current.attachments ?? []).map((attachment) =>
          attachment.id === pendingAttachment.id
            ? {
                ...attachment,
                parseStatus: "failed",
                error: error instanceof Error ? error.message : "Attachment failed.",
              }
            : attachment
        )
      );
    }
  }

  function addAttachments(files: FileList | null) {
    if (!files || files.length === 0) return;
    const existing = draftRef.current.attachments ?? [];
    const availableSlots = MAX_COMPOSER_ATTACHMENTS - existing.length;
    if (availableSlots <= 0) {
      setAttachFeedback(`You can attach up to ${MAX_COMPOSER_ATTACHMENTS} files.`);
      return;
    }
    const seen = new Set(
      existing.map((attachment) => `${attachment.name}:${attachment.size}:${attachment.lastModified}`)
    );
    const next = [...existing];
    const pendingUploads: Array<{ file: File; attachment: ComposerAttachment }> = [];
    const selectedFiles = Array.from(files);
    const acceptedFiles = selectedFiles.slice(0, availableSlots);
    if (selectedFiles.length > acceptedFiles.length) {
      setAttachFeedback(`You can attach up to ${MAX_COMPOSER_ATTACHMENTS} files.`);
    }
    acceptedFiles.forEach((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) return;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachFeedback(`File is too large. Files can be up to ${MAX_ATTACHMENT_SIZE_LABEL}.`);
        return;
      }
      seen.add(key);
      const attachedAt = Date.now() + next.length;
      const pendingAttachment: ComposerAttachment = {
        id: key,
        name: file.name,
        size: file.size,
        type: file.type || "File",
        parseStatus: "parsing",
        lastModified: file.lastModified,
        attachedAt,
      };
      next.push(pendingAttachment);
      pendingUploads.push({ file, attachment: pendingAttachment });
    });
    updateDraftAttachments(next);
    pendingUploads.forEach(({ file, attachment }) => {
      void uploadAttachment(file, attachment);
    });
  }

  function removeAttachment(attachmentId: string) {
    const attachment = (draftRef.current.attachments ?? []).find((item) => item.id === attachmentId);
    if (attachment?.attachmentId) {
      void engineClient.deleteAttachment({ attachmentId: attachment.attachmentId });
    }
    const attachmentLink = attachment ? attachmentToLoomLink(attachment) : null;
    updateDraftAttachments(
      (draftRef.current.attachments ?? []).filter((attachment) => attachment.id !== attachmentId)
    );
    if (attachmentLink) {
      onRemoveLink(attachmentLink);
    }
  }

  async function submitComposer() {
    if (runtimeState.running) {
      stoppedRunningSubmitRef.current = true;
      onStop();
      attachedReferences.forEach((link) => onRemoveAttachedReference(link));
      const emptyDraft = { html: "", links: [], attachments: [] };
      applyDraftSnapshot(emptyDraft);
      historiesRef.current[draftKey] = { entries: [emptyDraft], index: 0 };
      return;
    }
    if (runtimeWarning) return;
    stoppedRunningSubmitRef.current = false;
    const nextDraft = extractDraftFromEditor();
    const attachedLinksToSend = attachedReferences.filter(
      (link) => !nextDraft.links.some((item) => referencesShareIdentity(item, link))
    );
    const draftForSend =
      attachedLinksToSend.length > 0
        ? { ...nextDraft, links: [...attachedLinksToSend, ...nextDraft.links] }
        : nextDraft;
    const promptText =
      editorRef.current?.textContent?.replace(/\s+/g, " ").trim() ??
      draftForSend.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const meaningful =
      promptText.length > 0 ||
      draftForSend.links.length > 0;
    if (!meaningful) return;
    onUserTyping();
    attachedReferences.forEach((link) => onRemoveAttachedReference(link));
    applyDraftSnapshot({ html: "", links: [], attachments: [] });
    const sent = await onSend(draftForSend, { effort: "Medium", mode: modelResponseMode });
    if (!sent && !stoppedRunningSubmitRef.current) applyDraftSnapshot(draftForSend);
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (editor && selection) {
        event.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return;
    }
    if (handleInlineTokenDeletionKey(event)) return;
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
      if (runtimeState.running) return;
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
                Math.max(flattenedMentionOptions.length - 1, 0)
              ),
            }
          : current
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMention((current) =>
        current
          ? { ...current, selectedIndex: Math.max(current.selectedIndex - 1, 0) }
          : current
      );
      return;
    }
    if (event.key === "Enter" && flattenedMentionOptions[mention.selectedIndex]) {
      event.preventDefault();
      selectMentionOption(flattenedMentionOptions[mention.selectedIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMention(null);
      return;
    }
  }

  function handleEditorDragStart(event: React.DragEvent<HTMLDivElement>) {
    const token = (event.target as HTMLElement).closest<HTMLElement>(".inline-loom-token");
    if (!token) return;
    const link = linkFromInlineToken(token);
    if (!link) return;
    const dragId =
      token.dataset.loomDragId ||
      (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    token.dataset.loomDragId = dragId;
    setLoomDragPayload(event, link);
    event.dataTransfer.setData(LOOM_INLINE_TOKEN_DRAG_MIME, dragId);
    event.dataTransfer.effectAllowed = "copyMove";
  }

  function handleEditorDragEnd(event: React.DragEvent<HTMLDivElement>) {
    const token = (event.target as HTMLElement).closest<HTMLElement>(".inline-loom-token");
    if (!token) return;
    delete token.dataset.loomDragId;
  }

  function insertPlainTextAtSelection(text: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      editor.appendChild(document.createTextNode(text));
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      editor.appendChild(document.createTextNode(text));
      return;
    }
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  type ClipboardReferenceSegment =
    | { kind: "text"; text: string }
    | { kind: "reference"; link: LoomLink };

  function appendClipboardTextSegment(
    segments: ClipboardReferenceSegment[],
    text: string
  ) {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "text") {
      last.text += text;
    } else {
      segments.push({ kind: "text", text });
    }
  }

  function referenceSegmentsFromMarkdown(text: string) {
    const segments: ClipboardReferenceSegment[] = [];
    const pattern = /\[([^\]]+)\]\((loom:\/\/[^)\s]+)\)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      appendClipboardTextSegment(segments, text.slice(cursor, match.index));
      const link = loomLinkFromMarkdownReference(match[1] ?? "", match[2] ?? "");
      if (link) segments.push({ kind: "reference", link });
      else appendClipboardTextSegment(segments, match[0]);
      cursor = match.index + match[0].length;
    }
    appendClipboardTextSegment(segments, text.slice(cursor));
    return segments;
  }

  function referenceSegmentsFromHtml(html: string) {
    if (!html) return [];
    const root = document.createElement("div");
    root.innerHTML = html;
    const segments: ClipboardReferenceSegment[] = [];
    const blockTags = new Set(["DIV", "P", "LI"]);

    function appendBreak() {
      const last = segments[segments.length - 1];
      if (last?.kind === "text" && !last.text.endsWith("\n")) last.text += "\n";
    }

    function visit(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        appendClipboardTextSegment(segments, node.textContent ?? "");
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === "BR") {
        appendClipboardTextSegment(segments, "\n");
        return;
      }
      const referenceToken =
        node.matches(".inline-loom-token, .sent-prompt-reference-token") ? node : null;
      if (referenceToken) {
        const tokenLink = linkFromInlineToken(referenceToken);
        if (tokenLink) {
          segments.push({ kind: "reference", link: tokenLink });
          return;
        }
      }
      if (node instanceof HTMLAnchorElement && node.href.startsWith("loom://")) {
        const label =
          node.dataset.loomReferenceTitle?.trim() ||
          node.textContent?.replace(/\s+/g, " ").trim() ||
          node.href;
        const link = loomLinkFromMarkdownReference(label, node.href);
        if (link) {
          segments.push({ kind: "reference", link });
          return;
        }
      }
      const isBlock = blockTags.has(node.tagName);
      if (isBlock && segments.length > 0) appendBreak();
      node.childNodes.forEach(visit);
      if (isBlock) appendBreak();
    }

    root.childNodes.forEach(visit);
    return segments.some((segment) => segment.kind === "reference") ? segments : [];
  }

  function insertClipboardSegments(segments: ClipboardReferenceSegment[]) {
    segments.forEach((segment) => {
      if (segment.kind === "text") {
        insertPlainTextAtSelection(segment.text);
        return;
      }
      const range = getCurrentEditorRange() ?? getPreferredEditorInsertionRange();
      if (range) {
        insertTokenAtRange(segment.link, range, "paste", false);
      } else {
        const resolvedLink = insertTokenAtEnd(segment.link);
        void resolvedLink;
      }
    });
  }

  function handleEditorPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const segmentsFromHtml = referenceSegmentsFromHtml(html);
    const segments =
      segmentsFromHtml.length > 0 ? segmentsFromHtml : referenceSegmentsFromMarkdown(text);
    const hasReferenceSegment = segments.some((segment) => segment.kind === "reference");
    if (!text && !hasReferenceSegment) return;
    event.preventDefault();
    pendingInputRef.current = {
      inputType: "insertFromPaste",
      replacesSelection: true,
    };
    if (hasReferenceSegment) insertClipboardSegments(segments);
    else insertPlainTextAtSelection(text);
    updateMention();
    resizeEditorToContent();
    commitDraftChange("paste");
    followTranscriptAfterComposerLayout();
    pendingInputRef.current = null;
  }

  function removeLinkedReference(link: LoomLink) {
    if (attachedReferences.some((item) => referencesShareIdentity(item, link))) {
      onRemoveAttachedReference(link);
      return;
    }
    if (isAttachedQuoteReference(link)) {
      onRemoveLink(link);
      return;
    }
    editorRef.current?.querySelectorAll<HTMLElement>(".inline-loom-token").forEach((token) => {
      const tokenLink = linkFromInlineToken(token);
      if (!tokenLink || !referencesMatchComposerInstance(tokenLink, link)) return;
      token.remove();
      insertedPathsRef.current.delete(tokenLink.path);
    });
    normalizeEditorReferenceTokens();
    window.requestAnimationFrame(() => commitDraftChange("reference-remove-dropdown"));
  }

  function duplicateLinkedReference(link: LoomLink) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const range = getPreferredEditorInsertionRange();
    if (range) {
      insertTokenAtRange(
        { ...link, referenceOccurrenceIndex: undefined },
        range,
        "reference-insert"
      );
    } else {
      const resolvedLink = insertTokenAtEnd({
        ...link,
        referenceOccurrenceIndex: undefined,
      });
      onDropLink(resolvedLink);
      window.requestAnimationFrame(() => commitDraftChange("reference-insert"));
    }
    setReferenceOpenError(null);
  }

  return (
    <section
      className={[
        variant === "centered" ? "prompt-composer centered" : "prompt-composer",
        active ? "active" : "passive",
        speechActive ? "speech-active" : "",
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
            event.dataTransfer.dropEffect =
              event.dataTransfer.types.includes(LOOM_INLINE_TOKEN_DRAG_MIME) && !event.altKey
                ? "move"
                : "copy";
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
          const movedTokenDragId = event.dataTransfer.getData(LOOM_INLINE_TOKEN_DRAG_MIME);
          const editor = editorRef.current;
          const movedToken =
            movedTokenDragId && editor
              ? editor.querySelector<HTMLElement>(
                  `[data-loom-drag-id="${CSS.escape(movedTokenDragId)}"]`
                )
              : null;
          if (movedToken && editor?.contains(movedToken)) {
            const range = getDropRange(event);
            if (!range || movedToken.contains(range.startContainer)) {
              delete movedToken.dataset.loomDragId;
              return;
            }
            if (event.altKey) {
              delete movedToken.dataset.loomDragId;
              insertTokenAtRange(
                { ...link, referenceOccurrenceIndex: undefined },
                range,
                "reference-insert"
              );
              return;
            }
            const insertionRange = range.cloneRange();
            insertionRange.collapse(true);
            insertionRange.insertNode(document.createTextNode(" "));
            insertionRange.insertNode(movedToken);
            insertionRange.setStartAfter(movedToken);
            insertionRange.collapse(true);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(insertionRange);
            delete movedToken.dataset.loomDragId;
            syncInsertedPaths(extractDraftFromEditor());
            normalizeEditorReferenceTokens();
            revealEditorInsertion(movedToken);
            window.requestAnimationFrame(() => commitDraftChange("reference-move"));
            return;
          }
          const range = getDropRange(event);
          if (range) {
            insertTokenAtRange(link, range);
          } else {
            const resolvedLink = insertTokenAtEnd(link);
            onDropLink(resolvedLink);
            window.requestAnimationFrame(() => commitDraftChange("reference-insert"));
          }
        }}
        onClickCapture={handleReferenceClickCapture}
        onPointerDownCapture={handleReferencePointerDownCapture}
        onMouseOverCapture={handleReferenceMouseMoveCapture}
        onMouseMoveCapture={handleReferenceMouseMoveCapture}
        onPointerOver={handleReferencePointerOver}
        onPointerOut={handleReferencePointerOut}
      >
        {visibleAttachedReferences.length > 0 && (
          <div className="attached-reference-row" aria-label="Attached references">
            {visibleAttachedReferences.map((link) => (
              <span
                className={
                  isFragmentReference(link)
                    ? "selection-reference-chip selection-reference-chip--quote"
                    : "selection-reference-chip"
                }
                key={referenceIdentityKey(link)}
                data-loom-path={link.path}
              >
                {isFragmentReference(link) ? <CornerDownRightIcon /> : <FileText size={13} />}
                <span>{isFragmentReference(link) ? fragmentQuoteText(link) : link.title}</span>
                <button
                  type="button"
                  onClick={() => removeLinkedReference(link)}
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
                role="button"
                tabIndex={0}
                className={`file-attachment-chip attachment-status-${attachment.parseStatus ?? "pending"}`}
                key={attachment.id}
                data-testid={`attachment-token-${attachment.name}`}
                title={`${attachment.name} (${formatAttachmentSize(attachment.size)}) · ${attachmentStatusLabel(attachment)}`}
                draggable
                onDragStart={(event) => setLoomDragPayload(event, attachmentToLoomLink(attachment))}
                onClick={() => {
                  if (!attachment.attachmentId) {
                    setAttachFeedback("File is still uploading");
                    return;
                  }
                  if (attachment.parseStatus !== "ready") {
                    setAttachFeedback(
                      attachment.error ?? "This file is not ready for prompt context."
                    );
                    return;
                  }
                  const link = attachmentToLoomLink(attachment);
                  if (isReferenceSelected(link)) return;
                  const resolvedLink = insertTokenAtEnd(link);
                  onDropLink(resolvedLink);
                  window.requestAnimationFrame(() => commitDraftChange("reference-insert"));
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.currentTarget.click();
                }}
              >
                {attachmentParseActive(attachment) ? (
                  <LoaderCircle className="attachment-spinner" size={13} />
                ) : (
                  <Paperclip size={13} />
                )}
                <span>{formatAttachmentDisplayName(attachment.name)}</span>
                <small>{attachmentStatusLabel(attachment)} · {formatAttachmentSize(attachment.size)}</small>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeAttachment(attachment.id);
                  }}
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {speechActive && (
          <SpeechListeningBar
            status={speechRecorder.status}
            error={speechRecorder.error}
            waveform={speechRecorder.waveform}
            onCancel={cancelSpeechRecording}
            onStop={stopSpeechRecording}
            onRetry={retrySpeechRecording}
            onOpenMicrophoneSettings={
              electronPermissions ? openMicrophoneSettings : undefined
            }
          />
        )}
        <div
          ref={editorRef}
          className="prompt-editor"
          style={
            editorHeight
              ? ({ "--prompt-editor-height": `${editorHeight}px` } as CSSProperties)
              : undefined
          }
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
            storeEditorRange();
            resizeEditorToContent();
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
            followTranscriptAfterComposerLayout();
            pendingInputRef.current = null;
          }}
          onKeyUp={() => {
            storeEditorRange();
            updateMention();
          }}
          onMouseUp={storeEditorRange}
          onFocus={() => {
            storeEditorRange();
            updateMention();
          }}
          onClick={handleEditorClick}
          onContextMenu={handleTokenContextMenu}
          onKeyDown={handleEditorKeyDown}
          onPaste={handleEditorPaste}
          onDragStart={handleEditorDragStart}
          onDragEnd={handleEditorDragEnd}
        >
        </div>

        {mention && createPortal(
          <ComposerMentionMenu
            menuRef={mentionMenuRef}
            mention={mention}
            groups={groupedMentionOptions}
            selectedOption={flattenedMentionOptions[mention.selectedIndex]}
            onSelect={selectMentionOption}
          />,
          document.body
        )}

        {addressHint && (
          <AddressHintPopover
            link={addressHint.link}
            style={{
              left: addressHint.x,
              top: addressHint.y,
              maxHeight: addressHint.maxHeight,
              transform:
                addressHint.placement === "top"
                  ? "translateY(-100%)"
                  : "translateY(0)",
            }}
            placement={addressHint.placement}
            onCopy={onCopyReferenceAddress}
            onEnter={clearAddressHintAutoCloseTimer}
            onClose={scheduleAddressHintClose}
          />
        )}

        {tokenContextMenu && (
          <div
            className="reference-token-context-menu"
            style={{ left: tokenContextMenu.x, top: tokenContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => openInlineReferenceRename(tokenContextMenu.link)}
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() =>
                switchInlineReferenceDisplayMode(tokenContextMenu.link, "title")
              }
            >
              Show Title
            </button>
            <button
              type="button"
              onClick={() =>
                switchInlineReferenceDisplayMode(tokenContextMenu.link, "code")
              }
            >
              Show Code
            </button>
            <button
              type="button"
              onClick={() => {
                openReferenceFromComposerToken(tokenContextMenu.link);
                setTokenContextMenu(null);
              }}
            >
              Open Reference
            </button>
            <button
              type="button"
              onClick={() => {
                onCopyReferenceAddress(tokenContextMenu.link);
                setTokenContextMenu(null);
              }}
            >
              Copy Loom Address
            </button>
            <button
              type="button"
              onClick={() => removeInlineToken(tokenContextMenu.link)}
            >
              Remove Reference
            </button>
          </div>
        )}

        {tokenRenamePopover && (
          <div
            className="reference-token-rename-popover"
            style={{ left: tokenRenamePopover.x, top: tokenRenamePopover.y }}
            role="dialog"
            aria-label="Rename Reference"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <strong>Rename Reference</strong>
            <input
              ref={renameInputRef}
              value={tokenRenamePopover.value}
              maxLength={80}
              aria-label="Reference name"
              onChange={(event) => {
                const value = event.target.value.slice(0, 80);
                setTokenRenamePopover((current) =>
                  current ? { ...current, value, error: null } : current
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyInlineReferenceRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setTokenRenamePopover(null);
                }
              }}
            />
            {tokenRenamePopover.error && (
              <em>{tokenRenamePopover.error}</em>
            )}
            <div className="reference-token-rename-actions">
              <button
                type="button"
                onClick={applyInlineReferenceRename}
                disabled={!tokenRenamePopover.value.trim()}
                aria-label="Confirm rename"
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => setTokenRenamePopover(null)}
                aria-label="Cancel rename"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="composer-footer">
          <Tooltip label="Attach" placement="bottom-right">
            <button
              ref={attachButtonRef}
              className={attachPickerOpen ? "composer-icon-action active" : "composer-icon-action"}
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
          </Tooltip>
          {attachPickerOpen && createPortal(
            <AttachContentDropdown
              menuRef={attachMenuRef}
              style={
                attachPopoverStyle
                  ? {
                      left: attachPopoverStyle.left,
                      top: attachPopoverStyle.top,
                      minWidth: attachPopoverStyle.minWidth,
                      height: attachPopoverStyle.height,
                      visibility: "visible",
                    }
                  : {
                      left: 0,
                      top: 0,
                      minWidth: 430,
                      height: 360,
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
                onOpenReference={(item) => {
                  const error = onOpenReference(item);
                  setAttachFeedback(error);
                  if (!error) {
                    setAttachPickerOpen(false);
                    setAttachPopoverStyle(null);
                  }
                }}
                onAddFiles={addAttachments}
                onRemoveAttachment={removeAttachment}
              />,
            document.body
          )}
          <div className="linked-reference-anchor">
            <Tooltip label="References" placement="bottom-right">
              <button
                ref={referenceButtonRef}
                className={referencePickerOpen ? "reference-globe active" : "reference-globe"}
                onClick={() => {
                  setReferencePickerOpen((current) => {
                    const next = !current;
                    if (!next) setReferencePopoverStyle(null);
                    if (!next) setReferenceOpenError(null);
                    if (next) setReferenceSelectedIndex(0);
                    return next;
                  });
                }}
                onKeyDown={(event) => {
                  if (!referencePickerOpen) return;
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  setReferenceSelectedIndex((current) =>
                    event.key === "ArrowDown"
                      ? Math.min(current + 1, Math.max(filteredLinkedReferences.length - 1, 0))
                      : Math.max(current - 1, 0)
                  );
                  referenceMenuRef.current
                    ?.querySelector<HTMLInputElement>("input[aria-label='Search linked references']")
                    ?.focus();
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
            </Tooltip>
            {referencePickerOpen && createPortal(
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
                selectedIndex={referenceSelectedIndex}
                error={referenceOpenError}
                onQueryChange={(query) => {
                  setReferenceSearch(query);
                  setReferenceSelectedIndex(0);
                }}
                onSelectedIndexChange={setReferenceSelectedIndex}
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
                onDuplicate={duplicateLinkedReference}
                onRemove={removeLinkedReference}
                onClose={() => {
                  setReferencePickerOpen(false);
                  setReferencePopoverStyle(null);
                  setReferenceOpenError(null);
                }}
              />,
              document.body
            )}
          </div>
          <span className="composer-reference-hint">
            Type # to insert Loom references inline.
          </span>
          <Tooltip
            label={`Model: ${mainModel.name}`}
            placement="bottom-right"
          >
            <button
              ref={modelButtonRef}
              type="button"
              className="model-picker-button"
              onClick={() => setModelPickerOpen((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={modelPickerOpen}
              aria-label="Select model"
              title={`Main model: ${mainModel.name}. Response mode: ${
                modelResponseModes.find((mode) => mode.id === modelResponseMode)?.label ?? "Auto"
              }`}
            >
              <span>{mainModel.name}</span>
              <ChevronDown size={15} />
            </button>
          </Tooltip>
          {modelPickerOpen && createPortal(
            <div
              ref={modelMenuRef}
              className="model-picker-menu"
              role="menu"
              aria-label="Select model and response mode"
              style={
                modelPopoverStyle
                  ? {
                      left: modelPopoverStyle.left,
                      top: modelPopoverStyle.top,
                      minWidth: modelPopoverStyle.minWidth,
                      visibility: "visible",
                    }
                  : {
                      left: 0,
                      top: 0,
                      minWidth: 220,
                      visibility: "hidden",
                    }
              }
            >
              <div className="model-picker-section-label">Models</div>
              {selectableModels.map((model) => {
                const selected = model.id === selectedModelId;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={selected ? "selected" : ""}
                    onClick={() => {
                      setMainModel(model.id);
                      setModelPickerOpen(false);
                      setModelPopoverStyle(null);
                    }}
                  >
                    {selected ? <Check size={15} /> : <span aria-hidden="true" />}
                    <span>{model.name}</span>
                  </button>
                );
              })}
              <div className="model-picker-section-divider" />
              <div className="model-picker-section-label">Response Mode</div>
              {modelResponseModes.map((mode) => {
                const selected = mode.id === modelResponseMode;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={
                      selected
                        ? "selected model-picker-mode-option"
                        : "model-picker-mode-option"
                    }
                    onClick={() => onModelResponseModeChange(mode.id)}
                  >
                    {selected ? <Check size={15} /> : <span aria-hidden="true" />}
                    <span>
                      <strong>{mode.label}</strong>
                      <small>{mode.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body
          )}
          <Tooltip label="Voice input" placement="bottom-right">
            <button
              type="button"
              className={speechActive ? "composer-icon-action active" : "composer-icon-action"}
              aria-label="Voice input"
              title="Voice input"
              aria-pressed={speechRecorder.status === "recording"}
              disabled={runtimeState.running || speechRecorder.status === "transcribing"}
              onClick={() => {
                if (speechRecorder.status === "recording") void stopSpeechRecording();
                else if (speechRecorder.status === "error") void retrySpeechRecording();
                else void startSpeechRecording();
              }}
            >
              <Mic size={15} />
            </button>
          </Tooltip>
          <button
            className="send-button"
            aria-label={runtimeState.running ? "Stop response" : "Send"}
            onClick={submitComposer}
            disabled={!runtimeState.running && Boolean(runtimeWarning)}
            title={runtimeState.running ? "Stop response" : runtimeWarning ?? "Send"}
          >
            {runtimeState.running ? <Square size={13} fill="currentColor" /> : <ArrowUp size={16} />}
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

function SpeechListeningBar({
  status,
  error,
  waveform,
  onCancel,
  onStop,
  onRetry,
  onOpenMicrophoneSettings,
}: {
  status:
    | "idle"
    | "requesting-permission"
    | "recording"
    | "stopping"
    | "transcribing"
    | "completed"
    | "error"
    | "cancelled";
  error: string | null;
  waveform: number[];
  onCancel: () => void;
  onStop: () => void;
  onRetry: () => void;
  onOpenMicrophoneSettings?: () => void;
}) {
  const isRecording = status === "recording";
  const isTranscribing = status === "transcribing";
  const isError = status === "error";
  const isPermissionError = /permission|denied|access/i.test(error ?? "");
  const label = isError
    ? error ?? "Microphone error. Please retry."
    : isTranscribing
      ? "Transcribing..."
      : "Listening...";
  const showPermissionSettings =
    isError &&
    Boolean(onOpenMicrophoneSettings) &&
    isPermissionError;
  return (
    <div
      className={[
        "speech-listening-bar",
        isTranscribing ? "transcribing" : "",
        isError ? "error" : "",
      ].join(" ")}
      role="status"
      aria-live="polite"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <SpeechWaveform values={waveform} subdued={isTranscribing || isError} />
      <span className="speech-listening-label">{label}</span>
      <SpeechWaveform values={waveform.slice().reverse()} subdued={isTranscribing || isError} />
      <div className="speech-listening-actions">
        {showPermissionSettings && (
          <button
            type="button"
            className="speech-permission-settings-button"
            onClick={onOpenMicrophoneSettings}
          >
            Open Microphone Settings
          </button>
        )}
        <button
          type="button"
          className="speech-bar-action"
          aria-label="Cancel voice input"
          title="Cancel voice input"
          onClick={onCancel}
        >
          <X size={15} />
        </button>
        <button
          type="button"
          className="speech-bar-action speech-bar-stop"
          aria-label={isError ? "Retry voice input" : "Stop and transcribe voice input"}
          title={isError ? "Retry voice input" : "Stop and transcribe voice input"}
          disabled={isTranscribing}
          onClick={isError ? onRetry : onStop}
        >
          {isError ? <Mic size={15} /> : <Square size={12} fill={isRecording ? "currentColor" : "none"} />}
        </button>
      </div>
    </div>
  );
}

function SpeechWaveform({ values, subdued }: { values: number[]; subdued?: boolean }) {
  const normalized = values.length > 0 ? values : Array.from({ length: 24 }, () => 0.22);
  return (
    <div className={subdued ? "speech-waveform subdued" : "speech-waveform"} aria-hidden="true">
      {normalized.slice(0, 24).map((value, index) => (
        <span
          key={index}
          style={{ "--wave-height": `${Math.max(3, Math.round(value * 24))}px` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function ComposerMentionMenu({
  menuRef,
  mention,
  groups,
  selectedOption,
  onSelect,
}: {
  menuRef: RefObject<HTMLDivElement>;
  mention: MentionState;
  groups: Array<{ group: ComposerReferenceGroup; options: ComposerReferenceOption[] }>;
  selectedOption?: ComposerReferenceOption;
  onSelect: (option: ComposerReferenceOption) => void;
}) {
  const style: CSSProperties = {
    left: mention.x,
    top: mention.y,
    width: mention.width,
    maxHeight: mention.maxHeight,
    transform: mention.placement === "top" ? "translateY(-100%)" : undefined,
  };
  return (
    <div
      ref={menuRef}
      className="composer-mention-menu"
      style={style}
      role="listbox"
      aria-label="Loom reference suggestions"
      data-testid="reference-suggestion-dropdown"
      data-placement={mention.placement}
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
              const code = readableReferenceCode(option);
              const showMatchReason =
                option.suggestionMatchReason &&
                !option.suggestionMatchReason.startsWith("code:") &&
                !option.suggestionMatchReason.startsWith("id:");
              return (
                <button
                  key={`${group.group}-${option.path}`}
                  className={selected ? "mention-option selected" : "mention-option"}
                  data-selected={selected ? "true" : "false"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(option)}
                  role="option"
                  aria-selected={selected}
                >
                  <Icon size={14} />
                  <span className="mention-option-copy">
                    <strong>{option.title}</strong>
                    <small className="mention-option-detail">
                      {code && (
                        <HighlightedReferenceCode code={code} query={mention.query} />
                      )}
                      {code && option.subtitle && <span aria-hidden="true">·</span>}
                      {option.subtitle && (
                        <span className="mention-option-subtitle">{option.subtitle}</span>
                      )}
                    </small>
                    {showMatchReason && (
                      <em>{option.suggestionMatchReason}</em>
                    )}
                  </span>
                  <span className="mention-option-badge">
                    {option.badge ?? option.type}
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

function HighlightedReferenceCode({
  code,
  query,
}: {
  code: string;
  query: string;
}) {
  const normalizedCode = code.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  const matchIndex = normalizedQuery
    ? normalizedCode.indexOf(normalizedQuery)
    : -1;

  if (matchIndex < 0) {
    return <span className="mention-code">{code}</span>;
  }

  const before = code.slice(0, matchIndex);
  const match = code.slice(matchIndex, matchIndex + normalizedQuery.length);
  const after = code.slice(matchIndex + normalizedQuery.length);

  return (
    <span className="mention-code">
      {before}
      <mark className="mention-code-match" data-testid="mention-code-match">
        {match}
      </mark>
      {after}
    </span>
  );
}

function LinkedReferenceDropdown({
  menuRef,
  style,
  links,
  query,
  selectedIndex,
  error,
  onQueryChange,
  onSelectedIndexChange,
  onOpen,
  onCopy,
  onDuplicate,
  onRemove,
  onClose,
}: {
  menuRef: RefObject<HTMLDivElement>;
  style?: CSSProperties;
  links: LoomLink[];
  query: string;
  selectedIndex: number;
  error: string | null;
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (index: number | ((current: number) => number)) => void;
  onOpen: (link: LoomLink) => void;
  onCopy: (link: LoomLink) => void;
  onDuplicate: (link: LoomLink) => void;
  onRemove: (link: LoomLink) => void;
  onClose: () => void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [contextMenu, setContextMenu] = useState<{
    link: LoomLink;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  useLayoutEffect(() => {
    const row = rowRefs.current[selectedIndex];
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, links.length]);

  function openReference(link: LoomLink) {
    setContextMenu(null);
    onOpen(link);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelectedIndexChange((current) =>
        Math.min(current + 1, Math.max(links.length - 1, 0))
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelectedIndexChange((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onSelectedIndexChange(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      onSelectedIndexChange(Math.max(links.length - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      const link = links[selectedIndex];
      if (!link) return;
      event.preventDefault();
      openReference(link);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div
      ref={menuRef}
      className="linked-reference-dropdown"
      style={style}
      onKeyDown={handleKeyDown}
    >
      <label className="linked-reference-search">
        <Search size={13} />
        <input
          ref={searchInputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search linked references"
          aria-label="Search linked references"
        />
      </label>
      <ReferencesListBox role="listbox" aria-label="Linked references">
        {links.length === 0 ? (
          <div className="empty-state">No linked references.</div>
        ) : (
          links.map((link, index) => {
            const Icon = iconForType[link.type];
            const primaryLabel = visibleLinkedReferenceLabel(link);
            const secondaryLabel =
              link.referenceCustomLabel?.trim() && link.referenceCustomLabel.trim() !== link.title
                ? `${link.title} · ${link.path}`
                : link.path;
            const selected = index === selectedIndex;
            return (
              <div
                ref={(node) => {
                  rowRefs.current[index] = node;
                }}
                className={selected ? "linked-reference-row selected" : "linked-reference-row"}
                key={`${link.id}-${link.path}-${link.referenceOccurrenceIndex ?? "1"}-${index}`}
                role="option"
                aria-selected={selected}
                data-selected={selected ? "true" : "false"}
                tabIndex={0}
                title="Open Reference"
                onClick={() => openReference(link)}
                onFocus={() => onSelectedIndexChange(index)}
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
                  <strong>{primaryLabel}</strong>
                  <small>{secondaryLabel}</small>
                </span>
                <button
                  className="linked-reference-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    setContextMenu(null);
                    onDuplicate(link);
                  }}
                  title="Duplicate Reference"
                  aria-label="Duplicate Reference"
                >
                  <Copy size={13} />
                </button>
                <button
                  className="linked-reference-action linked-reference-remove"
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

function visibleLinkedReferenceLabel(link: LoomLink) {
  const customLabel = link.referenceCustomLabel?.trim();
  const label = customLabel || link.title;
  return link.referenceOccurrenceIndex ? `${label} #${link.referenceOccurrenceIndex}` : label;
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
  onOpenReference,
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
  onOpenReference: (item: AttachContentItem) => void;
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  function itemSelected(item: AttachContentItem) {
    return selectedReferenceKeysForLink(item).some((key) => selectedKeys.has(key));
  }

  function renderItem(item: AttachContentItem) {
    const Icon = item.source === "codeSnippet" ? Code2 : iconForType[item.type];
    const selected = itemSelected(item);
    return (
      <div
        key={`${item.source}-${item.id}-${item.path}`}
        className={selected ? "attach-content-row selected" : "attach-content-row"}
        data-testid={`attach-content-row-${item.source}-${item.id}`}
        data-attach-selected={selected ? "true" : "false"}
      >
        <button
          type="button"
          className="attach-content-row-main"
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
        <span className="attach-content-row-separator" aria-hidden="true" />
        <button
          type="button"
          className="attach-content-row-open"
          aria-label={`Open ${item.title}`}
          title="Open"
          onClick={() => onOpenReference(item)}
        >
          <ExternalLink size={13} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="attach-content-dropdown"
      style={style}
      role="dialog"
      aria-label="Attach content"
    >
      <div className="attach-content-header">
        <strong>Attach content</strong>
        <span>Add Loom references or files to your prompt.</span>
      </div>
      <label className="linked-reference-search attach-content-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search Looms, Bookmarks, History, Responses, Code Snippets..."
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
            {groups.filter((group) => group.items.length > 0).map((group) => {
              const selectedCount = group.items.filter(itemSelected).length;
              const visibleCount = Math.max(5, selectedCount);
              return (
                <div className="attach-content-section" key={group.id}>
                  <h3>{group.title}</h3>
                  {group.items.slice(0, visibleCount).map(renderItem)}
                </div>
              );
            })}
            {attachments.length > 0 && (
              <AttachFilesSection
                attachments={attachments}
                fileInputRef={fileInputRef}
                allowUpload={false}
                allowRemove={false}
                onAddFiles={onAddFiles}
                onRemoveAttachment={onRemoveAttachment}
              />
            )}
          </>
        ) : tab === "files" ? (
          <AttachFilesSection
            attachments={attachments}
            fileInputRef={fileInputRef}
            allowUpload={true}
            allowRemove={true}
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
  allowUpload,
  allowRemove,
  onAddFiles,
  onRemoveAttachment,
}: {
  attachments: ComposerAttachment[];
  fileInputRef: RefObject<HTMLInputElement>;
  allowUpload: boolean;
  allowRemove: boolean;
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  return (
    <div className="attach-content-section">
      <h3>Files</h3>
      {allowUpload && (
        <>
          <button
            type="button"
            className="attach-file-action"
            title="Attach local file"
            aria-label="Attach local file"
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
        </>
      )}
      {attachments.length === 0 ? (
        <div className="attach-file-empty">No files attached.</div>
      ) : (
        attachments.map((attachment) => (
          <div
            className={`attach-file-row attachment-status-${attachment.parseStatus ?? "pending"}`}
            key={attachment.id}
          >
            {attachmentParseActive(attachment) ? (
              <LoaderCircle className="attachment-spinner" size={14} />
            ) : (
              <Paperclip size={14} />
            )}
            <span>
              <strong title={attachment.name}>{formatAttachmentDisplayName(attachment.name)}</strong>
              <small>{attachmentStatusLabel(attachment)} · {formatAttachmentSize(attachment.size)}</small>
            </span>
            {allowRemove && (
              <button
                type="button"
                onClick={() => onRemoveAttachment(attachment.id)}
                aria-label={`Remove ${attachment.name}`}
                title="Remove file"
              >
                <X size={13} />
              </button>
            )}
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
  if (source === "codeSnippet") return "Code";
  return "Response";
}

interface HistoryDateGroup {
  key: string;
  label: string;
  entries: HistoryEntry[];
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function historyDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fullHistoryDateLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function historyGroupLabel(date: Date, now = new Date()) {
  const today = startOfLocalDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const target = startOfLocalDay(date);
  const label = fullHistoryDateLabel(target);
  if (target.getTime() === today.getTime()) return `Today — ${label}`;
  if (target.getTime() === yesterday.getTime()) return `Yesterday — ${label}`;
  return label;
}

function dateFromHistoryTimestamp(timestamp: string | undefined, now = new Date()) {
  if (!timestamp) return startOfLocalDay(now);
  const normalized = timestamp.trim().toLowerCase();
  if (
    normalized === "now" ||
    normalized === "just now" ||
    normalized.includes("min ago") ||
    normalized.includes("hour ago") ||
    normalized.includes("earlier today")
  ) {
    return startOfLocalDay(now);
  }
  if (normalized === "yesterday") {
    const yesterday = startOfLocalDay(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  const parsed = Date.parse(
    /\b\d{4}\b/.test(timestamp) ? timestamp : `${timestamp}, ${now.getFullYear()}`
  );
  if (!Number.isNaN(parsed)) return startOfLocalDay(new Date(parsed));
  return startOfLocalDay(now);
}

function groupHistoryByDate(entries: HistoryEntry[]) {
  const now = new Date();
  const groups: HistoryDateGroup[] = [];
  const groupIndex = new globalThis.Map<string, HistoryDateGroup>();
  entries.forEach((entry) => {
    const date = dateFromHistoryTimestamp(entry.visitedAt, now);
    const key = historyDateKey(date);
    const existing = groupIndex.get(key);
    if (existing) {
      existing.entries.push(entry);
      return;
    }
    const group = {
      key,
      label: historyGroupLabel(date, now),
      entries: [entry],
    };
    groupIndex.set(key, group);
    groups.push(group);
  });
  return groups;
}

function RightPanel({
  activePanel,
  bookmarks,
  history,
  lineageRoot,
  activeLoomId,
  activeDestination,
  archived,
  pinned,
  onTogglePin,
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
  highlightedBookmarkId,
}: {
  activePanel: ActivePanel;
  bookmarks: BookmarkItem[];
  history: HistoryEntry[];
  lineageRoot: LineageNode | null;
  activeLoomId: string;
  activeDestination: LoomLink;
  archived: Conversation[];
  pinned: boolean;
  onTogglePin: () => void;
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
  highlightedBookmarkId: string | null;
}) {
  const [bookmarkDragActive, setBookmarkDragActive] = useState(false);

  if (!activePanel) return null;
  const panelLabel =
    activePanel === "bookmarks"
      ? "Bookmarks"
      : activePanel === "history"
        ? "Loom History"
        : activePanel === "looms"
          ? "Flow"
          : "Archive";

  return (
    <aside
      className={pinned ? "right-panel docked" : "right-panel"}
      aria-label={`${panelLabel} panel`}
    >
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
        <div className="panel-header-actions">
          <button
            className={pinned ? "icon-button active" : "icon-button"}
            onClick={onTogglePin}
            aria-label={pinned ? "Unpin panel" : "Pin panel"}
            title={pinned ? "Unpin panel" : "Pin panel"}
          >
            {pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close panel"
            title="Close panel"
          >
            <X size={16} />
          </button>
        </div>
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
              highlighted={bookmark.id === highlightedBookmarkId}
            />
          ))}
        </BookmarkView>
      )}

      {activePanel === "history" && (
        <HistoryView>
          {groupHistoryByDate(history).map((group) => {
            const headingId = `history-date-${group.key}`;
            return (
              <section
                key={group.key}
                className="history-date-group"
                aria-labelledby={headingId}
              >
                <h3 id={headingId} className="history-date-heading">
                  {group.label}
                </h3>
                <div className="history-date-rail">
                  {group.entries.map((entry) => (
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
                </div>
              </section>
            );
          })}
        </HistoryView>
      )}

      {activePanel === "looms" && (
        <WeftView>
          <LoomsPanel
            root={lineageRoot}
            activePath={activeDestination.path}
            activeLoomId={activeLoomId}
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
              const title = cleanPolishedDisplayTitle(conversation.title);
              const destination: LoomLink = {
                id: conversation.id,
                type: "conversation",
                title: conversation.title,
                path: conversation.path,
                badge: typeLabel.conversation,
                targetObjectId: runtimeGraphObjectIdFor("conversation", conversation.id),
                canonicalUri: conversation.meta?.canonicalUri,
                meta: conversation.meta,
                referenceCode: conversation.meta?.code,
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
                          aria-label={`Restore ${title}`}
                        >
                          <RotateCcw size={13} />
                        </button>
                      </Tooltip>
                      <Tooltip label="Delete">
                        <button
                          className="bookmark-rail-button danger"
                          onClick={() => onDeleteRequest(conversation)}
                          aria-label={`Delete ${title}`}
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
  activeLoomId,
  onVisit,
  onBookmark,
  onOpenGraph,
}: {
  root: LineageNode | null;
  activePath: string;
  activeLoomId: string;
  onVisit: (destination: LoomLink) => void;
  onBookmark: (destination: LoomLink) => void;
  onOpenGraph: (destination: LoomLink) => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: LineageNode } | null>(null);
  const [visibleHintNodeId, setVisibleHintNodeId] = useState<string | null>(null);
  const hintTimerRef = useRef<number | null>(null);

  const clearHintTimer = useCallback(() => {
    if (hintTimerRef.current === null) return;
    window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = null;
  }, []);

  const scheduleStillHint = useCallback(
    (nodeId: string) => {
      clearHintTimer();
      hintTimerRef.current = window.setTimeout(() => {
        setVisibleHintNodeId(nodeId);
        hintTimerRef.current = null;
      }, HINT_STILL_DELAY_MS);
    },
    [clearHintTimer]
  );

  const hideStillHint = useCallback(() => {
    clearHintTimer();
    setVisibleHintNodeId(null);
  }, [clearHintTimer]);

  const handleHintMouseMove = useCallback(
    (nodeId: string) => {
      hideStillHint();
      scheduleStillHint(nodeId);
    },
    [hideStillHint, scheduleStillHint]
  );

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
      canonicalUri: node.canonicalUri,
      badge: node.type === "loom" ? typeLabel.loom : node.type === "response" ? typeLabel.response : typeLabel.conversation,
      meta: node.meta,
      referenceCode: node.referenceCode,
      sourceLoomId: node.conversationId,
      sourceResponseId: node.responseId,
      targetObjectId:
        node.type === "response" && node.responseId
          ? runtimeGraphObjectIdFor("response", `${node.conversationId}_${node.responseId}`)
          : node.type === "conversation" || node.type === "loom"
            ? runtimeGraphObjectIdFor("conversation", node.conversationId)
            : undefined,
    };
  }

  function shouldScrollActiveLoomResponse(node: LineageNode) {
    return (
      node.type === "response" &&
      node.conversationId === activeLoomId &&
      Boolean(node.responseId)
    );
  }

  function selectNode(node: LineageNode) {
    hideStillHint();
    setSelectedId(node.id);
    if (shouldScrollActiveLoomResponse(node)) {
      onVisit(nodeToLink(node));
      return;
    }
    if (node.children.length > 0) {
      toggleNode(node);
      return;
    }
    onVisit(nodeToLink(node));
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

  useEffect(
    () => () => {
      clearHintTimer();
    },
    [clearHintTimer]
  );

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
      selectNode(current.node);
    }
  }

  function handleMenuAction(action: string) {
    if (!menu || !root) return;
    const { node } = menu;
    if (action === "open") onVisit(nodeToLink(node));
    if (action === "graph") onOpenGraph(nodeToLink(node));
    if (action === "bookmark") onBookmark(nodeToLink(node));
    if (action === "copy-address") void browserHostShell.copyText(node.canonicalUri ?? node.path);
    if (action === "copy-code" && node.referenceCode) {
      void browserHostShell.copyText(node.referenceCode);
    }
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
        {visibleNodes.map(({ node, lane, hasChildren, collapsed, active, inActiveLineage, activeDescendantHidden }) => {
          const title = cleanMarkdownDisplayTitle(node.title);
          const Icon =
            node.type === "conversation"
              ? Globe2
              : node.type === "loom"
                ? GitFork
                : node.type === "quick"
                  ? MessageSquare
                  : FileText;
          const visibleLaneIndex = clampNumber(lane - laneWindowStart, 0, LOOMS_MAX_VISIBLE_LANES - 1);
          const rowShift = Math.min(
            LOOMS_ROW_SHIFT_MAX,
            visibleLaneIndex * LOOMS_ROW_SHIFT_PER_LANE
          );
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
                visibleHintNodeId === node.id ? "hint-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={node.id}
              role="treeitem"
              data-lineage-node-id={node.id}
              data-visible-lane={visibleLaneIndex}
              ref={(element) => registerRowRef(node.id, element)}
              style={{ "--looms-row-shift": `${rowShift}px` } as CSSProperties}
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
                className={[
                  "looms-log__row-hit",
                  visibleHintNodeId === node.id ? "hint-visible" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  selectNode(node);
                }}
                onDoubleClick={() => {
                  hideStillHint();
                  setSelectedId(node.id);
                  onVisit(nodeToLink(node));
                }}
                onMouseEnter={() => scheduleStillHint(node.id)}
                onMouseMove={() => handleHintMouseMove(node.id)}
                onMouseLeave={hideStillHint}
                onFocus={() => setVisibleHintNodeId(node.id)}
                onBlur={hideStillHint}
                data-title={title}
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
                    <span className="looms-log__title">{title}</span>
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
          <button onClick={() => handleMenuAction("copy-code")} disabled={!menu.node.referenceCode}>
            Copy Code ID
          </button>
          <button onClick={() => handleMenuAction("copy-address")}>Copy Loom Address</button>
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
const LOOMS_ROW_SHIFT_PER_LANE = 2;
const LOOMS_ROW_SHIFT_MAX = 6;
const HINT_STILL_DELAY_MS = 2000;

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
  highlighted = false,
}: {
  destination: T;
  timestamp?: string;
  showBadge?: boolean;
  className?: string;
  onVisit: (destination: T) => void;
  onRemove?: (destination: T) => void;
  onOpenContextMenu?: (event: React.MouseEvent, destination: T) => void;
  actions?: React.ReactNode;
  highlighted?: boolean;
}) {
  const dragPreviewCleanupRef = useRef<(() => void) | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const Icon = iconForType[destination.type];
  const title =
    "editableTitle" in destination && typeof destination.editableTitle === "string"
      ? cleanMarkdownDisplayTitle(destination.editableTitle)
      : cleanMarkdownDisplayTitle(destination.title);
  const rowClassName = [
    "bookmark-row",
    className,
    highlighted ? "is-newly-added" : "",
    destination.badge === "Broken reference" ? "broken" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const destinationCode = referenceCodeForLink(destination);
  const metaRowClassName = [
    "bookmark-meta-row",
    showBadge ? "" : "no-label",
    destinationCode ? "has-code" : "",
  ]
    .filter(Boolean)
    .join(" ");
  useEffect(() => {
    if (!highlighted) return;
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlighted]);
  return (
    <div
      ref={rowRef}
      className={rowClassName}
      draggable
      data-testid={`utility-destination-row-${destination.id}`}
      onContextMenu={(event) => onOpenContextMenu?.(event, destination)}
      onDragStart={(event) => {
        setLoomDragPayload(event, destination);
        dragPreviewCleanupRef.current?.();
        dragPreviewCleanupRef.current = createLoomDragPreview(event, title, destination.path);
      }}
      onDragEnd={() => {
        dragPreviewCleanupRef.current?.();
        dragPreviewCleanupRef.current = null;
      }}
    >
      <span className="bookmark-type-icon">
        <Icon size={16} />
      </span>
      <button className="bookmark-content" onClick={() => onVisit(destination)}>
        <strong title={title}>{title}</strong>
        <small title={destination.path}>{destination.path}</small>
        <span className={metaRowClassName}>
          {showBadge && destination.badge ? (
            <em>{displayObjectTypeLabel(destination.badge)}</em>
          ) : null}
          {destinationCode ? <span className="bookmark-meta-code">{destinationCode}</span> : null}
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
  highlighted = false,
}: {
  bookmark: BookmarkItem;
  onVisit: (destination: BookmarkItem) => void;
  onRemove: (destination: BookmarkItem) => void;
  onOpenContextMenu: (event: React.MouseEvent, destination: BookmarkItem) => void;
  highlighted?: boolean;
}) {
  return (
    <DestinationRow
      destination={bookmark}
      timestamp={bookmark.lastUsed}
      onVisit={onVisit}
      onRemove={onRemove}
      onOpenContextMenu={onOpenContextMenu}
      highlighted={highlighted}
    />
  );
}

function Tooltip({
  label,
  placement = "top-center",
  children,
}: {
  label: string;
  placement?: "top-center" | "bottom-right";
  children: React.ReactElement;
}) {
  const [suppressed, setSuppressed] = useState(false);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleHint = useCallback(() => {
    if (suppressed) return;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setVisible(true);
      timerRef.current = null;
    }, HINT_STILL_DELAY_MS);
  }, [clearTimer, suppressed]);

  const hideHint = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  useEffect(
    () => () => {
      clearTimer();
    },
    [clearTimer]
  );

  return (
    <span
      className={[
        "tooltip-host",
        suppressed ? "tooltip-suppressed" : "",
        visible && !suppressed ? "hint-visible" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-tooltip={label}
      data-placement={placement}
      onMouseEnter={scheduleHint}
      onMouseMove={() => {
        hideHint();
        scheduleHint();
      }}
      onMouseLeave={() => {
        hideHint();
        setSuppressed(false);
      }}
      onFocus={() => setVisible(true)}
      onPointerDownCapture={() => {
        hideHint();
        setSuppressed(true);
      }}
      onContextMenuCapture={() => {
        hideHint();
        setSuppressed(true);
      }}
      onBlur={() => {
        hideHint();
        setSuppressed(false);
      }}
    >
      {children}
    </span>
  );
}

export default App;
