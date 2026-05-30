import { mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ArtifactRef } from "./result";

export async function writeArtifact(baseDir: string, name: string, content: string): Promise<ArtifactRef> {
  const safeName = basename(name).replace(/[^A-Za-z0-9._-]/g, "_") || "artifact";
  const artifactsDir = join(baseDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  const filePath = join(artifactsDir, safeName);
  await writeFile(filePath, content, "utf-8");
  return { name: safeName, path: filePath, bytes: Buffer.byteLength(content, "utf-8") };
}
