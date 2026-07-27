import { describe, expect, it } from "vitest";
import {
  classifyTestCommand,
  normalizeCommand,
  normalizeExecutable,
} from "../../src/spec/command-normalize";

// A fixture stands in for the repo's package.json so these tests do not drift when
// the real scripts change.
const SCRIPTS: Record<string, string> = {
  test: "vitest run",
  "test:unit": "vitest run tests/spec",
  lint: "eslint src tests",
  typecheck: "tsc --noEmit",
  ci: "bun run typecheck && bun run lint && bun run test",
  loop: "bun run loop",
};

const norm = (command: string) => normalizeCommand(command, SCRIPTS);

describe("normalizeCommand", () => {
  it("leaves a plain invocation alone", () => {
    expect(norm("vitest run --coverage")).toEqual(["vitest", "run", "--coverage"]);
  });

  it("resolves package-manager script indirection", () => {
    expect(norm("bun run test")).toEqual(["vitest", "run"]);
    expect(norm("npm run test:unit")).toEqual(["vitest", "run", "tests/spec"]);
  });

  it("resolves the implicit `<pm> test` form for npm/pnpm/yarn", () => {
    for (const pm of ["npm", "pnpm", "yarn"]) {
      expect(norm(`${pm} test`), pm).toEqual(["vitest", "run"]);
    }
  });

  // `bun test` is bun's own runner, not the package script. Resolving it would
  // silently swap runners — the mistake that yields phantom failures here.
  it("never resolves bare `bun test` through scripts", () => {
    expect(norm("bun test")).toEqual(["bun", "test"]);
  });

  it("strips wrappers and environment prefixes", () => {
    expect(norm("npx vitest run")).toEqual(["vitest", "run"]);
    expect(norm("bunx vitest run")).toEqual(["vitest", "run"]);
    expect(norm("CI=1 NODE_ENV=test vitest run")).toEqual(["vitest", "run"]);
    expect(norm("env CI=1 npx vitest run")).toEqual(["vitest", "run"]);
  });

  it("carries trailing arguments through a resolved script", () => {
    expect(norm("bun run test --coverage")).toEqual(["vitest", "run", "--coverage"]);
    expect(norm("npm run test -- --reporter=dot")).toEqual(["vitest", "run", "--reporter=dot"]);
  });

  it("picks the test clause out of a compound command, wherever it sits", () => {
    expect(norm("cd packages/core && vitest run")).toEqual(["vitest", "run"]);
    expect(norm("vitest run && echo done")).toEqual(["vitest", "run"]);
    expect(norm("cd sub; bun run test")).toEqual(["vitest", "run"]);
  });

  it("expands an aggregate script to reach the test inside it", () => {
    expect(norm("bun run ci")).toEqual(["vitest", "run"]);
  });

  it("falls back to the last meaningful clause when nothing is a test", () => {
    expect(norm("cd packages/core && ls -la")).toEqual(["ls", "-la"]);
    expect(norm("git status && git diff")).toEqual(["git", "diff"]);
  });

  it("keeps a noise-only command rather than returning nothing", () => {
    expect(norm("echo done")).toEqual(["echo", "done"]);
    expect(norm("cd packages/core")).toEqual(["cd", "packages/core"]);
  });

  it("survives a self-referential script without recursing forever", () => {
    expect(norm("bun run loop")).toEqual(["bun", "run", "loop"]);
  });

  it("returns nothing for an empty command", () => {
    expect(norm("   ")).toEqual([]);
  });

  it("does not consult scripts for an unknown script name", () => {
    expect(norm("bun run nonexistent")).toEqual(["bun", "run", "nonexistent"]);
  });
});

describe("classifyTestCommand", () => {
  it("recognizes bare runners", () => {
    expect(classifyTestCommand(["vitest", "run"])).toEqual({ isTest: true, runner: "vitest" });
    expect(classifyTestCommand(["pytest"])).toEqual({ isTest: true, runner: "pytest" });
  });

  it("recognizes `<binary> test` subcommands", () => {
    expect(classifyTestCommand(["go", "test", "./..."])).toEqual({ isTest: true, runner: "go test" });
    expect(classifyTestCommand(["cargo", "test"])).toEqual({ isTest: true, runner: "cargo test" });
  });

  // node takes a flag, not a subcommand — the old argv[1] === "test" rule missed it.
  it("recognizes `node --test`", () => {
    expect(classifyTestCommand(["node", "--test"])).toEqual({ isTest: true, runner: "node --test" });
  });

  it("does not treat arbitrary commands as tests", () => {
    expect(classifyTestCommand(["ls", "-la"]).isTest).toBe(false);
    expect(classifyTestCommand(["printf", "test", "passed"]).isTest).toBe(false);
    expect(classifyTestCommand([]).isTest).toBe(false);
  });
});

describe("normalizeExecutable", () => {
  it("collapses multi-token executables", () => {
    expect(normalizeExecutable(["bun", "test"])).toBe("bun test");
    expect(normalizeExecutable(["go", "test", "./..."])).toBe("go test");
    expect(normalizeExecutable(["node", "--test"])).toBe("node --test");
    expect(normalizeExecutable(["git", "grep", "foo"])).toBe("git grep");
  });

  it("returns the bare program otherwise", () => {
    expect(normalizeExecutable(["vitest", "run"])).toBe("vitest");
    expect(normalizeExecutable(["git", "status"])).toBe("git");
    expect(normalizeExecutable([])).toBe("unknown");
  });
});
