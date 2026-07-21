import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatMemoriesForInjection } from "../src/memory/injector.ts";
import { formatRoster, loadRoster } from "../src/agents/roster.ts";
import { buildGoalSystemPrompt, buildEvaluatorContext } from "../src/goal/prompts.ts";
import { buildEvaluatorPrompt } from "../src/spec/evaluator.ts";
import { buildWaveWorkerPrompt } from "../src/waves/prompt.ts";
import { extractTaskContract } from "../src/spec/contract-extractor.ts";
import { parseSubagentResult } from "../src/agents/result.ts";

const outputPath = join(process.cwd(), ".harness", "benchmark-results.json");
const fixturePath = new URL("../tests/fixtures/prompts/representative-requests.json", import.meta.url);
const requests = JSON.parse(await readFile(fixturePath, "utf8"));
const contractFixturePath = new URL("../tests/fixtures/contracts/requests.json", import.meta.url);
const contractFixtures = JSON.parse(await readFile(contractFixturePath, "utf8"));

function tokenEstimate(text) {
  return Math.ceil(text.length / 4);
}

function record(name, text) {
  return {
    name,
    chars: text.length,
    estimatedTokens: tokenEstimate(text),
  };
}

function recordScore(name, score) {
  return { name, score };
}

function stripFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return text;
  const closing = lines.slice(1).findIndex((line) => line === "---");
  if (closing < 0) return text;
  return lines.slice(closing + 2).join("\n");
}

const roster = await loadRoster();
const rosterBlock = formatRoster(roster);
const promptResults = [];

promptResults.push(record("memory injection (0)", formatMemoriesForInjection([]) ?? ""));
promptResults.push(record("memory injection (10)", formatMemoriesForInjection(Array.from({ length: 10 }, (_, index) => ({ text: `Preference ${index + 1}` }))) ?? ""));
promptResults.push(record("roster block", rosterBlock));

for (const agentType of ["build", "designer", "evaluator", "explore", "oracle", "plan", "researcher", "reviewer", "scout", "worker"]) {
  const raw = await readFile(new URL(`../agent/agents/${agentType}.md`, import.meta.url), "utf8");
  promptResults.push(record(`agent prompt: ${agentType}`, stripFrontmatter(raw)));
}

promptResults.push(record("goal system prompt", buildGoalSystemPrompt("All tests pass")));
promptResults.push(record("goal evaluator context", JSON.stringify(buildEvaluatorContext({ condition: "All tests pass", assistantClaim: "done", toolResultsText: "exit 0" }))));
promptResults.push(record("spec evaluator prompt", buildEvaluatorPrompt({ goal: "Add pagination", criteria: [{ id: "c1", statement: "Tests pass", evidenceRequired: ["test"] }] })));
promptResults.push(record("waves prompt", buildWaveWorkerPrompt({ id: "docs", agent: "explore", goal: "Audit docs", paths: ["docs"], mode: "read" }, "Strengthen the harness")));

const contractSamples = requests.map((request) => ({
  request,
  contract: extractTaskContract(request),
}));

for (const sample of contractSamples) {
  promptResults.push(record(`contract extraction: ${sample.request}`, JSON.stringify(sample.contract)));
}

const extractionHits = contractFixtures.filter((item) => {
  const contract = extractTaskContract(item.prompt);
  return item.expectedKinds.every((expected) => contract.criteria.some((criterion) => criterion.kind === expected))
    && item.forbiddenKinds.every((forbidden) => contract.criteria.every((criterion) => criterion.kind !== forbidden));
}).length;
promptResults.push(recordScore("contract extraction accuracy", extractionHits / contractFixtures.length));

const resultFixtures = [
  JSON.stringify({ version: 1, status: "success", summary: "ok", findings: [], artifacts: [], escalations: [] }),
  JSON.stringify({ summary: "missing version" }),
  "plain text",
];
const resultHits = resultFixtures.map((fixture) => parseSubagentResult(fixture)).filter((result, index) => {
  if (index === 0) return result.status === "success";
  return result.status === "error";
}).length;
promptResults.push(recordScore("subagent contract adherence", resultHits / resultFixtures.length));

await mkdir(join(process.cwd(), ".harness"), { recursive: true });
await writeFile(outputPath, JSON.stringify({
  generatedAt: "deterministic",
  results: promptResults,
}, null, 2), "utf8");

console.log(JSON.stringify({ outputPath, results: promptResults.length }));
