import { describe, expect, it } from "vitest";
import { isSearchProviderId, SEARCH_PROVIDER_ORDER } from "../../../src/web/search/types";

describe("isSearchProviderId", () => {
  it("returns true for valid provider ids", () => {
    expect(isSearchProviderId("exa")).toBe(true);
    expect(isSearchProviderId("brave")).toBe(true);
    expect(isSearchProviderId("tavily")).toBe(true);
    expect(isSearchProviderId("perplexity")).toBe(true);
    expect(isSearchProviderId("gemini")).toBe(true);
  });

  it("returns false for unknown strings", () => {
    expect(isSearchProviderId("google")).toBe(false);
    expect(isSearchProviderId("")).toBe(false);
    expect(isSearchProviderId("auto")).toBe(false);
  });
});

describe("SEARCH_PROVIDER_ORDER", () => {
  it("contains all providers in fallback order", () => {
    expect(SEARCH_PROVIDER_ORDER).toEqual(["exa", "brave", "tavily", "perplexity", "gemini"]);
  });
});
