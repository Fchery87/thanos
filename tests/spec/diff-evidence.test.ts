import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { collectTurnDiffEvidence, snapshotWorkingTree } from "../../src/spec/diff-evidence";

const created: string[] = [];

function makeRepo(): string {
  // realpath, because `git rev-parse --show-toplevel` resolves symlinks and macOS
  // hands out /var/folders/... which is a link to /private/var/folders/...
  // Comparing a resolved toplevel against an unresolved root makes every path
  // look like it escapes the repo, and all evidence is dropped.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "thanos-diff-")));
  created.push(dir);
  const run = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  run("init", "--initial-branch=main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/committed.ts"), "export const a = 1;\n");
  run("add", "-A");
  run("commit", "-m", "initial");
  return dir;
}

function write(dir: string, rel: string, contents: string): void {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), contents);
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe("snapshotWorkingTree", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });

  it("is empty for a clean tree", async () => {
    expect(await snapshotWorkingTree(repo)).toEqual(new Map());
  });

  it("records modified and untracked files alike", async () => {
    write(repo, "src/committed.ts", "export const a = 2;\n");
    write(repo, "src/fresh.ts", "export const b = 1;\n");

    const snapshot = await snapshotWorkingTree(repo);

    expect([...(snapshot?.keys() ?? [])].sort()).toEqual(["src/committed.ts", "src/fresh.ts"]);
  });

  it("returns undefined outside a git repository", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "thanos-plain-")));
    created.push(plain);
    expect(await snapshotWorkingTree(plain)).toBeUndefined();
  });
});

describe("collectTurnDiffEvidence", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });

  it("reports a file created during the turn", async () => {
    const baseline = await snapshotWorkingTree(repo);
    write(repo, "src/added.ts", "export const c = 1;\n");

    const evidence = await collectTurnDiffEvidence(repo, baseline);

    expect(evidence?.paths).toEqual(["src/added.ts"]);
    expect(evidence?.passed).toBe(true);
    expect(evidence?.base).toMatch(/^[0-9a-f]{40}$/);
    expect(evidence?.patchHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("reports a file modified during the turn", async () => {
    const baseline = await snapshotWorkingTree(repo);
    write(repo, "src/committed.ts", "export const a = 99;\n");

    expect((await collectTurnDiffEvidence(repo, baseline))?.paths).toEqual(["src/committed.ts"]);
  });

  // The whole point of the baseline: work already in the tree is not this turn's.
  it("excludes files that were already dirty and left alone", async () => {
    write(repo, "src/preexisting.ts", "export const d = 1;\n");
    const baseline = await snapshotWorkingTree(repo);

    expect(await collectTurnDiffEvidence(repo, baseline)).toBeUndefined();
  });

  it("includes an already-dirty file that the turn changed further", async () => {
    write(repo, "src/preexisting.ts", "export const d = 1;\n");
    const baseline = await snapshotWorkingTree(repo);
    write(repo, "src/preexisting.ts", "export const d = 2;\n");

    expect((await collectTurnDiffEvidence(repo, baseline))?.paths).toEqual(["src/preexisting.ts"]);
  });

  // An edit that was undone did not happen, so it cannot satisfy a criterion.
  it("does not report an edit reverted before the turn ended", async () => {
    const baseline = await snapshotWorkingTree(repo);
    write(repo, "src/committed.ts", "export const a = 42;\n");
    write(repo, "src/committed.ts", "export const a = 1;\n");

    expect(await collectTurnDiffEvidence(repo, baseline)).toBeUndefined();
  });

  it("reports a deletion as a change", async () => {
    const baseline = await snapshotWorkingTree(repo);
    unlinkSync(join(repo, "src/committed.ts"));

    expect((await collectTurnDiffEvidence(repo, baseline))?.paths).toEqual(["src/committed.ts"]);
  });

  it("treats a missing baseline as everything-is-new", async () => {
    write(repo, "src/added.ts", "export const c = 1;\n");

    expect((await collectTurnDiffEvidence(repo, undefined))?.paths).toEqual(["src/added.ts"]);
  });

  it("returns undefined for a clean tree", async () => {
    expect(await collectTurnDiffEvidence(repo, await snapshotWorkingTree(repo))).toBeUndefined();
  });

  it("returns undefined outside a git repository, leaving tool-input evidence to stand", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "thanos-plain-")));
    created.push(plain);
    expect(await collectTurnDiffEvidence(plain, undefined)).toBeUndefined();
  });

  it("emits repo-relative POSIX paths that can bind to a contract target", async () => {
    const baseline = await snapshotWorkingTree(repo);
    write(repo, "src/billing/pagination.ts", "export const p = 1;\n");

    const evidence = await collectTurnDiffEvidence(repo, baseline);

    expect(evidence?.paths).toEqual(["src/billing/pagination.ts"]);
    expect(evidence?.paths.every((path) => !path.startsWith("/"))).toBe(true);
  });

  it("distinguishes turns by patch hash", async () => {
    const baseline = await snapshotWorkingTree(repo);
    write(repo, "src/added.ts", "export const c = 1;\n");
    const first = await collectTurnDiffEvidence(repo, baseline);
    write(repo, "src/added.ts", "export const c = 2;\n");
    const second = await collectTurnDiffEvidence(repo, baseline);

    expect(first?.patchHash).not.toBe(second?.patchHash);
  });
});
