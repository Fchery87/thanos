import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProviderChain, getSearchProvider } from "../../../src/web/search/provider";

describe("getSearchProvider", () => {
  it("throws for unknown provider id", async () => {
    await expect(getSearchProvider("unknown" as any)).rejects.toThrow("Unknown search provider");
  });

  it("returns an ExaProvider for 'exa'", async () => {
    const p = await getSearchProvider("exa");
    expect(p.id).toBe("exa");
  });
});

const API_KEYS = ["EXA_API_KEY", "BRAVE_API_KEY", "TAVILY_API_KEY", "PERPLEXITY_API_KEY", "GEMINI_API_KEY"] as const;

describe("resolveProviderChain", () => {
  beforeEach(() => {
    for (const k of API_KEYS) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of API_KEYS) {
      delete process.env[k];
    }
  });

  it("returns empty array when no providers are available", async () => {
    const chain = await resolveProviderChain();
    expect(chain).toHaveLength(0);
  });

  it("returns only available providers in order", async () => {
    process.env.BRAVE_API_KEY = "brave-key";
    process.env.TAVILY_API_KEY = "tavily-key";
    const chain = await resolveProviderChain();
    expect(chain.map((p) => p.id)).toEqual(["brave", "tavily"]);
  });

  it("puts preferred provider first even if it appears later in default order", async () => {
    process.env.EXA_API_KEY = "exa-key";
    process.env.TAVILY_API_KEY = "tavily-key";
    const chain = await resolveProviderChain("tavily");
    expect(chain[0]?.id).toBe("tavily");
    expect(chain[1]?.id).toBe("exa");
  });

  it("ignores preferred provider if not available", async () => {
    process.env.EXA_API_KEY = "exa-key";
    const chain = await resolveProviderChain("brave"); // no BRAVE key
    expect(chain.map((p) => p.id)).toEqual(["exa"]);
  });

  it("treats 'auto' same as no preference", async () => {
    process.env.EXA_API_KEY = "exa-key";
    const chain = await resolveProviderChain("auto");
    expect(chain[0]?.id).toBe("exa");
  });
});
