import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("instruction surface", () => {
  it("keeps CONTEXT focused on glossary material and points to deeper docs", () => {
    const context = readFileSync(join(process.cwd(), "CONTEXT.md"), "utf-8");

    expect(context).toContain("## Glossary");
    expect(context).toContain("## Relationships");
    expect(context).toContain("## Read More");
    expect(context).not.toContain("## Approved direction");
    expect(context).not.toContain("## Flagged ambiguities");
  });

  it("ships a project AGENTS guide for operational rules", () => {
    const path = join(process.cwd(), "AGENTS.md");
    expect(existsSync(path)).toBe(true);

    const agents = readFileSync(path, "utf-8");
    expect(agents).toContain("## Quick Start");
    expect(agents).toContain("/models");
    expect(agents).toContain("/goal <condition>");
      expect(agents).toContain("## Validation Gates");
    expect(agents).toContain("bun run typecheck");
      expect(agents).toContain("## Worktree Rules");
    expect(agents).toContain("Writing agents work in isolated worktrees");
  });
});
