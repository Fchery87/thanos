import { SearchProvider, SearchProviderError } from "./base";
import type { SearchParams, SearchResponse, SearchSource } from "../types";

interface GeminiGroundingChunk {
  web?: { uri: string; title?: string };
}

interface GeminiCandidate {
  content: { parts: Array<{ text?: string }> };
  groundingMetadata?: { groundingChunks?: GeminiGroundingChunk[] };
}

interface GeminiApiResponse {
  candidates?: GeminiCandidate[];
}

export class GeminiProvider extends SearchProvider {
  readonly id = "gemini" as const;
  readonly label = "Gemini";

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new SearchProviderError("gemini", "GEMINI_API_KEY is not set");

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    const body = {
      contents: [{ parts: [{ text: params.query }] }],
      tools: [{ googleSearch: {} }],
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new SearchProviderError("gemini", text, res.status);
    }

    const data = await res.json() as GeminiApiResponse;
    const candidate = data.candidates?.[0];
    const answer = candidate?.content.parts.map((p) => p.text ?? "").join("").trim();
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];

    const sources: SearchSource[] = chunks
      .filter((c) => c.web?.uri)
      .map((c) => ({
        title: c.web!.title ?? c.web!.uri,
        url: c.web!.uri,
      }));

    return { provider: "gemini", answer: answer || undefined, sources };
  }
}
