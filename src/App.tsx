import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
  ChevronDown,
  Clock3,
  Compass,
  Copy,
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
  HelpCircle,
  History,
  Info,
  Layers,
  Lightbulb,
  Link2,
  Lock,
  LogOut,
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
  createRuntimeLoomGraphRepository,
  readRuntimeBookmarks,
  writeRuntimeBookmarks,
} from "./services/loomRuntimeGraph";
import {
  readAppSettings,
  writeAppSettings,
  type AppSettings,
  type ModelResponseMode,
} from "./services/appSettings";
import {
  downloadBase64File,
  exportLoomAsCsv,
  exportLoomMetadataJson,
  exportLoomAsMarkdown,
  safeExportFilename,
  textToBase64,
} from "./services/exportService";
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
  referenceTokenText,
  withReferenceDisplayDefaults,
} from "./services/referenceDisplay";
import {
  buildAskContextPayload,
  createHeuristicResponseContextCapsule,
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
  buildAssistantDefaultClipboardData,
  normalizeAssistantMarkdownSource,
  parseAssistantMarkdown,
  responseMarkdownSource,
} from "./services/assistantMarkdown";
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
  type CreateBookmarkInput,
  type JsonValue,
  type LoomSummary,
  type PersistedWeftTurn,
  type VisibleWeftSeedResponse,
} from "./engine";
import { useRuntimeHealth } from "./hooks/useRuntimeHealth";
import { useSidebarDnD } from "./hooks/useSidebarDnD";
import { AppShell } from "./components/AppShell";
import { AddressBar } from "./components/AddressBar";
import { AddressMetadataBadge } from "./components/AddressMetadataBadge";
import { AIProviderSettingsModal } from "./components/AIProviderSettings";
import { AddressHintPopover } from "./components/AddressHintPopover";
import { AskPopup, type AskPopupState } from "./components/AskPopup";
import { BookmarkView } from "./components/BookmarkView";
import { ChangeIconPopover } from "./components/ChangeIconPopover";
import { ContextMenu, type ContextMenuState } from "./components/ContextMenu";
import { ConversationView } from "./components/ConversationView";
import { DeleteConversationDialog } from "./components/DeleteConversationDialog";
import { GroupColorPopover } from "./components/GroupColorPopover";
import { GraphView } from "./components/GraphView";
import { HistoryView } from "./components/HistoryView";
import { ReferencesListBox } from "./components/ReferencesListBox";
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
  bookmark: Bookmark,
  semantic: Sparkles,
  recent: Clock3,
};

const POPOVER_HINT_AUTO_CLOSE_MS = 2000;
const REFERENCE_ADDRESS_HINT_DELAY_MS = 2000;
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
  createdAt: number;
  capsuleSnapshot?: ResponseContextCapsule;
  selectedText?: string;
  sourceLoomId?: string;
  sourceResponseId?: string;
  sourceFragment?: LoomLink;
  payloadReport?: Pick<
    AskContextPayload,
    "usedFullResponse" | "contextCharCount" | "capsuleSource" | "includedSelectedText"
  >;
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

type ComposerReferenceGroup = "Open Looms" | "Responses" | "Bookmarks" | "History";

interface ComposerReferenceOption extends LoomLink {
  group: ComposerReferenceGroup;
  subtitle: string;
  keywords: string[];
  searchText: string[];
  suggestionMatchReason?: string;
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
  { id: "files", label: "Files", Icon: Paperclip },
];

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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

