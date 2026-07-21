export type SpecialistId =
  | "explore" | "plan" | "build" | "reviewer" | "designer"
  | "oracle" | "researcher" | "evaluator" | "scout" | "worker"
  | "reviewer-correctness" | "reviewer-security" | "reviewer-tests";

export type ContextMode = "fresh" | "forked";

export interface SpecialistProfile {
  id: SpecialistId;
  writes: boolean;
  executes: boolean;
  contextModes: readonly ContextMode[];
  mayDelegate: readonly SpecialistId[];
  maxSubagentDepth?: number;
  modelRoutable: boolean;
  toolCeiling: readonly string[];
  requiredTools: readonly string[];
  outputContractVersion: number;
  promptTemplateId: string;
  runtimeEngine: "live" | "legacy" | "disabled";
  manifest: {
    systemPromptMode?: "replace";
    inheritProjectContext?: boolean;
    defaultContext?: "fork";
    defaultReads?: readonly string[];
    defaultProgress?: boolean;
  };
}

const READ_ONLY: readonly ContextMode[] = ["fresh"];

const FRESH_OR_FORKED: readonly ContextMode[] = ["fresh", "forked"];

const NO_DELEGATION: readonly SpecialistId[] = [];

const EXPLORE_DELEGATION: readonly SpecialistId[] = ["explore"];

