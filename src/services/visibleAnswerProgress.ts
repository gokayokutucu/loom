/*
 * Legacy/dev/test-only visible progress planner after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import {
  runModelProfileRequest,
  type AIProviderSettings,
  type ModelOutputBudget,
} from "./modelProviders";
import { runWithTimeoutSignal } from "./abortSignals";
import { promptHasLongFormSignal } from "./answerExecution";
import type { AnswerPlan } from "./answerPlanner";
import { referenceTokenText } from "./referenceDisplay";
import type {
  VisibleAnswerDebugEvent,
  VisibleAnswerDebugState,
  LoomLink,
  VisibleAnswerPlan,
  VisibleAnswerProgress,
  VisibleAnswerStage,
  VisibleAnswerTask,
} from "../types";

type VisibleAnswerTaskTemplate = Omit<VisibleAnswerTask, "status">;
export type VisibleProgressMilestone =
  | "context_ready"
  | "answer_plan_ready"
  | "thinking_status"
  | "content_delta";

export interface CreateVisibleTaskProgressInput {
  promptText: string;
  answerPlan: AnswerPlan;
  referenceCount: number;
  outputBudget?: ModelOutputBudget;
}

export interface GenerateVisibleAnswerPlanInput extends CreateVisibleTaskProgressInput {
  providerSettings: AIProviderSettings;
  references: LoomLink[];
  signal?: AbortSignal;
}

interface VisiblePlanTaskJson {
  title?: unknown;
  stage?: unknown;
}

interface VisiblePlanJson {
  tasks?: unknown;
  contentOutline?: unknown;
  outline?: unknown;
}

type VisiblePlanExecutor = (prompt: string) => Promise<string>;

const QUICK_VISIBLE_PLAN_TIMEOUT_MS = 5_000;
const MAX_VISIBLE_DEBUG_EVENTS = 18;

const tasks = {
  understandingQuestion: {
    id: "understanding-question",
    title: "Understanding the question",
    stage: "orchestration",
  },
  understandingRequest: {
    id: "understanding-request",
    title: "Understanding the request",
    stage: "orchestration",
  },
  preparingPlan: {
    id: "preparing-answer-plan",
    title: "Preparing answer plan",
    stage: "orchestration",
  },
  generatingAnswer: {
    id: "generating-answer",
    title: "Generating answer",
    stage: "generation",
  },
  readingReferences: {
    id: "reading-references",
    title: "Reading references",
    stage: "references",
  },
  mappingReferences: {
    id: "mapping-references",
    title: "Mapping references",
    stage: "references",
  },
  comparingContext: {
    id: "comparing-context",
    title: "Comparing context",
    stage: "context",
  },
  buildingContext: {
    id: "building-loom-context",
    title: "Building Loom context",
    stage: "context",
  },
  planningExplanation: {
    id: "planning-explanation",
    title: "Planning the explanation",
    stage: "planning",
  },
  inspectingCodeContext: {
    id: "inspecting-code-context",
    title: "Inspecting code context",
    stage: "context",
  },
  planningSolution: {
    id: "planning-solution",
    title: "Planning solution",
    stage: "planning",
  },
  draftingAnswer: {
    id: "drafting-answer",
    title: "Drafting answer",
    stage: "generation",
  },
  synthesizingAnswer: {
    id: "synthesizing-answer",
    title: "Synthesizing answer",
    stage: "planning",
  },
  writingAnswer: {
    id: "writing-answer",
    title: "Writing answer",
    stage: "finalizing",
  },
  writingFinalResponse: {
    id: "writing-final-response",
    title: "Writing final response",
    stage: "finalizing",
  },
} satisfies Record<string, VisibleAnswerTaskTemplate>;

const codeTaskSignals = [
  "code",
  "kod",
  "function",
  "fonksiyon",
  "class",
  "sınıf",
  "bug",
  "hata",
  "stack trace",
  "refactor",
  "implement",
  "uygula",
  "debug",
  "fix",
];

function normalizePrompt(value: string) {
  return value.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

function promptLooksCodeLike(promptText: string) {
  const prompt = normalizePrompt(promptText);
  return codeTaskSignals.some((signal) => prompt.includes(signal));
}

function uniqueTemplates(templates: VisibleAnswerTaskTemplate[]) {
  const seen = new Set<string>();
  return templates.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
}

function withPendingStatus(templates: VisibleAnswerTaskTemplate[]): VisibleAnswerTask[] {
  return uniqueTemplates(templates).map((task) => ({ ...task, status: "pending" }));
}

function statusTextForTitle(title: string) {
  return `${title}...`;
}

function titleFromStatusText(statusText: string) {
  return statusText.replace(/\s*\.\.\.$/, "").trim() || statusText;
}

function transientTaskId(stage: VisibleAnswerStage) {
  return `visible-${stage}-status`;
}

function planId() {
  return `visible-plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeTaskTitle(value: string) {
  return compact(value)
    .replace(/[{}[\]"]/g, "")
    .replace(/\s*\.\.\.$/, "")
    .slice(0, 72);
}

function normalizeStage(value: unknown): VisibleAnswerStage | undefined {
  if (value === "orchestration") return "orchestration";
  if (value === "context") return "context";
  if (value === "references" || value === "retrieval") return "references";
  if (value === "planning" || value === "synthesis") return "planning";
  if (value === "generation") return "generation";
  if (value === "finalizing") return "finalizing";
  return undefined;
}

function hasUnsafePlanText(value: string) {
  return /\b(chain[- ]?of[- ]?thought|hidden thinking|raw thinking|reasoning|sqlite|capsule|artifact|planner json|internal)\b/i.test(value);
}

function taskIdForTitle(title: string, index: number) {
  const slug = title
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "task"}-${index + 1}`;
}

function planFromTasks(
  source: VisibleAnswerPlan["source"],
  planTasks: VisibleAnswerTask[],
  contentOutline?: string[]
): VisibleAnswerPlan {
  return {
    id: planId(),
    source,
    tasks: planTasks.map((task) => ({ ...task, status: "pending" })),
    contentOutline,
    createdAt: Date.now(),
  };
}

function progressFromPlan(plan: VisibleAnswerPlan): VisibleAnswerProgress {
  return {
    tasks: plan.tasks.map((task) => ({ ...task })),
    contentOutline: plan.contentOutline,
    debug: createVisibleAnswerDebugState(),
    statusText: "",
  };
}

function createDebugEventId() {
  return `debug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createVisibleAnswerDebugState(): VisibleAnswerDebugState {
  return { startedAt: Date.now() };
}

export function formatVisibleDuration(ms: number | undefined) {
  if (ms === undefined) return "";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function appendVisibleProgressEvent(
  progress: VisibleAnswerProgress,
  label: string,
  detail?: string
): VisibleAnswerProgress {
  const debug = progress.debug ?? createVisibleAnswerDebugState();
  const createdAt = Date.now();
  const event: VisibleAnswerDebugEvent = {
    id: createDebugEventId(),
    label,
    detail,
    createdAt,
    elapsedMs: Math.max(0, createdAt - debug.startedAt),
  };
  return {
    ...progress,
    debug,
    debugEvents: [...(progress.debugEvents ?? []), event].slice(-MAX_VISIBLE_DEBUG_EVENTS),
  };
}

export function updateVisibleProgressDebug(
  progress: VisibleAnswerProgress,
  patch: Partial<VisibleAnswerDebugState>
): VisibleAnswerProgress {
  return {
    ...progress,
    debug: {
      ...(progress.debug ?? createVisibleAnswerDebugState()),
      ...patch,
    },
  };
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No visible plan JSON object");
  return JSON.parse(candidate.slice(start, end + 1)) as VisiblePlanJson;
}

function normalizeQuickModelTasks(value: string): VisibleAnswerTask[] {
  const parsed = parseJsonObject(value);
  if (!Array.isArray(parsed.tasks)) throw new Error("Visible plan tasks must be an array");
  const normalized = (parsed.tasks as VisiblePlanTaskJson[])
    .map((task, index): VisibleAnswerTask | undefined => {
      const title = typeof task.title === "string" ? sanitizeTaskTitle(task.title) : "";
      const stage = normalizeStage(task.stage);
      if (!title || !stage || hasUnsafePlanText(title)) return undefined;
      return {
        id: taskIdForTitle(title, index),
        title,
        stage,
        status: "pending",
      };
    })
    .filter((task): task is VisibleAnswerTask => Boolean(task));
  if (normalized.length < 2) throw new Error("Visible plan needs at least two safe tasks");
  return normalized.slice(0, 6);
}

function normalizeContentOutlineItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? sanitizeTaskTitle(item) : ""))
    .filter((item) => item.length > 0 && !hasUnsafePlanText(item))
    .slice(0, 6);
}

function referencePreview(link: LoomLink) {
  return {
    title: referenceTokenText(link, link.referenceDisplayMode ?? "title"),
    type: link.type,
    selectedTextPreview: link.selectedText ? compact(link.selectedText).slice(0, 180) : undefined,
    sourceResponseTitle: link.sourceResponseTitle,
    sourceResponseCode: link.sourceResponseCode ?? link.referenceCode,
  };
}

export function buildVisibleAnswerPlanPrompt(input: {
  promptText: string;
  answerPlan: AnswerPlan;
  references: LoomLink[];
}) {
  return JSON.stringify(
    {
      task:
        "Create a user-visible execution checklist for how Loom should answer. Do not answer the user.",
      rules: [
        "Return JSON only.",
        "Return 3 to 6 short task titles.",
        "Return 2 to 6 short content outline items showing what the answer will cover.",
        "Content outline items are answer topics, not reasoning steps.",
        "Do not reveal reasoning.",
        "Do not include chain-of-thought.",
        "Do not include hidden thinking.",
        "Use only user-safe task labels.",
      ],
      allowedStages: [
        "orchestration",
        "references",
        "context",
        "planning",
        "generation",
        "finalizing",
      ],
      outputShape: {
        tasks: [{ title: "Understand the question", stage: "orchestration" }],
        contentOutline: ["Define the topic", "Explain practical use"],
      },
      userPrompt: input.promptText,
      referenceCount: input.references.length,
      references: input.references.slice(0, 6).map(referencePreview),
      detectedPlan: {
        intent: input.answerPlan.intent,
        answerStyle: input.answerPlan.answerStyle,
        contextStrategy: input.answerPlan.contextStrategy,
        complexity: input.answerPlan.complexity,
        questionUnitCount: input.answerPlan.questionUnits.length,
      },
    },
    null,
    2
  );
}

export function resolveVisibleAnswerTasks(
  input: CreateVisibleTaskProgressInput
): VisibleAnswerTask[] {
  const longForm =
    promptHasLongFormSignal(input.promptText) ||
    input.outputBudget === "long" ||
    input.outputBudget === "extended";

  if (promptLooksCodeLike(input.promptText)) {
    return withPendingStatus([
      tasks.understandingRequest,
      tasks.inspectingCodeContext,
      tasks.planningSolution,
      tasks.writingAnswer,
    ]);
  }

  if (
    input.answerPlan.intent === "simple_factual" &&
    input.referenceCount === 0 &&
    !longForm
  ) {
    return withPendingStatus([tasks.understandingQuestion, tasks.writingAnswer]);
  }

  if (input.answerPlan.intent === "multi_reference_synthesis") {
    return withPendingStatus([
      tasks.understandingQuestion,
      tasks.mappingReferences,
      tasks.comparingContext,
      tasks.synthesizingAnswer,
      tasks.writingFinalResponse,
    ]);
  }

  if (
    input.referenceCount > 0 ||
    input.answerPlan.contextStrategy === "reference_scoped"
  ) {
    return withPendingStatus([
      tasks.understandingQuestion,
      tasks.readingReferences,
      tasks.buildingContext,
      tasks.writingAnswer,
    ]);
  }

  if (longForm) {
    return withPendingStatus([
      tasks.understandingQuestion,
      tasks.planningExplanation,
      tasks.buildingContext,
      tasks.draftingAnswer,
      tasks.writingFinalResponse,
    ]);
  }

  return withPendingStatus([
    tasks.understandingQuestion,
    tasks.buildingContext,
    tasks.writingAnswer,
  ]);
}

function questionUnitOutline(input: CreateVisibleTaskProgressInput) {
  const units = input.answerPlan.questionUnits
    .map((unit) => compact(unit.displayText || unit.question))
    .filter(Boolean);
  if (units.length >= 2) return units.slice(0, 6);
  return [];
}

function promptQuestionOutline(promptText: string) {
  return promptText
    .split(/[?\n]+/)
    .map((part) => compact(part.replace(/\[\[([^\]]+)\]\]/g, "$1")))
    .filter((part) => part.length > 0)
    .slice(0, 5);
}

export function resolveVisibleContentOutline(
  input: CreateVisibleTaskProgressInput
): string[] {
  const unitOutline = questionUnitOutline(input);
  if (unitOutline.length >= 2) return unitOutline;

  if (input.answerPlan.intent === "multi_reference_synthesis") {
    return ["Referenced points", "Shared themes", "Comparison and synthesis"];
  }

  const promptOutline = promptQuestionOutline(input.promptText);
  if (promptOutline.length >= 2) return promptOutline;

  if (promptLooksCodeLike(input.promptText)) {
    return ["Problem context", "Likely cause", "Suggested fix"];
  }

  const longForm =
    promptHasLongFormSignal(input.promptText) ||
    input.outputBudget === "long" ||
    input.outputBudget === "extended";
  if (longForm) {
    return ["Definition", "How it works", "Where it is used", "Benefits and tradeoffs"];
  }

  if (input.answerPlan.intent === "simple_factual") {
    return ["Direct answer", "Brief context"];
  }

  if (input.referenceCount > 0 || input.answerPlan.contextStrategy === "reference_scoped") {
    return ["Referenced context", "Answer to the question", "Source-specific notes"];
  }

  return ["Main answer", "Useful context"];
}

export function createDeterministicVisibleAnswerPlan(
  input: CreateVisibleTaskProgressInput
): VisibleAnswerPlan {
  return planFromTasks(
    "deterministic",
    resolveVisibleAnswerTasks(input),
    resolveVisibleContentOutline(input)
  );
}

export async function generateVisibleAnswerPlan(
  input: GenerateVisibleAnswerPlanInput
): Promise<VisibleAnswerPlan> {
  return generateVisibleAnswerPlanWithExecutor(input, async (prompt) => {
    const result = await runWithTimeoutSignal(
      input.signal,
      QUICK_VISIBLE_PLAN_TIMEOUT_MS,
      (signal) =>
        runModelProfileRequest(input.providerSettings, {
          profile: "quick",
          effort: "Low",
          mode: "instant",
          think: false,
          outputBudget: "short",
          numPredict: 512,
          referenceCount: input.references.length,
          referenceCharCount: input.references.reduce(
            (total, reference) =>
              total + reference.title.length + (reference.selectedText?.length ?? 0),
            0
          ),
          messageCount: 2,
          signal,
          system:
            "You create concise user-visible execution checklists and answer outlines. Return JSON only. Do not answer the user. Do not reveal reasoning or hidden thinking.",
          prompt,
        })
    );
    return result.text;
  });
}

export async function generateVisibleAnswerPlanWithExecutor(
  input: CreateVisibleTaskProgressInput & {
    references: LoomLink[];
  },
  executor: VisiblePlanExecutor
): Promise<VisibleAnswerPlan> {
  const fallback = createDeterministicVisibleAnswerPlan(input);
  try {
    const result = await executor(buildVisibleAnswerPlanPrompt(input));
    const parsed = parseJsonObject(result);
    const contentOutline =
      normalizeContentOutlineItems(parsed.contentOutline).length > 0
        ? normalizeContentOutlineItems(parsed.contentOutline)
        : normalizeContentOutlineItems(parsed.outline);
    return planFromTasks(
      "quickModel",
      normalizeQuickModelTasks(result),
      contentOutline.length > 0 ? contentOutline : fallback.contentOutline
    );
  } catch {
    return fallback;
  }
}

export function createVisibleAnswerProgressFromStatus(
  statusText: string,
  stage: VisibleAnswerStage
): VisibleAnswerProgress {
  const task: VisibleAnswerTask = {
    id: transientTaskId(stage),
    title: titleFromStatusText(statusText),
    stage,
    status: "running",
  };

  return {
    tasks: [task],
    activeTaskId: task.id,
    statusText,
    debug: createVisibleAnswerDebugState(),
  };
}

export function createInitialVisibleAnswerProgress(): VisibleAnswerProgress {
  return createVisibleAnswerProgressFromStatus(
    "Understanding the question...",
    "orchestration"
  );
}

export function createOrchestrationVisibleProgress(): VisibleAnswerProgress {
  return {
    tasks: [
      { ...tasks.understandingQuestion, status: "running" },
      { ...tasks.preparingPlan, status: "pending" },
    ],
    activeTaskId: tasks.understandingQuestion.id,
    statusText: "Understanding the question...",
    debug: createVisibleAnswerDebugState(),
  };
}

function completeTask(task: VisibleAnswerTask, now: number): VisibleAnswerTask {
  if (task.status === "done") return task;
  const startedAt = task.startedAt ?? now;
  return {
    ...task,
    status: "done",
    startedAt,
    completedAt: now,
    durationMs: Math.max(0, now - startedAt),
  };
}

function runTask(task: VisibleAnswerTask, now: number): VisibleAnswerTask {
  if (task.status === "done") return task;
  return {
    ...task,
    status: "running",
    startedAt: task.startedAt ?? now,
    completedAt: undefined,
    durationMs: undefined,
  };
}

function pendingTask(task: VisibleAnswerTask): VisibleAnswerTask {
  if (task.status === "done") return task;
  return {
    ...task,
    status: "pending",
  };
}

function ensureOrchestrationTasks(progress: VisibleAnswerProgress): VisibleAnswerProgress {
  const existingIds = new Set(progress.tasks.map((task) => task.id));
  const requiredTasks: VisibleAnswerTask[] = [];
  if (!existingIds.has(tasks.understandingQuestion.id)) {
    requiredTasks.push({ ...tasks.understandingQuestion, status: "pending" });
  }
  if (!existingIds.has(tasks.preparingPlan.id)) {
    requiredTasks.push({ ...tasks.preparingPlan, status: "pending" });
  }
  if (requiredTasks.length === 0) return progress;
  return {
    ...progress,
    tasks: [...requiredTasks, ...progress.tasks],
  };
}

function ensureTask(
  progress: VisibleAnswerProgress,
  template: VisibleAnswerTaskTemplate
): VisibleAnswerProgress {
  if (progress.tasks.some((task) => task.id === template.id)) return progress;
  return {
    ...progress,
    tasks: [...progress.tasks, { ...template, status: "pending" }],
  };
}

export function advanceVisibleProgress(
  progress: VisibleAnswerProgress | undefined,
  milestone: VisibleProgressMilestone
): VisibleAnswerProgress | undefined {
  if (!progress) return undefined;

  const now = Date.now();
  const normalized = ensureOrchestrationTasks(progress);
  const understandingId = tasks.understandingQuestion.id;
  const preparingId = tasks.preparingPlan.id;
  const generatingId = tasks.generatingAnswer.id;
  let activeTaskId: string | undefined;
  let statusText = "";
  const progressWithLifecycle =
    milestone === "thinking_status" || milestone === "content_delta"
      ? ensureTask(normalized, tasks.generatingAnswer)
      : normalized;

  const nextTasks = progressWithLifecycle.tasks.map((task) => {
    if (milestone === "thinking_status") {
      if (task.id === understandingId || task.id === preparingId) return completeTask(task, now);
      if (task.id === generatingId) {
        activeTaskId = task.id;
        statusText = statusTextForTitle(task.title);
        return runTask(task, now);
      }
      return task;
    }
    if (milestone === "answer_plan_ready") {
      if (task.id === understandingId) return completeTask(task, now);
      if (task.id === preparingId) {
        if (task.status === "done") return task;
        activeTaskId = task.id;
        statusText = statusTextForTitle(task.title);
        return runTask(task, now);
      }
      return task;
    }
    if (milestone === "content_delta") {
      if (task.id === understandingId || task.id === preparingId) return completeTask(task, now);
      if (task.id === generatingId) {
        activeTaskId = task.id;
        statusText = statusTextForTitle(task.title);
        return runTask(task, now);
      }
      return task;
    }
    if (milestone === "context_ready") {
      if (task.id === understandingId) return completeTask(task, now);
      if (task.id === preparingId) {
        if (task.status === "done") return task;
        activeTaskId = task.id;
        statusText = statusTextForTitle(task.title);
        return runTask(task, now);
      }
      return pendingTask(task);
    }
    return task;
  });

  if (milestone === "context_ready") {
    const preparingTask = nextTasks.find((task) => task.id === preparingId);
    if (preparingTask?.status === "done") {
      activeTaskId = undefined;
      statusText = "";
    }
  }
  if (!activeTaskId) {
    const runningTask = nextTasks.find((task) => task.status === "running");
    if (runningTask) {
      activeTaskId = runningTask.id;
      statusText = statusTextForTitle(runningTask.title);
    }
  }

  return {
    ...progressWithLifecycle,
    tasks: nextTasks,
    activeTaskId,
    statusText,
  };
}

export function createVisibleTaskProgress(
  input: CreateVisibleTaskProgressInput,
  activeStage?: VisibleAnswerStage
): VisibleAnswerProgress {
  const progress = progressFromPlan(createDeterministicVisibleAnswerPlan(input));

  const stage = activeStage ?? progress.tasks[0]?.stage ?? "orchestration";
  return activateVisibleAnswerStage(progress, stage);
}

export function createVisibleTaskProgressFromPlan(
  plan: VisibleAnswerPlan,
  activeStage?: VisibleAnswerStage
): VisibleAnswerProgress {
  const progress = progressFromPlan(plan);
  const stage = activeStage ?? progress.tasks[0]?.stage ?? "orchestration";
  return activateVisibleAnswerStage(progress, stage);
}

export function activateVisibleAnswerStage(
  progress: VisibleAnswerProgress,
  stage: VisibleAnswerStage,
  statusText?: string
): VisibleAnswerProgress {
  const now = Date.now();
  const activeIndex = progress.tasks.findIndex((task) => task.stage === stage);
  if (activeIndex < 0) {
    const task: VisibleAnswerTask = {
      id: transientTaskId(stage),
      title: titleFromStatusText(statusText ?? statusTextForTitle(stage)),
      stage,
      status: "running",
      startedAt: now,
    };
    return {
      ...progress,
      tasks: [
        ...progress.tasks.map((item) => {
          if (item.status === "done") return item;
          const startedAt = item.startedAt ?? now;
          return {
            ...item,
            status: "done" as const,
            startedAt,
            completedAt: now,
            durationMs: Math.max(0, now - startedAt),
          };
        }),
        task,
      ],
      activeTaskId: task.id,
      statusText: statusText ?? statusTextForTitle(task.title),
      contentOutline: progress.contentOutline,
    };
  }

  const activeTask = progress.tasks[activeIndex];
  return {
    ...progress,
    tasks: progress.tasks.map((task, index) => ({
      ...task,
      status: index < activeIndex ? "done" : index === activeIndex ? "running" : "pending",
      startedAt:
        index === activeIndex
          ? task.startedAt ?? now
          : index < activeIndex
            ? task.startedAt ?? now
            : task.startedAt,
      completedAt:
        index < activeIndex
          ? task.completedAt ?? now
          : index === activeIndex
            ? undefined
            : task.completedAt,
      durationMs:
        index < activeIndex
          ? task.durationMs ?? Math.max(0, now - (task.startedAt ?? now))
          : index === activeIndex
            ? undefined
            : task.durationMs,
    })),
    activeTaskId: activeTask.id,
    statusText: statusText ?? statusTextForTitle(activeTask.title),
    contentOutline: progress.contentOutline,
  };
}

export function finishVisibleAnswerProgress(
  progress: VisibleAnswerProgress
): VisibleAnswerProgress {
  return {
    ...progress,
    tasks: progress.tasks.map((task) => ({ ...task, status: "done" })),
    activeTaskId: undefined,
    contentOutline: progress.contentOutline,
    statusText: "",
  };
}
