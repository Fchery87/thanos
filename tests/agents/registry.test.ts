import { describe, expect, it } from "vitest";
import { AGENT_TYPES } from "../../src/agents/registry";

describe("agent registry", () => {
  it("includes the oracle specialist", () => {
    expect(AGENT_TYPES).toContain("oracle");
  });

  it("includes the researcher specialist", () => {
    expect(AGENT_TYPES).toContain("researcher");
  });

  it("keeps the existing specialists", () => {
    for (const t of ["explore", "plan", "build", "reviewer", "designer"]) {
      expect(AGENT_TYPES).toContain(t);
    }
  });
});
