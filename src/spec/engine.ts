import { generateSpec } from "./generator";
import type { FormalSpec, SpecTier, AcceptanceCriterion } from "./types";

export interface VerificationResult {
  criterion: AcceptanceCriterion;
  passed: boolean;
  evidence: string[];
}

export class SpecEngine {
  activeSpec: FormalSpec | undefined;
  private collectedOutput: string[] = [];

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
    this.collectedOutput = [];
  }

  reset(): void {
    this.activeSpec = undefined;
    this.collectedOutput = [];
  }

  collectOutput(text: string): void {
    this.collectedOutput.push(text);
  }

  verify(): VerificationResult[] {
    if (!this.activeSpec) return [];
    const combined = this.collectedOutput.join(" ").toLowerCase();
    return this.activeSpec.acceptanceCriteria.map((criterion) => {
      const passed = (criterion.keywords ?? []).some((kw) => combined.includes(kw));
      return { criterion, passed, evidence: passed ? [combined.slice(0, 100)] : [] };
    });
  }
}
