import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { noopTheme, stripAnsi } from "../../src/ui-utils";
import { renderWelcomeHeader } from "../../src/welcome/header";

describe("renderWelcomeHeader", () => {
  it("surfaces the core session state and the commands users need first", () => {
    const header = renderWelcomeHeader(noopTheme, {
      modelStr: "gpt-5-codex",
      thinkingStr: "high",
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

  it("does not ship trailing whitespace in the two-column layout", () => {
    const lines = renderWelcomeHeader(noopTheme, {
      modelStr: "claude-opus-4-8",
      thinkingStr: "high",
      mcp: { configured: 6, connected: 5, failed: 1, initFailed: false },
      policy: { kind: "loaded", preset: "team", rules: 12, auditEnabled: true },
      recentRows: [{ label: "Fable-class harness roadmap", age: "2h ago" }],
    }).render(120);

    for (const line of lines) {
      expect(stripAnsi(line)).toBe(stripAnsi(line).replace(/[ \t]+$/, ""));
    }
  });

  it("pads the Shortcuts rows to match the other boxes' left edge", () => {
    const output = renderWelcomeHeader(noopTheme, {
      modelStr: "model",
      thinkingStr: "high",
      mcp: { configured: 0, connected: 0, failed: 0, initFailed: false },
      policy: { kind: "loaded", preset: "team", rules: 1, auditEnabled: false },
      recentRows: [],
    }).render(80).join("\n");
    // Content sits one space in from the border, exactly like " /models" rows.
    expect(output).toContain("│ Ctrl+Shift+T thinking");
    expect(output).not.toContain("│Ctrl+Shift+T");
  });

  it("distinguishes missing MCP config from failed MCP startup", () => {
    const failed = renderWelcomeHeader(noopTheme, {
      modelStr: "model",
      thinkingStr: "off",
      mcp: { configured: 3, connected: 0, failed: 3, initFailed: true },
      policy: { kind: "loaded", preset: "team", rules: 1, auditEnabled: false },
      recentRows: [],
    }).render(80).join("\n");

    expect(failed).toContain("MCP init error");
    expect(failed).toContain("0/3 connected · 3 failed");
    expect(failed).not.toContain("No MCP servers");
  });

  // MCP connects asynchronously, well after the header component is built —
  // pi calls the header factory exactly once, so without this the welcome
  // screen is frozen at the pre-init summary and always claims zero servers.
  it("re-renders from the latest summary after MCP finishes connecting", () => {
    const header = renderWelcomeHeader(noopTheme, {
      modelStr: "model",
      thinkingStr: "high",
      mcp: { configured: 0, connected: 0, failed: 0, initFailed: false },
      policy: { kind: "loaded", preset: "team", rules: 1, auditEnabled: false },
      recentRows: [],
    });

    expect(header.render(80).join("\n")).toContain("No MCP servers");

    header.update({ mcp: { configured: 4, connected: 3, failed: 1, initFailed: false } });

    const after = header.render(80).join("\n");
    expect(after).toContain("3/4 connected · 1 failed");
    expect(after).not.toContain("No MCP servers");
  });

  // Session labels come from the user's own first message, so they carry
  // whatever they carry. Measuring them by code unit lands the right border
  // short by one column per wide grapheme.
  it("keeps box borders aligned when a session label has wide characters", () => {
    const lines = renderWelcomeHeader(noopTheme, {
      modelStr: "model",
      thinkingStr: "high",
      mcp: { configured: 1, connected: 1, failed: 0, initFailed: false },
      policy: { kind: "loaded", preset: "team", rules: 1, auditEnabled: false },
      recentRows: [
        { label: "重构治理交互原语", age: "2h ago" },
        { label: "ship the 🚀 release", age: "1d ago" },
      ],
    }).render(40);

    // Single-column layout at 40 columns: every framed row is exactly 40 wide.
    const framed = lines.filter((line) => /^[╭│╰]/.test(stripAnsi(line)));
    expect(framed.length).toBeGreaterThan(0);
    for (const line of framed) {
      expect(visibleWidth(line)).toBe(40);
    }
  });

  it("removes terminal controls from recent-session labels", () => {
    const label = "safe\u001b]52;c;clipboard\u0007\u001b]8;;https://example.test\u001b\\link\u001b]8;;\u001b\\\nnext";
    const output = renderWelcomeHeader(noopTheme, {
      modelStr: "model",
      thinkingStr: "high",
      mcp: { configured: 1, connected: 1, failed: 0, initFailed: false },
      policy: { kind: "loaded", preset: "team", rules: 1, auditEnabled: false },
      recentRows: [{ label, age: "now" }],
    }).render(80).join("\n");

    const plain = stripAnsi(output);
    const recent = plain.split("Recent work").at(-1) ?? "";
    const recentLabel = recent.split("(now)")[0] ?? "";
    expect(recentLabel).toContain("safelinknext");
    expect(recentLabel).not.toContain("\u001b");
    expect(recentLabel).not.toContain("\u0007");
  });
  it("does not stretch the right column across a very wide terminal", () => {
    const lines = renderWelcomeHeader(noopTheme, {
      modelStr: "model",
      thinkingStr: "high",
      mcp: { configured: 1, connected: 1, failed: 0, initFailed: false },
      policy: { kind: "loaded", preset: "team", rules: 1, auditEnabled: false },
      recentRows: [{ label: "Wide terminal", age: "2h ago" }],
    }).render(240);

    const widest = Math.max(...lines.map((line) => visibleWidth(line)));
    expect(widest).toBeLessThanOrEqual(68 + 3 + 54);
  });
});
