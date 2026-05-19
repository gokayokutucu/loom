import type { LoomEngineClient } from "./LoomEngineClient";
import type {
  AddReferenceInput,
  AddReferenceResult,
  BookmarkResponseInput,
  BookmarkResult,
  CancelMessageInput,
  CancelMessageResult,
  CapabilitySummary,
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
  GenerationResponseStateResult,
  GenerationResponseSummary,
  DeleteBookmarkInput,
  GetBookmarkForTargetInput,
  GetBookmarkInput,
  GetReferenceInput,
  GetUiStateInput,
  GetUiStateResult,
  GraphProjectionInput,
  GraphProjectionResult,
  JsonValue,
  CodeSnippetReferenceItem,
  ListCodeSnippetsInput,
  ListCodeSnippetsResult,
  LoomDetail,
  LoomSummary,
  OpenReferenceInput,
  ListBookmarksResult,
  ListHistoryResult,
  ListReferencesInput,
  ListReferencesResult,
  PersistedWeftTurn,
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
  RustHttpLoomEngineClientOptions,
  LoomServiceRuntimeConfig,
  ServiceConfigUpdateResult,
  ServiceConfigStatus,
  ServiceHealthStatus,
  SendMessageInput,
  SaveUiStateInput,
  SpeechProviderHealth,
  SpeechToTextProviderKind,
  SpeechToTextRuntimeConfig,
  SuggestReferencesInput,
  SuggestReferencesResult,
  TranscribeSpeechInput,
  TranscribeSpeechResult,
  UpdateServiceConfigInput,
  UpdateLoomInput,
  UpdateResponseInput,
  UpdateResponseResult,
  UiStateRecord,
  VisibleWeftSeedResponse,
} from "./LoomEngineTypes";
import type {
  BookmarkItem,
  HistoryEntry,
  LoomNavigationDestination,
  LoomLink,
  LoomObjectKind,
  LoomObjectStatus,
  LoomResolutionStatus,
  ResponseCodeBlock,
  ResponseItem,
} from "../types";
import { parseLoomAddress } from "../services/loomProtocol";
import {
  loomGraphRootNodeId,
  responseGraphNodeId,
  type LoomGraphProjection,
  type LoomGraphProjectionEdge,
  type LoomGraphProjectionEdgeKind,
  type LoomGraphProjectionNode,
  type LoomGraphProjectionNodeKind,
} from "../services/loomGraphProjection";

export type RustHttpLoomEngineErrorKind =
  | "service_unavailable"
  | "provider_unavailable"
  | "provider_error"
  | "invalid_config"
  | "model_missing"
  | "request_failed"
  | "request_aborted"
  | "unsupported_method"
  | "invalid_response"
  | "response_parse_error"
  | "timeout";

export class RustHttpLoomEngineError extends Error {
  constructor(
    public readonly kind: RustHttpLoomEngineErrorKind,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "RustHttpLoomEngineError";
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const GENERATION_STREAM_OPEN_TIMEOUT_MS = 120_000;

interface RequestJsonTransportMeta {
  endpoint: string;
  requestAttempted: boolean;
  httpStatus?: number;
  responseParseStatus?: "not_started" | "success" | "failed";
}

const forbiddenThinkingKeys = new Set([
  "raw_thinking",
  "thinking_text",
  "chain_of_thought",
  "hidden_reasoning",
  "thinkingText",
  "rawThinking",
  "chainOfThought",
  "hiddenReasoning",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeEnginePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeEnginePayload);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbiddenThinkingKeys.has(key))
      .map(([key, entry]) => [key, sanitizeEnginePayload(entry)])
  );
}

async function serviceErrorFromResponse(
  response: Response,
  path: string
): Promise<RustHttpLoomEngineError> {
  const baseDetails: Record<string, unknown> = {
    path,
    status: response.status,
    method: "HTTP",
  };
  let payload: unknown;
  let rawText = "";
  try {
    rawText = await response.text();
    payload = rawText ? JSON.parse(rawText) : undefined;
  } catch {
    payload = undefined;
  }
  const sanitizedPayload = sanitizeEnginePayload(payload);
  if (isRecord(sanitizedPayload)) {
    const serviceKind = stringValue(sanitizedPayload, "kind");
    const message =
      stringValue(sanitizedPayload, "message") ??
      messageForHttpStatus(response.status, path);
    const details = isRecord(sanitizedPayload.details)
      ? sanitizeEnginePayload(sanitizedPayload.details)
      : undefined;
    return new RustHttpLoomEngineError(mapServiceErrorKind(serviceKind, response.status), message, {
      ...baseDetails,
      serviceKind,
      providerErrorKind: serviceKind,
      retryable: booleanValue(sanitizedPayload, "retryable"),
      correlationId: stringValue(sanitizedPayload, "correlationId"),
      details,
    });
  }
  return new RustHttpLoomEngineError(mapServiceErrorKind(undefined, response.status), messageForHttpStatus(response.status, path), {
    ...baseDetails,
    responseBodyPresent: Boolean(rawText),
  });
}

function mapServiceErrorKind(
  serviceKind: string | undefined,
  status: number
): RustHttpLoomEngineErrorKind {
  switch (serviceKind) {
    case "invalid_config":
      return "invalid_config";
    case "runtime_unavailable":
    case "timeout_before_first_chunk":
    case "timeout_during_stream":
      return "provider_unavailable";
    case "model_missing":
      return "model_missing";
    case "unexpected_response":
    case "stream_parse_error":
    case "provider_rejected_think":
    case "done_reason_length":
      return "provider_error";
    case "aborted":
      return "request_aborted";
    default:
      if (status === 408 || status === 504) return "timeout";
      if (status === 502 || status === 503) return "provider_unavailable";
      if (status === 400 || status === 422) return "request_failed";
      return "request_failed";
  }
}

function messageForHttpStatus(status: number, path: string): string {
  if (status === 502 || status === 503) {
    return `loom-service provider request failed for ${path}.`;
  }
  if (status === 408 || status === 504) return `loom-service request timed out for ${path}.`;
  if (status === 400 || status === 422) return `loom-service rejected the request for ${path}.`;
  return `loom-service request failed for ${path}.`;
}

export function sanitizeEngineResponseEvent(event: EngineResponseEvent): EngineResponseEvent {
  return {
    ...event,
    payload: sanitizeEnginePayload(event.payload) as EngineResponseEvent["payload"],
  } as EngineResponseEvent;
}

function unsupported(method: string): RustHttpLoomEngineError {
  return new RustHttpLoomEngineError(
    "unsupported_method",
    `RustHttpLoomEngineClient.${method} is not supported by loom-service yet.`,
    { method }
  );
}

function validateResolutionStatus(value: unknown): value is LoomResolutionStatus {
  return (
    value === "resolved" ||
    value === "alias_resolved" ||
    value === "missing" ||
    value === "not_found" ||
    value === "deleted" ||
    value === "invalid" ||
    value === "alias_stale" ||
    value === "snapshot_missing" ||
    value === "window_invalid" ||
    value === "broken_reference"
  );
}

function validateNavigationDestination(value: unknown): value is LoomNavigationDestination {
  if (!isRecord(value)) return false;
  const mode = value.mode;
  const scrollMode = value.scrollMode;
  const source = value.source;
  return (
    typeof value.loomId === "string" &&
    (mode === "full" || mode === "split") &&
    (scrollMode === undefined ||
      scrollMode === "origin" ||
      scrollMode === "lastResponse" ||
      scrollMode === "exact") &&
    (source === "userNavigation" ||
      source === "addressBar" ||
      source === "weftCreate" ||
      source === "returnToOrigin" ||
      source === "backForward") &&
    (value.originLoomId === undefined || typeof value.originLoomId === "string") &&
    (value.originResponseId === undefined || typeof value.originResponseId === "string") &&
    (value.scrollTargetResponseId === undefined ||
      typeof value.scrollTargetResponseId === "string")
  );
}

function graphString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  if ([...forbiddenThinkingKeys].some((key) => lower.includes(key.toLowerCase()))) {
    return "[redacted private reasoning]";
  }
  return value;
}

function validateGraphPosition(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = numberValue(value, "x");
  const y = numberValue(value, "y");
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

function serviceNodeKind(value: unknown): "loom" | "response" | "weft" | undefined {
  return value === "loom" || value === "response" || value === "weft" ? value : undefined;
}

function serviceEdgeKind(value: unknown):
  | "loom_response"
  | "response_sequence"
  | "weft_origin"
  | "reference"
  | "bookmark"
  | undefined {
  return value === "loom_response" ||
    value === "response_sequence" ||
    value === "weft_origin" ||
    value === "reference" ||
    value === "bookmark"
    ? value
    : undefined;
}

function mapServiceNodeKind(
  kind: "loom" | "response" | "weft",
  loomId: string,
  activeLoomId: string | undefined
): LoomGraphProjectionNodeKind {
  if (kind === "response") return "response";
  if (kind === "weft") return "weft";
  return loomId === activeLoomId ? "root" : "weft";
}

function mapServiceEdgeKind(
  kind: "loom_response" | "response_sequence" | "weft_origin" | "reference" | "bookmark"
): LoomGraphProjectionEdgeKind {
  if (kind === "loom_response") return "question";
  if (kind === "response_sequence") return "derived";
  if (kind === "weft_origin") return "weft";
  return kind;
}

function serviceGraphNodeId(node: Record<string, unknown>, activeLoomId: string | undefined) {
  const kind = serviceNodeKind(node.kind);
  const loomId = stringValue(node, "loomId");
  if (!kind || !loomId) return undefined;
  if (kind === "response") {
    const responseId = stringValue(node, "responseId");
    return responseId ? responseGraphNodeId(loomId, responseId) : undefined;
  }
  return loomGraphRootNodeId(loomId || activeLoomId || "");
}

function serviceGraphNodeIsBookmarked(
  node: Record<string, unknown>,
  input: GraphProjectionInput
) {
  const metadata = isRecord(node.metadata) ? node.metadata : {};
  const bookmark = isRecord(metadata.bookmark) ? metadata.bookmark : undefined;
  if (bookmark?.bookmarked === true) return true;

  const bookmarkedAddresses = new Set(input.bookmarkedResponseAddresses ?? []);
  const canonicalUri = graphString(node.canonicalUri);
  return Boolean(canonicalUri && bookmarkedAddresses.has(canonicalUri));
}

function mapServiceGraphProjection(
  value: unknown,
  input: GraphProjectionInput
): LoomGraphProjection {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid graph projection.", {
      endpoint: "/looms/:loomId/graph",
    });
  }

  const nodeIdByServiceId = new Map<string, string>();
  const focusedServiceNodeId = graphString(value.focusedNodeId);
  const nodes: LoomGraphProjectionNode[] = [];
  let firstNodeId: string | undefined;
  let lastNodeId: string | undefined;

  for (const rawNode of value.nodes) {
    if (!isRecord(rawNode)) continue;
    const serviceId = stringValue(rawNode, "id");
    const kind = serviceNodeKind(rawNode.kind);
    const loomId = stringValue(rawNode, "loomId");
    const title = graphString(rawNode.title);
    const depth = numberValue(rawNode, "depth");
    const position = validateGraphPosition(rawNode.position);
    if (!serviceId || !kind || !loomId || !title || typeof depth !== "number" || !position) {
      continue;
    }

    const responseId = graphString(rawNode.responseId);
    const nodeId = serviceGraphNodeId(rawNode, input.activeLoomId);
    if (!nodeId) continue;
    nodeIdByServiceId.set(serviceId, nodeId);
    const mappedKind = mapServiceNodeKind(kind, loomId, input.activeLoomId);
    const isFocused = focusedServiceNodeId === serviceId;
    const node: LoomGraphProjectionNode = {
      id: nodeId,
      kind: mappedKind,
      loomId,
      responseId,
      title,
      code: graphString(rawNode.code),
      displayCode: graphString(rawNode.displayCode),
      summary: graphString(rawNode.preview),
      contentPreview: graphString(rawNode.preview),
      fullContent: graphString(rawNode.preview),
      canonicalUri: graphString(rawNode.canonicalUri),
      isAddressable: Boolean(graphString(rawNode.canonicalUri)),
      isBookmarked: serviceGraphNodeIsBookmarked(rawNode, input),
      isFocused,
      isExpanded: input.expandedNodeIds?.includes(nodeId),
      depth,
      position,
    };
    nodes.push(node);
    if (mappedKind === "response") {
      if (!firstNodeId) firstNodeId = nodeId;
      lastNodeId = nodeId;
    }
  }

  const edges: LoomGraphProjectionEdge[] = [];
  for (const rawEdge of value.edges) {
    if (!isRecord(rawEdge)) continue;
    const serviceId = stringValue(rawEdge, "id");
    const kind = serviceEdgeKind(rawEdge.kind);
    const source = stringValue(rawEdge, "source");
    const target = stringValue(rawEdge, "target");
    if (!serviceId || !kind || !source || !target) continue;
    const mappedSource = nodeIdByServiceId.get(source);
    const mappedTarget = nodeIdByServiceId.get(target);
    if (!mappedSource || !mappedTarget) continue;
    edges.push({
      id: `${mappedSource}->${mappedTarget}`,
      source: mappedSource,
      target: mappedTarget,
      kind: mapServiceEdgeKind(kind),
      label: graphString(rawEdge.label),
      isActivePath: true,
      isWeftPath: kind === "weft_origin",
    });
  }

  const focusedNodeId = focusedServiceNodeId
    ? nodeIdByServiceId.get(focusedServiceNodeId)
    : undefined;
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.map(graphString).filter((warning): warning is string => Boolean(warning))
    : undefined;

  return {
    nodes,
    edges,
    firstNodeId,
    lastNodeId,
    focusedNodeId,
    serviceGraphStatus: nodes.length > 0 ? "resolved" : "empty",
    warnings,
  };
}

