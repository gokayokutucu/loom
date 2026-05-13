import type {
  BookmarkItem,
  Conversation,
  LoomForkRecord,
  LoomGraphRepository,
  LoomLink,
  LoomNavigationDestination,
  LoomResolutionResult,
  ResponseItem,
} from "../types";
import type { LoomEngineClient } from "./LoomEngineClient";
import type { ModelResponseMode } from "../services/appSettings";
import type { LoomGraphProjection } from "../services/loomGraphProjection";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface EngineHealth {
  status: "ready" | "degraded" | "unavailable";
  runtime: "typescript-local" | "rust-sidecar";
  version?: string;
  serviceUrl?: string;
  message?: string;
}

export interface ServiceHealthStatus {
  status: "ready" | "degraded" | "unavailable";
  runtime: "typescript-local" | "rust-service";
  version?: string;
  database?: { status: string };
  config?: { status: string; path?: string };
  providers?: {
    ollama?: {
      status?: string;
      baseUrl?: string;
      version?: string;
      security?: {
        localOnly?: boolean;
        remoteAllowed?: boolean;
        networkExposureRisk?: string;
        versionStatus?: string;
        minimumRecommendedVersion?: string;
        warnings?: string[];
      };
    };
  };
  serviceUrl?: string;
  lastCheckedAt?: string;
  error?: string;
}

export interface ServiceConfigStatus {
  status: "ready" | "missing" | "invalid" | "unavailable";
  path?: string;
  restartRequired?: boolean;
  pendingRestart?: boolean;
  error?: string;
  lastCheckedAt?: string;
}

export interface CapabilitySummary {
  status: "ready" | "unavailable" | "unknown";
  system?: {
    osName?: string;
    arch?: string;
    cpuBrand?: string;
    totalMemoryBytes?: number;
    availableMemoryBytes?: number;
  };
  models?: Array<{
    provider: string;
    modelName: string;
    confidence?: string;
    source?: string;
  }>;
  strategyAvailable?: boolean;
  lastCheckedAt?: string;
  error?: string;
}

export interface LoomSummary {
  loomId: string;
  title: string;
  summary?: string;
  canonicalUri?: string;
  code?: string;
  kind?: "loom" | "weft";
  originLoomId?: string;
  originResponseId?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: JsonValue;
}

export interface LoomDetail extends LoomSummary {
  responses: ResponseItem[];
}

export interface CreateLoomInput {
  loomId?: string;
  title?: string;
  summary?: string;
  kind?: "loom" | "weft";
  originLoomId?: string;
  originResponseId?: string;
  canonicalUri?: string;
  code?: string;
  metadata?: JsonValue;
  firstPrompt?: string;
}

export interface CreateLoomResult {
  loom: LoomSummary;
}

export interface RenameLoomInput {
  loomId: string;
  title: string;
}

export interface UpdateLoomInput {
  loomId: string;
  title?: string;
  summary?: string;
  canonicalUri?: string;
  code?: string;
  metadata?: JsonValue;
}

export interface UpdateResponseInput {
  responseId: string;
  content?: string;
  metadata?: JsonValue;
  editReason?: "user_prompt_edit";
  markDownstreamStale?: boolean;
}

export interface UpdatedResponse {
  responseId: string;
  loomId: string;
  role: "user" | "assistant";
  content: string;
  updatedAt: string;
  metadata?: JsonValue;
}

export interface StaleResponseResult {
  responseId: string;
  role: "assistant";
  stale: boolean;
  staleReason: "prompt_edited";
}

export interface UpdateResponseResult {
  response: UpdatedResponse;
  staleResponses: StaleResponseResult[];
}

export interface SendMessageInput {
  loomId: string;
  draftKey?: string;
  promptText: string;
  references: LoomLink[];
  attachments?: JsonValue[];
  responseMode: ModelResponseMode;
  focusedResponseId?: string;
  source: "composer" | "graph" | "ask" | "weft";
  model?: string;
  options?: {
    numCtx?: number;
    numPredict?: number;
    temperature?: number;
  };
  persistWorkflow?: boolean;
  signal?: AbortSignal;
}

export interface RegenerateFromResponseInput {
  loomId: string;
  userResponseId: string;
  staleAssistantResponseId?: string;
  responseMode: ModelResponseMode;
  source?: "prompt_edit_regenerate";
  model?: string;
  options?: {
    numCtx?: number;
    numPredict?: number;
    temperature?: number;
  };
  signal?: AbortSignal;
}

export interface CancelMessageInput {
  loomId?: string;
  responseId?: string;
  workflowRunId: string;
  reason?: string;
}

