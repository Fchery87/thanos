import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../../../../src/web/search/providers/gemini";

describe("GeminiProvider", () => {
  const originalEnv = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalEnv;
    vi.unstubAllGlobals();
  });

  it("reports unavailable when key is missing", () => {
    delete process.env.GEMINI_API_KEY;
    expect(new GeminiProvider().isAvailable()).toBe(false);
  });

  it("reports available when key is set", () => {
    process.env.GEMINI_API_KEY = "aistudio-test";
    expect(new GeminiProvider().isAvailable()).toBe(true);
  });

  it("has correct id and label", () => {
    const p = new GeminiProvider();
    expect(p.id).toBe("gemini");
    expect(p.label).toBe("Gemini");
  });

  it("extracts grounded answer and sources", async () => {
    process.env.GEMINI_API_KEY = "aistudio-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: "Grounded answer text." }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://gemini-src.com", title: "Gemini Source" } },
            ],
          },
        }],
      }),
    }));

    const result = await new GeminiProvider().search({ query: "grounded query" });
    expect(result.provider).toBe("gemini");
    expect(result.answer).toBe("Grounded answer text.");
    expect(result.sources[0]?.url).toBe("https://gemini-src.com");
    expect(result.sources[0]?.title).toBe("Gemini Source");
  });

  it("throws on HTTP error", async () => {
    process.env.GEMINI_API_KEY = "aistudio-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => "Internal error",
    }));
    await expect(new GeminiProvider().search({ query: "x" })).rejects.toThrow("Internal error");
  });
});
