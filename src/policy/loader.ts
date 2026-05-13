import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessPolicy } from "./types";

const DEFAULTS: HarnessPolicy = {
  version: 1,
  preset: "personal",
  rules: [],
  audit: { enabled: false },
  headless: { defaultDecision: "ask" },
};

export async function loadPolicy(cwd: string): Promise<HarnessPolicy> {
  const filePath = join(cwd, "harness.policy.json");
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as HarnessPolicy;
  } catch {
    return { ...DEFAULTS };
  }
}
