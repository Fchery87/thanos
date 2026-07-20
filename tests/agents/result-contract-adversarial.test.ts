import { describe, expect, it } from "vitest";
import { parseSubagentResult } from "../../src/agents/result";

describe("parseSubagentResult — adversarial inputs", () => {
  it("handles oversized JSON input gracefully", () => {
    const large = JSON.stringify({ summary: "x".repeat(600_000) });
    const result = parseSubagentResult(large);
    expect(result.status).toBe("error");
    expect(result.summary).toContain("exceeds maximum size");
  });

  it("handles deeply nested metadata safely", () => {
    const deep = { a: { b: { c: { d: { e: { f: "value" } } } } } };
    const input = JSON.stringify({ summary: "test", metadata: deep });
    const result = parseSubagentResult(input);
    expect(result.metadata).toBeUndefined();
  });

  it("handles oversized metadata bytes safely", () => {
    const large = { key: "x".repeat(10_000) };
    const input = JSON.stringify({ summary: "test", metadata: { data: large } });
    const result = parseSubagentResult(input);
    expect(result.metadata).toBeUndefined();
  });

  it("rejects unknown status values", () => {
    const input = JSON.stringify({ summary: "ok", status: "exploited" });
    const result = parseSubagentResult(input);
    expect(result.status).toBe("error");
  });

  it("bounds findings array size", () => {
    const findings = Array.from({ length: 100 }, (_, i) => ({
      priority: "P3",
      summary: `finding ${i}`,
    }));
    const input = JSON.stringify({ summary: "test", findings });
    const result = parseSubagentResult(input);
    expect(result.findings.length).toBeLessThanOrEqual(50);
  });

  it("rejects findings with invalid priorities", () => {
    const input = JSON.stringify({
      summary: "test",
      findings: [{ priority: "CRITICAL", summary: "bad" }],
    });
    const result = parseSubagentResult(input);
    expect(result.findings).toHaveLength(0);
  });

  it("bounds escalations array size", () => {
    const escalations = Array.from({ length: 50 }, (_, i) => ({
      question: `q${i}`,
    }));
    const input = JSON.stringify({ summary: "test", escalations });
    const result = parseSubagentResult(input);
    expect(result.escalations.length).toBeLessThanOrEqual(10);
  });

  it("handles non-object JSON values", () => {
    expect(parseSubagentResult("42").summary).toBe("42");
    expect(parseSubagentResult('"just string"').summary).toBe("just string");
  });

  it("handles empty and whitespace strings", () => {
    const result = parseSubagentResult("");
    expect(result.status).toBe("success");
    expect(result.summary).toBe("");
    expect(result.metadata).toEqual({ legacy: true });
  });

  it("truncates summary exceeding max length", () => {
    const longSummary = "x".repeat(5000);
    const input = JSON.stringify({ summary: longSummary });
    const result = parseSubagentResult(input);
    expect(result.summary.length).toBeLessThanOrEqual(4000);
  });

  it("preserves valid findings while rejecting invalid ones", () => {
    const input = JSON.stringify({
      summary: "mixed",
      findings: [
        { priority: "P1", summary: "valid" },
        { priority: "INVALID", summary: "bad" },
        { priority: "P2", summary: "also valid" },
        { not_a_finding: true },
      ],
    });
    const result = parseSubagentResult(input);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]?.priority).toBe("P1");
    expect(result.findings[1]?.priority).toBe("P2");
  });
});
