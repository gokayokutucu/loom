/*
 * Legacy/dev/test-only after the Rust-authoritative cutover.
 * Do not use this engine in product runtime paths.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { LoomEngineClient } from "./LoomEngineClient";
import type {
  AddReferenceInput,
  AddReferenceResult,
  AdoptAttachmentInput,
  ArchiveLoomInput,
  CreateAttachmentInput,
  CreateAttachmentResult,
  BookmarkResponseInput,
  BookmarkResult,
  CancelMessageInput,
  CancelMessageResult,
  CreateBookmarkInput,
  CapabilitySummary,
  CreateLoomInput,
  CreateLoomResult,
  CreateOrOpenWeftInput,
  CreateOrOpenWeftResult,
  EngineHealth,
  EngineResponseEvent,
  ExportLoomInput,
  ExportLoomResult,
  ExportResponseInput,
  GenerationResponseStateResult,
  GetReferenceInput,
  GetUiStateInput,
  GetUiStateResult,
  DeleteBookmarkInput,
  DeleteAttachmentInput,
  MaterializeAttachmentInput,
  MaterializeAttachmentResult,
  DeleteLoomInput,
  GetBookmarkForTargetInput,
  GetBookmarkInput,
  GraphProjectionInput,
  GraphProjectionResult,
  LoomAncestryStepInput,
  LoomAncestryStepResult,
  ListReferencesInput,
  ListReferencesResult,
  ListAttachmentsInput,
  ListAttachmentsResult,
  ListCodeSnippetsInput,
  ListCodeSnippetsResult,
  ListBookmarksResult,
  ListHistoryResult,
  ListLoomsInput,
  LoomDetail,
  LoomTranscriptOutline,
  LoomTranscriptPage,
  LoomTranscriptPageInput,
  LoomSummary,
  OpenReferenceInput,
  PersistWeftTurnsInput,
  PersistWeftTurnsResult,
  QuickAskInput,
  QuickAskResult,
  RegenerateFromResponseInput,
  RecordHistoryInput,
  RemoveReferenceInput,
  RetryUserMessageInput,
  RenameLoomInput,
  RestoreLoomInput,
  ResolveAddressInput,
  ResolveAddressResult,
  LoomServiceRuntimeConfig,
  ProviderSecretStatus,
  ProviderModelDiscoveryRequest,
  ProviderModelDiscoveryResponse,
  RuntimeModelDownloadJob,
  RuntimeModelProviderStatus,
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
  TypeScriptLocalLoomEngineDependencies,
  UpdateLoomInput,
  UpdateResponseInput,
  UpdateResponseResult,
  UiStateRecord,
} from "./LoomEngineTypes";
import { buildLoomGraphProjection } from "../services/loomGraphProjection";
import { resolveLoomAddress } from "../services/loomProtocol";
import type { LoomNavigationDestination } from "../types";
import type { HistoryEntry } from "../types";

function notImplemented(method: string): Error {
  return new Error(`TypeScriptLocalLoomEngine.${method} is not implemented in this migration phase.`);
}

async function* notImplementedStream(method: string): AsyncIterable<EngineResponseEvent> {
  throw notImplemented(method);
}

export class TypeScriptLocalLoomEngine implements LoomEngineClient {
  constructor(private readonly dependencies: TypeScriptLocalLoomEngineDependencies = {}) {}

  async getHealth(): Promise<EngineHealth> {
    return {
      status: "ready",
      runtime: "typescript-local",
      version: "engine-contract-v1",
    };
  }

  async getServiceHealth(): Promise<ServiceHealthStatus> {
    return {
      status: "ready",
      runtime: "typescript-local",
      version: "engine-contract-v1",
      lastCheckedAt: new Date().toISOString(),
    };
  }

  async getServiceConfigStatus(): Promise<ServiceConfigStatus> {
    return {
      status: "unavailable",
      lastCheckedAt: new Date().toISOString(),
      error: "loom-service config is not active in TypeScript local mode.",
    };
  }

  async getServiceConfig(): Promise<LoomServiceRuntimeConfig> {
    throw new Error("Speech-to-text provider configuration requires the Rust service runtime.");
  }

  async updateServiceConfig(): Promise<ServiceConfigUpdateResult> {
    throw new Error("Speech-to-text provider configuration requires the Rust service runtime.");
  }

  async getProviderSecretStatus(): Promise<ProviderSecretStatus> {
    throw new Error("Provider secret management requires the Rust service runtime.");
  }

  async setProviderSecret(): Promise<ProviderSecretStatus> {
    throw new Error("Provider secret management requires the Rust service runtime.");
  }

  async deleteProviderSecret(): Promise<ProviderSecretStatus> {
    throw new Error("Provider secret management requires the Rust service runtime.");
  }

  async testProviderSecret(): Promise<ProviderSecretStatus> {
    throw new Error("Provider secret management requires the Rust service runtime.");
  }

  async discoverModels(): Promise<ProviderModelDiscoveryResponse> {
    throw new Error("Provider model discovery requires the Rust service runtime.");
  }


  async getRuntimeProviders(): Promise<RuntimeModelProviderStatus[]> {
    throw new Error("Provider runtime management requires the Rust service runtime.");
  }

  async getRuntimeModels(): Promise<RuntimeModelsResult> {
    throw new Error("Model runtime management requires the Rust service runtime.");
  }

  async startModelDownload(): Promise<RuntimeModelDownloadJob> {
    throw new Error("Model downloads require the Rust service runtime.");
  }

  async getModelDownload(): Promise<RuntimeModelDownloadJob> {
    throw new Error("Model download status requires the Rust service runtime.");
  }

  async cancelModelDownload(): Promise<RuntimeModelDownloadJob> {
    throw new Error("Model download cancellation requires the Rust service runtime.");
  }

  async getOcrProviderHealth() {
    return {
      status: "unavailable",
      provider: "typescript_local",
      enabled: false,
      commandPath: null,
      rasterizerCommandPath: null,
      language: "eng",
      dpi: 200,
      message: "OCR provider diagnostics require the Rust service runtime.",
      warnings: ["rust_service_required"],
    };
  }

  async getSpeechProviderHealth(): Promise<SpeechProviderHealth> {
    return {
      status: "provider_unavailable",
      providerKind: "typescript_local",
      message: "Speech-to-text requires the Rust service runtime.",
      checks: [],
    };
  }

  async getSpeechSetupStatus(): Promise<SpeechSetupStatus> {
    throw new Error("Speech-to-text setup requires the Rust service runtime.");
  }

  async downloadSpeechSetupModel(): Promise<SpeechSetupStatus> {
    throw new Error("Speech-to-text model download requires the Rust service runtime.");
  }

  async configureSpeechSetup(): Promise<SpeechSetupStatus> {
    throw new Error("Speech-to-text setup requires the Rust service runtime.");
  }

  async getCapabilitySummary(): Promise<CapabilitySummary> {
    return {
      status: "unknown",
      strategyAvailable: false,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  async listLooms(_input: ListLoomsInput = {}): Promise<LoomSummary[]> {
    // TODO(engine): Move canonical Loom storage behind the engine once App.tsx state is split.
    throw notImplemented("listLooms");
  }

  async getLoom(_loomId: string): Promise<LoomDetail> {
    // TODO(engine): Adapt current conversation/response state into LoomDetail.
    throw notImplemented("getLoom");
  }

  async getLoomTranscriptPage(_input: LoomTranscriptPageInput): Promise<LoomTranscriptPage> {
    throw notImplemented("getLoomTranscriptPage");
  }

  async getLoomTranscriptOutline(_loomId: string): Promise<LoomTranscriptOutline> {
    throw notImplemented("getLoomTranscriptOutline");
  }

  async createLoom(_input: CreateLoomInput): Promise<CreateLoomResult> {
    // TODO(engine): Move New Loom materialization behind the engine boundary.
    throw notImplemented("createLoom");
  }

  async renameLoom(_input: RenameLoomInput): Promise<void> {
    // TODO(engine): Move Loom metadata/title mutation behind the engine boundary.
    throw notImplemented("renameLoom");
  }

  async updateLoomMetadata(_input: UpdateLoomInput): Promise<CreateLoomResult> {
    // TODO(engine): Move Loom metadata mutation behind the engine boundary.
    throw notImplemented("updateLoomMetadata");
  }

  async archiveLoom(input: ArchiveLoomInput): Promise<CreateLoomResult> {
    if (this.dependencies.archiveLoom) {
      return this.dependencies.archiveLoom(input);
    }
    throw notImplemented("archiveLoom");
  }

  async restoreLoom(input: RestoreLoomInput): Promise<CreateLoomResult> {
    if (this.dependencies.restoreLoom) {
      return this.dependencies.restoreLoom(input);
    }
    throw notImplemented("restoreLoom");
  }

  async deleteLoom(input: DeleteLoomInput): Promise<void> {
    if (this.dependencies.deleteLoom) {
      return this.dependencies.deleteLoom(input);
    }
    throw notImplemented("deleteLoom");
  }

  async hardReset(): Promise<void> {
    // No-op in mock/local mode — state is reset by the caller directly.
  }

  sendMessage(_input: SendMessageInput): AsyncIterable<EngineResponseEvent> {
    if (this.dependencies.sendMessage) {
      return this.dependencies.sendMessage(_input);
    }
    // TODO(engine): Move composer send pipeline here after the event contract settles.
    return notImplementedStream("sendMessage");
  }

  async createAttachment(input: CreateAttachmentInput): Promise<CreateAttachmentResult> {
    if (this.dependencies.createAttachment) {
      return this.dependencies.createAttachment(input);
    }
    const now = Date.now().toString();
    const extension = input.fileName.includes(".")
      ? input.fileName.split(".").pop()?.toLowerCase()
      : undefined;
    const isImage = input.mimeType?.startsWith("image/");
    const isText =
      input.mimeType?.startsWith("text/") ||
      ["txt", "md", "csv", "xml", "json"].includes(extension ?? "");
    return {
      attachment: {
        attachmentId: `local-att-${now}`,
        loomId: input.loomId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        extension,
        sizeBytes: input.sizeBytes,
        kind: isImage ? "image" : isText ? "text" : "unsupported",
        parseStatus: isImage || isText ? "ready" : "unsupported",
        parser: isImage ? "image_metadata_v1" : isText ? "utf8_text_v1" : undefined,
        error: isImage || isText ? undefined : "This file type is visible but unsupported for parsing.",
        thumbnailDataUrl: isImage ? `data:${input.mimeType};base64,${input.contentBase64}` : undefined,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  async listAttachments(input: ListAttachmentsInput): Promise<ListAttachmentsResult> {
    if (this.dependencies.listAttachments) {
      return this.dependencies.listAttachments(input);
    }
    return { attachments: [] };
  }

  async deleteAttachment(input: DeleteAttachmentInput): Promise<void> {
    if (this.dependencies.deleteAttachment) {
      return this.dependencies.deleteAttachment(input);
    }
  }

  async adoptAttachment(input: AdoptAttachmentInput): Promise<CreateAttachmentResult> {
    if (this.dependencies.adoptAttachment) {
      return this.dependencies.adoptAttachment(input);
    }
    const now = Date.now().toString();
    return {
      attachment: {
        attachmentId: input.attachmentId,
        loomId: input.toLoomId,
        fileName: input.attachmentId,
        sizeBytes: 0,
        kind: "unsupported",
        parseStatus: "unsupported",
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  async materializeAttachment(_input: MaterializeAttachmentInput): Promise<MaterializeAttachmentResult> {
    throw notImplemented("materializeAttachment");
  }

  regenerateFromResponse(input: RegenerateFromResponseInput): AsyncIterable<EngineResponseEvent> {
    if (this.dependencies.regenerateFromResponse) {
      return this.dependencies.regenerateFromResponse(input);
    }
    return notImplementedStream("regenerateFromResponse");
  }

  retryUserMessage(input: RetryUserMessageInput): AsyncIterable<EngineResponseEvent> {
    if (this.dependencies.retryUserMessage) {
      return this.dependencies.retryUserMessage(input);
    }
    return notImplementedStream("retryUserMessage");
  }

  async cancelMessage(input: CancelMessageInput): Promise<CancelMessageResult> {
    return {
      status: "cancelled",
      workflowRunId: input.workflowRunId,
      responseId: input.responseId,
    };
  }

  async getGenerationResponseState(): Promise<GenerationResponseStateResult> {
    throw notImplemented("getGenerationResponseState");
  }

  async quickAsk(input: QuickAskInput): Promise<QuickAskResult> {
    if (this.dependencies.quickAsk) {
      return this.dependencies.quickAsk(input);
    }
    throw notImplemented("quickAsk");
  }

  async transcribeSpeech(_input: TranscribeSpeechInput): Promise<TranscribeSpeechResult> {
    throw new Error("Speech-to-text requires the Rust service runtime.");
  }

  async listHistory(): Promise<ListHistoryResult> {
    if (this.dependencies.listHistory) {
      return this.dependencies.listHistory();
    }
    return { history: [] };
  }

  async recordHistory(input: RecordHistoryInput): Promise<HistoryEntry> {
    if (this.dependencies.recordHistory) {
      return this.dependencies.recordHistory(input);
    }
    return input.entry;
  }

  async getUiState(input: GetUiStateInput): Promise<GetUiStateResult> {
    if (this.dependencies.getUiState) {
      return this.dependencies.getUiState(input);
    }
    return { state: null };
  }

  async saveUiState(input: SaveUiStateInput): Promise<UiStateRecord> {
    if (this.dependencies.saveUiState) {
      return this.dependencies.saveUiState(input);
    }
    return { key: input.key, value: input.value, updatedAt: new Date().toISOString() };
  }

  async createOrOpenWeft(_input: CreateOrOpenWeftInput): Promise<CreateOrOpenWeftResult> {
    if (this.dependencies.createOrOpenWeft) {
      return this.dependencies.createOrOpenWeft(_input);
    }
    // TODO(engine): Wrap existing Weft create/reuse service once it is separated from UI state.
    throw notImplemented("createOrOpenWeft");
  }

  async persistWeftTurns(input: PersistWeftTurnsInput): Promise<PersistWeftTurnsResult> {
    if (this.dependencies.persistWeftTurns) {
      return this.dependencies.persistWeftTurns(input);
    }
    return {
      weftLoomId: input.weftLoomId,
      responses: [],
    };
  }

  async updateResponse(input: UpdateResponseInput): Promise<UpdateResponseResult> {
    if (this.dependencies.updateResponse) {
      return this.dependencies.updateResponse(input);
    }
    throw notImplemented("updateResponse");
  }

  async addReference(input: AddReferenceInput): Promise<AddReferenceResult> {
    if (this.dependencies.addReference) {
      return this.dependencies.addReference(input);
    }
    // TODO(engine): Move Reference mutation out of React draft state.
    return { reference: input.reference };
  }

  async removeReference(input: RemoveReferenceInput): Promise<void> {
    if (this.dependencies.removeReference) {
      return this.dependencies.removeReference(input);
    }
    // TODO(engine): Move Reference removal out of React draft state.
    throw notImplemented("removeReference");
  }

  async getReference(input: GetReferenceInput): Promise<AddReferenceResult> {
    if (this.dependencies.getReference) {
      return this.dependencies.getReference(input);
    }
    throw notImplemented("getReference");
  }

  async listReferences(input: ListReferencesInput): Promise<ListReferencesResult> {
    if (this.dependencies.listReferences) {
      return this.dependencies.listReferences(input);
    }
    return { references: [] };
  }

  async listCodeSnippets(input: ListCodeSnippetsInput): Promise<ListCodeSnippetsResult> {
    if (this.dependencies.listCodeSnippets) {
      return this.dependencies.listCodeSnippets(input);
    }
    return { codeSnippets: [] };
  }

  async suggestReferences(input: SuggestReferencesInput): Promise<SuggestReferencesResult> {
    if (this.dependencies.suggestReferences) {
      return this.dependencies.suggestReferences(input);
    }
    return { suggestions: [] };
  }

  async openReference(_input: OpenReferenceInput): Promise<LoomNavigationDestination> {
    // TODO(engine): Wrap current visitDestination/navigation rules.
    throw notImplemented("openReference");
  }

  async createBookmark(input: CreateBookmarkInput): Promise<BookmarkResult> {
    if (this.dependencies.createBookmark) {
      return this.dependencies.createBookmark(input);
    }
    throw notImplemented("createBookmark");
  }

  async deleteBookmark(input: DeleteBookmarkInput): Promise<void> {
    if (this.dependencies.deleteBookmark) {
      return this.dependencies.deleteBookmark(input);
    }
    throw notImplemented("deleteBookmark");
  }

  async getBookmark(input: GetBookmarkInput): Promise<BookmarkResult> {
    if (this.dependencies.getBookmark) {
      return this.dependencies.getBookmark(input);
    }
    throw notImplemented("getBookmark");
  }

  async listBookmarks(): Promise<ListBookmarksResult> {
    if (this.dependencies.listBookmarks) {
      return this.dependencies.listBookmarks();
    }
    return { bookmarks: [] };
  }

  async getBookmarkForTarget(input: GetBookmarkForTargetInput): Promise<BookmarkResult> {
    if (this.dependencies.getBookmarkForTarget) {
      return this.dependencies.getBookmarkForTarget(input);
    }
    throw notImplemented("getBookmarkForTarget");
  }

  async bookmarkResponse(_input: BookmarkResponseInput): Promise<BookmarkResult> {
    if (this.dependencies.bookmarkResponse) {
      return this.dependencies.bookmarkResponse(_input);
    }
    // TODO(engine): Wrap bookmark promotion repository and persistence.
    throw notImplemented("bookmarkResponse");
  }

  async resolveAddress(input: ResolveAddressInput): Promise<ResolveAddressResult> {
    if (!this.dependencies.graphRepository) {
      throw new Error("TypeScriptLocalLoomEngine.resolveAddress requires a graphRepository.");
    }
    return resolveLoomAddress(input.address, this.dependencies.graphRepository);
  }

  async getGraphProjection(input: GraphProjectionInput): Promise<GraphProjectionResult> {
    return buildLoomGraphProjection({
      conversations: input.conversations,
      responsesByConversation: input.responsesByConversation,
      forkRecords: input.forkRecords,
      activeLoomId: input.activeLoomId,
      focusedResponseId: input.focusedResponseId,
      expandedNodeIds: new Set(input.expandedNodeIds ?? []),
      bookmarkedResponseAddresses: new Set(input.bookmarkedResponseAddresses ?? []),
    });
  }

  async getLoomAncestryStep(input: LoomAncestryStepInput): Promise<LoomAncestryStepResult> {
    return {
      loomId: input.loomId,
      hasParentAncestry: false,
      warnings: ["typescript_local_ancestry_step_unavailable"],
    };
  }

  async exportLoom(input: ExportLoomInput): Promise<ExportLoomResult> {
    if (!this.dependencies.exportLoom) {
      throw notImplemented("exportLoom");
    }
    return this.dependencies.exportLoom(input);
  }

  async exportResponse(input: ExportResponseInput): Promise<ExportLoomResult> {
    if (!this.dependencies.exportResponse) {
      throw notImplemented("exportResponse");
    }
    return this.dependencies.exportResponse(input);
  }
}

export function createTypeScriptLocalLoomEngine(
  dependencies: TypeScriptLocalLoomEngineDependencies = {}
): TypeScriptLocalLoomEngine {
  return new TypeScriptLocalLoomEngine(dependencies);
}
