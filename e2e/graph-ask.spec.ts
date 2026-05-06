import { expect, type Page, test } from "@playwright/test";

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

test.describe("Graph node Ask", () => {
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
});
