// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service Bookmark proof.
// - LEGACY_TYPESCRIPT_LOCAL for seeded graph Bookmark UI rendering tests below.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

interface BookmarkDto {
  bookmarkId: string;
  targetKind: string;
  targetId?: string;
  targetUri?: string;
  title: string;
  createdAt: string;
  metadata?: unknown;
}

interface BookmarkEnvelope {
  bookmark: BookmarkDto;
  reused?: boolean;
}

interface BookmarkListResponse {
  bookmarks: BookmarkDto[];
}

interface ServiceGraphProjection {
  nodes: Array<{ id: string; kind: string; responseId?: string; metadata?: unknown }>;
}

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

function expectNoForbiddenPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("raw_thinking");
  expect(serialized).not.toContain("thinking_text");
  expect(serialized).not.toContain("chain_of_thought");
  expect(serialized).not.toContain("hidden_reasoning");
}

async function openGraphMapGraph(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "loom-ai-app-settings-v1",
      JSON.stringify({ mockDataEnabled: true })
    );
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
  await page.getByTestId("sidebar-loom-c-graph-map").click();
  if ((await page.locator(".loom-graph-shell").count()) === 0) {
    await page.getByRole("button", { name: "Toggle Graph View" }).click();
  }
  await expect(page.locator("h1", { hasText: "Weft-aware Loom graph" })).toBeVisible();
  await expect(page.locator(".loom-graph-shell")).toBeVisible();
}