function serviceObjectKindToLoomKind(value: unknown): LoomObjectKind | undefined {
  if (value === "response" || value === "bookmark" || value === "fragment") return value;
  if (value === "loom" || value === "weft") return "conversation";
  return undefined;
}

function stringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function booleanValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function validateExportResult(value: unknown, endpoint: string): ExportLoomResult {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid export result.", {
      endpoint,
    });
  }
  const fileName = stringValue(value, "fileName");
  const mimeType = stringValue(value, "mimeType");
  const contentBase64 = stringValue(value, "contentBase64");
  if (!fileName || !mimeType || !contentBase64) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid export artifact.", {
      endpoint,
    });
  }
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  return {
    fileName,
    mimeType,
    contentBase64,
    warnings,
  };
}

function loomKind(value: unknown): "loom" | "weft" | undefined {
  return value === "loom" || value === "weft" ? value : undefined;
}

function weftKindFromMetadata(metadata: unknown): "exploration" | "revision" | undefined {
  if (!isRecord(metadata)) return undefined;
  return metadata.weftKind === "revision" ? "revision" : metadata.weftKind === "exploration" ? "exploration" : undefined;
}

function validateLoomSummary(value: unknown, endpoint: string): LoomSummary {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Loom.", {
      endpoint,
    });
  }
  const loomId = stringValue(value, "loomId");
  const title = stringValue(value, "title");
  if (!loomId || !title) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Loom.", {
      endpoint,
    });
  }
  const metadata = value.metadata as JsonValue | undefined;
  return {
    loomId,
    title,
    summary: stringValue(value, "summary"),
    canonicalUri: stringValue(value, "canonicalUri"),
    code: stringValue(value, "code"),
    displayCode: stringValue(value, "displayCode"),
    kind: loomKind(value.kind),
    originLoomId: stringValue(value, "originLoomId"),
    originResponseId: stringValue(value, "originResponseId"),
    weftKind: weftKindFromMetadata(metadata),
    createdAt: stringValue(value, "createdAt"),
    updatedAt: stringValue(value, "updatedAt"),
    metadata,
  };
}

function validateLoomEnvelope(value: unknown, endpoint: string): CreateLoomResult {
  if (!isRecord(value) || !("loom" in value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Loom response.", {
      endpoint,
    });
  }
  return { loom: validateLoomSummary(value.loom, endpoint) };
}

interface ServiceResponseRow {
  responseId: string;
  role: "user" | "assistant";
  content: string;
  title?: string;
  canonicalUri?: string;
  code?: string;
  displayCode?: string;
  createdAt?: string;
  sequenceIndex: number;
  metadata?: JsonValue;
  codeBlocks: ResponseCodeBlock[];
}

function validateServiceCodeBlock(value: unknown, endpoint: string): ResponseCodeBlock {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid code block.", {
      endpoint,
    });
  }
  const blockIndex = numberValue(value, "blockIndex");
  const code = stringValue(value, "code");
  if (blockIndex === undefined || code === undefined) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid code block.", {
      endpoint,
    });
  }
  return {
    codeBlockId: stringValue(value, "codeBlockId"),
    blockIndex,
    language: stringValue(value, "language"),
    code,
    exactHash: stringValue(value, "exactHash"),
    fence: stringValue(value, "fence"),
  };
}

function validateCodeSnippetReferenceItem(value: unknown, endpoint: string): CodeSnippetReferenceItem {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Code Snippet.", {
      endpoint,
    });
  }
  const codeBlockId = stringValue(value, "codeBlockId");
  const responseId = stringValue(value, "responseId");
  const loomId = stringValue(value, "loomId");
  const blockIndex = numberValue(value, "blockIndex");
  const code = stringValue(value, "code");
  if (!codeBlockId || !responseId || !loomId || blockIndex === undefined || code === undefined) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Code Snippet row.", {
      endpoint,
    });
  }
  return {
    codeBlockId,
    responseId,
    loomId,
    loomTitle: stringValue(value, "loomTitle"),
    sourceResponseTitle: stringValue(value, "sourceResponseTitle"),
    sourceResponseCode: stringValue(value, "sourceResponseCode"),
    sourceCanonicalUri: stringValue(value, "sourceCanonicalUri"),
    blockIndex,
    language: stringValue(value, "language"),
    code,
    exactHash: stringValue(value, "exactHash"),
    fence: stringValue(value, "fence"),
    createdAt: stringValue(value, "createdAt"),
    updatedAt: stringValue(value, "updatedAt"),
  };
}

function validateCodeSnippetList(value: unknown, endpoint: string): ListCodeSnippetsResult {
  if (!isRecord(value) || !Array.isArray(value.codeSnippets)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Code Snippet list.", {
      endpoint,
    });
  }
  return {
    codeSnippets: value.codeSnippets.map((item) => validateCodeSnippetReferenceItem(item, endpoint)),
  };
}

function validateServiceResponseRow(value: unknown, endpoint: string): ServiceResponseRow {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Response row.", {
      endpoint,
    });
  }
  const responseId = stringValue(value, "responseId");
  const role = stringValue(value, "role");
  const content = stringValue(value, "content");
  if (!responseId || (role !== "user" && role !== "assistant") || content === undefined) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Response row.", {
      endpoint,
    });
  }
  return {
    responseId,
    role,
    content,
    title: stringValue(value, "title"),
    canonicalUri: stringValue(value, "canonicalUri"),
    code: stringValue(value, "code"),
    displayCode: stringValue(value, "displayCode"),
    createdAt: stringValue(value, "createdAt"),
    sequenceIndex: numberValue(value, "sequenceIndex") ?? 0,
    metadata: value.metadata as JsonValue | undefined,
    codeBlocks: Array.isArray(value.codeBlocks)
      ? value.codeBlocks.map((codeBlock) => validateServiceCodeBlock(codeBlock, endpoint))
      : [],
  };
}

function splitPersistedAnswer(content: string) {
  const parts = content
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : content.trim() ? [content.trim()] : [];
}

function isGenericQuickAskTitle(title?: string) {
  return /^Ask(?: answer)? \d+$/i.test(title?.trim() ?? "");
}

function fallbackVisibleTitle(question: string, answer: string) {
  const source = answer.trim() || question.trim();
  const firstSentence = source.split(/(?<=[.!?])\s+/)[0] ?? source;
  const normalized = firstSentence.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 72) || "Response";
}

function rowVisibleTitle(row: ServiceResponseRow, question: string) {
  const title = row.title?.trim();
  if (title && !isGenericQuickAskTitle(title)) return title;
  return fallbackVisibleTitle(question, row.content);
}

function isHiddenWeftSeedRow(row: ServiceResponseRow) {
  return isRecord(row.metadata) && row.metadata.source === "weft_visible_seed";
}

function responseMetaFromRow(row: ServiceResponseRow, fallbackTitle: string) {
  if (!row.displayCode && !row.code && !row.canonicalUri && !row.metadata) return undefined;
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  return {
    id: row.responseId,
    title: row.title && !isGenericQuickAskTitle(row.title) ? row.title : fallbackTitle,
    summary:
      typeof metadata.summary === "string"
        ? metadata.summary
        : row.content.slice(0, 160),
    keywords: Array.isArray(metadata.keywords)
      ? metadata.keywords.filter((keyword): keyword is string => typeof keyword === "string")
      : [],
    usageCount: typeof metadata.usageCount === "number" ? metadata.usageCount : 0,
    status: row.canonicalUri ? "addressable" as const : "draft" as const,
    code: row.code,
    displayCode: row.displayCode,
    canonicalUri: row.canonicalUri,
  };
}

function loomObjectTypeValue(value: unknown): LoomLink["type"] | undefined {
  if (
    value === "conversation" ||
    value === "loom" ||
    value === "response" ||
    value === "fragment" ||
    value === "bookmark" ||
    value === "semantic" ||
    value === "recent"
  ) {
    return value;
  }
  return undefined;
}

function referenceTargetKindValue(value: unknown): LoomLink["targetKind"] | undefined {
  if (
    value === "loom" ||
    value === "response" ||
    value === "weft" ||
    value === "fragment" ||
    value === "code_block" ||
    value === "external"
  ) {
    return value;
  }
  return undefined;
}

function referenceDisplayModeValue(value: unknown): LoomLink["referenceDisplayMode"] | undefined {
  return value === "code" || value === "title" ? value : undefined;
}

