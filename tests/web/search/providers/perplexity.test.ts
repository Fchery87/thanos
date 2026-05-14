import { afterEach, describe, expect, it, vi } from "vitest";
import { PerplexityProvider } from "../../../../src/web/search/providers/perplexity";

describe("PerplexityProvider", () => {
  const originalEnv = process.env.PERPLEXITY_API_KEY;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = originalEnv;
    vi.unstubAllGlobals();
  });

  it("reports unavailable when key is missing", () => {
    delete process.env.PERPLEXITY_API_KEY;
    expect(new PerplexityProvider().isAvailable()).toBe(false);
  });

  it("reports available when key is set", () => {
    process.env.PERPLEXITY_API_KEY = "pplx-test";
    expect(new PerplexityProvider().isAvailable()).toBe(true);
  });

  it("has correct id and label", () => {
    const p = new PerplexityProvider();
    expect(p.id).toBe("perplexity");
    expect(p.label).toBe("Perplexity");
  });

  it("extracts answer and citations from chat response", async () => {
    process.env.PERPLEXITY_API_KEY = "pplx-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "The synthesized answer." } }],
        citations: ["https://a.com", "https://b.com"],
      }),
    }));

    const result = await new PerplexityProvider().search({ query: "what is 42" });
    expect(result.provider).toBe("perplexity");
    expect(result.answer).toBe("The synthesized answer.");
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]?.url).toBe("https://a.com");
  });

  it("throws on HTTP error", async () => {
    process.env.PERPLEXITY_API_KEY = "pplx-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => "Invalid key",
    }));
    await expect(new PerplexityProvider().search({ query: "x" })).rejects.toThrow("Invalid key");
  });
});
