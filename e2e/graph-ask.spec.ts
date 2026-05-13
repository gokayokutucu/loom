// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service Quick Ask proof.
// - LEGACY_TYPESCRIPT_LOCAL for seeded Graph Ask UI state below.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";
import {
  buildAskContextPayload,
  createHeuristicResponseContextCapsule,
  resolveFocusedAskIntent,
} from "../src/services/responseContextCapsule";
import type { ResponseItem } from "../src/types";

interface ExportedResponse {
  responseId: string;
  role: "user" | "assistant";
  content: string;
  sequenceIndex: number;
}

interface LoomExportJson {
  responses: ExportedResponse[];
}

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "loom-ai-provider-settings-v1",
      JSON.stringify({ demo: { mockResponsesEnabled: true } })
    );
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openMcpGraph(page: Page) {
  await openApp(page);
  await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
  if ((await page.getByRole("heading", { name: "Weft-aware Loom graph" }).count()) === 0) {
    await page.getByRole("button", { name: "Toggle Graph View" }).click();
  }
  await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();
  await expect(page.getByPlaceholder("MCP and plugin integration notes")).toBeVisible();
}

async function clickFocusedGraphAsk(page: Page) {
  await page.mouse.move(900, 120);
  await expect(page.getByTestId("loom-sidebar")).not.toHaveAttribute(
    "data-sidebar-flyout",
    "true"
  );
  const responseNode = page.locator(
    '[data-id="loom:c-integrations:response:r-plugin-boundary"] .loom-graph-node--response'
  );
  await responseNode.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const askButton = responseNode.getByRole("button", { name: "Ask from this response" });
  await expect(askButton).toBeVisible();
  await askButton.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible();
  return popup;
}

async function selectResponseText(page: Page, responseId: string, selectedText: string) {
  await page.evaluate(
    ({ responseId: targetResponseId, selectedText: targetText }) => {
      const article = document.querySelector(`[data-response-id="${targetResponseId}"]`);
      const body = article?.querySelector(".assistant-body");
      if (!article || !body) throw new Error("Response body not found");
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const text = current.textContent ?? "";
        const start = text.indexOf(targetText);
        if (start >= 0) {
          const range = document.createRange();
          range.setStart(current, start);
          range.setEnd(current, start + targetText.length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          article.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return;
        }
        current = walker.nextNode();
      }
      throw new Error("Selection text not found");
    },
    { responseId, selectedText }
  );
}

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
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
  const exportedJson = JSON.parse(
    Buffer.from(exported.contentBase64, "base64").toString("utf8")
  ) as LoomExportJson;
  return exportedJson.responses;
}

function expectNoForbiddenPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("raw_thinking");
  expect(serialized).not.toContain("thinking_text");
  expect(serialized).not.toContain("chain_of_thought");
  expect(serialized).not.toContain("hidden_reasoning");
}

