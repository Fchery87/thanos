#!/usr/bin/env node
/**
 * Sync safe model metadata from https://models.dev/api.json into Pi custom providers.
 *
 * Defaults to dry-run. Pass --write to update ~/.pi/agent/models.json.
 *
 * Safety rules:
 * - Only touches custom providers listed in TARGET_PROVIDERS unless --providers is passed.
 * - Never changes provider auth, baseUrl, api, headers, authHeader, or model ids.
 * - Only updates safe model metadata fields when a matching models.dev entry is found.
 */
import { readFileSync, writeFileSync, copyFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";
import { backupPath } from "../src/observability/backup.ts";

const DEFAULT_MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");
const MODELS_DEV_URL = "https://models.dev/api.json";
const DEFAULT_TARGET_PROVIDERS = ["CrofAI", "theclawbay"];
const SAFE_MODEL_FIELDS = ["name", "contextWindow", "maxTokens", "input", "reasoning", "cost"];

function parseArgs(argv) {
  const args = {
    write: false,
    modelsPath: DEFAULT_MODELS_PATH,
    providers: DEFAULT_TARGET_PROVIDERS,
    url: MODELS_DEV_URL,
    allowSuffix: false,
    overwrite: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--write") args.write = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--models") args.modelsPath = argv[++i];
    else if (arg.startsWith("--models=")) args.modelsPath = arg.slice("--models=".length);
    else if (arg === "--providers") args.providers = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith("--providers=")) args.providers = arg.slice("--providers=".length).split(",").map(s => s.trim()).filter(Boolean);
    else if (arg === "--url") args.url = argv[++i];
    else if (arg.startsWith("--url=")) args.url = arg.slice("--url=".length);
    else if (arg === "--allow-suffix") args.allowSuffix = true;
    else if (arg === "--overwrite") args.overwrite = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-models-dev.mjs [options]\n\nOptions:\n  --write                 Write changes to models.json. Default is dry-run.\n  --models <path>         models.json path. Default: ${DEFAULT_MODELS_PATH}\n  --providers <a,b>       Custom providers to update. Default: ${DEFAULT_TARGET_PROVIDERS.join(",")}\n  --url <url>             models.dev API URL. Default: ${MODELS_DEV_URL}\n  --allow-suffix          Also match provider/model suffixes. Riskier; off by default.\n  --overwrite             Overwrite existing metadata. Default only fills missing fields.\n  -h, --help              Show this help.\n\nExamples:\n  node scripts/sync-models-dev.mjs\n  node scripts/sync-models-dev.mjs --write\n  node scripts/sync-models-dev.mjs --providers CrofAI,theclawbay --write`);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeId(id) {
  return String(id ?? "").trim().toLowerCase();
}

function buildModelIndex(modelsDev) {
  const exact = new Map();
  const suffix = new Map();

  for (const [providerId, provider] of Object.entries(modelsDev ?? {})) {
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      const key = normalizeId(modelId);
      if (!exact.has(key)) exact.set(key, []);
      exact.get(key).push({ providerId, modelId, model });

      // models.dev often uses provider/model IDs for gateways. Custom providers often store only model.
      const parts = key.split("/");
      const last = parts[parts.length - 1];
      if (last && last !== key) {
        if (!suffix.has(last)) suffix.set(last, []);
        suffix.get(last).push({ providerId, modelId, model });
      }
    }
  }

  return { exact, suffix };
}

function chooseMatch(localModelId, index, options = {}) {
  const key = normalizeId(localModelId);
  const exactMatches = index.exact.get(key) ?? [];
  if (exactMatches.length === 1) return { ...exactMatches[0], matchKind: "exact" };
  if (exactMatches.length > 1) return { ambiguous: true, matchKind: "exact", candidates: exactMatches };

  if (!options.allowSuffix) return null;

  const suffixMatches = index.suffix.get(key) ?? [];
  if (suffixMatches.length === 1) return { ...suffixMatches[0], matchKind: "suffix" };

  if (suffixMatches.length > 1) {
    return { ambiguous: true, matchKind: "suffix", candidates: suffixMatches };
  }

  return null;
}

function toPiMetadata(match, existing) {
  const m = match.model ?? {};
  const next = {};

  // Name
  if (typeof m.name === "string" && m.name.trim()) next.name = m.name;

  // Context and output. models.dev schema can vary by provider.
  const context = m.limit?.context ?? m.context ?? m.contextWindow ?? m.context_length ?? m.contextLength;
  const output = m.limit?.output ?? m.maxOutput ?? m.maxTokens ?? m.output ?? m.output_limit;
  if (Number.isFinite(context) && context > 0) next.contextWindow = context;
  if (Number.isFinite(output) && output > 0) next.maxTokens = output;

  // Inputs / modalities.
  const modalities = new Set(["text"]);
  const input = m.input ?? m.modalities?.input ?? m.capabilities?.input;
  const rawInput = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  for (const item of rawInput) {
    const value = String(item).toLowerCase();
    if (value.includes("image") || value.includes("vision")) modalities.add("image");
  }
  if (m.attachment === true || m.vision === true || m.capabilities?.vision === true) modalities.add("image");
  next.input = [...modalities];

  // Reasoning.
  const reasoning = m.reasoning ?? m.capabilities?.reasoning ?? m.thinking;
  if (typeof reasoning === "boolean") next.reasoning = reasoning;

  // Cost, if available. Pi expects per-million token prices.
  const cost = m.cost ?? m.pricing;
  if (cost && typeof cost === "object") {
    const inputCost = cost.input ?? cost.prompt;
    const outputCost = cost.output ?? cost.completion;
    const cacheRead = cost.cacheRead ?? cost.cache_read;
    const cacheWrite = cost.cacheWrite ?? cost.cache_write;
    const piCost = { ...(existing.cost ?? {}) };
    if (Number.isFinite(inputCost)) piCost.input = inputCost;
    if (Number.isFinite(outputCost)) piCost.output = outputCost;
    if (Number.isFinite(cacheRead)) piCost.cacheRead = cacheRead;
    if (Number.isFinite(cacheWrite)) piCost.cacheWrite = cacheWrite;
    if (Object.keys(piCost).some(k => ["input", "output", "cacheRead", "cacheWrite"].includes(k))) {
      for (const k of ["input", "output", "cacheRead", "cacheWrite"]) {
        if (!Number.isFinite(piCost[k])) piCost[k] = 0;
      }
      next.cost = piCost;
    }
  }

  return next;
}

function applySync(current, modelsDev, targetProviders, options = {}) {
  const index = buildModelIndex(modelsDev);
  const next = structuredClone(current);
  const report = [];
  let changed = 0;

  for (const providerName of targetProviders) {
    const provider = next.providers?.[providerName];
    if (!provider) {
      report.push({ provider: providerName, status: "missing-local-provider" });
      continue;
    }

    const providerReport = { provider: providerName, models: [] };
    for (const model of provider.models ?? []) {
      const match = chooseMatch(model.id, index, options);
      if (!match) {
        providerReport.models.push({ id: model.id, status: "no-match" });
        continue;
      }
      if (match.ambiguous) {
        providerReport.models.push({
          id: model.id,
          status: "ambiguous",
          matchKind: match.matchKind,
          candidates: match.candidates.slice(0, 8).map(c => `${c.providerId}/${c.modelId}`),
          candidateCount: match.candidates.length,
        });
        continue;
      }

      const metadata = toPiMetadata(match, model);
      const updates = {};
      for (const field of SAFE_MODEL_FIELDS) {
        if (!(field in metadata)) continue;
        const missing = model[field] === undefined || model[field] === null || (Array.isArray(model[field]) && model[field].length === 0);
        if ((options.overwrite || missing) && !deepEqual(model[field], metadata[field])) {
          updates[field] = { from: model[field], to: metadata[field] };
          model[field] = metadata[field];
        }
      }
      if (Object.keys(updates).length > 0) changed++;
      providerReport.models.push({
        id: model.id,
        status: Object.keys(updates).length ? "updated" : "unchanged",
        matched: `${match.providerId}/${match.modelId}`,
        matchKind: match.matchKind,
        updates,
      });
    }
    report.push(providerReport);
  }

  return { next, report, changed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  if (!existsSync(args.modelsPath)) throw new Error(`models.json not found: ${args.modelsPath}`);
  const current = JSON.parse(readFileSync(args.modelsPath, "utf-8"));
  const response = await fetch(args.url);
  if (!response.ok) throw new Error(`Failed to fetch ${args.url}: HTTP ${response.status}`);
  const modelsDev = await response.json();
  const { next, report, changed } = applySync(current, modelsDev, args.providers, { allowSuffix: args.allowSuffix, overwrite: args.overwrite });

  const summary = {
    mode: args.write ? "write" : "dry-run",
    modelsPath: args.modelsPath,
    targetProviders: args.providers,
    allowSuffix: args.allowSuffix,
    overwrite: args.overwrite,
    changedModelCount: changed,
    report,
  };

  if (args.write && changed > 0) {
    const dest = backupPath(basename(args.modelsPath));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(args.modelsPath, dest);
    writeFileSync(args.modelsPath, JSON.stringify(next, null, 2) + "\n", "utf-8");
    chmodSync(args.modelsPath, 0o600);
    summary.backupPath = dest;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
