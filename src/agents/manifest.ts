import { getSpecialist, type SpecialistId } from "./catalog";

export interface AgentManifest {
  tools?: string[];
  context?: "fresh" | "forked";
  maxTurns?: number;
  maxExecutionTimeMs?: number;
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

  if (manifest.maxExecutionTimeMs !== undefined && manifest.maxExecutionTimeMs <= 0) {
    throw new Error(`${role} must declare a positive maxExecutionTimeMs`);
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
