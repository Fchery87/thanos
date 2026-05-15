import { describe, expect, it } from "vitest";
import { evidenceFromToolResult } from "../../src/spec/evidence";

describe("interaction evidence", () => {
  it("records ask results as manual evidence from ask", () => {
    const evidence = evidenceFromToolResult({
      toolName: "ask",
      content: [{ type: "text", text: JSON.stringify({ selected: ["extend"], source: "user" }) }],
    });

    expect(evidence).toMatchObject({ type: "manual", source: "ask", passed: true });
  });

  it("records report_finding results as manual evidence from report_finding", () => {
    const evidence = evidenceFromToolResult({
      toolName: "report_finding",
      content: [{ type: "text", text: "P1: Policy bypass" }],
    });

    expect(evidence).toMatchObject({ type: "manual", source: "report_finding", passed: true });
  });
});
