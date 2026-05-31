// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

interface BookmarkDto {
  bookmarkId: string;
  targetKind: string;
  targetId?: string;
  targetUri?: string;
  title: string;
  metadata?: unknown;
}

interface BookmarkListResponse {
  bookmarks: BookmarkDto[];
}

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function readFocusedAddress(page: Page) {
  const addressInput = page.getByLabel("Loom Address Bar");
  await addressInput.click();
  await expect(addressInput).toHaveValue(/loom:\/\//);
  const value = await addressInput.inputValue();
  await addressInput.press("Escape");
  return value;
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

async function waitForBookmarks(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  count: number
) {
  await expect
    .poll(async () => {
      const listed = await scenario.fetchJson<BookmarkListResponse>("/bookmarks");
      return listed.bookmarks.length;
    })
    .toBe(count);
  return scenario.fetchJson<BookmarkListResponse>("/bookmarks");
}

function expectNoForbiddenPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("raw_thinking");
  expect(serialized).not.toContain("thinking_text");
  expect(serialized).not.toContain("chain_of_thought");
  expect(serialized).not.toContain("hidden_reasoning");
}

test.describe("[product-service-backed] topbar Bookmark authority", () => {
  test("bookmarks the Main Loom root from the topbar without selecting the first response", async ({
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

      await sendMainPrompt(
        page,
        "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat"
      );
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });

      const rootLoom = (await scenario.client.listLooms()).find((loom) =>
        loom.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;

      const address = await readFocusedAddress(page);
      expect(address).toContain("loom://");
      expect(address).not.toContain("/r/");

      const firstResponseBookmark = page.locator(".response-bookmark-chip").first();
      await expect(firstResponseBookmark).toHaveAttribute("aria-pressed", "false");

      const topbarBookmark = page.getByRole("button", { name: "Bookmark Address" });
      await expect(topbarBookmark).toBeVisible();
      await topbarBookmark.click();
      await expect(page.getByRole("button", { name: "Address bookmarked" })).toBeVisible();

      const listed = await waitForBookmarks(scenario, 1);
      const [bookmark] = listed.bookmarks;
      expect(bookmark.targetKind).toBe("loom");
      expect(bookmark.targetId).toBe(loomId);
      expect(bookmark.targetUri).toContain("loom://");
      expect(bookmark.targetUri).not.toContain("/r/");
      expect(bookmark.title).toContain("Event Sourcing");
      expect(bookmark.title).not.toMatch(/^c[-_]/i);
      expect(listed.bookmarks.filter((item) => item.targetKind === "response")).toHaveLength(0);

      await expect(firstResponseBookmark).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: "Bookmarks" }).click();
      const bookmarkRow = page.getByTestId(`utility-destination-row-${bookmark.bookmarkId}`);
      await expect(bookmarkRow).toBeVisible();
      await expect(bookmarkRow).toContainText("Event Sourcing");
      await expect(bookmarkRow).not.toContainText(/^c[-_]/i);

      expectNoForbiddenPayload(listed);
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("bookmarks a Weft root from the topbar with a readable title", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(
        page,
        "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat"
      );
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });

      await page.getByRole("button", { name: /Start Weft from/i }).first().click();
      const weftPanel = page.locator(".weft-split-panel");
      await expect(weftPanel).toBeVisible();
      await weftPanel.getByRole("textbox", { name: "Prompt" }).click();
      await page.keyboard.insertText("What problem does Event Sourcing solve?");
      await weftPanel.getByRole("button", { name: "Send" }).click();

      const [weft] = await waitForWeftCount(scenario, 1);
      await expect(weftPanel.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });
      await weftPanel.click({ position: { x: 32, y: 32 } });

      const weftAddress = await readFocusedAddress(page);
      expect(weftAddress).toContain("loom://");
      expect(weftAddress).not.toContain("/r/");

      const weftFooterBookmark = page.locator(".weft-split-panel .response-bookmark-chip").first();
      await expect(weftFooterBookmark).toHaveAttribute("aria-pressed", "false");

      await page.getByRole("button", { name: "Bookmark Address" }).click();
      await expect(page.getByRole("button", { name: "Address bookmarked" })).toBeVisible();

      const listed = await waitForBookmarks(scenario, 1);
      const [bookmark] = listed.bookmarks;
      expect(bookmark.targetKind).toBe("weft");
      expect(bookmark.targetId).toBe(weft.loomId);
      expect(bookmark.targetUri).toContain("loom://");
      expect(bookmark.targetUri).not.toContain("/r/");
      expect(bookmark.title).toContain("What problem does Event Sourcing solve");
      expect(bookmark.title).not.toMatch(/^weft-response-workflow[-_]/i);
      expect(listed.bookmarks.filter((item) => item.targetKind === "response")).toHaveLength(0);
      await expect(weftFooterBookmark).toHaveAttribute("aria-pressed", "false");

      expectNoForbiddenPayload(listed);
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("keeps Loom and Response bookmarks independent across removal and reload", async ({
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

      await sendMainPrompt(
        page,
        "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat"
      );
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });

      const rootLoom = (await scenario.client.listLooms()).find((loom) =>
        loom.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();

      const responseBookmark = page.locator(".response-bookmark-chip").first();
      await expect(responseBookmark).toHaveAttribute("aria-pressed", "false");

      await page.getByRole("button", { name: "Bookmark Address" }).click();
      await expect(page.getByRole("button", { name: "Address bookmarked" })).toBeVisible();
      await responseBookmark.click();
      await expect(responseBookmark).toHaveAttribute("aria-pressed", "true");

      let listed = await waitForBookmarks(scenario, 2);
      expect(listed.bookmarks.map((bookmark) => bookmark.targetKind).sort()).toEqual([
        "loom",
        "response",
      ]);
      expect(listed.bookmarks.find((bookmark) => bookmark.targetKind === "loom")?.targetId).toBe(
        rootLoom!.loomId
      );

      await page.getByRole("button", { name: "Address bookmarked" }).click();
      listed = await waitForBookmarks(scenario, 1);
      expect(listed.bookmarks[0].targetKind).toBe("response");
      await expect(responseBookmark).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Bookmark Address" })).toBeVisible();

      await page.getByRole("button", { name: "Bookmark Address" }).click();
      await expect(page.getByRole("button", { name: "Address bookmarked" })).toBeVisible();
      listed = await waitForBookmarks(scenario, 2);
      expect(listed.bookmarks.map((bookmark) => bookmark.targetKind).sort()).toEqual([
        "loom",
        "response",
      ]);

      await responseBookmark.click();
      await expect(responseBookmark).toHaveAttribute("aria-pressed", "false");
      listed = await waitForBookmarks(scenario, 1);
      expect(listed.bookmarks[0].targetKind).toBe("loom");
      await expect(page.getByRole("button", { name: "Address bookmarked" })).toBeVisible();

      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${rootLoom!.loomId}`).click();
      await expect(page.getByRole("button", { name: "Address bookmarked" })).toBeVisible();
      await expect(page.locator(".response-bookmark-chip").first()).toHaveAttribute(
        "aria-pressed",
        "false"
      );
      await page.getByRole("button", { name: "Bookmarks" }).click();
      const bookmarkRow = page.getByTestId(
        `utility-destination-row-${listed.bookmarks[0].bookmarkId}`
      );
      await expect(bookmarkRow).toBeVisible();
      await expect(bookmarkRow).toContainText("Event Sourcing");
      await expect(bookmarkRow).not.toContainText(/^c[-_]/i);

      expectNoForbiddenPayload(listed);
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
