import type { WaveSlice } from "./types";
import { buildPromptSections, renderCompletionCriteria } from "../prompts/style";

export function buildWaveWorkerPrompt(slice: WaveSlice, overallGoal: string): string {
  const writeRules = slice.mode === "write"
    ? ["- Own only these paths.", "- Return one handoff only."]
    : [];

  return buildPromptSections([
    { heading: "Question", body: "What should one worker do inside a bounded WAVES run?" },
    { heading: "Mental model", body: "Work only this slice and treat missing evidence as a blocker." },
    { heading: "Scope", body: [`Overall goal: ${overallGoal}`, `Slice id: ${slice.id}`, `Slice goal: ${slice.goal}`, `Mode: ${slice.mode}`].join("\n") },
    { heading: "Paths/sources", body: slice.paths.map((path) => `- ${path}`).join("\n") },
    { heading: "Scope boundaries", body: [`- Work only on this slice.`, `- Do not broaden the task.`, `- If evidence is missing, use the cite-or-drop rule: cite concrete evidence or drop the claim.`, ...writeRules].join("\n") },
    { heading: "Check", body: renderCompletionCriteria(["return only the handoff", "include status, evidence, and follow-ups"]) },
    { heading: "Required handoff format", body: ["Status: success | partial | blocked", "Slice:", "Key findings:", "Evidence:", "Open questions:", "Suggested follow-ups:", "Confidence: high | medium | low"].join("\n") },
  ]);
}
