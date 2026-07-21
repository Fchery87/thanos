export interface PromptCase {
  id: string;
  family: string;
  input: string;
}

export interface GradedPromptCase {
  id: string;
  family: string;
  ok: boolean;
  reason: string;
}

export function gradePromptCase(input: PromptCase): GradedPromptCase {
  const ok = input.id.trim().length > 0 && input.family.trim().length > 0 && input.input.trim().length > 0;
  return { id: input.id, family: input.family, ok, reason: ok ? "valid case" : "missing id, family, or input" };
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
