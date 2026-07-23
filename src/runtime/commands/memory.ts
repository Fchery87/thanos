import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MemoryStore, MAX_MEMORY_LENGTH, isSaveSuccess } from "../../memory/store";

/**
 * Open the current project's memory store. The only write path into
 * .harness/memory.json (auto-capture was removed after it memorized one-off
 * instructions as durable preferences). Used by /remember, /memory, and
 * before_agent_start's memory-injection (parent sessions only, so a subagent
 * can never plant a memory).
 */
export function projectMemory() {
  return {
    store: MemoryStore.open(join(process.cwd(), ".harness", "memory.json")),
    project: process.cwd().split("/").pop() ?? "unknown",
  };
}

/** /remember + /memory — hand-curated project preferences. Parent sessions only. */
export function registerMemoryCommands(pi: ExtensionAPI): void {
  pi.registerCommand("remember", {
    description: "Save a durable project preference, injected into future sessions",
    handler: async (args, ctx) => {
      const { store, project } = projectMemory();
      const result = store.save({ project, text: args });
      if (isSaveSuccess(result)) {
        ctx.ui.notify(`Remembered for ${project}: ${result.record.text}`, "info");
      } else if (result.reason === "empty") {
        ctx.ui.notify("Usage: /remember <preference>", "warning");
      } else if (result.reason === "too-long") {
        ctx.ui.notify(`Memory too long (max ${MAX_MEMORY_LENGTH} chars) — distill it first.`, "warning");
      } else {
        ctx.ui.notify("Already remembered — see /memory.", "warning");
      }
    },
  });

  pi.registerCommand("memory", {
    description: "List remembered project preferences; `/memory forget <n>` removes one",
    getArgumentCompletions: (prefix) =>
      "forget".startsWith(prefix) ? [{ value: "forget", label: "forget <n>" }] : null,
    handler: async (args, ctx) => {
      const { store, project } = projectMemory();
      const memories = store.query({ project, limit: 50 });
      const trimmed = args.trim();
      if (trimmed === "") {
        if (memories.length === 0) {
          ctx.ui.notify(`No memories for ${project}. Add one with /remember <preference>.`, "info");
          return;
        }
        const lines = memories.map((m, i) => `${i + 1}. ${m.text}`);
        ctx.ui.notify(`Memories for ${project} (newest first; first 10 are injected):\n${lines.join("\n")}`, "info");
        return;
      }
      const match = /^forget\s+(\d+)$/.exec(trimmed);
      if (!match) {
        ctx.ui.notify("Usage: /memory  or  /memory forget <n>", "warning");
        return;
      }
      const target = memories[Number(match[1]) - 1];
      if (!target) {
        ctx.ui.notify(`No memory #${match[1]} — run /memory to see the list.`, "warning");
        return;
      }
      store.remove(target.id);
      ctx.ui.notify(`Forgot: ${target.text}`, "info");
    },
  });
}
