import { describe, expect, it } from "vitest";
import { extractGitFilePath } from "../../src/permissions/git-target";

describe("extractGitFilePath", () => {
  it("extracts path from HEAD:path form", () => {
    expect(extractGitFilePath("HEAD:.env")).toBe(".env");
  });

  it("extracts path from branch:path form", () => {
    expect(extractGitFilePath("main:config/server.key")).toBe("config/server.key");
  });

  it("extracts path from commit-hash:path form", () => {
    expect(extractGitFilePath("a1b2c3d4e5f6:src/index.ts")).toBe("src/index.ts");
  });

  it("extracts path from stage path form :stage:path", () => {
    expect(extractGitFilePath(":2:src/file.ts")).toBe("src/file.ts");
  });

  it("extracts path even with tildes in branch names", () => {
    expect(extractGitFilePath("not~a~real~rev:.env")).toBe(".env");
  });

  it("returns undefined for empty path after revision", () => {
    expect(extractGitFilePath("HEAD:")).toBeUndefined();
  });

  it("returns undefined for plain tokens without revision syntax", () => {
    expect(extractGitFilePath("src/index.ts")).toBeUndefined();
    expect(extractGitFilePath(".env")).toBeUndefined();
  });

  it("returns undefined for flags (tokens starting with -)", () => {
    expect(extractGitFilePath("--path=foo:bar")).toBeUndefined();
  });

  it("returns undefined for URLs", () => {
    expect(extractGitFilePath("https://example.com:443/path")).toBeUndefined();
  });

  it("extracts path from ORIG_HEAD and FETCH_HEAD", () => {
    expect(extractGitFilePath("ORIG_HEAD:.env")).toBe(".env");
    expect(extractGitFilePath("FETCH_HEAD:.pem")).toBe(".pem");
  });

  it("extracts path from stage 0 path", () => {
    expect(extractGitFilePath(":0:.env")).toBe(".env");
  });

  it("handles complex paths after revision", () => {
    expect(extractGitFilePath("HEAD:deeply/nested/path/to/file.txt")).toBe("deeply/nested/path/to/file.txt");
  });
});
