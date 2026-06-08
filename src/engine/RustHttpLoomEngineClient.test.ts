import { describe, expect, it } from "vitest";
import { RustHttpLoomEngineClient, __rustHttpLoomEngineClientTest } from "./RustHttpLoomEngineClient";
import type { AddReferenceInput } from "./LoomEngineTypes";
import type { LoomLink } from "../types";

const {
  createReferencePayload,
  loomLinkFromPlannerReference,
  loomLinkFromQuestionReference,
  mapServiceEventToEngineEvents,
  mapReferenceForService,
  referenceTargetKind,
  validateServiceReference,
  executePayload,
  regeneratePayload,
  retryPayload,
} = __rustHttpLoomEngineClientTest;

function makeLink(overrides: Partial<LoomLink> = {}): LoomLink {
  return {
    id: "loom-1",
    type: "conversation",
    title: "Reference title",
    path: "loom://reference",
    ...overrides,
  };
}

describe("RustHttpLoomEngineClient reference targetKind mapping", () => {
  it("preserves explicit targetKind values before inferring from type", () => {
    expect(referenceTargetKind(makeLink({ targetKind: "weft", type: "conversation" }))).toBe("weft");
    expect(referenceTargetKind(makeLink({ targetKind: "attachment", type: "conversation" }))).toBe("attachment");
    expect(referenceTargetKind(makeLink({ targetKind: "fragment", type: "conversation" }))).toBe("fragment");
    expect(referenceTargetKind(makeLink({ targetKind: "response", type: "conversation" }))).toBe("response");
  });

  it("infers loom only when targetKind is missing and type is Loom/conversation", () => {
    expect(referenceTargetKind(makeLink({ type: "conversation", targetKind: undefined }))).toBe("loom");
    expect(referenceTargetKind(makeLink({ type: "loom", targetKind: undefined }))).toBe("loom");
  });

  it("sends precise targetKind in planner reference payloads", () => {
    expect(mapReferenceForService(makeLink({ targetKind: "weft" })).targetKind).toBe("weft");
    expect(mapReferenceForService(makeLink({ targetKind: "attachment" })).targetKind).toBe("attachment");
    expect(mapReferenceForService(makeLink({ targetKind: "fragment" })).targetKind).toBe("fragment");
    expect(mapReferenceForService(makeLink({ targetKind: "response" })).targetKind).toBe("response");
  });

  it("sends precise targetKind when creating a service reference", () => {
    const input: AddReferenceInput = {
      loomId: "loom-1",
      reference: makeLink({
        id: "weft-1",
        targetKind: "weft",
        targetObjectId: "weft-1",
        canonicalUri: "loom://weft",
      }),
    };

    expect(createReferencePayload(input).targetKind).toBe("weft");
  });

  it("uses metadata targetKind only when the link has no explicit targetKind", () => {
    const input: AddReferenceInput = {
      loomId: "loom-1",
      reference: makeLink({
        id: "code-1",
        targetKind: "fragment",
      }),
      metadata: { targetKind: "code_block", codeBlockId: "code-1" },
    };

    expect(createReferencePayload(input).targetKind).toBe("fragment");
  });

  it("hydrates planner references with targetKind, presentationMode, and selectedText", () => {
    const link = loomLinkFromPlannerReference({
      referenceId: "ref-1",
      targetKind: "fragment",
      targetId: "response-1",
      selectedTextPreview: "selected fragment",
      presentationMode: "inline-chip",
    });

    expect(link).toMatchObject({
      type: "fragment",
      targetKind: "fragment",
      selectedText: "selected fragment",
      presentationMode: "inline-chip",
    });
  });

  it("hydrates question references with targetKind, presentationMode, and selectedText", () => {
    const link = loomLinkFromQuestionReference({
      id: "attachment-1",
      title: "sleepdeprivation.pdf",
      path: "loom://attachment/attachment-1",
      targetKind: "attachment",
      selectedText: "attachment excerpt",
      presentationMode: "attached-card",
    });

    expect(link).toMatchObject({
      type: "attachment",
      targetKind: "attachment",
      selectedText: "attachment excerpt",
      presentationMode: "attached-card",
    });
  });

  it("hydrates persisted service references without dropping targetKind", () => {
    const link = validateServiceReference(
      {
        referenceId: "ref-1",
        targetKind: "weft",
        targetId: "weft-1",
        targetUri: "loom://weft",
        label: "Human Weft",
        selectedText: "selected text",
        metadata: { presentationMode: "attached-card" },
      },
      "/references/ref-1"
    );

    expect(link).toMatchObject({
      type: "loom",
      targetKind: "weft",
      selectedText: "selected text",
      presentationMode: "attached-card",
    });
  });
});

