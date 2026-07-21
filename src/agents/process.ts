import { spawn, type ChildProcess } from "node:child_process";

export type RunOutcome = "completed" | "cancelled" | "timeout" | "process_error" | "invalid_result";

export interface ProcessResult {
  outcome: RunOutcome;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ProcessOptions {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxStderrBytes?: number;
}

const GRACEFUL_TIMEOUT_MS = 2000;
const MAX_STDERR_BYTES = 64 * 1024; // 64 KB

export function executeProcess(opts: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child: ChildProcess = spawn(opts.cmd, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...(process.platform !== "win32" ? { detached: false } : {}),
    });

    let stdout = "";
    let stderrBuf = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const maxStderr = opts.maxStderrBytes ?? MAX_STDERR_BYTES;

    const finish = (outcome: RunOutcome) => {
      if (settled) return;
      settled = true;
      const durationMs = Date.now() - startedAt;
      const stderr = stderrBuf.slice(0, maxStderr);
      resolve({ outcome, exitCode: child.exitCode, stdout, stderr, durationMs });
    };

    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderrBuf.length < maxStderr) {
        stderrBuf += d.toString();
      }
    });

    child.on("close", (code) => {
      if (timedOut) finish("timeout");
      else if (cancelled) finish("cancelled");
      else if (code === 0) finish("completed");
      else finish("process_error");
    });

    child.on("error", () => {
      finish("process_error");
    });

    const killProcess = (signal: NodeJS.Signals) => {
      if (process.platform === "win32") {
        child.kill(signal);
      } else {
        try {
          process.kill(-child.pid!, signal);
        } catch {
          child.kill(signal);
        }
      }
    };

    const forceTerminate = () => {
      killProcess("SIGKILL");
    };

    const gracefulTerminate = () => {
      killProcess("SIGTERM");
      const forceTimeout = setTimeout(forceTerminate, GRACEFUL_TIMEOUT_MS);
      child.once("close", () => clearTimeout(forceTimeout));
    };

    const timeoutId = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          gracefulTerminate();
        }, opts.timeoutMs)
      : undefined;

    const abortHandler = () => {
      cancelled = true;
      gracefulTerminate();
    };

    opts.signal?.addEventListener("abort", abortHandler);

    child.once("close", () => {
      if (timeoutId) clearTimeout(timeoutId);
      opts.signal?.removeEventListener("abort", abortHandler);
    });
  });
}
