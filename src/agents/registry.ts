import { getAllIds, type SpecialistId } from "./catalog";

// Legacy AgentType — a fixed subset of the canonical catalog. The catalog
// includes scout, worker, and the review critics; these are available
// through pi-subagents but not listed here because this legacy type
// predates that roster growth and no longer maps directly to task dispatch.
//
// Extract<SpecialistId, ...> ties this to SpecialistId at the type level: if
// any of these seven ids is ever removed from SpecialistId (e.g. retiring
// another role, see ADR 0023), that arm collapses to `never` and every use
// site fails typecheck instead of silently continuing to accept a retired
// role name at runtime. This is the fix for the exact bug class ADR 0023's
// retirement of "reviewer" hit: this union used to be a plain hand-typed
// literal with no structural tie to SpecialistId, so removing "reviewer"
// from the catalog alone did not surface here — it required a separate,
// compiler-silent manual edit to catch.
type LegacyAgentTypeName = "explore" | "plan" | "build" | "designer" | "oracle" | "researcher" | "evaluator";
export type AgentType = Extract<SpecialistId, LegacyAgentTypeName>;

export const AGENT_TYPES: AgentType[] = ["explore", "plan", "build", "designer", "oracle", "researcher", "evaluator"];

export function getAllSubagentIds(): readonly SpecialistId[] {
  return getAllIds();
}
