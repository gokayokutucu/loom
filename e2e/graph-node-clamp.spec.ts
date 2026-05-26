// E2E data authority classification: PURE_UI_HELPER.
// Validates graph node question preview clamping at the logic and CSS contract layers.
// Product-service-backed clamping proof lives in graph-projection.spec.ts.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { graphNodePreviewText } from "../src/features/graph/graphNodePreview";
import type { LoomGraphProjectionNode } from "../src/services/loomGraphProjection";
import type { ResponseItem } from "../src/types";

function makeResponseNode(
  overrides: Partial<LoomGraphProjectionNode> = {}
): LoomGraphProjectionNode {
  return {
    id: "node-1",
    kind: "response",
    loomId: "loom-1",
    title: "Short question",
    depth: 1,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeResponse(overrides: Partial<ResponseItem> = {}): ResponseItem {
  return {
    id: "resp-1",
    title: "Short question",
    address: "loom://test/resp-1",
    question: "Short question",
    answer: ["Short answer"],
    suggestedLinks: [],
    bookmarkedLinks: [],
    ...overrides,
  };
}

test.describe("[pure-ui-helper] graph node question preview clamp", () => {
  test("short user question preview passes through graphNodePreviewText without mutation", () => {
    const node = makeResponseNode({ contentPreview: "Short preview" });
    const response = makeResponse({ finalContent: "Short answer" });
    const preview = graphNodePreviewText(node, response);
    // Response nodes show the answer text as preview; question is untouched
    expect(preview).toBe("Short answer");
    expect(response.question).toBe("Short question");
    expect(response.finalContent).toBe("Short answer");
  });

  test("long stored question is not destructively truncated by graphNodePreviewText", () => {
    const longQuestion = "A very long user question. ".repeat(80).trim();
    const longAnswer = "A detailed answer. ".repeat(120).trim();
    const node = makeResponseNode({ contentPreview: longAnswer });
    const response = makeResponse({
      question: longQuestion,
      finalContent: longAnswer,
    });
    const preview = graphNodePreviewText(node, response);
    // Preview function returns full answer content; no substring truncation
    expect(preview).toBe(longAnswer);
    expect(response.question).toBe(longQuestion);
    expect(response.question.length).toBeGreaterThan(1000);
  });

  test("non-response node returns empty preview when contentPreview matches summary", () => {
    const node: LoomGraphProjectionNode = {
      id: "root-1",
      kind: "root",
      loomId: "loom-1",
      title: "Root loom",
      depth: 0,
      position: { x: 0, y: 0 },
      summary: "Same text",
      contentPreview: "Same text",
    };
    const preview = graphNodePreviewText(node, undefined);
    // Deduplication: if preview === summary, return empty so UI doesn't repeat
    expect(preview).toBe("");
  });

  test("CSS contract: response node question preview carries 10-line clamp", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".loom-graph-node--response .loom-graph-node-question-preview");
    expect(css).toMatch(
      /\.loom-graph-node--response\s+\.loom-graph-node-question-preview\s*\{[^}]*-webkit-line-clamp:\s*10/
    );
  });

  test("CSS contract: non-response node title clamped at 4 lines", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".loom-graph-node:not(.loom-graph-node--response) h3");
    expect(css).toMatch(
      /\.loom-graph-node:not\(\.loom-graph-node--response\)\s+h3\s*\{[^}]*-webkit-line-clamp:\s*4/
    );
  });

  test("CSS contract: graph node has max-height cap to prevent viewport explosion", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.loom-graph-node\s*\{[^}]*max-height:\s*500px/);
    expect(css).toMatch(/\.loom-graph-node\s*\{[^}]*overflow:\s*hidden/);
  });

  test("CSS contract: modal question uses CSS-variable-driven clamp for progressive disclosure", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".graph-response-preview-question-content > p.is-clamped");
    expect(css).toContain("--graph-preview-question-clamp-lines");
    expect(css).toMatch(/-webkit-line-clamp:\s*var\(--graph-preview-question-clamp-lines/);
  });

  test("CSS contract: assistant response answer section carries no line-clamp restriction", () => {
    const css = readFileSync("src/styles.css", "utf8");
    // Extract the answer block rule and confirm no webkit-line-clamp within it
    const answerRuleMatch = css.match(
      /\.graph-response-preview-answer\s*\{[^}]*}/g
    );
    expect(answerRuleMatch).not.toBeNull();
    for (const rule of answerRuleMatch ?? []) {
      expect(rule).not.toContain("line-clamp");
    }
  });
});
