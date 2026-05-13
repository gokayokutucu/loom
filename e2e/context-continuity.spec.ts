// E2E data authority classification: PRODUCT_SERVICE_BACKED.
// This spec is the product-mode proof path: temp SQLite DB, loom-service, RustHttpLoomEngineClient, cleanup.
import { expect, test } from "@playwright/test";
import {
  assistantMarkdownToSafeHtml,
  buildAssistantCopyPayload,
  buildAssistantDefaultCopyPayload,
  parseAssistantMarkdown,
} from "../src/services/assistantMarkdown";
import { createServiceBackedConversationScenario } from "./helpers/serviceBackedScenario";

test.describe("[product-service-backed] Event Sourcing context continuity proof", () => {
  test("[product-service-backed] creates realistic conversation data through loom-service and proves derived artifacts", async () => {
    test.setTimeout(120_000);
    const scenario = await createServiceBackedConversationScenario();
    let cleanupResult:
      | Awaited<ReturnType<typeof scenario.cleanup>>
      | undefined;
    const loomId = `loom-event-sourcing-${Date.now()}`;
    try {
      await scenario.client.createLoom({
        loomId,
        title: "Event Sourcing proof",
        summary: "Service-backed E2E proof data",
        canonicalUri: `loom://service/${loomId}`,
        code: "event-sourcing-proof",
        metadata: { source: "e2e_service_backed_flow" },
      });

      const first = await scenario.sendPrompt(
        loomId,
        "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat"
      );
      const second = await scenario.sendPrompt(
        loomId,
        "Avantajları ve dezavantajları tablo şeklinde verebilir misin?"
      );
      const third = await scenario.sendPrompt(
        loomId,
        "Dezavantajları ve avantajları biraz daha açar mısın"
      );
      const retrieval = await scenario.sendPrompt(loomId, "CQRS ilişkisi nedir?");

      await scenario.runPendingContextJobs();

      expect(first.answer).toContain("Event Store");
      expect(first.answer).toContain("Replay");
      expect(first.answer).toContain("CQRS");
      expect(first.answer).toContain("```ts");

      expect(second.answer).toContain("Event Sourcing");
      expect(second.answer).toContain("| Avantaj | Dezavantaj |");
      expect(second.answer).not.toContain("LoomDB");
      expect(second.answer.toLowerCase()).not.toContain("bağlam bulunamadı");
      expect(second.answer.toLowerCase()).not.toContain("context not found");
      expect(parseAssistantMarkdown(second.answer).some((block) => block.kind === "table")).toBe(
        true
      );
      expect(assistantMarkdownToSafeHtml(second.answer)).toContain("<table>");

      const defaultCopy = buildAssistantDefaultCopyPayload(second.answer);
      expect(defaultCopy.plainText).toContain("Avantaj\tDezavantaj");
      expect(defaultCopy.plainText).not.toContain("| :--- |");
      expect(buildAssistantCopyPayload(second.answer).markdown).toContain("| Avantaj | Dezavantaj |");

      expect(third.answer).toContain("Event Sourcing");
      expect(third.answer).toContain("Replay");
      expect(third.answer).toContain("CQRS");
      expect(third.answer).not.toContain("LoomDB");

      expect(retrieval.answer).toContain("CQRS");
      expect(retrieval.answer).toContain("Event Sourcing");
      expect(retrieval.answer).not.toContain("LoomDB");

      const detail = await scenario.client.getLoom(loomId);
      expect(detail.responses).toHaveLength(8);
      expect(detail.responses.map((response) => response.id)).toEqual(
        expect.arrayContaining([
          first.userResponseId,
          first.assistantResponseId,
          second.userResponseId,
          second.assistantResponseId,
          third.userResponseId,
          third.assistantResponseId,
          retrieval.userResponseId,
          retrieval.assistantResponseId,
        ])
      );

      const resolved = await scenario.client.resolveAddress({
        address: `loom://service/${loomId}`,
      });
      expect(resolved.status).toBe("resolved");
      expect(resolved.destination?.loomId).toBe(loomId);

      const graph = await scenario.client.getGraphProjection({
        conversations: [],
        responsesByConversation: {},
        forkRecords: [],
        activeLoomId: loomId,
      });
      expect(graph.nodes.some((node) => node.kind === "response")).toBe(true);
      expect(graph.edges.some((edge) => edge.kind === "question")).toBe(true);

      const exportResult = await scenario.client.exportLoom({
        loomId,
        format: "markdown",
        includeMetadata: true,
        includeGraph: true,
      });
      const exportedMarkdown = Buffer.from(exportResult.contentBase64, "base64").toString("utf8");
      expect(exportedMarkdown).toContain("Event Sourcing");
      expect(exportedMarkdown).toContain("CQRS");
      expect(exportedMarkdown).toContain("| Avantaj | Dezavantaj |");

      const proof = await scenario.getProof(loomId);
      expect(proof.responseCount).toBe(8);
      expect(proof.tablePartCount).toBeGreaterThan(0);
      expect(proof.partKinds).toEqual(expect.arrayContaining(["heading", "table", "code_block"]));
      expect(proof.codeBlocks).toHaveLength(1);
      expect(proof.codeBlocks[0].language).toBe("ts");
      expect(proof.codeBlocks[0].code).toBe(
        "const stream = eventStore.load(aggregateId);\nconst state = replay(stream);\n"
      );
      expect(proof.tags).toEqual(
        expect.arrayContaining(["event sourcing", "event store", "cqrs", "replay"])
      );
      expect(proof.topics).toContain("event sourcing");
      expect(proof.graphLinkKinds).toEqual(
        expect.arrayContaining(["answers", "follows", "same_topic", "code_for"])
      );
      expect(proof.rawThinkingPresent).toBe(false);

      for (const value of [
        first.answer,
        second.answer,
        third.answer,
        retrieval.answer,
        defaultCopy.plainText,
        defaultCopy.html,
        exportedMarkdown,
        JSON.stringify(proof),
      ]) {
        expect(value).not.toContain("raw_thinking");
        expect(value).not.toContain("thinking_text");
        expect(value).not.toContain("chain_of_thought");
        expect(value).not.toContain("hidden_reasoning");
      }

      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      cleanupResult = await scenario.cleanup();
      expect(cleanupResult.tempDirRemoved).toBe(true);
      expect(cleanupResult.warnings).toEqual([]);
    }
  });
});
