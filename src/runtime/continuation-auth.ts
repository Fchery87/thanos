export type ContinuationKind = "spec" | "goal";

interface ContinuationRecord {
  kind: ContinuationKind;
  prompt: string;
  consumed: boolean;
}

const sessions = new Map<string, ContinuationRecord>();

export function issueContinuation(sessionId: string, kind: ContinuationKind, prompt: string): void {
  sessions.set(sessionId, { kind, prompt, consumed: false });
}

export function consumeContinuation(sessionId: string, kind: ContinuationKind, prompt: string): boolean {
  const record = sessions.get(sessionId);
  if (!record || record.consumed || record.kind !== kind || record.prompt !== prompt) return false;
  record.consumed = true;
  return true;
}

export function hasContinuation(sessionId: string, kind: ContinuationKind): boolean {
  const record = sessions.get(sessionId);
  return !!record && !record.consumed && record.kind === kind;
}
