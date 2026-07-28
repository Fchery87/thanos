import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatRoster, loadRoster } from "../../src/agents/roster";

let root: string;
let userDir: string;
let projectDir: string;

async function writeAgent(dir: string, file: string, frontmatter: string, body = "You are a specialist."): Promise<void> {
  await writeFile(join(dir, file), `---\n${frontmatter}\n---\n${body}\n`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "roster-test-"));
  userDir = join(root, "user-agents");
  projectDir = join(root, "project-agents");
  await mkdir(userDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadRoster", () => {
  it("reads name, description, and defaultContext from frontmatter", async () => {
    await writeAgent(userDir, "worker.md", "name: worker\ndescription: Implementation agent\ndefaultContext: fork");
    const roster = await loadRoster({ userDir, projectDir });
    expect(roster).toEqual([
      { name: "worker", description: "Implementation agent", scope: "user", defaultContext: "fork" },
    ]);
  });

  it("falls back to the filename when name is missing", async () => {
    await writeAgent(userDir, "explore.md", "description: Maps the codebase");
    const roster = await loadRoster({ userDir, projectDir });
    expect(roster.map((e) => e.name)).toEqual(["explore"]);
  });

  it("skips agents marked disabled: true", async () => {
    await writeAgent(userDir, "reviewer.md", "name: reviewer\ndescription: Reviews code");
    await writeAgent(userDir, "retired.md", "name: retired\ndescription: Old agent\ndisabled: true");
    const roster = await loadRoster({ userDir, projectDir });
    expect(roster.map((e) => e.name)).toEqual(["reviewer"]);
  });

  it("skips files without valid frontmatter instead of failing the roster", async () => {
    await writeFile(join(userDir, "notes.md"), "no frontmatter here");
    await writeAgent(userDir, "plan.md", "name: plan\ndescription: Plans work");
    const roster = await loadRoster({ userDir, projectDir });
    expect(roster.map((e) => e.name)).toEqual(["plan"]);
  });

  it("lets project scope win on name collisions, mirroring pi-subagents discovery", async () => {
    await writeAgent(userDir, "reviewer.md", "name: reviewer\ndescription: User-scope reviewer");
    await writeAgent(projectDir, "reviewer.md", "name: reviewer\ndescription: Project-scope reviewer");
    const roster = await loadRoster({ userDir, projectDir });
    expect(roster).toEqual([
      { name: "reviewer", description: "Project-scope reviewer", scope: "project", defaultContext: undefined },
    ]);
  });

  it("returns entries sorted by name across both scopes", async () => {
    await writeAgent(userDir, "worker.md", "name: worker\ndescription: w");
    await writeAgent(userDir, "build.md", "name: build\ndescription: b");
    await writeAgent(projectDir, "custom.md", "name: custom\ndescription: c");
    const roster = await loadRoster({ userDir, projectDir });
    expect(roster.map((e) => e.name)).toEqual(["build", "custom", "worker"]);
  });

  it("treats a missing scope directory as empty, not an error", async () => {
    await writeAgent(userDir, "scout.md", "name: scout\ndescription: Recon");
    const roster = await loadRoster({ userDir, projectDir: join(root, "does-not-exist") });
    expect(roster.map((e) => e.name)).toEqual(["scout"]);
  });

  it("returns an empty roster when no agents exist anywhere", async () => {
    const roster = await loadRoster({
      userDir: join(root, "missing-user"),
      projectDir: join(root, "missing-project"),
    });
    expect(roster).toEqual([]);
  });

  it("drops entries with control characters or oversized fields", async () => {
    await writeAgent(userDir, "bad.md", "name: bad\ndescription: ok\u0001nope");
    await writeAgent(userDir, "long.md", `name: ${"a".repeat(60)}\ndescription: valid description`);
    await writeAgent(userDir, "good.md", "name: good\ndescription: valid description");
    const roster = await loadRoster({ userDir, projectDir });
    expect(roster.map((e) => e.name)).toEqual(["good"]);
  });
});

describe("over-long fields", () => {
  // A description used to be rejected when it exceeded the cap, and because a
  // missing description drops the entry, one long line removed its agent from
  // the roster entirely. `designer` was absent from every parent turn's roster
  // for exactly this reason — 328 characters against a 240 cap.
  it("truncates an over-long description instead of dropping the agent", async () => {
    const long = "D".repeat(400);
    await writeAgent(userDir, "designer.md", `name: designer\ndescription: ${long}`);

    const roster = await loadRoster({ userDir, projectDir });

    expect(roster.map((e) => e.name)).toContain("designer");
    const entry = roster.find((e) => e.name === "designer")!;
    expect(entry.description.length).toBe(240);
    expect(entry.description.endsWith("\u2026")).toBe(true);
  });

  it("leaves a description at exactly the cap untouched", async () => {
    await writeAgent(userDir, "exact.md", `name: exact\ndescription: ${"D".repeat(240)}`);
    const roster = await loadRoster({ userDir, projectDir });
    expect(roster.find((e) => e.name === "exact")?.description).toBe("D".repeat(240));
  });

  // A name is different: over-long means malformed, and advertising a name the
  // subagent engine cannot resolve is worse than not advertising the agent.
  it("still drops an agent whose name exceeds the cap", async () => {
    await writeAgent(userDir, "big.md", `name: ${"n".repeat(60)}\ndescription: fine`);
    const roster = await loadRoster({ userDir, projectDir });
    expect(roster.map((e) => e.name)).not.toContain("n".repeat(60));
  });
});

describe("formatRoster", () => {
  it("renders one line per agent with the description verbatim", () => {
    const text = formatRoster([
      { name: "explore", description: "Maps the codebase. Read-only.", scope: "user" },
      { name: "worker", description: "Implementation agent", scope: "user", defaultContext: "fork" },
    ]);
    expect(text).toBe(
      "- explore: Maps the codebase. Read-only.\n" +
      "- worker (context: fork): Implementation agent",
    );
  });

  it("tags project-scope agents", () => {
    const text = formatRoster([
      { name: "custom", description: "Project helper", scope: "project" },
    ]);
    expect(text).toBe("- custom (project): Project helper");
  });

  it("combines scope and context tags", () => {
    const text = formatRoster([
      { name: "custom", description: "Project fork agent", scope: "project", defaultContext: "fork" },
    ]);
    expect(text).toBe("- custom (project, context: fork): Project fork agent");
  });
});

describe("live roster integration", () => {
  it("produces a non-empty roster from the real agent definitions with no list-call needed", async () => {
    // The real user scope this harness ships (repo-relative, same dir the
    // roster-contract test reads) — proves the directive will actually carry
    // a roster in production rather than falling back to {action:"list"}.
    const roster = await loadRoster({ userDir: join("agent", "agents"), projectDir: join(root, "none") });
    expect(roster.length).toBeGreaterThan(0);
    for (const entry of roster) {
      expect(entry.name, `${entry.name} needs a description to be routable`).toBeTruthy();
      expect(entry.description.length, `${entry.name} needs a description to be routable`).toBeGreaterThan(0);
    }
  });
});
