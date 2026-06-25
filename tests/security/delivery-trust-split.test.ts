import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { resolveDelivery, resolveDeliveryState } from "../../src/governance/delivery";
import { PermissionManager } from "../../src/permissions/manager";

const SAFE = { mode: "local-only", autonomy: "attended" } as const;

describe("delivery trust-split (adversarial)", () => {
  // ── 1. The pure resolver refuses to read trust fields from the ship file ──────
  it("ship file CANNOT grant mode/autonomy/yolo, but gates ARE honored", () => {
    // A malicious repo smuggles trust-bearing keys alongside legit gates.
    const shipFile = {
      version: 1,
      gates: { test: "bun test", build: "bun run build" },
      // smuggled trust escalation — must all be ignored by the resolver:
      mode: "no-mistakes",
      autonomy: "unattended",
      yolo: "inherit",
    } as any;

    const r = resolveDelivery({
      registry: null, // no captain registry present
      shipFile,
      repoId: { remote: null, path: "/x" },
    });

    // Trust collapses to the most restrictive safe defaults — the smuggled
    // mode/autonomy/yolo are never consulted.
    expect(r.mode).toBe("local-only");
    expect(r.autonomy).toBe("attended");
    expect(r.yoloLocked).toBe(false);
    // Untrusted mechanics from the repo ship file are still honored.
    expect(r.gates.test).toBe("bun test");
    expect(r.gates.build).toBe("bun run build");
  });

  // ── 2. End-to-end through the IO layer with a real malicious file on disk ──────
  describe("end-to-end via resolveDeliveryState (IO layer)", () => {
    // The registry is read from `${HOME}/.pi/agent/projects.json` and
    // os.homedir() honors $HOME on POSIX — pointing HOME at a throwaway dir
    // isolates each test from any real registry on the machine.
    let tmpHome: string;
    let tmpCwd: string;
    let oldHome: string | undefined;

    beforeEach(async () => {
      oldHome = process.env.HOME;
      tmpHome = await mkdtemp(path.join(tmpdir(), "trust-home-"));
      tmpCwd = await mkdtemp(path.join(tmpdir(), "trust-cwd-"));
      process.env.HOME = tmpHome;
    });

    afterEach(async () => {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      await rm(tmpHome, { recursive: true, force: true });
      await rm(tmpCwd, { recursive: true, force: true });
    });

    it("a malicious ship file on disk cannot escalate trust (no registry)", async () => {
      // No registry exists in the throwaway HOME → trust collapses to defaults.
      await mkdir(path.join(tmpCwd, ".thanos"), { recursive: true });
      await writeFile(
        path.join(tmpCwd, ".thanos", "delivery.json"),
        JSON.stringify({
          version: 1,
          gates: { test: "echo ok" },
          // smuggled escalation attempts:
          mode: "no-mistakes",
          autonomy: "unattended",
          yolo: "inherit",
        }),
        "utf-8",
      );

      const r = await resolveDeliveryState(tmpCwd);

      expect(r.mode).toBe("local-only");
      expect(r.autonomy).toBe("attended");
      expect(r.yoloLocked).toBe(false);
      // Mechanics honored even when trust fields were smuggled in.
      expect(r.gates.test).toBe("echo ok");
    });
  });

  // ── 3. The yolo lock is irreversible ──────────────────────────────────────────
  it("yolo lock cannot be undone via setYolo(true)", () => {
    const permissions = new PermissionManager();
    permissions.lockYolo();
    expect(permissions.isYolo).toBe(false);

    // A later (malicious or accidental) re-enable must be a no-op while locked.
    permissions.setYolo(true);
    expect(permissions.isYolo).toBe(false);
    expect(permissions.yoloLocked).toBe(true);
  });

  // ── 4. The registry IS trusted — proving the asymmetry is intentional ──────────
  describe("registry is trusted (asymmetry)", () => {
    let tmpHome: string;
    let tmpCwd: string;
    let oldHome: string | undefined;

    beforeEach(async () => {
      oldHome = process.env.HOME;
      tmpHome = await mkdtemp(path.join(tmpdir(), "trust-home-"));
      tmpCwd = await mkdtemp(path.join(tmpdir(), "trust-cwd-"));
      process.env.HOME = tmpHome;
    });

    afterEach(async () => {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      await rm(tmpHome, { recursive: true, force: true });
      await rm(tmpCwd, { recursive: true, force: true });
    });

    it("a registry entry granting unattended IS applied", async () => {
      await mkdir(path.join(tmpHome, ".pi", "agent"), { recursive: true });
      const registry = {
        version: 1,
        default: SAFE,
        projects: [
          // tmpCwd is not a git repo, so readRemote() returns null; the path
          // match must apply. This is the TRUSTED source, so it IS honored.
          { path: path.resolve(tmpCwd), mode: "no-mistakes", autonomy: "unattended" },
        ],
      };
      await writeFile(
        path.join(tmpHome, ".pi", "agent", "projects.json"),
        JSON.stringify(registry),
        "utf-8",
      );

      const r = await resolveDeliveryState(tmpCwd);

      // The registry IS trusted: its mode/autonomy ARE applied, in contrast to
      // the ship file, which cannot (test 1/2 above).
      expect(r.mode).toBe("no-mistakes");
      expect(r.autonomy).toBe("unattended");
    });
  });
});
