import { describe, expect, it } from "vitest";
import { evaluateRules } from "../../src/permissions/rules";

describe("interaction permission rules", () => {
  it("allows explicit interaction rules", () => {
    expect(evaluateRules([
      { capability: "interaction", pattern: "ask", decision: "allow", source: "session" },
    ], "interaction", "ask")).toBe("allow");
  });
});
