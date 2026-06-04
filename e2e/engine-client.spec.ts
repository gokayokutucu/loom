// E2E data authority classification: PURE_ENGINE_CONTRACT.
// This spec uses mocked clients/fetch responses to verify engine boundary mapping, not product data proof.
import { test, expect } from "@playwright/test";
import {
  createLoomEngineClient,
  type LoomEngineClient,
  RustHttpLoomEngineClient,
  RustHttpLoomEngineError,
  sanitizeEngineResponseEvent,
  TypeScriptLocalLoomEngine,
} from "../src/engine";
import type { LoomGraphProjection } from "../src/services/loomGraphProjection";
import type {
  BookmarkItem,
  LoomGraphRepository,
  LoomLink,
  LoomNavigationDestination,
  LoomResolvedObject,
  LoomWindowType,
} from "../src/types";

function unsupportedMockMethod(method: string): never {
  throw new Error(`mock ${method} not implemented`);
}

function createMockRustClient(
  resolveAddress: LoomEngineClient["resolveAddress"],
  getGraphProjection?: LoomEngineClient["getGraphProjection"],
  exportLoom?: LoomEngineClient["exportLoom"],
  exportResponse?: LoomEngineClient["exportResponse"]
): LoomEngineClient {
  return {
    getHealth: async () => ({ status: "ready", runtime: "rust-sidecar" }),
    getServiceHealth: async () => ({ status: "ready", runtime: "rust-service" }),
    getServiceConfigStatus: async () => ({ status: "ready" }),
    getServiceConfig: async () => unsupportedMockMethod("getServiceConfig"),
    updateServiceConfig: async () => unsupportedMockMethod("updateServiceConfig"),
    getRuntimeModels: async () => unsupportedMockMethod("getRuntimeModels"),
    startModelDownload: async () => unsupportedMockMethod("startModelDownload"),
    getModelDownload: async () => unsupportedMockMethod("getModelDownload"),
    cancelModelDownload: async () => unsupportedMockMethod("cancelModelDownload"),
    getCapabilitySummary: async () => ({ status: "unknown", strategyAvailable: false }),
    resolveAddress,
    getGraphProjection:
      getGraphProjection ??
      (async (): Promise<LoomGraphProjection> => unsupportedMockMethod("getGraphProjection")),
    listLooms: async () => unsupportedMockMethod("listLooms"),
    getLoom: async () => unsupportedMockMethod("getLoom"),
    createLoom: async () => unsupportedMockMethod("createLoom"),
    renameLoom: async () => unsupportedMockMethod("renameLoom"),
    updateLoomMetadata: async () => unsupportedMockMethod("updateLoomMetadata"),
    sendMessage: () => unsupportedMockMethod("sendMessage"),
    regenerateFromResponse: () => unsupportedMockMethod("regenerateFromResponse"),
    retryUserMessage: () => unsupportedMockMethod("retryUserMessage"),
    cancelMessage: async () => unsupportedMockMethod("cancelMessage"),
    quickAsk: async () => unsupportedMockMethod("quickAsk"),
    createOrOpenWeft: async () => unsupportedMockMethod("createOrOpenWeft"),
    persistWeftTurns: async () => unsupportedMockMethod("persistWeftTurns"),
    updateResponse: async () => unsupportedMockMethod("updateResponse"),
    addReference: async () => unsupportedMockMethod("addReference"),
    removeReference: async () => unsupportedMockMethod("removeReference"),
    getReference: async () => unsupportedMockMethod("getReference"),
    listReferences: async () => unsupportedMockMethod("listReferences"),
    listCodeSnippets: async () => unsupportedMockMethod("listCodeSnippets"),
    suggestReferences: async () => unsupportedMockMethod("suggestReferences"),
    openReference: async (): Promise<LoomNavigationDestination> =>
      unsupportedMockMethod("openReference"),
    createBookmark: async (): Promise<{ bookmark: BookmarkItem }> =>
      unsupportedMockMethod("createBookmark"),
    deleteBookmark: async () => unsupportedMockMethod("deleteBookmark"),
    getBookmark: async (): Promise<{ bookmark: BookmarkItem }> =>
      unsupportedMockMethod("getBookmark"),
    listBookmarks: async () => unsupportedMockMethod("listBookmarks"),
    getBookmarkForTarget: async (): Promise<{ bookmark: BookmarkItem }> =>
      unsupportedMockMethod("getBookmarkForTarget"),
    bookmarkResponse: async (): Promise<{ bookmark: BookmarkItem }> =>
      unsupportedMockMethod("bookmarkResponse"),
    exportLoom: exportLoom ?? (async () => unsupportedMockMethod("exportLoom")),
    exportResponse: exportResponse ?? (async () => unsupportedMockMethod("exportResponse")),
  };
}

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const body = events
    .map((event) => `event: message\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const graphConversation = {
  id: "L-1",
  title: "Local Graph Loom",
  path: "Product Systems / Local Graph Loom",
  folder: "Product Systems",
  summary: "Local graph summary",
};

const graphResponse = {
  id: "R-1",
  title: "Local response",
  address: "R-1",
  question: "Local question",
  answer: ["Local answer"],
  createdAt: "2026-05-10T00:00:00Z",
  suggestedLinks: [],
  bookmarkedLinks: [],
};

function graphProjectionInput() {
  return {
    conversations: [graphConversation],
    responsesByConversation: { "L-1": [graphResponse] },
    forkRecords: [],
    activeLoomId: "L-1",
    focusedResponseId: "R-1",
  };
}

function createGraphRepositoryStub(object?: LoomResolvedObject): LoomGraphRepository {
  return {
    findByObjectId: (objectId) => (object?.objectId === objectId ? object : undefined),
    findByCanonicalUri: (uri) => (object?.canonicalUri === uri ? object : undefined),
    findByAliasUri: (uri) => (object?.aliasUri === uri ? object : undefined),
    resolveAliasUri: () => undefined,
    findPrimaryAlias: () => undefined,
    findBookmarkByTargetObjectId: () => undefined,
    findBookmarkByUri: () => undefined,
    findRevision: () => true,
    findSnapshot: () => true,
    supportsWindow: (_objectId: string, _windowType: LoomWindowType) => true,
    getLineage: () => [],
    getDescendants: () => [],
    getReferenceNeighborhood: () => [],
    getWindowProjection: () => undefined,
  };
}

test.describe("[engine-contract] Loom engine client selection", () => {
  test("[engine-contract] defaults to the Rust service engine", () => {
    const engine = createLoomEngineClient();
    expect(engine).toBeInstanceOf(RustHttpLoomEngineClient);
  });

  test("[legacy-typescript-local] TypeScript local engine remains explicit legacy/test mode", () => {
    const engine = createLoomEngineClient({ mode: "typescript-local" });
    expect(engine).toBeInstanceOf(TypeScriptLocalLoomEngine);
  });

  test("[legacy-typescript-local] TypeScript local engine returns safe read-only service status", async () => {
    const engine = createLoomEngineClient({ mode: "typescript-local" });
    await expect(engine.getServiceHealth()).resolves.toMatchObject({
      status: "ready",
      runtime: "typescript-local",
    });
    await expect(engine.getCapabilitySummary()).resolves.toMatchObject({
      status: "unknown",
      strategyAvailable: false,
    });
  });

  test("rust-service mode returns explicit unsupported for unmigrated graph input", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      localDependencies: {},
    });
    await expect(engine.getGraphProjection({
      conversations: [],
      responsesByConversation: {},
      forkRecords: [],
    })).rejects.toMatchObject({
      kind: "unsupported_method",
    });
  });

  test("Rust HTTP client maps service graph projection responses", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe(
          "http://127.0.0.1:17633/looms/L-1/graph?focusedResponseId=R-1&includeBookmarks=true"
        );
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            loomId: "L-1",
            nodes: [
              {
                id: "loom:L-1",
                kind: "loom",
                loomId: "L-1",
                title: "Service Loom",
                preview: "Service summary",
                displayCode: "L-SVC01",
                depth: 0,
                lane: 0,
                position: { x: 0, y: 0 },
              },
              {
                id: "response:R-1",
                kind: "response",
                loomId: "L-1",
                responseId: "R-1",
                title: "Service Response",
                preview: "Service answer",
                displayCode: "R-SVC01",
                canonicalUri: "loom://L-1/responses/R-1",
                metadata: {
                  bookmark: {
                    bookmarked: true,
                    bookmarkId: "bookmark-1",
                  },
                },
                raw_thinking: "hidden",
                depth: 1,
                lane: 0,
                position: { x: 0, y: 180 },
              },
            ],
            edges: [
              {
                id: "edge:loom:L-1:response:R-1",
                kind: "loom_response",
                source: "loom:L-1",
                target: "response:R-1",
              },
            ],
            focusedNodeId: "response:R-1",
            warnings: ["ok"],
          }),
          { status: 200 }
        );
      },
    });

    const projection = await client.getGraphProjection(graphProjectionInput());
    expect(projection.nodes.map((node) => node.id)).toEqual([
      "loom:L-1:root",
      "loom:L-1:response:R-1",
    ]);
    expect(projection.nodes[0].kind).toBe("root");
    expect(projection.nodes[0].displayCode).toBe("L-SVC01");
    expect(projection.nodes[1]).toMatchObject({
      kind: "response",
      responseId: "R-1",
      title: "Service Response",
      contentPreview: "Service answer",
      displayCode: "R-SVC01",
      canonicalUri: "loom://L-1/responses/R-1",
      isFocused: true,
      isBookmarked: true,
    });
    expect(projection.edges[0]).toMatchObject({
      source: "loom:L-1:root",
      target: "loom:L-1:response:R-1",
      kind: "question",
    });
    expect(projection.focusedNodeId).toBe("loom:L-1:response:R-1");
    expect(projection.serviceGraphStatus).toBe("resolved");
    expect(JSON.stringify(projection)).not.toContain("raw_thinking");
  });

  test("Rust HTTP client preserves Loom and Weft graph node categories with graph roles", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe(
          "http://127.0.0.1:17633/looms/W-1/graph?includeBookmarks=true"
        );
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            loomId: "W-1",
            nodes: [
              {
                id: "loom:origin",
                kind: "loom",
                loomId: "origin",
                title: "Origin Loom",
                displayCode: "L-ORIGIN",
                metadata: { graphRole: "origin-context" },
                depth: 0,
                lane: 0,
                position: { x: 0, y: 0 },
              },
              {
                id: "response:R-origin",
                kind: "response",
                loomId: "origin",
                responseId: "R-origin",
                title: "Origin Response",
                displayCode: "R-ORIGIN",
                metadata: { graphRole: "origin-response" },
                depth: 1,
                lane: 0,
                position: { x: 0, y: 180 },
              },
              {
                id: "loom:W-1",
                kind: "weft",
                loomId: "W-1",
                title: "Current Weft",
                displayCode: "W-CURRENT",
                metadata: { graphRole: "current-root" },
                depth: 2,
                lane: 0,
                position: { x: 0, y: 360 },
              },
            ],
            edges: [
              {
                id: "edge:loom:origin:response:R-origin",
                kind: "loom_response_origin",
                source: "loom:origin",
                target: "response:R-origin",
              },
              {
                id: "edge:response:R-origin:loom:W-1",
                kind: "weft_origin",
                source: "response:R-origin",
                target: "loom:W-1",
              },
            ],
            warnings: [],
          }),
          { status: 200 }
        );
      },
    });

    const projection = await client.getGraphProjection({
      ...graphProjectionInput(),
      activeLoomId: "W-1",
      focusedResponseId: undefined,
    });

    const originLoom = projection.nodes.find((node) => node.loomId === "origin" && !node.responseId);
    const originResponse = projection.nodes.find((node) => node.responseId === "R-origin");
    const currentWeft = projection.nodes.find((node) => node.loomId === "W-1" && !node.responseId);

    expect(originLoom).toMatchObject({ kind: "loom", graphRole: "origin-context" });
    expect(originResponse).toMatchObject({ kind: "response", graphRole: "origin-response" });
    expect(currentWeft).toMatchObject({ kind: "weft", graphRole: "current-root" });
    expect(projection.edges[0]).toMatchObject({ kind: "question" });
    expect(projection.edges[1]).toMatchObject({ kind: "weft" });
  });

  test("Rust HTTP client maps one-step Loom ancestry without collapsing categories", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe(
          "http://127.0.0.1:17633/looms/W-2/ancestry-step"
        );
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            loomId: "W-2",
            hasParentAncestry: true,
            parentLoom: {
              loomId: "L-1",
              title: "Parent Loom",
              summary: "Parent summary",
              canonicalUri: "loom://parent",
              displayCode: "L-PARENT",
              kind: "loom",
              hasParentAncestry: false,
            },
            parentOriginResponse: {
              responseId: "R-1",
              loomId: "L-1",
              title: "Parent Response",
              preview: "Parent answer",
              canonicalUri: "loom://parent/r/R-1",
              displayCode: "R-PARENT",
            },
            warnings: [],
          }),
          { status: 200 }
        );
      },
    });

    const step = await client.getLoomAncestryStep({ loomId: "W-2" });

    expect(step.parentLoom).toMatchObject({
      loomId: "L-1",
      kind: "loom",
      hasParentAncestry: false,
    });
    expect(step.parentOriginResponse).toMatchObject({
      loomId: "L-1",
      responseId: "R-1",
      title: "Parent Response",
    });
  });

  test("Rust HTTP client parses health responses", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async () =>
        new Response(
          JSON.stringify({
            status: "ready",
            runtime: "loom-service",
            version: "0.1.0",
            localOnly: true,
          }),
          { status: 200 }
        ),
    });
    await expect(client.getHealth()).resolves.toMatchObject({
      status: "ready",
      runtime: "rust-sidecar",
      version: "0.1.0",
    });
  });

  test("Rust HTTP client returns unavailable health when service cannot be reached", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async () => {
        throw new TypeError("connection refused");
      },
    });
    await expect(client.getHealth()).resolves.toMatchObject({
      status: "unavailable",
      runtime: "rust-sidecar",
    });
  });

  test("Rust HTTP client resolves addresses through service /resolve", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/resolve");
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ address: "loom://o/response/R-1" }));
        return new Response(
          JSON.stringify({
            status: "resolved",
            canonicalUri: "loom://o/response/R-1",
            objectKind: "response",
            objectId: "R-1",
            destination: {
              loomId: "L-1",
              mode: "full",
              scrollTargetResponseId: "R-1",
              scrollMode: "exact",
              source: "addressBar",
              raw_thinking: "hidden",
            },
            error: null,
          }),
          { status: 200 }
        );
      },
    });

    const result = await client.resolveAddress({ address: "loom://o/response/R-1" });
    expect(result.status).toBe("resolved");
    expect(result.canonicalUri).toBe("loom://o/response/R-1");
    expect(result.object?.kind).toBe("response");
    expect(result.destination).toMatchObject({
      loomId: "L-1",
      mode: "full",
      scrollTargetResponseId: "R-1",
      scrollMode: "exact",
    });
    expect(JSON.stringify(result)).not.toContain("raw_thinking");
  });

  test("Rust HTTP client preserves alias_resolved address results", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async () =>
        new Response(
          JSON.stringify({
            status: "alias_resolved",
            canonicalUri: "loom://o/loom/L-1",
            objectKind: "loom",
            objectId: "L-1",
            destination: { loomId: "L-1", mode: "full", source: "addressBar" },
            error: null,
          }),
          { status: 200 }
        ),
    });

    const result = await client.resolveAddress({ address: "loom://old-title" });
    expect(result.status).toBe("alias_resolved");
    expect(result.aliasUri).toBe("loom://old-title");
    expect(result.canonicalUri).toBe("loom://o/loom/L-1");
    expect(result.destination?.loomId).toBe("L-1");
  });

  test("Rust HTTP client preserves missing deleted and invalid service results", async () => {
    const statuses = ["missing", "deleted", "invalid"] as const;
    for (const status of statuses) {
      const client = new RustHttpLoomEngineClient({
        serviceUrl: "http://127.0.0.1:17633",
        fetch: async () =>
          new Response(
            JSON.stringify({
              status,
              canonicalUri: status === "invalid" ? null : "loom://o/loom/L-1",
              objectKind: status === "invalid" ? null : "loom",
              objectId: status === "invalid" ? null : "L-1",
              destination: null,
              error: `${status} address`,
            }),
            { status: 200 }
          ),
      });

      const result = await client.resolveAddress({ address: "loom://o/loom/L-1" });
      expect(result.status).toBe(status);
      expect(result.reason).toBe(`${status} address`);
    }
  });

  test("rust-service address resolution does not fall back when service is unavailable", async () => {
    const localObject: LoomResolvedObject = {
      objectId: "L-1",
      kind: "conversation",
      status: "active",
      title: "Fallback Loom",
      canonicalUri: "loom://o/conversation/L-1",
    };
    const engine = createLoomEngineClient({
      mode: "rust-service",
      serviceUrl: "http://127.0.0.1:9",
      localDependencies: {
        graphRepository: createGraphRepositoryStub(localObject),
      },
    });

    await expect(engine.resolveAddress({ address: "loom://o/conversation/L-1" })).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("rust-service missing address is final and does not fall back", async () => {
    const localObject: LoomResolvedObject = {
      objectId: "L-1",
      kind: "conversation",
      status: "active",
      title: "Local fallback Loom",
      canonicalUri: "loom://o/conversation/L-1",
    };
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: createMockRustClient(async (input) => ({
        status: "missing",
        parsed: { raw: input.address, kind: "alias", aliasUri: input.address, selector: {} },
        canonicalUri: input.address,
        reason: "No address record exists for this URI",
      })),
      localDependencies: {
        graphRepository: createGraphRepositoryStub(localObject),
      },
    });

    const result = await engine.resolveAddress({ address: "loom://o/conversation/L-1" });
    expect(result.status).toBe("missing");
    expect(result.object).toBeUndefined();
    expect(result.fallbackReason).toBeUndefined();
  });

  test("rust-service ignores local address fallback even when legacy strict flag is omitted", async () => {
    const localObject: LoomResolvedObject = {
      objectId: "L-1",
      kind: "conversation",
      status: "active",
      title: "Local fallback Loom",
      canonicalUri: "loom://o/conversation/L-1",
    };
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient: createMockRustClient(async (input) => ({
        status: "missing",
        parsed: { raw: input.address, kind: "alias", aliasUri: input.address, selector: {} },
        canonicalUri: input.address,
        reason: "No address record exists for this URI",
      })),
      localDependencies: {
        graphRepository: createGraphRepositoryStub(localObject),
      },
    });

    const result = await engine.resolveAddress({ address: "loom://o/conversation/L-1" });
    expect(result.status).toBe("missing");
    expect(result.fallbackReason).toBeUndefined();
  });

  test("rust-service missing is final when service address store is authoritative", async () => {
    const localObject: LoomResolvedObject = {
      objectId: "L-1",
      kind: "conversation",
      status: "active",
      title: "Local fallback Loom",
      canonicalUri: "loom://o/conversation/L-1",
    };
    const engine = createLoomEngineClient({
      mode: "rust-service",
      serviceAddressStoreAuthoritative: true,
      rustClient: createMockRustClient(async (input) => ({
        status: "missing",
        parsed: { raw: input.address, kind: "alias", aliasUri: input.address, selector: {} },
        canonicalUri: input.address,
        reason: "No address record exists for this URI",
      })),
      localDependencies: {
        graphRepository: createGraphRepositoryStub(localObject),
      },
    });

    const result = await engine.resolveAddress({ address: "loom://o/conversation/L-1" });
    expect(result.status).toBe("missing");
    expect(result.fallbackReason).toBeUndefined();
    expect(result.serviceResolutionStatus).toBeUndefined();
    expect(result.serviceAddressStoreAuthoritative).toBeUndefined();
  });

  test("strict authoritative rust-service address succeeds for seeded response without fallback", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      serviceAddressStoreAuthoritative: true,
      rustClient: createMockRustClient(async (input) => ({
        status: "resolved",
        parsed: { raw: input.address, kind: "alias", aliasUri: input.address, selector: {} },
        canonicalUri:
          "loom://loom-ai-navigation-architecture/L-TEST/r/R-ADDR?id=meta-response-address",
        object: {
          objectId: "r-address-bar",
          kind: "response",
          status: "active",
          title: "Address Bar as local AI web navigator",
          canonicalUri:
            "loom://loom-ai-navigation-architecture/L-TEST/r/R-ADDR?id=meta-response-address",
          aliasUri: "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar",
        },
        destination: {
          loomId: "c-architecture",
          mode: "full",
          scrollTargetResponseId: "r-address-bar",
          scrollMode: "exact",
          source: "addressBar",
        },
      })),
      localDependencies: {},
    });

    const result = await engine.resolveAddress({
      address: "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar",
    });

    expect(result.status).toBe("resolved");
    expect(result.destination).toMatchObject({
      loomId: "c-architecture",
      scrollTargetResponseId: "r-address-bar",
      scrollMode: "exact",
    });
    expect(result.fallbackReason).toBeUndefined();
    expect(result.serviceAddressStoreAuthoritative).toBeUndefined();
  });

  test("rust-service graph success uses service projection", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        async () => ({
          nodes: [
            {
              id: "loom:L-1:root",
              kind: "root",
              loomId: "L-1",
              title: "Service Loom",
              depth: 0,
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
          serviceGraphStatus: "resolved",
        })
      ),
      localDependencies: {},
    });

    const projection = await engine.getGraphProjection(graphProjectionInput());
    expect(projection.nodes[0]?.title).toBe("Service Loom");
    expect(projection.fallbackUsed).toBeUndefined();
    expect(projection.serviceGraphStoreAuthoritative).toBeUndefined();
  });

  test("rust-service graph not found is final", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        async () => ({
          nodes: [],
          edges: [],
          serviceGraphStatus: "not_found",
        })
      ),
      localDependencies: {},
    });

    const projection = await engine.getGraphProjection(graphProjectionInput());
    expect(projection.nodes).toEqual([]);
    expect(projection.fallbackUsed).toBeUndefined();
    expect(projection.serviceGraphStatus).toBe("not_found");
    expect(projection.serviceGraphStoreAuthoritative).toBeUndefined();
  });

  test("rust-service graph empty is final", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        async () => ({
          nodes: [],
          edges: [],
          serviceGraphStatus: "empty",
        })
      ),
      localDependencies: {},
    });

    const projection = await engine.getGraphProjection(graphProjectionInput());
    expect(projection.nodes).toEqual([]);
    expect(projection.fallbackUsed).toBeUndefined();
    expect(projection.fallbackReason).toBeUndefined();
  });

  test("rust-service graph transport failure does not fall back to TypeScript projection", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        }
      ),
      localDependencies: {},
    });

    await expect(engine.getGraphProjection(graphProjectionInput())).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("rust-service graph transport failure stays service error with legacy strict flag", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        }
      ),
      localDependencies: {},
    });

    await expect(engine.getGraphProjection(graphProjectionInput())).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("rust-service authoritative graph not found does not fallback", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      serviceGraphStoreAuthoritative: true,
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        async () => ({
          nodes: [],
          edges: [],
          serviceGraphStatus: "not_found",
        })
      ),
      localDependencies: {},
    });

    const projection = await engine.getGraphProjection(graphProjectionInput());
    expect(projection.nodes).toEqual([]);
    expect(projection.fallbackUsed).toBeUndefined();
    expect(projection.serviceGraphStatus).toBe("not_found");
    expect(projection.serviceGraphStoreAuthoritative).toBeUndefined();
  });

  test("strict authoritative rust-service graph succeeds for seeded Loom without fallback", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      serviceGraphStoreAuthoritative: true,
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        async () => ({
          nodes: [
            {
              id: "loom:c-graph-map:root",
              kind: "root",
              loomId: "c-graph-map",
              title: "Weft-aware Loom graph",
              depth: 0,
              position: { x: 0, y: 0 },
              canonicalUri: "loom://product/graph-view-site-map",
            },
            {
              id: "loom:c-graph-map:response:r-graph-continuation",
              kind: "response",
              loomId: "c-graph-map",
              responseId: "r-graph-continuation",
              title: "Continue Loom appends below the latest Response",
              depth: 1,
              position: { x: 0, y: 180 },
              canonicalUri:
                "loom://product/graph-view-site-map/loom/continuation/r-graph-continuation",
            },
            {
              id: "loom:c-graph-continuation:root",
              kind: "weft",
              loomId: "c-graph-continuation",
              title: "Graph continuation composer behavior",
              depth: 2,
              position: { x: 320, y: 360 },
              canonicalUri: "loom://product/graph-view-site-map/weft/continuation",
            },
          ],
          edges: [
            {
              id: "edge:loom:c-graph-map:response:r-graph-continuation",
              source: "loom:c-graph-map:root",
              target: "loom:c-graph-map:response:r-graph-continuation",
              kind: "question",
            },
            {
              id: "edge:response:r-graph-continuation:loom:c-graph-continuation",
              source: "loom:c-graph-map:response:r-graph-continuation",
              target: "loom:c-graph-continuation:root",
              kind: "branch",
            },
          ],
          serviceGraphStatus: "resolved",
        })
      ),
      localDependencies: {},
    });

    const projection = await engine.getGraphProjection({
      ...graphProjectionInput(),
      activeLoomId: "c-graph-map",
      focusedResponseId: "r-graph-continuation",
    });

    expect(projection.nodes.some((node) => node.kind === "root")).toBe(true);
    expect(projection.nodes.some((node) => node.responseId === "r-graph-continuation")).toBe(true);
    expect(projection.edges.length).toBeGreaterThan(0);
    expect(projection.fallbackUsed).toBeUndefined();
    expect(projection.serviceGraphStoreAuthoritative).toBeUndefined();
  });

  test("[legacy-typescript-local] address resolution does not require service /resolve", async () => {
    const localObject: LoomResolvedObject = {
      objectId: "L-1",
      kind: "conversation",
      status: "active",
      title: "Local Loom",
      canonicalUri: "loom://o/conversation/L-1",
    };
    const engine = createLoomEngineClient({
      mode: "typescript-local",
      localDependencies: {
        graphRepository: createGraphRepositoryStub(localObject),
      },
    });

    const result = await engine.resolveAddress({ address: "loom://o/conversation/L-1" });
    expect(result.status).toBe("resolved");
    expect(result.object?.title).toBe("Local Loom");
  });

  test("[legacy-typescript-local] graph projection does not call service graph endpoint", async () => {
    const engine = createLoomEngineClient({
      mode: "typescript-local",
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        async () => unsupportedMockMethod("getGraphProjection")
      ),
      localDependencies: {},
    });

    const projection = await engine.getGraphProjection(graphProjectionInput());
    expect(projection.nodes.some((node) => node.title === "Local response")).toBe(true);
    expect(projection.fallbackUsed).toBeUndefined();
  });

  test("[legacy-typescript-local] export uses TypeScript export path", async () => {
    let rustCalled = false;
    const engine = createLoomEngineClient({
      mode: "typescript-local",
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        undefined,
        async () => {
          rustCalled = true;
          return unsupportedMockMethod("exportLoom");
        }
      ),
      localDependencies: {
        exportLoom: async () => ({
          fileName: "local.md",
          mimeType: "text/markdown",
          contentBase64: "TG9jYWw=",
          warnings: [],
        }),
      },
    });

    const exportResult = await engine.exportLoom({ loomId: "L-1", format: "markdown" });
    expect(exportResult.fileName).toBe("local.md");
    expect(rustCalled).toBe(false);
  });

  test("[legacy-typescript-local] createLoom remains unmigrated", async () => {
    const engine = createLoomEngineClient({ mode: "typescript-local" });

    await expect(engine.createLoom({ title: "Local Loom" })).rejects.toThrow(
      "TypeScriptLocalLoomEngine.createLoom is not implemented"
    );
  });

  test("Rust HTTP client creates Looms through POST /looms", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/looms");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          loomId: "loom-write-1",
          title: "Service Loom",
          kind: "loom",
          canonicalUri: "loom://service/loom-write-1",
        });
        return new Response(
          JSON.stringify({
            loom: {
              loomId: "loom-write-1",
              title: "Service Loom",
              summary: "Created in service",
              kind: "loom",
              canonicalUri: "loom://service/loom-write-1",
              code: "L-WRITE",
              createdAt: "1",
              updatedAt: "1",
              raw_thinking: "hidden",
            },
          }),
          { status: 201 }
        );
      },
    });

    const result = await client.createLoom({
      loomId: "loom-write-1",
      title: "Service Loom",
      summary: "Created in service",
      kind: "loom",
      canonicalUri: "loom://service/loom-write-1",
      code: "L-WRITE",
    });

    expect(result.loom).toMatchObject({
      loomId: "loom-write-1",
      title: "Service Loom",
      canonicalUri: "loom://service/loom-write-1",
    });
    expect(JSON.stringify(result)).not.toContain("hidden");
  });

  test("Rust HTTP client gets lists and updates Loom metadata", async () => {
    const calls: string[] = [];
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/looms") && (!init?.method || init.method === "GET")) {
          return new Response(
            JSON.stringify({
              looms: [
                {
                  loomId: "loom-write-1",
                  title: "Service Loom",
                  kind: "loom",
                  createdAt: "1",
                  updatedAt: "1",
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/looms/loom-write-1") && init?.method === "GET") {
          return new Response(
            JSON.stringify({
              loom: {
                loomId: "loom-write-1",
                title: "Service Loom",
                kind: "loom",
                createdAt: "1",
                updatedAt: "1",
                responses: [
                  {
                    responseId: "user-1",
                    role: "user",
                    content: "[[csharp code from Response]] IProcessor nasıl olmalı",
                    createdAt: "1",
                    sequenceIndex: 0,
                    metadata: {
                      references: [
                        {
                          referenceId: "reference-1",
                          label: "csharp code from Response",
                          selectedTextPreview: "public interface IProcessor {}",
                          targetKind: "code_block",
                          targetId: "code-block-1",
                          sourceResponseCode: "R-00001",
                          sourceTitle: "Code Snippet",
                          raw_thinking: "hidden",
                        },
                      ],
                    },
                  },
                  {
                    responseId: "assistant-1",
                    role: "assistant",
                    content: "IProcessor should model one processing responsibility.",
                    title: "IProcessor Interface Nasıl Olmalı?",
                    canonicalUri: "loom://service/loom-write-1/r/R-00001?id=assistant-1",
                    code: "R-00001",
                    createdAt: "2",
                    sequenceIndex: 1,
                    metadata: {},
                    codeBlocks: [],
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/looms/loom-write-1") && init?.method === "PATCH") {
          expect(JSON.parse(String(init.body))).toMatchObject({
            title: "Renamed Loom",
          });
          return new Response(
            JSON.stringify({
              loom: {
                loomId: "loom-write-1",
                title: "Renamed Loom",
                summary: "Updated",
                kind: "loom",
                createdAt: "1",
                updatedAt: "2",
              },
            }),
            { status: 200 }
          );
        }
        throw new Error(`unexpected request ${url}`);
      },
    });

    await expect(client.listLooms()).resolves.toHaveLength(1);
    const hydratedLoom = await client.getLoom("loom-write-1");
    expect(hydratedLoom).toMatchObject({
      loomId: "loom-write-1",
      responses: [
        {
          question: "[[csharp code from Response]] IProcessor nasıl olmalı",
          questionReferences: [
            {
              targetKind: "code_block",
              referenceCustomLabel: "csharp code from Response",
              referenceMentionId: "reference-1",
              selectedText: "public interface IProcessor {}",
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(hydratedLoom)).not.toContain("raw_thinking");
    expect(JSON.stringify(hydratedLoom)).not.toContain("hidden");
    await expect(
      client.updateLoomMetadata({
        loomId: "loom-write-1",
        title: "Renamed Loom",
        summary: "Updated",
      })
    ).resolves.toMatchObject({ loom: { title: "Renamed Loom" } });
    await client.renameLoom({ loomId: "loom-write-1", title: "Renamed Loom" });
    expect(calls).toContain("PATCH http://127.0.0.1:17633/looms/loom-write-1");
  });

  test("rust-service createLoom does not silently fallback", async () => {
    const rustClient: LoomEngineClient = {
      ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
      createLoom: async () => {
        throw new RustHttpLoomEngineError("service_unavailable", "service down");
      },
    };
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient,
    });

    await expect(engine.createLoom({ title: "Strict Loom" })).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("Rust HTTP client creates, lists, suggests, and deletes References", async () => {
    const calls: string[] = [];
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        calls.push(`${init?.method ?? "GET"} ${String(input)}`);
        const url = String(input);
        if (url === "http://127.0.0.1:17633/references" && init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toMatchObject({
            sourceLoomId: "loom-1",
            sourceResponseId: "response-1",
            targetKind: "fragment",
            targetId: "response-1",
            targetUri: "loom://service/response-1#fragment=frag-1",
            label: "Selected Fragment",
            selectedText: "Selected text",
            fragmentHash: "frag-1",
          });
          expect(String(init.body)).not.toContain("hidden");
          return new Response(
            JSON.stringify({
              reference: {
                referenceId: "reference-1",
                sourceLoomId: "loom-1",
                sourceResponseId: "response-1",
                targetKind: "fragment",
                targetId: "response-1",
                targetUri: "loom://service/response-1#fragment=frag-1",
                label: "Selected Fragment",
                selectedText: "Selected text",
                fragmentHash: "frag-1",
                createdAt: "1",
                metadata: {
                  referenceCode: "R1",
                  sourceResponseCode: "R1",
                  raw_thinking: "hidden",
                },
              },
              reused: true,
            }),
            { status: 200 }
          );
        }
        if (url === "http://127.0.0.1:17633/looms/loom-1/references") {
          return new Response(
            JSON.stringify({
              references: [
                {
                  referenceId: "reference-1",
                  sourceLoomId: "loom-1",
                  sourceResponseId: "response-1",
                  targetKind: "fragment",
                  targetId: "response-1",
                  targetUri: "loom://service/response-1#fragment=frag-1",
                  label: "Selected Fragment",
                  selectedText: "Selected text",
                  fragmentHash: "frag-1",
                  createdAt: "1",
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url === "http://127.0.0.1:17633/code-snippets?loomId=loom-1&limit=25") {
          return new Response(
            JSON.stringify({
              codeSnippets: [
                {
                  codeBlockId: "codeblock-response-1-0-hash",
                  responseId: "response-1",
                  loomId: "loom-1",
                  loomTitle: "Service Loom",
                  sourceResponseTitle: "Selected Fragment",
                  sourceResponseCode: "R1",
                  sourceCanonicalUri: "loom://service/response-1",
                  blockIndex: 0,
                  language: "ts",
                  code: "export const value = 1;",
                  exactHash: "hash",
                  fence: "```ts",
                  createdAt: "1",
                  updatedAt: "1",
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url === "http://127.0.0.1:17633/references/suggest" && init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toMatchObject({
            loomId: "loom-1",
            draftText: "Selected",
            limit: 5,
          });
          return new Response(
            JSON.stringify({
              suggestions: [
                {
                  reference: {
                    referenceId: "reference-1",
                    targetKind: "fragment",
                    targetUri: "loom://service/response-1#fragment=frag-1",
                    label: "Selected Fragment",
                    createdAt: "1",
                  },
                  score: 80,
                  reason: "prefix",
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url === "http://127.0.0.1:17633/references/reference-1" && init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request ${url}`);
      },
    });

    const created = await client.addReference({
      loomId: "loom-1",
      sourceResponseId: "response-1",
      reference: {
        id: "fragment:loom-1:response-1:frag-1",
        type: "fragment",
        title: "Selected Fragment",
        path: "loom://service/response-1#fragment=frag-1",
        targetObjectId: "response-1",
        canonicalUri: "loom://service/response-1#fragment=frag-1",
        referenceCode: "R1",
        sourceLoomId: "loom-1",
        sourceResponseId: "response-1",
        selectedText: "Selected text",
        fragmentHash: "frag-1",
      },
      metadata: {
        raw_thinking: "hidden",
        sourceResponseCode: "R1",
      },
    });
    expect(created.reused).toBe(true);
    expect(created.reference).toMatchObject({
      referenceMentionId: "reference-1",
      type: "fragment",
      selectedText: "Selected text",
      fragmentHash: "frag-1",
    });
    expect(JSON.stringify(created)).not.toContain("hidden");

    await expect(client.listReferences({ loomId: "loom-1" })).resolves.toMatchObject({
      references: [{ referenceMentionId: "reference-1" }],
    });
    await expect(client.listCodeSnippets({ loomId: "loom-1", limit: 25 })).resolves.toMatchObject({
      codeSnippets: [
        {
          codeBlockId: "codeblock-response-1-0-hash",
          responseId: "response-1",
          language: "ts",
          code: "export const value = 1;",
        },
      ],
    });
    await expect(
      client.suggestReferences({ loomId: "loom-1", draftText: "Selected", limit: 5 })
    ).resolves.toMatchObject({
      suggestions: [{ reference: { referenceMentionId: "reference-1" }, reason: "prefix" }],
    });
    await expect(client.removeReference({ loomId: "loom-1", referenceId: "reference-1" })).resolves.toBeUndefined();
    expect(calls).toContain("DELETE http://127.0.0.1:17633/references/reference-1");
  });

  test("Rust HTTP client creates, finds, lists, and deletes Bookmarks", async () => {
    const calls: string[] = [];
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        calls.push(`${init?.method ?? "GET"} ${String(input)}`);
        const url = String(input);
        if (url === "http://127.0.0.1:17633/bookmarks" && init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toMatchObject({
            targetKind: "response",
            targetId: "response-1",
            targetUri: "loom://service/response-1",
            title: "Saved Response",
            metadata: { code: "R1" },
          });
          expect(String(init.body)).not.toContain("hidden");
          return new Response(
            JSON.stringify({
              bookmark: {
                bookmarkId: "bookmark-1",
                targetKind: "response",
                targetId: "response-1",
                targetUri: "loom://service/response-1",
                title: "Saved Response",
                createdAt: "2026-05-10T00:00:00Z",
                metadata: { code: "R1", raw_thinking: "hidden" },
              },
              reused: true,
            }),
            { status: 200 }
          );
        }
        if (url === "http://127.0.0.1:17633/bookmarks") {
          return new Response(
            JSON.stringify({
              bookmarks: [
                {
                  bookmarkId: "bookmark-1",
                  targetKind: "response",
                  targetId: "response-1",
                  targetUri: "loom://service/response-1",
                  title: "Saved Response",
                  createdAt: "2026-05-10T00:00:00Z",
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (
          url ===
          "http://127.0.0.1:17633/bookmarks/target?targetKind=response&targetId=response-1"
        ) {
          return new Response(
            JSON.stringify({
              bookmark: {
                bookmarkId: "bookmark-1",
                targetKind: "response",
                targetId: "response-1",
                title: "Saved Response",
                createdAt: "2026-05-10T00:00:00Z",
              },
              reused: true,
            }),
            { status: 200 }
          );
        }
        if (url === "http://127.0.0.1:17633/bookmarks/bookmark-1" && init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        throw new Error(`unexpected request ${url}`);
      },
    });

    const created = await client.createBookmark({
      targetKind: "response",
      targetId: "response-1",
      targetUri: "loom://service/response-1",
      title: "Saved Response",
      metadata: { code: "R1", raw_thinking: "hidden" },
    });
    expect(created.reused).toBe(true);
    expect(created.bookmark).toMatchObject({
      id: "bookmark-1",
      type: "response",
      targetObjectId: "response-1",
      path: "loom://service/response-1",
    });
    expect(JSON.stringify(created)).not.toContain("hidden");

    await expect(client.listBookmarks()).resolves.toMatchObject({
      bookmarks: [{ id: "bookmark-1" }],
    });
    await expect(
      client.getBookmarkForTarget({ targetKind: "response", targetId: "response-1" })
    ).resolves.toMatchObject({ bookmark: { id: "bookmark-1" }, reused: true });
    await expect(client.deleteBookmark({ bookmarkId: "bookmark-1" })).resolves.toBeUndefined();
    expect(calls).toContain("DELETE http://127.0.0.1:17633/bookmarks/bookmark-1");
  });

  test("Rust HTTP client creates or reuses Wefts through POST /wefts", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/wefts");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          originLoomId: "origin-loom",
          originResponseId: "origin-response",
          reuseExisting: true,
          source: "quick_ask_convert",
          metadata: {
            selectedText: "MCP",
            sourceFragment: { selectedText: "MCP" },
          },
        });
        expect(String(init?.body)).not.toContain("hidden");
        return new Response(
          JSON.stringify({
            weft: {
              loomId: "weft-1",
              title: "Service Weft",
              kind: "weft",
              originLoomId: "origin-loom",
              originResponseId: "origin-response",
              canonicalUri: "loom://wefts/weft-1",
              code: "W-1",
              createdAt: "1",
              updatedAt: "1",
              raw_thinking: "hidden",
            },
            created: true,
            reused: false,
            visibleSeedResponses: [
              {
                responseId: "seed-user-1",
                role: "user",
                content: "What is MCP?",
                title: "Origin question",
                sequenceIndex: 0,
                copiedFromResponseId: "origin-user",
                raw_thinking: "hidden",
              },
              {
                responseId: "seed-assistant-1",
                role: "assistant",
                content: "Model Context Protocol.",
                title: "Origin answer",
                sequenceIndex: 1,
                copiedFromResponseId: "origin-response",
              },
            ],
            originContextSnapshotId: "ctx-1",
            warnings: ["snapshot_ready"],
          }),
          { status: 201 }
        );
      },
    });

    const result = await client.createOrOpenWeft({
      originLoomId: "origin-loom",
      originResponseId: "origin-response",
      title: "Service Weft",
      reuseExisting: true,
      source: "quick_ask_convert",
      metadata: {
        selectedText: "MCP",
        raw_thinking: "hidden",
        sourceFragment: {
          selectedText: "MCP",
          chain_of_thought: "hidden",
        },
      },
    });

    expect(result).toMatchObject({
      loomId: "weft-1",
      created: true,
      reused: false,
      navigationDestination: {
        loomId: "weft-1",
        mode: "split",
        originLoomId: "origin-loom",
        originResponseId: "origin-response",
        source: "weftCreate",
      },
    });
    expect(result.weft).toMatchObject({ kind: "weft", canonicalUri: "loom://wefts/weft-1" });
    expect(result.visibleSeedResponses).toEqual([
      {
        responseId: "seed-user-1",
        role: "user",
        content: "What is MCP?",
        title: "Origin question",
        sequenceIndex: 0,
        copiedFromResponseId: "origin-user",
      },
      {
        responseId: "seed-assistant-1",
        role: "assistant",
        content: "Model Context Protocol.",
        title: "Origin answer",
        sequenceIndex: 1,
        copiedFromResponseId: "origin-response",
      },
    ]);
    expect(result.originContextSnapshotId).toBe("ctx-1");
    expect(result.warnings).toEqual(["snapshot_ready"]);
    expect(JSON.stringify(result)).not.toContain("hidden");
  });

  test("rust-service createOrOpenWeft does not fallback when service is unavailable", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        createOrOpenWeft: async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
      localDependencies: {
        createOrOpenWeft: async (input) => ({
          loomId: "local-weft",
          created: true,
          navigationDestination: {
            loomId: "local-weft",
            mode: "split",
            originLoomId: input.originLoomId,
            originResponseId: input.originResponseId,
            source: "weftCreate",
          },
        }),
      },
    });

    await expect(
      engine.createOrOpenWeft({
        originLoomId: "origin-loom",
        originResponseId: "origin-response",
      })
    ).rejects.toMatchObject({ kind: "service_unavailable" });
  });

  test("rust-service createOrOpenWeft ignores legacy local fallback dependencies", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        createOrOpenWeft: async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
      localDependencies: {
        createOrOpenWeft: async () => {
          throw new Error("local fallback should not run");
        },
      },
    });

    await expect(
      engine.createOrOpenWeft({
        originLoomId: "origin-loom",
        originResponseId: "origin-response",
      })
    ).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("Rust HTTP client persists converted Weft turns through POST /wefts/:id/responses", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/wefts/weft-1/responses");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          source: "quick_ask_convert",
          originLoomId: "origin-loom",
          originResponseId: "origin-response",
          selectedText: "MCP",
          fragmentHash: "frag-1",
          turns: [
            {
              id: "turn-1",
              question: "What is MCP?",
              answer: "Model Context Protocol.",
            },
          ],
        });
        expect(String(init?.body)).not.toContain("hidden");
        return new Response(
          JSON.stringify({
            weftLoomId: "weft-1",
            responses: [
              {
                userResponseId: "user-1",
                assistantResponseId: "assistant-1",
                question: "What is MCP?",
                answer: "Model Context Protocol.",
                sequenceIndex: 2,
                raw_thinking: "hidden",
              },
            ],
            originContextSnapshotId: "ctx-quick",
            warnings: [],
          }),
          { status: 200 }
        );
      },
    });

    const result = await client.persistWeftTurns({
      weftLoomId: "weft-1",
      originLoomId: "origin-loom",
      originResponseId: "origin-response",
      selectedText: "MCP",
      fragmentHash: "frag-1",
      sourceMetadata: {
        sourceResponseCode: "R-1",
        raw_thinking: "hidden",
      },
      turns: [
        {
          id: "turn-1",
          question: "What is MCP?",
          answer: "Model Context Protocol.",
          metadata: { chain_of_thought: "hidden" },
        },
      ],
    });

    expect(result).toEqual({
      weftLoomId: "weft-1",
      responses: [
        {
          userResponseId: "user-1",
          assistantResponseId: "assistant-1",
          question: "What is MCP?",
          answer: "Model Context Protocol.",
          sequenceIndex: 2,
        },
      ],
      originContextSnapshotId: "ctx-quick",
      warnings: [],
    });
    expect(JSON.stringify(result)).not.toContain("hidden");
  });

  test("rust-service persistWeftTurns does not silently fallback", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        persistWeftTurns: async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
      localDependencies: {
        persistWeftTurns: async () => ({ weftLoomId: "local", responses: [] }),
      },
    });

    await expect(
      engine.persistWeftTurns({
        weftLoomId: "weft-1",
        originLoomId: "origin-loom",
        originResponseId: "origin-response",
        turns: [{ question: "Q", answer: "A" }],
      })
    ).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("Rust HTTP client updates user Response through PATCH /responses/:id", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/responses/user-1");
        expect(init?.method).toBe("PATCH");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          content: "Edited prompt",
          editReason: "user_prompt_edit",
          markDownstreamStale: true,
          metadata: {
            questionReferences: [{ id: "ref-1", selectedText: "MCP" }],
          },
        });
        expect(String(init?.body)).not.toContain("hidden");
        return new Response(
          JSON.stringify({
            response: {
              responseId: "user-1",
              loomId: "loom-1",
              role: "user",
              content: "Edited prompt",
              updatedAt: "2026-05-10T00:00:00Z",
              metadata: {
                edited: true,
                questionReferences: [{ id: "ref-1", selectedText: "MCP" }],
                raw_thinking: "hidden",
              },
            },
            staleResponses: [
              {
                responseId: "assistant-1",
                role: "assistant",
                stale: true,
                staleReason: "prompt_edited",
                hidden_reasoning: "hidden",
              },
            ],
          }),
          { status: 200 }
        );
      },
    });

    const result = await client.updateResponse({
      responseId: "user-1",
      content: "Edited prompt",
      metadata: {
        questionReferences: [{ id: "ref-1", selectedText: "MCP" }],
        raw_thinking: "hidden",
      },
      markDownstreamStale: true,
    });

    expect(result).toMatchObject({
      response: {
        responseId: "user-1",
        loomId: "loom-1",
        role: "user",
        content: "Edited prompt",
      },
      staleResponses: [
        {
          responseId: "assistant-1",
          role: "assistant",
          stale: true,
          staleReason: "prompt_edited",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("hidden");
  });

  test("rust-service updateResponse does not silently fallback", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        updateResponse: async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
      localDependencies: {
        updateResponse: async () => {
          throw new Error("local fallback should not run");
        },
      },
    });

    await expect(
      engine.updateResponse({
        responseId: "user-1",
        content: "Edited prompt",
      })
    ).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("Rust HTTP client regenerates edited prompt through POST /responses/:id/regenerate", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/responses/user-1/regenerate");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          responseMode: "auto",
          replaceStale: false,
          source: "prompt_edit_regenerate",
          model: "qwen3:latest",
          options: {
            numCtx: 2048,
          },
        });
        return sseResponse([
          {
            type: "response.placeholder_created",
            payload: {
              runId: "run-regen",
              loomId: "loom-1",
              userResponseId: "user-1",
              assistantResponseId: "assistant-new",
            },
          },
          {
            type: "response.delta",
            payload: {
              runId: "run-regen",
              assistantResponseId: "assistant-new",
              delta: "Fresh answer",
              raw_thinking: "hidden",
            },
          },
          {
            type: "response.completed",
            payload: {
              runId: "run-regen",
              assistantResponseId: "assistant-new",
              doneReason: "stop",
            },
          },
        ]);
      },
    });

    const events = [];
    for await (const event of client.regenerateFromResponse({
      loomId: "loom-1",
      userResponseId: "user-1",
      staleAssistantResponseId: "assistant-old",
      responseMode: "auto",
      model: "qwen3:latest",
      options: { numCtx: 2048 },
    })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      {
        type: "user_message_created",
        payload: { loomId: "loom-1", responseId: "user-1", workflowRunId: "run-regen" },
      },
      {
        type: "assistant_placeholder_created",
        payload: { loomId: "loom-1", responseId: "assistant-new", workflowRunId: "run-regen" },
      },
      { type: "content_delta", payload: { responseId: "assistant-new", delta: "Fresh answer" } },
      { type: "response_completed", payload: { responseId: "assistant-new", doneReason: "stop" } },
    ]);
    expect(JSON.stringify(events)).not.toContain("hidden");
  });

  test("Rust HTTP client retries user message through POST /responses/:id/retry", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/responses/user-1/retry");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          responseMode: "auto",
          softDeleteDownstream: true,
          reason: "retry_from_user_message",
          model: "qwen3:latest",
          options: {
            numCtx: 2048,
          },
        });
        return sseResponse([
          {
            type: "response.placeholder_created",
            payload: {
              runId: "run-retry",
              loomId: "loom-1",
              userResponseId: "user-1",
              assistantResponseId: "assistant-retry",
            },
          },
          {
            type: "response.delta",
            payload: {
              runId: "run-retry",
              assistantResponseId: "assistant-retry",
              delta: "Retried answer",
            },
          },
          {
            type: "response.completed",
            payload: {
              runId: "run-retry",
              assistantResponseId: "assistant-retry",
              doneReason: "stop",
            },
          },
        ]);
      },
    });

    const events = [];
    for await (const event of client.retryUserMessage({
      loomId: "loom-1",
      userResponseId: "user-1",
      responseMode: "auto",
      softDeleteDownstream: true,
      model: "qwen3:latest",
      options: { numCtx: 2048 },
    })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      {
        type: "user_message_created",
        payload: { loomId: "loom-1", responseId: "user-1", workflowRunId: "run-retry" },
      },
      {
        type: "assistant_placeholder_created",
        payload: { loomId: "loom-1", responseId: "assistant-retry", workflowRunId: "run-retry" },
      },
      { type: "content_delta", payload: { responseId: "assistant-retry", delta: "Retried answer" } },
      { type: "response_completed", payload: { responseId: "assistant-retry", doneReason: "stop" } },
    ]);
  });

  test("rust-service regenerateFromResponse does not silently fallback", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        regenerateFromResponse: async function* () {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
      localDependencies: {
        regenerateFromResponse: async function* () {
          throw new Error("local fallback should not run");
        },
      },
    });

    await expect(async () => {
      for await (const _event of engine.regenerateFromResponse({
        loomId: "loom-1",
        userResponseId: "user-1",
        responseMode: "auto",
      })) {
        // no-op
      }
    }).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("Rust HTTP client streams Main composer send through /orchestration/execute", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/orchestration/execute");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          loomId: "L-1",
          prompt: "Explain Looms",
          responseMode: "auto",
          model: "qwen3:latest",
          references: [
            {
              referenceId: "ref-1",
              targetKind: "fragment",
              targetId: "target-1",
              selectedTextPreview: "Selected fragment",
            },
          ],
        });
        return sseResponse([
          {
            type: "response.placeholder_created",
            correlationId: "run-1",
            payload: {
              runId: "run-1",
              loomId: "L-1",
              userResponseId: "user-1",
              assistantResponseId: "assistant-1",
            },
          },
          {
            type: "response.delta",
            payload: {
              runId: "run-1",
              assistantResponseId: "assistant-1",
              delta: "Hello",
              raw_thinking: "hidden",
            },
          },
          {
            type: "response.completed",
            payload: {
              runId: "run-1",
              assistantResponseId: "assistant-1",
              doneReason: "stop",
            },
          },
        ]);
      },
    });

    const events = [];
    for await (const event of client.sendMessage({
      loomId: "L-1",
      promptText: "Explain Looms",
      references: [
        {
          id: "ref-1",
          type: "fragment",
          title: "Reference",
          path: "loom://ref",
          targetObjectId: "target-1",
          selectedText: "Selected fragment",
        },
      ],
      responseMode: "auto",
      source: "composer",
      model: "qwen3:latest",
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "user_message_created",
        payload: { loomId: "L-1", responseId: "user-1", workflowRunId: "run-1" },
      },
      {
        type: "assistant_placeholder_created",
        payload: { loomId: "L-1", responseId: "assistant-1", workflowRunId: "run-1" },
      },
      { type: "content_delta", payload: { responseId: "assistant-1", delta: "Hello" } },
      {
        type: "response_completed",
        payload: { responseId: "assistant-1", doneReason: "stop" },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("hidden");
  });

  test("rust-service sendMessage does not silently fallback", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        sendMessage: async function* () {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
    });

    const iterator = engine.sendMessage({
      loomId: "L-1",
      promptText: "hello",
      references: [],
      responseMode: "auto",
      source: "composer",
    });

    await expect(iterator[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("rust-service sendMessage does not fallback before service acceptance", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        sendMessage: async function* () {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
      localDependencies: {
        sendMessage: async function* () {
          yield { type: "status", payload: { message: "fallback generation" } };
        },
      },
    });

    const iterator = engine.sendMessage({
      loomId: "L-1",
      promptText: "hello",
      references: [],
      responseMode: "auto",
      source: "composer",
    });
    await expect(iterator[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("rust-service sendMessage does not fallback after service acceptance", async () => {
    let fallbackCalled = false;
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        sendMessage: async function* () {
          yield {
            type: "assistant_placeholder_created",
            payload: { loomId: "L-1", responseId: "assistant-1", workflowRunId: "run-1" },
          };
          throw new RustHttpLoomEngineError("service_unavailable", "stream failed");
        },
      },
      localDependencies: {
        sendMessage: async function* () {
          fallbackCalled = true;
          yield { type: "status", payload: { message: "fallback generation" } };
        },
      },
    });

    const events = [];
    let thrown: unknown;
    try {
      for await (const event of engine.sendMessage({
        loomId: "L-1",
        promptText: "hello",
        references: [],
        responseMode: "auto",
        source: "composer",
      })) {
        events.push(event);
      }
    } catch (error) {
      thrown = error;
    }

    expect(events).toEqual([
      {
        type: "assistant_placeholder_created",
        payload: { loomId: "L-1", responseId: "assistant-1", workflowRunId: "run-1" },
      },
    ]);
    expect(thrown).toMatchObject({ kind: "service_unavailable" });
    expect(fallbackCalled).toBe(false);
  });

  test("Rust HTTP client maps truncation and strips raw thinking fields", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async () =>
        sseResponse([
          {
            type: "response.truncated",
            payload: {
              assistantResponseId: "assistant-1",
              doneReason: "length",
              chain_of_thought: "hidden",
            },
          },
        ]),
    });

    const events = [];
    for await (const event of client.sendMessage({
      loomId: "L-1",
      promptText: "hello",
      references: [],
      responseMode: "auto",
      source: "composer",
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "response_truncated",
        payload: { responseId: "assistant-1", doneReason: "length" },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("hidden");
  });

  test("Rust HTTP client forwards long-form prompt without TypeScript output budget authority", async () => {
    let body: unknown;
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return sseResponse([]);
      },
    });

    for await (const _event of client.sendMessage({
      loomId: "L-1",
      promptText: "event sourcing nedir? nasıl kullanılır? Detaylı olarak anlat",
      references: [],
      responseMode: "expanded",
      source: "composer",
      model: "qwen3:latest",
      options: { numCtx: 8192 },
    })) {
      // Empty stream for payload verification.
    }

    expect(body).toMatchObject({
      loomId: "L-1",
      prompt: "event sourcing nedir? nasıl kullanılır? Detaylı olarak anlat",
      responseMode: "expanded",
      model: "qwen3:latest",
      options: { numCtx: 8192 },
    });
    expect(JSON.stringify(body)).not.toContain("numPredict");
  });

  test("Rust HTTP client gives generation stream startup more than the short JSON timeout", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const recordedTimeouts: number[] = [];
    globalThis.setTimeout = ((...args: Parameters<typeof globalThis.setTimeout>) => {
      recordedTimeouts.push(Number(args[1] ?? 0));
      return originalSetTimeout(...args);
    }) as typeof globalThis.setTimeout;
    try {
      const client = new RustHttpLoomEngineClient({
        serviceUrl: "http://127.0.0.1:17633",
        fetch: async () => sseResponse([]),
      });

      for await (const _event of client.sendMessage({
        loomId: "L-1",
        promptText: "hello",
        references: [],
        responseMode: "auto",
        source: "composer",
      })) {
        // Empty stream for startup timeout verification.
      }

      expect(recordedTimeouts).toContain(120_000);
      expect(recordedTimeouts).not.toContain(5_000);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("Rust HTTP client uses caller abort signal for generation stream", async () => {
    const abortController = new AbortController();
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      requestTimeoutMs: 60_000,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });

    const iterator = client.sendMessage({
      loomId: "L-1",
      promptText: "hello",
      references: [],
      responseMode: "auto",
      source: "composer",
      signal: abortController.signal,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    abortController.abort();

    await expect(pending).rejects.toMatchObject({
      kind: "request_failed",
    });
  });

  test("Rust HTTP client calls orchestration cancel endpoint and sanitizes response", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/orchestration/cancel/run-1");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ reason: "user_stop" });
        return new Response(
          JSON.stringify({
            runId: "run-1",
            cancelled: true,
            responseId: "assistant-1",
            raw_thinking: "hidden",
          }),
          { status: 200 }
        );
      },
    });

    const result = await client.cancelMessage({
      workflowRunId: "run-1",
      responseId: "assistant-1",
      reason: "user_stop",
    });

    expect(result).toEqual({
      status: "cancelled",
      workflowRunId: "run-1",
      responseId: "assistant-1",
      error: undefined,
    });
    expect(JSON.stringify(result)).not.toContain("hidden");
  });

  test("Rust HTTP client reads generation response state and strips raw thinking fields", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe(
          "http://127.0.0.1:17633/orchestration/runs/run-1/response-state"
        );
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            runId: "run-1",
            loomId: "loom-1",
            status: "running",
            canResume: true,
            liveTailSupported: false,
            assistantResponse: {
              responseId: "assistant-1",
              loomId: "loom-1",
              role: "assistant",
              content: "Partial answer",
              sequenceIndex: 2,
              status: "streaming",
              updatedAt: "2026-01-01T00:00:00Z",
              metadata: { workflowRunId: "run-1", raw_thinking: "hidden" },
            },
          }),
          { status: 200 }
        );
      },
    });

    const result = await client.getGenerationResponseState("run-1");

    expect(result).toMatchObject({
      workflowRunId: "run-1",
      loomId: "loom-1",
      status: "running",
      assistantResponse: {
        responseId: "assistant-1",
        content: "Partial answer",
        status: "streaming",
      },
    });
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(JSON.stringify(result)).not.toContain("raw_thinking");
  });

  test("Rust HTTP client treats missing orchestration cancel target as not found", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async () => new Response("not found", { status: 404 }),
    });

    await expect(
      client.cancelMessage({ workflowRunId: "missing-run", responseId: "assistant-1" })
    ).resolves.toEqual({
      status: "not_found",
      workflowRunId: "missing-run",
      responseId: "assistant-1",
    });
  });

  test("rust-service cancelMessage does not fallback to TypeScript local", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        cancelMessage: async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
      localDependencies: {},
    });

    await expect(engine.cancelMessage({ workflowRunId: "run-1" })).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("Rust HTTP client calls Quick Ask endpoint with selected fragment context", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/ask/quick");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          sessionId: "ask-1",
          sourceLoomId: "loom-1",
          sourceResponseId: "response-1",
          selectedText: "MCP",
          activeReferences: [
            {
              label: "MCP",
              targetKind: "fragment",
              targetId: "response-1",
              targetUri: "loom://response/response-1#fragment=mcp",
              selectedText: "MCP",
              sourceResponseId: "response-1",
            },
          ],
          question: "açılımı nedir?",
          intent: "acronym_expansion",
          options: {
            model: "llama3.2:latest",
            numCtx: 1024,
            numPredict: 768,
          },
        });
        return new Response(
          JSON.stringify({
            answer: "MCP = Model Context Protocol.",
            model: "llama3.2:latest",
            warnings: [],
            focusSubject: "MCP",
            focusSubjectSource: "selected_fragment",
            resolvedIntent: "acronym_expansion",
            requestedTopic: "plugin context",
            diagnostics: {
              traceId: "trace-1",
              inputActiveReferenceLabels: ["MCP"],
              serviceActiveReferenceLabels: ["MCP"],
              focusSubject: "MCP",
              focusSubjectSource: "selected_fragment",
              resolvedIntent: "acronym_expansion",
              requestedTopic: "plugin context",
              composedTask: "plugin context bağlamında MCP açılımı nedir?",
              promptSectionOrder: ["current_task", "focus_subject", "background_source_context"],
              providerRequestSummary: {
                focusSubject: "MCP",
                requestedTopic: "plugin context",
                focusSubjectBeforeSource: true,
              },
              answerValidation: {
                includesFocusSubject: true,
                includesRequestedTopic: true,
                genericSourceOnlyDetected: false,
                validationPassed: true,
              },
              warnings: [],
            },
            raw_thinking: "hidden",
          }),
          { status: 200 }
        );
      },
    });

    const result = await client.quickAsk({
      sessionId: "ask-1",
      quickAskTraceId: "trace-1",
      sourceLoomId: "loom-1",
      sourceResponseId: "response-1",
      selectedText: "MCP",
      sourceContext: {
        title: "Plugin sessions",
        summary: "MCP connects models to tools.",
        keyPoints: ["Model Context Protocol"],
      },
      activeReferences: [
        {
          label: "MCP",
          targetKind: "fragment",
          targetId: "response-1",
          targetUri: "loom://response/response-1#fragment=mcp",
          selectedText: "MCP",
          sourceResponseId: "response-1",
        },
      ],
      turns: [{ question: "önceki", answer: "cevap" }],
      question: "açılımı nedir?",
      intent: "acronym_expansion",
      options: { model: "llama3.2:latest", numCtx: 1024, numPredict: 768 },
    });

    expect(result).toMatchObject({
      answer: "MCP = Model Context Protocol.",
      model: "llama3.2:latest",
      warnings: [],
      focusSubject: "MCP",
      focusSubjectSource: "selected_fragment",
      resolvedIntent: "acronym_expansion",
      requestedTopic: "plugin context",
      diagnostics: expect.objectContaining({
        traceId: "trace-1",
        engineMode: "rust-service",
        clientKind: "rust-http",
        requestAttempted: true,
        endpoint: "/ask/quick",
        httpStatus: 200,
        responseParseStatus: "success",
        diagnosticsReceived: true,
        serviceRequestReceived: true,
        inputActiveReferenceLabels: ["MCP"],
        serviceActiveReferenceLabels: ["MCP"],
        focusSubject: "MCP",
        answerValidation: expect.objectContaining({
          validationPassed: true,
        }),
      }),
    });
    expect(JSON.stringify(result)).not.toContain("hidden");
  });

  test("Rust HTTP client maps Quick Ask service errors to typed diagnostics", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async () =>
        new Response(
          JSON.stringify({
            code: "RUNTIME_UNAVAILABLE",
            message: "Ollama provider is unavailable.",
            kind: "runtime_unavailable",
            retryable: true,
            correlationId: "quick-ask-typed-error",
            details: {
              endpoint: "/ask/quick",
              raw_thinking: "hidden",
            },
          }),
          { status: 503 }
        ),
    });

    await expect(
      client.quickAsk({
        sessionId: "ask-typed-error",
        turns: [],
        question: "ne anlama geliyor?",
        intent: "definition",
      })
    ).rejects.toMatchObject({
      kind: "provider_unavailable",
      message: "Ollama provider is unavailable.",
      details: {
        path: "/ask/quick",
        status: 503,
        serviceKind: "runtime_unavailable",
        retryable: true,
        correlationId: "quick-ask-typed-error",
      },
    });
  });

  test("Rust HTTP client aborts Quick Ask when caller signal is cancelled", async () => {
    const controller = new AbortController();
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    });

    const pending = client.quickAsk({
      sessionId: "ask-abort",
      turns: [],
      question: "iptal et",
      intent: "unknown",
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      kind: "request_aborted",
      message: "loom-service request was cancelled.",
      details: {
        path: "/ask/quick",
        aborted: true,
        timedOut: false,
      },
    });
  });

  test("rust-service Quick Ask does not fallback when service is unavailable", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        quickAsk: async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
      localDependencies: {
        quickAsk: async () => ({ answer: "local quick answer", warnings: [] }),
      },
    });

    await expect(
      engine.quickAsk({
        sessionId: "ask-1",
        turns: [],
        question: "hello",
        intent: "unknown",
      })
    ).rejects.toMatchObject({ kind: "service_unavailable" });
  });

  test("rust-service Quick Ask ignores legacy local fallback dependencies", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient: {
        ...createMockRustClient(async () => unsupportedMockMethod("resolveAddress")),
        quickAsk: async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        },
      },
      localDependencies: {
        quickAsk: async () => ({ answer: "local quick answer", warnings: [] }),
      },
    });

    await expect(
      engine.quickAsk({
        sessionId: "ask-1",
        turns: [],
        question: "hello",
        intent: "unknown",
      })
    ).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("Rust HTTP client calls Loom export endpoint and maps artifact", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/exports/loom");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          loomId: "L-1",
          format: "zip",
        });
        return new Response(
          JSON.stringify({
            fileName: "loom.zip",
            mimeType: "application/zip",
            contentBase64: "UEsDBA==",
            warnings: ["raw_thinking_metadata_sanitized"],
            raw_thinking: "hidden",
          }),
          { status: 200 }
        );
      },
    });

    const exportResult = await client.exportLoom({ loomId: "L-1", format: "zip" });
    expect(exportResult).toMatchObject({
      fileName: "loom.zip",
      mimeType: "application/zip",
      contentBase64: "UEsDBA==",
      warnings: ["raw_thinking_metadata_sanitized"],
    });
    expect(JSON.stringify(exportResult)).not.toContain("hidden");
  });

  test("Rust HTTP client calls Response export endpoint", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:17633/exports/response");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          responseId: "R-1",
          format: "markdown",
        });
        return new Response(
          JSON.stringify({
            fileName: "response.md",
            mimeType: "text/markdown",
            contentBase64: "UmVzcG9uc2U=",
            warnings: [],
          }),
          { status: 200 }
        );
      },
    });

    await expect(client.exportResponse({ responseId: "R-1", format: "markdown" })).resolves.toMatchObject({
      fileName: "response.md",
    });
  });

  test("rust-service export does not fallback when service is unavailable", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        undefined,
        async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        }
      ),
      localDependencies: {
        exportLoom: async () => ({
          fileName: "fallback.md",
          mimeType: "text/markdown",
          contentBase64: "RmFsbGJhY2s=",
          warnings: [],
        }),
      },
    });

    await expect(engine.exportLoom({ loomId: "L-1", format: "markdown" })).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("rust-service mode ignores legacy export fallback dependencies", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        undefined,
        async () => {
          throw new RustHttpLoomEngineError("service_unavailable", "service down");
        }
      ),
      localDependencies: {
        exportLoom: async () => ({
          fileName: "fallback.md",
          mimeType: "text/markdown",
          contentBase64: "RmFsbGJhY2s=",
          warnings: [],
        }),
      },
    });

    await expect(engine.exportLoom({ loomId: "L-1", format: "markdown" })).rejects.toMatchObject({
      kind: "service_unavailable",
    });
  });

  test("strict authoritative rust-service exports seeded Loom and Response without fallback", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      strictRustService: true,
      serviceExportStoreAuthoritative: true,
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        undefined,
        async () => ({
          fileName: "loom-weft-aware-loom-graph-c-graph-map.json",
          mimeType: "application/json; charset=utf-8",
          contentBase64: "eyJsb29tIjp7fX0=",
          warnings: [],
        }),
        async () => ({
          fileName: "response-address-bar-as-local-ai-web-navigator-r-address-bar.md",
          mimeType: "text/markdown; charset=utf-8",
          contentBase64: "IyBBZGRyZXNzIEJhcg==",
          warnings: [],
        })
      ),
      localDependencies: {},
    });

    const loomExport = await engine.exportLoom({ loomId: "c-graph-map", format: "json" });
    const responseExport = await engine.exportResponse({
      responseId: "r-address-bar",
      format: "markdown",
    });

    expect(loomExport.fileName).toContain("c-graph-map");
    expect(loomExport.fallbackUsed).toBeUndefined();
    expect(responseExport.fileName).toContain("r-address-bar");
    expect(responseExport.fallbackUsed).toBeUndefined();
  });

  test("rust-service export not found is final", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        undefined,
        async () => {
          throw new RustHttpLoomEngineError("unsupported_method", "not found", { status: 404 });
        }
      ),
      localDependencies: {
        exportLoom: async () => ({
          fileName: "local.md",
          mimeType: "text/markdown",
          contentBase64: "TG9jYWw=",
          warnings: [],
        }),
      },
    });

    await expect(engine.exportLoom({ loomId: "L-1", format: "markdown" })).rejects.toMatchObject({
      kind: "unsupported_method",
    });
  });

  test("authoritative rust-service export not found is final", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      serviceExportStoreAuthoritative: true,
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        undefined,
        async () => {
          throw new RustHttpLoomEngineError("unsupported_method", "not found", { status: 404 });
        }
      ),
      localDependencies: {
        exportLoom: async () => ({
          fileName: "local.md",
          mimeType: "text/markdown",
          contentBase64: "TG9jYWw=",
          warnings: [],
        }),
      },
    });

    await expect(engine.exportLoom({ loomId: "missing", format: "markdown" })).rejects.toMatchObject({
      kind: "unsupported_method",
    });
  });

  test("rust-service export validation error is not hidden by fallback", async () => {
    const engine = createLoomEngineClient({
      mode: "rust-service",
      rustClient: createMockRustClient(
        async () => unsupportedMockMethod("resolveAddress"),
        undefined,
        async () => {
          throw new RustHttpLoomEngineError("request_failed", "bad request", { status: 400 });
        }
      ),
      localDependencies: {
        exportLoom: async () => ({
          fileName: "local.md",
          mimeType: "text/markdown",
          contentBase64: "TG9jYWw=",
          warnings: [],
        }),
      },
    });

    await expect(engine.exportLoom({ loomId: "L-1", format: "markdown" })).rejects.toMatchObject({
      kind: "request_failed",
    });
  });

  test("Rust HTTP client parses read-only service config and capability summary", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return new Response(
            JSON.stringify({
              status: "ready",
              runtime: "loom-service",
              version: "0.1.0",
              database: { status: "ready" },
              config: { status: "ready", path: "/tmp/loom-service.toml" },
              providers: {
                ollama: {
                  status: "degraded",
                  baseUrl: "http://127.0.0.1:11434",
                  version: "0.16.9",
                  security: {
                    localOnly: true,
                    remoteAllowed: false,
                    networkExposureRisk: "low",
                    versionStatus: "vulnerable",
                    minimumRecommendedVersion: "0.17.1",
                    warnings: ["Ollama version may be vulnerable. Update to 0.17.1 or newer."],
                    raw_thinking: "hidden",
                  },
                },
              },
              fingerprint: {
                packageVersion: "0.1.0",
                serviceStartTime: "2026-06-04T12:00:00Z",
                processId: 1234,
                runtimeOwnerKind: "dev",
                binaryPath: "/path/to/binary",
                binarySizeBytes: 987654,
                binaryModifiedAt: "2026-06-04T11:59:00Z",
                binaryInode: 112233,
                buildProfile: "debug",
              },
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/config")) {
          return new Response(
            JSON.stringify({
              database: { path: "/tmp/loom.sqlite" },
              speech: {
                enabled: true,
                defaultProviderKind: "local_command",
                allowCloudStt: false,
                persistAudio: false,
                persistTranscript: false,
                maxAudioBytes: 10485760,
                allowedMimeTypes: ["audio/webm"],
                defaultLanguage: null,
                providerProfileId: null,
                localCommandPath: "",
                localCommandArgs: ["-m", "/path/to/ggml-base.en.bin", "-f", "{input}", "-otxt", "-of", "{output}"],
                localCommandTimeoutMs: 120000,
                localTempDir: null,
                localCommandOutputMode: "file",
                localCommandTranscriptFileExtension: "txt",
                warnings: [],
              },
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/runtime/restart-status")) {
          return new Response(
            JSON.stringify({ restartRequired: false, pendingRestart: false }),
            { status: 200 }
          );
        }
        if (url.endsWith("/capabilities/system")) {
          return new Response(
            JSON.stringify({
              osName: "macos",
              arch: "aarch64",
              cpuBrand: "Apple",
              totalMemoryBytes: 34359738368,
              raw_thinking: "hidden",
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/capabilities/models")) {
          return new Response(
            JSON.stringify([
              {
                provider: "ollama",
                modelName: "qwen3.5:9b",
                confidence: "medium",
                source: "curated_seed",
                thinking_text: "hidden",
              },
            ]),
            { status: 200 }
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    await expect(client.getServiceHealth()).resolves.toMatchObject({
      status: "ready",
      runtime: "rust-service",
      database: { status: "ready" },
      config: { status: "ready", path: "/tmp/loom-service.toml" },
      providers: {
        ollama: {
          status: "degraded",
          version: "0.16.9",
          security: {
            localOnly: true,
            versionStatus: "vulnerable",
            minimumRecommendedVersion: "0.17.1",
          },
        },
      },
      fingerprint: {
        packageVersion: "0.1.0",
        serviceStartTime: "2026-06-04T12:00:00Z",
        processId: 1234,
        runtimeOwnerKind: "dev",
        binaryPath: "/path/to/binary",
        binarySizeBytes: 987654,
        binaryModifiedAt: "2026-06-04T11:59:00Z",
        binaryInode: 112233,
        buildProfile: "debug",
      },
    });
    const health = await client.getServiceHealth();
    expect(JSON.stringify(health)).not.toContain("raw_thinking");
    await expect(client.getServiceConfigStatus()).resolves.toMatchObject({
      status: "ready",
      path: "/tmp/loom.sqlite",
      restartRequired: false,
      pendingRestart: false,
    });
    await expect(client.getServiceConfig()).resolves.toMatchObject({
      database: { path: "/tmp/loom.sqlite" },
      speech: {
        enabled: true,
        defaultProviderKind: "local_command",
        allowCloudStt: false,
        persistAudio: false,
        persistTranscript: false,
        localCommandPath: "",
        localCommandArgs: ["-m", "/path/to/ggml-base.en.bin", "-f", "{input}", "-otxt", "-of", "{output}"],
        localCommandTimeoutMs: 120000,
        localCommandOutputMode: "file",
        localCommandTranscriptFileExtension: "txt",
      },
    });
    const capability = await client.getCapabilitySummary();
    expect(capability).toMatchObject({
      status: "ready",
      system: { osName: "macos", arch: "aarch64" },
      models: [{ provider: "ollama", modelName: "qwen3.5:9b" }],
      strategyAvailable: true,
    });
    expect(JSON.stringify(capability)).not.toContain("raw_thinking");
    expect(JSON.stringify(capability)).not.toContain("thinking_text");
  });

  test("Rust HTTP read-only status returns unavailable instead of throwing", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async () => {
        throw new TypeError("connection refused");
      },
    });

    await expect(client.getServiceHealth()).resolves.toMatchObject({ status: "unavailable" });
    await expect(client.getServiceConfigStatus()).resolves.toMatchObject({ status: "unavailable" });
    await expect(client.getCapabilitySummary()).resolves.toMatchObject({ status: "unavailable" });
  });

  test("Rust HTTP client maps service-owned model runtime endpoints", async () => {
    const calls: string[] = [];
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        calls.push(`${init?.method ?? "GET"} ${String(input)}`);
        const url = String(input);
        if (url.endsWith("/runtime/models") && !init?.method) {
          return jsonResponse({
            provider: {
              providerKind: "ollama",
              providerProfileId: "ollama-local",
              status: "ready",
              runtimeOwnedBy: "external_ollama",
              supportsDownloads: true,
              supportsStart: false,
              supportsStop: false,
              warnings: [],
            },
            models: [
              {
                assetId: "ollama:ollama-local:qwen3.5:9b",
                providerKind: "ollama",
                providerProfileId: "ollama-local",
                modelName: "qwen3.5:9b",
                displayName: "Qwen 3.5 9B",
                installed: false,
                status: "missing",
                supportsQuick: true,
                supportsMain: true,
                supportsThinking: true,
                source: "curated_manifest",
              },
            ],
            jobs: [],
          });
        }
        if (url.endsWith("/runtime/models/qwen3.5%3A9b/download")) {
          expect(init?.method).toBe("POST");
          return jsonResponse({
            job: {
              jobId: "job-1",
              providerKind: "ollama",
              providerProfileId: "ollama-local",
              modelName: "qwen3.5:9b",
              status: "queued",
              progressPercent: 0,
              cancelRequested: false,
              metadataJson: {},
              createdAt: "1",
              updatedAt: "1",
            },
          });
        }
        if (url.endsWith("/runtime/downloads/job-1/cancel")) {
          expect(init?.method).toBe("POST");
          return jsonResponse({
            jobId: "job-1",
            providerKind: "ollama",
            modelName: "qwen3.5:9b",
            status: "cancelled",
            progressPercent: 12,
            cancelRequested: true,
            metadataJson: {},
            createdAt: "1",
            updatedAt: "2",
          });
        }
        return jsonResponse({}, 404);
      },
    });

    await expect(client.getRuntimeModels()).resolves.toMatchObject({
      provider: { providerKind: "ollama", supportsDownloads: true },
      models: [{ modelName: "qwen3.5:9b", supportsQuick: true, supportsMain: true }],
    });
    const job = await client.startModelDownload("qwen3.5:9b");
    expect(job.status).toBe("queued");
    await expect(client.cancelModelDownload(job.jobId)).resolves.toMatchObject({
      status: "cancelled",
      cancelRequested: true,
    });
    expect(calls).toContain("GET http://127.0.0.1:17633/runtime/models");
    expect(calls).toContain("POST http://127.0.0.1:17633/runtime/models/qwen3.5%3A9b/download");
  });

  test("Rust HTTP client patches speech config through the service config boundary", async () => {
    let capturedBody: unknown;
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/config") && init?.method === "PATCH") {
          capturedBody = init.body ? JSON.parse(String(init.body)) : undefined;
          return new Response(
            JSON.stringify({
              config: {
                database: { path: "/tmp/loom.sqlite" },
                speech: {
                  enabled: true,
                  defaultProviderKind: "local_command",
                  allowCloudStt: false,
                  persistAudio: false,
                  persistTranscript: false,
                  maxAudioBytes: 10485760,
                  allowedMimeTypes: ["audio/webm"],
                  defaultLanguage: null,
                  providerProfileId: null,
                  localCommandPath: "/usr/local/bin/whisper-cli",
                  localCommandArgs: ["-m", "/models/ggml-base.en.bin", "-f", "{input}", "-otxt", "-of", "{output}"],
                  localCommandTimeoutMs: 120000,
                  localTempDir: null,
                  localCommandOutputMode: "file",
                  localCommandTranscriptFileExtension: "txt",
                  warnings: [],
                },
              },
              restartClassification: {
                restartRequired: false,
                reason: null,
                changedPaths: ["speech.localCommandPath"],
              },
              restartStatus: { restartRequired: false, pendingRestart: false },
            }),
            { status: 200 }
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    const result = await client.updateServiceConfig({
      speech: {
        enabled: true,
        defaultProviderKind: "local_command",
        localCommandPath: "/usr/local/bin/whisper-cli",
        localCommandArgs: ["-m", "/models/ggml-base.en.bin", "-f", "{input}", "-otxt", "-of", "{output}"],
        localCommandTimeoutMs: 120000,
        localTempDir: null,
        localCommandOutputMode: "file",
        localCommandTranscriptFileExtension: "txt",
      },
    });

    expect(capturedBody).toMatchObject({
      speech: {
        defaultProviderKind: "local_command",
        localCommandPath: "/usr/local/bin/whisper-cli",
      },
    });
    expect(JSON.stringify(capturedBody)).not.toContain("mock_test");
    expect(result.config.speech).toMatchObject({
      defaultProviderKind: "local_command",
      localCommandPath: "/usr/local/bin/whisper-cli",
      localCommandOutputMode: "file",
      localCommandTranscriptFileExtension: "txt",
      persistAudio: false,
      persistTranscript: false,
    });
  });

  test("Rust HTTP client reads speech provider health", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://127.0.0.1:17633",
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/speech/provider/health")) {
          return new Response(
            JSON.stringify({
              status: "missing_command",
              providerKind: "local_command",
              message:
                "Speech-to-Text is not configured yet. Open Settings → Capability → Speech-to-Text and run Auto-configure.",
              checks: [],
            }),
            { status: 200 }
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    await expect(client.getSpeechProviderHealth()).resolves.toMatchObject({
      status: "missing_command",
      providerKind: "local_command",
      message:
        "Speech-to-Text is not configured yet. Open Settings → Capability → Speech-to-Text and run Auto-configure.",
    });
  });

  test("sanitizes raw thinking fields from engine events", () => {
    const event = sanitizeEngineResponseEvent({
      type: "status",
      payload: {
        message: "Thinking status only",
        raw_thinking: "hidden text",
        nested: {
          thinking_text: "hidden nested text",
          durationMs: 10,
        },
      } as unknown as { message: string },
    });
    expect(JSON.stringify(event)).not.toContain("hidden text");
    expect(JSON.stringify(event)).not.toContain("thinking_text");
    expect(JSON.stringify(event)).toContain("durationMs");
  });
});
