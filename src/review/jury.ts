export function buildJuryPrompt(): string {
  return [
    "Use the `subagent` tool to run a heterogeneous review jury on the code changes in this session.",
    "",
    "Dispatch the critic panel in parallel:",
    "- `reviewer-correctness`: correctness bugs, regressions, and broken invariants.",
    "- `reviewer-security`: security, privacy, policy bypass, and trust-boundary risks.",
    "- `reviewer-tests`: missing, weak, or misleading verification.",
    "",
    "Then run `oracle` as an always-on devil's advocate. It must challenge the critic panel, mark each finding KEEP/WEAKEN/DROP, and raise missed risks even if every critic reports no findings.",
    "",
    "You are the judge and synthesizer. Do not write findings yourself before the critics report. After all results return, run a synthesis pass: de-duplicate overlapping findings, rank by P0-P3 severity, explain any dropped weak findings briefly, and emit one verdict: APPROVE, COMMENT, or REQUEST_CHANGES.",
  ].join("\n");
}
