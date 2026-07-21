import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("shipped subagent prompts", () => {
  it("declare the version 1 result contract", () => {
    const dir = join(process.cwd(), "agent", "agents");
    const files = readdirSync(dir).filter((file) => file.endsWith(".md"));

    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf-8");
      expect(text, `${file} should mention the Subagent Result Contract`).toContain("Subagent Result Contract");
      expect(text, `${file} should name contract version 1`).toContain("Contract version 1");
      expect(text, `${file} should include a definition of done before the contract`).toMatch(/Definition of done[\s\S]*Return the Subagent Result Contract/);
      expect(text, `${file} should include a minimal version 1 example`).toMatch(/Minimal valid example:[\s\S]*"version": 1/);
    }
  });
});
