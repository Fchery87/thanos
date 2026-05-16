import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPresetPolicy } from "./presets";
import { parsePolicy } from "./schema";
import type { HarnessPolicy } from "./types";

const DEFAULTS: HarnessPolicy = getPresetPolicy("personal");

function isMissingFile(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT";
}

function resolvePolicyPath(policyPath: string | undefined): string | undefined {
  const explicit = policyPath?.trim();
  if (explicit) return explicit;
  const envPath = process.env.HARNESS_POLICY_FILE?.trim();
  return envPath ? envPath : undefined;
}

export async function loadPolicy(cwd: string, policyPath?: string): Promise<HarnessPolicy> {
  const configuredPath = resolvePolicyPath(policyPath);
  const filePath = configuredPath ?? join(cwd, "harness.policy.json");

  try {
    const raw = await readFile(filePath, "utf-8");
    return parsePolicy(JSON.parse(raw) as unknown);
  } catch (err) {
    if (!configuredPath && isMissingFile(err)) {
      return { ...DEFAULTS, rules: [...DEFAULTS.rules] };
    }

    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to load policy from ${filePath}: ${reason}`);
  }
}
