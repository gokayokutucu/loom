import { expect, type Page, test } from "@playwright/test";

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openSettings(page: Page) {
  await page.getByTestId("profile-menu-trigger").click();
  await page.getByTestId("open-app-settings").click();
  await expect(page.getByRole("dialog", { name: /Runtime/ })).toBeVisible();
}

test.describe("[pure-ui-rendering] Settings information architecture", () => {
  test("[pure-ui-rendering] shows category navigation and preserves existing runtime controls", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);

    const categoryList = page.locator(".settings-category-list");
    for (const label of [
      "Runtime",
      "Providers",
      "Models",
      "Capability",
      "Context & Memory",
      "Privacy & Security",
      "Data & Storage",
      "Export / Import",
      "UI Preferences",
      "Advanced",
    ]) {
      await expect(categoryList.getByText(label, { exact: true })).toBeVisible();
    }

    await expect(page.getByRole("heading", { name: "Engine and service status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Test Runtime" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh service status" }).first()).toBeVisible();
  });

  test("[pure-ui-rendering] shows provider, privacy, and deferred sections without active secret inputs", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);

    await page.getByRole("button", { name: /Providers/ }).click();
    await expect(page.getByRole("heading", { name: "Local model provider" })).toBeVisible();
    await expect(page.getByText("Secure native storage required")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await page.getByRole("button", { name: /Privacy & Security/ }).click();
    await expect(page.getByRole("heading", { name: "Security posture" })).toBeVisible();
    await expect(page.getByText("Local-first runtime")).toBeVisible();
    await expect(page.getByText("Raw thinking persistence")).toBeVisible();
    await expect(page.getByText("Disabled").first()).toBeVisible();
    await expect(page.getByText("Remote Ollama", { exact: true })).toBeVisible();
    await expect(page.getByText("Blocked by default", { exact: true })).toBeVisible();
    await expect(page.getByText("Provider secrets", { exact: true })).toBeVisible();
    await expect(page.getByText("Secure native storage required later")).toBeVisible();
    await expect(page.getByText("Unsafe model management")).toBeVisible();
    await expect(page.getByText("Remote Ollama endpoints are blocked by default for safety.")).toBeVisible();
    await expect(page.getByText("API keys are not accepted or stored")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('label:has-text("Store thinking")')).toHaveCount(0);
    await expect(page.locator('label:has-text("Copy chain of thought")')).toHaveCount(0);
    await expect(page.locator('label:has-text("Export hidden reasoning")')).toHaveCount(0);

    await page.getByRole("button", { name: /Context & Memory/ }).click();
    await expect(page.getByText("Explicit remember / forget policy required")).toBeVisible();
    await expect(page.getByText("Coming later")).toBeVisible();

    await page.getByRole("button", { name: /Advanced/ }).click();
    await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Service status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Developer integrations — planned" })).toBeVisible();
    await expect(page.getByText("Extensions")).toBeVisible();
    await expect(page.getByText("MCP", { exact: true })).toBeVisible();
    await expect(page.getByText("Tool artifacts")).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Show generation debug monitor while answering" })
    ).toBeChecked();
  });
});
