import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("prompt budget baseline", () => {
  it("has representative prompt fixtures", async () => {
    const text = await readFile(new URL("../fixtures/prompts/representative-requests.json", import.meta.url), "utf8");
    const cases = JSON.parse(text) as string[];
    expect(cases).toHaveLength(10);
  });

});
