import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import register from "../src/index";

/**
 * INTEGRATION test for the first-launch delivery-mode SELECTOR wiring.
 *
 * The unit tests (tests/governance/delivery-select.test.ts) prove the pure
 * upsert + persistence. What they do NOT prove is that the real register() →
 * pi.on("session_start") path actually:
 *   (a) prompts via ctx.ui.select exactly when the repo is UNREGISTERED and an
 *       interactive UI exists (parent process only),
 *   (b) persists the choice to ~/.pi/agent/projects.json keyed by the repo's
 *       remote, granting attended autonomy only, and
 *   (c) swaps the LIVE session's delivery state, so a mode chosen at the prompt
 *       takes effect immediately (the local-only push-deny overlay is lifted
 *       for direct-PR without restarting the session), while
 *   (d) ESC / no-UI / already-registered paths change NOTHING (fail-closed).
 *
 * Same harness pattern as tests/index.subagent-delivery.test.ts: real handlers
 * captured off a mocked pi.on, hermetic temp HOME + temp git repo — but as the
 * PARENT process (PI_SUBAGENT_CHILD unset): the selector must never run in
 * subagents.
 */

type Handler = (event: unknown, ctx: unknown) => unknown;
type RegisterApi = Parameters<typeof register>[0];

const REMOTE = "https://example.com/acme/widget.git";

function getHandler(api: { on: { mock: { calls: unknown[][] } } }, name: string): Handler {
  const call = api.on.mock.calls.find(([evt]) => evt === name);
  if (!call) throw new Error(`register() did not register a ${name} handler`);
  return call[1] as Handler;
}

function getCommandHandler(
  api: { registerCommand: { mock: { calls: unknown[][] } } },
  name: string,
): (args: string, ctx: unknown) => Promise<void> {
  const call = api.registerCommand.mock.calls.find(([cmd]) => cmd === name);
  if (!call) throw new Error(`register() did not register a /${name} command`);
  return (call[1] as { handler: (args: string, ctx: unknown) => Promise<void> }).handler;
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
  return api as unknown as RegisterApi & {
    on: { mock: { calls: unknown[][] } };
    registerCommand: { mock: { calls: unknown[][] } };
  };
}

function makeCtx(cwd: string, hasUI: boolean, selectResult?: string | ((options: string[]) => string | undefined)) {
  return {
    hasUI,
    cwd,
    model: { id: "test", name: "test" },
    ui: {
      select: vi.fn(async (_title: string, options: string[]) =>
        typeof selectResult === "function" ? selectResult(options) : selectResult,
      ),
      confirm: vi.fn(async () => true),
      notify: vi.fn(),
      setStatus: vi.fn(),
      setHeader: vi.fn(),
      theme: { fg: (_kind: string, text: string) => text, bold: (t: string) => t },
    },
    sessionManager: {
      getSessionId: () => "test-session",
      getBranch: () => [],
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

  homeDir = await mkdtemp(path.join(tmpdir(), "delivery-select-home-"));
  repoDir = await mkdtemp(path.join(tmpdir(), "delivery-select-repo-"));

  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["remote", "add", "origin", REMOTE], { cwd: repoDir });

  process.env.HOME = homeDir;
  delete process.env.PI_SUBAGENT_CHILD; // PARENT process: selector may only run here
  process.chdir(repoDir);
});

afterEach(async () => {
  process.chdir(savedCwd);
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedChild === undefined) delete process.env.PI_SUBAGENT_CHILD;
  else process.env.PI_SUBAGENT_CHILD = savedChild;

  vi.clearAllMocks();
  await rm(homeDir, { recursive: true, force: true });
  await rm(repoDir, { recursive: true, force: true });
});

async function readSavedRegistry(): Promise<unknown> {
  const raw = await readFile(path.join(homeDir, ".pi", "agent", "projects.json"), "utf-8");
  return JSON.parse(raw);
}

function registryFileExists(): Promise<boolean> {
  return readFile(path.join(homeDir, ".pi", "agent", "projects.json"), "utf-8").then(
    () => true,
    () => false,
  );
}

