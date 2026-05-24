import { test, expect } from "@playwright/test";
import {
  codeSnippetSemanticTitle,
  isMarkdownTableCodeSnippet,
  isReusableCodeSnippet,
} from "../src/services/codeSnippetDisplay";

test.describe("[pure-ui-helper] code snippet display", () => {
  test("derives semantic titles from heading-like text code blocks", () => {
    expect(
      codeSnippetSemanticTitle({
        language: "text",
        code: "### 10. Kod Review Performans\n\n| Metrik | Hedef |\n| --- | --- |\n",
      })
    ).toBe("Kod Review Performans");
  });

  test("derives semantic titles from actual code identifiers", () => {
    expect(
      codeSnippetSemanticTitle({
        language: "ts",
        code: "export function buildContextWindow(input: ContextInput) {\n  return input;\n}\n",
      })
    ).toBe("function buildContextWindow");
    expect(
      codeSnippetSemanticTitle({
        language: "json",
        code: '"retrievalPolicy": {\n  "mode": "explicit"\n}\n',
      })
    ).toBe("{ retrievalPolicy }");
  });

  test("filters markdown tables out of Code Snippet source rows", () => {
    expect(
      isMarkdownTableCodeSnippet({
        language: "text",
        code: "| Metrik | Hedef |\n| --- | --- |\n| Latency | 10ms |\n",
      })
    ).toBe(true);
    expect(
      isMarkdownTableCodeSnippet({
        language: "ts",
        code: "const mask = left | right;\n",
      })
    ).toBe(false);
  });

  test("filters illustrative artifact metadata and diagrams out of reusable snippets", () => {
    expect(
      isReusableCodeSnippet({
        language: "text",
        code: "Assistant: Kod review artifact'ı oluşturulur\n- Hash: abc123def456\n- Type: Security Analysis\n- Provenance: [timestamp, user, tool]\n",
      })
    ).toBe(false);
    expect(
      isReusableCodeSnippet({
        language: "text",
        code: "┌──────────────┐\n│ Artifact Box │\n└──────────────┘\n",
      })
    ).toBe(false);
  });

  test("keeps executable code reusable", () => {
    expect(
      isReusableCodeSnippet({
        language: "rust",
        code: "fn replay_events() {\n    apply();\n}\n",
      })
    ).toBe(true);
  });
});
