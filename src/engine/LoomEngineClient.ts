import type {
  AddReferenceInput,
  AddReferenceResult,
  BookmarkResponseInput,
  BookmarkResult,
  CancelMessageInput,
  CancelMessageResult,
  CreateBookmarkInput,
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
  GetBookmarkForTargetInput,
  GetBookmarkInput,
  GetReferenceInput,
  GetUiStateInput,
  GetUiStateResult,
  GraphProjectionInput,
  GraphProjectionResult,
  ListReferencesInput,
  ListReferencesResult,
  ListHistoryResult,
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
  RenameLoomInput,
  RecordHistoryInput,
  ResolveAddressInput,
  ResolveAddressResult,
  LoomServiceRuntimeConfig,
  ServiceConfigUpdateResult,
  ServiceConfigStatus,
  SpeechProviderHealth,
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
} from "./LoomEngineTypes";
import type { HistoryEntry, LoomNavigationDestination } from "../types";

export interface LoomEngineClient {
  getHealth(): Promise<EngineHealth>;
  getServiceHealth(): Promise<ServiceHealthStatus>;
  getServiceConfigStatus(): Promise<ServiceConfigStatus>;
  getServiceConfig(): Promise<LoomServiceRuntimeConfig>;
  updateServiceConfig(input: UpdateServiceConfigInput): Promise<ServiceConfigUpdateResult>;
  getSpeechProviderHealth(): Promise<SpeechProviderHealth>;
  getCapabilitySummary(): Promise<CapabilitySummary>;
  listLooms(): Promise<LoomSummary[]>;
  getLoom(loomId: string): Promise<LoomDetail>;
  createLoom(input: CreateLoomInput): Promise<CreateLoomResult>;
  renameLoom(input: RenameLoomInput): Promise<void>;
  updateLoomMetadata(input: UpdateLoomInput): Promise<CreateLoomResult>;
  deleteLoom(input: DeleteLoomInput): Promise<void>;
  sendMessage(input: SendMessageInput): AsyncIterable<EngineResponseEvent>;
  regenerateFromResponse(input: RegenerateFromResponseInput): AsyncIterable<EngineResponseEvent>;
  cancelMessage(input: CancelMessageInput): Promise<CancelMessageResult>;
  quickAsk(input: QuickAskInput): Promise<QuickAskResult>;
  transcribeSpeech(input: TranscribeSpeechInput): Promise<TranscribeSpeechResult>;
  createOrOpenWeft(input: CreateOrOpenWeftInput): Promise<CreateOrOpenWeftResult>;
  persistWeftTurns(input: PersistWeftTurnsInput): Promise<PersistWeftTurnsResult>;
  updateResponse(input: UpdateResponseInput): Promise<UpdateResponseResult>;
  addReference(input: AddReferenceInput): Promise<AddReferenceResult>;
  removeReference(input: RemoveReferenceInput): Promise<void>;
  getReference(input: GetReferenceInput): Promise<AddReferenceResult>;
  listReferences(input: ListReferencesInput): Promise<ListReferencesResult>;
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
