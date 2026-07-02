import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type NoticeLevel = "info" | "warning";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface SubagentModelOverride {
  model: string;
  fallbackModels?: string[];
}

export interface Settings {
  subagents?: {
    disableBuiltins?: boolean;
    modelOverridesEnabled?: boolean;
    agentOverrides?: Record<string, SubagentModelOverride>;
    savedAgentOverrides?: Record<string, SubagentModelOverride>;
  };
}

interface ModelEntry {
  id: string;
  input?: string[];
}

interface ModelCatalog {
  providers: Record<string, { models?: ModelEntry[] }>;
}

export type SubagentModelsCommand =
  | { action: "list" }
  | { action: "show"; role: string }
  | { action: "clear"; role: string }
  | { action: "toggle"; enabled: boolean }
  | { action: "selectRole" }
  | { action: "select"; role: string }
  | { action: "set"; role: string; model: string; fallbackModels?: string[] };

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
const DEFAULT_SUBAGENT_ROLES = [
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
  "evaluator",
];

const USAGE = [
  "Usage:",
  "  /subagents-models",
  "  /subagents-models <role>",
  "  /subagents-models set <role>",
  "  /subagents-models set <role> <provider/model[:thinking]> [fallback=<model[,model...]>]",
  "  /subagents-models clear <role>",
  "  /subagents-models enable|disable",
].join("\n");

function tokenize(input: string): string[] {
  return input.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => {
    if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  }) ?? [];
}

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

function splitModelRef(ref: string): { provider: string; model: string; thinking?: string } {
  const trimmed = ref.trim();
  const [providerAndModel, thinking] = trimmed.split(":", 2);
  const slash = providerAndModel.indexOf("/");
  if (slash <= 0 || slash === providerAndModel.length - 1) {
    throw new Error(`Invalid model reference: ${ref}`);
  }
  if (thinking && !THINKING_LEVELS.has(thinking as ThinkingLevel)) {
    throw new Error(`Invalid thinking level "${thinking}". Use one of: ${Array.from(THINKING_LEVELS).join(", ")}`);
  }
  return {
    provider: providerAndModel.slice(0, slash),
    model: providerAndModel.slice(slash + 1),
    thinking,
  };
}

export function modelForRef(catalog: ModelCatalog, ref: string): ModelEntry | undefined {
  const { provider, model } = splitModelRef(ref);
  return catalog.providers[provider]?.models?.find((entry) => entry.id === model);
}

export function listCatalogModelRefs(catalog: ModelCatalog): string[] {
  return Object.entries(catalog.providers)
    .flatMap(([provider, providerConfig]) => (providerConfig.models ?? []).map((model) => `${provider}/${model.id}`));
}

function validateModelRef(catalog: ModelCatalog, ref: string): ModelEntry {
  const entry = modelForRef(catalog, ref);
  if (!entry) {
    const { provider, model } = splitModelRef(ref);
    throw new Error(`Unknown model "${provider}/${model}". Add it to agent/models.json or choose a catalog model.`);
  }
  return entry;
}

function requireVisionModel(catalog: ModelCatalog, role: string, ref: string): void {
  if (role !== "designer") return;
  const entry = validateModelRef(catalog, ref);
  if (!entry.input?.includes("image")) {
    throw new Error("designer must use a model with image input support.");
  }
}

export function applySubagentModelOverride(
  settings: Settings,
  catalog: ModelCatalog,
  command: Extract<SubagentModelsCommand, { action: "set" }>,
): Settings {
  const role = normalizeRole(command.role);
  validateModelRef(catalog, command.model);
  requireVisionModel(catalog, role, command.model);

  for (const fallback of command.fallbackModels ?? []) {
    validateModelRef(catalog, fallback);
    requireVisionModel(catalog, role, fallback);
  }

  const override = {
    model: command.model.trim(),
    ...(command.fallbackModels && command.fallbackModels.length > 0
      ? { fallbackModels: command.fallbackModels.map((fallback) => fallback.trim()) }
      : {}),
  };

  settings.subagents ??= {};
  if (isSubagentModelOverridesEnabled(settings)) {
    settings.subagents.agentOverrides ??= {};
    settings.subagents.agentOverrides[role] = override;
  } else {
    delete settings.subagents.agentOverrides;
  }
  settings.subagents.savedAgentOverrides ??= {};
  settings.subagents.savedAgentOverrides[role] = override;
  return settings;
}

