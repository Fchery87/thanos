import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelForRef, type ModelCatalog } from "./model-catalog-helpers";
import { validateManifest } from "../../src/agents/manifest";

const AGENTS_DIR = join("agent", "agents");

interface RosterAgentDefinition {
  file: string;
  name: string;
  tools: string[];
  maxTurns?: number;
  maxExecutionTimeMs?: number;
  maxSubagentDepth?: number;
  systemPromptMode?: string;
  inheritProjectContext?: boolean;
  defaultContext?: string;
  defaultReads?: string[];
  defaultProgress?: boolean;
}

/** Minimal frontmatter reader — every live agent .md uses single-line `key: value` fields, no YAML lists. */
function parseFrontmatter(file: string, raw: string): RosterAgentDefinition {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") throw new Error(`${file}: missing frontmatter opening ---`);
  const closingIndex = lines.slice(1).findIndex((l) => l === "---") + 1;
  if (closingIndex <= 0) throw new Error(`${file}: missing frontmatter closing ---`);

  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, closingIndex)) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (match) fields[match[1]!] = match[2]!.trim();
  }

  const numeric = (key: string): number | undefined => {
    const raw = fields[key];
    if (raw === undefined || raw === "") return undefined;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) throw new Error(`${file}: ${key} is not a number (got "${raw}")`);
    return parsed;
  };

  const boolean = (key: string): boolean | undefined => {
    const raw = fields[key];
    if (raw === undefined || raw === "") return undefined;
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`${file}: ${key} is not a boolean (got "${raw}")`);
  };

  return {
    file,
    name: fields.name ?? "",
    tools: (fields.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    maxTurns: numeric("maxTurns"),
    maxExecutionTimeMs: numeric("maxExecutionTimeMs"),
    maxSubagentDepth: numeric("maxSubagentDepth"),
    systemPromptMode: fields.systemPromptMode,
    inheritProjectContext: boolean("inheritProjectContext"),
    defaultContext: fields.defaultContext,
    defaultReads: (fields.defaultReads ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    defaultProgress: boolean("defaultProgress"),
  };
}

async function loadRoster(): Promise<RosterAgentDefinition[]> {
  const files = (await readdir(AGENTS_DIR)).filter((f) => f.endsWith(".md"));
  return Promise.all(
    files.map(async (file) => parseFrontmatter(file, await readFile(join(AGENTS_DIR, file), "utf-8"))),
  );
}

// Every tool name a live subagent child (spawned by the pi-subagents engine)
// can actually have registered in its process, with where it comes from.
// This is what catches the report_finding class of bug: a tool an agent
// definition lists but that no process would ever register for a child.
//
// - read/ls/find/grep/write/edit/bash: pi core builtins.
// - subagent: pi-subagents' own delegation entry point.
// - contact_supervisor/intercom: pi-subagents' worker/scout coordination tools
//   (see agent/npm/node_modules/pi-subagents/src/intercom/).
// - web_search/fetch_content: provided by the pi-web-access package.
// - report_finding: registered by this harness's extension for EVERY
//   subagent process (src/index.ts, `if (isSubagent) { pi.registerTool({name:
//   "report_finding", ...}) }` — fixed in the report_finding live-path ticket;
//   before that fix this was gated to a legacy-only marker and NOT valid here).
//
// Deliberately excluded even though this harness registers them: ask, todo,
// goal_complete, task are all registered ONLY under `if (!isSubagent)` in
// src/index.ts — parent-only tools a live child could never call, so an
// agent definition listing one of these would be exactly the same class of
// bug as the historical report_finding break.
const VALID_LIVE_CHILD_TOOLS = new Set([
  "read", "ls", "find", "grep", "write", "edit", "bash",
  "subagent", "contact_supervisor", "intercom",
  "web_search", "fetch_content",
  "report_finding",
]);

describe("live agent roster contract", () => {
  it("sanity: the tool-validity set actually rejects an unregistered tool name", () => {
    // Guards against this test being vacuously true — if this ever passes for
    // a nonsense tool name, the real assertions below are worthless.
    expect(VALID_LIVE_CHILD_TOOLS.has("totally-unregistered-tool")).toBe(false);
    expect(VALID_LIVE_CHILD_TOOLS.has("ask")).toBe(false); // parent-only, not valid for a child
    expect(VALID_LIVE_CHILD_TOOLS.has("report_finding")).toBe(true); // the fixed case
  });

  it("every tool every live agent definition lists is something a child process would register", async () => {
    const roster = await loadRoster();
    expect(roster.length).toBeGreaterThan(0);

    for (const agent of roster) {
      for (const tool of agent.tools) {
        expect(VALID_LIVE_CHILD_TOOLS.has(tool), `${agent.file} lists unrecognized tool "${tool}"`).toBe(true);
      }
    }
  });

  it("turn and execution-time budgets are positive integers where present", async () => {
    const roster = await loadRoster();
    for (const agent of roster) {
      for (const key of ["maxTurns", "maxExecutionTimeMs"] as const) {
        const value = agent[key];
        if (value === undefined) continue;
        expect(Number.isInteger(value), `${agent.file}: ${key} must be an integer, got ${value}`).toBe(true);
        expect(value, `${agent.file}: ${key} must be positive, got ${value}`).toBeGreaterThan(0);
      }
    }
  });

  it("maxSubagentDepth is a non-negative integer where present (0 is a valid hard-stop, not an error)", async () => {
    // Unlike maxTurns/maxExecutionTimeMs, pi-subagents treats maxSubagentDepth
    // 0 as meaningful (block further nesting) — confirmed against its own
    // frontmatter parser and runtime validator, both of which accept >= 0.
    // Asserting > 0 here would reject a legitimate future config.
    const roster = await loadRoster();
    for (const agent of roster) {
      const value = agent.maxSubagentDepth;
      if (value === undefined) continue;
      expect(Number.isInteger(value), `${agent.file}: maxSubagentDepth must be an integer, got ${value}`).toBe(true);
      expect(value, `${agent.file}: maxSubagentDepth must be non-negative, got ${value}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("every agent definition has a non-empty tools list", async () => {
    const roster = await loadRoster();
    for (const agent of roster) {
      expect(agent.tools.length, `${agent.file} has no tools`).toBeGreaterThan(0);
    }
  });

  it("validates every shipped frontmatter manifest against the catalog-backed contract", async () => {
    const roster = await loadRoster();
    expect(roster.length).toBeGreaterThan(0);

    for (const agent of roster) {
      expect(() => validateManifest(agent.name, {
        tools: agent.tools,
        maxTurns: agent.maxTurns,
        maxExecutionTimeMs: agent.maxExecutionTimeMs,
        maxSubagentDepth: agent.maxSubagentDepth,
        systemPromptMode: agent.systemPromptMode,
        inheritProjectContext: agent.inheritProjectContext,
        defaultContext: agent.defaultContext,
        defaultReads: agent.defaultReads,
        defaultProgress: agent.defaultProgress,
      })).not.toThrow();
    }
  });
});

// ── Model override resolution (extends tests/agents/settings.test.ts's
// existing "routes every stashed subagent override to a catalog model"
// coverage to the ACTIVE agentOverrides map too, not just the saved one) ──

interface Settings {
  subagents?: {
    agentOverrides?: Record<string, { model: string; fallbackModels?: string[] }>;
    savedAgentOverrides?: Record<string, { model: string; fallbackModels?: string[] }>;
  };
}

function assertOverridesResolve(
  label: string,
  overrides: Record<string, { model: string; fallbackModels?: string[] }> | undefined,
  catalog: ModelCatalog,
): void {
  for (const [role, override] of Object.entries(overrides ?? {})) {
    expect(modelForRef(catalog, override.model), `${label}.${role}: ${override.model}`).toBeDefined();
    for (const fallback of override.fallbackModels ?? []) {
      expect(modelForRef(catalog, fallback), `${label}.${role} fallback: ${fallback}`).toBeDefined();
    }
  }
}

describe("subagent model override contract", () => {
  it("resolves every ACTIVE (agentOverrides) entry against the model catalog", async () => {
    const settings = JSON.parse(await readFile("agent/settings.example.json", "utf-8")) as Settings;
    const catalog = JSON.parse(await readFile("agent/models.example.json", "utf-8")) as ModelCatalog;
    // agentOverrides is undefined in the shipped example (routing ships OFF) —
    // this still exercises the same resolution path so a future example that
    // enables routing is caught immediately if it references an unknown model.
    assertOverridesResolve("agentOverrides", settings.subagents?.agentOverrides, catalog);
  });

  it("resolves every STASHED (savedAgentOverrides) entry against the model catalog", async () => {
    const settings = JSON.parse(await readFile("agent/settings.example.json", "utf-8")) as Settings;
    const catalog = JSON.parse(await readFile("agent/models.example.json", "utf-8")) as ModelCatalog;
    const overrides = settings.subagents?.savedAgentOverrides;
    expect(Object.keys(overrides ?? {}).length).toBeGreaterThan(0);
    assertOverridesResolve("savedAgentOverrides", overrides, catalog);
  });
});
