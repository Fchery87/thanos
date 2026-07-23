#!/usr/bin/env bun
/**
 * `thanos` launcher: resolves this repo's delivery state, decides whether to
 * engage the launcher-level bwrap sandbox (see src/security/sandbox.ts for
 * the policy and the corrected `--ro-bind / /`-based bwrap invocation), and
 * execs `pi` either directly or wrapped in bwrap.
 *
 * Why this lives outside Pi's extension system: Pi's `tool_call` extension
 * hook can only allow or block an individual tool call — it cannot rewrite a
 * command or re-exec the whole process under a different wrapper (verified
 * against node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/
 * runner.js around the tool_call dispatch, which invokes the tool directly
 * with no re-exec hook). Containment that needs to wrap the entire `pi`
 * process (not one tool call at a time) has to happen a layer up, at the
 * process that launches `pi` in the first place — hence this launcher.
 *
 * Shebang is `bun`, not `node`: this script imports src/governance/delivery.ts
 * and src/security/sandbox.ts directly as TypeScript with extension-less
 * internal imports (this repo's normal moduleResolution style). Bun resolves
 * those natively; plain Node's built-in TS stripping does not resolve
 * extension-less relative specifiers, so `node` can't run this file as-is.
 * Bun is already a hard prerequisite for this repo (see scripts/install.sh),
 * so this adds no new requirement.
 *
 * Dependency-free: only Node/Bun built-ins are used here, no new npm packages.
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDeliveryState } from "../src/governance/delivery.ts";
import {
  buildBwrapArgv,
  SENSITIVE_AGENT_FILES,
  SENSITIVE_AGENT_FILE_PLACEHOLDERS,
  shouldSandbox,
} from "../src/security/sandbox.ts";

const rawArgs = process.argv.slice(2);

// `--yolo` is a launcher-only flag: it is NOT understood by `pi` itself (pi
// has no such CLI flag; yolo is normally toggled interactively via the /yolo
// slash command once a session is already running). Since that interactive
// toggle happens after `pi` has started, this launcher cannot observe it —
// the only way to factor "yolo" into the launch-time sandbox decision is a
// flag passed to the launcher itself, for headless/scripted invocations that
// want to start already-armed (e.g. `thanos --yolo -p "..."`). We strip it
// before forwarding the rest of argv to `pi`.
const yolo = rawArgs.includes("--yolo");
const innerArgs = rawArgs.filter((a) => a !== "--yolo");

/** Real presence check for bwrap: spawn `bwrap --version` and check it exits 0. */
function detectBwrap() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      const check = spawn("bwrap", ["--version"], { stdio: "ignore" });
      check.on("error", () => done(false));
      check.on("exit", (code) => done(code === 0));
    } catch {
      done(false);
    }
  });
}

/**
 * SECURITY-CRITICAL, second-round fix — see src/security/sandbox.ts's
 * SENSITIVE_AGENT_FILE_PLACEHOLDERS doc comment for the full story.
 *
 * `--ro-bind-try` in buildBwrapArgv is a no-op when its source is missing,
 * which means a genuinely-missing sensitive file (fresh install, freshly
 * provisioned CI/container) gets NO override mount — the parent rw bind of
 * `$agentDir` stays in force for it, and a sandboxed process can CREATE that
 * file with attacker-controlled content that then persists on the real host
 * disk (reproduced live: an absent `projects.json` let a sandboxed run
 * fabricate its own `mode: "no-mistakes"`/unlocked-yolo registry; an absent
 * `auth.json` let it fabricate credentials).
 *
 * This MUST run before buildBwrapArgv/spawn — every entry in
 * SENSITIVE_AGENT_FILES needs to already exist on disk by the time bwrap's
 * argv is built, so every `--ro-bind-try` has a real source to lock.
 *
 * Uses an exclusive `wx` write (fails with EEXIST if the file already
 * exists) rather than an existence check + separate write, to avoid a
 * TOCTOU race between two concurrent `thanos` launches both seeing "missing"
 * — the loser of the race just hits EEXIST and moves on, never overwriting
 * whatever the winner (or a real pre-existing file) put there. A real
 * pre-existing file's content is NEVER touched by this function.
 */
