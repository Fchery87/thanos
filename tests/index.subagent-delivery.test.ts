import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import register from "../src/index";

/**
 * INTEGRATION test for the subagent delivery-mode WIRING.
 *
 * The companion unit test (tests/hooks/subagent-delivery-composition.test.ts)
 * proves the gate *composition* in isolation by hand-building the overlay +
 * autonomy and calling makeBeforeToolHandler directly. What it does NOT prove is
 * that the real register() → pi.on("tool_call") path actually:
 *   (a) resolves delivery from the repo (registry by git remote) at register()
 *       time using process.cwd(), in a SUBAGENT process, and
 *   (b) prepends the delivery overlay + applies the resolved autonomy when it
 *       builds the before-tool handler for each tool_call event.
 *
 * This test drives the REAL handler captured off the mocked pi.on, in a hermetic
 * temp HOME + temp git repo, with PI_SUBAGENT_CHILD=1 to simulate a child.
 */

type Handler = (event: unknown, ctx: unknown) => unknown;
type RegisterApi = Parameters<typeof register>[0];

// Pull the registered tool_call handler back off the mocked pi.on.
function getToolCallHandler(api: { on: { mock: { calls: unknown[][] } } }): Handler {
  const call = api.on.mock.calls.find(([evt]) => evt === "tool_call");
  if (!call) throw new Error("register() did not register a tool_call handler");
  return call[1] as Handler;
}

function createFakePi() {
  const api = {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    getThinkingLevel: vi.fn(() => "off"),
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
  };
  return api as unknown as RegisterApi & { on: { mock: { calls: unknown[][] } } };
}

// Minimal ExtensionContext the tool_call handler (and the lens/contextGuard it
// chains into) actually dereferences: hasUI, ui.confirm/notify/setStatus,
// ui.theme.fg, cwd, sessionManager. confirm THROWS so any path that would reach
// an interactive prompt fails loudly instead of silently passing.
function makeCtx(cwd: string, hasUI: boolean) {
  return {
    hasUI,
    cwd,
    ui: {
      confirm: vi.fn(async () => {
        throw new Error("ctx.ui.confirm must NOT be reached in these headless scenarios");
      }),
      notify: vi.fn(),
      setStatus: vi.fn(),
      theme: { fg: (_kind: string, text: string) => text, bold: (t: string) => t },
    },
    sessionManager: {
      getSessionId: () => "test-session",
      getBranch: () => "main",
      getSessionDir: () => cwd,
    },
  };
}

let savedHome: string | undefined;
let savedChild: string | undefined;
let savedCwd: string;
let homeDir: string;
let repoDir: string;

beforeEach(async () => {
  savedHome = process.env.HOME;
  savedChild = process.env.PI_SUBAGENT_CHILD;
  savedCwd = process.cwd();

  homeDir = await mkdtemp(path.join(tmpdir(), "subagent-delivery-home-"));
  repoDir = await mkdtemp(path.join(tmpdir(), "subagent-delivery-repo-"));

  // Deterministic remote so the registry can match this repo by `match`.
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
  execFileSync("git", ["remote", "add", "origin", "https://example.com/acme/widget.git"], { cwd: repoDir });

  process.env.HOME = homeDir;
  process.env.PI_SUBAGENT_CHILD = "1"; // simulate a subagent (child) process
  // resolveDeliveryState reads process.cwd() at register() time.
  process.chdir(repoDir);
});

afterEach(async () => {
  // Restore cwd FIRST so subsequent tests (and rm below) are not affected.
  process.chdir(savedCwd);
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedChild === undefined) delete process.env.PI_SUBAGENT_CHILD;
  else process.env.PI_SUBAGENT_CHILD = savedChild;

  vi.clearAllMocks();
  await rm(homeDir, { recursive: true, force: true });
  await rm(repoDir, { recursive: true, force: true });
});

async function writeRegistry(contents: unknown): Promise<void> {
  const dir = path.join(homeDir, ".pi", "agent");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "projects.json"), JSON.stringify(contents), "utf-8");
}

describe("subagent delivery wiring (real register + tool_call gate)", () => {
  it("Scenario A: registered unattended + local-only — auto-approves edit, blocks git push", async () => {
    await writeRegistry({
      version: 1,
      default: { mode: "local-only", autonomy: "attended" },
      projects: [
        {
          match: "https://example.com/acme/widget.git",
          mode: "local-only",
          autonomy: "unattended",
        },
      ],
    });

    const api = createFakePi();
    register(api);
    const handler = getToolCallHandler(api);
    const ctx = makeCtx(repoDir, /* hasUI */ false);

    // EDIT is capability "edit", tier "high" → normally "ask". Under the repo's
    // resolved UNATTENDED autonomy the gate must auto-approve (return undefined)
    // even with no UI — proving autonomy was resolved + applied via register().
    // Use a path that does NOT exist in the temp repo so the lens
    // read-before-modify guard does not independently block the edit.
    const editResult = await handler(
      { toolName: "edit", input: { path: "src/does-not-exist.ts", new_string: "x" } },
      ctx,
    );
    expect(editResult).toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled(); // no interactive prompt was needed

    // git push must STILL be denied by the local-only overlay — the overlay deny
    // wins over unattended auto-approve. This is the key security property, now
    // proven through the REAL register() wiring (overlay prepended at the gate).
    const pushResult = (await handler(
      { toolName: "bash", input: { command: "git push origin main" } },
      ctx,
    )) as { block?: boolean; reason?: string } | undefined;
    expect(pushResult?.block).toBe(true);
    expect(pushResult?.reason).toContain("local-only");
  });

  it("Scenario B: unregistered repo fails closed — edit blocked with no UI", async () => {
    // Empty registry → no project matches this remote → resolves to the safe
    // default (local-only / ATTENDED). A subagent has no UI, so an "ask"/high
    // edit must BLOCK rather than auto-run. This is Option X: an unregistered
    // repo does NOT auto-run subagent writes.
    await writeRegistry({
      version: 1,
      default: { mode: "local-only", autonomy: "attended" },
      projects: [],
    });

    const api = createFakePi();
    register(api);
    const handler = getToolCallHandler(api);
    const ctx = makeCtx(repoDir, /* hasUI */ false);

    const editResult = (await handler(
      { toolName: "edit", input: { path: "src/does-not-exist.ts", new_string: "x" } },
      ctx,
    )) as { block?: boolean; reason?: string } | undefined;
    expect(editResult?.block).toBe(true);
    expect(editResult?.reason).toMatch(/no UI|confirmation/i);
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("Scenario B2: NO registry file at all also fails closed", async () => {
    // Not even ${HOME}/.pi/agent/projects.json exists → loadRegistry returns null
    // → resolveDelivery collapses to local-only/attended. Same fail-closed result.
    const api = createFakePi();
    register(api);
    const handler = getToolCallHandler(api);
    const ctx = makeCtx(repoDir, /* hasUI */ false);

    const editResult = (await handler(
      { toolName: "edit", input: { path: "src/does-not-exist.ts", new_string: "x" } },
      ctx,
    )) as { block?: boolean; reason?: string } | undefined;
    expect(editResult?.block).toBe(true);
  });
});
