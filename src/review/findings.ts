import { Type } from "typebox";

export type FindingPriority = "P0" | "P1" | "P2" | "P3";
export type ReviewVerdict = "approve" | "comment" | "request-changes";

export interface ReviewFinding {
  priority: FindingPriority;
  summary: string;
  rationale: string;
  file?: string;
  line?: number;
  suggestedFix?: string;
}

export const FindingParamsSchema = Type.Object({
  priority: Type.Union([Type.Literal("P0"), Type.Literal("P1"), Type.Literal("P2"), Type.Literal("P3")]),
  summary: Type.String({ minLength: 1 }),
  rationale: Type.String({ minLength: 1 }),
  file: Type.Optional(Type.String()),
  line: Type.Optional(Type.Number({ minimum: 1 })),
  suggestedFix: Type.Optional(Type.String()),
});

export function addFinding(findings: ReviewFinding[], finding: ReviewFinding): ReviewFinding[] {
  return [...findings, finding];
}

export function verdictForFindings(findings: ReviewFinding[]): ReviewVerdict {
  if (findings.some((finding) => finding.priority === "P0" || finding.priority === "P1")) return "request-changes";
  if (findings.length > 0) return "comment";
  return "approve";
}

export function formatReviewSummary(findings: ReviewFinding[]): string {
  const verdict = verdictForFindings(findings);
  return JSON.stringify({ verdict, findings });
}
