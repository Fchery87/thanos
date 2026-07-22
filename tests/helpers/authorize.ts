import { GovernanceRuntime, type GovernanceContext } from "../../src/runtime/governance-runtime";
import { PermissionManager } from "../../src/permissions/manager";
import type { HarnessPolicy } from "../../src/policy/types";

/**
 * Test helper for the LIVE governance gate. `GovernanceRuntime.authorize` is the
 * real decision point wired into `pi.on("tool_call")` (register-harness) and the
 * subagent path (register-events). These helpers construct a context with safe
 * defaults so a test only states the fields it cares about.
 */

export const personalPolicy: HarnessPolicy = {
  version: 1,
  preset: "personal",
  rules: [],
  audit: { enabled: true },
  headless: { defaultDecision: "allow" },
};

export function makeGovContext(overrides: Partial<GovernanceContext> = {}): GovernanceContext {
  return {
    policy: personalPolicy,
    permissions: new PermissionManager(),
    yolo: false,
    autonomy: "attended",
    deliveryMode: undefined,
    childRole: undefined,
    specScope: undefined,
    hasUI: true,
    sessionId: "s1",
    agentType: "parent",
    recordAudit: async () => undefined,
    promptUser: async () => true,
    ...overrides,
  };
}

/** Run the live gate for one tool call with the given context overrides. */
export function authorizeVia(
  overrides: Partial<GovernanceContext>,
  toolName: string,
  input: Record<string, unknown>,
) {
  return new GovernanceRuntime(makeGovContext(overrides)).authorize(toolName, input);
}