function loomLinkFromQuestionReference(value: unknown): LoomLink | null {
  const sanitized = sanitizeEnginePayload(value);
  if (!isRecord(sanitized)) return null;

  const targetKind = referenceTargetKindValue(sanitized.targetKind);
  const type =
    loomObjectTypeValue(sanitized.type) ??
    (targetKind === "code_block" || targetKind === "fragment"
      ? "fragment"
      : targetKind === "response"
      ? "response"
      : "conversation");
  const id =
    stringValue(sanitized, "id") ??
    stringValue(sanitized, "targetObjectId") ??
    stringValue(sanitized, "referenceMentionId");
  const title =
    stringValue(sanitized, "title") ??
    stringValue(sanitized, "referenceCustomLabel") ??
    stringValue(sanitized, "selectedText") ??
    id;
  const path =
    stringValue(sanitized, "path") ??
    stringValue(sanitized, "canonicalUri") ??
    stringValue(sanitized, "sourceCanonicalUri") ??
    id;

  if (!id || !title || !path) return null;

  return {
    id,
    type,
    title,
    path,
    badge: stringValue(sanitized, "badge"),
    targetObjectId: stringValue(sanitized, "targetObjectId"),
    targetKind,
    canonicalUri: stringValue(sanitized, "canonicalUri"),
    referenceCode: stringValue(sanitized, "referenceCode"),
    referenceDisplayMode: referenceDisplayModeValue(sanitized.referenceDisplayMode),
    referenceCustomLabel: stringValue(sanitized, "referenceCustomLabel"),
    referenceOccurrenceIndex: numberValue(sanitized, "referenceOccurrenceIndex"),
    referenceMentionId: stringValue(sanitized, "referenceMentionId"),
    resolutionStatus:
      stringValue(sanitized, "resolutionStatus") === "resolved" ? "resolved" : undefined,
    sourceLoomId: stringValue(sanitized, "sourceLoomId"),
    sourceResponseId: stringValue(sanitized, "sourceResponseId"),
    selectedText: stringValue(sanitized, "selectedText"),
    sourceResponseCode: stringValue(sanitized, "sourceResponseCode"),
    sourceResponseTitle: stringValue(sanitized, "sourceResponseTitle"),
    sourceCanonicalUri: stringValue(sanitized, "sourceCanonicalUri"),
    fragmentHash: stringValue(sanitized, "fragmentHash"),
    createdAt: numberValue(sanitized, "createdAt"),
  };
}

function loomLinkFromPlannerReference(value: unknown): LoomLink | null {
  const sanitized = sanitizeEnginePayload(value);
  if (!isRecord(sanitized)) return null;

  const referenceId = stringValue(sanitized, "referenceId");
  const targetKind = referenceTargetKindValue(sanitized.targetKind);
  const targetId = stringValue(sanitized, "targetId");
  const label = stringValue(sanitized, "label");
  const selectedText = stringValue(sanitized, "selectedTextPreview");
  const sourceTitle = stringValue(sanitized, "sourceTitle");
  const id = targetId ?? referenceId;
  const title = label ?? selectedText ?? sourceTitle ?? id;
  if (!referenceId || !id || !title) return null;

  return {
    id,
    type:
      targetKind === "code_block" || targetKind === "fragment"
        ? "fragment"
        : targetKind === "response"
        ? "response"
        : "conversation",
    title,
    path: id,
    badge:
      targetKind === "code_block"
        ? "Code"
        : targetKind === "fragment"
        ? "Fragment"
        : targetKind === "response"
        ? "Response"
        : "Reference",
    targetKind,
    targetObjectId: targetId,
    referenceDisplayMode: "title",
    referenceCustomLabel: label,
    referenceMentionId: referenceId,
    resolutionStatus: "resolved",
    selectedText,
    sourceResponseCode: stringValue(sanitized, "sourceResponseCode"),
    sourceResponseTitle: sourceTitle,
  };
}

function questionReferencesFromRow(row?: ServiceResponseRow | null): LoomLink[] {
  const metadata = isRecord(row?.metadata) ? row.metadata : undefined;
  const questionReferences = metadata?.questionReferences;
  if (Array.isArray(questionReferences)) {
    const parsed = questionReferences
      .map(loomLinkFromQuestionReference)
      .filter((reference): reference is LoomLink => reference !== null);
    if (parsed.length > 0) return parsed;
  }

  const plannerReferences = metadata?.references;
  if (!Array.isArray(plannerReferences)) return [];
  return plannerReferences
    .map(loomLinkFromPlannerReference)
    .filter((reference): reference is LoomLink => reference !== null);
}

function buildResponseItemsFromRows(rows: ServiceResponseRow[]): ResponseItem[] {
  const responses = rows
    .filter((row) => !isHiddenWeftSeedRow(row))
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const items: ResponseItem[] = [];
  let pendingUser: ServiceResponseRow | null = null;
  for (const row of responses) {
    if (row.role === "user") {
      pendingUser = row;
      continue;
    }
    const question = pendingUser?.content.trim() || row.title || "Question";
    const title = rowVisibleTitle(row, question);
    const metadata = isRecord(row.metadata) ? row.metadata : {};
    const workflowRunId = stringValue(metadata, "workflowRunId");
    const serviceGenerationStatus = stringValue(metadata, "status");
    items.push({
      id: row.responseId,
      title,
      address: row.canonicalUri ?? "",
      question,
      questionReferences: questionReferencesFromRow(pendingUser),
      answer: splitPersistedAnswer(row.content),
      finalContent: row.content,
      codeBlocks: row.codeBlocks,
      suggestedLinks: [],
      bookmarkedLinks: [],
      createdAt: row.createdAt,
      workflowRunId,
      serviceGenerationStatus,
      serviceUserResponseId: pendingUser?.responseId,
      meta: responseMetaFromRow(row, title),
    });
    pendingUser = null;
  }
  if (pendingUser) {
    const question = pendingUser.content.trim();
    const title =
      pendingUser.title && !isGenericQuickAskTitle(pendingUser.title)
        ? pendingUser.title
        : question.slice(0, 72) || "Question";
    items.push({
      id: pendingUser.responseId,
      title,
      address: pendingUser.canonicalUri ?? "",
      question,
      questionReferences: questionReferencesFromRow(pendingUser),
      answer: [],
      finalContent: "",
      suggestedLinks: [],
      bookmarkedLinks: [],
      createdAt: pendingUser.createdAt,
      workflowRunId: isRecord(pendingUser.metadata)
        ? stringValue(pendingUser.metadata, "workflowRunId")
        : undefined,
      serviceGenerationStatus: isRecord(pendingUser.metadata)
        ? stringValue(pendingUser.metadata, "status")
        : undefined,
      serviceUserResponseId: pendingUser.responseId,
      meta: responseMetaFromRow(pendingUser, title),
    });
  }
  return items;
}

function validateWeftEnvelope(
  value: unknown,
  endpoint: string,
  input: CreateOrOpenWeftInput
): CreateOrOpenWeftResult {
  if (!isRecord(value) || !("weft" in value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Weft response.", {
      endpoint,
    });
  }
  const weft = validateLoomSummary(value.weft, endpoint);
  const created = value.created === true;
  const reused = value.reused === true;
  const visibleSeedResponses = Array.isArray(value.visibleSeedResponses)
    ? value.visibleSeedResponses.map((response) => validateVisibleWeftSeedResponse(response, endpoint))
    : [];
  return {
    loomId: weft.loomId,
    created,
    reused,
    weft,
    visibleSeedResponses,
    originContextSnapshotId: stringValue(value, "originContextSnapshotId"),
    warnings: arrayOfStrings(value.warnings),
    navigationDestination: {
      loomId: weft.loomId,
      mode: "split",
      originLoomId: input.originLoomId,
      originResponseId: input.originResponseId,
      source: "weftCreate",
    },
  };
}

function validateVisibleWeftSeedResponse(value: unknown, endpoint: string): VisibleWeftSeedResponse {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid visible Weft seed.", {
      endpoint,
    });
  }
  const responseId = stringValue(value, "responseId");
  const role = stringValue(value, "role");
  const content = stringValue(value, "content");
  const sequenceIndex = typeof value.sequenceIndex === "number" ? value.sequenceIndex : undefined;
  if (!responseId || (role !== "user" && role !== "assistant") || content === undefined || sequenceIndex === undefined) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid visible Weft seed.", {
      endpoint,
    });
  }
  return {
    responseId,
    role,
    content,
    title: stringValue(value, "title"),
    sequenceIndex,
    copiedFromResponseId: stringValue(value, "copiedFromResponseId"),
  };
}

function validateLoomDetail(value: unknown, endpoint: string): LoomDetail {
  if (!isRecord(value) || !isRecord(value.loom)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Loom detail.", {
      endpoint,
    });
  }
  const summary = validateLoomSummary(value.loom, endpoint);
  const responses = Array.isArray(value.loom.responses) ? value.loom.responses : [];
  return {
    ...summary,
    responses: buildResponseItemsFromRows(
      responses.map((response) => validateServiceResponseRow(response, endpoint))
    ),
  };
}

function statusFromHealth(value: unknown): ServiceHealthStatus["status"] {
  return value === "ready" ? "ready" : value === "degraded" ? "degraded" : "unavailable";
}

function serviceStatusUnavailable(serviceUrl: string, error: unknown): ServiceHealthStatus {
  return {
    status: "unavailable",
    runtime: "rust-service",
    serviceUrl,
    lastCheckedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : "loom-service is unavailable.",
  };
}

function configStatusUnavailable(error: unknown): ServiceConfigStatus {
  return {
    status: "unavailable",
    lastCheckedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : "loom-service config is unavailable.",
  };
}

function speechProviderKind(value: unknown): SpeechToTextProviderKind {
  if (
    value === "disabled" ||
    value === "mock_test" ||
    value === "local_command" ||
    value === "openai" ||
    value === "azure_openai"
  ) {
    return value;
  }
  return "disabled";
}

function nullableStringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function validateSpeechConfig(value: unknown): SpeechToTextRuntimeConfig {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned invalid speech config.", {
      endpoint: "/config",
    });
  }
  return {
    enabled: booleanValue(value, "enabled") ?? false,
    defaultProviderKind: speechProviderKind(value.defaultProviderKind),
    allowCloudStt: booleanValue(value, "allowCloudStt") ?? false,
    persistAudio: booleanValue(value, "persistAudio") ?? false,
    persistTranscript: booleanValue(value, "persistTranscript") ?? false,
    maxAudioBytes: numberValue(value, "maxAudioBytes") ?? 0,
    allowedMimeTypes: arrayOfStrings(value.allowedMimeTypes),
    defaultLanguage: nullableStringValue(value, "defaultLanguage"),
    providerProfileId: nullableStringValue(value, "providerProfileId"),
    localCommandPath: nullableStringValue(value, "localCommandPath"),
    localCommandArgs: arrayOfStrings(value.localCommandArgs),
    localCommandTimeoutMs: numberValue(value, "localCommandTimeoutMs") ?? 0,
    localTempDir: nullableStringValue(value, "localTempDir"),
    localCommandOutputMode: value.localCommandOutputMode === "file" ? "file" : "stdout",
    localCommandTranscriptFileExtension:
      stringValue(value, "localCommandTranscriptFileExtension") ?? "txt",
    warnings: arrayOfStrings(value.warnings),
  };
}

function validateSpeechProviderHealth(value: unknown): SpeechProviderHealth {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned invalid speech provider health.", {
      endpoint: "/speech/provider/health",
    });
  }
  const status = stringValue(value, "status") ?? "unavailable";
  return {
    status: (
      [
        "configured",
        "missing_command",
        "command_not_found",
        "command_not_executable",
        "invalid_args",
        "temp_dir_unavailable",
        "provider_unavailable",
        "unavailable",
      ] as const
    ).includes(status as SpeechProviderHealth["status"])
      ? (status as SpeechProviderHealth["status"])
      : "unavailable",
    providerKind: stringValue(value, "providerKind") ?? "unknown",
    message: stringValue(value, "message") ?? "Speech-to-Text provider health is unavailable.",
    checks: arrayOfStrings(value.checks),
  };
}

function validateServiceConfig(value: unknown): LoomServiceRuntimeConfig {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned invalid config.", {
      endpoint: "/config",
    });
  }
  const database = isRecord(value.database)
    ? { path: stringValue(value.database, "path") }
    : undefined;
  return {
    speech: validateSpeechConfig(value.speech),
    database,
  };
}

