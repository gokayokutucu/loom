// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service Quick Ask proof.
// - LEGACY_TYPESCRIPT_LOCAL for seeded Graph Ask UI state below.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";
import {
  buildAskContextPayload,
  createHeuristicResponseContextCapsule,
  resolveFocusedAskIntent,
} from "../src/services/responseContextCapsule";
import type { ResponseItem } from "../src/types";

interface ExportedResponse {
  responseId: string;
  role: "user" | "assistant";
  content: string;
  sequenceIndex: number;
}

interface LoomExportJson {
  responses: ExportedResponse[];
}

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "loom-ai-provider-settings-v1",
      JSON.stringify({ demo: { mockResponsesEnabled: true } })
    );
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openMcpGraph(page: Page) {
  await openApp(page);
  await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
  if ((await page.getByRole("heading", { name: "Weft-aware Loom graph" }).count()) === 0) {
    await page.getByRole("button", { name: "Toggle Graph View" }).click();
  }
  await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();
  await expect(page.getByPlaceholder("MCP and plugin integration notes")).toBeVisible();
}

async function clickFocusedGraphAsk(page: Page) {
  await page.mouse.move(900, 120);
  await expect(page.getByTestId("loom-sidebar")).not.toHaveAttribute(
    "data-sidebar-flyout",
    "true"
  );
  const responseNode = page.locator(
    '[data-id="loom:c-integrations:response:r-plugin-boundary"] .loom-graph-node--response'
  );
  await responseNode.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const askButton = responseNode.getByRole("button", { name: "Ask from this response" });
  await expect(askButton).toBeVisible();
  await askButton.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible();
  return popup;
}

async function selectResponseText(page: Page, responseId: string, selectedText: string) {
  await page.evaluate(
    ({ responseId: targetResponseId, selectedText: targetText }) => {
      const article = document.querySelector(`[data-response-id="${targetResponseId}"]`);
      const body = article?.querySelector(".assistant-body");
      if (!article || !body) throw new Error("Response body not found");
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const text = current.textContent ?? "";
        const start = text.indexOf(targetText);
        if (start >= 0) {
          const range = document.createRange();
          range.setStart(current, start);
          range.setEnd(current, start + targetText.length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          article.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return;
        }
        current = walker.nextNode();
      }
      throw new Error("Selection text not found");
    },
    { responseId, selectedText }
  );
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

function expectNoForbiddenPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("raw_thinking");
  expect(serialized).not.toContain("thinking_text");
  expect(serialized).not.toContain("chain_of_thought");
  expect(serialized).not.toContain("hidden_reasoning");
}

