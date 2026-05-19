// E2E data authority classification: LEGACY_TYPESCRIPT_LOCAL.
// This spec covers legacy Reference suggestion UI over seeded UI state until Smart References are service-backed.
import { expect, type Locator, type Page, test } from "@playwright/test";

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "loom-ai-app-settings-v1",
      JSON.stringify({ mockDataEnabled: true })
    );
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

  test("Arrow keys move the selected Reference suggestion", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    const editor = await replaceComposerText(page, "#");
    const dropdown = await visibleSuggestionDropdown(page);
    const options = dropdown.getByRole("option");
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(1);

    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
    await editor.press("ArrowDown");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "false");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(1)).toHaveClass(/selected/);
    await expect(options.nth(1)).toHaveAttribute("data-selected", "true");

    await editor.press("ArrowUp");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "false");
  });

  test("References popover supports Arrow key selection", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    const editor = await replaceComposerText(page, "#");
    await visibleSuggestionDropdown(page);
    await editor.press("Enter");
    await expect(page.getByRole("button", { name: /^References/ }).first()).toContainText("1");

    await editor.click();
    await page.keyboard.type(" #R-");
    await visibleSuggestionDropdown(page);
    await editor.press("Enter");
    await expect(page.getByRole("button", { name: /^References/ }).first()).toContainText("2");

    await page.getByRole("button", { name: /^References/ }).first().click();
    const listbox = page.getByRole("listbox", { name: "Linked references" });
    await expect(listbox).toBeVisible();
    const options = listbox.getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "false");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(1)).toHaveClass(/selected/);

    await page.keyboard.press("ArrowUp");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "false");
  });

  test("dropdown closes on outside focus and reopens when the caret is still on a # query", async ({
    page,
  }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    const editor = await replaceComposerText(page, "#L-");
    await visibleSuggestionDropdown(page);

    await page.getByRole("combobox", { name: "Loom Address Bar" }).click();
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
      .getByRole("button", { name: /Start Weft from/i })
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