export function clearSubagentModelOverride(settings: Settings, role: string): Settings {
  const key = normalizeRole(role);
  if (settings.subagents?.agentOverrides) {
    delete settings.subagents.agentOverrides[key];
  }
  if (settings.subagents?.savedAgentOverrides) {
    delete settings.subagents.savedAgentOverrides[key];
  }
  return settings;
}

function cloneOverrides(
  overrides: Record<string, SubagentModelOverride> | undefined,
): Record<string, SubagentModelOverride> {
  return Object.fromEntries(Object.entries(overrides ?? {}).map(([role, override]) => [
    role,
    {
      model: override.model,
      ...(override.fallbackModels ? { fallbackModels: [...override.fallbackModels] } : {}),
    },
  ]));
}

export function isSubagentModelOverridesEnabled(settings: Settings): boolean {
  return settings.subagents?.modelOverridesEnabled !== false;
}

export function setSubagentModelOverridesEnabled(settings: Settings, enabled: boolean): Settings {
  settings.subagents ??= {};
  settings.subagents.modelOverridesEnabled = enabled;

  if (enabled) {
    const saved = cloneOverrides(settings.subagents.savedAgentOverrides);
    if (Object.keys(saved).length > 0) {
      settings.subagents.agentOverrides = saved;
    }
    return settings;
  }

  const active = cloneOverrides(settings.subagents.agentOverrides);
  if (Object.keys(active).length > 0) {
    settings.subagents.savedAgentOverrides = active;
  } else {
    settings.subagents.savedAgentOverrides ??= {};
  }
  delete settings.subagents.agentOverrides;
  return settings;
}

export function parseSubagentModelsArgs(args: string): SubagentModelsCommand {
  const tokens = tokenize(args.trim());
  if (tokens.length === 0 || tokens[0] === "list") return { action: "list" };

  if (tokens[0] === "enable") {
    if (tokens.length !== 1) throw new Error(USAGE);
    return { action: "toggle", enabled: true };
  }

  if (tokens[0] === "disable") {
    if (tokens.length !== 1) throw new Error(USAGE);
    return { action: "toggle", enabled: false };
  }

  if (tokens[0] === "toggle") {
    if (tokens[1] === "on" || tokens[1] === "enable" || tokens[1] === "enabled") return { action: "toggle", enabled: true };
    if (tokens[1] === "off" || tokens[1] === "disable" || tokens[1] === "disabled") return { action: "toggle", enabled: false };
    throw new Error(USAGE);
  }

  if (tokens[0] === "clear") {
    if (tokens.length !== 2) throw new Error(USAGE);
    return { action: "clear", role: normalizeRole(tokens[1]) };
  }

  if (tokens[0] === "set") {
    if (tokens.length === 1) return { action: "selectRole" };
    if (tokens.length === 2) return { action: "select", role: normalizeRole(tokens[1]) };
    if (tokens.length < 3) throw new Error(USAGE);
    const fallbackToken = tokens.find((token) => token.startsWith("fallback=") || token.startsWith("--fallback="));
    const fallbackValue = fallbackToken?.slice(fallbackToken.indexOf("=") + 1);
    return {
      action: "set",
      role: normalizeRole(tokens[1]),
      model: tokens[2],
      ...(fallbackValue
        ? { fallbackModels: fallbackValue.split(",").map((fallback) => fallback.trim()).filter(Boolean) }
        : {}),
    };
  }

  if (tokens.length === 1) return { action: "show", role: normalizeRole(tokens[0]) };

  throw new Error(USAGE);
}

function agentFilePath(fileName: string): string {
  const home = process.env.HOME;
  return home ? join(home, ".pi", "agent", fileName) : join(process.cwd(), "agent", fileName);
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function formatOverride(role: string, override: SubagentModelOverride): string {
  const fallback = override.fallbackModels?.length
    ? ` fallback=${override.fallbackModels.join(",")}`
    : "";
  return `  ${role}: ${override.model}${fallback}`;
}

export function formatSubagentModelOverrides(settings: Settings, role?: string): string {
  const enabled = isSubagentModelOverridesEnabled(settings);
  const overrides = enabled ? settings.subagents?.agentOverrides ?? {} : settings.subagents?.savedAgentOverrides ?? {};
  const entries = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b));

  if (role) {
    const override = overrides[normalizeRole(role)];
    return override ? formatOverride(normalizeRole(role), override) : `No override set for ${normalizeRole(role)}.`;
  }

  const current = entries.length > 0
    ? entries.map(([name, override]) => formatOverride(name, override)).join("\n")
    : "  No subagent overrides configured.";
  const status = enabled ? "enabled" : "disabled";
  const effect = enabled
    ? "Per-subagent routes are active."
    : "Per-subagent routes are saved but inactive; /models controls all subagents.";
  return `Subagent model routing: ${status}\n${effect}\n${current}\n\n${USAGE}`;
}

