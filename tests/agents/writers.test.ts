import { describe, expect, it } from "vitest";
import { agentWrites } from "../../src/agents/policy";

describe("agentWrites", () => {
  it("returns true for writing agents", () => {
    expect(agentWrites("build")).toBe(true);
    expect(agentWrites("designer")).toBe(true);
  });

  it("returns false for read-only agents", () => {
    expect(agentWrites("explore")).toBe(false);
    expect(agentWrites("plan")).toBe(false);
    expect(agentWrites("reviewer")).toBe(false);
    expect(agentWrites("oracle")).toBe(false);
    expect(agentWrites("researcher")).toBe(false);
  });
});
