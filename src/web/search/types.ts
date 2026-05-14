export type SearchProviderId = "exa" | "brave" | "tavily" | "perplexity" | "gemini";

export type SearchProviderPreference = SearchProviderId | "auto";

export const SEARCH_PROVIDER_ORDER: SearchProviderId[] = [
  "exa", "brave", "tavily", "perplexity", "gemini",
];

export interface SearchParams {
  query: string;
  count?: number;
  recency?: "day" | "week" | "month" | "year";
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
  author?: string;
}

export interface SearchResponse {
  provider: SearchProviderId;
  answer?: string;
  sources: SearchSource[];
}

export function isSearchProviderId(value: unknown): value is SearchProviderId {
  return SEARCH_PROVIDER_ORDER.includes(value as SearchProviderId);
}

export function isSearchProviderPreference(value: unknown): value is SearchProviderPreference {
  return value === "auto" || isSearchProviderId(value);
}
