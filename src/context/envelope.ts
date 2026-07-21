export type ContextOrigin = "user" | "project" | "memory" | "tool" | "subagent" | "harness";

export type ContextAuthority = "instruction" | "preference" | "request" | "evidence";

export interface ContextEnvelope {
  id: string;
  origin: ContextOrigin;
  authority: ContextAuthority;
  trusted: boolean;
  content: string;
  maxBytes: number;
}

export function makeContextEnvelope(input: ContextEnvelope): ContextEnvelope {
  return input;
}