const CATALOG: ReadonlyMap<SpecialistId, SpecialistProfile> = new Map([
  [
    "explore", {
      id: "explore",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      maxSubagentDepth: 0,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "web_search", "fetch_content"],
      requiredTools: ["read", "ls", "find", "grep", "bash"],
      outputContractVersion: 1,
      promptTemplateId: "explore",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
  [
    "plan", {
      id: "plan",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      maxSubagentDepth: 0,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "web_search", "fetch_content"],
      requiredTools: ["read", "ls", "find", "grep"],
      outputContractVersion: 1,
      promptTemplateId: "plan",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
  [
    "build", {
      id: "build",
      writes: true,
      executes: true,
      contextModes: FRESH_OR_FORKED,
      mayDelegate: EXPLORE_DELEGATION,
      maxSubagentDepth: 1,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "write", "edit", "bash", "task"],
      requiredTools: ["read", "write", "edit", "bash", "task"],
      outputContractVersion: 1,
      promptTemplateId: "build",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
  [
    "reviewer", {
      id: "reviewer",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: EXPLORE_DELEGATION,
      maxSubagentDepth: 1,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "report_finding", "task", "subagent"],
      requiredTools: ["read", "ls", "find", "grep", "report_finding", "task"],
      outputContractVersion: 1,
      promptTemplateId: "reviewer",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
  [
    "designer", {
      id: "designer",
      writes: true,
      executes: false,
      contextModes: FRESH_OR_FORKED,
      mayDelegate: NO_DELEGATION,
      maxSubagentDepth: 2,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "write", "edit", "web_search", "fetch_content", "subagent"],
      requiredTools: ["read", "write", "edit"],
      outputContractVersion: 1,
      promptTemplateId: "designer",
      runtimeEngine: "live",
      manifest: {
        inheritProjectContext: true,
      },
    },
  ],
  [
    "oracle", {
      id: "oracle",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      maxSubagentDepth: 0,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "web_search", "fetch_content"],
      requiredTools: ["read", "ls", "find", "grep"],
      outputContractVersion: 1,
      promptTemplateId: "oracle",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
  [
    "researcher", {
      id: "researcher",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      maxSubagentDepth: 0,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "web_search", "fetch_content"],
      requiredTools: ["read", "ls", "find", "grep", "web_search", "fetch_content"],
      outputContractVersion: 1,
      promptTemplateId: "researcher",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
  [
    "evaluator", {
      id: "evaluator",
      writes: false,
      executes: true,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      maxSubagentDepth: 0,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "bash", "report_finding"],
      requiredTools: ["read", "ls", "find", "grep", "bash"],
      outputContractVersion: 1,
      promptTemplateId: "evaluator",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
  [
    "scout", {
      id: "scout",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      maxSubagentDepth: 0,
      modelRoutable: false,
      toolCeiling: ["read", "ls", "find", "grep"],
      requiredTools: ["read", "ls", "find", "grep"],
      outputContractVersion: 1,
      promptTemplateId: "scout",
      runtimeEngine: "live",
      manifest: {
        systemPromptMode: "replace",
        inheritProjectContext: true,
        defaultProgress: true,
      },
    },
  ],
  [
    "worker", {
      id: "worker",
      writes: true,
      executes: true,
      contextModes: FRESH_OR_FORKED,
      mayDelegate: NO_DELEGATION,
      maxSubagentDepth: 0,
      modelRoutable: false,
      toolCeiling: ["read", "ls", "find", "grep", "write", "edit", "bash"],
      requiredTools: ["read", "ls", "find", "grep", "write", "edit", "bash"],
      outputContractVersion: 1,
      promptTemplateId: "worker",
      runtimeEngine: "live",
      manifest: {
        systemPromptMode: "replace",
        inheritProjectContext: true,
        defaultContext: "fork",
        defaultReads: ["context.md", "plan.md"],
        defaultProgress: true,
      },
    },
  ],
  [
    "reviewer-correctness", {
      id: "reviewer-correctness",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: EXPLORE_DELEGATION,
      maxSubagentDepth: 1,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "report_finding", "task", "subagent"],
      requiredTools: ["read", "ls", "find", "grep", "report_finding", "task"],
      outputContractVersion: 1,
      promptTemplateId: "reviewer-correctness",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
  [
    "reviewer-security", {
      id: "reviewer-security",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: EXPLORE_DELEGATION,
      maxSubagentDepth: 1,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "report_finding", "task", "subagent"],
      requiredTools: ["read", "ls", "find", "grep", "report_finding", "task"],
      outputContractVersion: 1,
      promptTemplateId: "reviewer-security",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
  [
    "reviewer-tests", {
      id: "reviewer-tests",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: EXPLORE_DELEGATION,
      maxSubagentDepth: 1,
      modelRoutable: true,
      toolCeiling: ["read", "ls", "find", "grep", "report_finding", "task", "subagent"],
      requiredTools: ["read", "ls", "find", "grep", "report_finding", "task"],
      outputContractVersion: 1,
      promptTemplateId: "reviewer-tests",
      runtimeEngine: "live",
      manifest: {},
    },
  ],
]);

export function getSpecialist(id: SpecialistId): SpecialistProfile | undefined {
  return CATALOG.get(id);
}

export function allSpecialists(): readonly SpecialistProfile[] {
  return Array.from(CATALOG.values());
}

export function getAllIds(): readonly SpecialistId[] {
  return Array.from(CATALOG.keys());
}

export function writingAgentIds(): readonly SpecialistId[] {
  return Array.from(CATALOG.entries())
    .filter(([_, p]) => p.writes)
    .map(([id]) => id);
}

export function readOnlyAgentIds(): readonly SpecialistId[] {
  return Array.from(CATALOG.entries())
    .filter(([_, p]) => !p.writes)
    .map(([id]) => id);
}

export function agentWrites(id: string): boolean {
  const profile = CATALOG.get(id as SpecialistId);
  return profile?.writes ?? false;
}

export function agentExecutes(id: string): boolean {
  const profile = CATALOG.get(id as SpecialistId);
  return profile?.executes ?? false;
}

export function allowedContextModes(id: string): readonly ContextMode[] {
  const profile = CATALOG.get(id as SpecialistId);
  return profile?.contextModes ?? READ_ONLY;
}

export function mayDelegateTo(id: string, target: string): boolean {
  const profile = CATALOG.get(id as SpecialistId);
  if (!profile) return false;
  return profile.mayDelegate.includes(target as SpecialistId);
}
