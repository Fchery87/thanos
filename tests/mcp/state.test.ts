// tests/mcp/state.test.ts
//
// TDD tests for Tasks 7, 8, 9:
//   Task 7 — Secrets file mode 0o600 + fixSecretsPermissions()
//   Task 8 — ENOENT vs parse error distinction in readMcpSecrets
//   Task 9 — Atomic writes in writeServerSecrets
//
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Build explicit mock functions for the fs/promises functions we care about.
const mockReadFile  = vi.fn();
const mockWriteFile = vi.fn();
const mockRename    = vi.fn();
const mockChmod     = vi.fn();
const mockCopyFile  = vi.fn();
const mockMkdir     = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile:  mockReadFile,
  writeFile: mockWriteFile,
  rename:    mockRename,
  chmod:     mockChmod,
  copyFile:  mockCopyFile,
  mkdir:     mockMkdir,
}));

// Import AFTER the mock is registered
import {
  readMcpSecrets,
  writeServerSecrets,
  fixSecretsPermissions,
} from "../../src/mcp/state";

// The expected path (mirrors what state.ts derives from homedir())
import { homedir } from "node:os";
import { join } from "node:path";
const SECRETS_PATH = join(homedir(), ".pi", "mcp-secrets.json");
const SECRETS_TMP  = SECRETS_PATH + ".tmp";
const SECRETS_BAK  = SECRETS_PATH + ".bak";

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: mkdir, rename, chmod, copyFile succeed silently
  mockMkdir.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
  mockChmod.mockResolvedValue(undefined);
  mockCopyFile.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Task 9: Atomic writes in writeServerSecrets ──────────────────────────────

describe("writeServerSecrets — atomic write (Task 9)", () => {
  it("reads existing secrets, then writes to .tmp before renaming to the final path", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ existing: { env: { KEY: "val" } } }));

    await writeServerSecrets("myserver", { env: { TOKEN: "secret" } });

    // writeFile must have been called with the .tmp path, not the final path
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [writePath] = mockWriteFile.mock.calls[0] as [string, ...unknown[]];
    expect(writePath).toBe(SECRETS_TMP);

    // rename must move .tmp → final
    expect(mockRename).toHaveBeenCalledOnce();
    expect(mockRename).toHaveBeenCalledWith(SECRETS_TMP, SECRETS_PATH);
  });

  it("passes mode 0o600 to writeFile when writing secrets (Task 7)", async () => {
    mockReadFile.mockResolvedValueOnce("{}");

    await writeServerSecrets("myserver", { env: { TOKEN: "abc" } });

    const callArgs = mockWriteFile.mock.calls[0] as [string, string, unknown];
    const options = callArgs[2];
    expect(options).toMatchObject({ mode: 0o600 });
  });

  it("rename is called AFTER writeFile (ordering guarantee)", async () => {
    mockReadFile.mockResolvedValueOnce("{}");

    const callOrder: string[] = [];
    mockWriteFile.mockImplementation(async () => { callOrder.push("writeFile"); });
    mockRename.mockImplementation(async () => { callOrder.push("rename"); });

    await writeServerSecrets("myserver", { env: {} });

    expect(callOrder).toEqual(["writeFile", "rename"]);
  });

  it("preserves existing server secrets for other servers", async () => {
    const existing = { other: { env: { OTHER_KEY: "otherval" } } };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(existing));

    await writeServerSecrets("myserver", { env: { TOKEN: "new" } });

    const writtenContent = (mockWriteFile.mock.calls[0] as [string, string, unknown])[1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.other).toEqual({ env: { OTHER_KEY: "otherval" } });
    expect(parsed.myserver).toEqual({ env: { TOKEN: "new" } });
  });
});

// ─── Task 8: ENOENT vs parse error distinction in readMcpSecrets ──────────────

describe("readMcpSecrets — error handling (Task 8)", () => {
  it("returns {} silently when the file does not exist (ENOENT)", async () => {
    const enoentError = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    mockReadFile.mockRejectedValueOnce(enoentError);
    const errSpy = vi.spyOn(console, "error");

    const result = await readMcpSecrets();

    expect(result).toEqual({});
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("logs a corruption message and returns {} on SyntaxError (corrupt JSON)", async () => {
    mockReadFile.mockResolvedValueOnce("{ not valid json !!!");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await readMcpSecrets();

    expect(result).toEqual({});
    expect(errSpy).toHaveBeenCalledOnce();
    const [msg] = errSpy.mock.calls[0] as [string];
    expect(msg).toMatch(/corrupted/i);
    expect(msg).toMatch(/mcp-secrets\.json/);
  });

  it("attempts to copy the corrupted file to .bak before returning {}", async () => {
    mockReadFile.mockResolvedValueOnce("BAD_JSON");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await readMcpSecrets();

    // copyFile should be called to back up the corrupted file
    expect(mockCopyFile).toHaveBeenCalledWith(SECRETS_PATH, SECRETS_BAK);
  });

  it("logs an error and returns {} on generic read errors (non-ENOENT, non-SyntaxError)", async () => {
    const genericError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    mockReadFile.mockRejectedValueOnce(genericError);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await readMcpSecrets();

    expect(result).toEqual({});
    expect(errSpy).toHaveBeenCalledOnce();
    const [msg, detail] = errSpy.mock.calls[0] as [string, string];
    expect(msg).toMatch(/failed to read/i);
    expect(detail).toMatch(/permission denied/i);
  });
});

// ─── Task 7: fixSecretsPermissions ────────────────────────────────────────────

describe("fixSecretsPermissions (Task 7)", () => {
  it("calls chmod on SECRETS_PATH with mode 0o600", async () => {
    await fixSecretsPermissions();

    expect(mockChmod).toHaveBeenCalledOnce();
    expect(mockChmod).toHaveBeenCalledWith(SECRETS_PATH, 0o600);
  });

  it("does not throw when the file does not exist (chmod fails silently)", async () => {
    mockChmod.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(fixSecretsPermissions()).resolves.toBeUndefined();
  });
});
