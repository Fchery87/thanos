export interface PromptCase {
  id: string;
  family: string;
  input: string;
}

export function gradePromptCase(input: PromptCase): { id: string; family: string; ok: boolean } {
  return { id: input.id, family: input.family, ok: input.input.length > 0 };
}
