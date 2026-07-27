import { generateSpec } from "./generator";
import { evidenceFromToolResult, type ToolResultEventLike } from "./evidence";
import type { EvidenceRecord } from "./claims";
import { verifyCriteria, type VerificationResult } from "./verification";
import type { WorkingTreeSnapshot } from "./diff-evidence";
import type { FormalSpec, SpecTier } from "./types";

export class SpecEngine {
  activeSpec: FormalSpec | undefined;
  gateAttempts = 0;
  /**
   * Working-tree state as of turn start, awaited at agent_end to tell this turn's
   * changes from work that was already dirty. Held as a promise so capturing it
   * costs the turn no latency. Deliberately NOT re-captured on gate-continuation
   * turns: evidence accumulates across attempts against the original baseline.
   */
  turnBaseline: Promise<WorkingTreeSnapshot | undefined> | undefined;
  private evidence: EvidenceRecord[] = [];

  constructor(private readonly extractContractCandidate?: (prompt: string, tier: SpecTier) => unknown) {}

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
    this.activeSpec = generateSpec(prompt, tier, { extractContractCandidate: this.extractContractCandidate });
  }

  startTurn(prompt: string, explicitFlag: boolean): FormalSpec | undefined {
    const tier = this.classify(prompt, explicitFlag);
    this.generate(prompt, tier);
    return this.activeSpec;
  }

  preview(prompt: string, explicitFlag: boolean): FormalSpec | undefined {
    const tier = this.classify(prompt, explicitFlag);
    if (tier === "instant") return undefined;
    return generateSpec(prompt, tier, { extractContractCandidate: this.extractContractCandidate });
  }

  reset(): void {
    this.activeSpec = undefined;
    this.evidence = [];
    this.gateAttempts = 0;
    this.turnBaseline = undefined;
  }

  /**
   * Swap tool-input diff evidence for git ground truth. Called only when git
   * actually produced a result; otherwise the intent-based records stand, which is
   * the correct degradation outside a repo.
   */
  replaceDiffEvidence(record: EvidenceRecord | undefined): void {
    if (!this.activeSpec) return;
    this.evidence = this.evidence.filter((existing) => existing.kind !== "diff");
    if (record) this.evidence.push(record);
  }

  recordGateAttempt(): void {
    this.gateAttempts += 1;
  }

  /**
   * The user declined this spec at the approval gate. Drop it entirely: the turn
   * was refused, so there is nothing to verify and nothing to report. Leaving it
   * active made agent_end verify a spec whose every tool call had been denied —
   * all criteria failed for want of evidence, the gate re-injected "the task is
   * not done", and the next turn's clearSessionRules() had already dropped the
   * rejection's global deny, so the refused work ran unblocked.
   */
  rejectActiveSpec(): void {
    this.reset();
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
