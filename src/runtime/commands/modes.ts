import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskParams } from "../../agents/task-tool";
import { AGENT_TYPES } from "../../agents/registry";

export interface ModesCommandDeps {
  getDefaultTaskType: () => TaskParams["type"] | undefined;
  setDefaultTaskType: (type: NonNullable<TaskParams["type"]>) => void;
}

/** /modes — choose the default specialist subagent mode for this session. */
export function registerModesCommand(pi: ExtensionAPI, deps: ModesCommandDeps): void {
  pi.registerCommand("modes", {
    description: "Choose the default specialist subagent for this session",
    getArgumentCompletions: (prefix) => {
      const filtered = (AGENT_TYPES as readonly string[]).filter((mode) => mode.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const explicit = (AGENT_TYPES as readonly string[]).includes(trimmed) ? (trimmed as NonNullable<TaskParams["type"]>) : undefined;
      if (!ctx.hasUI && !explicit) {
        ctx.ui.notify("Modes selector requires an interactive UI", "warning");
        return;
      }

      const selected = explicit ?? (await ctx.ui.select("Choose a default subagent mode", [...AGENT_TYPES]));
      if (!selected) return;
      deps.setDefaultTaskType(selected as NonNullable<TaskParams["type"]>);
      ctx.ui.setStatus("harness-mode", ctx.ui.theme.fg("accent", `modes:${selected}`));
      ctx.ui.notify(`Default subagent mode: ${selected}`, "info");
    },
  });
}
