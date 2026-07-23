import { afterEach, describe, expect, it, vi } from "vitest";
import register from "../../src/index";

/**
 * CHARACTERIZATION test for registerHarness() (src/runtime/register-harness.ts),
 * written BEFORE decomposing that ~2000-line file into smaller modules (see the
 * "Characterization tests for register-harness before decomposing" plan item).
 *
 * This test does not exercise command/tool BEHAVIOR — that is covered by
 * tests/index.*.test.ts and friends. Its only job is to lock in the ENTIRE
 * current REGISTRATION SURFACE: every command name, flag, event hook, tool
 * name, and keyboard shortcut that registerHarness() (directly, or via its
 * delegated helpers registerGoalCommand / registerSlashCommands /
 * registerLensLiteCommand) wires up against a fake ExtensionAPI. If the
 * upcoming decomposition accidentally drops, renames, or fails to wire
 * through one of these registrations, this test must fail.
 *
 * Two scenarios are covered because a handful of registrations are gated by
 * isSubagentProcess(process.env) (PI_SUBAGENT_CHILD=1):
 *   - parent session: /remember and /memory ARE registered; the goal_complete,
 *     todo, and ask tools ARE registered; report_finding is NOT.
 *   - subagent session: the reverse.
 * Everything else (11 direct commands minus the two above, the delegated
 * /goal + 13 registerSlashCommands commands + /lens, the "spec" flag, all
 * 9 event hooks, and all 8 keyboard shortcuts) is registered unconditionally
 * in both scenarios — verified by reading every registerShortcut call site:
 * the isSubagent checks that exist (e.g. ctrl+shift+r's code-review shortcut)
 * live INSIDE the handler body, not around the registration call, so the
 * shortcut is always registered even though its handler no-ops for a
 * subagent.
 */

type RegisterApi = Parameters<typeof register>[0];

function createFakePi(overrides?: Partial<RegisterApi>) {
  const api = {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => false),
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    sendUserMessage: vi.fn(async () => undefined),
    getThinkingLevel: vi.fn(() => "off"),
    setThinkingLevel: vi.fn(),
    setModel: vi.fn(async () => true),
    ...overrides,
  };
  return api as unknown as RegisterApi & {
    registerFlag: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    registerTool: ReturnType<typeof vi.fn>;
    registerCommand: ReturnType<typeof vi.fn>;
    registerShortcut: ReturnType<typeof vi.fn>;
  };
}

function commandNames(api: ReturnType<typeof createFakePi>): string[] {
  return api.registerCommand.mock.calls.map(([name]: [string]) => name).sort();
}

function flagNames(api: ReturnType<typeof createFakePi>): string[] {
  return api.registerFlag.mock.calls.map(([name]: [string]) => name).sort();
}

function eventNames(api: ReturnType<typeof createFakePi>): string[] {
  return api.on.mock.calls.map(([name]: [string]) => name).sort();
}

function toolNames(api: ReturnType<typeof createFakePi>): string[] {
  return api.registerTool.mock.calls.map(([def]: [{ name: string }]) => def.name).sort();
}

function shortcutNames(api: ReturnType<typeof createFakePi>): string[] {
  return api.registerShortcut.mock.calls.map(([key]: [string]) => key).sort();
}

// Every command registered directly in register-harness.ts (11), plus those
// delegated to registerGoalCommand (1: goal), registerSlashCommands (13), and
// registerLensLiteCommand (1: lens) — 26 total. remember/memory are the only
// two gated on isSubagentProcess; they are included here (parent surface).
const PARENT_COMMANDS = [
  "modes", "todo", "remember", "memory", "yolo", "delivery", "ship", "mcp",
  "thinking", "models", "designer",
  "goal",
  "skills", "context", "policy", "tools", "spec", "waves",
  "subagents-models", "subagents-models-set", "subagents-models-toggle",
  "audit", "rename", "status", "worktree",
  "lens",
].sort();

const SUBAGENT_COMMANDS = PARENT_COMMANDS.filter((name) => name !== "remember" && name !== "memory");

const ALL_EVENT_HOOKS = [
  "session_start", "session_tree", "model_select", "thinking_level_select",
  "session_shutdown", "before_agent_start", "tool_call", "tool_result", "agent_end",
].sort();

// All 8 registerShortcut("ctrl+shift+<x>", {...}) calls, registered
// unconditionally (no isSubagent gate around the registration itself — see
// docblock above). key-combo -> what it does:
//   ctrl+shift+k — select thinking level
//   ctrl+shift+f — session snapshot panel (model/thinking/mode/spec/context/policy)
//   ctrl+shift+e — current spec panel (goal/tier/criteria/verification)
//   ctrl+shift+g — active policy panel
//   ctrl+shift+a — last 10 audit log entries
//   ctrl+shift+r — run code review (heterogeneous critic jury)
//   ctrl+shift+d — spawn designer subagent
//   ctrl+shift+y — toggle yolo mode
const ALL_SHORTCUTS = [
  "ctrl+shift+k", "ctrl+shift+f", "ctrl+shift+e", "ctrl+shift+g",
  "ctrl+shift+a", "ctrl+shift+r", "ctrl+shift+d", "ctrl+shift+y",
].sort();

const originalChild = process.env.PI_SUBAGENT_CHILD;
const originalChildAgent = process.env.PI_SUBAGENT_CHILD_AGENT;

afterEach(() => {
  if (originalChild === undefined) delete process.env.PI_SUBAGENT_CHILD;
  else process.env.PI_SUBAGENT_CHILD = originalChild;
  if (originalChildAgent === undefined) delete process.env.PI_SUBAGENT_CHILD_AGENT;
  else process.env.PI_SUBAGENT_CHILD_AGENT = originalChildAgent;
  vi.clearAllMocks();
});

describe("registerHarness() registration surface (characterization baseline)", () => {
  it("parent session: registers the full command/flag/hook/tool/shortcut surface", () => {
    delete process.env.PI_SUBAGENT_CHILD;
    delete process.env.PI_SUBAGENT_CHILD_AGENT;

    const api = createFakePi();
    register(api, { initialYolo: false });

    expect(commandNames(api)).toEqual(PARENT_COMMANDS);
    expect(flagNames(api)).toEqual(["spec"]);
    expect(eventNames(api)).toEqual(ALL_EVENT_HOOKS);
    expect(toolNames(api)).toEqual(["ask", "goal_complete", "todo"].sort());
    expect(shortcutNames(api)).toEqual(ALL_SHORTCUTS);
  });

  it("subagent session: narrows commands and tools, but keeps the flag and every hook", () => {
    process.env.PI_SUBAGENT_CHILD = "1";
    process.env.PI_SUBAGENT_CHILD_AGENT = "reviewer";

    const api = createFakePi();
    register(api);

    expect(commandNames(api)).toEqual(SUBAGENT_COMMANDS);
    expect(commandNames(api)).not.toContain("remember");
    expect(commandNames(api)).not.toContain("memory");

    expect(flagNames(api)).toEqual(["spec"]);
    expect(eventNames(api)).toEqual(ALL_EVENT_HOOKS);

    // goal_complete/todo/ask are parent-only; report_finding is subagent-only.
    expect(toolNames(api)).toEqual(["report_finding"]);

    // Shortcuts are registered unconditionally — same set as the parent
    // session (isSubagent branching lives inside individual handlers, e.g.
    // ctrl+shift+r's code-review shortcut no-ops for a subagent at call time,
    // it is not un-registered).
    expect(shortcutNames(api)).toEqual(ALL_SHORTCUTS);
  });
});
