import { afterEach, describe, expect, it, vi } from "vitest";
import { BraveProvider } from "../../../../src/web/search/providers/brave";

describe("BraveProvider", () => {
  const originalEnv = process.env.BRAVE_API_KEY;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.BRAVE_API_KEY;
    else process.env.BRAVE_API_KEY = originalEnv;
    vi.unstubAllGlobals();
  });

  it("reports unavailable when BRAVE_API_KEY is not set", () => {
    delete process.env.BRAVE_API_KEY;
    expect(new BraveProvider().isAvailable()).toBe(false);
  });

  it("reports available when BRAVE_API_KEY is set", () => {
    process.env.BRAVE_API_KEY = "test-key";
    expect(new BraveProvider().isAvailable()).toBe(true);
  });

  it("has correct id and label", () => {
    const p = new BraveProvider();
    expect(p.id).toBe("brave");
    expect(p.label).toBe("Brave Search");
  });

  it("calls Brave API and normalizes response", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "Brave Result", url: "https://brave.com", description: "A brave snippet", age: "2d" },
          ],
        },
      }),
    }));

    const result = await new BraveProvider().search({ query: "brave test" });
    expect(result.provider).toBe("brave");
    expect(result.sources[0]?.title).toBe("Brave Result");
    expect(result.sources[0]?.snippet).toBe("A brave snippet");
    expect(result.answer).toBeUndefined();
  });

  it("throws on HTTP error", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 429, text: async () => "Rate limited",
    }));
    await expect(new BraveProvider().search({ query: "x" })).rejects.toThrow("Rate limited");
  });
});
