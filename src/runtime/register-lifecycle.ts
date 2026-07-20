import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedDelivery } from "../governance/delivery";
import type { HarnessPolicy } from "../policy/types";
import type { SessionRuntime } from "../runtime/session-runtime";
import type { GovernanceRuntime } from "../runtime/governance-runtime";

export function registerLifecycle(
  pi: ExtensionAPI,
  session: SessionRuntime,
  getDelivery: () => Promise<ResolvedDelivery | undefined>,
  getPolicy: () => Promise<{ kind: "ok"; policy: HarnessPolicy } | { kind: "error"; error: string }>,
) {
  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    const delivery = await getDelivery();
    const policyState = await getPolicy();

    if (delivery) {
      session.configureDelivery(delivery);
    }
    if (policyState.kind === "ok") {
      session.configurePolicy(policyState.policy);
    } else {
      ctx.ui.notify(`Policy error: ${policyState.error}`, "warning");
    }

    session.transition("policy_ready");
  });
}
