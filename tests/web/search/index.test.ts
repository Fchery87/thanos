import { afterEach, describe, expect, it, vi } from "vitest";
import { executeSearch } from "../../../src/web/search/index";
import * as providerModule from "../../../src/web/search/provider";
import type { SearchProvider } from "../../../src/web/search/providers/base";
import type { SearchResponse } from "../../../src/web/search/types";

function makeMockProvider(id: string, result: SearchResponse, available = true): SearchProvider {
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
    vi.spyOn(providerModule, "resolveProviderChain").mockResolvedValue([mockProvider]);

    const result = await executeSearch({ query: "hello" });
    expect(result.provider).toBe("exa");
    expect(result.sources).toHaveLength(1);
  });

  it("falls back to second provider when first throws", async () => {
    const failingProvider = makeMockProvider("exa", { provider: "exa", sources: [] });
    (failingProvider.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("exa down"));
    const successResult: SearchResponse = { provider: "brave", sources: [{ title: "B", url: "https://b.com" }] };
    const successProvider = makeMockProvider("brave", successResult);

    vi.spyOn(providerModule, "resolveProviderChain").mockResolvedValue([failingProvider, successProvider]);

    const result = await executeSearch({ query: "fallback test" });
    expect(result.provider).toBe("brave");
  });

  it("throws with combined error message when all providers fail", async () => {
    const p1 = makeMockProvider("exa", { provider: "exa", sources: [] });
    const p2 = makeMockProvider("brave", { provider: "brave", sources: [] });
    (p1.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("exa error"));
    (p2.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("brave error"));

    vi.spyOn(providerModule, "resolveProviderChain").mockResolvedValue([p1, p2]);

    await expect(executeSearch({ query: "fail" })).rejects.toThrow(
      /All web search providers failed[\s\S]*exa[\s\S]*brave/,
    );
  });

  it("throws with no-providers message when chain is empty", async () => {
    vi.spyOn(providerModule, "resolveProviderChain").mockResolvedValue([]);
    await expect(executeSearch({ query: "empty" })).rejects.toThrow("No web search providers available");
  });
});
