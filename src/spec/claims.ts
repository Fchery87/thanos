export type EvidenceKind = "diff" | "test" | "command" | "manual";

export type EvidenceRecord =
  | DiffEvidence
  | TestEvidence
  | CommandEvidence
  | ManualEvidence;

export interface DiffEvidence {
  kind: "diff";
  paths: string[];
  base: string;
  patchHash: string;
  passed: boolean;
}

export interface TestEvidence {
  kind: "test";
  runner: string;
  normalizedExecutable: string;
  args: string[];
  exitCode: number;
  passed: boolean;
}

export interface CommandEvidence {
  kind: "command";
  /** Risk family from `commandAuditTarget` ("" when unclassified). */
  family: string;
  normalizedExecutable: string;
  argv: string[];
  exitCode: number;
  passed: boolean;
}

export interface ManualEvidence {
  kind: "manual";
  actor: "user" | "evaluator";
  claim: string;
  scope?: string[];
  passed: boolean;
}
