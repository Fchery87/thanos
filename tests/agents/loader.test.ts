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
});
