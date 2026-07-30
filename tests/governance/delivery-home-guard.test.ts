import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Edge case from PR #13 review: when os.homedir() returns "" AND $HOME is
 * unset, the old fallback made registryPath() RELATIVE ("​.pi/agent/…"), so
 * saveRegistry would silently create the trusted registry under the CWD —
 * e.g. inside whatever repo the session happens to be in.
 *
 * Contract under no-home:
 *   - registryPath() throws (never yields a relative path)
 *   - loadRegistry still NEVER throws — it keeps its fail-safe null contract
 *
 * homedir() cannot be forced empty via the environment on POSIX (Node falls
 * back to the passwd entry), so this file mocks node:os module-wide and stays
 * separate from the main delivery tests.
 */

vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, homedir: () => "" };
});

import { loadRegistry, registryPath } from "../../src/governance/delivery";

let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  delete process.env.HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

describe("registry path when no home directory can be determined", () => {
  it("registryPath throws instead of returning a CWD-relative path", () => {
    expect(() => registryPath()).toThrow(/home directory/i);
  });

  it("loadRegistry keeps its never-throws contract and fails safe to null", async () => {
    await expect(loadRegistry()).resolves.toBeNull();
  });
});
