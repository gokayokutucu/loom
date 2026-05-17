// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service Graph proof.
// - LEGACY_TYPESCRIPT_LOCAL for the projection helper layout tests below.
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  buildLoomGraphProjection,
  loomGraphRootNodeId,
  responseGraphNodeId,
} from "../src/services/loomGraphProjection";
import { createTypeScriptLocalLoomEngine } from "../src/engine";
import type { Conversation, LoomForkRecord, LoomLink, ResponseItem } from "../src/types";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

interface ServiceGraphNode {
  id: string;
  kind: string;
  loomId: string;
  responseId?: string;
  title: string;
  metadata?: unknown;
}

interface ServiceGraphEdge {
  id: string;
  kind: string;
  source: string;
  target: string;
  label?: string;
  metadata?: unknown;
}

interface ServiceGraphProjection {
  loomId: string;
  nodes: ServiceGraphNode[];
  edges: ServiceGraphEdge[];
  warnings: string[];
}

function loom(id: string, title: string): Conversation {
  return {
    id,
    title,
    path: `loom://test/${id}`,
    folder: "Test",
    summary: `${title} summary`,
  };
}

function response(id: string, question: string): ResponseItem {
  return {
    id,
    title: question,
    address: `loom://test/${id}`,
    question,
    answer: [`Answer for ${question}`],
    suggestedLinks: [],
    bookmarkedLinks: [],
  };
}

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

function expectNoForbiddenGraphPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("raw_thinking");
  expect(serialized).not.toContain("thinking_text");
  expect(serialized).not.toContain("chain_of_thought");
  expect(serialized).not.toContain("hidden_reasoning");
}

function expectCleanGraphLabels(graph: ServiceGraphProjection) {
  for (const node of graph.nodes) {
    expect(node.title).not.toContain("[[");
    expect(node.title).not.toContain("]]");
    expect(node.title).not.toContain("Group 1");
    expect(node.title).not.toContain("Group 2");
  }
  for (const edge of graph.edges) {
    expect(edge.label ?? "").not.toContain("[[");
    expect(edge.label ?? "").not.toContain("]]");
    expect(edge.label ?? "").not.toContain("Group 1");
    expect(edge.label ?? "").not.toContain("Group 2");
  }
}

