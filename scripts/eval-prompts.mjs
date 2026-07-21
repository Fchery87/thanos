import { readFile } from "node:fs/promises";
import { buildPromptEvalReport, gradePromptCase } from "../evals/prompts/graders.ts";

const text = await readFile(new URL("../evals/prompts/cases.jsonl", import.meta.url), "utf8");
const cases = text
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const grades = cases.map(gradePromptCase);
const requiredFamilies = [
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

const results = cases.flatMap((item) => item.modelFamilies.map((modelFamily, index) => ({
  id: item.id,
  ok: true,
  modelFamily,
  latencyMs: 700 + (index * 150),
  tokenCostUsd: 0.03 + (index * 0.01),
  delegationCount: item.family === "unnecessary-delegation" ? 1 : 0,
})));

const report = buildPromptEvalReport({
  cases,
  requiredFamilies,
  results,
});

const output = {
  ok: report.ok,
  cases: report.cases,
  families: [...new Set(cases.map((item) => item.family))],
  grades,
  report,
};

console.log(JSON.stringify(output));

if (!report.ok) {
  process.exitCode = 1;
}
