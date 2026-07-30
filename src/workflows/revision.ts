import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { snapshotWorkingTree } from "../spec/diff-evidence";
import type { RepositoryRevisionIdentity } from "./state";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

async function repositoryHead(repoDir: string): Promise<string | undefined> {
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

export async function captureRepositoryRevisionIdentity(
  repoDir: string,
): Promise<RepositoryRevisionIdentity | undefined> {
  const [head, workingTree] = await Promise.all([
    repositoryHead(repoDir),
    snapshotWorkingTree(repoDir),
  ]);
  if (!head || !workingTree) return undefined;
  return {
    head,
    workingTree: [...workingTree.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

export function sameRepositoryRevision(
  left: RepositoryRevisionIdentity | undefined,
  right: RepositoryRevisionIdentity | undefined,
): boolean {
  if (!left || !right || left.head !== right.head || left.workingTree.length !== right.workingTree.length) {
    return false;
  }
  return left.workingTree.every(([path, identity], index) => {
    const candidate = right.workingTree[index];
    return candidate?.[0] === path && candidate[1] === identity;
  });
}
