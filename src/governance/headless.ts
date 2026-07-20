import type { PolicyPreset, PolicyRule } from "../policy/types";

export type HeadlessBehavior = "deny" | "ask" | "allow";

export interface HeadlessConfig {
  defaultDecision: HeadlessBehavior;
}

const UNSAFE_ALLOW_PRESETS: PolicyPreset[] = ["team", "ci"];

export function resolveHeadlessDecision(
  config: HeadlessConfig | undefined,
  preset: PolicyPreset,
  capability: string,
): "allow" | "deny" | "ask" {
  const defaultDecision = config?.defaultDecision ?? "ask";

  // Team and CI presets reject unsafe allow defaults
  if (UNSAFE_ALLOW_PRESETS.includes(preset)) {
    if (defaultDecision === "allow") {
      return "ask";
    }
  }

  // Critical capabilities (exec, edit) can never be auto-allowed in headless
  if (defaultDecision === "allow" && (capability === "exec" || capability === "edit")) {
    return "ask";
  }

  return defaultDecision;
}

export function isHeadlessSafe(preset: PolicyPreset, decision: HeadlessBehavior): boolean {
  if (UNSAFE_ALLOW_PRESETS.includes(preset)) {
    return decision === "deny" || decision === "ask";
  }
  return decision === "deny" || decision === "ask";
}
