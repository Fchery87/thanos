import { getSpecialist, type SpecialistId } from "./catalog";

export interface AgentManifest {
  tools?: string[];
  context?: "fresh" | "forked";
  maxTurns?: number;
  maxExecutionTimeMs?: number;
}

export function validateManifest(role: string, manifest: AgentManifest): void {
  const profile = getSpecialist(role as SpecialistId);
  if (!profile) throw new Error(`Unknown specialist: ${role}`);

  for (const tool of manifest.tools ?? []) {
    if (!profile.toolCeiling.includes(tool)) {
      throw new Error(`${role} declares unsupported tool \"${tool}\"`);
    }
  }

  if (manifest.context && !profile.contextModes.includes(manifest.context)) {
    throw new Error(`${role} declares unsupported context mode \"${manifest.context}\"`);
  }

  if (manifest.maxExecutionTimeMs !== undefined && manifest.maxExecutionTimeMs <= 0) {
    throw new Error(`${role} must declare a positive maxExecutionTimeMs`);
  }
}
