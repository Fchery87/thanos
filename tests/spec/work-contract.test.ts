import { describe, expect, it } from "vitest";
import { contractRevision, targetRoots } from "../../src/spec/work-contract";
import { generateSpec } from "../../src/spec/generator";

describe("Work Contract identity", () => {
  it("deduplicates and sorts target roots from task criteria", () => {
    expect(targetRoots({
      objective: "x",
      criteria: [
        {
          id: "a", kind: "build", statement: "a", targets: ["tests", "src", "src"],
          evidence: ["diff"], expectedExecutables: [], expectedArgs: [], mustNot: [],
          source: "user",
        },
      ],
    })).toEqual(["src", "tests"]);
  });

  it("changes revision when the approved capability or target surface changes", () => {
    const first = generateSpec("Implement billing with tests", "explicit");
    const same = generateSpec("Implement billing with tests", "explicit");
    const expanded = { ...same, targetFiles: [...same.targetFiles, "scripts"] };

    expect(contractRevision(first)).toBe(contractRevision(same));
    expect(contractRevision(expanded)).not.toBe(contractRevision(first));
  });
});
