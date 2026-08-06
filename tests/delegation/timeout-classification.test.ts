import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultPiSubagentsSrcRoot } from "../../src/welcome/patch-drift";

/**
 * pi-subagents lives in two separate installs in this repo: a pristine
 * devDependency at the workspace root (`node_modules/pi-subagents`, used for
 * typecheck/tests that want *upstream's* unpatched behavior — see
 * tests/agents/frontmatter-keys.test.ts) and the actual runtime copy under
 * `~/.pi/agent/npm/node_modules/pi-subagents` that scripts/patch-pi-subagents.mjs
 * patches and pi loads at runtime. Resolving the bare `"pi-subagents"`
 * specifier hits the former, which this patch never touches, so a test built
 * that way would fail forever regardless of whether the patch is applied.
 *
 * This test verifies the patch's actual effect, so it targets the runtime
 * copy directly via the same `defaultPiSubagentsSrcRoot()` helper the patch
 * script and the session-start self-heal (src/welcome/patch-drift.ts) both
 * use, and reaches `model-fallback.ts` by absolute file URL — it has no
 * export map entry of its own and a package-exports-mediated resolution
 * would refuse it (see `pi-subagents/../src/...`, which 404s under Node's
 * exports enforcement even when escaping back out of the package).
 */
const MODEL_FALLBACK_TS = join(defaultPiSubagentsSrcRoot(), "runs", "shared", "model-fallback.ts");
const { isRetryableModelFailure } = await import(pathToFileURL(MODEL_FALLBACK_TS).href);

describe("timeout classification", () => {
  it("does not treat a subagent wall-clock timeout as a retryable model failure", () => {
    expect(isRetryableModelFailure("Subagent timed out after 1800000ms.")).toBe(false);
  });

  it("still treats genuine provider timeouts as retryable", () => {
    expect(isRetryableModelFailure("upstream request timeout")).toBe(true);
    expect(isRetryableModelFailure("504 Gateway Timeout")).toBe(true);
  });
});