test.describe("[product-service-backed][legacy-typescript-local] Graph bookmark action", () => {
  test("[product-service-backed] creates, reuses, deletes, graphs, and exports Bookmarks through loom-service", async ({
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

      await sendMainPrompt(
        page,
        "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat"
      );
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;
      const loomDetail = await scenario.client.getLoom(loomId);
      const assistantResponse = loomDetail.responses[0];
      expect(assistantResponse).toBeTruthy();

      const bookmarkButton = page.locator(".response-bookmark-chip").last();
      await expect(bookmarkButton).toBeVisible();
      await expect(bookmarkButton).toHaveAttribute("aria-pressed", "false");
      await bookmarkButton.click();
      await expect(page.getByText(/Bookmark saved/).last()).toBeVisible();
      await expect(bookmarkButton).toHaveAttribute("aria-pressed", "true");
      await expect(bookmarkButton).toHaveClass(/bookmarked/);

      const listed = await scenario.fetchJson<BookmarkListResponse>("/bookmarks");
      expect(listed.bookmarks).toHaveLength(1);
      const bookmark = listed.bookmarks[0];
      expect(bookmark.targetKind).toBe("response");
      expect(bookmark.targetId).toBeTruthy();
      expect(bookmark.targetUri).toContain("loom://");
      expect(bookmark.targetUri).toContain("/r/");
      expect(bookmark.title).toContain("Event Sourcing");

      const duplicate = await scenario.fetchJson<BookmarkEnvelope>("/bookmarks", {
        method: "POST",
        body: JSON.stringify({
          targetKind: bookmark.targetKind,
          targetId: bookmark.targetId,
          targetUri: bookmark.targetUri,
          title: bookmark.title,
          metadata: bookmark.metadata ?? {},
        }),
      });
      expect(duplicate.reused).toBe(true);
      expect(duplicate.bookmark.bookmarkId).toBe(bookmark.bookmarkId);
      const afterDuplicate = await scenario.fetchJson<BookmarkListResponse>("/bookmarks");
      expect(afterDuplicate.bookmarks).toHaveLength(1);

      const byTarget = await scenario.fetchJson<BookmarkEnvelope>(
        `/bookmarks/target?targetKind=${encodeURIComponent(bookmark.targetKind)}&targetId=${encodeURIComponent(bookmark.targetId ?? "")}`
      );
      expect(byTarget.bookmark.bookmarkId).toBe(bookmark.bookmarkId);

      await scenario.client.deleteBookmark({ bookmarkId: bookmark.bookmarkId });
      const afterDelete = await scenario.fetchJson<BookmarkListResponse>("/bookmarks");
      expect(afterDelete.bookmarks).toHaveLength(0);
      const deletedTarget = await fetch(
        `${scenario.serviceUrl}/bookmarks/target?targetKind=${encodeURIComponent(bookmark.targetKind)}&targetId=${encodeURIComponent(bookmark.targetId ?? "")}`
      );
      expect(deletedTarget.status).toBe(404);

      const graphBookmark = await scenario.client.createBookmark({
        targetKind: "response",
        targetId: assistantResponse!.id,
        targetUri: assistantResponse!.meta?.canonicalUri ?? assistantResponse!.address,
        title: "Bookmarked service Event Sourcing answer",
        metadata: { loomId },
      });
      expect(graphBookmark.bookmark.id).toMatch(/^bookmark-/);

      const graph = await scenario.fetchJson<ServiceGraphProjection>(
        `/looms/${encodeURIComponent(loomId)}/graph?includeBookmarks=true`
      );
      const bookmarkedNode = graph.nodes.find((node) =>
        JSON.stringify(node.metadata ?? {}).includes(graphBookmark.bookmark.id)
      );
      expect(bookmarkedNode).toBeTruthy();
      expect(JSON.stringify(bookmarkedNode?.metadata)).toContain("\"bookmarked\":true");

      const exported = await scenario.client.exportLoom({
        loomId,
        format: "json",
        includeMetadata: true,
        includeBookmarks: true,
        includeGraph: true,
      });
      const exportedJson = JSON.parse(
        Buffer.from(exported.contentBase64, "base64").toString("utf8")
      ) as { bookmarks?: BookmarkDto[]; graph?: ServiceGraphProjection };
      expect(exportedJson.bookmarks?.map((item) => item.bookmarkId)).toContain(
        graphBookmark.bookmark.id
      );
      expect(JSON.stringify(exportedJson.graph)).toContain(graphBookmark.bookmark.id);

      await scenario.client.deleteBookmark({ bookmarkId: graphBookmark.bookmark.id });
      const afterGraphBookmarkDelete = await scenario.fetchJson<BookmarkListResponse>("/bookmarks");
      expect(afterGraphBookmarkDelete.bookmarks).toHaveLength(0);

      expectNoForbiddenPayload(listed);
      expectNoForbiddenPayload(duplicate);
      expectNoForbiddenPayload(afterDuplicate);
      expectNoForbiddenPayload(byTarget);
      expectNoForbiddenPayload(graphBookmark);
      expectNoForbiddenPayload(graph);
      expectNoForbiddenPayload(exportedJson);
      expectNoForbiddenPayload(afterDelete);
      expectNoForbiddenPayload(afterGraphBookmarkDelete);
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] syncs Bookmark toggle color across Loom surface, graph node, and detail window", async ({
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

      await sendMainPrompt(
        page,
        "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat"
      );
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });

      const surfaceBookmarkButton = page.locator(".response-bookmark-chip").last();
      await expect(surfaceBookmarkButton).toBeVisible();
      await expect(surfaceBookmarkButton).toHaveAttribute("aria-pressed", "false");
      await surfaceBookmarkButton.click();
      await expect(surfaceBookmarkButton).toHaveAttribute("aria-pressed", "true");
      await expect(surfaceBookmarkButton).toHaveClass(/bookmarked/);

      await page.getByRole("button", { name: "Toggle Graph View" }).click();
      await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();

      const graphNode = page.locator(".loom-graph-node--response").filter({
        hasText: "Event Sourcing",
      }).first();
      await expect(graphNode).toBeVisible();

      const graphBookmarkButton = graphNode.locator(".loom-graph-node-bookmark");
      await expect(graphBookmarkButton).toHaveAttribute("aria-pressed", "true");
      await expect(graphBookmarkButton).toHaveClass(/is-bookmarked/);

      await graphNode.click();
      const preview = page.locator(".graph-response-preview-modal");
      await expect(preview).toBeVisible();
      const previewBookmarkButton = preview.locator(".graph-response-preview-bookmark");
      await expect(previewBookmarkButton).toHaveAttribute("aria-pressed", "true");
      await expect(previewBookmarkButton).toHaveClass(/is-bookmarked/);

      await previewBookmarkButton.click();
      await expect(previewBookmarkButton).toHaveAttribute("aria-pressed", "false");
      await expect(previewBookmarkButton).not.toHaveClass(/is-bookmarked/);

      await expect
        .poll(async () => {
          const result = await scenario.fetchJson<BookmarkListResponse>("/bookmarks");
          return result.bookmarks.length;
        })
        .toBe(0);
      const afterDelete = await scenario.fetchJson<BookmarkListResponse>("/bookmarks");
      expectNoForbiddenPayload(afterDelete);
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] hydrates the Bookmark panel from service Bookmarks and syncs target state", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const bookmarkListReads: string[] = [];

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(
        page,
        "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat"
      );
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();
      const loomDetail = await scenario.client.getLoom(rootLoom!.loomId);
      const assistantResponse = loomDetail.responses[0];
      expect(assistantResponse).toBeTruthy();

      const serviceBookmark = await scenario.client.createBookmark({
        targetKind: "response",
        targetId: assistantResponse!.id,
        targetUri: assistantResponse!.meta?.canonicalUri ?? assistantResponse!.address,
        title: "Hydrated Event Sourcing Bookmark",
        metadata: {
          loomId: rootLoom!.loomId,
          note: "service-created panel hydration proof",
        },
      });

      const duplicate = await scenario.client.createBookmark({
        targetKind: "response",
        targetId: assistantResponse!.id,
        targetUri: assistantResponse!.meta?.canonicalUri ?? assistantResponse!.address,
        title: "Hydrated Event Sourcing Bookmark",
        metadata: { loomId: rootLoom!.loomId },
      });
      expect(duplicate.reused).toBe(true);
      expect(duplicate.bookmark.id).toBe(serviceBookmark.bookmark.id);

      await page.route(/\/bookmarks(?:\?|$)/, async (route) => {
        const requestUrl = new URL(route.request().url());
        if (route.request().method() === "GET" && requestUrl.pathname === "/bookmarks") {
          bookmarkListReads.push(route.request().url());
        }
        await route.continue();
      });

      await page.getByRole("button", { name: "Bookmarks" }).click();
      const bookmarkRow = page.getByTestId(
        `utility-destination-row-${serviceBookmark.bookmark.id}`
      );
      await expect(bookmarkRow).toBeVisible();
      await expect(bookmarkRow).toContainText("Hydrated Event Sourcing Bookmark");
      await expect(bookmarkRow).not.toContainText("raw_thinking");
      await expect(page.getByText("Hydrated Event Sourcing Bookmark")).toHaveCount(1);
      expect(bookmarkListReads.length).toBeGreaterThan(0);

      const bookmarkButton = page.locator(".response-bookmark-chip").last();
      await expect(bookmarkButton).toHaveAttribute("aria-pressed", "true");
      await expect(bookmarkButton).toHaveClass(/bookmarked/);

      await page.getByRole("button", { name: "Toggle Graph View" }).click();
      await expect(page.getByRole("heading", { name: "Weft-aware Loom graph" })).toBeVisible();
      const graphNode = page.locator(".loom-graph-node--response").filter({
        hasText: "Event Sourcing",
      }).first();
      await expect(graphNode).toBeVisible();
      const graphBookmarkButton = graphNode.locator(".loom-graph-node-bookmark");
      await expect(graphBookmarkButton).toHaveAttribute("aria-pressed", "true");
      await expect(graphBookmarkButton).toHaveClass(/is-bookmarked/);

      await bookmarkRow.hover();
      await bookmarkRow.locator(".bookmark-rail-button.danger").click();
      await expect(bookmarkRow).toHaveCount(0);
      await expect(graphBookmarkButton).toHaveAttribute("aria-pressed", "false");
      await expect(graphBookmarkButton).not.toHaveClass(/is-bookmarked/);

      const afterDelete = await scenario.fetchJson<BookmarkListResponse>("/bookmarks");
      expect(afterDelete.bookmarks).toHaveLength(0);
      expectNoForbiddenPayload(serviceBookmark);
      expectNoForbiddenPayload(duplicate);
      expectNoForbiddenPayload(afterDelete);
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[legacy-typescript-local] uses the Bookmark button state instead of a bookmarked metadata chip", async ({
    page,
  }) => {
    await openGraphMapGraph(page);

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

  test("[legacy-typescript-local] shows filled Bookmark icons for bookmarked responses on the Loom surface", async ({
    page,
  }) => {
    await openGraphMapGraph(page);
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

  test("[legacy-typescript-local] marks existing Weft actions and focuses the Weft when opened", async ({ page }) => {
    await openGraphMapGraph(page);

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

  test("[legacy-typescript-local] adds graph Link actions to the active composer and shows a toast", async ({ page }) => {
    await openGraphMapGraph(page);
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
