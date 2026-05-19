import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatScanResult, scanContent } from "../security/scanner";
import { formatPanel, noopTheme } from "../ui-utils";

type ToolCallEvent = {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
};

type ToolResultEvent = {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
};

type ReadRange = {
  offset: number;
  limit?: number;
  at: number;
};

type ChangedFile = {
  path: string;
  toolName: string;
  at: number;
};

type DiagnoseResult = {
  name: string;
  ok: boolean;
  skipped?: boolean;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  reason?: string;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_OUTPUT_CHARS = 6_000;
const MAX_TRACKED_FILES = 200;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated (${text.length - MAX_OUTPUT_CHARS} more chars)`;
}

function nearestExistingDir(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function findUp(start: string, names: string[]): string | undefined {
  let current = nearestExistingDir(start);
  if (!existsSync(current)) current = dirname(current);
  while (true) {
    for (const name of names) {
      const candidate = join(current, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findProjectRoot(cwd: string): string {
  const marker = findUp(cwd, [".git", "package.json", "pyproject.toml", "go.mod", "Cargo.toml"]);
  return marker ? dirname(marker) : cwd;
}

function hasAny(root: string, names: string[]): boolean {
  return names.some((name) => existsSync(join(root, name)));
}

function readPackageJson(root: string): Record<string, unknown> | undefined {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return undefined;
  try {
    return JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function packageHasScript(pkg: Record<string, unknown> | undefined, script: string): boolean {
  const scripts = asRecord(pkg?.scripts);
  return typeof scripts[script] === "string";
}

function packageHasDependency(pkg: Record<string, unknown> | undefined, name: string): boolean {
  const deps = asRecord(pkg?.dependencies);
  const devDeps = asRecord(pkg?.devDependencies);
  return typeof deps[name] === "string" || typeof devDeps[name] === "string";
}

function resolveToolPath(rawPath: unknown, cwd: string): string | undefined {
  const value = asString(rawPath);
  if (!value) return undefined;
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}

function getToolPath(event: ToolCallEvent | ToolResultEvent, cwd: string): string | undefined {
  const input = asRecord(event.input);
  return resolveToolPath(input.path ?? input.filePath ?? input.filename, cwd);
}

function getReadRange(input: Record<string, unknown>): ReadRange {
  const offsetRaw = Number(input.offset ?? 1);
  const limitRaw = input.limit === undefined ? undefined : Number(input.limit);
  return {
    offset: Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 1,
    limit: Number.isFinite(limitRaw) && limitRaw! > 0 ? Math.floor(limitRaw!) : undefined,
    at: Date.now(),
  };
}

function collectNewContent(input: Record<string, unknown>): string {
  const chunks: string[] = [];
  for (const key of ["content", "newText", "new_string", "replacement"] as const) {
    const value = input[key];
    if (typeof value === "string") chunks.push(value);
  }
  const edits = Array.isArray(input.edits) ? input.edits : [];
  for (const edit of edits) {
    const record = asRecord(edit);
    for (const key of ["newText", "new_string", "content"] as const) {
      const value = record[key];
      if (typeof value === "string") chunks.push(value);
    }
  }
  return chunks.join("\n");
}

function rangesOverlap(read: ReadRange, editStart?: number, editEnd?: number): boolean {
  if (editStart === undefined || editEnd === undefined) return true;
  const readStart = read.offset;
  const readEnd = read.limit ? read.offset + read.limit - 1 : Number.POSITIVE_INFINITY;
  return readStart <= editEnd && editStart <= readEnd;
}

function estimateEditRange(input: Record<string, unknown>): { start?: number; end?: number } {
  const line = Number(input.line ?? input.startLine ?? input.offset);
  if (Number.isFinite(line) && line > 0) return { start: Math.floor(line), end: Math.floor(line) };
  return {};
}

function hasMeaningfulOldText(input: Record<string, unknown>): boolean {
  const candidates: string[] = [];
  for (const key of ["oldText", "old_string", "old_text"] as const) {
    const value = input[key];
    if (typeof value === "string") candidates.push(value);
  }
  const edits = Array.isArray(input.edits) ? input.edits : [];
  for (const edit of edits) {
    const record = asRecord(edit);
    for (const key of ["oldText", "old_string", "old_text"] as const) {
      const value = record[key];
      if (typeof value === "string") candidates.push(value);
    }
  }
  return candidates.some((text) => text.includes("\n") || text.trim().length >= 16);
}

function runCommand(name: string, cmd: string, args: string[], cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DiagnoseResult> {
  const started = Date.now();
  return new Promise((resolveResult) => {
    const child = execFile(cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - started;
      const err = error as (Error & { code?: string; signal?: string; killed?: boolean }) | null;
      resolveResult({
        name,
        ok: !error,
        durationMs,
        stdout: truncateOutput(String(stdout ?? "")),
        stderr: truncateOutput(String(stderr ?? "")),
        reason: error ? (err?.killed || err?.signal === "SIGTERM" ? `timed out after ${timeoutMs}ms` : err?.message ?? String(error)) : undefined,
      });
    });
    child.on("error", (err) => {
      resolveResult({ name, ok: false, durationMs: Date.now() - started, reason: err.message });
    });
  });
}

function formatDiagnoseResult(result: DiagnoseResult): string {
  if (result.skipped) return `• ${result.name}: skipped — ${result.reason ?? "not configured"}`;
  const mark = result.ok ? "✓" : "✗";
  const duration = result.durationMs === undefined ? "" : ` (${result.durationMs}ms)`;
  const body = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const reason = result.reason ? ` — ${result.reason}` : "";
  return body
    ? `${mark} ${result.name}${duration}${reason}\n${body}`
    : `${mark} ${result.name}${duration}${reason}`;
}

export class LensLite {
  private enabled = true;
  private strictReadGuard = false;
  private readonly reads = new Map<string, ReadRange[]>();
  private readonly changed = new Map<string, ChangedFile>();
  private readonly warnedNoRead = new Set<string>();
  private warningsThisTurn = 0;

  constructor(private readonly sessionId: string) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setStrictReadGuard(enabled: boolean): void {
    this.strictReadGuard = enabled;
  }

  beginTurn(): void {
    this.warningsThisTurn = 0;
  }

  changedFiles(): ChangedFile[] {
    return [...this.changed.values()].sort((a, b) => b.at - a.at);
  }

  clear(): void {
    this.reads.clear();
    this.changed.clear();
    this.warnedNoRead.clear();
    this.warningsThisTurn = 0;
  }

  statusLine(): string {
    const state = this.enabled ? "on" : "off";
    const strict = this.strictReadGuard ? "strict" : "advisory";
    return `lens-lite:${state} · ${strict} · ${this.changed.size} changed · ${this.reads.size} read`;
  }

  setStatus(ctx: ExtensionContext): void {
    const theme = ctx.ui.theme ?? noopTheme;
    ctx.ui.setStatus("harness-lens", this.enabled ? theme.fg("accent", `lens:${this.changed.size}`) : theme.fg("dim", "lens:off"));
  }

  async beforeTool(event: ToolCallEvent, ctx: ExtensionContext): Promise<{ block: true; reason: string } | undefined> {
    if (!this.enabled) return undefined;
    const toolName = event.toolName ?? "";
    const cwd = ctx.cwd ?? process.cwd();
    const filePath = getToolPath(event, cwd);
    const input = asRecord(event.input);

    if (toolName === "read" && filePath) {
      this.recordRead(filePath, getReadRange(input));
      this.setStatus(ctx);
      return undefined;
    }

    if ((toolName === "write" || toolName === "edit") && filePath) {
      const secretVerdict = await this.checkSecrets(toolName, input, ctx);
      if (secretVerdict) return secretVerdict;

      const readVerdict = this.checkReadBeforeModify(toolName, filePath, input, ctx);
      if (readVerdict) return readVerdict;

      this.trackChanged(filePath, toolName);
      this.setStatus(ctx);
    }

    return undefined;
  }

  afterTool(_event: ToolResultEvent, ctx: ExtensionContext): void {
    if (!this.enabled) return;
    this.setStatus(ctx);
  }

  private recordRead(filePath: string, range: ReadRange): void {
    const key = resolve(filePath);
    const ranges = this.reads.get(key) ?? [];
    ranges.push(range);
    this.reads.set(key, ranges.slice(-20));
  }

  private trackChanged(filePath: string, toolName: string): void {
    const key = resolve(filePath);
    this.changed.set(key, { path: key, toolName, at: Date.now() });
    if (this.changed.size > MAX_TRACKED_FILES) {
      const oldest = [...this.changed.values()].sort((a, b) => a.at - b.at)[0];
      if (oldest) this.changed.delete(oldest.path);
    }
  }

  private async checkSecrets(toolName: string, input: Record<string, unknown>, ctx: ExtensionContext): Promise<{ block: true; reason: string } | undefined> {
    const content = collectNewContent(input);
    if (!content) return undefined;
    const scan = scanContent(content);
    if (!scan.found) return undefined;

    const detail = formatScanResult(scan.matches);
    if (!ctx.hasUI) {
      return { block: true, reason: `Secret detected in ${toolName}: ${scan.matches[0]?.type}` };
    }

    const proceed = await ctx.ui.confirm(
      "Lens Lite: Secret Detected",
      `Potential credentials found:\n${detail}\n\nProceed anyway?`,
    );
    if (!proceed) {
      return { block: true, reason: `Secret detected — ${toolName} blocked: ${scan.matches[0]?.type}` };
    }
    return undefined;
  }

  private hasPriorRead(filePath: string, input: Record<string, unknown>): boolean {
    const key = resolve(filePath);
    const ranges = this.reads.get(key) ?? [];
    const editRange = estimateEditRange(input);
    return ranges.some((range) => rangesOverlap(range, editRange.start, editRange.end));
  }

  private checkReadBeforeModify(toolName: string, filePath: string, input: Record<string, unknown>, ctx: ExtensionContext): { block: true; reason: string } | undefined {
    const key = resolve(filePath);
    const rel = relative(ctx.cwd ?? process.cwd(), key) || key;
    const existingFile = existsSync(key);
    const priorRead = this.hasPriorRead(key, input);
    if (priorRead) return undefined;

    if (this.strictReadGuard && existingFile) {
      return {
        block: true,
        reason: `Lens Lite read-before-edit guard: Modifying ${rel} without a recorded prior read this session. Read the file first, then retry.`,
      };
    }

    // Default mode is high-signal and low-noise:
    // - exact/meaningful oldText edits already have an atomic match guard from the edit tool
    // - files already changed this session have been through this guard once
    // - new files do not need prior reads
    // - risky modifications are blocked, not merely warned, so the model must read first
    if (!existingFile || this.changed.has(key)) return undefined;
    if (toolName === "edit" && hasMeaningfulOldText(input)) return undefined;

    const action = toolName === "write" ? "Overwriting" : "Editing";
    this.warnedNoRead.add(key);
    const message = `${action} ${rel} without a recorded prior read this session. Read this file first, then retry the modification. This guard is intentional: context-backed edits produce better output than blind changes.`;
    return { block: true, reason: `Lens Lite read-before-modify guard: ${message}` };
  }

  async diagnose(ctx: ExtensionContext, targetFiles?: string[]): Promise<string> {
    const cwd = ctx.cwd ?? process.cwd();
    const projectRoot = findProjectRoot(cwd);
    const files = unique((targetFiles?.length ? targetFiles : this.changedFiles().map((f) => f.path))
      .map((file) => isAbsolute(file) ? resolve(file) : resolve(cwd, file))
      .filter((file) => existsSync(file)));

    if (files.length === 0) {
      return "No changed files to diagnose. Use `/lens diagnose <file>` or edit a file first.";
    }

    const relFiles = files.map((file) => relative(projectRoot, file)).filter((file) => file && !file.startsWith(".."));
    const pkg = readPackageJson(projectRoot);
    const results: DiagnoseResult[] = [];

    results.push(await runCommand("git diff --check", "git", ["diff", "--check", "--", ...relFiles], projectRoot, 5_000));

    const jsFiles = relFiles.filter((file) => /\.[cm]?[jt]sx?$/.test(file));
    if (jsFiles.length > 0 && hasAny(projectRoot, ["biome.json", "biome.jsonc"]) && packageHasDependency(pkg, "@biomejs/biome")) {
      results.push(await runCommand("biome check changed files", "npx", ["--no-install", "biome", "check", ...jsFiles], projectRoot));
    } else if (jsFiles.length > 0) {
      results.push({ name: "biome check changed files", ok: true, skipped: true, reason: "Biome config/dependency not found" });
    }

    if (jsFiles.length > 0 && (hasAny(projectRoot, ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs"]) || packageHasScript(pkg, "lint")) && packageHasDependency(pkg, "eslint")) {
      results.push(await runCommand("eslint changed files", "npx", ["--no-install", "eslint", ...jsFiles], projectRoot));
    } else if (jsFiles.length > 0) {
      results.push({ name: "eslint changed files", ok: true, skipped: true, reason: "ESLint config/dependency not found" });
    }

    const pyFiles = relFiles.filter((file) => file.endsWith(".py"));
    if (pyFiles.length > 0 && hasAny(projectRoot, ["pyproject.toml", "ruff.toml", ".ruff.toml"])) {
      results.push(await runCommand("ruff changed files", "ruff", ["check", ...pyFiles], projectRoot));
    } else if (pyFiles.length > 0) {
      results.push({ name: "ruff changed files", ok: true, skipped: true, reason: "Ruff config not found" });
    }

    const failed = results.filter((r) => !r.ok && !r.skipped).length;
    const header = `Lens Lite diagnostics for ${files.length} file(s) from ${projectRoot}${failed ? ` — ${failed} issue group(s)` : ""}`;
    return [header, "", ...results.map(formatDiagnoseResult)].join("\n");
  }
}

export function registerLensLiteCommand(pi: ExtensionAPI, lens: LensLite): void {
  pi.registerCommand("lens", {
    description: "Thanos Lens Lite: status, changed files, advisory read guard, and manual changed-file diagnostics. Usage: /lens [status|changed|diagnose|on|off|strict|clear]",
    handler: async (args, ctx) => {
      const parts = String(args ?? "").trim().split(/\s+/).filter(Boolean);
      const action = parts[0] ?? "status";
      const theme = ctx.ui.theme ?? noopTheme;

      if (action === "on") {
        lens.setEnabled(true);
        lens.setStatus(ctx);
        ctx.ui.notify("Lens Lite enabled.", "info");
        return;
      }
      if (action === "off") {
        lens.setEnabled(false);
        lens.setStatus(ctx);
        ctx.ui.notify("Lens Lite disabled for this session.", "warning");
        return;
      }
      if (action === "strict") {
        const next = parts[1] === "on";
        lens.setStrictReadGuard(next);
        ctx.ui.notify(`Lens Lite read-before-edit strict mode ${next ? "enabled" : "disabled"}.`, next ? "warning" : "info");
        return;
      }
      if (action === "clear") {
        lens.clear();
        lens.setStatus(ctx);
        ctx.ui.notify("Lens Lite session state cleared.", "info");
        return;
      }
      if (action === "changed") {
        const changed = lens.changedFiles();
        const body = changed.length === 0
          ? "No files changed this session."
          : changed.slice(0, 40).map((file) => `• ${relative(ctx.cwd ?? process.cwd(), file.path) || file.path} (${file.toolName})`).join("\n");
        ctx.ui.notify(formatPanel(theme, "Lens Lite Changed Files", body, "accent"), "info");
        return;
      }
      if (action === "diagnose") {
        const files = parts.slice(1);
        const report = await lens.diagnose(ctx, files);
        ctx.ui.notify(formatPanel(theme, "Lens Lite Diagnose", report, report.includes("✗") ? "warning" : "success"), report.includes("✗") ? "warning" : "info");
        return;
      }

      ctx.ui.notify(formatPanel(theme, "Lens Lite", [
        lens.statusLine(),
        "",
        "Commands:",
        "  /lens changed          show files edited this session",
        "  /lens diagnose [file]  run bounded checks on changed files only",
        "  /lens strict on|off    block edit without prior read when on",
        "  /lens clear            clear session lens state",
        "  /lens on|off           toggle Lens Lite for this session",
      ].join("\n"), "accent"), "info");
    },
  });
}
