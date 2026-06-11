import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentRunInspector } from "./AgentRunInspector";

describe("AgentRunInspector", () => {
  it("renders nothing when the experimental gate is disabled", () => {
    expect(renderToStaticMarkup(<AgentRunInspector enabled={false} />)).toBe("");
  });

  it("renders an explicitly experimental inspector when enabled", () => {
    const markup = renderToStaticMarkup(<AgentRunInspector enabled />);
    expect(markup).toContain("Agent Run Inspector");
    expect(markup).toContain("Experimental");
    expect(markup).toContain('data-testid="agent-run-inspector"');
  });
});
