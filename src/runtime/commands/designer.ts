import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DESIGNER_GOAL_OPTIONS = [
  "Implement UI changes — read the codebase, build components, cover all states",
  "Review UI code — check for accessibility gaps, missing states, AI slop patterns",
  "Audit design system — extract tokens, document inconsistencies, suggest consolidation",
];

/**
 * /designer command + its ctrl+shift+d shortcut twin — both delegate to the
 * designer subagent via pi-subagents (unified delegation + rich render).
 * Registered together since they share runDesignerAgent + the goal options.
 */
export function registerDesignerCommand(pi: ExtensionAPI, isSubagent: boolean): void {
  const runDesignerAgent = async (goal: string, ctx: ExtensionContext) => {
    if (isSubagent) {
      ctx.ui.notify("Designer is only available in the main session.", "warning");
      return;
    }
    ctx.ui.notify("Delegating to the designer subagent…", "info");
    // Route through the pi-subagents engine (unified delegation + rich render).
    await pi.sendUserMessage(
      `Use the \`subagent\` tool to run the \`designer\` agent on this task: ${goal}`,
      { deliverAs: "followUp" },
    );
  };

  pi.registerCommand("designer", {
    description: "Spawn the Designer subagent for UI/UX implementation, review, or design-system audit",
    getArgumentCompletions: (prefix) => {
      if (prefix.trim().length > 0) return null;
      return DESIGNER_GOAL_OPTIONS.map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const explicitGoal = args.trim();
      if (explicitGoal) {
        await runDesignerAgent(explicitGoal, ctx);
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("Pass a goal: /designer <goal>", "warning");
        return;
      }
      const goal = await ctx.ui.select("What should the designer do?", DESIGNER_GOAL_OPTIONS);
      if (!goal) return;
      await runDesignerAgent(goal, ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+d", {
    description: "Spawn designer — UI/UX implementation and review",
    handler: async (ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Pass a goal: /designer <goal>", "warning");
        return;
      }
      const goal = await ctx.ui.select("What should the designer do?", DESIGNER_GOAL_OPTIONS);
      if (!goal) return;
      await runDesignerAgent(goal, ctx);
    },
  });
}