async function ensureSensitiveAgentFilesExist(agentDir) {
  await Promise.all(
    SENSITIVE_AGENT_FILES.map(async (name) => {
      const path = join(agentDir, name);
      const placeholder = SENSITIVE_AGENT_FILE_PLACEHOLDERS[name];
      try {
        await writeFile(path, placeholder, { flag: "wx", mode: 0o600 });
      } catch (err) {
        if (err && err.code === "EEXIST") return; // real file already there — never touch it
        throw err;
      }
    }),
  );
}

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * Forward a child's exit/signal behavior onto this process, AND forward
 * signals this process receives down to the child.
 *
 * Without the latter, Node/Bun's default disposition for an unhandled
 * SIGINT/SIGTERM is to terminate the launcher immediately — which orphans
 * the child (`bwrap`, or `pi` directly) instead of killing it. Verified by
 * manual test: sending SIGTERM to an unmodified launcher left the child
 * `pi` process (and its own children) running as orphans after the launcher
 * exited. Installing these handlers is what makes Ctrl-C / SIGTERM on the
 * wrapper actually tear down the whole process tree.
 *
 * `onSettle` (optional) runs synchronously right before every exit path —
 * used to rm -rf the per-run scratch tmp dir so sandboxed runs don't leak a
 * fresh `thanos-sandbox-*` directory under the host's real tmpdir on every
 * invocation (mkdtemp dirs are not cleaned up by anything else).
 */
function forwardExit(child, onSettle) {
  const signalHandlers = new Map();
  for (const sig of FORWARDED_SIGNALS) {
    const handler = () => {
      child.kill(sig);
    };
    signalHandlers.set(sig, handler);
    process.on(sig, handler);
  }

  const cleanupSignalHandlers = () => {
    for (const [sig, handler] of signalHandlers) {
      process.off(sig, handler);
    }
  };

  child.on("error", (err) => {
    cleanupSignalHandlers();
    onSettle?.();
    console.error(`[thanos] failed to launch: ${err.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    cleanupSignalHandlers();
    onSettle?.();
    if (signal) {
      // Re-raise the same signal on ourselves so the parent shell sees the
      // conventional 128+n exit status / correct signal semantics.
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

async function main() {
  const cwd = process.cwd();
  const plat = platform();

  const delivery = await resolveDeliveryState(cwd);
  const bwrapAvailable = plat === "linux" ? await detectBwrap() : false;

  const decision = shouldSandbox({
    platform: plat,
    bwrapAvailable,
    mode: delivery.mode,
    autonomy: delivery.autonomy,
    yolo,
  });

  if (decision.action === "deny") {
    console.error(`[thanos] ${decision.reason}`);
    process.exit(1);
  }

  if (decision.action === "warn") {
    console.error(`[thanos] warning: ${decision.reason}`);
  }

  if (!decision.sandbox) {
    const child = spawn("pi", innerArgs, { stdio: "inherit" });
    forwardExit(child);
    return;
  }

  const home = homedir();
  const agentDir = join(home, ".pi", "agent");
  // bwrap hard-fails if a --bind source doesn't exist yet; ensure the rw
  // toolchain dirs exist before we ever hand argv to bwrap. (No ~/.cache
  // here: buildBwrapArgv no longer binds it at all — see sandbox.ts for why.)
  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(join(home, ".bun"), { recursive: true }),
  ]);
  // MUST run after the mkdir above (needs agentDir to exist) and before
  // buildBwrapArgv/spawn below (every --ro-bind-try needs a real source) —
  // see ensureSensitiveAgentFilesExist's doc comment for why this exists.
  await ensureSensitiveAgentFilesExist(agentDir);

  const scratchTmp = await mkdtemp(join(tmpdir(), "thanos-sandbox-"));

  const argv = buildBwrapArgv({
    repo: cwd,
    tmp: scratchTmp,
    home,
    inner: ["pi", ...innerArgs],
  });

  const cleanupScratch = () => {
    rmSync(scratchTmp, { recursive: true, force: true });
  };

  const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
  forwardExit(child, cleanupScratch);
}

main().catch((err) => {
  console.error(`[thanos] unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
