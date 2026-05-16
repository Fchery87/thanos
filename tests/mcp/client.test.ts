import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { StdioMCPClient, HttpMCPClient } from "../../src/mcp/client";
import type { MCPServerConfig } from "../../src/mcp/types";

// ── Shared JSON-RPC fixtures ─────────────────────────────────────────────────

const TOOLS_LIST_RESPONSE = {
  jsonrpc: "2.0",
  id: 2,
  result: {
    tools: [
      {
        name: "echo",
        description: "Echoes input",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    ],
  },
};

const CALL_TOOL_RESPONSE = {
  jsonrpc: "2.0",
  id: 3,
  result: {
    content: [{ type: "text", text: "hello world" }],
    isError: false,
  },
};

const INIT_RESPONSE = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    serverInfo: { name: "test-server", version: "0.0.1" },
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// StdioMCPClient tests
// ══════════════════════════════════════════════════════════════════════════════

// We mock child_process.spawn using vi.mock so the module is replaced before
// any import of the client module runs.
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

/**
 * Create a fake child process whose stdout is a controllable EventEmitter.
 * Writing to stdin is captured via `writtenLines`.
 */
function makeFakeProcess(): {
  fakeProc: any;
  writtenLines: string[];
  emitLine: (line: string) => void;
} {
  const stdout = new EventEmitter() as any;
  stdout.setEncoding = vi.fn();

  const writtenLines: string[] = [];
  const stdin = {
    write: vi.fn((data: string) => {
      writtenLines.push(data);
    }),
  };

  const fakeProc: any = new EventEmitter();
  fakeProc.stdout = stdout;
  fakeProc.stdin = stdin;
  fakeProc.kill = vi.fn();
  fakeProc.pid = 42;

  const emitLine = (line: string) => {
    stdout.emit("data", line + "\n");
  };

  return { fakeProc, writtenLines, emitLine };
}

describe("StdioMCPClient", () => {
  const config: MCPServerConfig = {
    type: "stdio",
    command: "my-mcp-server",
    args: ["--port", "3000"],
    env: { MY_VAR: "hello" },
  };
  const opts = { timeoutMs: 5000 };

  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("connect() spawns the process with correct command, args, and merged env", async () => {
    const { fakeProc } = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    const client = new StdioMCPClient(config, opts);
    await client.connect();

    expect(mockSpawn).toHaveBeenCalledOnce();
    const [cmd, args, spawnOpts] = mockSpawn.mock.calls[0]!;
    expect(cmd).toBe("my-mcp-server");
    expect(args).toEqual(["--port", "3000"]);
    // Env should include MY_VAR merged with process.env
    expect(spawnOpts.env).toMatchObject({ MY_VAR: "hello" });
    // stdio should be configured for piping
    expect(spawnOpts.stdio).toEqual(["pipe", "pipe", "ignore"]);

    client.disconnect();
  });

  it("initialize() sends the initialize request then the initialized notification", async () => {
    const { fakeProc, writtenLines, emitLine } = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    const client = new StdioMCPClient(config, opts);
    await client.connect();

    // Respond to the initialize request
    const initPromise = client.initialize();
    // Give event loop a tick so the request is written before we respond
    await Promise.resolve();
    emitLine(JSON.stringify(INIT_RESPONSE));
    await initPromise;

    // First written line must be the initialize request
    const initReq = JSON.parse(writtenLines[0]!.trim());
    expect(initReq.jsonrpc).toBe("2.0");
    expect(initReq.method).toBe("initialize");
    expect(initReq.params.protocolVersion).toBe("2024-11-05");
    expect(initReq.params.clientInfo.name).toBe("pi-harness");

    // Second written line must be the initialized notification (no id)
    const notification = JSON.parse(writtenLines[1]!.trim());
    expect(notification.method).toBe("notifications/initialized");
    expect(notification.id).toBeUndefined();

    client.disconnect();
  });

  it("listTools() sends tools/list and returns parsed MCPTool[]", async () => {
    const { fakeProc, writtenLines, emitLine } = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    const client = new StdioMCPClient(config, opts);
    await client.connect();

    // Resolve the initialize handshake first
    const initPromise = client.initialize();
    await Promise.resolve();
    emitLine(JSON.stringify(INIT_RESPONSE));
    await initPromise;

    // Now call listTools
    const listPromise = client.listTools();
    await Promise.resolve();
    emitLine(JSON.stringify(TOOLS_LIST_RESPONSE));
    const tools = await listPromise;

    // Check that the correct request was sent
    const listReq = JSON.parse(writtenLines[2]!.trim()); // after init + notification
    expect(listReq.method).toBe("tools/list");
    expect(listReq.jsonrpc).toBe("2.0");

    // Check parsed tools
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("echo");
    expect(tools[0]!.description).toBe("Echoes input");
    expect(tools[0]!.inputSchema.type).toBe("object");

    client.disconnect();
  });

  it("callTool() sends tools/call and returns MCPToolResult", async () => {
    const { fakeProc, writtenLines, emitLine } = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    const client = new StdioMCPClient(config, opts);
    await client.connect();

    // Handshake
    const initPromise = client.initialize();
    await Promise.resolve();
    emitLine(JSON.stringify(INIT_RESPONSE));
    await initPromise;

    // listTools (needed to advance the id counter to 2)
    const listPromise = client.listTools();
    await Promise.resolve();
    emitLine(JSON.stringify(TOOLS_LIST_RESPONSE));
    await listPromise;

    // callTool
    const callPromise = client.callTool("echo", { text: "hello" });
    await Promise.resolve();
    emitLine(JSON.stringify(CALL_TOOL_RESPONSE));
    const result = await callPromise;

    // Verify the request
    const callReq = JSON.parse(writtenLines[3]!.trim());
    expect(callReq.method).toBe("tools/call");
    expect(callReq.params.name).toBe("echo");
    expect(callReq.params.arguments).toEqual({ text: "hello" });

    // Verify the result
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.text).toBe("hello world");

    client.disconnect();
  });

  it("disconnect() kills the child process", async () => {
    const { fakeProc } = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    const client = new StdioMCPClient(config, opts);
    await client.connect();
    client.disconnect();

    expect(fakeProc.kill).toHaveBeenCalledOnce();
  });

  it("callTool() returns isError:true on error response", async () => {
    const { fakeProc, emitLine } = makeFakeProcess();
    mockSpawn.mockReturnValue(fakeProc);

    const client = new StdioMCPClient(config, opts);
    await client.connect();

    const initPromise = client.initialize();
    await Promise.resolve();
    emitLine(JSON.stringify(INIT_RESPONSE));
    await initPromise;

    const callPromise = client.callTool("badTool", {});
    await Promise.resolve();
    // Emit an error result
    emitLine(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: "something went wrong" }],
        isError: true,
      },
    }));
    const result = await callPromise;

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("something went wrong");

    client.disconnect();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// HttpMCPClient tests
