#!/usr/bin/env node
/**
 * Discover NEW models from the TheClawbay endpoints and add skeleton entries to
 * Pi's models.json. Complements sync-models-dev.mjs:
 *   - This script ADDS models that newly appear on the endpoint (id discovery).
 *   - sync-models-dev.mjs ENRICHES existing models with metadata from models.dev.
 * Typical flow after the endpoint gains models:
 *   node scripts/sync-clawbay-models.mjs --write      # add the new ids
 *   node scripts/sync-models-dev.mjs   --write        # backfill cost/context/etc.
 *
 * Defaults to dry-run. Pass --write to update ~/.pi/agent/models.json.
 *
 * Safety rules:
 * - Only ever ADDS models; never edits or removes existing entries.
 * - Never touches provider auth, baseUrl, api, or headers.
 * - claude-* ids route to the anthropic provider; everything else to the openai one.
 * - New entries get placeholder cost/context flagged in the report for review.
 */
import { readFileSync, writeFileSync, copyFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";
import { backupPath } from "../src/observability/backup.ts";

const DEFAULT_MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");
// Provider pair: [openai-style completions/responses provider, anthropic-messages provider]
const DEFAULT_OPENAI_PROVIDER = "theclawbay";
const DEFAULT_ANTHROPIC_PROVIDER = "theclawbay-claude";
const ANTHROPIC_VERSION = "2023-06-01";

// Conservative placeholders for fields the endpoint does not expose.
// Flagged in the report so a human (or sync-models-dev) can correct them.
const PLACEHOLDER_CONTEXT_WINDOW = 200000;
const PLACEHOLDER_MAX_TOKENS = 8192;
const PLACEHOLDER_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function parseArgs(argv) {
  const args = {
    write: false,
    modelsPath: DEFAULT_MODELS_PATH,
    openaiProvider: DEFAULT_OPENAI_PROVIDER,
    anthropicProvider: DEFAULT_ANTHROPIC_PROVIDER,
    apiKey: process.env.THECLAWBAY_API_KEY ?? null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--write") args.write = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--models") args.modelsPath = argv[++i];
    else if (arg.startsWith("--models=")) args.modelsPath = arg.slice("--models=".length);
    else if (arg === "--openai-provider") args.openaiProvider = argv[++i];
    else if (arg.startsWith("--openai-provider=")) args.openaiProvider = arg.slice("--openai-provider=".length);
    else if (arg === "--anthropic-provider") args.anthropicProvider = argv[++i];
    else if (arg.startsWith("--anthropic-provider=")) args.anthropicProvider = arg.slice("--anthropic-provider=".length);
    else if (arg === "--api-key") args.apiKey = argv[++i];
    else if (arg.startsWith("--api-key=")) args.apiKey = arg.slice("--api-key=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-clawbay-models.mjs [options]

Discovers models on the TheClawbay endpoints and adds any that are missing from
models.json. Dry-run by default.

Options:
  --write                    Apply changes (with timestamped backup). Default is dry-run.
  --models <path>            models.json path. Default: ${DEFAULT_MODELS_PATH}
  --openai-provider <name>   Provider for non-claude models. Default: ${DEFAULT_OPENAI_PROVIDER}
  --anthropic-provider <n>   Provider for claude-* models. Default: ${DEFAULT_ANTHROPIC_PROVIDER}
  --api-key <key>            API key. Default: $THECLAWBAY_API_KEY
  -h, --help                 Show this help.

Examples:
  node scripts/sync-clawbay-models.mjs            # show what would be added
  node scripts/sync-clawbay-models.mjs --write    # add new models
`);
}

// Resolve a "$ENV_VAR" reference (as stored in models.json) to its value.
function resolveKey(raw, fallback) {
  if (fallback) return fallback;
  if (typeof raw === "string" && raw.startsWith("$")) return process.env[raw.slice(1)] ?? null;
  return raw ?? null;
}

function prettifyName(id) {
  return String(id)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

// Both /v1/models (openai) and /anthropic/v1/models return { data: [{ id, ... }] }.
function listIds(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const out = new Map();
  for (const m of data) {
    if (m && typeof m.id === "string") out.set(m.id, m);
  }
  return out;
}

function localIds(provider) {
  const ids = new Set();
  for (const m of provider?.models ?? []) if (m?.id) ids.add(m.id);
  return ids;
}

function skeletonEntry(id, remote, { anthropic }) {
  const contextWindow = Number.isFinite(remote?.context_window) && remote.context_window > 0
    ? remote.context_window
    : PLACEHOLDER_CONTEXT_WINDOW;
  const reasoning = typeof remote?.supports_reasoning === "boolean" ? remote.supports_reasoning : false;
  const entry = {
    id,
    name: (remote?.display_name && String(remote.display_name).trim()) || prettifyName(id),
    reasoning,
    input: ["text"],
    cost: { ...PLACEHOLDER_COST },
    contextWindow,
    maxTokens: PLACEHOLDER_MAX_TOKENS,
  };
  // Claude models on this endpoint use adaptive thinking and reject temperature.
  if (anthropic) entry.compat = { forceAdaptiveThinking: true, supportsTemperature: false };
  return entry;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (!existsSync(args.modelsPath)) throw new Error(`models.json not found: ${args.modelsPath}`);

  const current = JSON.parse(readFileSync(args.modelsPath, "utf-8"));
  const openaiProvider = current.providers?.[args.openaiProvider];
  const anthropicProvider = current.providers?.[args.anthropicProvider];
  if (!openaiProvider) throw new Error(`Provider not found: ${args.openaiProvider}`);
  if (!anthropicProvider) throw new Error(`Provider not found: ${args.anthropicProvider}`);

  const apiKey = resolveKey(openaiProvider.apiKey, args.apiKey);
  if (!apiKey) throw new Error("No API key. Set $THECLAWBAY_API_KEY or pass --api-key.");

  // Anthropic-style listing (authoritative for claude routing).
  const anthropicBase = anthropicProvider.baseUrl.replace(/\/$/, "");
  const anthropicRemote = listIds(await fetchJson(`${anthropicBase}/v1/models`, {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  }));
  // OpenAI-style listing (everything, including claude — we filter those out).
  const openaiBase = openaiProvider.baseUrl.replace(/\/$/, "");
  const openaiRemote = listIds(await fetchJson(`${openaiBase}/models`, {
    Authorization: `Bearer ${apiKey}`,
  }));

  const next = structuredClone(current);
  const nextOpenai = next.providers[args.openaiProvider];
  const nextAnthropic = next.providers[args.anthropicProvider];
  const localOpenai = localIds(nextOpenai);
  const localAnthropic = localIds(nextAnthropic);
  const allLocal = new Set([...localOpenai, ...localAnthropic]);

  const added = [];
  const retired = [];

  // claude-* -> anthropic provider
  for (const [id, remote] of anthropicRemote) {
    if (allLocal.has(id)) continue;
    const entry = skeletonEntry(id, remote, { anthropic: true });
    nextAnthropic.models.unshift(entry);
    allLocal.add(id);
    added.push({ provider: args.anthropicProvider, id, placeholder: true, entry });
  }
  // everything else from /v1/models -> openai provider (skip claude, handled above)
  for (const [id, remote] of openaiRemote) {
    if (id.startsWith("claude-")) continue;
    if (allLocal.has(id)) continue;
    const entry = skeletonEntry(id, remote, { anthropic: false });
    nextOpenai.models.push(entry);
    allLocal.add(id);
    added.push({ provider: args.openaiProvider, id, placeholder: true, entry });
  }

  // models present locally but no longer served by the endpoint (informational only)
  const remoteAll = new Set([...anthropicRemote.keys(), ...openaiRemote.keys()]);
  for (const id of localAnthropic) if (!remoteAll.has(id)) retired.push({ provider: args.anthropicProvider, id });
  for (const id of localOpenai) if (!remoteAll.has(id)) retired.push({ provider: args.openaiProvider, id });

  const summary = {
    mode: args.write ? "write" : "dry-run",
    modelsPath: args.modelsPath,
    addedCount: added.length,
    added,
    retiredFromEndpoint: retired,
    nextSteps: added.length
      ? [
          "New entries use placeholder cost/context — review them.",
          "Run: node scripts/sync-models-dev.mjs --write   (backfills metadata where models.dev has a match)",
        ]
      : [],
  };

  if (args.write && added.length > 0) {
    const dest = backupPath(basename(args.modelsPath));
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    chmodSync(dirname(dest), 0o700); // enforce even if the dir pre-existed with looser perms
    copyFileSync(args.modelsPath, dest);
    chmodSync(dest, 0o600); // the backup holds the same config/keys as the live file
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
