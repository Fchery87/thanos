import { getSpecialist, type SpecialistId } from "./catalog";

export interface AgentManifest {
  tools?: string[];
  model?: string;
  fallbackModels?: string[];
  context?: "fresh" | "forked";
  /** @deprecated Retired — pi-subagents 0.41.0 does not read this key. Kept typed so a manifest that still declares it is rejected loudly instead of silently ignored. Use turnBudget. */
  maxTurns?: number;
  /** @deprecated Retired — pi-subagents 0.41.0 does not read this key. Kept typed so a manifest that still declares it is rejected loudly instead of silently ignored. Use timeoutMs. */
  maxExecutionTimeMs?: number;
  timeoutMs?: number;
  turnBudget?: { maxTurns: number; graceTurns?: number };
  maxSubagentDepth?: number;
  systemPromptMode?: string;
  inheritProjectContext?: boolean;
  defaultContext?: string;
  defaultReads?: string[];
  defaultProgress?: boolean;
}

function sameStringArray(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function validateManifest(role: string, manifest: AgentManifest): void {
  const profile = getSpecialist(role as SpecialistId);
  if (!profile) throw new Error(`Unknown specialist: ${role}`);

  for (const tool of manifest.tools ?? []) {
    if (!profile.toolCeiling.includes(tool)) {
      throw new Error(`${role} declares unsupported tool "${tool}"`);
    }
    if (tool === "subagent" && profile.mayDelegate.length === 0) {
      throw new Error(`${role} declares unsupported delegation tool "subagent"`);
    }
  }

  if (manifest.context && !profile.contextModes.includes(manifest.context)) {
    throw new Error(`${role} declares unsupported context mode "${manifest.context}"`);
  }

  if (manifest.maxSubagentDepth !== undefined && manifest.maxSubagentDepth !== profile.maxSubagentDepth) {
    throw new Error(`${role} declares unsupported maxSubagentDepth "${manifest.maxSubagentDepth}"`);
  }

  const RETIRED: ReadonlyArray<[keyof AgentManifest, string]> = [
    ["maxExecutionTimeMs", "timeoutMs"],
    ["maxTurns", "turnBudget"],
  ];
  for (const [retired, live] of RETIRED) {
    if (manifest[retired] !== undefined) {
      throw new Error(`${role}: ${retired} is retired; use ${live} (pi-subagents reads ${live} frontmatter)`);
    }
  }

  if (manifest.timeoutMs !== undefined && (!Number.isInteger(manifest.timeoutMs) || manifest.timeoutMs <= 0)) {
    throw new Error(`${role} must declare timeoutMs as a positive integer, got ${manifest.timeoutMs}`);
  }

  if (manifest.turnBudget !== undefined) {
    const { maxTurns, graceTurns } = manifest.turnBudget;
    if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
      throw new Error(`${role} must declare turnBudget.maxTurns as a positive integer, got ${maxTurns}`);
    }
    if (graceTurns !== undefined && (!Number.isInteger(graceTurns) || graceTurns < 0)) {
      throw new Error(`${role} must declare turnBudget.graceTurns as a non-negative integer, got ${graceTurns}`);
    }
  }

  if (manifest.model !== undefined && manifest.model.trim() === "") {
    throw new Error(`${role} must declare a non-empty model when present, got ${JSON.stringify(manifest.model)}`);
  }

  if (manifest.fallbackModels !== undefined) {
    if (!Array.isArray(manifest.fallbackModels) || manifest.fallbackModels.length === 0) {
      throw new Error(`${role} must declare fallbackModels as a non-empty array, got ${JSON.stringify(manifest.fallbackModels)}`);
    }
    for (const entry of manifest.fallbackModels) {
      if (typeof entry !== "string" || entry.trim() === "") {
        throw new Error(`${role} declares an invalid fallbackModels entry, got ${JSON.stringify(entry)}`);
      }
    }
  }

  if (manifest.systemPromptMode !== undefined && manifest.systemPromptMode !== profile.manifest.systemPromptMode) {
    throw new Error(`${role} declares unsupported systemPromptMode "${manifest.systemPromptMode}"`);
  }

  if (manifest.inheritProjectContext !== undefined && manifest.inheritProjectContext !== profile.manifest.inheritProjectContext) {
    throw new Error(`${role} declares unsupported inheritProjectContext "${manifest.inheritProjectContext}"`);
  }

  if (manifest.defaultContext !== undefined && manifest.defaultContext !== profile.manifest.defaultContext) {
    throw new Error(`${role} declares unsupported defaultContext "${manifest.defaultContext}"`);
  }

  if (manifest.defaultProgress !== undefined && manifest.defaultProgress !== profile.manifest.defaultProgress) {
    throw new Error(`${role} declares unsupported defaultProgress "${manifest.defaultProgress}"`);
  }

  if (!sameStringArray(manifest.defaultReads, profile.manifest.defaultReads)) {
    if ((manifest.defaultReads?.length ?? 0) > 0 || (profile.manifest.defaultReads?.length ?? 0) > 0) {
      throw new Error(`${role} declares unsupported defaultReads`);
    }
  }
}