test.describe("[product-service-backed] Quick Ask product proof", () => {
  test("[product-service-backed] uses selected fragment, source context, follow-up turns, and Convert to Weft through loom-service", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const quickAskUrls: string[] = [];
    await page.route(/\/ask\/quick$/, async (route) => {
      quickAskUrls.push(route.request().url());
      await route.continue();
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "MCP, CQRS ve Event Sourcing ilişkisini anlat.");
      await expect(page.getByText("Model Context Protocol").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("MCP")
      );
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;
      const responses = await exportedLoomResponses(scenario, loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("MCP")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "MCP");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await expect(popup.getByTestId("ask-context")).toContainText("Context Fragment");
      await expect(popup.getByTestId("ask-context")).toContainText("MCP");

      await popup.getByLabel("Ask question").fill("açılımı nedir");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.getByTestId("ask-answer")).toContainText(
        "MCP = Model Context Protocol"
      );
      await expect(popup.getByTestId("ask-answer")).toContainText("plugin entegrasyonu");
      await expect(popup.getByTestId("ask-answer")).toContainText("session");
      await expect(popup.getByTestId("ask-answer")).not.toContainText(
        "Microsoft Component Platform"
      );

      await popup.getByLabel("Ask question").fill("Event Sourcing ile ilişkisi ne?");
      await popup.getByRole("button", { name: /^Ask$/ }).click();
      await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
      await expect(popup.getByTestId("ask-answer-list")).toContainText(
        "Önceki Quick Ask turundaki açılımı koruyarak"
      );
      await expect(popup.getByTestId("ask-answer-list")).toContainText(
        "MCP seçili fragment olarak birincil kalır"
      );
      await expect(popup.getByTestId("ask-answer-list")).toContainText("Event Sourcing");
      await expect(popup.getByTestId("ask-answer-list")).not.toContainText("raw_thinking");
      await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Context Capsule");
      expect(quickAskUrls).toHaveLength(2);

      await popup.getByRole("button", { name: "Convert to Weft" }).click();
      const weftPanel = page.locator(".weft-split-panel").last();
      await expect(weftPanel).toBeVisible();
      await expect(weftPanel).toContainText("açılımı nedir");
      await expect(weftPanel).toContainText("Event Sourcing ile ilişkisi ne?");
      await expect(weftPanel).toContainText("MCP = Model Context Protocol");
      await expect(weftPanel).not.toContainText("Hidden context");
      await expect(weftPanel).not.toContainText("WeftOriginContextSnapshot");

      const wefts = await scenario.fetchJson<{ wefts: Array<{ loomId: string }> }>(
        `/responses/${encodeURIComponent(assistant!.responseId)}/wefts`
      );
      expect(wefts.wefts.length).toBeGreaterThan(0);
      const weftResponses = await exportedLoomResponses(scenario, wefts.wefts[0].loomId);
      expect(weftResponses.map((response) => response.content).join("\n")).toContain(
        "Event Sourcing ile ilişkisi ne?"
      );
      expectNoForbiddenPayload(wefts);
      expectNoForbiddenPayload(weftResponses);
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});

test.describe("[legacy-typescript-local] Graph node Ask", () => {
  test("builds acronym selected-fragment payload with direct intent before source context", () => {
    const response: ResponseItem = {
      id: "r-host-shell",
      title: "Host shell adapters keep Electron optional",
      address: "loom://engineering/mcp-plugin-integration/loom/host-shell/r-host-shell",
      question: "How should the web prototype stay Electron-ready?",
      answer: [
        "In Electron the same adapter can delegate to the main process with IPC.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    };
    const capsule = createHeuristicResponseContextCapsule(response, "c-integrations", "IPC");
    const payload = buildAskContextPayload({
      response,
      selectedText: "IPC",
      userQuestion: "açılımı ne",
      capsule,
    });

    expect(resolveFocusedAskIntent({
      selectedText: "IPC",
      currentQuestion: "açılımı ne",
    })).toBe("acronym_expansion");
    expect(payload.focusedIntent).toBe("acronym_expansion");
    expect(payload.context[0]).toContain("Current task:");
    expect(payload.context[0]).toContain('Selected fragment:\n"IPC"');
    expect(payload.context[0]).toContain('User question:\n"açılımı ne"');
    expect(payload.context[0]).toContain("Detected intent:\nacronym_expansion");
    expect(payload.context[0]).toContain('The answer should start with: "IPC = <expansion>".');
    expect(payload.context[0]).not.toContain("Host shell adapters keep Electron optional");
    expect(payload.backgroundContext[0]).toContain("Source context clues:");
    expect(payload.backgroundContext[0]).toContain("Use source context clues to disambiguate");
    expect(payload.backgroundContext[1]).toContain("Background source context, use only if needed:");
    expect(payload.backgroundContext[1]).toContain("Host shell adapters keep Electron optional");
    expect(payload.context[0].indexOf('User question:\n"açılımı ne"')).toBeLessThan(
      payload.backgroundContext[1].indexOf("Host shell adapters keep Electron optional") +
        payload.context[0].length
    );
  });

  test("builds cautious acronym payload when source does not define expansion", () => {
    const response: ResponseItem = {
      id: "r-ambiguous",
      title: "Short source without expansion",
      address: "loom://test/ambiguous",
      question: "What is noted?",
      answer: ["ABC appears in a short note without any explicit expansion."],
      suggestedLinks: [],
      bookmarkedLinks: [],
    };
    const capsule = createHeuristicResponseContextCapsule(response, "c-test", "ABC");
    const payload = buildAskContextPayload({
      response,
      selectedText: "ABC",
      userQuestion: "açılımı nedir",
      capsule,
    });

    expect(payload.focusedIntent).toBe("acronym_expansion");
    expect(payload.context[0]).toContain("answer with cautious wording");
    expect(payload.context[0]).toContain("Do not choose an unrelated expansion");
    expect(payload.backgroundContext[0]).toContain("Source context clues:");
  });

  test("uses selected Response text as primary Quick Question fragment context", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    const response = page.locator('[data-response-id="r-plugin-boundary"]');
    await expect(response).toBeVisible();

    await selectResponseText(page, "r-plugin-boundary", "MCP-backed tool");

    const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
    await expect(selectionToolbar).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "Quick Question" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

    const popup = page.getByRole("dialog");
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId("ask-context")).toContainText("Context Fragment");
    await expect(popup.getByTestId("ask-context")).toContainText("MCP-backed tool");

    await popup.getByLabel("Ask question").fill("What does this mean?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();

    await expect(popup.getByTestId("ask-answer")).toContainText(
      "selected fragment MCP-backed tool"
    );
    await expect(popup.getByTestId("ask-answer")).toContainText(
      "Full source text was not sent"
    );

    await popup.getByLabel("Ask question").fill("Follow up from that fragment.");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "selected fragment MCP-backed tool"
    );
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "includes previous quick turns"
    );
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "not forced into a single line"
    );
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Context Capsule");
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Response Capsule");
  });

  test("answers the current selected-fragment acronym question before source context", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.locator('[data-response-id="r-plugin-boundary"]')).toBeVisible();

    await selectResponseText(page, "r-plugin-boundary", "MCP");

    const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
    await expect(selectionToolbar).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "Quick Question" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

    const popup = page.getByRole("dialog");
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId("ask-context")).toContainText("Context Fragment");
    await expect(popup.getByTestId("ask-context")).toContainText("MCP");

    await popup.getByLabel("Ask question").fill("açılımı");
    await popup.getByRole("button", { name: /^Ask$/ }).click();

    await expect(popup.getByTestId("ask-answer")).toContainText(
      "MCP = Model Context Protocol"
    );
    await expect(popup.getByTestId("ask-answer")).toContainText(
      "plugin entegrasyonu"
    );
    await expect(popup.getByTestId("ask-answer")).not.toContainText(
      "Microsoft Component Platform"
    );
    await expect(popup.getByTestId("ask-answer")).not.toContainText(
      "stays anchored to"
    );

    await popup.getByLabel("Ask question").fill("kaynakla ilişkisi ne?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "selected fragment MCP"
    );
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "includes previous quick turns"
    );
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Context Capsule");
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Response Capsule");
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Cep Kapsülü");
  });

  test("answers IPC acronym expansion directly from selected fragment", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.locator('[data-response-id="r-host-shell"]')).toBeVisible();

    await selectResponseText(page, "r-host-shell", "IPC");

    const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
    await expect(selectionToolbar).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "Quick Question" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

    const popup = page.getByRole("dialog");
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId("ask-context")).toContainText("Context Fragment");
    await expect(popup.getByTestId("ask-context")).toContainText("IPC");

    await popup.getByLabel("Ask question").fill("açılımı ne");
    await popup.getByRole("button", { name: /^Ask$/ }).click();

    await expect(popup.getByTestId("ask-answer")).toContainText(
      "IPC = Inter-Process Communication"
    );
    await expect(popup.getByTestId("ask-answer")).toContainText(
      "current question about the selected fragment"
    );
    await expect(popup.getByTestId("ask-answer")).not.toContainText(
      "adapterin açıklaması nedir?"
    );
    await expect(popup.getByTestId("ask-answer")).not.toContainText(
      "Host shell adapters"
    );
  });

  test("opens existing Ask popup with full Response context and focused input", async ({
    page,
  }) => {
    await openMcpGraph(page);
    const popup = await clickFocusedGraphAsk(page);

    await expect(popup.getByTestId("ask-context")).toContainText(
      "Plugins should attach to Loom objects"
    );
    await expect(popup.getByTestId("ask-context")).toContainText(
      "type PluginContribution"
    );
    await expect(popup.getByLabel("Ask question")).toBeFocused();
  });

  test("opens as a centered modal that blocks Graph controls", async ({ page }) => {
    await openMcpGraph(page);
    const popup = await clickFocusedGraphAsk(page);
    const popupBox = await popup.boundingBox();
    const viewport = page.viewportSize();

    expect(popupBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(Math.abs(popupBox!.x + popupBox!.width / 2 - viewport!.width / 2)).toBeLessThan(12);
    expect(Math.abs(popupBox!.y + popupBox!.height / 2 - viewport!.height / 2)).toBeLessThan(12);

    const controlsBox = await page.locator(".loom-graph-controls").boundingBox();
    expect(controlsBox).not.toBeNull();
    const hitTarget = await page.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return {
          isBackdrop: Boolean(element?.closest(".ask-modal-backdrop")),
          className: element instanceof HTMLElement ? element.className : "",
        };
      },
      {
        x: controlsBox!.x + controlsBox!.width / 2,
        y: controlsBox!.y + controlsBox!.height / 2,
      }
    );
    expect(hitTarget.isBackdrop).toBe(true);
  });

  test("keeps long Response context internally scrollable", async ({ page }) => {
    await openMcpGraph(page);
    const popup = await clickFocusedGraphAsk(page);
    const context = popup.getByTestId("ask-context").locator("blockquote");

    await expect(context).toBeVisible();
    const contextMetrics = await context.evaluate((element) => ({
        scrollable: element.scrollHeight > element.clientHeight,
        maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
      }));
    expect(contextMetrics.scrollable).toBe(true);
    expect(contextMetrics.maxHeight).toBeGreaterThan(0);
    expect(contextMetrics.maxHeight).toBeLessThanOrEqual(240);

    const popupBox = await popup.boundingBox();
    expect(popupBox).not.toBeNull();
    expect(popupBox!.y).toBeGreaterThanOrEqual(0);
    expect(popupBox!.y + popupBox!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height
    );
  });

  test("supports repeated quick answers without Bookmark action", async ({ page }) => {
    await openMcpGraph(page);
    const popup = await clickFocusedGraphAsk(page);

    await popup.getByLabel("Ask question").fill("What is the plugin boundary?");
    await popup.getByLabel("Ask question").press("Enter");

    await expect(popup.getByTestId("ask-answer")).toHaveCount(1);
    await expect(popup.getByTestId("ask-answer")).toContainText("Demo quick answer");
    await expect(popup.getByLabel("Ask question")).toBeEnabled();
    await expect(popup.getByLabel("Ask question")).toHaveValue("");
    await expect(popup.getByRole("button", { name: "Bookmark" })).toHaveCount(0);

    await popup.getByLabel("Ask question").fill("What about MCP tools?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();

    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
    await expect(popup.getByTestId("ask-answer-list")).toBeVisible();
    await expect(popup.getByRole("button", { name: "Convert to Weft" })).toBeEnabled();
  });

  test("Response-created Weft visible transcript starts at the origin Q/A pair", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    const originResponse = page.locator('[data-response-id="r-plugin-boundary"]');
    await expect(originResponse).toBeVisible();

    await originResponse
      .getByRole("button", { name: /Start Weft from Plugin boundary should not leak shell assumptions/ })
      .click();

    const weftPanel = page.locator(".weft-split-panel").last();
    await expect(weftPanel).toBeVisible();
    await expect(weftPanel).toContainText("Where should plugin behavior attach?");
    await expect(weftPanel).toContainText("Plugins should attach to Loom objects");
    await expect(weftPanel).not.toContainText("How should the web prototype stay Electron-ready?");
    await expect(weftPanel).not.toContainText("Keep the renderer written as if it is running in a browser");
    await expect(weftPanel).not.toContainText("WeftOriginContextSnapshot");
    await expect(weftPanel).not.toContainText("Hidden context");
    await expect(weftPanel).not.toContainText("Context Capsule");
  });

  test("discards the temporary Ask session when the popup closes", async ({ page }) => {
    await openMcpGraph(page);
    let popup = await clickFocusedGraphAsk(page);

    await popup.getByLabel("Ask question").fill("What is the plugin boundary?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(1);
    await popup.getByRole("button", { name: "Close Ask" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    popup = await clickFocusedGraphAsk(page);
    await expect(popup.getByTestId("ask-answer")).toHaveCount(0);
    await expect(popup.getByLabel("Ask question")).toHaveValue("");
  });

  test("converts Ask result to a visible Weft and reuses it on repeat conversion", async ({
    page,
  }) => {
    await openMcpGraph(page);
    await page.getByRole("button", { name: "Continue Loom", exact: true }).click();
    await expect(page.getByTestId("graph-continuation-composer")).toBeVisible();

    let popup = await clickFocusedGraphAsk(page);
    await popup.getByLabel("Ask question").fill("Turn this into a Weft.");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toContainText("Demo quick answer");
    await popup.getByLabel("Ask question").fill("Add a second Ask turn.");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
    await popup.getByRole("button", { name: "Convert to Weft" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("graph-continuation-composer")).toHaveCount(0);
    const convertedWeft = page.locator(".loom-graph-node--weft").filter({
      hasText: "Loom: Plugin boundary should not leak shell assumptions",
    });
    await expect(convertedWeft).toBeVisible();
    await expect(convertedWeft).toHaveClass(/is-focused/);
    await expect(page.locator(".loom-graph-node--response").filter({
      hasText: "Turn this into a Weft.",
    })).toBeVisible();
    await expect(page.locator(".loom-graph-node--response").filter({
      hasText: "Add a second Ask turn.",
    })).toBeVisible();
    await expect(page.locator(".loom-graph-edge-label").filter({
      hasText: "Weft from here",
    })).toHaveCount(2);
    const weftCount = await page.locator(".loom-graph-node--weft").count();

    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();
    popup = await clickFocusedGraphAsk(page);
    await popup.getByLabel("Ask question").fill("Try converting again.");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toContainText("Demo quick answer");
    await popup.getByRole("button", { name: "Convert to Weft" }).click();

    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();
    await expect(page.locator(".loom-graph-node--weft")).toHaveCount(weftCount);
  });

  test("Quick Ask Convert Weft visible transcript starts with Ask turns only", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.locator('[data-response-id="r-plugin-boundary"]')).toBeVisible();

    await selectResponseText(page, "r-plugin-boundary", "MCP-backed tool");
    const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
    await expect(selectionToolbar).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "Quick Question" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

    const popup = page.getByRole("dialog");
    await popup.getByLabel("Ask question").fill("What does this selected tool boundary mean?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toContainText("Demo quick answer");
    await popup.getByLabel("Ask question").fill("How should I use that distinction?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);

    const answerText = await popup.getByTestId("ask-answer").last().innerText();
    expect(answerText.split(/[.!?]\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(2);

    await popup.getByRole("button", { name: "Convert to Weft" }).click();

    const weftPanel = page.locator(".weft-split-panel").last();
    await expect(weftPanel).toBeVisible();
    await expect(weftPanel).toContainText("What does this selected tool boundary mean?");
    await expect(weftPanel).toContainText("How should I use that distinction?");
    await expect(weftPanel).toContainText("Demo quick answer");
    await expect(weftPanel).not.toContainText("Where should plugin behavior attach?");
    await expect(weftPanel).not.toContainText("Plugins should attach to Loom objects");
    await expect(weftPanel).not.toContainText("WeftOriginContextSnapshot");
    await expect(weftPanel).not.toContainText("Hidden context");
    await expect(weftPanel).not.toContainText("Response Capsule");
  });
});
