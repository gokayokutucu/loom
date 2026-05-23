// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service thinking panel proof.
// - Uses a temp SQLite DB, temp loom-service, product flow data, and cleanup.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("[product-service-backed] thinking panel", () => {
  test("shows safe progress thoughts while thinking and hides raw thinking", async ({ page }) => {
    test.setTimeout(90_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicThinkingDelayMs: 2_500,
      startApp: true,
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({
            mockDataEnabled: false,
            modelResponseMode: "thinking",
            showGenerationDebug: true,
          })
        );
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Event Sourcing detay anlat");

      const thinkingPanel = page.locator(".thinking-panel.is-running").first();
      await expect(thinkingPanel).toBeVisible({ timeout: 30_000 });
      await thinkingPanel.getByRole("button", { name: /Thinking/ }).click();

      const detail = thinkingPanel.locator(".thinking-panel-detail");
      await expect(detail).toBeVisible();
      await expect(detail.locator(".assistant-response-progress--compact")).toBeVisible();
      await expect(detail).toContainText(/Preparing answer plan|Building Loom context|Understanding/);
      await expect(detail).not.toContainText("Raw model thinking is private");

      const pageText = await page.locator("body").innerText();
      expect(pageText).not.toContain("raw_thinking");
      expect(pageText).not.toContain("thinking_text");
      expect(pageText).not.toContain("chain_of_thought");
      expect(pageText).not.toContain("hidden_reasoning");

      await expect(page.getByText("Event Store kayıt kaynağıdır")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator(".thinking-panel.is-running")).toHaveCount(0);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});
