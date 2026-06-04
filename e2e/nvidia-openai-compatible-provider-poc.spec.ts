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

async function startNvidiaSettingsSelectionScenario() {
  const fakeProvider = await startFakeOpenAiCompatibleServer("nvidia-normal");
  const serviceScenario = await createServiceTestHarness({
    enabledRemoteProviderProfile: "nvidia",
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
  await page.addInitScript(
    ({ key }) => {
      window.localStorage.setItem(
        "loom-ai-app-settings-v1",
        JSON.stringify({ mockDataEnabled: false, modelResponseMode: "instant" })
      );
      window.localStorage.setItem(
        key,
        JSON.stringify({
          activeProvider: "ollama",
          ollama: {
            enabled: true,
            baseUrl: "http://localhost:11434",
            exposeToNetwork: false,
            contextLength: 8192,
            modelLocation: "~/.ollama/models",
            models: [
              {
                "id": "qwen3.5:9b",
                "name": "Qwen 3.5 9B",
                "provider": "ollama",
                "installed": true,
              },
            ],
            lastConnectionStatus: "connected",
          },
          profiles: {
            quickModelId: "qwen3.5:9b",
            mainModelId: "qwen3.5:9b",
            mainProviderProfileId: "ollama-local",
            mainProviderDisplayName: "Ollama Local",
            mainProviderKind: "ollama",
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

  test("selects enabled NVIDIA profile for Main through Settings without changing the default automatically", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await startNvidiaSettingsSelectionScenario();

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);
      const initialConfig = await scenario.serviceScenario.client.getServiceConfig();
      expect(initialConfig.providers?.mainProviderProfileId ?? undefined).toBeUndefined();
      expect(initialConfig.providers?.mainModelId ?? undefined).toBeUndefined();

      await openProviderSettings(page);
      const nvidiaCard = page
        .locator(".provider-profile-card")
        .filter({ hasText: "NVIDIA NIM" });
      await expect(nvidiaCard).toContainText("Enabled");
      await expect(nvidiaCard).toContainText("Saved");
      await expect(nvidiaCard).toContainText("Not selected");
      await nvidiaCard
        .getByLabel(/prompts and selected context may leave this device/i)
        .check();
      await nvidiaCard.getByRole("button", { name: "Use for Main" }).click();
      await expect(nvidiaCard).toContainText("Selected for Main", { timeout: 10_000 });
      await page.getByRole("button", { name: "Close settings" }).click();
      await expect(page.getByRole("button", { name: "Select model" })).toContainText(
        "NVIDIA NIM · nvidia/e2e-openai-compatible",
        { timeout: 10_000 }
      );

      const selectedConfig = await scenario.serviceScenario.client.getServiceConfig();
      expect(selectedConfig.providers).toMatchObject({
        mainProviderProfileId: "nvidia",
        mainModelId: "nvidia/e2e-openai-compatible",
      });

      const prompt = `Settings selected NVIDIA provider proof ${Date.now()}`;
      await fillPrompt(page, prompt);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.locator(".assistant-message").last()).toContainText(
        "NVIDIA OpenAI-compatible visible stream persisted.",
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
        authorizationHeaderPresent: true,
        rawAuthorizationHeaderStored: false,
      });
      expect(scenario.fakeProvider.requests[0].promptText).toContain(prompt);

      await openProviderSettings(page);
      const ollamaCard = page
        .locator(".provider-profile-card")
        .filter({ hasText: "Ollama Local" });
      await ollamaCard.getByRole("button", { name: "Use for Main" }).click();
      await expect(ollamaCard).toContainText("Selected for Main", { timeout: 10_000 });
      await page.getByRole("button", { name: "Close settings" }).click();
      await expect(page.getByRole("button", { name: "Select model" })).toContainText(
        "Qwen 3.5 9B"
      );
      const localConfig = await scenario.serviceScenario.client.getServiceConfig();
      expect(localConfig.providers).toMatchObject({
        mainProviderProfileId: "ollama-local",
        mainModelId: "qwen3.5:9b",
      });

      await fillPrompt(page, `Switch back to local proof ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();
      await page.waitForTimeout(1000);
      expect(scenario.fakeProvider.requests).toHaveLength(1);
    } finally {
      await cleanupNvidiaScenario(scenario);
    }
  });

  test("discovers models for remote profile and allows selection", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await startNvidiaSettingsSelectionScenario();

    try {
      await openStrictRustApp(page, scenario.serviceScenario.appUrl!);

      await openProviderSettings(page);
      const nvidiaCard = page
        .locator(".provider-profile-card")
        .filter({ hasText: "NVIDIA NIM" });
      await expect(nvidiaCard).toContainText("Enabled");
      await expect(nvidiaCard).toContainText("Saved");

      // Verify discovery controls
      const discoverBtn = nvidiaCard.getByRole("button", { name: /Discover models/i });
      await expect(discoverBtn).toBeVisible();
      await discoverBtn.click();

      // Wait for success status and list of models
      await expect(nvidiaCard.locator(".discovery-status-label.success")).toBeVisible({ timeout: 10_000 });
      await expect(nvidiaCard.locator(".discovered-models-list")).toBeVisible();
      await expect(nvidiaCard.locator(".discovered-models-list")).toContainText("fake-model-1");
      await expect(nvidiaCard.locator(".discovered-models-list")).toContainText("fake-model-2");

      // Acknowledge privacy warning so we can select for Main
      await nvidiaCard
        .getByLabel(/prompts and selected context may leave this device/i)
        .check();

      // Select fake-model-2
      const selectBtn = nvidiaCard.locator("li").filter({ hasText: "fake-model-2" }).getByRole("button", { name: "Select" });
      await selectBtn.click();

      // Verify the list updates to Selected for fake-model-2
      await expect(nvidiaCard.locator("li").filter({ hasText: "fake-model-2" }).getByRole("button")).toContainText("Selected");
      await expect(nvidiaCard).toContainText("Selected (fake-model-2)");

      // Close settings
      await page.getByRole("button", { name: "Close settings" }).click();

      // Check localStorage or window state
      const providerSettingsValue = await page.evaluate(() => {
        const raw = localStorage.getItem("loom-ai-provider-settings-v1");
        return raw ? JSON.parse(raw) : null;
      });


      // Verify composer model picker displays selected remote model
      const modelPickerBtn = page.getByRole("button", { name: "Select model" });
      await expect(modelPickerBtn).toContainText("NVIDIA NIM · fake-model-2");

      // Open composer picker
      await modelPickerBtn.click();
      const pickerPopover = page.locator(".model-picker-menu");

      // Verify remote model is shown in active selection and Ollama is available
      const activeItem = pickerPopover.locator("button.selected:not(.model-picker-mode-option)");
      await expect(activeItem).toContainText("NVIDIA NIM · fake-model-2");

      // Verify we can switch back to local Ollama from picker
      const localItem = pickerPopover.locator("button").filter({ hasText: "Qwen 3.5 9B" });
      await localItem.click();

      // Verify composer model picker changes to local Ollama
      await expect(modelPickerBtn).toContainText("Qwen 3.5 9B");

      const localConfig = await scenario.serviceScenario.client.getServiceConfig();
      expect(localConfig.providers).toMatchObject({
        mainProviderProfileId: "ollama-local",
        mainModelId: "qwen3.5:9b",
      });
    } finally {
      await cleanupNvidiaScenario(scenario);
    }
  });
});
