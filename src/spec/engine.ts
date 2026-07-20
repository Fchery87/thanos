import { generateSpec } from "./generator";
import { evidenceFromToolResult, type ToolResultEventLike } from "./evidence";
import type { EvidenceRecord } from "./claims";
import { verifyCriteria, type VerificationResult } from "./verification";
import type { FormalSpec, SpecTier } from "./types";

export class SpecEngine {
  activeSpec: FormalSpec | undefined;
  gateAttempts = 0;
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
    this.reset();
    if (tier === "instant") return;
    this.activeSpec = generateSpec(prompt, tier);
  }

  startTurn(prompt: string, explicitFlag: boolean): FormalSpec | undefined {
    const tier = this.classify(prompt, explicitFlag);
    this.generate(prompt, tier);
    return this.activeSpec;
  }

  reset(): void {
    this.activeSpec = undefined;
    this.evidence = [];
    this.gateAttempts = 0;
  }

  recordGateAttempt(): void {
    this.gateAttempts += 1;
  }

  recordToolResult(event: ToolResultEventLike): void {
    if (!this.activeSpec) return;
    const evidence = evidenceFromToolResult(event);
    if (evidence) this.recordEvidence(evidence);
  }

  recordEvidence(evidence: EvidenceRecord): void {
    if (!this.activeSpec) return;
    this.evidence.push(evidence);
  }

  finishTurn(_messages: unknown, opts?: { aborted?: boolean }): VerificationResult[] {
    if (opts?.aborted) {
      return this.verify();
    }
    return this.verify();
  }

  verify(): VerificationResult[] {
    if (!this.activeSpec) return [];
    return verifyCriteria(this.activeSpec, this.evidence);
  }
}
