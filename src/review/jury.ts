export function buildJuryPrompt(): string {
  return [
    "Review this change with one child task and one result contract.",
    "",
    "Ask the reviewer family to produce structured findings:",
    "- `reviewer-correctness`: correctness bugs, regressions, and broken invariants.",
    "- `reviewer-security`: security, privacy, policy bypass, and trust-boundary risks.",
    "- `reviewer-tests`: missing, weak, or misleading verification.",
    "",
    "Then run `oracle` as a devil's advocate. It must challenge the critic panel, mark each finding KEEP/WEAKEN/DROP, and raise missed risks even if every critic reports no findings.",
    "",
    "You are the judge and synthesizer. After all results return, de-duplicate overlapping findings, rank by P0-P3 severity, explain any dropped weak findings briefly, and emit one verdict: APPROVE, COMMENT, or REQUEST_CHANGES.",
  ].join("\n");
}
