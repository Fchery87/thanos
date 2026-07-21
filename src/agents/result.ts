export type SubagentStatus = "success" | "error" | "timeout" | "escalated";

const KNOWN_STATUSES: Set<string> = new Set(["success", "error", "timeout", "escalated"]);

const MAX_RESULT_SIZE = 512 * 1024; // 512 KB before parsing
const MAX_SUMMARY_LENGTH = 4000;
const MAX_FINDINGS = 50;
const MAX_ARTIFACTS = 50;
const MAX_ESCALATIONS = 10;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_BYTES = 8 * 1024; // 8 KB serialized

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
  version: 1;
  status: SubagentStatus;
  summary: string;
  findings: Finding[];
  artifacts: ArtifactRef[];
  escalations: Escalation[];
  metadata?: Record<string, unknown>;
}

const VALID_PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);

function validateFinding(f: unknown): Finding | undefined {
  if (!f || typeof f !== "object") return undefined;
  const obj = f as Record<string, unknown>;
  if (typeof obj.summary !== "string") return undefined;
  if (typeof obj.priority !== "string" || !VALID_PRIORITIES.has(obj.priority)) return undefined;
  const finding: Finding = { priority: obj.priority as Finding["priority"], summary: obj.summary };
  if (typeof obj.file === "string") finding.file = obj.file;
  if (typeof obj.line === "number") finding.line = obj.line;
  if (typeof obj.suggestion === "string") finding.suggestion = obj.suggestion;
  return finding;
}

function validateArtifact(a: unknown): ArtifactRef | undefined {
  if (!a || typeof a !== "object") return undefined;
  const obj = a as Record<string, unknown>;
  if (typeof obj.name !== "string" || typeof obj.path !== "string") return undefined;
  const bytes = typeof obj.bytes === "number" ? obj.bytes : 0;
  return { name: obj.name, path: obj.path, bytes };
}

function validateEscalation(e: unknown): Escalation | undefined {
  if (!e || typeof e !== "object") return undefined;
  const obj = e as Record<string, unknown>;
  if (typeof obj.question !== "string") return undefined;
  const esc: Escalation = { question: obj.question };
  if (Array.isArray(obj.options)) esc.options = obj.options.filter((o): o is string => typeof o === "string");
  if (typeof obj.recommended === "string") esc.recommended = obj.recommended;
  return esc;
}

function metadataDepth(obj: unknown, depth = 0): number {
  if (depth > MAX_METADATA_DEPTH) return depth;
  if (!obj || typeof obj !== "object") return depth;
  let maxDepth = depth;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const childDepth = metadataDepth(v, depth + 1);
    if (childDepth > maxDepth) maxDepth = childDepth;
  }
  return maxDepth;
}

function validateMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  if (metadataDepth(raw) > MAX_METADATA_DEPTH) return undefined;
  const serialized = JSON.stringify(raw);
  if (Buffer.byteLength(serialized, "utf-8") > MAX_METADATA_BYTES) return undefined;
  return raw as Record<string, unknown>;
}

export function needsClarification(contract: SubagentResultContract): boolean {
  return contract.status === "escalated" || contract.escalations.length > 0;
}

function errorContract(reason: string): SubagentResultContract {
  return { version: 1, status: "error", summary: reason, findings: [], artifacts: [], escalations: [], metadata: { legacy: true } };
}

function plainText(summary: string): SubagentResultContract {
  return { version: 1, status: "error", summary, findings: [], artifacts: [], escalations: [], metadata: { legacy: true } };
}

export function parseSubagentResult(text: string, opts?: { legacyAdapter?: boolean }): SubagentResultContract {
  if (text.length > MAX_RESULT_SIZE) {
    return errorContract(`result exceeds maximum size of ${MAX_RESULT_SIZE} bytes`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return opts?.legacyAdapter ? { ...plainText(text), status: "success" } : errorContract("invalid result contract format");
  }

  if (!parsed || typeof parsed !== "object") {
    return opts?.legacyAdapter ? { ...plainText(typeof parsed === "string" ? parsed : text), status: "success" } : errorContract("invalid result contract format");
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.version !== undefined && obj.version !== 1) {
    return errorContract("missing or unsupported result contract version");
  }

  if (typeof obj.summary === "string") {
    const status = typeof obj.status === "string" && KNOWN_STATUSES.has(obj.status)
      ? (obj.status as SubagentStatus)
      : "error";
    const summary = obj.summary.slice(0, MAX_SUMMARY_LENGTH);

    const findings: Finding[] = [];
    const rawFindings = Array.isArray(obj.findings) ? obj.findings.slice(0, MAX_FINDINGS) : [];
    for (const f of rawFindings) {
      const validated = validateFinding(f);
      if (validated) findings.push(validated);
    }

    const artifacts: ArtifactRef[] = [];
    const rawArtifacts = Array.isArray(obj.artifacts) ? obj.artifacts.slice(0, MAX_ARTIFACTS) : [];
    for (const a of rawArtifacts) {
      const validated = validateArtifact(a);
      if (validated) artifacts.push(validated);
    }

    const escalations: Escalation[] = [];
    const rawEscalations = Array.isArray(obj.escalations) ? obj.escalations.slice(0, MAX_ESCALATIONS) : [];
    for (const e of rawEscalations) {
      const validated = validateEscalation(e);
      if (validated) escalations.push(validated);
    }

    const contract: SubagentResultContract = {
      version: 1,
      status,
      summary,
      findings,
      artifacts,
      escalations,
    };

    const meta = validateMetadata(obj.metadata);
    if (meta) contract.metadata = meta;

    return contract;
  }

  if (typeof obj.text === "string") {
    if (!opts?.legacyAdapter) return errorContract("legacy result format not allowed");
    const contract = { ...plainText(obj.text), status: "success" as const };
    const meta = validateMetadata(obj.metadata);
    if (meta) contract.metadata = meta;
    return contract;
  }

  return errorContract("invalid result contract format");
}
