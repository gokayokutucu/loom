/*
 * Legacy/dev/test-only runtime context readiness gate after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { Conversation, LoomForkRecord, LoomLink, ResponseItem } from "../types";
import {
  contextArtifactsRepository,
  type ContextArtifactsRepository,
  type PersistedResponseContextCapsule,
} from "./contextArtifactsRepository";
import {
  createHeuristicResponseContextCapsule,
  type ResponseContextCapsule,
} from "./responseContextCapsule";
import type {
  LoomCheckpointSummary,
  LoomContextReference,
} from "./loomContextBuilder";

export interface PreparedContextArtifacts {
  responseCapsules: Record<string, ResponseContextCapsule>;
  checkpointSummary?: LoomCheckpointSummary;
  weftOrigin?: {
    originLoomId: string;
    originResponseId: string;
    response: ResponseItem;
    capsule: ResponseContextCapsule;
  };
  usedFallback: boolean;
}

export interface PrepareContextArtifactsInput {
  loomId: string;
  conversation?: Conversation;
  responses: ResponseItem[];
  currentHeadResponseId?: string;
  attachedReferences: LoomContextReference[];
  activeWeftOrigin?: {
    originLoomId: string;
    originResponseId: string;
    response?: ResponseItem;
  };
  forkRecords: LoomForkRecord[];
  existingCapsules?: Record<string, ResponseContextCapsule>;
  repository?: ContextArtifactsRepository;
}

function capsuleKey(loomId: string, responseId: string) {
  return `${loomId}:${responseId}`;
}

function compact(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function responseSourceHash(response: ResponseItem) {
  return hashText(
    [
      response.id,
      response.title,
      response.question,
      response.answer.join("\n\n"),
      response.meta?.title ?? "",
      response.meta?.summary ?? "",
      response.meta?.canonicalUri ?? "",
      response.meta?.keywords.join(",") ?? "",
    ].join("\n")
  );
}

function loomSourceHash(responses: ResponseItem[]) {
  return hashText(responses.map((response) => responseSourceHash(response)).join("|"));
}

function capsuleToPersisted(
  capsule: ResponseContextCapsule,
  sourceHash: string,
  existing?: PersistedResponseContextCapsule
): PersistedResponseContextCapsule {
  const now = Date.now();
  return {
    capsuleId: existing?.capsuleId ?? `capsule-${capsule.loomId}-${capsule.responseId}`,
    responseId: capsule.responseId,
    loomId: capsule.loomId,
    responseCode: capsule.responseCode,
    title: capsule.title,
    summary: capsule.summary,
    keyPoints: capsule.keyPoints,
    keywords: capsule.keywords,
    entities: capsule.entities,
    codeBlocks: capsule.codeBlocks,
    canonicalUri: capsule.canonicalUri,
    sourceHash,
    generator: capsule.generatedBy,
    status: "ready",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function persistedToCapsule(row: PersistedResponseContextCapsule): ResponseContextCapsule {
  return {
    sourceLoomId: row.loomId,
    sourceResponseId: row.responseId,
    sourceResponseCode: row.responseCode,
    sourceTitle: row.title,
    sourceCanonicalUri: row.canonicalUri,
    responseId: row.responseId,
    loomId: row.loomId,
    responseCode: row.responseCode,
    title: row.title,
    canonicalUri: row.canonicalUri,
    summary: row.summary,
    keyPoints: row.keyPoints,
    keywords: row.keywords,
    entities: row.entities,
    codeBlockSummaries: row.codeBlocks,
    codeBlocks: row.codeBlocks,
    sourceLength: 0,
    capsuleSource: row.generator,
    generatedBy: row.generator,
    updatedAt: row.updatedAt,
  };
}

function headResponses(input: PrepareContextArtifactsInput) {
  const headIndex = input.currentHeadResponseId
    ? input.responses.findIndex((response) => response.id === input.currentHeadResponseId)
    : input.responses.length - 1;
  const endIndex = headIndex >= 0 ? headIndex + 1 : input.responses.length;
  return input.responses.slice(0, endIndex);
}

function requiredResponses(input: PrepareContextArtifactsInput) {
  const scopedResponses = headResponses(input);
  const recent = scopedResponses.slice(-6);
  const referenceTargets = input.attachedReferences
    .map((reference) => reference.targetResponse)
    .filter((response): response is ResponseItem => Boolean(response));
  const origin = input.activeWeftOrigin?.response ? [input.activeWeftOrigin.response] : [];
  const unique = new Map<string, ResponseItem>();
  [...recent, ...referenceTargets, ...origin].forEach((response) => {
    unique.set(response.id, response);
  });
  return Array.from(unique.values());
}

function extractConstraints(responses: ResponseItem[]) {
  const pattern = /\b(must|should|do not|never|always|gerek|zorunda|olmamalı|olmalı)\b/i;
  return responses
    .flatMap((response) => [response.question, ...response.answer])
    .flatMap((text) => text.split(/[.!?]\s+|\n+/))
    .map((line) => compact(line, 180))
    .filter((line) => pattern.test(line))
    .slice(0, 8);
}

function createCheckpointSummary(input: PrepareContextArtifactsInput): LoomCheckpointSummary {
  const responses = headResponses(input);
  const capsules = responses
    .map((response) => input.existingCapsules?.[capsuleKey(input.loomId, response.id)])
    .filter((capsule): capsule is ResponseContextCapsule => Boolean(capsule));
  const entities = Array.from(
    new Set(
      capsules.flatMap((capsule) => [...capsule.entities, ...capsule.keywords]).filter(Boolean)
    )
  ).slice(0, 12);
  const activeWefts = input.forkRecords
    .filter((record) => record.parentConversationId === input.loomId)
    .map((record) => record.title)
    .slice(0, 8);
  const decisions = responses
    .map((response) => response.meta?.summary || response.title)
    .filter(Boolean)
    .slice(-8);
  return {
    loomId: input.loomId,
    goal: compact(input.conversation?.summary || input.conversation?.title || "Continue the Loom", 220),
    decisions,
    constraints: extractConstraints(responses),
    importantEntities: entities,
    activeWefts,
    unresolvedQuestions: responses.map((response) => compact(response.question, 180)).slice(-6),
    updatedAt: Date.now(),
  };
}

function shouldCreateCheckpoint(input: PrepareContextArtifactsInput) {
  const responses = headResponses(input);
  return responses.length >= 4 || input.attachedReferences.length >= 2;
}

async function prepareCapsule(input: {
  repository: ContextArtifactsRepository;
  loomId: string;
  response: ResponseItem;
  selectedText?: string;
}) {
  const sourceHash = hashText(
    `${responseSourceHash(input.response)}:${input.selectedText?.trim() ?? ""}`
  );
  const existing = await input.repository.getResponseCapsule({
    loomId: input.loomId,
    responseId: input.response.id,
  });
  if (existing?.status === "ready" && existing.sourceHash === sourceHash) {
    return persistedToCapsule(existing);
  }
  const job = await input.repository.createJob({
    jobType: "response_capsule",
    loomId: input.loomId,
    responseId: input.response.id,
    status: "pending",
    priority: 10,
  });
  try {
    const capsule = createHeuristicResponseContextCapsule(
      input.response,
      input.loomId,
      input.selectedText
    );
    const persisted = capsuleToPersisted(capsule, sourceHash, existing);
    await input.repository.upsertResponseCapsule(persisted);
    await input.repository.recordEvent({
      artifactType: "response_context_capsule",
      artifactId: persisted.capsuleId,
      eventType: existing ? "updated" : "created",
      payload: {
        loomId: input.loomId,
        responseId: input.response.id,
        sourceHash,
        generator: capsule.generatedBy,
      },
    });
    await input.repository.finishJob({ jobId: job.jobId, status: "ready" });
    return capsule;
  } catch (error) {
    await input.repository.finishJob({
      jobId: job.jobId,
      status: "failed",
      error: error instanceof Error ? error.message : "Capsule build failed",
    });
    await input.repository.recordEvent({
      artifactType: "response_context_capsule",
      artifactId: existing?.capsuleId ?? `capsule-${input.loomId}-${input.response.id}`,
      eventType: "used_fallback",
      payload: { loomId: input.loomId, responseId: input.response.id },
    });
    return createHeuristicResponseContextCapsule(
      input.response,
      input.loomId,
      input.selectedText
    );
  }
}

export async function prepareContextArtifactsForGeneration(
  input: PrepareContextArtifactsInput
): Promise<PreparedContextArtifacts> {
  const repository = input.repository ?? contextArtifactsRepository;
  await repository.ensureSchema();

  const responseCapsules: Record<string, ResponseContextCapsule> = {
    ...(input.existingCapsules ?? {}),
  };
  let usedFallback = false;

  const required = requiredResponses(input);
  await Promise.all(
    required.map(async (response) => {
      const reference = input.attachedReferences.find(
        (item) =>
          item.targetResponse?.id === response.id &&
          item.link.type === "fragment" &&
          item.link.selectedText
      );
      const loomId = reference?.targetLoomId ?? input.loomId;
      const capsule = await prepareCapsule({
        repository,
        loomId,
        response,
        selectedText: reference?.link.selectedText,
      });
      responseCapsules[capsuleKey(loomId, response.id)] = capsule;
    })
  ).catch(() => {
    usedFallback = true;
  });

  let checkpointSummary: LoomCheckpointSummary | undefined;
  if (shouldCreateCheckpoint(input)) {
    const upToResponseId =
      input.currentHeadResponseId ?? input.responses[input.responses.length - 1]?.id;
    if (upToResponseId) {
      const sourceHash = loomSourceHash(headResponses(input));
      const existing = await repository.getCheckpoint({ loomId: input.loomId, upToResponseId });
      if (existing?.status === "ready" && existing.sourceHash === sourceHash) {
        checkpointSummary = existing.summary;
      } else {
        const job = await repository.createJob({
          jobType: "loom_checkpoint",
          loomId: input.loomId,
          responseId: upToResponseId,
          status: "pending",
          priority: 20,
        });
        try {
          checkpointSummary = createCheckpointSummary({
            ...input,
            existingCapsules: responseCapsules,
          });
          const now = Date.now();
          await repository.upsertCheckpoint({
            checkpointId: existing?.checkpointId ?? `checkpoint-${input.loomId}-${upToResponseId}`,
            loomId: input.loomId,
            upToResponseId,
            summary: checkpointSummary,
            decisions: checkpointSummary.decisions,
            constraints: checkpointSummary.constraints,
            openQuestions: checkpointSummary.unresolvedQuestions,
            entities: checkpointSummary.importantEntities,
            wefts: checkpointSummary.activeWefts,
            references: input.attachedReferences.map((reference) => reference.link.title),
            sourceHash,
            status: "ready",
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          });
          await repository.recordEvent({
            artifactType: "loom_checkpoint_summary",
            artifactId: existing?.checkpointId ?? `checkpoint-${input.loomId}-${upToResponseId}`,
            eventType: existing ? "updated" : "created",
            payload: {
              loomId: input.loomId,
              upToResponseId,
              sourceHash,
            },
          });
          await repository.finishJob({ jobId: job.jobId, status: "ready" });
        } catch (error) {
          usedFallback = true;
          await repository.finishJob({
            jobId: job.jobId,
            status: "failed",
            error: error instanceof Error ? error.message : "Checkpoint build failed",
          });
        }
      }
    }
  }

  let weftOrigin: PreparedContextArtifacts["weftOrigin"];
  if (input.activeWeftOrigin?.response) {
    const capsule = responseCapsules[
      capsuleKey(input.activeWeftOrigin.originLoomId, input.activeWeftOrigin.originResponseId)
    ] ?? createHeuristicResponseContextCapsule(
      input.activeWeftOrigin.response,
      input.activeWeftOrigin.originLoomId
    );
    weftOrigin = {
      originLoomId: input.activeWeftOrigin.originLoomId,
      originResponseId: input.activeWeftOrigin.originResponseId,
      response: input.activeWeftOrigin.response,
      capsule,
    };
    const sourceHash = hashText(
      `${input.loomId}:${input.activeWeftOrigin.originLoomId}:${input.activeWeftOrigin.originResponseId}:${capsule.summary}`
    );
    const existing = await repository.getWeftOriginContext({ weftLoomId: input.loomId });
    if (existing?.status !== "ready" || existing.sourceHash !== sourceHash) {
      const job = await repository.createJob({
        jobType: "weft_origin",
        loomId: input.loomId,
        responseId: input.activeWeftOrigin.originResponseId,
        status: "pending",
        priority: 30,
      });
      const now = Date.now();
      const contextId = existing?.contextId ?? `weft-origin-${input.loomId}`;
      await repository.upsertWeftOriginContext({
        contextId,
        weftLoomId: input.loomId,
        originLoomId: input.activeWeftOrigin.originLoomId,
        originResponseId: input.activeWeftOrigin.originResponseId,
        originCapsuleId: `capsule-${input.activeWeftOrigin.originLoomId}-${input.activeWeftOrigin.originResponseId}`,
        originSummary: capsule.summary,
        sourceHash,
        status: "ready",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await repository.recordEvent({
        artifactType: "weft_origin_context",
        artifactId: contextId,
        eventType: existing ? "updated" : "created",
        payload: {
          weftLoomId: input.loomId,
          originLoomId: input.activeWeftOrigin.originLoomId,
          originResponseId: input.activeWeftOrigin.originResponseId,
          sourceHash,
        },
      });
      await repository.finishJob({ jobId: job.jobId, status: "ready" });
    }
  }

  return {
    responseCapsules,
    checkpointSummary,
    weftOrigin,
    usedFallback,
  };
}
