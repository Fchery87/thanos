import type { AgentType } from "./registry";
import type { HarnessPolicy } from "../policy/types";

const READ_ONLY_AGENTS: AgentType[] = ["explore", "plan", "reviewer", "oracle", "researcher"];

// Evaluator is verification-only: it may exec (to re-run tests and grade
// evidence) but never edits — so it is not a writer and gets no worktree.
const NON_WRITING_AGENTS: AgentType[] = [...READ_ONLY_AGENTS, "evaluator"];

export function agentWrites(type: AgentType): boolean {
  return !NON_WRITING_AGENTS.includes(type);
}

export function narrowPolicyForAgent(type: AgentType, policy: HarnessPolicy): HarnessPolicy {
  if (READ_ONLY_AGENTS.includes(type)) {
    return { ...policy, rules: [
      { id: "agent-deny-edit", capability: "edit", decision: "deny", reason: `${type} agents are read-only` },
      { id: "agent-deny-exec", capability: "exec", decision: "deny", reason: `${type} agents are read-only` },
      ...policy.rules,
    ]};
  }
  if (type === "designer") {
    return { ...policy, rules: [
      { id: "agent-deny-exec", capability: "exec", decision: "deny", reason: "designer agents cannot execute commands" },
      ...policy.rules,
    ]};
  }
  if (type === "evaluator") {
    return { ...policy, rules: [
      { id: "agent-deny-edit", capability: "edit", decision: "deny", reason: "evaluator agents verify but never edit" },
      ...policy.rules,
    ]};
  }
  return policy;
}