// ══════════════════════════════════════════════════════════════════════════════

describe("HttpMCPClient", () => {
  const config: MCPServerConfig = {
    type: "sse",
    url: "https://mcp.example.com/rpc",
    headers: { Authorization: "Bearer tok_abc" },
  };
  const opts = { timeoutMs: 5000 };

  let mockFetch: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  it("connect() is a no-op (does not call fetch)", async () => {
    const client = new HttpMCPClient(config, opts);
    await client.connect();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("initialize() POSTs the correct initialize request to config.url", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(INIT_RESPONSE));

    const client = new HttpMCPClient(config, opts);
    await client.connect();
    await client.initialize();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://mcp.example.com/rpc");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("initialize");
    expect(body.params.protocolVersion).toBe("2024-11-05");
    expect(body.params.clientInfo.name).toBe("pi-harness");
  });

  it("initialize() forwards config headers (including Authorization)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(INIT_RESPONSE));

    const client = new HttpMCPClient(config, opts);
    await client.initialize();

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers["Authorization"]).toBe("Bearer tok_abc");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("listTools() POSTs tools/list and returns MCPTool[]", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(INIT_RESPONSE));
    mockFetch.mockResolvedValueOnce(jsonResponse(TOOLS_LIST_RESPONSE));

    const client = new HttpMCPClient(config, opts);
    await client.initialize();
    const tools = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("echo");
    expect(tools[0]!.description).toBe("Echoes input");

    // Check that the tools/list request was a POST with the right method
    const [, listInit] = mockFetch.mock.calls[1]!;
    const body = JSON.parse(listInit.body as string);
    expect(body.method).toBe("tools/list");
    expect(body.jsonrpc).toBe("2.0");
  });

  it("callTool() POSTs tools/call and returns MCPToolResult", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(INIT_RESPONSE));
    mockFetch.mockResolvedValueOnce(jsonResponse(CALL_TOOL_RESPONSE));

    const client = new HttpMCPClient(config, opts);
    await client.initialize();
    const result = await client.callTool("echo", { text: "world" });

    expect(result.isError).toBe(false);
    expect(result.content[0]!.text).toBe("hello world");

    const [, callInit] = mockFetch.mock.calls[1]!;
    const body = JSON.parse(callInit.body as string);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("echo");
    expect(body.params.arguments).toEqual({ text: "world" });
  });

  it("callTool() headers from config are forwarded on every request", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(CALL_TOOL_RESPONSE));

    const client = new HttpMCPClient(config, opts);
    await client.callTool("echo", {});

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers["Authorization"]).toBe("Bearer tok_abc");
  });

  it("callTool() returns isError:true on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "bad request" }, 400));

    const client = new HttpMCPClient(config, opts);
    const result = await client.callTool("echo", {});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/400/);
  });

  it("disconnect() is a no-op (does not call fetch)", async () => {
    const client = new HttpMCPClient(config, opts);
    client.disconnect();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Retry-on-401 tests ────────────────────────────────────────────────────

  it("callTool() retries once on 401 using refreshAuth callback", async () => {
    // First call returns 401, second returns success
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse(CALL_TOOL_RESPONSE));

    const refreshAuth = vi.fn(async () => "new-token-abc");
    const client = new HttpMCPClient(config, opts, refreshAuth);
    const result = await client.callTool("echo", { text: "hi" });

    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);
    expect(result.content[0]!.text).toBe("hello world");
  });

  it("callTool() uses refreshed token in Authorization header on retry", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse(CALL_TOOL_RESPONSE));

    const refreshAuth = vi.fn(async () => "refreshed-token-xyz");
    const client = new HttpMCPClient(config, opts, refreshAuth);
    await client.callTool("echo", {});

    // Second fetch (the retry) must use the new token
    const [, retryInit] = mockFetch.mock.calls[1]!;
    expect(retryInit.headers["Authorization"]).toBe("Bearer refreshed-token-xyz");
  });

  it("callTool() returns isError:true on 401 when no refreshAuth is provided", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" } as unknown as Response);

    const client = new HttpMCPClient(config, opts);
    const result = await client.callTool("echo", {});

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/401/);
  });

  it("callTool() returns isError:true if refreshAuth returns null (token cannot be refreshed)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" } as unknown as Response);

    const refreshAuth = vi.fn(async () => null);
    const client = new HttpMCPClient(config, opts, refreshAuth);
    const result = await client.callTool("echo", {});

    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledOnce(); // no retry
    expect(result.isError).toBe(true);
  });

  it("callTool() does not retry more than once on repeated 401", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => "Unauthorized" } as unknown as Response);

    const refreshAuth = vi.fn(async () => "some-token");
    const client = new HttpMCPClient(config, opts, refreshAuth);
    const result = await client.callTool("echo", {});

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(true);
  });
});
