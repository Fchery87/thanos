import { SearchProvider, SearchProviderError } from "./base";
import type { SearchParams, SearchResponse, SearchSource } from "../types";

interface ExaResult {
  title: string;
  url: string;
  author?: string;
  publishedDate?: string;
  summary?: string;
  text?: string;
  highlights?: string[];
}

interface ExaApiResponse {
  results: ExaResult[];
  requestId?: string;
}

export class ExaProvider extends SearchProvider {
  readonly id = "exa" as const;
  readonly label = "Exa";

  isAvailable(): boolean {
    return !!process.env.EXA_API_KEY;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const key = process.env.EXA_API_KEY;
    if (!key) throw new SearchProviderError("exa", "EXA_API_KEY is not set");

    const body: Record<string, unknown> = {
      query: params.query,
      numResults: params.count ?? 10,
      type: "auto",
      contents: { summary: { query: params.query } },
    };
    if (params.includeDomains?.length) body.includeDomains = params.includeDomains;
    if (params.excludeDomains?.length) body.excludeDomains = params.excludeDomains;
    if (params.recency) {
      const map: Record<string, string> = { day: "1d", week: "1w", month: "1mo", year: "1y" };
      body.startPublishedDate = map[params.recency];
    }

    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new SearchProviderError("exa", text, res.status);
    }

    const data = await res.json() as ExaApiResponse;
    const count = params.count ?? 10;
    const results = data.results.slice(0, count);

    const sources: SearchSource[] = results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.summary ?? r.text?.slice(0, 300) ?? r.highlights?.[0],
      publishedDate: r.publishedDate,
      author: r.author,
    }));

    const answerParts = results
      .slice(0, 3)
      .filter((r) => r.summary)
      .map((r) => `**${r.title}**: ${r.summary}`);
    const answer = answerParts.length > 0 ? answerParts.join("\n\n") : undefined;

    return { provider: "exa", answer, sources };
  }
}
