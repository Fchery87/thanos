import { describe, expect, it } from "vitest";
import { noopTheme, renderCriteriaLines, stripAnsi } from "../src/ui-utils";

const line = (
  id: string,
  statement: string,
  passed: boolean,
  advisory?: boolean,
) => ({ criterion: { id, statement }, passed, advisory });

const render = (results: Parameters<typeof renderCriteriaLines>[1], showIds = false) =>
  renderCriteriaLines(noopTheme, results, { showIds }).map(stripAnsi);

describe("renderCriteriaLines", () => {
  it("marks a met criterion", () => {
    expect(render([line("c1", "tests pass", true)])[0]).toContain("✓");
  });

  it("marks a blocking failure", () => {
    const rendered = render([line("c1", "tests pass", false)])[0] ?? "";
    expect(rendered).toContain("✗");
    expect(rendered).not.toContain("advisory");
  });

  // The drift this helper exists to end: agent_end showed a red ✗ and titled the
  // panel "Spec Verification Failed" for criteria the gate had already decided
  // were not actionable, so every audit prompt reported a failure nothing acted on.
  it("marks an unmet advisory criterion as reported, not failed", () => {
    const rendered = render([line("audit-primary", "audit findings supported", false, true)])[0] ?? "";
    expect(rendered).not.toContain("✗");
    expect(rendered).toContain("·");
    expect(rendered).toContain("(advisory)");
  });

  it("does not tag a passing advisory criterion", () => {
    const rendered = render([line("audit-primary", "audit findings supported", true, true)])[0] ?? "";
    expect(rendered).toContain("✓");
    expect(rendered).not.toContain("(advisory)");
  });

  it("includes criterion ids only when asked", () => {
    expect(render([line("c1", "tests pass", true)], true)[0]).toContain("[c1]");
    expect(render([line("c1", "tests pass", true)], false)[0]).not.toContain("[c1]");
  });

  it("renders one line per result, in order", () => {
    const rendered = render([
      line("c1", "first", true),
      line("c2", "second", false),
      line("c3", "third", false, true),
    ]);
    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toContain("first");
    expect(rendered[1]).toContain("second");
    expect(rendered[2]).toContain("third");
  });
});