export interface CancelMessageResult {
  status: "cancelled" | "not_found" | "already_completed" | "failed";
  workflowRunId: string;
  responseId?: string;
  error?: string;
}

export type QuickAskIntent =
  | "acronym_expansion"
  | "definition"
  | "translation"
  | "explain_this"
  | "relation_to_source"
  | "how_it_works"
  | "unknown";

export interface QuickAskTurn {
  question: string;
  answer: string;
}

export interface QuickAskSourceContext {
  title?: string;
  responseCode?: string;
  canonicalUri?: string;
  summary?: string;
  keyPoints?: string[];
  keywords?: string[];
  entities?: string[];
}

export interface QuickAskInput {
  sessionId: string;
  sourceLoomId?: string;
  sourceResponseId?: string;
  selectedText?: string;
  sourceContext?: QuickAskSourceContext;
  turns: QuickAskTurn[];
  question: string;
  intent: QuickAskIntent;
  options?: {
    model?: string;
    numCtx?: number;
    numPredict?: number;
  };
}

export interface QuickAskResult {
  answer: string;
  model?: string;
  warnings: string[];
}

export type EngineResponseEvent =
  | { type: "status"; payload: { message: string; stage?: string } }
  | {
      type: "user_message_created";
      payload: { loomId: string; responseId: string; workflowRunId?: string };
    }
  | {
      type: "assistant_placeholder_created";
      payload: { loomId: string; responseId: string; workflowRunId?: string };
    }
  | { type: "answer_plan_ready"; payload: { plan: JsonValue } }
  | { type: "context_ready"; payload: { contextBlockCount: number; numCtx?: number } }
  | {
      type: "thinking_status";
      payload: {
        status: "started" | "running" | "stalled" | "stopped" | "completed";
        durationMs?: number;
      };
    }
  | { type: "content_delta"; payload: { responseId: string; delta: string } }
  | { type: "response_completed"; payload: { responseId: string; doneReason?: string } }
  | { type: "response_truncated"; payload: { responseId: string; doneReason?: string } }
  | {
      type: "response_cancelled";
      payload: { responseId?: string; message?: string; workflowRunId?: string };
    }
  | {
      type: "response_error";
      payload: { responseId?: string; message: string; code?: string; workflowRunId?: string };
    };

export interface CreateOrOpenWeftInput {
  originLoomId: string;
  originResponseId: string;
  title?: string;
  summary?: string;
  reuseExisting?: boolean;
  source?: "response_action" | "quick_ask_convert" | "graph_node" | "reference";
  seedMode?: "none" | "origin_qa_pair" | "quick_ask_turns";
  createOriginContextSnapshot?: boolean;
  metadata?: JsonValue;
}

export interface VisibleWeftSeedResponse {
  responseId: string;
  role: "user" | "assistant";
  content: string;
  title?: string;
  sequenceIndex: number;
  copiedFromResponseId?: string;
}

export interface CreateOrOpenWeftResult {
  loomId: string;
  created: boolean;
  reused?: boolean;
  weft?: LoomSummary;
  visibleSeedResponses?: VisibleWeftSeedResponse[];
  originContextSnapshotId?: string;
  warnings?: string[];
  navigationDestination: LoomNavigationDestination;
}

export interface PersistWeftTurnInput {
  id?: string;
  question: string;
  answer: string;
  createdAt?: string;
  metadata?: JsonValue;
}

export interface PersistWeftTurnsInput {
  weftLoomId: string;
  originLoomId: string;
  originResponseId: string;
  selectedText?: string;
  fragmentHash?: string;
  sourceMetadata?: JsonValue;
  turns: PersistWeftTurnInput[];
}

export interface PersistedWeftTurn {
  userResponseId: string;
  assistantResponseId: string;
  question: string;
  answer: string;
  sequenceIndex: number;
}

export interface PersistWeftTurnsResult {
  weftLoomId: string;
  responses: PersistedWeftTurn[];
  originContextSnapshotId?: string;
  warnings?: string[];
}

export interface AddReferenceInput {
  loomId: string;
  reference: LoomLink;
  sourceResponseId?: string;
  metadata?: JsonValue;
}

export interface AddReferenceResult {
  reference: LoomLink;
  reused?: boolean;
}

export interface RemoveReferenceInput {
  loomId: string;
  referenceId: string;
}

export interface OpenReferenceInput {
  reference: LoomLink;
}

export interface GetReferenceInput {
  referenceId: string;
}

export interface ListReferencesInput {
  loomId?: string;
  responseId?: string;
}

export interface ListReferencesResult {
  references: LoomLink[];
}

export interface SuggestReferencesInput {
  loomId: string;
  responseId?: string;
  draftText?: string;
  limit?: number;
}

