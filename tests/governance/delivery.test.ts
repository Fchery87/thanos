import { describe, expect, it } from "vitest";
import { resolveDelivery } from "../../src/governance/delivery";

const SAFE = { mode: "local-only", autonomy: "attended" } as const;

describe("resolveDelivery", () => {
  it("returns safe default when nothing matches", () => {
    const r = resolveDelivery({ registry: null, shipFile: null, repoId: { remote: null, path: "/x" } });
    expect(r.mode).toBe("local-only");
    expect(r.autonomy).toBe("attended");
  });

  it("matches a project by remote and applies its trusted mode/autonomy", () => {
    const registry = { version: 1, default: SAFE, projects: [
      { match: "git@github.com:me/repo.git", mode: "no-mistakes", autonomy: "unattended" },
    ]} as any;
    const r = resolveDelivery({ registry, shipFile: null, repoId: { remote: "git@github.com:me/repo.git", path: "/x" }});
    expect(r.mode).toBe("no-mistakes");
    expect(r.autonomy).toBe("unattended");
  });

  it("matches by path when remote is absent", () => {
    const registry = { version: 1, default: SAFE, projects: [
      { path: "/home/me/proj", mode: "direct-PR", autonomy: "attended" },
    ]} as any;
    const r = resolveDelivery({ registry, shipFile: null, repoId: { remote: null, path: "/home/me/proj" }});
    expect(r.mode).toBe("direct-PR");
  });

  it("IGNORES mode/autonomy/yolo from the committed ship file (trust-split)", () => {
    const shipFile = { version: 1, gates: { test: "t" }, mode: "no-mistakes", autonomy: "unattended", yolo: "inherit" } as any;
    const r = resolveDelivery({ registry: null, shipFile, repoId: { remote: null, path: "/x" }});
    expect(r.mode).toBe("local-only");      // ship file cannot raise mode
    expect(r.autonomy).toBe("attended");    // ship file cannot grant autonomy
    expect(r.gates.test).toBe("t");         // but ship mechanics ARE honored
  });

  it("sets yoloLocked from registry entry or top-level disabled", () => {
    const reg1 = { version: 1, default: SAFE, projects: [{ match: "r", mode: "local-only", autonomy: "attended", yolo: "locked" }] } as any;
    expect(resolveDelivery({ registry: reg1, shipFile: null, repoId: { remote: "r", path: "/x" }}).yoloLocked).toBe(true);
    const reg2 = { version: 1, yolo: "disabled", default: SAFE, projects: [] } as any;
    expect(resolveDelivery({ registry: reg2, shipFile: null, repoId: { remote: null, path: "/x" }}).yoloLocked).toBe(true);
  });

  it("a registry whose default is more restrictive still wins safely", () => {
    // Registry default is local-only/attended; no project entry matches.
    // The ship file tries to smuggle a more permissive mode/autonomy — it must
    // be ignored, and the restrictive registry default must win.
    const registry = { version: 1, default: SAFE, projects: [
      { match: "other", mode: "no-mistakes", autonomy: "unattended" },
    ]} as any;
    const shipFile = { version: 1, gates: { build: "b" }, defaultBranch: "release", merge: "pr", mode: "no-mistakes", autonomy: "unattended" } as any;
    const r = resolveDelivery({ registry, shipFile, repoId: { remote: "no-match", path: "/x" }});
    expect(r.mode).toBe("local-only");
    expect(r.autonomy).toBe("attended");
    // Ship mechanics are still honored even though trust fields are ignored.
    expect(r.gates.build).toBe("b");
    expect(r.defaultBranch).toBe("release");
    expect(r.merge).toBe("pr");
    expect(r.yoloLocked).toBe(false);
  });

  it("derives merge from mode when ship file omits it", () => {
    const registry = { version: 1, default: SAFE, projects: [
      { match: "r", mode: "direct-PR", autonomy: "attended" },
    ]} as any;
    // direct-PR -> default merge "pr"
    expect(resolveDelivery({ registry, shipFile: null, repoId: { remote: "r", path: "/x" }}).merge).toBe("pr");
    // local-only -> default merge "fast-forward"
    expect(resolveDelivery({ registry: null, shipFile: null, repoId: { remote: null, path: "/x" }}).merge).toBe("fast-forward");
  });
});
