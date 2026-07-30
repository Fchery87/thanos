import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { issueRunGrant } from "../../src/governance/run-grant";
import { authorizeVia } from "../helpers/authorize";

const created: string[] = [];

function makeRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "thanos-gov-contract-")));
  created.push(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/index.ts"), "export {};\n");
  writeFileSync(join(repo, "outside.ts"), "export {};\n");
  git("add", "-A");
  git("commit", "-m", "initial");
  return repo;
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Governance enforces the approved Work Contract directly", () => {
  it("allows an in-root structured edit without a second prompt", async () => {
    const repo = makeRepo();
    const runGrant = await issueRunGrant({
      repoDir: repo,
      runId: "run-1",
      contractRevision: "revision-1",
      capabilities: ["edit"],
      targetRoots: ["src"],
    });
    const promptUser = async (): Promise<boolean> => {
      throw new Error("approved structured edit must not prompt twice");
    };

    const decision = await authorizeVia({
      autonomy: "unattended",
      promptUser,
      workContract: { repoDir: repo, revision: "revision-1", runGrant },
    }, "edit", { file_path: "src/new.ts" });

    expect(decision.block).toBe(false);
  });

  it("blocks an out-of-root edit instead of falling back to a permission prompt", async () => {
    const repo = makeRepo();
    const runGrant = await issueRunGrant({
      repoDir: repo,
      runId: "run-1",
      contractRevision: "revision-1",
      capabilities: ["edit"],
      targetRoots: ["src"],
    });

    const decision = await authorizeVia({
      autonomy: "attended",
      workContract: { repoDir: repo, revision: "revision-1", runGrant },
    }, "edit", { file_path: "outside.ts" });

    expect(decision).toMatchObject({
      block: true,
      reason: expect.stringContaining("approved canonical roots"),
    });
  });
});
