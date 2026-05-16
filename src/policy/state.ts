import { loadPolicy } from "./loader";
import type { HarnessPolicy } from "./types";

export type PolicyLoadState =
  | { kind: "ok"; policy: HarnessPolicy }
  | { kind: "error"; error: string };

export async function loadPolicyState(cwd: string, policyPath?: string): Promise<PolicyLoadState> {
  try {
    return { kind: "ok", policy: await loadPolicy(cwd, policyPath) };
  } catch (err) {
    return {
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
