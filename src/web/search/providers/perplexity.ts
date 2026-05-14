import { SearchProvider, SearchProviderError } from "./base";
import type { SearchParams, SearchResponse, SearchSource } from "../types";

interface PerplexityApiResponse {
  choices: Array<{ message: { content: string } }>;
  citations?: string[];
}

const RECENCY_MAP: Record<string, string> = {
  day: "day", week: "week", month: "month", year: "year",
};

export class PerplexityProvider extends SearchProvider {
  readonly id = "perplexity" as const;
  readonly label = "Perplexity";

  isAvailable(): boolean {
    return !!process.env.PERPLEXITY_API_KEY;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const key = process.env.PERPLEXITY_API_KEY;
    if (!key) throw new SearchProviderError("perplexity", "PERPLEXITY_API_KEY is not set");

    const body: Record<string, unknown> = {
      model: "sonar",
      messages: [{ role: "user", content: params.query }],
      return_citations: true,
      return_images: false,
    };
    if (params.recency) body.search_recency_filter = RECENCY_MAP[params.recency];
    if (params.includeDomains?.length) body.search_domain_filter = params.includeDomains;

    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new SearchProviderError("perplexity", text, res.status);
    }

    const data = await res.json() as PerplexityApiResponse;
    const answer = data.choices[0]?.message.content;
    const citations = data.citations ?? [];

    const sources: SearchSource[] = citations.map((url) => ({ title: url, url }));

    return { provider: "perplexity", answer, sources };
  }
}
