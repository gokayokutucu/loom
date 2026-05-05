import { expect, type Locator, type Page, test } from "@playwright/test";

const PRODUCT_GROUP_ID = "g-product-systems";

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

function loomTab(page: Page, loomId: string) {
  return page.getByTestId(`sidebar-loom-${loomId}`);
}

function loomDragHandle(page: Page, loomId: string) {
  return loomTab(page, loomId).locator(".conversation-tab-main");
}

function pinnedLoom(page: Page, loomId: string) {
  return page.getByTestId(`sidebar-pinned-loom-${loomId}`);
}

function groupSections(page: Page) {
  return page.locator("[data-testid^='sidebar-group-']");
}

async function dragWithHold(
  page: Page,
  source: Locator,
  target: Locator,
  holdMs = 1_080
) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer });
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await page.waitForTimeout(holdMs);
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
  await source.dispatchEvent("dragend", { dataTransfer });
  await dataTransfer.dispose();
}

async function dragAndDrop(source: Locator, target: Locator) {
  const dataTransfer = await source.page().evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer });
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
  await source.dispatchEvent("dragend", { dataTransfer });
  await dataTransfer.dispose();
}

async function dragToComposer(page: Page, source: Locator) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const composerSurface = page.getByTestId("prompt-surface").first();
  await source.dispatchEvent("dragstart", { dataTransfer });
  await composerSurface.dispatchEvent("dragenter", { dataTransfer });
  await composerSurface.dispatchEvent("dragover", { dataTransfer });
  await composerSurface.dispatchEvent("drop", { dataTransfer });
  await source.dispatchEvent("dragend", { dataTransfer });
  await dataTransfer.dispose();
}

