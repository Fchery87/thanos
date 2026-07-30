import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("pi-subagents 0.37.2 compatibility gate", () => {
  it("applies the bounded patch and projects the complete V2 evidence envelope", async () => {
    const source = resolve("node_modules/pi-subagents");
    const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf-8")) as { version: string };
    expect(pkg.version).toBe("0.37.2");

    const root = await mkdtemp(join(tmpdir(), "thanos-v2-compat-"));
    created.push(root);
    const copy = join(root, "pi-subagents");
    await mkdir(copy);
    await cp(join(source, "src"), join(copy, "src"), { recursive: true });
    await cp(join(source, "package.json"), join(copy, "package.json"));
    await symlink(join(source, "node_modules"), join(copy, "node_modules"), "dir");
    const patch = resolve("scripts/patches/pi-subagents-0.37.2-v2-evidence.patch");
    if ((await readFile(join(copy, "src/api/delegation.ts"), "utf-8")).includes("thanos-patch: V2 evidence envelope types")) {
      execFileSync("git", ["apply", "--reverse", "--whitespace=nowarn", patch], { cwd: copy, stdio: "pipe" });
    }
    execFileSync("git", ["apply", "--whitespace=nowarn", patch], { cwd: copy, stdio: "pipe" });

    const requestModule = await import(pathToFileURL(join(copy, "src/slash/delegation-request.ts")).href);
    const adapterModule = await import(pathToFileURL(join(copy, "src/slash/delegation-adapters.ts")).href);
    const request = {
      version: 2,
      requestId: "request-1",
      ownerRunId: "owner-1",
      nodeId: "node-1",
      agent: "reviewer",
      task: "review",
      context: "fresh",
      cwd: ".",
      acceptance: "verified",
      artifacts: true,
      result: { kind: "text" },
    };
    expect(requestModule.parseSubagentDelegationRequest(request)).toMatchObject({ ok: true });

    const response = adapterModule.toSubagentDelegationV2Response(request, {
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
          effects: {
            fileMutation: { status: "not-applicable", expected: false, attempted: false },
          },
        }],
      },
    }, false);

    expect(response).toMatchObject({
      version: 2,
      requestId: "request-1",
      ownerRunId: "owner-1",
      nodeId: "node-1",
      runId: "run-1",
      execution: { success: true },
      acceptance: { status: "accepted", evidenceStatus: "verified", explicit: true },
      review: { status: "reviewed" },
      effects: { fileMutation: { status: "not-applicable" } },
      artifacts: [],
      warnings: [],
      residualRisks: ["manual verification remains"],
    });
  });
});