function validateConfigUpdateResult(value: unknown): ServiceConfigUpdateResult {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned invalid config update result.", {
      endpoint: "/config",
    });
  }
  const restartClassification = isRecord(value.restartClassification)
    ? {
        restartRequired: booleanValue(value.restartClassification, "restartRequired"),
        reason: nullableStringValue(value.restartClassification, "reason"),
        changedPaths: arrayOfStrings(value.restartClassification.changedPaths),
      }
    : undefined;
  const restartStatus = isRecord(value.restartStatus)
    ? {
        restartRequired: booleanValue(value.restartStatus, "restartRequired"),
        pendingRestart: booleanValue(value.restartStatus, "pendingRestart"),
      }
    : undefined;
  return {
    config: validateServiceConfig(value.config),
    restartClassification,
    restartStatus,
  };
}

function capabilityUnavailable(error: unknown): CapabilitySummary {
  return {
    status: "unavailable",
    strategyAvailable: false,
    lastCheckedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : "loom-service capabilities are unavailable.",
  };
}

function mapReferenceForService(reference: LoomLink) {
  const targetKind = reference.targetKind ?? reference.type;
  return {
    referenceId: reference.referenceMentionId ?? reference.id,
    label: reference.referenceCustomLabel ?? reference.title,
    selectedTextPreview: reference.selectedText,
    targetKind,
    targetId: reference.targetObjectId ?? reference.id,
    sourceResponseCode: reference.sourceResponseCode,
    sourceTitle: reference.title,
  };
}

function cancelStatusFromService(value: unknown): CancelMessageResult["status"] {
  if (value === "cancelled" || value === "not_found" || value === "already_completed") {
    return value;
  }
  return "failed";
}

function validateCancelResponse(
  response: unknown,
  input: CancelMessageInput,
  endpoint: string
): CancelMessageResult {
  if (!isRecord(response)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid cancel response.", {
      endpoint,
    });
  }
  const workflowRunId = stringValue(response, "workflowRunId") ?? stringValue(response, "runId");
  if (!workflowRunId) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service cancel response did not include a run id.", {
      endpoint,
    });
  }
  const serviceStatus = stringValue(response, "status");
  const status = serviceStatus
    ? cancelStatusFromService(serviceStatus)
    : booleanValue(response, "cancelled")
      ? "cancelled"
      : "not_found";
  return {
    status,
    workflowRunId,
    responseId: stringValue(response, "responseId") ?? input.responseId,
    error: stringValue(response, "error"),
  };
}

function validateGenerationResponseSummary(
  value: unknown,
  endpoint: string
): GenerationResponseSummary | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError(
      "invalid_response",
      "loom-service returned an invalid generation response summary.",
      { endpoint }
    );
  }
  const responseId = stringValue(value, "responseId");
  const loomId = stringValue(value, "loomId");
  const role = stringValue(value, "role");
  const content = stringValue(value, "content");
  const updatedAt = stringValue(value, "updatedAt");
  if (!responseId || !loomId || (role !== "user" && role !== "assistant") || content === undefined || !updatedAt) {
    throw new RustHttpLoomEngineError(
      "invalid_response",
      "loom-service returned an incomplete generation response summary.",
      { endpoint }
    );
  }
  return {
    responseId,
    loomId,
    role,
    content,
    sequenceIndex: numberValue(value, "sequenceIndex") ?? 0,
    status: stringValue(value, "status"),
    metadata: sanitizeEnginePayload(value.metadata) as JsonValue | undefined,
    updatedAt,
  };
}

function validateGenerationResponseState(
  response: unknown,
  workflowRunId: string,
  endpoint: string
): GenerationResponseStateResult {
  if (!isRecord(response)) {
    throw new RustHttpLoomEngineError(
      "invalid_response",
      "loom-service returned an invalid generation response state.",
      { endpoint }
    );
  }
  const runId = stringValue(response, "runId") ?? stringValue(response, "workflowRunId") ?? workflowRunId;
  const status = stringValue(response, "status");
  if (!runId || !status) {
    throw new RustHttpLoomEngineError(
      "invalid_response",
      "loom-service generation response state did not include run status.",
      { endpoint }
    );
  }
  return {
    workflowRunId: runId,
    loomId: stringValue(response, "loomId"),
    userResponse: validateGenerationResponseSummary(response.userResponse, endpoint),
    assistantResponse: validateGenerationResponseSummary(response.assistantResponse, endpoint),
    status,
    canResume: booleanValue(response, "canResume") ?? false,
    liveTailSupported: booleanValue(response, "liveTailSupported") ?? false,
  };
}

function serviceResponseMode(mode: SendMessageInput["responseMode"]) {
  return mode;
}

function executePayload(input: SendMessageInput) {
  return {
    loomId: input.loomId,
    responseId: input.focusedResponseId,
    prompt: input.promptText,
    references: input.references.map(mapReferenceForService),
    responseMode: serviceResponseMode(input.responseMode),
    model: input.model ?? "qwen3:latest",
    options: input.options
      ? {
          numCtx: input.options.numCtx,
          numPredict: input.options.numPredict,
          temperature: input.options.temperature,
        }
      : undefined,
    persistWorkflow: input.persistWorkflow ?? true,
  };
}

function regeneratePayload(input: RegenerateFromResponseInput) {
  return {
    responseMode: serviceResponseMode(input.responseMode),
    replaceStale: false,
    source: input.source ?? "prompt_edit_regenerate",
    model: input.model ?? "qwen3:latest",
    options: input.options
      ? {
          numCtx: input.options.numCtx,
          numPredict: input.options.numPredict,
          temperature: input.options.temperature,
        }
      : undefined,
  };
}

function quickAskPayload(input: QuickAskInput) {
  return {
    sessionId: input.sessionId,
    quickAskTraceId: input.quickAskTraceId,
    sourceLoomId: input.sourceLoomId,
    sourceResponseId: input.sourceResponseId,
    selectedText: input.selectedText,
    sourceContext: input.sourceContext,
    activeReferences: input.activeReferences,
    turns: input.turns,
    question: input.question,
    intent: input.intent,
    options: input.options,
  };
}

function createWeftPayload(input: CreateOrOpenWeftInput) {
  return {
    originLoomId: input.originLoomId,
    originResponseId: input.originResponseId,
    weftKind: input.weftKind,
    title: input.title,
    initialPrompt: input.initialPrompt,
    summary: input.summary,
    reuseExisting: input.reuseExisting ?? true,
    source: input.source ?? "response_action",
    seedMode: input.seedMode,
    createOriginContextSnapshot: input.createOriginContextSnapshot,
    metadata: sanitizeEnginePayload(input.metadata),
  };
}

function persistWeftTurnsPayload(input: PersistWeftTurnsInput) {
  return {
    source: "quick_ask_convert",
    originLoomId: input.originLoomId,
    originResponseId: input.originResponseId,
    selectedText: input.selectedText,
    fragmentHash: input.fragmentHash,
    sourceMetadata: sanitizeEnginePayload(input.sourceMetadata),
    turns: input.turns.map((turn) => ({
      id: turn.id,
      question: turn.question,
      answer: turn.answer,
      title: turn.title,
      createdAt: turn.createdAt,
      metadata: sanitizeEnginePayload(turn.metadata),
    })),
  };
}

function updateResponsePayload(input: UpdateResponseInput) {
  return {
    content: input.content,
    metadata: sanitizeEnginePayload(input.metadata),
    editReason: input.editReason ?? "user_prompt_edit",
    markDownstreamStale: input.markDownstreamStale ?? true,
  };
}

function validateUpdateResponseResponse(value: unknown, endpoint: string): UpdateResponseResult {
  if (!isRecord(value) || !isRecord(value.response) || !Array.isArray(value.staleResponses)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Response update.", {
      endpoint,
    });
  }
  const responseId = stringValue(value.response, "responseId");
  const loomId = stringValue(value.response, "loomId");
  const role = stringValue(value.response, "role");
  const content = stringValue(value.response, "content");
  const updatedAt = stringValue(value.response, "updatedAt");
  if (!responseId || !loomId || (role !== "user" && role !== "assistant") || content === undefined || !updatedAt) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Response update.", {
      endpoint,
    });
  }
  return {
    response: {
      responseId,
      loomId,
      role,
      content,
      updatedAt,
      metadata: value.response.metadata as JsonValue | undefined,
    },
    staleResponses: value.staleResponses.map((stale) => {
      if (!isRecord(stale)) {
        throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid stale Response.", {
          endpoint,
        });
      }
      const staleResponseId = stringValue(stale, "responseId");
      const staleRole = stringValue(stale, "role");
      const staleReason = stringValue(stale, "staleReason");
      if (!staleResponseId || staleRole !== "assistant" || staleReason !== "prompt_edited") {
        throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid stale Response.", {
          endpoint,
        });
      }
      return {
        responseId: staleResponseId,
        role: "assistant",
        stale: booleanValue(stale, "stale") ?? false,
        staleReason: "prompt_edited",
      };
    }),
  };
}

function validatePersistedWeftTurn(value: unknown, endpoint: string): PersistedWeftTurn {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid persisted Weft turn.", {
      endpoint,
    });
  }
  const userResponseId = stringValue(value, "userResponseId");
  const assistantResponseId = stringValue(value, "assistantResponseId");
  const question = stringValue(value, "question");
  const answer = stringValue(value, "answer");
  const sequenceIndex = typeof value.sequenceIndex === "number" ? value.sequenceIndex : undefined;
  if (!userResponseId || !assistantResponseId || question === undefined || answer === undefined || sequenceIndex === undefined) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid persisted Weft turn.", {
      endpoint,
    });
  }
  return { userResponseId, assistantResponseId, question, answer, title: stringValue(value, "title"), sequenceIndex };
}

function validatePersistWeftTurnsResponse(value: unknown, endpoint: string): PersistWeftTurnsResult {
  if (!isRecord(value) || !Array.isArray(value.responses)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Weft turn persistence response.", {
      endpoint,
    });
  }
  const weftLoomId = stringValue(value, "weftLoomId");
  if (!weftLoomId) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Weft turn persistence response.", {
      endpoint,
    });
  }
  return {
    weftLoomId,
    responses: value.responses.map((response) => validatePersistedWeftTurn(response, endpoint)),
    originContextSnapshotId: stringValue(value, "originContextSnapshotId"),
    warnings: arrayOfStrings(value.warnings),
  };
}

function validateQuickAskResponse(response: unknown): QuickAskResult {
  if (!isRecord(response)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Quick Ask response.", {
      endpoint: "/ask/quick",
    });
  }
  const answer = stringValue(response, "answer");
  if (answer === undefined) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service Quick Ask response did not include an answer.", {
      endpoint: "/ask/quick",
    });
  }
  const result: QuickAskResult = {
    answer,
    title: stringValue(response, "title"),
    model: stringValue(response, "model"),
    warnings: Array.isArray(response.warnings)
      ? response.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
    focusSubject: stringValue(response, "focusSubject"),
    focusSubjectSource: stringValue(response, "focusSubjectSource"),
    resolvedIntent: stringValue(response, "resolvedIntent"),
    requestedTopic: stringValue(response, "requestedTopic"),
  };
  if (response.diagnostics !== undefined) {
    result.diagnostics = response.diagnostics as JsonValue;
  }
  return result;
}

