// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, rust-service Vite app.
// - Test data is created through loom-service product flows and cleaned up by the harness.
import { expect, type Locator, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function createMinimapLoom(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>
) {
  const loomId = `minimap-${Date.now()}`;
  const { loom } = await scenario.client.createLoom({
    loomId,
    title: "Conversation minimap product proof",
    summary: "Service-backed E2E proof data for the transcript minimap.",
    canonicalUri: `loom://service/${loomId}`,
    code: "conversation-minimap-proof",
    metadata: { source: "e2e_service_backed_flow" },
  });

  for (let index = 1; index <= 4; index += 1) {
    const answer = await scenario.sendPrompt(
      loom.loomId,
      `Create minimap proof turn ${index} with enough structure to make the transcript scroll.`
    );
    expect(answer.userResponseId).toBeTruthy();
    expect(answer.assistantResponseId).toBeTruthy();
  }

  return loom;
}

async function sendPanelPrompt(panel: Locator, prompt: string) {
  const editor = panel.getByRole("textbox", { name: "Prompt" });
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.pressSequentially(prompt, { delay: 0 });
  await panel.getByRole("button", { name: "Send" }).click();
}

async function scrollTop(locator: Locator) {
  return locator.evaluate((element) => (element as HTMLElement).scrollTop);
}

async function scrollPaneToTop(locator: Locator) {
  await locator.evaluate((element) => {
    (element as HTMLElement).scrollTop = 0;
  });
  await expect.poll(() => scrollTop(locator), { timeout: 5_000 }).toBeLessThanOrEqual(60);
}

async function stableScrollTop(locator: Locator) {
  await expect
    .poll(
      async () => {
        const first = await scrollTop(locator);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const second = await scrollTop(locator);
        return Math.abs(second - first);
      },
      { timeout: 6_000 }
    )
    .toBeLessThanOrEqual(2);
  return scrollTop(locator);
}

test.describe("[product-service-backed] Conversation minimap", () => {
  test("shows transcript ruler, hover outline, and pane-local response jumps", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "phrase",
      deterministicThinkingDelayMs: 50,
      deterministicStreamChunkDelayMs: 1,
      startApp: true,
    });

    try {
      const loom = await createMinimapLoom(scenario);

      await page.setViewportSize({ width: 900, height: 720 });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${loom.loomId}`).click();

      const transcript = page.locator(".chat-transcript").first();
      const minimap = page.locator(".conversation-minimap").first();
      const viewport = minimap.locator(".conversation-minimap__viewport");
      const responseTicks = minimap.locator(".conversation-minimap__tick--response");
      const outline = minimap.locator(".conversation-minimap__outline");
      const outlineRows = minimap.locator(".conversation-minimap__outline-row");

      await expect(transcript).toBeVisible();
      await expect(minimap).toBeVisible();
      await expect(viewport).toBeVisible();
      await expect(responseTicks).toHaveCount(4);
      await expect(outlineRows).toHaveCount(8);
      await expect(outline).toHaveCSS("opacity", "0");

      await expect
        .poll(
          async () =>
            transcript.evaluate(
              (element) => element.scrollHeight > element.clientHeight + 80
            ),
          { timeout: 10_000 }
        )
        .toBe(true);

      const initialViewportTop = await viewport.evaluate(
        (element) => element.getBoundingClientRect().top
      );

      await transcript.evaluate((element) => {
        element.scrollTop = Math.floor(element.scrollHeight / 2);
      });

      await expect
        .poll(
          async () =>
            viewport.evaluate((element) => element.getBoundingClientRect().top),
          { timeout: 5_000 }
        )
        .toBeGreaterThan(initialViewportTop + 8);

      await minimap.hover();
      await expect(outline).toHaveCSS("opacity", "1");
      await expect(outlineRows.filter({ hasText: "Create minimap proof turn 3" })).toHaveCount(1);
      await expect(minimap.locator(".conversation-minimap__outline-row--active")).toHaveCount(1);

      const fourthResponse = page.locator(".qa-item").nth(3);
      await outlineRows.nth(7).click();

      await expect
        .poll(
          async () =>
            fourthResponse.evaluate((element) => {
              const transcriptElement = element.closest(".chat-transcript");
              if (!transcriptElement) return false;
              const transcriptRect = transcriptElement.getBoundingClientRect();
              const responseRect = element.getBoundingClientRect();
              return (
                responseRect.top >= transcriptRect.top + 8 &&
                responseRect.top <= transcriptRect.top + 120
              );
            }),
          { timeout: 8_000 }
        )
        .toBe(true);

      await page.evaluate(() => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) activeElement.blur();
      });
      await page.mouse.move(860, 120);
      await expect(outline).toHaveCSS("opacity", "0");

      const thirdResponse = page.locator(".qa-item").nth(2);
      await responseTicks.nth(2).click();

      await expect
        .poll(
          async () =>
            thirdResponse.evaluate((element) => {
              const transcriptElement = element.closest(".chat-transcript");
              if (!transcriptElement) return false;
              const transcriptRect = transcriptElement.getBoundingClientRect();
              const responseRect = element.getBoundingClientRect();
              return (
                responseRect.top >= transcriptRect.top + 8 &&
                responseRect.top <= transcriptRect.top + 120
              );
            }),
          { timeout: 8_000 }
        )
        .toBe(true);

      expect(scenario.dbPath).toContain(scenario.tempDir);
      expect(scenario.configPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("keeps origin and Weft minimap outlines isolated in split panes", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "phrase",
      deterministicThinkingDelayMs: 50,
      deterministicStreamChunkDelayMs: 1,
      startApp: true,
    });

    try {
      const loom = await createMinimapLoom(scenario);

      await page.setViewportSize({ width: 1180, height: 760 });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${loom.loomId}`).click();

      const originSourceArticle = page.locator(".qa-item").nth(3);
      await originSourceArticle.scrollIntoViewIfNeeded();
      await originSourceArticle.getByRole("button", { name: /Start Weft from/i }).click();
      await expect(page.locator(".weft-split-view")).toBeVisible();

      const originPanel = page.locator(".origin-split-panel");
      const weftPanel = page.locator(".weft-split-panel");
      await expect(originPanel).toBeVisible();
      await expect(weftPanel).toBeVisible();

      for (let index = 1; index <= 4; index += 1) {
        await sendPanelPrompt(
          weftPanel,
          `Create split minimap Weft proof turn ${index} with enough detail to scroll.`
        );
        await expect(weftPanel.locator(".qa-item")).toHaveCount(index, {
          timeout: 30_000,
        });
      }

      const originTranscript = originPanel.locator(".chat-transcript");
      const weftTranscript = weftPanel.locator(".chat-transcript");
      const originMinimap = originPanel.locator(".conversation-minimap");
      const weftMinimap = weftPanel.locator(".conversation-minimap");
      const originOutline = originMinimap.locator(".conversation-minimap__outline");
      const weftOutline = weftMinimap.locator(".conversation-minimap__outline");
      const originRows = originMinimap.locator(".conversation-minimap__outline-row");
      const weftRows = weftMinimap.locator(".conversation-minimap__outline-row");

      await expect(originTranscript).toBeVisible();
      await expect(weftTranscript).toBeVisible();
      await expect(originMinimap).toBeVisible();
      await expect(weftMinimap).toBeVisible();
      await expect(originRows).toHaveCount(8);
      await expect(weftRows).toHaveCount(8);

      await scrollPaneToTop(originTranscript);
      await stableScrollTop(weftTranscript);

      await originMinimap.hover();
      await expect(originOutline).toHaveCSS("opacity", "1");
      await expect(weftOutline).toHaveCSS("opacity", "0");

      const weftBeforeOriginClick = await stableScrollTop(weftTranscript);
      await originRows.nth(7).click();
      await expect.poll(() => scrollTop(originTranscript), { timeout: 8_000 }).toBeGreaterThan(20);
      await expect.poll(() => scrollTop(weftTranscript), { timeout: 3_000 }).toBeLessThanOrEqual(
        weftBeforeOriginClick + 2
      );

      await page.evaluate(() => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) activeElement.blur();
      });
      await page.mouse.move(1120, 80);
      await expect(originOutline).toHaveCSS("opacity", "0");

      await scrollPaneToTop(originTranscript);
      const weftBeforeWeftClick = await stableScrollTop(weftTranscript);

      await weftMinimap.hover();
      await expect(weftOutline).toHaveCSS("opacity", "1");
      await expect(originOutline).toHaveCSS("opacity", "0");

      const originBeforeWeftClick = await scrollTop(originTranscript);
      await weftRows.nth(0).click();
      await expect
        .poll(() => scrollTop(weftTranscript), { timeout: 8_000 })
        .toBeLessThan(weftBeforeWeftClick - 20);
      await expect.poll(() => scrollTop(originTranscript), { timeout: 3_000 }).toBeLessThanOrEqual(
        originBeforeWeftClick + 2
      );

      expect(scenario.dbPath).toContain(scenario.tempDir);
      expect(scenario.configPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });
});