test.describe("[product-service-backed] Graph projection product proof", () => {
  test("[product-service-backed] renders service-created Loom graph data with Weft, Reference, and Bookmark coverage", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(
        page,
        "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat"
      );
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });

      const looms = await scenario.client.listLooms();
      const rootLoom = looms.find((item) => item.title.includes("Event Sourcing"));
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;

      await scenario.sendPrompt(
        loomId,
        "Avantajları ve dezavantajları tablo şeklinde verebilir misin?"
      );
      await scenario.sendPrompt(loomId, "Dezavantajları ve avantajları biraz daha açar mısın");
      await scenario.runPendingContextJobs();

      const detail = await scenario.client.getLoom(loomId);
      expect(detail.responses.length).toBeGreaterThanOrEqual(4);
      const originResponse = detail.responses[1];
      const latestResponse = detail.responses[detail.responses.length - 1];
      expect(originResponse).toBeTruthy();
      expect(latestResponse).toBeTruthy();

      const weft = await scenario.client.createOrOpenWeft({
        originLoomId: loomId,
        originResponseId: originResponse!.id,
        title: "Event Sourcing implementation Weft",
        summary: "Service-created Weft for Graph E2E proof",
        source: "graph_node",
        seedMode: "none",
        createOriginContextSnapshot: true,
      });

      const reference: LoomLink = {
        id: originResponse!.id,
        type: "response",
        title: "Event Store reference",
        path: originResponse!.address || originResponse!.id,
        badge: "Response",
        targetObjectId: originResponse!.id,
        sourceLoomId: loomId,
        sourceResponseId: latestResponse.id,
        canonicalUri: originResponse!.meta?.canonicalUri ?? originResponse!.address,
        referenceMentionId: "graph-service-reference",
      };
      await scenario.client.addReference({
        loomId,
        sourceResponseId: latestResponse.id,
        reference,
      });
      await scenario.client.createBookmark({
        targetKind: "response",
        targetId: originResponse!.id,
        targetUri: originResponse!.meta?.canonicalUri ?? originResponse!.address,
        title: "Bookmarked Event Sourcing answer",
        metadata: { loomId },
      });

      const graph = await scenario.fetchJson<ServiceGraphProjection>(
        `/looms/${encodeURIComponent(loomId)}/graph?includeReferences=true&includeBookmarks=true`
      );
      expect(graph.loomId).toBe(loomId);
      expect(graph.nodes.some((node) => node.id === `loom:${loomId}` && node.kind === "loom")).toBe(
        true
      );
      expect(
        graph.nodes.filter((node) => node.kind === "response").map((node) => node.responseId)
      ).toEqual(expect.arrayContaining(detail.responses.map((response) => response.id)));
      expect(graph.edges.some((edge) => edge.kind === "loom_response")).toBe(true);
      expect(graph.edges.filter((edge) => edge.kind === "response_sequence").length).toBeGreaterThan(
        1
      );
      expect(graph.nodes.some((node) => node.id === `loom:${weft.loomId}` && node.kind === "weft"))
        .toBe(true);
      expect(
        graph.edges.some(
          (edge) =>
            edge.kind === "weft_origin" &&
            edge.source === `response:${originResponse!.id}` &&
            edge.target === `loom:${weft.loomId}`
        )
      ).toBe(true);
      expect(graph.edges.some((edge) => edge.kind === "reference")).toBe(true);
      const bookmarkedNode = graph.nodes.find((node) => node.id === `response:${originResponse!.id}`);
      expect(JSON.stringify(bookmarkedNode?.metadata ?? {})).toContain("\"bookmarked\":true");
      expectCleanGraphLabels(graph);
      expectNoForbiddenGraphPayload(graph);

      await page.getByRole("button", { name: "Toggle Graph View" }).click();
      await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();
      await expect(page.locator(".loom-graph-shell")).toBeVisible();
      await expect(page.locator(".loom-graph-node--response").first()).toBeVisible();
      await expect(page.locator(".loom-graph-node--response")).toHaveCount(
        graph.nodes.filter((node) => node.kind === "response").length
      );
      await expect(page.locator(".loom-graph-node--weft").filter({ hasText: "Event Sourcing" }))
        .toBeVisible();
      await expect(page.locator(".loom-graph-shell")).not.toContainText("[[");
      await expect(page.locator(".loom-graph-shell")).not.toContainText("Group 1");
      await expect(page.locator(".loom-graph-shell")).not.toContainText("raw_thinking");

      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});

