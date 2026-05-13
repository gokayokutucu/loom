// E2E data authority classification: LEGACY_TYPESCRIPT_LOCAL.
// This spec covers legacy graph continuation UI state until graph continuation flows are service-backed.
import { expect, type Locator, type Page, test } from "@playwright/test";

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

async function openContinuationComposer(page: Page) {
  await page.getByRole("button", { name: "Continue Loom" }).click();
  const composer = page.getByTestId("graph-continuation-composer");
  await expect(composer).toBeVisible();
  return composer;
}

async function openContinuationComposerFromTerminalNode(page: Page) {
  const terminalButton = page.getByRole("button", {
    name: /Continue from Plugin boundary should not leak shell assumptions/,
  });
  await expect(terminalButton).toBeVisible();
  await terminalButton.click();
  const composer = page.getByTestId("graph-continuation-composer");
  await expect(composer).toBeVisible();
  return composer;
}

async function expectFocusedNodeNearTopAndCentered(page: Page, focusedNode: Locator) {
  await expect
    .poll(
      async () => {
        const shellBox = await page.locator(".loom-graph-shell").boundingBox();
        const nodeBox = await focusedNode.boundingBox();
        if (!shellBox || !nodeBox) return false;

        const topOffset = nodeBox.y - shellBox.y;
        const shellCenter = shellBox.x + shellBox.width / 2;
        const nodeCenter = nodeBox.x + nodeBox.width / 2;
        return (
          topOffset >= 10 &&
          topOffset <= 45 &&
          Math.abs(nodeCenter - shellCenter) <= 40
        );
      },
      { timeout: 3000 }
    )
    .toBe(true);
}

async function graphNodeY(node: Locator) {
  return node.evaluate((element) => {
    const transform = (element as HTMLElement).style.transform;
    const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (!match) return Number.NaN;
    return Number(match[2]);
  });
}

test.describe("[legacy-typescript-local] Graph continuation composer", () => {
  test("shows an orange Continue Loom button inside the floating graph controls", async ({
    page,
  }) => {
    await openMcpGraph(page);

    const controls = page.locator(".loom-graph-control-group");
    const separator = controls.locator(".loom-graph-control-separator");
    const button = page.getByRole("button", { name: "Continue Loom" });
    await expect(button).toBeVisible();
    await expect(separator).toBeVisible();

    const controlsBox = await controls.boundingBox();
    const buttonBox = await button.boundingBox();
    const separatorBox = await separator.boundingBox();
    expect(controlsBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(separatorBox).not.toBeNull();
    expect(buttonBox!.width).toBe(30);
    expect(buttonBox!.height).toBe(30);
    expect(buttonBox!.y).toBeGreaterThan(separatorBox!.y);
    expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(
      controlsBox!.y + controlsBox!.height
    );
  });

  test("shows an orange terminal plus button under the latest Response", async ({ page }) => {
    await openMcpGraph(page);

    const terminalButton = page.getByRole("button", {
      name: /Continue from Plugin boundary should not leak shell assumptions/,
    });
    await expect(terminalButton).toBeVisible();
    const buttonBox = await terminalButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.width).toBeGreaterThanOrEqual(29.5);
    expect(buttonBox!.width).toBeLessThanOrEqual(30.5);
    expect(buttonBox!.height).toBeGreaterThanOrEqual(29.5);
    expect(buttonBox!.height).toBeLessThanOrEqual(30.5);

    const composer = await openContinuationComposerFromTerminalNode(page);
    await expect(composer.getByRole("textbox", { name: "Prompt" })).toBeFocused();
    await expect(terminalButton).toHaveCount(0);
  });

  test("opens graph composer attach, references, and model menus above the graph", async ({
    page,
  }) => {
    await openMcpGraph(page);
    const composer = await openContinuationComposer(page);

    await composer.getByRole("button", { name: "Attach" }).click();
    await expect(page.getByRole("dialog", { name: "Attach content" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Attach content" })).toContainText(
      "Add Loom references or files"
    );

    await page.keyboard.press("Escape");
    await composer.getByRole("button", { name: "References" }).click();
    await expect(page.locator(".linked-reference-dropdown")).toBeVisible();

    await page.keyboard.press("Escape");
    await composer.getByRole("button", { name: "Select model" }).click();
    const modelMenu = page.getByRole("menu", { name: "Select model and response mode" });
    await expect(modelMenu).toBeVisible();
    await expect(modelMenu.getByRole("menuitemradio", { name: "Demo Main Response" })).toBeVisible();
    await expect(modelMenu.getByRole("menuitemradio", { name: /Auto/ })).toBeVisible();
    await expect(modelMenu.getByRole("menuitemradio", { name: /Instant/ })).toBeVisible();
    await expect(modelMenu.getByRole("menuitemradio", { name: /Thinking/ })).toBeVisible();
  });

  test("focuses the latest Response and opens the floating composer", async ({ page }) => {
    await openMcpGraph(page);
    const composer = await openContinuationComposer(page);

    const latestNode = page.locator(
      '[data-id="loom:c-integrations:response:r-plugin-boundary"] .loom-graph-node--response'
    );
    await expect(latestNode).toHaveClass(/is-focused/);
    await expect(composer.getByRole("textbox", { name: "Prompt" })).toBeFocused();
    await expect(composer.getByLabel("Close Continue Loom composer")).toBeVisible();
  });

  test("positions the focused latest Response near the graph top and center", async ({
    page,
  }) => {
    await openMcpGraph(page);
    await openContinuationComposer(page);

    const latestNode = page.locator(
      '[data-id="loom:c-integrations:response:r-plugin-boundary"] .loom-graph-node--response'
    );
    await expectFocusedNodeNearTopAndCentered(page, latestNode);
  });

  test("submits a Main Model continuation and focuses the new Response", async ({ page }) => {
    await openMcpGraph(page);
    const composer = await openContinuationComposer(page);
    const prompt = "How should plugin adapters report host capabilities?";

    const promptEditor = composer.getByRole("textbox", { name: "Prompt" });
    await expect(promptEditor).toBeFocused();
    await promptEditor.click();
    await page.keyboard.insertText(prompt);
    await promptEditor.press("Enter");

    const newWrapper = page.locator(".react-flow__node").filter({ hasText: prompt }).last();
    const newNode = newWrapper.locator(".loom-graph-node--response");
    await expect(newNode).toBeVisible();
    await expect(newNode).toHaveClass(/is-focused/);
    await expect(page.locator(".loom-graph-edge-label").filter({ hasText: prompt })).toBeVisible();
    await expect(page.getByTestId("graph-continuation-composer")).toHaveCount(0);

    const previousWrapper = page.locator(
      '[data-id="loom:c-integrations:response:r-plugin-boundary"]'
    );
    const previousY = await graphNodeY(previousWrapper);
    const newY = await graphNodeY(newWrapper);
    expect(newY).toBeGreaterThan(previousY);
    await expectFocusedNodeNearTopAndCentered(page, newNode);
    await expect(page.getByRole("button", { name: `Continue from ${prompt}` })).toBeVisible();
  });

  test("closes the floating composer without leaving Graph View", async ({ page }) => {
    await openMcpGraph(page);
    const composer = await openContinuationComposer(page);

    await composer.getByLabel("Close Continue Loom composer").click();

    await expect(page.getByTestId("graph-continuation-composer")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();
  });
});
