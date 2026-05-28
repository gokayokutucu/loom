// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
// - Test data is created through the product composer and cleaned up by the harness.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function fillPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
}

test.describe("[product-service-backed] Main composer submit", () => {
  test("double submit does not create duplicate Looms", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicStreamChunkDelayMs: 2,
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const prompt = `Duplicate submit guard ${Date.now()} local-first runtime proof`;
      await fillPrompt(page, prompt);

      await page.getByRole("button", { name: "Send" }).evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });

      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Event Sourcing",
        { timeout: 30_000 }
      );

      const looms = await scenario.client.listLooms();
      expect(looms).toHaveLength(1);

      await expect
        .poll(
          async () => {
            const detail = await scenario.fetchJson<{
              loom: { responses: Array<{ role: "user" | "assistant"; content: string }> };
            }>(`/looms/${encodeURIComponent(looms[0].loomId)}`);
            return detail.loom.responses.map((response) => response.role);
          },
          { timeout: 30_000 }
        )
        .toEqual(["user", "assistant"]);
      const rawDetail = await scenario.fetchJson<{
        loom: { responses: Array<{ role: "user" | "assistant"; content: string }> };
      }>(`/looms/${encodeURIComponent(looms[0].loomId)}`);
      expect(rawDetail.loom.responses.filter((response) => response.role === "user")).toHaveLength(1);
      expect(rawDetail.loom.responses.filter((response) => response.role === "assistant")).toHaveLength(1);
      expect(rawDetail.loom.responses[0].content).toContain("Duplicate submit guard");
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("holds anchored viewport until the real response tail reaches the composer", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicStreamChunkDelayMs: 60,
      deterministicThinkingDelayMs: 1_500,
      startApp: true,
    });

    const readLatestTurnMetrics = () =>
      page.locator(".qa-item").last().evaluate((item) => {
        const transcript = item.closest(".chat-transcript");
        const userTurn = item.querySelector<HTMLElement>("[data-prompt-response-id]");
        const tail = item.querySelector<HTMLElement>("[data-response-tail]");
        const composer = document.querySelector<HTMLElement>(
          ".prompt-composer.active:not(.centered)[data-testid='prompt-composer']"
        );
        if (!transcript || !userTurn || !tail || !composer) return null;
        const transcriptRect = transcript.getBoundingClientRect();
        const userTurnRect = userTurn.getBoundingClientRect();
        const tailRect = tail.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const safeBottom = Math.min(transcriptRect.bottom, composerRect.top);
        return {
          promptTop: userTurnRect.top - transcriptRect.top,
          tailBottom: tailRect.bottom,
          composerTop: composerRect.top,
          safeBottom,
          visibleGap: safeBottom - tailRect.bottom,
          transcriptHeight: transcriptRect.height,
          scrollTop: (transcript as HTMLElement).scrollTop,
          scrollHeight: (transcript as HTMLElement).scrollHeight,
          clientHeight: (transcript as HTMLElement).clientHeight,
        };
      });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({
            mockDataEnabled: false,
            modelResponseMode: "thinking",
          })
        );
      });
      await page.setViewportSize({ width: 500, height: 784 });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await fillPrompt(page, `hold-overflow-seed-${Date.now()} event sourcing detay`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 15_000,
      });

      await page.locator(".chat-transcript").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });

      await fillPrompt(page, `hold-overflow-anchor-${Date.now()} event sourcing detay`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });

      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 15_000,
      });

      await expect
        .poll(
          async () => {
            const m = await readLatestTurnMetrics();
            if (!m) return -1;
            return m.promptTop;
          },
          { timeout: 8_000 }
        )
        .toBeGreaterThanOrEqual(-16);

      const thinkingMetrics = await readLatestTurnMetrics();
      expect(thinkingMetrics).not.toBeNull();
      expect(thinkingMetrics!.promptTop).toBeGreaterThanOrEqual(-16);
      expect(thinkingMetrics!.promptTop).toBeLessThanOrEqual(300);

      await expect(page.locator(".thinking-panel.is-running").last()).not.toBeVisible({
        timeout: 5_000,
      });
      await page.waitForTimeout(40);

      const earlyMetrics = await readLatestTurnMetrics();
      expect(earlyMetrics).not.toBeNull();
      expect(earlyMetrics!.visibleGap).toBeGreaterThan(32);
      const heldScrollTop = earlyMetrics!.scrollTop;

      await page.waitForTimeout(80);
      const heldAgainMetrics = await readLatestTurnMetrics();
      expect(heldAgainMetrics).not.toBeNull();
      if (heldAgainMetrics!.visibleGap > 32) {
        expect(heldAgainMetrics!.scrollTop).toBeCloseTo(heldScrollTop, 1);
      }

      await expect(page.locator(".assistant-message").last()).toContainText("const state = replay", {
        timeout: 15_000,
      });
      const finalMetrics = await readLatestTurnMetrics();
      expect(finalMetrics).not.toBeNull();
      expect(finalMetrics!.visibleGap).toBeLessThanOrEqual(28);
      expect(finalMetrics!.scrollTop).toBeGreaterThan(heldScrollTop);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("anchors latest submitted prompt near the top when the assistant starts", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicStreamChunkDelayMs: 8,
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
          })
        );
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await fillPrompt(page, `Initial scroll anchor setup ${Date.now()} explain Event Sourcing with details`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toContainText("Event Sourcing", {
        timeout: 30_000,
      });

      await page.locator(".chat-transcript").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });

      await fillPrompt(page, "Second prompt should anchor near top while the Event Sourcing answer starts");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });
      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 30_000,
      });

      const readLatestTurnMetrics = () =>
        page.locator(".qa-item").last().evaluate((item) => {
          const transcript = item.closest(".chat-transcript");
          const userTurn = item.querySelector("[data-prompt-response-id]");
          const assistantMessage = item.querySelector(".assistant-message");
          if (!transcript || !userTurn || !assistantMessage) return null;
          const transcriptRect = transcript.getBoundingClientRect();
          const userTurnRect = userTurn.getBoundingClientRect();
          const assistantRect = assistantMessage.getBoundingClientRect();
          return {
            promptTop: userTurnRect.top - transcriptRect.top,
            promptBottom: userTurnRect.bottom - transcriptRect.top,
            assistantTop: assistantRect.top - transcriptRect.top,
            transcriptHeight: transcriptRect.height,
          };
        });

      await expect
        .poll(
          async () => {
            const metrics = await readLatestTurnMetrics();
            return Boolean(
              metrics &&
                metrics.promptTop >= -16 &&
                metrics.promptTop <= 300 &&
                metrics.assistantTop > metrics.promptBottom &&
                metrics.assistantTop < metrics.transcriptHeight
            );
          },
          { timeout: 10_000 }
        )
        .toBe(true);

      const latestTurnMetrics = await readLatestTurnMetrics();
      expect(latestTurnMetrics).not.toBeNull();
      expect(latestTurnMetrics!.promptTop).toBeGreaterThanOrEqual(-16);
      expect(latestTurnMetrics!.promptTop).toBeLessThanOrEqual(300);
      expect(latestTurnMetrics!.assistantTop).toBeGreaterThan(latestTurnMetrics!.promptBottom);
      expect(latestTurnMetrics!.assistantTop).toBeLessThan(latestTurnMetrics!.transcriptHeight);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });
});
