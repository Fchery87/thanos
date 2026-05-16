import type { HarnessPolicy, PolicyPreset, PolicyRule } from "./types";

export const BUILTIN_SENSITIVE_READ_RULES: PolicyRule[] = [
  {
    id: "builtin-deny-env-read",
    capability: "read",
    pattern: ".env*",
    decision: "deny",
    reason: "Environment files may contain secrets",
  },
  {
    id: "builtin-deny-private-key-pem-read",
    capability: "read",
    pattern: "**/*.pem",
    decision: "deny",
    reason: "Private key material must not be read by agents",
  },
  {
    id: "builtin-deny-private-key-read",
    capability: "read",
    pattern: "**/*.key",
    decision: "deny",
    reason: "Private key material must not be read by agents",
  },
  {
    id: "builtin-deny-ssh-key-read",
    capability: "read",
    pattern: "**/id_rsa*",
    decision: "deny",
    reason: "SSH private keys must not be read by agents",
  },
  {
    id: "builtin-deny-ssh-ed25519-key-read",
    capability: "read",
    pattern: "**/id_ed25519*",
    decision: "deny",
    reason: "SSH private keys must not be read by agents",
  },
];

function teamPreset(): HarnessPolicy {
  return {
    version: 1,
    preset: "team",
    rules: [...BUILTIN_SENSITIVE_READ_RULES],
    audit: { enabled: true },
    headless: { defaultDecision: "deny" },
  };
}

function ciPreset(): HarnessPolicy {
  return {
    version: 1,
    preset: "ci",
    rules: [...BUILTIN_SENSITIVE_READ_RULES],
    audit: { enabled: true },
    headless: { defaultDecision: "deny" },
  };
}

function personalPreset(): HarnessPolicy {
  return {
    version: 1,
    preset: "personal",
    rules: [],
    audit: { enabled: false },
    headless: { defaultDecision: "ask" },
  };
}

export function getPresetPolicy(preset: PolicyPreset): HarnessPolicy {
  if (preset === "team") return teamPreset();
  if (preset === "ci") return ciPreset();
  return personalPreset();
}
