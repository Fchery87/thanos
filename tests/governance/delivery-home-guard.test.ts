import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Edge case from PR #13 review: when os.homedir() returns "" AND $HOME is
 * unset, the old fallback made registryPath() RELATIVE ("​.pi/agent/…"), so
 * saveRegistry would silently create the trusted registry under the CWD —
 * e.g. inside whatever repo the session happens to be in.
 *
 * Contract under no-home:
 *   - registryPath() throws (never yields a relative path)
 *   - saveRegistry rejects (callers notify; the grant must not "stick" in a
 *     random location)
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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadRegistry, registryPath } from "../../src/governance/delivery";
import { saveRegistry, upsertRegistryEntry } from "../../src/governance/delivery-select";

let savedHome: string | undefined;
let savedCwd: string;
let tmpCwd: string;

beforeEach(async () => {
  savedHome = process.env.HOME;
  savedCwd = process.cwd();
  delete process.env.HOME;
  // If the no-home guard ever regresses, the buggy relative registryPath would
  // write .pi/agent/ into the CWD — run from a throwaway dir so a regression
  // dirties a tmp dir, not the repo (it did exactly that once: see PR #13).
  tmpCwd = await mkdtemp(path.join(tmpdir(), "delivery-home-guard-"));
  process.chdir(tmpCwd);
});

afterEach(async () => {
  process.chdir(savedCwd);
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  await rm(tmpCwd, { recursive: true, force: true });
});

describe("registry path when no home directory can be determined", () => {
  it("registryPath throws instead of returning a CWD-relative path", () => {
    expect(() => registryPath()).toThrow(/home directory/i);
  });

  it("saveRegistry rejects instead of writing under the CWD", async () => {
    const registry = upsertRegistryEntry(null, { remote: "r", path: "/p" }, "direct-PR");
    await expect(saveRegistry(registry)).rejects.toThrow(/home directory/i);
  });

  it("loadRegistry keeps its never-throws contract and fails safe to null", async () => {
    await expect(loadRegistry()).resolves.toBeNull();
  });
});
