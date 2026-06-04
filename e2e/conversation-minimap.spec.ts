// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, rust-service Vite app.
// - Test data is created through loom-service product flows and cleaned up by the harness.
import { expect, test } from "@playwright/test";
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
});
