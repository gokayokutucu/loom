// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service thinking panel proof.
// - Uses a temp SQLite DB, temp loom-service, product flow data, and cleanup.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function thinkingStreamMetrics(locator: Locator) {
  return locator.evaluate((element) => ({
    bottomGap: element.scrollHeight - element.scrollTop - element.clientHeight,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
}

test.describe("[product-service-backed] thinking panel", () => {
  test("shows safe progress thoughts while thinking and hides raw thinking", async ({ page }) => {
    test.setTimeout(90_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicThinkingDelayMs: 2_000,
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
      const liveStream = detail.getByTestId("thinking-live-stream");
      await expect(liveStream).toBeVisible({ timeout: 10_000 });
      await expect(liveStream).toContainText("Reviewing the prompt and Loom context");
      await expect(liveStream).not.toContainText("raw_thinking");

      // Assert Markdown elements render as actual HTML elements instead of raw text
      await expect(liveStream.locator("strong")).toContainText("Plan:");
      await expect(liveStream.locator("li")).toContainText("Reviewing the prompt and Loom context");
      await expect(liveStream.locator("code")).toContainText("Loom");

      await expect
        .poll(
          async () =>
            liveStream.evaluate((element) => ({
              scrollable: element.scrollHeight > element.clientHeight,
              maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
            })),
          { timeout: 10_000 }
        )
        .toMatchObject({ scrollable: true, maxHeight: 190 });

      await expect
        .poll(async () => (await thinkingStreamMetrics(liveStream)).bottomGap, {
          timeout: 5_000,
        })
        .toBeLessThanOrEqual(24);

      // 1. User scrolls up once with a real wheel gesture.
      await liveStream.hover();
      await page.mouse.wheel(0, -800);
      await expect
        .poll(async () => (await thinkingStreamMetrics(liveStream)).bottomGap, {
          timeout: 5_000,
        })
        .toBeGreaterThan(24);
      const scrollTopAfterWheel = (await thinkingStreamMetrics(liveStream)).scrollTop;

      // 2. Assert a new chunk arrives during the 2-second pause, and it does not jump to bottom.
      await expect(liveStream).toContainText("Rechecking answer outline", {
        timeout: 5_000,
      });

      const metricsDuringPause = await thinkingStreamMetrics(liveStream);
      expect(metricsDuringPause.bottomGap).toBeGreaterThan(24);
      expect(metricsDuringPause.scrollTop).toBeLessThanOrEqual(scrollTopAfterWheel + 8);

      // 3. Wait more than 2 seconds since the scroll up; the next chunk should resume follow.
      await page.waitForTimeout(2200);

      // 4. Assert another chunk arrives after the pause and auto-scrolls back to bottom.
      await expect(liveStream).toContainText("Discarding transient reasoning", {
        timeout: 5_000,
      });
      await expect
        .poll(async () => (await thinkingStreamMetrics(liveStream)).bottomGap, {
          timeout: 5_000,
        })
        .toBeLessThanOrEqual(24);

      // 5. Scrolling up again restarts the pause before the final thinking chunk.
      await liveStream.hover();
      await page.mouse.wheel(0, -800);
      await expect
        .poll(async () => (await thinkingStreamMetrics(liveStream)).bottomGap, {
          timeout: 5_000,
        })
        .toBeGreaterThan(24);
      const scrollTopAfterSecondWheel = (await thinkingStreamMetrics(liveStream)).scrollTop;

      await expect(liveStream).toContainText("Starting the visible answer now", {
        timeout: 5_000,
      });
      const metricsAfterSecondPauseChunk = await thinkingStreamMetrics(liveStream);
      expect(metricsAfterSecondPauseChunk.bottomGap).toBeGreaterThan(24);
      expect(metricsAfterSecondPauseChunk.scrollTop).toBeLessThanOrEqual(
        scrollTopAfterSecondWheel + 8
      );

      await page.waitForTimeout(2200);

      const pageText = await page.locator("body").innerText();
      expect(pageText).not.toContain("raw_thinking");
      expect(pageText).not.toContain("thinking_text");
      expect(pageText).not.toContain("chain_of_thought");
      expect(pageText).not.toContain("hidden_reasoning");

      await expect(page.getByText("Event Store kayıt kaynağıdır")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator(".thinking-panel.is-running")).toHaveCount(0);
      await expect(page.getByText("Reviewing the prompt and Loom context")).toHaveCount(0);

      const [loom] = await scenario.client.listLooms();
      const detailResponse = await scenario.fetchJson<{
        loom: { responses: Array<{ role: "user" | "assistant"; content: string; metadata?: unknown }> };
      }>(`/looms/${encodeURIComponent(loom.loomId)}`);
      const serialized = JSON.stringify(detailResponse);
      expect(serialized).not.toContain("Reviewing the prompt and available Loom context");
      expect(serialized).not.toContain("Preparing a concise response plan");
      expect(serialized).not.toContain("raw_thinking");

      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${loom.loomId}`).click();
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 20_000 });
      await expect(page.getByText("Event Store kayıt kaynağıdır")).toBeVisible();
      await expect(page.getByText("Reviewing the prompt and available Loom context")).toHaveCount(0);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});
