// Detects which subagent role (if any) the current process is running as.
//
// Two env contracts feed this:
// - HARNESS_SUBAGENT: set by the dormant legacy `task` spawn path (see
//   buildSubagentEnv in ./execution.ts). "reviewer" for reviewer-typed legacy
//   runs; "1" for every other legacy type — a generic marker with no precise
//   role name attached.
// - PI_SUBAGENT_CHILD / PI_SUBAGENT_CHILD_AGENT: set by the live pi-subagents
//   engine on every child it spawns. PI_SUBAGENT_CHILD_AGENT carries the exact
//   agent name from that agent's frontmatter (e.g. "reviewer",
//   "reviewer-security", "evaluator", "explore", ...).
export interface ChildRoleEnv {
  HARNESS_SUBAGENT?: string;
  PI_SUBAGENT_CHILD?: string;
  PI_SUBAGENT_CHILD_AGENT?: string;
}

/** True when this process is any kind of subagent child — legacy or live. */
export function isSubagentProcess(env: ChildRoleEnv): boolean {
  return Boolean(env.HARNESS_SUBAGENT) || env.PI_SUBAGENT_CHILD === "1";
}

/**
 * The precise agent role name for this process, when knowable. The legacy
 * generic "1" marker carries no real role name and resolves to undefined;
 * legacy "reviewer" and any live PI_SUBAGENT_CHILD_AGENT value are returned
 * as-is.
 */
export function detectChildRole(env: ChildRoleEnv): string | undefined {
  const legacy = env.HARNESS_SUBAGENT;
  if (legacy && legacy !== "1") return legacy;
  return env.PI_SUBAGENT_CHILD_AGENT || undefined;
}
