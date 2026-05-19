// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product/service flow.
import { expect, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

test.describe("[product-service-backed] Weft context continuity", () => {
  test("[product-service-backed] seedMode none keeps transcript clean while hidden origin context informs first Weft prompt", async () => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
    });

    try {
      await scenario.client.createLoom({
        loomId: "blue-otter-origin",
        title: "Blue Otter Event Sourcing",
        summary: "Origin Loom for Weft continuity proof",
        canonicalUri: "loom://tests/blue-otter-origin",
      });
      const origin = await scenario.sendPrompt(
        "blue-otter-origin",
        "The project codename is Blue Otter. Explain Event Sourcing with this codename."
      );
      expect(origin.answer).toContain("Blue Otter");
      expect(origin.answer).toContain("Event Sourcing");
      expect(origin.assistantResponseId).toBeTruthy();

      const weft = await scenario.client.createOrOpenWeft({
        originLoomId: "blue-otter-origin",
        originResponseId: origin.assistantResponseId!,
        initialPrompt:
          "What is the project codename and how does it relate to the previous explanation?",
        summary: "Branched from Blue Otter origin",
        reuseExisting: false,
        source: "response_action",
        seedMode: "none",
        createOriginContextSnapshot: true,
        metadata: {
          source: "temporary_workspace_promotion",
          sourceLoomId: "blue-otter-origin",
          sourceResponseId: origin.assistantResponseId!,
        },
      });

      expect(weft.originContextSnapshotId).toBeTruthy();
      expect(weft.visibleSeedResponses).toHaveLength(0);
      const cleanWeft = await scenario.client.getLoom(weft.loomId);
      expect(cleanWeft.responses).toHaveLength(0);

      const weftAnswer = await scenario.sendPrompt(
        weft.loomId,
        "What is the project codename and how does it relate to the previous explanation?"
      );
      expect(weftAnswer.answer).toContain("Blue Otter");
      expect(weftAnswer.answer).toContain("Event Sourcing");

      const hydratedWeft = await scenario.client.getLoom(weft.loomId);
      expect(hydratedWeft.responses).toHaveLength(1);
      expect(hydratedWeft.responses[0].question).toContain("project codename");
      expect(hydratedWeft.responses.map((response) => response.question).join("\n")).not.toContain(
        "Explain Event Sourcing with this codename"
      );

      const proofText = JSON.stringify(await scenario.getProof(weft.loomId));
      expect(proofText).not.toContain("raw_thinking");
      expect(proofText).not.toContain("thinking_text");
      expect(proofText).not.toContain("chain_of_thought");
      expect(proofText).not.toContain("hidden_reasoning");
      expect(scenario.dbPath).toContain(scenario.tempDir);
      expect(scenario.configPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});
