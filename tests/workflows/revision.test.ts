import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureRepositoryRevisionIdentity,
  sameRepositoryRevision,
} from "../../src/workflows/revision";

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "waves-revision-"));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  execFileSync("git", ["-C", repo, "add", "a.ts"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "initial"]);
  return repo;
}

describe("repository revision identity", () => {
  it("stays fresh across reads and becomes stale after repository mutation", async () => {
    const repo = makeRepo();
    const yielded = await captureRepositoryRevisionIdentity(repo);
    const unchanged = await captureRepositoryRevisionIdentity(repo);
    expect(yielded).toBeDefined();
    expect(sameRepositoryRevision(yielded, unchanged)).toBe(true);

    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    const changed = await captureRepositoryRevisionIdentity(repo);
    expect(sameRepositoryRevision(yielded, changed)).toBe(false);
  });
});
