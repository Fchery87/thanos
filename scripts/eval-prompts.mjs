import { readFile } from "node:fs/promises";

const text = await readFile(new URL("../evals/prompts/cases.jsonl", import.meta.url), "utf8");
const cases = text
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

console.log(JSON.stringify({ cases: cases.length, families: [...new Set(cases.map((item) => item.family))] }));
