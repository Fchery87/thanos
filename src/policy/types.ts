export type PolicyPreset = "personal" | "team" | "ci";
export type Capability = "read" | "edit" | "exec" | "task";
export type Decision = "allow" | "ask" | "deny";

export interface PolicyRule {
  id: string;
  capability: Capability | "*";
  pattern?: string;
  commandFamily?: string;
  decision: Decision;
  reason: string;
}

export interface HarnessPolicy {
  version: 1;
  preset: PolicyPreset;
  rules: PolicyRule[];
  audit: { enabled: boolean; path?: string };
  headless: { defaultDecision: Decision };
}
