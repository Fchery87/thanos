import { afterEach, describe, expect, it, vi } from "vitest";
import { executeSearch } from "../../../src/web/search/index";
import { SearchProviderRegistry } from "../../../src/web/search/provider";
import type { SearchProvider } from "../../../src/web/search/providers/base";
import type { SearchProviderId, SearchResponse } from "../../../src/web/search/types";

function makeMockProvider(id: SearchProviderId, result: SearchResponse, available = true): SearchProvider {
  return {
    id,
    label: id,
    isAvailable: vi.fn().mockResolvedValue(available),
    search: vi.fn().mockResolvedValue(result),
  } as unknown as SearchProvider;
}

describe("executeSearch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns result from first available provider", async () => {
    const mockResult: SearchResponse = { provider: "exa", sources: [{ title: "T", url: "https://x.com" }] };
    const mockProvider = makeMockProvider("exa", mockResult);
    const registry = new SearchProviderRegistry([
      { id: "exa", label: "Exa", load: vi.fn(async () => mockProvider) },
    ]);

    const result = await executeSearch({ query: "hello" }, undefined, registry);
    expect(result.provider).toBe("exa");
    expect(result.sources).toHaveLength(1);
  });

  it("falls back to the next provider when the first throws", async () => {
    const failingProvider = makeMockProvider("exa", { provider: "exa", sources: [] });
    (failingProvider.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("exa down"));

    const successResult: SearchResponse = { provider: "brave", sources: [{ title: "B", url: "https://b.com" }] };
    const successProvider = makeMockProvider("brave", successResult);
    const registry = new SearchProviderRegistry([
      { id: "exa", label: "Exa", load: vi.fn(async () => failingProvider) },
      { id: "brave", label: "Brave", load: vi.fn(async () => successProvider) },
    ]);

    const result = await executeSearch({ query: "fallback test" }, undefined, registry);
    expect(result.provider).toBe("brave");
  });

  it("throws with combined error message when all providers fail", async () => {
    const p1 = makeMockProvider("exa", { provider: "exa", sources: [] });
    const p2 = makeMockProvider("brave", { provider: "brave", sources: [] });
    (p1.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("exa error"));
    (p2.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("brave error"));

    const registry = new SearchProviderRegistry([
      { id: "exa", label: "Exa", load: vi.fn(async () => p1) },
      { id: "brave", label: "Brave", load: vi.fn(async () => p2) },
    ]);

    await expect(executeSearch({ query: "fail" }, undefined, registry)).rejects.toThrow(
      /All web search providers failed[\s\S]*exa[\s\S]*brave/,
    );
  });

  it("throws with no-providers message when chain is empty", async () => {
    const unavailableProvider = makeMockProvider("exa", { provider: "exa", sources: [] }, false);
    const registry = new SearchProviderRegistry([
      { id: "exa", label: "Exa", load: vi.fn(async () => unavailableProvider) },
    ]);

    await expect(executeSearch({ query: "empty" }, undefined, registry)).rejects.toThrow(
      "No web search providers available",
    );
  });
});
