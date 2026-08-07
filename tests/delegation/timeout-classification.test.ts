import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const PINNED = "0.41.0";
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * pi-subagents lives in two separate installs in this repo: a pristine
 * devDependency at the workspace root (`node_modules/pi-subagents`) and the
 * runtime copy under `~/.pi/agent/npm/node_modules/pi-subagents` that
 * scripts/patch-pi-subagents.mjs patches and pi loads at runtime. The runtime
 * copy is a real-machine install artifact — never installed in CI, and only
 * present locally at whatever path the operator's home directory happens to
 * resolve to (see the discussion at https://github.com/Fchery87/thanos/pull/65
 * — `defaultPiSubagentsSrcRoot()` resolves against `homedir()`, which pointed
 * at this repo on the developer's machine but not on the CI runner).
 *
 * So, exactly like tests/delegation/compatibility.test.ts, this test builds
 * its own hermetic scratch copy from the pristine devDependency (guaranteed
 * present by `bun install`) and applies the real patch artifact to it,
 * verifying the patch's actual effect without depending on any
 * machine-specific runtime install.
 */
async function patchedModelFallback(): Promise<string> {
  const source = resolve("node_modules/pi-subagents");
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf-8")) as { version: string };
  expect(pkg.version).toBe(PINNED);

  const root = await mkdtemp(join(tmpdir(), "thanos-timeout-classification-"));
  created.push(root);
  const copy = join(root, "pi-subagents");
  await mkdir(copy);
  await cp(join(source, "src"), join(copy, "src"), { recursive: true });
  await cp(join(source, "package.json"), join(copy, "package.json"));

  const patch = resolve(`scripts/patches/pi-subagents-${PINNED}-evidence.patch`);
  execFileSync("git", ["apply", "--whitespace=nowarn", patch], { cwd: copy, stdio: "pipe" });
  return join(copy, "src", "runs", "shared", "model-fallback.ts");
}

describe("timeout classification", () => {
  it("does not treat a subagent wall-clock timeout as a retryable model failure", async () => {
    const { isRetryableModelFailure } = await import(pathToFileURL(await patchedModelFallback()).href);
    expect(isRetryableModelFailure("Subagent timed out after 1800000ms.")).toBe(false);
  });

  it("still treats genuine provider timeouts as retryable", async () => {
    const { isRetryableModelFailure } = await import(pathToFileURL(await patchedModelFallback()).href);
    expect(isRetryableModelFailure("upstream request timeout")).toBe(true);
    expect(isRetryableModelFailure("504 Gateway Timeout")).toBe(true);
  });
});
