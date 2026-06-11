import type { MemoryRecord } from "./types";

// Auto-capture was removed on purpose: pattern-matching prompts for "don't"/
// "do not" memorized one-off task instructions as durable preferences and
// replayed them into later sessions (see the reviewer-recursion incident).
// Memories are written only by deliberate edits to .harness/memory.json.

export function formatMemoriesForInjection(memories: MemoryRecord[]): string | null {
  if (memories.length === 0) return null;
  const lines = memories
    .slice(0, 10)
    .map((m) => `- ${m.correction}`)
    .join("\n");
  return [
    "## Remembered preferences for this project",
    "",
    lines,
    "",
    "Apply these preferences unless the user explicitly overrides them.",
  ].join("\n");
}
