import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy } from "../../src/policy/loader";

function validPolicy(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    preset: "team",
    rules: [
      {
        id: "custom-deny-env",
        capability: "read",
        pattern: ".env*",
        decision: "deny",
        reason: "Environment files may contain secrets",
      },
    ],
    audit: { enabled: true },
    headless: { defaultDecision: "deny" },
    ...overrides,
  };
}

const originalPolicyFile = process.env.HARNESS_POLICY_FILE;

afterEach(() => {
  process.env.HARNESS_POLICY_FILE = originalPolicyFile;
});

describe("loadPolicy", () => {
  it("uses an explicit policy file path when provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-policy-"));
    const policyPath = join(dir, "custom-policy.json");
    await writeFile(policyPath, JSON.stringify(validPolicy()), "utf-8");

    const policy = await loadPolicy(join(dir, "ignored"), policyPath);

    expect(policy.preset).toBe("team");
    expect(policy.rules.some((rule) => rule.id === "custom-deny-env")).toBe(true);
  });

  it("uses HARNESS_POLICY_FILE when no explicit path is provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-policy-env-"));
    const policyPath = join(dir, "env-policy.json");
    await writeFile(policyPath, JSON.stringify(validPolicy({ preset: "ci" })), "utf-8");
    process.env.HARNESS_POLICY_FILE = policyPath;

    const policy = await loadPolicy(join(dir, "ignored"));

    expect(policy.preset).toBe("ci");
    expect(policy.rules.some((rule) => rule.id === "custom-deny-env")).toBe(true);
  });

  it("rejects invalid policy files instead of silently downgrading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-policy-"));
    const policyPath = join(dir, "broken-policy.json");
    await writeFile(policyPath, "{ not json", "utf-8");

    await expect(loadPolicy(join(dir, "ignored"), policyPath)).rejects.toThrow(/policy/i);
  });
});
