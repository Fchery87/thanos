#!/usr/bin/env node
// Thanos patch: extend pi's thinking-level ladder with "max". Idempotent; safe
// to run repeatedly. Re-run after every pi-coding-agent update (like
// patch-pi-subagents.mjs).
//
// Why: GPT-5.6 (Sol/Terra/Luna) added a `max` reasoning effort ABOVE `xhigh`
//   (API-verified on theclawbay: effort=max -> 200, honored). Pi's ladder is
//   hardcoded as off..xhigh, so `max` was unreachable without stealing the
//   xhigh slot via thinkingLevelMap remapping — which the user explicitly
//   does not want. ("ultra" is NOT an effort value — it is Codex's multi-agent
//   mode; the Responses API 400s on reasoning.effort="ultra" — so it cannot be
//   a ladder level.)
//
// Patch 1 (pi-ai dist/models.js): add "max" to EXTENDED_THINKING_LEVELS and
//   gate it like "xhigh" — only offered when a model's thinkingLevelMap
//   explicitly defines it, so no other model gains a bogus level.
// Patch 2 (pi-coding-agent dist/cli/args.js): accept --thinking max and
//   mention it in --help.
//
// Models opt in via models.json, e.g. "thinkingLevelMap": { "max": "max" }.
//
// Targets BOTH installs: the global nvm CLI (what `pi` actually runs) and the
// ~/.pi devDependency copy (kept aligned per thanos convention).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const roots = [
  // global install serving the `pi` binary (…/lib/node_modules/…)
  join(dirname(process.execPath), "..", "lib", "node_modules", "@earendil-works", "pi-coding-agent"),
  // ~/.pi devDep copy
  join(homedir(), ".pi", "node_modules", "@earendil-works", "pi-coding-agent"),
];

function patchesFor(root) {
  // pi-ai may be nested under the coding agent or hoisted next to it.
  const piAiCandidates = [
    join(root, "node_modules", "@earendil-works", "pi-ai", "dist", "models.js"),
    join(root, "..", "pi-ai", "dist", "models.js"),
  ];
  const modelsJs = piAiCandidates.find(existsSync);
  return [
    {
      file: modelsJs,
      marker: 'const EXTENDED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]',
      needle: 'const EXTENDED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];',
      replacement:
        'const EXTENDED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]; // thanos-patch: max thinking level',
    },
    {
      file: modelsJs,
      marker: 'if (level === "xhigh" || level === "max")',
      needle: '        if (level === "xhigh")\n            return mapped !== undefined;',
      replacement:
        '        if (level === "xhigh" || level === "max") // thanos-patch: max thinking level\n            return mapped !== undefined;',
    },
    {
      file: join(root, "dist", "cli", "args.js"),
      marker: '"xhigh", "max"]',
      needle: 'const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];',
      replacement:
        'const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]; // thanos-patch: max thinking level',
    },
    {
      file: join(root, "dist", "cli", "args.js"),
      marker: "off, minimal, low, medium, high, xhigh, max",
      needle: "Set thinking level: off, minimal, low, medium, high, xhigh",
      replacement: "Set thinking level: off, minimal, low, medium, high, xhigh, max",
    },
  ];
}

let failures = 0;
for (const root of roots) {
  if (!existsSync(root)) {
    console.log(`skip (not found): ${root}`);
    continue;
  }
  console.log(`patching: ${root}`);
  for (const patch of patchesFor(root)) {
    if (!patch.file || !existsSync(patch.file)) {
      console.log(`  MISSING FILE for patch "${patch.marker}" — pi layout changed?`);
      failures++;
      continue;
    }
    const source = readFileSync(patch.file, "utf-8");
    if (source.includes(patch.marker)) {
      console.log(`  already applied: ${patch.file}`);
      continue;
    }
    if (!source.includes(patch.needle)) {
      console.log(`  NEEDLE NOT FOUND in ${patch.file} — upstream changed; patch needs re-deriving.`);
      failures++;
      continue;
    }
    writeFileSync(patch.file, source.replace(patch.needle, patch.replacement), "utf-8");
    console.log(`  applied: ${patch.file}`);
  }
}
process.exit(failures ? 1 : 0);
