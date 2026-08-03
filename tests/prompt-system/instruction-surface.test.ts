import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HARNESS_TOOL_NAMES } from "../../src/governance/tool-contract";

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

  it("documents every harness-registered tool in docs/reference.md", () => {
    // src/governance/tool-contract.ts's HARNESS_TOOL_NAMES is the canonical
    // list this harness itself registers (as opposed to Pi-core builtins or
    // pi-subagents' `subagent`). If a name here has no row in the reference
    // doc, the doc has drifted from the actual registered tool surface.
    const reference = readFileSync(join(process.cwd(), "docs", "reference.md"), "utf-8");
    for (const name of HARNESS_TOOL_NAMES) {
      expect(reference, `docs/reference.md is missing a row for \`${name}\``).toContain(`\`${name}\``);
    }
  });
});
