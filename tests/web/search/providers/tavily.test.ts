import { afterEach, describe, expect, it, vi } from "vitest";
import { TavilyProvider } from "../../../../src/web/search/providers/tavily";

describe("TavilyProvider", () => {
  const originalEnv = process.env.TAVILY_API_KEY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("reports unavailable when key is missing", () => {
    delete process.env.TAVILY_API_KEY;
    expect(new TavilyProvider().isAvailable()).toBe(false);
  });

  it("reports available when key is set", () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    expect(new TavilyProvider().isAvailable()).toBe(true);
  });

  it("has correct id and label", () => {
    const p = new TavilyProvider();
    expect(p.id).toBe("tavily");
    expect(p.label).toBe("Tavily");
  });

  it("calls Tavily API, returns answer and sources", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: "The answer is 42",
        results: [{ title: "T1", url: "https://t.com", content: "snippet text", published_date: "2024-03-01" }],
      }),
    }) as unknown as typeof fetch;

    const result = await new TavilyProvider().search({ query: "meaning of life" });
    expect(result.provider).toBe("tavily");
    expect(result.answer).toBe("The answer is 42");
    expect(result.sources[0]?.title).toBe("T1");
    expect(result.sources[0]?.snippet).toBe("snippet text");
  });

  it("throws on HTTP error", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => "Forbidden",
    }) as unknown as typeof fetch;
    await expect(new TavilyProvider().search({ query: "x" })).rejects.toThrow("Forbidden");
  });
});
