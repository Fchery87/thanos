export type ContextOrigin = "user" | "project" | "memory" | "tool" | "subagent" | "harness";

export type ContextAuthority = "instruction" | "preference" | "request" | "evidence";

/** How far this content is scoped: a durable user preference down to a single turn. */
export type ContextScope = "user" | "project" | "session" | "turn";

/**
 * Provenance for one block of model-visible, non-authoritative content. These
 * fields are descriptive metadata only — `renderContextEnvelope` quotes and
 * escapes `content` so it reads as data to the model, and nothing here is
 * ever read by `GovernanceRuntime` as an authorization input. `trusted`, in
 * particular, is a label for the reader, not a grant: widening it can never
 * widen capability, target root, delivery mode, or acceptance status.
 */
export interface ContextEnvelope {
  id: string;
  origin: ContextOrigin;
  authority: ContextAuthority;
  scope: ContextScope;
  /** Where this specific block came from — e.g. a file path, tool name, or record id. */
  source: string;
  trusted: boolean;
  /** ISO timestamp this content was captured, if known. */
  capturedAt?: string;
  /** ISO timestamp after which this content should be treated as stale. */
  staleAfter?: string;
  content: string;
  maxBytes: number;
}

export function makeContextEnvelope(input: ContextEnvelope): ContextEnvelope {
  return input;
}
