/*
 * Legacy/dev/test-only runtime planner after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { ModelResponseMode } from "./appSettings";
import {
  runModelProfileRequest,
  type AIProviderSettings,
} from "./modelProviders";
import { runWithTimeoutSignal } from "./abortSignals";
import { referenceTokenText } from "./referenceDisplay";
import type { LoomLink } from "../types";

const QUICK_ORCHESTRATOR_TIMEOUT_MS = 8_000;

export type AnswerIntent =
  | "simple_factual"
  | "reference_scoped_question"
  | "multi_reference_synthesis"
  | "general_question";

export type AnswerStyle =
  | "direct"
  | "separate_sections"
  | "synthesis"
  | "balanced";

export type ContextStrategy =
  | "minimal"
  | "reference_scoped"
  | "multi_reference"
  | "standard";

export type AnswerPlanComplexity = "low" | "medium" | "high";

export interface QuestionUnit {
  id: string;
  question: string;
  displayText: string;
  references: LoomLink[];
  sourceLineIndex: number;
}

export interface AnswerPlan {
  intent: AnswerIntent;
  responseMode: ModelResponseMode;
  useThinking: boolean;
  contextStrategy: ContextStrategy;
  answerStyle: AnswerStyle;
  questionUnits: QuestionUnit[];
  complexity: AnswerPlanComplexity;
  rewrittenPrompt?: string;
}

export interface PlanAnswerInput {
  cleanUserPrompt: string;
  attachedReferences: LoomLink[];
  selectedResponseMode: ModelResponseMode;
  signal?: AbortSignal;
}

interface OrchestratedQuestionUnit {
  question?: unknown;
  referenceIndexes?: unknown;
  sourceLineIndex?: unknown;
}

interface OrchestratedAnswerPlan {
  intent?: unknown;
  responseMode?: unknown;
  useThinking?: unknown;
  contextStrategy?: unknown;
  answerStyle?: unknown;
  questionUnits?: unknown;
  complexity?: unknown;
  rewrittenPrompt?: unknown;
}

type QuestionPlanExecutor = (prompt: string) => Promise<string>;

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isFragmentReference(link: LoomLink) {
  return link.type === "fragment" || Boolean(link.selectedText && link.sourceResponseId);
}

function tokenCandidatesForReference(link: LoomLink) {
  return Array.from(
    new Set(
      [
        referenceTokenText(link, link.referenceDisplayMode ?? "title"),
        referenceTokenText(link, "title"),
        referenceTokenText(link, "code"),
        `[[${link.title}]]`,
        link.referenceCustomLabel ? `[[${link.referenceCustomLabel}]]` : "",
        link.title,
        link.referenceCode,
        link.sourceResponseCode,
      ].filter((candidate): candidate is string => Boolean(candidate))
    )
  );
}

function referencesInLine(line: string, references: LoomLink[]) {
  return references.filter((reference) =>
    tokenCandidatesForReference(reference).some((candidate) => line.includes(candidate))
  );
}

function referenceDisplayLabel(link: LoomLink) {
  const token = referenceTokenText(link, link.referenceDisplayMode ?? "title");
  return token.replace(/^\[\[|\]\]$/g, "").trim() || link.referenceCode || link.title;
}

function displayTextForQuestionUnit(question: string, references: LoomLink[]) {
  const referenceLabels = references.map((reference) => `[${referenceDisplayLabel(reference)}]`);
  return compact([...referenceLabels, question].filter(Boolean).join(" "));
}

function displayTextForPromptLine(line: string, references: LoomLink[], question: string) {
  let displayText = line;
  references.forEach((reference) => {
    const label = `[${referenceDisplayLabel(reference)}]`;
    tokenCandidatesForReference(reference)
      .sort((first, second) => second.length - first.length)
      .forEach((candidate) => {
        displayText = displayText.split(candidate).join(label);
      });
  });
  const normalized = compact(displayText.replace(/\[\[([^\]]+)\]\]/g, "[$1]"));
  if (references.length > 0 && !references.some((reference) =>
    normalized.includes(`[${referenceDisplayLabel(reference)}]`)
  )) {
    return displayTextForQuestionUnit(question, references);
  }
  return normalized;
}

function lineWithoutReferenceTokens(line: string, references: LoomLink[]) {
  return references.reduce((current, reference) => {
    let next = current;
    tokenCandidatesForReference(reference).forEach((candidate) => {
      next = next.split(candidate).join(" ");
    });
    return next;
  }, line);
}

function splitPromptLines(prompt: string) {
  return prompt
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fallbackQuestionUnits(lines: string[], references: LoomLink[]): QuestionUnit[] {
  if (lines.length === 0 && references.length === 0) return [];
  if (lines.length === 0) {
    return [
      {
        id: "q-1",
        question: "",
        displayText: displayTextForQuestionUnit("", references),
        references,
        sourceLineIndex: 0,
      },
    ];
  }
  return lines.map((line, index) => {
    const lineReferences = referencesInLine(line, references);
    const question = compact(lineWithoutReferenceTokens(line, lineReferences));
    return {
      id: `q-${index + 1}`,
      question,
      displayText: displayTextForPromptLine(line, lineReferences, question),
      references: lineReferences,
      sourceLineIndex: index,
    };
  });
}

function promptLooksComplex(prompt: string, references: LoomLink[], lines: string[]) {
  return (
    prompt.length > 1200 ||
    references.length >= 3 ||
    references.some(isFragmentReference) && prompt.length > 600 ||
    lines.length >= 3
  );
}

function complexityFor(prompt: string, references: LoomLink[], lines: string[]): AnswerPlanComplexity {
  if (promptLooksComplex(prompt, references, lines)) return "high";
  if (prompt.length > 500 || references.length >= 2 || lines.length >= 2) return "medium";
  return "low";
}

function resolveThinking(
  selectedResponseMode: ModelResponseMode,
  complexity: AnswerPlanComplexity,
  simpleFactual: boolean
) {
  if (selectedResponseMode === "instant") return false;
  if (simpleFactual) return false;
  if (selectedResponseMode === "thinking") return complexity === "medium" || complexity === "high";
  return false;
}

export function planAnswerDeterministically(input: PlanAnswerInput): AnswerPlan {
  const prompt = input.cleanUserPrompt.trim();
  const lines = splitPromptLines(prompt);
  const references = input.attachedReferences;
  const questionUnits = fallbackQuestionUnits(lines, references);
  const referenceUnits = questionUnits.filter((unit) => unit.references.length > 0);
  const sameLineMultiReference = questionUnits.some((unit) => unit.references.length > 1);
  const referencesOnSeparateLines =
    referenceUnits.length >= 2 &&
    new Set(referenceUnits.map((unit) => unit.sourceLineIndex)).size >= 2;
  const noReferences = references.length === 0;
  const shortPrompt = compact(prompt).length < 300 && lines.length <= 1;
  const simpleFactual = noReferences && shortPrompt;
  const complexity = complexityFor(prompt, references, lines);

  if (simpleFactual) {
    return {
      intent: "simple_factual",
      responseMode: "instant",
      useThinking: false,
      contextStrategy: "minimal",
      answerStyle: "direct",
      questionUnits,
      complexity: "low",
    };
  }

  if (referencesOnSeparateLines) {
    const responseMode = input.selectedResponseMode === "instant" ? "instant" : input.selectedResponseMode;
    return {
      intent: "reference_scoped_question",
      responseMode,
      useThinking: resolveThinking(input.selectedResponseMode, complexity, false),
      contextStrategy: "reference_scoped",
      answerStyle: "separate_sections",
      questionUnits,
      complexity,
    };
  }

  if (sameLineMultiReference || references.length > 1) {
    const responseMode = input.selectedResponseMode === "instant" ? "instant" : input.selectedResponseMode;
    return {
      intent: "multi_reference_synthesis",
      responseMode,
      useThinking: resolveThinking(input.selectedResponseMode, complexity, false),
      contextStrategy: "multi_reference",
      answerStyle: "synthesis",
      questionUnits,
      complexity,
    };
  }

  return {
    intent: references.length === 1 ? "reference_scoped_question" : "general_question",
    responseMode: input.selectedResponseMode === "instant" ? "instant" : "auto",
    useThinking: resolveThinking(input.selectedResponseMode, complexity, false),
    contextStrategy: references.length === 1 ? "reference_scoped" : "standard",
    answerStyle: references.length === 1 ? "separate_sections" : "balanced",
    questionUnits,
    complexity,
  };
}

function referencePreview(link: LoomLink, index: number) {
  return {
    index,
    title: link.title,
    type: link.type,
    code: link.referenceCode ?? link.sourceResponseCode ?? link.meta?.code,
    selectedTextPreview: link.selectedText ? compact(link.selectedText).slice(0, 500) : undefined,
    sourceResponseTitle: link.sourceResponseTitle,
    sourceCanonicalUri: link.sourceCanonicalUri ?? link.canonicalUri,
  };
}

function orchestratorPrompt(input: PlanAnswerInput) {
  const lines = splitPromptLines(input.cleanUserPrompt);
  return JSON.stringify(
    {
      task:
        "Create an AnswerPlan JSON only. Plan the answer shape; do not answer the user.",
      rules: [
        "No chain-of-thought.",
        "No raw reasoning.",
        "Return JSON only.",
        "Use referenceIndexes to point at provided References.",
        "If References are on separate lines with separate questions, use reference_scoped_question and separate_sections.",
        "If multiple References are in the same sentence or paragraph, use multi_reference_synthesis and synthesis.",
        "Instant forces useThinking false.",
        "Thinking is allowed only for medium or high complexity, never for short simple factual prompts.",
      ],
      allowed: {
        intent: [
          "simple_factual",
          "reference_scoped_question",
          "multi_reference_synthesis",
          "general_question",
        ],
        responseMode: ["auto", "instant", "thinking"],
        contextStrategy: ["minimal", "reference_scoped", "multi_reference", "standard"],
        answerStyle: ["direct", "separate_sections", "synthesis", "balanced"],
        complexity: ["low", "medium", "high"],
      },
      input: {
        cleanUserPrompt: input.cleanUserPrompt,
        promptLines: lines.map((line, index) => ({ index, text: line })),
        references: input.attachedReferences.map(referencePreview),
        selectedResponseMode: input.selectedResponseMode,
      },
      outputShape: {
        intent: "one allowed intent",
        responseMode: "auto|instant|thinking",
        useThinking: false,
        contextStrategy: "one allowed context strategy",
        answerStyle: "one allowed answer style",
        complexity: "low|medium|high",
        rewrittenPrompt: "optional cleaned prompt for the answer model",
        questionUnits: [
          {
            question: "clean question text without reference token syntax",
            referenceIndexes: [0],
            sourceLineIndex: 0,
          },
        ],
      },
    },
    null,
    2
  );
}

function isAnswerIntent(value: unknown): value is AnswerIntent {
  return (
    value === "simple_factual" ||
    value === "reference_scoped_question" ||
    value === "multi_reference_synthesis" ||
    value === "general_question"
  );
}

function isAnswerStyle(value: unknown): value is AnswerStyle {
  return (
    value === "direct" ||
    value === "separate_sections" ||
    value === "synthesis" ||
    value === "balanced"
  );
}

function isContextStrategy(value: unknown): value is ContextStrategy {
  return (
    value === "minimal" ||
    value === "reference_scoped" ||
    value === "multi_reference" ||
    value === "standard"
  );
}

function isResponseMode(value: unknown): value is ModelResponseMode {
  return value === "auto" || value === "instant" || value === "thinking";
}

function isComplexity(value: unknown): value is AnswerPlanComplexity {
  return value === "low" || value === "medium" || value === "high";
}

function parsePlanJson(value: string) {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as OrchestratedAnswerPlan;
  } catch {
    return null;
  }
}

function validateOrchestratedPlan(
  parsed: OrchestratedAnswerPlan,
  input: PlanAnswerInput,
  fallback: AnswerPlan
): AnswerPlan | null {
  if (
    !isAnswerIntent(parsed.intent) ||
    !isResponseMode(parsed.responseMode) ||
    !isContextStrategy(parsed.contextStrategy) ||
    !isAnswerStyle(parsed.answerStyle) ||
    !isComplexity(parsed.complexity) ||
    typeof parsed.useThinking !== "boolean" ||
    !Array.isArray(parsed.questionUnits)
  ) {
    return null;
  }

  const questionUnits = parsed.questionUnits
    .map((unit, index): QuestionUnit | null => {
      const candidate = unit as OrchestratedQuestionUnit;
      if (typeof candidate.question !== "string") return null;
      const referenceIndexes = Array.isArray(candidate.referenceIndexes)
        ? candidate.referenceIndexes
            .filter((referenceIndex): referenceIndex is number => Number.isInteger(referenceIndex))
            .filter((referenceIndex) => referenceIndex >= 0 && referenceIndex < input.attachedReferences.length)
        : [];
      return {
        id: `q-${index + 1}`,
        question: compact(candidate.question),
        displayText: displayTextForQuestionUnit(
          compact(candidate.question),
          referenceIndexes.map((referenceIndex) => input.attachedReferences[referenceIndex])
        ),
        references: referenceIndexes.map((referenceIndex) => input.attachedReferences[referenceIndex]),
        sourceLineIndex:
          typeof candidate.sourceLineIndex === "number" && Number.isInteger(candidate.sourceLineIndex)
            ? candidate.sourceLineIndex
            : index,
      };
    })
    .filter((unit): unit is QuestionUnit => Boolean(unit));

  if (questionUnits.length === 0 && fallback.questionUnits.length > 0) return null;

  const useThinking =
    input.selectedResponseMode === "instant" ||
    (parsed.intent === "simple_factual" && parsed.complexity === "low")
      ? false
      : parsed.useThinking;
  const responseMode =
    input.selectedResponseMode === "instant"
      ? "instant"
      : parsed.intent === "simple_factual"
        ? "instant"
        : parsed.responseMode;

  return {
    intent: parsed.intent,
    responseMode,
    useThinking,
    contextStrategy: parsed.contextStrategy,
    answerStyle: parsed.answerStyle,
    questionUnits,
    complexity: parsed.complexity,
    rewrittenPrompt:
      typeof parsed.rewrittenPrompt === "string" && compact(parsed.rewrittenPrompt)
        ? compact(parsed.rewrittenPrompt)
        : undefined,
  };
}

export async function orchestrateQuestionPlan(
  settings: AIProviderSettings,
  input: PlanAnswerInput
): Promise<AnswerPlan> {
  return orchestrateQuestionPlanWithExecutor(input, async (prompt) => {
    const result = await runWithTimeoutSignal(
      input.signal,
      QUICK_ORCHESTRATOR_TIMEOUT_MS,
      (signal) =>
        runModelProfileRequest(settings, {
          profile: "quick",
          effort: "Low",
          mode: "instant",
          think: false,
          outputBudget: "short",
          numPredict: 512,
          referenceCount: 0,
          referenceCharCount: 0,
          messageCount: 2,
          signal,
          system:
            "You are a question planner. Return AnswerPlan JSON only. Do not answer the user. Do not include chain-of-thought, reasoning text, markdown, or explanations.",
          prompt,
        })
    );
    return result.finalContent ?? result.text;
  });
}

export function buildQuestionOrchestratorPayload(input: PlanAnswerInput) {
  return orchestratorPrompt(input);
}

export async function orchestrateQuestionPlanWithExecutor(
  input: PlanAnswerInput,
  execute: QuestionPlanExecutor
): Promise<AnswerPlan> {
  const fallback = planAnswerDeterministically(input);
  try {
    const parsed = parsePlanJson(await execute(orchestratorPrompt(input)));
    if (!parsed) return fallback;
    return validateOrchestratedPlan(parsed, input, fallback) ?? fallback;
  } catch {
    return fallback;
  }
}
