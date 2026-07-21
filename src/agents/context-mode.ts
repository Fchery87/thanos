import type { AgentType } from "./registry";
import { allowedContextModes, type ContextMode } from "./catalog";

export type { ContextMode } from "./catalog";

export function resolveContextMode(type: AgentType, requested: ContextMode | undefined): ContextMode {
  if (requested === undefined) return "fresh";
  if (requested === "fresh") return "fresh";
  // requested === "forked"
  const allowed = allowedContextModes(type);
  if (!allowed.includes("forked")) {
    throw new Error(
      `Agent "${type}" may not run in forked context. See ADR 0004.`,
    );
  }
  return "forked";
}

export function buildContextArgs(mode: ContextMode, parentSessionRef?: string): string[] {
  if (mode === "forked" && parentSessionRef) return ["--fork", parentSessionRef];
  return ["--no-session"];
}
