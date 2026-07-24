import { describe, expect, it } from "vitest";
import { backupPath } from "../../src/observability/backup";

describe("backupPath", () => {
  it("nests the backup under .harness/backups/ beneath the given base dir", () => {
    const p = backupPath("models.json", "/repo");
    expect(p.startsWith("/repo/.harness/backups/models.json.")).toBe(true);
    expect(p.endsWith(".bak")).toBe(true);
  });

  it("defaults the base dir to process.cwd()", () => {
    const p = backupPath("mcp-secrets.json");
    expect(p.startsWith(`${process.cwd()}/.harness/backups/mcp-secrets.json.`)).toBe(true);
  });

  it("sanitizes the ISO timestamp so it is filesystem-safe (no colons)", () => {
    const p = backupPath("models.json", "/repo");
    const stamp = p.slice("/repo/.harness/backups/models.json.".length, -".bak".length);
    expect(stamp).not.toMatch(/:/);
    expect(stamp.endsWith("Z")).toBe(true);
  });

});
