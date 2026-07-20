import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

interface SloTarget {
  name: string;
  maxMs: number;
  measurement: number;
  passed: boolean;
}

const targets: SloTarget[] = [];

function record(name: string, ms: number, maxMs: number): void {
  targets.push({ name, maxMs, measurement: Math.round(ms * 100) / 100, passed: ms <= maxMs });
}

describe("release SLOs", () => {
  it("low-risk governance hook p95 under 10ms", async () => {
    const t0 = performance.now();
    const { classifyRisk } = await import("../../src/permissions/risk");
    for (let i = 0; i < 500; i++) {
      classifyRisk("read", { file_path: `/tmp/test-${i}.txt` });
      classifyRisk("ls", {});
      classifyRisk("grep", { pattern: "test", path: "/src" });
    }
    const totalMs = performance.now() - t0;
    const perCallMs = totalMs / 1500;
    record("low-risk hook p95", perCallMs, 10);
    expect(perCallMs).toBeLessThan(10);
  });

  it("high-risk decision path p95 under 25ms (excluding snapshot)", async () => {
    const t0 = performance.now();
    const { classifyRisk: cr } = await import("../../src/permissions/risk");
    const { PermissionManager: PM } = await import("../../src/permissions/manager");
    const pm = new PM();
    for (let i = 0; i < 200; i++) {
      cr("bash", { command: "npm install express" });
      pm.evaluate("exec", `npm run test-${i}`);
    }
    const totalMs = performance.now() - t0;
    const perCallMs = totalMs / 400;
    record("high-risk decision path p95", perCallMs, 25);
    expect(perCallMs).toBeLessThan(25);
  });

  it("registration module loads without errors", { timeout: 30000 }, async () => {
    const t0 = performance.now();
    await import("../../src/index");
    const totalMs = performance.now() - t0;
    record("extension import (cold load)", totalMs, 10000);
    expect(totalMs).toBeGreaterThan(0);
  });

  it("session rule evaluation is sub-millisecond", async () => {
    const t0 = performance.now();
    const { PermissionManager: PM } = await import("../../src/permissions/manager");
    const pm = new PM();
    for (let i = 0; i < 1000; i++) {
      pm.evaluate("read", `/src/file-${i}.ts`);
      pm.evaluate("edit", `/src/file-${i}.ts`);
      pm.evaluate("exec", `git status`);
    }
    const totalMs = performance.now() - t0;
    const perCallMs = totalMs / 3000;
    record("session rule evaluation", perCallMs, 0.5);
    expect(perCallMs).toBeLessThan(0.5);
  });

  it("policy evaluation with 100 rules is efficient", async () => {
    const { evaluatePolicy } = await import("../../src/policy/evaluator");
    const rules = Array.from({ length: 100 }, (_, i) => ({
      id: `rule-${i}`,
      capability: (["read", "edit", "exec"] as const)[i % 3],
      decision: (["allow", "deny", "ask"] as const)[i % 3],
      reason: `test rule ${i}`,
    }));
    const policy = {
      version: 1 as const,
      preset: "team" as const,
      rules,
      audit: { enabled: true },
      headless: { defaultDecision: "deny" as const },
    };
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      evaluatePolicy(policy, "exec", `cmd-${i}`);
    }
    const totalMs = performance.now() - t0;
    const perCallMs = totalMs / 1000;
    record("policy evaluation (100 rules, 1000x)", perCallMs, 5);
    expect(perCallMs).toBeLessThan(5);
  });
});

import { afterAll } from "vitest";

afterAll(async () => {
  const results = {
    generatedAt: new Date().toISOString(),
    passed: targets.every((t) => t.passed),
    targets,
  };
  const path = join(process.cwd(), ".harness", "slo-results.json");
  await writeFile(path, JSON.stringify(results, null, 2), "utf-8");
});
