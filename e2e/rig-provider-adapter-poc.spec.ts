// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, strict rust-service UI flow.
// - Provider calls use a local fake OpenAI-compatible HTTP server, not TypeScript-local mode or external APIs.
// - Test data is created through product composer flows and cleaned up by the harness.
import { expect, type Page, test } from "@playwright/test";
import {
  startFakeOpenAiCompatibleServer,
  type FakeOpenAiCompatibleScenario,
  type FakeOpenAiCompatibleServer,
} from "./helpers/fakeOpenAiCompatibleServer";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

const FORBIDDEN_RAW_THINKING_MARKERS = [
  "raw_thinking",
  "thinking_text",
  "chain_of_thought",
  "hidden_reasoning",
  "sk-rig-secret-e2e",
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

async function startRigScenario(scenario: FakeOpenAiCompatibleScenario) {
  const fakeProvider = await startFakeOpenAiCompatibleServer(scenario);
  const serviceScenario = await createServiceTestHarness({
    deterministicProvider: "rig-openai-compatible",
    openAiCompatibleBaseUrl: fakeProvider.baseUrl,
    openAiCompatibleApiKey: "sk-rig-secret-e2e",
    requestTimeoutMs: 60_000,
    startApp: true,
  });
  return { fakeProvider, serviceScenario };
}

async function cleanupRigScenario(input: {
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
      JSON.stringify({ mockDataEnabled: false, modelResponseMode: "thinking" })
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

function assertNoForbiddenRawThinking(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const marker of FORBIDDEN_RAW_THINKING_MARKERS) {
    expect(serialized).not.toContain(marker);
  }
}

test.describe("[product-service-backed] Rig OpenAI-compatible ProviderAdapter POC", () => {
  test("streams through ProviderPipeline, persists final response, usage, and suppresses reasoning", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await startRigScenario("normal");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      const prompt = `Rig OpenAI-compatible provider adapter proof ${Date.now()}`;
      await fillPrompt(page, prompt);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.locator(".assistant-message").last()).toContainText(
        "Rig OpenAI-compatible visible stream persisted.",
        { timeout: 30_000 }
      );
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Final visible Rig delta.",
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 20_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
      assertNoForbiddenRawThinking(await page.locator("body").textContent());

      expect(scenario.fakeProvider.requests).toHaveLength(1);
      expect(scenario.fakeProvider.requests[0]).toMatchObject({
        stream: true,
        includeUsage: true,
        completed: true,
        closedBeforeDone: false,
        apiKeyLeakedInPrompt: false,
      });
      expect(scenario.fakeProvider.requests[0].promptText).toContain(prompt);

      const [loom] = await scenario.serviceScenario.client.listLooms();
      const detail = await scenario.serviceScenario.fetchJson<RawLoomDetail>(
        `/looms/${encodeURIComponent(loom.loomId)}`
      );
      const assistant = detail.loom.responses.find((response) => response.role === "assistant");
      expect(assistant?.content).toContain("Rig OpenAI-compatible visible stream persisted.");
      expect(responseStatus(assistant?.metadata)).toBe("completed");
      assertNoForbiddenRawThinking(detail);

      const mapped = await scenario.serviceScenario.client.getLoom(loom.loomId);
      expect(mapped.responses[0].serviceGenerationStatus).toBe("completed");
      expect(mapped.responses[0].inferenceTokenCount).toBe(7);
      assertNoForbiddenRawThinking(mapped);
    } finally {
      await cleanupRigScenario(scenario);
    }
  });

  test("stop cancels the Rig stream without restoring running state after reload", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await startRigScenario("long-running");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      await fillPrompt(page, `Rig OpenAI-compatible cancel proof ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator(".assistant-message").last()).toContainText("Rig cancellable chunk", {
        timeout: 30_000,
      });
      await page.getByRole("button", { name: "Stop response" }).click();

      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
      await expect
        .poll(
          () => scenario.fakeProvider.requests.some((request) => request.closedBeforeDone),
          { timeout: 20_000 }
        )
        .toBe(true);

      const [loom] = await scenario.serviceScenario.client.listLooms();
      const detail = await scenario.serviceScenario.fetchJson<RawLoomDetail>(
        `/looms/${encodeURIComponent(loom.loomId)}`
      );
      const assistant = detail.loom.responses.find((response) => response.role === "assistant");
      expect(responseStatus(assistant?.metadata)).toBe("cancelled");
      assertNoForbiddenRawThinking(detail);

      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${loom.loomId}`).click();
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/);
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    } finally {
      await cleanupRigScenario(scenario);
    }
  });

  test("provider auth errors persist safe error state without leaking provider internals", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await startRigScenario("auth-error");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      await fillPrompt(page, `Rig OpenAI-compatible auth error proof ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
      assertNoForbiddenRawThinking(await page.locator("body").textContent());

      expect(scenario.fakeProvider.requests).toHaveLength(1);
      expect(scenario.fakeProvider.requests[0].completed).toBe(true);
      expect(scenario.fakeProvider.requests[0].apiKeyLeakedInPrompt).toBe(false);

      const [loom] = await scenario.serviceScenario.client.listLooms();
      const detail = await scenario.serviceScenario.fetchJson<RawLoomDetail>(
        `/looms/${encodeURIComponent(loom.loomId)}`
      );
      const assistant = detail.loom.responses.find((response) => response.role === "assistant");
      expect(responseStatus(assistant?.metadata)).toBe("error");
      assertNoForbiddenRawThinking(detail);
    } finally {
      await cleanupRigScenario(scenario);
    }
  });
});
