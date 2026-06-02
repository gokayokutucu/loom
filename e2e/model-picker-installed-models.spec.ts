import { expect, type Page, test } from "@playwright/test";

const providerSettingsKey = "loom-ai-provider-settings-v1";

async function openApp(page: Page, providerSettings?: Record<string, unknown>) {
  await page.addInitScript(
    ({ key, settings }) => {
      window.localStorage.clear();
      if (settings) {
        window.localStorage.setItem(key, JSON.stringify(settings));
      }
    },
    { key: providerSettingsKey, settings: providerSettings ?? null }
  );
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openModelPicker(page: Page) {
  await page.getByRole("button", { name: "Select model" }).click();
  const menu = page.getByRole("menu", { name: "Select model and response mode" });
  await expect(menu).toBeVisible();
  return menu;
}

function providerSettings(input: {
  status: "unknown" | "connected" | "offline";
  models: Array<{ id: string; name: string; installed: boolean }>;
  mainModelId?: string;
}) {
  return {
    activeProvider: "ollama",
    ollama: {
      enabled: true,
      baseUrl: "http://localhost:11434",
      exposeToNetwork: false,
      contextLength: 8192,
      modelLocation: "~/.ollama/models",
      models: input.models.map((model) => ({
        ...model,
        provider: "ollama",
      })),
      lastConnectionStatus: input.status,
      lastCheckedAt: "2026-06-02T12:00:00.000Z",
    },
    profiles: {
      quickModelId: input.mainModelId ?? "qwen3.5:9b",
      mainModelId: input.mainModelId ?? "qwen3.5:9b",
    },
    demo: {
      mockResponsesEnabled: false,
    },
  };
}

test.describe("[pure-ui-rendering] Ollama model picker installed model states", () => {
  test("offline without cache does not show static suggestions as selectable models", async ({
    page,
  }) => {
    await openApp(page);

    const menu = await openModelPicker(page);

    await expect(menu).toContainText("Test Ollama to discover installed local models.");
    await expect(menu.getByRole("menuitemradio", { name: /Qwen 3\.5 9B/ })).toHaveCount(0);
    await expect(menu.getByRole("menuitemradio", { name: /Llama 3\.2 3B/ })).toHaveCount(0);
    await expect(menu.getByRole("menuitemradio", { name: /Mistral 7B/ })).toHaveCount(0);
    await expect(menu.getByText("Response Mode")).toBeVisible();
  });

  test("offline with last-known installed cache shows cached models only", async ({ page }) => {
    await openApp(
      page,
      providerSettings({
        status: "offline",
        mainModelId: "llama3.2:3b",
        models: [
          { id: "llama3.2:3b", name: "Llama 3.2 3B", installed: true },
          { id: "qwen2.5:7b", name: "Qwen 2.5 7B", installed: true },
          { id: "mistral:7b", name: "Mistral 7B", installed: false },
        ],
      })
    );

    const menu = await openModelPicker(page);

    await expect(menu).toContainText("Ollama is offline. Showing last discovered local models.");
    await expect(menu.getByRole("menuitemradio", { name: /Llama 3\.2 3B/ })).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: /Qwen 2\.5 7B/ })).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: /Mistral 7B/ })).toHaveCount(0);
  });

  test("connected with zero installed models shows empty installed state", async ({ page }) => {
    await openApp(
      page,
      providerSettings({
        status: "connected",
        models: [
          { id: "qwen3.5:9b", name: "Qwen 3.5 9B", installed: false },
          { id: "llama3.2", name: "Llama 3.2 3B", installed: false },
        ],
      })
    );

    const menu = await openModelPicker(page);

    await expect(menu).toContainText("No local models installed.");
    await expect(menu.getByRole("menuitemradio", { name: /Qwen 3\.5 9B/ })).toHaveCount(0);
    await expect(menu.getByRole("menuitemradio", { name: /Llama 3\.2 3B/ })).toHaveCount(0);
    await expect(menu.getByText("Selected model is unavailable")).toBeVisible();
  });
});
