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

  it("rolls back to the recorded version when the patch script fails", async () => {
    const calls: string[] = [];
    const result = await planUpdate({
      readVersion: async () => calls.length === 0 ? "0.41.0" : "0.42.1",
      runPiUpdate: async () => { calls.push("update"); return ok; },
      runPatchScript: async () => { calls.push("patch"); return fail; },
      reinstall: async (v) => { calls.push(`reinstall:${v}`); return ok; },
    });
    expect(result.status).toBe("rolled-back");
    expect(result.from).toBe("0.41.0");
    expect(calls).toEqual(["update", "patch", "reinstall:0.41.0", "patch"]);
  });

  it("reports a failed rollback as needing manual repair rather than claiming success", async () => {
    const result = await planUpdate({
      readVersion: async () => "0.41.0",
      runPiUpdate: async () => ok,
      runPatchScript: async () => fail,
      reinstall: async () => fail,
    });
    expect(result.status).toBe("broken");
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
