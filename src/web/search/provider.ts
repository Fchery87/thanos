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

const cache = new Map<SearchProviderId, Promise<SearchProvider>>();

export function getSearchProvider(id: string): Promise<SearchProvider> {
  if (!isSearchProviderId(id)) return Promise.reject(new Error(`Unknown search provider: ${id}`));
  const hit = cache.get(id);
  if (hit) return hit;
  const meta = PROVIDER_META.find((m) => m.id === id)!;
  const p = meta.load();
  cache.set(id, p);
  return p;
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
