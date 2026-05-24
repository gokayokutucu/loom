// E2E data authority classification: PURE_UI_HELPER.
// This spec validates deterministic display-title derivation only. It does not
// mutate persisted prompts, retrieval source text, or service data.
import { expect, test } from "@playwright/test";
import { polishDisplayTitle } from "../src/services/displayTitlePolish";
import { buildAddressBarSuggestions } from "../src/services/omnibox";
import {
  buildLoomGraphProjection,
  loomGraphRootNodeId,
  responseGraphNodeId,
} from "../src/services/loomGraphProjection";
import type { Conversation, ResponseItem } from "../src/types";

function loom(id: string, title: string): Conversation {
  return {
    id,
    title,
    path: `loom://test/${id}`,
    folder: "Test",
    summary: `${title} summary`,
  };
}

function response(id: string, question: string): ResponseItem {
  return {
    id,
    title: question,
    address: `loom://test/${id}`,
    question,
    answer: [`Answer for ${question}`],
    suggestedLinks: [],
    bookmarkedLinks: [],
  };
}

test.describe("[pure-ui-helper] display title polish", () => {
  test("polishes obvious title typos without changing raw user messages", () => {
    const rawPrompt = "Yerel Eklentiler ned,r";
    const root = loom("root", rawPrompt);
    const firstResponse = response("r1", rawPrompt);
    const projection = buildLoomGraphProjection({
      conversations: [root],
      responsesByConversation: {
        root: [firstResponse],
      },
      forkRecords: [],
      activeLoomId: "root",
      expandedNodeIds: new Set(),
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const rootNode = projection.nodes.find((node) => node.id === loomGraphRootNodeId("root"));
    const responseNode = projection.nodes.find((node) =>
      node.id === responseGraphNodeId("root", "r1")
    );

    expect(firstResponse.question).toBe(rawPrompt);
    expect(firstResponse.title).toBe(rawPrompt);
    expect(root.title).toBe(rawPrompt);
    expect(rootNode?.title).toBe("Yerel Eklentiler nedir");
    expect(responseNode?.title).toBe("Yerel Eklentiler nedir");
  });

  test("keeps technical identifiers, model names, file names, and URLs stable", () => {
    expect(polishDisplayTitle("Qwen 3.5 9B, GPT-4o-mini")).toBe(
      "Qwen 3.5 9B, GPT-4o-mini"
    );
    expect(polishDisplayTitle("docs/parser-config.json")).toBe("docs/parser-config.json");
    expect(polishDisplayTitle("Open https://example.com/a,b")).toBe(
      "Open https://example.com/a,b"
    );
  });

  test("handles mixed-language shorthand conservatively", () => {
    expect(polishDisplayTitle("Local plugin ned,r")).toBe("Local plugin nedir");
    expect(polishDisplayTitle("Local plugin nedir??")).toBe("Local plugin nedir?");
  });

  test("address bar suggestions use polished display labels", () => {
    const suggestions = buildAddressBarSuggestions({
      query: "yerel eklentiler",
      conversations: [loom("local-plugins", "Yerel Eklentiler ned,r")],
    });

    expect(suggestions[0]).toMatchObject({
      title: "Yerel Eklentiler nedir",
      path: "loom://test/local-plugins",
    });
  });
});
