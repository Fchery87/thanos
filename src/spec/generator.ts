// src/spec/generator.ts
import type {
  FormalSpec,
  SpecTier,
  ApprovalStatus,
} from "./types";
import type { Capability } from "../permissions/rules";
import { buildDefaultFailContract } from "./contract";

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

export function generateSpec(message: string, tier: SpecTier): FormalSpec {
  const contract = buildDefaultFailContract(message);

  return {
    id: newId(),
    tier,
    status: "active",
    approvalStatus: approvalFor(tier),
    goal: message,
    allowedCapabilities: inferAllowedCapabilities(message),
    constraints: [],
    acceptanceCriteria: contract.acceptanceCriteria,
    targetFiles: [],
    risks: [],
    createdAt: Date.now(),
  };
}
