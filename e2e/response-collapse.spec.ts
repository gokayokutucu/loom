// E2E data authority classification: LEGACY_TYPESCRIPT_LOCAL / PURE_UI_RENDERING.
// This spec exercises prompt and assistant response rendering over legacy seeded UI state.
import { expect, type Page, test } from "@playwright/test";

async function openMockApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async write(items: ClipboardItem[]) {
          const item = items[0];
          const blob = await item.getType("text/plain");
          window.localStorage.setItem("loom-test-clipboard", await blob.text());
        },
        async writeText(value: string) {
          window.localStorage.setItem("loom-test-clipboard", value);
        },
      },
    });
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
  await expect(page.locator('[data-response-id="r-address-bar"]')).toBeVisible();
}

async function forceResponseToLongVisualContent(page: Page, responseId: string) {
  await page.evaluate((targetResponseId) => {
    const article = document.querySelector(`[data-response-id="${targetResponseId}"]`);
    const content = article?.querySelector(".assistant-response-content");
    if (!content) throw new Error("Assistant response content not found");
    for (let index = 0; index < 56; index += 1) {
      const paragraph = document.createElement("p");
      paragraph.textContent = `Synthetic long-response line ${String(index + 1).padStart(
        2,
        "0"
      )}: collapse measurement should keep the full stored answer available.`;
      content.appendChild(paragraph);
    }
  }, responseId);
}

async function forceUserPromptToLongVisualContent(page: Page, responseId: string) {
  await page.evaluate((targetResponseId) => {
    const article = document.querySelector(`[data-response-id="${targetResponseId}"]`);
    const prompt = article?.querySelector(".user-message-collapsible p");
    if (!prompt) throw new Error("User prompt content not found");
    const extraLines = Array.from(
      { length: 56 },
      (_, index) =>
        `Synthetic long-prompt line ${String(index + 1).padStart(
          2,
          "0"
        )}: the prompt collapse should keep the full stored prompt available.`
    ).join("\n");
    prompt.appendChild(document.createTextNode(`\n${extraLines}`));
  }, responseId);
}

test.describe("[pure-ui-rendering] Assistant response collapse", () => {
  test("long user messages collapse by visual lines and can expand without changing copy source", async ({
    page,
  }) => {
    await openMockApp(page);
    await openArchitectureLoom(page);

    const article = page.locator('[data-response-id="r-address-bar"]');
    const userMessage = article.locator(".user-message");
    const toggle = userMessage.locator(".user-message-collapse-toggle");
    const promptText = userMessage.locator(".user-message-prompt-text");

    await expect(toggle).toHaveCount(0);
    await forceUserPromptToLongVisualContent(page, "r-address-bar");
    await expect(toggle).toHaveText("Show full message");
    await expect(promptText).toHaveClass(/is-clamped/);

    await expect(article.locator(".prompt-copy-trigger")).toBeVisible();
    await expect(article.locator(".prompt-edit-trigger")).toBeVisible();

    await article.locator(".prompt-copy-trigger").click({ force: true });
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("loom-test-clipboard")))
      .toContain("How should the address bar work if Loom AI is a browser for conversations?");

    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await expect(promptText).not.toHaveClass(/is-clamped/);
    await expect(userMessage).toContainText(
      "How should the address bar work if Loom AI is a browser for conversations?"
    );

    await toggle.click();
    await expect(toggle).toHaveText("Show full message");
    await expect(promptText).toHaveClass(/is-clamped/);
  });

  test("long assistant response collapses, expands, and preserves actions and copy source", async ({
    page,
  }) => {
    await openMockApp(page);
    await openArchitectureLoom(page);

    const article = page.locator('[data-response-id="r-address-bar"]');
    await expect(
      page.getByTestId("response-collapse-toggle-r-address-bar")
    ).toHaveCount(0);

    await forceResponseToLongVisualContent(page, "r-address-bar");

    const toggle = page.getByTestId("response-collapse-toggle-r-address-bar");
    const content = article.locator(".assistant-response-content");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("Show full response");
    await expect(content).toHaveClass(/is-collapsed/);

    await expect(article.locator('button[aria-label^="Copy response:"]')).toBeVisible();
    await expect(article.getByTestId("response-link-r-address-bar")).toBeVisible();
    await expect(article.locator(".response-weft-chip")).toBeVisible();

    const collapsedHeight = await content.evaluate((node) =>
      Math.round((node as HTMLElement).getBoundingClientRect().height)
    );
    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await expect(content).not.toHaveClass(/is-collapsed/);
    const expandedHeight = await content.evaluate((node) =>
      Math.round((node as HTMLElement).getBoundingClientRect().height)
    );
    expect(expandedHeight).toBeGreaterThan(collapsedHeight);

    await article.locator('button[aria-label^="Copy response:"]').click();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("loom-test-clipboard")))
      .toContain("Typing is already the act of asking where to go next");

    await toggle.click();
    await expect(toggle).toHaveText("Show full response");
    await expect(content).toHaveClass(/is-collapsed/);
  });

  test("short assistant responses do not show the collapse control", async ({ page }) => {
    await openMockApp(page);
    await openArchitectureLoom(page);

    await expect(page.locator('[data-response-id="r-archive-delete"]')).toBeVisible();
    await expect(
      page.getByTestId("response-collapse-toggle-r-archive-delete")
    ).toHaveCount(0);
  });

  test("code block responses keep their code block layout intact", async ({ page }) => {
    await openMockApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();

    const article = page.locator('[data-response-id="r-plugin-boundary"]');
    const codeBlock = article.locator(".assistant-code-block").first();
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock.locator("pre")).toBeVisible();
    await expect(codeBlock.getByRole("button", { name: /Copy .* code/ })).toBeVisible();

    const layout = await article.evaluate((node) => {
      const element = node as HTMLElement;
      return {
        articleWidth: element.getBoundingClientRect().width,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout.articleWidth).toBeLessThanOrEqual(layout.viewportWidth);
  });
});
