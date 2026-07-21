#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OUTPUT = join(process.cwd(), ".harness", "benchmark-results.json");

interface Metric {
  name: string;
  value: number;
  unit: string;
  timestamp: string;
}

async function main() {
  const metrics: Metric[] = [];
  const now = () => new Date().toISOString();

  // Architectural metrics
  const srcIndex = Bun.file(join(process.cwd(), "src", "index.ts"));
  const content = await srcIndex.text();
  const lines = content.split("\n").length;
  const imports = content.match(/^import /gm)?.length ?? 0;

  metrics.push({ name: "src/index.ts lines", value: lines, unit: "lines", timestamp: now() });
  metrics.push({ name: "src/index.ts imports", value: imports, unit: "count", timestamp: now() });

  // Source file count
  const srcFiles = (await import("node:child_process")).execSync(
    "find src -name '*.ts' | wc -l", { encoding: "utf-8" }
  ).trim();
  metrics.push({ name: "source files", value: Number(srcFiles), unit: "count", timestamp: now() });

  // Test file count
  const testFiles = (await import("node:child_process")).execSync(
    "find tests -name '*.ts' | wc -l", { encoding: "utf-8" }
  ).trim();
  metrics.push({ name: "test files", value: Number(testFiles), unit: "count", timestamp: now() });

  // Policy evaluation latency
  const { evaluatePolicy } = await import("../src/policy/evaluator") as any;
  const policy = {
    version: 1, preset: "team",
    rules: [{ id: "r1", capability: "read", pattern: ".env*", decision: "deny", reason: "secrets" }],
    audit: { enabled: true }, headless: { defaultDecision: "deny" },
  };
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) evaluatePolicy(policy, "read", `/tmp/file-${i}.txt`);
  const policyMs = performance.now() - t0;
  metrics.push({ name: "policy evaluation (10000 calls)", value: Math.round(policyMs * 100) / 100, unit: "ms", timestamp: now() });

  // Permission evaluation latency
  const { PermissionManager } = await import("../src/permissions/manager") as any;
  const pm = new PermissionManager();
  const t1 = performance.now();
  for (let i = 0; i < 10000; i++) pm.evaluate("read", `/tmp/f-${i}`);
  const permMs = performance.now() - t1;
  metrics.push({ name: "permission evaluation (10000 calls)", value: Math.round(permMs * 100) / 100, unit: "ms", timestamp: now() });

  // Risk classification latency
  const { classifyRisk } = await import("../src/permissions/risk") as any;
  const t2 = performance.now();
  for (let i = 0; i < 5000; i++) {
    classifyRisk("bash", { command: "git status" });
    classifyRisk("bash", { command: "npm install express" });
    classifyRisk("bash", { command: "cat README.md" });
  }
  const riskMs = performance.now() - t2;
  metrics.push({ name: "risk classification (15000 calls)", value: Math.round(riskMs * 100) / 100, unit: "ms", timestamp: now() });

  // Redaction latency
  const { redactSensitive } = await import("../src/observability/redaction") as any;
  const t3 = performance.now();
  for (let i = 0; i < 1000; i++) {
    redactSensitive("Bearer eyJ.test.sig with api_key=abc123xyz456def789ghi012jkl345mno");
  }
  const redactMs = performance.now() - t3;
  metrics.push({ name: "redaction (1000 calls)", value: Math.round(redactMs * 100) / 100, unit: "ms", timestamp: now() });

  // Result parsing latency
  const { parseSubagentResult } = await import("../src/agents/result") as any;
  const sample = JSON.stringify({
    status: "success", summary: "done",
    findings: [{ priority: "P1", summary: "missing test" }],
    artifacts: [{ name: "report.md", path: ".harness/x", bytes: 10 }],
    escalations: [{ question: "which db?" }],
  });
  const t4 = performance.now();
  for (let i = 0; i < 5000; i++) parseSubagentResult(sample);
  const parseMs = performance.now() - t4;
  metrics.push({ name: "result parse (5000 calls)", value: Math.round(parseMs * 100) / 100, unit: "ms", timestamp: now() });

  await mkdir(join(process.cwd(), ".harness"), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify({ generatedAt: now(), metrics }, null, 2));

  console.log(`Benchmark complete. ${metrics.length} metrics written to ${OUTPUT}`);
  for (const m of metrics) {
    console.log(`  ${m.name}: ${m.value} ${m.unit}`);
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
