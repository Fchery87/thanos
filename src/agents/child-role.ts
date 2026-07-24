// Detects which subagent role (if any) the current process is running as.
//
// PI_SUBAGENT_CHILD / PI_SUBAGENT_CHILD_AGENT: set by the live pi-subagents
// engine on every child it spawns. PI_SUBAGENT_CHILD_AGENT carries the exact
// agent name from that agent's frontmatter (e.g. "reviewer",
// "reviewer-security", "evaluator", "explore", ...).
export interface ChildRoleEnv {
  PI_SUBAGENT_CHILD?: string;
  PI_SUBAGENT_CHILD_AGENT?: string;
}

/** True when this process is a pi-subagents child. */
export function isSubagentProcess(env: ChildRoleEnv): boolean {
  return env.PI_SUBAGENT_CHILD === "1";
}

/** The precise agent role name for this process, when knowable. */
export function detectChildRole(env: ChildRoleEnv): string | undefined {
  return env.PI_SUBAGENT_CHILD_AGENT || undefined;
}