export function listSubagentRoles(settings: Settings): string[] {
  return Array.from(new Set([
    ...Object.keys(settings.subagents?.agentOverrides ?? {}),
    ...DEFAULT_SUBAGENT_ROLES,
  ])).sort((a, b) => a.localeCompare(b));
}

export async function handleSubagentModelsCommand(
  args: string,
  paths: {
    settingsPath?: string;
    catalogPath?: string;
    selectRole?: (roles: string[]) => Promise<string | undefined>;
    selectModel?: (role: string, models: string[]) => Promise<string | undefined>;
  } = {},
): Promise<{ level: NoticeLevel; message: string }> {
  const settingsPath = paths.settingsPath ?? agentFilePath("settings.json");
  const catalogPath = paths.catalogPath ?? agentFilePath("models.json");
  const command = parseSubagentModelsArgs(args);
  const settings = await readJsonFile<Settings>(settingsPath);

  if (command.action === "list") {
    return { level: "info", message: formatSubagentModelOverrides(settings) };
  }

  if (command.action === "show") {
    return { level: "info", message: `${formatSubagentModelOverrides(settings, command.role)}\n\n${USAGE}` };
  }

  if (command.action === "toggle") {
    setSubagentModelOverridesEnabled(settings, command.enabled);
    await writeJsonFile(settingsPath, settings);
    return {
      level: "info",
      message: command.enabled
        ? "Per-subagent model routing enabled. Saved role assignments are active."
        : "Per-subagent model routing disabled. Saved role assignments are inactive; /models controls all subagents.",
    };
  }

  if (command.action === "clear") {
    clearSubagentModelOverride(settings, command.role);
    await writeJsonFile(settingsPath, settings);
    return { level: "info", message: `Cleared ${command.role} subagent model override.` };
  }

  const catalog = await readJsonFile<ModelCatalog>(catalogPath);
  const selectableCommand = command.action === "selectRole"
    ? { action: "select" as const, role: await selectRoleForModelRouting(settings, paths.selectRole) }
    : command;
  const setCommand = selectableCommand.action === "select"
    ? {
        action: "set" as const,
        role: selectableCommand.role,
        model: await selectModelForRole(selectableCommand.role, catalog, paths.selectModel),
      }
    : selectableCommand;
  applySubagentModelOverride(settings, catalog, setCommand);
  await writeJsonFile(settingsPath, settings);
  return {
    level: "info",
    message: `Updated ${setCommand.role}: ${setCommand.model}${setCommand.fallbackModels?.length ? ` fallback=${setCommand.fallbackModels.join(",")}` : ""}`,
  };
}

async function selectRoleForModelRouting(
  settings: Settings,
  selectRole?: (roles: string[]) => Promise<string | undefined>,
): Promise<string> {
  if (!selectRole) {
    throw new Error("Interactive role selection is unavailable in this context. Use: /subagents-models set <role>");
  }
  const selected = await selectRole(listSubagentRoles(settings));
  if (!selected) {
    throw new Error("No subagent role selected.");
  }
  return normalizeRole(selected);
}

async function selectModelForRole(
  role: string,
  catalog: ModelCatalog,
  selectModel?: (role: string, models: string[]) => Promise<string | undefined>,
): Promise<string> {
  if (!selectModel) {
    throw new Error("Interactive model selection is unavailable in this context. Use: /subagents-models set <role> <provider/model[:thinking]>");
  }
  const models = listCatalogModelRefs(catalog);
  if (models.length === 0) {
    throw new Error("No active models found in agent/models.json.");
  }
  const selected = await selectModel(role, models);
  if (!selected) {
    throw new Error("No model selected.");
  }
  return selected;
}
