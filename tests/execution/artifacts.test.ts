import { describe, expect, it } from "vitest";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyArtifact } from "../../src/workflows/artifacts";
import { buildIntegrationDirective } from "../../src/workflows/runtime";
import type { WorkflowRunResult } from "../../src/workflows/types";

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), "artifact-test-"));
  const file = join(repo, "evidence.txt");
  const content = "verified evidence";
  await writeFile(file, content);
  return { repo, file, sha256: createHash("sha256").update(content).digest("hex") };
}

describe("workflow artifact verification", () => {
  it("verifies contained files by full SHA-256", async () => {
    const { repo, sha256 } = await fixture();
    await expect(verifyArtifact(repo, { path: "evidence.txt", sha256 })).resolves.toMatchObject({ state: "verified", bytes: 17 });
  });

  it("rejects traversal, missing, and mismatched artifacts", async () => {
    const { repo, sha256 } = await fixture();
    await expect(verifyArtifact(repo, { path: "../evidence.txt", sha256 })).resolves.toMatchObject({ state: "invalid" });
    await expect(verifyArtifact(repo, { path: "missing.txt", sha256 })).resolves.toMatchObject({ state: "invalid" });
    await expect(verifyArtifact(repo, { path: "evidence.txt", sha256: "0".repeat(64) })).resolves.toMatchObject({ state: "invalid" });
  });

  it("retains current artifact digests when evidence text is truncated", () => {
    const digest = "a".repeat(64);
    const result: WorkflowRunResult = {
      state: "completed",
      reasons: [],
      results: [{
        node: { id: "research", agent: "reviewer", task: "research", dependsOn: [], required: true },
        outcome: {
          state: "accepted",
          envelope: {
            version: 2,
            requestId: "request",
            ownerRunId: "owner",
            nodeId: "research",
            runId: "run",
            status: "completed",
            launchContractDigest: digest,
            execution: { status: "completed", success: true, exitCode: 0 },
            acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
            review: { status: "reviewed" },
            effects: {},
            artifacts: [{ kind: "report", path: "report.md", sha256: digest }],
            result: { kind: "text", text: "x".repeat(33_000) },
            warnings: [],
            residualRisks: [],
          },
        },
      }],
    };
    const directive = buildIntegrationDirective({
      id: "plan",
      goal: "goal",
      maxConcurrency: 1,
      integration: {
        targetRoots: ["src"],
        capabilities: ["read"],
        criteria: [{ id: "done", statement: "done", evidenceRequired: ["command"] }],
        limits: { maxIntegrationTurns: 1, maxJuryRounds: 1 },
      },
      nodes: result.results.map(({ node }) => node),
    }, result);

    expect(directive).toContain("Evidence text truncated");
    expect(directive).toContain(`research: sha256:${digest}`);
  });
  it("rejects symlink escape", async () => {
    const { repo, file, sha256 } = await fixture();
    await symlink(file, join(repo, "link.txt"));
    await expect(verifyArtifact(repo, { path: "link.txt", sha256 })).resolves.toMatchObject({ state: "invalid" });
  });
});
