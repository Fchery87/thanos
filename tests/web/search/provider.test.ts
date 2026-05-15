import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSearchProvider, resolveProviderChain, SearchProviderRegistry } from "../../../src/web/search/provider";
import type { SearchProvider } from "../../../src/web/search/providers/base";
import { SEARCH_PROVIDER_ORDER, type SearchProviderId } from "../../../src/web/search/types";

function makeProvider(id: SearchProviderId, available = true): SearchProvider {
  return {
    id,
    label: id,
    isAvailable: vi.fn().mockResolvedValue(available),
    search: vi.fn().mockResolvedValue({ provider: id, sources: [] }),
  } as unknown as SearchProvider;
}

function makeRegistry(entries: Array<{ id: SearchProviderId; provider: SearchProvider }>): SearchProviderRegistry {
  return new SearchProviderRegistry(
    entries.map(({ id, provider }) => ({
      id,
      label: provider.label,
      load: vi.fn(async () => provider),
    })),
  );
}

const API_KEYS = ["EXA_API_KEY", "BRAVE_API_KEY", "TAVILY_API_KEY", "PERPLEXITY_API_KEY", "GEMINI_API_KEY"] as const;

describe("SearchProviderRegistry", () => {
  it("resolves providers in registry order", async () => {
    const registry = makeRegistry(SEARCH_PROVIDER_ORDER.map((id) => ({ id, provider: makeProvider(id, true) })));

    const chain = await registry.resolveProviderChain();
    expect(chain.map((provider) => provider.id)).toEqual(SEARCH_PROVIDER_ORDER);
  });

  it("keeps the preferred provider first without duplicating it", async () => {
    const registry = makeRegistry(SEARCH_PROVIDER_ORDER.map((id) => ({ id, provider: makeProvider(id, true) })));

    const chain = await registry.resolveProviderChain("tavily");
    expect(chain.map((provider) => provider.id)).toEqual([
      "tavily",
      ...SEARCH_PROVIDER_ORDER.filter((id) => id !== "tavily"),
    ]);
  });

  it("skips an unavailable preferred provider and continues with the rest", async () => {
    const registry = makeRegistry(SEARCH_PROVIDER_ORDER.map((id) => ({ id, provider: makeProvider(id, id !== "brave") })));

    const chain = await registry.resolveProviderChain("brave");
    expect(chain.map((provider) => provider.id)).toEqual(SEARCH_PROVIDER_ORDER.filter((id) => id !== "brave"));
  });

  it("keeps cache isolated between registry instances", async () => {
    const providerA = makeProvider("exa");
    const loadA = vi.fn(async () => providerA);
    const registryA = new SearchProviderRegistry([{ id: "exa", label: "Exa A", load: loadA }]);

    const providerB = makeProvider("exa");
    const loadB = vi.fn(async () => providerB);
    const registryB = new SearchProviderRegistry([{ id: "exa", label: "Exa B", load: loadB }]);

    const [firstA, secondA] = await Promise.all([
      registryA.getSearchProvider("exa"),
      registryA.getSearchProvider("exa"),
    ]);
    expect(firstA).toBe(providerA);
    expect(secondA).toBe(providerA);
    expect(loadA).toHaveBeenCalledTimes(1);

    const firstB = await registryB.getSearchProvider("exa");
    expect(firstB).toBe(providerB);
    expect(loadB).toHaveBeenCalledTimes(1);
  });
});

describe("default registry helpers", () => {
  beforeEach(() => {
    for (const key of API_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of API_KEYS) {
      delete process.env[key];
    }
  });

  it("throws for unknown provider id", async () => {
    await expect(getSearchProvider("unknown")).rejects.toThrow("Unknown search provider");
  });

  it("returns an ExaProvider for 'exa'", async () => {
    const provider = await getSearchProvider("exa");
    expect(provider.id).toBe("exa");
    expect(provider.label).toBe("Exa");
  });

  it("returns an empty chain when no providers are available", async () => {
    const chain = await resolveProviderChain();
    expect(chain).toHaveLength(0);
  });
});
