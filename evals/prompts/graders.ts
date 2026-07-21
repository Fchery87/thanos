export interface PromptCase {
  id: string;
  family: string;
  input: string;
  expectedOutcome: "fail-closed" | "contract-required" | "stage-enforced";
  requiredChecks: string[];
  releaseBlocking: boolean;
  modelFamilies: string[];
  stochasticRepeats: number;
}

export interface GradedPromptCase {
  id: string;
  family: string;
  ok: boolean;
  reason: string;
}

export interface PromptEvalResult {
  id: string;
  ok: boolean;
  modelFamily: string;
  latencyMs: number;
  tokenCostUsd: number;
  delegationCount: number;
}

export interface PromptEvalReport {
  ok: boolean;
  cases: number;
  summary: { total: number; passed: number; failed: number };
  familyCheck: { ok: boolean; missingFamilies: string[] };
  releaseBlockingFailures: string[];
  stochasticCoverageFailures: string[];
  modelFamilyCoverageFailures: string[];
  metrics: {
    averageLatencyMs: number;
    averageTokenCostUsd: number;
    averageDelegationCount: number;
  };
}

function hasRequiredPromptMetadata(input: PromptCase): { ok: boolean; reason?: string } {
  if (input.expectedOutcome.trim().length === 0) {
    return { ok: false, reason: "missing expectedOutcome" };
  }
  if (!Array.isArray(input.requiredChecks) || input.requiredChecks.length === 0) {
    return { ok: false, reason: "missing requiredChecks" };
  }
  if (!Array.isArray(input.modelFamilies) || input.modelFamilies.length < 2) {
    return { ok: false, reason: "modelFamilies must include at least two families" };
  }
  if (typeof input.stochasticRepeats !== "number" || input.stochasticRepeats < 3) {
    return { ok: false, reason: "stochasticRepeats must be at least 3" };
  }
  return { ok: true };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function gradePromptCase(input: PromptCase): GradedPromptCase {
  const baseOk = input.id.trim().length > 0 && input.family.trim().length > 0 && input.input.trim().length > 0;
  if (!baseOk) {
    return { id: input.id, family: input.family, ok: false, reason: "missing id, family, or input" };
  }
  const metadata = hasRequiredPromptMetadata(input);
  return { id: input.id, family: input.family, ok: metadata.ok, reason: metadata.ok ? "valid case" : metadata.reason ?? "invalid case" };
}

export function summarizePromptGrades(cases: PromptCase[]): { total: number; passed: number; failed: number } {
  const graded = cases.map(gradePromptCase);
  return {
    total: graded.length,
    passed: graded.filter((item) => item.ok).length,
    failed: graded.filter((item) => !item.ok).length,
  };
}

export function validatePromptFamilies(cases: PromptCase[], requiredFamilies: string[]): { ok: boolean; missingFamilies: string[] } {
  const families = new Set(cases.map((item) => item.family));
  const missingFamilies = requiredFamilies.filter((family) => !families.has(family));
  return { ok: missingFamilies.length === 0, missingFamilies };
}

export function buildPromptEvalReport(input: {
  cases: PromptCase[];
  requiredFamilies: string[];
  results: PromptEvalResult[];
}): PromptEvalReport {
  const summary = summarizePromptGrades(input.cases);
  const familyCheck = validatePromptFamilies(input.cases, input.requiredFamilies);
  const releaseBlockingFailures = input.cases
    .filter((item) => item.releaseBlocking)
    .filter((item) => input.results.some((result) => result.id === item.id && !result.ok))
    .map((item) => item.id);
  const stochasticCoverageFailures = input.cases
    .filter((item) => input.results.filter((result) => result.id === item.id).length < item.stochasticRepeats)
    .map((item) => item.id);
  const modelFamilyCoverageFailures = input.cases
    .filter((item) => item.modelFamilies.some((family) => !input.results.some((result) => result.id === item.id && result.modelFamily === family)))
    .map((item) => item.id);

  return {
    ok: summary.failed === 0
      && familyCheck.ok
      && releaseBlockingFailures.length === 0
      && stochasticCoverageFailures.length === 0
      && modelFamilyCoverageFailures.length === 0,
    cases: input.cases.length,
    summary,
    familyCheck,
    releaseBlockingFailures,
    stochasticCoverageFailures,
    modelFamilyCoverageFailures,
    metrics: {
      averageLatencyMs: average(input.results.map((item) => item.latencyMs)),
      averageTokenCostUsd: average(input.results.map((item) => item.tokenCostUsd)),
      averageDelegationCount: average(input.results.map((item) => item.delegationCount)),
    },
  };
}
