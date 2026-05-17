// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service prompt edit proof.
// - LEGACY_TYPESCRIPT_LOCAL for seeded prompt edit UI rendering tests below.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

interface ExportedResponse {
  responseId: string;
  loomId: string;
  role: "user" | "assistant";
  content: string;
  sequenceIndex: number;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

interface LoomExportJson {
  responses: ExportedResponse[];
}

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openGraphLoom(page: Page) {
  await page.getByRole("button", { name: "Open Weft-aware Loom graph" }).click();
  await expect(page.locator('[data-response-id="r-site-map"]')).toBeVisible();
}

async function editPrompt(page: Page, responseId: string, nextPrompt: string) {
  await page.getByTestId(`edit-prompt-${responseId}`).evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Prompt edit trigger is not a button.");
    }
    button.click();
  });
  const editor = page.getByLabel("Edit prompt text");
  await expect(editor).toBeVisible();
  await editor.fill(nextPrompt);
  await page.getByRole("button", { name: "Save" }).click();
}

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function exportedLoomResponses(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  loomId: string
) {
  const exported = await scenario.client.exportLoom({
    loomId,
    format: "json",
    includeMetadata: true,
    includeReferences: true,
    includeGraph: true,
  });
  const exportedJson = JSON.parse(
    Buffer.from(exported.contentBase64, "base64").toString("utf8")
  ) as LoomExportJson;
  return exportedJson.responses;
}

