import { getAllIds, type SpecialistId } from "./catalog";

// Legacy AgentType — derived from the canonical catalog.
// The catalog includes scout, worker, and the review critics; these are
// available through pi-subagents but not listed here because the legacy
// type is referenced by the /modes selector and post-subagent-removal
// it no longer maps directly to task dispatch.
export type AgentType = "explore" | "plan" | "build" | "reviewer" | "designer" | "oracle" | "researcher" | "evaluator";

export const AGENT_TYPES: AgentType[] = ["explore", "plan", "build", "reviewer", "designer", "oracle", "researcher", "evaluator"];

export function getAllSubagentIds(): readonly SpecialistId[] {
  return getAllIds();
}
