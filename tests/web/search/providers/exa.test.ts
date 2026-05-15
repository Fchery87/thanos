import { afterEach, describe, expect, it, vi } from "vitest";
import { ExaProvider } from "../../../../src/web/search/providers/exa";

describe("ExaProvider", () => {
  const originalEnv = process.env.EXA_API_KEY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("reports unavailable when EXA_API_KEY is not set", async () => {
    delete process.env.EXA_API_KEY;
    const p = new ExaProvider();
    expect(await p.isAvailable()).toBe(false);
  });

  it("reports available when EXA_API_KEY is set", async () => {
    process.env.EXA_API_KEY = "test-key";
    const p = new ExaProvider();
    expect(await p.isAvailable()).toBe(true);
  });

  it("has correct id and label", () => {
    const p = new ExaProvider();
    expect(p.id).toBe("exa");
    expect(p.label).toBe("Exa");
  });

  it("calls Exa API and normalizes response", async () => {
    process.env.EXA_API_KEY = "test-key";
    const mockResponse = {
      results: [
        {
          title: "Test Title",
          url: "https://example.com",
          author: "Alice",
          publishedDate: "2024-01-01",
          summary: "A great summary",
        },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as unknown as typeof fetch;

    const p = new ExaProvider();
    const result = await p.search({ query: "test query", count: 5 });

    expect(result.provider).toBe("exa");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.title).toBe("Test Title");
    expect(result.sources[0]?.url).toBe("https://example.com");
    expect(result.sources[0]?.snippet).toBe("A great summary");
    expect(result.answer).toContain("Test Title");
  });

  it("throws SearchProviderError on HTTP failure", async () => {
    process.env.EXA_API_KEY = "test-key";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }) as unknown as typeof fetch;

    const p = new ExaProvider();
    await expect(p.search({ query: "test" })).rejects.toThrow("Unauthorized");
  });
});
