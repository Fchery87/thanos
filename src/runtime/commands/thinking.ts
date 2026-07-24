import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  ALL_THINKING_LEVELS,
  promptAndSetThinkingLevel,
  setThinkingStatus,
  type ThinkingLevel,
} from "../thinking-levels";

/**
 * /thinking command + the ctrl+shift+k shortcut that mirrors it (both select
 * a reasoning effort level for the current model; extracted together since
 * the shortcut is just the command's no-explicit-level branch).
 */
export function registerThinkingCommand(pi: ExtensionAPI): void {
  pi.registerCommand("thinking", {
    description: "Select reasoning effort level for the current model",
    getArgumentCompletions: (prefix) => {
      const filtered = ALL_THINKING_LEVELS.filter((l) => l.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim() as ThinkingLevel;
      if (ALL_THINKING_LEVELS.includes(trimmed)) {
        pi.setThinkingLevel(trimmed);
        setThinkingStatus(pi, ctx);
        ctx.ui.notify(`Thinking: ${trimmed}`, "info");
        return;
      }
      await promptAndSetThinkingLevel(pi, ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+k", {
    description: "Select thinking level",
    handler: async (ctx) => {
      await promptAndSetThinkingLevel(pi, ctx);
    },
  });
}
