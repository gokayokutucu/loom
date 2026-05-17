export interface ThinkingLoopDetectionInput {
  recentThinkingText: string;
  previousChunks: string[];
  elapsedMs: number;
  finalContentStarted: boolean;
}

export interface ThinkingLoopDetectionResult {
  isLooping: boolean;
  reason?: string;
}

function normalizeThinkingText(value: string) {
  return value
    .toLowerCase()
    .replace(/[`*_>#()[\]{}.,;:!?'"“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function repeatedCount(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    if (!value) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return Math.max(0, ...counts.values());
}

function sentenceCandidates(text: string) {
  return text
    .split(/[.!?。！？\n]+/)
    .map(normalizeThinkingText)
    .filter((sentence) => sentence.split(" ").length >= 5);
}

function ngrams(words: string[], size: number) {
  const values: string[] = [];
  for (let index = 0; index <= words.length - size; index += 1) {
    values.push(words.slice(index, index + size).join(" "));
  }
  return values;
}

export function detectThinkingLoop(
  input: ThinkingLoopDetectionInput
): ThinkingLoopDetectionResult {
  if (input.finalContentStarted) return { isLooping: false };
  if (input.elapsedMs < 8_000) return { isLooping: false };

  const normalized = normalizeThinkingText(input.recentThinkingText);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 36) return { isLooping: false };

  const sentenceRepeatCount = repeatedCount(sentenceCandidates(input.recentThinkingText));
  if (sentenceRepeatCount >= 3) {
    return {
      isLooping: true,
      reason: "same sentence repeated",
    };
  }

  const gramRepeatCount = Math.max(
    repeatedCount(ngrams(words, 8)),
    repeatedCount(ngrams(words, 10)),
    repeatedCount(ngrams(words, 12))
  );
  if (gramRepeatCount >= 3) {
    return {
      isLooping: true,
      reason: "same phrase repeated",
    };
  }

  const recentChunks = input.previousChunks
    .slice(-8)
    .map(normalizeThinkingText)
    .filter((chunk) => chunk.split(" ").length >= 6);
  if (recentChunks.length >= 6 && repeatedCount(recentChunks) >= 3) {
    return {
      isLooping: true,
      reason: "same thinking chunk repeated",
    };
  }

  return { isLooping: false };
}

export function isSimpleAutoAnswerCandidate(input: {
  promptText: string;
  referenceCount: number;
  resolvedNumCtx: number;
  elapsedMs: number;
  finalContentStarted: boolean;
  thinkingStalled: boolean;
}) {
  return (
    input.promptText.trim().length < 300 &&
    input.referenceCount === 0 &&
    input.resolvedNumCtx <= 2048 &&
    input.elapsedMs >= 30_000 &&
    !input.finalContentStarted &&
    input.thinkingStalled
  );
}
