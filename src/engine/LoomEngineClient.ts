import type {
  AddReferenceInput,
  AddReferenceResult,
  ArchiveLoomInput,
  BookmarkResponseInput,
  BookmarkResult,
  CancelMessageInput,
  CancelMessageResult,
  CreateBookmarkInput,
  CreateAttachmentInput,
  CreateAttachmentResult,
  CreateLoomInput,
  CreateLoomResult,
  CreateOrOpenWeftInput,
  CreateOrOpenWeftResult,
  DeleteLoomInput,
  EngineHealth,
  EngineResponseEvent,
  ExportLoomInput,
  ExportLoomResult,
  ExportResponseInput,
  CapabilitySummary,
  DeleteBookmarkInput,
  DeleteAttachmentInput,
  MaterializeAttachmentInput,
  MaterializeAttachmentResult,
  GetBookmarkForTargetInput,
  GetBookmarkInput,
  GetReferenceInput,
  GetUiStateInput,
  GetUiStateResult,
  GraphProjectionInput,
  GraphProjectionResult,
  ListReferencesInput,
  ListReferencesResult,
  ListAttachmentsInput,
  ListAttachmentsResult,
  ListCodeSnippetsInput,
  ListCodeSnippetsResult,
  ListHistoryResult,
  ListLoomsInput,
  ListBookmarksResult,
  LoomDetail,
  LoomSummary,
  OpenReferenceInput,
  PersistWeftTurnsInput,
  PersistWeftTurnsResult,
  QuickAskInput,
  QuickAskResult,
  RegenerateFromResponseInput,
  RemoveReferenceInput,
  RetryUserMessageInput,
  RenameLoomInput,
  RestoreLoomInput,
  RecordHistoryInput,
  ResolveAddressInput,
  ResolveAddressResult,
  LoomServiceRuntimeConfig,
  OcrProviderHealth,
  RuntimeModelDownloadJob,
  RuntimeModelsResult,
  ServiceConfigUpdateResult,
  ServiceConfigStatus,
  SpeechProviderHealth,
  SpeechSetupStatus,
  ServiceHealthStatus,
  SendMessageInput,
  SaveUiStateInput,
  SuggestReferencesInput,
  SuggestReferencesResult,
  TranscribeSpeechInput,
  TranscribeSpeechResult,
  UpdateServiceConfigInput,
  UpdateResponseInput,
  UpdateResponseResult,
  UpdateLoomInput,
  UiStateRecord,
  GenerationResponseStateResult,
} from "./LoomEngineTypes";
import type { HistoryEntry, LoomNavigationDestination } from "../types";

export interface LoomEngineClient {
  getHealth(): Promise<EngineHealth>;
  getServiceHealth(): Promise<ServiceHealthStatus>;
  getServiceConfigStatus(): Promise<ServiceConfigStatus>;
  getServiceConfig(): Promise<LoomServiceRuntimeConfig>;
  updateServiceConfig(input: UpdateServiceConfigInput): Promise<ServiceConfigUpdateResult>;
  getRuntimeModels(): Promise<RuntimeModelsResult>;
  startModelDownload(modelName: string): Promise<RuntimeModelDownloadJob>;
  getModelDownload(jobId: string): Promise<RuntimeModelDownloadJob>;
  cancelModelDownload(jobId: string): Promise<RuntimeModelDownloadJob>;
  getOcrProviderHealth(): Promise<OcrProviderHealth>;
  getSpeechProviderHealth(): Promise<SpeechProviderHealth>;
  getSpeechSetupStatus(): Promise<SpeechSetupStatus>;
  downloadSpeechSetupModel(): Promise<SpeechSetupStatus>;
  configureSpeechSetup(): Promise<SpeechSetupStatus>;
  getCapabilitySummary(): Promise<CapabilitySummary>;
  listLooms(input?: ListLoomsInput): Promise<LoomSummary[]>;
  getLoom(loomId: string): Promise<LoomDetail>;
  createLoom(input: CreateLoomInput): Promise<CreateLoomResult>;
  renameLoom(input: RenameLoomInput): Promise<void>;
  updateLoomMetadata(input: UpdateLoomInput): Promise<CreateLoomResult>;
  archiveLoom(input: ArchiveLoomInput): Promise<CreateLoomResult>;
  restoreLoom(input: RestoreLoomInput): Promise<CreateLoomResult>;
  deleteLoom(input: DeleteLoomInput): Promise<void>;
  hardReset(): Promise<void>;
  sendMessage(input: SendMessageInput): AsyncIterable<EngineResponseEvent>;
  createAttachment(input: CreateAttachmentInput): Promise<CreateAttachmentResult>;
  listAttachments(input: ListAttachmentsInput): Promise<ListAttachmentsResult>;
  deleteAttachment(input: DeleteAttachmentInput): Promise<void>;
  materializeAttachment(input: MaterializeAttachmentInput): Promise<MaterializeAttachmentResult>;
  regenerateFromResponse(input: RegenerateFromResponseInput): AsyncIterable<EngineResponseEvent>;
  retryUserMessage(input: RetryUserMessageInput): AsyncIterable<EngineResponseEvent>;
  cancelMessage(input: CancelMessageInput): Promise<CancelMessageResult>;
  getGenerationResponseState(workflowRunId: string): Promise<GenerationResponseStateResult>;
  quickAsk(input: QuickAskInput): Promise<QuickAskResult>;
  transcribeSpeech(input: TranscribeSpeechInput): Promise<TranscribeSpeechResult>;
  createOrOpenWeft(input: CreateOrOpenWeftInput): Promise<CreateOrOpenWeftResult>;
  persistWeftTurns(input: PersistWeftTurnsInput): Promise<PersistWeftTurnsResult>;
  updateResponse(input: UpdateResponseInput): Promise<UpdateResponseResult>;
  addReference(input: AddReferenceInput): Promise<AddReferenceResult>;
  removeReference(input: RemoveReferenceInput): Promise<void>;
  getReference(input: GetReferenceInput): Promise<AddReferenceResult>;
  listReferences(input: ListReferencesInput): Promise<ListReferencesResult>;
  listCodeSnippets(input: ListCodeSnippetsInput): Promise<ListCodeSnippetsResult>;
  suggestReferences(input: SuggestReferencesInput): Promise<SuggestReferencesResult>;
  openReference(input: OpenReferenceInput): Promise<LoomNavigationDestination>;
  createBookmark(input: CreateBookmarkInput): Promise<BookmarkResult>;
  deleteBookmark(input: DeleteBookmarkInput): Promise<void>;
  getBookmark(input: GetBookmarkInput): Promise<BookmarkResult>;
  listBookmarks(): Promise<ListBookmarksResult>;
  listHistory(): Promise<ListHistoryResult>;
  recordHistory(input: RecordHistoryInput): Promise<HistoryEntry>;
  getUiState(input: GetUiStateInput): Promise<GetUiStateResult>;
  saveUiState(input: SaveUiStateInput): Promise<UiStateRecord>;
  getBookmarkForTarget(input: GetBookmarkForTargetInput): Promise<BookmarkResult>;
  bookmarkResponse(input: BookmarkResponseInput): Promise<BookmarkResult>;
  resolveAddress(input: ResolveAddressInput): Promise<ResolveAddressResult>;
  getGraphProjection(input: GraphProjectionInput): Promise<GraphProjectionResult>;
  exportLoom(input: ExportLoomInput): Promise<ExportLoomResult>;
  exportResponse(input: ExportResponseInput): Promise<ExportLoomResult>;
}
