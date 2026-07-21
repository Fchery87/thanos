import { describe, expect, it } from "vitest";
import {
  getSpecialist,
  allSpecialists,
  writingAgentIds,
  readOnlyAgentIds,
  agentWrites,
  agentExecutes,
  allowedContextModes,
  mayDelegateTo,
} from "../../src/agents/catalog";

describe("specialist catalog", () => {
  it("contains all 13 specialists", () => {
    expect(allSpecialists()).toHaveLength(13);
  });

  it("every specialist has a unique id", () => {
    const ids = allSpecialists().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getSpecialist returns undefined for unknown ids", () => {
    expect(getSpecialist("nonexistent" as never)).toBeUndefined();
  });

  it("every specialist declares a live prompt template and contract version", () => {
    for (const specialist of allSpecialists()) {
      expect(specialist.outputContractVersion).toBe(1);
      expect(specialist.promptTemplateId.length).toBeGreaterThan(0);
      expect(specialist.runtimeEngine).toBe("live");
      expect(specialist.toolCeiling.length).toBeGreaterThan(0);
    }
  });
});

describe("agentWrites", () => {
  it("returns true for writing agents", () => {
    expect(agentWrites("build")).toBe(true);
    expect(agentWrites("designer")).toBe(true);
    expect(agentWrites("worker")).toBe(true);
  });

  it("returns false for read-only agents", () => {
    expect(agentWrites("explore")).toBe(false);
    expect(agentWrites("plan")).toBe(false);
    expect(agentWrites("reviewer")).toBe(false);
    expect(agentWrites("oracle")).toBe(false);
    expect(agentWrites("researcher")).toBe(false);
    expect(agentWrites("scout")).toBe(false);
  });

  it("returns false for evaluator", () => {
    expect(agentWrites("evaluator")).toBe(false);
  });
});

describe("agentExecutes", () => {
  it("returns true for build, worker, and evaluator", () => {
    expect(agentExecutes("build")).toBe(true);
    expect(agentExecutes("worker")).toBe(true);
    expect(agentExecutes("evaluator")).toBe(true);
  });

  it("returns false for designer (writes but no exec)", () => {
    expect(agentExecutes("designer")).toBe(false);
  });

  it("returns false for read-only roles", () => {
    expect(agentExecutes("explore")).toBe(false);
    expect(agentExecutes("plan")).toBe(false);
    expect(agentExecutes("reviewer")).toBe(false);
    expect(agentExecutes("oracle")).toBe(false);
  });
});

describe("allowedContextModes", () => {
  it("allows forked context for continuity roles", () => {
    expect(allowedContextModes("build")).toContain("forked");
    expect(allowedContextModes("designer")).toContain("forked");
    expect(allowedContextModes("worker")).toContain("forked");
  });

  it("only allows fresh context for read-only roles", () => {
    expect(allowedContextModes("explore")).toEqual(["fresh"]);
    expect(allowedContextModes("plan")).toEqual(["fresh"]);
    expect(allowedContextModes("reviewer")).toEqual(["fresh"]);
    expect(allowedContextModes("oracle")).toEqual(["fresh"]);
    expect(allowedContextModes("researcher")).toEqual(["fresh"]);
    expect(allowedContextModes("evaluator")).toEqual(["fresh"]);
    expect(allowedContextModes("scout")).toEqual(["fresh"]);
  });
});

describe("mayDelegateTo", () => {
  it("reviewer can delegate to explore", () => {
    expect(mayDelegateTo("reviewer", "explore")).toBe(true);
    expect(mayDelegateTo("reviewer-correctness", "explore")).toBe(true);
  });

  it("build can delegate to explore", () => {
    expect(mayDelegateTo("build", "explore")).toBe(true);
  });

  it("read-only roles (except reviewer) cannot delegate", () => {
    expect(mayDelegateTo("explore", "explore")).toBe(false);
    expect(mayDelegateTo("plan", "explore")).toBe(false);
    expect(mayDelegateTo("oracle", "explore")).toBe(false);
    expect(mayDelegateTo("researcher", "explore")).toBe(false);
    expect(mayDelegateTo("evaluator", "explore")).toBe(false);
  });

  it("designer and worker cannot delegate", () => {
    expect(mayDelegateTo("designer", "explore")).toBe(false);
    expect(mayDelegateTo("worker", "explore")).toBe(false);
  });

  it("returns false for unknown ids", () => {
    expect(mayDelegateTo("nonexistent" as never, "explore")).toBe(false);
  });
});

describe("writingAgentIds and readOnlyAgentIds", () => {
  it("read-only and writing sets are disjoint", () => {
    const writers = new Set(writingAgentIds());
    const readers = new Set(readOnlyAgentIds());
    const intersection = [...writers].filter((w) => readers.has(w));
    expect(intersection).toEqual([]);
  });

  it("combined sets equal all specialists", () => {
    const writers = new Set(writingAgentIds());
    const readers = new Set(readOnlyAgentIds());
    const combined = new Set([...writers, ...readers]);
    expect(combined.size).toBe(allSpecialists().length);
  });
});
