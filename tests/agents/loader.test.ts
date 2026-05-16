import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgent } from "../../src/agents/loader";

const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
});

describe("loadAgent", () => {
  it("parses frontmatter fields into structured agent metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-agent-"));
    process.env.HOME = home;

    const agentDir = join(home, ".pi", "agent", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "build.md"),
      [
        "---",
        'tools: ["read", "write"]',
        'model: "gemini-3-pro"',
        "maxTurns: 4",
        "timeoutMs: 120000",
        "---",
        "You are a build specialist.",
      ].join("\n"),
      "utf-8",
    );

    const agent = await loadAgent("build");

    expect(agent.body).toContain("You are a build specialist.");
    expect(agent.tools).toEqual(["read", "write"]);
    expect(agent.model).toBe("gemini-3-pro");
    expect(agent.maxTurns).toBe(4);
    expect(agent.timeoutMs).toBe(120000);
  });

  it("loads tools from agent markdown frontmatter for explore type", async () => {
    const def = await loadAgent("explore");
    expect(def.tools).toBeDefined();
    expect(def.tools).toContain("read");
    expect(def.tools).not.toContain("bash");
  });

  it("loads tools from agent markdown frontmatter for designer type", async () => {
    const def = await loadAgent("designer");
    expect(def.tools).toBeDefined();
    expect(def.tools).toContain("edit");
    expect(def.tools).not.toContain("bash");
  });

  it("every agent type has a definition file with a tools allowlist", async () => {
    const types = ["explore", "plan", "build", "reviewer", "designer"] as const;
    for (const type of types) {
      const def = await loadAgent(type);
      expect(def.tools, `${type} should have tools defined`).toBeDefined();
      expect(def.tools!.length, `${type} tools should not be empty`).toBeGreaterThan(0);
    }
  });
});
