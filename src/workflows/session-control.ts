import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorkflowRuntime, WorkflowSnapshot } from "./state";

function isNonterminal(snapshot: WorkflowSnapshot | undefined): boolean {
  return snapshot !== undefined
    && snapshot.phase !== "completed"
    && snapshot.phase !== "cancelled"
    && snapshot.phase !== "handed_off";
}

export function registerWorkflowSessionGuards(
  pi: Pick<ExtensionAPI, "on">,
  runtime: WorkflowRuntime,
): void {
  const guard = () => isNonterminal(runtime.current) ? { cancel: true as const } : undefined;
  pi.on("session_before_switch", guard);
  pi.on("session_before_fork", guard);
  pi.on("session_before_tree", guard);
}