export interface ReferenceSuggestionResult {
  reference: LoomLink;
  score: number;
  reason?: string;
}

export interface SuggestReferencesResult {
  suggestions: ReferenceSuggestionResult[];
}

export interface BookmarkResponseInput {
  loomId: string;
  responseId: string;
}

export interface BookmarkResult {
  bookmark: BookmarkItem;
  reused?: boolean;
}

export interface CreateBookmarkInput {
  targetKind: "loom" | "response" | "weft" | "fragment" | "external";
  targetId?: string;
  targetUri?: string;
  title: string;
  metadata?: JsonValue;
}

export interface DeleteBookmarkInput {
  bookmarkId: string;
}

export interface GetBookmarkInput {
  bookmarkId: string;
}

export interface ListBookmarksResult {
  bookmarks: BookmarkItem[];
}

export interface GetBookmarkForTargetInput {
  targetKind: "loom" | "response" | "weft" | "fragment" | "external";
  targetId?: string;
  targetUri?: string;
}

export interface ResolveAddressInput {
  address: string;
}

export type ResolveAddressResult = LoomResolutionResult;

export interface GraphProjectionInput {
  conversations: Conversation[];
  responsesByConversation: Record<string, ResponseItem[]>;
  forkRecords: LoomForkRecord[];
  activeLoomId?: string;
  focusedResponseId?: string;
  expandedNodeIds?: string[];
  bookmarkedResponseAddresses?: string[];
}

export type GraphProjectionResult = LoomGraphProjection;

export interface ExportLoomInput {
  loomId: string;
  format: "markdown" | "csv" | "json" | "zip";
  includeMetadata?: boolean;
  includeReferences?: boolean;
  includeBookmarks?: boolean;
  includeGraph?: boolean;
}

export interface ExportResponseInput {
  responseId: string;
  format: "markdown" | "json";
  includeMetadata?: boolean;
  includeReferences?: boolean;
}

export interface ExportLoomResult {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  warnings: string[];
  fallbackUsed?: boolean;
  fallbackReason?: string;
}

export interface TypeScriptLocalLoomEngineDependencies {
  graphRepository?: LoomGraphRepository;
  sendMessage?: (input: SendMessageInput) => AsyncIterable<EngineResponseEvent>;
  regenerateFromResponse?: (
    input: RegenerateFromResponseInput
  ) => AsyncIterable<EngineResponseEvent>;
  quickAsk?: (input: QuickAskInput) => Promise<QuickAskResult>;
  createOrOpenWeft?: (input: CreateOrOpenWeftInput) => Promise<CreateOrOpenWeftResult>;
  persistWeftTurns?: (input: PersistWeftTurnsInput) => Promise<PersistWeftTurnsResult>;
  updateResponse?: (input: UpdateResponseInput) => Promise<UpdateResponseResult>;
  addReference?: (input: AddReferenceInput) => Promise<AddReferenceResult>;
  removeReference?: (input: RemoveReferenceInput) => Promise<void>;
  getReference?: (input: GetReferenceInput) => Promise<AddReferenceResult>;
  listReferences?: (input: ListReferencesInput) => Promise<ListReferencesResult>;
  suggestReferences?: (input: SuggestReferencesInput) => Promise<SuggestReferencesResult>;
  createBookmark?: (input: CreateBookmarkInput) => Promise<BookmarkResult>;
  deleteBookmark?: (input: DeleteBookmarkInput) => Promise<void>;
  getBookmark?: (input: GetBookmarkInput) => Promise<BookmarkResult>;
  listBookmarks?: () => Promise<ListBookmarksResult>;
  getBookmarkForTarget?: (input: GetBookmarkForTargetInput) => Promise<BookmarkResult>;
  bookmarkResponse?: (input: BookmarkResponseInput) => Promise<BookmarkResult>;
  exportLoom?: (input: ExportLoomInput) => Promise<ExportLoomResult>;
  exportResponse?: (input: ExportResponseInput) => Promise<ExportLoomResult>;
}

export type LoomEngineMode = "typescript-local" | "rust-service";

export interface RustHttpLoomEngineClientOptions {
  serviceUrl: string;
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
}

export interface CreateLoomEngineClientOptions {
  mode?: LoomEngineMode;
  serviceUrl?: string;
  strictRustService?: boolean;
  serviceAddressStoreAuthoritative?: boolean;
  serviceGraphStoreAuthoritative?: boolean;
  serviceExportStoreAuthoritative?: boolean;
  rustClient?: LoomEngineClient;
  localDependencies?: TypeScriptLocalLoomEngineDependencies;
}
