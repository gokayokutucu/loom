/*
 * Legacy/dev/test-only after the Rust-authoritative cutover.
 * Do not use this engine in product runtime paths.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { LoomEngineClient } from "./LoomEngineClient";
import type {
  AddReferenceInput,
  AddReferenceResult,
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
  GetReferenceInput,
  GetUiStateInput,
  GetUiStateResult,
  DeleteBookmarkInput,
  DeleteLoomInput,
  GetBookmarkForTargetInput,
  GetBookmarkInput,
  GraphProjectionInput,
  GraphProjectionResult,
  ListReferencesInput,
  ListReferencesResult,
  ListBookmarksResult,
  ListHistoryResult,
  LoomDetail,
  LoomSummary,
  OpenReferenceInput,
  PersistWeftTurnsInput,
  PersistWeftTurnsResult,
  QuickAskInput,
  QuickAskResult,
  RegenerateFromResponseInput,
  RecordHistoryInput,
  RemoveReferenceInput,
  RenameLoomInput,
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

  async getSpeechProviderHealth(): Promise<SpeechProviderHealth> {
    return {
      status: "provider_unavailable",
      providerKind: "typescript_local",
      message: "Speech-to-text requires the Rust service runtime.",
      checks: [],
    };
  }

  async getCapabilitySummary(): Promise<CapabilitySummary> {
    return {
      status: "unknown",
      strategyAvailable: false,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  async listLooms(): Promise<LoomSummary[]> {
    // TODO(engine): Move canonical Loom storage behind the engine once App.tsx state is split.
    throw notImplemented("listLooms");
  }

  async getLoom(_loomId: string): Promise<LoomDetail> {
    // TODO(engine): Adapt current conversation/response state into LoomDetail.
    throw notImplemented("getLoom");
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

  async deleteLoom(input: DeleteLoomInput): Promise<void> {
    if (this.dependencies.deleteLoom) {
      return this.dependencies.deleteLoom(input);
    }
    throw notImplemented("deleteLoom");
  }

  sendMessage(_input: SendMessageInput): AsyncIterable<EngineResponseEvent> {
    if (this.dependencies.sendMessage) {
      return this.dependencies.sendMessage(_input);
    }
    // TODO(engine): Move composer send pipeline here after the event contract settles.
    return notImplementedStream("sendMessage");
  }

  regenerateFromResponse(input: RegenerateFromResponseInput): AsyncIterable<EngineResponseEvent> {
    if (this.dependencies.regenerateFromResponse) {
      return this.dependencies.regenerateFromResponse(input);
    }
    return notImplementedStream("regenerateFromResponse");
  }

  async cancelMessage(input: CancelMessageInput): Promise<CancelMessageResult> {
    return {
      status: "cancelled",
      workflowRunId: input.workflowRunId,
      responseId: input.responseId,
    };
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
