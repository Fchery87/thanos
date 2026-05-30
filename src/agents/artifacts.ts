import { mkdir, writeFile } from "node:fs/promises";
import { join, basename, resolve, sep } from "node:path";
import type { ArtifactRef } from "./result";

export async function writeArtifact(baseDir: string, name: string, content: string): Promise<ArtifactRef> {
  const stripped = basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
  // Pure-dot names (".", "..") and empty input would escape or self-reference
  // the artifacts dir; collapse them to a safe fallback.
  const safeName = stripped === "" || /^\.+$/.test(stripped) ? "artifact" : stripped;
  const artifactsDir = join(baseDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  const filePath = join(artifactsDir, safeName);
  // Defensive: never allow the resolved path to escape the artifacts dir.
  const root = resolve(artifactsDir);
  if (!resolve(filePath).startsWith(root + sep)) {
    throw new Error(`artifact name escapes artifacts directory: ${name}`);
  }
  await writeFile(filePath, content, "utf-8");
  return { name: safeName, path: filePath, bytes: Buffer.byteLength(content, "utf-8") };
}