function validateTranscribeSpeechResponse(
  response: unknown,
  endpoint: string
): TranscribeSpeechResult {
  if (!isRecord(response)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Speech-to-Text response.", {
      endpoint,
    });
  }
  const transcript = stringValue(response, "transcript");
  const provider = stringValue(response, "provider");
  const retention = isRecord(response.retention) ? response.retention : undefined;
  const audioPersisted =
    retention && typeof retention.audioPersisted === "boolean"
      ? retention.audioPersisted
      : undefined;
  const transcriptPersisted =
    retention && typeof retention.transcriptPersisted === "boolean"
      ? retention.transcriptPersisted
      : undefined;

  if (
    transcript === undefined ||
    !provider ||
    audioPersisted === undefined ||
    transcriptPersisted === undefined
  ) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an incomplete Speech-to-Text response.", {
      endpoint,
    });
  }

  return {
    transcript,
    language: stringValue(response, "language"),
    confidence: typeof response.confidence === "number" ? response.confidence : undefined,
    provider,
    warnings: arrayOfStrings(response.warnings),
    retention: {
      audioPersisted,
      transcriptPersisted,
    },
  };
}

function quickAskTransportDiagnostics(
  result: QuickAskResult,
  input: QuickAskInput,
  transportMeta: RequestJsonTransportMeta
): JsonValue {
  const serviceDiagnostics = isRecord(result.diagnostics) ? result.diagnostics : {};
  const diagnosticsReceived = isRecord(result.diagnostics);
  const inputActiveReferenceLabels =
    Array.isArray(serviceDiagnostics.inputActiveReferenceLabels) &&
    serviceDiagnostics.inputActiveReferenceLabels.some((entry) => typeof entry === "string")
      ? serviceDiagnostics.inputActiveReferenceLabels
      : (input.activeReferences ?? [])
          .map((reference) => reference.label.trim())
          .filter((label) => label.length > 0);
  const warnings = [
    ...arrayOfStrings(serviceDiagnostics.warnings),
    ...result.warnings,
    ...(diagnosticsReceived ? [] : ["service_diagnostics_missing"]),
    ...(inputActiveReferenceLabels.length > 0 ? [] : ["no_active_references_sent"]),
  ];
  return sanitizeEnginePayload({
    ...serviceDiagnostics,
    traceId:
      typeof serviceDiagnostics.traceId === "string"
        ? serviceDiagnostics.traceId
        : input.quickAskTraceId,
    engineMode: "rust-service",
    clientKind: "rust-http",
    requestAttempted: transportMeta.requestAttempted,
    endpoint: transportMeta.endpoint,
    httpStatus: transportMeta.httpStatus,
    responseParseStatus: transportMeta.responseParseStatus ?? "not_started",
    diagnosticsReceived,
    serviceRequestReceived: diagnosticsReceived,
    selectedText:
      typeof serviceDiagnostics.selectedText === "string"
        ? serviceDiagnostics.selectedText
        : input.selectedText,
    inputActiveReferenceLabels,
    warnings: Array.from(new Set(warnings)),
  }) as JsonValue;
}

function referenceTargetKind(link: LoomLink): "loom" | "response" | "weft" | "fragment" | "external" {
  if (link.type === "fragment") return "fragment";
  if (link.type === "response") return "response";
  if (link.type === "conversation" || link.type === "loom") return "loom";
  return "external";
}

function createReferencePayload(input: AddReferenceInput) {
  const reference = input.reference;
  const inputMetadata = isRecord(input.metadata) ? input.metadata : {};
  const metadataTargetKind = stringValue(inputMetadata, "targetKind");
  const codeBlockId = stringValue(inputMetadata, "codeBlockId");
  const targetKind =
    metadataTargetKind === "code_block" || reference.targetKind === "code_block"
      ? "code_block"
      : referenceTargetKind(reference);
  return {
    sourceLoomId: reference.sourceLoomId ?? input.loomId,
    sourceResponseId: input.sourceResponseId ?? reference.sourceResponseId,
    targetKind,
    targetId:
      targetKind === "code_block"
        ? codeBlockId ?? reference.targetObjectId ?? reference.id
        : targetKind === "fragment"
        ? reference.sourceResponseId ?? reference.targetObjectId ?? reference.id
        : reference.targetObjectId ?? reference.id,
    targetUri: reference.canonicalUri ?? reference.path,
    label: reference.referenceCustomLabel ?? reference.title,
    selectedText: reference.selectedText,
    fragmentHash: reference.fragmentHash,
    metadata: sanitizeEnginePayload({
      ...inputMetadata,
      referenceCode: reference.referenceCode,
      referenceDisplayMode: reference.referenceDisplayMode,
      sourceResponseCode: reference.sourceResponseCode,
      sourceResponseTitle: reference.sourceResponseTitle,
      sourceCanonicalUri: reference.sourceCanonicalUri,
      badge: reference.badge,
    }),
  };
}

function validateServiceReference(value: unknown, endpoint: string): LoomLink {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Reference.", {
      endpoint,
    });
  }
  const referenceId = stringValue(value, "referenceId");
  const targetKind = stringValue(value, "targetKind");
  const targetUri = stringValue(value, "targetUri");
  const targetId = stringValue(value, "targetId");
  if (!referenceId || !targetKind) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Reference.", {
      endpoint,
    });
  }
  const selectedText = stringValue(value, "selectedText");
  const label = stringValue(value, "label");
  const sourceLoomId = stringValue(value, "sourceLoomId");
  const sourceResponseId = stringValue(value, "sourceResponseId");
  const fragmentHash = stringValue(value, "fragmentHash");
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  const sourceResponseCode = metadata ? stringValue(metadata, "sourceResponseCode") : undefined;
  const sourceResponseTitle = metadata ? stringValue(metadata, "sourceResponseTitle") : undefined;
  const sourceCanonicalUri = metadata ? stringValue(metadata, "sourceCanonicalUri") : undefined;
  const referenceCode = metadata ? stringValue(metadata, "referenceCode") : undefined;
  const referenceDisplayMode =
    metadata && stringValue(metadata, "referenceDisplayMode") === "code" ? "code" : "title";
  const type = targetKind === "fragment" || targetKind === "code_block" ? "fragment" : targetKind === "response" ? "response" : "conversation";
  return {
    id: targetId ?? referenceId,
    type,
    title: label ?? selectedText ?? targetUri ?? targetId ?? referenceId,
    path: targetUri ?? targetId ?? referenceId,
    badge: targetKind === "code_block" ? "Code" : targetKind === "fragment" ? "Fragment" : targetKind === "response" ? "Response" : "Reference",
    targetKind: targetKind === "code_block" ? "code_block" : undefined,
    targetObjectId: targetId,
    canonicalUri: targetUri,
    referenceCode,
    referenceDisplayMode,
    referenceCustomLabel: label,
    referenceMentionId: referenceId,
    resolutionStatus: "resolved",
    sourceLoomId,
    sourceResponseId,
    selectedText,
    sourceResponseCode,
    sourceResponseTitle,
    sourceCanonicalUri,
    fragmentHash,
  };
}

function validateReferenceEnvelope(value: unknown, endpoint: string): AddReferenceResult {
  if (!isRecord(value) || !isRecord(value.reference)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Reference response.", {
      endpoint,
    });
  }
  return {
    reference: validateServiceReference(value.reference, endpoint),
    reused: booleanValue(value, "reused"),
  };
}

function validateReferenceList(value: unknown, endpoint: string): ListReferencesResult {
  if (!isRecord(value) || !Array.isArray(value.references)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Reference list.", {
      endpoint,
    });
  }
  return {
    references: value.references.map((reference) => validateServiceReference(reference, endpoint)),
  };
}

function validateReferenceSuggestions(value: unknown, endpoint: string): SuggestReferencesResult {
  if (!isRecord(value) || !Array.isArray(value.suggestions)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned invalid Reference suggestions.", {
      endpoint,
    });
  }
  return {
    suggestions: value.suggestions
      .filter(isRecord)
      .map((suggestion) => ({
        reference: validateServiceReference(suggestion.reference, endpoint),
        score: numberValue(suggestion, "score") ?? 0,
        reason: stringValue(suggestion, "reason"),
      })),
  };
}

function validateServiceBookmark(value: unknown, endpoint: string): BookmarkItem {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Bookmark.", {
      endpoint,
    });
  }
  const bookmarkId = stringValue(value, "bookmarkId");
  const targetKind = stringValue(value, "targetKind");
  const title = stringValue(value, "title");
  if (!bookmarkId || !targetKind || !title) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Bookmark.", {
      endpoint,
    });
  }
  const targetId = stringValue(value, "targetId");
  const targetUri = stringValue(value, "targetUri");
  const createdAt = stringValue(value, "createdAt");
  const metadata = isRecord(value.metadata)
    ? (sanitizeEnginePayload(value.metadata) as unknown as BookmarkItem["meta"])
    : undefined;
  const type =
    targetKind === "response"
      ? "response"
      : targetKind === "fragment"
        ? "fragment"
        : "conversation";
  return {
    id: bookmarkId,
    type,
    title,
    editableTitle: title,
    path: targetUri ?? targetId ?? bookmarkId,
    badge: "Bookmark",
    targetObjectId: targetId,
    canonicalUri: targetUri,
    selectedAt: createdAt ? Date.parse(createdAt) || Date.now() : Date.now(),
    lastUsed: createdAt ?? "",
    meta: metadata,
    referenceCode: metadata?.code,
  };
}

function validateBookmarkEnvelope(value: unknown, endpoint: string): BookmarkResult {
  if (!isRecord(value) || !isRecord(value.bookmark)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Bookmark response.", {
      endpoint,
    });
  }
  return {
    bookmark: validateServiceBookmark(value.bookmark, endpoint),
    reused: booleanValue(value, "reused"),
  };
}

function validateBookmarkList(value: unknown, endpoint: string): ListBookmarksResult {
  if (!isRecord(value) || !Array.isArray(value.bookmarks)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Bookmark list.", {
      endpoint,
    });
  }
  return {
    bookmarks: value.bookmarks.map((bookmark) => validateServiceBookmark(bookmark, endpoint)),
  };
}

function loomLinkType(value: unknown): HistoryEntry["type"] {
  if (
    value === "conversation" ||
    value === "response" ||
    value === "recent" ||
    value === "bookmark" ||
    value === "fragment" ||
    value === "loom"
  ) {
    return value;
  }
  return "conversation";
}

function validateServiceHistoryEntry(value: unknown, endpoint: string): HistoryEntry {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid History entry.", {
      endpoint,
    });
  }
  const id = stringValue(value, "id");
  const title = stringValue(value, "title");
  const path = stringValue(value, "path");
  const visitedAt = stringValue(value, "visitedAt");
  if (!id || !title || !path || !visitedAt) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid History entry.", {
      endpoint,
    });
  }
  return {
    id,
    type: loomLinkType(value.type),
    title,
    path,
    badge: stringValue(value, "badge"),
    targetObjectId: stringValue(value, "targetObjectId"),
    canonicalUri: stringValue(value, "canonicalUri"),
    referenceCode: stringValue(value, "referenceCode"),
    visitedAt,
    navigationDestination: validateNavigationDestination(value.navigationDestination)
      ? value.navigationDestination
      : undefined,
    meta: isRecord(value.meta)
      ? (sanitizeEnginePayload(value.meta) as unknown as HistoryEntry["meta"])
      : undefined,
  };
}

function validateHistoryList(value: unknown, endpoint: string): ListHistoryResult {
  if (!isRecord(value) || !Array.isArray(value.history)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid History list.", {
      endpoint,
    });
  }
  return {
    history: value.history.map((entry) => validateServiceHistoryEntry(entry, endpoint)),
  };
}

