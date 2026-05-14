import { SearchProvider, SearchProviderError } from "./base";
import type { SearchParams, SearchResponse, SearchSource } from "../types";

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
  extra_snippets?: string[];
  age?: string;
}

interface BraveApiResponse {
  web?: { results: BraveWebResult[] };
}

const RECENCY_MAP: Record<string, string> = {
  day: "pd", week: "pw", month: "pm", year: "py",
};

export class BraveProvider extends SearchProvider {
  readonly id = "brave" as const;
  readonly label = "Brave Search";

  isAvailable(): boolean {
    return !!process.env.BRAVE_API_KEY;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const key = process.env.BRAVE_API_KEY;
    if (!key) throw new SearchProviderError("brave", "BRAVE_API_KEY is not set");

    const count = Math.min(Math.max(params.count ?? 10, 1), 20);
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", params.query);
    url.searchParams.set("count", String(count));
    url.searchParams.set("extra_snippets", "true");
    if (params.recency) url.searchParams.set("freshness", RECENCY_MAP[params.recency] ?? "");

    const res = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": key,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new SearchProviderError("brave", text, res.status);
    }

    const data = await res.json() as BraveApiResponse;
    const results = (data.web?.results ?? []).slice(0, count);

    const sources: SearchSource[] = results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(" ") || undefined,
      publishedDate: r.age,
    }));

    return { provider: "brave", sources };
  }
}
