import { SEARCH_PROVIDER_ORDER, isSearchProviderId, type SearchProviderId, type SearchProviderPreference } from "./types";
import type { SearchProvider } from "./providers/base";

interface ProviderMeta {
  id: SearchProviderId;
  label: string;
  load: () => Promise<SearchProvider>;
}

const PROVIDER_META: ProviderMeta[] = [
  { id: "exa",        label: "Exa",          load: async () => new (await import("./providers/exa")).ExaProvider() },
  { id: "brave",      label: "Brave Search",  load: async () => new (await import("./providers/brave")).BraveProvider() },
  { id: "tavily",     label: "Tavily",        load: async () => new (await import("./providers/tavily")).TavilyProvider() },
  { id: "perplexity", label: "Perplexity",    load: async () => new (await import("./providers/perplexity")).PerplexityProvider() },
  { id: "gemini",     label: "Gemini",        load: async () => new (await import("./providers/gemini")).GeminiProvider() },
];

const cache = new Map<SearchProviderId, SearchProvider>();

export async function getSearchProvider(id: SearchProviderId): Promise<SearchProvider> {
  const cached = cache.get(id);
  if (cached) return cached;

  const meta = PROVIDER_META.find((m) => m.id === id);
  if (!meta) throw new Error(`Unknown search provider: ${id}`);

  const provider = await meta.load();
  cache.set(id, provider);
  return provider;
}

export async function resolveProviderChain(
  preference?: SearchProviderPreference,
): Promise<SearchProvider[]> {
  const chain: SearchProvider[] = [];
  const seen = new Set<SearchProviderId>();

  if (preference && preference !== "auto" && isSearchProviderId(preference)) {
    const p = await getSearchProvider(preference);
    if (await p.isAvailable()) {
      chain.push(p);
      seen.add(preference);
    }
  }

  for (const id of SEARCH_PROVIDER_ORDER) {
    if (seen.has(id)) continue;
    const p = await getSearchProvider(id);
    if (await p.isAvailable()) {
      chain.push(p);
      seen.add(id);
    }
  }

  return chain;
}
