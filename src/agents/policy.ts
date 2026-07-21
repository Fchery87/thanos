import type { AgentType } from "./registry";
import type { HarnessPolicy } from "../policy/types";
import { agentWrites as catalogWrites, agentExecutes, readOnlyAgentIds, type SpecialistId } from "./catalog";

export function agentWrites(type: AgentType | string): boolean {
  return catalogWrites(type);
}

export function narrowPolicyForAgent(type: AgentType, policy: HarnessPolicy): HarnessPolicy {
  const id = type as SpecialistId;
  const rules = [...policy.rules];

  if (readOnlyAgentIds().includes(id)) {
    if (!agentExecutes(type)) {
      rules.unshift({ id: "agent-deny-exec", capability: "exec", decision: "deny", reason: `${type} agents cannot execute commands` });
    }
    rules.unshift({ id: "agent-deny-edit", capability: "edit", decision: "deny", reason: `${type} agents are read-only` });
    return { ...policy, rules };
  }
  if (type === "designer") {
    rules.unshift({ id: "agent-deny-exec", capability: "exec", decision: "deny", reason: "designer agents cannot execute commands" });
    return { ...policy, rules };
  }
  return policy;
}
