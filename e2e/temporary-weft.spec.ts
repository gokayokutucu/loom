// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function waitForWeftCount(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  expectedCount: number
) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const looms = await scenario.client.listLooms();
    const wefts = looms.filter((loom) => loom.kind === "weft");
    if (wefts.length === expectedCount) return wefts;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expectedCount} persisted Wefts.`);
}

async function waitForWeftTitles(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  expectedTitles: string[]
) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const looms = await scenario.client.listLooms();
    const wefts = looms.filter((loom) => loom.kind === "weft");
    const titles = wefts.map((loom) => loom.title);
    if (
      wefts.length === expectedTitles.length &&
      expectedTitles.every((title) => titles.includes(title))
    ) {
      return wefts;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Weft titles: ${expectedTitles.join(", ")}`);
}

async function permanentDeleteSidebarLoom(page: Page, loomId: string) {
  const tab = page.getByTestId(`sidebar-loom-${loomId}`);
  await expect(tab).toBeVisible();
  await tab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(tab).toHaveCount(0);
}

async function readAddressInputState(page: Page) {
  return page.getByLabel("Loom Address Bar").evaluate((node) => {
    const input = node as HTMLInputElement;
    return {
      value: input.value,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
    };
  });
}

async function closeAddressBarToComposer(page: Page) {
  const addressBar = page.getByLabel("Loom Address Bar");
  await addressBar.press("Escape");
  await addressBar.press("Escape");
}

