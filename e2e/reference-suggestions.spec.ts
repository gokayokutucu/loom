// E2E data authority classification: LEGACY_TYPESCRIPT_LOCAL.
// This spec covers legacy Reference suggestion UI over seeded UI state until Smart References are service-backed.
import { expect, type Locator, type Page, test } from "@playwright/test";

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openArchitectureLoom(page: Page) {
  await page.getByTestId("sidebar-pinned-loom-c-architecture").click();
  await expect(page.getByTestId("response-link-r-address-bar")).toBeVisible();
}

async function replaceComposerText(page: Page, text: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" });
  await replaceEditorText(page, editor, text);
  return editor;
}

async function replaceEditorText(page: Page, editor: Locator, text: string) {
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type(text);
  return editor;
}

async function visibleSuggestionDropdown(page: Page) {
  const dropdown = page.getByTestId("reference-suggestion-dropdown");
  await expect(dropdown).toBeVisible();
  return dropdown;
}

test.describe("[legacy-typescript-local] # Reference suggestions", () => {
  test("dropdown remains inside the viewport near the bottom composer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openApp(page);
    await openArchitectureLoom(page);

    await replaceComposerText(page, "#");
    const dropdown = await visibleSuggestionDropdown(page);
    const box = await dropdown.boundingBox();
    const viewport = page.viewportSize();

    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!box || !viewport) return;

    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await expect(dropdown).toHaveAttribute("data-placement", "top");
  });

  test("search matches readable Loom code prefixes", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    await replaceComposerText(page, "#L-");
    const dropdown = await visibleSuggestionDropdown(page);

    await expect(dropdown).toContainText(/L-[0-9A-HJKMNP-TV-Z]{5}/);
    await expect(dropdown).toContainText("Loom AI navigation architecture");
    await expect(dropdown).not.toContainText("code:");
    await expect(dropdown.getByTestId("mention-code-match").first()).toHaveText("L-");
  });

  test("search matches promoted Response code prefixes", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);
    await page.getByTestId("response-link-r-address-bar").click();

    await replaceComposerText(page, "#R-");
    const dropdown = await visibleSuggestionDropdown(page);

    await expect(dropdown).toContainText(/R-[0-9A-HJKMNP-TV-Z]{5}/);
    await expect(dropdown).toContainText("Address Bar as local AI web navigator");
  });

  test("search matches metadata keywords and summaries", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    await replaceComposerText(page, "#lifecycle");
    const dropdown = await visibleSuggestionDropdown(page);

    await expect(dropdown).toContainText("Loom AI navigation architecture");
  });

  test("dropdown closes on outside focus and reopens when the caret is still on a # query", async ({
    page,
  }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    const editor = await replaceComposerText(page, "#L-");
    await visibleSuggestionDropdown(page);

    await page.getByRole("textbox", { name: "Loom Address Bar" }).click();
    await expect(page.getByTestId("reference-suggestion-dropdown")).toBeHidden();

    await editor.click();
    await visibleSuggestionDropdown(page);
  });

  test("split Weft composer positions suggestions near the owning composer", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openApp(page);
    await openArchitectureLoom(page);

    await page
      .locator("article")
      .filter({ hasText: "Address Bar as local AI web navigator" })
      .getByRole("button", { name: "Weft" })
      .click();
    const weftPanel = page.locator(".weft-split-panel");
    await expect(weftPanel).toBeVisible();

    await replaceEditorText(page, weftPanel.getByRole("textbox", { name: "Prompt" }), "#L-");
    const dropdown = await visibleSuggestionDropdown(page);
    const dropdownBox = await dropdown.boundingBox();
    const panelBox = await weftPanel.boundingBox();
    const viewport = page.viewportSize();

    expect(dropdownBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!dropdownBox || !panelBox || !viewport) return;

    expect(dropdownBox.y).toBeGreaterThanOrEqual(0);
    expect(dropdownBox.y + dropdownBox.height).toBeLessThanOrEqual(viewport.height);
    expect(dropdownBox.x).toBeGreaterThanOrEqual(panelBox.x - 16);
    expect(dropdownBox.x).toBeLessThanOrEqual(panelBox.x + panelBox.width);
  });
});
