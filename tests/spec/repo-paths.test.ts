import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeClaimedPaths, toRepoRelative } from "../../src/spec/repo-paths";

const ROOT = "/repo";

describe("toRepoRelative", () => {
  it("leaves an already-relative path alone", () => {
    expect(toRepoRelative("src/billing/index.ts", ROOT)).toBe("src/billing/index.ts");
  });

  // pi's edit/write schema declares `path` as "relative or absolute", and models
  // routinely send absolute. These matched no contract target before Task 5.
  it("reduces an absolute path to repo-relative", () => {
    expect(toRepoRelative(join(ROOT, "src/billing/index.ts"), ROOT)).toBe("src/billing/index.ts");
  });

  it("normalizes ./ and redundant segments", () => {
    expect(toRepoRelative("./src/billing/index.ts", ROOT)).toBe("src/billing/index.ts");
    expect(toRepoRelative("src/../src/billing/index.ts", ROOT)).toBe("src/billing/index.ts");
    expect(toRepoRelative("src//billing/index.ts", ROOT)).toBe("src/billing/index.ts");
  });

  it("strips trailing slashes from a directory path", () => {
    expect(toRepoRelative("src/billing/", ROOT)).toBe("src/billing");
    expect(toRepoRelative(join(ROOT, "src/billing") + "/", ROOT)).toBe("src/billing");
  });

  it("drops paths that escape the repo root", () => {
    expect(toRepoRelative("../outside/thing.ts", ROOT)).toBeUndefined();
    expect(toRepoRelative("/etc/passwd", ROOT)).toBeUndefined();
    expect(toRepoRelative("src/../../outside.ts", ROOT)).toBeUndefined();
  });

  it("does not mistake a dotted filename for an escape", () => {
    expect(toRepoRelative("..gitkeep", ROOT)).toBe("..gitkeep");
    expect(toRepoRelative("src/..foo.ts", ROOT)).toBe("src/..foo.ts");
  });

  it("drops the repo root itself and empty input", () => {
    expect(toRepoRelative(ROOT, ROOT)).toBeUndefined();
    expect(toRepoRelative("", ROOT)).toBeUndefined();
    expect(toRepoRelative("   ", ROOT)).toBeUndefined();
  });
});

describe("normalizeClaimedPaths", () => {
  it("normalizes, deduplicates, and drops unusable entries", () => {
    expect(normalizeClaimedPaths([
      "src/billing/",
      join(ROOT, "src/billing"),
      "./src/billing",
      "../outside.ts",
      "",
    ], ROOT)).toEqual(["src/billing"]);
  });

  it("preserves distinct paths", () => {
    expect(normalizeClaimedPaths(["src/a.ts", "tests/a.test.ts"], ROOT))
      .toEqual(["src/a.ts", "tests/a.test.ts"]);
  });
});
