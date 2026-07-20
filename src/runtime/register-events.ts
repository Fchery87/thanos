import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { GovernanceRuntime, type GovernanceContext } from "./governance-runtime";
import { ContinuationArbiter } from "./continuation-arbiter";
import { SessionRuntime } from "./session-runtime";
import { AuditLogger } from "../audit/logger";

export function setupRuntime(
  pi: ExtensionAPI,
  session: SessionRuntime,
  getDelivery: () => Promise<any>,
  getPolicyState: () => Promise<any>,
  isSubagent: boolean,
  sessionId: string,
  agentType: "parent" | "subagent",
  permissions: any,
  spec: any,
  lens: any,
  goalController: any,
  recordGoalEvent: (e: any) => Promise<void>,
) {
  const arbiter = new ContinuationArbiter();

  pi.on("tool_call", async (event: any, ctx: ExtensionContext) => {
    const policyState = await getPolicyState();
    if (policyState.kind === "error") {
      return { block: true, reason: `Policy configuration error: ${policyState.error}` };
    }

    const delivery = await getDelivery();
    const auditLogger = policyState.policy.audit.enabled
      ? new AuditLogger(policyState.policy.audit.path ?? join(process.cwd(), ".harness", "audit.jsonl"))
      : undefined;

    const govCtx: GovernanceContext = {
      policy: policyState.policy,
      permissions,
      yolo: permissions.isYolo,
      autonomy: delivery?.autonomy ?? "attended",
      deliveryMode: delivery?.mode,
      childRole: undefined,
      hasUI: ctx.hasUI,
      sessionId,
      agentType,
      recordAudit: async (e) => auditLogger?.record(e),
      promptUser: (msg: string) => ctx.ui.confirm("Permission Required", msg),
    };

    const gov = new GovernanceRuntime(govCtx);
    const decision = await gov.authorize(event.toolName, event.input);
    if (decision.block) {
      return { block: true, reason: decision.reason ?? "governance block" };
    }

    // Lens Lite check
    const lensResult = await lens.beforeTool(event, ctx);
    if (lensResult?.block) return lensResult;

    // Snapshot for critical operations
    if (!permissions.isYolo && decision.snapshotNeeded) {
      const { createSnapshot } = await import("../security/snapshot");
      await createSnapshot(process.cwd());
    }
  });

  pi.on("agent_end", async (event: any, ctx: ExtensionContext) => {
    const results = spec.finishTurn(event.messages, { aborted: false });
    if (results.length > 0) {
      ctx.ui.notify(`Spec: ${results.filter((r: any) => r.passed).length}/${results.length} passed`, "info");
    }

    const decision = arbiter.decide({
      results,
      gateAttempts: spec.gateAttempts,
      isSubagent,
      gateEnabled: true,
      goalActive: goalController.isActive(),
      aborted: false,
      hasUI: ctx.hasUI,
      turnCount: 0,
      maxTurns: 100,
    });

    if (decision === "continue_spec") {
      spec.recordGateAttempt();
    }
  });
}
