import type {
  BookmarkItem,
  Conversation,
  HistoryEntry,
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

export type SpeechToTextProviderKind =
  | "disabled"
  | "mock_test"
  | "local_command"
  | "openai"
  | "azure_openai";

export type LocalCommandOutputMode = "stdout" | "file";

export interface SpeechToTextRuntimeConfig {
  enabled: boolean;
  defaultProviderKind: SpeechToTextProviderKind;
  allowCloudStt: boolean;
  persistAudio: boolean;
  persistTranscript: boolean;
  maxAudioBytes: number;
  allowedMimeTypes: string[];
  defaultLanguage?: string | null;
  providerProfileId?: string | null;
  localCommandPath?: string | null;
  localCommandArgs: string[];
  localCommandTimeoutMs: number;
  localTempDir?: string | null;
  localCommandOutputMode: LocalCommandOutputMode;
  localCommandTranscriptFileExtension: string;
  warnings: string[];
}

export interface SpeechProviderHealth {
  status:
    | "configured"
    | "missing_command"
    | "command_not_found"
    | "command_not_executable"
    | "invalid_args"
    | "temp_dir_unavailable"
    | "provider_unavailable"
    | "unavailable";
  providerKind: string;
  message: string;
  checks: string[];
}

export interface SpeechSetupBinaryCandidate {
  path: string;
  exists: boolean;
  executable: boolean;
  preferred: boolean;
  source: string;
}

export interface SpeechSetupStatus {
  state: string;
  message: string;
  runningInElectron: boolean;
  installCommand: string;
  detectedBinaryPath?: string | null;
  detectedRuntimeSource: string;
  runtimeVersion?: string | null;
  binaryCandidates: SpeechSetupBinaryCandidate[];
  modelDirectory: string;
  model: {
    name: string;
    path: string;
    exists: boolean;
    sizeBytes?: number | null;
    downloadUrl: string;
  };
  recommendedArgs: string[];
  providerHealth: SpeechProviderHealth;
}

export interface OcrRuntimeConfig {
  enabled: boolean;
  provider: string;
  commandPath?: string | null;
  pdfRasterizerCommandPath?: string | null;
  language: string;
  dpi: number;
  timeoutSeconds: number;
  maxPagesPerFile: number;
  maxImagePixels: number;
  tempDir?: string | null;
}

export interface OcrProviderHealth {
  status: "disabled" | "configured" | "unavailable" | string;
  provider: string;
  enabled: boolean;
  commandPath?: string | null;
  rasterizerCommandPath?: string | null;
  language: string;
  dpi: number;
  message: string;
  warnings: string[];
}

export interface LoomServiceRuntimeConfig {
  speech: SpeechToTextRuntimeConfig;
  ocr?: OcrRuntimeConfig;
  memory?: {
    enabled?: boolean;
    referenceRecentLooms?: boolean;
    referenceSavedMemories?: boolean;
    nickname?: string;
    occupation?: string;
    stylePreferences?: string;
    moreAboutYou?: string;
  };
  providers?: {
    defaultMainModel?: string;
    defaultQuickModel?: string;
  };
  database?: { path?: string };
}

export interface UpdateSpeechToTextConfigInput {
  enabled?: boolean;
  defaultProviderKind?: SpeechToTextProviderKind;
  localCommandPath?: string | null;
  localCommandArgs?: string[];
  localCommandTimeoutMs?: number;
  localTempDir?: string | null;
  localCommandOutputMode?: LocalCommandOutputMode;
  localCommandTranscriptFileExtension?: string;
}

export interface UpdateOcrConfigInput {
  enabled?: boolean;
  provider?: string;
  commandPath?: string | null;
  pdfRasterizerCommandPath?: string | null;
  language?: string;
  dpi?: number;
  timeoutSeconds?: number;
  maxPagesPerFile?: number;
  maxImagePixels?: number;
  tempDir?: string | null;
}

export interface UpdateServiceConfigInput {
  speech?: UpdateSpeechToTextConfigInput;
  ocr?: UpdateOcrConfigInput;
  memory?: {
    enabled?: boolean;
    referenceRecentLooms?: boolean;
    referenceSavedMemories?: boolean;
    nickname?: string;
    occupation?: string;
    stylePreferences?: string;
    moreAboutYou?: string;
  };
  providers?: {
    defaultMainModel?: string;
    defaultQuickModel?: string;
  };
}

export interface ServiceConfigUpdateResult {
  config: LoomServiceRuntimeConfig;
  restartClassification?: {
    restartRequired?: boolean;
    reason?: string | null;
    changedPaths?: string[];
  };
  restartStatus?: {
    restartRequired?: boolean;
    pendingRestart?: boolean;
  };
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

export interface RuntimeModelProviderStatus {
  providerKind: string;
  providerProfileId: string;
  status: string;
  baseUrl?: string;
  version?: string;
  modelsEndpointReachable?: boolean;
  runtimeOwnedBy: string;
  modelStorePath?: string;
  supportsDownloads: boolean;
  supportsStart: boolean;
  supportsStop: boolean;
  warnings: string[];
}

export interface RuntimeModelItem {
  assetId: string;
  providerKind: string;
  providerProfileId?: string | null;
  modelName: string;
  displayName: string;
  installed: boolean;
  status: "available" | "missing" | "installing" | "error" | string;
  localPath?: string | null;
  sizeBytes?: number | null;
  digest?: string | null;
  supportsQuick: boolean;
  supportsMain: boolean;
  supportsThinking: boolean;
  source: string;
}

export interface RuntimeModelDownloadJob {
  jobId: string;
  providerKind: string;
  providerProfileId?: string | null;
  modelName: string;
  status: "queued" | "downloading" | "verifying" | "installed" | "failed" | "cancelled" | string;
  progressPercent: number;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  digest?: string | null;
  error?: string | null;
  cancelRequested: boolean;
  metadataJson?: JsonValue;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface RuntimeModelsResult {
  provider: RuntimeModelProviderStatus;
  models: RuntimeModelItem[];
  jobs: RuntimeModelDownloadJob[];
}

export interface LoomSummary {
  loomId: string;
  title: string;
  summary?: string;
  canonicalUri?: string;
  code?: string;
  displayCode?: string;
  kind?: "loom" | "weft";
  originLoomId?: string;
  originResponseId?: string;
  weftKind?: "exploration" | "revision";
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string;
  metadata?: JsonValue;
}

export interface ListLoomsInput {
  archived?: boolean;
}

export interface LoomDetail extends LoomSummary {
  responses: ResponseItem[];
}

export interface ListHistoryResult {
  history: HistoryEntry[];
}

export interface RecordHistoryInput {
  entry: HistoryEntry;
}

export interface UiStateRecord {
  key: string;
  value: JsonValue;
  updatedAt?: string;
}

export interface GetUiStateInput {
  key: string;
}

export interface SaveUiStateInput {
  key: string;
  value: JsonValue;
}

export interface GetUiStateResult {
  state: UiStateRecord | null;
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

export interface DeleteLoomInput {
  loomId: string;
}

export interface ArchiveLoomInput {
  loomId: string;
}

export interface RestoreLoomInput {
  loomId: string;
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

export type AttachmentParseStatus =
  | "queued"
  | "parsing"
  | "extracting_text"
  | "ocr_needed"
  | "ocr_running"
  | "ready"
  | "failed"
  | "unsupported";

export interface AttachmentItem {
  attachmentId: string;
  loomId: string;
  fileName: string;
  mimeType?: string;
  extension?: string;
  sizeBytes: number;
  kind: string;
  parseStatus: AttachmentParseStatus;
  parser?: string;
  error?: string;
  thumbnailDataUrl?: string;
  parsedCharCount?: number;
  metadataJson?: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAttachmentInput {
  loomId: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
  contentBase64: string;
}

export interface CreateAttachmentResult {
  attachment: AttachmentItem;
}

export interface ListAttachmentsInput {
  loomId: string;
}

export interface ListAttachmentsResult {
  attachments: AttachmentItem[];
}

export interface DeleteAttachmentInput {
  attachmentId: string;
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

export interface RetryUserMessageInput {
  loomId: string;
  userResponseId: string;
  responseMode: ModelResponseMode;
  softDeleteDownstream?: boolean;
  reason?: "retry_from_user_message";
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

export interface GenerationResponseSummary {
  responseId: string;
  loomId: string;
  role: "user" | "assistant";
  content: string;
  sequenceIndex: number;
  status?: string;
  metadata?: JsonValue;
  updatedAt: string;
}

export interface GenerationResponseStateResult {
  workflowRunId: string;
  loomId?: string;
  userResponse?: GenerationResponseSummary;
  assistantResponse?: GenerationResponseSummary;
  status: "pending" | "running" | "completed" | "truncated" | "cancelled" | "failed" | string;
  canResume: boolean;
  liveTailSupported: boolean;
}

export type QuickAskIntent =
  | "acronym_expansion"
  | "definition"
  | "translation"
  | "explain_this"
  | "relation_to_reference"
  | "implementation_in_topic"
  | "how_it_works_with_reference"
  | "relation_to_source"
  | "how_it_works"
  | "usage"
  | "unknown";

export interface QuickAskTurn {
  question: string;
  answer: string;
  title?: string;
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

export interface QuickAskActiveReference {
  referenceId?: string;
  label: string;
  targetKind?: string;
  targetId?: string;
  targetUri?: string;
  selectedText?: string;
  preview?: string;
  sourceResponseId?: string;
}

export interface QuickAskInput {
  sessionId: string;
  quickAskTraceId?: string;
  sourceLoomId?: string;
  sourceResponseId?: string;
  selectedText?: string;
  sourceContext?: QuickAskSourceContext;
  activeReferences?: QuickAskActiveReference[];
  turns: QuickAskTurn[];
  question: string;
  intent: QuickAskIntent;
  options?: {
    model?: string;
    numCtx?: number;
    numPredict?: number;
  };
  signal?: AbortSignal;
}

export interface QuickAskResult {
  answer: string;
  title?: string;
  model?: string;
  warnings: string[];
  focusSubject?: string;
  focusSubjectSource?: string;
  resolvedIntent?: string;
  requestedTopic?: string;
  diagnostics?: JsonValue;
}

export interface TranscribeSpeechInput {
  audioBytes: number[];
  mimeType: string;
  language?: string;
  providerProfileId?: string;
  mode: "preview";
  metadata?: JsonValue;
  signal?: AbortSignal;
}

export interface TranscribeSpeechResult {
  transcript: string;
  language?: string;
  confidence?: number;
  provider: string;
  warnings: string[];
  retention: {
    audioPersisted: boolean;
    transcriptPersisted: boolean;
  };
}

export type EngineResponseEvent =
  | { type: "status"; payload: { message: string; stage?: string } }
  | {
      type: "user_message_created";
      payload: { loomId: string; responseId: string; workflowRunId?: string; loomTitle?: string };
    }
  | {
      type: "assistant_placeholder_created";
      payload: { loomId: string; responseId: string; workflowRunId?: string; loomTitle?: string };
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
  | { type: "response_completed"; payload: { responseId: string; doneReason?: string; loomTitle?: string } }
  | { type: "response_truncated"; payload: { responseId: string; doneReason?: string; loomTitle?: string } }
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
  originResponseId?: string;
  weftKind?: "exploration" | "revision";
  title?: string;
  initialPrompt?: string;
  summary?: string;
  reuseExisting?: boolean;
  source?: "response_action" | "quick_ask_convert" | "graph_node" | "reference";
  seedMode?: "none" | "origin_qa_pair" | "quick_ask_turns" | "revision_lineage";
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
  title?: string;
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
  title?: string;
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

export interface CodeSnippetReferenceItem {
  codeBlockId: string;
  responseId: string;
  loomId: string;
  loomTitle?: string;
  sourceResponseTitle?: string;
  sourceResponseCode?: string;
  sourceCanonicalUri?: string;
  blockIndex: number;
  language?: string;
  code: string;
  exactHash?: string;
  fence?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListCodeSnippetsInput {
  loomId?: string;
  limit?: number;
}

export interface ListCodeSnippetsResult {
  codeSnippets: CodeSnippetReferenceItem[];
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
  createAttachment?: (input: CreateAttachmentInput) => Promise<CreateAttachmentResult>;
  listAttachments?: (input: ListAttachmentsInput) => Promise<ListAttachmentsResult>;
  deleteAttachment?: (input: DeleteAttachmentInput) => Promise<void>;
  regenerateFromResponse?: (
    input: RegenerateFromResponseInput
  ) => AsyncIterable<EngineResponseEvent>;
  retryUserMessage?: (input: RetryUserMessageInput) => AsyncIterable<EngineResponseEvent>;
  quickAsk?: (input: QuickAskInput) => Promise<QuickAskResult>;
  createOrOpenWeft?: (input: CreateOrOpenWeftInput) => Promise<CreateOrOpenWeftResult>;
  persistWeftTurns?: (input: PersistWeftTurnsInput) => Promise<PersistWeftTurnsResult>;
  updateResponse?: (input: UpdateResponseInput) => Promise<UpdateResponseResult>;
  archiveLoom?: (input: ArchiveLoomInput) => Promise<CreateLoomResult>;
  restoreLoom?: (input: RestoreLoomInput) => Promise<CreateLoomResult>;
  deleteLoom?: (input: DeleteLoomInput) => Promise<void>;
  addReference?: (input: AddReferenceInput) => Promise<AddReferenceResult>;
  removeReference?: (input: RemoveReferenceInput) => Promise<void>;
  getReference?: (input: GetReferenceInput) => Promise<AddReferenceResult>;
  listReferences?: (input: ListReferencesInput) => Promise<ListReferencesResult>;
  listCodeSnippets?: (input: ListCodeSnippetsInput) => Promise<ListCodeSnippetsResult>;
  suggestReferences?: (input: SuggestReferencesInput) => Promise<SuggestReferencesResult>;
  createBookmark?: (input: CreateBookmarkInput) => Promise<BookmarkResult>;
  deleteBookmark?: (input: DeleteBookmarkInput) => Promise<void>;
  getBookmark?: (input: GetBookmarkInput) => Promise<BookmarkResult>;
  listBookmarks?: () => Promise<ListBookmarksResult>;
  listHistory?: () => Promise<ListHistoryResult>;
  recordHistory?: (input: RecordHistoryInput) => Promise<HistoryEntry>;
  getUiState?: (input: GetUiStateInput) => Promise<GetUiStateResult>;
  saveUiState?: (input: SaveUiStateInput) => Promise<UiStateRecord>;
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