function validateHistoryEnvelope(value: unknown, endpoint: string): HistoryEntry {
  if (!isRecord(value) || !isRecord(value.entry)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid History response.", {
      endpoint,
    });
  }
  return validateServiceHistoryEntry(value.entry, endpoint);
}

function validateUiStateRecord(value: unknown, endpoint: string): UiStateRecord {
  if (!isRecord(value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid UI state.", {
      endpoint,
    });
  }
  const key = stringValue(value, "key");
  if (!key || !("value" in value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid UI state.", {
      endpoint,
    });
  }
  return {
    key,
    value: sanitizeEnginePayload(value.value) as JsonValue,
    updatedAt: stringValue(value, "updatedAt"),
  };
}

function validateUiStateEnvelope(value: unknown, endpoint: string): GetUiStateResult {
  if (!isRecord(value) || !("state" in value)) {
    throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid UI state response.", {
      endpoint,
    });
  }
  return {
    state: value.state === null ? null : validateUiStateRecord(value.state, endpoint),
  };
}

function bookmarkPayload(input: CreateBookmarkInput) {
  return {
    targetKind: input.targetKind,
    targetId: input.targetId,
    targetUri: input.targetUri,
    title: input.title,
    metadata: sanitizeEnginePayload(input.metadata),
  };
}

function parseSseEvents(buffer: { text: string }, chunk: string): string[] {
  buffer.text += chunk;
  const events: string[] = [];
  let separatorIndex = buffer.text.indexOf("\n\n");
  while (separatorIndex >= 0) {
    const rawEvent = buffer.text.slice(0, separatorIndex);
    buffer.text = buffer.text.slice(separatorIndex + 2);
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) events.push(data);
    separatorIndex = buffer.text.indexOf("\n\n");
  }
  return events;
}

function servicePayloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function mapServiceEventToEngineEvents(value: unknown): EngineResponseEvent[] {
  if (!isRecord(value)) return [];
  const eventType = stringValue(value, "type");
  const payload = isRecord(value.payload) ? value.payload : {};
  const runId = servicePayloadString(payload, "runId") ?? stringValue(value, "correlationId");
  const loomId = servicePayloadString(payload, "loomId");
  const loomTitle = servicePayloadString(payload, "loomTitle");
  const assistantResponseId = servicePayloadString(payload, "assistantResponseId");
  const userResponseId = servicePayloadString(payload, "userResponseId");
  const responseId = assistantResponseId ?? servicePayloadString(payload, "responseId");

  if (eventType === "response.placeholder_created") {
    const events: EngineResponseEvent[] = [];
    if (loomId && userResponseId) {
      events.push({
        type: "user_message_created",
        payload: { loomId, responseId: userResponseId, workflowRunId: runId, loomTitle },
      });
    }
    if (loomId && assistantResponseId) {
      events.push({
        type: "assistant_placeholder_created",
        payload: { loomId, responseId: assistantResponseId, workflowRunId: runId, loomTitle },
      });
    }
    return events;
  }

  if (eventType === "answer_plan.ready") {
    return [{ type: "answer_plan_ready", payload: { plan: payload.answerPlan as JsonValue } }];
  }

  if (eventType === "context.ready") {
    const readiness = isRecord(payload.readiness) ? payload.readiness : {};
    const artifacts = Array.isArray(readiness.requiredArtifacts) ? readiness.requiredArtifacts : [];
    return [
      {
        type: "context_ready",
        payload: {
          contextBlockCount: artifacts.length,
          numCtx: numberValue(payload, "numCtx"),
        },
      },
    ];
  }

  if (eventType === "orchestration.progress") {
    const thinking = isRecord(payload.thinking) ? payload.thinking : undefined;
    if (thinking) {
      return [
        {
          type: "thinking_status",
          payload: {
            status: "running",
            durationMs: numberValue(thinking, "durationMs"),
          },
        },
      ];
    }
    return [{ type: "status", payload: { message: "Working...", stage: servicePayloadString(payload, "stage") } }];
  }

  if (eventType === "response.delta" && responseId) {
    return [
      {
        type: "content_delta",
        payload: { responseId, delta: servicePayloadString(payload, "delta") ?? "" },
      },
    ];
  }

  if (eventType === "response.completed" && responseId) {
    return [
      {
        type: "response_completed",
        payload: { responseId, doneReason: servicePayloadString(payload, "doneReason"), loomTitle },
      },
    ];
  }

  if (eventType === "response.truncated" && responseId) {
    return [
      {
        type: "response_truncated",
        payload: { responseId, doneReason: servicePayloadString(payload, "doneReason"), loomTitle },
      },
    ];
  }

  if (eventType === "response.cancelled") {
    return [
      {
        type: "response_cancelled",
        payload: { responseId, message: "Response cancelled.", workflowRunId: runId },
      },
    ];
  }

  if (eventType === "response.error") {
    return [
      {
        type: "response_error",
        payload: {
          responseId,
          code: servicePayloadString(payload, "kind"),
          message: servicePayloadString(payload, "message") ?? "loom-service generation failed.",
          workflowRunId: runId,
        },
      },
    ];
  }

  return [];
}

