import { afterEach, describe, expect, it, vi } from "vitest";
import register from "../../src/index";

function fakePi(tools: Map<string, any>) {
  return {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    on: vi.fn(),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
  } as any;
}

const SUBAGENT_ENV_KEYS = ["HARNESS_SUBAGENT", "PI_SUBAGENT_CHILD", "PI_SUBAGENT_CHILD_AGENT"] as const;

function withSubagentEnv(vars: Partial<Record<(typeof SUBAGENT_ENV_KEYS)[number], string>>, run: () => void) {
  const previous = Object.fromEntries(SUBAGENT_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of SUBAGENT_ENV_KEYS) {
    if (vars[key] !== undefined) process.env[key] = vars[key];
    else delete process.env[key];
  }
  try {
    run();
  } finally {
    for (const key of SUBAGENT_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

afterEach(() => {
  for (const key of SUBAGENT_ENV_KEYS) delete process.env[key];
});

describe("report_finding tool", () => {
  it("does not register in the main session", () => {
    const mainTools = new Map<string, any>();
    register(fakePi(mainTools));
    expect(mainTools.has("report_finding")).toBe(false);
  });

  it("registers for the legacy reviewer marker (HARNESS_SUBAGENT=reviewer)", () => {
    withSubagentEnv({ HARNESS_SUBAGENT: "reviewer" }, () => {
      const tools = new Map<string, any>();
      register(fakePi(tools));
      expect(tools.has("report_finding")).toBe(true);
    });
  });

  it("registers for the legacy generic subagent marker (HARNESS_SUBAGENT=1)", () => {
    withSubagentEnv({ HARNESS_SUBAGENT: "1" }, () => {
      const tools = new Map<string, any>();
      register(fakePi(tools));
      expect(tools.has("report_finding")).toBe(true);
    });
  });

  it("registers for any live pi-subagents child, regardless of its agent role", () => {
    withSubagentEnv({ PI_SUBAGENT_CHILD: "1", PI_SUBAGENT_CHILD_AGENT: "explore" }, () => {
      const tools = new Map<string, any>();
      register(fakePi(tools));
      expect(tools.has("report_finding")).toBe(true);
    });
  });

  it("returns aggregate verdict after a finding is reported", async () => {
    const reviewerTools = new Map<string, any>();
    withSubagentEnv({ HARNESS_SUBAGENT: "reviewer" }, () => {
      register(fakePi(reviewerTools));
    });
    const result = await reviewerTools.get("report_finding").execute("rf-1", {
      priority: "P1",
      summary: "Policy bypass",
      rationale: "The tool skips governance checks.",
    }, undefined, undefined, { hasUI: true, ui: {} });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      verdict: "request-changes",
      findings: [{ priority: "P1", summary: "Policy bypass" }],
    });
  });
});
