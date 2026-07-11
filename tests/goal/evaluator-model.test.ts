import { describe, expect, it } from "vitest";
import { parseModelRef, pickEvaluatorModel, resolveEvaluatorAuth } from "../../src/goal/evaluator-model";

const registry = [
  { provider: "theclawbay-claude", id: "claude-sonnet-4-6" },
  { provider: "theclawbay-claude", id: "claude-haiku-4-5" },
  { provider: "theclawbay", id: "gpt-5.4-mini" },
];
const allAuthed = () => true;

describe("parseModelRef", () => {
  it("parses provider/id and optional :thinking suffix", () => {
    expect(parseModelRef("theclawbay-claude/claude-sonnet-4-6:low")).toEqual({
      provider: "theclawbay-claude", id: "claude-sonnet-4-6", thinking: "low",
    });
    expect(parseModelRef("theclawbay/gpt-5.4-mini")).toEqual({
      provider: "theclawbay", id: "gpt-5.4-mini", thinking: undefined,
    });
  });

  it("rejects refs without a provider and unknown thinking levels", () => {
    expect(parseModelRef("claude-sonnet-4-6")).toBeUndefined();
    expect(parseModelRef("p/m:warp")).toEqual({ provider: "p", id: "m", thinking: undefined });
    // pi-ai expresses "off" by omitting `reasoning`; the wiring's default applies.
    expect(parseModelRef("p/m:off")).toEqual({ provider: "p", id: "m", thinking: undefined });
  });
});

describe("pickEvaluatorModel", () => {
  it("picks the primary override model when registered and authed", () => {
    const picked = pickEvaluatorModel(
      { model: "theclawbay-claude/claude-sonnet-4-6:low" }, registry, allAuthed,
    );
    expect(picked?.model.id).toBe("claude-sonnet-4-6");
    expect(picked?.thinking).toBe("low");
  });

  it("falls back in order when the primary has no configured auth", () => {
    const picked = pickEvaluatorModel(
      { model: "theclawbay-claude/claude-sonnet-4-6", fallbackModels: ["theclawbay/gpt-5.4-mini:low"] },
      registry,
      (m) => m.provider !== "theclawbay-claude",
    );
    expect(picked?.model.id).toBe("gpt-5.4-mini");
    expect(picked?.thinking).toBe("low");
  });

  it("returns undefined when nothing in the chain is usable", () => {
    expect(pickEvaluatorModel({ model: "nope/missing" }, registry, allAuthed)).toBeUndefined();
    expect(pickEvaluatorModel({ model: "not-a-ref" }, registry, allAuthed)).toBeUndefined();
  });
});

describe("resolveEvaluatorAuth", () => {
  const model = { provider: "someprovider", id: "some-model" };

  it("returns apiKey and headers from the registry resolution", async () => {
    const registry = {
      getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "sk-123", headers: { "x-a": "b" } }),
    };
    await expect(resolveEvaluatorAuth(registry, model)).resolves.toEqual({
      apiKey: "sk-123",
      headers: { "x-a": "b" },
    });
  });

  it("throws with provider/model context when resolution fails", async () => {
    const registry = {
      getApiKeyAndHeaders: async () => ({ ok: false as const, error: "no key configured" }),
    };
    await expect(resolveEvaluatorAuth(registry, model)).rejects.toThrow(
      /someprovider\/some-model.*no key configured/,
    );
  });
});
