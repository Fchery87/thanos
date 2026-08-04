import type { RunFact } from "./types";

export type RunFactInput =
  | Omit<Extract<RunFact, { kind: "delegation_settled" }>, "version" | "runId" | "sequence">
  | Omit<Extract<RunFact, { kind: "workflow_transition" }>, "version" | "runId" | "sequence">
  | Omit<Extract<RunFact, { kind: "recovery_outcome" }>, "version" | "runId" | "sequence">
  | Omit<Extract<RunFact, { kind: "acceptance_verdict" }>, "version" | "runId" | "sequence">;

export class RunFactRecorder {
  private sequence = 0;
  private readonly facts: RunFact[] = [];

  constructor(private readonly runId: string) {}

  record(fact: RunFactInput): RunFact {
    const next = { ...fact, version: 1 as const, runId: this.runId, sequence: ++this.sequence } as RunFact;
    this.facts.push(next);
    return next;
  }

  snapshot(): readonly RunFact[] {
    return [...this.facts];
  }
}
