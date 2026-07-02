import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Settings } from "../../src/agents/model-routing";
import {
  applySubagentModelOverride,
  clearSubagentModelOverride,
  handleSubagentModelsCommand,
  listCatalogModelRefs,
  modelForRef,
  parseSubagentModelsArgs,
  setSubagentModelOverridesEnabled,
} from "../../src/agents/model-routing";

const catalog = {
  providers: {
    "theclawbay-claude": {
      models: [
        { id: "claude-opus-4-8", input: ["text", "image"] },
        { id: "claude-sonnet-4-6", input: ["text", "image"] },
      ],
    },
    theclawbay: {
      models: [
        { id: "gpt-5.5", input: ["text", "image"] },
        { id: "gemini-2.5-pro", input: ["text", "image"] },
      ],
    },
    zai: {
      models: [
        { id: "glm-5.2", input: ["text"] },
      ],
    },
  },
};

describe("subagent model routing", () => {
  it("sets an override with validated fallbacks", () => {
    const settings = {};

    applySubagentModelOverride(settings, catalog, {
      action: "set",
      role: "reviewer",
      model: "theclawbay-claude/claude-opus-4-8:high",
      fallbackModels: ["theclawbay/gpt-5.5"],
    });

    expect(settings).toEqual({
      subagents: {
        agentOverrides: {
          reviewer: {
            model: "theclawbay-claude/claude-opus-4-8:high",
            fallbackModels: ["theclawbay/gpt-5.5"],
          },
        },
        savedAgentOverrides: {
          reviewer: {
            model: "theclawbay-claude/claude-opus-4-8:high",
            fallbackModels: ["theclawbay/gpt-5.5"],
          },
        },
      },
    });
  });

  it("clears one override without removing the subagents block", () => {
    const settings = {
      subagents: {
        disableBuiltins: true,
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
          scout: { model: "theclawbay-claude/claude-sonnet-4-6" },
        },
      },
    };

    clearSubagentModelOverride(settings, "reviewer");

    expect(settings.subagents.agentOverrides).toEqual({
      scout: { model: "theclawbay-claude/claude-sonnet-4-6" },
    });
    expect(settings.subagents.disableBuiltins).toBe(true);
  });

  it("disables per-subagent models by saving and removing active overrides", () => {
    const settings: Settings = {
      subagents: {
        disableBuiltins: true,
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
          worker: { model: "theclawbay-claude/claude-sonnet-4-6" },
        },
      },
    };

    setSubagentModelOverridesEnabled(settings, false);

    expect(settings.subagents.modelOverridesEnabled).toBe(false);
    expect(settings.subagents.savedAgentOverrides).toEqual({
      reviewer: { model: "theclawbay/gpt-5.5" },
      worker: { model: "theclawbay-claude/claude-sonnet-4-6" },
    });
    expect(settings.subagents.agentOverrides).toBeUndefined();
  });

  it("enables per-subagent models by restoring saved overrides", () => {
    const settings: Settings = {
      subagents: {
        disableBuiltins: true,
        modelOverridesEnabled: false,
        savedAgentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    };

    setSubagentModelOverridesEnabled(settings, true);

    expect(settings.subagents.modelOverridesEnabled).toBe(true);
    expect(settings.subagents.agentOverrides).toEqual({
      reviewer: { model: "theclawbay/gpt-5.5" },
    });
  });

  it("rejects unknown catalog references", () => {
    expect(() => applySubagentModelOverride({}, catalog, {
      action: "set",
      role: "reviewer",
      model: "missing/not-real",
    })).toThrow(/Unknown model/);
  });

  it("keeps designer routes on vision-capable models", () => {
    expect(() => applySubagentModelOverride({}, catalog, {
      action: "set",
      role: "designer",
      model: "zai/glm-5.2",
    })).toThrow(/designer.*image/i);
  });

  it("parses set commands with fallback assignments", () => {
    expect(parseSubagentModelsArgs("set reviewer theclawbay/gpt-5.5:high fallback=theclawbay-claude/claude-opus-4-8,zai/glm-5.2")).toEqual({
      action: "set",
      role: "reviewer",
      model: "theclawbay/gpt-5.5:high",
      fallbackModels: ["theclawbay-claude/claude-opus-4-8", "zai/glm-5.2"],
    });
  });

  it("parses set commands without a model as an interactive selection", () => {
    expect(parseSubagentModelsArgs("set reviewer")).toEqual({
      action: "select",
      role: "reviewer",
    });
  });

  it("parses set without a role as an interactive role selection", () => {
    expect(parseSubagentModelsArgs("set")).toEqual({
      action: "selectRole",
    });
  });

  it("parses toggle commands", () => {
    expect(parseSubagentModelsArgs("toggle off")).toEqual({ action: "toggle", enabled: false });
    expect(parseSubagentModelsArgs("disable")).toEqual({ action: "toggle", enabled: false });
    expect(parseSubagentModelsArgs("enable")).toEqual({ action: "toggle", enabled: true });
  });

  it("lists active catalog models as selectable references", () => {
    expect(listCatalogModelRefs(catalog)).toEqual([
      "theclawbay-claude/claude-opus-4-8",
      "theclawbay-claude/claude-sonnet-4-6",
      "theclawbay/gpt-5.5",
      "theclawbay/gemini-2.5-pro",
      "zai/glm-5.2",
    ]);
  });

  it("resolves model references without treating thinking as part of the id", () => {
    expect(modelForRef(catalog, "theclawbay-claude/claude-opus-4-8:xhigh")).toEqual({
      id: "claude-opus-4-8",
      input: ["text", "image"],
    });
  });
});

