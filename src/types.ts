import type { LucideIcon } from "lucide-react";

export type LoomObjectType =
  | "conversation"
  | "loom"
  | "response"
  | "fragment"
  | "bookmark"
  | "semantic"
  | "recent";

export type LoomObjectKind =
  | "conversation"
  | "response"
  | "quick_question"
  | "bookmark"
  | "fragment"
  | "reference_mention";

export type LoomWindowType =
  | "conversation"
  | "loom"
  | "reference"
  | "time"
  | "context"
  | "lineage";

export type LoomGraphEdgeType =
  | "contains"
  | "references"
  | "forked_from"
  | "derived_from"
  | "bookmarked_as"
  | "promoted_from"
  | "anchored_to"
  | "mentions";

export type LoomObjectStatus = "active" | "archived" | "deleted" | "unreachable";

export type LoomResolutionStatus =
  | "resolved"
  | "alias_resolved"
  | "missing"
  | "not_found"
  | "deleted"
  | "invalid"
  | "alias_stale"
  | "snapshot_missing"
  | "window_invalid"
  | "broken_reference";

export interface LoomAddressSelector {
  revision?: number;
  snapshot?: string;
  view?: LoomWindowType;
  window?: LoomWindowType;
  fragment?: string;
}

export interface LoomAddressParseResult {
  raw: string;
  kind: "canonical" | "alias";
  objectKind?: LoomObjectKind;
  objectId?: string;
  aliasUri?: string;
  selector: LoomAddressSelector;
}

export interface LoomResolvedObject {
  objectId: string;
  kind: LoomObjectKind;
  status: LoomObjectStatus;
  title: string;
  canonicalUri: string;
  aliasUri?: string;
  targetObjectId?: string;
}

export interface LoomAliasRecord {
  aliasUri: string;
  targetObject: LoomResolvedObject;
  isActive: boolean;
  replacementAliasUri?: string;
}

export interface LoomResolutionResult {
  status: LoomResolutionStatus;
  parsed: LoomAddressParseResult;
  object?: LoomResolvedObject;
  targetObject?: LoomResolvedObject;
  canonicalUri?: string;
  aliasUri?: string;
  staleAliasReplacement?: string;
  destination?: LoomNavigationDestination;
  fallbackReason?:
    | "service_missing_non_authoritative"
    | "service_unavailable"
    | "request_failed"
    | "timeout"
    | "unsupported_method"
    | "invalid_response";
  serviceResolutionStatus?: LoomResolutionStatus;
  serviceAddressStoreAuthoritative?: boolean;
  reason?: string;
}

export interface LoomNavigationDestination {
  loomId: string;
  mode: "full" | "split";
  originLoomId?: string;
  originResponseId?: string;
  scrollTargetResponseId?: string;
  scrollMode?: "origin" | "lastResponse" | "exact";
  source:
    | "userNavigation"
    | "addressBar"
    | "weftCreate"
    | "returnToOrigin"
    | "backForward";
}

export interface LoomGraphEdge {
  edgeId: string;
  fromObjectId: string;
  toObjectId: string;
  edgeType: LoomGraphEdgeType;
}

export interface LoomWindowProjection {
  windowType: LoomWindowType;
  anchorObjectId: string;
  objectIds: string[];
}

export type LoomLedgerEventType =
  | "bookmark_created"
  | "address_created"
  | "alias_created"
  | "alias_updated"
  | "alias_retired"
  | "fork_created"
  | "reference_mention_created"
  | "fragment_created"
  | "object_archived"
  | "object_deleted"
  | "broken_reference_detected"
  | "revision_created";

