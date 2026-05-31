/*
 * Legacy/dev/test-only runtime context builder after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { Conversation, LoomForkRecord, LoomLink, ResponseItem } from "../types";
import {
  createHeuristicResponseContextCapsule,
  type ResponseContextCapsule,
} from "./responseContextCapsule";
import type { OllamaContextMode } from "./modelProviders";
import type { AnswerPlan, ContextStrategy, QuestionUnit } from "./answerPlanner";

export interface LoomCheckpointSummary {
  loomId: string;
  goal: string;
  decisions: string[];
  constraints: string[];
  importantEntities: string[];
  activeWefts: string[];
  unresolvedQuestions: string[];
  updatedAt: number;
}

export interface LoomContextReference {
  link: LoomLink;
  targetResponse?: ResponseItem;
  targetLoomId?: string;
  capsule?: ResponseContextCapsule;
}

export interface LoomQuestionGroup {
  references: LoomLink[];
  question: string;
  displayText?: string;
}

export interface LoomContextBuilderInput {
  loomId: string;
  currentHeadResponseId?: string;
  newUserPrompt: string;
  rewrittenPrompt?: string;
  answerPlan?: AnswerPlan;
  questionUnits?: QuestionUnit[];
  contextStrategy?: ContextStrategy;
  questionGroups?: LoomQuestionGroup[];
  attachedReferences: LoomContextReference[];
  responseMode: OllamaContextMode;
  resolvedNumCtx: number;
  activeWeftOrigin?: {
    originLoomId: string;
    originResponseId: string;
    response?: ResponseItem;
    capsule?: ResponseContextCapsule;
  };
  conversation?: Conversation;
  responses: ResponseItem[];
  responseCapsules?: Record<string, ResponseContextCapsule>;
  checkpointSummary?: LoomCheckpointSummary;
  forkRecords: LoomForkRecord[];
}

export interface LoomContextBuilderOutput {
  system: string;
  context: string[];
  prompt: string;
  estimatedCharCount: number;
  includedRecentTurnCount: number;
  includedReferenceCount: number;
  includedWeftOrigin: boolean;
  includedCheckpoint: boolean;
  budgetChars: number;
}

interface BudgetPushResult {
  pushed: boolean;
}

function contextBudgetChars(resolvedNumCtx: number) {
  return Math.max(2200, Math.floor(resolvedNumCtx * 2.8));
}

function compact(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function capsuleKey(loomId: string, responseId: string) {
  return `${loomId}:${responseId}`;
}

function capsuleForResponse(
  loomId: string,
  response: ResponseItem,
  cache?: Record<string, ResponseContextCapsule>
) {
  return (
    cache?.[capsuleKey(loomId, response.id)] ??
    createHeuristicResponseContextCapsule(response, loomId)
  );
}

function renderTurn(
  loomId: string,
  response: ResponseItem,
  cache?: Record<string, ResponseContextCapsule>
) {
  const capsule = capsuleForResponse(loomId, response, cache);
  return [
    `User: ${compact(response.question, 420)}`,
    `Prior response ${capsule.responseCode ?? response.id}: ${capsule.title}`,
    `Summary: ${compact(capsule.summary, 520)}`,
    capsule.keyPoints.length > 0
      ? `Key points:\n${capsule.keyPoints.slice(0, 4).map((point) => `- ${point}`).join("\n")}`
      : "",
    capsule.keywords.length > 0 ? `Keywords: ${capsule.keywords.slice(0, 8).join(", ")}` : "",
  ].join("\n");
}

function renderCapsule(label: string, capsule: ResponseContextCapsule) {
  // When a selected fragment is present, it is the primary focus.
  // Source summary and key points are demoted to background context.
  const hasFragment = Boolean(capsule.selectedText);
  return [
    `${label}: ${capsule.title}`,
    capsule.responseCode ? `Code: ${capsule.responseCode}` : "",
    capsule.canonicalUri ? `URI: ${capsule.canonicalUri}` : "",
    hasFragment ? `Primary selected fragment: ${capsule.selectedText}` : "",
    hasFragment
      ? `Background source summary: ${capsule.summary}`
      : `Summary: ${capsule.summary}`,
    capsule.keyPoints.length > 0
      ? `${hasFragment ? "Background key points" : "Key points"}:\n${capsule.keyPoints.map((point) => `- ${point}`).join("\n")}`
      : "",
    capsule.keywords.length > 0 ? `Keywords: ${capsule.keywords.join(", ")}` : "",
    capsule.entities.length > 0 ? `Entities: ${capsule.entities.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function renderCheckpoint(summary: LoomCheckpointSummary) {
  return [
    "Loom checkpoint summary:",
    `Goal: ${summary.goal}`,
    summary.decisions.length > 0
      ? `Decisions:\n${summary.decisions.map((item) => `- ${item}`).join("\n")}`
      : "",
    summary.constraints.length > 0
      ? `Constraints:\n${summary.constraints.map((item) => `- ${item}`).join("\n")}`
      : "",
    summary.importantEntities.length > 0
      ? `Important entities: ${summary.importantEntities.join(", ")}`
      : "",
    summary.activeWefts.length > 0 ? `Active Wefts: ${summary.activeWefts.join(", ")}` : "",
    summary.unresolvedQuestions.length > 0
      ? `Unresolved questions:\n${summary.unresolvedQuestions.map((item) => `- ${item}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");
}

function referenceQuestionLabel(link: LoomLink) {
  return compact(
    link.referenceCustomLabel ??
      link.selectedText ??
      link.title ??
      link.referenceCode ??
      "Reference",
    120
  );
}

function renderQuestionGroupReference(link: LoomLink) {
  return [
    `Reference label: ${referenceQuestionLabel(link)}`,
    link.selectedText ? `Selected fragment: "${compact(link.selectedText, 700)}"` : "",
    link.referenceCode || link.sourceResponseCode || link.meta?.code
      ? `Source response code: ${link.referenceCode ?? link.sourceResponseCode ?? link.meta?.code}`
      : "",
    link.sourceResponseTitle ? `Source title: ${link.sourceResponseTitle}` : "",
    link.canonicalUri || link.sourceCanonicalUri || link.path
      ? `Source address: ${link.canonicalUri ?? link.sourceCanonicalUri ?? link.path}`
      : "",
  ].filter(Boolean).join("\n");
}

function expectedSectionHeading(group: LoomQuestionGroup) {
  const labels = group.references.map(referenceQuestionLabel).filter(Boolean);
  if (labels.length > 0) return labels.join(" / ");
  return compact(group.question, 120) || "Answer";
}

function renderQuestionGroups(groups: LoomQuestionGroup[]) {
  return [
    [
      "The user asked multiple reference-focused questions.",
      "Answer them as separate sections.",
      "Use the reference label as the section heading when natural.",
      "Use each selected fragment as the primary subject of its nearby question.",
      "Use the source context only as background.",
      "Do not use numbered group headings.",
      "Answer naturally in the user's language.",
      "Do not mention internal source packaging or wrapper labels.",
    ].join("\n"),
    ...groups.map((group) => {
      const references =
        group.references.length > 0
          ? group.references.map(renderQuestionGroupReference).join("\n")
          : "Reference label: General Loom question";
      return [
        "Question:",
        `Current question: ${group.question}`,
        references,
        group.displayText ? `Display text: ${group.displayText}` : "",
        `Expected section heading: ${expectedSectionHeading(group)}`,
        "Source context is secondary background for this question.",
      ].filter(Boolean).join("\n");
    }),
  ].join("\n\n");
}

function pushWithinBudget(parts: string[], part: string, budgetChars: number): BudgetPushResult {
  const current = parts.reduce((total, item) => total + item.length, 0);
  if (current + part.length <= budgetChars) {
    parts.push(part);
    return { pushed: true };
  }
  const remaining = budgetChars - current;
  if (remaining < 240) return { pushed: false };
  const truncated = compact(part, remaining);
  parts.push(truncated);
  return { pushed: true };
}

function pushOptionalWithinBudget(parts: string[], part: string, budgetChars: number) {
  const current = parts.reduce((total, item) => total + item.length, 0);
  if (current + part.length > budgetChars) return false;
  parts.push(part);
  return true;
}

function recentResponses(input: LoomContextBuilderInput) {
  if (input.contextStrategy === "minimal" || input.answerPlan?.contextStrategy === "minimal") {
    return [];
  }
  const headIndex = input.currentHeadResponseId
    ? input.responses.findIndex((response) => response.id === input.currentHeadResponseId)
    : input.responses.length - 1;
  const endIndex = headIndex >= 0 ? headIndex + 1 : input.responses.length;
  const recentWindow = input.resolvedNumCtx <= 2048 ? 3 : input.resolvedNumCtx <= 4096 ? 5 : 7;
  return input.responses.slice(Math.max(0, endIndex - recentWindow), endIndex);
}

function hasFragmentReference(attachedReferences: LoomContextReference[]): boolean {
  return attachedReferences.some(
    (reference) =>
      reference.link.selectedText ||
      reference.capsule?.selectedText
  );
}

export function buildLoomContext(input: LoomContextBuilderInput): LoomContextBuilderOutput {
  const budgetChars = contextBudgetChars(input.resolvedNumCtx);
  const context: string[] = [];
  const contextStrategy = input.contextStrategy ?? input.answerPlan?.contextStrategy ?? "standard";
  const questionUnits = input.questionUnits ?? input.answerPlan?.questionUnits;
  const fragmentFocusClause = hasFragmentReference(input.attachedReferences)
    ? " A selected fragment is attached as a reference." +
      " Treat the selected fragment as the primary subject of the answer." +
      " Use the source response only as supporting background." +
      " For short prompts such as \"explain\", \"why?\", \"what does this mean?\", or \"give an example\"," +
      " answer about the selected fragment." +
      " Do not restate or summarize the full source response unless the user explicitly asks for that."
    : "";
  const system = [
    "You are Loom. Continue the active Loom with continuity.",
    "Use recent turns, checkpoint summaries, Weft origin, and References as silent internal context.",
    "Prefer compact source summaries over full response text unless the prompt explicitly needs exact wording.",
    "Answer directly. Do not mention context blocks, capsules, wrapper labels, or artifact names.",
    "Do not assume unrelated Loom content.",
  ].join(" ") + fragmentFocusClause;

  const includeHeavyLoomContext = contextStrategy !== "minimal";
  const includeCheckpoint =
    includeHeavyLoomContext &&
    (contextStrategy === "standard" || contextStrategy === "multi_reference") &&
    (input.responses.length > 5 || input.attachedReferences.length > 0);
  const checkpointNeeded = includeCheckpoint;
  if (checkpointNeeded && input.checkpointSummary) {
    pushOptionalWithinBudget(context, renderCheckpoint(input.checkpointSummary), budgetChars);
  }

  const recentTurns = recentResponses(input);
  let includedRecentTurnCount = 0;
  recentTurns.forEach((response) => {
    const result = pushWithinBudget(
      context,
      renderTurn(input.loomId, response, input.responseCapsules),
      budgetChars
    );
    if (result.pushed) includedRecentTurnCount += 1;
  });

  let includedWeftOrigin = false;
  if (includeHeavyLoomContext && input.activeWeftOrigin?.response) {
    const capsule =
      input.activeWeftOrigin.capsule ??
      capsuleForResponse(
        input.activeWeftOrigin.originLoomId,
        input.activeWeftOrigin.response,
        input.responseCapsules
      );
    includedWeftOrigin = pushOptionalWithinBudget(
      context,
      renderCapsule("Weft origin source", capsule),
      budgetChars
    );
  }

  let includedReferenceCount = 0;
  const referencedQuestionUnitLinks = new Set(
    questionUnits?.flatMap((unit) => unit.references.map((reference) => reference.path)) ?? []
  );
  const scopedReferences =
    contextStrategy === "reference_scoped" && referencedQuestionUnitLinks.size > 0
      ? input.attachedReferences.filter((reference) =>
          referencedQuestionUnitLinks.has(reference.link.path)
        )
      : input.attachedReferences;
  const referencesToInclude =
    contextStrategy === "minimal" ? [] : scopedReferences;

  referencesToInclude.forEach((reference) => {
    const capsule =
      reference.capsule ??
      (reference.targetResponse && reference.targetLoomId
        ? capsuleForResponse(reference.targetLoomId, reference.targetResponse, input.responseCapsules)
        : undefined);
    const rendered = capsule
      ? renderCapsule(`Attached Reference source (${reference.link.title})`, capsule)
      : `Attached Reference: ${reference.link.title}\nURI: ${
          reference.link.canonicalUri ?? reference.link.path
        }`;
    if (pushOptionalWithinBudget(context, rendered, budgetChars)) includedReferenceCount += 1;
  });

  const groupedPrompt =
    questionUnits && questionUnits.length > 0 && input.answerPlan?.answerStyle === "separate_sections"
      ? renderQuestionGroups(
          questionUnits.map((unit) => ({
            references: unit.references,
            question: unit.question,
            displayText: unit.displayText,
          }))
        )
      : input.questionGroups && input.questionGroups.length > 0
        ? renderQuestionGroups(input.questionGroups)
        : input.rewrittenPrompt ?? input.newUserPrompt;

  return {
    system,
    context,
    prompt: groupedPrompt,
    estimatedCharCount: context.reduce((total, item) => total + item.length, 0),
    includedRecentTurnCount,
    includedReferenceCount,
    includedWeftOrigin,
    includedCheckpoint: Boolean(checkpointNeeded && input.checkpointSummary),
    budgetChars,
  };
}
