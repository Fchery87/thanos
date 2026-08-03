import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HARNESS_TOOL_NAMES } from "../../src/governance/tool-contract";
import type { HarnessEventType } from "../../src/observability/harness-ledger";

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

  it("docs/harness-evolution.md's live/planned event matrix matches actual producer call sites", () => {
    // A declared HarnessEventType is not evidence anything writes it — see
    // docs/harness-evolution.md. This walks src/ for `type: "eventName"`
    // outside the type declaration itself, the same check that surfaced 6 of
    // 12 declared event types as never produced (2026-08-03 reconciliation).
    const srcRoot = join(process.cwd(), "src");
    const ledgerDeclarationFile = join(srcRoot, "observability", "harness-ledger.ts");

    function collectTsFiles(dir: string): string[] {
      const entries = readdirSync(dir, { withFileTypes: true });
      return entries.flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return collectTsFiles(full);
        return entry.name.endsWith(".ts") ? [full] : [];
      });
    }

    const files = collectTsFiles(srcRoot).filter((f) => f !== ledgerDeclarationFile);
    // Strip comments before matching: a `// e.g. type: "gate_pass"` remark
    // or a docstring mentioning an event name must not be able to fake a
    // live producer for this check.
    const sources = files.map((f) =>
      readFileSync(f, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, ""));

    function hasLiveProducer(eventType: HarnessEventType): boolean {
      const needle = `type: "${eventType}"`;
      return sources.some((source) => source.includes(needle));
    }

    // Every HarnessEventType member must appear here as exactly one of
    // "live"/"planned" — a Record (not two separate arrays) so TypeScript
    // itself rejects a new event type added to the union without a status
    // assigned here, rather than this test silently skipping it.
    const eventStatus: Record<HarnessEventType, "live" | "planned"> = {
      gate_failure: "live",
      spec_extraction: "live",
      goal_set: "live",
      goal_achieved: "live",
      goal_paused: "live",
      waves_lifecycle: "live",
      gate_pass: "planned",
      review_disagreement: "planned",
      wave_handoff_rejected: "planned",
      delivery_gate_failed: "planned",
      manual_override: "planned",
      harness_change: "planned",
    };

    const evolutionDoc = readFileSync(join(process.cwd(), "docs", "harness-evolution.md"), "utf-8");
    for (const [type, status] of Object.entries(eventStatus) as [HarnessEventType, "live" | "planned"][]) {
      expect(hasLiveProducer(type), `"${type}" is "${status}" but its live-producer status disagrees`)
        .toBe(status === "live");

      const row = evolutionDoc.split("\n").find((line) => line.includes(`\`${type}\``));
      expect(row, `docs/harness-evolution.md has no row for "${type}"`).toBeDefined();
      expect(row, `docs/harness-evolution.md doesn't mark "${type}" ${status}`)
        .toContain(status === "live" ? "**live**" : "planned");
    }
  });
});
