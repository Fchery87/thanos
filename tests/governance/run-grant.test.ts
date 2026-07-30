import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeRunGrant, issueRunGrant } from "../../src/governance/run-grant";

const created: string[] = [];

function makeRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "thanos-grant-")));
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

async function grant(repo: string) {
  return issueRunGrant({
    repoDir: repo,
    runId: "run-1",
    contractRevision: "contract-1",
    capabilities: ["edit"],
    targetRoots: ["src"],
  });
}

describe("process-local Run Grant", () => {
  it("authorizes a structured edit inside a canonical target root", async () => {
    const issued = await grant(makeRepo());
    expect(issued).toBeDefined();
    expect(await authorizeRunGrant(issued, {
      repoDir: issued!.repoRoot,
      contractRevision: "contract-1",
      capability: "edit",
      target: "src/new.ts",
    })).toEqual({ allowed: true });
  });

  it("denies a target outside the approved roots", async () => {
    const issued = await grant(makeRepo());
    expect((await authorizeRunGrant(issued, {
      repoDir: issued!.repoRoot,
      contractRevision: "contract-1",
      capability: "edit",
      target: "outside.ts",
    })).allowed).toBe(false);
  });

  it("denies a path whose canonical parent escapes through a symlink", async () => {
    const repo = makeRepo();
    const external = realpathSync(mkdtempSync(join(tmpdir(), "thanos-grant-external-")));
    created.push(external);
    symlinkSync(external, join(repo, "src/link"), "dir");
    const issued = await grant(repo);

    expect((await authorizeRunGrant(issued, {
      repoDir: repo,
      contractRevision: "contract-1",
      capability: "edit",
      target: "src/link/escape.ts",
    })).allowed).toBe(false);
  });

  it("invalidates when repository state drifts outside approved roots", async () => {
    const repo = makeRepo();
    const issued = await grant(repo);
    writeFileSync(join(repo, "outside.ts"), "export const drift = true;\n");

    const decision = await authorizeRunGrant(issued, {
      repoDir: repo,
      contractRevision: "contract-1",
      capability: "edit",
      target: "src/new.ts",
    });
    expect(decision).toMatchObject({ allowed: false, reason: expect.stringContaining("drift") });
  });

  it("permits in-scope state produced earlier in the same run", async () => {
    const repo = makeRepo();
    const issued = await grant(repo);
    writeFileSync(join(repo, "src/index.ts"), "export const changed = true;\n");

    expect(await authorizeRunGrant(issued, {
      repoDir: repo,
      contractRevision: "contract-1",
      capability: "edit",
      target: "src/second.ts",
    })).toEqual({ allowed: true });
  });

  it("invalidates on contract revision or HEAD change", async () => {
    const repo = makeRepo();
    const issued = await grant(repo);
    expect((await authorizeRunGrant(issued, {
      repoDir: repo,
      contractRevision: "contract-2",
      capability: "edit",
      target: "src/new.ts",
    })).allowed).toBe(false);

    writeFileSync(join(repo, "src/committed.ts"), "export {};\n");
    execFileSync("git", ["-C", repo, "add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["-C", repo, "commit", "-m", "drift"], { stdio: "pipe" });
    expect((await authorizeRunGrant(issued, {
      repoDir: repo,
      contractRevision: "contract-1",
      capability: "edit",
      target: "src/new.ts",
    })).allowed).toBe(false);
  });
});
