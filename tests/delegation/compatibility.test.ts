import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { validateDelegationEvidence } from "../../src/delegation/evidence";

const PINNED = "0.42.1";
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** Copy the pinned package into a scratch tree and apply the carry patch to it. */
async function patchedPackage(): Promise<string> {
  const source = resolve("node_modules/pi-subagents");
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf-8")) as { version: string };
  expect(pkg.version).toBe(PINNED);

  const root = await mkdtemp(join(tmpdir(), "thanos-delegation-compat-"));
  created.push(root);
  const copy = join(root, "pi-subagents");
  await mkdir(copy);
  await cp(join(source, "src"), join(copy, "src"), { recursive: true });
  await cp(join(source, "package.json"), join(copy, "package.json"));
  await symlink(join(source, "node_modules"), join(copy, "node_modules"), "dir");

  const patch = resolve(`scripts/patches/pi-subagents-${PINNED}-evidence.patch`);
  execFileSync("git", ["apply", "--whitespace=nowarn", patch], { cwd: copy, stdio: "pipe" });
  return copy;
}

// pi-subagents 0.42.1's src/ tree is ~19% larger than 0.41.0's (167 files,
// durable schedules / worktree isolation / permission-system compat among
// the additions — none touching the patched anchors themselves, confirmed
// in research/pi-subagents-0.42.1-port.md). The cp + git apply + dynamic
// TS import each test performs now lands right at vitest's 5000ms default,
// verified by running standalone (well under a second outside vitest) vs.
// inside vitest's transform pipeline (consistently >5000ms). Real, not a
// logic defect — bumped explicitly rather than raising the global default.
const HERMETIC_TIMEOUT_MS = 30_000;

describe(`pi-subagents ${PINNED} compatibility gate`, () => {
  it("accepts an acceptance request and projects the complete evidence envelope", async () => {
    const copy = await patchedPackage();

    // A real file so the patch's artifact digesting has something to hash.
    const artifact = join(copy, "transcript.jsonl");
    await writeFile(artifact, '{"role":"assistant","text":"done"}\n');

    const requestModule = await import(pathToFileURL(join(copy, "src/slash/delegation-request.ts")).href);
    const adapterModule = await import(pathToFileURL(join(copy, "src/slash/delegation-adapters.ts")).href);

    // 0.41.0 has no protocol version: `version` is rejected as unsupported, and
    // `acceptance` takes an AcceptanceInput level — which excludes "verified",
    // that being a computed output level rather than something a caller requests.
    const request = {
      requestId: "request-1",
      ownerRunId: "owner-1",
      nodeId: "node-1",
      agent: "researcher",
      task: "review",
      context: "fresh",
      cwd: ".",
      acceptance: "checked",
      artifacts: true,
      result: { kind: "text" },
    };
    expect(requestModule.parseSubagentDelegationRequest(request)).toMatchObject({ ok: true });

    // The gate's whole point: acceptance must actually reach the executor.
    // Unpatched, this is hardcoded to false and no ledger is ever produced.
    expect(adapterModule.toSubagentDelegationExecutionParams(request)).toMatchObject({ acceptance: "checked" });

    const response = adapterModule.toSubagentDelegationResponse(request, {
      content: [{ type: "text", text: "ok" }],
      isError: false,
      details: {
        runId: "run-1",
        results: [{
          status: "completed",
          finalOutput: "ok",
          launchContractDigest: "a".repeat(64),
          execution: { status: "completed", success: true, exitCode: 0 },
          acceptance: {
            status: "accepted",
            evidenceStatus: "verified",
            explicit: true,
            childReport: { residualRisks: ["manual verification remains"] },
          },
          review: { status: "reviewed", findings: [] },
          effects: { fileMutation: { status: "not-applicable", expected: false, attempted: false } },
          artifactPaths: { transcriptPath: artifact },
        }],
      },
    }, false);

    expect(response).toMatchObject({
      requestId: "request-1",
      ownerRunId: "owner-1",
      nodeId: "node-1",
      runId: "run-1",
      launchContractDigest: "a".repeat(64),
      execution: { success: true },
      acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
      review: { status: "reviewed" },
      effects: { fileMutation: { status: "not-applicable" } },
      warnings: [],
      residualRisks: ["manual verification remains"],
    });
    expect(response.artifacts).toEqual([
      { kind: "transcript", path: artifact, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: expect.any(Number) },
    ]);

    // End to end: the projected payload is what the harness gate accepts.
    expect(validateDelegationEvidence(response, {
      requestId: "request-1",
      ownerRunId: "owner-1",
      nodeId: "node-1",
    }).state).toBe("accepted");
  }, HERMETIC_TIMEOUT_MS);

  it("stays fail-closed on the unpatched package", async () => {
    const source = resolve("node_modules/pi-subagents");
    const root = await mkdtemp(join(tmpdir(), "thanos-delegation-bare-"));
    created.push(root);
    const copy = join(root, "pi-subagents");
    await mkdir(copy);
    await cp(join(source, "src"), join(copy, "src"), { recursive: true });
    await cp(join(source, "package.json"), join(copy, "package.json"));
    await symlink(join(source, "node_modules"), join(copy, "node_modules"), "dir");

    const adapterModule = await import(pathToFileURL(join(copy, "src/slash/delegation-adapters.ts")).href);

    // Unpatched upstream hardcodes acceptance off, so no ledger is ever produced...
    expect(adapterModule.toSubagentDelegationExecutionParams({
      agent: "researcher", task: "review", context: "fresh", cwd: ".", acceptance: "checked",
      result: { kind: "text" },
    })).toMatchObject({ acceptance: false });

    // ...and the resulting response is refused rather than mistaken for completion.
    const response = adapterModule.toSubagentDelegationResponse({
      requestId: "request-1", ownerRunId: "owner-1", nodeId: "node-1",
      agent: "researcher", task: "review", context: "fresh", cwd: ".", result: { kind: "text" },
    }, {
      content: [{ type: "text", text: "ok" }],
      isError: false,
      details: { runId: "run-1", results: [{ status: "completed", finalOutput: "ok", launchContractDigest: "a".repeat(64) }] },
    }, false);

    const verdict = validateDelegationEvidence(response, {
      requestId: "request-1", ownerRunId: "owner-1", nodeId: "node-1",
    });
    expect(verdict.state).toBe("awaiting_evidence");
    if (verdict.state === "awaiting_evidence") {
      expect(verdict.reasons).toContain("acceptance evidence is missing");
    }
  }, HERMETIC_TIMEOUT_MS);
});
