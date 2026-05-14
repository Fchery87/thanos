import { SearchProvider, SearchProviderError } from "./base";
import type { SearchParams, SearchResponse, SearchSource } from "../types";

interface TavilyResult {
  title: string;
  url: string;
  content?: string;
  published_date?: string;
}

interface TavilyApiResponse {
  answer?: string;
  results: TavilyResult[];
}

const RECENCY_DAYS: Record<string, number> = {
  day: 1, week: 7, month: 30, year: 365,
};

export class TavilyProvider extends SearchProvider {
  readonly id = "tavily" as const;
  readonly label = "Tavily";

  isAvailable(): boolean {
    return !!process.env.TAVILY_API_KEY;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const key = process.env.TAVILY_API_KEY;
    if (!key) throw new SearchProviderError("tavily", "TAVILY_API_KEY is not set");

    const body: Record<string, unknown> = {
      api_key: key,
      query: params.query,
      max_results: params.count ?? 10,
      include_answer: true,
    };
    if (params.recency) body.days = RECENCY_DAYS[params.recency];
    if (params.includeDomains?.length) body.include_domains = params.includeDomains;
    if (params.excludeDomains?.length) body.exclude_domains = params.excludeDomains;

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new SearchProviderError("tavily", text, res.status);
    }

    const data = await res.json() as TavilyApiResponse;
    const count = params.count ?? 10;
    const results = (data.results ?? []).slice(0, count);

    const sources: SearchSource[] = results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      publishedDate: r.published_date,
    }));

    return { provider: "tavily", answer: data.answer, sources };
  }
}
