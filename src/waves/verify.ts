export type WaveHandoffStatus = "success" | "partial" | "blocked";
export type WaveHandoffConfidence = "high" | "medium" | "low";

export interface WaveHandoff {
  status: WaveHandoffStatus;
  slice: string;
  keyFindings: string[];
  evidence: string[];
  openQuestions: string[];
  suggestedFollowUps: string[];
  confidence: WaveHandoffConfidence;
}

export interface WaveHandoffVerification {
  passed: boolean;
  requiresEscalation: boolean;
  requiresSynthesisReview: boolean;
  issues: string[];
}

export function verifyWaveHandoffs(handoffs: WaveHandoff[]): WaveHandoffVerification {
  const issues: string[] = [];
  let requiresEscalation = false;
  let requiresSynthesisReview = false;

  for (const handoff of handoffs) {
    if (handoff.evidence.length === 0) {
      issues.push(`${handoff.slice}: missing evidence`);
    }
    if (handoff.confidence === "low") {
      issues.push(`${handoff.slice}: low confidence requires escalation`);
      requiresEscalation = true;
    }
    if (handoff.status !== "success") {
      issues.push(`${handoff.slice}: status is ${handoff.status}`);
      requiresSynthesisReview = true;
    }
  }

  const statuses = new Set(handoffs.map((handoff) => handoff.status));
  if (statuses.size > 1) {
    issues.push("handoffs have conflicting statuses");
    requiresSynthesisReview = true;
  }

  return {
    passed: issues.length === 0,
    requiresEscalation,
    requiresSynthesisReview,
    issues,
  };
}