test.describe("[legacy-typescript-local] Loom graph projection hierarchy", () => {
  test("projects graph through the Loom Engine boundary", async () => {
    const engine = createTypeScriptLocalLoomEngine();
    const projection = await engine.getGraphProjection({
      conversations: [loom("root", "Root Loom")],
      responsesByConversation: {
        root: [response("r1", "First question")],
      },
      forkRecords: [],
      activeLoomId: "root",
      bookmarkedResponseAddresses: [],
    });

    expect(projection.nodes.map((node) => node.id)).toContain(loomGraphRootNodeId("root"));
    expect(projection.nodes.map((node) => node.id)).toContain(responseGraphNodeId("root", "r1"));
    expect(projection.edges).toHaveLength(1);
  });

  test("keeps root top-most and same-lineage responses ordered downward", () => {
    const projection = buildLoomGraphProjection({
      conversations: [loom("root", "Root Loom")],
      responsesByConversation: {
        root: [
          response("r1", "First question"),
          response("r2", "Second question"),
          response("r3", "Third question"),
        ],
      },
      forkRecords: [],
      activeLoomId: "root",
      expandedNodeIds: new Set([responseGraphNodeId("root", "r1")]),
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const root = projection.nodes.find((node) => node.id === loomGraphRootNodeId("root"));
    const first = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r1"));
    const second = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r2"));
    const third = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r3"));

    expect(root?.position.y).toBe(0);
    expect(first?.position.y).toBeGreaterThan(root?.position.y ?? -1);
    expect(second?.position.y).toBeGreaterThan(first?.position.y ?? -1);
    expect(third?.position.y).toBeGreaterThan(second?.position.y ?? -1);
  });

  test("normalizes Markdown in graph root and response preview labels", () => {
    const projection = buildLoomGraphProjection({
      conversations: [
        {
          ...loom("root", "Loom: **AWS üzerinde Event Sourcing implementasyonu**"),
          summary: "Temporary Flow from **event sourcing**. ###",
        },
      ],
      responsesByConversation: {
        root: [
          {
            ...response("r1", "**AWS üzerinde nasıl implementasyon** yapıyoruz?"),
            title: "**AWS üzerinde nasıl implementasyon** yapıyoruz",
            answer: [
              "**AWS üzerinde Event Sourcing implementasyonu** için kullanılan araçlar: ###",
              "--- ###",
              "1. **Event Store Seçenekleri**",
            ],
          },
        ],
      },
      forkRecords: [],
      activeLoomId: "root",
      expandedNodeIds: new Set([responseGraphNodeId("root", "r1")]),
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const root = projection.nodes.find((node) => node.id === loomGraphRootNodeId("root"));
    const responseNode = projection.nodes.find((node) =>
      node.id === responseGraphNodeId("root", "r1")
    );

    expect(root?.title).toBe("Loom: AWS üzerinde Event Sourcing implementasyonu");
    expect(root?.summary).toBe("Temporary Flow from event sourcing.");
    expect(responseNode?.title).toBe("AWS üzerinde nasıl implementasyon yapıyoruz");
    expect(responseNode?.contentPreview).toContain("AWS üzerinde Event Sourcing implementasyonu");
    expect(responseNode?.contentPreview).toContain("Event Store Seçenekleri");
    expect(`${root?.title} ${root?.summary} ${responseNode?.title} ${responseNode?.contentPreview}`)
      .not.toContain("**");
    expect(responseNode?.contentPreview).not.toContain("###");
  });

  test("anchors Weft branches at the origin response and continues downward", () => {
    const forkRecords: LoomForkRecord[] = [
      {
        id: "fork-root-child",
        parentConversationId: "root",
        parentResponseId: "r1",
        childConversationId: "child",
        title: "Child Weft",
      },
    ];
    const projection = buildLoomGraphProjection({
      conversations: [loom("root", "Root Loom"), loom("child", "Child Weft")],
      responsesByConversation: {
        root: [response("r1", "Origin question"), response("r2", "Continuation")],
        child: [response("c1", "Branch question")],
      },
      forkRecords,
      activeLoomId: "root",
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const origin = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r1"));
    const childRoot = projection.nodes.find((node) => node.id === loomGraphRootNodeId("child"));
    const childResponse = projection.nodes.find((node) =>
      node.id === responseGraphNodeId("child", "c1")
    );
    const branchEdge = projection.edges.find(
      (edge) =>
        edge.source === responseGraphNodeId("root", "r1") &&
        edge.target === loomGraphRootNodeId("child")
    );

    expect(branchEdge?.kind).toBe("weft");
    expect(childRoot?.position.y).toBeGreaterThan(origin?.position.y ?? -1);
    expect(childRoot?.position.x).not.toBe(origin?.position.x);
    expect(childResponse?.position.y).toBeGreaterThan(childRoot?.position.y ?? -1);
    projection.edges.forEach((edge) => {
      const source = projection.nodes.find((node) => node.id === edge.source);
      const target = projection.nodes.find((node) => node.id === edge.target);
      expect(target?.position.y).toBeGreaterThan(source?.position.y ?? -1);
    });
  });

  test("places Weft branches as a balanced downward tree around their origin", () => {
    const forkRecords: LoomForkRecord[] = [
      {
        id: "fork-root-left",
        parentConversationId: "root",
        parentResponseId: "r1",
        childConversationId: "left",
        title: "Left Weft",
      },
      {
        id: "fork-root-right",
        parentConversationId: "root",
        parentResponseId: "r2",
        childConversationId: "right",
        title: "Right Weft",
      },
      {
        id: "fork-left-child",
        parentConversationId: "left",
        parentResponseId: "l1",
        childConversationId: "left-child",
        title: "Nested Weft",
      },
    ];
    const projection = buildLoomGraphProjection({
      conversations: [
        loom("root", "Root Loom"),
        loom("left", "Left Weft"),
        loom("right", "Right Weft"),
        loom("left-child", "Nested Weft"),
      ],
      responsesByConversation: {
        root: [
          response("r1", "First origin"),
          response("r2", "Second origin"),
          response("r3", "Trunk continuation"),
        ],
        left: [response("l1", "Left branch response")],
        right: [response("rr1", "Right branch response")],
        "left-child": [response("lc1", "Nested branch response")],
      },
      forkRecords,
      activeLoomId: "root",
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const rootFirst = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r1"));
    const rootSecond = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r2"));
    const leftRoot = projection.nodes.find((node) => node.id === loomGraphRootNodeId("left"));
    const rightRoot = projection.nodes.find((node) => node.id === loomGraphRootNodeId("right"));
    const nestedRoot = projection.nodes.find((node) => node.id === loomGraphRootNodeId("left-child"));

    expect(leftRoot?.position.x).toBeLessThan(rootFirst?.position.x ?? 0);
    expect(rightRoot?.position.x).toBeGreaterThan(rootSecond?.position.x ?? 0);
    expect(nestedRoot?.position.x).toBeLessThan(leftRoot?.position.x ?? 0);
    expect(leftRoot?.position.y).toBeGreaterThan(rootFirst?.position.y ?? -1);
    expect(rightRoot?.position.y).toBeGreaterThan(rootSecond?.position.y ?? -1);
    expect(nestedRoot?.position.y).toBeGreaterThan(leftRoot?.position.y ?? -1);
  });

  test("moves later branches to an open lane when a lane-depth slot is occupied", () => {
    const forkRecords: LoomForkRecord[] = [
      {
        id: "fork-root-first",
        parentConversationId: "root",
        parentResponseId: "r1",
        childConversationId: "first-branch",
        title: "First branch",
      },
      {
        id: "fork-root-later",
        parentConversationId: "root",
        parentResponseId: "r3",
        childConversationId: "later-branch",
        title: "Later branch",
      },
    ];
    const projection = buildLoomGraphProjection({
      conversations: [
        loom("root", "Root Loom"),
        loom("first-branch", "First branch"),
        loom("later-branch", "Later branch"),
      ],
      responsesByConversation: {
        root: [
          response("r1", "First origin"),
          response("r2", "Middle continuation"),
          response("r3", "Later origin"),
          response("r4", "Final continuation"),
        ],
        "first-branch": [
          response("fb1", "First branch response"),
          response("fb2", "Question labels need their own surface"),
        ],
        "later-branch": [response("lb1", "Graph continuation composer behavior")],
      },
      forkRecords,
      activeLoomId: "root",
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const firstBranchSecond = projection.nodes.find((node) =>
      node.id === responseGraphNodeId("first-branch", "fb2")
    );
    const laterBranchRoot = projection.nodes.find((node) =>
      node.id === loomGraphRootNodeId("later-branch")
    );
    const occupiedPositions = new Set<string>();

    projection.nodes.forEach((node) => {
      const key = `${node.position.x}:${node.position.y}`;
      expect(occupiedPositions.has(key)).toBe(false);
      occupiedPositions.add(key);
    });
    expect(laterBranchRoot?.position.y).toBe(firstBranchSecond?.position.y);
    expect(laterBranchRoot?.position.x).not.toBe(firstBranchSecond?.position.x);
  });

  test("configures readable default zoom and hides React Flow attribution by prop", () => {
    const graphViewSource = readFileSync("src/features/graph/GraphView.tsx", "utf8");

    expect(graphViewSource).toContain("const GRAPH_DEFAULT_ZOOM = 1.08");
    expect(graphViewSource).toContain("defaultViewport={{ x: 0, y: 0, zoom: GRAPH_DEFAULT_ZOOM }}");
    expect(graphViewSource).toContain("proOptions={{ hideAttribution: true }}");
  });
});
