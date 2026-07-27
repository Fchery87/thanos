import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MCPManager } from "../../src/mcp/manager";
import { evaluateMcpTrust, normalizeIdentity, trustKey } from "../../src/mcp/trust";
import {
  validateFrameSize,
  validateResultSize,
  validateToolCount,
  validateToolDescription,
  validateToolName,
  validateToolResultSize,
} from "../../src/mcp/validation";
import type { MCPClient } from "../../src/mcp/client";
import type { MCPServerConfig, MCPTool } from "../../src/mcp/types";

/**
 * A configured MCP server is not a trusted peer.
 *
 * For a stdio server the config names a command that gets spawned, and
 * `loadMcpConfigs` merges `${cwd}/mcp.json` — a file that ships inside whatever
 * repository is open, and which overrides the user's own entries of the same
 * name. Cloning a repo and opening it here was previously enough to run its
 * author's chosen binary, because `evaluateMcpTrust` had been written, tested,
 * and never called by anything.
 *
 * Everything asserted here was already implemented in trust.ts and validation.ts
 * before this file existed. What was missing was the call.
 */

function fakeClient(tools: MCPTool[], callResult?: string): MCPClient {
  return {
    connect: async () => {},
    initialize: async () => {},
    listTools: async () => tools,
    callTool: async () => ({ content: [{ type: "text" as const, text: callResult ?? "ok" }] }),
    disconnect: () => {},
  };
}

function tool(over: Partial<MCPTool> = {}): MCPTool {
  return { name: "search", description: "search things", inputSchema: { type: "object" }, ...over } as MCPTool;
}

function fakePi() {
  const registered: string[] = [];
  const executors = new Map<string, (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>>();
  const pi = {
    registerTool: vi.fn((spec: { name: string; execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }> }) => {
      registered.push(spec.name);
      executors.set(spec.name, spec.execute);
    }),
  };
  return { pi: pi as never, registered, executors };
}

function managerWith(configs: Record<string, MCPServerConfig>, sources: Record<string, "global" | "project">, client: MCPClient) {
  return new MCPManager({
    loadConfigs: async () => ({ merged: configs, sources }),
    createClient: () => client,
  });
}

const stdio = (command: string): MCPServerConfig => ({ type: "stdio", command, args: ["--serve"] });

describe("an untrusted project server is gated, not silently connected", () => {
  it("refuses to launch a server the project supplied when the project is not trusted", async () => {
    const { pi, registered } = fakePi();
    const client = fakeClient([tool()]);
    const connect = vi.spyOn(client, "connect");
    const manager = managerWith({ evil: stdio("./scripts/pwn.sh") }, { evil: "project" }, client);

    await manager.initialize(pi, "/tmp/repo", { projectApproved: false });

    // The decision has to happen before the client is built — for stdio,
    // constructing it is what spawns the command.
    expect(connect).not.toHaveBeenCalled();
    expect(registered).toEqual([]);

    const status = manager.getStatuses()[0];
    expect(status).toMatchObject({ connected: false, blocked: true });
    expect(status?.error).toContain("requires explicit trust approval");
  });

  it("connects the same server once the project is trusted", async () => {
    const { pi, registered } = fakePi();
    const manager = managerWith({ ok: stdio("./scripts/serve.sh") }, { ok: "project" }, fakeClient([tool()]));

    await manager.initialize(pi, "/tmp/repo", { projectApproved: true });

    expect(manager.getStatuses()[0]).toMatchObject({ connected: true });
    expect(manager.getStatuses()[0]?.blocked).toBeFalsy();
    expect(registered).toEqual(["mcp__ok__search"]);
  });

  it("connects the user's own global servers without any approval", async () => {
    const { pi } = fakePi();
    const manager = managerWith({ mine: stdio("my-server") }, { mine: "global" }, fakeClient([tool()]));

    await manager.initialize(pi, "/tmp/repo", { projectApproved: false });

    expect(manager.getStatuses()[0]).toMatchObject({ connected: true });
  });

  // The gate has to hold on the explicit path too, or it is decorative: typing
  // "/mcp connect evil" is not the same as vouching for what evil runs.
  it("still refuses on an explicit connect", async () => {
    const { pi } = fakePi();
    const client = fakeClient([tool()]);
    const connect = vi.spyOn(client, "connect");
    const manager = managerWith({ evil: stdio("./pwn.sh") }, { evil: "project" }, client);

    await manager.initialize(pi, "/tmp/repo", { projectApproved: false });
    const ok = await manager.connectServer(pi, "evil");

    expect(ok).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it("defaults to closed when the caller supplies no trust inputs at all", async () => {
    const { pi } = fakePi();
    const manager = managerWith({ evil: stdio("./pwn.sh") }, { evil: "project" }, fakeClient([tool()]));

    await manager.initialize(pi, "/tmp/repo");

    expect(manager.getStatuses()[0]).toMatchObject({ blocked: true });
  });

  it("names the exact command an approval would authorize", async () => {
    const { pi } = fakePi();
    const manager = managerWith({ evil: stdio("./pwn.sh") }, { evil: "project" }, fakeClient([tool()]));
    await manager.initialize(pi, "/tmp/repo");

    expect(manager.describeServer("evil")).toBe("./pwn.sh --serve");
  });

  // Approval is keyed by identity, so a repo cannot get a blessed name to run a
  // different binary in a later commit.
  it("keys approval to the command, not the server name", () => {
    const approved = new Set([trustKey(normalizeIdentity({ type: "stdio", command: "./known.sh" }))]);
    const swapped = normalizeIdentity({ type: "stdio", command: "./swapped.sh" });

    expect(evaluateMcpTrust(swapped, "project", approved, false).allowed).toBe(false);
    expect(evaluateMcpTrust(normalizeIdentity({ type: "stdio", command: "./known.sh" }), "project", approved, false).allowed).toBe(true);
  });
});

// The gate only means anything if `source` is right, and it was not. Editing
// the harness from ~/.pi makes the project mcp.json path identical to the global
// one, so reading both tagged every one of the user's own servers "project" —
// which this gate would then refuse. Harmless while nothing read `source`;
// setup-breaking the moment something did.
describe("config source classification", () => {
  it("treats the user's own config as global when cwd is ~/.pi itself", async () => {
    const { mcpConfigPaths } = await import("../../src/mcp/config");
    const home = process.env.HOME ?? "~";
    const paths = mcpConfigPaths(join(home, ".pi"));

    expect(paths.project).toBe(paths.global);

    const { loadMcpConfigs } = await import("../../src/mcp/config");
    const { sources } = await loadMcpConfigs(join(home, ".pi"));
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).toBe("global");
    }
  });
});

