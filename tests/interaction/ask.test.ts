import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import {
  AskParamsSchema,
  buildAskDecision,
  buildAskAuditMetadata,
  resolveHeadlessAsk,
} from "../../src/interaction/ask";

const baseQuestion = {
  question: "Which implementation strategy should Thanos use?",
  options: [
    { id: "extend", label: "Extension-first" },
    { id: "fork", label: "Fork runtime" },
  ],
  recommended: "extend",
};

describe("AskParamsSchema", () => {
  it("accepts a single option question with stable option ids", () => {
    expect(Value.Check(AskParamsSchema, baseQuestion)).toBe(true);
  });

  it("rejects missing recommendation", () => {
    expect(Value.Check(AskParamsSchema, { question: "Pick", options: baseQuestion.options })).toBe(false);
  });

  it("rejects batched forms in v1", () => {
    expect(Value.Check(AskParamsSchema, { questions: [baseQuestion] })).toBe(false);
  });

  it("rejects duplicate option ids in helper validation", () => {
    expect(() => buildAskDecision({
      ...baseQuestion,
      options: [{ id: "same", label: "A" }, { id: "same", label: "B" }],
    }, ["same"], "user")).toThrow(/duplicate option id/i);
  });
});

describe("buildAskDecision", () => {
  it("returns a structured decision record", () => {
    const decision = buildAskDecision(baseQuestion, ["extend"], "user", "Keeps maintenance bounded");

    expect(decision).toEqual({
      question: baseQuestion.question,
      options: ["extend", "fork"],
      selected: ["extend"],
      recommended: "extend",
      source: "user",
      rationale: "Keeps maintenance bounded",
    });
  });

  it("rejects unknown selections", () => {
    expect(() => buildAskDecision(baseQuestion, ["unknown"], "user")).toThrow(/unknown option/i);
  });

  it("requires exactly one selection", () => {
    expect(() => buildAskDecision(baseQuestion, ["extend", "fork"], "user")).toThrow(/exactly one/i);
  });
});

describe("resolveHeadlessAsk", () => {
  it("fails closed for team and ci presets", () => {
    expect(resolveHeadlessAsk(baseQuestion, "team")).toEqual({ kind: "blocked", reason: expect.stringContaining("interactive UI") });
    expect(resolveHeadlessAsk(baseQuestion, "ci")).toEqual({ kind: "blocked", reason: expect.stringContaining("interactive UI") });
  });

  it("uses recommended answer for personal preset when timeout is configured", () => {
    expect(resolveHeadlessAsk({ ...baseQuestion, timeoutSeconds: 1 }, "personal")).toEqual({
      kind: "selected",
      selected: ["extend"],
      source: "default",
    });
  });
});

describe("buildAskAuditMetadata", () => {
  it("includes only safe metadata", () => {
    const decision = buildAskDecision(baseQuestion, ["extend"], "user", "safe rationale");
    expect(buildAskAuditMetadata(decision)).toEqual({
      question: baseQuestion.question,
      options: ["extend", "fork"],
      selected: ["extend"],
      recommended: "extend",
      source: "user",
      rationale: "safe rationale",
    });
  });
});
