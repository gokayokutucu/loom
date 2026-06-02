// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, strict rust-service UI flow.
// - Provider calls use a local fake Ollama HTTP server, not TypeScript-local mode or external APIs.
// - Test data is created through product composer/retry flows and cleaned up by the harness.
import { expect, type Page, test } from "@playwright/test";
import {
  startFakeOllamaServer,
  type FakeOllamaServer,
  type FakeOllamaScenario,
} from "./helpers/fakeOllamaServer";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

const FORBIDDEN_RAW_THINKING_MARKERS = [
  "raw_thinking",
  "thinking_text",
  "chain_of_thought",
  "hidden_reasoning",
  "sk-secret-provider",
  "hidden provider reasoning",
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

async function startPipelineScenario(scenario: FakeOllamaScenario) {
  const fakeOllama = await startFakeOllamaServer(scenario);
  const serviceScenario = await createServiceTestHarness({
    ollamaBaseUrl: fakeOllama.baseUrl,
    requestTimeoutMs: 60_000,
    startApp: true,
  });
  return { fakeOllama, serviceScenario };
}

async function cleanupPipelineScenario(input: {
  fakeOllama: FakeOllamaServer;
  serviceScenario: Awaited<ReturnType<typeof createServiceTestHarness>>;
}) {
  const cleanup = await input.serviceScenario.cleanup();
  await input.fakeOllama.close();
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

test.describe("[product-service-backed] ProviderPipeline streaming lifecycle", () => {
  test("normal streaming shows progress, persists final response, usage, and returns composer to send-ready", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await startPipelineScenario("normal");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      await fillPrompt(page, `ProviderPipeline normal streaming proof ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator(".assistant-message").last()).toContainText(
        "ProviderPipeline normal stream persisted visible answer.",
        { timeout: 30_000 }
      );
      await expect(page.locator(".assistant-message").last()).toContainText("Final visible delta.", {
        timeout: 30_000,
      });
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 20_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

      expect(scenario.fakeOllama.requests).toHaveLength(1);
      expect(scenario.fakeOllama.requests[0]).toMatchObject({
        stream: true,
        think: true,
        completed: true,
        closedBeforeDone: false,
      });

      const [loom] = await scenario.serviceScenario.client.listLooms();
      const detail = await scenario.serviceScenario.fetchJson<RawLoomDetail>(
        `/looms/${encodeURIComponent(loom.loomId)}`
      );
      const assistant = detail.loom.responses.find((response) => response.role === "assistant");
      expect(assistant?.content).toContain("ProviderPipeline normal stream persisted visible answer.");
      expect(responseStatus(assistant?.metadata)).toBe("completed");
      assertNoForbiddenRawThinking(detail);

      const mapped = await scenario.serviceScenario.client.getLoom(loom.loomId);
      expect(mapped.responses[0].serviceGenerationStatus).toBe("completed");
      expect(mapped.responses[0].inferenceTokenCount).toBe(7);

      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${loom.loomId}`).click();
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 20_000 });
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/);
      await expect(page.locator(".assistant-message").last()).toContainText("Final visible delta.");
    } finally {
      await cleanupPipelineScenario(scenario);
    }
  });

  test("stop cancels ProviderPipeline-backed stream and reload does not restore running state", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await startPipelineScenario("long-running");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      await fillPrompt(page, `ProviderPipeline stop cancellation proof ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator(".assistant-message").last()).toContainText(
        "ProviderPipeline cancellable chunk",
        { timeout: 30_000 }
      );
      await page.getByRole("button", { name: "Stop response" }).click();

      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
      await expect
        .poll(
          () => scenario.fakeOllama.requests.some((request) => request.closedBeforeDone),
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
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 20_000 });
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/);
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    } finally {
      await cleanupPipelineScenario(scenario);
    }
  });

  test("retry streams a ProviderPipeline-backed replacement while preserving the user prompt", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await startPipelineScenario("normal");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      const prompt = `ProviderPipeline retry preserves original prompt ${Date.now()}`;
      await fillPrompt(page, prompt);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toContainText(
        "ProviderPipeline normal stream persisted visible answer.",
        { timeout: 30_000 }
      );

      await page.locator(".qa-item").first().locator(".prompt-retry-trigger").evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Retry trigger is not a button.");
        }
        button.click();
      });
      const retryDialog = page.getByRole("alertdialog", { name: "Retry from this message?" });
      if (await retryDialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await retryDialog.getByRole("button", { name: "Retry" }).click();
      }

      await expect(page.locator(".assistant-message").last()).toContainText(
        "ProviderPipeline retry replacement stream persisted visible answer.",
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 20_000,
      });

      expect(scenario.fakeOllama.requests).toHaveLength(2);
      expect(scenario.fakeOllama.requests[1].promptText).toContain(prompt);

      const [loom] = await scenario.serviceScenario.client.listLooms();
      const mapped = await scenario.serviceScenario.client.getLoom(loom.loomId);
      expect(mapped.responses).toHaveLength(1);
      expect(mapped.responses[0].question).toContain(prompt);
      expect(mapped.responses[0].answer.join("\n")).toContain(
        "ProviderPipeline retry replacement stream persisted visible answer."
      );
      expect(mapped.responses[0].serviceGenerationStatus).toBe("completed");
      expect(mapped.responses[0].inferenceTokenCount).toBe(9);
      assertNoForbiddenRawThinking(mapped);
    } finally {
      await cleanupPipelineScenario(scenario);
    }
  });

  test("malformed provider stream persists safe error without leaking raw internals", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await startPipelineScenario("malformed");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      await fillPrompt(page, `ProviderPipeline malformed stream proof ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
      await expect(page.locator("body")).not.toContainText("sk-secret-provider");
      await expect(page.locator("body")).not.toContainText("hidden provider reasoning");

      const [loom] = await scenario.serviceScenario.client.listLooms();
      const detail = await scenario.serviceScenario.fetchJson<RawLoomDetail>(
        `/looms/${encodeURIComponent(loom.loomId)}`
      );
      const assistant = detail.loom.responses.find((response) => response.role === "assistant");
      expect(responseStatus(assistant?.metadata)).toBe("error");
      expect(JSON.stringify(assistant?.metadata)).toContain("StreamParseError");
      assertNoForbiddenRawThinking(detail);
    } finally {
      await cleanupPipelineScenario(scenario);
    }
  });
});
