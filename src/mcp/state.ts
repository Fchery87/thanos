// src/mcp/state.ts
//
// Manages two sidecar files that live alongside the user's mcp.json:
//
//   ~/.pi/mcp-state.json   — which servers are disabled (no credentials)
//   ~/.pi/mcp-secrets.json — per-server env / header overrides (credentials)
//
// Neither file is ever written to the mcp.json config files, keeping secrets
// and runtime state out of version-controlled config.
import { readFile, writeFile, mkdir, rename, chmod, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// ─── Paths ────────────────────────────────────────────────────────────────────

const STATE_PATH   = join(homedir(), ".pi", "mcp-state.json");
const SECRETS_PATH = join(homedir(), ".pi", "mcp-secrets.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface McpState {
  /** Server names that have been explicitly disabled. */
  disabled: string[];
}

export interface ServerSecrets {
  /** Extra env vars to merge into a stdio server's environment. */
  env?: Record<string, string>;
  /** Extra headers to merge into an HTTP server's request headers. */
  headers?: Record<string, string>;
  /** OAuth refresh credentials for automatic token renewal. */
  oauth?: {
    refreshToken?: string;
    tokenEndpoint?: string;
    clientId?: string;
  };
}

export type McpSecrets = Record<string, ServerSecrets>;

// ─── State helpers ────────────────────────────────────────────────────────────

export async function readMcpState(): Promise<McpState> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<McpState>;
    return { disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [] };
  } catch {
    return { disabled: [] };
  }
}

export async function writeMcpState(state: McpState): Promise<void> {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export async function isServerDisabled(name: string): Promise<boolean> {
  const state = await readMcpState();
  return state.disabled.includes(name);
}

export async function setServerDisabled(name: string, disabled: boolean): Promise<void> {
  const state = await readMcpState();
  if (disabled) {
    if (!state.disabled.includes(name)) state.disabled.push(name);
  } else {
    state.disabled = state.disabled.filter((n) => n !== name);
  }
  await writeMcpState(state);
}

// ─── Secrets helpers ──────────────────────────────────────────────────────────

export async function readMcpSecrets(): Promise<McpSecrets> {
  let raw: string;
  try {
    raw = await readFile(SECRETS_PATH, "utf-8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      // First run — file simply doesn't exist yet. Silently return empty.
      return {};
    }
    console.error("[harness][mcp] Failed to read mcp-secrets.json:", err.message);
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as McpSecrets;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    console.error(
      "[harness][mcp] mcp-secrets.json is corrupted — resetting to empty. Backup at mcp-secrets.json.bak",
    );
    try { await copyFile(SECRETS_PATH, SECRETS_PATH + ".bak"); } catch { /* ignore */ }
    return {};
  }
}

/** Retro-fix file permissions for existing installs (called on activation). */
export async function fixSecretsPermissions(): Promise<void> {
  try { await chmod(SECRETS_PATH, 0o600); } catch { /* ignore if file doesn't exist */ }
}

export async function readServerSecrets(name: string): Promise<ServerSecrets> {
  const all = await readMcpSecrets();
  return all[name] ?? {};
}

/**
 * Merge `patch` into the existing secrets entry for `name`, then write.
 * Only touches the named server's key — all other entries are preserved.
 */
export async function writeServerSecrets(name: string, patch: ServerSecrets): Promise<void> {
  await mkdir(dirname(SECRETS_PATH), { recursive: true });
  const all = await readMcpSecrets();
  const existing = all[name] ?? {};
  all[name] = {
    env:     { ...existing.env,     ...patch.env },
    headers: { ...existing.headers, ...patch.headers },
  };
  // Clean up empty sub-objects
  if (all[name].env     && Object.keys(all[name].env!).length     === 0) delete all[name].env;
  if (all[name].headers && Object.keys(all[name].headers!).length === 0) delete all[name].headers;
  const tmp = SECRETS_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(all, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, SECRETS_PATH);
}
