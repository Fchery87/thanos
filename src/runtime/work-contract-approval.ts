import type { SpecEngine } from "../spec/engine";
import { formatSpecForApproval, type TUITheme } from "../ui-utils";

export interface WorkContractApprovalContext {
  repoDir: string;
  runId: string;
  hasUI: boolean;
  theme: TUITheme;
  confirm: (title: string, message: string) => Promise<boolean>;
}

export type WorkContractApprovalResult =
  | { approved: true }
  | { approved: false; reason: string };

export async function approvePendingWorkContract(
  spec: SpecEngine,
  ctx: WorkContractApprovalContext,
): Promise<WorkContractApprovalResult> {
  await spec.settleContract();
  const active = spec.activeSpec;
  if (!active || active.tier !== "explicit") {
    return { approved: false, reason: "no explicit Work Contract is active" };
  }
  if (active.approvalStatus === "approved") return { approved: true };
  if (active.approvalStatus !== "pending") {
    return { approved: false, reason: `Work Contract is ${active.approvalStatus}` };
  }
  if (!ctx.hasUI) {
    return { approved: false, reason: "explicit Work Contract needs approval but no UI is available" };
  }

  const approved = await ctx.confirm(
    "Spec Approval Required",
    formatSpecForApproval(active, ctx.theme),
  );
  if (!approved) {
    spec.rejectActiveSpec();
    return { approved: false, reason: `user rejected Work Contract: ${active.goal}` };
  }

  if (!await spec.approveWorkContract(ctx.repoDir, ctx.runId)) {
    return {
      approved: false,
      reason: "approved Work Contract could not establish a fail-closed Repository Baseline and canonical target roots",
    };
  }
  return { approved: true };
}
