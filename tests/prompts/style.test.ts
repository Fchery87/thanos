import { describe, expect, it } from "vitest";
import {
  buildPromptSections,
  renderBoundedExample,
  renderCompletionCriteria,
} from "../../src/prompts/style";

describe("prompt writing standard", () => {
  it("keeps sections ordered and readable", () => {
    expect(buildPromptSections([
      { heading: "Question", body: "Name the problem." },
      { heading: "Check", body: "State completion." },
    ])).toContain("## Question");
  });

  it("bounds examples", () => {
    expect(renderBoundedExample("Example", "x".repeat(200), 20)).toMatch(/…$/);
  });

  it("renders completion criteria plainly", () => {
    expect(renderCompletionCriteria(["tests pass"]).toLowerCase()).toContain("completion criteria");
  });
});
