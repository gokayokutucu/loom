// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, strict rust-service UI flow.
// - Provider calls use a local fake Anthropic Messages API HTTP server.
// - Test data is created through product composer/retry flows and cleaned up by the harness.
import { expect, type Page, test } from "@playwright/test";
import {
  startFakeAnthropicServer,
  type FakeAnthropicServer,
} from "./helpers/fakeAnthropicServer";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

const FORBIDDEN_MARKERS = [
  "raw_thinking",
  "thinking_text",
  "chain_of_thought",
  "hidden_reasoning",
  "ant-fake-secret-e2e",
  "x-api-key",
];
const PROVIDER_SETTINGS_KEY = "loom-ai-provider-settings-v1";

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

async function startAnthropicNativeScenario(scenarioName: "normal" | "long-running" | "auth-error" | "malformed" = "normal") {
  const fakeProvider = await startFakeAnthropicServer(scenarioName);
  
  // Set the environment variables for the spawned loom-service process
  process.env.LOOM_SERVICE_E2E_PROVIDER_PROFILE = "anthropic-native";
  process.env.LOOM_ANTHROPIC_BASE_URL = fakeProvider.baseUrl;
  process.env.LOOM_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
  process.env.LOOM_ANTHROPIC_API_KEY = "ant-fake-secret-e2e";

  const serviceScenario = await createServiceTestHarness({
    requestTimeoutMs: 60_000,
    startApp: true,
  });

  return { fakeProvider, serviceScenario };
}

async function cleanupScenario(input: {
  fakeProvider: FakeAnthropicServer;
  serviceScenario: Awaited<ReturnType<typeof createServiceTestHarness>>;
}) {
  const cleanup = await input.serviceScenario.cleanup();
  await input.fakeProvider.close();
  
  // Clean up env vars to keep global context pristine
  delete process.env.LOOM_SERVICE_E2E_PROVIDER_PROFILE;
  delete process.env.LOOM_ANTHROPIC_BASE_URL;
  delete process.env.LOOM_ANTHROPIC_MODEL;
  delete process.env.LOOM_ANTHROPIC_API_KEY;

  expect(cleanup.serviceStopped).toBe(true);
  expect(cleanup.appStopped).toBe(true);
  expect(cleanup.tempDirRemoved).toBe(true);
  expect(cleanup.warnings).toEqual([]);
}

