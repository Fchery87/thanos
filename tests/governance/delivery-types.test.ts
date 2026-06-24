import { describe, expect, it } from "vitest";
import { parseRegistry, parseShipFile } from "../../src/governance/delivery-types";

describe("delivery schemas", () => {
  it("parses a valid registry", () => {
    const r = parseRegistry({ version: 1, default: { mode: "local-only", autonomy: "attended" }, projects: [] });
    expect(r.default.mode).toBe("local-only");
  });
  it("rejects an unknown mode", () => {
    expect(() => parseRegistry({ version: 1, default: { mode: "wat", autonomy: "attended" }, projects: [] })).toThrow();
  });
  it("parses a ship file with gates", () => {
    const s = parseShipFile({ version: 1, gates: { test: "bun test" }, defaultBranch: "main", merge: "fast-forward" });
    expect(s.gates.test).toBe("bun test");
  });
  it("rejects a ship file with a bad merge value", () => {
    expect(() => parseShipFile({ version: 1, gates: {}, merge: "rebase" })).toThrow();
  });
});
