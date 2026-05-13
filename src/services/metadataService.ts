import type { AIProviderSettings } from "./modelProviders";
import { runModelProfileRequest } from "./modelProviders";
import type { Conversation, LoomMetadata, ResponseItem } from "../types";
import { createLoomCode, createMetadataUuid, createResponseCode } from "./codeService";

const RUNTIME_METADATA_KEY = "loom.runtime.metadata.v1";

export type RuntimeMetadataRecord = Record<string, LoomMetadata>;

interface MetadataSeedInput {
  id: string;
  title?: string;
  text: string;
}

interface ResponseMetadataInput {
  response: ResponseItem;
  loom: Pick<Conversation, "title" | "meta">;
}

interface MetadataModelInput {
  title?: string;
  text: string;
}

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "between",
  "from",
  "have",
  "into",
  "that",
  "their",
  "there",
  "these",
  "this",
  "with",
  "would",
  "your",
]);

export function metadataKeyForLoom(loomId: string) {
  return `loom:${loomId}`;
}

export function metadataKeyForResponse(loomId: string, responseId: string) {
  return `response:${loomId}:${responseId}`;
}

export function readRuntimeMetadata(): RuntimeMetadataRecord {
  try {
    const value = window.localStorage.getItem(RUNTIME_METADATA_KEY);
    return value ? (JSON.parse(value) as RuntimeMetadataRecord) : {};
  } catch {
    return {};
  }
}

export function writeRuntimeMetadata(metadata: RuntimeMetadataRecord) {
  try {
    window.localStorage.setItem(RUNTIME_METADATA_KEY, JSON.stringify(metadata));
  } catch {
    // Metadata persistence is best effort in the browser prototype.
  }
}

export function slugifyMetadataTitle(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54);
  return slug || "loom-object";
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function wordsFromText(value: string) {
  return stripHtml(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function fallbackTitle(value: string, title?: string) {
  const base = stripHtml(title || value);
  const words = base.split(/\s+/).filter(Boolean).slice(0, 8);
  return words.join(" ") || "Untitled Loom object";
}

function fallbackKeywords(value: string) {
  const counts = new Map<string, number>();
  wordsFromText(value).forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
  const keywords = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word)
    .slice(0, 12);
  return keywords.length > 0 ? keywords : ["loom", "response", "reference"];
}

function fallbackSummary(value: string) {
  const plain = stripHtml(value);
  const sentence = plain.split(/(?<=[.!?])\s+/)[0]?.trim();
  return sentence || plain.slice(0, 160) || "No summary available yet.";
}

function fallbackMetadata(input: MetadataSeedInput, status: LoomMetadata["status"]) {
  return {
    id: input.id,
    title: fallbackTitle(input.text, input.title),
    keywords: fallbackKeywords(input.text),
    summary: fallbackSummary(input.text),
    usageCount: 0,
    status,
  } satisfies LoomMetadata;
}

export function metadataTextForLoom(loom: Pick<Conversation, "title" | "summary">) {
  return [loom.title, loom.summary].filter(Boolean).join("\n\n");
}

export function metadataTextForResponse(
  response: Pick<ResponseItem, "title" | "question" | "answer">
) {
  return [response.title, response.question, ...response.answer]
    .filter(Boolean)
    .join("\n\n");
}

function metadataUriForLoom(meta: LoomMetadata) {
  const slug = slugifyMetadataTitle(meta.title);
  return `loom://${slug}/${meta.code}?id=${encodeURIComponent(meta.id)}`;
}

function metadataUriForResponse(meta: LoomMetadata, loomMeta: LoomMetadata, loomTitle: string) {
  const loomSlug = slugifyMetadataTitle(loomMeta.title || loomTitle);
  const loomCode = loomMeta.code ?? createLoomCode(loomMeta.id);
  return `loom://${loomSlug}/${loomCode}/r/${meta.code}?id=${encodeURIComponent(meta.id)}`;
}

export function createAddressableLoomMetadata(
  input: MetadataSeedInput
): LoomMetadata {
  const id = input.id || createMetadataUuid();
  const code = createLoomCode(id);
  const meta: LoomMetadata = {
    ...fallbackMetadata({ ...input, id }, "addressable"),
    code,
  };
  return {
    ...meta,
    canonicalUri: metadataUriForLoom(meta),
  };
}

export function createDraftResponseMetadata(
  input: MetadataSeedInput
): LoomMetadata {
  const id = input.id || createMetadataUuid();
  return {
    ...fallbackMetadata(
      {
        ...input,
        id,
      },
      "draft"
    ),
    code: createResponseCode(id),
  };
}

export function hydrateAddressableLoomMetadata(
  input: MetadataSeedInput,
  existing?: LoomMetadata
): LoomMetadata {
  if (!existing) return createAddressableLoomMetadata(input);

  const id = existing.id || input.id || createMetadataUuid();
  const code = existing.code ?? createLoomCode(id);
  const normalized: LoomMetadata = {
    ...fallbackMetadata({ ...input, id }, "addressable"),
    ...existing,
    id,
    code,
    status: "addressable",
    usageCount: existing.usageCount ?? 0,
  };
  return {
    ...normalized,
    canonicalUri: existing.canonicalUri ?? metadataUriForLoom(normalized),
  };
}

export function hydrateResponseMetadata(
  input: MetadataSeedInput,
  existing?: LoomMetadata
): LoomMetadata {
  if (!existing) return createDraftResponseMetadata(input);

  const id = existing.id || input.id || createMetadataUuid();
  const status = existing.status === "addressable" ? "addressable" : "draft";
  const normalized: LoomMetadata = {
    ...fallbackMetadata({ ...input, id }, status),
    ...existing,
    id,
    status,
    usageCount: existing.usageCount ?? 0,
  };
  if (status === "addressable") {
    return {
      ...normalized,
      code: normalized.code ?? createResponseCode(id),
      canonicalUri: normalized.canonicalUri,
    };
  }
  return {
    ...normalized,
    code: normalized.code ?? createResponseCode(id),
    canonicalUri: undefined,
  };
}

export function promoteResponseMetadata(
  { response, loom }: ResponseMetadataInput
): LoomMetadata {
  if (response.meta?.status === "addressable" && response.meta.code && response.meta.canonicalUri) {
    return response.meta;
  }
  const responseMeta = hydrateResponseMetadata(
    {
      id: createMetadataUuid(),
      title: response.title,
      text: metadataTextForResponse(response),
    },
    response.meta
  );
  const id = responseMeta.id || createMetadataUuid();
  const code = responseMeta.code ?? createResponseCode(id);
  const loomMeta = hydrateAddressableLoomMetadata(
    {
      id: createMetadataUuid(),
      title: loom.title,
      text: metadataTextForLoom({ title: loom.title, summary: "" }),
    },
    loom.meta
  );
  const promoted: LoomMetadata = {
    ...responseMeta,
    id,
    code,
    canonicalUri: responseMeta.canonicalUri ??
      metadataUriForResponse({ ...responseMeta, id, code }, loomMeta, loom.title),
    usageCount: responseMeta.usageCount + 1,
    status: "addressable",
  };
  return promoted;
}

function parseMetadataJson(value: string) {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<Pick<LoomMetadata, "title" | "keywords" | "summary">>;
    if (!parsed.title || !Array.isArray(parsed.keywords) || !parsed.summary) return null;
    return {
      title: String(parsed.title).slice(0, 80),
      keywords: parsed.keywords.map(String).filter(Boolean).slice(0, 12),
      summary: String(parsed.summary).slice(0, 240),
    };
  } catch {
    return null;
  }
}

