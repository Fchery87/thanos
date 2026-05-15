import type { SearchProvider } from "./providers/base";
import { isSearchProviderId, type SearchProviderId, type SearchProviderPreference } from "./types";

export interface SearchProviderMetadata {
  id: SearchProviderId;
  label: string;
  load: () => Promise<SearchProvider>;
}

const DEFAULT_PROVIDER_METADATA: readonly SearchProviderMetadata[] = [
  { id: "exa", label: "Exa", load: async () => new (await import("./providers/exa")).ExaProvider() },
  { id: "brave", label: "Brave Search", load: async () => new (await import("./providers/brave")).BraveProvider() },
  { id: "tavily", label: "Tavily", load: async () => new (await import("./providers/tavily")).TavilyProvider() },
  { id: "perplexity", label: "Perplexity", load: async () => new (await import("./providers/perplexity")).PerplexityProvider() },
  { id: "gemini", label: "Gemini", load: async () => new (await import("./providers/gemini")).GeminiProvider() },
] as const;

export class SearchProviderRegistry {
  private readonly cache = new Map<SearchProviderId, Promise<SearchProvider>>();
  private readonly metadataById: Map<SearchProviderId, SearchProviderMetadata>;

  constructor(private readonly metadata: readonly SearchProviderMetadata[] = DEFAULT_PROVIDER_METADATA) {
    this.metadataById = new Map(metadata.map((provider) => [provider.id, provider]));
  }

  getSearchProvider(id: string): Promise<SearchProvider> {
    if (!isSearchProviderId(id)) return Promise.reject(new Error(`Unknown search provider: ${id}`));

    const cached = this.cache.get(id);
    if (cached) return cached;

    const provider = this.metadataById.get(id);
    if (!provider) return Promise.reject(new Error(`Unknown search provider: ${id}`));

    const loaded = provider.load();
    this.cache.set(id, loaded);
    return loaded;
  }

  async resolveProviderChain(preference?: SearchProviderPreference): Promise<SearchProvider[]> {
    const chain: SearchProvider[] = [];
    const seen = new Set<SearchProviderId>();

    if (preference && preference !== "auto") {
      const preferred = await this.tryGetSearchProvider(preference);
      if (preferred && await preferred.isAvailable()) {
        chain.push(preferred);
        seen.add(preference);
      }
    }

    for (const { id } of this.metadata) {
      if (seen.has(id)) continue;

      const provider = await this.getSearchProvider(id);
      if (await provider.isAvailable()) {
        chain.push(provider);
        seen.add(id);
      }
    }

    return chain;
  }

  private async tryGetSearchProvider(id: SearchProviderId): Promise<SearchProvider | undefined> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const provider = this.metadataById.get(id);
    if (!provider) return undefined;

    const loaded = provider.load();
    this.cache.set(id, loaded);
    return loaded;
  }
}

export const defaultSearchProviderRegistry = new SearchProviderRegistry();

export function getSearchProvider(id: string): Promise<SearchProvider> {
  return defaultSearchProviderRegistry.getSearchProvider(id);
}

export function resolveProviderChain(preference?: SearchProviderPreference): Promise<SearchProvider[]> {
  return defaultSearchProviderRegistry.resolveProviderChain(preference);
}