describe("/subagents-models command handler", () => {
  it("updates the active settings file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-model-routing-"));
    const settingsPath = join(dir, "settings.json");
    const catalogPath = join(dir, "models.json");
    await writeFile(settingsPath, JSON.stringify({ subagents: { disableBuiltins: true } }, null, 2));
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    const result = await handleSubagentModelsCommand(
      "set reviewer theclawbay/gpt-5.5:high fallback=theclawbay-claude/claude-opus-4-8",
      { settingsPath, catalogPath },
    );

    expect(result.level).toBe("info");
    expect(result.message).toContain("Updated reviewer");
    expect(JSON.parse(await readFile(settingsPath, "utf-8"))).toMatchObject({
      subagents: {
        disableBuiltins: true,
        agentOverrides: {
          reviewer: {
            model: "theclawbay/gpt-5.5:high",
            fallbackModels: ["theclawbay-claude/claude-opus-4-8"],
          },
        },
      },
    });
  });

  it("lists current overrides when called without arguments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-model-routing-"));
    const settingsPath = join(dir, "settings.json");
    const catalogPath = join(dir, "models.json");
    await writeFile(settingsPath, JSON.stringify({
      subagents: {
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    }, null, 2));
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    const result = await handleSubagentModelsCommand("", { settingsPath, catalogPath });

    expect(result.level).toBe("info");
    expect(result.message).toContain("reviewer");
    expect(result.message).toContain("Usage:");
  });

  it("disables routing from the command handler while preserving assignments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-model-routing-"));
    const settingsPath = join(dir, "settings.json");
    const catalogPath = join(dir, "models.json");
    await writeFile(settingsPath, JSON.stringify({
      subagents: {
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    }, null, 2));
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    const result = await handleSubagentModelsCommand("disable", { settingsPath, catalogPath });

    expect(result.message).toContain("disabled");
    expect(JSON.parse(await readFile(settingsPath, "utf-8"))).toMatchObject({
      subagents: {
        modelOverridesEnabled: false,
        savedAgentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    });
    expect(JSON.parse(await readFile(settingsPath, "utf-8")).subagents.agentOverrides).toBeUndefined();
  });

  it("updates saved assignments without activating them while disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-model-routing-"));
    const settingsPath = join(dir, "settings.json");
    const catalogPath = join(dir, "models.json");
    await writeFile(settingsPath, JSON.stringify({
      subagents: {
        modelOverridesEnabled: false,
        savedAgentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    }, null, 2));
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    await handleSubagentModelsCommand("set reviewer theclawbay-claude/claude-opus-4-8:high", { settingsPath, catalogPath });

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.subagents.modelOverridesEnabled).toBe(false);
    expect(settings.subagents.agentOverrides).toBeUndefined();
    expect(settings.subagents.savedAgentOverrides.reviewer).toEqual({
      model: "theclawbay-claude/claude-opus-4-8:high",
    });
  });

  it("reenables routing from saved assignments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-model-routing-"));
    const settingsPath = join(dir, "settings.json");
    const catalogPath = join(dir, "models.json");
    await writeFile(settingsPath, JSON.stringify({
      subagents: {
        modelOverridesEnabled: false,
        savedAgentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    }, null, 2));
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    const result = await handleSubagentModelsCommand("enable", { settingsPath, catalogPath });

    expect(result.message).toContain("enabled");
    expect(JSON.parse(await readFile(settingsPath, "utf-8"))).toMatchObject({
      subagents: {
        modelOverridesEnabled: true,
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    });
  });

  it("selects from the active catalog when set receives only a role", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-model-routing-"));
    const settingsPath = join(dir, "settings.json");
    const catalogPath = join(dir, "models.json");
    await writeFile(settingsPath, JSON.stringify({ subagents: { disableBuiltins: true } }, null, 2));
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    const selectedModels: string[][] = [];
    const result = await handleSubagentModelsCommand(
      "set reviewer",
      {
        settingsPath,
        catalogPath,
        selectModel: async (_role, models) => {
          selectedModels.push(models);
          return "theclawbay-claude/claude-sonnet-4-6";
        },
      },
    );

    expect(selectedModels[0]).toContain("theclawbay-claude/claude-sonnet-4-6");
    expect(result.message).toContain("Updated reviewer");
    expect(JSON.parse(await readFile(settingsPath, "utf-8"))).toMatchObject({
      subagents: {
        agentOverrides: {
          reviewer: { model: "theclawbay-claude/claude-sonnet-4-6" },
        },
      },
    });
  });

  it("selects a role before selecting from the active catalog", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thanos-model-routing-"));
    const settingsPath = join(dir, "settings.json");
    const catalogPath = join(dir, "models.json");
    await writeFile(settingsPath, JSON.stringify({ subagents: { disableBuiltins: true } }, null, 2));
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    const result = await handleSubagentModelsCommand(
      "set",
      {
        settingsPath,
        catalogPath,
        selectRole: async (roles) => {
          expect(roles).toContain("reviewer");
          return "reviewer";
        },
        selectModel: async (role, models) => {
          expect(role).toBe("reviewer");
          expect(models).toContain("theclawbay/gpt-5.5");
          return "theclawbay/gpt-5.5";
        },
      },
    );

    expect(result.message).toContain("Updated reviewer");
    expect(JSON.parse(await readFile(settingsPath, "utf-8"))).toMatchObject({
      subagents: {
        agentOverrides: {
          reviewer: { model: "theclawbay/gpt-5.5" },
        },
      },
    });
  });
});
