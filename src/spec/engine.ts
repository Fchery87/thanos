import { generateSpec } from "./generator";
import type { FormalSpec, SpecTier, AcceptanceCriterion } from "./types";
import type { EvidenceRecord } from "./evidence";

export interface VerificationResult {
  criterion: AcceptanceCriterion;
  passed: boolean;
  evidence: string[];
}

export class SpecEngine {
  activeSpec: FormalSpec | undefined;
  private evidence: EvidenceRecord[] = [];

  classify(prompt: string, explicitFlag: boolean): SpecTier {
    const lower = prompt.trim().toLowerCase();
    if (lower.length < 20 || /^(what|how|why|explain|show|list|describe|tell)/.test(lower)) {
      return "instant";
    }
    if (explicitFlag) return "explicit";
    return "ambient";
  }

  generate(prompt: string, tier: SpecTier): void {
    if (tier === "instant") return;
    this.activeSpec = generateSpec(prompt, tier);
    this.evidence = [];
  }

  reset(): void {
    this.activeSpec = undefined;
    this.evidence = [];
  }

  collectOutput(text: string): void {
    const summary = text.trim();
    if (!summary) return;
    this.recordEvidence({ type: "manual", source: "assistant", summary, passed: true });
  }

  recordEvidence(evidence: EvidenceRecord): void {
    this.evidence.push(evidence);
  }

  verify(): VerificationResult[] {
    if (!this.activeSpec) return [];
    return this.activeSpec.acceptanceCriteria.map((criterion) => {
      const matchingEvidence = this.evidence.filter((record) =>
        record.passed && criterion.evidenceRequired.includes(record.type),
      );
      const passed = criterion.evidenceRequired.every((type) =>
        matchingEvidence.some((record) => record.type === type),
      );
      return { criterion, passed, evidence: matchingEvidence.map((record) => record.summary) };
    });
  }
}