test.describe("[product-service-backed] Temporary Weft workspace", () => {
  test("keeps the origin message anchored when opening a persisted Weft from a closed split", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Event Sourcing için kısa bir giriş yaz.");
      await expect(page.getByText("Deterministic E2E provider").first()).toBeVisible({
        timeout: 30_000,
      });

      const targetPrompt = "Rust ve Go servislerini .NET uygulamasına nasıl bağlarım?";
      await sendMainPrompt(page, targetPrompt);
      await expect(page.getByText(targetPrompt, { exact: true })).toBeVisible();
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });

      const targetArticle = page.locator(".qa-item").nth(1);
      await expect(targetArticle.getByText(targetPrompt, { exact: true })).toBeVisible();
      await targetArticle.scrollIntoViewIfNeeded();
      await targetArticle.getByRole("button", { name: /Start Weft from/i }).click();
      await expect(page.locator(".weft-split-view")).toBeVisible();

      const weftPanel = page.locator(".weft-split-panel");
      const weftEditor = weftPanel.getByRole("textbox", { name: "Prompt" });
      await expect(weftEditor).toBeFocused();
      await page.keyboard.insertText("IProcessor interface nasıl olmalı?");
      await weftPanel.getByRole("button", { name: "Send" }).click();
      await waitForWeftCount(scenario, 1);

      await page.getByRole("button", { name: "Close Flow panel" }).click();
      await expect(page.locator(".weft-split-view")).toHaveCount(0);

      const fullTranscript = page.locator(".chat-transcript").first();
      await fullTranscript.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await targetArticle.scrollIntoViewIfNeeded();
      const fullScrollBefore = await fullTranscript.evaluate((element) => element.scrollTop);
      expect(fullScrollBefore).toBeGreaterThan(0);

      await targetArticle.locator(".response-weft-count-trigger").click();
      const branchMenu = page.getByRole("menu", { name: "Weft branches" });
      await expect(branchMenu).toBeVisible();
      await branchMenu.getByRole("menuitem").first().click();

      const originTranscript = page.locator(".origin-split-panel .chat-transcript");
      await expect(originTranscript).toBeVisible();
      await expect(
        page
          .locator(".origin-split-panel .user-turn", {
            has: page.getByText(targetPrompt, { exact: true }),
          })
          .first()
      ).toBeVisible();
      await expect
        .poll(() => originTranscript.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("opens a temporary workspace on Weft click and persists only after first prompt", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    let createWeftRequests = 0;
    const createWeftRequestBodies: unknown[] = [];

    try {
      await page.route(/\/wefts$/, async (route) => {
        createWeftRequests += 1;
        createWeftRequestBodies.push(route.request().postDataJSON());
        await route.continue();
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Event Sourcing AWS üzerinde nasıl kurgulanır?");
      await expect(page.getByText("Deterministic E2E provider").first()).toBeVisible({
        timeout: 30_000,
      });
      const addressBar = page.getByLabel("Loom Address Bar");
      const originAddressPlaceholder = await addressBar.getAttribute("placeholder");
      expect(originAddressPlaceholder).toMatch(/Event Sourcing|AWS/i);
      await expect(page.getByRole("button", { name: /Start Weft from/i })).toBeVisible();
      expect(await waitForWeftCount(scenario, 0)).toEqual([]);

      await page.getByRole("button", { name: /Start Weft from/i }).first().click();
      await expect(page.locator(".weft-split-view")).toBeVisible();
      await expect(page.locator(".weft-split-panel")).toBeVisible();
      await page.locator(".weft-split-panel").click({ position: { x: 40, y: 40 } });
      await expect(addressBar).toHaveAttribute("placeholder", originAddressPlaceholder ?? "");
      await expect(addressBar).not.toHaveAttribute("placeholder", /temp-weft|temporary-weft/i);
      await addressBar.click();
      const temporaryAddressState = await readAddressInputState(page);
      expect(temporaryAddressState.value).toMatch(/^loom:\/\//);
      expect(temporaryAddressState.value).not.toMatch(/temp-weft|temporary-weft/i);
      expect(temporaryAddressState.selectionStart).toBe(0);
      expect(temporaryAddressState.selectionEnd).toBe(temporaryAddressState.value.length);
      await closeAddressBarToComposer(page);
      await expect(page.locator(".weft-split-panel").getByRole("textbox", { name: "Prompt" })).toBeFocused();
      expect(createWeftRequests).toBe(0);
      expect(await waitForWeftCount(scenario, 0)).toEqual([]);
      await expect(page.locator(".loom-graph-node--weft")).toHaveCount(0);

      await page
        .locator(".origin-split-panel")
        .getByRole("button", { name: /Focus temporary Flow from/i })
        .first()
        .click();
      expect(createWeftRequests).toBe(0);
      expect(await waitForWeftCount(scenario, 0)).toEqual([]);

      const weftPanel = page.locator(".weft-split-panel");
      const weftEditor = weftPanel.getByRole("textbox", { name: "Prompt" });
      await expect(weftEditor).toBeFocused();
      await page.keyboard.insertText("Bunu maliyet açısından değerlendir.");
      await weftPanel.getByRole("button", { name: "Send" }).click();

      const persistedWefts = await waitForWeftCount(scenario, 1);
      expect(createWeftRequests).toBe(1);
      expect(createWeftRequestBodies[0]).toMatchObject({
        initialPrompt: "Bunu maliyet açısından değerlendir.",
      });
      expect(persistedWefts[0]).toMatchObject({
        kind: "weft",
        weftKind: "exploration",
      });
      await waitForWeftTitles(scenario, ["Loom: Bunu maliyet açısından değerlendir."]);
      await expect(
        weftPanel.locator(".qa-item").getByText("Bunu maliyet açısından değerlendir.", {
          exact: true,
        })
      ).toBeVisible({
        timeout: 30_000,
      });
      await expect(weftPanel.locator(".qa-item")).not.toContainText(
        "Event Sourcing AWS üzerinde nasıl kurgulanır?"
      );
      await expect(addressBar).toHaveAttribute("placeholder", /Loom:/);

      await page.locator(".origin-split-panel").click({ position: { x: 40, y: 40 } });
      await expect(addressBar).toHaveAttribute("placeholder", /Event Sourcing|AWS/i);
      await expect(addressBar).not.toHaveAttribute("placeholder", /temp-weft|temporary-weft/i);
      await addressBar.click();
      const originAddressState = await readAddressInputState(page);
      expect(originAddressState.value).toMatch(/^loom:\/\//);
      expect(originAddressState.value).not.toMatch(/\/wefts\//);
      await closeAddressBarToComposer(page);
      await expect(page.locator(".origin-split-panel").getByRole("textbox", { name: "Prompt" })).toBeFocused();
      await page.locator(".weft-split-panel").click({ position: { x: 40, y: 40 } });
      await expect(addressBar).toHaveAttribute("placeholder", /Loom:/);
      await addressBar.click();
      const persistedWeftAddressState = await readAddressInputState(page);
      expect(persistedWeftAddressState.value).toMatch(/^loom:\/\//);
      expect(persistedWeftAddressState.value).toMatch(/\/wefts\//);
      await closeAddressBarToComposer(page);
      await expect(page.locator(".weft-split-panel").getByRole("textbox", { name: "Prompt" })).toBeFocused();

      await page
        .locator(".origin-split-panel")
        .getByRole("button", { name: /Start Weft from/i })
        .first()
        .click();
      expect(createWeftRequests).toBe(1);

      await page.getByRole("button", { name: "Close Flow panel" }).click();
      await expect(page.locator(".weft-split-view")).toHaveCount(0);

      await page.getByRole("button", { name: /Start Weft from/i }).first().click();
      await expect(page.locator(".weft-split-view")).toBeVisible();
      expect(createWeftRequests).toBe(1);
      await page
        .locator(".weft-split-panel")
        .getByRole("textbox", { name: "Prompt" })
        .click();
      await page.keyboard.insertText("İkinci olasılığı güvenlik açısından değerlendir.");
      await page.locator(".weft-split-panel").getByRole("button", { name: "Send" }).click();

      await waitForWeftCount(scenario, 2);
      expect(createWeftRequests).toBe(2);
      expect(createWeftRequestBodies[1]).toMatchObject({
        initialPrompt: "İkinci olasılığı güvenlik açısından değerlendir.",
      });
      await waitForWeftTitles(scenario, [
        "Loom: Bunu maliyet açısından değerlendir.",
        "Loom: İkinci olasılığı güvenlik açısından değerlendir.",
      ]);
      await expect(page.locator(".origin-split-panel .prompt-revision-action-counter")).toHaveCount(0);
      const originWeftButton = page.locator(".origin-split-panel .response-weft-chip").first();
      const originWeftCountTrigger = page
        .locator(".origin-split-panel .response-weft-action-cluster")
        .first()
        .locator(".response-weft-count-trigger");
      await expect(originWeftCountTrigger).toContainText("2");
      await expect(originWeftButton).toHaveClass(/is-wefted/);
      await expect(originWeftButton).toHaveAttribute(
        "aria-pressed",
        "true"
      );

      await originWeftCountTrigger.click();
      await expect(page.getByRole("menu", { name: "Weft branches" })).toBeVisible();
      await originWeftCountTrigger.click();
      await expect(page.getByRole("menu", { name: "Weft branches" })).toHaveCount(0);

      await expect(page.getByRole("menu", { name: "Weft branches" })).toHaveCount(0);

      await originWeftCountTrigger.click();
      const originWeftPicker = page.getByRole("menu", { name: "Weft branches" });
      await expect(originWeftPicker).toBeVisible();
      await expect(originWeftPicker.getByRole("menuitem")).toHaveCount(2);
      await expect(originWeftPicker).not.toContainText("Revision:");
      await expect(originWeftPicker).not.toContainText("Loom from");
      await expect(originWeftPicker).toContainText("Loom: Bunu maliyet açısından değerlendir.");
      await expect(originWeftPicker).toContainText(
        "Loom: İkinci olasılığı güvenlik açısından değerlendir."
      );
      await expect(originWeftPicker).toContainText(/Today .*:/);
      await originWeftPicker.getByRole("menuitem").first().click();
      await expect(page.locator(".weft-split-panel")).toContainText("maliyet");
      await expect(page.locator(".weft-split-panel")).not.toContainText("güvenlik");

      await originWeftButton.click();
      await expect(page.getByRole("menu", { name: "Weft branches" })).toHaveCount(0);
      await expect(page.locator(".weft-split-panel").getByRole("textbox", { name: "Prompt" }))
        .toBeFocused();

      await page.getByRole("button", { name: /Open Event Sourcing AWS/i }).first().click();
      await page.getByRole("button", { name: "Toggle Graph View" }).click();
      const graphResponseNode = page
        .locator(".loom-graph-node--response", { has: page.locator(".weft-count-badge") })
        .first();
      await expect(graphResponseNode).toBeVisible();
      const graphWeftButton = graphResponseNode.getByRole("button", {
        name: /Open Weft list from/i,
      });
      await graphWeftButton.click();
      await expect(graphWeftButton).toHaveAttribute("aria-expanded", "true");
      const graphWeftPicker = page.getByRole("menu", { name: "Weft branches" });
      await expect(graphWeftPicker).toBeVisible();
      await expect(graphWeftPicker.getByRole("menuitem")).toHaveCount(2);
      await expect(graphWeftPicker).not.toContainText("Revision:");
      await expect(graphWeftPicker).not.toContainText("Loom from");
      await expect(graphWeftPicker).toContainText("Loom: Bunu maliyet açısından değerlendir.");
      await expect(graphWeftPicker).toContainText(
        "Loom: İkinci olasılığı güvenlik açısından değerlendir."
      );
      await expect(graphWeftPicker).toContainText(/Today .*:/);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("permanent delete immediately removes exploration Weft counters from surface and graph", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const prompt = "Event Sourcing delete sonrası Weft sayacı nasıl davranmalı?";
      await sendMainPrompt(page, prompt);
      await expect(page.getByText("Deterministic E2E provider").first()).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole("button", { name: /Start Weft from/i }).first().click();
      const weftPanel = page.locator(".weft-split-panel");
      await expect(weftPanel).toBeVisible();
      await weftPanel.getByRole("textbox", { name: "Prompt" }).click();
      await page.keyboard.insertText("Bu dalı kısa açıkla.");
      await weftPanel.getByRole("button", { name: "Send" }).click();

      const [weft] = await waitForWeftCount(scenario, 1);
      const originLoom = (await scenario.client.listLooms()).find((loom) => loom.kind === "loom");
      expect(originLoom).toBeTruthy();
      await expect(page.locator(".origin-split-panel .response-weft-chip.is-wefted")).toHaveCount(1);
      await expect(page.locator(".origin-split-panel .response-weft-count-trigger")).toContainText(
        "1"
      );

      await weftPanel.getByRole("button", { name: "Return to Origin" }).click();
      await page.getByTestId(`sidebar-loom-${originLoom!.loomId}`).click();
      await page.getByRole("button", { name: "Toggle Graph View" }).click();
      const graphResponseNode = page
        .locator(".loom-graph-node--response", { has: page.locator(".weft-count-badge") })
        .first();
      await expect(graphResponseNode).toBeVisible();
      await expect(graphResponseNode.locator(".weft-count-badge")).toContainText("1");
      await graphResponseNode.click();
      const graphPreviewModal = page.locator(".graph-response-preview-modal");
      await expect(graphPreviewModal).toBeVisible();
      await expect(graphPreviewModal.locator(".weft-count-badge")).toContainText("1");
      await page.getByRole("button", { name: "Close response preview" }).click();
      await page.getByTestId(`sidebar-loom-${originLoom!.loomId}`).click();
      await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();

      await permanentDeleteSidebarLoom(page, weft.loomId);
      await expect.poll(async () => (await scenario.client.listLooms()).filter((loom) => loom.kind === "weft").length)
        .toBe(0);
      await page.getByTestId(`sidebar-loom-${originLoom!.loomId}`).click();
      if ((await page.getByRole("heading", { name: "Weft-aware Loom graph" }).count()) === 0) {
        await page.getByRole("button", { name: "Toggle Graph View" }).click();
      }
      await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();

      await expect(page.locator(".loom-graph-node--response .weft-count-badge")).toHaveCount(0);
      const baseGraphResponseNode = page
        .locator(".loom-graph-node--response", { hasText: prompt })
        .first();
      await expect(baseGraphResponseNode).toBeVisible();
      await baseGraphResponseNode.click();
      await expect(graphPreviewModal).toBeVisible();
      await expect(graphPreviewModal.locator(".weft-count-badge")).toHaveCount(0);
      await expect(graphPreviewModal.locator(".graph-response-preview-weft.is-wefted")).toHaveCount(0);
      await page.getByRole("button", { name: "Close response preview" }).click();

      await page.getByRole("button", { name: "Toggle Graph View" }).click();
      await expect(page.locator(".response-weft-count-trigger")).toHaveCount(0);
      await expect(page.locator(".response-weft-chip.is-wefted")).toHaveCount(0);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});
