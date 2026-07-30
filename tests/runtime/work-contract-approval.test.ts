import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpecEngine } from "../../src/spec/engine";
import { approvePendingWorkContract } from "../../src/runtime/work-contract-approval";
import { noopTheme } from "../../src/ui-utils";

const created: string[] = [];

function makeRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "thanos-approve-")));
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

describe("single Work Contract approval adapter", () => {
  it("settles, presents, and establishes the approved revision once", async () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement billing pagination with tests", true);
    const confirm = vi.fn(async () => true);

    expect(await approvePendingWorkContract(spec, {
      repoDir: makeRepo(),
      runId: "run-1",
      hasUI: true,
      theme: noopTheme,
      confirm,
    })).toEqual({ approved: true });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(spec.activeSpec?.approvalStatus).toBe("approved");
  });

  it("makes rejection terminal and does not leave a retryable spec", async () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement billing pagination with tests", true);

    expect((await approvePendingWorkContract(spec, {
      repoDir: makeRepo(),
      runId: "run-1",
      hasUI: true,
      theme: noopTheme,
      confirm: async () => false,
    })).approved).toBe(false);
    expect(spec.activeSpec).toBeUndefined();
  });

  it("fails closed without UI", async () => {
    const spec = new SpecEngine();
    spec.startTurn("Implement billing pagination with tests", true);
    const confirm = vi.fn(async () => true);

    const result = await approvePendingWorkContract(spec, {
      repoDir: makeRepo(),
      runId: "run-1",
      hasUI: false,
      theme: noopTheme,
      confirm,
    });
    expect(result).toMatchObject({ approved: false, reason: expect.stringContaining("no UI") });
    expect(confirm).not.toHaveBeenCalled();
  });
});
