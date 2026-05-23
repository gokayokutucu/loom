// E2E data authority classification: PRODUCT_SERVICE_BACKED.
// Uses temp SQLite DB, fresh loom-service, product/service flow data, and cleanup.
import { expect, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

test.describe("[product-service-backed] Memory profile usage", () => {
  test("generation context uses explicit local profile and saved Memory settings", async () => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
    });
    let cleanup: Awaited<ReturnType<typeof scenario.cleanup>> | undefined;
    const loomId = `loom-memory-profile-${Date.now()}`;

    try {
      await scenario.fetchJson("/config", {
        method: "PATCH",
        body: JSON.stringify({
          memory: {
            enabled: true,
            referenceRecentLooms: true,
            referenceSavedMemories: true,
            occupation: "Software architect / .NET engineer",
            stylePreferences: "Turkish answers, English technical terms",
            moreAboutYou: "Interests: local-first AI runtime, Loom, architecture",
          },
        }),
      });
      await scenario.fetchJson("/memory", {
        method: "POST",
        body: JSON.stringify({
          memoryType: "explicit_user_memory",
          content: "The user cares about local-first AI runtime architecture and Loom.",
          userConfirmed: true,
          metadata: { source: "e2e_memory_profile_usage" },
        }),
      });
      await scenario.client.createLoom({
        loomId,
        title: "Memory profile proof",
        summary: "Service-backed memory profile proof",
        canonicalUri: `loom://service/${loomId}`,
        code: "memory-profile-proof",
        metadata: { source: "e2e_memory_profile_usage" },
      });

      const answer = await scenario.sendPrompt(
        loomId,
        "Benim teknik geçmişime göre bunu nasıl değerlendirmeliyim?"
      );

      expect(answer.answer).toContain("Software architect / .NET engineer");
      expect(answer.answer).toContain("local-first AI runtime");
      expect(answer.answer).toContain("Loom");
      expect(answer.answer).toContain("privacy");
      expect(JSON.stringify(answer.events)).not.toContain("raw_thinking");

      const proof = await scenario.getProof(loomId);
      expect(proof.rawThinkingPresent).toBe(false);
    } finally {
      cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });
});
