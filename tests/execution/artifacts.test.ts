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
  it("renders a structured investigation-finding result legibly instead of as a JSON blob", () => {
    const digest = "b".repeat(64);
    const result: WorkflowRunResult = {
      state: "completed",
      reasons: [],
      results: [{
        node: { id: "investigate", agent: "explore", task: "investigate", dependsOn: [], required: true },
        outcome: {
          state: "accepted",
          envelope: {
            requestId: "request",
            ownerRunId: "owner",
            nodeId: "investigate",
            runId: "run",
            status: "completed",
            launchContractDigest: digest,
            execution: { status: "completed", success: true, exitCode: 0 },
            acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
            review: { status: "reviewed" },
            effects: {},
            artifacts: [],
            result: {
              kind: "structured",
              value: {
                summary: "Auth bypass on empty token",
                findings: [
                  "src/auth.ts:42 skips validation when the token is empty",
                  "No test covers the empty-token path",
                ],
                confidence: "high",
              },
            },
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

    expect(directive).toContain("## investigate (explore)");
    expect(directive).toContain("Summary: Auth bypass on empty token");
    expect(directive).toContain("Confidence: high");
    expect(directive).toContain("- src/auth.ts:42 skips validation when the token is empty");
    expect(directive).toContain("- No test covers the empty-token path");
    // The old behavior dumped the structured payload as a raw JSON blob;
    // confirm that opaque form is gone, not merely that the new form is present.
    expect(directive).not.toContain('{"summary"');
  });

  it("leaves text-kind rendering, truncation, and artifact-digest reporting unchanged alongside a structured sibling node", () => {
    const textDigest = "c".repeat(64);
    const structuredDigest = "d".repeat(64);
    const result: WorkflowRunResult = {
      state: "completed",
      reasons: [],
      results: [
        {
          node: { id: "prose", agent: "reviewer", task: "review", dependsOn: [], required: true },
          outcome: {
            state: "accepted",
            envelope: {
              requestId: "request-prose",
              ownerRunId: "owner",
              nodeId: "prose",
              runId: "run",
              status: "completed",
              launchContractDigest: textDigest,
              execution: { status: "completed", success: true, exitCode: 0 },
              acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
              review: { status: "reviewed" },
              effects: {},
              artifacts: [{ kind: "report", path: "prose.md", sha256: textDigest }],
              result: { kind: "text", text: "Free-form prose evidence." },
              warnings: [],
              residualRisks: [],
            },
          },
        },
        {
          node: { id: "investigate", agent: "explore", task: "investigate", dependsOn: [], required: true },
          outcome: {
            state: "accepted",
            envelope: {
              requestId: "request-structured",
              ownerRunId: "owner",
              nodeId: "investigate",
              runId: "run",
              status: "completed",
              launchContractDigest: structuredDigest,
              execution: { status: "completed", success: true, exitCode: 0 },
              acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
              review: { status: "reviewed" },
              effects: {},
              artifacts: [{ kind: "report", path: "finding.md", sha256: structuredDigest }],
              result: {
                kind: "structured",
                value: { summary: "s", findings: ["f1"], confidence: "medium" },
              },
              warnings: [],
              residualRisks: [],
            },
          },
        },
      ],
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

    // Text-kind node: unchanged prose rendering.
    expect(directive).toContain("## prose (reviewer)");
    expect(directive).toContain("Free-form prose evidence.");
    // Structured-kind sibling: legible rendering, not a JSON blob.
    expect(directive).toContain("## investigate (explore)");
    expect(directive).toContain("Summary: s");
    // Artifact-digest reporting is unaffected for both kinds.
    expect(directive).toContain(`prose: sha256:${textDigest}`);
    expect(directive).toContain(`investigate: sha256:${structuredDigest}`);
    // No truncation triggered by this short evidence.
    expect(directive).not.toContain("Evidence text truncated");
  });

  it("rejects symlink escape", async () => {
    const { repo, file, sha256 } = await fixture();
    await symlink(file, join(repo, "link.txt"));
    await expect(verifyArtifact(repo, { path: "link.txt", sha256 })).resolves.toMatchObject({ state: "invalid" });
  });
});
