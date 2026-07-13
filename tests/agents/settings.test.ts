import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { modelForRef, type ModelCatalog } from "./model-catalog-helpers";

interface Settings {
  defaultProvider?: string;
  defaultModel?: string;
  subagents?: {
    disableBuiltins?: boolean;
    modelOverridesEnabled?: boolean;
    agentOverrides?: Record<string, { model: string; fallbackModels?: string[] }>;
    savedAgentOverrides?: Record<string, { model: string; fallbackModels?: string[] }>;
  };
}

describe("settings.example model routing", () => {
  // Routing ships OFF by default: pi-subagents applies only `agentOverrides`,
  // so the example stashes the table in `savedAgentOverrides` for
  // /subagents-models enable to restore, and registers no active overrides.
  it("ships with routing toggled off", async () => {
    const settings = JSON.parse(await readFile("agent/settings.example.json", "utf-8")) as Settings;

    expect(settings.subagents?.agentOverrides).toBeUndefined();
    expect(settings.subagents?.modelOverridesEnabled).toBe(false);
  });

  it("routes every stashed subagent override to a catalog model", async () => {
    const settings = JSON.parse(await readFile("agent/settings.example.json", "utf-8")) as Settings;
    const catalog = JSON.parse(await readFile("agent/models.example.json", "utf-8")) as ModelCatalog;
    const overrides = settings.subagents?.savedAgentOverrides ?? {};

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
    const designerModel = settings.subagents?.savedAgentOverrides?.designer?.model;

    expect(designerModel).toBeDefined();
    expect(modelForRef(catalog, designerModel!)?.input).toEqual(expect.arrayContaining(["text", "image"]));
  });
});