test.describe("[product-service-backed] Quick Ask product proof", () => {
  test("[product-service-backed] uses selected fragment, source context, follow-up turns, and Convert to Weft through loom-service", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const quickAskUrls: string[] = [];
    await page.route(/\/ask\/quick$/, async (route) => {
      quickAskUrls.push(route.request().url());
      if (quickAskUrls.length === 1) {
        await page.waitForTimeout(300);
      }
      await route.continue();
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "MCP, CQRS ve Event Sourcing ilişkisini anlat.");
      await expect(page.getByText("Model Context Protocol").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("MCP")
      );
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;
      const responses = await exportedLoomResponses(scenario, loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("MCP")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "MCP");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await expect(popup.getByTestId("ask-context")).toHaveCount(0);
      await expect(popup.getByTestId("ask-selected-fragment")).toContainText("MCP");

      await popup.getByLabel("Ask question").fill("açılımı nedir");
      await popup.getByRole("button", { name: /^Ask$/ }).click();
      await expect(popup.getByTestId("ask-answer")).toContainText("açılımı nedir");
      await expect(popup.getByTestId("ask-selected-fragment").first()).toContainText("MCP");

      await expect(popup.getByTestId("ask-answer")).toContainText(
        "MCP = Model Context Protocol"
      );
      await expect(popup.getByTestId("ask-answer")).toContainText("plugin entegrasyonu");
      await expect(popup.getByTestId("ask-answer")).toContainText("session");

      await popup.getByLabel("Ask question").fill("Event Sourcing ile ilişkisi ne?");
      await popup.getByRole("button", { name: /^Ask$/ }).click();
      await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
      await expect(popup.getByTestId("ask-answer-list")).toContainText(
        "Önceki Quick Ask turundaki açılımı koruyarak"
      );
      await expect(popup.getByTestId("ask-answer-list")).toContainText(
        "MCP seçili fragment olarak birincil kalır"
      );
      await expect(popup.getByTestId("ask-answer-list")).toContainText("Event Sourcing");
      await expect(popup.getByTestId("ask-answer-list")).not.toContainText("raw_thinking");
      await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Context Capsule");
      expect(quickAskUrls).toHaveLength(2);

      await popup.getByRole("button", { name: "Convert to Weft" }).click();
      const weftPanel = page.locator(".weft-split-panel").last();
      await expect(weftPanel).toBeVisible();
      await expect(weftPanel).toContainText("açılımı nedir");
      await expect(weftPanel).toContainText("Event Sourcing ile ilişkisi ne?");
      await expect(weftPanel).toContainText("MCP = Model Context Protocol");
      await expect(weftPanel).not.toContainText("Hidden context");
      await expect(weftPanel).not.toContainText("WeftOriginContextSnapshot");

      const wefts = await scenario.fetchJson<{ wefts: Array<{ loomId: string }> }>(
        `/responses/${encodeURIComponent(assistant!.responseId)}/wefts`
      );
      expect(wefts.wefts.length).toBeGreaterThan(0);
      const weftResponses = await exportedLoomResponses(scenario, wefts.wefts[0].loomId);
      expect(weftResponses.map((response) => response.content).join("\n")).toContain(
        "Event Sourcing ile ilişkisi ne?"
      );
      expectNoForbiddenPayload(wefts);
      expectNoForbiddenPayload(weftResponses);
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] resolves active chip as subject for short Quick Ask questions", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const quickAskBodies: unknown[] = [];
    const quickAskResponses: unknown[] = [];
    await page.route(/\/ask\/quick$/, async (route) => {
      quickAskBodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      const json = await response.json();
      quickAskResponses.push(json);
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Compaction Event Sourcing bağlamında ne anlama gelir?");
      await expect(page.getByText("Compaction in Event Sourcing").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Compaction")
      );
      expect(rootLoom).toBeTruthy();
      const responses = await exportedLoomResponses(scenario, rootLoom!.loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("Compaction")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "Compaction");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await expect(popup.getByTestId("ask-selected-fragment")).toContainText("Compaction");
      const visibleChipLabels = await popup.getByTestId("ask-selected-fragment").allInnerTexts();
      expect(visibleChipLabels).toContain("Compaction");

      await popup.getByLabel("Ask question").fill("ne anlama geliyor");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.getByTestId("ask-answer")).toContainText("Compaction");
      await expect(popup.getByTestId("ask-answer")).toContainText("Event Sourcing");
      await expect(popup.getByTestId("ask-answer")).toContainText("event log");
      await expect(popup.getByTestId("ask-answer")).toContainText("snapshot");
      await expect(popup.getByTestId("ask-answer")).not.toContainText(
        "Deterministic E2E provider only answers"
      );
      await expect(popup.getByTestId("ask-answer")).not.toContainText(
        "Event Sourcing nedir?"
      );
      await popup.getByTestId("quick-ask-debug").locator("summary").click();
      await expect(popup.getByTestId("quick-ask-debug-composed-task")).toContainText(
        "Event Sourcing bağlamında Compaction ne anlama gelir?"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "genericSourceOnlyDetected=false"
      );

      expect(quickAskBodies).toHaveLength(1);
      expect(quickAskBodies[0]).toMatchObject({
        selectedText: "Compaction",
        question: "ne anlama geliyor",
        intent: "definition",
        activeReferences: [
          expect.objectContaining({
            label: "Compaction",
            selectedText: "Compaction",
            sourceResponseId: assistant!.responseId,
          }),
        ],
      });
      expect(quickAskResponses[0]).toMatchObject({
        focusSubject: "Compaction",
        focusSubjectSource: "selected_fragment",
        resolvedIntent: "definition",
        requestedTopic: "Event Sourcing",
        diagnostics: expect.objectContaining({
          selectedText: "Compaction",
          activeReferenceLabels: ["Compaction"],
          sourceResponseId: assistant!.responseId,
          previousAskTurnCount: 0,
          focusSubject: "Compaction",
          focusSubjectSource: "selected_fragment",
          resolvedIntent: "definition",
          requestedTopic: "Event Sourcing",
          composedTask: "Event Sourcing bağlamında Compaction ne anlama gelir?",
          promptSectionOrder: expect.arrayContaining([
            "composed_task",
            "focus_subject",
            "selected_fragment",
            "background_source_context",
          ]),
          providerRequestSummary: expect.objectContaining({
            focusSubject: "Compaction",
            activeReferenceLabels: ["Compaction"],
            selectedText: "Compaction",
            requestedTopic: "Event Sourcing",
            composedTaskPreview: "Event Sourcing bağlamında Compaction ne anlama gelir?",
            containsFocusSubject: true,
            focusSubjectBeforeSource: true,
          }),
          answerValidation: expect.objectContaining({
            includesFocusSubject: true,
            includesRequestedTopic: true,
            genericSourceOnlyDetected: false,
          }),
        }),
      });
      expectNoForbiddenPayload(quickAskBodies[0]);
      expectNoForbiddenPayload(quickAskResponses[0]);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] traces visible chip composition for Write Side meaning", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const quickAskBodies: unknown[] = [];
    const quickAskResponses: unknown[] = [];
    await page.route(/\/ask\/quick$/, async (route) => {
      quickAskBodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      const json = await response.json();
      quickAskResponses.push(json);
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Event store detaylı anlat");
      await expect(page.getByText("Write Side").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.toLowerCase().includes("event store")
      );
      expect(rootLoom).toBeTruthy();
      const responses = await exportedLoomResponses(scenario, rootLoom!.loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("Write Side")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "Write Side");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await expect(popup.getByTestId("ask-selected-fragment")).toContainText("Write Side");

      await popup.getByLabel("Ask question").fill("ne anlama geliyor");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.getByTestId("ask-answer")).toContainText("Write Side");
      await expect(popup.getByTestId("ask-answer")).toContainText("Event Store");
      await expect(popup.getByTestId("ask-answer")).toContainText("komut");
      await expect(popup.getByTestId("ask-answer")).not.toContainText(
        "Debug failure"
      );
      await expect(popup.getByTestId("ask-answer")).not.toContainText(
        "Event Store nedir?"
      );

      const debugPanel = popup.getByTestId("quick-ask-debug");
      await debugPanel.locator("summary").click();
      await expect(popup.getByTestId("quick-ask-debug-engine-mode")).toContainText(
        "rust-service"
      );
      await expect(popup.getByTestId("quick-ask-debug-client-kind")).toContainText(
        "rust-http"
      );
      await expect(popup.getByTestId("quick-ask-debug-request-attempted")).toContainText(
        "true"
      );
      await expect(popup.getByTestId("quick-ask-debug-endpoint")).toContainText(
        "/ask/quick"
      );
      await expect(popup.getByTestId("quick-ask-debug-http-status")).toContainText("200");
      await expect(popup.getByTestId("quick-ask-debug-response-parse-status")).toContainText(
        "success"
      );
      await expect(popup.getByTestId("quick-ask-debug-diagnostics-received")).toContainText(
        "true"
      );
      await expect(popup.getByTestId("quick-ask-debug-visible-chips")).toContainText(
        "Write Side"
      );
      await expect(popup.getByTestId("quick-ask-debug-input-active-references")).toContainText(
        "Write Side"
      );
      await expect(popup.getByTestId("quick-ask-debug-service-active-references")).toContainText(
        "Write Side"
      );
      await expect(popup.getByTestId("quick-ask-debug-focus-subject")).toContainText(
        "Write Side"
      );
      await expect(popup.getByTestId("quick-ask-debug-requested-topic")).toContainText(
        "Event Store"
      );
      await expect(popup.getByTestId("quick-ask-debug-composed-task")).toContainText(
        "Event Store bağlamında Write Side ne anlama gelir?"
      );
      await expect(popup.getByTestId("quick-ask-debug-prompt-order")).toContainText(
        "composed_task"
      );
      await expect(popup.getByTestId("quick-ask-debug-provider-summary")).toContainText(
        "focusBeforeSource=true"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "includesFocusSubject=true"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "validationPassed=true"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "finalAnswerSource=first_attempt"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "genericSourceOnlyDetected=false"
      );

      expect(quickAskBodies).toHaveLength(1);
      expect(quickAskBodies[0]).toMatchObject({
        quickAskTraceId: expect.stringMatching(/^quick-ask-/),
        selectedText: "Write Side",
        question: "ne anlama geliyor",
        activeReferences: [
          expect.objectContaining({
            label: "Write Side",
            selectedText: "Write Side",
            sourceResponseId: assistant!.responseId,
          }),
        ],
      });
      expect(quickAskResponses[0]).toMatchObject({
        focusSubject: "Write Side",
        focusSubjectSource: "selected_fragment",
        resolvedIntent: "definition",
        requestedTopic: "Event Store",
        diagnostics: expect.objectContaining({
          traceId: expect.stringMatching(/^quick-ask-/),
          inputActiveReferenceLabels: ["Write Side"],
          serviceActiveReferenceLabels: ["Write Side"],
          composedTask: "Event Store bağlamında Write Side ne anlama gelir?",
          promptSectionOrder: expect.arrayContaining([
            "current_task",
            "composed_task",
            "focus_subject",
            "background_source_context",
          ]),
          providerRequestSummary: expect.objectContaining({
            focusSubject: "Write Side",
            requestedTopic: "Event Store",
            composedTaskPreview: "Event Store bağlamında Write Side ne anlama gelir?",
            containsFocusSubject: true,
            focusSubjectBeforeSource: true,
          }),
          answerValidation: expect.objectContaining({
            includesFocusSubject: true,
            includesRequestedTopic: true,
            genericSourceOnlyDetected: false,
            startsWithFocusSubjectOrDefinition: true,
            validationPassed: true,
            finalAnswerSource: "first_attempt",
          }),
        }),
      });
      expectNoForbiddenPayload(quickAskBodies[0]);
      expectNoForbiddenPayload(quickAskResponses[0]);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] blocks generic source-only Quick Ask answer for focused chip", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      forceGenericQuickAskFirstAttempt: true,
      startApp: true,
    });
    const quickAskResponses: unknown[] = [];
    await page.route(/\/ask\/quick$/, async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      quickAskResponses.push(json);
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Time Travel Event Sourcing bağlamında detaylı anlat");
      await expect(page.getByText("Time Travel in Event Sourcing").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.toLowerCase().includes("time travel")
      );
      expect(rootLoom).toBeTruthy();
      const responses = await exportedLoomResponses(scenario, rootLoom!.loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("Time Travel")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "Time Travel");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await popup.getByLabel("Ask question").fill("nasıl kullanılıyor? bu ne demek");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.getByTestId("ask-answer")).toContainText(
        "Quick Ask could not produce an answer focused on Time Travel"
      );
      await expect(popup.getByTestId("ask-answer")).not.toContainText(
        "Finans, sipariş yönetimi, audit"
      );

      await popup.getByTestId("quick-ask-debug").locator("summary").click();
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "includesFocusSubject=false"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "genericSourceOnlyDetected=true"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "validationPassed=false"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "finalAnswerSource=validation_error"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "validation_missing_focus"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "provider_ignored_focus"
      );
      await expect(popup.getByTestId("quick-ask-debug-warnings")).toContainText(
        "quick_ask_focus_validation_failed"
      );

      expect(quickAskResponses[0]).toMatchObject({
        answer: expect.stringContaining(
          "Quick Ask could not produce an answer focused on Time Travel"
        ),
        focusSubject: "Time Travel",
        diagnostics: expect.objectContaining({
          focusSubject: "Time Travel",
          requestedTopic: "Event Sourcing",
          answerValidation: expect.objectContaining({
            includesFocusSubject: false,
            includesRequestedTopic: true,
            genericSourceOnlyDetected: true,
            validationPassed: false,
            finalAnswerSource: "validation_error",
            failureReasons: expect.arrayContaining([
              "validation_missing_focus",
              "provider_ignored_focus",
            ]),
          }),
        }),
      });
      expectNoForbiddenPayload(quickAskResponses[0]);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] proves Time Travel Quick Ask transport diagnostics", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const quickAskBodies: unknown[] = [];
    const quickAskResponses: unknown[] = [];
    await page.route(/\/ask\/quick$/, async (route) => {
      quickAskBodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      const json = await response.json();
      quickAskResponses.push(json);
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Time Travel Event Sourcing bağlamında detaylı anlat");
      await expect(page.getByText("Time Travel in Event Sourcing").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.toLowerCase().includes("time travel")
      );
      expect(rootLoom).toBeTruthy();
      const responses = await exportedLoomResponses(scenario, rootLoom!.loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("Time Travel")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "Time Travel");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await expect(popup.getByTestId("ask-selected-fragment")).toContainText("Time Travel");

      await popup.getByLabel("Ask question").fill("nasıl kullanılıyor? bu ne demek");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.getByTestId("ask-answer")).toContainText("Time Travel");
      await expect(popup.getByTestId("ask-answer")).toContainText("Event Sourcing");
      await expect(popup.getByTestId("ask-answer")).not.toContainText("Debug failure");

      const debugPanel = popup.getByTestId("quick-ask-debug");
      await debugPanel.locator("summary").click();
      await expect(popup.getByTestId("quick-ask-debug-engine-mode")).toContainText(
        "rust-service"
      );
      await expect(popup.getByTestId("quick-ask-debug-client-kind")).toContainText(
        "rust-http"
      );
      await expect(popup.getByTestId("quick-ask-debug-request-attempted")).toContainText(
        "true"
      );
      await expect(popup.getByTestId("quick-ask-debug-endpoint")).toContainText(
        "/ask/quick"
      );
      await expect(popup.getByTestId("quick-ask-debug-http-status")).toContainText("200");
      await expect(popup.getByTestId("quick-ask-debug-response-parse-status")).toContainText(
        "success"
      );
      await expect(popup.getByTestId("quick-ask-debug-diagnostics-received")).toContainText(
        "true"
      );
      await expect(popup.getByTestId("quick-ask-debug-visible-chips")).toContainText(
        "Time Travel"
      );
      await expect(popup.getByTestId("quick-ask-debug-input-active-references")).toContainText(
        "Time Travel"
      );
      await expect(popup.getByTestId("quick-ask-debug-service-active-references")).toContainText(
        "Time Travel"
      );
      await expect(popup.getByTestId("quick-ask-debug-focus-subject")).toContainText(
        "Time Travel"
      );
      await expect(popup.getByTestId("quick-ask-debug-requested-topic")).toContainText(
        "Event Sourcing"
      );
      await expect(popup.getByTestId("quick-ask-debug-composed-task")).toContainText(
        "Time Travel"
      );
      await expect(popup.getByTestId("quick-ask-debug-provider-summary")).toContainText(
        "focusBeforeSource=true"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "includesFocusSubject=true"
      );

      expect(quickAskBodies).toHaveLength(1);
      expect(quickAskBodies[0]).toMatchObject({
        quickAskTraceId: expect.stringMatching(/^quick-ask-/),
        selectedText: "Time Travel",
        question: "nasıl kullanılıyor? bu ne demek",
        activeReferences: [
          expect.objectContaining({
            label: "Time Travel",
            selectedText: "Time Travel",
            sourceResponseId: assistant!.responseId,
          }),
        ],
      });
      expect(quickAskResponses[0]).toMatchObject({
        focusSubject: "Time Travel",
        requestedTopic: "Event Sourcing",
        diagnostics: expect.objectContaining({
          traceId: expect.stringMatching(/^quick-ask-/),
          inputActiveReferenceLabels: ["Time Travel"],
          serviceActiveReferenceLabels: ["Time Travel"],
          providerRequestSummary: expect.objectContaining({
            focusSubject: "Time Travel",
            requestedTopic: "Event Sourcing",
            containsFocusSubject: true,
            focusSubjectBeforeSource: true,
          }),
          answerValidation: expect.objectContaining({
            includesFocusSubject: true,
            includesRequestedTopic: true,
            genericSourceOnlyDetected: false,
          }),
        }),
      });
      expectNoForbiddenPayload(quickAskBodies[0]);
      expectNoForbiddenPayload(quickAskResponses[0]);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] recovers Quick Ask after typed provider failure without page refresh", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    let quickAskCount = 0;
    await page.route(/\/ask\/quick$/, async (route) => {
      quickAskCount += 1;
      if (quickAskCount === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "RUNTIME_UNAVAILABLE",
            message: "Ollama provider is unavailable.",
            kind: "runtime_unavailable",
            retryable: true,
            correlationId: "quick-provider-failure",
            details: {
              endpoint: "/ask/quick",
              raw_thinking: "hidden",
            },
          }),
        });
        return;
      }
      const response = await route.fetch();
      await route.fulfill({ response });
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "MCP, CQRS ve Event Sourcing ilişkisini anlat.");
      await expect(page.getByText("Model Context Protocol").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("MCP")
      );
      expect(rootLoom).toBeTruthy();
      const responses = await exportedLoomResponses(scenario, rootLoom!.loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("MCP")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "MCP");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await popup.getByLabel("Ask question").fill("açılımı nedir");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.locator(".ask-error")).toContainText("Ollama provider is unavailable.");
      await expect(popup.getByRole("button", { name: /^Ask$/ })).toBeDisabled();
      await expect(popup.getByText("loom-service request failed.")).toHaveCount(0);
      await expect(popup.getByText("raw_thinking")).toHaveCount(0);
      await popup.getByTestId("quick-ask-debug").locator("summary").click();
      await expect(popup.getByTestId("quick-ask-debug-engine-mode")).toContainText(
        "rust-service"
      );
      await expect(popup.getByTestId("quick-ask-debug-request-attempted")).toContainText(
        "true"
      );
      await expect(popup.getByTestId("quick-ask-debug-endpoint")).toContainText(
        "/ask/quick"
      );
      await expect(popup.getByTestId("quick-ask-debug-http-status")).toContainText("503");
      await expect(popup.getByTestId("quick-ask-debug-diagnostics-received")).toContainText(
        "false"
      );
      await expect(popup.getByTestId("quick-ask-debug-transport-error")).toContainText(
        "provider_unavailable"
      );

      await popup.getByLabel("Ask question").fill("açılımı nedir");
      await expect(popup.getByRole("button", { name: /^Ask$/ })).toBeEnabled();
      await popup.getByRole("button", { name: /^Ask$/ }).click();
      await expect(popup.getByTestId("ask-answer-list")).toContainText(
        "MCP = Model Context Protocol"
      );
      await expect(popup.getByTestId("ask-answer-list")).toContainText("session");
      expect(quickAskCount).toBe(2);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] audits visible chip to provider request for Audit Trail usage", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const quickAskBodies: unknown[] = [];
    const quickAskResponses: unknown[] = [];
    await page.route(/\/ask\/quick$/, async (route) => {
      quickAskBodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      const json = await response.json();
      quickAskResponses.push(json);
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Audit Trail Event Sourcing bağlamında ne işe yarar?");
      await expect(page.getByText("Audit Trail in Event Sourcing").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Audit Trail")
      );
      expect(rootLoom).toBeTruthy();
      const responses = await exportedLoomResponses(scenario, rootLoom!.loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("Audit Trail")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "Audit Trail");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await expect(popup.getByTestId("ask-selected-fragment")).toContainText("Audit Trail");
      const visibleChipLabels = await popup.getByTestId("ask-selected-fragment").allInnerTexts();
      expect(visibleChipLabels).toContain("Audit Trail");

      await popup.getByLabel("Ask question").fill("hangi işlerde kullanılıyor ki?");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.getByTestId("ask-answer")).toContainText("Audit Trail");
      await expect(popup.getByTestId("ask-answer")).toContainText("Event Sourcing");
      await expect(popup.getByTestId("ask-answer")).toContainText("kimin");
      await expect(popup.getByTestId("ask-answer")).toContainText("uyumluluk");
      await expect(popup.getByTestId("ask-answer")).not.toContainText(
        "Deterministic E2E provider only answers"
      );
      await expect(popup.getByTestId("ask-answer")).not.toContainText(
        "Event Sourcing, uygulama durumunu"
      );
      await popup.getByTestId("quick-ask-debug").locator("summary").click();
      await expect(popup.getByTestId("quick-ask-debug-composed-task")).toContainText(
        "Event Sourcing bağlamında Audit Trail hangi işlerde kullanılır?"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "genericSourceOnlyDetected=false"
      );

      expect(quickAskBodies).toHaveLength(1);
      expect(quickAskBodies[0]).toMatchObject({
        selectedText: "Audit Trail",
        question: "hangi işlerde kullanılıyor ki?",
        intent: "usage",
        activeReferences: [
          expect.objectContaining({
            label: "Audit Trail",
            selectedText: "Audit Trail",
            sourceResponseId: assistant!.responseId,
          }),
        ],
      });
      expect(quickAskResponses[0]).toMatchObject({
        focusSubject: "Audit Trail",
        focusSubjectSource: "selected_fragment",
        resolvedIntent: "usage",
        requestedTopic: "Event Sourcing",
        diagnostics: expect.objectContaining({
          selectedText: "Audit Trail",
          activeReferenceLabels: ["Audit Trail"],
          sourceResponseId: assistant!.responseId,
          previousAskTurnCount: 0,
          focusSubject: "Audit Trail",
          focusSubjectSource: "selected_fragment",
          resolvedIntent: "usage",
          requestedTopic: "Event Sourcing",
          composedTask: "Event Sourcing bağlamında Audit Trail hangi işlerde kullanılır?",
          promptSectionOrder: expect.arrayContaining([
            "current_task",
            "composed_task",
            "focus_subject",
            "active_references",
            "selected_fragment",
            "background_source_context",
            "current_question",
          ]),
          providerRequestSummary: expect.objectContaining({
            focusSubject: "Audit Trail",
            activeReferenceLabels: ["Audit Trail"],
            selectedText: "Audit Trail",
            requestedTopic: "Event Sourcing",
            composedTaskPreview:
              "Event Sourcing bağlamında Audit Trail hangi işlerde kullanılır?",
            containsFocusSubject: true,
            focusSubjectBeforeSource: true,
          }),
          answerValidation: expect.objectContaining({
            includesFocusSubject: true,
            includesRequestedTopic: true,
            genericSourceOnlyDetected: false,
          }),
        }),
      });
      expectNoForbiddenPayload(quickAskBodies[0]);
      expectNoForbiddenPayload(quickAskResponses[0]);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] normalizes noisy Quick Ask focus labels before provider request", async () => {
    test.setTimeout(90_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
    });

    try {
      const response = await scenario.fetchJson<{
        answer: string;
        focusSubject?: string;
        requestedTopic?: string;
        diagnostics?: {
          originalFocusSubject?: string;
          normalizedFocusSubject?: string;
          focusSubject?: string;
          requestedTopic?: string;
          composedTask?: string;
          providerRequestSummary?: {
            focusSubject?: string;
            composedTaskPreview?: string;
            containsFocusSubject?: boolean;
          };
          answerValidation?: {
            includesFocusSubject?: boolean;
            genericSourceOnlyDetected?: boolean;
            validationPassed?: boolean;
          };
        };
      }>("/ask/quick", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "audit-trail-normalization",
          quickAskTraceId: "quick-ask-normalization-e2e",
          sourceLoomId: "loom-event-sourcing",
          sourceResponseId: "response-event-sourcing",
          selectedText: "Audit Trail)",
          sourceContext: {
            title: "Event Sourcing",
            responseCode: "R-AUDIT",
            summary: "Event Sourcing stores domain events for auditability.",
            keyPoints: ["Audit Trail is a common Event Sourcing use case."],
            keywords: ["event sourcing", "audit trail"],
            entities: ["Event Sourcing"],
          },
          activeReferences: [
            {
              label: "Audit Trail)",
              targetKind: "fragment",
              targetId: "response-audit-trail",
              selectedText: "Audit Trail)",
              sourceResponseId: "response-event-sourcing",
            },
          ],
          turns: [],
          question: "Bu ne demek? nasıl kullanılır?",
          intent: "usage",
          options: { model: "deterministic-event-sourcing:e2e" },
        }),
      });

      expect(response.focusSubject).toBe("Audit Trail");
      expect(response.requestedTopic).toBe("Event Sourcing");
      expect(response.answer).toContain("Audit Trail");
      expect(response.answer).toContain("Event Sourcing");
      expect(response.answer).not.toContain("Focus subject:");
      expect(response.answer).not.toContain("Audit Trail) Audit Trail)");
      expect(response.diagnostics).toMatchObject({
        originalFocusSubject: "Audit Trail)",
        normalizedFocusSubject: "Audit Trail",
        focusSubject: "Audit Trail",
        requestedTopic: "Event Sourcing",
        composedTask:
          "Event Sourcing bağlamında Audit Trail ne anlama gelir ve nasıl kullanılır?",
        providerRequestSummary: expect.objectContaining({
          focusSubject: "Audit Trail",
          composedTaskPreview:
            "Event Sourcing bağlamında Audit Trail ne anlama gelir ve nasıl kullanılır?",
          containsFocusSubject: true,
        }),
        answerValidation: expect.objectContaining({
          includesFocusSubject: true,
          genericSourceOnlyDetected: false,
          validationPassed: true,
        }),
      });
      expectNoForbiddenPayload(response);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] composes event chip meaning in natural Turkish", async () => {
    test.setTimeout(90_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
    });

    try {
      const response = await scenario.fetchJson<{
        answer: string;
        focusSubject?: string;
        diagnostics?: {
          originalFocusSubject?: string;
          normalizedFocusSubject?: string;
          focusSubjectSource?: string;
          composedTask?: string;
          normalizedComposedQuestion?: string;
          answerValidation?: {
            validationPassed?: boolean;
            languageContaminationDetected?: boolean;
          };
        };
      }>("/ask/quick", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "event-meaning-composition",
          quickAskTraceId: "quick-ask-event-composition-e2e",
          sourceLoomId: "loom-event-sourcing",
          sourceResponseId: "response-event-sourcing",
          selectedText: "event)",
          sourceContext: {
            title: "Event Sourcing",
            responseCode: "R-EVENT",
            summary: "Event Sourcing stores state changes as events.",
            keyPoints: ["An event records a state change."],
            keywords: ["event sourcing", "event"],
            entities: ["Event Sourcing"],
          },
          activeReferences: [
            {
              label: "event)",
              targetKind: "fragment",
              targetId: "response-event",
              selectedText: "event)",
              sourceResponseId: "response-event-sourcing",
            },
          ],
          turns: [],
          question: "ne demek",
          intent: "definition",
          options: { model: "deterministic-event-sourcing:e2e" },
        }),
      });

      expect(response.focusSubject).toBe("event");
      expect(response.answer).toContain("event");
      expect(response.answer).toContain("Event Sourcing");
      expect(response.diagnostics).toMatchObject({
        originalFocusSubject: "event)",
        normalizedFocusSubject: "event",
        focusSubjectSource: "selected_fragment",
        composedTask: "Event Sourcing bağlamında event ne anlama gelir?",
        normalizedComposedQuestion: "Event Sourcing bağlamında event ne anlama gelir?",
        answerValidation: expect.objectContaining({
          validationPassed: true,
          languageContaminationDetected: false,
        }),
      });
      expect(response.diagnostics?.composedTask).not.toContain("event olarak ne demek");
      expectNoForbiddenPayload(response);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] previous Quick Ask answer term beats stale chip", async () => {
    test.setTimeout(90_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
    });

    try {
      const response = await scenario.fetchJson<{
        answer: string;
        focusSubject?: string;
        focusSubjectSource?: string;
        diagnostics?: {
          previousAnswerTermMatched?: string;
          activeChipUsedAsPrimary?: boolean;
          activeChipUsedAsBackground?: boolean;
          composedTask?: string;
          language?: string;
          staleChipOverrideDetected?: boolean;
          languageContaminationDetected?: boolean;
          answerValidation?: {
            validationPassed?: boolean;
            staleChipOverrideDetected?: boolean;
            languageContaminationDetected?: boolean;
          };
        };
      }>("/ask/quick", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "resultado-follow-up",
          quickAskTraceId: "quick-ask-resultado-follow-up-e2e",
          sourceLoomId: "loom-event-sourcing",
          sourceResponseId: "response-event-sourcing",
          selectedText: "event)",
          sourceContext: {
            title: "Event Sourcing",
            responseCode: "R-EVENT",
            summary: "Event Sourcing stores state changes as events.",
            keyPoints: ["An event records a state change."],
            keywords: ["event sourcing", "event"],
            entities: ["Event Sourcing"],
          },
          activeReferences: [
            {
              label: "event)",
              targetKind: "fragment",
              targetId: "response-event",
              selectedText: "event)",
              sourceResponseId: "response-event-sourcing",
            },
          ],
          turns: [
            {
              question: "ne demek",
              answer:
                "Event, Event Sourcing bağlamında bir durum değişikliğini kaydeder. Resultado burada sonuç anlamına gelen yabancı bir kelimedir.",
            },
          ],
          question: "resultado ne be",
          intent: "definition",
          options: { model: "deterministic-event-sourcing:e2e" },
        }),
      });

      expect(response.focusSubject).toBe("resultado");
      expect(response.focusSubjectSource).toBe("previous_assistant_answer");
      expect(response.answer.toLowerCase()).toContain("resultado");
      expect(response.answer.toLowerCase()).toContain("sonuç");
      expect(response.answer).not.toMatch(/^event[,)]/i);
      expect(response.diagnostics).toMatchObject({
        previousAnswerTermMatched: "resultado",
        activeChipUsedAsPrimary: false,
        activeChipUsedAsBackground: true,
        composedTask: 'Önceki yanıtta geçen "resultado" ne anlama gelir?',
        language: "tr",
        staleChipOverrideDetected: false,
        languageContaminationDetected: false,
        answerValidation: expect.objectContaining({
          validationPassed: true,
          staleChipOverrideDetected: false,
          languageContaminationDetected: false,
        }),
      });
      expectNoForbiddenPayload(response);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] follow-up usage keeps seed chip as background and avoids repeating definition", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const quickAskBodies: unknown[] = [];
    const quickAskResponses: unknown[] = [];
    await page.route(/\/ask\/quick$/, async (route) => {
      quickAskBodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      const json = await response.json();
      quickAskResponses.push(json);
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "event logging Event Sourcing bağlamında nedir?");
      await expect(page.getByText("Event Logging in Event Sourcing").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.toLowerCase().includes("event logging")
      );
      expect(rootLoom).toBeTruthy();
      const responses = await exportedLoomResponses(scenario, rootLoom!.loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("event logging)")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "event logging)");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await expect(popup.getByTestId("ask-selected-fragment")).toContainText("event logging)");

      await popup.getByLabel("Ask question").fill("bu ne");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.getByTestId("ask-answer")).toHaveCount(1);
      await expect(popup.getByTestId("ask-answer").first()).toContainText("event logging");
      await expect(popup.getByTestId("ask-answer").first()).toContainText("Event Sourcing");
      await expect(popup.getByTestId("ask-answer").first()).toContainText("yaklaşımı");

      await popup.getByLabel("Ask question").fill("nasıl kullanılıyor");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
      const secondExchange = popup.getByTestId("ask-answer").nth(1);
      await expect(secondExchange).toContainText("nasıl kullanılıyor");
      await expect(secondExchange.getByTestId("ask-selected-fragment")).toHaveCount(0);
      await expect(secondExchange).toContainText("event logging");
      await expect(secondExchange).toContainText("Event Store");
      await expect(secondExchange).toContainText("event log");
      await expect(secondExchange).toContainText("replay");
      await expect(secondExchange).toContainText("projection");
      await expect(secondExchange).not.toContainText("place");

      await popup.getByTestId("quick-ask-debug").locator("summary").click();
      await expect(popup.getByTestId("quick-ask-debug-seed-context")).toContainText(
        "event logging"
      );
      await expect(popup.getByTestId("quick-ask-debug-seed-mode")).toContainText(
        "background"
      );
      await expect(popup.getByTestId("quick-ask-debug-primary-context")).toContainText(
        "previous_answer + current_question"
      );
      await expect(popup.getByTestId("quick-ask-debug-follow-up-intent")).toContainText(
        "usage"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "repeatsPreviousAnswer=false"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "answerAddsNewInformation=true"
      );
      await expect(popup.getByTestId("quick-ask-debug-answer-validation")).toContainText(
        "validationPassed=true"
      );

      expect(quickAskBodies).toHaveLength(2);
      expect(quickAskBodies[1]).toMatchObject({
        selectedText: "event logging)",
        question: "nasıl kullanılıyor",
        turns: [
          expect.objectContaining({
            question: "bu ne",
          }),
        ],
      });
      expect(quickAskResponses[1]).toMatchObject({
        focusSubject: "event logging",
        focusSubjectSource: "previous_assistant_answer",
        resolvedIntent: "usage",
        diagnostics: expect.objectContaining({
          seedContextLabels: ["event logging"],
          seedContextMode: "background",
          currentTurnPrimaryContext: "previous_answer + current_question",
          followUpIntent: "usage",
          answerValidation: expect.objectContaining({
            followsUpOnPreviousTurn: true,
            seedChipRenderedAsCurrentTurn: false,
            repeatsPreviousAnswer: false,
            answerAddsNewInformation: true,
            languageContaminationDetected: false,
            validationPassed: true,
          }),
        }),
      });

      await popup.getByRole("button", { name: "Convert to Weft" }).click();
      const weftPanel = page.locator(".weft-split-panel").last();
      await expect(weftPanel).toBeVisible();
      await expect(weftPanel).toContainText("bu ne");
      await expect(weftPanel).toContainText("nasıl kullanılıyor");
      await expect(weftPanel).toContainText("event logging");
      await expect(weftPanel).not.toContainText("Hidden context");
      await expect(weftPanel).not.toContainText("WeftOriginContextSnapshot");

      expectNoForbiddenPayload(quickAskBodies);
      expectNoForbiddenPayload(quickAskResponses);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] sends active Reference context for relation-to-topic Quick Ask", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const quickAskBodies: unknown[] = [];
    const quickAskResponses: unknown[] = [];
    await page.route(/\/ask\/quick$/, async (route) => {
      const body = route.request().postDataJSON();
      quickAskBodies.push(body);
      const response = await route.fetch();
      const json = await response.json();
      quickAskResponses.push(json);
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Error Tracking event sourcing ile nasıl yapılır?");
      await expect(page.getByText("CommandFailed").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Error Tracking")
      );
      expect(rootLoom).toBeTruthy();
      const responses = await exportedLoomResponses(scenario, rootLoom!.loomId);
      const assistant = responses.find(
        (response) => response.role === "assistant" && response.content.includes("Error Tracking")
      );
      expect(assistant).toBeTruthy();

      await selectResponseText(page, assistant!.responseId, "Error Tracking");
      const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
      await expect(selectionToolbar).toBeVisible();
      await selectionToolbar.getByRole("button", { name: "Quick Question" }).click();

      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();
      await expect(popup.getByTestId("ask-selected-fragment")).toContainText("Error Tracking");

      await popup.getByLabel("Ask question").fill("nasıl yapılır event sourcingde?");
      await popup.getByRole("button", { name: /^Ask$/ }).click();

      await expect(popup.getByTestId("ask-answer")).toContainText("Error Tracking");
      await expect(popup.getByTestId("ask-answer")).toContainText("Event Sourcing");
      await expect(popup.getByTestId("ask-answer")).toContainText("CommandFailed");
      await expect(popup.getByTestId("ask-answer")).toContainText("Event Store");
      await expect(popup.getByTestId("ask-answer")).not.toContainText(
        "Deterministic E2E provider only answers"
      );

      expect(quickAskBodies).toHaveLength(1);
      expect(quickAskBodies[0]).toMatchObject({
        selectedText: "Error Tracking",
        question: "nasıl yapılır event sourcingde?",
        intent: "implementation_in_topic",
        activeReferences: [
          expect.objectContaining({
            label: "Error Tracking",
            selectedText: "Error Tracking",
            sourceResponseId: assistant!.responseId,
          }),
        ],
      });
      expect(quickAskResponses[0]).toMatchObject({
        focusSubject: "Error Tracking",
        focusSubjectSource: "selected_fragment",
        resolvedIntent: "implementation_in_topic",
        requestedTopic: "Event Sourcing",
        diagnostics: expect.objectContaining({
          activeReferenceLabels: ["Error Tracking"],
          composedTask: "Event Sourcing bağlamında Error Tracking nasıl yapılır?",
          providerRequestSummary: expect.objectContaining({
            focusSubject: "Error Tracking",
            activeReferenceLabels: ["Error Tracking"],
            requestedTopic: "Event Sourcing",
            composedTaskPreview: "Event Sourcing bağlamında Error Tracking nasıl yapılır?",
            containsFocusSubject: true,
            focusSubjectBeforeSource: true,
          }),
          answerValidation: expect.objectContaining({
            includesFocusSubject: true,
            includesRequestedTopic: true,
            genericSourceOnlyDetected: false,
          }),
        }),
      });
      expectNoForbiddenPayload(quickAskBodies[0]);
      expectNoForbiddenPayload(quickAskResponses[0]);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});

