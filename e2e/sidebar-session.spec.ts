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
