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
  modelRoutable: boolean;
  requiredTools: readonly string[];
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
      modelRoutable: true,
      requiredTools: ["read", "ls", "find", "grep", "bash"],
    },
  ],
  [
    "plan", {
      id: "plan",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "ls", "find", "grep"],
    },
  ],
  [
    "build", {
      id: "build",
      writes: true,
      executes: true,
      contextModes: FRESH_OR_FORKED,
      mayDelegate: EXPLORE_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "write", "edit", "bash", "task"],
    },
  ],
  [
    "reviewer", {
      id: "reviewer",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: EXPLORE_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "ls", "find", "grep", "report_finding", "task"],
    },
  ],
  [
    "designer", {
      id: "designer",
      writes: true,
      executes: false,
      contextModes: FRESH_OR_FORKED,
      mayDelegate: NO_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "write", "edit"],
    },
  ],
  [
    "oracle", {
      id: "oracle",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "ls", "find", "grep"],
    },
  ],
  [
    "researcher", {
      id: "researcher",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "ls", "find", "grep", "bash"],
    },
  ],
  [
    "evaluator", {
      id: "evaluator",
      writes: false,
      executes: true,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "ls", "find", "grep", "bash"],
    },
  ],
  [
    "scout", {
      id: "scout",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: NO_DELEGATION,
      modelRoutable: false,
      requiredTools: ["read", "ls", "find", "grep"],
    },
  ],
  [
    "worker", {
      id: "worker",
      writes: true,
      executes: true,
      contextModes: FRESH_OR_FORKED,
      mayDelegate: NO_DELEGATION,
      modelRoutable: false,
      requiredTools: ["read", "write", "edit", "bash"],
    },
  ],
  [
    "reviewer-correctness", {
      id: "reviewer-correctness",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: EXPLORE_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "ls", "find", "grep", "report_finding", "task"],
    },
  ],
  [
    "reviewer-security", {
      id: "reviewer-security",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: EXPLORE_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "ls", "find", "grep", "report_finding", "task"],
    },
  ],
  [
    "reviewer-tests", {
      id: "reviewer-tests",
      writes: false,
      executes: false,
      contextModes: READ_ONLY,
      mayDelegate: EXPLORE_DELEGATION,
      modelRoutable: true,
      requiredTools: ["read", "ls", "find", "grep", "report_finding", "task"],
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