test.describe("[legacy-typescript-local] Graph node Ask", () => {
  test("builds acronym selected-fragment payload with direct intent before source context", () => {
    const response: ResponseItem = {
      id: "r-host-shell",
      title: "Host shell adapters keep Electron optional",
      address: "loom://engineering/mcp-plugin-integration/loom/host-shell/r-host-shell",
      question: "How should the web prototype stay Electron-ready?",
      answer: [
        "In Electron the same adapter can delegate to the main process with IPC.",
      ],
      suggestedLinks: [],
      bookmarkedLinks: [],
    };
    const capsule = createHeuristicResponseContextCapsule(response, "c-integrations", "IPC");
    const payload = buildAskContextPayload({
      response,
      selectedText: "IPC",
      userQuestion: "açılımı ne",
      capsule,
    });

    expect(resolveFocusedAskIntent({
      selectedText: "IPC",
      currentQuestion: "açılımı ne",
    })).toBe("acronym_expansion");
    expect(payload.focusedIntent).toBe("acronym_expansion");
    expect(payload.context[0]).toContain("Current task:");
    expect(payload.context[0]).toContain('Selected fragment:\n"IPC"');
    expect(payload.context[0]).toContain('User question:\n"açılımı ne"');
    expect(payload.context[0]).toContain("Detected intent:\nacronym_expansion");
    expect(payload.context[0]).toContain('The answer should start with: "IPC = <expansion>".');
    expect(payload.context[0]).not.toContain("Host shell adapters keep Electron optional");
    expect(payload.backgroundContext[0]).toContain("Source context clues:");
    expect(payload.backgroundContext[0]).toContain("Use source context clues to disambiguate");
    expect(payload.backgroundContext[1]).toContain("Background source context, use only if needed:");
    expect(payload.backgroundContext[1]).toContain("Host shell adapters keep Electron optional");
    expect(payload.context[0].indexOf('User question:\n"açılımı ne"')).toBeLessThan(
      payload.backgroundContext[1].indexOf("Host shell adapters keep Electron optional") +
        payload.context[0].length
    );
  });

  test("builds cautious acronym payload when source does not define expansion", () => {
    const response: ResponseItem = {
      id: "r-ambiguous",
      title: "Short source without expansion",
      address: "loom://test/ambiguous",
      question: "What is noted?",
      answer: ["ABC appears in a short note without any explicit expansion."],
      suggestedLinks: [],
      bookmarkedLinks: [],
    };
    const capsule = createHeuristicResponseContextCapsule(response, "c-test", "ABC");
    const payload = buildAskContextPayload({
      response,
      selectedText: "ABC",
      userQuestion: "açılımı nedir",
      capsule,
    });

    expect(payload.focusedIntent).toBe("acronym_expansion");
    expect(payload.context[0]).toContain("answer with cautious wording");
    expect(payload.context[0]).toContain("Do not choose an unrelated expansion");
    expect(payload.backgroundContext[0]).toContain("Source context clues:");
  });

  test("detects English translation requests for selected fragments", () => {
    const response: ResponseItem = {
      id: "r-translation",
      title: "Event Sourcing terms",
      address: "loom://test/translation",
      question: "Event sourcing nedir?",
      answer: ["Tarihsel Takip terimi bu yanıtta geçiyor."],
      suggestedLinks: [],
      bookmarkedLinks: [],
    };
    const capsule = createHeuristicResponseContextCapsule(
      response,
      "c-translation",
      "Tarihsel Takip"
    );
    const payload = buildAskContextPayload({
      response,
      selectedText: "Tarihsel Takip",
      userQuestion: "ingilizcesi ne",
      capsule,
    });

    expect(resolveFocusedAskIntent({
      selectedText: "Tarihsel Takip",
      currentQuestion: "ingilizcesi ne",
    })).toBe("translation");
    expect(payload.focusedIntent).toBe("translation");
    expect(payload.context[0]).toContain("Translate only the selected fragment");
    expect(payload.context[0]).toContain("answer with the English translation first");
    expect(payload.context[0]).not.toContain("Event Sourcing terms");
  });

  test("uses selected Response text as primary Quick Question fragment context", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    const response = page.locator('[data-response-id="r-plugin-boundary"]');
    await expect(response).toBeVisible();

    await selectResponseText(page, "r-plugin-boundary", "MCP-backed tool");

    const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
    await expect(selectionToolbar).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "Quick Question" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

    const popup = page.getByRole("dialog");
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId("ask-context")).toHaveCount(0);
    await expect(popup.getByTestId("ask-selected-fragment")).toContainText("MCP-backed tool");

    await popup.getByLabel("Ask question").fill("What does this mean?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toContainText("What does this mean?");

    await expect(popup.getByTestId("ask-answer")).toContainText(
      "selected fragment MCP-backed tool"
    );
    await expect(popup.getByTestId("ask-answer")).toContainText(
      "Full source text was not sent"
    );

    await popup.getByLabel("Ask question").fill("Follow up from that fragment.");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "selected fragment MCP-backed tool"
    );
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "includes previous quick turns"
    );
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "not forced into a single line"
    );
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Context Capsule");
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Response Capsule");
  });

  test("answers the current selected-fragment acronym question before source context", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.locator('[data-response-id="r-plugin-boundary"]')).toBeVisible();

    await selectResponseText(page, "r-plugin-boundary", "MCP");

    const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
    await expect(selectionToolbar).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "Quick Question" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

    const popup = page.getByRole("dialog");
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId("ask-context")).toHaveCount(0);
    await expect(popup.getByTestId("ask-selected-fragment")).toContainText("MCP");

    await popup.getByLabel("Ask question").fill("açılımı");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toContainText("açılımı");

    await expect(popup.getByTestId("ask-answer")).toContainText(
      "MCP = Model Context Protocol"
    );
    await expect(popup.getByTestId("ask-answer")).toContainText(
      "plugin entegrasyonu"
    );
    await expect(popup.getByTestId("ask-answer")).not.toContainText(
      "Microsoft Component Platform"
    );
    await expect(popup.getByTestId("ask-answer")).not.toContainText(
      "stays anchored to"
    );

    await popup.getByLabel("Ask question").fill("kaynakla ilişkisi ne?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "selected fragment MCP"
    );
    await expect(popup.getByTestId("ask-answer-list")).toContainText(
      "includes previous quick turns"
    );
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Context Capsule");
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Response Capsule");
    await expect(popup.getByTestId("ask-answer-list")).not.toContainText("Cep Kapsülü");
  });

  test("answers IPC acronym expansion directly from selected fragment", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.locator('[data-response-id="r-host-shell"]')).toBeVisible();

    await selectResponseText(page, "r-host-shell", "IPC");

    const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
    await expect(selectionToolbar).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "Quick Question" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

    const popup = page.getByRole("dialog");
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId("ask-context")).toHaveCount(0);
    await expect(popup.getByTestId("ask-selected-fragment")).toContainText("IPC");

    await popup.getByLabel("Ask question").fill("açılımı ne");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toContainText("açılımı ne");

    await expect(popup.getByTestId("ask-answer")).toContainText(
      "IPC = Inter-Process Communication"
    );
    await expect(popup.getByTestId("ask-answer")).toContainText(
      "current question about the selected fragment"
    );
    await expect(popup.getByTestId("ask-answer")).not.toContainText(
      "adapterin açıklaması nedir?"
    );
    await expect(popup.getByTestId("ask-answer")).not.toContainText(
      "Host shell adapters"
    );
  });

  test("opens existing Ask popup with full Response context and focused input", async ({
    page,
  }) => {
    await openMcpGraph(page);
    const popup = await clickFocusedGraphAsk(page);

    await expect(popup.getByTestId("ask-context")).toHaveCount(0);
    await expect(popup.getByTestId("ask-selected-fragment")).toHaveCount(0);
    await expect(popup.getByLabel("Ask question")).toBeFocused();
  });

  test("opens as a centered modal that blocks Graph controls", async ({ page }) => {
    await openMcpGraph(page);
    const popup = await clickFocusedGraphAsk(page);
    const popupBox = await popup.boundingBox();
    const viewport = page.viewportSize();

    expect(popupBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(Math.abs(popupBox!.x + popupBox!.width / 2 - viewport!.width / 2)).toBeLessThan(12);
    expect(Math.abs(popupBox!.y + popupBox!.height / 2 - viewport!.height / 2)).toBeLessThan(12);

    const controlsBox = await page.locator(".loom-graph-controls").boundingBox();
    expect(controlsBox).not.toBeNull();
    const hitTarget = await page.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return {
          isBackdrop: Boolean(element?.closest(".ask-modal-backdrop")),
          className: element instanceof HTMLElement ? element.className : "",
        };
      },
      {
        x: controlsBox!.x + controlsBox!.width / 2,
        y: controlsBox!.y + controlsBox!.height / 2,
      }
    );
    expect(hitTarget.isBackdrop).toBe(true);
  });

  test("keeps full Response context hidden from the Ask popup surface", async ({ page }) => {
    await openMcpGraph(page);
    const popup = await clickFocusedGraphAsk(page);

    await expect(popup.getByTestId("ask-context")).toHaveCount(0);
    await expect(popup.getByTestId("ask-selected-fragment")).toHaveCount(0);
    await expect(popup).not.toContainText("type PluginContribution");

    const popupBox = await popup.boundingBox();
    expect(popupBox).not.toBeNull();
    expect(popupBox!.y).toBeGreaterThanOrEqual(0);
    expect(popupBox!.y + popupBox!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height
    );
  });

  test("supports repeated quick answers without Bookmark action", async ({ page }) => {
    await openMcpGraph(page);
    const popup = await clickFocusedGraphAsk(page);

    await popup.getByLabel("Ask question").fill("What is the plugin boundary?");
    await popup.getByLabel("Ask question").press("Enter");

    await expect(popup.getByTestId("ask-answer")).toHaveCount(1);
    await expect(popup.getByTestId("ask-answer")).toContainText("Demo quick answer");
    await expect(popup.getByLabel("Ask question")).toBeEnabled();
    await expect(popup.getByLabel("Ask question")).toHaveValue("");
    await expect(popup.getByRole("button", { name: "Bookmark" })).toHaveCount(0);

    await popup.getByLabel("Ask question").fill("What about MCP tools?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();

    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
    await expect(popup.getByTestId("ask-answer-list")).toBeVisible();
    await expect(popup.getByRole("button", { name: "Convert to Weft" })).toBeEnabled();
  });

  test("Response-created Weft visible transcript starts at the origin Q/A pair", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    const originResponse = page.locator('[data-response-id="r-plugin-boundary"]');
    await expect(originResponse).toBeVisible();

    await originResponse
      .getByRole("button", { name: /Start Weft from Plugin boundary should not leak shell assumptions/ })
      .click();

    const weftPanel = page.locator(".weft-split-panel").last();
    await expect(weftPanel).toBeVisible();
    await expect(weftPanel).toContainText("Where should plugin behavior attach?");
    await expect(weftPanel).toContainText("Plugins should attach to Loom objects");
    await expect(weftPanel).not.toContainText("How should the web prototype stay Electron-ready?");
    await expect(weftPanel).not.toContainText("Keep the renderer written as if it is running in a browser");
    await expect(weftPanel).not.toContainText("WeftOriginContextSnapshot");
    await expect(weftPanel).not.toContainText("Hidden context");
    await expect(weftPanel).not.toContainText("Context Capsule");
  });

  test("discards the temporary Ask session when the popup closes", async ({ page }) => {
    await openMcpGraph(page);
    let popup = await clickFocusedGraphAsk(page);

    await popup.getByLabel("Ask question").fill("What is the plugin boundary?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(1);
    await popup.getByRole("button", { name: "Close Ask" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    popup = await clickFocusedGraphAsk(page);
    await expect(popup.getByTestId("ask-answer")).toHaveCount(0);
    await expect(popup.getByLabel("Ask question")).toHaveValue("");
  });

  test("converts Ask result to a visible Weft and reuses it on repeat conversion", async ({
    page,
  }) => {
    await openMcpGraph(page);
    await page.getByRole("button", { name: "Continue Loom", exact: true }).click();
    await expect(page.getByTestId("graph-continuation-composer")).toBeVisible();

    let popup = await clickFocusedGraphAsk(page);
    await popup.getByLabel("Ask question").fill("Turn this into a Weft.");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toContainText("Demo quick answer");
    await popup.getByLabel("Ask question").fill("Add a second Ask turn.");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);
    await popup.getByRole("button", { name: "Convert to Weft" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("graph-continuation-composer")).toHaveCount(0);
    const convertedWeft = page.locator(".loom-graph-node--weft").filter({
      hasText: "Loom: Plugin boundary should not leak shell assumptions",
    });
    await expect(convertedWeft).toBeVisible();
    await expect(convertedWeft).toHaveClass(/is-focused/);
    await expect(page.locator(".loom-graph-node--response").filter({
      hasText: "Turn this into a Weft.",
    })).toBeVisible();
    await expect(page.locator(".loom-graph-node--response").filter({
      hasText: "Add a second Ask turn.",
    })).toBeVisible();
    await expect(page.locator(".loom-graph-edge-label").filter({
      hasText: "Weft from here",
    })).toHaveCount(2);
    const weftCount = await page.locator(".loom-graph-node--weft").count();

    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();
    popup = await clickFocusedGraphAsk(page);
    await popup.getByLabel("Ask question").fill("Try converting again.");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toContainText("Demo quick answer");
    await popup.getByRole("button", { name: "Convert to Weft" }).click();

    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();
    await expect(page.locator(".loom-graph-node--weft")).toHaveCount(weftCount);
  });

  test("Quick Ask Convert Weft visible transcript starts with Ask turns only", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Open MCP and plugin integration notes/ }).click();
    await expect(page.locator('[data-response-id="r-plugin-boundary"]')).toBeVisible();

    await selectResponseText(page, "r-plugin-boundary", "MCP-backed tool");
    const selectionToolbar = page.getByRole("toolbar", { name: "Selection actions" });
    await expect(selectionToolbar).toBeVisible();
    await selectionToolbar.getByRole("button", { name: "Quick Question" }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

    const popup = page.getByRole("dialog");
    await popup.getByLabel("Ask question").fill("What does this selected tool boundary mean?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toContainText("Demo quick answer");
    await popup.getByLabel("Ask question").fill("How should I use that distinction?");
    await popup.getByRole("button", { name: /^Ask$/ }).click();
    await expect(popup.getByTestId("ask-answer")).toHaveCount(2);

    const answerText = await popup.getByTestId("ask-answer").last().innerText();
    expect(answerText.split(/[.!?]\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(2);

    await popup.getByRole("button", { name: "Convert to Weft" }).click();

    const weftPanel = page.locator(".weft-split-panel").last();
    await expect(weftPanel).toBeVisible();
    await expect(weftPanel).toContainText("What does this selected tool boundary mean?");
    await expect(weftPanel).toContainText("How should I use that distinction?");
    await expect(weftPanel).toContainText("Demo quick answer");
    await expect(weftPanel).not.toContainText("Where should plugin behavior attach?");
    await expect(weftPanel).not.toContainText("Plugins should attach to Loom objects");
    await expect(weftPanel).not.toContainText("WeftOriginContextSnapshot");
    await expect(weftPanel).not.toContainText("Hidden context");
    await expect(weftPanel).not.toContainText("Response Capsule");
  });
});
