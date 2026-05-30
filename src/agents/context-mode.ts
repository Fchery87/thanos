import type { AgentType } from "./registry";

export type ContextMode = "fresh" | "forked";

// Continuity roles may inherit the parent's context; everything else is
// adversarial/read-only and must run fresh to stay unbiased (see ADR 0004).
const CONTINUITY_ROLES: AgentType[] = ["build", "designer"];

export function resolveContextMode(type: AgentType, requested: ContextMode | undefined): ContextMode {
  if (requested === undefined) return "fresh";
  if (requested === "fresh") return "fresh";
  // requested === "forked"
  if (!CONTINUITY_ROLES.includes(type)) {
    throw new Error(
      `Agent "${type}" may not run in forked context: forked is limited to continuity roles (${CONTINUITY_ROLES.join(", ")}). See ADR 0004.`,
    );
  }
  return "forked";
}