function normalizeReferenceAddress(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function selectedReferenceKeysForLink(link: LoomLink) {
  const keys = new Set<string>();
  if (link.type === "fragment" && link.sourceLoomId && link.sourceResponseId && link.fragmentHash) {
    keys.add(`fragment:${link.sourceLoomId}:${link.sourceResponseId}:${link.fragmentHash}`);
  }
  if (link.targetObjectId) keys.add(`object:${link.targetObjectId}`);
  if (link.canonicalUri) keys.add(`canonical:${normalizeReferenceAddress(link.canonicalUri)}`);
  if (link.path) keys.add(`address:${normalizeReferenceAddress(link.path)}`);
  if (keys.size === 0) keys.add(`fallback:${link.type}:${link.id}`);
  return Array.from(keys);
}

function referencesShareIdentity(a: LoomLink, b: LoomLink) {
  const aKeys = new Set(selectedReferenceKeysForLink(a));
  return selectedReferenceKeysForLink(b).some((key) => aKeys.has(key));
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

function referenceIdentityKey(link: LoomLink) {
  return selectedReferenceKeysForLink(link)[0] ?? `${link.type}:${link.id}:${link.path}`;
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

function sortAttachmentsBySelection(attachments: ComposerAttachment[]) {
  return [...attachments].sort(
    (a, b) =>
      (b.attachedAt ?? b.lastModified) - (a.attachedAt ?? a.lastModified)
  );
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

const seedComposerText = `Use the linked Loom references to draft the V1 onboarding prompt for a power user. <span class="inline-loom-token" contenteditable="false" draggable="true" data-loom-id="${seedComposerLink.id}" data-loom-path="${seedComposerLink.path}" data-loom-title="${seedComposerLink.title}" data-loom-type="${seedComposerLink.type}" data-loom-badge="${seedComposerLink.badge}">[[${seedComposerLink.title}]]</span>`;

const typeLabel: Record<LoomObjectType, string> = {
  conversation: "Loom",
  loom: "Weft",
  response: "Response",
  fragment: "Fragment",
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
      meta.status === "addressable" && meta.canonicalUri
        ? meta.canonicalUri
        : response.address,
    meta,
  };
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
  const wasWeftSplitVisibleRef = useRef(false);
  const metadataGenerationRef = useRef(new Set<string>());
  const composerFocusRef = useRef<(() => void) | null>(null);
  const pendingScrollPathRef = useRef<string | null>(null);
  const pendingScrollDestinationRef = useRef<LoomNavigationDestination | null>(null);
  const pendingScrollHighlightRef = useRef(false);
  const linkCopyToastTimerRef = useRef<number | null>(null);
  const starterPromptRequestIdRef = useRef(0);
  const [metadataSeed] = useState<Record<string, LoomMetadata>>(() =>
    readRuntimeMetadata()
  );
  const [conversations, setConversations] =
    useState<Conversation[]>(() =>
      seedConversations.map((conversation) =>
        withHydratedLoomMetadata(conversation, metadataSeed)
      )
    );
  const [conversationResponses, setConversationResponses] = useState<
    Record<string, ResponseItem[]>
  >(() =>
    Object.fromEntries(
      Object.entries(seedResponsesByConversation).map(([loomId, responses]) => [
        loomId,
        responses.map((response) =>
          withHydratedResponseMetadata(loomId, response, metadataSeed)
        ),
      ])
    )
  );
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
  const [groupColorTarget, setGroupColorTarget] = useState<TabGroup | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [rightDockPinned, setRightDockPinned] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraft>>({
    [seedConversations[0].id]: {
      html: seedComposerText,
      links: [seedComposerLink],
    },
    [EPHEMERAL_DRAFT_ID]: { html: "", links: [] },
  });
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() =>
    getConfiguredLoomEngineMode() === "rust-service"
      ? []
      : readRuntimeBookmarks(seedBookmarks)
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
  const [responseContextCapsules, setResponseContextCapsules] = useState<
    Record<string, ResponseContextCapsule>
  >({});
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
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readAppSettings());
  const [starterCategoryId, setStarterCategoryId] =
    useState<NewLoomStarterCategoryId>("research");
  const [starterPromptRequest, setStarterPromptRequest] =
    useState<TextInsertionRequest | null>(null);
  const [composerRuntimeState, setComposerRuntimeState] = useState<{
    running: boolean;
    message: string | null;
  }>({ running: false, message: null });
  const mainGenerationRef = useRef(0);
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
  const growthMilestoneToastTimerRef = useRef<number | null>(null);

  const activeConversation =
    activeConversationId === draftConversation?.id
          ? draftConversation
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
    conversationResponsesRef.current = conversationResponses;
  }, [conversationResponses]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
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
  const bookmarkedResponseAddresses = useMemo(
    () =>
      new Set(
        bookmarks.flatMap((bookmark) =>
          bookmark.canonicalUri ? [bookmark.path, bookmark.canonicalUri] : [bookmark.path]
        )
      ),
    [bookmarks]
  );

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

  function visibleSplitPanelForLoomId(loomId: string) {
    if (!showWeftSplit) return null;
    if (originConversation?.id === loomId) return "origin" as const;
    if (activeConversation?.id === loomId) return "weft" as const;
    return null;
  }

  const currentActiveDestination = useMemo<LoomLink>(() => {
    if (showWeftSplit && focusedSplitConversation) {
      return {
        id: focusedSplitConversation.id,
        type: getWeftOrigin(focusedSplitConversation.id) ? "loom" : "conversation",
        title: focusedSplitConversation.title,
        path: focusedSplitConversation.path,
        badge: getWeftOrigin(focusedSplitConversation.id) ? typeLabel.loom : typeLabel.conversation,
        canonicalUri: focusedSplitConversation.meta?.canonicalUri,
        meta: focusedSplitConversation.meta,
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
        canonicalUri: activeResponse.meta?.canonicalUri,
        meta: activeResponse.meta,
      };
    }
    if (focusedSplitConversation) {
      return {
        id: focusedSplitConversation.id,
        type: getWeftOrigin(focusedSplitConversation.id) ? "loom" : "conversation",
        title: focusedSplitConversation.title,
        path: focusedSplitConversation.path,
        badge: getWeftOrigin(focusedSplitConversation.id) ? typeLabel.loom : typeLabel.conversation,
        canonicalUri: focusedSplitConversation.meta?.canonicalUri,
        meta: focusedSplitConversation.meta,
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
      setActiveSplitPanel("weft");
    }
    wasWeftSplitVisibleRef.current = showWeftSplit;
  }, [showWeftSplit]);

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

    return [...conversationOptions, ...loomOptions, ...bookmarkOptions, ...historyOptions];
  }, [bookmarks, conversationResponses, conversations, forkRecords, history]);

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
            throw new Error("ZIP export is not available in TypeScript local fallback.");
          },
        },
      }),
    [currentLoomExportTarget, loomGraphRepository, providerSettings]
  );
  const loomEngineClientRef = useRef(loomEngineClient);

  useEffect(() => {
    loomEngineClientRef.current = loomEngineClient;
  }, [loomEngineClient]);

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
            targetObjectId: `response_${loomId}_${response.id}`,
            meta: response.meta ?? bookmark.meta,
            referenceCode: response.meta?.code ?? bookmark.referenceCode,
          };
        }
        return bookmark;
      };
      setBookmarks(() => {
        const seen = new Set<string>();
        return result.bookmarks.map(normalizeServiceBookmark).filter((bookmark) => {
          const key = bookmark.targetObjectId
            ? `${bookmark.type}:${bookmark.targetObjectId}`
            : `${bookmark.type}:${bookmark.path}`;
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
    },
    []
  );

  function saveProviderSettings(nextSettings: AIProviderSettings) {
    setProviderSettings(nextSettings);
    writeAIProviderSettings(nextSettings);
  }

  function saveAppSettings(nextSettings: AppSettings) {
    setAppSettings(nextSettings);
    writeAppSettings(nextSettings);
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
      [loomId]: (current[loomId] ?? []).map((response) =>
        response.id === responseId
          ? {
              ...response,
              finalContent: progress.finalContent ?? response.finalContent,
              thinkingStartedAt: progress.thinkingStartedAt ?? response.thinkingStartedAt,
              thinkingEndedAt: progress.thinkingEndedAt ?? response.thinkingEndedAt,
              finalStartedAt: progress.finalStartedAt ?? response.finalStartedAt,
              elapsedThinkingSeconds:
                progress.elapsedThinkingSeconds ?? response.elapsedThinkingSeconds,
              thinkingTimeoutMs: progress.thinkingTimeoutMs ?? response.thinkingTimeoutMs,
              doneReason: progress.doneReason ?? response.doneReason,
              truncated: progress.truncated ?? response.truncated,
              outputBudget: progress.outputBudget ?? response.outputBudget,
              numPredict: progress.numPredict ?? response.numPredict,
              thinkingStalled: progress.thinkingStalled ?? response.thinkingStalled,
              thinkingStallReason:
                progress.thinkingStallReason ?? response.thinkingStallReason,
            }
          : response
      ),
    }));
  }

  function showResponseCompletionActions(responseId: string) {
    setGeneratingResponseId((current) => (current === responseId ? null : current));
    setCompletionActionRevealResponseId(null);
    window.requestAnimationFrame(() => {
      setCompletionActionRevealResponseId(responseId);
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
              answerNowProgress = activateVisibleAnswerStage(
                answerNowProgress,
                "finalizing",
                "Writing final response..."
              );
              updateResponseVisibleProgress(currentRequest.loomId, responseId, answerNowProgress);
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
            continuationProgress = activateVisibleAnswerStage(
              continuationProgress,
              "finalizing",
              "Writing final response..."
            );
            updateResponseVisibleProgress(match.loomId, responseId, continuationProgress);
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
    const nextAddress = promotedMeta.canonicalUri ?? located.response.address;
    if (located.response.address !== nextAddress) {
      loomGraphRepository.registerAliasUri({
        aliasUri: located.response.address,
        targetObjectId: responseObjectId,
        replacementAliasUri: nextAddress,
      });
      loomGraphRepository.registerAliasUri({
        aliasUri: nextAddress,
        targetObjectId: responseObjectId,
      });
    }
    setConversationResponses((current) => ({
      ...current,
      [located.loomId]: (current[located.loomId] ?? []).map((item) =>
        item.id === located.response.id
          ? {
              ...item,
              address: nextAddress,
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
      path: nextAddress,
      targetObjectId: responseObjectId,
      canonicalUri: promotedMeta.canonicalUri,
      meta: promotedMeta,
      referenceCode: promotedMeta.code,
    };
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

  function findLocalResponseTarget(
    destination: LoomLink | AddressSuggestion | HistoryEntry
  ) {
    const addresses = destinationAddressCandidates(destination);
    for (const [loomId, responses] of Object.entries(conversationResponses)) {
      for (const response of responses) {
        const targetObjectId = runtimeGraphObjectIdFor(
          "response",
          `${loomId}_${response.id}`
        );
        const seedResponse = seedResponsesByConversation[loomId]?.find(
          (item) => item.id === response.id
        );
        const matchesIdentity =
          destination.id === response.id ||
          destination.id === targetObjectId ||
          destination.targetObjectId === targetObjectId;
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
    return {
      id: response.id,
      type: "response",
      title: responseTitleOverrides[response.id] ?? response.title,
      path: response.address,
      badge,
      canonicalUri: response.meta?.canonicalUri,
      meta: response.meta,
      referenceCode: response.meta?.code,
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
    if (destination.referenceCode || destination.meta?.code) return destination;
    const responseTarget = findLocalResponseTarget(destination);
    if (responseTarget?.response.meta) {
      return {
        ...destination,
        targetObjectId:
          destination.targetObjectId ??
          runtimeGraphObjectIdFor(
            "response",
            `${responseTarget.loom.id}_${responseTarget.response.id}`
          ),
        canonicalUri:
          destination.canonicalUri ?? responseTarget.response.meta.canonicalUri,
        meta: responseTarget.response.meta,
        referenceCode: responseTarget.response.meta.code,
      };
    }
    const loomTarget = findLocalLoomTarget(destination);
    if (loomTarget?.meta) {
      return {
        ...destination,
        targetObjectId:
          destination.targetObjectId ??
          runtimeGraphObjectIdFor("conversation", loomTarget.id),
        canonicalUri: destination.canonicalUri ?? loomTarget.meta.canonicalUri,
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
    setGraphMode(true);
  }

  function toggleGraphOverlay() {
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
    setAddressFocused(false);
    setAddressQuery("");
    setAddressFeedback(null);
    setSelectedSuggestion(0);
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
    setSelectedSuggestion(0);
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
      setAddressFocused(true);
      return;
    }
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
  }

  useEffect(() => {
    const pendingDestination = pendingScrollDestinationRef.current;
    const pendingPath = pendingScrollPathRef.current;
    const shouldHighlightPendingScroll = pendingScrollHighlightRef.current;
    if ((!pendingDestination && !pendingPath) || graphMode) return;
    pendingScrollDestinationRef.current = null;
    pendingScrollPathRef.current = null;
    pendingScrollHighlightRef.current = false;
    window.requestAnimationFrame(() => {
      const scrollToResponse = (
        transcript: HTMLElement | null,
        responseId?: string,
        path?: string,
        highlight = false
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
        if (highlight) {
          target.classList.remove("response-scroll-highlight");
          void target.offsetWidth;
          target.classList.add("response-scroll-highlight");
          window.setTimeout(() => {
            target.classList.remove("response-scroll-highlight");
          }, 1800);
        }
        return true;
      };

      const transcriptForLoom = (loomId?: string) => {
        if (showWeftSplit && loomId === originConversation?.id) {
          return originTranscriptRef.current;
        }
        return transcriptRef.current;
      };

      if (pendingDestination?.mode === "split" && pendingDestination.originResponseId) {
        scrollToResponse(
          originTranscriptRef.current,
          pendingDestination.originResponseId
        );
      }

      if (pendingDestination?.scrollMode === "lastResponse") {
        const latest = lastResponseInLoom(pendingDestination.loomId);
        if (scrollToResponse(transcriptForLoom(pendingDestination.loomId), latest?.id)) return;
      }

      if (
        pendingDestination?.scrollTargetResponseId &&
        scrollToResponse(
          transcriptForLoom(pendingDestination.loomId),
          pendingDestination.scrollTargetResponseId,
          undefined,
          shouldHighlightPendingScroll
        )
      ) {
        return;
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
        if (scrollToResponse(transcriptRef.current, latest?.id)) return;
        transcriptRef.current?.scrollTo({
          top: transcriptRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    });
  }, [
    activeConversation?.path,
    activeConversationId,
    activeSplitPanel,
    activeObjectTitle,
    currentNavigationDestination,
    graphMode,
    originConversation?.id,
    showWeftSplit,
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
    if (conversation.id === activeConversationId) {
      openNewConversationDraft();
    }
  }

  function restoreConversation(conversation: Conversation) {
    setArchived((current) => current.filter((item) => item.id !== conversation.id));
    setConversations((current) => [...current, conversation]);
    setActiveConversationId(conversation.id);
    setActiveObjectTitle(conversation.title);
    closeUnpinnedUtilityOverlays();
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
    if (conversation.id === activeConversationId) {
      openNewConversationDraft();
    }
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
    const stableLink = resolveReferenceLink(promoteResponseLink(link), draftKey);
    const selectedLink = {
      ...stableLink,
      selectedAt: stableLink.selectedAt ?? Date.now(),
    };
    if (
      selectedLink.targetObjectId &&
      draft.links.some(
        (item) =>
          item.targetObjectId === selectedLink.targetObjectId || item.path === selectedLink.path
      )
    ) {
      return;
    }
    updateComposerDraft(draftKey, (draft) => ({
      ...draft,
      links: draft.links.some((item) => item.path === selectedLink.path)
        ? draft.links
        : [...draft.links, selectedLink],
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
      canonicalUri: response.meta?.canonicalUri,
      meta: response.meta,
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
    const address = currentActiveDestination.canonicalUri ?? currentActiveDestination.path;
    if (kind === "address") {
      void browserHostShell.copyText(address);
      showLinkCopyToast("Loom address is copied");
      return;
    }
    if (kind === "markdown") {
      void browserHostShell.copyText(
        toLoomMarkdown({ title: currentActiveDestination.title, path: address })
      );
      showLinkCopyToast("Markdown link is copied");
      return;
    }
    void browserHostShell.copyText(`${currentActiveDestination.title}\n${address}`);
    showLinkCopyToast("Title and address are copied");
  }

  async function exportCurrentLoom(format: "markdown" | "csv") {
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
        includeGraph: false,
      });
      downloadBase64File(
        exportResult.fileName,
        exportResult.contentBase64,
        exportResult.mimeType
      );
      showToast({
        title: `${format === "markdown" ? "Markdown" : "CSV"} export created`,
        message: `${currentLoomExportTarget.loom.title} was exported as ${format === "markdown" ? "Markdown" : "CSV"}.`,
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
    const { payload, clipboardData } = buildAssistantDefaultClipboardData(responseMarkdownForCopy(response));
    const clipboardApi = navigator.clipboard;
    if (clipboardApi?.write && typeof ClipboardItem !== "undefined") {
      try {
        await clipboardApi.write([new ClipboardItem(clipboardData)]);
        showLinkCopyToast("Rich text is copied");
        return;
      } catch {
        // Browser clipboard implementations vary; fall back to clean visible text.
      }
    }
    await browserHostShell.copyText(payload.plainText);
    showLinkCopyToast("Plain text is copied");
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

  function copyPromptTextWithToast(promptText: string) {
    void browserHostShell.copyText(promptText).then(
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
      await browserHostShell.copyText(code);
      showLinkCopyToast("Code is copied");
      return true;
    } catch {
      return false;
    }
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
          navigationDestination: {
            loomId: located.loomId,
            mode: "full",
            scrollTargetResponseId: located.response.id,
            scrollMode: "exact",
            source: "userNavigation",
          },
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
    if (link.type === "fragment" && link.sourceLoomId && link.sourceResponseId) {
      const sourceResponse = findResponseInLoom(link.sourceLoomId, link.sourceResponseId);
      if (!sourceResponse) return "This Fragment Reference source cannot be opened.";
      visitDestination(responseLinkForNavigation(link.sourceLoomId, sourceResponse), {
        source: "userNavigation",
        navigationDestination: {
          loomId: link.sourceLoomId,
          mode: "full",
          scrollTargetResponseId: link.sourceResponseId,
          scrollMode: "exact",
          source: "userNavigation",
        },
      });
      return null;
    }
    const resolution = resolveLoomAddress(link.path, loomGraphRepository);
    if (resolution.status === "resolved") {
      visitResolvedReference(link, resolution);
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
    closeUnpinnedUtilityOverlays();
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
    if (!meaningful || composerRuntimeState.running) return false;
    const useRustServiceGeneration =
      getConfiguredLoomEngineMode() === "rust-service" && !options.preserveNavigation;

    const readinessMessage = modelReadinessMessage("main");
    if (readinessMessage && !useRustServiceGeneration) {
      setComposerRuntimeState({ running: false, message: readinessMessage });
      return false;
    }

    const generationId = mainGenerationRef.current + 1;
    mainGenerationRef.current = generationId;
    const controller = new AbortController();
    mainAbortRef.current = controller;
    mainRevealTargetRef.current = null;

    setComposerRuntimeState({
      running: true,
      message: "Understanding question...",
    });
    const targetLoomId = options.loomId ?? activeConversationId;
    const existingTargetConversation =
      targetLoomId === draftConversation?.id
        ? draftConversation
        : conversations.find((conversation) => conversation.id === targetLoomId);
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
    const targetResponses = conversationResponses[targetConversation.id] ?? [];
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
      setConversations((current) => [...current, targetConversation]);
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

    setConversationResponses((current) => ({
      ...current,
      [targetConversation.id]: [...(current[targetConversation.id] ?? []), response],
    }));
    setGeneratingResponseId(response.id);
    setCompletionActionRevealResponseId(null);
    options.onResponseCreated?.(targetConversation.id, response);
    mainRevealTargetRef.current = { loomId: targetConversation.id, responseId: response.id };
    setComposerDrafts((current) => {
      const { [targetLoomId]: _discardTarget, [EPHEMERAL_DRAFT_ID]: _discardDraft, ...rest } = current;
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

    if (useRustServiceGeneration) {
      let serviceAccepted = false;
      let serviceResponseId = response.id;
      let serviceFinalContent = "";
      let persistedUserResponseId: string | undefined;
      const mainModelName = getProfileModel(providerSettings, "main").name;
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
            item.id === serviceResponseId ? { ...item, workflowRunId } : item
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
          kind: getWeftOrigin(targetConversation.id) ? "weft" : "loom",
          originLoomId: getWeftOrigin(targetConversation.id)?.originLoomId,
          originResponseId: getWeftOrigin(targetConversation.id)?.originResponseId,
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
          model: mainModelName,
          options: {
            numCtx: providerSettings.ollama.contextLength,
          },
          persistWorkflow: true,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted || mainGenerationRef.current !== generationId) return false;

          if (event.type === "assistant_placeholder_created") {
            serviceAccepted = true;
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
            });
            continue;
          }
          if (event.type === "content_delta") {
            serviceAccepted = true;
            if (event.payload.responseId) replaceServiceResponseId(event.payload.responseId);
            serviceFinalContent += event.payload.delta;
            setResponseProgress(
              activateVisibleAnswerStage(
                visibleProgress,
                "finalizing",
                "Writing final response..."
              )
            );
            updateResponseMarkdown(targetConversation.id, serviceResponseId, serviceFinalContent);
            continue;
          }
          if (event.type === "response_completed" || event.type === "response_truncated") {
            serviceAccepted = true;
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
                      serviceUserResponseId:
                        item.serviceUserResponseId ??
                        completedResponse.serviceUserResponseId ??
                        persistedUserResponseId,
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
    const targetWeftOrigin = getWeftOrigin(targetConversation.id);
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
    const mainModelName = getProfileModel(providerSettings, "main").name;
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
              setResponseProgress(
                activateVisibleAnswerStage(
                  visibleProgress,
                  "finalizing",
                  "Writing final response..."
                )
              );
              markDebugEvent("Final content started", `Writing answer into ${response.id}`);
            }
            receivedStreamingContent = progress.finalContent.length > 0;
            if (progress.finalContent.length !== lastFinalCharCount) {
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
        const { [targetLoomId]: _discardTarget, [EPHEMERAL_DRAFT_ID]: _discardDraft, ...rest } = current;
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
        const serviceResult = await loomEngineClient.createBookmark(
          bookmarkInputForLink(promotedLink, promotion.targetObject.objectId)
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

  async function toggleSuggestedBookmark(link: LoomLink) {
    const resolved = resolveLoomAddress(link.path, loomGraphRepository);
    const targetObjectId =
      resolved.status === "resolved"
        ? (resolved.targetObject ?? resolved.object)?.objectId
        : undefined;
    const responseTarget = findLocalResponseTarget(link);
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
      (bookmark) =>
        bookmark.path === link.path ||
        (targetObjectId && bookmark.targetObjectId === targetObjectId)
    );
    if (existing || responseTarget?.response.bookmarked) {
      if (existing) {
        const removed = await removeBookmark(existing);
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
      forkTitle?: string
    ): LineageNode => {
      const responses = conversationResponses[conversation.id] ?? [];
      return {
        id: `${asLoom ? "loom" : "conversation"}-${conversation.id}`,
        type: asLoom ? "loom" : "conversation",
        title: asLoom ? forkTitle ?? conversation.title : conversation.title,
        path: conversation.path,
        canonicalUri: conversation.meta?.canonicalUri,
        referenceCode: conversation.meta?.code,
        meta: conversation.meta,
        subtitle: asLoom ? conversation.title : "Conversation root",
        conversationId: conversation.id,
        children: responses.map((response) => ({
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
    const existingFork = forkRecords.find(
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
              } satisfies AskExchange,
            ]
          : [];
    const askResponseFromTurn = (
      turn: AskExchange,
      weftPath: string,
      index: number
    ): ResponseItem => {
      const title = normalizeLoomTitle(turn.question);
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
          title: normalizeLoomTitle(`Loom: ${response.title}`),
          summary: `Branched from ${sourceConversation.title}.`,
          reuseExisting: true,
          source: initialExchange ? "quick_ask_convert" : "response_action",
          seedMode: initialExchange ? "none" : "origin_qa_pair",
          createOriginContextSnapshot: true,
          metadata: serviceMetadata,
        });
        const serviceWeftConversation = serviceResult.weft
          ? materializeServiceWeftConversation(serviceResult.weft)
          : {
              id: serviceResult.loomId,
              title: normalizeLoomTitle(`Loom: ${response.title}`),
              path: `${sourceConversation.path}/loom/${serviceResult.loomId}`,
              folder: sourceConversation.folder,
              summary: `Branched from ${sourceConversation.title}.`,
              iconKey: "workflow",
              meta: createAddressableLoomMetadata({
                id: createMetadataUuid(),
                title: normalizeLoomTitle(`Loom: ${response.title}`),
                text: metadataTextForLoom({
                  title: normalizeLoomTitle(`Loom: ${response.title}`),
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
                createdAt: new Date(turn.createdAt).toISOString(),
                metadata: sanitizeWeftMetadataValue({
                  selectedText: turn.selectedText,
                  sourceLoomId: turn.sourceLoomId,
                  sourceResponseId: turn.sourceResponseId,
                  sourceFragment: turn.sourceFragment,
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
            serviceUserResponseId: persistedTurn.userResponseId,
          };
        });
        setConversations((current) => {
          if (current.some((item) => item.id === serviceWeftConversation.id)) return current;
          const sourceIndex = current.findIndex((item) => item.id === sourceConversation.id);
          if (sourceIndex < 0) return [serviceWeftConversation, ...current];
          return [
            ...current.slice(0, sourceIndex),
            serviceWeftConversation,
            ...current.slice(sourceIndex),
          ];
        });
        setTabGroups((current) =>
          current.map((group) => {
            if (group.conversationIds.includes(serviceWeftConversation.id)) return group;
            const sourceIndex = group.conversationIds.indexOf(sourceConversation.id);
            if (sourceIndex < 0) return group;
            return {
              ...group,
              conversationIds: [
                ...group.conversationIds.slice(0, sourceIndex),
                serviceWeftConversation.id,
                ...group.conversationIds.slice(sourceIndex),
              ],
            };
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
            title: `Loom from ${response.title}`,
          };
          if (existingIndex < 0) return [...current, nextRecord];
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
    if (existingWeft) {
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
    const title = normalizeLoomTitle(`Loom: ${response.title}`);
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
      [id]: weftResponses,
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

  async function updateResponsePrompt(loomId: string, responseId: string, nextPrompt: string) {
    const normalizedPrompt = nextPrompt
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!normalizedPrompt) return false;
    const currentResponse = conversationResponses[loomId]?.find((response) => response.id === responseId);
    const serviceUserResponseId = currentResponse?.serviceUserResponseId;
    if (getConfiguredLoomEngineMode() === "rust-service" && serviceUserResponseId) {
      try {
        await loomEngineClient.updateResponse({
          responseId: serviceUserResponseId,
          content: normalizedPrompt,
          metadata: sanitizeWeftMetadataValue({
            questionReferences: currentResponse?.questionReferences,
          }),
          editReason: "user_prompt_edit",
          markDownstreamStale: true,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "loom-service could not update the prompt.";
        showToast({
          title: "Prompt edit failed",
          message,
          color: "sunset",
        });
        return false;
      }
    }
    setConversationResponses((current) => ({
      ...current,
      [loomId]: (current[loomId] ?? []).map((response) =>
        response.id === responseId
          ? {
              ...response,
              question: normalizedPrompt,
              promptEditedAt: new Date().toISOString(),
              answerStale: response.answer.join("\n\n").trim().length > 0,
            }
          : response
      ),
    }));
    return true;
  }

  async function regenerateFromEditedPrompt(loomId: string, responseId: string) {
    const sourceResponse = conversationResponses[loomId]?.find((response) => response.id === responseId);
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
    const mainModelName = getProfileModel(providerSettings, "main").name;
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
      [loomId]: [...(current[loomId] ?? []), regeneratedResponse],
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
        model: mainModelName,
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
              item.id === activeResponseId ? completedResponse : item
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
        [loomId]: (current[loomId] ?? []).filter((item) => item.id !== activeResponseId),
      }));
      setGeneratingResponseId(null);
      setComposerRuntimeState({ running: false, message });
      mainAbortRef.current = null;
      mainServiceCancellationRef.current = null;
    }
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
      if (item.id === "rename") renameConversation(conversation);
      if (item.id === "change-icon") setIconPickerTarget(conversation);
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
    setAskState((current) => {
      if (!current) return current;
      const exchanges = current.exchanges ?? [];
      return {
        ...current,
        answer,
        exchanges: exchanges.map((exchange, index) =>
          index === exchanges.length - 1 && exchange.question === question
            ? { ...exchange, answer }
            : exchange
        ),
      };
    });
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
    const askPayload = buildAskContextPayload({
      response: askState.response,
      selectedText: askState.sourceSelectedText,
      userQuestion: prompt,
      capsule,
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
    const quickModelName = getProfileModel(providerSettings, "quick").name;
    const quickAskInput = {
      sessionId: askState.sessionId ?? `ask-${askState.response.id}`,
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
      turns: (askState.exchanges ?? []).map((exchange) => ({
        question: exchange.question,
        answer: exchange.answer,
      })),
      question: prompt,
      intent: askPayload.focusedIntent,
      options: {
        model: quickModelName,
        numCtx: 1024,
        numPredict: quickAskNumPredict(
          askPayload.focusedIntent,
          Boolean(askState.sourceSelectedText)
        ),
      },
    };
    setAskState({ ...askState, running: true, error: undefined });
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
      setAskState((current) => {
        if (!current) return current;
        return {
          ...current,
          question: "",
          running: true,
          answered: true,
          answer: "",
          exchanges: [
            ...(current.exchanges ?? []),
            {
              id: `ask-turn-${Date.now()}`,
              question: prompt,
              answer: "",
              createdAt: Date.now(),
              capsuleSnapshot: capsule,
              selectedText: askState.sourceSelectedText,
              sourceLoomId: askState.sourceLoomId,
              sourceResponseId: askState.sourceResponseId ?? askState.response.id,
              sourceFragment: askState.sourceFragment,
              payloadReport: {
                usedFullResponse: askPayload.usedFullResponse,
                contextCharCount: askPayload.contextCharCount,
                capsuleSource: askPayload.capsuleSource,
                includedSelectedText: askPayload.includedSelectedText,
              },
            } satisfies AskExchange,
          ],
          error: undefined,
        };
      });
      quickRevealQuestionRef.current = prompt;
      const sanitizedAnswer = sanitizeModelAnswer("answer" in result ? result.answer : result.text);
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
              ? { ...exchange, answer: sanitizedAnswer }
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
      setAskState({
        ...askState,
        running: false,
        error: providerErrorMessage(error),
      });
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
    const sourceCanonicalUri = state.response.meta?.canonicalUri;
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

  function scrollTranscriptToBottom() {
    if (!transcriptRef.current || isNewConversationDraft) return;
    transcriptProgrammaticScrollRef.current = true;
    transcriptRef.current.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
    window.setTimeout(() => {
      transcriptProgrammaticScrollRef.current = false;
    }, 220);
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
        runtimeState={composerRuntimeState}
        runtimeHealth={activeComposerRuntimeHealth}
        active={panelActive}
        onActivate={() => setActiveSplitPanel(panel)}
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
      openGraphOverlay();
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
        onCopyShareItem={copyShareItem}
        onExportCurrentLoom={exportCurrentLoom}
        onToggleSidebar={() => {
          setSidebarFlyoutOpen(false);
          setSidebarFlyoutDragActive(false);
          setSidebarCollapsed((current) => !current);
        }}
        onTogglePanel={(panel) => {
          setAddressFocused(false);
          toggleUtilityPanel(panel);
          setAddressFeedback(null);
        }}
        onToggleGraph={() => {
          setAddressFocused(false);
          setAddressQuery("");
          setAddressFeedback(null);
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
          activeConversationId={
            showWeftSplit && focusedSplitConversation
              ? focusedSplitConversation.id
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
                { loomId: conversation.id }
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
          onOpenSettings={() => setProviderSettingsOpen(true)}
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
                referenceDisplayMode={appSettings.referenceDisplayMode}
                modelResponseMode={appSettings.modelResponseMode}
                providerSettings={providerSettings}
                runtimeState={composerRuntimeState}
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
                  forkRecords={forkRecords}
                  activeLoomId={focusedSplitConversation?.id ?? activeConversation?.id}
                  focusedResponseId={
                    currentNavigationDestination?.scrollTargetResponseId ??
                    recentResponseFeedbackId ??
                    focusedSplitResponses[focusedSplitResponses.length - 1]?.id
                  }
                  focusedWeftLoomId={
                    recentWeftFeedbackLoomId ??
                    (currentNavigationDestination?.source === "weftCreate"
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
                  onBookmarkResponse={(loomId, response) => {
                    toggleSuggestedBookmark(responseLinkForNavigation(loomId, response));
                  }}
                  onLinkResponse={(loomId, response) => {
                    linkObjectForDraft(
                      responseLinkForNavigation(loomId, response),
                      activeDraftKey
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
                  onAskResponse={(loomId, response) => {
                    openAsk(
                      response,
                      response.answer.join("\n\n"),
                      loomId
                    );
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
                      runtimeState={composerRuntimeState}
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
                        if (composerRuntimeState.running) {
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
                            onLoom={(response) => forkResponseLoom(response, originConversation.id)}
                            onToggleSuggestedBookmark={toggleSuggestedBookmark}
                            bookmarkedPaths={new Set(bookmarks.map((bookmark) => bookmark.path))}
                            forkRecords={forkRecords}
                            onSelectionAsk={(response) => {
                              setActiveSplitPanel("origin");
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
                            onOpenReference={openComposerReference}
                            highlightedResponseId={recentResponseFeedbackId}
                            onTranscriptScroll={handleTranscriptScroll}
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
                            onLoom={(response) => forkResponseLoom(response, activeConversation.id)}
                            onToggleSuggestedBookmark={toggleSuggestedBookmark}
                            bookmarkedPaths={new Set(bookmarks.map((bookmark) => bookmark.path))}
                            forkRecords={forkRecords}
                            onSelectionAsk={(response) => {
                              setActiveSplitPanel("weft");
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
                            onOpenReference={openComposerReference}
                            onReturnToOrigin={returnToOrigin}
                            highlightedResponseId={recentResponseFeedbackId}
                            onTranscriptScroll={handleTranscriptScroll}
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
                    onLoom={forkResponseLoom}
                    onToggleSuggestedBookmark={toggleSuggestedBookmark}
                    bookmarkedPaths={new Set(bookmarks.map((bookmark) => bookmark.path))}
                    forkRecords={forkRecords}
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
                    onOpenReference={openComposerReference}
                    onReturnToOrigin={activeWeftOrigin ? returnToOrigin : undefined}
                    highlightedResponseId={recentResponseFeedbackId}
                    onTranscriptScroll={handleTranscriptScroll}
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
                  runtimeState={composerRuntimeState}
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
          history={history.map(enrichDestinationMetadata)}
          lineageRoot={lineageRoot}
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
              }
            );
            if (converted) closeSelectionAskFlow();
          }}
          onSubmit={submitQuickQuestion}
          onStop={stopQuickAskResponse}
        />
      )}

      {providerSettingsOpen && (
        <AIProviderSettingsModal
          settings={providerSettings}
          appSettings={appSettings}
          runtimeHealth={activeComposerRuntimeHealth}
          engineClient={loomEngineClient}
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
  onOpenSettings: () => void;
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

  useEffect(() => {
    folderListRef.current?.scrollTo({
      top: folderListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [conversations.length, activeConversationId]);

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

  function openSettingsFromProfile() {
    setProfileMenuOpen(false);
    onOpenSettings();
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
        <button className="new-chat-button" onClick={onNewConversation}>
          <Plus size={16} />
          <span>New Loom</span>
          <kbd>⌘ L</kbd>
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
          <div className="profile-dot">G</div>
          <div>
            <div className="footer-title">Gokay</div>
            <div className="footer-caption">Personal Web</div>
          </div>
        </button>
        {profileMenuOpen && (
          <div className="profile-menu" role="menu" aria-label="Profile menu">
            <div className="profile-menu-header">
              <div className="profile-dot">G</div>
              <div>
                <strong>Gokay</strong>
                <span>Personal Web</span>
              </div>
            </div>
            <div className="profile-menu-section">
              <button
                type="button"
                role="menuitem"
                data-testid="open-app-settings"
                onClick={openSettingsFromProfile}
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>
            </div>
            <div className="profile-menu-section">
              <button type="button" role="menuitem" onClick={openSettingsFromProfile}>
                <Cpu size={14} />
                <span>AI Providers</span>
              </button>
              <button type="button" role="menuitem" onClick={openSettingsFromProfile}>
                <Settings size={14} />
                <span>Model settings</span>
              </button>
            </div>
            <div className="profile-menu-section">
              <button type="button" role="menuitem">
                <HelpCircle size={14} />
                <span>Help</span>
              </button>
              <button type="button" role="menuitem">
                <Info size={14} />
                <span>About Loom</span>
              </button>
            </div>
            <div className="profile-menu-section profile-menu-footer">
              <button type="button" role="menuitem">
                <LogOut size={14} />
                <span>Log out</span>
              </button>
            </div>
          </div>
        )}
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
  canDragCurrentDestination: boolean;
  onAddressFocus: () => void;
  onAddressChange: (value: string) => void;
  onAddressKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onVisit: (destination: LoomLink | AddressSuggestion) => void;
  onBack: () => void;
  onForward: () => void;
  onJumpTraversal: (index: number) => void;
  onBookmarkCurrent: () => void;
  onCopyShareItem: (kind: "address" | "markdown" | "title-address") => void;
  onExportCurrentLoom: (format: "markdown" | "csv") => void;
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

  function handleShareExport(format: "markdown" | "csv") {
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
          <span className="chrome-window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
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
        <button
          ref={shareButtonRef}
          className="icon-button address-share-button"
          aria-label="Share"
          aria-haspopup="menu"
          aria-expanded={Boolean(shareMenuPosition)}
          onClick={toggleShareMenu}
        >
          <Share size={16} />
        </button>
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
          title="Graph"
        >
          <Map size={16} />
        </button>
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
  onExport: (format: "markdown" | "csv") => void;
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
        <button type="button" role="menuitem" disabled title="ZIP export is not available yet.">
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

const codeKeywords = new Set([
  "as",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "class",
  "const",
  "continue",
  "default",
  "else",
  "export",
  "extends",
  "false",
  "for",
  "from",
  "function",
  "if",
  "import",
  "interface",
  "let",
  "new",
  "null",
  "private",
  "public",
  "return",
  "string",
  "switch",
  "true",
  "type",
  "undefined",
  "void",
]);

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const elements: Array<string | JSX.Element> = [];
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      elements.push(text.slice(cursor, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      elements.push(
        <strong key={`${keyPrefix}-strong-${match.index}`}>
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      elements.push(
        <code key={`${keyPrefix}-code-${match.index}`}>
          {token.slice(1, -1)}
        </code>
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) elements.push(text.slice(cursor));
  return elements.length > 0 ? elements : text;
}

function syntaxClassForToken(token: string) {
  if (/^\/\/.*/.test(token)) return "comment";
  if (/^(['"`]).*\1$/.test(token)) return "string";
  if (/^\d+(\.\d+)?$/.test(token)) return "number";
  if (/^[A-Z][A-Za-z0-9_]*$/.test(token)) return "type";
  if (codeKeywords.has(token)) return "keyword";
  if (/^[A-Za-z_$][\w$]*(?=\()/.test(token)) return "function";
  return undefined;
}

function renderCodeLine(line: string, lineIndex: number) {
  const tokenPattern =
    /(\/\/.*|(['"`])(?:\\.|(?!\2).)*\2|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*(?=\()|\b[A-Za-z_$][\w$]*\b)/g;
  const parts: JSX.Element[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > cursor) {
      parts.push(
        <span key={`${lineIndex}-plain-${cursor}`}>
          {line.slice(cursor, match.index)}
        </span>
      );
    }
    const token = match[0];
    const tokenClass = syntaxClassForToken(token);
    parts.push(
      <span
        className={tokenClass ? `syntax-token syntax-${tokenClass}` : undefined}
        key={`${lineIndex}-token-${match.index}`}
      >
        {token}
      </span>
    );
    cursor = match.index + token.length;
    if (token.startsWith("//")) break;
  }

  if (cursor < line.length) {
    parts.push(<span key={`${lineIndex}-tail`}>{line.slice(cursor)}</span>);
  }
  return parts.length > 0 ? parts : "\u00a0";
}

function SyntaxHighlightedCode({ code }: { code: string }) {
  return (
    <>
      {code.split("\n").map((line, index) => (
        <span className="assistant-code-line" key={`${index}-${line}`}>
          {renderCodeLine(line, index)}
        </span>
      ))}
    </>
  );
}

function CodeBlock({
  language,
  code,
  closed,
  onCopyCode,
}: {
  language: string;
  code: string;
  closed: boolean;
  onCopyCode: (code: string) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const canCopy = closed && code.trim().length > 0;

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  async function copyCode() {
    if (!canCopy) return;
    const success = await onCopyCode(code);
    if (!success) return;
    setCopied(true);
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 2000);
  }

  return (
    <figure className="assistant-code-block">
      <figcaption>
        <span>{language}</span>
        <button
          type="button"
          className={copied ? "assistant-code-copy copied" : "assistant-code-copy"}
          disabled={!canCopy}
          onClick={copyCode}
          aria-label={copied ? "Copied" : `Copy ${language} code`}
          title={canCopy ? (copied ? "Copied" : "Copy") : "Copy unavailable until code block completes"}
        >
          <Copy size={13} />
          {copied && (
            <span className="assistant-code-copy-check" aria-hidden="true">
              <Check size={9} strokeWidth={3} />
            </span>
          )}
        </button>
      </figcaption>
      <pre>
        <code>
          <SyntaxHighlightedCode code={code} />
        </code>
      </pre>
    </figure>
  );
}

function formatThinkingSeconds(value: number | undefined) {
  if (value === undefined) return undefined;
  if (value < 10) return value.toFixed(1);
  return Math.round(value).toString();
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

function ResponseProgressChecklist({ progress }: { progress: VisibleAnswerProgress }) {
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
    <section className="assistant-response-progress" role="status" aria-live="polite" aria-label={statusText}>
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
      {(debugFacts.length > 0 || chunkFacts.length > 0 || (progress.debugEvents?.length ?? 0) > 0) && (
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
  onAnswerNow,
  onContinueThinking,
  onStop,
}: {
  response: ResponseItem;
  onAnswerNow: (responseId: string) => void;
  onContinueThinking: (responseId: string) => void;
  onStop: (responseId: string) => void;
}) {
  const [continuedAt, setContinuedAt] = useState<number | null>(null);
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

  if (!hasThinking) return null;

  const liveElapsed =
    response.thinkingStartedAt && thinkingRunning
      ? Math.max(0, (now - Date.parse(response.thinkingStartedAt)) / 1000)
      : response.elapsedThinkingSeconds;
  const elapsedLabel = formatThinkingSeconds(liveElapsed);
  const label = thinkingRunning
    ? showGuardControls
      ? "Still thinking..."
      : elapsedLabel
      ? `Thinking for ${elapsedLabel} seconds`
      : "Thinking..."
    : elapsedLabel
      ? `Thought for ${elapsedLabel} seconds`
      : "Thought";

  return (
    <section className="thinking-panel">
      <div className="thinking-panel-toggle" aria-label={label}>
        <Lightbulb size={13} />
        <span>{label}</span>
      </div>
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
  onCopyCode,
}: {
  markdown: string;
  onCopyCode: (code: string) => Promise<boolean>;
}) {
  return (
    <>
      {parseAssistantMarkdown(markdown).map((block, index) => {
        if (block.kind === "paragraph") {
          return (
            <p key={`paragraph-${index}`}>
              {renderInlineMarkdown(block.text, `paragraph-${index}`)}
            </p>
          );
        }
        if (block.kind === "heading") {
          const Heading = `h${block.level}` as keyof JSX.IntrinsicElements;
          return (
            <Heading className="assistant-markdown-heading" key={`heading-${index}`}>
              {renderInlineMarkdown(block.text, `heading-${index}`)}
            </Heading>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List className="assistant-markdown-list" key={`list-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}-${item}`}>
                  {renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}
                </li>
              ))}
            </List>
          );
        }
        if (block.kind === "table") {
          return (
            <div className="assistant-markdown-table-wrap" key={`table-${index}`}>
              <table className="assistant-markdown-table">
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th
                        key={`${headerIndex}-${header}`}
                        style={
                          block.align[headerIndex]
                            ? { textAlign: block.align[headerIndex] }
                            : undefined
                        }
                      >
                        {renderInlineMarkdown(header, `table-${index}-header-${headerIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {block.headers.map((_, cellIndex) => (
                        <td
                          key={`${rowIndex}-${cellIndex}`}
                          style={
                            block.align[cellIndex]
                              ? { textAlign: block.align[cellIndex] }
                              : undefined
                          }
                        >
                          {renderInlineMarkdown(
                            row[cellIndex] ?? "",
                            `table-${index}-${rowIndex}-${cellIndex}`
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <CodeBlock
            key={`code-${index}`}
            language={block.language}
            code={block.code}
            closed={block.closed}
            onCopyCode={onCopyCode}
          />
        );
      })}
    </>
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
      >
        <span>
          {referenceLabelForMode(
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
        >
          <span>{referenceLabelForMode(link, link.referenceDisplayMode ?? "title")}</span>
        </button>
      ))}
      {remainingReferences.length > 0 && text ? " " : ""}
      {rendered}
    </>
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

function ChatTranscript({
  transcriptRef,
  conversation,
  responses,
  onLink,
  onLoom,
  onToggleSuggestedBookmark,
  bookmarkedPaths,
  forkRecords,
  onSelectionAsk,
  responseTitleOverrides,
  onOpenContextMenu,
  onCopyAddress,
  onCopyAddressWithToast,
  onCopyResponse,
  onCopyPrompt,
  onCopyCode,
  onOpenReference,
  onReturnToOrigin,
  highlightedResponseId,
  onTranscriptScroll,
  generatingResponseId,
  completionActionRevealResponseId,
  onAnswerNowFromThinking,
  onContinueThinking,
  onStopThinking,
  onContinueTruncatedResponse,
  onEditPrompt,
  onRegenerateFromPrompt,
}: {
  transcriptRef?: (node: HTMLElement | null) => void;
  conversation?: Conversation;
  responses: ResponseItem[];
  onLink: (link: LoomLink) => void;
  onLoom: (response: ResponseItem) => void;
  onToggleSuggestedBookmark: (link: LoomLink) => void;
  bookmarkedPaths: Set<string>;
  forkRecords: ForkRecord[];
  onSelectionAsk: (response: ResponseItem) => void;
  responseTitleOverrides: Record<string, string>;
  onOpenContextMenu: (event: React.MouseEvent, response: ResponseItem) => void;
  onCopyAddress: (link: Pick<LoomLink, "path" | "canonicalUri">) => void;
  onCopyAddressWithToast: (link: Pick<LoomLink, "path" | "canonicalUri">) => void;
  onCopyResponse: (response: ResponseItem) => void;
  onCopyPrompt: (promptText: string) => void;
  onCopyCode: (code: string) => Promise<boolean>;
  onOpenReference: (link: LoomLink) => string | null;
  onReturnToOrigin?: () => void;
  highlightedResponseId?: string | null;
  onTranscriptScroll?: (event: React.UIEvent<HTMLElement>) => void;
  generatingResponseId?: string | null;
  completionActionRevealResponseId?: string | null;
  onAnswerNowFromThinking: (responseId: string) => void;
  onContinueThinking: (responseId: string) => void;
  onStopThinking: (responseId: string) => void;
  onContinueTruncatedResponse: (responseId: string) => void;
  onEditPrompt: (loomId: string, responseId: string, nextPrompt: string) => Promise<boolean>;
  onRegenerateFromPrompt: (loomId: string, responseId: string) => void;
}) {
  const [sentReferenceHint, setSentReferenceHint] = useState<{
    link: LoomLink;
    x: number;
    y: number;
  } | null>(null);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptEditDraft, setPromptEditDraft] = useState("");
  const sentReferenceHintCloseTimerRef = useRef<number | null>(null);

  function clearSentReferenceHintCloseTimer() {
    if (sentReferenceHintCloseTimerRef.current === null) return;
    window.clearTimeout(sentReferenceHintCloseTimerRef.current);
    sentReferenceHintCloseTimerRef.current = null;
  }

  function showSentReferenceHint(link: LoomLink, target: HTMLElement) {
    clearSentReferenceHintCloseTimer();
    const rect = target.getBoundingClientRect();
    const popoverWidth = Math.min(340, window.innerWidth - 24);
    const x = Math.min(
      Math.max(12, rect.left + rect.width / 2 - popoverWidth / 2),
      window.innerWidth - popoverWidth - 12
    );
    const y = Math.min(rect.bottom + 8, window.innerHeight - 96);
    setSentReferenceHint({ link, x, y });
  }

  function scheduleSentReferenceHintClose() {
    clearSentReferenceHintCloseTimer();
    sentReferenceHintCloseTimerRef.current = window.setTimeout(() => {
      sentReferenceHintCloseTimerRef.current = null;
      setSentReferenceHint(null);
    }, 140);
  }

  if (!conversation) {
    return (
      <section
        className="chat-transcript empty-transcript"
        ref={transcriptRef}
        onScroll={onTranscriptScroll}
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
    <section
      className="chat-transcript"
      ref={transcriptRef}
      aria-label="Conversation transcript"
      onScroll={onTranscriptScroll}
    >
      <div className="conversation-context">
        <div className="conversation-address-row">
          {conversation.meta?.code && (
            <AddressMetadataBadge
              link={loomSurfaceLink}
              className="metadata-code-badge loom-code-badge"
              testId={`loom-code-${conversation.id}`}
              showHint={false}
              onContextMenu={(event, link) => {
                event.preventDefault();
                event.stopPropagation();
                onCopyAddressWithToast(link);
              }}
            >
              {conversation.meta.code}
            </AddressMetadataBadge>
          )}
        </div>
        <div className="conversation-context-title-row">
          <h1>{conversation.title}</h1>
          {onReturnToOrigin && (
            <Tooltip label="Return to Origin">
              <button
                className="link-chip return-origin-chip"
                onClick={onReturnToOrigin}
                aria-label="Return to Origin"
              >
                <CornerDownLeft size={13} />
              </button>
            </Tooltip>
          )}
        </div>
        <p>{conversation.summary}</p>
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
          (index === 0 || currentDayKey !== previousDayKey);
        const isBookmarkedResponse =
          displayResponse.bookmarked ||
          bookmarkedPaths.has(displayResponse.address) ||
          (displayResponse.meta?.canonicalUri
            ? bookmarkedPaths.has(displayResponse.meta.canonicalUri)
            : false);
        const hasExistingWeft = forkRecords.some(
          (record) =>
            record.parentConversationId === conversation.id &&
            record.parentResponseId === displayResponse.id
        );
        const isGeneratingResponse = displayResponse.id === generatingResponseId;
        const revealCompletionActions =
          displayResponse.id === completionActionRevealResponseId;
        const responseAnswerText = displayResponse.answer.join("\n\n").trim();
        const thinkingBeforeFinalAnswer =
          displayResponse.thinkingStartedAt &&
          !displayResponse.finalStartedAt &&
          !responseAnswerText;
        const showResponseProgress =
          isGeneratingResponse &&
          Boolean(displayResponse.visibleProgress) &&
          !thinkingBeforeFinalAnswer;
        const responseLink: LoomLink = {
          id: displayResponse.id,
          type: "response",
          title: displayResponse.title,
          path: displayResponse.address,
          badge: typeLabel.response,
          canonicalUri: displayResponse.meta?.canonicalUri,
          meta: displayResponse.meta,
          referenceCode: displayResponse.meta?.code,
        };
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
            <div className="user-turn">
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
                      rows={Math.min(Math.max(promptEditDraft.split("\n").length, 2), 8)}
                    />
                    <div className="prompt-edit-actions">
                      <button
                        type="button"
                        onClick={() => {
                          void onEditPrompt(conversation.id, displayResponse.id, promptEditDraft).then(
                            (updated) => {
                              if (!updated) return;
                              setEditingPromptId(null);
                              setPromptEditDraft("");
                            }
                          );
                        }}
                        disabled={!promptEditDraft.trim()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPromptId(null);
                          setPromptEditDraft("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p>
                    <UserPromptContent
                      text={cleanPromptText}
                      references={inlinePromptReferences}
                      onOpenReference={onOpenReference}
                      onReferenceHint={showSentReferenceHint}
                      onReferenceHintClose={scheduleSentReferenceHintClose}
                    />
                  </p>
                )}
              </div>
              {!isEditingPrompt && (
                <div className="user-prompt-actions" aria-label="Prompt actions">
                  <Tooltip label="Copy prompt" placement="bottom-right">
                    <button
                      type="button"
                      className="prompt-action-button prompt-copy-trigger"
                      aria-label={`Copy prompt: ${displayResponse.title}`}
                      data-testid={`copy-prompt-${displayResponse.id}`}
                      onClick={() => onCopyPrompt(cleanPromptText)}
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
                        setPromptEditDraft(cleanPromptText);
                      }}
                    >
                      <Edit3 size={16} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>

            <div className="assistant-message">
              {displayResponse.meta?.code && !isGeneratingResponse && (
                <div className="response-metadata-row">
                  <AddressMetadataBadge
                    link={responseLink}
                    className="metadata-code-badge loom-code-badge response-code-badge"
                    testId={`response-code-${displayResponse.id}`}
                    showHint={false}
                    onContextMenu={(event, link) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onCopyAddressWithToast(link);
                    }}
                  >
                    {displayResponse.meta.code}
                  </AddressMetadataBadge>
                </div>
              )}
              {isBookmarkedResponse && (
                <div className="assistant-header">
                  <div>
                    <div className="semantic-title">{displayResponse.title}</div>
                    <div className="loom-address">{displayResponse.address}</div>
                  </div>
                </div>
              )}
              {!isGeneratingResponse && (
                <ResponseActions
                  response={displayResponse}
                  onOpenContextMenu={onOpenContextMenu}
                  reveal={revealCompletionActions}
                />
              )}
              <div className="assistant-body">
                {showResponseProgress && displayResponse.visibleProgress && (
                  <ResponseProgressChecklist progress={displayResponse.visibleProgress} />
                )}
                <ThinkingPanel
                  response={displayResponse}
                  onAnswerNow={onAnswerNowFromThinking}
                  onContinueThinking={onContinueThinking}
                  onStop={onStopThinking}
                />
                <ResponseContent
                  markdown={responseMarkdownSource(displayResponse)}
                  onCopyCode={onCopyCode}
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
                    aria-label={`Copy response: ${displayResponse.title}`}
                  >
                    <Copy size={13} />
                  </button>
                </Tooltip>
                <Tooltip label="Bookmark" placement="bottom-right">
                  <button
                    className={isBookmarkedResponse ? "link-chip response-bookmark-chip bookmarked" : "link-chip response-bookmark-chip"}
                    onClick={() => onToggleSuggestedBookmark(toLinkFromResponse(displayResponse))}
                    aria-pressed={isBookmarkedResponse}
                    aria-label={isBookmarkedResponse ? `Remove bookmark for ${displayResponse.title}` : `Bookmark suggested ${displayResponse.title}`}
                  >
                    <Bookmark size={13} fill={isBookmarkedResponse ? "currentColor" : "none"} />
                  </button>
                </Tooltip>
                <AddressMetadataBadge
                  as="button"
                  link={responseLink}
                  className="link-chip response-action-chip response-link-chip"
                  title="Link"
                  onClick={() => onLink(toLinkFromResponse(displayResponse))}
                  testId={`response-link-${displayResponse.id}`}
                  ariaLabel={`Link ${displayResponse.title}`}
                  onCopy={onCopyAddress}
                >
                  <Link2 size={13} />
                </AddressMetadataBadge>
                <Tooltip label={hasExistingWeft ? "Open Weft" : "Start Weft"} placement="bottom-right">
                  <button
                    className={
                      hasExistingWeft
                        ? "link-chip response-action-chip response-weft-chip is-wefted"
                        : "link-chip response-action-chip response-weft-chip"
                    }
                    onClick={() => onLoom(displayResponse)}
                    aria-pressed={hasExistingWeft}
                    aria-label={
                      hasExistingWeft
                        ? `Open Weft from ${displayResponse.title}`
                        : `Start Weft from ${displayResponse.title}`
                    }
                  >
                    <GitFork size={13} />
                  </button>
                </Tooltip>
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
          }}
          onEnter={clearSentReferenceHintCloseTimer}
          onClose={scheduleSentReferenceHintClose}
          onCopy={onCopyAddress}
        />
      )}
    </section>
  );
}

function ResponseActions({
  response,
  onOpenContextMenu,
  reveal = false,
}: {
  response: ResponseItem;
  onOpenContextMenu: (event: React.MouseEvent, response: ResponseItem) => void;
  reveal?: boolean;
}) {
  return (
    <div
      className={reveal ? "response-actions response-completion-reveal" : "response-actions"}
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
  const insertedPathsRef = useRef<Set<string>>(new Set());
  const activeDraftKeyRef = useRef("");
  const historiesRef = useRef<Record<string, ComposerHistoryState>>({});
  const applyingHistoryRef = useRef(false);
  const stoppedRunningSubmitRef = useRef(false);
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
    const maxHeight = lineHeight * 12 + paddingTop + paddingBottom;
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

  useLayoutEffect(() => {
    const raf = window.requestAnimationFrame(resizeEditorToContent);
    return () => window.cancelAnimationFrame(raf);
  });

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
    const groups: ComposerReferenceGroup[] = ["Open Looms", "Responses", "Bookmarks", "History"];
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

  const filteredAttachItems = useMemo(() => {
    const query = attachSearch.trim().toLowerCase();
    const matchingItems = attachContentItems.filter((item) => {
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
    tokenContextMenu,
    tokenRenamePopover,
  ]);

  useEffect(() => () => {
    clearAddressHintTimer();
    clearAddressHintAutoCloseTimer();
  }, []);

  useEffect(() => {
    clearAddressHintAutoCloseTimer();
    if (!addressHint) return;
    addressHintAutoCloseTimerRef.current = window.setTimeout(() => {
      addressHintAutoCloseTimerRef.current = null;
      addressHintTargetRef.current = null;
      setAddressHint(null);
    }, POPOVER_HINT_AUTO_CLOSE_MS);
    return clearAddressHintAutoCloseTimer;
  }, [addressHint?.link.path, addressHint?.x, addressHint?.y]);

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

  function getTokenFromEventTarget(target: EventTarget | null) {
    if (target instanceof HTMLElement) {
      return target.closest<HTMLElement>(".inline-loom-token, .selection-reference-chip");
    }
    if (target instanceof Text) {
      return target.parentElement?.closest<HTMLElement>(
        ".inline-loom-token, .selection-reference-chip"
      ) ?? null;
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
    if (addressHintTimerRef.current !== null && addressHintTargetRef.current === targetKey) {
      return;
    }
    clearAddressHintTimer();
    addressHintTargetRef.current = targetKey;
    addressHintTimerRef.current = window.setTimeout(() => {
      const rect = token.getBoundingClientRect();
      setAddressHint({
        link,
        x: Math.max(8, Math.min(rect.left, window.innerWidth - 360)),
        y: Math.max(8, rect.top - 12),
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
    token.textContent = referenceTokenText(nextLink, referenceDisplayMode);
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
      return Boolean(itemLink && referencesShareIdentity(itemLink, link));
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
      return Boolean(itemLink && referencesShareIdentity(itemLink, link));
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
    closeAddressHint();
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
        itemLink && referencesShareIdentity(itemLink, tokenRenamePopover.link)
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
    token.textContent = referenceTokenText(nextLink, referenceDisplayMode);
    setTokenRenamePopover(null);
    window.requestAnimationFrame(() => commitDraftChange("external-reference"));
  }

  function removeInlineToken(link: LoomLink) {
    removeLinkedReference(link);
    setTokenContextMenu(null);
    setTokenRenamePopover(null);
    closeAddressHint();
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
      closeAddressHint();
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
    const displayLink = withReferenceDisplayDefaults(link, referenceDisplayMode);
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
    if (displayLink.selectedAt) token.dataset.loomSelectedAt = String(displayLink.selectedAt);
    if (displayLink.targetObjectId) token.dataset.loomTargetObjectId = displayLink.targetObjectId;
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
    token.title = toLoomMarkdown(displayLink);
    token.textContent = referenceTokenText(displayLink, referenceDisplayMode);
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
      closeAddressHint();
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

  function linkFromInlineToken(token: HTMLElement): LoomLink | null {
    const path = token.dataset.loomPath;
    const title = token.dataset.loomTitle;
    const type = token.dataset.loomType as LoomObjectType | undefined;
    if (!path || !title || !type) return null;
    return {
      id: token.dataset.loomId ?? path,
      type,
      title,
      path,
      badge: token.dataset.loomBadge,
      selectedAt: token.dataset.loomSelectedAt
        ? Number(token.dataset.loomSelectedAt)
        : undefined,
      targetObjectId: token.dataset.loomTargetObjectId,
      canonicalUri: token.dataset.loomCanonicalUri,
      referenceCode: token.dataset.loomCode,
      referenceDisplayMode:
        token.dataset.loomDisplayMode === "code" ? "code" : "title",
      referenceCustomLabel: token.dataset.loomCustomLabel?.trim() || undefined,
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
    };
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
        link.referenceCustomLabel === other.referenceCustomLabel
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

  function extractDraftFromEditor(): ComposerDraft {
    const editor = editorRef.current;
    if (!editor) return draft;
    const linksByPath = new globalThis.Map<string, LoomLink>();
    draft.links
      .filter(isAttachedQuoteReference)
      .forEach((link) => linksByPath.set(referenceIdentityKey(link), link));
    editor.querySelectorAll<HTMLElement>(".inline-loom-token").forEach((token) => {
      const link = linkFromInlineToken(token);
      if (link) linksByPath.set(referenceIdentityKey(link), link);
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
      resizeEditorToContent();
    }

    let insertedExternalReference = false;
    draftInlineReferences.forEach((link) => {
      if (!insertedPathsRef.current.has(link.path)) {
        insertTokenAtEnd(link);
        insertedExternalReference = true;
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
      window.requestAnimationFrame(() =>
        commitDraftChange(
          insertedExternalReference ? "external-reference" : "reference-remove-dropdown"
        )
      );
      window.requestAnimationFrame(resizeEditorToContent);
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
  }

  function insertTokenAtRange(
    link: LoomLink,
    range: Range,
    intent: ComposerEditIntent = "reference-insert"
  ) {
    const resolvedLink = onResolveReference({
      ...link,
      selectedAt: link.selectedAt ?? Date.now(),
    });
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
    const resolvedLink = onResolveReference({
      ...link,
      selectedAt: link.selectedAt ?? Date.now(),
    });
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
      const attachedAt = Date.now() + next.length;
      next.push({
        id: key,
        name: file.name,
        size: file.size,
        type: file.type || "File",
        lastModified: file.lastModified,
        attachedAt,
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
      draftForSend.links.length > 0 ||
      Boolean(draftForSend.attachments?.length);
    if (!meaningful) return;
    onUserTyping();
    attachedReferences.forEach((link) => onRemoveAttachedReference(link));
    applyDraftSnapshot({ html: "", links: [], attachments: [] });
    const sent = await onSend(draftForSend, { effort: "Medium", mode: modelResponseMode });
    if (!sent && !stoppedRunningSubmitRef.current) applyDraftSnapshot(draftForSend);
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
    const link = linkFromInlineToken(token);
    if (!link) return;
    setLoomDragPayload(event, link);
    event.dataTransfer.setData("application/loom-token-path", link.path);
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

  function handleEditorPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    pendingInputRef.current = {
      inputType: "insertFromPaste",
      replacesSelection: true,
    };
    insertPlainTextAtSelection(text);
    updateMention();
    resizeEditorToContent();
    commitDraftChange("paste");
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
      if (!tokenLink || !referencesShareIdentity(tokenLink, link)) return;
      token.remove();
      insertedPathsRef.current.delete(tokenLink.path);
    });
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
                title={isFragmentReference(link) ? fragmentQuoteText(link) : link.title}
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
            pendingInputRef.current = null;
          }}
          onKeyUp={updateMention}
          onFocus={updateMention}
          onClick={handleEditorClick}
          onContextMenu={handleTokenContextMenu}
          onKeyDown={handleEditorKeyDown}
          onPaste={handleEditorPaste}
          onDragStart={handleEditorDragStart}
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
              transform: "translateY(-100%)",
            }}
            onCopy={onCopyReferenceAddress}
            onClose={closeAddressHint}
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
          {attachPickerOpen && createPortal(
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
            />,
            document.body
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
              />,
              document.body
            )}
          </div>
          <span>Type # to insert Loom references inline.</span>
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
          <button
            className="composer-icon-action"
            aria-label="Voice input"
            title="Voice input"
          >
            <Mic size={15} />
          </button>
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
            const primaryLabel = visibleLinkedReferenceLabel(link);
            const secondaryLabel =
              link.referenceCustomLabel?.trim() && link.referenceCustomLabel.trim() !== link.title
                ? `${link.title} · ${link.path}`
                : link.path;
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
                  <strong>{primaryLabel}</strong>
                  <small>{secondaryLabel}</small>
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

function visibleLinkedReferenceLabel(link: LoomLink) {
  const customLabel = link.referenceCustomLabel?.trim();
  return customLabel || link.title;
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
    return selectedReferenceKeysForLink(item).some((key) => selectedKeys.has(key));
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
        data-testid={`attach-content-row-${item.source}-${item.id}`}
        data-attach-selected={selected ? "true" : "false"}
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
          ? "Weft"
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
      canonicalUri: node.canonicalUri,
      badge: node.type === "loom" ? typeLabel.loom : node.type === "response" ? typeLabel.response : typeLabel.conversation,
      meta: node.meta,
      referenceCode: node.referenceCode,
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
                data-title={node.title}
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
      ? destination.editableTitle
      : destination.title;
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

  return (
    <span
      className={suppressed ? "tooltip-host tooltip-suppressed" : "tooltip-host"}
      data-tooltip={label}
      data-placement={placement}
      onPointerDownCapture={() => setSuppressed(true)}
      onContextMenuCapture={() => setSuppressed(true)}
      onMouseLeave={() => setSuppressed(false)}
      onBlur={() => setSuppressed(false)}
    >
      {children}
    </span>
  );
}

export default App;
