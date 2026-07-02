import { describe, expect, it } from "vitest";
import { commandContainsGitPush, shouldBlockLocalOnlyPush } from "../../src/governance/push-guard";

describe("shouldBlockLocalOnlyPush", () => {
  it("blocks an interposed-flag push in local-only mode", () => {
    expect(shouldBlockLocalOnlyPush("local-only", "bash", { command: "git -C /tmp/repo push origin main" })).toBe(true);
  });
  it("does not block in non-local-only modes", () => {
    expect(shouldBlockLocalOnlyPush("direct-PR", "bash", { command: "git push" })).toBe(false);
    expect(shouldBlockLocalOnlyPush(undefined, "bash", { command: "git push" })).toBe(false);
  });
  it("only applies to bash with a string command", () => {
    expect(shouldBlockLocalOnlyPush("local-only", "read", { command: "git push" })).toBe(false);
    expect(shouldBlockLocalOnlyPush("local-only", "bash", {})).toBe(false);
    expect(shouldBlockLocalOnlyPush("local-only", "bash", undefined)).toBe(false);
  });
  it("does not block benign bash commands in local-only", () => {
    expect(shouldBlockLocalOnlyPush("local-only", "bash", { command: 'git commit -m "add push support"' })).toBe(false);
  });
});

describe("commandContainsGitPush", () => {
  it("catches plain and flagged push forms", () => {
    for (const cmd of [
      "git push",
      "git push origin main",
      "git push --force-with-lease",
      "git -C /home/me/repo push",
      "git -C ../repo push origin main",
      "git --no-pager push",
      "git -c user.name=x push",
      "git --git-dir=/r/.git push",
      "git --work-tree /r push",
      "cd repo && git -C . push",
      "true; git push",
      "/usr/bin/git push",
    ]) {
      expect(commandContainsGitPush(cmd), cmd).toBe(true);
    }
  });

  it("does not false-positive on benign commands", () => {
    for (const cmd of [
      'git commit -m "add push support"',
      "git log --grep push",
      "cat src/push.ts",
      "git pushy-tool",
      "echo git push",
      "git pull && git status",
      'grep -r "git push" docs/',
      "gh pr view 12",
    ]) {
      expect(commandContainsGitPush(cmd), cmd).toBe(false);
    }
  });

  it("respects quoting — push inside a quoted arg is not a subcommand", () => {
    expect(commandContainsGitPush('git commit -m "please push later"')).toBe(false);
    expect(commandContainsGitPush("git stash store -m 'push wip' abc")).toBe(false);
  });
});
