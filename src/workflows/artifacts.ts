import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkflowEvidenceRef } from "./state";

export type ArtifactVerification =
  | { state: "verified"; path: string; sha256: string; bytes: number }
  | { state: "invalid"; path: string; reason: string };

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

function contained(repoDir: string, candidate: string): boolean {
  const rel = relative(repoDir, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export async function verifyArtifact(
  repoDir: string,
  artifact: { path: string; sha256: string },
): Promise<ArtifactVerification> {
  const repo = await realpath(repoDir).catch(() => undefined);
  if (!repo) return { state: "invalid", path: artifact.path, reason: "repository directory is unavailable" };
  const candidate = resolve(repo, artifact.path);
  if (!contained(repo, candidate)) {
    return { state: "invalid", path: artifact.path, reason: "artifact escapes repository" };
  }
  const directStats = await lstat(candidate).catch(() => undefined);
  if (directStats?.isSymbolicLink()) {
    return { state: "invalid", path: artifact.path, reason: "artifact path is a symlink" };
  }
  const canonical = await realpath(candidate).catch(() => undefined);
  if (!canonical || !contained(repo, canonical) || canonical !== candidate) {
    return { state: "invalid", path: artifact.path, reason: "artifact is missing or escapes repository through a symlink" };
  }
  const stats = await lstat(canonical).catch(() => undefined);
  if (!stats?.isFile()) return { state: "invalid", path: artifact.path, reason: "artifact is not a regular file" };
  if (stats.size > MAX_ARTIFACT_BYTES) {
    return { state: "invalid", path: artifact.path, reason: `artifact exceeds ${MAX_ARTIFACT_BYTES} byte limit` };
  }
  const contents = await readFile(canonical).catch(() => undefined);
  if (!contents) return { state: "invalid", path: artifact.path, reason: "artifact is unreadable" };
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (sha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
    return { state: "invalid", path: artifact.path, reason: "artifact SHA-256 does not match its receipt" };
  }
  return { state: "verified", path: artifact.path, sha256, bytes: contents.byteLength };
}

export async function verifyEvidenceArtifacts(
  repoDir: string,
  references: readonly WorkflowEvidenceRef[],
): Promise<{ valid: boolean; results: ArtifactVerification[]; reasons: string[] }> {
  const results = (await Promise.all(references.flatMap((reference) =>
    reference.artifacts.map((artifact) => verifyArtifact(repoDir, artifact)))));
  const invalid = results.filter((result): result is Extract<ArtifactVerification, { state: "invalid" }> => result.state === "invalid");
  return {
    valid: invalid.length === 0,
    results,
    reasons: invalid.map((result) => `${result.path}: ${result.reason}`),
  };
}
