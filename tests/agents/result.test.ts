import { describe, expect, it } from "vitest";
import { needsClarification, parseSubagentResult } from "../../src/agents/result";

describe("parseSubagentResult", () => {
  it("wraps plain text as a success contract with empty collections", () => {
    const c = parseSubagentResult("just some prose");
    expect(c).toEqual({
      status: "success",
      summary: "just some prose",
      findings: [],
      artifacts: [],
      escalations: [],
      metadata: { legacy: true },
    });
  });

  it("normalizes a full contract JSON, filling missing collections", () => {
    const c = parseSubagentResult(JSON.stringify({ status: "error", summary: "boom" }));
    expect(c.status).toBe("error");
    expect(c.summary).toBe("boom");
    expect(c.findings).toEqual([]);
    expect(c.artifacts).toEqual([]);
    expect(c.escalations).toEqual([]);
  });

  it("preserves provided findings, artifacts, escalations, and metadata", () => {
    const c = parseSubagentResult(JSON.stringify({
      status: "escalated",
      summary: "need input",
      findings: [{ priority: "P1", summary: "missing test" }],
      artifacts: [{ name: "report.md", path: ".harness/x", bytes: 10 }],
      escalations: [{ question: "which db?" }],
      metadata: { turns: 3 },
    }));
    expect(c.findings).toHaveLength(1);
    expect(c.artifacts[0].name).toBe("report.md");
    expect(c.escalations[0].question).toBe("which db?");
    expect(c.metadata).toEqual({ turns: 3 });
  });

  it("accepts the legacy { text, metadata } shape for backward compatibility", () => {
    const c = parseSubagentResult(JSON.stringify({ text: "legacy", metadata: { a: 1 } }));
    expect(c.status).toBe("success");
    expect(c.summary).toBe("legacy");
    expect(c.metadata).toEqual({ a: 1 });
  });
});

describe("needsClarification", () => {
  it("flags a contract that requires parent clarification", () => {
    const c = parseSubagentResult(JSON.stringify({
      status: "escalated",
      summary: "blocked",
      escalations: [{ question: "which db?", options: ["pg", "sqlite"], recommended: "pg" }],
    }));
    expect(c.status).toBe("escalated");
    expect(c.escalations[0].recommended).toBe("pg");
    expect(needsClarification(c)).toBe(true);
  });

  it("needsClarification true when escalations present even if status success", () => {
    const c = parseSubagentResult(JSON.stringify({
      status: "success",
      summary: "done but asking",
      escalations: [{ question: "which db?" }],
    }));
    expect(needsClarification(c)).toBe(true);
  });

  it("needsClarification false for a clean success contract", () => {
    const c = parseSubagentResult(JSON.stringify({
      status: "success",
      summary: "all good",
      escalations: [],
    }));
    expect(needsClarification(c)).toBe(false);
  });
});
