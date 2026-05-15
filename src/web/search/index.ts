import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultSearchProviderRegistry, type SearchProviderRegistry } from "./provider";
import { SearchProviderError } from "./providers/base";
import type { SearchParams, SearchProviderPreference, SearchResponse } from "./types";
import { isSearchProviderPreference } from "./types";

export async function executeSearch(
  params: SearchParams,
  preference?: SearchProviderPreference,
  registry: SearchProviderRegistry = defaultSearchProviderRegistry,
): Promise<SearchResponse> {
  const chain = await registry.resolveProviderChain(preference);

  if (chain.length === 0) {
    throw new Error(
      "No web search providers available. Set at least one of: EXA_API_KEY, BRAVE_API_KEY, TAVILY_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY",
    );
  }

  const errors: string[] = [];
  for (const provider of chain) {
    try {
      return await provider.search(params);
    } catch (err) {
      const detail = err instanceof SearchProviderError && err.status != null
        ? `${provider.id} [${err.status}]: ${err.message}`
        : `${provider.id}: ${String(err)}`;
      errors.push(detail);
    }
  }

  throw new Error(`All web search providers failed:\n${errors.join("\n")}`);
}

const WEB_SEARCH_PARAMS = {
  type: "object",
  properties: {
    query: { type: "string", description: "The search query." },
    provider: {
      type: "string",
      enum: ["auto", "exa", "brave", "tavily", "perplexity", "gemini"],
      description: "Which provider to use. Defaults to 'auto' (fallback chain).",
    },
    count: { type: "number", description: "Number of results to return (default 10)." },
    recency: {
      type: "string",
      enum: ["day", "week", "month", "year"],
      description: "Filter results by recency.",
    },
    includeDomains: { type: "array", items: { type: "string" }, description: "Only include these domains." },
    excludeDomains: { type: "array", items: { type: "string" }, description: "Exclude these domains." },
  },
  required: ["query"],
} as const;

type WebSearchInput = {
  query: string;
  provider?: string;
  count?: number;
  recency?: "day" | "week" | "month" | "year";
  includeDomains?: string[];
  excludeDomains?: string[];
};

function formatSearchResponse(response: SearchResponse): string {
  const lines: string[] = [];

  if (response.answer) {
    lines.push(`**Answer (${response.provider}):**\n${response.answer}\n`);
  }

  if (response.sources.length > 0) {
    lines.push(`**Sources:**`);
    for (const src of response.sources) {
      const meta = [src.publishedDate, src.author].filter(Boolean).join(", ");
      lines.push(`- [${src.title}](${src.url})${meta ? `  _(${meta})_` : ""}`);
      if (src.snippet) lines.push(`  ${src.snippet}`);
    }
  }

  if (lines.length === 0) lines.push("No results found.");
  return lines.join("\n");
}

export function registerSearchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information. Supports multiple providers with automatic fallback. " +
      "Returns synthesized answers (when available) plus source links.",
    parameters: WEB_SEARCH_PARAMS,
    async execute(_toolCallId, input: WebSearchInput) {
      const preference = isSearchProviderPreference(input.provider) ? input.provider : "auto";
      const params: SearchParams = {
        query: input.query,
        count: input.count,
        recency: input.recency,
        includeDomains: input.includeDomains,
        excludeDomains: input.excludeDomains,
      };

      const response = await executeSearch(params, preference);
      const text = formatSearchResponse(response);
      return { content: [{ type: "text" as const, text }], details: undefined };
    },
  });
}
