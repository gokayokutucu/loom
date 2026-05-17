import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { responseGraphNodeId, type LoomGraphProjectionNode } from "../src/services/loomGraphProjection";
import {
  responseForGraphNode,
  responsePairIdsForGraphNode,
} from "../src/features/graph/graphResponsePairing";
import {
  graphNodePreviewText,
  graphResponsePreviewForNode,
} from "../src/features/graph/graphNodePreview";
import type { ResponseItem } from "../src/types";

function graphResponseNode(responseId: string): LoomGraphProjectionNode {
  return {
    id: responseGraphNodeId("loom-1", responseId),
    kind: "response",
    loomId: "loom-1",
    responseId,
    title: "Graph node",
    depth: 1,
    position: { x: 0, y: 0 },
  };
}

function response(id: string, serviceUserResponseId?: string): ResponseItem {
  return {
    id,
    serviceUserResponseId,
    title: "Paired answer",
    address: `loom://test/${id}`,
    question: "What does the graph node show?",
    answer: ["It shows the paired answer."],
    suggestedLinks: [],
    bookmarkedLinks: [],
  };
}

test.describe("graph response pairing", () => {
  test("matches nodes by UI response id", () => {
    const paired = response("assistant-1");

    expect(
      responseForGraphNode(graphResponseNode("assistant-1"), {
        "loom-1": [paired],
      })
    ).toBe(paired);
  });

  test("matches service user response nodes to the UI Q/A pair", () => {
    const paired = response("assistant-1", "service-user-1");

    expect(
      responseForGraphNode(graphResponseNode("service-user-1"), {
        "loom-1": [paired],
      })
    ).toBe(paired);
  });

  test("does not create fake Q/A pairs for Loom or Weft root nodes", () => {
    const rootNode: LoomGraphProjectionNode = {
      id: "loom:loom-1:root",
      kind: "root",
      loomId: "loom-1",
      title: "Root Loom",
      depth: 0,
      position: { x: 0, y: 0 },
    };

    expect(responseForGraphNode(rootNode, { "loom-1": [response("assistant-1")] })).toBeUndefined();
  });

  test("exposes all paired ids for action and terminal matching", () => {
    expect(Array.from(responsePairIdsForGraphNode(response("assistant-1", "service-user-1")))).toEqual([
      "assistant-1",
      "service-user-1",
    ]);
  });

  test("shows response preview text even when service preview is also mapped as summary", () => {
    const node = {
      ...graphResponseNode("assistant-1"),
      summary: "It shows the paired answer.",
      contentPreview: "It shows the paired answer.",
    };

    expect(graphNodePreviewText(node, response("assistant-1"))).toBe(
      "It shows the paired answer."
    );
  });

  test("falls back to paired response answer when response node preview is missing", () => {
    expect(graphNodePreviewText(graphResponseNode("assistant-1"), response("assistant-1"))).toBe(
      "It shows the paired answer."
    );
  });

  test("normalizes Markdown from paired response previews", () => {
    const paired = response("assistant-1");
    paired.finalContent = [
      "**AWS üzerinde Event Sourcing implementasyonu** için kullanılan araçlar: ###",
      "",
      "--- ###",
      "",
      "1. **Event Store Seçenekleri**",
    ].join("\n");

    const preview = graphNodePreviewText(graphResponseNode("assistant-1"), paired);

    expect(preview).toContain("AWS üzerinde Event Sourcing implementasyonu");
    expect(preview).toContain("Event Store Seçenekleri");
    expect(preview).not.toContain("**");
    expect(preview).not.toContain("###");
    expect(preview).not.toContain("---");
  });

  test("does not duplicate non-response preview when it matches summary", () => {
    const rootNode: LoomGraphProjectionNode = {
      id: "loom:loom-1:root",
      kind: "root",
      loomId: "loom-1",
      title: "Root Loom",
      summary: "Root summary",
      contentPreview: "Root summary",
      depth: 0,
      position: { x: 0, y: 0 },
    };

    expect(graphNodePreviewText(rootNode, undefined)).toBe("");
  });

  test("opens preview content from paired response data when available", () => {
    expect(graphResponsePreviewForNode(graphResponseNode("assistant-1"), response("assistant-1"))).toEqual({
      question: "What does the graph node show?",
      answerMarkdown: "It shows the paired answer.",
    });
  });

  test("opens preview content from service graph response preview when local pair is missing", () => {
    expect(
      graphResponsePreviewForNode(
        {
          ...graphResponseNode("service-only-response"),
          title: "Service-only response",
          contentPreview:
            "Question: How should MCP failures appear? MCP failures should be typed and recoverable.",
        },
        undefined
      )
    ).toEqual({
      question: "How should MCP failures appear?",
      answerMarkdown: "MCP failures should be typed and recoverable.",
    });
  });

  test("does not create preview modal content for Loom or Weft root nodes", () => {
    const weftNode: LoomGraphProjectionNode = {
      id: "loom:weft-1",
      kind: "weft",
      loomId: "weft-1",
      title: "Weft root",
      contentPreview: "Branched from a Response.",
      depth: 1,
      position: { x: 0, y: 0 },
    };

    expect(graphResponsePreviewForNode(weftNode, undefined)).toBeNull();
  });

  test("keeps graph preview labels in English", () => {
    const source = readFileSync("src/features/graph/GraphView.tsx", "utf8");

    expect(source).toContain("<span>Question</span>");
    expect(source).toContain("<span>Answer</span>");
    expect(source).not.toContain("<span>Soru</span>");
    expect(source).not.toContain("<span>Cevap</span>");
  });

  test("scopes the graph preview overlay to the graph surface", () => {
    const source = readFileSync("src/features/graph/GraphView.tsx", "utf8");
    const styles = readFileSync("src/styles.css", "utf8");

    expect(source.indexOf('className="loom-graph-shell"')).toBeLessThan(
      source.indexOf('className="graph-response-preview-backdrop"')
    );
    expect(styles).toContain(".graph-response-preview-backdrop");
    expect(styles).toContain("position: absolute");
    expect(styles).not.toContain("position: fixed;\n  inset: 0;\n  z-index: 80;");
  });

  test("graph Link action opens the node continuation composer before adding the reference", () => {
    const graphSource = readFileSync("src/features/graph/GraphView.tsx", "utf8");
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(graphSource).toContain("openContinuationForResponse(node, nodeResponse);");
    expect(graphSource).toContain("onLinkResponse(node.loomId, nodeResponse);");
    expect(appSource).toContain("appendInlineReferenceTokenHtml(");
    expect(appSource).toContain("responseLinkForNavigation(loomId, response),\n                      loomId");
    expect(appSource).not.toContain("responseLinkForNavigation(loomId, response),\n                      activeDraftKey");
  });
});