export interface LoomLedgerEvent {
  ledgerEventId: string;
  eventType: LoomLedgerEventType;
  objectId?: string;
  relatedObjectId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface LoomReferenceMentionRecord {
  mentionId: string;
  objectId: string;
  sourceConversationId: string;
  targetObjectId: string;
  sourcePath: string;
  targetPath: string;
  createdAt: string;
}

export interface LoomBookmarkPromotionResult {
  bookmark: BookmarkItem;
  bookmarkObject: LoomResolvedObject;
  targetObject: LoomResolvedObject;
  ledgerEvents: LoomLedgerEvent[];
}

export interface LoomGraphRepository {
  findByObjectId(objectId: string): LoomResolvedObject | undefined;
  findByCanonicalUri(uri: string): LoomResolvedObject | undefined;
  findByAliasUri(uri: string): LoomResolvedObject | undefined;
  resolveAliasUri(uri: string): LoomAliasRecord | undefined;
  findPrimaryAlias(objectId: string): string | undefined;
  findBookmarkByTargetObjectId(objectId: string): LoomResolvedObject | undefined;
  findBookmarkByUri(uri: string): LoomResolvedObject | undefined;
  findRevision(objectId: string, revision: number): boolean;
  findSnapshot(objectId: string, snapshot: string): boolean;
  supportsWindow(objectId: string, windowType: LoomWindowType): boolean;
  getLineage(objectId: string): LoomResolvedObject[];
  getDescendants(objectId: string): LoomResolvedObject[];
  getReferenceNeighborhood(objectId: string): LoomGraphEdge[];
  getWindowProjection(objectId: string, windowType: LoomWindowType): LoomWindowProjection | undefined;
}

export interface LoomGraphMutationRepository extends LoomGraphRepository {
  promoteBookmark(link: LoomLink): LoomBookmarkPromotionResult;
  registerAliasUri(input: {
    aliasUri: string;
    targetObjectId: string;
    replacementAliasUri?: string;
  }): LoomLedgerEvent;
  createReferenceMention(input: {
    sourceConversationId: string;
    sourcePath: string;
    target: LoomLink;
  }): LoomReferenceMentionRecord | undefined;
  emitBrokenReference(target: LoomLink, reason: string): LoomLedgerEvent;
  getLedgerEvents(): LoomLedgerEvent[];
}

export interface LoomMetadata {
  id: string;
  code?: string;
  displayCode?: string;
  title: string;
  canonicalUri?: string;
  keywords: string[];
  summary: string;
  usageCount: number;
  status: "draft" | "addressable";
}

export type ReferenceDisplayMode = "title" | "code";

export interface Conversation {
  id: string;
  title: string;
  path: string;
  folder: string;
  summary: string;
  meta?: LoomMetadata;
  iconKey?: string;
  iconColor?: string;
  pinned?: boolean;
  unread?: boolean;
}

export interface LoomForkRecord {
  id: string;
  parentConversationId: string;
  parentResponseId: string;
  childConversationId: string;
  title: string;
  kind?: "exploration" | "revision";
  revisionSourceResponseId?: string;
}

export interface LoomLink {
  id: string;
  type: LoomObjectType;
  title: string;
  path: string;
  badge?: string;
  selectedAt?: number;
  targetObjectId?: string;
  canonicalUri?: string;
  meta?: LoomMetadata;
  referenceCode?: string;
  referenceDisplayMode?: ReferenceDisplayMode;
  referenceCustomLabel?: string;
  referenceOccurrenceIndex?: number;
  referenceMentionId?: string;
  resolutionStatus?: LoomResolutionStatus;
  sourceLoomId?: string;
  sourceResponseId?: string;
  selectedText?: string;
  sourceResponseCode?: string;
  sourceResponseTitle?: string;
  sourceCanonicalUri?: string;
  fragmentHash?: string;
  createdAt?: number;
}

export type VisibleAnswerTaskStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export type VisibleAnswerStage =
  | "orchestration"
  | "context"
  | "references"
  | "planning"
  | "generation"
  | "finalizing";

export interface VisibleAnswerTask {
  id: string;
  title: string;
  status: VisibleAnswerTaskStatus;
  stage: VisibleAnswerStage;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface VisibleAnswerDebugEvent {
  id: string;
  label: string;
  detail?: string;
  createdAt: number;
  elapsedMs: number;
}

export interface VisibleAnswerDebugState {
  startedAt: number;
  model?: string;
  responseMode?: string;
  think?: boolean;
  numCtx?: number;
  numPredict?: number;
  outputBudget?: string;
  referenceCount?: number;
  contextMessageCount?: number;
  targetLoomId?: string;
  targetResponseId?: string;
  finalChunkCount?: number;
  finalCharCount?: number;
  lastChunkAt?: number;
}

export interface VisibleAnswerProgress {
  tasks: VisibleAnswerTask[];
  activeTaskId?: string;
  statusText: string;
  contentOutline?: string[];
  debug?: VisibleAnswerDebugState;
  debugEvents?: VisibleAnswerDebugEvent[];
}

export interface VisibleAnswerPlan {
  id: string;
  source: "quickModel" | "deterministic";
  tasks: VisibleAnswerTask[];
  contentOutline?: string[];
  createdAt: number;
}

export interface ResponseItem {
  id: string;
  title: string;
  address: string;
  question: string;
  createdAt?: string;
  promptEditedAt?: string;
  answerStale?: boolean;
  questionReferences?: LoomLink[];
  answer: string[];
  finalContent?: string;
  thinkingStartedAt?: string;
  thinkingEndedAt?: string;
  finalStartedAt?: string;
  elapsedThinkingSeconds?: number;
  thinkingTimeoutMs?: number;
  doneReason?: string;
  truncated?: boolean;
  outputBudget?: "short" | "medium" | "long" | "extended";
  numPredict?: number;
  workflowRunId?: string;
  serviceUserResponseId?: string;
  thinkingGuardTimedOut?: boolean;
  thinkingStalled?: boolean;
  thinkingStallReason?: string;
  thinkingContinueCount?: number;
  thinkingStopped?: boolean;
  visiblePlan?: VisibleAnswerPlan;
  visibleProgress?: VisibleAnswerProgress;
  askContextCapsuleSnapshot?: unknown;
  askSelectedText?: string;
  askSourceLoomId?: string;
  askSourceResponseId?: string;
  askSourceFragment?: LoomLink;
  suggestedLinks: LoomLink[];
  bookmarkedLinks: LoomLink[];
  bookmarked?: boolean;
  meta?: LoomMetadata;
}

export interface BookmarkItem extends LoomLink {
  lastUsed: string;
  editableTitle: string;
  meta?: LoomMetadata;
}

export interface HistoryEntry extends LoomLink {
  visitedAt: string;
  navigationDestination?: LoomNavigationDestination;
}

export interface TabGroup {
  id: string;
  name: string;
  conversationIds: string[];
  collapsed?: boolean;
  color?: string;
}

export interface AddressSuggestion extends LoomLink {
  subtitle: string;
  iconLabel: string;
}

export interface PanelAction {
  id: string;
  label: string;
  Icon: LucideIcon;
}
