import { expect, type Page, test } from "@playwright/test";

async function openDefaultGraph(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Weft-aware Loom graph" })).toBeVisible();
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

test.describe("Graph bookmark action", () => {
  test("uses the Bookmark button state instead of a bookmarked metadata chip", async ({
    page,
  }) => {
    await openDefaultGraph(page);

    const bookmarkedNode = page.locator(
      '[data-id="loom:c-graph-map:response:r-graph-continuation"] .loom-graph-node--response'
    );
    await expect(bookmarkedNode).toBeVisible();
    await expect(bookmarkedNode.locator(".loom-graph-node-flags")).not.toContainText(
      "bookmarked"
    );

    const bookmarkButton = bookmarkedNode.getByRole("button", {
      name: /Remove bookmark for Continue Loom appends below the latest Response/,
    });
    await expect(bookmarkButton).toHaveClass(/is-bookmarked/);
    await expect(bookmarkButton).toHaveAttribute("aria-pressed", "true");

    await bookmarkButton.click();

    const unbookmarkedButton = bookmarkedNode.getByRole("button", {
      name: /Bookmark Continue Loom appends below the latest Response/,
    });
    await expect(unbookmarkedButton).not.toHaveClass(/is-bookmarked/);
    await expect(unbookmarkedButton).toHaveAttribute("aria-pressed", "false");
  });

  test("shows filled Bookmark icons for bookmarked responses on the Loom surface", async ({
    page,
  }) => {
    await openDefaultGraph(page);
    await page.getByRole("button", { name: "Toggle Graph View" }).click();

    const bookmarkButton = page.getByRole("button", {
      name: /Remove bookmark for Graph View starts as a readable Loom map/,
    });
    await expect(bookmarkButton).toHaveClass(/bookmarked/);
    await expect(bookmarkButton).toHaveAttribute("aria-pressed", "true");

    const weftButton = page.getByRole("button", {
      name: /Open Weft from Graph View starts as a readable Loom map/,
    });
    await expect(weftButton).toHaveClass(/is-wefted/);
    await expect(weftButton).toHaveAttribute("aria-pressed", "true");
  });

  test("marks existing Weft actions and focuses the Weft when opened", async ({ page }) => {
    await openDefaultGraph(page);

    const sourceNode = page.locator(
      '[data-id="loom:c-graph-map:response:r-graph-continuation"] .loom-graph-node--response'
    );
    await expect(sourceNode).toBeVisible();
    const weftButton = sourceNode.getByRole("button", {
      name: /Open Weft from Continue Loom appends below the latest Response/,
    });

    await expect(weftButton).toHaveClass(/is-wefted/);
    await expect(weftButton).toHaveAttribute("aria-pressed", "true");
    await weftButton.click();

    const weftNode = page.locator(
      '[data-id="loom:c-graph-continuation:root"] .loom-graph-node--weft'
    );
    await expect(weftNode).toHaveClass(/is-focused/);
    await expect(page.getByText("Existing Weft opened")).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(weftNode).toHaveClass(/is-focused/);
  });

  test("adds graph Link actions to the active composer and shows a toast", async ({ page }) => {
    await openDefaultGraph(page);
    await page.getByRole("button", { name: "Continue Loom", exact: true }).click();
    const composer = page.getByTestId("graph-continuation-composer");
    await expect(composer).toBeVisible();

    const sourceNode = page.locator(
      '[data-id="loom:c-graph-map:response:r-graph-focus"] .loom-graph-node--response'
    );
    await sourceNode.getByRole("button", { name: "Link" }).click();

    await expect(page.getByText("Link added")).toBeVisible();
    await expect(composer).toContainText("Focused graph positioning keeps work oriented");
  });
});
