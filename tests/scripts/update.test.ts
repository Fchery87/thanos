import { describe, expect, it } from "vitest";
import { planUpdate } from "../../scripts/thanos-update.mjs";

const ok = { code: 0 };
const fail = { code: 1 };

describe("thanos update", () => {
  it("keeps the new version when the patch script succeeds", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => calls.length === 0 ? "0.41.0" : "0.42.1",
      runPiUpdate: async () => { calls.push("update"); return ok; },
      runPatchScript: async () => { calls.push("patch"); return ok; },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return ok; },
    });
    expect(result.status).toBe("updated");
    expect(calls).toEqual(["update", "patch"]);
  });

  it("rolls back to the recorded version when the patch script fails, and only reports success once the re-patch after rollback actually succeeds", async () => {
    // The patch script fails against whatever `pi update` just installed
    // (call 1), reinstall puts the old version back, and the patch script is
    // run again against that reinstalled tree (call 2) — this time it
    // succeeds. Distinguishing call 1 from call 2 here is load-bearing: a
    // mock that returned the same result for both calls could not tell
    // apart "rollback's re-patch genuinely succeeded" from "rollback's
    // re-patch was never actually checked", which is exactly the gap that
    // let an earlier version of planUpdate report "rolled-back" by trusting
    // reinstall's exit code alone, without the re-patch having to succeed.
    const calls: string[] = [];
    let patchCallCount = 0;
    const result = await planUpdate({
      readVersion: async () => calls.length === 0 ? "0.41.0" : "0.42.1",
      runPiUpdate: async () => { calls.push("update"); return ok; },
      runPatchScript: async () => {
        calls.push("patch");
        patchCallCount++;
        return patchCallCount === 1 ? fail : ok;
      },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return ok; },
    });
    expect(result.status).toBe("rolled-back");
    expect(result.from).toBe("0.41.0");
    expect(calls).toEqual(["update", "patch", "reinstall:0.41.0", "patch"]);
  });

  it("reports broken when reinstall itself fails — no re-patch is attempted against a version that was never restored", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      runPiUpdate: async () => ok,
      runPatchScript: async () => { calls.push("patch"); return fail; },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return fail; },
    });
    expect(result.status).toBe("broken");
    expect(result.from).toBe("0.41.0");
    expect(calls).toEqual(["patch", "reinstall:0.41.0"]);
  });

  it("reports broken when reinstall succeeds but the re-patch against the rolled-back version still fails — never reports rolled-back on an unpatched install", async () => {
    // This is the case an earlier implementation got wrong: gating success
    // on reinstall's exit code alone would report "rolled-back" here even
    // though the harness is still unpatched. reinstall restoring the right
    // source tree is necessary but not sufficient — the patch script has to
    // actually re-verify against it.
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      runPiUpdate: async () => ok,
      runPatchScript: async () => { calls.push("patch"); return fail; },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return ok; },
    });
    expect(result.status).toBe("broken");
    expect(result.from).toBe("0.41.0");
    expect(calls).toEqual(["patch", "reinstall:0.41.0", "patch"]);
  });

  it("does not roll back when pi update itself fails — nothing moved", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      runPiUpdate: async () => { calls.push("update"); return fail; },
      runPatchScript: async () => { calls.push("patch"); return ok; },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return ok; },
    });
    expect(result.status).toBe("update-failed");
    expect(calls).toEqual(["update"]);
  });

  it("reports unchanged when pi update ran but the installed version didn't move", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => "0.41.0", // same before and after — nothing moved
      runPiUpdate: async () => { calls.push("update"); return ok; },
      runPatchScript: async () => { calls.push("patch"); return ok; },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return ok; },
    });
    expect(result.status).toBe("unchanged");
    expect(calls).toEqual(["update", "patch"]);
  });
});
