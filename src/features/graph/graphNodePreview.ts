import type { LoomGraphProjectionNode } from "../../services/loomGraphProjection";
import type { ResponseItem } from "../../types";

export interface GraphResponsePreviewContent {
  question: string;
  answerMarkdown: string;
}

function normalizePreviewText(value?: string) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function responseAnswerPreview(response: ResponseItem | undefined) {
  if (!response) return "";
  return normalizePreviewText(
    response.finalContent !== undefined
      ? response.finalContent
      : response.answer.slice(0, 2).join("\n")
  );
}

export function graphNodePreviewText(
  node: LoomGraphProjectionNode,
  response: ResponseItem | undefined
) {
  const previewText = normalizePreviewText(node.contentPreview);
  const summaryText = normalizePreviewText(node.summary);

  if (node.kind === "response") {
    return responseAnswerPreview(response) || previewText;
  }

  if (!previewText || previewText === summaryText) {
    return "";
  }

  return previewText;
}

function splitServicePreview(previewText: string, fallbackTitle: string) {
  const questionMatch = /^Question:\s*(.+?\?)\s*(.*)$/i.exec(previewText);
  if (!questionMatch) {
    return {
      question: fallbackTitle,
      answerMarkdown: previewText,
    };
  }

  return {
    question: questionMatch[1].trim(),
    answerMarkdown: questionMatch[2].trim() || previewText,
  };
}

export function graphResponsePreviewForNode(
  node: LoomGraphProjectionNode,
  response: ResponseItem | undefined
): GraphResponsePreviewContent | null {
  if (response) {
    return {
      question: response.question,
      answerMarkdown:
        response.finalContent !== undefined
          ? response.finalContent
          : response.answer.join("\n\n"),
    };
  }

  if (node.kind !== "response") return null;

  const previewText =
    graphNodePreviewText(node, response) ||
    normalizePreviewText(node.fullContent) ||
    normalizePreviewText(node.summary);
  if (!previewText) return null;

  return splitServicePreview(previewText, node.title);
}
