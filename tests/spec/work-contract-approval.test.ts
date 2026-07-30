import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SpecEngine } from "../../src/spec/engine";

const created: string[] = [];

function makeRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "thanos-contract-")));
  created.push(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  mkdirSync(join(repo, "src/billing"), { recursive: true });
  mkdirSync(join(repo, "tests/billing"), { recursive: true });
  writeFileSync(join(repo, "src/billing/index.ts"), "export {};\n");
  git("add", "-A");
  git("commit", "-m", "initial");
  return repo;
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("SpecEngine Work Contract approval", () => {
  it("issues one process-local Run Grant for the exact approved revision", async () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement billing pagination with tests", true);

    expect(await spec.approveWorkContract(makeRepo(), "run-1")).toBe(true);
    expect(spec.activeSpec?.approvalStatus).toBe("approved");
    expect(spec.runGrant).toMatchObject({
      runId: "run-1",
      capabilities: expect.arrayContaining(["edit"]),
    });
    expect(spec.runGrant?.contractRevision).toBe(spec.workContractRevision);
  });

  it("fails closed when a mutating contract has no canonical target roots", async () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement pagination with tests", true);

    expect(await spec.approveWorkContract(makeRepo(), "run-1")).toBe(false);
    expect(spec.activeSpec?.approvalStatus).toBe("pending");
    expect(spec.runGrant).toBeUndefined();
  });

  it("drops the Run Grant when the engine resets", async () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement billing pagination with tests", true);
    await spec.approveWorkContract(makeRepo(), "run-1");

    spec.reset();

    expect(spec.runGrant).toBeUndefined();
    expect(spec.workContractRevision).toBeUndefined();
  });
});
