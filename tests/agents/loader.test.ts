import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgent } from "../../src/agents/loader";

const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
});

// The loader resolves agent definitions from `$HOME/.pi/agent/agents`. That is correct at
// runtime (Pi installs to ~/.pi) but means tests against the *real* committed definitions
// must not depend on the repo happening to live at ~/.pi. Point HOME at a temp dir whose
// `.pi/agent` symlinks to this repo's `agent/` so these assertions hold in CI and any clone.
async function repoHomeWithRealAgents(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "thanos-agent-home-"));
  await mkdir(join(home, ".pi"), { recursive: true });
  await symlink(join(process.cwd(), "agent"), join(home, ".pi", "agent"), "dir");
  return home;
}

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
        "maxExecutionTimeMs: 120000",
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
    expect(agent.maxExecutionTimeMs).toBe(120000);
  });

  it("loads tools from agent markdown frontmatter for explore type", async () => {
    process.env.HOME = await repoHomeWithRealAgents();
    const def = await loadAgent("explore");
    expect(def.tools).toBeDefined();
    expect(def.tools).toContain("read");
    expect(def.tools).not.toContain("bash");
  });

  it("loads tools from agent markdown frontmatter for designer type", async () => {
    process.env.HOME = await repoHomeWithRealAgents();
    const def = await loadAgent("designer");
    expect(def.tools).toContain("edit");
    expect(def.tools).not.toContain("bash");
  });

  it("loads the evaluator definition as a read-only fresh-context grader", async () => {
    process.env.HOME = await repoHomeWithRealAgents();
    const def = await loadAgent("evaluator");

    expect(def.tools).toEqual(expect.arrayContaining(["read", "ls", "find", "grep", "bash", "report_finding"]));
    expect(def.tools).not.toContain("edit");
    expect(def.tools).not.toContain("write");
    expect(def.body).toContain("fresh-context evaluator");
    expect(def.body).toMatch(/PASS|NEEDS_WORK/);
  });

  it("parses an explicit context mode from frontmatter", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-agent-"));
    process.env.HOME = home;
    const agentDir = join(home, ".pi", "agent", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "designer.md"),
      ["---", "tools: read, edit", "context: forked", "---", "You are Designer."].join("\n"),
      "utf-8",
    );
    const agent = await loadAgent("designer");
    expect(agent.context).toBe("forked");
  });

  it("leaves context undefined when not specified", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-agent-"));
    process.env.HOME = home;
    const agentDir = join(home, ".pi", "agent", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "explore.md"),
      ["---", "tools: read", "---", "You are Explore."].join("\n"),
      "utf-8",
    );
    const agent = await loadAgent("explore");
    expect(agent.context).toBeUndefined();
  });

  it("every agent type has a definition file with a tools allowlist", async () => {
    process.env.HOME = await repoHomeWithRealAgents();
    const types = ["build", "evaluator", "explore", "oracle", "plan", "reviewer", "researcher"] as const;
    for (const type of types) {
      const def = await loadAgent(type);
      expect(def.tools, `${type} should have tools defined`).toBeDefined();
      expect(def.tools!.length, `${type} tools should not be empty`).toBeGreaterThan(0);
    }
  });

  it("rejects manifests whose tools exceed the catalog ceiling", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-agent-"));
    process.env.HOME = home;
    const agentDir = join(home, ".pi", "agent", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "explore.md"),
      ["---", "tools: read", "context: forked", "---", "You are Explore."].join("\n"),
      "utf-8",
    );

    await expect(loadAgent("explore")).rejects.toThrow(/unsupported context mode/);
  });

  it("rejects manifests whose context mode exceeds the catalog ceiling", async () => {
    const home = await mkdtemp(join(tmpdir(), "thanos-agent-"));
    process.env.HOME = home;
    const agentDir = join(home, ".pi", "agent", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "scout.md"),
      ["---", "tools: read, bash", "---", "You are Scout."].join("\n"),
      "utf-8",
    );

    await expect(loadAgent("scout" as never)).rejects.toThrow(/unsupported tool/);
  });
});
