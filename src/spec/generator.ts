// src/spec/generator.ts
import type {
  FormalSpec,
  SpecTier,
  AcceptanceCriterion,
  ApprovalStatus,
} from "./types";
import type { Capability } from "../permissions/rules";

let counter = 0;
const newId = () => `spec-${Date.now()}-${++counter}`;
const newCriterionId = () => `criterion-${Date.now()}-${++counter}`;

function buildCriteria(message: string): AcceptanceCriterion[] {
  const lower = message.toLowerCase();
  const criteria: AcceptanceCriterion[] = [];

  if (/\badd\b/.test(lower))
    criteria.push({
      id: newCriterionId(),
      statement: "Feature added as described",
      evidenceRequired: ["diff"],
    });
  if (/\btest/.test(lower))
    criteria.push({
      id: newCriterionId(),
      statement: "Tests written",
      evidenceRequired: ["test"],
    });
  if (/\brefactor/.test(lower))
    criteria.push({
      id: newCriterionId(),
      statement: "Code refactored",
      evidenceRequired: ["diff", "command"],
    });
  if (criteria.length === 0)
    criteria.push({
      id: newCriterionId(),
      statement: "Task completed",
      evidenceRequired: ["manual"],
    });

  return criteria;
}

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
  return {
    id: newId(),
    tier,
    status: "active",
    approvalStatus: approvalFor(tier),
    goal: message,
    allowedCapabilities: inferAllowedCapabilities(message),
    constraints: [],
    acceptanceCriteria: buildCriteria(message),
    targetFiles: [],
    risks: [],
    createdAt: Date.now(),
  };
}
