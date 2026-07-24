import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const launcherPath = join(root, "scripts", "thanos-launch.mjs");

/**
 * The launcher's shebang is `#!/usr/bin/env bun` (it imports src/*.ts with
 * this repo's extension-less internal specifiers, which only bun resolves —
 * see scripts/thanos-launch.mjs's own header comment). We therefore always
 * invoke it as `bun <launcherPath> ...`, never via `process.execPath`: this
 * test file runs inside a vitest worker, which is a *node* process even
 * though the whole suite is launched with `bun run test` — `process.execPath`
 * here is node's path, not bun's, and the launcher will refuse to resolve
 * its own extension-less imports under plain node.
 */
function bunBinDirSync(): string {
  const result = spawnSync("which", ["bun"]);
  const resolved = result.stdout.toString().trim();
  if (!resolved) throw new Error("`bun` not found on PATH — required to run scripts/thanos-launch.mjs");
  return dirname(resolved);
}
const bunBinDir = bunBinDirSync();

/**
 * Real, reliable bwrap presence check for the test suite itself — mirrors
 * what the launcher's own `detectBwrap` does. Used to gate the real
 * sandboxed regression test: it runs (and gives the strongest possible
 * guarantee — an actual bwrap invocation) whenever bwrap is present, and
 * skips with an explanatory message when it is not, rather than either
 * failing the whole suite on a bwrap-less CI runner or silently omitting
 * the strongest check available.
 */
function bwrapAvailableSync(): boolean {
  const result = spawnSync("bwrap", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

/** dirname of the real system `bwrap`, or "" if not found (caller must check bwrapAvailableSync() first). */
function bwrapBinDirSync(): string {
  const result = spawnSync("which", ["bwrap"]);
  const resolved = result.stdout.toString().trim();
  return resolved ? dirname(resolved) : "";
}

async function writeExecutable(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o755 });
}

/** A minimal captain registry with the given default mode/autonomy. */
async function writeRegistry(
  agentDir: string,
  registry: { mode: string; autonomy: string },
): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "projects.json"),
    JSON.stringify(
      { version: 1, default: { mode: registry.mode, autonomy: registry.autonomy }, projects: [] },
      null,
      2,
    ),
    "utf-8",
  );
}

/** Build a PATH that does NOT resolve `bwrap`, but still resolves bun so the launcher itself can run. */
function pathWithoutBwrap(extraBinDir: string): string {
  return [extraBinDir, bunBinDir].join(":");
}

/**
 * Build a PATH that resolves the real system `bwrap` but deliberately
 * excludes the rest of the system PATH (in particular, wherever the real
 * `pi` binary lives) — so the sandboxed inner command unambiguously
 * resolves to our stub `pi`, never the real one. Only `bwrap`'s own
 * directory is added alongside the stub bin dir and bun's bin dir.
 */
function pathWithRealBwrap(extraBinDir: string): string {
  return [extraBinDir, bwrapBinDirSync(), bunBinDir].join(":");
}

/**
 * Every test below creates its own mkdtemp workDir and MUST register it here
 * immediately after creation. Sibling suites in this directory
 * (delivery-trust-split.test.ts, snapshot.test.ts) already clean up their
 * temp dirs; this suite didn't (leak, not a flakiness/orphan-process risk —
 * no async gap that could leave a hanging process, just accumulating disk
 * cruft under the host's real tmpdir across test runs). Fixed here.
 */
const workDirsToClean: string[] = [];
afterEach(async () => {
  await Promise.all(workDirsToClean.map((dir) => rm(dir, { recursive: true, force: true })));
  workDirsToClean.length = 0;
});

