import type { RunProjection } from "../execution/projection";
import type { WorkflowRuntime, WorkflowSnapshot } from "./state";
import type {
  WorkflowCommand,
  WorkflowModule,
  WorkflowReceipt,
  WorkflowSignal,
  WorkflowView,
} from "./types";

/**
 * Construction-only dependencies. Authority-sensitive lifecycle signals stay
 * with their existing authority owners and fail closed without an adapter.
 */
export interface WorkflowModuleDependencies {
  runtime: WorkflowRuntime;
  inspectProjection?: () => RunProjection | undefined;
  handleApproval?: (signal: Extract<WorkflowSignal, { kind: "approval" }>, abort?: AbortSignal) => Promise<WorkflowReceipt>;
  handleParentTurnEnded?: (signal: Extract<WorkflowSignal, { kind: "parent_turn_ended" }>, abort?: AbortSignal) => Promise<WorkflowReceipt>;
  handleHandoff?: (signal: Extract<WorkflowSignal, { kind: "handoff" }>, abort?: AbortSignal) => Promise<WorkflowReceipt>;
  handleResume?: (signal: Extract<WorkflowSignal, { kind: "resume" }>, abort?: AbortSignal) => Promise<WorkflowReceipt>;
  handleGoalCompletionClaim?: (signal: Extract<WorkflowSignal, { kind: "goal_completion_claim" }>, abort?: AbortSignal) => Promise<WorkflowReceipt>;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function view(
  runtime: WorkflowRuntime,
  inspectProjection: (() => RunProjection | undefined) | undefined,
): WorkflowView | undefined {
  const snapshot = runtime.current;
  return snapshot === undefined
    ? undefined
    : {
      // Never expose an alias of authoritative in-memory state. Inspection is
      // observational and callers cannot mutate state outside dispatch().
      snapshot: copy(snapshot),
      ...(inspectProjection ? { projection: copy(inspectProjection()) } : {}),
    };
}

function settled(command: WorkflowCommand["kind"], snapshot: WorkflowSnapshot | undefined): WorkflowReceipt {
  return { state: "settled", command, ...(snapshot === undefined ? {} : { snapshot: copy(snapshot) }) };
}

function rejected(
  command: WorkflowCommand["kind"],
  reason: string,
  snapshot: WorkflowSnapshot | undefined,
): WorkflowReceipt {
  return {
    state: "rejected",
    command,
    reason,
    ...(snapshot === undefined ? {} : { snapshot: copy(snapshot) }),
  };
}

function unavailable(
  command: WorkflowCommand["kind"],
  signal: WorkflowSignal["kind"],
  runtime: WorkflowRuntime,
): WorkflowReceipt {
  return rejected(command, `workflow_signal_unavailable:${signal}`, runtime.current);
}

/**
 * Deep coordination seam for parent-owned Waves state. It deliberately
 * exposes one command entry point and one read entry point. Runtime-owned
 * transitions are serialized here; authority-sensitive signals remain explicit
 * construction-only adapters and otherwise fail closed.
 */
export function createWorkflowModule(dependencies: WorkflowModuleDependencies): WorkflowModule {
  const { runtime, inspectProjection } = dependencies;
  const receipts = new Map<string, Promise<WorkflowReceipt>>();
  let dispatchTail: Promise<void> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = dispatchTail.then(operation, operation);
    dispatchTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const signalReceipt = async (signal: WorkflowSignal, abort?: AbortSignal): Promise<WorkflowReceipt> => {
    const execute = async (): Promise<WorkflowReceipt> => {
      try {
        switch (signal.kind) {
          case "approval":
            return dependencies.handleApproval
              ? await dependencies.handleApproval(signal, abort)
              : unavailable("signal", signal.kind, runtime);
          case "parent_turn_ended":
            return dependencies.handleParentTurnEnded
              ? await dependencies.handleParentTurnEnded(signal, abort)
              : unavailable("signal", signal.kind, runtime);
          case "handoff":
            return dependencies.handleHandoff
              ? await dependencies.handleHandoff(signal, abort)
              : unavailable("signal", signal.kind, runtime);
          case "goal_completion_claim":
            return dependencies.handleGoalCompletionClaim
              ? await dependencies.handleGoalCompletionClaim(signal, abort)
              : unavailable("signal", signal.kind, runtime);
          case "yield":
            return settled("signal", runtime.yieldForReview(signal.yieldIdentity));
          case "pause":
            return settled("signal", runtime.pause(signal.reason));
          case "resume":
            return dependencies.handleResume
              ? await dependencies.handleResume(signal, abort)
              : unavailable("signal", signal.kind, runtime);
          case "cancel":
            return settled("signal", runtime.cancel(signal.reason));
        }
      } catch (error) {
        return rejected("signal", error instanceof Error ? error.message : String(error), runtime.current);
      }
    };
    return execute();
  };

  const dispatchSignal = (signal: WorkflowSignal, abort?: AbortSignal): Promise<WorkflowReceipt> => enqueue(async () => {
    if (abort?.aborted) return rejected("signal", "workflow_command_aborted", runtime.current);
    if (signal.id === undefined) return signalReceipt(signal, abort);
    // Scope after earlier queued lifecycle work settles. This keeps an id
    // reused by a replacement workflow distinct from its predecessor.
    const key = `${runtime.current?.workflowId ?? "none"}:${signal.id}`;
    const prior = receipts.get(key);
    if (prior) return copy(await prior);
    const pending = signalReceipt(signal, abort);
    receipts.set(key, pending);
    void pending.then((receipt) => {
      // Only direct state transitions can prove that a rejected receipt had
      // no side effect: their journal append threw before publication.
      // Construction adapters may have crossed an authority boundary before
      // rejecting, so retain their receipt and let that authority own retry.
      if (
        receipt.state === "rejected"
        && (signal.kind === "yield" || signal.kind === "pause" || signal.kind === "cancel")
        && receipts.get(key) === pending
      ) {
        receipts.delete(key);
      }
    });
    return copy(await pending);
  });


  return {
    async dispatch(command, abort): Promise<WorkflowReceipt> {
      if (abort?.aborted) return rejected(command.kind, "workflow_command_aborted", runtime.current);
      if (command.kind === "signal") return dispatchSignal(command.signal, abort);
      return enqueue(async () => {
        if (abort?.aborted) return rejected(command.kind, "workflow_command_aborted", runtime.current);
        try {
          switch (command.kind) {
            case "start":
              return settled(command.kind, runtime.start(command.request));
            case "restore":
              return settled(command.kind, runtime.reconstruct(command.entries, {
                pauseActiveReason: command.pauseActiveReason ?? "restore_requires_approval",
              }));
          }
        } catch (error) {
          return rejected(
            command.kind,
            error instanceof Error ? error.message : String(error),
            runtime.current,
          );
        }
      });
    },
    inspect(): WorkflowView | undefined {
      return view(runtime, inspectProjection);
    },
  };
}
