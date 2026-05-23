// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";
import type { EngineResponseEvent } from "../src/engine";

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
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

async function waitForActiveResponseCount(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  loomId: string,
  expectedCount: number
) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const loom = await scenario.client.getLoom(loomId);
    const responsesComplete = loom.responses.every((response) =>
      response.answer.join("\n").trim().length > 0
    );
    if (loom.responses.length === expectedCount && responsesComplete) return loom.responses;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expectedCount} active responses in ${loomId}.`);
}

async function collectRetryEvents(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  input: { loomId: string; userResponseId: string; softDeleteDownstream?: boolean }
) {
  const events: EngineResponseEvent[] = [];
  let answer = "";
  for await (const event of scenario.client.retryUserMessage({
    loomId: input.loomId,
    userResponseId: input.userResponseId,
    responseMode: "auto",
    softDeleteDownstream: input.softDeleteDownstream ?? true,
    reason: "retry_from_user_message",
    model: "deterministic-event-sourcing:e2e",
    options: { numCtx: 8192, numPredict: 1024 },
  })) {
    events.push(event);
    if (event.type === "content_delta") answer += event.payload.delta;
  }
  return { events, answer };
}

async function collectSendEvents(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  input: { loomId: string; promptText: string }
) {
  const events: EngineResponseEvent[] = [];
  let answer = "";
  let userResponseId: string | undefined;
  let assistantResponseId: string | undefined;
  for await (const event of scenario.client.sendMessage({
    loomId: input.loomId,
    promptText: input.promptText,
    references: [],
    responseMode: "auto",
    source: "composer",
    model: "deterministic-event-sourcing:e2e",
    options: { numCtx: 8192, numPredict: 1024 },
    persistWorkflow: true,
  })) {
    events.push(event);
    if (event.type === "user_message_created") userResponseId = event.payload.responseId;
    if (event.type === "assistant_placeholder_created") {
      assistantResponseId = event.payload.responseId;
    }
    if (event.type === "content_delta") answer += event.payload.delta;
  }
  return { events, answer, userResponseId, assistantResponseId };
}

async function createRetryLoom(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  title: string
) {
  const { loom } = await scenario.client.createLoom({
    title,
    firstPrompt: "Event Sourcing retry başlangıç Loom'u.",
  });
  const first = await scenario.sendPrompt(
    loom.loomId,
    "Event Sourcing retry için temel açıklama yap."
  );
  expect(first.userResponseId).toBeTruthy();
  expect(first.assistantResponseId).toBeTruthy();
  return { loom, first };
}

test.describe("[product-service-backed] User message retry", () => {
  test("[product-service-backed] retries a failed assistant placeholder for the latest user message", async () => {
    test.setTimeout(90_000);
    const failedPrompt = "Event Sourcing retry failed placeholder proof.";
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicFailInitialPrompt: failedPrompt,
    });

    try {
      const { loom } = await scenario.client.createLoom({
        title: "Retry failed placeholder proof",
        firstPrompt: "Retry failed placeholder root.",
      });
      const failed = await collectSendEvents(scenario, {
        loomId: loom.loomId,
        promptText: failedPrompt,
      });
      expect(failed.userResponseId).toBeTruthy();
      expect(failed.assistantResponseId).toBeTruthy();
      expect(failed.events.some((event) => event.type === "assistant_placeholder_created")).toBe(
        true
      );
      expect(failed.events.some((event) => event.type === "response_error")).toBe(true);
      expect(failed.answer).toBe("");

      const failedLoom = await scenario.client.getLoom(loom.loomId);
      expect(failedLoom.responses).toHaveLength(1);
      expect(failedLoom.responses[0].answer.join("").trim()).toBe("");

      const retry = await collectRetryEvents(scenario, {
        loomId: loom.loomId,
        userResponseId: failed.userResponseId!,
      });
      expect(retry.events.some((event) => event.type === "response_completed")).toBe(true);
      expect(retry.answer).toContain("Deterministic E2E provider");

      const retriedResponses = await waitForActiveResponseCount(scenario, loom.loomId, 1);
      expect(retriedResponses[0].question).toContain(failedPrompt);
      expect(retriedResponses[0].answer.join("\n")).toContain("Deterministic E2E provider");
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] retries the latest persisted user message without downstream cleanup", async () => {
    test.setTimeout(90_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
    });

    try {
      const { loom, first } = await createRetryLoom(
        scenario,
        "Retry latest user message proof"
      );
      await waitForActiveResponseCount(scenario, loom.loomId, 1);

      const retry = await collectRetryEvents(scenario, {
        loomId: loom.loomId,
        userResponseId: first.userResponseId!,
      });

      expect(retry.events.some((event) => event.type === "assistant_placeholder_created")).toBe(
        true
      );
      expect(retry.events.some((event) => event.type === "response_completed")).toBe(true);
      expect(retry.answer).toContain("Deterministic E2E provider");
      const activeResponses = await waitForActiveResponseCount(scenario, loom.loomId, 1);
      expect(activeResponses[0].question).toContain("Event Sourcing retry için temel");
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] retrying an earlier user message soft-deletes downstream active responses but preserves exploration and Revision Wefts", async () => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
    });

    try {
      const { loom, first } = await createRetryLoom(
        scenario,
        "Retry preserves Weft Looms proof"
      );
      const second = await scenario.sendPrompt(
        loom.loomId,
        "Event Sourcing retry downstream Weft için AWS örneği ver."
      );
      expect(second.userResponseId).toBeTruthy();
      expect(second.assistantResponseId).toBeTruthy();
      await waitForActiveResponseCount(scenario, loom.loomId, 2);

      const explorationWeft = await scenario.client.createOrOpenWeft({
        originLoomId: loom.loomId,
        originResponseId: second.assistantResponseId,
        weftKind: "exploration",
        title: "Loom: Retry exploration branch",
        initialPrompt: "Bu AWS örneğini ayrı değerlendir.",
        seedMode: "none",
        createOriginContextSnapshot: true,
      });
      const revisionWeft = await scenario.client.createOrOpenWeft({
        originLoomId: loom.loomId,
        originResponseId: first.assistantResponseId,
        weftKind: "revision",
        title: "Revision: Retry source prompt",
        initialPrompt: "Bu cevabı farklı bir açıdan yeniden yaz.",
        seedMode: "revision_lineage",
        createOriginContextSnapshot: true,
      });
      expect(explorationWeft.loomId).toBeTruthy();
      expect(revisionWeft.loomId).toBeTruthy();
      const weftsBeforeRetry = (await scenario.client.listLooms()).filter(
        (item) => item.kind === "weft"
      );
      expect(weftsBeforeRetry).toHaveLength(2);
      expect(weftsBeforeRetry.filter((item) => item.weftKind === "exploration")).toHaveLength(1);
      expect(weftsBeforeRetry.filter((item) => item.weftKind === "revision")).toHaveLength(1);

      const retry = await collectRetryEvents(scenario, {
        loomId: loom.loomId,
        userResponseId: first.userResponseId!,
      });
      expect(retry.events.some((event) => event.type === "response_completed")).toBe(true);

      const activeResponses = await waitForActiveResponseCount(scenario, loom.loomId, 1);
      expect(activeResponses[0].question).toContain("Event Sourcing retry için temel");
      expect(JSON.stringify(activeResponses)).not.toContain(
        "Event Sourcing retry downstream Weft için AWS"
      );

      const looms = await scenario.client.listLooms();
      const weftsAfterRetry = looms.filter((item) => item.kind === "weft");
      expect(weftsAfterRetry).toHaveLength(2);
      expect(weftsAfterRetry.filter((item) => item.weftKind === "exploration")).toHaveLength(1);
      expect(weftsAfterRetry.filter((item) => item.weftKind === "revision")).toHaveLength(1);
      const preservedExploration = looms.find(
        (item) => item.loomId === explorationWeft.loomId
      );
      const preservedRevision = looms.find((item) => item.loomId === revisionWeft.loomId);
      expect(preservedExploration?.kind).toBe("weft");
      expect(preservedExploration?.weftKind).toBe("exploration");
      expect(preservedRevision?.kind).toBe("weft");
      expect(preservedRevision?.weftKind).toBe("revision");

      const graph = await scenario.client.getGraphProjection({
        conversations: [],
        responsesByConversation: {},
        forkRecords: [],
        activeLoomId: loom.loomId,
        bookmarkedResponseAddresses: [],
      });
      expect(JSON.stringify(graph)).toContain(explorationWeft.loomId);
      expect(JSON.stringify(graph)).toContain(revisionWeft.loomId);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] retry rewrites active continuation and preserves downstream Wefts", async ({
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
      await expect(page.locator(".prompt-retry-trigger")).toHaveCount(0);

      const promptA = "Event Sourcing retry için temel açıklama yap.";
      const promptB = "Event Sourcing retry downstream Weft için AWS örneği ver.";
      await sendMainPrompt(page, promptA);
      await expect(page.getByText("Deterministic E2E provider").first()).toBeVisible({
        timeout: 30_000,
      });
      const firstArticle = page.locator(".qa-item").first();
      await expect(firstArticle.locator(".prompt-retry-trigger")).toBeVisible();
      await expect(firstArticle.locator(".assistant-message .prompt-retry-trigger")).toHaveCount(0);
      await sendMainPrompt(page, promptB);
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });

      const rootLoom = (await scenario.client.listLooms()).find((loom) =>
        loom.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();
      await waitForActiveResponseCount(scenario, rootLoom!.loomId, 2);

      const downstreamArticle = page.locator(".qa-item").nth(1);
      await downstreamArticle.scrollIntoViewIfNeeded();
      await downstreamArticle.getByRole("button", { name: /Start Weft from/i }).click();
      await expect(page.locator(".weft-split-view")).toBeVisible();
      await expect(page.locator(".weft-split-panel .prompt-retry-trigger")).toHaveCount(0);
      const weftPanel = page.locator(".weft-split-panel");
      const weftEditor = weftPanel.getByRole("textbox", { name: "Prompt" });
      await expect(weftEditor).toBeFocused();
      await page.keyboard.insertText("Bu AWS örneğini kısa değerlendir.");
      await weftPanel.getByRole("button", { name: "Send" }).click();
      const [weft] = await waitForWeftCount(scenario, 1);
      expect(weft.originResponseId).toBeTruthy();
      await waitForActiveResponseCount(scenario, weft.loomId, 1);

      await page.locator(".qa-item").first().locator(".prompt-retry-trigger").evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Retry trigger is not a button.");
        }
        button.click();
      });
      const retryDialog = page.getByRole("alertdialog", {
        name: "Retry from this message?",
      });
      await expect(retryDialog).toBeVisible();
      await expect(retryDialog).toContainText(
        "Retrying from this message will remove later messages from this Loom. Existing Wefts will be preserved."
      );
      await retryDialog.getByRole("button", { name: "Retry" }).click();

      await expect(page.locator(".origin-split-panel .qa-item")).toHaveCount(1, {
        timeout: 30_000,
      });
      const activeOriginResponses = await waitForActiveResponseCount(
        scenario,
        rootLoom!.loomId,
        1
      );
      expect(activeOriginResponses[0].question).toContain(promptA);

      const weftsAfterRetry = await waitForWeftCount(scenario, 1);
      expect(weftsAfterRetry[0].loomId).toBe(weft.loomId);
      await expect(page.getByTestId(`sidebar-loom-${weft.loomId}`)).toBeVisible();
      await page.getByTestId(`sidebar-loom-${weft.loomId}`).click();
      await expect(
        page.getByRole("heading", { name: /Loom: Bu AWS örneğini kısa değerlendir/ })
      ).toBeVisible();
      const weftReturnButton = page
        .locator(".weft-split-panel")
        .getByRole("button", { name: "Return to Origin" });
      await expect(weftReturnButton).toBeVisible();
      await weftReturnButton.click();
      await expect(page.getByText("The original response is no longer available.")).toBeVisible();
      await expect(page.locator(".origin-split-panel .qa-item")).toHaveCount(1);
      await expect(page.getByTestId(`sidebar-loom-${weft.loomId}`)).toBeVisible();
      await page.getByRole("button", { name: "Toggle Graph View" }).click();
      await expect(page.getByText("Weft-aware Loom graph")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /Loom: Bu AWS örneğini kısa değerlendir/ })
      ).toBeVisible();
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] returning from a Weft with a missing origin Loom shows a toast and stays on the Weft", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      const missingOriginWeft = await scenario.client.createLoom({
        title: "Loom: Missing origin return proof",
        kind: "weft",
        originLoomId: "missing-origin-loom",
        originResponseId: "missing-origin-response",
        metadata: {
          weftKind: "exploration",
          source: "e2e_missing_origin_fixture",
        },
      });
      await scenario.sendPrompt(
        missingOriginWeft.loom.loomId,
        "Event Sourcing missing origin Weft should stay usable."
      );

      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByTestId(`sidebar-loom-${missingOriginWeft.loom.loomId}`).click();
      await expect(
        page.getByRole("heading", {
          name: "Loom: Event Sourcing missing origin Weft should stay usable.",
        })
      ).toBeVisible();
      const returnButton = page.getByRole("button", { name: "Return to Origin" });
      await expect(returnButton).toBeVisible();
      await returnButton.click();
      await expect(page.getByText("The original Loom is no longer available.")).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Loom: Event Sourcing missing origin Weft should stay usable.",
        })
      ).toBeVisible();
      await expect(page.getByTestId(`sidebar-loom-${missingOriginWeft.loom.loomId}`)).toBeVisible();
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});
