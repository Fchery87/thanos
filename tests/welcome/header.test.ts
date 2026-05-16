import { describe, expect, it } from "vitest";
import { noopTheme, stripAnsi } from "../../src/ui-utils";
import { renderWelcomeHeader } from "../../src/welcome/header";

describe("renderWelcomeHeader", () => {
  it("surfaces the core session state and the commands users need first", () => {
    const header = renderWelcomeHeader(noopTheme, {
      modelStr: "gpt-5-codex",
      thinkingStr: "high",
      modeStr: "designer",
      mcp: { configured: 2, connected: 2, failed: 0, initFailed: false },
      policy: { kind: "loaded", preset: "team", rules: 7, auditEnabled: true },
      recentRows: [
        { label: "Refactor governed interaction primitives", age: "2h ago" },
      ],
    });

    const output = header.render(120).join("\n");

    expect(output).toContain("Agent Distribution");
    expect(output).toContain("model");
    expect(output).toContain("gpt-5-codex");
    expect(output).toContain("policy");
    expect(output).toContain("team · 7 rules · audit on");
    expect(output).toContain("mcp");
    expect(output).toContain("2 connected");
    expect(output).toContain("/status");
    expect(output).toContain("/policy");
    expect(output).toContain("/tools");
    expect(output).toContain("/mcp");
    expect(output).not.toContain("/mcp list");
    expect(output).toContain("/skills");
    expect(output).toContain("Ctrl+Shift+T thinking");
    expect(output).not.toContain("^T thinking");
    expect(output).toContain("Refactor governed interaction primitives");
    expect(output).not.toContain("No LSP servers");
  });

  it("keeps compact layouts within the terminal width", () => {
    const header = renderWelcomeHeader(noopTheme, {
      modelStr: "a-model-name-that-is-long-enough-to-need-truncation",
      thinkingStr: "medium",
      modeStr: "explore (default)",
      mcp: { configured: 0, connected: 0, failed: 0, initFailed: false },
      policy: { kind: "error" },
      recentRows: [
        { label: "A very long session title that should not push the welcome screen past the viewport", age: "just now" },
      ],
    });

    const lines = header.render(40);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(40);
    }
    expect(lines.join("\n")).toContain("policy error");
    expect(lines.join("\n")).toContain("No MCP servers");
  });

  it("distinguishes missing MCP config from failed MCP startup", () => {
    const failed = renderWelcomeHeader(noopTheme, {
      modelStr: "model",
      thinkingStr: "off",
      modeStr: "explore (default)",
      mcp: { configured: 3, connected: 0, failed: 3, initFailed: true },
      policy: { kind: "loaded", preset: "team", rules: 1, auditEnabled: false },
      recentRows: [],
    }).render(80).join("\n");

    expect(failed).toContain("MCP init error");
    expect(failed).toContain("0/3 connected · 3 failed");
    expect(failed).not.toContain("No MCP servers");
  });
});
