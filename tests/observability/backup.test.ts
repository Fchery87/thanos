import { afterEach, describe, expect, it, vi } from "vitest";
import { backupPath } from "../../src/observability/backup";

describe("backupPath", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("nests the backup under .harness/backups/ beneath the given base dir", () => {
    const p = backupPath("models.json", "/repo");
    expect(p.startsWith("/repo/.harness/backups/models.json.")).toBe(true);
    expect(p.endsWith(".bak")).toBe(true);
  });

  it("defaults the base dir to process.cwd()", () => {
    const p = backupPath("mcp-secrets.json");
    expect(p.startsWith(`${process.cwd()}/.harness/backups/mcp-secrets.json.`)).toBe(true);
  });

  it("sanitizes the ISO timestamp so it is filesystem-safe (no colons) and appends a hex nonce", () => {
    const p = backupPath("models.json", "/repo");
    // filename middle is `<ISO>.<nonce>` between `models.json.` and `.bak`
    const middle = p.slice("/repo/.harness/backups/models.json.".length, -".bak".length);
    const dot = middle.lastIndexOf(".");
    const stamp = middle.slice(0, dot);
    const nonce = middle.slice(dot + 1);
    expect(stamp).not.toMatch(/:/);
    expect(stamp.endsWith("Z")).toBe(true);
    expect(nonce).toMatch(/^[0-9a-f]{8}$/);
  });

  it("never collides on repeated calls with the same name/cwd, even within one millisecond", () => {
    // Freeze the clock so every call shares a timestamp; the nonce must still
    // make them distinct (a same-ms collision would silently clobber a backup).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:00:00.000Z"));
    const paths = new Set(Array.from({ length: 50 }, () => backupPath("models.json", "/repo")));
    expect(paths.size).toBe(50); // all 50 distinct despite identical timestamp
  });
});
