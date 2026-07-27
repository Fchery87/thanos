import { generateSpec } from "./generator";
import { evidenceFromToolResult, type ToolResultEventLike } from "./evidence";
import type { EvidenceRecord } from "./claims";
import { verifyCriteria, type VerificationResult } from "./verification";
import { validateTaskContractDetailed } from "./contract-schema";
import { noopExtractionReporter, type ExtractionReporter } from "./extraction-log";
import { buildContractFromTaskContract } from "./contract";
import type { TaskContract } from "./task-contract";
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
  /**
   * In-flight semantic extraction for the active spec, if an extractor is wired.
   *
   * The spec is never absent while this is pending: `generate` installs the
   * deterministic contract synchronously, and {@link settleContract} upgrades it
   * in place if and when extraction returns something valid. Any failure — model
   * error, timeout, schema rejection — simply leaves the deterministic contract
   * standing, which is the floor this design guarantees.
   */
  private pendingContract: Promise<TaskContract | undefined> | undefined;
  /** Spec id the pending extraction belongs to, so a stale result cannot land. */
  private pendingContractFor: string | undefined;

  constructor(
    private readonly extractContractCandidate?: (prompt: string, tier: SpecTier) => Promise<unknown>,
    /**
     * Records what happened to an extraction candidate after it came back.
     *
     * The extractor cannot report these: schema rejection, an empty objective
     * and a stale result all happen here, and schema rejection is the one that
     * produced the 0-for-48. Defaults to silence so unit tests stay side-effect
     * free.
     */
    private readonly report: ExtractionReporter = noopExtractionReporter,
  ) {}

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
    // Deterministic contract first and synchronously: callers must never observe
    // a turn without a spec, and this is the floor extraction can only improve on.
    this.activeSpec = generateSpec(prompt, tier);

    if (!this.extractContractCandidate) return;
    // Started synchronously so extraction begins when the turn does, rather than a
    // microtask later. A synchronous throw is treated exactly like a rejection:
    // no pending contract, deterministic stands.
    let candidate: Promise<unknown>;
    try {
      candidate = Promise.resolve(this.extractContractCandidate(prompt, tier));
    } catch {
      return;
    }
    this.pendingContractFor = this.activeSpec.id;
    this.pendingContract = candidate
      .then((value) => {
        // `undefined` means the extractor already reported its own reason; only
        // a candidate that came back and then failed validation is news here.
        if (value === undefined) return undefined;
        const { contract, reason } = validateTaskContractDetailed(value);
        if (!contract) this.report({ outcome: "schema_rejected", detail: reason });
        return contract;
      })
      .catch(() => undefined);
  }

  /**
   * Fold a completed extraction into the active spec, if one arrived and validated.
   *
   * Idempotent, and safe to call when no extractor is wired — then it is a no-op,
   * which is what keeps this seam behaviour-neutral until an extractor exists.
   * Must be awaited before anything reads the contract as final: verification at
   * agent_end, and the explicit-tier approval prompt (a user has to approve the
   * contract that will actually be enforced, not a placeholder swapped afterwards).
   */
  async settleContract(): Promise<void> {
    const pending = this.pendingContract;
    if (!pending) return;
    const specId = this.pendingContractFor;
    this.pendingContract = undefined;
    this.pendingContractFor = undefined;

    const contract = await pending;
    if (!contract) return; // already reported, by the extractor or above
    if (contract.objective.length === 0) {
      this.report({ outcome: "empty_objective" });
      return;
    }
    // A new turn (or a rejection) may have replaced the spec while extraction was
    // in flight; a stale result must not land on it.
    if (!this.activeSpec || this.activeSpec.id !== specId) {
      this.report({ outcome: "stale" });
      return;
    }

    // Mutated in place so references captured by callers stay valid.
    this.activeSpec.taskContract = contract;
    this.activeSpec.acceptanceCriteria = buildContractFromTaskContract(contract).acceptanceCriteria;
    this.report({ outcome: "accepted", criteriaCount: contract.criteria.length });
  }

  startTurn(prompt: string, explicitFlag: boolean): FormalSpec | undefined {
    const tier = this.classify(prompt, explicitFlag);
    this.generate(prompt, tier);
    return this.activeSpec;
  }

  preview(prompt: string, explicitFlag: boolean): FormalSpec | undefined {
    const tier = this.classify(prompt, explicitFlag);
    if (tier === "instant") return undefined;
    // Deterministic only: a preview must not spend a model call or block.
    return generateSpec(prompt, tier);
  }

  reset(): void {
    this.activeSpec = undefined;
    this.evidence = [];
    this.gateAttempts = 0;
    this.turnBaseline = undefined;
    this.pendingContract = undefined;
    this.pendingContractFor = undefined;
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

  verify(): VerificationResult[] {
    if (!this.activeSpec) return [];
    return verifyCriteria(this.activeSpec, this.evidence);
  }
}