function normalizeMetadataKeywords(keywords: string[]) {
  const seen = new Set<string>();
  return keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
    .filter((keyword) => {
      const normalized = keyword.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 12);
}

export async function generateMetadataWithQuickModel(
  settings: AIProviderSettings,
  input: MetadataModelInput
) {
  const result = await runModelProfileRequest(settings, {
    profile: "quick",
    effort: "Low",
    prompt: `Given this conversation snippet, produce JSON only with keys title, keywords, summary.\n\nSnippet:\n${stripHtml(input.text).slice(0, 2400)}`,
    system:
      "Return JSON only. title max 7 words. keywords must be 5 to 12 short terms. summary must be one sentence. Preserve the user's language when possible. Do not mention internal labels such as Capsule, Context, Response Code, or artifact names.",
  });
  return parseMetadataJson(result.text);
}

export function applyMetadataRefinement(meta: LoomMetadata, refinement: Pick<LoomMetadata, "title" | "keywords" | "summary">) {
  return {
    ...meta,
    title: refinement.title || meta.title,
    keywords: normalizeMetadataKeywords(
      refinement.keywords.length > 0 ? refinement.keywords : meta.keywords
    ),
    summary: refinement.summary || meta.summary,
  };
}

export function incrementMetadataUsage(meta?: LoomMetadata) {
  if (!meta) return meta;
  return {
    ...meta,
    usageCount: meta.usageCount + 1,
  };
}

export function buildRuntimeMetadataRecord(
  conversations: Conversation[],
  responsesByConversation: Record<string, ResponseItem[]>
) {
  const record: RuntimeMetadataRecord = {};
  conversations.forEach((conversation) => {
    if (conversation.meta) {
      record[metadataKeyForLoom(conversation.id)] = conversation.meta;
    }
  });
  Object.entries(responsesByConversation).forEach(([loomId, responses]) => {
    responses.forEach((response) => {
      if (response.meta) {
        record[metadataKeyForResponse(loomId, response.id)] = response.meta;
      }
    });
  });
  return record;
}
