// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, rust-service Vite app.
// - Test data is created through loom-service product flows and cleaned up by the harness.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

interface ExportedResponse {
  responseId: string;
  role: "user" | "assistant";
  content: string;
  sequenceIndex: number;
}

interface LoomExportJson {
  responses: ExportedResponse[];
}

async function createMinimapLoom(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  turnCount = 4
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

  for (let index = 1; index <= turnCount; index += 1) {
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

async function editPrompt(page: Page, responseId: string, nextPrompt: string) {
  await page.getByTestId(`edit-prompt-${responseId}`).evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Prompt edit trigger is not a button.");
    }
    button.click();
  });
  const editor = page.getByLabel("Edit prompt text");
  await expect(editor).toBeVisible();
  await editor.fill(nextPrompt);
  await page.getByRole("button", { name: "Save" }).click();
}

async function exportedLoomResponses(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  loomId: string
) {
  const exported = await scenario.client.exportLoom({
    loomId,
    format: "json",
    includeMetadata: true,
    includeReferences: true,
    includeGraph: true,
  });
  return (JSON.parse(Buffer.from(exported.contentBase64, "base64").toString("utf8")) as LoomExportJson)
    .responses;
}

async function waitForPersistedResponses(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  loomId: string,
  expectedCount: number
) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const responses = await exportedLoomResponses(scenario, loomId);
    const assistantResponsesComplete = responses
      .filter((response) => response.role === "assistant")
      .every((response) => response.content.trim().length > 0);
    if (responses.length >= expectedCount && assistantResponsesComplete) return responses;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expectedCount} persisted responses in ${loomId}.`);
}

async function scrollTop(locator: Locator) {
  return locator.evaluate((element) => (element as HTMLElement).scrollTop);
}

async function expectMinimapOnTranscriptRight(transcript: Locator, minimap: Locator) {
  await expect
    .poll(
      async () => {
        const [transcriptBox, minimapBox] = await Promise.all([
          transcript.boundingBox(),
          minimap.boundingBox(),
        ]);
        if (!transcriptBox || !minimapBox) return false;
        const minimapCenterX = minimapBox.x + minimapBox.width / 2;
        const distanceToRight = Math.abs(transcriptBox.x + transcriptBox.width - minimapCenterX);
        const distanceToLeft = Math.abs(minimapCenterX - transcriptBox.x);
        const isRightAligned = distanceToRight < 48 && distanceToRight < distanceToLeft;

        // Verify the top of the minimap is shifted lower (at least 48px below transcript top)
        // to avoid visual collision with the kebab/action menu area.
        const topOffset = minimapBox.y - transcriptBox.y;
        const isBelowKebabArea = topOffset >= 48;

        return isRightAligned && isBelowKebabArea;
      },
      { timeout: 5_000 }
    )
    .toBe(true);
}

async function expectRulerTicksEvenlySpaced(ticks: Locator) {
  const tops = await ticks.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().top))
  );
  expect(tops.length).toBeGreaterThanOrEqual(2);
  const gaps = tops.slice(1).map((top, index) => top - tops[index]);
  expect(Math.min(...gaps)).toBeGreaterThan(0);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(4);
}

async function expectFixedRulerHeight(minimap: Locator) {
  const box = await minimap.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(180);
  expect(box!.height).toBeLessThanOrEqual(240);
}

async function expectOutlineOpen(outline: Locator) {
  await expect(outline).toHaveCSS("opacity", "1");
  await expect(outline).toHaveCSS("visibility", "visible");
  await expect(outline).toHaveCSS("pointer-events", "auto");
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

async function expectPromptAnchorNearTranscriptTop(promptAnchor: Locator) {
  await expect
    .poll(
      async () =>
        promptAnchor.evaluate((element) => {
          const transcriptElement = element.closest(".chat-transcript");
          if (!transcriptElement) return false;
          const transcriptRect = transcriptElement.getBoundingClientRect();
          const promptRect = element.getBoundingClientRect();
          return (
            promptRect.top >= transcriptRect.top + 8 &&
            promptRect.top <= transcriptRect.top + 120
          );
        }),
      { timeout: 8_000 }
    )
    .toBe(true);
}

async function expectOutlineRowNearTop(row: Locator) {
  await expect
    .poll(
      async () =>
        row.evaluate((element) => {
          const outline = element.closest(".conversation-minimap__outline");
          if (!outline) return false;
          if (outline.scrollHeight <= outline.clientHeight) return true;
          const rowRect = element.getBoundingClientRect();
          const outlineRect = outline.getBoundingClientRect();
          const canScrollFurther = outline.scrollTop < outline.scrollHeight - outline.clientHeight - 2;
          if (!canScrollFurther) return rowRect.bottom <= outlineRect.bottom + 2;
          return rowRect.top >= outlineRect.top + 4 && rowRect.top <= outlineRect.top + 32;
        }),
      { timeout: 8_000 }
    )
    .toBe(true);
}

test.describe("[product-service-backed] Conversation minimap", () => {
  test("shows the ruler once a conversation has two response items", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "phrase",
      deterministicThinkingDelayMs: 50,
      deterministicStreamChunkDelayMs: 1,
      startApp: true,
    });

    try {
      const loom = await createMinimapLoom(scenario, 2);

      await page.setViewportSize({ width: 900, height: 720 });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${loom.loomId}`).click();

      const transcript = page.locator(".chat-transcript").first();
      const minimap = page.locator(".conversation-minimap").first();
      const ticks = minimap.locator(".conversation-minimap__tick");

      await expect(transcript).toBeVisible();
      await expect(minimap).toBeVisible();
      await expectMinimapOnTranscriptRight(transcript, minimap);
      await expect(ticks).toHaveCount(2);
      await expect(minimap.locator(".conversation-minimap__viewport")).toHaveCount(0);
      await expectRulerTicksEvenlySpaced(ticks);
      await expectFixedRulerHeight(minimap);

      expect(scenario.dbPath).toContain(scenario.tempDir);
      expect(scenario.configPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("shows transcript ruler, hover outline, and pane-local response jumps", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "phrase",
      deterministicThinkingDelayMs: 50,
      deterministicStreamChunkDelayMs: 1,
      startApp: true,
    });

    try {
      const loom = await createMinimapLoom(scenario, 21);

      await page.setViewportSize({ width: 900, height: 720 });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${loom.loomId}`).click();

      const transcript = page.locator(".chat-transcript").first();
      const minimap = page.locator(".conversation-minimap").first();
      const responseTicks = minimap.locator(".conversation-minimap__tick--response");
      const allTicks = minimap.locator(".conversation-minimap__tick");
      const outline = minimap.locator(".conversation-minimap__outline");
      const outlineRows = minimap.locator(".conversation-minimap__outline-row");

      await expect(transcript).toBeVisible();
      await expect(minimap).toBeVisible();
      await expect(minimap.locator(".conversation-minimap__viewport")).toHaveCount(0);
      await expect(responseTicks).toHaveCount(16);
      await expect(outlineRows).toHaveCount(21);
      await expect(outline).toHaveCSS("opacity", "0");
      await expectMinimapOnTranscriptRight(transcript, minimap);
      await expectRulerTicksEvenlySpaced(allTicks);
      await expectFixedRulerHeight(minimap);

      await expect
        .poll(
          async () =>
            transcript.evaluate(
              (element) => element.scrollHeight > element.clientHeight + 80
            ),
          { timeout: 10_000 }
        )
        .toBe(true);

      await transcript.evaluate((element) => {
        element.scrollTop = Math.floor(element.scrollHeight / 2);
      });

      await expect
        .poll(
          () => minimap.locator(".conversation-minimap__tick--active").count(),
          { timeout: 5_000 }
        )
        .toBe(1);

      const firstTick = minimap.locator(".conversation-minimap__tick").first();
      await firstTick.hover();
      await expectOutlineOpen(outline);

      // Verify title tooltips exist on ticks and parent outline rows
      await expect(firstTick).toHaveAttribute("title");
      const tickTitle = await firstTick.getAttribute("title");
      expect(tickTitle).toBeTruthy();
      expect(tickTitle!.length).toBeGreaterThan(0);

      await expect(outlineRows.first()).toHaveAttribute("title");
      const outlineTitle = await outlineRows.first().getAttribute("title");
      expect(outlineTitle).toBeTruthy();
      expect(outlineTitle!.length).toBeGreaterThan(0);

      // Move mouse through the bridge to verify stability
      const tickBox = await firstTick.boundingBox();
      const outlineBox = await outline.boundingBox();
      expect(tickBox).not.toBeNull();
      expect(outlineBox).not.toBeNull();

      const bridgeX = (tickBox!.x + outlineBox!.x + outlineBox!.width) / 2;
      const bridgeY = tickBox!.y + tickBox!.height / 2;
      await page.mouse.move(bridgeX, bridgeY);
      await expectOutlineOpen(outline);

      const insideOutlineX = outlineBox!.x + outlineBox!.width / 2;
      const insideOutlineY = outlineBox!.y + outlineBox!.height / 2;
      await page.mouse.move(insideOutlineX, insideOutlineY);
      await expectOutlineOpen(outline);

      await expect(outlineRows.first()).toContainText("Long Streaming Scroll Fixture");
      await expect(outlineRows.first()).not.toContainText("#");
      await expect(outlineRows.locator(".conversation-minimap__outline-type")).toHaveCount(0);
      await expect(
        minimap.locator(
          ".conversation-minimap__outline-row:not(.conversation-minimap__outline-row--child) .conversation-minimap__outline-marker"
        )
      ).toHaveCount(0);
      await expect(minimap.locator(".conversation-minimap__outline-row--active")).toHaveCount(1);

      const outlineMetrics = await outline.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          clientHeight: element.clientHeight,
          overflowY: style.overflowY,
          scrollHeight: element.scrollHeight,
          scrollbarWidth: style.scrollbarWidth,
        };
      });
      expect(outlineMetrics.scrollHeight).toBeGreaterThan(outlineMetrics.clientHeight);
      expect(outlineMetrics.overflowY).toBe("auto");
      expect(outlineMetrics.scrollbarWidth).toBe("none");

      const fifteenthPromptAnchor = page.locator("[data-prompt-response-id]").nth(14);
      await outlineRows.nth(14).click();
      await expectOutlineRowNearTop(outlineRows.nth(14));
      await expectPromptAnchorNearTranscriptTop(fifteenthPromptAnchor);

      const twentyFirstPromptAnchor = page.locator("[data-prompt-response-id]").nth(20);
      await minimap.locator(".conversation-minimap__tick").first().hover();
      await expectOutlineOpen(outline);
      await outlineRows.nth(20).click();

      await expectPromptAnchorNearTranscriptTop(twentyFirstPromptAnchor);

      await page.evaluate(() => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) activeElement.blur();
      });
      await page.mouse.move(100, 120);
      await expect(outline).toHaveCSS("opacity", "0");

      await scrollPaneToTop(transcript);
      const thirdPromptAnchor = page.locator("[data-prompt-response-id]").nth(2);
      await responseTicks.nth(2).click();

      await expectPromptAnchorNearTranscriptTop(thirdPromptAnchor);

      expect(scenario.dbPath).toContain(scenario.tempDir);
      expect(scenario.configPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("hides minimap in Weft split pane and preserves origin minimap navigation", async ({
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

      // Return to Origin button must NOT be in the origin (left) split panel
      await expect(
        originPanel.getByRole("button", { name: "Return to Origin" })
      ).not.toBeVisible();

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

      await expect(originTranscript).toBeVisible();
      await expect(weftTranscript).toBeVisible();

      // Assert split-view state: origin split-panel has minimap, weft split-panel does not.
      await expect(originMinimap).toBeVisible();
      await expect(weftMinimap).toHaveCount(0);

      const originOutline = originMinimap.locator(".conversation-minimap__outline");
      const originRows = originMinimap.locator(".conversation-minimap__outline-row");

      await expect(originRows).toHaveCount(4);
      await expectMinimapOnTranscriptRight(originTranscript, originMinimap);

      await scrollPaneToTop(originTranscript);
      await stableScrollTop(weftTranscript);

      await originMinimap.locator(".conversation-minimap__tick").first().hover();
      await expect(originOutline).toHaveCSS("opacity", "1");

      const weftBeforeOriginClick = await stableScrollTop(weftTranscript);
      await originRows.nth(3).click();
      await expect.poll(() => scrollTop(originTranscript), { timeout: 8_000 }).toBeGreaterThan(20);
      await expect.poll(() => scrollTop(weftTranscript), { timeout: 3_000 }).toBeLessThanOrEqual(
        weftBeforeOriginClick + 2
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

  test("shows revision child rows in the hover outline without adding ruler ticks", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      const loom = await createMinimapLoom(scenario, 2);

      await page.setViewportSize({ width: 1180, height: 760 });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${loom.loomId}`).click();
      await expect(page.locator(".chat-transcript").first()).toBeVisible();

      const persisted = await waitForPersistedResponses(scenario, loom.loomId, 4);
      const assistantResponse = persisted.find(
        (response) => response.role === "assistant" && response.sequenceIndex === 1
      );
      expect(assistantResponse).toBeTruthy();

      const revisionPrompt = "Revision outline minimap child row proof";
      await editPrompt(page, assistantResponse!.responseId, revisionPrompt);
      await expect(page.locator(".weft-split-view")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".weft-split-panel")).toContainText(revisionPrompt, {
        timeout: 30_000,
      });

      const originPanel = page.locator(".origin-split-panel");
      const originMinimap = originPanel.locator(".conversation-minimap");
      const originTicks = originMinimap.locator(".conversation-minimap__tick");
      const parentRows = originMinimap.locator(
        ".conversation-minimap__outline-row:not(.conversation-minimap__outline-row--child)"
      );
      const revisionRow = originMinimap.locator(
        ".conversation-minimap__outline-row--revision",
        { hasText: revisionPrompt }
      );

      await expect(originMinimap).toBeVisible();
      await expect(originTicks).toHaveCount(2);
      await originMinimap.locator(".conversation-minimap__tick").first().hover();
      await expectOutlineOpen(originMinimap.locator(".conversation-minimap__outline"));
      await expect(parentRows).toHaveCount(2);
      await expect(revisionRow).toBeVisible();
      await expect(revisionRow).toHaveAttribute("title", revisionPrompt);

      // Assert parent outline rows do not have markers in Variant B
      await expect(
        parentRows.locator(".conversation-minimap__outline-marker")
      ).toHaveCount(0);

      // Assert revision child rows do contain revision marker
      await expect(
        revisionRow.locator(".conversation-minimap__outline-marker--revision")
      ).toHaveCount(1);

      // Assert active parent row exists
      await expect(
        originMinimap.locator(".conversation-minimap__outline-row--active")
      ).toHaveCount(1);

      const [parentBox, revisionBox] = await Promise.all([
        parentRows.first().boundingBox(),
        revisionRow.boundingBox(),
      ]);
      expect(parentBox).not.toBeNull();
      expect(revisionBox).not.toBeNull();
      expect(revisionBox!.x).toBeGreaterThan(parentBox!.x + 10);

      await revisionRow.click();
      await expect(page.locator(".weft-split-view")).toBeVisible();
      await expect(page.locator(".weft-split-panel")).toContainText(revisionPrompt);

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