describe("first-launch delivery selector (real register + session_start)", () => {
  it("unregistered repo + UI: prompts, persists direct-PR, and lifts the push-deny live", async () => {
    const api = createFakePi();
    register(api);
    const sessionStart = getHandler(api, "session_start");
    const toolCall = getHandler(api, "tool_call");
    const ctx = makeCtx(repoDir, true, (options) => options.find((o) => o.startsWith("direct-PR")));

    await sessionStart({ reason: "resume" }, ctx);

    // (a) prompted with all three modes
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    const options = (ctx.ui.select as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    for (const mode of ["local-only", "direct-PR", "no-mistakes"]) {
      expect(options.some((o) => o.startsWith(mode))).toBe(true);
    }

    // (b) persisted, keyed by remote, attended autonomy only
    const saved = (await readSavedRegistry()) as {
      default: unknown;
      projects: Array<Record<string, unknown>>;
    };
    expect(saved.default).toEqual({ mode: "local-only", autonomy: "attended" });
    expect(saved.projects).toHaveLength(1);
    expect(saved.projects[0]).toMatchObject({
      match: REMOTE,
      path: process.cwd(),
      mode: "direct-PR",
      autonomy: "attended",
    });

    // status segment reflects the new mode
    const statusCalls = (ctx.ui.setStatus as ReturnType<typeof vi.fn>).mock.calls
      .filter(([key]) => key === "harness-delivery")
      .map(([, text]) => text as string);
    expect(statusCalls.some((t) => t.includes("direct-PR"))).toBe(true);

    // (c) the LIVE gate no longer denies push as local-only
    const pushResult = (await toolCall(
      { toolName: "bash", input: { command: "git push origin main" } },
      ctx,
    )) as { block?: boolean; reason?: string } | undefined;
    expect(pushResult?.reason ?? "").not.toContain("local-only");
  });

  it("ESC keeps the safe default: nothing persisted, push still denied", async () => {
    const api = createFakePi();
    register(api);
    const sessionStart = getHandler(api, "session_start");
    const toolCall = getHandler(api, "tool_call");
    const ctx = makeCtx(repoDir, true, undefined); // user dismisses the selector

    await sessionStart({ reason: "resume" }, ctx);

    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    expect(await registryFileExists()).toBe(false);

    const pushResult = (await toolCall(
      { toolName: "bash", input: { command: "git push origin main" } },
      ctx,
    )) as { block?: boolean; reason?: string } | undefined;
    expect(pushResult?.block).toBe(true);
    expect(pushResult?.reason).toContain("local-only");
  });

  it("no UI: never prompts, never writes", async () => {
    const api = createFakePi();
    register(api);
    const sessionStart = getHandler(api, "session_start");
    const ctx = makeCtx(repoDir, false, "direct-PR — anything");

    await sessionStart({ reason: "resume" }, ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
    expect(await registryFileExists()).toBe(false);
  });

  it("already-registered repo: never prompts", async () => {
    const dir = path.join(homeDir, ".pi", "agent");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "projects.json"),
      JSON.stringify({
        version: 1,
        default: { mode: "local-only", autonomy: "attended" },
        projects: [{ match: REMOTE, mode: "local-only", autonomy: "attended" }],
      }),
      "utf-8",
    );

    const api = createFakePi();
    register(api);
    const sessionStart = getHandler(api, "session_start");
    const ctx = makeCtx(repoDir, true, "direct-PR — anything");

    await sessionStart({ reason: "resume" }, ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("/delivery with an explicit mode persists headlessly (no UI needed)", async () => {
    const api = createFakePi();
    register(api);
    const deliveryCmd = getCommandHandler(api, "delivery");
    const ctx = makeCtx(repoDir, false);

    await deliveryCmd("direct-PR", ctx);

    expect(ctx.ui.select).not.toHaveBeenCalled();
    const saved = (await readSavedRegistry()) as { projects: Array<Record<string, unknown>> };
    expect(saved.projects[0]).toMatchObject({ match: REMOTE, mode: "direct-PR" });
  });

  it("/delivery rejects an unknown mode argument without writing", async () => {
    const api = createFakePi();
    register(api);
    const deliveryCmd = getCommandHandler(api, "delivery");
    const ctx = makeCtx(repoDir, false);

    await deliveryCmd("yolo-everything", ctx);

    expect(await registryFileExists()).toBe(false);
    expect(ctx.ui.notify).toHaveBeenCalled();
  });
});