describe("a hostile tool listing is refused", () => {
  it("skips a tool whose name is malformed rather than failing the server", async () => {
    const { pi, registered } = fakePi();
    const manager = managerWith({ s: stdio("srv") }, { s: "global" }, fakeClient([
      tool({ name: "../../etc/passwd" }),
      tool({ name: "tool with spaces" }),
      tool({ name: "legit_tool" }),
    ]));

    await manager.initialize(pi, "/tmp/repo");

    expect(registered).toEqual(["mcp__s__legit_tool"]);
    expect(manager.getStatuses()[0]?.toolCount).toBe(1);
  });

  it("skips a tool whose description would flood the system prompt", async () => {
    const { pi, registered } = fakePi();
    const manager = managerWith({ s: stdio("srv") }, { s: "global" }, fakeClient([
      tool({ name: "bloated", description: "x".repeat(5000) }),
      tool({ name: "fine" }),
    ]));

    await manager.initialize(pi, "/tmp/repo");

    expect(registered).toEqual(["mcp__s__fine"]);
  });

  it("refuses a server that advertises more tools than the cap allows", async () => {
    const { pi, registered } = fakePi();
    const many = Array.from({ length: 250 }, (_, i) => tool({ name: `tool_${i}` }));
    const client = fakeClient(many);
    const disconnect = vi.spyOn(client, "disconnect");
    const manager = managerWith({ flood: stdio("srv") }, { flood: "global" }, client);

    await manager.initialize(pi, "/tmp/repo");

    expect(registered).toEqual([]);
    expect(disconnect).toHaveBeenCalled();
    expect(manager.getStatuses()[0]).toMatchObject({ connected: false });
    expect(manager.getStatuses()[0]?.error).toContain("max is 200");
  });

  it("truncates an oversized tool result and says so in the text", async () => {
    const { pi, executors } = fakePi();
    const manager = managerWith({ s: stdio("srv") }, { s: "global" }, fakeClient([tool()], "y".repeat(200 * 1024)));

    await manager.initialize(pi, "/tmp/repo");
    const result = await executors.get("mcp__s__search")!("1", {});
    const text = result.content[0]!.text;

    expect(text.length).toBeLessThan(200 * 1024);
    expect(text).toContain("result truncated");
  });
});

// The caps themselves. These were the tested-but-uncalled functions; pinning
// their boundaries here keeps the numbers from drifting without a decision.
describe("size caps", () => {
  it("bounds a JSON-RPC frame at 4MB", () => {
    expect(validateFrameSize(4 * 1024 * 1024)).toBeUndefined();
    expect(validateFrameSize(4 * 1024 * 1024 + 1)?.field).toBe("frame");
  });

  it("bounds a single response at 256KB", () => {
    expect(validateResultSize(256 * 1024)).toBeUndefined();
    expect(validateResultSize(256 * 1024 + 1)?.field).toBe("result");
  });

  it("bounds a tool result at 128KB", () => {
    expect(validateToolResultSize(128 * 1024)).toBeUndefined();
    expect(validateToolResultSize(128 * 1024 + 1)?.field).toBe("tool_result");
  });

  it("bounds tools per server and per session", () => {
    expect(validateToolCount(200, 200)).toBeUndefined();
    expect(validateToolCount(201, 201)?.message).toContain("max is 200");
    expect(validateToolCount(10, 501)?.message).toContain("max is 500");
  });

  it("accepts the tool-name shapes real servers use", () => {
    for (const name of ["web_search", "get-issue", "resolve-library-id", "sequentialthinking", "createIssue"]) {
      expect(validateToolName(name), name).toBeUndefined();
    }
  });

  it("rejects tool names that could escape the mcp__server__tool namespace", () => {
    for (const name of ["", "../etc", "a/b", "tool name", "1leading-digit", "x".repeat(201)]) {
      expect(validateToolName(name), name).toBeDefined();
    }
  });

  it("bounds a tool description at 4000 chars", () => {
    expect(validateToolDescription("x".repeat(4000))).toBeUndefined();
    expect(validateToolDescription("x".repeat(4001))?.field).toBe("description");
  });
});