test.describe("Loom Sidebar DnD", () => {
  test("standalone plus standalone requires hold before creating a group", async ({ page }) => {
    await openApp(page);

    await dragWithHold(
      page,
      loomDragHandle(page, "c-prompts"),
      loomTab(page, "c-security"),
      250
    );

    await expect(loomTab(page, "c-prompts")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
    await expect(loomTab(page, "c-security")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
    await expect(groupSections(page)).toHaveCount(1);

    await dragWithHold(
      page,
      loomDragHandle(page, "c-prompts"),
      loomTab(page, "c-security")
    );

    const sourceGroupId = await loomTab(page, "c-prompts").getAttribute("data-sidebar-group-id");
    const targetGroupId = await loomTab(page, "c-security").getAttribute("data-sidebar-group-id");

    expect(sourceGroupId).toBeTruthy();
    expect(sourceGroupId).not.toBe("standalone");
    expect(targetGroupId).toBe(sourceGroupId);
    await expect(loomTab(page, "c-prompts")).toHaveCount(1);
    await expect(loomTab(page, "c-security")).toHaveCount(1);
    await expect(groupSections(page)).toHaveCount(2);
  });

  test("dragging outside the Sidebar cancels grouping intent", async ({ page }) => {
    await openApp(page);
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    const source = loomDragHandle(page, "c-prompts");
    const target = loomTab(page, "c-security");

    await source.dispatchEvent("dragstart", { dataTransfer });
    await target.dispatchEvent("dragenter", { dataTransfer });
    await target.dispatchEvent("dragover", { dataTransfer });
    await page.waitForTimeout(1_080);
    await target.dispatchEvent("dragover", { dataTransfer });
    await expect(target).toHaveAttribute("data-sidebar-dnd-armed", "createGroup");

    await page.locator("main.workspace").first().dispatchEvent("dragenter", { dataTransfer });
    await page.locator("main.workspace").first().dispatchEvent("dragover", { dataTransfer });
    expect(await target.getAttribute("data-sidebar-dnd-armed")).toBeNull();

    await target.dispatchEvent("drop", { dataTransfer });
    await source.dispatchEvent("dragend", { dataTransfer });
    await dataTransfer.dispose();

    await expect(loomTab(page, "c-prompts")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
    await expect(loomTab(page, "c-security")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
  });

  test("standalone Loom joins an existing group immediately", async ({ page }) => {
    await openApp(page);

    await dragAndDrop(
      loomDragHandle(page, "c-security"),
      loomTab(page, "c-launch")
    );

    await expect(loomTab(page, "c-security")).toHaveAttribute(
      "data-sidebar-group-id",
      PRODUCT_GROUP_ID
    );
    await expect(loomTab(page, "c-launch")).toHaveAttribute(
      "data-sidebar-group-id",
      PRODUCT_GROUP_ID
    );
    await expect(groupSections(page)).toHaveCount(1);
  });

  test("grouped Loom leaves its group immediately over standalone without merging", async ({ page }) => {
    await openApp(page);

    await dragAndDrop(
      loomDragHandle(page, "c-launch"),
      loomTab(page, "c-security")
    );

    await expect(loomTab(page, "c-launch")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
    await expect(loomTab(page, "c-security")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
    await expect(groupSections(page)).toHaveCount(1);
  });

  test("grouped Loom leaves its group immediately over empty standalone zone", async ({ page }) => {
    await openApp(page);

    await dragAndDrop(
      loomDragHandle(page, "c-launch"),
      page.getByTestId("sidebar-standalone-zone")
    );

    await expect(loomTab(page, "c-launch")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
    await expect(groupSections(page)).toHaveCount(1);
  });

  test("grouped Loom moves to another group immediately and cleans up a one-member group", async ({ page }) => {
    await openApp(page);

    await dragWithHold(
      page,
      loomDragHandle(page, "c-prompts"),
      loomTab(page, "c-security")
    );
    const temporaryGroupId = await loomTab(page, "c-prompts").getAttribute("data-sidebar-group-id");
    expect(temporaryGroupId).toBeTruthy();
    expect(temporaryGroupId).not.toBe("standalone");

    await dragAndDrop(loomDragHandle(page, "c-prompts"), loomTab(page, "c-launch"));

    await expect(loomTab(page, "c-prompts")).toHaveAttribute(
      "data-sidebar-group-id",
      PRODUCT_GROUP_ID
    );
    await expect(loomTab(page, "c-launch")).toHaveAttribute(
      "data-sidebar-group-id",
      PRODUCT_GROUP_ID
    );
    await expect(loomTab(page, "c-security")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
    await expect(loomTab(page, "c-prompts")).toHaveCount(1);
    await expect(groupSections(page)).toHaveCount(1);
  });

  test("pinned Loom cannot create or join Sidebar groups", async ({ page }) => {
    await openApp(page);

    await dragWithHold(page, pinnedLoom(page, "c-architecture"), loomTab(page, "c-security"));
    await dragAndDrop(pinnedLoom(page, "c-architecture"), loomTab(page, "c-launch"));

    await expect(pinnedLoom(page, "c-architecture")).toHaveAttribute(
      "data-sidebar-pinned",
      "true"
    );
    await expect(loomTab(page, "c-security")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
    await expect(loomTab(page, "c-launch")).toHaveAttribute(
      "data-sidebar-group-id",
      PRODUCT_GROUP_ID
    );
    await expect(groupSections(page)).toHaveCount(1);
  });

  test("dragging a Sidebar Loom into the composer creates a Reference only", async ({ page }) => {
    await openApp(page);
    const groupsBefore = await groupSections(page).count();

    await dragToComposer(page, loomDragHandle(page, "c-security"));

    await expect(page.locator(".inline-loom-token")).toContainText("Security review Looms");
    await expect(page.getByRole("button", { name: /^References$/ }).first()).toContainText("1");
    await expect(groupSections(page)).toHaveCount(groupsBefore);
    await expect(loomTab(page, "c-security")).toHaveAttribute(
      "data-sidebar-group-id",
      "standalone"
    );
  });

  test("drag preview is transparent, text-shadowed, and reduced opacity", async ({ page }) => {
    await openApp(page);
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await loomDragHandle(page, "c-security").dispatchEvent("dragstart", { dataTransfer });

    const preview = page.getByTestId("loom-drag-preview");
    await expect(preview).toBeAttached();
    const style = await preview.evaluate((node) => {
      const computed = window.getComputedStyle(node);
      return {
        backgroundColor: computed.backgroundColor,
        opacity: Number(computed.opacity),
        textShadow: computed.textShadow,
      };
    });

    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(style.opacity).toBeLessThan(1);
    expect(style.textShadow).not.toBe("none");

    await loomDragHandle(page, "c-security").dispatchEvent("dragend", { dataTransfer });
    await dataTransfer.dispose();
  });
});
