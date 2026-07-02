// SCOPE: this registry governs ONLY the dormant legacy Thanos `task` tool
// (gated behind THANOS_LEGACY_TASK=1; see src/index.ts) and the `/modes`
// default selector. It is NOT the live subagent roster.
//
// The live roster is the set of agent/agents/*.md files dispatched by the
// pi-subagents engine (the `subagent` tool). That set is larger — it also
// includes `scout` and `worker`, which are pi-subagents-native: they depend on
// contact_supervisor/intercom wiring that the legacy executeTask path does not
// provide, so they are intentionally absent here. Do not "fix" this drift by
// adding them — they would run incorrectly through the legacy tool.
export type AgentType = "explore" | "plan" | "build" | "reviewer" | "designer" | "oracle" | "researcher" | "evaluator";

export const AGENT_TYPES: AgentType[] = ["explore", "plan", "build", "reviewer", "designer", "oracle", "researcher", "evaluator"];
