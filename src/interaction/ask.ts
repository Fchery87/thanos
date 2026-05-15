import { Type } from "typebox";
import type { PolicyPreset } from "../policy/types";

export const AskOptionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
});

export const AskParamsSchema = Type.Object({
  question: Type.String({ minLength: 1 }),
  options: Type.Array(AskOptionSchema, { minItems: 2 }),
  recommended: Type.String({ minLength: 1 }),
  allowOther: Type.Optional(Type.Boolean()),
  rationale: Type.Optional(Type.Boolean()),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  evidenceScope: Type.Optional(Type.String()),
});

export type AskOption = { id: string; label: string; description?: string };
export type AskQuestion = {
  question: string;
  options: AskOption[];
  recommended: string;
  allowOther?: boolean;
  rationale?: boolean;
  timeoutSeconds?: number;
  evidenceScope?: string;
};
export type AskDecisionSource = "user" | "default";
export type AskDecision = {
  question: string;
  options: string[];
  selected: string[];
  recommended: string;
  source: AskDecisionSource;
  rationale?: string;
  evidenceScope?: string;
};

function optionIds(question: AskQuestion): string[] {
  return question.options.map((option) => option.id);
}

function assertUnique(ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error("duplicate option id");
}

function assertKnown(ids: string[], selected: string[]): void {
  const known = new Set(ids);
  for (const id of selected) {
    if (!known.has(id)) throw new Error(`unknown option: ${id}`);
  }
}

export function buildAskDecision(
  question: AskQuestion,
  selected: string[],
  source: AskDecisionSource,
  rationale?: string,
): AskDecision {
  const ids = optionIds(question);
  assertUnique(ids);
  assertKnown(ids, selected);
  if (selected.length !== 1) throw new Error("ask requires exactly one selection");

  return {
    question: question.question,
    options: ids,
    selected,
    recommended: question.recommended,
    source,
    ...(rationale ? { rationale } : {}),
    ...(question.evidenceScope ? { evidenceScope: question.evidenceScope } : {}),
  };
}

export function buildAskAuditMetadata(decision: AskDecision): Record<string, unknown> {
  return {
    question: decision.question,
    options: decision.options,
    selected: decision.selected,
    recommended: decision.recommended,
    source: decision.source,
    ...(decision.rationale ? { rationale: decision.rationale } : {}),
  };
}

export function resolveHeadlessAsk(
  question: AskQuestion,
  preset: PolicyPreset,
): { kind: "blocked"; reason: string } | { kind: "selected"; selected: string[]; source: "default" } {
  if (preset !== "personal") return { kind: "blocked", reason: "ask requires interactive UI" };
  if (typeof question.timeoutSeconds !== "number" || question.timeoutSeconds <= 0) {
    return { kind: "blocked", reason: "ask requires interactive UI" };
  }
  return { kind: "selected", selected: [question.recommended], source: "default" };
}