describe("thanos-launch.mjs (integration)", () => {
  it(
    "deny path never invokes the inner command (no-mistakes + no bwrap on PATH)",
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), "thanos-launch-deny-"));
      workDirsToClean.push(workDir);
      const fakeHome = join(workDir, "home");
      const repoDir = join(workDir, "repo");
      const stubBinDir = join(workDir, "stub-bin");
      const markerPath = join(workDir, "pi-was-invoked.marker");

      await mkdir(repoDir, { recursive: true });
      await writeRegistry(join(fakeHome, ".pi", "agent"), { mode: "no-mistakes", autonomy: "attended" });
      await writeExecutable(
        join(stubBinDir, "pi"),
        `#!/bin/sh\n: > "${markerPath}"\necho "stub pi ran"\nexit 0\n`,
      );

      const env = {
        ...process.env,
        HOME: fakeHome,
        PATH: pathWithoutBwrap(stubBinDir),
      };

      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      try {
        const result = await execFileAsync("bun", [launcherPath, "--version"], {
          cwd: repoDir,
          env,
        });
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = 0;
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        exitCode = e.code ?? 1;
        stdout = e.stdout ?? "";
        stderr = e.stderr ?? "";
      }

      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/no-mistakes/i);
      expect(stderr).toMatch(/bwrap/i);
      expect(stdout).not.toContain("stub pi ran");

      await expect(readFile(markerPath, "utf-8")).rejects.toThrow();
    },
    20_000,
  );

  it(
    "warn path (bwrap missing, non-no-mistakes mode) still invokes the inner command directly",
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), "thanos-launch-warn-"));
      workDirsToClean.push(workDir);
      const fakeHome = join(workDir, "home");
      const repoDir = join(workDir, "repo");
      const stubBinDir = join(workDir, "stub-bin");
      const markerPath = join(workDir, "pi-was-invoked.marker");

      await mkdir(repoDir, { recursive: true });
      await writeRegistry(join(fakeHome, ".pi", "agent"), { mode: "local-only", autonomy: "unattended" });
      await writeExecutable(
        join(stubBinDir, "pi"),
        `#!/bin/sh\n: > "${markerPath}"\necho "stub pi ran: $@"\nexit 7\n`,
      );

      const env = {
        ...process.env,
        HOME: fakeHome,
        PATH: pathWithoutBwrap(stubBinDir),
      };

      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      try {
        const result = await execFileAsync("bun", [launcherPath, "--probe"], {
          cwd: repoDir,
          env,
        });
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = 0;
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        exitCode = e.code ?? 1;
        stdout = e.stdout ?? "";
        stderr = e.stderr ?? "";
      }

      // The stub exits 7; the launcher must propagate that real exit code,
      // not swallow or normalize it.
      expect(exitCode).toBe(7);
      expect(stderr).toMatch(/warning/i);
      expect(stdout).toContain("stub pi ran: --probe");
      // Unlike the deny-path test, the stub genuinely ran here — the marker
      // file must exist (readFile resolving at all is the assertion; its
      // content is irrelevant, `touch` writes an empty file).
      await expect(readFile(markerPath, "utf-8")).resolves.toBeDefined();
    },
    20_000,
  );

  const bwrapAvailable = bwrapAvailableSync();

  it.runIf(bwrapAvailable)(
    "SECURITY REGRESSION GUARD (real bwrap): sandboxed run cannot rewrite projects.json/auth.json/trust.json, but can still write elsewhere in .pi/agent",
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), "thanos-launch-sandbox-"));
      workDirsToClean.push(workDir);
      const fakeHome = join(workDir, "home");
      const repoDir = join(workDir, "repo");
      // The stub bin dir MUST live inside repoDir, not as a bare sibling
      // under the temp root: buildBwrapArgv mounts a fresh, empty --tmpfs
      // /tmp inside the sandbox, which masks EVERYTHING else under the
      // host's real /tmp (including workDir itself). Only paths that get an
      // explicit --bind (repo, scratch tmp, .pi/agent, .bun) are re-exposed
      // after that tmpfs mount. repoDir gets exactly such a bind, so a stub
      // bin dir nested inside it stays visible; a sibling of repoDir does not
      // (verified empirically: an earlier version of this test placed the
      // stub bin dir as a workDir sibling and the sandboxed `pi` exec
      // silently fell through PATH resolution to node_modules/real system
      // state instead of ever finding the stub).
      const stubBinDir = join(repoDir, "bin");
      const agentDir = join(fakeHome, ".pi", "agent");

      await mkdir(repoDir, { recursive: true });
      await writeRegistry(agentDir, { mode: "local-only", autonomy: "unattended" });
      await writeFile(join(agentDir, "auth.json"), '{"real":"auth"}\n', "utf-8");
      await writeFile(join(agentDir, "trust.json"), '{"real":"trust"}\n', "utf-8");
      await writeFile(join(agentDir, "models-store.json"), '{"real":"store"}\n', "utf-8");

      const probeScript = [
        'echo PWNED > "$HOME/.pi/agent/projects.json" 2>&1; echo "projects.json write exit=$?"',
        'echo PWNED > "$HOME/.pi/agent/auth.json" 2>&1; echo "auth.json write exit=$?"',
        'echo PWNED > "$HOME/.pi/agent/trust.json" 2>&1; echo "trust.json write exit=$?"',
        'echo ok >> "$HOME/.pi/agent/models-store.json" 2>&1; echo "models-store.json write exit=$?"',
      ].join("; ");
      await writeExecutable(join(stubBinDir, "pi"), `#!/bin/sh\n${probeScript}\n`);

      const env = {
        ...process.env,
        HOME: fakeHome,
        PATH: pathWithRealBwrap(stubBinDir),
      };

      const { stdout } = await execFileAsync("bun", [launcherPath, "--run"], {
        cwd: repoDir,
        env,
      });

      expect(stdout).toMatch(/projects\.json write exit=(?!0)\d+/);
      expect(stdout).toMatch(/auth\.json write exit=(?!0)\d+/);
      expect(stdout).toMatch(/trust\.json write exit=(?!0)\d+/);
      // The un-locked file in the same directory must still be writable —
      // proves the re-lock targets specific files, not the whole directory.
      expect(stdout).toMatch(/models-store\.json write exit=0/);

      // And the real host-side files must be byte-for-byte unchanged.
      await expect(readFile(join(agentDir, "projects.json"), "utf-8")).resolves.not.toContain("PWNED");
      await expect(readFile(join(agentDir, "auth.json"), "utf-8")).resolves.toBe('{"real":"auth"}\n');
      await expect(readFile(join(agentDir, "trust.json"), "utf-8")).resolves.toBe('{"real":"trust"}\n');
    },
    30_000,
  );

  it.runIf(bwrapAvailable)(
    "SECURITY REGRESSION GUARD (real bwrap, files ABSENT beforehand): sandboxed run cannot CREATE projects.json/auth.json/trust.json with attacker content when they don't already exist",
    async () => {
      // Mirrors the exact live-reproduced Critical gap: --ro-bind-try is a
      // no-op when its source is missing, so with NO pre-creation logic, a
      // missing sensitive file left the parent rw bind in force and let the
      // sandboxed process create it from scratch with attacker content
      // (reproduced live: an absent projects.json + `--yolo` alone let a
      // sandboxed run fabricate mode:"no-mistakes"/autonomy:"unattended"/
      // unlocked yolo as the persisted registry; an absent auth.json let it
      // fabricate credentials). Every OTHER test in this file pre-creates
      // these files before invoking the launcher, so none of them exercised
      // this gap — this test deliberately does NOT.
      const workDir = await mkdtemp(join(tmpdir(), "thanos-launch-absent-"));
      workDirsToClean.push(workDir);
      const fakeHome = join(workDir, "home");
      const repoDir = join(workDir, "repo");
      const stubBinDir = join(repoDir, "bin"); // must be inside repoDir — see the tmpfs-masking note above
      const agentDir = join(fakeHome, ".pi", "agent");

      await mkdir(repoDir, { recursive: true });
      // Deliberately NOT calling writeRegistry / writing auth.json / writing
      // trust.json: the whole point is that .pi/agent (and everything under
      // it) does not exist yet when the launcher starts. `--yolo` is what
      // forces sandbox engagement despite the registry being fully absent
      // (mirroring the reviewer's exact scenario 1: registry missing ->
      // default local-only/attended, but --yolo alone satisfies
      // shouldSandbox's engagement condition).

      const probeScript = [
        'echo \'{"version":1,"default":{"mode":"no-mistakes","autonomy":"unattended"},"projects":[]}\' > "$HOME/.pi/agent/projects.json" 2>&1; echo "projects.json write exit=$?"',
        'echo \'{"anthropic":{"apiKey":"FAKE-STOLEN-KEY"}}\' > "$HOME/.pi/agent/auth.json" 2>&1; echo "auth.json write exit=$?"',
        'echo \'{"/":true}\' > "$HOME/.pi/agent/trust.json" 2>&1; echo "trust.json write exit=$?"',
      ].join("; ");
      await writeExecutable(join(stubBinDir, "pi"), `#!/bin/sh\n${probeScript}\n`);

      const env = {
        ...process.env,
        HOME: fakeHome,
        PATH: pathWithRealBwrap(stubBinDir),
      };

      // (a) the launcher must not crash.
      const { stdout } = await execFileAsync("bun", [launcherPath, "--yolo", "--run"], {
        cwd: repoDir,
        env,
      });

      // (b) the sandboxed process must never succeed in creating any of
      // them with attacker content.
      expect(stdout).toMatch(/projects\.json write exit=(?!0)\d+/);
      expect(stdout).toMatch(/auth\.json write exit=(?!0)\d+/);
      expect(stdout).toMatch(/trust\.json write exit=(?!0)\d+/);
      expect(stdout).not.toContain("no-mistakes");
      expect(stdout).not.toContain("FAKE-STOLEN-KEY");

      // (c) after the run, the launcher's own pre-creation must have left
      // each file existing with the safe empty-equivalent placeholder — not
      // attacker content, and not still missing (missing would mean the
      // --ro-bind-try never had a source, i.e. the gap is back).
      const projectsContent = await readFile(join(agentDir, "projects.json"), "utf-8");
      expect(projectsContent).not.toContain("no-mistakes");
      expect(JSON.parse(projectsContent)).toEqual({
        version: 1,
        default: { mode: "local-only", autonomy: "attended" },
        projects: [],
      });

      const authContent = await readFile(join(agentDir, "auth.json"), "utf-8");
      expect(authContent).not.toContain("FAKE-STOLEN-KEY");
      expect(JSON.parse(authContent)).toEqual({});

      const trustContent = await readFile(join(agentDir, "trust.json"), "utf-8");
      expect(JSON.parse(trustContent)).toEqual({});

      // And a subsequent real (non-sandboxed) delivery resolution against
      // the now-pre-created registry must be identical to what "registry
      // still missing" would have resolved to — proving pre-creation
      // changed nothing about real delivery semantics. Spawned with the
      // SAME env (HOME=fakeHome) as the launcher run above — importing
      // resolveDeliveryState directly in this test process would read the
      // test runner's own real $HOME, not the fake one.
      const deliveryCheckScript = [
        'import { resolveDeliveryState } from "' + join(root, "src", "governance", "delivery.ts") + '";',
        "const d = await resolveDeliveryState(process.argv[1]);",
        "console.log(JSON.stringify(d));",
      ].join("\n");
      const { stdout: deliveryStdout } = await execFileAsync(
        "bun",
        ["-e", deliveryCheckScript, repoDir],
        { env },
      );
      const resolvedAfter = JSON.parse(deliveryStdout);
      expect(resolvedAfter.mode).toBe("local-only");
      expect(resolvedAfter.autonomy).toBe("attended");
      expect(resolvedAfter.registered).toBe(false);
    },
    30_000,
  );

  if (!bwrapAvailable) {
    it("bwrap is unavailable in this environment — the strongest live regression guard above was skipped; static argv-shape coverage in sandbox.test.ts is the fallback", () => {
      expect(bwrapAvailable).toBe(false);
    });
  }
});
