import type { WaveSlice } from "./types";

export function buildWaveWorkerPrompt(slice: WaveSlice, overallGoal: string): string {
  const writeRules = slice.mode === "write"
    ? [
        "",
        "Write-slice ownership:",
        "- Own only these paths.",
        "- Do not revert sibling work.",
        "- Do not spawn subagents.",
      ]
    : [];

  return [
    "You are one worker in a bounded WAVES run.",
    "",
    `Overall goal: ${overallGoal}`,
    `Slice id: ${slice.id}`,
    `Slice goal: ${slice.goal}`,
    `Mode: ${slice.mode}`,
    "",
    "Paths/sources:",
    ...slice.paths.map((path) => `- ${path}`),
    "",
    "Scope boundaries:",
    "- Work only on this slice.",
    "- Do not broaden the task.",
    "- If evidence is missing, use the cite-or-drop rule: cite concrete evidence or drop the claim.",
    ...writeRules,
    "",
    "Required handoff format:",
    "Status: success | partial | blocked",
    "Slice:",
    "Key findings:",
    "Evidence:",
    "Open questions:",
    "Suggested follow-ups:",
    "Confidence: high | medium | low",
    "",
    "Return only the handoff.",
  ].join("\n");
}