export class RustHttpLoomEngineClient implements LoomEngineClient {
  private readonly serviceUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RustHttpLoomEngineClientOptions) {
    this.serviceUrl = options.serviceUrl.replace(/\/+$/g, "");
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async requestJson<T>(
    path: string,
    options: RequestInit & {
      timeoutMs?: number;
      onTransportMeta?: (meta: RequestJsonTransportMeta) => void;
    } = {}
  ): Promise<T> {
    const { timeoutMs, onTransportMeta, ...fetchOptions } = options;
    const controller = new AbortController();
    let timedOut = false;
    const abortFromInputSignal = () => controller.abort();
    if (fetchOptions.signal?.aborted) {
      controller.abort();
    } else {
      fetchOptions.signal?.addEventListener("abort", abortFromInputSignal, { once: true });
    }
    const timeout = globalThis.setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      timeoutMs ?? this.requestTimeoutMs
    );
    const transportMeta: RequestJsonTransportMeta = {
      endpoint: path,
      requestAttempted: true,
      responseParseStatus: "not_started",
    };
    try {
      const response = await this.fetchImpl(`${this.serviceUrl}${path}`, {
        ...fetchOptions,
        headers: {
          "Content-Type": "application/json",
          ...fetchOptions.headers,
        },
        signal: controller.signal,
      });
      transportMeta.httpStatus = response.status;
      onTransportMeta?.({ ...transportMeta });
      if (response.status === 404 || response.status === 501) {
        throw new RustHttpLoomEngineError("unsupported_method", "loom-service endpoint is not available yet.", {
          path,
          status: response.status,
        });
      }
      if (!response.ok) {
        throw await serviceErrorFromResponse(response, path);
      }
      if (response.status === 204) {
        transportMeta.responseParseStatus = "success";
        onTransportMeta?.({ ...transportMeta });
        return {} as T;
      }
      try {
        const payload = sanitizeEnginePayload(await response.json()) as T;
        transportMeta.responseParseStatus = "success";
        onTransportMeta?.({ ...transportMeta });
        return payload;
      } catch (error) {
        transportMeta.responseParseStatus = "failed";
        onTransportMeta?.({ ...transportMeta });
        throw new RustHttpLoomEngineError("response_parse_error", "loom-service returned malformed JSON.", {
          path,
          message: error instanceof Error ? error.message : "response parse failed",
        });
      }
    } catch (error) {
      if (error instanceof RustHttpLoomEngineError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        if (fetchOptions.signal?.aborted && !timedOut) {
          throw new RustHttpLoomEngineError("request_aborted", "loom-service request was cancelled.", {
            path,
            aborted: true,
            timedOut: false,
          });
        }
        throw new RustHttpLoomEngineError("timeout", "loom-service request timed out.", {
          path,
          aborted: true,
          timedOut: true,
        });
      }
      throw new RustHttpLoomEngineError("service_unavailable", "loom-service is not reachable.", {
        path,
      });
    } finally {
      globalThis.clearTimeout(timeout);
      fetchOptions.signal?.removeEventListener("abort", abortFromInputSignal);
    }
  }

  async getHealth(): Promise<EngineHealth> {
    try {
      const health = await this.requestJson<Record<string, unknown>>("/health");
      return {
        status: health.status === "ready" ? "ready" : "degraded",
        runtime: "rust-sidecar",
        version: typeof health.version === "string" ? health.version : undefined,
        serviceUrl: this.serviceUrl,
      };
    } catch (error) {
      if (error instanceof RustHttpLoomEngineError) {
        return {
          status: "unavailable",
          runtime: "rust-sidecar",
          serviceUrl: this.serviceUrl,
          message: error.message,
        };
      }
      throw error;
    }
  }

  async getServiceHealth(): Promise<ServiceHealthStatus> {
    try {
      const health = await this.requestJson<unknown>("/health");
      if (!isRecord(health)) {
        throw new RustHttpLoomEngineError("invalid_response", "loom-service returned invalid health.", {
          endpoint: "/health",
        });
      }
      const database = isRecord(health.database)
        ? { status: stringValue(health.database, "status") ?? "unknown" }
        : undefined;
      const config = isRecord(health.config)
        ? {
            status: stringValue(health.config, "status") ?? "unknown",
            path: stringValue(health.config, "path"),
          }
        : undefined;
      const ollamaProvider = isRecord(health.providers) && isRecord(health.providers.ollama)
        ? health.providers.ollama
        : undefined;
      const ollamaSecurity =
        ollamaProvider && isRecord(ollamaProvider.security)
          ? {
              localOnly: booleanValue(ollamaProvider.security, "localOnly"),
              remoteAllowed: booleanValue(ollamaProvider.security, "remoteAllowed"),
              networkExposureRisk: stringValue(ollamaProvider.security, "networkExposureRisk"),
              versionStatus: stringValue(ollamaProvider.security, "versionStatus"),
              minimumRecommendedVersion: stringValue(
                ollamaProvider.security,
                "minimumRecommendedVersion"
              ),
              warnings: Array.isArray(ollamaProvider.security.warnings)
                ? ollamaProvider.security.warnings.filter(
                    (warning): warning is string => typeof warning === "string"
                  )
                : undefined,
            }
          : undefined;
      return {
        status: statusFromHealth(health.status),
        runtime: "rust-service",
        version: stringValue(health, "version"),
        database,
        config,
        providers: ollamaProvider
          ? {
              ollama: {
                status: stringValue(ollamaProvider, "status"),
                baseUrl: stringValue(ollamaProvider, "baseUrl"),
                version: stringValue(ollamaProvider, "version"),
                security: ollamaSecurity,
              },
            }
          : undefined,
        serviceUrl: this.serviceUrl,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (error) {
      return serviceStatusUnavailable(this.serviceUrl, error);
    }
  }

  async getServiceConfigStatus(): Promise<ServiceConfigStatus> {
    try {
      const [config, restart] = await Promise.all([
        this.requestJson<unknown>("/config"),
        this.requestJson<unknown>("/runtime/restart-status"),
      ]);
      if (!isRecord(config) || !isRecord(restart)) {
        throw new RustHttpLoomEngineError("invalid_response", "loom-service returned invalid config status.", {
          endpoint: "/config",
        });
      }
      const database = isRecord(config.database) ? config.database : undefined;
      return {
        status: "ready",
        path: database ? stringValue(database, "path") : undefined,
        restartRequired: booleanValue(restart, "restartRequired"),
        pendingRestart: booleanValue(restart, "pendingRestart"),
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (error) {
      return configStatusUnavailable(error);
    }
  }

  async getServiceConfig(): Promise<LoomServiceRuntimeConfig> {
    const response = await this.requestJson<unknown>("/config");
    return validateServiceConfig(response);
  }

  async updateServiceConfig(input: UpdateServiceConfigInput): Promise<ServiceConfigUpdateResult> {
    const response = await this.requestJson<unknown>("/config", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return validateConfigUpdateResult(response);
  }

  async getSpeechProviderHealth(): Promise<SpeechProviderHealth> {
    const response = await this.requestJson<unknown>("/speech/provider/health");
    return validateSpeechProviderHealth(response);
  }

  async getCapabilitySummary(): Promise<CapabilitySummary> {
    try {
      const [system, models] = await Promise.all([
        this.requestJson<unknown>("/capabilities/system"),
        this.requestJson<unknown>("/capabilities/models"),
      ]);
      if (!isRecord(system) || !Array.isArray(models)) {
        throw new RustHttpLoomEngineError(
          "invalid_response",
          "loom-service returned invalid capability summary.",
          { endpoint: "/capabilities" }
        );
      }
      return {
        status: "ready",
        system: {
          osName: stringValue(system, "osName"),
          arch: stringValue(system, "arch"),
          cpuBrand: stringValue(system, "cpuBrand"),
          totalMemoryBytes: numberValue(system, "totalMemoryBytes"),
          availableMemoryBytes: numberValue(system, "availableMemoryBytes"),
        },
        models: models.filter(isRecord).map((model) => ({
          provider: stringValue(model, "provider") ?? "unknown",
          modelName: stringValue(model, "modelName") ?? "unknown",
          confidence: stringValue(model, "confidence"),
          source: stringValue(model, "source"),
        })),
        strategyAvailable: true,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (error) {
      return capabilityUnavailable(error);
    }
  }

  connectEvents(
    onEvent: (event: EngineResponseEvent) => void,
    onError?: (error: Event) => void
  ): () => void {
    const source = new EventSource(`${this.serviceUrl}/events`);
    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as unknown;
        if (!isRecord(parsed) || typeof parsed.type !== "string" || !("payload" in parsed)) {
          return;
        }
        onEvent(sanitizeEngineResponseEvent(parsed as EngineResponseEvent));
      } catch {
        // Ignore malformed dev-stream events; callers can rely on reconnect/error handlers.
      }
    };
    if (onError) source.onerror = onError;
    return () => source.close();
  }

  async resolveAddress(input: ResolveAddressInput): Promise<ResolveAddressResult> {
    const response = await this.requestJson<unknown>("/resolve", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isRecord(response) || !validateResolutionStatus(response.status)) {
      throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid address result.", {
        endpoint: "/resolve",
      });
    }
    const canonicalUri = stringValue(response, "canonicalUri");
    const objectId = stringValue(response, "objectId");
    const objectKind = serviceObjectKindToLoomKind(response.objectKind);
    const destination =
      response.destination === undefined || response.destination === null
        ? undefined
        : validateNavigationDestination(response.destination)
          ? response.destination
          : undefined;
    if (response.destination !== undefined && response.destination !== null && !destination) {
      throw new RustHttpLoomEngineError(
        "invalid_response",
        "loom-service returned an invalid address destination.",
        { endpoint: "/resolve" }
      );
    }
    const object =
      objectId && objectKind && canonicalUri
        ? {
            objectId,
            kind: objectKind,
            status: (response.status === "deleted" ? "deleted" : "active") as LoomObjectStatus,
            title: objectId,
            canonicalUri,
          }
        : undefined;
    return {
      status: response.status,
      parsed: parseLoomAddress(input.address),
      object,
      canonicalUri,
      aliasUri: response.status === "alias_resolved" ? input.address : undefined,
      destination,
      reason: stringValue(response, "error"),
    };
  }

  async listLooms(): Promise<LoomSummary[]> {
    const response = await this.requestJson<unknown>("/looms", { method: "GET" });
    if (!isRecord(response) || !Array.isArray(response.looms)) {
      throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an invalid Loom list.", {
        endpoint: "/looms",
      });
    }
    return response.looms.map((loom) => validateLoomSummary(loom, "/looms"));
  }

  async getLoom(loomId: string): Promise<LoomDetail> {
    const endpoint = `/looms/${encodeURIComponent(loomId)}`;
    const response = await this.requestJson<unknown>(endpoint, { method: "GET" });
    return validateLoomDetail(response, endpoint);
  }

  async createLoom(input: CreateLoomInput): Promise<CreateLoomResult> {
    const response = await this.requestJson<unknown>("/looms", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return validateLoomEnvelope(response, "/looms");
  }

  async renameLoom(input: RenameLoomInput): Promise<void> {
    await this.updateLoomMetadata({ loomId: input.loomId, title: input.title });
  }

  async updateLoomMetadata(input: UpdateLoomInput): Promise<CreateLoomResult> {
    const { loomId, ...patch } = input;
    const endpoint = `/looms/${encodeURIComponent(loomId)}`;
    const response = await this.requestJson<unknown>(endpoint, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return validateLoomEnvelope(response, endpoint);
  }

  async deleteLoom(input: DeleteLoomInput): Promise<void> {
    const endpoint = `/looms/${encodeURIComponent(input.loomId)}`;
    await this.requestJson<unknown>(endpoint, { method: "DELETE" });
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<EngineResponseEvent> {
    const controller = new AbortController();
    const abortFromInputSignal = () => controller.abort();
    if (input.signal?.aborted) {
      controller.abort();
    } else {
      input.signal?.addEventListener("abort", abortFromInputSignal, { once: true });
    }
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      Math.max(this.requestTimeoutMs, GENERATION_STREAM_OPEN_TIMEOUT_MS)
    );
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.serviceUrl}/orchestration/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(executePayload(input)),
        signal: controller.signal,
      });
    } catch (error) {
      globalThis.clearTimeout(timeout);
      if (error instanceof DOMException && error.name === "AbortError") {
        input.signal?.removeEventListener("abort", abortFromInputSignal);
        if (input.signal?.aborted) {
          throw new RustHttpLoomEngineError("request_failed", "loom-service generation request was cancelled.", {
            path: "/orchestration/execute",
          });
        }
        throw new RustHttpLoomEngineError(
          "timeout",
          "loom-service generation stream did not open before the startup timeout.",
          {
            path: "/orchestration/execute",
            timeoutMs: Math.max(this.requestTimeoutMs, GENERATION_STREAM_OPEN_TIMEOUT_MS),
            requestKind: "orchestration_execute",
          }
        );
      }
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      throw new RustHttpLoomEngineError("service_unavailable", "loom-service is not reachable.", {
        path: "/orchestration/execute",
      });
    }
    globalThis.clearTimeout(timeout);

    if (response.status === 404 || response.status === 501) {
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      throw new RustHttpLoomEngineError("unsupported_method", "loom-service endpoint is not available yet.", {
        path: "/orchestration/execute",
        status: response.status,
      });
    }
    if (!response.ok) {
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      throw new RustHttpLoomEngineError("request_failed", "loom-service generation request failed.", {
        path: "/orchestration/execute",
        status: response.status,
      });
    }
    if (!response.body) {
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an empty generation stream.", {
        path: "/orchestration/execute",
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const buffer = { text: "" };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const data of parseSseEvents(buffer, text)) {
          let parsed: unknown;
          try {
            parsed = sanitizeEnginePayload(JSON.parse(data));
          } catch {
            throw new RustHttpLoomEngineError("invalid_response", "loom-service returned malformed SSE data.", {
              path: "/orchestration/execute",
            });
          }
          for (const event of mapServiceEventToEngineEvents(parsed)) {
            yield sanitizeEngineResponseEvent(event);
          }
        }
      }
      const trailing = decoder.decode();
      for (const data of parseSseEvents(buffer, trailing)) {
        let parsed: unknown;
        try {
          parsed = sanitizeEnginePayload(JSON.parse(data));
        } catch {
          throw new RustHttpLoomEngineError("invalid_response", "loom-service returned malformed SSE data.", {
            path: "/orchestration/execute",
          });
        }
        for (const event of mapServiceEventToEngineEvents(parsed)) {
          yield sanitizeEngineResponseEvent(event);
        }
      }
    } catch (error) {
      if (error instanceof RustHttpLoomEngineError) throw error;
      if (input.signal?.aborted) {
        throw new RustHttpLoomEngineError("request_failed", "loom-service generation stream was cancelled.", {
          path: "/orchestration/execute",
        });
      }
      throw new RustHttpLoomEngineError("service_unavailable", "loom-service generation stream failed.", {
        path: "/orchestration/execute",
      });
    } finally {
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      reader.releaseLock();
    }
  }

  async *regenerateFromResponse(
    input: RegenerateFromResponseInput
  ): AsyncIterable<EngineResponseEvent> {
    const endpoint = `/responses/${encodeURIComponent(input.userResponseId)}/regenerate`;
    const controller = new AbortController();
    const abortFromInputSignal = () => controller.abort();
    if (input.signal?.aborted) {
      controller.abort();
    } else {
      input.signal?.addEventListener("abort", abortFromInputSignal, { once: true });
    }
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      Math.max(this.requestTimeoutMs, GENERATION_STREAM_OPEN_TIMEOUT_MS)
    );
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.serviceUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regeneratePayload(input)),
        signal: controller.signal,
      });
    } catch (error) {
      globalThis.clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      if (error instanceof DOMException && error.name === "AbortError") {
        if (input.signal?.aborted) {
          throw new RustHttpLoomEngineError("request_failed", "loom-service regenerate request was cancelled.", {
            path: endpoint,
          });
        }
        throw new RustHttpLoomEngineError(
          "timeout",
          "loom-service regenerate stream did not open before the startup timeout.",
          {
            path: endpoint,
            timeoutMs: Math.max(this.requestTimeoutMs, GENERATION_STREAM_OPEN_TIMEOUT_MS),
            requestKind: "prompt_regenerate",
          }
        );
      }
      throw new RustHttpLoomEngineError("service_unavailable", "loom-service is not reachable.", {
        path: endpoint,
      });
    }
    globalThis.clearTimeout(timeout);

    if (response.status === 404 || response.status === 501) {
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      throw new RustHttpLoomEngineError("unsupported_method", "loom-service endpoint is not available yet.", {
        path: endpoint,
        status: response.status,
      });
    }
    if (!response.ok) {
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      throw new RustHttpLoomEngineError("request_failed", "loom-service regenerate request failed.", {
        path: endpoint,
        status: response.status,
      });
    }
    if (!response.body) {
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      throw new RustHttpLoomEngineError("invalid_response", "loom-service returned an empty regenerate stream.", {
        path: endpoint,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const buffer = { text: "" };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const data of parseSseEvents(buffer, text)) {
          let parsed: unknown;
          try {
            parsed = sanitizeEnginePayload(JSON.parse(data));
          } catch {
            throw new RustHttpLoomEngineError("invalid_response", "loom-service returned malformed SSE data.", {
              path: endpoint,
            });
          }
          for (const event of mapServiceEventToEngineEvents(parsed)) {
            yield sanitizeEngineResponseEvent(event);
          }
        }
      }
      const trailing = decoder.decode();
      for (const data of parseSseEvents(buffer, trailing)) {
        let parsed: unknown;
        try {
          parsed = sanitizeEnginePayload(JSON.parse(data));
        } catch {
          throw new RustHttpLoomEngineError("invalid_response", "loom-service returned malformed SSE data.", {
            path: endpoint,
          });
        }
        for (const event of mapServiceEventToEngineEvents(parsed)) {
          yield sanitizeEngineResponseEvent(event);
        }
      }
    } catch (error) {
      if (error instanceof RustHttpLoomEngineError) throw error;
      if (input.signal?.aborted) {
        throw new RustHttpLoomEngineError("request_failed", "loom-service regenerate stream was cancelled.", {
          path: endpoint,
        });
      }
      throw new RustHttpLoomEngineError("service_unavailable", "loom-service regenerate stream failed.", {
        path: endpoint,
      });
    } finally {
      input.signal?.removeEventListener("abort", abortFromInputSignal);
      reader.releaseLock();
    }
  }

  async cancelMessage(input: CancelMessageInput): Promise<CancelMessageResult> {
    const endpoint = `/orchestration/cancel/${encodeURIComponent(input.workflowRunId)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.serviceUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: input.reason }),
      });
    } catch {
      throw new RustHttpLoomEngineError("service_unavailable", "loom-service is not reachable.", {
        path: endpoint,
      });
    }
    if (response.status === 404) {
      return {
        status: "not_found",
        workflowRunId: input.workflowRunId,
        responseId: input.responseId,
      };
    }
    if (!response.ok) {
      throw new RustHttpLoomEngineError("request_failed", "loom-service cancel request failed.", {
        path: endpoint,
        status: response.status,
      });
    }
    let payload: unknown;
    try {
      payload = sanitizeEnginePayload(await response.json());
    } catch {
      throw new RustHttpLoomEngineError("invalid_response", "loom-service returned malformed cancel JSON.", {
        path: endpoint,
      });
    }
    return validateCancelResponse(payload, input, endpoint);
  }

  async getGenerationResponseState(workflowRunId: string): Promise<GenerationResponseStateResult> {
    const endpoint = `/orchestration/runs/${encodeURIComponent(workflowRunId)}/response-state`;
    const response = await this.requestJson<unknown>(endpoint, { method: "GET" });
    return validateGenerationResponseState(response, workflowRunId, endpoint);
  }

  async quickAsk(input: QuickAskInput): Promise<QuickAskResult> {
    const endpoint = "/ask/quick";
    let transportMeta: RequestJsonTransportMeta = {
      endpoint,
      requestAttempted: false,
      responseParseStatus: "not_started",
    };
    try {
      const response = await this.requestJson<unknown>(endpoint, {
        method: "POST",
        body: JSON.stringify(quickAskPayload(input)),
        timeoutMs: 120_000,
        signal: input.signal,
        onTransportMeta: (meta) => {
          transportMeta = meta;
        },
      });
      const result = validateQuickAskResponse(response);
      result.diagnostics = quickAskTransportDiagnostics(result, input, transportMeta);
      return result;
    } catch (error) {
      if (error instanceof RustHttpLoomEngineError) {
        throw new RustHttpLoomEngineError(error.kind, error.message, {
          ...error.details,
          endpoint,
          requestAttempted: transportMeta.requestAttempted,
          httpStatus: transportMeta.httpStatus,
          responseParseStatus: transportMeta.responseParseStatus ?? "not_started",
          diagnosticsReceived: false,
        });
      }
      throw error;
    }
  }

  async transcribeSpeech(input: TranscribeSpeechInput): Promise<TranscribeSpeechResult> {
    const response = await this.requestJson<unknown>("/speech/transcribe", {
      method: "POST",
      body: JSON.stringify({
        audioBytes: input.audioBytes,
        mimeType: input.mimeType,
        language: input.language,
        providerProfileId: input.providerProfileId,
        mode: input.mode,
        metadata: input.metadata,
      }),
      timeoutMs: 120_000,
      signal: input.signal,
    });
    return validateTranscribeSpeechResponse(response, "/speech/transcribe");
  }

  async createOrOpenWeft(input: CreateOrOpenWeftInput): Promise<CreateOrOpenWeftResult> {
    const response = await this.requestJson<unknown>("/wefts", {
      method: "POST",
      body: JSON.stringify(createWeftPayload(input)),
    });
    return validateWeftEnvelope(response, "/wefts", input);
  }

  async persistWeftTurns(input: PersistWeftTurnsInput): Promise<PersistWeftTurnsResult> {
    const endpoint = `/wefts/${encodeURIComponent(input.weftLoomId)}/responses`;
    const response = await this.requestJson<unknown>(endpoint, {
      method: "POST",
      body: JSON.stringify(persistWeftTurnsPayload(input)),
    });
    return validatePersistWeftTurnsResponse(response, endpoint);
  }

  async updateResponse(input: UpdateResponseInput): Promise<UpdateResponseResult> {
    const endpoint = `/responses/${encodeURIComponent(input.responseId)}`;
    const response = await this.requestJson<unknown>(endpoint, {
      method: "PATCH",
      body: JSON.stringify(updateResponsePayload(input)),
    });
    return validateUpdateResponseResponse(response, endpoint);
  }

  async addReference(input: AddReferenceInput): Promise<AddReferenceResult> {
    const response = await this.requestJson<unknown>("/references", {
      method: "POST",
      body: JSON.stringify(createReferencePayload(input)),
    });
    return validateReferenceEnvelope(response, "/references");
  }

  async removeReference(input: RemoveReferenceInput): Promise<void> {
    const endpoint = `/references/${encodeURIComponent(input.referenceId)}`;
    await this.requestJson<unknown>(endpoint, { method: "DELETE" });
  }

  async getReference(input: GetReferenceInput): Promise<AddReferenceResult> {
    const endpoint = `/references/${encodeURIComponent(input.referenceId)}`;
    const response = await this.requestJson<unknown>(endpoint, { method: "GET" });
    return validateReferenceEnvelope(response, endpoint);
  }

  async listReferences(input: ListReferencesInput): Promise<ListReferencesResult> {
    if (!input.loomId && !input.responseId) {
      throw unsupported("listReferences");
    }
    const endpoint = input.responseId
      ? `/responses/${encodeURIComponent(input.responseId)}/references`
      : `/looms/${encodeURIComponent(input.loomId ?? "")}/references`;
    const response = await this.requestJson<unknown>(endpoint, { method: "GET" });
    return validateReferenceList(response, endpoint);
  }

  async listCodeSnippets(input: ListCodeSnippetsInput): Promise<ListCodeSnippetsResult> {
    const params = new URLSearchParams();
    if (input.loomId) params.set("loomId", input.loomId);
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const query = params.toString();
    const endpoint = `/code-snippets${query ? `?${query}` : ""}`;
    const response = await this.requestJson<unknown>(endpoint, { method: "GET" });
    return validateCodeSnippetList(response, endpoint);
  }

  async suggestReferences(input: SuggestReferencesInput): Promise<SuggestReferencesResult> {
    const response = await this.requestJson<unknown>("/references/suggest", {
      method: "POST",
      body: JSON.stringify({
        loomId: input.loomId,
        responseId: input.responseId,
        draftText: input.draftText,
        limit: input.limit,
      }),
    });
    return validateReferenceSuggestions(response, "/references/suggest");
  }

  async openReference(_input: OpenReferenceInput): Promise<LoomNavigationDestination> {
    throw unsupported("openReference");
  }

  async createBookmark(input: CreateBookmarkInput): Promise<BookmarkResult> {
    const response = await this.requestJson<unknown>("/bookmarks", {
      method: "POST",
      body: JSON.stringify(bookmarkPayload(input)),
    });
    return validateBookmarkEnvelope(response, "/bookmarks");
  }

  async deleteBookmark(input: DeleteBookmarkInput): Promise<void> {
    const endpoint = `/bookmarks/${encodeURIComponent(input.bookmarkId)}`;
    await this.requestJson<unknown>(endpoint, { method: "DELETE" });
  }

  async getBookmark(input: GetBookmarkInput): Promise<BookmarkResult> {
    const endpoint = `/bookmarks/${encodeURIComponent(input.bookmarkId)}`;
    const response = await this.requestJson<unknown>(endpoint, { method: "GET" });
    return validateBookmarkEnvelope(response, endpoint);
  }

  async listBookmarks(): Promise<ListBookmarksResult> {
    const response = await this.requestJson<unknown>("/bookmarks", { method: "GET" });
    return validateBookmarkList(response, "/bookmarks");
  }

  async listHistory(): Promise<ListHistoryResult> {
    const response = await this.requestJson<unknown>("/history", { method: "GET" });
    return validateHistoryList(response, "/history");
  }

  async recordHistory(input: RecordHistoryInput): Promise<HistoryEntry> {
    const response = await this.requestJson<unknown>("/history", {
      method: "POST",
      body: JSON.stringify({ entry: sanitizeEnginePayload(input.entry) }),
    });
    return validateHistoryEnvelope(response, "/history");
  }

  async getUiState(input: GetUiStateInput): Promise<GetUiStateResult> {
    const endpoint = `/ui/state/${encodeURIComponent(input.key)}`;
    const response = await this.requestJson<unknown>(endpoint, { method: "GET" });
    return validateUiStateEnvelope(response, endpoint);
  }

  async saveUiState(input: SaveUiStateInput): Promise<UiStateRecord> {
    const endpoint = `/ui/state/${encodeURIComponent(input.key)}`;
    const response = await this.requestJson<unknown>(endpoint, {
      method: "PUT",
      body: JSON.stringify({ value: sanitizeEnginePayload(input.value) }),
    });
    const result = validateUiStateEnvelope(response, endpoint);
    if (!result.state) {
      throw new RustHttpLoomEngineError("invalid_response", "loom-service did not return saved UI state.", {
        endpoint,
      });
    }
    return result.state;
  }

  async getBookmarkForTarget(input: GetBookmarkForTargetInput): Promise<BookmarkResult> {
    const params = new URLSearchParams({ targetKind: input.targetKind });
    if (input.targetId) params.set("targetId", input.targetId);
    if (input.targetUri) params.set("targetUri", input.targetUri);
    const endpoint = `/bookmarks/target?${params.toString()}`;
    const response = await this.requestJson<unknown>(endpoint, { method: "GET" });
    return validateBookmarkEnvelope(response, endpoint);
  }

  async bookmarkResponse(input: BookmarkResponseInput): Promise<BookmarkResult> {
    return this.createBookmark({
      targetKind: "response",
      targetId: input.responseId,
      title: input.responseId,
      metadata: { loomId: input.loomId },
    });
  }

  async getGraphProjection(input: GraphProjectionInput): Promise<GraphProjectionResult> {
    const loomId = input.activeLoomId;
    if (!loomId) throw unsupported("getGraphProjection");
    const params = new URLSearchParams();
    if (input.focusedResponseId) params.set("focusedResponseId", input.focusedResponseId);
    params.set("includeBookmarks", "true");
    const query = params.toString();
    const path = `/looms/${encodeURIComponent(loomId)}/graph${query ? `?${query}` : ""}`;
    try {
      const response = await this.requestJson<unknown>(path, { method: "GET" });
      return mapServiceGraphProjection(response, input);
    } catch (error) {
      if (
        error instanceof RustHttpLoomEngineError &&
        error.kind === "unsupported_method" &&
        error.details.status === 404
      ) {
        throw new RustHttpLoomEngineError("request_failed", "loom-service graph projection was not found.", {
          endpoint: path,
          status: 404,
        });
      }
      throw error;
    }
  }

  async exportLoom(input: ExportLoomInput): Promise<ExportLoomResult> {
    const response = await this.requestJson<unknown>("/exports/loom", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return validateExportResult(response, "/exports/loom");
  }

  async exportResponse(input: ExportResponseInput): Promise<ExportLoomResult> {
    const response = await this.requestJson<unknown>("/exports/response", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return validateExportResult(response, "/exports/response");
  }
}
