import { readFile } from "node:fs/promises";
import { gradePromptCase, summarizePromptGrades, validatePromptFamilies } from "../evals/prompts/graders.ts";

const text = await readFile(new URL("../evals/prompts/cases.jsonl", import.meta.url), "utf8");
const cases = text
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const grades = cases.map(gradePromptCase);
const families = [
  "project-description-injection",
  "memory-injection",
  "goal-delimiter-and-sentinel-injection",
  "tool-output-evaluator-injection",
  "malformed-subagent-contracts",
  "role-capability-contradictions",
  "multi-deliverable-contract-extraction",
  "missing-evidence-completion-attempts",
  "unnecessary-delegation",
  "jury-and-waves-stage-failures",
];

console.log(JSON.stringify({
  cases: cases.length,
  families: [...new Set(cases.map((item) => item.family))],
  summary: summarizePromptGrades(cases),
  familyCheck: validatePromptFamilies(cases, families),
  grades,
}));
