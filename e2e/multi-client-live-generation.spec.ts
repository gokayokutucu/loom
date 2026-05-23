// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED.
// - Starts an isolated loom-service with temp SQLite and deterministic slow streaming.
// - Opens two React clients against the same service-backed app and verifies the second client
//   hydrates the in-flight Response from service state.
import { expect, test, type Page } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

interface LoomListResponse {
  looms: Array<{ loomId: string; title: string }>;
}

interface LoomDetailResponse {
  loom: {
    responses: Array<{
      role: "user" | "assistant";
      content: string;
      metadata?: { status?: string; workflowRunId?: string };
    }>;
  };
}

async function openApp(page: Page, appUrl: string) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto(appUrl);
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

test("second web client observes an in-flight service generation token stream", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const harness = await createServiceTestHarness({
    deterministicProvider: "event-sourcing",
    deterministicStreamChunkDelayMs: 80,
    startApp: true,
  });

  try {
    expect(harness.appUrl).toBeTruthy();
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await openApp(pageA, harness.appUrl!);

    await sendMainPrompt(pageA, "event sourcing detay");

    await expect
      .poll(async () => {
        const list = await harness.fetchJson<LoomListResponse>("/looms");
        return list.looms[0]?.loomId ?? "";
      })
      .not.toBe("");
    const loomId = (await harness.fetchJson<LoomListResponse>("/looms")).looms[0]?.loomId ?? "";
    expect(loomId).not.toBe("");

    await expect
      .poll(async () => {
        const detail = await harness.fetchJson<LoomDetailResponse>(
          `/looms/${encodeURIComponent(loomId)}`
        );
        const assistant = detail.loom.responses.find((response) => response.role === "assistant");
        return {
          length: assistant?.content.length ?? 0,
          status: assistant?.metadata?.status,
          workflowRunId: assistant?.metadata?.workflowRunId,
        };
      })
      .toMatchObject({ status: "streaming" });

    await openApp(pageB, harness.appUrl!);
    const loomTitle = (
      await harness.fetchJson<LoomListResponse>("/looms")
    ).looms.find((loom) => loom.loomId === loomId)?.title;
    expect(loomTitle).toBeTruthy();
    await pageB.getByText(loomTitle!, { exact: false }).first().click();

    const assistantBody = pageB.locator(".assistant-body").first();
    await expect(assistantBody).toContainText("Event Sourcing");
    const initialText = (await assistantBody.textContent()) ?? "";

    await expect
      .poll(async () => ((await assistantBody.textContent()) ?? "").length)
      .toBeGreaterThan(initialText.length + 20);

    await expect
      .poll(async () => {
        const detail = await harness.fetchJson<LoomDetailResponse>(
          `/looms/${encodeURIComponent(loomId)}`
        );
        return detail.loom.responses.find((response) => response.role === "assistant")?.metadata
          ?.status;
      }, { timeout: 30_000 })
      .toBe("completed");

    await context.close();
  } finally {
    const cleanup = await harness.cleanup();
    expect(cleanup.appStopped).toBe(true);
    expect(cleanup.tempDirRemoved).toBe(true);
  }
});
