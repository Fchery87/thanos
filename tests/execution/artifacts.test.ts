import { describe, expect, it } from "vitest";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyArtifact } from "../../src/workflows/artifacts";

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), "artifact-test-"));
  const file = join(repo, "evidence.txt");
  const content = "verified evidence";
  await writeFile(file, content);
  return { repo, file, sha256: createHash("sha256").update(content).digest("hex") };
}

describe("workflow artifact verification", () => {
  it("verifies contained files by full SHA-256", async () => {
    const { repo, sha256 } = await fixture();
    await expect(verifyArtifact(repo, { path: "evidence.txt", sha256 })).resolves.toMatchObject({ state: "verified", bytes: 17 });
  });

  it("rejects traversal, missing, and mismatched artifacts", async () => {
    const { repo, sha256 } = await fixture();
    await expect(verifyArtifact(repo, { path: "../evidence.txt", sha256 })).resolves.toMatchObject({ state: "invalid" });
    await expect(verifyArtifact(repo, { path: "missing.txt", sha256 })).resolves.toMatchObject({ state: "invalid" });
    await expect(verifyArtifact(repo, { path: "evidence.txt", sha256: "0".repeat(64) })).resolves.toMatchObject({ state: "invalid" });
  });

  it("rejects symlink escape", async () => {
    const { repo, file, sha256 } = await fixture();
    await symlink(file, join(repo, "link.txt"));
    await expect(verifyArtifact(repo, { path: "link.txt", sha256 })).resolves.toMatchObject({ state: "invalid" });
  });
});
