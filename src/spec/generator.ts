// src/spec/generator.ts
import type {
  FormalSpec,
  SpecTier,
  ApprovalStatus,
} from "./types";
import type { Capability } from "../permissions/rules";
import { buildContractFromTaskContract } from "./contract";
import { extractTaskContract } from "./contract-extractor";

/**
 * Spec generation is synchronous by contract: a turn must never observe a missing
 * spec. Semantic extraction is asynchronous and therefore lives on SpecEngine,
 * which installs this deterministic result immediately and upgrades it in place
 * via `settleContract()` if extraction returns something the schema accepts.
 */
export interface GenerateSpecOptions {
  /** A pre-resolved contract candidate, when the caller already has one. */
  candidate?: unknown;
}

let counter = 0;
const newId = () => `spec-${Date.now()}-${++counter}`;

function inferAllowedCapabilities(message: string): Capability[] {
  const lower = message.toLowerCase();
  const capabilities: Capability[] = ["read"];

  if (/\b(add|build|create|implement|refactor|update|write|remove|migrate)\b/.test(lower)) {
    capabilities.push("edit");
  }
  if (/\b(test|verify|run)\b/.test(lower)) {
    capabilities.push("exec");
  }

  return capabilities;
}

function approvalFor(tier: SpecTier): ApprovalStatus {
  return tier === "explicit" ? "pending" : "not_required";
}

export function generateSpec(message: string, tier: SpecTier, options?: GenerateSpecOptions): FormalSpec {
  const taskContract = extractTaskContract(message, {
    tier,
    candidate: options?.candidate,
  });
  const contract = buildContractFromTaskContract(taskContract);

  return {
    id: newId(),
    tier,
    status: "active",
    approvalStatus: approvalFor(tier),
    goal: message,
    taskContract,
    allowedCapabilities: inferAllowedCapabilities(message),
    constraints: [],
    acceptanceCriteria: contract.acceptanceCriteria,
    targetFiles: [],
    risks: [],
    createdAt: Date.now(),
  };
}
