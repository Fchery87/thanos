export function buildWavesCommandPrompt(goal: string): string {
  return [
    "Run a bounded WAVES orchestration for this goal.",
    "",
    `Goal: ${goal}`,
    "",
    "Do not immediately spawn arbitrary workers. First discover the problem shape, then draft a bounded wave plan.",
    "validate independence, path ownership, wave width, and max depth before fan-out.",
    "Use the subagent tool in parallel only for approved independent slices.",
    "Require each worker to return the structured wave handoff with evidence and confidence.",
    "Require verified handoffs before synthesis. Reject missing evidence, low confidence, and conflicting status until resolved.",
    "synthesize one final answer with the strongest findings, dropped weak claims, open risks, and recommended next action.",
  ].join("\n");
}
