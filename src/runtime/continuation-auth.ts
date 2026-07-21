export type ContinuationKind = "spec" | "goal";

interface ContinuationRecord {
  id: string;
  kind: ContinuationKind;
  prompt: string;
  expiresAt: number;
  consumed: boolean;
}

const sessions = new Map<string, ContinuationRecord>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function newId(sessionId: string, kind: ContinuationKind): string {
  return Buffer.from(`${sessionId}:${kind}:${Math.random().toString(36).slice(2, 12)}`).toString("base64url");
}

export function issueContinuation(
  sessionId: string,
  kind: ContinuationKind,
  prompt: string,
  opts?: { now?: number; ttlMs?: number },
): { id: string; expiresAt: number } {
  const now = opts?.now ?? Date.now();
  const expiresAt = now + (opts?.ttlMs ?? DEFAULT_TTL_MS);
  const id = newId(sessionId, kind);
  sessions.set(sessionId, { id, kind, prompt, expiresAt, consumed: false });
  return { id, expiresAt };
}

export function consumeContinuation(
  sessionId: string,
  kind: ContinuationKind,
  prompt: string,
  opts?: { now?: number },
): boolean {
  const record = sessions.get(sessionId);
  const now = opts?.now ?? Date.now();
  if (!record || record.consumed || record.kind !== kind || record.prompt !== prompt || record.expiresAt < now) return false;
  record.consumed = true;
  return true;
}

export function hasContinuation(sessionId: string, kind: ContinuationKind): boolean {
  const record = sessions.get(sessionId);
  return !!record && !record.consumed && record.kind === kind && record.expiresAt >= Date.now();
}
