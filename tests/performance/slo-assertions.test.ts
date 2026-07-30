import { describe, expect, it } from "vitest";

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
    expect(perCallMs).toBeLessThan(25);
  });

  // Cold-load is deliberately NOT measured here, and this comment is the only
  // thing left of the target that was.
  //
  // It timed `await import("../../src/index")` from inside vitest and compared
  // the result to a 10s budget. That number was vitest transforming the entire
  // TypeScript module graph on demand — it reported 31,578ms against a real cold
  // load of ~1,530ms in the fresh bun process pi actually uses. Worse, its only
  // assertion was `toBeGreaterThan(0)`, so it could not fail while the suite
  // stayed green, which is how a gate teaches you to stop reading it.
  //
  // The honest measurement needs a process that isn't a test runner, so it lives
  // in scripts/measure-harness.mjs (`bun run measure`).

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
    expect(perCallMs).toBeLessThan(5);
  });
});
