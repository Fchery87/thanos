import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArtifact } from "../../src/agents/artifacts";

let dir: string | undefined;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe("writeArtifact", () => {
  it("writes content to the artifacts dir and returns a ref with byte size", async () => {
    dir = await mkdtemp(join(tmpdir(), "thanos-artifacts-"));
    const content = "# Report\nsome long output";
    const ref = await writeArtifact(dir, "report.md", content);

    expect(ref.name).toBe("report.md");
    expect(ref.bytes).toBe(Buffer.byteLength(content, "utf-8"));
    expect(ref.path).toContain("artifacts");
    expect(await readFile(ref.path, "utf-8")).toBe(content);
  });

  it("sanitizes unsafe names to a flat file", async () => {
    dir = await mkdtemp(join(tmpdir(), "thanos-artifacts-"));
    const ref = await writeArtifact(dir, "../../etc/passwd", "x");
    expect(ref.path).not.toContain("..");
  });

  it("rejects pure-dot names that would escape the artifacts dir", async () => {
    dir = await mkdtemp(join(tmpdir(), "thanos-artifacts-"));
    const dotdot = await writeArtifact(dir, "..", "x");
    const dot = await writeArtifact(dir, ".", "x");
    // Both must resolve to a real file strictly inside <dir>/artifacts/, not the dir itself or its parent.
    for (const ref of [dotdot, dot]) {
      expect(await readFile(ref.path, "utf-8")).toBe("x");
      const artifactsRoot = join(dir, "artifacts");
      expect(ref.path.startsWith(artifactsRoot + "/")).toBe(true);
      expect(ref.name).not.toBe("..");
      expect(ref.name).not.toBe(".");
    }
  });

  it("uses the fallback name for empty input", async () => {
    dir = await mkdtemp(join(tmpdir(), "thanos-artifacts-"));
    const ref = await writeArtifact(dir, "", "x");
    expect(ref.name).toBe("artifact");
    expect(await readFile(ref.path, "utf-8")).toBe("x");
  });
});
