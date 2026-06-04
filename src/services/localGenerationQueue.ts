export type MainGenerationProviderKind = "ollama" | "openai_compatible" | "rig" | "unknown";

export interface LocalMainGenerationQueueDecisionInput {
  providerKind: MainGenerationProviderKind;
  generationType: "main" | "quick";
  activeLoomId: string | null;
  targetLoomId: string;
  modelId: string;
  active: boolean;
}

export interface LocalMainGenerationQueueItem<TPayload = unknown> {
  id: string;
  loomId: string;
  responseId: string;
  providerKind: "ollama";
  modelId: string;
  payload: TPayload;
}

export function canQueueLocalMainGeneration(
  input: LocalMainGenerationQueueDecisionInput
): boolean {
  if (!input.active) return false;
  if (input.providerKind !== "ollama") return false;
  if (input.generationType !== "main") return false;
  if (!input.modelId.trim()) return false;
  if (!input.activeLoomId) return false;
  return input.activeLoomId !== input.targetLoomId;
}

export function shouldBlockSameLoomMainGeneration(
  input: Pick<LocalMainGenerationQueueDecisionInput, "active" | "activeLoomId" | "targetLoomId">
): boolean {
  return Boolean(input.active && input.activeLoomId && input.activeLoomId === input.targetLoomId);
}

export function dequeueNextLocalMainGeneration<TPayload>(
  queue: Array<LocalMainGenerationQueueItem<TPayload>>
): {
  next?: LocalMainGenerationQueueItem<TPayload>;
  remaining: Array<LocalMainGenerationQueueItem<TPayload>>;
} {
  const [next, ...remaining] = queue;
  return { next, remaining };
}

export function removeQueuedLocalMainGeneration<TPayload>(
  queue: Array<LocalMainGenerationQueueItem<TPayload>>,
  itemId: string
): {
  removed?: LocalMainGenerationQueueItem<TPayload>;
  remaining: Array<LocalMainGenerationQueueItem<TPayload>>;
} {
  let removed: LocalMainGenerationQueueItem<TPayload> | undefined;
  const remaining = queue.filter((item) => {
    if (!removed && item.id === itemId) {
      removed = item;
      return false;
    }
    return true;
  });
  return { removed, remaining };
}

export interface ActiveMainGenerationInfo {
  loomId: string;
  providerProfileId: string;
  providerKind: MainGenerationProviderKind;
  modelId: string;
  startedAt: string;
  responseId?: string;
}

export type ConcurrencyDecision = "allow" | "queue" | "block_same_loom" | "block_limit_exceeded";

export function computeMainGenerationConcurrencyDecision(input: {
  providerProfileId: string;
  providerKind: MainGenerationProviderKind;
  modelId: string;
  targetLoomId: string;
  activeRuns: ActiveMainGenerationInfo[];
}): ConcurrencyDecision {
  const isSameLoomActive = input.activeRuns.some((run) => run.loomId === input.targetLoomId);
  if (isSameLoomActive) {
    return "block_same_loom";
  }

  if (input.providerKind === "ollama") {
    const hasActiveLocal = input.activeRuns.some((run) => run.providerKind === "ollama");
    if (hasActiveLocal) {
      return "queue";
    }
    return "allow";
  }

  const activeRunsForProvider = input.activeRuns.filter(
    (run) => run.providerProfileId === input.providerProfileId
  ).length;

  if (activeRunsForProvider >= 2) {
    return "block_limit_exceeded";
  }

  return "allow";
}
