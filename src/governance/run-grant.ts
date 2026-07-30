import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { Capability } from "../permissions/rules";
import { snapshotWorkingTree, type WorkingTreeSnapshot } from "../spec/diff-evidence";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

export interface RunGrant {
  readonly runId: string;
  readonly contractRevision: string;
  readonly capabilities: readonly Capability[];
  readonly repoRoot: string;
  readonly targetRoots: readonly string[];
  readonly head: string;
  readonly baseline: WorkingTreeSnapshot;
}

export interface RunGrantDecision {
  allowed: boolean;
  reason?: string;
}

interface IssueRunGrantInput {
  repoDir: string;
  runId: string;
  contractRevision: string;
  capabilities: Capability[];
  targetRoots: string[];
}

interface AuthorizeRunGrantInput {
  repoDir: string;
  contractRevision: string;
  capability: Capability;
  target: string;
}

async function gitHead(repoDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "rev-parse", "HEAD"], {
      timeout: GIT_TIMEOUT_MS,
    });
    const head = stdout.trim();
    return head.length > 0 ? head : undefined;
  } catch {
    return undefined;
  }
}

function containedBy(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolve an existing path through every symlink. For a path that does not yet
 * exist, resolve its nearest existing parent and append the remaining segments.
 */
async function canonicalPath(path: string): Promise<string | undefined> {
  let cursor = resolve(path);
  const tail: string[] = [];

  for (;;) {
    try {
      const parent = await realpath(cursor);
      return resolve(parent, ...tail.reverse());
    } catch {
      const next = dirname(cursor);
      if (next === cursor) return undefined;
      tail.push(cursor.slice(next.length + (next.endsWith("/") ? 0 : 1)));
      cursor = next;
    }
  }
}

async function canonicalRepoTarget(repoRoot: string, target: string): Promise<string | undefined> {
  const lexical = resolve(repoRoot, target);
  if (!containedBy(repoRoot, lexical)) return undefined;
  return canonicalPath(lexical);
}

function changedPaths(
  baseline: WorkingTreeSnapshot,
  current: WorkingTreeSnapshot,
): string[] {
  const paths = new Set([...baseline.keys(), ...current.keys()]);
  return [...paths].filter((path) => baseline.get(path) !== current.get(path));
}

export async function issueRunGrant(input: IssueRunGrantInput): Promise<RunGrant | undefined> {
  const repoRoot = await realpath(input.repoDir).catch(() => undefined);
  if (!repoRoot) return undefined;
  const head = await gitHead(repoRoot);
  const baseline = await snapshotWorkingTree(repoRoot);
  if (!head || !baseline) return undefined;

  const roots: string[] = [];
  for (const target of input.targetRoots) {
    const canonical = await canonicalRepoTarget(repoRoot, target);
    if (!canonical || !containedBy(repoRoot, canonical)) return undefined;
    roots.push(canonical);
  }
  if (roots.length === 0) return undefined;

  return Object.freeze({
    runId: input.runId,
    contractRevision: input.contractRevision,
    capabilities: Object.freeze([...new Set(input.capabilities)]),
    repoRoot,
    targetRoots: Object.freeze([...new Set(roots)]),
    head,
    baseline: new Map(baseline),
  });
}

export async function authorizeRunGrant(
  grant: RunGrant | undefined,
  input: AuthorizeRunGrantInput,
): Promise<RunGrantDecision> {
  if (!grant) return { allowed: false, reason: "no process-local Run Grant" };
  if (input.contractRevision !== grant.contractRevision) {
    return { allowed: false, reason: "Work Contract revision changed" };
  }
  if (!grant.capabilities.includes(input.capability)) {
    return { allowed: false, reason: `capability ${input.capability} is outside the Run Grant` };
  }

  const repoRoot = await realpath(input.repoDir).catch(() => undefined);
  if (!repoRoot || repoRoot !== grant.repoRoot) {
    return { allowed: false, reason: "repository identity changed" };
  }
  if (await gitHead(repoRoot) !== grant.head) {
    return { allowed: false, reason: "repository HEAD drifted from the approved baseline" };
  }

  const target = await canonicalRepoTarget(repoRoot, input.target);
  if (!target || !grant.targetRoots.some((root) => containedBy(root, target))) {
    return { allowed: false, reason: "target escapes the approved canonical roots" };
  }

  const current = await snapshotWorkingTree(repoRoot);
  if (!current) return { allowed: false, reason: "repository baseline cannot be verified" };
  for (const path of changedPaths(grant.baseline, current)) {
    const changed = await canonicalRepoTarget(repoRoot, path);
    if (!changed || !grant.targetRoots.some((root) => containedBy(root, changed))) {
      return { allowed: false, reason: `repository drift outside approved roots: ${path}` };
    }
  }

  return { allowed: true };
}
