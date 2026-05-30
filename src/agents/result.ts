export type SubagentStatus = "success" | "error" | "timeout" | "escalated";

export interface Finding {
  priority: "P0" | "P1" | "P2" | "P3";
  summary: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface ArtifactRef {
  name: string;
  path: string;
  bytes: number;
}

export interface Escalation {
  question: string;
  options?: string[];
  recommended?: string;
}

export interface SubagentResultContract {
  status: SubagentStatus;
  summary: string;
  findings: Finding[];
  artifacts: ArtifactRef[];
  escalations: Escalation[];
  metadata?: Record<string, unknown>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function plainText(summary: string): SubagentResultContract {
  return { status: "success", summary, findings: [], artifacts: [], escalations: [] };
}

export function parseSubagentResult(text: string): SubagentResultContract {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return plainText(text);
  }

  if (!parsed || typeof parsed !== "object") return plainText(text);
  const obj = parsed as Record<string, unknown>;

  // Canonical contract: has a string `summary`.
  if (typeof obj.summary === "string") {
    const contract: SubagentResultContract = {
      status: (obj.status as SubagentStatus) ?? "success",
      summary: obj.summary,
      findings: asArray<Finding>(obj.findings),
      artifacts: asArray<ArtifactRef>(obj.artifacts),
      escalations: asArray<Escalation>(obj.escalations),
    };
    if (obj.metadata && typeof obj.metadata === "object") {
      contract.metadata = obj.metadata as Record<string, unknown>;
    }
    return contract;
  }

  // Legacy { text, metadata } shape.
  if (typeof obj.text === "string") {
    const contract = plainText(obj.text);
    if (obj.metadata && typeof obj.metadata === "object") {
      contract.metadata = obj.metadata as Record<string, unknown>;
    }
    return contract;
  }

  return plainText(text);
}
