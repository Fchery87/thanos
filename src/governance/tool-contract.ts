import { createHash } from "node:crypto";
import { capabilityForTool } from "./tool-call";
import { classifyRisk, isRecognizedTool, type RiskTier } from "../permissions/risk";
import type { Capability } from "../permissions/rules";

/**
 * Read-only projection of the actual registered tool surface and its
 * governance classification. This is not a second authorization engine:
 * `capability`/`risk`/`recognized` are computed by calling the same
 * `capabilityForTool`/`classifyRisk`/`isRecognizedTool` functions
 * `GovernanceRuntime` uses to authorize a real call — this module never
 * re-derives that logic, it only reads its output for a name with no input
 * (the conservative baseline: e.g. `bash` with no command classifies as its
 * worst case, "critical").
 */
export interface ToolContractEntry {
  name: string;
  source: "builtin" | "harness" | "pi-subagents" | "mcp";
  active: boolean;
  capability: Capability;
  risk: RiskTier;
  recognized: boolean;
  readOnly: boolean;
  description: string;
  schema?: unknown;
  documentation: "generated" | "not-applicable";
}

export interface ToolContractSnapshot {
  revision: string;
  entries: readonly ToolContractEntry[];
  summary: {
    active: number;
    recognized: number;
    unknown: number;
    readOnly: number;
    mutating: number;
  };
}

/** The slice of `pi.getAllTools()`'s `ToolInfo` this projection actually reads. */
export interface ToolContractToolInfo {
  name: string;
  description: string;
  parameters?: unknown;
  sourceInfo?: { source?: string; path?: string };
}

export interface ToolContractSnapshotInput {
  /** The live registered-tool surface, e.g. `pi.getAllTools()`. */
  tools: readonly ToolContractToolInfo[];
  /** Names currently active for this session, e.g. `pi.getActiveTools()`. */
  activeToolNames: readonly string[];
}

// Tools this harness itself registers (src/runtime/tools.ts,
// src/runtime/commands/todo.ts, src/workflows/tool.ts). Everything else in
// the live registry is Pi core, pi-subagents, or an MCP server's tool —
// this harness classifies it (capability/risk/recognized) but does not own
// its documentation.
export const HARNESS_TOOL_NAMES: ReadonlySet<string> =
  new Set(["ask", "todo", "goal_complete", "workflow_yield", "report_finding"]);

function classifySource(tool: ToolContractToolInfo): ToolContractEntry["source"] {
  if (HARNESS_TOOL_NAMES.has(tool.name)) return "harness";
  if (tool.name === "subagent") return "pi-subagents";
  // Descriptive only: an MCP-provided tool is never treated as a recognized
  // built-in on the strength of this label. MCP trust/validation stays owned
  // by src/mcp/manager.ts; this heuristic only picks a display bucket.
  const label = `${tool.sourceInfo?.source ?? ""} ${tool.sourceInfo?.path ?? ""}`.toLowerCase();
  if (label.includes("mcp")) return "mcp";
  return "builtin";
}

function computeRevision(entries: readonly ToolContractEntry[]): string {
  const digestInput = entries
    .map((e) => `${e.name}|${e.source}|${e.capability}|${e.risk}|${e.recognized}`)
    .join(",");
  return `sha256:${createHash("sha256").update(digestInput).digest("hex").slice(0, 16)}`;
}

/**
 * Projects `input.tools` into one contract snapshot. Pure and read-only: no
 * model, network, or filesystem call, and no side effect on policy,
 * permissions, delivery, or acceptance state. Callers (`/tools`, `/doctor`,
 * docs generation, tests) consume this instead of maintaining their own copy
 * of the tool surface.
 */
export function buildToolContractSnapshot(input: ToolContractSnapshotInput): ToolContractSnapshot {
  const activeNames = new Set(input.activeToolNames);
  const seen = new Set<string>();
  const entries: ToolContractEntry[] = [];

  for (const tool of input.tools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);

    const capability = capabilityForTool(tool.name);
    entries.push({
      name: tool.name,
      source: classifySource(tool),
      active: activeNames.has(tool.name),
      capability,
      // No live call input at projection time, so this is each tool's
      // conservative baseline classification, not a per-call decision.
      risk: classifyRisk(tool.name, {}),
      recognized: isRecognizedTool(tool.name),
      readOnly: capability === "read",
      description: tool.description,
      schema: tool.parameters,
      documentation: HARNESS_TOOL_NAMES.has(tool.name) ? "generated" : "not-applicable",
    });
  }

  // Stable regardless of registration order, so two snapshots built from the
  // same tool set always render identically.
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const summary = {
    active: entries.filter((e) => e.active).length,
    recognized: entries.filter((e) => e.recognized).length,
    unknown: entries.filter((e) => !e.recognized).length,
    readOnly: entries.filter((e) => e.readOnly).length,
    mutating: entries.filter((e) => !e.readOnly).length,
  };

  return { revision: computeRevision(entries), entries, summary };
}
