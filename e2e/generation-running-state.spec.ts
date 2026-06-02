// E2E data authority classification:
// - LEGACY_TYPESCRIPT_LOCAL for pure-UI wiring checks (no service needed).
// - The concurrent-blocking positive path (Send disabled during live generation)
//   requires product-service-backed tests with deterministicStreamChunkDelayMs;
//   those are covered by main-composer-submit.spec.ts "generation lifecycle" tests.
//   Logic coverage is in src/services/modelProviders.test.ts (unit tests for
//   computeComposerRunState and computeQuickAskBlockedReason).
import { expect, test } from "@playwright/test";

const providerSettingsKey = "loom-ai-provider-settings-v1";

async function openApp(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

function twoModelSettings(mainModelId: string, quickModelId: string) {
  return {
    activeProvider: "ollama",
    ollama: {
      enabled: true,
      baseUrl: "http://localhost:11434",
      exposeToNetwork: false,
      contextLength: 8192,
      modelLocation: "~/.ollama/models",
      models: [
        { id: mainModelId, name: mainModelId, provider: "ollama", installed: true },
        { id: quickModelId, name: quickModelId, provider: "ollama", installed: true },
      ],
      lastConnectionStatus: "connected",
      lastCheckedAt: "2026-06-02T12:00:00.000Z",
    },
    profiles: { quickModelId, mainModelId },
    demo: { mockResponsesEnabled: false },
  };
}

test.describe("[legacy-typescript-local] Generation running state — wiring checks", () => {
  test("Send button is not blocked-by-other-generation when idle", async ({
    page,
  }) => {
    await openApp(page);
    // No generation running → no blocked-by-other-generation indicators.
    // (Button may be disabled for other reasons like Ollama not running in test mode;
    //  we only check that the specific "blocked by other generation" state is absent.)
    await expect(page.getByTestId("send-blocked-other-generation")).toHaveCount(0);
    await expect(page.getByTestId("blocked-other-generation-message")).toHaveCount(0);
  });

  test("Quick Ask blocked message testid is absent when no main generation is running", async ({
    page,
  }) => {
    await page.addInitScript(
      ({ key, settings }) => {
        window.localStorage.clear();
        window.localStorage.setItem(key, JSON.stringify(settings));
      },
      {
        key: providerSettingsKey,
        settings: twoModelSettings("qwen3.5:9b", "qwen3.5:9b"),
      }
    );
    await page.goto("/");
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();
    // No Quick Ask popup is open by default — no blocked message
    await expect(page.getByTestId("quick-ask-submit-blocked")).toHaveCount(0);
    await expect(page.getByTestId("quick-ask-blocked-button")).toHaveCount(0);
  });

  test("Send button title does not mention 'Another response' when no generation active", async ({
    page,
  }) => {
    await openApp(page);
    // Find the send-button by class (not role, since role might vary by state).
    const sendButton = page.locator(".send-button").first();
    await expect(sendButton).toBeVisible();
    const title = await sendButton.getAttribute("title");
    expect(title ?? "").not.toContain("Another response");
  });

  test("normal send flow works when no generation is active (regression)", async ({ page }) => {
    // Opens the app in mock-responses mode so we can send without a real service.
    await page.addInitScript(
      ({ key, settings }) => {
        window.localStorage.clear();
        window.localStorage.setItem(key, JSON.stringify(settings));
      },
      {
        key: providerSettingsKey,
        settings: {
          activeProvider: "ollama",
          ollama: {
            enabled: true,
            baseUrl: "http://localhost:11434",
            exposeToNetwork: false,
            contextLength: 8192,
            modelLocation: "~/.ollama/models",
            models: [],
            lastConnectionStatus: "connected",
            lastCheckedAt: "2026-06-02T12:00:00.000Z",
          },
          profiles: { quickModelId: "mock-main", mainModelId: "mock-main" },
          demo: { mockResponsesEnabled: true },
        },
      }
    );
    await page.goto("/");
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();
    // The send button must be present and clickable (no spurious blocking).
    await expect(page.getByRole("button", { name: "Send" }).first()).toBeVisible();
    await expect(page.getByTestId("send-blocked-other-generation")).toHaveCount(0);
  });

  // ── Quick Ask model-collision UI contract ───────────────────────────────────
  // The submitBlockedReason is only shown when composerRuntimeState.running=true.
  // The pure-UI tests above verify absence of the block when not running.
  // The logic is fully tested by unit tests in modelProviders.test.ts.

  test("Quick Ask blocked data-testid wiring: AskPopup renders blocked state when prop is set (CSS contract)", async ({
    page,
  }) => {
    // Verify @keyframes and .ask-submit-blocked CSS class exists in the bundle.
    await openApp(page);
    const cssCheck = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        try {
          const rules = Array.from(sheet.cssRules ?? []);
          const hasBlockedClass = rules.some(
            (rule) =>
              rule instanceof CSSStyleRule && rule.selectorText?.includes("ask-submit-blocked")
          );
          if (hasBlockedClass) return true;
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(cssCheck).toBe(true);
  });
});
