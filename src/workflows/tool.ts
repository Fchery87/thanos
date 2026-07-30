import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { captureRepositoryRevisionIdentity } from "./revision";
import type { RepositoryRevisionIdentity, WorkflowRuntime } from "./state";

export interface WorkflowYieldToolDeps {
  runtime: WorkflowRuntime;
  captureRevision?: (cwd: string) => Promise<RepositoryRevisionIdentity | undefined>;
}

export function registerWorkflowYieldTool(
  pi: Pick<ExtensionAPI, "registerTool">,
  deps: WorkflowYieldToolDeps,
): void {
  const capture = deps.captureRevision ?? captureRepositoryRevisionIdentity;
  pi.registerTool({
    name: "workflow_yield",
    label: "Yield Waves revision",
    description:
      "Assert that the current parent-owned Waves repository revision is ready for evidence settlement and jury review. This is not a completion claim.",
    promptSnippet: "Yield the exact Waves revision for jury review when integration is ready",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, toolCtx) {
      if (deps.runtime.current?.phase !== "integrating") {
        return {
          content: [{ type: "text" as const, text: "workflow_yield: Waves is not in the integrating phase." }],
          isError: true,
          details: undefined,
        };
      }
      const identity = await capture(toolCtx.cwd);
      if (!identity) {
        deps.runtime.pause("repository_revision_unavailable");
        return {
          content: [{
            type: "text" as const,
            text: "workflow_yield: repository revision identity is unavailable; Waves paused.",
          }],
          isError: true,
          details: undefined,
        };
      }
      const next = deps.runtime.yieldForReview(identity);
      if (next.phase === "paused") {
        return {
          content: [{ type: "text" as const, text: "workflow_yield: jury round budget exhausted; Waves paused." }],
          isError: true,
          details: undefined,
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: "Workflow yield recorded. At agent_end, Waves will verify revision freshness before launching the jury.",
        }],
        details: {
          kind: "thanos-workflow-yield",
          workflowId: next.workflowId,
          juryRound: next.juryRounds,
          revision: identity,
        },
      };
    },
  });
}