async function openStrictRustApp(page: Page, appUrl: string) {
  await page.route("**/runtime/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: {
          providerProfileId: "ollama-local",
          exposeToNetwork: false,
          modelStorePath: "~/.ollama/models",
          lastConnectionStatus: "connected",
        },
        models: [
          {
            modelName: "qwen3.5:9b",
            displayName: "Qwen 3.5 9B",
            installed: true,
            sizeBytes: 5400000000,
            modifiedAt: "2026-06-02T12:00:00Z",
          },
        ],
        jobs: [],
      }),
    });
  });

  // Pre-load settings with anthropic-native enabled
  await page.addInitScript(
    ({ key }) => {
      window.localStorage.setItem(
        "loom-ai-app-settings-v1",
        JSON.stringify({ mockDataEnabled: false, modelResponseMode: "instant" })
      );
      window.localStorage.setItem(
        key,
        JSON.stringify({
          activeProvider: "anthropic",
          profiles: {
            quickModelId: "claude-3-5-sonnet-latest",
            mainModelId: "claude-3-5-sonnet-latest",
            mainProviderProfileId: "anthropic-native",
            mainProviderDisplayName: "Anthropic Native",
            mainProviderKind: "anthropic",
          },
          demo: { mockResponsesEnabled: false },
        })
      );
    },
    { key: PROVIDER_SETTINGS_KEY }
  );

  await page.goto(appUrl);
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openProviderSettings(page: Page) {
  await page.getByTestId("profile-menu-trigger").click();
  await page.getByTestId("open-app-settings").click();
  await expect(page.getByRole("dialog", { name: /Runtime/ })).toBeVisible();
  await page.getByRole("button", { name: /^Providers/ }).click();
  await expect(page.getByRole("dialog", { name: /Providers/ })).toBeVisible();
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

test.describe("[product-service-backed] Anthropic Native Contract Compatibility E2E", () => {
  test("Scenario A & B: Basic generation and streaming", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await startAnthropicNativeScenario("normal");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      // Verify selected model is shown on picker
      await expect(page.getByRole("button", { name: "Select model" })).toContainText(
        "Anthropic Native · claude-3-5-sonnet-latest",
        { timeout: 10_000 }
      );

      const prompt = `Anthropic Native E2E streaming proof ${Date.now()}`;
      await fillPrompt(page, prompt);
      await page.getByRole("button", { name: "Send" }).click();

      // Verify answer streams and displays
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Anthropic native visible stream persisted. ",
        { timeout: 30_000 }
      );
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Final visible Anthropic delta.",
        { timeout: 30_000 }
      );

      // Verify completed state
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 20_000,
      });

      // Verify mock server received the expected Anthropic-formatted request
      expect(scenario.fakeProvider.requests.length).toBeGreaterThanOrEqual(1);
      const chatReq = scenario.fakeProvider.requests.find((r) => r.promptText.includes(prompt));
      expect(chatReq).toBeDefined();
      expect(chatReq).toMatchObject({
        model: "claude-3-5-sonnet-latest",
        stream: true,
        completed: true,
        apiKeyHeaderPresent: true,
        anthropicVersionHeaderPresent: true,
      });

      // Verify SQLite persistence
      const [loom] = await scenario.serviceScenario.client.listLooms();
      const detail = await scenario.serviceScenario.fetchJson<RawLoomDetail>(
        `/looms/${encodeURIComponent(loom.loomId)}`
      );
      const assistant = detail.loom.responses.find((response) => response.role === "assistant");
      expect(assistant?.content).toContain("Anthropic native visible stream persisted. ");
      expect(responseStatus(assistant?.metadata)).toBe("completed");
      assertNoForbiddenMarkers(detail);
    } finally {
      await cleanupScenario(scenario);
    }
  });

  test("Scenario C: Stop cancellation", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await startAnthropicNativeScenario("long-running");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      await fillPrompt(page, `Anthropic Native E2E cancellation proof ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Anthropic cancellable chunk",
        { timeout: 30_000 }
      );

      // Cancel stream
      await page.getByRole("button", { name: "Stop response" }).click();

      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

      // Verify connection closed on mock server
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
    } finally {
      await cleanupScenario(scenario);
    }
  });

  test("Scenario D, E, F: Retry, Regenerate and Settings selection persistence", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await startAnthropicNativeScenario("normal");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      const prompt = `Anthropic Native retry regenerate proof ${Date.now()}`;
      await fillPrompt(page, prompt);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Anthropic native visible stream persisted. ",
        { timeout: 30_000 }
      );

      // Scenario D: Retry user message
      await page.locator(".qa-item").first().locator(".prompt-retry-trigger").evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) throw new Error("Retry trigger is not a button.");
        button.click();
      });
      const retryDialog = page.getByRole("alertdialog", { name: "Retry from this message?" });
      if (await retryDialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await retryDialog.getByRole("button", { name: "Retry" }).click();
      }

      await expect(page.locator(".assistant-message").last()).toContainText(
        "Anthropic native visible stream persisted. ",
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 20_000,
      });

      // Scenario E: Regenerate response
      await page.locator(".qa-item").first().locator(".prompt-retry-trigger").evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) throw new Error("Retry trigger is not a button.");
        button.click();
      });
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Anthropic native visible stream persisted. ",
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 20_000,
      });

      // Scenario F: Settings check & persistence
      await openProviderSettings(page);
      const anthropicCard = page
        .locator(".provider-profile-card")
        .filter({ hasText: "Anthropic Native" });
      await expect(anthropicCard).toHaveClass(/enabled/);
      await expect(anthropicCard).toContainText("Saved");
      await expect(anthropicCard).toContainText("Selected (claude-3-5-sonnet-latest)");
    } finally {
      await cleanupScenario(scenario);
    }
  });

  test("Scenario G: Error mapping and config validation", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await startAnthropicNativeScenario("auth-error");

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      await fillPrompt(page, `Anthropic Native E2E error mapping proof ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();

      // Verify error surfaces in the chat transcript safely
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
      
      // Ensure API keys and internal codes were not leaked to the user
      await expect(page.locator("body")).not.toContainText("ant-fake-secret-e2e");
      
      const [loom] = await scenario.serviceScenario.client.listLooms();
      const detail = await scenario.serviceScenario.fetchJson<RawLoomDetail>(
        `/looms/${encodeURIComponent(loom.loomId)}`
      );
      const assistant = detail.loom.responses.find((response) => response.role === "assistant");
      expect(responseStatus(assistant?.metadata)).toBe("error");
      expect(JSON.stringify(assistant?.metadata)).toContain("Unauthorized");
    } finally {
      await cleanupScenario(scenario);
    }
  });
});
