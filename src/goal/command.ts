import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { GoalController } from "./controller";
import type { GoalEventRecord } from "./loop";
import type { GoalSnapshot } from "./types";
import { parseGoalCommand } from "./command-parse";
import { buildContinueDirective } from "./prompts";

/** Compact statusline segment for the active/paused goal, or undefined when
 *  there is no live goal (mirrors the `lens:<changed>` indicator pattern). */
export function renderGoalStatusSegment(snapshot: GoalSnapshot | undefined): string | undefined {
  if (!snapshot || snapshot.status === "achieved") return undefined;
  if (snapshot.status === "paused") return "◎ goal:paused";
  return `◎ goal:${snapshot.turnsEvaluated}t·${Math.round(snapshot.tokensUsed / 1000)}k`;
}

export interface GoalCommandDeps {
  controller: GoalController;
  isTrusted: () => boolean;
  getTokens: () => number;
  notify: (message: string, level?: "info" | "warning") => void;
  sendFollowUp: (text: string) => Promise<void>;
  recordEvent: (event: GoalEventRecord) => Promise<void>;
  /** Sync the controller's current state to on-disk persistence. Called
   *  directly by clear/pause/resume; `set` persists via `recordEvent`
   *  instead (recordGoalEvent already calls this internally), so it must
   *  not call syncState itself to avoid a double-write. */
  syncState: () => Promise<void>;
}

function formatStatus(deps: GoalCommandDeps, now: number): string {
  const s = deps.controller.snapshot();
  if (!s) return "◎ /goal — no active goal. Set one with `/goal <condition>`.";
  if (s.status === "achieved" && s.achieved) {
    return `◎ /goal achieved — ${s.achieved.reason} (in ${s.achieved.turns} turns).`;
  }
  const elapsedMin = Math.max(0, Math.round((now - s.startedAt) / 60000));
  const lines = [
    `◎ /goal ${s.status} — ${s.condition}`,
    `  turns evaluated: ${s.turnsEvaluated} · context growth: ~${Math.round(s.tokensUsed / 1000)}k tok · elapsed: ${elapsedMin}m`,
  ];
  if (s.lastReason) lines.push(`  last check: ${s.lastReason}`);
  if (s.status === "paused") lines.push("  Run `/goal resume` to continue.");
  return lines.join("\n");
}

/**
 * Pure-ish command dispatch, testable with fakes. The register wrapper binds
 * `deps` to the live command context.
 */
export async function runGoalCommand(args: string, deps: GoalCommandDeps): Promise<void> {
  const command = parseGoalCommand(args);

  // Trust gate applies to any state-changing verb (not status).
  if (command.type !== "status" && !deps.isTrusted()) {
    deps.notify("◎ /goal refused: this project is not trusted. Trust it first, then retry.", "warning");
    return;
  }

  switch (command.type) {
    case "status":
      deps.notify(formatStatus(deps, Date.now()));
      return;
    case "clear": {
      const had = deps.controller.snapshot() !== undefined;
      deps.controller.clear();
      // Unconditional: even when memory had nothing to clear, a stale
      // on-disk file from a prior session (never loaded into this one)
      // should still be wiped rather than left to resurrect on restart.
      await deps.syncState();
      deps.notify(had ? "◎ /goal cleared." : "◎ /goal — nothing to clear.");
      return;
    }
    case "pause": {
      const paused = deps.controller.pause();
      if (paused) await deps.syncState();
      deps.notify(paused ? "◎ /goal paused. Run `/goal resume` to continue." : "◎ /goal — no active goal to pause.", deps.controller.snapshot()?.status === "paused" ? "warning" : "info");
      return;
    }
    case "resume": {
      if (!deps.controller.resume()) {
        deps.notify("◎ /goal — no paused goal to resume.");
        return;
      }
      await deps.syncState();
      deps.notify("◎ /goal resumed.");
      // Re-kick the loop: it only advances on agent-end, so without a
      // directive here nothing happens until the user types something. The
      // condition, rules, and completion protocol ride in the system prompt
      // (buildGoalSystemPrompt) every active-goal turn, so the continuation
      // directive is the same terse nudge the per-turn loop sends.
      await deps.sendFollowUp(buildContinueDirective());
      return;
    }
    case "set": {
      const result = deps.controller.set(command.condition, deps.getTokens());
      if (result.ok) {
        const replacedNote = result.replaced ? " (replaced the previous goal)" : "";
        deps.notify(`◎ /goal active${replacedNote} — I will keep working until it is met. Permission prompts still apply and will pause the loop until answered.`);
        await deps.recordEvent({ type: "goal_set", summary: command.condition, outcome: "active" });
        await deps.sendFollowUp(result.firstDirective);
      } else {
        // strict:false in tsconfig disables false-branch discriminant narrowing,
        // so read `error` off the failure variant explicitly.
        deps.notify(`◎ /goal not set: ${(result as { ok: false; error: string }).error}`, "warning");
      }
      return;
    }
  }
}

export interface RegisterGoalDeps {
  controller: GoalController;
  isSubagent: boolean;
  sendFollowUp: (text: string) => Promise<void>;
  recordEvent: (event: GoalEventRecord) => Promise<void>;
  syncState: () => Promise<void>;
}

export function registerGoalCommand(pi: ExtensionAPI, deps: RegisterGoalDeps): void {
  pi.registerCommand("goal", {
    description: "Set a self-checking goal; the agent keeps working until a fresh evaluator confirms it (/goal <condition> | pause | resume | clear).",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (deps.isSubagent) {
        ctx.ui.notify("/goal is only available in the main session.", "warning");
        return;
      }
      await runGoalCommand(args, {
        controller: deps.controller,
        isTrusted: () => ctx.isProjectTrusted(),
        getTokens: () => ctx.getContextUsage()?.tokens ?? 0,
        notify: (message, level) => ctx.ui.notify(message, level ?? "info"),
        sendFollowUp: deps.sendFollowUp,
        recordEvent: deps.recordEvent,
        syncState: deps.syncState,
      });
      ctx.ui.setStatus("harness-goal", renderGoalStatusSegment(deps.controller.snapshot()));
    },
  });
}
