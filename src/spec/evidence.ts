import type { EvidenceRequirement } from "./types";

export type EvidenceType = EvidenceRequirement;

export interface EvidenceRecord {
  type: EvidenceType;
  source: string;
  summary: string;
  passed: boolean;
  filePath?: string;
  commandFamily?: string;
}
