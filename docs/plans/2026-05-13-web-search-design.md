# Web Search Provider System

## Goal

Add a native `web_search` tool to Thanos that mirrors oh-my-pi's multi-provider architecture: a lazy-loading registry, a fallback chain, and a unified response shape. The agent picks the first available provider automatically; the user can pin a specific one via the `provider` parameter.

## Architecture

```
src/web/search/
├── types.ts          — core types
├── providers/
│   ├── base.ts       — abstract SearchProvider
│   ├── exa.ts        — EXA_API_KEY
│   ├── brave.ts      — BRAVE_API_KEY
│   ├── tavily.ts     — TAVILY_API_KEY
│   ├── perplexity.ts — PERPLEXITY_API_KEY
│   └── gemini.ts     — GEMINI_API_KEY
├── provider.ts       — PROVIDER_META registry + resolveProviderChain()
└── index.ts          — executeSearch() + registerSearchTool(pi)
```

Wire-up: single `registerSearchTool(pi)` call in `src/index.ts`.

## Types

```typescript
type SearchProviderId = "exa" | "brave" | "tavily" | "perplexity" | "gemini";

interface SearchParams {
  query: string;
  count?: number;           // default 10
  recency?: "day" | "week" | "month" | "year";
  includeDomains?: string[];
  excludeDomains?: string[];
}

interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
  author?: string;
}

interface SearchResponse {
  provider: SearchProviderId;
  answer?: string;          // synthesized summary (Exa, Perplexity, Gemini)
  sources: SearchSource[];
}
```

## Tool schema exposed to the agent

| param | type | default |
|---|---|---|
| `query` | string (required) | — |
| `provider` | `"auto" \| SearchProviderId` | `"auto"` |
| `count` | number | 10 |
| `recency` | `"day" \| "week" \| "month" \| "year"` | — |

`"auto"` triggers fallback chain: exa → brave → tavily → perplexity → gemini.

## Provider pattern

```typescript
abstract class SearchProvider {
  abstract readonly id: SearchProviderId;
  abstract readonly label: string;
  abstract isAvailable(): boolean | Promise<boolean>;
  abstract search(params: SearchParams): Promise<SearchResponse>;
}
```

Each provider reads its API key from `process.env`. `isAvailable()` returns false when the key is absent — provider is silently skipped in the chain.

## Chain resolution

`resolveProviderChain(preferred?)`:
1. If `preferred` is set and not `"auto"`, load that provider; include it if available.
2. Walk `SEARCH_PROVIDER_ORDER`, load each lazily, include if `isAvailable()`.
3. Return ordered array of ready providers.

`executeSearch()` iterates the chain, returns first success, accumulates errors, throws combined message if all fail.

## Provider notes

| Provider | Key | Answer synthesis |
|---|---|---|
| Exa | `EXA_API_KEY` | Yes — per-result summaries |
| Brave | `BRAVE_API_KEY` | No — sources only |
| Tavily | `TAVILY_API_KEY` | Yes — `answer` field |
| Perplexity | `PERPLEXITY_API_KEY` | Yes — full synthesis |
| Gemini | `GEMINI_API_KEY` | Yes — grounded generation |
