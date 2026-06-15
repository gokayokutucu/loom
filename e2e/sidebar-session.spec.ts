// E2E data authority classification: PURE_UI_RENDERING.
// This spec validates browser-like restoration over seeded UI state.
import { expect, type Page, test } from "@playwright/test";

const LAST_ACTIVE_LOOM_STORAGE_KEY = "loom:last-active-loom-v1";

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

function loomTab(page: Page, loomId: string) {
  return page.getByTestId(`sidebar-loom-${loomId}`);
}

test.describe("[pure-ui-rendering] Sidebar session restore", () => {
  test("keeps the tab title layer beneath the close action", async ({ page }) => {
    await openApp(page);

    const tab = page.locator(".conversation-tab").first();
    await tab.hover();

    const geometry = await tab.evaluate((element) => {
      const main = element.querySelector<HTMLElement>(".conversation-tab-main");
      const copy = element.querySelector<HTMLElement>(".conversation-tab-copy");
      const actions = element.querySelector<HTMLElement>(".conversation-tab-actions");
      const closeButton = element.querySelector<HTMLElement>(".conversation-tab-actions button");
      if (!main || !copy || !actions || !closeButton) return null;

      const tabRect = element.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const copyRect = copy.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      return {
        tabRight: tabRect.right,
        mainRight: mainRect.right,
        copyRight: copyRect.right,
        actionsLeft: actionsRect.left,
        mainZIndex: Number.parseInt(getComputedStyle(main).zIndex, 10),
        actionsZIndex: Number.parseInt(getComputedStyle(actions).zIndex, 10),
        closeBackground: getComputedStyle(closeButton).backgroundColor,
        fadeBackground: getComputedStyle(actions, "::before").backgroundImage,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.mainRight).toBeCloseTo(geometry!.tabRight, 0);
    expect(geometry!.copyRight).toBeGreaterThan(geometry!.actionsLeft);
    expect(geometry!.actionsZIndex).toBeGreaterThan(geometry!.mainZIndex);
    expect(geometry!.closeBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(geometry!.closeBackground).not.toBe("transparent");
    expect(geometry!.fadeBackground).toContain("linear-gradient");
  });

  test("falls back to New Loom when no valid session exists", async ({ page }) => {
    await page.addInitScript((storageKey) => {
      window.localStorage.clear();
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ activeLoomId: "missing-loom", updatedAt: Date.now() })
      );
    }, LAST_ACTIVE_LOOM_STORAGE_KEY);

    await openApp(page);

    await expect(page.getByRole("heading", { name: "Ask, search, or reference your AI web." })).toBeVisible();
  });

  test("restores the last active Loom tab and keeps it visible after reload", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.clear();
    });

    await page.reload();
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();

    const targetTab = loomTab(page, "c-integrations-mcp-tools");
    await targetTab.locator(".conversation-tab-main").click();
    await expect(targetTab).toHaveClass(/active/);

    await page.reload();
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();

    const restoredTab = loomTab(page, "c-integrations-mcp-tools");
    await expect(restoredTab).toHaveClass(/active/);
    await expect(restoredTab).toBeInViewport();
    await expect(page.getByRole("heading", { name: "MCP tool execution Weft" })).toBeVisible();
  });
});
