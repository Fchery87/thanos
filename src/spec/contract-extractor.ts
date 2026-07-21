import type { SpecTier } from "./types";
import { validateTaskContract } from "./contract-schema";
import { buildTaskContract, type TaskContract } from "./task-contract";

export interface ContractExtractionOptions {
  tier: SpecTier;
  candidate?: unknown;
  extractCandidate?: (prompt: string, tier: SpecTier) => unknown;
}

export function extractTaskContract(prompt: string, options?: ContractExtractionOptions): TaskContract {
  const extracted = options?.tier && options.tier !== "instant" && options.extractCandidate
    ? options.extractCandidate(prompt, options.tier)
    : undefined;
  const validated = validateTaskContract(options?.candidate ?? extracted);
  if (validated && validated.objective.length > 0) {
    return validated;
  }
  return buildTaskContract(prompt);
}
