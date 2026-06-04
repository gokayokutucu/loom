// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, strict rust-service UI flow.
// - Provider calls use a local fake OpenAI-compatible HTTP server, not TypeScript-local mode or external APIs.
// - Test data is created through product composer flows and cleaned up by the harness.
import { expect, type Page, test } from "@playwright/test";
import {
  startFakeOpenAiCompatibleServer,
  type FakeOpenAiCompatibleServer,
} from "./helpers/fakeOpenAiCompatibleServer";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

const FORBIDDEN_MARKERS = [
  "raw_thinking",
  "thinking_text",
  "chain_of_thought",
  "hidden_reasoning",
  "nvapi-fake-secret-e2e",
  "Authorization: Bearer",
  "Bearer nvapi",
];

interface RawLoomDetail {
  loom: {
    responses: Array<{
      role: "user" | "assistant";
      content: string;
      metadata?: unknown;
    }>;
  };
}

async function fillPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
}

async function startNvidiaScenario() {
  const fakeProvider = await startFakeOpenAiCompatibleServer("nvidia-normal");
  const serviceScenario = await createServiceTestHarness({
    deterministicProvider: "nvidia-openai-compatible",
    openAiCompatibleBaseUrl: fakeProvider.baseUrl,
    openAiCompatibleApiKey: "nvapi-fake-secret-e2e",
    requestTimeoutMs: 60_000,
    startApp: true,
  });
  return { fakeProvider, serviceScenario };
}

async function cleanupNvidiaScenario(input: {
  fakeProvider: FakeOpenAiCompatibleServer;
  serviceScenario: Awaited<ReturnType<typeof createServiceTestHarness>>;
}) {
  const cleanup = await input.serviceScenario.cleanup();
  await input.fakeProvider.close();
  expect(cleanup.serviceStopped).toBe(true);
  expect(cleanup.appStopped).toBe(true);
  expect(cleanup.tempDirRemoved).toBe(true);
  expect(cleanup.warnings).toEqual([]);
}

async function openStrictRustApp(page: Page, appUrl: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "loom-ai-app-settings-v1",
      JSON.stringify({ mockDataEnabled: false, modelResponseMode: "instant" })
    );
  });
  await page.goto(appUrl);
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

function responseStatus(metadata: unknown) {
  return metadata && typeof metadata === "object" && "status" in metadata
    ? String(metadata.status)
    : undefined;
}

function assertNoForbiddenMarkers(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const marker of FORBIDDEN_MARKERS) {
    expect(serialized).not.toContain(marker);
  }
}

test.describe("[product-service-backed] NVIDIA OpenAI-compatible ProviderPipeline POC", () => {
  test("routes explicit enabled NVIDIA profile through native OpenAI-compatible ProviderPipeline", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await startNvidiaScenario();

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      const prompt = `NVIDIA OpenAI-compatible provider proof ${Date.now()}`;
      await fillPrompt(page, prompt);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.locator(".assistant-message").last()).toContainText(
        "NVIDIA OpenAI-compatible visible stream persisted.",
        { timeout: 30_000 }
      );
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Final visible NVIDIA delta.",
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 20_000,
      });
      assertNoForbiddenMarkers(await page.locator("body").textContent());

      expect(scenario.fakeProvider.requests).toHaveLength(1);
      expect(scenario.fakeProvider.requests[0]).toMatchObject({
        model: "nvidia/e2e-openai-compatible",
        stream: true,
        completed: true,
        closedBeforeDone: false,
        apiKeyLeakedInPrompt: false,
        authorizationHeaderPresent: true,
        rawAuthorizationHeaderStored: false,
      });
      expect(scenario.fakeProvider.requests[0].promptText).toContain(prompt);

      const [loom] = await scenario.serviceScenario.client.listLooms();
      const detail = await scenario.serviceScenario.fetchJson<RawLoomDetail>(
        `/looms/${encodeURIComponent(loom.loomId)}`
      );
      const assistant = detail.loom.responses.find((response) => response.role === "assistant");
      expect(assistant?.content).toContain("NVIDIA OpenAI-compatible visible stream persisted.");
      expect(responseStatus(assistant?.metadata)).toBe("completed");
      assertNoForbiddenMarkers(detail);

      const mapped = await scenario.serviceScenario.client.getLoom(loom.loomId);
      expect(mapped.responses[0].serviceGenerationStatus).toBe("completed");
      assertNoForbiddenMarkers(mapped);
    } finally {
      await cleanupNvidiaScenario(scenario);
    }
  });
});
