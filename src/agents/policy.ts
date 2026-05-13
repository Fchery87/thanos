import type { AgentType } from "./registry";
import type { HarnessPolicy } from "../policy/types";

const READ_ONLY_AGENTS: AgentType[] = ["explore", "plan", "reviewer"];

export function narrowPolicyForAgent(type: AgentType, policy: HarnessPolicy): HarnessPolicy {
  if (!READ_ONLY_AGENTS.includes(type)) return policy;
  return {
    ...policy,
    rules: [
      { id: "agent-deny-edit", capability: "edit", decision: "deny", reason: `${type} agents are read-only` },
      { id: "agent-deny-exec", capability: "exec", decision: "deny", reason: `${type} agents are read-only` },
      ...policy.rules,
    ],
  };
}
