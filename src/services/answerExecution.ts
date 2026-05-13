/*
 * Legacy/dev/test-only runtime execution policy after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { ModelResponseMode } from "./appSettings";
import type { AnswerPlan } from "./answerPlanner";
import type { ModelOutputBudget } from "./modelProviders";

export interface AnswerExecutionConfig {
  think: boolean;
  responseMode: ModelResponseMode;
  outputBudget: ModelOutputBudget;
  numPredict: number;
}

const outputBudgetNumPredict: Record<ModelOutputBudget, number> = {
  short: 768,
  medium: 1024,
  long: 8192,
  extended: 16384,
};

const longFormSignals = [
  "uzunca anlat",
  "uzun anlat",
  "detayli anlat",
  "detayli olarak anlat",
  "detayli acikla",
  "detaylı anlat",
  "detaylı olarak anlat",
  "detaylı açıkla",
  "acikla",
  "açıkla",
  "nasil kullanilir",
  "nasıl kullanılır",
  "detaylandir",
  "detaylandır",
  "avantaj",
  "dezavantaj",
  "orneklerle",
  "örneklerle",
  "adim adim",
  "adım adım",
  "explain in detail",
  "long answer",
  "long-form",
  "document",
  "detailed",
  "advantages",
  "disadvantages",
  "step by step",
  "examples",
  "deep dive",
];

function normalizedPrompt(value: string) {
  return value.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

export function promptHasLongFormSignal(promptText: string) {
  const prompt = normalizedPrompt(promptText);
  return longFormSignals.some((signal) => prompt.includes(signal));
}

export function resolveOutputBudget(input: {
  promptText: string;
  answerPlan: AnswerPlan;
  referenceCount: number;
  responseMode: ModelResponseMode;
}): { outputBudget: ModelOutputBudget; numPredict: number } {
  const longForm = promptHasLongFormSignal(input.promptText);
  const plan = input.answerPlan;
  let outputBudget: ModelOutputBudget = "medium";

  if (
    plan.intent === "simple_factual" &&
    plan.answerStyle === "direct" &&
    input.referenceCount === 0 &&
    !longForm
  ) {
    outputBudget = "short";
  } else if (
    plan.contextStrategy === "multi_reference" ||
    (plan.answerStyle === "synthesis" && input.referenceCount >= 2)
  ) {
    outputBudget = longForm || plan.complexity === "high" ? "extended" : "long";
  } else if (input.responseMode === "thinking") {
    outputBudget =
      longForm || plan.complexity === "high" || input.referenceCount >= 3
        ? "extended"
        : "long";
  } else if (longForm) {
    outputBudget = "extended";
  } else if (plan.complexity === "high") {
    outputBudget = "long";
  } else if (plan.complexity === "medium" || input.referenceCount > 0) {
    outputBudget = "medium";
  } else {
    outputBudget = "medium";
  }

  return {
    outputBudget,
    numPredict: outputBudgetNumPredict[outputBudget],
  };
}

export function resolveAnswerExecutionConfig(input: {
  promptText: string;
  answerPlan: AnswerPlan;
  referenceCount: number;
}): AnswerExecutionConfig {
  const think = input.answerPlan.useThinking;
  const responseMode: ModelResponseMode = think
    ? "thinking"
    : input.answerPlan.responseMode === "thinking"
      ? "auto"
      : input.answerPlan.responseMode;
  const output = resolveOutputBudget({
    promptText: input.promptText,
    answerPlan: input.answerPlan,
    referenceCount: input.referenceCount,
    responseMode,
  });

  return {
    think,
    responseMode,
    outputBudget: output.outputBudget,
    numPredict: output.numPredict,
  };
}
