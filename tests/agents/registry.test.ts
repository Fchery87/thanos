import { describe, expect, it } from "vitest";
import { AGENT_TYPES } from "../../src/agents/registry";
import { getAllIds } from "../../src/agents/catalog";

describe("agent registry", () => {
  it("stays a subset of the live catalog — a role retired from SpecialistId cannot linger here", () => {
    // The bug this guards: AgentType used to be a hand-typed literal union
    // with no structural tie to SpecialistId, so removing "reviewer" from
    // the catalog alone did not surface here (see ADR 0023). AgentType is
    // now Extract<SpecialistId, ...>, which makes a future removal fail
    // typecheck — this test guards the same invariant at the value level,
    // for AGENT_TYPES specifically.
    const liveIds = new Set(getAllIds());
    for (const type of AGENT_TYPES) {
      expect(liveIds.has(type), `${type} is in AGENT_TYPES but not in the live catalog`).toBe(true);
    }
  });


  it("includes the oracle specialist", () => {
    expect(AGENT_TYPES).toContain("oracle");
  });

  it("includes the researcher specialist", () => {
    expect(AGENT_TYPES).toContain("researcher");
  });

  it("includes the evaluator specialist", () => {
    expect(AGENT_TYPES).toContain("evaluator");
  });

  it("keeps the existing specialists", () => {
    for (const t of ["explore", "plan", "build", "designer"]) {
      expect(AGENT_TYPES).toContain(t);
    }
  });
});
