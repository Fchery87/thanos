import { generateSpec } from "./generator";
import { evidenceFromToolResult, type EvidenceRecord, type ToolResultEventLike } from "./evidence";
import { verifyCriteria, type VerificationResult } from "./verification";
import type { FormalSpec, SpecTier } from "./types";

function assistantTexts(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const text: string[] = [];

  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    if ((message as { role?: unknown }).role !== "assistant") continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    const summary = content
      .filter((part): part is { type: string; text?: string } => Boolean(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (summary) text.push(summary);
  }

  return text;
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
  }

  collectOutput(text: string): void {
    if (!this.activeSpec) return;
    const summary = text.trim();
    if (!summary) return;
    this.recordEvidence({ type: "manual", source: "assistant", summary, passed: true });
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

  finishTurn(messages: unknown): VerificationResult[] {
    for (const text of assistantTexts(messages)) {
      this.collectOutput(text);
    }
    return this.verify();
  }

  verify(): VerificationResult[] {
    if (!this.activeSpec) return [];
    return verifyCriteria(this.activeSpec, this.evidence);
  }
}
