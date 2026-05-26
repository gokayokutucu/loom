import { expect, type Page, test } from "@playwright/test";

const providerSettingsKey = "loom-ai-provider-settings-v1";

async function openApp(page: Page, providerSettings?: Record<string, unknown>) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  if (providerSettings) {
    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, JSON.stringify(value));
      },
      [providerSettingsKey, providerSettings] as const
    );
  }
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openSettings(page: Page) {
  await page.getByTestId("profile-menu-trigger").click();
  await page.getByTestId("open-app-settings").click();
  await expect(page.getByRole("dialog", { name: /Runtime/ })).toBeVisible();
}

test.describe("[pure-ui-rendering] Settings information architecture", () => {
  test("[pure-ui-rendering] uses local profile defaults instead of hardcoded personal identity", async ({
    page,
  }) => {
    await openApp(page);

    const sidebar = page.getByTestId("loom-sidebar");
    await expect(sidebar.getByText("Local user")).toBeVisible();
    await expect(sidebar.getByText("Personal Loom")).toBeVisible();
    await expect(sidebar.locator(".profile-dot").last()).toHaveText("L");
    await expect(sidebar.getByText(["Go", "kay"].join(""))).toHaveCount(0);
    await expect(sidebar.getByText(["Personal", "Web"].join(" "))).toHaveCount(0);

    await page.getByTestId("profile-menu-trigger").click();
    await expect(page.getByRole("menuitem", { name: /Manage local profile/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: new RegExp(["Log", "out"].join(" ")) })).toHaveCount(0);
  });

  test("[pure-ui-rendering] reflects saved local profile settings in the sidebar", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);

    await page.getByRole("button", { name: /^Memory/ }).click();
    await page.getByLabel("Your nickname").fill("Ada Lovelace");
    await page.getByLabel("Your occupation").fill("Local research workspace");
    await page.getByTestId("memory-save").click();
    await expect(page.getByTestId("memory-save")).toBeDisabled();
    await page.getByRole("button", { name: "Close settings" }).click();

    const sidebar = page.getByTestId("loom-sidebar");
    await expect(sidebar.getByText("Ada Lovelace")).toBeVisible();
    await expect(sidebar.getByText("Local research workspace")).toBeVisible();
    await expect(sidebar.locator(".profile-dot").last()).toHaveText("A");
  });

  test("[pure-ui-rendering] profile menu shortcuts open concrete destinations", async ({
    page,
  }) => {
    await openApp(page);

    await page.getByTestId("profile-menu-trigger").click();
    await page.getByRole("menuitem", { name: "Model settings" }).click();
    await expect(page.getByRole("dialog", { name: /Models/ })).toBeVisible();
    await expect(page.getByText("Quick Model")).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();

    await page.getByTestId("profile-menu-trigger").click();
    await page.getByRole("menuitem", { name: "AI Providers" }).click();
    await expect(page.getByRole("dialog", { name: /Providers/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Local model provider" })).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();

    await page.getByTestId("profile-menu-trigger").click();
    await page.getByRole("menuitem", { name: "Help" }).click();
    await expect(page.getByRole("dialog", { name: "Loom Help" })).toContainText(
      "local-first AI browser"
    );
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByTestId("profile-menu-trigger").click();
    await page.getByRole("menuitem", { name: "About Loom" }).click();
    await expect(page.getByRole("dialog", { name: "About Loom" })).toContainText(
      "Build your personal web from AI conversations."
    );
  });

  test("[pure-ui-rendering] file attachments are enabled in attach menu", async ({
    page,
  }) => {
    await openApp(page);

    await page.getByTestId("prompt-surface").getByRole("button", { name: "Attach" }).click();
    const addFile = page.getByRole("button", { name: "Add file" });
    await expect(addFile).toBeEnabled();
    await expect(addFile).toHaveAttribute("title", "Add file");
    await expect(page.getByText("No files attached.")).toBeVisible();
  });

  test("[pure-ui-rendering] shows category navigation and preserves existing runtime controls", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);

    const categoryList = page.locator(".settings-category-list");
    for (const label of [
      "Runtime",
      "Providers",
      "Models",
      "Capability",
      "Memory",
      "Privacy & Security",
      "Data & Storage",
      "Export / Import",
      "UI Preferences",
      "Shortcuts",
      "Advanced",
    ]) {
      await expect(categoryList.getByText(label, { exact: true })).toBeVisible();
    }

    await expect(page.getByRole("heading", { name: "Engine and service status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check provider" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh service status" }).first()).toBeVisible();
  });

  test("[pure-ui-rendering] shows local speech-to-text configuration guidance", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);

    await page.getByRole("button", { name: /Capability/ }).click();
    await expect(page.getByRole("heading", { name: "Local transcription provider" })).toBeVisible();
    const speechSetupGuide = page.getByTestId("speech-setup-guide");
    await expect(speechSetupGuide.getByText("Local Speech Engine")).toBeVisible();
    await expect(speechSetupGuide.getByText("Speech model")).toBeVisible();
    await expect(speechSetupGuide.getByText("Provider", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check setup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Auto-configure provider" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Test Speech-to-Text" })).toBeVisible();
    await expect(page.getByText("Speech-to-Text setup required")).toBeVisible();
    const legacySttMessage = new RegExp(
      ["Local speech-to-text provider", "is not configured\\."].join(" ")
    );
    await expect(page.getByText(legacySttMessage)).toHaveCount(0);
    await expect(page.getByText("Set up local speech once")).toBeVisible();
    await expect(page.getByText("Local-only transcription. Audio is temporary")).toBeVisible();

    await page.getByTestId("speech-settings-section").getByText("Advanced").click();
    await expect(page.getByRole("button", { name: "Copy developer fallback" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset Speech-to-Text Configuration" })).toBeVisible();
    await expect(page.getByText(/Saved command path:/)).toBeVisible();
    await expect(page.getByText(/Saved arguments:/)).toBeVisible();
    await expect(page.getByText(/Setup status:/)).toBeVisible();
    await expect(page.getByText(/Local runtime:/)).toBeVisible();
    await expect(page.getByText(/Runtime version:/)).toBeVisible();
    await expect(page.getByLabel("Local command path")).toBeVisible();
    await expect(page.getByLabel("Command arguments")).toBeVisible();
    await expect(page.getByLabel("Command timeout")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Output mode" })).toBeVisible();
    await expect(page.getByLabel("Transcript file extension")).toBeVisible();
    await expect(page.getByLabel("Temporary audio directory")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check Provider" })).toBeVisible();
    await expect(page.getByText("mock_test")).toHaveCount(0);
  });

  test("[pure-ui-rendering] shows provider, privacy, and deferred sections without active secret inputs", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);

    await page.getByRole("button", { name: /Providers/ }).click();
    await expect(page.getByRole("heading", { name: "Local model provider" })).toBeVisible();
    await expect(page.getByText("Connection not tested yet.")).toBeVisible();
    await expect(page.getByText("Local-only access enabled")).toBeVisible();
    await expect(page.getByText("Security: unknown")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry connection" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Install Ollama" })).toBeVisible();
    await expect(page.getByText("Secure native storage required")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await page.getByRole("button", { name: /Privacy & Security/ }).click();
    await expect(page.getByRole("heading", { name: "Security posture" })).toBeVisible();
    await expect(page.getByText("Local-first runtime")).toBeVisible();
    await expect(page.getByText("Raw thinking persistence")).toBeVisible();
    await expect(page.getByText("Disabled").first()).toBeVisible();
    await expect(page.getByText("Remote Ollama", { exact: true })).toBeVisible();
    await expect(page.getByText("Blocked by default", { exact: true })).toBeVisible();
    await expect(page.getByText("Provider secrets", { exact: true })).toBeVisible();
    await expect(page.getByText("Secure native storage required later")).toBeVisible();
    await expect(page.getByText("Unsafe model management")).toBeVisible();
    await expect(page.getByText("Remote Ollama endpoints are blocked by default for safety.")).toBeVisible();
    await expect(page.getByText("API keys are not accepted or stored")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('label:has-text("Store thinking")')).toHaveCount(0);
    await expect(page.locator('label:has-text("Copy chain of thought")')).toHaveCount(0);
    await expect(page.locator('label:has-text("Export hidden reasoning")')).toHaveCount(0);

    await page.getByRole("button", { name: /^Memory/ }).click();
    await expect(
      page.getByTestId("memory-settings-section").getByRole("heading", { name: "Memory" })
    ).toBeVisible();
    await expect(page.getByText("Explicit Memory", { exact: true })).toBeVisible();
    await expect(page.getByText("Derived Context Artifacts", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Raw model thinking is never saved as memory.", { exact: true })
    ).toBeVisible();

    await page.getByRole("button", { name: /Advanced/ }).click();
    await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Service status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Developer integrations — planned" })).toBeVisible();
    await expect(page.getByText("Extensions")).toBeVisible();
    await expect(page.getByText("MCP", { exact: true })).toBeVisible();
    await expect(page.getByText("Tool artifacts")).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Show generation debug monitor while answering" })
    ).toHaveCount(0);
  });

  test("[pure-ui-rendering] separates Loom runtime readiness from offline provider state", async ({
    page,
  }) => {
    await openApp(page, {
      ollama: {
        baseUrl: "http://127.0.0.1:11434",
        lastConnectionStatus: "offline",
        lastCheckedAt: "2026-05-20T09:00:00.000Z",
      },
    });
    await openSettings(page);

    await expect(page.getByRole("heading", { name: "Engine and service status" })).toBeVisible();
    await expect(page.getByText("Loom is running normally. Model provider availability is shown separately.")).toBeVisible();
    await expect(page.getByText("Desktop runtime controls are available in the Electron app.")).toBeVisible();
    await expect(page.getByText("Runtime restart is available in the desktop app.")).toHaveCount(0);

    await page.getByRole("button", { name: /Providers/ }).click();
    await expect(page.getByText("Local model provider is offline")).toBeVisible();
    await expect(page.getByText("Loom is running normally. Start or install Ollama to use local models.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry connection" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Install Ollama" })).toBeVisible();
  });

  test("[pure-ui-rendering] explains connected provider with no installed models", async ({
    page,
  }) => {
    await openApp(page, {
      ollama: {
        baseUrl: "http://127.0.0.1:11434",
        lastConnectionStatus: "connected",
        lastCheckedAt: "2026-05-20T09:00:00.000Z",
        models: [
          {
            id: "qwen3.5:9b",
            name: "Qwen 3.5 9B",
            provider: "ollama",
            installed: false,
          },
        ],
      },
    });
    await openSettings(page);

    await expect(page.getByText("Loom Runtime · Needs attention")).toBeVisible();
    await expect(page.getByText("Loom Runtime Needs Attention")).toHaveCount(0);
    await expect(page.getByText("Loom is running, but the selected model is not ready.")).toBeVisible();
    await expect(page.getByText("Install or choose a Quick/Main model before sending prompts.")).toBeVisible();

    await page.getByRole("button", { name: /Providers/ }).click();
    await expect(page.locator(".runtime-health-card.warning")).toContainText("No models installed yet");
    await expect(page.getByText("No models installed yet")).toBeVisible();
    await expect(page.getByText("Ollama is running, but it has no installed models yet.")).toBeVisible();
    await expect(page.getByText("Local-only access enabled")).toBeVisible();
  });

  test("[pure-ui-rendering] supports the Memory settings shell without memory persistence", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);

    await page.getByRole("button", { name: /^Memory/ }).click();
    await expect(page.getByTestId("memory-settings-section")).toBeVisible();

    const useMemory = page.getByRole("checkbox", { name: /Use memory in Loom/ });
    const recentLooms = page.getByRole("checkbox", { name: /Reference recent Looms/ });
    const savedMemories = page.getByRole("checkbox", { name: /Reference saved memories/ });
    await expect(useMemory).toBeChecked();
    await expect(recentLooms).toBeChecked();
    await expect(savedMemories).not.toBeChecked();
    await expect(page.getByTestId("memory-save")).toBeDisabled();

    await savedMemories.check();
    await page.getByLabel("Your nickname").fill("Ada");
    await page.getByLabel("Your occupation").fill("Builder");
    await expect(page.getByTestId("memory-save")).toBeEnabled();
    await page.getByTestId("memory-save").click();
    await expect(page.getByTestId("memory-save")).toBeDisabled();

    await page.getByRole("button", { name: "Close settings" }).click();
    await openSettings(page);
    await page.getByRole("button", { name: /^Memory/ }).click();
    await expect(page.getByRole("checkbox", { name: /Reference saved memories/ })).toBeChecked();
    await expect(page.getByLabel("Your nickname")).toHaveValue("Ada");
    await expect(page.getByLabel("Your occupation")).toHaveValue("Builder");

    await expect(page.getByTestId("memory-empty-state")).toContainText("No saved memories yet.");
    await expect(page.getByRole("button", { name: "Clear all memories" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Export memories" })).toBeDisabled();
    await expect(
      page.locator("label").filter({ hasText: /raw thinking|chain of thought|hidden reasoning/i })
    ).toHaveCount(0);
    const memoryStorageKeys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => /memories/i.test(key))
    );
    expect(memoryStorageKeys).toEqual([]);
  });

  test("[pure-ui-rendering] resets unsaved Memory shell edits", async ({ page }) => {
    await openApp(page);
    await openSettings(page);

    await page.getByRole("button", { name: /^Memory/ }).click();
    await page.getByRole("checkbox", { name: /Reference recent Looms/ }).uncheck();
    await page.getByLabel("Language and style preferences").fill("Prefer concise Turkish.");
    await expect(page.getByTestId("memory-save")).toBeEnabled();
    await page.getByTestId("memory-reset").click();

    await expect(page.getByRole("checkbox", { name: /Reference recent Looms/ })).toBeChecked();
    await expect(page.getByLabel("Language and style preferences")).toHaveValue("");
    await expect(page.getByTestId("memory-save")).toBeDisabled();
  });
});