describe("RustHttpLoomEngineClient streaming event mapping", () => {
  it("maps transient thinking deltas without requiring a response id", () => {
    expect(
      mapServiceEventToEngineEvents({
        type: "orchestration.progress",
        payload: {
          runId: "run-1",
          thinkingDelta: "Reviewing context.\n",
          transient: true,
        },
      })
    ).toEqual([
      {
        type: "thinking_delta",
        payload: { delta: "Reviewing context.\n" },
      },
    ]);
  });
});

describe("RustHttpLoomEngineClient provider profile and secret mapping", () => {
  it("hydrates provider profiles from service config", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://loom-service.test",
      fetch: async () =>
        new Response(
          JSON.stringify({
            speech: {
              enabled: false,
              defaultProviderKind: "disabled",
              allowCloudStt: false,
              persistAudio: false,
              persistTranscript: false,
              maxAudioBytes: 0,
              allowedMimeTypes: [],
              localCommandArgs: [],
              localCommandTimeoutMs: 0,
              localCommandOutputMode: "stdout",
              localCommandTranscriptFileExtension: "txt",
              warnings: [],
            },
            providers: {
              defaultMainModel: "qwen",
              defaultQuickModel: "qwen",
              mainProviderProfileId: "nvidia",
              mainModelId: "meta/llama-3.1-70b-instruct",
              profiles: [
                {
                  id: "nvidia",
                  providerKind: "openai_compatible",
                  transportKind: "native_openai_compatible",
                  vendor: "nvidia",
                  displayName: "NVIDIA NIM",
                  enabled: false,
                  experimental: true,
                  baseUrl: "https://integrate.api.nvidia.com/v1",
                  defaultModel: "meta/llama-3.1-70b-instruct",
                  requiresSecret: true,
                  secretRef: "env:NVIDIA_API_KEY",
                  modelDiscovery: {
                    enabled: true,
                    endpointPath: "/models",
                    refreshIntervalSeconds: 3600,
                  },
                  requestDefaults: { think: false, stream: true },
                  security: {
                    localOnlyRequired: false,
                    allowRemoteEndpoint: true,
                    allowInsecureHttpRemote: false,
                    allowUnsafeModelManagement: false,
                  },
                  capabilities: {
                    supportsStreaming: true,
                    supportsCancellation: false,
                    supportsModelListing: true,
                    supportsThinking: false,
                    supportsSystemPrompt: true,
                    supportsJsonMode: true,
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });

    const config = await client.getServiceConfig();

    expect(config.providers).toMatchObject({
      defaultMainModel: "qwen",
      defaultQuickModel: "qwen",
      mainProviderProfileId: "nvidia",
      mainModelId: "meta/llama-3.1-70b-instruct",
    });
    expect(config.providers?.profiles?.[0]).toMatchObject({
      id: "nvidia",
      providerKind: "openai_compatible",
      transportKind: "native_openai_compatible",
      vendor: "nvidia",
      requiresSecret: true,
      secretRef: "env:NVIDIA_API_KEY",
    });
  });

  it("uses provider secret endpoints without exposing raw secrets in returned status", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://loom-service.test",
      fetch: async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            providerProfileId: "nvidia",
            secretRef: "env:NVIDIA_API_KEY",
            present: true,
            status: "saved",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    });

    const status = await client.setProviderSecret(
      "nvidia",
      "nvapi-raw-secret",
      "env:NVIDIA_API_KEY"
    );
    await client.getProviderSecretStatus("nvidia");
    await client.testProviderSecret("nvidia", "env:NVIDIA_API_KEY");
    await client.deleteProviderSecret("nvidia");

    expect(status).toEqual({
      providerProfileId: "nvidia",
      secretRef: "env:NVIDIA_API_KEY",
      present: true,
      status: "saved",
    });
    expect(JSON.stringify(status)).not.toContain("nvapi-raw-secret");
    expect(calls.map((call) => [call.url, call.init?.method ?? "GET"])).toEqual([
      ["http://loom-service.test/providers/secrets/nvidia", "PUT"],
      ["http://loom-service.test/providers/secrets/nvidia", "GET"],
      ["http://loom-service.test/providers/secrets/nvidia/test", "POST"],
      ["http://loom-service.test/providers/secrets/nvidia", "DELETE"],
    ]);
  });

  it("maps safe per-profile runtime provider statuses", async () => {
    const client = new RustHttpLoomEngineClient({
      serviceUrl: "http://loom-service.test",
      fetch: async () =>
        new Response(
          JSON.stringify([
            {
              providerKind: "openai_compatible",
              providerProfileId: "nvidia",
              displayName: "NVIDIA NIM",
              transportKind: "native_openai_compatible",
              vendor: "nvidia",
              enabled: true,
              experimental: true,
              requiresSecret: true,
              secretStatus: "missing",
              runtimeStatus: "missing_secret",
              status: "missing_secret",
              baseUrl: "https://integrate.api.nvidia.com/v1",
              defaultModel: "meta/llama-3.1-70b-instruct",
              modelsEndpointReachable: false,
              runtimeOwnedBy: "external_provider",
              supportsDownloads: false,
              supportsStart: false,
              supportsStop: false,
              warnings: [],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });

    await expect(client.getRuntimeProviders()).resolves.toEqual([
      expect.objectContaining({
        providerKind: "openai_compatible",
        providerProfileId: "nvidia",
        runtimeStatus: "missing_secret",
        secretStatus: "missing",
        requiresSecret: true,
      }),
    ]);
  });
});

describe("RustHttpLoomEngineClient payload serialization with providerProfileId", () => {
  it("includes providerProfileId in executePayload if provided", () => {
    const payload = executePayload({
      loomId: "loom-1",
      promptText: "hello",
      references: [],
      responseMode: "instant",
      source: "composer",
      model: "qwen",
      providerProfileId: "litellm-sandbox",
    });

    expect(payload).toMatchObject({
      loomId: "loom-1",
      prompt: "hello",
      model: "qwen",
      providerProfileId: "litellm-sandbox",
    });
  });

  it("omits providerProfileId in executePayload if undefined", () => {
    const payload = executePayload({
      loomId: "loom-1",
      promptText: "hello",
      references: [],
      responseMode: "instant",
      source: "composer",
      model: "qwen",
      providerProfileId: undefined,
    });

    expect(payload).toHaveProperty("model", "qwen");
    expect(payload.providerProfileId).toBeUndefined();
    // In JSON, undefined keys are omitted:
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty("providerProfileId");
  });

  it("includes providerProfileId in regeneratePayload if provided", () => {
    const payload = regeneratePayload({
      loomId: "loom-1",
      userResponseId: "user-1",
      responseMode: "instant",
      model: "qwen",
      providerProfileId: "litellm-sandbox",
    });

    expect(payload).toMatchObject({
      model: "qwen",
      providerProfileId: "litellm-sandbox",
    });
  });

  it("includes providerProfileId in retryPayload if provided", () => {
    const payload = retryPayload({
      loomId: "loom-1",
      userResponseId: "user-1",
      responseMode: "instant",
      model: "qwen",
      providerProfileId: "litellm-sandbox",
    });

    expect(payload).toMatchObject({
      model: "qwen",
      providerProfileId: "litellm-sandbox",
    });
  });
});