async function waitForPersistedResponses(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  loomId: string,
  expectedCount: number
) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const responses = await exportedLoomResponses(scenario, loomId);
    const assistantResponsesComplete = responses
      .filter((response) => response.role === "assistant")
      .every((response) => response.content.trim().length > 0);
    if (responses.length >= expectedCount && assistantResponsesComplete) {
      return responses;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expectedCount} persisted responses in ${loomId}.`);
}

function expectNoForbiddenPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("raw_thinking");
  expect(serialized).not.toContain("thinking_text");
  expect(serialized).not.toContain("chain_of_thought");
  expect(serialized).not.toContain("hidden_reasoning");
}

test.describe("[product-service-backed] prompt edit product proof", () => {
  test("[product-service-backed] editing Prompt B creates a Revision Weft and leaves the origin Loom unchanged", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const forbiddenMutationUrls: string[] = [];

    try {
      await page.route(/\/responses\/[^/]+(?:\/regenerate)?$/, async (route) => {
        forbiddenMutationUrls.push(route.request().url());
        await route.continue();
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const promptA = "Event Sourcing nedir? Kısaca anlat.";
      const promptB = "Event Sourcing AWS üzerinde nasıl kurulur?";
      const promptC = "Event Sourcing Azure üzerinde nasıl kurulur?";
      const editedPrompt = "Event Sourcing GCP üzerinde nasıl kurulur?";
      await sendMainPrompt(page, promptA);
      await expect(page.getByText("Deterministic E2E provider").first()).toBeVisible({
        timeout: 30_000,
      });
      await sendMainPrompt(page, promptB);
      await expect(page.getByText("AWS").first()).toBeVisible({ timeout: 30_000 });
      await sendMainPrompt(page, promptC);
      await expect(page.getByText("Azure").first()).toBeVisible({ timeout: 30_000 });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;
      const beforeResponses = await waitForPersistedResponses(scenario, loomId, 6);
      const userA = beforeResponses.find(
        (response) => response.role === "user" && response.sequenceIndex === 0
      );
      const assistantA = beforeResponses.find(
        (response) => response.role === "assistant" && response.sequenceIndex === 1
      );
      const userB = beforeResponses.find(
        (response) => response.role === "user" && response.sequenceIndex === 2
      );
      const assistantB = beforeResponses.find(
        (response) => response.role === "assistant" && response.sequenceIndex === 3
      );
      expect(userA).toBeTruthy();
      expect(assistantA).toBeTruthy();
      expect(userB).toBeTruthy();
      expect(assistantB).toBeTruthy();
      expect(userB!.content).toBe(promptB);

      await editPrompt(page, assistantB!.responseId, editedPrompt);
      await expect(page.getByText("Revision:").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("GCP").first()).toBeVisible({ timeout: 30_000 });

      expect(forbiddenMutationUrls).toEqual([]);

      const originAfter = await exportedLoomResponses(scenario, loomId);
      expect(originAfter.map((response) => response.content)).toEqual(
        beforeResponses.map((response) => response.content)
      );
      expect(originAfter.map((response) => response.responseId)).toEqual(
        beforeResponses.map((response) => response.responseId)
      );

      const revisionWeft = (await scenario.client.listLooms()).find(
        (loom) =>
          loom.kind === "weft" &&
          loom.originLoomId === loomId &&
          loom.originResponseId === assistantA!.responseId &&
          loom.weftKind === "revision"
      );
      expect(revisionWeft).toBeTruthy();
      const revisionResponses = await waitForPersistedResponses(scenario, revisionWeft!.loomId, 2);
      expect(revisionResponses[0]).toMatchObject({
        role: "user",
        content: editedPrompt,
      });
      expect(revisionResponses[1]?.role).toBe("assistant");
      expect(
        revisionResponses.some((response) => response.content.includes(promptA))
      ).toBe(false);
      expect(
        revisionResponses.some((response) => response.content.includes(userA!.content))
      ).toBe(false);
      expect(
        revisionResponses.some((response) => response.content.includes(promptB))
      ).toBe(false);
      expect(
        revisionResponses.some((response) => response.content.includes(promptC))
      ).toBe(false);
      expect(
        revisionResponses.some(
          (response) => response.role === "assistant" && response.content.trim().length > 0
        )
      ).toBe(true);
      await expect(page.locator(".weft-split-view")).toBeVisible();
      await expect(page.locator(".origin-split-panel")).toContainText(promptB);
      await expect(page.locator(".origin-split-panel .prompt-revision-branch-indicator")).toContainText(
        "Revision created"
      );
      await expect(page.locator(".weft-split-panel")).toContainText(editedPrompt);
      await expect(page.locator(".weft-split-panel .qa-item")).not.toContainText(promptA);
      await expect(page.locator(".origin-split-panel .response-weft-chip.is-revision-wefted")).toHaveCount(1);
      expectNoForbiddenPayload(originAfter);
      expectNoForbiddenPayload(revisionResponses);
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

test.describe("[legacy-typescript-local] Prompt editing", () => {
  test("edits a sent prompt and marks the answer stale", async ({ page }) => {
    await openApp(page);
    await openGraphLoom(page);

    await editPrompt(
      page,
      "r-site-map",
      "What should the default Graph View demonstrate?\nPreserve readable hierarchy."
    );

    const response = page.locator('[data-response-id="r-site-map"]');
    await expect(response.locator(".user-message")).toContainText(
      "Preserve readable hierarchy."
    );
    await expect(response.locator(".stale-answer-notice")).toContainText(
      "Answer may be outdated after prompt edit."
    );
    await expect(response.getByRole("button", { name: "Regenerate from here" })).toBeDisabled();
    await expect(response.locator(".user-message")).toContainText(
      "What should the default Graph View demonstrate?"
    );
  });

  test("cancel restores the original prompt", async ({ page }) => {
    await openApp(page);
    await openGraphLoom(page);

    await page.getByTestId("edit-prompt-r-site-map").click();
    await page.getByLabel("Edit prompt text").fill("Discarded edit");
    await page.getByRole("button", { name: "Cancel" }).click();

    const response = page.locator('[data-response-id="r-site-map"]');
    await expect(response.locator(".user-message")).toContainText(
      "What should the default Graph View demonstrate?"
    );
    await expect(response.locator(".user-message")).not.toContainText("Discarded edit");
    await expect(response.locator(".stale-answer-notice")).toBeHidden();
  });

  test("preserves newlines and Reference metadata when saving", async ({ page }) => {
    await openApp(page);
    await openGraphLoom(page);

    await page.getByTestId("edit-prompt-r-evidence-map").click();
    await expect(page.locator(".prompt-edit-reference-row .sent-prompt-reference-token")).toBeVisible();
    await page.getByLabel("Edit prompt text").fill("Line one\nLine two");
    await page.getByRole("button", { name: "Save" }).click();

    const response = page.locator('[data-response-id="r-evidence-map"]');
    const promptText = await response.locator(".user-message p").innerText();
    expect(promptText).toContain("Line one\nLine two");
    await expect(response.locator(".sent-prompt-reference-token")).toBeVisible();
    await response.locator(".sent-prompt-reference-token").click();
    await expect(page.locator('[data-response-id="r-site-map"]')).toBeVisible();
  });
});
