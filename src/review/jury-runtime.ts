import type { ReviewFinding } from "./findings";
import type { SubagentResultContract } from "../agents/result";

export interface ReviewTarget {
  diff: string;
  baseCommit: string;
  changedPaths: string[];
}

export interface CriticResult {
  criticId: string;
  status: "completed" | "failed" | "timeout";
  findings: ReviewFinding[];
  contract: SubagentResultContract;
}

export interface OracleResult {
  status: "completed" | "failed" | "timeout";
  kept: ReviewFinding[];
  weakened: ReviewFinding[];
  dropped: ReviewFinding[];
  raised: ReviewFinding[];
  contract: SubagentResultContract;
}

export interface JuryVerdict {
  verdict: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  findings: ReviewFinding[];
  criticResults: CriticResult[];
  oracleResult: OracleResult | undefined;
  synthesis: string;
}

const CRITIC_IDS = ["reviewer-correctness", "reviewer-security", "reviewer-tests"] as const;

function collectFindings(contract: SubagentResultContract): ReviewFinding[] {
  return (contract.findings ?? []).map((f) => ({
    priority: (f.priority as ReviewFinding["priority"]) ?? "P2",
    summary: f.summary ?? "",
    rationale: f.suggestion ?? "",
    file: f.file,
    line: f.line,
    suggestedFix: f.suggestion,
  }));
}

export function buildCriticResult(
  criticId: string,
  contract: SubagentResultContract,
  timedOut = false,
): CriticResult {
  const status = timedOut ? "timeout"
    : contract.status === "error" ? "failed"
    : "completed";

  return {
    criticId,
    status,
    findings: collectFindings(contract),
    contract,
  };
}

export function buildOracleResult(
  contract: SubagentResultContract,
  criticFindings: ReviewFinding[],
  timedOut = false,
): OracleResult {
  const status = timedOut ? "timeout"
    : contract.status === "error" ? "failed"
    : "completed";

  const kept: ReviewFinding[] = [];
  const weakened: ReviewFinding[] = [];
  const dropped: ReviewFinding[] = [];
  const raised = collectFindings(contract);

  if (status === "completed") {
    const mentionedIds = new Set(
      contract.summary.toLowerCase().split(/\s+/).filter(Boolean),
    );

    for (const finding of criticFindings) {
      const keywords = finding.summary.toLowerCase().split(/\s+/).filter(Boolean);
      const isMentioned = keywords.some((k) => mentionedIds.has(k));

      if (isMentioned) {
        kept.push(finding);
      } else {
        dropped.push(finding);
      }
    }
  }

  return { status, kept, weakened, dropped, raised, contract };
}

function deduplicate(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.priority}:${f.summary.slice(0, 80)}:${f.file ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankBySeverity(findings: ReviewFinding[]): ReviewFinding[] {
  const order: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return [...findings].sort((a, b) => (order[a.priority] ?? 4) - (order[b.priority] ?? 4));
}

function deriveVerdict(findings: ReviewFinding[]): "APPROVE" | "COMMENT" | "REQUEST_CHANGES" {
  if (findings.some((f) => f.priority === "P0")) return "REQUEST_CHANGES";
  if (findings.some((f) => f.priority === "P1")) return "REQUEST_CHANGES";
  if (findings.length > 0) return "COMMENT";
  return "APPROVE";
}

export function synthesize(criticResults: CriticResult[], oracleResult: OracleResult | undefined): JuryVerdict {
  const allFindings: ReviewFinding[] = [];

  for (const cr of criticResults) {
    if (cr.status === "completed") {
      allFindings.push(...cr.findings);
    }
  }

  if (oracleResult?.status === "completed") {
    allFindings.push(...oracleResult.raised);
    // Weakened findings count as kept but with note
    for (const f of oracleResult.weakened) {
      f.summary = `[WEAKENED] ${f.summary}`;
      allFindings.push(f);
    }
  }

  const deduped = deduplicate(allFindings);
  const ranked = rankBySeverity(deduped);

  const synthesisLines = [
    `Critics: ${criticResults.map((c) => `${c.criticId}:${c.status}`).join(", ")}`,
    `Oracle: ${oracleResult?.status ?? "not run"}`,
    `Findings: ${ranked.length} (P0:${ranked.filter((f) => f.priority === "P0").length}, P1:${ranked.filter((f) => f.priority === "P1").length}, P2:${ranked.filter((f) => f.priority === "P2").length}, P3:${ranked.filter((f) => f.priority === "P3").length})`,
    `Kept: ${oracleResult?.kept.length ?? 0}, Weakened: ${oracleResult?.weakened.length ?? 0}, Dropped: ${oracleResult?.dropped.length ?? 0}, Raised: ${oracleResult?.raised.length ?? 0}`,
  ];

  return {
    verdict: deriveVerdict(ranked),
    findings: ranked,
    criticResults,
    oracleResult,
    synthesis: synthesisLines.join("\n"),
  };
}
