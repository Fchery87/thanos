import { describe, it } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_PATH = join(process.cwd(), "benchmark-results.json");

interface BenchmarkEntry {
  name: string;
  durationMs: number;
  timestamp: string;
}

const results: BenchmarkEntry[] = [];

function record(name: string, start: number): void {
  const durationMs = performance.now() - start;
  results.push({ name, durationMs: Math.round(durationMs * 100) / 100, timestamp: new Date().toISOString() });
}

// Every entry here must be a real elapsed-time measurement. Three "architectural
// metrics" used to live at the top of this file: they read src/index.ts, counted
// its lines and its `import` statements, and wrote those integers into a field
// named `durationMs`. src/index.ts has been a 5-line re-export shim since
// register-harness was extracted, so the benchmark report claimed a 7ms
// operation that was really the number 7. Counts are not durations; if a file's
// size is worth tracking, `wc -l` tracks it.
describe("performance baseline", () => {
  it("measures low-risk tool_call classification latency", async () => {
    const t0 = performance.now();
    const { classifyRisk } = await import("../../src/permissions/risk");
    for (let i = 0; i < 100; i++) {
      classifyRisk("read", { file_path: `/tmp/test-${i}.txt` });
      classifyRisk("ls", {});
      classifyRisk("grep", { pattern: "test", path: "/src" });
    }
    record("low-risk tool_call classification (100x)", t0);
  });

  it("measures critical bash tool_call classification latency", async () => {
    const t0 = performance.now();
    const { classifyRisk } = await import("../../src/permissions/risk");
    for (let i = 0; i < 100; i++) {
      classifyRisk("bash", { command: "npm install express" });
      classifyRisk("bash", { command: "git push origin main" });
      classifyRisk("bash", { command: "rm -rf /tmp/build" });
    }
    record("critical bash tool_call classification (100x)", t0);
  });

  it("measures policy evaluation latency", async () => {
    const t0 = performance.now();
    const { evaluatePolicy } = await import("../../src/policy/evaluator");
    const samplePolicy = {
      version: 1 as const,
      preset: "team" as const,
      rules: [
        { id: "builtin-deny-env-read", capability: "read" as const, pattern: ".env*", decision: "deny" as const, reason: "Environment files may contain secrets" },
      ],
      audit: { enabled: true },
      headless: { defaultDecision: "deny" as const },
    };
    for (let i = 0; i < 50; i++) {
      evaluatePolicy(samplePolicy, "read", `/tmp/file-${i}.txt`);
    }
    record("policy evaluation (50x)", t0);
  });

  it("measures session rule evaluation latency", async () => {
    const t0 = performance.now();
    const { PermissionManager } = await import("../../src/permissions/manager");
    const pm = new PermissionManager();
    pm.evaluate("read", "/src/index.ts");
    pm.evaluate("edit", "/src/index.ts");
    pm.evaluate("exec", "git status");
    record("session rule evaluation (3 capabilities)", t0);
  });
});

import { afterAll } from "vitest";

afterAll(async () => {
  await mkdir(join(process.cwd(), ".harness"), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    results,
  }, null, 2), "utf-8");
});
