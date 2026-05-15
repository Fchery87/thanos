import { describe, expect, it } from "vitest";
import { SpecEngine } from "../../src/spec/engine";

describe("SpecEngine lifecycle", () => {
  it("does not create a spec for instant prompts", () => {
    const spec = new SpecEngine();

    expect(spec.startTurn("What is this?", false)).toBeUndefined();
    expect(spec.activeSpec).toBeUndefined();
    expect(spec.verify()).toEqual([]);
  });

  it("creates an ambient spec without approval", () => {
    const spec = new SpecEngine();

    const active = spec.startTurn("Implement a new feature for the billing flow", false);

    expect(active?.tier).toBe("ambient");
    expect(active?.approvalStatus).toBe("not_required");
    expect(spec.activeSpec?.id).toBe(active?.id);
  });

  it("creates an explicit spec with pending approval", () => {
    const spec = new SpecEngine();

    const active = spec.startTurn("Implement a new feature for the billing flow", true);

    expect(active?.tier).toBe("explicit");
    expect(active?.approvalStatus).toBe("pending");
  });

  it("clears prior evidence when a new prompt starts", () => {
    const spec = new SpecEngine();

    spec.startTurn("Complete the billing task with clear updates", false);
    spec.recordEvidence({ type: "manual", source: "assistant", summary: "old evidence", passed: true });
    expect(spec.verify()[0]?.evidence).toContain("old evidence");

    spec.startTurn("Complete the reporting task with clear updates", false);
    expect(spec.verify().every((result) => !result.evidence.includes("old evidence"))).toBe(true);
  });

  it("records assistant text as manual evidence only when a spec exists", () => {
    const spec = new SpecEngine();

    expect(
      spec.finishTurn([
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ]),
    ).toEqual([]);

    spec.startTurn("Complete the billing task with clear updates", false);
    const results = spec.finishTurn([
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);

    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.evidence).toContain("done");
  });
});
