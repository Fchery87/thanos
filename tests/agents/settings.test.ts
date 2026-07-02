import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface Settings {
  defaultProvider?: string;
  defaultModel?: string;
  subagents?: {
    disableBuiltins?: boolean;
    agentOverrides?: Record<string, { model: string; fallbackModels?: string[] }>;
  };
}

interface ModelCatalog {
  providers: Record<string, { models?: { id: string; input?: string[] }[] }>;
}

function splitModelRef(ref: string): { provider: string; model: string } {
  const [withoutThinking] = ref.split(":");
  const [provider, model] = withoutThinking?.split("/") ?? [];
  if (!provider || !model) throw new Error(`Invalid model reference: ${ref}`);
  return { provider, model };
}

function modelForRef(catalog: ModelCatalog, ref: string): { id: string; input?: string[] } | undefined {
  const { provider, model } = splitModelRef(ref);
  return catalog.providers[provider]?.models?.find((entry) => entry.id === model);
}

describe("settings.example model routing", () => {
  it("routes every subagent override to a catalog model", async () => {
    const settings = JSON.parse(await readFile("agent/settings.example.json", "utf-8")) as Settings;
    const catalog = JSON.parse(await readFile("agent/models.example.json", "utf-8")) as ModelCatalog;
    const overrides = settings.subagents?.agentOverrides ?? {};

    expect(settings.subagents?.disableBuiltins).toBe(true);
    expect(Object.keys(overrides)).toEqual(expect.arrayContaining([
      "oracle",
      "plan",
      "reviewer",
      "reviewer-correctness",
      "reviewer-security",
      "reviewer-tests",
      "designer",
      "build",
      "worker",
      "researcher",
      "scout",
      "explore",
    ]));

    for (const override of Object.values(overrides)) {
      expect(modelForRef(catalog, override.model), override.model).toBeDefined();
      for (const fallback of override.fallbackModels ?? []) {
        expect(modelForRef(catalog, fallback), fallback).toBeDefined();
      }
    }
  });

  it("keeps designer on a vision-capable model", async () => {
    const settings = JSON.parse(await readFile("agent/settings.example.json", "utf-8")) as Settings;
    const catalog = JSON.parse(await readFile("agent/models.example.json", "utf-8")) as ModelCatalog;
    const designerModel = settings.subagents?.agentOverrides?.designer?.model;

    expect(designerModel).toBeDefined();
    expect(modelForRef(catalog, designerModel!)?.input).toEqual(expect.arrayContaining(["text", "image"]));
  });
});
