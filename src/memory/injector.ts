import type { MemoryRecord } from "./types";

const CORRECTION_PATTERN =
  /\b(don'?t|never|avoid|stop|instead|prefer|always use|use .+? not|please don'?t|make sure (to )?not|do not)\b/i;

export function shouldSaveMemory(prompt: string): boolean {
  return CORRECTION_PATTERN.test(prompt);
}

export function extractCorrection(prompt: string): string {
  return prompt.slice(0, 300).trim();
}

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
